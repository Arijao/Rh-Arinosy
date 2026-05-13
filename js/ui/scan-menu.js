// ============================================================
// ui/scan-menu.js — Dropdown menu méthode scan (ES Module)
// ============================================================

import { state } from '../state.js';

// ─────────────────────────────────────────────────────────────
// Navigation vers la section correspondant à la méthode active
// ─────────────────────────────────────────────────────────────

const SCAN_SECTIONS = {
  all:    'qr-presence',
  qr:     'qr-presence',
  manual: 'attendance',
  facial: 'face-presence',
};

export function navigateToScanSection() {
  const method  = window.currentMethodFilter || 'all';
  const section = SCAN_SECTIONS[method] || 'qr-presence';
  window.showSection?.(section);
}

// ─────────────────────────────────────────────────────────────
// Calcul des comptages depuis state (source unique de vérité)
// Appelé à chaque ouverture du menu ET à chaque updateStats()
// ─────────────────────────────────────────────────────────────

export function updateScanCounts() {
  const today  = new Date().toISOString().split('T')[0];
  const dayAtt = state.attendance[today] || {};
  const values = Object.values(dayAtt).filter(Boolean);

  const counts = {
    total:  values.length,
    qr:     values.filter(p => p?.method === 'QR').length,
    manual: values.filter(p => !p?.method || p?.method === 'MANUAL').length,
    facial: values.filter(p => p?.method === 'FACIAL').length,
  };

  // Rendre disponible globalement pour compatibilité
  window.attendanceMethodCounts = counts;
  return counts;
}

// ─────────────────────────────────────────────────────────────
// Mise à jour de la carte stat dashboard
// ─────────────────────────────────────────────────────────────

const SCAN_CONFIG = {
  all:    { icon: 'apps',                    color: '#6750A4', label: 'Tous Pointages'          },
  qr:     { icon: 'qr_code_scanner',         color: '#6750A4', label: 'Scans QR'                },
  manual: { icon: 'edit',                    color: '#f59e0b', label: 'Entrées Manuel'           },
  facial: { icon: 'face_retouching_natural', color: '#0ea5e9', label: 'Reconnaissance Faciale'  },
};

function _updateCard(method) {
  const counts = updateScanCounts();
  const cfg    = SCAN_CONFIG[method] || SCAN_CONFIG.all;
  const val    = method === 'qr'     ? counts.qr
               : method === 'manual' ? counts.manual
               : method === 'facial' ? counts.facial
               : counts.total;

  const el      = document.getElementById('qrScansToday');
  const iconEl  = document.getElementById('scanMethodIcon');
  const labelEl = document.getElementById('scanMethodLabel');

  if (el) {
    el.textContent = val;
    el.animate([{ transform: 'scale(1.2)' }, { transform: 'scale(1)' }], { duration: 200 });
  }
  if (iconEl)  { iconEl.textContent = cfg.icon;  iconEl.style.color = cfg.color; }
  if (labelEl)   labelEl.textContent = cfg.label;
}

// ─────────────────────────────────────────────────────────────
// Mise à jour des compteurs dans le menu déroulant
// ─────────────────────────────────────────────────────────────

function _updateMenuCounts() {
  const c    = updateScanCounts();
  const _set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  _set('allCount',    `${c.total} pointage${c.total !== 1 ? 's' : ''}`);
  _set('qrCount',     `${c.qr} scan${c.qr !== 1 ? 's' : ''}`);
  _set('manualCount', `${c.manual} entrée${c.manual !== 1 ? 's' : ''}`);
  _set('facialCount', `${c.facial} reconnaissance${c.facial !== 1 ? 's' : ''}`);
}

// ─────────────────────────────────────────────────────────────
// Toggle du menu déroulant
// ─────────────────────────────────────────────────────────────

export function toggleScanMethodMenu(event, btn) {
  event.stopPropagation();
  const menu    = document.getElementById('scanMethodMenu');
  // btn passé explicitement depuis le onclick inline (this) ou fallback
  const trigger = btn || event.currentTarget || document.getElementById('scanMethodMenuBtn');
  if (!menu || !trigger) return;

  const isOpen = menu.style.display === 'block';

  if (isOpen) {
    menu.style.display = 'none';
    return;
  }

  // Calculer et afficher les compteurs avant ouverture
  _updateMenuCounts();
  _highlightActiveItem();

  // Positionnement sous le bouton
  const rect = trigger.getBoundingClientRect();
  menu.style.left    = `${Math.max(16, rect.right - 220)}px`;
  menu.style.top     = `${rect.bottom + 8}px`;
  menu.style.right   = 'auto';
  menu.style.display = 'block';

  // Ajustement si débordement hors écran
  setTimeout(() => {
    const mr = menu.getBoundingClientRect();
    if (mr.right > window.innerWidth)   menu.style.left = `${window.innerWidth - mr.width - 16}px`;
    if (mr.bottom > window.innerHeight) menu.style.top  = `${rect.top - mr.height - 8}px`;
  }, 10);
}

// ─────────────────────────────────────────────────────────────
// Sélection d'une méthode
// ─────────────────────────────────────────────────────────────

export function filterScanMethod(method) {
  window.currentMethodFilter = method;
  document.getElementById('scanMethodMenu').style.display = 'none';
  _updateCard(method);
}

// ─────────────────────────────────────────────────────────────
// Rafraîchissement public — appelé par updateStats() dans stats.js
// Maintient la carte cohérente sans changer la méthode active
// ─────────────────────────────────────────────────────────────

export function refreshScanCard() {
  _updateCard(window.currentMethodFilter || 'all');
}

// ─────────────────────────────────────────────────────────────
// Surlignage de l'item actif dans le menu
// ─────────────────────────────────────────────────────────────

function _highlightActiveItem() {
  const menu   = document.getElementById('scanMethodMenu');
  const active = window.currentMethodFilter || 'all';
  if (!menu) return;
  menu.querySelectorAll('.menu-item').forEach(item => {
    const method = item.getAttribute('data-method');
    item.style.background = method === active ? 'rgba(103,80,164,.1)' : 'white';
  });
}

// ─────────────────────────────────────────────────────────────
// Fermeture au clic extérieur
// ─────────────────────────────────────────────────────────────

document.addEventListener('click', (e) => {
  const menu = document.getElementById('scanMethodMenu');
  if (menu?.style.display === 'block'
      && !e.target.closest('#scanMethodMenu')
      && !e.target.closest('button[onclick*="toggleScanMethodMenu"]')) {
    menu.style.display = 'none';
  }
});

// ─────────────────────────────────────────────────────────────
// Initialisation — ajoute data-method sur les items du menu
// et affiche le comptage initial (méthode 'all' par défaut)
// Appelée depuis main.js après updateStats()
// ─────────────────────────────────────────────────────────────

export function initScanMenu() {
  // Ajouter data-method sur chaque item pour le surlignage
  const menu    = document.getElementById('scanMethodMenu');
  const methods = ['all', 'qr', 'manual', 'facial'];
  if (menu) {
    menu.querySelectorAll('.menu-item').forEach((item, i) => {
      if (methods[i]) item.setAttribute('data-method', methods[i]);
    });
  }

  // Fermer sur Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const m = document.getElementById('scanMethodMenu');
      if (m) m.style.display = 'none';
    }
  });

  // Affichage initial
  window.currentMethodFilter    = 'all';
  window.navigateToScanSection  = navigateToScanSection;
  _updateCard('all');
}
