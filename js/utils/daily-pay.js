// ============================================================
// utils/daily-pay.js — Suivi de la rémunération journalière
// Module isolé : il ne modifie jamais state.payrolls ni la base.
//  - Mode et tarif de chaque employé : réglage "payMode_<id>" (table Setting).
//  - Jours payés par un paiement journalier : marqueur [[DP1|…]] dans Payroll.note.
//  - Jours payés par un paiement mensuel EXISTANT : déduits du mois et de la
//    date de la ligne (jours du mois jusqu'à la date de paiement, plus les
//    jours d'acompte éventuels du mois suivant). Aucune ligne n'est modifiée.
// ============================================================

import { state } from '../state.js';
import { getPresenceStatus, daysInMonth } from './attendance-calc.js';

const MODE_PREFIX = 'payMode_';
const TAG_RE      = /\s*\[\[DP1\|([^\]]*)\]\]/;
const MAX_DAYS    = 800;

let _modes = {};

// ── Dates (toujours en heure locale, jamais toISOString) ────

export function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _eachDate(from, to) {
  const out = [];
  const d   = new Date(from + 'T00:00:00Z');
  const end = new Date(to   + 'T00:00:00Z');
  while (d <= end && out.length < MAX_DAYS) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function _weight(employeeId, dateStr) {
  const s = getPresenceStatus(employeeId, dateStr);
  return s === 'present' ? 1 : s === 'demi' ? 0.5 : 0;
}

// ── Mode et tarif (réglage "payMode_<id>") ──────────────────

/** Relit les modes depuis le serveur. Garde le dernier état connu en cas d'échec. */
export async function refreshModes() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch('/api/settings', { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const all   = await res.json();
    const modes = {};
    for (const [k, v] of Object.entries(all || {})) {
      if (k.startsWith(MODE_PREFIX) && v && typeof v === 'object') modes[k.slice(MODE_PREFIX.length)] = v;
    }
    _modes = modes;
    return true;
  } catch (err) {
    console.warn('[PAIE-JOURNALIER] Modes non rafraîchis :', err.message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function getMode(employeeId) { return _modes[employeeId] || null; }

export function isDaily(employeeId) { return _modes[employeeId]?.mode === 'daily'; }

export async function setMode(employeeId, value) {
  const res = await fetch('/api/settings/' + encodeURIComponent(MODE_PREFIX + employeeId), {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  _modes[employeeId] = value;
}

/** Tarif proposé à l'activation : salaire mensuel ÷ jours du mois en cours, arrondi. */
export function defaultRate(emp) {
  const t = todayLocal();
  const n = daysInMonth(Number(t.slice(0, 4)), Number(t.slice(5, 7)));
  return Math.round((Number(emp?.salary) || 0) / n);
}

// ── Marqueur de jours payés dans Payroll.note ───────────────

export function buildTag(dueList, rate) {
  const d = dueList.map(x => `${x.date}:${x.w}`).join(';');
  return ` [[DP1|${d}|r:${rate}]]`;
}

export function parseTag(note) {
  const m = TAG_RE.exec(note || '');
  if (!m) return null;
  const parts = m[1].split('|');
  const dates = {};
  (parts[0] || '').split(';').filter(Boolean).forEach(s => {
    const i = s.lastIndexOf(':');
    const d = s.slice(0, i);
    const w = Number(s.slice(i + 1));
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && w > 0) dates[d] = w;
  });
  const rate = Number((parts.find(p => p.startsWith('r:')) || '').slice(2)) || 0;
  return { dates, rate };
}

export function stripTag(note) {
  return (note || '').replace(TAG_RE, '');
}

// ── Jours déjà payés ────────────────────────────────────────

/** Poids payés par les paiements journaliers (marqueurs) : { 'AAAA-MM-JJ': poids }. */
function _markerWeights(employeeId) {
  const out = {};
  for (const p of state.payrolls || []) {
    if (p.employeeId !== employeeId) continue;
    const t = parseTag(p.note);
    if (!t) continue;
    for (const [d, w] of Object.entries(t.dates)) out[d] = (out[d] || 0) + w;
  }
  return out;
}

/**
 * Un paiement mensuel EXISTANT (sans marqueur) couvre les jours de son mois
 * jusqu'à sa date de paiement, plus les jours d'acompte du mois suivant.
 * Les lignes dont le mois n'est pas un entier (solde de tout compte) sont ignorées.
 */
function _coveredByLegacy(employeeId, dateStr) {
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7));
  const day = Number(dateStr.slice(8, 10));
  for (const p of state.payrolls || []) {
    if (p.employeeId !== employeeId || parseTag(p.note)) continue;
    const pm = Number(p.month);
    const py = Number(p.year);
    if (!Number.isInteger(pm) || !Number.isInteger(py)) continue;
    const pd = String(p.date || '').split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pd)) continue;
    if (py === y && pm === m && dateStr <= pd) return true;
    if (Number(p.advDays) > 0) {
      const ny = pm === 12 ? py + 1 : py;
      const nm = pm === 12 ? 1 : pm + 1;
      if (ny === y && nm === m && day <= Number(p.advDays)) return true;
    }
  }
  return false;
}

// ── Calcul principal ────────────────────────────────────────

/**
 * opts : { from, to, rate } — par défaut : début du suivi, aujourd'hui, tarif du mode.
 * Une journée est « à payer » si l'employé était présent et qu'aucun paiement ne la couvre.
 */
export function computeDaily(emp, opts = {}) {
  const mode  = _modes[emp.id];
  const since = opts.from || mode?.since;
  const until = opts.to   || todayLocal();
  const rate  = Number(opts.rate ?? mode?.rate) || 0;
  const res = { since, until, rate, totalDays: 0, paidDays: 0, legacyDays: 0, dueDays: 0, overDays: 0, dueList: [], amount: 0 };
  if (!since || since > until) return res;

  const marker = _markerWeights(emp.id);
  for (const d of _eachDate(since, until)) {
    const w  = _weight(emp.id, d);
    const mw = marker[d] || 0;
    if (w === 0 && mw === 0) continue;
    const legacy = _coveredByLegacy(emp.id, d);
    const paid   = legacy ? w : Math.min(w, mw);
    res.totalDays += w;
    res.paidDays  += paid;
    if (legacy) res.legacyDays += w;
    if (w - paid > 0) res.dueList.push({ date: d, w: w - paid });
    if (!legacy && mw > w) res.overDays += mw - w;
  }
  res.dueDays = res.dueList.reduce((s, x) => s + x.w, 0);
  res.amount  = res.dueDays * rate;
  return res;
}

/** true / false : reste-t-il des jours à payer dans ce mois ? null : mois avant le début du suivi. */
export function hasDueInMonth(emp, year, month) {
  const mm    = String(month).padStart(2, '0');
  const first = `${year}-${mm}-01`;
  const last  = `${year}-${mm}-${String(daysInMonth(year, month)).padStart(2, '0')}`;
  const since = _modes[emp.id]?.since;
  if (!since || last < since) return null;
  const from  = since > first ? since : first;
  const today = todayLocal();
  const to    = last < today ? last : today;
  return computeDaily(emp, { from, to }).dueDays > 0;
}

/** Retour au mensuel : aucun jour à payer ET aucun paiement journalier dans le mois en cours. */
export function canReturnMonthly(emp) {
  const r = computeDaily(emp);
  if (r.dueDays > 0) {
    const n = Number.isInteger(r.dueDays) ? r.dueDays : r.dueDays.toFixed(1);
    return { ok: false, reason: `Il reste ${n} j à payer : payez-les avant de repasser en mensuel.` };
  }
  const t  = todayLocal();
  const cy = Number(t.slice(0, 4));
  const cm = Number(t.slice(5, 7));
  const dailyThisMonth = (state.payrolls || []).some(p =>
    p.employeeId === emp.id && parseTag(p.note) && Number(p.year) === cy && Number(p.month) === cm
  );
  if (dailyThisMonth) {
    return { ok: false, reason: 'Un paiement journalier existe ce mois-ci : le retour au mensuel sera possible à partir du mois prochain.' };
  }
  return { ok: true };
}
