// ============================================================
// state.js — État global partagé (ES Module)
// Importer depuis tous les autres modules via:
//   import { state } from './state.js';
// ============================================================

import { IndexedDBManager } from './db.js';

export const dbManager = new IndexedDBManager();

// Exposer le diagnostic globalement dans la console
window._dbDiagnostic = {
  printLog: () => dbManager.printDiagnostic(),
  getLogs: () => dbManager.getDiagnosticLog(),
  exportData: async () => dbManager.exportDiagnosticData(),
  test: async () => dbManager.diagnose(),
  advanced: async () => dbManager.advancedDiagnosis(),
};

// Données métier
export const state = {
  employees:    [],
  groups:       [],
  attendance:   {},
  payrolls:     [],
  advances:     [],
  qrAttendance: [],
  remarks:      [],

  // Paramètres
  currentTheme: 'light',
  qrSettings: { size: 480, color: '#000000' },

  // Pagination
  pagination: {
    employee:      { current: 1, perPage: 20 },
    attendance:    { current: 1, perPage: 20 },
    advances:      { current: 1, perPage: 15 },
    qrAttendance:  { current: 1, perPage: 15 },
    faceAttendance:{ current: 1, perPage: 20 },
    enrolled:      { current: 1, perPage: 20 },
  },

  // Scanner QR
  isScanning:         false,
  scanStream:         null,
  scanInterval:       null,
  currentScanPurpose: null,

  // Reconnaissance faciale
  facialRecognitionMode: 'pointage', // 'pointage' | 'status-search'
};

// ---------------------------------------------------------------
// Persistance — Save / Load
// ---------------------------------------------------------------

export async function saveData() {
  try {
    if (!dbManager.isInitialized) {
      dbManager.log('⚠️  Database non initialisée, tentative de sauvegarde...', 'warn');
    }
    
    await dbManager.clear('employees');
    for (const emp of state.employees)   await dbManager.add('employees', emp);

    await dbManager.clear('groups');
    for (const grp of state.groups)      await dbManager.add('groups', grp);

    await dbManager.clear('attendance');
    for (const [date, day] of Object.entries(state.attendance))
      await dbManager.put('attendance', { date, data: day });

    await dbManager.clear('payrolls');
    for (const p of state.payrolls)      await dbManager.add('payrolls', p);

    await dbManager.clear('advances');
    for (const a of state.advances)      await dbManager.add('advances', a);

    await dbManager.clear('remarks');
    for (const r of (state.remarks || [])) await dbManager.add('remarks', r);

    await dbManager.put('settings', { key: 'theme',      value: state.currentTheme });
    await dbManager.put('settings', { key: 'qrSettings', value: state.qrSettings   });
    await dbManager.put('settings', { key: 'lastUpdated',value: new Date().toISOString() });
    
    dbManager.log(`✅ Sauvegarde complète: ${state.employees.length} employé(s)`, 'success');
  } catch (err) {
    dbManager.log(`❌ Erreur sauvegarde données: ${err.message}`, 'error');
    console.error('Erreur saveData:', err);
    throw err;
  }
}

export async function saveAttendanceData() {
  try {
    await dbManager.clear('attendance');
    for (const [date, dayAtt] of Object.entries(state.attendance)) {
      const valid = {};
      for (const empId in dayAtt) {
        if (dayAtt[empId]) valid[empId] = dayAtt[empId];
      }
      await dbManager.put('attendance', { date, data: valid });
    }
    dbManager.log(`✅ Présences sauvegardées: ${Object.keys(state.attendance).length} jour(s)`, 'success');
  } catch (err) {
    dbManager.log(`❌ Erreur sauvegarde présences: ${err.message}`, 'error');
    console.error('Erreur saveAttendanceData:', err);
    throw err;
  }
}

export async function loadData() {
  try {
    if (!dbManager.isInitialized) {
      dbManager.log('⚠️  Database non initialisée, chargement des données depuis la DB...', 'warn');
    }
    
    state.employees = await dbManager.getAll('employees');
    dbManager.log(`✅ ${state.employees.length} employé(s) chargé(s)`, 'success');

    const attRecords = await dbManager.getAll('attendance');
    state.attendance = {};
    attRecords.forEach(r => { state.attendance[r.date] = r.data; });
    dbManager.log(`✅ ${attRecords.length} enregistrement(s) de présence chargé(s)`, 'success');

    state.payrolls     = await dbManager.getAll('payrolls');
    state.advances     = await dbManager.getAll('advances');
    state.groups       = await dbManager.getAll('groups');
    state.qrAttendance = await dbManager.getAll('qr_attendance');
    state.remarks      = await dbManager.getAll('remarks');
    dbManager.log(`✅ Données complètes chargées (Groupes: ${state.groups.length}, Paies: ${state.payrolls.length}, Remarques: ${state.remarks.length})`, 'success');

    const themeSetting = await dbManager.get('settings', 'theme');
    if (themeSetting) state.currentTheme = themeSetting.value;

    const qrSetting = await dbManager.get('settings', 'qrSettings');
    if (qrSetting) state.qrSettings = qrSetting.value;
    
    dbManager.log('✅ Toutes les données chargées avec succès', 'success');
  } catch (err) {
    dbManager.log(`❌ Erreur chargement données: ${err.message}`, 'error');
    console.error('Erreur loadData:', err);
    
    // Charger les valeurs par défaut si la DB est inaccessible
    dbManager.log('⚠️  Initialisation avec valeurs par défaut', 'warn');
    state.employees = [];
    state.groups = [];
    state.attendance = {};
    state.payrolls = [];
    state.advances = [];
    state.qrAttendance = [];
    state.remarks = [];
    
    throw err; // Re-lever pour que main.js le capture
  }
}
