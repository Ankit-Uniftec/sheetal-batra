import React, { useEffect, useMemo, useState } from "react";
import formatDate from "../../utils/formatDate";
import { totalNetSbRevenue } from "../../utils/exhibitionService";
import { itemFinalAmount } from "../../utils/itemNetAmount";
import { isRevenueOrder, isSaleOrder } from "../../utils/revenue";
import { inRange } from "../../components/PeriodFilter";
import { AGE_BUCKETS, daysPastDelivery, buildOutstanding, filterOutstanding, summariseOutstanding } from "../../utils/outstandingAnalytics";
import { b2bPaymentState, canUpdateB2bPayment } from "../../utils/recordPayment";
import { getOrderProgressStatus, getOrderStatusLabel, getStageLabel, normalizeOrderStatus } from "../../utils/barcodeService";
import downloadCsv from "../../utils/downloadCsv";
import { isOrderStillRunning } from "../../utils/productionMetrics";
import ExhibitionApprovals from "../../components/ExhibitionApprovals";
import OverrideHistory from "../../components/OverrideHistory";
import useStockRoomView from "../StockRoom/useStockRoomView";
import { TYPE_LABELS, TYPE_LXRTS, TYPE_MTO } from "../StockRoom/stockRoomModel";
import { shortInr } from "../CeoDashboard/ceoInsights";
import {
  Card as BaseCard, Chips, Drawer, Empty, FilterButton, FilterGroup, Icon, InfoTip, Insight, PageHead, Pager, RankBars,
  SearchBox, Seg, Select, Table as BaseTable, Thumb, Tile as BaseTile, TrendChart, fullInr, num, DateRange,
} from "../CeoDashboard/CeoUi";
import { CARD_INFO, COLUMN_INFO, TILE_INFO } from "./gmDefinitions";

// Every tile, card and column heading carries its plain-English definition
// (the "i"), looked up by its label. A page can still pass its own `info`.
const Tile = (p) => <BaseTile info={TILE_INFO[p.label]} {...p} />;
const Card = (p) => <BaseCard info={CARD_INFO[p.title]} {...p} />;
const Table = ({ columns, ...p }) => <BaseTable {...p} columns={columns.map((c) => (c.info || !COLUMN_INFO[c.label] ? c : { ...c, info: COLUMN_INFO[c.label] }))} />;
/** A small figure in a drawer, with its definition. */
export const Stat = ({ label, info, children }) => <div className="ceo-dstat"><small>{info ? <InfoTip text={info}>{label}</InfoTip> : label}</small>{children}</div>;

// ============================================================
// Anushree's (GM) pages. Every figure she had before is still here; each page
// is drawn with the same building blocks as Sheetal's dashboard and Stock Room.
// ============================================================

const PAGE = 15;
export const totalOf = (o) => Number(o?.net_total ?? o?.grand_total_after_discount ?? o?.grand_total ?? 0) || 0;
const sumOf = (list) => list.reduce((s, o) => s + totalOf(o), 0);
const qtyOf = (o) => (o.items || []).reduce((q, it) => q + (Number(it.quantity) || 1), 0);
const growth = (now, before) => (before > 0 ? ((now - before) / before) * 100 : null);
const pieces = (n) => `${num(n)} ${Number(n) === 1 ? "piece" : "pieces"}`;
const ordersN = (n) => `${num(n)} ${Number(n) === 1 ? "order" : "orders"}`;
const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);
const options = (list, allLabel) => [{ value: "", label: allLabel }, ...list.map((v) => ({ value: v, label: v }))];
const two = (n) => String(n).padStart(2, "0");
const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };
export const isLxrtsOrder = (o) => o.items?.[0]?.sync_enabled === true;

/** Paid, partly paid or unpaid, from what has been received so far. */
export const paymentOf = (o) => {
  const total = totalOf(o);
  const paid = Number(o.total_paid ?? o.advance_payment) || 0;
  if (paid >= total) return "paid";
  if (paid > 0) return "partial";
  return "unpaid";
};
const PAYMENT_LABEL = { paid: "Paid", partial: "Partly Paid", unpaid: "Unpaid" };
const PAYMENT_TONE = { paid: "ok", partial: "gold", unpaid: "warn" };
export const PaymentPill = ({ order }) => <i className={`ceo-pill is-${PAYMENT_TONE[paymentOf(order)]}`}>{PAYMENT_LABEL[paymentOf(order)]}</i>;
const priorityOf = (o) => (o.is_urgent || o.order_flag === "Urgent" || o.alteration_status === "upcoming_occasion" ? "urgent" : "normal");
const typeOf = (o) => {
  if (o.is_alteration) return "alteration";
  const item = o.items?.[0];
  return item?.order_type === "Custom" || item?.payment_order_type === "Custom" ? "custom" : "standard";
};

const slug = (t) => String(t || "export").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
/** A small download button. Every list and drawer on this dashboard has one. */
export const CsvButton = ({ onClick, disabled, label = "Export CSV" }) => (
  <button type="button" className="ceo-btn is-small" onClick={onClick} disabled={disabled}><Icon name="download" />{label}</button>
);

/** What a list of orders adds up to, one row per order, with the figures each page uses. */
export function exportOrders(title, orders, ctx) {
  downloadCsv({
    filename: `gm_${slug(title)}`,
    headers: ["Order No", "Order Date", "Client / Partner", "Phone", "Sales Channel", "Store", "Sales Associate / Merchandiser", "B2B Order Type", "Status", "Production", "Delivery Date", "Order Value", "Amount Received", "Balance Due", "Products", "Pieces"],
    rows: orders.map((o) => {
      const pay = b2bPaymentState(o);
      const balance = o.is_b2b ? pay.balance : Math.max(0, Number(o.remaining_payment) || 0);
      return [
        o.order_no || "", o.created_at ? formatDate(o.created_at) : "", ctx.clientOf(o), o.delivery_phone || "", ctx.channelOf(o), o.salesperson_store || "",
        ctx.personOf(o) || "", o.b2b_order_type || "", getOrderStatusLabel(o.status), journeyLine(o), o.delivery_date ? formatDate(o.delivery_date) : "",
        Math.round(pay.total), Math.round(pay.received), Math.round(balance),
        (o.items || []).map((it) => it.product_name).filter(Boolean).join(" | "), qtyOf(o),
      ];
    }),
  });
}

/** Where the order is in production, in one short line. */
export function journeyLine(o) {
  if (o.delivered_at) return `Delivered ${formatDate(o.delivered_at)}`;
  if (o.dispatched_at) return `Dispatched ${formatDate(o.dispatched_at)}`;
  if (o.warehouse_stage && o.warehouse_stage !== "order_received") {
    return `${getStageLabel(o.warehouse_stage) || o.warehouse_stage}${o.warehouse_stage_updated_at ? `, ${formatDate(o.warehouse_stage_updated_at)}` : ""}`;
  }
  return "Not started";
}

/** The order cell used in every list: picture, number and client. */
export const OrderCell = ({ o, ctx }) => (
  <span className="ceo-ocell">
    <Thumb src={o.items?.[0]?.image_url} alt="" />
    <span><b>{o.order_no || "–"}</b><small>{ctx.clientOf(o)}{priorityOf(o) === "urgent" ? <i className="ceo-pill is-crit"> Urgent</i> : null}</small></span>
  </span>
);

function PeriodNote({ ctx }) {
  return <span className="ceo-muted">{ctx.periodName}{ctx.compareName ? ` · compared with ${ctx.compareName.toLowerCase()}` : ""}</span>;
}

// ------------------------------------------------------------ STORE PERFORMANCE
export function StorePerformancePage({ ctx }) {
  const { sales, prevSales, personOf, isPerson, channelOf, salespersonTable, openOrders } = ctx;
  const [channel, setChannel] = useState("");

  const stats = useMemo(() => {
    const revenue = sumOf(sales.filter(isRevenueOrder));
    const prevRevenue = sumOf(prevSales.filter(isRevenueOrder));
    const byChannel = {};
    const prevByChannel = {};
    sales.forEach((o) => {
      const c = channelOf(o);
      const g = byChannel[c] || (byChannel[c] = { name: c, value: 0, orders: 0, items: 0 });
      g.value += totalOf(o); g.orders += 1; g.items += qtyOf(o);
    });
    prevSales.forEach((o) => { const c = channelOf(o); prevByChannel[c] = (prevByChannel[c] || 0) + totalOf(o); });
    const channels = Object.values(byChannel).sort((a, b) => b.value - a.value)
      .map((c) => ({ ...c, previous: prevByChannel[c.name] || 0, growth: growth(c.value, prevByChannel[c.name] || 0) }));

    const staffStore = {};
    salespersonTable.forEach((sp) => { if (sp.saleperson) staffStore[sp.saleperson.trim().toLowerCase()] = sp.store_name || ""; });
    const people = {};
    sales.forEach((o) => {
      const name = personOf(o);
      if (!isPerson(name)) return;
      const p = people[name] || (people[name] = { name, store: staffStore[name.toLowerCase()] || channelOf(o), channels: new Set(), value: 0, orders: 0, items: 0, discount: 0 });
      p.channels.add(channelOf(o));
      p.value += totalOf(o); p.orders += 1; p.items += qtyOf(o); p.discount += Number(o.discount_amount) || 0;
    });
    const sa = Object.values(people).sort((a, b) => b.value - a.value);

    const staffCount = {};
    salespersonTable.forEach((sp) => {
      if (sp.role === "associate" || sp.role === "salesperson") staffCount[sp.store_name || "Other"] = (staffCount[sp.store_name || "Other"] || 0) + 1;
    });
    const productivity = channels.filter((c) => / Store$/.test(c.name) && staffCount[c.name]).map((c) => ({ ...c, staff: staffCount[c.name], perStaff: Math.round(c.orders / staffCount[c.name]) }));

    return { revenue, prevRevenue, netSb: totalNetSbRevenue(sales), count: sales.length, prevCount: prevSales.length, channels, sa, productivity };
  }, [sales, prevSales, personOf, isPerson, channelOf, salespersonTable]);

  const comparing = !!ctx.compareName;
  const saRows = channel ? stats.sa.filter((p) => p.channels.has(channel)) : stats.sa;
  const saTotal = saRows.reduce((s, p) => s + p.value, 0);

  return (
    <div className="ceo-page">
      <PageHead title="Store Performance" desc="Sales across every channel, day by day: the two stores, B2B, website, exhibitions and private orders. Click any figure to see the orders behind it.">
        <PeriodNote ctx={ctx} />
        <CsvButton label="Export Sales" onClick={() => exportOrders(`sales ${ctx.periodName}`, sales, ctx)} disabled={!sales.length} />
      </PageHead>
      <div className="ceo-tiles">
        <Tile icon="inr" label="Total Revenue" value={shortInr(stats.revenue)} title={fullInr(stats.revenue)} delta={comparing ? growth(stats.revenue, stats.prevRevenue) : null} note={ctx.periodName} onClick={() => openOrders({ title: "Sales", sub: ctx.periodName, orders: sales })} />
        <Tile icon="trend" label="Net SB Revenue" value={shortInr(stats.netSb)} title={fullInr(stats.netSb)} note="After exhibition partner shares" onClick={() => openOrders({ title: "Net SB Revenue", sub: `Every sale counts in full, except exhibition sales, which count after the exhibition's share. ${ctx.periodName}`, orders: sales })} />
        <Tile icon="orders" label="Total Orders" value={num(stats.count)} delta={comparing ? growth(stats.count, stats.prevCount) : null} note={ctx.periodName} onClick={() => openOrders({ title: "Sales Orders", sub: `Stock moves, alterations, gifting, cancelled and returned orders are not counted. ${ctx.periodName}`, orders: sales })} />
        <Tile icon="sale" label="Average Order Value" value={shortInr(stats.count ? stats.revenue / stats.count : 0)} title={fullInr(stats.count ? stats.revenue / stats.count : 0)} note={`${fullInr(stats.revenue)} ÷ ${ordersN(stats.count)}`} onClick={() => openOrders({ title: "Average Order Value", sub: `${fullInr(stats.revenue)} across ${ordersN(stats.count)}. ${ctx.periodName}`, orders: sales })} />
      </div>
      <div className="ceo-grid">
        <TargetsCard ctx={ctx} />
        <Card span={7} title="Revenue by Channel" sub={comparing ? `Dark bars this period; growth against ${ctx.compareName.toLowerCase()}` : "Click a channel to see its orders"}>
          <RankBars
            rows={stats.channels}
            limit={12}
            sub={(r) => `${ordersN(r.orders)} · ${pieces(r.items)} · ${pct(r.value, stats.revenue).toFixed(0)}% of revenue${comparing && r.growth != null ? ` · ${r.growth >= 0 ? "+" : ""}${r.growth.toFixed(0)}%` : ""}`}
            onRow={(r) => openOrders({ title: r.name, sub: `Sales, ${ctx.periodName}`, orders: sales.filter((o) => channelOf(o) === r.name) })}
          />
        </Card>
        <Card span={5} title="Orders per Sales Associate" sub="Store orders divided by the associates on that store's staff list">
          {stats.productivity.length ? (
            <div className="ceo-tiles">
              {stats.productivity.map((p) => <Tile key={p.name} label={p.name} value={ordersN(p.perStaff)} note={`${ordersN(p.orders)} ÷ ${num(p.staff)} associates`} onClick={() => openOrders({ title: p.name, sub: `${ordersN(p.orders)} shared by ${num(p.staff)} associates, ${ctx.periodName}`, orders: sales.filter((o) => channelOf(o) === p.name) })} />)}
            </div>
          ) : <Empty />}
        </Card>
        <Card span={12} title="Sales Associate Performance" sub="Each associate's own sales. Click a name to see the orders.">
          <div className="ceo-tools">
            <Select label="Channel" value={channel} onChange={setChannel} options={options(stats.channels.map((c) => c.name), "All channels")} search={false} />
            <CsvButton disabled={!saRows.length} onClick={() => downloadCsv({
              filename: `gm_associate_performance_${slug(ctx.periodName)}`,
              headers: ["Sales Associate", "Store", "Orders", "Pieces", "Revenue", "Average Order Value", "Discount Given", "Share %"],
              rows: saRows.map((r) => [r.name, r.store || "", r.orders, r.items, Math.round(r.value), Math.round(r.orders ? r.value / r.orders : 0), Math.round(r.discount), pct(r.value, saTotal).toFixed(1)]),
            })} />
          </div>
          <Table
            rowKey={(r) => r.name}
            rows={saRows}
            empty="No associate sales in this period."
            onRow={(r) => openOrders({ title: r.name, sub: `Sales, ${ctx.periodName}`, orders: sales.filter((o) => personOf(o) === r.name && (!channel || channelOf(o) === channel)) })}
            columns={[
              { key: "name", label: "Sales Associate", render: (r) => <b>{r.name}</b> },
              { key: "store", label: "Store", hide: true, render: (r) => r.store || "–" },
              { key: "orders", label: "Orders", right: true, render: (r) => num(r.orders) },
              { key: "items", label: "Pieces", info: "The number of pieces in their orders.", right: true, hide: true, render: (r) => num(r.items) },
              { key: "value", label: "Revenue", right: true, render: (r) => <span title={fullInr(r.value)}>{shortInr(r.value)}</span> },
              { key: "aov", label: "Average Order Value", right: true, hide: true, tab: true, render: (r) => shortInr(r.orders ? r.value / r.orders : 0) },
              { key: "discount", label: "Discount Given", right: true, hide: true, lap: true, render: (r) => shortInr(r.discount) },
              { key: "share", label: "Share", right: true, hide: true, render: (r) => `${pct(r.value, saTotal).toFixed(1)}%` },
            ]}
          />
        </Card>
        <DailySales ctx={ctx} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------ TARGETS (part of Store Performance)
// The same rule as Sheetal's dashboard: this month's target row for each
// associate, or their latest one before it, else the target on their profile.
// Sales are this calendar month's net revenue on their own orders.
function TargetsCard({ ctx }) {
  const { orders, salespersonTable, monthlyTargets, openOrders } = ctx;
  const rows = useMemo(() => {
    const now = new Date();
    const latest = {};
    (monthlyTargets || []).forEach((r) => {
      const e = String(r.salesperson_email || "").toLowerCase();
      const stamp = r.year * 12 + r.month;
      if (!latest[e] || stamp > latest[e].stamp) latest[e] = { stamp, amount: Number(r.target_amount) || 0 };
    });
    const mine = {};
    orders.forEach((o) => {
      const d = new Date(o.created_at);
      if (!isSaleOrder(o) || d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) return;
      const e = String(o.salesperson_email || "").toLowerCase();
      (mine[e] || (mine[e] = [])).push(o);
    });
    const dayShare = now.getDate() / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return salespersonTable
      .filter((sp) => ["salesperson", "sa_services"].includes(sp.role))
      .map((sp) => {
        const e = String(sp.email || "").toLowerCase();
        const list = mine[e] || [];
        const target = latest[e]?.amount || Number(sp.sales_target) || 0;
        const sold = totalNetSbRevenue(list);
        return { key: e, name: String(sp.saleperson || e).trim(), store: sp.store_name || "", target, sold, list, achieved: target ? (sold / target) * 100 : 0, onPace: dayShare * 100 };
      })
      .filter((r) => r.target > 0)
      .sort((a, b) => b.achieved - a.achieved);
  }, [orders, salespersonTable, monthlyTargets]);
  const month = new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  return (
    <Card span={12} info="Each sales associate's sales so far this month compared with their monthly target. Exhibition sales count after the exhibition's commission." title={`Sales Targets, ${month}`} sub={rows.length ? `Green when ahead of the ${rows[0].onPace.toFixed(0)}% of the month gone. Click a name to see the orders.` : "No targets are set for sales associates."}>
      {rows.length > 0 && (
        <>
          <div className="ceo-tools">
            <CsvButton onClick={() => downloadCsv({
              filename: `gm_sales_targets_${slug(month)}`,
              headers: ["Sales Associate", "Store", "Target", "Sold This Month", "Achieved %"],
              rows: rows.map((r) => [r.name, r.store, Math.round(r.target), Math.round(r.sold), r.achieved.toFixed(1)]),
            })} />
          </div>
          <Table
            rowKey={(r) => r.key}
            rows={rows}
            onRow={(r) => openOrders({ title: r.name, sub: `Sales in ${month}: ${fullInr(r.sold)} of a ${fullInr(r.target)} target`, orders: r.list })}
            columns={[
              { key: "name", label: "Sales Associate", render: (r) => <b>{r.name}</b> },
              { key: "store", label: "Store", hide: true, render: (r) => r.store || "–" },
              { key: "target", label: "Target", right: true, hide: true, render: (r) => shortInr(r.target) },
              { key: "sold", label: "Sold", info: "Sales so far this month on the associate's own orders.", right: true, render: (r) => shortInr(r.sold) },
              {
                key: "pct", label: "Achieved", right: true,
                render: (r) => (
                  <span className="ceo-meter" title={`${r.achieved.toFixed(0)}%`}>
                    <span><i style={{ width: `${Math.min(100, r.achieved)}%`, background: r.achieved >= r.onPace ? "#1f6b4e" : "#c9a23e" }} /></span>
                    <b>{r.achieved.toFixed(0)}%</b>
                  </span>
                ),
              },
            ]}
          />
        </>
      )}
    </Card>
  );
}

// ------------------------------------------------------------ DAY-WISE SALES (part of Store Performance)
function DailySales({ ctx }) {
  const { sales, channelOf, openOrders } = ctx;
  const data = useMemo(() => {
    const days = {};
    const channelTotals = {};
    sales.forEach((o) => {
      const key = dayKey(o.created_at);
      const c = channelOf(o);
      const d = days[key] || (days[key] = { key, revenue: 0, orders: 0, byChannel: {} });
      const v = totalOf(o);
      d.revenue += v; d.orders += 1;
      d.byChannel[c] = (d.byChannel[c] || 0) + v;
      channelTotals[c] = (channelTotals[c] || 0) + v;
    });
    const list = Object.values(days).sort((a, b) => a.key.localeCompare(b.key))
      .map((d) => ({ ...d, label: new Date(`${d.key}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) }));
    const channels = Object.entries(channelTotals).sort((a, b) => b[1] - a[1]).map(([name]) => name);
    return { list, channels, best: [...list].sort((a, b) => b.revenue - a.revenue)[0] };
  }, [sales, channelOf]);

  const openDay = (d) => openOrders({ title: new Date(`${d.key}T12:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }), sub: "Sales on this day", orders: sales.filter((o) => dayKey(o.created_at) === d.key) });
  const total = data.list.reduce((s, d) => s + d.revenue, 0);

  const best = data.best;
  return (
    <>
      <Card
        span={12}
        title="Revenue by Day"
        sub={`${shortInr(data.list.length ? total / data.list.length : 0)} a day on average over ${num(data.list.length)} selling days. Click a point to see that day's orders.`}
        action={best ? `Best day: ${best.label}, ${shortInr(best.revenue)}` : undefined}
        onAction={best ? () => openDay(best) : undefined}
      >
        <TrendChart data={data.list} onPick={openDay} />
      </Card>
      <Card span={12} title="Day-wise Sales by Channel" sub="Click a day to see its orders">
        <div className="ceo-tools">
          <CsvButton disabled={!data.list.length} onClick={() => downloadCsv({
            filename: `gm_day_wise_sales_${slug(ctx.periodName)}`,
            headers: ["Date", "Total Revenue", "Orders", ...data.channels, "Average Order Value"],
            rows: data.list.map((r) => [formatDate(r.key), Math.round(r.revenue), r.orders, ...data.channels.map((c) => Math.round(r.byChannel[c] || 0)), Math.round(r.orders ? r.revenue / r.orders : 0)]),
          })} />
        </div>
        <Table
          rowKey={(r) => r.key}
          rows={[...data.list].reverse()}
          onRow={openDay}
          empty="No sales data for this period."
          columns={[
            { key: "label", label: "Date", render: (r) => <b>{formatDate(r.key)}</b> },
            { key: "revenue", label: "Total Revenue", right: true, render: (r) => fullInr(r.revenue) },
            { key: "orders", label: "Orders", right: true, render: (r) => num(r.orders) },
            ...data.channels.map((c, i) => ({ key: `c-${c}`, label: c, right: true, hide: i > 1, lap: i > 3, render: (r) => (r.byChannel[c] ? fullInr(r.byChannel[c]) : "–") })),
            { key: "aov", label: "Average Order Value", right: true, hide: true, lap: true, render: (r) => fullInr(r.orders ? r.revenue / r.orders : 0) },
          ]}
        />
      </Card>
    </>
  );
}

// ------------------------------------------------------------ B2B OVERVIEW
export function B2bPage({ ctx }) {
  const { orders, inPeriod, range, prevRange, channelOf, vendorName, openOrders, sales } = ctx;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const stats = useMemo(() => {
    const all = orders.filter((o) => channelOf(o) === "B2B" && isSaleOrder(o));
    const current = all.filter((o) => inPeriod(o.created_at));
    const prev = prevRange ? all.filter((o) => inRange(prevRange, o.created_at)) : [];
    const revenue = sumOf(current);
    const allRevenue = sumOf(sales.filter(isRevenueOrder));
    const partners = {};
    let received = 0;
    let balance = 0;
    current.forEach((o) => {
      // By name: one partner can have several vendor rows (one per outlet).
      const key = vendorName(o);
      const p = partners[key] || (partners[key] = { key, name: vendorName(o), sales: 0, orders: 0, received: 0, balance: 0, list: [] });
      const pay = b2bPaymentState(o);
      p.sales += pay.total; p.orders += 1; p.received += pay.received; p.balance += pay.balance; p.list.push(o);
      received += pay.received; balance += pay.balance;
    });
    const byType = (t) => { const l = current.filter((o) => o.b2b_order_type === t); return { count: l.length, value: sumOf(l), list: l }; };
    const products = {};
    current.forEach((o) => (o.items || []).forEach((it) => {
      const name = it.product_name || "Unknown";
      const p = products[name] || (products[name] = { name, value: 0, qty: 0 });
      p.value += itemFinalAmount(o, it); p.qty += Number(it.quantity) || 1;
    }));
    return {
      current, revenue, received, balance,
      contribution: pct(revenue, allRevenue),
      allRevenue,
      growth: range && prevRange ? growth(revenue, sumOf(prev)) : null,
      buyout: byType("Buyout"), consignment: byType("Consignment"), clientOrder: byType("Client Order"),
      partners: Object.values(partners).sort((a, b) => b.sales - a.sales),
      consignmentBalance: current.filter((o) => o.b2b_order_type === "Consignment").reduce((s, o) => s + b2bPaymentState(o).balance, 0),
      products: Object.values(products).sort((a, b) => b.value - a.value),
    };
  }, [orders, inPeriod, range, prevRange, channelOf, vendorName, sales]);

  useEffect(() => { setPage(1); }, [search]);
  const q = search.trim().toLowerCase();
  const partners = q ? stats.partners.filter((p) => p.name.toLowerCase().includes(q)) : stats.partners;
  const owing = stats.partners.filter((p) => p.balance > 0).sort((a, b) => b.balance - a.balance);
  const openPartner = (p) => openOrders({ title: p.name, sub: `B2B orders, ${ctx.periodName}`, orders: p.list, b2b: true });

  return (
    <div className="ceo-page">
      <PageHead title="B2B Overview" desc="Partner sales, money received and balances due.">
        <PeriodNote ctx={ctx} />
        <CsvButton label="Export B2B Orders" onClick={() => exportOrders(`b2b orders ${ctx.periodName}`, stats.current, ctx)} disabled={!stats.current.length} />
      </PageHead>
      <div className="ceo-tiles">
        <Tile icon="inr" label="B2B Revenue" value={shortInr(stats.revenue)} title={fullInr(stats.revenue)} delta={stats.growth} note="Against the period before" onClick={() => openOrders({ title: "B2B Orders", sub: ctx.periodName, orders: stats.current, b2b: true })} />
        <Tile icon="orders" label="B2B Orders" value={num(stats.current.length)} note={ctx.periodName} onClick={() => openOrders({ title: "B2B Orders", sub: ctx.periodName, orders: stats.current, b2b: true })} />
        <Tile icon="trend" label="B2B Contribution" value={`${stats.contribution.toFixed(1)}%`} note={`${shortInr(stats.revenue)} of ${shortInr(stats.allRevenue)} all-channel revenue`} onClick={() => openOrders({ title: "B2B Contribution", sub: `${fullInr(stats.revenue)} of ${fullInr(stats.allRevenue)} revenue from every channel, ${ctx.periodName}`, orders: stats.current, b2b: true })} />
        <Tile icon="receive" label="Amount Received" value={shortInr(stats.received)} title={fullInr(stats.received)} note="Recorded against these orders" onClick={() => openOrders({ title: "Amount Received", sub: `B2B orders with money recorded against them, ${ctx.periodName}`, orders: stats.current.filter((o) => b2bPaymentState(o).received > 0), b2b: true })} />
        <Tile icon="alert" tone="warn" label="Balance Due" info="Money B2B partners still owe on these orders: order value minus amount received. Consignment orders become payable only once the partner sells the piece." value={shortInr(stats.balance)} title={fullInr(stats.balance)} note={stats.consignmentBalance > 0 ? `Includes ${shortInr(stats.consignmentBalance)} on consignment, owed only once sold` : `${num(owing.length)} partners owe money`} onClick={() => openOrders({ title: "B2B Balance Due", sub: `Order value minus amount received, ${ctx.periodName}`, orders: stats.current.filter((o) => b2bPaymentState(o).balance > 0), b2b: true })} />
      </div>
      <Insight>
        Amount Received is the money recorded against each B2B order. It goes up when you or a B2B merchandiser use <b>Update Payment</b> on an approved order: open a partner below, then the order.
        {stats.received === 0 && stats.current.length > 0 ? " No payment has been recorded on these orders yet, so it reads ₹0 until the first one is entered." : ""}
      </Insight>
      <div className="ceo-grid">
        <Card span={4} md={4} title="Buyout"><Tile label={ordersN(stats.buyout.count)} value={shortInr(stats.buyout.value)} title={fullInr(stats.buyout.value)} onClick={() => openOrders({ title: "Buyout Orders", sub: ctx.periodName, orders: stats.buyout.list, b2b: true })} /></Card>
        <Card span={4} md={4} title="Consignment"><Tile label={ordersN(stats.consignment.count)} value={shortInr(stats.consignment.value)} title={fullInr(stats.consignment.value)} onClick={() => openOrders({ title: "Consignment Orders", sub: ctx.periodName, orders: stats.consignment.list, b2b: true })} /></Card>
        <Card span={4} md={4} title="Client Order"><Tile label={ordersN(stats.clientOrder.count)} value={shortInr(stats.clientOrder.value)} title={fullInr(stats.clientOrder.value)} onClick={() => openOrders({ title: "Client Orders", sub: ctx.periodName, orders: stats.clientOrder.list, b2b: true })} /></Card>
        <Card span={12} title="Partner-wise Sales" sub="Click a partner to see their orders and record a payment">
          <div className="ceo-tools">
            <SearchBox value={search} onChange={setSearch} placeholder="Search partner" />
            <CsvButton disabled={!partners.length} onClick={() => downloadCsv({
              filename: `gm_b2b_partners_${slug(ctx.periodName)}`,
              headers: ["Partner", "Sales", "Orders", "Amount Received", "Balance Due"],
              rows: partners.map((p) => [p.name, Math.round(p.sales), p.orders, Math.round(p.received), Math.round(p.balance)]),
            })} />
          </div>
          <Table
            rowKey={(r) => r.key}
            rows={partners.slice((page - 1) * PAGE, page * PAGE)}
            onRow={openPartner}
            empty="No B2B partners found."
            columns={[
              { key: "name", label: "Partner", render: (r) => <b>{r.name}</b> },
              { key: "sales", label: "Sales", right: true, render: (r) => fullInr(r.sales) },
              { key: "orders", label: "Orders", right: true, hide: true, render: (r) => num(r.orders) },
              { key: "received", label: "Amount Received", right: true, hide: true, render: (r) => fullInr(r.received) },
              { key: "balance", label: "Balance Due", right: true, render: (r) => <span className={r.balance > 0 ? "ceo-text-crit" : undefined}>{fullInr(r.balance)}</span> },
            ]}
          />
          <Pager page={page} pages={Math.ceil(partners.length / PAGE)} onChange={setPage} />
        </Card>
        <Card span={6} title="Top B2B Products" sub="Revenue after each order's discount">
          <RankBars rows={stats.products} limit={10} sub={(r) => pieces(r.qty)} onRow={(r) => openOrders({ title: r.name, sub: `B2B orders with this design, ${ctx.periodName}`, orders: stats.current.filter((o) => (o.items || []).some((it) => (it.product_name || "Unknown") === r.name)), b2b: true })} />
        </Card>
        <Card span={6} title="Partners With Balance Due" sub="Largest balance first">
          <RankBars rows={owing.map((p) => ({ ...p, value: p.balance }))} limit={10} colorOf={() => "#c9785a"} sub={(r) => `${fullInr(r.sales)} sales · ${fullInr(r.received)} received`} onRow={openPartner} />
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ OUTSTANDING
export function OutstandingPage({ ctx }) {
  const { orders, openOrder, openOrders } = ctx;
  const [sa, setSa] = useState("");
  const [store, setStore] = useState("");
  const [bucket, setBucket] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const all = useMemo(() => buildOutstanding(orders), [orders]);
  const filtered = useMemo(() => filterOutstanding(all.rows, { sa, store, search }), [all, sa, store, search]);
  const summary = useMemo(() => summariseOutstanding(filtered), [filtered]);
  const list = bucket ? filtered.filter((r) => r.bucket === bucket) : filtered;
  useEffect(() => { setPage(1); }, [sa, store, bucket, search]);
  const over60 = summary.buckets.find((b) => b.key === "d60");
  const showRows = (title, sub, list) => openOrders({ title, sub, orders: list.map((r) => r.order) });

  const exportCsv = () => downloadCsv({
    filename: "gm_client_outstanding",
    headers: ["Order No", "Client", "Sales Associate", "Store", "Status", "Delivery Date", "Days Past Delivery", "Order Value", "Amount Received", "Balance Due"],
    rows: list.map((r) => [r.orderNo, r.customer, r.sa, r.store, getOrderStatusLabel(r.status), r.deliveryDate ? formatDate(r.deliveryDate) : "", r.days ?? "", Math.round(r.total), Math.round(r.paid), Math.round(r.balance)]),
  });

  return (
    <div className="ceo-page">
      <PageHead title="Client Outstanding" desc="Client orders still owing money, with the sales associate who took each one. B2B balances are on B2B Overview.">
        <CsvButton onClick={exportCsv} disabled={!list.length} />
      </PageHead>
      <div className="ceo-tiles">
        <Tile icon="alert" tone="warn" label="Balance Due from Clients" value={shortInr(summary.total)} title={fullInr(summary.total)} note={`${num(summary.count)} orders, all time`} onClick={() => showRows("Balance Due from Clients", "Every client order still owing money", filtered)} />
        <Tile icon="alert" tone="warn" label="Over 60 Days Past Delivery" value={shortInr(over60?.value)} title={fullInr(over60?.value)} note={`${num(over60?.count)} orders`} onClick={() => showRows("Over 60 Days Past Delivery", "Delivery date more than 60 days ago, still owing", filtered.filter((r) => r.bucket === "d60"))} />
        <Tile icon="orders" label="Sales Associates With Balances" value={num(summary.bySa.length)} note="Click to see every client order owing" onClick={() => openOrders({ title: "Client Balances", sub: "Every client order still owing money", orders: filtered.map((r) => r.order) })} />
      </div>
      <section className="ceo-buckets" aria-label="By age">
        {summary.buckets.map((b) => (
          <button key={b.key} type="button" className={b.key === "d60" ? "is-old" : undefined} onClick={() => showRows(`Balance Due: ${b.label}`, "Counted from the delivery date on the order", filtered.filter((r) => r.bucket === b.key))}>
            <small>{b.label}</small><b>{shortInr(b.value)}</b><em>{num(b.count)} orders</em>
          </button>
        ))}
      </section>
      <div className="ceo-grid">
        <Card span={6} title="Balance Due by Sales Associate" sub="Click a name to see the orders">
          <RankBars rows={summary.bySa.map((x) => ({ name: x.key, value: x.value, count: x.count, overdue: x.overdue60 }))} limit={10} colorOf={() => "#c9785a"} sub={(r) => `${num(r.count)} orders · ${shortInr(r.overdue)} over 60 days`} onRow={(r) => showRows(r.name, "Client orders still owing money", filtered.filter((x) => (x.sa || "—") === r.name))} />
        </Card>
        <Card span={6} title="Balance Due by Store" sub="Click a store to see the orders">
          <RankBars rows={summary.byStore.map((x) => ({ name: x.key, value: x.value, count: x.count, overdue: x.overdue60 }))} limit={10} colorOf={() => "#c9785a"} sub={(r) => `${num(r.count)} orders · ${shortInr(r.overdue)} over 60 days`} onRow={(r) => showRows(r.name, "Client orders still owing money", filtered.filter((x) => (x.store || "—") === r.name))} />
        </Card>
        <Card span={12} title="Orders With a Balance" sub="Oldest past delivery first">
          <div className="ceo-tools">
            <SearchBox value={search} onChange={setSearch} placeholder="Search order, client or associate" />
            <Select label="Sales associate" value={sa} onChange={setSa} options={options(all.bySa.map((x) => x.key), "All associates")} />
            <Select label="Store" value={store} onChange={setStore} options={options(all.byStore.map((x) => x.key), "All stores")} search={false} />
            <Select label="Age" value={bucket} onChange={setBucket} options={[{ value: "", label: "Any age" }, ...AGE_BUCKETS.map((b) => ({ value: b.key, label: b.label }))]} search={false} />
          </div>
          <Table
            rowKey={(r) => r.id}
            rows={list.slice((page - 1) * PAGE, page * PAGE)}
            onRow={(r) => openOrder(r.order)}
            empty="No client balances match."
            columns={[
              { key: "order", label: "Order", render: (r) => <span><b>{r.orderNo}</b><small className="ceo-cell-sub">{r.customer || "–"}</small></span> },
              { key: "sa", label: "Sales Associate", render: (r) => r.sa || "–" },
              { key: "store", label: "Store", hide: true, lap: true, render: (r) => r.store || "–" },
              { key: "due", label: "Delivery Date", hide: true, tab: true, render: (r) => (r.deliveryDate ? formatDate(r.deliveryDate) : "–") },
              { key: "days", label: "Days Past", right: true, hide: true, render: (r) => (r.days != null && r.days > 0 ? <span className={r.days > 60 ? "ceo-text-crit" : undefined}>{num(r.days)}</span> : "–") },
              { key: "total", label: "Order Value", right: true, hide: true, lap: true, render: (r) => fullInr(r.total) },
              { key: "paid", label: "Amount Received", right: true, hide: true, tab: true, render: (r) => fullInr(r.paid) },
              { key: "balance", label: "Balance Due", right: true, render: (r) => <b>{fullInr(r.balance)}</b> },
            ]}
          />
          <Pager page={page} pages={Math.ceil(list.length / PAGE)} onChange={setPage} />
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ INVENTORY HEALTH (stock levels and where the stock is)
const STATUS_FILTERS = [
  { value: "", label: "All Stock" },
  { value: "ok", label: "In Stock" },
  { value: "low", label: "Low Stock" },
  { value: "out", label: "Out of Stock" },
];
const STATUS_PILL = { ok: ["ok", "In stock"], low: ["warn", "Low"], out: ["crit", "Out"], unlimited: ["gold", "Made to order"], untracked: ["gold", "Not counted"] };
const statusPill = (r) => {
  const [tone, label] = r.type === TYPE_MTO ? ["gold", "Made to order"] : STATUS_PILL[r.status] || ["gold", r.status];
  return <i className={`ceo-pill is-${tone}`}>{label}</i>;
};
const DesignCell = ({ product }) => (
  <span className="ceo-ocell"><Thumb src={product?.image_url} alt="" /><span><b>{product?.name || "Unknown design"}</b><small>{product?.sku_id || "–"}</small></span></span>
);

const exportDesigns = (title, list, extra) => downloadCsv({
    filename: `gm_${slug(title)}`,
    headers: ["Design", "SKU", "Type", "Pieces", "Sold, 90 Days", "List Price", "Stock Value", "Status", ...(extra ? [extra.label] : [])],
    rows: list.map((r) => [r.product.name, r.product.sku_id || "", TYPE_LABELS[r.type] || "", r.stock.tracked && !r.stock.unlimited ? r.stock.total : "", r.sold90, Math.round(r.price), Math.round(r.value), r.type === TYPE_MTO ? "Made to order" : (STATUS_PILL[r.status] || ["", r.status])[1], ...(extra ? [extra.value(r)] : [])]),
  });

/** The designs behind a figure, in a drawer. `extra` adds the column the figure is made of. */
function DesignList({ list, onPick, onClose }) {
  const [page, setPage] = useState(1);
  const total = list.extra ? list.rows.reduce((a, r) => a + (Number(list.extra.value(r)) || 0), 0) : null;
  return (
    <Drawer wide title={list.title} sub={list.sub} onClose={onClose}>
      <div className="ceo-dstats">
        <Stat label="Designs" info="The number of designs in this list."><b>{num(list.rows.length)}</b></Stat>
        {list.extra && <div className="ceo-dstat"><small>{list.extra.label}</small><b>{list.extra.money ? shortInr(total) : num(total)}</b></div>}
      </div>
      <div className="gm-actions"><CsvButton disabled={!list.rows.length} onClick={() => exportDesigns(list.title, list.rows, list.extra)} /></div>
      <Table
        rowKey={(r) => r.id}
        rows={list.rows.slice((page - 1) * 12, page * 12)}
        onRow={onPick}
        empty="No designs."
        columns={[
          { key: "name", label: "Design", render: (r) => <DesignCell product={r.product} /> },
          { key: "type", label: "Type", hide: true, render: (r) => TYPE_LABELS[r.type] || "–" },
          ...(list.extra ? [{ key: "extra", label: list.extra.label, right: true, render: (r) => (list.extra.money ? fullInr(list.extra.value(r)) : num(list.extra.value(r))) }]
            : [{ key: "stock", label: "Pieces", info: "Pieces on hand. A dash means the design is made to order, so no stock is held.", right: true, render: (r) => (r.stock.tracked && !r.stock.unlimited ? num(r.stock.total) : "–") }]),
          { key: "status", label: "Status", right: true, hide: true, render: statusPill },
        ]}
      />
      <Pager page={page} pages={Math.ceil(list.rows.length / 12)} onChange={setPage} />
    </Drawer>
  );
}

export function InventoryPage({ ctx }) {
  const { stockRoom, consignment, navigate } = ctx;
  const view = useStockRoomView(stockRoom.data, 90, stockRoom.ledger);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [design, setDesign] = useState(null);
  const [list, setList] = useState(null);
  const [place, setPlace] = useState(null);
  const [consOpen, setConsOpen] = useState(null);
  useEffect(() => { setPage(1); }, [search, status, type]);

  const rows = useMemo(() => {
    if (!view) return [];
    const q = search.trim().toLowerCase();
    return view.rows.filter((r) => (!q || String(r.product.name || "").toLowerCase().includes(q) || String(r.product.sku_id || "").toLowerCase().includes(q))
      && (!status || r.status === status)
      && (!type || r.type === type));
  }, [view, search, status, type]);

  const cons = useMemo(() => ({
    sent: consignment.reduce((s, c) => s + (Number(c.quantity_sent) || 0), 0),
    sold: consignment.reduce((s, c) => s + (Number(c.quantity_sold) || 0), 0),
    left: consignment.reduce((s, c) => s + (Number(c.quantity_remaining) || 0), 0),
    lost: consignment.reduce((s, c) => s + (Number(c.quantity_lost) || 0), 0),
  }), [consignment]);

  if (stockRoom.error) return <div className="ceo-page"><PageHead title="Inventory Health" /><Card><Empty text={`Stock could not be loaded: ${stockRoom.error}`} /></Card></div>;
  if (!view) return <div className="ceo-page"><PageHead title="Inventory Health" /><Card><Empty text="Loading stock from Stock Room…" /></Card></div>;
  const t = view.totals;
  const sold = view.sales?.trackedUnits || 0;
  // Only designs with a count: made-to-order designs hold no stock.
  const counted = view.rows.filter((r) => r.stock.tracked && !r.stock.unlimited);
  const pcs = (r) => r.stock.total;
  const show = (title, sub, list, extra) => setList({ title, sub, rows: list, extra });

  const led = view.ledger;
  const located = led?.installed;
  const places = located ? led.locations.map((l) => ({ ...l, value: led.locationStats[l.id]?.units || 0, designs: led.locationStats[l.id]?.designs || 0 })).sort((a, b) => b.value - a.value) : [];
  const atLocation = (locId) => Object.entries(led.index.byLocation[locId] || {}).map(([pid, sizes]) => ({ id: pid, row: view.rowsById[pid], sizes, units: Object.values(sizes).reduce((a, q) => a + q, 0) })).filter((r) => r.units > 0);
  const placedRows = located ? counted.filter((r) => led.index.byProduct[r.id]) : [];
  const unplacedRows = located ? counted.filter((r) => (led.placementById[r.id]?.unassigned || 0) > 0) : [];
  const transitRows = located && led.transitId ? atLocation(led.transitId).map((x) => x.row).filter(Boolean) : [];
  const whereIs = design && located ? Object.entries(led.index.byProduct[design.id] || {}).flatMap(([size, locs]) => Object.entries(locs).map(([loc, q]) => ({ size, loc: led.locationsById[loc]?.name || "In transit", q }))) : [];

  return (
    <div className="ceo-page">
      <PageHead title="Inventory Health" desc="Stock levels and where the stock is, read from Stock Room so every count matches it. Made-to-order designs have no stock to count. Click any figure to see the designs behind it.">
        <button type="button" className="ceo-btn" onClick={() => navigate("/stock-room")}><Icon name="stock" />Open Stock Room</button>
      </PageHead>
      <div className="ceo-tiles">
        <Tile icon="products" label="Designs" value={num(t.designs)} note={`${num(t.lxrts)} LXRTS · ${num(t.custom)} custom · ${num(t.mto)} made to order`} onClick={() => show("All Designs", "Every live design in the catalogue", view.rows)} />
        <Tile icon="stock" label="Pieces in Stock" value={num(t.trackedUnits)} note={`${num(t.lxrtsUnits)} LXRTS · ${num(t.customUnits)} custom`} onClick={() => show("Pieces in Stock", "Counted designs holding stock, most pieces first", counted.filter((r) => pcs(r) > 0).sort((a, b) => pcs(b) - pcs(a)), { label: "Pieces", value: pcs })} />
        <Tile icon="inr" label="Stock Value" value={shortInr(t.value)} title={fullInr(t.value)} note="Pieces × list price" onClick={() => show("Stock Value", "Pieces × list price for each design, highest first", counted.filter((r) => r.value > 0).sort((a, b) => b.value - a.value), { label: "Value", value: (r) => r.value, money: true })} />
        <Tile icon="alert" tone="warn" label="Low Stock" value={num(t.low)} note="Fewer than 5 pieces" onClick={() => show("Low Stock", "Counted designs with 1 to 4 pieces", counted.filter((r) => r.status === "low").sort((a, b) => b.sold90 - a.sold90), { label: "Pieces", value: pcs })} />
        <Tile icon="alert" tone="warn" label="Out of Stock" value={num(t.out)} note="Counted designs at 0" onClick={() => show("Out of Stock", "Counted designs with no pieces, best sellers first", counted.filter((r) => r.status === "out").sort((a, b) => b.sold90 - a.sold90), { label: "Sold, 90 Days", value: (r) => r.sold90 })} />
      </div>
      <div className="ceo-grid">
        <Card span={6} title="Stock vs Sales" sub="Counted designs only, last 90 days">
          <div className="ceo-tiles">
            <Tile label="Pieces Sold" value={stockRoom.data?.salesReady === false ? "…" : num(sold)} note="Last 90 days" onClick={() => show("Pieces Sold, Last 90 Days", "Counted designs that sold, best sellers first", counted.filter((r) => r.sold90 > 0).sort((a, b) => b.sold90 - a.sold90), { label: "Sold, 90 Days", value: (r) => r.sold90 })} />
            <Tile label="Stock-to-Sales Ratio" value={sold > 0 ? `${(t.trackedUnits / sold).toFixed(1)}×` : "–"} note={`${num(t.trackedUnits)} held ÷ ${num(sold)} sold`} onClick={() => show("Stock Held Against Sales", "Pieces held by each design; the ratio is all pieces held divided by all pieces sold in 90 days", counted.filter((r) => pcs(r) > 0).sort((a, b) => pcs(b) - pcs(a)), { label: "Pieces", value: pcs })} />
          </div>
        </Card>
        <Card span={6} title="Consignment Stock" sub="Pieces sent to partners on consignment. Click to see the records.">
          <div className="ceo-tiles">
            <Tile label="Total Sent" value={num(cons.sent)} onClick={() => setConsOpen("Total Sent")} />
            <Tile label="Sold" value={num(cons.sold)} onClick={() => setConsOpen("Sold")} />
            <Tile label="Remaining" value={num(cons.left)} onClick={() => setConsOpen("Remaining")} />
            <Tile label="Lost" value={num(cons.lost)} tone={cons.lost ? "warn" : undefined} onClick={() => setConsOpen("Lost")} />
          </div>
        </Card>
        <Card span={12} title="Where the Stock Is" sub={located ? "Stock Room's locations. Click a location or figure to see the designs." : "Stock Room locations are not set up yet."}>
          {located && (
            <>
              <div className="ceo-tiles">
                <Tile icon="warehouse" label="Placed at a Location" value={num(led.totals.placedUnits)} note={`${num(places.length)} locations`} onClick={() => show("Placed at a Location", "Designs with pieces recorded at a location", placedRows, { label: "Pieces", value: pcs })} />
                <Tile icon="transfer" label="In Transit" value={num(led.totals.inTransitUnits)} note="Sent, not yet received" onClick={() => show("In Transit", "Sent between locations, not yet received", transitRows, { label: "Pieces", value: pcs })} />
                <Tile icon="alert" tone={led.totals.unassignedUnits ? "warn" : undefined} label="Not Yet Placed" value={num(led.totals.unassignedUnits)} note="In stock, location not recorded" onClick={() => show("Not Yet Placed", "Pieces in stock with no location recorded in Stock Room", unplacedRows.sort((a, b) => (led.placementById[b.id].unassigned - led.placementById[a.id].unassigned)), { label: "Not Placed", value: (r) => led.placementById[r.id]?.unassigned || 0 })} />
              </div>
              <RankBars rows={places} limit={30} format={num} sub={(r) => `${num(r.designs)} designs${r.city ? ` · ${r.city}` : ""}`} onRow={setPlace} />
            </>
          )}
        </Card>
        <Card span={12} title="Design Stock" sub="Click a design to see its sizes and where its pieces are">
          <div className="ceo-tools">
            <SearchBox value={search} onChange={setSearch} placeholder="Search design or SKU" />
            <Select label="Stock level" value={status} onChange={setStatus} options={STATUS_FILTERS} search={false} />
            <Select label="Type" value={type} onChange={setType} options={[{ value: "", label: "All types" }, ...Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))]} search={false} />
            <CsvButton disabled={!rows.length} onClick={() => exportDesigns("design stock", rows)} />
          </div>
          <Table
            rowKey={(r) => r.id}
            rows={rows.slice((page - 1) * PAGE, page * PAGE)}
            onRow={setDesign}
            empty="No designs match."
            columns={[
              { key: "name", label: "Design", render: (r) => <DesignCell product={r.product} /> },
              { key: "type", label: "Type", hide: true, render: (r) => TYPE_LABELS[r.type] || "–" },
              { key: "stock", label: "Pieces", info: "Pieces on hand. A dash means the design is made to order, so no stock is held.", right: true, render: (r) => (r.stock.tracked && !r.stock.unlimited ? num(r.stock.total) : "–") },
              { key: "sold", label: "Sold, 90 Days", right: true, hide: true, tab: true, render: (r) => num(r.sold90) },
              { key: "status", label: "Status", right: true, render: statusPill },
            ]}
          />
          <Pager page={page} pages={Math.ceil(rows.length / PAGE)} onChange={setPage} />
        </Card>
      </div>
      {list && <DesignList list={list} onPick={setDesign} onClose={() => setList(null)} />}
      {place && (
        <Drawer wide title={place.name} sub={`${num(place.value)} pieces · ${num(place.designs)} designs`} onClose={() => setPlace(null)}>
          <div className="gm-actions"><CsvButton onClick={() => downloadCsv({
            filename: `gm_stock_at_${slug(place.name)}`,
            headers: ["Design", "SKU", "Size", "Pieces"],
            rows: atLocation(place.id).flatMap((r) => Object.entries(r.sizes).filter(([, q]) => q).map(([sz, q]) => [r.row?.product.name || r.id, r.row?.product.sku_id || "", sz || "One size", q])),
          })} /></div>
          <Table
            rowKey={(r) => r.id}
            rows={atLocation(place.id).sort((a, b) => b.units - a.units)}
            onRow={(r) => r.row && setDesign(r.row)}
            empty="Nothing is held here."
            columns={[
              { key: "name", label: "Design", render: (r) => <DesignCell product={r.row?.product} /> },
              { key: "sizes", label: "Sizes", hide: true, render: (r) => Object.entries(r.sizes).filter(([, q]) => q).map(([sz, q]) => `${sz || "One size"} ${q}`).join(" · ") },
              { key: "units", label: "Pieces", info: "Pieces of this design held at this location.", right: true, render: (r) => num(r.units) },
            ]}
          />
        </Drawer>
      )}
      {consOpen && (
        <Drawer wide title={`Consignment: ${consOpen}`} sub="Every consignment record, from the consignment stock table" onClose={() => setConsOpen(null)}>
          <div className="gm-actions"><CsvButton disabled={!consignment.length} onClick={() => downloadCsv({
            filename: "gm_consignment_stock",
            headers: ["Design", "Partner", "Sent", "Sold", "Remaining", "Lost"],
            rows: consignment.map((c) => [c.product_name || c.sku_id || c.product_id || "", ctx.vendorName({ vendor_id: c.vendor_id }), c.quantity_sent || 0, c.quantity_sold || 0, c.quantity_remaining || 0, c.quantity_lost || 0]),
          })} /></div>
          <Table
            rowKey={(r, i) => r.id || i}
            rows={consignment}
            empty="No consignment records yet."
            columns={[
              { key: "item", label: "Design", render: (c) => <b>{c.product_name || c.sku_id || c.product_id || "–"}</b> },
              { key: "partner", label: "Partner", hide: true, render: (c) => ctx.vendorName({ vendor_id: c.vendor_id }) },
              { key: "sent", label: "Sent", right: true, render: (c) => num(c.quantity_sent) },
              { key: "sold", label: "Sold", info: "Consignment pieces the partner has sold.", right: true, render: (c) => num(c.quantity_sold) },
              { key: "left", label: "Remaining", right: true, hide: true, render: (c) => num(c.quantity_remaining) },
              { key: "lost", label: "Lost", right: true, hide: true, render: (c) => num(c.quantity_lost) },
            ]}
          />
        </Drawer>
      )}
      {design && (
        <Drawer title={design.product.name} sub={`${design.product.sku_id || ""} · ${TYPE_LABELS[design.type] || ""}`} onClose={() => setDesign(null)}>
          <div className="ceo-dstats">
            <Stat label="Pieces" info="Pieces on hand across all sizes."><b>{design.stock.unlimited ? "Unlimited" : num(design.stock.total)}</b></Stat>
            <Stat label="Sold, 90 Days" info="Pieces of this design sold to clients in the last 90 days."><b>{num(design.sold90)}</b></Stat>
            <Stat label="List Price" info="The design's price in the catalogue."><b>{fullInr(design.price)}</b></Stat>
          </div>
          {design.type === TYPE_MTO ? <Empty text="Made to order: there is no stock to count." /> : design.stock.bySize && Object.keys(design.stock.bySize).length ? (
            <dl className="ceo-dl">
              {(design.stock.sizes || Object.keys(design.stock.bySize)).map((s) => <React.Fragment key={s}><dt>Size {s}</dt><dd className={design.stock.bySize[s] === 0 ? "ceo-text-crit" : undefined}>{num(design.stock.bySize[s])}</dd></React.Fragment>)}
            </dl>
          ) : <Empty text={design.type === TYPE_LXRTS ? "No sizes are set up for this design." : "Counted as one total, without sizes."} />}
          {located && design.type !== TYPE_MTO && (
            <dl className="ceo-dl">
              {whereIs.length ? whereIs.map((w) => <React.Fragment key={`${w.size}-${w.loc}`}><dt>{w.loc}{w.size ? `, size ${w.size}` : ""}</dt><dd>{num(w.q)}</dd></React.Fragment>)
                : <><dt>Location</dt><dd>Not recorded in Stock Room</dd></>}
            </dl>
          )}
          <button type="button" className="ceo-btn is-primary is-block" onClick={() => navigate("/stock-room?screen=stock")}>Manage in Stock Room</button>
        </Drawer>
      )}
    </div>
  );
}

// ------------------------------------------------------------ RETURNS
const ISSUE_KINDS = [
  { key: "cancelled", label: "Cancellations", single: "Cancelled", test: (o) => o.status === "cancelled", reason: "cancellation_reason", color: "#c0563f" },
  // A return or exchange is marked by its reason or by the order's status:
  // some exchange orders carry the status but no reason, and the other way round.
  { key: "returned", label: "Returns", single: "Return", test: (o) => !!o.return_reason || ["return_store_credit", "returned", "partial_return"].includes(o.status), reason: "return_reason", color: "#c9785a" },
  { key: "refunded", label: "Refunds", single: "Refund", test: (o) => !!o.refund_reason || !!o.refund_status, reason: "refund_reason", color: "#7b3a5e" },
  { key: "exchanged", label: "Exchanges", single: "Exchange", test: (o) => !!o.exchange_reason || o.status === "exchange_return", reason: "exchange_reason", color: "#2f6f73" },
  // Still revoked. Several orders were revoked once and then delivered; they keep
  // revoked_at but are not revoked any more.
  { key: "revoked", label: "Revoked", single: "Revoked", test: (o) => o.status === "revoked", reason: "revoke_reason", color: "#6d6a9c" },
];

export function ReturnsPage({ ctx }) {
  const { orders, inPeriod, personOf, isPerson, openOrders, openOrder } = ctx;
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);
  const data = useMemo(() => {
    const inScope = orders.filter((o) => inPeriod(o.created_at));
    const kinds = ISSUE_KINDS.map((k) => {
      const list = inScope.filter(k.test);
      const reasons = {};
      list.forEach((o) => {
        const r = o[k.reason] || "Not specified";
        (reasons[r] || (reasons[r] = { name: r, value: 0, list: [] })).value += 1;
        reasons[r].list.push(o);
      });
      return { ...k, list, value: sumOf(list), reasons: Object.values(reasons).sort((a, b) => b.value - a.value) };
    });
    const issues = inScope.filter((o) => ISSUE_KINDS.some((k) => k.test(o)));
    const people = {};
    issues.forEach((o) => {
      const name = personOf(o);
      if (!isPerson(name)) return;
      const p = people[name] || (people[name] = { name, total: 0, value: 0, list: [], ...Object.fromEntries(ISSUE_KINDS.map((k) => [k.key, 0])) });
      ISSUE_KINDS.forEach((k) => { if (k.test(o)) p[k.key] += 1; });
      p.total += 1; p.value += totalOf(o); p.list.push(o);
    });
    // Revoked orders are not money lost, so the value excludes them as before.
    const issueValue = sumOf(inScope.filter((o) => ISSUE_KINDS.slice(0, 4).some((k) => k.test(o))));
    return { kinds, issues, issueValue, people: Object.values(people).sort((a, b) => b.total - a.total) };
  }, [orders, inPeriod, personOf, isPerson]);

  useEffect(() => { setPage(1); }, [kind]);
  const picked = data.kinds.find((k) => k.key === kind);
  const list = (picked ? picked.list : data.issues).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const kindOf = (o) => ISSUE_KINDS.filter((k) => k.test(o)).map((k) => k.single).join(", ");
  const reasonOf = (o) => ISSUE_KINDS.map((k) => (k.test(o) ? o[k.reason] : null)).find(Boolean) || "Not specified";

  return (
    <div className="ceo-page">
      <PageHead title="Returns & Analytics" desc="Orders placed in this period that were later cancelled, returned, refunded, exchanged or revoked. An order counts once in the total value even if it has two issues. Click any figure to see the orders behind it."><PeriodNote ctx={ctx} /></PageHead>
      <div className="ceo-tiles">
        {data.kinds.map((k) => (
          <Tile key={k.key} label={k.label} value={num(k.list.length)} note={k.key === "revoked" ? "Orders revoked" : shortInr(k.value)} onClick={() => openOrders({ title: k.label, sub: `Orders placed in ${ctx.periodName.toLowerCase()}`, orders: k.list })} />
        ))}
        <Tile icon="alert" tone="warn" label="Total Issue Value" value={shortInr(data.issueValue)} title={fullInr(data.issueValue)} note="Cancelled, returned, refunded and exchanged" onClick={() => openOrders({ title: "Total Issue Value", sub: "Cancelled, returned, refunded and exchanged orders, each counted once", orders: data.issues.filter((o) => ISSUE_KINDS.slice(0, 4).some((k) => k.test(o))) })} />
      </div>
      <div className="ceo-grid">
        {data.kinds.filter((k) => k.reasons.length && k.key !== "revoked").map((k) => (
          <Card key={k.key} span={6} title={`${k.key === "cancelled" ? "Cancellation" : k.single} Reasons`} sub="Click a reason to see its orders">
            <RankBars rows={k.reasons} limit={8} format={num} colorOf={() => k.color} onRow={(r) => openOrders({ title: r.name, sub: `${k.label}, ${ctx.periodName}`, orders: r.list })} />
          </Card>
        ))}
        {data.people.length > 0 && (
          <Card span={12} title="Issues by Sales Associate" sub="Click a name to see their orders">
            <Table
              rowKey={(r) => r.name}
              rows={data.people}
              onRow={(r) => openOrders({ title: r.name, sub: `Issue orders, ${ctx.periodName}`, orders: r.list })}
              columns={[
                { key: "name", label: "Sales Associate", render: (r) => <b>{r.name}</b> },
                ...ISSUE_KINDS.map((k, i) => ({ key: k.key, label: k.label, right: true, hide: i > 0, render: (r) => num(r[k.key]) })),
                { key: "value", label: "Value", right: true, render: (r) => fullInr(r.value) },
              ]}
            />
          </Card>
        )}
        <Card span={12} title={picked ? picked.label : "All Issue Orders"} sub="Newest first. Choose an issue to narrow the list.">
          <div className="ceo-tools">
            <Seg label="Issue" value={kind} onChange={setKind} options={[{ value: "", label: "All", count: data.issues.length }, ...data.kinds.map((k) => ({ value: k.key, label: k.label, count: k.list.length }))]} />
            <CsvButton disabled={!list.length} onClick={() => downloadCsv({
              filename: `gm_${slug(picked ? picked.label : "issue orders")}_${slug(ctx.periodName)}`,
              headers: ["Order No", "Order Date", "Client", "Sales Associate", "Issue", "Reason", "Status", "Value"],
              rows: list.map((o) => [o.order_no, formatDate(o.created_at), ctx.clientOf(o), personOf(o) || "", kindOf(o), reasonOf(o), getOrderStatusLabel(o.status), Math.round(totalOf(o))]),
            })} />
          </div>
          <Table
            rowKey={(r) => r.id}
            rows={list.slice((page - 1) * PAGE, page * PAGE)}
            onRow={openOrder}
            empty="No issues in this period."
            columns={[
              { key: "order", label: "Order", render: (o) => <OrderCell o={o} ctx={ctx} /> },
              { key: "kind", label: "Issue", hide: true, render: kindOf },
              { key: "reason", label: "Reason", hide: true, lap: true, render: (o) => <span className="ceo-clip" title={reasonOf(o)}>{reasonOf(o)}</span> },
              { key: "sa", label: "Sales Associate", hide: true, tab: true, render: (o) => personOf(o) || "–" },
              { key: "value", label: "Value", right: true, render: (o) => fullInr(totalOf(o)) },
              { key: "date", label: "Order Date", right: true, hide: true, render: (o) => formatDate(o.created_at) },
            ]}
          />
          <Pager page={page} pages={Math.ceil(list.length / PAGE)} onChange={setPage} />
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ ORDERS
const STATUS_TABS = [
  { value: "all", label: "All Orders" },
  { value: "unfulfilled", label: "Unfulfilled" },
  { value: "prepared", label: "Prepared" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];
const matchesTab = (o, tab) => {
  const s = String(o.status || "").toLowerCase();
  if (tab === "unfulfilled") return s !== "completed" && s !== "delivered" && s !== "cancelled";
  if (tab === "prepared") return s === "completed";
  if (tab === "delivered") return s === "delivered";
  if (tab === "cancelled") return s === "cancelled";
  return true;
};
const SEARCH_FIELDS = [
  { value: "order_no", label: "Order Number" },
  { value: "product_name", label: "Product Name" },
  { value: "client_name", label: "Client Name" },
  { value: "phone", label: "Phone" },
  { value: "salesperson", label: "Salesperson" },
];
const SORTS = [
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
  { value: "delivery", label: "Delivery Date" },
  { value: "amount_high", label: "Amount: High to Low" },
  { value: "amount_low", label: "Amount: Low to High" },
];
const NO_FILTERS = { minPrice: "", maxPrice: "", payment: [], priority: [], orderType: [], store: [], salesperson: "" };
const orderNumber = (no) => {
  const m = String(no || "").replace(/-[A-Z]\d*$/, "").match(/(\d{2})(\d{2})-(\d{6})$/);
  return m ? parseInt(m[2] + m[1] + m[3], 10) : 0;
};

/** A period picker for one page's own list, drawn with our chips and calendar. */
function usePagePeriod() {
  const [period, setPeriod] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const range = useMemo(() => {
    if (period === "all") return null;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === "custom") return from ? { start: new Date(`${from}T00:00:00`), end: to ? new Date(`${to}T23:59:59.999`) : new Date(`${from}T23:59:59.999`) } : null;
    if (period === "today") return { start, end: now };
    if (period === "week") { start.setDate(start.getDate() - 6); return { start, end: now }; }
    if (period === "month") return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
    if (period === "year") return { start: new Date(now.getFullYear(), 0, 1), end: now };
    return null;
  }, [period, from, to]);
  const inPeriod = (ts) => !range || (ts && new Date(ts) >= range.start && new Date(ts) <= range.end);
  return { period, setPeriod, from, to, setRange: (a, b) => { setFrom(a); setTo(b); }, range, inPeriod, reset: () => { setPeriod("all"); setFrom(""); setTo(""); } };
}
const PAGE_PERIODS = [
  { value: "all", label: "All Time" }, { value: "today", label: "Today" }, { value: "week", label: "Last 7 Days" },
  { value: "month", label: "This Month" }, { value: "year", label: "This Year" }, { value: "custom", label: "Choose dates" },
];
function PeriodFacet({ p, label = "Order Date" }) {
  return (
    <FilterGroup label={label}>
      <Chips options={PAGE_PERIODS} value={p.period} onChange={(v) => p.setPeriod(v || "all")} />
      {p.period === "custom" && <DateRange from={p.from} to={p.to} onChange={p.setRange} />}
    </FilterGroup>
  );
}
const FilterFooter = ({ count, noun, onClear, onClose }) => (
  <>
    <button type="button" className="ceo-btn" onClick={onClear}>Clear Filters</button>
    <button type="button" className="ceo-btn is-primary" onClick={onClose}>Show {num(count)} {noun}</button>
  </>
);

export function OrdersPage({ ctx }) {
  const { orders, personOf, isPerson, openOrder, openJourney, makePdf, pdfBusy, startPlaceOrder, clientOf } = ctx;
  const [search, setSearch] = useState("");
  const [field, setField] = useState("order_no");
  const [sort, setSort] = useState("newest");
  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [drawer, setDrawer] = useState(false);
  const p = usePagePeriod();
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  // Website-synced (LXRTS) orders stay out of this list, as before.
  const base = useMemo(() => orders.filter((o) => !isLxrtsOrder(o)), [orders]);
  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = Number(filters.minPrice) || 0;
    const max = filters.maxPrice === "" ? Infinity : Number(filters.maxPrice);
    return base.filter((o) => {
      if (q) {
        const hit = field === "product_name" ? (o.items || []).some((it) => it?.product_name?.toLowerCase().includes(q))
          : field === "client_name" ? clientOf(o).toLowerCase().includes(q)
            : field === "phone" ? (o.delivery_phone || "").includes(q)
              : field === "salesperson" ? (personOf(o) || "").toLowerCase().includes(q)
                : o.order_no?.toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (p.range && !p.inPeriod(o.created_at)) return false;
      const total = totalOf(o);
      if (total < min || total > max) return false;
      if (filters.payment.length && !filters.payment.includes(paymentOf(o))) return false;
      if (filters.priority.length && !filters.priority.includes(priorityOf(o))) return false;
      if (filters.orderType.length && !filters.orderType.includes(typeOf(o))) return false;
      if (filters.store.length && !filters.store.includes(o.salesperson_store)) return false;
      if (filters.salesperson && personOf(o) !== filters.salesperson) return false;
      return true;
    });
  }, [base, search, field, filters, p.range]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => Object.fromEntries(STATUS_TABS.map((t) => [t.value, scoped.filter((o) => matchesTab(o, t.value)).length])), [scoped]);
  const list = useMemo(() => scoped.filter((o) => matchesTab(o, tab)).sort((a, b) => {
    switch (sort) {
      case "oldest": return orderNumber(a.order_no) - orderNumber(b.order_no);
      case "delivery": return new Date(a.delivery_date || 0) - new Date(b.delivery_date || 0);
      case "amount_high": return totalOf(b) - totalOf(a);
      case "amount_low": return totalOf(a) - totalOf(b);
      default: return orderNumber(b.order_no) - orderNumber(a.order_no);
    }
  }), [scoped, tab, sort]);
  useEffect(() => { setPage(1); }, [search, field, filters, tab, sort, p.range]);

  const people = useMemo(() => [...new Set(base.map(personOf).filter((s) => isPerson(s)))].sort(), [base, personOf, isPerson]);
  const stores = useMemo(() => [...new Set(base.map((o) => o.salesperson_store).filter(Boolean))].sort(), [base]);
  const active = (filters.minPrice || filters.maxPrice ? 1 : 0) + filters.payment.length + filters.priority.length + filters.orderType.length + filters.store.length + (filters.salesperson ? 1 : 0) + (p.period !== "all" ? 1 : 0);
  const clear = () => { setFilters(NO_FILTERS); p.reset(); };
  const stop = (e) => e.stopPropagation();

  const exportCsv = () => downloadCsv({
    filename: "gm_orders",
    headers: ["Order No", "Product Name", "Customer Name", "Customer Number", "Size", "Amount", "SA Name", "Store", "Status", "Order Date", "Delivery Date"],
    rows: list.map((o) => {
      const item = o.items?.[0] || {};
      return [o.order_no || "", item.product_name || "", clientOf(o), o.delivery_phone || "", item.size || "", totalOf(o), personOf(o) || "", o.salesperson_store || "", o.status || "", o.created_at ? formatDate(o.created_at) : "", o.delivery_date ? formatDate(o.delivery_date) : ""];
    }),
  });

  return (
    <div className="ceo-page">
      <PageHead title="Order Management" desc="Find any order, follow each piece through production, and download its client or warehouse PDF.">
        <FilterButton count={active} onClick={() => setDrawer(true)} />
        <CsvButton onClick={exportCsv} disabled={!list.length} />
        <button type="button" className="ceo-btn is-primary" onClick={startPlaceOrder}><Icon name="plus" />Place Order</button>
      </PageHead>
      <Card>
        <div className="ceo-tools">
          <Select label="Search by" value={field} onChange={setField} options={SEARCH_FIELDS} search={false} />
          <SearchBox value={search} onChange={setSearch} placeholder={`Search by ${SEARCH_FIELDS.find((f) => f.value === field).label.toLowerCase()}`} />
          <Select label="Sort" value={sort} onChange={setSort} options={SORTS} search={false} />
        </div>
        <div className="ceo-tools">
          <Seg label="Status" value={tab} onChange={setTab} options={STATUS_TABS.map((t) => ({ ...t, count: counts[t.value] }))} />
        </div>
        <Table
          rowKey={(r) => r.id}
          rows={list.slice((page - 1) * PAGE, page * PAGE)}
          empty="No orders found."
          onRow={openOrder}
          columns={[
            { key: "order", label: "Order", render: (o) => <OrderCell o={o} ctx={ctx} /> },
            { key: "design", label: "Product", hide: true, lap: true, render: (o) => <span className="ceo-clip" title={o.items?.[0]?.product_name}>{o.items?.[0]?.product_name || "–"}</span> },
            { key: "value", label: "Amount", right: true, render: (o) => fullInr(totalOf(o)) },
            { key: "pay", label: "Payment", hide: true, tab: true, render: (o) => <PaymentPill order={o} /> },
            { key: "status", label: "Status", hide: true, render: (o) => getOrderProgressStatus(o) },
            { key: "sa", label: "SA", hide: true, lap: true, render: (o) => personOf(o) || "–" },
            { key: "store", label: "Store", hide: true, lap: true, render: (o) => o.salesperson_store || "–" },
            { key: "date", label: "Date", right: true, hide: true, tab: true, render: (o) => formatDate(o.created_at) },
            { key: "journey", label: "Journey", hide: true, render: (o) => <small className="ceo-muted">{journeyLine(o)}</small> },
            {
              key: "act", label: "", right: true,
              render: (o) => (
                <span className="ceo-page-actions" onClick={stop} onKeyDown={stop} role="presentation">
                  <button type="button" className="ceo-btn is-small" onClick={() => openJourney(o)}>Journey</button>
                  <button type="button" className="ceo-btn is-small ceo-hide-sm" onClick={() => makePdf(o, "customer")} disabled={pdfBusy === o.id}>{pdfBusy === o.id ? "…" : "PDF"}</button>
                </span>
              ),
            },
          ]}
        />
        <Pager page={page} pages={Math.ceil(list.length / PAGE)} onChange={setPage} />
      </Card>
      {drawer && (
        <Drawer title="Filters" sub="Narrow the order list" onClose={() => setDrawer(false)} footer={<FilterFooter count={list.length} noun="orders" onClear={clear} onClose={() => setDrawer(false)} />}>
          <PeriodFacet p={p} />
          <FilterGroup label="Payment Status"><Chips options={[{ value: "paid", label: "Paid" }, { value: "partial", label: "Partly Paid" }, { value: "unpaid", label: "Unpaid" }]} value={filters.payment} onChange={(v) => set("payment", v)} /></FilterGroup>
          <FilterGroup label="Priority"><Chips options={[{ value: "normal", label: "Normal" }, { value: "urgent", label: "Urgent" }]} value={filters.priority} onChange={(v) => set("priority", v)} /></FilterGroup>
          <FilterGroup label="Order Type"><Chips options={[{ value: "standard", label: "Standard" }, { value: "custom", label: "Custom" }, { value: "alteration", label: "Alteration" }]} value={filters.orderType} onChange={(v) => set("orderType", v)} /></FilterGroup>
          <FilterGroup label="Store"><Chips options={stores.map((s) => ({ value: s, label: s }))} value={filters.store} onChange={(v) => set("store", v)} /></FilterGroup>
          <FilterGroup label="Salesperson"><Select label="Salesperson" value={filters.salesperson} onChange={(v) => set("salesperson", v)} options={options(people, "All salespersons")} /></FilterGroup>
          <FilterGroup label="Order Value">
            <div className="ceo-range">
              <label><span>₹</span><input type="text" inputMode="numeric" placeholder="From" aria-label="Lowest value" value={filters.minPrice} onChange={(e) => set("minPrice", e.target.value.replace(/\D/g, ""))} /></label>
              <em>to</em>
              <label><span>₹</span><input type="text" inputMode="numeric" placeholder="To" aria-label="Highest value" value={filters.maxPrice} onChange={(e) => set("maxPrice", e.target.value.replace(/\D/g, ""))} /></label>
            </div>
          </FilterGroup>
        </Drawer>
      )}
    </div>
  );
}

// ------------------------------------------------------------ ACCOUNTS
// The customer invoice (pdf/CustomerOrderPdf.js) takes GST out of the price at
// 18%, so Accounts uses the same rate and the two always agree.
const GST_RATE = 0.18;
const ACCOUNT_STATUSES = ["order_received", "dispatched", "delivered", "completed", "cancelled"];

export function AccountsPage({ ctx }) {
  const { orders, personOf, isPerson, clientOf } = ctx;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [store, setStore] = useState("");
  const [sa, setSa] = useState("");
  const [page, setPage] = useState(1);
  const p = usePagePeriod();
  const [drawer, setDrawer] = useState(false);

  const lines = useMemo(() => {
    const out = [];
    orders.forEach((order) => {
      if (isLxrtsOrder(order)) return;
      const items = order.items || [];
      // Each line's share of the order, by its price. The order's own totals are
      // then split by that share, so the lines always add up to the order: the
      // MRP (grand_total) includes extras that are not in the item price, and
      // the billed value (net_total) includes B2B markdown, which discount_amount
      // does not.
      const itemSum = items.reduce((s, it) => s + Number(it.price || 0) * Number(it.quantity || 1), 0);
      const orderGross = Number(order.grand_total) || itemSum;
      const orderInvoice = totalOf(order);
      items.forEach((item, idx) => {
        const quantity = Number(item.quantity || 1);
        const share = itemSum > 0 ? (Number(item.price || 0) * quantity) / itemSum : 1 / items.length;
        const grossValue = orderGross * share;
        const invoice = orderInvoice * share;
        const itemDiscount = Math.max(0, grossValue - invoice);
        const taxable = invoice / (1 + GST_RATE);
        out.push({
          id: `${order.id}-${idx}`, order, orderNo: order.order_no, date: order.created_at, sa: personOf(order) || "–", client: clientOf(order),
          product: item.product_name || "–", gross: grossValue, discount: itemDiscount, taxable, gst: invoice - taxable, invoice, quantity,
          status: order.status || "order_received", delivery: item.delivery_date || order.delivery_date, store: order.salesperson_store || "–",
        });
      });
    });
    return out;
  }, [orders, personOf, clientOf]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lines.filter((l) => (!q || [l.orderNo, l.client, l.product, l.sa].some((v) => String(v || "").toLowerCase().includes(q)))
      && (!p.range || p.inPeriod(l.date))
      && (!status || (l.status === "pending" ? "order_received" : l.status) === status)
      && (!store || l.store === store)
      && (!sa || l.sa === sa));
  }, [lines, search, p.range, status, store, sa]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, [search, p.range, status, store, sa]);
  // Totals count only orders that brought money in: cancelled and returned
  // lines stay in the list, marked by their status, but are not added up.
  const totals = useMemo(() => filtered.filter((l) => isRevenueOrder(l.order)).reduce((t, l) => ({ gross: t.gross + l.gross, discount: t.discount + l.discount, gst: t.gst + l.gst, invoice: t.invoice + l.invoice }), { gross: 0, discount: 0, gst: 0, invoice: 0 }), [filtered]);
  const openTotal = (title, sub) => {
    const seen = new Set();
    const list = filtered.filter((l) => isRevenueOrder(l.order) && !seen.has(l.order.id) && seen.add(l.order.id)).map((l) => l.order);
    ctx.openOrders({ title, sub: `${sub}. Cancelled and returned orders are left out.`, orders: list });
  };
  const storeOptions = useMemo(() => [...new Set(lines.map((l) => l.store).filter((s) => s && s !== "–"))].sort(), [lines]);
  const saOptions = useMemo(() => [...new Set(lines.map((l) => l.sa).filter((s) => isPerson(s)))].sort(), [lines, isPerson]);
  const active = (status ? 1 : 0) + (store ? 1 : 0) + (sa ? 1 : 0) + (p.period !== "all" ? 1 : 0);

  return (
    <div className="ceo-page">
      <PageHead title="Accounts & Finance" desc="Every line item with its discount, taxable value and GST (18%, as on the customer invoice). Totals leave out cancelled and returned orders; website orders are not listed.">
        <FilterButton count={active} onClick={() => setDrawer(true)} />
      </PageHead>
      <div className="ceo-tiles">
        <Tile icon="inr" label="Gross Value" value={shortInr(totals.gross)} title={fullInr(totals.gross)} note="MRP, extras included" onClick={() => openTotal("Gross Value", "The MRP of each order, extras included")} />
        <Tile icon="sale" label="Total Discount" value={shortInr(totals.discount)} title={fullInr(totals.discount)} note="Discounts and B2B markdown" onClick={() => openTotal("Total Discount", "MRP minus what was billed: discounts, codes and B2B partner markdown")} />
        <Tile icon="doc" label="Total GST" value={shortInr(totals.gst)} title={fullInr(totals.gst)} note="18% inside the billed value" onClick={() => openTotal("Total GST", "18% taken out of the billed value, as on the customer invoice")} />
        <Tile icon="trend" label="Invoice Value" value={shortInr(totals.invoice)} title={fullInr(totals.invoice)} note="What was billed" onClick={() => openTotal("Invoice Value", "What each order was billed")} />
      </div>
      <Card>
        <div className="ceo-tools">
          <SearchBox value={search} onChange={setSearch} placeholder="Search order, client, product or associate" />
          <CsvButton disabled={!filtered.length} onClick={() => downloadCsv({
            filename: "gm_accounts_line_items",
            headers: ["SA Name", "Order No", "Order Date", "Client", "Product", "Gross", "Discount", "Taxable", "GST", "Invoice", "Qty", "Status", "Counted in Totals", "Delivery Date", "Store"],
            rows: filtered.map((l) => [l.sa, l.orderNo, formatDate(l.date), l.client, l.product, l.gross.toFixed(2), l.discount.toFixed(2), l.taxable.toFixed(2), l.gst.toFixed(2), l.invoice.toFixed(2), l.quantity, getOrderStatusLabel(l.status), isRevenueOrder(l.order) ? "Yes" : "No", l.delivery ? formatDate(l.delivery) : "", l.store]),
          })} />
        </div>
        <Table
          rowKey={(r) => r.id}
          rows={filtered.slice((page - 1) * 20, page * 20)}
          onRow={(l) => ctx.openOrder(l.order)}
          empty="No records found."
          columns={[
            { key: "sa", label: "SA Name", hide: true, lap: true, render: (l) => l.sa },
            { key: "order", label: "Order", render: (l) => <span><b>{l.orderNo}</b><small className="ceo-cell-sub">{l.client}</small></span> },
            { key: "date", label: "Date", hide: true, tab: true, render: (l) => formatDate(l.date) },
            { key: "product", label: "Product", hide: true, render: (l) => <span className="ceo-clip" title={l.product}>{l.product}</span> },
            { key: "gross", label: "Gross", right: true, hide: true, lap: true, render: (l) => fullInr(l.gross) },
            { key: "discount", label: "Discount", right: true, hide: true, lap: true, render: (l) => fullInr(l.discount) },
            { key: "taxable", label: "Taxable", right: true, hide: true, tab: true, render: (l) => fullInr(l.taxable) },
            { key: "gst", label: "GST", right: true, hide: true, tab: true, render: (l) => fullInr(l.gst) },
            { key: "invoice", label: "Invoice", right: true, render: (l) => <b>{fullInr(l.invoice)}</b> },
            { key: "qty", label: "Qty", right: true, hide: true, lap: true, render: (l) => num(l.quantity) },
            { key: "status", label: "Status", hide: true, render: (l) => <i className={`ceo-pill is-${normalizeOrderStatus(l.status) === "cancelled" ? "crit" : normalizeOrderStatus(l.status) === "delivered" ? "ok" : "gold"}`}>{getOrderStatusLabel(l.status)}</i> },
            { key: "delivery", label: "Delivery Date", hide: true, lap: true, render: (l) => (l.delivery ? formatDate(l.delivery) : "–") },
          ]}
        />
        <Pager page={page} pages={Math.ceil(filtered.length / 20)} onChange={setPage} />
      </Card>
      {drawer && (
        <Drawer title="Filters" sub="Narrow the line items" onClose={() => setDrawer(false)} footer={<FilterFooter count={filtered.length} noun="lines" onClear={() => { p.reset(); setStatus(""); setStore(""); setSa(""); }} onClose={() => setDrawer(false)} />}>
          <PeriodFacet p={p} />
          <FilterGroup label="Status"><Chips options={ACCOUNT_STATUSES.map((s) => ({ value: s, label: getOrderStatusLabel(s) }))} value={status} onChange={setStatus} /></FilterGroup>
          <FilterGroup label="Store"><Chips options={storeOptions.map((s) => ({ value: s, label: s }))} value={store} onChange={setStore} /></FilterGroup>
          <FilterGroup label="Salesperson"><Select label="Salesperson" value={sa} onChange={setSa} options={options(saOptions, "All salespersons")} /></FilterGroup>
        </Drawer>
      )}
    </div>
  );
}

// ------------------------------------------------------------ EXHIBITIONS + OVERRIDES
export function ExhibitionsPage({ ctx }) {
  return (
    <div className="ceo-page">
      <PageHead title="Exhibition Approvals" desc="Approve or reject exhibition requests." />
      <Card className="gm-classic"><ExhibitionApprovals currentUserEmail={ctx.currentUserEmail} /></Card>
    </div>
  );
}
export function OverridePage() {
  return (
    <div className="ceo-page">
      <PageHead title="Override Log" desc="Every production override, with who made it and why. Overrides are made on the Production Manager dashboard." />
      <Card className="gm-classic"><OverrideHistory /></Card>
    </div>
  );
}

// ------------------------------------------------------------ DELIVERY WATCH
// Client orders still in progress, against the delivery date promised to the
// client. "Still in progress" is the shared rule (not delivered, completed,
// dispatched or cancelled); days are counted on the date alone.
const WATCH_VIEWS = [
  { value: "late", label: "Past Delivery Date" },
  { value: "today", label: "Due Today" },
  { value: "week", label: "Due in Next 7 Days" },
];
export function DeliveryPage({ ctx }) {
  const { orders, channelOf, personOf, isPerson, openOrders, openOrder } = ctx;
  const [view, setView] = useState("late");
  const [page, setPage] = useState(1);
  const data = useMemo(() => {
    // Website orders are left out: they are fulfilled on Shopify and never
    // marked delivered here, so every one would look late.
    const running = orders.filter((o) => isSaleOrder(o) && isOrderStillRunning(o) && o.delivery_date && channelOf(o) !== "Shopify")
      .map((o) => ({ o, days: daysPastDelivery(o) }));
    const late = running.filter((r) => r.days > 0).sort((a, b) => b.days - a.days);
    const today = running.filter((r) => r.days === 0);
    const week = running.filter((r) => r.days < 0 && r.days >= -7).sort((a, b) => b.days - a.days);
    const group = (list, keyOf) => {
      const m = {};
      list.forEach((r) => { const k = keyOf(r.o) || "Not set"; const g = m[k] || (m[k] = { name: k, value: 0, count: 0, list: [] }); g.value += 1; g.count += 1; g.list.push(r.o); });
      return Object.values(m).sort((a, b) => b.value - a.value);
    };
    const stageOf = (o) => (o.warehouse_stage && o.warehouse_stage !== "order_received" ? getStageLabel(o.warehouse_stage) || o.warehouse_stage : "Not started");
    return {
      late, today, week,
      byChannel: group(late, channelOf),
      byStage: group(late, stageOf),
      bySa: group(late, (o) => (isPerson(personOf(o)) ? personOf(o) : "No associate recorded")),
      over30: late.filter((r) => r.days > 30),
    };
  }, [orders, channelOf, personOf, isPerson]);
  useEffect(() => { setPage(1); }, [view]);
  const list = data[view];
  const value = (l) => l.reduce((s, r) => s + totalOf(r.o), 0);
  const viewLabel = WATCH_VIEWS.find((v) => v.value === view).label;

  return (
    <div className="ceo-page">
      <PageHead title="Delivery Watch" desc="Store, B2B, exhibition and private orders still in progress against the delivery date promised. Website orders are left out: they are fulfilled on Shopify and never marked delivered here. Click any figure to see the orders.">
        <CsvButton label="Export Late Orders" disabled={!data.late.length} onClick={() => exportOrders("orders past delivery date", data.late.map((r) => r.o), ctx)} />
      </PageHead>
      <div className="ceo-tiles">
        <Tile icon="alert" tone="warn" label="Past Delivery Date" value={num(data.late.length)} note={`${shortInr(value(data.late))} of orders`} onClick={() => openOrders({ title: "Past Delivery Date", sub: "Still in progress after the promised date", orders: data.late.map((r) => r.o) })} />
        <Tile icon="alert" tone="warn" label="Over 30 Days Late" value={num(data.over30.length)} note={`${shortInr(value(data.over30))} of orders`} onClick={() => openOrders({ title: "Over 30 Days Late", sub: "More than 30 days past the promised date", orders: data.over30.map((r) => r.o) })} />
        <Tile icon="orders" label="Due Today" value={num(data.today.length)} note={`${shortInr(value(data.today))} of orders`} onClick={() => openOrders({ title: "Due Today", sub: "Promised for today, still in progress", orders: data.today.map((r) => r.o) })} />
        <Tile icon="trend" label="Due in Next 7 Days" value={num(data.week.length)} note={`${shortInr(value(data.week))} of orders`} onClick={() => openOrders({ title: "Due in Next 7 Days", sub: "Promised in the coming week, still in progress", orders: data.week.map((r) => r.o) })} />
      </div>
      <div className="ceo-grid">
        <Card span={4} md={6} title="Late Orders by Channel" sub="Click to see the orders">
          <RankBars rows={data.byChannel} format={(v) => ordersN(v)} colorOf={() => "#c9785a"} limit={8} onRow={(r) => openOrders({ title: `${r.name}: past delivery date`, sub: "Still in progress after the promised date", orders: r.list })} />
        </Card>
        <Card span={4} md={6} title="Late Orders by Production Stage" sub="Where each late order is now">
          <RankBars rows={data.byStage} format={(v) => ordersN(v)} colorOf={() => "#c9785a"} limit={8} onRow={(r) => openOrders({ title: `${r.name}: past delivery date`, sub: "Late orders at this stage", orders: r.list })} />
        </Card>
        <Card span={4} title="Late Orders by Sales Associate" sub="Who took each late order">
          <RankBars rows={data.bySa} format={(v) => ordersN(v)} colorOf={() => "#c9785a"} limit={8} onRow={(r) => openOrders({ title: `${r.name}: past delivery date`, sub: "Late orders this associate took", orders: r.list })} />
        </Card>
        <Card span={12} title={viewLabel}>
          <div className="ceo-tools">
            <Seg label="Show" value={view} onChange={setView} options={WATCH_VIEWS.map((v) => ({ ...v, count: data[v.value].length }))} />
            <CsvButton disabled={!list.length} onClick={() => exportOrders(viewLabel, list.map((r) => r.o), ctx)} />
          </div>
          <Table
            rowKey={(r) => r.o.id}
            rows={list.slice((page - 1) * PAGE, page * PAGE)}
            onRow={(r) => openOrder(r.o)}
            empty="Nothing here."
            columns={[
              { key: "order", label: "Order", render: (r) => <OrderCell o={r.o} ctx={ctx} /> },
              { key: "channel", label: "Channel", hide: true, lap: true, render: (r) => channelOf(r.o) },
              { key: "sa", label: "Sales Associate", hide: true, tab: true, render: (r) => personOf(r.o) || "–" },
              { key: "stage", label: "Production", hide: true, render: (r) => <small className="ceo-muted">{journeyLine(r.o)}</small> },
              { key: "due", label: "Delivery Date", right: true, hide: true, render: (r) => formatDate(r.o.delivery_date) },
              { key: "days", label: view === "late" ? "Days Late" : "Due In", right: true, render: (r) => (r.days > 0 ? <span className={r.days > 30 ? "ceo-text-crit" : undefined}>{num(r.days)}</span> : r.days === 0 ? "Today" : `${num(-r.days)} days`) },
              { key: "value", label: "Value", right: true, hide: true, render: (r) => fullInr(totalOf(r.o)) },
            ]}
          />
          <Pager page={page} pages={Math.ceil(list.length / PAGE)} onChange={setPage} />
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ ORDER LISTS (drawer)
/** A list of orders inside a drawer. B2B lists add received, balance and Update Payment. */
export function OrdersList({ ctx, orders, b2b, title }) {
  const [page, setPage] = useState(1);
  const sorted = useMemo(() => [...orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), [orders]);
  const total = sumOf(sorted);
  const received = b2b ? sorted.reduce((s, o) => s + b2bPaymentState(o).received, 0) : 0;
  return (
    <>
      <div className="ceo-dstats">
        <Stat label="Orders" info="The number of orders in this list."><b>{num(sorted.length)}</b></Stat>
        <Stat label="Value" info="The combined value of these orders after discounts."><b title={fullInr(total)}>{shortInr(total)}</b></Stat>
        {b2b && <Stat label="Balance Due" info="Money still owed on these orders: their value minus the amount received."><b className={total - received > 0 ? "is-warn" : undefined}>{shortInr(Math.max(0, total - received))}</b></Stat>}
      </div>
      <div className="gm-actions"><CsvButton disabled={!sorted.length} onClick={() => exportOrders(title, sorted, ctx)} /></div>
      <Table
        rowKey={(r) => r.id}
        rows={sorted.slice((page - 1) * 12, page * 12)}
        onRow={ctx.openOrder}
        columns={[
          { key: "order", label: "Order", render: (o) => <OrderCell o={o} ctx={ctx} /> },
          { key: "value", label: b2b ? "Balance" : "Value", info: b2b ? "Money still owed: order value minus amount received." : undefined, right: true, render: (o) => fullInr(b2b ? b2bPaymentState(o).balance : totalOf(o)) },
          ...(b2b ? [{
            key: "pay", label: "", right: true,
            render: (o) => (canUpdateB2bPayment(o)
              ? <button type="button" className="ceo-btn is-small" onClick={(e) => { e.stopPropagation(); ctx.payB2b(o); }}>Update Payment</button>
              : <PaymentPill order={o} />),
          }] : [{ key: "date", label: "Date", right: true, render: (o) => formatDate(o.created_at) }]),
        ]}
      />
      <Pager page={page} pages={Math.ceil(sorted.length / 12)} onChange={setPage} />
    </>
  );
}

