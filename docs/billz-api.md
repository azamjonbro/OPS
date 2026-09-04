# Billz API — what Hadiya uses, and how it was established

Billz publishes no public API reference. `api-docs.billz.ai` is the Billz
application itself and asks for a company login; `api-admin.billz.ai/swagger/doc.json`
answers `403`. Nothing in this integration is therefore taken from an official
document, and nothing in it is guessed.

Every endpoint below is confirmed by at least one of two independent sources,
and the table says which:

- **legacy** — the client this repository ran in production against the
  company's own Billz account, recovered from git history (`b026ff5`,
  `backend/src/services/billzClientService.js`). Its comments record which
  endpoints were live-tested and which were refused.
- **wrapper** — [`billzio-api`](https://github.com/Botifi/billzio-api), a
  published Python client for the Billz.io public v2 API.

Where both agree, the entry is marked _both_, which is the strongest evidence
available short of Billz's own documentation.

## Base URL and authentication

`https://api-admin.billz.ai` — confirmed by both sources.

```
POST /v1/auth/login   { "secret_token": "<BILLZ_API_TOKEN>" }
  -> { "data": { "access_token", "refresh_token", "token_type", "expires_in" } }
```

The access token is then sent as `Authorization: Bearer <access_token>`. Hadiya
caches it until shortly before `expires_in` elapses and re-authenticates once on
a `401` (`client/billz-auth.ts`).

## Endpoints Hadiya calls

| Endpoint                   | Method | Parameters                                                                        | Evidence | Used for                           |
| -------------------------- | ------ | --------------------------------------------------------------------------------- | -------- | ---------------------------------- |
| `/v1/auth/login`           | POST   | `secret_token`                                                                    | both     | Authentication                     |
| `/v2/products`             | GET    | `page`, `limit`, `search`, `last_updated_date`                                    | both     | Catalogue, stock, incremental sync |
| `/v2/category`             | GET    | `page`, `limit`, `search`, `is_deleted`                                           | wrapper  | Categories                         |
| `/v2/brand`                | GET    | `page`, `limit`                                                                   | wrapper  | Brands                             |
| `/v1/shop`                 | GET    | `page`, `limit`                                                                   | wrapper  | Shops → Hadiya branches            |
| `/v2/company-currencies`   | GET    | —                                                                                 | wrapper  | Currencies                         |
| `/v1/company-payment-type` | GET    | —                                                                                 | both     | Payment methods                    |
| `/v1/client`               | GET    | `page`, `limit`, `search`, `phone_number`                                         | wrapper  | Customers                          |
| `/v3/order-search`         | GET    | `start_date`, `end_date`, `page`, `limit`, `shop_ids`, `company_payment_type_ids` | legacy   | Receipts, returns, debts           |
| `/v2/order/{id}`           | GET    | —                                                                                 | legacy   | One receipt in full                |

### Response shapes worth knowing

`/v2/products` returns `{ products: [...], count }`. Price and stock are **per
shop**, not per product: `shop_prices[]` carries `retail_price` / `supply_price`
and `shop_measurement_values[]` carries `active_measurement_value`. A company
with several shops therefore has one catalogue row per product with a price for
each shop — which is why `BILLZ_SHOP_IDS` exists.

`/v3/order-search` groups its results by day:
`{ orders_sorted_by_date_list: [ { date, orders: [...] } ], count }`. A return is
its own order with `order_type: "RETURN"`, a negative `total_price` and a
`parent_id` pointing at the sale it reverses, and it reports units in
`returned_measurement_value` rather than `measurement_value`.

## Endpoints deliberately not called

| Endpoint                                                                                         | Why not                                                                                                                 |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/orders` (`order.create`, `order.add_item`, `order.add_customer`, `order.make_payment`) | Hadiya rings up its own sales. Writing them to Billz as well would give one sale two records in two systems.            |
| `POST /v1/client`, `PUT /v1/client/{id}`                                                         | Same reason: a customer written from both systems ends up duplicated. Hadiya owns its customers and only reads Billz's. |

## Capabilities Billz does not give this credential

These were established against the real account and are the reason parts of the
brief for this phase could not be built. None of them is a limitation of the
code.

| Wanted                                      | Endpoint                                                                     | What actually happens                                                                                                                                                                                                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expenses                                    | `GET /v1/gl-transaction`                                                     | Rejects the API secret token. It accepts only an interactive user session (phone + password login), so an integration built on an API key cannot read it.                                                                                                                                 |
| Sales reports                               | `GET /v2/sales-report`                                                       | `403` for this API key's role.                                                                                                                                                                                                                                                            |
| Receipt/cheque data                         | `GET /v1/cheque`                                                             | `403` for this API key's role.                                                                                                                                                                                                                                                            |
| Consolidated reports                        | `POST https://api.billz.uz/v1/` (`reports.consolidated`, Billz 1.0 JSON-RPC) | Rejects both the 2.0 bearer token and a self-signed JWT with "Invalid token". An unauthenticated call fails differently ("Empty token"), so the endpoint is reachable but the account holds no credential for the legacy product.                                                         |
| Payment method per receipt                  | —                                                                            | An order carries no payment method in any exposed endpoint. Hadiya reconstructs the split by querying `/v3/order-search` once per payment type with `company_payment_type_ids` and intersecting the ids. A receipt settled by two methods is reported as split, never divided by a guess. |
| Warehouses, suppliers, purchases, employees | —                                                                            | No endpoint for any of them appears in either source. Not implemented rather than invented.                                                                                                                                                                                               |

## Notes for whoever configures this

`BILLZ_BASE_URL` must be the **admin** host (`https://api-admin.billz.ai`), the
default. The legacy client also used a tenant host (`https://<company>.billz.io`)
where the same catalogue sits under `/api/v2/products`; this integration uses the
admin host's paths, so pointing it at a tenant host will 404.
