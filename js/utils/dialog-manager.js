// ============================================================
// js/utils/dialog-manager.js — Gestionnaire centralisé de dialogs
// Système unifié pour tous les dialogs/modals/alertes
// ============================================================

/**
 * Configuration centralisée des dialogs
 * Utilise SweetAlert2 pour cohérence et professionnalisme
 */

const DialogConfig = {
  // Thème et couleurs selon le type
  types: {
    confirmation: {
      icon: 'question',
      cancelButton: true,
      dangerMode: false,
      confirmColor: '#6750A4',
    },
    danger: {
      icon: 'warning',
      cancelButton: true,
      dangerMode: true,
      confirmColor: '#EF4444',
    },
    success: {
      icon: 'success',
      cancelButton: false,
      dangerMode: false,
      confirmColor: '#10B981',
    },
    error: {
      icon: 'error',
      cancelButton: false,
      dangerMode: false,
      confirmColor: '#EF4444',
    },
    info: {
      icon: 'info',
      cancelButton: false,
      dangerMode: false,
      confirmColor: '#6750A4',
    },
    warning: {
      icon: 'warning',
      cancelButton: false,
      dangerMode: false,
      confirmColor: '#F59E0B',
    },
  },

  // Styles globaux pour tous les dialogs
  defaultConfig: {
    background: 'rgba(30,41,59,0.95)',
    color: '#E2E8F0',
    backdrop: true,
    allowOutsideClick: true,
    allowEscapeKey: true,
  },
};

/**
 * Dialogue de confirmation
 * @param {string} title - Titre du dialog
 * @param {string} message - Message détaillé
 * @param {string} confirmText - Texte du bouton de confirmation
 * @param {string} cancelText - Texte du bouton d'annulation
 * @param {Object} options - Options supplémentaires (icon, isDanger, etc.)
 * @returns {Promise<boolean>} - True si confirmé, false sinon
 */
export async function openConfirm(
    title,
    message,
    confirmText = 'Confirmer',
    cancelText = 'Annuler',
    options = {}
) {
    const isDanger = options.isDanger || false;
    const typeConfig = isDanger ? DialogConfig.types.danger : DialogConfig.types.confirmation;
    
    const result = await Swal.fire({
        ...DialogConfig.defaultConfig,
        title,
        html: formatDialogMessage(message, options.context),
        icon: typeConfig.icon,
        showCancelButton: true,
        confirmButtonText: confirmText,
        cancelButtonText: cancelText,
        confirmButtonColor: typeConfig.confirmColor,
        cancelButtonColor: '#6B7280',
        allowOutsideClick: !isDanger,
        allowEscapeKey: !isDanger,
        showLoaderOnConfirm: false,
        customClass: {
            container: 'dialog-container',
            popup: 'dialog-popup',
            header: 'dialog-header',
            title: 'dialog-title',
            closeButton: 'dialog-close',
            content: 'dialog-content',
            confirmButton: 'dialog-confirm-btn',
            cancelButton: 'dialog-cancel-btn',
        },
    });

    // Retirer les classes CSS que Swal2 injecte sur <html> et <body>
    // (ne sont pas retirées si le cycle didClose est interrompu)
    document.documentElement.classList.remove(
        'swal2-shown', 'swal2-height-auto', 'swal2-no-backdrop', 'swal2-toast-shown'
    );
    document.body.classList.remove(
        'swal2-shown', 'swal2-height-auto', 'swal2-no-backdrop', 'swal2-toast-shown'
    );
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';

    return result.isConfirmed === true;
}

/**
 * Alerte simple (succès, erreur, info, warning)
 * @param {string} title - Titre du dialog
 * @param {string} message - Message détaillé
 * @param {string} type - Type d'alerte ('success', 'error', 'info', 'warning')
 * @param {Object} options - Options supplémentaires
 */
export async function openAlert(title, message, type = 'info', options = {}) {
  const typeConfig = DialogConfig.types[type] || DialogConfig.types.info;

  return await Swal.fire({
    ...DialogConfig.defaultConfig,
    title,
    html: formatDialogMessage(message, options.context),
    icon: typeConfig.icon,
    confirmButtonText: options.confirmText || 'Fermer',
    confirmButtonColor: typeConfig.confirmColor,
    customClass: {
      container: 'dialog-container',
      popup: 'dialog-popup',
      title: 'dialog-title',
      content: 'dialog-content',
      confirmButton: 'dialog-confirm-btn',
    },
  });
}

/**
 * Dialog avec 3 options (Oui / Non / Annuler)
 * @param {string} title - Titre
 * @param {string} message - Message
 * @param {Object} options - Configuration
 * @returns {Promise<string>} - 'yes', 'no', 'cancel'
 */
export async function openChoice(title, message, options = {}) {
  const result = await Swal.fire({
    ...DialogConfig.defaultConfig,
    title,
    html: formatDialogMessage(message, options.context),
    icon: 'question',
    showDenyButton: true,
    showCancelButton: true,
    confirmButtonText: options.yesText || 'Oui',
    denyButtonText: options.noText || 'Non',
    cancelButtonText: options.cancelText || 'Annuler',
    confirmButtonColor: '#10B981',
    denyButtonColor: '#F59E0B',
    cancelButtonColor: '#6B7280',
    // Bloquer clic dehors si action critique
    allowOutsideClick: options.critical !== true,
    allowEscapeKey: options.critical !== true,
    customClass: {
      container: 'dialog-container',
      popup: 'dialog-popup',
      title: 'dialog-title',
      content: 'dialog-content',
      confirmButton: 'dialog-confirm-btn',
      denyButton: 'dialog-deny-btn',
      cancelButton: 'dialog-cancel-btn',
    },
  });

  if (result.isConfirmed) return 'yes';
  if (result.isDenied) return 'no';
  return 'cancel';
}

/**
 * Dialog de suppression (formulé pour action destructrice)
 * @param {string} itemName - Nom de l'élément à supprimer
 * @param {string} context - Contexte additionnel (optional)
 * @returns {Promise<boolean>} - True si confirmé
 */
export async function openDelete(itemName, context = '') {
  const message = context
    ? `Êtes-vous sûr de vouloir supprimer <strong>${itemName}</strong>?<br/><small style="color:#A0AEC0;">${context}</small>`
    : `Êtes-vous sûr de vouloir supprimer <strong>${itemName}</strong>? Cette action est irréversible.`;

  return await openConfirm(
    'Confirmation de suppression',
    message,
    'Supprimer',
    'Annuler',
    { isDanger: true }
  );
}

/**
 * Dialog de chargement (loading/progress)
 * @param {string} title - Titre
 * @param {string} message - Message
 * @returns {Promise<void>}
 */
export function showLoading(title = 'Traitement en cours...', message = 'Veuillez patienter') {
  Swal.fire({
    ...DialogConfig.defaultConfig,
    title,
    html: message,
    icon: 'info',
    allowOutsideClick: false,
    allowEscapeKey: false,
    customClass: {
      popup: 'swal2-loading-dialog',  // Classe unique pour identification sûre
    },
    didOpen: () => {
      Swal.showLoading();
    },
  });
}

/**
 * Ferme le dialog de chargement
 * Nettoie les classes et styles résiduels de Swal2 sans interrompre son cycle interne.
 */
export function hideLoading() {
  // Retire toutes les classes et styles résiduels de Swal2
  const _cleanupSwalState = () => {
    document.documentElement.classList.remove(
      'swal2-shown', 'swal2-height-auto', 'swal2-no-backdrop', 'swal2-toast-shown'
    );
    document.body.classList.remove(
      'swal2-shown', 'swal2-height-auto', 'swal2-no-backdrop', 'swal2-toast-shown'
    );
    document.body.style.overflow     = '';
    document.body.style.paddingRight = '';
    document.documentElement.style.overflow = '';
  };

  try {
    Swal.hideLoading();

    // ① Neutraliser IMMÉDIATEMENT les pointer-events de tout container Swal2
    //    encore présent dans le DOM — sans le supprimer (ce qui casserait le
    //    cycle didClose de Swal2 et laisserait overflow:hidden sur <html>).
    document.querySelectorAll('.swal2-container').forEach(el => {
      el.style.pointerEvents = 'none';
    });

    const loadingDialog = document.querySelector('.swal2-loading-dialog');

    if (loadingDialog) {
      loadingDialog.style.transition = 'opacity 0.15s ease-out';
      loadingDialog.style.opacity = '0';

      setTimeout(() => {
        try { Swal.close(); } catch (e) { /* déjà fermé */ }

        // ② Après la fin de l'animation Swal2 (~300ms), nettoyer les classes
        //    CSS qu'il injecte sur <html>/<body> (swal2-shown → overflow:hidden)
        setTimeout(_cleanupSwalState, 300);
      }, 150);

    } else {
      const anyDialog = document.querySelector('.swal2-container');
      if (anyDialog && anyDialog.style.opacity !== '0') {
        Swal.close();
      }

      setTimeout(_cleanupSwalState, 300);
    }

  } catch (err) {
    console.warn('[hideLoading]', err.message);
    // Nettoyage d'urgence synchrone
    document.querySelectorAll('.swal2-container').forEach(el => {
      el.style.pointerEvents = 'none';
    });
    _cleanupSwalState();
  }
}

/**
 * Toast notification (petit message coin bas-droit)
 * IMPORTANT: Cette fonction gère correctement le cycle de vie du toast
 * @param {string} message - Message
 * @param {string} type - Type ('success', 'error', 'info', 'warning')
 * @param {number} duration - Durée en ms (0 = manuel, pas d'auto-dismiss)
 */
export function showToast(message, type = 'info', duration = 3000) {
    const typeConfig = DialogConfig.types[type] || DialogConfig.types.info;
    let toastElement = null;
    
    return Swal.fire({
        toast: true,
        position: 'bottom-end',
        icon: typeConfig.icon,
        title: message,
        showConfirmButton: false,
        timer: duration > 0 ? duration : undefined,
        timerProgressBar: duration > 0,
        background: 'rgba(30,41,59,0.95)',
        color: '#E2E8F0',
        didOpen: (element) => {
            toastElement = element;
            if (duration <= 0) return;
            
            const stopTimer = () => Swal.stopTimer();
            const resumeTimer = () => Swal.resumeTimer();
            
            element.addEventListener('mouseenter', stopTimer, { passive: true });
            element.addEventListener('mouseleave', resumeTimer, { passive: true });
            
            element._swalToastCleanup = { stopTimer, resumeTimer };
        },
        willClose: () => {
            if (toastElement && toastElement._swalToastCleanup) {
                const { stopTimer, resumeTimer } = toastElement._swalToastCleanup;
                try {
                    toastElement.removeEventListener('mouseenter', stopTimer);
                    toastElement.removeEventListener('mouseleave', resumeTimer);
                } catch (err) {
                    console.warn('[showToast]', err.message);
                }
                delete toastElement._swalToastCleanup;
            }
        },
        customClass: {
            popup: 'dialog-toast',
            title: 'dialog-toast-text',
        },
    });
}

/**
 * Notification temporaire améliorée (remplace les anciennes alertes)
 * Auto-dismiss après un délai avec animation fluide
 * @param {string} message - Message à afficher
 * @param {string} type - Type ('success', 'error', 'info', 'warning')
 * @param {number} duration - Durée d'affichage en ms (défaut: 3000)
 * @param {Object} options - Options { position, closable, onClose }
 */
export function showNotification(message, type = 'info', duration = 3000, options = {}) {
    const position = options.position || 'top-right';
    const closable = options.closable !== false;
    let notificationElement = null;
    const typeConfig = DialogConfig.types[type] || DialogConfig.types.info;
    
    const closeButton = closable
        ? `<button onclick="Swal.close();" style="background:none;border:none;color:inherit;cursor:pointer;padding:0;font-size:20px;line-height:1;display:flex;align-items:center;"> <span class="material-icons" style="font-size:20px;">close</span> </button>`
        : '';
    
    return Swal.fire({
        toast: true,
        position: position,
        icon: typeConfig.icon,
        title: closable ? '' : message,
        html: closable
            ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;"> <span style="flex:1;text-align:left;">${message}</span> ${closeButton} </div>`
            : undefined,
        showConfirmButton: false,
        timer: duration > 0 ? duration : undefined,
        timerProgressBar: duration > 0,
        background: 'rgba(30,41,59,0.95)',
        color: '#E2E8F0',
        didOpen: (element) => {  // CORRIGÉ: => sans espace
            notificationElement = element;
            element.classList.add('notification-toast-animated');
            if (duration <= 0) return;
            
            const stopTimer = () => Swal.stopTimer();
            const resumeTimer = () => Swal.resumeTimer();
            
            element.addEventListener('mouseenter', stopTimer, { passive: true });
            element.addEventListener('mouseleave', resumeTimer, { passive: true });
            
            element._swalNotificationCleanup = {
                element,
                stopTimer,
                resumeTimer,
            };
        },
        willClose: () => {
            const cleanup = notificationElement?._swalNotificationCleanup;
            if (cleanup) {
                const { element, stopTimer, resumeTimer } = cleanup;
                try {
                    element.removeEventListener('mouseenter', stopTimer);
                    element.removeEventListener('mouseleave', resumeTimer);
                } catch (err) {
                    console.warn('[showNotification cleanup]', err.message);
                }
                delete element._swalNotificationCleanup;
            }
            
            if (options.onClose) {
                try {
                    options.onClose();
                } catch (err) {
                    console.warn('[showNotification onClose callback]', err.message);
                }
            }
            return true;
        },
        customClass: {
            popup: `dialog-toast notification-toast notification-${type}`,
            title: 'dialog-toast-text',
            timerProgressBar: 'dialog-toast-timer',
        },
    });
}

/**
 * Format du message avec contexte optionnel
 * @private
 */
function formatDialogMessage(message, context = '') {
  let html = `<div style="text-align:left; line-height:1.6; font-size:15px; color:#CBD5E1;">`;
  html += message;
  if (context) {
    html += `<div style="margin-top:12px; padding:12px; background:rgba(103,80,164,0.1); border-left:3px solid #6750A4; border-radius:4px; font-size:13px; color:#A0AEC0;">`;
    html += context;
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

/**
 * Gère l'état de chargement des boutons (disable/spinner/loading text)
 * Utile pour les opérations asynchrones longues
 * @param {HTMLElement} button - Le bouton à modifier
 * @param {boolean} isLoading - État de chargement (true = loading, false = normal)
 * @param {Object} options - Options { originalText, loadingText, spinner }
 */
export function setButtonLoading(button, isLoading = true, options = {}) {
  if (!button) return;

  const originalText = options.originalText || button.textContent;
  const loadingText = options.loadingText || 'Chargement...';
  const showSpinner = options.spinner !== false;

  if (isLoading) {
    button.disabled = true;
    button.dataset.originalText = originalText;
    button.style.opacity = '0.6';
    button.style.cursor = 'not-allowed';

    if (showSpinner) {
      button.innerHTML = `<span class="material-icons" style="font-size:18px;vertical-align:middle;animation:spin 1s linear infinite;display:inline-block;margin-right:8px;">hourglass_empty</span>${loadingText}`;
    } else {
      button.textContent = loadingText;
    }
  } else {
    button.disabled = false;
    button.style.opacity = '1';
    button.style.cursor = 'pointer';
    button.textContent = button.dataset.originalText || originalText;
  }
}

/**
 * Wrapper pour exécuter une fonction async avec état de chargement sur un bouton
 * @param {Function} asyncFn - La fonction async à exécuter
 * @param {HTMLElement} button - Le bouton à modifier
 * @param {Object} options - Options { originalText, loadingText, onError, onSuccess }
 * @returns {Promise<any>} - Le résultat de la fonction
 */
export async function executeWithButtonLoading(asyncFn, button, options = {}) {
  const originalText = options.originalText || button.textContent;

  try {
    setButtonLoading(button, true, {
      originalText,
      loadingText: options.loadingText || 'Traitement...',
      spinner: options.spinner !== false,
    });

    const result = await asyncFn();

    if (options.onSuccess) options.onSuccess(result);
    setButtonLoading(button, false, { originalText });
    return result;
  } catch (error) {
    console.error('[ButtonLoading] Erreur:', error);
    if (options.onError) options.onError(error);
    setButtonLoading(button, false, { originalText });
    throw error;
  }
}

/**
 * Gère l'état de chargement d'un formulaire entier
 * @param {HTMLFormElement} form - Le formulaire
 * @param {boolean} isLoading - État de chargement
 * @param {string} loadingText - Texte du bouton pendant le chargement
 */
export function setFormLoading(form, isLoading = true, loadingText = 'Chargement...') {
  if (!form) return;

  const inputs = form.querySelectorAll('input, select, textarea, button:not([type="reset"])');

  inputs.forEach((input) => {
    if (input.type === 'button' || input.type === 'submit') {
      setButtonLoading(input, isLoading, {
        originalText: input.textContent,
        loadingText,
      });
    } else if (isLoading) {
      input.disabled = true;
      input.style.opacity = '0.6';
    } else {
      input.disabled = false;
      input.style.opacity = '1';
    }
  });
}

/**
 * Crée un spinner HTML réutilisable
 * @param {string} size - 'small' | 'medium' | 'large'
 * @param {string} color - Couleur CSS
 * @returns {string} - HTML du spinner
 */
export function createSpinner(size = 'medium', color = '#6750A4') {
  const sizes = {
    small: 20,
    medium: 40,
    large: 60,
  };
  const dim = sizes[size] || sizes.medium;

  return `<div style="display:inline-block;width:${dim}px;height:${dim}px;border:3px solid rgba(103,80,164,.3);border-top-color:${color};border-radius:50%;animation:spin 1s linear infinite;"></div>`;
}

/**
 * Export des fonctions pour compatibilité avec ancien showAlert
 * @deprecated Utiliser les nouvelles fonctions
 */
export async function showAlert(message, type = 'info', title = '') {
  // Rétrocompatibilité avec l'ancien système
  if (!title) title = type === 'success' ? 'Succès' : type === 'error' ? '❌ Erreur' : 'ℹ️ Information';
  return await openAlert(title, message, type);
}

/**
 * Fonction défensive pour nettoyer l'état de Swal2 en cas de blocage
 * À utiliser UNIQUEMENT en dernier recours si un dialog reste bloqué
 * @private
 */
export function _emergencyCleanupSwal() {
  try {
    console.warn('[EMERGENCY CLEANUP] Swal2 state reset');
    
    // Étape 1: Fermer tous les dialogs
    Swal.close();
    
    // Étape 2: Réinitialiser le loader
    Swal.hideLoading();
    
    // Étape 3: Nettoyer les listeners résiduels sur tous les toasts/notifications
    document.querySelectorAll('.swal2-popup').forEach(el => {
      const cleanup = el._swalToastCleanup || el._swalNotificationCleanup || el._swalHandlers;
      if (cleanup) {
        const { stopTimer, resumeTimer } = cleanup;
        if (stopTimer) el.removeEventListener('mouseenter', stopTimer, false);
        if (resumeTimer) el.removeEventListener('mouseleave', resumeTimer, false);
        delete el._swalToastCleanup;
        delete el._swalNotificationCleanup;
        delete el._swalHandlers;
      }
    });
    
    // Étape 4: Nettoyer les classes et styles résiduels
    document.querySelectorAll('.swal2-popup').forEach(el => {
      el.style.opacity = '0';
      el.style.pointer = 'none';
      setTimeout(() => el.remove(), 100);
    });
    
    // Étape 5: Réactiver tous les éléments bloqués
    document.querySelectorAll('button[disabled], input[disabled]').forEach(el => {
      // Ne réactiver que les éléments non essentiels
      if (!el.classList.contains('swal2-styled')) {
        el.disabled = false;
        el.style.opacity = '1';
        el.style.cursor = 'pointer';
      }
    });
    
    console.warn('[EMERGENCY CLEANUP] Complete');
  } catch (err) {
    console.error('[EMERGENCY CLEANUP] Failed:', err);
  }
}

// Expose emergency cleanup for console use during debugging
window._emergencyCleanupSwal = _emergencyCleanupSwal;

/**
 * Force la fermeture de TOUT dialog Swal2 ouvert
 * À utiliser en cas de blocage UI
 */
export function forceCloseAllDialogs() {
    try {
        Swal.close();
        Swal.hideLoading();
        document.querySelectorAll('.swal2-container').forEach(el => {
            el.style.display = 'none';
            setTimeout(() => el.remove(), 100);
        });
    } catch (err) {
        console.warn('[forceCloseAllDialogs]', err);
    }
}

export default {
  openConfirm,
  openAlert,
  openChoice,
  openDelete,
  showLoading,
  hideLoading,
  showToast,
  showNotification,
  setButtonLoading,
  executeWithButtonLoading,
  setFormLoading,
  createSpinner,
  showAlert, // Rétrocompatibilité
  _emergencyCleanupSwal, // Debug/emergency use only
};
