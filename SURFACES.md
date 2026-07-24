# SURFACES.md

A registry of every user-facing surface in the `sheetal_ui` app — one row per dashboard
**tab** (a 4-tab dashboard = 4 rows), plus reconciliation of routes ↔ files. Built by
sweeping `src/App.js`, all of `src/screens/**`, `src/pages/`, and the one routed dashboard
under `src/components/B2B/`.

The **Role** column is derived from the login `navigate()` map in
[SALogin.js](src/screens/SALogin.js#L66-L137) plus each dashboard's own on-mount self-guard.
Tab values are the `useTabParam` values verified against each screen's nav/sidebar source.

---

## Summary counts

- **43 `<Route>` elements** in [App.js](src/App.js): **4 public** + **38 protected**
  (`<PrivateRoute>`) + **1 catch-all**.
  - **41 render a component**; **2 are inline `<Navigate>` redirects** (`path="/"` and
    `path="*"`, both → `/login`).
  - **No route passes any props** — every protected route is a bare
    `<PrivateRoute><Component /></PrivateRoute>`. No `allowedRoles` / `role` / `channel` /
    `defaultTab` at the route level.
- **52 screen files**: 51 in `src/screens/` + 1 in `src/pages/` (`OrderDetailPage.jsx`).
  One additional routed dashboard, `ProductionManagerDashboard.jsx`, lives under
  `src/components/B2B/` (routed but outside `screens/`).
- **20 tabbed dashboards** (`useTabParam`); the rest are single-purpose forms/views.
- **List/table surfaces**: nearly every dashboard renders a **list** (`.map` over cards/rows);
  four render a true HTML `<table>` — `WalkInTab` (`.wi-table`), `AccountsDashboard`
  (`.acc-table`), and `CommsDashboard` / `CommsPRPerformance` (`.comms-table`). Registry rows
  that render data = **all tabbed-dashboard rows + the data-bearing non-tabbed screens**
  (forms and confirmation screens render "no").

---

## Public routes (no auth wrapper)

| Route | Role | File path | Tabs | List/Table | Data source | Channel-scoped? |
|-------|------|-----------|------|------------|-------------|-----------------|
| `/` | — (redirect → `/login`) | *(inline `<Navigate>`)* | — | no | — | — |
| `/login` | any (unauthenticated) | [SALogin.js](src/screens/SALogin.js) | — | no | `.from(profiles)` (login routing) | no |
| `/buyerVerification` | any | [OtpVerification.js](src/screens/OtpVerification.js) | — | no | — (OTP UI) | no |
| `/otp` | any | [OtpDialogBox.js](src/screens/OtpDialogBox.js) | — | no | — (OTP UI) | no |
| `*` | — (redirect → `/login`) | *(inline `<Navigate>`)* | — | no | — | — |

---

## Order-creation flow (protected; any authenticated user)

| Route | Role | File path | Tabs | List/Table | Data source | Channel-scoped? |
|-------|------|-----------|------|------------|-------------|-----------------|
| `/userinfo` | any auth | [CustomerDetailForm.js](src/screens/CustomerDetailForm.js) | — | no | `.from(profiles)` upsert | no |
| `/product` | any auth | [ProductForm.js](src/screens/ProductForm.js) | — | list (product grid) | `fetchAllRows(products)` | no |
| `/confirmDetail` | any auth | [OrderDetails.js](src/screens/OrderDetails.js) | — | list (items / split-payments) | `.from(profiles)`, `.from(discount)`; order from `location.state` | no |
| `/orderDetail` | any auth | [ReviewDetail.js](src/screens/ReviewDetail.js) | — | list (items) | `rpc(generate_order_no{p_store})`, `.from(orders/salesperson/customer_measurements/profiles/product_variants/draft_orders)` | **yes** — `p_store` scopes order-number to store/channel |
| `order-placed` ⚠ | any auth | [OrderPlaced.jsx](src/screens/OrderPlacedScreen/OrderPlaced.jsx) | — | no (confirmation) | — (`location.state`) | no |
| `/edit-order` | any auth | [EditOrder.jsx](src/screens/EditOrder/EditOrder.jsx) | — | list (items) | `.from(orders …)` edit flow | reads store/channel fields |
| `/order/:orderId` | any auth | [OrderDetailPage.jsx](src/pages/OrderDetailPage.jsx) | — | list (items/extras/alterations) | `.from(orders …)`, `rpc` (notifications) | reads `salesperson_store` (not a filtered list) |

⚠ `order-placed` is declared **without a leading slash** in `App.js` (relative path) — unlike
every other route.

---

## Role dashboards — Sales / Store / Warehouse / Scan

| Route | Role | File path | Tab | List/Table | Data source | Channel-scoped? |
|-------|------|-----------|-----|------------|-------------|-----------------|
| `/AssociateDashboard` | `salesperson` / `sa_services` | [AssociateDashboard.js](src/screens/AssociateDashboard.js) | dashboard* | list | `fetchAllRows(orders)` (scoped) | **yes** — `getChannelKeyForDesignation`, `salesperson_store`, `is_b2b` detection |
| `/AssociateDashboard` | ″ | ″ | profile | list | ″ | ″ |
| `/AssociateDashboard` | ″ | ″ | calendar | list | ″ | ″ |
| `/AssociateDashboard` | ″ | ″ | orders | list | ″ | ″ |
| `/AssociateDashboard` | ″ | ″ | clients | list | ″ | ″ |
| `/AssociateDashboard` | ″ | ″ | walkin | table (`.wi-table`, via `WalkInTab`) | `fetchAllRows(walkins)`, `fetchAllRows(orders)` | ″ |
| `/AssociateDashboard` | ″ | ″ | exhibitions | list | ″ | ″ |
| `/AssociateDashboard` | ″ | ″ | vendors | list | ″ | ″ |
| `/warehouseDashboard` | `warehouse` | [WarehouseDashboard.jsx](src/screens/WarehouseDashboard.jsx) | orders* | list | `fetchAllRows(orders)` | **yes (strongest)** — `scopeOrdersToDesignation(orders, designation)`, `getOrderChannelKey`, appends comms, offline-PH case |
| `/warehouseDashboard` | ″ | ″ | overview | list | ″ | ″ |
| `/warehouseDashboard` | ″ | ″ | calendar | list | ″ | ″ |
| `/warehouseDashboard` | ″ | ″ | scan | scan UI | ″ | ″ |
| `/warehouseDashboard` | ″ | ″ | vendors | list | ″ | ″ |
| `/warehouseDashboard` | ″ | ″ | qc_history | list | ″ | ″ |
| `/warehouseDashboard` | ″ | ″ | rejourneys | list | ″ | ″ |
| `/orderHistory` | (customer-facing) | [OrderHistory.jsx](src/screens/OrderHistory.jsx) | orders* | list | `.from(orders)` by `user_id`, `.from(profiles/customer_measurements)`, `rpc(get_production_head_email)` | customer-scoped by `user_id` |
| `/orderHistory` | ″ | ″ | profile | no | ″ | ″ |
| `/store-manager-dashboard` | `store_manager` | [StoreManagerDashboard.jsx](src/screens/StoreManagerDashboard/StoreManagerDashboard.jsx) | sales* | list | `fetchAllRows(orders)`, `fetchAllRows(products)`, `.from(salesperson/product_variants)` | store-scoped by `store_name`/designation |
| `/store-manager-dashboard` | ″ | ″ | sa_performance | list | ″ | ″ |
| `/store-manager-dashboard` | ″ | ″ | roster | list | ″ | ″ |
| `/store-manager-dashboard` | ″ | ″ | orders | list | ″ | ″ |
| `/store-manager-dashboard` | ″ | ″ | calendar | list (via `StoreCalendarTab`) | ″ | ″ |
| `/store-manager-dashboard` | ″ | ″ | returns | list | ″ | ″ |
| `/store-manager-dashboard` | ″ | ″ | inventory | list | ″ | ″ |
| `/store-manager-dashboard` | ″ | ″ | clients | list | ″ | ″ |
| `/store-manager-dashboard` | ″ | ″ | alterations | list | ″ | ″ |
| `/retail-manager-dashboard` | `retail_manager` | [RetailManagerDashboard.jsx](src/screens/RetailDashboard/RetailManagerDashboard.jsx) | store_analytics* | list | `fetchAllRows(orders)`, `fetchAllRows(products)`, `.from(vendors)` | retail/store-focused |
| `/retail-manager-dashboard` | ″ | ″ | daywise_sales | list | ″ | ″ |
| `/retail-manager-dashboard` | ″ | ″ | product_analytics | list | ″ | ″ |
| `/retail-manager-dashboard` | ″ | ″ | orders | list | ″ | ″ |
| `/walkin-dashboard` | `walkin_viewer` | [WalkInDashboard.jsx](src/screens/WalkInDashboard/WalkInDashboard.jsx) | — | list (walk-ins) | `fetchAllRows(orders)`, `.from(salesperson)` | store-aware via `store_name` (light) |
| `/scan-station` | `scan_station` | [ScanStationPage.jsx](src/screens/ScanStationPage/ScanStationPage.jsx) | scan* | scan UI | barcode RPCs via `barcodeService` | per-station scan flow |
| `/scan-station` | ″ | ″ | qc_history | list | `fetchQcRecords` | ″ |

---

## Role dashboards — Executive / Leadership (company-wide)

| Route | Role | File path | Tab | List/Table | Data source | Channel-scoped? |
|-------|------|-----------|-----|------------|-------------|-----------------|
| `/admin` | `admin` | [AdminDashboard.jsx](src/screens/AdminDashboard/AdminDashboard.jsx) | brand_performance* | list | `fetchAllRows(orders)`, `fetchAllRows(products)`, `.from(salesperson/vendors/product_variants)`, `fetchAllRows(profiles)` | no — company-wide (breaks down by channel) |
| `/admin` | ″ | ″ | revenue | list | ″ | ″ |
| `/admin` | ″ | ″ | products_style | list | ″ | ″ |
| `/admin` | ″ | ″ | client_insights | list | ″ | ″ |
| `/admin` | ″ | ″ | inventory | list | ″ | ″ |
| `/admin` | ″ | ″ | cost_expenditure | list | ″ | ″ |
| `/admin` | ″ | ″ | b2b_vendor | list | ″ | ″ |
| `/admin` | ″ | ″ | targets_growth | list | ″ | ″ |
| `/admin` | ″ | ″ | orders | list | ″ | ″ |
| `/admin` | ″ | ″ | accounts | list | ″ | ″ |
| `/admin` | ″ | ″ | client_book | list | ″ | ″ |
| `/admin` | ″ | ″ | walkins | list | ″ | ″ |
| `/admin` | ″ | ″ | sales_team | list | ″ | ″ |
| `/admin` | ″ | ″ | sa_targets | list | ″ | ″ |
| `/admin` | ″ | ″ | comms_approvals | list | ″ | ″ |
| `/ceo-dashboard` | `ceo` | [CeoDashboard.jsx](src/screens/CeoDashboard/CeoDashboard.jsx) | brand_performance* | list | `fetchAllRows(orders/products)`, `.from(salesperson/vendors/consignment_inventory/product_variants)` | no — company-wide |
| `/ceo-dashboard` | ″ | ″ | store_performance | list | ″ | ″ |
| `/ceo-dashboard` | ″ | ″ | revenue | list | ″ | ″ |
| `/ceo-dashboard` | ″ | ″ | products_style | list | ″ | ″ |
| `/ceo-dashboard` | ″ | ″ | client_insights | list | ″ | ″ |
| `/ceo-dashboard` | ″ | ″ | b2b_vendor | list | ″ | ″ |
| `/ceo-dashboard` | ″ | ″ | inventory | list | ″ | ″ |
| `/ceo-dashboard` | ″ | ″ | cost_expenditure | list | ″ | ″ |
| `/ceo-dashboard` | ″ | ″ | targets_growth | list | ″ | ″ |
| `/ceo-dashboard` | ″ | ″ | ops_flags | list | ″ | ″ |
| `/ceo-dashboard` | ″ | ″ | orders | list | ″ | ″ |
| `/ceo-dashboard` | ″ | ″ | accounts | list | ″ | ″ |
| `/ceo-dashboard` | ″ | ″ | exhibition_approvals | list | ″ | ″ |
| `/coo-dashboard` | `coo` | [COODashboard.jsx](src/screens/COODashboard/COODashboard.jsx) | operations* | list | `fetchAllRows(orders/products)`, `.from(salesperson/vendors/consignment_inventory)` | no — company-wide |
| `/coo-dashboard` | ″ | ″ | brand | list | ″ | ″ |
| `/coo-dashboard` | ″ | ″ | qc_issues | list | ″ | ″ |
| `/coo-dashboard` | ″ | ″ | consignment | list | ″ | ″ |
| `/coo-dashboard` | ″ | ″ | inventory | list | ″ | ″ |
| `/coo-dashboard` | ″ | ″ | financial | list | ″ | ″ |
| `/coo-dashboard` | ″ | ″ | orders | list | ″ | ″ |
| `/coo-dashboard` | ″ | ″ | vendor_approvals | list | ″ | ″ |
| `/coo-dashboard` | ″ | ″ | factory_pause | control | ″ | ″ |
| `/gm-dashboard` | `gm` | [GMDashboard.jsx](src/screens/GMDashboard/GMDashboard.jsx) | store_performance* | list | `fetchAllRows(orders/products)`, `.from(salesperson/vendors/consignment_inventory)` | no — company-wide |
| `/gm-dashboard` | ″ | ″ | day_sales | list | ″ | ″ |
| `/gm-dashboard` | ″ | ″ | b2b_overview | list | ″ | ″ |
| `/gm-dashboard` | ″ | ″ | inventory | list | ″ | ″ |
| `/gm-dashboard` | ″ | ″ | returns | list | ″ | ″ |
| `/gm-dashboard` | ″ | ″ | orders | list | ″ | ″ |
| `/gm-dashboard` | ″ | ″ | accounts | list | ″ | ″ |
| `/gm-dashboard` | ″ | ″ | exhibition_approvals | list | ″ | ″ |
| `/ceo-assistant-dashboard` | `ceo_assistant` | [CeoAssistantDashboard.jsx](src/screens/CeoAssistantDashboard/CeoAssistantDashboard.jsx) | store_performance* | list | `fetchAllRows(orders/products)` | no — company-wide |
| `/ceo-assistant-dashboard` | ″ | ″ | product_style | list | ″ | ″ |
| `/ceo-assistant-dashboard` | ″ | ″ | ops_flags | list | ″ | ″ |
| `/ceo-assistant-dashboard` | ″ | ″ | monthly_five | list | ″ | ″ |
| `/ceo-assistant-dashboard` | ″ | ″ | attendance | list | ″ | ″ |
| `/assistant-cmo-dashboard` | `assistant_cmo` | [AssistantCmoDashboard.jsx](src/screens/AssistantCmoDashboard/AssistantCmoDashboard.jsx) | overview* | list | `fetchAllRows(orders)`, `fetchAllRows(products)`, `fetchAllRows(profiles)`, `.from(consignment_inventory)` | no — company-wide |
| `/assistant-cmo-dashboard` | ″ | ″ | brand | list | ″ | ″ |
| `/assistant-cmo-dashboard` | ″ | ″ | revenue | list | ″ | ″ |
| `/assistant-cmo-dashboard` | ″ | ″ | product | list | ″ | ″ |
| `/assistant-cmo-dashboard` | ″ | ″ | clients | list | ″ | ″ |
| `/assistant-cmo-dashboard` | ″ | ″ | orders | list | ″ | ″ |
| `/assistant-cmo-dashboard` | ″ | ″ | client_book | list | ″ | ″ |
| `/assistant-cmo-dashboard` | ″ | ″ | walkins | list | ″ | ″ |
| `/assistant-cmo-dashboard` | ″ | ″ | inventory | list | ″ | ″ |
| `/head-of-design-dashboard` | `head_of_design` | [HeadOfDesignDashboard.jsx](src/screens/HeadOfDesignDashboard/HeadOfDesignDashboard.jsx) | status* | list | `fetchAllRows(orders)`, `.from(vendors)` | no — company-wide (breaks down by channel) |
| `/head-of-design-dashboard` | ″ | ″ | overview | list | ″ | ″ |
| `/head-of-design-dashboard` | ″ | ″ | channels | list | ″ | ″ |
| `/head-of-design-dashboard` | ″ | ″ | returns | list | ″ | ″ |

---

## Role dashboards — Accounts / Inventory

| Route | Role | File path | Tab | List/Table | Data source | Channel-scoped? |
|-------|------|-----------|-----|------------|-------------|-----------------|
| `/accounts` | `accounts` | [AccountsDashboard.jsx](src/screens/AccountsDashboard/AccountsDashboard.jsx) | — | table (`.acc-table`) | `.from(salesperson)`, `fetchAllRows(orders, select *)` | no — all channels |
| `/accountant-dashboard` | `accountant` | [AccountantDashboard.jsx](src/screens/AccountantDashboard/AccountantDashboard.jsx) | overview* | list | `fetchAllRows(orders)` | no — sliced by channel in `channels` tab |
| `/accountant-dashboard` | ″ | ″ | channels | list | ″ | ″ |
| `/accountant-dashboard` | ″ | ″ | status | list | ″ | ″ |
| `/accountant-dashboard` | ″ | ″ | returns | list | ″ | ″ |
| `/inventoryDashboard` | `inventory` | [InventoryDashboard.jsx](src/screens/InventoryDashboard/InventoryDashboard.jsx) | inventory* | list | `fetchAllRows(products)` | no |
| `/inventoryDashboard` | ″ | ″ | stockOrders | list (via `StockOrdersTab`) | `fetchAllRows(orders)` | stock-oriented |
| `/inventoryDashboard` | ″ | ″ | calendar | list (via `StockCalendarTab`) | `fetchAllRows(orders)` | stock |
| `/inventoryDashboard` | ″ | ″ | warehouses | list (via `WarehouseTab`) | `.from(warehouses/warehouse_stock)`, `fetchAllRows(products)` | no |
| `/inventoryDashboard` | ″ | ″ | exchanges | list (via `StockExchangeTab`) | `fetchAllRows(stock_exchanges/products)`, `.from(warehouses)` | no |
| `/inventoryDashboard` | ″ | ″ | addProduct | form | product insert | no |

---

## Comms channel

| Route | Role | File path | Tab | List/Table | Data source | Channel-scoped? |
|-------|------|-----------|-----|------------|-------------|-----------------|
| `/comms-dashboard` | `comms` | [CommsDashboard.jsx](src/screens/CommsDashboard/CommsDashboard.jsx) | overview* | list | `fetchAllRows(orders, is_comms=true)`, `.from(order_components)` | **yes** — hard `is_comms=true` |
| `/comms-dashboard` | ″ | ″ | orders | table (`.comms-table`) + cards | ″ | ″ |
| `/comms-dashboard` | ″ | ″ | sourcing_returns | list (via `CommsSourcingReturns`) | ″ | ″ |
| `/comms-dashboard` | ″ | ″ | inventory | list (via `CommsInventory`) | `fetchAllRows(products/product_variants)`, `.from(comms_inventory_blocks)` | ″ |
| `/comms-dashboard` | ″ | ″ | reports | list (via `CommsReports`) | `.from(comms_pr_performance)` | ″ |
| `/comms-dashboard` | ″ | ″ | pr_performance | table (`.comms-table`, via `CommsPRPerformance`) | `.from(comms_pr_performance)` | ″ |
| `/comms-dashboard` | ″ | ″ | order_calendar | list (via `CommsOrderCalendar`) | passed-in comms orders | ″ |
| `/comms-dashboard` | ″ | ″ | my_calendar | list (via `CommsCalendar`) | `.from(comms_calendar_events)` | ″ |
| `/comms-dashboard` | ″ | ″ | vendors | list | ″ | ″ |
| `/comms-order-form` | `comms` | [CommsOrderForm.jsx](src/screens/CommsDashboard/CommsOrderForm.jsx) | — | list (option/item) | `.from(salesperson)` | comms |
| `/comms-review-order` | `comms` | [CommsReviewOrder.jsx](src/screens/CommsDashboard/CommsReviewOrder.jsx) | — | list (items) | `rpc(generate_order_no{p_store:"COMMS"})`, `.from(draft_orders)` | **yes** — hardcoded `p_store:"COMMS"` |

---

## B2B channel

| Route | Role | File path | Tab | List/Table | Data source | Channel-scoped? |
|-------|------|-----------|-----|------------|-------------|-----------------|
| `/b2b-executive-dashboard` | `executive` | [B2bexecutivedashboard.jsx](src/screens/B2bExecutiveDashboard/B2bexecutivedashboard.jsx) | dashboard* | list | `.from(salesperson/vendors)`, `fetchAllRows(orders, is_b2b=true & salesperson_email=self)` | **yes** — `is_b2b` **+ own `salesperson_email`** (tightest) |
| `/b2b-executive-dashboard` | ″ | ″ | profile | list | ″ | ″ |
| `/b2b-executive-dashboard` | ″ | ″ | calendar | list | ″ | ″ |
| `/b2b-executive-dashboard` | ″ | ″ | orders | list | ″ | ″ |
| `/b2b-merchandiser-dashboard` | `merchandiser` | [B2bMerchandiserDashboard.jsx](src/screens/B2bMerchandiserDashboard/B2bMerchandiserDashboard.jsx) | dashboard* | list | `fetchAllRows(orders, is_b2b=true)`, `.from(salesperson/vendors/size_charts/order_components/b2b_approvals/vendor_contacts)`, `rpc(get_production_head_email)`, `rpc(manual_complete_order)` | **yes** — `is_b2b=true`; `getOrderChannelKey` in Cancel tool |
| `/b2b-merchandiser-dashboard` | ″ | ″ | profile | list | ″ | ″ |
| `/b2b-merchandiser-dashboard` | ″ | ″ | approvals | list | ″ | ″ |
| `/b2b-merchandiser-dashboard` | ″ | ″ | orders | list | ″ | ″ |
| `/b2b-merchandiser-dashboard` | ″ | ″ | vendors | list | ″ | ″ |
| `/b2b-merchandiser-dashboard` | ″ | ″ | cancel_order | list | ″ | ″ |
| `/b2b-merchandiser-dashboard` | ″ | ″ | calendar | list | ″ | ″ |
| `/b2b-merchandiser-dashboard` | ″ | ″ | consignment | list | ″ | ″ |
| `/b2b-merchandiser-dashboard` | ″ | ″ | analytics | list | ″ | ″ |
| `/b2b-production-dashboard` | `production` | [B2bProductionDashboard.jsx](src/screens/B2bProductionDashboard/B2bProductionDashboard.jsx) | dashboard* | list | `.from(salesperson/vendors/order_components)`, `fetchAllRows(orders, is_b2b=true)` then approved-only, `rpc(manual_complete_order)` | **yes** — `is_b2b=true` + approved-only |
| `/b2b-production-dashboard` | ″ | ″ | orders | list | ″ | ″ |
| `/b2b-production-dashboard` | ″ | ″ | calendar | list | ″ | ″ |
| `/b2b-production-dashboard` | ″ | ″ | vendors | list (`ProductionHeadVendors channel="b2b"`) | ″ | ″ |
| `/b2b-production-dashboard` | ″ | ″ | qc_history | list | `fetchQcRecords` | ″ |
| `/b2b-production-dashboard` | ″ | ″ | rejourneys | list | `fetchReJourneys` | ″ |
| `/production-manager-dashboard` | `production_manager` | [ProductionManagerDashboard.jsx](src/components/B2B/ProductionManagerDashboard/ProductionManagerDashboard.jsx) | overview* | list | `.from(orders)` (ALL channels, paged), `.from(salesperson/vendors/colors/order_components)`, `fetchQcRecords/fetchReJourneys/fetchExternalMovements/fetchScanReport`, `rpc(manual_complete_order)` | **no** — multi-channel (`getOrderChannelKey`); "B2B" only by folder + role |
| `/production-manager-dashboard` | ″ | ″ | orders | list | ″ | ″ |
| `/production-manager-dashboard` | ″ | ″ | production | list | ″ | ″ |
| `/production-manager-dashboard` | ″ | ″ | qc_history | list | ″ | ″ |
| `/production-manager-dashboard` | ″ | ″ | rejourneys | list | ″ | ″ |
| `/production-manager-dashboard` | ″ | ″ | delivery_report | list | ″ | ″ |
| `/production-manager-dashboard` | ″ | ″ | overrides | list | ″ | ″ |
| `/production-manager-dashboard` | ″ | ″ | vendors | list | ″ | ″ |
| `/production-manager-dashboard` | ″ | ″ | replacements | list | ″ | ″ |
| `/production-manager-dashboard` | ″ | ″ | calendar | list | ″ | ″ |
| `/production-manager-dashboard` | ″ | ″ | staff | list | ″ | ″ |
| `/production-manager-dashboard` | ″ | ″ | profile | list | ″ | ″ |
| `/b2b-vendor-selection` | executive/merchandiser/production | [B2bvendorselection.jsx](src/screens/B2bvendorSelection/B2bvendorselection.jsx) | — | list (vendor select) | `.from(salesperson/vendors/discount)` | B2B (role-gated) |
| `/b2b-product-form` | ″ | [B2bproductform.jsx](src/screens/B2bproductform/B2bproductform.jsx) | — | list (product grid) | `.from(salesperson/colors/dupatta_colors/extras)`, `fetchAllRows(products)` | B2B (role-gated) |
| `/b2b-order-details` | ″ | [B2bOrderDetails.jsx](src/screens/B2borderdetails/B2bOrderDetails.jsx) | — | list (summary) | `.from(salesperson)`; rest from `sessionStorage` | B2B (role-gated) |
| `/b2b-review-order` | ″ | [B2bReviewOrder.jsx](src/screens/B2bRevieworder/B2bReviewOrder.jsx) | — | list (items) | `rpc(generate_order_no{p_store})`, `.from(orders/salesperson/b2b_approvals)` | **yes (write)** — stamps `is_b2b=true`, order_no `DLC`→`B2B` |
| `/b2b-order-view/:id` | ″ | [B2bOrderView.jsx](src/screens/B2bOrderView/B2bOrderView.jsx) | — | list (order detail) | `.from(salesperson/orders/vendors/vendor_contacts)` by `id` | fetch by `id` (role-gated) |
| `/b2b-order-history` | ″ | [B2bOrderHistory.jsx](src/screens/B2bOrderHistory/B2bOrderHistory.jsx) | — | list (orders) | `fetchAllRows(orders, is_b2b=true)`, `.from(salesperson/vendors)` | **yes** — `is_b2b=true` |
| `/b2b-vendor-orders/:vendorId` | ″ | [B2bVendorOrders.jsx](src/screens/B2bVendorOrders/B2bVendorOrders.jsx) | — | list (orders) | `fetchAllRows(orders, vendor_id & is_b2b=true)`, `.from(salesperson/vendors)` | **yes** — `is_b2b=true` **+ `vendor_id`** |

---

## Reconciliation

### Routes with no file mapping
**None.** All 41 component-rendering routes resolve to an import path in `App.js`; the 2
non-component routes are inline `<Navigate>` redirects.

### Screen files NOT reachable from `App.js` (sub-components rendered inside a dashboard tab)
These render inside a parent dashboard's tab and have **no route of their own** — they are not
independent surfaces:

- [WalkInTab.jsx](src/screens/WalkInTab.jsx) — inside AssociateDashboard `walkin` tab
- CommsDashboard tabs: [CommsSourcingReturns.jsx](src/screens/CommsDashboard/CommsSourcingReturns.jsx),
  [CommsInventory.jsx](src/screens/CommsDashboard/CommsInventory.jsx),
  [CommsReports.jsx](src/screens/CommsDashboard/CommsReports.jsx),
  [CommsPRPerformance.jsx](src/screens/CommsDashboard/CommsPRPerformance.jsx),
  [CommsCalendar.jsx](src/screens/CommsDashboard/CommsCalendar.jsx),
  [CommsOrderCalendar.jsx](src/screens/CommsDashboard/CommsOrderCalendar.jsx)
  *(note: `CommsOrderForm.jsx` and `CommsReviewOrder.jsx` in the same folder **are** routed —
  `/comms-order-form`, `/comms-review-order`)*
- InventoryDashboard tabs: [StockOrdersTab.jsx](src/screens/InventoryDashboard/StockOrdersTab.jsx),
  [StockCalendarTab.jsx](src/screens/InventoryDashboard/StockCalendarTab.jsx),
  [StockExchangeTab.jsx](src/screens/InventoryDashboard/StockExchangeTab.jsx),
  [WarehouseTab.jsx](src/screens/InventoryDashboard/WarehouseTab.jsx)
- StoreManagerDashboard: [StoreCalendarTab.jsx](src/screens/StoreManagerDashboard/StoreCalendarTab.jsx)

### Route-string anomalies
- `order-placed` — declared **without a leading slash** (relative), unlike every other route.
- Param routes: `/order/:orderId`, `/b2b-order-view/:id`, `/b2b-vendor-orders/:vendorId`.
- Import-path casing quirks (matter on case-sensitive filesystems): folder `B2bvendorSelection/B2bvendorselection`,
  `B2bExecutiveDashboard/B2bexecutivedashboard`, `CeoDashboard/CeoDashboard` (imported as `CEODashboard`),
  `RetailDashboard/RetailManagerDashboard`.

### Footnote — unlinked tab blocks
[B2bProductionDashboard.jsx](src/screens/B2bProductionDashboard/B2bProductionDashboard.jsx)
contains additional tab blocks in code — `queue`, `inprod`, `dispatch`, `profile` — that are
**not linked in the sidebar** (intentionally hidden; the code comment says everything they
showed now lives in Order History). No rows are emitted for them above.
