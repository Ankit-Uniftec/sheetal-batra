// Self-check for the USA mapper rules (Release 19).
// Run (Node 22.6+ strips the TypeScript types itself):
//   node supabase/functions/shopify-order-sync-usa/usa.test.mjs
import assert from "node:assert/strict";
import {
  mapShopifyOrder,
  setStoreTimezone,
  timelineDays,
  toStoreLocalIso,
} from "./mapper.ts";

const money = (a) => ({ shopMoney: { amount: String(a) } });
const order = ({ createdAt, phone, timelines }) => ({
  id: "gid://shopify/Order/9001",
  name: "#1001",
  createdAt,
  displayFinancialStatus: "PAID",
  phone,
  email: "us.customer@example.com",
  tags: [],
  paymentGatewayNames: ["shopify_payments"],
  totalPriceSet: money(30000),
  totalDiscountsSet: money(0),
  subtotalPriceSet: money(30000),
  totalTaxSet: money(0),
  totalShippingPriceSet: money(0),
  shippingAddress: { name: "Jane Doe", city: "New York", province: "New York", country: "United States", zip: "10001" },
  lineItems: {
    edges: timelines.map((t, i) => ({
      node: {
        id: `gid://shopify/LineItem/${i}`,
        title: "Aadah - White Kurta Set",
        quantity: 1,
        requiresShipping: true,
        originalUnitPriceSet: money(30000),
        discountedUnitPriceSet: money(30000),
        variant: {
          id: `gid://shopify/ProductVariant/${i}`,
          selectedOptions: [{ name: "Size", value: "M" }, { name: "Color", value: "White" }, { name: "Style", value: "With Dupatta" }],
          product: {
            id: `gid://shopify/Product/${i}`,
            title: "Aadah - White Kurta Set",
            tags: [],
            topStyle: { value: "Kurta" },
            bottomStyle: { value: "Salwar" },
            shipTimeline: t == null ? null : { value: t },
          },
        },
      },
    })),
  },
});

// 1. timeline parsing
assert.equal(timelineDays("15-20 days"), 20);
assert.equal(timelineDays("3 weeks"), 21);
assert.equal(timelineDays("Ships in 4-6 weeks"), 42);
assert.equal(timelineDays("20"), 20);
assert.equal(timelineDays(""), null);
assert.equal(timelineDays("soon"), null);
assert.equal(timelineDays("900 days"), null);

// 2. store-local time with offset (EDT in October, EST in January)
assert.equal(toStoreLocalIso("2026-10-20T01:30:00Z", "America/New_York"), "2026-10-19T21:30:00-04:00");
assert.equal(toStoreLocalIso("2026-01-15T01:30:00Z", "America/New_York"), "2026-01-14T20:30:00-05:00");
assert.equal(toStoreLocalIso("2026-10-20T01:30:00Z", ""), null);

setStoreTimezone("America/New_York");

// 3. a US order placed 19 Oct 9:30 PM New York (= 20 Oct 01:30 UTC = 07:00 IST)
const a = mapShopifyOrder(order({ createdAt: "2026-10-20T01:30:00Z", phone: "(212) 555-1234", timelines: ["15-20 days", "3 weeks"] })).orderRow;
assert.equal(a.created_at, "2026-10-20T07:00:00");                 // common (IST) clock — unchanged rule
assert.equal(a.shopify_created_at_local, "2026-10-19T21:30:00-04:00"); // as the US store shows it
assert.equal(a.shopify_timezone, "America/New_York");
assert.equal(a.shopify_store, "usa");
assert.equal(a.delivery_date, "2026-11-09");                         // US date 19 Oct + 21 days (longest)
assert.equal(a.delivery_phone, "(212) 555-1234");                    // exactly as Shopify gives it
assert.equal(a.profile_phone, "+12125551234");                       // login key only

// 4. phone already in E.164 stays as-is in both places
const b = mapShopifyOrder(order({ createdAt: "2026-10-20T01:30:00Z", phone: "+12125550000", timelines: ["20 days"] })).orderRow;
assert.equal(b.delivery_phone, "+12125550000");
assert.equal(b.profile_phone, "+12125550000");

// 5. no timeline anywhere → price band from the US date, and the basis says so
const c = mapShopifyOrder(order({ createdAt: "2026-10-20T01:30:00Z", phone: "+12125550000", timelines: [null] })).orderRow;
assert.equal(c.delivery_date, "2026-11-03");                         // ₹30,000 → 25-40k band 15d from 19 Oct
const basis = (c.web_order_issues || []).find((i) => i.code === "DELIVERY_DATE_DERIVED")?.detail || "";
assert.match(basis, /shipping_timeline missing/);

console.log("usa.test.mjs: all checks passed");
