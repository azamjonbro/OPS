const { TelegramClient, Api, sessions, password: PasswordUtil } = require('teleproto');

const { StringSession } = sessions;
const crypto = require('../crypto');
const Integration = require('../models/Integration');
const TelegramCustomerMessage = require('../models/TelegramCustomerMessage');
const proxyPoolService = require('./proxyPoolService');

const INTEGRATION_TYPE = 'TELEGRAM_USERBOT';
const HISTORY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // 90 days — see plan: bounded to limit flood-wait risk

// Lowercase and drop every space/apostrophe so "Bahodirayyub" (typed as one word) and
// "Bahodir Ayyub" (stored as two) compare equal — a strict substring match rejected both
// a missing space AND a single-letter misspelling ("Ayub" vs the real "Ayyub") for a
// contact who was RIGHT THERE in the synced history, just spelled slightly differently.
function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/[\s'`ʼ’]+/g, '');
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

// A minimum length before a name is trusted for substring/typo matching at all. Without
// this, a short stored name like "Z" or "Li" matches as a false-positive substring of
// almost anything containing that letter sequence (a real incident: a search for
// "nonexistent_test_person_xyz" matched a real contact named "Z" purely because the
// search text happened to end in "...xyz" — a real message went to a real stranger).
const MIN_MATCHABLE_NAME_LEN = 3;

/** Best-matching contact for a typed name — substring match first, then a small typo tolerance. */
function bestNameMatch(needleRaw, contacts, nameKey) {
  const needle = normalizeName(needleRaw);
  if (!needle || needle.length < MIN_MATCHABLE_NAME_LEN) return null;

  let best = null;
  let bestScore = Infinity;
  for (const c of contacts) {
    const name = normalizeName(c[nameKey]);
    if (!name || name.length < MIN_MATCHABLE_NAME_LEN) continue;
    if (name === needle) return c;
    if (name.includes(needle) || needle.includes(name)) return c;
    const dist = levenshtein(needle, name);
    const tolerance = Math.max(1, Math.ceil(Math.min(needle.length, name.length) * 0.25));
    if (dist <= tolerance && dist < bestScore) { best = c; bestScore = dist; }
  }
  return best;
}

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
   * Telegram DC access routes around it. Prefers the DB-managed proxy pool (admin panel ->
   * Proxy Pool, purpose "telegram_mtproto") — proxies get replaced often enough that editing
   * .env + SSH + restart for every swap doesn't scale. Falls back to TELEGRAM_PROXY_* env
   * vars if the pool has nothing confirmed-working yet. Returns undefined (no proxy) if
   * neither is configured, so this stays a no-op in any environment where direct connect works.
   */
  async loadProxyConfig() {
    const pooled = await proxyPoolService.getWorkingProxy('telegram_mtproto').catch(() => null);
    if (pooled) {
      return { socksType: 5, ip: pooled.host, port: pooled.port, username: pooled.username || undefined, password: pooled.password || undefined, timeout: 20 };
    }

    const ip = (process.env.TELEGRAM_PROXY_IP || '').trim();
    const port = parseInt(process.env.TELEGRAM_PROXY_PORT || '0', 10);
    if (!ip || !port) return undefined;
    return {
      socksType: 5,
      ip,
      port,
      username: process.env.TELEGRAM_PROXY_USERNAME || undefined,
      password: process.env.TELEGRAM_PROXY_PASSWORD || undefined,
      // The socks library's own default is 5s, which is tight for a proxy hop from a host
      // that's already fighting network restrictions — give it more room before giving up.
      timeout: 20
    };
  }

  isConfigured() {
    return !!this.apiId && !!this.apiHash;
  }

  isConnected() {
    return !!this.client && !!this.sessionString;
  }

  /**
   * The owner's own Telegram user id, straight from the logged-in MTProto session —
   * used to recognize "the owner sent this from their own Telegram app" on the Business
   * webhook side (services/telegramSalesAgent.js), which otherwise has no reliable way to
   * tell the owner's own messages apart from a real customer's. Cached: it's the same
   * value for the lifetime of this session.
   */
  async getOwnUserId() {
    if (this._ownUserId) return this._ownUserId;
    if (!this.isConnected()) return null;
    try {
      const me = await this.client.getMe();
      this._ownUserId = me && me.id ? String(me.id) : null;
      return this._ownUserId;
    } catch (err) {
      return null;
    }
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
      proxy: await this.loadProxyConfig()
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
      proxy: await this.loadProxyConfig()
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

  /** Every distinct synced chat's most recent known name — the small candidate set fuzzy name matching runs against. */
  async _knownContacts() {
    return TelegramCustomerMessage.aggregate([
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$chatId', chatId: { $first: '$chatId' }, customerName: { $first: '$customerName' } } }
    ]);
  }

  /**
   * Most recent synced chat whose customerName matches `person` — tolerant of a missing
   * space ("Bahodirayyub" vs stored "Bahodir Ayyub") and a small typo, not just an exact
   * substring, since the owner types a name from memory, not by copying it verbatim.
   * Reads TelegramCustomerMessage rather than a live MTProto contact search — the sync
   * runs every minute and already covers every private dialog, so this is both faster and
   * covers people who haven't messaged recently but are still in the synced chat list.
   */
  async findChatByPerson(person) {
    const contacts = await this._knownContacts();
    const match = bestNameMatch(person, contacts, 'customerName');
    return match ? { chatId: match.chatId, customerName: match.customerName } : null;
  }

  /**
   * Like findChatByPerson, but for a SEND: silently picking "the best guess" when two
   * genuinely different real contacts both plausibly match (e.g. two different people the
   * owner both calls "Bahodir aka") risks a real message going to the wrong person. Returns
   * `{ status: 'found', chatId, customerName }` on a single clear match, `{ status:
   * 'ambiguous', candidates: [...] }` when 2+ distinct chats are all plausible matches (the
   * caller should ask the owner to pick), or `{ status: 'not_found' }`.
   */
  async resolvePerson(person) {
    const needle = normalizeName(person);
    if (!needle || needle.length < MIN_MATCHABLE_NAME_LEN) return { status: 'not_found' };

    const contacts = await this._knownContacts();
    const exact = contacts.filter((c) => normalizeName(c.customerName) === needle);
    if (exact.length === 1) return { status: 'found', chatId: exact[0].chatId, customerName: exact[0].customerName };
    if (exact.length > 1) {
      return { status: 'ambiguous', candidates: exact.map((c) => ({ chatId: c.chatId, customerName: c.customerName })) };
    }

    const fuzzy = [];
    for (const c of contacts) {
      const name = normalizeName(c.customerName);
      if (!name || name.length < MIN_MATCHABLE_NAME_LEN) continue;
      if (name.includes(needle) || needle.includes(name)) { fuzzy.push({ c, dist: 0 }); continue; }
      const dist = levenshtein(needle, name);
      const tolerance = Math.max(1, Math.ceil(Math.min(needle.length, name.length) * 0.25));
      if (dist <= tolerance) fuzzy.push({ c, dist });
    }
    if (!fuzzy.length) return { status: 'not_found' };
    if (fuzzy.length === 1) return { status: 'found', chatId: fuzzy[0].c.chatId, customerName: fuzzy[0].c.customerName };

    fuzzy.sort((a, b) => a.dist - b.dist);
    return { status: 'ambiguous', candidates: fuzzy.slice(0, 4).map(({ c }) => ({ chatId: c.chatId, customerName: c.customerName })) };
  }

  /**
   * "Who messaged me on Telegram" (no `person`) — one row per chat, their latest inbound
   * message, newest chat first, based on the last history sync. With `person`, the recent
   * messages exchanged with just that one contact instead.
   */
  async getInboxSummary({ person, limit = 20 } = {}) {
    const needle = String(person || '').trim();
    let rows;

    if (needle) {
      const contacts = await this._knownContacts();
      const match = bestNameMatch(needle, contacts, 'customerName');
      rows = match
        ? await TelegramCustomerMessage.find({ chatId: match.chatId }).sort({ createdAt: -1 }).limit(limit).lean()
        : [];
    } else {
      rows = await TelegramCustomerMessage.aggregate([
        { $match: { direction: 'in' } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$chatId', chatId: { $first: '$chatId' }, customerName: { $first: '$customerName' }, text: { $first: '$text' }, direction: { $first: '$direction' }, createdAt: { $first: '$createdAt' } } },
        { $sort: { createdAt: -1 } },
        { $limit: limit }
      ]);
    }

    return {
      success: true,
      lastSyncAt: this.lastSyncAt,
      person: needle || null,
      count: rows.length,
      messages: rows.map((r) => ({
        chatId: r.chatId,
        customerName: r.customerName,
        text: r.text,
        direction: r.direction,
        date: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt
      }))
    };
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

  /**
   * Disconnects the currently logged-in Telegram account so a different one can be linked.
   * Calls auth.LogOut first so the session is actually revoked on Telegram's side (otherwise
   * it would keep showing up as an active session in the account's "Devices" list even after
   * we forget it locally) — but the local state is cleared either way, since a dead/expired
   * session should never block reconnecting with a new account.
   */
  async logout() {
    if (this.client) {
      try {
        await this.client.invoke(new Api.auth.LogOut());
      } catch (err) {
        console.error('Telegram Userbot logout (auth.LogOut) error:', err.message);
      }
      await this.client.disconnect().catch(() => {});
    }

    this.client = null;
    this.sessionString = '';
    this.phone = '';
    this.status = 'DISCONNECTED';
    this._ownUserId = null;
    this.lastSyncAt = null;
    this.lastSyncStats = null;

    await Integration.findOneAndUpdate(
      { type: INTEGRATION_TYPE },
      { status: 'DISCONNECTED', credentialsEncrypted: null, settings: JSON.stringify({}), updatedAt: new Date() }
    ).catch(() => {});

    return { success: true, status: 'DISCONNECTED' };
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
        // A dropped connection (proxy hiccup, DC reconnect failure) means every remaining
        // dialog would fail individually and flood the log — stop the whole pass instead,
        // the next scheduled/manual sync will pick up where this one left off.
        if (!this.client.connected) {
          console.error('Telegram Userbot sync aborted: connection dropped mid-sync');
          stats.errors++;
          break;
        }

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
   * then every minute. No-ops (via syncHistory's own isConnected() check) until the owner has
   * completed the phone/code/2FA login once from the admin panel — after that it just runs
   * unattended. Thanks to the early-break dedup above, a run with no new messages costs one
   * cheap "nothing changed" pass per chat rather than a full 90-day re-walk, and syncHistory's
   * own `_syncing` guard means an overlapping tick (a run still going past a minute) just
   * no-ops instead of stacking concurrent syncs.
   */
  startDailyCronJob() {
    setTimeout(() => {
      this.syncHistory().catch((err) => console.error('Initial Telegram Userbot sync error:', err.message));
    }, 10000);

    if (this.cronInterval) clearInterval(this.cronInterval);
    this.cronInterval = setInterval(() => {
      this.syncHistory().catch((err) => console.error('Cron Telegram Userbot sync error:', err.message));
    }, 60000);

    console.log('⏰ Telegram Userbot History Sync Scheduled (Every 1 Minute)');
  }
}

module.exports = new TelegramUserbotService();
