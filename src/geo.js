// Entfernung zum Bauvorhaben: Geokodierung über OpenStreetMap Nominatim (kostenlos, max. 1 Anfrage pro Sekunde,
// Ergebnisse werden dauerhaft zwischengespeichert) und Luftlinie zum Betriebssitz.
import config from './config.js';
import { getGeoCache, setGeoCache } from './db.js';
import { httpFetch, sleep } from './text.js';

let lastRequest = 0;

export function haversineKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Suchanfrage für einen Ort: PLZ + Ort ist am genauesten, sonst nur einer davon. */
export function locationQuery({ plz, ort }) {
  const cleanOrt = ort ? String(ort).replace(/\b\d{5}\b/, '').trim() : '';
  const q = [plz, cleanOrt].filter(Boolean).join(' ').trim();
  return q ? `${q}, Deutschland` : null;
}

export async function geocode(query, { fetchImpl = httpFetch } = {}) {
  if (!query) return null;
  const key = query.toLowerCase();
  const cached = getGeoCache(key);
  if (cached) return cached.lat != null ? { lat: cached.lat, lon: cached.lon, anzeige: cached.anzeige } : null;
  if (!config.geoAktiv) return null;

  const wait = 1100 - (Date.now() - lastRequest);
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();

  const url = new URL(config.geoUrl);
  url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1', countrycodes: 'de', ...(config.geoKontakt ? { email: config.geoKontakt } : {}) });
  const response = await fetchImpl(url.toString(), { timeoutMs: 20000, userAgent: config.userAgent });
  const data = await response.json();
  const hit = Array.isArray(data) && data[0] ? { lat: Number(data[0].lat), lon: Number(data[0].lon), anzeige: data[0].display_name } : null;
  setGeoCache(key, hit);
  return hit;
}

let homeCache = null;

export async function getHome() {
  if (!config.firmaAdresse) return null;
  if (homeCache?.adresse === config.firmaAdresse) return homeCache.punkt;
  const punkt = await geocode(config.firmaAdresse);
  homeCache = { adresse: config.firmaAdresse, punkt };
  return punkt;
}
