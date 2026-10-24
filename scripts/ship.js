'use strict';
// Ships a new version: runs the backend tests, raises the version (patch by default), commits, tags and pushes.
// The pushed tag (v1.2.3) starts the GitHub Actions workflow (.github/workflows/release.yml), which builds the installer
// with the cloud address and publishes the GitHub Release. Installed copies then see the update within an hour.
//
//   npm run ship                 1.0.0 -> 1.0.1
//   npm run ship -- minor        1.0.0 -> 1.1.0
//   npm run ship -- major        1.0.0 -> 2.0.0
//   npm run ship -- patch --local   also build and publish from this computer (needs the variables in RELEASING.md)
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const level = ['patch', 'minor', 'major'].find((x) => process.argv.includes(x)) || 'patch';
const local = process.argv.includes('--local');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0 && !opts.allowFail) {
    console.error(`\nStopped: "${cmd} ${args.join(' ')}" failed.`);
    process.exit(r.status === null ? 1 : r.status);
  }
  return r;
}

const dirty = run('git', ['status', '--porcelain'], { capture: true }).stdout.trim();
if (dirty) {
  console.error('There are changes that are not committed yet. Commit them first (git add -A, git commit -m "..."), then run ship again.');
  process.exit(2);
}
console.log('Running the backend tests before shipping...');
run('npm', ['test']);
run('npm', ['version', level, '-m', '"Release v%s"']);
const version = require(path.join(root, 'package.json')).version;
run('git', ['push', '--follow-tags', 'origin', 'HEAD']);
console.log(`\nv${version} pushed. GitHub Actions now builds the installer and publishes the release:`);
console.log('  https://github.com/ThemedEdits/mediescare-new/actions');
if (local) {
  console.log('\nBuilding and publishing from this computer as well...');
  run('npm', ['run', 'release']);
}
