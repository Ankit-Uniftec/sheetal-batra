import {
  birthdaysSoon, briefItems, cashIn, cityBoard, clientConcentration, clientProfile, dayHeat, deliveryPromise, designProfile, dueSoonBoard, exhibitionBoard, healthBoard,
  monthlySeries, orderBook, priceBands, slowDesigns, targetCoach, todayPulse, vendorBoard, walkinFunnel,
} from "./ceoOwner";

const NOW = new Date(2026, 10, 5, 12, 0, 0);
const iso = (y, m, d, h = 10) => new Date(y, m, d, h).toISOString();
const order = (extra = {}) => ({ id: Math.random().toString(36), status: "order_received", net_total: 1000, created_at: iso(2026, 10, 5), items: [], ...extra });
const all = () => true;

test("today is compared with the same weekday last week, up to the same time", () => {
  const p = todayPulse([
    order({ net_total: 300 }),
    order({ net_total: 200, created_at: iso(2026, 9, 29, 11) }),
    order({ net_total: 999, created_at: iso(2026, 9, 29, 15) }), // later in the day than now
    order({ net_total: 50, created_at: iso(2026, 10, 4) }),
  ], NOW);
  expect(p.today.revenue).toBe(300);
  expect(p.lastWeek.revenue).toBe(200);
  expect(p.yesterday.revenue).toBe(50);
  expect(p.growth).toBe(50);
});

test("the order book splits what is late from what is due", () => {
  const b = orderBook([
    order({ net_total: 100, delivery_date: iso(2026, 10, 1) }),
    order({ net_total: 200, delivery_date: iso(2026, 10, 8) }),
    order({ net_total: 400, delivery_date: iso(2026, 10, 25) }),
    order({ net_total: 800, delivery_date: iso(2026, 10, 8), status: "delivered" }),
    order({ net_total: 900, delivery_date: iso(2026, 10, 8), status: "cancelled" }),
  ], NOW);
  expect(b.count).toBe(3);
  expect(b.lateValue).toBe(100);
  expect(b.dueWeekValue).toBe(200);
  expect(b.dueMonthValue).toBe(400);
});

test("cash counts advances and later payments, never legacy adjustments", () => {
  const a = order({ id: "a", total_paid: 1000, payment_mode: "UPI" });
  const b = order({ id: "b", total_paid: 500, created_at: iso(2026, 1, 1) });
  const c = cashIn([a, b], [
    { order_id: "a", amount: 400, paid_at: "2026-11-02", payment_mode: "Cash" },
    { order_id: "b", amount: 500, paid_at: "2026-11-03", payment_mode: "Legacy adjustment" },
  ], (ts) => new Date(ts) >= new Date(2026, 10, 1));
  expect(c.atOrder).toBe(600); // 1000 paid, 400 of it collected later
  expect(c.later).toBe(400);
  expect(c.total).toBe(1000);
  expect(c.modes.map((m) => m.name)).toEqual(["UPI", "Cash"]);
});

test("delivery promise counts a delivery on the promised day as on time", () => {
  const d = deliveryPromise([
    order({ created_at: iso(2026, 9, 1), delivered_at: iso(2026, 10, 3, 18), delivery_date: "2026-11-03" }),
    order({ created_at: iso(2026, 9, 1), delivered_at: iso(2026, 10, 5), delivery_date: "2026-11-03" }),
  ], all);
  expect(d.delivered).toBe(2);
  expect(d.onTime).toBe(1);
  expect(d.rate).toBe(50);
});

test("price bands add up to all sales", () => {
  const rows = priceBands([order({ net_total: 10000 }), order({ net_total: 75000 }), order({ net_total: 300000 })]);
  expect(rows.map((r) => r.count)).toEqual([1, 0, 1, 0, 1]);
  expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(100);
});

test("cities tidy their names and count clients abroad", () => {
  const c = cityBoard([
    order({ delivery_city: " delhi", delivery_phone: "1", delivery_country: "India" }),
    order({ delivery_city: "DELHI", delivery_phone: "1", delivery_country: "India" }),
    order({ delivery_city: "London", delivery_phone: "2", delivery_country: "UK" }),
  ]);
  expect(c.rows[0]).toMatchObject({ name: "Delhi", clients: 1, revenue: 2000 });
  expect(c.abroadCount).toBe(1);
});

test("months come back oldest first, including empty ones", () => {
  const m = monthlySeries([order({ net_total: 500 })], NOW, 3);
  expect(m.map((x) => x.name)).toEqual(["Sep 26", "Oct 26", "Nov 26"]);
  expect(m[2].revenue).toBe(500);
  expect(m[0].revenue).toBe(0);
});

test("the sales calendar never shows a future day", () => {
  const h = dayHeat([order({ net_total: 700 })], NOW, 4);
  const days = h.cols.flat().filter(Boolean);
  expect(days[days.length - 1].key).toBe("2026-11-05");
  expect(h.max).toBe(700);
});

test("slow designs skip new, draft and custom pieces", () => {
  const old = iso(2026, 0, 1);
  const rows = slowDesigns([
    { id: 1, name: "Sold lately", created_at: old },
    { id: 2, name: "Quiet", created_at: old },
    { id: 3, name: "Brand new", created_at: iso(2026, 10, 1) },
    { id: 4, name: "Draft", created_at: old, is_draft: true },
    { id: 5, name: "Custom", created_at: old, is_custom_piece: true },
  ], [order({ items: [{ product_name: "Sold lately" }] })], NOW);
  expect(rows.map((r) => r.name)).toEqual(["Quiet"]);
});

test("walk-ins show conversion by source and store", () => {
  const f = walkinFunnel([
    { source: "Instagram", converted: true, sa_email: "a@x", created_at: "x" },
    { source: "Instagram", converted: false, sa_email: "A@x", created_at: "x" },
    { source: "", converted: false, sa_email: "b@x", created_at: "x" },
  ], all, { "a@x": { store_name: "Delhi Store", saleperson: "Asha" } });
  expect(f.rate).toBeCloseTo(33.33, 1);
  expect(f.bySource[0]).toMatchObject({ name: "Instagram", rate: 50 });
  expect(f.byStore.find((s) => s.name === "Delhi Store").count).toBe(2);
});

test("exhibitions keep what was left after the partner's share", () => {
  const rows = exhibitionBoard([{ id: "e", name: "Fair", commission_split: 20 }], [order({ exhibition_id: "e", net_total: 1000, net_sb_revenue: 800 })]);
  expect(rows[0]).toMatchObject({ gross: 1000, net: 800, count: 1 });
});

test("birthdays only list people who have bought, soonest first", () => {
  const rows = birthdaysSoon([
    { id: "u1", full_name: "asha rao", dob: "1990-11-09" },
    { id: "u2", full_name: "no orders", dob: "1990-11-06" },
    { id: "u3", full_name: "far away", dob: "1990-03-01" },
    { id: "u4", full_name: "tomorrow", dob: "1985-11-06" },
  ], [order({ user_id: "u1" }), order({ user_id: "u3" }), order({ user_id: "u4" })], NOW);
  expect(rows.map((r) => r.name)).toEqual(["Tomorrow", "Asha Rao"]);
  expect(rows[1].inDays).toBe(4);
});

test("concentration shows the share from the top tenth of clients", () => {
  const list = Array.from({ length: 10 }, (_, i) => order({ delivery_phone: String(i), net_total: i === 0 ? 900 : 10 }));
  const c = clientConcentration(list);
  expect(c.topCount).toBe(1);
  expect(c.topShare).toBeCloseTo(90.9, 0);
});

test("a client profile gathers spend, balance and favourites", () => {
  const p = clientProfile([
    order({ delivery_phone: "9", delivery_name: "asha", net_total: 500, remaining_payment: 100, items: [{ product_name: "Kurta", size: "M" }] }),
    order({ delivery_phone: "9", delivery_name: "asha", status: "cancelled", net_total: 9999 }),
    order({ delivery_phone: "8" }),
  ], "9");
  expect(p).toMatchObject({ name: "Asha", count: 1, spend: 500, balance: 100 });
  expect(p.orders).toHaveLength(2);
  expect(p.designs[0].name).toBe("Kurta");
});

test("a design profile counts only its own pieces", () => {
  const p = designProfile([order({ net_total: 1000, items: [{ product_name: "Kurta", size: "M", quantity: 2 }, { product_name: "Saree", size: "S" }] })], "kurta", all);
  expect(p.pieces).toBe(2);
  expect(p.lifetime).toBe(500);
  expect(p.sizes[0]).toEqual({ name: "M", value: 1 });
});

test("the health board says idle rather than guessing when there is no data", () => {
  const rows = healthBoard({ growth: null, cash: 0, revenue: 0, onTimeRate: null, delivered: 0, qcRate: null, qcInspected: 0, returningShare: null, discountRate: null, walkinRate: null, walkins: 0 });
  expect(rows.every((r) => r.status === "idle")).toBe(true);
  const good = healthBoard({ growth: 12, cash: 8, revenue: 10, onTimeRate: 95, delivered: 4, qcRate: 2, qcInspected: 9, returningShare: 40, discountRate: 3, walkinRate: 50, walkins: 5 });
  expect(good.every((r) => r.status === "good")).toBe(true);
});

test("vendors: late means a later calendar day, and pieces out are as of now", () => {
  const b = vendorBoard([
    { vendor_name: "Asha", return_date: "2026-11-02", exit_scan_at: iso(2026, 10, 1), entry_scan_at: iso(2026, 10, 2, 22), stages_outside: [4] },
    { vendor_name: "Asha", return_date: "2026-11-02", exit_scan_at: iso(2026, 10, 1), entry_scan_at: iso(2026, 10, 4), stages_outside: [4] },
    { vendor_name: "Asha", return_date: "2026-11-03", exit_scan_at: iso(2026, 10, 1), entry_scan_at: null, stages_outside: [5] },
    { vendor_name: "Asha", return_date: "2026-11-30", exit_scan_at: iso(2026, 10, 4), entry_scan_at: null },
    { vendor_name: "Bina", return_date: "2026-11-30", exit_scan_at: null, entry_scan_at: null, status: "configured" },
  ], all, NOW);
  expect(b).toMatchObject({ returned: 2, late: 1, outNow: 2, pastDate: 1, onTimeRate: 50 });
  expect(b.rows).toHaveLength(1); // a piece not yet out does not count
  expect(b.rows[0].work[0]).toEqual({ name: "Embroidery", value: 2 });
  expect(b.rows[0].averageDaysOut).toBeGreaterThan(0);
  expect(b.rows[0].overdue).toHaveLength(1);
});

test("vendors: returns follow the period, pieces out do not", () => {
  const inNov = (ts) => new Date(ts) >= new Date(2026, 10, 1);
  const b = vendorBoard([
    { vendor_name: "Asha", return_date: "2026-10-02", exit_scan_at: iso(2026, 9, 1), entry_scan_at: iso(2026, 9, 2) },
    { vendor_name: "Asha", return_date: "2026-10-02", exit_scan_at: iso(2026, 9, 1), entry_scan_at: null },
  ], inNov, NOW);
  expect(b).toMatchObject({ returned: 0, outNow: 1, pastDate: 1 });
});

test("due soon keeps website orders apart from made-to-order", () => {
  const b = dueSoonBoard([
    order({ net_total: 100, warehouse_stage: "order_received", items: [{ sync_enabled: true }] }),
    order({ net_total: 200, warehouse_stage: "order_received", items: [{}] }),
    order({ net_total: 300, warehouse_stage: "cloth_issued", items: [{}] }),
    order({ net_total: 400, warehouse_stage: "stitching_in_progress", items: [{}] }),
    order({ net_total: 500, warehouse_stage: "some_old_stage", items: [{}] }),
  ]);
  expect(b.website).toHaveLength(1);
  expect(b.made).toHaveLength(4);
  expect(b.earlyValue).toBe(500);
  // every made-to-order order is counted somewhere
  expect(b.rows.reduce((s, r) => s + r.count, 0)).toBe(4);
});

test("target coach spreads what is needed over the days left, counting today", () => {
  const c = targetCoach([
    { name: "Asha", store: "Delhi", target: 2600, sold: 100 },
    { name: "Bina", store: "Delhi", target: 500, sold: 900 },
  ], NOW); // 5 November: 26 days left of 30
  expect(c.daysLeft).toBe(26);
  expect(c.rows[0]).toMatchObject({ needed: 2500, averagePerDay: 20 });
  expect(c.rows[0].neededPerDay).toBeCloseTo(96.15, 1);
  expect(c.rows[1]).toMatchObject({ needed: 0, neededPerDay: 0, achieved: 180 });
  expect(c.stores[0]).toMatchObject({ name: "Delhi", target: 3100, sold: 1000, people: 2 });
  expect(c.team.needed).toBe(2100);
});

test("the brief puts approvals first, then the largest rupee amounts", () => {
  const rows = briefItems({
    attention: [
      { id: "b2b", tone: "info", tab: "b", title: "B2B", detail: "" },
      { id: "exhibitions", tone: "crit", tab: "e", title: "Exb", detail: "" },
      { id: "delayed", tone: "crit", tab: "o", title: "Late", detail: "" },
    ],
    values: { b2b: 100, delayed: 900 },
    dueSoon: { early: [{}, {}], earlyValue: 500 },
    vendors: { pastDate: 3, outNow: 9 },
    coach: { team: { needed: 0 }, daysLeft: 26 },
  });
  expect(rows.map((r) => r.key)).toEqual(["exhibitions", "delayed", "due-early", "b2b", "vendor-overdue"]);
});

test("our own factory is never scored as a vendor", () => {
  const b = vendorBoard([
    { vendor_name: "SB WH Delhi (2)", is_factory2: true, return_date: "2026-11-01", exit_scan_at: iso(2026, 9, 1), entry_scan_at: null },
    { vendor_name: "SB WH Delhi (2)", return_date: "2026-11-30", exit_scan_at: iso(2026, 9, 1), entry_scan_at: null },
    { vendor_name: "Asha", return_date: "2026-11-01", exit_scan_at: iso(2026, 9, 1), entry_scan_at: null },
  ], all, NOW);
  expect(b.ownFactory).toEqual({ outNow: 2, pastDate: 1 });
  expect(b).toMatchObject({ outNow: 1, pastDate: 1 });
  expect(b.rows.map((r) => r.name)).toEqual(["Asha"]);
});

test("the brief never lets a target outrank a problem", () => {
  const rows = briefItems({
    attention: [{ id: "b2b", tone: "info", tab: "b", title: "B2B", detail: "" }],
    values: { b2b: 100 },
    coach: { team: { needed: 999999, neededPerDay: 5 }, daysLeft: 26 },
    peopleWithTargets: 9, peopleTotal: 18,
  });
  expect(rows.map((r) => r.key)).toEqual(["b2b", "target-pace"]);
});
