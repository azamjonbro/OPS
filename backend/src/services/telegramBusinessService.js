const crypto = require('../crypto');
const Integration = require('../models/Integration');
const TelegramBusinessConnection = require('../models/TelegramBusinessConnection');

const TELEGRAM_API = 'https://api.telegram.org';
const INTEGRATION_TYPE = 'TELEGRAM_BUSINESS';

function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || 'https://ops.techinfo.uz').replace(/\/+$/, '');
}

function randomSecret() {
  return require('crypto').randomBytes(24).toString('hex');
}

/**
 * Telegram "Business" bots: once the business account owner connects this bot in
 * Settings > Business > Chatbots, Telegram forwards every customer message in that
 * account's chats as a `business_message` update, tagged with a `business_connection_id`
 * that replies must be sent back through (via `sendMessage` with that id) so Telegram
 * delivers them as "the business", not as the bot.
 *
 * OPS NOTE (2026-08-07): the production host cannot accept inbound connections from
 * Telegram's webhook callers (confirmed via getWebhookInfo: "Connection timed out"),
 * while outbound HTTPS to api.telegram.org from that same host works fine. So instead of
 * `setWebhook`, this service long-polls `getUpdates` — an outbound call we make to
 * Telegram, not one Telegram makes to us — which sidesteps the inbound block entirely and
 * needs no proxy (unlike the raw-MTProto userbot in telegramUserbotService.js, which *is*
 * blocked outbound and does need one). The webhook route/controller are left in place but
 * unused; nothing calls setWebhook anymore.
 */
class TelegramBusinessService {
  constructor() {
    this.token = '';
    this.webhookSecret = '';
    this.botUsername = '';
    this._polling = false;
    this._updateOffset = 0;
  }

  /** Warms the in-memory token from Mongo at server boot, then resumes polling. */
  async loadFromDb() {
    try {
      const doc = await Integration.findOne({ type: INTEGRATION_TYPE });
      if (!doc || !doc.credentialsEncrypted) return;
      const creds = crypto.decryptJson(doc.credentialsEncrypted);
      this.token = creds.token || '';
      this.webhookSecret = creds.webhookSecret || '';
      this.botUsername = creds.botUsername || '';
      if (this.token) {
        console.log(`🤖 Telegram Business bot loaded from DB (@${this.botUsername || 'unknown'})`);
        await this.startPolling();
      }
    } catch (err) {
      console.error('Telegram Business loadFromDb error:', err.message);
    }
  }

  /**
   * getUpdates and an active webhook are mutually exclusive on Telegram's side (409
   * Conflict) — deleteWebhook first, keeping any already-queued updates (drop_pending_updates
   * stays false) so the switch doesn't lose messages that piled up while the webhook was
   * broken. Then loops getUpdates with a 30s long-poll timeout for as long as the process runs.
   */
  async startPolling() {
    if (!this.token || this._polling) return;
    this._polling = true;

    await this.apiCall('deleteWebhook', { drop_pending_updates: false });
    console.log('📡 Telegram Business: polling for updates (getUpdates) instead of webhook');

    this._pollLoop();
  }

  stopPolling() {
    this._polling = false;
  }

  async _pollLoop() {
    while (this._polling) {
      try {
        const res = await this.apiCall('getUpdates', {
          offset: this._updateOffset,
          timeout: 30,
          allowed_updates: ['business_connection', 'business_message', 'edited_business_message']
        });

        if (res.ok && res.data && Array.isArray(res.data.result)) {
          for (const update of res.data.result) {
            this._updateOffset = update.update_id + 1;
            await this.handleUpdate(update).catch((err) => {
              console.error('Telegram business update handling error:', err.message);
            });
          }
        } else if (!res.ok) {
          console.error('Telegram getUpdates failed:', (res.data && res.data.description) || res.status);
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      } catch (err) {
        console.error('Telegram business poll error:', err.message);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  isConfigured() {
    return !!this.token;
  }

  async apiCall(method, body) {
    const res = await fetch(`${TELEGRAM_API}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok, status: res.status, data };
  }

  /**
   * Validates the token against Telegram, starts polling for updates, and persists the
   * result (encrypted) into Mongo. This is the whole "paste token -> it just works" flow.
   */
  async saveToken(rawToken) {
    const token = (rawToken || '').trim();
    if (!token) return { success: false, error: "Token bo'sh bo'lishi mumkin emas" };

    const meRes = await fetch(`${TELEGRAM_API}/bot${token}/getMe`)
      .then((r) => r.json())
      .catch((e) => ({ ok: false, description: e.message }));

    if (!meRes || !meRes.ok) {
      return { success: false, error: (meRes && meRes.description) || 'Token yaroqsiz — Telegram getMe muvaffaqiyatsiz tugadi' };
    }

    const botUsername = (meRes.result && meRes.result.username) || '';
    const webhookSecret = randomSecret();

    this.token = token;
    this.webhookSecret = webhookSecret;
    this.botUsername = botUsername;
    this._updateOffset = 0;

    await this.startPolling();

    await Integration.findOneAndUpdate(
      { type: INTEGRATION_TYPE },
      {
        status: 'CONNECTED',
        name: 'Telegram Business Bot',
        credentialsEncrypted: crypto.encryptJson({ token, webhookSecret, botUsername }),
        settings: JSON.stringify({ mode: 'long-polling' }),
        healthCheckAt: new Date(),
        updatedAt: new Date()
      },
      { upsert: true }
    );

    return { success: true, botUsername, mode: 'long-polling' };
  }

  async healthCheck() {
    if (!this.token) return { isHealthy: false, message: 'Telegram Business token sozlanmagan' };
    const meRes = await fetch(`${TELEGRAM_API}/bot${this.token}/getMe`).then((r) => r.json()).catch(() => ({ ok: false }));
    if (!meRes || !meRes.ok) return { isHealthy: false, message: "Telegram bilan bog'lanib bo'lmadi" };
    return { isHealthy: true, message: `Ulangan: @${meRes.result.username}` };
  }

  verifyWebhookSecret(headerValue) {
    return !!this.webhookSecret && headerValue === this.webhookSecret;
  }

  async sendBusinessMessage({ businessConnectionId, chatId, text }) {
    if (!this.token) return { success: false, error: 'Bot token sozlanmagan' };
    const res = await this.apiCall('sendMessage', {
      business_connection_id: businessConnectionId,
      chat_id: chatId,
      text
    });
    if (!res.ok) return { success: false, error: (res.data && res.data.description) || 'sendMessage failed' };
    return { success: true, data: res.data.result };
  }

  /** The "yozmoqda..." indicator on the customer's side — makes the AI reply feel human-timed. */
  async sendChatAction({ businessConnectionId, chatId, action = 'typing' }) {
    if (!this.token) return { success: false, error: 'Bot token sozlanmagan' };
    const res = await this.apiCall('sendChatAction', {
      business_connection_id: businessConnectionId,
      chat_id: chatId,
      action
    });
    if (!res.ok) return { success: false, error: (res.data && res.data.description) || 'sendChatAction failed' };
    return { success: true };
  }

  /**
   * Pings the account owner directly (regular sendMessage, no business_connection_id — this
   * is a bot->owner DM, not a reply-as-the-business message) when the sales agent escalates.
   * Requires the owner to have opened a chat with the bot at least once, per Bot API rules.
   */
  async notifyOwner(text) {
    if (!this.token) return { success: false, error: 'Bot token sozlanmagan' };
    const conn = await TelegramBusinessConnection.findOne({ isEnabled: true, telegramUserId: { $ne: '' } }).sort({ updatedAt: -1 }).lean();
    if (!conn || !conn.telegramUserId) return { success: false, error: "Egasining Telegram user ID'si topilmadi" };

    const res = await this.apiCall('sendMessage', { chat_id: conn.telegramUserId, text });
    if (!res.ok) return { success: false, error: (res.data && res.data.description) || 'notifyOwner sendMessage failed' };
    return { success: true, data: res.data.result };
  }

  /**
   * The connection id needed to send as "the business" to ANY of its chats — it's one id
   * per connected business account, not per customer chat. Used by the post-sync catch-up
   * (telegramSalesAgent.catchUpUnansweredChats) to reply to chats that were only ever seen
   * via the MTProto history sync and so never carried a businessConnectionId of their own.
   */
  async getActiveConnectionId() {
    const conn = await TelegramBusinessConnection.findOne({ isEnabled: true }).sort({ updatedAt: -1 }).lean();
    return conn ? conn.businessConnectionId : '';
  }

  async upsertConnection(conn) {
    if (!conn || !conn.id) return;
    const rights = conn.rights || {};
    try {
      await TelegramBusinessConnection.findOneAndUpdate(
        { businessConnectionId: conn.id },
        {
          telegramUserId: conn.user && conn.user.id ? String(conn.user.id) : '',
          isEnabled: conn.is_enabled !== false,
          canReply: !!rights.can_reply,
          updatedAt: new Date()
        },
        { upsert: true }
      );
    } catch (err) {
      console.error('TelegramBusinessConnection upsert error:', err.message);
    }
  }

  /** Entry point for every webhook update Telegram sends us. */
  async handleUpdate(update) {
    if (!update) return;

    if (update.business_connection) {
      await this.upsertConnection(update.business_connection);
      return;
    }

    if (update.business_message) {
      const telegramSalesAgent = require('./telegramSalesAgent');
      await telegramSalesAgent.handleIncomingMessage(update.business_message).catch((err) => {
        console.error('Telegram sales agent error:', err.message);
      });
    }
  }
}

module.exports = new TelegramBusinessService();
