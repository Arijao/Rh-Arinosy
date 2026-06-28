// ============================================================
// state.js — État global (ES Module) — v2 API Express
// Compatible drop-in avec l'ancienne version IndexedDB.
// Toutes les exportations sont identiques pour ne pas modifier
// les modules UI existants.
// ============================================================

'use strict';

const API_BASE = '/api';

// ── Shim dbManager (compatibilité main.js et diagnostics) ────
export const dbManager = {
    isInitialized: false,
    log: (msg, type = 'info') => console.log(`[DB][${type.toUpperCase()}] ${msg}`),
    printDiagnostic: () => console.log('[DB] Diagnostic: API Express (pas IndexedDB)'),
    getDiagnosticLog: () => [],
    exportDiagnosticData: async () => ({}),
    diagnose: async () => ({ available: true, mode: 'api' }),
    advancedDiagnosis: async () => ({ mode: 'api' }),
    init: async () => {
        try {
            await loadData();
            dbManager.isInitialized = true;
            dbManager.log('API Express initialisée', 'success');
            return { available: true, mode: 'api' };
        } catch (err) {
            dbManager.log('Erreur init: ' + err.message, 'error');
            return { available: false, error: err.message };
        }
    },
    getStoreSizes: async () => {
        try {
            const res = await fetch(API_BASE + '/data');
            const data = await res.json();
            return {
                employees:    (data.employees    || []).length,
                groups:       (data.groups       || []).length,
                advances:     (data.advances     || []).length,
                payrolls:     (data.payrolls     || []).length,
                remarks:      (data.remarks      || []).length,
                attendance:   Object.keys(data.attendance || {}).length,
                qrAttendance: (data.qrAttendance || []).length,
            };
        } catch (err) {
            return { error: err.message };
        }
    },

    get: async (store, key) => {
        if (store === 'settings') {
            try {
                const res = await fetch(API_BASE + '/settings');
                const data = await res.json();
                const value = data[key];
                if (value === undefined) return null;
                return { key, value };
            } catch { return null; }
        }
        return null;
    },
    getAll: async (store) => {
        // Retourner les donnees depuis state en memoire
        const map = {
            'employees':    () => state.employees,
            'groups':       () => state.groups,
            'advances':     () => state.advances,
            'payrolls':     () => state.payrolls,
            'remarks':      () => state.remarks,
            'qr_attendance':() => state.qrAttendance,
            'attendance':   () => Object.entries(state.attendance).map(([date, data]) => ({ date, data })),
            'qr_codes':     () => state.employees.map(e => e.qrCode).filter(Boolean),
        };
        return map[store] ? map[store]() : [];
    },
    put: async (store, item) => {
        if (store === 'settings' && item.key) {
            try {
                await fetch(API_BASE + '/settings/' + item.key, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ value: item.value }),
                });
            } catch (err) {
                console.warn('[DB] put settings error:', err.message);
            }
        }
    },    updateDBStatus: (msg, type) => {
        dbManager.log(msg, type);
        const el = document.getElementById('dbStatusText');
        if (el && type === 'error') {
            el.innerHTML = msg;
        }
    },
};

window._dbDiagnostic = {
    printLog:    () => dbManager.printDiagnostic(),
    getLogs:     () => dbManager.getDiagnosticLog(),
    exportData:  async () => dbManager.exportDiagnosticData(),
    test:        async () => dbManager.diagnose(),
    advanced:    async () => dbManager.advancedDiagnosis(),
};

// ── État global ───────────────────────────────────────────────
export const state = {
    employees:    [],
    groups:       [],
    attendance:   {},
    payrolls:     [],
    advances:     [],
    qrAttendance: [],
    remarks:      [],
    currentTheme: 'dark',
    qrSettings:   { size: 480, color: '#000000' },
    pagination: {
        employee:       { current: 1, perPage: 20 },
        attendance:     { current: 1, perPage: 20 },
        advances:       { current: 1, perPage: 15 },
        qrAttendance:   { current: 1, perPage: 15 },
        faceAttendance: { current: 1, perPage: 20 },
        enrolled:       { current: 1, perPage: 20 },
    },
    isScanning:          false,
    scanStream:          null,
    scanInterval:        null,
    currentScanPurpose:  null,
    facialRecognitionMode: 'pointage',
};

// ── Guard save/reload ────────────────────────────────────
let _saving = false;

// ── Snapshot pour détection des changements ───────────────────
const _snap = {
    employees:    new Map(),
    groups:       new Map(),
    advances:     new Map(),
    payrolls:     new Map(),
    remarks:      new Map(),
    qrAttendance: new Map(),
    attendance:   '',
};

function _snapItem(item) { return JSON.stringify(item); }

function _updateSnap(key, items) {
    _snap[key].clear();
    for (const item of items) _snap[key].set(item.id, _snapItem(item));
}

// ── Helpers API ───────────────────────────────────────────────
async function _api(method, url, body) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

// ── Sync différentielle d'une entité tableau ──────────────────
async function _syncArray(endpoint, currentItems, snapMap) {
    if (!snapMap) return;
    const items = currentItems || [];
    const currentMap = new Map(items.map(i => [i.id, i]));

    for (const [id, item] of currentMap) {
        const json = _snapItem(item);
        if (!snapMap.has(id)) {
            await _api('POST', `${API_BASE}/${endpoint}`, item).catch(e =>
                console.warn(`[STATE] POST ${endpoint} ${id}:`, e.message));
        } else if (snapMap.get(id) !== json) {
            await _api('PUT', `${API_BASE}/${endpoint}/${id}`, item).catch(e =>
                console.warn(`[STATE] PUT ${endpoint} ${id}:`, e.message));
        }
    }

    for (const [id] of snapMap) {
        if (!currentMap.has(id)) {
            await _api('DELETE', `${API_BASE}/${endpoint}/${id}`).catch(e =>
                console.warn(`[STATE] DELETE ${endpoint} ${id}:`, e.message));
        }
    }

    const snapKey = endpoint === 'qr/attendance' ? 'qrAttendance' : endpoint;
    if (_snap[snapKey] !== undefined) _updateSnap(snapKey, items);
}

// ── Sync présences ────────────────────────────────────────────
async function _syncAttendance() {
    const current = JSON.stringify(state.attendance);
    if (current === _snap.attendance) return;

    const prev = _snap.attendance ? JSON.parse(_snap.attendance) : {};

    // Suppressions
    for (const [date, dayObj] of Object.entries(prev)) {
        for (const employeeId of Object.keys(dayObj)) {
            const stillPresent = state.attendance[date] && (employeeId in state.attendance[date]);
            if (!stillPresent) {
                await _api('DELETE', `${API_BASE}/attendance/${date}/${employeeId}`)
                    .catch(e => console.warn('[STATE] DELETE attendance:', e.message));
            }
        }
    }

    // Ajouts et modifications
    for (const [date, dayObj] of Object.entries(state.attendance)) {
        for (const [employeeId, value] of Object.entries(dayObj)) {
            const prevVal = JSON.stringify(prev[date] && prev[date][employeeId]);
            const currVal = JSON.stringify(value);
            if (prevVal !== currVal) {
                await _api('POST', `${API_BASE}/attendance`, {
                    date, employeeId, value,
                }).catch(e => console.warn('[STATE] POST attendance:', e.message));
            }
        }
    }

    _snap.attendance = current;
}

// ── Préparation employé pour l'API (camelCase + JSON) ─────────
function _prepEmployee(emp) {
    const e = { ...emp };
    // Mapper snake_case → camelCase pour l'API
    if ('face_descriptors' in e) {
        e.faceDescriptors = e.face_descriptors?.length
            ? JSON.stringify(e.face_descriptors)
            : null;
        delete e.face_descriptors;
    }
    if ('face_enrolled' in e) {
        e.faceEnrolled = e.face_enrolled;
        delete e.face_enrolled;
    }
    if ('face_enrollment_date' in e) {
        e.faceEnrollmentDate = e.face_enrollment_date;
        delete e.face_enrollment_date;
    }
    // Supprimer les relations Prisma
    ['group','attendance','advances','payrolls','remarks','qrCode','qrAttendance'].forEach(k => delete e[k]);
    return e;
}

// ── saveData — persistance complète ──────────────────────────
export async function saveData() {
    _saving = true;
    try {
        // Employés (avec mapping face descriptors)
        const empsForApi = state.employees.map(_prepEmployee);
        const empSnapMap = _snap.employees;
        const empCurrentMap = new Map(empsForApi.map(i => [i.id, i]));
        for (const [id, item] of empCurrentMap) {
            const json = _snapItem(item);
            if (!empSnapMap.has(id)) {
                await _api('POST', `${API_BASE}/employees`, item).catch(e =>
                    console.warn('[STATE] POST employees:', e.message));
            } else if (empSnapMap.get(id) !== json) {
                await _api('PUT', `${API_BASE}/employees/${id}`, item).catch(e =>
                    console.warn('[STATE] PUT employees:', e.message));
            }
        }
        for (const [id] of empSnapMap) {
            if (!empCurrentMap.has(id)) {
                await _api('DELETE', `${API_BASE}/employees/${id}`).catch(e =>
                    console.warn('[STATE] DELETE employees:', e.message));
            }
        }
        _snap.employees.clear();
        for (const [id, item] of empCurrentMap) _snap.employees.set(id, _snapItem(item));

        // Autres entités
        await _syncArray('groups',       state.groups,       _snap.groups);
        await _syncArray('advances',     state.advances,     _snap.advances);
        await _syncArray('payroll',      state.payrolls,     _snap.payrolls);
        await _syncArray('remarks',      state.remarks,      _snap.remarks);
        await _syncArray('qr/attendance',state.qrAttendance, _snap['qrAttendance']);
        await _syncAttendance();

        // Settings
        await _api('PUT', `${API_BASE}/settings/theme`,      { value: state.currentTheme }).catch(() => {});
        await _api('PUT', `${API_BASE}/settings/qrSettings`, { value: state.qrSettings   }).catch(() => {});
        await _api('PUT', `${API_BASE}/settings/lastUpdated`,{ value: new Date().toISOString() }).catch(() => {});

        dbManager.log(`✅ Sauvegarde complète: ${state.employees.length} employé(s)`, 'success');
    } catch (err) {
        dbManager.log(`❌ Erreur saveData: ${err.message}`, 'error');
        console.error('Erreur saveData:', err);
        throw err;
    } finally {
        _saving = false;
    }
}

// ── saveAttendanceData — présences uniquement ─────────────────
export async function saveAttendanceData() {
    _saving = true;
    try {
        await _syncAttendance();
        dbManager.log(`✅ Présences sauvegardées`, 'success');
    } catch (err) {
        dbManager.log(`❌ Erreur saveAttendanceData: ${err.message}`, 'error');
        throw err;
    } finally {
        _saving = false;
    }
}

// ── loadData — chargement depuis l'API ───────────────────────
export async function loadData() {
    try {
        const res = await fetch(`${API_BASE}/data`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        state.employees    = data.employees    || [];
        state.groups       = data.groups       || [];
        state.advances     = data.advances     || [];
        state.payrolls     = data.payrolls     || [];
        state.remarks      = data.remarks      || [];
        state.qrAttendance = data.qrAttendance || [];
        state.attendance   = data.attendance   || {};

        if (data.settings?.theme)      state.currentTheme = data.settings.theme;
        if (data.settings?.qrSettings) state.qrSettings   = data.settings.qrSettings;

        // Mettre à jour les snapshots
        _updateSnap('employees',    state.employees.map(_prepEmployee));
        _updateSnap('groups',       state.groups);
        _updateSnap('advances',     state.advances);
        _updateSnap('payrolls',     state.payrolls);
        _updateSnap('remarks',      state.remarks);
        _updateSnap('qrAttendance', state.qrAttendance);
        _snap.attendance = JSON.stringify(state.attendance);

        dbManager.isInitialized = true;
        dbManager.log(`✅ ${state.employees.length} employé(s) chargé(s)`, 'success');
    } catch (err) {
        dbManager.log(`❌ Erreur loadData: ${err.message}`, 'error');
        console.error('Erreur loadData:', err);
        state.employees = []; state.groups = []; state.attendance = {};
        state.payrolls = []; state.advances = []; state.qrAttendance = [];
        state.remarks = [];
        throw err;
    }
}

// ── WebSocket — synchronisation temps réel ───────────────────
(function _initWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/ws`;
    let _retryMs   = 1000;
    let _reloading = false;

    function connect() {
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('[WS] Connecté — synchronisation temps réel active.');
            _retryMs = 1000;
            dbManager.isInitialized = true;
        };

        ws.onmessage = async (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.event === 'update' || msg.event === 'scan') {
                    if (_reloading || _saving) return;
                    _reloading = true;
                    try {
                        await loadData();
                        // Déclencher le rafraîchissement UI si disponible
                        if (typeof window.refreshUI === 'function') window.refreshUI();
                    } finally {
                        _reloading = false;
                    }
                }
            } catch { /* message malformé */ }
        };

        ws.onclose = () => {
            console.log(`[WS] Déconnecté — reconnexion dans ${_retryMs}ms`);
            setTimeout(() => {
                _retryMs = Math.min(_retryMs * 2, 30000);
                connect();
            }, _retryMs);
        };

        ws.onerror = () => ws.close();
    }

    connect();
})();
