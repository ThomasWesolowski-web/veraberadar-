// Erzeugt UN/CEFACT Cross Industry Invoice (CII D16B) für ZUGFeRD 2.3 / Factur-X 1.07
// Profile: EN 16931 (Comfort) oder XRECHNUNG
import { computeTotals, lineNet, num, normalizeIban, paymentTermsText, CUSTOMIZATION_ID, PROFILE_ID } from './model.js';
import { esc } from './ubl.js';

export const ZUGFERD_PROFILES = {
  EN16931: { label: 'ZUGFeRD 2.3 – Profil EN 16931 (Comfort)', guideline: 'urn:cen.eu:en16931:2017', fxLevel: 'EN 16931' },
  XRECHNUNG: { label: 'ZUGFeRD 2.3 – Profil XRECHNUNG', guideline: CUSTOMIZATION_ID, fxLevel: 'XRECHNUNG' },
};

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
const d102 = (iso) => String(iso || '').replace(/-/g, '');

class W {
  constructor() { this.p = []; this.d = 0; }
  open(t, a = {}) { this.p.push(`${'  '.repeat(this.d)}<${t}${attrs(a)}>`); this.d++; return this; }
  close(t) { this.d--; this.p.push(`${'  '.repeat(this.d)}</${t}>`); return this; }
  el(t, v, a = {}) {
    if (!has(v)) return this;
    this.p.push(`${'  '.repeat(this.d)}<${t}${attrs(a)}>${esc(v)}</${t}>`);
    return this;
  }
  date(t, iso, ns = 'udt') {
    if (!has(iso)) return this;
    return this.open(t).el(`${ns}:DateTimeString`, d102(iso), { format: '102' }).close(t);
  }
  toString() { return this.p.join('\n'); }
}
function attrs(a) {
  return Object.entries(a).filter(([, v]) => has(v)).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
}

function party(w, tag, p, { isSeller, omitTaxIds }) {
  w.open(tag);
  w.el('ram:ID', p.id);
  w.el('ram:Name', p.name);
  if (isSeller) w.el('ram:Description', p.legalInfo);
  if (has(p.registrationId) || has(p.tradingName)) {
    w.open('ram:SpecifiedLegalOrganization');
    w.el('ram:ID', p.registrationId);
    w.el('ram:TradingBusinessName', p.tradingName);
    w.close('ram:SpecifiedLegalOrganization');
  }
  if (has(p.contactName) || has(p.contactPhone) || has(p.contactEmail)) {
    w.open('ram:DefinedTradeContact');
    w.el('ram:PersonName', p.contactName);
    if (has(p.contactPhone)) w.open('ram:TelephoneUniversalCommunication').el('ram:CompleteNumber', p.contactPhone).close('ram:TelephoneUniversalCommunication');
    if (has(p.contactEmail)) w.open('ram:EmailURIUniversalCommunication').el('ram:URIID', p.contactEmail).close('ram:EmailURIUniversalCommunication');
    w.close('ram:DefinedTradeContact');
  }
  w.open('ram:PostalTradeAddress');
  w.el('ram:PostcodeCode', p.zip);
  w.el('ram:LineOne', p.street);
  w.el('ram:LineTwo', p.additionalStreet);
  w.el('ram:CityName', p.city);
  w.el('ram:CountryID', p.country || 'DE');
  w.close('ram:PostalTradeAddress');
  if (has(p.endpoint)) {
    w.open('ram:URIUniversalCommunication').el('ram:URIID', p.endpoint, { schemeID: p.endpointScheme || 'EM' }).close('ram:URIUniversalCommunication');
  }
  if (!omitTaxIds && isSeller && has(p.taxNumber)) {
    w.open('ram:SpecifiedTaxRegistration').el('ram:ID', p.taxNumber.trim(), { schemeID: 'FC' }).close('ram:SpecifiedTaxRegistration');
  }
  if (!omitTaxIds && has(p.vatId)) {
    w.open('ram:SpecifiedTaxRegistration').el('ram:ID', String(p.vatId).replace(/\s+/g, '').toUpperCase(), { schemeID: 'VA' }).close('ram:SpecifiedTaxRegistration');
  }
  w.close(tag);
}

/**
 * @param {object} inv Rechnung
 * @param {'EN16931'|'XRECHNUNG'} profile
 */
export function buildCii(inv, profile = 'EN16931') {
  const prof = ZUGFERD_PROFILES[profile] || ZUGFERD_PROFILES.EN16931;
  const t = computeTotals(inv);
  const cur = inv.currency || 'EUR';
  const p = inv.payment;
  const onlyO = inv.lines.length > 0 && inv.lines.every((l) => l.vatCategory === 'O');
  const w = new W();
  w.p.push('<?xml version="1.0" encoding="UTF-8"?>');
  w.open('rsm:CrossIndustryInvoice', {
    'xmlns:rsm': 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
    'xmlns:ram': 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
    'xmlns:qdt': 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
    'xmlns:udt': 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
  });

  w.open('rsm:ExchangedDocumentContext');
  if (profile === 'XRECHNUNG') {
    w.open('ram:BusinessProcessSpecifiedDocumentContextParameter').el('ram:ID', PROFILE_ID).close('ram:BusinessProcessSpecifiedDocumentContextParameter');
  }
  w.open('ram:GuidelineSpecifiedDocumentContextParameter').el('ram:ID', prof.guideline).close('ram:GuidelineSpecifiedDocumentContextParameter');
  w.close('rsm:ExchangedDocumentContext');

  w.open('rsm:ExchangedDocument');
  w.el('ram:ID', inv.number);
  w.el('ram:TypeCode', inv.type);
  w.date('ram:IssueDateTime', inv.issueDate);
  const notes = [];
  if (inv.type === '389') notes.push('Gutschrift');
  if (has(inv.note)) notes.push(inv.note);
  for (const n of notes) w.open('ram:IncludedNote').el('ram:Content', n).close('ram:IncludedNote');
  w.close('rsm:ExchangedDocument');

  w.open('rsm:SupplyChainTradeTransaction');

  // Positionen
  inv.lines.forEach((l, i) => {
    w.open('ram:IncludedSupplyChainTradeLineItem');
    w.open('ram:AssociatedDocumentLineDocument').el('ram:LineID', String(i + 1)).close('ram:AssociatedDocumentLineDocument');
    w.open('ram:SpecifiedTradeProduct');
    w.el('ram:SellerAssignedID', l.articleNo);
    w.el('ram:Name', l.name);
    w.el('ram:Description', l.description);
    w.close('ram:SpecifiedTradeProduct');
    w.open('ram:SpecifiedLineTradeAgreement');
    w.open('ram:NetPriceProductTradePrice').el('ram:ChargeAmount', String(num(l.price))).close('ram:NetPriceProductTradePrice');
    w.close('ram:SpecifiedLineTradeAgreement');
    w.open('ram:SpecifiedLineTradeDelivery');
    w.el('ram:BilledQuantity', qty(l.quantity), { unitCode: l.unit || 'C62' });
    w.close('ram:SpecifiedLineTradeDelivery');
    w.open('ram:SpecifiedLineTradeSettlement');
    w.open('ram:ApplicableTradeTax');
    w.el('ram:TypeCode', 'VAT');
    w.el('ram:CategoryCode', l.vatCategory);
    if (l.vatCategory !== 'O') w.el('ram:RateApplicablePercent', pct(l.vatCategory === 'S' ? l.vatRate : 0));
    w.close('ram:ApplicableTradeTax');
    w.open('ram:SpecifiedTradeSettlementLineMonetarySummation').el('ram:LineTotalAmount', amt(lineNet(l))).close('ram:SpecifiedTradeSettlementLineMonetarySummation');
    w.close('ram:SpecifiedLineTradeSettlement');
    w.close('ram:IncludedSupplyChainTradeLineItem');
  });

  // Vereinbarungen
  w.open('ram:ApplicableHeaderTradeAgreement');
  w.el('ram:BuyerReference', inv.buyerReference);
  party(w, 'ram:SellerTradeParty', inv.seller, { isSeller: true, omitTaxIds: onlyO });
  party(w, 'ram:BuyerTradeParty', inv.buyer, { isSeller: false, omitTaxIds: onlyO });
  if (has(inv.orderReference)) w.open('ram:BuyerOrderReferencedDocument').el('ram:IssuerAssignedID', inv.orderReference).close('ram:BuyerOrderReferencedDocument');
  if (has(inv.contractReference)) w.open('ram:ContractReferencedDocument').el('ram:IssuerAssignedID', inv.contractReference).close('ram:ContractReferencedDocument');
  if (has(inv.projectReference)) {
    w.open('ram:SpecifiedProcuringProject').el('ram:ID', inv.projectReference).el('ram:Name', 'Projekt').close('ram:SpecifiedProcuringProject');
  }
  w.close('ram:ApplicableHeaderTradeAgreement');

  // Lieferung
  w.open('ram:ApplicableHeaderTradeDelivery');
  const d = inv.delivery;
  if (['street', 'zip', 'city', 'country'].some((k) => has(d[k]))) {
    w.open('ram:ShipToTradeParty');
    w.el('ram:Name', d.name);
    w.open('ram:PostalTradeAddress');
    w.el('ram:PostcodeCode', d.zip);
    w.el('ram:LineOne', d.street);
    w.el('ram:CityName', d.city);
    w.el('ram:CountryID', d.country || 'DE');
    w.close('ram:PostalTradeAddress');
    w.close('ram:ShipToTradeParty');
  }
  if (has(inv.deliveryDate)) {
    w.open('ram:ActualDeliverySupplyChainEvent');
    w.date('ram:OccurrenceDateTime', inv.deliveryDate);
    w.close('ram:ActualDeliverySupplyChainEvent');
  }
  w.close('ram:ApplicableHeaderTradeDelivery');

  // Abrechnung
  w.open('ram:ApplicableHeaderTradeSettlement');
  if (p.code === '59') w.el('ram:CreditorReferenceID', p.creditorId);
  w.el('ram:PaymentReference', p.reference);
  w.el('ram:InvoiceCurrencyCode', cur);
  w.open('ram:SpecifiedTradeSettlementPaymentMeans');
  w.el('ram:TypeCode', p.code);
  if (['54', '55'].includes(p.code)) {
    w.open('ram:ApplicableTradeSettlementFinancialCard').el('ram:ID', p.cardNumber).el('ram:CardholderName', p.cardHolder).close('ram:ApplicableTradeSettlementFinancialCard');
  }
  if (p.code === '59' && has(p.debitedIban)) {
    w.open('ram:PayerPartyDebtorFinancialAccount').el('ram:IBANID', normalizeIban(p.debitedIban)).close('ram:PayerPartyDebtorFinancialAccount');
  }
  if (['58', '30'].includes(p.code)) {
    w.open('ram:PayeePartyCreditorFinancialAccount');
    if (p.code === '58') w.el('ram:IBANID', normalizeIban(p.iban));
    w.el('ram:AccountName', p.accountName);
    if (p.code === '30') w.el('ram:ProprietaryID', p.iban);
    w.close('ram:PayeePartyCreditorFinancialAccount');
    if (has(p.bic)) {
      w.open('ram:PayeeSpecifiedCreditorFinancialInstitution').el('ram:BICID', p.bic.replace(/\s+/g, '').toUpperCase()).close('ram:PayeeSpecifiedCreditorFinancialInstitution');
    }
  }
  w.close('ram:SpecifiedTradeSettlementPaymentMeans');

  for (const g of t.breakdown) {
    w.open('ram:ApplicableTradeTax');
    w.el('ram:CalculatedAmount', amt(g.tax));
    w.el('ram:TypeCode', 'VAT');
    w.el('ram:ExemptionReason', g.exemptionReason);
    w.el('ram:BasisAmount', amt(g.taxable));
    w.el('ram:CategoryCode', g.category);
    w.el('ram:ExemptionReasonCode', g.exemptionCode);
    w.el('ram:RateApplicablePercent', pct(g.rate));
    w.close('ram:ApplicableTradeTax');
  }

  if (has(inv.periodStart) || has(inv.periodEnd)) {
    w.open('ram:BillingSpecifiedPeriod');
    w.date('ram:StartDateTime', inv.periodStart);
    w.date('ram:EndDateTime', inv.periodEnd);
    w.close('ram:BillingSpecifiedPeriod');
  }

  for (const a of t.allowances) {
    w.open('ram:SpecifiedTradeAllowanceCharge');
    w.open('ram:ChargeIndicator').el('udt:Indicator', a.charge ? 'true' : 'false').close('ram:ChargeIndicator');
    if (a.hasPct) w.el('ram:CalculationPercent', String(num(a.percent)));
    if (a.hasPct) w.el('ram:BasisAmount', amt(a.base));
    w.el('ram:ActualAmount', amt(a.amount));
    w.el('ram:Reason', a.reason || (a.charge ? 'Zuschlag' : 'Rabatt'));
    w.open('ram:CategoryTradeTax');
    w.el('ram:TypeCode', 'VAT');
    w.el('ram:CategoryCode', a.vatCategory);
    if (a.vatCategory !== 'O') w.el('ram:RateApplicablePercent', pct(a.rate));
    w.close('ram:CategoryTradeTax');
    w.close('ram:SpecifiedTradeAllowanceCharge');
  }

  const terms = paymentTermsText(inv);
  if (has(terms) || has(inv.dueDate) || (p.code === '59' && has(p.mandateId))) {
    w.open('ram:SpecifiedTradePaymentTerms');
    w.el('ram:Description', terms);
    w.date('ram:DueDateDateTime', inv.dueDate);
    if (p.code === '59') w.el('ram:DirectDebitMandateID', p.mandateId);
    w.close('ram:SpecifiedTradePaymentTerms');
  }

  w.open('ram:SpecifiedTradeSettlementHeaderMonetarySummation');
  w.el('ram:LineTotalAmount', amt(t.lineTotal));
  if (t.allowances.some((a) => a.charge)) w.el('ram:ChargeTotalAmount', amt(t.chargeTotal));
  if (t.allowances.some((a) => !a.charge)) w.el('ram:AllowanceTotalAmount', amt(t.allowanceTotal));
  w.el('ram:TaxBasisTotalAmount', amt(t.taxExclusive));
  w.el('ram:TaxTotalAmount', amt(t.taxTotal), { currencyID: cur });
  w.el('ram:GrandTotalAmount', amt(t.taxInclusive));
  if (t.prepaid) w.el('ram:TotalPrepaidAmount', amt(t.prepaid));
  w.el('ram:DuePayableAmount', amt(t.payable));
  w.close('ram:SpecifiedTradeSettlementHeaderMonetarySummation');

  if (has(inv.precedingInvoiceNumber)) {
    w.open('ram:InvoiceReferencedDocument');
    w.el('ram:IssuerAssignedID', inv.precedingInvoiceNumber);
    w.date('ram:FormattedIssueDateTime', inv.precedingInvoiceDate, 'qdt');
    w.close('ram:InvoiceReferencedDocument');
  }
  w.close('ram:ApplicableHeaderTradeSettlement');
  w.close('rsm:SupplyChainTradeTransaction');
  w.close('rsm:CrossIndustryInvoice');
  return w.toString() + '\n';
}
