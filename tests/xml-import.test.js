import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importXml } from '../js/xml-import.js';
import { computeTotals } from '../js/model.js';
import { validateInvoice } from '../js/validate.js';
import { buildXRechnung } from '../js/ubl.js';
import { parseXml } from './helpers.js';

const cii = readFileSync(new URL('./fixtures/zugferd-cii.xml', import.meta.url), 'utf8');

test('ZUGFeRD/CII wird importiert und in XRechnung (UBL) umgewandelt', () => {
  const { format, invoice } = importXml(parseXml(cii));
  assert.equal(format, 'CII');
  assert.equal(invoice.number, 'ZF-1001');
  assert.equal(invoice.issueDate, '2026-11-15');
  assert.equal(invoice.deliveryDate, '2026-11-10');
  assert.equal(invoice.dueDate, '2026-12-15');
  assert.equal(invoice.buyerReference, 'KST-77');
  assert.equal(invoice.seller.vatId, 'DE811569869');
  assert.equal(invoice.seller.contactName, 'Anna Schmidt');
  assert.equal(invoice.buyer.city, 'München');
  assert.equal(invoice.lines[0].unit, 'HUR');
  const t = computeTotals(invoice);
  assert.equal(t.taxInclusive, 428.4);
  assert.deepEqual(validateInvoice(invoice).filter((f) => f.level === 'error'), []);
  const ubl = buildXRechnung(invoice);
  parseXml(ubl);
  assert.match(ubl, /<cbc:PayableAmount currencyID="EUR">428.40<\/cbc:PayableAmount>/);
});

test('unbekanntes XML wird abgelehnt', () => {
  assert.throws(() => importXml(parseXml('<foo/>')), /Unbekanntes XML-Format/);
});
