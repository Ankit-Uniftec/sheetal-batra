jest.mock("../lib/supabaseClient", () => ({ supabase: {} }));
import { targetPieces, planBreakdownChange, pieceState, isNoChange } from "./breakdownChange";

const order = { id: "o1", order_no: "SB-SHOPIFY-1026-010023", items: [{ product_name: "Potli mustard" }] };
const C = { top: "Top", bottom: "Bottom", includes_dupatta: false };
const piece = (barcode, type, extra = {}) => ({ id: barcode, barcode, component_type: type, item_index: 0, current_stage: "order_received", is_active: false, ...extra });

test("target pieces follow the same barcode formula as the sync", () => {
  expect(targetPieces(order, 0, C).map((p) => p.barcode)).toEqual(["SHOPIFY-010023-TOP", "SHOPIFY-010023-BTM"]);
  expect(targetPieces(order, 0, { includes_extra: true }).map((p) => [p.barcode, p.component_label]))
    .toEqual([["SHOPIFY-010023-EX1", "Potli mustard"]]);
});

test("Top + Bottom → Extras only: TOP converts to EX1, unstarted BTM is removed", () => {
  const cur = [piece("SHOPIFY-010023-TOP", "top"), piece("SHOPIFY-010023-BTM", "bottom")];
  const plan = planBreakdownChange(cur, targetPieces(order, 0, { includes_extra: true }), new Set());
  expect(plan.convert.map((c) => [c.from.barcode, c.to.barcode])).toEqual([["SHOPIFY-010023-TOP", "SHOPIFY-010023-EX1"]]);
  expect(plan.remove.map((p) => p.barcode)).toEqual(["SHOPIFY-010023-BTM"]);
  expect(plan.retire).toEqual([]);
  expect(plan.startedCount).toBe(0);
});

test("a started piece with no partner is retired, never deleted", () => {
  const cur = [piece("SHOPIFY-010023-TOP", "top"), piece("SHOPIFY-010023-BTM", "bottom", { is_active: true, current_stage: "cloth_issued" })];
  const plan = planBreakdownChange(cur, targetPieces(order, 0, { top: "Top" }), new Set());
  expect(plan.keep.map((p) => p.barcode)).toEqual(["SHOPIFY-010023-TOP"]);
  expect(plan.retire.map((p) => p.barcode)).toEqual(["SHOPIFY-010023-BTM"]);
  expect(plan.startedCount).toBe(1);
});

test("more pieces in the new choice → extra ones are added", () => {
  const cur = [piece("SHOPIFY-010023-TOP", "top")];
  const plan = planBreakdownChange(cur, targetPieces(order, 0, { ...C, includes_dupatta: true }), new Set());
  expect(plan.keep.map((p) => p.barcode)).toEqual(["SHOPIFY-010023-TOP"]);
  expect(plan.add.map((p) => p.barcode)).toEqual(["SHOPIFY-010023-BTM", "SHOPIFY-010023-DUP"]);
});

test("vendor / packed / dispatched pieces block; same choice is no change", () => {
  expect(pieceState({ is_outside_wh: true, vendor_name: "SB WH Delhi (2)" }).state).toBe("blocked");
  expect(pieceState({ id: "x", current_stage: "production_complete" }, new Set(["x"])).why).toMatch(/packed/);
  expect(pieceState({ current_stage: "dispatched" }).why).toMatch(/dispatched/);
  const cur = [piece("SHOPIFY-010023-TOP", "top"), piece("SHOPIFY-010023-BTM", "bottom")];
  expect(isNoChange(planBreakdownChange(cur, targetPieces(order, 0, C), new Set()))).toBe(true);
});
