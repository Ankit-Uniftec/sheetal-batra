import { proofSummary } from "./paymentProofs";

jest.mock("../lib/supabaseClient", () => ({ supabase: {} }));

const order = (over = {}) => ({
  order_no: "SB-DLC-1126-000001", status: "order_received", net_total: 100, total_paid: 20, remaining_payment: 80,
  advance_payment: 20, payment_mode: "UPI", ...over,
});
const proof = (amount) => ({ id: String(amount), amount, payment_mode: "UPI" });

test("Rs 20 proof on a Rs 100 order leaves Rs 80 pending", () => {
  expect(proofSummary(order(), [proof(20)], [])).toMatchObject({
    total: 100, paid: 20, balance: 80, count: 1, attached: 20, noProofNeeded: 0, pending: 80,
  });
});

test("no proof at all", () => {
  expect(proofSummary(order(), [], [])).toMatchObject({ count: 0, attached: 0, pending: 100 });
  expect(proofSummary(order(), undefined, undefined)).toMatchObject({ count: 0, pending: 100 });
});

test("several proofs add up, and pending never goes below 0", () => {
  expect(proofSummary(order(), [proof(60), proof(30)], [])).toMatchObject({ count: 2, attached: 90, pending: 10 });
  expect(proofSummary(order(), [proof(150)], [])).toMatchObject({ pending: 0 });
});

test("cash at order time needs no proof", () => {
  const o = order({ payment_mode: "Cash" });
  expect(proofSummary(o, [], [])).toMatchObject({ noProofNeeded: 20, pending: 80 });
  expect(proofSummary(order({ payment_mode: "COD" }), [], [])).toMatchObject({ noProofNeeded: 20, pending: 80 });
});

test("the cash part of a split advance needs no proof, the UPI part does", () => {
  const o = order({
    is_split_payment: true, advance_payment: 70, total_paid: 70,
    payment_mode: JSON.stringify([{ mode: "UPI", amount: 50 }, { mode: "Cash", amount: 20 }]),
  });
  expect(proofSummary(o, [proof(50)], [])).toMatchObject({ noProofNeeded: 20, attached: 50, pending: 30 });
});

test("later cash and legacy adjustments need no proof, later UPI does", () => {
  const pays = [
    { kind: "balance", payment_mode: "Cash", amount: 30 },
    { kind: "balance", payment_mode: "Legacy adjustment", amount: 10 },
    { kind: "balance", payment_mode: "UPI", amount: 40 },
  ];
  expect(proofSummary(order({ total_paid: 100 }), [proof(20)], pays)).toMatchObject({ noProofNeeded: 40, pending: 40 });
});

test("a proof with no recorded amount still counts as attached", () => {
  expect(proofSummary(order(), [{ id: "x", amount: null }], [])).toMatchObject({ count: 1, attached: 0 });
});

test.each([
  ["website", { order_no: "SB-SHOPIFY-1126-000001" }],
  ["stock", { is_stock_order: true }],
  ["cancelled", { status: "cancelled" }],
  ["revoked", { status: "revoked" }],
  ["no value", { net_total: 0 }],
])("no line for %s orders", (_, over) => {
  expect(proofSummary(order(over), [], [])).toBeNull();
});
