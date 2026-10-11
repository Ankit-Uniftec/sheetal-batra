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
