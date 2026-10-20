// E-Mail-Benachrichtigung über das eigene Postfach (SMTP). Kostenlos, keine Fremddienste.
import nodemailer from 'nodemailer';
import config from './config.js';
import { tendersToNotify, markNotified } from './db.js';

const GEWERK_NAMEN = { putz_stuck: 'Stuck & Putz', wdvs: 'WDVS & Fassade', trockenbau: 'Trockenbau', geruest: 'Gerüstbau' };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const datum = (iso) => (iso ? iso.split('-').reverse().join('.') : '–');

export function buildDigest(tenders, dashboardUrl) {
  const rows = tenders.map((t) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #ddd;font-weight:bold;color:${t.punkte >= 75 ? '#0a7a2f' : '#8a6d00'}">${t.punkte}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd">
        <a href="${esc(t.url)}">${esc(t.titel)}</a><br>
        <small>${esc(t.vergabestelle || '')} · ${esc([t.plz, t.ort].filter(Boolean).join(' ') || 'Ort unbekannt')}${t.entfernung_km != null ? ` · ca. ${Math.round(t.entfernung_km)} km` : ''}<br>
        Frist: ${datum(t.frist)} · ${esc((t.gewerke || []).map((g) => GEWERK_NAMEN[g] || g).join(', '))}</small>
      </td>
    </tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px">
    <p>${tenders.length} neue passende Ausschreibung${tenders.length === 1 ? '' : 'en'} für ${esc(config.firmaName)}:</p>
    <table style="border-collapse:collapse;width:100%">${rows}</table>
    <p><a href="${esc(dashboardUrl)}">Im Vergaberadar öffnen</a></p></div>`;
  const text = tenders.map((t) => `${t.punkte} Punkte – ${t.titel}\n  ${[t.plz, t.ort].filter(Boolean).join(' ')} · Frist ${datum(t.frist)}\n  ${t.url}`).join('\n\n');
  return {
    subject: `Vergaberadar: ${tenders.length} neue passende Ausschreibung${tenders.length === 1 ? '' : 'en'}`,
    html,
    text,
  };
}

function transport() {
  const m = config.mail;
  if (!m.host || !m.to.length) throw new Error('E-Mail ist nicht eingerichtet (SMTP_HOST und MAIL_EMPFAENGER in der .env setzen).');
  return nodemailer.createTransport({ host: m.host, port: m.port, secure: m.secure, auth: m.user ? { user: m.user, pass: m.pass } : undefined });
}

function dashboardUrl() {
  return `http://localhost:${config.port}/`;
}

/** Meldet alle noch nicht gemeldeten Ausschreibungen ab der Mindestpunktzahl. */
export async function sendDigest({ log = console.log } = {}) {
  if (!config.mail.aktiv) return { gesendet: 0, grund: 'E-Mail deaktiviert' };
  const tenders = tendersToNotify(config.mindestPunkteMail);
  if (!tenders.length) return { gesendet: 0, grund: 'Keine neuen Treffer' };
  const mail = buildDigest(tenders, dashboardUrl());
  await transport().sendMail({ from: config.mail.from, to: config.mail.to.join(', '), ...mail });
  markNotified(tenders.map((t) => t.id));
  log(`[mail] ${tenders.length} Ausschreibungen gemeldet.`);
  return { gesendet: tenders.length };
}

export async function sendTestMail() {
  await transport().sendMail({
    from: config.mail.from,
    to: config.mail.to.join(', '),
    subject: 'Vergaberadar: Testnachricht',
    text: 'Die E-Mail-Benachrichtigung des Vergaberadars funktioniert.',
  });
  return { ok: true };
}
