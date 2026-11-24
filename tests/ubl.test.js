import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildXRechnung } from '../js/ubl.js';
import { importXml } from '../js/xml-import.js';
import { computeTotals, CUSTOMIZATION_ID } from '../js/model.js';
import { validateInvoice } from '../js/validate.js';
import { parseXml, sampleInvoice } from './helpers.js';

const NS_CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';
const val = (doc, name, i = 0) => doc.getElementsByTagNameNS(NS_CBC, name)[i]?.textContent;

test('erzeugt wohlgeformte UBL-Rechnung mit XRechnung-Kennung', () => {
  const xml = buildXRechnung(sampleInvoice());
  const doc = parseXml(xml);
  assert.equal(doc.documentElement.localName, 'Invoice');
  assert.equal(val(doc, 'CustomizationID'), CUSTOMIZATION_ID);
  assert.equal(val(doc, 'InvoiceTypeCode'), '380');
  assert.equal(val(doc, 'BuyerReference'), '04011000-1234512345-06');
  assert.equal(val(doc, 'PayableAmount'), '725.31');
  assert.equal(val(doc, 'TaxAmount'), '111.78');
  assert.match(xml, /<cbc:EndpointID schemeID="0204">04011000-1234512345-06<\/cbc:EndpointID>/);
  assert.match(xml, /<cbc:EndpointID schemeID="EM">rechnung@muster-handwerk.de<\/cbc:EndpointID>/);
  assert.match(xml, /<cbc:ID>DE89370400440532013000<\/cbc:ID>/);
  assert.match(xml, /#SKONTO#TAGE=7#PROZENT=2.00#\n<\/cbc:Note>/);
  assert.match(xml, /<cac:TaxScheme>\s*<cbc:ID>FC<\/cbc:ID>/);
});

test('Elementreihenfolge entspricht dem UBL-2.1-Schema', () => {
  const xml = buildXRechnung(sampleInvoice());
  const order = ['cbc:CustomizationID', 'cbc:ProfileID', 'cbc:ID', 'cbc:IssueDate', 'cbc:DueDate', 'cbc:InvoiceTypeCode',
    'cbc:DocumentCurrencyCode', 'cbc:BuyerReference', 'cac:OrderReference', 'cac:AccountingSupplierParty',
    'cac:AccountingCustomerParty', 'cac:Delivery', 'cac:PaymentMeans', 'cac:PaymentTerms', 'cac:TaxTotal',
    'cac:LegalMonetaryTotal', 'cac:InvoiceLine'];
  let pos = -1;
  for (const tag of order) {
    const p = xml.indexOf(`<${tag}`);
    assert.ok(p > pos, `${tag} steht an falscher Stelle`);
    pos = p;
  }
});

test('Sonderzeichen werden maskiert', () => {
  const inv = sampleInvoice();
  inv.lines[0].name = 'Müller & Söhne <Spezial> "A"';
  const xml = buildXRechnung(inv);
  parseXml(xml);
  assert.match(xml, /Müller &amp; Söhne &lt;Spezial&gt; &quot;A&quot;/);
});

test('Gutschrift (381) wird als CreditNote erzeugt', () => {
  const inv = sampleInvoice();
  inv.type = '381';
  inv.precedingInvoiceNumber = 'RE-2026-0001';
  inv.precedingInvoiceDate = '2026-10-01';
  const xml = buildXRechnung(inv);
  const doc = parseXml(xml);
  assert.equal(doc.documentElement.localName, 'CreditNote');
  assert.equal(val(doc, 'CreditNoteTypeCode'), '381');
  assert.ok(xml.includes('<cbc:CreditedQuantity unitCode="HUR">7.5</cbc:CreditedQuantity>'));
  assert.ok(xml.includes('<cbc:PaymentDueDate>2026-12-08</cbc:PaymentDueDate>'));
  assert.ok(!xml.includes('<cbc:DueDate>'));
});

test('Reverse Charge: Kategorie AE mit 0 % und Befreiungsgrund', () => {
  const inv = sampleInvoice();
  inv.buyer.vatId = 'DE811569869';
  inv.lines.forEach((l) => { l.vatCategory = 'AE'; });
  const xml = buildXRechnung(inv);
  assert.match(xml, /<cbc:ID>AE<\/cbc:ID>\s*<cbc:Percent>0<\/cbc:Percent>\s*<cbc:TaxExemptionReasonCode>VATEX-EU-AE<\/cbc:TaxExemptionReasonCode>\s*<cbc:TaxExemptionReason>Steuerschuldnerschaft des Leistungsempfängers/);
  assert.equal(val(parseXml(xml), 'TaxAmount'), '0.00');
});

test('PDF-Anlage wird eingebettet', () => {
  const inv = sampleInvoice();
  inv.attachment = { filename: 'rechnung.pdf', mimeCode: 'application/pdf', base64: 'JVBERi0xLjQK' };
  const xml = buildXRechnung(inv);
  assert.match(xml, /<cbc:EmbeddedDocumentBinaryObject mimeCode="application\/pdf" filename="rechnung.pdf">JVBERi0xLjQK<\/cbc:EmbeddedDocumentBinaryObject>/);
  assert.ok(xml.indexOf('cac:AdditionalDocumentReference') < xml.indexOf('cac:AccountingSupplierParty'));
});

test('Rundreise: erzeugte XRechnung lässt sich wieder importieren', () => {
  const orig = sampleInvoice();
  const { format, invoice } = importXml(parseXml(buildXRechnung(orig)));
  assert.equal(format, 'UBL');
  assert.equal(invoice.number, orig.number);
  assert.equal(invoice.seller.vatId, orig.seller.vatId);
  assert.equal(invoice.seller.taxNumber, orig.seller.taxNumber);
  assert.equal(invoice.buyer.endpointScheme, '0204');
  assert.equal(invoice.payment.skontoDays, '7');
  assert.equal(invoice.payment.skontoPercent, '2.00');
  assert.equal(invoice.payment.terms, orig.payment.terms);
  assert.equal(invoice.lines.length, 3);
  assert.deepEqual(computeTotals(invoice), computeTotals(orig));
  assert.deepEqual(validateInvoice(invoice).filter((f) => f.level === 'error'), []);
});
