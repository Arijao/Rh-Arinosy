// ============================================================
// biometric/biometric-service.js
// Couche transport — abstraction USB / Bluetooth / Wi-Fi
// Supporte : WebUSB, Web Bluetooth, WebSocket (réseau local)
// Testé avec : Hikvision DS-K1F820-F et génériques HID
// ============================================================

const TRANSPORT = Object.freeze({
  USB:       'usb',
  BLUETOOTH: 'bluetooth',
  WIFI:      'wifi',
  SIMULATION:'simulation',
});

// Vendor/Product IDs connus pour les lecteurs d'empreintes USB
const KNOWN_USB_DEVICES = [
  { vendorId: 0x2188, productId: 0x0058, name: 'Hikvision DS-K1F820-F' },
  { vendorId: 0x147e, productId: 0x2016, name: 'Upek TouchStrip'       },
  { vendorId: 0x08ff, productId: 0x2810, name: 'AuthenTec AES2810'     },
  { vendorId: 0x04e8, productId: 0x730a, name: 'Samsung Fingerprint'   },
  { vendorId: 0x1c7a, productId: 0x0570, name: 'LighTuning ES603'      },
];

// UUID Bluetooth GATT standard pour biométrie
const BT_SERVICE_UUID        = '0000180d-0000-1000-8000-00805f9b34fb';
const BT_CHARACTERISTIC_UUID = '00002a37-0000-1000-8000-00805f9b34fb';

// ============================================================
// Classe principale BiometricService
// ============================================================

export class BiometricService extends EventTarget {
  constructor() {
    super();
    this._transport      = null;
    this._transportType  = null;
    this._device         = null;
    this._btCharacteristic = null;
    this._wsConnection   = null;
    this._connected      = false;
    this._deviceInfo     = null;
    this._pollInterval   = null;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this.MAX_RECONNECT   = 5;
    this.RECONNECT_DELAY = 3000; // ms, exponentiel
  }

  // ── Getters ──────────────────────────────────────────────

  get connected()    { return this._connected; }
  get transportType(){ return this._transportType; }
  get deviceInfo()   { return this._deviceInfo; }

  // ── API publique ─────────────────────────────────────────

  /**
   * Détecte et connecte automatiquement le premier périphérique disponible.
   * Ordre de tentative : USB → Bluetooth → Wi-Fi (si config) → Simulation
   */
  async autoConnect(wifiConfig = null) {
    this._emit('status', { state: 'connecting', message: 'Détection du périphérique...' });

    // 1. USB via WebUSB
    if (navigator.usb) {
      try {
        const device = await this._tryConnectUSB();
        if (device) return this._setConnected(TRANSPORT.USB, device);
      } catch (err) {
        this._log('USB non disponible:', err.message);
      }
    }

    // 2. Bluetooth via Web Bluetooth
    if (navigator.bluetooth) {
      try {
        const bt = await this._tryConnectBluetooth();
        if (bt) return this._setConnected(TRANSPORT.BLUETOOTH, bt);
      } catch (err) {
        this._log('Bluetooth non disponible:', err.message);
      }
    }

    // 3. Wi-Fi / réseau local via WebSocket
    if (wifiConfig?.host) {
      try {
        const ws = await this._tryConnectWifi(wifiConfig);
        if (ws) return this._setConnected(TRANSPORT.WIFI, ws);
      } catch (err) {
        this._log('Wi-Fi non disponible:', err.message);
      }
    }

    // 4. Mode simulation (développement / démo)
    this._log('Aucun périphérique physique détecté, mode simulation activé');
    return this._setConnected(TRANSPORT.SIMULATION, null);
  }

  /**
   * Connexion USB explicite (dialogue sélecteur navigateur)
   */
  async connectUSB() {
    if (!navigator.usb) throw new Error('WebUSB non supporté par ce navigateur');
    const device = await navigator.usb.requestDevice({ filters: KNOWN_USB_DEVICES });
    await device.open();
    await device.selectConfiguration(1);
    await device.claimInterface(0);
    return this._setConnected(TRANSPORT.USB, device);
  }

  /**
   * Connexion Bluetooth explicite
   */
  async connectBluetooth() {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth non supporté');
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BT_SERVICE_UUID] }],
      optionalServices: [BT_SERVICE_UUID],
    });
    const server  = await device.gatt.connect();
    const service = await server.getPrimaryService(BT_SERVICE_UUID);
    const char    = await service.getCharacteristic(BT_CHARACTERISTIC_UUID);
    await char.startNotifications();
    char.addEventListener('characteristicvaluechanged', (e) => {
      this._handleRawData(new Uint8Array(e.target.value.buffer));
    });
    this._btCharacteristic = char;
    device.addEventListener('gattserverdisconnected', () => this._handleDisconnect());
    return this._setConnected(TRANSPORT.BLUETOOTH, device);
  }

  /**
   * Connexion Wi-Fi via WebSocket (Hikvision ISAPI ou pont local)
   * @param {{ host: string, port?: number, token?: string }} config
   */
  async connectWifi(config) {
    const ws = await this._tryConnectWifi(config);
    if (!ws) throw new Error('Impossible de joindre le périphérique réseau');
    return this._setConnected(TRANSPORT.WIFI, ws);
  }

  /**
   * Déconnexion propre
   */
  async disconnect() {
    this._clearTimers();
    try {
      if (this._transportType === TRANSPORT.USB && this._device) {
        await this._device.releaseInterface(0).catch(() => {});
        await this._device.close().catch(() => {});
      }
      if (this._transportType === TRANSPORT.BLUETOOTH && this._device?.gatt?.connected) {
        this._device.gatt.disconnect();
      }
      if (this._transportType === TRANSPORT.WIFI && this._wsConnection) {
        this._wsConnection.close(1000, 'Client disconnect');
      }
    } catch (err) {
      this._log('Erreur lors de la déconnexion:', err.message);
    }
    this._connected     = false;
    this._transportType = null;
    this._device        = null;
    this._emit('disconnected', {});
  }

  /**
   * Lance l'écoute active des empreintes (polling USB ou notifications BT/WS)
   */
  startListening() {
    if (!this._connected) throw new Error('Périphérique non connecté');
    this._clearTimers();

    if (this._transportType === TRANSPORT.USB) {
      this._startUSBPolling();
    } else if (this._transportType === TRANSPORT.SIMULATION) {
      this._startSimulation();
    }
    // BT et WS : déjà en mode push, pas de polling nécessaire
    this._emit('listening', { transport: this._transportType });
  }

  stopListening() {
    this._clearTimers();
    this._emit('stopped', {});
  }

  // ── Connexions internes ───────────────────────────────────

  async _tryConnectUSB() {
    const devices = await navigator.usb.getDevices();
    const known   = devices.find(d =>
      KNOWN_USB_DEVICES.some(k => k.vendorId === d.vendorId && k.productId === d.productId)
    );
    if (!known) return null;
    await known.open();
    try { await known.selectConfiguration(1); } catch (_) { /* déjà configuré */ }
    await known.claimInterface(0);
    this._log('USB connecté:', known.productName || known.serialNumber);
    return known;
  }

  async _tryConnectBluetooth() {
    // Pas de requestDevice silencieux possible — retourner null si aucun appareil connu
    // Le vrai connect BT passe par connectBluetooth() explicite
    return null;
  }

  async _tryConnectWifi(config) {
    const { host, port = 8765, token = '' } = config;
    const url = `ws://${host}:${port}${token ? `?token=${token}` : ''}`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error(`Timeout connexion WebSocket vers ${url}`));
      }, 5000);

      ws.onopen = () => {
        clearTimeout(timeout);
        this._attachWSListeners(ws);
        this._wsConnection = ws;
        this._log('WebSocket connecté à', url);
        resolve(ws);
      };
      ws.onerror = (err) => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket error: ${err.message || 'connexion refusée'}`));
      };
    });
  }

  _attachWSListeners(ws) {
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this._handleParsedEvent(data);
      } catch {
        this._log('Message WS non-JSON ignoré:', event.data);
      }
    };
    ws.onclose = (e) => {
      if (e.code !== 1000) this._handleDisconnect();
    };
    ws.onerror = () => this._handleDisconnect();
  }

  // ── Polling USB ───────────────────────────────────────────

  _startUSBPolling() {
    const poll = async () => {
      if (!this._connected || this._transportType !== TRANSPORT.USB) return;
      try {
        const result = await this._device.transferIn(1, 64);
        if (result.status === 'ok' && result.data.byteLength > 0) {
          this._handleRawData(new Uint8Array(result.data.buffer));
        }
      } catch (err) {
        if (err.name !== 'NetworkError') this._handleDisconnect();
      }
      if (this._connected) {
        this._pollInterval = setTimeout(poll, 200);
      }
    };
    this._pollInterval = setTimeout(poll, 200);
  }

  // ── Simulation ────────────────────────────────────────────

  _startSimulation() {
    this._log('Mode simulation : émission d\'empreintes aléatoires toutes les 8s');
    const emit = () => {
      if (!this._connected) return;
      const fakeId = String(Math.floor(Math.random() * 900) + 100);
      this._handleParsedEvent({
        type:       'fingerprint',
        employeeId: fakeId,
        quality:    Math.floor(Math.random() * 30) + 70,
        timestamp:  new Date().toISOString(),
        simulated:  true,
      });
      this._pollInterval = setTimeout(emit, 8000);
    };
    this._pollInterval = setTimeout(emit, 3000);
  }

  // ── Décodage données brutes ───────────────────────────────

  /**
   * Décode les trames binaires Hikvision / HID générique
   * Trame Hikvision : [0x55, 0xAA, cmd(1), len(2), payload(n), crc(1)]
   */
  _handleRawData(bytes) {
    // Hikvision ISAPI sur USB : trame SOF 0x55 0xAA
    if (bytes[0] === 0x55 && bytes[1] === 0xAA) {
      const cmd     = bytes[2];
      const len     = (bytes[3] << 8) | bytes[4];
      const payload = bytes.slice(5, 5 + len);

      if (cmd === 0x03) { // commande : identification OK
        const employeeId = this._decodeHikvisionId(payload);
        const quality    = payload[8] || 85;
        this._handleParsedEvent({
          type: 'fingerprint', employeeId, quality,
          timestamp: new Date().toISOString(), simulated: false,
        });
      } else if (cmd === 0x04) {
        this._emit('biometric-error', { code: 'NO_MATCH', message: 'Empreinte non reconnue' });
      }
      return;
    }

    // Fallback HID générique : essaie d'extraire un identifiant ASCII
    const text = new TextDecoder().decode(bytes).replace(/\0/g, '').trim();
    if (text.length > 0) {
      this._handleParsedEvent({
        type: 'fingerprint', employeeId: text, quality: 80,
        timestamp: new Date().toISOString(), simulated: false,
      });
    }
  }

  _decodeHikvisionId(payload) {
    // Les bytes 0-7 contiennent l'ID employé en ASCII dans la trame Hikvision
    return new TextDecoder().decode(payload.slice(0, 8)).replace(/\0/g, '').trim();
  }

  // ── Dispatch événements ───────────────────────────────────

  _handleParsedEvent(data) {
    if (data.type === 'fingerprint') {
      this._emit('fingerprint', {
        employeeId: String(data.employeeId).trim(),
        quality:    data.quality || 80,
        timestamp:  data.timestamp || new Date().toISOString(),
        simulated:  data.simulated || false,
        transport:  this._transportType,
      });
    } else if (data.type === 'error') {
      this._emit('biometric-error', { code: data.code, message: data.message });
    } else if (data.type === 'device_info') {
      this._deviceInfo = data;
      this._emit('device-info', data);
    }
  }

  _handleDisconnect() {
    if (!this._connected) return;
    this._connected = false;
    this._clearTimers();
    this._emit('disconnected', { unexpected: true });
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this._reconnectAttempts >= this.MAX_RECONNECT) {
      this._emit('status', { state: 'error', message: 'Périphérique inaccessible après plusieurs tentatives' });
      this._reconnectAttempts = 0;
      return;
    }
    const delay = this.RECONNECT_DELAY * Math.pow(1.5, this._reconnectAttempts);
    this._reconnectAttempts++;
    this._emit('status', {
      state:   'reconnecting',
      message: `Reconnexion dans ${Math.round(delay / 1000)}s (tentative ${this._reconnectAttempts}/${this.MAX_RECONNECT})`,
    });
    this._reconnectTimer = setTimeout(() => this.autoConnect(), delay);
  }

  // ── Utilitaires ───────────────────────────────────────────

  _setConnected(transportType, device) {
    this._connected     = true;
    this._transportType = transportType;
    this._device        = device;
    this._reconnectAttempts = 0;

    const deviceName = this._resolveDeviceName(device, transportType);
    this._deviceInfo = { name: deviceName, transport: transportType };

    this._emit('connected', { transport: transportType, device: deviceName });
    this._emit('status', { state: 'connected', message: `Connecté via ${transportType} — ${deviceName}` });
    return true;
  }

  _resolveDeviceName(device, type) {
    if (type === TRANSPORT.SIMULATION) return 'Simulateur biométrique';
    if (type === TRANSPORT.USB)        return device?.productName || 'Lecteur USB';
    if (type === TRANSPORT.BLUETOOTH)  return device?.name        || 'Lecteur Bluetooth';
    if (type === TRANSPORT.WIFI)       return 'Lecteur réseau';
    return 'Périphérique inconnu';
  }

  _clearTimers() {
    if (this._pollInterval)   { clearTimeout(this._pollInterval);   this._pollInterval   = null; }
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
  }

  _emit(eventName, detail) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }

  _log(...args) {
    console.log('[BiometricService]', ...args);
  }
}

// Singleton exporté — une seule instance dans toute l'app
export const biometricService = new BiometricService();
export { TRANSPORT };
