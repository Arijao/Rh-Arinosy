// ============================================================
// ui/employees.js — Gestion Employés (ES Module)
// ============================================================

import { state, saveData } from '../state.js';
import { openModal, closeModal, renderPaginationControls } from '../utils/ui.js';
import { showToast, openConfirm } from '../utils/notifications.js';
import { setFormLoading, setButtonLoading } from '../utils/dialog-manager.js';
import { formatCurrency, capitalizeWords, getCurrencyValue, setCurrencyValue } from '../utils/format.js';
import { populateGroupSelects, populateEmployeeSelects } from './groups.js';
import { registerSectionCallback } from './navigation.js';

// ------ Init ------

export function initEmployees() {
  registerSectionCallback('employees', displayEmployees);

  document.getElementById('employeeSearch')
    ?.addEventListener('input', () => { state.pagination.employee.current = 1; displayEmployees(); });
  document.getElementById('employeeGroupFilter')
    ?.addEventListener('change', () => { state.pagination.employee.current = 1; displayEmployees(); });

  document.getElementById('employeeForm')
    ?.addEventListener('submit', handleAddEmployee);
  document.getElementById('editEmployeeForm')
    ?.addEventListener('submit', handleEditEmployee);
  document.getElementById('editEmployeeStatus')
    ?.addEventListener('change', function () {
      const container = document.getElementById('editDepartureDateContainer');
      if (container)
        container.style.display = (this.value === 'depart' || this.value === 'inactif') ? 'block' : 'none';
    });

  // Validation nom en temps réel
  const nameInput = document.getElementById('employeeName_add');
  if (nameInput) {
    nameInput.addEventListener('input', function (e) {
      e.target.value = capitalizeWords(e.target.value);
      const exists = state.employees.some(
        emp => emp.name.toLowerCase() === e.target.value.trim().toLowerCase()
      );
      const submitBtn = document.querySelector('#employeeForm button[type="submit"]');
      if (exists && e.target.value.trim()) {
        e.target.style.borderColor = '#dc2626';
        submitBtn && (submitBtn.disabled = true, submitBtn.style.opacity = '0.5');
      } else {
        e.target.style.borderColor = e.target.value.trim() ? '#10b981' : '';
        submitBtn && (submitBtn.disabled = false, submitBtn.style.opacity = '1');
      }
    });
  }
}

// ------ Display ------

export function displayEmployees() {
  const container   = document.getElementById('employeeList');
  const groupFilter = document.getElementById('employeeGroupFilter')?.value || 'all';
  const searchTerm  = (document.getElementById('employeeSearch')?.value || '').toLowerCase();

  let filtered = state.employees.filter(e => e.status !== 'inactif');
  if (groupFilter === 'none') filtered = filtered.filter(e => !e.groupId);
  else if (groupFilter !== 'all') filtered = filtered.filter(e => e.groupId === groupFilter);
  if (searchTerm) filtered = filtered.filter(e =>
    e.name.toLowerCase().includes(searchTerm) || e.position.toLowerCase().includes(searchTerm)
  );

  const { current, perPage } = state.pagination.employee;
  const totalPages  = Math.ceil(filtered.length / perPage);
  const adjustedPage = Math.max(1, Math.min(current, totalPages || 1));
  state.pagination.employee.current = adjustedPage;

  const slice = filtered.slice((adjustedPage - 1) * perPage, adjustedPage * perPage);

  if (!slice.length) {
    container.innerHTML = "<p style='text-align:center;padding:20px;'>Aucun employé trouvé.</p>";
    document.getElementById('employeePagination').innerHTML = '';
    return;
  }

  const currentMonth = new Date().toISOString().slice(0, 7);

  container.innerHTML = slice.map(emp => {
    const group = state.groups.find(g => g.id === emp.groupId);
    const groupName = group ? group.name : '<i>Sans groupe</i>';
    const totalAdv = state.advances
      .filter(a => a.employeeId === emp.id && a.date.startsWith(currentMonth))
      .reduce((s, a) => s + a.amount, 0);
    const advHtml = totalAdv > 0
      ? `<p style="color:var(--md-sys-color-error);font-size:12px;margin-top:4px;">
           <span class="material-icons" style="font-size:14px;vertical-align:middle;">trending_down</span>
           Avances ce mois: ${formatCurrency(totalAdv)}</p>`
      : `<p style="color:var(--md-sys-color-success);font-size:12px;margin-top:4px;">
           <span class="material-icons" style="font-size:14px;vertical-align:middle;">check</span>
           Aucune avance ce mois</p>`;

    const customBadge = emp.useGroupSalary === false
      ? `<span class="attendance-badge" style="background:var(--md-sys-color-tertiary);margin-left:8px;" title="Salaire personnalisé">
           <span class="material-icons" style="font-size:14px;">lock</span></span>`
      : '';

    return `
      <div class="employee-item">
        <div class="employee-info">
          <h4>${emp.name}</h4>
          <p><strong>Poste:</strong> ${emp.position} | <strong>Groupe:</strong> ${groupName}</p>
          <p><strong>Salaire:</strong> ${formatCurrency(emp.salary)}${customBadge}</p>
          ${advHtml}
        </div>
        <div class="employee-actions">
          <button class="btn-icon" onclick="window._openEnrollmentModal?.('${emp.id}')" title="Enrollment facial"
                  style="background:${emp.face_enrolled ? '#28a745' : '#6750A4'};color:white;border:none;border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center;cursor:pointer;">
            <span class="material-icons">${emp.face_enrolled ? 'face' : 'face_retouching_natural'}</span>
          </button>
          <button class="btn-icon" onclick="window._editEmployee?.('${emp.id}')" title="Modifier">
            <span class="material-icons">edit</span>
          </button>
          <button class="btn-icon" onclick="window._deleteEmployee?.('${emp.id}')" title="Supprimer">
            <span class="material-icons">delete</span>
          </button>
        </div>
      </div>`;
  }).join('');

  renderPaginationControls('employeePagination', adjustedPage, totalPages, filtered.length, perPage, p => {
    state.pagination.employee.current = p;
    displayEmployees();
  });
}

// ------ Add ------

async function handleAddEmployee(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  
  const name     = capitalizeWords(document.getElementById('employeeName_add').value.trim());
  const position = capitalizeWords(document.getElementById('employeePosition_add').value.trim());
  const gender   = document.getElementById('employeeGender_add').value;
  const salary   = getCurrencyValue('employeeSalary_add');
  const groupId  = document.getElementById('employeeGroup_add').value;

  if (!name || !position || !gender || salary <= 0) {
    showToast("Veuillez remplir tous les champs correctement.", 'error'); return;
  }
  if (state.employees.some(e => e.name.toLowerCase() === name.toLowerCase())) {
    showToast("Un employé avec ce nom existe déjà.", 'error'); return;
  }

  // Active l'état de chargement
  setFormLoading(form, true, 'Ajout en cours...');

  try {
    const emp = {
      id: Date.now().toString(), name, position, gender, salary,
      groupId: groupId || null, dateAdded: new Date().toISOString(), status: 'actif', departureDate: null,
    };
    state.employees.push(emp);
    await saveData();

    displayEmployees();
    populateEmployeeSelects();
    form.reset();
    closeModal('addEmployeeModal');
    showToast('Employé ajouté avec succès!', 'success');
    window._updateStats?.();
  } catch (error) {
    console.error('[handleAddEmployee] Erreur:', error);
    showToast('Erreur lors de l\'ajout de l\'employé.', 'error');
  } finally {
    // Désactive l'état de chargement
    setFormLoading(form, false);
  }
}

// ------ Edit ------

export function editEmployee(id) {
  const emp = state.employees.find(e => e.id === id);
  if (!emp) return;
  document.getElementById('editEmployeeId').value       = emp.id;
  document.getElementById('editEmployeeName').value     = emp.name;
  document.getElementById('editEmployeePosition').value = emp.position;
  document.getElementById('editEmployeeGender').value   = emp.gender;
  setCurrencyValue('editEmployeeSalary', emp.salary);
  document.getElementById('editEmployeeGroup').value    = emp.groupId || '';
  document.getElementById('editEmployeeStatus').value   = emp.status || 'actif';
  document.getElementById('editEmployeeDepartureDate').value = emp.departureDate || '';
  const container = document.getElementById('editDepartureDateContainer');
  if (container)
    container.style.display = (emp.status === 'depart' || emp.status === 'inactif') ? 'block' : 'none';
  openModal('editEmployeeModal');
}

async function handleEditEmployee(e) {
  e.preventDefault();
  const form = e.target;
  setFormLoading(form, true, 'Mise à jour...');

  try {
    const id       = document.getElementById('editEmployeeId').value;
    const name     = capitalizeWords(document.getElementById('editEmployeeName').value.trim());
    const position = capitalizeWords(document.getElementById('editEmployeePosition').value.trim());
    const gender   = document.getElementById('editEmployeeGender').value;
    const salary   = getCurrencyValue('editEmployeeSalary');
    const groupId  = document.getElementById('editEmployeeGroup').value;
    const status   = document.getElementById('editEmployeeStatus').value;
    const depDate  = document.getElementById('editEmployeeDepartureDate').value || null;

    const idx = state.employees.findIndex(e => e.id === id);
    if (idx === -1) { showToast("Employé non trouvé.", 'error'); return; }

    Object.assign(state.employees[idx], { name, position, gender, salary, groupId: groupId || null, status, departureDate: depDate });
    await saveData();
    closeModal('editEmployeeModal');
    displayEmployees();
    populateEmployeeSelects();
    window._updateStats?.();
    showToast("Informations mises à jour!", 'success');
  } catch (error) {
    console.error('[handleEditEmployee] Erreur:', error);
    showToast('Erreur lors de la mise à jour.', 'error');
  } finally {
    setFormLoading(form, false);
  }
}

// ------ Delete ------

export async function deleteEmployee(id) {
  const confirmed = await openConfirm(
    'Confirmation de suppression',
    'Êtes-vous sûr de vouloir supprimer cet employé? Toutes ses données seront effacées.',
    'Supprimer',
    'Annuler',
    { isDanger: true }
  );
  if (!confirmed) return;
  
  // Trouver et désactiver le bouton de suppression
  const deleteBtn = document.querySelector(`[onclick*="_deleteEmployee('${id}')"]`);
  if (deleteBtn) {
    setButtonLoading(deleteBtn, true, {
      originalText: deleteBtn.textContent,
      loadingText: 'Suppression...',
    });
  }

  try {
    state.employees = state.employees.filter(e => e.id !== id);
    Object.keys(state.attendance).forEach(date => { delete state.attendance[date][id]; });
    state.qrAttendance = state.qrAttendance.filter(a => a.employeeId !== id);
    await saveData();
    displayEmployees();
    populateEmployeeSelects();
    window._updateStats?.();
    showToast('Employé supprimé!', 'success');
  } catch (error) {
    console.error('[deleteEmployee] Erreur:', error);
    showToast('Erreur lors de la suppression.', 'error');
  } finally {
    if (deleteBtn) setButtonLoading(deleteBtn, false, { originalText: 'Supprimer' });
  }
}

// ------ Modal add ------

export function openAddEmployeeModal() {
  document.getElementById('employeeForm')?.reset();
  populateGroupSelects();
  openModal('addEmployeeModal');
}

// Exposer pour les onclick HTML inline
window._editEmployee   = editEmployee;
window._deleteEmployee = deleteEmployee;
