import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildCii } from '../js/cii.js';
import { buildZugferdPdf } from '../js/zugferd.js';
import { importXml } from '../js/xml-import.js';
import { computeTotals } from '../js/model.js';
import { validateInvoice } from '../js/validate.js';
import { __test as dec } from '../js/pdf-decrypt.js';
import { parseXml, sampleInvoice } from './helpers.js';

const require = createRequire(import.meta.url);
const PDFLib = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const root = new URL('../', import.meta.url);
const deps = {
  PDFLib, fontkit,
  fontRegular: readFileSync(new URL('vendor/fonts/LiberationSans-Regular.ttf', root)),
  fontBold: readFileSync(new URL('vendor/fonts/LiberationSans-Bold.ttf', root)),
  icc: readFileSync(new URL('vendor/fonts/sRGB.icc', root)),
};

function withAllowances() {
  const inv = sampleInvoice();
  inv.allowances = [
    { charge: false, reason: 'Rabatt', percent: '3', amount: 0, vatCategory: 'S', vatRate: 19 },
    { charge: true, reason: 'Fracht', percent: '', amount: 25, vatCategory: 'S', vatRate: 7 },
  ];
  inv.prepaid = 100;
  return inv;
}

test('Rabatt/Zuschlag auf Rechnungsebene wird nach EN 16931 berechnet', () => {
  const t = computeTotals(withAllowances());
  // 19 %-Gruppe: 573,63 − 3 % (17,21) = 556,42 → USt 105,72 ; 7 %-Gruppe: 39,90 + 25 = 64,90 → USt 4,54
  assert.equal(t.allowanceTotal, 17.21);
  assert.equal(t.chargeTotal, 25);
  assert.equal(t.taxExclusive, 621.32);
  assert.equal(t.taxTotal, 110.26);
  assert.equal(t.taxInclusive, 731.58);
  assert.equal(t.payable, 631.58);
});

test('CII (ZUGFeRD) ist wohlgeformt und lässt sich verlustfrei wieder einlesen', () => {
  for (const profile of ['EN16931', 'XRECHNUNG']) {
    const inv = withAllowances();
    inv.payment.skontoBase = '500';
    const xml = buildCii(inv, profile);
    const { format, invoice } = importXml(parseXml(xml));
    assert.equal(format, 'CII');
    assert.deepEqual(computeTotals(invoice), computeTotals(inv));
    assert.equal(invoice.payment.skontoBase, '500.00');
    assert.equal(invoice.lines[0].articleNo, 'L-100');
    assert.match(xml, profile === 'XRECHNUNG' ? /xrechnung_3\.0/ : /<ram:ID>urn:cen\.eu:en16931:2017<\/ram:ID>/);
  }
});

test('Profil EN 16931: XRechnung-Zusatzregeln sind nur Hinweise', () => {
  const inv = sampleInvoice();
  inv.buyerReference = '';
  inv.seller.contactName = '';
  assert.ok(validateInvoice(inv).some((f) => f.level === 'error' && f.rule === 'BR-DE-15'));
  const zf = validateInvoice(inv, { profile: 'EN16931' });
  assert.ok(!zf.some((f) => f.level === 'error'));
  assert.ok(zf.some((f) => f.level === 'info' && f.rule === 'BR-DE-15'));
});

async function attachmentOf(bytes) {
  const doc = await PDFLib.PDFDocument.load(bytes);
  const { PDFName, PDFDict, PDFArray } = PDFLib;
  const names = doc.catalog.lookup(PDFName.of('Names'), PDFDict).lookup(PDFName.of('EmbeddedFiles'), PDFDict).lookup(PDFName.of('Names'), PDFArray);
  const spec = names.lookup(1, PDFDict);
  const stream = spec.lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F'));
  const { inflateSync } = await import('node:zlib');
  return {
    name: names.lookup(0).decodeText(),
    rel: String(spec.get(PDFName.of('AFRelationship'))),
    xml: inflateSync(Buffer.from(stream.contents)).toString('utf8'),
    hasAF: !!doc.catalog.get(PDFName.of('AF')),
    hasIntent: !!doc.catalog.get(PDFName.of('OutputIntents')),
    xmp: new TextDecoder().decode(doc.catalog.lookup(PDFName.of('Metadata')).contents),
  };
}

test('ZUGFeRD-PDF wird neu erzeugt und enthält factur-x.xml', async () => {
  const inv = withAllowances();
  const { bytes, xml, usedSource } = await buildZugferdPdf(inv, { profile: 'EN16931', deps });
  assert.equal(usedSource, false);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  const a = await attachmentOf(bytes);
  assert.equal(a.name, 'factur-x.xml');
  assert.equal(a.rel, '/Alternative');
  assert.equal(a.xml, xml);
  assert.ok(a.hasAF && a.hasIntent);
  assert.match(a.xmp, /<pdfaid:part>3<\/pdfaid:part>/);
  assert.match(a.xmp, /<fx:ConformanceLevel>EN 16931<\/fx:ConformanceLevel>/);
});

test('ZUGFeRD in bestehende PDF einbetten (auch mit Rechteschutz)', async () => {
  // Beispiel-PDF erzeugen und mit RC4-128 (nur Rechteschutz, leeres Öffnungspasswort) verschlüsseln
  const src = await PDFLib.PDFDocument.create();
  src.addPage([200, 200]).drawText('Testrechnung', { x: 20, y: 100 });
  const plain = await src.save({ useObjectStreams: false });
  const encrypted = await encryptRc4ForTest(plain);
  const loaded = await PDFLib.PDFDocument.load(encrypted, { ignoreEncryption: true });
  assert.ok(loaded.isEncrypted);
  const res = await buildZugferdPdf(sampleInvoice(), { profile: 'XRECHNUNG', sourcePdf: encrypted, deps });
  assert.ok(res.usedSource && res.decrypted);
  const out = await PDFLib.PDFDocument.load(res.bytes);
  assert.equal(out.isEncrypted, false);
  assert.equal(out.getPageCount(), 1);
  const a = await attachmentOf(res.bytes);
  assert.match(a.xmp, /<fx:ConformanceLevel>XRECHNUNG<\/fx:ConformanceLevel>/);
  // Seiteninhalt wurde korrekt entschlüsselt
  const { inflateSync } = await import('node:zlib');
  let content = out.getPage(0).node.Contents();
  if (content instanceof PDFLib.PDFArray) content = content.lookup(0);
  const data = inflateSync(Buffer.from(content.contents)).toString('latin1');
  assert.match(data, /Tj/);
});

test('MD5 und RC4 liefern Referenzwerte', () => {
  const hex = (b) => Buffer.from(b).toString('hex');
  assert.equal(hex(dec.md5(new TextEncoder().encode(''))), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(hex(dec.md5(new TextEncoder().encode('The quick brown fox jumps over the lazy dog'))), '9e107d9d372bb6826bd81d3542a419d6');
  assert.equal(hex(dec.rc4(new TextEncoder().encode('Key'), new TextEncoder().encode('Plaintext'))), 'bbf316e8d940af0ad3');
});

// ---- Hilfsfunktion: verschlüsselt eine Test-PDF mit RC4-128 (R3), leeres Benutzerpasswort
async function encryptRc4ForTest(plainBytes) {
  const { md5, rc4 } = dec;
  const { PDFDocument, PDFRawStream, PDFString, PDFHexString, PDFDict, PDFArray, PDFName } = PDFLib;
  const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
  const id = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
  const P = -60;
  let ok = md5(Buffer.concat([Buffer.from('owner'), PAD]).subarray(0, 32));
  for (let i = 0; i < 50; i++) ok = md5(ok);
  let O = rc4(ok, PAD);
  for (let i = 1; i <= 19; i++) O = rc4(ok.map((b) => b ^ i), O);
  const p = Buffer.from([P & 255, (P >> 8) & 255, (P >> 16) & 255, (P >>> 24) & 255]);
  let key = md5(Buffer.concat([PAD, Buffer.from(O), p, id]));
  for (let i = 0; i < 50; i++) key = md5(key);
  let U = rc4(key, md5(Buffer.concat([PAD, id])));
  for (let i = 1; i <= 19; i++) U = rc4(key.map((b) => b ^ i), U);
  U = Buffer.concat([Buffer.from(U), Buffer.alloc(16)]);

  const doc = await PDFDocument.load(plainBytes);
  const ctx = doc.context;
  const objKey = (ref) => md5(Buffer.concat([key, Buffer.from([ref.objectNumber & 255, (ref.objectNumber >> 8) & 255,
    (ref.objectNumber >> 16) & 255, ref.generationNumber & 255, (ref.generationNumber >> 8) & 255])])).subarray(0, 16);
  const hex = (b) => Buffer.from(b).toString('hex');
  const walk = (obj, k) => {
    if (obj instanceof PDFString || obj instanceof PDFHexString) return PDFHexString.of(hex(rc4(k, obj.asBytes())));
    if (obj instanceof PDFArray) { for (let i = 0; i < obj.size(); i++) obj.set(i, walk(obj.get(i), k)); return obj; }
    if (obj instanceof PDFDict) { for (const [n, v] of obj.entries()) obj.set(n, walk(v, k)); return obj; }
    return obj;
  };
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const k = objKey(ref);
    if (obj instanceof PDFRawStream) {
      walk(obj.dict, k);
      ctx.assign(ref, PDFRawStream.of(obj.dict, rc4(k, obj.contents)));
    } else walk(obj, k);
  }
  const encRef = ctx.register(ctx.obj({
    Filter: 'Standard', V: 2, R: 3, Length: 128, P,
    O: PDFHexString.of(hex(O)), U: PDFHexString.of(hex(U)),
  }));
  ctx.trailerInfo.Encrypt = encRef;
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(hex(id)), PDFHexString.of(hex(id))]);
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}
