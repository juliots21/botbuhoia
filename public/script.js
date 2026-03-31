const API_BASE = window.location.origin;
const ADMIN_TOKEN_STORAGE_KEY = 'iaBuhoAdminApiToken';
const DEBUG_MAX_LINES = 220;

let selectedUserPhone = '';
let adminToken = '';
let debugEnabled = true;
let debugLines = [];
let lastHealthPayload = null;
let lastCutoffLoggedAt = 0;
let lastRequestDebugId = '';

function debugLog(message, data = null, level = 'log') {
    if (!debugEnabled) return;

    const ts = new Date().toLocaleTimeString();
    const serialized = data ? ' | ' + JSON.stringify(data) : '';
    const line = `[${ts}] ${String(message || '')}${serialized}`;

    debugLines.push(line);
    if (debugLines.length > DEBUG_MAX_LINES) {
        debugLines = debugLines.slice(debugLines.length - DEBUG_MAX_LINES);
    }

    const box = document.getElementById('debugConsole');
    if (box) {
        box.textContent = debugLines.join('\n');
        box.scrollTop = box.scrollHeight;
    }

    if (level === 'error') {
        console.error('[INDEX DEBUG]', message, data || '');
    } else if (level === 'warn') {
        console.warn('[INDEX DEBUG]', message, data || '');
    } else {
        console.log('[INDEX DEBUG]', message, data || '');
    }
}

function clearDebugConsole() {
    debugLines = [];
    const box = document.getElementById('debugConsole');
    if (box) box.textContent = '';
    debugLog('Consola debug limpiada manualmente.');
}

async function copyDebugConsole() {
    try {
        const text = debugLines.join('\n');
        await navigator.clipboard.writeText(text || 'Sin logs en consola debug.');
        showToast('Consola debug copiada');
    } catch (_) {
        showToast('No se pudo copiar la consola debug');
    }
}

function toggleDebugConsole() {
    debugEnabled = !debugEnabled;
    const btn = document.getElementById('debugToggleBtn');
    if (btn) {
        btn.textContent = debugEnabled ? 'Debug ON' : 'Debug OFF';
        btn.classList.toggle('active', debugEnabled);
    }
    if (debugEnabled) {
        debugLog('Debug reactivado.');
    }
}

function getStoredAdminToken() {
    return String(localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || '').trim();
}

function setStoredAdminToken(token) {
    const value = String(token || '').trim();
    if (!value) {
        localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
        return;
    }

    localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, value);
}

function updateAdminTokenStatus() {
    const status = document.getElementById('adminTokenStatus');
    const input = document.getElementById('adminTokenInput');
    const hasToken = Boolean(adminToken);
    
    if (status) {
        status.textContent = hasToken
            ? '✅ Protegido por Token'
            : '⚠️ Sin Token configurado';
        status.className = hasToken ? 'status-text success' : 'status-text warning';
    }
    
    if (input) {
        input.value = adminToken;
    }
}

function ensureAdminToken() {
    adminToken = getStoredAdminToken();
    if (adminToken) return true;

    const entered = window.prompt('Ingresa tu ADMIN_API_TOKEN para usar el panel:');
    if (!entered) {
        updateAdminTokenStatus();
        return false;
    }

    adminToken = String(entered).trim();
    setStoredAdminToken(adminToken);
    updateAdminTokenStatus();
    return Boolean(adminToken);
}

function saveAdminToken() {
    const input = document.getElementById('adminTokenInput');
    const value = String(input?.value || '').trim();
    adminToken = value;
    setStoredAdminToken(value);
    updateAdminTokenStatus();
    showToast(value ? 'Token guardado' : 'Token eliminado');
}

function buildAuthHeaders(base = {}) {
    const headers = { ...base };
    if (adminToken) {
        headers['Authorization'] = 'Bearer ' + adminToken;
        headers['X-Admin-Token'] = adminToken;
    }
    return headers;
}

async function fetchJSON(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const t0 = Date.now();
    debugLog(`HTTP ${method} ${url} -> inicio`);

    const customHeaders = options.headers || {};
    const body = options.body;
    const defaultHeaders = body !== undefined
        ? { 'Content-Type': 'application/json' }
        : {};

    const res = await fetch(API_BASE + url, {
        ...options,
        headers: buildAuthHeaders({ ...defaultHeaders, ...customHeaders })
    });

    if (!res.ok) {
        let payload = null;
        try {
            payload = await res.json();
        } catch (_) {
            payload = null;
        }

        const serverMessage = payload && payload.error ? String(payload.error) : '';
        debugLog(`HTTP ${method} ${url} -> error ${res.status}`, {
            status: res.status,
            elapsedMs: Date.now() - t0,
            error: serverMessage || ('HTTP ' + res.status)
        }, 'error');
        if (res.status === 401 || res.status === 403) {
            throw new Error(serverMessage || 'No autorizado: revisa ADMIN_API_TOKEN');
        }
        throw new Error(serverMessage || ('HTTP ' + res.status));
    }
    const payload = await res.json();
    debugLog(`HTTP ${method} ${url} -> ok`, {
        status: res.status,
        elapsedMs: Date.now() - t0
    });
    return payload;
}

async function openSecuredEndpoint(path) {
    try {
        if (!adminToken && !ensureAdminToken()) {
            showToast('Necesitas token para abrir ese endpoint');
            return;
        }

        const data = await fetchJSON(path);
        const popup = window.open('', '_blank', 'noopener,noreferrer');
        if (!popup) {
            showToast('Activa ventanas emergentes para abrir la respuesta');
            return;
        }

        popup.document.write(`
            <style>
                body { background: #000; color: #a4b1cd; font-family: 'Inter', monospace; padding: 2rem; }
                pre { background: #0a0a0f; padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(138, 43, 226, 0.2); }
            </style>
            <pre>${JSON.stringify(data, null, 2).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
        `);
        popup.document.close();
    } catch (err) {
        debugLog('openSecuredEndpoint fallo', { path, error: err.message || String(err) }, 'error');
        showToast(err.message || 'No se pudo abrir endpoint protegido');
    }
}

function showToast(message) {
    const wrap = document.getElementById('toastWrap');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'toast show';
    el.textContent = message;
    wrap.appendChild(el);
    
    // React-like mount effect
    requestAnimationFrame(() => {
        el.style.opacity = '1';
        el.style.transform = 'translateY(0) scale(1)';
    });

    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px) scale(0.95)';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

function formatTs(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString();
}

// Actualiza los values y lanza un pulse effect si cambiaron
function setInputValueWithEffect(id, newValue) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.value != newValue) {
        el.value = newValue;
        el.classList.add('pulse-effect');
        setTimeout(() => el.classList.remove('pulse-effect'), 500);
    }
}

function setTextContentWithEffect(id, newText) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.textContent != newText) {
        el.textContent = newText;
        el.classList.add('pulse-text');
        setTimeout(() => el.classList.remove('pulse-text'), 500);
    }
}

async function loadGeneralConfig() {
    try {
        const cfg = await fetchJSON('/api/config');
        if(cfg && cfg.conversation) {
            setInputValueWithEffect('gConvoMaxHistory', cfg.conversation.maxHistoryMessages);
            setInputValueWithEffect('gConvoTimeout', cfg.conversation.inactivityTimeoutMs);
        }
    } catch (err) {
        showToast('No se pudo cargar configuracion global');
    }
}

async function saveGlobalConversation() {
    try {
        await fetchJSON('/api/config', {
            method: 'PUT',
            body: JSON.stringify({
                section: 'conversation',
                data: {
                    maxHistoryMessages: parseInt(document.getElementById('gConvoMaxHistory').value || 10),
                    inactivityTimeoutMs: parseInt(document.getElementById('gConvoTimeout').value || 600000)
                }
            })
        });
        showToast('Conversaciones global actualizada');
    } catch (err) {
        showToast('Error guardando configuracion global');
    }
}

async function loadUsers() {
    try {
        const data = await fetchJSON('/api/users');
        const users = data.users || [];
        const select = document.getElementById('userSelect');
        if(!select) return;

        if (users.length === 0) {
            select.innerHTML = '<option value="">Sin usuarios detectados</option>';
            return;
        }

        const currentVal = select.value;
        select.innerHTML = users.map((u) => {
            const name = u.userName ? ' - ' + u.userName : '';
            return `<option value="${u.phone}">${u.phone}${name}</option>`;
        }).join('');

        if (currentVal && users.some((u) => u.phone === currentVal)) {
            select.value = currentVal;
            selectedUserPhone = currentVal;
        } else if (!selectedUserPhone || !users.some((u) => u.phone === selectedUserPhone)) {
            selectedUserPhone = users[0].phone;
            select.value = selectedUserPhone;
        } else {
            select.value = selectedUserPhone;
        }

        await loadSelectedUserConfig();
    } catch (err) {
        showToast('No se pudo cargar usuarios');
    }
}

async function selectManualPhone() {
    const phone = String(document.getElementById('manualPhone').value || '').trim();
    if (!phone) {
        showToast('Ingresa un numero de WhatsApp');
        return;
    }

    selectedUserPhone = phone;
    await loadSelectedUserConfig();
    await loadUsers();
}

async function loadSelectedUserConfig() {
    const select = document.getElementById('userSelect');
    if(!select) return;
    const selected = String(select.value || selectedUserPhone || '').trim();

    if (!selected) {
        return;
    }

    selectedUserPhone = selected;

    try {
        const data = await fetchJSON('/api/users/' + encodeURIComponent(selectedUserPhone) + '/config');
        const s = data.settings;
        const user = data.user || {};

        if (s?.rateLimiting) {
            setInputValueWithEffect('uRateMax', s.rateLimiting.maxMessagesPerWindow);
            setInputValueWithEffect('uRateWindow', s.rateLimiting.windowSizeMs);
            setInputValueWithEffect('uRateCooldown', s.rateLimiting.cooldownMs);
        }

        if (s?.gemini) {
            setInputValueWithEffect('uGemTemp', s.gemini.temperature);
            setInputValueWithEffect('uGemTokens', s.gemini.maxOutputTokens);
            setInputValueWithEffect('uGemTimeout', s.gemini.timeout);
            setInputValueWithEffect('uGemFail', s.gemini.failureThreshold);
            setInputValueWithEffect('uGemRecovery', s.gemini.recoveryTimeMs);
        }

        const meta = [
            '📱 ' + selectedUserPhone,
            '👤 ' + (user.userName || 'N/D'),
            '📥 ' + (user.messagesReceived || 0),
            '⚙️ ' + (user.messagesProcessed || 0),
            '❌ ' + (user.messagesFailed || 0),
            '⏱️ ' + formatTs(user.lastSeenAt)
        ].join('  ·  ');
        setTextContentWithEffect('userMeta', meta);
    } catch (err) {
        // Silently fail if not found, to avoid spam
    }
}

async function saveUserSection(section) {
    if (!selectedUserPhone) {
        showToast('Selecciona un usuario primero');
        return;
    }

    let dataToSave = {};
    if (section === 'rateLimiting') {
        dataToSave = {
            maxMessagesPerWindow: parseInt(document.getElementById('uRateMax').value),
            windowSizeMs: parseInt(document.getElementById('uRateWindow').value),
            cooldownMs: parseInt(document.getElementById('uRateCooldown').value)
        };
    } else {
        dataToSave = {
            temperature: parseFloat(document.getElementById('uGemTemp').value),
            maxOutputTokens: parseInt(document.getElementById('uGemTokens').value),
            timeout: Math.max(parseInt(document.getElementById('uGemTimeout').value), 18000),
            failureThreshold: parseInt(document.getElementById('uGemFail').value),
            recoveryTimeMs: parseInt(document.getElementById('uGemRecovery').value)
        };
    }

    debugLog('Guardando configuracion de usuario', { phone: selectedUserPhone, section, data: dataToSave });

    try {
        const response = await fetchJSON('/api/users/' + encodeURIComponent(selectedUserPhone) + '/config', {
            method: 'PUT',
            body: JSON.stringify({ section, data: dataToSave })
        });
        showToast('Configuracion guardada para ' + selectedUserPhone);
        await loadSelectedUserConfig();
    } catch (err) {
        showToast('Error guardando: ' + (err.message || 'sin detalle'));
    }
}

function renderKeys(keys) {
    const body = document.getElementById('keysList');
    if(!body) return;
    
    if (!Array.isArray(keys) || keys.length === 0) {
        body.innerHTML = '<div class="clean-list-item" style="text-align: center; color: var(--on-surface-variant);">Sin keys configuradas</div>';
        return;
    }

    body.innerHTML = keys.map((k) => {
        const activeBadge = k.active 
            ? '<span class="color-ok">● Activa</span>' 
            : '<span class="color-err">○ Inactiva</span>';
        return `<div class="clean-list-item">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong>${k.label || ('Key #' + k.index)}</strong>
                ${activeBadge}
            </div>
            <div style="display: flex; gap: 1.5rem; font-size: 0.75rem; margin-top: 6px;">
                <span>Calls: ${k.totalCalls || 0}</span>
                <span class="color-err">Errors: ${k.totalErrors || 0}</span>
                <span>Disabled until: ${formatTs(k.disabledUntil)}</span>
            </div>
            <div style="font-size: 0.7rem; color: var(--on-surface-variant); margin-top: 4px;">${k.lastError || 'Sin errores'}</div>
        </div>`;
    }).join('');
}

function renderTopUsers(users) {
    // No-op if no target element
}

function renderRecentErrors(errors) {
    // No-op if no target element
}

function formatCutoffReason(reason) {
    const labels = {
        NO_KEYS_CONFIGURED: 'No hay API keys configuradas',
        NO_AVAILABLE_KEYS: 'Circuit Breaker: Sin keys activas',
        TOTAL_BUDGET_EXHAUSTED: 'Agotado el presupuesto de tiempo',
        RESPONSE_TRUNCATED_TIMEOUT: 'Respuesta truncada por Timeout'
    };
    return labels[reason] || reason || 'No disponible';
}

function renderLastCutoff(cutoff) {
    // No-op if no target element
}

function renderLastRequestDebug(reqDebug) {
    if (!reqDebug || !reqDebug.requestId) return;
    if (reqDebug.requestId === lastRequestDebugId) return;
    lastRequestDebugId = reqDebug.requestId;
}

// =============================================
// CHAT MIRROR: Live Intelligence Stream
// =============================================
let chatMirrorLastCount = 0;
let chatMirrorTimer = null;

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatChatTime(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('es-PE', { 
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        day: '2-digit', month: 'short'
    });
}

async function loadChatMirror() {
    if (!selectedUserPhone) return;

    const stream = document.getElementById('chatStream');
    const phoneLabel = document.getElementById('chatPhoneLabel');
    if (!stream) return;

    if (phoneLabel) phoneLabel.textContent = selectedUserPhone;

    try {
        const data = await fetchJSON('/api/chat/' + encodeURIComponent(selectedUserPhone) + '?limit=150');
        const messages = data.messages || [];

        if (messages.length === 0) {
            stream.innerHTML = `
                <div class="chat-empty-state">
                    <span style="font-size: 2.5rem;">📭</span>
                    <p>No hay mensajes registrados para <strong>${escapeHtml(selectedUserPhone)}</strong> aún.</p>
                    <p style="font-size: 0.75rem;">Los mensajes aparecerán aquí cuando el usuario interactúe con el bot vía WhatsApp.</p>
                </div>
            `;
            chatMirrorLastCount = 0;
            return;
        }

        // Only re-render if count changed (performance optimization)
        if (messages.length === chatMirrorLastCount) return;
        chatMirrorLastCount = messages.length;

        stream.innerHTML = messages.map((msg, i) => {
            const dir = msg.direction === 'inbound' ? 'inbound' : 'outbound';
            const senderLabel = dir === 'inbound' ? '👤 Usuario' : '🦉 Buho AI';
            const time = formatChatTime(msg.created_at);
            const latencyBadge = msg.latency_ms 
                ? `<div class="bubble-latency">⚡ ${msg.latency_ms}ms</div>` 
                : '';

            return `<div class="chat-bubble ${dir}" style="animation-delay: ${Math.min(i * 0.03, 0.5)}s">
                <div class="bubble-meta">
                    <span class="bubble-sender">${senderLabel}</span>
                    <span class="bubble-time">${time}</span>
                </div>
                <div class="bubble-body">${escapeHtml(msg.body || '')}</div>
                ${latencyBadge}
            </div>`;
        }).join('');

        // Auto-scroll to bottom
        requestAnimationFrame(() => {
            stream.scrollTop = stream.scrollHeight;
        });

    } catch (err) {
        debugLog('Chat Mirror error', { error: err.message }, 'error');
    }
}

function startChatMirrorPolling() {
    if (chatMirrorTimer) clearInterval(chatMirrorTimer);
    chatMirrorTimer = setInterval(() => {
        const autoRefresh = document.getElementById('chatAutoRefresh');
        if (autoRefresh && autoRefresh.checked && selectedUserPhone) {
            loadChatMirror();
        }
    }, 8000);
}

async function refreshMetrics() {
    try {
        const data = await fetchJSON('/health');
        lastHealthPayload = data;

        const dot = document.getElementById('statusDot');
        if(dot) dot.className = 'dot online pulse-success';
        setTextContentWithEffect('statusText', 'Online - V. Activa');

        // KPIs
        setTextContentWithEffect('sReceived', data.counters?.messagesReceived || 0);
        setTextContentWithEffect('sProcessed', data.counters?.messagesProcessed || 0);
        setTextContentWithEffect('sFailed', data.counters?.messagesFailed || 0);
        setTextContentWithEffect('sLatency', data.latency?.avg ? data.latency.avg + 'ms' : '-');
        setTextContentWithEffect('sActive', data.services?.bot?.activeConversations || 0);
        setTextContentWithEffect('sUptime', data.uptime?.human || '-');

        // Detailed Metrics
        setTextContentWithEffect('mGemCalls', data.counters?.geminiCalls || 0);
        setTextContentWithEffect('mGemErr', data.counters?.geminiErrors || 0);
        setTextContentWithEffect('mWAOk', data.counters?.whatsappMessagesSent || 0);
        setTextContentWithEffect('mWAErr', data.counters?.whatsappErrors || 0);
        setTextContentWithEffect('mRateHit', data.counters?.rateLimitHits || 0);
        setTextContentWithEffect('mDup', data.counters?.duplicateMessages || 0);
        setTextContentWithEffect('mP50', data.latency?.p50 ? data.latency.p50 + 'ms' : '-');
        setTextContentWithEffect('mP95', data.latency?.p95 ? data.latency.p95 + 'ms' : '-');
        setTextContentWithEffect('mP99', data.latency?.p99 ? data.latency.p99 + 'ms' : '-');
        setTextContentWithEffect('mHeap', data.memory?.heapUsed || '-');
        setTextContentWithEffect('mMpm', data.throughput?.messagesPerMinute || 0);
        setTextContentWithEffect('mReliability', (data.reliability?.successRate || 100) + '%');

        renderKeys(data.services?.gemini?.keys || []);
        renderLastCutoff(data.services?.gemini?.lastCutoff || null);
        renderLastRequestDebug(data.services?.gemini?.lastRequestDebug || null);
        renderTopUsers(data.insights?.topUsers || []);
        renderRecentErrors(data.insights?.recentErrors || []);

        const geminiRaw = document.getElementById('geminiRawPayload');
        if (geminiRaw) {
            geminiRaw.textContent = JSON.stringify(data.services?.gemini || {}, null, 2);
        }

    } catch (err) {
        const dot = document.getElementById('statusDot');
        if(dot) dot.className = 'dot offline pulse-error';
        const txt = document.getElementById('statusText');
        if(txt) txt.textContent = 'Desconectado';
        debugLog('refreshMetrics fallo', { error: err.message || String(err) }, 'error');
    }
}

// React-like mount init
document.addEventListener('DOMContentLoaded', async () => {
    // Add load-in fade effect to main shell
    document.body.classList.add('app-loaded');
    
    // Bind Events
    const selectEl = document.getElementById('userSelect');
    if (selectEl) {
        selectEl.addEventListener('change', async (e) => {
            selectedUserPhone = e.target.value;
            chatMirrorLastCount = 0; // Force re-render on user change
            await loadSelectedUserConfig();
            await loadChatMirror();
        });
    }

    debugLog('App Montada CSS/JS OK. Iniciando bootstrap...');
    adminToken = getStoredAdminToken();
    updateAdminTokenStatus();
    
    if (!adminToken) {
        setTimeout(() => { showToast('Configura ADMIN_API_TOKEN en la barra lateral'); }, 1000);
    }

    // Skeleton loaders wait
    try {
        await Promise.all([
            loadGeneralConfig(),
            loadUsers(),
            refreshMetrics()
        ]);
        // Initial chat load after users are loaded
        if (selectedUserPhone) {
            await loadChatMirror();
        }
    } catch(e) {}
    
    // Auto refreshes
    setInterval(refreshMetrics, 10000);
    setInterval(loadUsers, 15000);
    startChatMirrorPolling();
});

