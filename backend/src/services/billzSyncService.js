const mongoose = require('mongoose');
const Product = require('../models/Product');
const connectorRegistry = require('../connectors/registry');

class BillzSyncService {
  constructor() {
    this.cronInterval = null;
  }

  async syncProductsFromBillz() {
    console.log('==================================================');
    console.log('🔄 STARTING AUTOMATED DAILY BILLZ POS -> MONGODB SYNC');
    console.log('==================================================');

    const startTime = Date.now();
    const alertsGenerated = [];

    // 1. Fetch latest product catalog from Billz connector
    const billzConnector = connectorRegistry.get('BILLZ');
    // The nightly sync needs the whole catalog, not just the first page.
    const toolRes = await billzConnector.executeTool('billz_get_products', { all: true, limit: 500 });
    let catalogProducts = (toolRes.data && toolRes.data.products && toolRes.data.products.length > 0) ? toolRes.data.products : [
      { name: "Rolex Swiss copy", sku: "MGL-74542", stock: 45, price: 10000000, formattedPrice: "10 000 000 so'm", category: "Qo'l soatlari" },
      { name: "SwissWatch Premium Chronograph", sku: "SW-CHR-909", stock: 18, price: 8100000, formattedPrice: "8 100 000 so'm", category: "Qo'l soatlari" },
      { name: "Royal Diamond Ring 18K Gold", sku: "JW-RNG-108", stock: 12, price: 24500000, formattedPrice: "24 500 000 so'm", category: "Zargarlik" },
      { name: "Cartier Gold Bangle Bracelet", sku: "JW-BRC-204", stock: 15, price: 18900000, formattedPrice: "18 900 000 so'm", category: "Zargarlik" },
      { name: "Classic Leather Strap Luxury Watch", sku: "WTC-LTH-902", stock: 24, price: 3500000, formattedPrice: "3 500 000 so'm", category: "Qo'l soatlari" },
      { name: "Executive Genuine Leather Briefcase", sku: "LTH-BAG-501", stock: 30, price: 4200000, formattedPrice: "4 200 000 so'm", category: "Aksessuarlar" },
      { name: "Montblanc Meisterstück Fountain Pen", sku: "PEN-MNT-99", stock: 40, price: 6800000, formattedPrice: "6 800 000 so'm", category: "Aksessuarlar" },
      { name: "Premium Velvet Gift Box Set", sku: "GFT-BX-01", stock: 120, price: 1150000, formattedPrice: "1 150 000 so'm", category: "Sovg'alar & Qutilar" }
    ];

    const excluded = (toolRes.data && toolRes.data.excludedCount) || 0;
    console.log(`📦 Loaded ${catalogProducts.length} Store Hadiya items${excluded ? ` (${excluded} foreign-branch products skipped)` : ''}${toolRes.isRealData ? '' : ' — mock fallback, Billz API unavailable'}`);

    // Billz contains 14 SKUs shared by different products. The Product collection is
    // keyed by SKU, so without de-duplicating here the loop would write the same
    // document twice per run and the second write would silently undo the first.
    const seenSkus = new Set();
    catalogProducts = catalogProducts.filter(item => {
      const sku = item.sku;
      if (!sku || sku === 'SKU_UNKNOWN') return false;
      if (seenSkus.has(sku)) {
        console.warn(`↩️ Duplicate SKU skipped: ${sku} ("${item.name}")`);
        return false;
      }
      seenSkus.add(sku);
      return true;
    });

    if (mongoose.connection.readyState !== 1) {
      console.log('⚠️ MongoDB not connected yet. Skipping DB write.');
      return { success: false, message: 'MongoDB not connected' };
    }

    let createdCount = 0;
    let updatedCount = 0;

    for (const item of catalogProducts) {
      try {
        const sku = item.sku || `SKU-${Date.now()}`;
        // The live Billz client emits `stockInStoreHadiya`; only the local mock rows use
        // `stock`. Reading `stock` alone silently wrote every real product in as 0 /
        // OUT_OF_STOCK, which also poisoned the fast-seller alerts.
        const rawStock = item.stockInStoreHadiya != null ? item.stockInStoreHadiya : item.stock;
        const newStock = Number(rawStock || 0);
        const priceNum = Number(item.price || 0);

        let existing = await Product.findOne({ sku });

        if (!existing) {
          // NEW PRODUCT ADDED TO BILLZ
          const newProd = await Product.create({
            sku,
            name: item.name,
            category: item.category || 'General',
            price: priceNum,
            formattedPrice: item.formattedPrice || `${priceNum.toLocaleString()} so'm`,
            stock: newStock,
            initialStock: newStock,
            importedAt: new Date(),
            status: newStock > 0 ? (newStock <= 5 ? 'LOW_STOCK' : 'IN_STOCK') : 'OUT_OF_STOCK',
            lastSyncedAt: new Date()
          });
          createdCount++;
          console.log(`✨ [NEW PRODUCT ADDED TO MONGO] ${newProd.name} (SKU: ${sku}, Stock: ${newStock})`);
        } else {
          // EXISTING PRODUCT STOCK & VELOCITY ANALYSIS
          const oldStock = existing.stock;
          let outOfStockAt = existing.outOfStockAt;
          let salesVelocity = existing.salesVelocity;
          let notificationSent = existing.notificationSent;

          // Detect Out-of-Stock Event
          if (oldStock > 0 && newStock === 0) {
            outOfStockAt = new Date();
            const importedDate = existing.importedAt ? new Date(existing.importedAt) : new Date(Date.now() - 5 * 86400000);
            const daysToSellOut = Math.max(1, Math.ceil((outOfStockAt - importedDate) / (1000 * 60 * 60 * 24)));

            if (daysToSellOut <= 14) {
              salesVelocity = 'FAST_SELLER';
            } else if (daysToSellOut <= 30) {
              salesVelocity = 'NORMAL';
            } else {
              salesVelocity = 'SLOW';
            }

            // Create Executive Telegram & AI Alert
            if (!notificationSent) {
              const alertMsg = `🚀 **TEZ SOTILGAN MAHSULOT TUGADI (OUT OF STOCK ALERT):**\n\n` +
                `• **Mahsulot:** ${existing.name}\n` +
                `• **SKU:** ${existing.sku}\n` +
                `• **Boshlang'ich Zaxira:** ${existing.initialStock || oldStock} dona\n` +
                `• **Olib Kelingan Sana:** ${importedDate.toLocaleDateString()}\n` +
                `• **Tugagan Sana:** ${outOfStockAt.toLocaleDateString()}\n` +
                `• **Sotib Bo'lingan Vaqt:** ${daysToSellOut} kun ichida!\n` +
                `• **Sotilish Sur'ati:** ${salesVelocity === 'FAST_SELLER' ? '🔥 JUDA YAXSHI KETGAN (FAST SELLER)' : 'NORMAL'}\n\n` +
                `💡 *Tavsiya:* Ushbu mahsulot juda yaxshi ketgani sababli, Billz POS orqali qayta buyurtma berish tavsiya etiladi.`;

              alertsGenerated.push({
                productName: existing.name,
                sku: existing.sku,
                daysToSellOut,
                salesVelocity,
                alertMsg
              });

              // Send Telegram Alert
              await connectorRegistry.executeTool('telegram_send_message', {
                chatId: '@admin_channel',
                text: alertMsg
              });

              notificationSent = true;
            }
          } else if (newStock > 0 && oldStock === 0) {
            // Stock replenished
            outOfStockAt = null;
            notificationSent = false;
          }

          existing.stock = newStock;
          existing.price = priceNum;
          existing.formattedPrice = item.formattedPrice || `${priceNum.toLocaleString()} so'm`;
          existing.status = newStock > 0 ? (newStock <= 5 ? 'LOW_STOCK' : 'IN_STOCK') : 'OUT_OF_STOCK';
          existing.outOfStockAt = outOfStockAt;
          existing.salesVelocity = salesVelocity;
          existing.notificationSent = notificationSent;
          existing.lastSyncedAt = new Date();

          await existing.save();
          updatedCount++;
        }
      } catch (err) {
        console.error(`Error syncing product ${item.sku}:`, err.message);
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(`✅ SYNC COMPLETE IN ${durationMs}ms: Created ${createdCount}, Updated ${updatedCount}, Alerts: ${alertsGenerated.length}`);

    return {
      success: true,
      createdCount,
      updatedCount,
      totalSynced: createdCount + updatedCount,
      alertsGenerated,
      durationMs
    };
  }

  startDailyCronJob() {
    // Run initial sync right away on startup
    setTimeout(() => {
      this.syncProductsFromBillz().catch(err => console.error('Initial Billz sync error:', err.message));
    }, 3000);

    // Schedule daily sync every 24 hours (86400000 ms)
    if (this.cronInterval) clearInterval(this.cronInterval);
    this.cronInterval = setInterval(() => {
      console.log('⏰ Executing 24-hour scheduled Billz POS sync...');
      this.syncProductsFromBillz().catch(err => console.error('Cron Billz sync error:', err.message));
    }, 86400000);

    console.log('⏰ Daily Billz POS -> MongoDB Sync Service Scheduled (Every 24 Hours)');
  }
}

module.exports = new BillzSyncService();
