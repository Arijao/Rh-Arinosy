// ============================================================
// utils/ui.js — Utilitaires UI (ES Module)
// ============================================================

// ------ Alerts ------

export function showAlert(message, type = 'success') {
  const div = document.createElement('div');
  div.className = `alert alert-${type}`;
  div.innerHTML = `
    <span class="material-icons">${type === 'success' ? 'check_circle' : type === 'warning' ? 'warning' : 'error'}</span>
    ${message}`;
  Object.assign(div.style, {
    position: 'fixed', top: '24px', right: '24px', zIndex: '9999',
    minWidth: '300px', animation: 'slideInRight 0.3s ease',
  });
  document.body.appendChild(div);
  setTimeout(() => {
    div.style.animation = 'slideOutRight 0.3s ease';
    setTimeout(() => div.parentNode?.removeChild(div), 300);
  }, 3000);
}

export function showToast(message, type = 'info', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
      <span class="material-icons" style="font-size:24px;">
        ${type === 'error' ? 'error' : type === 'success' ? 'check_circle' : 'info'}
      </span>
      <span style="flex:1;">${message}</span>
      <button onclick="this.parentElement.parentElement.remove()"
              style="background:none;border:none;color:inherit;cursor:pointer;">
        <span class="material-icons" style="font-size:20px;">close</span>
      </button>
    </div>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ------ Modals ------

export function openModal(modalId) {
  document.getElementById(modalId)?.classList.add('active');
}

export function closeModal(modalId) {
  document.getElementById(modalId)?.classList.remove('active');
}

// ------ Pagination ------

export function renderPaginationControls(containerId, currentPage, totalPages, totalItems, itemsPerPage, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (totalPages <= 1) { container.innerHTML = ''; return; }

  const start = (currentPage - 1) * itemsPerPage + 1;
  const end   = Math.min(currentPage * itemsPerPage, totalItems);

  container.innerHTML = `
    <button id="${containerId}-prev" ${currentPage === 1 ? 'disabled' : ''}>
      <span class="material-icons">chevron_left</span> Teo aloha
    </button>
    <span class="pagination-info">Mampiseho ${start}-${end} amin'ny ${totalItems}</span>
    <button id="${containerId}-next" ${currentPage === totalPages ? 'disabled' : ''}>
      Manaraka <span class="material-icons">chevron_right</span>
    </button>`;

  document.getElementById(`${containerId}-prev`)
    ?.addEventListener('click', () => { if (currentPage > 1) onPageChange(currentPage - 1); });
  document.getElementById(`${containerId}-next`)
    ?.addEventListener('click', () => { if (currentPage < totalPages) onPageChange(currentPage + 1); });
}

// ------ Notifications container ------

export function displayNotification(message, type = 'info', icon = 'info') {
  const container = document.getElementById('notificationsContainer');
  if (!container) return;
  const div = document.createElement('div');
  div.className = `alert alert-${type}`;
  div.style.cssText = 'display:flex;align-items:center;justify-content:space-between;animation:fadeIn 0.5s ease;';
  div.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
      <span class="material-icons">${icon}</span><span>${message}</span>
    </div>
    <button class="close-btn" style="background:none;border:none;cursor:pointer;" onclick="this.parentElement.remove()">
      <span class="material-icons">close</span>
    </button>`;
  container.prepend(div);
}

// ------ JSON download ------

export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}
