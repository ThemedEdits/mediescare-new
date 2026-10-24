'use strict';
// Static checks on the screen code: every string key and icon name used actually exists, and no emojis anywhere.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|html|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = walk(root);
const rendererJs = files.filter((f) => f.includes(`${path.sep}renderer${path.sep}`) && f.endsWith('.js'));

function loadModuleObject(file, exportPattern) {
  const text = fs.readFileSync(file, 'utf8').replace(exportPattern, 'module.exports =');
  const m = { exports: {} };
  new Function('module', text)(m);
  return m.exports;
}

test('every t() key used on screens exists in en.js', () => {
  const en = loadModuleObject(path.join(root, 'renderer', 'js', 'strings', 'en.js'), /export default/);
  const missing = [];
  for (const f of rendererJs) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) if (!(m[1] in en)) missing.push(`${path.basename(f)}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('every icon() name used exists', () => {
  const iconsFile = fs.readFileSync(path.join(root, 'renderer', 'js', 'ui', 'icons.js'), 'utf8');
  const names = new Set([...iconsFile.matchAll(/^\s{2}([a-zA-Z]+): '/gm)].map((m) => m[1]));
  const missing = [];
  for (const f of rendererJs) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\bicon\('([a-zA-Z]+)'/g)) if (!names.has(m[1])) missing.push(`${path.basename(f)}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('main-process message keys used exist', () => {
  const { en } = require('../src/main/core/messages');
  const missing = [];
  for (const f of files.filter((x) => x.includes(`${path.sep}main${path.sep}`))) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\b(?:fail|invalid)\(\s*'[^']*',\s*'([^']+)'/g)) if (!(m[1] in en)) missing.push(`${path.basename(f)}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('no emojis anywhere in the source', () => {
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;
  const offenders = files.filter((f) => emoji.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
});
