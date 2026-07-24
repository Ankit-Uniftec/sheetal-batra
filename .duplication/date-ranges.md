# Date-range / period-filter duplication sweep

Scope: `src/screens`, `src/components`, `src/hooks`, `src/utils`. Concern:
Today/Week/Month/Year/Custom period switches, range-start/end helpers, and
"filter records to selected period" predicates.

A shared component already exists — `src/components/PeriodFilter.jsx`
(+ `PeriodFilter.css`), exporting `PERIOD_OPTIONS`, `periodRange()`, the
`<PeriodFilter>` control (variants `"select"` / `"pills"`), and the
`usePeriodFilter(defaultTimeline, opts)` hook (state + predicate + rendered
control in one call). Its header comment says it was "extracted from
AssistantCMO's inline TimelineFilter... so every dashboard shows the same
control instead of five hand-rolled variants." That extraction happened but
was not applied everywhere — most of the big analytics dashboards still carry
their own independent, pre-extraction copy.

---

## Cluster 1 — `getDateRange(timeline)` switch (today/yesterday/weekly/monthly/yearly/custom)

The dominant pattern: a local `getDateRange`/`getAnalyticsDateRange` function,
`TIMELINE_OPTIONS` array (`today`, `yesterday`, `weekly`→7d, `monthly`→30d,
`yearly`→365d, `custom`), and a `filterOrdersByDateRange`/`filterByDate` helper
applied per-tab via local `useMemo`s. All variants share the exact same shape:
`today = new Date(y,m,d)` (local midnight), rolling day-counts (not calendar
week/month/year), custom = `new Date(customDateFrom)` .. `new
Date(customDateTo + "T23:59:59")`.

**Byte-identical logic (verbose form)** — differs only in brace/variable
naming style, not behavior:
- `src/screens/AdminDashboard/AdminDashboard.jsx:641-672` (`getDateRange`)
- `src/screens/GMDashboard/GMDashboard.jsx:385-407`
- `src/screens/COODashboard/COODashboard.jsx:236-247` (condensed one-liner style, same semantics)
- `src/screens/RetailDashboard/RetailManagerDashboard.jsx:271-290` (`getDateRange`) **and again** `:327-342` (`getAnalyticsDateRange`, same body, second copy in the SAME file, only difference is reading `analyticsCustomFrom/To` instead of `customDateFrom/To`)
- `src/screens/HeadOfDesignDashboard/HeadOfDesignDashboard.jsx:271-290` (as `getDateRange`, in a duplicate that also has its own simpler `dateRange` `useMemo` variant — see Cluster 2)
- `src/screens/AccountantDashboard/AccountantDashboard.jsx:348 area` calls `getDateRange`/`filterByDateRange` matching the same shape (helpers not re-quoted; same call pattern as RetailManagerDashboard)
- `src/screens/StoreManagerDashboard/StoreManagerDashboard.jsx:258-270` (`getDateRange`, condensed one-liner style)

TIMELINE_OPTIONS array copy-pasted verbatim (5-6 literal option objects) in:
- `src/screens/AdminDashboard/AdminDashboard.jsx:51-58`
- `src/screens/GMDashboard/GMDashboard.jsx:47-54`
- `src/screens/COODashboard/COODashboard.jsx:46-53`
- `src/screens/StoreManagerDashboard/StoreManagerDashboard.jsx:29-...` (same 5 values, no "all")
- `src/screens/HeadOfDesignDashboard/HeadOfDesignDashboard.jsx:23-31` (adds `{ value: "all", label: "All Time" }` — see divergence below)
- `src/screens/AccountantDashboard/AccountantDashboard.jsx:23-31` (same "all"-inclusive variant as HeadOfDesign)
- `src/screens/AssistantCmoDashboard/AssistantCmoDashboard.jsx:22-30` (local `TIMELINE_OPTIONS`, pre-extraction original; also includes "all")

**DIVERGENT — default/"all" handling, NUMBER-AFFECTING:**
- Admin/GM/COO/StoreManager `TIMELINE_OPTIONS` has **no `"all"` entry**, and
  their `getDateRange` `default:` case falls through to
  `{ start: today, end: now }` (today only) for any unmatched value — there is
  no way to see unbounded data through this control.
- HeadOfDesignDashboard / AccountantDashboard / AssistantCmoDashboard include
  `{ value: "all", label: "All Time" }` and special-case it: `case "all":
  return null;` (HeadOfDesign/Accountant `dateRange` useMemo, Cluster 2) or
  `if (timeline === "all") return orders;` (AssistantCmo, short-circuits
  before calling `getDateRange` at all — see
  `AssistantCmoDashboard.jsx:286-295`). Same option value, structurally
  different escape hatch, and **only present in 3 of 7 dashboards** — the
  other four cannot show unfiltered totals via this control at all.
- **Different defaults**: `AdminDashboard` and `AccountantDashboard`/
  `HeadOfDesignDashboard` default `timeline` to `"today"`; `COODashboard` and
  `GMDashboard` default to `"monthly"`. Same dropdown, same code shape,
  different starting numbers shown to different roles on first paint.

**Comparison-period logic** (`getComparisonDateRange`/`getPrevRange`) — same
"previous_period vs previous_year" duplicate, present only in the
Admin/GM/COO/HeadOfDesign family:
- `src/screens/AdminDashboard/AdminDashboard.jsx:674-737`
- `src/screens/GMDashboard/GMDashboard.jsx:409-420`
- `src/screens/COODashboard/COODashboard.jsx:250-254` (`getPrevRange`, no separate comparison-type case split beyond previous_year vs. default)
- `src/screens/RetailDashboard/RetailManagerDashboard.jsx:292-318` (`getComparisonDateRange`, includes an extra `if (comparisonType !== "previous_period") return null;` guard the others don't have)

**DIVERGENT, NUMBER-AFFECTING** — COODashboard's `getPrevRange` (line 250-254)
collapses Admin's full per-timeline previous-period switch (today→yesterday,
yesterday→2-days-ago, weekly→14d-ago..7d-ago, etc., `AdminDashboard.jsx:689-736`)
into one generic `duration = cur.end - cur.start` subtraction for every
timeline value except `previous_year`. For "yesterday" specifically Admin
returns the exact calendar day two days ago; COO's generic version returns
`cur.start - duration` which for "yesterday" (duration ≈ 1 day) lands on the
same day-before but computed generically rather than via explicit calendar
arithmetic — behaviorally close but not derived the same way, and diverges
for "custom" ranges of unusual length where Admin has an explicit
`customDuration` branch (`AdminDashboard.jsx:724-733`) while COO's generic
formula folds custom in with everything else via the same `duration`
subtraction (equivalent here, but only by coincidence of formula reuse, not
shared code).

**Suggested collapse:** delete every local `getDateRange` /
`getComparisonDateRange` / `TIMELINE_OPTIONS` / `filterOrdersByDateRange`
and standardize on `usePeriodFilter` from `PeriodFilter.jsx` — but first
reconcile that `PeriodFilter.periodRange()` uses **different bucket
semantics** (`"7d"`/`"30d"` = rolling last-N-days like these dashboards' fixed
weekly/monthly, but `"month"`/`"year"` there mean **calendar** month/year-to-date,
not rolling 30/365 days — see Cluster 3). Any migration of Admin/GM/COO/etc.
onto `usePeriodFilter` must decide whether "Last 30 Days" (rolling) or
"This month" (calendar) is intended — they are not interchangeable and the
choice changes the displayed revenue/order counts.

<!-- TIER: TIER1-WIRE (with a blocking DIVERGENCE) — usePeriodFilter/PeriodFilter.jsx already exist and are the extraction target for the 7 local getDateRange/TIMELINE_OPTIONS copies. BUT: (a) rolling-vs-calendar "month"/"year" semantics differ from the canonical helper, (b) the "all"/unbounded escape hatch exists in only 3 of 7 dashboards, (c) default timeline differs (today vs monthly), (d) COO's generic previous-period formula diverges from Admin's per-case arithmetic — all number-affecting, must be reconciled by a human before the wire-up. -->


---

## Cluster 2 — simple `dateRange` useMemo + `periodOrders` filter (HeadOfDesign / Accountant)

A lighter-weight variant of Cluster 1, inlined as a single `useMemo` (not a
named `getDateRange` function), used once per dashboard rather than per-tab:

- `src/screens/HeadOfDesignDashboard/HeadOfDesignDashboard.jsx:162-191`
- `src/screens/AccountantDashboard/AccountantDashboard.jsx:169-198`

Byte-identical bodies (`today/yesterday/weekly/monthly/yearly/all/custom`,
`case "all": return null;`, `periodOrders` filters `orders` by `created_at`
against `dateRange.start/end`). Confirmed same variable names, same comments
("─── Date range helpers ───"), same effective copy-paste.

**Suggested collapse:** direct swap to `usePeriodFilter("all")` — this pair is
the closest existing code to `PeriodFilter.jsx`'s own hook and would need
almost no behavior change (mainly reconciling the `TIMELINE_OPTIONS` label
strings: "Last 7 Days"/"Last 30 Days"/"Last 365 Days" vs. PeriodFilter's
"7d"/"30d"/"month"/"year" — again a rolling-vs-calendar naming clash, see
Cluster 1 note).

<!-- TIER: TIER1-WIRE — HeadOfDesign/Accountant dateRange useMemos are byte-identical to each other and the closest existing code to usePeriodFilter; direct swap to usePeriodFilter("all"). Only caveat is the same rolling-vs-calendar label reconciliation flagged in Cluster 1 (minor here since both use "all"). -->


---

## Cluster 3 — `PeriodFilter.jsx` / `usePeriodFilter` adopters (the "good" cluster)

Already using the shared component/hook — listed for completeness, not a
duplication finding:
- `src/screens/CommsDashboard/CommsDashboard.jsx:207` (`variant: "pills"`)
- `src/screens/CeoAssistantDashboard/CeoAssistantDashboard.jsx:125` (`variant: "pills"`)
- `src/components/WalkInsView/WalkInsView.jsx:103` (default `variant: "select"`)
- `src/screens/B2bExecutiveDashboard/B2bexecutivedashboard.jsx:101` (`variant: "pills"`) — **but this same file also has its own independent inline `analyticsTimeline` switch** (Cluster 4), so the file mixes the shared hook for one section with a hand-rolled duplicate for another.
- `src/screens/AssociateDashboard.js:140` (`usePeriodFilter("month", { variant: "pills" })`)

Note the internal inconsistency of `PeriodFilter.periodRange()` itself
(`components/PeriodFilter.jsx:37-60`): `"month"` and `"year"` are calendar
start-of-month/start-of-year, while `"7d"`/`"30d"` are rolling day counts —
i.e. even the canonical helper mixes two different period semantics under one
switch. Not a cross-file duplication, but relevant context for anyone
migrating Cluster 1/2 onto it: the option values do not map 1:1 to
"weekly"/"monthly"/"yearly" (rolling) used elsewhere.

<!-- TIER: SKIP — these files already adopt the canonical PeriodFilter/usePeriodFilter; listed for completeness, not a duplication finding. (The helper's own internal rolling-vs-calendar mix is context for Cluster 1/2 migration, not an action here.) -->

---

## Cluster 4 — vendor/analytics-growth timeline switch (B2B family)

A distinct "current period vs previous period of equal length" calculation,
separate from Cluster 1's named helpers, inlined directly in a `useMemo`:

- `src/screens/B2bMerchandiserDashboard/B2bMerchandiserDashboard.jsx:272-330` (`vendorGrowthStats`, driven by `analyticsTimeline` state: `weekly`→7d, `yearly`→365d, else 30d; `custom` uses `analyticsCustomFrom/To` with `setHours(23,59,59,999)`)
- `src/screens/B2bExecutiveDashboard/B2bexecutivedashboard.jsx` — same `analyticsTimeline` state name and pill markup pattern referenced near line 1411 (`style={{... background: analyticsTimeline === opt.v ? ...}}`), independent of its own `usePeriodFilter` usage elsewhere in the same file (Cluster 3 note above).

**DIVERGENT, NUMBER-AFFECTING**: this "previous period" is computed as
`prevStart = currentStart - periodMs` / `prevEnd = currentStart` — a plain
rolling window subtraction — which is a **different formula** from
AdminDashboard's `getComparisonDateRange` (Cluster 1), which hand-computes
specific calendar boundaries per timeline value (e.g. "weekly" previous =
exactly 14-7 days ago with millisecond-precision boundary snapping via
`.setMilliseconds(-1)`). Both claim to answer "previous period of the same
length" but arrive at boundaries via different code paths that can disagree
by the same edge cases (DST, month-length) Admin's explicit per-case
arithmetic is designed to avoid.

**Suggested collapse:** fold into a single `getComparisonRange(range)` utility
that takes a resolved `{start,end}` (from `periodRange()`) and returns the
prior window generically — replacing both Admin's per-case switch and the
B2B rolling-subtraction, once one canonical formula is chosen.

<!-- TIER: DIVERGENCE — B2B rolling-subtraction previous-period vs Admin's calendar-snapped per-case arithmetic disagree on DST/month-length edges (number-affecting). One canonical formula must be chosen by a human before any getComparisonRange() extraction. -->


---

## Cluster 5 — inline "day/month/year/custom/all" `overviewPeriod` filter (Warehouse/B2B production)

A third, independent period-filter shape — not using `TIMELINE_OPTIONS` at
all, just four inline `if` cases against an `overviewPeriod` state
(`"day"`/`"month"`/`"year"`/`"custom"`/`"all"`), applied via `let from = null,
to = null` and manual `if (from && dt < from) return false;` filtering. This
shape is duplicated **twice per file** (once for orders, once for
components), and duplicated **across three files**:

- `src/components/B2B/ProductionManagerDashboard/ProductionManagerDashboard.jsx:819-840` (`overviewOrders`) and again `:847-869` (`overviewComponents`) — identical body
- `src/screens/B2bProductionDashboard/B2bProductionDashboard.jsx:259-278` (`componentsInPeriod`) — same body, filters `components` only (no separate orders copy in this file; `filteredOrders` there uses the simpler `dateFrom`/`dateTo` shape instead, Cluster 6)
- `src/screens/WarehouseDashboard.jsx:449-467` (`periodScopedOrders`) and `:482-501` (`overviewComponentsInPeriod`) — identical body, same six-line "day/month/year/custom" branch structure, same `setHours(23,59,59,999)` for custom `to`

All six copies are functionally identical: `"day"` → `new
Date(y,m,d)` (today's calendar midnight), `"month"` → first of current
calendar month, `"year"` → Jan 1 of current calendar year, `"custom"` → from
input dates with `to` bumped to end-of-day. This is a genuinely different
(calendar-anchored, not rolling) period model from Clusters 1/2/4 — it does
NOT match "weekly = last 7 days" semantics used elsewhere.

**Suggested collapse:** a single `overviewPeriodRange(period, from, to)` util
(mirroring `PeriodFilter.periodRange`'s "month"/"year" calendar-anchor
branches, which already do exactly this) plus a generic `filterByStageOrCreatedTime(list, range, dateField)` — would delete ~130 duplicated lines across the three warehouse/production files.

<!-- TIER: TIER2-EXTRACT — all 6 copies of the inline day/month/year/custom overviewPeriod branch are functionally identical (agree with each other); extract overviewPeriodRange(period, from, to) + filterByCreatedTime verbatim. Distinct calendar-anchored model from Clusters 1/2/4 — keep it as its own util, don't force onto usePeriodFilter. -->


---

## Cluster 6 — simple `dateFrom`/`dateTo` (URL-param) row filter, B2B order-history screens

The simplest and most literally copy-pasted cluster: two `if` blocks applied
directly to a `filteredOrders` useMemo, reading `dateFrom`/`dateTo` string
state (usually sourced from `useFilterParam`, `src/hooks/useFilterParam.js`,
which itself is not duplicated — only the predicate below is):

```js
if (dateFrom) filtered = filtered.filter(o => o.created_at >= new Date(dateFrom).toISOString());
if (dateTo) {
    const endDate = new Date(dateTo);
    endDate.setHours(23, 59, 59, 999);
    filtered = filtered.filter(o => o.created_at <= endDate.toISOString());
}
```

Byte-identical (whitespace-for-whitespace in places) at:
- `src/components/B2B/ProductionManagerDashboard/ProductionManagerDashboard.jsx:344-349`
- `src/screens/B2bMerchandiserDashboard/B2bMerchandiserDashboard.jsx:341-346`
- `src/screens/B2bOrderHistory/B2bOrderHistory.jsx:118-123` (no `statusFilter==="cancelled"` guard above it, otherwise identical two lines)
- `src/screens/B2bExecutiveDashboard/B2bexecutivedashboard.jsx:145-150`
- `src/screens/B2bProductionDashboard/B2bProductionDashboard.jsx:344-349` (via grep hit at line 347 `setHours`)

No divergence found here — all five copies use `>=`/`<=` inclusive bounds
and the same `endDate.setHours(23,59,59,999)` end-of-day bump. This is the
cleanest, lowest-risk cluster to collapse.

**Suggested collapse:** a one-line `src/utils/dateRangeFilter.js` export:
`filterByCreatedAtRange(list, dateFrom, dateTo, field = "created_at")`.

<!-- TIER: TIER2-EXTRACT — all 5 dateFrom/dateTo row-filter copies are byte-identical (inclusive bounds, same setHours(23,59,59,999) end-of-day bump), no divergence. Cleanest, lowest-risk verbatim extraction in the whole sweep: filterByCreatedAtRange(list, dateFrom, dateTo, field). -->


---

## Cluster 7 — ExhibitionPanel's rolling cutoff (week/month/year "ago")

A fourth distinct period model, unique to this file — not duplicated
elsewhere verbatim, but worth recording since it looks like the others at a
glance and would silently diverge if someone copied it thinking it matched
Cluster 1 or 5:

- `src/components/ExhibitionPanel.jsx:42` (`const [period, setPeriod] = useState("all"); // all | week | month | year`)
- `src/components/ExhibitionPanel.jsx:86-98` (cutoff calc) and `:242-253` (pill UI: "This Week"/"This Month"/"This Year" labels)

```js
let cutoff = null;
if (period !== "all") {
  const d = new Date();
  if (period === "week") d.setDate(d.getDate() - 7);
  else if (period === "month") d.setMonth(d.getMonth() - 1);   // NOTE: month/year via setMonth/setFullYear, not day-count
  else if (period === "year") d.setFullYear(d.getFullYear() - 1);
  cutoff = d.getTime();
}
const periodOrders = cutoff === null ? orders : orders.filter(o => o.created_at && new Date(o.created_at).getTime() >= cutoff);
```

**DIVERGENT, NUMBER-AFFECTING** vs. every other cluster: "month" here is a
rolling **one calendar month back** via `setMonth(-1)` (28-31 days depending
on month), not "last 30 days" (Cluster 1/4's fixed 30-day count) and not
"start of current calendar month" (Cluster 5's `PeriodFilter`-style anchor).
Labeled "This Month" in the UI (`:245`) despite being a rolling window, not a
calendar-month-to-date window — the label collides with Cluster 5's
identically-labeled but calendar-anchored "month" bucket used in
Warehouse/B2B-production dashboards. Same UI label, three different
underlying date ranges depending which dashboard you're looking at.

**Suggested collapse:** fold into whichever canonical `periodRange(key)`
helper is chosen; explicitly pick rolling-vs-calendar per label since "This
Month" already means two different things in this codebase.

<!-- TIER: DIVERGENCE — ExhibitionPanel's "This Month" is a rolling setMonth(-1) window, colliding with Cluster 5's identically-labeled calendar-anchored "month" and Cluster 1/4's fixed-30-day "month" — same UI label, three different date ranges (number-affecting). A human must pick which meaning each label carries before folding into any canonical periodRange(). -->


---

## Cluster 8 — misc single-purpose date-boundary checks (not period filters, noted to rule out)

Not part of the period-filter/dropdown concern — single "is this today" or
"is this overdue" boundary checks, included only because they matched the
`setHours(0,0,0,0)` grep and could be mistaken for Cluster 1-7 material:
- `src/components/ScanStation.jsx:232` — `startOfDay` for today's QC pass/fail pill counts (no dropdown, no range object).
- `src/screens/OrderDetails.js:236-239` — `isStoreCreditValid`, strips time to compare store-credit expiry to today.
- `src/screens/CommsDashboard/CommsSourcingReturns.jsx:43-45` — strips time on `now` to bucket Sourcing orders into pending/overdue/returned.

No suggested action beyond noting these are unrelated to the period-filter
concern despite superficially similar `setHours` calls.

<!-- TIER: SKIP — single-purpose date-boundary checks (isToday/isOverdue/store-credit expiry), not period filters. Out of scope, ruled out; noted only so they aren't re-flagged. -->


---

## Summary

| Cluster | Pattern | Files | Number-affecting divergences |
|---|---|---|---|
| 1 | `getDateRange`/`TIMELINE_OPTIONS` switch + comparison range | 7 dashboards | yes (2: "all" handling gap; COO comparison-formula simplification) |
| 2 | simple `dateRange` useMemo (HeadOfDesign/Accountant) | 2 | no (identical to each other; diverges from Cluster 1 re: "all") |
| 3 | `PeriodFilter.jsx`/`usePeriodFilter` adopters | 5 | n/a (canonical, but internally mixes rolling/calendar semantics) |
| 4 | vendor/analytics growth comparison | 2 (B2B) | yes (rolling-subtraction vs. Admin's calendar-snapped comparison) |
| 5 | inline day/month/year/custom overviewPeriod | 3 files, 6 copies | no (all 6 copies agree with each other) |
| 6 | `dateFrom`/`dateTo` row filter | 5 (B2B) | no (all 5 copies agree) |
| 7 | ExhibitionPanel rolling week/month/year cutoff | 1 | yes (vs. Clusters 1 and 5's differing "month" definitions) |
| 8 | unrelated single-date boundary checks | 3 | n/a (out of scope, noted only) |

Total clusters: **8** (7 period-filter clusters + 1 "ruled out" cluster).
NUMBER-AFFECTING divergences: **4** (Cluster 1 default/"all" gap, Cluster 1
COO comparison-formula, Cluster 4 comparison-formula vs Cluster 1, Cluster 7
"This Month" meaning three different things across the app).
