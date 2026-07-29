require('dotenv').config({ path: './.env.dev' });
require('dotenv').config();

const connectorRegistry = require('./connectors/registry');
const billzConnector = connectorRegistry.get('BILLZ');
const token = billzConnector.getToken();

console.log('==================================================');
console.log('📡 TESTING OFFICIAL BILLZ JSON-RPC 2.0 API');
console.log(`Endpoint Base: https://api.billz.uz/v1/ & https://api.billz.uz/v2/`);
console.log(`Token Length: ${token ? token.length : 0}`);
console.log('==================================================\n');

async function testOfficialBillz() {
  const cleanToken = (token || '').trim();
  const bearerToken = cleanToken.startsWith('Bearer ') ? cleanToken : `Bearer ${cleanToken}`;

  const endpoints = [
    { url: 'https://api.billz.uz/v1/', method: 'products.get', params: { IncludeEmptyStocks: 1 } },
    { url: 'https://api.billz.uz/v1/', method: 'products.get', params: {} },
    { url: 'https://api.billz.uz/v2/', method: 'catalog.get', params: { PerPage: 10, Page: 1 } },
    { url: 'https://api.billz.uz/v1/', method: 'reports.sales', params: { dateBegin: "2026-01-01T00:00:00Z", dateEnd: "2026-12-31T23:59:59Z", currency: "UZS" } }
  ];

  for (const ep of endpoints) {
    try {
      console.log(`▶ Probing Endpoint: [${ep.url}] Method: [${ep.method}]`);
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'Authorization': bearerToken,
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: ep.method,
          params: ep.params,
          id: '1'
        })
      });

      console.log(`   HTTP Status: ${res.status}`);
      const data = await res.json();
      console.log(`   Response JSON:`, JSON.stringify(data).substring(0, 300));
      
      if (data.result) {
        console.log(`   🎉 SUCCESS! Total or Items Count:`, Array.isArray(data.result) ? data.result.length : (data.result.total || 'N/A'));
      }
    } catch (e) {
      console.log(`   ❌ Error probing ${ep.method}: ${e.message}`);
    }
    console.log('--------------------------------------------------');
  }
}

testOfficialBillz();
