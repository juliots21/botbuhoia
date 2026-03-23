const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate, MessagesPlaceholder } = require("@langchain/core/prompts");
const { RunnableWithMessageHistory } = require("@langchain/core/runnables");
const config = require('../../config');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const knowledgeLoader = require('./knowledge_loader');
const { GeminiAPIError } = require('../utils/error_handler');

class GeminiService {
    constructor() {
        this.apiKeys = config.gemini.apiKeys;
        this.generationConfig = config.gemini.generationConfig;
        this.timeout = config.gemini.timeout;
        this.circuitBreakerConfig = config.gemini.circuitBreaker;

        if (this.apiKeys.length === 0) {
            logger.warn('[GEMINI] No hay API keys configuradas en las variables de entorno (.env). La IA no podrá responder.');
        }

        this.currentKeyIndex = 0;

        // Inicializar modelos LangChain y estado de circuit breaker por key
        this.keys = this.apiKeys.map((key, index) => {
            return {
                index,
                model: new ChatGoogleGenerativeAI({
                    model: config.gemini.model || "gemini-1.5-flash",
                    apiKey: key,
                    maxOutputTokens: this.generationConfig.maxOutputTokens,
                    temperature: this.generationConfig.temperature,
                    topP: this.generationConfig.topP
                }),
                failures: 0,
                disabledUntil: 0, // Timestamp cuando se reactiva
                totalCalls: 0,
                totalErrors: 0
            };
        });
    }

    /**
     * Genera una respuesta de la IA con circuit breaker y LangChain Memory
     */
    async generateResponse(userMessage, chatHistory, userName = '') {
        if (this.keys.length === 0) {
            return "Lo siento, mi cerebro IA no está configurado actualmente (Faltan API Keys).";
        }

        const knowledge = knowledgeLoader.load();
        const userNamePrompt = userName ? `\n\nEl nombre del usuario de WhatsApp con el que estás hablando es "${userName}". Llámalo por su nombre gentilmente.` : '';

        // Construir el prompt de LangChain
        const prompt = ChatPromptTemplate.fromMessages([
            ["system", knowledge + userNamePrompt + "\n\n¡Entendido! Actuaré como Asistente, el asesor virtual experto de Digital Buho. Usaré toda la base de conocimiento proporcionada para responder preguntas."],
            new MessagesPlaceholder("history"),
            ["human", "{input}"]
        ]);

        let attempts = 0;
        const maxAttempts = this.keys.length;

        while (attempts < maxAttempts) {
            const keyData = this._getNextAvailableKey();
            
            if (!keyData) {
                logger.warn('[GEMINI] Todas las keys están desactivadas por el Circuit Breaker.');
                return "Estoy experimentando problemas técnicos temporales (Circuit Breaker). Por favor intenta en un par de minutos.";
            }

            try {
                const startTime = Date.now();
                keyData.totalCalls++;
                metrics.increment('geminiCalls');
                logger.debug(`[GEMINI] Procesando con key #${keyData.index + 1}/${this.keys.length}`);

                // Crear cadena con el modelo de esta iteración
                const chain = prompt.pipe(keyData.model);
                
                // Envolver con memoria
                const withHistory = new RunnableWithMessageHistory({
                    runnable: chain,
                    getMessageHistory: () => chatHistory,
                    inputMessagesKey: "input",
                    historyMessagesKey: "history",
                });

                // Ejecutar con timeout
                const response = await this._generateWithTimeout(withHistory, userMessage);
                
                // Éxito: resetear fallos del circuit breaker
                keyData.failures = 0;

                const latency = Date.now() - startTime;
                metrics.recordLatency(latency);
                logger.info(`[GEMINI] ✓ Respuesta generada con key #${keyData.index + 1} en ${latency}ms`);

                return response.content;

            } catch (error) {
                keyData.totalErrors++;
                keyData.failures++;
                metrics.increment('geminiErrors');

                logger.warn(`[GEMINI] Error con key #${keyData.index + 1} (fallo ${keyData.failures}/${this.circuitBreakerConfig.failureThreshold}): ${error.message}`);

                // Circuit breaker: desactivar key si supera el umbral
                if (keyData.failures >= this.circuitBreakerConfig.failureThreshold) {
                    keyData.disabledUntil = Date.now() + this.circuitBreakerConfig.recoveryTimeMs;
                    logger.warn(`[GEMINI] ⚡ Circuit breaker activado para key #${keyData.index + 1}. Reactivación en ${this.circuitBreakerConfig.recoveryTimeMs / 1000}s`);
                    metrics.increment('geminiKeyRotations');
                }

                // Rotar al siguiente
                this.currentKeyIndex = (this.currentKeyIndex + 1) % this.keys.length;
                attempts++;
            }
        }

        logger.error('[GEMINI] Todos los tokens de Gemini fallaron (Rate limit o Error).');
        return "Disculpa, el sistema está experimentando una alta demanda y no puedo procesar tu solicitud en este instante. Por favor intenta en unos minutos. 🦉";
    }

    /**
     * Obtiene la siguiente key disponible (no desactivada por circuit breaker)
     */
    _getNextAvailableKey() {
        const now = Date.now();

        for (let i = 0; i < this.keys.length; i++) {
            const idx = (this.currentKeyIndex + i) % this.keys.length;
            const keyData = this.keys[idx];

            if (keyData.disabledUntil < now) {
                // Key disponible
                this.currentKeyIndex = idx;
                return keyData;
            }
        }

        return null; // Todas desactivadas
    }

    /**
     * Envoltura de promesa con Timeout puro para abortar el request a LangChain
     */
    async _generateWithTimeout(withHistory, userMessage) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new GeminiAPIError('Timeout - El modelo tardó demasiado en responder'));
            }, this.timeout);

            withHistory.invoke(
                { input: userMessage },
                { configurable: { sessionId: "wa_session" } }
            )
            .then(result => {
                clearTimeout(timer);
                resolve(result);
            })
            .catch(err => {
                clearTimeout(timer);
                reject(err);
            });
        });
    }

    getStats() {
        return {
            totalKeys: this.keys.length,
            activeKeys: this.keys.filter(k => k.disabledUntil < Date.now()).length,
            keys: this.keys.map(k => ({
                index: k.index + 1,
                active: k.disabledUntil < Date.now(),
                totalCalls: k.totalCalls,
                totalErrors: k.totalErrors,
                failures: k.failures
            }))
        };
    }
}

module.exports = new GeminiService();
