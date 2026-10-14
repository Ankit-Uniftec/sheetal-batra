const mockUpload = jest.fn();
jest.mock("./paymentProofs", () => ({ uploadPaymentProof: (...a) => mockUpload(...a) }));
import {
  setPendingAdvanceProof, getPendingAdvanceProofs, clearPendingAdvanceProofs, uploadPendingAdvanceProofs,
} from "./pendingAdvanceProof";

const file = (name) => ({ name });
const order = { id: "o1", order_no: "SB-DLC-1" };
const parts = [{ key: "UPI|5000", mode: "UPI", amount: 5000 }, { key: "Credit Card|2000", mode: "Credit Card", amount: 2000 }];

beforeEach(() => {
  clearPendingAdvanceProofs();
  mockUpload.mockResolvedValue({});
});

test("holds, replaces and removes a file per part", () => {
  setPendingAdvanceProof("UPI|5000", file("a.png"));
  setPendingAdvanceProof("UPI|5000", file("b.png"));
  expect(getPendingAdvanceProofs()["UPI|5000"].name).toBe("b.png");
  setPendingAdvanceProof("UPI|5000", null);
  expect(getPendingAdvanceProofs()).toEqual({});
});

test("after placing: uploads each held file as an advance proof with its label, then clears", async () => {
  setPendingAdvanceProof("UPI|5000", file("upi.png"));
  setPendingAdvanceProof("Gone|1", file("stale.png"));   // part no longer exists → ignored
  const res = await uploadPendingAdvanceProofs(order, parts, "sa@sb.com");
  expect(res).toEqual({ saved: 1, failed: [] });
  expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(mockUpload.mock.calls[0][0]).toMatchObject({
    order, checkpoint: "advance", uploadedBy: "sa@sb.com", paymentMode: "UPI", amount: 5000,
  });
  expect(getPendingAdvanceProofs()).toEqual({});
});

test("a failed upload is reported, never thrown", async () => {
  mockUpload.mockRejectedValueOnce(new Error("network"));
  setPendingAdvanceProof("UPI|5000", file("upi.png"));
  setPendingAdvanceProof("Credit Card|2000", file("card.pdf"));
  const res = await uploadPendingAdvanceProofs(order, parts, "sa@sb.com");
  expect(res).toEqual({ saved: 1, failed: ["upi.png (UPI ₹5000)"] });
});
