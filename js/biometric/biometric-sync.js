// ============================================================
// biometric/biometric-sync.js
// Synchronisation bidirectionnelle :
//   - Pointages reçus du device → IndexedDB (format présence existant)
//   - Employés locaux → périphérique réseau
//   - Rattrapage des événements offline
// ============================================================

import { state, saveAttendanceData } from '../state.js';
import { biometricService }          from './biometric-service.js';
import { biometricAPI }              from './biometric-api.js';
import { showToast }                 from '../utils/notifications.js';

// ============================================================
// Constantes
// ============================================================

const SYNC_KEY    = 'biometric_last_sync';
const QUEUE_KEY   = 'biometric_pending_queue';

// ============================================================
// BiometricSync
// ============================================================

export class BiometricSync {
  constructor() {
    this._listening     = false;
    this._abortCtrl     = null;
    this._pendingQueue  = this._loadQueue();
    this._onFingerprint = this._onFingerprint.bind(this);
    this._onError       = this._onError.bind(this);
  }

  // ── API publique ─────────────────────────────────────────

  /**
   * Démarre la synchronisation en temps réel.
   * Écoute les événements du BiometricService et les persiste.
   */
  start() {
    if (this._listening) return;
    this._listening = true;

    biometricService.addEventListener('fingerprint', this._onFingerprint);
    biometricService.addEventListener('biometric-error', this._onError);

    console.log('[BiometricSync] Synchronisation démarrée');
  }

  /**
   * Arrête la synchronisation
   */
  stop() {
    this._listening = false;
    biometricService.removeEventListener('fingerprint', this._onFingerprint);
    biometricService.removeEventListener('biometric-error', this._onError);
    this._abortCtrl?.abort();
    console.log('[BiometricSync] Synchronisation arrêtée');
  }

  /**
   * Rattrapage des événements stockés sur le périphérique réseau
   * depuis la dernière synchronisation connue.
   * @returns {Promise<{ imported: number, duplicates: number, errors: number }>}
   */
  async catchUp() {
    const lastSync = this._getLastSyncDate();
    const events   = await biometricAPI.fetchRemoteEvents({ from: lastSync });

    if (!events.length) return { imported: 0, duplicates: 0, errors: 0 };

    let imported = 0, duplicates = 0, errors = 0;

    for (const event of events) {
      try {
        const result = await this._persistAttendance(event.employeeId, event.timestamp, { catchUp: true });
        if (result === 'duplicate') duplicates++;
        else imported++;
      } catch {
        errors++;
      }
    }

    this._setLastSyncDate(new Date());
    console.log(`[BiometricSync] Rattrapage : ${imported} importés, ${duplicates} doublons, ${errors} erreurs`);
    return { imported, duplicates, errors };
  }

  /**
   * Pousse tous les employés actifs vers le périphérique réseau
   * @returns {Promise<{ pushed: number, errors: Array }>}
   */
  async pushEmployeesToDevice() {
    const employees = (state.employees || []).filter(e => e.active !== false);
    return biometricAPI.pushAllEmployees(employees);
  }

  /**
   * Vide la file d'attente des pointages en attente de persistence
   */
  async flushPendingQueue() {
    if (!this._pendingQueue.length) return;

    const toRetry = [...this._pendingQueue];
    this._pendingQueue = [];
    this._saveQueue();

    for (const item of toRetry) {
      try {
        await this._persistAttendance(item.employeeId, item.timestamp, { fromQueue: true });
      } catch {
        // Remettre en file si encore impossible
        this._pendingQueue.push(item);
      }
    }
    this._saveQueue();
  }

  // ── Gestion événements biométriques ──────────────────────

  async _onFingerprint(event) {
    const { employeeId, timestamp, quality, simulated } = event.detail;

    try {
      const result = await this._persistAttendance(employeeId, timestamp, { quality, simulated });

      if (result === 'not_found') {
        this._dispatchUI('biometric-attendance', {
          success: false,
          reason:  'not_found',
          employeeId,
        });
        return;
      }

      if (result === 'duplicate') {
        this._dispatchUI('biometric-attendance', {
          success:  false,
          reason:   'duplicate',
          employeeId,
        });
        return;
      }

      this._setLastSyncDate(new Date());
      this._dispatchUI('biometric-attendance', {
        success:    true,
        employeeId,
        employee:   result.employee,
        record:     result.record,
        simulated,
      });

    } catch (err) {
      console.error('[BiometricSync] Erreur persistence:', err);
      // Enqueue pour retry ultérieur
      this._pendingQueue.push({ employeeId, timestamp, quality });
      this._saveQueue();
      this._dispatchUI('biometric-attendance', { success: false, reason: 'error', employeeId });
    }
  }

  _onError(event) {
    const { code, message } = event.detail;
    console.warn('[BiometricSync] Erreur périphérique:', code, message);
    this._dispatchUI('biometric-device-error', { code, message });
  }

  // ── Persistence — format compatible attendance existant ──

  /**
   * Convertit un événement biométrique en enregistrement de présence
   * compatible avec le format utilisé par attendance.js et attendance-calc.js
   *
   * @param {string} employeeId
   * @param {string} timestamp  ISO 8601
   * @param {object} meta
   * @returns {Promise<'not_found'|'duplicate'|{ employee, record }>}
   */
  async _persistAttendance(employeeId, timestamp, meta = {}) {
    // 1. Retrouver l'employé dans le state existant
    const employee = this._findEmployee(employeeId);
    if (!employee) {
      console.warn('[BiometricSync] Employé non trouvé:', employeeId);
      return 'not_found';
    }

    const ts   = new Date(timestamp);
    const date = this._toLocalDateString(ts); // "YYYY-MM-DD"
    const time = this._toLocalTimeString(ts); // "HH:MM"

    // 2. Détecter si c'est une arrivée ou un départ
    const existing = this._getExistingRecord(employee.id, date);
    const isEntry  = !existing || !existing.timeIn;
    const isExit   = existing?.timeIn && !existing?.timeOut;

    // 3. Vérifier les doublons (même type dans les 3 dernières minutes)
    if (this._isDuplicate(employee.id, date, time, isEntry ? 'in' : 'out')) {
      return 'duplicate';
    }

    // 4. Construire / mettre à jour l'enregistrement
    let record;
    if (isEntry) {
      record = {
        employeeId: employee.id,
        date,
        timeIn:     time,
        timeOut:    null,
        source:     'biometric',
        quality:    meta.quality || null,
        simulated:  meta.simulated || false,
        note:       meta.simulated ? '[Simulation]' : '[Biométrique]',
      };
    } else if (isExit) {
      record = { ...existing, timeOut: time, updatedAt: new Date().toISOString() };
    } else {
      // Déjà complet — ignorer
      return 'duplicate';
    }

    // 5. Sauvegarder via le mécanisme existant du state
    await this._saveRecord(employee.id, date, record, isEntry);
    return { employee, record };
  }

  // ── Accès state ───────────────────────────────────────────

  _findEmployee(employeeId) {
    const id = String(employeeId).trim();
    return (state.employees || []).find(e =>
      String(e.id) === id ||
      String(e.matricule) === id ||
      String(e.cardNo) === id
    ) || null;
  }

  _getExistingRecord(employeeId, date) {
    const records = state.attendance?.[employeeId] || {};
    return records[date] || null;
  }

  _isDuplicate(employeeId, date, time, direction) {
    const existing = this._getExistingRecord(employeeId, date);
    if (!existing) return false;

    const ref = direction === 'in' ? existing.timeIn : existing.timeOut;
    if (!ref) return false;

    // Considère comme doublon si même pointage dans les 3 minutes
    const [rh, rm] = ref.split(':').map(Number);
    const [th, tm] = time.split(':').map(Number);
    return Math.abs((rh * 60 + rm) - (th * 60 + tm)) < 3;
  }

  async _saveRecord(employeeId, date, record, isNew) {
    // Accède directement au state.attendance pour rester compatible
    // avec le format utilisé par attendance-calc.js et payroll.js
    if (!state.attendance) state.attendance = {};
    if (!state.attendance[employeeId]) state.attendance[employeeId] = {};

    state.attendance[employeeId][date] = record;

    // Délègue la sauvegarde IndexedDB au mécanisme existant
    await saveAttendanceData();
  }

  // ── File d'attente offline ────────────────────────────────

  _loadQueue() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    } catch { return []; }
  }

  _saveQueue() {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(this._pendingQueue));
    } catch (err) {
      console.warn('[BiometricSync] Impossible de sauvegarder la file:', err);
    }
  }

  // ── Date de dernière synchronisation ─────────────────────

  _getLastSyncDate() {
    const stored = localStorage.getItem(SYNC_KEY);
    return stored ? new Date(stored) : new Date(Date.now() - 24 * 3600 * 1000);
  }

  _setLastSyncDate(date) {
    localStorage.setItem(SYNC_KEY, date.toISOString());
  }

  // ── Utilitaires date ──────────────────────────────────────

  _toLocalDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  _toLocalTimeString(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  // ── Dispatch vers UI ──────────────────────────────────────

  _dispatchUI(eventName, detail) {
    window.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: true }));
  }
}

// Singleton
export const biometricSync = new BiometricSync();
