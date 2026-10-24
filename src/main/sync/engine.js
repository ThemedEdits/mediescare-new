'use strict';
// Runs sync in the background.
//   Primary: serves the shop network (LanServer) and exchanges operations with the cloud gateway when online.
//   Client:  exchanges operations with its Primary over the shop network.
// Each exchange is push-then-pull. Cursors only move after the other side has confirmed, so a crash or a lost
// connection at any point simply repeats the last batch, which the other side ignores as duplicates.
const { nowIso } = require('../core/ids');
const log = require('../core/log');
const config = require('../config');
const { makePeer, PeerError } = require('./peer');
const { applyOps } = require('./apply');
const { readOps, getCursor, setCursor, pending, logSync } = require('./ops');

// Batch sizes stay below the gateway's limits (gateway/src/handler.js MAX_PUSH / MAX_PULL = 300).
const PUSH_BATCH = 250;
const PULL_BATCH = 300;
const { LanServer } = require('./lan-server');

const LAN_EVERY_MS = 4000;
const CLOUD_EVERY_MS = 30000;
const MAX_BACKOFF_MS = 120000;
const SKEW_WARN_MS = 2 * 60 * 1000;

function channelState() {
  return { configured: false, state: 'not_set_up', lastOk: null, lastError: null, lastAttempt: null, clockSkewMs: null, pending: 0 };
}

class SyncEngine {
  constructor(app, { lanPort = config.lanPort, cloudUrl = config.cloudUrl, fetchImpl, discovery = true, autoStart = true } = {}) {
    this.app = app;
    this.lanPort = lanPort;
    this.cloudUrl = cloudUrl;
    this.fetchImpl = fetchImpl;
    this.discovery = discovery;
    this.autoStart = autoStart;
    this.lan = channelState();
    this.cloud = channelState();
    this.server = null;
    this.timers = {};
    this.running = {};
    this.failures = { lan: 0, cloud: 0 };
  }

  get db() { return this.app.db; }
  get device() { return this.app.device; }

  local(key) { return this.app.localGet(key); }

  // ---- peers ----
  lanPeer() {
    const url = this.local('primary_url');
    const token = this.local('lan_token');
    return url && token ? makePeer({ baseUrl: url, token, fetchImpl: this.fetchImpl }) : null;
  }

  cloudPeer() {
    const token = this.local('cloud_token');
    const url = this.local('cloud_url') || this.cloudUrl;
    return url && token ? makePeer({ baseUrl: url, token, fetchImpl: this.fetchImpl }) : null;
  }

  // ---- one exchange ----
  async exchange(channel, peer, peerName) {
    let pushed = 0;
    let pulled = 0;
    // Push: everything after the push cursor, except what came from this same peer.
    for (let round = 0; round < 200; round++) {
      const ops = readOps(this.db, { after: getCursor(this.db, peerName, 'push'), limit: PUSH_BATCH, excludeSource: peerName });
      if (!ops.length) {
        // Nothing to send: move the cursor past rows that were skipped because they came from this peer.
        const max = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM sync_ops').get().s;
        setCursor(this.db, peerName, 'push', max);
        break;
      }
      const res = await peer.push(ops);
      this.noteClock(channel, res.serverTime);
      // Move the cursor only past what the other side handled (stored or refused for scope); if it took fewer than were
      // sent, the rest goes again next round, so nothing is lost.
      const handled = Number.isInteger(res.handled) ? Math.min(res.handled, ops.length) : ops.length;
      if (handled <= 0) break;
      setCursor(this.db, peerName, 'push', ops[handled - 1].seq);
      pushed += handled;
    }
    // Pull: the peer's operations after our pull cursor (the peer's own numbering).
    for (let round = 0; round < 400; round++) {
      const res = await peer.pull(getCursor(this.db, peerName, 'pull'), PULL_BATCH);
      this.noteClock(channel, res.serverTime);
      if (res.ops && res.ops.length) {
        applyOps(this.db, res.ops, { source: peerName });
        pulled += res.ops.length;
      }
      setCursor(this.db, peerName, 'pull', res.last);
      if (!res.more) break;
    }
    return { pushed, pulled };
  }

  noteClock(channel, serverTime) {
    if (!serverTime) return;
    this[channel].clockSkewMs = Date.parse(serverTime) - Date.now();
  }

  async run(channel) {
    if (this.stopped || !this.app.db) return null;
    if (this.running[channel]) return this.running[channel];
    const st = this[channel];
    const peer = channel === 'lan' ? this.lanPeer() : this.cloudPeer();
    const peerName = channel === 'lan' ? 'lan' : 'cloud';
    if (!peer) { st.configured = false; st.state = 'not_set_up'; return null; }
    st.configured = true;
    st.state = 'syncing';
    st.lastAttempt = nowIso();
    const job = (async () => {
      try {
        const { pushed, pulled } = await this.exchange(channel, peer, peerName);
        st.state = 'synced';
        st.lastOk = nowIso();
        st.lastError = null;
        this.failures[channel] = 0;
        if (pushed || pulled) logSync(this.db, { channel, direction: 'both', status: 'ok', pushed, pulled, message: `${pushed} sent, ${pulled} received` });
        if (pulled) this.afterPull();
        return { pushed, pulled };
      } catch (err) {
        this.failures[channel] += 1;
        st.state = err instanceof PeerError && err.code === 'OFFLINE' ? 'offline' : 'error';
        st.lastError = err.message;
        // An offline network is normal; log it once per outage, not every few seconds.
        if (st.state === 'error' || this.failures[channel] === 1) logSync(this.db, { channel, direction: 'both', status: 'error', message: err.message });
        if (!(err instanceof PeerError)) log.error('Sync failed', channel, err && err.stack);
        return null;
      } finally {
        st.pending = this.pendingFor(channel);
        this.running[channel] = null;
      }
    })();
    this.running[channel] = job;
    return job;
  }

  pendingFor(channel) {
    const peerName = channel === 'lan' ? 'lan' : 'cloud';
    if (channel === 'lan' && !this.lanPeer()) return 0;
    if (channel === 'cloud' && !this.cloudPeer()) return 0;
    return pending(this.db, peerName, { excludeSource: peerName });
  }

  // Received data may change what the open screens show; the device row may have arrived too.
  afterPull() {
    try { this.app.loadDevice(); } catch (_) { /* keep running */ }
  }

  schedule(channel, every) {
    clearTimeout(this.timers[channel]);
    const backoff = Math.min(every * 2 ** Math.min(this.failures[channel], 5), MAX_BACKOFF_MS);
    this.timers[channel] = setTimeout(async () => {
      await this.run(channel);
      this.schedule(channel, every);
    }, this.failures[channel] ? backoff : every);
    if (this.timers[channel].unref) this.timers[channel].unref();
  }

  // ---- lifecycle ----
  async start() {
    this.stopped = false;
    if (!this.device) return;
    if (this.device.kind === 'primary') {
      await this.startServer();
      if (this.cloudPeer()) this.cloud.configured = true;
      else if (this.cloudUrl && this.device.is_head_office) await this.registerOrg().catch((err) => { this.cloud.lastError = err.message; });
    }
    this.lan.configured = this.device.kind === 'primary' ? !!this.server : !!this.lanPeer();
    if (this.autoStart) {
      if (this.device.kind === 'client') this.schedule('lan', LAN_EVERY_MS);
      if (this.cloudPeer() || this.cloudUrl) this.schedule('cloud', CLOUD_EVERY_MS);
    }
  }

  async startServer() {
    this.stopped = false;
    if (this.server) return this.server.port;
    if (this.local('lan_enabled') === '0') return null;
    this.server = new LanServer(this.app, { port: this.lanPort, discovery: this.discovery });
    // When a counter computer sends sales, pass them on to the cloud soon.
    this.server.onChange = () => {
      if (!this.cloudPeer() || this.timers.relay) return;
      this.timers.relay = setTimeout(() => { delete this.timers.relay; this.run('cloud'); }, 500);
    };
    try {
      await this.server.start();
      this.lan.state = 'synced';
      return this.server.port;
    } catch (err) {
      this.lan.state = 'error';
      this.lan.lastError = `The shop network service could not start (port ${this.lanPort} may be in use).`;
      log.error('LAN server failed', err && err.message);
      this.server = null;
      return null;
    }
  }

  async stop() {
    this.stopped = true;
    for (const t of Object.values(this.timers)) clearTimeout(t);
    this.timers = {};
    if (this.server) await this.server.stop();
    this.server = null;
  }

  // Head Office registers the organisation with the gateway once, then sends everything it has.
  async registerOrg(setupKey = config.cloudSetupKey) {
    const org = this.db.prepare('SELECT * FROM org LIMIT 1').get();
    const peer = makePeer({ baseUrl: this.cloudUrl, token: null, fetchImpl: this.fetchImpl });
    const res = await peer.post('/v1/org/register', { orgId: org.id, orgCode: org.code, orgName: org.name, deviceId: this.device.id, deviceName: this.device.name, branchId: this.device.branch_id, setupKey });
    this.app.localSet('cloud_token', res.token);
    this.app.localSet('cloud_url', this.cloudUrl);
    this.cloud.configured = true;
    logSync(this.db, { channel: 'cloud', direction: 'both', status: 'info', message: 'Organisation registered with the cloud' });
    return res;
  }

  status() {
    for (const ch of ['lan', 'cloud']) this[ch].pending = this.pendingFor(ch);
    const kind = this.device ? this.device.kind : null;
    return {
      role: kind, lan: { ...this.lan, serving: !!this.server, port: this.server ? this.server.port : null, primaryUrl: this.local('primary_url') },
      cloud: { ...this.cloud, url: this.local('cloud_url') || this.cloudUrl || null },
      clockWarning: ['lan', 'cloud'].some((ch) => this[ch].clockSkewMs !== null && Math.abs(this[ch].clockSkewMs) > SKEW_WARN_MS),
    };
  }
}

module.exports = { SyncEngine, LAN_EVERY_MS, CLOUD_EVERY_MS };
