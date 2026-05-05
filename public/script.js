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
    debugLog('Consola de depuración limpiada manualmente.');
}

async function copyDebugConsole() {
    try {
        const text = debugLines.join('\n');
        await navigator.clipboard.writeText(text || 'Sin registros en consola de depuración.');
        showToast('Consola de depuración copiada');
    } catch (_) {
        showToast('No se pudo copiar la consola de depuración');
    }
}

function toggleDebugConsole() {
    debugEnabled = !debugEnabled;
    const btn = document.getElementById('debugToggleBtn');
    if (btn) {
        btn.textContent = debugEnabled ? 'Depurar ON' : 'Depurar OFF';
        btn.classList.toggle('active', debugEnabled);
    }
    if (debugEnabled) {
        debugLog('Depuración reactivada.');
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
    const overlay = document.getElementById('adminTokenOverlay');
    
    if (adminToken) {
        if (overlay) overlay.style.display = 'none';
        return true;
    }

    // Comportamiento modal para token faltante
    if (overlay) overlay.style.display = 'flex';
    updateAdminTokenStatus();
    return false;
}

function saveAdminToken() {
    const input = document.getElementById('adminTokenInput');
    const value = String(input?.value || '').trim();
    adminToken = value;
    setStoredAdminToken(value);
    updateAdminTokenStatus();
    showToast(value ? 'Token guardado' : 'Token eliminado');
    if (value) {
        // Recargar después de un breve retraso para que se muestre el toast
        setTimeout(() => location.reload(), 300);
    }
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

function setInnerHtmlWithEffect(id, newHtml) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.innerHTML !== newHtml) {
        el.innerHTML = newHtml;
        el.classList.add('pulse-text');
        setTimeout(() => el.classList.remove('pulse-text'), 500);
    }
}

function setTextContentWithEffect(id, newText) {
    const el = document.getElementById(id);
    if (!el) return;
    const textStr = String(newText);
    if (el.textContent !== textStr) {
        el.textContent = textStr;
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
        const optionsHtml = users.map((u) => {
            const name = u.userName ? ' - ' + u.userName : '';
            return `<option value="${u.phone}">${u.phone}${name}</option>`;
        }).join('');
        
        select.innerHTML = optionsHtml;
        
        const chatUserList = document.getElementById('chatUserList');
        if (chatUserList) {
            chatUserList.innerHTML = users.map((u) => {
                const isActive = u.phone === selectedUserPhone ? 'active' : '';
                return `<div class="chat-user-item ${isActive}" onclick="syncUserSelect('${u.phone}')">
                    <div class="chat-user-item-header">
                        <span class="chat-user-phone">${u.phone}</span>
                        <span class="chat-user-badge ai-active">AI</span>
                    </div>
                    <div class="chat-user-msg">${u.userName || 'Usuario App'}</div>
                </div>`;
            }).join('');
        }

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
            '<span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle;">smartphone</span> ' + selectedUserPhone,
            '<span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle;">person</span> ' + (user.userName || 'N/D'),
            '<span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle;">inbox_customize</span> ' + (user.messagesReceived || 0),
            '<span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle;">settings_motion_mode</span> ' + (user.messagesProcessed || 0),
            '<span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle; color:var(--err);">error</span> ' + (user.messagesFailed || 0),
            '<span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle;">schedule</span> ' + formatTs(user.lastSeenAt)
        ].join(' &nbsp;&middot;&nbsp; ');
        setInnerHtmlWithEffect('userMeta', meta);

        // Update RTB Sidebar
        setTextContentWithEffect('rtbPhone', selectedUserPhone);
        setTextContentWithEffect('rtbName', user.userName || 'Entidad Desconocida');
        setTextContentWithEffect('rtbProcessed', user.messagesProcessed || 0);
        setTextContentWithEffect('rtbReceived', user.messagesReceived || 0);
        setTextContentWithEffect('rtbFailed', user.messagesFailed || 0);
        setTextContentWithEffect('rtbSeen', formatTs(user.lastSeenAt));

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
        body.innerHTML = '<div class="clean-list-item" style="text-align: center; color: var(--on-surface-variant);">Sin llaves configuradas</div>';
        return;
    }

    body.innerHTML = keys.map((k) => {
        const activeBadge = k.active 
            ? '<span class="color-ok">● Activa</span>' 
            : '<span class="color-err">○ Inactiva</span>';
        return `<div class="clean-list-item">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong>${k.label || ('Llave #' + k.index)}</strong>
                ${activeBadge}
            </div>
            <div style="display: flex; gap: 1.5rem; font-size: 0.75rem; margin-top: 6px;">
                <span>Llamadas: ${k.totalCalls || 0}</span>
                <span class="color-err">Errores: ${k.totalErrors || 0}</span>
                <span>Deshabilitada hasta: ${formatTs(k.disabledUntil)}</span>
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
        NO_KEYS_CONFIGURED: 'No hay llaves API configuradas',
        NO_AVAILABLE_KEYS: 'Disyuntor: Sin llaves activas',
        TOTAL_BUDGET_EXHAUSTED: 'Presupuesto de tiempo agotado',
        RESPONSE_TRUNCATED_TIMEOUT: 'Respuesta truncada por tiempo de espera'
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
// ESPEJO DE CHAT: Flujo de Inteligencia en Vivo
// =============================================
let chatMirrorLastCount = 0;
let chatMirrorTimer = null;

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatMessageBody(raw) {
    let text = escapeHtml(raw || '');
    // WhatsApp-style bold: *text*
    text = text.replace(/\*(.+?)\*/g, '<strong>$1</strong>');
    // WhatsApp-style italic: _text_
    text = text.replace(/\_(.+?)\_/g, '<em>$1</em>');
    // Line breaks
    text = text.replace(/\n/g, '<br>');
    return text;
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
    const nameLabel = document.getElementById('chatUserNameLabel');
    if (!stream) return;

    if (phoneLabel) phoneLabel.textContent = selectedUserPhone;
    if (nameLabel) nameLabel.textContent = "Monitoreo en vivo";

    try {
        const data = await fetchJSON('/api/chat/' + encodeURIComponent(selectedUserPhone) + '?limit=150');
        const messages = data.messages || [];

        if (messages.length === 0) {
            stream.innerHTML = `
                <div class="chat-empty-state">
                    <span class="material-symbols-outlined" style="font-size: 3rem; margin-bottom: 1rem; color: var(--on-surface-variant);">mark_chat_unread</span>
                    <p>No hay mensajes registrados para <strong>${escapeHtml(selectedUserPhone)}</strong> aún.</p>
                </div>
            `;
            chatMirrorLastCount = 0;
            return;
        }

        // Solo re-renderizar si el conteo cambió (optimización de rendimiento)
        if (messages.length === chatMirrorLastCount) return;
        chatMirrorLastCount = messages.length;

        stream.innerHTML = messages.map((msg, i) => {
            const dir = msg.direction === 'inbound' ? 'inbound' : 'outbound';
            const senderLabel = dir === 'inbound' ? 'Usuario' : 'Buho AI';
            const time = formatChatTime(msg.created_at);
            const latencyBadge = msg.latency_ms 
                ? `<span class="msg-latency"><span class="material-symbols-outlined" style="font-size:10px; vertical-align:middle;">bolt</span> ${msg.latency_ms}ms</span>` 
                : '';

            return `<div class="msg-wrapper ${dir}" style="animation-delay: ${Math.min(i * 0.03, 0.5)}s">
                <div class="msg-meta">
                    ${dir === 'outbound' ? latencyBadge : ''}
                    <span>${senderLabel} • ${time}</span>
                </div>
                <div class="msg-bubble">${formatMessageBody(msg.body || '')}</div>
            </div>`;
        }).join('');

        // Auto-scroll al final
        requestAnimationFrame(() => {
            stream.scrollTop = stream.scrollHeight;
        });

    } catch (err) {
        debugLog('Chat Mirror error', { error: err.message }, 'error');
    }
}

function startChatMirrorPolling() {
    if (chatMirrorTimer) clearInterval(chatMirrorTimer);
    let isPolling = false;
    chatMirrorTimer = setInterval(async () => {
        const autoRefresh = document.getElementById('chatAutoRefresh');
        if (autoRefresh && autoRefresh.checked && selectedUserPhone && !isPolling) {
            isPolling = true;
            try {
                // Polling ultraligero solo pidiendo el COUNT
                const data = await fetchJSON('/api/chat/' + encodeURIComponent(selectedUserPhone) + '/count');
                if (data.count !== undefined && data.count !== chatMirrorLastCount) {
                    await loadChatMirror();
                }
            } catch (err) {
                // ignorar errores de polling en bg
            }
            isPolling = false;
        }
    }, 1500);
}

async function refreshMetrics() {
    try {
        const data = await fetchJSON('/health');
        lastHealthPayload = data;

        const dot = document.getElementById('statusDot');
        if(dot) dot.className = 'dot online pulse-success';
        setTextContentWithEffect('statusText', 'En línea - V. Activa');

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

// Inicialización de montaje
document.addEventListener('DOMContentLoaded', async () => {
    // Add load-in fade effect to main shell
    document.body.classList.add('app-loaded');
    
    // Vincular Eventos
    const selectEl = document.getElementById('userSelect');
    if (selectEl) {
        selectEl.addEventListener('change', async (e) => {
            selectedUserPhone = e.target.value;
            chatMirrorLastCount = 0; // Forzar re-renderizado al cambiar usuario
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

    // Esperar cargadores skeleton
    try {
        await Promise.all([
            loadGeneralConfig(),
            loadUsers(),
            refreshMetrics()
        ]);
        // Router inicial: decide qué pantalla mostrar y qué usuario cargar basado en la URL
        handleRoute();
    } catch(e) {}
    
    // Auto-actualizaciones
    setInterval(refreshMetrics, 10000);
    setInterval(loadUsers, 15000);
    startChatMirrorPolling();
});

// =============================================
// ENRUTAMIENTO DE APP Y MÓVIL (SPA) + HASH ROUTER
// =============================================
function toggleMobileMenu() {
    document.querySelector('.sidebar').classList.toggle('active');
}

function backToThreadList() {
    // Volver a la lista de chats (quitar el phone del hash)
    window.location.hash = 'chat';
    document.querySelector('.chat-sidebar').classList.remove('mobile-hidden');
    document.querySelector('.chat-main').classList.remove('mobile-active');
}

function switchView(viewName, skipHashUpdate) {
    // Hide mobile menu on navigation
    document.querySelector('.sidebar').classList.remove('active');

    // 1. Hide all views
    document.getElementById('view-dashboard').style.display = 'none';
    document.getElementById('view-chat').style.display = 'none';
    
    // 2. Remove active from nav links
    document.querySelectorAll('.side-menu a').forEach(el => el.classList.remove('active'));
    
    // 3. Show requested view
    const breadcrumb = document.getElementById('topBreadcrumb');
    
    if (viewName === 'chat') {
        document.getElementById('view-chat').style.display = 'block';
        document.querySelector('.main-content').classList.add('no-scroll');
        document.querySelectorAll('.side-menu a')[1].classList.add('active');
        if(breadcrumb) breadcrumb.innerHTML = '<span class="muted">Digital Buho</span> <span class="sep">/</span> <span class="active">Flujo de Inteligencia en Vivo</span>';
        loadChatMirror();
    } else {
        document.getElementById('view-dashboard').style.display = 'block';
        document.querySelector('.main-content').classList.remove('no-scroll');
        document.querySelectorAll('.side-menu a')[0].classList.add('active');
        if(breadcrumb) breadcrumb.innerHTML = '<span class="muted">Digital Buho</span> <span class="sep">/</span> <span class="active">Panel de Control</span>';
    }
}

// === HASH ROUTER ===
function handleRoute() {
    const hash = window.location.hash.slice(1) || 'dashboard'; // quitar el #
    const parts = hash.split('/');
    const view = parts[0]; // 'dashboard', 'chat'
    const param = parts[1] || null; // phone number si existe

    if (view === 'chat') {
        switchView('chat', true);
        // Si hay un teléfono en la URL, seleccionar ese chat
        if (param) {
            const decoded = decodeURIComponent(param);
            if (decoded !== selectedUserPhone) {
                syncUserSelect(decoded);
            }
        }
    } else {
        switchView('dashboard', true);
    }
}

// Escuchar cambios de hash (atrás/adelante del navegador, clicks en links)
window.addEventListener('hashchange', handleRoute);

function syncUserSelect(phone) {
    selectedUserPhone = phone;
    chatMirrorLastCount = 0;

    // Actualizar hash con el teléfono seleccionado (SIN refrescar)
    const newHash = '#chat/' + encodeURIComponent(phone);
    if (window.location.hash !== newHash) {
        history.replaceState(null, '', newHash);
    }
    
    // Sincronizar selector principal del panel
    const mainSelect = document.getElementById('userSelect');
    if (mainSelect && mainSelect.value !== phone) {
        mainSelect.value = phone;
        loadSelectedUserConfig();
    }
    
    // Actualizar clase activa en barra lateral del chat
    const chatUserItems = document.querySelectorAll('.chat-user-item');
    chatUserItems.forEach(el => {
        if (el.innerHTML.includes(phone)) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
    
    loadChatMirror();

    // Lógica específica para móvil
    if (window.innerWidth <= 768) {
        document.querySelector('.chat-sidebar').classList.add('mobile-hidden');
        document.querySelector('.chat-main').classList.add('mobile-active');
    }
}

