// ============================================================
// utils/attendance-calc.js
// Calcul de présence avec gestion des jours d'acompte exceptionnels.
//
// Règle normale  : paiement en fin de mois, calcul sur le mois entier.
// Cas exceptionnel (ponctuel) : le salaire du mois M est versé avec
// N jours de retard, sur les N premiers jours du mois M+1.
//   → Salaire de M  = présence en M  + présence jours 1–N de M+1
//                     (absences sur 1–N de M+1 déduites du salaire de M)
//   → Salaire de M+1 = calculé à partir du jour N+1 de M+1
//                      (les N premiers jours ne sont PAS recomptés)
// ============================================================

import { state } from '../state.js';

// ── Helpers ─────────────────────────────────────────────────

/** Nombre de jours dans un mois (month 1-indexé). */
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * Construit un tableau 'YYYY-MM-DD' pour une plage dans un mois.
 * @param {number} year
 * @param {number} month  1-indexé
 * @param {number} from   premier jour inclus (défaut 1)
 * @param {number} to     dernier jour inclus  (défaut fin du mois)
 */
export function buildDateRange(year, month, from = 1, to = null) {
  const last = to ?? daysInMonth(year, month);
  const out  = [];
  for (let d = from; d <= last; d++) {
    out.push(
      `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    );
  }
  return out;
}

/**
 * Statut de présence d'un employé à une date précise.
 * @returns {'present'|'demi'|'absent'}
 */
export function getPresenceStatus(employeeId, dateStr) {
  const p = state.attendance?.[dateStr]?.[employeeId];
  if (!p) return 'absent';
  if (p === 'demi') return 'demi';
  if (typeof p === 'object' && p !== null && p.arrivee) {
    if (p.depart) {
      const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
      return (toMin(p.depart) - toMin(p.arrivee)) < 240 ? 'demi' : 'present';
    }
    return 'demi'; // arrivée sans départ → demi-journée
  }
  return 'present'; // true / 'journee'
}

/**
 * Agrège la présence sur une liste de dates.
 * @returns {{ present, demi, absent, effectiveDays }}
 */
export function countPresence(employeeId, dates) {
  let present = 0, demi = 0, absent = 0;
  for (const d of dates) {
    const s = getPresenceStatus(employeeId, d);
    if      (s === 'present') present++;
    else if (s === 'demi')    demi++;
    else                      absent++;
  }
  return { present, demi, absent, effectiveDays: present + demi * 0.5 };
}

// ── Calcul 1 : mode normal (fin de mois) ────────────────────

/**
 * Calcul classique sur le mois entier.
 * Utilisé dans le flux de paie normal (aucun acompte).
 */
export function computeStandardPayroll(employeeId, baseSalary, year, month) {
  const totalDays = daysInMonth(year, month);
  const dates     = buildDateRange(year, month);
  const presence  = countPresence(employeeId, dates);
  const dailyRate = baseSalary / totalDays;

  return {
    mode: 'standard',
    year, month, totalDays,
    ...presence,
    dailyRate,
    grossPay: presence.effectiveDays * dailyRate,
    advanceDays: 0,
    advancePresence: null,
  };
}

// ── Calcul 2 : cas exceptionnel — mois M payé en retard ─────

/**
 * Calcule le salaire du mois M dans le cas exceptionnel où le paiement
 * est décalé de N jours dans le mois M+1.
 *
 * Les N premiers jours du mois M+1 entrent dans la période payée pour M.
 * Les absences sur ces N jours sont DÉDUITES du salaire de M.
 *
 * @param {string} employeeId
 * @param {number} baseSalary     Salaire mensuel de base
 * @param {number} year           Année du mois M (le mois payé en retard)
 * @param {number} month          Mois M (1-indexé)
 * @param {number} advanceDays    N : nombre de jours du mois M+1 utilisés
 * @returns {object} Résultat détaillé
 */
export function computeDelayedPayroll(employeeId, baseSalary, year, month, advanceDays) {
  const totalDaysM = daysInMonth(year, month);
  const dailyRate  = baseSalary / totalDaysM;

  // Présence sur le mois M complet
  const datesM    = buildDateRange(year, month);
  const presenceM = countPresence(employeeId, datesM);

  // Jours d'acompte : 1–N du mois M+1
  const nextMonth = month === 12 ? 1     : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;
  const datesAdv  = buildDateRange(nextYear, nextMonth, 1, advanceDays);
  const presenceAdv = countPresence(employeeId, datesAdv);

  const totalEffective = presenceM.effectiveDays + presenceAdv.effectiveDays;

  return {
    mode: 'delayed',
    year, month, totalDays: totalDaysM,
    // Présence mois M
    present:       presenceM.present,
    demi:          presenceM.demi,
    absent:        presenceM.absent,
    effectiveDays: presenceM.effectiveDays,
    // Jours d'acompte (mois M+1, jours 1–N)
    advanceDays,
    nextYear, nextMonth,
    advanceDates:   datesAdv,
    advancePresence: presenceAdv,
    // Totaux
    totalEffective,
    dailyRate,
    grossPay: totalEffective * dailyRate,
  };
}

// ── Calcul 3 : mois M+1 après un paiement tardif ────────────

/**
 * Calcule le salaire du mois M+1 lorsque ses N premiers jours
 * ont déjà été imputés au salaire du mois M.
 * Le calcul démarre au jour N+1 ; les N premiers jours ne sont PAS recomptés.
 *
 * @param {string} employeeId
 * @param {number} baseSalary
 * @param {number} year         Année du mois M+1
 * @param {number} month        Mois M+1 (1-indexé)
 * @param {number} advanceDays  N jours déjà utilisés pour le mois M
 * @returns {object}
 */
export function computeFollowingMonthPayroll(employeeId, baseSalary, year, month, advanceDays) {
  const totalDays  = daysInMonth(year, month);
  const startDay   = advanceDays + 1;
  const dailyRate  = baseSalary / totalDays; // taux sur base du mois entier

  if (startDay > totalDays) {
    // Garde-fou : N ≥ nombre de jours du mois (ne devrait pas arriver)
    return {
      mode: 'following_month',
      year, month, totalDays, advanceDays, startDay,
      countedDays: 0,
      present: 0, demi: 0, absent: 0, effectiveDays: 0,
      dailyRate, grossPay: 0,
    };
  }

  const dates      = buildDateRange(year, month, startDay);
  const presence   = countPresence(employeeId, dates);
  const countedDays = totalDays - advanceDays;

  return {
    mode: 'following_month',
    year, month, totalDays, advanceDays,
    startDay, countedDays,
    ...presence,
    dailyRate,
    grossPay: presence.effectiveDays * dailyRate,
  };
}

// ── Rapport de présence mensuel (pour l'affichage détaillé) ─

/**
 * Génère un rapport jour par jour pour un mois donné.
 * Si advanceDays > 0, les N premiers jours sont marqués comme "jours d'acompte"
 * (utilisés pour payer le mois précédent — ils ne seront pas recomptés ici).
 *
 * @param {string} employeeId
 * @param {number} year
 * @param {number} month
 * @param {number} [advanceDays=0]
 */
// ── Fonctions de compatibilité (signatures attendues par stats.js / stc.js) ──

/**
 * Compte les jours de présence effectifs d'un employé sur un mois.
 *
 * Accepte deux formes :
 *   - countPresenceDays(employeeId, 'YYYY-MM')        → stats.js / stc.js
 *   - countPresenceDays(employeeId, ['YYYY-MM-DD', …]) → ancien appel tableau
 *
 * @returns {number}  Nombre de jours effectifs (demi = 0.5)
 */
export function countPresenceDays(employeeId, monthOrDates) {
  let dates;
  if (typeof monthOrDates === 'string') {
    const [y, m] = monthOrDates.split('-').map(Number);
    dates = buildDateRange(y, m);
  } else {
    dates = monthOrDates;
  }
  return countPresence(employeeId, dates).effectiveDays;
}

/**
 * Retourne les avances d'un employé pour un mois donné.
 *
 * Accepte deux formes :
 *   - getEmployeeAdvancesForMonth(employeeId, 'YYYY-MM')   → stats.js
 *   - getEmployeeAdvancesForMonth(employeeId, year, month) → appel explicite
 *
 * @returns {object[]}  Tableau des avances (compatible .reduce() direct)
 */
export function getEmployeeAdvancesForMonth(employeeId, yearOrMonth, month) {
  let prefix;
  if (typeof yearOrMonth === 'string' && yearOrMonth.includes('-') && month === undefined) {
    prefix = yearOrMonth;
  } else {
    prefix = `${yearOrMonth}-${String(month).padStart(2, '0')}`;
  }
  return (state.advances || []).filter(
    a => a.employeeId === employeeId && (a.date || '').startsWith(prefix)
  );
}

/**
 * Retourne le dernier mois payé pour un employé (depuis state.payrolls).
 * Exclut les enregistrements STC (month === 'SOLDE_DE_TOUT_COMPTE').
 *
 * @param {string} employeeId
 * @returns {{ year: number, month: number } | null}
 */
export function getLastPaidMonth(employeeId) {
  const records = (state.payrolls || []).filter(
    p => p.employeeId === employeeId && p.month !== 'SOLDE_DE_TOUT_COMPTE'
  );
  if (!records.length) return null;

  records.sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    return b.month - a.month;
  });

  return { year: records[0].year, month: records[0].month };
}

/**
 * Calcule la date de début de calcul pour le STC.
 * - Si lastPaid est null : part de la date d'embauche de l'employé (ou du mois courant).
 * - Sinon : premier jour du mois suivant le dernier mois payé.
 *
 * @param {{ year: number, month: number } | null} lastPaid
 * @param {string} employeeId
 * @returns {Date}  Date UTC (minuit du 1er du mois de début).
 */
export function getStartDateForCalculation(lastPaid, employeeId) {
  if (!lastPaid) {
    const emp = state.employees?.find(e => e.id === employeeId);
    if (emp?.hireDate) {
      const d = new Date(emp.hireDate + 'T00:00:00Z');
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    }
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  const nextMonth = lastPaid.month === 12 ? 1 : lastPaid.month + 1;
  const nextYear  = lastPaid.month === 12 ? lastPaid.year + 1 : lastPaid.year;
  return new Date(Date.UTC(nextYear, nextMonth - 1, 1));
}

export function buildPresenceReport(employeeId, year, month, advanceDays = 0) {
  const emp = state.employees?.find(e => e.id === employeeId);

  const details = buildDateRange(year, month).map(dateStr => {
    const day    = parseInt(dateStr.split('-')[2], 10);
    const status = getPresenceStatus(employeeId, dateStr);
    return {
      date: dateStr,
      day,
      status,
      isAdvanceDay: advanceDays > 0 && day <= advanceDays,
    };
  });

  const sum = arr => arr.reduce(
    (acc, d) => {
      if      (d.status === 'present') acc.present++;
      else if (d.status === 'demi')    acc.demi++;
      else                             acc.absent++;
      acc.effective += d.status === 'present' ? 1 : d.status === 'demi' ? 0.5 : 0;
      return acc;
    },
    { present: 0, demi: 0, absent: 0, effective: 0 }
  );

  return {
    employeeId,
    employeeName:    emp?.name ?? employeeId,
    year, month,
    totalDays:       daysInMonth(year, month),
    advanceDays,
    advanceSummary:  sum(details.filter(d =>  d.isAdvanceDay)),
    mainSummary:     sum(details.filter(d => !d.isAdvanceDay)),
    total:           sum(details),
    details,
  };
}
