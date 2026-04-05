// ============================================================
// utils/format.js — Formatage (ES Module)
// ============================================================

export function formatCurrency(amount) {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount) + ' Ar';
}

export function formatDate(dateString, withDayName = true) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  const offset = date.getTimezoneOffset() * 60000;
  const corrected = new Date(date.getTime() + offset);
  const options = { day: '2-digit', month: '2-digit', year: 'numeric' };
  if (withDayName) options.weekday = 'long';
  return new Intl.DateTimeFormat('fr-FR', options).format(corrected);
}

export function formatDisplayTime(timeString) {
  if (!timeString || !timeString.includes(':')) return '...';
  try {
    const [h, min, s = '00'] = timeString.split(':');
    return s === '00' ? `${h}h ${min}min` : `${h}h ${min}min ${s}s`;
  } catch {
    return timeString;
  }
}

export function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatDateForFilename(date) {
  return date.toISOString().split('T')[0];
}

export function capitalizeWords(str) {
  return str.toLowerCase().split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export function calculateWorkDuration(startTime, endTime) {
  if (!startTime || !endTime) return { totalMinutes: 0, displayText: '---' };
  try {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const start = sh * 60 + sm;
    const end   = eh * 60 + em;
    if (end < start) return { totalMinutes: 0, displayText: "Erreur d'heure" };
    const dur = end - start;
    const h = Math.floor(dur / 60);
    const m = dur % 60;
    const displayText = h > 0 && m > 0 ? `${h}h ${m}m` : h > 0 ? `${h}h` : `${m}m`;
    return { totalMinutes: dur, displayText };
  } catch {
    return { totalMinutes: 0, displayText: 'Erreur' };
  }
}

export function debounce(func, delay = 300) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}

// Initialisation / lecture des inputs monétaires
export function initializeCurrencyInputs() {
  document.querySelectorAll('[data-type="currency"]').forEach(input => {
    input.addEventListener('input',  _formatCurrencyInput);
    input.addEventListener('blur',   _formatCurrencyInput);
    input.addEventListener('focus', function () {
      this.value = this.value.replace(/[^\d]/g, '');
    });
  });
}

function _formatCurrencyInput(e) {
  let v = e.target.value.replace(/[^\d]/g, '');
  e.target.value = v && !isNaN(v) ? parseInt(v).toLocaleString('fr-FR') : '';
}

export function getCurrencyValue(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return 0;
  const raw = el.value.replace(/[^\d]/g, '');
  return raw ? parseInt(raw, 10) : 0;
}

export function setCurrencyValue(inputId, value) {
  const el = document.getElementById(inputId);
  if (el) el.value = value ? parseInt(value).toLocaleString('fr-FR') : '';
}
