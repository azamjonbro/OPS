require('dotenv').config({ path: '/Users/mac/Desktop/jarvis/.env.dev' });
const billz = require('/Users/mac/Desktop/jarvis/backend/src/services/billzClientService');
const names = ['payment','payments','order-payment','order-payments','order-payment-search','payment-transaction','transaction-search','cashbox-history-search','cash-flow','cashflow','finance','finance-report','report','reports','analytics','analytic','sale-report','sales-report','revenue','income','order-item-search','order-item','receipt','cheque','check','kassa','cashier-report','shift-report','z-report','payment-report','order-payment-report','sale-search','sales-search','order-statistics','payment-statistics'];
(async()=>{
 const token=await billz.getAccessToken();
 const hosts=['https://api-admin.billz.ai','https://hadiya.billz.io/api'];
 for(const h of hosts) for(const v of ['v1','v2','v3']) for(const n of names){
  const url=`${h}/${v}/${n}?limit=1`;
  try{
   const res=await fetch(url,{headers:{accept:'application/json',Authorization:`Bearer ${token}`}});
   if(res.status===404) continue;
   const t=await res.text();
   console.log(`${res.status} ${url}  ::  ${t.slice(0,160).replace(/\n/g,' ')}`);
  }catch(e){}
 }
})();
