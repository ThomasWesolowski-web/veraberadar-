import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInvoice } from '../js/validate.js';
import { emptyInvoice } from '../js/model.js';
import { sampleInvoice } from './helpers.js';

const errors = (inv) => validateInvoice(inv).filter((f) => f.level === 'error');
const rules = (inv) => errors(inv).map((f) => f.rule);

test('vollständige Beispielrechnung hat keine Fehler', () => {
  assert.deepEqual(errors(sampleInvoice()), []);
});

test('leere Rechnung meldet alle Pflichtangaben nach § 14 UStG und XRechnung', () => {
  const r = rules(emptyInvoice());
  for (const id of ['BR-02', 'BR-DE-15', '§14-4-6', 'BR-06', 'BR-07', 'BR-DE-16', 'BT-34', 'BT-49',
    'BR-DE-3', 'BR-DE-4', 'BR-DE-5', 'BR-DE-6', 'BR-DE-7', 'BR-DE-8', 'BR-DE-9', 'BR-25', 'BR-DE-23-a']) {
    assert.ok(r.includes(id), `Regel ${id} fehlt in ${r.join(', ')}`);
  }
});

test('Leistungszeitraum ersetzt Leistungsdatum', () => {
  const inv = sampleInvoice();
  inv.deliveryDate = '';
  inv.periodStart = '2026-11-01';
  inv.periodEnd = '2026-11-30';
  assert.deepEqual(errors(inv), []);
  inv.periodEnd = '2026-10-01';
  assert.ok(rules(inv).includes('BR-29'));
});

test('Reverse Charge verlangt USt-IdNr. des Käufers und Hinweis', () => {
  const inv = sampleInvoice();
  inv.lines.forEach((l) => { l.vatCategory = 'AE'; l.vatRate = 0; });
  assert.ok(rules(inv).includes('BR-AE-02'));
  inv.buyer.vatId = 'DE811569869';
  assert.deepEqual(errors(inv), []);
  inv.exemptions.AE = { reason: '', code: '' };
  assert.ok(rules(inv).includes('BR-AE-10'));
});

test('innergemeinschaftliche Lieferung verlangt Lieferland', () => {
  const inv = sampleInvoice();
  inv.lines.forEach((l) => { l.vatCategory = 'K'; });
  inv.buyer.vatId = 'FR40303265045';
  inv.buyer.country = 'FR';
  assert.ok(rules(inv).includes('BR-IC-12'));
  inv.delivery.country = 'FR';
  inv.delivery.city = 'Paris';
  inv.delivery.zip = '75001';
  assert.deepEqual(errors(inv), []);
});

test('Kategorie S ohne Steuersatz ist Fehler', () => {
  const inv = sampleInvoice();
  inv.lines[0].vatRate = 0;
  assert.ok(rules(inv).includes('BR-S-05'));
});

test('ungültige IBAN wird erkannt', () => {
  const inv = sampleInvoice();
  inv.payment.iban = 'DE89370400440532013001';
  assert.ok(rules(inv).includes('BR-DE-19'));
});

test('Lastschrift verlangt Mandat, Gläubiger-ID und Zahler-IBAN', () => {
  const inv = sampleInvoice();
  inv.payment.code = '59';
  const r = rules(inv);
  assert.ok(r.includes('BR-DE-25-a') && r.includes('BR-DE-30') && r.includes('BR-DE-31'));
  Object.assign(inv.payment, { mandateId: 'M-1', creditorId: 'DE98ZZZ09999999999', debitedIban: 'DE89370400440532013000' });
  assert.deepEqual(errors(inv), []);
});

test('Kleinbetragsrechnung erzeugt Hinweis', () => {
  const inv = sampleInvoice();
  inv.lines = [inv.lines[2]];
  assert.ok(validateInvoice(inv).some((f) => f.rule === '§33 UStDV'));
});

test('Kategorie O verbietet Steuer-IDs', () => {
  const inv = sampleInvoice();
  inv.lines.forEach((l) => { l.vatCategory = 'O'; });
  assert.ok(rules(inv).includes('BR-O-02'));
  inv.seller.vatId = '';
  inv.seller.taxNumber = '';
  assert.deepEqual(errors(inv), []);
});
