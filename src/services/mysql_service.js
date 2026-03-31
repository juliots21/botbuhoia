const mysql = require('mysql2/promise');
const config = require('../../config');
const logger = require('../utils/logger');

class MySQLService {
    constructor() {
        this.pool = null;
        this.lastError = null;
        this.lastConnectedAt = null;
    }

    isConfigured() {
        const db = config.mysql || {};
        return Boolean(db.host && db.user && db.database);
    }

    getConnectionConfig() {
        const db = config.mysql || {};
        return {
            host: db.host,
            port: db.port,
            user: db.user,
            password: db.password,
            database: db.database,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            charset: 'utf8mb4',
            timezone: 'Z',
            namedPlaceholders: true
        };
    }

    async connect() {
        if (!this.isConfigured()) {
            this.lastError = 'MySQL no configurado (DB_HOST, DB_USER, DB_NAME).';
            logger.warn('[MYSQL] Conexion omitida: faltan variables DB_HOST, DB_USER o DB_NAME.');
            return false;
        }

        if (this.pool) {
            return true;
        }

        try {
            this.pool = mysql.createPool(this.getConnectionConfig());
            await this.pool.query('SELECT 1 AS ok');
            this.lastConnectedAt = Date.now();
            this.lastError = null;
            logger.info('[MYSQL] Conexion establecida correctamente.');
            return true;
        } catch (error) {
            this.lastError = error.message;
            this.pool = null;
            logger.error(`[MYSQL] Error conectando: ${error.message}`);
            return false;
        }
    }

    async query(sql, params = []) {
        if (!this.pool) {
            const connected = await this.connect();
            if (!connected) {
                throw new Error(this.lastError || 'No hay conexion MySQL disponible.');
            }
        }

        try {
            const [rows] = await this.pool.query(sql, params);
            return rows;
        } catch (error) {
            this.lastError = error.message;
            throw error;
        }
    }

    async execute(sql, params = []) {
        if (!this.pool) {
            const connected = await this.connect();
            if (!connected) {
                throw new Error(this.lastError || 'No hay conexion MySQL disponible.');
            }
        }

        try {
            const [result] = await this.pool.execute(sql, params);
            return result;
        } catch (error) {
            this.lastError = error.message;
            throw error;
        }
    }

    async health() {
        if (!this.isConfigured()) {
            return {
                configured: false,
                connected: false,
                error: 'Variables DB_* no configuradas',
                lastConnectedAt: this.lastConnectedAt
            };
        }

        if (!this.pool) {
            return {
                configured: true,
                connected: false,
                error: this.lastError || 'Pool no inicializado',
                lastConnectedAt: this.lastConnectedAt
            };
        }

        try {
            await this.pool.query('SELECT 1 AS ok');
            return {
                configured: true,
                connected: true,
                error: null,
                lastConnectedAt: this.lastConnectedAt
            };
        } catch (error) {
            this.lastError = error.message;
            return {
                configured: true,
                connected: false,
                error: error.message,
                lastConnectedAt: this.lastConnectedAt
            };
        }
    }

    async close() {
        if (!this.pool) return;

        try {
            await this.pool.end();
            logger.info('[MYSQL] Pool cerrado correctamente.');
        } catch (error) {
            logger.error(`[MYSQL] Error cerrando pool: ${error.message}`);
        } finally {
            this.pool = null;
        }
    }
}

module.exports = new MySQLService();
