import './helpers.js';
import { fixture } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGaeb, summarizeGaeb, isGaebFile } from '../src/gaeb.js';

test('GAEB DA XML (X83): Positionen mit OZ, Menge, Einheit und Texten', () => {
  const lv = parseGaeb(fixture('lv-beispiel.x83'), 'lv-beispiel.x83');
  assert.equal(lv.format, 'GAEB DA XML');
  assert.equal(String(lv.phase), '83');
  assert.equal(lv.projekt, 'Neubau Kita Sonnenschein');
  assert.equal(lv.positionen.length, 3);
  const [p1, p2] = lv.positionen;
  assert.equal(p1.oz, '01.0010');
  assert.equal(p1.abschnitt, 'Innenputz');
  assert.equal(p1.kurztext, 'Kalkzementputz innen');
  assert.match(p1.langtext, /Kalk-Zement-Innenputz/);
  assert.equal(p1.menge, 1250);
  assert.equal(p1.einheit, 'm2');
  assert.equal(p2.menge, 85.5);
});

test('GAEB 90 (D83): Positionen aus dem Textformat', () => {
  const lv = parseGaeb(fixture('lv-alt.d83'), 'lv-alt.d83');
  assert.equal(lv.format, 'GAEB 90/2000');
  assert.equal(lv.positionen.length, 2);
  assert.equal(lv.positionen[0].oz, '0100010');
  assert.equal(lv.positionen[0].menge, 1250);
  assert.equal(lv.positionen[0].einheit, 'm2');
  assert.match(lv.positionen[0].kurztext, /Gipsputz innen/);
  assert.match(lv.positionen[0].langtext, /maschinell/);
  assert.equal(lv.positionen[1].menge, 85.5);
});

test('Zusammenfassung markiert passende Positionen', () => {
  const lv = parseGaeb(fixture('lv-beispiel.x83'), 'x.x83');
  const s = summarizeGaeb(lv, (t) => /putz/i.test(t));
  assert.equal(s.anzahlPositionen, 3);
  assert.equal(s.passendePositionen, 1);
  assert.equal(s.positionen[0].passend, true);
});

test('Dateiendungen werden als GAEB erkannt', () => {
  assert.ok(isGaebFile('LV.X83'));
  assert.ok(isGaebFile('lv.d84'));
  assert.ok(!isGaebFile('lv.pdf'));
});
