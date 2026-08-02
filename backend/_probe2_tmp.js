require('dotenv').config({ path: '/Users/mac/Desktop/jarvis/.env.dev' });
const billz = require('/Users/mac/Desktop/jarvis/backend/src/services/billzClientService');

const ORDER_ID = '324be0af-2eee-4cf4-b1f5-6e492e06b97f';

const candidates = [
  '/v1/company-payment-type',
  '/v1/company-payment-types',
  '/v1/payment-type',
  '/v2/payment-type',
  '/v1/payment',
  `/v1/order/${ORDER_ID}`,
  `/v2/order/${ORDER_ID}`,
  `/v3/order/${ORDER_ID}`,
  `/v1/orders/${ORDER_ID}`,
  '/v1/order-payment',
  '/v2/order-payment',
  '/v1/orders?limit=1',
  '/v2/orders?limit=1',
  '/v1/order?limit=1',
];

(async () => {
  const token = await billz.getAccessToken();
  for (const path of candidates) {
    try {
      const res = await fetch(`https://api-admin.billz.ai${path}`, {
        headers: { accept: 'application/json', Authorization: `Bearer ${token}` }
      });
      const text = await res.text();
      console.log(`\n### ${path} -> ${res.status}`);
      console.log(text.slice(0, 700));
    } catch (e) {
      console.log(`\n### ${path} -> ERR ${e.message}`);
    }
  }
})();
