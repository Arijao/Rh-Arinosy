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
import { handleEmployeeSearch, initEmployeeSearchDropdown } from './smart-search.js';
import { checkAndShowEmployeeAlerts, TRIGGER_POINTS, getAlertsSummary } from '../utils/alert-system.js';

// ------ Sélection multiple ------
// Persiste entre les re-rendus et les changements de page/filtre, ce qui permet
// de sélectionner des employés appartenant à des groupes différents.
const _selectedEmployees = new Set();

// Date locale AAAA-MM-JJ. Volontairement pas toISOString() : en UTC+3 celui-ci
// recule d'un jour entre 00h et 3h locales.
function _todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ------ Init ------

export function initEmployees() {
  registerSectionCallback('employees', displayEmployees);

  document.getElementById('employeeSearch')
    ?.addEventListener('input', () => {
      state.pagination.employee.current = 1;
      displayEmployees();       // filtre la liste paginée comme avant
      handleEmployeeSearch();   // affiche le dropdown avec highlight
    });
  document.getElementById('employeeGroupFilter')
    ?.addEventListener('change', () => {
      state.pagination.employee.current = 1;
      displayEmployees();
      // Rafraîchir le dropdown si une recherche est en cours
      const term = document.getElementById('employeeSearch')?.value || '';
      if (term.length >= 2) handleEmployeeSearch();
    });
  document.getElementById('employeeGenderFilter')
    ?.addEventListener('change', () => {
      state.pagination.employee.current = 1;
      displayEmployees();
    });

  // Délégation : le conteneur est réécrit à chaque rendu, pas les listeners.
  document.getElementById('employeeList')
    ?.addEventListener('change', (e) => {
      const cb = e.target.closest?.('.employee-select');
      if (!cb) return;
      if (cb.checked) _selectedEmployees.add(cb.dataset.empId);
      else            _selectedEmployees.delete(cb.dataset.empId);
      // Réutilise le jeu filtré du dernier rendu (mémorisé sur la barre) pour
      // que l'état de la case "Tout sélectionner" reste cohérent sans
      // recalculer le filtre ici.
      _renderSelectionBar(_currentFilteredIds());
    });

  initEmployeeSearchDropdown();

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
        emp => emp.status !== 'inactif' && emp.name.toLowerCase() === e.target.value.trim().toLowerCase()
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
  const genderFilter = document.getElementById('employeeGenderFilter')?.value || 'all';
  const searchTerm  = (document.getElementById('employeeSearch')?.value || '').toLowerCase();

  let filtered = state.employees.filter(e => e.status !== 'inactif');
  if (groupFilter === 'none') filtered = filtered.filter(e => !e.groupId);
  else if (groupFilter !== 'all') filtered = filtered.filter(e => e.groupId === groupFilter);
  
  if (genderFilter !== 'all') filtered = filtered.filter(e => e.gender === genderFilter);

  if (searchTerm) filtered = filtered.filter(e =>
    e.name.toLowerCase().includes(searchTerm) || e.position.toLowerCase().includes(searchTerm)
  );

  const { current, perPage } = state.pagination.employee;
  const totalPages  = Math.ceil(filtered.length / perPage);
  const adjustedPage = Math.max(1, Math.min(current, totalPages || 1));
  state.pagination.employee.current = adjustedPage;

  const slice = filtered.slice((adjustedPage - 1) * perPage, adjustedPage * perPage);

  // Purge des sélections devenues obsolètes (employé archivé depuis un autre poste)
  for (const id of _selectedEmployees) {
    if (!state.employees.some(e => e.id === id && e.status !== 'inactif'))
      _selectedEmployees.delete(id);
  }
  // "filtered" = tous les employés du filtre actif (groupe/genre/recherche),
  // AVANT découpage en page — c'est le périmètre que "Tout sélectionner" doit couvrir.
  _renderSelectionBar(filtered.map(e => e.id));

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

    // Gestion des remarques
    const empRemarks = state.remarks.filter(r => r.employeeId === emp.id && r.status === 'actif');
    const hasWarning = empRemarks.some(r => r.type === 'avertissement');
    const remarkIndicator = empRemarks.length > 0
      ? `<div class="remark-indicator ${hasWarning ? 'warning' : 'info'}" 
              onclick="window._openRemarksModal?.('${emp.id}')"
              title="${empRemarks.length} remarque(s) active(s)">
           <span class="material-icons">${hasWarning ? 'report_problem' : 'info'}</span>
           <span class="remark-count">${empRemarks.length}</span>
         </div>`
      : `<div class="remark-indicator empty" 
              onclick="window._openRemarksModal?.('${emp.id}')"
              title="Ajouter une remarque">
           <span class="material-icons">add_comment</span>
         </div>`;

    return `
      <div class="employee-item">
        <input type="checkbox" class="employee-select" data-emp-id="${emp.id}"
               ${_selectedEmployees.has(emp.id) ? 'checked' : ''}
               title="Sélectionner cet employé"
               style="width:20px;height:20px;flex:0 0 auto;margin-right:12px;cursor:pointer;accent-color:var(--md-sys-color-primary);">
        <div class="employee-info">
          <div style="display:flex; align-items:center; gap:8px;">
            <h4>${emp.name}</h4>
            ${remarkIndicator}
          </div>
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

  const selectedGroup = state.groups.find(g => g.id === groupId);
  const isStaff = selectedGroup?.name?.toLowerCase() === 'staff';
  if (!name || !position || !gender || (!isStaff && salary <= 0)) {
    showToast("Veuillez remplir tous les champs correctement.", 'error'); return;
  }
  // Exclut les employés archivés : un ancien employé supprimé ne doit plus
  // bloquer la création d'un nouvel employé homonyme. Les deux seront des
  // enregistrements indépendants (id distinct, aucune relation par nom).
  if (state.employees.some(e => e.status !== 'inactif' && e.name.toLowerCase() === name.toLowerCase())) {
    showToast("Un employé actif avec ce nom existe déjà.", 'error'); return;
  }

  // Active l'état de chargement
  setFormLoading(form, true, 'Ajout en cours...');

  try {
    const emp = {
      id: Date.now().toString(), name, position, gender, salary,
      groupId: groupId || null, dateAdded: new Date().toISOString(), status: 'actif', departureDate: null,
      useGroupSalary: true,
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

    const selectedGroup = state.groups.find(g => g.id === groupId);
    const isStaff = selectedGroup?.name?.toLowerCase() === 'staff';
    if (!isStaff && salary <= 0) {
      showToast("Veuillez renseigner le salaire.", 'error');
      setFormLoading(form, false);
      return;
    }

    const oldStatus = state.employees[idx].status;
    
    // VÉRIFICATION DES ALERTES LORS DU CHANGEMENT DE STATUT
    if (oldStatus !== status && (status === 'depart' || status === 'inactif')) {
      const alertResult = await checkAndShowEmployeeAlerts(id, TRIGGER_POINTS.EMPLOYEE_STATUS_CHANGE, {
        showNonBlocking: true
      });
      
      // Si l'utilisateur a annulé à cause d'alertes bloquantes, on arrête
      if (!alertResult.confirmed) {
        showToast('Modification annulée - Alerte bloquante', 'warning');
        setFormLoading(form, false);
        return;
      }
    }

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

// Lit le jeu filtré mémorisé lors du dernier rendu, pour les handlers qui
// n'ont pas "filtered" sous la main (ex: toggle d'une case individuelle).
function _currentFilteredIds() {
  return document.getElementById('employeeSelectionBar')?._filteredIds || [];
}

function _renderSelectionBar(filteredIds = []) {
  const list = document.getElementById('employeeList');
  if (!list) return;

  let bar = document.getElementById('employeeSelectionBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'employeeSelectionBar';
    // Toujours visible (contrairement à avant) : la case "Tout sélectionner"
    // doit être accessible même quand rien n'est encore sélectionné.
    bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 16px;margin-bottom:12px;border-radius:12px;background:var(--md-sys-color-surface-variant);border:1px solid var(--md-sys-color-outline-variant);';
    bar.innerHTML = `
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:500;margin:0;">
        <input type="checkbox" id="employeeSelectAll"
               style="width:20px;height:20px;cursor:pointer;accent-color:var(--md-sys-color-primary);">
        <span id="employeeSelectAllLabel"></span>
      </label>
      <div id="employeeSelectionActions" style="display:none;align-items:center;gap:8px;flex-wrap:wrap;">
        <span id="employeeSelectionCount" style="font-weight:600;"></span>
        <button type="button" id="employeeSelectionClear"
                style="padding:8px 14px;border:1px solid var(--md-sys-color-outline-variant);background:transparent;color:inherit;border-radius:8px;cursor:pointer;font-size:14px;">
          Tout désélectionner
        </button>
        <button type="button" id="employeeSelectionDelete"
                style="padding:8px 14px;border:none;background:var(--md-sys-color-error);color:#fff;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px;">
          <span class="material-icons" style="font-size:18px;">delete</span> Supprimer la sélection
        </button>
      </div>`;
    list.parentNode.insertBefore(bar, list);

    // Coche/décoche UNIQUEMENT les employés du filtre actif (bar._filteredIds,
    // mis à jour à chaque rendu ci-dessous) — jamais ceux masqués par le filtre.
    bar.querySelector('#employeeSelectAll')
       .addEventListener('change', (e) => {
         const ids = bar._filteredIds || [];
         if (e.target.checked) ids.forEach(id => _selectedEmployees.add(id));
         else                  ids.forEach(id => _selectedEmployees.delete(id));
         displayEmployees();
       });
    bar.querySelector('#employeeSelectionClear')
       .addEventListener('click', () => { _selectedEmployees.clear(); displayEmployees(); });
    bar.querySelector('#employeeSelectionDelete')
       .addEventListener('click', deleteSelectedEmployees);
  }

  // Mémorisé sur l'élément DOM : le handler "change" créé une seule fois
  // ci-dessus doit toujours connaître le filtre actif au moment du clic.
  bar._filteredIds = filteredIds;

  const n     = _selectedEmployees.size;
  const total = filteredIds.length;
  const allSelected  = total > 0 && filteredIds.every(id => _selectedEmployees.has(id));
  const someSelected = filteredIds.some(id => _selectedEmployees.has(id));

  const selectAllCb = bar.querySelector('#employeeSelectAll');
  selectAllCb.checked       = allSelected;
  selectAllCb.indeterminate = !allSelected && someSelected;
  selectAllCb.disabled      = total === 0;

  bar.querySelector('#employeeSelectAllLabel').textContent = total > 0
    ? `Tout sélectionner (${total} affiché${total > 1 ? 's' : ''})`
    : 'Aucun employé affiché';

  const actions = bar.querySelector('#employeeSelectionActions');
  actions.style.display = n ? 'flex' : 'none';
  bar.querySelector('#employeeSelectionCount').textContent =
    `${n} employé${n > 1 ? 's' : ''} sélectionné${n > 1 ? 's' : ''}`;
}

// Cœur de la suppression. On NE retire PAS l'objet de state.employees :
// saveData() émettrait alors DELETE /api/employees/:id, dont le CASCADE Prisma
// détruit Payroll, Advance, AttendanceRecord, QrAttendance et Remark.
// En modifiant l'objet sur place, saveData() émet un PUT — aucun CASCADE.
async function _archiveEmployees(ids) {
  const today = _todayLocal();

  for (const id of ids) {
    const idx = state.employees.findIndex(e => e.id === id);
    if (idx === -1) continue;
    state.employees[idx] = {
      ...state.employees[idx],
      status: 'inactif',
      departureDate: state.employees[idx].departureDate || today,
      face_descriptors: null,
      face_enrolled: false,
      face_enrollment_date: null,
    };
  }

  await saveData();

  // Désassociation du QR code (route dédiée : saveData ne gère pas qr_codes).
  await Promise.all(ids.map(id =>
    fetch(`/api/qr/codes/${id}`, { method: 'DELETE' })
      .catch(err => console.warn('[archive] QR non supprimé', id, err.message))
  ));
}

export async function deleteSelectedEmployees() {
  const ids = [..._selectedEmployees];
  if (!ids.length) return;

  const names = ids
    .map(id => state.employees.find(e => e.id === id)?.name)
    .filter(Boolean);

  const confirmed = await openConfirm(
    'Supprimer les employés sélectionnés ?',
    `Cette action supprimera ${ids.length} employé(s) ainsi que leurs données d'identification associées (QR Code, reconnaissance faciale).\n\n`
    + `Les paiements et historiques déjà enregistrés seront conservés.\n\n`
    + names.join(', '),
    'Supprimer',
    'Annuler',
    { isDanger: true }
  );
  if (!confirmed) return;

  const btn = document.getElementById('employeeSelectionDelete');
  if (btn) setButtonLoading(btn, true, { originalText: btn.textContent, loadingText: 'Suppression...' });

  try {
    await _archiveEmployees(ids);
    _selectedEmployees.clear();
    displayEmployees();
    populateEmployeeSelects();
    window.refreshUI?.();
    showToast(`${ids.length} employé(s) supprimé(s). Paiements conservés.`, 'success');
  } catch (error) {
    console.error('[deleteSelectedEmployees] Erreur:', error);
    showToast('Erreur lors de la suppression.', 'error');
  } finally {
    if (btn) setButtonLoading(btn, false, { originalText: 'Supprimer la sélection' });
  }
}

export async function deleteEmployee(id) {
  const confirmed = await openConfirm(
    'Supprimer cet employé ?',
    "Cette action supprimera l'employé ainsi que ses données d'identification associées (QR Code, reconnaissance faciale).\n\n"
    + 'Les paiements et historiques déjà enregistrés seront conservés.',
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
    await _archiveEmployees([id]);
    _selectedEmployees.delete(id);
    displayEmployees();
    populateEmployeeSelects();
    // refreshUI() (main.js) recalcule updateStats() ET displayGroups() — c'est
    // ce second appel qui manquait : sans lui, le compteur du groupe restait
    // figé jusqu'au prochain changement d'onglet ou écho WebSocket.
    window.refreshUI?.();
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
window._deleteSelectedEmployees = deleteSelectedEmployees;
