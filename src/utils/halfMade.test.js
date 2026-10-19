jest.mock("../lib/supabaseClient", () => ({ supabase: {} }));
jest.mock("./fetchAllRows", () => ({ fetchAllRows: jest.fn() }));
import { rankHalfMadeFor, isProductionRole, validatePhoto } from "./halfMade";

const hm = (id, extra) => ({ id, status: "available", component_type: "top", moved_at: `2026-10-1${id}`, ...extra });

test("only available pieces of the same type, best match first", () => {
  const target = { component_type: "top" };
  const item = { product_name: "Mohsina - Orange Short Kalidaar Choga", size: "L", top_color: { name: "Orange" } };
  const pieces = [
    hm(1, { product_name: "Aabish Kurta", colors: "Pink", size: "M" }),
    hm(2, { product_name: "Mohsina - Orange Short Kalidaar Choga", colors: "Orange", size: "XL" }),
    hm(3, { product_name: "Mohsina Choga (Lxrts)", colors: "Pink / Orange", size: "L" }),
    hm(4, { product_name: "Mohsina - Orange Short Kalidaar Choga", status: "used" }),
    hm(5, { product_name: "Mohsina - Orange Short Kalidaar Choga", component_type: "bottom" }),
  ];
  const ranked = rankHalfMadeFor(target, item, pieces);
  expect(ranked.map((r) => r.piece.id)).toEqual([2, 3, 1]);
  expect(ranked[0].why).toEqual(["same product", "same colour"]);
  expect(ranked[1].why).toContain("same size");
});

test("roles and photo rules", () => {
  expect(isProductionRole("warehouse")).toBe(true);
  expect(isProductionRole("scan_station")).toBe(true);
  expect(isProductionRole("salesperson")).toBe(false);
  expect(validatePhoto({ type: "application/pdf", size: 10 })).toMatch(/JPEG or PNG/);
  expect(validatePhoto({ type: "image/png", size: 6 * 1048576 })).toMatch(/5 MB/);
  expect(validatePhoto({ type: "image/jpeg", size: 1000 })).toBeNull();
});
