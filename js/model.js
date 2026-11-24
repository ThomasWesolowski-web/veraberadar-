// Datenmodell, Codelisten und Berechnungen nach EN 16931 / XRechnung 3.0

export const XRECHNUNG_VERSION = '3.0';
export const CUSTOMIZATION_ID =
  'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';
export const PROFILE_ID = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

// BT-3 – nach BR-DE-17 zulässige Rechnungsarten (UNTDID 1001)
export const INVOICE_TYPES = {
  '380': 'Rechnung',
  '326': 'Teilrechnung',
  '384': 'Korrigierte Rechnung (Stornorechnung)',
  '389': 'Gutschrift (Selbstfakturierung, § 14 Abs. 2 S. 2 UStG)',
  '381': 'Rechnungskorrektur / Gutschrift (Credit Note)',
  '875': 'Teilrechnung Bauleistung',
  '876': 'Teilschlussrechnung Bauleistung',
  '877': 'Schlussrechnung Bauleistung',
};

// BT-151 / BT-118 – Umsatzsteuerkategorien (UNTDID 5305)
export const VAT_CATEGORIES = {
  S: 'Regelsteuersatz / ermäßigter Steuersatz',
  Z: 'Nullsteuersatz (z. B. PV-Anlagen § 12 Abs. 3 UStG)',
  E: 'Steuerbefreit (z. B. § 4 UStG, Kleinunternehmer § 19 UStG)',
  AE: 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge, § 13b UStG)',
  K: 'Innergemeinschaftliche Lieferung/Leistung (steuerfrei)',
  G: 'Ausfuhrlieferung in Drittland (steuerfrei)',
  O: 'Nicht steuerbar (außerhalb des Anwendungsbereichs der USt)',
};

// Vorbelegte Befreiungsgründe (BT-120) und VATEX-Codes (BT-121)
export const DEFAULT_EXEMPTION = {
  E: { reason: 'Steuerfrei nach § 19 UStG (Kleinunternehmerregelung)', code: '' },
  AE: { reason: 'Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG)', code: 'VATEX-EU-AE' },
  K: { reason: 'Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1 Buchst. b, § 6a UStG)', code: 'VATEX-EU-IC' },
  G: { reason: 'Steuerfreie Ausfuhrlieferung (§ 4 Nr. 1 Buchst. a, § 6 UStG)', code: 'VATEX-EU-G' },
  O: { reason: 'Nicht im Inland steuerbare Leistung', code: 'VATEX-EU-O' },
};

// BT-81 – Zahlungsarten (UNTDID 4461)
export const PAYMENT_MEANS = {
  '58': 'SEPA-Überweisung',
  '30': 'Überweisung (nicht SEPA)',
  '59': 'SEPA-Lastschrift',
  '54': 'Kreditkarte',
  '55': 'Debitkarte',
  '10': 'Barzahlung',
  '1': 'Nicht definiert',
};

// BT-130 – Mengeneinheiten (UN/ECE Rec. 20 / Rec. 21)
export const UNITS = {
  C62: 'Stück',
  H87: 'Stück (Teil)',
  HUR: 'Stunde',
  MIN: 'Minute',
  DAY: 'Tag',
  WEE: 'Woche',
  MON: 'Monat',
  ANN: 'Jahr',
  LS: 'Pauschale',
  KGM: 'Kilogramm',
  TNE: 'Tonne',
  MTR: 'Meter',
  KMT: 'Kilometer',
  MTK: 'Quadratmeter',
  MTQ: 'Kubikmeter',
  LTR: 'Liter',
  KWH: 'Kilowattstunde',
  SET: 'Satz',
  XPK: 'Packung',
};

// BT-34 / BT-49 – Schemata für elektronische Adressen (EAS)
export const EAS_SCHEMES = {
  EM: 'E-Mail-Adresse',
  '0204': 'Leitweg-ID (öffentliche Auftraggeber)',
  '9930': 'USt-IdNr. (Deutschland)',
  '0088': 'GLN',
  '0060': 'DUNS',
};

export function emptyParty() {
  return {
    name: '', tradingName: '', street: '', additionalStreet: '', zip: '', city: '', country: 'DE',
    vatId: '', taxNumber: '', registrationId: '', legalInfo: '', id: '',
    endpoint: '', endpointScheme: 'EM',
    contactName: '', contactPhone: '', contactEmail: '',
  };
}

export function emptyLine() {
  return {
    name: '', description: '', articleNo: '', quantity: 1, unit: 'C62',
    price: 0, vatCategory: 'S', vatRate: 19,
  };
}

/** Rabatt (BG-20) bzw. Zuschlag (BG-21) auf Rechnungsebene */
export function emptyAllowance(charge = false) {
  return { charge, reason: charge ? 'Zuschlag' : 'Rabatt', percent: '', amount: 0, vatCategory: 'S', vatRate: 19 };
}

export function emptyInvoice() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    type: '380',
    number: '',
    issueDate: today,
    dueDate: '',
    currency: 'EUR',
    buyerReference: '',
    orderReference: '',
    contractReference: '',
    projectReference: '',
    precedingInvoiceNumber: '',
    precedingInvoiceDate: '',
    note: '',
    deliveryDate: '',
    periodStart: '',
    periodEnd: '',
    seller: emptyParty(),
    buyer: emptyParty(),
    delivery: { name: '', street: '', zip: '', city: '', country: '' },
    payment: {
      code: '58', iban: '', bic: '', accountName: '', reference: '',
      mandateId: '', creditorId: '', debitedIban: '', cardNumber: '', cardHolder: '',
      terms: '', skontoDays: '', skontoPercent: '', skontoBase: '',
    },
    prepaid: 0,
    exemptions: {},
    lines: [emptyLine()],
    allowances: [],
    attachment: null, // { filename, mimeCode, base64, description }
  };
}

// ---------------------------------------------------------------- Rechnen

/** Kaufmännisch auf 2 Nachkommastellen runden (symmetrisch, wie EN 16931). */
export function round2(x) {
  const n = Number(x) || 0;
  const s = n < 0 ? -1 : 1;
  return (s * Math.round((Math.abs(n) + Number.EPSILON) * 100)) / 100;
}

export function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function lineNet(line) {
  return round2(num(line.quantity) * num(line.price));
}

/** Ermittelt alle Summen (BG-22) und die USt-Aufschlüsselung (BG-23). */
export function computeTotals(inv) {
  const groups = new Map();
  let lineTotal = 0;
  for (const l of inv.lines) {
    const net = lineNet(l);
    lineTotal = round2(lineTotal + net);
    const rate = l.vatCategory === 'S' ? num(l.vatRate) : 0;
    const key = `${l.vatCategory}|${rate}`;
    if (!groups.has(key)) groups.set(key, { category: l.vatCategory, rate, taxable: 0, tax: 0 });
    const g = groups.get(key);
    g.taxable = round2(g.taxable + net);
  }
  // Rabatte/Zuschläge auf Rechnungsebene: Basis ist die Positionssumme der jeweiligen Steuergruppe
  let allowanceTotal = 0;
  let chargeTotal = 0;
  const allowances = (inv.allowances || []).map((a) => {
    const rate = a.vatCategory === 'S' ? num(a.vatRate) : 0;
    const key = `${a.vatCategory}|${rate}`;
    const base = groups.get(key)?.taxable ?? 0;
    const hasPct = String(a.percent ?? '').trim() !== '' && num(a.percent) !== 0;
    const amount = hasPct ? round2((base * num(a.percent)) / 100) : round2(num(a.amount));
    return { ...a, rate, key, base, hasPct, amount };
  });
  for (const a of allowances) {
    if (!groups.has(a.key)) groups.set(a.key, { category: a.vatCategory, rate: a.rate, taxable: 0, tax: 0 });
    const g = groups.get(a.key);
    g.taxable = round2(g.taxable + (a.charge ? a.amount : -a.amount));
    if (a.charge) chargeTotal = round2(chargeTotal + a.amount);
    else allowanceTotal = round2(allowanceTotal + a.amount);
  }
  let taxTotal = 0;
  const breakdown = [...groups.values()].map((g) => {
    g.tax = round2((g.taxable * g.rate) / 100);
    taxTotal = round2(taxTotal + g.tax);
    const ex = inv.exemptions?.[g.category] || DEFAULT_EXEMPTION[g.category];
    if (ex && g.category !== 'S' && g.category !== 'Z') {
      g.exemptionReason = ex.reason || '';
      g.exemptionCode = ex.code || '';
    }
    return g;
  });
  breakdown.sort((a, b) => (a.category + a.rate).localeCompare(b.category + b.rate));
  const taxExclusive = round2(lineTotal - allowanceTotal + chargeTotal);
  const taxInclusive = round2(taxExclusive + taxTotal);
  const prepaid = round2(num(inv.prepaid));
  const payable = round2(taxInclusive - prepaid);
  return {
    lineTotal, allowanceTotal, chargeTotal, allowances, taxExclusive, taxTotal, taxInclusive, prepaid, payable, breakdown,
  };
}

/** Baut BT-20 inkl. Skonto-Zeile im XRechnung-Format (BR-DE-18). */
export function paymentTermsText(inv) {
  const p = inv.payment;
  const parts = [];
  if (p.terms && p.terms.trim()) parts.push(p.terms.trim().replace(/\r/g, ''));
  if (String(p.skontoDays).trim() !== '' && String(p.skontoPercent).trim() !== '') {
    const days = parseInt(p.skontoDays, 10);
    const pct = num(p.skontoPercent).toFixed(2);
    const base = String(p.skontoBase ?? '').trim() !== '' ? `#BASISBETRAG=${round2(num(p.skontoBase)).toFixed(2)}` : '';
    parts.push(`#SKONTO#TAGE=${days}#PROZENT=${pct}${base}#`);
    return parts.join('\n') + '\n';
  }
  return parts.join('\n');
}

// ------------------------------------------------------- Prüfziffern & Co.

export function normalizeIban(iban) {
  return String(iban || '').replace(/\s+/g, '').toUpperCase();
}

function mod97(numeric) {
  let rem = 0;
  for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97;
  return rem;
}

function lettersToDigits(s) {
  return s.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
}

export function isValidIban(iban) {
  const s = normalizeIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  if (s.startsWith('DE') && s.length !== 22) return false;
  return mod97(lettersToDigits(s.slice(4) + s.slice(0, 4))) === 1;
}

/** Deutsche USt-IdNr. inkl. Prüfziffer (ISO 7064, MOD 11,10). */
export function isValidVatId(vatId) {
  const s = String(vatId || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9+*]{2,12}$/.test(s)) return false;
  if (!s.startsWith('DE')) return true; // andere Länder: nur Grundformat
  if (!/^DE\d{9}$/.test(s)) return false;
  const d = s.slice(2);
  let product = 10;
  for (let i = 0; i < 8; i++) {
    let sum = (Number(d[i]) + product) % 10;
    if (sum === 0) sum = 10;
    product = (2 * sum) % 11;
  }
  let check = 11 - product;
  if (check === 10) check = 0;
  return check === Number(d[8]);
}

/** Leitweg-ID: Grobadressierung-[Feinadressierung-]Prüfziffer (Mod 97-10). */
export function isValidLeitwegId(id) {
  const s = String(id || '').trim().toUpperCase();
  const m = /^(\d{2,12})(?:-([A-Z0-9]{1,30}))?-(\d{2})$/.exec(s);
  if (!m) return false;
  const body = lettersToDigits(m[1] + (m[2] || '')) + m[3];
  return mod97(body) === 1;
}

export function looksLikeLeitwegId(s) {
  return /^\d{2,12}(-[A-Za-z0-9]{1,30})?-\d{2}$/.test(String(s || '').trim());
}

export function isValidEmail(s) {
  return /^[^@\s]+@([^@.\s]+\.)+[^@.\s]+$/.test(String(s || '').trim());
}

export function isIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
