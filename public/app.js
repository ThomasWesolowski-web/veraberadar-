'use strict';

const $ = (id) => document.getElementById(id);
const GEWERKE = { putz_stuck: 'Stuck & Putz', wdvs: 'WDVS & Fassade', trockenbau: 'Trockenbau', geruest: 'Gerüstbau' };
const STATUS = { neu: 'Neu', interessant: 'Interessant', angeboten: 'Angebot abgegeben', abgelehnt: 'Abgelehnt' };
const QUELLEN = { ted: 'TED (EU)', oeffentlichevergabe: 'Öffentliche Vergabe', servicebund: 'service.bund.de' };
const PAGE = 50;
let offset = 0;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/** Nur http(s)-Links zulassen. */
function safeUrl(url) {
  return /^https?:\/\//i.test(String(url || '')) ? esc(url) : '#';
}
function datum(iso) {
  if (!iso) return '–';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}
function zeit(iso) {
  return iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–';
}
function tageBis(iso) {
  if (!iso) return null;
  return Math.floor((new Date(`${iso}T23:59:59`) - new Date()) / 86400000);
}
function punkteKlasse(p) {
  return p >= 60 ? 'gut' : p >= 35 ? 'mittel' : '';
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = localStorage.getItem('zugangstoken');
  if (token) headers['X-Zugangstoken'] = token;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.json);
  }
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401) {
    const neu = prompt('Bitte Zugangstoken eingeben:');
    if (neu) { localStorage.setItem('zugangstoken', neu); return api(path, options); }
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.fehler || `Fehler ${response.status}`);
  return data;
}

/* ---------- Status & Kacheln ---------- */
async function ladeStatus() {
  const s = await api('/api/status');
  $('firma').textContent = s.einstellungen.firma + (s.einstellungen.adresse ? ` · ${s.einstellungen.adresse}` : ' · Betriebssitz nicht eingetragen');
  $('k-relevant').textContent = s.statistik.relevant;
  $('k-offen').textContent = s.statistik.offen;
  $('k-neu').textContent = s.statistik.neuHeute;
  $('k-lauf').textContent = s.statistik.letzterLauf ? zeit(s.statistik.letzterLauf.gestartet) : 'noch keiner';
  $('lauf-meldung').textContent = s.suchlauf.meldung;
  $('btn-suchlauf').disabled = s.suchlauf.laeuft;
  zeigeEinstellungen(s);
  return s;
}

function zeigeEinstellungen(s) {
  const e = s.einstellungen;
  const zeilen = [
    ['Betrieb', e.firma],
    ['Betriebssitz (für Entfernung)', e.adresse || 'nicht eingetragen (FIRMA_ADRESSE)'],
    ['Täglicher Suchlauf', e.zeitplan ? `Zeitplan „${e.zeitplan}“ (solange der Vergaberadar läuft)` : 'aus'],
    ['Quellen', s.quellen.map((q) => q.name).join(', ')],
    ['Anzeige ab', `${e.mindestPunkteAnzeige} Punkten`],
    ['E-Mail', e.mailAktiv ? `an ${e.mailEmpfaenger.join(', ')} ab ${e.mindestPunkteMail} Punkten` : 'aus'],
    ['Max. Entfernung', e.maxEntfernungKm ? `${e.maxEntfernungKm} km` : 'keine Grenze'],
    ['Lokale KI', s.ki.aktiv ? (s.ki.erreichbar ? `Ollama, Modell ${s.ki.modell}${s.ki.modellVorhanden ? '' : ' (Modell noch nicht geladen)'}` : 'aktiviert, aber Ollama nicht erreichbar') : 'aus'],
  ];
  $('einstellungen').innerHTML = zeilen.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
}

/* ---------- Liste ---------- */
function filterParams() {
  const data = new FormData($('filter'));
  const params = new URLSearchParams();
  for (const [k, v] of data.entries()) if (v !== '') params.set(k, v);
  return params;
}

function eintragHtml(t) {
  const tage = tageBis(t.frist);
  const fristChip = t.frist ? `<span class="chip ${tage != null && tage < 7 ? 'rot' : tage != null && tage < 14 ? 'warn' : ''}">Frist ${datum(t.frist)}${tage != null && tage >= 0 ? ` (${tage} Tage)` : ''}</span>` : '';
  return `<article class="eintrag" data-id="${t.id}">
    <div class="punkte ${punkteKlasse(t.punkte)}" title="Relevanz 0–100">${t.punkte}</div>
    <div>
      <div class="titel">${esc(t.titel)}</div>
      <div class="meta">
        ${(t.gewerke || []).map((g) => `<span class="chip">${esc(GEWERKE[g] || g)}</span>`).join('')}
        ${fristChip}
        <span>${esc([t.plz, t.ort].filter(Boolean).join(' ') || 'Ort unbekannt')}${t.entfernung_km != null ? ` · ca. ${Math.round(t.entfernung_km)} km` : ''}</span>
        <span>${esc(t.vergabestelle || '')}</span>
        <span>${esc(QUELLEN[t.quelle] || t.quelle)}</span>
        ${t.status !== 'neu' ? `<span class="chip">${esc(STATUS[t.status] || t.status)}</span>` : ''}
        ${t.typ !== 'Ausschreibung' ? `<span class="chip warn">${esc(t.typ)}</span>` : ''}
      </div>
    </div>
  </article>`;
}

async function ladeListe(anhaengen = false) {
  if (!anhaengen) offset = 0;
  const params = filterParams();
  params.set('limit', PAGE);
  params.set('offset', offset);
  const data = await api(`/api/ausschreibungen?${params}`);
  const html = data.items.map(eintragHtml).join('');
  if (anhaengen) $('liste').insertAdjacentHTML('beforeend', html);
  else $('liste').innerHTML = html || '<p class="leise">Keine passenden Ausschreibungen. Starten Sie einen Suchlauf oder lockern Sie die Filter.</p>';
  offset += data.items.length;
  $('treffer').textContent = `${data.total} Ausschreibung${data.total === 1 ? '' : 'en'}`;
  $('mehr').classList.toggle('hidden', offset >= data.total);
}

/* ---------- Detail ---------- */
function dokumentHtml(d) {
  const a = d.auswertung || {};
  let inhalt = '';
  if (a.fehler || a.hinweis) inhalt += `<p class="leise">${esc(a.fehler || a.hinweis)}</p>`;
  if (a.art === 'pdf') {
    const treffer = Object.entries(a.gewerkTreffer || {}).map(([g, n]) => `${g}: ${n}×`).join(', ') || 'keine Gewerk-Begriffe gefunden';
    inhalt += `<p>${a.seiten ?? '?'} Seiten · ${esc(treffer)}</p>`;
    if (a.datumsangaben?.length) inhalt += `<p class="leise">Datumsangaben im Text: ${esc(a.datumsangaben.join(', '))}</p>`;
    if (a.auszug) inhalt += `<details><summary>Textauszug</summary><div class="beschreibung">${esc(a.auszug)}</div></details>`;
  }
  if (a.art === 'gaeb') {
    inhalt += `<p>${esc(a.format)}${a.phase ? ` (DA ${esc(a.phase)})` : ''} · ${a.anzahlPositionen} Positionen, davon ${a.passendePositionen} passend zu Ihren Gewerken</p>`;
    if (a.positionen?.length) {
      inhalt += `<details ${a.passendePositionen ? 'open' : ''}><summary>Positionen</summary><table class="positionen"><thead><tr><th>OZ</th><th>Kurztext</th><th>Menge</th><th>Einheit</th></tr></thead><tbody>${a.positionen.map((p) => `<tr class="${p.passend ? 'passend' : ''}"><td>${esc(p.oz)}</td><td>${esc(p.kurztext)}</td><td>${p.menge ?? ''}</td><td>${esc(p.einheit ?? '')}</td></tr>`).join('')}</tbody></table></details>`;
    }
  }
  return `<div class="abschnitt"><strong>${esc(d.dateiname)}</strong> <a class="leise" href="/api/dokumente/${d.id}/datei">herunterladen</a>${inhalt}</div>`;
}

async function zeigeDetail(id) {
  const t = await api(`/api/ausschreibungen/${id}`);
  const det = t.punkte_details || {};
  $('detail-inhalt').innerHTML = `
    <div class="detail-kopf">
      <div>
        <h2>${esc(t.titel)}</h2>
        <div class="meta">${(t.gewerke || []).map((g) => `<span class="chip">${esc(GEWERKE[g] || g)}</span>`).join('')}<span>${esc(t.typ)}</span><span>${esc(QUELLEN[t.quelle] || t.quelle)}</span></div>
      </div>
      <div class="punkte ${punkteKlasse(t.punkte)}">${t.punkte}</div>
    </div>
    <dl class="kv abschnitt">
      <dt>Auftraggeber</dt><dd>${esc(t.vergabestelle || '–')}</dd>
      <dt>Ort</dt><dd>${esc([t.plz, t.ort].filter(Boolean).join(' ') || '–')}${t.entfernung_km != null ? ` · ca. ${Math.round(t.entfernung_km)} km Luftlinie` : ''}</dd>
      <dt>Veröffentlicht</dt><dd>${datum(t.veroeffentlicht)}</dd>
      <dt>Angebotsfrist</dt><dd>${datum(t.frist)}</dd>
      <dt>CPV</dt><dd>${esc((t.cpv || []).join(', ') || '–')}</dd>
    </dl>
    <div class="abschnitt aktionen">
      <a class="btn primaer" href="${safeUrl(t.url)}" target="_blank" rel="noopener noreferrer">Bekanntmachung öffnen ↗</a>
      ${t.unterlagen_url ? `<a class="btn" href="${safeUrl(t.unterlagen_url)}" target="_blank" rel="noopener noreferrer">Vergabeunterlagen ↗</a><button class="btn" id="btn-laden">Unterlagen laden &amp; auswerten</button>` : ''}
      <label class="btn">Datei hinzufügen (PDF, GAEB, ZIP)<input type="file" id="datei" multiple hidden></label>
    </div>
    <div class="abschnitt">
      <h3>Bewertung: ${t.punkte} von 100 Punkten</h3>
      <p class="leise">Fachlich ${det.fachlich ?? 0}/70 · Entfernung ${det.entfernung ?? 0}/20 · Frist ${det.frist ?? 0}/10</p>
      <ul>${(det.gruende || []).map((g) => `<li>${esc(g)}</li>`).join('')}</ul>
      ${t.ki_zusammenfassung ? `<p><strong>KI-Einschätzung (${t.ki_punkte}/100):</strong> ${esc(t.ki_zusammenfassung)}</p>` : ''}
    </div>
    ${t.beschreibung ? `<div class="abschnitt"><h3>Beschreibung</h3><div class="beschreibung">${esc(t.beschreibung)}</div></div>` : ''}
    <div class="abschnitt"><h3>Unterlagen</h3><div id="dokumente">${(t.dokumente || []).map(dokumentHtml).join('') || '<p class="leise">Noch keine Unterlagen geladen.</p>'}</div><p id="dok-meldung" class="leise"></p></div>
    <div class="abschnitt">
      <h3>Bearbeitung</h3>
      <select id="d-status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <textarea id="d-notiz" placeholder="Notiz">${esc(t.notiz || '')}</textarea>
      <div class="aktionen"><button class="btn primaer" id="d-speichern">Speichern</button><button class="btn" id="d-schliessen">Schließen</button></div>
    </div>`;

  $('d-schliessen').onclick = () => $('detail').close();
  $('d-speichern').onclick = async () => {
    await api(`/api/ausschreibungen/${id}`, { method: 'PATCH', json: { status: $('d-status').value, notiz: $('d-notiz').value } });
    $('detail').close();
    ladeListe();
  };
  const meldung = (text) => { $('dok-meldung').textContent = text; };
  if ($('btn-laden')) {
    $('btn-laden').onclick = async (ev) => {
      ev.target.disabled = true;
      meldung('Unterlagen werden geladen und ausgewertet …');
      try { await api(`/api/ausschreibungen/${id}/unterlagen-laden`, { method: 'POST' }); zeigeDetail(id); } catch (error) { meldung(error.message); ev.target.disabled = false; }
    };
  }
  $('datei').onchange = async (ev) => {
    for (const file of ev.target.files) {
      meldung(`${file.name} wird ausgewertet …`);
      try {
        await api(`/api/ausschreibungen/${id}/datei`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream', 'X-Dateiname': encodeURIComponent(file.name) } });
      } catch (error) { meldung(`${file.name}: ${error.message}`); return; }
    }
    zeigeDetail(id);
  };
  if (!$('detail').open) $('detail').showModal();
}

/* ---------- Suchläufe ---------- */
async function ladeLaeufe() {
  const { laeufe } = await api('/api/suchlaeufe');
  $('laeufe').innerHTML = laeufe.map((l) => {
    const teile = Object.entries(l.ergebnis || {}).map(([q, e]) => {
      if (e?.fehler) return `${esc(QUELLEN[q] || q)}: <span class="chip rot">${esc(e.fehler)}</span>`;
      if (q === 'mail') return `E-Mail: ${e?.gesendet ? `${e.gesendet} gemeldet` : esc(e?.grund || '–')}`;
      if (q === 'ki') return `KI: ${e?.bewertet ?? 0} bewertet`;
      return `${esc(QUELLEN[q] || q)}: ${e.gefunden} geprüft, ${e.passend} passend, ${e.neu} neu`;
    });
    return `<tr><td>${zeit(l.gestartet)}</td><td>${esc(l.status)}</td><td>${teile.join('<br>')}</td></tr>`;
  }).join('') || '<tr><td colspan="3">Noch keine Suchläufe.</td></tr>';
}

/* ---------- Ereignisse ---------- */
document.querySelectorAll('.reiter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.reiter-btn').forEach((b) => b.classList.toggle('aktiv', b === btn));
    for (const name of ['liste', 'laeufe', 'einstellungen']) $(`reiter-${name}`).classList.toggle('hidden', btn.dataset.reiter !== name);
    if (btn.dataset.reiter === 'laeufe') ladeLaeufe();
  });
});

let filterTimer = null;
$('filter').addEventListener('input', () => { clearTimeout(filterTimer); filterTimer = setTimeout(() => ladeListe(), 300); });
$('filter').addEventListener('submit', (ev) => { ev.preventDefault(); ladeListe(); });
$('mehr').addEventListener('click', () => ladeListe(true));
$('liste').addEventListener('click', (ev) => {
  const item = ev.target.closest('.eintrag');
  if (item) zeigeDetail(item.dataset.id).catch((e) => alert(e.message));
});

let pollTimer = null;
function pollWhileRunning() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const s = await ladeStatus().catch(() => null);
    if (s && !s.suchlauf.laeuft) { clearInterval(pollTimer); ladeListe(); }
  }, 3000);
}

$('btn-suchlauf').addEventListener('click', async () => {
  $('btn-suchlauf').disabled = true;
  await api('/api/suchlauf', { method: 'POST' });
  $('lauf-meldung').textContent = 'Suchlauf läuft …';
  pollWhileRunning();
});

$('btn-neu-bewerten').addEventListener('click', async (ev) => {
  ev.target.disabled = true;
  $('einst-meldung').textContent = 'Bewerte neu …';
  try {
    const r = await api('/api/neu-bewerten', { method: 'POST' });
    $('einst-meldung').textContent = `${r.bewertet} Ausschreibungen neu bewertet.`;
    ladeListe();
  } catch (error) { $('einst-meldung').textContent = error.message; }
  ev.target.disabled = false;
});

$('btn-testmail').addEventListener('click', async () => {
  $('einst-meldung').textContent = 'Sende Testmail …';
  try { await api('/api/testmail', { method: 'POST' }); $('einst-meldung').textContent = 'Testmail versendet.'; } catch (error) { $('einst-meldung').textContent = error.message; }
});

ladeStatus().then((s) => {
  document.querySelector('[name=minPunkte]').value = s.einstellungen.mindestPunkteAnzeige;
  if (s.suchlauf.laeuft) pollWhileRunning();
  return ladeListe();
}).catch((e) => { $('liste').innerHTML = `<p class="leise">${esc(e.message)}</p>`; });
