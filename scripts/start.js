'use strict';
// Starts the app. Removes ELECTRON_RUN_AS_NODE, which some editors set and which would make Electron act as plain Node.
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [root, ...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code === null ? 1 : code));
