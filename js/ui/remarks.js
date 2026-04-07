// ============================================================
// ui/remarks.js — Gestion des Remarques / Notes Employé (ES Module)
// ============================================================

import { state, saveData, dbManager } from '../state.js';
import { openModal, closeModal } from '../utils/ui.js';
import { showToast, openConfirm } from '../utils/notifications.js';
import { formatDate } from '../utils/format.js';

// ------ Config ------

const REMARK_TYPES = {
  remarque:      { label: 'Remarque',      icon: 'info',           color: 'var(--md-sys-color-primary)', severity: 'info'   },
  avertissement: { label: 'Avertissement', icon: 'report_problem', color: 'var(--md-sys-color-error)',   severity: 'warning' },
  note:          { label: 'Note',          icon: 'sticky_note_2',  color: 'var(--md-sys-color-tertiary)', severity: 'info'  },
  alerte:        { label: 'Alerte',        icon: 'error',          color: '#EF4444',                      severity: 'critical' },
};

const REMARK_STATUSES = {
  actif:   { label: 'Actif',   color: '' },
  resolu:  { label: 'Résolu',  color: 'var(--md-sys-color-success)' },
  archive: { label: 'Archivé', color: 'var(--md-sys-color-outline)' },
};

// Niveaux de sévérité pour les alertes
const SEVERITY_LEVELS = {
  info:     { label: 'Info',         icon: 'info',     color: '#6750A4' },
  warning:  { label: 'Avertissement', icon: 'warning',  color: '#F59E0B' },
  critical: { label: 'Critique',      icon: 'error',    color: '#EF4444' },
};

// ------ Init ------

export function initRemarks() {
  // Exposer globalement pour les onclick inline
  window._openRemarksModal  = openRemarksModal;
  window._deleteRemark      = deleteRemark;
  window._toggleRemarkStatus = toggleRemarkStatus;
  window._closeRemarksModal = () => closeModal('remarksModal');

  // Soumission du formulaire d'ajout
  document.getElementById('remarkForm')
    ?.addEventListener('submit', handleAddRemark);
}

// ------ Ouvrir la modale ------

export function openRemarksModal(employeeId) {
  const emp = state.employees.find(e => e.id === employeeId);
  if (!emp) return;

  // Remplir le titre
  const title = document.getElementById('remarksModalTitle');
  if (title) title.textContent = `Remarques — ${emp.name}`;

  // Stocker l'ID employé dans le formulaire
  const hiddenId = document.getElementById('remarkEmployeeId');
  if (hiddenId) hiddenId.value = employeeId;

  // Réinitialiser le formulaire
  document.getElementById('remarkForm')?.reset();
  if (hiddenId) hiddenId.value = employeeId; // reset() efface les hidden, remettre

  // Afficher la liste
  renderRemarksList(employeeId);

  openModal('remarksModal');
}

// ------ Rendu de la liste ------

function renderRemarksList(employeeId) {
  const container = document.getElementById('remarksList');
  if (!container) return;

  const remarks = (state.remarks || [])
    .filter(r => r.employeeId === employeeId)
    .sort((a, b) => {
      // Actifs en premier, puis par date décroissante
      if (a.status === 'actif' && b.status !== 'actif') return -1;
      if (a.status !== 'actif' && b.status === 'actif') return 1;
      return new Date(b.date) - new Date(a.date);
    });

  if (!remarks.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:24px;color:var(--md-sys-color-on-surface-variant);">
        <span class="material-icons" style="font-size:40px;opacity:0.4;">comment</span>
        <p style="margin-top:8px;">Aucune remarque pour cet employé.</p>
      </div>`;
    return;
  }

  container.innerHTML = remarks.map(r => {
    const cfg    = REMARK_TYPES[r.type]    || REMARK_TYPES.remarque;
    const stCfg  = REMARK_STATUSES[r.status] || REMARK_STATUSES.actif;
    const isActif = r.status === 'actif';
    const opacity = isActif ? '1' : '0.55';

    return `
      <div class="remark-item" data-id="${r.id}" style="
          opacity:${opacity};
          border-left:4px solid ${isActif ? cfg.color : 'var(--md-sys-color-outline)'};
          background:var(--md-sys-color-surface-variant);
          border-radius:8px;
          padding:12px 14px;
          margin-bottom:10px;
          transition:opacity 0.2s;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
          <div style="display:flex;align-items:center;gap:8px;flex:1;">
            <span class="material-icons" style="font-size:20px;color:${isActif ? cfg.color : 'var(--md-sys-color-outline)'};">${cfg.icon}</span>
            <div style="flex:1;">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <strong style="font-size:13px;color:${isActif ? cfg.color : 'var(--md-sys-color-outline)'};">${cfg.label}</strong>
                <span style="font-size:11px;color:var(--md-sys-color-on-surface-variant);">${formatDate(r.date, false)}</span>
                <span style="font-size:11px;padding:2px 8px;border-radius:12px;background:${stCfg.color || 'var(--md-sys-color-primary-container)'};color:var(--md-sys-color-on-surface-variant);">${stCfg.label}</span>
              </div>
              <p style="margin:6px 0 0;font-size:14px;white-space:pre-wrap;">${_escapeHtml(r.content)}</p>
            </div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            ${isActif ? `
              <button class="btn-icon" title="Marquer résolu"
                onclick="window._toggleRemarkStatus?.('${r.id}','resolu')">
                <span class="material-icons" style="font-size:18px;color:var(--md-sys-color-success);">check_circle</span>
              </button>` : `
              <button class="btn-icon" title="Réactiver"
                onclick="window._toggleRemarkStatus?.('${r.id}','actif')">
                <span class="material-icons" style="font-size:18px;color:var(--md-sys-color-primary);">refresh</span>
              </button>`}
            <button class="btn-icon" title="Supprimer"
              onclick="window._deleteRemark?.('${r.id}')">
              <span class="material-icons" style="font-size:18px;color:var(--md-sys-color-error);">delete</span>
            </button>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ------ Ajouter une remarque ------

async function handleAddRemark(e) {
  e.preventDefault();
  const form       = e.target;
  const employeeId = document.getElementById('remarkEmployeeId')?.value;
  const type       = document.getElementById('remarkType')?.value;
  const content    = document.getElementById('remarkContent')?.value?.trim();
  const date       = document.getElementById('remarkDate')?.value || new Date().toISOString().split('T')[0];
  const isBlocking = document.getElementById('remarkBlocking')?.checked || false;

  if (!employeeId || !type || !content) {
    showToast('Veuillez remplir tous les champs.', 'error');
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Enregistrement...'; }

  try {
    // Déterminer la sévérité basée sur le type
    const remarkTypeConfig = REMARK_TYPES[type] || REMARK_TYPES.remarque;
    const severity = remarkTypeConfig.severity || 'info';

    const remark = {
      id:         `rmk-${Date.now()}`,
      employeeId,
      type,
      content,
      date,
      status:     'actif',
      createdAt:  new Date().toISOString(),
      severity,    // INFO, WARNING, CRITICAL
      blocking:    isBlocking || (severity === 'critical') // Auto-bloquant si critique
    };

    if (!state.remarks) state.remarks = [];
    state.remarks.push(remark);
    await dbManager.add('remarks', remark);

    form.reset();
    document.getElementById('remarkEmployeeId').value = employeeId; // restaurer après reset
    document.getElementById('remarkDate').value = new Date().toISOString().split('T')[0];

    renderRemarksList(employeeId);
    _refreshEmployeeRemarkIndicator(employeeId);
    showToast('Remarque ajoutée.', 'success');
  } catch (err) {
    console.error('[handleAddRemark]', err);
    showToast('Erreur lors de l\'enregistrement.', 'error');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Ajouter'; }
  }
}

// ------ Changer statut ------

export async function toggleRemarkStatus(remarkId, newStatus) {
  const idx = (state.remarks || []).findIndex(r => r.id === remarkId);
  if (idx === -1) return;

  state.remarks[idx].status = newStatus;
  try {
    await dbManager.put('remarks', state.remarks[idx]);
    const empId = state.remarks[idx].employeeId;
    renderRemarksList(empId);
    _refreshEmployeeRemarkIndicator(empId);
    showToast(newStatus === 'resolu' ? 'Remarque marquée résolue.' : 'Remarque réactivée.', 'success');
  } catch (err) {
    console.error('[toggleRemarkStatus]', err);
    showToast('Erreur lors de la mise à jour.', 'error');
  }
}

// ------ Supprimer ------

export async function deleteRemark(remarkId) {
  const confirmed = await openConfirm(
    'Supprimer la remarque',
    'Êtes-vous sûr de vouloir supprimer définitivement cette remarque ?',
    'Supprimer',
    'Annuler'
  );
  if (!confirmed) return;

  const idx = (state.remarks || []).findIndex(r => r.id === remarkId);
  if (idx === -1) return;

  const empId = state.remarks[idx].employeeId;
  state.remarks.splice(idx, 1);

  try {
    await dbManager.delete('remarks', remarkId);
    renderRemarksList(empId);
    _refreshEmployeeRemarkIndicator(empId);
    showToast('Remarque supprimée.', 'success');
  } catch (err) {
    console.error('[deleteRemark]', err);
    showToast('Erreur lors de la suppression.', 'error');
  }
}

// ------ Helpers ------

/**
 * Rafraîchit l'indicateur visuel d'un employé dans la liste sans
 * tout re-rendre (mise à jour chirurgicale du DOM).
 */
function _refreshEmployeeRemarkIndicator(employeeId) {
  // Déclenche un re-rendu léger de la liste employés si disponible
  window._displayEmployees?.();
}

function _escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ------ API publique pour intégration transverse ------

/**
 * Retourne un badge HTML compact pour afficher dans les vues
 * scan, paie, avances. Usage: getRemarkBadge(employeeId)
 */
export function getRemarkBadge(employeeId) {
  const active = (state.remarks || []).filter(r => r.employeeId === employeeId && r.status === 'actif');
  if (!active.length) return '';

  const hasWarning = active.some(r => r.type === 'avertissement');
  const color  = hasWarning ? 'var(--md-sys-color-error)' : 'var(--md-sys-color-tertiary)';
  const icon   = hasWarning ? 'report_problem' : 'info';
  const title  = active.map(r => `[${REMARK_TYPES[r.type]?.label}] ${r.content.substring(0, 60)}`).join('\n');

  return `
    <span class="remark-badge"
          style="display:inline-flex;align-items:center;gap:3px;
                 background:${color}22;color:${color};
                 border:1px solid ${color}55;
                 border-radius:12px;padding:2px 7px;
                 font-size:12px;font-weight:600;cursor:pointer;vertical-align:middle;"
          title="${_escapeHtml(title)}"
          onclick="window._openRemarksModal?.('${employeeId}')">
      <span class="material-icons" style="font-size:14px;">${icon}</span>
      ${active.length}
    </span>`;
}
