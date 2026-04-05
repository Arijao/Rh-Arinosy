// ============================================================
// ui/smart-search.js — Recherche intelligente employé réutilisable
// Adapté de search.js — même pattern UX, ciblé sur la sélection
// Utilisé par : Gestion des Avances · Gestion de la Paie
// ============================================================

import { state } from '../state.js';

// ─────────────────────────────────────────────────────────────
// Utilitaire interne : mise en évidence des correspondances
// Insensible à la casse · gère les caractères spéciaux regex
// Retourne le texte brut si term.length < 2
// ─────────────────────────────────────────────────────────────
function highlight(text, term) {
  if (!term || term.length < 2) return text;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(
    new RegExp(escaped, 'gi'),
    match => `<mark style="background:rgba(208,188,255,.35);color:#D0BCFF;border-radius:2px;padding:0 1px;">${match}</mark>`
  );
}

// ─────────────────────────────────────────────────────────────
// Utilitaire interne : rendu d'une carte résultat employé
// Identique visuellement à handleSmartSearch() dans search.js
// ─────────────────────────────────────────────────────────────
function renderEmployeeCard(emp, onSelectFn, term = '') {
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
        <div style="font-weight:700;color:#e2e8f0;font-size:1em;margin-bottom:4px;">${highlight(emp.name, term)}</div>
        <div style="font-size:.85em;color:#94a3b8;font-weight:500;">${highlight(emp.position, term)} · <strong style="color:var(--md-sys-color-primary);">${groupName}</strong></div>
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

  if (term.length < 2) { results.innerHTML = ''; results.style.display = 'none'; return; }

  const found = state.employees.filter(e =>
    (e.status !== 'inactif') &&
    (e.name.toLowerCase().includes(term) || e.position.toLowerCase().includes(term))
  );

  if (!found.length) {
    results.innerHTML = `<p style="text-align:center;padding:16px;color:#64748b;font-weight:600;">Aucun employé trouvé.</p>`;
    results.style.display = 'block';
    return;
  }

  results.innerHTML = found.map(emp => renderEmployeeCard(emp, 'window._selectAdvanceEmployee', term)).join('');
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

  if (term.length < 2) { results.innerHTML = ''; results.style.display = 'none'; return; }

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

  results.innerHTML = found.map(emp => renderEmployeeCard(emp, 'window._selectPayrollEmployee', term)).join('');
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
    // Employés
    const empInput   = document.getElementById('employeeSearch');
    const empResults = document.getElementById('employeeSearchResults');
    if (empResults && empInput && !empInput.contains(e.target) && !empResults.contains(e.target)) {
      empResults.style.display = 'none';
    }
  });
}

// ─────────────────────────────────────────────────────────────
// BRIDGE SCAN → CHAMP DE RECHERCHE
//
// Principe : startQRScan('advance') et startFaceScanForSelection('advance')
// écrivent directement dans #advanceEmployee.value (select caché) via
// scan-menu.js. Ce bridge écoute ces changements et les relaie
// automatiquement vers les champs de recherche visibles.
//
// Méthode : MutationObserver sur les options du select caché
//           + écoute du 'change' event déclenché par les scanners.
//
// Aucune modification dans scan-menu.js, qr-mode.js ou facial-mode.js.
// ─────────────────────────────────────────────────────────────

export function initScanBridge() {

  // ── Utilitaire : injecter une valeur dans un input et déclencher
  //    l'événement 'input' comme si l'utilisateur avait tapé
  function injectIntoSearchInput(inputId, name) {
    const input = document.getElementById(inputId);
    if (!input || !name) return;
    input.value = name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }

  // ── Utilitaire : trouver le nom d'un employé depuis son ID
  //    (state peut ne pas être chargé au moment de l'init,
  //     donc on résout au moment de l'événement)
  function getEmpName(empId) {
    // state est importé en haut du module — toujours disponible à runtime
    const emp = state.employees?.find(e => e.id === empId);
    return emp?.name || '';
  }

  // ── BRIDGE AVANCES ──────────────────────────────────────────
  // Quand scan-menu.js écrit dans #advanceEmployee, on relaie
  // vers #advanceEmployeeInput et on déclenche la recherche
  const advHidden = document.getElementById('advanceEmployee');
  if (advHidden) {

    // 1. Écoute directe du 'change' event (déclenché par certains scanners)
    advHidden.addEventListener('change', () => {
      const empId = advHidden.value;
      if (!empId) return;
      const name = getEmpName(empId);
      if (name) injectIntoSearchInput('advanceEmployeeInput', name);
    });

    // 2. MutationObserver sur les <option> du select
    //    (certains scanners ajoutent l'option puis setent .value sans 'change')
    const advObserver = new MutationObserver(() => {
      const empId = advHidden.value;
      if (!empId) return;
      const name = getEmpName(empId);
      if (name) {
        const visibleInput = document.getElementById('advanceEmployeeInput');
        // N'injecter que si le champ visible ne contient pas déjà ce nom
        if (visibleInput && visibleInput.value !== name) {
          injectIntoSearchInput('advanceEmployeeInput', name);
        }
      }
    });
    advObserver.observe(advHidden, { childList: true, subtree: false });
  }

  // ── BRIDGE PAIE ─────────────────────────────────────────────
  // Quand scan-menu.js écrit dans #payrollEmployeeSelect, on relaie
  // vers #payrollEmployeeInput et on déclenche la recherche
  const payHidden = document.getElementById('payrollEmployeeSelect');
  if (payHidden) {

    // 1. Écoute directe du 'change' event
    payHidden.addEventListener('change', () => {
      const empId = payHidden.value;
      if (!empId) return;
      const name = getEmpName(empId);
      if (name) injectIntoSearchInput('payrollEmployeeInput', name);
    });

    // 2. MutationObserver sur les <option>
    const payObserver = new MutationObserver(() => {
      const empId = payHidden.value;
      if (!empId) return;
      const name = getEmpName(empId);
      if (name) {
        const visibleInput = document.getElementById('payrollEmployeeInput');
        if (visibleInput && visibleInput.value !== name) {
          injectIntoSearchInput('payrollEmployeeInput', name);
        }
      }
    });
    payObserver.observe(payHidden, { childList: true, subtree: false });
  }
}

// ─────────────────────────────────────────────────────────────
// EMPLOYÉS — Recherche intelligente avec highlight sur la liste
// ─────────────────────────────────────────────────────────────

export function handleEmployeeSearch() {
  const term      = (document.getElementById('employeeSearch')?.value || '').toLowerCase().trim();
  const dropdown  = document.getElementById('employeeSearchResults');
  const groupId   = document.getElementById('employeeGroupFilter')?.value || 'all';

  // Fermer le dropdown et laisser displayEmployees() filtrer normalement
  // si le terme est trop court (< 2 chars)
  if (!dropdown) return;
  if (term.length < 2) {
    dropdown.innerHTML = '';
    dropdown.style.display = 'none';
    return;
  }

  // Pool : mêmes règles que displayEmployees() — exclut les inactifs, filtre par groupe
  let pool = state.employees.filter(e => e.status !== 'inactif');
  if (groupId === 'none')       pool = pool.filter(e => !e.groupId);
  else if (groupId !== 'all')   pool = pool.filter(e => e.groupId === groupId);

  const found = pool.filter(e =>
    e.name.toLowerCase().includes(term) || e.position.toLowerCase().includes(term)
  );

  if (!found.length) {
    dropdown.innerHTML = `<p style="text-align:center;padding:16px;color:#64748b;font-weight:600;">Aucun employé trouvé.</p>`;
    dropdown.style.display = 'block';
    return;
  }

  // Réutilise renderEmployeeCard avec highlight — action : scroll vers l'employé dans la liste
  dropdown.innerHTML = found.map(emp =>
    renderEmployeeCard(emp, 'window._scrollToEmployee', term)
  ).join('');
  dropdown.style.display = 'block';
}

// Scroll vers la carte de l'employé dans la liste principale
// Si l'employé est sur une autre page de pagination, on le retrouve via displayEmployees()
export function scrollToEmployee(empId) {
  const emp = state.employees.find(e => e.id === empId);
  if (!emp) return;

  // Remplir le champ de recherche avec le nom exact → displayEmployees() filtrera sur 1 résultat
  const input = document.getElementById('employeeSearch');
  if (input) {
    input.value = emp.name;
    // Réinitialiser la pagination et relancer l'affichage filtré
    state.pagination.employee.current = 1;
    // Import dynamique pour éviter la dépendance circulaire
    import('./employees.js').then(m => m.displayEmployees());
  }

  // Fermer le dropdown
  const dropdown = document.getElementById('employeeSearchResults');
  if (dropdown) { dropdown.innerHTML = ''; dropdown.style.display = 'none'; }
}

// ─────────────────────────────────────────────────────────────
// Fermer le dropdown Employés au clic extérieur
// (complète initSmartSearchDropdowns sans la dupliquer)
// ─────────────────────────────────────────────────────────────
export function initEmployeeSearchDropdown() {
  document.addEventListener('click', (e) => {
    const empInput   = document.getElementById('employeeSearch');
    const empResults = document.getElementById('employeeSearchResults');
    if (empResults && empInput &&
        !empInput.contains(e.target) &&
        !empResults.contains(e.target)) {
      empResults.style.display = 'none';
    }
  });
}

// ─────────────────────────────────────────────────────────────
// SAISIE MANUELLE DES PRÉSENCES — Recherche intelligente
// Pattern : dropdown + highlight + scroll vers l'employé
// (identique à la Liste des Employés)
// ─────────────────────────────────────────────────────────────

export function handleAttendanceEmployeeSearch() {
  const term    = (document.getElementById('attendanceEmployeeSearch')?.value || '').toLowerCase().trim();
  const results = document.getElementById('attendanceSearchResults');
  if (!results) return;

  if (term.length < 2) { results.innerHTML = ''; results.style.display = 'none'; return; }

  const found = state.employees
    .filter(e => e.status !== 'inactif')
    .filter(e => e.name.toLowerCase().includes(term) || e.position.toLowerCase().includes(term));

  if (!found.length) {
    results.innerHTML = `<p style="text-align:center;padding:16px;color:#64748b;font-weight:600;">Aucun employé trouvé.</p>`;
    results.style.display = 'block';
    return;
  }

  results.innerHTML = found.map(emp => renderEmployeeCard(emp, 'window._selectAttendanceEmployee', term)).join('');
  results.style.display = 'block';
}

export function selectAttendanceEmployee(empId) {
  const emp = state.employees.find(e => e.id === empId);
  if (!emp) return;

  // Remplir le champ visible avec le nom exact → displayAttendance() filtrera sur 1 résultat
  const input = document.getElementById('attendanceEmployeeSearch');
  if (input) {
    input.value = emp.name;
    // Réinitialiser la pagination et relancer l'affichage filtré
    if (window._attendanceState) window._attendanceState.pagination.attendance.current = 1;
    // Import dynamique pour éviter la dépendance circulaire
    import('./attendance.js').then(m => m.displayAttendance?.());
  }

  // Fermer le dropdown
  const results = document.getElementById('attendanceSearchResults');
  if (results) { results.innerHTML = ''; results.style.display = 'none'; }
}

// ─────────────────────────────────────────────────────────────
// Fermer le dropdown Présences au clic extérieur
// (complète initSmartSearchDropdowns sans la dupliquer)
// ─────────────────────────────────────────────────────────────
export function initAttendanceSearchDropdown() {
  document.addEventListener('click', (e) => {
    const attInput   = document.getElementById('attendanceEmployeeSearch');
    const attResults = document.getElementById('attendanceSearchResults');
    if (attResults && attInput &&
        !attInput.contains(e.target) &&
        !attResults.contains(e.target)) {
      attResults.style.display = 'none';
    }
  });
}

// Exposer sur window pour les onclick inline HTML
window._selectAdvanceEmployee           = selectAdvanceEmployee;
window._selectPayrollEmployee           = selectPayrollEmployee;
window._handleAdvanceEmployeeSearch     = handleAdvanceEmployeeSearch;
window._handlePayrollEmployeeSearch     = handlePayrollEmployeeSearch;
window._scrollToEmployee                = scrollToEmployee;
window._selectAttendanceEmployee        = selectAttendanceEmployee;
window._handleAttendanceEmployeeSearch  = handleAttendanceEmployeeSearch;
