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
 * account's chats to our webhook as a `business_message` update, tagged with a
 * `business_connection_id` that replies must be sent back through (via `sendMessage`
 * with that id) so Telegram delivers them as "the business", not as the bot.
 */
class TelegramBusinessService {
  constructor() {
    this.token = '';
    this.webhookSecret = '';
    this.botUsername = '';
  }

  /** Warms the in-memory token from Mongo at server boot — no re-paste needed after a restart. */
  async loadFromDb() {
    try {
      const doc = await Integration.findOne({ type: INTEGRATION_TYPE });
      if (!doc || !doc.credentialsEncrypted) return;
      const creds = crypto.decryptJson(doc.credentialsEncrypted);
      this.token = creds.token || '';
      this.webhookSecret = creds.webhookSecret || '';
      this.botUsername = creds.botUsername || '';
      if (this.token) console.log(`🤖 Telegram Business bot loaded from DB (@${this.botUsername || 'unknown'})`);
    } catch (err) {
      console.error('Telegram Business loadFromDb error:', err.message);
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
   * Validates the token against Telegram, registers the webhook, and persists the
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
    const webhookUrl = `${publicBaseUrl()}/api/telegram/business-webhook`;

    // Set live before calling setWebhook — apiCall() reads this.token.
    this.token = token;
    this.webhookSecret = webhookSecret;
    this.botUsername = botUsername;

    const hookRes = await this.apiCall('setWebhook', {
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: ['business_connection', 'business_message', 'edited_business_message']
    });

    if (!hookRes.ok) {
      this.token = '';
      this.webhookSecret = '';
      return { success: false, error: (hookRes.data && hookRes.data.description) || 'setWebhook muvaffaqiyatsiz tugadi', botUsername };
    }

    await Integration.findOneAndUpdate(
      { type: INTEGRATION_TYPE },
      {
        status: 'CONNECTED',
        name: 'Telegram Business Bot',
        credentialsEncrypted: crypto.encryptJson({ token, webhookSecret, botUsername }),
        settings: JSON.stringify({ webhookUrl }),
        healthCheckAt: new Date(),
        updatedAt: new Date()
      },
      { upsert: true }
    );

    return { success: true, botUsername, webhookUrl };
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
