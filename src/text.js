// Hilfsfunktionen für Text und Datum.

/** Kleinschreibung und Umlaute vereinheitlichen (ä → ae, ß → ss), damit beide Schreibweisen treffen. */
export function normalizeDe(text) {
  return String(text ?? '')
    .replace(/Ä/g, 'Ae').replace(/ä/g, 'ae')
    .replace(/Ö/g, 'Oe').replace(/ö/g, 'oe')
    .replace(/Ü/g, 'Ue').replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** HTML-Tags entfernen und Entities auflösen (für RSS-Beschreibungen). */
export function stripHtml(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Datum nach ISO (YYYY-MM-DD). Akzeptiert ISO, DD.MM.YYYY und RFC-822 (RSS). */
export function toIsoDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

export function todayIso(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function daysUntil(isoDate) {
  if (!isoDate) return null;
  const target = new Date(`${isoDate}T23:59:59`);
  return Math.floor((target - new Date()) / 86400000);
}

/** CPV-Code auf 8 Ziffern kürzen ("45410000-4" → "45410000"). */
export function cpvDigits(code) {
  const digits = String(code ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(0, 8) : null;
}

/** HTTP-Abruf mit Zeitlimit und eigenem User-Agent. */
export async function httpFetch(url, { timeoutMs = 60000, userAgent, headers = {}, ...options } = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'User-Agent': userAgent, 'Accept-Language': 'de-DE,de;q=0.9', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const error = new Error(`HTTP ${response.status} bei ${url}${body ? `: ${body.slice(0, 300)}` : ''}`);
    error.status = response.status;
    throw error;
  }
  return response;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
