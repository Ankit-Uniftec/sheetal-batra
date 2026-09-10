import { parseCsv, validateRow, SIZE_OPTIONS, checkDuplicateName } from "./csvHelpers";
import { isProductVisibleForStore } from "../../utils/storeCategory";

// Minimal valid row; each test overrides only what it's about.
const base = {
  name: "Liana Mustard Chauga with Salwar",
  base_price: "24000",
  inventory: "MTO",
};

const sizes = (available_size) =>
  validateRow({ ...base, available_size }, 2).normalized.available_size;

test("available_size is upper-cased, de-duped and canonically ordered", () => {
  expect(sizes("XXS|XXS|m|XS")).toEqual(["XXS", "XS", "M"]);
  expect(sizes(SIZE_OPTIONS.join("|"))).toEqual(SIZE_OPTIONS);
});

test("an unknown size fails the row instead of importing", () => {
  const r = validateRow({ ...base, available_size: "XS|Small" }, 2);
  expect(r.ok).toBe(false);
  expect(r.errors[0]).toMatch(/unknown size\(s\) SMALL/);
});

// SKU-1293 reached prod as '"Adeela_Burnt Orange Kurta with Salwar and dupatta "'
// — literal quotes, trailing space. It came from a bulk SQL load, not from
// here; this pins that the importer can't produce that shape.
test("a quoted, space-padded cell imports clean", () => {
  const csv = [
    "sku_id,name",
    ',"Adeela_Burnt Orange Kurta with Salwar and dupatta "',
    "",
  ].join("\n");
  expect(parseCsv(csv).data[0].name).toBe("Adeela_Burnt Orange Kurta with Salwar and dupatta");
});

test("a doubled quote inside a cell unescapes to one quote", () => {
  const csv = ["name", '"He said ""hi"""', ""].join("\n");
  expect(parseCsv(csv).data[0].name).toBe('He said "hi"');
});

// ─── Factory One ──────────────────────────────────────────────────────
// A holding location, not a shop floor. Adding it to STORE_CATEGORIES makes
// the CSV importer accept it; the point of the value is that a product tagged
// with it reaches NO salesperson's order form, so pin both halves.
describe("Factory One store category", () => {
  it("is accepted by the CSV importer", () => {
    const r = validateRow({ ...base, store_category: "Factory One" }, 2);
    expect(r.ok).toBe(true);
    expect(r.normalized.store_category).toBe("Factory One");
  });

  it("is hidden from both stores' order forms", () => {
    const factoryPiece = { store_category: "Factory One" };
    expect(isProductVisibleForStore(factoryPiece, "Delhi")).toBe(false);
    expect(isProductVisibleForStore(factoryPiece, "Ludhiana")).toBe(false);
  });

  it("does not change what other categories do", () => {
    expect(isProductVisibleForStore({ store_category: "All Stores" }, "Delhi")).toBe(true);
    expect(isProductVisibleForStore({ store_category: "Delhi" }, "Delhi")).toBe(true);
    expect(isProductVisibleForStore({ store_category: "Delhi" }, "Ludhiana")).toBe(false);
  });
});

// ─── checkDuplicateName ───────────────────────────────────────────────
// The rule that stops the order dropdown filling with indistinguishable
// entries. Same name + same store is the case that produced two orderable
// prices for one style.
describe("checkDuplicateName", () => {
  const existing = [
    { name: "Zimal chauga", store_category: "All Stores" },
    { name: "Riva chauga", store_category: "Delhi" },
  ];

  it("allows a name nothing else uses", () => {
    expect(checkDuplicateName("Brand New", "Delhi", existing).ok).toBe(true);
  });

  it("rejects same name in the same store", () => {
    const r = checkDuplicateName("Riva chauga", "Delhi", existing);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/already exists for Delhi/);
  });

  it("labels the Delhi piece when an All Stores row exists — both stay sellable", () => {
    const r = checkDuplicateName("Zimal chauga", "Delhi", existing);
    expect(r.ok).toBe(true);
    expect(r.renameTo).toBe("Zimal chauga (Delhi)");
  });

  it("labels a new All Stores row when a store row exists", () => {
    const r = checkDuplicateName("Riva chauga", "All Stores", existing);
    expect(r.ok).toBe(true);
    expect(r.renameTo).toBe("Riva chauga (All Stores)");
  });

  it("allows Delhi vs Ludhiana, appending the store to the name", () => {
    const r = checkDuplicateName("Riva chauga", "Ludhiana", existing);
    expect(r.ok).toBe(true);
    expect(r.renameTo).toBe("Riva chauga (Ludhiana)");
  });

  it("matches case-insensitively and ignores surrounding space", () => {
    expect(checkDuplicateName("  riva CHAUGA ", "Delhi", existing).ok).toBe(false);
  });

  it("treats a blank store_category as All Stores", () => {
    const r = checkDuplicateName("Riva chauga", "", existing);
    expect(r.ok).toBe(true);
    expect(r.renameTo).toBe("Riva chauga (All Stores)");
  });

  it("still rejects an exact same-store repeat after one was labelled", () => {
    const withLabelled = [...existing, { name: "Zimal chauga (Delhi)", store_category: "Delhi" }];
    expect(checkDuplicateName("Zimal chauga (Delhi)", "Delhi", withLabelled).ok).toBe(false);
  });
});
