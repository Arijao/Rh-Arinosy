// ============================================================
// main.js — Point d'entrée de l'application (ES Module)
// ============================================================

import { dbManager, state, loadData } from './state.js';
import { initializeAudio } from './utils/audio.js';
import { initializeCurrencyInputs } from './utils/format.js';
import InitializationManager from './utils/initializationManager.js';

import { initializeTheme, setCurrentDate, setCurrentMonth,
         showSection, updateLastBackupInfo, toggleSettings,
         toggleNavMenu, navigateToSection, initializeRouting } from './ui/navigation.js';

import { initStats, updateStats, displayDashboardCharts, runSmartChecks } from './ui/stats.js';
import { initEmployees, displayEmployees, openAddEmployeeModal } from './ui/employees.js';
import { initGroups, displayGroups, populateGroupSelects,
         populateEmployeeSelects, showMasseSalairePreview, applyMasseSalaire, cancelGroupEdit } from './ui/groups.js';
import { initAttendance, displayAttendance } from './ui/attendance.js';
import { initQR, startQRScan, stopQRScan, displayQRAttendance,
         generateAllQRCodes, downloadQRFromDB, printAllQRCodes, filterQRCodes,
         handleQRImageUpload } from './ui/qr.js';
import { initFacePresence } from './face/recognition.js';
import { initAdvances, displayAdvances } from './ui/advances.js';
import { initPayroll, calculatePayroll, handlePayrollGroupChange,
         handlePayrollEmployeeChange, toggleAdvanceDaysInput, displayPayments } from './ui/payroll.js';
import { exportData, importData, resetAllData, handleImportedFile } from './ui/data-manager.js';
import { initAuth, checkSession, logout } from './ui/auth.js';
import { showToast } from './utils/notifications.js';
import { showNotification } from './utils/dialog-manager.js';
import { initScanMenu, toggleScanMethodMenu, filterScanMethod, refreshScanCard, navigateToScanSection } from './ui/scan-menu.js';
import { initRemarks } from './ui/remarks.js';

// Exposer importData IMMÉDIATEMENT (avant que l'HTML ne l'appelle)
window.importData = importData;

// -------------------------------------------------------
// Initialisation principale
// -------------------------------------------------------

async function init() {
  try {
    console.log('🔄 Initialisation RH RiseVanilla...');
    console.log('📍 Checkpoint 1: init() appelée');
    
    console.log('📍 Checkpoint 2: initializeAudio...');
    initializeAudio();
    console.log('✅ Audio initialisé');
    
    // Diagnostic pré-initialisation
    console.log('📍 Checkpoint 3: Diagnostic préalable...');
    const diagnosis = await dbManager.diagnose();
    console.log('✅ Diagnostic fait:', diagnosis);
    if (!diagnosis.available) {
      console.error('⚠️  Problème IndexedDB détecté:', diagnosis.error);
    }
    
    console.log('📍 Checkpoint 4: Appel dbManager.init()...');
    await dbManager.init();
    console.log('✅ dbManager.init() complétée');
    
    console.log('📍 Checkpoint 5: Appel loadData()...');
    await loadData();
    console.log('✅ loadData() complétée');

    // Auth
    console.log('📍 Checkpoint 6: Initialisation Auth...');
    await initAuth();
    const ok = await checkSession();
    if (!ok) {
      // Login page shown, app will init after login
      // Register callback for after login
      window._bootAppAfterLogin = _bootApp;
      console.log('⏸️  Auth non complétée, attente du login');
      return;
    }

    console.log('📍 Checkpoint 7: Appel _bootApp()...');
    await _bootApp();
    console.log('✅ _bootApp() complétée');

  } catch (err) {
    console.error('❌ Erreur init:', err);
    console.error('📋 Trace complète:', err.stack);
    
    // Afficher le diagnostic
    console.log('\n🔍 Diagnostic IndexedDB:');
    dbManager.printDiagnostic();
    
    // Essayer de récupérer les données anyways
    console.log('\n⚙️  Tentative de récupération de données...');
    try {
      const storeData = await dbManager.getStoreSizes();
      console.log('✅ Stores trouvés:', storeData);
    } catch (recoveryErr) {
      console.error('❌ Impossible de récupérer les données:', recoveryErr);
    }
    
    // Afficher un message d'erreur à l'utilisateur
    const statusEl = document.getElementById('dbStatusText');
    if (statusEl) {
      statusEl.innerHTML = `
        <div style="color: #EF4444; padding: 16px; background: rgba(239,68,68,0.1); border-radius: 8px; text-align: left;">
          <h3 style="margin: 0 0 8px 0;">Erreur d'initialisation</h3>
          <p style="margin: 0 0 8px 0;">${err.message}</p>
          <p style="margin: 0; font-size: 12px; color: #999;">
            Consultez la console (F12) pour plus de détails.<br/>
            Commandes de debug: <code>_dbDiagnostic.printLog()</code>, <code>await _dbDiagnostic.advanced()</code>
          </p>
        </div>
      `;
    }
    
    dbManager.updateDBStatus('Erreur d\'initialisation', 'error');
    
    // Exposer des fonctions de récupération d'urgence
    window._emergencyRecovery = {
      retry: init,
      checkDatabase: () => dbManager.diagnose(),
      showLogs: () => dbManager.printDiagnostic(),
      exportDiagnostics: () => dbManager.exportDiagnosticData(),
    };
    
    console.log('\n🔧 Fonctions de récupération disponibles:');
    console.log('  _emergencyRecovery.retry() - Réessayer l\'initialisation');
    console.log('  _emergencyRecovery.checkDatabase() - Vérifier IndexedDB');
    console.log('  _emergencyRecovery.showLogs() - Afficher les logs');
    console.log('  _emergencyRecovery.exportDiagnostics() - Exporter diagnostic');
  }
}

export async function _bootApp() {
  console.log('🚀 Démarrage application...');

  // Init modules
  initStats();
  initEmployees();
  initGroups();
  initAttendance();
  initQR();
  initFacePresence();
  initAdvances();
  initPayroll();
  initRemarks();

  // UI de base
  initializeTheme();
  initializeRouting(); // Initialiser le routing avec History API
  setCurrentDate();
  setCurrentMonth();
  initializeCurrencyInputs();
  populateGroupSelects();
  populateEmployeeSelects();
  updateLastBackupInfo();

  // Premier affichage
  updateStats();
  displayDashboardCharts();
  runSmartChecks();
  initScanMenu(); // initialise le menu scan après que les stats sont calculées

  // ✅ OFFLINE-FIRST: Pré-charger les modèles face-api en arrière-plan
  // Cela va améliorer les performances pour la reconnaissance faciale même offline
  // IMPORTANT: Ne pas bloquer le démarrage de l'app si ça échoue
  if (navigator.onLine) {
    console.log('📡 Online: Pre-caching facial recognition models...');
    (async () => {
      try {
        const { modelCache } = await import('./utils/model-cache.js');
        await modelCache.initialize();
        const success = await modelCache.loadAllModels().catch(err => {
          console.warn('⚠️ Background model caching failed (OK, will use network):', err.message);
          return false;
        });
        if (success) {
          console.log('✅ Models pre-cached successfully');
        }
      } catch (err) {
        console.warn('⚠️ Model cache init failed (OK, app will work):', err.message);
      }
    })();
  } else {
    console.log('📴 Offline mode: Using cached models if available');
  }

  // Exposer les fonctions globales utilisées par les onclick HTML
  _exposeGlobals();

  console.log('✅ Application prête!');
}

// -------------------------------------------------------
// Globals exposés pour les onclick="..." HTML inline
// Tout ce qui est appelé directement depuis le HTML
// -------------------------------------------------------

function _exposeGlobals() {
  // Navigation
  window.showSection        = showSection;
  window.navigateToSection  = navigateToSection;
  window.toggleNavMenu      = toggleNavMenu;
  window.toggleSettings     = toggleSettings;
  window.toggleTheme        = () => import('./ui/navigation.js').then(m => m.toggleTheme());
  window.changeTheme        = (v) => import('./ui/navigation.js').then(m => m.changeTheme(v));
  window._showSection       = showSection;

  // Employees
  window.openAddEmployeeModal = openAddEmployeeModal;
  window._displayEmployees    = displayEmployees;

  // Groups
  window.cancelGroupEdit       = cancelGroupEdit;
  window.showMasseSalairePreview = showMasseSalairePreview;
  window.applyMasseSalaire     = applyMasseSalaire;

  // Attendance (NEW MANAGER)
  // Handled by attendance-manager.js - no longer direct calls needed
  
  // QR
  window.startQRScan        = startQRScan;
  window.stopQRScan         = stopQRScan;
  window.refreshQRAttendance = () => { displayQRAttendance(); };
  window.generateAllQRCodes = generateAllQRCodes;
  window.downloadAllQRCodes = () => { /* batch handled in qr.js */ };
  window.printAllQRCodes    = printAllQRCodes;
  window.filterQRCodes      = filterQRCodes;
  window.clearQRSearch      = () => { document.getElementById('qrSearchInput').value = ''; filterQRCodes(); };
  window.handleQRImageUpload = handleQRImageUpload;
  window.exportQRAttendancePDF = () => import('./ui/reports.js').then(m => m.exportQRAttendancePDF?.());
  window.startQRScanForStatusSearch = () => { startQRScan('status-search'); };

  // Payroll
  window.calculatePayroll           = calculatePayroll;
  window.handlePayrollGroupChange   = handlePayrollGroupChange;
  window.handlePayrollEmployeeChange= handlePayrollEmployeeChange;
  window.toggleAdvanceDaysInput     = toggleAdvanceDaysInput;

  // Advances
  window.exportAdvances = (fmt) => import('./ui/reports.js').then(m => m.exportAdvances(fmt));

  // Reports & STC
  window.exportGlobalReport      = () => import('./ui/reports.js').then(m => m.exportGlobalReport());
  window.exportAttendanceReport  = () => import('./ui/reports.js').then(m => m.exportAttendanceReport());
  window.generatePayrollPDFReport= () => import('./ui/reports.js').then(m => m.generatePayrollPDFReport());
  window.calculateSTC            = () => import('./ui/stc.js').then(m => m.calculateSTC());
  window.calculateSalaryEstimation = () => import('./ui/estimation.js').then(m => m.calculateSalaryEstimation());

  // Search
  window.handleSmartSearch       = () => import('./ui/search.js').then(m => m.handleSmartSearch());
  window._handleSmartSearch      = () => import('./ui/search.js').then(m => m.handleSmartSearch());
  window.selectEmployeeForStat   = (id) => import('./ui/search.js').then(m => m.selectEmployeeForStat(id));
  window._selectEmployeeForStat  = (id) => import('./ui/search.js').then(m => m.selectEmployeeForStat(id));
  window.openFaceRecognitionForStatusSearch = () =>
    import('./face/recognition.js').then(m => m.openFaceRecognitionForStatusSearch?.());

  // Face
  window.openFacePointageModal   = () => import('./face/recognition.js').then(m => m.openFacePointageModal());
  window.startFaceScanForSelection = (p) => import('./face/recognition.js').then(m => m.startFaceScanForSelection(p));
  window.openFaceRecognitionForAdvanceSearch = () => { window.startFaceScanForSelection?.('advances-search'); };
  window.openFaceRecognitionForPaymentSearch = () => { window.startFaceScanForSelection?.('payments-search'); };
  window._openEnrollmentModal    = (id) => import('./face/recognition.js').then(m => m.openEnrollmentModal(id));

  // Data management
  window.exportData    = exportData;
  window.importData    = importData;
  window.resetAllData  = resetAllData;

  // Auth
  window.lockApp       = logout;

  // QR settings
  window.updateQRSettings = () => {
    state.qrSettings.size  = parseInt(document.getElementById('qrSizeSelect')?.value) || 256;
    state.qrSettings.color = document.getElementById('qrColorSelect')?.value || '#6750A4';
    import('./state.js').then(({ saveData }) => saveData());
  };

  // STC select
  window.populateSTCEmployeeSelect = () => import('./ui/stc.js').then(m => m.populateSTCEmployeeSelect());

  // Payments display
  window.displayPayments = displayPayments;

  // Toggle notification details
  window._toggleNotifDetails = (id) => import('./ui/stats.js').then(m => m.toggleNotificationDetails(id));

  // Scan method menu
  window.toggleScanMethodMenu   = toggleScanMethodMenu;
  window.filterScanMethod       = filterScanMethod;
  window.refreshScanCard        = refreshScanCard;
  window.navigateToScanSection  = navigateToScanSection;

  // Change items per page
  window.changeItemsPerPage = (type, val) => {
    const n = parseInt(val, 10);
    if (type === 'employee')       { state.pagination.employee.current = 1;       state.pagination.employee.perPage = n;       displayEmployees(); }
    else if (type === 'attendance'){ state.pagination.attendance.current = 1;     state.pagination.attendance.perPage = n;     displayAttendance(); }
    else if (type === 'advances')  { state.pagination.advances.current = 1;       state.pagination.advances.perPage = n;       displayAdvances(); }
    else if (type === 'faceAttendance') {
      state.pagination.faceAttendance.current = 1; state.pagination.faceAttendance.perPage = n;
      import('./face/recognition.js').then(m => m.displayTodayFaceAttendance?.());
    }
    else if (type === 'enrolled')  {
      state.pagination.enrolled.current = 1; state.pagination.enrolled.perPage = n;
      import('./face/recognition.js').then(m => m.displayEnrolledEmployees?.());
    }
  };

  // Dialogs & Notifications
  window.showToast = showToast;
  window.showNotification = showNotification;

  // After login: boot the app
  window._bootApp = _bootApp;
}

// -------------------------------------------------------
// Keyboard shortcuts
// -------------------------------------------------------

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    import('./state.js').then(({ saveData }) =>
      saveData().then(() => window.showAlert?.('Données sauvegardées!', 'success'))
    );
  }
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
    document.getElementById('settingsPanel')?.classList.remove('active');
    document.getElementById('settingsOverlay')?.classList.remove('active');
    if (state.isScanning) stopQRScan();
  }
});

// -------------------------------------------------------
// PWA Service Worker
// -------------------------------------------------------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = window.location.pathname.includes('/systeme-rh-behavana/') ? '/systeme-rh-behavana' : '';
    navigator.serviceWorker.register(`${base}/service-worker.js`)
      .then(r => console.log('SW enregistré:', r.scope))
      .catch(e => console.warn('SW non enregistré:', e));
  });
}

// -------------------------------------------------------
// Démarrage
// -------------------------------------------------------

// Wrapper pour init avec timeout management
async function initWithManager() {
  const manager = new InitializationManager(20000); // 20s timeout
  
  manager.onError((err) => {
    console.error('❌ Initialisation échouée:', err);
    // Afficher options de récupération après 2s
    setTimeout(() => {
      const statusEl = document.getElementById('dbStatusText');
      if (statusEl) {
        statusEl.innerHTML = `
          <div style="color: #EF4444; padding: 12px; background: rgba(239,68,68,0.1); border-radius: 8px;">
            <p style="margin: 0 0 8px 0;">Erreur d'initialisation: ${err.message}</p>
            <button onclick="location.reload()" style="padding: 6px 12px; background: #6750A4; color: white; border: none; border-radius: 4px; cursor: pointer;">
              Recharger la page
            </button>
          </div>
        `;
      }
    }, 2000);
  });

  const result = await manager.initialize(async () => {
    await init();
  });

  return result;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
