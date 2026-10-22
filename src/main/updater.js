'use strict';
// Automatic updates from GitHub Releases (electron-updater). Works only in an installed copy whose build was made with
// a publish address (app-update.yml next to the app); otherwise the status says "not set up".
// An update downloads in the background. It is installed when someone presses "Restart and update" (a safety backup is
// taken first) or when the app is closed. On the next start, pending database migrations run, each after its own
// safety copy (db/migrate.js), so the local data is kept.
const fs = require('fs');
const path = require('path');
const log = require('./core/log');

// GitHub's release feed has no strict rate limit for this, so an hourly check is fine.
const CHECK_EVERY_MS = 3600 * 1000;

class Updater {
  constructor({ electronApp, core }) {
    this.electronApp = electronApp;
    this.core = core;
    this.state = { state: 'not_set_up', version: electronApp.getVersion(), available: null, progress: null, error: null, checkedAt: null };
    this.au = null;
  }

  configured() {
    if (!this.electronApp.isPackaged) return false;
    return fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
  }

  start() {
    if (!this.configured()) return;
    const { autoUpdater } = require('electron-updater');
    this.au = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: (m) => log.info(`update: ${m}`), warn: (m) => log.info(`update: ${m}`), error: (m) => log.error(`update: ${m}`), debug: () => {} };
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking', error: null }));
    autoUpdater.on('update-not-available', () => this.set({ state: 'up_to_date', checkedAt: new Date().toISOString() }));
    autoUpdater.on('update-available', (info) => this.set({ state: 'downloading', available: info.version, progress: 0, checkedAt: new Date().toISOString() }));
    autoUpdater.on('download-progress', (p) => this.set({ progress: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (info) => this.set({ state: 'ready', available: info.version, progress: 100 }));
    autoUpdater.on('error', (err) => this.set({ state: 'error', error: 'The update could not be checked or downloaded. It will be tried again later.', detail: err && err.message }));
    this.set({ state: 'idle' });
    setTimeout(() => this.check(), 30 * 1000);
    this.timer = setInterval(() => this.check(), CHECK_EVERY_MS);
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    if (patch.detail) log.error(`update error: ${patch.detail}`);
  }

  status() {
    const { detail, ...shown } = this.state;
    void detail;
    return shown;
  }

  async check() {
    if (!this.au) return this.status();
    try { await this.au.checkForUpdates(); } catch (err) { this.set({ state: 'error', error: 'The update could not be checked. Check the internet connection.', detail: err && err.message }); }
    return this.status();
  }

  // Safety backup, then restart into the new version.
  async install() {
    if (!this.au || this.state.state !== 'ready') return false;
    try { await require('./backup').create(this.core, 'safety'); } catch (err) { log.error('Backup before update failed', err && err.message); }
    // Silent install (no installer wizard), then Mediescare opens again on the new version.
    setImmediate(() => this.au.quitAndInstall(true, true));
    return true;
  }
}

module.exports = { Updater };
