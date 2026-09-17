import {
  productType, stockFor, stockStatus, sizesOut, sortSizes, buildVariantIndex, variantDuplicates, describeSizes, sizeLabel,
  buildPlacementIndex, placementFor, saleCandidates, assignedOrderLines, groupTransfers, rebalanceSuggestions, stockAgeing, productFacts,
  salesSummary, integrityFindings, integrityCount, stockOrderStatusLabel, isOpenStockOrder,
  TYPE_LXRTS, TYPE_CUSTOM, TYPE_MTO, UNLIMITED_SENTINEL,
} from "./stockRoomModel";

const lxrts = { id: "p1", sync_enabled: true, shopify_product_id: "gid://shopify/Product/111" };
const custom = { id: "p2", is_custom_piece: true, inventory: 4, available_size: ["L", "S", "M"] };
const mto = { id: "p3", inventory: UNLIMITED_SENTINEL };

describe("productType", () => {
  it("reads the two flags AddProduct writes", () => {
    expect(productType(lxrts)).toBe(TYPE_LXRTS);
    expect(productType(custom)).toBe(TYPE_CUSTOM);
    expect(productType(mto)).toBe(TYPE_MTO);
  });
  it("lets sync_enabled win if both flags are somehow set", () => {
    expect(productType({ sync_enabled: true, is_custom_piece: true })).toBe(TYPE_LXRTS);
  });
});

describe("describeSizes", () => {
  it("reads a full run as a range, ending at 6XL", () => {
    const d = describeSizes(["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"]);
    expect(d.text).toBe("XXS to 6XL");
    expect(d.count).toBe(11);
    expect(d.contiguous).toBe(true);
  });
  it("reads anything above 6XL as one Custom size", () => {
    const d = describeSizes(["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL", "8XL", "CUSTOM"]);
    expect(d.text).toBe("XXS to 6XL, Custom");
    expect(d.count).toBe(12);
    expect(d.extras).toEqual(["Custom"]);
    expect(sizeLabel("8xl")).toBe("Custom");
    expect(sizeLabel("XXL")).toBe("2XL");
  });
  it("splits gaps into runs, pairs two neighbours, and keeps off-scale sizes once", () => {
    const d = describeSizes(["S", "M", "L", "3XL", "4XL", "XXXL", "Custom", "CUSTOM"]);
    // XXXL folds onto 3XL; Custom appears once
    expect(d.text).toBe("S to L, 3XL, 4XL, Custom");
    expect(d.count).toBe(6);
    expect(d.contiguous).toBe(false);
    expect(d.labels).toEqual(["S", "M", "L", "3XL", "4XL", "Custom"]);
  });
  it("treats XXL and 2XL as one size", () => {
    expect(describeSizes(["XL", "XXL", "2XL"]).text).toBe("XL, 2XL");
  });
});

describe("sortSizes", () => {
  it("orders garment sizes, then unknowns alphabetically, without duplicates", () => {
    expect(sortSizes(["XL", "Free", "S", "3XL", "S", "M"])).toEqual(["S", "M", "XL", "3XL", "Free"]);
  });
});

describe("buildVariantIndex", () => {
  it("keeps the largest copy of a duplicated size instead of adding copies together", () => {
    const index = buildVariantIndex([
      { product_id: "p1", size: "M", inventory: 5 },
      { product_id: "p1", size: "M", inventory: 5 },
      { product_id: "p1", size: "S", inventory: 0 },
      { product_id: "p1", size: "S", inventory: 4 },
    ]);
    expect(index.p1).toEqual({ M: 5, S: 4 });
  });

  it("never lets a corrupted copy hide a real count", () => {
    const index = buildVariantIndex([
      { product_id: "p1", size: "M", inventory: 1073741824 },
      { product_id: "p1", size: "M", inventory: 2 },
    ]);
    expect(index.p1.M).toBe(2);
  });

  it("lists duplicated sizes per product", () => {
    const d = variantDuplicates([
      { product_id: "p1", size: "M", inventory: 5 },
      { product_id: "p1", size: "M", inventory: 0 },
      { product_id: "p1", size: "L", inventory: 1 },
    ]);
    expect(d).toEqual({ p1: [{ size: "M", counts: [5, 0] }] });
  });
});

describe("stockFor", () => {
  const index = buildVariantIndex([
    { product_id: "p1", size: "M", inventory: 3 },
    { product_id: "p1", size: "S", inventory: 0 },
    { product_id: "p1", size: "L", inventory: -2 },
    { product_id: "p1", size: "XL", inventory: 1610612736 },
  ]);

  it("totals LXRTS per size, leaving out negative and impossible counts", () => {
    const s = stockFor(lxrts, index);
    expect(s.total).toBe(3);
    expect(s.bySize).toEqual({ M: 3, S: 0, L: 0, XL: 0 });
    expect(s.sizes).toEqual(["S", "M", "L", "XL"]);
    expect(s.invalidSizes).toEqual(["L", "XL"]);
    expect(sizesOut(s)).toEqual(["S"]);
    expect(stockStatus(s)).toBe("low");
  });

  it("treats a Custom piece as one number with no per-size split", () => {
    const s = stockFor(custom, index);
    expect(s).toMatchObject({ tracked: true, unlimited: false, total: 4, bySize: null });
    expect(s.sizes).toEqual(["S", "M", "L"]);
  });

  it("flags a Custom piece on the 9999 sentinel as unlimited, never as 9999 units", () => {
    const s = stockFor({ ...custom, inventory: UNLIMITED_SENTINEL }, index);
    expect(s.total).toBe(0);
    expect(stockStatus(s)).toBe("unlimited");
  });

  it("never tracks Made to order", () => {
    const s = stockFor({ ...mto, inventory: 12 }, index);
    expect(s.tracked).toBe(false);
    expect(s.total).toBe(0);
    expect(stockStatus(s)).toBe("untracked");
  });
});

describe("salesSummary", () => {
  const now = new Date("2026-09-16T12:00:00Z").getTime();
  const orders = [
    { created_at: "2026-09-10T10:00:00Z", status: "order_received", items: [{ product_id: "p1", size: "M", quantity: 2 }] },
    { created_at: "2026-09-11T10:00:00Z", status: "cancelled", items: [{ product_id: "p1", size: "M", quantity: 5 }] },
    { created_at: "2026-09-12T10:00:00Z", is_stock_order: true, items: [{ product_id: "p1", size: "M", quantity: 9 }] },
    { created_at: "2026-01-01T10:00:00Z", items: [{ product_id: "p1", size: "S" }] },
  ];

  it("counts sales in the window, skipping cancelled and stock orders", () => {
    const s = salesSummary(orders, { days: 30, now });
    expect(s.units).toBe(2);
    expect(s.byProduct.p1.bySize).toEqual({ M: 2 });
  });

  it("defaults a missing quantity to 1", () => {
    expect(salesSummary(orders, { days: 365, now }).bySize.S).toBe(1);
  });
});

describe("integrityFindings", () => {
  const products = [
    lxrts,
    { id: "p4", sync_enabled: true, shopify_product_id: "gid://shopify/Product/111" },
    { id: "p5", sync_enabled: true, shopify_product_id: "test" },
    { id: "p6", inventory: 7 },
    { id: "p7", inventory: 9996 },
    mto,
  ];
  const variants = [
    { product_id: "p1", size: "M", inventory: 1 },
    { product_id: "p1", size: "M", inventory: 1 },
    { product_id: "p1", size: "L", inventory: 1073741824 },
  ];
  const f = integrityFindings(products, buildVariantIndex(variants), variants);

  it("finds duplicate and malformed Shopify IDs", () => {
    expect(f.duplicateShopifyIds).toHaveLength(1);
    expect(f.duplicateShopifyIds[0].products.map((p) => p.id)).toEqual(["p1", "p4"]);
    expect(f.malformedShopifyIds.map((p) => p.id)).toEqual(["p5"]);
    expect(f.lxrtsWithoutVariants.map((p) => p.id)).toEqual(["p4", "p5"]);
  });

  it("finds impossible counts and duplicated sizes from the raw rows", () => {
    expect(f.invalidVariants).toEqual([{ product: lxrts, size: "L", qty: 1073741824 }]);
    expect(f.duplicateSizes.map((d) => d.product.id)).toEqual(["p1"]);
  });

  it("lists small MTO counts for information, ignoring the 9999 value worn down by sales", () => {
    expect(f.mtoWithStock.map((p) => p.id)).toEqual(["p6"]);
    // 1 duplicate ID + 1 malformed + 2 without sizes + 1 invalid + 1 duplicated sizes; MTO not counted
    expect(integrityCount(f)).toBe(6);
  });
});

describe("stock order status", () => {
  it("names pending and blank as Order received, the same as StockOrdersTab", () => {
    expect(stockOrderStatusLabel("pending")).toBe("Order received");
    expect(stockOrderStatusLabel(null)).toBe("Order received");
    expect(isOpenStockOrder({ status: "order_received" })).toBe(true);
    expect(isOpenStockOrder({ status: "delivered" })).toBe(false);
  });
});

describe("placement", () => {
  const index = buildPlacementIndex([
    { product_id: "p1", size: "S", location_id: "delhi", qty: 2 },
    { product_id: "p1", size: "M", location_id: "ptat", qty: 3 },
    { product_id: "p2", size: "XL", location_id: "delhi", qty: 3 },
  ]);

  it("splits an LXRTS design into placed, unassigned and sales to assign, per size", () => {
    const stock = stockFor(lxrts, buildVariantIndex([
      { product_id: "p1", size: "S", inventory: 5 },
      { product_id: "p1", size: "M", inventory: 1 },
      { product_id: "p1", size: "L", inventory: 1073741824 },
    ]));
    const p = placementFor("p1", stock, index);
    expect(p.placedTotal).toBe(5);
    expect(p.byLocation).toEqual({ delhi: { S: 2 }, ptat: { M: 3 } });
    expect(p.unassignedBySize).toEqual({ S: 3 });
    expect(p.toAssignBySize).toEqual({ M: 2 });
    expect(p.unassigned).toBe(3);
    expect(p.toAssign).toBe(2);
  });

  it("treats a custom piece as one total across its sizes", () => {
    const stock = stockFor({ ...custom, id: "p2", inventory: 4 }, {});
    const p = placementFor("p2", stock, index);
    expect(p.unassigned).toBe(1);
    expect(p.toAssign).toBe(0);
    expect(p.byLocation).toEqual({ delhi: { XL: 3 } });
  });

  it("has nothing to place for made to order", () => {
    expect(placementFor("p3", stockFor(mto, {}), index).unassigned).toBe(0);
  });
});

describe("saleCandidates", () => {
  const locations = [
    { id: "delhi", is_active: true, order_prefixes: ["DLC"] },
    { id: "ldh", is_active: true, order_prefixes: ["LDHC"] },
  ];
  const orders = [
    { id: "o1", order_no: "SB-DLC-0926-000001", created_at: "2026-09-10T10:00:00Z", items: [{ product_id: "p1", size: "S", quantity: 1 }] },
    { id: "o2", order_no: "SB-SHOPIFY-0926-000002", created_at: "2026-09-12T10:00:00Z", items: [{ product_id: "p1", size: "S" }, { product_id: "p1", size: "M" }] },
    { id: "o3", order_no: "SB-LDHC-0926-000003", created_at: "2026-09-13T10:00:00Z", status: "cancelled", items: [{ product_id: "p1", size: "S" }] },
    { id: "o4", order_no: "SB-STOCK-0926-000004", created_at: "2026-09-14T10:00:00Z", is_stock_order: true, items: [{ product_id: "p1", size: "S" }] },
  ];

  it("lists matching lines newest first, suggesting the store by order prefix", () => {
    const c = saleCandidates({ productId: "p1", size: "S", isCustom: false }, orders, new Set(), locations);
    expect(c.map((x) => x.order.id)).toEqual(["o2", "o1"]);
    expect(c[1].suggestedLocationId).toBe("delhi");
    expect(c[0].suggestedLocationId).toBeNull();
  });

  it("skips lines already assigned", () => {
    const assigned = assignedOrderLines([{ reason: "sale_assignment", order_id: "o1", order_line: 0 }]);
    expect(saleCandidates({ productId: "p1", size: "S" }, orders, assigned, locations).map((x) => x.order.id)).toEqual(["o2"]);
  });
});

describe("groupTransfers", () => {
  it("pairs the two legs of each transfer", () => {
    const g = groupTransfers([
      { id: 1, transfer_id: "t1", reason: "transfer_out", location_id: "delhi", delta: -2, product_id: "p1", size: "S", occurred_at: "2026-09-10T10:00:00Z" },
      { id: 2, transfer_id: "t1", reason: "transfer_in", location_id: "ptat", delta: 2, product_id: "p1", size: "S", occurred_at: "2026-09-10T10:00:00Z" },
      { id: 3, reason: "sale", location_id: "delhi", delta: -1 },
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ from: "delhi", to: "ptat", units: 2 });
  });
});

describe("transfers in transit", () => {
  const T = "transit";
  const rows = [
    { id: 1, transfer_id: "t1", reason: "transfer_out", location_id: "delhi", delta: -2, product_id: "p1", size: "S", occurred_at: "2026-09-10T10:00:00Z" },
    { id: 2, transfer_id: "t1", reason: "transfer_in", location_id: T, destination_id: "ptat", delta: 2, product_id: "p1", size: "S", occurred_at: "2026-09-10T10:00:00Z" },
  ];
  it("is in transit until received", () => {
    expect(groupTransfers(rows, T)[0]).toMatchObject({ from: "delhi", to: "ptat", units: 2, status: "transit" });
  });
  it("is received once the units leave transit for the destination", () => {
    const g = groupTransfers([...rows,
      { id: 3, transfer_id: "t1", reason: "transfer_out", location_id: T, delta: -2, product_id: "p1", size: "S", occurred_at: "2026-09-12T10:00:00Z" },
      { id: 4, transfer_id: "t1", reason: "transfer_in", location_id: "ptat", delta: 2, product_id: "p1", size: "S", occurred_at: "2026-09-12T10:00:00Z" },
    ], T)[0];
    expect(g).toMatchObject({ from: "delhi", to: "ptat", units: 2, status: "received", receivedAt: "2026-09-12T10:00:00Z" });
  });
});

describe("rebalance, ageing and product facts", () => {
  const locations = [
    { id: "delhi", kind: "store", name: "Delhi" }, { id: "ldh", kind: "store", name: "Ludhiana" },
    { id: "wh", kind: "warehouse", name: "PTAT" }, { id: "transit", kind: "transit", name: "In transit" },
  ];
  const index = buildPlacementIndex([
    { product_id: "p1", size: "M", location_id: "wh", qty: 3 },
    { product_id: "p1", size: "M", location_id: "delhi", qty: 1 },
  ]);
  const stock = stockFor(lxrts, buildVariantIndex([{ product_id: "p1", size: "M", inventory: 5 }]));
  const row = { id: "p1", stock };
  const placement = placementFor("p1", stock, index);

  it("suggests moving a size into a store that has none", () => {
    const s = rebalanceSuggestions({ tracked: [row], placementById: { p1: placement }, locations, salesByProduct: {} });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ size: "M", have: 3 });
    expect(s[0].from.id).toBe("wh");
    expect(s[0].to.id).toBe("ldh");
  });

  it("ages units by when they last arrived", () => {
    const now = new Date("2026-09-16T00:00:00Z").getTime();
    const b = stockAgeing([
      { location_id: "wh", product_id: "p1", size: "M", delta: 3, occurred_at: "2026-01-01T00:00:00Z" },
      { location_id: "delhi", product_id: "p1", size: "M", delta: 1, occurred_at: "2026-09-10T00:00:00Z" },
    ], index, "transit", now);
    expect(b.find((x) => x.key === "0-30").units).toBe(1);
    expect(b.find((x) => x.key === "180+").units).toBe(3);
  });

  it("lists on-hand facts by location, with unassigned", () => {
    const byId = Object.fromEntries(locations.map((l) => [l.id, l]));
    const f = productFacts({ row, placement, locationsById: byId, transitId: "transit", measure: "onhand" });
    expect(f).toEqual(expect.arrayContaining([
      { location: "PTAT", size: "M", value: 3 }, { location: "Delhi", size: "M", value: 1 }, { location: "Unassigned", size: "M", value: 1 },
    ]));
  });

  it("splits order sales into assigned locations and the rest", () => {
    const now = new Date("2026-09-16T00:00:00Z").getTime();
    const byId = Object.fromEntries(locations.map((l) => [l.id, l]));
    const f = productFacts({
      row, placement, locationsById: byId, transitId: "transit", measure: "sold", now,
      orderSalesBySize: { M: 3 },
      movements: [{ product_id: "p1", reason: "sale_assignment", location_id: "delhi", size: "M", delta: -1, occurred_at: "2026-09-12T00:00:00Z" }],
    });
    expect(f).toEqual(expect.arrayContaining([{ location: "Delhi", size: "M", value: 1 }, { location: "Not assigned", size: "M", value: 2 }]));
  });
});
