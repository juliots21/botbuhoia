const geminiService = require('../services/gemini_service');
const whatsappService = require('../services/whatsapp_service');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const rateLimiter = require('../utils/rate_limiter');
const messageQueue = require('../utils/message_queue');
const config = require('../../config');
const userSettingsService = require('../services/user_settings_service');
const conversationStoreService = require('../services/conversation_store_service');
const { InMemoryChatMessageHistory: ChatMessageHistory } = require("@langchain/core/chat_history");

// Historial en memoria (En producción: usar DB como Redis/Mongo)
const userConversations = new Map();

class BotHandler {
    constructor() {
        // Ejecutar limpiador de memoria periódicamente
        this.cleanupInterval = setInterval(
            () => {
                this.cleanupConversations().catch((error) => {
                    logger.warn(`[BOT] Error en limpieza de conversaciones: ${error.message}`);
                });
            },
            config.conversation.inactivityTimeoutMs / 2
        );
    }

    async _getOrCreateConversation(userPhone) {
        let history = userConversations.get(userPhone);
        if (history) return history;

        const chatHistory = new ChatMessageHistory();
        const persisted = await conversationStoreService.hydrateChatHistory(userPhone, chatHistory);
        history = {
            chatHistory,
            lastActivity: persisted.lastActivity || Date.now(),
            messageCount: persisted.messageCount || 0
        };
        userConversations.set(userPhone, history);
        return history;
    }

    async _trimHistoryWindow(history, userPhone) {
        const maxMessages = config.conversation.maxHistoryMessages;
        const currentMessages = await history.chatHistory.getMessages();
        logger.info(`[BOT] Contexto de memoria para ${userPhone}: ${currentMessages.length} mensajes cargados.`);
        if (currentMessages.length <= maxMessages) return;

        await history.chatHistory.clear();
        const subset = currentMessages.slice(currentMessages.length - maxMessages);
        for (const msg of subset) {
            await history.chatHistory.addMessage(msg);
        }
    }

    async _persistConversationState(userPhone, history) {
        await conversationStoreService.persistChatHistory(userPhone, history.chatHistory, {
            lastActivity: history.lastActivity,
            messageCount: history.messageCount
        });
    }

    /**
     * Procesa un mensaje entrante con todas las optimizaciones:
     * - Deduplicación de mensajes
     * - Rate limiting por usuario
     * - Cola secuencial por usuario
        * - markAsRead temprano
     */
    async handleIncomingMessage(userPhone, messageText, messageId, userName = '') {
        userSettingsService.touchUser(userPhone, userName);

        // 1. Deduplicación — ignorar mensajes que ya procesamos
        if (messageQueue.isDuplicate(messageId)) {
            metrics.increment('duplicateMessages');
            logger.debug(`[BOT] Mensaje duplicado ignorado: ${messageId} de ${userPhone}`);
            return;
        }

        metrics.increment('messagesReceived');
        metrics.trackUserReceived(userPhone, userName);
        userSettingsService.markMessageReceived(userPhone);

        // 2. Rate limiting — verificar límite de mensajes por usuario
        const userConfig = userSettingsService.getUserSettings(userPhone);
        const rateCheck = rateLimiter.check(userPhone, userConfig.rateLimiting);
        if (!rateCheck.allowed) {
            metrics.increment('rateLimitHits');
            logger.warn(`[BOT] Rate limit para ${userPhone}. Reintento en ${rateCheck.retryAfterMs}ms`);
            await whatsappService.sendMessage(
                userPhone,
                `Estás enviando mensajes muy rápido. Por favor espera unos segundos antes de volver a escribir.`
            );
            return;
        }

        // 3. Encolar para procesamiento secuencial por usuario
        messageQueue.enqueue(userPhone, () =>
            this._processMessage(userPhone, messageText, messageId, userName)
        ).catch(err => {
            logger.error(`[BOT] Error en cola para ${userPhone}: ${err.message}`);
        });
    }

    async handleIncomingImage(userPhone, imagePayload, messageId, userName = '') {
        userSettingsService.touchUser(userPhone, userName);

        if (messageQueue.isDuplicate(messageId)) {
            metrics.increment('duplicateMessages');
            logger.debug(`[BOT] Imagen duplicada ignorada: ${messageId} de ${userPhone}`);
            return;
        }

        metrics.increment('messagesReceived');
        metrics.trackUserReceived(userPhone, userName);
        userSettingsService.markMessageReceived(userPhone);

        const userConfig = userSettingsService.getUserSettings(userPhone);
        const rateCheck = rateLimiter.check(userPhone, userConfig.rateLimiting);
        if (!rateCheck.allowed) {
            metrics.increment('rateLimitHits');
            logger.warn(`[BOT] Rate limit para imagen de ${userPhone}. Reintento en ${rateCheck.retryAfterMs}ms`);
            await whatsappService.sendMessage(
                userPhone,
                'Estas enviando mensajes muy rapido. Espera unos segundos y vuelve a enviar la imagen por favor.'
            );
            return;
        }

        messageQueue.enqueue(userPhone, () =>
            this._processImageMessage(userPhone, imagePayload, messageId, userName)
        ).catch(err => {
            logger.error(`[BOT] Error en cola de imagen para ${userPhone}: ${err.message}`);
        });
    }

    /**
     * Procesamiento real del mensaje (ejecutado secuencialmente por la cola)
     */
    async _processMessage(userPhone, messageText, messageId, userName = '') {
        const startTime = Date.now();

        try {
            logger.debug(`[BOT] Procesando mensaje de ${userPhone}...`);

            // Marcar lectura temprano para confirmar recepcion al usuario.
            await whatsappService.markAsRead(messageId);

            // Extraer historial del usuario para contexto
            const history = await this._getOrCreateConversation(userPhone);

            const normalizedMessage = String(messageText || '').trim().toLowerCase();
            if (normalizedMessage === 'newchatgg') {
                await history.chatHistory.clear();
                history.lastActivity = Date.now();
                history.messageCount = 0;
                await conversationStoreService.clearUserHistory(userPhone);

                const resetReply = 'Listo, reinicie esta conversacion desde cero. Empezamos nuevamente 😊';
                await whatsappService.sendMessage(userPhone, resetReply);
                metrics.increment('whatsappMessagesSent');

                const latency = Date.now() - startTime;
                metrics.increment('messagesProcessed');
                metrics.trackUserProcessed(userPhone, latency, userName);
                userSettingsService.markMessageProcessed(userPhone, latency);
                logger.info(`[BOT] Historial reiniciado para ${userPhone} via comando newchatgg`);
                return;
            }

            // Generar respuesta con Gemini y memoria LangChain
            const userConfig = userSettingsService.getUserSettings(userPhone);
            const responseText = await geminiService.generateResponse(
                messageText,
                history.chatHistory,
                userName,
                userConfig.gemini,
                userPhone
            );

            // Gestionar límite de historial (mantener solo los últimos N mensajes, equivalente a BufferWindowMemory)
            await this._trimHistoryWindow(history, userPhone);

            history.lastActivity = Date.now();
            history.messageCount++;

            await this._persistConversationState(userPhone, history);

            await whatsappService.sendMessage(userPhone, responseText);
            metrics.increment('whatsappMessagesSent');

            const latency = Date.now() - startTime;
            metrics.increment('messagesProcessed');
            metrics.trackUserProcessed(userPhone, latency, userName);
            userSettingsService.markMessageProcessed(userPhone, latency);
            logger.info(`[BOT] ✓ Flujo completado para ${userPhone} en ${latency}ms`);

        } catch (error) {
            metrics.increment('messagesFailed');
            metrics.trackUserFailed(userPhone, userName);
            metrics.recordError('bot_handler', error.message, { phone: userPhone });
            userSettingsService.markMessageFailed(userPhone);
            logger.error(`[BOT] Error procesando mensaje de ${userPhone}. Detalles: ${error.stack}`);

            // Respuesta de emergencia
            try {
                await whatsappService.sendMessage(
                    userPhone,
                    "Disculpa, acabo de tener un pequeño tropiezo procesando tu mensaje. ¿Podrías volver a intentarlo, por favor? 😊"
                );
            } catch (waError) {
                logger.error(`[BOT] Ni la respuesta de emergencia pudo enviarse a ${userPhone}. ${waError.message}`);
            }
        }
    }

    async _processImageMessage(userPhone, imagePayload, messageId, userName = '') {
        const startTime = Date.now();

        try {
            logger.debug(`[BOT] Procesando imagen de ${userPhone}...`);
            await whatsappService.markAsRead(messageId);

            const history = await this._getOrCreateConversation(userPhone);

            const mediaId = String(imagePayload?.id || '').trim();
            const caption = String(imagePayload?.caption || '').trim();
            if (!mediaId) {
                await whatsappService.sendMessage(userPhone, 'NO VALIDADO ❌\nMotivo: No se recibio un archivo de imagen valido.');
                return;
            }

            const media = await whatsappService.downloadMediaAsBase64(mediaId);
            const validationReply = await geminiService.validatePaymentProof(
                {
                    base64: media.base64,
                    mimeType: media.mimeType,
                    fileSizeBytes: media.fileSizeBytes,
                    caption
                },
                {
                    chatHistory: history.chatHistory,
                    userPhone
                }
            );

            history.lastActivity = Date.now();
            history.messageCount++;

            await this._persistConversationState(userPhone, history);

            await whatsappService.sendMessage(userPhone, validationReply);
            metrics.increment('whatsappMessagesSent');

            const latency = Date.now() - startTime;
            metrics.increment('messagesProcessed');
            metrics.trackUserProcessed(userPhone, latency, userName);
            userSettingsService.markMessageProcessed(userPhone, latency);
            logger.info(`[BOT] ✓ Validacion de imagen completada para ${userPhone} en ${latency}ms`);
        } catch (error) {
            metrics.increment('messagesFailed');
            metrics.trackUserFailed(userPhone, userName);
            metrics.recordError('bot_handler_image', error.message, { phone: userPhone });
            userSettingsService.markMessageFailed(userPhone);
            logger.error(`[BOT] Error procesando imagen de ${userPhone}. Detalles: ${error.stack}`);

            try {
                await whatsappService.sendMessage(
                    userPhone,
                    'NO VALIDADO ❌\nMotivo: No se pudo completar la revision del comprobante. Envia una foto mas clara y centrada, por favor.'
                );
            } catch (waError) {
                logger.error(`[BOT] No se pudo enviar error de validacion de imagen a ${userPhone}. ${waError.message}`);
            }
        }
    }

    /**
     * Maneja tipos de mensaje no soportados (imagen, audio, sticker, etc.)
     */
    async handleUnsupportedMessage(userPhone, messageType, messageId) {
        if (messageQueue.isDuplicate(messageId)) return;

        userSettingsService.touchUser(userPhone);
        userSettingsService.markMessageReceived(userPhone);
        metrics.increment('messagesReceived');
        metrics.trackUserReceived(userPhone);
        await whatsappService.markAsRead(messageId);

        const typeNames = {
            image: 'imágenes 📷',
            audio: 'audios 🎙️',
            video: 'videos 🎬',
            sticker: 'stickers 🎨',
            document: 'documentos 📄',
            location: 'ubicaciones 📍',
            contacts: 'contactos 👤'
        };

        const typeName = typeNames[messageType] || `mensajes de tipo "${messageType}"`;
        await whatsappService.sendMessage(
            userPhone,
            `Por el momento solo puedo procesar mensajes de texto ✍️. Todavía no tengo la habilidad de entender ${typeName}, pero estoy aprendiendo. ¡Escríbeme tu consulta y con gusto te ayudo! 😊`
        );
    }

    /**
     * Limpia historial de conversaciones inactivas
     */
    async cleanupConversations() {
        const now = Date.now();
        const timeout = config.conversation.inactivityTimeoutMs;
        let deleted = 0;

        for (const [phone, data] of userConversations.entries()) {
            if (now - data.lastActivity > timeout) {
                userConversations.delete(phone);
                deleted++;
            }
        }

        if (deleted > 0) {
            logger.debug(`[BOT] Tarea de fondo: Se limpió el contexto de ${deleted} chats inactivos.`);
        }

        await conversationStoreService.pruneExpired(timeout);
    }

    /**
     * Obtiene estadísticas del bot handler
     */
    getStats() {
        return {
            activeConversations: userConversations.size,
            totalMessages: Array.from(userConversations.values())
                .reduce((acc, v) => acc + v.messageCount, 0),
            users: userSettingsService.listUsers()
        };
    }

    getUsers() {
        return userSettingsService.listUsers();
    }

    async destroy() {
        clearInterval(this.cleanupInterval);
        await conversationStoreService.destroy();
    }
}

module.exports = new BotHandler();
