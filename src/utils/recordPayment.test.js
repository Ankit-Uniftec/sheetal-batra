// Update Payment with per-row proofs (meeting point 26): the payment is always
// recorded first, each proof is linked to ITS payment row, and a failed proof
// never undoes the payment.
// CRA resets mock implementations before each test (resetMocks), so they are
// (re)installed in beforeEach below.
const mockInsertSelect = jest.fn();
const mockInsert = jest.fn();
const mockSingle = jest.fn();
jest.mock("../lib/supabaseClient", () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { email: "sa@sb.com" } } }) },
    from: (table) => table === "order_payments"
      ? { insert: mockInsert }
      : { select: () => ({ eq: () => ({ single: mockSingle }) }) },
  },
}));
const mockUpload = jest.fn();
jest.mock("./paymentProofs", () => ({ uploadPaymentProof: (...a) => mockUpload(...a) }));

import { recordPayment, paymentRecordedPopup } from "./recordPayment";

const order = { id: "o1", order_no: "SB-DLC-1026-000001" };
const file = (name) => ({ name, type: "image/png", size: 10 });

beforeEach(() => {
  mockInsert.mockImplementation(() => ({ select: mockInsertSelect }));
  mockSingle.mockImplementation(() => Promise.resolve({ data: { id: "o1", remaining_payment: 0 } }));
});

test("each proof is linked to its own payment row; cash rows carry none", async () => {
  mockInsertSelect.mockResolvedValueOnce({ data: [
    { id: "p-cash", payment_mode: "Cash", amount: 1000 },
    { id: "p-upi", payment_mode: "UPI", amount: 5000 },
    { id: "p-card", payment_mode: "Credit Card", amount: 2000 },
  ], error: null });
  mockUpload.mockResolvedValue({});
  const res = await recordPayment(order, { paidAt: "2026-10-12", rows: [
    { mode: "Cash", amount: 1000 },
    { mode: "UPI", amount: 5000, proofFile: file("upi.png") },
    { mode: "Credit Card", amount: 2000, proofFile: file("card.pdf") },
  ] }, "sa@sb.com");
  expect(mockInsert).toHaveBeenCalledTimes(1);
  expect(mockInsert.mock.calls[0][0].every((r) => r.kind === "balance" && !("proofFile" in r))).toBe(true);
  expect(mockUpload.mock.calls.map((c) => [c[0].file.name, c[0].paymentId, c[0].checkpoint])).toEqual([
    ["upi.png", "p-upi", "balance"],
    ["card.pdf", "p-card", "balance"],
  ]);
  expect(res.proofsSaved).toBe(2);
  expect(res.proofFailures).toEqual([]);
});

test("rows returned out of order still link by mode and amount", async () => {
  mockInsertSelect.mockResolvedValueOnce({ data: [
    { id: "p-card", payment_mode: "Credit Card", amount: 2000 },
    { id: "p-upi", payment_mode: "UPI", amount: 5000 },
  ], error: null });
  mockUpload.mockResolvedValue({});
  await recordPayment(order, { paidAt: "2026-10-12", rows: [
    { mode: "UPI", amount: 5000, proofFile: file("upi.png") },
    { mode: "Credit Card", amount: 2000, proofFile: file("card.pdf") },
  ] }, "sa@sb.com");
  expect(mockUpload.mock.calls.map((c) => c[0].paymentId)).toEqual(["p-upi", "p-card"]);
});

test("a failed proof never undoes the payment and is reported", async () => {
  mockInsertSelect.mockResolvedValueOnce({ data: [{ id: "p-upi", payment_mode: "UPI", amount: 5000 }], error: null });
  mockUpload.mockRejectedValueOnce(new Error("network"));
  const res = await recordPayment(order, { paidAt: "2026-10-12", rows: [
    { mode: "UPI", amount: 5000, proofFile: file("upi.png") },
  ] }, "sa@sb.com");
  expect(res.collected).toBe(5000);
  expect(res.proofsSaved).toBe(0);
  expect(res.proofFailures).toEqual(["upi.png (UPI ₹5000)"]);
  const popup = paymentRecordedPopup(res);
  expect(popup.type).toBe("warning");
  expect(popup.message).toMatch(/upi\.png/);
  expect(popup.message).toMatch(/fully paid/);
});

test("a failed payment insert throws and uploads nothing", async () => {
  mockInsertSelect.mockResolvedValueOnce({ data: null, error: new Error("denied") });
  await expect(recordPayment(order, { paidAt: "2026-10-12", rows: [
    { mode: "UPI", amount: 5000, proofFile: file("upi.png") },
  ] }, "sa@sb.com")).rejects.toThrow("denied");
  expect(mockUpload).not.toHaveBeenCalled();
});

test("plain success wording, with proof count", () => {
  expect(paymentRecordedPopup({ collected: 5000, fresh: { remaining_payment: 1000 }, proofsSaved: 1 }))
    .toEqual({ type: "success", title: "Payment Recorded", message: "₹5,000 recorded. Balance now ₹1,000. 1 payment proof attached." });
});
