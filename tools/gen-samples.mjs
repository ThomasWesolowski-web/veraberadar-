// Erzeugt Beispielrechnungen (XRechnung UBL, ZUGFeRD CII) für die offizielle Validierung
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildXRechnung } from '../js/ubl.js';
import { buildCii } from '../js/cii.js';
import { sampleInvoice } from '../tests/helpers.js';

const out = process.argv[2] || 'tools/.samples';
mkdirSync(out, { recursive: true });
const cases = { standard: sampleInvoice() };
const cn = sampleInvoice(); cn.type = '381'; cn.precedingInvoiceNumber = 'RE-1'; cn.precedingInvoiceDate = '2026-10-01'; cases.gutschrift = cn;
const rc = sampleInvoice(); rc.buyer.vatId = 'DE811569869'; rc.lines.forEach((l) => { l.vatCategory = 'AE'; l.vatRate = 0; }); cases.reversecharge = rc;
const ku = sampleInvoice(); ku.seller.vatId = ''; ku.lines.forEach((l) => { l.vatCategory = 'E'; l.vatRate = 0; }); cases.kleinunternehmer = ku;
const ig = sampleInvoice(); ig.buyer.vatId = 'FR40303265045'; ig.buyer.country = 'FR';
ig.delivery = { name: '', street: 'Rue 1', zip: '75001', city: 'Paris', country: 'FR' };
ig.lines.forEach((l) => { l.vatCategory = 'K'; l.vatRate = 0; }); cases.igl = ig;
const sr = sampleInvoice(); sr.type = '877';
sr.allowances = [{ charge: false, reason: 'Rabatt', percent: '3', amount: 0, vatCategory: 'S', vatRate: 19 },
  { charge: true, reason: 'Fracht', percent: '', amount: 25, vatCategory: 'S', vatRate: 7 }];
sr.prepaid = 300; sr.payment.skontoBase = '400'; cases.schlussrechnung = sr;
const dd = sampleInvoice(); Object.assign(dd.payment, { code: '59', mandateId: 'M-77', creditorId: 'DE98ZZZ09999999999', debitedIban: 'DE89370400440532013000' }); cases.lastschrift = dd;
for (const [name, inv] of Object.entries(cases)) {
  writeFileSync(`${out}/${name}.ubl.xml`, buildXRechnung(inv));
  writeFileSync(`${out}/${name}.cii-en16931.xml`, buildCii(inv, 'EN16931'));
  writeFileSync(`${out}/${name}.cii-xrechnung.xml`, buildCii(inv, 'XRECHNUNG'));
}
console.log(`${Object.keys(cases).length * 3} Beispieldateien in ${out}`);
