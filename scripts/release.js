'use strict';
// Builds the Windows installer.
//   npm run dist      -> dist/Mediescare-Setup-<version>.exe, nothing uploaded
//   npm run release   -> the same, then published as a GitHub Release for automatic updates; needs GH_TOKEN.
//                        Installed copies see the new version within an hour (Help and updates, and the top bar).
// Settings come from environment variables and are built into the app (src/main/build-config.json):
//   MEDIESCARE_CLOUD_URL, MEDIESCARE_CLOUD_SETUP_KEY   the cloud gateway (optional; without it cloud sync shows "not set up")
//   MEDIESCARE_GH_OWNER, MEDIESCARE_GH_REPO            the GitHub repository that holds the releases (needed for updates)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const publish = process.argv.includes('--publish');
const env = process.env;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status === null ? 1 : r.status);
}

const owner = env.MEDIESCARE_GH_OWNER || '';
const repo = env.MEDIESCARE_GH_REPO || '';
if (publish && (!owner || !repo || !env.GH_TOKEN)) {
  console.error('Set MEDIESCARE_GH_OWNER, MEDIESCARE_GH_REPO and GH_TOKEN before a release.');
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
if (!owner || !repo) console.log('No GitHub repository given: this installer will not update itself.');

const args = ['electron-builder', '--win', 'nsis', '--publish', publish ? 'always' : 'never'];
// Published (not draft): installed copies only see published releases.
if (owner && repo) args.push('-c.publish.provider=github', `-c.publish.owner=${owner}`, `-c.publish.repo=${repo}`, '-c.publish.releaseType=release');
try {
  run('npx', args);
} finally {
  // Keep the address out of the source folder between builds.
  fs.writeFileSync(configFile, JSON.stringify({ cloudUrl: '', cloudSetupKey: '' }, null, 2) + '\n');
}
