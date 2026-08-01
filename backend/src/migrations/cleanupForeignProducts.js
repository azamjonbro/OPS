/**
 * Migration: remove products that do not belong to Store Hadiya.
 *
 * Before the shop filter existed, the nightly sync imported all three Billz branches,
 * so the Product collection contains Swiss Watch Namangan / Toshkent inventory that
 * was never ours. Those rows were written with price 0 and stock 0, which skews every
 * stock report and AI answer.
 *
 * The authoritative list of "ours" comes from Billz itself (products Store Hadiya
 * actually carries stock for), not from a name pattern — matching on "Swiss" would
 * both miss foreign products with other names and delete a legitimately-named one.
 *
 * Usage:
 *   node src/migrations/cleanupForeignProducts.js --dry-run   # report only
 *   node src/migrations/cleanupForeignProducts.js             # delete
 */

require('dotenv').config({ path: '../.env.dev' });
require('dotenv').config({ path: './.env.dev' });
require('dotenv').config();

const mongoose = require('mongoose');
const Product = require('../models/Product');
const billzClient = require('../services/billzClientService');

async function cleanupForeignProducts({ dryRun = false } = {}) {
  const result = { scanned: 0, kept: 0, deleted: 0, skipped: false };

  const res = await billzClient.getProducts({ all: true, limit: 500 });
  if (!res.success || !res.isRealData) {
    // Deleting against an empty/failed fetch would wipe the whole collection.
    console.error('🔴 Billz API unavailable — aborting so the collection is not wiped.');
    result.skipped = true;
    return result;
  }

  const validSkus = new Set(
    (res.data.products || []).map(p => p.sku).filter(sku => sku && sku !== 'SKU_UNKNOWN')
  );

  if (validSkus.size === 0) {
    console.error('🔴 Billz returned 0 Store Hadiya SKUs — aborting as a safety guard.');
    result.skipped = true;
    return result;
  }

  const stored = await Product.find({}, { sku: 1, name: 1 }).lean();
  result.scanned = stored.length;

  const foreign = stored.filter(p => !validSkus.has(p.sku));
  result.kept = stored.length - foreign.length;

  console.log(`🔎 Store Hadiya SKUs from Billz : ${validSkus.size}`);
  console.log(`🔎 Products stored in MongoDB   : ${result.scanned}`);
  console.log(`🔎 Foreign products to remove   : ${foreign.length}`);
  foreign.slice(0, 10).forEach(p => console.log(`   - ${p.sku} | ${p.name}`));
  if (foreign.length > 10) console.log(`   ... va yana ${foreign.length - 10} ta`);

  if (dryRun) {
    console.log('🧪 Dry run — hech narsa o\'chirilmadi.');
    return result;
  }

  if (foreign.length > 0) {
    const del = await Product.deleteMany({ _id: { $in: foreign.map(p => p._id) } });
    result.deleted = del.deletedCount || 0;
  }

  console.log(`✅ O'chirildi: ${result.deleted} ta | Qoldi: ${result.kept} ta`);
  return result;
}

// Run standalone (not when imported by the server).
if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ai_workspace';

  mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 })
    .then(() => cleanupForeignProducts({ dryRun }))
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(err => {
      console.error('🔴 Migration failed:', err.message);
      process.exit(1);
    });
}

module.exports = cleanupForeignProducts;
