// ============================================================
// ui/unpaid.js — Suivi des Employés Non Payés (ES Module)
// Lecture seule : aucune écriture dans state.payrolls / state.employees.
// Ne modifie ni n'importe rien depuis payroll.js ou groups.js afin de
// garantir une isolation totale (zéro risque de régression).
// ============================================================

import { state } from '../state.js';
import { formatCurrency } from '../utils/format.js';
import { registerSectionCallback } from './navigation.js';

const MONTH_NAMES = [
  '', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

// ============================================================
// INITIALISATION
// ============================================================

export function initUnpaidTracker() {
  registerSectionCallback('unpaid-tracker', () => {
    _populateUnpaidGroupFilter();
    _ensureDefaultMonth();
  });
}

// Pré-remplit le mois courant si le champ est vide (même logique que initPayroll())
function _ensureDefaultMonth() {
  const monthInput = document.getElementById('unpaidMonth');
  if (monthInput && !monthInput.value) {
    const now = new Date();
    monthInput.value =
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}

// Peuple le select Groupe localement, sans dépendre de groups.js
function _populateUnpaidGroupFilter() {
  const sel = document.getElementById('unpaidGroupFilter');
  if (!sel) return;
  const previousValue = sel.value || 'all';

  const opts = (state.groups || [])
    .map(g => `<option value="${g.id}">${g.name}</option>`)
    .join('');
  sel.innerHTML = '<option value="all">Tous les Groupes</option>' + opts;

  const stillExists = Array.from(sel.options).some(o => o.value === previousValue);
  sel.value = stillExists ? previousValue : 'all';
}

// ============================================================
// LOGIQUE MÉTIER
// ============================================================

/**
 * Détermine si un employé a déjà été payé pour (year, month).
 * Critère identique à celui utilisé dans payroll.js::_renderEmployeeCard()
 * (existingPayment) — toute ligne dans state.payrolls avec ce couple
 * employeeId/year/month suffit, peu importe advDays.
 */
function _isPaidFor(employeeId, year, month) {
  return (state.payrolls || []).some(
    p => p.employeeId === employeeId &&
         Number(p.year)  === year &&
         Number(p.month) === month
  );
}

/**
 * Retourne les employés non payés pour la période/groupe donnés.
 * Exclut les employés 'inactif', comme le fait déjà calculatePayroll()
 * dans payroll.js — convention respectée pour rester cohérent.
 */
function _getUnpaidEmployees(year, month, groupId) {
  let employees = (state.employees || []).filter(e => e.status !== 'inactif');
  if (groupId && groupId !== 'all') {
    employees = employees.filter(e => e.groupId === groupId);
  }
  return employees.filter(emp => !_isPaidFor(emp.id, year, month));
}

// ============================================================
// CALCUL PRINCIPAL / RENDU
// ============================================================

export function calculateUnpaid() {
  const monthVal = document.getElementById('unpaidMonth')?.value;
  if (!monthVal) {
    _renderUnpaidError('Veuillez sélectionner un mois.');
    return;
  }

  const [yearStr, monthStr] = monthVal.split('-');
  const year  = parseInt(yearStr,  10);
  const month = parseInt(monthStr, 10);
  const groupId = document.getElementById('unpaidGroupFilter')?.value || 'all';

  const unpaid = _getUnpaidEmployees(year, month, groupId);

  _renderUnpaidSummary(unpaid, year, month, groupId);
  _renderUnpaidList(unpaid);
}

function _renderUnpaidError(message) {
  const summaryEl = document.getElementById('unpaidSummary');
  const resultsEl = document.getElementById('unpaidResults');
  if (summaryEl) summaryEl.innerHTML = '';
  if (resultsEl) {
    resultsEl.innerHTML = `
      <div class="alert alert-warning" style="display:flex;align-items:center;gap:8px;">
        <span class="material-icons">warning</span>${message}
      </div>`;
  }
}

function _renderUnpaidSummary(unpaid, year, month, groupId) {
  const summaryEl = document.getElementById('unpaidSummary');
  if (!summaryEl) return;

  const group = groupId !== 'all'
    ? (state.groups || []).find(g => g.id === groupId)
    : null;
  const periodLabel = `${MONTH_NAMES[month]} ${year}`;
  const groupLabel  = group ? ` · ${group.name}` : ' · Tous les groupes';

  summaryEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:14px 18px;border-radius:12px;flex-wrap:wrap;gap:8px;
                background:${unpaid.length ? 'rgba(239,68,68,.1)' : 'rgba(34,197,94,.1)'};
                border:1px solid ${unpaid.length ? 'rgba(239,68,68,.3)' : 'rgba(34,197,94,.3)'};">
      <span style="font-size:14px;font-weight:600;
                   color:${unpaid.length ? '#ef4444' : '#22c55e'};">
        <span class="material-icons" style="font-size:18px;vertical-align:middle;margin-right:6px;">
          ${unpaid.length ? 'person_off' : 'check_circle'}
        </span>
        ${unpaid.length} employé${unpaid.length > 1 ? 's' : ''} non payé${unpaid.length > 1 ? 's' : ''}
      </span>
      <span style="font-size:13px;color:var(--md-sys-color-on-surface-variant);">
        ${periodLabel}${groupLabel}
      </span>
    </div>`;
}

function _renderUnpaidList(unpaid) {
  const resultsEl = document.getElementById('unpaidResults');
  if (!resultsEl) return;

  if (!unpaid.length) {
    resultsEl.innerHTML = `
      <div style="text-align:center;padding:48px 24px;color:var(--md-sys-color-on-surface-variant);">
        <span class="material-icons" style="font-size:56px;display:block;margin-bottom:16px;opacity:.3;">
          task_alt
        </span>
        <p style="margin:0;font-size:15px;font-weight:500;">
          Tous les employés ont été payés pour cette période.
        </p>
      </div>`;
    return;
  }

  resultsEl.innerHTML = unpaid.map(emp => {
    const group = (state.groups || []).find(g => g.id === emp.groupId);
    return `
      <div class="employee-item">
        <div class="employee-info">
          <h4 style="margin:0 0 4px;">${emp.name}</h4>
          <p style="margin:0;font-size:13px;color:var(--md-sys-color-on-surface-variant);">
            ${emp.position || ''}${group ? ` · ${group.name}` : ''}
          </p>
        </div>
        <div style="text-align:right;font-size:13px;">
          <div style="color:var(--md-sys-color-on-surface-variant);">Salaire de base</div>
          <div style="font-weight:600;">${formatCurrency(emp.salary || 0)} Ar</div>
        </div>
      </div>`;
  }).join('');
}

// ============================================================
// EXPOSITION GLOBALE
// ============================================================

window._calculateUnpaid = calculateUnpaid;