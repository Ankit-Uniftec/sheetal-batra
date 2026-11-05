import { cancelledAtOf, isSaleCancellation, orderValue } from "../../utils/cancellationAnalytics";
import { isSaleOrder } from "../../utils/revenue";
import { totalNetSbRevenue } from "../../utils/exhibitionService";
import { itemFinalAmount } from "../../utils/itemNetAmount";
import { buildOutstanding } from "../../utils/outstandingAnalytics";

// ============================================================
// The CEO dashboard's insights: every sentence and ranking on the new screens
// comes from here, so it can be tested without a browser. No data access.
//
// Money follows the rules the dashboard already uses: isSaleOrder for what
// counts as a sale, totalNetSbRevenue for what Sheetal Batra earned on it.
// ============================================================

export const orderRevenue = (o) => totalNetSbRevenue([o]);
export const sumRevenue = (orders) => totalNetSbRevenue(orders);
const grossOf = (o) => Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0);
const inRangeOf = (range, ts) => {
  if (!range) return false;
  const t = new Date(ts).getTime();
  return t >= new Date(range.start).getTime() && t <= new Date(range.end).getTime();
};
const itemsIn = (o) => (o.items || []).reduce((q, it) => q + (Number(it.quantity) || 1), 0);

/** Change in percent, or null when there is nothing fair to compare with. */
export function pctChange(current, previous) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

/** ₹1.2 Cr, ₹12.4 L, ₹48 K, ₹950. For headlines; tables keep the full figure. */
export function shortInr(value) {
  const n = Math.round(Number(value) || 0);
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const trim = (x) => String(Number(x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2)));
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7)} Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5)} L`;
  if (a >= 1e3) return `${sign}₹${trim(a / 1e3)} K`;
  return `${sign}₹${a}`;
}

const two = (n) => String(n).padStart(2, "0");
const dayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Revenue over time, with the matching days of the comparison period laid on
 * top. Over 62 days it groups by month, so a year stays readable.
 */
export function revenueSeries(sales, previousSales, range) {
  const list = sales || [];
  const times = list.map((o) => new Date(o.created_at).getTime());
  const spanDays = times.length ? (Math.max(...times) - Math.min(...times)) / 864e5 : 0;
  const monthly = spanDays > 62;
  const keyOf = (ts) => (monthly ? dayKey(ts).slice(0, 7) : dayKey(ts));
  const labelOf = (key) => {
    const p = key.split("-");
    return monthly ? `${MONTHS[Number(p[1]) - 1]} ${p[0].slice(2)}` : `${Number(p[2])} ${MONTHS[Number(p[1]) - 1]}`;
  };
  const map = {};
  list.forEach((o) => {
    const k = keyOf(o.created_at);
    if (!map[k]) map[k] = { key: k, label: labelOf(k), revenue: 0, orders: 0 };
    map[k].revenue += orderRevenue(o);
    map[k].orders += 1;
  });
  // Every day of a short bounded period gets a point, so a quiet day reads as a dip.
  if (!monthly && range?.start) {
    const cur = new Date(range.start);
    const end = new Date(Math.min(new Date(range.end).getTime(), Date.now()));
    for (let i = 0; cur <= end && i < 70; i += 1, cur.setDate(cur.getDate() + 1)) {
      const k = dayKey(cur);
      if (!map[k]) map[k] = { key: k, label: labelOf(k), revenue: 0, orders: 0 };
    }
  }
  const rows = Object.values(map).sort((a, b) => a.key.localeCompare(b.key));
  if (!monthly && previousSales?.length) {
    const prevMap = {};
    previousSales.forEach((o) => {
      const k = dayKey(o.created_at);
      prevMap[k] = (prevMap[k] || 0) + orderRevenue(o);
    });
    const prevRows = Object.keys(prevMap).sort();
    if (prevRows.length) {
      const prevStart = new Date(prevRows[0]);
      rows.forEach((r, i) => {
        const d = new Date(prevStart);
        d.setDate(prevStart.getDate() + i);
        r.previous = prevMap[dayKey(d)] || 0;
      });
    }
  }
  return rows;
}

/** Where a month is heading at its current pace. */
export function monthPace(sales, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const day = now.getDate();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const sameMoment = new Date(y, m - 1, day, now.getHours(), now.getMinutes(), 59);
  // Days gone so far, counting today only for the part that has passed.
  const elapsed = Math.max(0.5, day - 1 + (now.getHours() + now.getMinutes() / 60) / 24);
  let mtd = 0;
  let lastMonthSameDays = 0;
  let lastMonthTotal = 0;
  (sales || []).forEach((o) => {
    const d = new Date(o.created_at);
    const v = orderRevenue(o);
    if (d.getFullYear() === y && d.getMonth() === m) mtd += v;
    const lm = new Date(y, m - 1, 1);
    if (d.getFullYear() === lm.getFullYear() && d.getMonth() === lm.getMonth()) {
      lastMonthTotal += v;
      // Same point last month, so a morning is never held against a whole day.
      if (d <= sameMoment) lastMonthSameDays += v;
    }
  });
  return {
    mtd,
    day,
    daysInMonth,
    projected: (mtd / elapsed) * daysInMonth,
    lastMonthTotal,
    lastMonthSameDays,
    vsLastMonth: pctChange(mtd, lastMonthSameDays),
  };
}

/** Which channel moved the total most, and by how much. */
export function channelMovers(sales, previousSales, channelOf) {
  const map = {};
  const add = (o, field) => {
    const ch = channelOf(o);
    if (!map[ch]) map[ch] = { name: ch, current: 0, previous: 0, orders: 0 };
    map[ch][field] += orderRevenue(o);
    if (field === "current") map[ch].orders += 1;
  };
  (sales || []).forEach((o) => add(o, "current"));
  (previousSales || []).forEach((o) => add(o, "previous"));
  const total = (sales || []).reduce((s, o) => s + orderRevenue(o), 0);
  return Object.values(map)
    .map((c) => ({
      ...c,
      delta: c.current - c.previous,
      growth: pctChange(c.current, c.previous),
      share: total > 0 ? (c.current / total) * 100 : 0,
    }))
    .sort((a, b) => b.current - a.current);
}

const productKey = (name) => String(name || "Unknown").trim();

/** Designs ranked by money, with images, and what is rising or falling. */
/**
 * Each piece's share of what its order really brought in. Item values are used
 * only as proportions: on some orders item.price already includes a custom add-on
 * or the full quantity, so adding item values up would overstate the order
 * (a Rs 2.1 L order showed as Rs 3.52 L). This way designs, colours and people
 * always add back up to sales.
 */
const shareCache = new WeakMap();
export function orderItemShares(order) {
  const cached = shareCache.get(order);
  if (cached) return cached;
  const items = order.items || [];
  const values = items.map((it) => Math.max(0, itemFinalAmount(order, it)));
  const total = values.reduce((s, v) => s + v, 0);
  const revenue = orderRevenue(order);
  const shares = items.map((_, i) => (total > 0 ? (revenue * values[i]) / total : revenue / items.length));
  shareCache.set(order, shares);
  return shares;
}
export const itemShare = (order, item) => orderItemShares(order)[(order.items || []).indexOf(item)] || 0;

export function productBoard(sales, previousSales, products) {
  const byName = {};
  (products || []).forEach((p) => { if (p.name) byName[productKey(p.name)] = p; });
  const add = (map, order, item, amount) => {
    const name = productKey(item.product_name);
    if (!map[name]) {
      map[name] = {
        name, revenue: 0, qty: 0, orders: new Set(),
        image: item.image_url || byName[name]?.image_url || null,
      };
    }
    map[name].revenue += amount;
    map[name].qty += Number(item.quantity) || 1;
    map[name].orders.add(order.id);
  };
  const cur = {};
  const prev = {};
  const addOrder = (map, o) => {
    const shares = orderItemShares(o);
    (o.items || []).forEach((it, i) => add(map, o, it, shares[i]));
  };
  (sales || []).forEach((o) => addOrder(cur, o));
  (previousSales || []).forEach((o) => addOrder(prev, o));
  const rows = Object.values(cur).map((p) => ({
    ...p,
    orders: p.orders.size,
    previous: prev[p.name]?.revenue || 0,
    delta: p.revenue - (prev[p.name]?.revenue || 0),
    product: byName[p.name] || null,
  })).sort((a, b) => b.revenue - a.revenue);
  return {
    rows,
    top: rows.slice(0, 10),
    bottom: [...rows].sort((a, b) => a.revenue - b.revenue).slice(0, 10),
    rising: rows.filter((r) => r.previous > 0 && r.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5),
    falling: Object.values(prev)
      .map((p) => ({ name: p.name, image: p.image, previous: p.revenue, revenue: cur[p.name]?.revenue || 0 }))
      .map((p) => ({ ...p, delta: p.revenue - p.previous }))
      .filter((p) => p.delta < 0)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 5),
  };
}

/** Sizes, by pieces sold. */
export function sizeBoard(sales) {
  const map = {};
  (sales || []).forEach((o) => (o.items || []).forEach((it) => {
    const s = String(it.size || "").trim();
    if (!s) return;
    map[s] = (map[s] || 0) + (Number(it.quantity) || 1);
  }));
  const total = Object.values(map).reduce((a, b) => a + b, 0);
  return Object.entries(map)
    .map(([name, qty]) => ({ name, qty, share: total ? (qty / total) * 100 : 0 }))
    .sort((a, b) => b.qty - a.qty);
}

const WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Revenue per weekday, as an average across how many of that day were in the data. */
export function weekdayPattern(sales) {
  const map = WEEK.map((name) => ({ name, short: name.slice(0, 3), revenue: 0, orders: 0, days: new Set() }));
  (sales || []).forEach((o) => {
    const d = new Date(o.created_at);
    const row = map[d.getDay()];
    row.revenue += orderRevenue(o);
    row.orders += 1;
    row.days.add(dayKey(d));
  });
  return map.map((r) => ({
    name: r.name, short: r.short, revenue: r.revenue, orders: r.orders,
    average: r.days.size ? r.revenue / r.days.size : 0,
    days: r.days.size,
  }));
}

/** New and returning clients in a period, and how much each brought in. */
export function clientMix(allSales, inPeriod) {
  const first = {};
  (allSales || []).forEach((o) => {
    const phone = o.delivery_phone;
    if (!phone) return;
    if (!first[phone] || o.created_at < first[phone]) first[phone] = o.created_at;
  });
  let newRevenue = 0;
  let returningRevenue = 0;
  const newSet = new Set();
  const returningSet = new Set();
  (allSales || []).forEach((o) => {
    if (!inPeriod(o.created_at)) return;
    const phone = o.delivery_phone;
    if (!phone) return;
    // A client's first ever order is "new". Every order after it is "returning",
    // even inside a long period such as a whole year.
    if (o.created_at === first[phone]) { newRevenue += orderRevenue(o); newSet.add(phone); }
    else { returningRevenue += orderRevenue(o); returningSet.add(phone); }
  });
  const total = newRevenue + returningRevenue;
  return {
    newRevenue, returningRevenue,
    newCount: newSet.size,
    returningCount: returningSet.size,
    returningShare: total ? (returningRevenue / total) * 100 : 0,
  };
}

/** Best clients who have not ordered for a while. Worth a personal call. */
export function lapsedVips(allSales, now = new Date(), days = 180, limit = 10) {
  const map = {};
  (allSales || []).forEach((o) => {
    const phone = o.delivery_phone;
    if (!phone || o.is_b2b) return;
    if (!map[phone]) map[phone] = { phone, name: o.delivery_name || "Unknown", spend: 0, orders: 0, last: o.created_at, store: o.salesperson_store || "", sa: o.salesperson || "" };
    const c = map[phone];
    c.spend += orderRevenue(o);
    c.orders += 1;
    if (o.created_at > c.last) { c.last = o.created_at; c.store = o.salesperson_store || c.store; c.sa = o.salesperson || c.sa; }
  });
  const cutoff = now.getTime() - days * 864e5;
  return Object.values(map)
    .filter((c) => new Date(c.last).getTime() < cutoff)
    .map((c) => ({ ...c, daysAway: Math.round((now.getTime() - new Date(c.last).getTime()) / 864e5) }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, limit);
}

/**
 * Refunds, returns and exchanges on orders placed in a period, and cancellations
 * made in it. Cancellations go by the day they were cancelled, the same rule as
 * the Cancellations page, so the two pages always show the same figure.
 */
export function aftercare(orders, inPeriod) {
  const out = { refunds: { count: 0, value: 0 }, returns: { count: 0, value: 0 }, exchanges: { count: 0, value: 0 }, cancellations: { count: 0, value: 0 } };
  (orders || []).forEach((o) => {
    if (isSaleCancellation(o) && inPeriod(cancelledAtOf(o))) { out.cancellations.count += 1; out.cancellations.value += orderValue(o); }
    if (!inPeriod(o.created_at) || o.is_stock_order || o.is_alteration) return;
    const v = grossOf(o);
    if (o.refund_reason || o.refund_status) { out.refunds.count += 1; out.refunds.value += v; }
    if (o.return_reason) { out.returns.count += 1; out.returns.value += v; }
    if (o.exchange_reason) { out.exchanges.count += 1; out.exchanges.value += v; }
  });
  return out;
}

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/**
 * The short list of things that need the CEO's attention, worst first. Each says what is
 * wrong in plain words and which page has the detail. Nothing here is shown
 * when there is nothing to do.
 */
export function buildAttention({
  pendingExhibitions = 0, delayedCount = 0, delayedValue = 0, outstanding = null,
  qcFailRate = null, qcFailCount = 0, qcInspected = 0, cancellations = null, previousCancellations = null,
  discountRate = null, previousDiscountRate = null, b2bBalance = 0, b2bPartnersOwing = 0,
}) {
  const items = [];
  if (pendingExhibitions > 0) {
    items.push({ id: "exhibitions", tone: "crit", tab: "exhibition_approvals", title: `${plural(pendingExhibitions, "exhibition")} waiting for your approval`, detail: "Nothing can be sold there until you approve." });
  }
  if (delayedCount > 0) {
    items.push({ id: "delayed", tone: delayedCount > 25 ? "crit" : "warn", tab: "ops_flags", title: `${plural(delayedCount, "order")} past the delivery date`, detail: `Not yet marked dispatched, worth ${shortInr(delayedValue)}.` });
  }
  if (outstanding?.old?.value > 0) {
    items.push({ id: "outstanding", tone: "warn", tab: "outstanding", title: `${shortInr(outstanding.old.value)} unpaid for over 60 days`, detail: `On ${plural(outstanding.old.count, "order")}. Some may already be collected but not recorded.` });
  }
  if (cancellations && cancellations.count > 0 && previousCancellations?.value > 0 && cancellations.value > previousCancellations.value * 1.25 && cancellations.count >= 3) {
    items.push({ id: "cancellations", tone: "warn", tab: "cancellations", title: `Cancellations are up: ${shortInr(cancellations.value)}`, detail: `${plural(cancellations.count, "order")}, against ${shortInr(previousCancellations.value)} in the period before.` });
  }
  if (discountRate != null && previousDiscountRate != null && discountRate > previousDiscountRate + 2 && discountRate > 5) {
    items.push({ id: "discounts", tone: "warn", tab: "cost_expenditure", title: `Discounts rose to ${discountRate.toFixed(1)}% of sales`, detail: `From ${previousDiscountRate.toFixed(1)}% in the period before.` });
  }
  if (qcFailRate != null && qcFailRate >= 10 && qcInspected >= 20) {
    items.push({ id: "qc", tone: "warn", tab: "ops_flags", title: `QC failing ${qcFailRate.toFixed(1)}% of pieces`, detail: `${plural(qcFailCount, "failure")} from ${plural(qcInspected, "inspection")}.` });
  }
  if (b2bBalance > 0) {
    items.push({ id: "b2b", tone: "info", tab: "b2b_vendor", title: `${shortInr(b2bBalance)} to collect from B2B partners`, detail: `Across ${plural(b2bPartnersOwing, "partner")} this period.` });
  }
  const rank = { crit: 0, warn: 1, info: 2 };
  return items.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

/** Good news and useful patterns, as short sentences. */
export function buildHighlights({
  topProduct = null, topSa = null, bestDay = null, topChannel = null, risingProduct = null, clients = null, topColour = null,
}) {
  const out = [];
  if (topChannel) out.push({ id: "channel", icon: "trend", text: `${topChannel.name} leads with ${shortInr(topChannel.current)}`, sub: `${topChannel.share.toFixed(0)}% of revenue${topChannel.growth != null ? `, ${topChannel.growth >= 0 ? "up" : "down"} ${Math.abs(topChannel.growth).toFixed(0)}%` : ""}` });
  if (topProduct) out.push({ id: "product", icon: "products", text: `Best seller: ${topProduct.name}`, sub: `${shortInr(topProduct.revenue)} from ${plural(topProduct.qty, "piece")}` });
  if (risingProduct) out.push({ id: "rising", icon: "trend", text: `Fastest rising: ${risingProduct.name}`, sub: `Up ${shortInr(risingProduct.delta)} on the period before` });
  if (topSa) out.push({ id: "sa", icon: "sale", text: `Top Sales Associate: ${topSa.name}`, sub: `${shortInr(topSa.revenue)} from ${plural(topSa.orders, "order")}` });
  if (clients && clients.returningShare > 0) out.push({ id: "clients", icon: "overview", text: `${clients.returningShare.toFixed(0)}% of revenue came from returning clients`, sub: `${plural(clients.newCount, "new client")} joined this period` });
  if (bestDay && bestDay.average > 0) out.push({ id: "day", icon: "overview", text: `${bestDay.name}s sell the most`, sub: `${shortInr(bestDay.average)} on an average ${bestDay.name}` });
  if (topColour) out.push({ id: "colour", icon: "products", text: `Top colour: ${topColour.name}`, sub: `${shortInr(topColour.sales)} in sales` });
  return out;
}

/** One sentence that sums up the period. */
export function headline({ revenue, growth, periodName, topChannel, pace, isThisMonth }) {
  const parts = [];
  if (!revenue) return `No sales recorded for ${periodName.toLowerCase()} yet.`;
  if (growth == null) parts.push(`${shortInr(revenue)} in sales for ${periodName.toLowerCase()}.`);
  else if (Math.abs(growth) < 1) parts.push(`Sales are level with the period before, at ${shortInr(revenue)}.`);
  else parts.push(`Sales are ${growth > 0 ? "up" : "down"} ${Math.abs(growth).toFixed(0)}% on the period before, at ${shortInr(revenue)}.`);
  if (topChannel && topChannel.share >= 30) parts.push(`${topChannel.name} brought in ${topChannel.share.toFixed(0)}% of it.`);
  if (isThisMonth && pace?.projected > 0) parts.push(`At this pace the month closes near ${shortInr(pace.projected)}.`);
  return parts.join(" ");
}

/** Everything the Home page needs, for one period. */
export function buildBrief({ orders, products, inPeriod, previousRange, channelOf, now = new Date() }) {
  const allSales = (orders || []).filter(isSaleOrder);
  const sales = allSales.filter((o) => inPeriod(o.created_at));
  const previous = previousRange ? allSales.filter((o) => inRangeOf(previousRange, o.created_at)) : [];
  const revenue = sumRevenue(sales);
  const previousRevenue = sumRevenue(previous);
  const count = sales.length;
  const aov = count ? revenue / count : 0;
  const previousAov = previous.length ? previousRevenue / previous.length : 0;
  const pieces = sales.reduce((s, o) => s + itemsIn(o), 0);

  const discountOf = (list) => {
    const d = list.reduce((s, o) => s + (Number(o.discount_amount) || 0), 0);
    const r = sumRevenue(list);
    return { value: d, rate: r + d > 0 ? (d / (r + d)) * 100 : 0 };
  };
  const discount = discountOf(sales);
  const previousDiscount = discountOf(previous);

  const movers = channelMovers(sales, previous, channelOf);
  const board = productBoard(sales, previous, products);
  const mix = clientMix(allSales, inPeriod);
  const week = weekdayPattern(sales);
  // One Monday is not a pattern: only name a best day once each has been seen twice.
  const bestDay = [...week].filter((d) => d.days >= 2).sort((a, b) => b.average - a.average)[0] || null;
  const pace = monthPace(allSales, now);
  const out = buildOutstanding(orders || [], now);
  const old = out.buckets.find((b) => b.key === "d60");

  return {
    sales, previous, revenue, previousRevenue, revenueGrowth: pctChange(revenue, previousRevenue),
    count, countGrowth: pctChange(count, previous.length),
    aov, aovGrowth: pctChange(aov, previousAov),
    pieces, discount, previousDiscount,
    movers, board, mix, week, bestDay, pace,
    outstanding: { total: out.total, count: out.count, old, buckets: out.buckets },
    aftercare: aftercare(orders, inPeriod),
    previousAftercare: previousRange ? aftercare(orders, (ts) => inRangeOf(previousRange, ts)) : null,
    sizes: sizeBoard(sales),
  };
}
