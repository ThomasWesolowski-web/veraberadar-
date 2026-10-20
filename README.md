# Vergaberadar

Ausschreibungsradar für **MT+ Stuckateurmeisterbetrieb Füß & Wesolowski GbR**.
Durchsucht täglich öffentliche Vergabeportale nach Stuckateur-, Putz-, WDVS-, Trockenbau- und Gerüstbauarbeiten,
bewertet jeden Treffer mit 0 bis 100 Punkten, berechnet die Entfernung zum Betriebssitz, wertet PDF- und GAEB-Unterlagen
aus und meldet passende Ausschreibungen per E-Mail. Läuft lokal auf einem Windows-PC, kostenlos, ohne Cloud-Dienste.

## Schnellstart unter Windows

1. **Node.js** (LTS, mindestens 22.13) von <https://nodejs.org/de/download> installieren.
2. Diesen Ordner auf den PC kopieren (oder per Git klonen).
3. **`start.bat` doppelklicken.** Beim ersten Start werden die Programmbausteine installiert und die Einstellungsdatei
   `.env` im Editor geöffnet. Dort mindestens `FIRMA_ADRESSE` eintragen, speichern, Editor schließen.
4. Der Browser öffnet <http://localhost:3000/>. Auf **„Suchlauf starten“** klicken.

Für den ersten Lauf empfiehlt sich in der `.env` `TAGE_ZURUECK=30`, danach wieder `7`.

| Datei | Zweck |
|---|---|
| `start.bat` | Installiert bei Bedarf und startet das Dashboard |
| `suchlauf-jetzt.bat` | Einmaliger Suchlauf ohne Dashboard |
| `taeglicher-suchlauf-einrichten.bat` | Täglichen Suchlauf um 06:00 Uhr in der Windows-Aufgabenplanung anlegen |
| `.env` | Einstellungen (Adresse, E-Mail, KI, Schwellenwerte) |
| `gewerke.json` | Suchbegriffe, CPV-Codes und Ausschlussbegriffe je Gewerk |
| `data/` | Datenbank, geladene Unterlagen, Protokoll (wird automatisch angelegt) |

## Funktionen

| Funktion | Umsetzung |
|---|---|
| Bundesweite Suche | TED (EU, gefiltert auf Deutschland + Bau-CPV + Suchbegriffe), Datenservice Öffentlicher Einkauf (oeffentlichevergabe.de, Bund + Länder + Kommunen), service.bund.de (auch unterhalb der EU-Schwellenwerte) |
| Relevanz 0–100 | Fachlicher Bezug bis 70 (Suchbegriffe in Titel/Text, CPV-Codes, Ausschlussbegriffe), Entfernung bis 20, Frist bis 10. Die Aufschlüsselung steht in jeder Detailansicht. |
| Entfernung | OpenStreetMap Nominatim (kostenlos, zwischengespeichert), Luftlinie zum Betriebssitz, optional harte Grenze `MAX_ENTFERNUNG_KM` |
| Unterlagen | Direktlink zur Bekanntmachung und – wo die Quelle ihn liefert – zu den Vergabeunterlagen. „Unterlagen laden & auswerten“ lädt frei zugängliche Dateien. |
| Eigene Portalzugänge | Unterlagen hinter einem Login laden Sie im Portal herunter und ziehen sie über „Datei hinzufügen“ in den Vergaberadar (PDF, GAEB, ZIP). Automatisches Anmelden folgt in einer späteren Phase, siehe unten. |
| PDF-Auswertung | Text, Seitenzahl, Treffer je Gewerk, Datumsangaben, Textauszug |
| GAEB-Auswertung | GAEB DA XML (X81/X83/X84/X86) und GAEB 90 (D81/D83/P83): Positionen mit OZ, Kurz-/Langtext, Menge, Einheit; passende Positionen werden markiert |
| Täglicher Suchlauf | Zeitplan im laufenden Programm (`SUCHLAUF_ZEITPLAN`) oder Windows-Aufgabenplanung |
| E-Mail | Zusammenfassung neuer Treffer ab `MINDEST_PUNKTE_MAIL` über Ihr eigenes Postfach (SMTP), jede Ausschreibung wird nur einmal gemeldet |
| Lokale KI (optional) | Ollama auf dem eigenen PC als Zweitmeinung (30 % Gewicht) mit Kurzzusammenfassung |
| Bearbeitung | Status je Ausschreibung (neu, interessant, Angebot abgegeben, abgelehnt) und Notiz |

### Lokale KI einrichten (optional, kostenlos)

1. Ollama für Windows von <https://ollama.com/download> installieren.
2. In der Eingabeaufforderung `ollama pull qwen2.5:7b` ausführen (ca. 5 GB, braucht ca. 8 GB Arbeitsspeicher).
3. In der `.env` `KI_AKTIV=true` setzen und den Vergaberadar neu starten.

### E-Mail einrichten

In der `.env` `MAIL_AKTIV=true` und die SMTP-Daten Ihres Postfachs eintragen (bei den meisten Anbietern Port 587).
Unter **Einstellungen → Testmail senden** prüfen.

## Entwicklung

```bash
npm install
npm test          # automatische Tests (ohne Internetzugriff, mit Beispieldaten)
npm start         # Dashboard auf http://localhost:3000
npm run suchlauf  # Suchlauf auf der Kommandozeile
```

Technik: Node.js ≥ 22.13 (eingebaute SQLite-Datenbank), Fastify, node-cron, nodemailer, fast-xml-parser, fflate, pdf-parse.
Neue Quelle anbinden: Modul in `src/sources/` mit `meta` und `fetchTenders()` anlegen und in `src/sources/index.js` eintragen.

```
src/
├── server.js        Dashboard-Server und API
├── crawl.js         Suchlauf: Quellen → Speichern → Entfernung → Bewertung → KI → E-Mail
├── relevance.js     Punktebewertung 0–100
├── sources/         ted.js, oeffentlichevergabe.js, servicebund.js
├── geo.js           Geokodierung und Entfernung
├── documents.js     Unterlagen laden, entpacken, PDF auswerten
├── gaeb.js          GAEB-Leser
├── notify.js        E-Mail
├── ai.js            Lokale KI (Ollama)
├── db.js            SQLite-Datenbank
└── cli.js           Kommandozeile (suchlauf, testmail, neu-bewerten)
public/              Dashboard (HTML, CSS, JavaScript)
```

## Herkunft und Lizenzen

Der Code dieses Repositorys ist eigenständig geschrieben. Die Anbindung von TED, oeffentlichevergabe.de und
service.bund.de sowie das Prinzip der Relevanzbewertung sind an **kwb.tenders** (MIT-Lizenz, Kompetenzzentrum Wasser
Berlin) angelehnt, siehe [NOTICE.md](NOTICE.md). Aus `togugg/tender-crawler` wurde **kein Code übernommen**, weil
das Projekt keine Lizenz hat; Details in [docs/BESTANDSAUFNAHME.md](docs/BESTANDSAUFNAHME.md).

Die Nutzungsbedingungen der Portale gelten: Der Vergaberadar fragt nur öffentliche Schnittstellen und Feeds ab,
identifiziert sich mit eigenem User-Agent und hält die Abfragegrenzen von OpenStreetMap ein (1 Anfrage pro Sekunde).

## Änderungen

Siehe [docs/CHANGELOG.md](docs/CHANGELOG.md).
