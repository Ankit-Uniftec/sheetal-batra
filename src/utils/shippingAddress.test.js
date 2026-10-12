import { shippingAddressOf, STORE_ADDRESSES } from "./shippingAddress";

test("store delivery with no typed address → the store's address", () => {
  expect(shippingAddressOf({ mode_of_delivery: "Delhi Store" }))
    .toEqual({ store: "Delhi Store", address: STORE_ADDRESSES["Delhi Store"], missing: false });
  expect(shippingAddressOf({ mode_of_delivery: "Ludhiana Store", delivery_address: "  " }).store).toBe("Ludhiana Store");
});

test("Store Pickup resolves the store from where it was placed", () => {
  expect(shippingAddressOf({ mode_of_delivery: "Store Pickup", salesperson_store: "Ludhiana Store" }).store).toBe("Ludhiana Store");
  expect(shippingAddressOf({ mode_of_delivery: "Store Pickup", salesperson_store: "B2B" }).missing).toBe(true);
});

test("a typed address wins; home delivery without one is missing", () => {
  expect(shippingAddressOf({ mode_of_delivery: "Home Delivery", delivery_address: "12 Lane", delivery_city: "Delhi", delivery_pincode: "110048" }))
    .toEqual({ store: null, address: "12 Lane, Delhi, 110048", missing: false });
  expect(shippingAddressOf({ mode_of_delivery: "Home Delivery" }))
    .toEqual({ store: null, address: "", missing: true });
});
