// ============================================================
// ui/attendance-modes/facial-mode.js — Mode présence Facial
// Reconnaissance faciale pour pointage
// ============================================================

import { state, saveAttendanceData } from '../../state.js';
import { openModal, closeModal } from '../../utils/ui.js';
import { showToast } from '../../utils/notifications.js';
import { formatDisplayTime } from '../../utils/format.js';
import { playSuccessSound, playErrorSound } from '../../utils/audio.js';
// ✅ FIX: Import de la fonction de reconnaissance par descripteur facial
import { recognizeFace } from '../../face/recognition.js';

/**
 * Classe gère le mode de présence Facial (reconnaissance faciale)
 */
export class FacialMode {
  constructor() {
    this.isScanning = false;
    this.scanStream = null;
    this.modelsLoaded = false;
    this.container = null;
    this.video = null;
    this.canvas = null;
    // ✅ FIX: Anti-spam — évite d'enregistrer plusieurs fois en rafale
    this._lastRegistrationTime = 0;
    this._REGISTRATION_COOLDOWN_MS = 3000; // 3 secondes entre deux pointages
  }

  /**
   * Initialise le mode Facial
   * @param {string} containerId - ID du conteneur
   */
  async init(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error('[FacialMode] Container not found:', containerId);
      return;
    }

    this._setupEventListeners();
    this._setupDateDefaults();
    await this._loadModels();
  }

  /**
   * Configure les event listeners
   * @private
   */
  _setupEventListeners() {
    // Les boutons Démarrer/Arrêter Scanner sont appelés via onclick handlers HTML
    // donc on ne les écoute pas ici. Les handlers HTML appellent
    // window._facialMode.startScan() et window._facialMode.stopScan() directement.

    // Date input
    this.container.querySelector('[data-attendance-date]')?.addEventListener('change', (e) => {
      this._onDateChange(e.target.value);
    });

    // Bouton arrêter scan
    this.container.querySelector('.btn-stop-facial-scan')?.addEventListener('click', () => {
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
   * Charge les modèles face-api
   * @private
   */
  async _loadModels() {
    try {
      const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
      
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);

      this.modelsLoaded = true;
      console.log('[FacialMode] Models loaded successfully');
      
      const status = this.container.querySelector('[data-facial-status]');
      if (status) {
        status.textContent = 'Modèles chargés - Prêt à scanner';
        status.classList.add('success');
      }
    } catch (error) {
      console.error('[FacialMode] Error loading models:', error);
      showToast(
        'Impossible de charger les modèles de reconnaissance faciale',
        'error'
      );
    }
  }

  /**
   * Démarre le scan facial
   */
  async startScan() {
    if (!this.modelsLoaded) {
      showToast('Les modèles ne sont pas encore chargés. Attendez...', 'info');
      return;
    }

    if (this.isScanning) this.stopScan(false);

    this.video = this.container.querySelector('[data-facial-video]');
    this.canvas = this.container.querySelector('[data-facial-canvas]');
    const overlay = this.container.querySelector('[data-facial-overlay]');
    const permMsg = this.container.querySelector('[data-facial-perm-message]');

    if (!this.video || !this.canvas) {
      console.error('[FacialMode] Video or canvas element not found');
      showToast('Éléments du scanner facial non trouvés', 'error');
      return;
    }

    // ⚠️ Sécurité: Arrête les autres modes si actifs
    if (window._qrMode?.isScanning) {
      console.log('[FacialMode] Stopping QR mode before starting facial scan');
      window._qrMode.stopScan(false);
    }

    overlay.style.display = 'block';
    permMsg.style.display = 'none';
    this.isScanning = true;

    try {
      this.scanStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user', // Caméra frontale pour reconnaissance faciale
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });

      this.video.srcObject = this.scanStream;
      this.video.setAttribute('playsinline', '');
      await this.video.play();
      this.video.style.display = 'block';

      this._detectFaces();

      const status = this.container.querySelector('[data-facial-status]');
      if (status) {
        status.textContent = '🔍 Scan en cours...';
        status.style.color = '#0EA5E9';
      }
    } catch (err) {
      this._handleCameraError(err, permMsg);
      this.stopScan();
    }
  }

  /**
   * Arrête le scan facial
   * @param {boolean} showMsg - Affiche un message
   */
  stopScan(showMsg = true) {
    if (this.scanStream) {
      this.scanStream.getTracks().forEach((t) => t.stop());
      this.scanStream = null;
    }

    this.isScanning = false;

    const video = this.container.querySelector('[data-facial-video]');
    const canvas = this.container.querySelector('[data-facial-canvas]');
    const overlay = this.container.querySelector('[data-facial-overlay]');

    if (video) video.style.display = 'none';
    if (canvas) canvas.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
  }

  /**
   * Détecte et traite les visages dans le flux vidéo
   * @private
   */
  async _detectFaces() {
    if (!this.isScanning || !this.video || !this.canvas) {
      return;
    }

    try {
      // ✅ FIX: withFaceDescriptor() est requis pour la reconnaissance d'identité
      const detections = await faceapi
        .detectAllFaces(this.video, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptors();

      // Affiche les résultats sur le canvas
      this._displayDetections(detections);

      // Si un visage est détecté, tenter la reconnaissance
      if (detections.length > 0) {
        await this._matchFaceWithEmployee(detections[0]);
      }

      // Continue la détection
      requestAnimationFrame(() => this._detectFaces());
    } catch (error) {
      console.error('[FacialMode] Detection error:', error);
      requestAnimationFrame(() => this._detectFaces());
    }
  }

  /**
   * Affiche les boîtes de détection sur le canvas
   * @private
   */
  _displayDetections(detections) {
    if (!this.canvas || !this.video) return;

    const ctx = this.canvas.getContext('2d');
    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.video, 0, 0);

    // Dessine les détections
    detections.forEach((detection) => {
      const box = detection.detection.box;
      ctx.strokeStyle = '#D0BCFF';
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x, box.y, box.width, box.height);

      // Affiche la confiance
      ctx.fillStyle = '#D0BCFF';
      ctx.font = '14px Roboto';
      ctx.fillText(
        `${Math.round(detection.detection.score * 100)}%`,
        box.x,
        box.y - 8
      );
    });
  }

  /**
   * ✅ FIX COMPLET: Identifie l'employé via FR.recognizeFace() et enregistre
   * le pointage. Ancienne version: détectait un visage (score caméra) mais
   * n'identifiait personne et n'appelait jamais _registerAttendance().
   * @private
   */
  async _matchFaceWithEmployee(detection) {
    try {
      // Anti-spam: ignorer si un pointage a été enregistré il y a moins de 3s
      const now = Date.now();
      if (now - this._lastRegistrationTime < this._REGISTRATION_COOLDOWN_MS) {
        return;
      }

      // Récupérer les employés ayant des descripteurs faciaux enrôlés
      const enrolled = state.employees.filter(
        (e) => e.face_enrolled && e.face_descriptors?.length > 0
      );

      if (!enrolled.length) {
        const status = this.container.querySelector('[data-facial-status]');
        if (status) {
          status.textContent = '⚠ Aucun employé enrôlé pour la reconnaissance';
          status.style.color = '#FF9800';
        }
        return;
      }

      // ✅ Appel à la vraie reconnaissance par descripteur (128D embedding)
      // recognizeFace() compare le descripteur du visage détecté avec tous
      // les descripteurs enrôlés via FaceMatcher (distance euclidienne ≤ 0.4)
      const result = await recognizeFace(this.video, enrolled);
      const status = this.container.querySelector('[data-facial-status]');

      if (result.success) {
        const conf = Math.round(result.confidence * 100);
        const dateInput = this.container.querySelector('[data-attendance-date]');
        const date = dateInput?.value || new Date().toISOString().split('T')[0];

        // ✅ Enregistrement réel dans state.attendance + persistance IndexedDB
        await this._registerAttendance(result.employe, date);

        // Mettre à jour le cooldown après enregistrement réussi
        this._lastRegistrationTime = Date.now();

        if (status) {
          status.textContent = `✓ ${result.employe.name} — ${conf}% confiance`;
          status.style.color = '#4CAF50';
        }

        console.log(`[FacialMode] ✅ Pointage enregistré: ${result.employe.name} (${conf}%)`);
      } else {
        if (status) {
          status.textContent = `⚠ ${result.message || 'Visage non reconnu'}`;
          status.style.color = '#FF9800';
        }
      }
    } catch (error) {
      console.error('[FacialMode] Matching error:', error);
    }
  }

  /**
   * Enregistre la présence pour un employé
   * @private
   */
  async _registerAttendance(employee, date) {
    if (!state.attendance[date]) {
      state.attendance[date] = {};
    }

    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const dayAtt = state.attendance[date];
    if (!dayAtt[employee.id]) {
      dayAtt[employee.id] = {
        arrivee: time,
        depart: null,
        method: 'FACIAL',
      };
      playSuccessSound();
    } else if (!dayAtt[employee.id].depart) {
      dayAtt[employee.id].depart = time;
      playSuccessSound();
    }

    await saveAttendanceData();
    // ✅ Rafraîchir la liste "Pointages Faciaux du Jour"
    window._displayFaceAttendance?.();
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
   * Appelé lors du changement de date
   * @private
   */
  _onDateChange(date) {
    this._refreshDisplay();
  }

  /**
   * Rafraîchit l'affichage
   * @private
   */
  _refreshDisplay() {
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

export default FacialMode;
