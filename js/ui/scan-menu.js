// ============================================================
// ui/scan-menu.js — Dropdown menu méthode scan (ES Module)
// ============================================================

import { formatCurrency } from '../utils/format.js';

export function toggleScanMethodMenu(event) {
  event.stopPropagation();
  const menu = document.getElementById('scanMethodMenu');
  const btn  = event.currentTarget;
  if (!menu || !btn) return;

  if (menu.style.display === 'none' || !menu.style.display) {
    const rect = btn.getBoundingClientRect();
    menu.style.left  = `${Math.max(16, rect.right - 220)}px`;
    menu.style.top   = `${rect.bottom + 8}px`;
    menu.style.right = 'auto';
    menu.style.display = 'block';
    _updateCounts();
    // Ajustement post-affichage
    setTimeout(() => {
      const mr = menu.getBoundingClientRect();
      if (mr.right > window.innerWidth) menu.style.left = `${window.innerWidth - mr.width - 16}px`;
      if (mr.bottom > window.innerHeight) menu.style.top = `${rect.top - mr.height - 8}px`;
    }, 10);
  } else {
    menu.style.display = 'none';
  }
}

export function filterScanMethod(method) {
  window.currentMethodFilter = method;
  const counts = window.attendanceMethodCounts || {};
  const el     = document.getElementById('qrScansToday');
  const iconEl = document.getElementById('scanMethodIcon');
  const labelEl = document.getElementById('scanMethodLabel');

  if (el) {
    const val = method === 'qr' ? counts.qr : method === 'manual' ? counts.manual : method === 'facial' ? counts.facial : counts.total;
    el.textContent = val || 0;
    el.animate([{ transform: 'scale(1.2)' }, { transform: 'scale(1)' }], { duration: 200 });
  }

  const cfg = {
    all:    { icon: 'apps',           color: '#6750A4', label: 'Tous Pointages' },
    qr:     { icon: 'qr_code_scanner',color: '#6750A4', label: 'Scans QR' },
    manual: { icon: 'edit',           color: '#f59e0b', label: 'Entrées Manuel' },
    facial: { icon: 'face',           color: '#0ea5e9', label: 'Reconnaissance Faciale' },
  };
  const c = cfg[method] || cfg.all;
  if (iconEl)  { iconEl.textContent = c.icon; iconEl.style.color = c.color; }
  if (labelEl)   labelEl.textContent = c.label;

  document.getElementById('scanMethodMenu').style.display = 'none';
}

function _updateCounts() {
  const c = window.attendanceMethodCounts || {};
  _set('allCount',    `${c.total || 0} pointage${(c.total || 0) > 1 ? 's' : ''}`);
  _set('qrCount',     `${c.qr || 0} scan${(c.qr || 0) > 1 ? 's' : ''}`);
  _set('manualCount', `${c.manual || 0} entrée${(c.manual || 0) > 1 ? 's' : ''}`);
  _set('facialCount', `${c.facial || 0} reconnaissance${(c.facial || 0) > 1 ? 's' : ''}`);
}
function _set(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

// Fermer au clic extérieur
document.addEventListener('click', (e) => {
  const menu = document.getElementById('scanMethodMenu');
  if (menu?.style.display === 'block' && !e.target.closest('#scanMethodMenu') && !e.target.closest('button'))
    menu.style.display = 'none';
});
