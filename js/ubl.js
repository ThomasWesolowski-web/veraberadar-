// Erzeugt eine XRechnung 3.0 im Syntax-Format OASIS UBL 2.1 (Invoice bzw. CreditNote)
import {
  CUSTOMIZATION_ID, PROFILE_ID, computeTotals, lineNet, num, normalizeIban, paymentTermsText,
} from './model.js';

export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // in XML 1.0 unzulässige Steuerzeichen entfernen
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const amt = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);
const qty = (n) => {
  const s = String(num(n));
  return s.includes('e') ? num(n).toFixed(6) : s;
};
const pct = (n) => {
  const v = num(n);
  return Number.isInteger(v) ? v.toFixed(0) : String(v);
};

class XmlWriter {
  constructor() { this.parts = []; this.depth = 0; }
  open(tag, attrs = {}) {
    this.parts.push(`${'  '.repeat(this.depth)}<${tag}${attrStr(attrs)}>`);
    this.depth++;
    return this;
  }
  close(tag) {
    this.depth--;
    this.parts.push(`${'  '.repeat(this.depth)}</${tag}>`);
    return this;
  }
  el(tag, value, attrs = {}) {
    if (!has(value)) return this;
    this.parts.push(`${'  '.repeat(this.depth)}<${tag}${attrStr(attrs)}>${esc(value)}</${tag}>`);
    return this;
  }
  /** Alias für mehrzeilige Texte (Zeilenumbrüche bleiben erhalten). */
  raw(tag, value, attrs = {}) { return this.el(tag, value, attrs); }
  toString() { return this.parts.join('\n'); }
}

function attrStr(attrs) {
  return Object.entries(attrs)
    .filter(([, v]) => has(v))
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join('');
}

function cleanVatId(v) {
  return String(v || '').replace(/\s+/g, '').toUpperCase();
}

function writeAddress(w, a) {
  w.open('cac:PostalAddress');
  w.el('cbc:StreetName', a.street);
  w.el('cbc:AdditionalStreetName', a.additionalStreet);
  w.el('cbc:CityName', a.city);
  w.el('cbc:PostalZone', a.zip);
  w.open('cac:Country').el('cbc:IdentificationCode', a.country || 'DE').close('cac:Country');
  w.close('cac:PostalAddress');
}

function writeParty(w, p, { isSeller, creditorId, omitTaxIds }) {
  w.open('cac:Party');
  w.el('cbc:EndpointID', p.endpoint, { schemeID: p.endpointScheme || 'EM' });
  if (has(p.id)) w.open('cac:PartyIdentification').el('cbc:ID', p.id).close('cac:PartyIdentification');
  if (isSeller && has(creditorId))
    w.open('cac:PartyIdentification').el('cbc:ID', creditorId, { schemeID: 'SEPA' }).close('cac:PartyIdentification');
  if (has(p.tradingName)) w.open('cac:PartyName').el('cbc:Name', p.tradingName).close('cac:PartyName');
  writeAddress(w, p);
  if (!omitTaxIds && has(p.vatId)) {
    w.open('cac:PartyTaxScheme').el('cbc:CompanyID', cleanVatId(p.vatId));
    w.open('cac:TaxScheme').el('cbc:ID', 'VAT').close('cac:TaxScheme');
    w.close('cac:PartyTaxScheme');
  }
  if (isSeller && !omitTaxIds && has(p.taxNumber)) {
    w.open('cac:PartyTaxScheme').el('cbc:CompanyID', p.taxNumber.trim());
    w.open('cac:TaxScheme').el('cbc:ID', 'FC').close('cac:TaxScheme');
    w.close('cac:PartyTaxScheme');
  }
  w.open('cac:PartyLegalEntity');
  w.el('cbc:RegistrationName', p.name);
  w.el('cbc:CompanyID', p.registrationId);
  if (isSeller) w.el('cbc:CompanyLegalForm', p.legalInfo);
  w.close('cac:PartyLegalEntity');
  if (has(p.contactName) || has(p.contactPhone) || has(p.contactEmail)) {
    w.open('cac:Contact');
    w.el('cbc:Name', p.contactName);
    w.el('cbc:Telephone', p.contactPhone);
    w.el('cbc:ElectronicMail', p.contactEmail);
    w.close('cac:Contact');
  }
  w.close('cac:Party');
}

function writeTaxCategory(w, tag, category, rate, reason, code, { omitPercent = false } = {}) {
  w.open(tag);
  w.el('cbc:ID', category);
  if (!omitPercent && !(tag === 'cac:ClassifiedTaxCategory' && category === 'O')) w.el('cbc:Percent', pct(rate));
  if (tag === 'cac:TaxCategory' && (reason || code)) {
    w.el('cbc:TaxExemptionReasonCode', code);
    w.el('cbc:TaxExemptionReason', reason);
  }
  w.open('cac:TaxScheme').el('cbc:ID', 'VAT').close('cac:TaxScheme');
  w.close(tag);
}

export function buildXRechnung(inv) {
  const isCN = inv.type === '381';
  const root = isCN ? 'CreditNote' : 'Invoice';
  const ns = isCN
    ? 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2'
    : 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
  const cur = inv.currency || 'EUR';
  const t = computeTotals(inv);
  const p = inv.payment;
  const s = inv.seller;
  const b = inv.buyer;
  const onlyO = inv.lines.length > 0 && inv.lines.every((l) => l.vatCategory === 'O');

  const w = new XmlWriter();
  w.parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  w.open(`ubl:${root}`, {
    'xmlns:ubl': ns,
    'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
    'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  });
  w.el('cbc:CustomizationID', CUSTOMIZATION_ID);
  w.el('cbc:ProfileID', PROFILE_ID);
  w.el('cbc:ID', inv.number);
  w.el('cbc:IssueDate', inv.issueDate);
  if (!isCN) w.el('cbc:DueDate', inv.dueDate);
  w.el(isCN ? 'cbc:CreditNoteTypeCode' : 'cbc:InvoiceTypeCode', inv.type);
  if (inv.type === '389') w.el('cbc:Note', 'Gutschrift');
  if (has(inv.note)) w.raw('cbc:Note', inv.note);
  w.el('cbc:DocumentCurrencyCode', cur);
  w.el('cbc:BuyerReference', inv.buyerReference);

  if (has(inv.periodStart) || has(inv.periodEnd)) {
    w.open('cac:InvoicePeriod');
    w.el('cbc:StartDate', inv.periodStart);
    w.el('cbc:EndDate', inv.periodEnd);
    w.close('cac:InvoicePeriod');
  }
  if (has(inv.orderReference))
    w.open('cac:OrderReference').el('cbc:ID', inv.orderReference).close('cac:OrderReference');
  if (has(inv.precedingInvoiceNumber)) {
    w.open('cac:BillingReference').open('cac:InvoiceDocumentReference');
    w.el('cbc:ID', inv.precedingInvoiceNumber);
    w.el('cbc:IssueDate', inv.precedingInvoiceDate);
    w.close('cac:InvoiceDocumentReference').close('cac:BillingReference');
  }
  if (has(inv.contractReference))
    w.open('cac:ContractDocumentReference').el('cbc:ID', inv.contractReference).close('cac:ContractDocumentReference');
  if (inv.attachment && has(inv.attachment.base64)) {
    const a = inv.attachment;
    w.open('cac:AdditionalDocumentReference');
    w.el('cbc:ID', a.id || a.filename || 'Anlage-1');
    w.el('cbc:DocumentDescription', a.description || 'Originalrechnung (PDF)');
    w.open('cac:Attachment');
    w.el('cbc:EmbeddedDocumentBinaryObject', a.base64, { mimeCode: a.mimeCode || 'application/pdf', filename: a.filename });
    w.close('cac:Attachment');
    w.close('cac:AdditionalDocumentReference');
  }
  if (has(inv.projectReference)) {
    if (isCN) {
      w.open('cac:AdditionalDocumentReference').el('cbc:ID', inv.projectReference);
      w.el('cbc:DocumentTypeCode', '50').close('cac:AdditionalDocumentReference');
    } else {
      w.open('cac:ProjectReference').el('cbc:ID', inv.projectReference).close('cac:ProjectReference');
    }
  }

  w.open('cac:AccountingSupplierParty');
  writeParty(w, s, { isSeller: true, creditorId: p.code === '59' ? p.creditorId : '', omitTaxIds: onlyO });
  w.close('cac:AccountingSupplierParty');

  w.open('cac:AccountingCustomerParty');
  writeParty(w, b, { isSeller: false, omitTaxIds: onlyO });
  w.close('cac:AccountingCustomerParty');

  const d = inv.delivery;
  const hasAddr = ['street', 'zip', 'city', 'country'].some((k) => has(d[k]));
  if (has(inv.deliveryDate) || hasAddr) {
    w.open('cac:Delivery');
    w.el('cbc:ActualDeliveryDate', inv.deliveryDate);
    if (hasAddr) {
      w.open('cac:DeliveryLocation').open('cac:Address');
      w.el('cbc:StreetName', d.street);
      w.el('cbc:CityName', d.city);
      w.el('cbc:PostalZone', d.zip);
      w.open('cac:Country').el('cbc:IdentificationCode', d.country || 'DE').close('cac:Country');
      w.close('cac:Address').close('cac:DeliveryLocation');
    }
    if (has(d.name)) w.open('cac:DeliveryParty').open('cac:PartyName').el('cbc:Name', d.name).close('cac:PartyName').close('cac:DeliveryParty');
    w.close('cac:Delivery');
  }

  // BG-16 Zahlungsanweisungen
  w.open('cac:PaymentMeans');
  w.el('cbc:PaymentMeansCode', p.code);
  if (isCN) w.el('cbc:PaymentDueDate', inv.dueDate);
  w.el('cbc:PaymentID', p.reference);
  if (['54', '55'].includes(p.code)) {
    w.open('cac:CardAccount');
    w.el('cbc:PrimaryAccountNumberID', p.cardNumber);
    w.el('cbc:NetworkID', 'NA');
    w.el('cbc:HolderName', p.cardHolder);
    w.close('cac:CardAccount');
  }
  if (['58', '30'].includes(p.code)) {
    w.open('cac:PayeeFinancialAccount');
    w.el('cbc:ID', p.code === '58' ? normalizeIban(p.iban) : p.iban);
    w.el('cbc:Name', p.accountName);
    if (has(p.bic)) w.open('cac:FinancialInstitutionBranch').el('cbc:ID', p.bic.replace(/\s+/g, '').toUpperCase()).close('cac:FinancialInstitutionBranch');
    w.close('cac:PayeeFinancialAccount');
  }
  if (p.code === '59') {
    w.open('cac:PaymentMandate');
    w.el('cbc:ID', p.mandateId);
    w.open('cac:PayerFinancialAccount').el('cbc:ID', normalizeIban(p.debitedIban)).close('cac:PayerFinancialAccount');
    w.close('cac:PaymentMandate');
  }
  w.close('cac:PaymentMeans');

  const terms = paymentTermsText(inv);
  if (has(terms)) w.open('cac:PaymentTerms').raw('cbc:Note', terms).close('cac:PaymentTerms');

  // BG-20 / BG-21 Rabatte und Zuschläge auf Rechnungsebene
  for (const a of t.allowances) {
    w.open('cac:AllowanceCharge');
    w.el('cbc:ChargeIndicator', a.charge ? 'true' : 'false');
    w.el('cbc:AllowanceChargeReason', a.reason || (a.charge ? 'Zuschlag' : 'Rabatt'));
    if (a.hasPct) w.el('cbc:MultiplierFactorNumeric', String(num(a.percent)));
    w.el('cbc:Amount', amt(a.amount), { currencyID: cur });
    if (a.hasPct) w.el('cbc:BaseAmount', amt(a.base), { currencyID: cur });
    writeTaxCategory(w, 'cac:TaxCategory', a.vatCategory, a.rate, null, null, { omitPercent: a.vatCategory === 'O' });
    w.close('cac:AllowanceCharge');
  }

  // BG-23 Steueraufschlüsselung
  w.open('cac:TaxTotal');
  w.el('cbc:TaxAmount', amt(t.taxTotal), { currencyID: cur });
  for (const g of t.breakdown) {
    w.open('cac:TaxSubtotal');
    w.el('cbc:TaxableAmount', amt(g.taxable), { currencyID: cur });
    w.el('cbc:TaxAmount', amt(g.tax), { currencyID: cur });
    writeTaxCategory(w, 'cac:TaxCategory', g.category, g.rate, g.exemptionReason, g.exemptionCode);
    w.close('cac:TaxSubtotal');
  }
  w.close('cac:TaxTotal');

  // BG-22 Summen
  w.open('cac:LegalMonetaryTotal');
  w.el('cbc:LineExtensionAmount', amt(t.lineTotal), { currencyID: cur });
  w.el('cbc:TaxExclusiveAmount', amt(t.taxExclusive), { currencyID: cur });
  w.el('cbc:TaxInclusiveAmount', amt(t.taxInclusive), { currencyID: cur });
  if (t.allowances.some((a) => !a.charge)) w.el('cbc:AllowanceTotalAmount', amt(t.allowanceTotal), { currencyID: cur });
  if (t.allowances.some((a) => a.charge)) w.el('cbc:ChargeTotalAmount', amt(t.chargeTotal), { currencyID: cur });
  if (t.prepaid) w.el('cbc:PrepaidAmount', amt(t.prepaid), { currencyID: cur });
  w.el('cbc:PayableAmount', amt(t.payable), { currencyID: cur });
  w.close('cac:LegalMonetaryTotal');

  // BG-25 Positionen
  const lineTag = isCN ? 'cac:CreditNoteLine' : 'cac:InvoiceLine';
  const qtyTag = isCN ? 'cbc:CreditedQuantity' : 'cbc:InvoicedQuantity';
  inv.lines.forEach((l, i) => {
    w.open(lineTag);
    w.el('cbc:ID', String(i + 1));
    w.el(qtyTag, qty(l.quantity), { unitCode: l.unit || 'C62' });
    w.el('cbc:LineExtensionAmount', amt(lineNet(l)), { currencyID: cur });
    w.open('cac:Item');
    w.el('cbc:Description', l.description);
    w.el('cbc:Name', l.name);
    if (has(l.articleNo)) w.open('cac:SellersItemIdentification').el('cbc:ID', l.articleNo).close('cac:SellersItemIdentification');
    writeTaxCategory(w, 'cac:ClassifiedTaxCategory', l.vatCategory, l.vatCategory === 'S' ? l.vatRate : 0);
    w.close('cac:Item');
    w.open('cac:Price').el('cbc:PriceAmount', String(num(l.price)), { currencyID: cur }).close('cac:Price');
    w.close(lineTag);
  });

  w.close(`ubl:${root}`);
  return w.toString() + '\n';
}

export function suggestedFilename(inv) {
  const nr = String(inv.number || 'rechnung').replace(/[^A-Za-z0-9._-]+/g, '_');
  return `XRechnung_${nr}.xml`;
}
