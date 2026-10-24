import {
  getItemCategory, isKidsItem, sizeOptionsFor, ORDER_CATEGORIES,
  KIDS_SIZE_OPTIONS, WOMEN_SIZE_OPTIONS,
} from "./itemCategory";

test("old and Shopify items: category comes from isKids", () => {
  expect(getItemCategory({ isKids: true })).toBe("Kids");
  expect(getItemCategory({ isKids: false })).toBe("Women");
  expect(getItemCategory({})).toBe("Women");
  expect(getItemCategory(null)).toBe("Women");
});

test("a known category wins, in any letter case", () => {
  expect(getItemCategory({ category: "Kids", isKids: true })).toBe("Kids");
  expect(getItemCategory({ category: "Women", isKids: false })).toBe("Women");
  expect(getItemCategory({ category: " kids " })).toBe("Kids");
  expect(getItemCategory({ category: "Men" })).toBe("Men");
  expect(getItemCategory({ category: "MEN", isKids: false })).toBe("Men");
});

test("unknown category falls back to isKids, never breaks", () => {
  expect(getItemCategory({ category: "Unisex", isKids: true })).toBe("Kids");
  expect(getItemCategory({ category: "", isKids: false })).toBe("Women");
  expect(getItemCategory({ category: 42 })).toBe("Women");
});

test("isKidsItem and size lists", () => {
  expect(isKidsItem({ isKids: true })).toBe(true);
  expect(isKidsItem({ category: "Men" })).toBe(false);
  expect(sizeOptionsFor("Kids")).toBe(KIDS_SIZE_OPTIONS);
  expect(sizeOptionsFor("Women")).toBe(WOMEN_SIZE_OPTIONS);
  expect(WOMEN_SIZE_OPTIONS).toEqual(["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL", "8XL"]);
  expect(KIDS_SIZE_OPTIONS).toHaveLength(15);
});

test("Men is not yet choosable on order forms", () => {
  expect(ORDER_CATEGORIES).toEqual(["Women", "Kids"]);
});
