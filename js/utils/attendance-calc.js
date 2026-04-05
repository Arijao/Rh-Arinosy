// ============================================================
// utils/attendance-calc.js — Calculs présence (ES Module)
// ============================================================

import { state } from '../state.js';
import { getDaysInMonth, calculateWorkDuration } from './format.js';

const MIN_HOURS_FULL_DAY = 4; // heures minimum pour journée complète

/**
 * Compte les jours de présence pour un employé sur un mois donné.
 * Gère tous les formats : boolean, string, object {arrivee, depart}.
 */
export function countPresenceDays(employeeId, month) {
  let total = 0;

  for (const dateStr of Object.keys(state.attendance)) {
    if (!dateStr.startsWith(month)) continue;

    const dayData     = state.attendance[dateStr];
    const presenceData = dayData?.[employeeId];
    if (!presenceData) continue;

    const d = new Date(dateStr + 'T00:00:00Z');
    const isSunday = d.getUTCDay() === 0;

    if (isSunday) { total += 1; continue; }

    if (typeof presenceData === 'object' && presenceData.arrivee) {
      if (presenceData.depart) {
        const { totalMinutes } = calculateWorkDuration(presenceData.arrivee, presenceData.depart);
        total += (totalMinutes / 60) >= MIN_HOURS_FULL_DAY ? 1 : (totalMinutes > 0 ? 0.5 : 0);
      } else {
        total += 0.5;
      }
    } else if (presenceData === true || presenceData === 'journee') {
      total += 1;
    } else if (presenceData === 'demi') {
      total += 0.5;
    }
  }

  return total;
}

/**
 * Retourne les avances d'un employé pour un mois donné.
 */
export function getEmployeeAdvancesForMonth(employeeId, month) {
  return state.advances.filter(
    adv => adv.employeeId === employeeId && adv.date.startsWith(month)
  );
}

/**
 * Retourne le dernier mois payé pour un employé.
 */
export function getLastPaidMonth(employeeId) {
  const payments = state.payrolls.filter(
    p => p.employeeId === employeeId && p.month !== 'SOLDE_DE_TOUT_COMPTE'
  );
  if (!payments.length) return null;
  payments.sort((a, b) => b.month.localeCompare(a.month));
  return payments[0].month;
}

/**
 * Calcule la date de début pour le calcul STC.
 */
export function getStartDateForCalculation(lastPayMonth, employeeId) {
  if (lastPayMonth) {
    const [y, m] = lastPayMonth.split('-').map(Number);
    return new Date(Date.UTC(y, m, 1));
  }
  const emp = state.employees.find(e => e.id === employeeId);
  if (emp?.dateAdded) {
    const d = new Date(emp.dateAdded);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
}
