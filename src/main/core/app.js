'use strict';
// The running application: database, this PC's identity and the signed-in sessions.
// Created once by main.js; tests create their own instance with a temporary data folder.
const path = require('path');
const { open, migrate } = require('../db/connection');
const log = require('./log');

class App {
  constructor({ dataDir, saveFile, renderPdf, printHtml, listPrinters, showDisplay, backupKey, chooseFolder, chooseFile, afterRestore, lanAddresses } = {}) {
    this.dataDir = dataDir;
    this.dbFile = path.join(dataDir, 'mediescare.db');
    this.backupDir = path.join(dataDir, 'backups');
    this.sessions = new Map(); // client key (window id) -> session
    // Writes an export to a file the user picks. Replaced in tests.
    this.saveFile = saveFile || (async () => ({ saved: false }));
    // Turns an HTML document into PDF bytes, and sends HTML to a printer. Provided by main.js; replaced in tests.
    this.renderPdf = renderPdf || (async () => { throw new Error('PDF output is not available here'); });
    this.printHtml = printHtml || (async () => ({ printed: false }));
    // Printers installed on this computer, and the optional customer-facing display.
    this.listPrinters = listPrinters || (async () => []);
    this.showDisplay = showDisplay || (() => {});
    // Backups: the encryption key (kept by Windows for this user), folder and file pickers, and a restart after restore.
    this.backupKey = backupKey || (() => { throw new Error('No backup key on this computer'); });
    this.canEncrypt = () => !!backupKey;
    this.chooseFolder = chooseFolder || (async () => null);
    this.chooseFile = chooseFile || (async () => null);
    this.afterRestore = afterRestore || null;
    this.lanAddresses = lanAddresses || (() => []);
    this.sync = null; // the SyncEngine, set by main.js once the app has started
  }

  start() {
    log.init(this.dataDir);
    this.db = open(this.dbFile);
    this.migration = migrate(this.db, { file: this.dbFile, backupDir: this.backupDir });
    this.loadDevice();
    return this;
  }

  close() {
    if (this.db) this.db.close();
    this.db = null;
  }

  localGet(key) {
    const row = this.db.prepare('SELECT value FROM local_state WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  localSet(key, value) {
    this.db.prepare('INSERT INTO local_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  // This PC's registration. Null until the first-run setup has finished.
  loadDevice() {
    const deviceId = this.localGet('device_id');
    this.device = deviceId
      ? this.db.prepare(`SELECT d.*, b.code AS branch_code, b.name AS branch_name, b.is_head_office
          FROM devices d JOIN branches b ON b.id = d.branch_id WHERE d.id = ?`).get(deviceId) || null
      : null;
    this.db.prepare('UPDATE sync_ctx SET device_id = ? WHERE id = 1').run(deviceId);
    return this.device;
  }

  isSetUp() {
    return !!this.device;
  }
}

module.exports = { App };
