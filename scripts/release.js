'use strict';
// Builds the Windows installer.
//   npm run dist      -> dist/Mediescare-Setup-<version>.exe (+ .blockmap and latest.yml), nothing uploaded
//   npm run release   -> the same, then published as a GitHub Release; installed copies see it within an hour
//                        (Update in the top bar, and Help and updates). Needs GH_TOKEN.
// Settings come from environment variables and are built into the app (src/main/build-config.json):
//   MEDIESCARE_CLOUD_URL, MEDIESCARE_CLOUD_SETUP_KEY   the cloud gateway (required for a release)
//   GH_TOKEN                                           a GitHub token that may create releases (release only)
// The release repository is fixed in package.json (build.publish). electron-builder only builds; this script uploads.
// (Letting electron-builder upload made one release per file at the same moment, splitting the files over two
// releases and leaving latest.yml out. Here one release is made, all three files are uploaded and checked, and only
// then is the release published, so an installed copy never sees a half-uploaded version.)
const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');

const root = path.join(__dirname, '..');
const publish = process.argv.includes('--publish');
const env = process.env;
const pkg = require(path.join(root, 'package.json'));
const { owner, repo } = pkg.build.publish[0];
const version = pkg.version;
const tag = `v${version}`;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  return r.status === null ? 1 : r.status;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (publish && !env.GH_TOKEN) fail('Set GH_TOKEN (a GitHub token that may create releases) before a release.');
// A published installer must reach the cloud; never release one without the gateway address and setup key.
if (publish && (!env.MEDIESCARE_CLOUD_URL || !env.MEDIESCARE_CLOUD_SETUP_KEY)) {
  fail('Set MEDIESCARE_CLOUD_URL and MEDIESCARE_CLOUD_SETUP_KEY before a release (they are built into the installer).');
}
if (!fs.existsSync(path.join(root, 'build', 'icon.ico'))) run('node', ['scripts/run-icon.js']);

const api = (url, opts = {}) => fetch(url.startsWith('http') ? url : `https://api.github.com/repos/${owner}/${repo}${url}`, {
  ...opts,
  headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(opts.headers || {}) },
});

async function checkVersionIsNew() {
  const res = await api(`/releases/tags/${tag}`);
  if (res.status === 404) return;
  const r = await res.json();
  if (!r.draft) fail(`Release ${tag} is already published. Raise the version in package.json (npm run ship does it).`);
  // A leftover draft of the same version (an earlier attempt) is removed and made again.
  await api(`/releases/${r.id}`, { method: 'DELETE' });
}

async function upload() {
  const dist = path.join(root, 'dist');
  const files = [`Mediescare-Setup-${version}.exe`, `Mediescare-Setup-${version}.exe.blockmap`, 'latest.yml'];
  for (const f of files) if (!fs.existsSync(path.join(dist, f))) fail(`The build did not make ${f}; nothing was published.`);
  const commit = env.GITHUB_SHA || execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
  const notes = `Mediescare ${version}\n\nDownload **Mediescare-Setup-${version}.exe** below and run it. Installation steps: docs/INSTALL.md.\nInstalled copies offer this update by themselves (Update in the top bar).`;
  let res = await api('/releases', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tag_name: tag, target_commitish: commit, name: version, body: notes, draft: true }) });
  if (!res.ok) fail(`Creating the release failed: ${res.status} ${await res.text()}`);
  const release = await res.json();
  for (const f of files) {
    const data = fs.readFileSync(path.join(dist, f));
    process.stdout.write(`Uploading ${f} (${Math.round(data.length / 1024)} KB)... `);
    res = await api(`https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(f)}`, {
      method: 'POST', headers: { 'content-type': f.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream' }, body: data,
    });
    if (!res.ok) fail(`\nUploading ${f} failed: ${res.status} ${await res.text()}. The release stays a draft.`);
    const asset = await res.json();
    if (asset.size !== data.length) fail(`\n${f} arrived with the wrong size. The release stays a draft.`);
    console.log('done');
  }
  res = await api(`/releases/${release.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draft: false, make_latest: 'true' }) });
  if (!res.ok) fail(`Publishing the release failed: ${res.status} ${await res.text()}`);
  console.log(`\nRelease ${tag} published: https://github.com/${owner}/${repo}/releases/tag/${tag}`);
}

(async () => {
  if (publish) await checkVersionIsNew();
  const configFile = path.join(root, 'src', 'main', 'build-config.json');
  fs.writeFileSync(configFile, JSON.stringify({ cloudUrl: env.MEDIESCARE_CLOUD_URL || '', cloudSetupKey: env.MEDIESCARE_CLOUD_SETUP_KEY || '' }, null, 2) + '\n');
  console.log(env.MEDIESCARE_CLOUD_URL ? `Cloud gateway built in: ${env.MEDIESCARE_CLOUD_URL}` : 'No cloud gateway address: cloud sync will show "not set up" (LAN sync and backups work).');
  let status = 1;
  try {
    status = run('npx', ['electron-builder', '--win', 'nsis', '--publish', 'never']);
  } finally {
    // Always keep the address and key out of the source folder, even when the build fails.
    fs.writeFileSync(configFile, JSON.stringify({ cloudUrl: '', cloudSetupKey: '' }, null, 2) + '\n');
  }
  if (status !== 0) process.exit(status);
  if (publish) await upload();
})().catch((err) => fail(`Release failed: ${err.message}`));
