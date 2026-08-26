import { poolsForUser, canSeeStock, POOL_DEFS } from "./stockVisibility";

// The one check that fails if the role→pools map breaks. Written against the
// requirement as stated, role by role, so a future edit that widens someone's
// visibility has to change this file too.

const sorted = (a) => [...a].sort();

describe("poolsForUser", () => {
  const FULL = [
    "delhi",
    "ludhiana",
    "factory",
    "retail_stock",
    "b2b_stock",
    "shopify_stock",
    "consignment",
  ];

  test("group 1 — leadership + inventory desk see every pool", () => {
    ["admin", "assistant_cmo", "gm", "coo", "ceo", "inventory"].forEach((role) => {
      expect(sorted(poolsForUser({ role }))).toEqual(sorted(FULL));
    });
  });

  test("group 2 — store managers: both stores + factory + retail, no B2B/Shopify", () => {
    const p = poolsForUser({ role: "store_manager" });
    expect(sorted(p)).toEqual(sorted(["delhi", "ludhiana", "factory", "retail_stock"]));
    expect(p).not.toContain("b2b_stock");
    expect(p).not.toContain("shopify_stock");
    expect(p).not.toContain("consignment");
  });

  test("group 3 — retail manager adds B2B stock + consignment, still no Shopify", () => {
    const p = poolsForUser({ role: "retail_manager" });
    expect(sorted(p)).toEqual(
      sorted(["delhi", "ludhiana", "factory", "retail_stock", "b2b_stock", "consignment"])
    );
    expect(p).not.toContain("shopify_stock");
  });

  test("group 4 — production manager: factory + all three channel pools, no shop floors", () => {
    const p = poolsForUser({ role: "production_manager" });
    expect(sorted(p)).toEqual(
      sorted(["factory", "retail_stock", "b2b_stock", "shopify_stock"])
    );
    expect(p).not.toContain("delhi");
    expect(p).not.toContain("ludhiana");
  });

  test("group 5 — Prastuti (merchandiser) sees B2B only", () => {
    const p = poolsForUser({ role: "merchandiser" });
    expect(sorted(p)).toEqual(sorted(["b2b_stock", "consignment"]));
    expect(p).not.toContain("retail_stock");
    expect(p).not.toContain("delhi");
  });

  test("groups 6/7 — an SA sees their OWN store plus retail, never the other store", () => {
    const delhi = poolsForUser({ role: "salesperson", store_name: "Delhi Store" });
    expect(sorted(delhi)).toEqual(sorted(["delhi", "retail_stock"]));
    expect(delhi).not.toContain("ludhiana");

    const ludhiana = poolsForUser({ role: "salesperson", store_name: "Ludhiana Store" });
    expect(sorted(ludhiana)).toEqual(sorted(["ludhiana", "retail_stock"]));
    expect(ludhiana).not.toContain("delhi");
  });

  test("SA store_name is normalized, not compared literally", () => {
    // normalizeStore already handles the codes the data actually carries.
    ["DLC", "delhi", "Delhi"].forEach((s) => {
      expect(poolsForUser({ role: "salesperson", store_name: s })).toContain("delhi");
    });
    ["LDHC", "ludhiana", "Ludhiana Store"].forEach((s) => {
      expect(poolsForUser({ role: "salesperson", store_name: s })).toContain("ludhiana");
    });
  });

  test("an SA with an unresolvable store gets retail only — never another store's shelf", () => {
    [undefined, "", "Exhibition", "Private", "B2B"].forEach((store_name) => {
      const p = poolsForUser({ role: "salesperson", store_name });
      expect(p).toEqual(["retail_stock"]);
    });
  });

  test("sa_services is store-scoped the same way as salesperson", () => {
    expect(sorted(poolsForUser({ role: "sa_services", store_name: "Delhi Store" })))
      .toEqual(sorted(["delhi", "retail_stock"]));
  });

  test("unknown / missing roles see nothing — default deny", () => {
    [{ role: "scan_station" }, { role: "accountant" }, { role: "" }, {}, null].forEach((u) => {
      expect(poolsForUser(u)).toEqual([]);
      expect(canSeeStock(u)).toBe(false);
    });
  });

  test("role matching is case- and whitespace-insensitive", () => {
    expect(poolsForUser({ role: " CEO " }).length).toBe(7);
  });

  test("every pool a role can name is defined in POOL_DEFS", () => {
    ["admin", "store_manager", "retail_manager", "production_manager", "merchandiser"].forEach(
      (role) => {
        poolsForUser({ role }).forEach((key) => {
          expect(POOL_DEFS[key]).toBeDefined();
          expect(POOL_DEFS[key].kind).toBeTruthy();
          expect(POOL_DEFS[key].label).toBeTruthy();
        });
      }
    );
  });
});
