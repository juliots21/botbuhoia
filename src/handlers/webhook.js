const express = require('express');
const router = express.Router();
const config = require('../../config');
const logger = require('../utils/logger');
const botHandler = require('./bot_handler');
const metrics = require('../utils/metrics');

/**
 * Extrae de forma segura los datos relevantes del payload de Meta
 * Evita errores de acceso a propiedades undefined con optional chaining
 */
function extractMessageData(body) {
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    return {
        messages: value?.messages || [],
        statuses: value?.statuses || [],
        contacts: value?.contacts || [],
        metadata: value?.metadata || {}
    };
}

// GET: Verificación del Webhook por parte de Meta
router.get('/', (req, res) => {
    logger.debug('[WEBHOOK] Petición GET de Verificación recibida');

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
            logger.info('[WEBHOOK] ✓ Webhook verificado correctamente por Meta');
            res.status(200).send(challenge);
        } else {
            logger.warn('[WEBHOOK] ❌ Verificación fallida. Token no coincide.');
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
});

// POST: Recepción de Eventos/Mensajes entrantes
router.post('/', (req, res) => {
    // Meta exige un 200 OK temprano ("Ack") para saber que recibimos el payload
    res.sendStatus(200);

    try {
        const body = req.body;

        if (body.object !== 'whatsapp_business_account') {
            logger.debug('[WEBHOOK] Payload ignorado: no es whatsapp_business_account');
            return;
        }

        const { messages, statuses, contacts } = extractMessageData(body);

        // Procesar mensajes entrantes
        for (const message of messages) {
            const from = message.from;
            const messageId = message.id;
            const contact = contacts.find(c => c.wa_id === from);
            const userName = contact && contact.profile && contact.profile.name ? contact.profile.name : '';

            if (message.type === 'text') {
                const text = message.text.body;
                logger.info(`[WEBHOOK] 📨 Mensaje de texto de ${from} (${userName}): "${text}"`);

                // Procesamiento asíncrono optimizado con cola y dedup
                botHandler.handleIncomingMessage(from, text, messageId, userName).catch(err => {
                    logger.error(`[BOT] Error procesando mensaje de ${from}: ${err.message}`);
                });
            } else if (message.type === 'image') {
                logger.info(`[WEBHOOK] 🖼️ Imagen recibida de ${from} (${userName})`);
                botHandler.handleIncomingImage(from, message.image || {}, messageId, userName).catch(err => {
                    logger.error(`[BOT] Error procesando imagen de ${from}: ${err.message}`);
                });
            } else {
                // Manejar tipos no soportados con respuesta informativa
                logger.debug(`[WEBHOOK] Mensaje tipo "${message.type}" de ${from}`);
                botHandler.handleUnsupportedMessage(from, message.type, messageId).catch(err => {
                    logger.error(`[BOT] Error manejando mensaje no soportado de ${from}: ${err.message}`);
                });
            }
        }

        // Log de actualizaciones de estado (sent, delivered, read)
        for (const status of statuses) {
            logger.debug(`[WEBHOOK] Status: Mensaje ${status.id} → ${status.status}`);
        }

    } catch (error) {
        logger.error(`[WEBHOOK] Error crítico procesando payload POST: ${error.stack}`);
    }
});

module.exports = router;
