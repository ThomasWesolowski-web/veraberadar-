// GAEB-Auswertung (Leistungsverzeichnisse).
// Unterstützt GAEB DA XML (X81 Leistungsbeschreibung, X83 Angebotsaufforderung, X84 Angebotsabgabe, X86 Auftrag)
// sowie vereinfacht das ältere GAEB 90/2000-Textformat (D81/D83/P83).
import { XMLParser } from 'fast-xml-parser';

const XML_ARRAYS = new Set(['BoQCtgy', 'Item', 'TextComplement', 'p', 'span', 'Remark']);

function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).filter(Boolean).join(' ');
  if (typeof node === 'object') {
    return Object.entries(node)
      .filter(([k]) => !k.startsWith('@_'))
      .map(([k, v]) => (k === '#text' ? String(v) : textOf(v)))
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function parseXml(content) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    isArray: (name) => XML_ARRAYS.has(name),
  });
  const doc = parser.parse(content);
  const gaeb = doc.GAEB;
  if (!gaeb) throw new Error('Keine GAEB-XML-Datei (Element <GAEB> fehlt).');
  const award = gaeb.Award || {};
  const boq = award.BoQ || {};
  const positions = [];

  function walk(body, path) {
    if (!body) return;
    for (const ctgy of body.BoQCtgy || []) {
      const rno = ctgy['@_RNoPart'] ?? '';
      walk(ctgy.BoQBody, [...path, { rno, titel: clean(textOf(ctgy.LblTx)) }]);
    }
    const items = body.Itemlist?.Item || [];
    for (const item of items) {
      const outline = item.Description?.CompleteText?.OutlineText;
      const detail = item.Description?.CompleteText?.DetailTxt;
      positions.push({
        oz: [...path.map((p) => p.rno), item['@_RNoPart'] ?? ''].filter((x) => x !== '').join('.'),
        abschnitt: path.map((p) => p.titel).filter(Boolean).join(' › '),
        kurztext: clean(textOf(outline?.OutlTxt ?? outline)),
        langtext: clean(textOf(detail)).slice(0, 2000),
        menge: item.Qty != null ? Number(String(item.Qty).replace(',', '.')) : null,
        einheit: item.QU != null ? String(item.QU) : null,
        einheitspreis: item.UP != null ? Number(String(item.UP).replace(',', '.')) : null,
      });
    }
  }
  walk(boq.BoQBody, []);

  return {
    format: 'GAEB DA XML',
    phase: gaeb.GAEBInfo?.DP ?? award.DP ?? null,
    projekt: clean(textOf(gaeb.PrjInfo?.LblPrj || gaeb.PrjInfo?.NamePrj)) || null,
    lvBezeichnung: clean(textOf(boq.BoQInfo?.LblBoQ || boq.BoQInfo?.Name)) || null,
    positionen: positions,
  };
}

/**
 * GAEB 90/2000 (D8x/P8x): feste Satzlänge, Satzart in den Spalten 1–2.
 * 21 = Position (OZ, Menge, Einheit), 25 = Kurztext, 26 = Langtext.
 */
function parseText(content) {
  const positions = [];
  let current = null;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const art = line.slice(0, 2);
    if (art === '21') {
      current = { oz: line.slice(2, 11).trim(), abschnitt: '', kurztext: '', langtext: '', menge: null, einheit: null, einheitspreis: null };
      // Menge: 11 Ziffern mit 3 gedachten Nachkommastellen, direkt gefolgt von der Einheit
      const fixed = line.slice(11).match(/(\d{11})\s*([A-Za-zÄÖÜäöü][A-Za-z0-9²³\/.]{0,3})/);
      const loose = fixed ? null : line.slice(11).match(/(\d{1,9}[.,]\d{1,3})\s+([A-Za-zÄÖÜäöü][A-Za-z0-9²³\/.]{0,5})/);
      if (fixed) {
        current.menge = Number(fixed[1]) / 1000;
        current.einheit = fixed[2];
      } else if (loose) {
        current.menge = Number(loose[1].replace(',', '.'));
        current.einheit = loose[2];
      }
      positions.push(current);
    } else if (art === '25' && current) {
      current.kurztext = clean(`${current.kurztext} ${line.slice(2, 74)}`);
    } else if (art === '26' && current) {
      current.langtext = clean(`${current.langtext} ${line.slice(2, 74)}`).slice(0, 2000);
    }
  }
  return { format: 'GAEB 90/2000', phase: null, projekt: null, lvBezeichnung: null, positionen: positions };
}

export function isGaebFile(name) {
  return /\.(x8[0-9]|d8[0-9]|p8[0-9]|gaeb)$/i.test(name || '');
}

export function parseGaeb(content, filename = '') {
  const text = Buffer.isBuffer(content) ? decode(content) : String(content);
  if (/^\s*(<\?xml|<GAEB)/i.test(text) || /\.x8\d$/i.test(filename)) return parseXml(text);
  return parseText(text);
}

/** GAEB-XML ist UTF-8, alte Textformate meist Windows-1252/CP850. */
function decode(buffer) {
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('�')) return utf8;
  return new TextDecoder('windows-1252').decode(buffer);
}

/** Kurzübersicht für die Anzeige: Positionsanzahl und welche Positionen zu unseren Gewerken passen. */
export function summarizeGaeb(result, matchFn) {
  const relevant = matchFn ? result.positionen.filter((p) => matchFn(`${p.kurztext} ${p.langtext}`)) : [];
  return {
    format: result.format,
    phase: result.phase,
    projekt: result.projekt,
    lvBezeichnung: result.lvBezeichnung,
    anzahlPositionen: result.positionen.length,
    passendePositionen: relevant.length,
    positionen: result.positionen.slice(0, 500).map((p) => ({ ...p, passend: relevant.includes(p) })),
  };
}
