'use strict';
// Starts the app. Removes ELECTRON_RUN_AS_NODE, which some editors set and which would make Electron act as plain Node.
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

if (process.argv.includes('--local')) {
  env.MEDIESCARE_DATA_DIR = env.MEDIESCARE_DATA_DIR || path.join(path.dirname(root), 'mediescare-local-test');
  env.MEDIESCARE_OFFLINE = '1';
}

const args = process.argv.slice(2).filter((x) => x !== '--local');
const child = spawn(electron, [root, ...args], { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code === null ? 1 : code));
