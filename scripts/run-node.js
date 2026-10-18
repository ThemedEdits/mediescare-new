'use strict';
// Runs a script with Electron's own Node (the same native better-sqlite3 build as the app): node scripts/run-node.js <script> [args]
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));
const result = spawnSync(electron, process.argv.slice(2), { cwd: root, stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
process.exit(result.status === null ? 1 : result.status);
