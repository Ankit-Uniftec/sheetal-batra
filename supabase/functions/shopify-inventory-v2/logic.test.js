// Unit tests for shopify-inventory-v2/logic.ts (pure logic, no network).
// Run: node supabase/functions/shopify-inventory-v2/logic.test.js
// Loads the TypeScript through the Babel already installed with react-scripts.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");

const src = fs.readFileSync(path.join(__dirname, "logic.ts"), "utf8");
const { code } = babel.transformSync(src, {
  filename: "logic.ts",
  presets: [require.resolve("@babel/preset-typescript")],
  plugins: [require.resolve("@babel/plugin-transform-modules-commonjs")],
});
const mod = { exports: {} };
new Function("module", "exports", code)(mod, mod.exports);
const L = mod.exports;

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log("ok -", name); };

t("toGid keeps GIDs, builds from numbers, leaves junk", () => {
  assert.strictEqual(L.toGid("gid://shopify/ProductVariant/12", "ProductVariant"), "gid://shopify/ProductVariant/12");
  assert.strictEqual(L.toGid(" 12 ", "Location"), "gid://shopify/Location/12");
  assert.strictEqual(L.toGid(12, "InventoryItem"), "gid://shopify/InventoryItem/12");
  assert.strictEqual(L.toGid("test", "Product"), "test");
  assert.strictEqual(L.toGid(null, "Product"), "");
});

const lvl = (loc, qty) => ({ location: { id: loc }, quantities: [{ name: "available", quantity: qty }] });

t("pickLevel: configured location wins and must exist", () => {
  assert.deepStrictEqual(L.pickLevel("gid://shopify/Location/1", lvl("gid://shopify/Location/1", 4), null), { locationId: "gid://shopify/Location/1", available: 4 });
  assert.ok("error" in L.pickLevel("gid://shopify/Location/1", null, null));
});

t("pickLevel: no location set → exactly one level required", () => {
  assert.deepStrictEqual(L.pickLevel("", null, [lvl("gid://shopify/Location/9", 0)]), { locationId: "gid://shopify/Location/9", available: 0 });
  assert.match(L.pickLevel("", null, [lvl("a", 1), lvl("b", 2)]).error, /several Shopify locations/);
  assert.match(L.pickLevel("", null, []).error, /not stocked/);
});

const product = {
  id: "gid://shopify/Product/1",
  variants: { nodes: [
    { id: "gid://shopify/ProductVariant/11", price: "12500.00", selectedOptions: [{ name: "Size", value: "S" }], inventoryItem: { id: "gid://shopify/InventoryItem/111", inventoryLevels: { nodes: [lvl("L", 3)] } } },
    { id: "gid://shopify/ProductVariant/12", price: "12500.00", selectedOptions: [{ name: "Size", value: "M" }], inventoryItem: { id: "gid://shopify/InventoryItem/112", inventoryLevels: { nodes: [lvl("L", 0)] } } },
    { id: "gid://shopify/ProductVariant/13", price: "0", selectedOptions: [{ name: "Size", value: "Custom Size" }], inventoryItem: { id: "x", inventoryLevels: { nodes: [lvl("L", 9)] } } },
  ] },
};

t("readingsFromProduct reads sizes, skips custom", () => {
  const r = L.readingsFromProduct(product, "");
  assert.strictEqual(r.length, 2);
  assert.deepStrictEqual(r.map((x) => [x.size, x.available, x.price]), [["S", 3, 12500], ["M", 0, 12500]]);
});

t("planUpdates writes only differences, reports unlinked sizes", () => {
  const rows = [
    { id: "a", size: "S", inventory: 5, price: 12500, shopify_variant_id: "gid://shopify/ProductVariant/11", shopify_inventory_item_id: "gid://shopify/InventoryItem/111" },
    { id: "b", size: "M", inventory: 0, price: 12500, shopify_variant_id: "12", shopify_inventory_item_id: null },
    { id: "c", size: "L", inventory: 2, price: 12500, shopify_variant_id: "" },
  ];
  const p = L.planUpdates(rows, L.readingsFromProduct(product, ""));
  assert.deepStrictEqual(p.unlinked, ["L"]);
  assert.strictEqual(p.updates.length, 2);
  assert.deepStrictEqual(p.updates[0], { id: "a", fields: { inventory: 3 }, size: "S", from: 5, to: 3 });
  assert.deepStrictEqual(p.updates[1].fields, { shopify_inventory_item_id: "gid://shopify/InventoryItem/112" });
  assert.strictEqual(p.updates[1].to, null);
});

t("planUpdates puts Shopify's number on one row when a size is stored twice", () => {
  const rows = [
    { id: "a1", size: "S", inventory: 4, price: 12500, shopify_variant_id: "" },
    { id: "a2", size: "S", inventory: 1, price: 12500, shopify_variant_id: "11", shopify_inventory_item_id: "gid://shopify/InventoryItem/111" },
    { id: "a3", size: "S ", inventory: 2, price: 12500, shopify_variant_id: "11", shopify_inventory_item_id: "gid://shopify/InventoryItem/111" },
  ];
  const p = L.planUpdates(rows, L.readingsFromProduct(product, ""));
  const byId = Object.fromEntries(p.updates.map((u) => [u.id, u.fields.inventory]));
  // a3 (linked, most stock) keeps Shopify's 3; the other copies go to 0
  assert.deepStrictEqual(byId, { a3: 3, a1: 0, a2: 0 });
  const after = rows.map((r) => ({ size: r.size.trim(), inventory: byId[r.id] ?? r.inventory }));
  assert.deepStrictEqual(L.inventoryMap(after), { S: 3 });
});

t("planUpdates links sizes by name when only the product id was entered", () => {
  const rows = [
    { id: "n1", size: " s", inventory: 7, price: 12500, shopify_variant_id: null },
    { id: "n2", size: "M", inventory: 0, price: 12500, shopify_variant_id: "gid://shopify/ProductVariant/999" }, // wrong id
    { id: "n3", size: "XXL", inventory: 2, price: 12500, shopify_variant_id: "" },
  ];
  const p = L.planUpdates(rows, L.readingsFromProduct(product, ""));
  assert.deepStrictEqual(p.linked.map((l) => [l.id, l.variantId]), [["n1", "gid://shopify/ProductVariant/11"], ["n2", "gid://shopify/ProductVariant/12"]]);
  const n1 = p.updates.find((u) => u.id === "n1");
  assert.deepStrictEqual(n1.fields, { inventory: 3, shopify_inventory_item_id: "gid://shopify/InventoryItem/111", shopify_variant_id: "gid://shopify/ProductVariant/11" });
  assert.strictEqual(p.updates.find((u) => u.id === "n2").fields.shopify_variant_id, "gid://shopify/ProductVariant/12");
  assert.deepStrictEqual(p.unlinked, ["XXL"]); // reported, never guessed
});

t("matchBySize refuses an ambiguous size", () => {
  assert.strictEqual(L.matchBySize("S", [{ size: "S" }, { size: "s " }]), null);
  assert.deepStrictEqual(L.matchBySize("free  size", [{ size: "Free Size" }]), { size: "Free Size" });
  assert.strictEqual(L.matchBySize("2XL", [{ size: "XXL" }]), null);
});

t("canonicalRow prefers linked, then most stock, then id", () => {
  assert.strictEqual(L.canonicalRow([{ id: "x", inventory: 9, shopify_variant_id: null }, { id: "y", inventory: 0, shopify_variant_id: "5" }]).id, "y");
  assert.strictEqual(L.canonicalRow([{ id: "b", inventory: 0, shopify_variant_id: "5" }, { id: "a", inventory: 0, shopify_variant_id: "5" }]).id, "a");
  assert.strictEqual(L.canonicalRow([]), null);
});

t("inventoryMap keeps sizes in stock only", () => {
  assert.deepStrictEqual(L.inventoryMap([{ size: "S", inventory: 2 }, { size: "M", inventory: 0 }, { size: "S", inventory: 1 }]), { S: 3 });
});

t("deltaFor: adjust needs a non-zero integer; set computes target − current", () => {
  assert.deepStrictEqual(L.deltaFor("adjust", 5, -2, null), { delta: -2 });
  assert.ok("error" in L.deltaFor("adjust", 5, 0, null));     // the old function turned 0 into −1
  assert.ok("error" in L.deltaFor("adjust", 5, 1.5, null));
  assert.deepStrictEqual(L.deltaFor("set", 3, null, 4), { delta: 1 });  // the stale-number case: Shopify 3, set 4 → +1
  assert.deepStrictEqual(L.deltaFor("set", 3, null, 3), { delta: 0 });
  assert.ok("error" in L.deltaFor("set", 3, null, -1));
});

t("isStale recognises the compare-and-swap error", () => {
  assert.ok(L.isStale([{ code: "CHANGE_FROM_QUANTITY_STALE", message: "x" }]));
  assert.ok(!L.isStale([{ code: "INVALID", message: "Location not found" }]));
});

t("soldProductIds takes synced lines only", () => {
  assert.deepStrictEqual(L.soldProductIds([{ items: [{ product_id: "p1", sync_enabled: true }, { product_id: "p2" }] }, { items: null }]), ["p1"]);
});

t("nextBatch rotates and wraps", () => {
  const ids = ["a", "b", "c", "d", "e"];
  assert.deepStrictEqual(L.nextBatch(ids, null, 2), { batch: ["a", "b"], cursor: "b" });
  assert.deepStrictEqual(L.nextBatch(ids, "b", 2), { batch: ["c", "d"], cursor: "d" });
  assert.deepStrictEqual(L.nextBatch(ids, "d", 2), { batch: ["e", "a"], cursor: "a" });
  assert.deepStrictEqual(L.nextBatch(ids, "z", 2), { batch: ["a", "b"], cursor: "b" });
  assert.deepStrictEqual(L.nextBatch(["a"], "a", 20), { batch: ["a"], cursor: "a" });
});

t("chunk splits evenly", () => {
  assert.deepStrictEqual(L.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

console.log(`\n${n} passed`);
