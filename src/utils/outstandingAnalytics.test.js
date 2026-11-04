import { isOutstanding, daysPastDelivery, ageBucket, buildOutstanding, matchesOutstandingSearch, filterOutstanding, summariseOutstanding } from "./outstandingAnalytics";

const TODAY = new Date(2026, 10, 4);
const order = (over = {}) => ({
  id: "1", order_no: "SB-DLC-1126-000001", status: "order_received", delivery_date: "2026-11-10",
  salesperson: "Asha ", salesperson_store: "Delhi Store", net_total: 1000, total_paid: 400, remaining_payment: 600,
  ...over,
});

test("a store order with a balance counts", () => {
  expect(isOutstanding(order())).toBe(true);
  expect(isOutstanding(order({ order_no: "SB-EXB-1126-000001" }))).toBe(true);
});

test.each([
  ["nothing due", { remaining_payment: 0 }],
  ["B2B flag", { is_b2b: true }],
  ["B2B number", { order_no: "SB-B2B-1126-000001" }],
  ["website", { order_no: "SB-SHOPIFY-1126-000001" }],
  ["Comms", { is_comms: true }],
  ["stock", { is_stock_order: true }],
  ["stock number", { order_no: "SB-STOCK-1126-000001" }],
  ["alteration", { is_alteration: true }],
  ["cancelled", { status: "cancelled" }],
  ["revoked", { status: "Revoked" }],
  ["returned", { status: "returned" }],
  ["refund", { refund_status: "pending" }],
])("not counted: %s", (_, over) => {
  expect(isOutstanding(order(over))).toBe(false);
});

test("days past delivery by calendar day", () => {
  expect(daysPastDelivery(order({ delivery_date: "2026-11-04" }), TODAY)).toBe(0);
  expect(daysPastDelivery(order({ delivery_date: "2026-11-05T10:00:00" }), TODAY)).toBe(-1);
  expect(daysPastDelivery(order({ delivery_date: "2026-10-04" }), TODAY)).toBe(31);
  expect(daysPastDelivery(order({ delivery_date: null }), TODAY)).toBeNull();
});

test("age buckets at their edges", () => {
  expect([null, -1, 0, 30, 31, 60, 61].map(ageBucket)).toEqual(
    ["not_due", "not_due", "d0_30", "d0_30", "d31_60", "d31_60", "d60"]
  );
});

test("totals, ageing and splits add up, oldest first", () => {
  const out = buildOutstanding([
    order({ id: "a" }),
    order({ id: "b", delivery_date: "2026-08-01", salesperson: "Asha", remaining_payment: 900 }),
    order({ id: "c", delivery_date: "2026-10-20", salesperson: "Bina", salesperson_store: "Ludhiana Store", remaining_payment: 100 }),
    order({ id: "d", status: "cancelled" }),
  ], TODAY);
  expect(out.count).toBe(3);
  expect(out.total).toBe(1600);
  expect(out.rows.map((r) => r.id)).toEqual(["b", "c", "a"]);
  expect(out.rows[0].order.id).toBe("b"); // the full row, so a click can open the order
  expect(out.buckets.map((b) => [b.key, b.count, b.value])).toEqual([
    ["not_due", 1, 600], ["d0_30", 1, 100], ["d31_60", 0, 0], ["d60", 1, 900],
  ]);
  expect(out.bySa[0]).toMatchObject({ key: "Asha", count: 2, value: 1500, overdue60: 900 });
  expect(out.byStore.map((s) => s.key)).toEqual(["Delhi Store", "Ludhiana Store"]);
});

test("an empty or missing list is safe", () => {
  expect(buildOutstanding(undefined, TODAY)).toMatchObject({ count: 0, total: 0 });
});

test("search matches order number, customer, SA, store and status, ignoring case and spaces", () => {
  const row = { orderNo: "SB-DLC-0926-007646", customer: "Divya Khullar", sa: "Asha", store: "Delhi Store", status: "completed" };
  ["007646", " divya ", "ASHA", "delhi", "complet", ""].forEach((q) => expect(matchesOutstandingSearch(row, q)).toBe(true));
  ["ludhiana", "99999"].forEach((q) => expect(matchesOutstandingSearch(row, q)).toBe(false));
  expect(matchesOutstandingSearch({ orderNo: "SB-1" }, "khullar")).toBe(false); // missing fields are safe
});

test("filters narrow the rows, and the totals follow them", () => {
  const { rows } = buildOutstanding([
    order({ id: "a", created_at: "2026-11-01T10:00:00Z" }),
    order({ id: "b", salesperson: "Bina", salesperson_store: "Ludhiana Store", status: "completed", remaining_payment: 900, delivery_date: "2026-08-01", created_at: "2026-07-20T10:00:00Z" }),
  ], TODAY);
  const ids = (f) => filterOutstanding(rows, f).map((r) => r.id).sort();
  expect(ids({})).toEqual(["a", "b"]);
  expect(ids({ sa: "Bina" })).toEqual(["b"]);
  expect(ids({ store: "Delhi Store" })).toEqual(["a"]);
  expect(ids({ status: "completed" })).toEqual(["b"]);
  expect(ids({ search: "ludhiana" })).toEqual(["b"]);
  expect(ids({ inPeriod: (d) => d >= "2026-11-01" })).toEqual(["a"]);
  expect(filterOutstanding(undefined)).toEqual([]);

  const s = summariseOutstanding(filterOutstanding(rows, { sa: "Bina" }));
  expect(s).toMatchObject({ count: 1, total: 900 });
  expect(s.buckets.find((b) => b.key === "d60")).toMatchObject({ count: 1, value: 900 });
  expect(s.buckets.find((b) => b.key === "not_due")).toMatchObject({ count: 0, value: 0 });
});
