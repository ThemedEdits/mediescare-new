'use strict';
// Runs the backend tests with Electron's own Node, so better-sqlite3's native binary (built for Electron) loads.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));
const filter = process.argv[2];
const files = fs.readdirSync(path.join(root, 'test'))
  .filter((f) => f.endsWith('.test.js') && (!filter || f.includes(filter)))
  .map((f) => path.join('test', f));

const result = spawnSync(electron, ['--test', '--test-concurrency=1', ...files], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
process.exit(result.status === null ? 1 : result.status);
