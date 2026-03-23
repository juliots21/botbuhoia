/**
 * metrics.js — Sistema de métricas y analíticas de rendimiento
 * Registra latencias, contadores y estadísticas del sistema en tiempo real
 */

class Metrics {
    constructor() {
        this.startTime = Date.now();
        this.counters = {
            messagesReceived: 0,
            messagesProcessed: 0,
            messagesFailed: 0,
            geminiCalls: 0,
            geminiErrors: 0,
            geminiKeyRotations: 0,
            whatsappMessagesSent: 0,
            whatsappErrors: 0,
            rateLimitHits: 0,
            duplicateMessages: 0,
            securityBlocked: 0
        };

        // Histograma de latencia de respuesta (en ms)
        this.responseLatencies = [];
        this.maxLatencySamples = 1000; // Mantener últimas 1000 muestras

        // Contadores por período (para calcular tasas)
        this.periodicCounters = {
            lastReset: Date.now(),
            messagesThisPeriod: 0
        };

        // Reset de contadores periódicos cada minuto
        this.periodicInterval = setInterval(() => this.resetPeriodic(), 60000);
    }

    /**
     * Incrementa un contador específico
     */
    increment(counterName, amount = 1) {
        if (this.counters[counterName] !== undefined) {
            this.counters[counterName] += amount;
        }
    }

    /**
     * Registra una latencia de respuesta
     */
    recordLatency(latencyMs) {
        this.responseLatencies.push({
            value: latencyMs,
            timestamp: Date.now()
        });

        // Mantener solo las últimas N muestras
        if (this.responseLatencies.length > this.maxLatencySamples) {
            this.responseLatencies = this.responseLatencies.slice(-this.maxLatencySamples);
        }

        this.periodicCounters.messagesThisPeriod++;
    }

    /**
     * Calcula estadísticas de latencia
     */
    getLatencyStats() {
        if (this.responseLatencies.length === 0) {
            return { avg: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0, count: 0 };
        }

        const values = this.responseLatencies.map(l => l.value).sort((a, b) => a - b);
        const sum = values.reduce((acc, v) => acc + v, 0);
        const len = values.length;

        return {
            avg: Math.round(sum / len),
            min: values[0],
            max: values[len - 1],
            p50: values[Math.floor(len * 0.5)],
            p95: values[Math.floor(len * 0.95)],
            p99: values[Math.floor(len * 0.99)],
            count: len
        };
    }

    resetPeriodic() {
        this.periodicCounters = {
            lastReset: Date.now(),
            messagesThisPeriod: 0
        };
    }

    /**
     * Genera un reporte completo de métricas para el endpoint /health
     */
    getReport() {
        const uptimeMs = Date.now() - this.startTime;
        const uptimeHours = Math.round(uptimeMs / 3600000 * 100) / 100;
        const memUsage = process.memoryUsage();

        return {
            status: 'online',
            version: require('../../package.json').version,
            uptime: {
                ms: uptimeMs,
                hours: uptimeHours,
                human: this.formatUptime(uptimeMs)
            },
            memory: {
                rss: this.formatBytes(memUsage.rss),
                heapUsed: this.formatBytes(memUsage.heapUsed),
                heapTotal: this.formatBytes(memUsage.heapTotal),
                external: this.formatBytes(memUsage.external)
            },
            counters: { ...this.counters },
            latency: this.getLatencyStats(),
            throughput: {
                messagesPerMinute: this.periodicCounters.messagesThisPeriod,
                totalProcessed: this.counters.messagesProcessed
            },
            timestamp: new Date().toISOString()
        };
    }

    formatUptime(ms) {
        const hours = Math.floor(ms / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${hours}h ${minutes}m ${seconds}s`;
    }

    formatBytes(bytes) {
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }

    destroy() {
        clearInterval(this.periodicInterval);
    }
}

module.exports = new Metrics();
