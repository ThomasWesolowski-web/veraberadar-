import * as ted from './ted.js';
import * as oeffentlichevergabe from './oeffentlichevergabe.js';
import * as servicebund from './servicebund.js';

/** Alle angebundenen Vergabeportale. Neue Quellen: Modul mit meta + fetchTenders() anlegen und hier eintragen. */
export const SOURCES = { ted, oeffentlichevergabe, servicebund };

export function listSources() {
  return Object.values(SOURCES).map((s) => s.meta);
}
