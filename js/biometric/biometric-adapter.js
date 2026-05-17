// js/biometric/biometric-adapter.js
// ============================================================
// Couche d'adaptation : protocoles biométriques multiples
// IBiometricProtocol = interface que tout adaptateur doit implémenter
// ============================================================

// ── Interface commune (contrat) ───────────────────────────────────────────────
// Tous les adaptateurs doivent implémenter ces méthodes.

export class IBiometricProtocol {
  /** @returns {Promise<object>} info appareil */
  async getDeviceInfo()                          { throw new Error('Not implemented'); }
  /** @returns {Promise<Array>} liste utilisateurs */
  async listUsers()                              { throw new Error('Not implemented'); }
  /** @param {object} user */
  async upsertUser(user)                         { throw new Error('Not implemented'); }
  /** @param {string} employeeId */
  async deleteUser(employeeId)                   { throw new Error('Not implemented'); }
  /** @param {object} params, @param {function} onProgress */
  async startEnrollment(params, onProgress)      { throw new Error('Not implemented'); }
  /** @param {object} options @returns {Promise<Array>} événements */
  async getAccessEvents(options)                 { throw new Error('Not implemented'); }
  /** @param {function} onEvent, @param {AbortSignal} signal */
  async streamEvents(onEvent, signal)            { throw new Error('Not implemented'); }
}

// ── Adaptateur Hikvision ISAPI ─────────────────────────────────────────────────
// Reprend exactement la classe HikvisionISAPI de biometric-api.js (sans changement)

export class HikvisionAdapter extends IBiometricProtocol {
  constructor(config) {
    super();
    const { host, port = 80, user = 'admin', password = '', https: useHttps = false } = config;
    this._base    = `${useHttps ? 'https' : 'http'}://${host}:${port}/ISAPI`;
    this._auth    = btoa(`${user}:${password}`);
    this._headers = {
      'Authorization': `Basic ${this._auth}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    };
  }

  async getDeviceInfo() {
    const data = await this._get('/System/deviceInfo');
    return {
      model:        data?.DeviceInfo?.model        || 'Inconnu',
      serialNumber: data?.DeviceInfo?.serialNumber || '',
      firmware:     data?.DeviceInfo?.firmwareVersion || '',
    };
  }

  async listUsers() {
    const data = await this._post('/AccessControl/UserInfo/Search', {
      UserInfoSearchCond: { searchID: '0', maxResults: 1000, EmployeeNoList: [{ employeeNo: '' }] },
    });
    return (data?.UserInfoSearch?.UserInfo || []).map(u => ({
      employeeId: u.employeeNo, name: `${u.name || ''}`.trim(), cardNo: u.cardNo || '',
    }));
  }

  async upsertUser(user) {
    const body = { UserInfo: [{ employeeNo: String(user.employeeId), name: user.name,
      cardNo: user.cardNo || '', userType: 'normal',
      Valid: { enable: true, beginTime: '2000-01-01T00:00:00', endTime: '2030-12-31T23:59:59' },
      doorRight: '1', RightPlan: [{ doorNo: 1, planTemplateNo: '1' }],
    }] };
    try { return await this._put('/AccessControl/UserInfo/Modify', body); }
    catch { return await this._post('/AccessControl/UserInfo/Record', body); }
  }

  async deleteUser(employeeId) {
    return this._post('/AccessControl/UserInfo/Delete', {
      UserInfoDelCond: { EmployeeNoList: [{ employeeNo: String(employeeId) }] },
    });
  }

  async startEnrollment({ employeeId, fingerIndex = 1 }) {
    return this._post('/AccessControl/FingerPrintUpload', {
      FingerPrintCond: { employeeNo: String(employeeId), fingerNo: fingerIndex, deleteAllFirst: false },
    });
  }

  async getAccessEvents(options = {}) {
    const from = options.from || new Date(Date.now() - 86400000);
    const to   = options.to   || new Date();
    const data = await this._post('/AccessControl/AcsEvent?format=json', {
      AcsEventCond: { searchID: '1', searchResultPosition: 0, maxResults: options.maxResults || 500,
        major: 5, minor: 75,
        startTime: from.toISOString().replace(/\.\d{3}Z$/, '+00:00'),
        endTime:   to.toISOString().replace(/\.\d{3}Z$/, '+00:00'),
      },
    });
    return (data?.AcsEvent?.InfoList || []).map(e => ({
      employeeId: e.employeeNoString || e.employeeNo,
      timestamp: e.time, type: 'fingerprint',
    }));
  }

  async streamEvents(onEvent, signal) {
    const url = `${this._base}/Event/notification/alertStream`;
    try {
      const response = await fetch(url, { method: 'GET', headers: this._headers, signal });
      if (!response.ok) throw new Error(`ISAPI stream error: ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done || signal?.aborted) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('--boundary');
        buffer = parts.pop() || '';
        for (const part of parts) {
          try {
            const jsonStart = part.indexOf('{');
            if (jsonStart === -1) continue;
            const data = JSON.parse(part.slice(jsonStart));
            if (data?.EventNotificationAlert?.employeeNoString) {
              onEvent({ employeeId: data.EventNotificationAlert.employeeNoString,
                        timestamp: data.EventNotificationAlert.dateTime, type: 'fingerprint' });
            }
          } catch { /* partie incomplète */ }
        }
      }
    } catch (err) { if (err.name !== 'AbortError') throw err; }
  }

  async _get(path)         { return this._request('GET', path); }
  async _post(path, body)  { return this._request('POST', path, body); }
  async _put(path, body)   { return this._request('PUT', path, body); }
  async _request(method, path, body = null) {
    const url  = `${this._base}${path}`;
    const opts = { method, headers: this._headers };
    if (body) opts.body = JSON.stringify(body);
    let response;
    try { response = await fetch(url, opts); }
    catch (err) { throw new Error(`[ISAPI] Réseau inaccessible (${url}): ${err.message}`); }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`[ISAPI] Erreur ${response.status} sur ${path}: ${text.slice(0, 200)}`);
    }
    const ct = response.headers.get('content-type') || '';
    return ct.includes('json') ? response.json() : response.text();
  }
}

// ── Adaptateur ZKTeco (réseau — pont local Node.js) ─────────────────────────────
//
// Le pont Node.js (bridge/index.js) expose un WebSocket sur ws://localhost:8765
// et émet deux types de messages :
//
//   Entrant (pont → navigateur) :
//     { type: 'fingerprint', employeeId, quality, timestamp, transport }
//     { type: 'device_info',  name, connected, transport }
//     { type: 'status',       state, message }
//     { type: 'error',        code, message }
//     { type: 'pong',         timestamp }
//
//   Sortant (navigateur → pont) :
//     { type: 'ping' }
//     { type: 'get_status' }
//
// Note : ZKTecoAdapter est utilisé comme protocole de haut niveau
// (enrôlement, liste utilisateurs) via des commandes JSON étendues.
// Les événements de pointage temps réel passent directement par
// biometric-service.js (transport WIFI) sans passer par cet adaptateur.

export class ZKTecoAdapter extends IBiometricProtocol {
  /**
   * @param {{ wsUrl?: string, host?: string, port?: number }} config
   * wsUrl  : adresse complète du pont, ex. ws://localhost:8765
   * host   : raccourci, ex. '127.0.0.1' (port 8765 par défaut)
   */
  constructor(config) {
    super();
    this._wsUrl  = config.wsUrl
      || `ws://${config.host || '127.0.0.1'}:${config.port || 8765}`;
    this._ws              = null;
    this._pendingCmds     = new Map(); // cmdId → { resolve, reject }
    this._cmdId           = 0;
    this._eventHandlers   = new Map(); // type → callback
    this._connected       = false;
  }

  // ── Connexion au pont ─────────────────────────────────────

  async _ensureConnected() {
    if (this._ws?.readyState === WebSocket.OPEN) return;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this._wsUrl);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error(`Pont biométrique inaccessible : ${this._wsUrl}`));
      }, 6000);

      ws.onopen = () => {
        clearTimeout(timeout);
        this._ws        = ws;
        this._connected = true;
        this._attachListeners(ws);
        resolve();
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error(`Erreur WebSocket vers ${this._wsUrl}`));
      };
    });
  }

  _attachListeners(ws) {
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      // Résoudre une commande en attente
      if (msg.cmdId && this._pendingCmds.has(msg.cmdId)) {
        const { resolve, reject } = this._pendingCmds.get(msg.cmdId);
        this._pendingCmds.delete(msg.cmdId);
        msg.error ? reject(new Error(msg.error)) : resolve(msg.data ?? msg);
        return;
      }

      // Dispatcher les événements push (fingerprint, status, device_info)
      const handler = this._eventHandlers.get(msg.type);
      if (handler) handler(msg);
    };

    ws.onclose = () => { this._connected = false; };
  }

  // ── Commandes vers le pont ────────────────────────────────

  /**
   * Envoie une commande au pont et attend la réponse.
   * Le pont répond avec { cmdId, data } ou { cmdId, error }.
   */
  async _send(cmd, params = {}) {
    await this._ensureConnected();
    const cmdId = ++this._cmdId;

    return new Promise((resolve, reject) => {
      this._pendingCmds.set(cmdId, { resolve, reject });
      this._ws.send(JSON.stringify({ type: cmd, cmdId, ...params }));

      setTimeout(() => {
        if (this._pendingCmds.has(cmdId)) {
          this._pendingCmds.delete(cmdId);
          reject(new Error(`Timeout commande '${cmd}' vers le pont`));
        }
      }, 10_000);
    });
  }

  // ── IBiometricProtocol ────────────────────────────────────

  async getDeviceInfo() {
    return this._send('get_status');
  }

  async listUsers() {
    // Non supporté directement par le pont (géré côté state local)
    return [];
  }

  async upsertUser(_user)       { return null; } // géré par biometric-sync.js
  async deleteUser(_employeeId) { return null; }

  async startEnrollment(params, onProgress) {
    onProgress?.({ step: 'waiting', message: 'Posez le doigt sur le lecteur…' });
    // L'enrôlement physique se fait sur le device lui-même via le pont
    return this._send('enroll', { employeeId: params.employeeId, fingerIndex: params.fingerIndex ?? 1 });
  }

  async getAccessEvents(_options) {
    // Les événements temps réel arrivent via biometric-service.js (transport WIFI)
    // Cette méthode est un no-op pour ZKTeco via pont WebSocket
    return [];
  }

  /**
   * Écoute les événements fingerprint push émis par le pont.
   * Appelé par biometric-sync.js si ce mode est utilisé directement.
   * En pratique, biometric-service.js intercepte déjà ces messages.
   */
  async streamEvents(onEvent, signal) {
    await this._ensureConnected();
    this._eventHandlers.set('fingerprint', onEvent);
    signal?.addEventListener('abort', () => {
      this._eventHandlers.delete('fingerprint');
    });
  }

  // ── Utilitaire ping ───────────────────────────────────────

  async ping() {
    await this._ensureConnected();
    this._ws.send(JSON.stringify({ type: 'ping' }));
  }
}

// ── Registre des décodeurs de trames USB brutes ──────────────────────────────────
// Chaque décodeur reçoit un Uint8Array et retourne un objet parsé ou null.

export const FrameDecoderRegistry = {
  _decoders: [],

  /** @param {{ name: string, decode: function(Uint8Array): object|null }} decoder */
  register(decoder) {
    this._decoders.push(decoder);
  },

  /**
   * Essaie chaque décodeur enregistré dans l'ordre.
   * Retourne le premier résultat non-null.
   * @param {Uint8Array} bytes
   * @returns {object|null} { employeeId, quality, timestamp, simulated } ou null
   */
  decode(bytes) {
    for (const decoder of this._decoders) {
      try {
        const result = decoder.decode(bytes);
        if (result) return result;
      } catch { /* décodeur incompatible, essayer le suivant */ }
    }
    return null;
  },
};

// ── Décodeur Hikvision USB (SOF 0x55 0xAA) ───────────────────────────────────────
FrameDecoderRegistry.register({
  name: 'Hikvision-USB',
  decode(bytes) {
    if (bytes[0] !== 0x55 || bytes[1] !== 0xAA) return null;
    const cmd     = bytes[2];
    if (cmd !== 0x03) return null; // 0x04 = no_match géré par l'appelant
    const len     = (bytes[3] << 8) | bytes[4];
    const payload = bytes.slice(5, 5 + len);
    const employeeId = new TextDecoder().decode(payload.slice(0, 8)).replace(/\0/g, '').trim();
    if (!employeeId) return null;
    return { employeeId, quality: payload[8] || 85, timestamp: new Date().toISOString(), simulated: false };
  },
});

// ── Décodeur ZKTeco USB (trame binaire ZKLib) ─────────────────────────────────────
// Format : [0x00, 0x00, 0x00, userId(4 bytes LE), quality(1)]
FrameDecoderRegistry.register({
  name: 'ZKTeco-USB',
  decode(bytes) {
    if (bytes.length < 6) return null;
    if (bytes[0] !== 0x00 || bytes[1] !== 0x00) return null;
    const userId = (bytes[5] | (bytes[6] << 8) | (bytes[7] << 16) | (bytes[8] << 24)) >>> 0;
    if (userId === 0) return null;
    return { employeeId: String(userId), quality: bytes[9] || 80,
             timestamp: new Date().toISOString(), simulated: false };
  },
});

// ── Décodeur générique ASCII HID (fallback) ───────────────────────────────────────
// Pour les lecteurs qui envoient simplement l'ID en ASCII (mode HID pur)
FrameDecoderRegistry.register({
  name: 'Generic-ASCII-HID',
  decode(bytes) {
    const text = new TextDecoder().decode(bytes).replace(/\0/g, '').trim();
    if (!text || text.length < 2 || !/^\d+$/.test(text)) return null;
    return { employeeId: text, quality: 80, timestamp: new Date().toISOString(), simulated: false };
  },
});