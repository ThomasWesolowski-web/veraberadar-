import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// .env laden (eingebaut in Node.js, keine Zusatzbibliothek nötig)
const envFile = path.join(rootDir, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;

function bool(value, fallback) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'ja', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function list(value, fallback) {
  if (value == null || value === '') return fallback;
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

export const config = {
  // Webserver: standardmäßig nur auf diesem PC erreichbar
  port: int(env.PORT, 3000),
  host: env.HOST || '127.0.0.1',
  accessToken: env.ZUGANGSTOKEN || '',

  dataDir: path.resolve(rootDir, env.DATEN_ORDNER || './data'),

  // Betrieb
  firmaName: env.FIRMA_NAME || 'MT+ Stuckateurmeisterbetrieb Füß & Wesolowski GbR',
  firmaAdresse: env.FIRMA_ADRESSE || '',
  maxEntfernungKm: int(env.MAX_ENTFERNUNG_KM, 0), // 0 = keine harte Grenze

  // Suchlauf
  suchlaufZeitplan: env.SUCHLAUF_ZEITPLAN ?? '0 6 * * *', // täglich 06:00
  suchlaufBeimStart: bool(env.SUCHLAUF_BEIM_START, false),
  quellen: list(env.QUELLEN, ['ted', 'oeffentlichevergabe', 'servicebund']),
  tageZurueck: int(env.TAGE_ZURUECK, 7),
  requestTimeoutMs: int(env.REQUEST_TIMEOUT_MS, 60000),
  userAgent:
    env.USER_AGENT ||
    'Vergaberadar/0.1 (Ausschreibungssuche eines Handwerksbetriebs; https://github.com/ThomasWesolowski-web/veraberadar-)',

  // Relevanz
  mindestPunkteAnzeige: int(env.MINDEST_PUNKTE_ANZEIGE, 20),
  mindestPunkteMail: int(env.MINDEST_PUNKTE_MAIL, 60),

  // Geokodierung (OpenStreetMap Nominatim, kostenlos, max. 1 Anfrage/Sekunde)
  geoAktiv: bool(env.GEO_AKTIV, true),
  geoUrl: env.GEO_URL || 'https://nominatim.openstreetmap.org/search',
  geoKontakt: env.GEO_KONTAKT_EMAIL || '',

  // E-Mail (eigenes Postfach per SMTP)
  mail: {
    aktiv: bool(env.MAIL_AKTIV, false),
    host: env.SMTP_HOST || '',
    port: int(env.SMTP_PORT, 587),
    secure: bool(env.SMTP_SSL, false),
    user: env.SMTP_BENUTZER || '',
    pass: env.SMTP_PASSWORT || '',
    from: env.MAIL_ABSENDER || env.SMTP_BENUTZER || '',
    to: list(env.MAIL_EMPFAENGER, []),
  },

  // Lokale KI (Ollama), optional
  ki: {
    aktiv: bool(env.KI_AKTIV, false),
    url: env.KI_OLLAMA_URL || 'http://localhost:11434',
    modell: env.KI_MODELL || 'qwen2.5:7b',
    maxProLauf: int(env.KI_MAX_PRO_LAUF, 20),
  },

  // Unterlagen
  unterlagenMaxMb: int(env.UNTERLAGEN_MAX_MB, 50),
};

export default config;
