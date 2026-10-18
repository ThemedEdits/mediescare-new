'use strict';
// The only bridge between the screens and the main process. No Node, no database, one call function.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mediescare', {
  call: (method, params) => ipcRenderer.invoke('rpc', { method: String(method), params: params || {} }),
  // Only used by the customer display window: receives the running bill from the main process.
  onDisplay: (fn) => ipcRenderer.on('display', (_e, data) => fn(data)),
});
