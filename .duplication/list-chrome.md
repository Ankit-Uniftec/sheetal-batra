# List Chrome Duplication Sweep

Scope: search boxes, filter bars, pagination, empty states, CSV export.
Read-only sweep; no source modified.

---

## Cluster 1 — Pagination CONTROLS (mostly already collapsed)

`src/components/Paginator.jsx` is a genuinely shared, well-documented component
(numbered pages + ellipsis + prev/next + jump-to-page + scroll-to-top), and is
now used in ~30 screens/components. This is NOT duplication — it's the
existing target component. Listing for completeness / to confirm no stragglers:

- Consumers (all render `<Paginator page=... totalPages=... onChange=... />`):
  `AdminDashboard.jsx` (5x), `CeoDashboard.jsx` (5x), `GMDashboard.jsx` (4x),
  `COODashboard.jsx` (2x), `StoreManagerDashboard.jsx` (3x),
  `AssistantCmoDashboard.jsx` (2x), `HeadOfDesignDashboard.jsx` (2x),
  `AccountantDashboard.jsx` (2x), `CommsDashboard.jsx`,
  `B2bMerchandiserDashboard.jsx` (2x), `B2bProductionDashboard.jsx` (4x),
  `B2bOrderHistory.jsx`, `B2bVendorOrders.jsx`, `OrderHistory.jsx`,
  `WarehouseDashboard.jsx`, `InventoryDashboard.jsx`, `StockOrdersTab.jsx`,
  `ExternalVendorsPanel.jsx`, `ProductionHeadVendors.jsx` (2x),
  `QcHistoryPanel.jsx`, `ReJourneyPanel.jsx`, `WalkInsView.jsx`,
  `ProductionManagerDashboard.jsx (B2B)`.
- No stragglers found still hand-rolling their own Prev/Next button pair.

**No action needed on the control itself.**

<!-- TIER: SKIP — Paginator.jsx is the already-shared control, adopted in ~30 sites, no stragglers. Not duplication. -->


---

## Cluster 2 — Pagination SLICING math (still duplicated, ~30 sites)

Paginator only renders controls; every screen still repeats its own
`totalPages` / `startIndex` / `.slice()` boilerplate to actually page the
array. Two idioms recur:

**Idiom A — named `startIndex`/`endIndex` then `.slice`:**
- `src/screens/AccountsDashboard/AccountsDashboard.jsx:212-215`
  ```
  const totalPages = Math.ceil(filteredItems.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentItems = filteredItems.slice(startIndex, endIndex);
  ```
- `src/screens/InventoryDashboard/InventoryDashboard.jsx:485-488` — identical shape (`filteredProducts`/`ITEMS_PER_PAGE`).
- `src/screens/OrderHistory.jsx:350-352`, `src/screens/WarehouseDashboard.jsx:1248-1250`,
  `src/screens/B2bOrderHistory/B2bOrderHistory.jsx:142-144`,
  `src/screens/AssociateDashboard.js:270-271` (inside a `useMemo`),
  `src/screens/B2bExecutiveDashboard/B2bexecutivedashboard.jsx:167-168` — same 3-line shape, different var names.

**Idiom B — inline `.slice((page-1)*SIZE, page*SIZE)` (no named indices), usually in a `useMemo`:**
- `src/screens/AdminDashboard/AdminDashboard.jsx:1572, 1699 (Math.max(1,...) variant), 1834, 2969(inventoryTotalPages)`
- `src/screens/CeoDashboard/CeoDashboard.jsx:1252, 1373`
- `src/screens/GMDashboard/GMDashboard.jsx:573, 650, 771, 864`
- `src/screens/COODashboard/COODashboard.jsx:530, 647`
- `src/screens/AccountantDashboard/AccountantDashboard.jsx:255, 321`
- `src/screens/B2bProductionDashboard/B2bProductionDashboard.jsx:394, 398, 404`
- `src/screens/CommsDashboard/CommsDashboard.jsx:271`
- `src/screens/HeadOfDesignDashboard/HeadOfDesignDashboard.jsx:235, 314`
- `src/screens/StoreManagerDashboard/StoreManagerDashboard.jsx:540, 646, 759`
- `src/components/ExternalVendorsPanel.jsx:62-64`
- `src/components/ProductionHeadVendors.jsx:472, 529`
- `src/components/ReJourneyPanel.jsx:39-41`, `src/components/QcHistoryPanel.jsx:44-46`
- `src/components/WalkInsView/WalkInsView.jsx:133-134`
- `src/screens/InventoryDashboard/StockOrdersTab.jsx:157-158`
- `src/screens/B2bMerchandiserDashboard/B2bMerchandiserDashboard.jsx:1444` (page size hardcoded `15`, not the screen's `ORDERS_PER_PAGE`)
- `src/screens/AssistantCmoDashboard/AssistantCmoDashboard.jsx:899, 1469-1470`

**Variation worth noting:** page size defaults differ per list (`15`, `20`,
`ITEMS_PER_PAGE`, `ORDERS_PER_PAGE`, `PAGE_SIZE`) — all local consts, no shared
default. `AdminDashboard.jsx:1699` and a couple of others wrap in
`Math.max(1, Math.ceil(...))` to avoid `totalPages=0`; most call sites do NOT
have this guard (would show `totalPages=0` → `Paginator` returns `null`, so in
practice harmless, but the guard is inconsistently applied).

**Suggested collapse:** a `usePagedList(items, pageSize, page)` hook returning
`{ pageItems, totalPages }`, replacing both idioms in ~30 call sites.

<!-- TIER: TIER4-HOOK — new usePagedList(items, pageSize, page) -> {pageItems, totalPages} collapses ~30 hand-rolled slicing sites (both idioms). Bake in the Math.max(1, ...) totalPages guard that's inconsistently applied today; page-size defaults stay per-call-site args. -->


---

## Cluster 3 — Free-text list search input (JSX), ~40+ sites

Near-identical `<input type="text" placeholder="Search..." value=... onChange=...>`
wired to local `useState`/`useFilterParam`, styled via a shared but
copy-pasted class name (`admin-search-input`, `merch-search-input`,
`prod-search-input`, `sm-search-input`, or ad hoc inline).

Representative hits (not exhaustive — grep found 40+):
- `src/screens/AdminDashboard/AdminDashboard.jsx:2749, 2878, 3181, 3503, 3574, 3726, 3868, 3993` (8 separate search inputs, one per tab, all `className="admin-search-input"`)
- `src/screens/CeoDashboard/CeoDashboard.jsx:2432, 2562, 2865, 3212` — byte-similar to the Admin ones (shared class name, same JSX shape)
- `src/screens/GMDashboard/GMDashboard.jsx:1183, 1284, 1602`
- `src/screens/StoreManagerDashboard/StoreManagerDashboard.jsx:1483, 1708` (`className="sm-search-input"`)
- `src/screens/B2bMerchandiserDashboard/B2bMerchandiserDashboard.jsx:1077, 1188, 1373` (`className="merch-search-input"`, resets page to 1 inline in onChange — others don't)
- `src/screens/B2bProductionDashboard/B2bProductionDashboard.jsx:664, 687, 714, 744` (`className="prod-search-input"`, 4 near-identical inputs across queue/inprod/dispatch/all tabs)
- `src/components/ProductionHeadVendors.jsx:390, 448, 572`
- `src/components/ExternalVendorsPanel.jsx:88`, `src/components/QcHistoryPanel.jsx:56`, `src/components/ReJourneyPanel.jsx:51`, `src/components/WalkInsView/WalkInsView.jsx:228`
- `src/screens/OrderHistory.jsx:1963`, `src/screens/AssociateDashboard.js:2055`, `src/screens/B2bOrderHistory/B2bOrderHistory.jsx:279`, `src/screens/B2bExecutiveDashboard/B2bexecutivedashboard.jsx:387`, `src/screens/B2bVendorOrders/B2bVendorOrders.jsx:241`
- `src/screens/AccountantDashboard/AccountantDashboard.jsx:756`, `src/screens/COODashboard/COODashboard.jsx:924`, `src/screens/AssistantCmoDashboard/AssistantCmoDashboard.jsx:1665`, `src/screens/HeadOfDesignDashboard/HeadOfDesignDashboard.jsx:629`
- `src/screens/InventoryDashboard/InventoryDashboard.jsx:676`, `src/screens/InventoryDashboard/StockOrdersTab.jsx:240`, `src/screens/InventoryDashboard/WarehouseTab.jsx:281,325`, `src/screens/InventoryDashboard/StockExchangeTab.jsx:294`
- `src/screens/CommsDashboard/CommsDashboard.jsx:515`, `CommsInventory.jsx:317`, `CommsPRPerformance.jsx:216`, `CommsSourcingReturns.jsx:268`
- `src/components/ExhibitionApprovals.jsx:134`, `src/components/VendorApprovals.jsx:109`, `src/components/ReplacementApprovals.jsx:103`, `src/components/NotificationBell.jsx:267`

**Divergence:** some inputs reset the page number inline on every keystroke
(`onChange={(e) => { setX(e.target.value); setPage(1); }}` — e.g.
B2bMerchandiserDashboard, B2bProductionDashboard), others rely on a separate
`useEffect(() => setPage(1), [search, ...])` elsewhere in the same file (e.g.
AdminDashboard/CeoDashboard/GMDashboard at their own `useEffect` blocks around
line ~915 in GMDashboard). Behavior is equivalent but implemented two
different ways within the same codebase — and in a couple of tabs (need
spot-check per screen) it's easy for one tab's input to be missed by the
`useEffect` dependency array, silently leaving a stale page.

**Suggested collapse:** a `<ListSearchInput>` presentational component (or at
minimum one shared CSS class), plus standardizing on `useFilterParam` (already
used by 8 files) for the value itself so Back/refresh doesn't lose the query.

<!-- TIER: TIER3-COMPONENT — presentational <ListSearchInput value onChange> across 40+ near-identical search inputs; value can standardize on the existing useFilterParam (TIER1-WIRE side-benefit). NOTE: the reset-page-on-keystroke-vs-useEffect divergence is a behavior detail to normalize, not number-affecting. -->


---

## Cluster 4 — Client-side multi-field filter predicate ("does this record match the free-text query")

Three real variants of the same underlying idea, doing different field sets —
this is the highest-value cluster because the field sets are genuinely
different per screen (not just style):

**4a. Order-list free-text OR-match across several order fields**
- `src/screens/OrderHistory.jsx:326-341`
  ```js
  return (
    order.order_no?.toLowerCase().includes(query) ||
    item.product_name?.toLowerCase().includes(query) ||
    item.sku_id?.toLowerCase().includes(query) ||
    order.status?.toLowerCase().includes(query) ||
    order.delivery_address?.toLowerCase().includes(query) ||
    order.salesperson?.toLowerCase().includes(query)
  );
  ```
- `src/screens/WarehouseDashboard.jsx:125-137` (same idiom, different field set):
  ```js
  return (
    order.order_no?.toLowerCase().includes(q) ||
    order.po_number?.toLowerCase().includes(q) ||
    order.vendor_name?.toLowerCase().includes(q) ||
    item.product_name?.toLowerCase().includes(q) ||
    order.approval_status?.toLowerCase().includes(q)
  );
  ```
  **Divergence:** WarehouseDashboard matches `po_number`/`vendor_name`/`approval_status`
  (B2B-oriented fields) instead of OrderHistory's `sku_id`/`delivery_address`/`salesperson`.
  Neither matches `status` the same way (`approval_status` vs `status`). Not
  NUMBER-affecting (search-result sets differ but no totals/amounts), but the
  divergence is real: a query that finds an order in one dashboard by SA name
  will not find it in Warehouse.

**4b. Field-SCOPED search (dropdown picks the field) — genuinely different logic shape**
- `src/screens/AssociateDashboard.js:237-255`
  ```js
  switch (orderSearchField) {
    case "product_name": return (order.items || []).some(it => it?.product_name?.toLowerCase().includes(q));
    case "client_name":  return order.delivery_name?.toLowerCase().includes(q);
    case "phone":         return (order.delivery_phone || "").toLowerCase().includes(q);
    case "order_no":
    default:              return order.order_no?.toLowerCase().includes(q);
  }
  ```
  **Divergence vs 4a (NUMBER-AFFECTING in the sense of result-set size):** this
  is single-field match selected by a dropdown, NOT an OR-across-all-fields
  match like OrderHistory/WarehouseDashboard. Typing "kurta" here only matches
  if `product_name` is the currently selected field; in OrderHistory the same
  query always checks product_name regardless of any field selector. Same
  concern ("search this order list"), structurally different predicate —
  **could show a different count of matching orders for the identical typed
  query depending on which dashboard the user is on.**

**4c. Shared pre-filter block (alteration location + status + date range), copy-pasted verbatim before the search step**
- `src/screens/OrderHistory.jsx:309-324`:
  ```js
  const baseOrders = orders.filter((order) => {
    if (order.is_alteration) return order.alteration_location === "In-Store";
    return true;
  });
  const filteredByControls = baseOrders.filter((order) => {
    if (statusFilter && normalizeOrderStatus(order.status) !== statusFilter) return false;
    if (dateFrom && new Date(order.created_at) < new Date(`${dateFrom}T00:00:00`)) return false;
    if (dateTo && new Date(order.created_at) > new Date(`${dateTo}T23:59:59.999`)) return false;
    return true;
  });
  ```
- `src/screens/AssociateDashboard.js:220-235` — same block, variable names
  renamed (`orderStatusFilter`/`orderDateFrom`/`orderDateTo`) but otherwise
  identical, including the same `is_alteration` / `In-Store` special case and
  the same `T00:00:00` / `T23:59:59.999` boundary literals.
  **These two are functionally identical (near byte-identical modulo
  variable names)** — a strong candidate for a single `filterOrdersByControls(orders, {statusFilter, dateFrom, dateTo})` helper.

**Suggested collapse:**
- Extract `filterOrdersByControls` (cluster 4c) as a pure helper in
  `src/utils/` — used verbatim by OrderHistory and AssociateDashboard today.
- Leave 4a/4b as divergent (different field sets by design) but document them
  as one "search predicate" concern so a future change to one doesn't
  assume it also applies to the other.

<!-- TIER: TIER2-EXTRACT (4c only) — the alteration+status+date pre-filter block is byte-identical (modulo var names) between OrderHistory and AssociateDashboard; extract filterOrdersByControls(orders, {statusFilter, dateFrom, dateTo}) verbatim. 4a (OR-across-fields) and 4b (dropdown-scoped single-field) are DIVERGENCE by design — different field sets / predicate shapes can return different match counts for the same query; leave them, do not merge. -->


---

## Cluster 5 — Empty-state ("No … found") blocks

Every list hand-writes its own empty-state row/paragraph; wording and markup
vary but intent is identical ("this list has zero rows after filtering").

- Plain `<tr><td colSpan=N className="...no-data">No orders found</td></tr>` idiom, repeated with only `colSpan` and CSS class prefix changed:
  - `src/screens/AdminDashboard/AdminDashboard.jsx:3458` (`colSpan="9"`, `className="no-data"`, "No orders found")
  - `src/screens/AdminDashboard/AdminDashboard.jsx:3534` (`colSpan="13"`, "No records found" — **different wording than the sibling table 76 lines above in the same file**)
  - `src/screens/GMDashboard/GMDashboard.jsx:1553` (orders, `colSpan="11"`, "No orders found"), `:1633` (accounts, `colSpan="13"`, "No records found")
  - `src/screens/CeoDashboard/CeoDashboard.jsx:3167` (`colSpan="9"`, "No orders found"), `:3243` (`colSpan="13"`, "No records found")
  - `src/screens/StoreManagerDashboard/StoreManagerDashboard.jsx:1219` (`className="sm-no-data"`, "No orders found")
  - `src/screens/RetailDashboard/RetailManagerDashboard.jsx:1510` (`className="rm-no-data"`)
  - `src/screens/HeadOfDesignDashboard/HeadOfDesignDashboard.jsx:471` (`className="hod-no-data"`)
  - `src/screens/AccountantDashboard/AccountantDashboard.jsx:655` (`className="acct-no-data"`)

  **Divergence:** wording splits into two camps ("No orders found" vs "No
  records found") depending on whether the table is an orders table or an
  accounts/ledger table — consistent *within* a screen (Admin/GM/CEO all do
  orders→"No orders found", accounts→"No records found") but the CSS class
  prefix is reinvented per dashboard (`no-data`, `sm-no-data`, `rm-no-data`,
  `hod-no-data`, `acct-no-data`) even though the rendered result is visually
  identical centered-gray-text.

- Paragraph-style (non-table) empty states, each with bespoke copy:
  - `src/components/B2B/ProductionManagerDashboard/ProductionManagerDashboard.jsx:2122` — `"No orders found."`
  - `src/screens/B2bExecutiveDashboard/B2bexecutivedashboard.jsx:420` — `"No orders found."`
  - `src/screens/WarehouseDashboard.jsx:1750` — `"No orders found."` (`className="wd-no-orders"`)
  - `src/screens/B2bOrderHistory/B2bOrderHistory.jsx:291` — conditional wording: `` `No orders found for "${searchQuery}"` `` when searching, else `"No orders found."`
  - `src/screens/OrderHistory.jsx:2012-2015` — same conditional-wording idiom, independently written:
    ```js
    {searchQuery
      ? `No orders found for "${searchQuery}"`
      : "No orders found."}
    ```
  - `src/screens/AssociateDashboard.js:1592` — `"No orders found for this associate."` (a third wording variant, no query echo)

**Suggested collapse:** a single `<EmptyState colSpan={n} label="No orders found" />`
(table-row variant) and `<EmptyState label={...} />` (paragraph variant),
parameterized by label text; collapses ~20 call sites to one component while
preserving each screen's current wording as a prop.

<!-- TIER: TIER3-COMPONENT — presentational <EmptyState colSpan label> (table-row + paragraph variants) over ~20 hand-written "No … found" blocks. Wording ("orders" vs "records", query echo) stays a prop; per-dashboard CSS prefixes collapse to one. -->


---

## Cluster 6 — CSV export: headers + row-build + escape + Blob/anchor download

Two co-existing implementations of the "same" concern:

**6a. Shared helper (properly factored, but adopted by only ~3 features)**
- `src/components/AddProduct/csvHelpers.js:58-131` — `escapeCell`, `buildCsv(headers, rows)`, `downloadCsv(filename, csvText)`. Used by `AddProduct.jsx:396,433`.
- `src/utils/externalMovements.js` exports `externalMovementsToCsvRows`, consumed by:
  - `src/components/ExternalVendorsPanel.jsx:75-76` (`buildCsv(CSV_HEADERS, csvRows)`)
  - `src/components/ProductionHeadVendors.jsx:199-203` (same helper, same headers const `EXT_CSV_HEADERS`)
- `src/utils/scanReport.js:66` (`scanReportCsv`) — separate headers array (`Date, Time, Order No, Barcode, ...`), consumed by `src/components/B2B/ProductionManagerDashboard/ProductionManagerDashboard.jsx:631-632`.

**6b. Inline hand-rolled CSV builder — the dominant pattern, reinvented per screen**

Byte-identical inline builder logic (headers array → `.map(order => [...].map(v => `"${String(v).replace(/"/g,'""')}"`))` → `[headers.join(","), ...rows].join("\n")` → `new Blob(["﻿"+csv], {type:"text/csv;charset=utf-8;"})` → temp `<a>` anchor):

- `src/screens/AdminDashboard/AdminDashboard.jsx:1216-1247` (orders export) and `:1724-1734` (client-book export) — **two separate inline builders in the same file**.
- `src/screens/CeoDashboard/CeoDashboard.jsx:944-973` — **byte-identical** to AdminDashboard's orders export (same 15 headers, same field reads, same BOM `﻿`, same filename pattern `orders_export_${date}.csv`). Confirmed identical line-for-line against AdminDashboard.jsx:1218-1247.
- `src/screens/GMDashboard/GMDashboard.jsx:888-903` — **DIVERGENT, not identical**: headers array is shorter —
  ```
  Admin/CEO: ["Order No","Product Name","Customer Name","Customer Number","Customer Email","Size","Amount","Top Color","Bottom Color","SA Name","Store","Status","Notes","Order Date","Delivery Date"]
  GM:        ["Order No","Product Name","Customer Name","Customer Number","Size","Amount","SA Name","Store","Status","Order Date","Delivery Date"]
  ```
  GM's export omits Customer Email, Top Color, Bottom Color, and Notes columns that Admin/CEO include for what reads as the same "export all orders" action. **NUMBER-AFFECTING**: not a numeric-value bug, but the exported column set differs — a GM-exported CSV opened next to an Admin-exported CSV for the "same" report has fewer columns and consumers reconciling the two spreadsheets by column position will misalign data. Filename also differs (`gm_orders_export_` vs `orders_export_`).
- `src/components/B2B/ProductionManagerDashboard/ProductionManagerDashboard.jsx` has **three more independent inline builders**: `:585-606` (order export, BOM `﻿`, headers incl. "Warehouse Date (T-2)"), `:2636-2659` (delay-report export, adds "Days Late"/"Bucket"/"Channel" columns, BOM `﻿`), `:2916-2938` (yet another order-shaped export with a `Stage` column Admin/CEO/GM don't have).
- `src/screens/AccountsDashboard/AccountsDashboard.jsx:262-311` — separate headers/rows/csvContent, escape via `` `"${cell}"` `` (no internal-quote doubling — **differs from Admin/CEO's `.replace(/"/g,'""')` escape**: a cell containing a literal `"` would corrupt this CSV's column structure, whereas Admin/CEO's escape handles it). No BOM prefix on the Blob (`new Blob([csvContent], ...)` vs everyone else's `"﻿" + csv`) — **this file's export will mis-render as garbled UTF-8 in Excel where the others won't.**
- `src/screens/COODashboard/COODashboard.jsx:667-670` — another independent header set (`Order No, Product, Customer, Phone, Amount, SA, Store, Status, Order Date, Delivery Date` — no Notes/Colors), BOM present.
- `src/screens/StoreManagerDashboard/StoreManagerDashboard.jsx:486-520` — headers built separately; `const csv = [headers.join(","), ...rows].join("\n")` — note `rows` here are apparently pre-joined strings, not arrays like the others (`...rows` vs everyone else's `...rows.map(r => r.join(","))`), a structurally different shape for the same operation.
- `src/screens/CommsDashboard/CommsInventory.jsx:23-27` and `src/screens/CommsDashboard/CommsReports.jsx:40-44` — both define their own **identical** local `csvEscape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`` plus an identical `toCsv(headers, rows)` builder — two files in the same feature folder independently reinventing the same 2-line helper.
- `src/components/WalkInsView/WalkInsView.jsx:180-192` — another independent inline builder (Date/SA Email/Location/Name/Phone/Email/Source/Converted headers), BOM present.
- `src/utils/scanReport.js:66` — the one export whose headers explicitly include `Time` as a separate column from `Date`; only exporter that does so.

**Escape-function divergence (real, could corrupt data), summarized:**
| Site | Escape | BOM |
|---|---|---|
| Admin/CEO/GM/COO/B2B-PM/WalkInsView | `.replace(/"/g,'""')` wrapped in quotes | `"﻿" + csv` |
| CommsInventory/CommsReports | same escape (own copy) | `"﻿" + csv` (BOM as a literal char, not `﻿` — same byte, different source notation) |
| AccountsDashboard | **no `"` doubling** — plain `` `"${cell}"` `` | **no BOM** |
| csvHelpers.js (buildCsv) | full escape incl. comma/newline detection before quoting (only quotes when needed) | BOM |

**Project-constraint note:** CLAUDE.md flags that `spur-whatsapp` must attach
XLSX/PDF, not CSV (CSV is silently undelivered). None of the CSV export sites
found here feed into WhatsApp sending — they are all direct browser
downloads (`<a download>` / Blob URL), so this specific constraint does not
appear violated by any cluster-6 site. No CSV-via-WhatsApp path was found in
this sweep.

**Suggested collapse:** promote `src/components/AddProduct/csvHelpers.js`'s
`buildCsv`/`downloadCsv` (already correct: proper escaping incl. embedded
newlines, single BOM convention) to `src/utils/csv.js` and have every
cluster-6b site build a plain `headers` + row-object array and call the
shared `buildCsv`/`downloadCsv`, eliminating ~10 independent escape/Blob/BOM
implementations — and incidentally fixing AccountsDashboard's missing
quote-escaping and missing BOM as a side effect of using the shared helper
(flagged here as a finding, not applied).

<!-- TIER: TIER1-WIRE — a correct buildCsv/downloadCsv already exists in src/components/AddProduct/csvHelpers.js (proper escaping, single BOM); promote it to src/utils/csv.js and wire the ~10 inline 6b builders onto it. NOTE two DIVERGENCE call-outs the wire-up would change: (a) AccountsDashboard omits quote-doubling AND the BOM (can corrupt/garble cells — a real bug the shared helper fixes), (b) GM's export omits Customer Email/Colors/Notes columns Admin/CEO include for the "same" export — confirm the column set is intended before unifying. -->


---

## Summary

- 6 clusters identified.
- Cluster 1 (Paginator controls) and part of Cluster 6a are already properly
  shared — most of the remaining volume is Clusters 2, 3, 5, 6b.
- **NUMBER-AFFECTING divergences: 3** — (1) GM's CSV export header/column set
  is a strict subset of Admin/CEO's for the "same" export action; (2)
  AssociateDashboard's field-scoped search predicate vs OrderHistory's
  OR-across-fields predicate can return different match counts for the same
  typed query; (3) AccountsDashboard's CSV escaping omits quote-doubling and
  the UTF-8 BOM, which can corrupt/garble exported cell contents that other
  screens' exports handle safely.
