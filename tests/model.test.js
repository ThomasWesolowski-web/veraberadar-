import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  round2, computeTotals, isValidIban, isValidVatId, isValidLeitwegId, paymentTermsText, emptyInvoice,
} from '../js/model.js';
import { sampleInvoice } from './helpers.js';

test('round2 rundet kaufmännisch', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(2.675), 2.68);
  assert.equal(round2(-1.005), -1.01);
  assert.equal(round2(0.1 + 0.2), 0.3);
});

test('Summen und USt-Aufschlüsselung nach EN 16931', () => {
  const t = computeTotals(sampleInvoice());
  // 7,5*68,50 = 513,75 ; 12*4,99 = 59,88 ; 39,90
  assert.equal(t.lineTotal, 613.53);
  const s19 = t.breakdown.find((g) => g.rate === 19);
  const s7 = t.breakdown.find((g) => g.rate === 7);
  assert.equal(s19.taxable, 573.63);
  assert.equal(s19.tax, 108.99);
  assert.equal(s7.taxable, 39.9);
  assert.equal(s7.tax, 2.79);
  assert.equal(t.taxTotal, 111.78);
  assert.equal(t.taxInclusive, 725.31);
  assert.equal(t.payable, 725.31);
});

test('Vorauszahlung reduziert den Zahlbetrag', () => {
  const inv = sampleInvoice();
  inv.prepaid = 100;
  assert.equal(computeTotals(inv).payable, 625.31);
});

test('IBAN-Prüfung', () => {
  assert.ok(isValidIban('DE89 3704 0044 0532 0130 00'));
  assert.ok(!isValidIban('DE89370400440532013001'));
  assert.ok(!isValidIban('DE8937040044053201300')); // zu kurz
});

test('USt-IdNr.-Prüfziffer (DE)', () => {
  assert.ok(isValidVatId('DE136695976'));
  assert.ok(isValidVatId('DE 811 569 869'));
  assert.ok(!isValidVatId('DE123456789'));
  assert.ok(!isValidVatId('DE12345678'));
});

test('Leitweg-ID-Prüfziffer', () => {
  assert.ok(isValidLeitwegId('04011000-1234512345-06'));
  assert.ok(isValidLeitwegId('991-33333TEST-33'));
  assert.ok(!isValidLeitwegId('04011000-1234512345-07'));
});

test('Skonto-Format nach BR-DE-18', () => {
  const inv = emptyInvoice();
  inv.payment.terms = 'Zahlbar in 30 Tagen.';
  inv.payment.skontoDays = '10';
  inv.payment.skontoPercent = '3';
  const s = paymentTermsText(inv);
  assert.equal(s, 'Zahlbar in 30 Tagen.\n#SKONTO#TAGE=10#PROZENT=3.00#\n');
  for (const line of s.split(/\r?\n/).filter((l) => l.trim().startsWith('#'))) {
    assert.match(line, /^#(SKONTO)#TAGE=([0-9]+#PROZENT=[0-9]+\.[0-9]{2})(#BASISBETRAG=-?[0-9]+\.[0-9]{2})?#$/);
  }
});
