// ============================================================
// ui/stats.js — Dashboard Stats & Charts (ES Module)
// ============================================================

import { state } from '../state.js';
import { formatCurrency, getDaysInMonth, calculateWorkDuration } from '../utils/format.js';
import { countPresenceDays, getEmployeeAdvancesForMonth } from '../utils/attendance-calc.js';
import { registerSectionCallback } from './navigation.js';

let weeklyChart, groupChart, genderChart;

export function initStats() {
  registerSectionCallback('dashboard', () => { updateStats(); displayDashboardCharts(); });
}

// ------ Stats ------

export function updateStats() {
  const today        = new Date().toISOString().split('T')[0];
  const currentMonth = new Date().toISOString().slice(0, 7);
  const dayAtt       = state.attendance[today] || {};

  // Total employés
  _set('totalEmployees', state.employees.length);

  // Employés ayant pointé (arrivée ET départ)
  const checkedIn = Object.values(dayAtt).filter(a => a && a.arrivee && a.depart).length;
  _set('checkedInToday', checkedIn);

  // Journées complètes (≥ 4h)
  const complete = Object.values(dayAtt).filter(a => {
    if (!a || !a.arrivee || !a.depart) return false;
    return calculateWorkDuration(a.arrivee, a.depart).totalMinutes / 60 >= 4;
  }).length;
  _set('presentToday', complete);

  // Comptes par méthode
  let qr = 0, manual = 0, facial = 0;
  Object.values(dayAtt).forEach(a => {
    if (!a?.arrivee) return;
    if (a.method === 'QR') qr++;
    else if (a.method === 'FACIAL') facial++;
    else manual++;
  });
  window.attendanceMethodCounts = { qr, manual, facial, total: qr + manual + facial };
  const filter  = window.currentMethodFilter || 'all';
  const display = filter === 'qr' ? qr : filter === 'manual' ? manual : filter === 'facial' ? facial : qr + manual + facial;
  _set('qrScansToday', display);
  _updateMethodCounts();

  // Salaires du mois
  const [y, m] = currentMonth.split('-');
  const daysInMonth = getDaysInMonth(parseInt(y), parseInt(m));
  let totalNet = 0;
  state.employees.forEach(emp => {
    const days  = countPresenceDays(emp.id, currentMonth);
    const gross = (emp.salary / daysInMonth) * days;
    const advs  = getEmployeeAdvancesForMonth(emp.id, currentMonth).reduce((s, a) => s + a.amount, 0);
    totalNet += Math.max(0, gross - advs);
  });
  _set('totalSalaries', formatCurrency(totalNet));
}

function _set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function _updateMethodCounts() {
  const c = window.attendanceMethodCounts || {};
  _set('allCount',    `${c.total || 0} pointage${(c.total || 0) > 1 ? 's' : ''}`);
  _set('qrCount',     `${c.qr || 0} scan${(c.qr || 0) > 1 ? 's' : ''}`);
  _set('manualCount', `${c.manual || 0} entrée${(c.manual || 0) > 1 ? 's' : ''}`);
  _set('facialCount', `${c.facial || 0} reconnaissance${(c.facial || 0) > 1 ? 's' : ''}`);
}

// ------ Charts ------

export function displayDashboardCharts() {
  if (!document.getElementById('dashboard')?.classList.contains('active')) return;
  _renderWeeklyChart();
  _renderGroupChart();
  _renderGenderChart();
}

function _renderWeeklyChart() {
  const ctx = document.getElementById('weeklyAttendanceChart');
  if (!ctx) return;
  weeklyChart?.destroy();
  const labels = [], data = [];
  const total  = state.employees.length || 1;
  for (let i = 6; i >= 0; i--) {
    const d  = new Date(); d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    const dayName = d.toLocaleDateString('fr-FR', { weekday: 'short' });
    labels.push(dayName.charAt(0).toUpperCase() + dayName.slice(1));
    const present = state.attendance[ds]
      ? Object.values(state.attendance[ds]).filter(Boolean).length : 0;
    data.push(((present / total) * 100).toFixed(1));
  }
  weeklyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Taux de Présence (%)', data,
        backgroundColor: 'rgba(103, 80, 164, 0.6)',
        borderColor: 'rgba(103, 80, 164, 1)', borderWidth: 1, borderRadius: 4 }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, max: 100 } },
      plugins: { legend: { display: false } } }
  });
}

function _renderGroupChart() {
  const ctx = document.getElementById('groupDistributionChart');
  if (!ctx) return;
  groupChart?.destroy();
  const counts = {};
  state.groups.forEach(g => { counts[g.name] = 0; });
  let noGroup = 0;
  state.employees.forEach(e => {
    const g = state.groups.find(g => g.id === e.groupId);
    g ? counts[g.name]++ : noGroup++;
  });
  const labels = Object.keys(counts);
  const data   = Object.values(counts);
  if (noGroup > 0) { labels.push('Sans Groupe'); data.push(noGroup); }
  groupChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data,
      backgroundColor: ['#6750A4','#EADDFF','#625B71','#E8DEF8','#7D5260','#FFD8E4','#49454F'],
      hoverOffset: 8 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } } }
  });
}

function _renderGenderChart() {
  const ctx = document.getElementById('genderDistributionChart');
  if (!ctx) return;
  genderChart?.destroy();
  let males = 0, females = 0, other = 0;
  state.employees.forEach(e => {
    if (e.gender === 'Homme') males++;
    else if (e.gender === 'Femme') females++;
    else other++;
  });
  const labels = ['Hommes', 'Femmes'];
  const data   = [males, females];
  if (other > 0) { labels.push('Autre'); data.push(other); }
  genderChart = new Chart(ctx, {
    type: 'pie',
    data: { labels, datasets: [{ data,
      backgroundColor: ['#6750A4', '#FFD8E4', '#CAC4D0'],
      borderColor: '#FFFFFF', borderWidth: 2, hoverOffset: 8 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } } }
  });
}

// ------ Smart Checks / Notifications ------

export function runSmartChecks() {
  const container = document.getElementById('notificationsContainer');
  if (!container) return;
  container.innerHTML = '';

  const today  = new Date().toISOString().split('T')[0];
  const dayAtt = state.attendance[today] || {};
  const missing = [];

  for (const empId in dayAtt) {
    const a = dayAtt[empId];
    if (typeof a === 'object' && a?.arrivee && !a.depart) {
      const emp = state.employees.find(e => e.id === empId);
      if (emp) missing.push({ id: empId, name: emp.name, position: emp.position, arrivee: a.arrivee, method: a.method || 'MANUAL' });
    }
  }

  if (!missing.length) return;
  missing.sort((a, b) => a.arrivee.localeCompare(b.arrivee));
  const notifId = `notif-${Date.now()}`;

  container.innerHTML = `
    <div class="alert-warning-compact" style="margin:0 auto;padding:12px 16px;border-radius:12px;border-left:4px solid #f59e0b;background:rgba(245,158,11,0.09);cursor:pointer;transition:all 0.2s;max-width:600px;box-shadow:0 2px 8px rgba(245,158,11,0.2);"
      onclick="window._toggleNotifDetails?.('${notifId}')">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
          <span class="material-icons" style="color:#f59e0b;font-size:24px;flex-shrink:0;">watch_later</span>
          <div style="min-width:0;">
            <strong style="font-size:14px;color:#b45309;display:block;font-weight:700;">⚠️ ${missing.length} employé(s) en attente</strong>
            <span style="font-size:11px;color:#78716c;display:block;">Cliquez pour les détails</span>
          </div>
        </div>
        <span class="material-icons" id="${notifId}-icon" style="color:#f59e0b;font-size:20px;flex-shrink:0;">expand_more</span>
      </div>
      <div id="${notifId}-details" style="display:none;margin-top:12px;padding:8px 0;border-top:1px solid #fde68a;max-height:280px;overflow-y:auto;">
        ${missing.map((e, idx) => {
          const color = e.method === 'QR' ? '#6750A4' : e.method === 'FACIAL' ? '#0ea5e9' : '#f59e0b';
          const icon  = e.method === 'QR' ? 'qr_code_scanner' : e.method === 'FACIAL' ? 'face' : 'edit';
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;${idx > 0 ? 'border-top:1px solid #fed7aa;' : ''}">
            <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
              <span class="material-icons" style="color:${color};font-size:18px;flex-shrink:0;">${icon}</span>
              <div style="min-width:0;overflow:hidden;">
                <strong style="display:block;font-size:13px;color:#1f2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${e.name}</strong>
                <span style="font-size:11px;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;">${e.position}</span>
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0;margin-left:8px;">
              <div style="font-size:10px;color:#6b7280;">Arrivée</div>
              <strong style="font-size:12px;color:#1f2937;">${e.arrivee}</strong>
            </div>
          </div>`;
        }).join('')}
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid #fde68a;text-align:center;">
          <a href="#" onclick="window._showSection?.('attendance');return false;" style="color:#b45309;text-decoration:none;font-weight:600;font-size:12px;display:inline-flex;align-items:center;gap:4px;">
            <span class="material-icons" style="font-size:16px;">arrow_forward</span>Marquer les départs
          </a>
        </div>
      </div>
    </div>`;
}

export function toggleNotificationDetails(id) {
  const d    = document.getElementById(`${id}-details`);
  const icon = document.getElementById(`${id}-icon`);
  if (!d || !icon) return;
  if (d.style.display === 'none') {
    d.style.display = 'block'; icon.textContent = 'expand_less';
  } else {
    d.style.display = 'none'; icon.textContent = 'expand_more';
  }
}

// expose
window._toggleNotifDetails = toggleNotificationDetails;
window._updateStats        = updateStats;
window._runSmartChecks     = runSmartChecks;
