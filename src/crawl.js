// Suchlauf: alle Quellen abfragen, passende Ausschreibungen speichern, Entfernung ermitteln, bewerten, melden.
import config from './config.js';
import { SOURCES } from './sources/index.js';
import { loadGewerke, scoreTender, reloadGewerke } from './relevance.js';
import { upsertTender, updateTenderFields, startRun, finishRun, allTenders, getTender } from './db.js';
import { geocode, getHome, haversineKm, locationQuery } from './geo.js';
import { rateWithAi } from './ai.js';
import { sendDigest } from './notify.js';

let running = null;
let lastMessage = 'Noch kein Suchlauf seit dem Start.';

export function crawlStatus() {
  return { laeuft: running != null, meldung: lastMessage };
}

function rescore(tender, gewerke) {
  const result = scoreTender(tender, { gewerke, maxEntfernungKm: config.maxEntfernungKm });
  updateTenderFields(tender.id, { punkte: result.punkte, gewerke: result.gewerke, punkte_details: result.details });
  return result;
}

/** Entfernung für eine gespeicherte Ausschreibung ermitteln (falls Ort bekannt und Betriebssitz eingetragen). */
async function locate(tender, home, log) {
  if (!home) return tender;
  if (tender.lat != null) {
    // Ort schon bekannt: Entfernung neu rechnen (der Betriebssitz kann sich geändert haben)
    const km = Math.round(haversineKm(home, tender) * 10) / 10;
    if (km !== tender.entfernung_km) updateTenderFields(tender.id, { entfernung_km: km });
    return { ...tender, entfernung_km: km };
  }
  const query = locationQuery(tender);
  if (!query) return tender;
  try {
    const point = await geocode(query);
    if (!point) return tender;
    const km = Math.round(haversineKm(home, point) * 10) / 10;
    updateTenderFields(tender.id, { lat: point.lat, lon: point.lon, entfernung_km: km });
    return { ...tender, lat: point.lat, lon: point.lon, entfernung_km: km };
  } catch (error) {
    log(`[geo] ${query}: ${error.message}`);
    return tender;
  }
}

export async function runCrawl({ quellen = config.quellen, log = console.log } = {}) {
  if (running) return running;
  running = doCrawl(quellen, log).finally(() => { running = null; });
  return running;
}

async function doCrawl(quellen, log) {
  reloadGewerke();
  const gewerke = loadGewerke();
  const runId = startRun();
  const ergebnis = {};
  lastMessage = 'Suchlauf läuft …';
  let home = null;
  try {
    home = await getHome();
  } catch (error) {
    log(`[geo] Betriebssitz konnte nicht ermittelt werden: ${error.message}`);
  }
  if (!home) log('[geo] Kein Betriebssitz ermittelt – Entfernungen werden nicht berechnet (FIRMA_ADRESSE in .env).');

  for (const id of quellen) {
    const source = SOURCES[id];
    if (!source) { ergebnis[id] = { fehler: 'Unbekannte Quelle' }; continue; }
    const stats = { gefunden: 0, passend: 0, neu: 0 };
    try {
      lastMessage = `Suchlauf: ${source.meta.name} …`;
      const tenders = await source.fetchTenders({ gewerke, log });
      stats.gefunden = tenders.length;
      for (const t of tenders) {
        // Nur Ausschreibungen mit fachlichem Bezug speichern, damit die Datenbank übersichtlich bleibt.
        const vorab = scoreTender(t, { gewerke });
        if (vorab.details.fachlich === 0) continue;
        stats.passend += 1;
        const { id: dbId, neu } = upsertTender(t);
        if (neu) stats.neu += 1;
        let saved = getTender(dbId);
        saved = await locate(saved, home, log);
        rescore(saved, gewerke);
      }
    } catch (error) {
      stats.fehler = error.message;
      log(`[${id}] Fehler: ${error.message}`);
    }
    ergebnis[id] = stats;
  }

  if (config.ki.aktiv) ergebnis.ki = await runAi(gewerke, log);

  try {
    ergebnis.mail = await sendDigest({ log });
  } catch (error) {
    ergebnis.mail = { fehler: error.message };
    log(`[mail] ${error.message}`);
  }

  const fehler = Object.values(ergebnis).filter((e) => e?.fehler).length;
  const status = fehler === 0 ? 'fertig' : fehler === quellen.length ? 'fehlgeschlagen' : 'teilweise';
  finishRun(runId, status, ergebnis);
  const neu = Object.values(ergebnis).reduce((s, e) => s + (e?.neu || 0), 0);
  lastMessage = `Suchlauf ${status}: ${neu} neue passende Ausschreibungen.`;
  log(lastMessage);
  return { status, ergebnis };
}

/** Lokale KI für die besten noch nicht bewerteten Treffer. */
async function runAi(gewerke, log) {
  const kandidaten = allTenders()
    .filter((t) => t.ki_punkte == null && t.punkte >= config.mindestPunkteAnzeige)
    .sort((a, b) => b.punkte - a.punkte)
    .slice(0, config.ki.maxProLauf);
  let bewertet = 0;
  for (const t of kandidaten) {
    try {
      const answer = await rateWithAi(t);
      if (!answer) continue;
      updateTenderFields(t.id, { ki_punkte: answer.punkte, ki_zusammenfassung: answer.zusammenfassung });
      rescore({ ...t, ki_punkte: answer.punkte }, gewerke);
      bewertet += 1;
    } catch (error) {
      log(`[ki] ${error.message}`);
      return { bewertet, fehler: error.message };
    }
  }
  return { bewertet };
}

/** Alle gespeicherten Ausschreibungen neu bewerten (z. B. nach Änderung der Suchbegriffe oder Adresse). */
export async function rescoreAll({ log = console.log } = {}) {
  reloadGewerke();
  const gewerke = loadGewerke();
  let home = null;
  try { home = await getHome(); } catch { /* ohne Entfernung */ }
  let n = 0;
  for (let t of allTenders()) {
    t = await locate(t, home, log);
    rescore(t, gewerke);
    n += 1;
  }
  return { bewertet: n };
}
