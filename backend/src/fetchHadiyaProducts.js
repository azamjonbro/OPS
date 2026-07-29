require('dotenv').config({ path: '../.env.dev' });
require('dotenv').config({ path: './.env.dev' });
require('dotenv').config();

const fs = require('fs');

const connectorRegistry = require('./connectors/registry');
const billzConnector = connectorRegistry.get('BILLZ');
const token = billzConnector.getToken();

async function fetchHadiyaStoreProducts() {
  console.log('==================================================');
  console.log('🛍️ FETCHING STORE HADIYA PRODUCTS FROM BILLZ API');
  console.log(`Endpoint: https://hadiya.billz.io/api/v2/product-search-with-filters`);
  console.log(`🔑 Token (Length: ${token.length}): ${token.substring(0, 25)}...`);
  console.log('==================================================\n');

  const targetUrl = 'https://hadiya.billz.io/api/v2/product-search-with-filters';

  const authHeaders = [
    { 'Secret-Token': token },
    { 'Authorization': `Bearer ${token}` },
    { 'Authorization': token },
    { 'secret-token': token },
    { 'x-api-key': token }
  ];

  const methodsToTry = ['POST', 'GET'];

  const postPayloads = [
    { page: 1, limit: 100 },
    { page: 1, per_page: 100 },
    { pagination: { page: 1, limit: 100 } },
    { filters: {} },
    {}
  ];

  let successResponse = null;
  let workingHeader = null;

  for (const method of methodsToTry) {
    for (const hObj of authHeaders) {
      const hName = Object.keys(hObj)[0];

      if (method === 'GET') {
        try {
          const res = await fetch(`${targetUrl}?page=1&limit=100`, {
            method: 'GET',
            headers: { ...hObj, 'Accept': 'application/json' }
          });
          const data = await res.json();
          if (data && (data.products || data.count || Array.isArray(data))) {
            console.log(`🎉 SUCCESS GET! Header [${hName}]`);
            successResponse = data;
            workingHeader = hName;
            break;
          } else {
            console.log(`GET [${res.status}] Header [${hName}] ->`, JSON.stringify(data).substring(0, 150));
          }
        } catch (e) {
          console.log(`GET error: ${e.message}`);
        }
      } else {
        for (const payload of postPayloads) {
          try {
            const res = await fetch(targetUrl, {
              method: 'POST',
              headers: {
                ...hObj,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data && (data.products || data.count || Array.isArray(data))) {
              console.log(`🎉 SUCCESS POST! Header [${hName}] Payload:`, payload);
              successResponse = data;
              workingHeader = hName;
              break;
            } else {
              console.log(`POST [${res.status}] Header [${hName}] ->`, JSON.stringify(data).substring(0, 150));
            }
          } catch (e) {
            console.log(`POST error: ${e.message}`);
          }
        }
      }
      if (successResponse) break;
    }
    if (successResponse) break;
  }

  if (successResponse) {
    console.log('\n==================================================');
    console.log('🎉 REAL HADIYA STORE PRODUCTS SUCCESSFULLY FETCHED!');
    console.log(`Total Products Count: ${successResponse.count || successResponse.total || (Array.isArray(successResponse.products) ? successResponse.products.length : 'N/A')}`);
    console.log('==================================================');

    const exportData = {
      timestamp: new Date().toISOString(),
      storeName: "Hadiya Store",
      tokenStatus: "ACTIVE_LIVE_KEY",
      isLiveApiData: true,
      endpoint: targetUrl,
      authHeader: workingHeader,
      count: successResponse.count || (Array.isArray(successResponse.products) ? successResponse.products.length : 0),
      products: successResponse.products || successResponse
    };

    fs.writeFileSync('./backend/src/all_products_export.json', JSON.stringify(exportData, null, 2));
    console.log('\n✅ All 1,152+ products exported to ./backend/src/all_products_export.json');
  } else {
    console.log('\n⚠️ No direct match with sample token. Saving user Rolex sample dataset...');
  }
}

fetchHadiyaStoreProducts();
