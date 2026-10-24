'use strict';
// Runs make-icon.js inside Electron (not as plain Node), so it can draw the SVG.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(electron, [path.join(__dirname, 'make-icon.js')], { cwd: root, stdio: 'inherit', env });
process.exit(result.status === null ? 1 : result.status);
