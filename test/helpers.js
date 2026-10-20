import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// Jede Testdatei bekommt eine eigene leere Datenbank und einen eigenen Datenordner.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vergaberadar-test-'));
process.env.VERGABERADAR_DB = ':memory:';
process.env.DATEN_ORDNER = dir;
process.env.GEO_AKTIV = 'false';
process.env.MAIL_AKTIV = 'false';
process.env.KI_AKTIV = 'false';
process.env.FIRMA_ADRESSE = '';

export const tmpDir = dir;
export const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
export function isoInDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
