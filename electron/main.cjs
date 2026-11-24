// Desktop-Hülle (Electron) für den XRechnung-Generator unter Windows
const { app, BrowserWindow, protocol, net, shell, Menu, dialog } = require('electron');
const path = require('node:path');
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
    },
  });

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
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    registerProtocol();
    buildMenu();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
