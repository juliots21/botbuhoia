const express = require('express');
const router = express.Router();
const config = require('../../config');
const logger = require('../utils/logger');
const rateLimiter = require('../utils/rate_limiter');

/**
 * GET /api/config — Devuelve la configuración actual (sin datos sensibles)
 */
router.get('/config', (req, res) => {
    try {
        res.json({
            rateLimiting: { ...config.rateLimiting },
            whatsapp: {
                chunking: { ...config.whatsapp.chunking }
            },
            gemini: {
                model: config.gemini.model,
                generationConfig: { ...config.gemini.generationConfig },
                timeout: config.gemini.timeout,
                circuitBreaker: { ...config.gemini.circuitBreaker }
            },
            conversation: { ...config.conversation }
        });
    } catch (error) {
        logger.error(`[ADMIN API] Error obteniendo config: ${error.message}`);
        res.status(500).json({ error: 'Error interno' });
    }
});

/**
 * PUT /api/config — Actualiza la configuración en caliente (hot-reload)
 * No requiere reiniciar el servidor
 */
router.put('/config', (req, res) => {
    try {
        const { section, data } = req.body;

        if (!section || !data) {
            return res.status(400).json({ error: 'Se requiere "section" y "data"' });
        }

        switch (section) {
            case 'rateLimiting':
                if (data.maxMessagesPerWindow !== undefined) {
                    config.rateLimiting.maxMessagesPerWindow = parseInt(data.maxMessagesPerWindow);
                    rateLimiter.maxMessages = config.rateLimiting.maxMessagesPerWindow;
                }
                if (data.windowSizeMs !== undefined) {
                    config.rateLimiting.windowSizeMs = parseInt(data.windowSizeMs);
                    rateLimiter.windowSizeMs = config.rateLimiting.windowSizeMs;
                }
                if (data.cooldownMs !== undefined) {
                    config.rateLimiting.cooldownMs = parseInt(data.cooldownMs);
                    rateLimiter.cooldownMs = config.rateLimiting.cooldownMs;
                }
                logger.info(`[ADMIN] Rate limiting actualizado: ${JSON.stringify(config.rateLimiting)}`);
                break;

            case 'chunking':
                if (data.enabled !== undefined) config.whatsapp.chunking.enabled = Boolean(data.enabled);
                if (data.maxChunkLength !== undefined) config.whatsapp.chunking.maxChunkLength = parseInt(data.maxChunkLength);
                if (data.delayBetweenChunksMs !== undefined) config.whatsapp.chunking.delayBetweenChunksMs = parseInt(data.delayBetweenChunksMs);
                if (data.typingIndicatorMs !== undefined) config.whatsapp.chunking.typingIndicatorMs = parseInt(data.typingIndicatorMs);
                logger.info(`[ADMIN] Chunking actualizado: ${JSON.stringify(config.whatsapp.chunking)}`);
                break;

            case 'gemini':
                if (data.temperature !== undefined) config.gemini.generationConfig.temperature = parseFloat(data.temperature);
                if (data.maxOutputTokens !== undefined) config.gemini.generationConfig.maxOutputTokens = parseInt(data.maxOutputTokens);
                if (data.timeout !== undefined) config.gemini.timeout = parseInt(data.timeout);
                if (data.failureThreshold !== undefined) config.gemini.circuitBreaker.failureThreshold = parseInt(data.failureThreshold);
                if (data.recoveryTimeMs !== undefined) config.gemini.circuitBreaker.recoveryTimeMs = parseInt(data.recoveryTimeMs);
                logger.info(`[ADMIN] Gemini config actualizado`);
                break;

            case 'conversation':
                if (data.maxHistoryMessages !== undefined) config.conversation.maxHistoryMessages = parseInt(data.maxHistoryMessages);
                if (data.inactivityTimeoutMs !== undefined) config.conversation.inactivityTimeoutMs = parseInt(data.inactivityTimeoutMs);
                logger.info(`[ADMIN] Conversation config actualizado: ${JSON.stringify(config.conversation)}`);
                break;

            default:
                return res.status(400).json({ error: `Sección desconocida: "${section}"` });
        }

        res.json({ success: true, section, message: `Configuración de "${section}" actualizada correctamente` });

    } catch (error) {
        logger.error(`[ADMIN API] Error actualizando config: ${error.message}`);
        res.status(500).json({ error: 'Error actualizando configuración' });
    }
});

module.exports = router;
