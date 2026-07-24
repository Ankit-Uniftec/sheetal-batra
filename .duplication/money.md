# Money-logic duplication sweep — sheetal_ui

Scope: GST/tax reverse-calc, discount proration, order totals, currency
formatting, split-payment/balance-due math. Read-only sweep; no source
files modified.

---

## Cluster 1 — `net_total ?? grand_total_after_discount ?? grand_total` revenue fallback chain
**Pattern:** the canonical "what is this order actually worth" expression.
**Already extracted** as `orderRevenueAmount(o)` in `src/utils/revenue.js:50-51`:
```js
export const orderRevenueAmount = (o) =>
  Number(o?.net_total ?? o?.grand_total_after_discount ?? o?.grand_total ?? 0);
```
**But re-implemented inline 205 times across 24 files** instead of imported. Most
damning: 11 files already `import { isRevenueOrder } from ".../utils/revenue"`
(sibling export in the same module) yet still hand-roll the amount chain rather
than also importing `orderRevenueAmount`. Only **`RetailManagerDashboard.jsx`**
imports and uses `orderRevenueAmount` itself.

Representative hits (not exhaustive — grep found 205 occurrences / 24 files):
- `src/screens/AssociateDashboard.js:169,673,753,1184,1721`
- `src/screens/AdminDashboard/AdminDashboard.jsx` (26 occurrences)
- `src/screens/CeoDashboard/CeoDashboard.jsx` (35 occurrences)
- `src/screens/GMDashboard/GMDashboard.jsx` (26 occurrences)
- `src/screens/AssistantCmoDashboard/AssistantCmoDashboard.jsx:323,365,366,367,418,...` (13)
- `src/screens/COODashboard/COODashboard.jsx` (20)
- `src/screens/B2bMerchandiserDashboard/B2bMerchandiserDashboard.jsx` (20)
- `src/screens/StoreManagerDashboard/StoreManagerDashboard.jsx` (15)
- `src/screens/RetailDashboard/RetailManagerDashboard.jsx` (10 — imports the helper too; some call sites still inline it)
- `src/screens/OrderHistory.jsx:737,770,1599,2120`
- `src/screens/B2bOrderHistory/B2bOrderHistory.jsx:` (3)
- `src/screens/B2bExecutiveDashboard/B2bexecutivedashboard.jsx` (4)
- `src/screens/HeadOfDesignDashboard/HeadOfDesignDashboard.jsx` (4)
- `src/screens/EditOrder/EditOrder.jsx` (2)
- `src/screens/CeoAssistantDashboard/CeoAssistantDashboard.jsx` (2)
- `src/screens/B2bVendorOrders/B2bVendorOrders.jsx` (2)
- `src/screens/ReviewDetail.js` (1)
- `src/utils/exhibitionService.js:27` (1) — `return Number(o?.net_total ?? o?.grand_total_after_discount ?? o?.grand_total ?? 0) || 0;` (note the extra trailing `|| 0`, a harmless but divergent guard vs the canonical version, which never actually needs it since `Number(undefined ?? 0)` already can't be NaN — cosmetic difference only)
- `src/components/DeliveryPaymentModal.jsx:24`
- `src/components/UpdatePaymentModal.jsx:22` (byte-identical to DeliveryPaymentModal.jsx:24)
- `src/components/ExhibitionPanel.jsx` (1)
- `src/screens/AccountantDashboard/AccountantDashboard.jsx` (5)

**Variation observed:** all copies checked use the exact same operator order and
operands (`net_total ?? grand_total_after_discount ?? grand_total ?? 0`) — this
is unusually consistent copy-paste (not independently reinvented), which makes
it a very clean mechanical-extraction target. The one difference found
(`exhibitionService.js`'s trailing `|| 0`) is not NUMBER-AFFECTING (a `Number()`
of a nullish-coalesced chain ending in `?? 0` can't produce `NaN`/`undefined`).

**Collapse into:** every call site should import `orderRevenueAmount` from
`src/utils/revenue.js` (already exists, already correct) instead of inlining
the chain. No new helper needed — just wire up the existing one.

<!-- TIER: TIER1-WIRE — orderRevenueAmount() already exists in src/utils/revenue.js; 205 call sites just need to import it. Highest-priority, safest wire-up. -->


---

## Cluster 2 — GST 5% "accounts line item" decomposition (`accountsLineItems`)
**Pattern:** explode an order into per-product line items with proportional
discount allocation + GST(5%) reverse-calc (`taxable = invoice / 1.05`).

**Already extracted** into `src/utils/accountsLineItems.js:23-61`
(`buildAccountsLineItems`), whose own header comment says it was "Extracted
verbatim from the three identical inline `accountsLineItems` memos
(AdminDashboard / CeoDashboard / GMDashboard)" — **but the extraction was never
wired up**: `buildAccountsLineItems` has zero importers anywhere in `src/`
(confirmed via grep). All three dashboards still carry their own inline copy:

- `src/screens/AdminDashboard/AdminDashboard.jsx:1304-1342` (`accountsLineItems` useMemo)
- `src/screens/CeoDashboard/CeoDashboard.jsx:986-1022`
- `src/screens/GMDashboard/GMDashboard.jsx:718-751`

These three are **byte-identical** to each other (and to `accountsLineItems.js`)
in the core calc:
```js
const GST_RATE = 0.05;
...
const grossValue = productPrice * quantity;
const discountRatio = orderGrossSum > 0 ? grossValue / orderGrossSum : 0;
const productDiscount = Math.min(grossValue, orderDiscount * discountRatio);
const invoiceValue = Math.max(0, grossValue - productDiscount);
const taxableValue = invoiceValue / (1 + GST_RATE);
const gst = invoiceValue - taxableValue;
```
Minor non-semantic differences: comment wording, and Admin/Ceo/GM each pass a
different pre-scoped `orders` array (Admin: `nonCommsOrders`; Ceo/GM: `orders`)
— matches the extracted helper's own doc comment, so this is parameterization,
not logic drift.

**Divergent 4th copy — `AccountsDashboard.jsx`** (the accounts-role dashboard
itself, not leadership) reimplements the *same* GST-5%-reverse-calc a third
time but with **materially different scope**:
- `src/screens/AccountsDashboard/AccountsDashboard.jsx:80-168`
- Same core formula (`GST_RATE = 0.05`, `invoiceValue / (1 + GST_RATE)`) at
  lines 100-101.
- **Divergence: also emits a line item per `item.extras[]`** (lines 129-163),
  applying the *same* `discountRatio` computed from the parent item's gross to
  each extra's gross independently — `accountsLineItems.js` and the
  Admin/Ceo/GM copies only ever emit one row per product and never break out
  extras as their own taxable rows. **NUMBER-AFFECTING**: total line-item count
  and the extras' individual `taxable_value`/`gst` differ from what
  Admin/Ceo/GM would compute for the same order (they fold extras' price into
  nothing — extras aren't in their `orderGrossSum` or output at all, since they
  only iterate `order.items`, not `item.extras`). So the leadership dashboards'
  and the accounts dashboard's "total GST" for an order containing extras will
  not match.
- Also carries extra fields not in the other three: `address/city/state/pincode`,
  `shipping_charges`/`cod_charges` (first-item-only), `reason`.

**Collapse into:** `src/utils/accountsLineItems.js` should be the one import
site for Admin/Ceo/GM (trivial — parameters already match). AccountsDashboard's
extras-aware variant is a genuinely different shape (extras-as-rows +
shipping/cod columns) and would need either a second exported function or an
options flag — flagging the divergence, not proposing which.

<!-- TIER: TIER1-WIRE — buildAccountsLineItems() already exists in src/utils/accountsLineItems.js with 0 importers; Admin/Ceo/GM copies are byte-identical and just need wiring. NOTE: AccountsDashboard's extras-as-rows variant is DIVERGENCE (number-affecting) — do not fold into the wire-up. -->


---

## Cluster 3 — GST 18% reverse-calc at order-build time (retail vs B2B product form)
**Pattern:** "inclusive subtotal in, GST-exclusive subtotal + tax amount out",
at 18%, computed while building the cart (before persistence, before any
`discount_amount` exists).

- `src/screens/ProductForm.js:2311,2326-2327`:
  ```js
  const gstRate = 0.18;
  ...
  const subtotal = inclusiveSubtotal / (1 + gstRate); // taxable amount
  const taxes = inclusiveSubtotal - subtotal; // GST amount
  ```
  and again at submit time, `ProductForm.js:589-590`:
  ```js
  subtotal: finalSubtotal / (1 + gstRate),
  taxes: finalSubtotal - finalSubtotal / (1 + gstRate),
  ```
- `src/screens/B2bproductform/B2bproductform.jsx:555-558`:
  ```js
  const gstRate = 0.18;
  const subtotal = inclusiveSubtotal / (1 + gstRate);
  const taxes = inclusiveSubtotal - subtotal;
  ```
  Byte-identical formula to ProductForm.js (variable names match exactly).

**NUMBER-AFFECTING cross-cluster divergence vs Cluster 2:** this 18% rate is a
*different GST rate* than the 5% used throughout the Accounts
dashboards/`accountsLineItems.js` (Cluster 2) for the *same orders* later on.
Whether 5% or 18% is "correct" is a business/tax-code question this sweep does
not adjudicate — but it means an order's implied GST differs by which
screen/report computed it: ~15.25% of invoice value at order-build time
(`/1.18`) vs ~4.76% of invoice value in the accounts views (`/1.05`).

**Collapse into:** a single `reverseGst(inclusiveAmount, rate)` helper (rate as
a named constant per call site, since 5% vs 18% appears to be intentionally
different contexts) would at least remove the duplicated arithmetic, though
the rate discrepancy itself is a separate finding worth a human decision.

<!-- TIER: TIER2-EXTRACT — /1.18 reverse-calc is byte-identical in ProductForm.js and B2bproductform.jsx; extract reverseGst(amount, rate) verbatim. NOTE: the 5%-vs-18% rate mismatch vs Cluster 2/4 is a separate DIVERGENCE needing a human/tax decision — not resolved by the extraction. -->


---

## Cluster 4 — GST 18% reverse-calc in the Customer PDF (yet another site, different base)
- `src/pdf/CustomerOrderPdf.js:426-428`:
  ```js
  // GST Calculation (reverse calculation - grandTotal includes GST)
  const baseAmount = Math.round(grandTotal / 1.18);
  const gstAmount = grandTotal - baseAmount;
  ```
Same 18% rate as Cluster 3, but:
- **Divergence 1 (rounding): `Math.round()` is applied to `baseAmount` before
  subtracting** — ProductForm/B2bproductform never round `subtotal`/`taxes`
  (they store full-precision floats). **NUMBER-AFFECTING**: the PDF's printed
  GST split can differ from the stored `subtotal`/`taxes` by up to a rupee due
  to the rounding step.
- **Divergence 2 (base amount): the PDF divides `grandTotal`** (`Number(order.grand_total)`,
  i.e. pre-discount gross) **whereas ProductForm/B2bproductform divide the
  inclusive subtotal at cart-build time**, which for ProductForm becomes
  `grand_total` only if no discount is later applied. Once a discount is
  applied at `OrderDetails.js` (post-ProductForm step), `grand_total` no longer
  equals the value GST was originally split from — so the PDF's GST line and
  the originally-computed `taxes` value can diverge for any discounted order.
  **NUMBER-AFFECTING.**

**Collapse into:** none of these three ad hoc `/1.18` sites should independently
decide whether GST is computed on gross-before-discount or net-after-discount;
a single `reverseGst(amount, rate)` utility, with the caller explicit about
which amount it's feeding in, would at least make the current inconsistency
visible/auditable at the call sites instead of silently repeated.

<!-- TIER: DIVERGENCE — PDF rounds baseAmount with Math.round() and divides pre-discount grand_total, so its printed GST split can differ from stored subtotal/taxes on any discounted order. Both number-affecting divergences need a human decision (which base, round where); the shared reverseGst() helper is a TIER2 side-benefit but does NOT resolve them. -->


---

## Cluster 5 — Currency formatting: `formatIndianNumber` vs ad hoc `toLocaleString("en-IN")`
**Canonical helper:** `src/utils/formatIndianNumber.js:6-29` — hand-rolled
lakh/crore grouping, returns `"—"` for null/undefined/NaN, preserves decimal
part as-is (no forced 2-dp).  Used correctly (imported) by the large majority
of dashboards (Accounts, Admin, Ceo, GM, OrderHistory, B2B order screens, etc.)
— this is the healthy case, not listed further.

**Divergent copies that bypass it:**
- `src/pdf/CustomerOrderPdf.js:39-42` — its own `formatINR`:
  ```js
  const formatINR = (num) => {
    if (!num) return "₹ 0";
    return `₹ ${Number(num).toLocaleString("en-IN")}`;
  };
  ```
  Divergence vs `formatIndianNumber`: (a) falsy input (`0`, `null`, `undefined`,
  `""`) all collapse to the *string* `"₹ 0"` rather than `formatIndianNumber`'s
  `"—"` placeholder for missing data — **NUMBER-AFFECTING** in the sense that a
  genuine ₹0 line item and a missing/undefined value are rendered identically
  ("₹ 0") in the PDF, whereas every other screen distinguishes them ("₹0" vs
  "—"). (b) relies on `Number.prototype.toLocaleString("en-IN")` directly
  rather than the hand-rolled grouping — for plain integers the visible grouping
  is the same, but `toLocaleString` will also silently apply its own decimal
  rules (locale default max 3 fraction digits) which can differ from
  `formatIndianNumber`'s "print whatever decimal string was already there"
  behavior for non-integer rupee amounts.
  Used throughout the same file: `CustomerOrderPdf.js:342,349,367,613,623`.

- `src/screens/B2bMerchandiserDashboard/B2bMerchandiserDashboard.jsx:1448-1449`:
  ```js
  <td>₹{Number(v.current.toFixed(0)).toLocaleString('en-IN')}</td>
  <td>₹{Number(v.prev.toFixed(0)).toLocaleString('en-IN')}</td>
  ```
  Divergence: forces integer rounding via `.toFixed(0)` before formatting —
  `formatIndianNumber` would preserve any decimals present. **NUMBER-AFFECTING**
  for any non-integer rupee value (paise-level amounts get silently rounded to
  whole rupees here but not elsewhere).

- `src/components/ReplacementApprovals.jsx:124`:
  ```js
  <div className="rpa-meta">Cost loss: ₹{Number(r.cost_loss || 0).toLocaleString("en-IN")} ...
  ```
  Divergence: `|| 0` default (vs `formatIndianNumber`'s `"—"` for missing), no
  decimal handling difference visible since cost_loss is typically integer, but
  same "confuses zero with missing" pattern as the PDF.

**Collapse into:** all three ad hoc sites should call the existing
`formatIndianNumber` (adding a `withSymbol`/prefix option if the `"₹ "` spacing
convention needs to be preserved for the PDF specifically — `@react-pdf` text
nodes can't use CSS `::before`, so the ₹ has to stay in JS, but the *number*
formatting call itself should still be the shared one).

<!-- TIER: TIER1-WIRE — formatIndianNumber() already exists in src/utils/formatIndianNumber.js and is used correctly by most dashboards; the 3 ad-hoc copies (PDF formatINR, B2bMerchandiser .toFixed(0), ReplacementApprovals) just need to import it. NOTE: the zero-vs-missing and forced-integer-rounding behaviors are number-affecting DIVERGENCES that the wire-up would change — confirm intent before swapping. -->


---

## Cluster 6 — Balance-due / advance-vs-total math in payment modals
**Pattern:** `orderTotal` via the Cluster-1 fallback chain, then
`balanceDue = max(0, orderTotal - advancePaid)`, then compare against operator-entered amount.

- `src/components/UpdatePaymentModal.jsx:21-24,34-35`:
  ```js
  const mrp = Number(order?.grand_total) || 0;
  const orderTotal = Number(order?.net_total ?? order?.grand_total_after_discount ?? order?.grand_total ?? 0);
  const advancePaid = Number(order?.advance_payment) || 0;
  const balanceDue = Math.max(0, orderTotal - advancePaid);
  ...
  const remainingAfter = balanceDue - totalEntered;
  const overpaying = totalEntered > balanceDue + 0.01;
  ```
- `src/components/DeliveryPaymentModal.jsx:21-24,48,53,59,61`:
  ```js
  const orderTotal = Number(order?.net_total ?? order?.grand_total_after_discount ?? order?.grand_total ?? 0);
  ...
  const deliveryCharge = computeDeliveryCharge({ finalMode: finalMethod, balanceDue: goodsBalance, waived: waiveCod }); // uses shared src/utils/deliveryCharge.js correctly
  const balanceDue = goodsBalance + deliveryCharge;
  const leftToPay = balanceDue - totalEntered;
  const nothingToCollect = balanceDue <= 0;
  ```
  **Byte-identical** `orderTotal` line to UpdatePaymentModal.jsx:22. The
  `balanceDue`/`remaining` naming and the "+0.01 epsilon for overpay guard"
  differ slightly (`UpdatePaymentModal` has an explicit `+ 0.01` float-epsilon
  guard on overpay; `DeliveryPaymentModal` does not add an epsilon to its
  `nothingToCollect`/`leftToPay` checks) — a small guard-presence divergence,
  not NUMBER-AFFECTING for typical rupee amounts since both ultimately gate on
  `<= 0` / strict `>`.
- `src/components/SplitPaymentModal.js:35-45`: independent third implementation
  of the same "entered vs allowed" shape, but takes `maxAmount`/`minAdvance` as
  props rather than reading `order` fields itself — `balance = maxAmount -
  totalEntered` (no `Math.max(0, ...)` clamp on `balance`, unlike the other two
  which clamp `balanceDue` to ≥0). This is a real behavioral difference (a
  negative `balance` here is allowed to display negative / drive `isExceeded`)
  but is a different call in a different context, not a straight copy.

**Collapse into:** the `orderTotal` line (Cluster 1's `orderRevenueAmount`)
plus a small `computeBalanceDue({ orderTotal, advancePaid, extraCharge })`
alongside the existing `src/utils/deliveryCharge.js` would remove the
byte-identical duplication between UpdatePaymentModal and DeliveryPaymentModal.

<!-- TIER: TIER1-WIRE — the byte-identical orderTotal fallback line is orderRevenueAmount() (Cluster 1); wire that in. The residual computeBalanceDue() wrapper is a minor TIER2-EXTRACT; SplitPaymentModal's unclamped balance is an intentional context difference (SKIP), not a defect. -->


---

## Cluster 7 — Discount stacking: three independent "subtotal → discount(s) → grand total" pipelines
Not copy-paste of each other (each channel's discount model is genuinely
different), but each channel reimplements its own discount-application shape
from scratch, and per project memory ("flat-amount discounts live in JS while
percent codes live in a discount table") this is exactly where that JS-side
math recurs three times with three different stacking rules:

- **Retail** — `src/screens/OrderDetails.js:242-309` (`pricing` useMemo):
  percent discount(s) (`discountPercent` + `discountPercent2` + `birthdayDiscount`,
  summed then capped 0-100) applied to `totalAmount - extrasTotal`, THEN a flat
  ₹ discount code applied on top and capped so it can't go negative:
  ```js
  const percentDiscountAmount = (baseAmountForDiscount * pct) / 100;
  const cappedFlat = Math.min(flatDiscount, Math.max(0, totalAmount - percentDiscountAmount));
  const discountAmount = percentDiscountAmount + cappedFlat;
  ```
  Then store credit is applied after that, then shipping is conditionally added
  before store credit. Also computes `minAdvanceAmount` (25%/50% rule) off
  whichever base already has discounts/credit applied.

- **B2B** — `src/screens/B2bRevieworder/B2bReviewOrder.jsx:161-163`: two
  independent percentages (`discountPercent`/"markdown" and
  `collectorDiscount`/"collector code"), **both applied to the same
  `grandTotal` base and summed** (not sequential/compounding like retail's
  percent-then-flat):
  ```js
  const markdownAmount = grandTotal * (discountPercent / 100);
  const collectorDiscountAmount = grandTotal * (collectorDiscount / 100);
  const finalTotal = grandTotal - markdownAmount - collectorDiscountAmount;
  ```
  **NUMBER-AFFECTING difference in kind vs retail**: retail's second discount
  is computed on the *already-discounted* remainder (sequential), B2B's second
  discount is computed on the *original* gross and simply summed (parallel) —
  these produce different final totals for the same nominal "discount 1 % +
  discount 2 %" inputs whenever both are nonzero.

- **Comms** — `src/screens/CommsDashboard/CommsReviewOrder.jsx:93-106`: a
  single percent discount only for "Personal" engagement orders, applied to
  `itemsSubtotal` (which itself independently re-sums `price*quantity + extras`
  per item rather than reading a precomputed subtotal):
  ```js
  const discountAmount = isPersonalOrder
    ? Math.round((itemsSubtotal * Number(discountPercent || 0)) / 100)
    : 0;
  const grandTotalForDB = isFreeOrder ? 0 : Math.max(0, itemsSubtotal - discountAmount);
  ```
  Divergence: **rounds `discountAmount` with `Math.round()`** before
  subtracting — neither retail nor B2B round their discount amount before the
  final subtraction (retail rounds only much later at persistence,
  `Math.round(pricing.netAfterStoreCredit)` etc.). **NUMBER-AFFECTING** for
  fractional-rupee discount percentages.

**Collapse into:** not a single drop-in function (the three stacking rules are
genuinely different business logic per channel), but all three recompute
"subtotal = Σ(price×qty + extras)" independently — that inner sum, at least,
is identical in shape across `OrderDetails.js` (`totalAmount`/`extrasTotal`
useMemos), `B2bproductform.jsx`'s `cartSubtotal`, and
`CommsReviewOrder.jsx`'s `itemsSubtotal`, and could share one
`orderItemsSubtotal(items)` helper (parallel to `orderItemsGross` already in
`src/utils/itemNetAmount.js:23-24`, which does the same sum without extras).

<!-- TIER: DIVERGENCE — retail (sequential percent-then-flat), B2B (parallel percents summed on gross), and Comms (early Math.round) produce different final totals for the same nominal inputs; the three stacking rules are genuinely different business logic, not a refactor. The inner "subtotal = Σ(price×qty + extras)" sum is a separate TIER2-EXTRACT (orderItemsSubtotal), but do not merge the stacking pipelines. -->


---

## Cluster 8 — Per-item gross/discount/final proration (`itemNetAmount.js`) — the healthy case
`src/utils/itemNetAmount.js:20-37` (`orderItemsGross`, `itemAmounts`,
`itemFinalAmount`) is a properly extracted, well-documented shared helper for
per-line-item discount proration used by per-product reports/charts. No
duplicate implementations of *this exact* function were found elsewhere — it's
listed here only to contrast with Cluster 2, where the equivalent extraction
(`accountsLineItems.js`) exists but was never actually wired up. Confirms the
codebase is capable of doing this correctly; Cluster 2 is a regression/miss,
not a pattern gap.

<!-- TIER: SKIP — itemNetAmount.js already extracted and wired; no duplicate implementations found. Healthy case, listed for contrast only. -->


---

## Summary table

| # | Pattern | Shared helper exists? | Wired up? | Worst divergence |
|---|---|---|---|---|
| 1 | Revenue amount fallback chain | Yes (`revenue.js`) | Rarely (1/24 files) | cosmetic only |
| 2 | GST 5% accounts line items | Yes (`accountsLineItems.js`) | **No — 0 importers** | extras-as-rows in AccountsDashboard.jsx (**NUMBER-AFFECTING**) |
| 3 | GST 18% at cart-build time | No | n/a | rate itself vs Cluster 2/4 (**NUMBER-AFFECTING** across clusters) |
| 4 | GST 18% in PDF | No | n/a | rounding + base-amount timing (**NUMBER-AFFECTING**) |
| 5 | Currency formatting | Yes (`formatIndianNumber.js`) | Mostly | zero-vs-missing collapse, forced `.toFixed(0)` (**NUMBER-AFFECTING**) |
| 6 | Balance-due math | Partial (`deliveryCharge.js` for COD only) | Partial | epsilon-guard presence (not number-affecting) |
| 7 | Discount stacking per channel | No (and shouldn't be one) | n/a | sequential vs parallel discount application (**NUMBER-AFFECTING**), rounding point (**NUMBER-AFFECTING**) |
| 8 | Per-item proration | Yes (`itemNetAmount.js`) | Yes | none found |

**NUMBER-AFFECTING divergence count: 7** (Cluster 2 extras-as-rows; Cluster 3↔2/4
rate mismatch; Cluster 4 rounding; Cluster 4 base-amount timing; Cluster 5
PDF zero-vs-missing; Cluster 5 B2bMerchandiserDashboard forced integer
rounding; Cluster 7 sequential-vs-parallel discount stacking; Cluster 7 Comms
early rounding — counted as 7 distinct instances per the clusters above,
excluding the cosmetic ones explicitly called out as not number-affecting).
