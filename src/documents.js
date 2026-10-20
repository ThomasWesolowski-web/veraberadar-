// Vergabeunterlagen laden und auswerten (PDF, GAEB, ZIP).
// Geladen werden nur frei zugängliche Direktlinks. Unterlagen hinter einem Portal-Login lädt man selbst herunter
// und übergibt sie im Dashboard ("Datei hinzufügen"); die Auswertung ist dieselbe.
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import config from './config.js';
import { addDocument, getTender } from './db.js';
import { isGaebFile, parseGaeb, summarizeGaeb } from './gaeb.js';
import { loadGewerke } from './relevance.js';
import { httpFetch, normalizeDe } from './text.js';

export function safeName(name) {
  const base = path.basename(String(name || 'datei').replace(/\\/g, '/'));
  return base.replace(/[^\w.\-äöüÄÖÜß ]+/g, '_').replace(/^\.+/, '').slice(0, 150) || 'datei';
}

function detectType(name, buffer) {
  if (buffer.subarray(0, 4).toString('latin1') === '%PDF' || /\.pdf$/i.test(name)) return 'pdf';
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return 'zip';
  if (isGaebFile(name)) return 'gaeb';
  const head = buffer.subarray(0, 400).toString('utf8');
  if (/<GAEB[\s>]/i.test(head)) return 'gaeb';
  if (/<html|<!doctype html/i.test(head)) return 'html';
  return 'sonstiges';
}

function gewerkMatcher() {
  const gewerke = loadGewerke();
  const all = gewerke.gewerke.flatMap((g) => g.stark.map((k) => ({ ...k, gewerk: g.name })));
  return {
    hits(text) {
      const norm = normalizeDe(text);
      const out = {};
      for (const k of all) {
        const count = (norm.match(new RegExp(k.re.source, 'g')) || []).length;
        if (count) out[k.gewerk] = (out[k.gewerk] || 0) + count;
      }
      return out;
    },
    test(text) {
      const norm = normalizeDe(text);
      return all.some((k) => k.re.test(norm));
    },
  };
}

export async function extractPdfText(buffer) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return { text: result.text || '', seiten: result.total ?? result.pages?.length ?? null };
  } finally {
    await parser.destroy?.();
  }
}

/** Wertet eine einzelne Datei aus und liefert eine JSON-taugliche Zusammenfassung. */
export async function analyzeFile(name, buffer, matcher = gewerkMatcher()) {
  const art = detectType(name, buffer);
  try {
    if (art === 'pdf') {
      const { text, seiten } = await extractPdfText(buffer);
      const fristen = [...new Set(text.match(/\b\d{1,2}\.\d{1,2}\.\d{4}\b/g) || [])].slice(0, 15);
      return {
        art,
        seiten,
        zeichen: text.length,
        gewerkTreffer: matcher.hits(text),
        datumsangaben: fristen,
        auszug: text.replace(/\s+/g, ' ').trim().slice(0, 1500),
        hinweis: text.trim().length < 50 ? 'Kaum Text gefunden – vermutlich ein eingescanntes Dokument.' : null,
      };
    }
    if (art === 'gaeb') {
      const summary = summarizeGaeb(parseGaeb(buffer, name), (t) => matcher.test(t));
      return { art, ...summary };
    }
    if (art === 'html') {
      return { art, hinweis: 'Der Link führt zu einer Portalseite, nicht direkt zu einer Datei. Bitte die Unterlagen dort herunterladen (ggf. mit Ihrem Zugang) und hier hinzufügen.' };
    }
    return { art, hinweis: 'Dateityp wird nicht ausgewertet.' };
  } catch (error) {
    return { art, fehler: `Auswertung fehlgeschlagen: ${error.message}` };
  }
}

function tenderDir(id) {
  const dir = path.join(config.dataDir, 'unterlagen', String(Number(id)));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Speichert eine Datei zur Ausschreibung, entpackt ZIP-Archive und wertet alles aus. */
export async function storeAndAnalyze(tenderId, filename, buffer) {
  const dir = tenderDir(tenderId);
  const matcher = gewerkMatcher();
  const saved = [];
  const name = safeName(filename);
  const art = detectType(name, buffer);

  const entries = art === 'zip'
    ? Object.entries(unzipSync(new Uint8Array(buffer))).filter(([n, c]) => !n.endsWith('/') && c.length)
      .map(([n, c]) => [safeName(n), Buffer.from(c)])
    : [[name, buffer]];

  if (art === 'zip') fs.writeFileSync(path.join(dir, name), buffer);
  for (const [entryName, content] of entries) {
    const target = path.join(dir, entryName);
    fs.writeFileSync(target, content);
    const auswertung = await analyzeFile(entryName, content, matcher);
    const id = addDocument({ ausschreibungId: tenderId, dateiname: entryName, pfad: target, art: auswertung.art, groesse: content.length, auswertung });
    saved.push({ id, dateiname: entryName, auswertung });
  }
  return saved;
}

/** Lädt die Unterlagen über den hinterlegten Direktlink herunter (nur frei zugängliche Links). */
export async function downloadDocuments(tenderId) {
  const tender = getTender(tenderId);
  if (!tender) throw new Error('Ausschreibung nicht gefunden.');
  const url = tender.unterlagen_url;
  if (!url) throw new Error('Für diese Ausschreibung ist kein direkter Link zu den Unterlagen bekannt.');
  if (!/^https?:\/\//i.test(url)) throw new Error('Ungültiger Link.');

  const response = await httpFetch(url, { timeoutMs: 120000, userAgent: config.userAgent, redirect: 'follow' });
  const length = Number(response.headers.get('content-length') || 0);
  if (length > config.unterlagenMaxMb * 1024 * 1024) throw new Error(`Datei größer als ${config.unterlagenMaxMb} MB.`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const disposition = response.headers.get('content-disposition') || '';
  const fromHeader = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
  const fromUrl = decodeURIComponent(new URL(response.url || url).pathname.split('/').pop() || '');
  const filename = fromHeader ? decodeURIComponent(fromHeader) : (fromUrl || 'unterlagen');
  return storeAndAnalyze(tenderId, filename, buffer);
}
