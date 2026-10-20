# Technische Bestandsaufnahme: tender-crawler als Basis für den Vergaberadar

Stand: 20.10.2026 · Geprüfter Stand: `togugg/tender-crawler`, Commit `f62e91b` („first commit“, 01.08.2026)
Zum Vergleich geprüft: `KWB-R/kwb.tenders` (Stand 23.06.2026)

## 1. Ergebnis in Kürze

| Thema | Bewertung |
|---|---|
| **Lizenz tender-crawler** | **Keine Lizenz vorhanden.** Keine LICENSE-Datei, kein `license`-Feld in `package.json` (dort sogar `"private": true`), kein Hinweis in der README. |
| Lizenz kwb.tenders | MIT (Copyright 2026 Kompetenzzentrum Wasser Berlin gGmbH). Verwendung, Änderung und Weitergabe erlaubt, Copyright-Hinweis muss erhalten bleiben. |
| Technische Qualität tender-crawler | Gut: Node.js 20+, Fastify, SQLite, sauber modularisierte Portal-Adapter, 140 Tests, deutschsprachige Oberfläche. |
| Eignung für Stuckateurbetrieb | Mittel: Grundgerüst passt, aber Suche ist nicht auf Bauleistungen gefiltert, Datenquellen sind dünn, E-Mail, Entfernung, GAEB und Portal-Logins fehlen ganz. |
| Sicherheit | Für lokalen Einsatz vertretbar nach Updates; 8 bekannte Schwachstellen in Abhängigkeiten (6 hoch), Standard-Token schwach, Server lauscht standardmäßig im ganzen Netz. |

## 2. Lizenz und Nutzungsrechte (wichtigster Punkt)

**tender-crawler hat keine Lizenz.** Rechtlich bedeutet das: Alle Rechte liegen beim Urheber (GitHub-Nutzer `togugg`).

- Nach deutschem Urheberrecht (§ 69c UrhG) sind Vervielfältigung, **Bearbeitung** und **Verbreitung** von Software zustimmungspflichtig. Ohne Lizenz haben wir diese Zustimmung nicht.
- Die GitHub-Nutzungsbedingungen erlauben bei öffentlichen Repositories nur das **Ansehen und Forken auf GitHub**. Ein Recht zur Änderung, zum produktiven Einsatz oder zur Weitergabe folgt daraus nicht.
- Unser Projekt-Repository `ThomasWesolowski-web/veraberadar-` ist **öffentlich**. Würden wir den Code dort hineinkopieren, wäre das eine öffentliche Verbreitung ohne Erlaubnis. **Deshalb ist bisher keine Zeile tender-crawler-Code in unser Repository gelangt.**
- Eine rein interne Nutzung im Betrieb wäre zwar weniger riskant, bleibt aber ohne Erlaubnis rechtlich unsicher (keine Rechtsberatung).

**Saubere Wege:**

1. **Urheber um eine Lizenz bitten** (z. B. MIT) über ein GitHub-Issue oder eine Nachricht an `togugg`. Danach kann tender-crawler direkt die Basis werden. Diese Nachricht geht nach außen und wird nur mit Ihrer Zustimmung verschickt.
2. **Eigene Basis auf MIT-Grundlage:** Den Vergaberadar in Node.js neu aufsetzen und dabei die Portal-Anbindungen und die Relevanzlogik aus **kwb.tenders (MIT)** nach JavaScript übertragen. Ideen und Architekturmuster von tender-crawler (z. B. SQLite-Job-Queue, Rate-Limiter) dürfen als Idee übernommen werden, der Quelltext selbst nicht.
3. Repository auf **privat** stellen und tender-crawler nur intern nutzen, bis eine Lizenz vorliegt. Das senkt das Risiko, beseitigt es aber nicht.

Empfehlung: Weg 1 anfragen und parallel mit Weg 2 beginnen. Teile, die wir nach Weg 2 selbst schreiben, bleiben in jedem Fall unser eigenes Werk.

**Entscheidung (20.10.2026):** Weg 1 + 2. Der Vergaberadar wird als eigene Basis mit Bausteinen aus kwb.tenders gebaut, beim Autor von tender-crawler wird eine Lizenz angefragt.

## 3. Architektur tender-crawler

```
Browser (Dashboard, public/)  ──HTTP + Bearer-Token──>  Fastify-Server (src/server.js)
                                                          │
             node-cron (Zeitplan)  ──>  Orchestrator (src/crawler/)  ──>  Portal-Adapter (src/portals/*.js)
                                                          │                     TED-API, DTVP-API, eVergabe
                                                          ▼
                                       SQLite (better-sqlite3, WAL, FTS5-Volltextsuche)
                                                          ▲
                        Playwright-Worker (src/worker.js) ┘  für JavaScript-Portale (eVergabe)
```

- **Sprache/Laufzeit:** Node.js ≥ 20, ES-Module, ca. 14.500 Zeilen.
- **Portal-Adapter** sind einzelne Dateien mit `meta` + `discover()` + `fetchDetail()` und werden automatisch geladen. Neue Portale lassen sich so leicht ergänzen.
- **Datenbank:** eine SQLite-Datei, Änderungshistorie je Ausschreibung, gespeicherte Suchen, Crawl-Protokoll.
- **Hintergrund-Worker** für Browser-Portale mit Heartbeat, Retry und Checkpoints.
- **Zusatzbereich Förderprogramme** (ca. 40 % des Codes): Förderaufrufe, RAG-Chat, Quellenkatalog. Für den Stuckateurbetrieb nicht nötig.

## 4. Vorhandene Funktionen und Abgleich mit den Anforderungen

| Anforderung | Vorhanden in tender-crawler? | Anmerkung |
|---|---|---|
| Dashboard mit Suche, Filter, Detailansicht | Ja | Deutsch, Token-Login, Filter nach Quelle, Status, Frist, Wert, Relevanz |
| Bundesweite Suche Stuckateur/Putz/WDVS/Trockenbau/Gerüst | **Nein** | TED holt die letzten 250 Bekanntmachungen **EU-weit ohne Länder- oder CPV-Filter**, DTVP die neuesten 100 ohne Suchbegriff. Für Bauleistungen fast nur Zufallstreffer. |
| Datenquellen | Teilweise | Aktiv: TED, DTVP, eVergabe Online. bund.de und Vergabe Bayern deaktiviert. Es fehlt v. a. der **Datenservice Öffentlicher Einkauf (oeffentlichevergabe.de)**, die zentrale Quelle für Bund, Länder und Kommunen. |
| Relevanz 0–100 | **Nein** (nur vorbereitet) | Feld für LLM-Relevanz (0–1) existiert, die LLM-Analyse für Ausschreibungen ist aber im Code bewusst abgeschaltet. Kein Stichwort-/CPV-Scoring. |
| Entfernung zum Bauvorhaben | **Nein** | Kein Geocoding. Leistungsort wird nur als Text gespeichert. |
| Direkte Links zu Vergabeunterlagen | Teilweise | Link zur Bekanntmachung ja; TED liefert teils PDF-Link; DTVP-Details „erfordern Anmeldung“. |
| Downloads mit eigenen Portalzugängen | **Nein** | Keine Login-Funktion für Portale. |
| PDF-Auswertung | Teilweise | `pdf-parse` vorhanden, aber nur für Förderprogramme genutzt. |
| GAEB-Auswertung | **Nein** | |
| Täglicher Suchlauf | Ja | node-cron, Standard alle 8 Stunden, frei einstellbar. |
| E-Mail-Benachrichtigung | **Nein** (nur Datenfeld) | `notify_email` bei gespeicherten Suchen vorhanden, aber kein Mailversand. |
| Deutsche Oberfläche | Ja | Weitgehend deutsch. |
| Lokale KI | Ja | Ollama-Anbindung vorhanden (Standard `llama3.1:8b`). |

**kwb.tenders (R, MIT)** bringt die fehlenden Bausteine als Vorlage mit: Anbindungen an oeffentlichevergabe.de (OCDS-API), service.bund.de (RSS), Vergabemarktplätze NRW und Brandenburg, Berlin, Deutsche eVergabe, TED mit Suchfilter, außerdem Stichwort-/CPV-Relevanzbewertung mit YAML-Stichwortlisten und Ausschlusswörtern. Da R unter Windows für Sie ein zusätzliches System wäre, ist eine Übertragung nach JavaScript sinnvoller als eine direkte Einbindung.

## 5. Abhängigkeiten

| Paket | Zweck | Hinweis |
|---|---|---|
| fastify 5, @fastify/static 8 | Webserver | Updates nötig (Sicherheitslücken) |
| better-sqlite3 11 | Datenbank | Native Erweiterung; unter Windows gibt es fertige Binärdateien, notfalls Build-Tools nötig |
| axios 1.x | HTTP | Update nötig |
| cheerio | HTML-Auswertung | ok |
| playwright | Browser-Automatisierung | lädt Chromium (~150 MB) |
| node-cron 3 | Zeitplan | Update auf 4.x empfohlen |
| pdf-parse 2 | PDF-Text | ok |
| dotenv | Konfiguration | ok |
| *cookie* | wird importiert, steht aber **nicht** in `package.json` | funktioniert nur zufällig über eine Unterabhängigkeit von fastify |

Alle Pakete sind kostenlos (MIT/Apache/BSD). Keine Cloud-Dienste nötig.

## 6. Sicherheit

- `npm audit`: **8 Schwachstellen (6 hoch, 2 mittel)** in fastify, @fastify/static, axios, fast-uri, undici, brace-expansion, node-cron/uuid. Alle durch Updates behebbar.
- Server lauscht standardmäßig auf `0.0.0.0` (ganzes Netzwerk). Für den Büro-PC auf `127.0.0.1` stellen.
- Standard-Token in `.env.example` ist `bitte-aendern-mich`; Token-Vergleich nicht zeitkonstant. Für lokalen Betrieb akzeptabel, wenn ein starkes Token gesetzt wird.
- Links aus Portaldaten werden HTML-escaped, aber nicht auf `javascript:`-URLs geprüft (geringes Risiko).
- SSRF-Schutz für frei eingetragene Quellen vorhanden.
- Repository enthält Entwicklungsreste (`validate*.cjs`, `zim-pw2.mjs` mit festem Linux-Pfad, Validierungsausgaben). Harmlos, aber Hinweis auf frühen Stand. Nur zwei Commits, keine Releases, Ein-Personen-Projekt ohne erkennbare Pflege.
- Kein Schadcode, keine Telemetrie, keine versteckten Netzwerkaufrufe gefunden.

## 7. Testergebnisse in der Cloud-Umgebung

| Test | Ergebnis |
|---|---|
| `npm ci` + native SQLite-Erweiterung | erfolgreich (Node 22) |
| Automatische Tests (`npm test`) | **135 von 140 bestanden.** Die 5 Fehler sind veraltete Testdaten: feste Fristen aus 2026 liegen inzwischen in der Vergangenheit, Status ist dann „closed“ statt „open“. Kein Programmfehler. |
| Server-Start, Dashboard, API (Health, Login, Statistik, Quellen, Crawl starten) | funktioniert |
| Echte Portalabfragen (TED, DTVP) | **nicht möglich**: Die Cloud-Umgebung erlaubt nur Paketquellen, alle Vergabeportale werden vom Netzwerkfilter blockiert (HTTP 403). |

Echte Ausschreibungen lassen sich deshalb erst auf Ihrem Windows-PC prüfen oder nachdem die Netzwerkfreigabe der Cloud-Umgebung erweitert wurde (Projekteinstellungen → Umgebung → Netzwerkzugriff, z. B. `api.ted.europa.eu`, `oeffentlichevergabe.de`, `www.dtvp.de`, `www.evergabe-online.de`, `nominatim.openstreetmap.org`).

## 8. Installation auf dem Windows-PC (Vorbereitung)

Benötigt (alles kostenlos):

1. **Node.js 22 LTS** (nodejs.org, Windows-Installer `.msi`)
2. **Git für Windows** (optional, zum Aktualisieren)
3. Optional für lokale KI: **Ollama für Windows**, Modell z. B. `qwen2.5:7b` oder `llama3.1:8b` (benötigt ca. 8 GB RAM)

Ablauf: Projekt herunterladen → `npm install` → `npx playwright install chromium` → `.env` anlegen → `start.bat` doppelklicken → Browser öffnet `http://localhost:3000`.
Die Startdatei `start.bat` wird mit der ersten Entwicklungsphase erstellt. Installation und Test auf Ihrem PC laufen über eine Sitzung auf Ihrem Gerät (Remote Control), die Sie in der Claude-App freigeben.

## 9. Vorgeschlagener Phasenplan

1. **Grundlage festlegen** (abhängig von der Lizenzentscheidung, siehe Abschnitt 2).
2. **Datenquellen:** TED mit Filter Deutschland + Bau-CPV (45410000 Putz, 45421141/45324000 Trockenbau, 45321000 Wärmedämmung, 45262100 Gerüst, 45443000 Fassade), oeffentlichevergabe.de (OCDS), service.bund.de (RSS), DTVP mit Suchbegriffen, eVergabe, Vergabemarktplätze NRW/BB (Logik aus kwb.tenders).
3. **Relevanz 0–100:** Stichwort- und CPV-Punkte, Ausschlusswörter, Entfernung, Frist; optional Feinbewertung mit lokaler KI (Ollama).
4. **Entfernung:** Geocoding des Leistungsorts über Nominatim/OpenStreetMap (kostenlos, mit Zwischenspeicher), Luftlinie zum Betriebssitz.
5. **Unterlagen:** Direktlinks, PDF-Textauswertung, GAEB-Auswertung (X81/X83/X84 als XML, D83 als Text) mit Positionsliste und Mengen.
6. **Downloads mit eigenen Zugängen:** nur wo die Portal-AGB automatisierten Zugriff erlauben; Zugangsdaten nur lokal in der Windows-Anmeldeinformationsverwaltung bzw. `.env`.
7. **Täglicher Suchlauf + E-Mail** (nodemailer über Ihr vorhandenes Postfach, SMTP).
8. **Windows-Startdatei, Dokumentation, Installation und Test auf Ihrem PC.**
