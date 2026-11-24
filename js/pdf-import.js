// PDF-Import im Browser mit pdf.js:
// 1. Eingebettete E-Rechnung (ZUGFeRD / Factur-X / XRechnung) wird bevorzugt übernommen.
// 2. Sonst wird der Text extrahiert und heuristisch ausgewertet.
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';
import { parseInvoiceText, itemsToLines } from './pdf-text.js';
import { importXml } from './xml-import.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const EMBEDDED_NAMES = /^(factur-x|zugferd-invoice|zugferd_invoice|xrechnung|order-x)\.xml$/i;

export function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * @param {ArrayBuffer} buffer
 * @param {string} filename
 */
export async function importPdf(buffer, filename) {
  const bytes = new Uint8Array(buffer);
  const base64 = bytesToBase64(bytes);
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;

  // 1) eingebettete XML-Rechnung?
  let attachments = null;
  try { attachments = await pdf.getAttachments(); } catch { attachments = null; }
  if (attachments) {
    for (const att of Object.values(attachments)) {
      const name = att.filename || '';
      if (EMBEDDED_NAMES.test(name) || /\.xml$/i.test(name)) {
        const xml = new TextDecoder('utf-8').decode(att.content);
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        if (!doc.getElementsByTagName('parsererror').length) {
          try {
            const res = importXml(doc);
            return {
              source: `Eingebettete E-Rechnung (${name}, ${res.format})`,
              invoice: res.invoice,
              found: ['Vollständige strukturierte Daten aus eingebetteter XML übernommen'],
              warnings: [],
              pdfBase64: base64,
            };
          } catch { /* kein Rechnungs-XML – weiter mit Text */ }
        }
      }
    }
  }

  // 2) Textextraktion
  const allLines = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const { width } = page.getViewport({ scale: 1 });
    allLines.push(...itemsToLines(content.items, width));
  }
  const text = allLines.join('\n');
  if (text.replace(/\s/g, '').length < 30) {
    return {
      source: 'PDF ohne Textebene',
      invoice: null,
      found: [],
      warnings: ['Die PDF enthält keinen auslesbaren Text (vermutlich ein Scan). Bitte die Daten manuell erfassen oder die PDF vorher per OCR durchsuchbar machen.'],
      pdfBase64: base64,
      text,
    };
  }
  const res = parseInvoiceText(text);
  return { source: `Textauswertung (${filename})`, ...res, pdfBase64: base64, text };
}
