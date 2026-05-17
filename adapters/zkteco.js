// ============================================================
// bridge/adapters/zkteco.js
// Adaptateur ZKTeco — supporte deux modes :
//
//  Mode USB  : via le module 'node-zkfp' (binding natif du SDK
//              ZKFinger) — fonctionne avec ZK4500, ZK9500, etc.
//
//  Mode TCP  : protocole ZKTeco PUSH / SDK réseau sur port 4370
//              — fonctionne avec les terminaux ZKTeco Wi-Fi/LAN
//              (ZKBioTime, K40, iClock, etc.)
//
// Dépendances :
//   USB  → npm install node-zkfp   (Windows/Linux, SDK natif requis)
//   TCP  → npm install net (natif Node.js)
// ============================================================

import net    from 'net';
import { BaseAdapter } from './base.js';

// ── Constantes protocole ZKTeco PUSH (TCP) ────────────────
const ZK_PORT_DEFAULT  = 4370;
const ZK_HEADER        = Buffer.from([0x50, 0x50, 0x82, 0x7D]); // magic bytes
const ZK_CMD_ATTLOG    = 0x000C; // commande : log de présence
const ZK_RECONNECT_MS  = 5000;

export class ZKTecoAdapter extends BaseAdapter {
  /**
   * @param {object} config
   * @param {'usb'|'tcp'} config.mode         - Mode de connexion
   *
   * Mode USB :
   * @param {number} [config.deviceIndex=0]   - Index du périphérique USB (0 = premier)
   *
   * Mode TCP :
   * @param {string} config.host              - IP du terminal ZKTeco
   * @param {number} [config.port=4370]       - Port ZKTeco PUSH
   * @param {string} [config.serialNumber]    - Numéro de série pour authentification
   */
  constructor(config = {}) {
    super('zkteco', config);
    this._mode          = config.mode || 'tcp';
    this._socket        = null;
    this._usbDevice     = null;
    this._buffer        = Buffer.alloc(0);
    this._reconnectTimer = null;
  }

  // ── Détection ────────────────────────────────────────────

  async detect() {
    if (this._mode === 'tcp') {
      // Pour TCP, on vérifie juste que l'hôte est configuré
      return !!(this.config.host);
    }

    if (this._mode === 'usb') {
      try {
        // Tente d'importer node-zkfp dynamiquement
        const zkfp = await this._loadZKFP();
        const count = zkfp.getDeviceCount();
        return count > 0;
      } catch {
        return false;
      }
    }

    return false;
  }

  // ── Connexion ────────────────────────────────────────────

  async connect() {
    if (this._mode === 'usb') {
      await this._connectUSB();
    } else {
      await this._connectTCP();
    }
  }

  async disconnect() {
    this._clearReconnect();

    if (this._socket) {
      this._socket.destroy();
      this._socket = null;
    }

    if (this._usbDevice) {
      try { this._usbDevice.close(); } catch (_) {}
      this._usbDevice = null;
    }

    this.connected = false;
    this.emit('disconnected');
  }

  // ── Mode USB (node-zkfp) ──────────────────────────────────

  async _connectUSB() {
    let zkfp;
    try {
      zkfp = await this._loadZKFP();
    } catch (err) {
      throw new Error(
        `node-zkfp non disponible : ${err.message}\n` +
        `Installez-le avec : npm install node-zkfp\n` +
        `Le SDK ZKFinger doit aussi être installé sur le système.`
      );
    }

    const deviceCount = zkfp.getDeviceCount();
    if (deviceCount === 0) {
      throw new Error('Aucun lecteur ZKTeco USB détecté. Vérifiez le branchement.');
    }

    const index = this.config.deviceIndex ?? 0;
    try {
      this._usbDevice = zkfp.openDevice(index);
    } catch (err) {
      throw new Error(`Impossible d'ouvrir le lecteur ZKTeco USB #${index} : ${err.message}`);
    }

    this.connected = true;
    const info = this._getDeviceInfo(this._usbDevice);
    this.log(`USB connecté : ${info}`);
    this.emitStatus('connected', `ZKTeco USB connecté : ${info}`);
    this.emit('connected', { deviceName: info });

    // Écoute des empreintes via callback SDK
    this._usbDevice.startCapture((err, data) => {
      if (err) {
        this.emitError('CAPTURE_ERROR', err.message);
        return;
      }
      if (data?.employeeId) {
        this.emitFingerprint(data.employeeId, { quality: data.quality || 80 });
      }
    });
  }

  _getDeviceInfo(device) {
    try {
      const sn = device.getSerialNumber?.() || 'N/A';
      return `ZKTeco S/N:${sn}`;
    } catch {
      return 'ZKTeco USB';
    }
  }

  async _loadZKFP() {
    // Import dynamique pour ne pas crasher si node-zkfp n'est pas installé
    const { default: zkfp } = await import('node-zkfp');
    return zkfp;
  }

  // ── Mode TCP (protocole ZKTeco PUSH) ─────────────────────

  async _connectTCP() {
    const host = this.config.host;
    const port = this.config.port || ZK_PORT_DEFAULT;

    if (!host) throw new Error('ZKTeco TCP : config.host requis');

    this.log(`Connexion TCP vers ${host}:${port}...`);

    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Timeout connexion TCP vers ${host}:${port}`));
      }, 8000);

      socket.connect(port, host, () => {
        clearTimeout(timeout);
        this._socket    = socket;
        this.connected  = true;

        this.log(`TCP connecté à ${host}:${port}`);
        this.emitStatus('connected', `ZKTeco réseau connecté : ${host}:${port}`);
        this.emit('connected', { deviceName: `ZKTeco @ ${host}` });

        this._attachSocketListeners(socket);

        // Initialisation : envoi du handshake ZKTeco PUSH
        this._sendHandshake(socket);

        resolve();
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        if (!this.connected) {
          reject(new Error(`Erreur TCP ZKTeco : ${err.message}`));
        } else {
          this._onSocketClose(err);
        }
      });
    });
  }

  _attachSocketListeners(socket) {
    socket.on('data',  (data) => this._onTCPData(data));
    socket.on('close', ()     => this._onSocketClose());
    socket.on('error', (err)  => this._onSocketClose(err));
  }

  // ── Protocole ZKTeco PUSH ─────────────────────────────────

  /**
   * Handshake initial — informe le terminal que le pont est prêt
   * à recevoir les événements de présence.
   */
  _sendHandshake(socket) {
    // Le terminal ZKTeco PUSH attend d'abord un ACK de connexion
    // Format : "OK" suivi d'un retour chariot (protocole simplifié)
    const ack = Buffer.from('OK\r\n');
    try { socket.write(ack); } catch (_) {}
  }

  /**
   * Parse les trames reçues du terminal ZKTeco.
   *
   * Format PUSH simplifié (protocole ASCII) :
   *   "ATTLOG\tSN=<serial>\n" (en-tête de session)
   *   "<employeeId>\t<date>\t<time>\t<status>\t<verify>\n" (log)
   *
   * Format binaire (iClock) :
   *   Header 4 bytes + longueur 2 bytes + payload
   */
  _onTCPData(data) {
    // Accumulation dans le buffer
    this._buffer = Buffer.concat([this._buffer, data]);

    // Traitement ligne par ligne (format ASCII PUSH)
    let newlineIdx;
    while ((newlineIdx = this._buffer.indexOf('\n')) !== -1) {
      const line = this._buffer.slice(0, newlineIdx).toString('utf8').trim();
      this._buffer = this._buffer.slice(newlineIdx + 1);

      if (line) this._parseTCPLine(line);
    }

    // Si le buffer grossit trop sans newline → tenter le parsing binaire
    if (this._buffer.length > 256) {
      this._parseBinaryFrame();
    }
  }

  _parseTCPLine(line) {
    // Ignorer les lignes de contrôle
    if (line.startsWith('ATTLOG') || line.startsWith('SN=') ||
        line.startsWith('GET') || line.startsWith('OK')) {
      return;
    }

    // Format log de présence : "employeeId\tdate\ttime\tstatus\tverify"
    const parts = line.split('\t');
    if (parts.length < 3) return;

    const [rawId, , , status, verify] = parts;
    const employeeId = rawId?.trim();
    if (!employeeId) return;

    // verify=1 = empreinte, verify=4 = visage, verify=0 = carte/mot de passe
    // On accepte tout sauf les types non-biométriques si on veut filtrer
    const verifyMode = parseInt(verify, 10);
    const isFingerprint = isNaN(verifyMode) || verifyMode === 1 || verifyMode === 2;

    if (!isFingerprint && this.config.fingerprintOnly) return;

    this.log(`Pointage TCP reçu → ID: ${employeeId}, mode: ${verifyMode}`);
    this.emitFingerprint(employeeId, { quality: 85 });

    // Accusé de réception au terminal
    if (this._socket) {
      try { this._socket.write('OK\r\n'); } catch (_) {}
    }
  }

  _parseBinaryFrame() {
    // Tentative de parsing du format binaire ZKTeco (iClock legacy)
    if (this._buffer.length < 8) return;
    if (!this._buffer.slice(0, 4).equals(ZK_HEADER)) {
      // Header invalide — purger le buffer
      this._buffer = Buffer.alloc(0);
      return;
    }

    const payloadLen = this._buffer.readUInt16LE(4);
    if (this._buffer.length < 8 + payloadLen) return; // pas encore complet

    const payload = this._buffer.slice(8, 8 + payloadLen);
    this._buffer  = this._buffer.slice(8 + payloadLen);

    const cmd = this._buffer.readUInt16LE(0);
    if (cmd === ZK_CMD_ATTLOG) {
      const employeeId = payload.slice(0, 9).toString('ascii').replace(/\0/g, '').trim();
      if (employeeId) this.emitFingerprint(employeeId, { quality: 85 });
    }
  }

  // ── Gestion déconnexion ───────────────────────────────────

  _onSocketClose(err) {
    if (!this.connected) return;
    this.connected = false;
    this._socket   = null;

    if (err) this.warn('Socket fermé avec erreur:', err.message);
    this.emitStatus('disconnected', 'ZKTeco TCP déconnecté');
    this.emit('disconnected', { unexpected: true });
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    this._clearReconnect();
    this.emitStatus('reconnecting', `Reconnexion ZKTeco dans ${ZK_RECONNECT_MS / 1000}s...`);
    this._reconnectTimer = setTimeout(() => this.connect().catch(() => this._scheduleReconnect()), ZK_RECONNECT_MS);
  }

  _clearReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }
}
