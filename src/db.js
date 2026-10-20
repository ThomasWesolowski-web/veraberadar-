import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import config from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ausschreibungen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quelle TEXT NOT NULL,
  extern_id TEXT NOT NULL,
  titel TEXT NOT NULL,
  beschreibung TEXT,
  vergabestelle TEXT,
  ort TEXT,
  plz TEXT,
  nuts TEXT,
  cpv TEXT,                      -- JSON-Liste
  typ TEXT,                      -- Ausschreibung | Geplante Ausschreibung | Vergebener Auftrag
  veroeffentlicht TEXT,
  frist TEXT,
  url TEXT,                      -- Bekanntmachung
  unterlagen_url TEXT,           -- direkter Link zu den Vergabeunterlagen, falls bekannt
  punkte INTEGER DEFAULT 0,
  punkte_details TEXT,           -- JSON: Aufschlüsselung der Bewertung
  gewerke TEXT,                  -- JSON-Liste der erkannten Gewerke
  lat REAL,
  lon REAL,
  entfernung_km REAL,
  ki_zusammenfassung TEXT,
  ki_punkte INTEGER,
  status TEXT DEFAULT 'neu',     -- neu | interessant | abgelehnt | angeboten
  notiz TEXT,
  gemeldet INTEGER DEFAULT 0,    -- per E-Mail gemeldet
  erstmals_gesehen TEXT NOT NULL,
  zuletzt_gesehen TEXT NOT NULL,
  UNIQUE (quelle, extern_id)
);
CREATE INDEX IF NOT EXISTS idx_aus_punkte ON ausschreibungen (punkte DESC);
CREATE INDEX IF NOT EXISTS idx_aus_frist ON ausschreibungen (frist);

CREATE TABLE IF NOT EXISTS suchlaeufe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gestartet TEXT NOT NULL,
  beendet TEXT,
  status TEXT,
  ergebnis TEXT                  -- JSON je Quelle
);

CREATE TABLE IF NOT EXISTS geocache (
  anfrage TEXT PRIMARY KEY,
  lat REAL,
  lon REAL,
  anzeige TEXT,
  abgefragt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dokumente (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ausschreibung_id INTEGER NOT NULL REFERENCES ausschreibungen(id) ON DELETE CASCADE,
  dateiname TEXT NOT NULL,
  pfad TEXT NOT NULL,
  art TEXT,                      -- pdf | gaeb | zip | sonstiges
  groesse INTEGER,
  auswertung TEXT,               -- JSON
  geladen TEXT NOT NULL
);
`;

let db = null;

export function getDb() {
  if (db) return db;
  const file = process.env.VERGABERADAR_DB || path.join(config.dataDir, 'vergaberadar.sqlite');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function closeDb() {
  db?.close();
  db = null;
}

const JSON_FIELDS = ['cpv', 'punkte_details', 'gewerke'];

function decode(row) {
  if (!row) return row;
  const out = { ...row };
  for (const f of JSON_FIELDS) {
    if (out[f] != null) {
      try { out[f] = JSON.parse(out[f]); } catch { /* unverändert lassen */ }
    }
  }
  return out;
}

/**
 * Speichert eine Ausschreibung (neu oder aktualisiert). Bearbeitungsstatus und Notiz bleiben erhalten.
 * @returns {{ id: number, neu: boolean }}
 */
export function upsertTender(t) {
  const d = getDb();
  const now = new Date().toISOString();
  const existing = d.prepare('SELECT id FROM ausschreibungen WHERE quelle = ? AND extern_id = ?').get(t.quelle, t.externId);
  const values = {
    quelle: t.quelle,
    extern_id: t.externId,
    titel: t.titel,
    beschreibung: t.beschreibung ?? null,
    vergabestelle: t.vergabestelle ?? null,
    ort: t.ort ?? null,
    plz: t.plz ?? null,
    nuts: t.nuts ?? null,
    cpv: JSON.stringify(t.cpv ?? []),
    typ: t.typ ?? 'Ausschreibung',
    veroeffentlicht: t.veroeffentlicht ?? null,
    frist: t.frist ?? null,
    url: t.url ?? null,
    unterlagen_url: t.unterlagenUrl ?? null,
    now,
  };
  if (existing) {
    d.prepare(`UPDATE ausschreibungen SET titel=:titel, beschreibung=:beschreibung, vergabestelle=:vergabestelle,
      ort=:ort, plz=:plz, nuts=:nuts, cpv=:cpv, typ=:typ, veroeffentlicht=:veroeffentlicht, frist=:frist,
      url=:url, unterlagen_url=COALESCE(:unterlagen_url, unterlagen_url), zuletzt_gesehen=:now
      WHERE id=${existing.id}`).run(values);
    return { id: existing.id, neu: false };
  }
  const result = d.prepare(`INSERT INTO ausschreibungen (quelle, extern_id, titel, beschreibung, vergabestelle, ort, plz, nuts,
      cpv, typ, veroeffentlicht, frist, url, unterlagen_url, erstmals_gesehen, zuletzt_gesehen)
    VALUES (:quelle, :extern_id, :titel, :beschreibung, :vergabestelle, :ort, :plz, :nuts, :cpv, :typ,
      :veroeffentlicht, :frist, :url, :unterlagen_url, :now, :now)`).run(values);
  return { id: Number(result.lastInsertRowid), neu: true };
}

export function updateTenderFields(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const values = {};
  for (const k of keys) {
    values[k] = JSON_FIELDS.includes(k) && fields[k] != null ? JSON.stringify(fields[k]) : fields[k];
  }
  getDb().prepare(`UPDATE ausschreibungen SET ${keys.map((k) => `${k} = :${k}`).join(', ')} WHERE id = ${Number(id)}`).run(values);
}

export function getTender(id) {
  const t = decode(getDb().prepare('SELECT * FROM ausschreibungen WHERE id = ?').get(Number(id)));
  if (t) t.dokumente = listDocuments(t.id);
  return t;
}

const SORTS = {
  punkte: 'punkte DESC, frist ASC',
  frist: 'frist IS NULL, frist ASC',
  entfernung: 'entfernung_km IS NULL, entfernung_km ASC',
  neu: 'erstmals_gesehen DESC',
};

export function listTenders({
  minPunkte = 0, gewerk = null, quelle = null, status = null, suche = null,
  maxKm = null, nurOffen = true, sort = 'punkte', limit = 50, offset = 0,
} = {}) {
  const where = ['punkte >= :minPunkte'];
  const params = { minPunkte: Number(minPunkte) || 0 };
  if (gewerk) { where.push('gewerke LIKE :gewerk'); params.gewerk = `%"${gewerk}"%`; }
  if (quelle) { where.push('quelle = :quelle'); params.quelle = quelle; }
  if (status) { where.push('status = :status'); params.status = status; }
  if (suche) {
    where.push('(titel LIKE :suche OR beschreibung LIKE :suche OR vergabestelle LIKE :suche OR ort LIKE :suche)');
    params.suche = `%${suche}%`;
  }
  if (maxKm) { where.push('entfernung_km IS NOT NULL AND entfernung_km <= :maxKm'); params.maxKm = Number(maxKm); }
  if (nurOffen) {
    where.push("(frist IS NULL OR frist >= :heute) AND typ != 'Vergebener Auftrag'");
    params.heute = new Date().toISOString().slice(0, 10);
  }
  const sql = `FROM ausschreibungen WHERE ${where.join(' AND ')}`;
  const d = getDb();
  const total = d.prepare(`SELECT COUNT(*) AS n ${sql}`).get(params).n;
  const rows = d.prepare(`SELECT * ${sql} ORDER BY ${SORTS[sort] || SORTS.punkte} LIMIT ${Number(limit) || 50} OFFSET ${Number(offset) || 0}`).all(params);
  return { total, items: rows.map(decode) };
}

export function tendersToNotify(minPunkte) {
  const heute = new Date().toISOString().slice(0, 10);
  return getDb().prepare(`SELECT * FROM ausschreibungen WHERE gemeldet = 0 AND punkte >= ?
      AND status != 'abgelehnt' AND typ != 'Vergebener Auftrag' AND (frist IS NULL OR frist >= ?)
      ORDER BY punkte DESC`).all(minPunkte, heute).map(decode);
}

export function markNotified(ids) {
  const stmt = getDb().prepare('UPDATE ausschreibungen SET gemeldet = 1 WHERE id = ?');
  for (const id of ids) stmt.run(id);
}

export function tendersWithoutLocation(limit = 200) {
  return getDb().prepare(`SELECT * FROM ausschreibungen WHERE lat IS NULL AND (plz IS NOT NULL OR ort IS NOT NULL)
      AND punkte >= 1 ORDER BY punkte DESC LIMIT ?`).all(limit).map(decode);
}

export function allTenders() {
  return getDb().prepare('SELECT * FROM ausschreibungen').all().map(decode);
}

export function getStats() {
  const d = getDb();
  const heute = new Date().toISOString().slice(0, 10);
  const one = (sql, ...p) => d.prepare(sql).get(...p).n;
  return {
    gesamt: one('SELECT COUNT(*) AS n FROM ausschreibungen'),
    offen: one("SELECT COUNT(*) AS n FROM ausschreibungen WHERE (frist IS NULL OR frist >= ?) AND typ != 'Vergebener Auftrag'", heute),
    relevant: one("SELECT COUNT(*) AS n FROM ausschreibungen WHERE punkte >= 60 AND (frist IS NULL OR frist >= ?) AND typ != 'Vergebener Auftrag'", heute),
    neuHeute: one('SELECT COUNT(*) AS n FROM ausschreibungen WHERE erstmals_gesehen >= ?', heute),
    proQuelle: d.prepare('SELECT quelle, COUNT(*) AS anzahl FROM ausschreibungen GROUP BY quelle').all(),
    letzterLauf: d.prepare('SELECT * FROM suchlaeufe ORDER BY id DESC LIMIT 1').get() || null,
  };
}

export function startRun() {
  const r = getDb().prepare("INSERT INTO suchlaeufe (gestartet, status) VALUES (?, 'läuft')").run(new Date().toISOString());
  return Number(r.lastInsertRowid);
}

export function finishRun(id, status, ergebnis) {
  getDb().prepare('UPDATE suchlaeufe SET beendet = ?, status = ?, ergebnis = ? WHERE id = ?')
    .run(new Date().toISOString(), status, JSON.stringify(ergebnis), id);
}

export function listRuns(limit = 20) {
  return getDb().prepare('SELECT * FROM suchlaeufe ORDER BY id DESC LIMIT ?').all(limit)
    .map((r) => ({ ...r, ergebnis: r.ergebnis ? JSON.parse(r.ergebnis) : null }));
}

export function getGeoCache(anfrage) {
  return getDb().prepare('SELECT * FROM geocache WHERE anfrage = ?').get(anfrage) || null;
}

export function setGeoCache(anfrage, hit) {
  getDb().prepare('INSERT OR REPLACE INTO geocache (anfrage, lat, lon, anzeige, abgefragt) VALUES (?, ?, ?, ?, ?)')
    .run(anfrage, hit?.lat ?? null, hit?.lon ?? null, hit?.anzeige ?? null, new Date().toISOString());
}

export function addDocument(doc) {
  const r = getDb().prepare(`INSERT INTO dokumente (ausschreibung_id, dateiname, pfad, art, groesse, auswertung, geladen)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(doc.ausschreibungId, doc.dateiname, doc.pfad, doc.art, doc.groesse ?? null,
    JSON.stringify(doc.auswertung ?? null), new Date().toISOString());
  return Number(r.lastInsertRowid);
}

export function listDocuments(ausschreibungId) {
  return getDb().prepare('SELECT * FROM dokumente WHERE ausschreibung_id = ? ORDER BY id').all(ausschreibungId)
    .map((r) => ({ ...r, auswertung: r.auswertung ? JSON.parse(r.auswertung) : null }));
}

export function getDocument(id) {
  return getDb().prepare('SELECT * FROM dokumente WHERE id = ?').get(Number(id)) || null;
}
