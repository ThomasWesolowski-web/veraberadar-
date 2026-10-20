import './helpers.js';
import { fixture } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import * as ted from '../src/sources/ted.js';
import * as ov from '../src/sources/oeffentlichevergabe.js';
import * as sb from '../src/sources/servicebund.js';

test('TED: Bekanntmachung wird vollständig übernommen', () => {
  const data = JSON.parse(fixture('ted-antwort.json'));
  const [t, award] = data.notices.map(ted.parseNotice);
  assert.equal(t.externId, '612345-2026');
  assert.equal(t.titel, 'Innen- und Außenputzarbeiten Neubau Kita Sonnenschein');
  assert.equal(t.vergabestelle, 'Stadt Musterstadt, Hochbauamt');
  assert.equal(t.plz, '70173');
  assert.equal(t.ort, 'Musterstadt');
  assert.equal(t.nuts, 'DE111');
  assert.deepEqual(t.cpv, ['45410000', '45262100']);
  assert.equal(t.frist, '2026-11-20');
  assert.equal(t.veroeffentlicht, '2026-10-15');
  assert.equal(t.unterlagenUrl, 'https://vergabe.example.de/unterlagen/4711');
  assert.match(t.url, /612345-2026/);
  assert.equal(award.typ, 'Vergebener Auftrag');
});

test('TED: Suchabfrage filtert auf Deutschland, CPV und Suchbegriffe', () => {
  const q = ted.buildQuery({ cpvCodes: ['45410000', '45262100'], terms: ['Putzarbeiten', 'WDVS'], days: 7 });
  assert.match(q, /classification-cpv IN \(45410000 45262100\)/);
  assert.match(q, /FT ~ "Putzarbeiten"/);
  assert.match(q, /place-of-performance IN \(DEU\)/);
  assert.match(q, /publication-date >= today\(-7\)/);
});

test('oeffentlichevergabe.de: OCDS-Export (ZIP) wird ausgewertet', () => {
  const zip = zipSync({ '2026-10-16.json': strToU8(fixture('ocds-release-package.json').toString()), 'liesmich.txt': strToU8('x') });
  const tenders = ov.parseExportZip(Buffer.from(zip));
  assert.equal(tenders.length, 2);
  const [t, award] = tenders;
  assert.equal(t.titel, 'WDVS-Arbeiten und Fassadensanierung Institutsgebäude');
  assert.equal(t.vergabestelle, 'Universitätsbauamt Beispielstadt');
  assert.equal(t.plz, '89081'); // Lieferadresse geht vor Adresse des Auftraggebers
  assert.equal(t.ort, 'Ulm-Lehr');
  assert.deepEqual(t.cpv, ['45321000', '45443000']);
  assert.equal(t.frist, '2026-11-25');
  assert.equal(t.unterlagenUrl, 'https://vergabe.example.de/projekt/889/unterlagen.zip');
  assert.equal(t.url, 'https://oeffentlichevergabe.de/ui/de/notices/4f1c7a2e-1111-2222-3333-444455556666');
  assert.equal(award.typ, 'Vergebener Auftrag');
  assert.equal(award.ort, 'Irgendwo');
});

test('oeffentlichevergabe.de: Record-Package wird ebenfalls gelesen', () => {
  const pkg = JSON.parse(fixture('ocds-release-package.json'));
  const records = { records: [{ compiledRelease: pkg.releases[0] }] };
  assert.equal(ov.releasesFromDocument(records).length, 1);
});

test('service.bund.de: RSS-Feed mit Frist, Ort und geplanten Vergaben', () => {
  const [a, b] = sb.parseFeed(fixture('servicebund.xml').toString());
  assert.equal(a.titel, 'Trockenbauarbeiten Sanierung Gymnasium am Park');
  assert.equal(a.url, 'https://www.service.bund.de/IMPORTE/Ausschreibungen/eVergabe/2026/10/123456.html?nn=4641482');
  assert.equal(a.vergabestelle, 'Landkreis Beispiel');
  assert.equal(a.plz, '72764');
  assert.equal(a.ort, 'Reutlingen');
  assert.equal(a.frist, '2026-11-12');
  assert.equal(a.veroeffentlicht, '2026-10-16');
  assert.equal(b.typ, 'Geplante Ausschreibung');
  assert.equal(b.vergabestelle, 'Gemeinde Testdorf & Partner');
  assert.equal(b.frist, null);
});
