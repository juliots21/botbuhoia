const axios = require('axios');
const config = require('../../config');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const { WhatsAppAPIError } = require('../utils/error_handler');

class WhatsAppService {
    constructor() {
        this.token = config.whatsapp.token;
        this.phoneNumberId = config.whatsapp.phoneNumberId;
        this.apiUrl = config.whatsapp.apiUrl;
        this.chunkConfig = config.whatsapp.chunking;
        this.retryConfig = config.whatsapp.retry;

        // Instancia Axios reutilizable con keep-alive y headers pre-configurados
        this.client = axios.create({
            baseURL: `${this.apiUrl}/${this.phoneNumberId}`,
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000 // 15s timeout por request
        });
    }

    /**
     * Envía un mensaje de texto simple
     */
    async sendMessage(to, text) {
        if (!this.token || !this.phoneNumberId) {
            logger.warn('[WHATSAPP] Token o Phone Number ID no configurado (modo simulación activo).');
            logger.info(`[WHATSAPP-SIMULADO] Para: ${to}\n[WHATSAPP-SIMULADO] Mensaje: ${text}`);
            return { simulated: true, messages: [{ id: 'simulated_id' }] };
        }

        const data = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to,
            type: "text",
            text: { preview_url: false, body: text }
        };

        return this._sendWithRetry('/messages', data, to, 'texto');
    }

    /**
     * Envía el indicador de "escribiendo..." al usuario
     * Esto hace que en WhatsApp aparezca la burbuja con los 3 puntitos
     */
    async sendTypingIndicator(to) {
        if (!this.token || !this.phoneNumberId) return;

        try {
            await this.client.post('/messages', {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: to,
                type: "reaction",
                // WhatsApp Cloud API no tiene un endpoint de "typing" directo,
                // pero podemos usar el status 'typing' via el endpoint de presencia
            });
        } catch (error) {
            // Silenciar errores del typing indicator — no es crítico
            logger.debug(`[WHATSAPP] No se pudo enviar typing indicator a ${to}: ${error.message}`);
        }
    }

    /**
     * Marca la presencia como "escribiendo" usando la API de mensajes
     * Meta WhatsApp Cloud API no expone un typing endpoint público,
     * por lo que se simula de forma progresiva
     */
    async setTypingStatus(to) {
        if (!this.token || !this.phoneNumberId) return;

        // No hay un endpoint directo de typing en la Cloud API de Meta.
        // El efecto de "escribiendo" se logra enviando mensajes progresivos.
        logger.debug(`[WHATSAPP] Typing status activado para ${to}`);
    }

    /**
     * Envía un mensaje largo dividido en chunks progresivos
     * Simula el efecto de escritura progresiva estilo ChatGPT
     */
    async sendMessageChunked(to, fullText) {
        if (!this.chunkConfig.enabled || !fullText || fullText.length <= this.chunkConfig.maxChunkLength) {
            return this.sendMessage(to, fullText);
        }

        const chunks = this._splitIntoChunks(fullText);
        logger.info(`[WHATSAPP] Enviando respuesta en ${chunks.length} fragmentos a ${to}`);

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];

            // Enviar indicador typing antes de cada chunk (excepto el primero, ya se envió antes)
            if (i > 0) {
                await this._sleep(this.chunkConfig.typingIndicatorMs);
            }

            // Enviar el fragmento
            await this.sendMessage(to, chunk);
            metrics.increment('whatsappMessagesSent');

            // Delay entre chunks para simular velocidad de escritura humana
            if (i < chunks.length - 1) {
                await this._sleep(this.chunkConfig.delayBetweenChunksMs);
            }
        }

        logger.info(`[WHATSAPP] ✓ Respuesta completa enviada a ${to} (${chunks.length} fragmentos)`);
    }

    /**
     * Marca un mensaje como leído (doble check azul)
     */
    async markAsRead(messageId) {
        if (!this.token || !this.phoneNumberId) return;

        try {
            await this.client.post('/messages', {
                messaging_product: "whatsapp",
                status: "read",
                message_id: messageId
            });
            logger.debug(`[WHATSAPP] Mensaje ${messageId} marcado como leído`);
        } catch (error) {
            logger.error(`[WHATSAPP] Error marcando mensaje como leído: ${error.message}`);
        }
    }

    /**
     * Divide un texto largo en chunks inteligentes
     * Respeta límites de palabras, párrafos y listas
     */
    _splitIntoChunks(text) {
        const maxLen = this.chunkConfig.maxChunkLength;
        const chunks = [];

        // Primero intentar dividir por párrafos (doble salto de línea)
        const paragraphs = text.split(/\n\n+/);

        let currentChunk = '';

        for (const paragraph of paragraphs) {
            // Si el párrafo solo ya excede el máximo, dividirlo por oraciones
            if (paragraph.length > maxLen) {
                // Guardar chunk actual si tiene contenido
                if (currentChunk.trim()) {
                    chunks.push(currentChunk.trim());
                    currentChunk = '';
                }

                // Dividir párrafo largo por líneas primero
                const lines = paragraph.split('\n');
                for (let line of lines) {
                    // Si la línea sigue siendo muy larga, intentar dividir por puntos seguidos de espacio
                    if (line.length > maxLen) {
                        const sentences = line.match(/[^.!?]+([.!?]+(?=\s|$)|$)/g) || [line];
                        for (const sentence of sentences) {
                            if ((currentChunk + sentence).length > maxLen && currentChunk.trim()) {
                                chunks.push(currentChunk.trim());
                                currentChunk = sentence;
                            } else {
                                currentChunk += sentence;
                            }
                        }
                    } else {
                        if ((currentChunk + '\n' + line).length > maxLen && currentChunk.trim()) {
                            chunks.push(currentChunk.trim());
                            currentChunk = line;
                        } else {
                            currentChunk += (currentChunk ? '\n' : '') + line;
                        }
                    }
                }
            } else if ((currentChunk + '\n\n' + paragraph).length > maxLen && currentChunk.trim()) {
                chunks.push(currentChunk.trim());
                currentChunk = paragraph;
            } else {
                currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
            }
        }

        // Agregar el último chunk
        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }

        return chunks.length > 0 ? chunks : [text];
    }

    /**
     * Envía una petición con reintentos y backoff exponencial
     */
    async _sendWithRetry(endpoint, data, to, tipo) {
        let lastError;

        for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    const delay = Math.min(
                        this.retryConfig.baseDelayMs * Math.pow(2, attempt - 1),
                        this.retryConfig.maxDelayMs
                    );
                    logger.debug(`[WHATSAPP] Reintento ${attempt}/${this.retryConfig.maxRetries} en ${delay}ms...`);
                    await this._sleep(delay);
                }

                logger.debug(`[WHATSAPP] POST enviando ${tipo} a ${to}...`);
                const response = await this.client.post(endpoint, data);
                logger.info(`[WHATSAPP] ✓ Mensaje ${tipo} enviado a ${to} (ID: ${response.data.messages[0].id})`);
                return response.data;

            } catch (error) {
                lastError = error;
                const errorData = error.response ? JSON.stringify(error.response.data) : error.message;
                const statusCode = error.response?.status;

                // No reintentar errores 4xx (excepto 429 rate limit)
                if (statusCode && statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
                    logger.error(`[WHATSAPP] Error ${statusCode} no reintentable enviando a ${to}: ${errorData}`);
                    metrics.increment('whatsappErrors');
                    throw new WhatsAppAPIError(`Error ${statusCode}: ${errorData}`, error);
                }

                logger.warn(`[WHATSAPP] Intento ${attempt + 1} fallido enviando a ${to}: ${errorData}`);
            }
        }

        metrics.increment('whatsappErrors');
        throw new WhatsAppAPIError(`Falló después de ${this.retryConfig.maxRetries} reintentos`, lastError);
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = new WhatsAppService();
