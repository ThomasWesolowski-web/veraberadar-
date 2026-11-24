# XRechnung-Generator

Browserbasiertes Tool, mit dem Sie **E-Rechnungen im Format XRechnung 3.0** (EN 16931, Syntax UBL 2.1) erstellen und prüfen. Die Daten kommen aus einer bestehenden **PDF-** oder **XML-Rechnung** oder werden von Hand erfasst.

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
- **Export** der XRechnung als XML. Der Download ist gesperrt, solange Fehler bestehen. Zusätzlich gibt es einen Prüfbericht als Text.
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

Die Tests decken ab: Berechnung und Rundung, Prüfziffern (IBAN, USt-IdNr., Leitweg-ID), Prüfregeln, UBL-Erzeugung (Invoice und CreditNote, Elementreihenfolge, Maskierung), Rundreise Export → Import, ZUGFeRD-Import und PDF-Texterkennung.

## Grenzen

- Die PDF-Texterkennung ist heuristisch. Erkannte Werte sind ein Vorschlag und müssen geprüft werden. Gescannte PDFs ohne Textebene brauchen vorher OCR.
- Die eingebauten Prüfregeln bilden die wichtigsten Regeln nach. Sie ersetzen nicht den offiziellen [KoSIT-Validator](https://github.com/itplr-kosit/validator-configuration-xrechnung), der für die verbindliche Prüfung empfohlen wird.
- Nicht unterstützt: Zu- und Abschläge auf Beleg- und Positionsebene, Fremdwährungen mit Steuerwährung (BT-6) und Steuervertreter (BG-11).

## Aufbau

| Datei | Zweck |
|---|---|
| `index.html`, `css/style.css`, `js/app.js` | Oberfläche |
| `js/model.js` | Datenmodell, Codelisten, Berechnung, Prüfziffern |
| `js/validate.js` | Prüfregeln (UStG, EN 16931, XRechnung) |
| `js/ubl.js` | Erzeugung XRechnung UBL 2.1 |
| `js/xml-import.js` | Import UBL/CII |
| `js/pdf-import.js`, `js/pdf-text.js` | PDF-Import (pdf.js) und Texterkennung |
| `vendor/pdfjs/` | pdf.js 4.10.38 (Apache-2.0) |
| `electron/main.cjs` | Desktop-Hülle für Windows |
| `installer/` | NSIS-Installer-Skript und Build-Skript |
| `build/` | Programm-Icon |
