const proxyPoolService = require('../services/proxyPoolService');
const { proxiedFetch } = require('./proxiedFetch');

// OpenAI geo-blocks some hosting regions outright (403 unsupported_country_region_territory)
// — every direct OpenAI call routes through the DB-managed proxy pool (admin panel -> Proxy
// Pool, purpose "openai") when one is configured and working. No working proxy just means a
// direct call, so this is a no-op where OpenAI isn't blocked. Shared by aiEngine.js and
// chatController.js's Whisper transcription so neither can drift back to a raw fetch().
async function openAiFetch(url, options) {
  const proxy = await proxyPoolService.getWorkingProxy('openai').catch(() => null);
  return proxiedFetch(url, { ...options, proxyUrl: proxy && proxy.url });
}

module.exports = { openAiFetch };
