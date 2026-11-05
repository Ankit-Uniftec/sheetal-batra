import { isSaleOrder } from "../../utils/revenue";
import { STAGE_GROUPS, getStageGroupKey } from "../../utils/barcodeService";
import { isOrderStillRunning } from "../../utils/productionMetrics";
import { netSbRevenue } from "../../utils/exhibitionService";
import { orderItemShares, orderRevenue, pctChange, shortInr, sumRevenue } from "./ceoInsights";

// ============================================================
// What a brand owner asks of the business, as plain functions: how is today, how
// much cash came in, what is promised, who is coming back. No screen code here.
// ============================================================

const DAY = 864e5;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const clean = (s) => String(s || "").trim();
const titleCase = (s) => clean(s).toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
export const dateKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

/** Today so far, against the same weekday last week up to the same time. */
export function todayPulse(sales, now = new Date()) {
  const start = startOfDay(now).getTime();
  const pick = (from, to) => {
    const list = (sales || []).filter((o) => {
      const t = new Date(o.created_at).getTime();
      return t >= from && t <= to;
    });
    return { orders: list, count: list.length, revenue: sumRevenue(list) };
  };
  const today = pick(start, now.getTime());
  const lastWeek = pick(start - 7 * DAY, now.getTime() - 7 * DAY);
  const yesterday = pick(start - DAY, start - 1);
  return { today, lastWeek, yesterday, growth: pctChange(today.revenue, lastWeek.revenue) };
}

/** Everything promised and not yet out of the door. */
export function orderBook(orders, now = new Date()) {
  const running = (orders || []).filter((o) => isSaleOrder(o) && isOrderStillRunning(o));
  const end = (days) => now.getTime() + days * DAY;
  const late = [];
  const week = [];
  const month = [];
  running.forEach((o) => {
    if (!o.delivery_date) return;
    const t = new Date(o.delivery_date).getTime();
    if (t < now.getTime()) late.push(o);
    else if (t <= end(7)) week.push(o);
    else if (t <= end(30)) month.push(o);
  });
  return {
    running, value: sumRevenue(running), count: running.length,
    late, lateValue: sumRevenue(late),
    dueWeek: week, dueWeekValue: sumRevenue(week),
    dueMonth: month, dueMonthValue: sumRevenue(month),
  };
}

/**
 * Cash actually received in a period: money taken when orders were placed, plus
 * balances collected later. "Legacy adjustment" rows are book corrections from
 * the old sheet, not money received, so they are left out.
 */
export function cashIn(allSales, payments, inPeriod) {
  const paidLater = {};
  (payments || []).forEach((p) => { paidLater[p.order_id] = (paidLater[p.order_id] || 0) + (Number(p.amount) || 0); });
  const modes = {};
  const addMode = (m, v) => {
    const k = clean(m) || "Other";
    modes[k] = (modes[k] || 0) + v;
  };
  let atOrder = 0;
  (allSales || []).forEach((o) => {
    if (!inPeriod(o.created_at)) return;
    const paid = Number(o.total_paid ?? o.advance_payment) || 0;
    const first = Math.max(0, paid - (paidLater[o.id] || 0));
    if (first > 0) { atOrder += first; addMode(o.payment_mode, first); }
  });
  let later = 0;
  let laterCount = 0;
  (payments || []).forEach((p) => {
    if (/legacy/i.test(p.payment_mode || "") || !inPeriod(p.paid_at)) return;
    const v = Number(p.amount) || 0;
    later += v;
    laterCount += 1;
    addMode(p.payment_mode, v);
  });
  const total = atOrder + later;
  return {
    total, atOrder, later, laterCount,
    modes: Object.entries(modes).map(([name, value]) => ({ name, value, share: total ? (value / total) * 100 : 0 })).sort((a, b) => b.value - a.value),
  };
}

/** Of the orders delivered in a period, how many arrived by the promised date. */
export function deliveryPromise(orders, inPeriod) {
  const done = (orders || []).filter((o) => isSaleOrder(o) && o.delivered_at && o.delivery_date && inPeriod(o.delivered_at));
  const dayOf = (v) => startOfDay(new Date(v)).getTime();
  const onTime = done.filter((o) => dayOf(o.delivered_at) <= dayOf(o.delivery_date)).length;
  const days = done.map((o) => (new Date(o.delivered_at).getTime() - new Date(o.created_at).getTime()) / DAY).filter((d) => d >= 0);
  return {
    delivered: done.length, onTime,
    rate: done.length ? (onTime / done.length) * 100 : null,
    leadDays: days.length ? days.reduce((s, d) => s + d, 0) / days.length : null,
  };
}

const BANDS = [
  { name: "Under ₹25 K", max: 25000 },
  { name: "₹25 K to ₹50 K", max: 50000 },
  { name: "₹50 K to ₹1 L", max: 100000 },
  { name: "₹1 L to ₹2 L", max: 200000 },
  { name: "Over ₹2 L", max: Infinity },
];
/** Which order sizes the money really comes from. */
export function priceBands(sales) {
  const rows = BANDS.map((b) => ({ ...b, count: 0, revenue: 0, orders: [] }));
  let total = 0;
  (sales || []).forEach((o) => {
    const v = orderRevenue(o);
    total += v;
    const row = rows.find((b) => v < b.max);
    row.count += 1;
    row.revenue += v;
    row.orders.push(o);
  });
  return rows.map((r) => ({ ...r, share: total ? (r.revenue / total) * 100 : 0 }));
}

export const biggestOrders = (sales, limit = 8) =>
  [...(sales || [])].sort((a, b) => orderRevenue(b) - orderRevenue(a)).slice(0, limit);

/** Where clients are. */
export function cityBoard(sales) {
  const map = {};
  (sales || []).forEach((o) => {
    if (o.is_b2b) return;
    const name = titleCase(o.delivery_city) || "Not recorded";
    if (!map[name]) map[name] = { name, revenue: 0, orders: [], clients: new Set() };
    map[name].revenue += orderRevenue(o);
    map[name].orders.push(o);
    if (o.delivery_phone) map[name].clients.add(o.delivery_phone);
  });
  const rows = Object.values(map).map((c) => ({ ...c, clients: c.clients.size })).sort((a, b) => b.revenue - a.revenue);
  const abroad = (sales || []).filter((o) => !o.is_b2b && clean(o.delivery_country) && !/^(india|in)$/i.test(clean(o.delivery_country)));
  return { rows, abroadRevenue: sumRevenue(abroad), abroadCount: abroad.length };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The last n months, oldest first. */
export function monthlySeries(allSales, now = new Date(), count = 12) {
  const rows = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    rows.push({ key: `${d.getFullYear()}-${d.getMonth()}`, name: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, revenue: 0, orders: 0, pieces: 0, start: d });
  }
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  (allSales || []).forEach((o) => {
    const d = new Date(o.created_at);
    const r = byKey[`${d.getFullYear()}-${d.getMonth()}`];
    if (!r) return;
    r.revenue += orderRevenue(o);
    r.orders += 1;
  });
  return rows.map((r) => ({ ...r, aov: r.orders ? r.revenue / r.orders : 0 }));
}

/** One square per day, for the calendar of the year. Weeks run Monday to Sunday. */
export function dayHeat(allSales, now = new Date(), weeks = 26) {
  const totals = {};
  (allSales || []).forEach((o) => {
    const k = dateKey(o.created_at);
    if (!totals[k]) totals[k] = { revenue: 0, count: 0 };
    totals[k].revenue += orderRevenue(o);
    totals[k].count += 1;
  });
  const today = startOfDay(now);
  const shift = (today.getDay() + 6) % 7;
  const first = new Date(today.getTime() - (shift + (weeks - 1) * 7) * DAY + 3 * 36e5);
  const cols = [];
  let max = 0;
  for (let w = 0; w < weeks; w += 1) {
    const col = [];
    for (let d = 0; d < 7; d += 1) {
      const day = startOfDay(new Date(first.getTime() + (w * 7 + d) * DAY));
      if (day > today) { col.push(null); continue; }
      const k = dateKey(day);
      const v = totals[k] || { revenue: 0, count: 0 };
      if (v.revenue > max) max = v.revenue;
      col.push({ key: k, date: day, revenue: v.revenue, count: v.count });
    }
    cols.push(col);
  }
  return { cols, max };
}

/** Live designs nobody has ordered for a while: worth reviewing or retiring. */
export function slowDesigns(products, allSales, now = new Date(), days = 90, limit = 12) {
  const last = {};
  (allSales || []).forEach((o) => (o.items || []).forEach((it) => {
    const k = clean(it.product_name).toLowerCase();
    if (k && (!last[k] || o.created_at > last[k])) last[k] = o.created_at;
  }));
  const cutoff = now.getTime() - days * DAY;
  return (products || [])
    .filter((p) => p.name && !p.is_draft && !p.is_custom_piece && new Date(p.created_at || 0).getTime() < cutoff)
    .map((p) => ({ ...p, lastSold: last[clean(p.name).toLowerCase()] || null }))
    .filter((p) => !p.lastSold || new Date(p.lastSold).getTime() < cutoff)
    .sort((a, b) => new Date(a.lastSold || 0) - new Date(b.lastSold || 0))
    .slice(0, limit);
}

/** Who walked in, how they heard of the brand, and how many bought. */
export function walkinFunnel(walkins, inPeriod, peopleByEmail = {}) {
  const list = (walkins || []).filter((w) => inPeriod(w.created_at));
  const group = (keyOf) => {
    const map = {};
    list.forEach((w) => {
      const k = keyOf(w) || "Not recorded";
      if (!map[k]) map[k] = { name: k, count: 0, converted: 0 };
      map[k].count += 1;
      if (w.converted) map[k].converted += 1;
    });
    return Object.values(map).map((r) => ({ ...r, rate: r.count ? (r.converted / r.count) * 100 : 0 })).sort((a, b) => b.count - a.count);
  };
  const converted = list.filter((w) => w.converted).length;
  const person = (w) => peopleByEmail[String(w.sa_email || "").toLowerCase()];
  return {
    total: list.length, converted, rate: list.length ? (converted / list.length) * 100 : null,
    bySource: group((w) => clean(w.source)),
    byStore: group((w) => person(w)?.store_name),
    byPerson: group((w) => clean(person(w)?.saleperson)),
  };
}

/** Running orders at each production stage, with what is sitting longest. */
export function stageBoard(orders, now = new Date()) {
  const rows = STAGE_GROUPS.map((g) => ({ key: g.key, name: g.label, external: g.external, count: 0, value: 0, days: 0, orders: [] }));
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  // Orders at a stage outside the normal flow still count, so the floor adds up.
  const other = { key: "other", name: "Other Stages", external: false, count: 0, value: 0, days: 0, orders: [] };
  rows.push(other);
  (orders || []).filter((o) => isSaleOrder(o) && isOrderStillRunning(o)).forEach((o) => {
    const stage = o.warehouse_stage || "order_received";
    const r = byKey[stage === "order_received" ? "order_received" : getStageGroupKey(stage)] || other;
    r.count += 1;
    r.value += orderRevenue(o);
    r.days += Math.max(0, (now.getTime() - new Date(o.warehouse_stage_updated_at || o.created_at).getTime()) / DAY);
    r.orders.push(o);
  });
  return rows.filter((r) => r.key !== "other" || r.count > 0).map((r) => ({ ...r, avgDays: r.count ? r.days / r.count : 0 }));
}

/** What each exhibition really brought home after the partner's share. */
export function exhibitionBoard(exhibitions, allSales) {
  const map = {};
  (exhibitions || []).forEach((e) => { map[e.id] = { ...e, gross: 0, net: 0, count: 0, orders: [] }; });
  (allSales || []).forEach((o) => {
    const e = o.exhibition_id && map[o.exhibition_id];
    if (!e) return;
    const gross = Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0);
    e.gross += gross;
    e.net += o.net_sb_revenue != null ? Number(o.net_sb_revenue) : netSbRevenue(gross, e.commission_split);
    e.count += 1;
    e.orders.push(o);
  });
  return Object.values(map).sort((a, b) => new Date(b.start_date || 0) - new Date(a.start_date || 0));
}

/** Clients with a birthday in the next few days. A personal touch from the owner. */
export function birthdaysSoon(profiles, allSales, now = new Date(), days = 14) {
  const spend = {};
  (allSales || []).forEach((o) => {
    if (!o.user_id) return;
    if (!spend[o.user_id]) spend[o.user_id] = { spend: 0, order: o };
    spend[o.user_id].spend += orderRevenue(o);
  });
  const today = startOfDay(now);
  return (profiles || []).map((p) => {
    if (!p.dob || !spend[p.id]) return null;
    const m = Number(String(p.dob).slice(5, 7));
    const d = Number(String(p.dob).slice(8, 10));
    if (!m || !d) return null;
    let next = new Date(today.getFullYear(), m - 1, d);
    if (next < today) next = new Date(today.getFullYear() + 1, m - 1, d);
    const inDays = Math.round((next - today) / DAY);
    if (inDays > days) return null;
    const o = spend[p.id].order;
    return { id: p.id, name: titleCase(p.full_name || o.delivery_name), phone: o.delivery_phone, inDays, date: next, spend: spend[p.id].spend, sa: o.salesperson || "" };
  }).filter(Boolean).sort((a, b) => a.inDays - b.inDays || b.spend - a.spend);
}

/** How much of the money comes from the best clients. */
export function clientConcentration(allSales) {
  const map = {};
  (allSales || []).forEach((o) => {
    if (!o.delivery_phone || o.is_b2b) return;
    map[o.delivery_phone] = (map[o.delivery_phone] || 0) + orderRevenue(o);
  });
  const values = Object.values(map).sort((a, b) => b - a);
  const total = values.reduce((s, v) => s + v, 0);
  const n = Math.max(1, Math.ceil(values.length * 0.1));
  const top = values.slice(0, n).reduce((s, v) => s + v, 0);
  return { clients: values.length, topCount: n, topShare: total ? (top / total) * 100 : 0, average: values.length ? total / values.length : 0 };
}

const tone = (v, good, watch, higherIsBetter = true) => {
  if (v == null) return "idle";
  if (higherIsBetter) return v >= good ? "good" : v >= watch ? "watch" : "bad";
  return v <= good ? "good" : v <= watch ? "watch" : "bad";
};

/**
 * The owner's scoreboard, one line per measure. The limits are starting points to
 * tune. `covers` says which dates the figure answers for.
 */
export function healthBoard({ growth, cash, revenue, onTimeRate, delivered, qcRate, qcInspected, returningShare, discountRate, walkinRate, walkins }) {
  const collection = revenue > 0 ? (cash / revenue) * 100 : null;
  return [
    { id: "growth", tab: "revenue", label: "Sales Growth", status: tone(growth, 0, -15), value: growth == null ? "–" : `${growth > 0 ? "+" : ""}${growth.toFixed(1)}%`, detail: "Total sales compared with the previous period" },
    { id: "cash", tab: "outstanding", label: "Cash Collection Rate", status: tone(collection, 70, 50), value: collection == null ? "–" : `${collection.toFixed(0)}%`, detail: `Cash received ${shortInr(cash)} against total sales ${shortInr(revenue)}` },
    { id: "delivery", tab: "ops_flags", label: "On-Time Delivery Rate", status: tone(onTimeRate, 90, 70), value: onTimeRate == null ? "–" : `${onTimeRate.toFixed(0)}%`, detail: `Share of the ${delivered.toLocaleString("en-IN")} orders delivered this period that arrived by the promised date` },
    { id: "quality", tab: "ops_flags", label: "QC Failure Rate", status: tone(qcRate, 5, 10, false), value: qcRate == null ? "–" : `${qcRate.toFixed(1)}%`, detail: `Share of the ${(qcInspected || 0).toLocaleString("en-IN")} quality checks this period that failed` },
    { id: "loyalty", tab: "client_insights", label: "Sales From Returning Clients", status: tone(returningShare, 30, 15), value: returningShare == null ? "–" : `${returningShare.toFixed(0)}%`, detail: "Share of client sales from people who have ordered before" },
    { id: "discount", tab: "cost_expenditure", label: "Discount Rate", status: tone(discountRate, 5, 12, false), value: discountRate == null ? "–" : `${discountRate.toFixed(1)}%`, detail: "Discount given as a share of sales value before discount" },
    { id: "walkins", tab: "store_performance", label: "Walk-In Conversion Rate", status: tone(walkinRate, 40, 25), value: walkinRate == null ? "–" : `${walkinRate.toFixed(0)}%`, detail: walkins ? `Share of the ${walkins.toLocaleString("en-IN")} store visitors logged who bought` : "No store visitors logged this period" },
  ];
}

// ---- Vendors -------------------------------------------------------------------

const STEP_NAME = Object.fromEntries(STAGE_GROUPS.filter((g) => g.step > 0).map((g) => [g.step, g.label]));
const daysBetween = (from, to) => (new Date(to).getTime() - new Date(from).getTime()) / DAY;

/**
 * Each vendor's record, from the gate scans. A piece is "returned late" when its
 * entry scan falls on a later calendar day than its return date. Returns are
 * counted in the chosen period; pieces out are as of now. Everything is as
 * scanned: a piece that came back without a scan still shows as out. Moves to our
 * own factory are not vendor work, so they are counted apart and never scored.
 */
const isOwnFactory = (m) => m.is_factory2 === true || /^SB WH\b/i.test(clean(m.vendor_name));

export function vendorBoard(movements, inPeriod, now = new Date()) {
  const today = dateKey(now);
  const map = {};
  const totals = { returned: 0, late: 0, outNow: 0, pastDate: 0 };
  const ownFactory = { outNow: 0, pastDate: 0 };
  (movements || []).forEach((m) => {
    if (isOwnFactory(m)) {
      if (m.exit_scan_at && !m.entry_scan_at) {
        ownFactory.outNow += 1;
        if (m.return_date && m.return_date < today) ownFactory.pastDate += 1;
      }
      return;
    }
    const name = clean(m.vendor_name) || "Not recorded";
    if (!map[name]) map[name] = { name, location: clean(m.vendor_location), returned: 0, late: 0, lateDays: 0, daysOut: 0, timed: 0, outNow: 0, pastDate: 0, work: {}, overdue: [], recent: [] };
    const v = map[name];
    if (m.entry_scan_at) {
      if (!inPeriod(m.entry_scan_at)) return;
      v.returned += 1;
      totals.returned += 1;
      (m.stages_outside || []).forEach((s) => { if (STEP_NAME[s]) v.work[STEP_NAME[s]] = (v.work[STEP_NAME[s]] || 0) + 1; });
      if (m.exit_scan_at) { v.daysOut += Math.max(0, daysBetween(m.exit_scan_at, m.entry_scan_at)); v.timed += 1; }
      if (m.return_date && dateKey(m.entry_scan_at) > m.return_date) {
        v.late += 1;
        totals.late += 1;
        v.lateDays += daysBetween(`${m.return_date}T23:59:59`, m.entry_scan_at);
      }
      v.recent.push(m);
    } else if (m.exit_scan_at) {
      v.outNow += 1;
      totals.outNow += 1;
      (m.stages_outside || []).forEach((s) => { if (STEP_NAME[s]) v.work[STEP_NAME[s]] = (v.work[STEP_NAME[s]] || 0) + 1; });
      if (m.return_date && m.return_date < today) {
        v.pastDate += 1;
        totals.pastDate += 1;
        v.overdue.push(m);
      }
    }
  });
  const rows = Object.values(map)
    .filter((v) => v.returned || v.outNow)
    .map((v) => ({
      ...v,
      onTimeRate: v.returned ? ((v.returned - v.late) / v.returned) * 100 : null,
      averageDaysOut: v.timed ? v.daysOut / v.timed : null,
      averageDaysLate: v.late ? v.lateDays / v.late : null,
      work: Object.entries(v.work).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    }))
    .sort((a, b) => b.pastDate - a.pastDate || b.outNow - a.outNow || b.returned - a.returned);
  return { rows, ownFactory, ...totals, onTimeRate: totals.returned ? ((totals.returned - totals.late) / totals.returned) * 100 : null };
}

// ---- Due soon, still early -------------------------------------------------------

const EARLY_STAGES = new Set(["order_received", "cloth_issue"]);

/**
 * Open orders due in the next 7 days, at the stage each is recorded at. No guess
 * about whether one will be late: "still early" is simply Order Received or Cloth
 * Issue. Website-synced orders are kept apart, because most of them sit at those
 * stages and would swamp the made-to-order picture.
 */
export function dueSoonBoard(dueOrders) {
  const made = [];
  const website = [];
  (dueOrders || []).forEach((o) => (o.items?.[0]?.sync_enabled === true ? website : made).push(o));
  const rows = STAGE_GROUPS.map((g) => ({ key: g.key, name: g.label, early: EARLY_STAGES.has(g.key), orders: [] }));
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  const other = { key: "other", name: "Other Stages", early: false, orders: [] };
  made.forEach((o) => {
    const stage = o.warehouse_stage || "order_received";
    (byKey[stage === "order_received" ? "order_received" : getStageGroupKey(stage)] || other).orders.push(o);
  });
  const list = [...rows, other].filter((r) => r.orders.length).map((r) => ({ ...r, count: r.orders.length, value: sumRevenue(r.orders) }));
  const early = list.filter((r) => r.early).flatMap((r) => r.orders);
  return {
    rows: list,
    made, madeValue: sumRevenue(made),
    website, websiteValue: sumRevenue(website),
    early, earlyValue: sumRevenue(early),
  };
}

// ---- Target coach ----------------------------------------------------------------

/**
 * Plain arithmetic on this month's targets. "Needed per day" spreads what is still
 * needed across the days left, counting today. Only people with a target appear.
 */
export function targetCoach(progress, now = new Date()) {
  const day = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - day + 1;
  const coach = (target, sold) => {
    const needed = Math.max(0, target - sold);
    return { target, sold, needed, neededPerDay: needed / daysLeft, averagePerDay: sold / day, achieved: target > 0 ? (sold / target) * 100 : 0 };
  };
  const rows = (progress || []).map((p) => ({ ...p, ...coach(p.target, p.sold) }));
  const stores = {};
  rows.forEach((r) => {
    const k = r.store || "Not recorded";
    if (!stores[k]) stores[k] = { name: k, target: 0, sold: 0, people: 0 };
    stores[k].target += r.target;
    stores[k].sold += r.sold;
    stores[k].people += 1;
  });
  return {
    day, daysInMonth, daysLeft, rows,
    stores: Object.values(stores).map((s) => ({ ...s, ...coach(s.target, s.sold) })).sort((a, b) => b.sold - a.sold),
    team: coach(rows.reduce((s, r) => s + r.target, 0), rows.reduce((s, r) => s + r.sold, 0)),
  };
}

// ---- Today's brief ---------------------------------------------------------------

/**
 * The day's decisions: what only the owner can approve comes first, then the
 * largest rupee amounts, then items that have a count but no rupee value.
 */
export function briefItems({ attention, values = {}, dueSoon, vendors, coach, peopleWithTargets, peopleTotal }) {
  const items = (attention || []).map((a) => ({ ...a, key: a.id, value: values[a.id] ?? null }));
  if (dueSoon?.early.length) {
    items.push({
      key: "due-early", id: "due-early", tone: "warn", tab: "ops_flags", value: dueSoon.earlyValue,
      title: `${dueSoon.early.length.toLocaleString("en-IN")} made-to-order orders due within 7 days, still at an early stage`,
      detail: "Recorded at Order Received or Cloth Issue.",
    });
  }
  if (vendors?.pastDate) {
    items.push({
      key: "vendor-overdue", id: "vendor-overdue", tone: "warn", tab: "vendors", value: null,
      title: `${vendors.pastDate.toLocaleString("en-IN")} pieces past their vendor return date`,
      detail: `Of ${vendors.outNow.toLocaleString("en-IN")} pieces out with vendors, as scanned at the gate.`,
    });
  }
  if (coach?.team.needed > 0) {
    items.push({
      // What is still to be sold is not money at risk, so it never outranks a problem.
      key: "target-pace", id: "target-pace", tone: "info", tab: "targets_growth", value: null,
      title: `${shortInr(coach.team.neededPerDay)} a day needed to reach this month's target`,
      detail: `${coach.daysLeft} days left. ${peopleWithTargets} of ${peopleTotal} Sales Associates have a target.`,
    });
  }
  const approvals = items.filter((i) => i.id === "exhibitions");
  const withValue = items.filter((i) => i.id !== "exhibitions" && i.value != null).sort((a, b) => b.value - a.value);
  const rest = items.filter((i) => i.id !== "exhibitions" && i.value == null);
  return [...approvals, ...withValue, ...rest];
}

// ---- The details behind a click -------------------------------------------------

const orderItems = (list) => list.flatMap((o) => (o.items || []).map((it) => ({ order: o, item: it })));
const countBy = (rows, keyOf, valueOf = () => 1) => {
  const map = {};
  rows.forEach((r) => {
    const k = keyOf(r);
    if (!k) return;
    map[k] = (map[k] || 0) + valueOf(r);
  });
  return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
};
const newestFirst = (list) => [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

const topDesigns = (list) => {
  const map = {};
  list.forEach((o) => {
    const shares = orderItemShares(o);
    (o.items || []).forEach((it, i) => {
      const k = clean(it.product_name);
      if (!k) return;
      if (!map[k]) map[k] = { name: k, value: 0, qty: 0 };
      map[k].value += shares[i];
      map[k].qty += Number(it.quantity) || 1;
    });
  });
  return Object.values(map).sort((a, b) => b.value - a.value);
};

/** Everything known about one client. */
export function clientProfile(allOrders, phone) {
  const orders = newestFirst((allOrders || []).filter((o) => o.delivery_phone === phone));
  const sales = orders.filter(isSaleOrder);
  const spend = sumRevenue(sales);
  const latest = orders[0] || {};
  const pairs = orderItems(sales);
  return {
    phone, name: titleCase(latest.delivery_name) || "Client", city: titleCase(latest.delivery_city), email: latest.delivery_email || "",
    orders, count: sales.length, spend, aov: sales.length ? spend / sales.length : 0,
    first: sales[sales.length - 1]?.created_at || null, last: sales[0]?.created_at || null,
    balance: sales.reduce((s, o) => s + Math.max(0, Number(o.remaining_payment) || 0), 0),
    designs: topDesigns(sales).slice(0, 5),
    sizes: countBy(pairs, (r) => r.item.size).slice(0, 3),
    colours: countBy(pairs, (r) => r.item.top_color?.name || r.item.color?.name).slice(0, 4),
    people: countBy(sales, (o) => clean(o.salesperson)).slice(0, 3),
    stores: countBy(sales, (o) => clean(o.salesperson_store)).slice(0, 3),
  };
}

const monthTrend = (list, now = new Date(), count = 6) => monthlySeries(list, now, count).map((m) => ({ label: m.name.slice(0, 3), revenue: m.revenue }));

/** One design: who buys it, in what, and how it is moving. */
export function designProfile(allSales, name, inPeriod, products = []) {
  const key = clean(name).toLowerCase();
  const orders = newestFirst((allSales || []).filter((o) => (o.items || []).some((it) => clean(it.product_name).toLowerCase() === key)));
  const pairs = orderItems(orders).filter((r) => clean(r.item.product_name).toLowerCase() === key);
  const inP = orders.filter((o) => inPeriod(o.created_at));
  const shareOf = (o) => {
    const shares = orderItemShares(o);
    return (o.items || []).reduce((s, it, i) => (clean(it.product_name).toLowerCase() === key ? s + shares[i] : s), 0);
  };
  const product = (products || []).find((p) => clean(p.name).toLowerCase() === key) || null;
  return {
    name: clean(name), product, image: product?.image_url || pairs[0]?.item?.image_url || null,
    orders, lifetime: orders.reduce((s, o) => s + shareOf(o), 0),
    pieces: pairs.reduce((s, r) => s + (Number(r.item.quantity) || 1), 0),
    periodRevenue: inP.reduce((s, o) => s + shareOf(o), 0),
    periodPieces: orderItems(inP).filter((r) => clean(r.item.product_name).toLowerCase() === key).reduce((s, r) => s + (Number(r.item.quantity) || 1), 0),
    sizes: countBy(pairs, (r) => r.item.size).slice(0, 6),
    colours: countBy(pairs, (r) => r.item.top_color?.name || r.item.color?.name).slice(0, 6),
    people: countBy(orders, (o) => clean(o.salesperson), shareOf).slice(0, 5),
    trend: monthlySeries(orders.map((o) => ({ ...o, net_total: shareOf(o), net_sb_revenue: shareOf(o), exhibition_id: null, is_exhibition: false })), new Date(), 6).map((m) => ({ label: m.name.slice(0, 3), revenue: m.revenue })),
  };
}

/** One person's book of business. */
export function personProfile(allSales, personOf, name, inPeriod, target = 0) {
  const all = (allSales || []).filter((o) => personOf(o) === name);
  const sales = newestFirst(all.filter((o) => inPeriod(o.created_at)));
  const revenue = sumRevenue(sales);
  const discount = sales.reduce((s, o) => s + (Number(o.discount_amount) || 0), 0);
  const clients = new Set(sales.map((o) => o.delivery_phone).filter(Boolean)).size;
  const now = new Date();
  const month = sumRevenue(all.filter((o) => {
    const d = new Date(o.created_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }));
  return {
    name, orders: sales, count: sales.length, revenue, aov: sales.length ? revenue / sales.length : 0, clients,
    discountRate: revenue + discount > 0 ? (discount / (revenue + discount)) * 100 : 0,
    store: sales[0]?.salesperson_store || all[0]?.salesperson_store || "",
    month, target,
    designs: topDesigns(sales).slice(0, 5),
    trend: monthTrend(all),
  };
}

/** One channel. */
export function channelProfile(allSales, channelOf, personOf, name, inPeriod) {
  const all = (allSales || []).filter((o) => channelOf(o) === name);
  const sales = newestFirst(all.filter((o) => inPeriod(o.created_at)));
  const revenue = sumRevenue(sales);
  return {
    name, orders: sales, count: sales.length, revenue, aov: sales.length ? revenue / sales.length : 0,
    designs: topDesigns(sales).slice(0, 5),
    people: countBy(sales, personOf, orderRevenue).slice(0, 5),
    trend: monthTrend(all),
  };
}
