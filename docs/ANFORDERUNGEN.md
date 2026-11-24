# Rechtliche Anforderungen an E-Rechnungen / XRechnung in Deutschland

Stand: November 2026. Grundlage für die Prüfregeln dieses Tools. **Keine Steuerberatung.** Im Zweifel bitte Steuerberatung hinzuziehen.

## 1. Rechtsgrundlagen

| Quelle | Inhalt |
|---|---|
| **§ 14 UStG** (geändert durch das Wachstumschancengesetz) | Definition der E-Rechnung, Pflichtangaben (Abs. 4), Übermittlung |
| **§ 27 Abs. 38 UStG** | Übergangsregeln für die Ausstellungspflicht |
| **§ 14a UStG** | Zusatzangaben in Sonderfällen (Reverse Charge, innergemeinschaftliche Lieferung) |
| **§§ 31, 33, 34a UStDV** | Rechnungsbestandteile, Kleinbetragsrechnung, Fahrausweise, Kleinunternehmer |
| **BMF-Schreiben** vom 15.10.2024, 15.10.2025 und 15.10.2026 | Auslegung durch die Finanzverwaltung (Formate, Validierung, Fehlerarten, Sonderfälle wie Bauleistungen und Abschlagsrechnungen) |
| **EN 16931-1:2017** | Europäisches semantisches Datenmodell der E-Rechnung |
| **XRechnung 3.0.x** (KoSIT) | Deutsche Ausprägung (CIUS) der EN 16931 mit den Zusatzregeln BR-DE-* |
| **E-Rechnungsverordnung (ERechV)** und Landesrecht | E-Rechnung an öffentliche Auftraggeber (B2G), Leitweg-ID |
| **GoBD / § 147 AO / § 14b UStG** | Aufbewahrung (8 Jahre für Rechnungen), Unveränderbarkeit |

## 2. Was ist eine E-Rechnung? (§ 14 Abs. 1 UStG)

Eine Rechnung in einem **strukturierten elektronischen Format**, das elektronisch verarbeitet werden kann und der **EN 16931** entspricht. Gültig sind:

- **XRechnung** (UBL 2.1 oder UN/CEFACT CII) – dieses Tool erzeugt XRechnung im UBL-Format.
- **ZUGFeRD / Factur-X** ab Version 2.0.1 in den Profilen EN 16931, EXTENDED oder XRECHNUNG. MINIMUM und BASIC-WL sind keine E-Rechnungen.

Eine reine PDF-Datei ist **keine** E-Rechnung, sondern eine „sonstige Rechnung“. Bei hybriden Formaten (ZUGFeRD) gilt der XML-Teil.

## 3. Wer muss wann? (Übergangsfristen, § 27 Abs. 38 UStG)

| Zeitraum | Empfang | Ausstellung (inländische B2B-Umsätze) |
|---|---|---|
| ab 01.01.2025 | **Alle Unternehmen müssen E-Rechnungen empfangen können** | Papier und sonstige elektronische Rechnungen noch zulässig |
| 01.01.2025 – 31.12.2026 | – | Papier/PDF weiter zulässig (PDF nur mit Zustimmung des Empfängers) |
| 01.01.2027 – 31.12.2027 | – | **E-Rechnung Pflicht bei Vorjahresumsatz > 800.000 €**. Kleinere Unternehmen dürfen noch Papier/PDF verwenden. EDI-Verfahren sind noch zulässig. |
| ab 01.01.2028 | – | **E-Rechnung Pflicht für alle** inländischen B2B-Umsätze |

Hinweis: Im Lobbyregister findet sich ein Vorschlag, die 2027er Stufe auf 2028 zu verschieben. Nach aktuellem Stand ist das nicht beschlossen.

**Ausnahmen von der E-Rechnungspflicht** (eine E-Rechnung ist trotzdem zulässig):

- **Kleinbetragsrechnungen bis 250 € brutto** (§ 33 UStDV)
- **Fahrausweise** (§ 34 UStDV)
- **Kleinunternehmer nach § 19 UStG** für die eigene Ausstellung (§ 34a UStDV). Empfangen müssen sie E-Rechnungen trotzdem können.
- Steuerfreie Umsätze nach § 4 Nr. 8–29 UStG
- Rechnungen an Privatpersonen (B2C) und ins Ausland

**Öffentliche Auftraggeber (B2G):** Hier ist die XRechnung schon länger Pflicht (Bund seit 27.11.2020, Länder je nach Landesrecht). Die **Leitweg-ID** gehört in die Käuferreferenz (BT-10).

## 4. Pflichtangaben nach § 14 Abs. 4 UStG und ihre Abbildung in der XRechnung

| Nr. | Pflichtangabe | XRechnung-Feld | Im Tool geprüft |
|---|---|---|---|
| 1 | Vollständiger Name und Anschrift des leistenden Unternehmers | BT-27, BT-35, BT-37, BT-38, BT-40 | ✔ |
| 1 | Vollständiger Name und Anschrift des Leistungsempfängers | BT-44, BT-50, BT-52, BT-53, BT-55 | ✔ |
| 2 | Steuernummer **oder** USt-IdNr. des leistenden Unternehmers | BT-32 / BT-31 | ✔ inkl. Prüfziffer der USt-IdNr. |
| 3 | Ausstellungsdatum | BT-2 | ✔ |
| 4 | Fortlaufende, einmalige Rechnungsnummer | BT-1 | ✔ (Vorhandensein) |
| 5 | Menge und handelsübliche Bezeichnung der Leistung | BT-129, BT-130, BT-153 | ✔ |
| 6 | Zeitpunkt der Lieferung/Leistung bzw. Leistungszeitraum | BT-72 oder BG-14 (BT-73/74) | ✔ |
| 7 | Entgelt, nach Steuersätzen und Befreiungen aufgeschlüsselt, sowie Entgeltminderungen | BG-23, BT-20 (Skonto) | ✔ automatisch berechnet |
| 8 | Steuersatz und Steuerbetrag **oder** Hinweis auf die Steuerbefreiung | BT-118/119, BT-117, BT-120/121 | ✔ |
| 9 | Hinweis auf die Aufbewahrungspflicht des Empfängers (§ 14b Abs. 1 S. 5 UStG) | BT-22 (Bemerkung) | manuell (nur bei Leistungen an Privatpersonen im Zusammenhang mit Grundstücken) |
| 10 | Angabe „Gutschrift“ bei Abrechnung durch den Leistungsempfänger | BT-3 = 389 + Bemerkung | ✔ automatisch |

**Sonderfälle (§ 14a UStG):**

- **Reverse Charge (§ 13b UStG):** Hinweis „Steuerschuldnerschaft des Leistungsempfängers“ und USt-IdNr. des Empfängers. Abbildung: Kategorie **AE**, 0 %, Befreiungsgrund.
- **Innergemeinschaftliche Lieferung:** USt-IdNr. von Lieferer **und** Empfänger sowie Hinweis auf die Steuerfreiheit. Abbildung: Kategorie **K**, Lieferland.
- **Ausfuhr:** Kategorie **G** mit Hinweis.
- **Kleinunternehmer:** Kategorie **E** mit Hinweis auf § 19 UStG.

## 5. Zusätzliche Pflichtfelder der XRechnung 3.0 (über das UStG hinaus)

| Regel | Anforderung |
|---|---|
| BR-DE-15 | **Käuferreferenz (BT-10)** ist Pflicht: bei Behörden die Leitweg-ID, sonst z. B. Bestellnummer |
| BT-34 / BT-49 | **Elektronische Adresse** von Verkäufer und Käufer (z. B. E-Mail, Schema „EM“, oder Leitweg-ID, Schema „0204“) |
| BR-DE-2, -5, -6, -7 | **Ansprechpartner des Verkäufers** mit Name, Telefon und E-Mail |
| BR-DE-3, -4, -8, -9 | Ort und PLZ von Verkäufer und Käufer |
| BR-DE-1 | Zahlungsanweisungen (BG-16) |
| BR-DE-23 / -24 / -25 | Je nach Zahlungsart: IBAN (Überweisung), Kartendaten oder Lastschriftmandat |
| BR-DE-19 / -20 | IBAN muss gültig sein |
| BR-DE-30 / -31 | Lastschrift: Gläubiger-ID und IBAN des Zahlers |
| BR-DE-16 | Steuernummer oder USt-IdNr. des Verkäufers |
| BR-DE-17 | Rechnungsart nur 326, 380, 381, 384, 389, 875, 876, 877 |
| BR-DE-18 | Skonto im Format `#SKONTO#TAGE=14#PROZENT=2.00#` in BT-20 |
| BR-DE-26 | Korrigierte Rechnung (384) mit Bezug auf die Ursprungsrechnung |
| BR-DE-27 / -28 | Telefonnummer (mind. 3 Ziffern) und E-Mail-Format |

Dazu kommen die EN-16931-Kernregeln (z. B. Rechenregeln BR-CO-*, Steuerkategorieregeln BR-S/AE/K/G/E/O-*).

## 6. Übermittlung, Aufbewahrung, Fehlerbehandlung

- **Übermittlung:** formfrei, z. B. per E-Mail, Download-Portal, Peppol oder API. Für Behörden gelten die Portale von Bund und Ländern (ZRE, OZG-RE, Peppol).
- **Aufbewahrung:** Die **XML-Datei im Originalformat** muss unveränderbar und maschinell auswertbar aufbewahrt werden: 8 Jahre (§ 14b UStG, § 147 AO in der Fassung des BEG IV), GoBD-konform. Ein Ausdruck reicht nicht.
- **Fehler (BMF-Schreiben 2025):** Wenn eine E-Rechnung nicht EN-16931-konform ist (Formatfehler), liegt keine E-Rechnung vor. Inhaltliche Fehler bei Pflichtangaben gefährden den Vorsteuerabzug des Empfängers. Deshalb prüft das Tool vor dem Export.

## 7. Umsetzung im Tool

- Ausgabeformate (auswählbar):
  - **XRechnung 3.0, Syntax UBL 2.1** (`Invoice`, bei 381 `CreditNote`)
  - **ZUGFeRD 2.3 / Factur-X** in den Profilen **EN 16931** und **XRECHNUNG**: PDF/A-3 mit eingebetteter `factur-x.xml` (CII D16B, AFRelationship „Alternative“, XMP-Metadaten mit Factur-X-Erweiterungsschema, sRGB-OutputIntent). Beide Profile gelten nach § 14 UStG als E-Rechnung; MINIMUM und BASIC-WL werden bewusst nicht angeboten.
  - CustomizationID: `urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0`
  - ProfileID: `urn:fdc:peppol.eu:2017:poacc:billing:01:1.0`
- Eingang:
  - **PDF:** Eine eingebettete ZUGFeRD-, Factur-X- oder XRechnung-XML wird verlustfrei übernommen. Sonst wird der Text ausgewertet und das Original-PDF optional als Anlage (BT-125) eingebettet.
  - **XML:** XRechnung (UBL oder CII) bzw. ZUGFeRD/Factur-X (CII)
- Der Export ist gesperrt, solange Fehler bestehen. Beim ZUGFeRD-Profil EN 16931 gelten die XRechnung-Zusatzregeln (BR-DE) nur als Hinweise.
- **Schluss- und Abschlagsrechnungen** (§ 14 Abs. 5 UStG): Rechnungsarten 875/876/877, bereits gezahlte Beträge als BT-113. Die Übersicht der Abschläge mit Entgelt und Steuer wird in der Bemerkung (BT-22) übermittelt. Skonto kann mit Basisbetrag angegeben werden (`#BASISBETRAG=…#`).
- Empfehlung: Die fertige Datei zusätzlich mit dem offiziellen **KoSIT-Validator** prüfen.

## Quellen

- [IHK Stuttgart – Ende der Übergangsfrist für Unternehmen > 800.000 € Umsatz](https://www.ihk.de/stuttgart/fuer-unternehmen/recht-und-steuern/steuerrecht/steuermeldungen/e-rechnung-5864496)
- [IHK Köln – BMF-Schreiben zur E-Rechnung vom 15.10.2025](https://www.ihk.de/koeln/hauptnavigation/recht-steuern/steuern/bmf-schreiben-zur-e-rechnung-vom-15-10-2025-6774012)
- [IHK Gera – Nächste Stufe der E-Rechnung](https://www.ihk.de/gera/recht-und-steuern/aktuelles-rechtundsteuern/naechste-stufe-der-e-rechnung-7216566)
- [PwC – Drittes BMF-Schreiben zur elektronischen Rechnung](https://blogs.pwc.de/de/steuern-und-recht/article/257709/drittes-schreiben-des-bundesfinanzministeriums-zur-elektronischen-rechnung/)
- [E-Rechnung Bund – XRechnung-Versionen](https://e-rechnung-bund.de/en/new-version-xrechnung-standard-3-0-1-available/)
- [KoSIT XRechnung-Schematron (BR-DE-Regeln)](https://github.com/itplr-kosit/xrechnung-schematron)
- [VATupdate – XRechnung 4.0 Pre-Release (Okt. 2026)](https://www.vatupdate.com/2026/10/04/kosit-releases-xrechnung-4-0-pre-release-with-major-billing-updates/)

Ausblick: **XRechnung 4.0** (auf Basis von EN 16931-1:2026) liegt als Vorabversion vor. Die finale Fassung wird für 2027 erwartet, danach folgt eine Übergangszeit. Das Tool sollte dann aktualisiert werden.
