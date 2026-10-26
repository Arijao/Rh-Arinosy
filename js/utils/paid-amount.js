// ============================================================
// utils/paid-amount.js — Montant deja paye, toutes periodes confondues
// Lecture seule sur state.payrolls. Ne modifie jamais un paiement.
// Un paiement mensuel (sans marqueur [[DP1|) est rattache a (year, month)
// et son montant est soustrait EN ENTIER des que la periode demandee touche
// ce mois (meme granularite que le reste de l'application, qui traite deja
// le mensuel mois par mois).
// Un paiement journalier (marqueur [[DP1|date:poids;...|r:tarif]]) est
// decompose jour par jour : seul le montant (poids x tarif) des jours
// reellement dans la periode demandee est soustrait.
// Limite connue : un paiement mensuel avec jours d'acompte (paiement tardif
// exceptionnel) n'est rattache qu'a son mois de reference ; les quelques
// jours d'acompte sur le mois suivant ne sont pas deduits pour ce mois-la.
// ============================================================

import { state } from './state.js';

const TAG_RE = /\[\[DP1\|([^\]]*)\]\]/;

function _parseDailyTag(note) {
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

export function getPaidForMonth(employeeId, year, month) {
  let paid = 0;
  for (const p of state.payrolls || []) {
    if (p.employeeId !== employeeId) continue;
    const tag = _parseDailyTag(p.note);
    if (tag) {
      for (const [d, w] of Object.entries(tag.dates)) {
        if (Number(d.slice(0, 4)) === year && Number(d.slice(5, 7)) === month) paid += w * tag.rate;
      }
    } else if (Number(p.year) === year && Number(p.month) === month) {
      paid += p.amount || 0;
    }
  }
  return paid;
}

export function getPaidForRange(employeeId, from, to) {
  let paid = 0;
  for (const p of state.payrolls || []) {
    if (p.employeeId !== employeeId) continue;
    const tag = _parseDailyTag(p.note);
    if (tag) {
      for (const [d, w] of Object.entries(tag.dates)) {
        if (d >= from && d <= to) paid += w * tag.rate;
      }
    } else {
      const y = Number(p.year), m = Number(p.month);
      if (!Number.isInteger(y) || !Number.isInteger(m)) continue;
      const first = `${y}-${String(m).padStart(2, '0')}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const last = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      if (first <= to && last >= from) paid += p.amount || 0;
    }
  }
  return paid;
}
