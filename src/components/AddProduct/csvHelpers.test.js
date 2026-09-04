import { parseCsv, validateRow, SIZE_OPTIONS } from "./csvHelpers";

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
