# Fetch + Role/Channel Scoping Duplication Sweep

Scope: `src/screens/**` dashboards, `src/components/**`, `src/utils/**`.
Concern: Supabase fetch blocks in dashboards + role/channel scoping applied to them.
Read-only sweep — no source modified.

---

## Cluster 1 — "check session/getUser, then re-query `salesperson` by email, then gate on `role`"

**Pattern:** every top-level dashboard re-implements its own auth+role guard on mount:
`supabase.auth.getSession()` (or `getUser()`) → `supabase.from("salesperson").select(...).eq("email", <email>.toLowerCase()).single()/.maybeSingle()` → `if (!userRecord || userRecord.role !== "<expected>") { supabase.auth.signOut(); navigate("/login") }`.

This is the CLAUDE.md-documented "decentralized role-guard" — confirmed duplicated **at least 20 times**, one per dashboard, each with a different literal role string and a different selected column list.

Occurrences (file:line of the `.from("salesperson")` call; guard is the following ~6 lines in each):

- `src/screens/AdminDashboard/AdminDashboard.jsx:304` — cols: `saleperson, role, email, phone, store_name, designation, can_place_stock_orders`; gate: `role !== "admin"`
- `src/screens/AssociateDashboard.js:384` — cols: `*`; gate: `role !== "salesperson" && role !== "sa_services"` (two allowed roles, only dashboard with a "services" carve-out)
- `src/screens/CeoDashboard/CeoDashboard.jsx:269` — cols: `role`; gate: `role !== "ceo"`
- `src/screens/CeoAssistantDashboard/CeoAssistantDashboard.jsx` (2 hits) — same shape, gate presumably `ceo_assistant`-style role (not re-read line-by-line but matches cluster; see grep count 2)
- `src/screens/COODashboard/COODashboard.jsx:136` — cols: `role, saleperson`; gate: `role !== "coo"` (single-line chained call, not multi-line like the others — **stylistic divergence**, same logic)
- `src/screens/GMDashboard/GMDashboard.jsx:193` — cols: `saleperson, role, email, phone, store_name, designation, can_place_stock_orders`; gate implied `role !== "gm"` (byte-identical column list to AdminDashboard's)
- `src/screens/AssistantCmoDashboard/AssistantCmoDashboard.jsx:153` — cols: `saleperson, role, email, phone, store_name, designation, can_place_stock_orders` (same list again); gate: `role !== "assistant_cmo"`
- `src/screens/StoreManagerDashboard/StoreManagerDashboard.jsx:129` — cols: `role, saleperson, store_name`; gate: `role !== "store_manager"`
- `src/screens/RetailDashboard/RetailManagerDashboard.jsx:165` — cols: `role` only; gate: `role !== "retail_manager"`
- `src/screens/HeadOfDesignDashboard/HeadOfDesignDashboard.jsx:133` — cols: `role, saleperson`; gate: `role !== "head_of_design"`
- `src/screens/WarehouseDashboard.jsx:595` — cols: `role, assigned_stations, designation`; gate: `role !== "warehouse"` (only variant that also seeds `assigned_stations`/`designation` into state right here)
- `src/screens/AccountantDashboard/AccountantDashboard.jsx:142` — cols: `role, saleperson`; gate: `role !== "accountant"`
- `src/screens/AccountsDashboard/AccountsDashboard.jsx:63` — cols: `role`; gate: `role !== "accounts"` (note: distinct role/dashboard from AccountantDashboard above — a real near-duplicate concern, not a typo)
- `src/components/B2B/ProductionManagerDashboard/ProductionManagerDashboard.jsx:283` — cols: `role`; gate: `role !== "production_manager"`; **plus a second full-profile fetch right after** at line 297 (`select("*")`) — i.e. two `salesperson` round-trips where other dashboards do it in one
- `src/screens/B2bMerchandiserDashboard/B2bMerchandiserDashboard.jsx:143` — cols: `role`; gate: `role !== "merchandiser"`; **also** a second `select("*")` profile fetch at line 157 batched into the `Promise.all` (same two-round-trip shape as ProductionManagerDashboard)
- `src/screens/B2borderdetails/B2bOrderDetails.jsx:33` — cols: `role`; gate: `!["executive","merchandiser","production"].includes(role)` — **DIVERGENT**: multi-role allow-list instead of a single string equality
- `src/screens/B2bproductform/B2bproductform.jsx:248` — identical allow-list `["executive","merchandiser","production"]`, byte-similar to B2bOrderDetails
- `src/screens/B2bVendorOrders/B2bVendorOrders.jsx:55` — identical allow-list `["executive","merchandiser","production"]` again
- `src/screens/B2bRevieworder/B2bReviewOrder.jsx:63` — same allow-list `["executive","merchandiser","production"]` (4th copy of this exact 3-role list)
- `src/screens/WalkInDashboard/WalkInDashboard.jsx:40` — cols: `role`; gate: `role !== "walkin_viewer"`
- `src/screens/ScanStationPage/ScanStationPage.jsx` — 1 hit (role-scoping for scan-station operators; not fully read but matches cluster)
- `src/screens/CommsDashboard/CommsDashboard.jsx` / `CommsReviewOrder.jsx` / `CommsOrderForm.jsx` — 1 hit each, same shape guarding the Comms/Nazreen role
- `src/screens/B2bExecutiveDashboard/B2bexecutivedashboard.jsx` — 2 hits (role guard + a second profile read)
- `src/screens/B2bvendorSelection/B2bvendorselection.jsx` — 2 hits
- `src/screens/OrderHistory.jsx:401` and `src/screens/EditOrder/EditOrder.jsx:153` — **DIVERGENT sub-pattern**: these two don't gate on `role` at all, they read `designation` and derive a coarse `userRole = "SM"` via `designation.toLowerCase().includes("manager")` — a *different, string-matching* scoping mechanism living alongside the role-equality mechanism used everywhere else. **Two implementations of "am I a manager" that could disagree** (a `role`-string check vs a substring-of-`designation` check) — NUMBER/ACCESS-AFFECTING if a designation is renamed without the string still containing "manager".

**Divergences worth flagging explicitly (not defects, just recorded):**
- Single-role equality (`role !== "x"`) vs multi-role allow-list (`!allowedRoles.includes(role)`) are two different guard shapes for the same intent.
- Column lists selected alongside `role` vary per dashboard (some pull `saleperson`/`store_name`/`designation`/`assigned_stations`/`can_place_stock_orders` inline, others fetch only `role` and do a second round-trip for the rest).
- `AccountantDashboard.jsx` (`role !== "accountant"`) and `AccountsDashboard.jsx` (`role !== "accounts"`) are separate roles/dashboards that are easy to conflate by name only — confirmed distinct, not a copy-paste bug.
- designation-substring role inference (`OrderHistory.jsx`, `EditOrder.jsx`) is a parallel mechanism to role-string equality used by every other dashboard.

**Suggested shared helper:** a `useRoleGuard(expectedRole | expectedRoles[], { navigate, redirectTo = "/login", selectColumns })` hook that does session check → single `salesperson` fetch with a caller-supplied column list → allow-list or single-role compare → signOut+redirect on failure → returns the fetched row so callers don't need a second round-trip (would also remove the ProductionManagerDashboard/B2bMerchandiserDashboard double-fetch).

<!-- TIER: TIER4-HOOK — new useRoleGuard(expectedRoles, {selectColumns}) hook collapses ~20 mount-time auth/role guards. NOTE: the OrderHistory/EditOrder designation-substring "am I a manager" mechanism is an access-affecting DIVERGENCE that must be reconciled with role-equality before folding into the hook. -->


---

## Cluster 2 — Hand-rolled `.range()` pagination loops duplicating `fetchAllRows`

`src/utils/fetchAllRows.js` exists precisely to page past Supabase's 1000-row cap (per CLAUDE.md, mandatory for growable tables). It IS used correctly in ~24 call sites (`AdminDashboard`, `GMDashboard`, `CeoDashboard`, `COODashboard`, `StoreManagerDashboard`, `RetailManagerDashboard`, `HeadOfDesignDashboard`, `AssistantCmoDashboard`, `CeoAssistantDashboard`, `WarehouseDashboard.jsx:306`, `WalkInDashboard.jsx:66`, `WalkInTab.jsx:72`, `AccountsDashboard.jsx:32`, `AccountantDashboard.jsx:154`, `AssociateDashboard.js:449`, `B2bExecutiveDashboard`, `B2bMerchandiserDashboard.jsx:159`, `B2bProductionDashboard.jsx:125`, `B2bVendorOrders.jsx:75`, `B2bOrderHistory.jsx:75`, `InventoryDashboard/StockCalendarTab.jsx:39`, `InventoryDashboard/StockOrdersTab.jsx:93`, `components/ExhibitionPanel.jsx:58`).

But **5 places reimplement the identical while-loop by hand instead**, byte-similar to `fetchAllRows`'s internals but not calling it:

1. `src/components/B2B/ProductionManagerDashboard/ProductionManagerDashboard.jsx:300-319` — manual loop over `orders` table:
   ```js
   const PAGE_SIZE = 1000;
   let allOrders = []; let from = 0; let done = false;
   while (!done) {
     const { data, error } = await supabase.from("orders").select("*")
       .order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
     if (error) throw error;
     if (data && data.length > 0) { allOrders = [...allOrders, ...data]; from += PAGE_SIZE; if (data.length < PAGE_SIZE) done = true; }
     else done = true;
   }
   ```
   Same file already imports and could use `fetchAllRows` (it's used elsewhere in the codebase for the exact same `orders` table). This is a plain re-implementation, not a variant — **near byte-identical logic, different variable names (`allOrders`/`done` vs the helper's `all`)**.

2. `src/screens\B2bMerchandiserDashboard\B2bMerchandiserDashboard.jsx:184-199` — manual loop over `order_components`:
   ```js
   const PAGE = 1000; let all = []; let from = 0;
   while (true) {
     const { data: cData, error: cErr } = await supabase.from("order_components")
       .select("id, order_id, barcode, component_type, component_label, current_stage, item_index, is_outside_wh, re_journey_count, stage_pass_counts")
       .order("created_at", { ascending: false }).range(from, from + PAGE - 1);
     if (cErr) { console.warn(...); break; }
     if (!cData || cData.length === 0) break;
     all = [...all, ...cData]; if (cData.length < PAGE) break; from += PAGE;
   }
   ```
3. `src/screens\B2bProductionDashboard\B2bProductionDashboard.jsx:151-166` — **near-identical** to #2, same table, same loop shape, column list differs only by extra `vendor_name, vendor_location, vendor_exit_at, stage_updated_at` fields.
4. `src/utils/qcHistory.js:47-62` (approx, `.range` at line 58) — same while-loop shape, table `qc_records`, cols `QC_RECORD_COLUMNS`.
5. `src/utils/reJourneys.js:55-68` (approx, `.range` at line 64) — same while-loop shape, table `order_components`, filtered `.eq("is_rework", true).eq("is_active", true)`.

All 5 are functionally identical to `fetchAllRows` (same PAGE_SIZE=1000, same "stop when short page" termination), just copy-pasted inline instead of calling the shared helper — this is exactly the "hand-rolled pagination that should use fetchAllRows" duplication called out in the task. **Not NUMBER-AFFECTING by itself** (termination logic matches), but it is a live risk surface: any one of the 5 copies could silently diverge (e.g. wrong PAGE_SIZE, forgetting the `< PAGE_SIZE` break) without the others being touched.

**Suggested consolidation:** delete all 5 manual loops; replace with `fetchAllRows(table, buildQuery)` calls (already the pattern used correctly elsewhere in 3 of these same 5 files for other tables).

<!-- TIER: TIER1-WIRE — fetchAllRows() already exists and is used correctly in ~24 sites; the 5 hand-rolled .range() loops are functionally identical and just need swapping to the existing helper. Not number-affecting (termination logic matches). -->


---

## Cluster 3 — Channel/designation scoping: shared helper exists but is barely adopted

`src/utils/barcodeService.js` exports `getOrderChannelKey(order)`, `getOrderChannelLabel(order)`, and `scopeOrdersToDesignation(orders, designation)` specifically so channel-scoping logic and its underlying numbers can't drift between screens (per the code's own comment at `barcodeService.js:244-246`).

Actual adoption is narrow:
- `src/screens/WarehouseDashboard.jsx:16,409,415` — uses `scopeOrdersToDesignation` + `getOrderChannelKey` as intended.
- `src/screens/B2bMerchandiserDashboard/B2bMerchandiserDashboard.jsx:14,1290` — uses `getOrderChannelKey` only.

Every other dashboard that needs "which channel/store does this order belong to" re-implements its own inline classification instead of importing the shared helper:

- `src/screens/GMDashboard/GMDashboard.jsx:335` — local `getOrderChannel = (order) => getOrderChannelLabel(order)` wrapper (does call the shared label fn — fine), **but** `getOrderSalesperson` right below (`:337-342`) and the store-bucket logic at `:449,462,475,531-534` are hand-written prefix/`salesperson_store` string checks (`store.includes("delhi")`, `=== "dlc"`, `=== "ludhiana"`, `=== "ldhc"`, `=== "llc"`, `=== "b2b"`) — a **separate, string-literal channel classifier that duplicates what `getOrderChannelKey`/`getOrderPrefix` already encode**, and could disagree with the authoritative prefix parsing if a new store alias is added only in one place.
- `src/screens/CeoDashboard/CeoDashboard.jsx`, `src/screens/COODashboard/COODashboard.jsx` — same `Promise.all` shape as GMDashboard (`fetchAllRows("orders",...)`, `fetchAllRows("products",...)`, `salesperson` select, `vendors`, `consignment_inventory`) with `ordersRes.data.filter(o => !o.is_comms)` inline instead of a shared scoping call — **DIVERGENT default**: CeoDashboard/COODashboard filter out `is_comms` orders at fetch time; GMDashboard does NOT apply this filter to its `orders` state (GM's `fetchAllData` at `:255-261` has no `.filter(o => !o.is_comms)`) — **NUMBER-AFFECTING**: GM's revenue/order totals include Comms orders that CEO/COO's identical-looking dashboards exclude, from what is otherwise the same copy-pasted fetch block.
- `src/screens/AssistantCmoDashboard/AssistantCmoDashboard.jsx:219-231` — its own `ORDER_COLUMNS` constant (explicit column allow-list) rather than `select("*")` used by GM/CEO/COO/Admin/StoreManager, **and** it does apply `.filter(o => !o.is_comms)` (`:231`) — so of the four near-identical "GM-style" dashboards, 3 filter out comms orders and 1 (GM) doesn't, using an otherwise-identical `Promise.all([fetchAllRows("orders"...), fetchAllRows("products"...), salesperson select, vendors, consignment_inventory])` block. Also derives its own inline channel label at `:298-299` (`if (o.is_b2b) return "B2B"; const s = (o.salesperson_store||"").trim()`) rather than calling `getOrderChannelLabel`.
- `src/screens/StoreManagerDashboard/StoreManagerDashboard.jsx` — same `Promise.all` triple-fetch shape (orders/products/salesperson), no comms filter visible in the excerpt read.

**The "GM-dashboard-style" fetch block itself is a duplicated cluster on its own:**
```js
const [ordersRes, productsRes, spRes, vendorsRes, ...] = await Promise.all([
  fetchAllRows("orders", (q) => q.select("*").order("created_at", { ascending: false })),
  fetchAllRows("products", (q) => q.select("*").order("name", { ascending: true })),
  supabase.from("salesperson").select("saleperson, role, email, phone, store_name, sales_target, designation"),
  supabase.from("vendors").select("*"),
  supabase.from("consignment_inventory").select("*"), // present in GM/CEO/COO, absent in others
]);
```
Recurs near-verbatim at:
- `GMDashboard.jsx:255-261`
- `CeoDashboard.jsx:289-295`
- `COODashboard.jsx:151-157`
- `AdminDashboard.jsx:363-371` (swaps `consignment_inventory` for `profiles`, adds a comment about the 1000-row cap mattering for the client book)
- `StoreManagerDashboard.jsx:151-155` (drops `vendors`/`consignment_inventory`)
- `AssistantCmoDashboard.jsx:219-231` (swaps `select("*")` for explicit `ORDER_COLUMNS`, adds `.filter(!is_comms)`)

**Suggested consolidation:**
1. A `useDashboardOrdersAndRoster()` hook (or plain async helper) that returns `{ orders, products, salespersonTable, vendors, consignmentInventory }` via one `Promise.all([fetchAllRows("orders",...), fetchAllRows("products",...), supabase.from("salesperson").select(...), ...])`, with an explicit, named `includeComms` boolean parameter so the comms-inclusion difference between GM and CEO/COO/AssistantCmo becomes a visible, intentional argument instead of a silent copy-paste drift.
2. Route all "which channel/store/designation does this order belong to" decisions through `getOrderChannelKey` / `getOrderChannelLabel` / `scopeOrdersToDesignation`, retiring the inline strings-based classifiers in `GMDashboard.jsx` (`getOrderSalesperson`, the day-wise-sales store bucketer) and `AssistantCmoDashboard.jsx` (`:298-299`).

<!-- TIER: DIVERGENCE — GM's fetch omits the .filter(o => !o.is_comms) that CEO/COO/AssistantCmo apply, so GM's revenue/order totals include Comms orders the others exclude (number-affecting) — needs a human decision on which is correct. The surrounding GM-style Promise.all fetch block is a separate TIER4-HOOK (useDashboardOrdersAndRoster with explicit includeComms), and the inline channel classifiers are TIER1-WIRE onto the existing getOrderChannelKey/Label/scopeOrdersToDesignation helpers. -->


---

## Cluster 4 — `sessionStorage.setItem("currentSalesperson", ...)` seeding, shape varies

Every entry point into the order-placement flow re-seeds `currentSalesperson` before navigating to `/product` or `/buyerVerification`, each building the JSON object inline with a different field set:

- `src/screens/AssociateDashboard.js:545,1049,1082,2146` (4 separate inline copies in the same file) — `{ name: salesperson.saleperson, email: salesperson.email, ... }`
- `src/screens/AdminDashboard/AdminDashboard.jsx:347-353` — `{ name, email, phone, store, designation }` (5 fields, from `currentUserProfile`)
- `src/screens/GMDashboard/GMDashboard.jsx:1449-1455` — `{ store, name, email }` only (3 fields — **no `phone`/`designation`**, DIVERGENT shape vs Admin/AssistantCmo)
- `src/screens/AssistantCmoDashboard/AssistantCmoDashboard.jsx:195-197+` — mirrors Admin's `{ name, email, phone, store, designation }` shape (same 5 fields, from `currentUserProfile`)
- `src/screens/StoreManagerDashboard/StoreManagerDashboard.jsx:1060-1062,1222-1224` (2 inline copies in the same file) — `{ store: userStore, name: currentUserName, ... }` (state-variable-sourced, not a `currentUserProfile` object, so field availability differs again)
- `src/components/ExhibitionPanel.jsx:149-156` — `{ name, email, phone, store, designation, role }` — **only place that also seeds `role`**
- `src/screens/CommsDashboard/CommsOrderForm.jsx:255-257+` — seeds from `profile.saleperson`/`profile.email`, comment explicitly says "Mirror the SA flow's currentSalesperson"
- `src/screens/SALogin.js:104,112,120,132` (4 inline copies for different roles at login) — builds `{ store, name, email }` from either the `profiles` table (executive/merchandiser/production roles) or a `salesperson` lookup (production_manager), i.e. **two different source tables feeding the same sessionStorage shape** depending on role.

**Divergence detail (field-set, not just formatting):**
| Site | fields seeded |
|---|---|
| AssociateDashboard.js (x4) | name, email, + others per call site |
| AdminDashboard / AssistantCmoDashboard | name, email, phone, store, designation |
| GMDashboard | store, name, email (missing phone, designation) |
| ExhibitionPanel | name, email, phone, store, designation, **role** |
| StoreManagerDashboard | store, name (sourced from local state vars, not a profile object) |
| SALogin (executive/merchandiser/production) | store, name (from `profiles` table) |
| SALogin (production_manager) | store, name (from `salesperson` table) |

Downstream readers (`OrderDetails.js:208,405,629`, `ProductForm.js:2161,2174`, `ReviewDetail.js:133,143,231,277`) assume varying subsets of these fields exist (e.g. `sp.designation === "Private SA"`, `sp.role === "sa_services"`, `/exhib/i.test(sp.store)`) — since the writer side doesn't uniformly populate `designation`/`role`, a consumer expecting a field a particular writer omitted (e.g. GMDashboard's stock-order entry point never sets `designation`) would read `undefined`. **Potentially NUMBER/ACCESS-AFFECTING**: `ReviewDetail.js:131-135` derives `isPrivateSA` from `sp.designation`, and `ReviewDetail.js:141-145` derives `isExhibition` from `sp.store` matching `/exhib/i` — if the entry dashboard used to reach ReviewDetail didn't seed `designation` (e.g. GM/StoreManager stock-order paths), `isPrivateSA` silently evaluates false rather than erroring, which is exactly the kind of silent-fallback the project's own memory notes warn about.

**Suggested helper:** a single `seedCurrentSalesperson({ name, email, phone, store, designation, role })` writer (always the full shape, undefined-safe) used by every entry point instead of each dashboard hand-building its own JSON literal; pairs naturally with `restoreAssociateSession.js`, which already centralizes the read-back/cleanup side but not the write side.

<!-- TIER: TIER2-EXTRACT — new seedCurrentSalesperson(profile) write-side helper (always the full field shape) collapses the ~15 inline sessionStorage.setItem("currentSalesperson", ...) sites. NOTE: the field-set drift (GM/StoreManager omit designation, so downstream isPrivateSA silently reads false) is an access-affecting DIVERGENCE — writing the full shape fixes it, but confirm the intended values per entry point first. -->


---

## Cluster 5 — `sp_email` / associate session re-hydration

Only 2 direct hits for `sp_email` (`AssociateDashboard.js`, `SALogin.js`) plus the shared `src/utils/restoreAssociateSession.js` (already a single shared helper, called from multiple exit points per its own docstring). This part of the concern is **already centralized** — no duplication cluster to report beyond noting `restoreAssociateSession.js` only handles the read/cleanup half; the write half (seeding `currentSalesperson`/`associateSession`) remains scattered per Cluster 4.

<!-- TIER: SKIP — read/cleanup half already centralized in restoreAssociateSession.js; the scattered write half is already captured by Cluster 4. Nothing to do here. -->


---

## Summary of suggested shared helpers

1. `useRoleGuard(expectedRole(s), { selectColumns })` — collapses Cluster 1 (~20 call sites).
2. Replace 5 hand-rolled `.range()` loops with existing `fetchAllRows` — Cluster 2.
3. `useDashboardOrdersAndRoster({ includeComms })` — collapses the GM/CEO/COO/Admin/StoreManager/AssistantCmo `Promise.all` fetch block (Cluster 3), and route channel logic through the already-exported `getOrderChannelKey`/`getOrderChannelLabel`/`scopeOrdersToDesignation` instead of re-deriving inline.
4. `seedCurrentSalesperson(profile)` write-side helper to pair with the existing `restoreAssociateSession.js` read-side helper — collapses Cluster 4.
