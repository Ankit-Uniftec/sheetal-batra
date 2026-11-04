import {
  isB2bDispatched, canPostDispatch, revokeBlock, validatePostDispatch, summarisePostDispatch, groupActionsByOrder, postDispatchLabel,
} from "./postDispatch";

jest.mock("../lib/supabaseClient", () => ({ supabase: {} }));

const NOW = new Date("2026-11-04T12:00:00Z").getTime();
const hoursAgo = (h) => new Date(NOW - h * 36e5).toISOString();
const order = (over = {}) => ({ status: "order_received", warehouse_stage: "cloth_issued", created_at: hoursAgo(30), ...over });

test("dispatched follows the Production dashboard rule", () => {
  expect(isB2bDispatched(order({ status: "completed" }))).toBe(true);
  expect(isB2bDispatched(order({ status: "Delivered" }))).toBe(true);
  expect(isB2bDispatched(order({ warehouse_stage: "dispatched" }))).toBe(true);
  expect(isB2bDispatched(order({ warehouse_stage: "packaging_dispatch" }))).toBe(false);
  expect(isB2bDispatched(order())).toBe(false);
});

test("Post Dispatch shows only on dispatched partner orders", () => {
  expect(canPostDispatch(order({ status: "completed" }))).toBe(true);
  expect(canPostDispatch(order())).toBe(false);
  expect(canPostDispatch(order({ status: "cancelled", warehouse_stage: "dispatched" }))).toBe(false);
  expect(canPostDispatch(order({ status: "completed", is_stock_order: true }))).toBe(false);
  expect(canPostDispatch(null)).toBe(false);
});

test("revoke opens after 24 hours and closes at dispatch", () => {
  expect(revokeBlock(order(), NOW)).toBeNull();
  expect(revokeBlock(order({ created_at: hoursAgo(5) }), NOW).kind).toBe("early");
  expect(revokeBlock(order({ created_at: hoursAgo(24) }), NOW).kind).toBe("early");
  expect(revokeBlock(order({ created_at: hoursAgo(500) }), NOW)).toBeNull();
  expect(revokeBlock(order({ warehouse_stage: "dispatched" }), NOW).kind).toBe("shipped");
  expect(revokeBlock(order({ status: "completed" }), NOW).kind).toBe("shipped");
  expect(revokeBlock(order({ status: "revoked" }), NOW).kind).toBe("done");
  expect(revokeBlock(order({ status: "cancelled" }), NOW).kind).toBe("done");
  expect(revokeBlock(order({ is_stock_order: true }), NOW).kind).toBe("stock");
  expect(revokeBlock(null, NOW).kind).toBe("none");
});

test("revoke and post dispatch never both apply", () => {
  [order(), order({ status: "completed" }), order({ warehouse_stage: "dispatched" })].forEach((o) => {
    expect(revokeBlock(o, NOW) === null && canPostDispatch(o)).toBe(false);
  });
});

const file = (name, type, size = 100) => ({ name, type, size });

test("the form needs a type and text; files are optional", () => {
  expect(validatePostDispatch({ actionType: "", note: "x" })).toMatch(/Choose/);
  expect(validatePostDispatch({ actionType: "refund", note: "x" })).toMatch(/Choose/);
  expect(validatePostDispatch({ actionType: "return", note: "   " })).toMatch(/QC failure/);
  expect(validatePostDispatch({ actionType: "return", note: "Torn" })).toBeNull();
});

test("files must be JPEG or PDF, 5 MB each, 5 at most", () => {
  const ok = { actionType: "exchange", note: "Torn" };
  expect(validatePostDispatch({ ...ok, files: [file("a.jpg", "image/jpeg"), file("b.pdf", "application/pdf")] })).toBeNull();
  expect(validatePostDispatch({ ...ok, files: [file("a.png", "image/png")] })).toMatch(/a.png/);
  expect(validatePostDispatch({ ...ok, files: [file("a.pdf", "application/pdf", 6 * 1024 * 1024)] })).toMatch(/5 MB/);
  expect(validatePostDispatch({ ...ok, files: Array(6).fill(file("a.pdf", "application/pdf")) })).toMatch(/Up to 5/);
});

test("totals count an order's value once, however many actions it has", () => {
  const orders = {
    a: { net_total: 1000, vendor_id: "v1", merchandiser_name: "Prastuti Kaushik " },
    b: { net_total: 500, vendor_id: "v2", merchandiser_name: "Khushi" },
  };
  const vendors = { v1: { store_brand_name: "Gaia" }, v2: { store_brand_name: "Aza" } };
  const s = summarisePostDispatch([
    { order_id: "a", action_type: "exchange" },
    { order_id: "a", action_type: "return" },
    { order_id: "a", action_type: "return" },
    { order_id: "b", action_type: "return" },
  ], orders, vendors);
  expect(s).toMatchObject({ count: 4, orders: 2, value: 1500 });
  expect(s.byType).toEqual([
    { key: "Exchange", count: 1, value: 1000 },
    { key: "Return", count: 3, value: 1500 },
    { key: "Alteration", count: 0, value: 0 },
  ]);
  expect(s.byPartner[0]).toMatchObject({ key: "Gaia", count: 3, value: 1000 });
  expect(s.byMerchandiser[0].key).toBe("Prastuti Kaushik");
  expect(s.rows[0]).toMatchObject({ partner: "Gaia", value: 1000 });
});

test("an action whose order is not loaded still counts, with no value", () => {
  expect(summarisePostDispatch([{ order_id: "x", action_type: "return" }], {}, {})).toMatchObject({ count: 1, value: 0 });
  expect(summarisePostDispatch(undefined, {}, {})).toMatchObject({ count: 0, orders: 0 });
});

test("helpers", () => {
  expect(groupActionsByOrder([{ order_id: "a" }, { order_id: "a" }, { order_id: "b" }]).a).toHaveLength(2);
  expect(postDispatchLabel("alteration")).toBe("Alteration");
});
