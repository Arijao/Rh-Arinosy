// ============================================================
// ui/groups.js — Groupes & Selects (ES Module)
// ============================================================

import { state, saveData } from '../state.js';
import { showToast, openConfirm } from '../utils/notifications.js';
import { setButtonLoading } from '../utils/dialog-manager.js';
import { formatCurrency, getCurrencyValue } from '../utils/format.js';
import { registerSectionCallback } from './navigation.js';

export function initGroups() {
  registerSectionCallback('groups', displayGroups);
  document.getElementById('groupForm')?.addEventListener('submit', handleGroupSubmit);
  document.getElementById('advanceGroupFilter')?.addEventListener('change', () => {
    window._displayAdvances?.();
  });
}

// ------ Selects ------

export function populateGroupSelects() {
  const opts = state.groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');

  const configs = {
    'employeeGroup_add':   '<option value="">Aucun groupe</option>',
    'editEmployeeGroup':   '<option value="">Aucun groupe</option>',
    'employeeGroupFilter': '<option value="all">Tous les Groupes</option><option value="none">Sans Groupe</option>',
    'payrollGroupFilter':  '<option value="all">Tous les Groupes</option>',
    'advanceGroupFilter':  '<option value="all">Tous les Groupes</option>',
    'estimationGroupFilter':'<option value="all">Tous les Groupes</option>',
    'attendanceGroupFilter':'<option value="all">Tous les Groupes</option>',
    'masseSalaireGroupSelect':'<option value="">-- Choisir un groupe --</option>',
  };

  for (const [id, firstOpt] of Object.entries(configs)) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = firstOpt + opts;
  }
}

export function populateEmployeeSelects(groupIdFilter = null) {
  let list = state.employees.filter(e => e.status === 'actif' || e.status === 'depart' || !e.status);
  if (groupIdFilter) list = list.filter(e => e.groupId === groupIdFilter);
  const opts = list.map(e => `<option value="${e.id}">${e.name}</option>`).join('');

  const configs = {
    'advanceEmployee':      '<option value="">Sélectionner un employé</option>',
    'payrollEmployeeSelect':'<option value="">Tous les employés</option>',
    'paymentEmployeeFilter':'<option value="">Tous les employés</option>',
  };
  for (const [id, def] of Object.entries(configs)) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = def + opts;
  }
}

// ------ Display ------

export function displayGroups() {
  populateGroupSelects();
  populateMasseSalaireSelect();
  const container = document.getElementById('groupList');
  if (!container) return;

  if (!state.groups.length) {
    container.innerHTML = "<p style='text-align:center;padding:20px;'>Aucun groupe créé.</p>"; return;
  }

  container.innerHTML = state.groups.map(g => {
    const members = state.employees.filter(e => e.groupId === g.id);
    const males   = members.filter(m => m.gender === 'Homme').length;
    const females = members.filter(m => m.gender === 'Femme').length;
    return `
      <div class="employee-item">
        <div class="employee-info">
          <h4>${g.name}</h4>
          <p>${g.description || 'Aucune description'}</p>
          <div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:8px;font-size:14px;">
            <span><span class="material-icons" style="font-size:16px;vertical-align:middle;">people</span> Total: <strong>${members.length}</strong></span>
            <span><span class="material-icons" style="font-size:16px;vertical-align:middle;">male</span> Hommes: <strong>${males}</strong></span>
            <span><span class="material-icons" style="font-size:16px;vertical-align:middle;">female</span> Femmes: <strong>${females}</strong></span>
            ${g.salary ? `<span><span class="material-icons" style="font-size:16px;vertical-align:middle;">payments</span> Salaire: <strong>${formatCurrency(g.salary)}</strong></span>` : ''}
          </div>
        </div>
        <div class="employee-actions">
          <button class="btn-icon" onclick="window._editGroup?.('${g.id}')" title="Modifier"><span class="material-icons">edit</span></button>
          <button class="btn-icon" onclick="window._deleteGroup?.('${g.id}')" title="Supprimer"><span class="material-icons">delete</span></button>
        </div>
      </div>`;
  }).join('');
}

// ------ CRUD ------

async function handleGroupSubmit(e) {
  e.preventDefault();
  const id   = document.getElementById('groupId').value;
  const name = document.getElementById('groupName').value.trim();
  const desc = document.getElementById('groupDescription').value.trim();
  if (!name) return;

  if (id) {
    const idx = state.groups.findIndex(g => g.id === id);
    if (idx > -1) Object.assign(state.groups[idx], { name, description: desc });
    showToast('Groupe mis à jour!', 'success');
  } else {
    if (state.groups.some(g => g.name.toLowerCase() === name.toLowerCase())) {
      showToast('Un groupe avec ce nom existe déjà.', 'error'); return;
    }
    state.groups.push({ id: Date.now().toString(), name, description: desc });
    showToast('Groupe ajouté!', 'success');
  }
  await saveData();
  displayGroups();
  cancelGroupEdit();
}

export function editGroup(id) {
  const g = state.groups.find(g => g.id === id);
  if (!g) return;
  document.getElementById('groupId').value          = g.id;
  document.getElementById('groupName').value        = g.name;
  document.getElementById('groupDescription').value = g.description || '';
  document.getElementById('groupFormBtnText').textContent   = 'Mettre à jour le Groupe';
  document.getElementById('cancelEditGroupBtn').style.display = 'inline-flex';
  window.scrollTo(0, document.getElementById('groupForm').offsetTop);
}

export function cancelGroupEdit() {
  document.getElementById('groupId').value = '';
  document.getElementById('groupForm')?.reset();
  document.getElementById('groupFormBtnText').textContent   = 'Ajouter le Groupe';
  document.getElementById('cancelEditGroupBtn').style.display = 'none';
  populateGroupSelects();
}

export async function deleteGroup(id) {
  const count = state.employees.filter(e => e.groupId === id).length;
  if (count > 0) { showToast(`Impossible: ${count} employé(s) dans ce groupe.`, 'error'); return; }
  
  const confirmed = await openConfirm(
    'Confirmation de suppression',
    'Êtes-vous sûr de vouloir supprimer ce groupe?',
    'Supprimer',
    'Annuler',
    { isDanger: true }
  );
  if (!confirmed) return;
  
  const deleteBtn = document.querySelector(`[onclick*="_deleteGroup('${id}'"]`);
  if (deleteBtn) setButtonLoading(deleteBtn, true, { loadingText: 'Suppression...' });

  try {
    state.groups = state.groups.filter(g => g.id !== id);
    await saveData();
    displayGroups();
    showToast('Groupe supprimé!', 'success');
  } catch (error) {
    console.error('[deleteGroup] Erreur:', error);
    showToast('Erreur lors de la suppression.', 'error');
  } finally {
    if (deleteBtn) setButtonLoading(deleteBtn, false, { originalText: 'Supprimer' });
  }
}

// ------ Masse Salaire ------

function populateMasseSalaireSelect() {
  const sel = document.getElementById('masseSalaireGroupSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Choisir un groupe --</option>' +
    state.groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
}

export function showMasseSalairePreview(groupId) {
  const preview = document.getElementById('masseSalairePreview');
  const list    = document.getElementById('masseSalaireEmployeeList');
  if (!preview) return;
  if (!groupId) { preview.style.display = 'none'; return; }

  const members = state.employees.filter(e => e.groupId === groupId);
  list.innerHTML = members.length
    ? members.map(e => `
        <div style="padding:10px;border-bottom:1px solid var(--md-sys-color-outline-variant);display:flex;justify-content:space-between;">
          <div><strong>${e.name}</strong><small style="display:block;opacity:.7;">${e.position}</small></div>
          <div>${e.useGroupSalary === false
            ? `<span style="color:var(--md-sys-color-tertiary);font-weight:600;">🔒 ${formatCurrency(e.salary)}</span>`
            : `<span>Actuel: ${formatCurrency(e.salary)}</span>`}
          </div>
        </div>`).join('')
    : '<p class="alert alert-warning">❌ Aucun employé dans ce groupe</p>';
  preview.style.display = 'block';
}

export async function applyMasseSalaire() {
    const groupId = document.getElementById('masseSalaireGroupSelect')?.value;
    const amount  = getCurrencyValue('masseSalaireAmount');
    
    if (!groupId) { showToast("Veuillez sélectionner un groupe", 'warning'); return; }
    if (amount <= 0) { showToast("Montant invalide", 'error'); return; }
    
    const affected = state.employees.filter(e => e.groupId === groupId && e.useGroupSalary !== false);
    if (!affected.length) { showToast("Aucun employé dans ce groupe", 'warning'); return; }
    
    // ✅ CORRECTION CRITIQUE: Demander confirmation AVANT tout loading state
    const confirmed = await openConfirm(
        'Appliquer la masse salariale',
        `Confirmer l'application de <strong>${formatCurrency(amount)}</strong> à <strong>${affected.length}</strong> employé(s) de ce groupe?`,
        'Appliquer',
        'Annuler'
    );
    
    // ✅ IMPORTANT: Si annulé, quitter SANS toucher au bouton
    if (!confirmed) {
        return;  // ← Sortie propre, aucun loading activé
    }
    
    // ✅ Récupérer le bouton APRÈS que le dialog soit fermé
    const applyBtn = document.querySelector('#masseSalaireSection button[onclick*="applyMasseSalaire"]')
        ?? document.querySelector('button[onclick*="applyMasseSalaire"]');
    
    // ✅ Activer le loading SEULEMENT maintenant (après confirmation)
    if (applyBtn) {
        setButtonLoading(applyBtn, true, { loadingText: 'Application...', spinner: true });
    }
    
    try {
        // Appliquer les changements
        const g = state.groups.find(g => g.id === groupId);
        if (g) g.salary = amount;
        affected.forEach(e => { e.salary = amount; e.useGroupSalary = true; });
        
        // Sauvegarder et rafraîchir l'UI
        await saveData();
        displayGroups();
        window._displayEmployees?.();
        
        // Nettoyer le formulaire
        document.getElementById('masseSalaireAmount').value = '';
        document.getElementById('masseSalaireGroupSelect').value = '';
        document.getElementById('masseSalairePreview').style.display = 'none';
        
        // Afficher un message de succès
        setTimeout(() => showToast(`✅ Salaire appliqué à ${affected.length} employé(s)!`, 'success', 4500), 300);
    } catch (error) {
        console.error('[applyMasseSalaire] Erreur détaillée:', error);
        setTimeout(() => showToast(`❌ Erreur: ${error.message || 'Impossible d\'appliquer le salaire.'}`, 'error', 5000), 300);
    } finally {
        // ✅ TOUJOURS réinitialiser le bouton
        if (applyBtn) {
            setButtonLoading(applyBtn, false, { originalText: 'Appliquer à Tous' });
        }
    }
}

// Exposer les fonctions utilisées via onclick HTML
window._editGroup   = editGroup;
window._deleteGroup = deleteGroup;
