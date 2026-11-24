import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInvoiceText, parseAmount, parseGermanDate } from '../js/pdf-text.js';

test('Betrags- und Datumsformate', () => {
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('1234,5 €'.replace(',5', ',50')), 1234.5);
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseGermanDate('24.11.2026'), '2026-11-24');
  assert.equal(parseGermanDate('1.2.26'), '2026-02-01');
});

const SAMPLE = `Muster Handwerk GmbH · Hauptstraße 1 · 50667 Köln
Stadt Beispielhausen
Rathausplatz 5
10115 Berlin
Rechnung
Rechnungsnummer: RE-2026-0042
Rechnungsdatum: 24.11.2026
Leistungsdatum: 20.11.2026
Leitweg-ID: 04011000-1234512345-06
Pos Menge Einheit Bezeichnung Einzelpreis Gesamt
1 7,5 Std. Montagearbeiten 68,50 € 513,75 €
2 12 m Kabelkanal 40x60 4,99 € 59,88 €
Nettobetrag 573,63 €
zzgl. 19 % MwSt. 108,99 €
Gesamtbetrag 682,62 €
Zahlbar innerhalb von 14 Tagen. 2 % Skonto bei Zahlung innerhalb von 7 Tagen.
Muster Handwerk GmbH · Tel.: 0221 123456 · info@muster-handwerk.de
IBAN: DE89 3704 0044 0532 0130 00 · BIC: COBADEFFXXX
USt-IdNr.: DE136695976 · Steuernummer: 214/5678/1234 · Amtsgericht Köln HRB 12345`;

test('erkennt Rechnungsdaten aus PDF-Text', () => {
  const { invoice: inv, warnings, detected } = parseInvoiceText(SAMPLE);
  assert.equal(inv.number, 'RE-2026-0042');
  assert.equal(inv.issueDate, '2026-11-24');
  assert.equal(inv.deliveryDate, '2026-11-20');
  assert.equal(inv.dueDate, '2026-12-08');
  assert.equal(inv.buyerReference, '04011000-1234512345-06');
  assert.equal(inv.buyer.endpointScheme, '0204');
  assert.equal(inv.payment.iban, 'DE89370400440532013000');
  assert.equal(inv.payment.bic, 'COBADEFFXXX');
  assert.equal(inv.payment.skontoDays, '7');
  assert.equal(inv.payment.skontoPercent, '2');
  assert.equal(inv.seller.vatId, 'DE136695976');
  assert.equal(inv.seller.taxNumber, '214/5678/1234');
  assert.equal(inv.seller.registrationId, 'HRB 12345');
  assert.equal(inv.seller.name, 'Muster Handwerk GmbH');
  assert.equal(inv.seller.street, 'Hauptstraße 1');
  assert.equal(inv.seller.zip, '50667');
  assert.equal(inv.buyer.name, 'Stadt Beispielhausen');
  assert.equal(inv.buyer.street, 'Rathausplatz 5');
  assert.equal(inv.buyer.city, 'Berlin');
  assert.equal(inv.seller.contactEmail, 'info@muster-handwerk.de');
  assert.equal(inv.seller.contactPhone, '0221 123456');
  assert.equal(inv.lines.length, 2);
  assert.deepEqual(
    inv.lines.map((l) => [l.name, l.quantity, l.unit, l.price, l.vatRate]),
    [['Montagearbeiten', 7.5, 'HUR', 68.5, 19], ['Kabelkanal 40x60', 12, 'MTR', 4.99, 19]],
  );
  assert.equal(detected.net, 573.63);
  assert.equal(detected.gross, 682.62);
  assert.deepEqual(warnings, []);
});

test('ohne Positionen wird eine Sammelposition aus dem Nettobetrag gebildet', () => {
  const { invoice, warnings } = parseInvoiceText('Rechnung Nr. 77\nDatum: 01.10.2026\nNetto: 1.000,00 EUR\nUSt 19 %: 190,00 EUR\nBrutto: 1.190,00 EUR');
  assert.equal(invoice.number, '77');
  assert.equal(invoice.lines.length, 1);
  assert.equal(invoice.lines[0].price, 1000);
  assert.equal(invoice.lines[0].vatRate, 19);
  assert.ok(warnings.length > 0);
});

test('erkennt Reverse Charge und Kleinunternehmer', () => {
  const rc = parseInvoiceText('Rechnung Nr. 5\nNetto 500,00\nSteuerschuldnerschaft des Leistungsempfängers').invoice;
  assert.equal(rc.lines[0].vatCategory, 'AE');
  const ku = parseInvoiceText('Rechnung Nr. 6\nGesamtbetrag 300,00\nGemäß § 19 UStG wird keine Umsatzsteuer berechnet.').invoice;
  assert.equal(ku.lines[0].vatCategory, 'E');
  assert.equal(ku.lines[0].price, 300);
});
