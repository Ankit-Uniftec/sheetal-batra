import { b2bPaymentState, canUpdateB2bPayment, canUpdatePayment } from "./recordPayment";

jest.mock("../lib/supabaseClient", () => ({ supabase: {} }));
jest.mock("./paymentProofs", () => ({ uploadPaymentProof: jest.fn() }));

const b2b = (extra = {}) => ({ is_b2b: true, approval_status: "approved", status: "order_received", b2b_order_type: "Buyout", net_total: 10000, total_paid: 0, ...extra });

describe("canUpdateB2bPayment", () => {
  it("allows an approved B2B order that still owes money", () => {
    expect(canUpdateB2bPayment(b2b())).toBe(true);
  });
  it("stays open after delivery: partners pay on invoice", () => {
    expect(canUpdateB2bPayment(b2b({ status: "delivered" }))).toBe(true);
  });
  it("refuses fully paid, pending, cancelled, stock and gifting orders", () => {
    expect(canUpdateB2bPayment(b2b({ total_paid: 10000 }))).toBe(false);
    expect(canUpdateB2bPayment(b2b({ approval_status: "pending" }))).toBe(false);
    expect(canUpdateB2bPayment(b2b({ status: "cancelled" }))).toBe(false);
    expect(canUpdateB2bPayment(b2b({ status: "revoked" }))).toBe(false);
    expect(canUpdateB2bPayment(b2b({ is_stock_order: true }))).toBe(false);
    expect(canUpdateB2bPayment(b2b({ b2b_order_type: "Partner Gifting" }))).toBe(false);
    expect(canUpdateB2bPayment(b2b({ is_gifting: true }))).toBe(false);
  });
  it("refuses retail orders, and retail Update Payment still refuses B2B", () => {
    expect(canUpdateB2bPayment({ ...b2b(), is_b2b: false })).toBe(false);
    expect(canUpdatePayment(b2b())).toBe(false);
  });
});

describe("b2bPaymentState", () => {
  it("reads received from total_paid and never shows a negative balance", () => {
    expect(b2bPaymentState(b2b({ total_paid: 4000 }))).toEqual({ total: 10000, received: 4000, balance: 6000 });
    expect(b2bPaymentState(b2b({ total_paid: 12000 })).balance).toBe(0);
  });
  it("falls back to the advance on rows without total_paid", () => {
    expect(b2bPaymentState(b2b({ total_paid: null, advance_payment: 2500 })).received).toBe(2500);
  });
});
