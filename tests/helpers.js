import { DOMParser } from '@xmldom/xmldom';
import { emptyInvoice } from '../js/model.js';

export function parseXml(xml) {
  const errors = [];
  const doc = new DOMParser({
    onError: (level, msg) => { if (level !== 'warning') errors.push(msg); },
  }).parseFromString(xml, 'application/xml');
  if (errors.length) throw new Error('XML nicht wohlgeformt: ' + errors.join('; '));
  return doc;
}

/** Vollständige, gültige Beispielrechnung */
export function sampleInvoice() {
  const inv = emptyInvoice();
  Object.assign(inv, {
    number: 'RE-2026-0042',
    issueDate: '2026-11-24',
    dueDate: '2026-12-08',
    buyerReference: '04011000-1234512345-06',
    orderReference: 'PO-4711',
    deliveryDate: '2026-11-20',
  });
  Object.assign(inv.seller, {
    name: 'Muster Handwerk GmbH', street: 'Hauptstraße 1', zip: '50667', city: 'Köln', country: 'DE',
    vatId: 'DE136695976', taxNumber: '214/5678/1234', registrationId: 'HRB 12345',
    legalInfo: 'Sitz Köln, Geschäftsführer: Max Muster',
    endpoint: 'rechnung@muster-handwerk.de', endpointScheme: 'EM',
    contactName: 'Max Muster', contactPhone: '+49 221 123456', contactEmail: 'max@muster-handwerk.de',
  });
  Object.assign(inv.buyer, {
    name: 'Stadt Beispielhausen', street: 'Rathausplatz 5', zip: '10115', city: 'Berlin', country: 'DE',
    endpoint: '04011000-1234512345-06', endpointScheme: '0204',
  });
  Object.assign(inv.payment, {
    code: '58', iban: 'DE89 3704 0044 0532 0130 00', bic: 'COBADEFFXXX', accountName: 'Muster Handwerk GmbH',
    reference: 'RE-2026-0042', terms: 'Zahlbar innerhalb von 14 Tagen ohne Abzug.', skontoDays: '7', skontoPercent: '2',
  });
  inv.lines = [
    { name: 'Montagearbeiten', description: 'Elektroinstallation Büro 2.OG', articleNo: 'L-100', quantity: 7.5, unit: 'HUR', price: 68.5, vatCategory: 'S', vatRate: 19 },
    { name: 'Kabelkanal 40x60', description: '', articleNo: 'M-2040', quantity: 12, unit: 'MTR', price: 4.99, vatCategory: 'S', vatRate: 19 },
    { name: 'Fachbuch Elektrotechnik', description: '', articleNo: '', quantity: 1, unit: 'C62', price: 39.9, vatCategory: 'S', vatRate: 7 },
  ];
  return inv;
}
