// Heuristische Erkennung von Rechnungsdaten aus dem Text einer (deutschen) PDF-Rechnung.
// Ergebnis ist ein Vorschlag – alle Felder müssen vom Anwender geprüft werden.
import { emptyInvoice, emptyLine, isValidIban, isValidVatId } from './model.js';

const AMOUNT = String.raw`-?\d{1,3}(?:[.\s']\d{3})*,\d{2}|-?\d+,\d{2}|-?\d{1,3}(?:,\d{3})*\.\d{2}|-?\d+\.\d{2}`;
const DATE = String.raw`\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}`;

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
  } else if (lastDot >= 0 && /^\-?\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, ''); // "1.234" als Tausender
  }
  return Number(t);
}

/** "24.11.2026" / "24.11.26" → "2026-11-24" */
export function parseGermanDate(s) {
  const m = /(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})/.exec(String(s || ''));
  if (!m) return '';
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  const mo = Number(m[2]);
  const d = Number(m[1]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
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
  [/^(monate?|mon\.?)$/i, 'MON'],
  [/^(pausch\.?|pauschal|psch\.?|pauschale)$/i, 'LS'],
  [/^(kg)$/i, 'KGM'],
  [/^(m)$/i, 'MTR'],
  [/^(km)$/i, 'KMT'],
  [/^(m2|m²|qm)$/i, 'MTK'],
  [/^(m3|m³|cbm)$/i, 'MTQ'],
  [/^(l|liter)$/i, 'LTR'],
  [/^(kwh)$/i, 'KWH'],
  [/^(min\.?|minuten?)$/i, 'MIN'],
];
export function unitFromWord(w) {
  for (const [re, code] of UNIT_WORDS) if (re.test(String(w || '').trim())) return code;
  return null;
}

/** Positionszeilen: "[Pos] Menge [Einheit] Bezeichnung Einzelpreis [USt%] Gesamt" */
function parseLineItems(lines) {
  const items = [];
  const re = new RegExp(
    String.raw`^(?:(\d{1,3})[.)]?\s+)?(\d+(?:,\d+)?)\s*([A-Za-zÄÖÜäöü²³.]{1,10})?\s+(.+?)\s+(${AMOUNT})\s*(?:€|EUR)?\s+(?:(\d{1,2}(?:,\d+)?)\s*%\s+)?(${AMOUNT})\s*(?:€|EUR)?$`,
  );
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (/summe|netto|brutto|gesamt|mwst|ust|umsatzsteuer|zwischensumme|übertrag|rabatt gesamt/i.test(line)) continue;
    const m = re.exec(line);
    if (!m) continue;
    let [, , qtyS, unitWord, name, priceS, rateS, totalS] = m;
    let unit = unitFromWord(unitWord);
    if (unitWord && !unit) { name = `${unitWord} ${name}`; unit = 'C62'; }
    const quantity = parseAmount(qtyS);
    const price = parseAmount(priceS);
    const total = parseAmount(totalS);
    if (!(quantity > 0) || !Number.isFinite(price) || !Number.isFinite(total)) continue;
    // Plausibilität: Menge × Preis ≈ Gesamt (Toleranz für Rabatte 1 %)
    if (Math.abs(quantity * price - total) > Math.max(0.02, Math.abs(total) * 0.01)) continue;
    const l = emptyLine();
    l.name = name.trim();
    l.quantity = quantity;
    l.unit = unit || 'C62';
    l.price = price;
    if (rateS) l.vatRate = parseAmount(rateS);
    items.push(l);
  }
  return items;
}

/** Sucht einen Adressblock: Name / Straße / PLZ Ort */
function addressAround(lines, idx) {
  const zipLine = lines[idx];
  const m = /(?:^|\s|D-)(\d{5})\s+([A-ZÄÖÜ][\wäöüßÄÖÜ .\-/()]+)$/.exec(zipLine.trim());
  if (!m) return null;
  const street = (lines[idx - 1] || '').trim();
  const name = (lines[idx - 2] || '').trim();
  return { zip: m[1], city: m[2].trim(), street, name };
}

/**
 * Wertet extrahierten PDF-Text aus.
 * @param {string} text Volltext, Zeilen durch \n getrennt
 * @returns {{ invoice: object, found: string[], warnings: string[] }}
 */
export function parseInvoiceText(text) {
  const inv = emptyInvoice();
  inv.issueDate = '';
  const found = [];
  const warnings = [];
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const all = lines.join('\n');

  // Rechnungsnummer
  let m = firstMatch(all, [
    /(?:Rechnungs|Gutschrifts?)[\s-]*(?:nummer|nr\.?|no\.?)\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-/_.]{1,30})/i,
    /Rechnung\s+(?:Nr\.?|Nummer|#)\s*[:.]?\s*([A-Z0-9][A-Z0-9\-/_.]{1,30})/i,
    /Invoice\s*(?:No\.?|Number|#)\s*[:.]?\s*([A-Z0-9][A-Z0-9\-/_.]{1,30})/i,
    /Beleg(?:nummer|nr\.?)\s*[:.]?\s*([A-Z0-9][A-Z0-9\-/_.]{1,30})/i,
  ]);
  if (m) { inv.number = m[1].replace(/[.]$/, ''); found.push('Rechnungsnummer'); }

  // Rechnungsdatum
  m = firstMatch(all, [
    new RegExp(String.raw`Rechnungsdatum\s*[:.]?\s*(${DATE})`, 'i'),
    new RegExp(String.raw`(?:Belegdatum|Ausstellungsdatum|Invoice date)\s*[:.]?\s*(${DATE})`, 'i'),
    new RegExp(String.raw`(?:^|\n)Datum\s*[:.]?\s*(${DATE})`, 'i'),
    new RegExp(String.raw`[A-ZÄÖÜ][a-zäöüß]+,\s*(?:den\s*)?(${DATE})`),
  ]);
  if (m) { inv.issueDate = parseGermanDate(m[1]); found.push('Rechnungsdatum'); }

  // Leistungszeitraum / -datum
  m = new RegExp(String.raw`(?:Leistungszeitraum|Abrechnungszeitraum|Zeitraum)\s*[:.]?\s*(?:vom\s*)?(${DATE})\s*(?:-|–|bis)\s*(${DATE})`, 'i').exec(all);
  if (m) {
    inv.periodStart = parseGermanDate(m[1]);
    inv.periodEnd = parseGermanDate(m[2]);
    found.push('Leistungszeitraum');
  } else {
    m = new RegExp(String.raw`(?:Liefer|Leistungs)(?:datum|tag)\s*[:.]?\s*(${DATE})`, 'i').exec(all);
    if (m) { inv.deliveryDate = parseGermanDate(m[1]); found.push('Leistungsdatum'); }
    else if (/Leistungsdatum\s*(?:entspricht|=|gleich)\s*Rechnungsdatum/i.test(all) && inv.issueDate) {
      inv.deliveryDate = inv.issueDate; found.push('Leistungsdatum (= Rechnungsdatum)');
    }
  }

  // Fälligkeit
  m = new RegExp(String.raw`(?:fällig\s*(?:am|bis|zum)?|zahlbar\s*bis(?:\s*zum)?|Fälligkeit(?:sdatum)?)\s*[:.]?\s*(${DATE})`, 'i').exec(all);
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
  const pctNum = (x) => parseAmount(x);
  let sk = /(\d{1,2}(?:,\d{1,2})?)\s*%\s*Skonto\s*(?:bei\s*Zahlung\s*)?(?:innerhalb|binnen)\s*(?:von\s*)?(\d{1,3})\s*Tag/i.exec(all);
  if (sk) { inv.payment.skontoPercent = String(pctNum(sk[1])); inv.payment.skontoDays = sk[2]; }
  else {
    sk = /(?:innerhalb|binnen)\s*(?:von\s*)?(\d{1,3})\s*Tag\w*\s*(\d{1,2}(?:,\d{1,2})?)\s*%\s*Skonto/i.exec(all);
    if (sk) { inv.payment.skontoDays = sk[1]; inv.payment.skontoPercent = String(pctNum(sk[2])); }
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
  m = /(?:Steuer[\s-]*(?:nummer|nr\.?)|St\.?[\s-]*Nr\.?)\s*[:.]?\s*(\d{2,3}\s?\/\s?\d{3,4}\s?\/\s?\d{4,5}|\d{10,13})/i.exec(all);
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
  m = /(?:Tel(?:efon)?\.?|Fon|Phone)\s*[:.]?\s*(\+?[\d][\d\s/()-]{5,20}\d)/i.exec(all);
  if (m) { inv.seller.contactPhone = m[1].trim(); found.push('Telefon'); }

  // Leitweg-ID
  m = /Leitweg[\s-]*(?:ID|Nr\.?)?\s*[:.]?\s*(\d{2,12}(?:-[A-Z0-9]{1,30})?-\d{2})/i.exec(all);
  if (m) {
    inv.buyerReference = m[1];
    inv.buyer.endpoint = m[1];
    inv.buyer.endpointScheme = '0204';
    found.push('Leitweg-ID');
  } else {
    m = /(?:Bestell(?:nummer|nr\.?)|Ihre\s*Bestellung|Auftrags(?:nummer|nr\.?)|Ihr Zeichen)\s*[:.]?\s*([A-Z0-9][\w\-/.]{1,30})/i.exec(all);
    if (m) { inv.orderReference = m[1]; inv.buyerReference = m[1]; found.push('Bestellnummer'); }
  }

  // Adressen: Absenderzeile ("Firma · Straße · PLZ Ort") und Empfängerblock
  const senderIdx = lines.findIndex((l) => /[·•|]/.test(l) && /\b\d{5}\s+\S/.test(l));
  if (senderIdx >= 0) {
    const parts = lines[senderIdx].split(/\s*[·•|]\s*/).filter(Boolean);
    const zipPart = parts.findIndex((p) => /^\d{5}\s+\S/.test(p) || /\s\d{5}\s+\S/.test(p));
    if (zipPart >= 1) {
      inv.seller.name = parts[0];
      inv.seller.street = zipPart >= 2 ? parts[zipPart - 1] : '';
      const zm = /(\d{5})\s+(.+)$/.exec(parts[zipPart]);
      inv.seller.zip = zm[1];
      inv.seller.city = zm[2];
      found.push('Absenderadresse');
    }
  }
  const zipIdx = lines
    .map((l, i) => (/^(?:D-)?\d{5}\s+[A-ZÄÖÜ]/.test(l) && i !== senderIdx ? i : -1))
    .filter((i) => i >= 2);
  if (zipIdx.length) {
    const a = addressAround(lines, zipIdx[0]);
    if (a) {
      Object.assign(inv.buyer, { name: a.name, street: a.street, zip: a.zip, city: a.city });
      found.push('Empfängeradresse');
      // Wenn keine Absenderzeile vorhanden war, steht die Absenderadresse oft im Fuß
      if (!inv.seller.name && zipIdx.length > 1) {
        const s = addressAround(lines, zipIdx[zipIdx.length - 1]);
        if (s && s.zip !== a.zip) {
          Object.assign(inv.seller, { name: s.name, street: s.street, zip: s.zip, city: s.city });
          found.push('Absenderadresse (Fußzeile)');
        }
      }
    }
  }

  // Positionen
  const items = parseLineItems(lines);

  // Summen
  const grab = (re) => {
    const mm = re.exec(all);
    return mm ? parseAmount(mm[1]) : NaN;
  };
  const net = grab(new RegExp(String.raw`(?:Netto(?:betrag|summe)?|Summe\s*netto|Zwischensumme|Gesamt\s*netto|Rechnungsbetrag\s*netto)\s*[:.]?\s*(?:EUR|€)?\s*(${AMOUNT})`, 'i'));
  const gross = grab(new RegExp(String.raw`(?:Brutto(?:betrag|summe)?|Gesamt(?:betrag|summe)?(?:\s*brutto)?|Rechnungsbetrag|Endbetrag|zu\s*zahlen(?:der\s*Betrag)?|Summe\s*brutto)\s*[:.]?\s*(?:EUR|€)?\s*(${AMOUNT})`, 'i'));
  const vatM = new RegExp(String.raw`(?:MwSt\.?|USt\.?|Umsatzsteuer|Mehrwertsteuer)\s*(?:\(?\s*(\d{1,2}(?:,\d+)?)\s*%\s*\)?)?[^\n\d]{0,25}(${AMOUNT})\s*(?:€|EUR)?\s*$`, 'im').exec(all);
  let rate = NaN;
  let vat = NaN;
  if (vatM) {
    rate = vatM[1] ? parseAmount(vatM[1]) : NaN;
    vat = parseAmount(vatM[2]);
  }
  if (!Number.isFinite(rate) || rate === 0) {
    const rm = /(\d{1,2})\s*%\s*(?:MwSt|USt|Umsatzsteuer|Mehrwertsteuer)/i.exec(all);
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

  if (items.length) {
    for (const l of items) {
      l.vatCategory = category;
      if (category === 'S') l.vatRate = l.vatRate && l.vatRate !== 19 ? l.vatRate : (Number.isFinite(rate) && rate > 0 ? rate : 19);
      else l.vatRate = 0;
    }
    inv.lines = items;
    found.push(`${items.length} Position(en)`);
    const sum = items.reduce((acc, l) => acc + l.quantity * l.price, 0);
    if (Number.isFinite(net) && Math.abs(sum - net) > 0.05)
      warnings.push(`Summe der erkannten Positionen (${sum.toFixed(2)}) weicht vom Nettobetrag der PDF (${net.toFixed(2)}) ab – bitte Positionen prüfen.`);
  } else {
    const l = emptyLine();
    l.name = 'Leistung gemäß beigefügter Rechnung';
    l.unit = 'LS';
    l.vatCategory = category;
    l.vatRate = category === 'S' ? (Number.isFinite(rate) && rate > 0 ? rate : 19) : 0;
    let netValue = net;
    if (!Number.isFinite(netValue) && Number.isFinite(gross)) {
      netValue = category === 'S' ? Math.round((gross / (1 + l.vatRate / 100)) * 100) / 100 : gross;
    }
    l.price = Number.isFinite(netValue) ? netValue : 0;
    inv.lines = [l];
    warnings.push('Keine Einzelpositionen erkannt – es wurde eine Sammelposition angelegt. Bitte Leistungsbeschreibung und Menge ergänzen (§ 14 Abs. 4 Nr. 5 UStG).');
  }
  if (Number.isFinite(net)) found.push('Nettobetrag');
  if (Number.isFinite(gross)) found.push('Bruttobetrag');

  return {
    invoice: inv,
    found,
    warnings,
    detected: { net, vat, gross, rate },
  };
}
