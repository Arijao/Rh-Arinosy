// ============================================================
// ui/attendance.js — Présences manuelles (ES Module)
// ============================================================

import { state, saveData, saveAttendanceData } from '../state.js';
import { renderPaginationControls } from '../utils/ui.js';
import { showToast, openConfirm } from '../utils/notifications.js';
import { formatDisplayTime, formatCurrency } from '../utils/format.js';
import { registerSectionCallback } from './navigation.js';
import { handleAttendanceEmployeeSearch, initAttendanceSearchDropdown } from './smart-search.js';
import { getRemarkBadge } from './remarks.js';

export function initAttendance() {
  registerSectionCallback('attendance', displayAttendance);

  document.getElementById('attendanceDate')
    ?.addEventListener('change', () => { state.pagination.attendance.current = 1; displayAttendance(); });
  document.getElementById('attendanceEmployeeSearch')
    ?.addEventListener('input', () => {
      state.pagination.attendance.current = 1;
      displayAttendance();           // filtre la liste paginée
      handleAttendanceEmployeeSearch(); // affiche le dropdown avec highlight
    });
  document.getElementById('attendanceGroupFilter')
    ?.addEventListener('change', () => {
      displayAttendance();
      // Rafraîchir le dropdown si une recherche est en cours
      const term = document.getElementById('attendanceEmployeeSearch')?.value || '';
      if (term.length >= 2) handleAttendanceEmployeeSearch();
    });

  initAttendanceSearchDropdown();
}

export function displayAttendance() {
  const container   = document.getElementById('attendanceList');
  const selectedDate = document.getElementById('attendanceDate')?.value;
  const searchTerm  = (document.getElementById('attendanceEmployeeSearch')?.value || '').toLowerCase();
  const groupFilter = document.getElementById('attendanceGroupFilter')?.value || 'all';

  if (!selectedDate) {
    container.innerHTML = '<p style="text-align:center;padding:20px;">Veuillez sélectionner une date.</p>';
    document.getElementById('attendancePagination').innerHTML = '';
    return;
  }
  if (!state.attendance[selectedDate]) state.attendance[selectedDate] = {};

  let active = state.employees.filter(e => e.status !== 'inactif');
  if (groupFilter !== 'all') active = active.filter(e => e.groupId === groupFilter);
  const filtered = active.filter(e =>
    e.name.toLowerCase().includes(searchTerm) || e.position.toLowerCase().includes(searchTerm)
  );

  // Tri: présents d'abord
  const dayAtt = state.attendance[selectedDate];
  renderAttendanceSummary(active, dayAtt); 
  filtered.sort((a, b) => {
    const aHas = !!dayAtt[a.id]?.arrivee;
    const bHas = !!dayAtt[b.id]?.arrivee;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    if (aHas && bHas) return (dayAtt[a.id].arrivee).localeCompare(dayAtt[b.id].arrivee);
    return a.name.localeCompare(b.name);
  });

  const { current, perPage } = state.pagination.attendance;
  const totalPages = Math.ceil(filtered.length / perPage);
  const page       = Math.max(1, Math.min(current, totalPages || 1));
  state.pagination.attendance.current = page;
  const slice = filtered.slice((page - 1) * perPage, page * perPage);

  container.innerHTML = slice.map(emp => {
    const p        = dayAtt[emp.id];
    const isDetail = typeof p === 'object' && p !== null && p.arrivee;
    const isSimple = p === true || typeof p === 'string';
    const group    = state.groups.find(g => g.id === emp.groupId);

    let methodBadge = '';
    if (isDetail) {
      const m = p.method || 'MANUAL';
      if (m === 'FACIAL')
        methodBadge = `<span class="material-icons" style="font-size:14px;color:#0ea5e9;vertical-align:middle;margin-left:8px;">face</span><span style="font-size:12px;color:#0ea5e9;font-weight:600;">FACIAL</span>`;
      else if (m === 'QR')
        methodBadge = `<span class="material-icons" style="font-size:14px;color:#6750A4;vertical-align:middle;margin-left:8px;">qr_code_scanner</span><span style="font-size:12px;color:#6750A4;font-weight:600;">QR</span>`;
      else
        methodBadge = `<span class="material-icons" style="font-size:14px;color:#f59e0b;vertical-align:middle;margin-left:8px;">edit</span><span style="font-size:12px;color:#f59e0b;font-weight:600;">Manuel</span>`;
    }

    return `
      <div class="attendance-item">
        <div class="attendance-status">
          <div class="status-indicator ${p ? 'present' : ''}"></div>
          <div>
            <h4 class="employee-name">${emp.name} ${getRemarkBadge(emp.id)}</h4>
            <p class="employee-position">${emp.position}</p>
            <p style="font-size:12px;"><strong>Groupe:</strong> ${group ? group.name : '<i>Sans groupe</i>'}</p>
          </div>
        </div>
        <div style="width:50%;text-align:right;">
          <div style="margin-bottom:8px;font-size:12px;">
            <label style="margin-right:16px;">
              <input type="radio" name="att-type-${emp.id}" value="simple"
                onchange="window._toggleAttType?.('${emp.id}','simple')"
                ${isSimple || !p ? 'checked' : ''}> Simple
            </label>
            <label>
              <input type="radio" name="att-type-${emp.id}" value="detailed"
                onchange="window._toggleAttType?.('${emp.id}','detailed')"
                ${isDetail ? 'checked' : ''}> Détaillé
            </label>
          </div>
          <div id="simple-att-${emp.id}" style="display:${isSimple || !p ? 'flex' : 'none'};align-items:center;justify-content:flex-end;gap:8px;">
            <label for="att-check-${emp.id}" style="cursor:pointer;font-weight:500;color:${p ? 'var(--md-sys-color-success)' : 'var(--md-sys-color-error)'};">
              ${p ? 'Présent' : 'Absent'}
            </label>
            <input type="checkbox" class="checkbox" id="att-check-${emp.id}" ${p ? 'checked' : ''}
              onchange="window._updateAttCheckbox?.('${emp.id}','${selectedDate}',this.checked)">
          </div>
          <div id="detailed-att-${emp.id}" style="display:${isDetail ? 'block' : 'none'};">
            ${isDetail ? `
              <div style="font-size:14px;margin-bottom:8px;">
                Arrivée: <b>${formatDisplayTime(p.arrivee)}</b> | Départ: <b>${formatDisplayTime(p.depart)}</b>
                ${methodBadge}
              </div>
              ${!p.depart ? `<button class="btn btn-warning" style="padding:8px 12px;" onclick="window._recordTime?.('${emp.id}','depart','${selectedDate}')"><span class="material-icons" style="font-size:18px;">logout</span> Départ</button>` : ''}
              <button class="btn btn-danger" style="padding:8px 12px;" onclick="window._clearAttendance?.('${emp.id}','${selectedDate}')"><span class="material-icons" style="font-size:18px;">clear</span> Annuler</button>
            ` : `
              <button class="btn btn-success" style="padding:8px 12px;" onclick="window._recordTime?.('${emp.id}','arrivee','${selectedDate}')"><span class="material-icons" style="font-size:18px;">login</span> Arrivée</button>
            `}
          </div>
        </div>
      </div>`;
  }).join('');

  renderPaginationControls('attendancePagination', page, totalPages, filtered.length, perPage, p => {
    state.pagination.attendance.current = p;
    displayAttendance();
  });
}

function renderAttendanceSummary(active, dayAtt) {
  const container = document.getElementById('attendanceSummary');
  if (!container) return;

  let presents = 0, demi = 0, absents = 0;

  active.forEach(emp => {
    const p = dayAtt[emp.id];
    if (!p) {
      absents++;
    } else if (p === 'demi') {
      demi++;
    } else if (typeof p === 'object' && p.arrivee) {
      if (p.depart) {
        // Présence horodatée : calculer si demi-journée
        const [ah, am] = p.arrivee.split(':').map(Number);
        const [dh, dm] = p.depart.split(':').map(Number);
        const minutes  = (dh * 60 + dm) - (ah * 60 + am);
        if (minutes > 0 && minutes < 240) demi++; else presents++;
      } else {
        demi++; // arrivée sans départ = demi
      }
    } else {
      presents++; // true ou 'journee'
    }
  });

  container.innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin:16px 0;">
      <div style="flex:1;min-width:120px;display:flex;align-items:center;gap:10px;
                  padding:12px 16px;border-radius:12px;
                  background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);">
        <span class="material-icons" style="color:#22c55e;font-size:22px;">check_circle</span>
        <div>
          <div style="font-size:22px;font-weight:700;color:#22c55e;">${presents}</div>
          <div style="font-size:11px;color:var(--md-sys-color-on-surface-variant);">Présents</div>
        </div>
      </div>
      <div style="flex:1;min-width:120px;display:flex;align-items:center;gap:10px;
                  padding:12px 16px;border-radius:12px;
                  background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.3);">
        <span class="material-icons" style="color:#f59e0b;font-size:22px;">schedule</span>
        <div>
          <div style="font-size:22px;font-weight:700;color:#f59e0b;">${demi}</div>
          <div style="font-size:11px;color:var(--md-sys-color-on-surface-variant);">Demi-journée</div>
        </div>
      </div>
      <div style="flex:1;min-width:120px;display:flex;align-items:center;gap:10px;
                  padding:12px 16px;border-radius:12px;
                  background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);">
        <span class="material-icons" style="color:#ef4444;font-size:22px;">cancel</span>
        <div>
          <div style="font-size:22px;font-weight:700;color:#ef4444;">${absents}</div>
          <div style="font-size:11px;color:var(--md-sys-color-on-surface-variant);">Absents</div>
        </div>
      </div>
      <div style="flex:1;min-width:120px;display:flex;align-items:center;gap:10px;
                  padding:12px 16px;border-radius:12px;
                  background:rgba(103,80,164,.12);border:1px solid rgba(103,80,164,.3);">
        <span class="material-icons" style="color:var(--md-sys-color-primary);font-size:22px;">people</span>
        <div>
          <div style="font-size:22px;font-weight:700;color:var(--md-sys-color-primary);">${active.length}</div>
          <div style="font-size:11px;color:var(--md-sys-color-on-surface-variant);">Total</div>
        </div>
      </div>
    </div>`;
}

// ------ Actions ------

export function toggleAttendanceType(employeeId, type) {
  document.getElementById(`simple-att-${employeeId}`).style.display  = type === 'simple' ? 'flex' : 'none';
  document.getElementById(`detailed-att-${employeeId}`).style.display = type === 'detailed' ? 'block' : 'none';
}

export async function updateAttendanceCheckbox(employeeId, date, isChecked) {
  if (!state.attendance[date]) state.attendance[date] = {};
  if (isChecked) state.attendance[date][employeeId] = true;
  else delete state.attendance[date][employeeId];
  await saveAttendanceData();
  displayAttendance();
  window._updateStats?.();
  window._runSmartChecks?.();
}

export async function recordTime(employeeId, type, date, method = 'MANUAL') {
  const now  = new Date();
  const time = now.toTimeString().split(' ')[0];
  if (!state.attendance[date]) state.attendance[date] = {};
  if (typeof state.attendance[date][employeeId] !== 'object') delete state.attendance[date][employeeId];

  if (type === 'arrivee') {
    state.attendance[date][employeeId] = { arrivee: time, depart: null, method };
  } else if (type === 'depart' && state.attendance[date][employeeId]) {
    state.attendance[date][employeeId].depart = time;
  }
  await saveAttendanceData();
  displayAttendance();
  window._updateStats?.();
  window._runSmartChecks?.();
}

export async function clearAttendance(employeeId, date) {
  const confirmed = await openConfirm(
    'Confirmation',
    'Êtes-vous sûr de vouloir annuler la présence de cet employé?',
    'Annuler', 
    'Garder',
    { isDanger: true }
  );
  if (!confirmed) return;
  
  delete state.attendance[date]?.[employeeId];
  await saveAttendanceData();
  displayAttendance();
  window._updateStats?.();
  window._runSmartChecks?.();
  showToast("Présence annulée.", "success");
}

export function goToPreviousDay() {
  const el = document.getElementById('attendanceDate');
  const d  = new Date(el.value);
  d.setDate(d.getDate() - 1);
  el.value = d.toISOString().split('T')[0];
  displayAttendance();
}

export function goToNextDay() {
  const el = document.getElementById('attendanceDate');
  const d  = new Date(el.value);
  d.setDate(d.getDate() + 1);
  el.value = d.toISOString().split('T')[0];
  displayAttendance();
}

export async function saveAttendanceManual() {
  await saveData();
  window._updateStats?.();
  window._runSmartChecks?.();
  showToast('Présences enregistrées!', 'success');
}

export async function checkAllAttendance() {
  const selectedDate = document.getElementById('attendanceDate')?.value;
  if (!selectedDate) { showToast('Veuillez sélectionner une date.', 'error'); return; }

  const groupFilter = document.getElementById('attendanceGroupFilter')?.value || 'all';
  const searchTerm  = (document.getElementById('attendanceEmployeeSearch')?.value || '').toLowerCase();

  // Même filtre que displayAttendance
  let active = state.employees.filter(e => e.status !== 'inactif');
  if (groupFilter !== 'all') active = active.filter(e => e.groupId === groupFilter);
  const filtered = active.filter(e =>
    e.name.toLowerCase().includes(searchTerm) || e.position.toLowerCase().includes(searchTerm)
  );

  if (!filtered.length) return;

  if (!state.attendance[selectedDate]) state.attendance[selectedDate] = {};
  const dayAtt = state.attendance[selectedDate];

  // Détecter l'état global : tous présents → tout décocher, sinon → tout cocher
  const allPresent = filtered.every(e => !!dayAtt[e.id]);

  filtered.forEach(emp => {
    if (allPresent) {
      // Tout décocher : supprimer uniquement les présences simples (true)
      // Ne pas toucher aux présences détaillées (QR, facial, manuel horodaté)
      if (dayAtt[emp.id] === true) delete dayAtt[emp.id];
    } else {
      // Tout cocher : marquer présent uniquement ceux qui ne le sont pas encore
      if (!dayAtt[emp.id]) dayAtt[emp.id] = true;
    }
  });

  await saveAttendanceData();
  displayAttendance();
  window._updateStats?.();
  window._runSmartChecks?.();

  // Mettre à jour le libellé du bouton
  const label = document.getElementById('checkAllAttendanceBtnLabel');
  if (label) label.textContent = allPresent ? 'Tout cocher' : 'Tout décocher';

  showToast(allPresent ? 'Présences décochées.' : 'Tous marqués présents.', 'success');
}

export function changeItemsPerPage(section, value) {
  const n = parseInt(value, 10);
  if (!n || n < 1) return;

  if (state.pagination[section]) {
    state.pagination[section].perPage  = n;
    state.pagination[section].current  = 1; // retour page 1
  }

  // Rafraîchir la vue correspondante
  switch (section) {
    case 'attendance':    displayAttendance();             break;
    case 'employee':      window._displayEmployees?.();   break;
    case 'advances':      window._displayAdvances?.();    break;
    case 'enrolled':      window._displayEnrolled?.();    break;
    case 'faceAttendance':window._displayFaceAttendance?.(); break;
    case 'qrAttendance':  window._displayQRAttendance?.(); break;
    default: break;
  }
}

// Exposer globalement (appelé via onchange HTML)
window.changeItemsPerPage = changeItemsPerPage;
// Exposer pour onclick HTML
window._toggleAttType       = toggleAttendanceType;
window._updateAttCheckbox   = updateAttendanceCheckbox;
window._recordTime          = recordTime;
window._clearAttendance     = clearAttendance;
window._checkAllAttendance  = checkAllAttendance;
