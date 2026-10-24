'use strict';
// Database adapters for the gateway.
//   tursoAdapter: Turso / libSQL over its HTTP API (v2/pipeline). Used in production.
//   sqliteAdapter: a local SQLite file through better-sqlite3. Used in tests and for a self-hosted gateway.

function toTursoValue(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
  return { type: 'text', value: String(v) };
}

function fromTursoValue(v) {
  if (!v || v.type === 'null') return null;
  if (v.type === 'integer') return Number(v.value);
  if (v.type === 'float') return Number(v.value);
  return v.value;
}

function tursoAdapter({ url, authToken, fetchImpl = globalThis.fetch }) {
  const endpoint = `${String(url).replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '')}/v2/pipeline`;

  async function pipeline(requests) {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${authToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ requests: [...requests, { type: 'close' }] }),
    });
    if (!res.ok) throw new Error(`Turso HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const out = [];
    for (const r of data.results) {
      if (r.type === 'error') throw new Error(`Turso: ${r.error && r.error.message}`);
      if (r.response && r.response.type === 'execute') out.push(r.response.result);
    }
    return out;
  }

  function stmt(sql, args = []) {
    return { type: 'execute', stmt: { sql, args: args.map(toTursoValue) } };
  }

  function rowsOf(result) {
    const names = result.cols.map((c) => c.name);
    return result.rows.map((row) => Object.fromEntries(row.map((v, i) => [names[i], fromTursoValue(v)])));
  }

  return {
    async all(sql, args) { return rowsOf((await pipeline([stmt(sql, args)]))[0]); },
    async get(sql, args) { return rowsOf((await pipeline([stmt(sql, args)]))[0])[0] || null; },
    async run(sql, args) { const r = (await pipeline([stmt(sql, args)]))[0]; return { changes: r.affected_row_count }; },
    // One transaction. Each step runs only if the one before succeeded; any failure rolls everything back.
    async batch(list) {
      const steps = [{ stmt: stmt('BEGIN').stmt }];
      list.forEach((st, i) => steps.push({ condition: { type: 'ok', step: i }, stmt: stmt(st.sql, st.args).stmt }));
      const last = steps.length - 1;
      steps.push({ condition: { type: 'ok', step: last }, stmt: stmt('COMMIT').stmt });
      steps.push({ condition: { type: 'not', cond: { type: 'ok', step: last + 1 } }, stmt: stmt('ROLLBACK').stmt });
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${authToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ requests: [{ type: 'batch', batch: { steps } }, { type: 'close' }] }),
      });
      if (!res.ok) throw new Error(`Turso HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const r = data.results[0];
      if (r.type === 'error') throw new Error(`Turso: ${r.error && r.error.message}`);
      const errors = (r.response.result.step_errors || []).filter(Boolean);
      if (errors.length) throw new Error(`Turso: ${errors[0].message}`);
    },
  };
}

function sqliteAdapter(file) {
  const Database = require('better-sqlite3');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  return {
    raw: db,
    async all(sql, args = []) { return db.prepare(sql).all(...args); },
    async get(sql, args = []) { return db.prepare(sql).get(...args) || null; },
    async run(sql, args = []) { return db.prepare(sql).run(...args); },
    async batch(list) { db.transaction(() => { for (const s of list) db.prepare(s.sql).run(...(s.args || [])); })(); },
    close() { db.close(); },
  };
}

module.exports = { tursoAdapter, sqliteAdapter };
