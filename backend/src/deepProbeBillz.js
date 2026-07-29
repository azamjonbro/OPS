require('dotenv').config({ path: '../.env.dev' });
require('dotenv').config({ path: './.env.dev' });
require('dotenv').config();

const token = (process.env.BILLZ_TOKEN || '').trim();

async function deepProbe() {
  console.log('==================================================');
  console.log('🚀 DEEP BILLZ API AUTHENTICATION & CATALOG PROBE');
  console.log(`🔑 Token string (Length: ${token.length}): ${token.substring(0, 30)}...`);
  console.log('==================================================\n');

  const baseUrls = [
    'https://api.billz.io',
    'https://api.billz.ai',
    'https://api.billz.uz',
    'https://api-admin.billz.io',
    'https://api-pos.billz.io',
    'https://api.billz.work'
  ];

  const restEndpoints = [
    '/v1/products',
    '/v2/products',
    '/v1/catalog',
    '/v1/shops',
    '/v1/company',
    '/v1/sales',
    '/v1/inventory'
  ];

  const headerVariations = [
    { 'Authorization': `Bearer ${token}` },
    { 'Secret-Token': token },
    { 'secret-token': token },
    { 'X-API-KEY': token },
    { 'x-api-key': token },
    { 'X-Secret-Key': token },
    { 'Authorization': token },
    { 'Token': token }
  ];

  let foundSuccess = null;

  // 1. PROBE REST GET REQUESTS
  console.log('--- 1. PROBING REST GET ENDPOINTS ---');
  for (const base of baseUrls) {
    for (const ep of restEndpoints) {
      for (const hObj of headerVariations) {
        const hName = Object.keys(hObj)[0];
        try {
          const url = `${base}${ep}`;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2000);

          const res = await fetch(url, {
            method: 'GET',
            headers: {
              ...hObj,
              'Accept': 'application/json'
            },
            signal: controller.signal
          });
          clearTimeout(timer);

          const status = res.status;
          let bodyText = await res.text();
          let parsed = null;
          try { parsed = JSON.parse(bodyText); } catch(e){}

          if (res.ok && parsed && !parsed.error) {
            console.log(`🎉🎉🎉 REST GET SUCCESS! Base: ${base} | Endpoint: ${ep} | Header: ${hName}`);
            console.log('DATA:', JSON.stringify(parsed).substring(0, 300));
            foundSuccess = { type: 'REST_GET', base, ep, hName, data: parsed };
            break;
          } else if (status !== 404 && status !== 502) {
            console.log(`[REST GET ${status}] ${base}${ep} | Header: ${hName} ->`, bodyText.substring(0, 100));
          }
        } catch(e){}
      }
      if (foundSuccess) break;
    }
    if (foundSuccess) break;
  }

  // 2. PROBE REST GET WITH QUERY PARAMETERS
  if (!foundSuccess) {
    console.log('\n--- 2. PROBING REST GET WITH QUERY PARAMS ---');
    const queryParams = [
      `secret_token=${token}`,
      `token=${token}`,
      `api_key=${token}`,
      `secret_key=${token}`,
      `access_token=${token}`
    ];

    for (const base of baseUrls) {
      for (const ep of restEndpoints) {
        for (const q of queryParams) {
          try {
            const url = `${base}${ep}?${q}`;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 2000);

            const res = await fetch(url, {
              method: 'GET',
              headers: { 'Accept': 'application/json' },
              signal: controller.signal
            });
            clearTimeout(timer);

            let bodyText = await res.text();
            let parsed = null;
            try { parsed = JSON.parse(bodyText); } catch(e){}

            if (res.ok && parsed && !parsed.error) {
              console.log(`🎉🎉🎉 QUERY PARAM GET SUCCESS! URL: ${url}`);
              console.log('DATA:', JSON.stringify(parsed).substring(0, 300));
              foundSuccess = { type: 'QUERY_GET', url, data: parsed };
              break;
            } else if (res.status !== 404 && res.status !== 502) {
              console.log(`[QUERY GET ${res.status}] ${url} ->`, bodyText.substring(0, 100));
            }
          } catch(e){}
        }
        if (foundSuccess) break;
      }
      if (foundSuccess) break;
    }
  }

  // 3. PROBE JSON-RPC METHODS & PARAM VARIATIONS
  if (!foundSuccess) {
    console.log('\n--- 3. PROBING JSON-RPC WITH TOKEN IN PARAMS ---');
    const rpcMethods = ['products.get', 'products.list', 'reports.sales', 'shops.get', 'company.get'];
    const rpcEndpoints = ['https://api.billz.io/v1/products', 'https://api.billz.io/v1', 'https://api.billz.io/v1/shops'];

    for (const url of rpcEndpoints) {
      for (const method of rpcMethods) {
        for (const hObj of headerVariations) {
          const hName = Object.keys(hObj)[0];
          try {
            const res = await fetch(url, {
              method: 'POST',
              headers: {
                ...hObj,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                jsonrpc: '2.0',
                method: method,
                params: {
                  secret_token: token,
                  token: token,
                  api_key: token
                },
                id: 1
              })
            });

            const data = await res.json();
            if (data.result) {
              console.log(`🎉🎉🎉 JSON-RPC SUCCESS! URL: ${url} | Method: ${method} | Header: ${hName}`);
              console.log('DATA:', JSON.stringify(data.result).substring(0, 300));
              foundSuccess = { type: 'JSON_RPC', url, method, data: data.result };
              break;
            } else if (data.error && data.error.code !== -32601) {
              console.log(`[JSON-RPC ${data.error.code}] ${url} | ${method} | ${hName} ->`, data.error.message);
            }
          } catch(e){}
        }
        if (foundSuccess) break;
      }
      if (foundSuccess) break;
    }
  }

  console.log('\n==================================================');
  console.log('PROBE FINISHED.');
  console.log('==================================================');
}

deepProbe();
