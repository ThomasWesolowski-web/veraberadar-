// Desktop-Hülle (Electron) für den XRechnung-Generator unter Windows
const { app, BrowserWindow, protocol, net, shell, Menu, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const SCHEME = 'app';

// Eigenes Protokoll, damit ES-Module, Web-Worker (pdf.js) und localStorage
// wie auf einem Webserver funktionieren – ganz ohne Netzwerk.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function registerProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const type = MIME[path.extname(file).toLowerCase()];
    if (!type || !res.ok) return res;
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': type } });
  });
}

// ------------------------------------------------------------------ Dateiübergabe
// 1) Programmaufruf mit Dateipfad ("Öffnen mit", "Senden an", Aufruf aus WinWorker o. ä.)
// 2) Eingangsordner: neue PDF/XML-Dateien werden automatisch eingelesen
let mainWindow = null;
let rendererReady = false;
const pendingFiles = [];
const ACCEPTED = /\.(pdf|xml)$/i;

function inboxDir() {
  return process.env.XRG_INBOX || path.join(app.getPath('documents'), 'XRechnung-Generator', 'Eingang');
}
function doneDir() {
  return path.join(inboxDir(), 'verarbeitet');
}
function filesFromArgv(argv) {
  return argv.slice(1).filter((a) => ACCEPTED.test(a) && !a.startsWith('--') && fs.existsSync(a));
}

function deliverFile(filePath, { fromInbox = false } = {}) {
  let data;
  try { data = fs.readFileSync(filePath); } catch { return; }
  const payload = { name: path.basename(filePath), data: new Uint8Array(data), fromInbox };
  if (fromInbox) {
    // nach dem Einlesen in "verarbeitet" verschieben, damit nichts doppelt importiert wird
    try {
      fs.mkdirSync(doneDir(), { recursive: true });
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      fs.renameSync(filePath, path.join(doneDir(), `${stamp}_${path.basename(filePath)}`));
    } catch { /* Datei evtl. noch gesperrt – bleibt liegen */ }
  }
  if (mainWindow && rendererReady) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('open-file', payload);
  } else {
    pendingFiles.push(payload);
  }
}

/** wartet, bis die Datei nicht mehr wächst (z. B. während WinWorker noch schreibt) */
function whenStable(filePath, cb, tries = 0) {
  let size1;
  try { size1 = fs.statSync(filePath).size; } catch { return; }
  setTimeout(() => {
    let size2;
    try { size2 = fs.statSync(filePath).size; } catch { return; }
    if (size1 === size2 && size2 > 0) {
      try { fs.closeSync(fs.openSync(filePath, 'r+')); cb(); return; } catch { /* noch gesperrt */ }
    }
    if (tries < 60) whenStable(filePath, cb, tries + 1);
  }, 500);
}

function watchInbox() {
  const dir = inboxDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch { return; }
  const seen = new Map();
  fs.watch(dir, (event, name) => {
    if (!name || !ACCEPTED.test(name)) return;
    const full = path.join(dir, name);
    const now = Date.now();
    if (seen.has(full) && now - seen.get(full) < 3000) return;
    if (!fs.existsSync(full)) return;
    seen.set(full, now);
    whenStable(full, () => deliverFile(full, { fromInbox: true }));
  });
}

ipcMain.handle('inbox-info', () => ({ path: inboxDir() }));
ipcMain.handle('open-inbox', () => shell.openPath(inboxDir()));
ipcMain.on('renderer-ready', () => {
  rendererReady = true;
  while (pendingFiles.length) mainWindow.webContents.send('open-file', pendingFiles.shift());
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 950,
    minWidth: 900,
    minHeight: 600,
    title: 'XRechnung-Generator',
    icon: path.join(ROOT, 'build', 'icon.png'),
    backgroundColor: '#f4f5f7',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow = win;
  win.webContents.on('did-start-loading', () => { rendererReady = false; });

  // Externe Links (z. B. KoSIT-Validator) im Standardbrowser öffnen
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`${SCHEME}://`)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 900, height: 900, autoHideMenuBar: true } };
    }
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${SCHEME}://`)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  // Speichern-Dialog für XML-Datei und Prüfbericht
  win.webContents.session.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({
      title: 'Datei speichern',
      defaultPath: path.join(app.getPath('documents'), item.getFilename()),
      filters: item.getFilename().endsWith('.xml')
        ? [{ name: 'XRechnung (XML)', extensions: ['xml'] }]
        : item.getFilename().endsWith('.pdf')
          ? [{ name: 'ZUGFeRD-Rechnung (PDF)', extensions: ['pdf'] }]
          : [{ name: 'Textdatei', extensions: ['txt'] }],
    });
  });

  win.loadURL(`${SCHEME}://local/index.html`);
}

function buildMenu() {
  const template = [
    {
      label: 'Datei',
      submenu: [
        { label: 'Neu laden', role: 'reload' },
        { type: 'separator' },
        { label: 'Beenden', role: 'quit' },
      ],
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { label: 'Rückgängig', role: 'undo' },
        { label: 'Wiederholen', role: 'redo' },
        { type: 'separator' },
        { label: 'Ausschneiden', role: 'cut' },
        { label: 'Kopieren', role: 'copy' },
        { label: 'Einfügen', role: 'paste' },
        { label: 'Alles auswählen', role: 'selectAll' },
      ],
    },
    {
      label: 'Ansicht',
      submenu: [
        { label: 'Vergrößern', role: 'zoomIn' },
        { label: 'Verkleinern', role: 'zoomOut' },
        { label: 'Originalgröße', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Vollbild', role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Hilfe',
      submenu: [
        {
          label: 'Rechtliche Anforderungen',
          click: () => {
            const w = new BrowserWindow({ width: 900, height: 900, autoHideMenuBar: true, title: 'Rechtliche Anforderungen' });
            w.loadURL(`${SCHEME}://local/docs/ANFORDERUNGEN.md`);
          },
        },
        { label: 'KoSIT-Validator (Web)', click: () => shell.openExternal('https://github.com/itplr-kosit/validator-configuration-xrechnung') },
        { type: 'separator' },
        {
          label: 'Über',
          click: () => dialog.showMessageBox({
            type: 'info',
            title: 'Über XRechnung-Generator',
            message: `XRechnung-Generator ${app.getVersion()}`,
            detail: 'Erstellt und prüft E-Rechnungen nach XRechnung 3.0 (EN 16931, UBL 2.1).\nAlle Daten bleiben auf diesem Computer.',
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Nur eine Instanz zulassen
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const files = filesFromArgv(argv);
    if (files.length) { files.forEach((f) => deliverFile(f)); return; }
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  app.whenReady().then(() => {
    registerProtocol();
    buildMenu();
    createWindow();
    filesFromArgv(process.argv).forEach((f) => deliverFile(f));
    watchInbox();
  });
  app.on('window-all-closed', () => app.quit());
}
