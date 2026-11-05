import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import config from "../../config/config";
import formatDate from "../../utils/formatDate";
import downloadCsv from "../../utils/downloadCsv";
import formatIndianNumber from "../../utils/formatIndianNumber";
import { downloadCustomerPdf } from "../../utils/pdfLazy";
import { isRevenueOrder } from "../../utils/revenue";
import { getOrderStatusLabel, normalizeOrderStatus } from "../../utils/barcodeService";
import { PERIOD_OPTIONS, periodRange, inRange } from "../../components/PeriodFilter";
import StockPanel from "../../components/stock/StockPanel";
import { poolsForUser } from "../../utils/stockVisibility";
import { approveExhibition, EXHIBITION_STATUS, rejectExhibition } from "../../utils/exhibitionService";
import { AGE_BUCKETS, buildOutstanding, filterOutstanding, summariseOutstanding } from "../../utils/outstandingAnalytics";
import { buildCancellationRows, cancelledAtOf, fetchCancellations, isSaleCancellation, summariseCancellations } from "../../utils/cancellationAnalytics";
import { orderRevenue, shortInr } from "./ceoInsights";
import {
  Card, Chips, Columns, DateRange, Drawer, Empty, FilterButton, FilterGroup, fullInr, Icon, Insight, num, PageHead, Pager, RankBars, SearchBox, Seg, Select, Table, Thumb, Tile,
} from "./CeoUi";

// ============================================================
// The working pages: money to chase, what was lost, accounts, orders, stock and
// exhibitions. Same rules as before, in the new design, with every filter in one
// side drawer.
// ============================================================

const PAGE = 15;
const statusLabel = (s) => String(s || "").replace(/_/g, " ").replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const options = (list, allLabel) => [{ value: "", label: allLabel }, ...list.map((v) => ({ value: v, label: v }))];

const FilterFooter = ({ count, onClear, onClose, noun }) => (
  <>
    <button type="button" className="ceo-btn" onClick={onClear}>Clear all</button>
    <button type="button" className="ceo-btn is-primary" onClick={onClose}>Show {num(count)} {noun}</button>
  </>
);

/** Period choice used inside a page's filter drawer. */
function usePagePeriod(start = "all") {
  const [period, setPeriod] = useState(start);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const range = useMemo(() => periodRange(period, from, to), [period, from, to]);
  const inPeriod = useCallback((ts) => (range ? inRange(range, ts) : true), [range]);
  const reset = () => { setPeriod("all"); setFrom(""); setTo(""); };
  return { period, setPeriod, from, to, setFrom, setTo, range, inPeriod, reset };
}

function PeriodFacet({ p, label = "Order Date" }) {
  return (
    <FilterGroup label={label}>
      <Chips
        options={PERIOD_OPTIONS.map((o) => ({ value: o.value, label: o.value === "custom" ? "Choose dates" : o.label }))}
        value={p.period}
        onChange={(v) => p.setPeriod(v || "all")}
      />
      {p.period === "custom" && <DateRange from={p.from} to={p.to} onChange={(a, b) => { p.setFrom(a); p.setTo(b); }} />}
    </FilterGroup>
  );
}

// ------------------------------------------------------------ CASH & COLLECTIONS
export function CashPage({ ctx }) {
  const { orders, cash, periodName, open, b2b, go } = ctx;
  const [search, setSearch] = useState("");
  const [store, setStore] = useState("");
  const [sa, setSa] = useState("");
  const [status, setStatus] = useState("");
  const [bucket, setBucket] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [limit, setLimit] = useState(50);
  const p = usePagePeriod();

  const all = useMemo(() => buildOutstanding(orders).rows, [orders]);
  const scoped = useMemo(() => filterOutstanding(all, { sa, store, status, search, inPeriod: p.range ? p.inPeriod : null }), [all, sa, store, status, search, p.range, p.inPeriod]);
  const data = useMemo(() => summariseOutstanding(scoped), [scoped]);
  const shown = useMemo(() => (bucket ? scoped.filter((r) => r.bucket === bucket) : scoped), [scoped, bucket]);
  const optionsOf = (key) => [...new Set(all.map((r) => r[key]).filter(Boolean))].sort();
  const active = [store, sa, status, bucket, p.period !== "all"].filter(Boolean).length;
  const old = data.buckets.find((b) => b.key === "d60");
  const clear = () => { setStore(""); setSa(""); setStatus(""); setBucket(""); p.reset(); };
  const exportCsv = () => downloadCsv({
    filename: "outstanding_balances",
    headers: ["Order No", "Customer", "SA", "Store", "Status", "Delivery Date", "Days Past", "Total", "Paid", "Balance"],
    rows: shown.map((r) => [r.orderNo, r.customer, r.sa, r.store, r.status, r.deliveryDate ? formatDate(r.deliveryDate) : "", r.days ?? "", r.total, r.paid, r.balance]),
  });

  return (
    <div className="ceo-page">
      <PageHead title="Cash & Collections" desc="Cash received, balances still due, and who to follow up with.">
        <FilterButton count={active} onClick={() => setDrawer(true)} />
        <button type="button" className="ceo-btn" onClick={exportCsv} disabled={!shown.length}><Icon name="download" />CSV</button>
      </PageHead>
      {old?.count > 0 && (
        <Insight tone="warn">
          {shortInr(old.value)} is more than 60 days past delivery. Some of it may already be collected but never recorded, so it is worth confirming each one.
        </Insight>
      )}
      <div className="ceo-tiles">
        <Tile icon="inr" label="Cash Received" value={shortInr(cash.total)} title={fullInr(cash.total)} note={`${periodName}: ${shortInr(cash.atOrder)} at order, ${shortInr(cash.later)} balance payments`} />
        <Tile icon="alert" tone="warn" label="Balance Due from Clients" value={shortInr(data.total)} title={fullInr(data.total)} note={`All time: ${num(data.count)} client orders`} onClick={() => setBucket("")} />
        <Tile icon="transfer" label="Balance Due from B2B Partners" value={shortInr(b2b.totalB2bBalance)} note={`Orders placed: ${periodName}`} onClick={() => go("b2b_vendor")} />
      </div>
      <section className="ceo-buckets" aria-label="By age">
        {data.buckets.map((b) => (
          <button key={b.key} type="button" aria-pressed={bucket === b.key} className={b.key === "d60" ? "is-old" : undefined} onClick={() => setBucket(bucket === b.key ? "" : b.key)}>
            <small>{b.label}</small><b>{shortInr(b.value)}</b><em>{num(b.count)} orders</em>
          </button>
        ))}
      </section>
      <div className="ceo-grid">
        <Card span={4} md={6} title="Cash Received by Payment Mode" sub={periodName}>
          <RankBars rows={cash.modes} sub={(r) => `${r.share.toFixed(0)}% of cash`} limit={6} />
        </Card>
        <Card span={4} md={6} title="Balance Due by Store" sub="Click a store to filter the list">
          <RankBars rows={data.byStore.map((x) => ({ name: x.key, value: x.value, count: x.count, overdue: x.overdue60 }))} sub={(r) => `${num(r.count)} orders · ${shortInr(r.overdue)} over 60 days`} limit={6} colorOf={() => "#c9785a"} onRow={(r) => setStore(store === r.name ? "" : r.name)} />
        </Card>
        <Card span={4} title="Balance Due by Sales Associate" sub="Click a name to filter the list">
          <RankBars rows={data.bySa.map((x) => ({ name: x.key, value: x.value, count: x.count, overdue: x.overdue60 }))} sub={(r) => `${num(r.count)} orders · ${shortInr(r.overdue)} over 60 days`} limit={6} colorOf={() => "#c9785a"} onRow={(r) => setSa(sa === r.name ? "" : r.name)} />
        </Card>
        <Card span={12} title={`${num(shown.length)} orders · ${shortInr(shown.reduce((s, r) => s + r.balance, 0))} balance due`} sub="Click a line to open the order">
          <div className="ceo-tools"><SearchBox value={search} onChange={setSearch} placeholder="Search order, client, person or store" /></div>
          <Table
            rowKey={(r) => r.id}
            rows={shown.slice(0, limit)}
            empty="Nothing matches these filters."
            onRow={(r) => open({ type: "order", order: r.order })}
            columns={[
              { key: "orderNo", label: "Order", render: (r) => <b>{r.orderNo}</b> },
              { key: "customer", label: "Client", hide: true, render: (r) => r.customer || "–" },
              { key: "sa", label: "Sold By", hide: true, render: (r) => r.sa || "–" },
              { key: "store", label: "Store", hide: true, render: (r) => r.store || "–" },
              { key: "days", label: "Days Past Delivery", right: true, render: (r) => <span className={r.bucket === "d60" ? "ceo-text-crit" : undefined}>{r.days == null ? "No date" : r.days < 0 ? `In ${-r.days}d` : `${r.days}d`}</span> },
              { key: "total", label: "Order Value", right: true, hide: true, render: (r) => shortInr(r.total) },
              { key: "balance", label: "Balance Due", right: true, render: (r) => <b>{shortInr(r.balance)}</b> },
            ]}
          />
          {shown.length > limit && <button type="button" className="ceo-more" onClick={() => setLimit(limit + 100)}>Show more of {num(shown.length)}</button>}
        </Card>
      </div>
      {drawer && (
        <Drawer title="Filters" sub="Narrow the balances due" onClose={() => setDrawer(false)} footer={<FilterFooter count={shown.length} noun="orders" onClear={clear} onClose={() => setDrawer(false)} />}>
          <FilterGroup label="Age">
            <Chips options={AGE_BUCKETS.map((b) => ({ value: b.key, label: b.label }))} value={bucket} onChange={setBucket} />
          </FilterGroup>
          <FilterGroup label="Store"><Select label="Store" value={store} onChange={setStore} options={options(optionsOf("store"), "All stores")} /></FilterGroup>
          <FilterGroup label="Sold By"><Select label="Sold By" value={sa} onChange={setSa} options={options(optionsOf("sa"), "Everyone")} /></FilterGroup>
          <FilterGroup label="Status">
            <Chips options={optionsOf("status").map((s) => ({ value: s, label: statusLabel(s) }))} value={status} onChange={setStatus} />
          </FilterGroup>
          <PeriodFacet p={p} />
        </Drawer>
      )}
    </div>
  );
}

// ------------------------------------------------------------ DISCOUNTS & CANCELLATIONS
export function LossesPage({ ctx }) {
  const { brief, fin, analytics, dash, open, periodRangeValue, periodName } = ctx;
  const [view, setView] = useState(ctx.startOnCancellations ? "cancellations" : "discounts");
  const a = brief.aftercare;
  const prev = brief.previousAftercare;
  const channels = fin.channelDiscounts.map((c) => ({ ...c, rate: c.discount + c.revenue > 0 ? (c.discount / (c.discount + c.revenue)) * 100 : 0 })).sort((x, y) => y.rate - x.rate);
  const sas = analytics.salesBySalesperson.map((s) => ({ ...s, rate: s.discount + s.sales > 0 ? (s.discount / (s.discount + s.sales)) * 100 : 0 })).sort((x, y) => y.discount - x.discount);
  const change = (cur, before) => (dash.showComparison && before ? ((cur - before) / before) * 100 : null);
  return (
    <div className="ceo-page">
      <PageHead title="Discounts & Returns" desc="Discounts given, and orders cancelled, returned, exchanged or refunded.">
        <Seg label="View" value={view} onChange={setView} options={[{ value: "discounts", label: "Discounts" }, { value: "cancellations", label: "Cancellations" }]} />
      </PageHead>
      <div className="ceo-tiles">
        <Tile icon="sale" label="Total Discount Given" value={shortInr(fin.totalDiscount)} title={fullInr(fin.totalDiscount)} note={`${fin.discountPercent}% of sales value`} onClick={() => setView("discounts")} />
        <Tile icon="alert" tone="warn" label="Cancelled Order Value" value={shortInr(a.cancellations.value)} delta={change(a.cancellations.value, prev?.cancellations.value)} inverse note={`${num(a.cancellations.count)} orders cancelled, ${periodName.toLowerCase()}`} onClick={() => setView("cancellations")} />
        <Tile icon="transfer" label="Returned & Exchanged Order Value" value={shortInr(a.returns.value + a.exchanges.value)} note={`${num(a.returns.count)} returned, ${num(a.exchanges.count)} exchanged`} />
        <Tile icon="inr" label="Refunded Order Value" value={shortInr(a.refunds.value)} note={`${num(a.refunds.count)} orders`} />
      </div>
      {view === "discounts" ? (
        <>
          <Insight tone={Number(fin.discountPercent) > 20 ? "warn" : "gold"}>
            {`${fin.discountPercent}% of sales value went on discounts, ${shortInr(fin.totalDiscount)} in all.`}
            {channels[0]?.rate > 0 ? ` ${channels[0].name} discounts the most, at ${channels[0].rate.toFixed(0)}%.` : ""}
          </Insight>
          <div className="ceo-grid">
            <Card span={6} md={6} title="Discount Rate by Sales Channel" sub="Discount as a share of each channel's sales value before discount">
              <RankBars rows={channels.map((c) => ({ ...c, value: c.rate }))} format={(v) => `${Number(v).toFixed(1)}%`} sub={(r) => `${shortInr(r.discount)} given on ${shortInr(r.revenue)}`} onRow={(r) => open({ type: "channel", name: r.name })} />
            </Card>
            <Card span={6} md={6} title="Discount Given by Sales Associate" sub="Highest amount first">
              <RankBars rows={sas.map((s) => ({ ...s, value: s.discount }))} sub={(r) => `${r.rate.toFixed(0)}% of their sales, ${num(r.count)} orders`} limit={8} onRow={(r) => open({ type: "person", name: r.name })} />
            </Card>
          </div>
        </>
      ) : (
        <CancellationsView range={periodRangeValue} periodName={periodName} open={open} orders={ctx.orders} />
      )}
    </div>
  );
}

function CancellationsView({ range, periodName, open, orders }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [channel, setChannel] = useState("");
  const [showAll, setShowAll] = useState(false);
  const start = useMemo(() => range?.start || new Date(2000, 0, 1), [range]);
  const end = useMemo(() => range?.end || new Date(), [range]);

  useEffect(() => {
    let dead = false;
    setError("");
    fetchCancellations(start.toISOString(), end.toISOString())
      .then((d) => { if (!dead) setData(d); })
      .catch((e) => { if (!dead) setError(e.message || "Could not load"); });
    return () => { dead = true; };
  }, [start, end]);

  const rows = useMemo(() => (data ? buildCancellationRows(data.orders, data.components, data.whoByOrder, data.vendorNames) : []), [data]);
  const channels = useMemo(() => [...new Set(rows.map((r) => r.channel))].sort(), [rows]);
  const shown = useMemo(() => rows.filter((r) => !channel || r.channel === channel), [rows, channel]);
  const prevRows = useMemo(() => {
    if (!data?.allCancelled || !range) return [];
    const ps = new Date(start.getTime() - (end - start)).toISOString();
    const pe = start.toISOString();
    return buildCancellationRows(data.allCancelled.filter((o) => isSaleCancellation(o) && cancelledAtOf(o) >= ps && cancelledAtOf(o) < pe), [], {}, {})
      .filter((r) => !channel || r.channel === channel);
  }, [data, start, end, channel, range]);
  const days = Math.max(1, Math.round((end - start) / 864e5));
  const s = useMemo(() => summariseCancellations(shown, prevRows, days > 92 ? "month" : "week"), [shown, prevRows, days]);
  const afterStart = s.byStage.filter((x) => x.key !== "Before production" && x.key !== "No pieces").reduce((t, x) => t + x.count, 0);
  const byId = useMemo(() => Object.fromEntries(orders.map((o) => [o.id, o])), [orders]);
  const toBars = (list) => list.map((x) => ({ name: x.key, value: x.count, money: x.value }));
  const exportCsv = () => downloadCsv({
    filename: "cancellations",
    headers: ["Order No", "Channel", "Customer", "Products", "Ordered", "Cancelled", "Value", "Reason", "Stage when cancelled", "Cancelled by", "Salesperson"],
    rows: shown.map((r) => [r.orderNo, r.channel, r.customer, r.products.join("; "), r.orderedAt ? formatDate(r.orderedAt) : "", r.cancelledAt ? formatDate(r.cancelledAt) : "", Math.round(r.value), r.reason, r.stage, r.cancelledBy, r.salesperson]),
  });

  if (error) return <Card span={12}><Empty text={`Could not load cancellations: ${error}`} /></Card>;
  if (!data) return <Card span={12}><Empty text="Loading cancellations…" /></Card>;
  return (
    <>
      <Insight tone={afterStart > 0 ? "warn" : "gold"}>
        {`${num(s.count)} orders worth ${shortInr(s.value)} were cancelled, ${periodName.toLowerCase()}.`}
        {afterStart > 0 ? ` On ${num(afterStart)} of them, production had already started.` : ""}
        {s.byReason[0] ? ` The most common reason: ${s.byReason[0].key}.` : ""}
      </Insight>
      <div className="ceo-grid">
        <Card span={12} title="Cancelled Orders Over Time" sub={days > 92 ? "Each month" : "Each week"}>
          <Columns data={s.trend.map((t) => ({ name: days > 92 ? t.key : formatDate(t.key).slice(0, 5), value: t.count }))} name="Cancelled orders" money={false} height={190} />
        </Card>
        <Card span={3} md={6} title="By Sales Channel"><RankBars rows={toBars(s.byChannel)} format={num} sub={(r) => shortInr(r.money)} limit={6} onRow={(r) => setChannel(channel === r.name ? "" : r.name)} /></Card>
        <Card span={3} md={6} title="By Cancellation Reason"><RankBars rows={toBars(s.byReason)} format={num} sub={(r) => shortInr(r.money)} limit={6} colorOf={() => "#c9785a"} /></Card>
        <Card span={3} md={6} title="By Production Stage When Cancelled"><RankBars rows={toBars(s.byStage)} format={num} sub={(r) => shortInr(r.money)} limit={6} colorOf={() => "#7b3a5e"} /></Card>
        <Card span={3} md={6} title="By Person Who Cancelled"><RankBars rows={toBars(s.byWho)} format={num} sub={(r) => shortInr(r.money)} limit={6} colorOf={() => "#6d6a9c"} /></Card>
        <Card span={12} title={`Cancelled Orders (${num(shown.length)})`}>
          <div className="ceo-tools">
            <Select label="Channel" value={channel} onChange={setChannel} options={options(channels, "All channels")} />
            <button type="button" className="ceo-btn" onClick={exportCsv} disabled={!shown.length}><Icon name="download" />CSV</button>
          </div>
          <Table
            rowKey={(r) => r.id}
            rows={showAll ? shown : shown.slice(0, 30)}
            empty="No cancellations."
            onRow={(r) => { if (byId[r.id]) open({ type: "order", order: byId[r.id] }); }}
            columns={[
              { key: "orderNo", label: "Order", render: (r) => <b>{r.orderNo}</b> },
              { key: "customer", label: "Client", hide: true, render: (r) => r.customer || "–" },
              { key: "cancelledAt", label: "Cancellation Date", right: true, render: (r) => (r.cancelledAt ? formatDate(r.cancelledAt) : "–") },
              { key: "value", label: "Order Value", right: true, render: (r) => shortInr(r.value) },
              { key: "reason", label: "Reason", hide: true, render: (r) => <span className="ceo-clip">{r.reason || "–"}</span> },
              { key: "stage", label: "Production Stage", hide: true },
              { key: "by", label: "Cancelled By", hide: true, render: (r) => r.cancelledBy || "–" },
            ]}
          />
          {shown.length > 30 && !showAll && <button type="button" className="ceo-more" onClick={() => setShowAll(true)}>Show all {num(shown.length)}</button>}
        </Card>
      </div>
    </>
  );
}

// ------------------------------------------------------------ ACCOUNTS
export function AccountsPage({ ctx }) {
  const { orders, personOf, isPerson, open } = ctx;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [store, setStore] = useState("");
  const [sa, setSa] = useState("");
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState(false);
  const p = usePagePeriod();

  const lines = useMemo(() => {
    const items = [];
    const GST_RATE = 0.05;
    orders.forEach((order) => {
      if (order.items?.[0]?.sync_enabled === true) return;
      const orderItems = order.items || [];
      // Discount allocated by GST-inclusive gross, the same basis as `gross`.
      const orderGross = orderItems.reduce((s, it) => s + Number(it.price || 0) * Number(it.quantity || 1), 0);
      const orderDiscount = Number(order.discount_amount || 0);
      orderItems.forEach((item, idx) => {
        const quantity = Number(item.quantity || 1);
        // item.price is the GST-inclusive MRP shown on the customer invoice.
        const gross = Number(item.price || 0) * quantity;
        const ratio = orderGross > 0 ? gross / orderGross : 0;
        const discount = Math.min(gross, orderDiscount * ratio);
        const invoice = Math.max(0, gross - discount);
        const taxable = invoice / (1 + GST_RATE);
        const round = (v) => Math.round(v * 100) / 100;
        items.push({
          id: `${order.id}-${idx}`, order, order_no: order.order_no, order_date: order.created_at,
          sa_name: personOf(order) || "-", client_name: order.delivery_name || "-", product_name: item.product_name || "-",
          gross_value: round(gross), discount: round(discount), taxable_value: round(taxable), gst: round(invoice - taxable), invoice_value: round(invoice),
          quantity, status: order.status || "order_received", delivery_date: item.delivery_date || order.delivery_date, store: order.salesperson_store || "-",
        });
      });
    });
    return items;
  }, [orders, personOf]);

  const filtered = useMemo(() => {
    let result = lines;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((i) => i.order_no?.toLowerCase().includes(q) || i.client_name?.toLowerCase().includes(q) || i.product_name?.toLowerCase().includes(q) || i.sa_name?.toLowerCase().includes(q));
    }
    if (p.range) result = result.filter((i) => p.inPeriod(i.order_date));
    if (status) result = result.filter((i) => (i.status === "pending" ? "order_received" : i.status) === status);
    if (store) result = result.filter((i) => i.store === store);
    if (sa) result = result.filter((i) => i.sa_name === sa);
    return result;
  }, [lines, search, p.range, p.inPeriod, status, store, sa]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setPage(1); }, [search, p.range, status, store, sa]);
  const stores = useMemo(() => [...new Set(lines.map((i) => i.store).filter((s) => s && s !== "-"))].sort(), [lines]);
  const people = useMemo(() => [...new Set(lines.map((i) => i.sa_name).filter((s) => s && s !== "-" && isPerson(s)))].sort(), [lines, isPerson]);
  const totals = useMemo(() => filtered.reduce((t, i) => ({
    gross: t.gross + i.gross_value, discount: t.discount + i.discount, gst: t.gst + i.gst, invoice: t.invoice + i.invoice_value,
  }), { gross: 0, discount: 0, gst: 0, invoice: 0 }), [filtered]);
  const active = [status, store, sa, p.period !== "all"].filter(Boolean).length;
  const clear = () => { setStatus(""); setStore(""); setSa(""); p.reset(); };
  const exportCsv = () => downloadCsv({
    filename: "accounts",
    headers: ["Sold by", "Order", "Date", "Client", "Design", "Gross", "Discount", "Taxable", "GST", "Invoice", "Qty", "Status", "Delivery"],
    rows: filtered.map((i) => [i.sa_name, i.order_no, formatDate(i.order_date), i.client_name, i.product_name, i.gross_value, i.discount, i.taxable_value, i.gst, i.invoice_value, i.quantity, i.status, i.delivery_date ? formatDate(i.delivery_date) : ""]),
  });

  return (
    <div className="ceo-page">
      <PageHead title="Accounts" desc="Every order line with its discount and GST, for the finance team. Website-synced items are not included.">
        <FilterButton count={active} onClick={() => setDrawer(true)} />
        <button type="button" className="ceo-btn" onClick={exportCsv} disabled={!filtered.length}><Icon name="download" />CSV</button>
      </PageHead>
      <div className="ceo-tiles">
        <Tile icon="inr" label="Gross Value" value={shortInr(totals.gross)} title={fullInr(totals.gross)} />
        <Tile icon="sale" label="Total Discount" value={shortInr(totals.discount)} title={fullInr(totals.discount)} />
        <Tile icon="doc" label="Total GST" value={shortInr(totals.gst)} title={fullInr(totals.gst)} />
        <Tile icon="trend" label="Invoice Value" value={shortInr(totals.invoice)} title={fullInr(totals.invoice)} />
      </div>
      <Card title={`${num(filtered.length)} Order Lines`} sub="Click a line to see its order">
        <div className="ceo-tools"><SearchBox value={search} onChange={setSearch} placeholder="Search order, client, design or person" /></div>
        <Table
          rowKey={(r) => r.id}
          rows={filtered.slice((page - 1) * 20, page * 20)}
          empty="No records found."
          onRow={(r) => open({ type: "order", order: r.order })}
          columns={[
            { key: "order_no", label: "Order", render: (r) => <b>{r.order_no}</b> },
            { key: "date", label: "Order Date", hide: true, tab: true, render: (r) => formatDate(r.order_date) },
            { key: "client", label: "Client", hide: true, render: (r) => r.client_name },
            { key: "design", label: "Design", hide: true, render: (r) => <span className="ceo-clip">{r.product_name}</span> },
            { key: "gross", label: "Gross Value", right: true, hide: true, tab: true, render: (r) => `₹${formatIndianNumber(r.gross_value)}` },
            { key: "disc", label: "Discount", right: true, hide: true, lap: true, render: (r) => `₹${formatIndianNumber(r.discount)}` },
            { key: "gst", label: "GST", right: true, render: (r) => `₹${formatIndianNumber(r.gst)}` },
            { key: "invoice", label: "Invoice Value", right: true, render: (r) => <b>₹{formatIndianNumber(r.invoice_value)}</b> },
            { key: "status", label: "Status", hide: true, lap: true, render: (r) => getOrderStatusLabel(r.status) },
          ]}
        />
        <Pager page={page} pages={Math.ceil(filtered.length / 20)} onChange={setPage} />
      </Card>
      {drawer && (
        <Drawer title="Filters" sub="Narrow the accounts" onClose={() => setDrawer(false)} footer={<FilterFooter count={filtered.length} noun="lines" onClear={clear} onClose={() => setDrawer(false)} />}>
          <PeriodFacet p={p} />
          <FilterGroup label="Status">
            <Chips options={[["order_received", "Order Received"], ["completed", "Completed"], ["dispatched", "Dispatched"], ["delivered", "Delivered"], ["cancelled", "Cancelled"]].map(([value, label]) => ({ value, label }))} value={status} onChange={setStatus} />
          </FilterGroup>
          <FilterGroup label="Store"><Select label="Store" value={store} onChange={setStore} options={options(stores, "All stores")} /></FilterGroup>
          <FilterGroup label="Sold By"><Select label="Sold By" value={sa} onChange={setSa} options={options(people, "Everyone")} /></FilterGroup>
        </Drawer>
      )}
    </div>
  );
}

// ------------------------------------------------------------ ORDERS
const ORDER_STATUS_OPTIONS = [
  // in_production / ready / prepared / confirmed / pending: no order carries them
  // any more, and offering them would let someone write bad data back.
  { value: "order_received", label: "Order Received" },
  { value: "completed", label: "Completed" },
  { value: "dispatched", label: "Dispatched" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];
const STATUS_TABS = [
  { value: "all", label: "All Orders" },
  { value: "unfulfilled", label: "In Progress" },
  { value: "prepared", label: "Prepared" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];
const SEARCH_FIELDS = [
  { value: "order_no", label: "Order Number" },
  { value: "product_name", label: "Design Name" },
  { value: "client_name", label: "Client Name" },
  { value: "phone", label: "Phone Number" },
  { value: "salesperson", label: "Sales Associate" },
];
const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "delivery", label: "Delivery date" },
  { value: "amount_high", label: "Value: high to low" },
  { value: "amount_low", label: "Value: low to high" },
];
const NO_FILTERS = { minPrice: "", maxPrice: "", payment: [], priority: [], orderType: [], store: [], salesperson: "" };
const totalOf = (o) => o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0;
const paymentOf = (o) => {
  // total_paid = everything received; advance_payment is only the first amount.
  const paid = Number(o.total_paid ?? o.advance_payment) || 0;
  if (paid >= totalOf(o)) return "paid";
  return paid > 0 ? "partial" : "unpaid";
};
const priorityOf = (o) => (o.is_urgent || o.order_flag === "Urgent" || o.alteration_status === "upcoming_occasion" ? "urgent" : "normal");
const typeOf = (o) => {
  if (o.is_alteration) return "alteration";
  const item = o.items?.[0];
  return item?.order_type === "Custom" || item?.payment_order_type === "Custom" ? "custom" : "standard";
};
const isLxrts = (o) => o.items?.[0]?.sync_enabled === true;
const matchesTab = (o, tab) => {
  const status = (o.status || "").toLowerCase();
  switch (tab) {
    case "unfulfilled": return status !== "completed" && status !== "delivered" && isRevenueOrder(o);
    case "prepared": return status === "completed";
    case "delivered": return status === "delivered";
    case "cancelled": return !isRevenueOrder(o);
    default: return true;
  }
};
const orderNumber = (no) => {
  const m = (no || "").replace(/-[A-Z]\d*$/, "").match(/(\d{2})(\d{2})-(\d{6})$/);
  return m ? parseInt(m[2] + m[1] + m[3], 10) : 0;
};

export function OrdersPage({ ctx }) {
  const { orders, setOrders, personOf, isPerson, open, showPopup } = ctx;
  const [search, setSearch] = useState("");
  const [field, setField] = useState("order_no");
  const [sort, setSort] = useState("newest");
  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [drawer, setDrawer] = useState(false);
  const [updating, setUpdating] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(null);
  const p = usePagePeriod();
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = Number(filters.minPrice) || 0;
    const max = filters.maxPrice === "" ? Infinity : Number(filters.maxPrice);
    return orders.filter((o) => {
      if (isLxrts(o)) return false;
      if (q) {
        const hit = field === "product_name" ? (o.items || []).some((it) => it?.product_name?.toLowerCase().includes(q))
          : field === "client_name" ? o.delivery_name?.toLowerCase().includes(q)
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
  }, [orders, search, field, filters, p.range, p.inPeriod, personOf]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => Object.fromEntries(STATUS_TABS.map((t) => [t.value, scoped.filter((o) => matchesTab(o, t.value)).length])), [scoped]);
  const list = useMemo(() => [...scoped.filter((o) => matchesTab(o, tab))].sort((a, b) => {
    switch (sort) {
      case "oldest": return orderNumber(a.order_no) - orderNumber(b.order_no);
      case "delivery": return new Date(a.delivery_date || 0) - new Date(b.delivery_date || 0);
      case "amount_high": return totalOf(b) - totalOf(a);
      case "amount_low": return totalOf(a) - totalOf(b);
      default: return orderNumber(b.order_no) - orderNumber(a.order_no);
    }
  }), [scoped, tab, sort]);
  useEffect(() => { setPage(1); }, [search, field, filters, tab, sort, p.range]);

  const people = useMemo(() => [...new Set(orders.map(personOf).filter((s) => s && isPerson(s)))].sort(), [orders, personOf, isPerson]);
  const stores = useMemo(() => [...new Set(orders.map((o) => o.salesperson_store).filter(Boolean))].sort(), [orders]);
  const active = (filters.minPrice || filters.maxPrice ? 1 : 0) + filters.payment.length + filters.priority.length + filters.orderType.length + filters.store.length + (filters.salesperson ? 1 : 0) + (p.period !== "all" ? 1 : 0);
  const clear = () => { setFilters(NO_FILTERS); p.reset(); };

  const updateStatus = async (id, next) => {
    setUpdating(id);
    const patch = { status: next };
    if (next === "delivered") patch.delivered_at = new Date().toISOString();
    const { error } = await supabase.from("orders").update(patch).eq("id", id);
    if (error) showPopup({ title: "Error", message: "Failed to update status.", type: "error" });
    else setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
    setUpdating(null);
  };
  const makePdf = async (order) => {
    setPdfBusy(order.id);
    try { await downloadCustomerPdf(order); } catch (e) { console.error("PDF generation failed:", e); } finally { setPdfBusy(null); }
  };
  const exportCsv = () => downloadCsv({
    filename: `orders_export_${new Date().toISOString().slice(0, 10)}`,
    headers: ["Order No", "Product Name", "Customer Name", "Customer Number", "Customer Email", "Size", "Amount", "Top Color", "Bottom Color", "SA Name", "Store", "Status", "Notes", "Order Date", "Delivery Date"],
    rows: list.map((o) => {
      const item = o.items?.[0] || {};
      return [o.order_no || "", item.product_name || "", o.delivery_name || "", o.delivery_phone || "", o.delivery_email || "", item.size || "", totalOf(o), item.top_color?.name || item.color?.name || "", item.bottom_color?.name || "", o.salesperson || "", o.salesperson_store || "", o.status || "", o.notes || "", o.created_at ? formatDate(o.created_at) : "", o.delivery_date ? formatDate(o.delivery_date) : ""];
    }),
  });
  const stop = (e) => e.stopPropagation();

  return (
    <div className="ceo-page">
      <PageHead title="Orders" desc="Find any order, change its status or download its PDF. Website-synced orders are found through the search at the top.">
        <FilterButton count={active} onClick={() => setDrawer(true)} />
        <button type="button" className="ceo-btn" onClick={exportCsv} disabled={!list.length}><Icon name="download" />CSV</button>
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
          onRow={(o) => open({ type: "order", order: o })}
          columns={[
            {
              key: "order", label: "Order",
              render: (o) => (
                <span className="ceo-ocell">
                  <Thumb src={o.items?.[0]?.image_url} alt="" />
                  <span><b>{o.order_no || "–"}</b><small>{o.delivery_name || "–"}{priorityOf(o) === "urgent" ? <i className="ceo-pill is-crit"> Urgent</i> : null}</small></span>
                </span>
              ),
            },
            { key: "design", label: "Design", hide: true, render: (o) => <span className="ceo-clip" title={o.items?.[0]?.product_name}>{o.items?.[0]?.product_name || "–"}</span> },
            { key: "value", label: "Order Value", right: true, render: (o) => shortInr(orderRevenue(o)) },
            { key: "pay", label: "Payment Status", hide: true, tab: true, render: (o) => <i className={`ceo-pill is-${paymentOf(o) === "paid" ? "ok" : paymentOf(o) === "partial" ? "gold" : "warn"}`}>{statusLabel(paymentOf(o))}</i> },
            {
              key: "status", label: "Order Status",
              render: (o) => (
                <span onClick={stop} onKeyDown={stop} role="presentation">
                  <Select compact label={`Status of ${o.order_no}`} value={normalizeOrderStatus(o.status)} onChange={(v) => updateStatus(o.id, v)} options={ORDER_STATUS_OPTIONS} search={false} disabled={updating === o.id} />
                </span>
              ),
            },
            { key: "store", label: "Store", hide: true, lap: true, render: (o) => o.salesperson_store || "–" },
            { key: "date", label: "Order Date", right: true, hide: true, tab: true, render: (o) => formatDate(o.created_at) },
            {
              key: "pdf", label: "", right: true, hide: true,
              render: (o) => <button type="button" className="ceo-btn is-small" onClick={(e) => { stop(e); makePdf(o); }} disabled={pdfBusy === o.id}>{pdfBusy === o.id ? "…" : "PDF"}</button>,
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
          <FilterGroup label="Sold By"><Select label="Sold By" value={filters.salesperson} onChange={(v) => set("salesperson", v)} options={options(people, "Everyone")} /></FilterGroup>
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

// ------------------------------------------------------------ STOCK
const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL", "6XL"];
const functionsUrl = () => `${config.SUPABASE_URL}/functions/v1/shopify-inventory`;
const functionHeaders = () => ({ "Content-Type": "application/json", apikey: config.SUPABASE_KEY, Authorization: `Bearer ${config.SUPABASE_KEY}` });

export function StockPage({ ctx }) {
  const { products, setProducts, variants, setVariants, open, showPopup, consignment } = ctx;
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const synced = products.filter((p) => p.sync_enabled);
    if (!synced.length || Object.keys(variants).length) return;
    let dead = false;
    (async () => {
      setSyncing(true);
      const map = {};
      const fromDb = async (product) => {
        const { data } = await supabase.from("product_variants").select("size, inventory").eq("product_id", product.id);
        if (data) { const m = {}; data.forEach((v) => { m[v.size] = v.inventory || 0; }); map[product.id] = m; }
      };
      await Promise.allSettled(synced.map(async (product) => {
        try {
          const res = await fetch(functionsUrl(), { method: "POST", headers: functionHeaders(), body: JSON.stringify({ action: "fetch", product_id: product.id }) });
          const json = await res.json();
          if (json.success && json.inventory) map[product.id] = json.inventory;
          else await fromDb(product);
        } catch {
          await fromDb(product);
        }
      }));
      if (!dead) { setVariants(map); setSyncing(false); }
    })();
    return () => { dead = true; };
  }, [products]); // eslint-disable-line react-hooks/exhaustive-deps

  const invOf = useCallback((p) => (p.sync_enabled ? Object.values(variants[p.id] || {}).reduce((s, q) => s + (q || 0), 0) : (p.inventory || 0)), [variants]);
  const stats = useMemo(() => {
    let low = 0;
    let out = 0;
    products.forEach((p) => {
      const inv = invOf(p);
      if (inv === 0) out += 1;
      else if (inv > 0 && inv < 5) low += 1;
    });
    const synced = products.filter((p) => p.sync_enabled).length;
    return { total: products.length, low, out, synced, ready: !synced || Object.keys(variants).length > 0 };
  }, [products, invOf, variants]);
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return products.filter((p) => {
      if (q && !(p.name?.toLowerCase().includes(q) || p.sku_id?.toLowerCase().includes(q))) return false;
      if (type === "lxrts" && !p.sync_enabled) return false;
      if (type === "regular" && p.sync_enabled) return false;
      const inv = invOf(p);
      if (level === "out" && inv !== 0) return false;
      if (level === "low" && !(inv > 0 && inv < 5)) return false;
      if (level === "in" && inv < 5) return false;
      return true;
    });
  }, [products, search, type, level, invOf]);
  useEffect(() => { setPage(1); }, [search, type, level]);

  const saveProduct = async (id) => {
    if (draft === "" || Number.isNaN(Number(draft))) {
      showPopup({ title: "Invalid", message: "Please enter a valid number.", type: "warning" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("products").update({ inventory: Number(draft) }).eq("id", id);
    if (error) showPopup({ title: "Error", message: "Failed to update inventory.", type: "error" });
    else {
      setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, inventory: Number(draft) } : p)));
      setEditing(null);
    }
    setSaving(false);
  };
  const saveVariant = async (id, size) => {
    const qty = Number(draft);
    if (draft === "" || Number.isNaN(qty) || qty < 0) return;
    setSaving(true);
    try {
      const old = variants[id]?.[size] || 0;
      const { error } = await supabase.from("product_variants").update({ inventory: qty }).eq("product_id", id).eq("size", size);
      if (error) throw new Error("Failed to update");
      const delta = old - qty;
      if (delta !== 0) {
        try {
          const res = await fetch(functionsUrl(), { method: "POST", headers: functionHeaders(), body: JSON.stringify({ action: "reduce", product_id: id, size, quantity: delta }) });
          const json = await res.json();
          if (!json.success) console.error("Shopify sync failed:", json.error);
        } catch (e) { console.error("Shopify sync error:", e); }
      }
      setVariants((prev) => ({ ...prev, [id]: { ...prev[id], [size]: qty } }));
    } catch (e) { console.error("Variant update error:", e); }
    setEditing(null);
    setSaving(false);
  };
  const sizesOf = (id) => {
    const v = variants[id];
    if (!v) return [];
    return [...SIZE_ORDER.filter((s) => v[s] !== undefined), ...Object.keys(v).filter((s) => !SIZE_ORDER.includes(s)).sort()];
  };
  const stockClass = (n) => (n === 0 ? "is-out" : n < 5 ? "is-low" : "is-ok");
  const editor = (onSave) => (
    <span className="ceo-edit" onClick={(e) => e.stopPropagation()} role="presentation">
      <input
        autoFocus
        type="text"
        inputMode="numeric"
        aria-label="New stock count"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
        onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") setEditing(null); }}
      />
      <button type="button" className="ceo-btn is-small is-primary" onClick={onSave} disabled={saving}>{saving ? "…" : "Save"}</button>
      <button type="button" className="ceo-btn is-small" onClick={() => setEditing(null)}>Cancel</button>
    </span>
  );
  const count = (key, n, value) => (
    <button type="button" className={`ceo-count ${stockClass(n)}`} title="Click to change" onClick={(e) => { e.stopPropagation(); setEditing(key); setDraft(String(value)); }}>{n}<Icon name="edit" /></button>
  );
  const active = [level, type].filter(Boolean).length;

  return (
    <div className="ceo-page">
      <PageHead title="Stock" desc="Where stock is held, and the stock count for each design.">
        <FilterButton count={active} onClick={() => setDrawer(true)} />
      </PageHead>
      <div className="ceo-tiles">
        <Tile icon="products" label="Total Designs" value={num(stats.total)} note={`${num(stats.synced)} synced with the website`} onClick={() => { setLevel(""); setType(""); }} />
        <Tile icon="alert" tone="warn" label="Designs Low on Stock" value={stats.ready ? num(stats.low) : "…"} note="Fewer than 5 pieces" onClick={() => setLevel("low")} />
        <Tile icon="close" tone="warn" label="Designs Out of Stock" value={stats.ready ? num(stats.out) : "…"} note="No pieces left" onClick={() => setLevel("out")} />
        {consignment.totalRemaining > 0 && <Tile icon="transfer" label="Consignment Pieces With Partners" value={num(consignment.totalRemaining)} />}
      </div>
      <Card title="Stock by Location and Channel" className="ceo-classic">
        <StockPanel pools={poolsForUser({ role: "ceo" })} SelectComponent={Select} />
      </Card>
      <Card title={`Stock by Design (${num(filtered.length)})`} sub="Click a stock count to change it. Click a design to see its sales.">
        <div className="ceo-tools"><SearchBox value={search} onChange={setSearch} placeholder="Search by name or SKU" /></div>
        <Table
          rowKey={(r) => r.id}
          rows={filtered.slice((page - 1) * PAGE, page * PAGE)}
          empty="No designs match."
          onRow={(r) => open({ type: "design", name: r.name })}
          columns={[
            {
              key: "name", label: "Design",
              render: (p) => (
                <span className="ceo-ocell">
                  <Thumb src={p.image_url} alt="" />
                  <span>
                    <b title={p.name}>{p.name}</b>
                    <small>{p.sku_id || "No SKU"}{p.sync_enabled ? " · Website" : ""}</small>
                    {p.sync_enabled && expanded === p.id && (
                      <span className="ceo-sizes">
                        {sizesOf(p.id).map((size) => (
                          <span key={size} className="ceo-size">
                            <em>{size}</em>
                            {editing === `${p.id}-${size}` ? editor(() => saveVariant(p.id, size)) : count(`${p.id}-${size}`, variants[p.id]?.[size] ?? 0, variants[p.id]?.[size] ?? 0)}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                </span>
              ),
            },
            { key: "colour", label: "Colour", hide: true, render: (p) => p.default_color || "–" },
            { key: "price", label: "Price", right: true, hide: true, render: (p) => fullInr(p.base_price || 0) },
            {
              key: "stock", label: "Stock Count", right: true,
              render: (p) => {
                if (p.sync_enabled) {
                  return (
                    <button type="button" className={`ceo-count ${stockClass(invOf(p))}`} onClick={(e) => { e.stopPropagation(); setExpanded(expanded === p.id ? null : p.id); }}>
                      {syncing ? "…" : invOf(p)}<small>{expanded === p.id ? "Hide sizes" : "Sizes"}</small>
                    </button>
                  );
                }
                return editing === p.id ? editor(() => saveProduct(p.id)) : count(p.id, p.inventory || 0, p.inventory || 0);
              },
            },
          ]}
        />
        <Pager page={page} pages={Math.ceil(filtered.length / PAGE)} onChange={setPage} />
      </Card>
      {drawer && (
        <Drawer title="Filters" sub="Narrow the design list" onClose={() => setDrawer(false)} footer={<FilterFooter count={filtered.length} noun="designs" onClear={() => { setLevel(""); setType(""); }} onClose={() => setDrawer(false)} />}>
          <FilterGroup label="Stock Level"><Chips options={[{ value: "in", label: "In stock (5+)" }, { value: "low", label: "Low (under 5)" }, { value: "out", label: "Out of stock" }]} value={level} onChange={setLevel} /></FilterGroup>
          <FilterGroup label="Design Type"><Chips options={[{ value: "lxrts", label: "Website synced" }, { value: "regular", label: "Made to order" }]} value={type} onChange={setType} /></FilterGroup>
        </Drawer>
      )}
    </div>
  );
}

// ------------------------------------------------------------ EXHIBITIONS
const EXB_TONE = { [EXHIBITION_STATUS.ACTIVE]: ["ok", "Active"], [EXHIBITION_STATUS.PENDING]: ["warn", "Waiting"], [EXHIBITION_STATUS.REJECTED]: ["crit", "Rejected"] };

export function ExhibitionsPage({ ctx }) {
  const { exhibitionRows, open, currentUserEmail, reloadExhibitions, showPopup } = ctx;
  const [busy, setBusy] = useState(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const pending = exhibitionRows.filter((e) => e.status === EXHIBITION_STATUS.PENDING);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return exhibitionRows.filter((e) => {
      if (status && e.status !== status) return false;
      return !q || e.name?.toLowerCase().includes(q) || e.company_name?.toLowerCase().includes(q) || e.sb_representative?.toLowerCase().includes(q);
    });
  }, [exhibitionRows, search, status]);
  const withSales = exhibitionRows.filter((e) => e.gross > 0);
  const totalGross = withSales.reduce((s, e) => s + e.gross, 0);
  const totalNet = withSales.reduce((s, e) => s + e.net, 0);
  const best = [...withSales].sort((a, b) => b.net - a.net)[0];

  const act = async (e, approve) => {
    setBusy(e.id);
    try {
      if (approve) await approveExhibition(e.id, currentUserEmail);
      else await rejectExhibition(e.id, currentUserEmail, "Rejected by approver");
      showPopup({ title: approve ? "Approved" : "Rejected", message: approve ? `${e.name} is now active.` : `${e.name} has been rejected.`, type: approve ? "success" : "info", confirmText: "OK" });
      await reloadExhibitions();
    } catch (err) {
      showPopup({ title: "Error", message: err.message || "That did not go through.", type: "error", confirmText: "OK" });
    }
    setBusy(null);
  };

  return (
    <div className="ceo-page">
      <PageHead title="Exhibitions" desc="Exhibitions waiting for approval, and the sales from each one." />
      {best && <Insight>{`${best.name} has the highest net revenue, at ${shortInr(best.net)} after the partner's share.`}</Insight>}
      <div className="ceo-tiles">
        <Tile icon="doc" tone={pending.length ? "warn" : undefined} label="Waiting for Approval" value={num(pending.length)} />
        <Tile icon="inr" label="Total Exhibition Sales" value={shortInr(totalGross)} title={fullInr(totalGross)} note="All time" />
        <Tile icon="trend" label="Net Revenue After Partner Share" value={shortInr(totalNet)} title={fullInr(totalNet)} />
        <Tile icon="overview" label="Exhibitions With Sales" value={num(withSales.length)} note={`Of ${num(exhibitionRows.length)}`} />
      </div>
      {pending.length > 0 && (
        <Card title="Waiting for Your Approval">
          <div className="ceo-approve">
            {pending.map((e) => (
              <div key={e.id}>
                <span>
                  <b>{e.name}</b>
                  <small>{[e.location, e.country].filter(Boolean).join(", ")} · {e.company_name}</small>
                  <small>{e.start_date ? formatDate(e.start_date) : "–"} to {e.end_date ? formatDate(e.end_date) : "–"} · {e.sb_representative} · {e.commission_split}% share</small>
                </span>
                <span className="ceo-approve-btns">
                  <button type="button" className="ceo-btn is-primary" disabled={busy === e.id} onClick={() => act(e, true)}>Approve</button>
                  <button type="button" className="ceo-btn" disabled={busy === e.id} onClick={() => act(e, false)}>Reject</button>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card title="All Exhibitions" sub="Click one to see its orders">
        <div className="ceo-tools">
          <SearchBox value={search} onChange={setSearch} placeholder="Search by name, company or representative" />
          <Select label="Status" value={status} onChange={setStatus} search={false} options={[{ value: "", label: "All statuses" }, ...Object.entries(EXB_TONE).map(([value, [, label]]) => ({ value, label }))]} />
        </div>
        <Table
          rowKey={(r) => r.id}
          rows={shown}
          empty="No exhibitions match."
          onRow={(e) => open({ type: "exhibition", exhibition: e })}
          columns={[
            { key: "name", label: "Exhibition", render: (e) => <b>{e.name}</b> },
            { key: "where", label: "Location", hide: true, render: (e) => [e.location, e.country].filter(Boolean).join(", ") || "–" },
            { key: "when", label: "Start Date", hide: true, render: (e) => (e.start_date ? formatDate(e.start_date) : "–") },
            { key: "status", label: "Status", render: (e) => { const [t, l] = EXB_TONE[e.status] || ["gold", e.status]; return <i className={`ceo-pill is-${t}`}>{l}</i>; } },
            { key: "count", label: "Orders", right: true, hide: true, render: (e) => num(e.count) },
            { key: "gross", label: "Total Sales", right: true, render: (e) => shortInr(e.gross) },
            { key: "net", label: "Net Revenue", right: true, hide: true, render: (e) => shortInr(e.net) },
          ]}
        />
      </Card>
    </div>
  );
}
