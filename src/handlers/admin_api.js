const express = require('express');
const router = express.Router();
const config = require('../../config');
const logger = require('../utils/logger');
const botHandler = require('./bot_handler');
const userSettingsService = require('../services/user_settings_service');

/**
 * GET /api/config — Devuelve la configuración actual (sin datos sensibles)
 */
router.get('/config', async (req, res) => {
    try {
        await userSettingsService.initialize();
        res.json({
            defaults: userSettingsService.getDefaults(),
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
router.put('/config', async (req, res) => {
    try {
        await userSettingsService.initialize();
        const { section, data } = req.body;

        if (!section || !data) {
            return res.status(400).json({ error: 'Se requiere "section" y "data"' });
        }

        switch (section) {
            case 'conversation':
                if (data.maxHistoryMessages !== undefined) config.conversation.maxHistoryMessages = parseInt(data.maxHistoryMessages);
                if (data.inactivityTimeoutMs !== undefined) config.conversation.inactivityTimeoutMs = parseInt(data.inactivityTimeoutMs);
                await userSettingsService.persistGlobalConversation('admin_api');
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

/**
 * GET /api/users — Lista usuarios conocidos por el bot
 */
router.get('/users', async (req, res) => {
    try {
        await userSettingsService.initialize();
        res.json({ users: botHandler.getUsers() });
    } catch (error) {
        logger.error(`[ADMIN API] Error listando usuarios: ${error.message}`);
        res.status(500).json({ error: 'Error interno' });
    }
});

/**
 * GET /api/users/:phone/config — Obtiene configuración efectiva por usuario
 */
router.get('/users/:phone/config', async (req, res) => {
    try {
        await userSettingsService.initialize();
        const phone = String(req.params.phone || '').trim();
        if (!phone) {
            return res.status(400).json({ error: 'Número inválido' });
        }

        const profile = userSettingsService.touchUser(phone);
        const settings = userSettingsService.getUserSettings(phone);

        res.json({
            user: profile,
            settings
        });
    } catch (error) {
        logger.error(`[ADMIN API] Error obteniendo configuración de usuario: ${error.message}`);
        res.status(500).json({ error: 'Error interno' });
    }
});

/**
 * PUT /api/users/:phone/config — Actualiza rate limiting + gemini por usuario
 */
router.put('/users/:phone/config', async (req, res) => {
    try {
        await userSettingsService.initialize();
        const phone = String(req.params.phone || '').trim();
        const { section, data } = req.body;

        const toFiniteInt = (value) => {
            if (value === undefined || value === null || value === '') return undefined;
            const n = Number(value);
            if (!Number.isFinite(n)) return undefined;
            return Math.trunc(n);
        };

        const toFiniteFloat = (value) => {
            if (value === undefined || value === null || value === '') return undefined;
            const n = Number(value);
            if (!Number.isFinite(n)) return undefined;
            return n;
        };

        const clamp = (n, min, max) => {
            if (!Number.isFinite(n)) return undefined;
            return Math.min(max, Math.max(min, n));
        };

        if (!phone) {
            return res.status(400).json({ error: 'Número inválido' });
        }
        if (!section || !data) {
            return res.status(400).json({ error: 'Se requiere "section" y "data"' });
        }

        if (!['rateLimiting', 'gemini'].includes(section)) {
            return res.status(400).json({ error: `Sección no permitida para usuario: "${section}"` });
        }

        const payload = section === 'rateLimiting'
            ? {
                rateLimiting: {
                    maxMessagesPerWindow: clamp(toFiniteInt(data.maxMessagesPerWindow), 1, 1000),
                    windowSizeMs: clamp(toFiniteInt(data.windowSizeMs), 1000, 3600000),
                    cooldownMs: clamp(toFiniteInt(data.cooldownMs), 1000, 3600000)
                }
            }
            : {
                gemini: {
                    temperature: clamp(toFiniteFloat(data.temperature), 0, 2),
                    maxOutputTokens: clamp(toFiniteInt(data.maxOutputTokens), 100, 8192),
                    timeout: clamp(toFiniteInt(data.timeout), 18000, 120000),
                    failureThreshold: clamp(toFiniteInt(data.failureThreshold), 1, 20),
                    recoveryTimeMs: clamp(toFiniteInt(data.recoveryTimeMs), 1000, 3600000)
                }
            };

        // Remover propiedades undefined para evitar sobreescrituras accidentales
        if (payload.rateLimiting) {
            payload.rateLimiting = Object.fromEntries(
                Object.entries(payload.rateLimiting).filter(([, value]) => value !== undefined)
            );
        }
        if (payload.gemini) {
            payload.gemini = Object.fromEntries(
                Object.entries(payload.gemini).filter(([, value]) => value !== undefined)
            );
        }

        if (section === 'gemini' && Object.keys(payload.gemini || {}).length === 0) {
            return res.status(400).json({ error: 'No se detectaron valores Gemini válidos para guardar' });
        }
        if (section === 'rateLimiting' && Object.keys(payload.rateLimiting || {}).length === 0) {
            return res.status(400).json({ error: 'No se detectaron valores de rate limiting válidos para guardar' });
        }

        const settings = await userSettingsService.upsertUserSettings(phone, payload);
        logger.info(`[ADMIN] Config por usuario actualizada para ${phone} (${section})`);

        res.json({
            success: true,
            phone,
            section,
            settings,
            message: `Configuración de ${section} actualizada para ${phone}`
        });
    } catch (error) {
        logger.error(`[ADMIN API] Error actualizando config por usuario: ${error.message}`);
        res.status(500).json({ error: 'Error actualizando configuración de usuario' });
    }
});

module.exports = router;
