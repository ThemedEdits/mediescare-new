'use strict';
// One-time move from another pharmacy program. Builds a ready Mediescare database (a new Head Office) from a folder of
// CSV, TXT, XLSX, XLS, JSON or XML files, using the same import rules as the Import screen (every row is checked; a
// file with any wrong row is not imported and the problems are listed).
//
//   npm run migrate -- <folder> [--out <data folder>]
//
// The folder holds organisation.json and any of these files (any supported extension):
//   products      medicines and products            suppliers   suppliers with opening balance owed
//   customers     customers with opening balance    opening_stock   batches on the shelf (needs products first)
// Column names are matched like on the Import screen (see docs/legacy-migration.md); download a template there to see them.
// The result is a normal data folder: copy it to %APPDATA%\Mediescare on the Head Office computer before the first start,
// or point MEDIESCARE_DATA_DIR at it.
const fs = require('fs');
const path = require('path');
const { App } = require('../src/main/core/app');
const rpc = require('../src/main/rpc');
const { registerAll } = require('../src/main/services');

const ORDER = ['products', 'suppliers', 'customers', 'opening_stock'];
const EXT = ['.csv', '.txt', '.xlsx', '.xls', '.json', '.xml'];

function args() {
  const a = process.argv.slice(2);
  const folder = a.find((x) => !x.startsWith('--'));
  const i = a.indexOf('--out');
  return { folder, out: i >= 0 ? a[i + 1] : null };
}

async function main() {
  const { folder, out } = args();
  if (!folder || !fs.existsSync(folder)) {
    console.error('Usage: npm run migrate -- <folder with organisation.json and data files> [--out <new data folder>]');
    process.exit(2);
  }
  const cfgFile = path.join(folder, 'organisation.json');
  if (!fs.existsSync(cfgFile)) { console.error(`Missing ${cfgFile}. See docs/legacy-migration.md.`); process.exit(2); }
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  const dataDir = path.resolve(out || path.join(folder, 'mediescare-data'));
  if (fs.existsSync(path.join(dataDir, 'mediescare.db'))) { console.error(`${dataDir} already has a Mediescare database. Choose another --out folder.`); process.exit(2); }
  fs.mkdirSync(dataDir, { recursive: true });

  registerAll();
  const app = new App({ dataDir, saveFile: async () => ({ saved: false }), renderPdf: async () => Buffer.alloc(0), printHtml: async () => ({ printed: false }) });
  app.start();
  const key = 'migration';
  const call = async (method, params) => {
    const res = await rpc.call(app, key, method, params);
    if (!res.ok) { const e = new Error(res.error.message); e.payload = res.error; throw e; }
    return res.data;
  };
  let failed = false;
  try {
    await call('setup.createHeadOffice', {
      orgName: cfg.organisation, orgCode: cfg.organisationCode, branchName: cfg.headOffice || 'Head Office', branchCode: cfg.headOfficeCode || 'HO',
      fullName: cfg.owner.fullName, username: cfg.owner.username, password: cfg.owner.password, confirmPassword: cfg.owner.password, deviceName: cfg.computerName || 'HO-PC-1',
    });
    console.log(`Organisation ${cfg.organisation} created with owner ${cfg.owner.username}.`);
    const files = fs.readdirSync(folder);
    for (const kind of ORDER) {
      const file = files.find((f) => path.parse(f).name.toLowerCase() === kind && EXT.includes(path.extname(f).toLowerCase()));
      if (!file) continue;
      const content = fs.readFileSync(path.join(folder, file));
      const loaded = await call('import.load', { kind, fileName: file, contentBase64: content.toString('base64') });
      const prev = await call('import.preview', { sessionId: loaded.sessionId, mapping: loaded.mapping, duplicates: 'skip' });
      const missing = loaded.fields ? loaded.fields.filter((f) => f.required && !loaded.mapping[f.key]).map((f) => f.label) : [];
      if (missing.length) console.log(`  ${file}: no column found for ${missing.join(', ')}`);
      if (prev.counts.error) {
        failed = true;
        console.log(`${file}: ${prev.counts.error} row(s) have problems, nothing imported from this file:`);
        for (const e of prev.errors.slice(0, 50)) console.log(`  row ${e.row}: ${e.error}`);
        if (prev.errors.length > 50) console.log(`  ... and ${prev.errors.length - 50} more`);
        continue;
      }
      const res = await call('import.commit', { sessionId: loaded.sessionId, mapping: loaded.mapping, duplicates: 'skip' });
      console.log(`${file}: ${res.counts.new} added, ${res.counts.skip} already there (skipped).`);
    }
    const check = await call('stock.check', {});
    if (check.mismatches.length) { failed = true; console.log('Stock check found differences:', check.mismatches.length); }
  } catch (err) {
    failed = true;
    console.error('Migration stopped:', err.message);
  } finally {
    app.close();
  }
  console.log(failed ? `\nFinished with problems. Fix the files and run again into a new folder. (Partial result in ${dataDir})` : `\nDone. The ready data folder is ${dataDir}`);
  process.exit(failed ? 1 : 0);
}

main();
