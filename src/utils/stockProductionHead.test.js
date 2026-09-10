/**
 * Check for the stock-order production-head override.
 *
 * The property that matters and is easiest to break: the override is ADDITIVE.
 * An assigned order must appear in the selected head's queue WITHOUT vanishing
 * from the head who owns it by channel. A regression here is silent — an order
 * simply stops appearing on a dashboard, with no error anywhere.
 */
import { scopeOrdersToDesignation } from "./barcodeService";
import { getAssignedHeadDesignation, isValidStockHeadDesignation, isAssignedToHead } from "./stockProductionHead";

const OFFLINE = "Offline Production Head";
const B2B = "B2B Production Head";

// Minimal order rows — scopeOrdersToDesignation reads order_no (for the
// channel prefix), is_stock_order and production_head_designation.
const retailStock = { id: "r1", order_no: "SB-STOCK-0726-000001", is_stock_order: true };
const b2bStock = { id: "b1", order_no: "SB-B2BSTOCK-0726-000002", is_stock_order: true };
const storeOrder = { id: "s1", order_no: "SB-DLC-0726-000003" };
const b2bOrder = { id: "x1", order_no: "SB-B2B-0726-000004", is_b2b: true };

const ids = (list) => list.map((o) => o.id).sort();

// ── Baseline: unassigned stock behaves exactly as before ──────────────
test("unassigned stock still scopes by channel", () => {
  const orders = [retailStock, b2bStock, storeOrder, b2bOrder];
  expect(ids(scopeOrdersToDesignation(orders, OFFLINE))).toEqual(["r1", "s1"]);
  expect(ids(scopeOrdersToDesignation(orders, B2B))).toEqual(["b1", "x1"]);
});

// ── Retail stock assigned to the B2B head ─────────────────────────────
test("retail stock assigned to B2B shows to BOTH heads", () => {
  const assigned = { ...retailStock, production_head_designation: B2B };
  const orders = [assigned, b2bStock, storeOrder, b2bOrder];

  // It appears for the B2B head (the whole point) …
  expect(ids(scopeOrdersToDesignation(orders, B2B))).toContain("r1");
  // … and is STILL there for the offline head who owns it by channel.
  expect(ids(scopeOrdersToDesignation(orders, OFFLINE))).toContain("r1");
});

// ── B2B stock assigned to the Offline head (the reverse direction) ────
test("b2b stock assigned to Offline shows to BOTH heads", () => {
  const assigned = { ...b2bStock, production_head_designation: OFFLINE };
  const orders = [retailStock, assigned, storeOrder, b2bOrder];

  expect(ids(scopeOrdersToDesignation(orders, OFFLINE))).toContain("b1");
  expect(ids(scopeOrdersToDesignation(orders, B2B))).toContain("b1");
});

// ── No duplicates when the assignment matches the channel default ─────
test("assigning the channel's own head does not duplicate the row", () => {
  const assigned = { ...retailStock, production_head_designation: OFFLINE };
  const scoped = scopeOrdersToDesignation([assigned, storeOrder], OFFLINE);
  expect(scoped.filter((o) => o.id === "r1")).toHaveLength(1);
});

// ── The override is stock-only and validated ──────────────────────────
test("a designation on a non-stock order is ignored", () => {
  // Nothing writes this today; if something ever did, it must not reroute a
  // real customer order into a head's queue.
  const rogue = { ...storeOrder, production_head_designation: B2B };
  expect(getAssignedHeadDesignation(rogue)).toBeNull();
  expect(ids(scopeOrdersToDesignation([rogue], B2B))).toEqual([]);
});

test("an unrecognised designation is treated as unassigned", () => {
  // Matches the SQL resolver's fall-through: a designation with no live
  // mailbox must not silently swallow the escalation.
  const bad = { ...retailStock, production_head_designation: "Chief Vibes Officer" };
  expect(getAssignedHeadDesignation(bad)).toBeNull();
  expect(isValidStockHeadDesignation("Chief Vibes Officer")).toBe(false);
  expect(isValidStockHeadDesignation("  b2b production head ")).toBe(true); // trim + case
});

// ── The B2B dashboard's approval gate ─────────────────────────────────
// Regression guard for a real bug: widening that dashboard's FETCH query was
// not enough. A retail stock order is placed through ReviewDetail, which never
// writes approval_status (retail has no approval concept), so the row arrived
// with approval_status = null, matched neither existing branch of the approval
// filter, and was dropped AFTER being fetched — invisible, with no error.
//
// Mirrors the predicate in B2bProductionDashboard.loadAllData. If that filter
// changes, change this with it.
const B2B_HEAD = "B2B Production Head";
const passesApprovalGate = (o) =>
  o.approval_status === "approved" ||
  (o.is_comms && !o.approval_status) ||
  (isAssignedToHead(o, B2B_HEAD) && o.approval_status !== "rejected");

test("a retail stock order assigned to B2B survives the approval gate", () => {
  // 'pending' is what the row ACTUALLY carries, not null: ReviewDetail never
  // writes the field, but the orders.approval_status column defaults to
  // 'pending'. Verified against live data — every SB-DLC-/SB-STOCK- row reads
  // 'pending'. A gate testing !approval_status here would drop this order.
  const assigned = {
    ...retailStock,
    production_head_designation: B2B,
    approval_status: "pending",
  };
  expect(passesApprovalGate(assigned)).toBe(true);

  // and still passes if some other path ever leaves it null
  expect(passesApprovalGate({ ...assigned, approval_status: null })).toBe(true);
});

test("the gate still rejects an unapproved ordinary B2B order", () => {
  // The widening must not become a hole: a real B2B order awaiting
  // merchandiser approval stays hidden.
  expect(passesApprovalGate({ ...b2bOrder, approval_status: "pending" })).toBe(false);
  expect(passesApprovalGate({ ...b2bOrder, approval_status: null })).toBe(false);
});

test("an assigned stock order that was explicitly rejected stays hidden", () => {
  // !approval_status is deliberate — only a MISSING status means "nothing to
  // approve". A real decision, including a rejection, is still honoured.
  const rejected = {
    ...retailStock,
    production_head_designation: B2B,
    approval_status: "rejected",
  };
  expect(passesApprovalGate(rejected)).toBe(false);
});

// ── The Warehouse dashboard's blanket B2B exclusion ───────────────────
// Second regression guard, same class of bug as the approval gate above: the
// Offline Production Head runs the Retail dashboard, so WarehouseDashboard
// hides EVERY B2B order from its lists. A B2B stock order assigned to the
// Offline head passed the fetch and the scoping and was then dropped here —
// the designation was written, and the order still never appeared.
//
// Mirrors visibleOrders in WarehouseDashboard. Change one, change the other.
const OFFLINE_HEAD = "Offline Production Head";
const isB2bOrder = (o) =>
  o?.is_b2b === true || (o?.salesperson_store || "").trim().toUpperCase() === "B2B";
const visibleToOfflineHead = (o) =>
  !isB2bOrder(o) || isAssignedToHead(o, OFFLINE_HEAD);

test("a b2b stock order assigned to Offline is visible on the warehouse list", () => {
  const assigned = {
    ...b2bStock,
    is_b2b: true,
    salesperson_store: "B2B",
    production_head_designation: OFFLINE,
  };
  expect(visibleToOfflineHead(assigned)).toBe(true);
});

test("ordinary B2B orders stay hidden from the Offline head", () => {
  // The exception must not become a hole: unassigned B2B work is still the
  // B2B head's, by flag or by store.
  expect(visibleToOfflineHead({ ...b2bOrder, is_b2b: true })).toBe(false);
  expect(visibleToOfflineHead({ id: "z", order_no: "SB-B2B-0726-9", salesperson_store: "B2B" })).toBe(false);
  expect(visibleToOfflineHead({ ...b2bStock, is_b2b: true })).toBe(false);
});

test("a b2b stock order assigned to the B2B head is not pulled into Offline's list", () => {
  const assignedElsewhere = { ...b2bStock, is_b2b: true, production_head_designation: B2B };
  expect(visibleToOfflineHead(assignedElsewhere)).toBe(false);
});
