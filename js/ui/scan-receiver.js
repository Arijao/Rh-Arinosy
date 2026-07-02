// ============================================================
// scan-receiver.js — Récepteur de scans distants (téléphone)
// ============================================================

'use strict';

import { state } from '../state.js';
import { selectAdvanceEmployee, selectPayrollEmployee, selectAttendanceEmployee } from './smart-search.js';
import { processAttendanceScan } from './qr.js';
import { playSuccessSound } from '../utils/audio.js';

const SECTION_LABELS = {
  attendance: 'Présence',
  advances:   'Avance',
  payroll:    'Paie',
  employees:  'Employés',
  remarks:    'Remarques',
  dashboard:  'Tableau de bord',
  'employee-stats': 'Statut Employé',
};

let _currentSection = null;
let _ws = null;
// FIX #1 : variable manquante — était utilisée sans jamais être déclarée
// → ReferenceError silencieux avalé par le catch, routeScan() jamais appelé
let _scanQueue = Promise.resolve();

// ── Annoncer la section active au serveur ─────────────────────
export async function announceMode(section) {
  if (_currentSection === section) return;
  _currentSection = section;
  const label = SECTION_LABELS[section] || section;
  try {
    await fetch('/api/scan/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section, label }),
    });
  } catch (err) {
    console.warn('[SCAN-RECEIVER] announceMode error:', err.message);
  }
}

// ── Router un scan reçu vers l'action appropriée ──────────────
async function routeScan({ employeeId, scanType, purpose }) {
  const emp = state.employees.find(e => e.id === employeeId);
  if (!emp) {
    console.warn('[SCAN-RECEIVER] Employé introuvable:', employeeId);
    return;
  }

  console.log(`[SCAN-RECEIVER] Scan reçu — ${emp.name} (${scanType}) — mode: ${purpose}`);

  switch (purpose) {
    case 'attendance':
      await _handleAttendanceScan(emp, scanType);
      break;
    case 'advances':
      _handleAdvanceScan(emp, scanType);
      break;
    case 'payroll':
      _handlePayrollScan(emp, scanType);
      break;
    // FIX #2 : case manquant — 'status-search' tombait dans default
    // → _handleAttendanceScan appelé au lieu de remplir #smartSearchInput
    case 'employee-stats':
      _handleStatusSearchScan(emp, scanType);
      break;
    default:
      await _handleAttendanceScan(emp, scanType);
  }

  if (typeof playSuccessSound === 'function') {
    playSuccessSound();
  }

  if (typeof window.showToast === 'function') {
    window.showToast(`📡 ${emp.name} identifié(e) via téléphone (${scanType === 'qr' ? 'QR' : 'Facial'})`, 'success', 3000);
  }
}

// ── Présence : marquer présent à la date du jour ──────────────
async function _handleAttendanceScan(emp, scanType) {
  const method = scanType === 'qr' ? 'QR' : 'FACIAL';

  // Pages dédiées (QR/Facial/Biométrique) : workflow arrivée/départ complet
  if (_currentSection === 'qr-presence' || _currentSection === 'face-presence' || _currentSection === 'biometric') {
    if (typeof processAttendanceScan === 'function') {
      await processAttendanceScan(emp, method);
    }
    return;
  }

  // Page Présence classique (Saisie Manuelle) : POST direct à l'API.
  // FIX #3 : l'ancien code envoyait `value: true` (booléen).
  // manual-mode.js lit `att?.arrivee` et qr.js::displayQRAttendance lit `p?.arrivee`
  // → avec un booléen ces lectures retournent undefined, l'employé reste affiché absent.
  // La valeur doit être le même objet structuré que processAttendanceScan() produit.
  const dateInput = document.getElementById('attendanceDate');
  const date = dateInput?.value || new Date().toISOString().split('T')[0];
  const now  = new Date();
  const time = now.toTimeString().split(' ')[0].substring(0, 5);

  try {
    await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date,
        employeeId: emp.id,
        value: {
          arrivee: time,
          depart:  null,
          method,
          checks: [{ type: 'arrivee', time, timestamp: now.toISOString() }],
        },
      }),
    });
    // Le serveur broadcast 'update' → loadData() + refresh UI automatique
  } catch (err) {
    console.warn('[SCAN-RECEIVER] Erreur attendance:', err.message);
  }
}

// ── Avance : pré-remplir le formulaire d'avance ────────────────
function _handleAdvanceScan(emp, scanType) {
  if (typeof selectAdvanceEmployee === 'function') {
    selectAdvanceEmployee(emp.id);
  }
  document.getElementById('advanceAmount')?.focus();
}

// ── Paie : sélectionner l'employé dans le module paie ──────────
function _handlePayrollScan(emp, scanType) {
  if (typeof selectPayrollEmployee === 'function') {
    selectPayrollEmployee(emp.id);
  } else if (typeof window.selectPayrollEmployeeFromScan === 'function') {
    window.selectPayrollEmployeeFromScan(emp.id);
  }
}

// ── Recherche Intelligente de Statut : remplir le champ de recherche ──
// Reproduit le comportement du case 'status-search' de qr.js::handleQRScanResult
// pour les scans distants (téléphone → WebSocket → Chromebook).
function _handleStatusSearchScan(emp, scanType) {
  const input = document.getElementById('smartSearchInput');
  if (input) {
    input.value = emp.name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  window._handleSmartSearch?.();
  setTimeout(() => window._selectEmployeeForStat?.(emp.id), 300);
}

// ── WebSocket — écoute des scans entrants ─────────────────────
function _initScanListener() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${location.host}/ws`;

  function connect() {
    _ws = new WebSocket(wsUrl);

    _ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.event === 'scan') {
          _scanQueue = _scanQueue
            .then(() => routeScan(msg))
            .catch(err => console.warn('[SCAN-RECEIVER] routeScan error:', err.message));
        }
      } catch { /* ignorer */ }
    };

    _ws.onclose = () => { setTimeout(connect, 2000); };
    _ws.onerror = () => _ws.close();
  }

  connect();
}

// ── Initialisation ──────────────────────────────────────────────
export function initScanReceiver() {
  _initScanListener();

  const urlSection = new URLSearchParams(location.search).get('section') || 'dashboard';
  announceMode(urlSection);

  window.addEventListener('popstate', () => {
    const section = new URLSearchParams(location.search).get('section') || 'dashboard';
    announceMode(section);
  });

  console.log('[SCAN-RECEIVER] Récepteur de scans initialisé.');
}

window.announceScanMode = announceMode;