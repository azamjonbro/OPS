const proxyPoolService = require('../services/proxyPoolService');
const asyncHandler = require('../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const rows = await proxyPoolService.listProxies(req.query.purpose);
  res.json({ success: true, proxies: rows });
}, 'Failed to list proxies');

/**
 * Bulk import, built for pasting a provider's raw dashboard list. Accepts either a clean
 * JSON array of {host, port, username, password, label} objects, or the plain-text format
 * proxy dashboards actually export — 4 data lines per proxy (host, port, username, password)
 * possibly interleaved with status/location noise lines, one proxy block per group of 4
 * "real" values. We only require host+port to look right; anything else on a line is ignored.
 */
const bulkImport = asyncHandler(async (req, res) => {
  const { purpose } = req.body;
  if (!purpose || !['openai', 'telegram_mtproto'].includes(purpose)) {
    return res.status(400).json({ success: false, error: "purpose 'openai' yoki 'telegram_mtproto' bo'lishi kerak" });
  }

  // Either a clean array of {host,port,username,password,label}, or raw pasted dashboard
  // text — the frontend just has one textarea, so we accept whichever shape shows up.
  let entries = req.body.entries;
  if (!Array.isArray(entries) && typeof req.body.rawText === 'string') {
    entries = proxyPoolService.parseRawProxyList(req.body.rawText);
  }
  if (!Array.isArray(entries) || !entries.length) {
    return res.status(400).json({ success: false, error: "Hech qanday proxy topilmadi — matn formatini tekshiring" });
  }

  const result = await proxyPoolService.bulkImport(purpose, entries);
  // Ack immediately — testing every imported proxy (MTProto handshakes especially) can take
  // minutes and must not hold the HTTP request open. The frontend polls GET /proxies instead.
  res.json({ success: true, ...result, testing: true });

  proxyPoolService.testAllForPurpose(purpose).catch((err) => {
    console.error('Proxy pool background test error:', err.message);
  });
}, 'Failed to import proxies');

const testAll = asyncHandler(async (req, res) => {
  const { purpose } = req.params;
  res.json({ success: true, testing: true });

  proxyPoolService.testAllForPurpose(purpose).catch((err) => {
    console.error('Proxy pool background test error:', err.message);
  });
}, 'Failed to test proxies');

const remove = asyncHandler(async (req, res) => {
  await proxyPoolService.removeProxy(req.params.id);
  res.json({ success: true });
}, 'Failed to remove proxy');

module.exports = { list, bulkImport, testAll, remove };
