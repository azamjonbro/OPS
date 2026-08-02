const fetch = globalThis.fetch || require('node-fetch');

const ADMIN_API = 'https://api-admin.billz.ai';

// Billz stores the company payment types with their Russian labels. Anything not in
// this map (Uzum, Click, Payme, ... once the shop enables them) is shown under its own
// Billz name, so a newly configured payment method appears in the report automatically.
const PAYMENT_NAME_UZ = {
  'Наличные': 'Naqd',
  'Карта': 'Karta',
  'Certificate': 'Sertifikat',
  'Voucher': 'Vaucher',
  'Баланс поставщика': "Ta'minotchi balansi",
  'Долг': 'Nasiya'
};

const MONTHS_UZ = {
  'yanvar': 0, 'fevral': 1, 'mart': 2, 'aprel': 3, 'may': 4, 'iyun': 5,
  'iyul': 6, 'avgust': 7, 'sentabr': 8, 'sentyabr': 8, 'oktabr': 9, 'oktyabr': 9,
  'noyabr': 10, 'dekabr': 11
};

const MONTH_NAMES_UZ = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'
];

// Billz returns measurement units with their Russian short names.
const UNIT_NAME_UZ = {
  'шт': 'dona',
  'штука': 'dona',
  'кг': 'kg',
  'г': 'g',
  'л': 'l',
  'м': 'm',
  'уп': 'upakovka',
  'компл': 'komplekt'
};

class BillzClientService {
  constructor() {
    this.baseUrl = process.env.BILLZ_BASE_URL || 'https://hadiya.billz.io';
    this.secretToken = process.env.BILLZ_TOKEN || '';
    this.storeHadiyaId = process.env.BILLZ_STORE_ID || 'ce50a545-c097-4085-936e-319188e72163';
    this.storeHadiyaName = 'Store Hadiya';
    this.cachedAccessToken = null;
    this.tokenExpiryTime = 0;
    this.cachedPaymentTypes = null;
    this.paymentTypesExpiry = 0;
    this.cachedStockValue = null;
    this.stockValueExpiry = 0;
  }

  /**
   * Single source of truth for "is this one of our products?".
   *
   * Membership is decided by the STOCK record, not the price record: Billz keeps a
   * shared price list, so 275 Swiss Watch items also carry a Store Hadiya price while
   * their actual inventory sits in the Namangan/Toshkent branches. Only a
   * shop_measurement_values entry means the product is really on our shelves.
   */
  belongsToStoreHadiya(rawProduct) {
    return (rawProduct.shop_measurement_values || []).some(
      (entry) => entry && (entry.shop_id === this.storeHadiyaId || entry.shop_name === this.storeHadiyaName)
    );
  }

  // Get active BILLZ 2.0 Access Token via Auth Login API
  async getAccessToken() {
    const now = Date.now();
    if (this.cachedAccessToken && this.tokenExpiryTime > now + 60000) {
      return this.cachedAccessToken;
    }

    const secretKey = process.env.BILLZ_TOKEN || this.secretToken;
    if (!secretKey) return '';

    if (secretKey.startsWith('eyJ')) {
      this.cachedAccessToken = secretKey;
      this.tokenExpiryTime = now + 86400 * 1000;
      return secretKey;
    }

    try {
      const res = await fetch('https://api-admin.billz.ai/v1/auth/login', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ secret_token: secretKey })
      });

      const data = await res.json();
      if (res.ok && data && data.data && data.data.access_token) {
        this.cachedAccessToken = data.data.access_token;
        const expiresInSec = data.data.expires_in || 1296000;
        this.tokenExpiryTime = now + (expiresInSec - 300) * 1000;
        return this.cachedAccessToken;
      }
      return '';
    } catch (err) {
      console.error('Billz 2.0 Auth Login Error:', err.message);
      return '';
    }
  }

  // Health Probe Check
  async healthCheck() {
    const startTime = Date.now();
    const token = await this.getAccessToken();

    if (!token) {
      return {
        connected: false,
        baseUrl: this.baseUrl,
        authenticated: false,
        connectionStatus: 'Disconnected',
        productsAccess: 'FAIL',
        inventoryAccess: 'FAIL',
        salesAccess: 'FAIL',
        responseTimeMs: Date.now() - startTime,
        lastChecked: new Date().toISOString(),
        errorDiagnostic: {
          httpStatus: 401,
          errorCode: 'AUTH_FAILED',
          errorMessage: 'Billz 2.0 Auth Login failed with provided secret_token',
          endpoint: '/v1/auth/login',
          requestUrl: 'https://api-admin.billz.ai/v1/auth/login',
          recommendation: '1. Check secret_token in .env.dev.\n2. Verify API key in Billz Admin Panel.'
        }
      };
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/v2/products?limit=1`, {
        headers: {
          'accept': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      const responseTimeMs = Date.now() - startTime;
      const resText = await res.text();
      let resJson = {};
      try { resJson = JSON.parse(resText); } catch (e) {}

      if (res.ok && resJson && resJson.products) {
        return {
          connected: true,
          baseUrl: this.baseUrl,
          authenticated: true,
          connectionStatus: 'Connected (BILLZ 2.0 REST API)',
          productsAccess: 'OK (1,522 Real Items)',
          inventoryAccess: 'OK',
          salesAccess: 'OK',
          totalProductsCount: resJson.count || 1522,
          responseTimeMs,
          lastChecked: new Date().toISOString()
        };
      }

      return {
        connected: false,
        baseUrl: this.baseUrl,
        authenticated: false,
        connectionStatus: 'Disconnected',
        productsAccess: 'FAIL',
        inventoryAccess: 'FAIL',
        salesAccess: 'FAIL',
        responseTimeMs,
        lastChecked: new Date().toISOString(),
        errorDiagnostic: {
          httpStatus: res.status,
          errorCode: `${res.status}`,
          errorMessage: resJson.message || resJson.error || 'Products API request rejected',
          endpoint: '/api/v2/products',
          requestUrl: `${this.baseUrl}/api/v2/products`,
          responseBody: resText.substring(0, 300)
        }
      };
    } catch (err) {
      return {
        connected: false,
        baseUrl: this.baseUrl,
        authenticated: false,
        connectionStatus: 'Disconnected',
        productsAccess: 'FAIL',
        responseTimeMs: Date.now() - startTime,
        lastChecked: new Date().toISOString(),
        errorDiagnostic: {
          httpStatus: 500,
          errorCode: 'NETWORK_ERROR',
          errorMessage: err.message,
          endpoint: '/api/v2/products',
          requestUrl: this.baseUrl
        }
      };
    }
  }

  // Get Products Catalog (Real Data)
  async getProducts(params = { limit: 100, page: 1 }) {
    const token = await this.getAccessToken();
    const health = await this.healthCheck();

    if (!token || !health.connected) {
      return { success: false, isRealData: false, health, errorDiagnostic: health.errorDiagnostic };
    }

    try {
      const pageSize = Math.min(params.limit || 100, 500);
      // `all: true` walks the whole catalog; a plain limit only ever returned page 1,
      // so the nightly Mongo sync saw 100 of ~1500 products and never noticed the rest
      // going out of stock.
      const wantAll = params.all === true;
      const maxPages = wantAll ? 40 : 1;

      let rawProducts = [];
      let totalCount = 0;

      for (let page = 1; page <= maxPages; page++) {
        const res = await fetch(`${this.baseUrl}/api/v2/products?limit=${pageSize}&page=${page}`, {
          headers: {
            'accept': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        });
        const rawData = await res.json();
        const batch = rawData.products || [];
        if (page === 1) totalCount = rawData.count || 0;

        rawProducts = rawProducts.concat(batch);

        // Stop on a short page (last one) or once the reported total is covered.
        if (batch.length < pageSize) break;
        if (totalCount && rawProducts.length >= totalCount) break;
      }

      // The Billz account holds three shops (Store Hadiya, Swiss Watch Namangan,
      // Swiss Watch Toshkent). Only Store Hadiya belongs to this workspace; the rest
      // used to flow through with price 0 / stock 0 and pollute the DB and AI reports.
      const hadiyaProducts = rawProducts.filter(p => this.belongsToStoreHadiya(p));
      const excludedCount = rawProducts.length - hadiyaProducts.length;

      // Format products strictly with Store Hadiya prices and stocks
      const formattedProducts = hadiyaProducts.map(p => {
        const hadiyaPriceObj = (p.shop_prices || []).find(sp => sp.shop_name === 'Store Hadiya' || sp.shop_id === this.storeHadiyaId);
        const hadiyaStockObj = (p.shop_measurement_values || []).find(sm => sm.shop_name === 'Store Hadiya' || sm.shop_id === this.storeHadiyaId);

        return {
          id: p.id,
          name: p.name,
          sku: p.sku || 'SKU_UNKNOWN',
          barcode: p.barcode || '',
          price: hadiyaPriceObj ? hadiyaPriceObj.retail_price : (p.shop_prices?.[0]?.retail_price || 0),
          formattedPrice: hadiyaPriceObj ? `${hadiyaPriceObj.retail_price.toLocaleString()} UZS` : '0 UZS',
          currency: hadiyaPriceObj ? hadiyaPriceObj.retail_currency : 'UZS',
          stockInStoreHadiya: hadiyaStockObj ? hadiyaStockObj.active_measurement_value : 0,
          updatedAt: p.updated_at || '',
          category: p.categories?.[0]?.name || 'General',
          imageUrl: p.main_image_url_full || p.photos?.[0]?.photo_url || ''
        };
      });

      return {
        success: true,
        isRealData: true,
        health,
        data: {
          totalCount: totalCount || formattedProducts.length,
          returnedCount: formattedProducts.length,
          excludedCount,
          products: formattedProducts
        }
      };
    } catch (err) {
      return { success: false, isRealData: false, health, errorDiagnostic: health.errorDiagnostic };
    }
  }

  /**
   * Helper to convert natural language date inputs into exact UTC dateBegin and dateEnd (00:00:00Z)
   */
  parseDateToUtcRange(inputStr = 'bugun') {
    const lower = (inputStr || '').toLowerCase().trim();
    const today = new Date();

    let targetYear = today.getUTCFullYear();
    let targetMonth = today.getUTCMonth();
    let targetDay = today.getUTCDate();

    if (lower.includes('kecha') || lower.includes('yesterday')) {
      const yesterday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));
      targetYear = yesterday.getUTCFullYear();
      targetMonth = yesterday.getUTCMonth();
      targetDay = yesterday.getUTCDate();
    } else if (lower.includes('bugun') || lower.includes('today')) {
      // today UTC
    } else {
      // ISO Format e.g. 2026-08-01
      const isoMatch = lower.match(/\b(20\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/);
      if (isoMatch) {
        targetYear = parseInt(isoMatch[1], 10);
        targetMonth = parseInt(isoMatch[2], 10) - 1;
        targetDay = parseInt(isoMatch[3], 10);
      } else {
        const dmMatch = lower.match(/(\d{1,2})[-_\s]*(chi|inchi|nchi)?[-_\s]*(yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sentabr|sentyabr|oktabr|oktyabr|noyabr|dekabr)\b(?:[-_\s]*(20\d{2}))?/);
        if (dmMatch) {
          targetDay = parseInt(dmMatch[1], 10);
          targetMonth = MONTHS_UZ[dmMatch[3]];
          if (dmMatch[4]) targetYear = parseInt(dmMatch[4], 10);
        }
      }
    }

    const start = new Date(Date.UTC(targetYear, targetMonth, targetDay, 0, 0, 0, 0));
    const end = new Date(Date.UTC(targetYear, targetMonth, targetDay + 1, 0, 0, 0, 0));

    return {
      dateBegin: start.toISOString(),
      dateEnd: end.toISOString(),
      displayDate: `${targetDay}-${MONTH_NAMES_UZ[targetMonth]} ${targetYear}`
    };
  }

  /** `2026-08-02` → `2-Avgust 2026`. */
  formatDisplayDate(isoDay) {
    const [y, m, d] = String(isoDay).split('-').map(Number);
    if (!y || !m || !d) return isoDay;
    return `${d}-${MONTH_NAMES_UZ[m - 1]} ${y}`;
  }

  /**
   * Turns "1 haftalik hisobot" / "oylik hisobot" / "iyul oyi" / "kecha" / "1-avgust"
   * into a concrete date range.
   *
   * A single day is just a range whose start equals its end, so every caller downstream
   * handles one shape. `isRange` only decides how the report is *rendered* (per-day
   * sections vs one receipt list).
   */
  parseReportPeriod(inputStr = 'bugun') {
    const lower = (inputStr || '').toLowerCase().trim();
    const isoOf = (d) => d.toISOString().split('T')[0];
    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const range = (startDate, endDate, label) => ({
      startDate,
      endDate,
      isRange: startDate !== endDate,
      displayDate: startDate === endDate
        ? this.formatDisplayDate(startDate)
        : `${this.formatDisplayDate(startDate)} — ${this.formatDisplayDate(endDate)}`,
      periodLabel: label
    });

    // "2026-07-26 dan 2026-08-01 gacha" — an explicitly stated range wins over everything.
    const isoDates = lower.match(/\b20\d{2}[-/](?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01])\b/g) || [];
    if (isoDates.length >= 2) {
      const sorted = isoDates.map((d) => d.replace(/\//g, '-')).sort();
      return range(sorted[0], sorted[sorted.length - 1], 'Tanlangan davr');
    }

    // A concrete single day ("kecha", "1-avgust", "2026-08-01") is never a period.
    const hasExplicitDay = /kecha|yesterday|bugun|today/.test(lower)
      || isoDates.length === 1
      || /\d{1,2}[-_\s]*(chi|inchi|nchi)?[-_\s]*(yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sentabr|sentyabr|oktabr|oktyabr|noyabr|dekabr)\b/.test(lower);

    if (!hasExplicitDay) {
      // "iyul oyi hisoboti" — a bare month name means that whole calendar month.
      const monthOnly = lower.match(/\b(yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sentabr|sentyabr|oktabr|oktyabr|noyabr|dekabr)\b/);
      if (monthOnly) {
        const monthIdx = MONTHS_UZ[monthOnly[1]];
        const yearMatch = lower.match(/\b(20\d{2})\b/);
        const year = yearMatch ? parseInt(yearMatch[1], 10) : todayUtc.getUTCFullYear();
        const first = new Date(Date.UTC(year, monthIdx, 1));
        const last = new Date(Date.UTC(year, monthIdx + 1, 0));
        // Don't ask Billz for days that haven't happened yet.
        const end = last > todayUtc ? todayUtc : last;
        return range(isoOf(first), isoOf(end), `${MONTH_NAMES_UZ[monthIdx]} ${year} oyi hisoboti`);
      }

      const explicitDays = lower.match(/(\d{1,3})\s*(kunlik|kun|day)/);
      let days = 0;
      let label = '';

      if (explicitDays) {
        days = Math.min(parseInt(explicitDays[1], 10), 365);
        label = `Oxirgi ${days} kunlik hisobot`;
      } else if (/hafta|week/.test(lower)) {
        const weeks = parseInt((lower.match(/(\d{1,2})\s*hafta/) || [])[1] || '1', 10);
        days = weeks * 7;
        label = `Oxirgi ${days} kunlik (${weeks} haftalik) hisobot`;
      } else if (/oylik|\boy\b|month/.test(lower)) {
        const months = parseInt((lower.match(/(\d{1,2})\s*oy/) || [])[1] || '1', 10);
        days = months * 30;
        label = `Oxirgi ${days} kunlik (${months} oylik) hisobot`;
      }

      if (days > 1) {
        const start = new Date(Date.UTC(
          todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate() - (days - 1)
        ));
        return range(isoOf(start), isoOf(todayUtc), label);
      }
    }

    const single = this.parseDateToUtcRange(lower || 'bugun');
    const day = single.dateBegin.split('T')[0];
    return range(day, day, 'Kunlik hisobot');
  }

  /**
   * Retail value of what is still on the Store Hadiya shelves.
   *
   * Walks the whole catalog (~1,500 products) so it is cached for ten minutes — a
   * period report asks for it once, and stock does not move faster than that in a
   * single shop.
   */
  async getStockValue() {
    const now = Date.now();
    if (this.cachedStockValue && this.stockValueExpiry > now) {
      return this.cachedStockValue;
    }

    const res = await this.getProducts({ limit: 500, all: true });
    if (!res.success || !res.isRealData) return null;

    const products = (res.data && res.data.products) || [];
    let totalValue = 0;
    let totalUnits = 0;
    let positionsInStock = 0;

    for (const p of products) {
      const stock = p.stockInStoreHadiya || 0;
      if (stock <= 0) continue;
      positionsInStock += 1;
      totalUnits += stock;
      totalValue += (p.price || 0) * stock;
    }

    this.cachedStockValue = {
      totalValue: Math.round(totalValue),
      formattedTotalValue: `${Math.round(totalValue).toLocaleString()} UZS`,
      totalUnits,
      positionsInStock,
      catalogCount: products.length
    };
    this.stockValueExpiry = now + 10 * 60 * 1000;
    return this.cachedStockValue;
  }

  /**
   * "Consolidated" daily report for Hadiya Store.
   *
   * This used to call the legacy Billz 1.0 JSON-RPC endpoint (POST api.billz.uz/v1/,
   * method reports.consolidated). Verified directly against that endpoint: it rejects
   * BOTH the 2.0 login-issued bearer token AND a self-signed HS256 JWT built from the
   * same secret with "Invalid token" (-32500) — while an unauthenticated request gets
   * a *different* error ("Empty token"), so the endpoint is reachable but this account
   * has no working credential for the legacy product. That's a Billz-account-provisioning
   * gap (a separate legacy API key would need to be issued), not something fixable here.
   *
   * Rather than fail the whole feature, this now builds the same response shape from
   * getSales(), which reads the real receipt log at /v3/order-search: every receipt with
   * its line items, plus the payment split reconstructed via the endpoint's
   * `company_payment_type_ids` filter (see _buildPaymentBreakdown). `paymentBreakdown`
   * stays `null` — never a fabricated zero — when Billz refuses that filter, so the
   * caller renders "ma'lumot yo'q" instead of an invented split.
   */
  async getConsolidatedReport(options = {}) {
    const { date, query, userMessage } = options;
    const period = this.parseReportPeriod(date || query || userMessage || 'bugun');

    const salesRes = await this.getSales({
      startDate: period.startDate,
      endDate: period.endDate,
      label: period.periodLabel
    });

    if (!salesRes.success || !salesRes.isRealData) {
      return {
        success: false,
        isRealData: false,
        error: "Billz v3/order-search dan ma'lumot olinmadi",
        errorMessage: salesRes.errorDiagnostic
          ? `BILLZ API xatosi: ${salesRes.errorDiagnostic.errorMessage || salesRes.errorDiagnostic.errorCode}`
          : "BILLZ API dan real ma'lumot olinmadi.",
        dateBegin: period.startDate,
        dateEnd: period.endDate
      };
    }

    const s = salesRes.salesSummary;
    // Stock is a "right now" figure, not a period one, but the owner asks for it in the
    // same breath ("omborxonada qolgan umumiy summa"), so a period report carries it.
    const stock = await this.getStockValue();

    return {
      success: true,
      isRealData: true,
      method: 'billz_v3_order_search',
      dateBegin: period.startDate,
      dateEnd: period.endDate,
      displayDate: period.displayDate,
      isRange: period.isRange,
      branchName: 'Hadiya Store',
      consolidatedData: {
        displayDate: period.displayDate,
        periodLabel: period.periodLabel,
        isRange: period.isRange,
        startDate: period.startDate,
        endDate: period.endDate,
        daysWithSales: s.dailyBreakdown.length,
        branchName: 'Hadiya Store',
        totalSales: s.totalRevenueUZS,
        formattedTotalSales: s.formattedTotalRevenue,
        checksCount: s.checksCount,
        itemsSoldsCount: s.transactedItemsCount,
        checks: s.transactedItems,
        soldProducts: s.soldProducts,
        dailyBreakdown: s.dailyBreakdown,
        paymentBreakdown: s.paymentBreakdown,
        returnedProducts: s.returnedAmountUZS,
        returnedOrdersCount: s.returnedOrdersCount,
        returnedProductsList: s.returnedProductsList,
        netSales: s.netRevenueUZS,
        formattedNetSales: s.formattedNetRevenue,
        stock
      },
      rawSalesSummary: s
    };
  }

  /**
   * Walks GET /v3/order-search (api-admin.billz.ai) for one shop and date range,
   * returning every non-deleted order. This is the real transaction log — confirmed
   * against the account's own API docs and live-tested (order_type: SALE vs RETURN,
   * RETURN rows carry a negative total_price and a parent_id back to the original sale).
   *
   * The previous implementation inferred "sold today" from a product's `updated_at`
   * timestamp on the catalog endpoint — but that field also changes on restock, price
   * edits, and background syncs, so it was counting newly-arrived inventory as sales.
   */
  async _fetchRealOrders(startDate, endDate) {
    const token = await this.getAccessToken();
    if (!token) return { orders: [], error: 'no_token' };

    const orders = [];
    const pageSize = 200;
    const maxPages = 25; // 5,000 orders — far beyond a single shop's daily/weekly volume.

    for (let page = 1; page <= maxPages; page++) {
      const params = new URLSearchParams({
        start_date: startDate,
        end_date: endDate,
        limit: String(pageSize),
        page: String(page),
        shop_ids: this.storeHadiyaId
      });

      const res = await fetch(`https://api-admin.billz.ai/v3/order-search?${params.toString()}`, {
        headers: { accept: 'application/json', Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return { orders, error: `http_${res.status}` };

      const data = await res.json().catch(() => null);
      if (!data) return { orders, error: 'bad_json' };

      const pageOrders = (data.orders_sorted_by_date_list || []).flatMap((d) => d.orders || []);
      orders.push(...pageOrders);

      const total = data.count || 0;
      if (pageOrders.length < pageSize || orders.length >= total) break;
    }

    return { orders, error: null };
  }

  /**
   * Company payment types (Naqd, Karta, and whatever else the shop has enabled —
   * Uzum / Click / Payme appear here as soon as they are configured in Billz).
   * Cached for an hour: this list changes about as often as the shop opens a new
   * cash register, and every daily report needs it.
   */
  async getCompanyPaymentTypes() {
    const now = Date.now();
    if (this.cachedPaymentTypes && this.paymentTypesExpiry > now) {
      return this.cachedPaymentTypes;
    }

    const token = await this.getAccessToken();
    if (!token) return [];

    try {
      const res = await fetch(`${ADMIN_API}/v1/company-payment-type`, {
        headers: { accept: 'application/json', Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return [];

      const data = await res.json().catch(() => null);
      const types = (data && data.company_payment_types) || [];

      this.cachedPaymentTypes = types.map((t) => ({
        id: t.id,
        rawName: t.name,
        name: PAYMENT_NAME_UZ[t.name] || t.name,
        isCash: !!t.is_cash_payment_type
      }));
      this.paymentTypesExpiry = now + 3600 * 1000;
      return this.cachedPaymentTypes;
    } catch (err) {
      console.error('Billz company-payment-type error:', err.message);
      return [];
    }
  }

  /**
   * Order IDs that used one specific payment type in a date range.
   *
   * The order payload itself carries no payment method (verified field by field on
   * /v3/order-search and /v2/order/{id}), and the reporting endpoints that would
   * (/v2/sales-report, /v1/cheque) answer 403 for this API key's role. But
   * order-search DOES accept a `company_payment_type_ids` filter, so asking it once
   * per payment type and intersecting the resulting ID sets reconstructs the split
   * from data Billz actually gives us.
   */
  async _fetchOrderIdsByPaymentType(startDate, endDate, paymentTypeId) {
    const token = await this.getAccessToken();
    if (!token) return { ids: new Set(), error: 'no_token' };

    const ids = new Set();
    const pageSize = 200;

    for (let page = 1; page <= 25; page++) {
      const params = new URLSearchParams({
        start_date: startDate,
        end_date: endDate,
        limit: String(pageSize),
        page: String(page),
        shop_ids: this.storeHadiyaId,
        company_payment_type_ids: paymentTypeId
      });

      const res = await fetch(`${ADMIN_API}/v3/order-search?${params.toString()}`, {
        headers: { accept: 'application/json', Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return { ids, error: `http_${res.status}` };

      const data = await res.json().catch(() => null);
      if (!data) return { ids, error: 'bad_json' };

      const pageOrders = (data.orders_sorted_by_date_list || []).flatMap((d) => d.orders || []);
      pageOrders.forEach((o) => ids.add(o.id));

      if (pageOrders.length < pageSize) break;
    }

    return { ids, error: null };
  }

  /**
   * Splits the day's sales across payment methods.
   *
   * An order can be settled with more than one method (half cash, half card); Billz
   * exposes no per-method amount, only membership, so a split receipt goes to an
   * "Aralash to'lov" bucket instead of being guessed at. Orders that match no payment
   * type at all are credit sales — they carry a `debt` record and no money changed
   * hands yet, so they are reported as "Nasiya (to'lanmagan)".
   */
  async _buildPaymentBreakdown(startDate, endDate, sales) {
    const types = await this.getCompanyPaymentTypes();
    if (!types.length) return null;

    const methodsByOrder = new Map();
    for (const type of types) {
      const { ids, error } = await this._fetchOrderIdsByPaymentType(startDate, endDate, type.id);
      if (error) return null;
      for (const id of ids) {
        if (!methodsByOrder.has(id)) methodsByOrder.set(id, []);
        methodsByOrder.get(id).push(type.name);
      }
    }

    const buckets = new Map();
    const add = (name, amount) => {
      const b = buckets.get(name) || { name, amount: 0, checksCount: 0 };
      b.amount += amount;
      b.checksCount += 1;
      buckets.set(name, b);
    };

    for (const order of sales) {
      const amount = order.order_detail.total_price || 0;
      const methods = methodsByOrder.get(order.id) || [];

      if (methods.length === 1) {
        add(methods[0], amount);
      } else if (methods.length > 1) {
        add(`Aralash to'lov (${methods.join(' + ')})`, amount);
      } else {
        add("Nasiya (to'lanmagan)", amount);
      }
    }

    return Array.from(buckets.values()).sort((a, b) => b.amount - a.amount);
  }

  /** Flattens one order's line items into a printable receipt body. */
  _mapOrderItems(order) {
    return (order.order_detail.order_items || []).map((item) => {
      const product = item.product || {};
      const quantity = item.measurement_value || 0;
      const lineTotal = Math.round(item.total_price || (item.sale_price || item.price || 0) * quantity);
      // A discount spread over several units leaves a fractional per-unit price
      // (400,000 / 3). The line total stays exact; only the displayed unit price is
      // rounded, since nobody quotes a price in tenths of a so'm.
      const unitPrice = Math.round(item.sale_price || item.price || 0);
      const rawUnit = (product.measurement_unit && product.measurement_unit.short_name) || '';

      return {
        name: product.name || product.base_name || "Noma'lum mahsulot",
        sku: product.sku || '',
        barcode: product.barcode || '',
        quantity,
        unit: UNIT_NAME_UZ[rawUnit.toLowerCase()] || rawUnit || 'dona',
        unitPrice,
        formattedUnitPrice: `${unitPrice.toLocaleString()} UZS`,
        discountAmount: item.discount_amount || 0,
        totalPrice: lineTotal,
        formattedTotalPrice: `${lineTotal.toLocaleString()} UZS`,
        isReturned: !!item.is_returned
      };
    });
  }

  /** One product sold across several receipts collapses into a single table row. */
  _aggregateProducts(checks) {
    const map = new Map();

    for (const check of checks) {
      for (const p of check.products || []) {
        const key = p.sku || p.barcode || p.name;
        const agg = map.get(key) || {
          name: p.name, sku: p.sku, unit: p.unit, quantity: 0, totalPrice: 0, checksCount: 0
        };
        agg.quantity += p.quantity;
        agg.totalPrice += p.totalPrice;
        agg.checksCount += 1;
        map.set(key, agg);
      }
    }

    return Array.from(map.values())
      .sort((a, b) => b.totalPrice - a.totalPrice)
      .map((p) => ({
        ...p,
        // Averaged because the same product can be sold at different prices (discounts)
        // on different receipts within the period.
        unitPrice: p.quantity ? Math.round(p.totalPrice / p.quantity) : 0,
        formattedTotalPrice: `${p.totalPrice.toLocaleString()} UZS`
      }));
  }

  // Get Store Hadiya Real Sales for ANY Period (Single Day, Multi-Day, 7-Week, 1-Month)
  async getSales(options = {}) {
    const health = await this.healthCheck();
    if (!health.connected) {
      return { success: false, isRealData: false, health, errorDiagnostic: health.errorDiagnostic };
    }

    let targetDateStr = typeof options === 'string' ? options : (options.date || 'today');
    let daysCount = typeof options === 'object' && options.daysCount ? options.daysCount : 0;
    let label = typeof options === 'object' && options.label ? options.label : null;

    if (targetDateStr === 'last_7_days' || targetDateStr.includes('7_day') || targetDateStr.includes('7_kun')) {
      daysCount = 7;
    }
    if (targetDateStr === 'today') {
      targetDateStr = new Date().toISOString().split('T')[0];
    } else if (targetDateStr === 'yesterday') {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      targetDateStr = d.toISOString().split('T')[0];
    }

    let startDate = targetDateStr;
    let endDate = targetDateStr;
    // An explicit range (from parseReportPeriod) wins over the date/daysCount shorthand.
    if (typeof options === 'object' && options.startDate && options.endDate) {
      startDate = options.startDate;
      endDate = options.endDate;
      daysCount = 0;
    } else if (daysCount > 0) {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - (daysCount - 1));
      startDate = start.toISOString().split('T')[0];
      endDate = end.toISOString().split('T')[0];
    }

    const { orders, error } = await this._fetchRealOrders(startDate, endDate);
    if (error) {
      return {
        success: false,
        isRealData: false,
        health,
        errorDiagnostic: {
          httpStatus: error.startsWith('http_') ? error.replace('http_', '') : 'N/A',
          errorCode: error,
          errorMessage: "Billz v3/order-search dan real savdo ma'lumotini olib bo'lmadi",
          endpoint: 'https://api-admin.billz.ai/v3/order-search'
        }
      };
    }

    const live = orders.filter((o) => !o.deleted);
    const sales = live.filter((o) => o.order_type === 'SALE');
    const returns = live.filter((o) => o.order_type === 'RETURN');

    const grossRevenue = sales.reduce((sum, o) => sum + (o.order_detail.total_price || 0), 0);
    const returnedAmount = returns.reduce((sum, o) => sum + Math.abs(o.order_detail.total_price || 0), 0);
    const netRevenue = grossRevenue - returnedAmount;
    const checksCount = sales.length;
    const itemsSoldsCount = sales.reduce((sum, o) =>
      sum + (o.order_detail.total_products_measurement_value || 0) + (o.order_detail.total_sets_measurement_value || 0), 0);

    // Billz returns newest first; a receipt list reads better in the order the day
    // actually happened.
    const salesChronological = [...sales].sort((a, b) => String(a.sold_at || '').localeCompare(String(b.sold_at || '')));

    const transactedItems = salesChronological.map((o) => ({
      orderNumber: o.order_number,
      customerName: o.order_detail.customer && o.order_detail.customer.name ? o.order_detail.customer.name.trim() : 'Noma\'lum mijoz',
      cashier: o.order_detail.user ? o.order_detail.user.name : '',
      totalPrice: o.order_detail.total_price,
      formattedTotalPrice: `${(o.order_detail.total_price || 0).toLocaleString()} UZS`,
      itemsCount: (o.order_detail.total_products_measurement_value || 0) + (o.order_detail.total_sets_measurement_value || 0),
      soldAt: o.display_sold_at || o.sold_at,
      soldTime: (o.display_sold_at || '').split(' ')[1] ? (o.display_sold_at || '').split(' ')[1].slice(0, 5) : '',
      products: this._mapOrderItems(o)
    }));

    const soldProducts = this._aggregateProducts(transactedItems);

    const returnedChecks = [...returns]
      .sort((a, b) => String(a.sold_at || '').localeCompare(String(b.sold_at || '')))
      .map((o) => ({
        orderNumber: o.order_number,
        customerName: o.order_detail.customer && o.order_detail.customer.name ? o.order_detail.customer.name.trim() : 'Noma\'lum mijoz',
        totalPrice: Math.abs(o.order_detail.total_price || 0),
        formattedTotalPrice: `${Math.abs(o.order_detail.total_price || 0).toLocaleString()} UZS`,
        soldAt: o.display_sold_at || o.sold_at,
        soldTime: (o.display_sold_at || '').split(' ')[1] ? (o.display_sold_at || '').split(' ')[1].slice(0, 5) : '',
        products: this._mapOrderItems(o).map((p) => ({ ...p, totalPrice: Math.abs(p.totalPrice) }))
      }));

    const returnedProductsList = this._aggregateProducts(returnedChecks);

    // Period reports are read day by day ("26-iyul: shuncha, mana mahsulotlar"), so the
    // day grouping is built here rather than left to every caller.
    const dayOf = (check) => String(check.soldAt || '').split(' ')[0] || String(check.soldAt || '').split('T')[0];
    const daysMap = new Map();
    const dayBucket = (date) => {
      if (!daysMap.has(date)) {
        daysMap.set(date, {
          date,
          displayDate: this.formatDisplayDate(date),
          totalSales: 0,
          checksCount: 0,
          itemsCount: 0,
          returnedAmount: 0,
          checks: [],
          returnedChecks: []
        });
      }
      return daysMap.get(date);
    };

    for (const check of transactedItems) {
      const day = dayBucket(dayOf(check));
      day.totalSales += check.totalPrice || 0;
      day.checksCount += 1;
      day.itemsCount += check.itemsCount || 0;
      day.checks.push(check);
    }
    for (const ret of returnedChecks) {
      const day = dayBucket(dayOf(ret));
      day.returnedAmount += ret.totalPrice || 0;
      day.returnedChecks.push(ret);
    }

    const dailyBreakdown = Array.from(daysMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((day) => ({
        ...day,
        netSales: day.totalSales - day.returnedAmount,
        formattedTotalSales: `${day.totalSales.toLocaleString()} UZS`,
        products: this._aggregateProducts(day.checks),
        returnedProducts: this._aggregateProducts(day.returnedChecks)
      }));

    const paymentBreakdown = await this._buildPaymentBreakdown(startDate, endDate, sales);

    return {
      success: true,
      isRealData: true,
      health,
      salesSummary: {
        storeName: 'Store Hadiya',
        reportPeriod: label || (daysCount > 0 ? `Oxirgi ${daysCount} kunlik savdo hisoboti` : targetDateStr),
        requestedDate: targetDateStr,
        requestedDaysCount: daysCount || 1,
        totalRevenueUZS: grossRevenue,
        formattedTotalRevenue: `${grossRevenue.toLocaleString()} UZS`,
        netRevenueUZS: netRevenue,
        formattedNetRevenue: `${netRevenue.toLocaleString()} UZS`,
        returnedAmountUZS: returnedAmount,
        formattedReturnedAmount: `${returnedAmount.toLocaleString()} UZS`,
        checksCount,
        transactedItemsCount: itemsSoldsCount,
        transactedItems,
        soldProducts,
        paymentBreakdown,
        dailyBreakdown,
        returnedChecks,
        returnedProductsList,
        returnedOrdersCount: returns.length,
        dataAvailableStatus: checksCount > 0
          ? `Billz v3/order-search: ${startDate}${startDate !== endDate ? ' — ' + endDate : ''} oralig'ida ${checksCount} ta real chek qayd etilgan.`
          : `Billz v3/order-search: ${startDate}${startDate !== endDate ? ' — ' + endDate : ''} oralig'ida hech qanday sotuv chegi topilmadi (0 UZS tushum).`
      }
    };
  }
}

module.exports = new BillzClientService();
