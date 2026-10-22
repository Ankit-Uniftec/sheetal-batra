import {
  B2B_EDIT_KEY, beginB2bEdit, clearB2bOrderFlow, isEditingB2bOrder, startNewB2bOrder, startB2bStockOrder,
} from "./b2bStockOrder";

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
