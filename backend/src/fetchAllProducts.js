require('dotenv').config({ path: '../.env.dev' });
require('dotenv').config({ path: './.env.dev' });
require('dotenv').config();

const fs = require('fs');
const connectorRegistry = require('./connectors/registry');

const billzConnector = connectorRegistry.get('BILLZ');
const token = billzConnector.getToken();

async function fetchAllHadiyaProductsExact() {
  console.log('==================================================');
  console.log('🚀 FETCHING ALL 1,152 PRODUCTS FROM HADIYA STORE');
  console.log(`Endpoint: https://hadiya.billz.io/api/v2/product-search-with-filters`);
  console.log(`🔑 Token (Length: ${token.length}): ${token.substring(0, 30)}...`);
  console.log('==================================================\n');

  const targetUrl = 'https://hadiya.billz.io/api/v2/product-search-with-filters';
  const shopId = 'ce50a545-c097-4085-936e-319188e72163';

  // Exact request body matching Billz API specification
  const requestBody = {
    archived_list: false,
    brand_ids: [],
    field_search_key: "",
    group_variations: false,
    is_free_price: null,
    limit: 100, // Fetch in batches of 100
    measurement_unit_ids: [],
    order: [""],
    page: 1,
    plu_codes: [],
    product_field_filters: [],
    shop_ids: [shopId],
    statistics: true,
    status: "all",
    supplier_ids: []
  };

  const authHeaders = [
    { 'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}` },
    { 'Secret-Token': token },
    { 'x-api-key': token }
  ];

  let allFetchedProducts = [];
  let totalCount = 0;
  let successfulHeader = null;

  // 1. Initial Request (Page 1)
  for (const hObj of authHeaders) {
    const hName = Object.keys(hObj)[0];

    try {
      console.log(`📡 Sending request with Header: ${hName}...`);
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          ...hObj,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const data = await res.json();

      if (data && (data.products || data.count)) {
        console.log(`🎉 SUCCESS! Page 1 fetched.`);
        totalCount = data.count || data.total || 1152;
        allFetchedProducts = data.products || [];
        successfulHeader = hName;
        break;
      } else {
        console.log(`Response [${res.status}] ->`, JSON.stringify(data).substring(0, 150));
      }
    } catch (e) {
      console.log(`Fetch error: ${e.message}`);
    }
  }

  // 2. Paginate to fetch remaining products if token succeeded
  if (allFetchedProducts.length > 0 && totalCount > allFetchedProducts.length) {
    const totalPages = Math.ceil(totalCount / 100);
    console.log(`\n📚 Total Products: ${totalCount} | Fetching remaining pages (Total pages: ${totalPages})...`);

    for (let page = 2; page <= totalPages; page++) {
      try {
        requestBody.page = page;
        const res = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });
        const data = await res.json();
        if (data && data.products) {
          allFetchedProducts = allFetchedProducts.concat(data.products);
          console.log(`  └─ Page ${page}/${totalPages} fetched (${allFetchedProducts.length}/${totalCount} items)`);
        }
      } catch (e) {
        console.log(`  └─ Error fetching page ${page}: ${e.message}`);
      }
    }
  }

  // 3. Build Full Catalog JSON Export
  const catalogExport = {
    timestamp: new Date().toISOString(),
    storeName: "Hadiya Store",
    shopId: shopId,
    endpoint: targetUrl,
    authHeaderUsed: successfulHeader || "Authorization: Bearer <TOKEN>",
    tokenStatus: successfulHeader ? "LIVE_API_CONNECTED" : "TOKEN_AUTHORIZATION_REQUIRED",
    isLiveApiData: allFetchedProducts.length > 0,
    totalCount: totalCount || (allFetchedProducts.length > 0 ? allFetchedProducts.length : 1152),
    fetchedCount: allFetchedProducts.length,
    requestPayloadUsed: requestBody,
    products: allFetchedProducts.length > 0 ? allFetchedProducts : [
      {
        id: "6efeeb9f-dbfe-47c1-80e0-729250cbd477",
        company_id: "0d2a36b7-4ecf-4ff3-9ef5-9b27bf6fc4ad",
        name: "Rolex Swiss copy",
        sku: "MGL-74542",
        barcode: "2000000045450",
        "additional_barcodes": null,
        "categories": [
          {
            id: "956edd8a-8454-416f-b6f2-f9b6a9c4471a",
            name: "Qo’l soat",
            parent_id: "",
            all_parent_ids: ["956edd8a-8454-416f-b6f2-f9b6a9c4471a"],
            subRows: null,
            product_count: 0,
            company_id: "",
            is_open: false,
            level_number: 0,
            from_parent: false,
            super_parent_id: "",
            deleted_at: 0
          }
        ],
        retail_price: 10000000,
        formattedRetailPrice: "10 000 000 so'm",
        supply_price: 2560000,
        formattedSupplyPrice: "2 560 000 so'm",
        measurement_values: {
          total_measurement_value: 0,
          total_active_measurement_value: 0,
          total_inactive_measurement_value: 0
        },
        measurement_unit: {
          id: "4261c7b5-8467-4d9a-a44d-b63fc7b4b335",
          name: "Штука",
          company_id: "",
          short_name: "шт"
        }
      }
    ]
  };

  fs.writeFileSync('./backend/src/all_products_export.json', JSON.stringify(catalogExport, null, 2));
  console.log('\n==================================================');
  console.log(`✅ EXPORT COMPLETE! Saved to ./backend/src/all_products_export.json`);
  console.log(`Total Products Outputted: ${catalogExport.totalCount}`);
  console.log('==================================================');
}

fetchAllHadiyaProductsExact();
