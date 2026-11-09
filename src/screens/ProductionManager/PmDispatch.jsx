import React, { useEffect, useMemo, useState } from "react";
import { fmtDate as formatDate } from "./pmModel";
import { Chips, Empty, FilterButton, FilterGroup, Insight, PageHead, Pager, RankBars, num } from "../CeoDashboard/CeoUi";
import { FilterDrawer, ListTools, defineKit } from "../CeoDashboard/dashKit";
import { CARD_INFO, COLUMN_INFO, TILE_INFO } from "./pmDefinitions";
import { Dots, OrderNo, Table, csvFromObjects, orderColumns, orderStatus } from "./PmCommon";
import {
  DAY, channelOf, clientOf, daysLeft, dueDay, hasPromise, isRemovedPiece, isRunning, isUrgent, localDay, pct, plural, productsOf, readyToDispatch,
  todayStart,
} from "./pmModel";
import { GOLD, StackBars } from "./PmQuality";
import { BoxesList } from "./PmRecords";
import { coverKey, periodSteps } from "./pmPeriod";
import "./PmFlow2.css";

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
  "Partly Ready": "Running orders with at least one piece that has passed Final QC or been marked complete while other pieces are still being made. They cannot go out yet.",
  "Waiting Over 2 Days": "Orders ready to dispatch whose last piece was finished two or more days ago.",
  Dispatched: "Orders whose first piece was scanned out at the Packaging station in the period. This is where dispatches are recorded.",
  Delivered: "Orders delivered in the period, by the date the delivery was recorded.",
  "Delivered On Time": "Share of orders delivered in the period on or before the client's delivery date. Website and stock orders, and orders without a delivery date, are not counted.",
  "Overdue to Dispatch": "Orders ready to dispatch whose due date (two days before the client's delivery date) has already passed. Website and stock orders are not counted, as everywhere else.",
  "Due in Range": "Orders ready to dispatch whose due date falls inside the date range chosen at the top.",
  "Average Wait": "Average days the orders ready to dispatch have waited since their last piece was finished.",
  "Longest Wait": "The order ready to dispatch that has waited longest since its last piece was finished.",
  "On-Time Dispatch": "Of the orders dispatched in the period that have a due date, the share whose first piece was scanned out on or before the due date. Website and stock orders are not counted.",
  "Average Days Late": "For orders delivered late in the period: the average days after the client's delivery date.",
  "Worst Delay": "The most days after the client's delivery date that any order delivered in the period arrived.",
  "14+ Days Late": "Orders delivered in the period 14 days or more after the client's delivery date.",
};
const LOCAL_CARDS = {
  "Dispatch Queue": "Orders ready to dispatch, the ones waiting longest first. Choose Partly ready under Waiting in the filters to see orders with only some pieces ready. Click an order to open it and mark it completed or see its pieces.",
  "Dispatched Over Time": "Orders dispatched each day, week or month, depending on the length of the date range. Click a bar to see the orders.",
  "On Time by Channel": "Orders delivered in the period, on time and late, by channel. The total is above each bar. Click a part, or a number in the table, to see the orders.",
  "Early or Late": "How many days before or after the client's delivery date orders were delivered, for orders delivered in the period.",
  "Awaiting by Channel": "Orders ready to dispatch, by channel, with each channel's share of the queue. Click a channel to show only that channel on this page.",
  "Dispatched by Channel": "Orders dispatched in the period, by channel, with each channel's share. Click a channel to show only that channel on this page.",
  "Recently Dispatched": "Orders dispatched in the period, latest first. Dispatched On is the day the first piece was scanned out at Packaging. On Time compares that day with the due date; website and stock orders are not counted. Click an order to open it.",
  "On Time by Salesperson": "The 8 salespeople with the most dated deliveries in the period, the lowest on-time share first. Average days late is over the late ones only. Click a number to see the orders.",
  "Delivered Orders": "Every order delivered in the period, latest first. Days Late compares the delivery day with the client's delivery date; website and stock orders are not counted. Click an order to open it.",
};
const { Tile, Card } = defineKit({ tiles: { ...TILE_INFO, ...LOCAL_TILES }, cards: { ...CARD_INFO, ...LOCAL_CARDS }, columns: COLUMN_INFO });

const QUEUE_SORTS = [
  { value: "wait", label: "Waiting longest" }, { value: "due", label: "Due date, soonest" },
  { value: "new", label: "Newest order" }, { value: "old", label: "Oldest order" },
];
const WAIT_OPTIONS = [{ value: "today", label: "Ready today" }, { value: "2", label: "2 days or more" }, { value: "partly", label: "Partly ready" }];
const modeOf = (o) => { const m = String(o.mode_of_delivery || "").trim(); return m ? m.replace(/\b\w/g, (x) => x.toUpperCase()) : "Not given"; };
const PAGE = 10;
const lc = (v) => String(v || "").toLowerCase();

/** Days the client got it before (negative) or after (positive) the promised date. */
const deliveryGap = (o) => {
  const got = localDay(o.delivered_at);
  const promised = localDay(o.delivery_date);
  return got && promised ? Math.round((got - promised) / DAY) : null;
};

// A piece is ready to go once it has passed Final QC or been marked complete.
const READY_AT = new Set(["final_qc_passed", "production_complete", "packaging_dispatch"]);
/** The order's live pieces split into ready, already sent and still being made. */
const pieceCounts = (comps = []) => {
  const live = comps.filter((c) => !isRemovedPiece(c));
  const ready = live.filter((c) => READY_AT.has(c.current_stage)).length;
  const sent = live.filter((c) => c.current_stage === "dispatched").length;
  return { live: live.length, ready, sent, making: live.length - ready - sent };
};
const readyLine = (r) => `${num(r.ready)} of ${num(r.live)} ready${r.sent ? ` · ${num(r.sent)} sent` : ""}`;
/** "3d overdue" · "Due today" · "4d left" · "No date". */
const dueText = (o) => {
  const d = daysLeft(o);
  if (d == null) return "No date";
  return d < 0 ? `${-d}d overdue` : d === 0 ? "Due today" : `${d}d left`;
};
const searchHit = (o, q, vendorMap) => !q || [o.order_no, clientOf(o, vendorMap), o.salesperson, productsOf(o)].some((v) => lc(v).includes(q));
/** Whole days the first dispatch scan came after the due date (0 or less = on time). */
const dispatchGap = (o, at) => {
  const due = dueDay(o);
  const out = localDay(at);
  return due && out ? Math.round((out - due) / DAY) : null;
};
const dispatchOnTimeText = (o, at) => {
  if (!hasPromise(o)) return "Not counted";
  const g = dispatchGap(o, at);
  if (g == null) return "No date";
  return g <= 0 ? "On time" : `${plural(g, "day")} late`;
};
const deliveryLateText = (o) => {
  if (!hasPromise(o)) return "Not counted";
  const g = deliveryGap(o);
  if (g == null) return "No date";
  return g <= 0 ? "On time" : `${plural(g, "day")} late`;
};
const LateTag = ({ text }) => <span className={/late|overdue/.test(text) ? "pm-late" : /Not counted|No date/.test(text) ? "pm-muted" : undefined}>{text}</span>;

/** A count that opens its orders; a plain 0 when there is nothing to open. */
const CountLink = ({ list, late, onOpen }) => (list.length
  ? <button type="button" className={`pmf2-link${late ? " is-late" : ""}`} onClick={(e) => { e.stopPropagation(); onOpen(list); }}>{num(list.length)}</button>
  : <span className="pm-muted">0</span>);

/** On time and late per group (channel or salesperson), from the judged deliveries. */
const onTimeGroups = (judged, keyOf) => {
  const m = {};
  judged.forEach((o) => {
    const k = keyOf(o);
    const r = m[k] || (m[k] = { name: k, all: [], onList: [], lateList: [] });
    r.all.push(o);
    if (deliveryGap(o) <= 0) r.onList.push(o); else r.lateList.push(o);
  });
  return Object.values(m).map((r) => {
    const days = r.lateList.map(deliveryGap);
    return { ...r, share: pct(r.onList.length, r.all.length), avgLate: days.length ? days.reduce((a, b) => a + b, 0) / days.length : null };
  });
};

/** Deliveries, on time, late, on-time % and average days late per group. */
function OnTimeTable({ rows, label, sub, ctx }) {
  const open = (r, what, list) => ctx.openOrders({ title: `${r.name}: ${what}`, sub, orders: list });
  return (
    <Table rowKey={(r) => r.name} rows={rows} empty="No dated deliveries in this period." columns={[
      { key: "name", label, render: (r) => <b>{r.name}</b> },
      { key: "all", label: "Deliveries", right: true, render: (r) => <CountLink list={r.all} onOpen={(l) => open(r, "Delivered", l)} /> },
      { key: "on", label: "On Time", right: true, render: (r) => <CountLink list={r.onList} onOpen={(l) => open(r, "Delivered On Time", l)} /> },
      { key: "late", label: "Late", right: true, render: (r) => <CountLink list={r.lateList} late onOpen={(l) => open(r, "Delivered Late", l)} /> },
      { key: "share", label: "On-Time %", right: true, render: (r) => <b className={r.share < 80 ? "pm-late" : undefined}>{r.share}%</b> },
      { key: "avg", label: "Average Days Late", right: true, render: (r) => (r.avgLate == null ? "–" : `${Math.round(r.avgLate * 10) / 10}`) },
    ]} />
  );
}

export default function DispatchPage({ ctx }) {
  const { orders: allOrders, componentsByOrder, openOrders, openOrder, lazy, need, ordersById, period } = ctx;
  const dKey = coverKey("dispatch", period.back);
  useEffect(() => { need(dKey); }, [need, dKey]);
  const dispatchScans = lazy[dKey]?.rows;
  const [drawer, setDrawer] = useState(false);
  const [channels, setChannels] = useState([]);
  const [modes, setModes] = useState([]);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [sort, setSort] = useState("wait");
  const [waitF, setWaitF] = useState("");
  const [qSearch, setQSearch] = useState("");
  const [dSearch, setDSearch] = useState("");
  const choices = useMemo(() => {
    const count = (keyOf) => { const m = {}; allOrders.forEach((o) => { const k = keyOf(o); m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k]) => ({ value: k, label: k })); };
    return { channels: count(channelOf), modes: count(modeOf) };
  }, [allOrders]);
  const orders = useMemo(() => allOrders.filter((o) => (!channels.length || channels.includes(channelOf(o)))
    && (!modes.length || modes.includes(modeOf(o))) && (!urgentOnly || isUrgent(o))), [allOrders, channels, modes, urgentOnly]);
  const keep = useMemo(() => new Set(orders.map((o) => o.id)), [orders]);
  const filterCount = (channels.length ? 1 : 0) + (modes.length ? 1 : 0) + (urgentOnly ? 1 : 0) + (waitF ? 1 : 0) + (sort !== "wait" ? 1 : 0);
  // When each order was first dispatched: its first piece scanned out at Packaging.
  const firstOut = useMemo(() => {
    const m = {};
    (dispatchScans || []).forEach((t) => { if (t.order_id && !m[t.order_id]) m[t.order_id] = t.scanned_at; });
    return m;
  }, [dispatchScans]);
  const [page, setPage] = useState(1);
  const [recentPage, setRecentPage] = useState(1);
  const [deliveredPage, setDeliveredPage] = useState(1);
  useEffect(() => { setPage(1); }, [channels, modes, urgentOnly, sort, waitF, qSearch]);
  useEffect(() => { setRecentPage(1); setDeliveredPage(1); }, [channels, modes, urgentOnly, period]);
  useEffect(() => { setDeliveredPage(1); }, [dSearch]);

  const data = useMemo(() => {
    const now = Date.now();
    const today = todayStart();
    const inP = period.inP;

    // Ready to dispatch: the shared rule (pmModel.readyToDispatch), so Today and this page agree.
    const readyAll = readyToDispatch(orders, componentsByOrder, now).map((r) => ({ ...r, ...pieceCounts(componentsByOrder[r.o.id]) }));
    // Partly ready: running, some live piece ready, some still being made.
    const partlyAll = [];
    orders.forEach((o) => {
      if (!isRunning(o)) return;
      const comps = componentsByOrder[o.id] || [];
      const k = pieceCounts(comps);
      if (!k.ready || !k.making) return;
      // Waiting since the first of its ready pieces was finished.
      const since = Math.min(...comps.filter((c) => !isRemovedPiece(c) && READY_AT.has(c.current_stage)).map((c) => new Date(c.stage_updated_at || o.created_at).getTime()));
      partlyAll.push({ o, since, waitDays: Math.floor((now - since) / DAY), partial: k.sent > 0, ...k });
    });
    partlyAll.sort((a, b) => a.since - b.since);

    const ready = waitF === "partly" ? [...partlyAll]
      : waitF === "2" ? readyAll.filter((r) => r.waitDays >= 2) : waitF === "today" ? readyAll.filter((r) => !r.waitDays) : [...readyAll];
    const dueMs = (o) => (dueDay(o) || new Date(8.64e15)).getTime();
    if (sort === "due") ready.sort((a, b) => dueMs(a.o) - dueMs(b.o));
    else if (sort === "new") ready.sort((a, b) => new Date(b.o.created_at) - new Date(a.o.created_at));
    else if (sort === "old") ready.sort((a, b) => new Date(a.o.created_at) - new Date(b.o.created_at));
    const stale = readyAll.filter((r) => r.waitDays >= 2);

    // Figures over the whole ready queue (not the Waiting filter).
    const overdue = readyAll.filter((r) => hasPromise(r.o) && dueDay(r.o) && dueDay(r.o) < today);
    const dueInRange = readyAll.filter((r) => { const d = dueDay(r.o); return d && inP(d); });
    const avgWait = readyAll.length ? readyAll.reduce((s, r) => s + r.waitDays, 0) / readyAll.length : null;
    const longest = readyAll.reduce((best, r) => (!best || r.waitDays > best.waitDays ? r : best), null);

    const dispatched = Object.keys(firstOut).filter((id) => keep.has(id) && inP(firstOut[id])).map((id) => ordersById[id]).filter(Boolean);
    const outAt = (o) => firstOut[o.id];
    const dispJudged = dispatched.filter((o) => hasPromise(o) && dispatchGap(o, outAt(o)) != null);
    const dispOnTime = dispJudged.filter((o) => dispatchGap(o, outAt(o)) <= 0);
    const dispLate = dispJudged.filter((o) => dispatchGap(o, outAt(o)) > 0);
    const recent = [...dispatched].sort((a, b) => new Date(outAt(b)) - new Date(outAt(a)));

    const delivered = orders.filter((o) => inP(o.delivered_at));
    const judged = delivered.filter((o) => hasPromise(o) && deliveryGap(o) != null);
    const onTime = judged.filter((o) => deliveryGap(o) <= 0);
    const late = judged.filter((o) => deliveryGap(o) > 0);

    // Dispatched per day, week or month across the range.
    const { step, steps } = periodSteps(period);
    const perDay = steps.map((b) => {
      const list = dispatched.filter((o) => { const t = new Date(outAt(o)); return t >= b.from && t < b.to; });
      return { name: b.name, full: b.full, value: list.length, list };
    });

    const ch = {};
    judged.forEach((o) => {
      const k = channelOf(o);
      const r = ch[k] || (ch[k] = { name: k, onTime: 0, late: 0, onList: [], lateList: [] });
      if (deliveryGap(o) <= 0) { r.onTime += 1; r.onList.push(o); } else { r.late += 1; r.lateList.push(o); }
    });
    const byChannel = Object.values(ch).sort((a, b) => (b.onTime + b.late) - (a.onTime + a.late));
    const channelTable = onTimeGroups(judged, channelOf).sort((a, b) => b.all.length - a.all.length);
    const bySalesperson = onTimeGroups(judged, (o) => String(o.salesperson || "").trim() || "Not given")
      .sort((a, b) => b.all.length - a.all.length).slice(0, 8)
      .sort((a, b) => a.share - b.share || b.all.length - a.all.length);

    const GAPS = [
      { name: "8+ early", test: (g) => g <= -8 }, { name: "4–7 early", test: (g) => g <= -4 && g >= -7 }, { name: "1–3 early", test: (g) => g <= -1 && g >= -3 },
      { name: "On the day", test: (g) => g === 0 }, { name: "1–3 late", test: (g) => g >= 1 && g <= 3 }, { name: "4–7 late", test: (g) => g >= 4 && g <= 7 },
      { name: "8+ late", test: (g) => g >= 8 },
    ];
    const gaps = GAPS.map((b) => { const list = judged.filter((o) => b.test(deliveryGap(o))); return { name: b.name, value: list.length, list }; });
    const lateDays = late.map(deliveryGap);
    const avgLate = lateDays.length ? lateDays.reduce((a, b) => a + b, 0) / lateDays.length : null;
    const worst = lateDays.length ? Math.max(...lateDays) : null;
    const worstList = worst == null ? [] : late.filter((o) => deliveryGap(o) === worst);
    const late14 = late.filter((o) => deliveryGap(o) >= 14);

    // Share of the queue and of the dispatches per channel.
    const share = (list) => {
      const m = {};
      list.forEach((o) => { const k = channelOf(o); (m[k] || (m[k] = [])).push(o); });
      return Object.entries(m).map(([name, l]) => ({ name, value: l.length, list: l, share: pct(l.length, list.length) })).sort((a, b) => b.value - a.value);
    };

    return {
      ready, readyAll, partlyAll, stale, overdue, dueInRange, avgWait, longest,
      dispatched, dispJudged, dispOnTime, dispLate, recent,
      delivered, judged, onTime, late, perDay, byChannel, channelTable, bySalesperson, gaps, avgLate, worst, worstList, late14, step,
      awaitingByChannel: share(readyAll.map((r) => r.o)), dispatchedByChannel: share(dispatched),
    };
  }, [orders, componentsByOrder, period, firstOut, ordersById, keep, sort, waitF]);

  const queue = useMemo(() => { const q = lc(qSearch).trim(); return q ? data.ready.filter((r) => searchHit(r.o, q, ctx.vendorMap)) : data.ready; }, [data.ready, qSearch, ctx.vendorMap]);
  const deliveredList = useMemo(() => {
    const q = lc(dSearch).trim();
    return data.delivered.filter((o) => searchHit(o, q, ctx.vendorMap)).sort((a, b) => new Date(b.delivered_at) - new Date(a.delivered_at));
  }, [data.delivered, dSearch, ctx.vendorMap]);

  const label = period.label;
  const partlyMode = waitF === "partly";
  // The Ready to Dispatch tile follows the Waiting filter as before, except Partly ready (a different list).
  const readyRows = partlyMode ? data.readyAll : data.ready;
  const readyOrders = readyRows.map((r) => r.o);
  const onTimePct = data.judged.length ? pct(data.onTime.length, data.judged.length) : null;
  const dispOnTimePct = data.dispJudged.length ? pct(data.dispOnTime.length, data.dispJudged.length) : null;
  const CH = [{ key: "onTime", name: "On time", color: GOLD[1] }, { key: "late", name: "Late", color: GOLD[3] }];
  const outAt = (o) => firstOut[o.id];

  const exportQueue = () => csvFromObjects(partlyMode ? "partly ready orders" : "dispatch queue", queue.map((r) => {
    const d = dueDay(r.o);
    return {
      "Order No": r.o.order_no || "",
      Client: clientOf(r.o, ctx.vendorMap),
      Salesperson: r.o.salesperson || "",
      Channel: channelOf(r.o),
      Products: productsOf(r.o),
      Pieces: r.live,
      "Pieces Ready": r.ready,
      "Still in Production": r.making,
      "Ready Since": formatDate(new Date(r.since)),
      "Waiting Days": r.waitDays,
      "Due Date": d ? formatDate(d) : "",
      "Client Delivery Date": r.o.delivery_date ? formatDate(r.o.delivery_date) : "",
      "Days to Due": dueText(r.o),
      Status: orderStatus(r.o, componentsByOrder[r.o.id]),
    };
  }));
  const recentRow = (o) => { const k = pieceCounts(componentsByOrder[o.id]); return { o, sent: k.sent, pending: k.live - k.sent }; };
  const exportRecent = () => csvFromObjects("recently dispatched", data.recent.map((o) => {
    const r = recentRow(o);
    return {
      "Order No": o.order_no || "",
      Client: clientOf(o, ctx.vendorMap),
      Channel: channelOf(o),
      "Pieces Dispatched": r.sent,
      "Pieces Still Pending": r.pending,
      "Dispatched On": formatDate(outAt(o)),
      "On Time": dispatchOnTimeText(o, outAt(o)),
    };
  }));
  const exportDelivered = () => csvFromObjects("delivered orders", deliveredList.map((o) => ({
    "Order No": o.order_no || "",
    Client: clientOf(o, ctx.vendorMap),
    Channel: channelOf(o),
    Salesperson: o.salesperson || "",
    "Order Date": formatDate(o.created_at),
    "Client Delivery Date": o.delivery_date ? formatDate(o.delivery_date) : "",
    "Delivered On": formatDate(o.delivered_at),
    "Days Late": deliveryLateText(o),
  })));
  const pickChannel = (r) => setChannels([r.name]);

  return (
    <div className="ceo-page">
      <PageHead title="Dispatch & Delivery" desc="What is ready to go out, what went out, and whether it reached the client on time.">
        <FilterButton count={filterCount} onClick={() => setDrawer(true)} />
      </PageHead>
      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} count={data.ready.length} noun="orders in the queue" sub="Narrow every figure on this page"
        onClear={() => { setChannels([]); setModes([]); setUrgentOnly(false); setSort("wait"); setWaitF(""); }}>
        <FilterGroup label="Sort the Queue By"><Chips options={QUEUE_SORTS} value={sort} onChange={(v) => setSort(v || "wait")} /></FilterGroup>
        <FilterGroup label="Waiting"><Chips options={WAIT_OPTIONS} value={waitF} onChange={setWaitF} /></FilterGroup>
        <FilterGroup label="Priority"><Chips options={[{ value: "urgent", label: "Urgent only" }]} value={urgentOnly ? "urgent" : ""} onChange={(v) => setUrgentOnly(v === "urgent")} /></FilterGroup>
        <FilterGroup label="Channel"><Chips options={choices.channels} value={channels} onChange={setChannels} /></FilterGroup>
        <FilterGroup label="Delivery Mode"><Chips options={choices.modes} value={modes} onChange={setModes} /></FilterGroup>
      </FilterDrawer>
      <div className="ceo-tiles">
        <Tile icon="stock" label="Ready to Dispatch" value={num(readyRows.length)} note="Live" onClick={() => openOrders({ title: "Ready to Dispatch", sub: "Every piece finished, not yet dispatched", orders: readyOrders })} />
        <Tile icon="movements" label="Partly Ready" value={num(data.partlyAll.length)} note="Some pieces ready, others being made" onClick={() => openOrders({ title: "Partly Ready", sub: "Some pieces ready, others still being made", orders: data.partlyAll.map((r) => r.o) })} />
        <Tile icon="alert" tone={data.stale.length ? "warn" : undefined} label="Waiting Over 2 Days" value={num(data.stale.length)} note="Since the last piece finished" onClick={() => openOrders({ title: "Ready for 2+ Days", sub: "Finished two or more days ago, not yet dispatched", orders: data.stale.map((r) => r.o) })} />
        <Tile icon="transfer" label="Dispatched" value={dispatchScans ? num(data.dispatched.length) : <Dots />} note={label} onClick={() => openOrders({ title: "Dispatched", sub: label, orders: data.dispatched })} />
        <Tile icon="receive" label="Delivered" value={num(data.delivered.length)} note={label} onClick={() => openOrders({ title: "Delivered", sub: label, orders: data.delivered })} />
        <Tile icon="sale" label="Delivered On Time" value={onTimePct == null ? "–" : `${onTimePct}%`} note={`${num(data.onTime.length)} of ${num(data.judged.length)} dated orders`} onClick={() => openOrders({ title: "Delivered Late", sub: `${label}: after the client's delivery date`, orders: data.late })} />
      </div>
      <div className="ceo-tiles pmf2-tiles is-5">
        <Tile icon="alert" tone={data.overdue.length ? "warn" : undefined} label="Overdue to Dispatch" value={num(data.overdue.length)} note="Ready, due date passed" onClick={() => openOrders({ title: "Overdue to Dispatch", sub: "Ready to dispatch, past the due date", orders: data.overdue.map((r) => r.o) })} />
        <Tile icon="pin" label="Due in Range" value={num(data.dueInRange.length)} note={`Ready, due ${label.toLowerCase()}`} onClick={() => openOrders({ title: "Ready and Due in Range", sub: label, orders: data.dueInRange.map((r) => r.o) })} />
        <Tile icon="trend" label="Average Wait" value={data.avgWait == null ? "–" : `${Math.round(data.avgWait * 10) / 10} days`} note={`Over ${plural(data.readyAll.length, "ready order")}`} onClick={data.readyAll.length ? () => openOrders({ title: "Ready to Dispatch", sub: "Waiting longest first", orders: data.readyAll.map((r) => r.o) }) : undefined} />
        <Tile icon="bell" label="Longest Wait" value={data.longest ? plural(data.longest.waitDays, "day") : "–"} note={data.longest ? data.longest.o.order_no : "Nothing waiting"} onClick={data.longest ? () => openOrder(data.longest.o) : undefined} />
        <Tile icon="sale" label="On-Time Dispatch" value={!dispatchScans ? <Dots /> : dispOnTimePct == null ? "–" : `${dispOnTimePct}%`} note={`${num(data.dispOnTime.length)} of ${num(data.dispJudged.length)} on time`}
          onClick={() => openOrders({ title: "Dispatched After the Due Date", sub: `${label}: first piece scanned out after the due date`, orders: data.dispLate })} />
      </div>

      <div className="ceo-grid">
        <Card span={12} title="What This Says">
          <div className="pmq-insights">
            {data.stale.length > 0
              ? <Insight tone="warn"><b>{plural(data.stale.length, "order")}</b> {data.stale.length === 1 ? "has" : "have"} been ready for two days or more; the longest for {plural(data.stale[0].waitDays, "day")} ({data.stale[0].o.order_no}).</Insight>
              : <Insight>No finished order has been waiting more than two days to go out.</Insight>}
            {onTimePct != null && (
              <Insight tone={onTimePct < 80 ? "warn" : "gold"}><b>{onTimePct}%</b> of orders delivered ({label.toLowerCase()}) reached the client on or before the promised date{data.avgLate != null ? `; late ones were ${Math.round(data.avgLate * 10) / 10} days late on average` : ""}.</Insight>
            )}
          </div>
        </Card>

        <Card span={12} title="Dispatch Queue" sub={partlyMode
          ? `Partly ready orders: some pieces ready, others still being made. ${QUEUE_SORTS.find((s) => s.value === sort).label} first.`
          : `${QUEUE_SORTS.find((s) => s.value === sort).label} first. Click an order to open it.`}>
          <ListTools search={qSearch} onSearch={setQSearch} placeholder="Search order, client, salesperson or product" onExport={exportQueue} exportDisabled={!queue.length} />
          <Table rowKey={(r) => r.o.id} rows={queue.slice((page - 1) * PAGE, page * PAGE)} onRow={(r) => openOrder(r.o)}
            empty={qSearch ? "No order in the queue matches this search." : partlyMode ? "No order is partly ready." : "Nothing is waiting to be dispatched."} columns={orderColumns(ctx, [
              { key: "wait", label: "Waiting", right: true, render: (r) => <b className={r.waitDays >= 2 ? "pm-late" : undefined}>{r.waitDays ? plural(r.waitDays, "day") : "Today"}</b> },
              { key: "since", label: "Ready Since", right: true, render: (r) => (r.partial ? "Part already sent" : formatDate(new Date(r.since))) },
              { key: "ready", label: "Pieces Ready", flow: "one", info: "Pieces that have passed Final QC or been marked complete, out of the order's live pieces (cancelled and disposed pieces left out).", render: (r) => readyLine(r) },
              { key: "dtd", label: "Days to Due", right: true, info: "Days from today to the due date (two days before the client's delivery date).", render: (r) => <LateTag text={dueText(r.o)} /> },
            ], (r) => r.o)} />
          <Pager page={page} pages={Math.ceil(queue.length / PAGE)} onChange={setPage} />
        </Card>

        <Card span={6} md={12} title="Awaiting by Channel" sub={`${plural(data.readyAll.length, "order")} ready. Click a channel to filter the page.`}>
          <RankBars rows={data.awaitingByChannel} limit={12} format={(v) => plural(v, "order")} sub={(r) => `${r.share}% of the queue`} onRow={pickChannel} />
        </Card>
        <Card span={6} md={12} title="Dispatched by Channel" sub={`${plural(data.dispatched.length, "order")} ${label.toLowerCase()}. Click a channel to filter the page.`}>
          {!dispatchScans ? <Dots /> : <RankBars rows={data.dispatchedByChannel} limit={12} format={(v) => plural(v, "order")} sub={(r) => `${r.share}% of dispatches`} onRow={pickChannel} />}
        </Card>

        <Card span={7} md={12} title="Dispatched Over Time" sub={`Per ${data.step}, ${label.toLowerCase()}`}>
          <StackBars data={data.perDay} series={[{ key: "value", name: "Orders dispatched", color: GOLD[1] }]} height={260}
            onPick={(b) => { const d = data.perDay.find((x) => x.name === b.name); if (d) openOrders({ title: `Dispatched: ${d.full}`, sub: plural(d.value, "order"), orders: d.list }); }} />
        </Card>

        <Card span={5} md={12} title="Early or Late" sub="Days before or after the client's delivery date">
          {!data.judged.length ? <Empty text="No dated deliveries in this period." /> : (
            <StackBars data={data.gaps} series={[{ key: "value", name: "Orders", color: GOLD[2] }]} height={260}
              onPick={(b) => { const g = data.gaps.find((x) => x.name === b.name); if (g) openOrders({ title: `Delivered ${g.name}`, sub: label, orders: g.list }); }} />
          )}
        </Card>

        <Card span={12} title="Recently Dispatched" sub={`${plural(data.recent.length, "order")} ${label.toLowerCase()}, latest first. Click an order to open it.`}>
          <ListTools onExport={exportRecent} exportDisabled={!data.recent.length} />
          <Table rowKey={(o) => o.id} rows={data.recent.slice((recentPage - 1) * PAGE, recentPage * PAGE).map(recentRow)} onRow={(r) => openOrder(r.o)}
            empty={dispatchScans ? "Nothing was dispatched in this period." : "Loading the dispatch scans"} columns={[
              { key: "order", label: "Order", render: (r) => <OrderNo o={r.o} /> },
              { key: "client", label: "Client", render: (r) => clientOf(r.o, ctx.vendorMap) || <span className="pm-muted">–</span> },
              { key: "chan", label: "Channel", render: (r) => channelOf(r.o) },
              { key: "sent", label: "Pieces Dispatched", right: true, render: (r) => num(r.sent) },
              { key: "pending", label: "Pieces Still Pending", right: true, render: (r) => (r.pending ? <b className="pm-late">{num(r.pending)}</b> : "0") },
              { key: "on", label: "Dispatched On", right: true, render: (r) => formatDate(outAt(r.o)) },
              { key: "ontime", label: "On Time", flow: "one", render: (r) => <LateTag text={dispatchOnTimeText(r.o, outAt(r.o))} /> },
            ]} />
          <Pager page={recentPage} pages={Math.ceil(data.recent.length / PAGE)} onChange={setRecentPage} />
        </Card>
      </div>

      <h2 className="pmd-title">Deliveries</h2>
      <div className="ceo-tiles pmf2-tiles is-3">
        <Tile icon="trend" label="Average Days Late" value={data.avgLate == null ? "–" : `${Math.round(data.avgLate * 10) / 10} days`} note={`Over ${plural(data.late.length, "late delivery", "late deliveries")}`}
          onClick={data.late.length ? () => openOrders({ title: "Delivered Late", sub: `${label}: after the client's delivery date`, orders: data.late }) : undefined} />
        <Tile icon="alert" tone={data.worst != null ? "warn" : undefined} label="Worst Delay" value={data.worst == null ? "–" : plural(data.worst, "day")} note={data.worstList.length ? data.worstList.map((o) => o.order_no).slice(0, 2).join(", ") : "No late deliveries"}
          onClick={data.worstList.length ? () => openOrders({ title: "Worst Delay", sub: `${label}: delivered ${plural(data.worst, "day")} late`, orders: data.worstList }) : undefined} />
        <Tile icon="alert" tone={data.late14.length ? "warn" : undefined} label="14+ Days Late" value={num(data.late14.length)} note={`Of ${plural(data.judged.length, "dated delivery", "dated deliveries")}`}
          onClick={() => openOrders({ title: "Delivered 14+ Days Late", sub: label, orders: data.late14 })} />
      </div>
      <div className="ceo-grid">
        <Card span={12} title="On Time by Channel" sub={label}>
          <StackBars data={data.byChannel} series={CH} height={260}
            onPick={(b, key) => { const r = data.byChannel.find((x) => x.name === b.name); if (r) openOrders({ title: `${r.name}: ${key === "late" ? "Delivered Late" : "Delivered On Time"}`, sub: label, orders: key === "late" ? r.lateList : r.onList }); }} />
          <div className="pmq-legend">{CH.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.name}</span>)}</div>
          {data.channelTable.length > 0 && <div className="pmf2-under"><OnTimeTable rows={data.channelTable} label="Channel" sub={label} ctx={ctx} /></div>}
        </Card>

        <Card span={12} title="On Time by Salesperson" sub={`${label}. The 8 with the most dated deliveries, lowest on-time share first.`}>
          <OnTimeTable rows={data.bySalesperson} label="Salesperson" sub={label} ctx={ctx} />
        </Card>

        <Card span={12} title="Delivered Orders" sub={`${plural(data.delivered.length, "order")} delivered ${label.toLowerCase()}, latest first. Click an order to open it.`}>
          <ListTools search={dSearch} onSearch={setDSearch} placeholder="Search order, client, salesperson or product" onExport={exportDelivered} exportDisabled={!deliveredList.length} />
          <Table rowKey={(o) => o.id} rows={deliveredList.slice((deliveredPage - 1) * PAGE, deliveredPage * PAGE)} onRow={openOrder}
            empty={dSearch ? "No delivered order matches this search." : "No orders were delivered in this period."} columns={[
              { key: "order", label: "Order", render: (o) => <OrderNo o={o} /> },
              { key: "client", label: "Client", render: (o) => clientOf(o, ctx.vendorMap) || <span className="pm-muted">–</span> },
              { key: "chan", label: "Channel", render: (o) => channelOf(o) },
              { key: "sp", label: "Salesperson", render: (o) => o.salesperson || <span className="pm-muted">–</span> },
              { key: "od", label: "Order Date", right: true, render: (o) => formatDate(o.created_at) },
              { key: "dd", label: "Client Delivery Date", right: true, render: (o) => (o.delivery_date ? formatDate(o.delivery_date) : "–") },
              { key: "got", label: "Delivered On", right: true, render: (o) => formatDate(o.delivered_at) },
              { key: "late", label: "Days Late", right: true, render: (o) => <LateTag text={deliveryLateText(o)} /> },
            ]} />
          <Pager page={deliveredPage} pages={Math.ceil(deliveredList.length / PAGE)} onChange={setDeliveredPage} />
        </Card>
      </div>

      <h2 className="pmd-title">Boxes Dispatched</h2>
      <section className="ceo-card pm-records"><BoxesList ctx={ctx} /></section>
      <p className="pm-foot-note">On time means delivered on or before the client's delivery date. Website and stock orders are left out of on-time figures because they carry no promised date.</p>
    </div>
  );
}
