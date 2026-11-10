import { countDifferences, exactTargets, jobIsHealthy } from "./stockRoomShopify";

describe("exactTargets — only a full recount sets Shopify to an exact number", () => {
  const base = { productId: "p1", size: " XL ", counted: 7 };

  it("full recount (no location) → exact target for that size", () => {
    expect(exactTargets({ ...base, mode: "adjust", locationId: "" })).toEqual({ "p1|xl": 7 });
    expect(exactTargets({ ...base, mode: "adjust", locationId: null })).toEqual({ "p1|xl": 7 });
  });

  it("recount of one location stays a change (nobody counted the whole size)", () => {
    expect(exactTargets({ ...base, mode: "adjust", locationId: "loc-1" })).toEqual({});
  });

  it("sales and receipts stay changes", () => {
    expect(exactTargets({ ...base, mode: "sell", locationId: "" })).toEqual({});
    expect(exactTargets({ ...base, mode: "receive", locationId: "" })).toEqual({});
  });

  it("a counted 0 is a real target; nonsense is ignored", () => {
    expect(exactTargets({ ...base, mode: "adjust", locationId: "", counted: 0 })).toEqual({ "p1|xl": 0 });
    expect(exactTargets({ ...base, mode: "adjust", locationId: "", counted: -1 })).toEqual({});
    expect(exactTargets({ ...base, mode: "adjust", locationId: "", counted: "x" })).toEqual({});
    expect(exactTargets({ mode: "adjust", locationId: "", counted: 3 })).toEqual({});
  });
});

describe("countDifferences — what a Shopify read changed", () => {
  const rows = [
    { size: "S", inventory: 2 },
    { size: "M", inventory: 0 },
    { size: "L", inventory: 4 },
  ];
  it("counts sizes that differ; a size missing from Shopify's list is 0 there", () => {
    expect(countDifferences(rows, { S: 2, L: 4 })).toBe(0);
    expect(countDifferences(rows, { S: 1, L: 4 })).toBe(1);
    expect(countDifferences(rows, { S: 2 })).toBe(1); // L sold out on Shopify
    expect(countDifferences(rows, { S: 2, M: 3, L: 4 })).toBe(1);
  });
  it("a size stored twice is compared as one total (not a change)", () => {
    const dup = [{ size: "S", inventory: 1 }, { size: "S", inventory: 1 }, { size: "M", inventory: 3 }];
    expect(countDifferences(dup, { S: 2, M: 3 })).toBe(0);
    expect(countDifferences(dup, { S: 1, M: 3 })).toBe(1);
  });
});

describe("jobIsHealthy — skip the page's own Shopify read while the job runs", () => {
  const now = Date.parse("2026-11-10T10:00:00Z");
  it("a good run under 5 minutes ago is healthy", () => {
    expect(jobIsHealthy({ last_ok_at: "2026-11-10T09:58:30Z" }, now)).toBe(true);
  });
  it("older, missing or never-run is not", () => {
    expect(jobIsHealthy({ last_ok_at: "2026-11-10T09:54:00Z" }, now)).toBe(false);
    expect(jobIsHealthy({ last_ok_at: null }, now)).toBe(false);
    expect(jobIsHealthy(null, now)).toBe(false);
  });
});
