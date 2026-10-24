'use strict';
// The Primary computer's service on the shop network. Other computers of the branch pair once (6-digit code shown on
// the Primary + a manager's login) and then push and pull operations here. Also answers discovery broadcasts.
const http = require('http');
const dgram = require('dgram');
const crypto = require('crypto');
const { newId, nowIso } = require('../core/ids');
const { verifyPassword } = require('../core/password');
const { permissionSet } = require('../rpc');
const audit = require('../core/audit');
const log = require('../core/log');
const { applyOps, validOp } = require('./apply');
const { readOps, lastSeq } = require('./ops');

const DEFAULT_PORT = 47800;
const DISCOVERY_PORT = 47801;
const CODE_MS = 10 * 60 * 1000;
const MAX_BODY = 25 * 1024 * 1024;

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

class LanServer {
  constructor(app, { port = DEFAULT_PORT, discovery = true } = {}) {
    this.app = app;
    this.port = port;
    this.discoveryEnabled = discovery;
    this.code = null;
    this.failedPairs = [];
    this.server = null;
    this.udp = null;
    this.onChange = null; // called after clients push, so the engine can relay to the cloud
  }

  get db() { return this.app.db; }

  // A fresh pairing code, shown on the Primary to the person setting up the new computer.
  newPairingCode(userId) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    this.code = { code, expires: Date.now() + CODE_MS, by: userId };
    return { code, expiresAt: new Date(this.code.expires).toISOString() };
  }

  authenticate(req) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) return null;
    const row = this.db.prepare('SELECT * FROM lan_tokens WHERE token_hash = ? AND revoked_at IS NULL').get(sha256(m[1]));
    if (!row) return null;
    const device = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(row.device_id);
    if (!device || device.revoked_at) return null;
    this.db.prepare('UPDATE lan_tokens SET last_seen_at = ? WHERE token_hash = ?').run(nowIso(), row.token_hash);
    const branch = this.db.prepare('SELECT is_head_office FROM branches WHERE id = ?').get(row.branch_id);
    return { ...row, allBranches: !!(branch && branch.is_head_office) };
  }

  hello() {
    const org = this.db.prepare('SELECT id, code, name FROM org LIMIT 1').get();
    const d = this.app.device;
    return { app: 'mediescare', org, branch: { id: d.branch_id, code: d.branch_code, name: d.branch_name }, deviceName: d.name, port: this.port, serverTime: nowIso(), seq: lastSeq(this.db) };
  }

  async pair(body) {
    // Slow down guessing: five wrong codes block pairing for ten minutes.
    this.failedPairs = this.failedPairs.filter((t) => Date.now() - t < CODE_MS);
    if (this.failedPairs.length >= 5) return [429, { code: 'BLOCKED', error: 'Too many wrong pairing codes. Wait ten minutes and make a new code on the main computer.' }];
    if (!this.code || this.code.expires < Date.now() || String(body.pairingCode || '') !== this.code.code) {
      this.failedPairs.push(Date.now());
      return [403, { code: 'BAD_CODE', error: 'The pairing code is wrong or has expired. Make a new code on the main computer.' }];
    }
    const user = this.db.prepare(`SELECT u.*, r.permissions AS role_permissions, r.is_super, r.active AS role_active FROM users u JOIN roles r ON r.id = u.role_id WHERE u.username = ? COLLATE NOCASE`).get(String(body.username || ''));
    if (!user || !(await verifyPassword(String(body.password || ''), user.password_hash)) || user.status !== 'active' || !user.role_active) {
      this.failedPairs.push(Date.now());
      return [403, { code: 'BAD_LOGIN', error: 'The username or password is not correct.' }];
    }
    const perms = permissionSet(user);
    if (!(user.is_super === 1 || perms.has('devices.edit'))) return [403, { code: 'FORBIDDEN', error: 'This user may not add computers. Ask the branch manager.' }];
    const branchId = this.app.device.branch_id;
    if (user.branch_id !== branchId && !(user.is_super === 1 || perms.has('branches.view_all'))) return [403, { code: 'FORBIDDEN', error: 'This user does not belong to this branch.' }];
    const deviceId = typeof body.deviceId === 'string' && /^[0-9A-Z]{26}$/.test(body.deviceId) ? body.deviceId : newId();
    const name = String(body.deviceName || 'Counter').slice(0, 60);
    const token = crypto.randomBytes(32).toString('hex');
    const now = nowIso();
    let deviceNo;
    this.db.transaction(() => {
      // Numbers in this branch are handed out only by its Primary, so two computers never share one.
      deviceNo = this.db.prepare('SELECT COALESCE(MAX(device_no), 0) + 1 AS n FROM devices WHERE branch_id = ?').get(branchId).n;
      this.db.prepare(`INSERT INTO devices (id, branch_id, device_no, name, kind, registered_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'client', ?, ?, ?)`)
        .run(deviceId, branchId, deviceNo, name, user.id, now, now);
      this.db.prepare('INSERT INTO lan_tokens (token_hash, device_id, device_name, branch_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(sha256(token), deviceId, name, branchId, user.id, now);
      audit.write(this.db, { userId: user.id, username: user.username, branchId, deviceId: this.app.device.id }, { module: 'devices', action: 'pair', recordType: 'device', recordId: deviceId, summary: `Computer ${name} paired as number ${deviceNo}` });
    })();
    this.code = null;
    const org = this.db.prepare('SELECT id, code FROM org LIMIT 1').get();
    const branch = this.db.prepare('SELECT is_head_office FROM branches WHERE id = ?').get(branchId);
    if (this.onChange) this.onChange();
    return [200, { token, deviceId, deviceNo, branchId, orgId: org.id, orgCode: org.code, allBranches: !!branch.is_head_office, userId: user.id, serverTime: now }];
  }

  push(client, body) {
    const ops = Array.isArray(body.ops) ? body.ops : [];
    // A branch computer may only send rows of its own branch or shared rows.
    const allowed = ops.filter((op) => validOp(op) && (client.allBranches || !op.branch_id || op.branch_id === client.branch_id || op.branch_id2 === client.branch_id));
    const res = applyOps(this.db, allowed, { source: `lan:${client.device_id}` });
    if (res.applied && this.onChange) this.onChange();
    return { accepted: res.applied, duplicates: res.duplicates, rejected: ops.length - allowed.length, handled: ops.length, serverTime: nowIso() };
  }

  pull(client, url) {
    const after = Math.max(Number(url.searchParams.get('after')) || 0, 0);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 500, 1), 2000);
    const ops = readOps(this.db, { after, limit: limit + 1, branchId: client.branch_id, allBranches: client.allBranches, excludeSource: `lan:${client.device_id}` });
    const more = ops.length > limit;
    const page = ops.slice(0, limit);
    return { ops: page, last: page.length ? page[page.length - 1].seq : after, more, serverTime: nowIso() };
  }

  async handle(req, res) {
    try {
      const url = new URL(req.url, 'http://lan');
      if (req.method === 'GET' && url.pathname === '/v1/hello') return send(res, 200, this.hello());
      if (req.method === 'POST' && url.pathname === '/lan/pair') {
        const [status, data] = await this.pair(await readBody(req));
        return send(res, status, data);
      }
      const client = this.authenticate(req);
      if (!client) return send(res, 401, { code: 'UNAUTHORISED', error: 'This computer is not paired, or it was blocked. Pair it again.' });
      if (req.method === 'POST' && url.pathname === '/v1/push') return send(res, 200, this.push(client, await readBody(req)));
      if (req.method === 'GET' && url.pathname === '/v1/pull') return send(res, 200, this.pull(client, url));
      return send(res, 404, { code: 'NOT_FOUND', error: 'Unknown request.' });
    } catch (err) {
      log.error('LAN request failed', err && err.stack);
      return send(res, 500, { code: 'SERVER', error: 'The main computer could not handle the request.' });
    }
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => { this.handle(req, res); });
      this.server.keepAliveTimeout = 30000;
      this.server.once('error', reject);
      this.server.listen(this.port, '0.0.0.0', () => {
        this.port = this.server.address().port;
        if (this.discoveryEnabled) this.startDiscovery();
        resolve(this.port);
      });
    });
  }

  // Answers "is there a Mediescare main computer here?" broadcasts from computers being set up.
  startDiscovery() {
    try {
      this.udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.udp.on('message', (msg, rinfo) => {
        if (String(msg).trim() !== 'MEDIESCARE?') return;
        const h = this.hello();
        const reply = Buffer.from(JSON.stringify({ app: 'mediescare', orgCode: h.org.code, orgName: h.org.name, branchCode: h.branch.code, branchName: h.branch.name, deviceName: h.deviceName, port: this.port }));
        this.udp.send(reply, rinfo.port, rinfo.address);
      });
      this.udp.on('error', (err) => { log.warn('Discovery socket error', err.message); });
      this.udp.bind(DISCOVERY_PORT);
    } catch (err) { log.warn('Discovery not available', err.message); }
  }

  stop() {
    if (this.udp) { try { this.udp.close(); } catch (_) { /* already closed */ } this.udp = null; }
    return new Promise((resolve) => { if (!this.server) return resolve(); this.server.close(() => resolve()); this.server.closeAllConnections && this.server.closeAllConnections(); this.server = null; });
  }
}

// Asks the network for main computers. Resolves with the list of answers after `waitMs`.
function discover({ waitMs = 1500 } = {}) {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket('udp4');
    sock.on('message', (msg, rinfo) => {
      try {
        const info = JSON.parse(String(msg));
        if (info.app === 'mediescare') found.set(`${rinfo.address}:${info.port}`, { ...info, address: rinfo.address, url: `http://${rinfo.address}:${info.port}` });
      } catch (_) { /* not ours */ }
    });
    sock.on('error', () => { try { sock.close(); } catch (_) { /* ignore */ } resolve([...found.values()]); });
    sock.bind(0, () => {
      sock.setBroadcast(true);
      sock.send(Buffer.from('MEDIESCARE?'), DISCOVERY_PORT, '255.255.255.255');
    });
    setTimeout(() => { try { sock.close(); } catch (_) { /* ignore */ } resolve([...found.values()]); }, waitMs);
  });
}

module.exports = { LanServer, discover, sha256, DEFAULT_PORT, DISCOVERY_PORT };
