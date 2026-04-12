// ============================================================
// ui/payroll.js — Gestion de la Paie
// Flux normal    : paiement fin de mois, calcul sur le mois entier.
// Cas exceptionnel (ponctuel) : paiement tardif avec jours d'acompte.
//   Activé via la case "Inclure un acompte" + champ "Jours d'acompte".
// ============================================================

import { state, saveData }   from '../state.js';
import { formatCurrency, debounce } from '../utils/format.js';
import { showToast }          from '../utils/notifications.js';
import { openConfirm }        from '../utils/notifications.js';
import {
  computeStandardPayroll,
  computeDelayedPayroll,
  computeFollowingMonthPayroll,
  buildPresenceReport,
  daysInMonth,
} from '../utils/attendance-calc.js';

const MONTH_NAMES = [
  '', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

// ============================================================
// INITIALISATION
// ============================================================

export function initPayroll() {
  const monthInput = document.getElementById('payrollMonth');
  if (monthInput && !monthInput.value) {
    const now = new Date();
    monthInput.value =
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  // Initialiser la recherche — debounce 300ms comme search.js
  const input = document.getElementById('payrollEmployeeInput');
  if (input) {
    input.addEventListener('input', debounce(_handlePayrollEmployeeSearch, 300));
  }

  // Charger les paiements dès l'init (section payments peut s'afficher avant displayPayments)
  displayPayments();
}

// ── Highlight utilitaire (aligné sur search.js) ─────────────
// Surligne le terme recherché dans le texte — insensible à la casse
function _highlight(text, term) {
  if (!term || term.length < 2) return text;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (text || '').replace(
    new RegExp(escaped, 'gi'),
    match => `<mark style="background:rgba(208,188,255,.35);color:#D0BCFF;border-radius:2px;padding:0 1px;">${match}</mark>`
  );
}

// ── Recherche intelligente d'employés (alignée sur search.js) ──

/**
 * Gère la saisie dans le champ de recherche employé de la paie.
 * Même comportement que handleSmartSearch() dans search.js :
 *   - debounce 300ms (géré à l'init)
 *   - minimum 2 caractères
 *   - highlight du terme
 *   - dropdown avec fermeture au clic extérieur
 *   - onclick via window._selectPayrollEmployee?.()
 */
function _handlePayrollEmployeeSearch() {
  const input   = document.getElementById('payrollEmployeeInput');
  const results = document.getElementById('payrollEmployeeResults');
  const select  = document.getElementById('payrollEmployeeSelect');
  if (!input || !results) return;

  const term  = input.value.trim().toLowerCase();
  const query = term;

  // Minimum 2 caractères — comme search.js
  if (query.length < 2) {
    results.style.display = 'none';
    if (select) select.value = '';
    return;
  }

  // Tous les employés sauf inactifs — y compris nouveaux et départ programmé
  const matches = (state.employees || []).filter(e =>
    e.status !== 'inactif' &&
    (
      (e.name     || '').toLowerCase().includes(query) ||
      (e.position || '').toLowerCase().includes(query)
    )
  );

  if (!matches.length) {
    results.style.display = 'block';
    results.innerHTML = `<p style="text-align:center;padding:20px;color:#64748b;font-weight:600;">Aucun employé trouvé.</p>`;
    return;
  }

  const today        = new Date().toISOString().split('T')[0];
  const currentMonth = new Date().toISOString().slice(0, 7);

  results.style.display = 'block';
  results.innerHTML = matches.map(emp => {
    const group     = (state.groups || []).find(g => g.id === emp.groupId);
    const groupName = group ? group.name : '<i>Sans groupe</i>';
    const todayP    = !!(state.attendance?.[today]?.[emp.id]);

    return `
      <div class="employee-item"
           style="cursor:pointer;border-radius:12px;padding:12px 16px;margin-bottom:8px;
                  display:flex;align-items:center;justify-content:space-between;
                  transition:all 0.2s ease;"
           onclick="window._selectPayrollEmployee?.('${emp.id}','${(emp.name||'').replace(/'/g,"\'")}');"
           onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 4px 12px rgba(103,80,164,.2)'"
           onmouseout="this.style.transform='translateY(0)';this.style.boxShadow='none'">
        <div class="employee-info" style="flex:1;min-width:0;">
          <h4 style="margin:0 0 4px;font-size:1em;font-weight:700;">
            ${_highlight(emp.name || '', term)}
          </h4>
          <p style="margin:0;font-size:.85em;color:var(--md-sys-color-on-surface-variant);">
            ${_highlight(emp.position || '', term)}
            · <strong style="color:var(--md-sys-color-primary);">${groupName}</strong>
          </p>
          ${todayP ? `<span style="display:inline-flex;align-items:center;gap:4px;margin-top:4px;
                                   padding:2px 8px;border-radius:12px;font-size:.75em;font-weight:700;
                                   background:rgba(16,185,129,.15);color:#059669;border:1px solid rgba(16,185,129,.3);">
            <span class="material-icons" style="font-size:12px;">check_circle</span>Présent aujourd'hui
          </span>` : ''}
        </div>
        <span class="material-icons" style="color:var(--md-sys-color-primary);flex-shrink:0;">arrow_forward_ios</span>
      </div>`;
  }).join('');

  // Fermer au clic extérieur — identique à search.js
  const closeHandler = (e) => {
    if (!results.contains(e.target) && e.target !== input) {
      results.style.display = 'none';
      document.removeEventListener('click', closeHandler);
    }
  };
  document.removeEventListener('click', closeHandler);
  document.addEventListener('click', closeHandler);
}

/**
 * Sélectionne un employé depuis le dropdown.
 * Même logique que selectEmployeeForStat() dans search.js :
 * remplit le champ texte, cache le dropdown, met à jour le select caché.
 */
function _selectPayrollEmployee(empId, empName) {
  const input   = document.getElementById('payrollEmployeeInput');
  const results = document.getElementById('payrollEmployeeResults');
  const select  = document.getElementById('payrollEmployeeSelect');

  if (input)   input.value = empName;
  if (results) results.style.display = 'none';

  if (select) {
    let opt = select.querySelector(`option[value="${empId}"]`);
    if (!opt) {
      opt = document.createElement('option');
      opt.value = empId;
      opt.textContent = empName;
      select.appendChild(opt);
    }
    select.value = empId;
  }
}

/**
 * Callback appelé par le scan facial ou QR — alimente le champ de
 * recherche exactement comme si l'utilisateur avait cliqué un résultat.
 */
export function selectPayrollEmployeeFromScan(empId) {
  const emp = (state.employees || []).find(e => e.id === empId);
  if (!emp) { showToast('Employé non trouvé.', 'error'); return; }
  _selectPayrollEmployee(emp.id, emp.name);
  showToast(`✅ ${emp.name} sélectionné(e).`, 'success');
}

// ============================================================
// CONTRÔLES UI
// ============================================================

export function toggleAdvanceDaysInput() {
  const checked   = document.getElementById('includeAdvanceCheckbox')?.checked;
  const container = document.getElementById('advanceDaysContainer');
  if (container) container.style.display = checked ? 'block' : 'none';
  _updateAdvanceExplanation();
}

function _updateAdvanceExplanation() {
  const checked  = document.getElementById('includeAdvanceCheckbox')?.checked;
  const advDays  = parseInt(document.getElementById('advanceDaysInput')?.value, 10) || 0;
  const monthVal = document.getElementById('payrollMonth')?.value;
  const el       = document.getElementById('advanceExplanation');
  if (!el) return;

  if (!checked || advDays <= 0 || !monthVal) {
    el.style.display = 'none';
    return;
  }

  const [y, m]    = monthVal.split('-').map(Number);
  const nextMonth = m === 12 ? 1     : m + 1;
  const nextYear  = m === 12 ? y + 1 : y;

  el.style.display = 'block';
  el.innerHTML = `
    <span class="material-icons" style="font-size:16px;vertical-align:middle;color:#f59e0b;">info</span>
    <strong>Mode paiement tardif (exceptionnel)</strong><br>
    • Salaire de <strong>${MONTH_NAMES[m]} ${y}</strong> =
      présence en ${MONTH_NAMES[m]} + présence du 1 au ${advDays} ${MONTH_NAMES[nextMonth]} ${nextYear}.<br>
    • Les absences sur ces ${advDays} jours de ${MONTH_NAMES[nextMonth]} <strong>réduisent</strong>
      le salaire de ${MONTH_NAMES[m]}.<br>
    • Le calcul de <strong>${MONTH_NAMES[nextMonth]} ${nextYear}</strong> démarrera
      au <strong>${advDays + 1} ${MONTH_NAMES[nextMonth]}</strong>
      (${daysInMonth(nextYear, nextMonth) - advDays} jours effectifs) pour éviter
      toute double comptabilisation.`;
}

export function handlePayrollGroupChange() {
  const groupId   = document.getElementById('payrollGroupFilter')?.value || 'all';
  const empSelect = document.getElementById('payrollEmployeeSelect');
  if (!empSelect) return;

  empSelect.innerHTML = '<option value="">Tous les employés</option>';
  state.employees
    .filter(e => e.status !== 'inactif' && (groupId === 'all' || e.groupId === groupId))
    .forEach(emp => {
      const opt = document.createElement('option');
      opt.value       = emp.id;
      opt.textContent = emp.name;
      empSelect.appendChild(opt);
    });

  const inputEl = document.getElementById('payrollEmployeeInput');
  if (inputEl) inputEl.value = '';
}

export function handlePayrollEmployeeChange() {
  // Réservé pour prévisualisation future
}

// ============================================================
// CALCUL PRINCIPAL
// ============================================================

export function calculatePayroll() {
  const monthVal = document.getElementById('payrollMonth')?.value;
  if (!monthVal) { showToast('Veuillez sélectionner un mois.', 'error'); return; }

  const [yearStr, monthStr] = monthVal.split('-');
  const year  = parseInt(yearStr,  10);
  const month = parseInt(monthStr, 10);

  const groupId  = document.getElementById('payrollGroupFilter')?.value || 'all';
  const empId    = document.getElementById('payrollEmployeeSelect')?.value || '';
  const withAdv  = document.getElementById('includeAdvanceCheckbox')?.checked || false;
  const advDays  = withAdv
    ? Math.max(0, parseInt(document.getElementById('advanceDaysInput')?.value, 10) || 0)
    : 0;

  let employees = state.employees.filter(e => e.status !== 'inactif');
  if (groupId !== 'all') employees = employees.filter(e => e.groupId === groupId);
  if (empId)             employees = employees.filter(e => e.id === empId);

  if (!employees.length) {
    showToast('Aucun employé trouvé pour ce filtre.', 'warning');
    return;
  }

  const results = employees.map(emp => {
    let calc;
    if (!withAdv || advDays === 0) {
      calc = computeStandardPayroll(emp.id, emp.salary || 0, year, month);
    } else {
      calc = computeDelayedPayroll(emp.id, emp.salary || 0, year, month, advDays);
    }
    const advances = _getAdvancesForPeriod(emp.id, year, month);
    const netPay   = Math.max(0, calc.grossPay - advances.total);
    return { emp, calc, advances, netPay };
  });

  _renderPayrollResults(results, { year, month, advDays, withAdv });
  _renderPayrollSummary(results);
}

// ============================================================
// AVANCES
// ============================================================

function _getAdvancesForPeriod(employeeId, year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const list   = (state.advances || []).filter(
    a => a.employeeId === employeeId && a.date?.startsWith(prefix)
  );
  return { list, total: list.reduce((s, a) => s + (a.amount || 0), 0) };
}

// ============================================================
// RENDU RÉSULTATS
// ============================================================

function _renderPayrollResults(results, { year, month, advDays, withAdv }) {
  const container = document.getElementById('payrollResults');
  if (!container) return;

  const isDelayed = withAdv && advDays > 0;
  let periodLabel = isDelayed
    ? (() => {
        const nm = month === 12 ? 1 : month + 1;
        const ny = month === 12 ? year + 1 : year;
        return `${MONTH_NAMES[month]} ${year} + jours 1–${advDays} ${MONTH_NAMES[nm]} ${ny}`;
      })()
    : `${MONTH_NAMES[month]} ${year}`;

  container.innerHTML = `
    <div style="margin-top:24px;">
      <div style="display:flex;align-items:center;justify-content:space-between;
                  margin-bottom:16px;flex-wrap:wrap;gap:8px;">
        <h3 style="margin:0;color:var(--md-sys-color-primary);display:flex;align-items:center;gap:8px;">
          <span class="material-icons">payments</span>
          Résultats — ${periodLabel}
        </h3>
        ${isDelayed ? `
        <div style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:20px;
                    background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.3);
                    font-size:12px;font-weight:600;color:#f59e0b;">
          <span class="material-icons" style="font-size:16px;">warning</span>
          Paiement tardif exceptionnel
        </div>` : ''}
      </div>
      ${results.map(({ emp, calc, advances, netPay }) =>
        _renderEmployeeCard(emp, calc, advances, netPay, year, month)
      ).join('')}
      ${isDelayed ? _renderFollowingMonthInfo(year, month, advDays, results) : ''}
    </div>`;
}

function _renderEmployeeCard(emp, calc, advances, netPay, year, month) {
  const group     = state.groups?.find(g => g.id === emp.groupId);
  const isDelayed = calc.mode === 'delayed';

  // Chercher un paiement existant pour ce mois
  const existingPayment = (state.payments || []).find(
    p => p.employeeId === emp.id && p.year === year && p.month === month
  );

  // Bloc jours d'acompte
  let advBlock = '';
  if (isDelayed && calc.advancePresence) {
    const adv = calc.advancePresence;
    const nm  = calc.nextMonth;
    const ny  = calc.nextYear;
    const hasAbsences = adv.absent > 0;
    advBlock = `
      <div style="margin-top:12px;padding:12px 14px;border-radius:10px;
                  background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);">
        <div style="font-size:12px;font-weight:600;color:#f59e0b;margin-bottom:8px;
                    display:flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:16px;">event_available</span>
          Jours d'acompte : 1–${calc.advanceDays} ${MONTH_NAMES[nm]} ${ny}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center;font-size:12px;">
          ${_miniStat(adv.present, '#22c55e', 'Présents')}
          ${_miniStat(adv.demi,    '#f59e0b', 'Demi-j.')}
          ${_miniStat(adv.absent,  '#ef4444', 'Absents')}
        </div>
        <div style="margin-top:8px;font-size:11px;display:flex;align-items:center;gap:4px;
                    color:${hasAbsences ? '#ef4444' : '#22c55e'};">
          <span class="material-icons" style="font-size:14px;">
            ${hasAbsences ? 'remove_circle' : 'check_circle'}
          </span>
          ${hasAbsences
            ? `${adv.absent} absence(s) déduite(s) du salaire ${MONTH_NAMES[calc.month]} ${calc.year}`
            : 'Aucune absence sur les jours d\'acompte'}
        </div>
      </div>`;
  }

  // Bandeau confirmation paiement immédiat
  const paidBanner = existingPayment ? `
    <div style="margin-top:12px;padding:12px 14px;border-radius:10px;
                background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="material-icons" style="color:#22c55e;font-size:22px;">verified</span>
          <div>
            <div style="font-size:13px;font-weight:700;color:#22c55e;">
              Payé le ${existingPayment.date}
            </div>
            <div style="font-size:12px;color:var(--md-sys-color-on-surface-variant);margin-top:2px;">
              Montant versé : <strong>${formatCurrency(existingPayment.amount)} Ar</strong>
              ${existingPayment.note ? `<span style="opacity:.7;"> · ${existingPayment.note}</span>` : ''}
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-danger" style="padding:6px 14px;font-size:12px;min-width:0;"
                  onclick="window._cancelPayment?.('${existingPayment.id}','${emp.name.replace(/'/g, "\\'")}')">
            <span class="material-icons" style="font-size:15px;">undo</span>Annuler
          </button>
          <button class="btn btn-secondary" style="padding:6px 14px;font-size:12px;min-width:0;"
                  onclick="window._repayEmployee?.('${emp.id}',${netPay},'${emp.name.replace(/'/g, "\\'")}')">
            <span class="material-icons" style="font-size:15px;">refresh</span>Refaire
          </button>
        </div>
      </div>
    </div>` : '';

  const borderColor = existingPayment ? 'rgba(34,197,94,.35)' : 'var(--md-sys-color-outline-variant)';

  return `
    <div style="border:1px solid ${borderColor};border-radius:16px;padding:20px;margin-bottom:16px;
                background:var(--md-sys-color-surface);
                ${existingPayment ? 'box-shadow:0 0 0 1px rgba(34,197,94,.1);' : ''}">

      <!-- En-tête employé -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:10px;">
          ${existingPayment
            ? `<span class="material-icons" style="color:#22c55e;font-size:20px;" title="Payé">check_circle</span>`
            : `<span class="material-icons" style="color:var(--md-sys-color-on-surface-variant);font-size:20px;">person</span>`}
          <div>
            <h4 style="margin:0 0 2px;">${emp.name}</h4>
            <p style="margin:0;font-size:13px;color:var(--md-sys-color-on-surface-variant);">
              ${emp.position}${group ? ` · ${group.name}` : ''}
            </p>
          </div>
        </div>
        <div style="text-align:right;font-size:13px;">
          <div style="color:var(--md-sys-color-on-surface-variant);">Salaire de base</div>
          <div style="font-weight:600;">${formatCurrency(emp.salary || 0)} Ar</div>
        </div>
      </div>

      <!-- Stats présence -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-top:14px;">
        ${_statPill('Présents',  calc.present, '#22c55e', 'check_circle')}
        ${_statPill('Demi-j.',   calc.demi,    '#f59e0b', 'schedule')}
        ${_statPill('Absents',   calc.absent,  '#ef4444', 'cancel')}
        ${_statPill('Jours eff.',
          (isDelayed ? calc.totalEffective : calc.effectiveDays).toFixed(1),
          'var(--md-sys-color-primary)', 'payments')}
      </div>

      ${advBlock}

      <!-- Calcul financier -->
      <div style="margin-top:14px;padding:14px;border-radius:10px;
                  background:var(--md-sys-color-surface-variant);">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px;">
          <span>Taux journalier</span>
          <span>${formatCurrency(calc.dailyRate)} Ar/j</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px;">
          <span>
            Brut (${(isDelayed ? calc.totalEffective : calc.effectiveDays).toFixed(1)} j
            × ${formatCurrency(calc.dailyRate)} Ar)
          </span>
          <span style="font-weight:600;">${formatCurrency(calc.grossPay)} Ar</span>
        </div>
        ${advances.total > 0 ? `
        <div style="display:flex;justify-content:space-between;font-size:13px;
                    margin-bottom:5px;color:#ef4444;">
          <span>Avances déduites (${advances.list.length})</span>
          <span>− ${formatCurrency(advances.total)} Ar</span>
        </div>` : ''}
        <div style="display:flex;justify-content:space-between;padding-top:8px;
                    border-top:1px solid var(--md-sys-color-outline-variant);
                    font-size:15px;font-weight:700;">
          <span>Net à payer</span>
          <span style="color:var(--md-sys-color-success);">${formatCurrency(netPay)} Ar</span>
        </div>
      </div>

      ${paidBanner}

      <!-- Actions -->
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">
        ${!existingPayment ? `
        <button class="btn btn-success" style="flex:1;min-width:120px;"
                onclick="window._markPaid?.('${emp.id}',${netPay},'${emp.name.replace(/'/g, "\\'")}')">
          <span class="material-icons">done</span>Marquer Payé
        </button>` : ''}
        <button class="btn btn-secondary" style="flex:1;min-width:120px;"
                onclick="window._showPayrollDetail?.('${emp.id}')">
          <span class="material-icons">info</span>Détail présence
        </button>
      </div>
    </div>`;
}

function _renderFollowingMonthInfo(year, month, advDays, results) {
  const nm = month === 12 ? 1     : month + 1;
  const ny = month === 12 ? year + 1 : year;
  const totalDaysNM = daysInMonth(ny, nm);

  return `
    <div style="margin-top:24px;padding:16px;border-radius:12px;
                background:rgba(14,165,233,.07);border:1px solid rgba(14,165,233,.25);">
      <h4 style="margin:0 0 10px;display:flex;align-items:center;gap:8px;color:#0ea5e9;">
        <span class="material-icons">arrow_forward</span>
        Mois suivant : ${MONTH_NAMES[nm]} ${ny}
      </h4>
      <p style="margin:0 0 8px;font-size:13px;color:var(--md-sys-color-on-surface-variant);">
        Les <strong>${advDays} premiers jours</strong> de ${MONTH_NAMES[nm]} ont été
        imputés au salaire de ${MONTH_NAMES[month]} ${year}.
        Lors du calcul de <strong>${MONTH_NAMES[nm]} ${ny}</strong>, le calcul démarrera
        au <strong>${advDays + 1} ${MONTH_NAMES[nm]}</strong>.
      </p>
      <div style="display:flex;gap:20px;font-size:13px;flex-wrap:wrap;">
        <span>📅 Jours totaux : <strong>${totalDaysNM}</strong></span>
        <span>✂️ Jours imputés : <strong>${advDays}</strong></span>
        <span>✅ Jours à calculer : <strong>${totalDaysNM - advDays}</strong></span>
      </div>
      <div style="margin-top:10px;padding:8px 12px;border-radius:8px;
                  background:rgba(14,165,233,.08);font-size:12px;font-style:italic;
                  color:var(--md-sys-color-on-surface-variant);">
        💡 Pour générer la paie de ${MONTH_NAMES[nm]} ${ny}, sélectionnez ce mois et activez
        "Inclure un acompte" avec ${advDays} jours.
      </div>
    </div>`;
}

function _statPill(label, value, color, icon) {
  return `
    <div style="padding:10px;border-radius:10px;background:${color}18;
                border:1px solid ${color}30;text-align:center;">
      <span class="material-icons" style="font-size:18px;color:${color};">${icon}</span>
      <div style="font-size:18px;font-weight:700;color:${color};">${value}</div>
      <div style="font-size:11px;color:var(--md-sys-color-on-surface-variant);line-height:1.3;">${label}</div>
    </div>`;
}

function _miniStat(value, color, label) {
  return `
    <div style="padding:6px;border-radius:8px;background:${color}18;">
      <div style="font-size:16px;font-weight:700;color:${color};">${value}</div>
      <div style="font-size:11px;color:var(--md-sys-color-on-surface-variant);">${label}</div>
    </div>`;
}

function _renderPayrollSummary(results) {
  const summaryEl = document.getElementById('payrollSummary');
  if (!summaryEl) return;

  const totalGross    = results.reduce((s, r) => s + r.calc.grossPay, 0);
  const totalAdvances = results.reduce((s, r) => s + r.advances.total, 0);
  const totalNet      = results.reduce((s, r) => s + r.netPay, 0);
  const unpaid        = results.filter(r => r.netPay <= 0).map(r => r.emp.name);

  document.getElementById('summaryTotalGross').textContent    = formatCurrency(totalGross) + ' Ar';
  document.getElementById('summaryTotalAdvances').textContent = formatCurrency(totalAdvances) + ' Ar';
  document.getElementById('summaryTotalNet').textContent      = formatCurrency(totalNet) + ' Ar';
  document.getElementById('unpaidEmployeesList').textContent  = unpaid.join(', ') || 'Aucun';

  summaryEl.style.display = 'block';
}

// ============================================================
// ACTIONS — MARQUER PAYÉ / ANNULER / REFAIRE
// ============================================================

export async function markEmployeePaid(employeeId, amount, name) {
  const monthVal = document.getElementById('payrollMonth')?.value;
  const [py, pm] = monthVal ? monthVal.split('-').map(Number) : [0, 0];

  const confirmed = await openConfirm(
    'Confirmer le paiement',
    `Marquer <strong>${name}</strong> comme payé(e) — <strong>${formatCurrency(amount)} Ar</strong> ?`,
    'Confirmer', 'Annuler'
  );
  if (!confirmed) return;

  if (!state.payments) state.payments = [];

  const payment = {
    id:           crypto.randomUUID?.() || `pay-${Date.now()}`,
    employeeId,
    employeeName: name,
    amount,
    year:         py,
    month:        pm,
    date:         new Date().toISOString().split('T')[0],
    timestamp:    Date.now(),
    note:         `Paie ${MONTH_NAMES[pm] || ''} ${py}`.trim(),
  };

  state.payments.push(payment);
  await saveData();

  showToast(`✅ ${name} marqué(e) comme payé(e).`, 'success');

  // Rafraîchir immédiatement pour afficher le bandeau de confirmation
  calculatePayroll();
  displayPayments();
}

export async function cancelPayment(paymentId, employeeName) {
  const confirmed = await openConfirm(
    'Annuler le paiement',
    `Annuler le paiement de <strong>${employeeName}</strong> ?<br>
     <span style="font-size:13px;opacity:.8;">Le paiement sera supprimé de l'historique.</span>`,
    'Confirmer l\'annulation', 'Garder'
  );
  if (!confirmed) return;

  if (!state.payments) return;
  const idx = state.payments.findIndex(p => p.id === paymentId);
  if (idx === -1) { showToast('Paiement introuvable.', 'error'); return; }

  state.payments.splice(idx, 1);
  await saveData();

  showToast(`Paiement de ${employeeName} annulé.`, 'info');
  // Rafraîchir les deux vues
  calculatePayroll();
  displayPayments();
}

export async function repayEmployee(employeeId, amount, name) {
  const monthVal = document.getElementById('payrollMonth')?.value;
  const [py, pm] = monthVal ? monthVal.split('-').map(Number) : [0, 0];

  const confirmed = await openConfirm(
    'Refaire le paiement',
    `Remplacer le paiement existant de <strong>${name}</strong> par <strong>${formatCurrency(amount)} Ar</strong> ?`,
    'Refaire', 'Annuler'
  );
  if (!confirmed) return;

  // Supprimer l'ancien paiement du mois
  if (state.payments) {
    const idx = state.payments.findIndex(
      p => p.employeeId === employeeId && p.year === py && p.month === pm
    );
    if (idx !== -1) state.payments.splice(idx, 1);
  }

  // Créer le nouveau sans re-confirmer
  if (!state.payments) state.payments = [];
  const payment = {
    id:           crypto.randomUUID?.() || `pay-${Date.now()}`,
    employeeId,
    employeeName: name,
    amount,
    year:         py,
    month:        pm,
    date:         new Date().toISOString().split('T')[0],
    timestamp:    Date.now(),
    note:         `Paie ${MONTH_NAMES[pm] || ''} ${py} (refait)`.trim(),
  };

  state.payments.push(payment);
  await saveData();

  showToast(`✅ Paiement de ${name} refait.`, 'success');
  calculatePayroll();
  displayPayments();
}

// ============================================================
// DÉTAIL PRÉSENCE (modale)
// ============================================================

export function showPayrollDetail(employeeId) {
  const monthVal = document.getElementById('payrollMonth')?.value;
  if (!monthVal) return;

  const [y, m]   = monthVal.split('-').map(Number);
  const withAdv  = document.getElementById('includeAdvanceCheckbox')?.checked || false;
  const advDays  = withAdv
    ? Math.max(0, parseInt(document.getElementById('advanceDaysInput')?.value, 10) || 0)
    : 0;

  const displayYear   = (withAdv && advDays > 0 && m === 12) ? y + 1 : y;
  const displayMonth  = (withAdv && advDays > 0) ? (m === 12 ? 1 : m + 1) : m;
  const reportAdvDays = (withAdv && advDays > 0) ? advDays : 0;

  const report = buildPresenceReport(employeeId, displayYear, displayMonth, reportAdvDays);
  if (!report) return;

  const rows = report.details.map(d => {
    const icon   = d.status === 'present' ? '✅' : d.status === 'demi' ? '🕐' : '❌';
    const advTag = d.isAdvanceDay
      ? `<span style="font-size:10px;background:var(--md-sys-color-primary);color:white;
                      border-radius:4px;padding:1px 6px;margin-left:8px;">Acompte</span>`
      : '';
    const rowBg = d.isAdvanceDay ? 'rgba(103,80,164,.07)' : '';
    return `<tr style="background:${rowBg};">
      <td style="padding:7px 10px;">${d.date}${advTag}</td>
      <td style="padding:7px 10px;text-align:center;">${icon} ${d.status}</td>
    </tr>`;
  }).join('');

  const html = `
    <div style="max-height:72vh;overflow-y:auto;">
      <h4 style="margin:0 0 12px;color:var(--md-sys-color-primary);">
        ${report.employeeName} — ${MONTH_NAMES[displayMonth]} ${displayYear}
      </h4>
      ${reportAdvDays > 0 ? `
      <div style="padding:10px 14px;border-radius:8px;background:rgba(245,158,11,.1);
                  margin-bottom:12px;font-size:13px;border-left:3px solid #f59e0b;">
        <strong>⚠️ Jours d'acompte (1–${reportAdvDays}) :</strong>
        imputés au salaire de ${MONTH_NAMES[m]} ${y}<br>
        Présents: ${report.advanceSummary.present} |
        Demi: ${report.advanceSummary.demi} |
        Absents: <span style="color:#ef4444;font-weight:600;">${report.advanceSummary.absent}</span>
        → <strong>${report.advanceSummary.effective} j effectifs</strong>
      </div>` : ''}
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="border-bottom:2px solid var(--md-sys-color-outline-variant);">
            <th style="text-align:left;padding:6px 10px;">Date</th>
            <th style="text-align:center;padding:6px 10px;">Statut</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr style="border-top:2px solid var(--md-sys-color-outline-variant);font-weight:600;">
            <td style="padding:8px 10px;">Total effectif</td>
            <td style="padding:8px 10px;text-align:center;">${report.total.effective} jours</td>
          </tr>
        </tfoot>
      </table>
    </div>`;

  // Tentative via dialog-manager, avec fallback modale inline fiable
  import('../utils/dialog-manager.js')
    .then(mod => {
      if (typeof mod.showDialog === 'function') {
        mod.showDialog({ title: 'Détail de présence', body: html });
      } else if (typeof mod.openModal === 'function') {
        mod.openModal({ title: 'Détail de présence', content: html });
      } else {
        _showPresenceInlineModal(html);
      }
    })
    .catch(() => _showPresenceInlineModal(html));
}

/**
 * Affiche le détail de présence dans une modale inline autonome
 * quand dialog-manager n'est pas disponible ou incompatible.
 */
function _showPresenceInlineModal(html) {
  // Supprimer une éventuelle modale précédente
  document.getElementById('_presenceDetailOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = '_presenceDetailOverlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:9999;
    display:flex;align-items:center;justify-content:center;
    background:rgba(0,0,0,.55);backdrop-filter:blur(4px);
    animation:fadeIn .15s ease;`;

  overlay.innerHTML = `
    <div style="background:var(--md-sys-color-surface);border-radius:20px;
                width:min(560px,94vw);max-height:88vh;
                display:flex;flex-direction:column;
                box-shadow:0 24px 64px rgba(0,0,0,.35);
                border:1px solid var(--md-sys-color-outline-variant);
                overflow:hidden;">
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:16px 20px;border-bottom:1px solid var(--md-sys-color-outline-variant);
                  flex-shrink:0;">
        <span style="font-weight:700;font-size:16px;
                     display:flex;align-items:center;gap:8px;color:var(--md-sys-color-primary);">
          <span class="material-icons">event_note</span>Détail de présence
        </span>
        <button onclick="document.getElementById('_presenceDetailOverlay')?.remove()"
                style="background:none;border:none;cursor:pointer;padding:6px;border-radius:50%;
                       display:flex;align-items:center;justify-content:center;
                       color:var(--md-sys-color-on-surface-variant);
                       transition:background .15s;"
                onmouseover="this.style.background='rgba(0,0,0,.08)'"
                onmouseout="this.style.background='none'">
          <span class="material-icons">close</span>
        </button>
      </div>
      <!-- Corps scrollable -->
      <div style="flex:1;overflow-y:auto;padding:20px;">
        ${html}
      </div>
    </div>`;

  // Fermer en cliquant sur l'overlay
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Fermer avec Escape
  const escHandler = (e) => {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);

  document.body.appendChild(overlay);
}

// ============================================================
// HISTORIQUE DES PAIEMENTS
// ============================================================

export function displayPayments() {
  const container = document.getElementById('paymentList');
  if (!container) return;

  // Champ de recherche unique
  const search    = (document.getElementById('paymentSearch')?.value || '').toLowerCase().trim();
  // Filtre mois (YYYY-MM)
  const monthFilter = document.getElementById('paymentMonthFilter')?.value || '';

  let list = [...(state.payments || [])];

  // Filtre texte : nom, date, mois, note
  if (search) {
    list = list.filter(p =>
      (p.employeeName || '').toLowerCase().includes(search) ||
      (p.date || '').includes(search) ||
      (MONTH_NAMES[p.month] || '').toLowerCase().includes(search) ||
      String(p.year || '').includes(search) ||
      (p.note || '').toLowerCase().includes(search)
    );
  }

  // Filtre par mois/année sélectionné
  if (monthFilter) {
    const [fy, fm] = monthFilter.split('-').map(Number);
    list = list.filter(p => p.year === fy && p.month === fm);
  }

  list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  if (!list.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:48px 24px;color:var(--md-sys-color-on-surface-variant);">
        <span class="material-icons" style="font-size:56px;display:block;margin-bottom:16px;opacity:.3;">
          receipt_long
        </span>
        <p style="margin:0;font-size:15px;font-weight:500;">
          ${search ? 'Aucun résultat pour « ' + search + ' »' : 'Aucun paiement enregistré'}
        </p>
        ${search ? `<p style="margin:8px 0 0;font-size:13px;opacity:.7;">Essayez avec un nom ou une date différente.</p>` : ''}
      </div>`;
    return;
  }

  // Résumé compteur
  const totalAmount = list.reduce((s, p) => s + (p.amount || 0), 0);
  const filterDesc  = [
    search ? `« ${search} »` : '',
    monthFilter ? (() => { const [fy,fm]=monthFilter.split('-').map(Number); return `${MONTH_NAMES[fm]} ${fy}`; })() : ''
  ].filter(Boolean).join(' · ');

  const header = `
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:12px 16px;border-radius:10px;margin-bottom:16px;
                background:var(--md-sys-color-surface-variant);flex-wrap:wrap;gap:8px;">
      <span style="font-size:13px;color:var(--md-sys-color-on-surface-variant);">
        ${list.length} paiement${list.length > 1 ? 's' : ''}
        ${filterDesc ? ` · ${filterDesc}` : ''}
      </span>
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="font-weight:700;color:var(--md-sys-color-primary);">
          Total : ${formatCurrency(totalAmount)} Ar
        </span>
        ${(search || monthFilter) ? `
        <button onclick="document.getElementById('paymentSearch').value='';
                         document.getElementById('paymentMonthFilter').value='';
                         displayPayments();"
                style="font-size:11px;padding:3px 10px;border-radius:20px;border:none;cursor:pointer;
                       background:rgba(103,80,164,.15);color:var(--md-sys-color-primary);font-weight:600;">
          ✕ Effacer filtres
        </button>` : ''}
      </div>
    </div>`;

  container.innerHTML = header + list.map(p => {
    const monthLabel = MONTH_NAMES[p.month]
      ? `${MONTH_NAMES[p.month]} ${p.year}`
      : (p.month || '');
    const emp   = state.employees?.find(e => e.id === p.employeeId);
    const group = emp ? state.groups?.find(g => g.id === emp.groupId) : null;
    const safeName = (p.employeeName || 'Employé').replace(/'/g, "\\'");

    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;
                  padding:14px 16px;border-radius:12px;margin-bottom:10px;
                  border:1px solid var(--md-sys-color-outline-variant);
                  background:var(--md-sys-color-surface);
                  transition:box-shadow .15s,transform .1s;"
           onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,.08)';this.style.transform='translateY(-1px)'"
           onmouseout="this.style.boxShadow='none';this.style.transform='translateY(0)'">

        <!-- Avatar + Info -->
        <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
          <div style="width:44px;height:44px;border-radius:14px;flex-shrink:0;
                      background:linear-gradient(135deg,rgba(34,197,94,.2),rgba(34,197,94,.08));
                      display:flex;align-items:center;justify-content:center;
                      border:1px solid rgba(34,197,94,.25);">
            <span class="material-icons" style="color:#22c55e;font-size:22px;">payments</span>
          </div>
          <div style="min-width:0;flex:1;">
            <div style="font-weight:600;font-size:14px;white-space:nowrap;
                        overflow:hidden;text-overflow:ellipsis;">
              ${p.employeeName || 'Employé'}
            </div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap;">
              <span style="font-size:12px;color:var(--md-sys-color-on-surface-variant);
                           display:flex;align-items:center;gap:3px;">
                <span class="material-icons" style="font-size:13px;">calendar_today</span>
                ${p.date}
              </span>
              ${monthLabel ? `
              <span style="padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600;
                           background:rgba(103,80,164,.12);color:var(--md-sys-color-primary);">
                ${monthLabel}
              </span>` : ''}
              ${group ? `
              <span style="font-size:11px;color:var(--md-sys-color-on-surface-variant);opacity:.7;">
                ${group.name}
              </span>` : ''}
            </div>
            ${p.note ? `
            <div style="font-size:11px;font-style:italic;margin-top:3px;
                        color:var(--md-sys-color-on-surface-variant);opacity:.7;">
              ${p.note}
            </div>` : ''}
          </div>
        </div>

        <!-- Montant + Bouton Annuler -->
        <div style="display:flex;align-items:center;gap:12px;flex-shrink:0;">
          <div style="text-align:right;">
            <div style="font-weight:700;font-size:16px;color:#22c55e;white-space:nowrap;">
              ${formatCurrency(p.amount)} Ar
            </div>
            <div style="font-size:11px;color:var(--md-sys-color-on-surface-variant);">Net payé</div>
          </div>
          <button title="Annuler ce paiement"
                  onclick="window._cancelPayment?.('${p.id}','${safeName}')"
                  style="display:flex;align-items:center;justify-content:center;gap:4px;
                         padding:7px 12px;border-radius:10px;border:1px solid rgba(239,68,68,.3);
                         cursor:pointer;background:rgba(239,68,68,.08);color:#ef4444;
                         font-size:12px;font-weight:600;
                         transition:background .15s,transform .1s,border-color .15s;"
                  onmouseover="this.style.background='rgba(239,68,68,.18)';this.style.borderColor='rgba(239,68,68,.5)';this.style.transform='scale(1.03)'"
                  onmouseout="this.style.background='rgba(239,68,68,.08)';this.style.borderColor='rgba(239,68,68,.3)';this.style.transform='scale(1)'">
            <span class="material-icons" style="font-size:16px;">undo</span>
            Annuler
          </button>
        </div>
      </div>`;
  }).join('');
}

// ============================================================
// EXPOSITIONS GLOBALES
// ============================================================

// ── Callback scan facial/QR pour la paie et l'historique ──────
// recognition.js appelle window._onPayrollFaceScan(empId) après identification
// ou window._faceScanCallback?.(purpose, empId) selon le module
if (typeof window._registerFaceScanCallback === 'function') {
  window._registerFaceScanCallback('payroll', (empId) => selectPayrollEmployeeFromScan(empId));
  window._registerFaceScanCallback('payments-search', (empId) => {
    const emp = state.employees?.find(e => e.id === empId);
    if (emp) {
      const input = document.getElementById('paymentSearch');
      if (input) { input.value = emp.name; displayPayments(); }
    }
  });
}

window._markPaid                    = markEmployeePaid;
window._cancelPayment               = cancelPayment;
window._repayEmployee               = repayEmployee;
window._showPayrollDetail           = showPayrollDetail;
window._onAdvanceDaysChange         = _updateAdvanceExplanation;
window._handlePayrollEmployeeSearch = _handlePayrollEmployeeSearch;
window._selectPayrollEmployee       = _selectPayrollEmployee;
window.selectPayrollEmployeeFromScan = selectPayrollEmployeeFromScan;

// Enregistrer un callback pour la section payments : charger les paiements à l'ouverture
// (utilise le système registerSectionCallback si disponible, sinon observe la section)
(function _initPaymentsSection() {
  try {
    import('./navigation.js').then(nav => {
      if (typeof nav.registerSectionCallback === 'function') {
        nav.registerSectionCallback('payments', () => {
          _populatePaymentMonthFilter();
          displayPayments();
        });
      }
    }).catch(() => {});
  } catch(e) {}
})();

/**
 * Remplit le sélecteur de mois dans l'historique des paiements
 * avec les mois uniques présents dans state.payments.
 */
function _populatePaymentMonthFilter() {
  const sel = document.getElementById('paymentMonthFilter');
  if (!sel) return;

  const currentVal = sel.value;
  const months = new Set();
  (state.payments || []).forEach(p => {
    if (p.year && p.month) months.add(`${p.year}-${String(p.month).padStart(2,'0')}`);
  });

  const sorted = [...months].sort().reverse();
  sel.innerHTML = '<option value="">Tous les mois</option>' +
    sorted.map(m => {
      const [y, mo] = m.split('-').map(Number);
      return `<option value="${m}" ${m === currentVal ? 'selected' : ''}>${MONTH_NAMES[mo]} ${y}</option>`;
    }).join('');
}
