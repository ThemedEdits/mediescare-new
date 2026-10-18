'use strict';
// Test helpers: a fresh App in a temporary folder and a small client that talks to the RPC router.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { App } = require('../src/main/core/app');
const rpc = require('../src/main/rpc');
const { registerAll } = require('../src/main/services');

registerAll();

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mediescare-test-'));
}

function makeApp(dataDir = tempDir()) {
  const saved = [];
  const printed = [];
  const app = new App({
    dataDir,
    saveFile: async (file) => { saved.push(file); return { saved: true, path: path.join(dataDir, file.defaultName) }; },
    renderPdf: async (html) => Buffer.from('%PDF-1.4 test ' + html.length),
    printHtml: async (html, opts) => { printed.push({ html, opts }); return { printed: true }; },
  });
  app.printed = printed;
  app.start();
  app.saved = saved;
  return app;
}

// A client is one window. call() returns data or throws an Error carrying the RPC error payload.
function client(app, key = 'win-' + Math.random().toString(36).slice(2)) {
  return {
    key,
    async call(method, params) {
      const res = await rpc.call(app, key, method, params);
      if (!res.ok) {
        const err = new Error(res.error.message);
        err.code = res.error.code;
        err.details = res.error.details;
        throw err;
      }
      return res.data;
    },
    async fail(method, params) {
      const res = await rpc.call(app, key, method, params);
      if (res.ok) throw new Error(`Expected ${method} to fail but it succeeded`);
      return res.error;
    },
  };
}

const OWNER = { username: 'owner', password: 'Owner#2026' };

async function setUpHeadOffice(app, overrides = {}) {
  const c = client(app);
  const me = await c.call('setup.createHeadOffice', {
    orgName: 'Test Pharmacy Chain', orgCode: 'TPC', branchName: 'Head Office', branchCode: 'HO',
    fullName: 'Owner Person', username: OWNER.username, password: OWNER.password, confirmPassword: OWNER.password, deviceName: 'HO-PC-1',
    ...overrides,
  });
  return { c, me };
}

async function signIn(app, username, password) {
  const c = client(app);
  const me = await c.call('auth.login', { username, password });
  return { c, me };
}

module.exports = { tempDir, makeApp, client, setUpHeadOffice, signIn, OWNER };
