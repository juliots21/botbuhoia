/**
 * rate_limiter.js — Sliding window rate limiter por usuario
 * Controla el flujo de mensajes para evitar abuso y saturación del bot
 */

const logger = require('./logger');
const config = require('../../config');

class RateLimiter {
    constructor() {
        this.windows = new Map(); // phone -> [timestamp, timestamp, ...]
        this.maxMessages = config.rateLimiting.maxMessagesPerWindow;
        this.windowSizeMs = config.rateLimiting.windowSizeMs;
        this.cooldownMs = config.rateLimiting.cooldownMs;

        // Limpieza periódica de ventanas expiradas cada 5 minutos
        this.cleanupInterval = setInterval(() => this.cleanup(), 300000);
    }

    /**
     * Verifica si un usuario puede enviar un mensaje
     * @param {string} userPhone - Número de teléfono del usuario
     * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number }}
     */
    check(userPhone) {
        const now = Date.now();
        let timestamps = this.windows.get(userPhone) || [];

        // Filtrar solo los timestamps dentro de la ventana activa
        timestamps = timestamps.filter(ts => now - ts < this.windowSizeMs);

        if (timestamps.length >= this.maxMessages) {
            const oldestInWindow = timestamps[0];
            const retryAfterMs = this.windowSizeMs - (now - oldestInWindow);

            logger.warn(`[RATE_LIMITER] Usuario ${userPhone} excedió el límite: ${timestamps.length}/${this.maxMessages} mensajes en ventana`);

            return {
                allowed: false,
                remaining: 0,
                retryAfterMs: Math.max(retryAfterMs, this.cooldownMs)
            };
        }

        // Registrar el timestamp del mensaje actual
        timestamps.push(now);
        this.windows.set(userPhone, timestamps);

        const remaining = this.maxMessages - timestamps.length;
        logger.debug(`[RATE_LIMITER] ${userPhone}: ${timestamps.length}/${this.maxMessages} mensajes (quedan ${remaining})`);

        return {
            allowed: true,
            remaining,
            retryAfterMs: 0
        };
    }

    /**
     * Limpia ventanas expiradas para liberar memoria
     */
    cleanup() {
        const now = Date.now();
        let cleaned = 0;

        for (const [phone, timestamps] of this.windows.entries()) {
            const active = timestamps.filter(ts => now - ts < this.windowSizeMs);
            if (active.length === 0) {
                this.windows.delete(phone);
                cleaned++;
            } else {
                this.windows.set(phone, active);
            }
        }

        if (cleaned > 0) {
            logger.debug(`[RATE_LIMITER] Limpieza: ${cleaned} ventanas expiradas eliminadas`);
        }
    }

    /**
     * Obtiene estadísticas del rate limiter
     */
    getStats() {
        return {
            activeUsers: this.windows.size,
            config: {
                maxMessagesPerWindow: this.maxMessages,
                windowSizeMs: this.windowSizeMs
            }
        };
    }

    destroy() {
        clearInterval(this.cleanupInterval);
    }
}

module.exports = new RateLimiter();
