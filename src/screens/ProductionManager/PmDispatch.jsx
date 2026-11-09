import React, { useEffect, useMemo, useState } from "react";
import DispatchReport from "../../components/DispatchReport";
import formatDate from "../../utils/formatDate";
import { Empty, Insight, PageHead, Pager, Seg, num } from "../CeoDashboard/CeoUi";
import { defineKit } from "../CeoDashboard/dashKit";
import { CARD_INFO, COLUMN_INFO, TILE_INFO } from "./pmDefinitions";
import { DueCell, OrderCell, exportOrders } from "./PmCommon";
import { DAY, channelOf, hasPromise, localDay, pct, plural, statusOf, todayStart } from "./pmModel";
import { GOLD, StackBars, windowStart } from "./PmQuality";

// ============================================================
// Dispatch & Delivery: what is ready to go, what went out, and whether it
// reached the client on time. No money and no client contact details.
//
// One on-time rule for the whole page: an order is delivered on time when the
// day it was delivered (delivered_at) is on or before the client's delivery
// date, both read as local calendar days. Website and stock orders are left
// out because they carry no promised date.
// ============================================================

const LOCAL_TILES = {
  "Ready to Dispatch": "Orders not yet dispatched whose pieces have all passed Final QC or been marked complete (pieces already sent or disposed are not waited on).",
  "Waiting Over 2 Days": "Orders ready to dispatch whose last piece was finished two or more days ago.",
  Dispatched: "Orders whose first piece was scanned out at the Packaging station in the period. This is where dispatches are recorded.",
  Delivered: "Orders delivered in the period, by the date the delivery was recorded.",
  "Delivered On Time": "Share of orders delivered in the period on or before the client's delivery date. Website and stock orders, and orders without a delivery date, are not counted.",
};
const LOCAL_CARDS = {
  "Dispatch Queue": "Orders ready to dispatch, the ones waiting longest first. Click an order to open it and mark it completed or see its pieces.",
  "Dispatched per Day": "Orders dispatched each day (each week for 90 days). Click a bar to see the orders.",
  "On Time by Channel": "Orders delivered in the period, on time and late, by channel. The total is above each bar. Click a part to see the orders.",
  "Early or Late": "How many days before or after the client's delivery date orders were delivered, for orders delivered in the period.",
};
const { Tile, Card, Table } = defineKit({ tiles: { ...TILE_INFO, ...LOCAL_TILES }, cards: { ...CARD_INFO, ...LOCAL_CARDS }, columns: COLUMN_INFO });

const PERIODS = [{ value: "7", label: "Last 7 Days" }, { value: "30", label: "Last 30 Days" }, { value: "90", label: "Last 90 Days" }];
const READY = new Set(["final_qc_passed", "production_complete", "packaging_dispatch"]);
const GONE = new Set(["dispatched", "delivered", "cancelled", "revoked", "returned", "exchange_return"]);
const PAGE = 10;

/** Days the client got it before (negative) or after (positive) the promised date. */
const deliveryGap = (o) => {
  const got = localDay(o.delivered_at);
  const promised = localDay(o.delivery_date);
  return got && promised ? Math.round((got - promised) / DAY) : null;
};

export default function DispatchPage({ ctx }) {
  const { orders, componentsByOrder, openOrders, openOrder, lazy, need, ordersById } = ctx;
  useEffect(() => { need("dispatch120"); }, [need]);
  const dispatchScans = lazy.dispatch120?.rows;
  // When each order was first dispatched: its first piece scanned out at Packaging.
  const firstOut = useMemo(() => {
    const m = {};
    (dispatchScans || []).forEach((t) => { if (t.order_id && !m[t.order_id]) m[t.order_id] = t.scanned_at; });
    return m;
  }, [dispatchScans]);
  const [period, setPeriod] = useState("30");
  const [page, setPage] = useState(1);

  const data = useMemo(() => {
    const days = Number(period);
    const start = windowStart(days);
    const now = Date.now();
    const inP = (ts) => !!ts && new Date(ts) >= start;

    // Ready to dispatch: every live piece is finished (or already sent), at least one is waiting.
    const ready = [];
    orders.forEach((o) => {
      if (GONE.has(statusOf(o)) || o.warehouse_stage === "dispatched") return;
      const live = (componentsByOrder[o.id] || []).filter((c) => !c.cancelled_at && c.current_stage !== "disposed" && c.current_stage !== "scrapped");
      const waiting = live.filter((c) => READY.has(c.current_stage));
      if (!waiting.length || !live.every((c) => READY.has(c.current_stage) || c.current_stage === "dispatched")) return;
      const since = Math.max(...waiting.map((c) => new Date(c.stage_updated_at || o.updated_at || o.created_at).getTime()));
      ready.push({ o, since, waitDays: Math.floor((now - since) / DAY), partial: live.some((c) => c.current_stage === "dispatched") });
    });
    ready.sort((a, b) => a.since - b.since);
    const stale = ready.filter((r) => r.waitDays >= 2);

    const dispatched = Object.keys(firstOut).filter((id) => inP(firstOut[id])).map((id) => ordersById[id]).filter(Boolean);
    const outAt = (o) => firstOut[o.id];
    const delivered = orders.filter((o) => inP(o.delivered_at));
    const judged = delivered.filter((o) => hasPromise(o) && deliveryGap(o) != null);
    const onTime = judged.filter((o) => deliveryGap(o) <= 0);
    const late = judged.filter((o) => deliveryGap(o) > 0);

    // Dispatched per day (7 / 30 days) or per week (90 days).
    const step = days === 90 ? 7 : 1;
    const perDay = [];
    for (let s = new Date(start); s <= todayStart(); s.setDate(s.getDate() + step)) {
      const from = new Date(s);
      const to = new Date(s); to.setDate(to.getDate() + step);
      const list = dispatched.filter((o) => { const t = new Date(outAt(o)); return t >= from && t < to; });
      perDay.push({
        name: step === 1 && days === 7 ? from.toLocaleDateString("en-GB", { weekday: "short" }) : from.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        full: step === 1 ? formatDate(from) : `Week from ${formatDate(from)}`,
        value: list.length, list,
      });
    }

    const ch = {};
    judged.forEach((o) => {
      const k = channelOf(o);
      const r = ch[k] || (ch[k] = { name: k, onTime: 0, late: 0, onList: [], lateList: [] });
      if (deliveryGap(o) <= 0) { r.onTime += 1; r.onList.push(o); } else { r.late += 1; r.lateList.push(o); }
    });
    const byChannel = Object.values(ch).sort((a, b) => (b.onTime + b.late) - (a.onTime + a.late));

    const GAPS = [
      { name: "8+ early", test: (g) => g <= -8 }, { name: "4–7 early", test: (g) => g <= -4 && g >= -7 }, { name: "1–3 early", test: (g) => g <= -1 && g >= -3 },
      { name: "On the day", test: (g) => g === 0 }, { name: "1–3 late", test: (g) => g >= 1 && g <= 3 }, { name: "4–7 late", test: (g) => g >= 4 && g <= 7 },
      { name: "8+ late", test: (g) => g >= 8 },
    ];
    const gaps = GAPS.map((b) => { const list = judged.filter((o) => b.test(deliveryGap(o))); return { name: b.name, value: list.length, list }; });
    const lateDays = late.map(deliveryGap);
    const avgLate = lateDays.length ? lateDays.reduce((a, b) => a + b, 0) / lateDays.length : null;

    return { ready, stale, dispatched, delivered, judged, onTime, late, perDay, byChannel, gaps, avgLate, step };
  }, [orders, componentsByOrder, period, firstOut, ordersById]);

  const label = PERIODS.find((p) => p.value === period)?.label;
  const readyOrders = data.ready.map((r) => r.o);
  const onTimePct = data.judged.length ? pct(data.onTime.length, data.judged.length) : null;
  const CH = [{ key: "onTime", name: "On time", color: GOLD[1] }, { key: "late", name: "Late", color: GOLD[3] }];

  return (
    <div className="ceo-page">
      <PageHead title="Dispatch & Delivery" desc="What is ready to go out, what went out, and whether it reached the client on time.">
        <Seg label="Period" value={period} onChange={setPeriod} options={PERIODS} />
      </PageHead>
      <div className="ceo-tiles">
        <Tile icon="stock" label="Ready to Dispatch" value={num(data.ready.length)} note="Live" onClick={() => openOrders({ title: "Ready to Dispatch", sub: "Every piece finished, not yet dispatched", orders: readyOrders })} />
        <Tile icon="alert" tone={data.stale.length ? "warn" : undefined} label="Waiting Over 2 Days" value={num(data.stale.length)} note="Since the last piece finished" onClick={() => openOrders({ title: "Ready for 2+ Days", sub: "Finished two or more days ago, not yet dispatched", orders: data.stale.map((r) => r.o) })} />
        <Tile icon="transfer" label="Dispatched" value={dispatchScans ? num(data.dispatched.length) : "…"} note={label} onClick={() => openOrders({ title: "Dispatched", sub: label, orders: data.dispatched })} />
        <Tile icon="receive" label="Delivered" value={num(data.delivered.length)} note={label} onClick={() => openOrders({ title: "Delivered", sub: label, orders: data.delivered })} />
        <Tile icon="sale" label="Delivered On Time" value={onTimePct == null ? "–" : `${onTimePct}%`} note={`${num(data.onTime.length)} of ${num(data.judged.length)} dated orders`} onClick={() => openOrders({ title: "Delivered Late", sub: `${label}: after the client's delivery date`, orders: data.late })} />
      </div>

      <div className="ceo-grid">
        <Card span={12} title="What This Says">
          <div className="pmq-insights">
            {data.stale.length > 0
              ? <Insight tone="warn"><b>{plural(data.stale.length, "order")}</b> {data.stale.length === 1 ? "has" : "have"} been ready for two days or more; the longest for {plural(data.stale[0].waitDays, "day")} ({data.stale[0].o.order_no}).</Insight>
              : <Insight>No finished order has been waiting more than two days to go out.</Insight>}
            {onTimePct != null && (
              <Insight tone={onTimePct < 80 ? "warn" : "gold"}><b>{onTimePct}%</b> of orders delivered in the {label.toLowerCase()} reached the client on or before the promised date{data.avgLate != null ? `; late ones were ${Math.round(data.avgLate * 10) / 10} days late on average` : ""}.</Insight>
            )}
          </div>
        </Card>

        <Card span={12} title="Dispatch Queue" sub="Waiting longest first. Click an order to open it.">
          <Table rowKey={(r) => r.o.id} rows={data.ready.slice((page - 1) * PAGE, page * PAGE)} onRow={(r) => openOrder(r.o)} empty="Nothing is waiting to be dispatched." columns={[
            { key: "order", label: "Order", render: (r) => <OrderCell o={r.o} ctx={ctx} /> },
            { key: "wait", label: "Waiting", right: true, render: (r) => <span className="pm-cell is-right"><b className={r.waitDays >= 2 ? "pm-late" : undefined}>{r.waitDays ? plural(r.waitDays, "day") : "Today"}</b><small>{r.partial ? "Part already sent" : `Ready since ${formatDate(new Date(r.since))}`}</small></span> },
            { key: "due", label: "Due Date", right: true, hide: true, render: (r) => <DueCell o={r.o} /> },
          ]} />
          <Pager page={page} pages={Math.ceil(data.ready.length / PAGE)} onChange={setPage} />
          {data.ready.length > 0 && <div className="gm-actions pmv-under"><button type="button" className="ceo-btn" onClick={() => exportOrders("dispatch queue", readyOrders, ctx)}>Export CSV</button></div>}
        </Card>

        <Card span={7} md={12} title="Dispatched per Day" sub={`${data.step === 7 ? "Per week" : "Per day"}, ${label.toLowerCase()}`}>
          <StackBars data={data.perDay} series={[{ key: "value", name: "Orders dispatched", color: GOLD[1] }]} height={260}
            onPick={(b) => { const d = data.perDay.find((x) => x.name === b.name); if (d) openOrders({ title: `Dispatched: ${d.full}`, sub: plural(d.value, "order"), orders: d.list }); }} />
        </Card>

        <Card span={5} md={12} title="Early or Late" sub="Days before or after the client's delivery date">
          {!data.judged.length ? <Empty text="No dated deliveries in this period." /> : (
            <StackBars data={data.gaps} series={[{ key: "value", name: "Orders", color: GOLD[2] }]} height={260}
              onPick={(b) => { const g = data.gaps.find((x) => x.name === b.name); if (g) openOrders({ title: `Delivered ${g.name}`, sub: label, orders: g.list }); }} />
          )}
        </Card>

        <Card span={12} title="On Time by Channel" sub={label}>
          <StackBars data={data.byChannel} series={CH} height={260}
            onPick={(b, key) => { const r = data.byChannel.find((x) => x.name === b.name); if (r) openOrders({ title: `${r.name}: ${key === "late" ? "Delivered Late" : "Delivered On Time"}`, sub: label, orders: key === "late" ? r.lateList : r.onList }); }} />
          <div className="pmq-legend">{CH.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.name}</span>)}</div>
        </Card>
      </div>

      <h2 className="pmd-title">Boxes Dispatched</h2>
      <section className="ceo-card pm-classic ceo-keep"><DispatchReport hideMoney /></section>
      <p className="pm-foot-note">On time means delivered on or before the client's delivery date. Website and stock orders are left out of on-time figures because they carry no promised date.</p>
    </div>
  );
}
