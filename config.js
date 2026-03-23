require('dotenv').config();

module.exports = {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',

    gemini: {
        apiKeys: [
            process.env.GEMINI_API_KEY_1,
            process.env.GEMINI_API_KEY_2,
            process.env.GEMINI_API_KEY_3,
            process.env.GEMINI_API_KEY_4
        ].filter(Boolean),
        model: 'gemini-flash-latest',
        generationConfig: {
            temperature: 0.7,
            topP: 0.9,
            maxOutputTokens: 1024
        },
        timeout: 30000, // 30 segundos de timeout por request
        circuitBreaker: {
            failureThreshold: 3,   // Fallos consecutivos antes de desactivar la key
            recoveryTimeMs: 120000 // 2 minutos antes de reintentar una key desactivada
        }
    },

    whatsapp: {
        token: process.env.WHATSAPP_TOKEN,
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
        verifyToken: process.env.WEBHOOK_VERIFY_TOKEN,
        apiUrl: 'https://graph.facebook.com/v22.0',
        chunking: {
            enabled: false,
            maxChunkLength: 2000,       // Caracteres máximos por chunk
            delayBetweenChunksMs: 800, // Delay entre chunks para simular escritura
            typingIndicatorMs: 400     // Tiempo extra de "typing" antes de cada chunk
        },
        retry: {
            maxRetries: 3,
            baseDelayMs: 1000, // Backoff exponencial: 1s, 2s, 4s
            maxDelayMs: 8000
        }
    },

    rateLimiting: {
        maxMessagesPerWindow: 15, // Máximo de mensajes por ventana
        windowSizeMs: 60000,      // Ventana de 1 minuto
        cooldownMs: 10000         // Cooldown mínimo tras exceder el límite
    },

    security: {
        appSecret: process.env.META_APP_SECRET || null
    },

    conversation: {
        maxHistoryMessages: 20,    // Máximo de mensajes en el historial
        inactivityTimeoutMs: 7200000 // 2 horas de inactividad para limpiar contexto
    },

    scraper: {
        schedule: process.env.SCRAPER_SCHEDULE || 'manual' // 'manual', 'daily', 'weekly'
    }
};
