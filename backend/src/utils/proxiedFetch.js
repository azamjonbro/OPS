const https = require('https');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');

/**
 * A fetch()-shaped wrapper around Node's https.request + an explicit proxy agent. Node's
 * global fetch (undici) does NOT accept a classic http.Agent via its `dispatcher` option —
 * SocksProxyAgent implements the older http.Agent interface, not undici's Dispatcher, so
 * `fetch(url, { dispatcher: socksAgent })` silently fails with a generic "fetch failed".
 * https.request's `agent` option is the interface SocksProxyAgent actually supports.
 */
function proxiedFetch(url, { method = 'GET', headers = {}, body, timeoutMs = 15000, proxyUrl } = {}) {
  return new Promise((resolve, reject) => {
    const agent = proxyUrl
      ? (proxyUrl.startsWith('socks') ? new SocksProxyAgent(proxyUrl, { timeout: timeoutMs }) : new HttpsProxyAgent(proxyUrl))
      : undefined;

    const req = https.request(url, { method, headers, agent, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: async () => text,
          json: async () => {
            try { return JSON.parse(text); } catch (e) { return {}; }
          }
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`proxiedFetch timed out after ${timeoutMs}ms`));
    });

    if (body) req.write(body);
    req.end();
  });
}

module.exports = { proxiedFetch };
