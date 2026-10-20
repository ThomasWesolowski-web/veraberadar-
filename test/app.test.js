import './helpers.js';
import { fixture, isoInDays } from './helpers.js';
import { makePdf } from './pdf-helper.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { SOURCES } from '../src/sources/index.js';
import { runCrawl } from '../src/crawl.js';
import { buildApp } from '../src/server.js';
import { listTenders, getTender } from '../src/db.js';
import { storeAndAnalyze } from '../src/documents.js';
import { buildDigest } from '../src/notify.js';
import { parseAnswer, buildPrompt } from '../src/ai.js';

// Echte Netzabrufe werden im Test durch eine Quelle mit festen Daten ersetzt.
for (const key of Object.keys(SOURCES)) delete SOURCES[key];
SOURCES.test = {
  meta: { id: 'test', name: 'Testquelle' },
  async fetchTenders() {
    return [
      { quelle: 'test', externId: 'A', titel: 'Innenputzarbeiten Rathaus', beschreibung: 'Kalkputz', cpv: ['45410000'], typ: 'Ausschreibung', frist: isoInDays(30), url: 'https://example.org/a' },
      { quelle: 'test', externId: 'B', titel: 'Lieferung von Druckerpapier', cpv: ['30197630'], typ: 'Ausschreibung', frist: isoInDays(30), url: 'https://example.org/b' },
      { quelle: 'test', externId: 'C', titel: 'Gerüstbau Kirchturm', cpv: [], typ: 'Ausschreibung', frist: isoInDays(10), url: 'https://example.org/c', plz: '70173', ort: 'Stuttgart' },
    ];
  },
};
SOURCES.kaputt = { meta: { id: 'kaputt', name: 'Kaputt' }, async fetchTenders() { throw new Error('Netzwerk gesperrt'); } };

const quiet = () => {};

test('Suchlauf speichert nur passende Ausschreibungen und bewertet sie', async () => {
  const { status, ergebnis } = await runCrawl({ quellen: ['test', 'kaputt'], log: quiet });
  assert.equal(status, 'teilweise');
  assert.deepEqual({ ...ergebnis.test }, { gefunden: 3, passend: 2, neu: 2 });
  assert.equal(ergebnis.kaputt.fehler, 'Netzwerk gesperrt');
  const { items } = listTenders({ minPunkte: 0 });
  assert.equal(items.length, 2);
  assert.equal(items[0].titel, 'Innenputzarbeiten Rathaus');
  assert.ok(items[0].punkte >= 70);
  assert.deepEqual(items[0].gewerke, ['putz_stuck']);
});

test('Wiederholter Suchlauf erzeugt keine Doppelten und behält den Bearbeitungsstatus', async () => {
  const app = buildApp({ logger: false });
  const { items } = listTenders({ minPunkte: 0 });
  const id = items[0].id;
  const patch = await app.inject({ method: 'PATCH', url: `/api/ausschreibungen/${id}`, payload: { status: 'interessant', notiz: 'Besichtigung' } });
  assert.equal(patch.statusCode, 200);
  const { ergebnis } = await runCrawl({ quellen: ['test'], log: quiet });
  assert.equal(ergebnis.test.neu, 0);
  const t = getTender(id);
  assert.equal(t.status, 'interessant');
  assert.equal(t.notiz, 'Besichtigung');
  await app.close();
});

test('API: Status, Liste mit Filter, Detail, ungültiger Status', async () => {
  const app = buildApp({ logger: false });
  const status = await app.inject({ url: '/api/status' });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().statistik.gesamt, 2);
  const liste = await app.inject({ url: '/api/ausschreibungen?gewerk=geruest&minPunkte=0' });
  assert.equal(liste.json().total, 1);
  assert.equal(liste.json().items[0].titel, 'Gerüstbau Kirchturm');
  const id = liste.json().items[0].id;
  const detail = await app.inject({ url: `/api/ausschreibungen/${id}` });
  assert.ok(detail.json().punkte_details.gruende.length > 0);
  const bad = await app.inject({ method: 'PATCH', url: `/api/ausschreibungen/${id}`, payload: { status: 'egal' } });
  assert.equal(bad.statusCode, 400);
  const html = await app.inject({ url: '/' });
  assert.match(html.body, /Vergaberadar/);
  const ohneLink = await app.inject({ method: 'POST', url: `/api/ausschreibungen/${id}/unterlagen-laden` });
  assert.equal(ohneLink.statusCode, 400);
  assert.match(ohneLink.json().fehler, /kein direkter Link/);
  await app.close();
});

test('Datei hinzufügen: ZIP mit PDF und GAEB wird entpackt und ausgewertet', async () => {
  const app = buildApp({ logger: false });
  const { items } = listTenders({ minPunkte: 0 });
  const id = items[0].id;
  const zip = zipSync({
    'Unterlagen/Leistungsbeschreibung.pdf': new Uint8Array(makePdf('Innenputz und Trockenbau Leistungsbeschreibung Frist 20.11.2026')),
    'Unterlagen/LV.x83': strToU8(fixture('lv-beispiel.x83').toString()),
  });
  const res = await app.inject({
    method: 'POST', url: `/api/ausschreibungen/${id}/datei`, payload: Buffer.from(zip),
    headers: { 'content-type': 'application/octet-stream', 'x-dateiname': encodeURIComponent('Unterlagen.zip') },
  });
  assert.equal(res.statusCode, 200);
  const docs = res.json().dokumente;
  assert.equal(docs.length, 2);
  const pdf = docs.find((d) => d.dateiname === 'Leistungsbeschreibung.pdf').auswertung;
  assert.equal(pdf.art, 'pdf');
  assert.equal(pdf.seiten, 1);
  assert.ok(pdf.gewerkTreffer['Stuck & Putz'] >= 1);
  assert.ok(pdf.gewerkTreffer.Trockenbau >= 1);
  assert.deepEqual(pdf.datumsangaben, ['20.11.2026']);
  const lv = docs.find((d) => d.dateiname === 'LV.x83').auswertung;
  assert.equal(lv.art, 'gaeb');
  assert.equal(lv.anzahlPositionen, 3);
  assert.ok(lv.passendePositionen >= 1);
  const download = await app.inject({ url: `/api/dokumente/${docs[0].id}/datei` });
  assert.equal(download.statusCode, 200);
  await app.close();
});

test('Portalseite statt Datei wird erkannt und erklärt', async () => {
  const { items } = listTenders({ minPunkte: 0 });
  const [doc] = await storeAndAnalyze(items[0].id, 'seite', Buffer.from('<!DOCTYPE html><html><body>Login</body></html>'));
  assert.equal(doc.auswertung.art, 'html');
  assert.match(doc.auswertung.hinweis, /Portalseite/);
});

test('E-Mail-Zusammenfassung enthält Punkte, Titel und Link', () => {
  const mail = buildDigest([{ punkte: 82, titel: 'WDVS <Schule>', url: 'https://example.org/x', plz: '89073', ort: 'Ulm', frist: '2026-11-20', gewerke: ['wdvs'], entfernung_km: 42.3 }], 'http://localhost:3000/');
  assert.match(mail.subject, /1 neue passende Ausschreibung$/);
  assert.match(mail.html, /WDVS &lt;Schule&gt;/);
  assert.match(mail.html, /20\.11\.2026/);
  assert.match(mail.html, /ca\. 42 km/);
  assert.match(mail.text, /82 Punkte/);
});

test('KI-Antwort wird robust gelesen', () => {
  assert.deepEqual(parseAnswer('Hier: {"punkte": 87.4, "zusammenfassung": "Passt gut."}'), { punkte: 87, zusammenfassung: 'Passt gut.' });
  assert.equal(parseAnswer('kein JSON'), null);
  assert.equal(parseAnswer('{"punkte": 150}').punkte, 100);
  assert.match(buildPrompt({ titel: 'Trockenbau', cpv: [] }), /Trockenbau/);
});
