// Schmale, sichere Brücke zwischen Desktop-Hülle und Oberfläche
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  onOpenFile: (cb) => {
    ipcRenderer.on('open-file', (_e, payload) => cb(payload));
    ipcRenderer.send('renderer-ready');
  },
  inboxInfo: () => ipcRenderer.invoke('inbox-info'),
  openInbox: () => ipcRenderer.invoke('open-inbox'),
});
