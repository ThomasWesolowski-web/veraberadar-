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

// Erfundene Schlussrechnung im Aufbau typischer Handwerker-Software (mehrseitig, Fuß nur auf Seite 1 und letzter Seite)
const FOOT = [
  'BANKVERBINDUNG\tSTEUERNUMMER\tKONTAKT',
  'Sparkasse Musterstadt\tFinanzamt Musterstadt\tMuster Bau GmbH',
  'BIC COBADEFFXXX\tSt-Nr.: 12345/67890\tIndustriestr. 5, 70173 Stuttgart',
  'IBAN DE89 3704 0044 0532 0130 00\tUSt-IdNr.: DE136695976\t0711 / 12 34 56',
  '\tinfo@muster-bau.example',
];
const SCHLUSS = [
  [
    'Muster Bau GmbH + Industriestr. 5 + 70173 Stuttgart',
    'Herrn\t\tQualität.',
    'Max Beispiel\tHandwerk.',
    'Gartenweg 7',
    '71034 Böblingen\tService.',
    '\tKundennummer: 4711',
    '\tProjektnummer: P-2026-9',
    'Schlussrechnung\t3. November 2026',
    'Nr. : 2611001',
    'Die Leistung wurde am 30.10.2026 erbracht.',
    'Pos Menge Einh. Leistung EP [EUR] GP [EUR]',
    'Titel 01 Putzarbeiten',
    '01.1 120,50 m² Abdecken von empfindlichen 2,00 241,00',
    'Bauteilen',
    'Abdecken von empfindlichen Bauteilen mit Folie.',
    '01.2 85,00 m² Gipsputz Q2 einlagig, 15 mm, inkl. Eckschutz,',
    'maschinell aufgetragen und geglättet.',
    '16,40 1.394,00',
    ...FOOT,
  ],
  [
    '[Schlussrechnung 2611001] - Seite 2 von 2',
    'Pos Menge Einh. Leistung EP [EUR] GP [EUR]',
    '01.2 (Fortsetzung) Oberfläche Q2 nach Merkblatt.',
    '01.02.3 2,50 lfm Anschlussfuge 4,40 11,00',
    '02.1 12,00 h Facharbeiter 55,00 660,00',
    '02.2 1,000 t Bauschutt gemischt 150,00 150,00',
    'Titelzusammenstellung :',
    '01 Putzarbeiten 1.646,00',
    'Zwischensumme = EUR 2.456,00',
    'Rabatt -3,00 % EUREUR -73,68',
    'Nettosumme = EUR 2.382,32',
    'USt 19,00% + EUR 452,64',
    'Bruttosumme = EUR 2.834,96',
    'Wichtiger Hinweis: Soweit Sie unsere Leistungen als Nichtunternehmer bezogen haben, sind Sie gemäß §14b Abs.1 Satz 5 UStG',
    'verpflichtet, diese Rechnung zwei Jahre aufzubewahren.',
    'Übersicht der bisher erhaltenen Zahlungen:',
    'Rech.Nr. Datum Netto USt Brutto',
    '2610001 15.10.2026 1.000,00 190,00 EUR 1.190,00',
    'Summe Zahlungen: 1.000,00 190,00 EUR 1.190,00',
    'Zu zahlender Betrag: EUR 1.644,96',
    'Bei Zahlung bis zum 10.11.2026 abzüglich 2,00% Skonto [Sk.: 32,90 EUR - Zahlbetrag: 1.612,06 EUR]',
    'Nettozahlungsziel: 17.11.2026',
    ...FOOT,
  ],
].map((p) => p.join('\n')).join('\n\f\n');

test('mehrseitige Schlussrechnung mit Langtexten, Rabatt, Abschlägen und Skonto', async () => {
  const { computeTotals } = await import('../js/model.js');
  const { invoice: inv, warnings } = parseInvoiceText(SCHLUSS);
  assert.deepEqual(warnings, []);
  assert.equal(inv.type, '877');
  assert.equal(inv.number, '2611001');
  assert.equal(inv.issueDate, '2026-11-03');
  assert.equal(inv.deliveryDate, '2026-10-30');
  assert.equal(inv.dueDate, '2026-11-17');
  assert.equal(inv.buyer.id, '4711');
  assert.equal(inv.projectReference, 'P-2026-9');
  assert.equal(inv.buyerReference, 'P-2026-9');
  assert.deepEqual([inv.seller.name, inv.seller.street, inv.seller.zip, inv.seller.city],
    ['Muster Bau GmbH', 'Industriestr. 5', '70173', 'Stuttgart']);
  assert.deepEqual([inv.buyer.name, inv.buyer.street, inv.buyer.zip, inv.buyer.city],
    ['Max Beispiel', 'Gartenweg 7', '71034', 'Böblingen']);
  assert.equal(inv.seller.taxNumber, '12345/67890');
  assert.equal(inv.seller.vatId, 'DE136695976');
  assert.equal(inv.payment.iban, 'DE89370400440532013000');
  assert.deepEqual(inv.lines.map((l) => [l.articleNo, l.quantity, l.unit, l.price]), [
    ['01.1', 120.5, 'MTK', 2], ['01.2', 85, 'MTK', 16.4], ['01.02.3', 2.5, 'MTR', 4.4],
    ['02.1', 12, 'HUR', 55], ['02.2', 1, 'TNE', 150],
  ]);
  assert.equal(inv.lines[0].name, 'Abdecken von empfindlichen Bauteilen');
  assert.match(inv.lines[1].description, /maschinell aufgetragen[\s\S]*Oberfläche Q2 nach Merkblatt/);
  for (const l of inv.lines) assert.doesNotMatch(l.description, /BANKVERBINDUNG|IBAN|Seite 2/);
  assert.equal(inv.allowances.length, 1);
  assert.equal(inv.allowances[0].percent, '3');
  const t = computeTotals(inv);
  assert.equal(t.lineTotal, 2456);
  assert.equal(t.taxExclusive, 2382.32);
  assert.equal(t.taxTotal, 452.64);
  assert.equal(t.taxInclusive, 2834.96);
  assert.equal(t.payable, 1644.96);
  assert.equal(inv.payment.skontoDays, '7');
  assert.equal(inv.payment.skontoPercent, '2');
  assert.equal(inv.payment.skontoBase, ''); // Skonto bezieht sich auf den Zahlbetrag
  assert.match(inv.note, /^Soweit Sie unsere Leistungen[\s\S]*aufzubewahren\./);
  assert.match(inv.note, /Summe Zahlungen: 1\.000,00 190,00 EUR 1\.190,00/);
});
