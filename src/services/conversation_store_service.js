const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { HumanMessage, AIMessage, SystemMessage } = require('@langchain/core/messages');

const STORE_DIR = path.join(__dirname, '../../data/conversations');
const STORE_FILE = path.join(STORE_DIR, 'chat_history.json');

class ConversationStoreService {
    constructor() {
        this._cache = null;
        this._dirty = false;
        this._flushTimer = null;
        this._loadingPromise = null;
    }

    async _ensureStore() {
        await fs.promises.mkdir(STORE_DIR, { recursive: true });
        try {
            await fs.promises.access(STORE_FILE, fs.constants.F_OK);
        } catch (_) {
            await fs.promises.writeFile(STORE_FILE, JSON.stringify({ users: {} }, null, 2), 'utf8');
        }
    }

    async _loadStore() {
        if (this._cache) return this._cache;
        if (this._loadingPromise) return this._loadingPromise;

        this._loadingPromise = (async () => {
            try {
                await this._ensureStore();
                const raw = await fs.promises.readFile(STORE_FILE, 'utf8');
                const parsed = JSON.parse(raw || '{}');
                this._cache = {
                    users: parsed && typeof parsed === 'object' && parsed.users && typeof parsed.users === 'object'
                        ? parsed.users
                        : {}
                };
            } catch (error) {
                logger.error(`[CONV_STORE] Error cargando historial persistido: ${error.message}`);
                this._cache = { users: {} };
            } finally {
                this._loadingPromise = null;
            }

            return this._cache;
        })();

        return this._loadingPromise;
    }

    _scheduleFlush() {
        this._dirty = true;

        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
        }

        this._flushTimer = setTimeout(() => {
            this._flushTimer = null;
            this._flush().catch((error) => {
                logger.error(`[CONV_STORE] Error en flush asincrono: ${error.message}`);
            });
        }, 250);
    }

    async _flush() {
        if (!this._dirty) return;

        try {
            await this._ensureStore();
            await fs.promises.writeFile(
                STORE_FILE,
                JSON.stringify(this._cache || { users: {} }, null, 2),
                'utf8'
            );
            this._dirty = false;
        } catch (error) {
            logger.error(`[CONV_STORE] Error guardando historial persistido: ${error.message}`);
        }
    }

    _serializeMessage(msg) {
        const type = typeof msg?._getType === 'function'
            ? msg._getType()
            : (msg?.type || 'human');

        const content = typeof msg?.content === 'string'
            ? msg.content
            : JSON.stringify(msg?.content ?? '');

        return {
            type,
            content
        };
    }

    _deserializeMessage(record) {
        const type = String(record?.type || 'human').toLowerCase();
        const content = String(record?.content || '');

        if (type === 'ai') return new AIMessage(content);
        if (type === 'system') return new SystemMessage(content);
        return new HumanMessage(content);
    }

    async hydrateChatHistory(phone, chatHistory) {
        if (!phone || !chatHistory || typeof chatHistory.addMessage !== 'function') {
            return { lastActivity: Date.now(), messageCount: 0 };
        }

        const store = await this._loadStore();
        const entry = store.users[String(phone)] || null;
        if (!entry || !Array.isArray(entry.messages) || entry.messages.length === 0) {
            return { lastActivity: Date.now(), messageCount: 0 };
        }

        for (const item of entry.messages) {
            await chatHistory.addMessage(this._deserializeMessage(item));
        }

        return {
            lastActivity: Number(entry.lastActivity || Date.now()),
            messageCount: Number(entry.messageCount || 0)
        };
    }

    async persistChatHistory(phone, chatHistory, metadata = {}) {
        if (!phone || !chatHistory || typeof chatHistory.getMessages !== 'function') return;

        const messages = await chatHistory.getMessages();
        const store = await this._loadStore();

        store.users[String(phone)] = {
            lastActivity: Number(metadata.lastActivity || Date.now()),
            messageCount: Number(metadata.messageCount || 0),
            messages: Array.isArray(messages)
                ? messages.map((msg) => this._serializeMessage(msg))
                : []
        };

        this._scheduleFlush();
    }

    async clearUserHistory(phone) {
        const normalized = String(phone || '').trim();
        if (!normalized) return false;

        const store = await this._loadStore();
        if (!store.users[normalized]) {
            return false;
        }

        delete store.users[normalized];
        this._dirty = true;
        await this._flush();
        return true;
    }

    async pruneExpired(inactivityTimeoutMs) {
        const timeout = Number(inactivityTimeoutMs || 0);
        if (!timeout || timeout <= 0) return;

        const store = await this._loadStore();
        const now = Date.now();
        let deleted = 0;

        for (const [phone, entry] of Object.entries(store.users)) {
            const lastActivity = Number(entry?.lastActivity || 0);
            if (lastActivity > 0 && (now - lastActivity) > timeout) {
                delete store.users[phone];
                deleted++;
            }
        }

        if (deleted > 0) {
            logger.debug(`[CONV_STORE] Historiales persistidos limpiados: ${deleted}`);
            this._scheduleFlush();
        }
    }

    async destroy() {
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }

        await this._flush();
    }
}

module.exports = new ConversationStoreService();
