# Änderungsprotokoll

## 0.1.0 – 20.10.2026 · Phase 1: eigene Basis

Entscheidung: Weil `togugg/tender-crawler` keine Lizenz hat, entsteht eine eigene Basis. Bausteine aus
`kwb.tenders` (MIT) wurden nach JavaScript übertragen; beim Autor von tender-crawler wird eine Lizenz angefragt.

Neu:
- Datenquellen TED (EU, gefiltert auf Deutschland und Bau-CPV), Datenservice Öffentlicher Einkauf
  (oeffentlichevergabe.de, OCDS-Tagesexport) und service.bund.de (RSS).
- Relevanzbewertung 0–100 mit Gewerken Stuck & Putz, WDVS & Fassade, Trockenbau, Gerüstbau; Suchbegriffe
  in `gewerke.json` frei anpassbar; nachvollziehbare Aufschlüsselung je Ausschreibung.
- Entfernung zum Betriebssitz über OpenStreetMap mit dauerhaftem Zwischenspeicher.
- Unterlagen: Direktlinks, Download frei zugänglicher Unterlagen, manuelles Hinzufügen (PDF, GAEB, ZIP),
  PDF-Textauswertung, GAEB-XML- und GAEB-90-Leser.
- Täglicher Suchlauf (im Programm oder über die Windows-Aufgabenplanung), E-Mail-Zusammenfassung über SMTP.
- Optionale lokale KI über Ollama.
- Deutschsprachiges Dashboard mit Filtern, Detailansicht, Bearbeitungsstatus und Notizen.
- Windows-Startdateien `start.bat`, `suchlauf-jetzt.bat`, `taeglicher-suchlauf-einrichten.bat`.
- 25 automatische Tests mit Beispieldaten.

Bekannte Grenzen:
- Die Portalabfragen sind mit nachgebauten Beispieldaten getestet. Der Abgleich mit echten Ausschreibungen steht noch
  aus, weil die Cloud-Testumgebung die Portale sperrt; er erfolgt auf dem Windows-PC.
- Die TED-Zusatzfelder für Ort und Unterlagen (`buyer-city`, `buyer-post-code`, `document-url-lot`) sind nicht
  verifiziert; lehnt die API sie ab, sucht das Programm automatisch ohne sie weiter.
- GAEB 90 (D83) wird vereinfacht gelesen; mit echten Dateien prüfen.

Geplant für die nächsten Phasen:
- Weitere Portale: Deutsches Vergabeportal (DTVP), Vergabemarktplätze NRW und Brandenburg, Deutsche eVergabe,
  eVergabe des Bundes, Berlin (Browser-gestützt, nach Vorbild von kwb.tenders).
- Automatisches Anmelden mit Ihren Portalzugängen für den Unterlagen-Download, nur wo die Nutzungsbedingungen des
  Portals das erlauben; Zugangsdaten bleiben lokal.
