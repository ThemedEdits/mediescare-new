'use strict';
// Checks a Turso database with the gateway adapter: creates the gateway tables, writes, reads, and confirms that a
// failed batch is rolled back. Run once when the Turso URL and token are available:
//   TURSO_URL=libsql://... TURSO_TOKEN=... node gateway/check.js
const { tursoAdapter } = require('./src/adapters');
const { SCHEMA } = require('./src/handler');

async function main() {
  if (!process.env.TURSO_URL || !process.env.TURSO_TOKEN) {
    console.error('Set TURSO_URL and TURSO_TOKEN first.');
    process.exit(2);
  }
  const db = tursoAdapter({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN });
  await db.batch(SCHEMA.map((sql) => ({ sql, args: [] })));
  console.log('Tables ready.');
  await db.batch([{ sql: 'CREATE TABLE IF NOT EXISTS gateway_check (id TEXT PRIMARY KEY, at TEXT)', args: [] }]);
  const id = `check-${Date.now()}`;
  await db.run('INSERT INTO gateway_check (id, at) VALUES (?, ?)', [id, new Date().toISOString()]);
  const row = await db.get('SELECT id FROM gateway_check WHERE id = ?', [id]);
  if (!row) throw new Error('Written row not found');
  console.log('Write and read work.');
  let failed = false;
  try {
    await db.batch([{ sql: 'INSERT INTO gateway_check (id, at) VALUES (?, ?)', args: [`${id}-2`, 'x'] }, { sql: 'INSERT INTO gateway_check (id, at) VALUES (?, ?)', args: [id, 'duplicate'] }]);
  } catch (_) { failed = true; }
  const leaked = await db.get('SELECT id FROM gateway_check WHERE id = ?', [`${id}-2`]);
  if (!failed || leaked) throw new Error('A failed batch was not rolled back');
  console.log('Failed batches roll back.');
  await db.run('DROP TABLE gateway_check', []);
  console.log('Turso is ready for the Mediescare gateway.');
}

main().catch((err) => { console.error('Check failed:', err.message); process.exit(1); });
