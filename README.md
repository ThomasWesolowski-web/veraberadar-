# XRechnung-Generator

Tool, mit dem Sie **E-Rechnungen** erstellen und prüfen. Es läuft im Browser oder als Windows-Programm. Die Daten kommen aus einer bestehenden **PDF-** oder **XML-Rechnung** oder werden von Hand erfasst.

Ausgabeformate (auswählbar):
- **XRechnung 3.0**: XML-Datei, Syntax UBL 2.1. Pflichtformat für öffentliche Auftraggeber.
- **ZUGFeRD 2.3, Profil EN 16931 (Comfort)**: PDF/A-3 mit eingebetteter `factur-x.xml` (CII).
- **ZUGFeRD 2.3, Profil XRECHNUNG**: wie oben, erfüllt zusätzlich alle XRechnung-Regeln.

Für den sichtbaren Teil der ZUGFeRD-PDF gibt es zwei Wege: Die **Original-PDF** wird um die Daten ergänzt (ein reiner Rechteschutz ohne Öffnungspasswort wird dafür entfernt), oder die PDF wird **neu aus den Daten erzeugt** (Schrift eingebettet).

Alle Daten bleiben im Browser. Es gibt kein Backend und keinen Upload.

## Funktionen

- **Import PDF**
  - Ist eine ZUGFeRD-, Factur-X- oder XRechnung-XML eingebettet, wird sie vollständig übernommen.
  - Sonst wird der Text mit pdf.js ausgelesen. Das Tool erkennt dann Rechnungsnummer, Datumsangaben, Leistungszeitraum, Adressen, USt-IdNr., Steuernummer, IBAN/BIC, Leitweg-ID, Skonto, Positionen und Summen sowie Reverse Charge und Kleinunternehmer.
  - Optional wird das Original-PDF als Anlage (BT-125) in die XRechnung eingebettet.
- **Import XML:** XRechnung (UBL oder CII) und ZUGFeRD/Factur-X (CII). Damit lässt sich ZUGFeRD in XRechnung/UBL umwandeln.
- **Formular** mit allen relevanten Feldern (BT-Nummern angegeben) und automatischer Berechnung nach EN 16931.
- **Live-Prüfung** gegen
  - die Pflichtangaben nach **§ 14 Abs. 4 UStG** und § 14a UStG,
  - **EN-16931-Kernregeln** (Steuerkategorien S, Z, E, AE, K, G, O; Summen; Datumsangaben),
  - **XRechnung-Regeln BR-DE-1 bis BR-DE-31** (Käuferreferenz, Ansprechpartner, Zahlungsarten, Skonto-Syntax, IBAN-Prüfziffer, Leitweg-ID-Prüfziffer usw.).
- **Rabatte und Zuschläge auf Rechnungsebene** (prozentual oder als Betrag), **Abschlagszahlungen** (bereits gezahlt) und **Skonto mit Basisbetrag**. Damit lassen sich Schluss- und Abschlagsrechnungen abbilden.
- **Export** als XRechnung (XML) oder ZUGFeRD (PDF). Der Download ist gesperrt, solange Fehler bestehen. Zusätzlich gibt es einen Prüfbericht als Text.
- Die eigenen **Stammdaten** (Firma, Kontakt, Bank) lassen sich im Browser speichern.

Die rechtlichen Anforderungen sind in [docs/ANFORDERUNGEN.md](docs/ANFORDERUNGEN.md) zusammengefasst.

## Windows-Programm (Windows 10/11)

Das Tool gibt es auch als installierbares Desktop-Programm (Electron, 64 Bit).

**Installieren**
1. `XRechnung-Generator-Setup-<Version>.exe` ausführen. Es sind keine Administratorrechte nötig; installiert wird nach `%LOCALAPPDATA%\Programs\XRechnung-Generator`.
2. Der Installer legt Verknüpfungen im Startmenü und auf dem Desktop an.
3. Deinstallieren über *Einstellungen → Apps* oder `Deinstallieren.exe` im Programmordner.

Der Installer ist nicht code-signiert. Windows SmartScreen zeigt deshalb beim ersten Start „Der Computer wurde durch Windows geschützt“. Über *Weitere Informationen → Trotzdem ausführen* geht es weiter.

Gespeicherte Stammdaten liegen unter `%APPDATA%\xrechnung-generator` und bleiben beim Deinstallieren erhalten.

**Rechnungen direkt aus WinWorker oder einer anderen Handwerkersoftware übergeben**
- **Eingangsordner** (empfohlen): Das Programm überwacht `Dokumente\XRechnung-Generator\Eingang`. Jede PDF oder XML, die dort gespeichert wird, liest es sofort automatisch ein. Danach verschiebt es die Datei nach `Eingang\verarbeitet`. In WinWorker stellen Sie dafür den Speicherort für PDF-Rechnungen (Export, PDF-Ablage oder „Drucken als PDF“) auf diesen Ordner. Das Programm muss dabei laufen.
- **Senden an:** Rechtsklick auf eine PDF → *Senden an* → *XRechnung-Generator*.
- **Öffnen mit:** Rechtsklick auf eine PDF → *Öffnen mit* → *XRechnung-Generator*.
- **Programmaufruf:** `XRechnung-Generator.exe "C:\Pfad\Rechnung.pdf"`. Das geht auch, wenn das Programm schon läuft: Die Datei wird dann an das offene Fenster übergeben.

**Installer selbst bauen**
- Automatisch: Bei jedem Push baut GitHub Actions den Installer (*Actions → Windows-Installer bauen → Artifacts*).
- Lokal: `npm install`, dann `npm run dist:win`. Dafür muss NSIS installiert sein (Linux: `apt install nsis`, Windows: [nsis.sourceforge.io](https://nsis.sourceforge.io)). Ergebnis: `dist/XRechnung-Generator-Setup-<Version>.exe`.
- Desktop-App ohne Installer testen: `npm run app`.

## Starten (Browser-Version)

Es gibt keinen Build-Schritt. Wegen der ES-Module muss die Seite über einen Webserver laufen:

```bash
npm start            # http://localhost:8080
# oder
python3 -m http.server 8080
```

Deployment: Jeder statische Hoster funktioniert, z. B. Netlify (`netlify.toml` liegt bei).

## Tests

```bash
npm install
npm test
```

Offizielle Prüfung mit den Schematron-Regeln von CEN (EN 16931) und KoSIT (XRechnung) sowie dem CII-Schema: `npm run validate:official` (lädt die Regeln herunter; benötigt Python). Die Prüfung läuft auch automatisch in GitHub Actions.

Die Tests decken ab: Berechnung und Rundung, Prüfziffern (IBAN, USt-IdNr., Leitweg-ID), Prüfregeln, UBL-Erzeugung (Invoice und CreditNote, Elementreihenfolge, Maskierung), Rundreise Export → Import, ZUGFeRD-Import und PDF-Texterkennung.

## Grenzen

- Die PDF-Texterkennung ist heuristisch. Erkannte Werte sind ein Vorschlag und müssen geprüft werden. Gescannte PDFs ohne Textebene brauchen vorher OCR.
- Die eingebauten Prüfregeln bilden die wichtigsten Regeln nach. Sie ersetzen nicht den offiziellen [KoSIT-Validator](https://github.com/itplr-kosit/validator-configuration-xrechnung), der für die verbindliche Prüfung empfohlen wird.
- ZUGFeRD aus einer Original-PDF: Die eingebetteten Daten sind korrekt und geprüft. Ob die PDF vollständig PDF/A-3-konform ist, hängt aber von der Original-PDF ab, zum Beispiel davon, ob alle Schriften eingebettet sind. Für maximale Konformität „PDF neu erzeugen“ wählen.
- Nicht unterstützt: Rabatte auf Positionsebene (werden in den Einzelpreis eingerechnet), Fremdwährungen mit Steuerwährung (BT-6), Steuervertreter (BG-11) und Unterpositionen.

## Aufbau

| Datei | Zweck |
|---|---|
| `index.html`, `css/style.css`, `js/app.js` | Oberfläche |
| `js/model.js` | Datenmodell, Codelisten, Berechnung, Prüfziffern |
| `js/validate.js` | Prüfregeln (UStG, EN 16931, XRechnung) |
| `js/ubl.js` | Erzeugung XRechnung UBL 2.1 |
| `js/cii.js` | Erzeugung ZUGFeRD/Factur-X CII |
| `js/zugferd.js` | ZUGFeRD-PDF (PDF/A-3 mit factur-x.xml), PDF-Layout |
| `js/pdf-decrypt.js` | Entfernen eines reinen Rechteschutzes (RC4/AES) |
| `tools/` | Offizielle Validierung (Schematron/XSD) |
| `js/xml-import.js` | Import UBL/CII |
| `js/pdf-import.js`, `js/pdf-text.js` | PDF-Import (pdf.js) und Texterkennung |
| `vendor/pdfjs/` | pdf.js 4.10.38 (Apache-2.0) |
| `vendor/pdf-lib/` | pdf-lib 1.17.1 und fontkit (MIT) |
| `vendor/fonts/` | Liberation Sans (SIL OFL 1.1), sRGB-ICC-Profil (Zlib) |
| `electron/main.cjs`, `electron/preload.cjs` | Desktop-Hülle für Windows (Dateiübergabe, Eingangsordner) |
| `installer/` | NSIS-Installer-Skript und Build-Skript |
| `build/` | Programm-Icon |
