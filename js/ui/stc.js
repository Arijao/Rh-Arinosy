// ============================================================
// ui/stc.js — Solde de Tout Compte (ES Module)
// ============================================================

import { state, saveData, dbManager } from '../state.js';
import { formatCurrency, formatDate, getDaysInMonth } from '../utils/format.js';
import { countPresenceDays, getLastPaidMonth, getStartDateForCalculation } from '../utils/attendance-calc.js';
import { showToast, openConfirm } from '../utils/notifications.js';
import { registerSectionCallback } from './navigation.js';

export function initSTC() {
  registerSectionCallback('stc', () => {
    populateSTCEmployeeSelect();
    const c = document.getElementById('stcResultsContainer');
    if (c) c.style.display = 'none';
  });
}

export function populateSTCEmployeeSelect() {
  const sel = document.getElementById('stcEmployeeSelect');
  if (!sel) return;
  const leaving = state.employees.filter(e => e.status === 'depart');
  sel.innerHTML = '<option value="">-- Choisir un employé --</option>' +
    leaving.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
}

export async function calculateSTC() {
  const empId    = document.getElementById('stcEmployeeSelect')?.value;
  const container = document.getElementById('stcResultsContainer');
  if (!container) return;
  if (!empId) { container.style.display = 'none'; return; }

  container.style.display = 'block';
  container.innerHTML = '<p>Calcul en cours...</p>';

  const emp = state.employees.find(e => e.id === empId);
  if (!emp?.departureDate) {
    container.innerHTML = '<p class="alert alert-error">Date de départ non définie.</p>'; return;
  }

  const depDate      = new Date(emp.departureDate + 'T00:00:00');
  const lastPaid     = getLastPaidMonth(empId);
  const startDate    = getStartDateForCalculation(lastPaid, empId);

  if (depDate < startDate) {
    container.innerHTML = '<p class="alert alert-warning">Déjà payé pour toute la période.</p>'; return;
  }

  let totalGross = 0, totalAdv = 0, totalDays = 0;
  const details  = [];
  let curY = startDate.getUTCFullYear();
  let curM = startDate.getMonth();
  const endY = depDate.getUTCFullYear();
  const endM = depDate.getUTCMonth();

  while (curY < endY || (curY === endY && curM <= endM)) {
    const mo     = curM + 1;
    const mStr   = `${curY}-${String(mo).padStart(2, '0')}`;
    const daysM  = getDaysInMonth(curY, mo);
    const present = countPresenceDays(empId, mStr);
    totalDays    += present;
    const gross  = (emp.salary / daysM) * present;
    totalGross   += gross;
    const advs   = state.advances.filter(a => a.employeeId === empId && a.date.startsWith(mStr)).reduce((s, a) => s + a.amount, 0);
    totalAdv     += advs;
    if (present > 0 || advs > 0) details.push(`<li>${mStr}: ${present.toFixed(2)} j | Brut: ${formatCurrency(gross)} | Avances: ${formatCurrency(advs)}</li>`);
    curM++;
    if (curM > 11) { curM = 0; curY++; }
  }

  const net = Math.max(0, totalGross - totalAdv);

  container.innerHTML = `
    <h3>Solde pour ${emp.name}</h3>
    <p>Période: <strong>${startDate.toLocaleDateString('fr-FR', { timeZone: 'UTC' })}</strong> au <strong>${new Date(emp.departureDate + 'T00:00:00Z').toLocaleDateString('fr-FR', { timeZone: 'UTC' })}</strong></p>
    <div class="stats-grid" style="grid-template-columns:1fr 1fr 1fr;margin:16px 0;">
      <div class="stat-card"><div class="stat-content"><h3>${totalDays.toFixed(2)}</h3><p>Jours à Payer</p></div></div>
      <div class="stat-card"><div class="stat-content"><h3>${formatCurrency(totalGross)}</h3><p>Salaire Brut</p></div></div>
      <div class="stat-card"><div class="stat-content"><h3>${formatCurrency(totalAdv)}</h3><p>Avances</p></div></div>
    </div>
    <div class="card" style="margin:16px 0;background:var(--md-sys-color-primary-container);">
      <h2 style="color:var(--md-sys-color-on-primary-container);">Montant Final: ${formatCurrency(net)}</h2>
    </div>
    <h4>Résumé mensuel:</h4>
    <ul style="max-height:150px;overflow-y:auto;padding:10px;background:var(--md-sys-color-surface-variant);border-radius:8px;">
      ${details.join('') || '<li>Aucune activité.</li>'}
    </ul>
    <button class="btn btn-success" style="margin-top:24px;" onclick="window._finalizeSTC?.('${emp.id}',${net})">
      <span class="material-icons">check_circle</span> Valider et Payer
    </button>`;
}

export async function finalizeSTC(empId, amount) {
  const emp = state.employees.find(e => e.id === empId);
  if (!emp) return;
  
  const confirmed = await openConfirm(
    'Solde de tout compte',
    `Payer <strong>${formatCurrency(amount)}</strong> à <strong>${emp.name}</strong> et marquer comme Inactif?`,
    'Payer et Clôturer',
    'Annuler'
  );
  if (!confirmed) return;

  const rec = { id: `stc-${empId}-${Date.now()}`, employeeId: empId, employeeName: emp.name, month: 'SOLDE_DE_TOUT_COMPTE', amount, date: new Date().toISOString() };
  state.payrolls.push(rec);
  await dbManager.add('payrolls', rec);

  const idx = state.employees.findIndex(e => e.id === empId);
  if (idx > -1) { state.employees[idx].status = 'inactif'; state.employees[idx].departureDate = new Date().toISOString().split('T')[0]; }
  await saveData();

  showToast('Solde payé! Employé marqué inactif.', 'success');
  populateSTCEmployeeSelect();
  document.getElementById('stcResultsContainer').style.display = 'none';
  window._displayEmployees?.();
}

window._finalizeSTC = finalizeSTC;
