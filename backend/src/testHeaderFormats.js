require('dotenv').config({ path: './.env.dev' });
require('dotenv').config();

const connectorRegistry = require('./connectors/registry');
const billzConnector = connectorRegistry.get('BILLZ');
const token = billzConnector.getToken();

async function testHeaderFormats() {
  const cleanToken = (token || '').trim();

  const headersToTest = [
    { 'Authorization': `Bearer ${cleanToken}` },
    { 'Authorization': cleanToken },
    { 'Secret-Token': cleanToken },
    { 'secret-token': cleanToken },
    { 'x-api-key': cleanToken }
  ];

  const urlsToTest = [
    'https://api.billz.uz/v1/',
    'https://api.billz.uz/v2/',
    'https://api.billz.io/v1/',
    'https://api.billz.io/v2/'
  ];

  for (const url of urlsToTest) {
    for (const h of headersToTest) {
      const hName = Object.keys(h)[0];
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...h
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'products.get',
            params: {},
            id: '1'
          })
        });
        const data = await res.json();
        console.log(`[${url}] [Header: ${hName}] Status: ${res.status} ->`, JSON.stringify(data).substring(0, 150));
      } catch (e) {
        console.log(`[${url}] Error: ${e.message}`);
      }
    }
  }
}

testHeaderFormats();
