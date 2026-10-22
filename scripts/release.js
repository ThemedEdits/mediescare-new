'use strict';
// Builds the Windows installer.
//   npm run dist      -> dist/Mediescare-Setup-<version>.exe, nothing uploaded
//   npm run release   -> the same, then published as a GitHub Release for automatic updates; needs GH_TOKEN.
//                        Installed copies see the new version within an hour (Help and updates, and the top bar).
// Settings come from environment variables and are built into the app (src/main/build-config.json):
//   MEDIESCARE_CLOUD_URL, MEDIESCARE_CLOUD_SETUP_KEY   the cloud gateway (optional; without it cloud sync shows "not set up")
//   GH_TOKEN                                           a GitHub token that may create releases (npm run release only)
// The release repository is fixed in package.json (build.publish: ThemedEdits/mediescare-new, published releases).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const publish = process.argv.includes('--publish');
const env = process.env;

function run(cmd, args, { exitOnFail = true } = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  const status = r.status === null ? 1 : r.status;
  if (status !== 0 && exitOnFail) process.exit(status);
  return status;
}

if (publish && !env.GH_TOKEN) {
  console.error('Set GH_TOKEN (a GitHub token that may create releases) before a release.');
  process.exit(2);
}
// A published installer must reach the cloud; never release one without the gateway address and setup key.
if (publish && (!env.MEDIESCARE_CLOUD_URL || !env.MEDIESCARE_CLOUD_SETUP_KEY)) {
  console.error('Set MEDIESCARE_CLOUD_URL and MEDIESCARE_CLOUD_SETUP_KEY before a release (they are built into the installer).');
  process.exit(2);
}
if (!fs.existsSync(path.join(root, 'build', 'icon.ico'))) run('node', ['scripts/run-icon.js']);

const configFile = path.join(root, 'src', 'main', 'build-config.json');
fs.writeFileSync(configFile, JSON.stringify({ cloudUrl: env.MEDIESCARE_CLOUD_URL || '', cloudSetupKey: env.MEDIESCARE_CLOUD_SETUP_KEY || '' }, null, 2) + '\n');
console.log(env.MEDIESCARE_CLOUD_URL ? `Cloud gateway built in: ${env.MEDIESCARE_CLOUD_URL}` : 'No cloud gateway address: cloud sync will show "not set up" (LAN sync and backups work).');

const args = ['electron-builder', '--win', 'nsis', '--publish', publish ? 'always' : 'never'];
let status = 1;
try {
  status = run('npx', args, { exitOnFail: false });
} finally {
  // Always keep the address and key out of the source folder, even when the build fails.
  fs.writeFileSync(configFile, JSON.stringify({ cloudUrl: '', cloudSetupKey: '' }, null, 2) + '\n');
}
process.exit(status);
