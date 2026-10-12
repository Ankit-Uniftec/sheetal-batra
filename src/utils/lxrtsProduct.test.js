// Meeting point 44: an order with ANY LXRTS product is hidden from every
// Warehouse account; the same rule clears unconfirmed COD on the Shopify desk
// (point 45). Name-based only.
import { hasLxrtsProduct } from "./lxrtsProduct.mjs";

const order = (...names) => ({ items: names.map((product_name) => ({ product_name })) });

test("any product named LXRTS marks the order, whatever its other products", () => {
  expect(hasLxrtsProduct(order("Mohsina - Dark Blue Short Kalidaar Chauga with Salwar (LXRTS)"))).toBe(true);
  expect(hasLxrtsProduct(order("Aabish Kurta Set", "AYRA - DEEP RED SHORT CHAUGA WITH SALWAR (Lxrts)"))).toBe(true);
  expect(hasLxrtsProduct(order("lxrts - Ashira Kurta"))).toBe(true);
});

test("no LXRTS product name → not hidden", () => {
  expect(hasLxrtsProduct(order("Aabish- Mint Green Tilla Embroidered Kurta Set"))).toBe(false);
  expect(hasLxrtsProduct(order("Aabish LXRTSX Kurta"))).toBe(false);       // whole word only
  expect(hasLxrtsProduct({ items: [{ product_name: "Kurta", sync_enabled: true }] })).toBe(false); // the flag is NOT the rule
  expect(hasLxrtsProduct({ shopify_tags: ["SB-lxrts_delhi_mumbai_sale"], items: [] })).toBe(false); // tags are not the rule
  expect(hasLxrtsProduct({})).toBe(false);
  expect(hasLxrtsProduct(null)).toBe(false);
});

test("only ALL-LXRTS orders are hidden; mixed orders stay (their other products must be made)", () => {
  const { isAllLxrtsOrder, isLxrtsLine } = require("./lxrtsProduct.mjs");
  expect(isAllLxrtsOrder(order("Mohsina (LXRTS)"))).toBe(true);
  expect(isAllLxrtsOrder(order("Mohsina (LXRTS)", "Mehrish (LXRTS)"))).toBe(true);
  expect(isAllLxrtsOrder(order("Mohsina (LXRTS)", "Lightweight dupatta"))).toBe(false);   // mixed
  expect(isAllLxrtsOrder({ items: [{ product_name: "Mohsina (LXRTS)" }, { product_name: "Customisation", is_charge: true }] })).toBe(true); // charges don't count
  expect(isAllLxrtsOrder({ items: [{ product_name: "Customisation", is_charge: true }] })).toBe(false); // nothing but a charge
  expect(isAllLxrtsOrder({ items: [] })).toBe(false);
  expect(isLxrtsLine({ product_name: "Zaniab - Daisy Ivory Kurta Set (LXRTS)" })).toBe(true);
  expect(isLxrtsLine({ product_name: "Light Silk Organza Dupatta" })).toBe(false);
});
