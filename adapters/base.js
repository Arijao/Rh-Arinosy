// ============================================================
// bridge/adapters/base.js
// Interface commune pour tous les adaptateurs de lecteurs
// biométriques. Chaque adaptateur étend cette classe et
// implémente les méthodes abstraites.
//
// Protocole WebSocket émis vers biometric-service.js :
// {
//   type:       'fingerprint',
//   employeeId: string,   ← ID brut du lecteur (matricule / carte)
//   quality:    number,   ← 0–100
//   timestamp:  string,   ← ISO 8601
//   simulated:  boolean,
//   transport:  string,   ← nom de l'adaptateur
// }
// ============================================================

import { EventEmitter } from 'events';

export class BaseAdapter extends EventEmitter {
  /**
   * @param {string} name - Nom lisible de l'adaptateur ('hid' | 'zkteco' | 'hikvision' | ...)
   * @param {object} config - Configuration spécifique à l'adaptateur
   */
  constructor(name, config = {}) {
    super();
    this.name      = name;
    this.config    = config;
    this.connected = false;
  }

  // ── Méthodes à implémenter ────────────────────────────────

  /**
   * Détecte si un périphérique compatible est disponible.
   * @returns {Promise<boolean>}
   */
  async detect() {
    throw new Error(`[${this.name}] detect() non implémenté`);
  }

  /**
   * Ouvre la connexion avec le périphérique.
   * Doit émettre 'connected' ou 'error'.
   * @returns {Promise<void>}
   */
  async connect() {
    throw new Error(`[${this.name}] connect() non implémenté`);
  }

  /**
   * Ferme proprement la connexion.
   * @returns {Promise<void>}
   */
  async disconnect() {
    throw new Error(`[${this.name}] disconnect() non implémenté`);
  }

  // ── Méthode utilitaire — émet un événement fingerprint ───

  /**
   * À appeler par les sous-classes quand une empreinte est lue.
   * Normalise et émet l'événement au format attendu par biometric-service.js.
   *
   * @param {string} employeeId - ID brut retourné par le lecteur
   * @param {object} meta       - { quality?, simulated? }
   */
  emitFingerprint(employeeId, meta = {}) {
    const payload = {
      type:       'fingerprint',
      employeeId: String(employeeId).trim(),
      quality:    meta.quality    ?? 80,
      timestamp:  new Date().toISOString(),
      simulated:  meta.simulated  ?? false,
      transport:  this.name,
    };
    this.emit('fingerprint', payload);
  }

  /**
   * À appeler par les sous-classes en cas d'erreur lecteur.
   * @param {string} code    - Code court ('NO_MATCH' | 'READ_ERROR' | ...)
   * @param {string} message - Message lisible
   */
  emitError(code, message) {
    this.emit('error', { code, message, transport: this.name });
  }

  /**
   * À appeler par les sous-classes lors d'un changement d'état.
   * @param {'connected'|'disconnected'|'reconnecting'} state
   * @param {string} message
   */
  emitStatus(state, message) {
    this.emit('status', { state, message, transport: this.name });
  }

  log(...args) {
    console.log(`[${this.name}]`, ...args);
  }

  warn(...args) {
    console.warn(`[${this.name}]`, ...args);
  }
}
