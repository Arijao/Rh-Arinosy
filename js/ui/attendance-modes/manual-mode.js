// ============================================================
// ui/attendance-modes/manual-mode.js — Mode présence Manuel
// Enregistrement manuel des présences (simple & détaillé)
// ============================================================

import { state, saveAttendanceData } from '../../state.js';
import { openAlert } from '../../utils/dialog-manager.js';
import { formatDisplayTime } from '../../utils/format.js';
import { renderPaginationControls } from '../../utils/ui.js';
import { playSuccessSound } from '../../utils/audio.js';

/**
 * Classe gère le mode de présence Manuel
 */
export class ManualMode {
  constructor() {
    this.container = null;
    this.currentDate = null;
    this.searchTerm = '';
    this.groupFilter = 'all';
    this.pagination = {
      current: 1,
      perPage: 15,
    };
  }

  /**
   * Initialise le mode Manuel
   * @param {string} containerId - ID du conteneur
   */
  init(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error('[ManualMode] Container not found:', containerId);
      return;
    }

    this._setupEventListeners();
    this._setupDateDefaults();
  }

  /**
   * Configure les event listeners
   * @private
   */
  _setupEventListeners() {
    // Date input
    this.container.querySelector('[data-attendance-date]')?.addEventListener('change', (e) => {
      this.currentDate = e.target.value;
      this.pagination.current = 1;
      this.display();
    });

    // Recherche employé
    this.container.querySelector('[data-employee-search]')?.addEventListener('input', (e) => {
      this.searchTerm = e.target.value.toLowerCase();
      this.pagination.current = 1;
      this.display();
    });

    // Filtre groupe
    this.container.querySelector('[data-group-filter]')?.addEventListener('change', (e) => {
      this.groupFilter = e.target.value;
      this.pagination.current = 1;
      this.display();
    });
  }

  /**
   * Définit la date par défaut (aujourd'hui)
   * @private
   */
  _setupDateDefaults() {
    const today = new Date().toISOString().split('T')[0];
    const dateInput = this.container.querySelector('[data-attendance-date]');
    if (dateInput) {
      dateInput.value = today;
      this.currentDate = today;
    }
  }

  /**
   * Affiche la liste des employés avec saisie manuelle
   */
  display() {
    if (!this.currentDate) {
      this._showEmptyState('Veuillez sélectionner une date');
      return;
    }

    if (!state.attendance[this.currentDate]) {
      state.attendance[this.currentDate] = {};
    }

    // Filtre et tri
    let employees = state.employees.filter((e) => e.status !== 'inactif');

    if (this.groupFilter !== 'all') {
      employees = employees.filter((e) => e.groupId === this.groupFilter);
    }

    const filtered = employees.filter((e) =>
      e.name.toLowerCase().includes(this.searchTerm) ||
      e.position.toLowerCase().includes(this.searchTerm)
    );

    // Tri : présents d'abord, puis par heure d'arrivée, puis par nom
    const dayAtt = state.attendance[this.currentDate];
    filtered.sort((a, b) => {
      const aHas = !!dayAtt[a.id]?.arrivee;
      const bHas = !!dayAtt[b.id]?.arrivee;

      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      if (aHas && bHas) {
        return (dayAtt[a.id].arrivee || '').localeCompare(dayAtt[b.id].arrivee || '');
      }

      return a.name.localeCompare(b.name);
    });

    // Pagination
    const totalPages = Math.ceil(filtered.length / this.pagination.perPage);
    const page = Math.max(1, Math.min(this.pagination.current, totalPages || 1));
    this.pagination.current = page;
    const slice = filtered.slice((page - 1) * this.pagination.perPage, page * this.pagination.perPage);

    // Rendu
    const listContainer = this.container.querySelector('[data-employee-list]');
    if (listContainer) {
      listContainer.innerHTML = slice.map((emp) => this._renderEmployeeRow(emp, dayAtt)).join('');
    }

    // Pagination controls
    const paginationContainer = this.container.querySelector('[data-pagination]');
    if (paginationContainer && totalPages > 1) {
      const html = this._renderPagination(page, totalPages);
      paginationContainer.innerHTML = html;

      // Ajoute les event listeners pour la pagination
      paginationContainer.querySelectorAll('[data-page]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const p = parseInt(btn.getAttribute('data-page'), 10);
          if (!isNaN(p)) {
            this.pagination.current = p;
            this.display();
          }
        });
      });
    }
  }

  /**
   * Rend une ligne d'employé
   * @private
   */
  _renderEmployeeRow(emp, dayAtt) {
    const att = dayAtt[emp.id];
    const isPresent = !!att?.arrivee;
    const group = state.groups.find((g) => g.id === emp.groupId);

    const methodBadge = this._renderMethodBadge(att?.method);

    return `
      <div class="attendance-row" data-employee-id="${emp.id}">
        <div class="attendance-row-left">
          <div class="attendance-row-status">
            <div class="status-indicator ${isPresent ? 'present' : 'absent'}"></div>
            <div class="attendance-row-info">
              <h4 class="employee-name">${emp.name}</h4>
              <p class="employee-position">${emp.position}</p>
              <p class="employee-group">${group ? group.name : 'Sans groupe'}</p>
            </div>
          </div>
        </div>

        <div class="attendance-row-middle">
          ${att?.arrivee ? `
            <div class="time-badges">
              <span class="badge success">
                <span class="material-icons">schedule</span>
                ${att.arrivee}
              </span>
              ${att.depart ? `
                <span class="badge info">
                  <span class="material-icons">exit_to_app</span>
                  ${att.depart}
                </span>
              ` : ''}
              ${methodBadge}
            </div>
          ` : ''}
        </div>

        <div class="attendance-row-right">
          <button class="btn btn-sm btn-tonal" onclick="window._manualMode?.toggleAttendance?.('${emp.id}', ${isPresent})">
            ${isPresent ? 'Modifier' : 'Présent'}
          </button>
          ${isPresent && !att.depart ? `
            <button class="btn btn-sm btn-outlined" onclick="window._manualMode?.registerDeparture?.('${emp.id}')">
              Départ
            </button>
          ` : ''}
          ${isPresent ? `
            <button class="btn btn-sm btn-error" onclick="window._manualMode?.clearAttendance?.('${emp.id}')">
              Annuler
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Rend le badge de méthode
   * @private
   */
  _renderMethodBadge(method) {
    if (!method) return '';

    const badges = {
      QR: {
        icon: 'qr_code_scanner',
        color: '#6750A4',
        label: 'QR',
      },
      FACIAL: {
        icon: 'face',
        color: '#0ea5e9',
        label: 'Facial',
      },
      MANUAL: {
        icon: 'edit',
        color: '#f59e0b',
        label: 'Manuel',
      },
    };

    const badge = badges[method];
    if (!badge) return '';

    return `
      <span class="badge" style="border-color: ${badge.color}; color: ${badge.color};">
        <span class="material-icons" style="font-size: 16px;">${badge.icon}</span>
        ${badge.label}
      </span>
    `;
  }

  /**
   * Rend les contrôles de pagination
   * @private
   */
  _renderPagination(current, total) {
    let html = '<div class="pagination">';

    // Bouton précédent
    if (current > 1) {
      html += `<button class="pagination-btn" data-page="${current - 1}">
        <span class="material-icons">chevron_left</span>
      </button>`;
    }

    // Numéros de page
    const delta = 2;
    for (let i = Math.max(1, current - delta); i <= Math.min(total, current + delta); i++) {
      html += `<button class="pagination-btn ${i === current ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }

    // Bouton suivant
    if (current < total) {
      html += `<button class="pagination-btn" data-page="${current + 1}">
        <span class="material-icons">chevron_right</span>
      </button>`;
    }

    html += '</div>';
    return html;
  }

  /**
   * Toggle la présence d'un employé
   */
  async toggleAttendance(employeeId, isCurrentlyPresent) {
    const employee = state.employees.find((e) => e.id === employeeId);
    if (!employee) return;

    if (isCurrentlyPresent) {
      // Ouvre un modal pour modifier
      this._openModificationModal(employee);
    } else {
      // Enregistre l'arrivée
      await this._registerArrival(employee);
    }
  }

  /**
   * Enregistre l'arrivée
   * @private
   */
  async _registerArrival(employee) {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (!state.attendance[this.currentDate]) {
      state.attendance[this.currentDate] = {};
    }

    state.attendance[this.currentDate][employee.id] = {
      arrivee: time,
      method: 'MANUAL',
    };

    await saveAttendanceData();
    playSuccessSound();
    this.display();
  }

  /**
   * Enregistre le départ
   */
  async registerDeparture(employeeId) {
    const employee = state.employees.find((e) => e.id === employeeId);
    if (!employee || !state.attendance[this.currentDate][employeeId]) return;

    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    state.attendance[this.currentDate][employeeId].depart = time;

    await saveAttendanceData();
    playSuccessSound();
    this.display();
  }

  /**
   * Annule la présence
   */
  async clearAttendance(employeeId) {
    if (!confirm('Êtes-vous sûr d\'annuler cette présence?')) return;

    if (state.attendance[this.currentDate][employeeId]) {
      delete state.attendance[this.currentDate][employeeId];
    }

    await saveAttendanceData();
    this.display();
  }

  /**
   * Ouvre un modal de modification
   * @private
   */
  _openModificationModal(employee) {
    // Placeholder — à implémenter avec un modal complet
    openAlert('Modification pour ' + employee.name + ' - À implémenter', 'info');
  }

  /**
   * Affiche un état vide
   * @private
   */
  _showEmptyState(message) {
    const listContainer = this.container.querySelector('[data-employee-list]');
    if (listContainer) {
      listContainer.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: var(--md-sys-color-on-surface-variant);">
          <span class="material-icons" style="font-size: 3rem; opacity: 0.5; display: block; margin-bottom: 16px;">info</span>
          <p>${message}</p>
        </div>
      `;
    }
  }

  /**
   * Détruit les ressources
   */
  destroy() {
    // Cleanup si nécessaire
  }
}

export default ManualMode;
