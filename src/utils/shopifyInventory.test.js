import { normalizeShopifyId } from "./shopifyInventory";

// The stored shape is the FULL GID. Verified against the live catalogue rather
// than assumed: 120/121 products.shopify_product_id and 1000/1000
// product_variants.shopify_variant_id rows are gid://shopify/<Type>/<id>, so the
// deployed shopify-inventory edge function consumes GIDs. A save that wrote a
// bare number would silently stop that product syncing.
describe("normalizeShopifyId", () => {
  it("builds a Product GID from a bare number", () => {
    expect(normalizeShopifyId("728372828", "Product"))
      .toBe("gid://shopify/Product/728372828");
  });

  it("builds a ProductVariant GID from a bare number", () => {
    expect(normalizeShopifyId("46282452533437", "ProductVariant"))
      .toBe("gid://shopify/ProductVariant/46282452533437");
  });

  it("defaults to Product when no type is given", () => {
    expect(normalizeShopifyId("123")).toBe("gid://shopify/Product/123");
  });

  it("leaves an existing GID alone — the shape already in the catalogue", () => {
    const gid = "gid://shopify/Product/8171935793341";
    expect(normalizeShopifyId(gid, "Product")).toBe(gid);
  });

  // The bug this guards: rebuilding a GID from its trailing digits would retype
  // a variant GID as a product one, pointing the row at a different Shopify
  // object that may well exist.
  it("does not retype an existing GID to the requested type", () => {
    const variantGid = "gid://shopify/ProductVariant/46282452533437";
    expect(normalizeShopifyId(variantGid, "Product")).toBe(variantGid);
  });

  it("is idempotent, so re-saving cannot double-prefix", () => {
    const once = normalizeShopifyId("728372828", "Product");
    expect(normalizeShopifyId(once, "Product")).toBe(once);
    expect(once).toBe("gid://shopify/Product/728372828");
  });

  it("trims surrounding whitespace from a paste", () => {
    expect(normalizeShopifyId("  555  ", "Product")).toBe("gid://shopify/Product/555");
    expect(normalizeShopifyId("  gid://shopify/Product/555  "))
      .toBe("gid://shopify/Product/555");
  });

  it("returns empty string for blank/null rather than a bogus GID", () => {
    expect(normalizeShopifyId("", "Product")).toBe("");
    expect(normalizeShopifyId("   ", "Product")).toBe("");
    expect(normalizeShopifyId(null, "Product")).toBe("");
    expect(normalizeShopifyId(undefined, "Product")).toBe("");
  });

  // A value that is neither a GID nor a number reaches the DB as typed. Wrapping
  // it into gid://shopify/Product/not-a-gid would manufacture an id that looks
  // valid and resolves to nothing — worse than an obviously wrong value.
  it("passes an unrecognised value through unchanged", () => {
    expect(normalizeShopifyId("not-a-gid", "Product")).toBe("not-a-gid");
    expect(normalizeShopifyId("test", "Product")).toBe("test");
    // The malformed prefix (no namespace/type split) is NOT treated as a GID.
    expect(normalizeShopifyId("gid://shopifyProductVariant/123", "ProductVariant"))
      .toBe("gid://shopifyProductVariant/123");
  });
});
