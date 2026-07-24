# REFACTOR-PLAN.md — De-duplicating the orders & leadership surfaces

> **Decisions locked in (from clarifying questions):**
> - **Round-1 scope = orders list only.** Build `<OrderList>` + `useOrdersView` and
>   migrate orders tabs. Part 2 (leadership analytics) is documented here as
>   *deferred* context and a future round — **not** executed in round 1.
> - **Behaviour-preserving.** Every migration keeps each dashboard's *current*
>   numbers and behaviour. Known divergences (below) are **flagged for separate
>   product sign-off, never silently "fixed"** in this refactor.

---

## Context — why this exists

`sheetal_ui` has ~35 role dashboards. Across them, two chunks of UI have been
**copy-pasted and then locally re-edited** so many times that the same behaviour
now lives in a dozen files under a dozen CSS prefixes:

1. **The "orders list" surface** — ~15 dashboards render a list/table of orders
   with search + status tabs + a filter bar + pagination. The *fetch/scope* layer
   differs by role (this is real business variation), but the *filter → sort →
   count → render* layer is near-identical, drifting only by accident.
2. **The leadership analytical tabs** — 6 exec dashboards (admin, ceo, coo, gm,
   assistant_cmo, ceo_assistant) share concepts (revenue, inventory, accounts,
   clients, products, cost, targets, store/brand performance). Admin ⇄ CEO are a
   near-clone; the aggregation memos are pasted, and *no* analytical tab has a
   shared React component.

The cost of this duplication is concrete: a bug fix or a column addition has to be
made 7–12 times, and the copies have **already silently diverged** (examples below)
— which means some dashboards now compute different numbers for the "same" thing.

**Goal of this plan:** propose ONE shared `<OrderList>` (+ a `useOrdersView` hook)
that absorbs the accidental duplication, keep an escape hatch for the genuine
per-role variation, extract the pasted leadership aggregation into `src/utils/`,
and rank every surface by migration cost so the work can be staged safely.

This is a **large** refactor touching high-traffic screens with no test net (see
CLAUDE.md — "there is effectively no test suite"). The plan is therefore staged so
each step is independently shippable and visually verifiable.

---

## Part 1 — The ~15 "orders" tabs: what's shared vs what's real

Every dashboard loads orders **once** into one `orders` state (not per-tab lazy),
then the orders tab does: **query-level scope → JS scope → search/status/filter →
sort → paginate → render row**. Findings anchored to `file:line`.

### 1a. Fetch + scope — GENUINELY different (keep per-dashboard)

This is where real business rules live. **Do not** try to unify it — the shared
component receives an already-scoped array.

| Dashboard | Query-level filter | JS scope | Anchor |
|---|---|---|---|
| Associate | `.eq(salesperson_email, self)` unless `sa_services` | own-order flagging | `AssociateDashboard.js:449-453` |
| Warehouse | none (`select *`) | `scopeOrdersToDesignation(orders, designation)` + comms append + drop private/unapproved-B2B | `WarehouseDashboard.jsx:306-318,409-416` |
| StoreManager | none | hand-rolled `storeMatches(store, userStore)`, drop b2b | `StoreManagerDashboard.jsx:220-226` |
| Retail | none | `.filter(!is_comms)` | `RetailManagerDashboard.jsx:184-188` |
| Admin/Ceo/Coo/Gm | none (all-channel) | none / `nonCommsOrders` chip | `AdminDashboard.jsx:364` etc. |
| AssistantCmo | `select(ORDER_COLUMNS)` | company-wide | `AssistantCmoDashboard.jsx:224` |
| Accountant | none | `.filter(!is_comms)` | `AccountantDashboard.jsx:154-157` |
| Comms | **`.eq(is_comms, true)`** | — | `CommsDashboard.jsx:122` |
| B2B-exec | **`.eq(is_b2b,true).eq(salesperson_email,self)`** | — | `B2bexecutivedashboard.jsx:73` |
| Merchandiser | **`.eq(is_b2b,true)`** | — | `B2bMerchandiserDashboard.jsx:159` |
| B2B-production | `.eq(is_b2b,true)` | `.filter(approval_status==="approved")` | `B2bProductionDashboard.jsx:129-135` |
| ProductionManager | **hand-rolled `.range()` pagination loop** | `!is_b2b \|\| approved`; all-channel `channelFilter` | `ProductionManagerDashboard.jsx:305-325` |

The escape-hatch inputs the abstraction must accept: **channel scoping via
`scopeOrdersToDesignation`, `is_b2b`, `is_comms`, `salesperson_email`, `vendor_id`**
— all handled *before* the array reaches `<OrderList>`. The **one accidental**
item here: ProductionManager hand-rolls pagination instead of `fetchAllRows`
(`:305`) — fold it onto `fetchAllRows` as a trivial cleanup.

### 1b. Filter / sort / count / render — ACCIDENTALLY different (the dedup target)

Two families share the same intent with divergent code:

**Table family — Admin / Ceo / Coo / Gm / StoreManager / Retail / ProductionManager.**
All render the same ~9-column table (Order ID / Customer / Product / Amount /
Payment / Status / Store / Date / Actions) behind the same
`SearchByDropdown` + `STATUS_TABS` + filter-dropdown-bar + `Paginator` scaffold.
The driving helpers are **copy-pasted verbatim**:
- `getPaymentStatus` / `getPriority` / `getOrderType` — `AdminDashboard.jsx:568-586`
- `filteredOrders` (search+date+price+payment+priority+type+store+SA, then sort) —
  `AdminDashboard.jsx:1113-1169`
- `orderTabCounts` — `:1171-1180`; `appliedFilters` chips — `:1188-1201`
- the ~150-line filter-bar + `<table>` JSX — `:3331-3484`

**Admin and Ceo orders tabs are byte-for-byte identical.** StoreManager (`sm-`),
Retail (`rm-`), ProductionManager (`pm-`) are the same code under a different CSS
prefix; PM adds a channel `<select>`, Retail drops CSV export, Coo dropped
price/priority/type filters, Gm adds "+ Place Order".

> **Accidental drift already shipped:** Admin/Ceo wrap the status `<select>` in
> `normalizeOrderStatus(order.status)`; Coo/Gm bind raw `o.status`
> (`COODashboard.jsx:1015`). Same widget, different value — a latent bug the shared
> component fixes for free.

**Card family — Associate / Comms / B2B-exec / Merchandiser / B2B-production.**
All share the same card shell (`ORDER NO / ORDER DATE / DELIVERY` header rows +
status badge + PDF button + thumbnail) under per-file prefixes (`ad-`, `comms-`,
`b2b-`, `merch-`, `prod-`). **B2B-production already extracted this into a local
`OrderCard` component** (`B2bProductionDashboard.jsx:968-1026`) — but nobody reuses
it. The card body (middle rows) differs by channel; the shell does not.

### 1c. Status/stage derivation — GENUINELY different (inject, don't unify)

The status→label/badge logic is domain-specific and **must remain pluggable**:
- Accountant derives buckets from real timestamps (`refund_status`,
  `dispatched_at`, `in_production_at`…) — `AccountantDashboard.jsx:81-92`
- B2B-production uses production-stage buckets — `:496-518`
- Warehouse uses `warehouse_stage` + component-stage cards
- Comms uses engagement/`approval_status`; B2B uses `approval_status`

But the **plain** status-string→label mapping is re-implemented inline in
Associate (`:1633`), Comms (`:614`), Retail (`:1527`) even though a shared
`getOrderStatusLabel` / `normalizeOrderStatus` already exists
(`barcodeService.js:229-247`). Route those through the shared helper.

---

## Part 2 — The 6 leadership dashboards (DEFERRED — future round, not round 1)

> Documented for completeness and to name the extract targets. **Not built in
> round 1** per the locked scope. The number-changing unifications noted here are
> **flagged only** — out of scope until product sign-off.


Concept → dashboard map (✓ = has a tab of that concept):

| Concept | admin | ceo | coo | gm | asst_cmo | ceo_asst |
|---|---|---|---|---|---|---|
| revenue | ✓ | ✓ | (in `financial`) | — | ✓ | — |
| inventory | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| accounts | ✓ | ✓ | — | ✓ | — | — |
| clients | ✓ | ✓ | — | — | ✓ | — |
| products | ✓ | ✓ | — | — | ✓ | ✓ |
| cost | ✓ | ✓ | (in `financial`) | — | — | — |
| targets | ✓ | ✓ | — | — | (overview) | (monthly_five) |
| brand/overview | ✓ | ✓ | ✓ | — | ✓ | — |
| store_performance | (in brand) | ✓ | — | ✓ | (overview) | ✓ |

**Two lineages, not one design.** Admin ⇄ CEO are a near-clone (same memo names,
bodies, JSX, *and comments*). Coo/Gm copy those memo bodies then bolt on
domain extras. AssistantCmo / CeoAssistant are independent re-implementations that
share the *rule* but re-derive every aggregation inline.

### Already shared (leave alone — reuse it)
- `src/utils/revenue.js` — `isRevenueOrder`, `orderRevenueAmount`,
  `REVENUE_EXCLUDED_STATUSES`. Imported by **all 6**. The one centralized rule.
- `src/utils/itemNetAmount.js` — `itemFinalAmount`. Shared by Family A + Gm; **not**
  used by asst_cmo/ceo_asst (they use raw `item.price*qty` → different numbers).
- `barcodeService.js` — `getOrderChannelLabel`/`getOrderStatusLabel` (each dashboard
  wraps it in a local `getOrderChannel` one-liner — pasted, harmless).

### Duplicated inline (extract to `src/utils/`, priority order)
1. **`accountsLineItems`** — GST(5%)/proportional-discount line-item builder,
   **essentially identical** in `CeoDashboard.jsx:986`, `GMDashboard.jsx:718`,
   `AdminDashboard.jsx:1304`. → `src/utils/accountsLineItems.js`. *(Highest value,
   lowest risk — pure function, three call sites.)*
2. **`getDateRange`/`getAnalyticsDateRange`/`getPrevDateRange`** — same
   today/week/month/year/custom switch re-declared in every dashboard
   (`AdminDashboard.jsx:641`, `CeoDashboard.jsx:557`, `GMDashboard.jsx:385`, …).
   → `src/utils/dateRange.js`. *(Note: `PeriodFilter.js` already exports
   `periodRange` + `usePeriodFilter` — prefer adopting that over a new util where
   the timeline vocab matches.)*
3. **`inventoryStats`** loop + filter/pagination (`p.sync_enabled ?
   getLxrtsTotalInventory : p.inventory`, out/low thresholds) — Ceo/Admin/Gm/Coo.
   → `src/utils/inventoryStats.js`.
4. **`clientAnalytics`** (segmentation/repeat-rate/cohort) — Ceo/Admin identical.
   → `src/utils/clientAnalytics.js`.
5. **`enhancedDashboardStats` / channel breakdown** — Ceo/Admin identical (note
   `productionMetrics.js:computeChannelBreakdown` already exists — reuse/extend it).
6. **`orderValueTrend`** daily bucketing — Ceo/Admin identical.
7. **store-performance groupBy** — 4 inline reimplementations
   (Ceo/Gm/CeoAssistant/AssistantCmo).

### Genuine differences to PRESERVE
- **Order base differs:** Admin `nonCommsOrders`, Coo `nonLxrtsOrders`, Ceo raw
  `orders`. → every extracted helper must **take the order array as a param**, never
  read a module global.
- **Predicate inconsistency:** Ceo still has inline `o.status==="cancelled"`
  (`CeoDashboard.jsx:1119`) where Admin/Gm/Coo use `isRevenueOrder`. Unifying will
  **change CEO's numbers** — flag for product sign-off, don't silently "fix".
- **Item valuation:** asst_cmo/ceo_asst use raw `item.price` vs Family-A
  `itemFinalAmount`. Unifying changes their reported figures — sign-off required.
- **Rendering:** NO shared analytical component exists; JSX is inline over a shared
  CSS class family (`admin-stat-card`, `stat-label/value/sub`, `admin-stats-grid`,
  `revenue-mix-row`, plus small shared `GrowthIndicator`/`PlaceholderBadge`).
  A `<StatCard>` + `<StatGrid>` + `<ChannelBreakdownBar>` extraction would collapse
  most of it — but this is a **second phase**, gated on Part 3 landing first.

---

## Part 3 — The proposed abstraction

### Reuse these existing primitives (do NOT reinvent)
Confirmed contracts (from `src/components/` + `src/hooks/` + `src/utils/`):
- `SearchByDropdown({fields, selectedField, onFieldChange, query, onQueryChange, placeholder})`
- `Paginator({page, totalPages, onChange, scrollTo?})`
- `Badge({color?|variant, soft?, size?, children})` — the status-pill primitive
- `usePeriodFilter(default,{label,variant})` → `{timeline, range, inPeriod, control}`
- `useFilterParam` / `useFilterParamList` / `useClearFilterParams` — URL-backed
  filter state so Back/refresh restore position (matches the app's `useTabParam`
  convention)
- `fetchAllRows(table, buildQuery)` — the fetch/scope stays in the dashboard
- `getOrderChannelKey/Label`, `scopeOrdersToDesignation`, `normalizeOrderStatus`,
  `getOrderStatusLabel` — `barcodeService.js`
- `formatDate`, `getWarehouseDate`, `computeStatusStats`/`computeChannelBreakdown`
  (`productionMetrics.js`), `formatIndianNumber`

### The component API

**`useOrdersView(orders, options)`** — a hook owning the accidental-duplication
logic (search/date/price/payment/priority/type/store/SA filters, sort,
`orderTabCounts`, `appliedFilters` chips, pagination). Lifts the verbatim
`AdminDashboard.jsx:1113-1201` block + `getPaymentStatus/getPriority/getOrderType`
(`:568-586`) into one place. URL-backed via `useFilterParam`.

```
const view = useOrdersView(scopedOrders, {
  searchFields,            // default = the Admin 5; override per dashboard
  statusTabs,              // default STATUS_TABS; Comms/B2B pass their own
  filters: ['date','price','payment','priority','type','store','sa'], // opt-in list
  sortOptions,             // default 5; override
  pageSize: ITEMS_PER_PAGE,
  amountOf: o => o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0,
  statusOf: getOrderStatusLabel,   // ESCAPE HATCH — Accountant/B2B/Comms inject theirs
})
// → { visible, totalPages, page, setPage, counts, chips, controls }
```

**`<OrderList orders variant render options />`** — the presentation shell.
- `variant="table"` → the 9-column table (Admin/Ceo/Coo/Gm/StoreManager/Retail/PM).
  Columns are a config array so PM can add a channel column, Gm can add "+ Place
  Order", asst_cmo can drop the Actions column.
- `variant="card"` → the shared card shell (header rows + status badge + PDF +
  thumbnail) with a **`renderBody(order)` slot** for the channel-specific middle
  (Comms engagement chip, B2B vendor/PO/merchandiser, Associate SA). Seed this from
  the already-extracted `B2bProductionDashboard.jsx:968` `OrderCard`.
- `renderStatus={fn}` / `renderActions={fn}` — escape hatches for the domain-specific
  status derivation (Part 1c) and per-role action buttons (Approve/Reject, status
  `<select>`, Mark Completed).

**New CSS:** one new prefix `ol-` (not another per-screen prefix), building on the
already-shared `badge-`/`pgn-`/`sbd-`/`pfx-` namespaces.

### What stays in each dashboard (the escape hatch)
The dashboard keeps: its `fetchAllRows` call + query filters, its JS scope
(`scopeOrdersToDesignation` / `storeMatches` / `is_b2b` / `is_comms` /
`salesperson_email` / `vendor_id` / approved-only), its `renderStatus` and
`renderActions`, and any channel-only columns. Everything downstream of "here is my
scoped, role-appropriate array" moves into `useOrdersView` + `<OrderList>`.

---

## Part 4 — Migration cost ranking

### 🟢 Trivial (mechanical; same code under a prefix, or a pure-fn extract)
- **`accountsLineItems` → `src/utils/accountsLineItems.js`** (3 identical call
  sites, pure fn). Do this **first** — proves the pattern with near-zero risk.
- **ProductionManager: hand-rolled pagination → `fetchAllRows`**
  (`ProductionManagerDashboard.jsx:305`).
- **Route inline status labels through `getOrderStatusLabel`** (Associate `:1633`,
  Comms `:614`, Retail `:1527`).
- **Admin, Ceo** table tabs → `<OrderList variant="table">`. They're byte-identical;
  migrating both together is the cleanest first proof of the component.

### 🟡 Needs thought (same shell, real per-role deltas to thread through config)
- **Coo / Gm** table tabs — reconcile the drift first (Coo's dropped filters, raw
  `o.status`, Gm's "+ Place Order") into config props; decide whether to *restore*
  the dropped filters (recommended) as part of migration.
- **StoreManager / Retail** table tabs — same shell, different scope + CSS; migrate
  after Admin/Ceo prove the `variant="table"` config surface.
- **ProductionManager** table tab — needs the channel-column + channel-`<select>`
  config extension.
- **Card family (Associate / Comms / B2B-exec / Merchandiser / B2B-production)** →
  `<OrderList variant="card">` with `renderBody`. B2B-production first (its
  `OrderCard` is already the reference shape).
- **Leadership aggregation extracts #2–#7** (dateRange, inventoryStats,
  clientAnalytics, channel breakdown, orderValueTrend, store-performance) — pure but
  each has base-array/predicate divergences to parametrize; extract one at a time,
  diff the rendered numbers before/after.

### 🔴 Leave alone for now (domain-specific; not "the same tab")
- **Warehouse orders tab** — alterations, stage filters, component journeys, the
  richest scope logic. Can *consume* `useOrdersView` for search/sort/paginate later,
  but not a v1 target.
- **Accountant status tab** — timestamp-based bucketing + Recharts drill-down; keep
  bespoke, only borrow the shared search box.
- **Leadership analytical *rendering* (`<StatCard>` etc.)** — valuable but a separate
  phase, gated on Part 3 landing and on product sign-off for the number-changing
  unifications (Ceo predicate, asst_cmo item valuation).
- **AssistantCmo / CeoAssistant analytics** — independent lineage; converging them
  changes reported figures. Needs product decision, not a mechanical refactor.

### Suggested sequencing — ROUND 1 (locked scope: orders list only)
1. 🟢 Step 0: create `REFACTOR-PLAN.md` at repo root from this document.
2. 🟢 `accountsLineItems` extract (proof-of-pattern, pure fn — the one leadership
   item kept in round 1 because it is zero-risk and unblocks nothing else). *Behaviour-preserving: totals must be byte-identical after.*
3. 🟢 Build `useOrdersView` + `<OrderList variant="table">`; migrate **Admin + Ceo**
   (byte-identical → cleanest first proof).
4. 🟡 Migrate Coo/Gm — **preserve their current behaviour** (keep Coo's reduced
   filter set and raw-`o.status` binding *as config*, keep Gm's "+ Place Order");
   the `normalizeOrderStatus` fix is applied only where a dashboard already used it.
   Then StoreManager/Retail, then PM (+ channel column/select, + `fetchAllRows`).
5. 🟡 Build `variant="card"`; migrate B2B-production → Merchandiser/B2B-exec →
   Associate/Comms.

### DEFERRED to a later round (not built now)
- Leadership aggregation extracts #2–#7 (dateRange, inventoryStats, clientAnalytics,
  channel breakdown, orderValueTrend, store-performance).
- Leadership `<StatCard>` rendering layer.
- The sign-off-gated number unifications (below).

---

## Verification (per migrated surface — no test suite exists)
For each step, because `npm test` is not a signal (CLAUDE.md):
1. `npm start`, log in as the relevant role, open the migrated tab.
2. Confirm the visible order **count, order, and totals are unchanged** vs the
   pre-refactor build (open two tabs / git stash to compare) — this is the key gate
   for the leadership number-changing extracts.
3. Exercise every filter + search field + sort + status tab + pagination, and PDF /
   status-`<select>` / Approve-Reject actions where present.
4. Verify Back/refresh restores the active filter + page (URL-backed state).
5. For the `accountsLineItems` extract: diff the accounts-tab totals for a known
   order across Admin/Ceo/Gm — must be identical to before.

---

## Flagged for separate product sign-off (NOT touched by this refactor)
These are pre-existing behaviour divergences, documented so they aren't lost. The
refactor **preserves each as-is**; changing any of them is a product decision:
- **CEO revenue predicate:** CEO uses inline `o.status==="cancelled"`
  (`CeoDashboard.jsx:1119`) where Admin/Gm/Coo use the shared `isRevenueOrder` —
  so CEO currently counts some returned/refunded orders the others exclude.
- **AssistantCmo / CeoAssistant item valuation:** raw `item.price*qty` vs Family-A
  `itemFinalAmount` (discount-adjusted) — their reported figures differ by the
  proportional order discount.
- **Coo/Gm orders-tab drift:** Coo dropped price/priority/type filters; Coo/Gm bind
  raw `o.status` in the status `<select>` where Admin/Ceo normalize. **Round 1
  preserves these via config** rather than "correcting" them.

## Resolved (from clarifying questions)
- Round-1 scope = **orders list only**. ✅
- Number drift = **preserve exactly, flag only**. ✅
- Deliverable = **`REFACTOR-PLAN.md` at repo root, created on approval**. ✅
