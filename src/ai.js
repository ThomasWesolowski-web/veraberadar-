// Optionale lokale KI über Ollama (kostenlos, läuft auf dem eigenen PC, keine Daten verlassen den Rechner).
import config from './config.js';

export function buildPrompt(tender) {
  return `Du bewertest öffentliche Ausschreibungen für einen Stuckateurmeisterbetrieb (${config.firmaName}).
Leistungen des Betriebs: Innen- und Außenputz, Stuck, Wärmedämmverbundsysteme (WDVS) und Fassadensanierung, Trockenbau, Gerüstbau.
Bewerte, wie gut die Ausschreibung zu diesem Betrieb passt (0 = gar nicht, 100 = genau unser Gewerk).
Antworte ausschließlich mit JSON: {"punkte": <0-100>, "zusammenfassung": "<höchstens zwei Sätze auf Deutsch>"}

Titel: ${tender.titel}
Auftraggeber: ${tender.vergabestelle || 'unbekannt'}
Ort: ${[tender.plz, tender.ort].filter(Boolean).join(' ') || 'unbekannt'}
CPV: ${(tender.cpv || []).join(', ') || 'keine'}
Beschreibung: ${String(tender.beschreibung || '').slice(0, 3000)}`;
}

export function parseAnswer(raw) {
  const match = String(raw || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[0]);
    const punkte = Math.max(0, Math.min(100, Math.round(Number(data.punkte))));
    if (!Number.isFinite(punkte)) return null;
    return { punkte, zusammenfassung: String(data.zusammenfassung || '').slice(0, 600) };
  } catch {
    return null;
  }
}

export async function rateWithAi(tender) {
  const response = await fetch(`${config.ki.url.replace(/\/$/, '')}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.ki.modell, prompt: buildPrompt(tender), stream: false, format: 'json', options: { temperature: 0.1 } }),
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new Error(`Ollama antwortet mit HTTP ${response.status}`);
  const data = await response.json();
  return parseAnswer(data.response);
}

export async function aiStatus() {
  if (!config.ki.aktiv) return { aktiv: false };
  try {
    const response = await fetch(`${config.ki.url.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const data = await response.json();
    const modelle = (data.models || []).map((m) => m.name);
    return { aktiv: true, erreichbar: true, modell: config.ki.modell, modellVorhanden: modelle.some((m) => m.startsWith(config.ki.modell)) };
  } catch {
    return { aktiv: true, erreichbar: false, modell: config.ki.modell };
  }
}
