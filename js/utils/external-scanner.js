// ============================================================
// utils/external-scanner.js — Lecteur QR externe (USB / Bluetooth)
// Keyboard Wedge / HID : le lecteur se comporte comme un clavier.
// Il envoie les caractères rapidement puis termine par Enter.
//
// Intégration : importer et appeler initExternalScanner() depuis main.js
//   import { initExternalScanner } from './utils/external-scanner.js';
//   initExternalScanner(); // dans _bootApp(), avant _exposeGlobals()
// ============================================================

import { state, saveAttendanceData } from '../state.js';
import { showToast }                  from './notifications.js';
import { playSuccessSound, playErrorSound } from './audio.js';

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

/** Délai max (ms) entre deux frappes pour être considéré comme un scanner */
const SCANNER_INTER_KEY_DELAY = 50;

/** Longueur minimale d'un QR code valide */
const MIN_QR_LENGTH = 6;

/** Délai minimum (minutes) entre deux cycles arrivée-départ complets */
const MIN_MINUTES_BETWEEN_CYCLES = 30;

// ─────────────────────────────────────────────────────────────
// État interne du scanner
// ─────────────────────────────────────────────────────────────

let _buffer      = '';
let _lastKeyTime = 0;
let _enabled     = true;

// ─────────────────────────────────────────────────────────────
// Détection de la section active
// ─────────────────────────────────────────────────────────────

function _getActiveSection() {
  if (window.currentSection) return window.currentSection;
  const active = document.querySelector('section.active, [data-section].active');
  return active?.id || active?.dataset?.section || null;
}

// ─────────────────────────────────────────────────────────────
// Utilitaire — conversion HH:MM → minutes depuis minuit
// ─────────────────────────────────────────────────────────────

function _timeToMinutes(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// ─────────────────────────────────────────────────────────────
// Règle des 30 minutes entre deux cycles arrivée-départ
// ─────────────────────────────────────────────────────────────

/**
 * Vérifie si 30 minutes se sont écoulées depuis le dernier départ.
 * Affiche un toast bloquant si ce n'est pas le cas.
 * @param {string} lastDepartTime — HH:MM du dernier départ
 * @returns {boolean} true si un nouveau cycle est autorisé
 */
function _canStartNewCycle(lastDepartTime) {
  const now        = new Date();
  const nowMin     = now.getHours() * 60 + now.getMinutes();
  const depMin     = _timeToMinutes(lastDepartTime);
  const elapsed    = nowMin - depMin;

  if (elapsed < MIN_MINUTES_BETWEEN_CYCLES) {
    const remaining = MIN_MINUTES_BETWEEN_CYCLES - elapsed;
    playErrorSound();
    showToast(
      `⏱ Nouveau cycle bloqué — encore ${remaining} min avant de pouvoir rescanner`,
      'warning'
    );
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────
// Routeur principal
// ─────────────────────────────────────────────────────────────

async function _dispatch(rawValue) {
  const value   = rawValue.trim();
  const section = _getActiveSection();

  console.log(`[ExternalScanner] QR reçu: "${value}" | Section: ${section}`);

  if (section === 'qr-presence' || section === 'qr_presence') {
    _handleForAttendanceQR(value);
    return;
  }
  if (section === 'attendance') {
    _handleForAttendanceManual(value);
    return;
  }
  if (section === 'advances') {
    _handleForAdvances(value);
    return;
  }
  if (section === 'payroll' || section === 'payments') {
    _handleForPayroll(value);
    return;
  }

  // Sections sans logique QR dédiée → Option C : menu de choix
  _showActionMenu(value, section);
}

// ─────────────────────────────────────────────────────────────
// Option C — Menu de choix pour sections non gérées
// ─────────────────────────────────────────────────────────────

function _showActionMenu(employeeId, section) {
  const employee = state.employees.find(e => e.id === employeeId);
  const empName  = employee ? employee.name : `ID: ${employeeId}`;

  // Supprimer un menu déjà ouvert
  document.getElementById('_extScannerMenu')?.remove();

  const menu = document.createElement('div');
  menu.id = '_extScannerMenu';
  menu.innerHTML = `
    <div id="_extScannerBackdrop" style="
      position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.45);
      backdrop-filter:blur(2px);animation:_esFadeIn .15s ease;
    "></div>
    <div style="
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      z-index:9999;background:var(--md-sys-color-surface,#1e293b);
      border:1px solid rgba(103,80,164,.35);border-radius:16px;
      padding:24px;min-width:300px;max-width:360px;width:90vw;
      box-shadow:0 16px 48px rgba(0,0,0,.5);animation:_esSlideUp .2s ease;
    ">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <span class="material-icons" style="color:#6750A4;font-size:22px;">qr_code_scanner</span>
        <strong style="font-size:15px;color:var(--md-sys-color-on-surface,#f1f5f9);">QR Scanné</strong>
        <button id="_extScannerClose" style="
          margin-left:auto;background:none;border:none;cursor:pointer;
          color:var(--md-sys-color-on-surface-variant,#94a3b8);
          padding:4px;border-radius:50%;display:flex;
        "><span class="material-icons" style="font-size:20px;">close</span></button>
      </div>
      <p style="
        margin:0 0 16px;font-size:13px;
        color:var(--md-sys-color-on-surface-variant,#94a3b8);
        padding:8px 12px;background:rgba(103,80,164,.08);border-radius:8px;
        display:flex;align-items:center;gap:8px;
      ">
        <span class="material-icons" style="font-size:16px;">person</span>
        <strong style="color:var(--md-sys-color-on-surface,#f1f5f9);">${empName}</strong>
      </p>
      <p style="margin:0 0 10px;font-size:12px;color:var(--md-sys-color-on-surface-variant,#94a3b8);">
        Que souhaitez-vous faire ?
      </p>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button class="_extAction" data-action="attendance" style="
          display:flex;align-items:center;gap:12px;padding:12px 14px;
          background:rgba(103,80,164,.1);border:1px solid rgba(103,80,164,.25);
          border-radius:10px;cursor:pointer;color:var(--md-sys-color-on-surface,#f1f5f9);
          font-size:14px;font-weight:500;text-align:left;width:100%;
        ">
          <span class="material-icons" style="color:#6750A4;font-size:20px;">schedule</span>
          <div>
            <div>Présence QR</div>
            <div style="font-size:11px;color:#94a3b8;font-weight:400;margin-top:2px;">Enregistrer arrivée / départ</div>
          </div>
        </button>
        <button class="_extAction" data-action="advances" style="
          display:flex;align-items:center;gap:12px;padding:12px 14px;
          background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.2);
          border-radius:10px;cursor:pointer;color:var(--md-sys-color-on-surface,#f1f5f9);
          font-size:14px;font-weight:500;text-align:left;width:100%;
        ">
          <span class="material-icons" style="color:#10b981;font-size:20px;">credit_score</span>
          <div>
            <div>Avance</div>
            <div style="font-size:11px;color:#94a3b8;font-weight:400;margin-top:2px;">Préparer une avance pour cet employé</div>
          </div>
        </button>
        <button class="_extAction" data-action="payroll" style="
          display:flex;align-items:center;gap:12px;padding:12px 14px;
          background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);
          border-radius:10px;cursor:pointer;color:var(--md-sys-color-on-surface,#f1f5f9);
          font-size:14px;font-weight:500;text-align:left;width:100%;
        ">
          <span class="material-icons" style="color:#f59e0b;font-size:20px;">price_check</span>
          <div>
            <div>Paie</div>
            <div style="font-size:11px;color:#94a3b8;font-weight:400;margin-top:2px;">Calculer la paie de cet employé</div>
          </div>
        </button>
        <button class="_extAction" data-action="status" style="
          display:flex;align-items:center;gap:12px;padding:12px 14px;
          background:rgba(14,165,233,.08);border:1px solid rgba(14,165,233,.2);
          border-radius:10px;cursor:pointer;color:var(--md-sys-color-on-surface,#f1f5f9);
          font-size:14px;font-weight:500;text-align:left;width:100%;
        ">
          <span class="material-icons" style="color:#0ea5e9;font-size:20px;">person_search</span>
          <div>
            <div>Statut employé</div>
            <div style="font-size:11px;color:#94a3b8;font-weight:400;margin-top:2px;">Voir le statut et l'historique</div>
          </div>
        </button>
      </div>
    </div>
    <style>
      @keyframes _esFadeIn  { from{opacity:0} to{opacity:1} }
      @keyframes _esSlideUp { from{transform:translate(-50%,-46%);opacity:0} to{transform:translate(-50%,-50%);opacity:1} }
      ._extAction:hover { filter:brightness(1.18); }
    </style>
  `;

  document.body.appendChild(menu);

  const _close = () => document.getElementById('_extScannerMenu')?.remove();

  document.getElementById('_extScannerClose')
    .addEventListener('click', _close);
  document.getElementById('_extScannerBackdrop')
    .addEventListener('click', _close);
  document.addEventListener('keydown', function _esc(e) {
    if (e.key === 'Escape') { _close(); document.removeEventListener('keydown', _esc); }
  });

  menu.querySelectorAll('._extAction').forEach(btn => {
    btn.addEventListener('click', () => {
      _close();
      const action = btn.dataset.action;
      const DELAY  = 300; // laisser la navigation se terminer

      if (action === 'attendance') {
        window.showSection?.('qr-presence');
        window.navigateToSection?.('qr-presence');
        setTimeout(() => _handleForAttendanceQR(employeeId), DELAY);

      } else if (action === 'advances') {
        window.showSection?.('advances');
        window.navigateToSection?.('advances');
        setTimeout(() => _handleForAdvances(employeeId), DELAY);

      } else if (action === 'payroll') {
        window.showSection?.('payroll');
        window.navigateToSection?.('payroll');
        setTimeout(() => _handleForPayroll(employeeId), DELAY);

      } else if (action === 'status') {
        window.showSection?.('employee-stats');
        window.navigateToSection?.('employee-stats');
        setTimeout(() => _handleForStatus(employeeId), DELAY);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────
// Handlers par section
// ─────────────────────────────────────────────────────────────

function _handleForAttendanceQR(employeeId) {
  // Chemin privilégié : déléguer à QRMode (même logique que la caméra)
  if (window._qrMode && typeof window._qrMode._handleQRData === 'function') {
    window._qrMode._handleQRData(employeeId);
    return;
  }

  // Fallback direct (si QRMode non disponible)
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

function _handleForAttendanceManual(employeeId) {
  const employee = state.employees.find(e => e.id === employeeId);
  if (!employee) {
    playErrorSound();
    showToast(`Employé non trouvé : ${employeeId}`, 'error');
    return;
  }

  const dateInput = document.getElementById('attendanceDate');
  const date      = dateInput?.value || new Date().toISOString().split('T')[0];
  const dayAtt    = state.attendance[date] || {};
  const rec       = dayAtt[employee.id];

  // Règle 30 min si cycle complet déjà présent
  if (rec?.arrivee && rec?.depart) {
    if (!_canStartNewCycle(rec.depart)) return;
  }

  const type = rec?.arrivee && !rec?.depart ? 'depart' : 'arrivee';

  if (typeof window._recordTime === 'function') {
    window._recordTime(employee.id, type, date, 'QR');
    playSuccessSound();
    showToast(
      `✓ ${type === 'arrivee' ? 'Arrivée' : 'Départ'} enregistré(e) : ${employee.name}`,
      'success'
    );
  } else {
    playErrorSound();
    showToast("Fonction d'enregistrement non disponible.", 'error');
  }
}

function _handleForAdvances(employeeId) {
  const employee = state.employees.find(e => e.id === employeeId);
  if (!employee) {
    playErrorSound();
    showToast(`Employé non trouvé : ${employeeId}`, 'error');
    return;
  }

  const select = document.getElementById('advanceEmployee');
  if (select) {
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

  const textInput = document.getElementById('advanceEmployeeInput');
  if (textInput) {
    textInput.value = employee.name;
    const dropdown = document.getElementById('advanceEmployeeResults');
    if (dropdown) dropdown.style.display = 'none';
  }

  playSuccessSound();
  showToast(`✓ ${employee.name} sélectionné(e) pour l'avance`, 'success');
  setTimeout(() => document.getElementById('advanceAmount')?.focus(), 150);
}

function _handleForPayroll(employeeId) {
  if (typeof window.selectPayrollEmployeeFromScan === 'function') {
    window.selectPayrollEmployeeFromScan(employeeId);
    playSuccessSound();
    return;
  }

  const employee = state.employees.find(e => e.id === employeeId);
  if (!employee) {
    playErrorSound();
    showToast(`Employé non trouvé : ${employeeId}`, 'error');
    return;
  }

  const input = document.getElementById('payrollEmployeeInput');
  if (input) {
    input.value = employee.name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  playSuccessSound();
  showToast(`✓ ${employee.name} sélectionné(e)`, 'success');
}

function _handleForStatus(employeeId) {
  const employee = state.employees.find(e => e.id === employeeId);
  if (!employee) {
    playErrorSound();
    showToast(`Employé non trouvé : ${employeeId}`, 'error');
    return;
  }

  const input = document.getElementById('smartSearchInput');
  if (input) {
    input.value = employee.name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  playSuccessSound();
  showToast(`✓ Statut de ${employee.name}`, 'success');
}

// ─────────────────────────────────────────────────────────────
// Enregistrement présence QR — fallback si _qrMode absent
// Inclut la règle des 30 minutes
// ─────────────────────────────────────────────────────────────

async function _registerAttendanceQR(employee, date) {
  if (!state.attendance[date]) state.attendance[date] = {};

  const now    = new Date();
  const time   = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const dayAtt = state.attendance[date];
  const rec    = dayAtt[employee.id];

  // Cas 1 — Pas encore de pointage : arrivée
  if (!rec) {
    dayAtt[employee.id] = { arrivee: time, method: 'QR' };
    playSuccessSound();
    showToast(`✓ Arrivée enregistrée : ${employee.name} à ${time}`, 'success');

  // Cas 2 — Arrivée sans départ : départ
  } else if (rec.arrivee && !rec.depart) {
    dayAtt[employee.id].depart = time;
    playSuccessSound();
    showToast(`✓ Départ enregistré : ${employee.name} à ${time}`, 'success');

  // Cas 3 — Cycle complet : vérifier règle 30 minutes
  } else if (rec.arrivee && rec.depart) {
    if (!_canStartNewCycle(rec.depart)) return; // bloqué
    dayAtt[employee.id] = { arrivee: time, method: 'QR' };
    playSuccessSound();
    showToast(`✓ Nouvelle arrivée : ${employee.name} à ${time}`, 'success');
  }

  await saveAttendanceData();
  window._updateStats?.();
}

// ─────────────────────────────────────────────────────────────
// Listener clavier global
// ─────────────────────────────────────────────────────────────

function _isUserTyping() {
  const el  = document.activeElement;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    if (el.readOnly || el.disabled) return false;
    return true;
  }
  if (el.isContentEditable) return true;
  return false;
}

function _onKeyDown(e) {
  if (!_enabled) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  const isPrintable = e.key.length === 1;
  const isEnter     = e.key === 'Enter';
  if (!isPrintable && !isEnter) return;

  // Ne pas intercepter si l'utilisateur tape dans un champ
  if (_isUserTyping()) return;

  // Ne pas intercepter si le menu Option C est ouvert
  if (document.getElementById('_extScannerMenu')) return;

  const now = Date.now();

  if (now - _lastKeyTime > SCANNER_INTER_KEY_DELAY && _buffer.length > 0) {
    if (_buffer.length < MIN_QR_LENGTH) _buffer = '';
  }

  _lastKeyTime = now;

  if (isEnter) {
    if (_buffer.length >= MIN_QR_LENGTH) {
      const captured = _buffer;
      _buffer = '';
      e.preventDefault();
      _dispatch(captured);
    } else {
      _buffer = '';
    }
    return;
  }

  _buffer += e.key;
}

// ─────────────────────────────────────────────────────────────
// API publique
// ─────────────────────────────────────────────────────────────

export function setExternalScannerEnabled(enabled) {
  _enabled = enabled;
  console.log(`[ExternalScanner] ${enabled ? 'Activé' : 'Désactivé'}`);
}

export function simulateExternalScan(value) {
  console.log(`[ExternalScanner] Simulation: "${value}"`);
  _dispatch(value);
}

export function initExternalScanner() {
  document.addEventListener('keydown', _onKeyDown, { capture: true });

  window._externalScanner = {
    simulate : simulateExternalScan,
    enable   : () => setExternalScannerEnabled(true),
    disable  : () => setExternalScannerEnabled(false),
    status   : () => console.log(`[ExternalScanner] Activé: ${_enabled} | Buffer: "${_buffer}"`),
  };

  console.log('✅ [ExternalScanner] Lecteur QR externe initialisé (USB/Bluetooth/HID)');
  console.log('   Debug : window._externalScanner.simulate("EMPLOYEE_ID") pour tester');
}
