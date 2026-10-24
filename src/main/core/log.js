'use strict';
// Plain-text technical log for support. Never shown to users.
const fs = require('fs');
const path = require('path');

let file = null;
const MAX_BYTES = 5 * 1024 * 1024;

function init(dataDir) {
  const dir = path.join(dataDir, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'main.log');
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) {
      fs.renameSync(file, path.join(dir, 'main.1.log'));
    }
  } catch (_) { /* rotation is best effort */ }
}

function write(level, parts) {
  const line = `${new Date().toISOString()} ${level} ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`;
  if (file) {
    try { fs.appendFileSync(file, line); } catch (_) { /* logging must never break the app */ }
  }
  if (process.env.MEDIESCARE_LOG_STDOUT) process.stdout.write(line);
}

module.exports = {
  init,
  info: (...p) => write('INFO', p),
  warn: (...p) => write('WARN', p),
  error: (...p) => write('ERROR', p),
};
