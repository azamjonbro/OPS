require('dotenv').config({ path: '/Users/mac/Desktop/jarvis/.env.dev' });
const billz = require('/Users/mac/Desktop/jarvis/backend/src/services/billzClientService');

(async () => {
  const token = await billz.getAccessToken();
  const params = new URLSearchParams({
    start_date: '2026-08-01',
    end_date: '2026-08-01',
    limit: '5',
    page: '1',
    shop_ids: billz.storeHadiyaId
  });
  const res = await fetch(`https://api-admin.billz.ai/v3/order-search?${params}`, {
    headers: { accept: 'application/json', Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  const orders = (data.orders_sorted_by_date_list || []).flatMap(d => d.orders || []);
  for (const o of orders) {
    console.log('=== ORDER', o.order_number, o.order_type, o.order_detail.total_price);
    console.log('top-level keys:', Object.keys(o).join(', '));
    console.log('detail keys:', Object.keys(o.order_detail).join(', '));
    const payKeys = Object.keys(o.order_detail).filter(k => /pay|cash|card|transaction/i.test(k));
    for (const k of payKeys) console.log('  ', k, '=', JSON.stringify(o.order_detail[k]));
    const topPay = Object.keys(o).filter(k => /pay|cash|card|transaction/i.test(k));
    for (const k of topPay) console.log('  TOP', k, '=', JSON.stringify(o[k]));
    console.log('items:', o.order_detail.order_items.map(i => `${i.product && i.product.name} x${i.measurement_value} = ${i.sale_price}`).join(' | '));
  }
})();
