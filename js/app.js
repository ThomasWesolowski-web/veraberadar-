import {
  INVOICE_TYPES, VAT_CATEGORIES, PAYMENT_MEANS, UNITS, EAS_SCHEMES, DEFAULT_EXEMPTION,
  emptyInvoice, emptyLine, computeTotals, lineNet, num,
} from './model.js';
import { validateInvoice, summarize } from './validate.js';
import { buildXRechnung, suggestedFilename } from './ubl.js';
import { importXml } from './xml-import.js';

const MASTER_KEY = 'xrechnung.master.v1';
const DRAFT_KEY = 'xrechnung.draft.v1';

let inv = loadDraft() || withMaster(emptyInvoice());
let importedPdf = null; // { filename, base64 }

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const fmt = (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: inv.currency || 'EUR' }).format(n || 0);

// ---------------------------------------------------------------- Helfer
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}
function fillSelect(sel, map, withCode = true) {
  sel.innerHTML = Object.entries(map)
    .map(([k, v]) => `<option value="${k}">${withCode ? `${k} – ` : ''}${v}</option>`)
    .join('');
}
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!d) return null;
    const base = emptyInvoice();
    return { ...base, ...d, seller: { ...base.seller, ...d.seller }, buyer: { ...base.buyer, ...d.buyer },
      payment: { ...base.payment, ...d.payment }, delivery: { ...base.delivery, ...d.delivery }, attachment: null };
  } catch { return null; }
}
function saveDraft() {
  try {
    const { attachment, ...rest } = inv; // PDF-Anlage nicht dauerhaft speichern
    localStorage.setItem(DRAFT_KEY, JSON.stringify(rest));
  } catch { /* Speicher voll o. ä. */ }
}
function withMaster(target) {
  try {
    const m = JSON.parse(localStorage.getItem(MASTER_KEY) || 'null');
    if (!m) return target;
    target.seller = { ...target.seller, ...m.seller };
    const { iban, bic, accountName, terms, code, creditorId, skontoDays, skontoPercent } = m.payment || {};
    Object.assign(target.payment, Object.fromEntries(Object.entries({ iban, bic, accountName, terms, code, creditorId, skontoDays, skontoPercent })
      .filter(([, v]) => v !== undefined && v !== '')));
  } catch { /* ignorieren */ }
  return target;
}

// ---------------------------------------------------------------- Rendering
function bindForm() {
  for (const el of $$('[data-bind]')) {
    const path = el.dataset.bind;
    const v = getPath(inv, path);
    el.value = v ?? '';
    el.oninput = () => {
      const val = el.dataset.type === 'number' ? num(el.value) : el.value;
      setPath(inv, path, val);
      if (path === 'type' || path === 'payment.code') updateVisibility();
      refresh();
    };
  }
  updateVisibility();
}

function updateVisibility() {
  $$('.pay').forEach((el) => { el.hidden = !el.classList.contains(`pay-${inv.payment.code}`); });
  $('#preceding-box').classList.toggle('emph', ['381', '384'].includes(inv.type));
}

function renderLines() {
  const body = $('#lines-body');
  body.innerHTML = '';
  inv.lines.forEach((l, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="pos">${i + 1}</td>
      <td class="desc">
        <input data-l="name" placeholder="Bezeichnung" value="${escHtml(l.name)}">
        <input data-l="description" placeholder="Beschreibung (optional)" value="${escHtml(l.description)}" class="small">
        <input data-l="articleNo" placeholder="Artikelnr. (optional)" value="${escHtml(l.articleNo)}" class="small">
      </td>
      <td><input data-l="quantity" type="number" step="any" value="${l.quantity}" class="n"></td>
      <td><select data-l="unit">${Object.entries(UNITS).map(([k, v]) => `<option value="${k}"${k === l.unit ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input data-l="price" type="number" step="any" value="${l.price}" class="n"></td>
      <td><select data-l="vatCategory">${Object.entries(VAT_CATEGORIES).map(([k, v]) => `<option value="${k}" title="${escHtml(v)}"${k === l.vatCategory ? ' selected' : ''}>${k} – ${escHtml(v.split('(')[0].trim())}</option>`).join('')}</select></td>
      <td><input data-l="vatRate" type="number" step="any" value="${l.vatCategory === 'S' ? l.vatRate : 0}" class="n rate" ${l.vatCategory === 'S' ? '' : 'disabled'}></td>
      <td class="num line-net">${fmt(lineNet(l))}</td>
      <td><button type="button" class="del" title="Position löschen">✕</button></td>`;
    for (const el of $$('[data-l]', tr)) {
      el.oninput = () => {
        const k = el.dataset.l;
        l[k] = ['quantity', 'price', 'vatRate'].includes(k) ? num(el.value) : el.value;
        if (k === 'vatCategory') {
          if (l.vatCategory === 'S' && !l.vatRate) l.vatRate = 19;
          renderLines();
          renderExemptions();
        }
        $('.line-net', tr).textContent = fmt(lineNet(l));
        refresh();
      };
    }
    $('.del', tr).onclick = () => {
      inv.lines.splice(i, 1);
      if (!inv.lines.length) inv.lines.push(emptyLine());
      renderLines();
      renderExemptions();
      refresh();
    };
    body.appendChild(tr);
  });
}

function renderExemptions() {
  const box = $('#exemptions');
  const cats = [...new Set(inv.lines.map((l) => l.vatCategory))].filter((c) => DEFAULT_EXEMPTION[c]);
  if (!cats.length) { box.innerHTML = ''; return; }
  box.innerHTML = '<h3>Befreiungsgrund / Pflichthinweis <small>(§ 14 Abs. 4 Nr. 8 UStG, BT-120/121)</small></h3>';
  for (const c of cats) {
    if (!inv.exemptions[c]) inv.exemptions[c] = { ...DEFAULT_EXEMPTION[c] };
    const row = document.createElement('div');
    row.className = 'grid';
    row.innerHTML = `
      <label class="span2">Kategorie ${c}: Hinweistext
        <input value="${escHtml(inv.exemptions[c].reason)}" data-k="reason"></label>
      <label>VATEX-Code (optional)
        <input value="${escHtml(inv.exemptions[c].code)}" data-k="code" placeholder="z. B. VATEX-EU-AE"></label>`;
    for (const el of $$('input', row)) {
      el.oninput = () => { inv.exemptions[c][el.dataset.k] = el.value; refresh(); };
    }
    box.appendChild(row);
  }
}

function renderTotals(t) {
  const rows = [
    ['Summe Positionen netto', t.lineTotal],
    ...t.breakdown.map((g) => [
      g.category === 'S' ? `USt ${g.rate} % auf ${fmt(g.taxable)}` : `Kategorie ${g.category} (0 %) auf ${fmt(g.taxable)}`, g.tax]),
    ['Gesamtbetrag brutto', t.taxInclusive, 'strong'],
  ];
  if (t.prepaid) rows.push(['abzgl. bereits gezahlt', -t.prepaid]);
  rows.push(['Zahlbetrag', t.payable, 'strong big']);
  $('#totals').innerHTML = `<table class="totals">${rows
    .map(([k, v, c]) => `<tr class="${c || ''}"><td>${escHtml(k)}</td><td class="num">${fmt(v)}</td></tr>`).join('')}</table>`;
}

const SOURCE_LABEL = { UStG: '§ 14 UStG', EN16931: 'EN 16931', XRechnung: 'XRechnung', Hinweis: 'Hinweis' };

function renderFindings(findings) {
  const sum = summarize(findings);
  const st = $('#status');
  if (sum.errors === 0) {
    st.className = 'status ok';
    st.textContent = sum.warnings ? `Gültig – ${sum.warnings} Warnung(en) beachten` : 'Alle Prüfungen bestanden';
  } else {
    st.className = 'status bad';
    st.textContent = `${sum.errors} Fehler, ${sum.warnings} Warnung(en)`;
  }
  $('#btn-download').disabled = sum.errors > 0;
  $('#findings').innerHTML = findings
    .map((f, i) => `<li class="${f.level}" data-i="${i}"><span class="badge">${SOURCE_LABEL[f.source] || f.source}</span>
      ${escHtml(f.message)} <code>${escHtml(f.rule)}</code></li>`)
    .join('');
  $$('#findings li').forEach((li) => {
    li.onclick = () => focusField(findings[Number(li.dataset.i)].field);
  });
  // Felder markieren
  $$('.invalid').forEach((el) => el.classList.remove('invalid'));
  for (const f of findings) {
    if (f.level !== 'error') continue;
    const el = fieldElement(f.field);
    if (el) el.classList.add('invalid');
  }
}

function fieldElement(field) {
  if (!field) return null;
  const m = /^lines\.(\d+)\.(\w+)$/.exec(field);
  if (m) return $$('#lines-body tr')[Number(m[1])]?.querySelector(`[data-l="${m[2]}"]`);
  const ex = /^exemptions\.(\w+)$/.exec(field);
  if (ex) return $('#exemptions input');
  return $(`[data-bind="${field}"]`);
}
function focusField(field) {
  const el = fieldElement(field);
  if (!el) return;
  const det = el.closest('details');
  if (det) det.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.focus({ preventScroll: true });
}

let lastFindings = [];
function refresh() {
  inv.attachment = importedPdf && $('#attach-pdf').checked
    ? { filename: importedPdf.filename, mimeCode: 'application/pdf', base64: importedPdf.base64, description: 'Originalrechnung (PDF)' }
    : null;
  const t = computeTotals(inv);
  renderTotals(t);
  lastFindings = validateInvoice(inv);
  renderFindings(lastFindings);
  saveDraft();
}

function renderAll() {
  bindForm();
  renderLines();
  renderExemptions();
  refresh();
}

// ---------------------------------------------------------------- Import
function showImportResult(html, kind = 'info') {
  const box = $('#import-result');
  box.hidden = false;
  box.className = `import-result ${kind}`;
  box.innerHTML = html;
}

/** Übernimmt importierte Daten; leere Felder werden mit eigenen Stammdaten ergänzt. */
function applyImported(imported, { keepMaster }) {
  let next = imported;
  if (keepMaster) {
    const master = withMaster(emptyInvoice());
    for (const [k, v] of Object.entries(master.seller)) if (!next.seller[k]) next.seller[k] = v;
    for (const [k, v] of Object.entries(master.payment)) if (!next.payment[k]) next.payment[k] = v;
  }
  if (!next.issueDate) next.issueDate = new Date().toISOString().slice(0, 10);
  inv = next;
  renderAll();
}

async function handleFile(file) {
  const name = file.name || 'datei';
  try {
    if (/\.xml$/i.test(name) || /xml/.test(file.type)) {
      const text = await file.text();
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) throw new Error('Die XML-Datei ist nicht wohlgeformt.');
      const res = importXml(doc);
      importedPdf = null;
      $('#attach-row').hidden = true;
      applyImported(res.invoice, { keepMaster: false });
      showImportResult(`<strong>${escHtml(name)}</strong> als ${res.format === 'UBL' ? 'UBL (XRechnung)' : 'CII (ZUGFeRD/Factur-X)'} importiert.
        Die Daten wurden übernommen und werden unten gegen XRechnung 3.0 geprüft.`, 'ok');
      return;
    }
    if (!/\.pdf$/i.test(name) && file.type !== 'application/pdf') throw new Error('Bitte eine PDF- oder XML-Datei wählen.');
    showImportResult('PDF wird ausgewertet …');
    const { importPdf } = await import('./pdf-import.js');
    const res = await importPdf(await file.arrayBuffer(), name);
    importedPdf = { filename: name.replace(/[^\w.\-]+/g, '_'), base64: res.pdfBase64 };
    $('#attach-row').hidden = false;
    if (!res.invoice) {
      showImportResult(`<strong>${escHtml(res.source)}</strong><ul>${res.warnings.map((w) => `<li>${escHtml(w)}</li>`).join('')}</ul>`, 'warn');
      refresh();
      return;
    }
    applyImported(res.invoice, { keepMaster: true });
    showImportResult(`
      <strong>${escHtml(res.source)}</strong>
      <p>Erkannt: ${res.found.length ? res.found.map(escHtml).join(', ') : '—'}</p>
      ${res.warnings.length ? `<ul>${res.warnings.map((w) => `<li>${escHtml(w)}</li>`).join('')}</ul>` : ''}
      <p class="small">Automatisch erkannte Werte sind ein Vorschlag. Bitte alle Angaben prüfen und fehlende Pflichtfelder ergänzen (rot markiert).</p>`,
    res.warnings.length ? 'warn' : 'ok');
  } catch (e) {
    console.error(e);
    showImportResult(`Import fehlgeschlagen: ${escHtml(e.message || e)}`, 'bad');
  }
}

// ---------------------------------------------------------------- Export
function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

function reportText() {
  const t = computeTotals(inv);
  const lines = [
    `Prüfbericht XRechnung 3.0 – Rechnung ${inv.number || '(ohne Nummer)'}`,
    `Erstellt: ${new Date().toLocaleString('de-DE')}`,
    `Verkäufer: ${inv.seller.name} · Käufer: ${inv.buyer.name}`,
    `Netto ${t.taxExclusive.toFixed(2)} · USt ${t.taxTotal.toFixed(2)} · Brutto ${t.taxInclusive.toFixed(2)} · Zahlbetrag ${t.payable.toFixed(2)} ${inv.currency}`,
    '',
  ];
  if (!lastFindings.length) lines.push('Keine Befunde.');
  for (const f of lastFindings) {
    lines.push(`[${f.level.toUpperCase()}] ${f.rule} (${SOURCE_LABEL[f.source] || f.source}): ${f.message}`);
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- Init
function init() {
  fillSelect($('#sel-type'), INVOICE_TYPES);
  fillSelect($('#sel-payment'), PAYMENT_MEANS);
  $$('.sel-eas').forEach((s) => fillSelect(s, EAS_SCHEMES));

  $('#btn-add-line').onclick = () => {
    const last = inv.lines[inv.lines.length - 1];
    const l = emptyLine();
    if (last) { l.vatCategory = last.vatCategory; l.vatRate = last.vatRate; }
    inv.lines.push(l);
    renderLines();
    refresh();
    $$('#lines-body tr').at(-1)?.querySelector('[data-l="name"]')?.focus();
  };
  $('#btn-new').onclick = () => {
    if (!confirm('Neue Rechnung beginnen? Die aktuellen Eingaben (außer gespeicherten Stammdaten) werden verworfen.')) return;
    importedPdf = null;
    $('#attach-row').hidden = true;
    $('#import-result').hidden = true;
    inv = withMaster(emptyInvoice());
    renderAll();
  };
  $('#btn-save-master').onclick = () => {
    localStorage.setItem(MASTER_KEY, JSON.stringify({ seller: inv.seller, payment: inv.payment }));
    alert('Ihre Firmen-, Kontakt- und Zahlungsdaten wurden in diesem Browser gespeichert und werden bei neuen Rechnungen automatisch eingesetzt.');
  };
  $('#attach-pdf').onchange = refresh;

  $('#btn-download').onclick = () => {
    if (summarize(lastFindings).errors) return;
    download(suggestedFilename(inv), buildXRechnung(inv), 'application/xml');
  };
  $('#btn-preview').onclick = () => {
    $('#xml-output').textContent = buildXRechnung(inv);
    $('#xml-dialog').showModal();
  };
  $('#btn-close-dialog').onclick = () => $('#xml-dialog').close();
  $('#btn-copy').onclick = () => navigator.clipboard?.writeText($('#xml-output').textContent);
  $('#btn-report').onclick = () => download(`Pruefbericht_${(inv.number || 'rechnung').replace(/[^\w.-]+/g, '_')}.txt`, reportText(), 'text/plain;charset=utf-8');

  const dz = $('#dropzone');
  $('#file-input').onchange = (e) => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ''; };
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  renderAll();
}

init();
