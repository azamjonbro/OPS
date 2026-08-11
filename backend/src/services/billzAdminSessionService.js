const crypto = require('../crypto');
const Integration = require('../models/Integration');

const INTEGRATION_TYPE = 'BILLZ_ADMIN_SESSION';
const LOGIN_URL = 'https://hadiya.billz.io/api/v2/auth/web/login';
// Fixed platform id the site's own frontend sends on every login call (reverse-engineered
// from its JS bundle) — not a secret, just an app identifier Billz's backend expects.
const PLATFORM_ID = '7d4a4c38-dd84-4902-b744-0488b80a4c01';
// Refresh this long before the token's real expiry so a request never races an
// about-to-expire token — cheap insurance against a single failed report/scheduled digest.
const REFRESH_BUFFER_MS = 24 * 60 * 60 * 1000;

/**
 * Owner's own Billz ADMIN (web) session — separate from the BILLZ integration's API token
 * (billzClientService.js / connectors/registry.js's BillzConnector), which is scoped to
 * catalog/sales endpoints only. The cashbox ledger (gl-transaction: expenses, net profit,
 * inventory investment) rejects that API token outright (confirmed: 403 on
 * GET /v1/gl-transaction with it), but accepts a real logged-in user session — so this
 * service exists solely to obtain and refresh that session's JWT for billzGlService.js.
 *
 * Login flow reverse-engineered from hadiya.billz.io's own frontend (its login form posts
 * `{phone, password}` — NOT `phone_number`, a field name that looks equally plausible but
 * is wrong and silently 422s — to LOGIN_URL with `device-guid`/`platform-id` headers).
 * Verified end-to-end with a real login: 200 OK, session usable against
 * GET https://api-admin.billz.ai/v1/gl-transaction.
 */
class BillzAdminSessionService {
  constructor() {
    this.phone = '';
    this.password = '';
    this.accessToken = '';
    this.tokenExpiresAt = 0;
    this.deviceGuid = '';
  }

  isConfigured() {
    return !!this.phone && !!this.password;
  }

  /** Warms the cached session from Mongo at server boot — no re-login needed after a restart. */
  async loadFromDb() {
    try {
      const doc = await Integration.findOne({ type: INTEGRATION_TYPE });
      if (!doc || !doc.credentialsEncrypted) return;
      const creds = crypto.decryptJson(doc.credentialsEncrypted);
      this.phone = creds.phone || '';
      this.password = creds.password || '';
      this.accessToken = creds.accessToken || '';
      this.tokenExpiresAt = creds.tokenExpiresAt || 0;
      this.deviceGuid = creds.deviceGuid || require('crypto').randomUUID();
      if (this.phone) console.log(`💳 Billz Admin Session restored (${this.phone})`);
    } catch (err) {
      console.error('Billz Admin Session loadFromDb error:', err.message);
    }
  }

  async _persist(status) {
    await Integration.findOneAndUpdate(
      { type: INTEGRATION_TYPE },
      {
        status: status || 'CONNECTED',
        name: 'Billz Admin Session (Kassa/Xarajatlar)',
        credentialsEncrypted: crypto.encryptJson({
          phone: this.phone,
          password: this.password,
          accessToken: this.accessToken,
          tokenExpiresAt: this.tokenExpiresAt,
          deviceGuid: this.deviceGuid
        }),
        healthCheckAt: new Date(),
        updatedAt: new Date()
      },
      { upsert: true }
    );
  }

  /** Decodes a JWT's `exp` claim (no signature check needed — we just received it fresh from Billz). */
  _decodeExpiryMs(jwt) {
    try {
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'));
      return payload.exp ? payload.exp * 1000 : 0;
    } catch (e) {
      return 0;
    }
  }

  /** Real login round-trip against Billz — used both for the initial admin-panel save and for refresh. */
  async login(phone, password) {
    const trimmedPhone = (phone || '').trim();
    const trimmedPassword = password || '';
    if (!trimmedPhone || !trimmedPassword) {
      return { success: false, error: "Telefon raqam va parol bo'sh bo'lishi mumkin emas" };
    }

    // Billz's own login form always sends the number with the country code baked in.
    const normalizedPhone = trimmedPhone.startsWith('+') ? trimmedPhone : `+998${trimmedPhone.replace(/^998/, '')}`;
    const deviceGuid = this.deviceGuid || require('crypto').randomUUID();

    let res;
    try {
      res = await fetch(LOGIN_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          'device-guid': deviceGuid,
          'platform-id': PLATFORM_ID,
          referer: 'https://hadiya.billz.io/login',
          origin: 'https://hadiya.billz.io'
        },
        body: JSON.stringify({ phone: normalizedPhone, password: trimmedPassword })
      });
    } catch (err) {
      return { success: false, error: `Billz bilan bog'lanib bo'lmadi: ${err.message}` };
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: data.error === 'phone' ? "Telefon raqam noto'g'ri" : (data.message || `Billz login xatosi (${res.status})`) };
    }

    // The response body carries the JWT on success — but its exact key hasn't been
    // confirmed by an actual successful `fetch()` call yet (only via a real browser login,
    // where the token was read back out of localStorage rather than the response body).
    // Try the plausible keys; if none match, this is a real gap to close during the first
    // live admin-panel save (see class doc comment).
    const token = data.access_token || (data.data && data.data.access_token) || data.token || '';
    if (!token) {
      return { success: false, error: "Billz login javobida token topilmadi (kutilmagan javob formati)" };
    }

    this.phone = normalizedPhone;
    this.password = trimmedPassword;
    this.accessToken = token;
    this.tokenExpiresAt = this._decodeExpiryMs(token) || (Date.now() + 13 * 24 * 60 * 60 * 1000);
    this.deviceGuid = deviceGuid;
    await this._persist('CONNECTED');

    return { success: true };
  }

  /** Cached token if still fresh; otherwise re-logs-in with the stored credentials and persists the refreshed one. */
  async getAdminToken() {
    if (this.accessToken && this.tokenExpiresAt > Date.now() + REFRESH_BUFFER_MS) {
      return this.accessToken;
    }
    if (!this.isConfigured()) return '';

    const result = await this.login(this.phone, this.password);
    if (!result.success) {
      console.error('Billz Admin Session refresh failed:', result.error);
      return '';
    }
    return this.accessToken;
  }

  /** Proves the cached/refreshed session actually works against the real cashbox ledger. */
  async testConnection() {
    const token = await this.getAdminToken();
    if (!token) return { success: false, error: "Billz admin sessiyasi ulanmagan yoki login muvaffaqiyatsiz" };

    try {
      const res = await fetch('https://api-admin.billz.ai/v1/gl-transaction?limit=1', {
        headers: { accept: 'application/json', Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { success: false, error: `Billz gl-transaction so'rovi muvaffaqiyatsiz (${res.status}): ${body.slice(0, 200)}` };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  getStatus() {
    return {
      configured: this.isConfigured(),
      connected: !!this.accessToken && this.tokenExpiresAt > Date.now(),
      phone: this.phone,
      tokenExpiresAt: this.tokenExpiresAt ? new Date(this.tokenExpiresAt).toISOString() : null
    };
  }

  async disconnect() {
    this.phone = '';
    this.password = '';
    this.accessToken = '';
    this.tokenExpiresAt = 0;
    await Integration.findOneAndUpdate(
      { type: INTEGRATION_TYPE },
      { status: 'DISCONNECTED', credentialsEncrypted: '', updatedAt: new Date() }
    ).catch(() => {});
    return { success: true, status: 'DISCONNECTED' };
  }
}

module.exports = new BillzAdminSessionService();
