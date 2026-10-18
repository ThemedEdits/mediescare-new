'use strict';
// Launches the headless UI test in real Electron (not Electron-as-Node).
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(electron, [path.join(__dirname, 'ui-smoke.js')], { cwd: root, env, stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
