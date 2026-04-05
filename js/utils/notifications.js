/**
 * ============================================================
 * Système de Notifications Natif (HTML/CSS/JS)
 * Remplace SweetAlert2 par une implémentation simple et robuste
 * ============================================================
 */

// ============================================================
// 1. DIALOG SYSTEM (Confirmation & Alerts)
// ============================================================

let currentDialog = null;

/**
 * Affiche un dialog de confirmation
 * @param {string} title - Titre du dialog
 * @param {string} message - Message HTML
 * @param {string} confirmText - Texte bouton confirmer
 * @param {string} cancelText - Texte bouton annuler
 * @returns {Promise<boolean>} - true si confirmé, false sinon
 */
async function openConfirm(title, message, confirmText = 'Confirmer', cancelText = 'Annuler') {
    return new Promise((resolve) => {
        // Nettoyer les dialogs précédents
        closeDialog();

        // Créer le dialog
        const dialogHTML = `
            <div id="native-dialog-overlay" class="native-dialog-overlay">
                <div class="native-dialog">
                    <div class="native-dialog-header">
                        <h2>${title}</h2>
                        <button class="native-dialog-close" aria-label="Fermer">&times;</button>
                    </div>
                    <div class="native-dialog-body">
                        ${message}
                    </div>
                    <div class="native-dialog-footer">
                        <button class="native-btn native-btn-secondary" data-action="cancel">${cancelText}</button>
                        <button class="native-btn native-btn-primary" data-action="confirm">${confirmText}</button>
                    </div>
                </div>
            </div>
        `;

        // Injecter dans le DOM
        const container = document.getElementById('dialogContainer') || document.body;
        const fragment = document.createElement('div');
        fragment.innerHTML = dialogHTML;
        const dialog = fragment.firstElementChild;
        container.appendChild(dialog);
        currentDialog = dialog;

        // Gestionnaires d'événements
        const handleClose = () => {
            resolve(false);
            closeDialog();
        };

        const handleConfirm = () => {
            resolve(true);
            closeDialog();
        };

        const closeBtn = dialog.querySelector('.native-dialog-close');
        const cancelBtn = dialog.querySelector('[data-action="cancel"]');
        const confirmBtn = dialog.querySelector('[data-action="confirm"]');
        const overlay = dialog.querySelector('.native-dialog-overlay');

        // Fermeture via croix
        closeBtn?.addEventListener('click', handleClose, { once: true });

        // Fermeture via bouton Annuler
        cancelBtn?.addEventListener('click', handleClose, { once: true });

        // Fermeture via bouton Confirmer
        confirmBtn?.addEventListener('click', handleConfirm, { once: true });

        // Fermeture via clic sur overlay
        overlay?.addEventListener('click', (e) => {
            if (e.target === overlay) {
                handleClose();
            }
        }, { once: true });

        // Fermeture via Escape
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                document.removeEventListener('keydown', handleEscape);
                handleClose();
            }
        };
        document.addEventListener('keydown', handleEscape);

        // Focus du premier bouton
        setTimeout(() => confirmBtn?.focus(), 100);
    });
}

/**
 * Alerte simple
 * @param {string} title - Titre
 * @param {string} message - Message
 * @param {string} type - 'success', 'error', 'warning', 'info'
 * @returns {Promise<void>}
 */
async function openAlert(title, message, type = 'info') {
    return new Promise((resolve) => {
        closeDialog();

        const iconMap = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'i',
        };

        const icon = iconMap[type] || 'ℹ';

        const dialogHTML = `
            <div id="native-dialog-overlay" class="native-dialog-overlay">
                <div class="native-dialog native-dialog-${type}">
                    <div class="native-dialog-icon">${icon}</div>
                    <div class="native-dialog-header" style="margin-top: 0;">
                        <h2>${title}</h2>
                    </div>
                    <div class="native-dialog-body">
                        ${message}
                    </div>
                    <div class="native-dialog-footer">
                        <button class="native-btn native-btn-primary" data-action="close">Fermer</button>
                    </div>
                </div>
            </div>
        `;

        const container = document.getElementById('dialogContainer') || document.body;
        const fragment = document.createElement('div');
        fragment.innerHTML = dialogHTML;
        const dialog = fragment.firstElementChild;
        container.appendChild(dialog);
        currentDialog = dialog;

        const handleClose = () => {
            resolve();
            closeDialog();
        };

        const closeBtn = dialog.querySelector('[data-action="close"]');
        const overlay = dialog.querySelector('.native-dialog-overlay');

        closeBtn?.addEventListener('click', handleClose, { once: true });
        overlay?.addEventListener('click', (e) => {
            if (e.target === overlay) handleClose();
        }, { once: true });

        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                document.removeEventListener('keydown', handleEscape);
                handleClose();
            }
        };
        document.addEventListener('keydown', handleEscape);

        setTimeout(() => closeBtn?.focus(), 100);
    });
}

/**
 * Ferme le dialog courant
 */
function closeDialog() {
    if (currentDialog) {
        currentDialog.style.animation = 'nativeDialogFadeOut 0.2s ease-out forwards';
        setTimeout(() => {
            currentDialog?.remove();
            currentDialog = null;
        }, 200);
    }
}

// ============================================================
// 2. TOAST SYSTEM (Notifications temporaires)
// ============================================================

/**
 * Affiche une notification toast (coin bas-droit)
 * @param {string} message - Message
 * @param {string} type - 'success', 'error', 'warning', 'info'
 * @param {number} duration - Durée en ms (0 = manuel)
 */
function showToast(message, type = 'info', duration = 3000) {
    const iconMap = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ',
    };

    const icon = iconMap[type] || 'ℹ';

    const toastHTML = `
        <div class="native-toast native-toast-${type}">
            <div class="native-toast-icon">${icon}</div>
            <div class="native-toast-message">${message}</div>
            <button class="native-toast-close" aria-label="Fermer" style="opacity: 0.6; cursor: pointer;">&times;</button>
        </div>
    `;

    const container = document.getElementById('toastContainer') || document.body;
    const fragment = document.createElement('div');
    fragment.innerHTML = toastHTML;
    const toast = fragment.firstElementChild;
    container.appendChild(toast);

    // Auto-dismiss
    let timeoutId = null;

    const dismiss = () => {
        if (timeoutId) clearTimeout(timeoutId);
        toast.style.animation = 'nativeToastSlideOut 0.3s ease-out forwards';
        setTimeout(() => toast.remove(), 300);
    };

    const closeBtn = toast.querySelector('.native-toast-close');
    closeBtn?.addEventListener('click', dismiss);

    // Pause timer on hover
    if (duration > 0) {
        const pause = () => {
            if (timeoutId) clearTimeout(timeoutId);
        };
        const resume = () => {
            timeoutId = setTimeout(dismiss, duration);
        };

        toast.addEventListener('mouseenter', pause);
        toast.addEventListener('mouseleave', resume);

        timeoutId = setTimeout(dismiss, duration);
    }

    // Cleanup on page unload
    const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        toast.remove();
    };
    window.addEventListener('beforeunload', cleanup, { once: true });
}

export {
    openConfirm,
    openAlert,
    showToast,
};
