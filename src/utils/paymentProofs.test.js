// Guards the payment-proof rules (meeting point 26): never for cash-only
// orders, and only JPEG / PNG / PDF up to 5 MB.
jest.mock("../lib/supabaseClient", () => ({ supabase: {} }));
import { canAttachPaymentProof, validateProofFile, orderTimeModes, isWebsiteOrder, isCashMode } from "./paymentProofs";

const split = (...modes) => ({ is_split_payment: true, payment_mode: JSON.stringify(modes.map((m) => ({ mode: m, amount: "100" }))) });

test("cash-only orders get no proof button", () => {
  expect(canAttachPaymentProof({ payment_mode: "Cash" })).toBe(false);
  expect(canAttachPaymentProof({ payment_mode: "cash " })).toBe(false);
  expect(canAttachPaymentProof(split("Cash", "Cash"))).toBe(false);
});

test("any non-cash payment shows the button", () => {
  expect(canAttachPaymentProof({ payment_mode: "UPI" })).toBe(true);
  expect(canAttachPaymentProof({ payment_mode: "Credit Card" })).toBe(true);
  expect(canAttachPaymentProof(split("UPI", "Cash"))).toBe(true);
  // advance in cash, balance collected later by UPI
  expect(canAttachPaymentProof({ payment_mode: "Cash" }, true)).toBe(true);
});

test("no known mode and no later payment → no button; cancelled → no button", () => {
  expect(canAttachPaymentProof({ payment_mode: "" })).toBe(false);
  expect(canAttachPaymentProof({ payment_mode: null })).toBe(false);
  expect(canAttachPaymentProof({ payment_mode: "UPI", status: "cancelled" })).toBe(false);
  expect(canAttachPaymentProof({ payment_mode: "UPI", status: "Revoked" })).toBe(false);
});

test("split modes are read from the JSON", () => {
  expect(orderTimeModes(split("UPI", "Cash"))).toEqual(["UPI", "Cash"]);
  expect(orderTimeModes({ payment_mode: "[not json" })).toEqual(["[not json"]);
});

test("file rules", () => {
  const f = (type, size, name = "x") => ({ type, size, name });
  expect(validateProofFile(f("image/jpeg", 1000))).toBeNull();
  expect(validateProofFile(f("image/png", 1000))).toBeNull();
  expect(validateProofFile(f("application/pdf", 5 * 1024 * 1024))).toBeNull();
  expect(validateProofFile(f("application/vnd.openxmlformats-officedocument.wordprocessingml.document", 1000))).toMatch(/JPEG, PNG or PDF/);
  expect(validateProofFile(f("image/jpeg", 6 * 1024 * 1024))).toMatch(/limit is 5 MB/);
  expect(validateProofFile(f("image/jpeg", 0))).toMatch(/empty/);
  expect(validateProofFile(null)).toMatch(/Choose a file/);
});

test("website (Shopify) orders never get proofs", () => {
  expect(isWebsiteOrder({ order_no: "SB-SHOPIFY-1026-011267" })).toBe(true);
  expect(isWebsiteOrder({ order_no: "SB-SHOP-0726-000123" })).toBe(true);
  expect(isWebsiteOrder({ order_no: "SB-DLC-1026-011235", shopify_order_id: "gid://shopify/Order/1" })).toBe(true);
  expect(isWebsiteOrder({ order_no: "SB-DLC-1026-011235" })).toBe(false);
  expect(canAttachPaymentProof({ order_no: "SB-SHOPIFY-1026-1", payment_mode: "Gokwik UPI" })).toBe(false);
  expect(canAttachPaymentProof({ order_no: "SB-SHOPIFY-1026-1", payment_mode: "COD" }, true)).toBe(false);
  expect(canAttachPaymentProof({ order_no: "SB-DLC-1026-1", payment_mode: "UPI" })).toBe(true);
});

test("cash check ignores case and spaces", () => {
  expect(isCashMode(" CASH ")).toBe(true);
  expect(isCashMode("UPI")).toBe(false);
  expect(isCashMode(null)).toBe(false);
});

// ---- Release 12: advance proofs -------------------------------------------
import { advanceProofParts, matchAdvanceProofs, proofPaymentLabel } from "./paymentProofs";

test("advance parts: one non-cash mode → the whole advance; cash / COD → none", () => {
  expect(advanceProofParts({ order_no: "SB-DLC-1", advance_payment: 5000, payment_mode: "UPI" }))
    .toEqual([{ key: "UPI|5000", mode: "UPI", amount: 5000 }]);
  expect(advanceProofParts({ order_no: "SB-DLC-1", advance_payment: 5000, payment_mode: "Cash" })).toEqual([]);
  expect(advanceProofParts({ order_no: "SB-DLC-1", advance_payment: 5000, payment_mode: "COD" })).toEqual([]);
});

test("advance parts: split → one per non-cash part", () => {
  const order = {
    order_no: "SB-DLC-1", advance_payment: 7000, is_split_payment: true,
    payment_mode: JSON.stringify([{ mode: "UPI", amount: 5000 }, { mode: "Cash", amount: 2000 }, { mode: "Credit Card", amount: 0 }]),
  };
  expect(advanceProofParts(order).map((p) => p.key)).toEqual(["UPI|5000"]);
});

test("advance parts: none for website, stock, cancelled or a zero advance", () => {
  expect(advanceProofParts({ order_no: "SB-SHOPIFY-0926-1", advance_payment: 5000, payment_mode: "UPI" })).toEqual([]);
  expect(advanceProofParts({ order_no: "SB-STOCK-1", is_stock_order: true, advance_payment: 5000, payment_mode: "UPI" })).toEqual([]);
  expect(advanceProofParts({ order_no: "SB-DLC-1", status: "cancelled", advance_payment: 5000, payment_mode: "UPI" })).toEqual([]);
  expect(advanceProofParts({ order_no: "SB-DLC-1", advance_payment: 0, payment_mode: "UPI" })).toEqual([]);
});

test("matching proofs to parts: by mode + amount; old unlabeled proofs go to a lone part", () => {
  const parts = [{ key: "UPI|5000", mode: "UPI", amount: 5000 }, { key: "Credit Card|2000", mode: "Credit Card", amount: 2000 }];
  const proofs = [
    { id: 1, checkpoint: "advance", payment_mode: "UPI", amount: 5000 },
    { id: 2, checkpoint: "advance", payment_mode: null, amount: null },
    { id: 3, checkpoint: "balance", payment_mode: "UPI", amount: 5000 },
  ];
  const m = matchAdvanceProofs(parts, proofs);
  expect(m.parts.map((p) => p.proofs.map((x) => x.id))).toEqual([[1], []]);
  expect(m.unlabeled.map((x) => x.id)).toEqual([2]);
  expect(matchAdvanceProofs([parts[1]], proofs).parts[0].proofs.map((x) => x.id)).toEqual([2]);
  expect(proofPaymentLabel({ payment_mode: "UPI", amount: 5000 })).toBe("UPI ₹5,000");
  expect(proofPaymentLabel({})).toBeNull();
});
