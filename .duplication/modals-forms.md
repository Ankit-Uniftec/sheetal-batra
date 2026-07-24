# Modals & Forms duplication sweep — sheetal_ui

Scope: src/, primarily src/screens/ and src/components/.
Concern: popups/confirm dialogs, measurement input groups, date pickers,
repeated form-field validation/controlled-input boilerplate.
Read-only sweep — no source files modified.

---

## Cluster 1 — `window.alert` / `window.confirm` holdouts instead of `Popup`/`usePopup`

CLAUDE.md states the shared `Popup` component + `usePopup()` hook
(`src/components/Popup.jsx`) is the house pattern, not `window.alert`.
Two distinct sub-patterns found:

### 1a. Files that import/use `usePopup` for most notices but still call
`window.confirm`/`alert` for specific actions (mixed pattern — DIVERGENT, not identical):

- `src/screens/EditOrder/EditOrder.jsx`
  - Uses `showPopup(...)` for info/success/error/warning everywhere (lines 200, 210, 225, 255, 266, 281, 307, 318).
  - But gates the two most destructive actions with raw `window.confirm`:
    - line 235: `if (!window.confirm("Are you sure you want to cancel this order?")) return;`
    - line 291: `if (!window.confirm("Are you sure you want to process this exchange/return?")) return;`
  - **Same business actions (cancel order / process exchange-return) are implemented via the canonical `showPopup({type:"confirm", onConfirm...})` pattern elsewhere** — see `src/screens/AssociateDashboard.js:803-816` (Cancel Order) and `:867-880` (Exchange/Return) and `:632-638` (Mark Delivered). EditOrder.jsx never adopted the confirm-type Popup for these two flows even though it imports `usePopup` (line 9) and has `PopupComponent` mounted (line 345).
  - Commented-out dead `// alert(...)` lines throughout (206, 216, 231, 261, 272, 287, 313, 324) show an incomplete alert→Popup migration.

- `src/screens/B2bMerchandiserDashboard/B2bMerchandiserDashboard.jsx`
  - Uses `showPopup(...)` correctly for order cancel/complete/star-limit (lines 429, 738, 741, 765, 769, 777).
  - But the size-chart / vendor CRUD block uses raw `alert()` and `window.confirm()` instead:
    - line 494: `alert("Failed to process. Please try again.");`
    - line 500: `alert("Legal Name is required.");`
    - line 537: `alert("Failed to add vendor: " + ...)`
    - line 577: `if (!editVendorData.legal_name.trim()) { alert("Legal Name is required."); return; }`
    - line 616: `alert("Failed to update vendor: " + ...)`
    - line 623, 625: `alert("Chart name is required.")`, `alert("Enter at least one size's measurements.")`
    - line 639: `alert("Failed to save size chart: " + ...)`
    - line 648: `if (!window.confirm(msg)) return;` — delete-size-chart confirm (msg built at 643-647)
    - line 657: `alert("Failed to delete size chart: " + ...)`
    - line 693-694: `alert("Please enter a reason for cancellation.")`, `alert("The 24-hour cancellation window has expired.")`

### 1b. Dead/commented alert scaffolding (not live bugs, but evidence of partial migration; not counted as active duplication)
- `src/components/AlterationModal.jsx` lines 194, 229, 252, 262, 274, 305 — all `// alert(...)`, already replaced by `showPopup` in the live code.
- `src/screens/CustomerDetailForm.js` lines 49, 61, 72, 146, 156 — all `// alert(...)`.
- `src/screens/ReviewDetail.js` lines 926, 951 — `// alert(...)`.

**Suggested collapse:** route every confirm-gate through `showPopup({type:"confirm", onConfirm, confirmText, cancelText})`; delete the two live `window.confirm` calls in EditOrder.jsx and the alert/confirm block in B2bMerchandiserDashboard.jsx (lines 494-694) to match the pattern already used in the same files for other actions.

<!-- TIER: TIER1-WIRE — Popup/usePopup already exist and are the house pattern (already used elsewhere in these same files); route the residual window.confirm/alert holdouts (EditOrder x2, B2bMerchandiser 494-694) through the existing showPopup({type:"confirm"}). Dead commented // alert(...) scaffolding is SKIP. -->


---

## Cluster 2 — Ad-hoc `modal-overlay`/`modal-box`-style divs instead of shared `Popup`

At least 8 dashboards/components hand-roll their own overlay+box+header+actions
markup with a per-file CSS-class prefix, instead of composing `<Popup>`. Each
is a DIVERGENT reimplementation of the same overlay/box/close-button shape
(different class prefixes, different close-on-overlay-click wiring, different
button labels) — not byte-identical, but same concern duplicated ~8+ times:

- `src/screens/ProductForm.js:3972-3974` — generic `modal-overlay` / `modal-box` (Urgent Order reason modal)
- `src/screens/B2bproductform/B2bproductform.jsx:811` — same generic `modal-overlay`/`modal-box`, same Urgent Order modal, minified to one line (byte-for-byte the same JSX structure as ProductForm.js's expanded version, just reformatted — see Cluster 5 below for full comparison)
- `src/screens/OrderHistory.jsx:1414` and `:1584` — `oh-modal-overlay` / `oh-modal` (Edit Order modal, Action modal for cancel/revoke)
- `src/components/ProductionHeadVendors.jsx:559` — `phv-modal-overlay` (edit configured-movement modal)
- `src/screens/WarehouseDashboard.jsx:1259, 1398, 1515, 1572, 1619` — `wd-modal-overlay` (5 separate modals: component detail, QC popup, security guard popup, activation popup, packaging verification popup — all on the same class)
- `src/components/ExhibitionPanel.jsx:298` — `exb-modal-overlay` (new/edit exhibition form)
- `src/screens/InventoryDashboard/StockOrdersTab.jsx:472-474` — `stock-modal-overlay` / `stock-modal` (edit delivery date modal — also see Cluster 4)
- `src/components/ScanStation.jsx` — has its own `modal-overlay`-style match too (per grep of "modal-overlay|modal-box"), not read in full; same pattern.

None of these compose `Popup`/`usePopup`; each defines its own CSS
(`ProductionHeadVendors.css`, `ScanStation.css`, `ExhibitionPanel.css`,
`StockOrdersTab.css`, `OrderHistory.css`, `SplitPaymentModal.css`,
`AlterationModal.css`, `B2bProductForm.css`, `Screen4.css`) essentially
re-describing overlay/box/header/actions styling that `Popup.css` already
provides.

**Note:** `src/components/ExtrasPopup.jsx` is a deliberate, documented exception
("Unlike the shared Popup component, this allows overflow so SearchableSelect
dropdowns render properly") — not counted as an unintentional duplicate, but
itself a second shared modal shell that non-Popup consumers could target
instead of hand-rolling their own overlay.

**Suggested collapse:** either (a) route simple confirmation/notice modals
through `Popup`'s `children` slot (it already accepts arbitrary children per
its own docstring), or (b) promote `ExtrasPopup` (or a new
`OverflowPopup`) as the second sanctioned shell for modals that need
dropdown overflow, and delete the per-file `*-modal-overlay` CSS/JSX.

<!-- TIER: TIER3-COMPONENT — ~8 hand-rolled *-modal-overlay/box shells each re-describe the shape Popup.css already provides; route them through the existing Popup children slot (or promote ExtrasPopup as a sanctioned overflow shell). Presentational; not byte-identical (different prefixes/wiring), so a component consolidation rather than a verbatim extract. ExtrasPopup itself is a documented exception → SKIP. -->


---

## Cluster 3 — Measurement field-set constants (`measurementFields`) duplicated across 5 files

Five independent top-level `const measurementFields = {...}` (plus a parallel
`KIDS_MEASUREMENT_FIELDS` in two of them) exist, keyed by the same category
set (`KurtaChogaKaftan`, `Blouse`, `Anarkali`, `SalwarDhoti`,
`ChuridaarTrouserPantsPlazo`, `ShararaGharara`, `Lehenga`). They are **not**
identical — three concrete divergences found, one of them number-affecting
in the sense that it changes which measurement inputs are rendered/collected
for the same garment category depending on which screen the order was
built/edited in.

Files:
- `src/screens/ProductForm.js:463-528` (adult) + `:288-363` (`KIDS_MEASUREMENT_FIELDS`)
- `src/screens/B2bproductform/B2bproductform.jsx:96-105` (adult) + `:140-149` (`KIDS_MEASUREMENT_FIELDS`)
- `src/components/AlterationModal.jsx:28-48`
- `src/screens/OrderHistory.jsx:41-61`
- `src/components/B2B/ProductionManagerDashboard/ProductionManagerDashboard.jsx:58-66`

**DIVERGENT — field list per category:**

**NUMBER-AFFECTING**: ProductForm.js / B2bproductform.jsx (adult sets) include
a `"Mori"` field in `KurtaChogaKaftan`, `Blouse`, and `Anarkali` that
AlterationModal.jsx, OrderHistory.jsx, and ProductionManagerDashboard.jsx's
copies do **not** have:

```
// ProductForm.js:467-484 / B2bproductform.jsx:98 (adult measurementFields)
KurtaChogaKaftan: [
  "Shoulder", "Neck", "Upper Bust", "Bust", "Dart Point",
  "Sleeves", "Mori", "Bicep", "Arm Hole", "Waist", "Hip", "Length",
  "Front Cross", "Back Cross", "Front Neck", "Back Neck",
]
Blouse: [ "Shoulder","Upper Bust","Bust","Dart Point","Sleeves","Mori","Arm Hole","Waist","Length","Front Cross","Back Cross","Front Neck","Back Neck" ]
Anarkali: [ "Shoulder","Upper Bust","Bust","Dart Point","Sleeves","Mori","Bicep","Arm Hole","Length","Front Neck","Back Neck" ]

// AlterationModal.jsx:29-41 / OrderHistory.jsx:42-54 / ProductionManagerDashboard.jsx:59-61
KurtaChogaKaftan: [
  "Height", "Shoulder", "Neck", "Upper Bust", "Bust", "Dart Point",
  "Sleeves", "Bicep", "Arm Hole", "Waist", "Hip", "Length",
  "Front Cross", "Back Cross", "Front Neck", "Back Neck",
]   // no "Mori"; "Height" folded into this category instead
Blouse: [ "Shoulder","Upper Bust","Bust","Dart Point","Sleeves","Arm Hole","Waist","Length","Front Cross","Back Cross","Front Neck","Back Neck" ]  // no "Mori"
Anarkali: [ "Shoulder","Upper Bust","Bust","Dart Point","Sleeves","Bicep","Arm Hole","Length","Front Neck","Back Neck" ]  // no "Mori"
```

**NUMBER-AFFECTING (structural)**: ProductForm.js / B2bproductform.jsx treat
`Height` as its own top-level measurement category (`Height: ["Height"]`,
separately listed in `ALL_MEASUREMENT_CATEGORIES`), whereas
AlterationModal.jsx / OrderHistory.jsx / ProductionManagerDashboard.jsx have
no `Height` category at all and instead embed a `"Height"` field as the
first entry inside `KurtaChogaKaftan`. This means: on the order-build screens
Height is collected once per order (a single top-level field), while on the
alteration/production/order-history edit screens Height is collected (or
displayed) only if/when the Kurta/Choga/Kaftan category is open, and is
absent entirely for orders whose only garment is e.g. a Lehenga.

**IDENTICAL copies (byte-identical field arrays, same category keys, same
order):**
- `src/components/AlterationModal.jsx:28-48` and `src/components/B2B/ProductionManagerDashboard/ProductionManagerDashboard.jsx:58-66` — identical for every category (`KurtaChogaKaftan` through `Lehenga`), differ only in formatting (multi-line vs single-line).
- `src/screens/OrderHistory.jsx:41-61` is also byte-identical in content to the above two (same field lists per category), differing only in whitespace/formatting.
- `src/screens/ProductForm.js:288-363` (`KIDS_MEASUREMENT_FIELDS`) and `src/screens/B2bproductform/B2bproductform.jsx:140-149` (`KIDS_MEASUREMENT_FIELDS`) are identical in field content (same categories/fields), B2bproductform's is just minified to one line each.
- `src/screens/ProductForm.js:463-528` (adult `measurementFields`) and `src/screens/B2bproductform/B2bproductform.jsx:96-105` (adult `measurementFields`) are identical in field content, again just reformatted.

**Also duplicated alongside `measurementFields` in the same files** (same
file groups, same divergence lines):
- `CATEGORY_KEY_MAP` (UI label → internal key) — present in ProductForm.js:398-436, B2bproductform.jsx:~85-92, AlterationModal.jsx:8-16, OrderHistory.jsx:21-29, ProductionManagerDashboard.jsx:43-51. AlterationModal/OrderHistory/ProductionManagerDashboard use slash-separated labels (`"Kurta/Choga/Kaftan"`) while ProductForm.js/B2bproductform.jsx use a much larger map with individual product-name variants (`"Short Kurta"`, `"Choga"`, `"Chauga"` (misspelling), `"Jacket"`, `"Suit"`, etc. all mapping to `KurtaChogaKaftan`) — ProductForm.js's map is materially richer, not just reformatted.
- `WOMEN_SIZE_OPTIONS` / `KIDS_SIZE_OPTIONS` size-option arrays — repeated identically in AlterationModal.jsx:51-56 and ProductionManagerDashboard.jsx:68-73; `KIDS_SIZE_OPTIONS` also repeated in B2bproductform.jsx:108-112.

**Suggested collapse:** extract one `src/utils/measurementFields.js` (or
`.js` constants module) exporting `MEASUREMENT_FIELDS`, `KIDS_MEASUREMENT_FIELDS`,
`CATEGORY_KEY_MAP`, `CATEGORY_DISPLAY_NAMES`, `SIZE_OPTIONS` — but note the
"Mori" and "Height-as-category" divergences must be resolved as a deliberate
product decision (which garment categories get Mori; whether Height is
global or per-Kurta) before merging, since collapsing silently would change
what fields render/save on whichever screens currently lack them.

<!-- TIER: DIVERGENCE — the "Mori" field and "Height-as-its-own-category vs Height-inside-KurtaChogaKaftan" splits are number/structure-affecting: they change which measurement inputs render and save per garment depending on the screen. A product decision must land first. (Once resolved, the AlterationModal/OrderHistory/PM byte-identical sets and the ProductForm/B2bproductform pair are a straightforward TIER2-EXTRACT into src/utils/measurementFields.js — but blocked until then. CATEGORY_KEY_MAP also diverges: ProductForm's map is materially richer, not just reformatted.) -->


---

## Cluster 4 — Measurement input-group rendering (JSX loop) duplicated

Beyond the constants, the actual `<input>` rendering loop over
`measurementFields[categoryKey]` is separately implemented in each
consuming file (not shared as a component):

- `src/screens/ProductForm.js:3236-3276` (per-order-item custom measurements block) — reads `item.measurements?.[itemCategoryKey]?.[field]`, calls `updateItemMeasurement(...)`.
- `src/screens/ProductForm.js:3690-3726` (top-level/order-wide measurements block, same file) — reads `measurements[categoryKey]?.[field]`, calls `setMeasurements(...)` directly. **This is a second, independent copy of the same render loop inside the same file** (per-item vs order-level), not just cross-file duplication.
- `src/screens/B2bproductform/B2bproductform.jsx:699-706` — same loop shape (`mFields.map(...)`), `<h3 className="measure-title">Custom Measurements (in)</h3>` (label differs: "Custom Measurements (in)" vs ProductForm.js's "Custom Body Measurements (in)").
- `src/components/AlterationModal.jsx:419` — `(measurementFields[currentCategoryKey] || []).map((field) => (...))`, single active category (alteration only edits one garment component at a time), no per-item/order-level split.
- `src/components/B2B/ProductionManagerDashboard/ProductionManagerDashboard.jsx:1610` — `(measurementFields[editCategoryKey] || []).map((field) => (...))`, used for editing measurements in an already-placed order.
- `src/screens/OrderHistory.jsx:1544` — `(measurementFields[editCategoryKey] || []).map((field) => (...))`, same shape again, for editing measurements from order history.

All five/six render sites independently reimplement: "look up the field
array for the active category key, map over it, render a labeled numeric-ish
text input bound to a nested `measurements[category][field]` value." None
share a `<MeasurementFieldGroup category={...} values={...} onChange={...}/>`
component.

**Suggested collapse:** one presentational component,
`<MeasurementFieldGroup categoryKey values onChange fieldsSource />`, taking
the field list + current values + an onChange callback, used by all six call
sites (and both call sites within ProductForm.js itself).

<!-- TIER: TIER3-COMPONENT — presentational <MeasurementFieldGroup categoryKey values onChange fieldsSource> over the 6 render loops (incl. the two inside ProductForm.js). The component takes the field list as a prop, so it's independent of Cluster 3's constants divergence — safe to extract even before that product decision lands. -->


---

## Cluster 5 — "Urgent Order" reason modal duplicated near-verbatim across order-build screens

- `src/screens/ProductForm.js:3972-4041` (expanded/formatted)
- `src/screens/B2bproductform/B2bproductform.jsx:811` (same JSX collapsed to one line)

Both: `showUrgentModal` boolean state, `urgentReason` + `otherUrgentReason`
state, a `SearchableSelect` with identical 4 hardcoded options
(`"Client Escalation"`, `"VIP Order"`, `"Celebrity Order"`, `"Others"`), an
`"Others"` conditional textarea, a Cancel button that resets `orderFlag` to
`"Normal"` and clears both reason fields, and a Confirm button that
validates non-empty reason via `showPopup({type:"warning", title:"Reason Required"...})`
then sets `orderFlag` to `"Urgent"`. This is effectively an IDENTICAL
component copy-pasted between the two order-build screens (B2C vs B2B),
wrapped in the ad-hoc `modal-overlay`/`modal-box` markup from Cluster 2
rather than `Popup`.

**Suggested collapse:** extract `<UrgentReasonModal isOpen reason otherReason onCancel onConfirm />` shared component; also resolves part of Cluster 2 by giving it a proper shell.

<!-- TIER: TIER3-COMPONENT — the Urgent Order reason modal is effectively an identical copy (same state, same 4 options, same validation) between ProductForm.js and B2bproductform.jsx; extract <UrgentReasonModal isOpen reason otherReason onCancel onConfirm>. Borderline TIER2 (near byte-identical) but it carries JSX/state, so treat as a presentational component; also gives Cluster 2 a proper shell. -->


---

## Cluster 6 — Delivery-date `<input type="date">` min-today wiring repeated

The literal expression `new Date().toISOString().split("T")[0]` (or the
`.slice(0,10)` equivalent) used as the `min` attribute on a delivery-date
picker recurs, inline, at each call site — no shared `getTodayISO()` helper
or `<DatePicker minDate="today">` component exists anywhere in `src/`
(confirmed: no `react-datepicker`/custom DatePicker component in the tree —
every date field in the app is a raw `<input type="date">`).

- `src/components/AlterationModal.jsx:489` — `min={new Date().toISOString().split('T')[0]}` (single quotes)
- `src/screens/B2bproductform/B2bproductform.jsx:791` — `min={new Date().toISOString().split("T")[0]}` (inline, minified with the rest of the row)
- `src/screens/InventoryDashboard/StockOrdersTab.jsx:482` — `min={new Date().toISOString().split("T")[0]}`
- `src/screens/ProductForm.js:3346` — `min={new Date().toISOString().split("T")[0]}` (per-order-item delivery date)
- `src/screens/ProductForm.js:3839` — `min={new Date().toISOString().split("T")[0]}` (order-level delivery date; second occurrence in the same file, mirroring the per-item/order-level duplication pattern seen in Cluster 4)

**DIVERGENT variant** — `src/screens/CommsDashboard/CommsOrderForm.jsx`
factors the "today" computation into a local variable once per component
instead of inlining it at each usage:
```
// CommsOrderForm.jsx:93
const todayISO = new Date().toISOString().slice(0, 10);
// :410  value={todayISO} readOnly disabled   (Order Date, read-only)
// :415  min={todayISO}                       (Delivery Date)
// :423  min={deliveryDate || todayISO}        (Outfit Return Date — floors to delivery date if set, else today)
```
This is the one call site that additionally derives a second min-date rule
("outfit return date must be ≥ delivery date, else ≥ today") — a genuinely
different validation rule from the plain "today" floor used everywhere else,
not just a formatting difference.

**Suggested collapse:** `src/utils/` helper `getTodayISO()` (trivial) used by
a shared `<DateField min={...} />` wrapper around `<input type="date">`, so
the today-floor logic (and any future "delivery ≥ X" rule) has one
definition instead of 5+ inlined copies.

<!-- TIER: TIER2-EXTRACT — the today-floor expression new Date().toISOString().split("T")[0] is repeated verbatim at 5+ sites; extract getTodayISO() (trivial, no existing helper). CommsOrderForm's "return date ≥ delivery date else ≥ today" is a genuinely different validation rule (not just formatting) → leave as-is, SKIP. Optional <DateField min> wrapper is a TIER3 follow-on. -->


---

## Cluster 7 — Confirm-dialog ("are you sure") call sites using the canonical `showPopup({type:"confirm"})` pattern (for contrast, not a duplication defect)

Listed here only to establish the baseline the Cluster 1 outliers deviate
from — these are consistent, intentional, low-risk repeats of the same
*pattern* (not the same message), all going through `usePopup`:

- `src/screens/AssociateDashboard.js:632-638` (Mark as Delivered), `:803-816` (Cancel Order), `:867-880` (Exchange/Return)
- `src/screens/OrderHistory.jsx:1021-1027` (Delete Draft)
- `src/screens/InventoryDashboard/StockOrdersTab.jsx` (confirm-type present per grep)
- `src/screens/WarehouseDashboard.jsx`, `src/components/B2B/ProductionManagerDashboard/ProductionManagerDashboard.jsx`, `src/screens/ReviewDetail.js`, `src/screens/OrderDetails.js`, `src/screens/CommsDashboard/CommsCalendar.jsx` (all contain `type: "confirm"` per grep; not individually read line-by-line in this sweep).

No shared `useConfirm(message, onConfirm)` convenience wrapper exists on top
of `usePopup` — every call site repeats the same 5-key options object
(`type, title, message, confirmText, cancelText, onConfirm`) by hand. Low
severity (thin duplication of a hook call), but a plausible collapse target:
a `confirmAction({title, message, onConfirm})` convenience function next to
`usePopup` in `Popup.jsx`.

<!-- TIER: SKIP — this is the canonical baseline (correct showPopup confirm usage), explicitly not a defect. The optional confirmAction() convenience wrapper is thin duplication of a hook call — low value; noted for contrast only. -->

