// ============================================================
// ui/estimation.js — Estimation Salaires (ES Module)
// ============================================================

import { state } from '../state.js';
import { formatCurrency, getDaysInMonth, calculateWorkDuration } from '../utils/format.js';
import { showToast } from '../utils/notifications.js';
import { registerSectionCallback } from './navigation.js';
import { populateGroupSelects } from './groups.js';

export function initEstimation() {
  registerSectionCallback('estimation', () => {
    populateGroupSelects();
    const today = new Date();
    const start = document.getElementById('estimationStartDate');
    const end   = document.getElementById('estimationEndDate');
    if (start) start.value = today.toISOString().slice(0, 10);
    if (end)   end.value   = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  });
}

export function calculateSalaryEstimation() {
  const startStr = document.getElementById('estimationStartDate')?.value;
  const endStr   = document.getElementById('estimationEndDate')?.value;
  const groupFilter = document.getElementById('estimationGroupFilter')?.value || 'all';
  const container = document.getElementById('estimationResultsContainer');

  if (!startStr || !endStr) { showToast('Sélectionnez une période.', 'error'); return; }
  const startDate = new Date(startStr + 'T00:00:00Z');
  const endDate   = new Date(endStr   + 'T23:59:59Z');
  if (endDate < startDate) { showToast('Date de fin antérieure à la date de début.', 'error'); return; }

  container.style.display = 'block';
  container.innerHTML     = '<p>Calcul en cours...</p>';

  let emps = state.employees.filter(e => e.status !== 'inactif');
  if (groupFilter !== 'all') emps = emps.filter(e => e.groupId === groupFilter);

  let totalGross = 0, totalAdv = 0, pastDays = 0, futureDays = 0;
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const ds  = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    const daysM = getDaysInMonth(d.getUTCFullYear(), d.getUTCMonth() + 1);

    emps.forEach(emp => {
      const dailySal = emp.salary / daysM;
      let val = 0;

      if (d < today) {
        const p = state.attendance[ds]?.[emp.id];
        if (p) {
          if (dow === 0) { val = 1; }
          else if (typeof p === 'object' && p.arrivee) {
            if (p.depart) {
              const { totalMinutes } = calculateWorkDuration(p.arrivee, p.depart);
              val = totalMinutes / 60 >= 4 ? 1 : totalMinutes > 0 ? 0.5 : 0;
            } else val = 0.5;
          } else if (p === true || p === 'journee') val = 1;
          else if (p === 'demi') val = 0.5;
        }
        pastDays += val;
      } else {
        // Estimation future : on compte les jours ouvrés (ex: hors dimanche)
        if (dow !== 0) val = 1; 
        futureDays += val;
      }
      totalGross += dailySal * val;
    });
  }

  emps.forEach(emp => {
    totalAdv += state.advances.filter(a => {
      const ad = new Date(a.date + 'T00:00:00Z');
      return a.employeeId === emp.id && ad >= startDate && ad <= endDate;
    }).reduce((s, a) => s + a.amount, 0);
  });

  const totalNet = totalGross - totalAdv;
  const empCount = emps.length;

  container.innerHTML = `
    <h3>Résultats de l'Estimation</h3>
    <p>Du <strong>${startDate.toLocaleDateString('fr-FR', { timeZone: 'UTC' })}</strong> au <strong>${endDate.toLocaleDateString('fr-FR', { timeZone: 'UTC' })}</strong></p>
    <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(250px,1fr));margin:16px 0;">
      <div class="stat-card"><div class="stat-icon"><span class="material-icons">receipt_long</span></div><div class="stat-content"><h3>${formatCurrency(totalGross)}</h3><p>Total BRUT Estimé</p></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:var(--md-sys-color-error);"><span class="material-icons">trending_down</span></div><div class="stat-content"><h3>${formatCurrency(totalAdv)}</h3><p>Avances sur Période</p></div></div>
      <div class="stat-card" style="background:var(--md-sys-color-primary-container);"><div class="stat-icon"><span class="material-icons">payments</span></div><div class="stat-content"><h3 style="color:var(--md-sys-color-on-primary-container);">${formatCurrency(totalNet)}</h3><p>Total NET Estimé</p></div></div>
    </div>
    <div style="padding:12px;background:var(--md-sys-color-surface-variant);border-radius:8px;">
      <ul style="margin:0;padding-left:20px;">
        <li>Nombre d'employés concernés : <strong>${empCount}</strong></li>
        <li>Jours passés (réels) : <strong>${pastDays.toFixed(2)} j-homme</strong> ${empCount > 0 ? `(soit ${(pastDays/empCount).toFixed(1)} j/emp)` : ''}</li>
        <li>Jours futurs (estimés) : <strong>${futureDays.toFixed(2)} j-homme</strong> ${empCount > 0 ? `(soit ${(futureDays/empCount).toFixed(1)} j/emp)` : ''}</li>
        <li>Total jours-homme : <strong>${(pastDays + futureDays).toFixed(2)}</strong></li>
      </ul>
      <p style="font-size:0.85em;margin-top:8px;opacity:0.8;"><i>Note : L'estimation future exclut les dimanches.</i></p>
    </div>`;
}
