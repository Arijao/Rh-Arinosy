// ============================================================
// ui/payroll.js — Paie (ES Module)
// ============================================================

import { state, saveData, dbManager } from '../state.js';
import { renderPaginationControls } from '../utils/ui.js';
import { showToast, openConfirm } from '../utils/notifications.js';
import { formatCurrency, formatDate, getDaysInMonth } from '../utils/format.js';
import { countPresenceDays } from '../utils/attendance-calc.js';
import { registerSectionCallback } from './navigation.js';
import { populateEmployeeSelects } from './groups.js';

export function initPayroll() {
  registerSectionCallback('payroll', () => {
    document.getElementById('payrollResults').innerHTML =
      '<p style="text-align:center;padding:20px;">Sélectionnez un mois et cliquez sur Calculer.</p>';
    document.getElementById('payrollSummary').style.display = 'none';
  });
}

export function handlePayrollGroupChange() {
  const gid = document.getElementById('payrollGroupFilter')?.value || 'all';
  populatePayrollEmployeeSelect(gid);
  document.getElementById('payrollResults').innerHTML = '';
}

export function handlePayrollEmployeeChange() {
  const empId = document.getElementById('payrollEmployeeSelect')?.value;
  if (!empId) { document.getElementById('payrollGroupFilter').value = 'all'; return; }
  const emp = state.employees.find(e => e.id === empId);
  if (emp) document.getElementById('payrollGroupFilter').value = emp.groupId || 'all';
  document.getElementById('payrollResults').innerHTML = '';
}

function populatePayrollEmployeeSelect(groupId = 'all') {
  const sel = document.getElementById('payrollEmployeeSelect');
  if (!sel) return;
  let list = state.employees;
  if (groupId !== 'all') list = list.filter(e => e.groupId === groupId);
  sel.innerHTML = '<option value="">Tous les employés</option>' +
    list.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
}

export function toggleAdvanceDaysInput() {
  const checked   = document.getElementById('includeAdvanceCheckbox')?.checked;
  const container = document.getElementById('advanceDaysContainer');
  const input     = document.getElementById('advanceDaysInput');
  if (container) container.style.display = checked ? 'block' : 'none';
  if (input && !checked) input.value = 0;
}

export async function calculatePayroll() {
  const container    = document.getElementById('payrollResults');
  container.innerHTML = '<div style="text-align:center;padding:20px;"><p>Calcul en cours...</p></div>';

  const month    = document.getElementById('payrollMonth')?.value;
  const empId    = document.getElementById('payrollEmployeeSelect')?.value;
  const groupId  = document.getElementById('payrollGroupFilter')?.value;
  const inclAdv  = document.getElementById('includeAdvanceCheckbox')?.checked;
  const advDays  = parseInt(document.getElementById('advanceDaysInput')?.value) || 0;

  if (!month) { showToast('Sélectionnez un mois.', 'error'); container.innerHTML = ''; return; }

  let toProcess = state.employees.filter(e => e.status === 'actif' || e.status === 'depart' || !e.status);
  if (groupId !== 'all') toProcess = toProcess.filter(e => e.groupId === groupId);
  if (empId)             toProcess = toProcess.filter(e => e.id === empId);
  if (!toProcess.length) { container.innerHTML = '<p>Aucun employé.</p>'; return; }

  const [y, m]       = month.split('-');
  const daysInMonth  = getDaysInMonth(parseInt(y), parseInt(m));
  const existingPayrolls = state.payrolls.filter(p => p.month === month);

  let totGross = 0, totAdv = 0, totNet = 0;
  const unpaid = [];
  const html   = [];

  for (const emp of toProcess) {
    const present   = countPresenceDays(emp.id, month);
    const propSal   = (emp.salary / daysInMonth) * present;
    const advances  = state.advances
      .filter(a => a.employeeId === emp.id && a.date.startsWith(month))
      .reduce((s, a) => s + a.amount, 0);
    const netMonth  = Math.max(0, propSal - advances);

    let acompte = 0;
    if (inclAdv && advDays > 0) {
      const [ny, nm] = month.split('-').map(Number);
      const nd = new Date(ny, nm, 1);
      acompte = (emp.salary / getDaysInMonth(nd.getFullYear(), nd.getMonth() + 1)) * advDays;
    }

    const finalNet = netMonth + acompte;
    const existing = existingPayrolls.find(p => p.employeeId === emp.id);
    const isPaid   = !!existing;

    if (!isPaid && finalNet > 0) { totNet += finalNet; unpaid.push({ id: emp.id, name: emp.name }); }
    totGross += propSal; totAdv += advances;

    html.push(`
      <div class="payroll-item ${isPaid ? 'paid' : ''}" id="payroll-item-${emp.id}" style="display:flex;justify-content:space-between;align-items:center;padding:12px;margin-bottom:8px;border:1px solid var(--md-sys-color-outline-variant);border-left-width:6px;">
        <div>
          <h4>${emp.name}
            <span class="attendance-badge ${present === 0 ? 'no-attendance' : ''}">
              <span class="material-icons" style="font-size:16px;">${present === 0 ? 'event_busy' : 'check_circle'}</span>
              <span>${present} jour${present > 1 ? 's' : ''}</span>
            </span>
          </h4>
          <p>${emp.position}</p>
          <div class="payroll-status-container">
            ${isPaid ? `
              <div class="employee-status present"><span class="material-icons">check_circle</span> Payé le ${formatDate(existing.date, false)}</div>
              <small>Montant: <b class="amount" style="color:var(--md-sys-color-success);">${formatCurrency(existing.amount)}</b></small>
            ` : `
              <div style="font-size:.9em;margin-top:5px;">
                Net ${month}: <b>${formatCurrency(netMonth)}</b>
                ${inclAdv && acompte > 0 ? `<br><span style="color:var(--md-sys-color-primary);">+ Acompte (${advDays}j): <b>${formatCurrency(acompte)}</b></span>` : ''}
                <hr style="margin:4px 0;"><strong>Total: ${formatCurrency(finalNet)}</strong>
              </div>
            `}
          </div>
        </div>
        <div style="text-align:right;display:flex;align-items:center;gap:8px;">
          ${isPaid ? `
            <button class="btn-icon" onclick="window._deletePayroll?.('${existing.id}')" title="Supprimer">
              <span class="material-icons" style="color:var(--md-sys-color-error);">delete</span>
            </button>` :
          finalNet > 0 ? `
            <button class="btn btn-success" onclick="window._savePayroll?.('${emp.id}','${month}',${finalNet},${acompte})">
              <span class="material-icons">save</span> Payer
            </button>` : '<small>Aucun paiement requis</small>'}
        </div>
      </div>`);
  }

  // Résumé
  const summary = document.getElementById('payrollSummary');
  if (summary) {
    summary.style.display = 'block';
    document.getElementById('summaryTotalGross').textContent = formatCurrency(totGross);
    document.getElementById('summaryTotalAdvances').textContent = formatCurrency(totAdv);
    document.getElementById('summaryTotalNet').textContent = formatCurrency(totNet);
    const ul = document.getElementById('unpaidEmployeesList');
    if (ul) ul.innerHTML = unpaid.length
      ? unpaid.map(e => `<div id="unpaid-name-${e.id}">- ${e.name}</div>`).join('')
      : '<span style="color:var(--md-sys-color-success);">Tous payés.</span>';
  }

  container.innerHTML = html.join('');
}

export async function savePayroll(empId, month, total, acompte = 0) {
  const emp = state.employees.find(e => e.id === empId);
  if (!emp) return;
  if (state.payrolls.find(p => p.employeeId === empId && p.month === month)) {
    showToast("Déjà payé pour ce mois.", 'error'); return;
  }

  const rec = { id: Date.now().toString(), employeeId: empId, employeeName: emp.name, position: emp.position, month, amount: total, date: new Date().toISOString() };
  state.payrolls.push(rec);
  await dbManager.add('payrolls', rec);

  if (acompte > 0) {
    const [ny, nm] = month.split('-').map(Number);
    const nd  = new Date(ny, nm, 1);
    const nms = `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}`;
    const adv = { id: `adv-${Date.now()}`, employeeId: empId, employeeName: emp.name, amount: acompte, date: `${nms}-01`, reason: `Acompte payé avec salaire ${month}`, dateCreated: new Date().toISOString() };
    state.advances.push(adv);
    await dbManager.add('advances', adv);
  }

  showToast("Paie enregistrée!", "success");
  // Mettre à jour l'UI en place
  const item = document.getElementById(`payroll-item-${empId}`);
  if (item) {
    item.classList.add('paid');
    const actions = item.querySelector('div[style*="text-align:right"]');
    if (actions) actions.innerHTML = `<button class="btn-icon" onclick="window._deletePayroll?.('${rec.id}')"><span class="material-icons" style="color:var(--md-sys-color-error);">delete</span></button>`;
    const status = item.querySelector('.payroll-status-container');
    if (status) status.innerHTML = `<div class="employee-status present"><span class="material-icons">check_circle</span> Payé le ${formatDate(rec.date, false)}</div><small>Montant: <b class="amount" style="color:var(--md-sys-color-success);">${formatCurrency(rec.amount)}</b></small>`;
  }
  window._updateStats?.();
}

export async function deletePayroll(id) {
  const confirmed = await openConfirm(
    'Confirmation de suppression',
    'Êtes-vous sûr de vouloir supprimer cette paie?',
    'Supprimer',
    'Annuler',
    { isDanger: true }
  );
  if (!confirmed) return;
  
  state.payrolls = state.payrolls.filter(p => p.id !== id);
  await dbManager.delete('payrolls', id);
  showToast("Paie supprimée.", "success");
  calculatePayroll();
  window._updateStats?.();
}

export function displayPayments() {
  const empFilter = document.getElementById('paymentEmployeeFilter')?.value || '';
  const search    = (document.getElementById('paymentSearch')?.value || '').toLowerCase();
  const list      = document.getElementById('paymentList');
  let pays = state.payrolls;
  if (empFilter) pays = pays.filter(p => p.employeeId === empFilter);
  if (search)    pays = pays.filter(p => p.employeeName.toLowerCase().includes(search) || p.month.includes(search));

  list.innerHTML = pays.length ? pays.map(p => `
    <div class="payment-item" style="display:flex;justify-content:space-between;align-items:center;padding:12px;margin-bottom:8px;background:var(--md-sys-color-surface);border:1px solid var(--md-sys-color-outline-variant);border-radius:8px;">
      <div>
        <h4>${p.employeeName}</h4>
        <p>Mois: ${p.month} | ${formatCurrency(p.amount)}</p>
      </div>
      <button class="btn btn-danger" onclick="window._deletePayment?.('${p.id}')">
        <span class="material-icons">delete</span>
      </button>
    </div>`).join('') : '<p>Aucun paiement trouvé.</p>';
}

// Expose
window._savePayroll   = savePayroll;
window._deletePayroll = deletePayroll;
window._deletePayment = async (id) => {
  const confirmed = await openConfirm(
    'Confirmation de suppression',
    'Êtes-vous sûr de vouloir supprimer ce paiement?',
    'Supprimer',
    'Annuler',
    { isDanger: true }
  );
  if (!confirmed) return;
  
  state.payrolls = state.payrolls.filter(p => p.id !== id);
  await saveData();
  displayPayments();
};
window._handlePayrollEmployeeChange = handlePayrollEmployeeChange;
