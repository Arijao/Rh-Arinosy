// ============================================================
// utils/external-scanner.js — Lecteur QR externe (USB / Bluetooth)
// Keyboard Wedge / HID : le lecteur se comporte comme un clavier.
// Il envoie les caractères rapidement puis termine par Enter.
//
// Intégration : importer et appeler initExternalScanner() depuis main.js
// après _bootApp(), via une seule ligne :
//   import { initExternalScanner } from './utils/external-scanner.js';
//   // puis dans _bootApp() :
//   initExternalScanner();
// ============================================================

import { state, saveAttendanceData } from '../state.js';
import { showToast }                 from './notifications.js';
import { playSuccessSound, playErrorSound } from './audio.js';

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

/** Délai max (ms) entre deux frappes pour être considéré comme un scanner */
const SCANNER_INTER_KEY_DELAY = 50;

/** Longueur minimale d'un QR code valide */
const MIN_QR_LENGTH = 6;

// ─────────────────────────────────────────────────────────────
// État interne du scanner
// ─────────────────────────────────────────────────────────────

let _buffer        = '';
let _lastKeyTime   = 0;
let _enabled       = true;   // peut être désactivé programmatiquement

// ─────────────────────────────────────────────────────────────
// Détection de la section active
// ─────────────────────────────────────────────────────────────

/**
 * Retourne l'identifiant de la section actuellement visible.
 * Priorité : variable globale currentSection (navigation.js),
 * puis première section avec classe "active" dans le DOM.
 */
function _getActiveSection() {
  if (window.currentSection) return window.currentSection;

  const active = document.querySelector('section.active, [data-section].active');
  return active?.id || active?.dataset?.section || null;
}

// ─────────────────────────────────────────────────────────────
// Routeur — dispatche selon la section active
// ─────────────────────────────────────────────────────────────

/**
 * Reçoit la valeur QR décodée et la route vers le bon module.
 * @param {string} rawValue — données brutes du QR code
 */
async function _dispatch(rawValue) {
  const value   = rawValue.trim();
  const section = _getActiveSection();

  console.log(`[ExternalScanner] QR reçu: "${value}" | Section: ${section}`);

  // ── Présence QR (section qr-presence) ──────────────────────
  if (section === 'qr-presence' || section === 'qr_presence') {
    _handleForAttendanceQR(value);
    return;
  }

  // ── Présence manuelle (section attendance) ──────────────────
  if (section === 'attendance') {
    _handleForAttendanceManual(value);
    return;
  }

  // ── Avances (section advances) ──────────────────────────────
  if (section === 'advances') {
    _handleForAdvances(value);
    return;
  }

  // ── Paie / Paiements (section payroll ou payments) ──────────
  if (section === 'payroll' || section === 'payments') {
    _handleForPayroll(value);
    return;
  }

  // ── Section non gérée : afficher un message neutre ──────────
  showToast(`QR scanné : ${value}`, 'info');
  console.warn(`[ExternalScanner] Section "${section}" non gérée pour le scan externe.`);
}

// ─────────────────────────────────────────────────────────────
// Handlers par section
// ─────────────────────────────────────────────────────────────

/**
 * Section qr-presence — utilise le même chemin que la caméra QR :
 * délègue à window._qrMode._handleQRData() s'il est disponible,
 * sinon implémente le même enregistrement directement.
 */
function _handleForAttendanceQR(employeeId) {
  // Chemin privilégié : déléguer à QRMode (même logique que la caméra)
  if (window._qrMode && typeof window._qrMode._handleQRData === 'function') {
    window._qrMode._handleQRData(employeeId);
    return;
  }

  // Fallback : enregistrement direct (même logique que QRMode._registerAttendance)
  const employee = state.employees.find(e => e.id === employeeId);
  if (!employee) {
    playErrorSound();
    showToast(`Employé non trouvé : ${employeeId}`, 'error');
    return;
  }

  const dateInput = document.querySelector('[data-attendance-date]');
  const date      = dateInput?.value || new Date().toISOString().split('T')[0];

  _registerAttendanceQR(employee, date);
}

/**
 * Section attendance (mode manuel) — enregistre l'arrivée via recordTime.
 */
function _handleForAttendanceManual(employeeId) {
  const employee = state.employees.find(e => e.id === employeeId);
  if (!employee) {
    playErrorSound();
    showToast(`Employé non trouvé : ${employeeId}`, 'error');
    return;
  }

  const dateInput  = document.getElementById('attendanceDate');
  const date       = dateInput?.value || new Date().toISOString().split('T')[0];
  const dayAtt     = state.attendance[date] || {};
  const hasArrival = dayAtt[employee.id]?.arrivee;

  // S'il a déjà une arrivée, on enregistre le départ
  const type = hasArrival && !dayAtt[employee.id]?.depart ? 'depart' : 'arrivee';

  if (typeof window._recordTime === 'function') {
    window._recordTime(employee.id, type, date, 'QR');
    playSuccessSound();
    showToast(
      `✓ ${type === 'arrivee' ? 'Arrivée' : 'Départ'} enregistré(e) : ${employee.name}`,
      'success'
    );
  } else {
    playErrorSound();
    showToast('Fonction d\'enregistrement non disponible.', 'error');
  }
}

/**
 * Section advances — remplit le formulaire avec l'employé scanné.
 */
function _handleForAdvances(employeeId) {
  const employee = state.employees.find(e => e.id === employeeId);
  if (!employee) {
    playErrorSound();
    showToast(`Employé non trouvé : ${employeeId}`, 'error');
    return;
  }

  // Remplir le select caché #advanceEmployee
  const select = document.getElementById('advanceEmployee');
  if (select) {
    // S'assurer que l'option existe
    let opt = select.querySelector(`option[value="${employee.id}"]`);
    if (!opt) {
      opt = document.createElement('option');
      opt.value       = employee.id;
      opt.textContent = employee.name;
      select.appendChild(opt);
    }
    select.value = employee.id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Remplir aussi le champ texte visible (smart-search)
  const textInput = document.getElementById('advanceEmployeeInput');
  if (textInput) {
    textInput.value = employee.name;
    // Masquer le dropdown s'il est ouvert
    const dropdown = document.getElementById('advanceEmployeeResults');
    if (dropdown) dropdown.style.display = 'none';
  }

  playSuccessSound();
  showToast(`✓ ${employee.name} sélectionné(e) pour l'avance`, 'success');

  // Focus sur le champ montant pour accélérer la saisie
  setTimeout(() => document.getElementById('advanceAmount')?.focus(), 150);
}

/**
 * Section payroll / payments — utilise la fonction déjà prévue.
 */
function _handleForPayroll(employeeId) {
  if (typeof window.selectPayrollEmployeeFromScan === 'function') {
    window.selectPayrollEmployeeFromScan(employeeId);
    playSuccessSound();
  } else {
    // Fallback manuel
    const employee = state.employees.find(e => e.id === employeeId);
    if (!employee) {
      playErrorSound();
      showToast(`Employé non trouvé : ${employeeId}`, 'error');
      return;
    }
    // Remplir le champ de recherche paie
    const input = document.getElementById('payrollEmployeeInput');
    if (input) {
      input.value = employee.name;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    playSuccessSound();
    showToast(`✓ ${employee.name} sélectionné(e)`, 'success');
  }
}

// ─────────────────────────────────────────────────────────────
// Enregistrement présence QR (fallback sans _qrMode)
// Miroir exact de QRMode._registerAttendance()
// ─────────────────────────────────────────────────────────────

async function _registerAttendanceQR(employee, date) {
  if (!state.attendance[date]) state.attendance[date] = {};

  const now    = new Date();
  const time   = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const dayAtt = state.attendance[date];

  if (!dayAtt[employee.id]) {
    dayAtt[employee.id] = { arrivee: time, method: 'QR' };
    playSuccessSound();
    showToast(`✓ Arrivée enregistrée : ${employee.name} à ${time}`, 'success');
  } else if (!dayAtt[employee.id].depart) {
    dayAtt[employee.id].depart = time;
    playSuccessSound();
    showToast(`✓ Départ enregistré : ${employee.name} à ${time}`, 'success');
  } else {
    dayAtt[employee.id] = { arrivee: time, method: 'QR' };
    playSuccessSound();
    showToast(`✓ Nouvelle arrivée : ${employee.name} à ${time}`, 'success');
  }

  await saveAttendanceData();
  window._updateStats?.();
}

// ─────────────────────────────────────────────────────────────
// Listener clavier global — détecte la saisie rapide du scanner
// ─────────────────────────────────────────────────────────────

/**
 * Renvoie true si le focus est sur un champ de saisie utilisateur.
 * Dans ce cas, le scanner ne doit PAS intercepter les touches
 * (l'utilisateur tape lui-même dans un input/textarea).
 *
 * Exception : on laisse passer si l'élément focalisé est en lecture seule
 * ou s'il ne correspond pas à un vrai champ de saisie.
 */
function _isUserTyping() {
  const el  = document.activeElement;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    // Exclure les inputs readonly/disabled (ils ne reçoivent pas de saisie utile)
    if (el.readOnly || el.disabled) return false;
    return true;
  }
  if (el.isContentEditable) return true;
  return false;
}

function _onKeyDown(e) {
  if (!_enabled) return;

  // Ignorer les touches de contrôle seules (Ctrl, Alt, Shift, Meta)
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  // Ignorer les fonctions, flèches, etc. sauf les caractères imprimables et Enter
  const isPrintable = e.key.length === 1;
  const isEnter     = e.key === 'Enter';

  if (!isPrintable && !isEnter) return;

  // Si l'utilisateur est en train de taper dans un vrai champ : ne pas intercepter
  if (_isUserTyping()) return;

  const now = Date.now();

  // Reset du buffer si trop de temps s'est écoulé (ce n'est plus un scanner)
  if (now - _lastKeyTime > SCANNER_INTER_KEY_DELAY && _buffer.length > 0) {
    // Décider si c'était un scan ou une frappe manuelle
    // Si le buffer est court (< MIN_QR_LENGTH), c'était probablement une frappe manuelle
    if (_buffer.length < MIN_QR_LENGTH) {
      _buffer = '';
    }
    // Si long mais pas terminé par Enter, on le garde quand même (caractères restants)
  }

  _lastKeyTime = now;

  if (isEnter) {
    // Fin de scan — traiter si buffer assez long
    if (_buffer.length >= MIN_QR_LENGTH) {
      const captured = _buffer;
      _buffer = '';
      // Empêcher le Enter de valider un formulaire en arrière-plan
      e.preventDefault();
      _dispatch(captured);
    } else {
      _buffer = '';
    }
    return;
  }

  // Accumuler le caractère
  _buffer += e.key;
}

// ─────────────────────────────────────────────────────────────
// API publique
// ─────────────────────────────────────────────────────────────

/**
 * Active ou désactive le scanner externe programmatiquement.
 * Utile si une modale critique est ouverte et qu'on veut l'isoler.
 */
export function setExternalScannerEnabled(enabled) {
  _enabled = enabled;
  console.log(`[ExternalScanner] ${enabled ? 'Activé' : 'Désactivé'}`);
}

/**
 * Simule un scan externe avec une valeur donnée.
 * Pratique pour les tests sans matériel physique.
 * Usage console : window._externalScanner.simulate('EMP_ID_123')
 */
export function simulateExternalScan(value) {
  console.log(`[ExternalScanner] Simulation: "${value}"`);
  _dispatch(value);
}

/**
 * Initialise le listener global pour les lecteurs QR externes.
 * À appeler une seule fois depuis main.js après _bootApp().
 */
export function initExternalScanner() {
  document.addEventListener('keydown', _onKeyDown, { capture: true });

  // Exposer l'API de debug globalement
  window._externalScanner = {
    simulate : simulateExternalScan,
    enable   : ()  => setExternalScannerEnabled(true),
    disable  : ()  => setExternalScannerEnabled(false),
    status   : ()  => console.log(`[ExternalScanner] Activé: ${_enabled} | Buffer: "${_buffer}"`),
  };

  console.log('✅ [ExternalScanner] Lecteur QR externe initialisé (USB/Bluetooth/HID)');
  console.log('   Debug : window._externalScanner.simulate("EMPLOYEE_ID") pour tester');
}
