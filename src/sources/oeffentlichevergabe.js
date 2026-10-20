// Datenservice Öffentlicher Einkauf (oeffentlichevergabe.de): bündelt Bekanntmachungen von Bund, Ländern
// und Kommunen. Offene Daten, kostenlos, ohne Anmeldung. Pro Tag wird ein OCDS-Export (ZIP) geladen.
// Endpunkt und Auswertung der OCDS-Felder nach dem Vorbild von kwb.tenders (MIT-Lizenz, siehe NOTICE.md).
import { unzipSync, strFromU8 } from 'fflate';
import config from '../config.js';
import { httpFetch, toIsoDate, todayIso, cpvDigits } from '../text.js';

export const meta = { id: 'oeffentlichevergabe', name: 'Datenservice Öffentlicher Einkauf (Bund, Länder, Kommunen)' };

const EXPORT_URL = 'https://oeffentlichevergabe.de/api/notice-exports';

function text(value) {
  if (value == null) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return text(value.de ?? value.DE ?? Object.values(value)[0]);
  if (Array.isArray(value)) return text(value[0]);
  const s = String(value).trim();
  return s || null;
}

function isCpv(classification) {
  if (!classification) return false;
  return String(classification.scheme || '').toUpperCase() === 'CPV' || /^\d{8}/.test(String(classification.id || '').replace(/\D/g, ''));
}

function cpvFromItems(items) {
  const out = [];
  for (const item of items || []) {
    if (isCpv(item.classification)) out.push(item.classification.id);
    for (const ac of item.additionalClassifications || []) if (isCpv(ac)) out.push(ac.id);
  }
  return out;
}

/** Erstes Vorkommen eines Schlüssels in einem verschachtelten Objekt (begrenzte Tiefe). */
function findDeep(node, key, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return undefined;
  if (Object.prototype.hasOwnProperty.call(node, key)) return node[key];
  for (const value of Object.values(node)) {
    const hit = findDeep(value, key, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** Ausführungsort: Lieferadresse der Lose/Positionen, sonst Adresse des Auftraggebers. */
function location(release) {
  const delivery = findDeep(release.tender, 'deliveryAddresses');
  const candidates = [];
  if (Array.isArray(delivery)) candidates.push(...delivery);
  const buyerId = release.buyer?.id;
  for (const party of release.parties || []) {
    if (party.id === buyerId || (party.roles || []).includes('buyer')) candidates.push(party.address);
  }
  for (const a of candidates) {
    if (a && (a.postalCode || a.locality)) {
      return { plz: text(a.postalCode), ort: text(a.locality) || text(a.region), nuts: text(a.region) };
    }
  }
  return { plz: null, ort: null, nuts: null };
}

function buyerName(release) {
  const direct = text(release.buyer?.name);
  if (direct) return direct;
  const parties = release.parties || [];
  const buyer = parties.find((p) => (p.roles || []).includes('buyer')) || parties[0];
  return text(buyer?.name);
}

export function parseRelease(release) {
  const tender = release.tender || {};
  const id = text(release.id) || text(release.ocid);
  const title = text(tender.title);
  if (!id || !title) return null;

  const cpv = [];
  if (isCpv(tender.classification)) cpv.push(tender.classification.id);
  cpv.push(...cpvFromItems(tender.items));
  for (const lot of tender.lots || []) cpv.push(...cpvFromItems(lot.items));

  const tenderPeriod = findDeep(tender, 'tenderPeriod');
  const tags = (release.tag || []).join(',').toLowerCase();
  const typ = /award|contract|implementation/.test(tags) ? 'Vergebener Auftrag'
    : /planning/.test(tags) ? 'Geplante Ausschreibung' : 'Ausschreibung';

  const docs = (tender.documents || []).filter((d) => d.url);
  const biddingDoc = docs.find((d) => /bidding|tender/i.test(d.documentType || '')) || docs[0];
  const loc = location(release);

  return {
    quelle: meta.id,
    externId: id,
    titel: title,
    beschreibung: text(tender.description),
    vergabestelle: buyerName(release),
    ort: loc.ort,
    plz: loc.plz,
    nuts: loc.nuts,
    cpv: [...new Set(cpv.map(cpvDigits).filter(Boolean))],
    typ,
    veroeffentlicht: toIsoDate(release.date),
    frist: toIsoDate(tenderPeriod?.endDate),
    url: `https://oeffentlichevergabe.de/ui/de/notices/${encodeURIComponent(id)}`,
    unterlagenUrl: biddingDoc?.url || null,
  };
}

/** Releases aus einer OCDS-Datei (Release-Package, Record-Package oder einzelnes Release). */
export function releasesFromDocument(doc) {
  if (Array.isArray(doc?.releases)) return doc.releases;
  if (Array.isArray(doc?.records)) {
    return doc.records.map((r) => r.compiledRelease || r.releases?.[0]).filter(Boolean);
  }
  if (doc?.tender) return [doc];
  return [];
}

export function parseExportZip(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const tenders = [];
  for (const [name, content] of Object.entries(files)) {
    if (!/\.json$/i.test(name)) continue;
    let doc;
    try { doc = JSON.parse(strFromU8(content)); } catch { continue; }
    for (const release of releasesFromDocument(doc)) {
      const t = parseRelease(release);
      if (t) tenders.push(t);
    }
  }
  return tenders;
}

export async function fetchTenders({ days = config.tageZurueck, log = console.log } = {}) {
  const all = [];
  // Der Export steht jeweils für abgeschlossene Tage bereit (bis gestern).
  for (let d = 1; d <= Math.max(days, 1); d += 1) {
    const day = todayIso(-d);
    try {
      const response = await httpFetch(`${EXPORT_URL}?pubDay=${day}&format=ocds.zip`, {
        timeoutMs: Math.max(config.requestTimeoutMs, 120000),
        userAgent: config.userAgent,
      });
      const tenders = parseExportZip(Buffer.from(await response.arrayBuffer()));
      log(`[oeffentlichevergabe] ${day}: ${tenders.length} Bekanntmachungen`);
      all.push(...tenders);
    } catch (error) {
      log(`[oeffentlichevergabe] ${day}: ${error.message}`);
      if (d === 1 && error.status == null) throw error; // Netzwerkfehler gleich beim ersten Tag melden
    }
  }
  return all;
}
