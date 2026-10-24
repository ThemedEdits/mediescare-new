'use strict';
// Mediescare cloud gateway. Sits in front of Turso so the real database token never ships inside the app.
// Each computer gets its own device token (only a hash is stored). A device may push and pull only its own branch's
// operations plus shared ones; Head Office devices see every branch. Several organisations can share one gateway;
// every row carries org_id.
//
// Runs as a Cloudflare Worker (worker.mjs) or a plain Node server (server.js). `env.db` is an adapter with
// async all(sql, args), get(sql, args), run(sql, args) and batch([{ sql, args }]) (one transaction).
const crypto = require('node:crypto');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS orgs (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, branch_id TEXT NOT NULL, name TEXT, all_branches INTEGER NOT NULL DEFAULT 0,
     token_hash TEXT NOT NULL UNIQUE, revoked_at TEXT, created_at TEXT NOT NULL, last_seen_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS ops (seq INTEGER PRIMARY KEY AUTOINCREMENT, org_id TEXT NOT NULL, op_id TEXT NOT NULL, tbl TEXT NOT NULL, row_id TEXT NOT NULL,
     kind TEXT NOT NULL, branch_id TEXT, branch_id2 TEXT, data TEXT NOT NULL, updated_at TEXT NOT NULL, origin_device TEXT, created_at TEXT, received_at TEXT NOT NULL,
     UNIQUE (org_id, op_id))`,
  'CREATE INDEX IF NOT EXISTS ops_org_seq ON ops (org_id, seq)',
  'CREATE INDEX IF NOT EXISTS ops_org_branch ON ops (org_id, branch_id, seq)',
  'CREATE INDEX IF NOT EXISTS ops_org_branch2 ON ops (org_id, branch_id2, seq)',
  'CREATE INDEX IF NOT EXISTS ops_org_row ON ops (org_id, tbl, row_id)',
  // Join codes used once (the code itself lives in the synced join_codes table) and wrong join attempts (rate limit).
  'CREATE TABLE IF NOT EXISTS join_uses (org_id TEXT NOT NULL, code_hash TEXT NOT NULL, device_id TEXT NOT NULL, used_at TEXT NOT NULL, PRIMARY KEY (org_id, code_hash))',
  'CREATE TABLE IF NOT EXISTS join_fails (org_id TEXT NOT NULL, at TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS join_fails_org ON join_fails (org_id, at)',
];

// Kept small so one request stays far below the Cloudflare free plan limit (about 10 ms of work per request).
const MAX_PUSH = 300;
const MAX_PULL = 300;
const JOIN_FAILS_PER_HOUR = 20;

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function json(status, data) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function fail(status, code, error) {
  return json(status, { code, error });
}

function validOp(op) {
  return op && typeof op.op_id === 'string' && op.op_id.length <= 64 && typeof op.tbl === 'string' && /^[a-z_]+$/.test(op.tbl)
    && typeof op.row_id === 'string' && op.row_id.length <= 64 && typeof op.data === 'string' && op.data.length <= 2000000
    && typeof op.updated_at === 'string' && (op.kind === 'upsert' || op.kind === 'insert');
}

// The latest version of a synced row, rebuilt from the operation log (the gateway keeps no other copy).
async function latestRow(db, orgId, tbl, where) {
  const rows = await db.all(`SELECT data FROM ops WHERE org_id = ? AND tbl = ? ${where.sql} ORDER BY updated_at DESC, op_id DESC LIMIT 1`, [orgId, tbl, ...where.args]);
  return rows.length ? JSON.parse(rows[0].data) : null;
}

async function issueDevice(db, { orgId, deviceId, branchId, name, allBranches }) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.run(`INSERT INTO devices (id, org_id, branch_id, name, all_branches, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET token_hash = excluded.token_hash, revoked_at = NULL, branch_id = excluded.branch_id, all_branches = excluded.all_branches, name = excluded.name`,
  [deviceId, orgId, branchId, name || null, allBranches ? 1 : 0, sha256(token), nowIso()]);
  return token;
}

async function authenticate(db, request) {
  const m = /^Bearer (.+)$/.exec(request.headers.get('authorization') || '');
  if (!m) return null;
  const d = await db.get('SELECT * FROM devices WHERE token_hash = ?', [sha256(m[1])]);
  if (!d || d.revoked_at) return null;
  await db.run('UPDATE devices SET last_seen_at = ? WHERE id = ?', [nowIso(), d.id]);
  return d;
}

async function register(db, env, body) {
  if (env.SETUP_KEY && body.setupKey !== env.SETUP_KEY) return fail(403, 'SETUP_KEY', 'This copy of Mediescare is not allowed to register a new organisation.');
  for (const k of ['orgId', 'orgCode', 'deviceId', 'branchId']) if (typeof body[k] !== 'string' || !body[k]) return fail(400, 'BAD_REQUEST', `Missing ${k}.`);
  const existing = await db.get('SELECT * FROM orgs WHERE code = ? COLLATE NOCASE', [body.orgCode]);
  if (existing && existing.id !== body.orgId) return fail(409, 'ORG_CODE_TAKEN', 'Another organisation already uses this code in the cloud. Change the organisation code and try again.');
  if (existing) {
    // The same organisation registering again (for example the Head Office computer was replaced) needs a device
    // that already belongs to it; otherwise anyone could take over an organisation by its code.
    const known = await db.get('SELECT 1 FROM devices WHERE id = ? AND org_id = ?', [body.deviceId, existing.id]);
    if (!known) return fail(409, 'ORG_EXISTS', 'This organisation is already registered. Sign in to it instead.');
  } else {
    await db.run('INSERT INTO orgs (id, code, name, created_at) VALUES (?, ?, ?, ?)', [body.orgId, body.orgCode, body.orgName || null, nowIso()]);
  }
  const token = await issueDevice(db, { orgId: body.orgId, deviceId: body.deviceId, branchId: body.branchId, name: body.deviceName, allBranches: true });
  return json(200, { token, orgId: body.orgId, serverTime: nowIso() });
}

// Same normalise + hash as src/main/core/joincodes.js (test/join.test.js checks they agree).
function codeHash(code) {
  return sha256(String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
}

// A new main computer for a branch, proven by a one-time join code that Head Office made for that branch; or a
// replacement Head Office computer, proven by the organisation recovery key. Only hashes are compared, so a join costs
// almost no work (the cloud's free plan allows very little per request). The manager's login is checked afterwards on
// the new computer itself, against the users it downloaded.
async function join(db, body) {
  const deny = (message) => fail(403, 'BAD_CODE', message || 'The organisation code or the join code is not correct.');
  const org = await db.get('SELECT * FROM orgs WHERE code = ? COLLATE NOCASE', [String(body.orgCode || '')]);
  if (!org) return deny();
  const since = new Date(Date.now() - 3600 * 1000).toISOString();
  const fails = await db.get('SELECT COUNT(*) AS n FROM join_fails WHERE org_id = ? AND at > ?', [org.id, since]);
  if (fails && fails.n >= JOIN_FAILS_PER_HOUR) return fail(429, 'TOO_MANY', 'Too many wrong codes. Wait an hour and try again, or ask Head Office for a new code.');
  const wrong = async (message) => { await db.run('INSERT INTO join_fails (org_id, at) VALUES (?, ?)', [org.id, nowIso()]); return deny(message); };
  if (typeof body.deviceId !== 'string' || !/^[0-9A-Z]{26}$/.test(body.deviceId)) return fail(400, 'BAD_REQUEST', 'Missing device id.');
  const now = nowIso();
  let branch = null;
  let usedHash = null;
  if (body.joinCode) {
    const hash = codeHash(body.joinCode);
    const code = await latestRow(db, org.id, 'join_codes', { sql: "AND json_extract(data, '$.code_hash') = ?", args: [hash] });
    if (!code) return wrong();
    if (code.cancelled_at) return wrong('This join code was cancelled. Ask Head Office for a new one.');
    if (code.expires_at < now) return wrong('This join code has expired. Ask Head Office for a new one.');
    if (await db.get('SELECT 1 FROM join_uses WHERE org_id = ? AND code_hash = ?', [org.id, hash])) return wrong('This join code was already used. Ask Head Office for a new one.');
    branch = await latestRow(db, org.id, 'branches', { sql: 'AND row_id = ?', args: [code.branch_id] });
    usedHash = hash;
  } else if (body.recoveryKey) {
    const o = await latestRow(db, org.id, 'org', { sql: 'AND row_id = ?', args: [org.id] });
    if (!o || !o.recovery_hash || o.recovery_hash !== codeHash(body.recoveryKey)) return wrong('The organisation code or the recovery key is not correct.');
    branch = await latestRow(db, org.id, 'branches', { sql: "AND json_extract(data, '$.is_head_office') = 1", args: [] });
  } else {
    return deny();
  }
  if (!branch || !branch.active) return fail(403, 'BRANCH_INACTIVE', 'This branch is deactivated.');
  // Claim the code first: if two computers try the same code at once, only one gets past this line.
  if (usedHash) {
    try { await db.run('INSERT INTO join_uses (org_id, code_hash, device_id, used_at) VALUES (?, ?, ?, ?)', [org.id, usedHash, body.deviceId, now]); }
    catch (_) { return wrong('This join code was already used. Ask Head Office for a new one.'); }
  }
  // The next free computer number in the branch, from the devices the cloud has seen.
  const rows = await db.all("SELECT data FROM ops WHERE org_id = ? AND tbl = 'devices' AND branch_id IS NULL", [org.id]);
  const used = rows.map((r) => JSON.parse(r.data)).filter((d) => d.branch_id === branch.id).map((d) => d.device_no);
  const deviceNo = used.length ? Math.max(...used) + 1 : 1;
  const allBranches = branch.is_head_office === 1;
  const token = await issueDevice(db, { orgId: org.id, deviceId: body.deviceId, branchId: branch.id, name: body.deviceName, allBranches });
  return json(200, { token, orgId: org.id, orgCode: org.code, branchId: branch.id, deviceNo, allBranches, serverTime: now });
}

async function push(db, device, body) {
  const ops = Array.isArray(body.ops) ? body.ops.slice(0, MAX_PUSH) : [];
  const now = nowIso();
  const allowed = ops.filter((op) => validOp(op) && (device.all_branches || !op.branch_id || op.branch_id === device.branch_id || op.branch_id2 === device.branch_id));
  const statements = allowed.map((op) => ({
    sql: `INSERT INTO ops (org_id, op_id, tbl, row_id, kind, branch_id, branch_id2, data, updated_at, origin_device, created_at, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (org_id, op_id) DO NOTHING`,
    args: [device.org_id, op.op_id, op.tbl, op.row_id, op.kind, op.branch_id || null, op.branch_id2 || null, op.data, op.updated_at, op.origin_device || null, op.created_at || null, now],
  }));
  // A computer blocked in the app is blocked here too, as soon as the block arrives.
  for (const op of allowed.filter((o) => o.tbl === 'devices')) {
    try {
      const d = JSON.parse(op.data);
      if (d.revoked_at) statements.push({ sql: 'UPDATE devices SET revoked_at = ? WHERE id = ? AND org_id = ?', args: [d.revoked_at, d.id, device.org_id] });
    } catch (_) { /* ignore */ }
  }
  if (statements.length) await db.batch(statements);
  // handled: how many of the sent operations were looked at (stored, duplicates or refused); the app moves its cursor
  // only that far, so anything past MAX_PUSH is simply sent again.
  return json(200, { accepted: allowed.length, rejected: ops.length - allowed.length, handled: ops.length, serverTime: now });
}

async function pull(db, device, url) {
  const after = Math.max(Number(url.searchParams.get('after')) || 0, 0);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || MAX_PULL, 1), MAX_PULL);
  const scope = device.all_branches ? '' : 'AND (branch_id IS NULL OR branch_id = ? OR branch_id2 = ?)';
  const args = device.all_branches ? [device.org_id, after, limit + 1] : [device.org_id, after, device.branch_id, device.branch_id, limit + 1];
  const rows = await db.all(`SELECT seq, op_id, tbl, row_id, kind, branch_id, branch_id2, data, updated_at, origin_device, created_at FROM ops
    WHERE org_id = ? AND seq > ? ${scope} ORDER BY seq LIMIT ?`, args);
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  return json(200, { ops: page, last: page.length ? page[page.length - 1].seq : after, more, serverTime: nowIso() });
}

// Tables are created once per database connection.
const schemaReady = new WeakMap();
async function ensureSchema(db) {
  if (!schemaReady.has(db)) schemaReady.set(db, db.batch(SCHEMA.map((sql) => ({ sql, args: [] }))).catch((err) => { schemaReady.delete(db); throw err; }));
  return schemaReady.get(db);
}

async function handle(request, env) {
  const db = env.db;
  try {
    await ensureSchema(db);
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    if (url.pathname === '/v1/health') return json(200, { ok: true, serverTime: nowIso() });
    if (request.method === 'POST' && url.pathname === '/v1/org/register') return await register(db, env, body);
    if (request.method === 'POST' && url.pathname === '/v1/join') return await join(db, body);
    const device = await authenticate(db, request);
    if (!device) return fail(401, 'UNAUTHORISED', 'This computer is not connected to the cloud, or it was blocked.');
    if (request.method === 'GET' && url.pathname === '/v1/hello') {
      const org = await db.get('SELECT id, code, name FROM orgs WHERE id = ?', [device.org_id]);
      return json(200, { org, branchId: device.branch_id, allBranches: !!device.all_branches, serverTime: nowIso() });
    }
    if (request.method === 'POST' && url.pathname === '/v1/push') return await push(db, device, body);
    if (request.method === 'GET' && url.pathname === '/v1/pull') return await pull(db, device, url);
    return fail(404, 'NOT_FOUND', 'Unknown request.');
  } catch (err) {
    console.error('gateway error', err && err.stack);
    return fail(500, 'SERVER', 'The cloud could not handle the request. Try again later.');
  }
}

module.exports = { handle, SCHEMA, sha256 };
