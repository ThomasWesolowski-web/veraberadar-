import './helpers.js';
import { isoInDays } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreTender } from '../src/relevance.js';

const base = { typ: 'Ausschreibung', frist: isoInDays(20), entfernung_km: null, cpv: [] };

test('Putzarbeiten im Titel ergeben hohe Punktzahl', () => {
  const r = scoreTender({ ...base, titel: 'Innenputzarbeiten Grundschule Nord', entfernung_km: 25 });
  assert.ok(r.punkte >= 70, `Punkte ${r.punkte}`);
  assert.deepEqual(r.gewerke, ['putz_stuck']);
});

test('Umlaute und ae-Schreibweise werden gleich erkannt', () => {
  const a = scoreTender({ ...base, titel: 'Wärmedämmverbundsystem Rathaus' });
  const b = scoreTender({ ...base, titel: 'Waermedaemmverbundsystem Rathaus' });
  assert.equal(a.punkte, b.punkte);
  assert.ok(a.gewerke.includes('wdvs'));
});

test('CPV-Code allein erkennt das Gewerk (auch Untergruppe)', () => {
  const r = scoreTender({ ...base, titel: 'Los 7 Sanierung Schule', cpv: ['45262120'] });
  assert.ok(r.gewerke.includes('geruest'));
  assert.ok(r.details.fachlich >= 30);
});

test('Kurze Begriffe nur als ganzes Wort (EPS nicht in "Steps")', () => {
  const r = scoreTender({ ...base, titel: 'Steps Programm Software', beschreibung: 'Concepts' });
  assert.equal(r.details.fachlich, 0);
  assert.ok(r.punkte <= 5);
});

test('Fremdes Gewerk bleibt unauffällig, auch wenn es nah ist', () => {
  const r = scoreTender({ ...base, titel: 'Elektroinstallation Feuerwehrhaus', entfernung_km: 5 });
  assert.ok(r.punkte <= 5, `Punkte ${r.punkte}`);
});

test('Planungsleistungen werden abgewertet', () => {
  const plan = scoreTender({ ...base, titel: 'Planungsleistungen Fassadensanierung' });
  const bau = scoreTender({ ...base, titel: 'Fassadensanierung' });
  assert.ok(plan.punkte < bau.punkte - 20);
});

test('Abgelaufene Frist und vergebene Aufträge landen bei 0–5 Punkten', () => {
  assert.equal(scoreTender({ ...base, titel: 'Trockenbauarbeiten', frist: isoInDays(-3) }).punkte, 0);
  assert.ok(scoreTender({ ...base, titel: 'Trockenbauarbeiten', typ: 'Vergebener Auftrag' }).punkte <= 5);
});

test('Entfernung beeinflusst die Punkte, Einsatzgebiet wirkt als Grenze', () => {
  const nah = scoreTender({ ...base, titel: 'Gerüstbau Kirche', entfernung_km: 20 });
  const fern = scoreTender({ ...base, titel: 'Gerüstbau Kirche', entfernung_km: 450 });
  const raus = scoreTender({ ...base, titel: 'Gerüstbau Kirche', entfernung_km: 300 }, { maxEntfernungKm: 150 });
  assert.ok(nah.punkte > fern.punkte);
  assert.ok(raus.punkte < fern.punkte);
});

test('Mehrere passende Gewerke geben einen Bonus, Höchstwert 100', () => {
  const r = scoreTender({ ...base, titel: 'Gerüstbau und WDVS-Arbeiten, Innenputz und Trockenbau', cpv: ['45262100', '45321000'], entfernung_km: 10 });
  assert.ok(r.gewerke.length >= 3);
  assert.ok(r.punkte <= 100 && r.punkte >= 90);
});
