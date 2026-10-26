import {
  B2B_EDIT_KEY, beginB2bEdit, clearB2bOrderFlow, isEditingB2bOrder, startNewB2bOrder, startB2bStockOrder,
} from "./b2bStockOrder";
import {
  B2B_GIFTING_FLAG, startB2bGifting, isB2bGifting, isPartnerGiftingRow,
  giftingSessionFields, partnerGiftingNote,
} from "./b2bStockOrder";
import { isSaleOrder } from "./revenue";

beforeEach(() => sessionStorage.clear());

test("an abandoned edit does not survive starting a new order", () => {
  beginB2bEdit("order-A");
  sessionStorage.setItem("b2bVendorData", JSON.stringify({ poNumber: "1077188" }));
  expect(isEditingB2bOrder()).toBe(true);
  startNewB2bOrder();
  expect(sessionStorage.getItem(B2B_EDIT_KEY)).toBeNull();
  expect(sessionStorage.getItem("b2bVendorData")).toBeNull();
  expect(isEditingB2bOrder()).toBe(false);
});

test("opening a dashboard forgets an unfinished edit", () => {
  beginB2bEdit("order-A");
  clearB2bOrderFlow();
  expect(isEditingB2bOrder()).toBe(false);
});

test("starting an edit forgets leftovers from an earlier order or edit", () => {
  beginB2bEdit("order-A");
  sessionStorage.setItem("b2bProductFormData", "{}");
  startB2bStockOrder();            // stock flow clears the flow keys too
  beginB2bEdit("order-B");
  expect(sessionStorage.getItem(B2B_EDIT_KEY)).toBe("order-B");
  expect(sessionStorage.getItem("b2bProductFormData")).toBeNull();
  expect(sessionStorage.getItem("isB2bStockOrder")).toBeNull();
});

// ---------- B2B Partner Gifting (Release 24) ----------

test("gifting mode starts clean and is cleared by a new normal order", () => {
  sessionStorage.setItem("b2bVendorData", JSON.stringify({ poNumber: "OLD" }));
  startB2bGifting();
  expect(isB2bGifting()).toBe(true);
  expect(sessionStorage.getItem("b2bVendorData")).toBeNull();
  startNewB2bOrder();
  expect(isB2bGifting()).toBe(false);
});

test("editing a gifting order keeps it a gift; editing a normal order does not", () => {
  beginB2bEdit("g1", { is_b2b: true, b2b_order_type: "Partner Gifting" });
  expect(sessionStorage.getItem(B2B_GIFTING_FLAG)).toBe("true");
  beginB2bEdit("n1", { is_b2b: true, b2b_order_type: "Buyout" });
  expect(isB2bGifting()).toBe(false);
  expect(isEditingB2bOrder()).toBe(true);
});

test("gifting details come back for Edit, without doubling the note", () => {
  const order = {
    is_b2b: true, b2b_order_type: "Partner Gifting",
    gift_recipient_name: "Riya", gift_recipient_contact: "9876543210", delivery_email: "r@x.com",
    comments: `${partnerGiftingNote("Festive gifting", "Aman")}\n\nPack nicely`,
  };
  const f = giftingSessionFields(order);
  expect(f).toMatchObject({ recipientName: "Riya", recipientContact: "9876543210", recipientEmail: "r@x.com",
    purpose: "Festive gifting", purposeOther: "", pocName: "Aman", remarks: "Pack nicely", orderType: "Partner Gifting" });
  const other = giftingSessionFields({ ...order, comments: partnerGiftingNote("Diwali hamper for staff", "") });
  expect(other).toMatchObject({ purpose: "Other", purposeOther: "Diwali hamper for staff", pocName: "", remarks: "" });
});

test("a Partner Gifting order is not a sale; a normal B2B order still is", () => {
  const base = { is_b2b: true, status: "order_received", grand_total: 0 };
  expect(isPartnerGiftingRow({ ...base, b2b_order_type: "Partner Gifting" })).toBe(true);
  expect(isSaleOrder({ ...base, b2b_order_type: "Partner Gifting" })).toBe(false);
  expect(isSaleOrder({ ...base, b2b_order_type: "Buyout", grand_total: 5000 })).toBe(true);
});
