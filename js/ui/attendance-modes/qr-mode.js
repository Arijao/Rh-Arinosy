// ============================================================
// ui/attendance-modes/qr-mode.js — Mode présence QR
// Refactorisation modulaire de l'ancien qr.js
// ============================================================

import { state, saveAttendanceData } from '../../state.js';
import { dbManager } from '../../state.js';
import { openModal, closeModal } from '../../utils/ui.js';
import { showToast } from '../../utils/notifications.js';
import { formatDisplayTime } from '../../utils/format.js';
import { playSuccessSound, playGenericErrorSound, playErrorSound } from '../../utils/audio.js';

/**
 * Classe gère le mode de présence QR
 */
export class QRMode {
  constructor() {
    this.isScanning = false;
    this.scanStream = null;
    this.scanInterval = null;
    this.currentPurpose = 'attendance';
    this.container = null;
  }

  /**
   * Initialise le mode QR
   * @param {string} containerId - ID du conteneur
   */
  init(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error('[QRMode] Container not found:', containerId);
      return;
    }

    this._setupEventListeners();
    this._setupDateDefaults();
  }

  /**
   * Configure les event listeners
   * @private
   */
  _setupEventListeners() {
    // Les boutons Démarrer/Arrêter Scanner sont appelés via onclick handlers HTML
    // donc on ne les écoute pas ici. Les handlers HTML appellent
    // window._qrMode.startScan() et window._qrMode.stopScan() directement.

    // Date input
    this.container.querySelector('[data-attendance-date]')?.addEventListener('change', (e) => {
      this._onDateChange(e.target.value);
    });

    // Bouton arrêter scan
    this.container.querySelector('.btn-stop-qr-scan')?.addEventListener('click', () => {
      this.stopScan();
    });
  }

  /**
   * Définit la date par défaut (aujourd'hui)
   * @private
   */
  _setupDateDefaults() {
    const today = new Date().toISOString().split('T')[0];
    const dateInput = this.container.querySelector('[data-attendance-date]');
    if (dateInput) {
      dateInput.value = today;
    }
  }

  /**
   * Démarre le scan QR
   * @param {string} purpose - Objet du scan (attendance, payroll, etc)
   */
  async startScan(purpose = 'attendance') {
    if (this.isScanning) this.stopScan(false);

    this.currentPurpose = purpose;

    // BUG #1 FIX : résolution dynamique du container actif
    // Si la modale courante contient [data-qr-video], on l'utilise.
    // Sinon on tombe back sur this.container (section Présence).
    const activeContainer =
        document.querySelector('.modal.active [data-qr-video]')
        ? document.querySelector('.modal.active')
        : this.container;

    if (!activeContainer) {
        console.error('[QRMode] No active container found');
        showToast('Conteneur QR introuvable', 'error');
        return;
    }

    const video   = activeContainer.querySelector('[data-qr-video]');
    const overlay = activeContainer.querySelector('[data-qr-overlay]');
    const permMsg = activeContainer.querySelector('[data-qr-perm-message]'); // peut être null

    if (!video || !overlay) {
        console.error('[QRMode] Video or overlay element not found');
        showToast('Éléments du scanner QR non trouvés', 'error');
        return;
    }

    // ⚠️ Sécurité: Arrête les autres modes si actifs
    if (window._facialMode?.isScanning) {
        console.log('[QRMode] Stopping facial mode before starting QR scan');
        window._facialMode.stopScan(false);
    }

    overlay.style.display = 'block';
    if (permMsg) permMsg.style.display = 'none'; // BUG #3 FIX : guard null
    this.isScanning = true;

    try {
      this.scanStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      video.srcObject = this.scanStream;
      video.setAttribute('playsinline', '');
      video.muted = true; // requis par certains navigateurs pour autoplay

      // BUG #2 FIX : attendre que les métadonnées soient chargées
      // avant d'afficher la vidéo, pour éviter un rendu noir
      await new Promise((resolve) => {
        video.onloadedmetadata = resolve;
      });

      await video.play();
      video.style.display = 'block';

      // Animation de scan
      this._animateScanning();

      const canvas = document.createElement('canvas');
      this.scanInterval = setInterval(() => {
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          this._processQRFrame(video, canvas);
        }
      }, 200); // Réduit de 500ms à 200ms pour meilleure réactivité
    } catch (err) {
      this._handleCameraError(err, permMsg);
      this.stopScan();
    }
  }

  /**
   * Arrête le scan QR
   * @param {boolean} showMsg - Affiche un message
   */
  stopScan(showMsg = true) {
    if (this.scanStream) {
      this.scanStream.getTracks().forEach((t) => t.stop());
      this.scanStream = null;
    }

    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }

    this.isScanning = false;

    // Utilise le même container dynamique que startScan
    const activeContainer =
      document.querySelector('.modal.active [data-qr-video]')
        ? document.querySelector('.modal.active')
        : this.container;
    const video   = activeContainer?.querySelector('[data-qr-video]');
    const overlay = activeContainer?.querySelector('[data-qr-overlay]');

    if (video) video.style.display = 'none';
    if (overlay) {
      overlay.style.display = 'none';
      overlay.classList.remove('scanning');
    }

    if (showMsg && state.lastQRResult) {
      showToast(
        `✓ Scanned: ${state.lastQRResult}`,
        'success'
      );
    }
  }

  /**
   * Traite chaque frame vidéo pour détecter QR
   * @private
   */
  _processQRFrame(video, canvas) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert',
    });

    if (code) {
      this._handleQRData(code.data);
      this.stopScan();
    }
  }

  /**
   * Gère les données QR décodées
   * @private
   */
  _handleQRData(data) {
    try {
      // Assume le format est un UUID ou ID employé
      const employeeId = data.trim();

      if (!employeeId) {
        playErrorSound();
        showToast('Code QR invalide', 'error');
        return;
      }

      const employee = state.employees.find((e) => e.id === employeeId);
      if (!employee) {
        playErrorSound();
        showToast(`Employé non trouvé: ${employeeId}`, 'error');
        return;
      }

      const date = this.container.querySelector('[data-attendance-date]').value;
      this._registerAttendance(employee, date, 'QR');
    } catch (error) {
      console.error('[QRMode] Error processing QR:', error);
      playErrorSound();
    }
  }

  /**
   * Enregistre la présence
   * @private
   */
  async _registerAttendance(employee, date, method) {
    if (!state.attendance[date]) {
      state.attendance[date] = {};
    }

    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // Toggle arrivée/départ
    const dayAtt = state.attendance[date];
    if (!dayAtt[employee.id]) {
      dayAtt[employee.id] = {
        arrivee: time,
        method: method,
      };
      playSuccessSound();
      showToast(
        `✓ Arrivée enregistrée: ${employee.name} à ${time}`,
        'success'
      );
    } else if (!dayAtt[employee.id].depart) {
      dayAtt[employee.id].depart = time;
      playSuccessSound();
      showToast(
        `✓ Départ enregistré: ${employee.name} à ${time}`,
        'success'
      );
    } else {
      dayAtt[employee.id] = {
        arrivee: time,
        method: method,
      };
      playSuccessSound();
      showToast(
        `✓ Nouvelle arrivée enregistrée: ${employee.name} à ${time}`,
        'success'
      );
    }

    await saveAttendanceData();
    this._refreshDisplay();
  }

  /**
   * Gère les erreurs de caméra
   * @private
   */
  _handleCameraError(err, permMsg) {
    const messages = {
      NotFoundError: 'Aucune caméra détectée',
      NotAllowedError: 'Permission refusée. Autorisez la caméra.',
      NotReadableError: 'Caméra déjà utilisée par une autre application',
    };

    const msg = messages[err.name] || err.message;

    if (permMsg) {
      permMsg.style.display = 'flex';
      permMsg.querySelector('span').textContent = msg;
    }

    playErrorSound();
  }

  /**
   * Animate le scan overlay
   * @private
   */
  _animateScanning() {
    const overlay = this.container.querySelector('[data-qr-overlay]');
    if (overlay) {
      overlay.classList.add('scanning');
    }
  }

  /**
   * Appelé lors du changement de date
   * @private
   */
  _onDateChange(date) {
    // Actualise l'affichage si nécessaire
    this._refreshDisplay();
  }

  /**
   * Rafraîchit l'affichage
   * @private
   */
  _refreshDisplay() {
    // Hook pour que le composant parent puisse actualiser l'affichage
    if (this.onRefresh) {
      this.onRefresh();
    }
  }

  /**
   * Détruit les ressources
   */
  destroy() {
    this.stopScan(false);
  }
}

export default QRMode;
