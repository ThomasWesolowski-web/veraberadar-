// Prüfregeln: § 14 UStG (Pflichtangaben), EN 16931 (Kernregeln) und XRechnung 3.0 (BR-DE)
import {
  INVOICE_TYPES, VAT_CATEGORIES, PAYMENT_MEANS, UNITS, EAS_SCHEMES,
  computeTotals, num, isValidIban, isValidVatId, isValidEmail, isIsoDate,
  isValidLeitwegId, looksLikeLeitwegId, paymentTermsText,
} from './model.js';

const blank = (v) => v === undefined || v === null || String(v).trim() === '';

/**
 * Liefert eine Liste von Befunden:
 *  { level: 'error' | 'warning' | 'info', rule, source, field, message }
 * source: 'UStG' | 'EN16931' | 'XRechnung' | 'Hinweis'
 */
export function validateInvoice(inv) {
  const out = [];
  const add = (level, rule, source, field, message) =>
    out.push({ level, rule, source, field, message });
  const err = (rule, src, field, msg) => add('error', rule, src, field, msg);
  const warn = (rule, src, field, msg) => add('warning', rule, src, field, msg);
  const info = (rule, src, field, msg) => add('info', rule, src, field, msg);

  const s = inv.seller;
  const b = inv.buyer;
  const p = inv.payment;
  const totals = computeTotals(inv);
  const categories = new Set(inv.lines.map((l) => l.vatCategory));

  // ---------------------------------------------------------------- Kopf
  if (blank(inv.number))
    err('BR-02', 'UStG', 'number', 'Rechnungsnummer fehlt (§ 14 Abs. 4 Nr. 4 UStG: fortlaufende, einmalige Nummer).');
  if (blank(inv.issueDate))
    err('BR-03', 'UStG', 'issueDate', 'Rechnungsdatum fehlt (§ 14 Abs. 4 Nr. 3 UStG).');
  else if (!isIsoDate(inv.issueDate))
    err('BR-03', 'EN16931', 'issueDate', 'Rechnungsdatum ist kein gültiges Datum.');
  if (!INVOICE_TYPES[inv.type])
    err('BR-DE-17', 'XRechnung', 'type', 'Unzulässige Rechnungsart (zulässig: 326, 380, 381, 384, 389, 875, 876, 877).');
  if (blank(inv.currency) || !/^[A-Z]{3}$/.test(inv.currency))
    err('BR-05', 'EN16931', 'currency', 'Währungscode (ISO 4217, z. B. EUR) fehlt oder ist ungültig.');
  if (blank(inv.buyerReference)) {
    err('BR-DE-15', 'XRechnung', 'buyerReference',
      'Käuferreferenz (BT-10) ist Pflicht. Bei öffentlichen Auftraggebern die Leitweg-ID, sonst z. B. Bestellnummer/Kostenstelle oder „n/a".');
  } else if (looksLikeLeitwegId(inv.buyerReference) && !isValidLeitwegId(inv.buyerReference)) {
    warn('LEITWEG', 'XRechnung', 'buyerReference', 'Die Käuferreferenz sieht aus wie eine Leitweg-ID, die Prüfziffer stimmt aber nicht.');
  }
  if (inv.type === '384' && blank(inv.precedingInvoiceNumber))
    warn('BR-DE-26', 'XRechnung', 'precedingInvoiceNumber', 'Bei einer korrigierten Rechnung (384) soll die Nummer der ursprünglichen Rechnung angegeben werden.');
  if (inv.type === '381' && blank(inv.precedingInvoiceNumber))
    warn('§31 UStDV', 'UStG', 'precedingInvoiceNumber', 'Eine Rechnungskorrektur muss sich eindeutig auf die ursprüngliche Rechnung beziehen (§ 31 Abs. 5 UStDV).');
  if (!blank(inv.precedingInvoiceDate) && !isIsoDate(inv.precedingInvoiceDate))
    err('DATE', 'EN16931', 'precedingInvoiceDate', 'Datum der Vorrechnung ist ungültig.');

  // Leistungszeitpunkt – § 14 Abs. 4 Nr. 6 UStG
  const hasPeriod = !blank(inv.periodStart) || !blank(inv.periodEnd);
  if (blank(inv.deliveryDate) && !hasPeriod)
    err('§14-4-6', 'UStG', 'deliveryDate',
      'Liefer-/Leistungsdatum oder Leistungszeitraum fehlt (§ 14 Abs. 4 Nr. 6 UStG, BR-DE-TMP-32).');
  if (!blank(inv.deliveryDate) && !isIsoDate(inv.deliveryDate))
    err('DATE', 'EN16931', 'deliveryDate', 'Lieferdatum ist ungültig.');
  if (hasPeriod) {
    if (!blank(inv.periodStart) && !isIsoDate(inv.periodStart)) err('DATE', 'EN16931', 'periodStart', 'Beginn des Leistungszeitraums ist ungültig.');
    if (!blank(inv.periodEnd) && !isIsoDate(inv.periodEnd)) err('DATE', 'EN16931', 'periodEnd', 'Ende des Leistungszeitraums ist ungültig.');
    if (blank(inv.periodStart) || blank(inv.periodEnd))
      warn('§14-4-6', 'UStG', 'periodStart', 'Leistungszeitraum sollte mit Beginn und Ende angegeben werden.');
    else if (inv.periodEnd < inv.periodStart)
      err('BR-29', 'EN16931', 'periodEnd', 'Ende des Leistungszeitraums liegt vor dem Beginn.');
  }
  if (!blank(inv.dueDate)) {
    if (!isIsoDate(inv.dueDate)) err('DATE', 'EN16931', 'dueDate', 'Fälligkeitsdatum ist ungültig.');
    else if (inv.issueDate && inv.dueDate < inv.issueDate)
      warn('DUE', 'Hinweis', 'dueDate', 'Fälligkeitsdatum liegt vor dem Rechnungsdatum.');
  }
  if (totals.payable > 0 && blank(inv.dueDate) && blank(paymentTermsText(inv)))
    err('BR-CO-25', 'EN16931', 'dueDate', 'Bei positivem Zahlbetrag muss ein Fälligkeitsdatum oder eine Zahlungsbedingung angegeben werden.');

  // ---------------------------------------------------------------- Verkäufer
  if (blank(s.name)) err('BR-06', 'UStG', 'seller.name', 'Name des leistenden Unternehmers fehlt (§ 14 Abs. 4 Nr. 1 UStG).');
  if (blank(s.street)) err('§14-4-1', 'UStG', 'seller.street', 'Anschrift (Straße) des Verkäufers fehlt (§ 14 Abs. 4 Nr. 1 UStG).');
  if (blank(s.city)) err('BR-DE-3', 'XRechnung', 'seller.city', 'Ort des Verkäufers fehlt.');
  if (blank(s.zip)) err('BR-DE-4', 'XRechnung', 'seller.zip', 'PLZ des Verkäufers fehlt.');
  if (blank(s.country) || !/^[A-Z]{2}$/.test(s.country)) err('BR-09', 'EN16931', 'seller.country', 'Ländercode des Verkäufers (ISO 3166, z. B. DE) fehlt.');
  if (blank(s.vatId) && blank(s.taxNumber)) {
    if (!categories.has('O') || categories.size > 1)
      err('BR-DE-16', 'UStG', 'seller.vatId', 'Steuernummer oder USt-IdNr. des Verkäufers ist Pflicht (§ 14 Abs. 4 Nr. 2 UStG).');
  }
  if (!blank(s.vatId) && !isValidVatId(s.vatId))
    err('VATID', 'UStG', 'seller.vatId', 'USt-IdNr. des Verkäufers ist ungültig (Format oder Prüfziffer).');
  if (!blank(s.taxNumber) && !/^[0-9/ ]{10,16}$/.test(s.taxNumber.trim()))
    warn('STNR', 'UStG', 'seller.taxNumber', 'Steuernummer hat ein ungewöhnliches Format (erwartet z. B. 12/345/67890).');
  if (blank(s.endpoint))
    err('BT-34', 'XRechnung', 'seller.endpoint', 'Elektronische Adresse des Verkäufers (BT-34, meist E-Mail) ist in XRechnung 3.0 Pflicht.');
  else if (s.endpointScheme === 'EM' && !isValidEmail(s.endpoint))
    err('BT-34', 'XRechnung', 'seller.endpoint', 'Elektronische Adresse des Verkäufers ist keine gültige E-Mail-Adresse.');
  if (!EAS_SCHEMES[s.endpointScheme]) err('BR-CL-25', 'EN16931', 'seller.endpointScheme', 'Unbekanntes Adressschema.');
  if (blank(s.contactName)) err('BR-DE-5', 'XRechnung', 'seller.contactName', 'Ansprechpartner des Verkäufers fehlt.');
  if (blank(s.contactPhone)) err('BR-DE-6', 'XRechnung', 'seller.contactPhone', 'Telefonnummer des Ansprechpartners fehlt.');
  else if (!/([0-9].*){3,}/.test(s.contactPhone)) warn('BR-DE-27', 'XRechnung', 'seller.contactPhone', 'Telefonnummer soll mindestens drei Ziffern enthalten.');
  if (blank(s.contactEmail)) err('BR-DE-7', 'XRechnung', 'seller.contactEmail', 'E-Mail des Ansprechpartners fehlt.');
  else if (!isValidEmail(s.contactEmail)) warn('BR-DE-28', 'XRechnung', 'seller.contactEmail', 'E-Mail des Ansprechpartners ist ungültig.');

  // ---------------------------------------------------------------- Käufer
  if (blank(b.name)) err('BR-07', 'UStG', 'buyer.name', 'Name des Leistungsempfängers fehlt (§ 14 Abs. 4 Nr. 1 UStG).');
  if (blank(b.street)) err('§14-4-1', 'UStG', 'buyer.street', 'Anschrift (Straße) des Käufers fehlt (§ 14 Abs. 4 Nr. 1 UStG).');
  if (blank(b.city)) err('BR-DE-8', 'XRechnung', 'buyer.city', 'Ort des Käufers fehlt.');
  if (blank(b.zip)) err('BR-DE-9', 'XRechnung', 'buyer.zip', 'PLZ des Käufers fehlt.');
  if (blank(b.country) || !/^[A-Z]{2}$/.test(b.country)) err('BR-11', 'EN16931', 'buyer.country', 'Ländercode des Käufers fehlt.');
  if (!blank(b.vatId) && !isValidVatId(b.vatId))
    err('VATID', 'UStG', 'buyer.vatId', 'USt-IdNr. des Käufers ist ungültig (Format oder Prüfziffer).');
  if (blank(b.endpoint))
    err('BT-49', 'XRechnung', 'buyer.endpoint', 'Elektronische Adresse des Käufers (BT-49) ist in XRechnung 3.0 Pflicht (E-Mail oder Leitweg-ID).');
  else if (b.endpointScheme === 'EM' && !isValidEmail(b.endpoint))
    err('BT-49', 'XRechnung', 'buyer.endpoint', 'Elektronische Adresse des Käufers ist keine gültige E-Mail-Adresse.');
  else if (b.endpointScheme === '0204' && !isValidLeitwegId(b.endpoint))
    warn('LEITWEG', 'XRechnung', 'buyer.endpoint', 'Leitweg-ID des Käufers hat eine ungültige Prüfziffer.');

  // Lieferanschrift (optional)
  const d = inv.delivery;
  const hasDeliveryAddr = ['street', 'zip', 'city', 'country'].some((k) => !blank(d[k]));
  if (hasDeliveryAddr) {
    if (blank(d.city)) err('BR-DE-10', 'XRechnung', 'delivery.city', 'Ort der Lieferanschrift fehlt.');
    if (blank(d.zip)) err('BR-DE-11', 'XRechnung', 'delivery.zip', 'PLZ der Lieferanschrift fehlt.');
    if (blank(d.country)) err('BR-57', 'EN16931', 'delivery.country', 'Land der Lieferanschrift fehlt.');
  }

  // ---------------------------------------------------------------- Positionen
  if (!inv.lines.length) err('BR-16', 'EN16931', 'lines', 'Mindestens eine Rechnungsposition ist erforderlich.');
  inv.lines.forEach((l, i) => {
    const f = (k) => `lines.${i}.${k}`;
    const n = i + 1;
    if (blank(l.name)) err('BR-25', 'UStG', f('name'), `Position ${n}: Bezeichnung der Leistung fehlt (§ 14 Abs. 4 Nr. 5 UStG).`);
    if (blank(l.quantity) || num(l.quantity) === 0) err('BR-22', 'UStG', f('quantity'), `Position ${n}: Menge fehlt (§ 14 Abs. 4 Nr. 5 UStG).`);
    if (!UNITS[l.unit]) err('BR-23', 'EN16931', f('unit'), `Position ${n}: Mengeneinheit fehlt oder ist ungültig.`);
    if (num(l.price) < 0) err('BR-27', 'EN16931', f('price'), `Position ${n}: Einzelpreis darf nicht negativ sein – negative Menge verwenden.`);
    if (!VAT_CATEGORIES[l.vatCategory]) err('BR-CL-17', 'EN16931', f('vatCategory'), `Position ${n}: Unbekannte Steuerkategorie.`);
    if (l.vatCategory === 'S' && !(num(l.vatRate) > 0))
      err('BR-S-05', 'EN16931', f('vatRate'), `Position ${n}: Bei Kategorie S muss ein Steuersatz > 0 angegeben werden.`);
    if (l.vatCategory === 'S' && ![19, 7].includes(num(l.vatRate)) && (s.country || 'DE') === 'DE')
      warn('§12', 'UStG', f('vatRate'), `Position ${n}: Steuersatz ${l.vatRate} % ist in Deutschland unüblich (19 % / 7 %).`);
  });

  // Rabatte / Zuschläge auf Rechnungsebene
  totals.allowances.forEach((a, i) => {
    const what = a.charge ? 'Zuschlag' : 'Rabatt';
    const f = (k) => `allowances.${i}.${k}`;
    if (blank(a.reason)) err(a.charge ? 'BR-38' : 'BR-33', 'EN16931', f('reason'), `${what} ${i + 1}: Grund fehlt.`);
    if (!(a.amount > 0)) err(a.charge ? 'BR-36' : 'BR-31', 'EN16931', f('amount'), `${what} ${i + 1}: Betrag oder Prozentsatz muss größer als 0 sein.`);
    if (!VAT_CATEGORIES[a.vatCategory]) err('BR-CL-17', 'EN16931', f('vatCategory'), `${what} ${i + 1}: Unbekannte Steuerkategorie.`);
    if (a.vatCategory === 'S' && !(a.rate > 0)) err('BR-S-06', 'EN16931', f('vatRate'), `${what} ${i + 1}: Steuersatz fehlt.`);
    if (a.hasPct && a.base === 0)
      warn('BASE', 'Hinweis', f('percent'), `${what} ${i + 1}: Keine Positionen mit Steuerkategorie ${a.vatCategory} ${a.rate} % – Prozentsatz wirkt auf 0 €.`);
    categories.add(a.vatCategory);
  });
  if (totals.taxExclusive < 0)
    warn('NEG', 'Hinweis', 'allowances', 'Der Nettobetrag ist negativ – Rabatte prüfen.');

  // ---------------------------------------------------------------- Steuer
  if (categories.has('O') && categories.size > 1)
    err('BR-O-11', 'EN16931', 'lines', 'Kategorie O (nicht steuerbar) darf nicht mit anderen Steuerkategorien kombiniert werden.');
  if (categories.has('O') && (!blank(s.vatId) || !blank(s.taxNumber) || !blank(b.vatId)))
    err('BR-O-02', 'EN16931', 'seller.vatId', 'Bei Kategorie O (nicht steuerbar) dürfen weder USt-IdNr./Steuernummer des Verkäufers noch USt-IdNr. des Käufers übermittelt werden.');
  if ((categories.has('AE')) && blank(b.vatId))
    err('BR-AE-02', 'UStG', 'buyer.vatId', 'Bei Reverse Charge ist die USt-IdNr. des Leistungsempfängers Pflicht (§ 14a Abs. 1 UStG).');
  if (categories.has('K')) {
    if (blank(s.vatId)) err('BR-IC-02', 'UStG', 'seller.vatId', 'Bei innergemeinschaftlicher Lieferung ist die USt-IdNr. des Verkäufers Pflicht (§ 14a Abs. 3 UStG).');
    if (blank(b.vatId)) err('BR-IC-02', 'UStG', 'buyer.vatId', 'Bei innergemeinschaftlicher Lieferung ist die USt-IdNr. des Käufers Pflicht (§ 14a Abs. 3 UStG).');
    if (blank(inv.deliveryDate) && !hasPeriod) err('BR-IC-11', 'EN16931', 'deliveryDate', 'Bei innergemeinschaftlicher Lieferung ist ein Liefer- oder Leistungsdatum Pflicht.');
    if (blank(d.country)) err('BR-IC-12', 'EN16931', 'delivery.country', 'Bei innergemeinschaftlicher Lieferung ist das Lieferland (Lieferanschrift) Pflicht.');
  }
  if (categories.has('G') && blank(s.vatId))
    err('BR-G-02', 'EN16931', 'seller.vatId', 'Bei Ausfuhrlieferungen ist die USt-IdNr. des Verkäufers erforderlich.');
  for (const g of totals.breakdown) {
    if (['E', 'AE', 'K', 'G', 'O'].includes(g.category) && blank(g.exemptionReason) && blank(g.exemptionCode))
      err(`BR-${g.category}-10`, 'UStG', `exemptions.${g.category}`,
        `Für Kategorie ${g.category} ist ein Hinweis auf den Befreiungsgrund Pflicht (§ 14 Abs. 4 Nr. 8 UStG).`);
  }
  if (categories.has('AE'))
    info('§14a-5', 'UStG', 'exemptions.AE', 'Pflichthinweis „Steuerschuldnerschaft des Leistungsempfängers" wird über den Befreiungsgrund übermittelt.');

  // ---------------------------------------------------------------- Zahlung
  if (!PAYMENT_MEANS[p.code]) err('BR-DE-1', 'XRechnung', 'payment.code', 'Zahlungsart (BG-16) fehlt.');
  if (['58', '30'].includes(p.code)) {
    if (blank(p.iban)) err('BR-DE-23-a', 'XRechnung', 'payment.iban', 'Bei Überweisung ist die IBAN/Kontonummer Pflicht.');
    else if (p.code === '58' && !isValidIban(p.iban)) err('BR-DE-19', 'XRechnung', 'payment.iban', 'IBAN ist ungültig (Prüfziffer/Länge).');
  }
  if (p.code === '59') {
    if (blank(p.mandateId)) err('BR-DE-25-a', 'XRechnung', 'payment.mandateId', 'Bei Lastschrift ist die Mandatsreferenz Pflicht.');
    if (blank(p.creditorId)) err('BR-DE-30', 'XRechnung', 'payment.creditorId', 'Bei Lastschrift ist die Gläubiger-ID Pflicht.');
    if (blank(p.debitedIban)) err('BR-DE-31', 'XRechnung', 'payment.debitedIban', 'Bei Lastschrift ist die IBAN des Zahlers Pflicht.');
    else if (!isValidIban(p.debitedIban)) err('BR-DE-20', 'XRechnung', 'payment.debitedIban', 'IBAN des Zahlers ist ungültig.');
  }
  if (['54', '55'].includes(p.code) && blank(p.cardNumber))
    err('BR-DE-24-a', 'XRechnung', 'payment.cardNumber', 'Bei Kartenzahlung sind die letzten Ziffern der Kartennummer Pflicht.');
  if (p.cardNumber && !/^\d{4,6}$/.test(p.cardNumber.trim()) && ['54', '55'].includes(p.code))
    err('BR-51', 'EN16931', 'payment.cardNumber', 'Nur die letzten 4–6 Ziffern der Karte angeben (keine vollständige Kartennummer).');
  const hasSkontoDays = !blank(p.skontoDays);
  const hasSkontoPct = !blank(p.skontoPercent);
  if (hasSkontoDays !== hasSkontoPct)
    err('BR-DE-18', 'XRechnung', 'payment.skontoDays', 'Für Skonto müssen Tage und Prozentsatz angegeben werden.');
  if (hasSkontoDays && !/^\d+$/.test(String(p.skontoDays).trim()))
    err('BR-DE-18', 'XRechnung', 'payment.skontoDays', 'Skonto-Tage müssen eine ganze Zahl sein.');
  if (!blank(p.skontoBase) && !(num(p.skontoBase) > 0))
    err('BR-DE-18', 'XRechnung', 'payment.skontoBase', 'Skonto-Basisbetrag muss größer als 0 sein.');
  if (hasSkontoPct && blank(p.skontoBase) && totals.prepaid > 0)
    warn('SKONTO', 'Hinweis', 'payment.skontoBase',
      'Bei Vorauszahlungen/Abschlägen sollte der Skonto-Basisbetrag angegeben werden – sonst rechnet der Empfänger Skonto auf den gesamten Zahlbetrag.');
  if (/^#/m.test(p.terms || ''))
    warn('BR-DE-18', 'XRechnung', 'payment.terms', 'Zeilen in den Zahlungsbedingungen dürfen nicht mit # beginnen (reserviert für Skonto).');

  // ---------------------------------------------------------------- Summen
  if (num(inv.prepaid) < 0) err('PREPAID', 'EN16931', 'prepaid', 'Vorauszahlung darf nicht negativ sein.');
  if (inv.type === '381' && totals.payable < 0)
    warn('CN', 'Hinweis', 'lines', 'Bei einer Gutschrift (381) werden Beträge positiv angegeben – die Art des Dokuments kehrt das Vorzeichen um.');

  // ---------------------------------------------------------------- Hinweise
  if (totals.taxInclusive > 0 && totals.taxInclusive <= 250)
    info('§33 UStDV', 'Hinweis', 'lines',
      'Kleinbetragsrechnung (≤ 250 € brutto): Eine E-Rechnung ist hier nicht verpflichtend, aber zulässig (§ 33 UStDV).');
  if (totals.breakdown.some((g) => g.category === 'E' && /§\s*19/.test(g.exemptionReason || '')))
    info('§34a UStDV', 'Hinweis', 'exemptions.E',
      'Kleinunternehmer (§ 19 UStG) sind von der Pflicht zur Ausstellung von E-Rechnungen befreit, dürfen sie aber ausstellen.');
  if (inv.type === '389')
    info('§14-4-10', 'UStG', 'type', 'Bei Selbstfakturierung muss die Angabe „Gutschrift" enthalten sein – wird über den Rechnungstyp 389 und die Bemerkung übermittelt.');

  return out;
}

export function summarize(findings) {
  return {
    errors: findings.filter((f) => f.level === 'error').length,
    warnings: findings.filter((f) => f.level === 'warning').length,
    infos: findings.filter((f) => f.level === 'info').length,
  };
}
