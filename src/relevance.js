// Relevanzbewertung 0–100 Punkte.
// Die Grundidee (starke/unterstützende Suchbegriffe je Gruppe, CPV-Abgleich, Ausschlussliste,
// Umlaut-Vereinheitlichung) stammt aus kwb.tenders (MIT-Lizenz, siehe NOTICE.md).
import fs from 'node:fs';
import path from 'node:path';
import { rootDir } from './config.js';
import { normalizeDe, cpvDigits, daysUntil } from './text.js';

let cached = null;

export function loadGewerke(file = path.join(rootDir, 'gewerke.json')) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const compile = (words) => (words || []).map((w) => ({ wort: w, re: termRegex(w) }));
  const gewerke = Object.entries(raw.gewerke).map(([id, g]) => ({
    id,
    name: g.name,
    stark: compile(g.stark),
    unterstuetzend: compile(g.unterstuetzend),
    cpv: (g.cpv || []).map(cpvDigits).filter(Boolean),
  }));
  return {
    gewerke,
    cpvAllgemein: (raw.cpv_allgemein_bau || []).map(cpvDigits).filter(Boolean),
    ausschluss: compile(raw.ausschluss),
  };
}

function getGewerke() {
  if (!cached) cached = loadGewerke();
  return cached;
}

export function reloadGewerke() {
  cached = null;
}

/**
 * Suchmuster für einen Begriff. Kurze Begriffe (bis 4 Zeichen, z. B. "WDVS", "Putz") müssen als ganzes
 * Wort vorkommen, längere dürfen Teil eines zusammengesetzten Wortes sein ("Innenputzarbeiten").
 */
function termRegex(term) {
  const n = normalizeDe(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return n.replace(/[^a-z]/g, '').length <= 4
    ? new RegExp(`(^|[^a-z])${n}($|[^a-z])`)
    : new RegExp(n);
}

/** CPV-Code liegt in der Gruppe des Ziel-Codes: 45262120 gehört zu 45262100 (Präfix ohne Endnullen). */
function cpvMatches(code, target) {
  const prefix = target.replace(/0+$/, '');
  return code.startsWith(prefix.length >= 4 ? prefix : target.slice(0, 4));
}

/**
 * Bewertet eine Ausschreibung. Ergebnis: Punkte (0–100), erkannte Gewerke und eine nachvollziehbare Aufschlüsselung.
 * Aufteilung: Fachlicher Bezug bis 70, Entfernung bis 20, Frist bis 10.
 */
export function scoreTender(tender, { gewerke = getGewerke(), maxEntfernungKm = 0 } = {}) {
  const title = normalizeDe(tender.titel);
  const text = normalizeDe([tender.beschreibung, tender.vergabestelle].filter(Boolean).join(' '));
  const cpvs = (tender.cpv || []).map(cpvDigits).filter(Boolean);
  const gruende = [];
  const treffer = [];

  let fach = 0;
  for (const g of gewerke.gewerke) {
    const starkTitel = g.stark.filter((k) => k.re.test(title)).map((k) => k.wort);
    const starkText = g.stark.filter((k) => !starkTitel.includes(k.wort) && k.re.test(text)).map((k) => k.wort);
    const unterst = g.unterstuetzend.filter((k) => k.re.test(title) || k.re.test(text)).map((k) => k.wort);
    const cpvTreffer = cpvs.filter((c) => g.cpv.some((t) => cpvMatches(c, t)));

    let p = 0;
    if (starkTitel.length) p += 45;
    else if (starkText.length) p += 28;
    if (cpvTreffer.length) p += 30;
    p += Math.min(unterst.length * 4, 12);
    // Nur unterstützende Begriffe ohne starken Begriff oder CPV: schwacher Hinweis
    if (!starkTitel.length && !starkText.length && !cpvTreffer.length) p = Math.min(p, unterst.length >= 2 ? 12 : 0);
    p = Math.min(p, 70);
    if (p > 0) {
      treffer.push({ id: g.id, name: g.name, punkte: p });
      const worte = [...starkTitel, ...starkText, ...unterst];
      gruende.push(`${g.name}: ${[worte.length ? `Begriffe ${worte.slice(0, 6).join(', ')}` : '', cpvTreffer.length ? `CPV ${cpvTreffer.join(', ')}` : ''].filter(Boolean).join('; ')}`);
    }
    fach = Math.max(fach, p);
  }
  // Mehrere passende Gewerke (z. B. Gerüst + WDVS) etwas aufwerten
  if (treffer.length > 1) fach = Math.min(70, fach + 5 * (treffer.length - 1));

  if (fach === 0 && cpvs.some((c) => gewerke.cpvAllgemein.some((t) => cpvMatches(c, t)))) {
    fach = 10;
    gruende.push('Allgemeiner Ausbau-CPV ohne konkreten Gewerk-Begriff');
  }

  const ausschluss = gewerke.ausschluss.filter((k) => k.re.test(title)).map((k) => k.wort);
  if (ausschluss.length && fach > 0) {
    fach = Math.max(0, fach - 30);
    gruende.push(`Abzug für Ausschlussbegriff im Titel: ${ausschluss.join(', ')}`);
  }

  // Entfernung
  let entfernung = 0;
  const km = tender.entfernung_km;
  if (km == null) {
    entfernung = 6;
    gruende.push('Entfernung unbekannt');
  } else if (maxEntfernungKm && km > maxEntfernungKm) {
    entfernung = -20;
    gruende.push(`Außerhalb des Einsatzgebiets (${Math.round(km)} km)`);
  } else {
    entfernung = km <= 30 ? 20 : km <= 60 ? 16 : km <= 100 ? 12 : km <= 200 ? 7 : km <= 400 ? 3 : 0;
    gruende.push(`Entfernung ca. ${Math.round(km)} km`);
  }

  // Frist
  let frist = 0;
  const tage = daysUntil(tender.frist);
  if (tage == null) frist = 5;
  else if (tage < 0) frist = -100;
  else if (tage >= 14) frist = 10;
  else if (tage >= 7) frist = 6;
  else frist = 2;
  if (tage != null) gruende.push(tage < 0 ? 'Frist abgelaufen' : `Frist in ${tage} Tagen`);

  let punkte = fach + entfernung + frist;
  // Ohne fachlichen Bezug bleibt eine Ausschreibung unauffällig, auch wenn sie nah ist
  if (fach === 0) punkte = Math.min(punkte, 5);
  if (tender.typ === 'Vergebener Auftrag') {
    punkte = Math.min(punkte, 5);
    gruende.push('Bereits vergeben');
  }
  if (tender.ki_punkte != null && fach > 0) {
    // Lokale KI als Zweitmeinung: 30 % Gewicht auf den fachlichen Anteil
    const kiFach = Math.round((tender.ki_punkte / 100) * 70);
    const neuFach = Math.round(fach * 0.7 + kiFach * 0.3);
    punkte += neuFach - fach;
    gruende.push(`KI-Einschätzung ${tender.ki_punkte}/100`);
  }
  punkte = Math.max(0, Math.min(100, Math.round(punkte)));

  return {
    punkte,
    gewerke: treffer.sort((a, b) => b.punkte - a.punkte).map((t) => t.id),
    details: { fachlich: fach, entfernung, frist, gruende },
  };
}
