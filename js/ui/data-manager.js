// ============================================================
// ui/data-manager.js — Export / Import / Reset (ES Module)
// ============================================================

import { state, saveData, loadData, dbManager } from '../state.js';
import { closeModal, downloadJSON } from '../utils/ui.js';
import { showToast, openConfirm, openAlert } from '../utils/notifications.js';
import { setButtonLoading, showLoading, hideLoading } from '../utils/dialog-manager.js';
import { formatDate } from '../utils/format.js';

// ------ EXPORT ------

export async function exportData() {
  const exportBtn = document.querySelector('button[onclick*="exportData"]');
  if (exportBtn) setButtonLoading(exportBtn, true, { loadingText: 'Export...', spinner: true });

  try {
    const ts   = new Date();
    const data = {
      employees:    state.employees,
      attendance:   state.attendance,
      payrolls:     state.payrolls,
      advances:     state.advances,
      qrAttendance: state.qrAttendance,
      groups:       state.groups,
      settings:     { theme: state.currentTheme, qrSettings: state.qrSettings },
      exportDate:   ts.toISOString(),
      version:      '3.0-modular',
      dbType:       'IndexedDB-QR',
    };

    const filename = `sauvegarde-rh-behavana-${ts.toISOString().split('T')[0]}.json`;
    downloadJSON(data, filename);

    await dbManager.put('settings', { key: 'lastBackupDate', value: ts.toISOString() });
    document.getElementById('lastBackupInfo').textContent = `Dernière sauvegarde: ${formatDate(ts.toISOString())}`;
    showToast('✅ Sauvegarde téléchargée!', 'success');
  } catch (error) {
    console.error('[exportData] Erreur:', error);
    showToast('Erreur lors de l\'export.', 'error');
  } finally {
    if (exportBtn) setButtonLoading(exportBtn, false, { originalText: 'Exporter les Données' });
  }
}

// ------ IMPORT ------

export function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  // Fermer settings panel
  document.getElementById('settingsPanel')?.classList.remove('active');
  document.getElementById('settingsOverlay')?.classList.remove('active');
  setTimeout(() => handleImportedFile(file), 300);
  event.target.value = '';
}

export async function handleImportedFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data?.employees || !data?.attendance) {
      await openAlert(
        'Fichier invalide',
        'Sauvegarde corrompue ou incompatible.',
        'error'
      );
      return;
    }

    const proceed = await openConfirm(
      'Restaurer la sauvegarde?',
      `Toutes les données actuelles seront <strong>écrasées</strong>.<br/><p style="font-size:12px;color:#a0aec0;"><b>Version:</b> ${data.version || 'N/A'}</p>`,
      'Oui, restaurer',
      'Annuler'
    );

    if (!proceed) return;

    showLoading('Importation en cours...', 'Veuillez patienter');

    try {
      await new Promise(resolve => setTimeout(resolve, 300));

      state.employees    = data.employees    || [];
      state.attendance   = data.attendance   || {};
      state.payrolls     = data.payrolls     || [];
      state.advances     = data.advances     || [];
      state.qrAttendance = data.qrAttendance || [];
      state.groups       = data.groups       || [];
      if (data.settings) {
        if (data.settings.theme)      state.currentTheme = data.settings.theme;
        if (data.settings.qrSettings) state.qrSettings   = data.settings.qrSettings;
      }

      await saveData();
      await _refreshUI();

      showToast('✅ Données importées avec succès!', 'success', 3000);
    } finally {
      hideLoading();
    }
  } catch (err) {
    console.error('[handleImportedFile] Erreur:', err);
    hideLoading();
    await openAlert(
      'Erreur d\'importation',
      'Fichier invalide ou corrompu. Vérifiez que c\'est une sauvegarde valide.',
      'error'
    );
  }
}

// ------ RESET ------

export async function resetAllData() {
  if (!dbManager.isInitialized) { showToast('DB non initialisée.', 'error'); return; }
  
  const confirmed = await openConfirm(
    'Confirmation',
    'Êtes-vous <strong>absolument sûr</strong> de vouloir effacer TOUTES les données? Cette action est <strong style="color:#EF4444;">irréversible</strong>.',
    'Effacer définitivement',
    'Annuler',
    { isDanger: true }
  );
  if (!confirmed) return;

  const stores = ['groups','employees','attendance','payrolls','advances','settings','qr_attendance','qr_codes'];
  for (const s of stores) await dbManager.clear(s);

  state.employees = []; state.groups = []; state.attendance = {};
  state.payrolls  = []; state.advances = []; state.qrAttendance = [];

  await _refreshUI();
  showToast('Remise à zéro effectuée.', 'success');
}

// ------ Refresh after import/reset ------

async function _refreshUI() {
  const nav = await import('./navigation.js');
  nav.initializeTheme();
  nav.setCurrentDate();
  nav.setCurrentMonth();
  nav.updateLastBackupInfo();
  nav.showSection('dashboard');

  const grp = await import('./groups.js');
  grp.populateGroupSelects();
  grp.populateEmployeeSelects();

  const stats = await import('./stats.js');
  stats.updateStats();
  stats.displayDashboardCharts();
  stats.runSmartChecks();
}
