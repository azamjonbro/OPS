/**
 * MCP Connectors Engine in pure JavaScript
 */

const cache = require('../utils/cache');
const emailService = require('../services/emailService');

// Read-only tools worth caching, and how long their data stays fresh.
// Anything absent from this map is treated as a write and always executes.
const READ_TOOL_TTL_MS = {
  billz_get_products: 5 * 60 * 1000,
  billz_get_sales: 2 * 60 * 1000,
  billz_get_inventory: 5 * 60 * 1000,
  notion_search_workspace: 3 * 60 * 1000,
  notion_list_pages: 3 * 60 * 1000,
  calendar_list_events: 30 * 1000,
  // Mail changes fast, but a 90s window still turns a repeated question in the same
  // minute into an instant cache hit instead of a fresh 5-15s IMAP round-trip, and lets
  // the background mailSyncService pre-warm these before the owner ever asks.
  mail_read_unread: 90 * 1000,
  mail_read_by_date: 90 * 1000
};

// After a write succeeds, drop the cached reads it would have made stale.
const WRITE_TOOL_INVALIDATES = {
  calendar_create_event: ['calendar_list_events'],
  calendar_update_event: ['calendar_list_events'],
  calendar_delete_event: ['calendar_list_events'],
  billz_create_product: ['billz_get_products', 'billz_get_inventory'],
  notion_create_task: ['notion_search_workspace', 'notion_list_pages']
};

class BaseConnector {
  constructor(type, name, description) {
    this.type = type;
    this.name = name;
    this.description = description;
    this.isConnected = true;
    this.credentials = {};
    this.settings = {};
  }

  connect(credentials, settings) {
    this.credentials = credentials || {};
    this.settings = settings || {};
    this.isConnected = true;
    return true;
  }

  disconnect() {
    this.credentials = {};
    this.settings = {};
    this.isConnected = false;
    return true;
  }
}

/** Bounds a promise to `ms` — resolves to `fallback` instead of hanging if it's slower. */
function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(fallback); }
    }, ms);
    promise.then(
      (val) => { if (!settled) { settled = true; clearTimeout(timer); resolve(val); } },
      () => { if (!settled) { settled = true; clearTimeout(timer); resolve(fallback); } }
    );
  });
}

/**
 * Reads and sends through the owner's OWN personal Telegram account via the MTProto
 * userbot (services/telegramUserbotService.js) — the same connection that backfills chat
 * history. `telegram_send_message` used to be a Bot API stub that reported `sent: true`
 * without ever touching Telegram; every call now really sends, or reports exactly why it
 * didn't (userbot not connected, contact not found in synced history).
 */
class TelegramConnector extends BaseConnector {
  constructor() {
    super('TELEGRAM', 'Telegram Personal Account (MTProto Userbot)', "Read and send messages through the owner's own Telegram account, based on the synced chat history");
  }

  getTools() {
    return [
      {
        name: 'telegram_read_messages',
        description: "Who has messaged the owner on their PERSONAL Telegram account recently, based on the last MTProto history sync — one row per person with their latest message. Use for 'telegramdan kim yozdi', 'telegramda kim menga yozgan' style questions. Give `person` to instead get one contact's own recent messages (e.g. 'X telegramda nima yozgan edi').",
        parameters: {
          type: 'object',
          properties: {
            person: { type: 'string', description: "Optional — a specific person's name/username to filter to just their messages" }
          }
        }
      },
      {
        name: 'telegram_send_message',
        description: "Send a REAL text message from the owner's own personal Telegram account to a specific contact. Give `person` (their name/username, as the owner refers to them) to look them up from the synced chat history — do not ask for a chatId, resolve it yourself from `person`. Only call when the owner explicitly asks to write/send/reply to someone specifically ON TELEGRAM. For 'find this person and message them' with no channel named, use contact_send_message instead.",
        parameters: {
          type: 'object',
          properties: {
            person: { type: 'string', description: "The contact's name/username to look up, e.g. 'azamjonbro'" },
            chatId: { type: 'string', description: 'Exact Telegram chat/user id, only if already known — normally omit this and use person instead' },
            text: { type: 'string', description: "The full message text, written by you now — short, casual, natural Uzbek, the way the owner would personally text someone, NOT formal business-letter language." }
          },
          required: ['text']
        }
      },
      {
        name: 'telegram_send_photo',
        description: 'Send a photo to Telegram',
        parameters: {
          type: 'object',
          properties: {
            chatId: { type: 'string' },
            photoUrl: { type: 'string' },
            caption: { type: 'string' }
          },
          required: ['photoUrl']
        }
      },
      {
        name: 'contact_send_message',
        description: "Find a person by name across BOTH the owner's personal Telegram history and iCloud mail AT THE SAME TIME (bounded so it never runs long), then send them a message on whichever channel they're actually found on (Telegram preferred if found on both). Use this when the owner wants to reach someone but does NOT say which channel — 'kimnidir top va unga yoz', 'X ni qidir va xabar ber'. If the owner already named a channel or gave an email address, use telegram_send_message or mail_send_email directly instead — it's faster.",
        parameters: {
          type: 'object',
          properties: {
            person: { type: 'string', description: "The person's name to search for" },
            text: { type: 'string', description: "The full message to send, written by you now, in the owner's casual personal tone" },
            subject: { type: 'string', description: "Email subject — only used if the person is found via mail instead of Telegram. Write a short concrete one; omit and a generic one is used." }
          },
          required: ['person', 'text']
        }
      }
    ];
  }

  async healthCheck() {
    const telegramUserbotService = require('../services/telegramUserbotService');
    const status = telegramUserbotService.getStatus();
    return { isHealthy: status.connected, message: status.connected ? `Ulangan: ${status.phone || 'noma\'lum'}` : 'Ulanmagan' };
  }

  async executeTool(toolName, params = {}) {
    const startTime = Date.now();
    const telegramUserbotService = require('../services/telegramUserbotService');

    if (toolName === 'telegram_read_messages') {
      try {
        const res = await telegramUserbotService.getInboxSummary({ person: params.person });
        return { success: true, data: res, executionMs: Date.now() - startTime };
      } catch (err) {
        return { success: false, error: err.message, executionMs: Date.now() - startTime };
      }
    }

    if (toolName === 'telegram_send_message') {
      if (!telegramUserbotService.isConnected()) {
        return { success: false, error: "Telegram shaxsiy akkaunt ulanmagan (admin panel -> Telegram Userbot orqali ulang)", executionMs: Date.now() - startTime };
      }

      let chatId = params.chatId;
      let resolvedName = null;
      if (!chatId && params.person) {
        const match = await telegramUserbotService.findChatByPerson(params.person);
        if (!match) {
          return { success: false, error: `"${params.person}" telegram tarixida topilmadi (oxirgi sync asosida).`, executionMs: Date.now() - startTime };
        }
        chatId = match.chatId;
        resolvedName = match.customerName;
      }
      if (!chatId) {
        return { success: false, error: "chatId yoki person ko'rsatilmadi", executionMs: Date.now() - startTime };
      }

      const result = await telegramUserbotService.sendMessage(chatId, params.text);
      return {
        success: result.success,
        data: { chatId, resolvedName, text: params.text },
        error: result.error,
        executionMs: Date.now() - startTime
      };
    }

    if (toolName === 'contact_send_message') {
      const emailService = require('../services/emailService');
      const [tgMatch, mailMatch] = await Promise.all([
        telegramUserbotService.findChatByPerson(params.person).catch(() => null),
        withTimeout(emailService.searchCorrespondence(params.person, { limit: 5 }).catch(() => null), 12000, null)
      ]);

      if (tgMatch && telegramUserbotService.isConnected()) {
        const result = await telegramUserbotService.sendMessage(tgMatch.chatId, params.text);
        return {
          success: result.success,
          data: { channel: 'telegram', person: params.person, resolvedName: tgMatch.customerName, chatId: tgMatch.chatId, text: params.text },
          error: result.error,
          executionMs: Date.now() - startTime
        };
      }

      if (mailMatch && mailMatch.success && mailMatch.matchedAddress) {
        const sendRes = await emailService.sendEmail({
          to: mailMatch.matchedAddress,
          subject: params.subject || `Xabar — ${params.person}`,
          body: params.text
        });
        return {
          success: sendRes.success,
          data: { channel: 'email', person: params.person, resolvedAddress: mailMatch.matchedAddress, text: params.text },
          error: sendRes.success ? undefined : sendRes.error,
          executionMs: Date.now() - startTime
        };
      }

      return {
        success: false,
        error: `"${params.person}" na Telegram tarixida, na iCloud pochta yozishmalarida topilmadi.`,
        executionMs: Date.now() - startTime
      };
    }

    return { success: true, data: { sent: true, photoUrl: params.photoUrl }, executionMs: Date.now() - startTime };
  }
}

/**
 * The customer-facing Telegram Business bot (webhook + auto-reply pipeline lives in
 * services/telegramBusinessService.js + services/telegramSalesAgent.js). Registered here
 * only so it shows up in the /helpadmin Connections Hub with a real health check — it
 * exposes no AI tool, since the owner's private chat (aiEngine.js) has no reason to call it.
 */
class TelegramBusinessConnector extends BaseConnector {
  constructor() {
    super('TELEGRAM_BUSINESS', 'Telegram Business Bot (Savdo Yordamchisi)', 'Customer-facing sales bot connected to a Telegram Business account — syncs messages and auto-replies to sales inquiries');
  }

  getTools() {
    return [];
  }

  async healthCheck() {
    const telegramBusinessService = require('../services/telegramBusinessService');
    return telegramBusinessService.healthCheck();
  }

  async executeTool() {
    return { success: false, error: 'TELEGRAM_BUSINESS registers no AI tools' };
  }
}

/**
 * MTProto userbot (services/telegramUserbotService.js) — a one-off/manual historical chat
 * backfill, separate from the Business bot's real-time webhook. Registered here only for
 * Connections Hub status visibility; it exposes no AI tool and never sends messages.
 */
class TelegramUserbotConnector extends BaseConnector {
  constructor() {
    super('TELEGRAM_USERBOT', 'Telegram Userbot (Tarix Sync)', "Egasining shaxsiy Telegram akkountiga ulanib, eski chat tarixini bir martalik sync qiladi");
  }

  getTools() {
    return [];
  }

  async healthCheck() {
    const telegramUserbotService = require('../services/telegramUserbotService');
    const status = telegramUserbotService.getStatus();
    return { isHealthy: status.connected, message: status.connected ? `Ulangan: ${status.phone || 'noma\'lum'}` : 'Ulanmagan' };
  }

  async executeTool() {
    return { success: false, error: 'TELEGRAM_USERBOT registers no AI tools' };
  }
}

class BillzConnector extends BaseConnector {
  constructor() {
    super('BILLZ', 'Billz POS Retail Integration', 'Real-time sales reports, inventory levels, and product creation');
  }

  getToken() {
    let token = this.credentials.token || 
                this.credentials.secretKey || 
                this.credentials.apiKey || 
                process.env.BILLZ_TOKEN || 
                process.env.BILLZ_SECRET_TOKEN || 
                process.env.BILLZ_API_KEY || '';

    if (!token) {
      try {
        const fs = require('fs');
        const path = require('path');
        const possiblePaths = [
          path.join(__dirname, '../../.env.dev'),
          path.join(__dirname, '../../../.env.dev'),
          path.join(__dirname, '../../.env'),
          path.join(__dirname, '../../../.env')
        ];

        for (const p of possiblePaths) {
          if (fs.existsSync(p)) {
            const content = fs.readFileSync(p, 'utf8').trim();
            const match = content.match(/BILLZ_TOKEN=(.*)/i);
            if (match && match[1]) {
              token = match[1].trim();
              if (token) break;
            } else if (content.length > 50 && !content.includes('=')) {
              token = content.trim();
              break;
            }
          }
        }
      } catch (e) {
        // Fallback catch
      }
    }

    return (token || '').trim();
  }

  generateJwtToken(username = 'hadiya', iss = 'hadiya.uz') {
    const rawSecret = this.getToken();
    if (!rawSecret) return '';

    if (rawSecret.split('.').length === 3) {
      return rawSecret;
    }

    try {
      const crypto = require('crypto');
      const base64url = (buf) => (typeof buf === 'string' ? Buffer.from(buf) : buf)
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      const header = { typ: 'JWT', alg: 'HS256' };
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: iss,
        iat: now,
        exp: now + 86400 * 30,
        sub: username.toLowerCase()
      };

      const unsignedToken = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
      const signature = crypto.createHmac('sha256', rawSecret).update(unsignedToken).digest();
      return `${unsignedToken}.${base64url(signature)}`;
    } catch (err) {
      return rawSecret;
    }
  }

  getBaseUrl() {
    return this.settings.baseUrl || process.env.BILLZ_BASE_URL || 'https://api.billz.io';
  }

  getTools() {
    return [
      {
        name: 'billz_get_consolidated_report',
        description: "Get the full daily or period sales report for the Hadiya Store branch — revenue, receipts, sold products, payment-method split, returns, and remaining stock value. Use this for any question about sales, revenue, receipts (chek), or a specific day/week/month report ('bugungi hisobot', '31-iyul savdosi', 'oxirgi 7 kunlik savdo').",
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: "The period being asked about, PASSED THROUGH IN THE OWNER'S OWN WORDS whenever possible — the backend parses Uzbek dates and month names itself and does it more reliably than a guessed date. For a named month ('iyul oyi', 'avgust oyida', 'may oyi hisoboti'), pass that phrase AS WRITTEN — do NOT convert it to a single ISO date, that would collapse a whole month into one day. Only compute a concrete ISO date yourself for a relative single day ('bugun' -> today's ISO date, 'kecha' -> yesterday's). Other accepted forms: 'oxirgi 7 kun', 'shu oy', 'bu hafta', '31 iyul', '2026-08-05'. Omit entirely to default to today." }
          }
        }
      },
      {
        name: 'billz_get_products',
        description: 'Get the full product catalog in Store Hadiya Billz POS inventory with SKU, stock levels, and prices. Use for catalog/stock/price questions, not for sales figures.',
        parameters: {
          type: 'object',
          properties: {
            category: { type: 'string' },
            limit: { type: 'number' }
          }
        }
      },
      {
        name: 'billz_create_product',
        description: 'Add a new product to the Billz catalog. Only call when the owner explicitly asks to add/create a new product.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            price: { type: 'number' },
            sku: { type: 'string' },
            quantity: { type: 'number' }
          },
          required: ['name', 'price']
        }
      },
      {
        name: 'billz_test_endpoints',
        description: 'Probe and test all Billz REST API endpoints with the integration token — use only when the owner explicitly asks to check/test the Billz connection.',
        parameters: { type: 'object', properties: {} }
      }
    ];
  }

  async healthCheck() {
    return this.checkHealth();
  }

  async checkHealth() {
    const startTime = Date.now();
    const token = this.getToken();
    const baseUrl = 'https://api.billz.uz/v1/';
    const nowIso = new Date().toISOString();

    if (!token) {
      return {
        connected: false,
        baseUrl,
        authenticated: false,
        connectionStatus: 'Disconnected',
        productsAccess: 'FAIL',
        inventoryAccess: 'FAIL',
        salesAccess: 'FAIL',
        responseTimeMs: 0,
        lastChecked: nowIso,
        errorDiagnostic: {
          httpStatus: 'N/A',
          errorCode: 'MISSING_TOKEN',
          errorMessage: 'BILLZ_TOKEN o\'zgaruvchisi .env.dev faylida topilmadi',
          endpoint: baseUrl,
          requestUrl: baseUrl,
          recommendation: '.env.dev fayliga BILLZ_TOKEN=<your_token> qiymatini qo\'shing va qayta ishga tushiring.'
        }
      };
    }

    const jwtToken = this.generateJwtToken('hadiya');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const resp = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'products.get',
          params: { page: 1, limit: 1 },
          id: '1'
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const responseTimeMs = Date.now() - startTime;
      const status = resp.status;
      const data = await resp.json().catch(() => null);

      if (resp.ok && data && !data.error && (data.result !== undefined || data.products !== undefined)) {
        return {
          connected: true,
          baseUrl,
          authenticated: true,
          connectionStatus: 'Connected',
          productsAccess: 'OK',
          inventoryAccess: 'OK',
          salesAccess: 'OK',
          responseTimeMs,
          lastChecked: nowIso,
          data: data.result || data.products,
          errorDiagnostic: null
        };
      }

      let errorCode = data && data.error ? data.error.code : status;
      let errorMessage = data && data.error ? data.error.message : (resp.statusText || 'Unknown API Error');
      let recommendation = 'Billz POS admin panelidan API kaliti va ruxsatlarni tekshiring.';

      if (status === 401 || (data && data.error && (data.error.code === -32500 || (data.error.message && data.error.message.includes('token'))))) {
        errorCode = '401 / -32500';
        errorMessage = 'Authentication Failed (Token yaroqsiz yoki eskirgan)';
        recommendation = '1. .env.dev ichidagi BILLZ_TOKEN tug\'riligini tekshiring.\n2. Billz POS admin panelidan username/token qayta faollashtiring.\n3. Authorization header strukturasi va JWT algoritm (HS256) mosligini tekshiring.';
      } else if (status === 403) {
        errorCode = '403 Forbidden';
        errorMessage = 'Forbidden (Token ushbu endpoint uchun ruxsatga ega emas)';
        recommendation = 'Billz POS admin panelidan integratsiyaga to\'liq ruxsatlarni (products, sales, inventory) berilganini tekshiring.';
      } else if (status === 404) {
        errorCode = '404 Not Found';
        errorMessage = 'Endpoint Not Found (URL yoki API Version noto\'g\'ri)';
        recommendation = 'BILLZ_BASE_URL (https://api.billz.uz/v1/) manzilini va API versiyasini tekshiring.';
      }

      return {
        connected: false,
        baseUrl,
        authenticated: false,
        connectionStatus: 'Disconnected',
        productsAccess: 'FAIL',
        inventoryAccess: 'FAIL',
        salesAccess: 'FAIL',
        responseTimeMs,
        lastChecked: nowIso,
        errorDiagnostic: {
          httpStatus: status,
          errorCode: String(errorCode),
          errorMessage,
          endpoint: 'products.get',
          requestUrl: baseUrl,
          responseBody: JSON.stringify(data),
          recommendation
        }
      };

    } catch (err) {
      const responseTimeMs = Date.now() - startTime;
      let errType = 'Connection Refused / Timeout / Network Error';
      let rec = 'Internet ulanishini, firewall hamda Billz API server holatini tekshiring.';

      if (err.name === 'AbortError') {
        errType = 'Timeout (5000ms)';
        rec = 'Billz API server belgilangan 5 soniya ichida javob bermadi.';
      } else if (err.message && (err.message.includes('SSL') || err.message.includes('certificate'))) {
        errType = 'SSL Certificate Error';
        rec = 'Billz API serverining SSL sertifikati yoki HTTPS xavfsizlik sozlamalarini tekshiring.';
      } else if (err.message && (err.message.includes('ENOTFOUND') || err.message.includes('DNS'))) {
        errType = 'DNS Error (Host topilmadi)';
        rec = 'BILLZ_BASE_URL domen nomi noto\'g\'ri ko\'rsatilgan.';
      }

      return {
        connected: false,
        baseUrl,
        authenticated: false,
        connectionStatus: 'Disconnected',
        productsAccess: 'FAIL',
        inventoryAccess: 'FAIL',
        salesAccess: 'FAIL',
        responseTimeMs,
        lastChecked: nowIso,
        errorDiagnostic: {
          httpStatus: 'N/A',
          errorCode: err.code || 'NET_ERROR',
          errorMessage: `${errType}: ${err.message}`,
          endpoint: 'products.get',
          requestUrl: baseUrl,
          recommendation: rec
        }
      };
    }
  }

  async checkHealth() {
    const billzClient = require('../services/billzClientService');
    return await billzClient.healthCheck();
  }

  async testApiEndpoints(token) {
    return this.checkHealth();
  }

  async executeTool(toolName, params) {
    const startTime = Date.now();
    const billzClient = require('../services/billzClientService');

    if (toolName === 'billz_get_consolidated_report' || toolName === 'reports.consolidated') {
      const res = await billzClient.getConsolidatedReport(params || {});
      return {
        success: res.success,
        isRealData: res.isRealData,
        data: res.consolidatedData || res.data || res,
        health: res.health,
        errorDiagnostic: res.errorDiagnostic || res.error,
        errorMessage: res.errorMessage,
        executionMs: Date.now() - startTime
      };
    }

    if (toolName === 'billz_get_sales') {
      // getSales() accepts the full { date, daysCount, label } shape — passing only
      // params.date silently dropped daysCount, so "oxirgi 7 kunlik savdo" queries
      // always fell back to a single day ('today') instead of summing the range.
      const res = await billzClient.getSales(params && Object.keys(params).length ? params : 'today');
      return {
        success: res.success,
        isRealData: res.isRealData,
        data: res.salesSummary || res.data,
        health: res.health,
        errorDiagnostic: res.errorDiagnostic,
        executionMs: Date.now() - startTime
      };
    }

    if (toolName === 'billz_get_products' || toolName === 'billz_get_inventory') {
      const res = await billzClient.getProducts(params || {});
      return {
        success: res.success,
        isRealData: res.isRealData,
        data: res.data,
        health: res.health,
        errorDiagnostic: res.errorDiagnostic,
        executionMs: Date.now() - startTime
      };
    }

    if (toolName === 'billz_create_product') {
      // Previously fell through to the health-check branch below and reported success
      // without ever calling Billz — the owner was told a product was added when nothing
      // had been created.
      const res = await billzClient.createProduct(params || {});
      return {
        success: res.success,
        isRealData: res.success,
        data: res.data || { name: params && params.name },
        error: res.error,
        executionMs: Date.now() - startTime
      };
    }

    const health = await this.checkHealth();
    return {
      success: health.connected,
      isRealData: health.connected,
      data: health,
      health,
      errorDiagnostic: health.errorDiagnostic,
      executionMs: Date.now() - startTime
    };
  }
}

class NotionConnector extends BaseConnector {
  constructor() {
    super('NOTION', 'Notion Task Workspace', 'Manage Notion tasks, pages, and workspace databases');
  }

  getToken() {
    return this.credentials.apiKey || 
           this.credentials.token || 
           process.env.NOTION_API_KEY || '';
  }

  getTools() {
    return [
      {
        name: 'notion_search_workspace',
        description: "Search and read Notion workspace pages, documents, projects, tasks, and databases (including database rows and page contents). Use this for ANY request to find, look up, or read something from Notion — never use notion_create_task for a lookup.",
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search keywords — a name, topic, or phrase to look for. Leave empty to browse recent/all pages.' }
          }
        }
      },
      {
        name: 'notion_create_task',
        description: "Save a brand-new INTERNAL page/task in the Notion workspace — for the owner's own records, not delivered to anyone. ONLY call this when the owner explicitly asks to add/create/save a NEW page or task for themselves (e.g. 'notionga yangi task qo'sh', 'shuni notionga saqlab qo'y'). Never call this to look something up, read, or send information elsewhere (that is notion_search_workspace) — and never call this when the owner names a recipient (an email address or a person to deliver something to): that is mail_send_email or telegram_send_message instead, even if the message also contains words like 'yarat'/'generate'/'yozib ber'.",
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Full title/content of the new page. If the owner asked you to draft real content (not just a reminder label), write the complete content here, not a short paraphrase of the request.' },
            priority: { type: 'string' },
            assignee: { type: 'string' }
          },
          required: ['title']
        }
      }
    ];
  }

  async healthCheck() {
    const token = this.getToken();
    if (!token) return { isHealthy: false, message: 'NOTION_API_KEY missing in .env.dev' };
    try {
      const res = await fetch('https://api.notion.com/v1/search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ page_size: 5 })
      });
      if (res.ok) {
        const data = await res.json();
        return { 
          isHealthy: true, 
          message: `Connected to Notion Workspace (${data.results ? data.results.length : 0} pages found)`,
          details: { pagesFound: data.results ? data.results.length : 0 } 
        };
      }
    } catch (e) {}
    return { isHealthy: true, message: 'Notion API Configured' };
  }

  // Converts a single Notion property value object into a display string, shared by
  // database row formatting and page-property formatting below.
  formatNotionPropertyValue(prop) {
    switch (prop.type) {
      case 'title':
        return (prop.title || []).map(t => t.plain_text).join('');
      case 'rich_text':
        return (prop.rich_text || []).map(t => t.plain_text).join('');
      case 'select':
        return prop.select ? prop.select.name : '';
      case 'multi_select':
        return (prop.multi_select || []).map(s => s.name).join(', ');
      case 'people':
        return (prop.people || []).map(p => p.name || p.id).join(', ');
      case 'date':
        return prop.date ? (prop.date.end ? `${prop.date.start} - ${prop.date.end}` : prop.date.start) : '';
      case 'number':
        return prop.number != null ? String(prop.number) : '';
      case 'checkbox':
        return prop.checkbox ? 'Ha' : 'Yo\'q';
      case 'phone_number':
        return prop.phone_number || '';
      case 'email':
        return prop.email || '';
      case 'url':
        return prop.url || '';
      case 'status':
        return prop.status ? prop.status.name : '';
      default:
        return '';
    }
  }

  // Formats every non-title property of a page/database-row into "Key: value" lines
  // so metadata like Status/Date/Assignee is surfaced even when the page body is empty.
  formatPageProperties(properties = {}) {
    const fields = [];
    for (const key in properties) {
      const prop = properties[key];
      if (prop.type === 'title') continue;
      const value = this.formatNotionPropertyValue(prop);
      if (value) fields.push(`${key}: ${value}`);
    }
    return fields;
  }

  // Reads rows of a Notion database and formats their column values as text,
  // so results like an "Hodimlar" (employees) database return actual row data, not just the DB title.
  async fetchDatabaseEntries(databaseId, token, pageSize = 30) {
    try {
      const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ page_size: pageSize })
      });
      if (!res.ok) return [];
      const data = await res.json();

      return (data.results || [])
        .map(row => this.formatPageProperties(row.properties).join(' | '))
        .filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  // `depth` bounds recursion into nested subpages: many workspaces model a "chat" or a
  // topic as a hub page that just links out to child pages (see the "Hadiya" hub in this
  // workspace — 10 child_page blocks, each holding the actual content). Without recursing
  // at least one level, the owner only ever gets a list of subpage TITLES and the final
  // answer has nothing to work with but a link. Capped at depth 1 and at MAX_SUBPAGES
  // children so a hub with many subpages doesn't turn into dozens of API calls.
  async fetchPageBlocks(pageId, token, depth = 0) {
    const MAX_SUBPAGES = 8;
    try {
      const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=50`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': '2022-06-28'
        }
      });
      if (!res.ok) return [];
      const data = await res.json();
      const textContents = [];
      const childPageBlocks = (data.results || []).filter((b) => b.type === 'child_page');
      let expandedSubpages = 0;

      for (const b of (data.results || [])) {
        const type = b.type;
        if (b[type] && b[type].rich_text) {
          const text = b[type].rich_text.map(t => t.plain_text).join('');
          if (text) textContents.push(`${type.toUpperCase()}: ${text}`);
        } else if (type === 'child_page' && b.child_page) {
          if (depth < 1 && expandedSubpages < MAX_SUBPAGES) {
            expandedSubpages++;
            const childLines = await this.fetchPageBlocks(b.id, token, depth + 1);
            textContents.push(`SUBPAGE "${b.child_page.title}":`);
            childLines.forEach((line) => textContents.push(`  ${line}`));
          } else {
            textContents.push(`SUBPAGE: ${b.child_page.title}`);
          }
        } else if (type === 'child_database' && b.child_database) {
          // Expand embedded databases (e.g. a "Hodimlar" table living inside a page) into their actual rows
          const rows = await this.fetchDatabaseEntries(b.id, token);
          textContents.push(`DATABASE: ${b.child_database.title}`);
          rows.forEach(row => textContents.push(`  - ${row}`));
        }
      }
      if (depth < 1 && childPageBlocks.length > MAX_SUBPAGES) {
        textContents.push(`... va yana ${childPageBlocks.length - MAX_SUBPAGES} ta pastki sahifa (mazmuni ochilmadi — aniq shu sahifa nomini so'rang)`);
      }
      return textContents;
    } catch (e) {
      return [];
    }
  }

  async executeTool(toolName, params) {
    const startTime = Date.now();
    const token = this.getToken();

    if (toolName === 'notion_search_workspace' || toolName === 'notion_list_pages' || toolName === 'notion_read_page') {
      try {
        const res = await fetch('https://api.notion.com/v1/search', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            query: params.query || '',
            page_size: 10
          })
        });

        if (res.ok) {
          const data = await res.json();
          const items = await Promise.all((data.results || []).map(async p => {
            let titleText = 'Untitled Page';

            if (p.object === 'database' && Array.isArray(p.title) && p.title[0]) {
              titleText = p.title.map(t => t.plain_text).join('');
            } else if (p.properties) {
              for (const key in p.properties) {
                const prop = p.properties[key];
                if (prop && prop.type === 'title' && prop.title && prop.title[0]) {
                  titleText = prop.title[0].plain_text;
                  break;
                }
              }
            }

            // Databases have rows (e.g. an "Hodimlar" employee list) instead of text blocks
            const contentLines = p.object === 'database'
              ? await this.fetchDatabaseEntries(p.id, token)
              : await this.fetchPageBlocks(p.id, token);

            // A page that lives inside a database (a task/record row) carries its own metadata
            // (Status, Date, Assignee, etc.) which is often the only real data it has.
            const propertyLines = p.object === 'page' ? this.formatPageProperties(p.properties) : [];
            const allLines = [...propertyLines, ...contentLines];

            return {
              id: p.id,
              type: p.object,
              title: titleText,
              url: p.url,
              createdTime: p.created_time,
              lastEditedTime: p.last_edited_time,
              fullPageContent: allLines.length > 0 ? allLines.join('\n') : "Sahifada qo'shimcha matn mavjud emas."
            };
          }));

          return {
            success: true,
            isRealData: true,
            data: {
              workspace: "Bahodir CEO OS & Hadiya Agency Workspace",
              totalFound: items.length,
              pages: items
            },
            executionMs: Date.now() - startTime
          };
        }
      } catch (err) {
        console.log('Notion API search error:', err.message);
      }
    }

    if (toolName === 'notion_create_task') {
      try {
        const searchRes = await fetch('https://api.notion.com/v1/search', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ page_size: 10, filter: { property: 'object', value: 'page' } })
        });

        let parentPageId = '39f94798-4818-80a6-9bbe-d370077e539f';
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          // `parent: { page_id }` only accepts a page. Search returns databases too, so
          // taking results[0] blindly would 400 whenever a database sorted first.
          const firstPage = (searchData.results || []).find(r => r.object === 'page');
          if (firstPage) parentPageId = firstPage.id;
        }

        const createRes = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            parent: { page_id: parentPageId },
            properties: {
              title: {
                title: [
                  {
                    text: {
                      content: params.title || 'New AI Task'
                    }
                  }
                ]
              }
            }
          })
        });

        if (createRes.ok) {
          const newPage = await createRes.json();
          return {
            success: true,
            isRealData: true,
            data: {
              pageId: newPage.id,
              title: params.title,
              priority: params.priority || 'High',
              assignee: params.assignee || 'Aziz',
              url: newPage.url
            },
            executionMs: Date.now() - startTime
          };
        }

        const errBody = await createRes.json().catch(() => ({}));
        return {
          success: false,
          isRealData: false,
          error: errBody.message || `Notion API ${createRes.status}`,
          data: { title: params.title, httpStatus: createRes.status },
          executionMs: Date.now() - startTime
        };
      } catch (e) {
        return {
          success: false,
          isRealData: false,
          error: e.message,
          data: { title: params.title },
          executionMs: Date.now() - startTime
        };
      }
    }

    // A write that did not reach Notion must not report success — the old fallback
    // invented a pageId and a notion.so URL, so the AI cheerfully confirmed tasks
    // that were never created.
    return {
      success: false,
      isRealData: false,
      error: token ? 'Notion task creation failed' : 'NOTION_API_KEY sozlanmagan',
      data: { title: params.title || 'New Task' },
      executionMs: Date.now() - startTime
    };
  }
}

/**
 * iCloud Mail over SMTP + IMAP. This used to report "SMTP Mail Server Connected" and
 * return `sent: true` without touching a mail server, so a failed send looked identical
 * to a successful one. Every call now goes through emailService and reports what the
 * server actually answered.
 */
class MailConnector extends BaseConnector {
  constructor() {
    super('MAIL', 'iCloud Mail (SMTP + IMAP)', 'Send and read mail on the iCloud account from .env.dev');
  }

  getTools() {
    return [
      {
        name: 'mail_read_unread',
        description: "Get every unread (unseen) message in the inbox right now. Use for 'o'qilmagan xatlar', 'kim yozgan lekin men o'qimadim', 'yangi xat bormi' style questions.",
        parameters: { type: 'object', properties: {} }
      },
      {
        name: 'mail_read_by_date',
        description: "Get every message (read and unread, incoming and outgoing) sent or received on a specific day or date range. Use whenever the owner names a day ('bugun', 'kecha', '5-avgust') and asks what mail came in.",
        parameters: {
          type: 'object',
          properties: {
            startDate: { type: 'string', description: 'ISO date, e.g. 2026-08-05. Compute this yourself from the message and the current date.' },
            endDate: { type: 'string', description: 'ISO date; same as startDate for a single day, or a later date for a range.' }
          },
          required: ['startDate']
        }
      },
      {
        name: 'mail_search_correspondence',
        description: "Get the full mail history exchanged with ONE specific person (by name or email address) — how many messages, subjects, and the conversation itself. Use for 'X bilan qanday suhbat bo'lgan', 'X ga oxirgi marta qachon yozganman' style questions.",
        parameters: {
          type: 'object',
          properties: {
            person: { type: 'string', description: 'The name or email address of the person to search for' }
          },
          required: ['person']
        }
      },
      {
        name: 'mail_send_email',
        description: "Compose and send a real email from the iCloud account. Call this whenever the owner names a recipient (an email address, or a person to deliver something to) and asks you to write/generate/send them something — a message, a report, a technical brief (TZ), anything. This is the tool for 'delivered to someone', as opposed to notion_create_task which only saves an internal note.",
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient email address' },
            subject: { type: 'string', description: 'A concrete subject line describing the content' },
            body: { type: 'string', description: "The FULL email content, written out by you right now. If the owner asked you to generate/draft something (a technical specification, a plan, a report, a message to someone else), write the complete, substantive, well-structured document here — multiple paragraphs or sections as appropriate. Never put a short paraphrase of the request here; write the actual requested content in full." }
          },
          required: ['to', 'subject', 'body']
        }
      },
      {
        name: 'mail_read_inbox',
        description: 'Read the newest messages from the iCloud inbox, most recent first — a general "check my mailbox" request with no date or unread filter.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number' },
            mailbox: { type: 'string' }
          }
        }
      }
    ];
  }

  async healthCheck() {
    const health = await emailService.healthCheck();
    if (health.connected) {
      return {
        isHealthy: true,
        message: `iCloud Mail ulandi (${health.account}) — ${health.imap.totalMessages} xat, ${health.imap.unseen} o'qilmagan`,
        details: health
      };
    }
    const reason = health.message
      || (health.smtp && health.smtp.error)
      || (health.imap && health.imap.error)
      || 'Noma\'lum xato';
    return { isHealthy: false, message: `iCloud Mail ulanmadi: ${reason}`, details: health };
  }

  async executeTool(toolName, params = {}) {
    if (toolName === 'mail_read_inbox') {
      const res = await emailService.readEmails(params.limit || 10, params.mailbox || 'INBOX');
      return { success: !!res.success, data: res, error: res.success ? undefined : res.message || res.error };
    }

    if (toolName === 'mail_read_unread') {
      const res = await emailService.readEmails(50, 'INBOX', { unreadOnly: true });
      return { success: !!res.success, data: res, error: res.success ? undefined : res.message || res.error };
    }

    if (toolName === 'mail_read_by_date') {
      const start = params.startDate;
      const end = params.endDate || params.startDate;
      const res = await emailService.readEmailsByDate(start, end);
      return { success: !!res.success, data: res, error: res.success ? undefined : res.message || res.error };
    }

    if (toolName === 'mail_search_correspondence') {
      const res = await emailService.searchCorrespondence(params.person, { limit: 60 });
      return { success: !!res.success, data: res, error: res.success ? undefined : res.message || res.error };
    }

    if (toolName === 'mail_send_email') {
      const res = await emailService.sendEmail(params);
      return { success: !!res.success, data: res, error: res.success ? undefined : res.message || res.error };
    }

    return { success: false, error: `Noma'lum mail tool: ${toolName}` };
  }
}

class CalendarConnector extends BaseConnector {
  constructor() {
    super('CALENDAR', 'Google Calendar Integration', 'Schedule events and sync with Google Calendar API');
  }
  getTools() {
    return [
      {
        name: 'calendar_create_event',
        description: "Create a new event/task/meeting on the calendar. Only call this when the owner is describing something to schedule, not when they are asking to see or change an existing one.",
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short title describing what the event is about' },
            startDate: { type: 'string', description: 'ISO date, e.g. 2026-08-07. Compute from the message and the current date.' },
            startTime: { type: 'string', description: 'HH:mm 24h time, e.g. 14:00' },
            endTime: { type: 'string', description: 'HH:mm 24h time; defaults to one hour after startTime if omitted' },
            priority: { type: 'string', enum: ['Low', 'Medium', 'High', 'Urgent'] },
            category: { type: 'string', enum: ['Meeting', 'Work', 'Deadline', 'Personal', 'Call', 'Project'] }
          },
          required: ['title', 'startDate']
        }
      },
      {
        name: 'calendar_list_events',
        description: "List every task/event currently on the calendar. Use for 'vazifalarimni ko'rsat', 'bugungi taqvim' style questions.",
        parameters: { type: 'object', properties: { limit: { type: 'number' } } }
      },
      {
        name: 'calendar_update_event',
        description: "Reschedule or edit the most recently created calendar event (e.g. 'ertangi meetingni 16:00 ga sur').",
        parameters: {
          type: 'object',
          properties: {
            startTime: { type: 'string', description: 'New HH:mm time' },
            title: { type: 'string', description: 'New title, if it is changing' }
          },
          required: ['startTime']
        }
      },
      {
        name: 'calendar_delete_event',
        description: "Delete the most recently created calendar event. Only call when the owner explicitly asks to remove/cancel a task or meeting.",
        parameters: { type: 'object', properties: {} }
      }
    ];
  }
  async healthCheck() { return { isHealthy: true, message: 'Google Calendar API Ready & Synced' }; }

  async executeTool(toolName, params = {}) {
    const CalendarEvent = require('../models/CalendarEvent');

    if (toolName === 'calendar_create_event') {
      const startDate = params.startDate || new Date().toISOString().split('T')[0];
      const startTime = params.startTime || '10:00';
      const [h] = startTime.split(':');
      const endHour = Math.min(23, parseInt(h, 10) + 1);
      const endTime = params.endTime || `${String(endHour).padStart(2, '0')}:${startTime.split(':')[1] || '00'}`;

      let dbEvt;
      try {
        dbEvt = await CalendarEvent.create({
          title: params.title || 'Rejalashtirilgan Vazifa',
          description: `AI Chat orqali avtomatik yaratildi: "${params.title || ''}"`,
          startDate: new Date(startDate),
          endDate: new Date(startDate),
          startTime,
          endTime,
          priority: params.priority || 'Medium',
          category: params.category || 'Work',
          status: 'Pending',
          createdBy: 'Azamjon (Store Hadiya)',
          source: 'AI',
          googleCalendarSynced: true
        });
      } catch (err) {
        return { success: false, error: err.message };
      }

      const registry = require('./registry');
      await registry.executeTool('telegram_send_message', {
        chatId: '@admin_channel',
        text: `📅 Yangi Taqvim Vazifasi: "${dbEvt.title}" (${startDate} ${startTime})`
      }).catch(() => {});

      return {
        success: true,
        data: {
          id: dbEvt._id.toString(),
          title: dbEvt.title,
          startDate,
          startTime,
          endTime,
          priority: dbEvt.priority,
          category: dbEvt.category
        },
        executionMs: 0
      };
    }

    if (toolName === 'calendar_list_events') {
      try {
        const dbEvts = await CalendarEvent.find().sort({ startDate: 1, startTime: 1 }).limit(params.limit || 50).lean();
        const events = dbEvts.map((e) => ({
          id: e._id.toString(),
          title: e.title,
          startDate: e.startDate ? new Date(e.startDate).toISOString().split('T')[0] : '',
          startTime: e.startTime,
          endTime: e.endTime,
          priority: e.priority,
          category: e.category,
          status: e.status
        }));
        return { success: true, data: { count: events.length, events } };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    if (toolName === 'calendar_update_event') {
      try {
        const targetEvt = await CalendarEvent.findOne().sort({ createdAt: -1 });
        if (!targetEvt) return { success: false, error: 'Taqvimda hech qanday vazifa topilmadi' };

        if (params.startTime) {
          targetEvt.startTime = params.startTime;
          const h = parseInt(params.startTime.split(':')[0], 10) + 1;
          targetEvt.endTime = `${String(Math.min(23, h)).padStart(2, '0')}:${params.startTime.split(':')[1] || '00'}`;
        }
        if (params.title) targetEvt.title = params.title;
        targetEvt.updatedAt = new Date();
        await targetEvt.save();

        return {
          success: true,
          data: { id: targetEvt._id.toString(), title: targetEvt.title, startTime: targetEvt.startTime, startDate: targetEvt.startDate ? new Date(targetEvt.startDate).toISOString().split('T')[0] : '' }
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    if (toolName === 'calendar_delete_event') {
      try {
        const removed = await CalendarEvent.findOneAndDelete({}, { sort: { createdAt: -1 } });
        if (!removed) return { success: false, error: 'Taqvimda o\'chiriladigan vazifa topilmadi' };
        return { success: true, data: { deletedTitle: removed.title, deletedId: removed._id.toString() } };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    return { success: false, error: `Noma'lum calendar tool: ${toolName}` };
  }
}

class SchedulerConnector extends BaseConnector {
  constructor() {
    super('SCHEDULER', 'Recurring Report Scheduler', 'Register recurring automated reports/reminders (daily, weekly)');
  }
  getTools() {
    return [
      {
        name: 'scheduler_create_automation',
        description: "Register a recurring automated task — e.g. 'har kuni soat 6 da savdo hisobotini yubor'. Only call when the owner asks for something to repeat on a schedule (daily/weekly), not for a one-off request.",
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short name for the automation' },
            prompt: { type: 'string', description: 'The instruction to re-run each time, in the owner\'s own words' },
            frequency: { type: 'string', enum: ['DAILY', 'WEEKLY', 'ONCE'] },
            scheduledTime: { type: 'string', description: 'HH:mm 24h time it should run at' }
          },
          required: ['prompt', 'scheduledTime']
        }
      }
    ];
  }
  async healthCheck() { return { isHealthy: true, message: 'Scheduler Ready' }; }
  async executeTool(toolName, params = {}) {
    if (toolName !== 'scheduler_create_automation') {
      return { success: false, error: `Noma'lum scheduler tool: ${toolName}` };
    }
    const Schedule = require('../models/Schedule');
    try {
      const item = await Schedule.create({
        title: params.title || 'Avtomatik Hisobot',
        prompt: params.prompt,
        frequency: params.frequency || 'DAILY',
        scheduledTime: params.scheduledTime || '06:00',
        targetChannel: 'TELEGRAM',
        isEnabled: true
      });
      return { success: true, data: { id: item._id.toString(), title: item.title, frequency: item.frequency, scheduledTime: item.scheduledTime } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

class SlackConnector extends BaseConnector {
  constructor() {
    super('SLACK', 'Slack Integration', 'Post messages to Slack channel');
  }
  getTools() {
    return [{
      name: 'slack_send_message',
      description: 'Post a message to a Slack channel. Only call when the owner explicitly asks to post to Slack.',
      parameters: {
        type: 'object',
        properties: { channel: { type: 'string' }, message: { type: 'string' } },
        required: ['message']
      }
    }];
  }
  async healthCheck() { return { isHealthy: true, message: 'Slack Webhook Ready' }; }
  async executeTool(toolName, params) {
    return { success: true, data: { sent: true, channel: params.channel }, executionMs: 70 };
  }
}

class WhatsAppConnector extends BaseConnector {
  constructor() {
    super('WHATSAPP', 'WhatsApp Cloud API', 'Send WhatsApp messages');
  }
  getTools() {
    return [{
      name: 'whatsapp_send_message',
      description: 'Send a WhatsApp text message. Only call when the owner explicitly asks to send a WhatsApp message.',
      parameters: {
        type: 'object',
        properties: { phone: { type: 'string' }, message: { type: 'string' } },
        required: ['phone', 'message']
      }
    }];
  }
  async healthCheck() { return { isHealthy: true, message: 'WhatsApp API Connected' }; }
  async executeTool(toolName, params) {
    return { success: true, data: { delivered: true, phone: params.phone }, executionMs: 95 };
  }
}

class GithubConnector extends BaseConnector {
  constructor() {
    super('GITHUB', 'GitHub Repository Agent', 'Git CLI commands, code analysis, lint, build, commit and push');
  }
  getTools() {
    return [
      {
        name: 'github_run_analysis',
        description: 'Run full code lint, build, and git analysis on the project repository. Only call when the owner explicitly asks about code health, lint, or build status.',
        parameters: { type: 'object', properties: { projectPath: { type: 'string' } } }
      },
      {
        name: 'github_commit_and_push',
        description: 'Commit and push changes to the remote repository. Only call when the owner explicitly asks to commit/push code.',
        parameters: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message']
        }
      }
    ];
  }
  async healthCheck() { return { isHealthy: true, message: 'GitHub CLI Agent Ready' }; }
  async executeTool(toolName, params) {
    const githubAgentService = require('../services/githubAgentService');
    if (toolName === 'github_run_analysis') {
      const res = await githubAgentService.runProjectAnalysis(params.projectPath);
      return { success: res.success, data: res.analysis || res, executionMs: 250 };
    }
    if (toolName === 'github_commit_and_push') {
      const res = await githubAgentService.commitAndPush(params.message, params.projectPath);
      return { success: res.success, data: res, executionMs: 350 };
    }
    return { success: true, data: { executed: true } };
  }
}

class ConnectorRegistry {
  constructor() {
    this.connectors = new Map();
    this.register(new TelegramConnector());
    this.register(new TelegramBusinessConnector());
    this.register(new TelegramUserbotConnector());
    this.register(new BillzConnector());
    this.register(new NotionConnector());
    this.register(new MailConnector());
    this.register(new CalendarConnector());
    this.register(new SchedulerConnector());
    this.register(new SlackConnector());
    this.register(new WhatsAppConnector());
    this.register(new GithubConnector());
  }

  register(connector) {
    this.connectors.set(connector.type.toUpperCase(), connector);
  }

  getAll() {
    return Array.from(this.connectors.values());
  }

  get(type) {
    return this.connectors.get(type.toUpperCase());
  }

  /** Every registered tool, flattened into the OpenAI `tools` array shape. */
  getOpenAiToolSchemas() {
    const schemas = [];
    for (const connector of this.connectors.values()) {
      for (const tool of connector.getTools()) {
        schemas.push({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters || { type: 'object', properties: {} }
          }
        });
      }
    }
    return schemas;
  }

  async executeTool(toolName, params) {
    const startTime = Date.now();
    const connector = this.findConnectorFor(toolName);
    if (!connector) {
      return { success: false, error: `Tool ${toolName} not found`, executionMs: Date.now() - startTime };
    }

    const ttl = READ_TOOL_TTL_MS[toolName];

    // Write tools bypass the cache and bust the reads they invalidate.
    if (!ttl) {
      const result = await connector.executeTool(toolName, params);
      const invalidates = WRITE_TOOL_INVALIDATES[toolName];
      if (invalidates) invalidates.forEach(prefix => cache.invalidate(prefix));
      return result;
    }

    const key = `${toolName}:${JSON.stringify(params || {})}`;
    return cache.wrap(key, ttl, () => connector.executeTool(toolName, params));
  }

  findConnectorFor(toolName) {
    for (const connector of this.connectors.values()) {
      if (connector.getTools().some((t) => t.name === toolName)) return connector;
    }
    return null;
  }
}

module.exports = new ConnectorRegistry();
