// ============================================================
// ui/advances.js — Avances (ES Module)
// ============================================================

import { state, saveData } from '../state.js';
import { openModal, closeModal, renderPaginationControls } from '../utils/ui.js';
import { showToast, openConfirm } from '../utils/notifications.js';
import { formatCurrency, formatDate, getDaysInMonth, getCurrencyValue, setCurrencyValue } from '../utils/format.js';
import { countPresenceDays } from '../utils/attendance-calc.js';
import { registerSectionCallback } from './navigation.js';
import { handleAdvanceEmployeeSearch, initSmartSearchDropdowns } from './smart-search.js';

export function initAdvances() {
  registerSectionCallback('advances', displayAdvances);

  document.getElementById('advanceForm')
    ?.addEventListener('submit', handleAddAdvance);
  document.getElementById('editAdvanceForm')
    ?.addEventListener('submit', handleUpdateAdvance);
  document.getElementById('advanceSearchInput')
    ?.addEventListener('input', () => { state.pagination.advances.current = 1; displayAdvances(); });
  document.getElementById('advanceMonthFilter')
    ?.addEventListener('change', () => { state.pagination.advances.current = 1; displayAdvances(); });
  document.getElementById('advanceGroupFilter')
    ?.addEventListener('change', () => { state.pagination.advances.current = 1; displayAdvances(); });
  document.getElementById('advanceEmployee')
    ?.addEventListener('change', previewNetSalary);
  document.getElementById('advanceAmount')
    ?.addEventListener('input', previewNetSalary);

  // Recherche intelligente sur le champ Employé du formulaire d'ajout
  document.getElementById('advanceEmployeeInput')
    ?.addEventListener('input', handleAdvanceEmployeeSearch);

  // Mois courant par défaut
  const mf = document.getElementById('advanceMonthFilter');
  if (mf) mf.value = new Date().toISOString().slice(0, 7);
  const ad = document.getElementById('advanceDate');
  if (ad) ad.value = new Date().toISOString().split('T')[0];

  initSmartSearchDropdowns();
}

// ------ Display ------

export function displayAdvances() {
  const container  = document.getElementById('advancesList');
  const search     = (document.getElementById('advanceSearchInput')?.value || '').toLowerCase();
  const monthFilt  = document.getElementById('advanceMonthFilter')?.value || '';
  const groupFilt  = document.getElementById('advanceGroupFilter')?.value || 'all';

  let filtered = state.advances.filter(adv => {
    const emp = state.employees.find(e => e.id === adv.employeeId);
    if (!emp) return false;
    const matchSearch = emp.name.toLowerCase().includes(search) ||
                        emp.position.toLowerCase().includes(search) ||
                        (adv.reason || '').toLowerCase().includes(search);
    const matchMonth  = !monthFilt || adv.date.startsWith(monthFilt);
    const matchGroup  = groupFilt === 'all' || emp.groupId === groupFilt;
    return matchSearch && matchMonth && matchGroup;
  });

  filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

  const { current, perPage } = state.pagination.advances;
  const totalPages = Math.ceil(filtered.length / perPage);
  const page       = Math.max(1, Math.min(current, totalPages || 1));
  state.pagination.advances.current = page;

  // Résumé
  const total = filtered.reduce((s, a) => s + a.amount, 0);
  const totalEl = document.getElementById('totalAdvancesMonth');
  if (totalEl) totalEl.textContent = formatCurrency(total);
  const periodEl = document.getElementById('advancesSummaryPeriod');
  if (periodEl) periodEl.textContent = monthFilt ? `Période: ${monthFilt}` : 'Toutes les périodes';

  const slice = filtered.slice((page - 1) * perPage, page * perPage);
  if (!slice.length) {
    container.innerHTML = '<p style="text-align:center;padding:20px;">Aucune avance trouvée.</p>';
    document.getElementById('advancesPagination').innerHTML = '';
    return;
  }

  container.innerHTML = slice.map(adv => {
    const emp     = state.employees.find(e => e.id === adv.employeeId);
    const name    = emp ? emp.name : 'Mpiasa voafafa';
    const pos     = emp ? emp.position : 'N/A';
    const status  = adv.status || 'En attente';
    const isPaid  = status === 'Confirmé';
    const color   = isPaid ? 'var(--md-sys-color-success)' : 'var(--md-sys-color-warning)';
    const icon    = isPaid ? 'check_circle' : 'hourglass_top';

    const actions = isPaid ? '' : `
      <button class="btn btn-success" style="padding:8px 12px;" onclick="window._confirmAdvance?.('${adv.id}')">
        <span class="material-icons" style="font-size:18px;">check</span> Confirmer
      </button>
      <button class="btn-icon" onclick="window._openEditAdvanceModal?.('${adv.id}')" title="Modifier">
        <span class="material-icons">edit</span>
      </button>`;

    return `
      <div class="advance-item" style="border-left:5px solid ${color};">
        <div class="advance-info">
          <h4>${name}</h4>
          <p><strong>Poste:</strong> ${pos}</p>
          <p><strong>Date:</strong> ${formatDate(adv.date, false)} | <strong>Motif:</strong> ${adv.reason || 'Non spécifié'}</p>
          <div style="display:flex;align-items:center;gap:8px;margin-top:8px;font-weight:500;color:${color};">
            <span class="material-icons">${icon}</span><span>${status}</span>
          </div>
        </div>
        <div class="amount-actions">
          <div class="amount">${formatCurrency(adv.amount)}</div>
          <div style="display:flex;gap:8px;align-items:center;">
            ${actions}
            <button class="btn-icon" onclick="window._deleteAdvance?.('${adv.id}')" title="Supprimer">
              <span class="material-icons">delete_outline</span>
            </button>
          </div>
        </div>
      </div>`;
  }).join('');

  renderPaginationControls('advancesPagination', page, totalPages, filtered.length, perPage, p => {
    state.pagination.advances.current = p;
    displayAdvances();
  });
}

// ------ Add ------

async function handleAddAdvance(e) {
  e.preventDefault();
  const empId  = document.getElementById('advanceEmployee').value;
  const amount = getCurrencyValue('advanceAmount');
  const date   = document.getElementById('advanceDate').value;
  const reason = document.getElementById('advanceReason').value.trim();
  const emp    = state.employees.find(e => e.id === empId);
  if (!emp) return;
  if (amount === 0) { showToast('Montant invalide!', 'error'); return; }

  const adv = {
    id: Date.now().toString(), employeeId: empId, employeeName: emp.name,
    amount, date, reason, dateCreated: new Date().toISOString(),
  };
  state.advances.push(adv);
  await saveData();
  displayAdvances();
  window._updateStats?.();
  e.target.reset();
  showToast('Avance ajoutée!', 'success');
}

// ------ Edit ------

export function openEditAdvanceModal(id) {
  const adv = state.advances.find(a => a.id === id);
  if (!adv) { showToast("Avance non trouvée.", 'error'); return; }
  document.getElementById('editAdvanceId').value               = adv.id;
  document.getElementById('editAdvanceEmployeeName').textContent = adv.employeeName;
  setCurrencyValue('editAdvanceAmount', adv.amount);
  document.getElementById('editAdvanceDate').value   = adv.date;
  document.getElementById('editAdvanceReason').value = adv.reason || '';
  openModal('editAdvanceModal');
}

async function handleUpdateAdvance(e) {
  e.preventDefault();
  const id     = document.getElementById('editAdvanceId').value;
  const amount = getCurrencyValue('editAdvanceAmount');
  const date   = document.getElementById('editAdvanceDate').value;
  const reason = document.getElementById('editAdvanceReason').value.trim();
  const idx    = state.advances.findIndex(a => a.id === id);
  if (idx === -1) { showToast("Avance non trouvée.", 'error'); return; }
  Object.assign(state.advances[idx], { amount, date, reason });
  await saveData();
  closeModal('editAdvanceModal');
  displayAdvances();
  window._updateStats?.();
  showToast("Avance mise à jour!", 'success');
}

// ------ Confirm / Delete ------

export async function confirmAdvance(id) {
  const idx = state.advances.findIndex(a => a.id === id);
  if (idx === -1) return;
  state.advances[idx].status = 'Confirmé';
  await saveData();
  displayAdvances();
  showToast("Avance confirmée!", 'success');
}

export async function deleteAdvance(id) {
  const confirmed = await openConfirm(
    'Confirmation',
    'Êtes-vous sûr de vouloir supprimer cette avance?',
    'Supprimer',
    'Annuler',
    { isDanger: true }
  );
  if (!confirmed) return;
  
  state.advances = state.advances.filter(a => a.id !== id);
  await saveData();
  displayAdvances();
  window._updateStats?.();
  showToast('Avance supprimée!', 'success');
}

// ------ Preview ------

async function previewNetSalary() {
  const empId  = document.getElementById('advanceEmployee')?.value;
  const amount = getCurrencyValue('advanceAmount');
  const box    = document.getElementById('netSalaryPreview');
  if (!box) return;
  if (!empId) { box.style.display = 'none'; return; }
  const emp    = state.employees.find(e => e.id === empId);
  if (!emp) return;

  const month = new Date().toISOString().slice(0, 7);
  const [y, m]   = month.split('-');
  const days     = getDaysInMonth(parseInt(y), parseInt(m));
  const present  = countPresenceDays(empId, month);
  const gross    = (emp.salary / days) * present;
  const existing = state.advances
    .filter(a => a.employeeId === empId && a.date.startsWith(month))
    .reduce((s, a) => s + a.amount, 0);
  const net = gross - (existing + amount);

  box.style.display = 'block';
  box.innerHTML = `
    <span style="font-weight:500;">Karama Net Tombanana:</span><br>
    Brut: ${formatCurrency(gross)} | Avances totales: ${formatCurrency(existing + amount)}<br>
    <hr style="margin:4px 0;">
    <strong>Sisa: ${formatCurrency(Math.max(0, net))}</strong>`;
}

// Exposer
window._confirmAdvance          = confirmAdvance;
window._deleteAdvance           = deleteAdvance;
window._openEditAdvanceModal    = openEditAdvanceModal;
window._displayAdvances         = displayAdvances;
