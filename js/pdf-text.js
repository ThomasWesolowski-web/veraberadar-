// Heuristische Erkennung von Rechnungsdaten aus dem Text einer (deutschen) PDF-Rechnung.
// Ergebnis ist ein Vorschlag – alle Felder müssen vom Anwender geprüft werden.
import { emptyInvoice, emptyLine, emptyAllowance, isValidIban, isValidVatId } from './model.js';

const AMOUNT = String.raw`-?\d{1,3}(?:[.\s']\d{3})+,\d{2}|-?\d+,\d{2}|-?\d{1,3}(?:,\d{3})+\.\d{2}|-?\d+\.\d{2}`;
const MONTHS = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
const MONTH_RE = String.raw`(?:Januar|Jänner|Februar|März|Maerz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)`;
const DATE = String.raw`\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}|\d{1,2}\.\s?${MONTH_RE}\s+\d{4}`;

/** "1.234,56" / "1234,56" / "1,234.56" → 1234.56 */
export function parseAmount(s) {
  if (s === undefined || s === null) return NaN;
  let t = String(s).replace(/[€\s']|EUR/g, '');
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  if (lastComma > lastDot) {
    // deutsches Format: Punkt = Tausender, Komma = Dezimal ("1.234,5" / "7,5")
    t = t.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma && lastComma >= 0) {
    t = t.replace(/,/g, ''); // englisches Format "1,234.56"
  } else if (lastDot >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, ''); // "1.234" als Tausender
  }
  return Number(t);
}

/** "24.11.2026" / "24.11.26" / "24. November 2026" → "2026-11-24" */
export function parseGermanDate(s) {
  const str = String(s || '');
  let d; let mo; let y;
  let m = /(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})/.exec(str);
  if (m) {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    m = new RegExp(String.raw`(\d{1,2})\.\s?(${MONTH_RE})\s+(\d{4})`, 'i').exec(str);
    if (!m) return '';
    const name = m[2].toLowerCase().replace('maerz', 'märz').replace('jänner', 'januar');
    [d, mo, y] = [Number(m[1]), MONTHS.indexOf(name) + 1, Number(m[3])];
  }
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysBetween(fromIso, toIso) {
  if (!fromIso || !toIso) return NaN;
  return Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / 86400000);
}

function firstMatch(text, regexes) {
  for (const re of regexes) {
    const m = re.exec(text);
    if (m) return m;
  }
  return null;
}

const UNIT_WORDS = [
  [/^(stk\.?|stück|st\.?|x)$/i, 'C62'],
  [/^(std\.?|stunden?|h)$/i, 'HUR'],
  [/^(tage?|tg\.?)$/i, 'DAY'],
  [/^(wo\.?|wochen?)$/i, 'WEE'],
  [/^(monate?|mon\.?)$/i, 'MON'],
  [/^(pausch\.?|pauschal|psch\.?|pauschale|pa\.?|ls)$/i, 'LS'],
  [/^(kg)$/i, 'KGM'],
  [/^(t|to\.?)$/i, 'TNE'],
  [/^(m|lfm\.?|lfdm\.?|lm)$/i, 'MTR'],
  [/^(km)$/i, 'KMT'],
  [/^(m2|m²|qm)$/i, 'MTK'],
  [/^(m3|m³|cbm)$/i, 'MTQ'],
  [/^(l|ltr\.?|liter)$/i, 'LTR'],
  [/^(kwh)$/i, 'KWH'],
  [/^(min\.?|minuten?)$/i, 'MIN'],
  [/^(satz|set)$/i, 'SET'],
  [/^(pck\.?|pak\.?|paket|packung)$/i, 'XPK'],
  [/^(dose|rolle|sack|eimer|kanister|karton|beutel|tube|kartusche|palette|bund)$/i, 'C62'],
];
export function unitFromWord(w) {
  for (const [re, code] of UNIT_WORDS) if (re.test(String(w || '').trim())) return code;
  return null;
}

// ----------------------------------------------------------------- Layout

/**
 * Rekonstruiert Textzeilen aus pdf.js-Textelementen.
 * Größere Lücken innerhalb einer Zeile werden als Tabulator markiert, Zeilen,
 * die erst in der rechten Seitenhälfte beginnen, beginnen mit einem Tabulator.
 * So lassen sich Spalten (z. B. Briefkopf rechts neben der Anschrift) trennen.
 */
export function itemsToLines(items, pageWidth = 595) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const h = Math.abs(it.height || it.transform[3] || 10);
    let row = rows.find((r) => Math.abs(r.y - y) < Math.max(2, h * 0.4));
    if (!row) { row = { y, parts: [] }; rows.push(row); }
    row.parts.push({ x, str: it.str, w: it.width || 0, h });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => {
    r.parts.sort((a, b) => a.x - b.x);
    let line = r.parts[0].x > pageWidth * 0.5 ? '\t' : '';
    let lastEnd = null;
    for (const p of r.parts) {
      if (lastEnd !== null) {
        const gap = p.x - lastEnd;
        if (gap > Math.max(25, p.h * 2.5)) line += '\t';
        else if (gap > 1) line += ' ';
      }
      line += p.str;
      lastEnd = p.x + p.w;
    }
    return line.replace(/[  ]+/g, ' ').replace(/ ?\t ?/g, '\t').trimEnd();
  });
}

// ----------------------------------------------------------------- Positionen

const POS = String.raw`\d{1,3}(?:\.\d{1,3}){0,3}`;
const QTY = String.raw`-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:,\d+)?`;
const UNIT_TOKEN = String.raw`[A-Za-zÄÖÜäöü²³]{1,10}\.?`;
const TAIL_AMOUNTS = new RegExp(String.raw`\s+(${AMOUNT})\s*(?:€|EUR)?\s+(?:(\d{1,2}(?:,\d+)?)\s*%\s+)?(${AMOUNT})\s*(?:€|EUR)?$`);
const ONLY_AMOUNTS = new RegExp(String.raw`^(${AMOUNT})\s*(?:€|EUR)?\s+(${AMOUNT})\s*(?:€|EUR)?$`);
const STOP_ITEMS = /^(Titelzusammenstellung|Zwischensumme|Nettosumme|Netto(?:betrag)?\b|Summe\s+(?:netto|positionen)|Gesamtsumme|Rechnungsbetrag|Bruttosumme|Übersicht der)/i;
const SKIP_HEADER = /^(Pos\.?\s+(?:Menge|Anz)|Titel\s|Titelsumme|Übertrag|Seite\s+\d+|\[.*\]\s*-\s*Seite\s+\d+)/i;

/** Erkennt den Beginn einer Position. Liefert { pos, qty, unitWord, rest } oder null. */
function matchPosStart(line, withPos) {
  const re = withPos
    ? new RegExp(String.raw`^(${POS})\.?\s+(${QTY})\s+(${UNIT_TOKEN})\s+(\S.*)$`)
    : new RegExp(String.raw`^(?:(\d{1,3})[.)]?\s+)?(${QTY})\s*(${UNIT_TOKEN})?\s+(\S.*)$`);
  const m = re.exec(line);
  if (!m) return null;
  return { pos: m[1] || '', qty: m[2], unitWord: m[3] || '', rest: m[4] };
}

function buildItem(start, priceS, rateS, totalS) {
  let name = start.rest;
  let unit = unitFromWord(start.unitWord);
  if (start.unitWord && !unit) { name = `${start.unitWord} ${name}`; unit = 'C62'; }
  const quantity = parseAmount(start.qty);
  const price = parseAmount(priceS);
  const total = parseAmount(totalS);
  if (!quantity || !Number.isFinite(price) || !Number.isFinite(total)) return null;
  // Plausibilität: Menge × Preis ≈ Gesamt (Toleranz 1 % für Rundung/Positionsrabatte)
  if (Math.abs(quantity * price - total) > Math.max(0.02, Math.abs(total) * 0.01)) return null;
  const l = emptyLine();
  l.name = name.trim();
  l.articleNo = start.pos;
  l.quantity = quantity;
  l.unit = unit || 'C62';
  l.price = price;
  if (Math.abs(Math.round(quantity * price * 100) / 100 - total) > 0.005) {
    // abweichender Gesamtpreis (z. B. Positionsrabatt) → Einzelpreis aus Gesamtpreis ableiten
    l.price = Math.round((total / quantity) * 10000) / 10000;
  }
  if (rateS) l.vatRate = parseAmount(rateS);
  l.total = total;
  return l;
}

/**
 * Positionen inkl. mehrzeiliger Langtexte. Unterstützt Positionsnummern wie
 * "1", "02.1", "02.02.6" sowie Preise in einer Folgezeile.
 */
function parseLineItems(lines, boilerplate) {
  const items = [];
  let current = null;
  let pending = null; // Positionsbeginn ohne Preise – Preise folgen in späterer Zeile
  let pendingText = [];
  const hasPosNumbers = lines.filter((l) => matchPosStart(l, true)).length >= 2;

  const finishDescription = () => {
    if (current) current.description = current.description.replace(/\s+\n/g, '\n').trim();
  };

  for (const line of lines) {
    if (STOP_ITEMS.test(line)) { finishDescription(); current = null; pending = null; break; }
    if (boilerplate.has(line) || SKIP_HEADER.test(line)) continue;

    const start = matchPosStart(line, hasPosNumbers);
    if (start && !/\(Fortsetzung\)/i.test(line)) {
      const tail = TAIL_AMOUNTS.exec(' ' + start.rest);
      if (tail) {
        const s2 = { ...start, rest: (' ' + start.rest).slice(0, tail.index).trim() };
        const item = s2.rest ? buildItem(s2, tail[1], tail[2], tail[3]) : null;
        if (item) {
          finishDescription();
          item.description = '';
          items.push(item);
          current = item;
          pending = null;
          continue;
        }
      } else if (hasPosNumbers) {
        finishDescription();
        current = null;
        pending = start;
        pendingText = [];
        continue;
      }
    }
    if (pending) {
      const only = ONLY_AMOUNTS.exec(line);
      if (only) {
        const item = buildItem(pending, only[1], null, only[2]);
        if (item) {
          item.description = pendingText.join('\n');
          items.push(item);
          current = item;
        }
        pending = null;
        continue;
      }
      pendingText.push(line);
      continue;
    }
    if (current) {
      const cont = /^\S+\s+\(Fortsetzung\)\s*(.*)$/i.exec(line);
      const text = cont ? cont[1] : line;
      if (text) current.description += (current.description ? '\n' : '') + text;
    }
  }
  finishDescription();
  for (const it of items) {
    const dl = it.description ? it.description.split('\n') : [];
    // Bezeichnung umbricht in die nächste Zeile ("Abdeckarbeiten an empfindlichen" / "Bauteilen")
    if (dl.length >= 2 && dl[0].length <= 40 && !/[.,:;]$/.test(dl[0]) && dl[1].startsWith(it.name)) {
      it.name = `${it.name} ${dl.shift()}`;
    }
    // Bezeichnung, die im Langtext wiederholt wird, nicht doppelt führen
    if (dl.length && dl[0] === it.name) dl.shift();
    it.description = dl.join('\n');
    if (it.description.length > 4000) it.description = it.description.slice(0, 4000) + ' …';
  }
  return items;
}

/** Zeilen, die auf mehreren Seiten wiederkehren (Kopf-/Fußzeilen) */
function findBoilerplate(lines) {
  const count = new Map();
  for (const l of lines) count.set(l, (count.get(l) || 0) + 1);
  const pages = Math.max(1, lines.filter((l) => /Seite\s+\d+\s+von\s+\d+/i.test(l)).length);
  const min = pages >= 3 ? 3 : 2;
  return new Set([...count].filter(([l, c]) => c >= min && l.length > 3 && !/^\d+(?:[.,]\d+)?$/.test(l)).map(([l]) => l));
}

// ----------------------------------------------------------------- Adressen

const ZIP_CITY = /^(?:D-)?(\d{5})\s+([A-ZÄÖÜ][\wäöüßÄÖÜ .\-/()]+)$/;
const SALUTATION = /^(Herrn?|Frau|Firma|Familie|Fam\.|An|z\.\s?Hd\.?.*)$/i;

function addressAround(lines, idx) {
  const m = ZIP_CITY.exec(lines[idx].trim());
  if (!m) return null;
  const street = (lines[idx - 1] || '').trim();
  let name = (lines[idx - 2] || '').trim();
  if (SALUTATION.test(name)) name = '';
  return { zip: m[1], city: m[2].trim(), street, name };
}

function splitSenderLine(line) {
  const parts = line.split(/\s+[·•|+–]\s+|\s*[·•|]\s*/).map((p) => p.trim()).filter(Boolean);
  const zipPart = parts.findIndex((p) => /^\d{5}\s+\S/.test(p));
  if (zipPart < 1) return null;
  const zm = /^(\d{5})\s+(.+)$/.exec(parts[zipPart]);
  return { name: parts[0], street: zipPart >= 2 ? parts[zipPart - 1] : '', zip: zm[1], city: zm[2] };
}

// ----------------------------------------------------------------- Hauptfunktion

/**
 * Wertet extrahierten PDF-Text aus.
 * @param {string} text Volltext, Zeilen durch \n getrennt (Spalten optional durch \t)
 * @returns {{ invoice: object, found: string[], warnings: string[], detected: object }}
 */
export function parseInvoiceText(text) {
  const inv = emptyInvoice();
  inv.issueDate = '';
  const found = [];
  const warnings = [];
  const rawLines = String(text || '').split(/\r?\n/);
  const lines = rawLines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // linke Spalte (für Anschriften): rechte Randspalten wie Slogans/Briefkopf entfernen
  const leftLines = rawLines.map((l) => l.split('\t')[0].replace(/\s+/g, ' ').trim()).filter(Boolean);
  const all = lines.join('\n');
  const boilerplate = findBoilerplate(lines);

  // Rechnungsart
  if (/(?:^|\n)\s*Schlussrechnung\b/i.test(all)) { inv.type = '877'; found.push('Rechnungsart: Schlussrechnung'); }
  else if (/(?:^|\n)\s*(?:Abschlags|Teilschluss)rechnung\b/i.test(all)) {
    inv.type = /Teilschluss/i.test(all) ? '876' : '875'; found.push('Rechnungsart: Abschlagsrechnung');
  } else if (/(?:^|\n)\s*(?:Storno|Korrektur)rechnung\b/i.test(all)) { inv.type = '384'; found.push('Rechnungsart: Korrekturrechnung'); }
  else if (/(?:^|\n)\s*Gutschrift\b/i.test(all)) { inv.type = '389'; found.push('Rechnungsart: Gutschrift'); }

  // Rechnungsnummer
  const NR = String.raw`([A-Z0-9][A-Z0-9\-/_.]{1,30})`;
  let m = firstMatch(all, [
    new RegExp(String.raw`(?:Rechnungs|Gutschrifts?)[\s-]*(?:nummer|nr\.?|no\.?)\s*[:#.]?\s*${NR}`, 'i'),
    new RegExp(String.raw`(?:Schluss|Abschlags|Teil|Storno)?[Rr]echnung\s+(?:Nr\.?|Nummer|#)\s*[:.]?\s*${NR}`),
    new RegExp(String.raw`Invoice\s*(?:No\.?|Number|#)\s*[:.]?\s*${NR}`, 'i'),
    new RegExp(String.raw`Beleg(?:nummer|nr\.?)\s*[:.]?\s*${NR}`, 'i'),
    new RegExp(String.raw`(?:^|\n)\s*Nr\.?\s*[:.]\s*${NR}`, 'i'),
  ]);
  if (m) { inv.number = m[1].replace(/[.]$/, ''); found.push('Rechnungsnummer'); }

  // Rechnungsdatum
  m = firstMatch(all, [
    new RegExp(String.raw`Rechnungsdatum\s*[:.]?\s*(${DATE})`, 'i'),
    new RegExp(String.raw`(?:Belegdatum|Ausstellungsdatum|Invoice date)\s*[:.]?\s*(${DATE})`, 'i'),
    new RegExp(String.raw`(?:^|\n)\s*(?:Schluss|Abschlags|Teil|Storno|Korrektur)?[Rr]echnung\s+(?:vom\s+)?(${DATE})`),
    new RegExp(String.raw`(?:^|\n)Datum\s*[:.]?\s*(${DATE})`, 'i'),
    new RegExp(String.raw`[A-ZÄÖÜ][a-zäöüß]+,\s*(?:den\s*)?(${DATE})`),
  ]);
  if (m) { inv.issueDate = parseGermanDate(m[1]); found.push('Rechnungsdatum'); }

  // Leistungszeitraum / -datum
  m = new RegExp(String.raw`(?:Leistungszeitraum|Abrechnungszeitraum|Ausführungszeitraum|Zeitraum)\s*[:.]?\s*(?:vom\s*)?(${DATE})\s*(?:-|–|bis(?:\s+zum)?)\s*(${DATE})`, 'i').exec(all);
  if (m) {
    inv.periodStart = parseGermanDate(m[1]);
    inv.periodEnd = parseGermanDate(m[2]);
    found.push('Leistungszeitraum');
  } else {
    m = firstMatch(all, [
      new RegExp(String.raw`(?:Liefer|Leistungs|Ausführungs)(?:datum|tag)\s*[:.]?\s*(${DATE})`, 'i'),
      new RegExp(String.raw`(?:Leistung|Lieferung|Arbeiten)\w*\s+(?:wurden?|erfolgten?)\s+(?:am|bis\s+zum|bis)\s+(${DATE})`, 'i'),
      new RegExp(String.raw`(?:geliefert|ausgeführt|erbracht)\s+am\s+(${DATE})`, 'i'),
    ]);
    if (m) { inv.deliveryDate = parseGermanDate(m[1]); found.push('Leistungsdatum'); }
    else if (/Leistungsdatum\s*(?:entspricht|=|gleich)\s*Rechnungsdatum/i.test(all) && inv.issueDate) {
      inv.deliveryDate = inv.issueDate; found.push('Leistungsdatum (= Rechnungsdatum)');
    }
  }

  // Referenzen
  m = /Kunden[\s-]*(?:nummer|nr\.?)\s*[:.]?\s*([A-Z0-9][\w\-/.]{0,30})/i.exec(all);
  if (m) { inv.buyer.id = m[1]; found.push('Kundennummer'); }
  m = /Projekt[\s-]*(?:nummer|nr\.?)\s*[:.]?\s*([A-Z0-9][\w\-/.]{0,30})/i.exec(all);
  if (m) { inv.projectReference = m[1]; found.push('Projektnummer'); }
  m = /(?:Vertrags[\s-]*(?:nummer|nr\.?)|Auftrag\s+vom)\s*[:.]?\s*([A-Z0-9][\w\-/.]{0,30})/i.exec(all);
  if (m) inv.contractReference = m[1];

  // Fälligkeit
  m = new RegExp(String.raw`(?:fällig\s*(?:am|bis|zum)?|zahlbar\s*bis(?:\s*zum)?|(?:Netto)?zahlungsziel|Fälligkeit(?:sdatum)?|zahlen\s+Sie\s+(?:bitte\s+)?bis(?:\s+zum)?)\s*[:.]?\s*(${DATE})`, 'i').exec(all);
  if (m) { inv.dueDate = parseGermanDate(m[1]); found.push('Fälligkeitsdatum'); }
  else {
    m = /(?:innerhalb|binnen)\s+(?:von\s+)?(\d{1,3})\s+Tag/i.exec(all);
    if (m && inv.issueDate) {
      const d = new Date(inv.issueDate + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + Number(m[1]));
      inv.dueDate = d.toISOString().slice(0, 10);
      inv.payment.terms = `Zahlbar innerhalb von ${m[1]} Tagen ohne Abzug.`;
      found.push('Zahlungsziel');
    }
  }
  if (inv.dueDate && !inv.payment.terms) {
    const dd = inv.dueDate.split('-').reverse().join('.');
    inv.payment.terms = `Zahlbar bis zum ${dd} ohne Abzug.`;
  }

  // Skonto
  const PCT = String.raw`\d{1,2}(?:,\d{1,2})?`;
  let sk = new RegExp(String.raw`(${PCT})\s*%\s*Skonto\s*(?:bei\s*Zahlung\s*)?(?:innerhalb|binnen)\s*(?:von\s*)?(\d{1,3})\s*Tag`, 'i').exec(all);
  if (sk) { inv.payment.skontoPercent = String(parseAmount(sk[1])); inv.payment.skontoDays = sk[2]; }
  else if ((sk = new RegExp(String.raw`(?:innerhalb|binnen)\s*(?:von\s*)?(\d{1,3})\s*Tag\w*\s*(${PCT})\s*%\s*Skonto`, 'i').exec(all))) {
    inv.payment.skontoDays = sk[1]; inv.payment.skontoPercent = String(parseAmount(sk[2]));
  } else if ((sk = new RegExp(String.raw`bis\s+(?:zum\s+)?(${DATE})[^\n]{0,40}?(${PCT})\s*%\s*Skonto`, 'i').exec(all))
    || (sk = new RegExp(String.raw`(${PCT})\s*%\s*Skonto[^\n]{0,40}?bis\s+(?:zum\s+)?(${DATE})`, 'i').exec(all))) {
    const dateFirst = /^\d{1,2}\./.test(sk[1]) && sk[1].length > 5;
    const date = parseGermanDate(dateFirst ? sk[1] : sk[2]);
    const days = daysBetween(inv.issueDate, date);
    if (days >= 0) { inv.payment.skontoDays = String(days); inv.payment.skontoPercent = String(parseAmount(dateFirst ? sk[2] : sk[1])); }
    else sk = null;
  }
  if (sk) found.push('Skonto');

  // IBAN / BIC
  const ibanRe = /\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?)\b/g;
  for (const im of all.matchAll(ibanRe)) {
    const cand = im[1].replace(/\s+/g, '');
    for (let len = Math.min(cand.length, 34); len >= 15; len--) {
      if (isValidIban(cand.slice(0, len))) { inv.payment.iban = cand.slice(0, len); break; }
    }
    if (inv.payment.iban) { found.push('IBAN'); break; }
  }
  m = /\b(?:BIC|SWIFT)(?:[\s-]*Code)?\s*[:.]?\s*([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/.exec(all);
  if (m) { inv.payment.bic = m[1]; found.push('BIC'); }
  m = /(?:Verwendungszweck|Zahlungsreferenz)\s*[:.]?\s*(.+)/i.exec(all);
  inv.payment.reference = m ? m[1].trim() : inv.number;

  // Steuer-IDs
  const vatIds = [...all.matchAll(/\b((?:DE|AT|FR|NL|BE|IT|ES|PL|CZ|DK|LU|CH)\s?[0-9A-Z]{8,12})\b/g)]
    .map((x) => x[1].replace(/\s+/g, ''))
    .filter((v, i, arr) => arr.indexOf(v) === i && isValidVatId(v) && /\d{8}/.test(v));
  const buyerVatM = /(?:Ihre|Kunden|Empfänger)[\s-]*(?:USt\.?[\s-]*Id(?:Nr|ent)?\.?|UID)[^\n]*?\b([A-Z]{2}\s?[0-9A-Z]{8,12})\b/i.exec(all);
  if (buyerVatM) inv.buyer.vatId = buyerVatM[1].replace(/\s+/g, '');
  const sellerVat = vatIds.find((v) => v !== inv.buyer.vatId);
  if (sellerVat) { inv.seller.vatId = sellerVat; found.push('USt-IdNr. Verkäufer'); }
  m = /(?:Steuer[\s-]*(?:nummer|nr\.?)|St\.?[\s-]*Nr\.?)\s*[:.]?\s*(\d{2,5}\s?\/\s?\d{3,5}(?:\s?\/\s?\d{4,5})?|\d{10,13})\b/i.exec(all);
  if (m) { inv.seller.taxNumber = m[1].replace(/\s+/g, ''); found.push('Steuernummer'); }
  m = /\b(HRB|HRA|GnR|PR|VR)\s?(\d{1,7}\s?[A-Z]?)\b/.exec(all);
  if (m) inv.seller.registrationId = `${m[1]} ${m[2]}`.trim();

  // Kontakt
  const emails = [...all.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((x) => x[0]);
  if (emails.length) {
    inv.seller.contactEmail = emails[0];
    inv.seller.endpoint = emails[0];
    found.push('E-Mail');
  }
  m = /(?:Tel(?:efon)?\.?|Fon|Phone|Mobil|Handy)\s*[:.]?\s*(\+?\d[\d\s/()-]{5,20}\d)/i.exec(all)
    || /(?:^|\s)((?:\+49\s?|0)\d{2,5}\s?[/-]?\s?\d[\d ]{4,12}\d)(?=\s|$)/m.exec(all.replace(/\b[A-Z]{2}\d{2}(?:\s?\d{4}){4,5}\s?\d{0,2}\b/g, ''));
  if (m) { inv.seller.contactPhone = m[1].trim(); found.push('Telefon'); }

  // Leitweg-ID / Käuferreferenz
  m = /Leitweg[\s-]*(?:ID|Nr\.?)?\s*[:.]?\s*(\d{2,12}(?:-[A-Z0-9]{1,30})?-\d{2})/i.exec(all);
  if (m) {
    inv.buyerReference = m[1];
    inv.buyer.endpoint = m[1];
    inv.buyer.endpointScheme = '0204';
    found.push('Leitweg-ID');
  } else {
    m = /(?:Bestell(?:nummer|nr\.?)|Ihre\s*Bestellung|Auftrags(?:nummer|nr\.?)|Ihr Zeichen)\s*[:.]?\s*([A-Z0-9][\w\-/.]{1,30})/i.exec(all);
    if (m) { inv.orderReference = m[1]; inv.buyerReference = m[1]; found.push('Bestellnummer'); }
    else if (inv.projectReference) { inv.buyerReference = inv.projectReference; found.push('Käuferreferenz = Projektnummer'); }
    else if (inv.buyer.id) { inv.buyerReference = inv.buyer.id; found.push('Käuferreferenz = Kundennummer'); }
  }

  // Adressen: Absenderzeile ("Firma · Straße · PLZ Ort") und Empfängerblock
  const senderIdx = leftLines.findIndex((l) => /\s[·•|+–]\s|[·•|]/.test(l) && /\b\d{5}\s+\S/.test(l) && splitSenderLine(l));
  if (senderIdx >= 0) {
    Object.assign(inv.seller, splitSenderLine(leftLines[senderIdx]));
    found.push('Absenderadresse');
  }
  const zipIdx = leftLines
    .map((l, i) => (ZIP_CITY.test(l) && i !== senderIdx && !boilerplate.has(l) ? i : -1))
    .filter((i) => i >= 2);
  if (zipIdx.length) {
    const a = addressAround(leftLines, zipIdx[0]);
    if (a) {
      Object.assign(inv.buyer, { name: a.name, street: a.street, zip: a.zip, city: a.city });
      found.push('Empfängeradresse');
      if (!a.name) warnings.push('Name des Rechnungsempfängers nicht sicher erkannt – bitte ergänzen.');
      if (!inv.seller.name && zipIdx.length > 1) {
        const s = addressAround(leftLines, zipIdx[zipIdx.length - 1]);
        if (s && s.zip !== a.zip) {
          Object.assign(inv.seller, { name: s.name, street: s.street, zip: s.zip, city: s.city });
          found.push('Absenderadresse (Fußzeile)');
        }
      }
    }
  }

  // Pflichthinweis nach § 14b UStG (Aufbewahrung durch Privatpersonen) übernehmen
  m = /((?:[^\n]*\n){0,2}[^\n]*§\s*14b[\s\S]{0,300}?aufzubewahren\.?)/i.exec(all);
  if (m) {
    let hint = m[1].replace(/\s*\n\s*/g, ' ');
    const start = hint.search(/Wichtiger Hinweis|Hinweis:|Soweit|Sofern|Als Privat|Sie sind|Gemäß|Nach §/i);
    if (start > 0) hint = hint.slice(start);
    inv.note = hint.replace(/^(?:Wichtiger\s+)?Hinweis:\s*/i, '').trim();
    found.push('Hinweis § 14b UStG');
  }

  // Positionen
  const items = parseLineItems(lines, boilerplate);

  // Summen
  const grab = (re) => {
    const mm = re.exec(all);
    return mm ? parseAmount(mm[1]) : NaN;
  };
  const SEP = String.raw`\s*[:=.]?\s*(?:EUR|€)?\s*`;
  const subtotal = grab(new RegExp(String.raw`(?:Zwischensumme|Summe\s+Positionen|Positionssumme)${SEP}(${AMOUNT})`, 'i'));
  let net = grab(new RegExp(String.raw`(?:Netto(?:betrag|summe)|Summe\s*netto|Gesamt\s*netto|Rechnungsbetrag\s*netto|Nettowert)${SEP}(${AMOUNT})`, 'i'));
  if (!Number.isFinite(net)) net = grab(new RegExp(String.raw`(?:^|\n)\s*Netto${SEP}(${AMOUNT})`, 'i'));
  if (!Number.isFinite(net)) net = subtotal;
  const gross = grab(new RegExp(String.raw`(?:Brutto(?:betrag|summe)|Summe\s*brutto|Gesamt(?:betrag|summe)(?:\s*brutto)?|Rechnungsbetrag(?!\s*netto)|Endbetrag|(?:^|\n)\s*Brutto)${SEP}(${AMOUNT})`, 'i'));
  const payable = grab(new RegExp(String.raw`(?:zu\s*zahlen(?:der\s*Betrag)?|Zahlbetrag|Restbetrag|noch\s+zu\s+zahlen|offener\s+Betrag)${SEP}(${AMOUNT})`, 'i'));
  const vatM = new RegExp(String.raw`(?:MwSt\.?|USt\.?|Umsatzsteuer|Mehrwertsteuer)\s*(?:\(?\s*(\d{1,2}(?:,\d+)?)\s*%\s*\)?)?[^\n\d]{0,25}(${AMOUNT})\s*(?:€|EUR)?\s*$`, 'im').exec(all);
  let rate = NaN;
  let vat = NaN;
  if (vatM) {
    rate = vatM[1] ? parseAmount(vatM[1]) : NaN;
    vat = parseAmount(vatM[2]);
  }
  if (!Number.isFinite(rate) || rate === 0) {
    const rm = /(\d{1,2})(?:,0+)?\s*%\s*(?:MwSt|USt|Umsatzsteuer|Mehrwertsteuer)/i.exec(all);
    if (rm) rate = Number(rm[1]);
  }
  if (!Number.isFinite(rate) && Number.isFinite(net) && Number.isFinite(vat) && net) {
    rate = Math.round((vat / net) * 100);
  }

  const reverseCharge = /Steuerschuldnerschaft des Leistungsempfängers|Reverse[\s-]?Charge|§\s*13b/i.test(all);
  const kleinunternehmer = /§\s*19\s*(?:Abs\.\s*1\s*)?UStG|Kleinunternehmer/i.test(all);
  const igl = /innergemeinschaftliche\s+Lieferung|§\s*4\s*Nr\.\s*1\s*b/i.test(all);

  let category = 'S';
  if (reverseCharge) category = 'AE';
  else if (igl) category = 'K';
  else if (kleinunternehmer) category = 'E';
  if (category !== 'S') {
    found.push(`Steuerfall: ${category === 'AE' ? 'Reverse Charge' : category === 'K' ? 'innergemeinschaftl. Lieferung' : 'Kleinunternehmer'}`);
    if (category === 'E') inv.exemptions.E = { reason: 'Steuerfrei nach § 19 UStG (Kleinunternehmerregelung)', code: '' };
  }
  const mainRate = category === 'S' ? (Number.isFinite(rate) && rate > 0 ? rate : 19) : 0;

  // Rabatt / Nachlass auf Rechnungsebene
  m = new RegExp(String.raw`(?:^|\n)\s*(Rabatt|Nachlass|Preisnachlass|Sonderrabatt|Projektrabatt)\s*(?:-?\s*(${PCT})\s*%)?[^\n]*?(-?\s?${AMOUNT})\s*(?:€|EUR)?\s*(?:\n|$)`, 'i').exec(all);
  if (m && items.length) {
    const a = emptyAllowance(false);
    a.reason = m[1];
    a.percent = m[2] ? String(parseAmount(m[2])) : '';
    a.amount = Math.abs(parseAmount(m[3].replace(/\s/g, '')));
    a.vatCategory = category;
    a.vatRate = mainRate;
    inv.allowances = [a];
    found.push(`${m[1]}${m[2] ? ` ${m[2]} %` : ''} auf Rechnungsebene`);
  }

  if (items.length) {
    for (const l of items) {
      l.vatCategory = category;
      if (category === 'S') l.vatRate = l.vatRate && l.vatRate !== 19 ? l.vatRate : mainRate;
      else l.vatRate = 0;
      delete l.total;
    }
    inv.lines = items;
    found.push(`${items.length} Position(en)`);
    const sum = Math.round(items.reduce((acc, l) => acc + Math.round(l.quantity * l.price * 100) / 100, 0) * 100) / 100;
    const ref = Number.isFinite(subtotal) ? subtotal : (inv.allowances.length ? NaN : net);
    if (Number.isFinite(ref) && Math.abs(sum - ref) > 0.05)
      warnings.push(`Summe der erkannten Positionen (${sum.toFixed(2)} €) weicht von der Summe in der PDF (${ref.toFixed(2)} €) ab – bitte Positionen prüfen.`);
  } else {
    const l = emptyLine();
    l.name = 'Leistung gemäß beigefügter Rechnung';
    l.unit = 'LS';
    l.vatCategory = category;
    l.vatRate = mainRate;
    let netValue = net;
    if (!Number.isFinite(netValue) && Number.isFinite(gross)) {
      netValue = category === 'S' ? Math.round((gross / (1 + l.vatRate / 100)) * 100) / 100 : gross;
    }
    l.price = Number.isFinite(netValue) ? netValue : 0;
    inv.lines = [l];
    warnings.push('Keine Einzelpositionen erkannt – es wurde eine Sammelposition angelegt. Bitte Leistungsbeschreibung und Menge ergänzen (§ 14 Abs. 4 Nr. 5 UStG).');
  }

  // Bereits gezahlte Beträge (Abschlagszahlungen) → BT-113
  if (Number.isFinite(gross) && Number.isFinite(payable) && payable < gross - 0.005) {
    inv.prepaid = Math.round((gross - payable) * 100) / 100;
    found.push('Bereits gezahlt / Abschläge');
  }
  // Skonto-Basisbetrag (z. B. Schlussrechnung: Skonto nur auf den Zuwachs)
  if (inv.payment.skontoPercent) {
    const zuwachs = new RegExp(String.raw`Zuwachs[^\n]*?(${AMOUNT})\s*$`, 'im').exec(all);
    const skAmount = new RegExp(String.raw`Sk(?:onto)?\.?\s*:?\s*(${AMOUNT})\s*(?:EUR|€)`, 'i').exec(all);
    const pct = parseAmount(inv.payment.skontoPercent);
    let base = NaN;
    if (zuwachs) base = parseAmount(zuwachs[1]);
    else if (skAmount && pct) base = Math.round((parseAmount(skAmount[1]) * 100 / pct) * 100) / 100;
    const payTarget = Number.isFinite(payable) ? payable : gross;
    if (Number.isFinite(base) && base > 0 && Math.abs(base - payTarget) > 0.05) {
      inv.payment.skontoBase = base.toFixed(2);
      found.push('Skonto-Basisbetrag');
    }
  }
  if (Number.isFinite(net)) found.push('Nettobetrag');
  if (Number.isFinite(gross)) found.push('Bruttobetrag');

  return {
    invoice: inv,
    found,
    warnings,
    detected: { net, vat, gross, rate, payable, subtotal },
  };
}
