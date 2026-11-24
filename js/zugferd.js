// ZUGFeRD 2.3 / Factur-X: PDF/A-3 mit eingebetteter Rechnungs-XML (factur-x.xml)
// Abhängigkeiten werden übergeben (Browser: window.PDFLib/window.fontkit, Node: npm-Pakete):
//   deps = { PDFLib, fontkit, fontRegular, fontBold, icc }  (Schrift-/ICC-Daten als Uint8Array)
import { computeTotals, lineNet, num, INVOICE_TYPES, PAYMENT_MEANS, paymentTermsText } from './model.js';
import { buildCii, ZUGFERD_PROFILES } from './cii.js';

export const ZUGFERD_FILENAME = 'factur-x.xml';

const UNIT_SHORT = {
  C62: 'Stk', H87: 'Stk', HUR: 'Std', MIN: 'Min', DAY: 'Tag', WEE: 'Wo', MON: 'Mon', ANN: 'Jahr', LS: 'psch',
  KGM: 'kg', TNE: 't', MTR: 'm', KMT: 'km', MTK: 'm²', MTQ: 'm³', LTR: 'l', KWH: 'kWh', SET: 'Satz', XPK: 'Pck',
};
const TITLES = {
  '380': 'Rechnung', '326': 'Teilrechnung', '384': 'Korrigierte Rechnung', '389': 'Gutschrift',
  '381': 'Rechnungskorrektur', '875': 'Abschlagsrechnung', '876': 'Teilschlussrechnung', '877': 'Schlussrechnung',
};

const eur = (n, cur = 'EUR') => new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur }).format(n || 0);
const dec = (n, max = 4) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: max }).format(n || 0);
const qtyFmt = (n) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 }).format(n || 0);
const dateDe = (iso) => (iso ? iso.split('-').reverse().join('.') : '');

function wrap(text, font, size, width) {
  const out = [];
  for (const para of String(text ?? '').split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) <= width) { line = test; continue; }
      if (line) out.push(line);
      // überlange Wörter hart umbrechen
      let rest = w;
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let i = rest.length - 1;
        while (i > 1 && font.widthOfTextAtSize(rest.slice(0, i), size) > width) i--;
        out.push(rest.slice(0, i));
        rest = rest.slice(i);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

/** Erzeugt eine lesbare Rechnungs-PDF aus den Daten (Schrift eingebettet, PDF/A-tauglich). */
export async function renderInvoicePdf(inv, deps) {
  const { PDFLib, fontkit } = deps;
  const { PDFDocument, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const F = await doc.embedFont(deps.fontRegular, { subset: true });
  const B = await doc.embedFont(deps.fontBold, { subset: true });
  const t = computeTotals(inv);
  const cur = inv.currency || 'EUR';
  const s = inv.seller;
  const b = inv.buyer;
  const W = 595.28; const H = 841.89; const ML = 56; const MR = 50; const CW = W - ML - MR;
  const gray = rgb(0.38, 0.4, 0.45); const black = rgb(0.1, 0.12, 0.16); const line = rgb(0.8, 0.82, 0.86);
  const FOOT = 92;

  let page; let y;
  const pages = [];
  const text = (str, x, yy, { font = F, size = 9.5, color = black, align = 'left', width } = {}) => {
    const v = String(str ?? '');
    let xx = x;
    if (align === 'right') xx = x - font.widthOfTextAtSize(v, size);
    if (align === 'center' && width) xx = x + (width - font.widthOfTextAtSize(v, size)) / 2;
    page.drawText(v, { x: xx, y: yy, size, font, color });
  };
  const hr = (yy, c = line) => page.drawLine({ start: { x: ML, y: yy }, end: { x: W - MR, y: yy }, thickness: 0.6, color: c });

  // Spalten der Positionstabelle
  const C = { pos: ML, name: ML + 36, qty: ML + CW - 205, unit: ML + CW - 200, ep: ML + CW - 85, gp: ML + CW };
  const nameW = C.qty - C.name - 50;
  const tableHead = () => {
    text('Pos.', C.pos, y, { font: B, size: 8.5 });
    text('Bezeichnung', C.name, y, { font: B, size: 8.5 });
    text('Menge', C.qty, y, { font: B, size: 8.5, align: 'right' });
    text('Einh.', C.unit, y, { font: B, size: 8.5 });
    text(`EP netto`, C.ep, y, { font: B, size: 8.5, align: 'right' });
    text(`GP netto`, C.gp, y, { font: B, size: 8.5, align: 'right' });
    y -= 5; hr(y, black); y -= 13;
  };
  const newPage = (withTable) => {
    page = doc.addPage([W, H]);
    pages.push(page);
    y = H - 50;
    if (pages.length > 1) {
      text(`${TITLES[inv.type] || 'Rechnung'} ${inv.number} – Fortsetzung`, ML, y, { font: B, size: 9 });
      y -= 24;
      if (withTable) tableHead();
    }
  };
  const ensure = (h, withTable = false) => { if (y - h < FOOT) newPage(withTable); };

  // ---------------------------------------------------------- Seite 1: Kopf
  newPage(false);
  text(s.name, ML, y, { font: B, size: 15 });
  const sellerRight = [s.street, `${s.zip} ${s.city}`, s.contactPhone && `Tel. ${s.contactPhone}`, s.contactEmail].filter(Boolean);
  let ry = H - 50;
  for (const l of sellerRight) { text(l, W - MR, ry, { size: 8.5, color: gray, align: 'right' }); ry -= 11; }
  y = H - 150;
  text([s.name, s.street, `${s.zip} ${s.city}`].filter(Boolean).join(' · '), ML, y + 14, { size: 7, color: gray });
  const buyerLines = [b.name, b.contactName && `z. Hd. ${b.contactName}`, b.street, b.additionalStreet, `${b.zip} ${b.city}`, b.country && b.country !== 'DE' ? b.country : ''].filter(Boolean);
  for (const l of buyerLines) { text(l, ML, y, { size: 10.5 }); y -= 14; }

  // Infoblock rechts
  const info = [
    ['Rechnungsnummer', inv.number],
    ['Rechnungsdatum', dateDe(inv.issueDate)],
    inv.deliveryDate && ['Leistungsdatum', dateDe(inv.deliveryDate)],
    (inv.periodStart || inv.periodEnd) && ['Leistungszeitraum', `${dateDe(inv.periodStart)} – ${dateDe(inv.periodEnd)}`],
    b.id && ['Kundennummer', b.id],
    inv.projectReference && ['Projektnummer', inv.projectReference],
    inv.orderReference && ['Bestellnummer', inv.orderReference],
    inv.buyerReference && inv.buyerReference !== inv.projectReference && inv.buyerReference !== inv.orderReference && ['Ihre Referenz', inv.buyerReference],
    b.vatId && ['Ihre USt-IdNr.', b.vatId],
  ].filter(Boolean);
  let iy = H - 150;
  for (const [k, v] of info) {
    text(k, W - MR - 200, iy, { size: 8.5, color: gray });
    text(v, W - MR, iy, { size: 9, align: 'right' });
    iy -= 13;
  }
  y = Math.min(y, iy) - 26;
  text(`${TITLES[inv.type] || INVOICE_TYPES[inv.type] || 'Rechnung'} Nr. ${inv.number}`, ML, y, { font: B, size: 14 });
  y -= 18;
  if (inv.precedingInvoiceNumber) {
    text(`Bezug: Rechnung ${inv.precedingInvoiceNumber}${inv.precedingInvoiceDate ? ` vom ${dateDe(inv.precedingInvoiceDate)}` : ''}`, ML, y, { size: 9.5 });
    y -= 14;
  }
  y -= 8;
  tableHead();

  // ---------------------------------------------------------- Positionen
  inv.lines.forEach((l, i) => {
    const nameLines = wrap(l.name, B, 9, nameW);
    const descLines = l.description ? wrap(l.description, F, 8, nameW) : [];
    ensure(nameLines.length * 11 + Math.min(descLines.length, 3) * 9.5 + 6, true);
    text(l.articleNo || String(i + 1), C.pos, y, { size: 8.5, color: gray });
    text(qtyFmt(num(l.quantity)), C.qty, y, { size: 9, align: 'right' });
    text(UNIT_SHORT[l.unit] || l.unit, C.unit, y, { size: 9 });
    text(dec(num(l.price)), C.ep, y, { size: 9, align: 'right' });
    text(dec(lineNet(l), 2), C.gp, y, { size: 9, align: 'right' });
    for (const nl of nameLines) { text(nl, C.name, y, { font: B, size: 9 }); y -= 11; }
    for (const dl of descLines) {
      ensure(10, true);
      text(dl, C.name, y, { size: 8, color: gray });
      y -= 9.5;
    }
    if (l.vatCategory !== 'S' || t.breakdown.length > 1) {
      text(l.vatCategory === 'S' ? `USt ${l.vatRate} %` : `USt-Kategorie ${l.vatCategory}`, C.name, y, { size: 7.5, color: gray });
      y -= 9.5;
    }
    y -= 5;
  });

  // ---------------------------------------------------------- Summen
  const rows = [['Summe Positionen netto', t.lineTotal]];
  for (const a of t.allowances) {
    rows.push([`${a.charge ? 'zzgl.' : 'abzgl.'} ${a.reason}${a.hasPct ? ` ${dec(num(a.percent), 2)} %` : ''}`, a.charge ? a.amount : -a.amount]);
  }
  if (t.allowances.length) rows.push(['Nettobetrag', t.taxExclusive, true]);
  for (const g of t.breakdown) {
    rows.push([g.category === 'S' ? `zzgl. ${dec(g.rate, 2)} % USt auf ${eur(g.taxable, cur)}` : `USt 0 % (Kategorie ${g.category}) auf ${eur(g.taxable, cur)}`, g.tax]);
  }
  rows.push(['Gesamtbetrag brutto', t.taxInclusive, true]);
  if (t.prepaid) rows.push(['abzgl. bereits gezahlt / Abschläge', -t.prepaid]);
  rows.push(['Zahlbetrag', t.payable, true, true]);
  ensure(rows.length * 14 + 30);
  y -= 4; hr(y, black); y -= 16;
  for (const [k, v, bold, big] of rows) {
    if (big) { y -= 3; hr(y + 11); }
    text(k, W - MR - 290, y, { font: bold ? B : F, size: big ? 11 : 9.5 });
    text(eur(v, cur), W - MR, y, { font: bold ? B : F, size: big ? 11 : 9.5, align: 'right' });
    y -= big ? 18 : 14;
  }

  // ---------------------------------------------------------- Hinweise / Zahlung
  const notes = [];
  for (const g of t.breakdown) if (g.exemptionReason) notes.push(g.exemptionReason);
  if (inv.note) notes.push(inv.note);
  const p = inv.payment;
  const pay = [];
  if (inv.dueDate) pay.push(`Zahlbar bis zum ${dateDe(inv.dueDate)} ohne Abzug.`);
  const terms = (p.terms || '').trim();
  if (terms && !pay.some((x) => x === terms)) pay.push(terms);
  if (p.skontoDays && p.skontoPercent) {
    pay.push(`Bei Zahlung innerhalb von ${p.skontoDays} Tagen ${dec(num(p.skontoPercent), 2)} % Skonto${p.skontoBase ? ` auf ${eur(num(p.skontoBase), cur)}` : ''}.`);
  }
  if (['58', '30'].includes(p.code) && p.iban) {
    pay.push(`Bitte überweisen Sie auf: ${p.accountName || s.name} · IBAN ${p.iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()}${p.bic ? ` · BIC ${p.bic}` : ''}`);
  } else if (p.code === '59') {
    pay.push(`Der Betrag wird per SEPA-Lastschrift eingezogen (Mandat ${p.mandateId}, Gläubiger-ID ${p.creditorId}).`);
  } else {
    pay.push(`Zahlungsart: ${PAYMENT_MEANS[p.code] || p.code}`);
  }
  if (p.reference) pay.push(`Verwendungszweck: ${p.reference}`);
  y -= 10;
  for (const block of [notes, pay]) {
    for (const n of block) {
      for (const wl of wrap(n, F, 9, CW)) { ensure(12); text(wl, ML, y, { size: 9 }); y -= 12; }
    }
    y -= 6;
  }
  ensure(14);
  text('Dieses Dokument enthält die strukturierten Rechnungsdaten als ZUGFeRD/Factur-X (Anhang factur-x.xml).', ML, y, { size: 7.5, color: gray });

  // ---------------------------------------------------------- Fußzeilen
  const footCols = [
    [s.name, s.street, `${s.zip} ${s.city}`, s.registrationId, s.legalInfo].filter(Boolean),
    [s.vatId && `USt-IdNr.: ${s.vatId}`, s.taxNumber && `Steuernummer: ${s.taxNumber}`, s.contactPhone && `Tel.: ${s.contactPhone}`, s.contactEmail].filter(Boolean),
    [p.iban && `IBAN: ${p.iban}`, p.bic && `BIC: ${p.bic}`].filter(Boolean),
  ];
  pages.forEach((pg, i) => {
    page = pg;
    hr(FOOT - 18);
    footCols.forEach((col, ci) => {
      let fy = FOOT - 30;
      for (const l of col) {
        for (const wl of wrap(l, F, 7, CW / 3 - 10).slice(0, 2)) { text(wl, ML + ci * (CW / 3), fy, { size: 7, color: gray }); fy -= 9; }
      }
    });
    text(`Seite ${i + 1} von ${pages.length}`, W - MR, 24, { size: 7.5, color: gray, align: 'right' });
  });
  return doc;
}

function pdfDateParts(date) {
  const d = new Date(Math.floor(date.getTime() / 1000) * 1000);
  return { date: d, iso: d.toISOString().replace(/\.\d{3}Z$/, 'Z') };
}

function xmlEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildXmp({ title, producer, creator, iso, level }) {
  const prop = (name, desc) => `
            <rdf:li rdf:parseType="Resource">
              <pdfaProperty:name>${name}</pdfaProperty:name>
              <pdfaProperty:valueType>Text</pdfaProperty:valueType>
              <pdfaProperty:category>external</pdfaProperty:category>
              <pdfaProperty:description>${desc}</pdfaProperty:description>
            </rdf:li>`;
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:format>application/pdf</dc:format>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(title)}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>${xmlEsc(creator)}</rdf:li></rdf:Seq></dc:creator>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>${xmlEsc(producer)}</xmp:CreatorTool>
      <xmp:CreateDate>${iso}</xmp:CreateDate>
      <xmp:ModifyDate>${iso}</xmp:ModifyDate>
      <xmp:MetadataDate>${iso}</xmp:MetadataDate>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <pdf:Producer>${xmlEsc(producer)}</pdf:Producer>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
        xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>${prop('DocumentFileName', 'name of the embedded XML invoice file')}${prop('DocumentType', 'INVOICE')}${prop('Version', 'The actual version of the Factur-X XML schema')}${prop('ConformanceLevel', 'The conformance level of the embedded Factur-X data')}
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>${ZUGFERD_FILENAME}</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>${level}</fx:ConformanceLevel>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * Bettet die XML als factur-x.xml in ein PDFDocument ein und ergänzt PDF/A-3-Metadaten.
 */
export function attachFacturX(doc, xml, { PDFLib, icc, level = 'EN 16931', title = 'Rechnung' }) {
  const { PDFName, PDFString, PDFHexString, PDFArray, PDFDict } = PDFLib;
  const ctx = doc.context;
  const catalog = doc.catalog;
  const { date, iso } = pdfDateParts(new Date());
  const producer = 'XRechnung-Generator';

  // 1) eingebettete Datei
  const xmlBytes = new TextEncoder().encode(xml);
  const pdfDate = PDFString.fromDate(date);
  const fileStream = ctx.flateStream(xmlBytes, {
    Type: 'EmbeddedFile',
    Subtype: 'text/xml',
    Params: { Size: xmlBytes.length, ModDate: pdfDate, CreationDate: pdfDate },
  });
  const fileRef = ctx.register(fileStream);
  const spec = ctx.obj({
    Type: 'Filespec',
    F: PDFString.of(ZUGFERD_FILENAME),
    UF: PDFHexString.fromText(ZUGFERD_FILENAME),
    Desc: PDFString.of('Factur-X/ZUGFeRD Rechnungsdaten'),
    AFRelationship: 'Alternative',
    EF: { F: fileRef, UF: fileRef },
  });
  const specRef = ctx.register(spec);

  // Names → EmbeddedFiles (vorhandene factur-x.xml ersetzen)
  let names = catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (!names) { names = ctx.obj({}); catalog.set(PDFName.of('Names'), names); }
  let ef = names.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  if (!ef) { ef = ctx.obj({}); names.set(PDFName.of('EmbeddedFiles'), ef); }
  const old = ef.lookupMaybe(PDFName.of('Names'), PDFArray);
  const pairs = [];
  if (old) {
    for (let i = 0; i + 1 < old.size(); i += 2) {
      const key = old.lookup(i);
      const k = key?.decodeText ? key.decodeText() : String(key);
      if (k !== ZUGFERD_FILENAME) pairs.push([k, old.get(i), old.get(i + 1)]);
    }
  }
  pairs.push([ZUGFERD_FILENAME, PDFString.of(ZUGFERD_FILENAME), specRef]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const arr = ctx.obj([]);
  for (const [, k, v] of pairs) { arr.push(k); arr.push(v); }
  ef.set(PDFName.of('Names'), arr);
  ef.delete(PDFName.of('Kids'));

  // Associated Files am Katalog
  const af = ctx.obj([specRef]);
  const oldAf = catalog.lookupMaybe(PDFName.of('AF'), PDFArray);
  if (oldAf) {
    for (let i = 0; i < oldAf.size(); i++) {
      const fs = oldAf.lookupMaybe(i, PDFDict);
      const f = fs?.lookupMaybe(PDFName.of('F'), PDFString)?.decodeText?.();
      if (f !== ZUGFERD_FILENAME) af.push(oldAf.get(i));
    }
  }
  catalog.set(PDFName.of('AF'), af);
  catalog.set(PDFName.of('PageMode'), PDFName.of('UseAttachments'));

  // 2) XMP-Metadaten (PDF/A-3B + Factur-X-Erweiterung)
  doc.setTitle(title, { showInWindowTitleBar: true });
  doc.setProducer(producer);
  doc.setCreator(producer);
  doc.setAuthor(producer);
  doc.setCreationDate(date);
  doc.setModificationDate(date);
  const xmp = buildXmp({ title, producer, creator: producer, iso, level });
  const meta = ctx.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
  catalog.set(PDFName.of('Metadata'), ctx.register(meta));

  // 3) OutputIntent (sRGB)
  const intents = catalog.lookupMaybe(PDFName.of('OutputIntents'), PDFArray);
  let hasPdfa = false;
  if (intents) {
    for (let i = 0; i < intents.size(); i++) {
      const it = intents.lookupMaybe(i, PDFDict);
      if (it && String(it.get(PDFName.of('S'))) === '/GTS_PDFA1') hasPdfa = true;
    }
  }
  if (!hasPdfa && icc) {
    const iccRef = ctx.register(ctx.flateStream(icc, { N: 3 }));
    const intent = ctx.register(ctx.obj({
      Type: 'OutputIntent', S: 'GTS_PDFA1',
      OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
      Info: PDFString.of('sRGB IEC61966-2.1'),
      DestOutputProfile: iccRef,
    }));
    if (intents) intents.push(intent);
    else catalog.set(PDFName.of('OutputIntents'), ctx.obj([intent]));
  }
  catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }));

  // 4) Datei-ID im Trailer
  const rnd = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(rnd), PDFHexString.of(rnd)]);
}

/**
 * Erzeugt eine ZUGFeRD-PDF.
 * @param {object} inv Rechnung
 * @param {object} opts { profile: 'EN16931'|'XRECHNUNG', sourcePdf?: Uint8Array, deps }
 * @returns {Promise<{ bytes: Uint8Array, xml: string, usedSource: boolean }>}
 */
export async function buildZugferdPdf(inv, { profile = 'EN16931', sourcePdf = null, deps }) {
  const { PDFLib } = deps;
  const xml = buildCii(inv, profile);
  let doc;
  let usedSource = false;
  if (sourcePdf) {
    try {
      doc = await PDFLib.PDFDocument.load(sourcePdf, { updateMetadata: false });
      usedSource = true;
    } catch (e) {
      if (/encrypt/i.test(String(e?.message || e))) {
        throw new Error('Die Original-PDF ist verschlüsselt/geschützt und kann nicht erweitert werden. Bitte „PDF neu erzeugen" wählen.');
      }
      throw e;
    }
  } else {
    doc = await renderInvoicePdf(inv, deps);
  }
  attachFacturX(doc, xml, {
    PDFLib, icc: deps.icc,
    level: ZUGFERD_PROFILES[profile]?.fxLevel || 'EN 16931',
    title: `${TITLES[inv.type] || 'Rechnung'} ${inv.number}`,
  });
  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, xml, usedSource };
}

export function zugferdFilename(inv) {
  const nr = String(inv.number || 'rechnung').replace(/[^A-Za-z0-9._-]+/g, '_');
  return `ZUGFeRD_${nr}.pdf`;
}

export { paymentTermsText };
