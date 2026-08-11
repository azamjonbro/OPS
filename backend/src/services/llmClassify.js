const { proxiedFetch } = require('../utils/proxiedFetch');
const proxyPoolService = require('./proxyPoolService');

/**
 * The "one JSON classification call, fail-safe on any error" pattern — used for mail
 * sender filtering, Telegram sales-inquiry triage, and spreadsheet-import intent — was
 * duplicated three times with identical fetch/parse/fallback boilerplate. This is the
 * one copy; callers only supply the prompt, the input, and what to return on failure.
 *
 * Deliberately narrow: callers that need free-form text, tool-calling, or multi-turn
 * context (routeToTools, draftReply, the narrative model) don't fit this shape and stay
 * as their own fetch calls rather than being forced through here.
 */
async function classifyJson({ apiKey, model = 'gpt-5-mini', systemPrompt, userContent, fallback }) {
  if (!apiKey) return fallback;

  try {
    // OpenAI geo-blocks some hosting regions outright (403 unsupported_country_region_territory)
    // — when that's the case, route through a DB-managed working proxy instead. No proxy
    // configured/working just means a direct call, so this is a no-op where OpenAI isn't blocked.
    const proxy = await proxyPoolService.getWorkingProxy('openai').catch(() => null);

    const resp = await proxiedFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        // gpt-5-mini only supports the default temperature (1) — passing 0 400s.
        // Simple JSON classification doesn't need gpt-5's chain-of-thought reasoning —
        // 'minimal' skips it, cutting completion tokens ~5x on this high-volume path
        // (called on every inbound Telegram message).
        reasoning_effort: 'minimal',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ]
      }),
      proxyUrl: proxy && proxy.url
    });

    if (!resp.ok) return fallback;
    const data = await resp.json();
    const raw = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    console.error('llmClassify failed:', err.message);
    return fallback;
  }
}

module.exports = { classifyJson };
