import React, { useMemo, useState } from "react";
import { isRevenueOrder } from "../../utils/revenue";
import { Empty, RankBars, Seg, num } from "../CeoDashboard/CeoUi";
import { Card, Tile } from "./PmCommon";
import { Legend, StackBars, windowStart } from "./PmQuality";
import { channelOf, isLate, isRunning, pct, pieceState, plural, statusOf, todayStart } from "./pmModel";
import "./PmToday2.css";

// ============================================================
// Orders, returns and top sellers for the Today page. Counts and pieces only:
// no money anywhere. Every number and bar opens the orders behind it.
// ============================================================

// ------------------------------------------------------------ ORDER TOTALS
// Active orders (Production Load): not delivered, completed or cancelled (the
// same population as computeProductionMetrics).
const ENDED = new Set(["delivered", "completed", "cancelled"]);
const isReturn = (o) => !!o.return_reason || (Array.isArray(o.returned_items) && o.returned_items.length > 0) || statusOf(o) === "returned";
const isExchange = (o) => !!o.exchange_requested_at || !!o.exchange_reason;
const LATE_SERIES = [
  { key: "total", name: "All orders", color: "#e6d18f" },
  { key: "late", name: "Late (past due date)", color: "#a9821f" },
];

/**
 * Order totals, Production Load, Order Received and returns, then the orders
 * by channel. `children` (more cards) go in the same grid.
 */
export function OrderTotals({ ctx, children }) {
  const { orders, componentsByOrder, openOrders, openPieces } = ctx;
  const t = useMemo(() => {
    const today = todayStart();
    const live = (o) => (componentsByOrder[o.id] || []).filter((c) => !c.cancelled_at);
    // Started: a piece has moved past Order Received (or the order's warehouse stage has).
    const started = (o) => live(o).some((c) => pieceState(c) !== "not_started") || (!!o.warehouse_stage && o.warehouse_stage !== "order_received");
    const byChannel = {};
    orders.forEach((o) => {
      const k = channelOf(o);
      const r = byChannel[k] || (byChannel[k] = { name: k, value: 0, list: [], late: [] });
      r.value += 1;
      r.list.push(o);
      if (isLate(o, today)) r.late.push(o);
    });
    const channels = Object.values(byChannel).sort((a, b) => b.value - a.value);
    const active = orders.filter((o) => !ENDED.has(statusOf(o)));
    const inProd = active.filter((o) => statusOf(o) !== "dispatched" && o.warehouse_stage !== "dispatched" && started(o));
    const received = orders.filter((o) => isRunning(o) && !started(o) && (live(o).length > 0 || statusOf(o) === "order_received"));
    const returns = orders.filter(isReturn);
    const exchanges = orders.filter(isExchange);
    const revenueN = orders.filter(isRevenueOrder).length;
    return {
      channels, active, inProd, received, returns, exchanges, revenueN,
      pieces: orders.flatMap(live),
      rate: revenueN ? ((returns.length / revenueN) * 100).toFixed(1) : "0.0",
    };
  }, [orders, componentsByOrder]);
  const total = orders.length;
  const chart = t.channels.map((c) => ({ name: c.name, total: c.value, late: c.late.length, list: c.list, lateList: c.late }));

  return (
    <>
      <h2 className="pm-section-title">Orders and Returns</h2>
      <div className="ceo-tiles">
        <Tile icon="orders" label="Total Orders" value={num(total)} note={`across ${plural(t.channels.length, "channel")}`}
          onClick={() => openOrders({ title: "Total Orders", sub: "Every order on record, across all channels", orders })} />
        <Tile icon="stock" label="Total Pieces" value={num(t.pieces.length)} note="Garment pieces on those orders"
          onClick={() => openPieces({ title: "Total Pieces", sub: "Every garment piece on every order (cancelled pieces left out)", pieces: t.pieces })} />
        <Tile icon="trend" label="Production Load" value={`${pct(t.inProd.length, t.active.length)}%`} note={`${num(t.inProd.length)} in production of ${num(t.active.length)} active`}
          onClick={() => openOrders({ title: "In Production (Production Load)", sub: "Active orders with a piece started", orders: t.inProd })} />
        <Tile icon="bell" label="Order Received" value={num(t.received.length)} note="No piece started yet"
          onClick={() => openOrders({ title: "Order Received", sub: "Running orders with no piece started", orders: t.received })} />
        <Tile icon="refresh" label="Return Rate" value={`${t.rate}%`} note={`${num(t.returns.length)} returns of ${num(t.revenueN)} orders`}
          onClick={() => openOrders({ title: "Returns", sub: "Orders with a return reason, returned items or status Returned", orders: t.returns })} />
        <Tile icon="transfer" label="Returns" value={num(t.returns.length)} note="Return reason, returned items or status Returned"
          onClick={() => openOrders({ title: "Returns", sub: "Orders with a return reason, returned items or status Returned", orders: t.returns })} />
        <Tile icon="transfer" label="Exchanges" value={num(t.exchanges.length)} note="Exchange requested"
          onClick={() => openOrders({ title: "Exchanges", sub: "Orders with an exchange requested", orders: t.exchanges })} />
      </div>
      <div className="ceo-grid">
        <Card span={5} md={12} title="Orders by Channel" sub={`${num(total)} orders across ${plural(t.channels.length, "channel")}. Click a channel to see its orders.`}>
          <RankBars rows={t.channels} limit={t.channels.length} format={(v) => plural(v, "order")} sub={(r) => `${pct(r.value, total)}% of all orders`}
            onRow={(r) => openOrders({ title: `Orders: ${r.name}`, sub: "Every order placed in this channel", orders: r.list })} />
        </Card>
        <Card span={7} md={12} title="All vs Late Orders by Channel" sub="Every order against the running orders past their due date. Click a bar to see the orders.">
          <StackBars data={chart} series={LATE_SERIES} stacked={false} height={470}
            onPick={(row, key) => {
              const r = chart.find((x) => x.name === row?.name);
              if (!r) return;
              if (key === "late") openOrders({ title: `Late: ${r.name}`, sub: "Past the due date (T-2), still in production", orders: r.lateList });
              else openOrders({ title: `Orders: ${r.name}`, sub: "Every order placed in this channel", orders: r.list });
            }} />
          <Legend series={LATE_SERIES} />
        </Card>
        {children}
      </div>
    </>
  );
}

// ------------------------------------------------------------ TOP SELLERS
export const SALES_PERIODS = [
  { value: "30", label: "Last 30 Days" }, { value: "90", label: "Last 90 Days" },
  { value: "year", label: "This Year" }, { value: "all", label: "All Time" },
];
const periodStart = (p) => (p === "all" ? null : p === "year" ? new Date(new Date().getFullYear(), 0, 1) : windowStart(p));
const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL", "6XL"];
const sizeRank = (s) => SIZE_ORDER.indexOf(String(s).toUpperCase());
const bySize = (a, b) => {
  const ai = sizeRank(a.name);
  const bi = sizeRank(b.name);
  if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
};
const nameOf = (v) => (v && typeof v === "object" ? v.name : v);
/** B2B for B2B orders, otherwise the salesperson's store. */
export const storeOf = (o) => (o.is_b2b ? "B2B" : String(o.salesperson_store || "").trim() || "Other");
const colourOf = (it) => nameOf(it.top_color) || nameOf(it.color) || nameOf(it.bottom_color);
const qtyOf = (it) => Number(it.quantity) || 1;

/** Pieces per name (summed item quantity) and the orders each came from. */
function tally(orders, keyOf) {
  const m = new Map();
  orders.forEach((o) => (o.items || []).forEach((it) => {
    const name = String(keyOf(it) ?? "").trim();
    if (!name) return;
    let r = m.get(name);
    if (!r) { r = { name, value: 0, ids: new Set(), list: [] }; m.set(name, r); }
    r.value += qtyOf(it);
    if (!r.ids.has(o.id)) { r.ids.add(o.id); r.list.push(o); }
  }));
  return [...m.values()];
}
const desc = (a, b) => b.value - a.value;
const pcs = (v) => plural(v, "pc", "pcs");

/** Top products, colours and sizes by pieces ordered, per store, for a period. */
export function TopSellers({ ctx, span = 12 }) {
  const { orders, openOrders } = ctx;
  const [period, setPeriod] = useState("90");
  const [store, setStore] = useState("all");
  const inPeriod = useMemo(() => {
    const from = periodStart(period);
    return orders.filter((o) => isRevenueOrder(o) && (!from || new Date(o.created_at) >= from));
  }, [orders, period]);
  const stores = useMemo(() => {
    const m = {};
    inPeriod.forEach((o) => { const s = storeOf(o); m[s] = (m[s] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([s]) => s);
  }, [inPeriod]);
  const pick = stores.includes(store) ? store : "all";
  const data = useMemo(() => {
    const list = pick === "all" ? inPeriod : inPeriod.filter((o) => storeOf(o) === pick);
    const products = tally(list, (it) => it.product_name).sort(desc);
    return {
      products: products.slice(0, 6),
      colours: tally(list, colourOf).sort(desc).slice(0, 6),
      sizes: tally(list, (it) => it.size).sort(bySize),
      top: products[0] || null,
    };
  }, [inPeriod, pick]);
  const scope = `${SALES_PERIODS.find((p) => p.value === period)?.label}${pick === "all" ? ", all stores" : `, ${pick}`}`;
  const open = (kind) => (r) => openOrders({ title: `${kind}: ${r.name}`, sub: `Orders with ${plural(r.value, "piece")} of it (${scope})`, orders: r.list });

  return (
    <Card span={span} md={12} title="Top Sellers" sub="Pieces ordered by product, colour and size. Cancelled, returned and refunded orders are left out. Click a bar to see the orders.">
      <div className="pm-sales-tools">
        <Seg label="Period" options={SALES_PERIODS} value={period} onChange={setPeriod} />
        {stores.length > 1 && <Seg label="Store" options={[{ value: "all", label: "All Stores" }, ...stores.map((s) => ({ value: s, label: s }))]} value={pick} onChange={setStore} />}
      </div>
      {!data.top ? <Empty text="No orders in this period." /> : (
        <>
          <button type="button" className="pm-sales-top" onClick={() => open("Top Product")(data.top)}>
            <small>Top Product</small><b>{data.top.name}</b><span>{pcs(data.top.value)}</span>
          </button>
          <div className="pm-sales-grid">
            <div className="pm-sales-col">
              <h4>Top 6 Products</h4>
              <RankBars rows={data.products} limit={6} format={pcs} sub={(r) => plural(r.list.length, "order")} onRow={open("Product")} />
            </div>
            <div className="pm-sales-col">
              <h4>Top 6 Colours</h4>
              <RankBars rows={data.colours} limit={6} format={pcs} sub={(r) => plural(r.list.length, "order")} onRow={open("Colour")} />
            </div>
            <div className="pm-sales-col">
              <h4>Sizes</h4>
              <RankBars rows={data.sizes} limit={data.sizes.length} format={pcs} sub={(r) => plural(r.list.length, "order")} onRow={open("Size")} />
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
