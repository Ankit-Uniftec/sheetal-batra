# Performance Audit — Sheetal Batra app (`sheetal_ui`)

*Read-only audit, 24 Sep 2026, branch `development` (HEAD `fd2fadb`). No source files were changed.*
*File references are `path:line`, relative to the repo root unless they start with a folder inside `src/`.*

---

## 0. The short version (read this if nothing else)

**Why the app feels slow:** almost every management dashboard, when it opens, downloads **the entire orders table — every order ever placed, with every column** — into the browser, and then does all the counting, filtering and adding-up in the browser. At ~10,000 orders that is several megabytes and ~10 back-to-back trips to the database *per dashboard*, before anything shows. Some dashboards also download the **entire garment-piece table** (`order_components`, roughly 3–5 rows per order, so an estimated 30,000–50,000 rows) the same way, which is 30–50 more back-to-back trips.

Four things make it worse:

1. **Downloads happen one page at a time, in a queue.** Supabase hands out at most 1,000 rows per request. The app's helper (`src/utils/fetchAllRows.js:23-39`) asks for page 1, *waits*, asks for page 2, *waits*… It never asks for several pages at once. So load time grows in a straight line with the number of orders — every 1,000 new orders adds another round trip to every big dashboard.
2. **The heavy `items` column comes along for the ride.** Most dashboards use `select("*")` ("give me every column"), which includes `items` (the full product detail of each order as JSON) even when the screen only needs totals and dates.
3. **Nothing is remembered between screens.** There is no caching library. Going CEO → COO → GM downloads the same 10,000 orders three times.
4. **The database has no index on the columns the app sorts and filters by** (at least, none in the SQL files in this repo — the live database may differ; see §4). Every "newest first" sort re-sorts the whole table, once per page.

**What would help most, in order of bang-for-buck vs. risk** (full detail in §6):

| # | Fix | Speed gain | Risk |
|---|---|---|---|
| 1 | Make `fetchAllRows` fetch pages in parallel (and add a stable tie-break sort) | Big — 10 queued trips become ~1–2 | Low (one file) |
| 2 | Add a handful of database indexes (after checking what live already has) | Medium–big | Low |
| 3 | Move "throw-away" filters into the query (e.g. excluding Comms orders, one store only, B2B-only pieces, dispatch-only statuses) | Big on the affected screens | Low–medium |
| 4 | Stop downloading the whole `order_components` table on 6 screens | Very big on those screens | Medium |
| 5 | Stop pulling every column (`*`) of orders on list screens | Big (payload shrinks several-fold) | Medium |
| 6 | Move dashboard numbers (revenue, counts, KPIs) into database functions | Largest long-term | Higher (big change) |

---

## 1. Architecture map

### 1.1 Folders

| Folder | What lives there |
|---|---|
| `src/screens/` | The pages. ~35 role dashboards plus the order-taking flow. Newer ones are subfolders (`AdminDashboard/`, `CeoDashboard/`…), older ones are single files at the root (`AssociateDashboard.js`, `OrderHistory.jsx`, `WarehouseDashboard.jsx`, `ProductForm.js`, `ReviewDetail.js`). |
| `src/components/` | Shared building blocks: the scan station, notification bell, stock panel, QC/re-journey panels, pop-ups, paginator, period filter. `components/B2B/ProductionManagerDashboard/` is actually a full dashboard. |
| `src/utils/` | The de-facto "service layer": functions that talk to Supabase (`barcodeService.js`, `qcHistory.js`, `reJourneys.js`, `notificationService.js`, `fetchAllRows.js` …) plus pure helpers. |
| `src/hooks/` | Small reusable behaviours (barcode scanner input, URL-based tabs, SKU scan). |
| `src/lib/supabaseClient.js` | Creates the one database connection. |
| `src/context/AuthContext.js` | Remembers who is logged in (only that — not their role). |
| `src/pdf/` | Invoice and warehouse work-order PDF layouts. |
| `db/` | Hand-written SQL (migrations, database functions). **Not a complete picture of the database** — the core tables were created in the Supabase dashboard. |
| `supabase/functions/` | Server-side "edge functions" (scheduled notifications, Shopify sync, WhatsApp, daily scan report). |

### 1.2 How the app connects to the database

- **One client**, created once at `src/lib/supabaseClient.js:8` with the URL/key from `src/config/config.js`. Every file imports that same `supabase` object directly. That part is fine.
- **No caching / state library.** `package.json` has no React Query, SWR, Redux, Zustand, etc. Each screen keeps its own copy of data in local React state and throws it away when you navigate off. There is no shared cache anywhere in `src/utils/` either.
- **AuthContext** (`src/context/AuthContext.js`) stores only `user` and `loading`. Because the role isn't stored there, **every dashboard re-asks the database "what's my role?" on open** (≈45 separate call sites query `salesperson` by email), and many then download the whole `salesperson` table a second time.
- **Code splitting is already good.** Every route is lazy-loaded (`src/App.js:9-52`), and the heavy PDF libraries only load when a PDF is generated (`src/utils/pdfLazy.js`). So *initial JavaScript download is not the problem* — data fetching is. (Minor: `pdf-lib` and `@pdf-lib/fontkit` are installed but unused; `src/pdf/pdfHelpers.js`, `pdfTheme.js`, `pdf/index.js` are dead files.)

### 1.3 Screens and the tables they read

Row counts assume ~10k orders; `order_components` is an *estimate* of 30–50k (3–5 pieces per order) — it was not measured.

| Screen (file) | Tables read on open (FULL = whole table downloaded) |
|---|---|
| **ProductionManagerDashboard** (`src/components/B2B/ProductionManagerDashboard/ProductionManagerDashboard.jsx`) | salesperson ×2, **orders FULL `*`**, vendors, **order_components FULL**, **external_movements FULL**, qc_records (dispose subset; FULL on QC tab), colors |
| **COODashboard** (`src/screens/COODashboard/COODashboard.jsx`) | salesperson ×2, **orders FULL `*`**, **products_live FULL**, vendors, consignment_inventory, **qc_records FULL**, **order_components FULL** |
| **PackagingDashboard** (`src/screens/PackagingDashboard/PackagingDashboard.jsx`) | salesperson, **orders FULL (with items)**, **order_components FULL**, **shipments FULL** |
| **AdminDashboard** (`src/screens/AdminDashboard/AdminDashboard.jsx`) | salesperson ×2, **orders FULL `*`**, **products_live FULL**, vendors, **profiles FULL (all customers)**; LXRTS tab: one Shopify call per product |
| **CeoDashboard** | salesperson ×2, **orders FULL `*`**, **products_live FULL**, vendors, consignment_inventory, **qc_records FULL** |
| **GMDashboard** | salesperson ×2, **orders FULL `*`**, **products_live FULL**, vendors, consignment_inventory |
| **StoreManagerDashboard** | salesperson ×2, **orders FULL `*` (all stores — keeps only its own)**, **products_live FULL** |
| **RetailManagerDashboard** | salesperson, **orders FULL `*`**, vendors; Production tab: **order_components FULL** |
| **AssistantCmoDashboard** | salesperson, **orders FULL (23 cols incl. items)**, **products_live FULL (used for 2 counts)**, **profiles FULL**, consignment_inventory |
| **CeoAssistant / HeadOfDesign / Accountant / Accounts dashboards** | salesperson, **orders FULL `*`** (+ small tables) |
| **WarehouseDashboard** (`src/screens/WarehouseDashboard.jsx`) | salesperson, **orders FULL (with items + attachments)**; Production-Head Overview tab: all of the channel's order_components in 25–50 queued batches; QC / Re-journey tabs: same pattern |
| **B2bMerchandiserDashboard** | salesperson ×2, orders (B2B only, `*`), vendors ×2, size_charts, **order_components FULL (every channel, not just B2B)** |
| **B2bProductionDashboard** | salesperson ×2, orders (B2B + assigned, `*`), vendors, **order_components FULL** (filtered to B2B afterwards) |
| **ShopifyOrdersDashboard** | salesperson, orders (Shopify only, incl. items), order_components in queued 100-order batches |
| **CommsDashboard** | salesperson, orders (Comms only, `*`), order_components in queued batches; Inventory tab: **products_live FULL + product_variants FULL** |
| **StockRoom** (`src/screens/StockRoom/`) | whole catalogue, **full stock movement log `*`** (re-read after every action), 90 days of orders with items, all stock orders; Shopify re-check every ~5 min |
| **InventoryDashboard** | products_live FULL `*`, product_variants FULL, product_channel_stock FULL; Stock Orders + Calendar tabs each fetch all stock orders `*` separately |
| **ScanStationPage** | salesperson; "All Orders" tab: **orders FULL (no items)**; QC tab: the inspector's whole QC history |
| **AssociateDashboard** (salesperson) | own orders only — **except the `sa_services` role, which downloads ALL orders** (7 queued steps on open) |
| **WalkInDashboard / WalkInTab** | **all orders** (just to collect phone numbers), all walk-ins, then **one database write per walk-in** |
| **OrderHistory, OrderDetailPage, ReviewDetail, ProductForm, B2B order-entry screens** | Mostly single-order/single-customer reads (fine). ProductForm and B2bproductform download the full catalogue with prices. |
| **Every dashboard** (via `DashboardHeader` → `NotificationBell`) | 2 small notification queries + a live subscription |

### 1.4 Edge functions and who calls them

| Function | What it does | Called by |
|---|---|---|
| `notification-scheduler` | Daily delivery/birthday/delay alerts (~18 order queries by `delivery_date`) | pg_cron only (schedule not in repo) |
| `shopify-order-sync` | Imports Shopify orders; many maintenance modes | pg_cron hourly/5-min; `ShopifyOrdersDashboard.jsx:630` (Sync now), `:1147` |
| `shopify-inventory` (**not in repo**) | Reads/updates live Shopify stock | **One call per LXRTS product** when inventory tabs open on Admin, CEO, COO, GM, StoreManager, Inventory; StockRoom every ~5 min; order placement per item |
| `spur-whatsapp` | Sends WhatsApp messages | `src/utils/whatsappService.js:26`, `CommsReviewOrder.jsx:399`, `scan-report-daily` |
| `scan-report-daily` | Builds daily scan XLSX | pg_cron `30 0 * * *` (`db/barcode_system/v2/38_scan_report_cron.sql:42`) |
| send-otp / verify-otp / auto-signin | Phone OTP login | `OtpVerification.js`, `OtpDialogBox.js`, `OrderHistory.jsx:1141` |
| `shopify-orders-test` | Throwaway probe | nobody |

---

## 2. Supabase queries — the patterns that matter

There are ~490 `.from()` / `.rpc()` / edge-function call sites. The **complete per-file tables** (every call, with file:line, columns, filters, paging, full-table flag, on-load flag) are in the Appendices at the end of this file. This section summarises what those tables show.

### 2.1 Queries that loop with `.range()` to download ALL rows

`fetchAllRows` (`src/utils/fetchAllRows.js:23-39`) has **77 callers**. How it behaves:

- Pages of 1,000, **strictly one after another** (line 31 `await`s inside the loop). 10k orders = 10 queued round trips; 50k components = 50.
- It adds **no sort order of its own**. About 20 callers pass no `.order()` at all, and the rest sort only by `created_at` (not unique). Paging without a stable, unique order can **skip or duplicate rows** at page boundaries — a data-accuracy problem as well as a speed one.
- It stops when a page has fewer than 1,000 rows (line 35). If the project's row cap were ever set below 1,000, it would silently return only the first page.

Of the 77 callers: **29 download `orders`**; **18 of those use `select("*")`**; **16 have no filter at all** (the whole table); **only one** (`src/screens/StockRoom/stockRoomData.js:111`) limits by date.

Hand-written copies of the same loop (also one page at a time):
`ProductionManagerDashboard.jsx:440-456` (orders) and `:487-506` (components), `B2bMerchandiserDashboard.jsx:200-213`, `B2bProductionDashboard.jsx:247-259`, `src/utils/qcHistory.js:69-83`, `src/utils/reJourneys.js:58-70` (no sort order), `src/utils/scanReport.js:37-50`. The first four also build the list with `all = [...all, ...page]`, which copies the whole array every page.

**Whole-table downloads of growable tables (by table):**

| Table | Downloaded in full by |
|---|---|
| `orders` (no filter) | Admin `:377`, CEO `:329`, COO `:160`, GM `:270`, StoreManager `:202`, RetailManager `:216`, CeoAssistant `:91`, HeadOfDesign `:133`, Accountant `:143`, Accounts `:36`, AssistantCmo `:188`, Warehouse `:339`, Packaging `:107`, ScanStationOrders `:118`, WalkInDashboard `:66`, WalkInTab `:73`, ProductionManager `:442`, Associate `:456` (sa_services role only) |
| `order_components` (no filter) | COO `:173`, Packaging `:109`, RetailManager `:234` (tab), ProductionManager `:490`, B2bMerchandiser `:204`, B2bProduction `:250` |
| `qc_records` | CEO `:341` and COO `:172` (via `qcHistory.js:73`), ProductionManager `:553` |
| `external_movements` | `barcodeService.js:1609` (`fetchAllMovements`) — ProductionManager on open, ProductionHeadVendors history |
| `stage_overrides` | `barcodeService.js:1730` via `OverrideHistory.jsx:48` |
| `stock_room_movement` (`*`, append-only) | `stockRoomData.js:142`, re-read after every stock action |
| `profiles` (all customers) | Admin `:386`, AssistantCmo `:194` |
| `products_live` (catalogue) | ~18 callers (Admin, CEO, COO, GM, StoreManager, AssistantCmo, ProductForm, B2bproductform, Inventory, StockRoom, CommsInventory, WarehouseTab, StockExchangeTab, AddProduct…) |
| `product_variants` | `CommsInventory.jsx:87`, `InventoryDashboard.jsx:238`, StockRoom |
| `walkins` | `WalkInsView.jsx:63` |

### 2.2 `select('*')` on the orders table

List/dashboard screens that pull every column of every order (including `items` JSON):
`AdminDashboard.jsx:377`, `CeoDashboard.jsx:329`, `COODashboard.jsx:160`, `GMDashboard.jsx:270`, `StoreManagerDashboard.jsx:202`, `RetailManagerDashboard.jsx:216`, `CeoAssistantDashboard.jsx:91`, `HeadOfDesignDashboard.jsx:133`, `AccountantDashboard.jsx:143`, `AccountsDashboard.jsx:36`, `ProductionManagerDashboard.jsx:443`, `B2bMerchandiserDashboard.jsx:173`, `B2bProductionDashboard.jsx:183`, `B2bexecutivedashboard.jsx:79`, `B2bOrderHistory.jsx:83`, `B2bVendorOrders.jsx:76`, `CommsDashboard.jsx:125`, `StockOrdersTab.jsx:108`, `StockCalendarTab.jsx:44`.

Screens that list columns explicitly but **still include `items`**: Warehouse `:339` (also attachments), Packaging `:107`, AssistantCmo `:188`, Associate `:456`, ShopifyOrders `:148`, StockRoom `:98/:111`.

A comment in the code itself (`AssistantCmoDashboard.jsx:172-175`) records that `select("*")` on orders cost "~1.6 MB and 40s+" — at a *smaller* order count than today.

Single-order `*` reads (e.g. `pdfUtils.js:86`, `OrderDetailPage.jsx:166`) are fine.

### 2.3 Work done in the browser that the database could do

- **Excluding Comms orders after downloading them.** `.filter(o => !o.is_comms)` runs right after the download at CEO `:343`, COO `:175`, GM `:279`, StoreManager `:209`, Retail `:219`, AssistantCmo `:197`, CeoAssistant `:94`, HeadOfDesign `:136`, Accountant `:146`. One `.eq("is_comms", false)` in the query would do it.
- **StoreManager downloads every store's orders and keeps its own** (`StoreManagerDashboard.jsx:202` → filter at `:273-279`).
- **ProductionManager** downloads all orders then drops unapproved B2B (`:461`); downloads all components then keeps only visible orders' (`:510-511`).
- **B2bProduction** downloads every channel's components, keeps B2B (`:268-269`). **B2bMerchandiser** downloads every channel's components and **doesn't filter at all** (`:204`) — ~90% dead weight.
- **Packaging** downloads all orders, keeps completed/dispatched/delivered (`:189-192`).
- **Warehouse / ScanStationOrders** do the private/B2B filter, status tabs, search, date, sort and tab counts all in the browser (`WarehouseDashboard.jsx:350-358`, `:632-812`; `ScanStationOrders.jsx:130-235`).
- **All KPI/revenue numbers** on the exec dashboards (dashboardStats, analyticsData, financialStats, storePerformanceStats, clientAnalytics, b2bStats, salesMetrics, topByStore…) are sums/counts over the full orders download. There is **no database function that computes dashboard statistics** (confirmed in `db/`).
- **Counting only:** AssistantCmo downloads the full catalogue to show 2 numbers (`:878`, `:887`); `StockPanel.jsx:133` downloads all consignment rows to add up 4 columns (`:175-186`); `ScanStation.jsx:304-316` downloads an inspector's entire QC history to count *today's* passes; CEO/COO download all QC records for a fail count.
- **Computing a maximum:** `AddProduct.jsx:40` and `stockRoomData.js:236` download every SKU to find the highest number.
- **Collecting phone numbers:** `WalkInTab.jsx:73` and `WalkInDashboard.jsx:66` download every order to build a set of phone numbers.

### 2.4 The same data fetched by several screens/components

- Full orders: ~18 dashboards, no shared cache (switching dashboards re-downloads).
- Full order_components: COO, Packaging, Retail, ProductionManager, B2bMerchandiser, B2bProduction.
- Role check: every dashboard queries `salesperson` for its own row on open, often **twice** (e.g. `ProductionManagerDashboard.jsx:418` + `:433`, `B2bProductionDashboard.jsx:140` + `:166`); `ReviewDetail.js` reads the same row up to 4 times in one submit (`:302, :320, :399, :491`).
- `InventoryDashboard`: StockOrdersTab (`:107`) and StockCalendarTab (`:43`) fetch the identical stock-order set, again on every tab switch.
- "Pending" + "All" fetched separately when pending is a subset: `VendorApprovals.jsx:31`, `ExhibitionApprovals.jsx:53`, `ProductionHeadVendors.jsx:155`.
- WarehouseDashboard fetches `order_components` three different ways (per card `:395`, per channel `:526`, re-journeys) with no sharing.

### 2.5 Queries inside loops ("N+1")

| Where | What happens |
|---|---|
| `WarehouseDashboard.jsx:515-547`, `qcHistory.js:53-62`, `reJourneys.js:43-53` & `:82-95` | One request per 200 orders, **queued** → 25–50 requests for a Production Head. Each batch is also unpaged, so it can **silently cut off at 1,000 rows**. `channel_key` already exists (and is indexed) on both `order_components` and `qc_records`, so one filtered query could replace the loop. |
| `CommsDashboard.jsx:136-143`, `ShopifyOrdersDashboard.jsx:577-583` | One request per 100 orders, queued. |
| `barcodeService.js:1632-1638` (`fetchAllMovements`) | After downloading all movements, one request per 100 orders, queued. |
| `barcodeService.js:1585-1594` (`enrichComponentsWithMovements`) | One request per 500 pieces, queued; runs after almost every component load (14 call sites). |
| `WarehouseDashboard.jsx:1094-1102` | One component query per visible order card (ScanStationOrders already does this in one batch, `:272`). |
| `walkinConversion.js:79-85` | **One database write per walk-in, every time the walk-ins page opens** (writes on a read path). |
| `notificationService.js:413-497` | Several queries per recipient rule, every time any notification is sent (17 call sites). |
| `ReviewDetail.js:801-885`, `CommsReviewOrder.jsx:283-345`, `CommsSourcingReturns.jsx:160-196`, `restoreOrderInventory.js:33-100` | Per line item: read stock, write stock, call Shopify — one after another (slow checkout, and two people can overwrite each other's stock change). |
| `ScanStation.jsx:1204-1223` | Packaging dispatch: 2 queued database calls per barcode. |
| `ComponentJourneyModal.jsx:84-95` | 2 queries per piece when opening a journey. |
| `StockExchangeTab.jsx:173-210`, `WarehouseTab.jsx:142-154`, `stockRoomData.js:364-370` | Per-item queued writes (stock transfer, warehouse edit, CSV import). |
| LXRTS sync: Admin `:904-925`, CEO `~:680`, COO `:194-214`, GM `~:305`, StoreManager `~:233`, `stockRoomShopify.js:131-146` | One Shopify edge-function call per synced product, every time the inventory tab opens (StockRoom: every ~5 minutes). |

### 2.6 `useEffect` hooks that refetch too often

| Where | Problem |
|---|---|
| `B2bOrderHistory.jsx:60-114` | Changing a status/type dropdown re-runs login check + re-downloads all B2B orders (the other filters on the page are done locally). |
| `WalkInsView.jsx:57-79` | Depends on the parent's `orders` array; any order update in the parent re-downloads all walk-ins and re-runs the write loop. |
| `NotificationBell.jsx:116-138` | The live subscription is torn down and recreated every time the filter or search changes; each new notification triggers 2 queued queries. This is on **every** dashboard. |
| `ProductionManagerDashboard.jsx:573-584` | Full external-movements download on **every** return to the Overview tab (no "already loaded" flag). Same for re-journey/QC tabs on PM `:559-570`, B2bProduction `:286-308`, ShopifyOrders `:910-930`. |
| `WarehouseDashboard.jsx:588-599` | Leaving the Scan tab re-downloads all orders. |
| `WarehouseDashboard.jsx:439-460`, `:515-547` | Re-run the whole batched component/QC download whenever orders are refetched. |
| `EditOrder.jsx:133-155` | After every save, re-queries salesperson and resets the form. |
| `CommsPRPerformance.jsx:71-88` | Refetches when the parent replaces its orders list (after a PDF click). |
| `OrderHistory.jsx:523` | Refetches on every login-token refresh (~hourly / on tab focus). |
| `StockRoom.jsx:174-186` | 60-second timer; if >4.5 min old, re-checks Shopify for every synced product and, if anything changed, reloads the whole catalogue. |

No infinite refetch loops were found.

---

## 3. Dashboard load cost — the 5 heaviest

"Round trips" = requests that must finish one after another; this is what the user waits for. Row counts use 10k orders and an *estimated* 30–50k components.

### #1 ProductionManagerDashboard (`src/components/B2B/ProductionManagerDashboard/ProductionManagerDashboard.jsx`, 4,603 lines)
- **Queries on open:** ~55–75. Almost all queued: login → role → profile (same row again) → **10 pages of all orders (`*`)** → vendors → **30–50 pages of all components** → movement batches. In parallel: all "dispose" QC records, and the **entire external-movements table** plus a queued lookup per 100 orders.
- **Rows downloaded:** ~10k full orders (tens of MB with `items`) + ~30–50k components + all movements + disposal QC records. The QC tab adds the whole QC table.
- **Calculated in the browser:** ~25 memoized aggregations (stage stats, dispatch data, sales metrics, top products by store — which walks every order's `items` JSON — tab counts), plus the Delivery Report (`:3637-3830`) and Calendar (`:4215-4275`) tabs, which loop over **all orders inside the render code without memoization**, so they recompute on every keystroke.

### #2 COODashboard (`src/screens/COODashboard/COODashboard.jsx:158-175`)
- **Queries on open:** role check, then 7 in parallel — but the slowest one decides: **all components = 30–50 queued pages**. Plus all orders `*` (10 pages), all QC records (paged), full catalogue.
- **Rows:** ~55,000+ (10k full orders + 30–50k components + all QC records + ~2k products).
- **Browser work:** ~12 aggregations (ops, brand, QC, consignment, inventory, financial stats; filtered lists; tab counts).

### #3 PackagingDashboard (`src/screens/PackagingDashboard/PackagingDashboard.jsx:105-113`)
- **Queries on open:** role check, then 3 full downloads in parallel: all orders (with items and addresses, ~10 pages), **all components (30–50 queued pages)**, all shipments. The Scan tab doesn't need any of it but still waits.
- **Rows:** ~40–60k.
- **Browser work:** keeps only completed/dispatched/delivered orders (`:189-192`), builds per-order maps of components and shipments over everything, counts, delivery-performance and production-overview panels.

### #4 AdminDashboard (`src/screens/AdminDashboard/AdminDashboard.jsx`, 3,979 lines)
- **Queries on open:** role check, then 5 in parallel: all orders `*` (10 pages), full catalogue, salesperson, vendors, **all customer profiles**. Inventory tab adds one Shopify call per synced product.
- **Rows:** ~10k full orders + all customer profiles (est. 5–10k) + ~2k products.
- **Browser work:** ~20 aggregations that all run on first load **regardless of which tab is open**, including a client book that cross-matches every profile against every order, and a line-item explosion of every order's `items`.

### #5 CeoDashboard (`src/screens/CeoDashboard/CeoDashboard.jsx`, 3,127 lines)
- **Queries on open:** role check, then 6 in parallel: all orders `*`, full catalogue, salesperson, vendors, consignment, **all QC records**.
- **Rows:** ~10k full orders + all QC history + ~2k products.
- **Browser work:** ~22 aggregations, all eager; tab counts recomputed **on every search keystroke**; the order-list sort runs a regular expression inside the comparison function.

**Close runners-up:** WarehouseDashboard for Production Heads (all orders with items and attachments, then 25–50 queued component batches — `WarehouseDashboard.jsx:339`, `:515-547`), B2bMerchandiser and B2bProduction (all components, 30–50 queued pages, for a B2B-only view), GM and StoreManager (all orders `*`; StoreManager discards the other stores), and StockRoom (full movement log re-read after every action).

---

## 4. Database side

> **Important caveat:** the core tables (`orders`, `order_components`, `products`, `product_variants`, `salesperson`, `profiles`, `stage_transitions`, `qc_records`, `notifications`…) were created in the Supabase dashboard, **not** in the repo's SQL. So their indexes and security rules exist only in the live database and **could not be seen**. Everything below that says "no index" means "not in the repo". Before building anything, run this on **both PROD and UAT**:
> ```sql
> SELECT tablename, indexname, indexdef FROM pg_indexes
>  WHERE tablename IN ('orders','order_components','products','product_variants',
>                      'salesperson','profiles','stage_transitions','qc_records',
>                      'notification_recipients');
> SELECT * FROM pg_policies
>  WHERE tablename IN ('orders','order_components','products','salesperson','profiles');
> ```

### 4.1 Indexes found in the repo

| Table | Indexes in repo (file:line) |
|---|---|
| **orders** | `(is_b2b, is_stock_order) WHERE is_stock_order` — `db/barcode_system/v2/54_b2b_stock_orders.sql:140`; `(production_head_designation)` partial — `v2/90_…:54`; `(is_comms)` and `(comms_engagement_type)` partial — `db/comms_dashboard.sql:37-38`; `(exhibition_id)` — `db/exhibitions/01_exhibitions_schema.sql:34`; unique `(shopify_order_id)`, `(order_no text_pattern_ops)`, `(web_order_status)` — `db/website_orders.sql:37, 80, 84` |
| **order_components** | `(channel_key)` — `v2/62_…:111`; `(order_id) WHERE cancelled_at IS NULL` (partial) — `v2/93_…:59` |
| **products** | `(is_draft) WHERE is_draft` — `v2/74_…:76`; `(store_category)` — `db/products_store_category.sql:31` |
| **qc_records** | `(channel_key, created_at DESC)` — `v2/61_…:181` |
| **profiles, salesperson, stage_transitions, notifications** | **none in repo** |
| Others | external_movements(component_id), shipments(order_id, created_at), order_payments(order_id / paid_at / payment_mode), walkins(sa_email / created_at / phone), component_stage_progress(component_id), etc. |

### 4.2 Frequently filtered/sorted columns with NO index in the repo

| Column | How it's used | Index in repo? |
|---|---|---|
| `orders.created_at` | **Sort key on 29 full-table downloads** | **No** — each page re-sorts the table, and "skip N rows" paging gets slower on every page |
| `orders.salesperson_email` | Associate dashboard, B2B exec | No |
| `orders.user_id`, `orders.delivery_email` | Order history, birthday notifications | No |
| `orders.delivery_date` | ~18 queries in the daily notification job; stock calendar | No |
| `orders.status` | Edge functions; would be needed for Packaging fix | No |
| `orders.is_b2b` | 4 B2B screens | Only inside a stock-only partial index → effectively no |
| `orders.salesperson_store` / store | Currently filtered in the browser | No |
| `orders.order_no` with `%text%` search | `ScanStation.jsx:66`, `ProductionOverrides.jsx:91` | Only prefix search indexed; `%…%` scans every row |
| `order_components.order_id` | 10 frontend queries **and the scan triggers (3–4 lookups per scan)** | Only the partial `WHERE cancelled_at IS NULL`, which these queries don't use |
| `order_components.barcode` with `%-text` | `barcodeService.js:1065`, `:1102` (hand-typed scans) | No — scans every piece |
| `order_components (is_active, stage_deadline)` | `check_escalations` | No |
| `stage_transitions (component_id, scanned_at)`, `(scanned_at)` | Journey view, daily scan report | No |
| `qc_records (component_id)`, `(order_id)`, `(inspected_by)` | QC history | No |
| `products.sku_id`, `product_variants.product_id` | ~25 lookups by product | No |
| `profiles.phone`, `profiles.email` | OTP login, Shopify import | No |
| `notification_recipients (recipient_email, read)` | Bell on every dashboard | No |
| `delivered_at` | Not filtered server-side anywhere (all in browser) | n/a |

### 4.3 Row-level security (RLS) on orders

- **The RLS policies for `orders` (and the other core tables) are not in the repo**, so whether they call `auth.uid()` once per row could not be checked. This matters a lot here: with ~20 dashboards reading every order, any per-row cost in a policy is multiplied by 10,000 rows × every page × every dashboard open.
- What to look for in `pg_policies` on live: bare `auth.uid()` / `auth.jwt()` / `auth.email()` (re-evaluated for every row — should be wrapped as `(select auth.uid())`), and `EXISTS (SELECT … FROM salesperson …)` sub-queries (a lookup per row).
- The one repo example of the risky shape is `label_templates_write` (`db/barcode_system/v2/92_label_templates.sql:80-86`): a per-row `salesperson` lookup with bare `auth.jwt()` and `lower(email)`. Harmless there (≈1 row), but a bad template to copy onto orders.
- `walkins` policies (`db/walkins.sql:52-60`) are commented out.

### 4.4 Views, functions, materialized views

- **Views:** only `products_live` (`v2/74_reserve_sku_rows.sql:187`, a thin `is_draft = false` filter). `v_order_payment_totals` (`db/order_payments.sql:66`) is written but commented out.
- **Materialized views:** none.
- **Database functions (RPCs):** ~40, almost all *write* operations for the barcode/production flow (`advance_component_stage`, `record_qc_result`, `security_guard_scan`, `verify_packaging_components`, `create_shipment`, `manual_complete_order`, `cancel_order_components`, `generate_order_no`, …). **None compute dashboard statistics.** Useful building blocks already exist: `orders.total_paid`, `remaining_payment`, `net_sb_revenue` are pre-computed columns, so a stats function could be a plain `GROUP BY`.
- **Triggers on busy tables:** a single scan can cascade: component update → `sync_order_warehouse_stage` (3–4 lookups on `order_components` by `order_id`) → orders update → stock/receipt/audit triggers. That's why the missing plain `order_components(order_id)` index matters for scan speed too. (`sync_order_warehouse_stage`'s trigger and the orders audit trigger exist only on live.)
- **Edge-function side:** `notification-scheduler` reads `profiles` without paging (`supabase/functions/notification-scheduler/index.ts:378-380`), so birthdays past the first 1,000 customers are silently missed; five `shopify-order-sync` maintenance modes also read without paging (`index.ts:1131, 1278, 1415, 1510, 1680`).

---

## 5. Rendering

### 5.1 Very large single components
Each of these is one giant component; typing a single character anywhere re-renders the whole page:
ProductionManagerDashboard **4,603** lines (~150 pieces of state, 14 tabs), ProductForm **4,339**, AdminDashboard **3,979**, CeoDashboard **3,127**, OrderHistory 2,476, AssociateDashboard 2,297, ScanStation 2,044, OrderDetails 2,037, B2bMerchandiser 1,978, WarehouseDashboard 1,958, StoreManager 1,904.

### 5.2 Lists shown without pagination or virtualization
Main order lists are paginated everywhere (good). The exceptions:
- `CommsInventory.jsx:376` — **entire catalogue (1,000+ rows)** in one table, and for each product it scans all variants (`:100-105`), so work = products × variants.
- `ProductForm.js:195` (SearchableSelect) and `B2bproductform.jsx:35` — dropdown renders every product (1,000+) when opened empty; `ProductForm.js:3491-3497` rebuilds the option list on every render.
- `StockExchangeTab.jsx:337` — all stock exchanges.
- `B2bMerchandiserDashboard.jsx:1085` — every pending approval.
- `AssociateDashboard.js:2184` — full client book; `WalkInTab.jsx:232` — all walk-ins.
- `WarehouseTab.jsx:335-340`, `DeliveryPerformancePanel` drill rows — can be long.

### 5.3 Heavy calculations re-running too often
- **No search box is debounced** on the exec dashboards; each keystroke re-filters and re-sorts all ~10k orders. The sort calls a regular expression **inside** the comparator (`getOrderNum`) — ~280,000 regex runs per keystroke at 10k orders (CEO `:789-803`, and the same pattern in Admin, COO, GM, StoreManager, Retail, AssistantCmo, Accounts `:43-49`, Warehouse `:738-755`).
- **Tab counts recomputed per keystroke:** `orderTabCounts` includes the search text in its dependencies (CEO `:817`, Retail `:771`).
- **Page number inside aggregation memos:** clicking "next page" recomputes the whole client/B2B/inventory analysis (Admin `:1456`, `:1575`, `:1698`; CEO `:1185`, `:1294`; GM `:579`, `:630`; COO `:569`; StoreManager `:819`; AssistantCmo `:834`).
- **All analytics compute on open, even for tabs never viewed** (Admin, CEO, COO, GM).
- **Not memoized at all:** ProductionManager Delivery Report / Calendar / Dispatch blocks (`:3247-3300`, `:3637-4275`); `WarehouseDashboard.jsx:1864-1872` and `AssociateDashboard.js:2108-2118` filter all orders **three times per render** for the calendar; `StockRoom/ProductDetail.jsx:69` filters the whole movement log per render; `AdminDashboard.jsx:2605/2610`, `:3764-3768`.
- **Wrong memo dependencies:** `WarehouseDashboard.jsx:757` — the `filteredOrders` calculation uses the warehouse-date period filter (`:683-688`) but doesn't list it as a dependency, so changing the period may not refresh the list until something else changes. `WarehouseDashboard.jsx:1094-1102` — an effect that runs on every render because `currentOrders` is a new array each time.

---

## 6. Ranked recommendations

Ranked by **(speed gain) ÷ (risk of breaking something)**. None have been implemented.

### 1. Make `fetchAllRows` fetch pages in parallel, with a stable sort — *Risk: LOW*
- **Change:** in `src/utils/fetchAllRows.js`, first ask for the row count (`count: 'exact', head: true`), then request all pages at once (`Promise.all`, perhaps 4–6 at a time), and always add `id` as a final tie-break sort. Also replace the hand-written page loops (`ProductionManagerDashboard.jsx:440-506`, `B2bMerchandiserDashboard.jsx:200-213`, `B2bProductionDashboard.jsx:247-259`, `qcHistory.js:69-83`, `reJourneys.js:58-70`) with the helper.
- **Improvement:** wall-clock time for every full download drops from N queued trips to ~1–2 "waves". COO/Packaging/PM component loads go from 30–50 trips to a handful. Also fixes skipped/duplicated rows.
- **Why low risk:** one shared file; results are the same rows. (It doesn't reduce *data volume* — that's #3–#6.)

### 2. Add missing database indexes — *Risk: LOW (check live first)*
- **Change:** after running the `pg_indexes` check in §4, add what's missing, most important first: `orders(created_at DESC, id)`, plain `order_components(order_id)`, `order_components(is_active, stage_deadline)`, `stage_transitions(component_id, scanned_at)`, `qc_records(component_id)`, `product_variants(product_id)`, `orders(salesperson_email)`, `orders(delivery_date)`, `profiles(phone)`, `notification_recipients(recipient_email, read)`. For `%text%` searches on `order_components.barcode` / `orders.order_no`, a `pg_trgm` GIN index. Pair each with a numbered `db/barcode_system/v2/NN_*.sql` migration, and use `CREATE INDEX CONCURRENTLY` to avoid locking.
- **Improvement:** faster sorted paging; faster scans (the triggers do 3–4 `order_id` lookups per scan); faster daily notification job. Medium-to-big.
- **Why low risk:** indexes don't change results.

### 3. Filter in the query instead of after the download — *Risk: LOW–MEDIUM*
- **Change** (each is a one-line query change where the browser currently throws rows away):
  - `.eq("is_comms", false)` on the 9 dashboards listed in §2.3.
  - StoreManager: filter by store in the query (`StoreManagerDashboard.jsx:202`). Care needed: the browser uses a fuzzy `storeMatches()` — the query must match exactly the same stores.
  - B2bProduction / B2bMerchandiser / ProductionManager components: filter by `channel_key` (already selected and indexed) instead of downloading every channel.
  - Warehouse QC / Re-journey / Overview batches (`WarehouseDashboard.jsx:515-547`, `qcHistory.js:53`, `reJourneys.js:43`): one `channel_key` query instead of 25–50 queued batches. This also fixes the silent 1,000-row cut-off per batch.
  - `ScanStation.jsx:309`: count today's QC with a date filter + count query instead of downloading the whole history.
  - `B2bvendorselection.jsx:122`: `.eq("role", "merchandiser")`.
  - `B2bOrderHistory.jsx:114`: filter the dropdowns locally instead of re-downloading.
- **Improvement:** large on the affected screens (StoreManager ~halves; B2B screens drop ~90% of component rows; Warehouse PH tabs go from 25–50 trips to 1–2).
- **Risk:** the filter must mean *exactly* what the browser filter meant (null handling, legacy channel prefixes). Test each screen's counts before/after.

### 4. Stop downloading the whole `order_components` table — *Risk: MEDIUM*
- **Change:** COO (`:173`), Packaging (`:109`), RetailManager (`:234`), ProductionManager (`:490`), B2bMerchandiser (`:204`), B2bProduction (`:250`). Where a screen only shows *counts per stage*, use a small database function that returns the counts (`GROUP BY current_stage`). Where it shows pieces for the orders on the current page, fetch only those orders' pieces (as `ScanStationOrders.jsx:272` already does).
- **Improvement:** the single biggest reduction for those 6 screens (30–50k rows and 30–50 trips → a few hundred rows and 1–2 trips).
- **Risk:** each screen's panels (stage cards, production overview, delivery performance) must be re-pointed at the new shape.

### 5. Stop pulling every column (`*`) of orders on list screens — *Risk: MEDIUM*
- **Change:** replace `select("*")` on the 19 list queries in §2.2 with the columns each screen actually uses; drop `items`/attachments from lists and load them for one order when it's opened or printed (PDFs already refetch the full order via `pdfUtils.js:86`).
- **Improvement:** payload shrinks several-fold (the code's own comment measured 1.6 MB / 40 s for `*`).
- **Risk:** medium — these are large files; a missed column shows up as a blank field or a wrong number. Some KPIs read inside `items` (e.g. top products), so those need #6 first.

### 6. Move dashboard numbers into the database — *Risk: HIGHER (largest long-term win)*
- **Change:** create a few database functions/views (e.g. `dashboard_order_stats(period, channel)`) that return revenue, counts by status/store/stage, late/delayed counts, client stats — for a date range. Dashboards call these instead of downloading 10k orders. Lists switch to server-side pagination (`.range()` + `count`) with filters/sort done by the database. Consider a materialized view refreshed by cron for the heaviest aggregates.
- **Improvement:** load time stops growing with order count. Exec dashboards go from 10k+ rows to a few hundred.
- **Risk:** every KPI must match today's JS logic exactly (the app has nuanced rules — channel prefixes, derived order status, GST reverse-calc). Do it one dashboard at a time with side-by-side comparisons. Changes business-number code, so it needs sign-off.

### 7. Add a shared cache between screens — *Risk: MEDIUM*
- **Change:** introduce React Query (or a small shared store) for `salesperson`/role, catalogue, vendors, and the orders list; store the role in `AuthContext` at login.
- **Improvement:** navigating between dashboards stops re-downloading; removes ~2 role queries per page open.
- **Risk:** adds a library and touches many screens; stale-data rules need thought. Best done after #6 makes the cached payloads small.

### 8. Collapse the per-item loops into batch calls — *Risk: MEDIUM*
- **Change:** one database function per operation for: packaging dispatch (`ScanStation.jsx:1204-1223`), stock decrement at checkout (`ReviewDetail.js:801-885`, `CommsReviewOrder.jsx:283-345`, `CommsSourcingReturns.jsx:160-196`, `restoreOrderInventory.js`), stock exchange (`StockExchangeTab.jsx:173-210`), walk-in reconcile (`walkinConversion.js:79`, and stop running it on page open), notification recipient lookup (`notificationService.js:413`). Parallelize the queued chunk loops (`CommsDashboard.jsx:136`, `ShopifyOrdersDashboard.jsx:577`, `barcodeService.js:1585`, `:1632`) or replace them with an embedded select.
- **Improvement:** faster checkout/dispatch; also removes race conditions on stock counts.
- **Risk:** medium; these are write paths, so they need careful testing.

### 9. Cheap rendering fixes — *Risk: LOW*
- Debounce search boxes (~300 ms) on exec dashboards.
- Pre-compute each order's numeric sort key once instead of running a regex inside the sort comparator.
- Split memos so the page number isn't a dependency of the aggregation (§5.3 list).
- Only compute a tab's analytics when that tab is open.
- Memoize the calendar/day filters (`WarehouseDashboard.jsx:1864-1872`, `AssociateDashboard.js:2108-2118`) and ProductionManager's render-time loops.
- CommsInventory: build a variants-by-product map and paginate the table.
- Fix `WarehouseDashboard.jsx:757` dependency list (add the period values).
- **Improvement:** snappier typing and tab switching; doesn't affect load time.

### 10. Smaller, targeted fixes — *Risk: LOW*
- `NotificationBell.jsx:116-138`: keep one live subscription regardless of filter; run its 2 queries in parallel.
- Add "already loaded" flags so ProductionManager's movements / re-journey / QC tabs don't refetch on every visit.
- `InventoryDashboard`: share the stock-orders fetch between the Stock Orders and Calendar tabs.
- `StockRoom`: page the movement log instead of re-reading it after every action (`stockRoomData.js:142`).
- `WalkInTab.jsx:73` / `WalkInDashboard.jsx:66`: replace "download every order's phone" with a database-side match.
- Paginate the unpaged edge-function reads (`notification-scheduler` birthdays, `shopify-order-sync` maintenance modes).

### 11. Audit RLS on live — *Risk: LOW to check, MEDIUM to change*
- Run the `pg_policies` query from §4. If any policy on `orders` uses bare `auth.uid()`/`auth.jwt()` or a per-row `salesperson` sub-query, wrap the auth call as `(select auth.uid())` or move the role lookup into a `STABLE SECURITY DEFINER` helper. This can be a large hidden cost on the full-table reads, but it can't be measured from the repo alone.

---

### Side effects of the current fetching pattern (data accuracy, not just speed)
These came up while tracing the queries. They are fetching problems rather than business-logic bugs, so they are listed here:
- Paging without a unique sort (≈20 unordered `fetchAllRows` calls, all `created_at`-only calls) can skip or double-count rows.
- Queued 200-order batches (`WarehouseDashboard.jsx:524-530`, `qcHistory.js:53-59`, `reJourneys.js:43-50`) and the inspector QC history (`qcHistory.js:40-47`) are unpaged, so they can silently stop at 1,000 rows.
- `consignment_inventory` is read unpaged on CEO `:336`, COO `:167`, GM `:277`, AssistantCmo `:195` (silent cap at 1,000).
- `CommsInventory.jsx:139` filters by `created_at`, which isn't in its select list (`:86`), so a bounded period hides every product.

---
---

# Appendices — detailed evidence (complete query inventory)

The five appendices below are the raw working notes from the audit, split by area. They contain the full per-call tables (every `.from()` / `.rpc()` / `fetchAllRows` / edge-function call with file:line, columns, filters, paging, full-table flag and on-load flag). Line numbers were verified against `development` at `fd2fadb`. Where a note and the summary above disagree, the summary above is the reviewed version (for example, the WarehouseDashboard memo dependency list is at line **757**).


---

## Appendix A — Performance audit: utils / hooks / lib / context / config / pdf / index.js / App.js

Read-only. All line numbers verified against the working tree (branch `development`, HEAD fd2fadb).
Line numbers for query-builder calls point at the `.from(` / `.rpc(` / `fetchAllRows(` line.

---

### 1. Every Supabase call in scope

Legend: **PL** = runs on page/component load (mount effect), **UA** = user action (scan, button, save), **dead** = exported, no callers anywhere in `src/`.

#### src/utils/barcodeService.js

| File:line | Table/RPC | Columns | Filters/order | Paginated? | Full-table download? | Page load? / callers |
|---|---|---|---|---|---|---|
| barcodeService.js:860 | rpc `advance_component_stage` | – | – | n/a | no | UA (scan) |
| :877 | rpc `activate_components` | – | – | n/a | no | UA |
| :902 | rpc `record_qc_result` | – | – | n/a | no | UA |
| :931 | rpc `security_guard_scan` | – | – | n/a | no | UA |
| :953 | rpc `verify_packaging_components` | – | – | n/a | no | UA |
| :976 | rpc `create_shipment` | – | – | n/a | no | UA |
| :990 | rpc `mark_shipment_delivered` | – | – | n/a | no | UA |
| :1003 | `shipments` | `*, shipment_components(component_id)` | eq order_id, order created_at | no | no | **dead** (`fetchOrderShipments`, 0 callers) |
| :1017 | `order_components` | `*` | eq order_id, order component_type | no | no | UA — ScanStation.jsx (5), ProductionOverrides.jsx |
| :1065 | `order_components` | `barcode` | **ilike `%-<raw>`** (leading wildcard) | no | no, but seq-scan | UA — `resolveFullBarcode`, ScanStation.jsx, only for prefix-less input |
| :1079 | `order_components` | `*, orders(order_no, delivery_date, created_at, salesperson, salesperson_email, status)` | eq barcode | no | no | UA — every scan (ScanStation 7, ProductionOverrides 5, ProductionHeadVendors 2) |
| :1102 | `order_components` | same embed | **ilike `%-<barcode>`** fallback | no | no, but seq-scan | UA — only on exact miss + prefix-less pattern |
| :1124 | `stage_transitions` | `*` | eq component_id, order scanned_at | no | no | UA — ComponentJourneyModal, ProductionOverrides, ScanStation |
| :1138 | `qc_records` | `*` | eq component_id | no | no | **dead** (`fetchQcHistory`) |
| :1296 | `order_components` insert `.select()` | returns `*` | – | n/a | no | UA — order placement / via ensureOrderComponents |
| :1324 | `order_components` | `*` | eq order_id | no | no | UA — `ensureOrderComponents` (pdfUtils, OrderDetailPage, B2bMerchandiser, B2bReviewOrder ×2) |
| :1336 | `order_components` insert missing | – | – | n/a | no | UA |
| :1350 | rpc `initiate_replacement_journey` | – | – | n/a | no | UA |
| :1364 | `replacement_requests` | `*` | eq status=pending, order created_at | no | small | PL — ReplacementApprovals.jsx:48 |
| :1373 / :1382 | rpc `approve_/reject_replacement_journey` | – | – | n/a | no | UA |
| :1398 | `factory_pause` | `*` | is resumed_at null, order paused_at, limit 1 | limit 1 | no | PL — FactoryPause.jsx:30 |
| :1411 / :1422 | `factory_pause` insert / update | – | – | n/a | no | UA |
| :1437 | `production_vendors` | 7 cols | eq status=approved, order vendor_name | no | small table | PL — ProductionHeadVendors, ScanStation |
| :1448 | `production_vendors` | `*` | order created_at | no | **yes (small)** | PL — ProductionHeadVendors, VendorApprovals, VendorRequest |
| :1471 / :1500 | `production_vendors` insert / update | – | – | n/a | no | UA |
| :1489 | `production_vendors` | `*` | eq status=pending | no | small | PL — VendorApprovals.jsx:31 (duplicate of :1448, see §3) |
| :1519 | rpc `configure_external_movement` | – | – | n/a | no | UA |
| :1537 | `external_movements` | `vendor_id` | eq component_id [neq id] | no | no | UA — ProductionHeadVendors (2) |
| :1550 | `external_movements` | 5 cols | eq component_id, eq status=configured, limit 1 | limit 1 | no | UA — ScanStation |
| :1566 | `external_movements` | 10 cols | eq component_id | no | no | UA — journey modal etc. |
| :1588 | `external_movements` | `component_id, stages_outside` | in(component_id, 500-chunk), eq status=exited | chunked, **sequential loop** | no | PL — `enrichComponentsWithMovements`, called after every component list load (WarehouseDashboard ×2, PM dashboard, B2bProduction, B2bMerchandiser, Comms, Shopify, ScanStationOrders, ScanStation ×2, ProductionOverrides ×6) |
| :1609 | fetchAllRows `external_movements` | 13 cols + `order_components(barcode, order_no, component_type, order_id)` | order created_at desc (non-unique) | fetchAllRows | **YES — whole table, every call** | PL — ProductionHeadVendors.jsx:176 (mount), PM dashboard :579 via externalMovements.js:67 (tab-gated) |
| :1635 | `orders` | `id, created_at, is_b2b, salesperson_store` | in(id, **100-chunk**) | chunked, **sequential loop** | no, but N/100 round trips | same as :1609 |
| :1650 | rpc `update_external_movement` | – | – | n/a | no | UA |
| :1680 | `stage_overrides` insert | – | – | n/a | no | UA |
| :1730 | fetchAllRows `stage_overrides` | `*` | order created_at desc; optional eq overridden_by | fetchAllRows | **YES — whole table** (grows forever) | PL — OverrideHistory.jsx:48; period filter then applied in JS (OverrideHistory.jsx:78) |
| :1777 | fetchAllRows `order_components` | 7 cols | eq is_active | fetchAllRows | yes (active set) | **dead** (`fetchComponentStats`) |

#### Other utils / hooks / pdf / context

| File:line | Table/RPC | Columns | Filters/order | Paginated? | Full-table? | Page load? / callers |
|---|---|---|---|---|---|---|
| b2bRoleGuard.js:35 | `auth.getUser()` (network call to GoTrue) | – | – | – | – | PL — 5 B2B screens (`checkB2bRole`) |
| b2bRoleGuard.js:46 | `salesperson` | `role` | eq email, maybeSingle | – | no | PL — same |
| cancelOrder.js:65 | `orders` update | – | eq id | – | no | UA (7 callers) |
| cancelOrder.js:75 | rpc `cancel_order_components` | – | – | – | no | UA |
| cancelOrder.js:96 / :97 | `vendors` select `current_credit_used` then update | – | eq id | – | no | UA — read-modify-write (not atomic) |
| cancelOrder.js:112 | rpc `get_production_head_email` | – | – | – | no | UA |
| exhibitionService.js:48/:88/:100/:118 | `exhibitions` insert/update | – | – | – | no | UA |
| exhibitionService.js:136 | `exhibitions` | `*` | eq created_by, order created_at | no | no | PL — ExhibitionPanel.jsx:54 |
| exhibitionService.js:147 | `exhibitions` | `*` | eq status=active [eq created_by] | no | no | **dead** (`fetchActiveExhibitions`) |
| exhibitionService.js:160 | `exhibitions` | `*` | eq status=pending | no | no | PL — ExhibitionApprovals.jsx:53 |
| exhibitionService.js:171 | `exhibitions` | `*` | order created_at | no | **yes (small)** | PL — ExhibitionApprovals.jsx:53 (dup of :160) |
| labelTemplate.js:141 | `label_templates` | 5 cols | eq key, maybeSingle | – | no | UA (print) / PL LabelDesigner |
| labelTemplate.js:165 | `label_templates` update (+ re-read via :141) | – | eq key | – | no | UA |
| labelTemplate.js:226 | `products` | 6 cols | in(sku_id, skus) — one batch | no | no | UA (print) |
| manualComplete.js:22 | rpc `manual_complete_order` | – | – | – | no | UA |
| notificationService.js:384 | `notifications` insert `.select().single()` | – | – | – | no | UA (`sendNotification`, 17 call sites) |
| notificationService.js:417 | `notification_settings` | `value` | eq key | – | no | UA — **inside for-loop** over recipient configs |
| notificationService.js:444 | `salesperson` | `email, role` | eq role, eq store_name | no | no | UA — **inside for-loop** |
| notificationService.js:463 | `salesperson` | `email, role` | eq role | no | no | UA — **inside for-loop** |
| notificationService.js:481 | `salesperson` | `email, designation` | ilike `%designation%` | no | no | UA — **inside for-loop** |
| notificationService.js:512 | `notification_recipients` insert (batched) | – | – | – | no | UA |
| notificationService.js:545 | `notification_recipients` + embed `notification(...)` (10 cols incl. `metadata`, `attachments` JSONB) | 5 + 10 cols | eq recipient_email, [eq read=false], [or ilike title/message/order_no on embed, `!inner`], order created_at | **limit 50** | no | PL — NotificationBell (inside DashboardHeader, 24 importers ⇒ every dashboard) + on every realtime INSERT |
| notificationService.js:605/:614 | `notification_recipients` update | – | eq id / eq email+read=false | – | no | UA |
| notificationService.js:627 | `notification_recipients` | `id`, count exact, head | eq recipient_email, eq read=false | head | no | PL — NotificationBell + every realtime INSERT |
| notificationService.js:646 | `notification_recipients` delete | – | eq email | – | no | UA |
| pdfUtils.js:26 | `vendors` | `store_brand_name` | eq id maybeSingle | – | no | UA (PDF) |
| pdfUtils.js:86 | `orders` | **`*`** | eq id single | – | no (1 row) | UA (PDF) — `fetchFullOrder`, intentional re-fetch |
| pdfUtils.js:135/147, 254/266, 362/372, 427/437, 499/510 | Storage bucket `invoices` upload / getPublicUrl | – | – | – | – | UA (PDF) |
| pdfUtils.js:155/:276/:383/:537/:564 | `orders` update (customer_url / warehouse_urls) | – | eq id | – | no | UA |
| qcHistory.js:42 | `qc_records` | QC_RECORD_COLUMNS (17) | eq inspected_by, order created_at | **no — silently capped at 1000** | no | PL — ScanStation.jsx:309, ScanStationPage.jsx:89 |
| qcHistory.js:56 | `qc_records` | 17 cols | in(order_id, **200-chunk**), order created_at | chunked **sequential loop**, each chunk unpaged | no | tab-gated — WarehouseDashboard:444, B2bProduction:291, ShopifyOrders:915 |
| qcHistory.js:73 | `qc_records` | 17 cols | [eq outcome], order created_at, `.range()` loop | hand-rolled paging (dup of fetchAllRows) | **YES — whole table** | **PL — CeoDashboard:341, COODashboard:172 (inside page-load Promise.all)**; PM :535 (mount, outcome=dispose), PM :552 (tab-gated) |
| reJourneys.js:46 | `order_components` | 15 cols | in(order_id, 200-chunk), eq is_rework, eq is_active | chunked **sequential loop** | no | tab-gated — WarehouseDashboard:456, B2bProduction:303, ShopifyOrders:927 |
| reJourneys.js:60 | `order_components` | 15 cols | eq is_rework, eq is_active, `.range()` loop, **no `.order()`** | hand-rolled paging | all rework rows | tab-gated — PM :564 |
| reJourneys.js:85 | `qc_records` | 7 cols | in(component_id, 200-chunk), eq outcome=rework, order created_at | chunked **sequential loop** | no | same as above |
| restoreOrderInventory.js:40 / :51 | `product_variants` select then update | `id, inventory, size` | eq product_id, eq size, limit 1 | – | no | UA (cancel) — **per item, in for-loop** |
| restoreOrderInventory.js:60 | fetch edge fn `shopify-inventory` | – | – | – | – | UA — per item, in loop |
| restoreOrderInventory.js:85 / :94 | `products` select then update | `inventory` | eq id | – | no | UA — per item, in loop |
| scanReport.js:39 | `stage_transitions` + embed `order_components(component_label, component_type)` | 11 cols | gte/lte scanned_at, order scanned_at (non-unique), `.range()` loop | hand-rolled paging | no (date-bounded) | UA/tab — PM dashboard |
| shopifyInventory.js:90 / :123 | fetch edge fn `shopify-inventory` (fetch / reduce) | – | – | – | – | UA; also StockRoom 60 s poll via stockRoomShopify.js:134 (one call per LXRTS product) |
| walkinConversion.js:81 | `walkins` update | – | eq id | – | no | **PL — per-row update in for-loop**, via reconcileConversions from WalkInsView.jsx:68 and WalkInTab.jsx:81 on load |
| walkinConversion.js:104 | `walkins` update | – | eq id | – | no | UA |
| whatsappService.js:26 | fetch edge fn `spur-whatsapp` | – | – | – | – | UA |
| restoreAssociateSession.js:47 | `auth.setSession` | – | – | – | – | UA (exit order flow) |
| hooks/useSkuScan.js:72 | `products` | `*` | eq sku_id maybeSingle | – | no | UA (scan) |
| pdf/pdfHelpers.js:33 | `fetch(url)` remote image | – | – | – | – | **dead** (pdf-lib path; file not imported anywhere) |
| context/AuthContext.js:13 | `auth.onAuthStateChange` | – | – | – | – | PL (root, once) |
| context/AuthContext.js:23 | `auth.getSession()` | – | – | – | – | PL (root, once; local, no network unless refresh) |

No `supabase.functions.invoke` anywhere in scope; edge functions are called with raw `fetch()` + anon key (restoreOrderInventory.js:60, shopifyInventory.js:90/:123, whatsappService.js:26). hooks/useBarcodeScanner.js, useTabParam.js, useFilterParam.js, config/config.js, index.js, App.js make no Supabase calls.

---

### 2. fetchAllRows

#### How it works — `src/utils/fetchAllRows.js`
- `PAGE_SIZE = 1000` (line 6).
- Loop `while (true)` (line 26): `to = from + 999` (27); rebuilds the query each page by calling `buildQuery(supabase.from(table))`, or `select("*")` if no builder (28–30); `await configured.range(from, to)` (31).
- **Strictly sequential**: each page awaits the previous (line 31 inside the loop). 10k orders = 10 serial round-trips; no parallelism, no `count` pre-fetch.
- Stops when a page is empty (33) or **`data.length < PAGE_SIZE`** (35). Errors return `{data:null,error}` and discard already-fetched pages (32).
- **Ordering is entirely the caller's responsibility.** It adds no `.order()`. Offset paging over an unordered or non-unique-ordered query is not guaranteed stable: rows can be duplicated or skipped across page boundaries (esp. under concurrent inserts, e.g. new orders arriving while page 3 loads).
- **Silent-truncation trap (line 35):** the break assumes the server's max-rows is ≥1000. If the project's PostgREST `max_rows` is ever set below 1000 (the file's own comment line 3 says it is "configurable per project"), the first page returns e.g. 500 < 1000 and the loop exits after page 1 — the exact silent truncation it exists to prevent. A `count: "exact"` on the first request (or comparing to the requested window) would make it robust.
- Server cost: OFFSET paging makes page k scan k×1000 rows; with `select("*")` on `orders` every page also ships the heavy `items` JSONB (and attachments, signatures, etc.).

#### All callers in src/ (77)

"Narrowed" = explicit column list. "Scoped" = date/owner/channel filter that bounds growth.

| File:line | Table | Narrowed? | Scoped (date/owner/channel)? | Order |
|---|---|---|---|---|
| components/AddProduct/AddProduct.jsx:40 | products | yes (`sku_id`) | like SKU-% | none |
| AddProduct.jsx:268 | products | yes (2) | no | none |
| AddProduct.jsx:572 | products_live | yes (3) | no | none |
| AddProduct.jsx:1007 | products_live | **no `*`** | eq sync_enabled=false | sku_id |
| AddProduct.jsx:1076 | products_live | yes (2) | no | none |
| AddProduct.jsx:1124 | products | yes (`sku_id`) | like SKU-% | none |
| components/AddProduct/BarcodeExportPanel.jsx:58 | products | yes (2) | is_draft, like | none |
| components/ExhibitionPanel.jsx:60 | orders | yes (12, no items) | in exhibition_id | none |
| components/ScanStationOrders.jsx:118 | **orders** | yes (21, no items) | **no — all orders** | created_at |
| components/stock/StockExchangeTab.jsx:39 | stock_exchanges | `*` + 2 embeds | no | created_at |
| stock/StockExchangeTab.jsx:56 | products_live | yes (3) | no | name |
| stock/StockPanel.jsx:117 | product_channel_stock | yes (3) | no | none |
| stock/StockPanel.jsx:126 | warehouse_stock | yes + embed | no | none |
| stock/StockPanel.jsx:133 | consignment_inventory | yes (4) | no | none |
| stock/WarehouseTab.jsx:49 | products_live | yes (3) | no | name |
| components/WalkInsView/WalkInsView.jsx:63 | walkins | yes (11) | no | created_at |
| screens/AccountantDashboard/AccountantDashboard.jsx:143 | **orders** | **no `*`** | **no** | created_at |
| screens/AccountsDashboard/AccountsDashboard.jsx:36 | **orders** | **no `*`** | **no** | created_at |
| screens/AdminDashboard/AdminDashboard.jsx:377 | **orders** | **no `*`** | **no** | created_at |
| AdminDashboard.jsx:381 | products_live | `*` | no | name |
| AdminDashboard.jsx:386 | profiles | yes (5) | no | none |
| screens/AssistantCmoDashboard/AssistantCmoDashboard.jsx:188 | **orders** | yes (22, **incl. items**) | no | created_at |
| AssistantCmoDashboard.jsx:191 | products_live | `*` | no | name |
| AssistantCmoDashboard.jsx:194 | profiles | yes (7) | no | none |
| screens/AssociateDashboard.js:456 | **orders** | yes (~37, **incl. items, attachments**) | eq salesperson_email (skipped for `sa_services` ⇒ all orders) | created_at |
| screens/B2bExecutiveDashboard/B2bexecutivedashboard.jsx:79 | orders | **`*`** | is_b2b + salesperson_email | created_at |
| screens/B2bMerchandiserDashboard/B2bMerchandiserDashboard.jsx:173 | orders | **`*`** | is_b2b | created_at |
| screens/B2bOrderHistory/B2bOrderHistory.jsx:81 | orders | **`*`** | is_b2b [+status/type] | created_at |
| screens/B2bproductform/B2bproductform.jsx:332 | products_live | `*` + product_extra_prices(*) | no | name |
| screens/B2bProductionDashboard/B2bProductionDashboard.jsx:182 | orders | **`*`** | or(is_b2b, comms assign, PH designation) | created_at |
| screens/B2bVendorOrders/B2bVendorOrders.jsx:75 | orders | **`*`** | vendor_id + is_b2b | created_at |
| screens/CeoAssistantDashboard/CeoAssistantDashboard.jsx:91 | **orders** | **no `*`** | **no** | created_at |
| screens/CeoDashboard/CeoDashboard.jsx:329 | **orders** | **no `*`** | **no** (is_comms filtered in JS after) | created_at |
| CeoDashboard.jsx:333 | products_live | `*` | no | name |
| screens/CommsDashboard/CommsDashboard.jsx:124 | orders | **`*`** | is_comms | created_at |
| CommsDashboard/CommsInventory.jsx:86 | products_live | yes (10) | no | name |
| CommsInventory.jsx:87 | product_variants | yes (5) | no | none |
| screens/COODashboard/COODashboard.jsx:160 | **orders** | **no `*`** | **no** | created_at |
| COODashboard.jsx:164 | products_live | `*` | no | name |
| COODashboard.jsx:173 | order_components | yes (5) | **no — all components** | none |
| screens/GMDashboard/GMDashboard.jsx:270 | **orders** | **no `*`** | **no** | created_at |
| GMDashboard.jsx:274 | products_live | `*` | no | name |
| screens/HeadOfDesignDashboard/HeadOfDesignDashboard.jsx:133 | **orders** | **no `*`** | **no** | created_at |
| screens/InventoryDashboard/InventoryDashboard.jsx:207 | products_live | `*` | no | name |
| InventoryDashboard.jsx:238 | product_variants | yes (3) | no | none |
| InventoryDashboard.jsx:258 | product_channel_stock | yes (3) | no | none |
| InventoryDashboard/StockCalendarTab.jsx:43 | orders | **`*`** | is_stock_order | delivery_date |
| InventoryDashboard/StockOrdersTab.jsx:107 | orders | **`*`** | is_stock_order | created_at |
| screens/PackagingDashboard/PackagingDashboard.jsx:107 | **orders** | yes (23, **incl. items**) | **no** | created_at |
| PackagingDashboard.jsx:109 | order_components | yes (10) | **no — all** | none |
| PackagingDashboard.jsx:111 | shipments | yes (7) | no | none |
| screens/ProductForm.js:1385 | products_live | `*` + product_extra_prices(*) | no | none |
| screens/RetailDashboard/RetailManagerDashboard.jsx:216 | **orders** | **no `*`** | **no** | created_at |
| RetailManagerDashboard.jsx:234 | order_components | yes (14) | **no — all** | none |
| screens/ShopifyOrdersDashboard/ShopifyOrdersDashboard.jsx:562 | orders | yes (incl. items) | or(order_no prefix) | created_at |
| screens/StockRoom/stockRoomData.js:80 | products_live | yes (PRODUCT_COLUMNS) | no | id ✔ |
| stockRoomData.js:81 | product_variants | yes (5) | no | id ✔ |
| stockRoomData.js:84 | warehouse_stock | yes (4) | no | id ✔ |
| stockRoomData.js:98 | orders | yes (11, incl. items) | is_stock_order | id ✔ |
| stockRoomData.js:111 | orders | yes (8, incl. items) | **gte created_at since (date-scoped ✔)**, not stock | id ✔ |
| stockRoomData.js:140 | stock_room_placed | yes (4) | no | composite ✔ |
| stockRoomData.js:142 | stock_room_movement | `*` | no (grows forever) | id ✔ |
| stockRoomData.js:144 | stock_room_product_collection | yes (2) | no | composite ✔ |
| stockRoomData.js:236 | products | yes (`sku_id`) | like SKU-% | id ✔ |
| stockRoomData.js:248 | products | yes (2) | no | id ✔ |
| stockRoomData.js:277 | products | yes (`sku_id`) | not null | id ✔ |
| stockRoomData.js:283 | products_live | `*` | no | name,id ✔ |
| stockRoomData.js:288 | products_live | yes (3) | no | id ✔ |
| screens/StoreManagerDashboard/StoreManagerDashboard.jsx:202 | **orders** | **no `*`** | **no** | created_at |
| StoreManagerDashboard.jsx:206 | products_live | `*` | no | name |
| screens/WalkInDashboard/WalkInDashboard.jsx:66 | **orders** | yes (4) | **no** | created_at |
| screens/WalkInTab.jsx:68 | walkins | `*` | eq sa_email | created_at |
| screens/WalkInTab.jsx:73 | **orders** | yes (`delivery_phone`) | **no — all 10k orders just for a phone set** | **none** |
| screens/WarehouseDashboard.jsx:339 | **orders** | yes (~30, **incl. items, attachments, alteration_attachments**) | **no** (scoped in JS afterwards) | created_at |
| utils/barcodeService.js:1609 | external_movements | yes (13 + embed) | **no** (channel/order scope applied in JS) | created_at |
| utils/barcodeService.js:1730 | stage_overrides | **`*`** | optional overridden_by; **no date** (period filter in JS) | created_at |
| utils/barcodeService.js:1777 | order_components | yes (7) | is_active | none (dead code) |

Summary: **29 fetchAllRows calls on `orders`**; **18 use `select("*")`** (Accountant, Accounts, Admin, B2bExecutive, B2bMerchandiser, B2bOrderHistory, B2bProduction, B2bVendorOrders, CeoAssistant, Ceo, Comms, COO, GM, HeadOfDesign, StockCalendar, StockOrders, RetailManager, StoreManager); **16 have no server-side filter at all** (ScanStationOrders, Accountant, Accounts, Admin, AssistantCmo, CeoAssistant, Ceo, COO, GM, HeadOfDesign, Packaging, RetailManager, StoreManager, WalkInDashboard, WalkInTab, Warehouse — plus Associate for `sa_services`); **only one caller (stockRoomData.js:111) is date-bounded**. Four full downloads of `order_components` (COO:173, Packaging:109, Retail:234, dead :1777). Only StockRoom (stockRoomData.js) orders by a unique key; every `order("created_at")` caller has tie risk, and ~20 callers have no `.order()` at all.

---

### 3. Flags

#### 3a. `select('*')` on orders (in scope)
- pdfUtils.js:86–89 `fetchFullOrder` — single row by PK, intentional (PDF needs every column). Acceptable; only concern is it's re-run once per PDF action and `downloadWarehousePdf` then passes that full row down.
- Everything else is in screens (see §2 table; 14 `select("*")` fetchAllRows callers on orders).

#### 3b. Download-then-filter/sort/sum/count in JS
- barcodeService.js:1609–1643 `fetchAllMovements` downloads **all** external_movements, then externalMovements.js:68–75 and ProductionHeadVendors.jsx:176–180 filter by `orderIds` / `channel` in JS. (The "mark repeats over the full set" requirement could be served by a SQL window function / RPC.)
- barcodeService.js:1730 `fetchStageOverrides` downloads the whole overrides table; OverrideHistory.jsx filters by period/search/type in JS.
- barcodeService.js:1777–1802 `fetchComponentStats` — downloads all active components to count by stage in JS (a `GROUP BY` RPC). Dead code today, but a trap if revived.
- qcHistory.js:73–84 paged whole `qc_records` then `qcSummary` (100–111) / `filterQcRecords` (134–156) count and date-filter in JS; loaded at page load by CEO (CeoDashboard.jsx:341) and COO (COODashboard.jsx:172) just to show a QC-fail count.
- qcHistory.js:52–64: per-chunk results concatenated then **re-sorted in JS** (64).
- reJourneys.js:76 filters terminal stages in JS after fetch (could be `.not("current_stage","in",...)` server-side); 100–104 JS sort.
- walkinConversion.js reconcile needs WalkInTab.jsx:73 to download every order's `delivery_phone` (10k rows, 10 pages, no order) to build a phone set in JS.
- CeoDashboard.jsx:342 `ordersRes.data.filter(o => !o.is_comms)` — filter after download (`.eq/.not` server-side).

#### 3c. Queries inside loops (N+1 / serial chunk loops)
- barcodeService.js:1585–1594 `enrichComponentsWithMovements` — sequential `await` per 500-id chunk. Called after nearly every component-list load (14 call sites).
- barcodeService.js:1632–1638 `fetchAllMovements` — sequential `await` per **100** order ids. With a few thousand distinct orders in movements this is tens of serial round-trips on top of the fetchAllRows pages. Could be replaced by a nested embed `order_components(..., orders(created_at, is_b2b, salesperson_store))` in the :1610 select → zero extra queries.
- qcHistory.js:53–62 — sequential per 200 order ids. A Production Head with ~5k orders ⇒ 25 serial requests. `qc_records` already has a stored `channel_key` with index `(channel_key, created_at DESC)` (found in db/), so this could be `.eq("channel_key", …)` + paging instead of shipping order ids.
- reJourneys.js:43–53 (per 200 order ids) and 82–95 (per 200 component ids) — two sequential chunk loops; `order_components.channel_key` is indexed too.
- notificationService.js:413–497 — `for (const config of recipientConfigs)` with an `await` Supabase query per config (settings / salesperson by role / role+store / designation ilike). Runs on every `sendNotification` (17 call sites, e.g. order placement, cancellation). Could be one `salesperson` query with `.or()` or a server-side RPC/trigger.
- restoreOrderInventory.js:33–100 — per order item, sequentially: select + update (+ edge-function fetch for synced items). Also a non-atomic read-modify-write increment (race with concurrent sales); an RPC `increment inventory` would fix both.
- walkinConversion.js:79–85 — one `UPDATE` per changed walk-in, sequential, **triggered on page load** from WalkInsView.jsx:68 and WalkInTab.jsx:81 (writes during a read path).
- cancelOrder.js:65→75→88→96→97→112 — 5–6 serial round-trips per cancel (+ restoreOrderInventory loop + sendNotification loop). Acceptable for a user action, but a single `cancel_order` RPC would make it atomic too (vendor credit :96–99 is read-modify-write).
- pdfUtils.js:225–271 — per garment: render + upload sequentially (CPU-bound, acceptable); `components.find` inside `filter` (233, 341, 479) is O(n²) but n is tiny.
- scanReport.js:37–50, qcHistory.js:72–83, reJourneys.js:58–70 — hand-rolled sequential `.range()` loops duplicating fetchAllRows (and reJourneys.js:59–64 has **no `.order()`**, so its pages are not stable).

#### 3d. Duplicated fetches of the same data
- VendorApprovals.jsx:31 `Promise.all([fetchPendingVendors(), fetchAllVendors()])` — pending (barcodeService.js:1489) is a subset of all (:1448); derive pending in JS from one fetch.
- ExhibitionApprovals.jsx:53 `Promise.all([fetchPendingExhibitions(), fetchAllExhibitions()])` — same pattern (exhibitionService.js:160 ⊂ :171).
- `fetchAllMovements` (whole table) is fetched independently by ProductionHeadVendors.jsx:176 and ProductionManagerDashboard.jsx:579 (via externalMovements.js:67) — no shared cache.
- NotificationBell: every realtime INSERT calls `fetchNotifications` which runs `getNotifications` **and then** `getUnreadCount` serially (NotificationBell.jsx:95–102) — two round trips per event; count could be derived or run in parallel.
- `fetchComponentByBarcode` (barcodeService.js:1079) re-fetched multiple times per scan flow across ScanStation's 7 call sites; `resolveFullBarcode` (:1065) and the fallback in `fetchComponentByBarcode` (:1102) run the **same leading-wildcard ilike** twice for one prefix-less input.
- Role/identity: no role in AuthContext ⇒ every dashboard does its own `auth.getUser()` (network) + `salesperson` lookup on mount (b2bRoleGuard.js:35/46 for B2B; screens inline for others). The same salesperson row is re-read on each navigation.
- Across dashboards: ~18 dashboards each download the full `orders` table on mount with no shared cache; navigating CEO → COO → GM downloads 10k orders (with `items`) three times.
- `labelTemplate.saveLabelTemplate` re-reads after write (labelTemplate.js:185) — intentional RLS verification, fine.
- `ensureOrderComponents` (barcodeService.js:1324) selects `*` of the order's components; fine (callers need rows).

#### 3e. Polling / intervals / realtime (whole `src/`)
| Location | What | Cost |
|---|---|---|
| components/UpdateBanner.jsx:42 | `setInterval(check, CHECK_MS)` (5 min) + `visibilitychange`/`focus` (44–45) fetching `/version.json` | static file, cheap |
| components/NotificationBell.jsx:119–137 | `supabase.channel("notifications-realtime").on("postgres_changes", {INSERT, notification_recipients, filter recipient_email=eq.<email>})` | Mounted via DashboardHeader on every dashboard. Each INSERT ⇒ 2 queries. Effect deps `[userEmail, fetchNotifications]` and `fetchNotifications` depends on `activeFilter`/`searchTerm` (108), so **the realtime channel is torn down and re-subscribed every time the filter or (debounced, 300 ms) search changes**. Fixed channel name — two bells in one tab would collide. |
| screens/StockRoom/StockRoom.jsx:178 | `setInterval` 60 s → if visible & >4.5 min stale, `syncFromShopify` → stockRoomShopify.js:134 one `shopify-inventory` edge call **per LXRTS product** (+ per-variant `product_variants` updates at :139), then full catalogue reload (StockRoom.jsx:106) | heaviest poller |
| screens/OtpDialogBox.js:25 | 1 s countdown timer | UI only |
| hooks/useBarcodeScanner.js:153 | document keydown capture listener (not polling); re-attaches when caller's `onScan` identity changes (deps line 160) | negligible |
| context/AuthContext.js:13 | `onAuthStateChange` — sets a new `user` object on every event incl. TOKEN_REFRESHED; OrderHistory.jsx:523 has `user` in effect deps ⇒ **refetches on each token refresh (~hourly) / tab re-focus** | minor |

No other `setInterval`, `.channel(`, or `postgres_changes` in `src/`.

#### 3f. Index notes (from db/, verify against live `pg_indexes`)
Found: `orders(order_no text_pattern_ops)`, `orders(is_b2b,is_stock_order)`, `orders(exhibition_id)`, `orders(production_head_designation)`, `orders(is_comms) partial`, `order_components(order_id)`, `order_components(channel_key)`, `qc_records(channel_key, created_at DESC)`, `external_movements(component_id)`.
Not found in db/ for columns hit by in-scope queries: `order_components.barcode` trigram (the `%-x` ilike at :1065/:1102 is a seq scan regardless of a btree), `qc_records(inspected_by)`, `qc_records(order_id)`, `qc_records(component_id)`, `stage_transitions(scanned_at)`, `stage_transitions(component_id)`, `notification_recipients(recipient_email, read)`, `orders(created_at)`, `orders(salesperson_email)`. May exist only in live DB (see memory note on live-only objects).

---

### 4. Client, caching, auth context

- **Client creation:** single `createClient(supabaseUrl, supabaseKey)` at `src/lib/supabaseClient.js:8`, exported as `supabase`, no options (default auth persistence, no `db.schema`, no global fetch/timeout). Config from `src/config/config.js:1–4` (`REACT_APP_SUPABASE_URL/KEY`). Imported directly by every module; no second client found.
- **Caching/state libs:** none. `package.json` has no react-query / @tanstack/query / swr / redux / zustand / jotai / recoil. No in-memory cache layer in utils either — every call hits the network.
- **AuthContext** (`src/context/AuthContext.js`): state `user`, `loading` only (7–8). Subscribes to `onAuthStateChange` (13–18), then `getSession()` (23). Provider value `{ user, loading }` (42) — not memoized (fine; provider only re-renders on its own state). No role, profile, salesperson row, or email normalization. Only 6 consumers of `useAuth()` (PrivateRoute + 5 screens); dashboards bypass it and call `supabase.auth.getUser()` themselves.
- `src/index.js:9` sets `window.Buffer = Buffer` (imports `buffer` polyfill eagerly at :1) for the PDF libs, although the PDF stack is now lazy — the polyfill ships in the main bundle anyway.

---

### 5. Code splitting & bundle weight

- **App.js uses `React.lazy` for every route** (App.js:1, 9–52: 44 lazy screens) inside a single `<Suspense fallback={routeFallback}>` (74). Eagerly imported: only `UpdateBanner`, `PrivateRoute`, `ErrorBoundary` (3–5). Main chunk = router + supabase-js + AuthContext + those 3 + `buffer`.
- **pdfLazy facade exists:** `src/utils/pdfLazy.js:7–23` wraps all six `pdfUtils` exports with `await import("./pdfUtils")`. Verified: **no file other than pdfLazy.js imports `pdfUtils`**, and nothing outside `pdfUtils.js` imports `@react-pdf/renderer`, `src/pdf/*`, or `barcodeImageUtils` (jsbarcode). So `@react-pdf/renderer` + `jsbarcode` + the three PDF components + `logo-pdf.png` load only on first PDF action. ✔
- Heavy deps (package.json):
  - `@react-pdf/renderer ^4.3.1` — heaviest; lazy via pdfLazy ✔.
  - `pdf-lib ^1.17.1`, `@pdf-lib/fontkit ^1.1.1` — **dead**: only `src/pdf/pdfHelpers.js:1` and `pdfTheme.js:1` import pdf-lib, and neither file is imported by anything; fontkit is imported nowhere. Not bundled (tree-shaken), but removable deps. `src/pdf/index.js` barrel is also imported by nothing.
  - `jsbarcode ^3.12.3` — only `utils/barcodeImageUtils.js:1`, reached only via pdfUtils ⇒ lazy ✔.
  - `recharts ^3.7.0` (large, d3-based) — static import in `components/B2B/ProductionManagerDashboard/ProductionManagerDashboard.jsx:41` only; that screen is a lazy route ⇒ isolated to its chunk ✔.
  - `libphonenumber-js` — static in `screens/OtpVerification.js:11` (lazy route) ✔.
  - `react-signature-canvas` — static in `screens/ReviewDetail.js:5` (lazy route) ✔.
  - `xlsx` — **not a dependency** (not in package.json).
  - `@testing-library/*` are in `dependencies` rather than `devDependencies` (not bundled unless imported; hygiene only).
  - `buffer` — eager in index.js (see §4).
- `src/utils/barcodeService.js` (1,803 lines, constants + 40 functions) is statically imported by most dashboards; it has no heavy deps (imports only supabaseClient, fetchAllRows, stockProductionHead), so it just duplicates into shared chunks — fine.

---

### Top items (ranked by impact at 10k+ orders)
1. ~18 dashboards `fetchAllRows("orders", select("*"))` unscoped on mount — 10 serial pages × full `items` JSONB each; no cache between dashboards. (Screens; outside this part's scope but driven by the utils pattern.)
2. `fetchAllRows` is sequential offset paging with caller-controlled (often missing / non-unique) ordering, and its `< PAGE_SIZE` stop condition silently truncates if server max-rows < 1000 (fetchAllRows.js:35).
3. Whole-table downloads then JS filtering in utils: `fetchAllMovements` (+ 100-id serial order loop), `fetchStageOverrides`, `fetchQcRecords({paged:true})` at CEO/COO page load.
4. Serial chunk loops keyed by order ids in qcHistory.js:53 / reJourneys.js:43 & :82 where an indexed `channel_key` filter already exists.
5. N+1 writes/reads: walkinConversion.js:79 (on page load), notificationService.js:413 loop, restoreOrderInventory.js:33 loop.
6. NotificationBell realtime re-subscribes on every filter/search change; 2 queries per event.
7. Leading-wildcard `ilike` on order_components.barcode (barcodeService.js:1065, :1102) — seq scan, twice per prefix-less scan.
8. Dead code: fetchOrderShipments, fetchQcHistory, fetchComponentStats, fetchActiveExhibitions, pdfHelpers/pdfTheme/pdf/index.js; unused deps pdf-lib, @pdf-lib/fontkit.

---

## Appendix B — performance audit of retail and exec screens (read-only)

Scope: OrderHistory, AssociateDashboard, ReviewDetail, ProductForm, OrderDetails, CustomerDetailForm, SALogin, OtpVerification, OtpDialogBox, WalkInTab, Admin/Ceo/COO/GM/StoreManager/Accounts/Accountant/AssistantCmo/CeoAssistant/HeadOfDesign/Retail/WalkIn dashboards, OrderPlaced, pages/OrderDetailPage, plus child components one level down.
All paths are relative to `src/`. Assumed volumes: orders ≈ 10k, order_components ≈ 30–50k, products_live ≈ 1–3k (ProductForm's comment says "catalog exceeds 1000").

### 0. How `fetchAllRows` behaves (`utils/fetchAllRows.js`)
- It is a **sequential** `while` loop of `.range(from, from+999)`. 10k orders take **10 round trips, one after another**. `Promise.all` in the callers only parallelises across tables, never across pages.
- It has no stable tiebreak. Every dashboard orders by `created_at` alone, and `ProductForm.js:1385` has **no `.order()` at all**. Offset paging on a non-unique or absent sort key can duplicate or skip rows at page boundaries. This is a correctness risk as well as a cost.
- Every "full-table download" below is this helper, so load time grows linearly with order count.

---

### 1. Tables read per screen

| Screen | Tables / RPCs read |
|---|---|
| AdminDashboard | salesperson (x2), orders, products_live, vendors, profiles, sa_monthly_targets (tab), product_variants (LXRTS tab), edge fn shopify-inventory (per LXRTS product). Children: StockPanel → product_channel_stock, warehouses, warehouse_stock+products, consignment_inventory, products_live; WalkInsView → walkins; OverrideHistory → stage_overrides; DashboardHeader/NotificationBell → notification_recipients (x2) + realtime |
| CeoDashboard | salesperson (x2), orders, products_live, vendors, consignment_inventory, qc_records (all, paged), product_variants + shopify-inventory (LXRTS). Children: StockPanel, ExhibitionApprovals → exhibitions (x2), NotificationBell |
| COODashboard | salesperson (x2), orders, products_live, vendors, consignment_inventory, qc_records (all), order_components (all), product_variants + shopify-inventory. Children: StockPanel, VendorApprovals → production_vendors (x2), FactoryPause → factory_pause, NotificationBell |
| GMDashboard | salesperson (x2), orders, products_live, vendors, consignment_inventory, product_variants + shopify-inventory. Children: StockPanel, ExhibitionApprovals, OverrideHistory, NotificationBell |
| StoreManagerDashboard | salesperson (x2), orders (ALL stores), products_live, product_variants + shopify-inventory. Children: StockPanel, StoreCalendarTab (no queries), NotificationBell |
| RetailManagerDashboard | salesperson, orders, vendors, order_components (all, Production tab). Children: StockPanel, ProductionOverview/StageCountCards (pure), NotificationBell |
| AssistantCmoDashboard | salesperson, orders (23 cols incl. items), products_live, profiles, consignment_inventory. Children: WalkInsView → walkins + salesperson, StockPanel, NotificationBell |
| CeoAssistantDashboard | salesperson (x2), orders |
| HeadOfDesignDashboard | salesperson, orders, vendors |
| AccountantDashboard | salesperson, orders |
| AccountsDashboard | salesperson, orders |
| WalkInDashboard | salesperson (x2), orders (4 cols), WalkInsView → walkins |
| AssociateDashboard | salesperson, sa_monthly_targets, orders (own, or ALL for sa_services), draft_orders, profiles (x2), order_components (per order on expand), order_payments, shipments. RPCs: recalc_order_total_paid, mark_shipment_delivered. Children: WalkInTab, StockPanel, ExhibitionPanel → exhibitions + orders, ProductionHeadVendors → production_vendors (x2), external_movements + orders; DeliveryPaymentModal → shipments/order_components/order_payments |
| WalkInTab | walkins (own SA), orders (delivery_phone of ALL orders) |
| OrderHistory | colors, salesperson, orders (per customer), profiles, customer_measurements(+orders), draft_orders. RPC get_production_head_email (action) |
| pages/OrderDetailPage | orders (by id), orders (alterations by parent_order_id), order_components (ensureOrderComponents, action) |
| ProductForm | products_live + product_extra_prices, colors, dupatta_colors, customer_measurements, extras, product_variants (per selected product), comms_inventory_blocks, salesperson, draft_orders, edge fn shopify-inventory |
| ReviewDetail | salesperson (up to 4x), RPC order-no generator, orders (dup-check + insert), order_components (insert), draft_orders, customer_measurements, profiles, product_variants / products (per item), shopify-inventory |
| OrderDetails | profiles, discount, external pincode API |
| CustomerDetailForm | profiles (upsert) |
| SALogin | salesperson, profiles |
| OtpVerification | profiles (by phone) |
| OtpDialogBox / OrderPlaced | auth only |

---

### 2. Every Supabase call

Legend: **Mount** = fires on page load (mount effect). **Tab** = fires when a tab first opens. **Action** = fires on a user action. FT = full-table download.

#### AdminDashboard/AdminDashboard.jsx (3979 lines)
| File:line | Table/RPC | Columns | Filters/order | Paged? | FT? | When |
|---|---|---|---|---|---|---|
| 317 | salesperson | 7 cols | eq email, single | n/a | no | Mount (runs first, sequentially) |
| 377 | **orders** | **`*`** | order created_at | fetchAllRows | **YES (~10k rows incl. items JSONB)** | Mount |
| 381 | products_live | `*` | order name | fetchAllRows | YES | Mount |
| 382 | salesperson | 10 cols | none | no (1000 cap) | yes (small) | Mount |
| 383 | vendors | `*` | none | no | yes | Mount |
| 386 | profiles | id, full_name, phone, email, created_at | none | fetchAllRows | **YES (all customers)** | Mount |
| 446 | sa_monthly_targets | 4 cols | or(5 year/month pairs) | no | no | Tab sa_targets |
| 484 / 496 | sa_monthly_targets | delete / upsert | by email+y+m | n/a | no | Action |
| 531 | orders | update | eq id | n/a | no | Action |
| 893 | products | update inventory | eq id | n/a | no | Action |
| 909 + 918 / 923 | edge fn shopify-inventory, then product_variants (size, inventory) | | eq product_id | **one per LXRTS product** | no | Tab inventory/brand_performance (effect 1813) |
| 939 | product_variants | update | product_id+size | n/a | no | Action |
| 1119 | orders | update status | eq id | n/a | no | Action |
| 1137 / 1161 | salesperson | update | eq id | n/a | no | Action |

#### CeoDashboard/CeoDashboard.jsx (3127 lines)
| File:line | Table/RPC | Columns | Filters/order | Paged? | FT? | When |
|---|---|---|---|---|---|---|
| 307 | salesperson | role check | eq email | n/a | no | Mount (sequential, first) |
| 329 | **orders** | **`*`** | order created_at | fetchAllRows | **YES**, is_comms then filtered in JS (343) | Mount |
| 333 | products_live | `*` | order name | fetchAllRows | YES | Mount |
| 334 | salesperson | 7 cols | none | no | yes | Mount |
| 335 | vendors | `*` | none | no | yes | Mount |
| 336 | consignment_inventory | `*` | none | **no (silent 1000 cap)** | yes | Mount |
| 341 → qcHistory.js:66-83 | qc_records | QC_RECORD_COLUMNS (16) | order created_at | own paged loop | **YES (all QC history)** | Mount |
| 660 | products | update | | | | Action |
| 685 / 690 | product_variants | size, inventory | eq product_id | per LXRTS product | no | Tab (effect 1541) |
| 706, 892 | product_variants / orders | update | | | | Action |

#### COODashboard/COODashboard.jsx (1081 lines)
| File:line | Table/RPC | Columns | Filters/order | Paged? | FT? | When |
|---|---|---|---|---|---|---|
| 144 | salesperson | role, saleperson | eq email | | no | Mount (sequential) |
| 160 | **orders** | **`*`** | order created_at | fetchAllRows | **YES**, comms filtered in JS (175) | Mount |
| 164 | products_live | `*` | order name | fetchAllRows | YES | Mount |
| 165 | salesperson | 7 cols | none | no | yes | Mount |
| 166 | vendors | `*` | | no | yes | Mount |
| 167 | consignment_inventory | `*` | | no | yes | Mount |
| 172 | qc_records | 16 cols | | paged loop | **YES** | Mount |
| 173 | **order_components** | id, order_id, current_stage, is_rework, is_active | none | fetchAllRows | **YES (~30–50k rows, 30–50 sequential pages)** | Mount |
| 207 / 212 | product_variants | size, inventory | per LXRTS product | N+1 | | Tab (effect 721) |
| 697 | orders | update | | | | Action |

#### GMDashboard/GMDashboard.jsx (1631 lines)
| File:line | Table/RPC | Columns | Filters | Paged? | FT? | When |
|---|---|---|---|---|---|---|
| 208 | salesperson | 7 cols | eq email | | | Mount (seq) |
| 270 | **orders** | **`*`** | order created_at | fetchAllRows | **YES** (comms filtered JS 279) | Mount |
| 274 | products_live | `*` | | fetchAllRows | YES | Mount |
| 275 / 276 / 277 | salesperson / vendors `*` / consignment_inventory `*` | | none | no | yes | Mount |
| 311 / 316 | product_variants | per LXRTS product | N+1 | | | Tab (effect 886) |

#### StoreManagerDashboard/StoreManagerDashboard.jsx (1904 lines)
| File:line | Table/RPC | Columns | Filters | Paged? | FT? | When |
|---|---|---|---|---|---|---|
| 137 | salesperson | 7 cols | eq email | | | Mount (seq) |
| 202 | **orders** | **`*`** | order created_at, **no store filter** | fetchAllRows | **YES: downloads every store's orders, then keeps only own store in JS at 273-279** | Mount |
| 206 | products_live | `*` | | fetchAllRows | YES | Mount |
| 207 | salesperson | 7 cols | | no | yes | Mount |
| 239 / 244 | product_variants | per LXRTS product | N+1 | | | Tab (effect 883) |

#### RetailDashboard/RetailManagerDashboard.jsx (1698 lines)
| File:line | Table/RPC | Columns | Filters | Paged? | FT? | When |
|---|---|---|---|---|---|---|
| 195 | salesperson | role | eq email | | | Mount (seq) |
| 216 | **orders** | **`*`** | order created_at | fetchAllRows | **YES** (comms filtered JS 219) | Mount |
| 217 | vendors | 4 cols | | no | yes | Mount |
| 234 | **order_components** | 14 cols | **none** | fetchAllRows | **YES**: all history, then filtered to outstanding retail orders in JS (631-643) | Tab production (lazy, once) |

#### AssistantCmoDashboard/AssistantCmoDashboard.jsx (1657 lines)
| File:line | Table/RPC | Columns | Filters | Paged? | FT? | When |
|---|---|---|---|---|---|---|
| 115 | salesperson | 7 cols | eq email | | | Mount (seq) |
| 188 | orders | 23 cols **incl. `items`** | order created_at | fetchAllRows | **YES** (comms filtered JS 197) | Mount |
| 191 | products_live | **`*`** | | fetchAllRows | **YES, used only for `.length` and a sync_enabled count (878, 887)** | Mount |
| 194 | profiles | 7 cols | | fetchAllRows | **YES** | Mount |
| 195 | consignment_inventory | `*` | | no | yes | Mount |

#### CeoAssistantDashboard (668) / HeadOfDesignDashboard (629) / AccountantDashboard (758) / AccountsDashboard (558)
| File:line | Table/RPC | Columns | Filters | Paged? | FT? | When |
|---|---|---|---|---|---|---|
| CeoAssistant:70 | salesperson | role check | eq email | | | Mount (seq) |
| CeoAssistant:91 | **orders** | **`*`** | order created_at | fetchAllRows | **YES** | Mount |
| CeoAssistant:92 | salesperson | 5 cols | | no | yes | Mount |
| HOD:120 | salesperson | | eq email | | | Mount (seq) |
| HOD:133 | **orders** | **`*`** | | fetchAllRows | **YES** | Mount |
| HOD:134 | vendors | 4 cols | | no | yes | Mount |
| Accountant:131 | salesperson | role, saleperson | eq email | | | Mount (seq) |
| Accountant:143 | **orders** | **`*`** | | fetchAllRows | **YES** | Mount (after role check, not parallel) |
| Accounts:67 | salesperson | role | eq email | | | Mount (seq) |
| Accounts:36 | **orders** | **`*`** | order created_at, then **re-sorted in JS by regex-parsed order_no (43-49)** | fetchAllRows | **YES** | Mount |

#### WalkInDashboard/WalkInDashboard.jsx (112) + components/WalkInsView/WalkInsView.jsx
| File:line | Table/RPC | Columns | Filters | Paged? | FT? | When |
|---|---|---|---|---|---|---|
| WalkInDashboard:40 | salesperson | role | eq email | | | Mount (seq) |
| WalkInDashboard:66 | orders | id, delivery_phone, delivery_name, created_at | | fetchAllRows | **YES (only to build a phone Set)** | Mount |
| WalkInDashboard:69 | salesperson | email, store_name | | no | yes | Mount |
| WalkInsView:49 | salesperson | email, store_name | only if host didn't pass it (AssistantCmo:1630 doesn't) | no | yes | Mount of view |
| WalkInsView:63 | walkins | 11 cols | order created_at | fetchAllRows | **YES (all SAs)** | Mount of view; **re-runs whenever the `orders` prop identity changes (dep at 79)** |
| walkinConversion.js:79-85 | walkins | update converted | eq id | **one awaited UPDATE per mismatched row, sequential** | | Mount of view (inside reconcileConversions) |

#### AssociateDashboard.js (2297 lines)
| File:line | Table/RPC | Columns | Filters | Paged? | FT? | When |
|---|---|---|---|---|---|---|
| 380 | auth.getUser | | | | | Mount step 1 |
| 388 | salesperson | `*` | eq email single | | | Mount step 2 (seq) |
| 419 | sa_monthly_targets | 3 cols | email + or(year/month), limit 1 | | no | Mount step 3 (seq) |
| 456 | **orders** | 36 cols incl. `items`, `attachments` | eq salesperson_email (**none for sa_services**) | fetchAllRows | Regular SA: own orders only. **sa_services: YES, ALL ~10k** | Mount step 4 (seq) |
| 473 | draft_orders | customer_id | eq salesperson_email | no | no | Mount step 5 (seq) |
| 481 | profiles | 6 cols | in(id, draftCustomerIds) | no | no | Mount step 6 (seq) |
| 357 | profiles | email, gender, dob | **in(email, every client email), unchunked** | no | no | Mount step 7 (seq). A long-tenured SA has hundreds of clients, so the URL length can blow up |
| 325 | order_components | 9 cols | eq order_id | | no | Action (expand; cached in map) |
| 562 | salesperson | can_place_stock_orders | eq email | | | Action |
| 630 / 824 / 1014 / 1094 | orders | update | eq id | | | Action |
| 693 | orders | **`*`** single | eq id | | | Action (refreshOrderRow merges full row into list state) |
| 768 / 896 | order_payments | insert | | | | Action |
| 831-836 → barcodeService.js:990 | RPC mark_shipment_delivered | | | **awaited in a for-loop, one per shipment** | | Action |
| 841 | RPC recalc_order_total_paid | | | | | Action |

#### WalkInTab.jsx (365 lines)
| File:line | Table/RPC | Columns | Filters | Paged? | FT? | When |
|---|---|---|---|---|---|---|
| 68 | walkins | `*` | eq sa_email, order created_at | fetchAllRows | own only | Mount |
| 73 | **orders** | delivery_phone | **none** | fetchAllRows | **YES: all 10k orders (10 sequential pages) to build a phone Set** | Mount |
| 81 → walkinConversion.js:79 | walkins | update | per row | **sequential N+1** | | Mount |
| 162 | walkins | insert | | | | Action |

#### OrderHistory.jsx (2476 lines)
| File:line | Table/RPC | Columns | Filters | Paged? | FT? | When |
|---|---|---|---|---|---|---|
| 386 | colors | name, hex | order name | no | small | Mount |
| 428 | salesperson | designation | eq email | | | Mount |
| 449 / 496 | orders | `*` | eq user_id or delivery_email. **The SA-email restriction is applied in JS at 500** | no | per-customer | Mount (SA mode) |
| 456 / 475 | profiles | `*` | eq id / email | | | Mount (seq) |
| 464 / 486 | customer_measurements | `*, orders(order_no)` | eq customer_id | | | Mount (seq) |
| 508-510 | orders `*`, profiles `*`, customer_measurements | | eq user_id | | | Mount (customer mode, Promise.all) |
| 539 | draft_orders | `*` | eq customer_id | | | Mount |
| 700 | RPC get_production_head_email | | | | | Action |
| 882, 895, 901, 972, 987, 1049, 1312 | orders / profiles | update | eq id | | | Action |
| 1079 | draft_orders | delete | | | | Action |
| 1331 | orders | `*` single | eq id | | | Action |

#### pages/OrderDetailPage.jsx (851 lines)
| File:line | Table/RPC | Columns | Filters | When |
|---|---|---|---|---|
| 166 | orders | `*` single | eq id | Mount |
| 176 | orders | `*` | parent_order_id + is_alteration. **Awaited after 166; could run in parallel** | Mount |
| 340 | orders | insert | | Action |
| 355 → barcodeService ensureOrderComponents | order_components | select + insert | eq order_id | Action |

#### ProductForm.js (4339 lines)
| File:line | Table/RPC | Columns | Filters | Paged? | FT? | When |
|---|---|---|---|---|---|---|
| 1385 | products_live | **`*, product_extra_prices(*)`** | **no order (unstable paging); sorted in JS at 1397-1401** | fetchAllRows | **YES (whole catalogue + nested prices)** | Mount |
| 1416 | colors | name, hex | order name | | | Mount |
| 1435 | dupatta_colors | name | | | | Mount |
| 1454 | customer_measurements | `*` | eq customer_id, limit 1 | | | Mount |
| 1484 | extras | 3 cols | | | | Mount |
| 1525 + 1549 / 1575 | edge fn shopify-inventory + product_variants `*` | | eq product_id | | | On product select (effect 1503) |
| 1966 / 1985 / 1992 | comms_inventory_blocks, product_variants | | limit 1 | | | Action (add product; 3 sequential) |
| 2387 / 2406 | storage attachments | | | | | Action |
| 2445 | salesperson | 2 cols | | | | Action |
| 2515 / 2533 | draft_orders | update / insert | | | | Action |

#### ReviewDetail.js (1321 lines): every call runs in `processOrderWithSignature` (Action), in a long sequential chain
| File:line | Table/RPC | Notes |
|---|---|---|
| 302, 320, 399, 491 | salesperson | Up to 4 separate single-row reads of the same SA row |
| 521 | RPC (order-no generator, p_store) | |
| 545 | orders | id, order_no, grand_total, items. Dup-check within the last 30s, limit 3 |
| 582 | orders | insert `.select()` |
| ~607 → barcodeService:1295 | order_components | bulk insert (fine) |
| 622 | draft_orders | delete |
| 710 / 739 | customer_measurements insert / profiles update | |
| **801-885 loop** | product_variants select (811) + update (829) + shopify-inventory fetch (842), or products select (869) + update (879) | **N+1, awaited per line item, and a non-atomic read-modify-write on inventory (race between two SAs)** |
| 936 | storage signature upload | |

#### Small screens
| File:line | Table/RPC | Cols | When |
|---|---|---|---|
| OrderDetails.js:387 | profiles | `*` eq id | Mount |
| OrderDetails.js:867 | discount | code, percent ilike limit 1 | Action |
| CustomerDetailForm.js:126 | profiles | upsert | Action |
| SALogin.js:51 | salesperson | role | Action (login) |
| SALogin.js:110/118/126 | profiles | 3 cols | Action |
| SALogin.js:135 | salesperson | `name, store` (these columns don't match `saleperson`/`store_name` used everywhere else, so verify they exist) | Action |
| OtpVerification.js:129 | profiles | `*` eq phone single (needs an index on profiles.phone) | Action |
| OtpDialogBox.js:25 | setInterval 1s | never cleared when the timer hits 0 (cheap: setState(0) bails out) | Mount |
| OrderPlaced.jsx:40 | auth.setSession only | | Mount |

#### Shared children (one level down)
| File:line | Table | Cols | Paged/FT | When |
|---|---|---|---|---|
| stock/StockPanel.jsx:117 | product_channel_stock | 3 | fetchAllRows, FT | Stock tab mount |
| StockPanel.jsx:125-126 | warehouses; warehouse_stock + products(name, sku_id) | | FT | Stock tab |
| StockPanel.jsx:133 | consignment_inventory | 4 qty cols | FT, then summed in JS (180-192). A DB SUM could do this | Stock tab |
| StockPanel.jsx:202-212 | products_live | id, name, sku_id `.in(200)` | **sequential awaited chunk loop** | Stock tab |
| OverrideHistory.jsx:48 → barcodeService:1730 | stage_overrides | `*` | fetchAllRows FT, filtered/paged in JS | Tab |
| ExhibitionApprovals.jsx:52 | exhibitions | `*` x2 (pending + all; pending is a subset of all) | no | Tab |
| VendorApprovals.jsx → barcodeService:1446/1487 | production_vendors | `*` x2 (same redundancy) | no | Tab |
| FactoryPause.jsx → barcodeService:1396 | factory_pause | `*` limit 1 | | Tab |
| ExhibitionPanel.jsx:54 / 60 | exhibitions; orders 12 cols in(exhibition_id) | fetchAllRows | | Tab (SA) |
| ProductionHeadVendors.jsx:155 | production_vendors x2 | | | Tab (SA vendors) |
| ProductionHeadVendors.jsx:175 → barcodeService:1607-1631 | external_movements (FT) + orders chunked 100 (**sequential loop**) | | FT | Action (History tab click) |
| DeliveryPaymentModal.jsx:59-64 | shipments, order_components, order_payments | eq order_id, Promise.all | | Modal open |
| DashboardHeader → NotificationBell.jsx:91-108 | notification_recipients list (limit 50) + exact count (head) | | | Mount of **every** dashboard, plus a realtime channel (116-138) that re-subscribes whenever filter/search changes `fetchNotifications` identity |

---

### 3. Flags

#### 3a. `select('*')` on orders (with the heavy `items` JSONB), full table
- AdminDashboard.jsx:377
- CeoDashboard.jsx:329
- COODashboard.jsx:160
- GMDashboard.jsx:270
- StoreManagerDashboard.jsx:202
- RetailManagerDashboard.jsx:216
- CeoAssistantDashboard.jsx:91
- HeadOfDesignDashboard.jsx:133
- AccountantDashboard.jsx:143
- AccountsDashboard.jsx:36

That is **10 screens** loading every column of every order.
- AssistantCmoDashboard.jsx:188 and AssociateDashboard.js:456 trim the column list, but both still pull `items`.
- The comment at AssistantCmo:172-175 records that `select("*")` cost "~1.6 MB and 40s+" even at the earlier (smaller) row count.
- Per-row `*` on single orders is acceptable: OrderHistory 449/508/1331, OrderDetailPage 166/176, AssociateDashboard 693.

#### 3b. Other full-table downloads
- products_live `*`:
  - Admin:381, Ceo:333, COO:164, GM:274, StoreManager:206, AssistantCmo:191 (only used for two counts), ProductForm:1385 (with nested product_extra_prices)
  - StockExchangeTab:56 / WarehouseTab:49 (slim columns)
- profiles: Admin:386, AssistantCmo:194. Each builds a "client book" that is sliced to one page in JS.
- order_components: COO:173 (mount), Retail:234 (tab), with no stage/active filter.
- qc_records (all history): Ceo:341, COO:172.
- orders just for a phone set: WalkInTab:73, WalkInDashboard:66. An RPC or `exists` join on walkins.phone ↔ orders.delivery_phone could do this.
- walkins (all SAs): WalkInsView:63. stage_overrides: OverrideHistory. external_movements: ProductionHeadVendors (History).
- consignment_inventory without paging (Ceo:336, COO:167, GM:277, AssistantCmo:195). Truncates silently past 1000 rows.

#### 3c. Work done in JS that the DB could do
- **Comms exclusion after download.** `.filter(o => !o.is_comms)` runs at Ceo:343, COO:175, GM:279, StoreManager:209, Retail:219, AssistantCmo:197, CeoAssistant:94, HOD:136, Accountant:146. Admin keeps comms but splits at 664. Replace with `.eq("is_comms", false)`.
- **Store scoping after download.** StoreManager:273-279 downloads all stores and keeps its own; use `.ilike/eq("salesperson_store", …)`. OrderHistory:500 filters by SA email in JS; add `.eq("salesperson_email")`.
- **Retail production tab.** Retail:631-643 downloads every component ever and keeps outstanding ones. Filter by `is_active`, or by `order_id in (outstanding)`, or use an RPC.
- **Counts only.**
  - AssistantCmo:878/887 counts products; use `count:'exact', head:true`.
  - Admin:2605 and 2610 run `products.filter(p=>p.sync_enabled).length` twice inline per render.
  - `orderTabCounts` (Admin:1035, Ceo:811, COO:683, GM:816, StoreManager:588, Retail:765, AssistantCmo:650) is 5–7 filter passes over all orders. Ceo and Retail recompute it on every search keystroke (deps include orderSearch).
- **Sums.** StockPanel:180-192 sums consignment in JS. All KPI and revenue stats on every exec dashboard are JS reductions over 10k orders: dashboardStats, analyticsData, financialStats, targetsData, b2bStats, storePerformanceStats, clientAnalytics, and so on. They are candidates for SQL views or RPCs with a date range.
- **Sort.**
  - Accounts:43-49 re-sorts all orders with a regex parser.
  - The `filteredOrders` comparators run a regex **inside** the comparator (`getOrderNum`): Admin, Ceo:789-803, COO, GM, StoreManager, Retail, AssistantCmo, Accounts. That is O(n log n) regex runs, about 280k per keystroke at 10k orders, and **no search input is debounced anywhere** (no `debounce` in any of these files).
- ProductForm:1397-1401 sorts the catalogue with localeCompare in JS instead of `.order("name")`. This also fixes the unstable paging.

#### 3d. Queries in loops (N+1 or sequential awaits)
- **LXRTS inventory sync**: one edge-function call per `sync_enabled` product, with a `product_variants` fallback query per product. Found at Admin:904-925 (effect 1813), Ceo:~680-692 (effect 1541), COO:194-214 (effect 721), GM:~305-318 (effect 886), and StoreManager:~233-246 (effect 883). They run in parallel via allSettled, but the fan-out equals the LXRTS product count every time the Inventory tab opens with empty `variantInventory`.
- **walkinConversion.js:79-85**: sequential awaited UPDATE per walk-in whose stored flag disagrees. It runs on every WalkInTab and WalkInsView load, and on every `orders` identity change in WalkInsView.
- **ReviewDetail.js:801-885**: per line item, sequential select, update and edge fetch (order placement latency grows with the number of items; non-atomic).
- **AssociateDashboard.js:831-836**: `markShipmentDelivered` awaited per shipment.
- **AssociateDashboard.js:377-515**: 7 dependent awaits on mount (getUser → salesperson → targets → orders(paged) → drafts → draft profiles → client profiles). Targets, orders and drafts are independent once `spData` is known and could share a Promise.all.
- **StockPanel.jsx:202-212**: sequential chunked `.in()` loop. **qcHistory.js:53-63**: sequential chunk loop, and each chunk is itself subject to the 1000-row cap, which is a silent truncation risk. **barcodeService.js:1632-1636** (fetchAllMovements): sequential orders chunk loop.
- **ReviewDetail.js 302/320/399/491**: the same salesperson row read up to 4 times in one submit.
- **ProductForm.js 1966→1985→1992**: 3 sequential reads per "add product".

#### 3e. Same data fetched by multiple screens or components
- Role check: every dashboard re-queries `salesperson` by email on mount (Admin:317, Ceo:307, COO:144, GM:208, SM:137, Retail:195, ACMO:115, CeoAsst:70, HOD:120, Accountant:131, Accounts:67, WalkIn:40, Associate:388, OrderHistory:428). Many then fetch the **full** salesperson table again (Admin:382, Ceo:334, COO:165, GM:275, SM:207, CeoAsst:92, WalkIn:69, WalkInsView:49). This is a known pattern (CLAUDE.md), but it costs 2 round trips per load.
- Full `orders *`: 10 dashboards (3a). No shared cache, so a user switching dashboards re-downloads everything.
- products_live: 6 dashboards + ProductForm + StockPanel metadata + WarehouseTab + StockExchangeTab.
- vendors `*`: Admin, Ceo, COO, GM; slim in Retail and HOD.
- consignment_inventory: Ceo, COO, GM, ACMO + StockPanel.
- qc_records full: Ceo, COO.
- ExhibitionApprovals:52 and VendorApprovals fetch "pending" and "all" separately, though pending is a subset of all.
- NotificationBell: 2 queries on every dashboard mount.

#### 3f. useEffect dependency issues and polling
- **WalkInsView.jsx:57-79** depends on `[orders]`. Any `setOrders(prev => prev.map(...))` in the host (Admin:1121 status update, Admin:531 approvals, and similar) creates a new array. If the Walk-Ins tab is mounted, that re-downloads all walkins and re-runs the reconcile UPDATE loop. Key it on something stable, such as the phone-set size or hash.
- **NotificationBell.jsx:116-138**: the realtime channel depends on `fetchNotifications`, which changes with `activeFilter` and `searchTerm`. Each filter change tears down and re-subscribes the channel. It uses a fixed channel name ("notifications-realtime").
- The LXRTS effects (Admin:1813, Ceo:1541, COO:721, GM:886, SM:883) read `variantInventory` without listing it (eslint-suppressed pattern). Harmless, but a `products` change re-evaluates the check.
- `useMemo` deps include a **page index**, so the whole order or profile aggregation reruns on every pagination click: Admin clientAnalytics:1456 (clientsPage), Admin b2bStats:1698 (b2bPage), Admin clientBook:1575 (clientBookPage; profiles × orders index), Ceo clientAnalytics:1185, Ceo b2bStats:1294, GM b2bStats:579, GM inventoryStats:630 (inventoryPage + orders), COO inventoryStats:569 (inventoryPage), SM clientBook:819 (clientPage), ACMO clientBook:834 (clientsPage). Split them into an aggregate memo and a page-slice memo.
- `orderTabCounts` deps include search, filters and period (Ceo:817, Retail:771), so a full pass runs per keystroke.
- ProductForm.js:3491-3497 builds `options` inline each render (filter, filter, map over the whole catalogue). This defeats SearchableSelect's `normalized` useMemo (ProductForm:33-39), so a 1–3k-item array is rebuilt on every render of a 4339-line component.
- Polling: none except OtpDialogBox:25 (1s countdown, benign). No `setInterval` refetches in scope.

---

### 4. Load cost per screen (mount)

"Seq" means hops that must finish before the next begins. Every orders full fetch is 10 sequential pages at 10k rows.

| Screen | Queries on mount | Shape | Approx rows downloaded | In-browser compute on load |
|---|---|---|---|---|
| **COODashboard** | 1 getSession + 1 role + 7 parallel (orders 10 pages, products ~2–3 pages, salesperson, vendors, consignment, qc_records N pages, **order_components 30–50 pages**) + NotificationBell 2 | 2 seq → parallel. **Critical path = order_components ≈ 30–50 sequential round trips** | ~10k orders (full `*`) + ~40k components + all qc_records + ~2k products + small tables. **≈ 55k+ rows** | ~12 memos over orders/components/qc on first render (opsStats, brandStats, qcStats, consignmentStats, inventoryStats, financialStats, filtered/counts). COO is the heaviest |
| **AdminDashboard** | role + 5 parallel (orders 10p `*`, products_live, salesperson, vendors, **profiles all**) + NotificationBell 2 | seq(2) → parallel; path = orders 10 pages | ~10k orders `*` + ~5–10k profiles + ~2k products | ~20 memos (dashboardStats, analyticsData, enhancedAnalytics, clientAnalytics, clientBook [profiles × orders], b2bStats, accountsLineItems [explodes all items], targetsData, financialStats, enhancedInventoryStats…). All evaluate on first render **regardless of active tab** |
| **CeoDashboard** | role + 6 parallel (orders `*`, products, salesperson, vendors, consignment, qc_records all) + bell | seq(2) → parallel; path = max(orders 10p, qc pages) | ~10k orders + all qc_records + ~2k products | ~22 memos, same as Admin plus storePerformanceStats and opsFlags. All tab-independent |
| **GMDashboard** | role + 5 parallel + bell | same | ~10k orders + ~2k products | ~15 memos (storePerformanceStats, dayWiseSales, b2bStats, inventoryStats, returnsAnalytics, accountsLineItems…) |
| **StoreManagerDashboard** | role + 3 parallel + bell | same | **~10k orders (all stores), of which only one store's (~40–50%) are used** + ~2k products | storeOrders filter, then salesStats, saPerformance, returnsStats, inventoryStats, clientBook, alterationStats |
| **AssistantCmoDashboard** | role + 4 parallel + bell | same | ~10k orders (23 cols incl. items) + ~2k products (for 2 counts) + all profiles | overview, brandPerformance, revenueMetrics, productStyle, clientInsights, clientBook |
| **RetailManagerDashboard** | role + 2 parallel + bell (+30–50 pages on Production tab) | same | ~10k orders `*` (+ ~40k components on tab) | retail/b2b split, dashboardStats, dayWiseData, productAnalytics, b2bAnalytics |
| CeoAssistant / HOD / Accountant / Accounts | role + orders (+1 small) | seq(2) → 10 pages | ~10k orders `*` each | 5–8 memos; Accounts adds a regex sort of all orders + line-item explosion (85-172) |
| AssociateDashboard (regular SA) | **7 sequential awaits** + bell | fully sequential | own orders (tens to low hundreds) | light. **sa_services: ~10k orders (36 cols incl. items)**, same load as an exec dashboard, plus client extraction |
| WalkInDashboard | auth + role, then orders (4 cols, 10p) + salesperson, then walkins (N pages) + reconcile UPDATE loop | 3 seq stages | 10k orders (slim) + all walkins | phone-set build; reconcile writes |
| WalkInTab (SA tab) | walkins (own) + **orders delivery_phone 10p** in parallel, then reconcile loop | | 10k phones | Set build |
| ProductForm | 5 parallel mount effects (products_live+extra_prices FT, colors, dupatta_colors, measurements, extras) | parallel; path = products pages | ~2k products with nested price rows | JS sort of catalogue; inline options rebuild each render |
| OrderHistory | ~2–6 small queries (partly sequential in SA mode: profiles → measurements → orders) | | one customer's rows | trivial |
| OrderDetailPage | 2 sequential single-order queries | | 1 + alterations | trivial |
| ReviewDetail (submit) | ~12 + 3×items sequential calls | fully sequential | small | order placement latency, not load |
| OrderDetails / CustomerDetailForm / SALogin / Otp* / OrderPlaced | 0–1 | | 1 row | trivial |

---

### 5. Rendering

- **Component size.** Each of these re-renders wholesale on any state change: ProductForm.js **4339**, AdminDashboard **3979**, CeoDashboard **3127**, OrderHistory **2476**, AssociateDashboard **2297**, OrderDetails **2037**, StoreManager **1904**, Retail **1698**, AssistantCmo **1657**, GM **1631**. They are single function components with dozens of `useState`, and every tab lives in the same component. A keystroke in any input re-renders the whole tree, including the recharts charts that `activeTab` doesn't hide.
- **Main order lists are paginated** (Paginator + slice) on all dashboards. Good.
- **Unpaginated or unvirtualized lists:**
  - AssociateDashboard.js:2184: Client Book table maps `filteredClients` in full. Large for sa_services or long-tenured SAs.
  - AssociateDashboard.js:2108-2118: calendar day list runs `orders.filter(o => formatDate(o.delivery_date) === selected)` **three times per render** over all orders (formatDate per order). The `ordersByDate` memo at 202 already exists but only holds counts. Memoize a date→orders map.
  - WalkInTab.jsx:232: `visibleWalkins.map` renders every walk-in with no Paginator (WalkInsView does paginate).
  - ProductForm → SearchableSelect (ProductForm.js:195): renders **every** matching option (the whole catalogue when the query is empty) with no virtualization or cap.
  - AdminDashboard.jsx:3828 `filteredCommsPending.map` and 3764-3768 `reviewed` (sliced 20): small, fine.
  - StoreCalendarTab.jsx:199: day list, bounded by day. Fine.
- **Inline JSX computation not memoized:**
  - AdminDashboard.jsx:3764-3768: the comms tab filters and sorts all orders inside an IIFE each render.
  - Admin:2605 and 2610: `products.filter(...).length` twice per render.
  - AssociateDashboard.js:2108-2118: see above.
- **Eager memos.** All analytics memos on Admin, Ceo, COO and GM compute on first render and after every `orders` change, even when the user never opens the analytics tabs. Gate them by `activeTab`, or move each tab into its own component so the memos run lazily.
- **Heavy memos on common interactions:** the page-index-in-deps memos listed in 3f, and orderTabCounts/filteredOrders with the regex comparator on every unthrottled keystroke.

---

### Top 5 heaviest screens (by load)
1. **COODashboard**: orders `*` + all order_components (30–50 sequential pages) + all qc_records + products, with ~12 aggregate memos.
2. **AdminDashboard**: orders `*` + all profiles + products; ~20 tab-independent memos, including profiles×orders clientBook; LXRTS N+1 on the inventory tab.
3. **CeoDashboard**: orders `*` + all qc_records + products; ~22 eager memos; per-keystroke tab counts.
4. **GMDashboard / StoreManagerDashboard** (tie): orders `*` for all stores + products. StoreManager throws away the other stores' rows client-side.
5. **AssistantCmoDashboard / RetailManagerDashboard**:
   - AssistantCmo: orders (with items) + all profiles + the full catalogue, used only for 2 counts.
   - Retail: orders `*`, plus the full component table on the Production tab.

Honourable mention: **AssociateDashboard as sa_services** (all orders, 7 sequential mount hops) and **WalkInTab** (10k-order phone scan + N+1 UPDATE loop every time the tab opens).

---

## Appendix C — performance audit of the B2B, Comms, Shopify and EditOrder screens (read-only)

Scope: `src/screens/B2b*/`, `src/screens/B2borderdetails/`, `src/components/B2B/**` (ProductionManagerDashboard), `src/screens/CommsDashboard/**`, `src/screens/ShopifyOrdersDashboard/`, `src/screens/EditOrder/`, plus the child components and utils one level down that run queries.

Assumptions for the estimates: about 10k `orders` in total, B2B about 10–15% (~1–1.5k), Comms a few hundred, Shopify ~1–2k, and `order_components` about 30–50k (3–5 per order). An `orders` row fetched with `select("*")` includes the `items` JSONB, so assume a few KB per row. That makes a full `orders` download tens of MB of JSON.

`fetchAllRows` (`src/utils/fetchAllRows.js:23-39`) runs its `.range()` pages **one after another**, not in parallel: 10k rows means 10 sequential round trips.

---

### 0. Shared utilities that run queries (referenced below)

| Util (file:line) | Table | What it fetches | Notes |
|---|---|---|---|
| `fetchAllRows` fetchAllRows.js:23 | any | every row matching the filter, 1000 per page | Sequential pages. `all.push(...data)` is fine. |
| `enrichComponentsWithMovements` barcodeService.js:1579 (query at :1587) | external_movements | `component_id, stages_outside` `.in(component_id, 500-chunk)` `.eq(status,'exited')` | Only for components with `is_outside_wh`. Chunks run **sequentially**. At 500 UUIDs per chunk the URL is ~18 KB; every other helper chunks at 100–200 because of the URL-length 400 risk. |
| `fetchAllMovements` barcodeService.js:1607 (:1609, :1634) | external_movements (+ embedded order_components), orders | **The whole external_movements table** via fetchAllRows, then `orders(id, created_at, is_b2b, salesperson_store)` in **sequential** `.in()` chunks of 100 | Full-table download plus an N/100 sequential loop. Callers: `fetchExternalMovements` (externalMovements.js:62) and ProductionHeadVendors (:176). Channel and orderId scoping happen **in JS** after the download (externalMovements.js:68-75, ProductionHeadVendors.jsx:179-185). |
| `fetchQcRecords` qcHistory.js:38 | qc_records | `QC_RECORD_COLUMNS`. `orderIds` mode: sequential chunks of 200 (:53-61), then re-sorted in JS. `paged` mode: the **whole table** in sequential 1000-row pages (:69-83), optionally `.eq(outcome)` | The `paged` full-table mode is used by the PM dashboard. |
| `fetchReJourneys` reJourneys.js:37 | order_components, qc_records | `is_rework=true, is_active=true` components (chunked by orderIds :43-50, or paged :57-64), then qc_records `.in(component_id, 200-chunk)` `.eq(outcome,'rework')` (:82-88) | Sequential loops. |
| `fetchScanReport` scanReport.js:28 (:39) | stage_transitions + order_components embed | date-bounded, paged | Runs on user action only (CSV export). |
| `fetchStageOverrides` barcodeService.js:1729 | stage_overrides | `*`, **full table** via fetchAllRows | OverrideHistory tab. |
| `fetchPendingReplacements` barcodeService.js:1362 | replacement_requests | `*` `.eq(status,'pending')` | Small. |
| `fetchAllVendors` / `fetchApprovedVendors` barcodeService.js:1446 / :1435 | production_vendors | `*` / column list | Small. |
| `fetchTransitionHistory` / `fetchMovementHistory` barcodeService.js:1122 / :1564 | stage_transitions / external_movements | per component id | ComponentJourneyModal calls both **once per component** (N×2 queries in Promise.all, ComponentJourneyModal.jsx:79-95). Small N, but still N+1. |
| `checkB2bRole` b2bRoleGuard.js:34 (:45) | auth.getUser + salesperson(`role`) | two sequential calls | Used by Merch, ReviewOrder, OrderDetails, productform, vendorselection. |
| `cancelOrder` cancelOrder.js:65-112 | orders update, rpc cancel_order_components, vendors read-then-write, rpc get_production_head_email | user action | vendors credit is a non-atomic read-modify-write (:96-97). |

---

### 1. Tables read by each screen

| Screen (lines) | Tables read |
|---|---|
| **ProductionManagerDashboard** (4603) | salesperson (×2), **orders (all, `*`)**, vendors, **order_components (all)**, external_movements (enrich + full via fetchAllMovements), qc_records (paged dispose + paged all), colors, order_components (rework), stage_transitions (scan report), stage_overrides, replacement_requests, production_vendors, product_channel_stock / warehouses / warehouse_stock / consignment_inventory / products_live (StockPanel), orders + order_components (ProductionOverrides) |
| **B2bMerchandiserDashboard** (1978) | salesperson (×2), **orders (is_b2b, `*`)**, vendors (×2), size_charts, **order_components (all, every channel)**, external_movements, vendor_contacts, orders (cancel search), plus StockPanel/WarehouseTab/StockExchangeTab tables on their tabs (warehouses, warehouse_stock, products_live, stock_exchanges, …) |
| **B2bProductionDashboard** (1096) | salesperson (×2), **orders (B2B ∪ assigned Comms ∪ head-assigned stock, `*`)**, vendors, **order_components (all, every channel)**, external_movements, qc_records, order_components (rework), production_vendors + external_movements + orders (ProductionHeadVendors) |
| **B2bExecutiveDashboard** (683) | salesperson (×2), orders (own B2B, `*`), vendors |
| **B2bOrderHistory** (456) | salesperson, orders (is_b2b, `*`), vendors |
| **B2bVendorOrders** (320) | salesperson, vendors, orders (vendor_id, `*`) |
| **B2bOrderView** (466) | salesperson, orders (one row), vendors, vendor_contacts |
| **B2bOrderDetails** (305) | salesperson (via checkB2bRole); otherwise sessionStorage only |
| **B2bReviewOrder** (704) | salesperson (×2); on submit: orders, b2b_approvals, rpc generate_order_no, plus ensureOrderComponents |
| **B2bproductform** (943) | salesperson (checkB2bRole), **products_live + product_extra_prices (full catalog, `*`)**, colors, dupatta_colors, extras |
| **B2bvendorselection** (385) | salesperson (checkB2bRole + **whole salesperson table**), vendors (+vendor_contacts, size_charts embed), discount |
| **CommsDashboard** (845) | salesperson, orders (is_comms, `*`), order_components (by order ids), external_movements; child tabs below |
| CommsInventory (587) | **products_live (full)**, **product_variants (full)**, comms_inventory_blocks |
| CommsPRPerformance (468) / CommsReports (296) | comms_pr_performance |
| CommsCalendar (391) | comms_calendar_events |
| CommsSourcingReturns (431) | none on load; on action: orders, product_variants, products |
| CommsOrderCalendar (179) | none (uses the `orders` prop) |
| CommsOrderForm (482) | salesperson |
| CommsReviewOrder (640) | salesperson; on submit: rpc generate_order_no, orders, product_variants, products, draft_orders |
| **ShopifyOrdersDashboard** (2034) | salesperson, orders (SHOPIFY/SHOP prefix, column list incl. `items`), order_components (by ids), external_movements, qc_records, order_components (rework), ProductionHeadVendors tables, qc_records (QcReportModal) |
| **EditOrder** (697) | salesperson; on action: orders (+ cancelOrder util) |

---

### 2. Every Supabase call

Legend: **Mount** means it fires from a mount `useEffect` or a load callback. **Tab** means it loads lazily when a tab opens. **Action** means a user click or submit.

#### ProductionManagerDashboard.jsx (`src/components/B2B/ProductionManagerDashboard/`)

| File:line | Table/RPC | Columns | Filters/order | Paginated? | Full-table? | When |
|---|---|---|---|---|---|---|
| :412 | auth.getUser | – | – | – | – | Mount |
| :418 | salesperson | role | eq email, `.single()` | no | no | Mount (seq) |
| :433 | salesperson | `*` | eq email | no | no | Mount (seq, **second read of the same row**) |
| :442-445 | **orders** | **`*`** | order created_at desc, **no filter** | hand-rolled range loop, sequential | **YES, the entire orders table incl. items** | Mount |
| :472-475 | vendors | id, store_brand_name, vendor_code, location | `.in(id, allB2bVendorIds)` **unchunked** | no | no | Mount (seq) |
| :490-494 | **order_components** | 17 cols | order created_at desc, **no filter** | hand-rolled range loop, sequential | **YES, the entire table (~30–50k)** | Mount (seq) |
| :517 → barcodeService:1587 | external_movements | component_id, stages_outside | in(500-chunk), eq exited | chunked, sequential | no | Mount (seq) |
| :536 → qcHistory:73 | qc_records | QC cols | eq outcome='dispose' | paged | full dispose subset | Mount (parallel effect) |
| :553 → qcHistory:73 | **qc_records** | QC cols | none | paged | **YES, full table** | Tab (production / qc_history), once |
| :565 → reJourneys:60 | order_components (+qc_records :85) | rework cols | is_rework, is_active | paged | rework subset | Tab (rejourneys), **refetches on every visit** (no loaded flag) |
| :579 → externalMovements:68 → barcodeService:1609, :1634 | **external_movements** + orders | see §0 | none | paged + 100-chunk loop | **YES** | **Mount** (default tab is "overview", :249) and Tab (vendors/external); refetches on every overview/subTab change |
| :588 | colors | name, hex | order name | no | small lookup | Mount |
| :954 → scanReport:39 | stage_transitions | list + embed | gte/lte scanned_at | paged | no | Action |
| :2099 | orders | update | eq id | – | – | Action |
| :2103 | orders | `*` | eq id `.single()` | – | – | Action |
| :2124 | orders | update priority | eq id | – | – | Action |
| ProductionOverrides.jsx:89 | orders | id, order_no | `ilike %…%` limit 1 | – | – | Action |
| ProductionOverrides.jsx:274 | order_components | update | eq id | – | – | Action |
| OverrideHistory.jsx:44 → barcodeService:1730 | **stage_overrides** | `*` | order created_at | fetchAllRows | **YES** | Tab (override_log) |
| ReplacementApprovals.jsx:48 → barcodeService:1364 | replacement_requests | `*` | eq pending | no | no | Tab |
| VendorRequest.jsx:30 → barcodeService:1448 | production_vendors | `*` | – | no | yes (small) | Tab |
| StockPanel.jsx:117/125/126/133/204 | product_channel_stock, warehouses, warehouse_stock(+products), consignment_inventory, products_live | lists | – | fetchAllRows | **YES (per pool)** | Tab (stock) |
| ComponentJourneyModal.jsx:79 → barcodeService:1124, :1566 | stage_transitions, external_movements | `*` / list | eq component_id | – | – | Action (2 queries per component) |

#### B2bMerchandiserDashboard.jsx

| File:line | Table/RPC | Columns | Filters/order | Paginated? | Full-table? | When |
|---|---|---|---|---|---|---|
| :156 → b2bRoleGuard:35,:45 | auth + salesperson | role | eq email | – | – | Mount (seq) |
| :171 | salesperson | `*` | eq email | no | no | Mount (Promise.all, **duplicate of the role read**) |
| :173 | **orders** | **`*`** | eq is_b2b, order created_at | fetchAllRows | all B2B (~1–1.5k) | Mount (Promise.all) |
| :174 | vendors | `*` | eq is_active, order name | no (1000 cap risk) | all active vendors | Mount (Promise.all) |
| :175 | size_charts | `*` | eq is_active | no | small | Mount (Promise.all) |
| :184-187 | vendors | id, name, code, location | `.in(id, vendorIds)` unchunked | no | **redundant**: the :174 result already holds these rows (except inactive vendors) | Mount (seq) |
| :204-208 | **order_components** | 11 cols | **no filter** (comment :194-197 says so on purpose), order created_at | hand-rolled range loop, sequential, `all=[...all,...cData]` | **YES, every channel's components (~30–50k) for a B2B-only screen** | Mount (seq) |
| :224 → barcodeService:1587 | external_movements | – | in 500-chunk | seq | no | Mount (seq) |
| :452 | vendors | update starred_by | eq id | – | – | Action |
| :467 / :473 / :479 / :481 | orders update / b2b_approvals update / vendors read / vendors update | – | eq id | – | – | Action (approval; vendors credit is a non-atomic read-then-write) |
| :534 / :539 | vendors insert / vendor_contacts insert | – | – | – | – | Action |
| :584 | vendor_contacts | `*` | eq vendor_id, is_primary, limit 1 | – | – | Action |
| :606 / :612 / :618 | vendors update / vendor_contacts update / insert | – | – | – | – | Action |
| :646 / :649 / :669 | size_charts update / insert / soft-delete | – | – | – | – | Action |
| :729-739 | orders | `*` + vendors embed | `.or(order_no/po/name/merch ilike %…%)` limit 25 | limit | no | Action (cancel search) |
| WarehouseTab.jsx:45,:49,:72 | warehouses, **products_live (full)**, warehouse_stock | – | – | fetchAllRows | yes | Tab |
| StockExchangeTab.jsx:39,:52,:56,:80 | **stock_exchanges (full)**, warehouses, **products_live (full)**, warehouse_stock | – | – | fetchAllRows | yes | Tab |
| StockPanel (see PMD) | | | | | | Tab |

#### B2bProductionDashboard.jsx

| File:line | Table/RPC | Columns | Filters/order | Paginated? | Full-table? | When |
|---|---|---|---|---|---|---|
| :133 | auth.getUser | | | | | Mount |
| :140 | salesperson | role | eq email `.single()` | | | Mount (seq) |
| :166 | salesperson | `*` | eq email | | | Mount (Promise.all, duplicate) |
| :182-185 | **orders** | **`*`** | `.or(is_b2b, comms_order_assign ×2, production_head_designation)`, order created_at | fetchAllRows | B2B + assigned (~1.5k) | Mount (Promise.all) |
| :229-232 | vendors | 4 cols | in(vendorIds) unchunked | no | no | Mount (seq) |
| :250-254 | **order_components** | 17 cols | **no filter** | hand-rolled range loop, sequential | **YES (~30–50k), then filtered to B2B in JS at :268-269** | Mount (seq) |
| :272 → barcodeService:1587 | external_movements | | | seq chunks | | Mount (seq) |
| :291 → qcHistory:53 | qc_records | QC cols | in(order_id, 200-chunk) | seq chunks | no | Tab (qc_history), refetches every visit |
| :303 → reJourneys:43 | order_components + qc_records | | in(order_id, 200-chunk) | seq chunks | no | Tab (rejourneys), refetches every visit |
| :953 ProductionHeadVendors.jsx:155 | production_vendors ×2 | | | | small | Tab (vendors) mount |
| ProductionHeadVendors.jsx:176 (→ barcodeService:1609) | **external_movements (full)** + orders chunks | | channel="b2b" filtered **in JS** | paged + seq loop | **YES** | Tab → Movement History click (:440) and after save (:306) |

#### B2bExecutiveDashboard.jsx

| File:line | Table/RPC | Columns | Filters/order | Paginated? | Full-table? | When |
|---|---|---|---|---|---|---|
| :54 | auth.getUser | | | | | Mount |
| :61 | salesperson | role | eq email `.single()` | | | Mount (seq) |
| :76 | salesperson | `*` | eq email | | | Mount (Promise.all, duplicate) |
| :79 | orders | **`*`** | eq is_b2b, eq salesperson_email, order created_at | fetchAllRows | the user's own B2B orders only | Mount (Promise.all) |
| :88-91 | vendors | 4 cols | in(vendorIds) | no | no | Mount (seq) |
| :214 | vendors | `*` | eq id `.single()` | | | Action (edit) |

#### B2bOrderHistory.jsx

| File:line | Table/RPC | Columns | Filters/order | Paginated? | Full-table? | When |
|---|---|---|---|---|---|---|
| :65 / :71 | auth / salesperson | role | eq email | | | Mount **and on every statusFilter/typeFilter change** (effect deps :114) |
| :81-92 | orders | **`*`** | eq is_b2b (+ approval_status / is_stock_order / b2b_order_type), order created_at | fetchAllRows | all B2B (~1–1.5k) | Mount + **re-downloads everything on each filter change** |
| :100-103 | vendors | 4 cols | in(vendorIds) | no | | same |

#### B2bVendorOrders.jsx

| File:line | Table/RPC | Columns | Filters/order | Paginated? | Full-table? | When |
|---|---|---|---|---|---|---|
| :50 / :55 | auth / salesperson | role | | | | Mount (seq) |
| :64-68 | vendors | `*` | eq id `.single()` | | | Mount (seq) |
| :75-79 | orders | **`*`** | eq vendor_id, eq is_b2b | fetchAllRows | one vendor's orders | Mount (seq). Totals computed in JS (:85-86). |

#### B2bOrderView.jsx

| File:line | Table/RPC | Columns | Filters | Paginated? | Full? | When |
|---|---|---|---|---|---|---|
| :58 / :64 | auth / salesperson | role | | | | Mount (seq) |
| :75-79 | orders | `*` | eq id `.single()` | | 1 row | Mount (seq) |
| :85-89 | vendors | `*` | eq id | | | Mount (seq) |
| :93-97 | vendor_contacts | `*` | eq vendor_id | | | Mount (seq; could run in parallel with vendors) |

#### B2bOrderDetails.jsx / B2bReviewOrder.jsx / B2bproductform.jsx / B2bvendorselection.jsx

| File:line | Table/RPC | Columns | Filters | Paginated? | Full? | When |
|---|---|---|---|---|---|---|
| B2bOrderDetails.jsx:43 → checkB2bRole | auth + salesperson | role | | | | Mount |
| B2bReviewOrder.jsx:67 → checkB2bRole | auth + salesperson | role | | | | Mount (seq) |
| B2bReviewOrder.jsx:82-86 | salesperson | role, store_name, saleperson, phone | eq email | | | Mount (seq, second read of the same row) |
| B2bReviewOrder.jsx:252-257 | orders | update … select order_no | eq id | | | Action |
| B2bReviewOrder.jsx:280 | b2b_approvals | upsert | | | | Action |
| B2bReviewOrder.jsx:295 | rpc generate_order_no | | | | | Action |
| B2bReviewOrder.jsx:346-350 | orders | insert … select() | | | | Action |
| B2bReviewOrder.jsx:372 | b2b_approvals | insert | | | | Action |
| B2bproductform.jsx:253 → checkB2bRole | auth + salesperson | | | | | Mount |
| B2bproductform.jsx:332 | **products_live + product_extra_prices** | **`*, product_extra_prices(*)`** | order name | fetchAllRows | **YES, full catalog (1000+) with embeds** | Mount (parallel) |
| B2bproductform.jsx:333 | colors | name, hex | | no | small | Mount |
| B2bproductform.jsx:336 (+:338 fallback) | dupatta_colors | name, hex | | no | small | Mount |
| B2bproductform.jsx:344 | extras | name, price, sort_order | | no | small | Mount |
| B2bvendorselection.jsx:82 → checkB2bRole | auth + salesperson | | | | | Mount |
| B2bvendorselection.jsx:122 | **salesperson** | saleperson, role | **no filter; filtered to role='merchandiser' in JS (:124)** | no | **YES (whole staff table)** | Mount |
| B2bvendorselection.jsx:142-146 | vendors | `*, vendor_contacts(*), size_charts(chart)` | eq is_active | no (1000-cap risk) | all active vendors + all contacts | Mount |
| B2bvendorselection.jsx:191-196 | discount | code, percent | ilike code limit 1 | | | Action |

#### CommsDashboard/*

| File:line | Table/RPC | Columns | Filters/order | Paginated? | Full-table? | When |
|---|---|---|---|---|---|---|
| CommsDashboard.jsx:99 / :105-109 | auth.getSession / salesperson | 6 cols | eq email | | | Mount (seq) |
| CommsDashboard.jsx:124-127 | orders | **`*`** | eq is_comms, order created_at | fetchAllRows | comms only (hundreds) | Mount (seq) |
| CommsDashboard.jsx:136-140 | order_components | 15 cols | in(order_id, 100-chunk) | **sequential for-loop of awaits** | no | Mount (seq) |
| CommsDashboard.jsx:145 → barcodeService:1587 | external_movements | | | seq | | Mount (seq) |
| CommsDashboard.jsx:839 ProductionHeadVendors (no channel/orderIds) | production_vendors; Movement History → **full external_movements with no scope** | | | | **YES** | Tab |
| CommsCalendar.jsx:44-48 | comms_calendar_events | `*` | eq user_email | no | per user | Tab mount |
| CommsCalendar.jsx:109/118/145 | comms_calendar_events | insert/update/delete | | | | Action |
| CommsInventory.jsx:86 | **products_live** | 10 cols | order name | fetchAllRows | **YES** | Tab mount (Promise.all) |
| CommsInventory.jsx:87 | **product_variants** | id, product_id, size, color, inventory | **none** | fetchAllRows | **YES, the entire variants table** | Tab mount (Promise.all) |
| CommsInventory.jsx:88 | comms_inventory_blocks | `*` | eq status active | no | | Tab mount |
| CommsInventory.jsx:194 / :219 | comms_inventory_blocks | insert / update | | | | Action |
| CommsPRPerformance.jsx:76-79 | comms_pr_performance | `*` | `.in(order_id, allEligibleIds)` **unchunked** | no | no | Tab mount; **re-runs whenever `orders` identity changes** (deps `eligibleOrders` :88; CommsDashboard.jsx:195 replaces `orders` after a PDF click) |
| CommsPRPerformance.jsx:164 | comms_pr_performance | upsert | | | | Action |
| CommsReports.jsx:190-193 | comms_pr_performance | `*` | `.in(order_id, ids)` unchunked | | | Action (export) |
| CommsOrderForm.jsx:115-119 | salesperson | 5 cols | eq email | | | Mount |
| CommsReviewOrder.jsx:120-124 | salesperson | | eq email | | | Mount |
| CommsReviewOrder.jsx:253 / :260 | rpc generate_order_no / orders insert | | | | | Action |
| CommsReviewOrder.jsx:286/297/326/334 | product_variants / products read + update | | per item | | | Action, **per-item sequential loop (N+1, non-atomic)** |
| CommsReviewOrder.jsx:381 | draft_orders delete | | | | | Action |
| CommsSourcingReturns.jsx:140-150 | orders update … select | | eq id | | | Action |
| CommsSourcingReturns.jsx:166/176/182/189 | product_variants / products read + update | | per item | | | Action, **per-item sequential loop (N+1, non-atomic)** |

#### ShopifyOrdersDashboard.jsx

| File:line | Table/RPC | Columns | Filters/order | Paginated? | Full-table? | When |
|---|---|---|---|---|---|---|
| :532 / :534-538 | auth / salesperson | role, saleperson | eq email | | | Mount (seq) |
| :562-566 | orders | `ORDER_LIST_COLUMNS` (:148, **includes `items`**) | `.or(order_no like SB-SHOPIFY-% , SB-SHOP-%)`, order created_at | fetchAllRows | Shopify subset (~1–2k) | Mount (seq, after auth) |
| :577-581 | order_components | 21 cols | in(order_id, 100-chunk) | **sequential for-loop** | no | Mount (seq) |
| :587 → barcodeService:1587 | external_movements | | | seq | | Mount (seq) |
| :915 → qcHistory:53 | qc_records | | in 200-chunks | seq | | Tab (qc-history), refetches every visit |
| :927 → reJourneys:43 | order_components + qc_records | | in 200-chunks | seq | | Tab (rejourneys), refetches every visit |
| :1981 ProductionHeadVendors orderIds={orderIds} | production_vendors; Movement History → **full external_movements**, scoped **in JS** by a 1–2k-id set | | | | **YES** | Tab |
| :1130-1142 | orders | update manual_line_breakdown | eq id | | | Action |
| QcReportModal.jsx:34-38 | qc_records | list | eq order_id | | | Action |
| handleSyncNow :608 | edge fn shopify-order-sync, then a full `loadOrders()` again | | | | | Action |

#### EditOrder.jsx

| File:line | Table/RPC | Columns | Filters | Paginated? | Full? | When |
|---|---|---|---|---|---|---|
| :150 / :152-156 | auth / salesperson | designation | eq email `.single()` | | | Mount **and after every save** (effect deps `[order, navigate]` :155; `setOrder` at :200 re-fires it, which also resets the form fields) |
| :191-194 | orders | update | eq id | | | Action |
| :242 → cancelOrder.js | orders / rpc / vendors | | | | | Action |
| :288-295 | orders | update exchange | eq id | | | Action |

---

### 3. Flags

#### 3a. `select('*')` on orders (pulls the `items` JSONB and every other column)
- ProductionManagerDashboard.jsx:443-444: **every order in the DB**, `*`.
- B2bMerchandiserDashboard.jsx:173 (B2B), :730 (search, limit 25, acceptable).
- B2bProductionDashboard.jsx:183
- B2bexecutivedashboard.jsx:79
- B2bOrderHistory.jsx:83
- B2bVendorOrders.jsx:76
- B2bOrderView.jsx:77 (single row, acceptable)
- CommsDashboard.jsx:125
- PMD :2103 (single row after an edit, acceptable)
- ShopifyOrdersDashboard is the one list screen that uses an explicit column list (:148). `items` is still in it.

#### 3b. Full-table downloads (no server-side scoping)
1. **PMD :442-456: the whole `orders` table** (~10k rows, `*`), then filtered in JS at :461 (`!is_b2b || approval_status==='approved'`), a filter the DB could apply.
2. **PMD :490-506: the whole `order_components` table**, then filtered in JS at :510-511 against the visible order ids.
3. **B2bMerchandiserDashboard :204-213: the whole `order_components` table** (every channel) for a B2B-only screen, with **no JS filter** afterwards, so ~90% of the rows are dead weight held in state.
4. **B2bProductionDashboard :250-259: the whole `order_components` table**, filtered to B2B in JS at :268-269.
   - The code comment defends items 2–4 as avoiding a huge `.in()`. The correct fixes are a server-side filter (embedded `orders!inner(is_b2b)` filter, `channel_key` column, which is already selected at PMD :492 and B2bProd :252) or an RPC/view.
5. **fetchAllMovements (barcodeService.js:1609): the whole `external_movements` table** plus sequential 100-id order lookups (:1632-1638). Hit on PMD **mount** (overview is the default tab, :249, :573-584), plus ProductionHeadVendors Movement History on the B2bProd, Comms and Shopify screens. The retail/b2b and orderId scope is applied in JS afterwards.
6. **fetchQcRecords({paged:true}): the whole `qc_records` table**, PMD :553 (production/qc_history tabs). A second paged pass for `outcome='dispose'` runs on mount (:536).
7. **fetchStageOverrides: the whole `stage_overrides`**, via OverrideHistory on the PMD override_log tab.
8. **products_live (full catalog)**:
   - B2bproductform.jsx:332 (`*` + `product_extra_prices(*)` embed)
   - CommsInventory.jsx:86
   - WarehouseTab.jsx:49, StockExchangeTab.jsx:56
   - StockPanel (product_channel_stock/warehouse_stock full)
9. **product_variants (whole table, no filter)**: CommsInventory.jsx:87.
10. **salesperson (whole staff table)**: B2bvendorselection.jsx:122, filtered to merchandisers in JS at :124. Should be `.eq("role","merchandiser")`.
11. **vendors**: every active vendor with `*` + all contacts + chart, unpaged (B2bvendorselection.jsx:142, Merch :174). This hits the 1000-cap risk only if vendors grow that far.

#### 3c. JS-side filtering, sorting, summing and counting the DB could do
- PMD :461 approval filter. :510-511 components-to-visible-orders.
- PMD :1919-1928 `orderTabCounts`: 4 full passes over 10k orders. Could be a `count` query or a single pass.
- PMD `salesMetrics` :1570-1625 revenue sums, delayed/returned/exchange counts. `topByStore` :1738-1800 (per-item product/color/size aggregation over `items` JSONB for every order in the period). `channelOrdersVsLate` :1651, `delayedByChannel` :1629. All client-side aggregation over the full `orders` download, which is the main reason `*` + `items` gets pulled.
- PMD `stageStats`/`orderStageGroups`/`dispatchData` (:1197-1460): grouping over 30–50k components in JS.
- B2bProd :268-269 components-to-B2B. :381-384 four separate `orders.filter(getStageBucket)` passes (could be one pass).
- Merch `stats` :242-270, `vendorGrowthStats` :315-348: period and revenue sums in JS.
- B2bVendorOrders :85-95 revenue, pending and average in JS (could be a sum/count query).
- externalMovements.js:68-75 / ProductionHeadVendors.jsx:179-185 channel/order scope after a full download.
- B2bvendorselection :124 role filter.
- qcHistory.js:65 re-sort after chunk merge (fine).

#### 3d. Queries in loops (N+1 / sequential awaits)
- Hand-rolled sequential page loops: PMD :440-456 (orders), :487-506 (components). Merch :200-213. B2bProd :247-259. **Each also uses `all = [...all, ...page]`**, an O(n²) copy (at 50 pages that is ~1.25M element copies; small next to network time, but needless).
- Sequential 100-id chunk loops: CommsDashboard.jsx:136-143, ShopifyOrdersDashboard.jsx:577-583 (Shopify ~1–2k orders means 10–20 sequential round trips). These could run through Promise.all or an embedded select.
- enrichComponentsWithMovements barcodeService.js:1585-1594: sequential 500-id chunks.
- fetchAllMovements barcodeService.js:1632-1638: sequential 100-id chunks over every distinct order in the movements table.
- qcHistory.js:53-61 and reJourneys.js:43-50, :82-88: sequential 200-id chunks.
- CommsReviewOrder.jsx:283-345 and CommsSourcingReturns.jsx:160-196: per-item read → update loops on product_variants/products, plus a per-item edge-function fetch. N+1, and also a **non-atomic read-modify-write race on inventory** (correctness, not only perf).
- ComponentJourneyModal.jsx:84-95: 2 queries per component (Promise.all).
- Merch approval :479-481 and cancelOrder.js:96-97: vendors credit read-then-write (race).

#### 3e. The same data fetched by several screens and components
- **salesperson read twice per mount** (role check + `*` profile): PMD :418 + :433, Merch (checkB2bRole :45 + :171), B2bProd :140 + :166, Exec :61 + :76, B2bReviewOrder (checkB2bRole + :82). Every B2B screen re-guards on navigation, so a create-order flow (vendorselection → productform → orderdetails → review) does 4× getUser + 4–5 salesperson reads.
- **order_components full table**: PMD, Merch and B2bProd each download it independently.
- **external_movements**: enrich on 5 screens, plus the full fetchAllMovements on PMD and ProductionHeadVendors.
- **products_live full catalog**: B2bproductform, CommsInventory, WarehouseTab, StockExchangeTab, StockPanel (meta).
- **vendors**: Merch fetches active vendors `*` (:174) **and** re-queries by id (:184) for the same info. The B2B screens each build their own vendorMap.
- **colors**: PMD :588, B2bproductform :333.

#### 3f. useEffect dependency problems and refetch loops
- **B2bOrderHistory.jsx:60-114**: deps `[statusFilter, typeFilter]`. Each dropdown change re-runs auth, the role check, a full B2B `*` download and vendors, where a client-side filter would do (other filters on the page already are client-side, :123).
- **CommsPRPerformance.jsx:71-88**: deps `eligibleOrders` (memo on the `orders` prop). The parent replaces `orders` on warehouse-PDF generation (CommsDashboard.jsx:195), which triggers a PR refetch. Not an infinite loop, but a spurious refetch.
- **PMD :573-584**: external movements (full table) refetch on **every** switch back to overview and on every subTab change (no loaded flag), unlike QC, which has `qcHistoryLoaded` (:547-548).
- **PMD :559-570**, B2bProd :286-308, Shopify :910-930: re-journey and QC refetch on every tab visit. B2bProd's deps include `orders`, so they also refetch after any setOrders.
- **EditOrder.jsx:133-155**: deps `[order, navigate]`. `setOrder` after a save (:200) re-runs the effect: a salesperson re-query plus a form reset.
- ShopifyOrdersDashboard :555-559 documents and avoids the `showPopup` identity loop. StockPanel correctly keys on `poolsKey` (:85, :230), so the inline `poolsForUser(...)` prop is safe. No infinite loops found.
- No `setInterval` polling anywhere in scope.

#### 3g. `.in()` URL-length risks (unchunked)
- vendors `.in(id, vendorIds)`: PMD :474, Merch :186, B2bProd :231, Exec :90, B2bOrderHistory :102. Fine at tens to low hundreds of vendors; breaks silently at a few hundred.
- CommsPRPerformance.jsx:78, CommsReports.jsx:192: `.in(order_id, allCommsIds)` unchunked. At ~300+ comms orders (UUIDs ≈ 37 chars) the URL passes ~11 KB and risks the silent 400 the other screens already hit.
- enrichComponentsWithMovements uses 500-id chunks (~18 KB), larger than the 100/200 used elsewhere.

#### 3h. Side bug noticed (not perf)
- CommsInventory.jsx:139 filters on `p.created_at`, but `created_at` is not in the select list at :86. Any bounded period filter will therefore hide every product.

---

### 4. Load cost per screen (on mount, default tab)

| Screen | Queries on mount | Sequential vs parallel | Rows downloaded (est.) | In-browser compute |
|---|---|---|---|---|
| **ProductionManagerDashboard** | ~55–75 requests | Almost all **sequential**: getUser → role → profile → 10 orders pages → vendors → 30–50 component pages → 1–N enrich chunks. In parallel: disposals (paged), fetchAllMovements (M pages + distinct-orders/100 sequential chunks), colors | **~10k orders × `*` (tens of MB with items) + ~30–50k components + full external_movements + dispose qc rows**. The production tab adds all qc_records. | JS filter of 10k orders and 50k components. ~25 useMemos over the full set (componentsByOrder, stageStats, dispatchData, salesMetrics, topByStore with an items JSONB walk, orderTabCounts 4 passes). Delivery-report (:3637-3830) and calendar (:4215-4275) tabs compute **inline in render IIFEs over all orders** (not memoized), so every keystroke or state change recomputes them. |
| **B2bMerchandiserDashboard** | ~40–60 | checkB2bRole (2 seq) → Promise.all(4) → vendors → 30–50 component pages seq → enrich | ~1–1.5k B2B orders `*` + active vendors `*` + **30–50k components (all channels, ~90% unused)** | componentsByOrder over 50k rows, stats, vendorGrowthStats. Calendar filters `orders` 3× inline (:1632-1638). |
| **B2bProductionDashboard** | ~40–60 | getUser → role → Promise.all(2) → vendors → 30–50 component pages seq → enrich | ~1.5k orders `*` + **30–50k components** then JS-filtered to ~5k | 4 bucket filters, componentsByOrder, stage groups. |
| **ShopifyOrdersDashboard** | ~15–30 | getUser → role → 1–2 orders pages → 10–20 **sequential** component chunks → enrich | ~1–2k orders (column list incl. items) + ~5k components | stageKeysByOrder, filters (memoized). |
| **CommsDashboard** | ~5–10 | fully sequential (session → sp → orders → k chunks → enrich) | hundreds of orders `*` + ~1k components | light. The Inventory tab adds the full products_live + **full product_variants** (Promise.all) with O(P×V) compute. |
| B2bOrderHistory | 5 (again on every filter change) | seq | ~1–1.5k B2B `*` | memoized filter + paginate |
| B2bExecutiveDashboard | 5 | getUser → role → Promise.all(2) → vendors | own orders only (tens to hundreds) | light |
| B2bVendorOrders | 4 | seq | one vendor's orders | light |
| B2bproductform | 6 | gate seq; the 4 lookups run in parallel | **full products_live with extra_prices embed (1000+)** | light |
| B2bvendorselection | 4 | parallel effects | whole salesperson table + all active vendors with contacts | light |
| B2bOrderView | 5 | **fully sequential** (vendors + contacts could run in parallel) | 1 order | light |
| B2bReviewOrder / B2bOrderDetails / CommsOrderForm / CommsReviewOrder / EditOrder | 2–3 | seq | 1 row | light |

**Heaviest, in order:**
1. **ProductionManagerDashboard**: the entire orders table with `*` + the entire order_components table + the entire external_movements table on mount, 50+ sequential round trips, and heavy unmemoized in-render aggregation.
2. **B2bMerchandiserDashboard**: the full order_components table for a B2B-only view, kept unfiltered.
3. **B2bProductionDashboard**: the full order_components table, JS-filtered.
4. **ShopifyOrdersDashboard**: sequential component chunks, plus the full movements table on the vendors tab.
5. **CommsInventory tab**: full products and variants with O(P×V).

---

### 5. Rendering

| Location | Issue |
|---|---|
| PMD (4603 lines) | A single component with ~150 useState, 14 tabs and every tab's JSX in one render function. Any state change re-renders the whole tree. The delivery report (:3637-4200) and calendar (:4215-4475) are big `{(() => {...})()}` IIFEs that loop over **all orders** on every render (the forEach at :3679 and :3729; `orders.filter` at :4239). They are not memoized. Rows are capped (`slice(0, drOpenLimit)` :4114, :4166, `slice(0, calLimit)` :4432, `slice(0, dispatchLimit)` :3527); the orders list uses Paginator (:2995). The dispatch IIFE (:3247-3300) re-filters `d.pending` every render. |
| B2bMerchandiserDashboard (1978) | Approvals queue `stats.pending.map` (:1085) renders **every** pending order, unpaginated. Calendar day list filters `orders` 3× inline (:1632, :1635, :1638). The orders, vendors and consignment lists are paginated. |
| B2bProductionDashboard (1096) | All main lists paginated. Calendar `orders.filter` inline (:902). |
| B2bexecutivedashboard (683) | `orders.filter(rejected)` inline (:326) and the calendar `orders.filter` inline (:638), not memoized. Order history paginated. |
| ShopifyOrdersDashboard (2034) | Lists paginated (:1859, :1937). Filters memoized. |
| CommsInventory (587) | `visibleProducts.map` (:376) renders **the entire catalog (1000+ rows) with no pagination or virtualization**. `totalInventoryFor` (:100-105) does `variants.filter` for each product: O(products × variants), called in the `visibleProducts` memo (:138), again per row (:377) and in CSV export (:244). Should be a `variantsByProduct` map. |
| CommsDashboard (845) | Orders paginated (:785). Fine. |
| CommsPRPerformance / CommsSourcingReturns / CommsCalendar | Small comms sets. Fine. |
| B2bproductform (943) / B2bvendorselection (385) | A searchable dropdown over 1000+ products (`filtered` memo, :35). Renders all matches unvirtualized, so the first open with an empty query renders 1000+ options. |
| EditOrder (697), B2bOrderView (466), B2bReviewOrder (704) | Single order. Fine. |

#### Top recommendations (for the fix phase, not applied)
1. Replace the full-table order_components downloads (PMD, Merch, B2bProd) with server-side scoping: an `orders!inner(...)` embed filter, `channel_key`, or a view/RPC that returns per-stage counts. Merch only needs components for the B2B orders it renders on the current page, so fetch those lazily.
2. The PMD should not download all orders with `*`. Move the aggregates (`salesMetrics`, `topByStore`, `orderTabCounts`, stage counts) into an RPC. List views should page server-side with an explicit column list, and `items` should only be fetched for visible rows.
3. `fetchAllMovements`: push the channel/orderId scope into the query (or a view with `is_b2b` joined), and fetch it only when needed. The PMD currently fetches it on every overview visit.
4. Replace the hand-rolled sequential page and chunk loops with parallel pages once the count is known. Also drop the `[...all, ...page]` copies.
5. Collapse the duplicate salesperson role and profile reads into one `select("*")`. Make B2bOrderHistory's filters client-side.
6. CommsInventory: build a `variantsByProduct` map, paginate the table, and filter product_variants server-side.

---

## Appendix D — performance audit of the warehouse, packaging, scan station, stock room, inventory screens and shared components

Read-only audit. Every line number below was checked against the code on branch `development` (2026-09-24).
Sizes assumed: orders ≈ 10k and growing (heavy `items` JSONB), order_components ≈ 30–50k, and stage_transitions larger still. P = product count (>1000 per the code comments).
`fetchAllRows` (src/utils/fetchAllRows.js:23-38) runs **sequential** 1000-row `.range()` pages. N rows cost ceil(N/1000) serial round trips, and it does not add an ORDER BY of its own.

---

### 0. Top findings (ranked)

1. **PackagingDashboard downloads three whole tables on mount.** These are `orders` (≈10k rows, with `items` JSONB and addresses), **every** `order_components` row (≈30–50k, i.e. 30–50 serial pages) and every `shipments` row (PackagingDashboard.jsx:107-112). It then keeps only statuses completed/dispatched/delivered in JS (:189-192). The Scan Station tab doesn't use any of this, yet it still waits for it. This is the heaviest screen in scope.
2. **WarehouseDashboard downloads the whole `orders` table, `items` JSONB included, on mount.** The call is `fetchAllRows` at WarehouseDashboard.jsx:339-341. It re-runs every time the user leaves the Scan tab (:588-599). The private/B2B-approval filter runs in JS (:350-358). The Production Head **Overview** tab then pulls components for every channel order in **serial 200-id chunks** (:515-547). That is ~25–50 serial requests, followed by `enrichComponentsWithMovements`.
3. **No deterministic ORDER BY on paged `fetchAllRows` calls.** `.range()` without a stable order can duplicate or skip rows across pages. Affected calls:
   - PackagingDashboard.jsx:109 (order_components) and :111 (shipments)
   - AddProduct.jsx:40 and :268 (products)
   - InventoryDashboard.jsx:238 (product_variants) and :258 (product_channel_stock)
   - StockPanel.jsx:117, :126 and :133
   - ExhibitionPanel.jsx:60
   - AddProduct.jsx:572, :1076 and :1124
   - BarcodeExportPanel.jsx:58

   This is a correctness risk as well as a performance one, and it gets worse as the tables grow.
4. **Chunked `.in()` reads without paging can silently truncate at 1000 rows.** Each 200-order chunk is one unpaged request:
   - WarehouseDashboard.jsx:524-530 (order_components): 200 orders × 5 pieces reaches the cap.
   - qcHistory.js:53-59 (qc_records per 200 orders).
   - reJourneys.js:43-50 and :82-89.

   `fetchQcRecords({inspectedBy})` (qcHistory.js:40-47) is unpaged. A busy inspector's QC History tab (ScanStationPage.jsx:84-93) stops at 1000 records with no warning.
5. **StockRoom reloads unbounded ledger tables on mount and after every stock action.** `stock_room_movement` is fetched `select("*")` in full (stockRoomData.js:142), and `reloadStock` (StockRoom.jsx:136-145) runs after every stock action. Plus the 90-day `orders` sales pull with `items` (:107-112), the stock orders (:97-104, with a JS channel filter), and a Shopify poll every 60s/5 min that re-downloads the whole catalogue whenever any variant changed (StockRoom.jsx:100-107, 174-186).
6. **N+1 / serial loops:**
   - Packaging dispatch: 2 serial RPCs per barcode (ScanStation.jsx:1204-1223).
   - ComponentJourneyModal: 2 queries per component (ComponentJourneyModal.jsx:84-95).
   - WarehouseDashboard: one query per visible card (:1094-1102), whereas ScanStationOrders already batches the same work.
   - WalkInsView: one serial UPDATE per changed walk-in, on every mount (walkinConversion.js:79-85).
   - StockExchangeTab transfer: 4–5 serial queries per item, non-atomic (StockExchangeTab.jsx:173-210).
   - WarehouseTab edit: one serial write per item (WarehouseTab.jsx:142-154).
   - StockRoom `importProducts`: one serial insert per row (stockRoomData.js:364-370).
   - InventoryDashboard LXRTS sync: one read plus serial writes per product (:280-345).
   - `pullShopifyStock`: one update per changed variant (stockRoomShopify.js:136-145).
7. **Probable stale-filter bug in WarehouseDashboard.** The `filteredOrders` useMemo (WarehouseDashboard.jsx:663-766) reads `ordersPeriodRange`/`inOrdersPeriod` (:682-689), but its dependency list (:766) omits both. Changing the "Warehouse date" period may not re-filter the list until another dependency changes. The page-reset effect (:1104-1106) also misses the period.

---

### 1. Per screen / panel: tables read and who mounts it

| Screen / panel | Tables / RPCs read | Mounted by |
|---|---|---|
| **WarehouseDashboard.jsx** (1958 lines) | salesperson, orders (all, `fetchAllRows`), order_components (per card, and chunked per channel on Overview), external_movements (via enrich), qc_records (QC tab), order_components + qc_records (Re-journeys tab); children listed below | route (role `warehouse`) |
| **PackagingDashboard.jsx** (513) | salesperson, orders (all), order_components (all), shipments (all); children: ScanStation, QcReportModal, DeliveryPerformancePanel, ProductionOverview | route (role `packaging`) |
| **ScanStationPage.jsx** (154) | salesperson, qc_records (by inspector, QC tab); children: ScanStation, ScanStationOrders, QcHistoryPanel | route (scan-only roles) |
| **InventoryDashboard.jsx** (1361) | salesperson, products_live `*` (all), product_channel_stock (all), product_variants (all), shopify-inventory edge fn (Sync button); tabs: InventoryOverviewTab (props only), StockOrdersTab, StockCalendarTab, WarehouseTab, StockExchangeTab, AddProduct | route |
| StockOrdersTab.jsx (513) | orders `select("*")` where is_stock_order (all) | InventoryDashboard |
| StockCalendarTab.jsx (168) | orders `select("*")` where is_stock_order (all), the same data again | InventoryDashboard |
| **StockRoom/** (StockRoom.jsx 441, stockRoomData.js 400, stockRoomModel.js 694) | salesperson, products_live, product_variants, warehouses, warehouse_stock, orders (stock + 90-day sales), stock_room_location / _placed / _movement / _collection / _product_collection, shopify-inventory edge fn, stock_room_* RPCs | route |
| **ScanStation.jsx** (2044) | production_vendors (mount), qc_records (QC station mount), then per scan: order_components (+orders embed), orders (ilike), stage_transitions, external_movements, RPCs (advance_component_stage, record_qc_result, security_guard_scan, activate_components, verify_packaging_components, create_shipment, get_production_head_email) | WarehouseDashboard, PackagingDashboard, ScanStationPage |
| ScanStationOrders.jsx (449) | orders (all, no `items`), vendors, order_components (per page), external_movements | ScanStationPage |
| ProductionHeadVendors.jsx (695) | production_vendors ×2, external_movements (all) + orders (chunked), order_components | WarehouseDashboard, AssociateDashboard, B2bProductionDashboard, CommsDashboard, ShopifyOrdersDashboard |
| QcReportModal.jsx | qc_records by order_id | WarehouseDashboard, PackagingDashboard, ScanStationOrders, B2bMerchandiser, ShopifyOrders |
| ComponentJourneyModal.jsx (275) | stage_transitions + external_movements **per component** | WarehouseDashboard, ScanStationOrders, PM, B2bMerch, B2bProduction, Comms, ShopifyOrders |
| StageCountCards / ProductionOverview / DeliveryPerformancePanel / QcHistoryPanel / ReJourneyPanel / ExternalVendorsPanel / QcHistoryTable / ReJourneyTable | **none** (props only) | see importer list in §1a |
| NotificationBell.jsx (377) | notification_recipients (+notification embed), realtime channel | DashboardHeader, which is on 23 dashboards |
| UpdateBanner.jsx | `/version.json` static | App.js (global) |
| OverrideHistory.jsx | stage_overrides `*` (all) | PM, Admin, GM |
| ProductionOverrides.jsx (594) | order_components `*`, orders ilike, stage_transitions, external_movements, order_components update | PM |
| FactoryPause / ReplacementApprovals / VendorApprovals / VendorRequest | factory_pause / replacement_requests / production_vendors (small) | COO / PM / COO / PM |
| ExhibitionPanel / ExhibitionApprovals | exhibitions, orders by exhibition_id (all), salesperson | Associate / CEO, GM |
| WalkInsView.jsx (325) | salesperson, walkins (all), then **writes** walkins per row | Admin, AssistantCmo, WalkInDashboard |
| stock/StockPanel.jsx (524) | product_channel_stock (all), warehouses, warehouse_stock+products (all), consignment_inventory (all), products_live (chunked) | PM, Admin, AssistantCmo, Associate, B2bMerch, CEO, COO, GM, RetailManager, StoreManager |
| stock/WarehouseTab.jsx (470) | warehouses `*`, products_live (all), warehouse_stock | InventoryDashboard, B2bMerch |
| stock/StockExchangeTab.jsx (479) | stock_exchanges (all, joined), warehouses, products_live (all), warehouse_stock, stock_exchange_items | InventoryDashboard, B2bMerch |
| AddProduct/AddProduct.jsx (1849) | products (all sku_id), products (all top/bottom options), colors, dupatta_colors, products_live, product_variants | InventoryDashboard |
| AddProduct/BarcodeExportPanel.jsx (356) | products (drafts, all), products_live search, RPC reserve_sku_rows | AddProduct |
| LabelDesigner.jsx (493) | products_live (limit 1 / limit 20), label template | BarcodeExportPanel |
| DeliveryPaymentModal.jsx (495) | shipments, order_components, order_payments by order_id | AssociateDashboard |
| AlterationModal.jsx | storage upload only | OrderDetailPage |

#### 1a. Importers of the prop-only analytics panels
- StageCountCards: PM, B2bProduction, RetailManager, ShopifyOrders, WarehouseDashboard
- ProductionOverview: B2bProduction, Packaging, RetailManager, ShopifyOrders, WarehouseDashboard
- QcHistoryPanel: PM, B2bProduction, ScanStationPage, ShopifyOrders, WarehouseDashboard
- ReJourneyPanel: PM, B2bProduction, ShopifyOrders, WarehouseDashboard
- DeliveryPerformancePanel: Packaging only. ExternalVendorsPanel: PM only.

#### 1b. What the utils fetch (called from in-scope code)
| Util (file:line) | Fetches |
|---|---|
| barcodeService `fetchOrderComponents` :1015-1023 | order_components `select("*")` by order_id |
| `resolveFullBarcode` :1061-1067 | order_components `barcode ilike '%-<raw>'` (leading wildcard, so no btree index can be used). Only runs for prefix-less input. |
| `fetchComponentByBarcode` :1078-1107 | order_components `*` + orders embed by barcode; fallback leading-wildcard ilike (:1104) |
| `fetchTransitionHistory` :1122 | stage_transitions `*` by component_id |
| `fetchQcHistory` :1136 | qc_records `*` by component_id |
| `enrichComponentsWithMovements` :1579-1605 | external_movements where component_id in (outside-WH ids), 500-id chunks, serial |
| `fetchAllMovements` :1607-1648 | **all** external_movements + order_components embed (`fetchAllRows`), then orders in **serial 100-id chunks** (:1631-1638) |
| `fetchStageOverrides` :1729 | stage_overrides `*`, all rows |
| `fetchComponentStats` :1775 | all active order_components. **Dead code: no caller in src.** |
| `fetchApprovedVendors`/`fetchAllVendors`/`fetchPendingVendors` :1435/:1446/:1487 | production_vendors (small) |
| qcHistory `fetchQcRecords` :38-92 | qc_records: by inspector (unpaged), by orderIds (serial 200-chunks, unpaged per chunk), or paged all |
| reJourneys `fetchReJourneys` :37-110 | order_components (is_rework, active) per 200-order chunk, then qc_records (outcome=rework) per 200-component chunk. All serial. |
| notificationService `getNotifications` :537 / `getUnreadCount` :625 | notification_recipients limit 50 (+embed); head count |
| walkinConversion `reconcileConversions` :59-88 | **writes** walkins, one serial UPDATE per changed row |
| stockRoomData (see §2) | catalogue, ledger, orders |

---

### 2. Every Supabase call in scope

Legend: FT = full-table / full-filtered-set download. M = on mount (or on tab open), A = user action.

#### WarehouseDashboard.jsx
| File:line | Table/RPC | Columns | Filters/order | Paged? | FT? | When |
|---|---|---|---|---|---|---|
| WarehouseDashboard.jsx:339 | orders | 29 cols incl. **items**, attachments, alteration_attachments (:311-330) | order created_at desc; JS filters private/B2B (:350-358) | fetchAllRows | **FT (all ~10k orders)** | M; again after leaving the Scan tab (:593-596), after manual complete (:941) |
| :395-399 | order_components | 17 cols | eq order_id | no | no | M (auto, once per visible card, :1094-1102: **N+1**, 5 per page) and A |
| (via enrich) barcodeService:1588 | external_movements | component_id, stages_outside | in(component_id), status=exited | 500-chunks | no | same as above |
| :526-530 | order_components | 10 cols | in(order_id, 200-chunk), **serial loop** | **no: each chunk can truncate at 1000** | **FT of the channel (all dates)** | M of the Overview tab (PH only) |
| :444 → qcHistory:53-59 | qc_records | QC_RECORD_COLUMNS | in(order_id, 200-chunk) serial, order created_at | no per chunk | FT of the channel | M of the QC History tab |
| :456 → reJourneys:43-89 | order_components + qc_records | cols | is_rework, is_active, in(200) serial | no per chunk | channel set | M of the Re-journeys tab |
| :563-567 | salesperson | role, assigned_stations, designation | eq email single | – | no | M |
| :880 | `fetch(url)` storage attachments | – | – | – | – | A |

#### PackagingDashboard.jsx
| File:line | Table | Columns | Filters | Paged? | FT? | When |
|---|---|---|---|---|---|---|
| :107-108 | orders | 25 cols incl. **items**, comments, full address (:90-102) | order created_at | fetchAllRows | **FT all orders**; only completed/dispatched/delivered are used for the queue | M |
| :109-110 | order_components | 10 cols | **no filter, no order** | fetchAllRows | **FT, entire table (~30–50k)** | M |
| :111-112 | shipments | 7 cols | **no filter, no order** | fetchAllRows | **FT** | M |
| :134-138 | salesperson | 7 cols | eq email | – | – | M (serial, before the three above) |

#### ScanStationPage.jsx / ScanStation.jsx / ScanStationOrders.jsx
| File:line | Table/RPC | Columns | Filters | Paged? | FT? | When |
|---|---|---|---|---|---|---|
| ScanStationPage.jsx:56-60 | salesperson | 3 | eq email | – | – | M |
| ScanStationPage.jsx:89 → qcHistory:41-45 | qc_records | 17 cols | eq inspected_by, order created_at desc | **no (1000 cap, silent)** | all of that inspector's history | M of the QC tab |
| ScanStation.jsx:258 → barcodeService:1435 | production_vendors | 7 | status=approved | no | small | M |
| ScanStation.jsx:309 → qcHistory:41 | qc_records | 17 | eq inspected_by | no | **all of that inspector's history, only to count today** | M when the QC / Final QC station is selected |
| ScanStation.jsx:63-67 | orders | id, order_no | `ilike '%barcode%'` limit 1 | – | leading-wildcard scan | A (master-barcode scan) |
| ScanStation.jsx:381 → barcodeService:1064-1067 | order_components | barcode | `ilike '%-x'` | – | leading-wildcard scan | A (prefix-less input only) |
| ScanStation.jsx:387/449/575/729/754/988/1330 → :1078 | order_components + orders embed | `*` | eq barcode | – | – | A (every scan) |
| ScanStation.jsx:395-402 | stage_transitions | scanned_at | component_id, transition_type, order desc limit 1 | – | – | A (security gate) |
| ScanStation.jsx:423 → :1548 | external_movements | 5 | component_id, status=configured limit 1 | – | – | A |
| ScanStation.jsx:453/789/797 → RPC advance_component_stage | RPC | – | – | – | – | A (a 350ms retry sleep at :796) |
| ScanStation.jsx:530/611/687/731/1342 → :1015 | order_components | `*` | eq order_id | – | – | A |
| ScanStation.jsx:902/944 → RPC record_qc_result | RPC | | | | | A |
| ScanStation.jsx:988-994 | order_components (again) + RPC get_production_head_email | | | | | A (QC fail: **re-fetches a component it already has**) |
| ScanStation.jsx:1070 / 1108 / 1193 / 1246 | RPCs security_guard_scan / activate_components / verify_packaging_components / create_shipment | | | | | A |
| ScanStation.jsx:1204-1223 | RPC advance_component_stage **×2 per barcode, serial** | | | | | A (dispatch) |
| ScanStation.jsx:1330-1343 | component, enrich, transitions, movements, order components, enrich | | **6 serial awaits** | | | A (view detail) |
| ScanStationOrders.jsx:118-120 | orders | 21 cols, no items (:40-44) | order created_at | fetchAllRows | **FT all orders** (private/B2B filtered in JS :130-134) | M of the "All Orders" tab |
| ScanStationOrders.jsx:147-150 | vendors | 3 | in(id) | – | – | M (after orders) |
| ScanStationOrders.jsx:272-276 | order_components | 17 | in(order_id, ≤20 page ids) | – | – | M / on page change (batched, good) |

#### InventoryDashboard/**
| File:line | Table | Columns | Filters | Paged? | FT? | When |
|---|---|---|---|---|---|---|
| InventoryDashboard.jsx:179-183 | salesperson | 3 | eq email | – | – | M |
| :207-209 | products_live | **`*`** | order name | fetchAllRows | **FT (P rows)** | M; again after every AddProduct save (:1343) |
| :238-239 | product_variants | 3 | **no order** | fetchAllRows | FT | M (awaited after products: serial) |
| :258-259 | product_channel_stock | 3 | **no order** | fetchAllRows | FT (~3P) | M (fired after products) |
| :284-345 | shopify-inventory edge fn + product_variants read/update per product | | | | | A ("Sync LXRTS", :365). N+1: one fetch, one read and k serial updates per product. |
| :423-427 / :467-487 / :569-572 | products / product_variants updates, edge fn | | | | | A |
| StockOrdersTab.jsx:107-109 | orders | **`*`** | is_stock_order=true, order created_at | fetchAllRows | all stock orders, JS channel filter `retail_stock` (:113) | M of the tab |
| StockOrdersTab.jsx:220-223 | orders update | | | | | A |
| StockCalendarTab.jsx:43-45 | orders | **`*`** | is_stock_order=true, order delivery_date | fetchAllRows | the same set as StockOrdersTab, **fetched again** | M of the tab |

#### StockRoom/**
| File:line | Table | Columns | Filters | Paged? | FT? | When |
|---|---|---|---|---|---|---|
| stockRoomData.js:51-55 | salesperson | 7 | eq email | – | – | M |
| :80 | products_live | PRODUCT_COLUMNS (18, :32-34) | order id | fetchAllRows | FT | M, after every stock action (reloadStock), after every Shopify pull that changed anything |
| :81-82 | product_variants | 5 | order id | fetchAllRows | FT | same |
| :83 | warehouses | 3 | is_active | – | small | same |
| :84-85 | warehouse_stock | 4 | order id | fetchAllRows | FT | same |
| :98-99 | orders | 11 incl. **items**, warehouse_urls | is_stock_order=true | fetchAllRows | all stock orders; JS channel filter + JS sort (:101-103) | M, and on refresh |
| :111-112 | orders | 8 incl. **items** | created_at ≥ now-90d, not stock | fetchAllRows | 90 days of orders (longer if the user widens the period) | M |
| :134 | stock_room_location | `*` | order | – | small | M (serial before the 4 below) |
| :140-141 | stock_room_placed | 4 | ordered | fetchAllRows | FT | M, after every action |
| :142 | stock_room_movement | **`*`** | order id desc | fetchAllRows | **FT, append-only ledger, grows forever** | M, **after every stock action** |
| :143 | stock_room_collection | 2 | | – | small | M |
| :144-145 | stock_room_product_collection | 2 | ordered | fetchAllRows | FT | M |
| :169 | stock_room_* RPCs | | | | | A |
| :236 / :277 | products | sku_id | like 'SKU-%' / not null | fetchAllRows | FT **to compute MAX in JS** | A (open ProductEditor / Import) |
| :248 | products | top_options, bottom_options | | fetchAllRows | FT | A (editor/import open) |
| :268-271 | products `*` / product_variants | | by id | – | – | A |
| :283 | products_live | **`*`** | | fetchAllRows | FT | A (export) |
| :288 | products_live | 3 | | fetchAllRows | FT | A (editor/import open) |
| :310-352, :364-370 | products/product_variants writes; **serial insert per imported row** | | | | | A |
| stockRoomShopify.js:136-145 | edge fn per LXRTS product (concurrency 6) + product_variants update per changed size | | | | | M (after catalogue load) + **poll every 60s, runs if older than 4.5 min** (StockRoom.jsx:178) + on focus if older than 60s (:177) |

#### Shared components (non-B2B)
| File:line | Table/RPC | Columns | Filters | Paged? | FT? | When |
|---|---|---|---|---|---|---|
| NotificationBell.jsx:95 → notificationService:544-567 | notification_recipients + notification embed | 5 + 10 | recipient_email, order desc, **limit 50**, search via ilike on embed | – | no | M, on filter/search change (300ms debounce), on every realtime INSERT |
| NotificationBell.jsx:101 → :625-629 | notification_recipients | count head | email, read=false | – | no | same (serial after the list) |
| NotificationBell.jsx:119-135 | **realtime** channel `notifications-realtime`, INSERT on notification_recipients filtered by recipient_email | | | | | M; **torn down and re-subscribed whenever fetchNotifications changes identity** (activeFilter / searchTerm) |
| UpdateBanner.jsx:30, :42 | fetch `/version.json` | | | | | M + **every 5 min** (CHECK_MS :19) + on focus/visibilitychange |
| QcReportModal.jsx:34-38 | qc_records | 12 | eq order_id | – | no | A (open) |
| ComponentJourneyModal.jsx:84-95 → barcodeService:1122/:1566 | stage_transitions `*` + external_movements, **per component** | | eq component_id | – | no | A. **N+1 (2 × pieces, parallel)** |
| ProductionHeadVendors.jsx:155 | production_vendors approved + all | | | – | small (the approved set is a subset of all, so this is a redundant fetch) | M |
| ProductionHeadVendors.jsx:176 → barcodeService:1609 / :1635 | external_movements (all) + orders (serial 100-chunks) | | | fetchAllRows | **FT**; then JS channel/order filter (:180-186) | A (history tab click, :440) and after actions (:306) |
| ProductionHeadVendors.jsx:258/275/355-356 | external_movements, order_components by barcode | | | – | – | A (355 is debounced 400ms while typing) |
| ProductionOverrides.jsx:59 | order_components `*` + enrich | | eq order_id | – | – | A |
| ProductionOverrides.jsx:88-92 | orders | id, order_no | **ilike '%q%'** limit 1 | – | leading wildcard | A |
| ProductionOverrides.jsx:273-280 | order_components update | | | | | A |
| OverrideHistory.jsx:48 → barcodeService:1730 | stage_overrides | **`*`** | order created_at desc | fetchAllRows | **FT** (grows forever) | M |
| FactoryPause.jsx:25 | factory_pause | `*` | resumed_at null limit 1 | – | – | M |
| ReplacementApprovals.jsx:44 | replacement_requests | `*` | status=pending | – | small | M |
| VendorApprovals.jsx:31 | production_vendors pending + all | `*` | | – | small, redundant | M |
| VendorRequest.jsx:26 | production_vendors | `*` | | – | small | M |
| ExhibitionApprovals.jsx:53 | exhibitions pending + all | `*` | | – | small | M |
| ExhibitionPanel.jsx:54 | exhibitions | `*` | created_by | – | small | M |
| ExhibitionPanel.jsx:60-63 | orders | 12 money/status cols | in(exhibition_id) **no order** | fetchAllRows | all of the user's exhibition orders | M (serial after exhibitions) |
| ExhibitionPanel.jsx:150-154 | salesperson | 6 | | – | – | A |
| WalkInsView.jsx:49 | salesperson | email, store_name | **no filter** | – | whole table (small) | M when the host passes none |
| WalkInsView.jsx:63-65 | walkins | 11 | order created_at | fetchAllRows | **FT** | M, and **again whenever the `orders` prop changes identity** (:79) |
| WalkInsView.jsx:67 → walkinConversion:79-85 | walkins UPDATE | | eq id | – | – | **M: a serial write per changed row inside a read path** |
| LabelDesigner.jsx:91-108 | products_live | 2 | limit 1 (twice, serial fallback) | – | – | M |
| LabelDesigner.jsx:117-122 | products_live | 2 | ilike or, limit 20 | – | – | A |
| DeliveryPaymentModal.jsx:59-64 | shipments `*`+embed, order_components, order_payments | | eq order_id (parallel) | – | – | M (modal open) |
| AlterationModal.jsx:205-214 | storage `attachments` | | | | | A |
| stock/StockPanel.jsx:117-119 | product_channel_stock | 3 | **no filter/order** | fetchAllRows | FT (~3P) | M |
| StockPanel.jsx:125 | warehouses | 2 | is_active | – | small | M |
| StockPanel.jsx:126-128 | warehouse_stock + products(name, sku_id) | | **no order** | fetchAllRows | FT | M |
| StockPanel.jsx:133-135 | consignment_inventory | 4 qty cols | **no order** | fetchAllRows | **FT only to SUM 4 columns in JS** (:175-186) | M |
| StockPanel.jsx:201-212 | products_live | 3 | in(id, 200-chunk) **serial** | – | – | M (after the above) |
| stock/WarehouseTab.jsx:45 | warehouses | `*` | is_active | – | small | M |
| WarehouseTab.jsx:49 | products_live | 3 | order name | fetchAllRows | FT (for a dropdown) | M |
| WarehouseTab.jsx:71-74 / :213-217 | warehouse_stock | `*`+products embed | eq warehouse_id | – | – | A |
| WarehouseTab.jsx:125-188 | warehouses/warehouse_stock writes, **serial per item** (:142-154) | | | | | A |
| stock/StockExchangeTab.jsx:39-41 | stock_exchanges + 2 warehouse joins | `*` | order created_at | fetchAllRows | **FT** (list rendered unpaginated, :337) | M |
| StockExchangeTab.jsx:52 / :56 | warehouses / products_live (all) | | | fetchAllRows | FT | A (open form) |
| StockExchangeTab.jsx:79-83 | warehouse_stock | | warehouse_id, qty>0 | – | – | A |
| StockExchangeTab.jsx:146-210 | stock_exchanges insert, items insert, **per item: select+update source, select+update/insert dest (serial, non-atomic)** | | | | | A |
| StockExchangeTab.jsx:229-232 | stock_exchange_items + products embed | `*` | exchange_id | – | – | A |
| AddProduct.jsx:40-42 (`fetchNextSku`) | products | sku_id | like 'SKU-%', **no order** | fetchAllRows | **FT to compute MAX in JS** | M |
| AddProduct.jsx:268-269 | products | top_options, bottom_options | **no filter/order** | fetchAllRows | FT | M (serial after the SKU fetch) |
| AddProduct.jsx:281-292 | colors, dupatta_colors | | | – | small | M (serial) |
| AddProduct.jsx:378, 660-928, 1173 | products / product_variants writes | | | | | A |
| AddProduct.jsx:572-573 | products_live | 3 | **no order** | fetchAllRows | FT for a duplicate-name check | A (every save) |
| AddProduct.jsx:1007-1010 | products_live | **`*`** | sync_enabled=false | fetchAllRows | FT | A (CSV export) |
| AddProduct.jsx:1076 / :1124 | products_live / products | 2 / 1 | | fetchAllRows | FT | A (CSV import) |
| BarcodeExportPanel.jsx:58-61 | products | id, sku_id | is_draft, like 'SKU-%' **no order**; JS sort (:68) | fetchAllRows | all drafts | M |
| BarcodeExportPanel.jsx:94 / :133-139 | RPC reserve_sku_rows / products_live ilike limit 50 | | | | | A |

---

### 3. Flags

#### 3a. `select("*")` on orders
- **StockOrdersTab.jsx:108** and **StockCalendarTab.jsx:44**: `select("*")` on every stock order, `items` included. Both tabs fetch the same set independently, and it is fetched again on every tab switch because the tab unmounts.
- WarehouseDashboard, PackagingDashboard and ScanStationOrders use explicit column lists (good). The ScanStationOrders.jsx comment at ~:55 that says "WarehouseDashboard does select('*')" is now stale.
- Other `*` reads on growable tables: `fetchOrderComponents` (barcodeService:1017), `fetchComponentByBarcode` (:1034 COMPONENT_SELECT), `fetchTransitionHistory` (:1124), stage_overrides (:1730), stock_room_movement (stockRoomData:142), products_live (InventoryDashboard:208, stockRoomData:283, AddProduct:1008).

#### 3b. Full-table downloads (fetchAllRows or equivalent)
| Where | Table | Est. rows now | Why it's avoidable |
|---|---|---|---|
| WarehouseDashboard.jsx:339 | orders + items | ~10k (10 serial pages, multi-MB) | The list is paginated at 5/page (:177) but filtered and sorted in JS. Move status/search/date/type/store/sort to the server with `.range()` + `count: 'exact'`, or an RPC/view. Do the private/B2B filter (:350-358) server-side. |
| PackagingDashboard.jsx:107 | orders + items + addresses | ~10k | The queue only needs `status in (completed, dispatched, delivered)`: `.in("status", DISPATCH_STATUSES)` server-side. Analytics needs all orders in the period, so load that lazily on the Analytics tab and bound it by `created_at`. |
| PackagingDashboard.jsx:109 | order_components | **~30–50k (30–50 serial pages)** | Only used for per-order piece lists on the current page (20 rows) and for analytics. Fetch by `.in(order_id, pageIds)` like ScanStationOrders does, plus a server aggregate for analytics. |
| PackagingDashboard.jsx:111 | shipments | grows 1:1 with dispatched orders | Filter by the order ids on screen, or join shipment status into the orders query. |
| ScanStationOrders.jsx:118 | orders (no items) | ~10k | Same pattern as Warehouse. Server-side paging. |
| WarehouseDashboard.jsx:515-547 | order_components for every channel order | ~15–50k via ~25–50 **serial** `.in(200)` requests | Filter by `channel_key` (the column exists on order_components, :530 selects it) and `stage_updated_at` in period, instead of shipping order-id lists. Better still, a `GROUP BY stage, is_outside_wh` count RPC, since StageCountCards only needs counts. |
| qcHistory.js:53-62 (Warehouse QC tab) | qc_records | channel's whole history | `qc_records.channel_key` exists (QC_RECORD_COLUMNS :12), so query `.eq/in('channel_key', …)` + `.range()`. |
| reJourneys.js:43-53 | order_components (rework) | small result but 25–50 serial requests | Use `.eq('is_rework',true).eq('is_active',true).in('channel_key',…)`: one request. |
| barcodeService:1609 (`fetchAllMovements`) | external_movements (all) + orders chunks | grows forever | PHV filters to retail/b2b and period **in JS** (ProductionHeadVendors.jsx:180-186). Filter server-side by channel_key / created_at. |
| barcodeService:1730 (OverrideHistory) | stage_overrides `*` | grows forever | Server-side period filter + `.range()` paging (it already has a Paginator). |
| InventoryDashboard.jsx:207, :238, :258 | products_live `*`, product_variants, product_channel_stock | P, ~kP, ~3P | Acceptable at catalogue size. Trim `*` to rendered columns. Add `.order("id")` to the two unordered ones. |
| StockOrdersTab:107, StockCalendarTab:43, stockRoomData:98 | orders (stock) | all stock orders ever | Filter by prefix server-side (`order_no like 'SB-STOCK-%'`) instead of JS `getOrderChannelKey` (:113 / :56 / :101). Share one fetch across the two Inventory tabs. |
| stockRoomData.js:111 | orders + items, 90 days | ~2–3k | Only `salesSummary` uses it. A server-side aggregate (product × day sold) would avoid shipping `items`. |
| stockRoomData.js:142 | stock_room_movement `*` | append-only | Page it (MovementsScreen already shows in 50s via `usePaged`), and don't re-read it in `reloadStock` after every action. |
| StockPanel.jsx:133 | consignment_inventory | all | Only 4 SUMs are used (:175-186). Do this as a server aggregate / RPC. |
| StockPanel.jsx:117 | product_channel_stock | ~3P | It fetches all channels and then drops the unwanted ones in JS (:147-152). Add `.in("channel_key", wantedKeys)`. |
| AddProduct.jsx:40, stockRoomData.js:236 (duplicated `fetchNextSku`) | products.sku_id | P | Pages the whole table to compute MAX. Replace with an RPC / `order by` a numeric expression limit 1, or a sequence. It's the same function in two places. |
| AddProduct.jsx:268, stockRoomData.js:248 | products top/bottom options | P | A `distinct unnest` RPC. |
| WalkInsView.jsx:63 | walkins | all | Host-provided `orders` are also a full download (this component needs every order's phone). |
| WarehouseTab.jsx:49, StockExchangeTab.jsx:56 | products_live (for a dropdown) | P | Use a search-as-you-type combobox (like LabelDesigner.jsx:117) instead of preloading the catalogue. |

#### 3c. JS-side filter / sort / sum / count the DB could do
- WarehouseDashboard.jsx:350-358: private/B2B-approval filter. :632-661: status tabs. :663-766: search, date, priority, type, store, stage, salesperson, sort (regex on order_no, :738-755). :792-812: tab counts (5 full passes over all orders). :975-999: calendar buckets. :235-241: distinct salespersons.
- PackagingDashboard.jsx:189-192: status filter. :224-242: search/filter. :252-257: 4 counts. :261-264: channel options.
- ScanStationOrders.jsx:130-134: private/B2B filter. :194-235: channel/search/period filtering.
- **Correctness:** the ScanStationOrders status-tab filter (:220-228) needs components that are only loaded for the current page. Every other order falls back to order-level signals, so the counts and filter are approximate.
- ScanStation.jsx:304-316: pulls the inspector's whole QC history to count *today's* pass/fail. Use `.gte("created_at", startOfDay)` with `count: 'exact', head: true` (two head counts).
- InventoryDashboard.jsx:594-634: filter/sort (fine at P scale). :682+: stats.
- StockPanel.jsx:175-186: SUM. :147-152: channel filter.
- ProductionHeadVendors.jsx:180-186: channel/order filter after downloading everything.
- BarcodeExportPanel.jsx:68: numeric sort in JS.
- stockRoomData.js:101-103: JS channel filter + sort (the query already orders by id; it could order by created_at desc).

#### 3d. N+1 / serial loops
| Location | Pattern | Count |
|---|---|---|
| WarehouseDashboard.jsx:1094-1102 → :395 | one order_components query **per visible card** (+ enrich each) | 5 per page; ScanStationOrders.jsx:272 already does it in one `.in()` |
| WarehouseDashboard.jsx:523-532 | serial `for` over 200-id chunks | ~25–50 serial requests |
| qcHistory.js:53, reJourneys.js:43 and :82 | serial chunk loops | same as above |
| barcodeService:1631-1638 | serial orders fetch per 100 movement ids | movements/100 |
| barcodeService:1586-1593 | serial per 500 ids | small |
| ScanStation.jsx:1204-1223 | 2 serial RPCs per barcode on dispatch | 2 × pieces (each a network round trip; a 5-piece order = 10 serial RPCs, then create_shipment). A single batch RPC would make it atomic too. |
| ScanStation.jsx:1330-1343 | 6 serial awaits for "view component" | parallelize transitions / movements / order components |
| ScanStation.jsx:988 | re-fetches the component already in hand | 1 wasted request per QC fail |
| ComponentJourneyModal.jsx:84-95 | 2 requests per component (parallel) | 2N; replace with `.in("component_id", ids)` ×2 |
| walkinConversion.js:79-85 (WalkInsView mount) | serial UPDATE per changed walk-in | unbounded on first run; a write on a read path |
| StockExchangeTab.jsx:173-210 | per item: select+update source, select+update/insert dest | 4 serial per item, **non-atomic** (should be an RPC) |
| WarehouseTab.jsx:142-154 | serial update/insert per item | N |
| stockRoomData.js:364-370 (`importProducts`) | serial insert per CSV row | N; use a batch insert |
| InventoryDashboard.jsx:280-345 | per LXRTS product: edge fn + variants select + serial per-variant updates | action-only (good), still N×k |
| stockRoomShopify.js:131-146 | per LXRTS product edge fn (6 concurrent) + per-variant update | runs on mount + on a poll |
| StockPanel.jsx:201-212 | serial 200-id products_live chunks | small |

#### 3e. Same data fetched by several panels on one dashboard
- **WarehouseDashboard**: `order_components` is fetched three ways: per card (:395), for the Overview channel (:526), and for Re-journeys (reJourneys.js:45). There is no shared cache. Overview components are re-fetched every time `scopedOrders` changes identity, which happens after each `fetchOrders()`.
- **WarehouseDashboard → ScanStation tab**: switching away from Scan triggers a full orders re-download (:593-596) plus clearing the component cache.
- **PackagingDashboard**: the same `components` array feeds DeliveryPerformancePanel and ProductionOverview (good, shared), but the queue list also re-derives from it.
- **InventoryDashboard**: StockOrdersTab (:107) and StockCalendarTab (:43) fetch the identical stock-order set separately, and again on every tab switch. WarehouseTab (:49) and StockExchangeTab (:56) each preload all of products_live even though InventoryDashboard already holds `products` (:207) in state.
- **ScanStationPage**: ScanStation's QC seed (ScanStation.jsx:309) and the QC History tab (ScanStationPage.jsx:89) run the same `fetchQcRecords({inspectedBy})`. They are on different tabs and not cached, so switching tabs refetches.
- **ProductionHeadVendors**: `fetchApprovedVendors` + `fetchAllVendors` in parallel (:155). The approved list is a subset of all. VendorApprovals.jsx:31 has the same pending-vs-all redundancy.
- **AddProduct + StockRoom**: `fetchNextSku` and the product-options scan are duplicated (AddProduct.jsx:34-54 / stockRoomData.js:235-262).

#### 3f. useEffect dependency problems
- **WarehouseDashboard.jsx:757**: `filteredOrders` memo deps omit `ordersPeriodRange` and `inOrdersPeriod` (used :682-689). Likely a stale filter, which is a real bug. The page reset at :1104-1106 also omits the period.
- **WarehouseDashboard.jsx:1094-1102**: effect on `[currentOrders]`, but `currentOrders` is a fresh `.slice()` each render (:1091, not memoized). The effect runs **every render**. It's guarded by map checks, so the cost is CPU and no extra requests, but it reads stale `orderComponentsMap`/`componentLoadingMap` from the closure.
- WarehouseDashboard.jsx:439-460, 515-547: depend on `scopedOrders`. Any orders refetch while the QC, Re-journeys or Overview tab is open re-runs the whole chunked download.
- WarehouseDashboard.jsx:588-599: eslint-disabled. Calls `fetchOrders` (not memoized).
- NotificationBell.jsx:116-138: the realtime effect depends on `fetchNotifications`, which changes with `activeFilter`/`searchTerm`, so the socket channel is **removed and re-created** on every filter toggle or debounced search. Each realtime INSERT then fires 2 serial queries (:95-102) that could run in parallel.
- WalkInsView.jsx:59-79: depends on the `orders` prop. Any parent refetch that produces a new array re-downloads all walk-ins and re-runs the write loop.
- InventoryDashboard.jsx:594-634: eslint-disabled; `getStock` is closed over (acceptable because `variantInventory` is listed).
- StockRoom.jsx:174-186: interval re-created on every `shopifySync.result` change (benign).
- AddProduct.jsx:237-298: 4 **serial** awaits on mount (SKU scan, options scan, colors, dupatta colors). They are independent, so run them with `Promise.all`.

#### 3g. Polling / realtime
| Component | Mechanism | Frequency | Cost per tick |
|---|---|---|---|
| UpdateBanner.jsx:19, :42-45 | `setInterval` fetch `/version.json` + focus/visibility | 5 min + every focus | 1 tiny static GET. Negligible. |
| NotificationBell.jsx:119-135 | Supabase realtime `postgres_changes` INSERT on notification_recipients, `recipient_email=eq.<me>` | event-driven | 2 queries (limit 50 + head count) per notification. Re-subscribes on filter change. It is in DashboardHeader, so it's on 23 dashboards (every in-scope dashboard). |
| StockRoom.jsx:174-186 | `setInterval` 60s, pulls Shopify if the last pull is older than 4.5 min, plus focus if older than 60s | ~5 min while visible | one edge-fn call per LXRTS product (6 concurrent) + variant updates. **If anything changed, a full catalogue reload** (4 fetchAllRows, StockRoom.jsx:106). |
| (none else in scope) | No polling in Warehouse, Packaging or ScanStation. ScanStation has no realtime, so the lists are stale until a manual refresh or tab switch. | | |

---

### 4. Load cost per screen (on mount)

| Screen | Mount sequence | Approx rows / payload | Computed in browser |
|---|---|---|---|
| **PackagingDashboard** | getSession → salesperson (serial) → `Promise.all` of 3 `fetchAllRows` (each internally serial) | orders ~10k (≈10 pages, with items + addresses) + components **~30–50k (30–50 pages)** + shipments (~N pages). **Wall time ≈ the slowest chain, ~30–50 serial round trips.** Tens of MB of JSON. | componentsByOrder / shipmentsByOrder maps over all rows, filters, 4 counts, channel labels, DeliveryPerformance + ProductionOverview over all orders/components |
| **WarehouseDashboard** (generic warehouse user) | getSession → salesperson → orders (~10 serial pages, with items) → per-card component fetch ×5 (parallel) + enrich | ~10k orders (multi-MB due to items/attachments) + 5×~5 components | visibleOrders, filteredByStatus, filteredOrders (search/sort with regex per compare), tabCounts (5 passes), calendar buckets, salespersons set |
| **WarehouseDashboard** (Production Head, Overview tab default) | the above, then **~25–50 serial** `order_components .in(200)` requests + enrich chunks | all channel components (~15–50k rows) on top of orders | scopeOrdersToDesignation, period filter over all components, classifyComponentForStageCard per component, StageCountCards (3 memo passes), ProductionOverview (4 passes) |
| Warehouse QC / Re-journeys tabs | 25–50 serial `.in(200)` requests (qc_records), or the same plus a second chunk pass (re-journeys) | full channel QC history | JS sort, filters, summary |
| **ScanStationPage** (Scan tab) | getSession → salesperson → ScanStation mount: vendors (1) + inspector QC history (unpaged, ≤1000) if on the QC station | small | today's count over the full history |
| ScanStationPage "All Orders" tab | orders fetchAllRows (~10 serial pages, no items) → vendors → per-page components (1 batched) | ~10k lighter rows | channel options, filtering over all orders |
| **InventoryDashboard** (Inventory tab) | salesperson → products_live `*` (P/1000 pages) → [channel stock (not awaited) ‖ variants (awaited)] | P×(all cols) + 3P + variants | filter/sort/stats over P; paginated at 15 |
| Inventory → Stock Orders / Calendar | orders `*` stock (all) per tab | all stock orders, full rows | JS channel filter |
| Inventory → Warehouses / Exchanges | products_live all (+warehouses) / stock_exchanges all | P / all exchanges | exchanges list **not paginated** |
| Inventory → Add Product | **4 serial**: products sku scan (P), products options scan (P), colors, dupatta_colors + BarcodeExportPanel drafts (P-ish) + LabelDesigner (2 serial limit-1) | ~2P+ | MAX(sku) and option-set build in JS |
| **StockRoom** | salesperson → in parallel: stock orders (all, with items), 90-day sales (with items), ledger (location **then** 4 parallel fetchAllRows incl. the full movement log), catalogue (4 parallel fetchAllRows) → then the Shopify pull (per-LXRTS edge fn) → possibly a second full catalogue load | P + variants + warehouse_stock + placed + **all movements** + ~2–3k orders with items + all stock orders | `useStockRoomView` model (stockRoomModel.js 694 lines) derives stock, sales and notices. Lists use `usePaged` (50 at a time). |
| StockPanel (10 dashboards) | 3 parallel fetchAllRows (channel stock, warehouse stock + join, consignment) → serial products_live chunks | 3P + warehouse_stock + all consignment rows | SUM, pool folding |
| OverrideHistory (PM/Admin/GM) | stage_overrides `*` all | grows forever | period filter + paging in JS |
| WalkInsView (Admin/CMO/WalkIn) | salesperson (all) ‖ walkins all → **serial UPDATE loop** | all walk-ins + host's all-orders prop | phone-set reconcile |
| NotificationBell (everywhere) | list (limit 50) → count (serial) + socket | 50 rows | trivial |

---

### 5. Rendering

#### 5a. Huge components (line counts)
- ScanStation.jsx **2044**
- WarehouseDashboard.jsx **1958**
- AddProduct.jsx **1849**
- InventoryDashboard.jsx **1361**
- barcodeService.js 1802 (util)
- ProductionHeadVendors.jsx 695
- stockRoomModel.js 694
- ProductionOverrides.jsx 594
- AlterationModal.jsx 588
- StockActionForm.jsx 540
- StockPanel.jsx 524
- PackagingDashboard.jsx 513
- StockOrdersTab.jsx 513

WarehouseDashboard and ScanStation hold dozens of `useState`s in one component, so any keystroke re-renders the whole tree, including the calendar and the (memoized) filters.

#### 5b. Lists without pagination or virtualization
- StockExchangeTab.jsx:337: `filteredExchanges.map` over **all** exchanges, with no Paginator.
- WarehouseTab.jsx:335-340: expanded warehouse stock list, all rows for the warehouse, unpaginated.
- WarehouseDashboard.jsx:1864-1890: calendar day list, all orders for that date, unpaginated (usually small).
- DeliveryPerformancePanel.jsx: `drillRows` (perf[drill].orders) rendered in full; check the table below :50. It can be every late order in the period.
- Paginated (OK): WarehouseDashboard orders (5/page, :1779), Packaging (20/page), ScanStationOrders (20), InventoryDashboard (15), QcHistoryPanel, ReJourneyPanel, ExternalVendorsPanel, ProductionHeadVendors, OverrideHistory, WalkInsView (15), StockPanel, InventoryOverviewTab, StockRoom (`usePaged` 50-step, StockRoomUi.jsx:358-370).

#### 5c. Heavy derived calcs without useMemo
- WarehouseDashboard.jsx:1864, :1868, :1872: `visibleOrders.filter(getWarehouseDateForCalendar(...) === selectedCalendarDate)` computed **three times per render** over all ~10k orders, each doing date math. Memoize once.
- WarehouseDashboard.jsx:1089-1091: `totalPages` / `currentOrders` not memoized. Cheap, but this is what feeds the every-render effect in 3f.
- InventoryDashboard.jsx:637-640: pagination slice not memoized (cheap).
- StockRoom/ProductDetail.jsx:69: `ledger.movements.filter(product)` per render over the **entire movement log**. Memoize, or index by product in `useStockRoomView`.
- WarehouseDashboard filteredOrders sort (:745-755): `getOrderNum` runs a regex twice per comparison. Precompute a sort key per order once (O(n log n) regex calls → O(n)).
- The other panels in scope (StageCountCards, ProductionOverview, DeliveryPerformancePanel, QcHistoryPanel, ReJourneyPanel, ExternalVendorsPanel, StockPanel, InventoryOverviewTab) are properly memoized.

---

### 6. Suggested fix order (highest payoff first)
1. **PackagingDashboard:** filter orders server-side by the dispatch statuses, fetch components/shipments only for the page's order ids, and load analytics lazily on its tab with the period bound in the query.
2. **WarehouseDashboard Overview / QC / Re-journeys:** query by `channel_key` (it already exists on order_components and qc_records) instead of serial 200-id chunks. Use a count RPC for the stage cards. This also fixes the silent 1000-row truncation per chunk.
3. **WarehouseDashboard + ScanStationOrders order lists:** move filter, sort and paging to the server, and drop `items` from the list query (fetch it per expanded card). Batch component fetches per page as ScanStationOrders already does.
4. Add `.order("id")` to every unordered `fetchAllRows` call (listed in §0.3). Page `fetchQcRecords({inspectedBy})`, or bound it by date.
5. **StockRoom:** stop re-reading the full `stock_room_movement` log in `reloadStock` and page it instead. Push sales aggregation to the server.
6. Replace the serial write loops (packaging dispatch, stock exchange, walk-in reconcile, CSV import) with batch RPCs. This makes them atomic too.
7. Fix the WarehouseDashboard.jsx:757 memo deps, which is a correctness bug.

---

## Appendix E — Database-side performance audit (read-only, repo SQL only)

Scope: `db/**` (129 .sql files: top-level `db/*.sql`, `db/barcode_system/*.sql` baseline dumps, `db/barcode_system/v2/01..94_*.sql`, `db/exhibitions/`, `db/otp/`), `supabase/functions/**`. There is **no `supabase/migrations/`** directory. No DB connection was made.

**Big caveat up front.** The base tables `orders`, `order_components`, `products`, `product_variants`, `salesperson`, `profiles`, `stage_transitions`, `qc_records`, `notifications`, `notification_recipients`, `invoices`, `audit_log`, `escalation_alerts`, `otp_codes`, `vendors` are **not created anywhere in the repo**. They were made in the dashboard, so their PKs, FKs, unique keys, indexes and RLS are **not in the repo**. Every "no index" below means "not in the repo". The live DB may have more (for example, memory says `order_components.barcode` has a unique key on live, and `advance_component_stage` looks it up by `WHERE barcode = p_barcode`). Before building indexes, run `SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN (...)` on PROD **and** UAT.

---

### 1. Every CREATE INDEX in the repo

| file:line | table | columns / predicate |
|---|---|---|
| db/barcode_system/v2/03_event_driven_validity.sql:39 | component_stage_progress | (component_id). The table also has UNIQUE(component_id, step) at :36 |
| db/barcode_system/v2/09_external_movement_and_vendors.sql:43 | external_movements | (component_id) |
| db/barcode_system/v2/09_external_movement_and_vendors.sql:191 | vendor_failure_ledger | (vendor_id) |
| db/barcode_system/v2/15_replacement_journey.sql:34 | replacement_requests | (status) |
| db/barcode_system/v2/15_replacement_journey.sql:35 | replacement_requests | (component_id) |
| db/barcode_system/v2/54_b2b_stock_orders.sql:140 | **orders** | (is_b2b, is_stock_order) WHERE is_stock_order = TRUE |
| db/barcode_system/v2/61_qc_records_channel_key.sql:181 | **qc_records** | (channel_key, created_at DESC) |
| db/barcode_system/v2/62_order_components_channel_key.sql:111 | **order_components** | (channel_key) |
| db/barcode_system/v2/71_stock_order_receipts.sql:128 | stock_receipts | (product_id). Also UNIQUE(order_id, item_index) at :114 |
| db/barcode_system/v2/71_stock_order_receipts.sql:130 | stock_receipts | (channel_key, received_at DESC) |
| db/barcode_system/v2/74_reserve_sku_rows.sql:76 | **products** | (is_draft) WHERE is_draft = true |
| db/barcode_system/v2/78_shipments.sql:152 | shipments | (order_id, created_at) |
| db/barcode_system/v2/78_shipments.sql:153 | shipments | (status). Also UNIQUE blitz_order_code (:132) and UNIQUE awb (:133) |
| db/barcode_system/v2/78_shipments.sql:170 | shipment_components | (component_id). PK is (shipment_id, component_id) at :167 |
| db/barcode_system/v2/78_shipments.sql:240 | order_payments | (shipment_id) |
| db/barcode_system/v2/90_stock_order_production_head.sql:54 | **orders** | (production_head_designation) WHERE NOT NULL |
| db/barcode_system/v2/93_cancel_order_components.sql:59 | **order_components** | (order_id) **WHERE cancelled_at IS NULL** (partial, see note) |
| db/comms_dashboard.sql:37 | **orders** | (is_comms) WHERE is_comms = TRUE |
| db/comms_dashboard.sql:38 | **orders** | (comms_engagement_type) WHERE is_comms = TRUE |
| db/comms_dashboard.sql:60 | comms_pr_performance | (order_id). Also UNIQUE(order_id) at :57, so this index is redundant |
| db/comms_dashboard.sql:89 | comms_calendar_events | (user_email, event_date) |
| db/comms_dashboard.sql:128 / :131 | comms_inventory_blocks | (product_id, status) WHERE product_id NOT NULL; (variant_id, status) WHERE variant_id NOT NULL |
| db/comms_inventory_blocks.sql:33-35 | comms_inventory_blocks | (product_id) WHERE active; (variant_id) WHERE active; (status, end_date). This file overlaps comms_dashboard.sql:106-133 (same table defined twice, so there may be duplicate indexes) |
| db/exhibitions/01_exhibitions_schema.sql:28-29 | exhibitions | (status); (created_by) |
| db/exhibitions/01_exhibitions_schema.sql:34 | **orders** | (exhibition_id) |
| db/order_payments.sql:29-31 | order_payments | (order_id); (paid_at); (payment_mode) |
| db/products_store_category.sql:31 | **products** | (store_category) |
| db/walkins.sql:38-40 | walkins | (sa_email); (created_at); (phone) |
| db/website_orders.sql:37 | **orders** | UNIQUE (shopify_order_id) WHERE NOT NULL |
| db/website_orders.sql:80 | **orders** | (order_no text_pattern_ops). Serves `LIKE 'SB-SHOPIFY-%'` prefix only |
| db/website_orders.sql:84 | **orders** | (web_order_status) WHERE NOT NULL |
| db/website_orders.sql:242 / :245 | shopify_sync_log | (created_at DESC); (created_at DESC) WHERE outcome IN ('failed','rejected') |

**Hot tables, summarised:**
- **orders:** 9 indexes, all partial or narrow: is_stock_order, production_head_designation, is_comms x2, exhibition_id, shopify_order_id, order_no (pattern), web_order_status. There is **nothing on created_at, delivery_date, salesperson_email, status, user_id, delivery_email or is_b2b** (is_b2b appears only inside the stock-only partial).
- **order_components:** only (channel_key) and a partial (order_id) WHERE cancelled_at IS NULL. **No barcode, is_active, current_stage or created_at index in the repo.** Note that the partial order_id index is only used when the query also says `cancelled_at IS NULL`. The frontend `.eq/.in("order_id")` calls and the trigger queries `recalc_order_delivery` (78_shipments.sql ~:410) and `sync_order_warehouse_stage` (60:79-160) do **not** add that predicate, so they cannot use it unless a plain FK index exists on live.
- **products:** (is_draft) partial and (store_category). **No sku_id index in the repo.** `products_live` is a view that filters `is_draft = false`, so the partial `is_draft = true` index does not help it.
- **profiles:** none in repo.
- **salesperson:** none in repo.
- **stage_transitions** (the scan-event table): none in repo.
- **qc_records:** only (channel_key, created_at DESC).
- **component_stage_progress:** (component_id) plus UNIQUE(component_id, step). Adequate.
- **notifications / notification_recipients:** none in repo.

---

### 2. Columns the frontend filters and sorts on, and whether they are indexed

Method: a script scanned every `.from('<t>')` / `fetchAllRows('<t>', …)` chain in `src/` for `.eq/.in/.gte/.lte/.order/.ilike/.like/.not/.or`. Counts are rough call sites, not runtime frequency. Filters applied later via `query = query.eq(...)` or dynamic column names can be missed.

#### orders (49 `.from` + 30 `fetchAllRows`)
| column | op / count | index in repo? |
|---|---|---|
| id | eq ×36, in ×1 | PK (assumed, not in repo) |
| **created_at** | **order ×29**, gte ×2 (ReviewDetail.js, StockRoom/stockRoomData.js:112) | **NO** |
| is_b2b | eq ×4 (B2bExecutive, B2bMerchandiser, B2bOrderHistory, B2bVendorOrders) | only inside a stock partial, so **effectively NO** |
| is_stock_order | eq ×4, not ×1 | YES, partial (54:140) |
| salesperson_email | eq ×2 (AssociateDashboard.js:459, B2bexecutivedashboard.jsx:79) | **NO** |
| user_id | eq ×2 (OrderHistory.jsx, ReviewDetail.js) | **NO** |
| order_no | ilike `%x%` ×2 (ScanStation.jsx:66, ProductionOverrides.jsx:91); `like 'SB-SHOPIFY-%'` via `.or` (ShopifyOrdersDashboard.jsx:103/564) | prefix LIKE yes (website_orders.sql:80). **Leading-wildcard ilike: NO** (needs pg_trgm GIN) |
| delivery_date | order ×1 (StockCalendarTab.jsx) + edge function eq ×~18 | **NO** |
| exhibition_id | in ×1 | YES |
| is_comms | eq ×1 | YES, partial |
| vendor_id, approval_status, b2b_order_type, parent_order_id, is_alteration | eq ×1 each | **NO** |
| comms_order_assign, production_head_designation | `.or(...)` B2bProductionDashboard.jsx:184 | production_head_designation yes; comms_order_assign **NO** |
| status | eq in the fetchAllRows doc example only. Filtered in edge functions via `not in` | **NO** |
| store / store_name / channel_key / current_stage / delivered_at / warehouse_stage | 0 server-side filters. These are filtered **client-side** after a full fetch | n/a |

**Key pattern (the real DB cost):** about 20 dashboards call `fetchAllRows("orders", q => q.select("*").order("created_at", {ascending:false}))` with **no WHERE**. Examples: AdminDashboard.jsx:377, CeoDashboard.jsx:329, COODashboard.jsx:160, GMDashboard.jsx:270, CeoAssistantDashboard.jsx:91, HeadOfDesignDashboard.jsx:133, RetailManagerDashboard.jsx:216, StoreManagerDashboard.jsx:202, AccountantDashboard.jsx:143, AccountsDashboard.jsx:36, AssistantCmoDashboard.jsx:188, WarehouseDashboard.jsx:339, PackagingDashboard.jsx:107, ScanStationOrders.jsx:118, WalkInDashboard.jsx:66. WalkInTab.jsx:73 even fetches every `delivery_phone`. `fetchAllRows` (src/utils/fetchAllRows.js) pages with **OFFSET `.range()` in serial 1000-row pages**, so:
- There is no `created_at` index. Each page re-sorts the whole table, and OFFSET N reads and discards N rows. For P pages the cost is O(P²) row visits plus P sequential round trips.
- `select("*")` ships wide JSONB (`items`, `shopify_raw`, and others) for every order.
- The fixes are for the web/perf plan: (a) an index on `orders(created_at DESC)` at minimum; (b) keyset pagination (`.lt("created_at", last)`) in fetchAllRows; (c) narrow column lists; (d) server-side stats RPCs or views instead of full downloads.
- StockRoom/stockRoomData.js:99/112 orders by `id` (the PK index can be used). Fine.

#### order_components (20 `.from` + 4 `fetchAllRows`)
| column | count | index in repo? |
|---|---|---|
| order_id | eq ×5, in ×5 | partial only (cancelled_at IS NULL), so **effectively NO** for these queries |
| component_type | order ×4 | NO (a secondary sort; fine once order_id is indexed) |
| created_at | order ×3 (ProductionManagerDashboard, B2bMerchandiser, B2bProduction) | **NO** |
| is_active | eq ×3 (barcodeService.js, reJourneys.js) | **NO** |
| is_rework | eq ×2 (reJourneys.js) | NO |
| barcode | eq ×1 (barcodeService.js), **ilike `%-x` ×2 (barcodeService.js:1067, :1104, resolveFullBarcode on prefix-less scans)** | eq probably uses the live unique key (not in repo). **Leading-wildcard ilike: NO**, so it seq-scans all components on every hand-typed scan |
| current_stage, channel_key | 0 in src (channel_key is indexed for the Re-journeys view per 62) | — |

#### products / products_live / product_variants
- products: eq id ×18 (PK), `like sku_id` ×4, eq/in/not sku_id ×3, eq shopify_product_id ×1. **sku_id and shopify_product_id: NO index in repo.**
- products_live (view): order name ×12, order sku_id ×5, `or(sku_id.ilike.%q%,name.ilike.%q%)` ×2 (BarcodeExportPanel.jsx:137, LabelDesigner.jsx:120). No name or sku_id index; the ilike search needs trigram. 18 `fetchAllRows("products_live")` calls fetch the whole catalogue sorted by name.
- product_variants: eq product_id ×25, eq size ×8, eq id ×9. **product_id: NO index in repo** (the table is not in the repo).

#### salesperson (60 `.from`)
- eq email ×45 (every dashboard's mount-time role self-guard, plus SALogin). eq role ×2, eq store_name ×1, ilike designation ×1 (notificationService.js). Edge functions also use eq role, eq store_name, and ilike designation `%x%`.
- No index in repo. The table is small (staff), so each query is cheap, but that is **~45 round trips of the same lookup**. The label_templates RLS policy compares `lower(s.email)`, so a plain email index would not serve it anyway.

#### profiles (16 `.from` + 2 `fetchAllRows`)
- eq id ×11 (PK), eq/in email ×2, eq phone ×1 (OtpVerification.js). The Shopify sync edge function and verify-otp also use eq phone and eq email. **phone and email: NO index in repo.** These are lookups on the customer table during OTP and Shopify ingest.

#### Other scan / QC tables
- stage_transitions: eq component_id ×2, order scanned_at ×3, gte/lte scanned_at (scanReport.js, and scan-report-daily edge function). **NO index in repo on (component_id, scanned_at) or (scanned_at).**
- qc_records: order created_at ×6, eq/in order_id ×2, eq/in component_id ×2, eq outcome ×2, eq inspected_by ×1. Only (channel_key, created_at) is indexed. **component_id and order_id: NO.**
- walkins: order created_at, eq sa_email. Both indexed.

---

### 3. RLS

Everything the repo contains:
- db/barcode_system/v2/70_shopify_delivery_matrix.sql:78: `ENABLE ROW LEVEL SECURITY` with no policy (deny-all to anon; the service role bypasses it).
- db/barcode_system/v2/92_label_templates.sql:61: ENABLE RLS.
  - :66 `label_templates_read` FOR SELECT TO authenticated USING (true).
  - :80 `label_templates_write` FOR UPDATE USING `EXISTS (SELECT 1 FROM salesperson s WHERE lower(s.email) = lower(auth.jwt() ->> 'email') AND s.role IN (...))` (:82-86). This is a **per-row subquery on salesperson with a bare `auth.jwt()`**, and `lower(s.email)` cannot use a plain index. It is harmless here because label_templates has about one row. But if this pattern gets copied onto orders, it becomes a per-row salesperson scan. The better shape is `(select auth.jwt() ->> 'email')`, or a STABLE SECURITY DEFINER `current_role()` helper.
- db/walkins.sql:53-59: ENABLE RLS plus `walkins_sa_select/insert USING (sa_email = auth.email())`, but the whole block is **commented out** (`/* … */` from :52 to :60). It is not applied from the repo, and it would use a bare `auth.email()`.

**orders RLS: NOT IN REPO.** The same is true of order_components, products, salesperson, profiles, stage_transitions and qc_records. No `ENABLE ROW LEVEL SECURITY` or `CREATE POLICY` exists for any of them. CLAUDE.md says security is enforced by RLS, so those policies exist only on live. Check on PROD with `SELECT * FROM pg_policies WHERE tablename IN ('orders','order_components','products','salesperson','profiles')` and look for:
1. bare `auth.uid()` / `auth.jwt()` / `auth.email()` (re-evaluated per row) instead of `(select auth.uid())`;
2. `EXISTS (SELECT … FROM salesperson …)` per row;
3. RLS on the ~20 full-table `orders` fetches above, where any per-row policy cost is multiplied by every row, on every page, on every dashboard load.

Other auth usage: 87_products_audit.sql:37 `auth.uid()` inside a trigger (once per row write, fine). db/otp/01_get_auth_user_by_phone.sql is a SECURITY DEFINER lookup against auth.users.

---

### 4. Views, functions (RPCs), triggers

#### Views
- `public.products_live`: 74_reserve_sku_rows.sql:187, `SELECT * FROM products WHERE is_draft = false`, with security_invoker (:198). It is a thin filter (18 fetchAllRows callers). The partial index is on `is_draft = true`, so it does not serve this view. That does not matter while drafts are few.
- `v_order_payment_totals`: order_payments.sql:66, per-order payment aggregation. **Commented out, never created.** It would be reusable for Accounts/CEO payment stats.
- No materialized views anywhere. No stats or aggregation views exist for dashboards. Every KPI is computed client-side from full downloads.
- Temp views/tables inside one-off migrations: 35:69, 56:126, 63:279, 66:136. Not persistent.

#### Functions (latest definition wins; the count is the number of times the file set redefines it)
Production / scan RPCs (called from src via `supabase.rpc`):
- `advance_component_stage` (redefined ×17, latest v2/59): the main scan handler. Looks up the component by `barcode` (06:42), reads and writes component_stage_progress, inserts stage_transitions, updates order_components. Per-scan cost is O(1) **if** barcode is indexed on live.
- `activate_components` (v2/11): Production Head activates components.
- `record_qc_result` (×6, v2/52): QC pass/fail, dispose, rejourney. Writes qc_records.
- `security_guard_scan` (×8, v2/86): vendor gate exit/entry.
- `configure_external_movement` (×5, v2/80) and `update_external_movement` (×4, v2/80).
- `verify_packaging_components` (×9, v2/91): packaging rescan gate plus auto-complete.
- `manual_complete_order` (×7, v2/53).
- `initiate_ / approve_ / reject_replacement_journey` (v2/15).
- `create_shipment`, `mark_shipment_delivered` (v2/78).
- `cancel_order_components` (v2/93).
- `generate_order_no` (×3, v2/68): mints SB-… numbers. Also called by the shopify-order-sync edge function.
- `recalc_order_total_paid` (v2/77): recomputes total_paid from advance plus the ledger for one order.
- `reserve_sku_rows` (v2/74): mints draft product rows.
- `get_production_head_email` (×3, v2/90): designation resolver. Called 3× from src and from the edge function.
- `record_external_stage_completion` (v2/25).

Called from src but **NOT defined in repo:** `stock_room_set_shopify_status`.

Stage-model helpers (no cross-row aggregation): `get_stage_step` (v2/48), `get_stage_max_days` (v2/02), `get_embroidery_max_days` (v2/02), `get_next_stage` and `is_valid_stage_transition` (fn_stage_helpers.sql), `is_step_skippable` (v2/31), `is_min_stages_met` (v2/48), `all_mandatory_prior_done` / `is_valid_entry` / `auto_skip_leapfrogged` (v2/03), `any_open_stage` (v2/30), `any_open_stage_except` (v2/31), `first_open_prior_step` / `step_label` (v2/26), `step_completed_stage` (v2/25), `reconcile_ledger_to_step` (v2/27), `warehouse_stage_rank` (v2/58), `is_repeat_vendor` (v2/80).

Resolvers: `resolve_order_channel_key` (v2/68, was 61:53), `get_order_source_key` / `resolve_designation_email` / `is_factory_paused` (v2/07), `get_head_designation_for_source` / `resolve_email_by_designation` (v2/14), `stock_pool_for_channel` (v2/72). Note that `resolve_order_channel_key` does `to_jsonb(o)` of the **whole orders row** (61:63) on every call. It is called per component insert (trigger) and per order stock apply. That is fine per row, but slow if used across a set.

Stock: `apply_channel_stock_delta`, `apply_order_channel_stock` (v2/72), `credit_stock_order_receipt` (v2/71). The latter two loop over `orders.items` JSONB.

Aggregating or scanning functions (candidates for reuse or cost review):
- `check_escalations` (×2, v2/08:41-118) loops over **every active component with an overdue stage_deadline**, and for each one queries escalation_alerts and updates it. `check_rejourney_escalations` (v2/12) is similar. Neither is called from src or from any edge function in the repo, and no cron in the repo schedules them. The caller is live-only (probably pg_cron). They need an index on `order_components (is_active, stage_deadline)` and on `escalation_alerts (component_id) WHERE NOT is_resolved`, neither of which is in the repo.
- `sync_order_warehouse_stage` (trigger fn, ×5, v2/60): see triggers.
- `recalc_order_delivery` (v2/78 ~:395): count DISTINCT over components ⋈ shipment_components ⋈ shipments for one order.
- **No RPC computes dashboard stats** (revenue, order counts by store or period, stage counts). This is the gap: a `dashboard_order_stats(period, channel)` RPC or view would replace the ~20 full-table fetches. `orders.net_sb_revenue` (exhibitions/02) and `orders.total_paid` / `remaining_payment` (v2/77, v2/81) are already denormalised, so such an RPC can be a plain GROUP BY.
- `get_auth_user_by_phone` (db/otp/01): SECURITY DEFINER lookup on auth.users by phone.

#### Triggers on hot tables (per-write cost)
**orders**
1. `trg_orders_seed_total_paid`: BEFORE INSERT OR UPDATE OF advance_payment (v2/81:105). Pure arithmetic on NEW. Cheap.
2. `trg_orders_apply_channel_stock`: AFTER INSERT OR UPDATE OF status (v2/72:293). On insert, and on a live↔dead status crossing, it runs `apply_order_channel_stock`, which re-SELECTs the order, calls `resolve_order_channel_key` (another to_jsonb SELECT of the order), then loops over the items JSONB calling `apply_channel_stock_delta` (an upsert on product_channel_stock) per line. It is exception-swallowed. Moderate: 2 order reads plus N upserts per insert.
3. `trg_orders_credit_stock_receipt`: AFTER UPDATE OF status WHEN is_stock_order AND now completed/delivered (v2/71:253). Loops over items, inserts stock_receipts, and updates products.inventory. That products UPDATE fires `products_audit_trigger`, which writes to audit_log. Stock orders only.
4. **Live-only (not in repo):** the orders audit trigger (per memory, changed_by='system'). Also the CREATE TRIGGER for `sync_order_warehouse_stage` is not in the repo, only the function.

**order_components**
1. `trg_order_components_set_channel`: BEFORE INSERT OR UPDATE OF order_id (v2/62:73). One `resolve_order_channel_key` (orders PK read) per inserted component.
2. `trg_block_cancelled_component_moves`: BEFORE UPDATE (every update, v2/93:147). Pure NEW/OLD comparison. Cheap.
3. `sync_order_warehouse_stage`: trigger function (baseline db/barcode_system/fn_sync_order_warehouse_stage.sql:15; latest v2/60:66). The CREATE TRIGGER is **only on live**. Per component stage change it runs **3-4 SELECTs on order_components by order_id** (60:79-160) plus an `UPDATE orders`. That orders UPDATE can in turn fire the orders status triggers (#2, #3) and the live audit trigger. So one scan can cascade into component UPDATE → several component reads by order_id → orders UPDATE → channel-stock / receipt / audit writes. Whether those order_id reads are cheap depends on a live `order_components(order_id)` index. The repo's only one is the partial `WHERE cancelled_at IS NULL`, which these queries don't match.

**Other triggers that write orders**
- `trg_order_payments_sync_total` (v2/77:209): AFTER I/U/D on order_payments. Runs `recalc_order_total_paid` → SUM over order_payments by order_id (indexed) → UPDATE orders.
- `trg_shipments_sync_order_delivery` (v2/78:466) and `trg_shipment_components_sync_order_delivery` (v2/78:494) run `recalc_order_delivery`, which may UPDATE orders.status to 'delivered' and therefore fires orders trigger #2.
- `trg_qc_records_set_channel` (v2/61:140): BEFORE INSERT on qc_records. Resolves the channel via an orders read.
- `products_audit_trigger` (v2/87:76): AFTER I/U/D on products. Does to_jsonb(NEW/OLD) and a diff, then writes an audit_log row. This matters for bulk product updates (the LXRTS inventory mirror writes product_variants, not products).
- Small `updated_at` touch triggers: shipments (v2/78:190), comms_pr_performance (comms_dashboard.sql:72), exhibitions (exhibitions/01:42), production_vendors (v2/75:67).

---

### 5. Edge functions

| function | what it does | tables it touches | full-table paging? | schedule (as stated) | src callers |
|---|---|---|---|---|---|
| **notification-scheduler** (supabase/functions/notification-scheduler/index.ts, 1366 lines) | Daily warehouse and SA alerts: T-2/T/T+1/T+2 delivery, birthdays, alterations, vendor-return overdue, B2B / EXB / PVT variants | orders (~18 queries of `eq delivery_date` + `not status in (...)` + is_alteration / is_b2b / salesperson_store), notifications, notification_recipients, notification_settings, salesperson, profiles, external_movements, vendors | **Yes, `profiles` unpaged** (handleSaBirthdays :378-380: `select id,email,full_name,dob` with no filter, month/day matched in JS). That is a full scan, and it is **silently capped at 1000 rows**, so birthdays beyond the first 1000 profiles are missed. Then for each birthday profile it queries orders by `delivery_email` (:404-409, no index in repo). `alreadySentToday` (:139) runs a count query per order per type. `alreadySentTodayByMeta` (:151) fetches all of today's notifications of a type and filters JSON in JS. | Header says "daily 10:00 IST (04:30 UTC) via pg_cron" (:2). **The cron is not in the repo.** | None (cron only) |
| **scan-report-daily** (216 lines) | Builds an XLSX of one day's scans, uploads it to the public `reports` bucket, and sends it via spur-whatsapp | stage_transitions with an embedded order_components join, filtered by scanned_at range, 1000-row `.range` pages (:115-125) | Pages one day only. Needs a `stage_transitions(scanned_at)` index (not in repo) | Cron `scan-report-daily` '30 0 * * *' (v2/38:42) | None directly. src/utils/scanReport.js builds the same report client-side |
| **shopify-order-sync** (index.ts 2101 + mapper.ts 1094) | Shopify order ingestion: HMAC webhook, `sync-now` (default), `order`, `reconcile`, `refresh`, plus maintenance modes `refresh-raw`, `remap-items`, `redate`, `restate-money`, `restate-totals`, `backfill-cancelled`, `backfill-components` | orders (lookups by shopify_order_id, which is uniquely indexed; order_no), order_components (eq order_id :965), profiles (eq phone / email :346-402, no index in repo), salesperson (ilike designation), notifications, notification_recipients, colors, shopify_delivery_matrix, order_payments, shopify_sync_log; RPCs `generate_order_no`, `get_production_head_email` | The maintenance modes select **all Shopify orders with no `.range()`**: backfill-cancelled :1131-1135, backfill-components :1278-1283, remap-items :1415-1422, redate :1510-1515, restate-money :1680-1685. All of them hit the PostgREST 1000-row cap, so they are silently truncated once there are more than 1000 web orders, and several pull the `shopify_raw` JSONB. refresh-raw uses `.limit(scanSize ≤ 5000)` (:1341-1346), which is still capped at 1000 by max-rows. They run by hand only. | Cron `shopify-order-reconcile` '*/5 * * * *' body `{"mode":"reconcile","sinceMinutes":15}` (website_orders.sql:300, **inside a comment block**, but noted as installed live with the anon key, v2/65:65). Cron `shopify-order-refresh` '7 * * * *' `{"mode":"refresh","sinceMinutes":1440}` (v2/65:71). The memory note says refresh-raw carries the staleness gate, so check the live job body | ShopifyOrdersDashboard.jsx:630 (`sync-now`, first 25) and :1147 (`remap-items` with orderNo) |
| **spur-whatsapp** (200 lines) | Outbound WhatsApp via the Spur API. No DB access | none | n/a | none | src/utils/whatsappService.js:27, CommsReviewOrder.jsx:399, and scan-report-daily |
| **shopify-orders-test** (126 lines) | Throwaway read-only Shopify probe. No DB | none | n/a | none | none (self-described as "delete once real integration built") |
| send-otp / verify-otp / auto-signin (db/otp/*.index.ts; source copies kept in db/, deployed separately) | Phone OTP login | otp_codes (eq phone, gte created_at), profiles (eq phone), RPC get_auth_user_by_phone | no | none | OtpVerification.js:64/144, OtpDialogBox.js:70/138, OrderHistory.jsx:1141 |
| **shopify-inventory**: **NOT IN REPO** | Live Shopify stock fetch and adjust | ? | ? | none | utils/shopifyInventory.js:69, restoreOrderInventory.js:61, ReviewDetail.js:842, ProductForm.js:1526, CommsReviewOrder.jsx:303, InventoryDashboard.jsx:285/499, and the dashboards' `fetchAllLxrtsInventory`. **One edge-function call per LXRTS product, fired in parallel on dashboard load** (Admin :910/:1816, CEO :677/:1544, COO :199/:724, GM :303/:889, StoreManager :231/:886, Inventory :365). That is a big fan-out per page load |
| **comms-return-alerts**: **NOT IN REPO** | Its body and cron are only a commented draft in comms_dashboard.sql:~200-345 | — | — | '30 3 * * *' (commented) | none |

---

### 6. pg_cron jobs defined in SQL

| job | schedule | target | file:line | active in repo? |
|---|---|---|---|---|
| `scan-report-daily` | `30 0 * * *` (06:00 IST) | POST /functions/v1/scan-report-daily `{"day":"yesterday"}` | db/barcode_system/v2/38_scan_report_cron.sql:42 | Live SQL, with `<PROJECT_REF>` / `<SERVICE_ROLE_KEY>` placeholders |
| `shopify-order-refresh` | `7 * * * *` (hourly) | shopify-order-sync `{"mode":"refresh","sinceMinutes":1440}` | db/barcode_system/v2/65_shopify_refresh_cron.sql:71 | Live SQL, with placeholders |
| `shopify-order-reconcile` | `*/5 * * * *` | shopify-order-sync `{"mode":"reconcile","sinceMinutes":15}` | db/website_orders.sql:300 | Inside `/* */`. v2/65 notes it was installed live with the anon key |
| `comms-return-alerts-daily` | `30 3 * * *` | comms-return-alerts | db/comms_dashboard.sql:333 | Inside `/* */`, and the function is not in the repo |
| notification-scheduler | "04:30 UTC daily" | — | only a comment in index.ts:2 | **Not in SQL** |
| check_escalations / check_rejourney_escalations | ? | — | — | **No schedule in repo**, no caller in repo |

pg_cron and pg_net are enabled at v2/65:57-58 (and in commented blocks in comms_dashboard.sql:199 and website_orders.sql:297).

---

### Top DB-side takeaways (ranked)
1. The ~20 unfiltered `orders` full downloads use OFFSET pagination ordered by created_at, and **there is no created_at index in the repo**. This is the single largest DB cost. Add `orders(created_at DESC)`, switch fetchAllRows to keyset pagination, and move KPIs into an aggregating RPC. None exists today, but `net_sb_revenue`, `total_paid` and `remaining_payment` are already denormalised to feed one.
2. `order_components(order_id)` has only a partial index that the trigger and frontend queries don't match. Scan triggers (`sync_order_warehouse_stage`, `recalc_order_delivery`) run 3-4 order_id lookups per scan. Add a plain `(order_id)` index if live lacks one, plus `(is_active, stage_deadline)` for check_escalations.
3. Leading-wildcard ilike on `order_components.barcode` (resolveFullBarcode, on every prefix-less scan) and on `orders.order_no` means seq scans. Use pg_trgm GIN, or better, a suffix column or expression index.
4. Missing in repo: `orders(delivery_date)` (18 scheduler queries), `orders(salesperson_email)`, `orders(delivery_email)`, `orders(user_id)`, `profiles(phone)`, `profiles(email)`, `product_variants(product_id)`, `products(sku_id)`, `stage_transitions(component_id, scanned_at)` and `(scanned_at)`, `qc_records(component_id)` and `(order_id)`, `notifications(type, created_at)` and `(order_id)`. **Verify on live first.**
5. None of the RLS for hot tables is in the repo. Audit `pg_policies` on live for bare `auth.*()` and per-row `salesperson` EXISTS. The one repo example of that pattern is `label_templates_write` (92:80-86).
6. Correctness-adjacent: the notification-scheduler birthday scan of `profiles` and five shopify-order-sync maintenance modes are unpaged, so they silently truncate at 1000 rows.
