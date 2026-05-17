// ============================================================
// bridge/adapters/hikvision.js
// Adaptateur Hikvision — deux modes :
//
//  Mode USB  : décodage de la trame propriétaire 0x55 0xAA
//              via node-hid (même bibliothèque que hid.js,
//              mais avec le décodage spécifique Hikvision)
//
//  Mode ISAPI: polling des événements via HTTP REST (ISAPI v2)
//              — pour les terminaux réseau DS-K1T671 etc.
//              (biometric-api.js fait déjà ça côté web ;
//               ici on le réplique côté Node pour le pont)
//
// Dépendances :
//   USB  → npm install node-hid
//   ISAPI→ natif (fetch Node 18+)
// ============================================================

import { BaseAdapter } from './base.js';

// Octets de début de trame Hikvision USB
const HIK_SOF_1 = 0x55;
const HIK_SOF_2 = 0xAA;
const HIK_CMD_ID_OK    = 0x03; // identification réussie
const HIK_CMD_ID_FAIL  = 0x04; // empreinte non reconnue

// VID/PID connus Hikvision (extensible)
const HIKVISION_DEVICES = [
  { vendorId: 0x2188, productId: 0x0058 }, // DS-K1F820-F
  { vendorId: 0x2188, productId: 0x0060 }, // DS-K1F810-F
  { vendorId: 0x2188, productId: 0x0070 }, // DS-K1F181-F
];

// Intervalle de polling ISAPI (ms)
const ISAPI_POLL_INTERVAL_MS = 5000;

// Import dynamique de node-hid — évite un crash au démarrage
// si la bibliothèque n'est pas encore installée.
let HID = null;
async function loadHID() {
  if (HID) return HID;
  try {
    const mod = await import('node-hid');
    HID = mod.default ?? mod;
    return HID;
  } catch (err) {
    throw new Error(
      `node-hid introuvable. Installez-le avec :\n` +
      `  npm install node-hid\n` +
      `Détail : ${err.message}`
    );
  }
}

export class HikvisionAdapter extends BaseAdapter {
  /**
   * @param {object} config
   * @param {'usb'|'isapi'} config.mode       - Mode de connexion
   *
   * Mode USB :
   * @param {number} [config.vendorId]         - VID (auto-détecté si absent)
   * @param {number} [config.productId]        - PID (auto-détecté si absent)
   *
   * Mode ISAPI (réseau) :
   * @param {string}  config.host              - IP du terminal
   * @param {number}  [config.port=80]         - Port HTTP
   * @param {string}  [config.user='admin']    - Utilisateur
   * @param {string}  [config.password='']     - Mot de passe
   * @param {boolean} [config.https=false]     - HTTPS
   */
  constructor(config = {}) {
    super('hikvision', config);
    this._mode        = config.mode || 'usb';
    this._device      = null;
    this._pollTimer   = null;
    this._lastEventTs = null;
    this._reconnTimer = null;
  }

  // ── Détection ────────────────────────────────────────────

  async detect() {
    if (this._mode === 'isapi') return !!(this.config.host);

    try {
      const hid     = await loadHID();
      const devices = hid.devices();
      return this._findHikDevice(devices) !== null;
    } catch {
      return false;
    }
  }

  // ── Connexion ────────────────────────────────────────────

  async connect() {
    if (this._mode === 'usb') {
      await this._connectUSB();
    } else {
      await this._connectISAPI();
    }
  }

  async disconnect() {
    this._clearTimers();
    if (this._device) {
      try { this._device.close(); } catch (_) {}
      this._device = null;
    }
    this.connected = false;
    this.emit('disconnected');
  }

  // ── Mode USB ──────────────────────────────────────────────

  async _connectUSB() {
    const hid     = await loadHID();
    const devices = hid.devices();
    const target  = this._findHikDevice(devices);

    if (!target) {
      throw new Error('Aucun lecteur Hikvision USB détecté.');
    }

    this.log(`Connexion USB : ${target.product || 'Hikvision'} `
           + `(${target.vendorId.toString(16)}:${target.productId.toString(16)})`);

    try {
      this._device = new hid.HID(target.vendorId, target.productId);
    } catch (err) {
      throw new Error(`Impossible d'ouvrir le lecteur Hikvision USB : ${err.message}`);
    }

    this._device.on('data',  (data) => this._onUSBData(data));
    this._device.on('error', (err)  => this._onUSBError(err));

    this.connected = true;
    const name = target.product || 'Hikvision USB';
    this.emitStatus('connected', `${name} connecté`);
    this.emit('connected', { deviceName: name });
  }

  _findHikDevice(devices) {
    const { vendorId, productId } = this.config;

    if (vendorId && productId) {
      return devices.find(d => d.vendorId === vendorId && d.productId === productId) || null;
    }

    return devices.find(d =>
      HIKVISION_DEVICES.some(k => k.vendorId === d.vendorId && k.productId === d.productId)
    ) || null;
  }

  // ── Décodage trame USB Hikvision 0x55 0xAA ───────────────

  _onUSBData(data) {
    const bytes = new Uint8Array(data);

    // Vérification SOF
    if (bytes[0] !== HIK_SOF_1 || bytes[1] !== HIK_SOF_2) {
      // Trame non-Hikvision : fallback ASCII
      const text = Buffer.from(bytes).toString('ascii').replace(/\0/g, '').trim();
      if (/^[a-zA-Z0-9]{2,20}$/.test(text)) {
        this.emitFingerprint(text, { quality: 80 });
      }
      return;
    }

    const cmd     = bytes[2];
    const len     = (bytes[3] << 8) | bytes[4];
    const payload = bytes.slice(5, 5 + len);

    if (cmd === HIK_CMD_ID_OK) {
      const employeeId = this._decodeHikvisionId(payload);
      const quality    = payload[8] || 85;
      if (employeeId) {
        this.log(`Identification OK → ID: ${employeeId}, qualité: ${quality}`);
        this.emitFingerprint(employeeId, { quality });
      }
    } else if (cmd === HIK_CMD_ID_FAIL) {
      this.warn('Empreinte non reconnue par le périphérique');
      this.emitError('NO_MATCH', 'Empreinte non reconnue');
    }
  }

  _decodeHikvisionId(payload) {
    // Octets 0–7 : ID employé en ASCII (trame Hikvision)
    return Buffer.from(payload.slice(0, 8)).toString('ascii').replace(/\0/g, '').trim() || null;
  }

  _onUSBError(err) {
    this.warn('Erreur USB:', err.message);
    this.connected = false;
    this._device   = null;
    this.emit('disconnected', { unexpected: true });
    this._scheduleReconnect();
  }

  // ── Mode ISAPI (réseau) ───────────────────────────────────

  async _connectISAPI() {
    const { host, port = 80, user = 'admin', password = '', https: useHttps = false } = this.config;
    this._isapiBase    = `${useHttps ? 'https' : 'http'}://${host}:${port}/ISAPI`;
    this._isapiHeaders = {
      'Authorization': `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    };
    this._lastEventTs  = new Date(Date.now() - 60_000); // 1 min en arrière pour le démarrage

    // Vérification de connectivité
    try {
      const res = await fetch(`${this._isapiBase}/System/deviceInfo`, { headers: this._isapiHeaders });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const name = data?.DeviceInfo?.model || `Hikvision @ ${host}`;
      this.log(`ISAPI connecté : ${name}`);
      this.connected = true;
      this.emitStatus('connected', `${name} connecté via ISAPI`);
      this.emit('connected', { deviceName: name });
    } catch (err) {
      throw new Error(`ISAPI inaccessible sur ${host}:${port} — ${err.message}`);
    }

    // Démarrage du polling
    this._startISAPIPolling();
  }

  _startISAPIPolling() {
    const poll = async () => {
      if (!this.connected) return;
      try {
        await this._fetchISAPIEvents();
      } catch (err) {
        this.warn('Erreur polling ISAPI:', err.message);
      }
      this._pollTimer = setTimeout(poll, ISAPI_POLL_INTERVAL_MS);
    };
    this._pollTimer = setTimeout(poll, 1000);
  }

  async _fetchISAPIEvents() {
    const from = this._lastEventTs;
    const to   = new Date();

    const body = JSON.stringify({
      AcsEventCond: {
        searchID:             '1',
        searchResultPosition: 0,
        maxResults:           50,
        major:                5,
        minor:                75,
        startTime:            from.toISOString().replace(/\.\d{3}Z$/, '+00:00'),
        endTime:              to.toISOString().replace(/\.\d{3}Z$/, '+00:00'),
      },
    });

    const res = await fetch(`${this._isapiBase}/AccessControl/AcsEvent?format=json`, {
      method:  'POST',
      headers: this._isapiHeaders,
      body,
    });

    if (!res.ok) return;
    const data = await res.json();
    const events = data?.AcsEvent?.InfoList || [];

    for (const e of events) {
      const employeeId = e.employeeNoString || String(e.employeeNo || '');
      if (employeeId) {
        this.log(`ISAPI event → ID: ${employeeId}`);
        this.emitFingerprint(employeeId, { quality: 90 });
      }
    }

    this._lastEventTs = to;
  }

  // ── Utilitaires ───────────────────────────────────────────

  _scheduleReconnect() {
    this._clearTimers();
    this.emitStatus('reconnecting', 'Reconnexion Hikvision...');
    this._reconnTimer = setTimeout(() => this.connect().catch(() => this._scheduleReconnect()), 5000);
  }

  _clearTimers() {
    if (this._pollTimer)  { clearTimeout(this._pollTimer);  this._pollTimer  = null; }
    if (this._reconnTimer){ clearTimeout(this._reconnTimer); this._reconnTimer = null; }
  }
}
