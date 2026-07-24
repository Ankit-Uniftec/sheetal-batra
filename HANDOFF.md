# HANDOFF — orders/leadership dedup refactor

Branch: `refactor/orders-list`. This session executed **Step 0 + Step 1 only** of
`REFACTOR-PLAN.md`. Nothing else was started.

## What was done this session

### 1. `REFACTOR-PLAN.md` written to repo root
The approved plan (`using-surfaces-md-analyse-duplication-jolly-seal.md`) was
committed to `d:\web-apps\sheetal-batra\REFACTOR-PLAN.md`, minus the pre-approval
meta-preamble. It is the source of truth for the remaining rounds.

### 2. `accountsLineItems` extracted (Step 1 — pure function move, behaviour-identical)
New file: `src/utils/accountsLineItems.js` exporting `buildAccountsLineItems(orders)`.

It is fully self-contained: it inlines its own `isLxrtsOrder` and
`getOrderSalesperson` (both are pure order-only functions; all three dashboards'
local copies were byte-identical, verified before extraction). The util reads **no**
component/module state — the caller passes the already-scoped array, so the
per-dashboard base-array difference is preserved.

Three call sites now call the util instead of an inline `useMemo` body:

| File | Line (old memo) | Array passed in | Change |
|---|---|---|---|
| `src/screens/CeoDashboard/CeoDashboard.jsx` | ~986 | `orders` | 37-line memo body → `useMemo(() => buildAccountsLineItems(orders), [orders])`; added import |
| `src/screens/GMDashboard/GMDashboard.jsx` | ~718 | `orders` | 34-line memo body → `useMemo(() => buildAccountsLineItems(orders), [orders])`; added import |
| `src/screens/AdminDashboard/AdminDashboard.jsx` | ~1304 | `nonCommsOrders` | 39-line memo body → `useMemo(() => buildAccountsLineItems(nonCommsOrders), [nonCommsOrders])`; added import |

Each got one import line next to the existing `revenue` import:
`import { buildAccountsLineItems } from "../../utils/accountsLineItems";`

**Behaviour preserved exactly:** the dependency arrays are unchanged (`[orders]` /
`[nonCommsOrders]`), the input arrays are unchanged, and the computation is the same
code. The dashboards' own local `isLxrtsOrder`/`getOrderSalesperson` were left in
place (used elsewhere in each file) — no unused-var warnings introduced.

## Build result
`npm run build` → **Compiled with warnings** (success). All warnings are
pre-existing (exhaustive-deps, a11y, unused vars in unrelated files); **none**
reference the changed symbols. Bundle shrank 414 B from the dedup.

## Not done (do NOT assume started)
- `useOrdersView` hook — not created.
- `<OrderList>` component (table or card variant) — not created.
- No dashboard orders-tab migration (Admin/Ceo/Coo/Gm/StoreManager/Retail/PM, or any
  card-family dashboard).
- No leadership extracts #2–#7, no `<StatCard>` layer.
- None of the sign-off-gated number unifications touched.

## Verification still owed (no test suite — manual)
Per REFACTOR-PLAN "Verification" §5: log in as Admin, CEO, and GM; open each
accounts tab; diff the line-item totals (gross / discount / taxable / GST / invoice)
for a known order against a pre-refactor build (git stash / two tabs). Must be
identical. This session verified the extraction is a mechanical move + a clean
build, but did not run the app.

## Next step (per plan sequencing, Step 3)
Build `useOrdersView` + `<OrderList variant="table">` and migrate **Admin + Ceo**
first (their orders tabs are byte-identical → cleanest proof of the component).
