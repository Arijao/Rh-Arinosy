// ============================================================
// js/ui/attendance-modes/remote-mode.js — Mode Caméra Distante
// Orchestre la connexion smartphone ↔ PC et injecte les résultats
// dans la logique métier existante (identique à QRMode/_registerAttendance)
//
// ⚠ AUCUNE modification de QRMode, FacialMode ou AttendanceManager.
//   Ce mode est un onglet supplémentaire entièrement autonome.
// ============================================================

import { state, saveAttendanceData } from '../../state.js';
import { showToast } from '../../utils/notifications.js';
import { playSuccessSound, playGenericErrorSound, playErrorSound } from '../../utils/audio.js';
import remoteCamera from '../../utils/remote-camera.js';
import { recognizeFace } from '../../face/recognition.js';

// Clé de stockage de l'URL WS (persiste entre sessions)
const WS_URL_KEY = 'remote_camera_ws_url';
// IP gateway hotspot Android — prévisible et stable
const DEFAULT_WS_URL = 'ws://192.168.43.100:8765';

export class RemoteMode {
  constructor() {
    this.container      = null;
    this.isActive       = false;
    this._date          = new Date().toISOString().split('T')[0];
    // Cooldown anti-doublon facial (miroir du comportement FacialMode)
    this._lastFacialReg = 0;
    this._FACIAL_COOLDOWN_MS = 3000;
  }

  // ── Initialisation ──────────────────────────────────────────
  /**
   * @param {string} containerId
   */
  init(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      // Le container n'existe pas encore dans le DOM — pas d'erreur bloquante
      console.warn('[RemoteMode] Container non trouvé :', containerId);
      return;
    }
    this._render();
    this._setupEventListeners();
    this._setupRemoteCallbacks();
  }

  // ── Rendu HTML de l'onglet ──────────────────────────────────
  _render() {
    // URL sauvegardée ou valeur par défaut
    const savedUrl = localStorage.getItem(WS_URL_KEY) || DEFAULT_WS_URL;

    this.container.innerHTML = `
      <div class="remote-mode-panel" style="padding: 16px; max-width: 600px; margin: 0 auto;">

        <!-- Titre + statut -->
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
          <h3 style="font-size:16px; font-weight:700; margin:0;">📱 Caméra Distante</h3>
          <span id="remote-status-badge" class="status-badge status-disconnected">Déconnecté</span>
        </div>

        <!-- URL du serveur -->
        <div style="margin-bottom:12px;">
          <label style="font-size:13px; color:var(--muted,#888); display:block; margin-bottom:6px;">
            Adresse du serveur WebSocket
          </label>
          <div style="display:flex; gap:8px;">
            <input
              type="text"
              id="remote-ws-url"
              value="${savedUrl}"
              placeholder="ws://192.168.43.100:8765"
              style="flex:1; padding:10px 12px; border-radius:10px;
                     border:1.5px solid var(--outline,#ccc);
                     font-size:14px; font-family:monospace;
                     background:var(--surface-variant,#f5f5f5);"
            />
            <button id="remote-connect-btn" class="btn btn-primary"
              style="white-space:nowrap; padding:10px 16px; border-radius:10px;">
              Connecter
            </button>
          </div>
          <p style="font-size:12px; color:var(--muted,#888); margin-top:6px;">
            Lancez <code>python3 server.py</code> sur ce Chromebook — l'IP exacte s'affiche dans le terminal.
          </p>
        </div>

        <!-- Date -->
        <div style="margin-bottom:16px;">
          <label style="font-size:13px; color:var(--muted,#888); display:block; margin-bottom:6px;">
            Date de pointage
          </label>
          <input type="date" id="remote-date"
            value="${this._date}"
            style="padding:10px 12px; border-radius:10px;
                   border:1.5px solid var(--outline,#ccc);
                   font-size:14px;
                   background:var(--surface-variant,#f5f5f5);"
          />
        </div>

        <!-- État connexion smartphone -->
        <div id="remote-phone-status"
          style="display:flex; align-items:center; gap:10px;
                 padding:14px 16px; border-radius:12px;
                 background:var(--surface-variant,#f5f5f5);
                 margin-bottom:16px;">
          <span id="remote-phone-dot"
            style="width:10px;height:10px;border-radius:50%;
                   background:#aaa;flex-shrink:0;
                   transition:background .3s,box-shadow .3s;"></span>
          <span id="remote-phone-label" style="font-size:14px;">
            Serveur non connecté
          </span>
        </div>

        <!-- Instructions smartphone -->
        <div id="remote-instructions"
          style="padding:14px 16px; border-radius:12px;
                 border:1px solid var(--outline,#ddd);
                 font-size:13px; line-height:1.7;
                 color:var(--muted,#666);
                 margin-bottom:16px;">
          <strong style="color:var(--on-surface,#333);">Comment connecter le smartphone :</strong><br>
          1. Lancez <code>python3 server.py</code> sur ce Chromebook<br>
          2. Sur le smartphone Android, ouvrez Chrome<br>
          3. Accédez à <code id="remote-http-hint">http://[IP]:8766/smartphone.html</code><br>
          4. Saisissez l'adresse WS et appuyez sur <strong>Se connecter</strong>
        </div>

        <!-- Log des derniers scans -->
        <div style="margin-bottom:8px;">
          <label style="font-size:13px; color:var(--muted,#888); font-weight:600;">
            Derniers pointages (caméra distante)
          </label>
        </div>
        <div id="remote-scan-log"
          style="border-radius:12px; border:1px solid var(--outline,#ddd);
                 min-height:80px; max-height:200px; overflow-y:auto;
                 padding:12px; font-size:13px;">
          <p style="color:var(--muted,#aaa); text-align:center; margin:16px 0;">
            En attente de scans...
          </p>
        </div>

      </div>

      <style>
        .status-badge {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          padding: 4px 10px;
          border-radius: 20px;
        }
        .status-disconnected {
          background: rgba(239,68,68,0.1);
          color: #ef4444;
          border: 1px solid rgba(239,68,68,0.3);
        }
        .status-connecting {
          background: rgba(245,158,11,0.1);
          color: #f59e0b;
          border: 1px solid rgba(245,158,11,0.3);
        }
        .status-connected {
          background: rgba(34,197,94,0.1);
          color: #22c55e;
          border: 1px solid rgba(34,197,94,0.3);
        }
        .remote-log-entry {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 0;
          border-bottom: 1px solid var(--outline, #eee);
          font-size: 13px;
        }
        .remote-log-entry:last-child { border-bottom: none; }
        .remote-log-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .log-arrival   { background: #22c55e; }
        .log-departure { background: #0ea5e9; }
        .log-error     { background: #ef4444; }
        .log-blocked   { background: #f59e0b; }
      </style>
    `;
  }

  // ── Event listeners ─────────────────────────────────────────
  _setupEventListeners() {
    // Bouton connecter
    this.container.querySelector('#remote-connect-btn')
      ?.addEventListener('click', () => this._toggleConnection());

    // Changement date
    this.container.querySelector('#remote-date')
      ?.addEventListener('change', (e) => {
        this._date = e.target.value;
      });

    // Mise à jour hint HTTP quand l'URL WS change
    this.container.querySelector('#remote-ws-url')
      ?.addEventListener('input', (e) => {
        this._updateHttpHint(e.target.value);
      });

    this._updateHttpHint(
      this.container.querySelector('#remote-ws-url')?.value || ''
    );
  }

  // ── Callbacks RemoteCamera ───────────────────────────────────
  _setupRemoteCallbacks() {

    // Changement de statut WS (serveur)
    remoteCamera.onStatusChange = (connected, label) => {
      this._updateServerStatus(connected, label);
    };

    // Smartphone connecté
    remoteCamera.onSmartphoneConnect = () => {
      this._updatePhoneStatus(true);
      showToast('📱 Smartphone connecté — prêt à scanner', 'success');
    };

    // Smartphone déconnecté
    remoteCamera.onSmartphoneDisconnect = () => {
      this._updatePhoneStatus(false);
      showToast('📱 Smartphone déconnecté', 'warning');
    };

    // ── QR reçu → logique métier identique à QRMode ──────────
    remoteCamera.onQRResult = (employeeId) => {
      this._processQRResult(employeeId);
    };

    // ── Descripteur facial reçu → recognizeFace() existant ───
    remoteCamera.onFaceDescriptor = async (descriptor) => {
      await this._processFaceDescriptor(descriptor);
    };

    // ── Frame JPEG reçu (fallback) ────────────────────────────
    remoteCamera.onFaceFrame = async (dataUrl) => {
      await this._processFaceFrame(dataUrl);
    };
  }

  // ── Connexion / Déconnexion ──────────────────────────────────
  _toggleConnection() {
    const btn = this.container.querySelector('#remote-connect-btn');
    const url = this.container.querySelector('#remote-ws-url')?.value.trim() || '';

    if (remoteCamera.connected) {
      remoteCamera.disconnect();
      if (btn) btn.textContent = 'Connecter';
      return;
    }

    if (!url) {
      showToast('Saisissez l\'adresse WebSocket du serveur', 'error');
      return;
    }

    localStorage.setItem(WS_URL_KEY, url);
    if (btn) btn.textContent = 'Déconnecter';
    remoteCamera.connect(url);
  }

  // ── Traitement QR (logique métier identique à QRMode) ────────
  async _processQRResult(employeeId) {
    const employee = state.employees.find(e => e.id === employeeId);

    if (!employee) {
      playErrorSound();
      showToast(`Employé non trouvé : ${employeeId}`, 'error');
      remoteCamera.sendAck('not_found', '', '', 'Employé non trouvé');
      this._addLog('error', `Non trouvé : ${employeeId}`);
      return;
    }

    await this._registerAttendance(employee, this._date, 'QR-REMOTE');
  }

  // ── Traitement descripteur facial 128D ───────────────────────
  async _processFaceDescriptor(descriptor) {
    const now = Date.now();
    if (now - this._lastFacialReg < this._FACIAL_COOLDOWN_MS) return;

    const enrolled = state.employees.filter(
      e => e.face_enrolled && e.face_descriptors?.length > 0
    );
    if (!enrolled.length) return;

    try {
      // Réutilise recognizeFace() de face/recognition.js existant
      // On passe le descripteur déjà calculé via un objet synthétique
      const result = await recognizeFace(null, enrolled, descriptor);

      if (result.success) {
        this._lastFacialReg = Date.now();
        await this._registerAttendance(result.employe, this._date, 'FACIAL-REMOTE');
      } else {
        remoteCamera.sendAck('error', '', '', result.message || 'Visage non reconnu');
      }
    } catch (err) {
      console.error('[RemoteMode] Erreur reconnaissance faciale :', err);
    }
  }

  // ── Traitement frame JPEG (fallback sans face-api smartphone) ─
  async _processFaceFrame(dataUrl) {
    const now = Date.now();
    if (now - this._lastFacialReg < this._FACIAL_COOLDOWN_MS) return;

    const enrolled = state.employees.filter(
      e => e.face_enrolled && e.face_descriptors?.length > 0
    );
    if (!enrolled.length) return;

    try {
      // Crée une image temporaire pour passer à recognizeFace()
      const img = new Image();
      img.src = dataUrl;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const result = await recognizeFace(img, enrolled);

      if (result.success) {
        this._lastFacialReg = Date.now();
        await this._registerAttendance(result.employe, this._date, 'FACIAL-REMOTE');
      }
    } catch (err) {
      console.error('[RemoteMode] Erreur frame facial :', err);
    }
  }

  // ── Enregistrement présence (miroir exact de QRMode._registerAttendance) ──
  /**
   * Logique identique à QRMode et FacialMode — aucun code dupliqué
   * depuis la logique métier, simplement réutilisé ici via state.
   */
  async _registerAttendance(employee, date, method) {
    if (!state.attendance[date]) {
      state.attendance[date] = {};
    }

    const now  = new Date();
    const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const dayAtt = state.attendance[date];

    let result  = '';
    let message = '';

    if (!dayAtt[employee.id]) {
      // ── Arrivée ──────────────────────────────────────────────
      dayAtt[employee.id] = { arrivee: time, depart: null, method };
      result  = 'arrival';
      message = `✓ Arrivée : ${employee.name} à ${time}`;
      playSuccessSound();
      showToast(message, 'success');

    } else if (!dayAtt[employee.id].depart) {
      // ── Départ ───────────────────────────────────────────────
      dayAtt[employee.id].depart = time;
      result  = 'departure';
      message = `✓ Départ : ${employee.name} à ${time}`;
      playSuccessSound();
      showToast(message, 'success');

    } else {
      // ── Cycle suivant — règle des 30 minutes ─────────────────
      const depMin  = this._timeToMinutes(dayAtt[employee.id].depart);
      const nowMin  = now.getHours() * 60 + now.getMinutes();
      const elapsed = nowMin - depMin;

      if (elapsed < 30) {
        const remaining = 30 - elapsed;
        result  = 'blocked';
        message = `Bloqué — encore ${remaining} min avant de rescanner`;
        playGenericErrorSound();
        showToast(`⏱ ${message}`, 'warning');
        remoteCamera.sendAck('blocked', employee.name, time, message);
        this._addLog('blocked', `${employee.name} — bloqué (${remaining} min)`);
        return;
      }

      // Nouveau cycle autorisé
      dayAtt[employee.id] = { arrivee: time, depart: null, method };
      result  = 'arrival';
      message = `✓ Nouvelle arrivée : ${employee.name} à ${time}`;
      playSuccessSound();
      showToast(message, 'success');
    }

    await saveAttendanceData();

    // ACK vers smartphone
    remoteCamera.sendAck(result, employee.name, time);

    // Log dans le panneau
    const logType = result === 'arrival' ? 'arrival' : 'departure';
    this._addLog(logType, `${employee.name} — ${result === 'arrival' ? 'Arrivée' : 'Départ'} ${time} [${method}]`);

    // Rafraîchit l'affichage manuel si actif
    window._manualMode?.display?.();
  }

  // ── UI helpers ───────────────────────────────────────────────
  _updateServerStatus(connected, label) {
    const badge = this.container?.querySelector('#remote-status-badge');
    const btn   = this.container?.querySelector('#remote-connect-btn');

    if (!badge) return;

    badge.textContent = label;
    badge.className   = 'status-badge ' + (
      connected ? 'status-connected'
      : label.includes('Connexion') ? 'status-connecting'
      : 'status-disconnected'
    );

    if (btn) {
      btn.textContent = connected ? 'Déconnecter' : 'Connecter';
    }
  }

  _updatePhoneStatus(connected) {
    const dot   = this.container?.querySelector('#remote-phone-dot');
    const label = this.container?.querySelector('#remote-phone-label');

    if (dot) {
      dot.style.background  = connected ? '#22c55e' : '#aaa';
      dot.style.boxShadow   = connected ? '0 0 8px #22c55e' : 'none';
    }
    if (label) {
      label.textContent = connected
        ? '📱 Smartphone connecté — prêt à scanner'
        : 'Smartphone non connecté';
    }
  }

  _updateHttpHint(wsUrl) {
    const hint = this.container?.querySelector('#remote-http-hint');
    if (!hint) return;

    try {
      const url  = new URL(wsUrl.replace('ws://', 'http://').replace('wss://', 'https://'));
      hint.textContent = `http://${url.hostname}:8766/smartphone.html`;
    } catch (_) {
      hint.textContent = 'http://[IP]:8766/smartphone.html';
    }
  }

  _addLog(type, text) {
    const log = this.container?.querySelector('#remote-scan-log');
    if (!log) return;

    // Supprime le placeholder si présent
    const placeholder = log.querySelector('p');
    if (placeholder) placeholder.remove();

    const now  = new Date();
    const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    const entry = document.createElement('div');
    entry.className = 'remote-log-entry';
    entry.innerHTML = `
      <span class="remote-log-dot log-${type}"></span>
      <span style="flex:1;">${text}</span>
      <span style="color:var(--muted,#888);font-size:12px;">${time}</span>
    `;

    // Ajoute en tête de liste
    log.insertBefore(entry, log.firstChild);

    // Limite à 20 entrées
    while (log.children.length > 20) {
      log.removeChild(log.lastChild);
    }
  }

  _timeToMinutes(hhmm) {
    if (!hhmm) return 0;
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }

  // ── Cycle de vie ─────────────────────────────────────────────
  display() {
    // Rien à recharger — l'UI est statique et les callbacks sont actifs
  }

  destroy() {
    // Ne déconnecte pas le WS — la connexion doit survivre aux changements d'onglet
    // Le WS se déconnecte uniquement via le bouton "Déconnecter"
  }
}

export default RemoteMode;
