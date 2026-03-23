/**
 * knowledge_loader.js — Cargador dinámico de base de conocimiento desde JSON
 * Lee todos los archivos JSON del directorio data/knowledge/ y los combina
 * en un prompt de sistema para Gemini
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const KNOWLEDGE_DIR = path.join(__dirname, '../../data/knowledge');

class KnowledgeLoader {
    constructor() {
        this._cachedKnowledge = null;
        this._lastLoadTime = 0;
        this._cacheTTLMs = 60000; // Recargar cada 1 minuto
    }

    /**
     * Carga y combina todos los archivos JSON de conocimiento
     * en un string formateado para usar como prompt de sistema
     */
    load() {
        const now = Date.now();

        // Usar caché si es reciente
        if (this._cachedKnowledge && (now - this._lastLoadTime) < this._cacheTTLMs) {
            return this._cachedKnowledge;
        }

        try {
            if (!fs.existsSync(KNOWLEDGE_DIR)) {
                logger.warn('[KNOWLEDGE] Directorio de conocimiento no encontrado. Usando conocimiento por defecto.');
                return this._getDefaultKnowledge();
            }

            const files = fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith('.json'));

            if (files.length === 0) {
                logger.warn('[KNOWLEDGE] No hay archivos JSON de conocimiento. Usando conocimiento por defecto.');
                return this._getDefaultKnowledge();
            }

            let knowledgeText = `Eres la IA oficial de atención al cliente, soporte y ventas de los productos de Digital Buho: "ia-buho". A continuación tienes la base de conocimiento actualizada sobre cada producto:\n\n`;

            for (const file of files) {
                try {
                    const filePath = path.join(KNOWLEDGE_DIR, file);
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                    const productName = data.sitio || file.replace('.json', '');

                    knowledgeText += `═══════════════════════════════════════\n`;
                    knowledgeText += `📦 PRODUCTO: ${productName}\n`;
                    knowledgeText += `═══════════════════════════════════════\n`;
                    knowledgeText += this._formatJSON(data);
                    knowledgeText += `\n\n`;

                } catch (error) {
                    logger.error(`[KNOWLEDGE] Error leyendo ${file}: ${error.message}`);
                }
            }

            knowledgeText += this._getRules();

            this._cachedKnowledge = knowledgeText;
            this._lastLoadTime = now;

            logger.debug(`[KNOWLEDGE] Base de conocimiento cargada: ${files.length} fuentes, ${knowledgeText.length} caracteres`);
            return knowledgeText;

        } catch (error) {
            logger.error(`[KNOWLEDGE] Error cargando conocimiento: ${error.message}`);
            return this._getDefaultKnowledge();
        }
    }

    /**
     * Formatea un objeto JSON en texto legible para el prompt
     */
    _formatJSON(data, indent = 0) {
        let text = '';
        const prefix = '  '.repeat(indent);

        for (const [key, value] of Object.entries(data)) {
            // Saltar campos internos de scraping
            if (['contenido_extraido', 'ultima_verificacion', 'nota_scraping'].includes(key)) continue;

            const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

            if (typeof value === 'string') {
                text += `${prefix}• ${label}: ${value}\n`;
            } else if (typeof value === 'number') {
                text += `${prefix}• ${label}: ${value}\n`;
            } else if (typeof value === 'boolean') {
                text += `${prefix}• ${label}: ${value ? 'Sí' : 'No'}\n`;
            } else if (Array.isArray(value)) {
                text += `${prefix}• ${label}:\n`;
                for (const item of value) {
                    if (typeof item === 'string') {
                        text += `${prefix}  - ${item}\n`;
                    } else if (typeof item === 'object') {
                        text += `${prefix}  ─────\n`;
                        text += this._formatJSON(item, indent + 2);
                    }
                }
            } else if (typeof value === 'object' && value !== null) {
                text += `${prefix}• ${label}:\n`;
                text += this._formatJSON(value, indent + 1);
            }
        }

        return text;
    }

    /**
     * Reglas del bot (siempre se agregan al final)
     */
    _getRules() {
        return `
═══════════════════════════════════════
📋 REGLAS DEL BOT
═══════════════════════════════════════
- eres el asesor virtual experto de Digital Buho.
- Si el usuario reporta un error técnico, indícale amablemente que informarás al equipo de soporte.
- Utiliza SOLO la información proporcionada en tu base de conocimiento.
- SÉ BREVE, CLARO Y PROFESIONAL. Responde de forma amigable y servicial, pero NUNCA te excedas en halagos.
- VE DIRECTO AL GRANO: No repitas toda la base de datos de los productos si el usuario hizo una pregunta de una sola línea.
- FORMATO WHATSAPP ESTRICTO: El asterisco (*) DEBE estar pegado a la palabra (ejemplo: *Hola*).
- ALERTA DE PAGOS: ⛔ NO des los números de cuenta ni pidas depósitos a menos que el cliente diga EXPLÍCITAMENTE frases como "dónde pago", "dame tu cuenta", "quiero comprarlo ya" o "número de yape". ¡Preguntar si el sistema genera facturas NO es querer pagar!
- Si el cliente efectivamente pide los datos de cuenta o yape de forma directa, responde OBLIGATORIAMENTE con estos datos:
-- Sé AMABLE y cálido. Usa EMOJIS, especialmente caritas (😊, 😄, 🙌, 😉, ✨, ,😁 ,😉 ,🙌,🫶📝) no tienes permitido usar otro tipo de emojis.. amenos que sean titulos o cosas muy puntale...
- HAZ PREGUNTAS A Y CERRADAS: Al final de cada respuesta importante, siempre termina con una pregunta amigable para mantener la conversación viva. 

Datos de Pago (DIGITAL BUHO S.A.C.):
*BCP* - Cuenta Corriente en Soles (S/)
- Número: 191-2562765-0-13
- CCI: 002-19100-2562765-013-55
*YAPE:* 944 999 965
`;
    }

    /**
     * Conocimiento por defecto si no hay archivos JSON
     */
    _getDefaultKnowledge() {
        return `Eres la IA oficial de atención al cliente, de Digital Buho para Perú.

Reglas:
- Sé amable y usa formato WhatsApp.
- Para más info, dirige al usuario a contactar por WhatsApp: +51 944 999 965.
`;
    }

    /**
     * Fuerza una recarga del conocimiento (invalida caché)
     */
    invalidateCache() {
        this._cachedKnowledge = null;
        this._lastLoadTime = 0;
        logger.info('[KNOWLEDGE] Caché de conocimiento invalidada');
    }

    /**
     * Obtiene estadísticas del loader
     */
    getStats() {
        const files = fs.existsSync(KNOWLEDGE_DIR) ?
            fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith('.json')) : [];

        return {
            totalSources: files.length,
            files: files,
            cacheActive: !!this._cachedKnowledge,
            lastLoadTime: this._lastLoadTime ? new Date(this._lastLoadTime).toISOString() : null,
            characterCount: this._cachedKnowledge ? this._cachedKnowledge.length : 0
        };
    }
}

module.exports = new KnowledgeLoader();
