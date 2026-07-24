# Status Rendering Duplication Sweep

Scope: `src/screens/`, `src/components/`, `src/pages/`, `src/utils/`.
Canonical helpers that DO exist (for reference, not duplicated per se):
`src/utils/barcodeService.js` — `normalizeOrderStatus()` (L229), `getOrderStatusLabel()` (L236),
`getStageLabel()`/`getStageColor()` (L347/351), `getSAStageLabel()`/`getSAStageColor()` (L1128/1141).
Most of the clusters below are screens that **bypass** these canonical helpers with a
hand-rolled local equivalent.

---

## Cluster 1 — Retail/B2B order lifecycle status → CSS class (`getStatusClass`)

Pattern: `switch(status?.toLowerCase())` mapping order/alteration status to a badge class,
default branch labeled "active". This is the customer-order-history flavor (delivered /
cancelled / revoked / exchange-ish), distinct from the warehouse-stage flavor in Cluster 2.

- `src/pages/OrderDetailPage.jsx:56-83` — `StatusBadge` component; local `getStatusClass` (L57-69)
  + local `getStatusText` (L71-83). Cases: delivered, cancelled, revoked→cancelled,
  pending/order_received, in_production, ready, shipped, default "active"/`s || "Active"`.
- `src/screens\OrderHistory.jsx:1376-1400` — local `getStatusClass` + `getStatusText`. Cases:
  delivered, cancelled, revoked→cancelled, **exchange_return/return_store_credit/partial_return/refund_requested → "exchange"**,
  default "active"/"Active". **DIVERGENT**: adds 4 return/exchange cases OrderDetailPage.jsx doesn't have;
  OrderDetailPage.jsx adds in_production/ready/shipped cases OrderHistory.jsx doesn't have. Same
  pattern name, different vocabularies — not swappable as-is.
- `src/screens/AccountsDashboard/AccountsDashboard.jsx:318-329` — local `getStatusClass`. Cases:
  delivered, cancelled, exchange_return→"acc-status-exchange", default "acc-status-active".
  Subset of OrderHistory's cases (missing revoked, return_store_credit, partial_return, refund_requested).
- `src/screens/AssociateDashboard.js:1190-1199` and `src/screens/InventoryDashboard/StockOrdersTab.jsx:31-40`
  — **byte-identical** `getStatusBadgeClass`: delivered, cancelled, exchange_return, processing,
  completed→"ad-status-delivered" (same class as delivered), default "ad-status-active". StockOrdersTab
  literally reuses AssociateDashboard's `ad-*` CSS classes (`ad-order-status-badge`, `ad-status-*`).
- `src/screens/InventoryDashboard/StockOrdersTab.jsx:42-51` — separate local `statusLabel` (title-case
  labeler). **DIVERGENT vs canonical `getOrderStatusLabel`**: special-cases `completed` → **"Completed & Dispatched"**
  (canonical `getOrderStatusLabel` would title-case to plain "Completed") and `exchange_return` →
  "Exchange/Return" (canonical gives "Exchange Return"). Label text differs, not just styling.

**Suggested collapse**: one `<StatusBadge status={…} domain="order"/>` component (or a
`getOrderHistoryStatusMeta(status) -> {class, label}` helper) covering the full customer-order
vocabulary (delivered/cancelled/revoked/exchange family/in_production/ready/shipped/processing),
used by OrderDetailPage, OrderHistory, AccountsDashboard, AssociateDashboard, StockOrdersTab.

<!-- TIER: TIER3-COMPONENT — one getOrderHistoryStatusMeta(status) -> {class, label} + <StatusBadge> covering the full customer-order vocabulary; the local getStatusClass/getStatusText copies each cover only a subset. NOTE: the vocabularies genuinely diverge (OrderHistory has 4 exchange/return cases OrderDetailPage lacks; OrderDetailPage has in_production/ready/shipped OrderHistory lacks; StockOrdersTab labels "completed"→"Completed & Dispatched") — the union must be assembled deliberately, not by picking one copy. Label-text differences are a DIVERGENCE to reconcile, not just styling. -->


---

## Cluster 2 — Warehouse/production order status → badge (dashboard "orders" tables)

Pattern: `.status-badge` (or a per-dashboard-prefixed clone) styled via
`normalizeOrderStatus(status)` + `getOrderStatusLabel(status)` (the canonical helpers) — but the
CSS color table backing `.status-badge.<state>` is copy-pasted per dashboard file instead of
shared, and at least one screen skips the canonical normalizer entirely.

CSS color maps (all identical color values: pending #fff3e0/#e65100, in_production #e3f2fd/#1565c0,
ready #e8f5e9/#2e7d32, dispatched #f3e5f5/#7b1fa2, delivered/completed #e8f5e9/#1b5e20, cancelled #ffebee/#c62828):
- `src/screens/AdminDashboard/AdminDashboard.css:1014-1029`
- `src/screens/COODashboard/COODashboard.css:1001-1016`
- `src/screens/CeoDashboard/CeoDashboard.css:1001-1016`
- `src/screens/GMDashboard/GMDashboard.css:1001-1016`
- `src/screens/RetailDashboard/RetailManagerDashboard.css:1076-1091` (own prefix `.rm-status-badge`,
  same colors except delivered/completed use `#388e3c` not `#1b5e20` — **cosmetic divergence**)
- `src/screens/StoreManagerDashboard/StoreManagerDashboard.css:548-563` (`.sm-status-badge`, pending
  color `#ef6c00` not `#e65100`, delivered/completed `#388e3c` not `#1b5e20` — **cosmetic divergence**)

JSX usage of canonical helpers (consistent call site):
- `src/screens/AdminDashboard/AdminDashboard.jsx:2848, 3548`
- `src/screens/CeoDashboard/CeoDashboard.jsx:2532, 3032, 3257`
- `src/screens/GMDashboard/GMDashboard.jsx:1647`
- `src/screens/StoreManagerDashboard/StoreManagerDashboard.jsx:1271` — passes a **raw non-normalized
  class** `(o.status === "pending" ? "order_received" : (o.status || "order_received"))` into the
  className instead of `normalizeOrderStatus(o.status)` (functionally close but doesn't lowercase/trim
  like the shared normalizer does — a raw mixed-case `status` value would produce a class miss here
  where AdminDashboard/CeoDashboard would still match).

**DIVERGENT / bypasses canonical helper**:
- `src/screens/GMDashboard/GMDashboard.jsx:1563` — `` `status-badge ${order.status}` `` with text
  `{order.status || "pending"}`, i.e. renders the **raw unnormalized status string** with no
  `getOrderStatusLabel` title-casing and no `normalizeOrderStatus` — literal `"pending"` shows as
  lowercase "pending" here while the same dashboard's other tables show "Order Received"
  (line 1647 nearby uses the canonical pair). Two different renderers for order status **within the
  same file**.
- `src/screens/RetailDashboard/RetailManagerDashboard.jsx:1526-1529` — fully local reimplementation
  instead of calling `getOrderStatusLabel`: `(order.status === "pending" ? "order_received" : (order.status || "order_received")).replace(" ", "_")` for the class, and a hand-rolled
  ternary chain for the label (`"Order Received"` / else `status.charAt(0).toUpperCase() + status.slice(1).replace("_"," ")`).
  Produces the same output as the canonical helper for common values, but is a third copy of the same logic.

**Suggested collapse**: one shared `<OrderStatusBadge status={order.status} prefix="status-badge"/>`
component wrapping `normalizeOrderStatus` + `getOrderStatusLabel` (already canonical), plus one shared
CSS class table instead of 6 near-identical per-dashboard copies (Admin/COO/CEO/GM/RetailManager/StoreManager).

<!-- TIER: TIER3-COMPONENT — <OrderStatusBadge status prefix> wrapping the already-canonical normalizeOrderStatus + getOrderStatusLabel, plus one shared CSS class table replacing 6 near-identical per-dashboard copies. TIER1-WIRE side: GMDashboard:1563 and RetailManagerDashboard:1526-1529 bypass the canonical helpers (raw/hand-rolled) and should route through them. Color deltas (RM/SM delivered #388e3c, SM pending #ef6c00) are cosmetic SKIP-level. -->


---

## Cluster 3 — Production-Manager-family order status derivation + badge class

Pattern: derive a coarse order status ("Delivered"/"Completed"/"Ready"/"In Production"/"Cancelled"/"Pending")
from multiple raw fields, then map that derived label to a CSS class. Each dashboard re-derives the
bucket independently with its own field-priority order.

- `src/components/B2B/ProductionManagerDashboard/ProductionManagerDashboard.jsx:1305-1324`
  (label-derivation shown at 1310-1316, class maps at 1318-1324):
  ```
  if (order.status === "delivered") return "Delivered";
  if (order.status === "completed" || order.production_status === "dispatched" || order.warehouse_stage === "dispatched") return "Completed";
  if (order.production_status === "ready_for_dispatch") return "Ready";
  if (order.production_status === "in_production" || order.status === "prepared") return "In Production";
  if (order.status === "cancelled") return "Cancelled";
  return "Pending";
  ```
  `getStatusClass` (L1318-1320): pm-status-dispatched/ready/inprod/cancelled/pending.
  `getStatusBadgeClass` (L1322-1324) is a **second, unrelated** mapping over the *raw* `order.status`
  (delivered/cancelled/prepared/confirmed/default pending) used for the "Cancelled" banner (L2144) and
  the live order badge (L2148) — i.e. this one file carries two different status→class functions
  simultaneously that don't share a vocabulary.
- `src/screens/B2bProductionDashboard/B2bProductionDashboard.jsx:224-232` (`getStageBucket`) +
  `:487-509` (`getStageStatusLabel`/`getStageStatusClass`):
  ```
  if (st === "completed" || st === "delivered" || st === "dispatched") return "dispatched";
  ws === "dispatched" -> "dispatched"; ws === "packaging_dispatch" -> "ready";
  getStageGroupKey(ws) truthy -> "in_production"; else "queue"
  ```
  Label for "in_production" bucket calls the canonical `getStageLabel(order.warehouse_stage)` — this
  file is the only one of the three that reuses a canonical stage-label helper for the granular label.
  Classes: `prod-status-inprod/ready/dispatched/pending/cancelled`.
- `src/screens/CommsDashboard/CommsDashboard.jsx:614-627` — third independent bucket function, inline
  IIFE, bespoke to Comms: pending/rejected/delivered-or-completed/"order-received" (only 4 buckets, no
  in-production/ready distinction at all). Classes: `comms-status-pending/cancelled/delivered/order-received`.

**NUMBER/LABEL-AFFECTING**: these three buckets read different field combinations and can genuinely
disagree for the same order — e.g. an order with `production_status === "ready_for_dispatch"` but no
`warehouse_stage === "packaging_dispatch"` would show "Ready" in PM dashboard but fall through to
"in_production"/generic stage name in B2bProductionDashboard, and to "order-received" in CommsDashboard
(which has no ready-for-dispatch concept at all). **Mark as NUMBER-AFFECTING** in the sense that the
same order's displayed lifecycle bucket differs by which dashboard views it.

**Suggested collapse**: a single `getOrderLifecycleBucket(order) -> 'queue'|'in_production'|'ready'|'dispatched'|'cancelled'`
in `barcodeService.js` (mirroring the already-shared `getStageGroupKey`), with per-screen CSS-prefix
badges reading off that one bucket.

<!-- TIER: DIVERGENCE — PM / B2bProduction / Comms derive the lifecycle bucket from different field-priority orders and genuinely disagree for the same order (e.g. production_status "ready_for_dispatch" without warehouse_stage "packaging_dispatch" → "Ready" on PM, "in_production" on B2bProduction, "order-received" on Comms). Number/label-affecting; a single getOrderLifecycleBucket() must be authored as a deliberate reconciliation, not a mechanical extract. -->


---

## Cluster 4 — B2B approval_status → class/label (`pending`/`approved`/`rejected`)

Pattern: identical 3-way switch over `order.approval_status`, default "pending", each screen with its
own CSS class prefix.

- `src/screens/B2bOrderHistory/B2bOrderHistory.jsx:160-174` — `getStatusClass`/`getStatusText`,
  classes `approved`/`rejected`/default `pending` (bare, no prefix).
- `src/screens/B2bOrderView/B2bOrderView.jsx:181-187` — `getStatusClass` only (no separate label fn;
  label rendered as raw `order.approval_status` elsewhere), classes `status-approved`/`status-rejected`/default `status-pending`.
- `src/screens/B2bVendorOrders/B2bVendorOrders.jsx:127-135` — `getStatusBadge` returns the whole
  `<span>` (only one here that returns JSX, not a class string), object-literal map
  `{pending,approved,rejected}` each `{class, label}`, default `statusMap.pending`.
- `src/screens/B2bExecutiveDashboard/B2bexecutivedashboard.jsx:255-261` — `getStatusBadgeClass`,
  classes `b2b-status-approved`/`b2b-status-rejected`/default `b2b-status-pending`.
- `src/screens/B2bMerchandiserDashboard/B2bMerchandiserDashboard.jsx:827-840` — `getStatusBadgeClass`,
  classes `merch-status-approved`/`merch-status-rejected`/`merch-status-cancelled`/default `merch-status-pending`.
  **DIVERGENT**: this is the only one of the five with a **4th case, `cancelled`**, plus a wrapper
  `orderBadgeLabel`/`orderBadgeClass` (L839-840) that overrides to "Cancelled" whenever
  `order.status === "cancelled"`, specifically because "a cancelled order keeps approval_status='approved'
  and would otherwise misleadingly read 'Approved'" (comment at L836-838). **The other four B2B screens
  (OrderHistory, OrderView, VendorOrders, ExecutiveDashboard) have no such override** — a B2B order that
  is cancelled but was previously approved will display as "Approved" on those four screens and
  "Cancelled" only on Merchandiser. **This is a real behavioral/label divergence, not just styling.**

**Suggested collapse**: one `getB2bApprovalStatusMeta(order) -> {class, label}` in a shared util that
bakes in the cancelled-override Merchandiser already has, used by all five B2B screens plus their CSS
(`status-badge.status-approved` etc. currently redefined per file: `B2bOrderView.css:128-148`,
`B2bExecutiveDashboard.css:590+`, `B2bMerchandiserDashboard.css:103-107`, `B2bOrderHistory.css`,
`B2bVendorOrders.css:232+`).

<!-- TIER: DIVERGENCE — a cancelled-but-previously-approved B2B order reads "Approved" on OrderHistory/OrderView/VendorOrders/ExecutiveDashboard but "Cancelled" on Merchandiser (only Merchandiser has the override). Real label divergence: the 4 screens must adopt Merchandiser's cancelled-override before the 3-way switch collapses into getB2bApprovalStatusMeta() — a correctness decision, not a pure refactor. (Post-decision, the collapse + shared CSS is a TIER3-COMPONENT follow-on.) -->


---

## Cluster 5 — Payment status derivation (`getPaymentStatus`) — paid/partial/unpaid

Pattern: compute a 3-state payment status from an order's total vs amount collected, then render a
`payment-badge`/`<prefix>-payment-badge` with `.charAt(0).toUpperCase()+slice(1)` capitalization.

Near-identical copies (same field reads: `order.net_total ?? order.grand_total_after_discount ?? order.grand_total ?? 0`
and `order.advance_payment || 0`; same thresholds `advance >= total` → paid, `advance > 0` → partial, else unpaid):
- `src/screens/AdminDashboard/AdminDashboard.jsx:568-574`
- `src/screens/GMDashboard/GMDashboard.jsx:310-316`
- `src/screens/CeoDashboard/CeoDashboard.jsx:316-322`
- `src/screens/RetailDashboard/RetailManagerDashboard.jsx:248-254`
- `src/screens/StoreManagerDashboard/StoreManagerDashboard.jsx:238-244`
- `src/screens/COODashboard/COODashboard.jsx:219` (same logic, written as one-liner):
  `const t = order.net_total ?? order.grand_total_after_discount ?? order.grand_total ?? 0; const a = order.advance_payment || 0; if (a >= t) return "paid"; if (a > 0) return "partial"; return "unpaid";`

**NUMBER-AFFECTING DIVERGENT COPY**:
- `src/components/B2B/ProductionManagerDashboard/ProductionManagerDashboard.jsx:458-464`:
  ```js
  const paid = Number(order.amount_paid || 0);
  const total = Number(order.grand_total || order.net_total || 0);
  if (paid <= 0) return "unpaid";
  if (paid >= total) return "paid";
  return "partial";
  ```
  Reads **`order.amount_paid`** instead of **`order.advance_payment`** (a different column), and
  **`grand_total` before `net_total`** instead of `net_total` before `grand_total_after_discount`/`grand_total`
  (reversed precedence, and `grand_total_after_discount` is skipped entirely). For any order where
  `amount_paid` and `advance_payment` diverge, or where `net_total` differs from `grand_total`, this
  dashboard will show a **different paid/partial/unpaid bucket than Admin/GM/CEO/Retail/StoreManager/COO
  for the same order**.

Render-site divergence (label casing):
- `src/screens/StoreManagerDashboard/StoreManagerDashboard.jsx:1270` — `` <span className={`sm-payment-badge ${getPaymentStatus(o)}`}>{getPaymentStatus(o)}</span> `` —
  renders the **raw lowercase** value ("paid"/"partial"/"unpaid") with **no capitalization**, unlike
  every other screen in this cluster which does `.charAt(0).toUpperCase()+slice(1)` (AdminDashboard.jsx:3467,
  CeoDashboard.jsx:3176, GMDashboard.jsx:1562, RetailManagerDashboard.jsx:1522-1524, COODashboard.jsx:1015).

CSS color tables (all `paid`→#e8f5e9/#2e7d32, `partial`→#fff3e0/#e65100, `unpaid`→#ffebee/#c62828,
copy-pasted per dashboard):
- `src/screens/AdminDashboard/AdminDashboard.css:1032-1042`
- `src/screens/CeoDashboard/CeoDashboard.css:1019-1029`
- `src/screens/COODashboard/COODashboard.css:1019-1029`
- `src/screens/GMDashboard/GMDashboard.css:1019-1029`
- `src/screens/RetailDashboard/RetailManagerDashboard.css:1093-1103`
- `src/screens/StoreManagerDashboard/StoreManagerDashboard.css:535-546` — **DIVERGENT color**: `partial`
  is `#ef6c00` here vs `#e65100` everywhere else (cosmetic only).

**Suggested collapse**: one `getPaymentStatus(order)` in a shared util (`utils/orderStatus.js` or
similar) with the Admin/GM/CEO/Retail/StoreManager/COO field-precedence as the single definition, and
one `<PaymentBadge status={…}/>` component owning both the capitalization and the CSS. The
ProductionManagerDashboard divergence should be flagged to whoever owns that dashboard before any
merge — it is reading a different money field, not just a different style.

<!-- TIER: TIER2-EXTRACT (6 consensus copies) — Admin/GM/CEO/Retail/StoreManager/COO getPaymentStatus share identical field reads (advance_payment vs net_total-first chain); extract getPaymentStatus(order) verbatim + a <PaymentBadge> owning capitalization (fixes StoreManager's raw-lowercase render). NOTE: ProductionManagerDashboard is a DIVERGENCE — reads amount_paid + grand_total-first (a different money column/precedence) and can flip paid/partial/unpaid; must NOT be folded in silently, flag to that dashboard's owner. -->


---

## Cluster 6 — Priority derivation (`getPriority`) — urgent/normal

Pattern: boolean-ish predicate over an order returning `"urgent"` or `"normal"`, then rendered as an
`urgent-row`/`urgent-badge` "URGENT" flag next to the order id.

- `src/screens/AdminDashboard/AdminDashboard.jsx:576-579`
- `src/screens/GMDashboard/GMDashboard.jsx:318-321`
- `src/screens/CeoDashboard/CeoDashboard.jsx:324-327`
- `src/screens/RetailDashboard/RetailManagerDashboard.jsx:256-259`
  All four identical:
  ```js
  if (order.is_urgent || order.order_flag === "Urgent" || order.alteration_status === "upcoming_occasion") return "urgent";
  return "normal";
  ```

**DIVERGENT (NUMBER/FLAG-AFFECTING)**:
- `src/screens/COODashboard/COODashboard.jsx:220`:
  `(order.is_urgent || order.order_flag === "Urgent") ? "urgent" : "normal"` — **missing the
  `order.alteration_status === "upcoming_occasion"` condition** the other four have. An alteration
  order flagged "upcoming_occasion" will show as urgent on Admin/GM/CEO/Retail but **not** on COO.
- `src/screens/WarehouseDashboard.jsx:633-638`:
  ```js
  if (order.is_urgent || order.order_flag === "Urgent" || order.alteration_status === "upcoming_occasion" || order.priority === "urgent") {
    return "urgent";
  }
  return "normal";
  ```
  Adds a **4th condition**, `order.priority === "urgent"`, that none of the other five screens check.
  An order with only `order.priority === "urgent"` set (and none of the other three flags) would show
  urgent on WarehouseDashboard but normal everywhere else.
- `src/components/B2B/ProductionManagerDashboard/ProductionManagerDashboard.jsx:466`:
  `const getPriority = (order) => order.priority || "normal";` — **completely different rule**: reads
  only `order.priority`, ignoring `is_urgent`, `order_flag`, and `alteration_status` entirely. An order
  urgent by any of those three other flags (but without `order.priority === "urgent"` set) reads as
  **not urgent** on this dashboard while every other dashboard in this cluster marks it urgent — the
  most severe divergence in the whole sweep since it silently drops an urgency signal rather than adding one.

**Suggested collapse**: one `getOrderPriority(order) -> 'urgent'|'normal'` in `barcodeService.js`
(or a new `utils/orderStatus.js`) checking all four signals (`is_urgent`, `order_flag`, `alteration_status`,
`order.priority`) as the union, used by all six dashboards + WarehouseDashboard.

<!-- TIER: DIVERGENCE — the four "identical" copies plus three divergent ones each check a different signal set: COO drops alteration_status "upcoming_occasion"; Warehouse adds priority==="urgent"; PM reads ONLY order.priority (silently drops 3 urgency signals — most severe). Number/flag-affecting: the same order flags urgent on some dashboards and not others. Unifying to the 4-signal union changes what shows urgent on every divergent screen → needs a human decision on the intended signal set before getOrderPriority() lands. -->


---

## Cluster 7 — Alteration/return payment-status style literals (not a real duplication)

`src/screens/B2bMerchandiserDashboard/B2bMerchandiserDashboard.jsx:34` (`DELIVERABLE_OPTIONS`) and
`src/screens/CommsDashboard/CommsPRPerformance.jsx` (`STATUS_OPTIONS`-style "Partial" option) both
contain the literal string `"Partial"` but these are **unrelated dropdown option lists** (deliverable
tracking / PR performance), not payment-status badges. Confirmed false positive from the initial grep
— no action needed, noted only so it isn't re-flagged.

<!-- TIER: SKIP — confirmed false positive; unrelated dropdown option lists that merely share the literal "Partial". No action. -->


---

## Cluster 8 — Component/QC stage pill (well-factored — noted for contrast)

`src/components/ComponentStageBadge.jsx` is a single shared component consumed by
`WarehouseDashboard.jsx`, `B2bProductionDashboard.jsx`, `ProductionManagerDashboard.jsx`,
`CommsDashboard.jsx`, `ComponentJourneyModal.jsx`, `B2bMerchandiserDashboard.jsx` — this concern is
**already centralized** and should be the model for the collapses proposed above. Likewise
`getSAStageLabel`/`getSAStageColor` and `getStageLabel`/`getStageColor`/`getStageInfo` in
`barcodeService.js` are single-source; only their *local re-derivations* (Clusters 1-3 above) are
duplicated, not these helpers themselves.

<!-- TIER: SKIP — ComponentStageBadge.jsx + the stage-label/color helpers are already centralized and single-source. The model for the collapses above, not a duplication finding itself. -->


---

## Cluster 9 — "Converted / Not Converted" walk-in badge (byte-identical, low stakes)

- `src/screens/WalkInTab.jsx:234-238`
- `src/components/WalkInsView/WalkInsView.jsx:300-304`

Byte-identical: `` <span className={`wi-status-badge ${converted ? "converted" : "not-converted"}`}>{converted ? "Converted" : "Not Converted"}</span> ``,
plus duplicated CSS (`WalkInTab.css:392-406`, `WalkInsView.css:207-221`). Trivial binary badge,
lowest-value cluster in this sweep but a clean 1:1 extraction candidate.

<!-- TIER: TIER2-EXTRACT — byte-identical "Converted / Not Converted" badge (+ duplicated CSS) between WalkInTab and WalkInsView; a clean 1:1 verbatim extraction. Lowest value in the sweep but risk-free. -->


---

## Summary of NUMBER-AFFECTING divergences

1. **Cluster 3** — order lifecycle bucket (Ready/In Production/etc.) computed differently across
   PM Dashboard / B2bProductionDashboard / CommsDashboard — same order can bucket differently.
2. **Cluster 5** — ProductionManagerDashboard's `getPaymentStatus` reads `amount_paid` +
   `grand_total`-first instead of `advance_payment` + `net_total`-first — can flip paid/partial/unpaid.
3. **Cluster 6 (COODashboard)** — missing `alteration_status === "upcoming_occasion"` urgent condition.
4. **Cluster 6 (WarehouseDashboard)** — extra `order.priority === "urgent"` urgent condition no one else checks.
5. **Cluster 6 (ProductionManagerDashboard)** — `getPriority` ignores 3 of the 4 urgency signals entirely.

**Total NUMBER-AFFECTING divergences: 5** (across Clusters 3, 5, 6×3).
