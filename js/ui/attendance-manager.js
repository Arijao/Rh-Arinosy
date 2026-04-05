// ============================================================
// ui/attendance-manager.js — Gestionnaire d'Attendance unifié
// Orchestre l'interface de présence centralisée avec onglets
// ============================================================

import { registerSectionCallback } from './navigation.js';
import { initTabs, createTabButton, createTabPanel } from '../utils/tabs.js';
import QRMode from './attendance-modes/qr-mode.js';
import FacialMode from './attendance-modes/facial-mode.js';
import ManualMode from './attendance-modes/manual-mode.js';

/**
 * Classe gère l'interface unifiée de présence
 */
export class AttendanceManager {
  constructor() {
    this.modes = {
      qr: new QRMode(),
      facial: new FacialMode(),
      manual: new ManualMode(),
    };
    this.tabsAPI = null;
    this.activeMode = null;
  }

  /**
   * Initialise le manager d'attendance
   */
  async init() {
    // Enregistre le callback pour la section
    registerSectionCallback('attendance', () => this.display());

    // Initialise les modes
    await this.modes.facial.init('tab-facial');
    this.modes.qr.init('tab-qr');
    this.modes.manual.init('tab-manual');

    // Initialise les onglets
    this.tabsAPI = initTabs('attendance-tabs-container', {
      initialTab: 'tab-manual',
      onTabChange: (tabId, previousId) => this._onTabChange(tabId, previousId),
      persistence: true,
      storageKey: 'attendance-active-tab',
    });

    if (!this.tabsAPI) {
      console.error('[AttendanceManager] Failed to initialize tabs');
      return;
    }

    // Setup des hooks pour refresh
    this.modes.qr.onRefresh = () => this.modes.manual.display();
    this.modes.facial.onRefresh = () => this.modes.manual.display();

    console.log('[AttendanceManager] Initialized successfully');
  }

  /**
   * Affiche la section attendance
   */
  async display() {
    const container = document.getElementById('attendanceSection');
    if (!container) {
      console.error('[AttendanceManager] Container not found');
      return;
    }

    // Sécurité: vérifie que les tabs sont initialisés
    if (!this.tabsAPI) {
      console.error('[AttendanceManager] Tabs not initialized, trying to initialize now...');
      this.tabsAPI = initTabs('attendance-tabs-container', {
        initialTab: 'tab-manual',
        onTabChange: (tabId, previousId) => this._onTabChange(tabId, previousId),
        persistence: true,
        storageKey: 'attendance-active-tab',
      });
      
      if (!this.tabsAPI) {
        console.error('[AttendanceManager] Failed to initialize tabs even on retry');
        return;
      }
    }

    // L'HTML est déjà injecté dans le DOM
    // On affiche juste le tab actif
    const activeTab = this.tabsAPI.current();
    await this._loadTabContent(activeTab);
  }

  /**
   * Appelé lors du changement d'onglet
   * @private
   */
  async _onTabChange(tabId, previousId) {
    console.log(`[AttendanceManager] Switching from ${previousId} to ${tabId}`);

    // Arrête les ressources du tab précédent
    if (previousId === 'tab-qr') {
      this.modes.qr.destroy();
    } else if (previousId === 'tab-facial') {
      this.modes.facial.destroy();
    }

    // Charge le nouveau tab
    await this._loadTabContent(tabId);
  }

  /**
   * Charge le contenu d'un tab
   * @private
   */
  async _loadTabContent(tabId) {
    switch (tabId) {
      case 'tab-qr':
        this.activeMode = 'qr';
        // Le contenu QR est déjà rendu
        break;

      case 'tab-facial':
        this.activeMode = 'facial';
        // Charge les modèles si nécessaire
        if (!this.modes.facial.modelsLoaded) {
          await this.modes.facial._loadModels();
        }
        break;

      case 'tab-manual':
        this.activeMode = 'manual';
        this.modes.manual.display();
        break;
    }
  }

  /**
   * Expose les méthodes des modes globalement pour les handlers HTML inline
   */
  exposeGlobalAPI() {
    window._manualMode = this.modes.manual;
    window._qrMode = this.modes.qr;
    window._facialMode = this.modes.facial;
    window._attendanceManager = this;
  }

  /**
   * Détruit le manager
   */
  destroy() {
    this.modes.qr.destroy();
    this.modes.facial.destroy();
    this.modes.manual.destroy();
  }
}

// Instance globale
let attendanceManager = null;

/**
 * Initialise le gestionnaire d'attendance (appelé depuis main.js)
 */
export async function initAttendance() {
  attendanceManager = new AttendanceManager();
  await attendanceManager.init();
  attendanceManager.exposeGlobalAPI();
  return attendanceManager;
}

export default AttendanceManager;
