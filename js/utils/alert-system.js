// ============================================================
// alert-system.js — Système Centralisé d'Alertes Employé (ES Module)
// ============================================================

import { state } from '../state.js';
import { openConfirm } from './notifications.js';
import { formatDate } from './format.js';

// ============================================================
// 1. CONFIGURATION
// ============================================================

export const ALERT_SEVERITY = {
  INFO: {
    id: 'info',
    label: 'Information',
    icon: 'info',
    color: '#6750A4',
    bgColor: 'rgba(103, 80, 164, 0.1)',
    borderColor: '#6750A4',
    dialogType: 'info'
  },
  WARNING: {
    id: 'warning',
    label: 'Avertissement',
    icon: 'warning',
    color: '#F59E0B',
    bgColor: 'rgba(245, 158, 11, 0.1)',
    borderColor: '#F59E0B',
    dialogType: 'warning'
  },
  CRITICAL: {
    id: 'critical',
    label: 'Alerte Critique',
    icon: 'error',
    color: '#EF4444',
    bgColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: '#EF4444',
    dialogType: 'error'
  }
};

// Points de déclenchement
export const TRIGGER_POINTS = {
  QR_SCAN: 'qr_scan',
  FACIAL_SCAN: 'facial_scan',
  MANUAL_ATTENDANCE: 'manual_attendance',
  ADVANCE_REQUEST: 'advance_request',
  ADVANCE_CONFIRM: 'advance_confirm',
  PAYROLL_PAY: 'payroll_pay',
  EMPLOYEE_VIEW: 'employee_view',
  EMPLOYEE_EDIT: 'employee_edit',
  EMPLOYEE_STATUS_CHANGE: 'employee_status_change'
};

// ============================================================
// 2. FONCTIONS UTILITAIRES
// ============================================================

/**
 * Récupère toutes les alertes actives d'un employé
 * @param {string} employeeId - ID de l'employé
 * @returns {Array} - Liste des alertes actives triées par sévérité
 */
export function getEmployeeAlerts(employeeId) {
  const remarks = state.remarks || [];
  return remarks
    .filter(r => r.employeeId === employeeId && r.status === 'actif')
    .map(r => ({
      ...r,
      severity: r.severity || _remarkTypeToSeverity(r.type),
      blocking: r.blocking || false
    }))
    .sort((a, b) => {
      // Trier par sévérité: CRITICAL > WARNING > INFO
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      const aOrder = severityOrder[a.severity] ?? 3;
      const bOrder = severityOrder[b.severity] ?? 3;
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Puis par date décroissante
      return new Date(b.date) - new Date(a.date);
    });
}

/**
 * Convertit l'ancien type de remarque en sévérité
 */
function _remarkTypeToSeverity(type) {
  switch (type) {
    case 'avertissement': return 'warning';
    case 'note': return 'info';
    case 'remarque':
    default: return 'info';
  }
}

/**
 * Vérifie si un employé a des alertes bloquantes
 * @param {string} employeeId 
 * @returns {boolean}
 */
export function hasBlockingAlerts(employeeId) {
  return getEmployeeAlerts(employeeId).some(a => a.blocking);
}

/**
 * Compte les alertes par sévérité
 * @param {string} employeeId 
 * @returns {Object} - { info: n, warning: n, critical: n }
 */
export function countAlertsBySeverity(employeeId) {
  const alerts = getEmployeeAlerts(employeeId);
  return {
    info: alerts.filter(a => a.severity === 'info').length,
    warning: alerts.filter(a => a.severity === 'warning').length,
    critical: alerts.filter(a => a.severity === 'critical').length,
    total: alerts.length
  };
}

// ============================================================
// 3. SYSTÈME D'AUDIT
// ============================================================

const _alertAuditLog = [];

/**
 * Enregistre l'affichage d'une alerte dans les logs
 */
function _logAlertDisplay(employeeId, alertId, triggerPoint, action, timestamp = new Date()) {
  _alertAuditLog.push({
    id: `audit-${Date.now()}`,
    employeeId,
    alertId,
    triggerPoint,
    action, // 'displayed' | 'confirmed' | 'ignored' | 'blocked'
    timestamp: timestamp.toISOString()
  });
  
  // Conserver seulement les 100 derniers logs
  if (_alertAuditLog.length > 100) {
    _alertAuditLog.shift();
  }
  
  console.log(`[AlertAudit] ${action.toUpperCase()} - Alert: ${alertId} | Employee: ${employeeId} | Trigger: ${triggerPoint} | Time: ${timestamp.toLocaleTimeString()}`);
}

/**
 * Récupère l'historique d'audit
 */
export function getAlertAuditLog(filters = {}) {
  let logs = [..._alertAuditLog];
  
  if (filters.employeeId) {
    logs = logs.filter(l => l.employeeId === filters.employeeId);
  }
  if (filters.triggerPoint) {
    logs = logs.filter(l => l.triggerPoint === filters.triggerPoint);
  }
  if (filters.action) {
    logs = logs.filter(l => l.action === filters.action);
  }
  
  return logs;
}

// ============================================================
// 4. INTERFACE UTILISATEUR
// ============================================================

/**
 * Affiche les alertes d'un employé - Méthode principale
 * @param {string} employeeId 
 * @param {string} triggerPoint - Point de déclenchement
 * @param {Object} options - Options d'affichage
 * @returns {Promise<Object>} - { confirmed: bool, alerts: array }
 */
export async function checkAndShowEmployeeAlerts(employeeId, triggerPoint, options = {}) {
  const alerts = getEmployeeAlerts(employeeId);
  
  if (!alerts.length) {
    return { confirmed: true, alerts: [], blocked: false };
  }

  // Filtrer les alertes bloquantes seulement si on veut être strict
  const blockingAlerts = alerts.filter(a => a.blocking);
  const nonBlockingAlerts = alerts.filter(a => !a.blocking);

  // Si des alertes bloquantes existent, demander confirmation
  if (blockingAlerts.length > 0) {
    const confirmed = await _showBlockingAlertModal(employeeId, blockingAlerts, triggerPoint);
    _logAlertDisplay(employeeId, blockingAlerts.map(a => a.id).join(','), triggerPoint, confirmed ? 'confirmed' : 'blocked');
    
    return {
      confirmed,
      alerts,
      blocked: !confirmed,
      blockingAlerts,
      nonBlockingAlerts
    };
  }

  // Si des alertes non-bloquantes existent, afficher un résumé
  if (nonBlockingAlerts.length > 0 && options.showNonBlocking !== false) {
    _showAlertsBanner(employeeId, nonBlockingAlerts, triggerPoint);
    nonBlockingAlerts.forEach(a => _logAlertDisplay(employeeId, a.id, triggerPoint, 'displayed'));
  }

  return {
    confirmed: true,
    alerts,
    blocked: false,
    blockingAlerts: [],
    nonBlockingAlerts
  };
}

/**
 * Affiche une modal pour les alertes bloquantes
 * @private
 */
async function _showBlockingAlertModal(employeeId, blockingAlerts, triggerPoint) {
  const emp = state.employees.find(e => e.id === employeeId);
  const empName = emp?.name || 'Employé inconnu';

  const alertsHtml = blockingAlerts.map(alert => {
    const severity = ALERT_SEVERITY[alert.severity.toUpperCase()] || ALERT_SEVERITY.INFO;
    return `
      <div style="background:${severity.bgColor};border-left:4px solid ${severity.borderColor};padding:12px;margin-bottom:8px;border-radius:4px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span class="material-icons" style="font-size:20px;color:${severity.color};">${severity.icon}</span>
          <strong style="color:${severity.color};">${severity.label}</strong>
          <span style="font-size:11px;color:#94a3b8;">${formatDate(alert.date, false)}</span>
        </div>
        <p style="margin:0;font-size:14px;color:#e2e8f0;">${_escapeHtml(alert.content)}</p>
      </div>
    `;
  }).join('');

  const confirmed = await openConfirm(
    `⚠️ Alerte(s) pour ${empName}`,
    `<div style="text-align:left;">
      <p style="margin-bottom:12px;color:#f59e0b;font-weight:600;">
        Cette action nécessite une confirmation car des alertes critiques sont activas.
      </p>
      ${alertsHtml}
      <p style="margin-top:16px;color:#94a3b8;font-size:13px;">
        Cliquez sur "Confirmer" pour continuer malgré ces alertes, ou "Annuler" pour abandonner l'opération.
      </p>
    </div>`,
    'Confirmer malgré tout',
    'Annuler'
  );

  return confirmed;
}

/**
 * Affiche une bannière pour les alertes non-bloquantes
 * @private
 */
function _showAlertsBanner(employeeId, alerts, triggerPoint) {
  // Supprimer l'ancienne bannière si elle existe
  const existingBanner = document.getElementById('alertsBanner');
  if (existingBanner) existingBanner.remove();

  const emp = state.employees.find(e => e.id === employeeId);
  const empName = emp?.name || 'Employé';

  // Compter par sévérité
  const counts = {
    critical: alerts.filter(a => a.severity === 'critical').length,
    warning: alerts.filter(a => a.severity === 'warning').length,
    info: alerts.filter(a => a.severity === 'info').length
  };

  // Déterminer la sévérité max
  let maxSeverity = 'info';
  if (counts.critical > 0) maxSeverity = 'critical';
  else if (counts.warning > 0) maxSeverity = 'warning';

  const severityConfig = ALERT_SEVERITY[maxSeverity.toUpperCase()];

  const alertsList = alerts.slice(0, 3).map(alert => {
    const sev = ALERT_SEVERITY[alert.severity.toUpperCase()] || ALERT_SEVERITY.INFO;
    return `
      <div style="display:flex;align-items:flex-start;gap:8px;padding:8px;background:${sev.bgColor};border-radius:6px;margin-bottom:6px;">
        <span class="material-icons" style="font-size:16px;color:${sev.color};flex-shrink:0;">${sev.icon}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;color:${sev.color};font-weight:600;">${sev.label}</div>
          <div style="font-size:13px;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_escapeHtml(alert.content)}</div>
        </div>
      </div>
    `;
  }).join('');

  const html = `
    <div id="alertsBanner" style="
      position:fixed;top:60px;right:20px;width:320px;max-width:calc(100vw - 40px);
      background:linear-gradient(135deg,rgba(30,41,59,0.98),rgba(15,23,42,0.95));
      border:1px solid ${severityConfig.borderColor};border-radius:12px;
      box-shadow:0 8px 32px rgba(0,0,0,0.4);z-index:9990;overflow:hidden;
      animation:alertBannerSlide 0.3s ease-out;">
      <div style="background:${severityConfig.bgColor};padding:12px 16px;display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="material-icons" style="font-size:20px;color:${severityConfig.color};">${severityConfig.icon}</span>
          <span style="font-weight:700;color:${severityConfig.color};">Alertes — ${empName}</span>
        </div>
        <button onclick="this.closest('#alertsBanner').remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:20px;padding:4px;">
          ×
        </button>
      </div>
      <div style="padding:12px 16px;max-height:300px;overflow-y:auto;">
        ${alertsList}
        ${alerts.length > 3 ? `<p style="text-align:center;color:#94a3b8;font-size:12px;margin:8px 0 0;">+${alerts.length - 3} autre(s) alerte(s)</p>` : ''}
      </div>
      <div style="padding:8px 16px;border-top:1px solid rgba(148,163,184,0.1);text-align:center;">
        <small style="color:#64748b;font-size:11px;">Cliquez sur les alertes pour plus de détails</small>
      </div>
    </div>
    <style>
      @keyframes alertBannerSlide {
        from { opacity:0; transform:translateX(100%); }
        to { opacity:1; transform:translateX(0); }
      }
    </style>
  `;

  // Créer le conteneur si nécessaire
  let container = document.getElementById('alertBannerContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'alertBannerContainer';
    document.body.appendChild(container);
  }

  container.innerHTML = html;

  // Auto-dismiss après 8 secondes
  setTimeout(() => {
    const banner = document.getElementById('alertsBanner');
    if (banner) {
      banner.style.animation = 'alertBannerFade 0.3s ease-out forwards';
      setTimeout(() => banner.remove(), 300);
    }
  }, 8000);
}

/**
 * Affiche un modal détaillé pour toutes les alertes d'un employé
 * @param {string} employeeId 
 */
export function showFullAlertsModal(employeeId) {
  const alerts = getEmployeeAlerts(employeeId);
  if (!alerts.length) return;

  const emp = state.employees.find(e => e.id === employeeId);
  const empName = emp?.name || 'Employé';

  const alertsHtml = alerts.map(alert => {
    const severity = ALERT_SEVERITY[alert.severity.toUpperCase()] || ALERT_SEVERITY.INFO;
    const blockingBadge = alert.blocking 
      ? `<span style="background:rgba(239,68,68,0.2);color:#ef4444;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">BLOQUANT</span>` 
      : '';
    
    return `
      <div style="background:${severity.bgColor};border-left:4px solid ${severity.borderColor};padding:12px;margin-bottom:10px;border-radius:4px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="material-icons" style="font-size:20px;color:${severity.color};">${severity.icon}</span>
            <strong style="color:${severity.color};">${severity.label}</strong>
            <span style="font-size:11px;color:#94a3b8;">${formatDate(alert.date, false)}</span>
          </div>
          ${blockingBadge}
        </div>
        <p style="margin:0;font-size:14px;color:#e2e8f0;white-space:pre-wrap;">${_escapeHtml(alert.content)}</p>
        ${alert.createdAt ? `<small style="color:#64748b;font-size:11px;margin-top:4px;display:block;">Créé le ${new Date(alert.createdAt).toLocaleString()}</small>` : ''}
      </div>
    `;
  }).join('');

  // Créer ou mettre à jour le modal
  let modal = document.getElementById('employeeAlertsModal');
  if (modal) modal.remove();

  const modalHtml = `
    <div id="employeeAlertsModal" style="
      position:fixed;top:0;left:0;width:100%;height:100%;
      background:rgba(15,23,42,0.8);backdrop-filter:blur(4px);
      display:flex;align-items:center;justify-content:center;z-index:99999;
      animation:fadeIn 0.2s ease-out;">
      <div style="
        background:linear-gradient(135deg,rgba(30,41,59,0.98),rgba(15,23,42,0.95));
        border:1px solid rgba(148,163,184,0.2);border-radius:16px;
        width:90%;max-width:600px;max-height:85vh;overflow:hidden;
        box-shadow:0 20px 60px rgba(0,0,0,0.5);
        animation:slideUp 0.3s cubic-bezier(0.34,1.56,0.64,1);">
        
        <div style="padding:20px 24px;border-bottom:1px solid rgba(148,163,184,0.1);display:flex;align-items:center;justify-content:space-between;">
          <h2 style="margin:0;font-size:1.3rem;color:#e2e8f0;display:flex;align-items:center;gap:10px;">
            <span class="material-icons" style="color:#ef4444;">notifications_active</span>
            Alertes — ${empName}
            <span style="background:rgba(239,68,68,0.2);color:#ef4444;padding:2px 10px;border-radius:12px;font-size:13px;font-weight:600;">
              ${alerts.length}
            </span>
          </h2>
          <button onclick="document.getElementById('employeeAlertsModal').remove()" style="
            background:none;border:none;color:#94a3b8;cursor:pointer;font-size:28px;padding:4px;line-height:1;">
            ×
          </button>
        </div>
        
        <div style="padding:20px 24px;max-height:calc(85vh - 140px);overflow-y:auto;">
          ${alertsHtml}
        </div>
        
        <div style="padding:16px 24px;border-top:1px solid rgba(148,163,184,0.1);text-align:center;">
          <small style="color:#64748b;font-size:12px;">
            Ces alertes seront affichées lors des opérations impliquant cet employé.
          </small>
        </div>
      </div>
    </div>
    <style>
      @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
      @keyframes slideUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
    </style>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  // Fermer en cliquant sur l'overlay
  document.getElementById('employeeAlertsModal').addEventListener('click', (e) => {
    if (e.target.id === 'employeeAlertsModal') {
      document.getElementById('employeeAlertsModal').remove();
    }
  });
}

// ============================================================
// 5. FONCTIONS DE VALIDATION RAPIDE
// ============================================================

/**
 * Valide une action en vérifiant les alertes bloquantes
 * Retourne true si l'action peut continuer, false sinon
 */
export async function validateAction(employeeId, triggerPoint) {
  const result = await checkAndShowEmployeeAlerts(employeeId, triggerPoint);
  return result.confirmed;
}

/**
 * Récupère un résumé rapide des alertes
 */
export function getAlertsSummary(employeeId) {
  const counts = countAlertsBySeverity(employeeId);
  if (counts.total === 0) return null;

  const parts = [];
  if (counts.critical > 0) parts.push(`${counts.critical} critique(s)`);
  if (counts.warning > 0) parts.push(`${counts.warning} avertissement(s)`);
  if (counts.info > 0) parts.push(`${counts.info} info(s)`);

  return {
    count: counts.total,
    summary: parts.join(', '),
    hasBlocking: hasBlockingAlerts(employeeId)
  };
}

// ============================================================
// 6. HELPERS
// ============================================================

function _escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}

// ============================================================
// 7. EXPORTS PUBLICS
// ============================================================

window._alertSystem = {
  checkAlerts: checkAndShowEmployeeAlerts,
  getAlerts: getEmployeeAlerts,
  getSummary: getAlertsSummary,
  showModal: showFullAlertsModal,
  validateAction,
  auditLog: getAlertAuditLog
};
