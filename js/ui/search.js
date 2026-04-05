// ============================================================
// ui/search.js — Recherche Intelligente Statut Employé (ES Module)
// ============================================================

import { state } from '../state.js';
import { formatCurrency, formatDate, formatDisplayTime, getDaysInMonth, calculateWorkDuration } from '../utils/format.js';
import { countPresenceDays } from '../utils/attendance-calc.js';
import { registerSectionCallback } from './navigation.js';
import { debounce } from '../utils/format.js';

export function initSearch() {
  registerSectionCallback('employee-stats', () => {
    const el = document.getElementById('statsMonth');
    if (el && !el.value) el.value = new Date().toISOString().slice(0, 7);
  });

  const input = document.getElementById('smartSearchInput');
  if (input) input.addEventListener('input', debounce(handleSmartSearch, 300));

  const month = document.getElementById('statsMonth');
  if (month) month.addEventListener('change', () => {
    const cur = document.getElementById('smartSearchInput')?.value;
    const emp = state.employees.find(e => e.name === cur);
    if (emp) displayEmployeeStatus(emp.id);
  });
}

// ------ Smart Search ------

export function handleSmartSearch() {
  const term      = (document.getElementById('smartSearchInput')?.value || '').toLowerCase().trim();
  const results   = document.getElementById('smartSearchResults');
  const report    = document.getElementById('employeeStatusResults');
  if (!results) return;

  if (term.length < 2) { results.innerHTML = ''; if (report) report.innerHTML = ''; return; }

  const found = state.employees.filter(e =>
    e.name.toLowerCase().includes(term) || e.position.toLowerCase().includes(term)
  );

  if (!found.length) {
    results.innerHTML = `<p style="text-align:center;padding:20px;color:#64748b;font-weight:600;">Aucun employé trouvé.</p>`;
    return;
  }

  const today        = new Date().toISOString().split('T')[0];
  const currentMonth = new Date().toISOString().slice(0, 7);

  results.innerHTML = found.map(emp => {
    const group     = state.groups.find(g => g.id === emp.groupId);
    const groupName = group ? group.name : '<i>Sans groupe</i>';
    const todayP    = !!state.attendance[today]?.[emp.id];
    const qrCount   = state.qrAttendance.filter(a => a.employeeId === emp.id && a.date.startsWith(currentMonth)).length;

    let facial = 0, manual = 0;
    Object.keys(state.attendance).forEach(d => {
      if (!d.startsWith(currentMonth)) return;
      const a = state.attendance[d]?.[emp.id];
      if (!a) return;
      if (a.method === 'FACIAL') facial++;
      else if (a.method === 'MANUAL') manual++;
    });

    const badges = [
      todayP ? `<span style="background:rgba(16,185,129,.2);border:1.5px solid rgba(16,185,129,.4);color:#064e3b;padding:5px 12px;border-radius:20px;font-size:.85em;font-weight:700;display:inline-flex;align-items:center;gap:5px;"><span class="material-icons" style="font-size:16px;">check_circle</span>Présent aujourd'hui</span>` : '',
      qrCount  ? `<span style="background:rgba(103,80,164,.15);border:1.5px solid rgba(103,80,164,.3);color:#3730a3;padding:5px 12px;border-radius:20px;font-size:.85em;font-weight:700;display:inline-flex;align-items:center;gap:5px;"><span class="material-icons" style="font-size:16px;">qr_code_scanner</span>${qrCount} QR</span>` : '',
      facial   ? `<span style="background:rgba(14,165,233,.15);border:1.5px solid rgba(14,165,233,.3);color:#075985;padding:5px 12px;border-radius:20px;font-size:.85em;font-weight:700;display:inline-flex;align-items:center;gap:5px;"><span class="material-icons" style="font-size:16px;">face</span>${facial} Facial</span>` : '',
      manual   ? `<span style="background:rgba(245,158,11,.15);border:1.5px solid rgba(245,158,11,.3);color:#78350f;padding:5px 12px;border-radius:20px;font-size:.85em;font-weight:700;display:inline-flex;align-items:center;gap:5px;"><span class="material-icons" style="font-size:16px;">edit</span>${manual} Manuel</span>` : '',
    ].filter(Boolean).join('');

    return `
      <div class="employee-item" style="cursor:pointer;border-radius:12px;padding:16px;margin-bottom:12px;transition:all 0.3s ease;"
           onclick="window._selectEmployeeForStat?.('${emp.id}')"
           onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 8px 20px rgba(255,105,180,.2)'"
           onmouseout="this.style.transform='translateY(0)';this.style.boxShadow='none'">
        <div class="employee-info">
          <h4 style="margin:0 0 6px;color:#1e293b;font-size:1.1em;font-weight:800;">${emp.name}</h4>
          <p style="margin:0 0 10px;color:#475569;font-weight:600;">${emp.position} • <strong style="color:#FF1493;">Groupe: ${groupName}</strong></p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">${badges}</div>
        </div>
        <span class="material-icons" style="color:#FF1493;">arrow_forward_ios</span>
      </div>`;
  }).join('');
}

export function selectEmployeeForStat(id) {
  const emp = state.employees.find(e => e.id === id);
  if (!emp) return;
  const input = document.getElementById('smartSearchInput');
  if (input) input.value = emp.name;
  document.getElementById('smartSearchResults').innerHTML = '';
  displayEmployeeStatus(id);
}

// ------ Status Report ------

export async function displayEmployeeStatus(empId) {
  const month     = document.getElementById('statsMonth')?.value;
  const container = document.getElementById('employeeStatusResults');
  if (!empId || !month || !container) return;

  const emp = state.employees.find(e => e.id === empId);
  if (!emp) return;

  const group     = state.groups.find(g => g.id === emp.groupId);
  const groupName = group ? group.name : '<i>Sans groupe</i>';
  const [y, m]    = month.split('-');
  const daysInMonth = getDaysInMonth(parseInt(y), parseInt(m));

  // Comptages
  let qrC = 0, facialC = 0, manualC = 0, totalC = 0;
  state.qrAttendance.filter(a => a.employeeId === empId && a.date.startsWith(month)).forEach(() => qrC++);
  Object.keys(state.attendance).forEach(d => {
    if (!d.startsWith(month)) return;
    const a = state.attendance[d]?.[empId];
    if (!a) return;
    totalC++;
    if (a.method === 'FACIAL') facialC++;
    else if (a.method === 'MANUAL') manualC++;
  });

  const presenceDays  = countPresenceDays(empId, month);
  const totalAdvances = state.advances
    .filter(a => a.employeeId === empId && a.date.startsWith(month))
    .reduce((s, a) => s + a.amount, 0);
  const propSalary    = (emp.salary / daysInMonth) * presenceDays;
  const netSalary     = propSalary - totalAdvances;

  // Calcul heures totales
  let totalMinutes = 0;
  const dailyDetails = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${y}-${m}-${String(day).padStart(2, '0')}`;
    const p       = state.attendance[dateStr]?.[empId];
    let duration  = { totalMinutes: 0, displayText: '---' };
    if (p?.arrivee && p?.depart) {
      duration = calculateWorkDuration(p.arrivee, p.depart);
      totalMinutes += duration.totalMinutes;
    }
    dailyDetails.push({ dateStr, p, duration });
  }
  const totalH   = Math.floor(totalMinutes / 60);
  const totalMin = totalMinutes % 60;

  // Tableau journalier
  const HALF = 240; const FULL = 480;
  const rows = dailyDetails.map(({ dateStr, p, duration }) => {
    const dow      = new Date(dateStr).getDay();
    const isWeekend = dow === 6 || dow === 0;
    const isPresent = !!p;
    let borderColor = isPresent ? '#10b981' : '#ef4444';
    if (isWeekend) borderColor = '#64748b';

    const method = p?.method || 'MANUAL';
    const badge  = isPresent
      ? method === 'FACIAL' ? `<span class="material-icons" style="font-size:14px;color:#0ea5e9;">face</span><span style="font-size:11px;color:#0ea5e9;font-weight:600;">FACIAL</span>`
        : method === 'QR'   ? `<span class="material-icons" style="font-size:14px;color:#6750A4;">qr_code_scanner</span><span style="font-size:11px;color:#6750A4;font-weight:600;">QR</span>`
        : `<span class="material-icons" style="font-size:14px;color:#f59e0b;">edit</span><span style="font-size:11px;color:#f59e0b;font-weight:600;">Manuel</span>`
      : '';

    const statusHtml = isPresent
      ? `<div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(16,185,129,.2);border:1.5px solid rgba(16,185,129,.4);border-radius:10px;">
           <span class="material-icons" style="font-size:18px;color:#059669;">check_circle</span>
           <span style="font-weight:700;color:#064e3b;">Présent</span>
           ${p.arrivee ? `<span style="font-size:11px;color:#065f46;">${formatDisplayTime(p.arrivee)} → ${formatDisplayTime(p.depart)}</span>` : ''}
           ${badge}
         </div>`
      : `<div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(239,68,68,.15);border:1.5px solid rgba(239,68,68,.4);border-radius:10px;">
           <span class="material-icons" style="font-size:18px;color:#dc2626;">cancel</span>
           <span style="font-weight:700;color:#7f1d1d;">Absent</span>
         </div>`;

    const durColor = duration.totalMinutes >= FULL ? '#10b981' : duration.totalMinutes >= HALF ? '#f59e0b' : duration.totalMinutes > 0 ? '#ef4444' : '#94a3b8';
    const advDay   = state.advances.filter(a => a.employeeId === empId && a.date === dateStr).reduce((s, a) => s + a.amount, 0);

    return `
      <tr style="background:rgba(209,250,229,.15);border-left:4px solid ${borderColor};" onmouseover="this.style.transform='translateX(6px)'" onmouseout="this.style.transform='translateX(0)'">
        <td style="padding:12px 16px;font-weight:700;color:#1e293b;">${formatDate(dateStr)}</td>
        <td style="padding:12px 16px;">${statusHtml}</td>
        <td style="padding:12px 16px;text-align:center;font-weight:800;color:${durColor};">${duration.displayText}</td>
        <td style="padding:12px 16px;text-align:right;">${advDay > 0 ? `<span style="font-weight:800;color:#7f1d1d;">${formatCurrency(advDay)}</span>` : '-'}</td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div style="animation:fadeIn 0.4s ease;">
      <!-- Header -->
      <div style="background:linear-gradient(135deg,rgba(255,182,193,.25),rgba(221,160,221,.25));backdrop-filter:blur(10px);border:2px solid rgba(255,105,180,.4);border-radius:20px;padding:24px;margin-bottom:24px;box-shadow:0 8px 32px rgba(255,105,180,.25);">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px;">
          <div style="width:64px;height:64px;background:linear-gradient(135deg,#FF69B4,#BA55D3);border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(255,105,180,.4);">
            <span class="material-icons" style="font-size:36px;color:white;">person</span>
          </div>
          <div>
            <h3 style="margin:0;font-size:1.8em;font-weight:800;color:#1e293b;">${emp.name}</h3>
            <p style="margin:4px 0 0;font-size:1.1em;color:#475569;font-weight:600;">${emp.position} • <strong style="color:#FF1493;">Groupe: ${groupName}</strong></p>
          </div>
        </div>
      </div>

      <!-- Badges pointages -->
      <div style="background:linear-gradient(135deg,rgba(237,233,254,.5),rgba(221,214,254,.5));backdrop-filter:blur(10px);border:2px solid rgba(103,80,164,.35);border-radius:16px;padding:20px;margin-bottom:24px;">
        <h4 style="margin:0 0 16px;font-size:1.2em;font-weight:800;color:#1e293b;display:flex;align-items:center;gap:10px;">
          <span class="material-icons" style="color:#6750A4;">analytics</span> Pointages — ${month}
        </h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:14px;">
          ${[['apps','#6750A4',totalC,'Total'],['qr_code_scanner','#6750A4',qrC,'QR Code'],['face','#0ea5e9',facialC,'Facial'],['edit','#f59e0b',manualC,'Manuel']].map(([icon,color,val,label]) => `
            <div style="background:rgba(255,255,255,.85);padding:14px;border-radius:12px;text-align:center;border:2px solid ${color}22;box-shadow:0 4px 12px ${color}22;">
              <span class="material-icons" style="color:${color};font-size:24px;display:block;margin-bottom:8px;">${icon}</span>
              <div style="font-size:2em;font-weight:900;color:${color};line-height:1;">${val}</div>
              <div style="font-size:.9em;color:#1e293b;font-weight:700;margin-top:6px;">${label}</div>
            </div>`).join('')}
        </div>
      </div>

      <!-- Résumé mensuel -->
      <div style="background:linear-gradient(135deg,rgba(240,253,244,.5),rgba(209,250,229,.5));backdrop-filter:blur(10px);border:2px solid rgba(16,185,129,.35);border-radius:16px;padding:20px;margin-bottom:24px;">
        <h4 style="margin:0 0 16px;font-size:1.2em;font-weight:800;color:#1e293b;display:flex;align-items:center;gap:10px;">
          <span class="material-icons" style="color:#059669;">summarize</span> Résumé du Mois
        </h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:18px;">
          ${[
            ['event_available','#10b981',`${presenceDays}`,`/${daysInMonth}`,'Jours de Présence'],
            ['schedule','#3b82f6',`${totalH}h ${totalMin}m`,'','Total Heures'],
            ['savings','#ef4444',formatCurrency(totalAdvances),'','Total Avances'],
          ].map(([icon,color,main,sub,label]) => `
            <div style="padding:12px 16px;background:rgba(51,65,85,.45);backdrop-filter:blur(20px);border-radius:14px;border:1.5px solid rgba(148,163,184,.25);border-left:4px solid ${color};">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                <span class="material-icons" style="color:${color};font-size:20px;">${icon}</span>
                <strong style="color:#f1f5f9;font-size:.9em;">${label}</strong>
              </div>
              <span style="font-weight:800;color:#f1f5f9;font-size:1.4em;">${main}</span>
              ${sub ? `<span style="color:#cbd5e1;font-size:.95em;">${sub}</span>` : ''}
            </div>`).join('')}
        </div>
        <!-- Salaire net -->
        <div style="background:linear-gradient(135deg,rgba(255,182,193,.3),rgba(221,160,221,.3));backdrop-filter:blur(12px);padding:20px;border-radius:18px;text-align:center;border:2px solid rgba(255,105,180,.4);">
          <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:10px;">
            <span class="material-icons" style="color:#FF1493;font-size:32px;">payments</span>
            <strong style="color:#1e293b;font-size:1.15em;font-weight:800;">SALAIRE NET À PAYER</strong>
          </div>
          <div style="font-size:2.5em;font-weight:900;background:linear-gradient(135deg,#FF1493,#BA55D3);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${formatCurrency(netSalary)}</div>
        </div>
      </div>

      <!-- Tableau journalier -->
      <div style="background:rgba(255,255,255,.4);backdrop-filter:blur(16px);border:2px solid rgba(100,116,139,.3);border-radius:18px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1e293b,#334155);padding:18px 24px;">
          <h4 style="margin:0;color:white;font-size:1.3em;font-weight:900;display:flex;align-items:center;gap:12px;">
            <span class="material-icons" style="font-size:28px;">calendar_month</span> Détails Journaliers
          </h4>
        </div>
        <div style="max-height:500px;overflow-y:auto;">
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="background:rgba(51,65,85,.98);position:sticky;top:0;">
                ${['Date','Statut','Total Heures','Avance'].map(h => `<th style="padding:14px 16px;text-align:left;color:white;font-weight:900;border-bottom:3px solid rgba(255,105,180,.4);">${h}</th>`).join('')}
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

// Exposer
window._handleSmartSearch    = handleSmartSearch;
window._selectEmployeeForStat = selectEmployeeForStat;
