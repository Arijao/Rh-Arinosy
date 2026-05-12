// ============================================================
// js/utils/remote-camera.js — Client WebSocket côté PC
// Reçoit les données du smartphone (QR + facial) et les injecte
// dans le flux existant (QRMode / FacialMode)
//
// ⚠ CE MODULE EST ENTIÈREMENT PASSIF :
//   - Ne modifie rien à QRMode, FacialMode ou AttendanceManager
//   - Ne fait rien si le serveur Python n'est pas lancé
//   - Expose uniquement window._remoteCamera pour usage optionnel
// ============================================================

export class RemoteCamera {
  constructor() {
    this.ws            = null;
    this.wsUrl         = '';
    this.connected     = false;
    this.reconnecting  = false;
    this._reconnectTimer  = null;
    this._reconnectDelay  = 3000;
    this._pingTimer       = null;

    // Callbacks — branchés par RemoteMode
    this.onQRResult          = null;   // (employeeId: string) => void
    this.onFaceDescriptor    = null;   // (descriptor: Float32Array) => void
    this.onFaceFrame         = null;   // (dataUrl: string) => void  [fallback]
    this.onStatusChange      = null;   // (connected: boolean, label: string) => void
    this.onSmartphoneConnect = null;   // () => void
    this.onSmartphoneDisconnect = null; // () => void
  }

  // ── Connexion ───────────────────────────────────────────────
  /**
   * Se connecte au serveur WebSocket local (server.py)
   * @param {string} url  ex: ws://192.168.43.100:8765
   */
  connect(url) {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN ||
                    this.ws.readyState === WebSocket.CONNECTING)) {
      this.disconnect();
    }

    this.wsUrl = url;
    this._setStatus(false, 'Connexion...');

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      this._setStatus(false, 'URL invalide');
      console.error('[RemoteCamera] URL invalide :', url);
      return;
    }

    this.ws.onopen = () => {
      this.connected    = true;
      this.reconnecting = false;
      this._reconnectDelay = 3000;
      clearTimeout(this._reconnectTimer);

      this._setStatus(true, 'Serveur connecté');
      console.log('[RemoteCamera] ✅ Connecté au serveur :', url);

      // S'identifier comme PC
      this._send({ type: 'identify', role: 'pc' });

      // Ping keepalive toutes les 20s
      this._pingTimer = setInterval(() => {
        this._send({ type: 'ping' });
      }, 20000);
    };

    this.ws.onmessage = (evt) => {
      try {
        this._handleMessage(JSON.parse(evt.data));
      } catch (_) {
        console.warn('[RemoteCamera] Message non-JSON reçu');
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      clearInterval(this._pingTimer);
      this._setStatus(false, 'Déconnecté — reconnexion...');
      console.warn('[RemoteCamera] Connexion fermée — tentative de reconnexion');
      this._scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose sera appelé ensuite — pas de double traitement
      console.warn('[RemoteCamera] Erreur WebSocket');
    };
  }

  // ── Déconnexion propre ──────────────────────────────────────
  disconnect() {
    clearTimeout(this._reconnectTimer);
    clearInterval(this._pingTimer);
    this.reconnecting = false;

    if (this.ws) {
      this.ws.onclose = null; // Évite la reconnexion automatique
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
    this._setStatus(false, 'Déconnecté');
  }

  // ── Envoi ACK vers smartphone (après validation PC) ─────────
  /**
   * Envoie le résultat de la validation au smartphone
   * @param {'arrival'|'departure'|'blocked'|'error'|'not_found'} result
   * @param {string} name     Nom de l'employé
   * @param {string} time     HH:MM
   * @param {string} message  Message optionnel (pour blocked/error)
   */
  sendAck(result, name = '', time = '', message = '') {
    this._send({
      type:    'ack',
      result,
      name,
      time,
      message,
    });
  }

  // ── Gestion des messages entrants ───────────────────────────
  _handleMessage(msg) {
    switch (msg.type) {

      // ── Identification confirmée ──────────────────────────
      case 'identified':
        console.log('[RemoteCamera] Identifié comme PC auprès du serveur');
        // Si un smartphone était déjà connecté avant nous
        if (msg.smartphone_connected) {
          this._setStatus(true, '📱 Smartphone connecté');
          this.onSmartphoneConnect?.();
        }
        break;

      // ── Smartphone connecté ───────────────────────────────
      case 'smartphone_connected':
        this._setStatus(true, '📱 Smartphone connecté');
        console.log('[RemoteCamera] 📱 Smartphone connecté :', msg.client_id);
        this.onSmartphoneConnect?.();
        break;

      // ── Smartphone déconnecté ─────────────────────────────
      case 'smartphone_disconnected':
        this._setStatus(true, 'Serveur OK — smartphone absent');
        console.warn('[RemoteCamera] 📱 Smartphone déconnecté');
        this.onSmartphoneDisconnect?.();
        break;

      // ── Résultat QR (Mode hybride : détecté sur smartphone) ──
      case 'qr_result': {
        const employeeId = (msg.data || '').trim();
        if (!employeeId) {
          console.warn('[RemoteCamera] QR result vide');
          break;
        }
        console.log('[RemoteCamera] 📷 QR reçu :', employeeId);
        this.onQRResult?.(employeeId);
        break;
      }

      // ── Descripteur facial 128D ───────────────────────────
      case 'face_data': {
        const raw = msg.descriptor;
        if (!Array.isArray(raw) || raw.length !== 128) {
          console.warn('[RemoteCamera] Descripteur facial invalide (dim:', raw?.length, ')');
          break;
        }
        const descriptor = new Float32Array(raw);
        console.log('[RemoteCamera] 👤 Descripteur facial reçu');
        this.onFaceDescriptor?.(descriptor);
        break;
      }

      // ── Frame JPEG (fallback sans face-api sur smartphone) ──
      case 'face_frame': {
        if (msg.frame) {
          this.onFaceFrame?.(msg.frame);
        }
        break;
      }

      // ── Pong keepalive ────────────────────────────────────
      case 'pong':
        break;

      default:
        break;
    }
  }

  // ── Reconnexion automatique exponentielle ────────────────────
  _scheduleReconnect() {
    if (this.reconnecting || !this.wsUrl) return;
    this.reconnecting = true;

    this._reconnectTimer = setTimeout(() => {
      this.reconnecting = false;
      if (!this.connected && this.wsUrl) {
        console.log(`[RemoteCamera] Tentative de reconnexion (délai: ${this._reconnectDelay}ms)`);
        this.connect(this.wsUrl);
        this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, 30000);
      }
    }, this._reconnectDelay);
  }

  // ── Helpers ──────────────────────────────────────────────────
  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  _setStatus(connected, label) {
    this.onStatusChange?.(connected, label);
  }
}

// ── Instance singleton globale ────────────────────────────────
// Exposée sur window pour accès depuis remote-mode.js et les devtools
const remoteCamera = new RemoteCamera();
window._remoteCamera = remoteCamera;

export default remoteCamera;
