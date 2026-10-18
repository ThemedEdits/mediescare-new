'use strict';
// HTTP client for the sync protocol, used both for the Primary on the shop network and for the cloud gateway.
//   POST {base}/v1/push   { ops }                 -> { accepted, duplicates, serverTime }
//   GET  {base}/v1/pull?after=N&limit=M           -> { ops, last, more, serverTime }
//   GET  {base}/v1/hello                          -> { org, branch, serverTime }
// Every call carries the device token. Errors become PeerError with a plain message for the sync screen.

class PeerError extends Error {
  constructor(message, { code = 'PEER', status = 0 } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function makePeer({ baseUrl, token, timeoutMs = 20000, fetchImpl = globalThis.fetch }) {
  const base = String(baseUrl).replace(/\/+$/, '');

  async function request(method, path, body) {
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new PeerError('Could not reach the other computer or the cloud. Check the network.', { code: 'OFFLINE' });
    }
    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (!res.ok) {
      const msg = data && data.error ? data.error : `The server answered with an error (${res.status}).`;
      throw new PeerError(msg, { code: (data && data.code) || (res.status === 401 ? 'UNAUTHORISED' : 'SERVER'), status: res.status });
    }
    return data;
  }

  return {
    base,
    hello: () => request('GET', '/v1/hello'),
    push: (ops) => request('POST', '/v1/push', { ops }),
    pull: (after, limit = 500) => request('GET', `/v1/pull?after=${encodeURIComponent(after)}&limit=${limit}`),
    post: (path, body) => request('POST', path, body),
  };
}

module.exports = { makePeer, PeerError };
