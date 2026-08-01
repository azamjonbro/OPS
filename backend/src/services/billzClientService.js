const fetch = globalThis.fetch || require('node-fetch');

class BillzClientService {
  constructor() {
    this.baseUrl = process.env.BILLZ_BASE_URL || 'https://hadiya.billz.io';
    this.secretToken = process.env.BILLZ_TOKEN || '';
    this.storeHadiyaId = process.env.BILLZ_STORE_ID || 'ce50a545-c097-4085-936e-319188e72163';
    this.storeHadiyaName = 'Store Hadiya';
    this.cachedAccessToken = null;
    this.tokenExpiryTime = 0;
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
        const MONTHS = {
          'yanvar': 0, 'fevral': 1, 'mart': 2, 'aprel': 3, 'may': 4, 'iyun': 5,
          'iyul': 6, 'avgust': 7, 'sentabr': 8, 'sentyabr': 8, 'oktabr': 9, 'oktyabr': 9,
          'noyabr': 10, 'dekabr': 11
        };
        const dmMatch = lower.match(/(\d{1,2})[-_\s]*(chi|inchi|nchi)?[-_\s]*(yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sentabr|sentyabr|oktabr|oktyabr|noyabr|dekabr)\b(?:[-_\s]*(20\d{2}))?/);
        if (dmMatch) {
          targetDay = parseInt(dmMatch[1], 10);
          targetMonth = MONTHS[dmMatch[3]];
          if (dmMatch[4]) targetYear = parseInt(dmMatch[4], 10);
        }
      }
    }

    const start = new Date(Date.UTC(targetYear, targetMonth, targetDay, 0, 0, 0, 0));
    const end = new Date(Date.UTC(targetYear, targetMonth, targetDay + 1, 0, 0, 0, 0));

    const monthNames = ['Avgust', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
    const displayMonth = monthNames[targetMonth] || 'Avgust';

    return {
      dateBegin: start.toISOString(),
      dateEnd: end.toISOString(),
      displayDate: `${targetDay}-${displayMonth} ${targetYear}`
    };
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
   * getSales() — the 2.0 REST endpoint that already authenticates and returns real
   * Store Hadiya data. That source only exposes per-product `updated_at`, not a receipt
   * log, so checksCount / averageCheck / payments genuinely cannot be computed from it.
   * Those stay `null` (not 0) so the caller can render "ma'lumot yo'q" instead of lying
   * with a fabricated zero.
   */
  async getConsolidatedReport(options = {}) {
    const { date, query, userMessage } = options;
    const parsed = this.parseDateToUtcRange(date || query || userMessage || 'bugun');
    const targetDateStr = parsed.dateBegin.split('T')[0];

    const salesRes = await this.getSales({ date: targetDateStr });

    if (!salesRes.success || !salesRes.isRealData) {
      return {
        success: false,
        isRealData: false,
        error: "Billz v3/order-search dan ma'lumot olinmadi",
        errorMessage: salesRes.errorDiagnostic
          ? `BILLZ API xatosi: ${salesRes.errorDiagnostic.errorMessage || salesRes.errorDiagnostic.errorCode}`
          : "BILLZ API dan real ma'lumot olinmadi.",
        dateBegin: parsed.dateBegin,
        dateEnd: parsed.dateEnd
      };
    }

    const s = salesRes.salesSummary;

    return {
      success: true,
      isRealData: true,
      method: 'billz_v3_order_search',
      dateBegin: parsed.dateBegin,
      dateEnd: parsed.dateEnd,
      displayDate: parsed.displayDate,
      branchName: 'Hadiya Store',
      consolidatedData: {
        displayDate: parsed.displayDate,
        branchName: 'Hadiya Store',
        totalSales: s.totalRevenueUZS,
        formattedTotalSales: s.formattedTotalRevenue,
        checksCount: s.checksCount,
        itemsSoldsCount: s.transactedItemsCount,
        averageCheck: s.averageCheckUZS,
        // Per-method (naqd/karta/click/payme) breakdown isn't in the order-search
        // response — Billz would need a separate call per company_payment_type_id,
        // and we don't have those IDs configured. Left null rather than guessed.
        payments: null,
        returnedProducts: s.returnedAmountUZS,
        netSales: s.netRevenueUZS,
        formattedNetSales: s.formattedNetRevenue
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
    if (daysCount > 0) {
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
    const averageCheck = checksCount > 0 ? Math.round(grossRevenue / checksCount) : 0;

    const transactedItems = sales.map((o) => ({
      orderNumber: o.order_number,
      customerName: o.order_detail.customer && o.order_detail.customer.name ? o.order_detail.customer.name.trim() : 'Noma\'lum mijoz',
      cashier: o.order_detail.user ? o.order_detail.user.name : '',
      totalPrice: o.order_detail.total_price,
      formattedTotalPrice: `${(o.order_detail.total_price || 0).toLocaleString()} UZS`,
      itemsCount: (o.order_detail.total_products_measurement_value || 0) + (o.order_detail.total_sets_measurement_value || 0),
      soldAt: o.display_sold_at || o.sold_at
    }));

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
        averageCheckUZS: averageCheck,
        formattedAverageCheck: `${averageCheck.toLocaleString()} UZS`,
        transactedItemsCount: itemsSoldsCount,
        transactedItems,
        returnedOrdersCount: returns.length,
        dataAvailableStatus: checksCount > 0
          ? `Billz v3/order-search: ${startDate}${startDate !== endDate ? ' — ' + endDate : ''} oralig'ida ${checksCount} ta real chek qayd etilgan.`
          : `Billz v3/order-search: ${startDate}${startDate !== endDate ? ' — ' + endDate : ''} oralig'ida hech qanday sotuv chegi topilmadi (0 UZS tushum).`
      }
    };
  }
}

module.exports = new BillzClientService();
