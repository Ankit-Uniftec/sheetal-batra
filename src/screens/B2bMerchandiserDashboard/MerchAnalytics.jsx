import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, LabelList, CartesianGrid } from "recharts";
import { supabase } from "../../lib/supabaseClient";
import { fetchAllRows } from "../../utils/fetchAllRows";
import { getOrderProgressStatus } from "../../utils/barcodeService";
import { isPartnerGiftingRow } from "../../utils/b2bStockOrder";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";
import downloadCsv from "../../utils/downloadCsv";

// ============================================================
// B2B Merchandiser analytics (Release 33, client point 3).
//   1. Orders running delayed, per partner (right now)
//   2. Orders delivered late, per partner (finished in the period)
//   3. Revenue and orders by order type (placed in the period)
//   4. Best colours and collection performance (placed in the period)
// "Partner" = the B2B vendor on the order (orders.vendor_id).
// Cancelled / revoked orders are left out everywhere.
// ============================================================

const GOLD = "#d5b85a";
const DAY = 86400000;
const rupees = (n) => `₹${formatIndianNumber(Math.round(Number(n) || 0))}`;
const valueOf = (o) => Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0) || 0;
const isDead = (o) => ["cancelled", "revoked"].includes(String(o.status || "").toLowerCase());
const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
const DONE = new Set(["delivered", "completed", "dispatched"]);

/** When the order left: delivered_at, else the dispatched-stage date. */
function finishedAt(o) {
  if (o.delivered_at) return o.delivered_at;
  if (o.dispatched_at) return o.dispatched_at;
  if (o.warehouse_stage === "dispatched" && o.warehouse_stage_updated_at) return o.warehouse_stage_updated_at;
  return null;
}

function orderType(o) {
  if (o.is_stock_order) return "Stock";
  if (isPartnerGiftingRow(o)) return "Partner Gifting";
  return o.b2b_order_type || "Not set";
}

/** A colour value is stored as "Gold", { name, hex } or { label } — never print an object. */
const colourName = (c) => {
  if (!c) return "";
  if (typeof c === "string") return c;
  if (typeof c === "object") return String(c.name || c.label || c.color || c.value || "");
  return "";
};

/**
 * An order's value shared across its items by list price, so colour and
 * collection values add up to what the partner actually pays (item prices
 * can be list prices, before the partner's margin).
 */
function itemShares(o) {
  const items = o.items || [];
  const list = items.map((it) => (Number(it?.price) || 0) * (Number(it?.quantity) || 1));
  const sum = list.reduce((a, b) => a + b, 0);
  const total = valueOf(o);
  return items.map((it, i) => ({ it, qty: Number(it?.quantity) || 1, value: sum > 0 ? (list[i] / sum) * total : total / (items.length || 1) }));
}

function itemColours(it) {
  const names = [it?.top_color, it?.bottom_color, it?.dupatta_color, ...(it?.extras || []).map((e) => e?.color)]
    .map((c) => colourName(c).trim())
    .filter((n) => n && !/^(n\/?a|none|-)$/i.test(n));
  return [...new Set(names.map((n) => n.replace(/\s+/g, " ")))];
}

function Card({ title, sub, onExport, children }) {
  return (
    <div className="merch-an-card">
      <div className="merch-an-head">
        <div>
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
        {onExport && <button className="merch-an-btn" onClick={onExport}>Export CSV</button>}
      </div>
      {children}
    </div>
  );
}

function Bars({ data, dataKey, label, format = (v) => v, height }) {
  if (!data.length) return <p className="merch-an-empty">Nothing in this period.</p>;
  return (
    <ResponsiveContainer width="100%" height={height || Math.max(160, data.length * 34 + 30)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 70, left: 8, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke="#f0e8c8" />
        <XAxis type="number" hide />
        <YAxis type="category" dataKey={label} width={150} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(v) => format(v)} />
        <Bar dataKey={dataKey} fill={GOLD} radius={[0, 4, 4, 0]}>
          <LabelList dataKey={dataKey} position="right" formatter={format} style={{ fontSize: 12, fill: "#5a4a1a" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function Table({ head, rows, empty }) {
  return (
    <div className="merch-an-table-wrap">
      <table className="merch-an-table">
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0
            ? <tr><td colSpan={head.length} className="merch-an-empty">{empty || "Nothing in this period."}</td></tr>
            : rows}
        </tbody>
      </table>
    </div>
  );
}

export default function MerchAnalytics({ orders, vendorMap, componentsByOrder = {}, inPeriod, periodName }) {
  const [openDelayVendor, setOpenDelayVendor] = useState(null);
  const [colMap, setColMap] = useState(null); // product_id → [collection names]

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const [cols, links] = await Promise.all([
          supabase.from("stock_room_collection").select("id, name"),
          fetchAllRows("stock_room_product_collection", (q) => q.select("product_id, collection_id").order("product_id")),
        ]);
        if (off) return;
        const nameOf = Object.fromEntries((cols.data || []).map((c) => [c.id, c.name]));
        const m = {};
        (links.data || []).forEach((l) => { if (nameOf[l.collection_id]) (m[l.product_id] = m[l.product_id] || []).push(nameOf[l.collection_id]); });
        setColMap(m);
      } catch { if (!off) setColMap({}); }
    })();
    return () => { off = true; };
  }, []);

  // Code added: two partners can share a name (e.g. Pernia's Pop Up).
  const vendorName = (id) => {
    const v = vendorMap?.[id];
    if (!v) return id ? "Unknown partner" : "No partner";
    return `${v.store_brand_name || v.name || "Partner"}${v.vendor_code ? ` (${v.vendor_code})` : ""}`;
  };
  // Where the order really is, from its pieces (same rule as the order cards):
  // many B2B orders keep status "order_received" after their pieces ship.
  const progressOf = (o) => getOrderProgressStatus(o, componentsByOrder[o.id]);
  const SHIPPED = new Set(["Dispatched", "Delivered", "Completed", "Cancelled", "Revoked"]);
  const live = useMemo(() => (orders || []).filter((o) => !isDead(o)), [orders]);
  const now = Date.now();

  // 1. Running delayed (right now) — production not finished, delivery date passed.
  const delayed = useMemo(() => live.filter((o) => !o.is_stock_order && !SHIPPED.has(progressOf(o))
    && !DONE.has(String(o.status || "").toLowerCase()) && o.warehouse_stage !== "dispatched"
    && o.delivery_date && dayStart(o.delivery_date) < dayStart(now)), [live, componentsByOrder]); // eslint-disable-line react-hooks/exhaustive-deps
  const delayByVendor = useMemo(() => {
    const m = {};
    delayed.forEach((o) => {
      const k = o.vendor_id || "none";
      const late = Math.floor((dayStart(now) - dayStart(o.delivery_date)) / DAY);
      if (!m[k]) m[k] = { id: k, name: vendorName(o.vendor_id), orders: 0, value: 0, maxLate: 0, list: [] };
      m[k].orders += 1; m[k].value += valueOf(o); m[k].maxLate = Math.max(m[k].maxLate, late); m[k].list.push({ o, late });
    });
    return Object.values(m).sort((a, b) => b.orders - a.orders);
  }, [delayed, vendorMap]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2. Delivered late — finished in the period, after the delivery date.
  const finished = useMemo(() => live.filter((o) => !o.is_stock_order && (DONE.has(String(o.status || "").toLowerCase()) || o.warehouse_stage === "dispatched")), [live]); // eslint-disable-line react-hooks/exhaustive-deps
  const lateStats = useMemo(() => {
    const m = {}; let noDate = 0;
    finished.forEach((o) => {
      const f = finishedAt(o);
      if (!f) { noDate += 1; return; }
      if (!inPeriod(f) || !o.delivery_date) return;
      const lateDays = Math.round((dayStart(f) - dayStart(o.delivery_date)) / DAY);
      const k = o.vendor_id || "none";
      if (!m[k]) m[k] = { name: vendorName(o.vendor_id), done: 0, late: 0, lateDays: 0 };
      m[k].done += 1;
      if (lateDays > 0) { m[k].late += 1; m[k].lateDays += lateDays; }
    });
    return { rows: Object.values(m).sort((a, b) => b.late - a.late || b.done - a.done), noDate };
  }, [finished, inPeriod, vendorMap]); // eslint-disable-line react-hooks/exhaustive-deps

  // 3 + 4. Orders placed in the period.
  const placed = useMemo(() => live.filter((o) => inPeriod(o.created_at)), [live, inPeriod]);
  const byType = useMemo(() => {
    const m = {};
    placed.forEach((o) => { const t = orderType(o); if (!m[t]) m[t] = { type: t, orders: 0, revenue: 0 }; m[t].orders += 1; m[t].revenue += o.is_stock_order ? 0 : valueOf(o); });
    return Object.values(m).sort((a, b) => b.revenue - a.revenue || b.orders - a.orders);
  }, [placed]);
  const totalRevenue = byType.reduce((s, r) => s + r.revenue, 0);
  const totalOrders = byType.reduce((s, r) => s + r.orders, 0);

  const sales = useMemo(() => placed.filter((o) => !o.is_stock_order), [placed]);
  const colours = useMemo(() => {
    const m = {};
    sales.forEach((o) => itemShares(o).forEach(({ it, qty, value: val }) => {
      itemColours(it).forEach((c) => { if (!m[c]) m[c] = { name: c, pieces: 0, value: 0 }; m[c].pieces += qty; m[c].value += val; });
    }));
    return Object.values(m).sort((a, b) => b.pieces - a.pieces).slice(0, 12);
  }, [sales]);

  const collections = useMemo(() => {
    if (!colMap) return null;
    const m = {};
    sales.forEach((o) => itemShares(o).forEach(({ it, qty, value: val }) => {
      const names = colMap[it?.product_id] || ["No collection"];
      names.forEach((c) => { if (!m[c]) m[c] = { name: c, pieces: 0, value: 0, orders: new Set() }; m[c].pieces += qty; m[c].value += val; m[c].orders.add(o.id); });
    }));
    return Object.values(m).map((r) => ({ ...r, orders: r.orders.size })).sort((a, b) => b.value - a.value);
  }, [sales, colMap]);

  // First row = headers (downloadCsv stamps the date on the file name).
  const exportCsv = (what, table) => downloadCsv({ filename: `b2b-${what}`, headers: table[0], rows: table.slice(1) });

  return (
    <div className="merch-an">
      {/* 1. Running delayed */}
      <Card
        title={`Orders running delayed per partner (${delayed.length})`}
        sub="Still in production and the delivery date has passed. Counted as of today, whatever the period. Click a partner to see its orders."
        onExport={() => exportCsv("delayed", [["Partner", "Order", "Delivery date", "Days late", "Value"],
          ...delayByVendor.flatMap((v) => v.list.map(({ o, late }) => [v.name, o.order_no, o.delivery_date, late, Math.round(valueOf(o))]))])}
      >
        <Table
          head={["Partner", "Delayed orders", "Value", "Most days late", ""]}
          empty="No order is running late."
          rows={delayByVendor.flatMap((v) => [
            <tr key={v.id} className="merch-an-click" onClick={() => setOpenDelayVendor(openDelayVendor === v.id ? null : v.id)}>
              <td>{v.name}</td><td><b>{v.orders}</b></td><td>{rupees(v.value)}</td><td>{v.maxLate} days</td>
              <td className="merch-an-more">{openDelayVendor === v.id ? "Hide ▴" : "Orders ▾"}</td>
            </tr>,
            openDelayVendor === v.id && (
              <tr key={`${v.id}-list`} className="merch-an-sub"><td colSpan={5}>
                {v.list.sort((a, b) => b.late - a.late).map(({ o, late }) => (
                  <div key={o.id} className="merch-an-subrow">
                    <span>{o.order_no}</span><span>{o.items?.[0]?.product_name || "-"}</span>
                    <span>due {formatDate(o.delivery_date)}</span><b>{late} days late</b><span>{rupees(valueOf(o))}</span>
                  </div>
                ))}
              </td></tr>
            ),
          ])}
        />
      </Card>

      {/* 2. Delivered late */}
      <Card
        title="Orders delivered late"
        sub={`Orders finished in ${periodName || "the period"} after their delivery date (delivered date, else the date they were dispatched).${lateStats.noDate ? ` ${lateStats.noDate} finished orders have no finish date recorded and can't be checked.` : ""}`}
        onExport={() => exportCsv("delivered-late", [["Partner", "Finished", "Late", "% late", "Avg days late"],
          ...lateStats.rows.map((r) => [r.name, r.done, r.late, r.done ? Math.round((r.late / r.done) * 100) : 0, r.late ? (r.lateDays / r.late).toFixed(1) : 0])])}
      >
        <Table
          head={["Partner", "Finished", "Late", "% late", "Avg days late"]}
          rows={lateStats.rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td><td>{r.done}</td><td><b className={r.late ? "merch-red" : ""}>{r.late}</b></td>
              <td>{r.done ? Math.round((r.late / r.done) * 100) : 0}%</td><td>{r.late ? (r.lateDays / r.late).toFixed(1) : "—"}</td>
            </tr>
          ))}
        />
      </Card>

      {/* 3. By order type */}
      <Card
        title="Revenue and orders by order type"
        sub={`Orders placed in ${periodName || "the period"}: ${formatIndianNumber(totalOrders)} orders, ${rupees(totalRevenue)}. Stock orders are internal (no revenue).`}
        onExport={() => exportCsv("order-types", [["Order type", "Orders", "Revenue", "% of revenue"],
          ...byType.map((r) => [r.type, r.orders, Math.round(r.revenue), totalRevenue ? Math.round((r.revenue / totalRevenue) * 100) : 0])])}
      >
        <div className="merch-an-two">
          <div><h4>Revenue</h4><Bars data={byType.filter((r) => r.revenue > 0)} dataKey="revenue" label="type" format={rupees} /></div>
          <div><h4>Orders</h4><Bars data={byType} dataKey="orders" label="type" /></div>
        </div>
      </Card>

      {/* 4. Colours + collections */}
      <Card
        title="Best colours"
        sub="Pieces sold per colour (top, bottom, dupatta and extras), orders placed in the period. Top 12."
        onExport={() => exportCsv("colours", [["Colour", "Pieces", "Value"], ...colours.map((c) => [c.name, c.pieces, Math.round(c.value)])])}
      >
        <Bars data={colours} dataKey="pieces" label="name" format={(v) => `${v} pcs`} />
      </Card>
      <Card
        title="Collection performance"
        sub="Value sold per Stock Room collection, orders placed in the period. A design in no collection counts under 'No collection'."
        onExport={collections ? () => exportCsv("collections", [["Collection", "Orders", "Pieces", "Value"], ...collections.map((c) => [c.name, c.orders, c.pieces, Math.round(c.value)])]) : null}
      >
        {collections === null ? <p className="merch-an-empty">Loading collections…</p> : (
          <>
            <Bars data={collections.slice(0, 12)} dataKey="value" label="name" format={rupees} />
            <Table
              head={["Collection", "Orders", "Pieces", "Value"]}
              rows={collections.map((c) => <tr key={c.name}><td>{c.name}</td><td>{c.orders}</td><td>{c.pieces}</td><td>{rupees(c.value)}</td></tr>)}
            />
          </>
        )}
      </Card>
    </div>
  );
}
