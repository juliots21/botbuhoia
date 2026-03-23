const express = require('express');
const path = require('path');
const config = require('./config');
const logger = require('./src/utils/logger');
const metrics = require('./src/utils/metrics');
const webhookRoutes = require('./src/handlers/webhook');
const adminApiRoutes = require('./src/handlers/admin_api');
const { validateMetaSignature, captureRawBody } = require('./src/middleware/security');
const geminiService = require('./src/services/gemini_service');
const botHandler = require('./src/handlers/bot_handler');
const rateLimiter = require('./src/utils/rate_limiter');
const messageQueue = require('./src/utils/message_queue');

// Inicializar la aplicación Express
const app = express();

// Middleware para capturar raw body (necesario para validación de firma HMAC)
app.use(express.json({
    limit: '1mb',
    verify: captureRawBody
}));

// Servir archivos estáticos del panel de administración
app.use(express.static(path.join(__dirname, 'public')));

// Middleware de seguridad — Validación de firma de Meta (solo en /webhook POST)
app.use('/webhook', (req, res, next) => {
    if (req.method === 'POST') {
        return validateMetaSignature(req, res, next);
    }
    next();
});

// Endpoint de Health Check con métricas del sistema
app.get('/health', (req, res) => {
    try {
        const report = metrics.getReport();
        report.services = {
            gemini: geminiService.getStats(),
            bot: botHandler.getStats(),
            rateLimiter: rateLimiter.getStats(),
            queue: messageQueue.getStats()
        };
        res.json(report);
    } catch (error) {
        logger.error(`[HEALTH] Error generando reporte: ${error.message}`);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// API de administración (configuración en caliente)
app.use('/api', adminApiRoutes);

// Webhook routes
app.use('/webhook', webhookRoutes);

// Iniciar servidor HTTP
const host = process.env.IP || '::';
const server = app.listen(config.port, host, () => {
    logger.info(`=======================================================`);
    logger.info(`🦉 Servidor ia-buho v2.0 iniciado en el puerto ${config.port} host ${host}`);
    logger.info(`⚙️  Entorno: ${config.nodeEnv}`);
    logger.info(`🌐 Panel:   / (Dashboard de administración)`);
    logger.info(`🔗 Webhook: /webhook (GET verificación / POST eventos)`);
    logger.info(`📊 Health:  /health (Métricas y estado del sistema)`);
    logger.info(`🔧 API:     /api/config (GET / PUT configuración)`);
    logger.info(`🔑 API Keys Gemini configuradas: ${config.gemini.apiKeys.length}`);
    logger.info(`🛡️  Seguridad HMAC: ${config.security.appSecret ? 'ACTIVADA' : 'DESACTIVADA (modo desarrollo)'}`);
    logger.info(`⚡ Rate Limiting: ${config.rateLimiting.maxMessagesPerWindow} msgs/${config.rateLimiting.windowSizeMs / 1000}s`);
    logger.info(`📝 Chunking: ${config.whatsapp.chunking.enabled ? 'ACTIVADO' : 'DESACTIVADO'} (max ${config.whatsapp.chunking.maxChunkLength} chars/chunk)`);
    logger.info(`=======================================================`);
});

// ═══════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN — Cierre limpio del servidor
// ═══════════════════════════════════════════════════════

function gracefulShutdown(signal) {
    logger.info(`[SHUTDOWN] Señal ${signal} recibida. Iniciando cierre limpio...`);

    server.close(() => {
        logger.info('[SHUTDOWN] Servidor HTTP cerrado.');

        try {
            rateLimiter.destroy();
            messageQueue.destroy();
            metrics.destroy();
            botHandler.destroy();
            logger.info('[SHUTDOWN] Recursos limpiados correctamente.');
        } catch (error) {
            logger.error(`[SHUTDOWN] Error limpiando recursos: ${error.message}`);
        }

        logger.info('[SHUTDOWN] ✓ Cierre limpio completado. Adiós. 🦉');
        process.exit(0);
    });

    setTimeout(() => {
        logger.error('[SHUTDOWN] Cierre forzado por timeout (10s).');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
    logger.error(`[CRITICAL] Excepción no capturada: ${error.stack}`);
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
    logger.error(`[CRITICAL] Promesa rechazada no manejada: ${reason}`);
});
