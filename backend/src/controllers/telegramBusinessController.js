const telegramBusinessService = require('../services/telegramBusinessService');

/**
 * POST /api/telegram/business-webhook — Telegram calls this for every update. We ack
 * immediately (Telegram retries on timeout/non-200) and process afterwards, since the
 * sales pipeline makes multiple LLM/Billz round-trips that would otherwise blow past
 * Telegram's short webhook timeout.
 */
const receiveWebhook = (req, res) => {
  const secretHeader = req.get('X-Telegram-Bot-Api-Secret-Token');
  if (!telegramBusinessService.verifyWebhookSecret(secretHeader)) {
    return res.sendStatus(401);
  }

  res.sendStatus(200);

  telegramBusinessService.handleUpdate(req.body).catch((err) => {
    console.error('Telegram business webhook handling error:', err.message);
  });
};

module.exports = { receiveWebhook };
