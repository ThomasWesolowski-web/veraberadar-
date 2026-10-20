// Serviceportal des Bundes (service.bund.de): öffentliche RSS-Feeds mit Ausschreibungen von Bund, Ländern
// und Kommunen, oft auch unterhalb der EU-Schwellenwerte. Kostenlos, ohne Anmeldung.
// Feed-Adressen und Auswertung der Beschreibungsfelder nach dem Vorbild von kwb.tenders (MIT, siehe NOTICE.md).
import { XMLParser } from 'fast-xml-parser';
import config from '../config.js';
import { httpFetch, stripHtml, toIsoDate } from '../text.js';

export const meta = { id: 'servicebund', name: 'Serviceportal des Bundes (service.bund.de)' };

const FEED_URL = 'https://www.service.bund.de/Content/Globals/Functions/RSSFeed/RSSGenerator_Ausschreibungen.xml';

function field(desc, label) {
  const m = desc.match(new RegExp(`${label}:\\s*([^|]+)`, 'i'));
  return m ? m[1].trim() : null;
}

export function parseFeed(xml) {
  const parser = new XMLParser({ ignoreAttributes: true, processEntities: true, htmlEntities: true });
  const doc = parser.parse(xml);
  let items = doc?.rss?.channel?.item || [];
  if (!Array.isArray(items)) items = [items];
  return items.map((item) => {
    const titel = String(item.title ?? '').trim();
    const link = String(item.link ?? '').replace(/#.*$/, '').trim();
    if (!titel || !link) return null;
    const desc = stripHtml(item.description);
    const ortRaw = field(desc, 'Erf.{0,3}llungsort');
    const plz = ortRaw?.match(/\b(\d{5})\b/)?.[1] || null;
    const ort = ortRaw ? ortRaw.replace(/\b\d{5}\b/, '').replace(/^[\s,]+|[\s,]+$/g, '') || null : null;
    const fristRaw = desc.match(/Angebotsfrist:\s*(\d{2}\.\d{2}\.\d{4})/)?.[1];
    const geplant = /beabsichtig|vorinformation|vorab.?information|transparenzbekanntmachung/i.test(titel);
    return {
      quelle: meta.id,
      externId: String(item.guid || link).replace(/#.*$/, '').trim(),
      titel,
      beschreibung: desc || null,
      vergabestelle: field(desc, 'Vergabestelle'),
      ort,
      plz,
      nuts: null,
      cpv: [],
      typ: geplant ? 'Geplante Ausschreibung' : 'Ausschreibung',
      veroeffentlicht: toIsoDate(item.pubDate),
      frist: toIsoDate(fristRaw),
      url: link,
      unterlagenUrl: null,
    };
  }).filter(Boolean);
}

export async function fetchTenders({ log = console.log } = {}) {
  const response = await httpFetch(FEED_URL, { timeoutMs: config.requestTimeoutMs, userAgent: config.userAgent });
  const tenders = parseFeed(await response.text());
  log(`[servicebund] ${tenders.length} Bekanntmachungen im Feed.`);
  return tenders;
}
