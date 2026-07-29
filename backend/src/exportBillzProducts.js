require('dotenv').config({ path: './.env.dev' });
require('dotenv').config();

const fs = require('fs');
const connectorRegistry = require('./connectors/registry');
const billzConnector = connectorRegistry.get('BILLZ');
const token = billzConnector.getToken();

console.log('==================================================');
console.log('📦 EXPORTING ALL PRODUCTS FROM BILLZ POS');
console.log(`Endpoint: https://api.billz.uz/v1/ (JSON-RPC 2.0)`);
console.log(`Token Length: ${token ? token.length : 0}`);
console.log('==================================================\n');

async function exportAllProducts() {
  const cleanToken = (token || '').trim();
  const bearerToken = cleanToken.startsWith('Bearer ') ? cleanToken : `Bearer ${cleanToken}`;

  try {
    const res = await fetch('https://api.billz.uz/v1/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'Authorization': bearerToken,
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'products.get',
        params: {
          IncludeEmptyStocks: 1
        },
        id: '1'
      })
    });

    const data = await res.json();
    console.log('HTTP Status:', res.status);
    console.log('Response:', JSON.stringify(data).substring(0, 300));

    if (data.result && Array.isArray(data.result)) {
      console.log(`\n🎉 SUCCESS! Fetched ${data.result.length} products from live Billz API!`);
      const exportObject = {
        timestamp: new Date().toISOString(),
        storeName: "Hadiya Store",
        tokenStatus: "LIVE_CONNECTED",
        totalCount: data.result.length,
        products: data.result
      };
      fs.writeFileSync('./backend/src/all_products_export.json', JSON.stringify(exportObject, null, 2));
      console.log('✅ Saved to backend/src/all_products_export.json');
    } else if (data.error) {
      console.log(`\n⚠️ Billz API Error: [Code: ${data.error.code}] ${data.error.message}`);
      if (data.error.message.includes('Invalid token') || data.error.message.includes('Empty token')) {
        console.log('❌ TOKEN ERROR: Billz server is rejecting the current token as invalid or expired.');
      }
    }
  } catch (err) {
    console.log('❌ Request Error:', err.message);
  }
}

exportAllProducts();
