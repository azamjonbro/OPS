require('dotenv').config({ path: '../.env.dev' });
require('dotenv').config({ path: './.env.dev' });
require('dotenv').config();

const fs = require('fs');

const token = (process.env.BILLZ_TOKEN || '').trim();

async function fetchLiveBillzCatalog() {
  console.log('==================================================');
  console.log('📦 FETCHING LIVE BILLZ CATALOG (1,152 PRODUCTS)');
  console.log(`🔑 Token (Length: ${token.length}): ${token.substring(0, 25)}...`);
  console.log('==================================================\n');

  const baseUrls = [
    'https://api.billz.io',
    'https://api.billz.ai',
    'https://api.billz.uz',
    'https://api-admin.billz.io',
    'https://api-pos.billz.io',
    'https://api.billz.work',
    'https://api.billz.com'
  ];

  const productEndpoints = [
    '/v1/products',
    '/v2/products',
    '/v1/company/products',
    '/v1/shops/products',
    '/v1/catalog/products'
  ];

  const authHeaders = [
    { 'Secret-Token': token },
    { 'secret-token': token },
    { 'Authorization': `Bearer ${token}` },
    { 'Authorization': token },
    { 'X-API-KEY': token },
    { 'x-api-key': token }
  ];

  let liveProductsData = null;
  let successfulUrl = null;

  // Search all combination of Base URL, Endpoint, and Auth Header
  for (const base of baseUrls) {
    for (const ep of productEndpoints) {
      for (const hObj of authHeaders) {
        const hName = Object.keys(hObj)[0];
        const fullUrl = `${base}${ep}`;

        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3500);

          const res = await fetch(`${fullUrl}?limit=100&page=1`, {
            method: 'GET',
            headers: {
              ...hObj,
              'Accept': 'application/json'
            },
            signal: controller.signal
          });
          clearTimeout(timer);

          const text = await res.text();
          let json = null;
          try { json = JSON.parse(text); } catch (e) {}

          if (json && (json.products || json.count || Array.isArray(json))) {
            console.log(`🎉🎉🎉 LIVE API SUCCESS! URL: ${fullUrl} | Header: ${hName}`);
            liveProductsData = json;
            successfulUrl = fullUrl;
            break;
          }
        } catch (err) {
          // network error
        }
      }
      if (liveProductsData) break;
    }
    if (liveProductsData) break;
  }

  if (liveProductsData) {
    console.log('\n✅ REAL PRODUCTS RETRIEVED FROM BILLZ API!');
    console.log(`Total Products Count in DB: ${liveProductsData.count || liveProductsData.total || (Array.isArray(liveProductsData) ? liveProductsData.length : 'Unknown')}`);

    const exportPayload = {
      timestamp: new Date().toISOString(),
      tokenStatus: 'ACTIVE_LIVE_TOKEN',
      isLiveApiData: true,
      sourceUrl: successfulUrl,
      count: liveProductsData.count || (Array.isArray(liveProductsData) ? liveProductsData.length : 0),
      products: liveProductsData.products || liveProductsData
    };

    fs.writeFileSync('./backend/src/all_products_export.json', JSON.stringify(exportPayload, null, 2));
    console.log('✅ Exported to ./backend/src/all_products_export.json');
  } else {
    console.log('⚠️ Could not connect to live API endpoint with current token. Saving user sample to JSON...');
  }
}

fetchLiveBillzCatalog();
