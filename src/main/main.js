'use strict';
// Electron entry point: one window, one RPC channel, screens served from app:// with a strict content policy.
const { app: electronApp, BrowserWindow, ipcMain, protocol, dialog, net, shell, safeStorage } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { App } = require('./core/app');
const rpc = require('./rpc');
const { registerAll } = require('./services');
const log = require('./core/log');
const { SyncEngine } = require('./sync/engine');
const backup = require('./backup');
const { Updater } = require('./updater');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const APP_ICON = path.join(__dirname, '..', '..', 'build', 'icon.png');
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!electronApp.requestSingleInstanceLock()) {
  electronApp.quit();
} else {
  let mainWindow = null;
  let core = null;

  electronApp.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  function serveRenderer() {
    protocol.handle('app', async (request) => {
      const url = new URL(request.url);
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || rel === '') rel = '/index.html';
      const file = path.normalize(path.join(RENDERER_DIR, rel));
      if (!file.startsWith(RENDERER_DIR + path.sep) || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
      const res = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers(res.headers);
      headers.set('Content-Security-Policy', CSP);
      headers.set('X-Content-Type-Options', 'nosniff');
      if (file.endsWith('.js')) headers.set('Content-Type', 'text/javascript; charset=utf-8');
      return new Response(res.body, { status: res.status, headers });
    });
  }

  async function saveFile({ defaultName, content, ext, label }) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save export',
      defaultPath: path.join(electronApp.getPath('documents'), defaultName),
      filters: [{ name: label || ext.toUpperCase(), extensions: [ext] }],
    });
    if (result.canceled || !result.filePath) return { saved: false };
    fs.writeFileSync(result.filePath, content);
    return { saved: true, path: result.filePath };
  }

  // Loads an HTML document in a hidden window (scripts off) from a temp file; large reports exceed data: URL limits.
  async function withHiddenPage(html, fn) {
    const dir = path.join(core.dataDir, 'tmp');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `page-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    fs.writeFileSync(file, html);
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false, contextIsolation: true } });
    try {
      await win.loadFile(file);
      return await fn(win);
    } finally {
      win.destroy();
      fs.rm(file, { force: true }, () => {});
    }
  }

  function renderPdf(html, { landscape = false, pageSize = 'A4' } = {}) {
    return withHiddenPage(html, (win) => win.webContents.printToPDF({
      printBackground: true, landscape, pageSize,
      margins: typeof pageSize === 'string' ? { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } : { top: 0, bottom: 0, left: 0, right: 0 },
    }));
  }

  // Prints a document. Silent printing goes straight to the chosen printer; otherwise the Windows print dialog
  // opens (printer choice, copies). A cash drawer connected to the receipt printer opens if the printer driver is set
  // to kick the drawer on print.
  function printHtml(html, { silent = false, deviceName } = {}) {
    return withHiddenPage(html, (win) => new Promise((resolve) => {
      win.webContents.print({ silent: !!silent, printBackground: true, deviceName: deviceName || undefined, margins: { marginType: 'none' } },
        (printed, reason) => resolve({ printed, reason: printed ? null : reason }));
    }));
  }

  async function listPrinters() {
    if (!mainWindow) return [];
    const list = await mainWindow.webContents.getPrintersAsync();
    return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault }));
  }

  // Customer-facing display: a second window, on the second screen when there is one.
  let displayWindow = null;
  function showDisplay(data) {
    if (!displayWindow || displayWindow.isDestroyed()) {
      const { screen } = require('electron');
      const displays = screen.getAllDisplays();
      const target = displays.find((d) => d.id !== screen.getPrimaryDisplay().id) || screen.getPrimaryDisplay();
      displayWindow = new BrowserWindow({
        x: target.bounds.x + 40, y: target.bounds.y + 40, width: 900, height: 600, show: !process.env.MEDIESCARE_HIDDEN, autoHideMenuBar: true, title: 'Customer display',
        backgroundColor: '#ffffff', webPreferences: { preload: path.join(__dirname, '..', 'preload', 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
      });
      displayWindow.removeMenu();
      displayWindow.loadURL('app://mediescare/display.html');
      displayWindow.webContents.once('did-finish-load', () => displayWindow.webContents.send('display', data));
      if (displays.length > 1) displayWindow.once('ready-to-show', () => displayWindow.setFullScreen(true));
      return;
    }
    displayWindow.webContents.send('display', data);
  }

  function getOverlayTheme(theme) {
    if (theme === 'dark') {
      return { color: '#1b1f23', symbolColor: '#e6e9ec', height: 40 };
    }
    return { color: '#ffffff', symbolColor: '#1c2024', height: 40 };
  }

  function createWindow() {
    const isWindows = process.platform === 'win32';
    mainWindow = new BrowserWindow({
      width: 1366,
      height: 840,
      minWidth: 1024,
      minHeight: 640,
      show: false,
      backgroundColor: '#f6f7f8',
      title: 'Mediescare',
      icon: fs.existsSync(APP_ICON) ? APP_ICON : undefined,
      autoHideMenuBar: true,
      titleBarStyle: isWindows ? 'hidden' : 'default',
      titleBarOverlay: isWindows ? getOverlayTheme('light') : false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
      },
    });
    mainWindow.removeMenu();
    const key = `wc-${mainWindow.webContents.id}`;
    mainWindow.webContents.on('destroyed', () => core && core.sessions.delete(key));
    // The app never navigates away or opens pop-up windows.
    mainWindow.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    mainWindow.once('ready-to-show', () => { if (!process.env.MEDIESCARE_HIDDEN) mainWindow.show(); });
    mainWindow.on('closed', () => {
      mainWindow = null;
      if (displayWindow && !displayWindow.isDestroyed()) displayWindow.destroy();
    });
    mainWindow.loadURL('app://mediescare/index.html');
    return mainWindow;
  }

  // Key for encrypted backups, kept encrypted by Windows for this user (DPAPI through safeStorage).
  function backupKey() {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage not available');
    const stored = core.localGet('backup_key');
    if (stored) return Buffer.from(safeStorage.decryptString(Buffer.from(stored, 'base64')), 'hex');
    const key = require('crypto').randomBytes(32);
    core.localSet('backup_key', safeStorage.encryptString(key.toString('hex')).toString('base64'));
    return key;
  }

  async function chooseFolder() {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Choose the backup folder (for example a USB drive)', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  }

  async function chooseFile() {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Choose a Mediescare backup', properties: ['openFile'], filters: [{ name: 'Mediescare backup', extensions: ['db', 'enc'] }] });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  }

  // Addresses other computers in the shop can use to reach this one.
  function lanAddresses() {
    return Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  }

  async function startSync() {
    if (!core.isSetUp()) return;
    if (core.sync) await core.sync.stop();
    core.sync = new SyncEngine(core);
    try { await core.sync.start(); } catch (err) { log.error('Sync start failed', err && err.stack); }
  }

  function scheduleBackups() {
    const tick = () => { if (core.isSetUp()) backup.autoIfDue(core).catch((err) => log.error('Automatic backup failed', err && err.message)); };
    setTimeout(tick, 60 * 1000);
    setInterval(tick, 30 * 60 * 1000);
  }

  electronApp.whenReady().then(async () => {
    const dataDir = process.env.MEDIESCARE_DATA_DIR || electronApp.getPath('userData');
    try {
      core = new App({
        dataDir, saveFile, renderPdf, printHtml, listPrinters, showDisplay, chooseFolder, chooseFile, lanAddresses,
        backupKey: safeStorage.isEncryptionAvailable() ? backupKey : undefined,
        afterRestore: () => { electronApp.relaunch(); electronApp.exit(0); },
      });
      core.version = electronApp.getVersion();
      core.onJoined = startSync;
      core.start();
      await startSync();
      scheduleBackups();
      core.updater = new Updater({ electronApp, core });
      core.updater.start();
    } catch (err) {
      log.error('Startup failed', err && err.stack);
      dialog.showErrorBox('Mediescare could not start', 'The data file could not be opened. Please restart the computer. If this keeps happening, contact support and do not delete any files.');
      electronApp.exit(1);
      return;
    }
    registerAll();
    serveRenderer();

    ipcMain.handle('rpc', async (event, message) => {
      // Only our own screens may call in.
      if (!event.senderFrame || !event.senderFrame.url.startsWith('app://mediescare/')) {
        return { ok: false, error: { code: 'FORBIDDEN', message: 'Not allowed.' } };
      }
      const method = message && typeof message.method === 'string' ? message.method : '';
      const params = message && typeof message.params === 'object' && message.params !== null ? message.params : {};
      return rpc.call(core, `wc-${event.sender.id}`, method, params);
    });

    ipcMain.on('theme:change', (event, theme) => {
      if (mainWindow && !mainWindow.isDestroyed() && process.platform === 'win32') {
        try {
          mainWindow.setTitleBarOverlay(getOverlayTheme(theme));
        } catch (_) { /* ignore if not supported */ }
      }
    });

    createWindow();
  });

  electronApp.on('window-all-closed', () => {
    if (displayWindow && !displayWindow.isDestroyed()) displayWindow.destroy();
    if (core && core.sync) core.sync.stop();
    if (core) core.close();
    electronApp.quit();
  });

  // Exposed for the headless UI test driver only.
  module.exports = { getWindow: () => mainWindow, getCore: () => core };
}
