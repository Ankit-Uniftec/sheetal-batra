import React, { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { STAGE_GROUPS } from "../../utils/barcodeService";
import { Chips, Empty, FilterButton, FilterGroup, Icon, PageHead, RankBars, barValueLabel, num, textOn } from "../CeoDashboard/CeoUi";
import { FilterDrawer, defineKit } from "../CeoDashboard/dashKit";
import { OrdersTable } from "./PmCommon";
import {
  channelOf, dayKey, daysLeft, dueDay, floorKey, hasPromise, isLate, isRunning, pieceState, plural, todayStart,
} from "./pmModel";

// ============================================================
// Planning: what is due when, by the warehouse date (T-2). A month calendar
// of running orders, the load coming up over the next 14 days and what the
// floor must clear for this week's orders.
// ============================================================

const { Tile, Card } = defineKit({
  tiles: {
    "Due This Week": "Running orders whose due date (two days before the client's delivery date) falls in the next 7 days, today included.",
    "Pieces Due in 14 Days": "Pieces of running orders due in the next 14 days, today included, not counting cancelled pieces.",
    "Late Orders": "Running orders past their due date. Website and stock orders are not counted.",
    "No Due Date": "Running orders with no delivery date set, so they cannot be planned. Ask the store to add one.",
  },
  cards: {
    Calendar: "Running orders by their due date (two days before the client's delivery date). Past days with orders still open are shaded. Click a day to see its orders.",
    "Upcoming Load": "Pieces due each day for the next 14 days, split by where they are now. The number on top is the day's total. Click a bar to see that day's pieces.",
    "What the Floor Must Clear This Week": "Pieces of orders due in the next 7 days, by where they are now. Click a stage to see the pieces.",
    "Due This Week": "Running orders due in the next 7 days, soonest first.",
  },
});

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATES = [
  { key: "not_started", name: "Not started", color: "#6a4f0c" },
  { key: "in_house", name: "In the warehouse", color: "#a9821f" },
  { key: "at_vendor", name: "At vendors", color: "#cfae4e" },
  { key: "finished", name: "Finished", color: "#e6d18f" },
];
const GROUP_LABEL = Object.fromEntries(STAGE_GROUPS.map((g) => [g.key, g.label]));

export default function PlanningPage({ ctx }) {
  const { orders, componentsByOrder, openOrders, openPieces } = ctx;
  const today = todayStart();
  const [month, setMonth] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [channels, setChannels] = useState([]);
  const [drawer, setDrawer] = useState(false);

  const running = useMemo(() => orders.filter((o) => isRunning(o) && (!channels.length || channels.includes(channelOf(o)))), [orders, channels]);
  const channelList = useMemo(() => [...new Set(orders.filter(isRunning).map(channelOf))].sort(), [orders]);
  const livePieces = (o) => (componentsByOrder[o.id] || []).filter((c) => !c.cancelled_at && pieceState(c) !== "removed");

  const byDay = useMemo(() => {
    const m = {};
    running.forEach((o) => { const d = dueDay(o); if (d) (m[dayKey(d)] || (m[dayKey(d)] = [])).push(o); });
    return m;
  }, [running]);

  const cells = useMemo(() => {
    const first = new Date(month.y, month.m, 1);
    const lead = (first.getDay() + 6) % 7; // Monday first
    const count = new Date(month.y, month.m + 1, 0).getDate();
    const out = Array.from({ length: lead }, (_, i) => ({ empty: true, key: `e${i}` }));
    for (let d = 1; d <= count; d++) {
      const date = new Date(month.y, month.m, d);
      const k = dayKey(date);
      const list = byDay[k] || [];
      out.push({ key: k, date, d, list, past: date < today, today: k === dayKey(today), late: list.filter((o) => hasPromise(o)).length });
    }
    return out;
  }, [month, byDay]); // eslint-disable-line react-hooks/exhaustive-deps
  const monthTotal = cells.reduce((s, c) => s + (c.list?.length || 0), 0);

  const load = useMemo(() => {
    const rows = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i);
      const row = { key: dayKey(d), name: i === 0 ? "Today" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), total: 0, pieces: [] };
      STATES.forEach((s) => { row[s.key] = 0; });
      (byDay[row.key] || []).forEach((o) => livePieces(o).forEach((c) => {
        const st = pieceState(c);
        const k = STATES.some((s) => s.key === st) ? st : "in_house";
        row[k] += 1; row.total += 1; row.pieces.push(c);
      }));
      rows.push(row);
    }
    return rows;
  }, [byDay]); // eslint-disable-line react-hooks/exhaustive-deps

  const week = useMemo(() => running.filter((o) => { const d = daysLeft(o, today); return d != null && d >= 0 && d <= 6; }), [running]); // eslint-disable-line react-hooks/exhaustive-deps
  const clear = useMemo(() => {
    const m = {};
    week.forEach((o) => livePieces(o).forEach((c) => {
      const st = pieceState(c);
      let key; let name;
      if (st === "not_started") { key = "not_started"; name = "Not started"; }
      else if (st === "finished") { key = "finished"; name = "Finished"; }
      else if (st === "disposed") { key = "disposed"; name = "Disposed, to restart"; }
      else { key = floorKey(c) || "other"; name = `${GROUP_LABEL[key] || "Other"}${c.is_outside_wh ? " (at vendor)" : ""}`; if (c.is_outside_wh) key += ":v"; }
      const r = m[key] || (m[key] = { key, name, value: 0, list: [] });
      r.value += 1; r.list.push(c);
    }));
    return Object.values(m).sort((a, b) => (a.key === "finished") - (b.key === "finished") || b.value - a.value);
  }, [week]); // eslint-disable-line react-hooks/exhaustive-deps

  const late = running.filter((o) => isLate(o, today));
  const noDate = running.filter((o) => !dueDay(o));
  const pieces14 = load.reduce((s, r) => s + r.total, 0);
  const shift = (n) => setMonth((p) => { const d = new Date(p.y, p.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const chName = channels.length ? channels.join(", ") : "All channels";

  return (
    <div className="ceo-page">
      <PageHead title="Planning" desc="What is due when, by the warehouse date (two days before the client's delivery date). Click a day, a bar or a stage to see what is behind it.">
        <FilterButton count={channels.length ? 1 : 0} onClick={() => setDrawer(true)} />
      </PageHead>
      <div className="ceo-tiles">
        <Tile icon="bell" label="Due This Week" value={num(week.length)} note={chName} onClick={() => openOrders({ title: "Due This Week", sub: "Running orders due in the next 7 days", orders: week })} />
        <Tile icon="stock" label="Pieces Due in 14 Days" value={num(pieces14)} note={`${num(load.reduce((s, r) => s + r.not_started, 0))} not started yet`} onClick={() => openPieces({ title: "Pieces Due in 14 Days", sub: "Pieces of running orders due in the next 14 days", pieces: load.flatMap((r) => r.pieces) })} />
        <Tile icon="alert" tone={late.length ? "warn" : undefined} label="Late Orders" value={num(late.length)} note="Past the due date" onClick={() => openOrders({ title: "Late Orders", sub: "Past the due date (T-2), still in production", orders: late })} />
        <Tile icon="doc" tone={noDate.length ? "warn" : undefined} label="No Due Date" value={num(noDate.length)} note="Cannot be planned" onClick={() => openOrders({ title: "No Due Date", sub: "Running orders with no delivery date set", orders: noDate })} />
      </div>

      <div className="ceo-grid">
        <Card span={12} title="Calendar" sub={`${num(monthTotal)} running orders due in ${MONTHS[month.m]} ${month.y} · ${chName}`}>
          <div className="pmpl-cal-head">
            <button type="button" className="ceo-icon-btn" aria-label="Previous month" onClick={() => shift(-1)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg></button>
            <h3>{MONTHS[month.m]} {month.y}</h3>
            <button type="button" className="ceo-icon-btn" aria-label="Next month" onClick={() => shift(1)}><Icon name="chevron" /></button>
            <button type="button" className="ceo-btn" onClick={() => setMonth({ y: today.getFullYear(), m: today.getMonth() })}>This Month</button>
          </div>
          <div className="pmpl-cal-grid">
            {DOW.map((d) => <span key={d} className="pmpl-cal-dow">{d}</span>)}
            {cells.map((c) => (c.empty ? <span key={c.key} className="pmpl-cal-cell is-empty" /> : (
              <button key={c.key} type="button"
                className={`pmpl-cal-cell${c.today ? " is-today" : ""}${c.past && c.late ? " is-late" : ""}${c.list.length ? "" : " is-quiet"}`}
                disabled={!c.list.length}
                onClick={() => openOrders({ title: `Due ${c.date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`, sub: c.past ? "Past due, still in production" : "Running orders due this day", orders: c.list })}>
                <span className="pmpl-cal-num">{c.d}</span>
                {c.list.length > 0 && <b className="pmpl-cal-count">{num(c.list.length)}</b>}
                {c.list.length > 0 && <small className="pmpl-cal-sub">{c.list.length === 1 ? "order" : "orders"}</small>}
              </button>
            )))}
          </div>
        </Card>

        <Card span={7} md={12} title="Upcoming Load" sub={`${num(pieces14)} pieces due over the next 14 days`}>
          <LoadChart rows={load} onPick={(r) => r.total && openPieces({ title: `Pieces Due ${r.name}`, sub: "Pieces of running orders due this day", pieces: r.pieces })} />
        </Card>
        <Card span={5} md={12} title="What the Floor Must Clear This Week" sub={`${num(clear.reduce((s, r) => s + r.value, 0))} pieces of ${plural(week.length, "order")} due in 7 days`}>
          <RankBars rows={clear} limit={14} format={(v) => plural(v, "piece")}
            onRow={(r) => openPieces({ title: r.name, sub: "Pieces of orders due in the next 7 days", pieces: r.list })} />
        </Card>

        <Card span={12} title="Due This Week">
          <OrdersTable ctx={ctx} title="Due This Week" orders={week} stats={false} empty="Nothing due in the next 7 days." />
        </Card>
      </div>

      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} onClear={() => setChannels([])} count={running.length} noun="running orders" sub="Plan for some channels only">
        <FilterGroup label="Channel"><Chips options={channelList.map((c) => ({ value: c, label: c }))} value={channels} onChange={setChannels} /></FilterGroup>
      </FilterDrawer>
    </div>
  );
}

/** Pieces due per day, stacked by where they are now; counts inside, the day's total on top. */
function LoadChart({ rows, onPick }) {
  if (!rows.some((r) => r.total)) return <Empty text="Nothing due in the next 14 days." />;
  const used = STATES.filter((s) => rows.some((r) => r[s.key] > 0));
  const segLabel = (color) => ({ x, y, width, height, value }) => (
    value && height >= 14 && width >= 18
      ? <text x={x + width / 2} y={y + height / 2} dy="0.35em" textAnchor="middle" fontSize={10} fontWeight={600} fill={textOn(color)} pointerEvents="none">{num(value)}</text>
      : null
  );
  return (
    <>
      <div style={{ width: "100%", height: 270, cursor: "pointer" }}>
        <ResponsiveContainer initialDimension={{ width: 1, height: 1 }}>
          <BarChart data={rows} margin={{ top: 22, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#f1ede2" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#8a8478" }} axisLine={false} tickLine={false} minTickGap={4} />
            <YAxis tick={{ fontSize: 11, fill: "#8a8478" }} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
            <Tooltip cursor={{ fill: "rgba(184,146,46,.07)" }} />
            {used.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.name} stackId="a" fill={s.color} maxBarSize={38} isAnimationActive={false} onClick={(d) => onPick(d?.payload || d)}>
                <LabelList dataKey={s.key} content={segLabel(s.color)} />
                {i === used.length - 1 && <LabelList dataKey="total" content={barValueLabel(num)} />}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="pmp-legend">{used.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.name}</span>)}</div>
    </>
  );
}
