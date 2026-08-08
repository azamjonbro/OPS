const ProxyServer = require('../models/ProxyServer');
const { proxiedFetch } = require('../utils/proxiedFetch');

const TEST_URLS = {
  // 401 (auth error) still means the proxy successfully reached OpenAI and OpenAI didn't
  // geo-block it — that's all this test needs to confirm, no real API key required.
  openai: 'https://api.openai.com/v1/models'
};

// Short in-memory cache so every OpenAI-bound request doesn't hit Mongo — refreshed
// whenever the pool changes (add/test/remove) or this TTL elapses.
const CACHE_TTL_MS = 30 * 1000;
let cache = { purpose: null, proxy: null, at: 0 };

function buildProxyUrl(doc) {
  const auth = doc.username ? `${encodeURIComponent(doc.username)}:${encodeURIComponent(doc.password || '')}@` : '';
  const scheme = doc.protocol === 'http' ? 'http' : 'socks5';
  return `${scheme}://${auth}${doc.host}:${doc.port}`;
}

/** Actual MTProto handshake through the candidate proxy — an HTTPS reachability check isn't
 * enough here, since raw MTProto (a different protocol/IP range) can be blocked independently
 * of plain HTTPS even through the same proxy. Requires TELEGRAM_API_ID/HASH (same source
 * telegramUserbotService.js reads) since a bare TCP connect isn't a meaningful enough test. */
async function testMtprotoProxy(doc) {
  const apiId = parseInt(process.env.TELEGRAM_API_ID || '0', 10);
  const apiHash = (process.env.TELEGRAM_API_HASH || '').trim();
  if (!apiId || !apiHash) return { ok: false, error: 'TELEGRAM_API_ID / TELEGRAM_API_HASH sozlanmagan' };

  const { TelegramClient, sessions } = require('teleproto');
  const client = new TelegramClient(new sessions.StringSession(''), apiId, apiHash, {
    connectionRetries: 1,
    proxy: {
      socksType: 5,
      ip: doc.host,
      port: doc.port,
      username: doc.username || undefined,
      password: doc.password || undefined,
      timeout: 10
    }
  });

  try {
    await client.connect();
    await client.disconnect().catch(() => {});
    return { ok: true, error: '' };
  } catch (err) {
    await client.disconnect().catch(() => {});
    return { ok: false, error: err.message };
  }
}

/** Real connectivity test — not just "is it in the DB" — so a dead proxy never gets used. */
async function testProxy(doc) {
  if (doc.purpose === 'telegram_mtproto') return testMtprotoProxy(doc);

  const proxyUrl = buildProxyUrl(doc);
  const testUrl = TEST_URLS[doc.purpose];
  if (!testUrl) return { ok: false, error: `No test URL for purpose "${doc.purpose}"` };

  try {
    const res = await proxiedFetch(testUrl, { proxyUrl, timeoutMs: 10000 });
    // 401 (missing/invalid key) means the proxy successfully reached OpenAI and OpenAI
    // served a real response — that's what "working" means here, no API key needed to test
    // it. A 403 with this specific error code means the request got there but the PROXY's
    // own exit IP is in a country OpenAI blocks — exactly the failure mode we're screening
    // for, so it must NOT count as working even though the HTTP round-trip itself succeeded.
    if (res.status === 401) return { ok: true, error: '' };
    const data = await res.json().catch(() => ({}));
    if (data && data.error && data.error.code === 'unsupported_country_region_territory') {
      return { ok: false, error: "Proxy IP OpenAI tomonidan bloklangan mintaqada" };
    }
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function testAndSave(doc) {
  const result = await testProxy(doc);
  doc.lastCheckedAt = new Date();
  doc.lastCheckOk = result.ok;
  doc.lastCheckError = result.error || '';
  await doc.save();
  return result;
}

/** Tests every active proxy for a purpose (sequentially — proxy checks are network-bound and
 * we don't want to hammer the provider), returns the updated docs. */
async function testAllForPurpose(purpose) {
  const docs = await ProxyServer.find({ purpose, isActive: true });
  const results = [];
  for (const doc of docs) {
    const result = await testAndSave(doc);
    results.push({ id: doc._id.toString(), host: doc.host, port: doc.port, ...result });
  }
  invalidateCache();
  return results;
}

function invalidateCache() {
  cache = { purpose: null, proxy: null, at: 0 };
}

/** The proxy to actually use right now for a purpose — lowest-priority confirmed-working
 * active proxy, or null if none (callers fall back to a direct, unproxied request). */
async function getWorkingProxy(purpose) {
  if (cache.purpose === purpose && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.proxy;
  }

  const doc = await ProxyServer.findOne({ purpose, isActive: true, lastCheckOk: true })
    .sort({ priority: 1, lastCheckedAt: -1 })
    .lean();

  // Both shapes on the same object: `.url` for proxiedFetch (SocksProxyAgent takes a URL
  // string), the raw fields for teleproto (its `proxy` option wants a plain object, not a URL).
  const proxy = doc
    ? {
        url: buildProxyUrl(doc),
        label: doc.label || `${doc.host}:${doc.port}`,
        host: doc.host,
        port: doc.port,
        username: doc.username,
        password: doc.password
      }
    : null;
  cache = { purpose, proxy, at: Date.now() };
  return proxy;
}

async function addProxy({ purpose, protocol = 'socks5', host, port, username = '', password = '', label = '', priority = 0 }) {
  const doc = await ProxyServer.findOneAndUpdate(
    { purpose, host, port },
    { protocol, username, password, label, priority, isActive: true },
    { upsert: true, new: true }
  );
  invalidateCache();
  return doc;
}

/** Bulk import + immediate test, for pasting a provider's proxy list in one shot. */
async function bulkImport(purpose, entries) {
  const created = [];
  for (const e of entries) {
    const doc = await addProxy({ purpose, ...e });
    created.push(doc);
  }
  const results = await testAllForPurpose(purpose);
  return { imported: created.length, results };
}

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * Parses the raw multi-line text you get pasting a proxy provider's dashboard table
 * (one cell per line, host/port/username/password followed by status/location noise lines).
 * Whenever a line looks like an IPv4 address, that starts a new proxy block: the next
 * non-empty line is the port, then username, then password. Everything else (timestamps,
 * "Working" status, flag emoji, country/city) is ignored — this is exactly the format
 * pasted from this session's proxy provider, and degrades gracefully (skips) on anything
 * that doesn't fit the pattern rather than throwing.
 */
function parseRawProxyList(text) {
  const lines = (text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const entries = [];

  for (let i = 0; i < lines.length; i++) {
    if (!IPV4_RE.test(lines[i])) continue;
    const host = lines[i];
    const port = parseInt(lines[i + 1], 10);
    const username = lines[i + 2];
    const password = lines[i + 3];
    if (!port || !username || !password) continue;

    const NOISE_RE = /^(working|offline|active|just now|\d+\s*(second|minute|hour|day)s?\s*ago)$/i;
    const label = lines.slice(i + 4, i + 9).find((l) => /^[A-Za-z ]{3,}$/.test(l) && !NOISE_RE.test(l)) || '';
    entries.push({ host, port, username, password, label });
  }

  return entries;
}

async function listProxies(purpose) {
  const filter = purpose ? { purpose } : {};
  return ProxyServer.find(filter).sort({ purpose: 1, priority: 1, lastCheckedAt: -1 }).lean();
}

async function removeProxy(id) {
  await ProxyServer.deleteOne({ _id: id });
  invalidateCache();
}

module.exports = {
  buildProxyUrl,
  testProxy,
  testAndSave,
  testAllForPurpose,
  getWorkingProxy,
  addProxy,
  bulkImport,
  parseRawProxyList,
  listProxies,
  removeProxy,
  invalidateCache
};
