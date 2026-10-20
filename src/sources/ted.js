// TED (Tenders Electronic Daily, EU) über die offene Such-API v3. Kostenlos, ohne Anmeldung.
// Abfrageaufbau (Volltext + Land + Veröffentlichungsdatum, Pflichtfeld "fields") nach dem Vorbild
// von kwb.tenders (MIT-Lizenz, siehe NOTICE.md), hier zusätzlich mit CPV-Filter für Bauleistungen.
import config from '../config.js';
import { httpFetch, toIsoDate, cpvDigits } from '../text.js';

export const meta = { id: 'ted', name: 'TED (EU-Amtsblatt)' };

const API_URL = 'https://api.ted.europa.eu/v3/notices/search';

const BASE_FIELDS = [
  'publication-number', 'notice-title', 'notice-type', 'publication-date',
  'description-proc', 'description-lot', 'buyer-name', 'classification-cpv',
  'deadline-receipt-tender-date-lot', 'deadline-receipt-request-date-lot', 'deadline-date-lot',
  'place-of-performance',
];
// Zusatzfelder für Ort und Unterlagen. Lehnt die API eines davon ab, wird ohne sie wiederholt.
const EXTRA_FIELDS = ['buyer-city', 'buyer-post-code', 'document-url-lot'];

/** Wert aus sprachabhängigen Feldern ({ deu: [...] }) oder Listen holen. */
function pick(value, all = false) {
  if (value == null) return all ? [] : null;
  if (Array.isArray(value)) {
    const flat = value.flatMap((v) => (typeof v === 'object' && v !== null ? [pick(v)] : [v])).filter((v) => v != null && v !== '');
    return all ? [...new Set(flat.map(String))] : (flat[0] ?? null);
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    const lang = keys.find((k) => k.toLowerCase() === 'deu') || keys.find((k) => k.toLowerCase() === 'eng') || keys[0];
    return lang ? pick(value[lang], all) : (all ? [] : null);
  }
  return all ? [String(value)] : String(value);
}

/** TED-Titel haben die Form "Deutschland – Putzarbeiten – Eigentlicher Titel": nur den letzten Teil behalten. */
function cleanTitle(raw) {
  if (!raw) return 'Ohne Titel';
  const parts = String(raw).split(' – ');
  return parts[parts.length - 1].trim() || String(raw);
}

export function parseNotice(n) {
  const id = pick(n['publication-number']);
  if (!id) return null;
  const links = n.links || {};
  const html = links.html ? pick(links.html) : null;
  const pdf = links.pdf ? pick(links.pdf) : null;
  const typeRaw = String(pick(n['notice-type']) || '').toLowerCase();
  const typ = /can|award|result/.test(typeRaw) ? 'Vergebener Auftrag'
    : /pin|prior|planning/.test(typeRaw) ? 'Geplante Ausschreibung' : 'Ausschreibung';
  const frist = toIsoDate(pick(n['deadline-receipt-tender-date-lot']) || pick(n['deadline-receipt-request-date-lot']) || pick(n['deadline-date-lot']));
  const beschreibung = [pick(n['description-proc']), pick(n['description-lot'])].filter(Boolean);
  const nuts = pick(n['place-of-performance'], true).find((v) => /^DE[0-9A-Z]{1,3}$/.test(v)) || null;
  return {
    quelle: meta.id,
    externId: id,
    titel: cleanTitle(pick(n['notice-title'])),
    beschreibung: [...new Set(beschreibung)].join('\n\n') || null,
    vergabestelle: pick(n['buyer-name']),
    ort: pick(n['buyer-city']),
    plz: pick(n['buyer-post-code']),
    nuts,
    cpv: [...new Set(pick(n['classification-cpv'], true).map(cpvDigits).filter(Boolean))],
    typ,
    veroeffentlicht: toIsoDate(pick(n['publication-date'])),
    frist,
    url: html || `https://ted.europa.eu/de/notice/-/detail/${id}`,
    unterlagenUrl: pick(n['document-url-lot']) || pdf || null,
  };
}

export function buildQuery({ cpvCodes, terms, days }) {
  const parts = [];
  if (cpvCodes.length) parts.push(`classification-cpv IN (${cpvCodes.join(' ')})`);
  for (const t of terms) parts.push(`FT ~ "${t.replace(/"/g, '')}"`);
  return `(${parts.join(' OR ')}) AND place-of-performance IN (DEU) AND publication-date >= today(-${days})`;
}

async function search(query, fields, page, limit) {
  const response = await httpFetch(API_URL, {
    method: 'POST',
    timeoutMs: config.requestTimeoutMs,
    userAgent: config.userAgent,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, fields, page, limit, scope: 'ACTIVE' }),
  });
  return response.json();
}

export async function fetchTenders({ gewerke, days = config.tageZurueck, maxPages = 5, log = console.log } = {}) {
  const cpvCodes = [...new Set(gewerke.gewerke.flatMap((g) => g.cpv))];
  const terms = gewerke.gewerke.flatMap((g) => g.stark.slice(0, 6).map((k) => k.wort));
  const query = buildQuery({ cpvCodes, terms, days: Math.max(days, 1) });
  let fields = [...BASE_FIELDS, ...EXTRA_FIELDS];
  const results = [];
  for (let page = 1; page <= maxPages; page += 1) {
    let data;
    try {
      data = await search(query, fields, page, 100);
    } catch (error) {
      if (error.status === 400 && fields.length > BASE_FIELDS.length) {
        log('[ted] Zusatzfelder abgelehnt, wiederhole mit Grundfeldern.');
        fields = [...BASE_FIELDS];
        data = await search(query, fields, page, 100);
      } else {
        throw error;
      }
    }
    const notices = data?.notices || [];
    results.push(...notices.map(parseNotice).filter(Boolean));
    const total = data?.totalNoticeCount ?? notices.length;
    if (!notices.length || page * 100 >= total) break;
  }
  log(`[ted] ${results.length} Bekanntmachungen gefunden.`);
  return results;
}
