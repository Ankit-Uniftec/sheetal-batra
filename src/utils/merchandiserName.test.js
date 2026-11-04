import { cleanMerchandiserName, uniqueMerchandiserNames, isSameMerchandiser } from "./merchandiserName";

test("stray spaces do not change who it is", () => {
  expect(cleanMerchandiserName("Prastuti Kaushik ")).toBe("Prastuti Kaushik");
  expect(cleanMerchandiserName("  Tanuja   Singh")).toBe("Tanuja Singh");
  expect(isSameMerchandiser("Prastuti Kaushik ", "Prastuti Kaushik")).toBe(true);
  expect(isSameMerchandiser("Prastuti Kaushik", "Tanuja Singh")).toBe(false);
});

test("missing names stay empty", () => {
  expect(cleanMerchandiserName(null)).toBe("");
  expect(cleanMerchandiserName(undefined)).toBe("");
  expect(cleanMerchandiserName("   ")).toBe("");
});

test("the filter lists each person once, sorted, without blanks", () => {
  const orders = [
    { merchandiser_name: "Prastuti Kaushik " },
    { merchandiser_name: "Tanuja Singh" },
    { merchandiser_name: "Prastuti Kaushik" },
    { merchandiser_name: "Khushi Bansal" },
    { merchandiser_name: null },
    {},
  ];
  expect(uniqueMerchandiserNames(orders)).toEqual(["Khushi Bansal", "Prastuti Kaushik", "Tanuja Singh"]);
  expect(uniqueMerchandiserNames(undefined)).toEqual([]);
});
