'use strict';
// Runs backup-copy.js in a worker thread so the counter never freezes while a large database is copied.
const { parentPort, workerData } = require('worker_threads');
const { makeBackupFile } = require('./backup-copy');

makeBackupFile(workerData).then((size) => parentPort.postMessage({ ok: true, size }), (err) => parentPort.postMessage({ ok: false, error: err && err.message }));
