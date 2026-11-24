// Import bestehender E-Rechnungen: XRechnung/UBL sowie ZUGFeRD/Factur-X/XRechnung im CII-Format
import { emptyInvoice, emptyLine, emptyParty, emptyAllowance, UNITS } from './model.js';

// --- kleine, namespace-unabhängige DOM-Helfer ------------------------------
function kids(node, name) {
  if (!node) return [];
  const out = [];
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && (c.localName || c.nodeName.split(':').pop()) === name) out.push(c);
  }
  return out;
}
/** Pfad wie "AccountingSupplierParty/Party/PostalAddress/CityName" */
function find(node, path) {
  let cur = [node];
  for (const part of path.split('/')) {
    const next = [];
    for (const n of cur) next.push(...kids(n, part));
    cur = next;
    if (!cur.length) return null;
  }
  return cur[0];
}
function findAll(node, path) {
  const parts = path.split('/');
  let cur = [node];
  for (const part of parts) {
    const next = [];
    for (const n of cur) next.push(...kids(n, part));
    cur = next;
  }
  return cur;
}
const txt = (node, path) => {
  const n = path ? find(node, path) : node;
  return n ? (n.textContent || '').trim() : '';
};
const attr = (node, path, a) => {
  const n = find(node, path);
  return n ? n.getAttribute(a) || '' : '';
};

/** CII-Datum (Format 102: JJJJMMTT) → ISO */
function ciiDate(node, path) {
  const n = find(node, path);
  if (!n) return '';
  const s = (n.textContent || '').trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s;
}

export function detectXmlFormat(doc) {
  const root = doc.documentElement;
  const name = root.localName || root.nodeName.split(':').pop();
  if (name === 'Invoice' || name === 'CreditNote') return 'UBL';
  if (name === 'CrossIndustryInvoice') return 'CII';
  return null;
}

export function importXml(doc) {
  const fmt = detectXmlFormat(doc);
  if (fmt === 'UBL') return { format: 'UBL', invoice: importUbl(doc.documentElement) };
  if (fmt === 'CII') return { format: 'CII', invoice: importCii(doc.documentElement) };
  throw new Error('Unbekanntes XML-Format. Unterstützt werden UBL (XRechnung) und CII (ZUGFeRD/Factur-X/XRechnung).');
}

// ---------------------------------------------------------------- UBL
function ublParty(p) {
  const party = emptyParty();
  if (!p) return party;
  party.endpoint = txt(p, 'EndpointID');
  party.endpointScheme = attr(p, 'EndpointID', 'schemeID') || 'EM';
  for (const id of findAll(p, 'PartyIdentification/ID')) {
    if (id.getAttribute('schemeID') !== 'SEPA') party.id = party.id || id.textContent.trim();
  }
  party.tradingName = txt(p, 'PartyName/Name');
  party.street = txt(p, 'PostalAddress/StreetName');
  party.additionalStreet = txt(p, 'PostalAddress/AdditionalStreetName');
  party.city = txt(p, 'PostalAddress/CityName');
  party.zip = txt(p, 'PostalAddress/PostalZone');
  party.country = txt(p, 'PostalAddress/Country/IdentificationCode') || 'DE';
  for (const ts of findAll(p, 'PartyTaxScheme')) {
    const scheme = txt(ts, 'TaxScheme/ID');
    if (scheme === 'VAT') party.vatId = txt(ts, 'CompanyID');
    else party.taxNumber = txt(ts, 'CompanyID');
  }
  party.name = txt(p, 'PartyLegalEntity/RegistrationName') || party.tradingName;
  party.registrationId = txt(p, 'PartyLegalEntity/CompanyID');
  party.legalInfo = txt(p, 'PartyLegalEntity/CompanyLegalForm');
  party.contactName = txt(p, 'Contact/Name');
  party.contactPhone = txt(p, 'Contact/Telephone');
  party.contactEmail = txt(p, 'Contact/ElectronicMail');
  return party;
}

function splitTerms(inv, note) {
  const lines = String(note || '').split(/\r?\n/);
  const rest = [];
  for (const l of lines) {
    const m = /^#SKONTO#TAGE=(\d+)#PROZENT=(\d+\.\d{2})(?:#BASISBETRAG=(-?\d+\.\d{2}))?#/.exec(l.trim());
    if (m && inv.payment.skontoDays === '') {
      inv.payment.skontoDays = m[1];
      inv.payment.skontoPercent = m[2];
      inv.payment.skontoBase = m[3] || '';
    } else if (l.trim()) rest.push(l);
  }
  inv.payment.terms = rest.join('\n');
}

function importUbl(root) {
  const inv = emptyInvoice();
  const isCN = (root.localName || '').endsWith('CreditNote');
  inv.number = txt(root, 'ID');
  inv.issueDate = txt(root, 'IssueDate');
  inv.type = txt(root, isCN ? 'CreditNoteTypeCode' : 'InvoiceTypeCode') || (isCN ? '381' : '380');
  inv.dueDate = txt(root, 'DueDate') || txt(root, 'PaymentMeans/PaymentDueDate');
  inv.currency = txt(root, 'DocumentCurrencyCode') || 'EUR';
  inv.buyerReference = txt(root, 'BuyerReference');
  inv.note = kids(root, 'Note').map((n) => n.textContent.trim()).filter((n) => n && n !== 'Gutschrift').join('\n');
  inv.periodStart = txt(root, 'InvoicePeriod/StartDate');
  inv.periodEnd = txt(root, 'InvoicePeriod/EndDate');
  inv.orderReference = txt(root, 'OrderReference/ID');
  inv.contractReference = txt(root, 'ContractDocumentReference/ID');
  inv.projectReference = txt(root, 'ProjectReference/ID');
  inv.precedingInvoiceNumber = txt(root, 'BillingReference/InvoiceDocumentReference/ID');
  inv.precedingInvoiceDate = txt(root, 'BillingReference/InvoiceDocumentReference/IssueDate');

  inv.seller = ublParty(find(root, 'AccountingSupplierParty/Party'));
  inv.buyer = ublParty(find(root, 'AccountingCustomerParty/Party'));

  inv.deliveryDate = txt(root, 'Delivery/ActualDeliveryDate');
  const addr = find(root, 'Delivery/DeliveryLocation/Address');
  if (addr) {
    inv.delivery = {
      name: txt(root, 'Delivery/DeliveryParty/PartyName/Name'),
      street: txt(addr, 'StreetName'), zip: txt(addr, 'PostalZone'),
      city: txt(addr, 'CityName'), country: txt(addr, 'Country/IdentificationCode'),
    };
  }

  const pm = find(root, 'PaymentMeans');
  if (pm) {
    inv.payment.code = txt(pm, 'PaymentMeansCode') || '58';
    inv.payment.reference = txt(pm, 'PaymentID');
    inv.payment.iban = txt(pm, 'PayeeFinancialAccount/ID');
    inv.payment.accountName = txt(pm, 'PayeeFinancialAccount/Name');
    inv.payment.bic = txt(pm, 'PayeeFinancialAccount/FinancialInstitutionBranch/ID');
    inv.payment.mandateId = txt(pm, 'PaymentMandate/ID');
    inv.payment.debitedIban = txt(pm, 'PaymentMandate/PayerFinancialAccount/ID');
    inv.payment.cardNumber = txt(pm, 'CardAccount/PrimaryAccountNumberID');
    inv.payment.cardHolder = txt(pm, 'CardAccount/HolderName');
  }
  for (const id of findAll(root, 'AccountingSupplierParty/Party/PartyIdentification/ID')) {
    if (id.getAttribute('schemeID') === 'SEPA') inv.payment.creditorId = id.textContent.trim();
  }
  splitTerms(inv, txt(root, 'PaymentTerms/Note'));
  inv.prepaid = Number(txt(root, 'LegalMonetaryTotal/PrepaidAmount')) || 0;

  for (const sub of findAll(root, 'TaxTotal/TaxSubtotal')) {
    const cat = txt(sub, 'TaxCategory/ID');
    const reason = txt(sub, 'TaxCategory/TaxExemptionReason');
    const code = txt(sub, 'TaxCategory/TaxExemptionReasonCode');
    if (reason || code) inv.exemptions[cat] = { reason, code };
  }

  inv.allowances = kids(root, 'AllowanceCharge').map((ac) => {
    const a = emptyAllowance(txt(ac, 'ChargeIndicator') === 'true');
    a.reason = txt(ac, 'AllowanceChargeReason') || txt(ac, 'AllowanceChargeReasonCode') || a.reason;
    a.percent = txt(ac, 'MultiplierFactorNumeric');
    a.amount = Number(txt(ac, 'Amount')) || 0;
    a.vatCategory = txt(ac, 'TaxCategory/ID') || 'S';
    a.vatRate = Number(txt(ac, 'TaxCategory/Percent')) || 0;
    return a;
  });

  const lineNodes = findAll(root, isCN ? 'CreditNoteLine' : 'InvoiceLine');
  inv.lines = lineNodes.map((ln) => {
    const l = emptyLine();
    const q = find(ln, isCN ? 'CreditedQuantity' : 'InvoicedQuantity');
    l.quantity = q ? Number(q.textContent) : 1;
    l.unit = q?.getAttribute('unitCode') || 'C62';
    if (!UNITS[l.unit]) l.unit = 'C62';
    l.name = txt(ln, 'Item/Name');
    l.description = txt(ln, 'Item/Description');
    l.articleNo = txt(ln, 'Item/SellersItemIdentification/ID');
    l.vatCategory = txt(ln, 'Item/ClassifiedTaxCategory/ID') || 'S';
    l.vatRate = Number(txt(ln, 'Item/ClassifiedTaxCategory/Percent')) || 0;
    const price = Number(txt(ln, 'Price/PriceAmount')) || 0;
    const base = Number(txt(ln, 'Price/BaseQuantity')) || 1;
    l.price = price / base;
    // Falls Rabatte auf Positionsebene enthalten sind, Nettobetrag übernehmen
    const lineAmount = Number(txt(ln, 'LineExtensionAmount'));
    if (Number.isFinite(lineAmount) && l.quantity && Math.abs(l.quantity * l.price - lineAmount) > 0.005) {
      l.price = Math.round((lineAmount / l.quantity) * 10000) / 10000;
    }
    return l;
  });
  if (!inv.lines.length) inv.lines = [emptyLine()];

  const att = find(root, 'AdditionalDocumentReference/Attachment/EmbeddedDocumentBinaryObject');
  if (att) {
    inv.attachment = {
      filename: att.getAttribute('filename') || 'anlage.pdf',
      mimeCode: att.getAttribute('mimeCode') || 'application/pdf',
      base64: (att.textContent || '').replace(/\s+/g, ''),
      description: txt(root, 'AdditionalDocumentReference/DocumentDescription'),
    };
  }
  return inv;
}

// ---------------------------------------------------------------- CII
function ciiParty(p) {
  const party = emptyParty();
  if (!p) return party;
  party.id = txt(p, 'ID') || txt(p, 'GlobalID');
  party.name = txt(p, 'Name');
  party.tradingName = txt(p, 'SpecifiedLegalOrganization/TradingBusinessName');
  party.registrationId = txt(p, 'SpecifiedLegalOrganization/ID');
  party.legalInfo = txt(p, 'Description');
  party.contactName = txt(p, 'DefinedTradeContact/PersonName') || txt(p, 'DefinedTradeContact/DepartmentName');
  party.contactPhone = txt(p, 'DefinedTradeContact/TelephoneUniversalCommunication/CompleteNumber');
  party.contactEmail = txt(p, 'DefinedTradeContact/EmailURIUniversalCommunication/URIID');
  party.zip = txt(p, 'PostalTradeAddress/PostcodeCode');
  party.street = txt(p, 'PostalTradeAddress/LineOne');
  party.additionalStreet = txt(p, 'PostalTradeAddress/LineTwo');
  party.city = txt(p, 'PostalTradeAddress/CityName');
  party.country = txt(p, 'PostalTradeAddress/CountryID') || 'DE';
  party.endpoint = txt(p, 'URIUniversalCommunication/URIID');
  party.endpointScheme = attr(p, 'URIUniversalCommunication/URIID', 'schemeID') || 'EM';
  for (const reg of findAll(p, 'SpecifiedTaxRegistration/ID')) {
    const scheme = reg.getAttribute('schemeID');
    if (scheme === 'VA') party.vatId = reg.textContent.trim();
    else if (scheme === 'FC') party.taxNumber = reg.textContent.trim();
  }
  return party;
}

function importCii(root) {
  const inv = emptyInvoice();
  const doc = find(root, 'ExchangedDocument');
  const tx = find(root, 'SupplyChainTradeTransaction');
  const agr = find(tx, 'ApplicableHeaderTradeAgreement');
  const del = find(tx, 'ApplicableHeaderTradeDelivery');
  const set = find(tx, 'ApplicableHeaderTradeSettlement');

  inv.number = txt(doc, 'ID');
  inv.type = txt(doc, 'TypeCode') || '380';
  inv.issueDate = ciiDate(doc, 'IssueDateTime/DateTimeString');
  inv.note = findAll(doc, 'IncludedNote/Content').map((n) => n.textContent.trim()).filter(Boolean).join('\n');

  inv.buyerReference = txt(agr, 'BuyerReference');
  inv.seller = ciiParty(find(agr, 'SellerTradeParty'));
  inv.buyer = ciiParty(find(agr, 'BuyerTradeParty'));
  inv.orderReference = txt(agr, 'BuyerOrderReferencedDocument/IssuerAssignedID');
  inv.contractReference = txt(agr, 'ContractReferencedDocument/IssuerAssignedID');
  inv.projectReference = txt(agr, 'SpecifiedProcuringProject/ID');

  inv.deliveryDate = ciiDate(del, 'ActualDeliverySupplyChainEvent/OccurrenceDateTime/DateTimeString');
  const shipTo = find(del, 'ShipToTradeParty');
  if (shipTo) {
    inv.delivery = {
      name: txt(shipTo, 'Name'),
      street: txt(shipTo, 'PostalTradeAddress/LineOne'),
      zip: txt(shipTo, 'PostalTradeAddress/PostcodeCode'),
      city: txt(shipTo, 'PostalTradeAddress/CityName'),
      country: txt(shipTo, 'PostalTradeAddress/CountryID'),
    };
  }

  inv.currency = txt(set, 'InvoiceCurrencyCode') || 'EUR';
  inv.payment.reference = txt(set, 'PaymentReference');
  inv.payment.creditorId = txt(set, 'CreditorReferenceID');
  const pm = find(set, 'SpecifiedTradeSettlementPaymentMeans');
  if (pm) {
    inv.payment.code = txt(pm, 'TypeCode') || '58';
    inv.payment.iban = txt(pm, 'PayeePartyCreditorFinancialAccount/IBANID') || txt(pm, 'PayeePartyCreditorFinancialAccount/ProprietaryID');
    inv.payment.accountName = txt(pm, 'PayeePartyCreditorFinancialAccount/AccountName');
    inv.payment.bic = txt(pm, 'PayeeSpecifiedCreditorFinancialInstitution/BICID');
    inv.payment.debitedIban = txt(pm, 'PayerPartyDebtorFinancialAccount/IBANID');
    inv.payment.cardNumber = txt(pm, 'ApplicableTradeSettlementFinancialCard/ID');
    inv.payment.cardHolder = txt(pm, 'ApplicableTradeSettlementFinancialCard/CardholderName');
  }
  const terms = find(set, 'SpecifiedTradePaymentTerms');
  if (terms) {
    splitTerms(inv, txt(terms, 'Description'));
    inv.dueDate = ciiDate(terms, 'DueDateDateTime/DateTimeString');
    inv.payment.mandateId = txt(terms, 'DirectDebitMandateID');
  }
  inv.periodStart = ciiDate(set, 'BillingSpecifiedPeriod/StartDateTime/DateTimeString');
  inv.periodEnd = ciiDate(set, 'BillingSpecifiedPeriod/EndDateTime/DateTimeString');
  inv.precedingInvoiceNumber = txt(set, 'InvoiceReferencedDocument/IssuerAssignedID');
  inv.precedingInvoiceDate = ciiDate(set, 'InvoiceReferencedDocument/FormattedIssueDateTime/DateTimeString');
  inv.prepaid = Number(txt(set, 'SpecifiedTradeSettlementHeaderMonetarySummation/TotalPrepaidAmount')) || 0;
  for (const tax of findAll(set, 'ApplicableTradeTax')) {
    const cat = txt(tax, 'CategoryCode');
    const reason = txt(tax, 'ExemptionReason');
    const code = txt(tax, 'ExemptionReasonCode');
    if (reason || code) inv.exemptions[cat] = { reason, code };
  }

  inv.allowances = kids(set, 'SpecifiedTradeAllowanceCharge').map((ac) => {
    const a = emptyAllowance(txt(ac, 'ChargeIndicator/Indicator') === 'true');
    a.reason = txt(ac, 'Reason') || txt(ac, 'ReasonCode') || a.reason;
    a.percent = txt(ac, 'CalculationPercent');
    a.amount = Number(txt(ac, 'ActualAmount')) || 0;
    a.vatCategory = txt(ac, 'CategoryTradeTax/CategoryCode') || 'S';
    a.vatRate = Number(txt(ac, 'CategoryTradeTax/RateApplicablePercent')) || 0;
    return a;
  });

  inv.lines = findAll(tx, 'IncludedSupplyChainTradeLineItem').map((li) => {
    const l = emptyLine();
    l.name = txt(li, 'SpecifiedTradeProduct/Name');
    l.description = txt(li, 'SpecifiedTradeProduct/Description');
    l.articleNo = txt(li, 'SpecifiedTradeProduct/SellerAssignedID');
    const q = find(li, 'SpecifiedLineTradeDelivery/BilledQuantity');
    l.quantity = q ? Number(q.textContent) : 1;
    l.unit = q?.getAttribute('unitCode') || 'C62';
    if (!UNITS[l.unit]) l.unit = 'C62';
    const price = Number(txt(li, 'SpecifiedLineTradeAgreement/NetPriceProductTradePrice/ChargeAmount')) || 0;
    const base = Number(txt(li, 'SpecifiedLineTradeAgreement/NetPriceProductTradePrice/BasisQuantity')) || 1;
    l.price = price / base;
    l.vatCategory = txt(li, 'SpecifiedLineTradeSettlement/ApplicableTradeTax/CategoryCode') || 'S';
    l.vatRate = Number(txt(li, 'SpecifiedLineTradeSettlement/ApplicableTradeTax/RateApplicablePercent')) || 0;
    const lineAmount = Number(txt(li, 'SpecifiedLineTradeSettlement/SpecifiedTradeSettlementLineMonetarySummation/LineTotalAmount'));
    if (Number.isFinite(lineAmount) && l.quantity && Math.abs(l.quantity * l.price - lineAmount) > 0.005) {
      l.price = Math.round((lineAmount / l.quantity) * 10000) / 10000;
    }
    return l;
  });
  if (!inv.lines.length) inv.lines = [emptyLine()];
  return inv;
}
