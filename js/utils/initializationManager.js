/**
 * ============================================================
 * initializationManager.js — Gestion centralisée de l'initialisation
 * Avec timeout, retry, et state tracking
 * ============================================================
 */

export class InitializationManager {
    constructor(timeoutMs = 15000) {
        this.timeoutMs = timeoutMs;
        this.startTime = null;
        this.timeoutId = null;
        this.statusElement = null;
        this.callbacks = {
            onStep: [],
            onSuccess: [],
            onError: [],
        };
    }

    /**
     * Met à jour le UI avec le statut courant
     */
    updateUI(step, message, type = 'info') {
        const elapsed = this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0;
        const prefix = {
            info: 'ℹ️',
            success: '✅',
            error: '❌',
            warning: '⚠️',
        }[type] || 'ℹ️';

        const fullMessage = `${prefix} ${message}${elapsed > 0 ? ` (${elapsed}s)` : ''}`;
        
        if (this.statusElement) {
            this.statusElement.innerHTML = `<span style="display: inline-block; animation: pulse 1s infinite;">${fullMessage}</span>`;
        }

        console.log(fullMessage);
        
        // Appeler les callbacks
        this.callbacks.onStep.forEach(cb => cb(step, message, type));
    }

    /**
     * Lance l'initialisation avec gestion robuste du timeout
     */
    async initialize(initFunction) {
        this.startTime = Date.now();
        this.statusElement = document.getElementById('dbStatusText');

        try {
            this.updateUI('startup', 'Initialisation en cours...', 'info');
            
            // Créer une promise avec timeout
            const promise = Promise.resolve(initFunction());
            const timeoutPromise = new Promise((_, reject) =>
                (this.timeoutId = setTimeout(() => {
                    reject(new Error(`Initialisation timeout après ${this.timeoutMs / 1000}s`));
                }, this.timeoutMs))
            );

            await Promise.race([promise, timeoutPromise]);
            
            clearTimeout(this.timeoutId);
            this.updateUI('complete', 'Initialisation réussie!', 'success');
            this.callbacks.onSuccess.forEach(cb => cb());
            
            return { success: true };

        } catch (err) {
            clearTimeout(this.timeoutId);
            const message = err.message || 'Erreur inconnue';
            this.updateUI('error', `Erreur: ${message}`, 'error');
            this.callbacks.onError.forEach(cb => cb(err));
            
            return { success: false, error: err };
        }
    }

    /**
     * S'abonner aux changements d'étape
     */
    onStep(callback) {
        this.callbacks.onStep.push(callback);
    }

    /**
     * S'abonner à la réussite
     */
    onSuccess(callback) {
        this.callbacks.onSuccess.push(callback);
    }

    /**
     * S'abonner aux erreurs
     */
    onError(callback) {
        this.callbacks.onError.push(callback);
    }
}

export default InitializationManager;
