const { TelegramClient, Api, sessions, password: PasswordUtil } = require('teleproto');

const { StringSession } = sessions;
const crypto = require('../crypto');
const Integration = require('../models/Integration');
const TelegramCustomerMessage = require('../models/TelegramCustomerMessage');

const INTEGRATION_TYPE = 'TELEGRAM_USERBOT';
const HISTORY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // 90 days — see plan: bounded to limit flood-wait risk

/**
 * MTProto "userbot" — logs into the owner's own Telegram account (not the Bot API) so we
 * can backfill chat history the Business Bot API structurally cannot see (it only gets
 * messages sent after the webhook was registered). Primarily read-only: the automatic sales
 * agent (telegramSalesAgent.js) sends exclusively through telegramBusinessService, so
 * replies are delivered as "the business", not the owner's personal account. sendMessage()
 * below exists only as a manual fallback for when the Business webhook itself is down (see
 * ops notes) and a real customer message needs a real reply right now regardless.
 */
class TelegramUserbotService {
  constructor() {
    this.apiId = 0;
    this.apiHash = '';
    this.client = null;
    this.sessionString = '';
    this.phone = '';
    this.status = 'DISCONNECTED'; // DISCONNECTED | AWAITING_CODE | AWAITING_PASSWORD | CONNECTED
    this.lastSyncAt = null;
    this.lastSyncStats = null;
    this._pendingLogin = null; // { client, phone, phoneCodeHash }
    this._syncing = false;
  }

  loadEnvCreds() {
    this.apiId = parseInt(process.env.TELEGRAM_API_ID || '0', 10);
    this.apiHash = (process.env.TELEGRAM_API_HASH || '').trim();
  }

  /**
   * Raw MTProto (unlike the plain-HTTPS Bot API) is network-blocked on the production host —
   * see the ops notes in services/telegramBusinessService.js. A SOCKS5 proxy with real
   * Telegram DC access routes around it. Returns undefined (no proxy) if unconfigured, so
   * this stays a no-op in any environment where the direct connection works fine.
   */
  loadProxyConfig() {
    const ip = (process.env.TELEGRAM_PROXY_IP || '').trim();
    const port = parseInt(process.env.TELEGRAM_PROXY_PORT || '0', 10);
    if (!ip || !port) return undefined;
    return {
      socksType: 5,
      ip,
      port,
      username: process.env.TELEGRAM_PROXY_USERNAME || undefined,
      password: process.env.TELEGRAM_PROXY_PASSWORD || undefined
    };
  }

  isConfigured() {
    return !!this.apiId && !!this.apiHash;
  }

  isConnected() {
    return !!this.client && !!this.sessionString;
  }

  /** Warms the session from Mongo at server boot — no re-login needed after a restart. */
  async loadFromDb() {
    this.loadEnvCreds();
    try {
      const doc = await Integration.findOne({ type: INTEGRATION_TYPE });
      if (!doc || !doc.credentialsEncrypted) return;
      const creds = crypto.decryptJson(doc.credentialsEncrypted);
      if (!creds.sessionString) return;

      if (doc.settings) {
        try {
          const settings = JSON.parse(doc.settings);
          this.lastSyncAt = settings.lastSyncAt || null;
          this.lastSyncStats = settings.lastSyncStats || null;
        } catch (e) { /* ignore malformed settings */ }
      }

      this.sessionString = creds.sessionString;
      this.phone = creds.phone || '';
      await this._connectWithSession();
      console.log(`📱 Telegram Userbot session restored (${this.phone || 'unknown'})`);
    } catch (err) {
      console.error('Telegram Userbot loadFromDb error:', err.message);
    }
  }

  async _connectWithSession() {
    const client = new TelegramClient(new StringSession(this.sessionString), this.apiId, this.apiHash, {
      connectionRetries: 3,
      proxy: this.loadProxyConfig()
    });
    await client.connect();
    this.client = client;
    this.status = 'CONNECTED';
  }

  async _persistSession() {
    await Integration.findOneAndUpdate(
      { type: INTEGRATION_TYPE },
      {
        status: 'CONNECTED',
        name: 'Telegram Userbot (Tarix Sync)',
        credentialsEncrypted: crypto.encryptJson({ sessionString: this.sessionString, phone: this.phone }),
        settings: JSON.stringify({ lastSyncAt: this.lastSyncAt, lastSyncStats: this.lastSyncStats }),
        healthCheckAt: new Date(),
        updatedAt: new Date()
      },
      { upsert: true }
    );
  }

  // ---- Login flow: phone -> code -> optional 2FA password ----

  async startLogin(phone) {
    this.loadEnvCreds();
    if (!this.isConfigured()) {
      return { success: false, error: "TELEGRAM_API_ID / TELEGRAM_API_HASH sozlanmagan (.env). my.telegram.org/apps dan oling." };
    }
    const trimmedPhone = (phone || '').trim();
    if (!trimmedPhone) return { success: false, error: "Telefon raqam bo'sh bo'lishi mumkin emas" };

    if (this._pendingLogin) {
      await this._pendingLogin.client.disconnect().catch(() => {});
      this._pendingLogin = null;
    }

    const client = new TelegramClient(new StringSession(''), this.apiId, this.apiHash, {
      connectionRetries: 3,
      proxy: this.loadProxyConfig()
    });
    await client.connect();

    try {
      const result = await client.sendCode({ apiId: this.apiId, apiHash: this.apiHash }, trimmedPhone);
      this._pendingLogin = { client, phone: trimmedPhone, phoneCodeHash: result.phoneCodeHash };
      this.status = 'AWAITING_CODE';
      return { success: true, status: 'AWAITING_CODE', isCodeViaApp: result.isCodeViaApp };
    } catch (err) {
      await client.disconnect().catch(() => {});
      return { success: false, error: err.message };
    }
  }

  async submitCode(code) {
    if (!this._pendingLogin) return { success: false, error: "Avval telefon raqamni yuboring" };
    const { client, phone, phoneCodeHash } = this._pendingLogin;

    try {
      await client.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: (code || '').trim() }));
      return await this._completeLogin(client, phone);
    } catch (err) {
      // teleproto sets this as a dedicated property (see client/auth.js), not necessarily
      // inside err.message — which for this error is the human string "2FA is enabled, use
      // a password to login. (caused by auth.SignIn)" and doesn't contain the code at all.
      if (err.errorMessage === 'SESSION_PASSWORD_NEEDED' || /SESSION_PASSWORD_NEEDED/.test(err.message || '')) {
        this.status = 'AWAITING_PASSWORD';
        return { success: true, status: 'AWAITING_PASSWORD' };
      }
      return { success: false, error: err.message };
    }
  }

  async submitPassword(pwd) {
    if (!this._pendingLogin) return { success: false, error: "Avval telefon raqamni yuboring" };
    const { client, phone } = this._pendingLogin;

    try {
      const pwdInfo = await client.invoke(new Api.account.GetPassword());
      const check = await PasswordUtil.computeCheck(pwdInfo, pwd || '');
      await client.invoke(new Api.auth.CheckPassword({ password: check }));
      return await this._completeLogin(client, phone);
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async _completeLogin(client, phone) {
    this.client = client;
    this.sessionString = client.session.save();
    this.phone = phone;
    this.status = 'CONNECTED';
    this._pendingLogin = null;
    await this._persistSession();
    return { success: true, status: 'CONNECTED' };
  }

  /** Manual fallback send — see class doc comment. Sends as the owner's real account. */
  async sendMessage(chatId, text) {
    if (!this.isConnected()) return { success: false, error: 'Userbot ulanmagan' };
    try {
      const result = await this.client.sendMessage(chatId, { message: text });
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  getStatus() {
    return {
      configured: this.isConfigured(),
      connected: this.isConnected(),
      status: this.status,
      phone: this.phone,
      lastSyncAt: this.lastSyncAt,
      lastSyncStats: this.lastSyncStats,
      syncing: this._syncing
    };
  }

  // ---- History backfill ----

  /**
   * Pulls the last 90 days of every private (user) dialog into TelegramCustomerMessage,
   * skipping anything already imported (unique {chatId, telegramMessageId} index handles
   * the dedup — a duplicate-key error just means "already have it"). On repeat runs (the
   * daily cron below, or a manual re-click), each chat's paging stops the moment it hits an
   * already-imported message — since Telegram returns messages newest-first, everything
   * older than that point was already synced last time, so there's no need to re-walk it.
   */
  async syncHistory() {
    if (!this.isConnected()) return { success: false, error: 'Userbot ulanmagan' };
    if (this._syncing) return { success: false, error: 'Sync allaqachon ishlamoqda' };

    this._syncing = true;
    const stats = { dialogsScanned: 0, messagesImported: 0, errors: 0 };
    const cutoff = new Date(Date.now() - HISTORY_WINDOW_MS);

    try {
      const dialogs = await this.client.getDialogs({});

      for (const dialog of dialogs) {
        if (!dialog.isUser || (dialog.entity && dialog.entity.bot)) continue; // private, human chats only
        stats.dialogsScanned++;

        const chatId = String(dialog.id);
        const customerName = [dialog.entity && dialog.entity.firstName, dialog.entity && dialog.entity.lastName]
          .filter(Boolean).join(' ') || (dialog.entity && dialog.entity.username) || "Noma'lum";

        try {
          for await (const msg of this.client.iterMessages(dialog.entity, {})) {
            if (!msg.date) continue;
            const msgDate = new Date(msg.date * 1000);
            if (msgDate < cutoff) break; // newest-first order — once we're past the window, stop
            if (!msg.message) continue; // text messages only in this pass

            try {
              await TelegramCustomerMessage.create({
                businessConnectionId: '',
                chatId,
                customerTelegramUserId: chatId,
                customerName,
                direction: msg.out ? 'out' : 'in',
                text: msg.message,
                source: 'userbot_sync',
                telegramMessageId: String(msg.id),
                createdAt: msgDate
              });
              stats.messagesImported++;
            } catch (err) {
              if (err.code === 11000) break; // already imported everything from here backward for this chat
              stats.errors++;
            }
          }
        } catch (err) {
          console.error(`Telegram Userbot sync error for chat ${chatId}:`, err.message);
          stats.errors++;
        }
      }

      // Any chat whose newest message is now an unanswered customer question — e.g. one that
      // arrived before the Business bot was ever connected — gets run through the same sales
      // agent that handles live messages, so a backfilled inquiry doesn't just sit unread.
      try {
        const telegramSalesAgent = require('./telegramSalesAgent');
        const catchUp = await telegramSalesAgent.catchUpUnansweredChats();
        stats.autoReplied = catchUp.processed || 0;
      } catch (err) {
        console.error('Telegram Userbot post-sync catch-up error:', err.message);
      }

      this.lastSyncAt = new Date();
      this.lastSyncStats = stats;
      await this._persistSession();
      return { success: true, stats };
    } finally {
      this._syncing = false;
    }
  }

  /**
   * Same shape as billzSyncService.startDailyCronJob(): an initial run shortly after boot,
   * then every 24h. No-ops (via syncHistory's own isConnected() check) until the owner has
   * completed the phone/code/2FA login once from the admin panel — after that it just runs
   * unattended, and thanks to the early-break dedup above, a day with no new messages costs
   * one cheap "nothing changed" pass per chat rather than a full 90-day re-walk.
   */
  startDailyCronJob() {
    setTimeout(() => {
      this.syncHistory().catch((err) => console.error('Initial Telegram Userbot sync error:', err.message));
    }, 10000);

    if (this.cronInterval) clearInterval(this.cronInterval);
    this.cronInterval = setInterval(() => {
      console.log('⏰ Executing daily Telegram Userbot history sync...');
      this.syncHistory().catch((err) => console.error('Cron Telegram Userbot sync error:', err.message));
    }, 86400000);

    console.log('⏰ Daily Telegram Userbot History Sync Scheduled (Every 24 Hours)');
  }
}

module.exports = new TelegramUserbotService();
