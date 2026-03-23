const geminiService = require('../services/gemini_service');
const whatsappService = require('../services/whatsapp_service');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const rateLimiter = require('../utils/rate_limiter');
const messageQueue = require('../utils/message_queue');
const config = require('../../config');
const { InMemoryChatMessageHistory: ChatMessageHistory } = require("@langchain/core/chat_history");

// Historial en memoria (En producción: usar DB como Redis/Mongo)
const userConversations = new Map();

class BotHandler {
    constructor() {
        // Ejecutar limpiador de memoria periódicamente
        this.cleanupInterval = setInterval(
            () => this.cleanupConversations(),
            config.conversation.inactivityTimeoutMs / 2
        );
    }

    /**
     * Procesa un mensaje entrante con todas las optimizaciones:
     * - Deduplicación de mensajes
     * - Rate limiting por usuario
     * - Cola secuencial por usuario
     * - markAsRead + typing en paralelo
     * - Envío chunkeado progresivo
     */
    async handleIncomingMessage(userPhone, messageText, messageId, userName = '') {
        // 1. Deduplicación — ignorar mensajes que ya procesamos
        if (messageQueue.isDuplicate(messageId)) {
            metrics.increment('duplicateMessages');
            logger.debug(`[BOT] Mensaje duplicado ignorado: ${messageId} de ${userPhone}`);
            return;
        }

        metrics.increment('messagesReceived');

        // 2. Rate limiting — verificar límite de mensajes por usuario
        const rateCheck = rateLimiter.check(userPhone);
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

    /**
     * Procesamiento real del mensaje (ejecutado secuencialmente por la cola)
     */
    async _processMessage(userPhone, messageText, messageId, userName = '') {
        const startTime = Date.now();

        try {
            logger.debug(`[BOT] Procesando mensaje de ${userPhone}...`);

            // OPTIMIZACIÓN CLAVE: Ejecutar markAsRead y typing en PARALELO
            // El usuario ve el doble check azul y "escribiendo..." casi instantáneamente
            await Promise.all([
                whatsappService.markAsRead(messageId),
                whatsappService.setTypingStatus(userPhone)
            ]);

            // Extraer historial del usuario para contexto
            let history = userConversations.get(userPhone);
            if (!history) {
                history = {
                    chatHistory: new ChatMessageHistory(),
                    lastActivity: Date.now(),
                    messageCount: 0
                };
                userConversations.set(userPhone, history);
            }

            // Generar respuesta con Gemini y memoria LangChain
            const responseText = await geminiService.generateResponse(messageText, history.chatHistory, userName);

            // Gestionar límite de historial (mantener solo los últimos N mensajes, equivalente a BufferWindowMemory)
            const maxMessages = config.conversation.maxHistoryMessages;
            const currentMessages = await history.chatHistory.getMessages();
            logger.info(`[BOT] Contexto de memoria para ${userPhone}: ${currentMessages.length} mensajes cargados.`);
            if (currentMessages.length > maxMessages) {
                await history.chatHistory.clear();
                const subset = currentMessages.slice(currentMessages.length - maxMessages);
                for (const msg of subset) {
                    await history.chatHistory.addMessage(msg);
                }
            }

            history.lastActivity = Date.now();
            history.messageCount++;

            // ENVÍO PROGRESIVO — Simula efecto "escribiendo" estilo ChatGPT
            // Divide la respuesta en fragmentos y los envía con delay
            logger.debug(`[BOT] Emitiendo respuesta progresiva a ${userPhone}...`);
            await whatsappService.sendMessageChunked(userPhone, responseText);

            const latency = Date.now() - startTime;
            metrics.increment('messagesProcessed');
            logger.info(`[BOT] ✓ Flujo completado para ${userPhone} en ${latency}ms`);

        } catch (error) {
            metrics.increment('messagesFailed');
            logger.error(`[BOT] Error procesando mensaje de ${userPhone}. Detalles: ${error.stack}`);

            // Respuesta de emergencia
            try {
                await whatsappService.sendMessage(
                    userPhone,
                    "Disculpa, acabo de tener un pequeño tropiezo procesando tu mensaje. ¿Podrías volver a intentarlo, por favor? 🦉"
                );
            } catch (waError) {
                logger.error(`[BOT] Ni la respuesta de emergencia pudo enviarse a ${userPhone}. ${waError.message}`);
            }
        }
    }

    /**
     * Maneja tipos de mensaje no soportados (imagen, audio, sticker, etc.)
     */
    async handleUnsupportedMessage(userPhone, messageType, messageId) {
        if (messageQueue.isDuplicate(messageId)) return;

        metrics.increment('messagesReceived');
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
            `Por el momento solo puedo procesar mensajes de texto ✍️. Todavía no tengo la habilidad de entender ${typeName}, pero estoy aprendiendo. ¡Escríbeme tu consulta y con gusto te ayudo! 🦉`
        );
    }

    /**
     * Limpia historial de conversaciones inactivas
     */
    cleanupConversations() {
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
    }

    /**
     * Obtiene estadísticas del bot handler
     */
    getStats() {
        return {
            activeConversations: userConversations.size,
            totalMessages: Array.from(userConversations.values())
                .reduce((acc, v) => acc + v.messageCount, 0)
        };
    }

    destroy() {
        clearInterval(this.cleanupInterval);
    }
}

module.exports = new BotHandler();
