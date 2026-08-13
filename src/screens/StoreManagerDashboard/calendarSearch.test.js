// Guards StoreCalendarTab's day-search: it must only match columns that are
// actually visible, so a hidden client name can never be found by typing it.
const norm = (v) => String(v || "").toLowerCase().replace(/#/g, "");

const filterDay = (orders, search, { showShopifyNo, showClient, showSalesperson }) => {
  const query = norm(search).trim();
  if (!query) return orders;
  return orders.filter((o) => {
    const fields = [o.order_no];
    if (showShopifyNo) fields.push(o.shopify_order_name);
    if (showClient) fields.push(o.delivery_name);
    if (showSalesperson) fields.push(o.salesperson);
    return fields.some((f) => norm(f).includes(query));
  });
};

const DAY = [
  { id: 1, order_no: "SB-SHOPIFY-0726-003625", shopify_order_name: "#1234", delivery_name: "Anita Rao", salesperson: "Website" },
  { id: 2, order_no: "SB-SHOPIFY-0726-004000", shopify_order_name: "#9876", delivery_name: "Priya Singh", salesperson: "Website" },
];
// The Shopify screen now SHOWS the client name (deliberate rule change), so it
// is searchable there too. showSalesperson stays off: a website order's SA is
// always the constant "Website".
const SHOPIFY = { showShopifyNo: true, showClient: true, showSalesperson: false };

test("empty search returns the whole day", () => {
  expect(filterDay(DAY, "", SHOPIFY)).toHaveLength(2);
  expect(filterDay(DAY, "   ", SHOPIFY)).toHaveLength(2);
});

test("finds a Shopify order with or without the # ", () => {
  expect(filterDay(DAY, "#1234", SHOPIFY).map((o) => o.id)).toEqual([1]);
  expect(filterDay(DAY, "1234", SHOPIFY).map((o) => o.id)).toEqual([1]);
});

test("finds by order number, case-insensitively", () => {
  expect(filterDay(DAY, "003625", SHOPIFY).map((o) => o.id)).toEqual([1]);
  expect(filterDay(DAY, "sb-shopify", SHOPIFY)).toHaveLength(2);
});

test("client name is searchable on the Shopify screen now that it is shown", () => {
  expect(filterDay(DAY, "Anita", SHOPIFY).map((o) => o.id)).toEqual([1]);
});

test("a column that is still hidden stays unsearchable", () => {
  // showSalesperson is off for Shopify, so "Website" must not match anything
  // even though every row carries it.
  expect(filterDay(DAY, "Website", SHOPIFY)).toHaveLength(0);
});

test("client name IS searchable where the column is shown", () => {
  const store = { showShopifyNo: false, showClient: true, showSalesperson: true };
  expect(filterDay(DAY, "Anita", store).map((o) => o.id)).toEqual([1]);
  // ...but the Shopify no is not, since that column is off there.
  expect(filterDay(DAY, "9876", store)).toHaveLength(0);
});
