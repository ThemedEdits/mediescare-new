// Downloads the prebuilt better-sqlite3 binary that matches the installed Electron version.
// This machine has no C++ build tools, so we never compile from source.
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const moduleDir = path.join(root, 'node_modules', 'better-sqlite3');
if (!fs.existsSync(moduleDir)) process.exit(0);

const electronVersion = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;
const bin = path.join(root, 'node_modules', 'prebuild-install', 'bin.js');
execFileSync(process.execPath, [bin, '--runtime', 'electron', '--target', electronVersion, '--arch', process.arch, '--force'], {
  cwd: moduleDir,
  stdio: 'inherit',
});
console.log(`better-sqlite3 binary ready for Electron ${electronVersion}`);
