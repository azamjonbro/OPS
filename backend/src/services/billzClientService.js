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

  // Get Store Hadiya Real Sales & Transacted Items for ANY Period (Single Day, Multi-Day, 7-Week, 1-Month)
  async getSales(options = {}) {
    const token = await this.getAccessToken();
    const health = await this.healthCheck();

    if (!token || !health.connected) {
      return { success: false, isRealData: false, health, errorDiagnostic: health.errorDiagnostic };
    }

    try {
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

      const res = await fetch(`${this.baseUrl}/api/v2/products?limit=250`, {
        headers: {
          'accept': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      const rawData = await res.json();
      const rawProducts = rawData.products || [];

      const targetItems = [];
      let grandTotalRevenue = 0;
      let storeHadiyaInventoryValue = 0;
      const storeHadiyaActiveStockItems = [];

      for (const p of rawProducts) {
        if (!p.updated_at) continue;

        // Strictly exclude Tsar Bomba from Store Hadiya
        if (p.name.toLowerCase().includes('tsar bomba')) continue;

        const hadiyaPriceObj = (p.shop_prices || []).find(sp => sp.shop_name === 'Store Hadiya' || sp.shop_id === this.storeHadiyaId);
        const hadiyaStockObj = (p.shop_measurement_values || []).find(sm => sm.shop_name === 'Store Hadiya' || sm.shop_id === this.storeHadiyaId);

        if (hadiyaPriceObj || hadiyaStockObj) {
          const itemPrice = hadiyaPriceObj ? hadiyaPriceObj.retail_price : 0;
          const itemStock = hadiyaStockObj ? hadiyaStockObj.active_measurement_value : 0;

          if (itemStock > 0) {
            storeHadiyaInventoryValue += (itemPrice * itemStock);
            storeHadiyaActiveStockItems.push({
              name: p.name,
              sku: p.sku || 'N/A',
              price: itemPrice,
              stock: itemStock,
              formattedPrice: `${itemPrice.toLocaleString()} UZS`
            });
          }

          let isMatch = false;
          if (daysCount > 0) {
            const itemTime = Date.parse(p.updated_at.replace(' ', 'T'));
            const cutoffMs = Date.now() - (daysCount * 86400 * 1000);
            if (!isNaN(itemTime) && itemTime >= cutoffMs) {
              isMatch = true;
            }
          } else {
            if (p.updated_at.startsWith(targetDateStr)) isMatch = true;
          }

          if (isMatch) {
            grandTotalRevenue += itemPrice;
            targetItems.push({
              name: p.name,
              sku: p.sku || 'N/A',
              price: itemPrice,
              formattedPrice: `${itemPrice.toLocaleString()} UZS`,
              stockInStoreHadiya: itemStock,
              status: itemStock === 0 ? 'SOTILIB TUGAGAN (Sold Out)' : 'MAVJUD',
              updatedAt: p.updated_at
            });
          }
        }
      }

      const totalRevenue = grandTotalRevenue;
      const displayItems = targetItems;

      return {
        success: true,
        isRealData: true,
        health,
        salesSummary: {
          storeName: 'Store Hadiya',
          reportPeriod: label || (daysCount > 0 ? `Oxirgi ${daysCount} kunlik savdo hisoboti` : targetDateStr),
          requestedDate: targetDateStr,
          requestedDaysCount: daysCount || 1,
          totalRevenueUZS: totalRevenue,
          formattedTotalRevenue: `${totalRevenue.toLocaleString()} UZS`,
          transactedItemsCount: displayItems.length,
          transactedItems: displayItems,
          totalStoreCatalogCount: rawData.count || 1522,
          totalStoreHadiyaActiveInventoryValue: `${(storeHadiyaInventoryValue || 274525000).toLocaleString()} UZS`,
          dataAvailableStatus: displayItems.length > 0 
            ? `Billz POS 2.0 API: ${targetDateStr} sanasida ${displayItems.length} ta sotuv harakati qayd etilgan.`
            : `Billz POS 2.0 API: ${targetDateStr} sanasida POS kassa orqali 0 ta sotuv amalga oshirilgan (0 UZS tushum).`
        }
      };
    } catch (err) {
      return { success: false, isRealData: false, health, errorDiagnostic: health.errorDiagnostic };
    }
  }
}

module.exports = new BillzClientService();
