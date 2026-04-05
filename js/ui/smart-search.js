// ============================================================
// ui/smart-search.js — Recherche intelligente employé réutilisable
// Adapté de search.js — même pattern UX, ciblé sur la sélection
// Utilisé par : Gestion des Avances · Gestion de la Paie
// ============================================================

import { state } from '../state.js';

// ─────────────────────────────────────────────────────────────
// Utilitaire interne : rendu d'une carte résultat employé
// Identique visuellement à handleSmartSearch() dans search.js
// ─────────────────────────────────────────────────────────────
function renderEmployeeCard(emp, onSelectFn) {
  const group     = state.groups.find(g => g.id === emp.groupId);
  const groupName = group ? group.name : '<i>Sans groupe</i>';
  const today     = new Date().toISOString().split('T')[0];
  const isPresent = !!state.attendance[today]?.[emp.id];

  const presenceBadge = isPresent
    ? `<span style="background:rgba(16,185,129,.2);border:1.5px solid rgba(16,185,129,.4);color:#064e3b;padding:4px 10px;border-radius:20px;font-size:.82em;font-weight:700;display:inline-flex;align-items:center;gap:4px;">
         <span class="material-icons" style="font-size:15px;">check_circle</span>Présent aujourd'hui
       </span>`
    : '';

  return `
    <div style="cursor:pointer;border-radius:10px;padding:12px 16px;margin-bottom:8px;
                background:rgba(51,65,85,.7);border:1px solid rgba(148,163,184,.2);
                display:flex;justify-content:space-between;align-items:center;
                transition:all 0.2s ease;"
         onclick="${onSelectFn}('${emp.id}')"
         onmouseover="this.style.transform='translateY(-2px)';this.style.borderColor='rgba(103,80,164,.5)';this.style.boxShadow='0 4px 16px rgba(103,80,164,.2)'"
         onmouseout="this.style.transform='translateY(0)';this.style.borderColor='rgba(148,163,184,.2)';this.style.boxShadow='none'">
      <div>
        <div style="font-weight:700;color:#e2e8f0;font-size:1em;margin-bottom:4px;">${emp.name}</div>
        <div style="font-size:.85em;color:#94a3b8;font-weight:500;">${emp.position} · <strong style="color:var(--md-sys-color-primary);">${groupName}</strong></div>
        ${presenceBadge ? `<div style="margin-top:6px;">${presenceBadge}</div>` : ''}
      </div>
      <span class="material-icons" style="color:var(--md-sys-color-primary);font-size:20px;">arrow_forward_ios</span>
    </div>`;
}

// ─────────────────────────────────────────────────────────────
// AVANCES — Recherche intelligente pour le formulaire d'ajout
// ─────────────────────────────────────────────────────────────

export function handleAdvanceEmployeeSearch() {
  const term    = (document.getElementById('advanceEmployeeInput')?.value || '').toLowerCase().trim();
  const results = document.getElementById('advanceEmployeeResults');
  if (!results) return;

  if (term.length < 1) { results.innerHTML = ''; results.style.display = 'none'; return; }

  const found = state.employees.filter(e =>
    (e.status !== 'inactif') &&
    (e.name.toLowerCase().includes(term) || e.position.toLowerCase().includes(term))
  );

  if (!found.length) {
    results.innerHTML = `<p style="text-align:center;padding:16px;color:#64748b;font-weight:600;">Aucun employé trouvé.</p>`;
    results.style.display = 'block';
    return;
  }

  results.innerHTML = found.map(emp => renderEmployeeCard(emp, 'window._selectAdvanceEmployee')).join('');
  results.style.display = 'block';
}

export function selectAdvanceEmployee(empId) {
  const emp = state.employees.find(e => e.id === empId);
  if (!emp) return;

  // Poser la valeur dans le select caché (lu par advances.js / handleAddAdvance)
  const hidden = document.getElementById('advanceEmployee');
  if (hidden) {
    // S'assurer que l'option existe
    if (!hidden.querySelector(`option[value="${empId}"]`)) {
      const opt = document.createElement('option');
      opt.value = empId;
      opt.textContent = emp.name;
      hidden.appendChild(opt);
    }
    hidden.value = empId;
    hidden.dispatchEvent(new Event('change')); // déclenche previewNetSalary
  }

  // Afficher le nom sélectionné dans le champ visible
  const input = document.getElementById('advanceEmployeeInput');
  if (input) input.value = emp.name;

  // Fermer le dropdown
  const results = document.getElementById('advanceEmployeeResults');
  if (results) { results.innerHTML = ''; results.style.display = 'none'; }
}

// ─────────────────────────────────────────────────────────────
// PAIE — Recherche intelligente pour la sélection d'employé
// ─────────────────────────────────────────────────────────────

export function handlePayrollEmployeeSearch() {
  const term    = (document.getElementById('payrollEmployeeInput')?.value || '').toLowerCase().trim();
  const results = document.getElementById('payrollEmployeeResults');
  const groupId = document.getElementById('payrollGroupFilter')?.value || 'all';
  if (!results) return;

  if (term.length < 1) { results.innerHTML = ''; results.style.display = 'none'; return; }

  let pool = state.employees.filter(e => e.status === 'actif' || e.status === 'depart' || !e.status);
  if (groupId !== 'all') pool = pool.filter(e => e.groupId === groupId);

  const found = pool.filter(e =>
    e.name.toLowerCase().includes(term) || e.position.toLowerCase().includes(term)
  );

  if (!found.length) {
    results.innerHTML = `<p style="text-align:center;padding:16px;color:#64748b;font-weight:600;">Aucun employé trouvé.</p>`;
    results.style.display = 'block';
    return;
  }

  results.innerHTML = found.map(emp => renderEmployeeCard(emp, 'window._selectPayrollEmployee')).join('');
  results.style.display = 'block';
}

export function selectPayrollEmployee(empId) {
  const emp = state.employees.find(e => e.id === empId);
  if (!emp) return;

  // Poser l'empId dans le select caché (lu par calculatePayroll / handlePayrollEmployeeChange)
  const hidden = document.getElementById('payrollEmployeeSelect');
  if (hidden) {
    if (!hidden.querySelector(`option[value="${empId}"]`)) {
      const opt = document.createElement('option');
      opt.value = empId;
      opt.textContent = emp.name;
      hidden.appendChild(opt);
    }
    hidden.value = empId;
    // Sync le filtre groupe avec l'employé sélectionné
    const groupSel = document.getElementById('payrollGroupFilter');
    if (groupSel) groupSel.value = emp.groupId || 'all';
  }

  // Afficher le nom dans le champ visible
  const input = document.getElementById('payrollEmployeeInput');
  if (input) input.value = emp.name;

  // Fermer le dropdown
  const results = document.getElementById('payrollEmployeeResults');
  if (results) { results.innerHTML = ''; results.style.display = 'none'; }

  // Vider les résultats de calcul (même comportement que l'ancien onchange)
  const payrollResults = document.getElementById('payrollResults');
  if (payrollResults) payrollResults.innerHTML = '';
}

// ─────────────────────────────────────────────────────────────
// Initialisation — fermer les dropdowns si clic extérieur
// ─────────────────────────────────────────────────────────────
export function initSmartSearchDropdowns() {
  document.addEventListener('click', (e) => {
    // Avances
    const advInput   = document.getElementById('advanceEmployeeInput');
    const advResults = document.getElementById('advanceEmployeeResults');
    if (advResults && advInput && !advInput.contains(e.target) && !advResults.contains(e.target)) {
      advResults.style.display = 'none';
    }
    // Paie
    const payInput   = document.getElementById('payrollEmployeeInput');
    const payResults = document.getElementById('payrollEmployeeResults');
    if (payResults && payInput && !payInput.contains(e.target) && !payResults.contains(e.target)) {
      payResults.style.display = 'none';
    }
  });
}

// Exposer sur window pour les onclick inline HTML
window._selectAdvanceEmployee = selectAdvanceEmployee;
window._selectPayrollEmployee  = selectPayrollEmployee;
window._handleAdvanceEmployeeSearch = handleAdvanceEmployeeSearch;
window._handlePayrollEmployeeSearch = handlePayrollEmployeeSearch;
