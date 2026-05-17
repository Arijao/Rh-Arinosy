// ============================================================
// bridge/adapters/hid.js
// Adaptateur générique pour lecteurs d'empreintes USB HID
//
// Compatible avec tout lecteur qui s'enregistre comme
// périphérique HID standard et envoie l'ID en ASCII ou BCD.
//
// Exemples : Suprema BioEntry, Anviz W1, Digital Persona U.are.U
//            en mode HID, et tout lecteur "plug & play" générique.
//
// Dépendance : node-hid  (npm install node-hid)
// ============================================================

import { BaseAdapter } from './base.js';

// Longueur minimale de payload utile (filtre le bruit USB)
const MIN_PAYLOAD_BYTES = 2;

// Délai entre deux tentatives de reconnexion (ms)
const RECONNECT_DELAY_MS = 3000;

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

export class HIDAdapter extends BaseAdapter {
  /**
   * @param {object} config
   * @param {number} [config.vendorId]   - Filtre optionnel par vendeur
   * @param {number} [config.productId]  - Filtre optionnel par produit
   * @param {number} [config.usagePage]  - Usage HID (défaut: 0)
   * @param {number} [config.inputMode]  - 'ascii' | 'bcd' | 'auto' (défaut: 'auto')
   */
  constructor(config = {}) {
    super('hid', config);
    this._device        = null;
    this._reconnectTimer = null;
  }

  // ── Détection ────────────────────────────────────────────

  async detect() {
    try {
      const hid     = await loadHID();
      const devices = hid.devices();
      return this._findCompatibleDevice(devices, hid) !== null;
    } catch {
      return false;
    }
  }

  // ── Connexion ────────────────────────────────────────────

  async connect() {
    const hid     = await loadHID();
    const devices = hid.devices();
    const target  = this._findCompatibleDevice(devices, hid);

    if (!target) {
      throw new Error('Aucun lecteur HID compatible détecté.');
    }

    this.log(`Ouverture de ${target.manufacturer || ''} ${target.product || ''} `
           + `(${target.vendorId.toString(16)}:${target.productId.toString(16)})`);

    try {
      this._device = new hid.HID(target.vendorId, target.productId);
    } catch (err) {
      throw new Error(`Impossible d'ouvrir le périphérique HID : ${err.message}`);
    }

    this._device.on('data', (data) => this._onData(data));
    this._device.on('error', (err) => this._onDeviceError(err));

    this.connected = true;
    this.emitStatus('connected', `HID connecté : ${target.product || 'Lecteur générique'}`);
    this.emit('connected', { deviceName: target.product || 'HID générique' });
  }

  async disconnect() {
    this._clearReconnect();
    if (this._device) {
      try { this._device.close(); } catch (_) {}
      this._device = null;
    }
    this.connected = false;
    this.emitStatus('disconnected', 'HID déconnecté');
    this.emit('disconnected');
  }

  // ── Sélection du périphérique ─────────────────────────────

  _findCompatibleDevice(devices) {
    const { vendorId, productId, usagePage } = this.config;

    // Filtre explicite par VID/PID si configuré
    if (vendorId && productId) {
      return devices.find(d => d.vendorId === vendorId && d.productId === productId) || null;
    }

    // Heuristique : usage page 0x0006 (Generic Device) ou 0xFF00 (Vendor-defined)
    // Les lecteurs d'empreintes HID utilisent souvent ces usage pages
    const FINGERPRINT_USAGE_PAGES = [0x0006, 0xFF00, 0xFF01, 0x0001];

    if (usagePage) {
      return devices.find(d => d.usagePage === usagePage) || null;
    }

    return devices.find(d => FINGERPRINT_USAGE_PAGES.includes(d.usagePage)) || null;
  }

  // ── Traitement des données ────────────────────────────────

  _onData(data) {
    if (!data || data.length < MIN_PAYLOAD_BYTES) return;

    const bytes = new Uint8Array(data);
    const mode  = this.config.inputMode || 'auto';

    let employeeId = null;

    if (mode === 'ascii' || (mode === 'auto' && this._looksLikeASCII(bytes))) {
      employeeId = this._decodeASCII(bytes);
    } else if (mode === 'bcd') {
      employeeId = this._decodeBCD(bytes);
    } else {
      // auto : essaie ASCII, puis BCD
      employeeId = this._decodeASCII(bytes) || this._decodeBCD(bytes);
    }

    if (employeeId) {
      this.log(`Empreinte reçue → ID: ${employeeId}`);
      this.emitFingerprint(employeeId, { quality: 80 });
    }
  }

  _onDeviceError(err) {
    this.warn('Erreur périphérique:', err.message);
    this.connected = false;
    this._device   = null;
    this.emitStatus('disconnected', `Erreur HID : ${err.message}`);
    this.emit('disconnected', { unexpected: true });
    this._scheduleReconnect();
  }

  // ── Décodage ─────────────────────────────────────────────

  /**
   * Décode les octets ASCII — supprime les caractères nuls et espaces
   */
  _decodeASCII(bytes) {
    const text = Buffer.from(bytes).toString('ascii').replace(/\0/g, '').trim();
    // Valide : chaîne numérique ou alphanumérique de 2–20 caractères
    return /^[a-zA-Z0-9]{2,20}$/.test(text) ? text : null;
  }

  /**
   * Décode BCD (Binary Coded Decimal) — utilisé par certains lecteurs
   * de cartes/empreintes pour encoder l'ID sous forme numérique
   */
  _decodeBCD(bytes) {
    let result = '';
    for (const byte of bytes) {
      if (byte === 0x00) break;
      const high = (byte >> 4) & 0x0F;
      const low  = byte & 0x0F;
      if (high > 9 || low > 9) return null; // pas du BCD valide
      result += `${high}${low}`;
    }
    result = result.replace(/^0+/, ''); // supprime les zéros initiaux
    return result.length >= 2 ? result : null;
  }

  _looksLikeASCII(bytes) {
    // Heuristique : la majorité des octets est dans la plage ASCII imprimable
    const printable = bytes.filter(b => b >= 0x20 && b <= 0x7E).length;
    return printable / bytes.length > 0.6;
  }

  // ── Reconnexion automatique ───────────────────────────────

  _scheduleReconnect() {
    this._clearReconnect();
    this.emitStatus('reconnecting', `Reconnexion dans ${RECONNECT_DELAY_MS / 1000}s...`);
    this._reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (err) {
        this.warn('Reconnexion échouée:', err.message);
        this._scheduleReconnect();
      }
    }, RECONNECT_DELAY_MS);
  }

  _clearReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }
}
