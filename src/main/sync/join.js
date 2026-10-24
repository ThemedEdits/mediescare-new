'use strict';
// First start on a computer joining an existing organisation.
//   Cloud: becomes the main computer of a branch (organisation code + a one-time join code made at Head Office for that
//          branch), or the replacement Head Office computer (organisation code + the organisation recovery key). The
//          manager then signs in on this computer, checked against the users that were downloaded (services/setup.js).
//   LAN:   becomes an extra computer of the branch (the main computer's pairing code + a manager's login).
// The new computer then downloads everything it is allowed to see and applies it, before anyone signs in.
const { newId, nowIso } = require('../core/ids');
const { AppError } = require('../core/errors');
const { t } = require('../core/messages');
const { makePeer, PeerError } = require('./peer');
const { applyOps } = require('./apply');
const { setCursor, logSync } = require('./ops');

function friendly(err) {
  if (err instanceof PeerError) return new AppError(err.code === 'OFFLINE' ? 'OFFLINE' : 'JOIN_FAILED', err.message);
  return err;
}

// Downloads every operation the peer has for this computer.
async function download(app, peer, peerName) {
  let after = 0;
  let total = 0;
  for (let round = 0; round < 100000; round++) {
    const res = await peer.pull(after, 300);
    if (res.ops.length) applyOps(app.db, res.ops, { source: peerName });
    total += res.ops.length;
    after = res.last;
    if (!res.more) break;
  }
  setCursor(app.db, peerName, 'pull', after);
  // Everything downloaded came from the peer; there is nothing of ours to send back yet.
  const max = app.db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM sync_ops').get().s;
  setCursor(app.db, peerName, 'push', max);
  return total;
}

function assertEmpty(app) {
  if (app.isSetUp() || app.db.prepare('SELECT COUNT(*) AS n FROM org').get().n > 0) throw new AppError('ALREADY_SET_UP', t('setup.alreadyDone'));
}

function finish(app, { deviceId, orgId }) {
  app.localSet('device_id', deviceId);
  app.localSet('org_id', orgId);
  app.loadDevice();
  if (!app.device) throw new AppError('JOIN_FAILED', t('setup.joinIncomplete'));
}

async function joinCloud(app, { cloudUrl, orgCode, joinCode, recoveryKey, deviceName, fetchImpl }) {
  assertEmpty(app);
  if (!cloudUrl) throw new AppError('SYNC_NOT_AVAILABLE', t('setup.joinNeedsSync'));
  const deviceId = newId();
  const open = makePeer({ baseUrl: cloudUrl, token: null, fetchImpl });
  let res;
  try {
    res = await open.post('/v1/join', { orgCode, joinCode: joinCode || undefined, recoveryKey: joinCode ? undefined : recoveryKey, deviceId, deviceName });
  } catch (err) { throw friendly(err); }
  const peer = makePeer({ baseUrl: cloudUrl, token: res.token, fetchImpl, timeoutMs: 120000 });
  try { await download(app, peer, 'cloud'); } catch (err) { throw friendly(err); }
  if (!app.db.prepare('SELECT 1 FROM branches WHERE id = ?').get(res.branchId)) throw new AppError('JOIN_FAILED', t('setup.joinIncomplete'));
  app.localSet('cloud_token', res.token);
  app.localSet('cloud_url', cloudUrl);
  // Register this computer as the branch's main computer and mark the join code used; both rows travel to the cloud
  // (and to Head Office) with the next sync. Who registered it is filled in once the manager has signed in.
  const now = nowIso();
  app.db.transaction(() => {
    app.db.prepare('UPDATE sync_ctx SET device_id = ? WHERE id = 1').run(deviceId);
    app.db.prepare(`INSERT INTO devices (id, branch_id, device_no, name, kind, registered_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'primary', NULL, ?, ?)`)
      .run(deviceId, res.branchId, res.deviceNo, deviceName, now, now);
    if (joinCode) {
      app.db.prepare('UPDATE join_codes SET used_at = ?, used_device_id = ?, updated_at = ? WHERE code_hash = ? AND used_at IS NULL')
        .run(now, deviceId, now, require('../core/joincodes').hash(joinCode));
    }
  })();
  finish(app, { deviceId, orgId: res.orgId });
  logSync(app.db, { channel: 'cloud', direction: 'pull', status: 'info', message: joinCode ? 'Joined the organisation from the cloud with a join code' : 'Joined as the Head Office computer with the recovery key' });
  return { branchId: res.branchId, allBranches: !!res.allBranches };
}

async function joinLan(app, { primaryUrl, pairingCode, username, password, deviceName, fetchImpl }) {
  assertEmpty(app);
  const deviceId = newId();
  const open = makePeer({ baseUrl: primaryUrl, token: null, fetchImpl });
  let res;
  try {
    res = await open.post('/lan/pair', { pairingCode, username, password, deviceId, deviceName });
  } catch (err) { throw friendly(err); }
  const peer = makePeer({ baseUrl: primaryUrl, token: res.token, fetchImpl, timeoutMs: 120000 });
  try { await download(app, peer, 'lan'); } catch (err) { throw friendly(err); }
  app.localSet('lan_token', res.token);
  app.localSet('primary_url', primaryUrl);
  app.db.prepare('UPDATE sync_ctx SET device_id = ? WHERE id = 1').run(deviceId);
  finish(app, { deviceId, orgId: res.orgId });
  logSync(app.db, { channel: 'lan', direction: 'pull', status: 'info', message: 'Joined the branch from the main computer' });
  return { userId: res.userId, branchId: res.branchId };
}

module.exports = { joinCloud, joinLan, download };
