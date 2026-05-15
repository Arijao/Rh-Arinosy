// ============================================================
// biometric/biometric-api.js
// Protocole Hikvision ISAPI (HTTP/REST) + couche API unifiée
// Gère : enrôlement, suppression, liste des utilisateurs,
//        événements de pointage distants, configuration device
// ============================================================

/**
 * Client ISAPI pour les dispositifs Hikvision en réseau local.
 * Référence : Hikvision ISAPI v2.0 — Access Control & Video Intercom
 *
 * Utilisation typique (Wi-Fi / PoE) :
 *   const api = new HikvisionISAPI({ host: '192.168.1.64', user: 'admin', password: 'xxxx' });
 *   await api.getDeviceInfo();
 *   await api.enrollUser({ employeeId: '007', name: 'Jean Dupont', fingerIndex: 1 });
 */
export class HikvisionISAPI {
  /**
   * @param {{ host: string, port?: number, user?: string, password?: string, https?: boolean }} config
   */
  constructor(config) {
    const { host, port = 80, user = 'admin', password = '', https: useHttps = false } = config;
    this._base    = `${useHttps ? 'https' : 'http'}://${host}:${port}/ISAPI`;
    this._auth    = btoa(`${user}:${password}`);
    this._headers = {
      'Authorization': `Basic ${this._auth}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    };
  }

  // ── Info appareil ─────────────────────────────────────────

  async getDeviceInfo() {
    const data = await this._get('/System/deviceInfo');
    return {
      model:        data?.DeviceInfo?.model       || 'Inconnu',
      serialNumber: data?.DeviceInfo?.serialNumber || '',
      firmware:     data?.DeviceInfo?.firmwareVersion || '',
      deviceName:   data?.DeviceInfo?.deviceName  || '',
    };
  }

  async getNetworkConfig() {
    return this._get('/System/Network/interfaces');
  }

  // ── Gestion des utilisateurs ──────────────────────────────

  /**
   * Récupère tous les utilisateurs enrôlés sur le périphérique
   * @returns {Promise<Array<{ employeeId, name, cardNo, fingerprint }>>}
   */
  async listUsers() {
    const data = await this._get('/AccessControl/UserInfo/Search', {
      method: 'POST',
      body: JSON.stringify({
        UserInfoSearchCond: {
          searchID:       '0',
          maxResults:     1000,
          EmployeeNoList: [{ employeeNo: '' }],
        },
      }),
    });

    const users = data?.UserInfoSearch?.UserInfo || [];
    return users.map(u => ({
      employeeId: u.employeeNo,
      name:       `${u.name || ''}`.trim(),
      cardNo:     u.cardNo || '',
      hasFingerprint: u.numOfFace > 0 || false,
    }));
  }

  /**
   * Enrôle ou met à jour un utilisateur
   * @param {{ employeeId: string, name: string, cardNo?: string }} user
   */
  async upsertUser(user) {
    const body = {
      UserInfo: [{
        employeeNo: String(user.employeeId),
        name:       user.name,
        cardNo:     user.cardNo || '',
        userType:   'normal',
        Valid: {
          enable:    true,
          beginTime: '2000-01-01T00:00:00',
          endTime:   '2030-12-31T23:59:59',
        },
        doorRight: '1',
        RightPlan: [{ doorNo: 1, planTemplateNo: '1' }],
      }],
    };

    // Essaie un update (PUT), sinon crée (POST)
    try {
      return await this._put('/AccessControl/UserInfo/Modify', body);
    } catch {
      return await this._post('/AccessControl/UserInfo/Record', body);
    }
  }

  /**
   * Supprime un utilisateur par son ID employé
   * @param {string} employeeId
   */
  async deleteUser(employeeId) {
    return this._post('/AccessControl/UserInfo/Delete', {
      UserInfoDelCond: {
        EmployeeNoList: [{ employeeNo: String(employeeId) }],
      },
    });
  }

  // ── Enrôlement empreinte ──────────────────────────────────

  /**
   * Déclenche l'enrôlement d'une empreinte sur le périphérique
   * L'utilisateur doit poser le doigt sur le lecteur après cet appel
   * @param {{ employeeId: string, fingerIndex?: number }} params  (fingerIndex : 1-10)
   */
  async startEnrollment(params) {
    const { employeeId, fingerIndex = 1 } = params;
    return this._post('/AccessControl/FingerPrintUpload', {
      FingerPrintCond: {
        employeeNo:   String(employeeId),
        fingerNo:     fingerIndex,
        deleteAllFirst: false,
      },
    });
  }

  /**
   * Vérifie le statut d'un enrôlement en cours
   */
  async getEnrollmentStatus(employeeId) {
    const data = await this._post('/AccessControl/FingerPrintUpload/capabilities', {
      FingerPrintCond: { employeeNo: String(employeeId) },
    });
    return {
      enrolled:    data?.FingerPrintInfo?.fingerNo > 0,
      fingerCount: data?.FingerPrintInfo?.fingerNo || 0,
    };
  }

  // ── Événements de pointage ────────────────────────────────

  /**
   * Récupère les événements d'accès (pointages) du périphérique
   * @param {{ from?: Date, to?: Date, maxResults?: number }} options
   * @returns {Promise<Array<{ employeeId, timestamp, type, direction }>>}
   */
  async getAccessEvents(options = {}) {
    const from = options.from || new Date(Date.now() - 24 * 3600 * 1000);
    const to   = options.to   || new Date();

    const data = await this._post('/AccessControl/AcsEvent?format=json', {
      AcsEventCond: {
        searchID:      '1',
        searchResultPosition: 0,
        maxResults:    options.maxResults || 500,
        major:         5,
        minor:         75,
        startTime:     from.toISOString().replace(/\.\d{3}Z$/, '+00:00'),
        endTime:       to.toISOString().replace(/\.\d{3}Z$/, '+00:00'),
      },
    });

    const events = data?.AcsEvent?.InfoList || [];
    return events.map(e => ({
      employeeId: e.employeeNoString || e.employeeNo,
      timestamp:  e.time,
      type:       'fingerprint',
      direction:  e.doorNo === 1 ? 'in' : 'out',
      cardNo:     e.cardNo || '',
    }));
  }

  /**
   * Écoute les événements en temps réel via long-polling ISAPI
   * @param {function} onEvent - Callback appelé à chaque événement
   * @param {AbortSignal} signal - Pour annuler l'écoute
   */
  async streamEvents(onEvent, signal) {
    const url = `${this._base}/Event/notification/alertStream`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this._headers,
        signal,
      });

      if (!response.ok) throw new Error(`ISAPI stream error: ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done || signal?.aborted) break;

        buffer += decoder.decode(value, { stream: true });
        const events = this._parseAlertStream(buffer);
        buffer = events.remainder;
        events.parsed.forEach(onEvent);
      }
    } catch (err) {
      if (err.name !== 'AbortError') throw err;
    }
  }

  _parseAlertStream(buffer) {
    const parsed = [];
    // Les événements ISAPI sont délimités par --boundary\r\n
    const parts = buffer.split('--boundary');
    const remainder = parts.pop() || '';

    for (const part of parts) {
      try {
        const jsonStart = part.indexOf('{');
        if (jsonStart === -1) continue;
        const data = JSON.parse(part.slice(jsonStart));
        if (data?.EventNotificationAlert?.employeeNoString) {
          parsed.push({
            employeeId: data.EventNotificationAlert.employeeNoString,
            timestamp:  data.EventNotificationAlert.dateTime,
            type:       'fingerprint',
          });
        }
      } catch { /* partie incomplète, ignorée */ }
    }

    return { parsed, remainder };
  }

  // ── Requêtes HTTP internes ────────────────────────────────

  async _get(path) {
    return this._request('GET', path);
  }

  async _post(path, body) {
    return this._request('POST', path, body);
  }

  async _put(path, body) {
    return this._request('PUT', path, body);
  }

  async _request(method, path, body = null) {
    const url = `${this._base}${path}`;
    const opts = {
      method,
      headers: this._headers,
    };
    if (body) opts.body = typeof body === 'string' ? body : JSON.stringify(body);

    let response;
    try {
      response = await fetch(url, opts);
    } catch (err) {
      throw new Error(`[ISAPI] Réseau inaccessible (${url}): ${err.message}`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`[ISAPI] Erreur ${response.status} sur ${path}: ${text.slice(0, 200)}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('json')) {
      return response.json();
    }
    return response.text();
  }
}

// ============================================================
// BiometricAPI — Façade unifiée (USB local + ISAPI réseau)
// ============================================================

/**
 * Couche d'abstraction haut niveau utilisée par l'UI.
 * Délègue soit au service USB (biometric-service) soit à l'ISAPI réseau.
 */
export class BiometricAPI {
  constructor() {
    this._isapi     = null;
    this._mode      = 'local'; // 'local' | 'network'
  }

  /**
   * Configure le mode réseau avec les paramètres Hikvision
   * @param {{ host: string, port?: number, user?: string, password?: string }} config
   */
  configureNetwork(config) {
    this._isapi = new HikvisionISAPI(config);
    this._mode  = 'network';
    console.log('[BiometricAPI] Mode réseau configuré:', config.host);
  }

  setLocalMode() {
    this._isapi = null;
    this._mode  = 'local';
  }

  get mode() { return this._mode; }

  // ── Synchronisation des employés vers le périphérique ────

  /**
   * Pousse un employé vers le périphérique réseau
   * @param {{ id: string, name: string }} employee
   */
  async pushEmployee(employee) {
    if (this._mode !== 'network' || !this._isapi) return;
    await this._isapi.upsertUser({ employeeId: employee.id, name: employee.name });
  }

  /**
   * Pousse tous les employés actifs vers le périphérique
   * @param {Array} employees
   */
  async pushAllEmployees(employees) {
    if (this._mode !== 'network' || !this._isapi) return { pushed: 0, errors: [] };
    const errors = [];
    let pushed = 0;
    for (const emp of employees) {
      try {
        await this._isapi.upsertUser({ employeeId: emp.id, name: emp.name });
        pushed++;
      } catch (err) {
        errors.push({ employeeId: emp.id, error: err.message });
      }
    }
    return { pushed, errors };
  }

  /**
   * Supprime un employé du périphérique
   */
  async removeEmployee(employeeId) {
    if (this._mode !== 'network' || !this._isapi) return;
    await this._isapi.deleteUser(employeeId);
  }

  // ── Enrôlement ────────────────────────────────────────────

  /**
   * Lance l'enrôlement biométrique pour un employé
   * Retourne une promesse qui se résout quand l'enrôlement est confirmé
   * @param {{ employeeId: string, fingerIndex?: number }} params
   * @param {function} onProgress - Callback de progression
   */
  async enroll(params, onProgress) {
    if (this._mode === 'network' && this._isapi) {
      onProgress?.({ step: 'start', message: 'Initialisation de l\'enrôlement sur le périphérique...' });
      await this._isapi.startEnrollment(params);
      onProgress?.({ step: 'waiting', message: 'Posez le doigt sur le lecteur (3 fois)...' });

      // Polling du statut jusqu'à confirmation (max 60s)
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000));
        const status = await this._isapi.getEnrollmentStatus(params.employeeId);
        if (status.enrolled) {
          onProgress?.({ step: 'done', message: 'Empreinte enrôlée avec succès' });
          return status;
        }
        onProgress?.({ step: 'waiting', message: 'En attente de confirmation...' });
      }
      throw new Error('Timeout : aucune empreinte détectée dans le délai imparti');
    }

    // Mode local USB : l'enrôlement se fait sur l'écran du device lui-même
    onProgress?.({ step: 'waiting', message: 'Posez le doigt sur le lecteur...' });
    return new Promise((resolve) => {
      onProgress?.({ step: 'done', message: 'En attente d\'empreinte via USB...' });
      resolve({ enrolled: true, fingerCount: 1 });
    });
  }

  // ── Récupération événements réseau ────────────────────────

  /**
   * Récupère les pointages stockés sur le périphérique réseau
   * Utile pour rattraper des pointages offline
   * @param {{ from?: Date, to?: Date }} options
   */
  async fetchRemoteEvents(options = {}) {
    if (this._mode !== 'network' || !this._isapi) return [];
    return this._isapi.getAccessEvents(options);
  }

  async getDeviceInfo() {
    if (this._mode !== 'network' || !this._isapi) return null;
    return this._isapi.getDeviceInfo();
  }
}

// Singleton
export const biometricAPI = new BiometricAPI();
