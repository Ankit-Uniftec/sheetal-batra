import React, { useEffect, useMemo, useState } from "react";
import { STAGE_GROUPS, getStageGroupKey, getStageLabel } from "../../utils/barcodeService";
import { Chips, Columns, Empty, FilterButton, FilterGroup, Insight, PageHead, RankBars, num } from "../CeoDashboard/CeoUi";
import { CsvButton, FilterDrawer, defineKit } from "../CeoDashboard/dashKit";
import { FloorBars, useFloor } from "./PmToday";
import { Dots, Loading, Table, csvFromObjects, orderStatus } from "./PmCommon";
import {
  DAY, FLOOR_STEPS, channelOf, clientOf, dayKey, daysLeft, dueDay, fmtDate, floorKey, hasPromise, idleDays, isLate, isRemovedPiece, isRunning,
  isUrgent, median, pct, pieceState, plural, productsOf, todayStart,
} from "./pmModel";
import "./PmFlow2.css";

// ============================================================
// Floor & Flow: where the pieces are, where they get held up, how fast they
// move and how much comes off the line each day. Worked out from the live
// pieces and the last 30 days of scans.
// ============================================================

const { Tile, Card } = defineKit({
  tiles: {
    "Pieces on the Floor": "Pieces of running orders being worked on in the warehouse right now.",
    "At Vendors": "Pieces of running orders out with an outside vendor right now. Our own SB WH Delhi (2) is not a vendor; its pieces count as on the floor.",
    "Stuck Pieces": "Pieces of active orders (something scanned in the last 30 days) in our warehouses that have not moved for 7 days or more. Quiet orders are left out so this shows live work.",
    "Not Started": "Pieces of active orders not yet scanned at Cloth Issue.",
    "Finished in 30 Days": "Pieces that reached Completed, Packaging or Dispatched in the last 30 days (each piece counted once).",
    "Average Lead Time": "For orders whose last piece was finished in the last 30 days: average days from the order being placed to that last piece being finished.",
  },
  cards: {
    "The Floor Right Now": "Where every piece of a running order is at this moment, by stage, split into in the warehouse and out at vendors. Click a stage or a bar to see its pieces.",
    "Stuck by Stage": "Pieces of active orders not moved for 7 days or more, by stage and by how long they have waited. Click a segment to see the pieces.",
    Bottlenecks: "Average days a piece spent in each stage over the last 30 days, from the scan that brought it into the stage to the scan that moved it on. Only stays that started and ended in the 30 days are counted. The median is shown underneath.",
    "Daily Throughput": "Pieces finished (reached Completed, Packaging or Dispatched) each day over the last 30 days. Click a day to see the pieces.",
    "Where Pieces Went Next": "The most common moves from one stage to the next over the last 30 days, counted per piece move. Click a row to see the pieces.",
    "Ageing of Running Orders": "Running orders by how many days ago they were placed. Click a bar to see the orders.",
    "Re-work by Stage": "Pieces of running orders that have been sent back at least once, by the stage they are at now. Click a stage to see the pieces.",
    "How Long Since Pieces Last Moved": "Pieces in the warehouse by days since their last scan. Pieces that have not moved for 30 days or more usually belong to orders that were made but never closed, or were forgotten. Click a bar to see the pieces.",
    "Late Orders by Stage": "Running orders by the stage the order is at (its warehouse stage; Order Received when nothing has been scanned). Past Due counts orders whose due date (two days before the client's delivery date) has passed; website and stock orders are never counted late. Average Days at Stage runs from when the order reached its stage (from the order date when it has never been scanned). Act now: at least one order here is past due. Watch: nothing past due yet, but 3 or more orders are at this stage. OK: neither. Click a count to see the orders.",
    "The Floor by Channel": "Pieces of running orders at each stage right now (in our warehouses and at vendors, the same pieces as The Floor Right Now), split by the channel of their order. The darker the cell, the more pieces. Click a number to see the pieces.",
  },
});

const FINISH = new Set(["production_complete", "packaging_dispatch", "dispatched"]);
const GROUP_LABEL = Object.fromEntries(STAGE_GROUPS.map((g) => [g.key, g.label]));
const fmtDays = (v) => (v >= 10 ? `${Math.round(v)} days` : `${v.toFixed(1)} days`);
const groupOf = (stage) => (stage === "order_received" ? "order_received" : getStageGroupKey(stage));

const SEVERITY = { act: "Act now", watch: "Watch", ok: "OK" };
const SEV_RANK = { act: 0, watch: 1, ok: 2 };

/** A count that opens its list; a plain 0 when there is nothing to open. */
const CountLink = ({ n, late, onClick }) => (n
  ? <button type="button" className={`pmf2-link${late ? " is-late" : ""}`} onClick={(e) => { e.stopPropagation(); onClick(); }}>{num(n)}</button>
  : <span className="pm-muted">0</span>);

/** Days since the order reached its current stage (from the order date when never scanned). */
const orderDaysAtStage = (o, now = Date.now()) => {
  const t = new Date(o.warehouse_stage_updated_at || o.created_at).getTime();
  return Number.isFinite(t) ? Math.max(0, (now - t) / DAY) : null;
};
const orderStageKey = (o) => groupOf(o.warehouse_stage || "order_received");

/** Running orders per stage: how many, how many past due, how long they have sat there. */
function LateByStage({ ctx, running }) {
  const rows = useMemo(() => {
    const today = todayStart();
    const now = Date.now();
    const m = {};
    STAGE_GROUPS.forEach((g) => { m[g.key] = { key: g.key, name: g.label, list: [], late: [], dwell: 0, n: 0 }; });
    running.forEach((o) => {
      const r = m[orderStageKey(o)];
      if (!r) return; // disposed or an unknown stage: not a step in the flow
      r.list.push(o);
      if (isLate(o, today)) r.late.push(o);
      const d = orderDaysAtStage(o, now);
      if (d != null) { r.dwell += d; r.n += 1; }
    });
    return Object.values(m).filter((r) => r.list.length).map((r) => ({
      ...r,
      share: pct(r.late.length, r.list.length),
      avg: r.n ? r.dwell / r.n : null,
      sev: r.late.length ? "act" : r.list.length >= 3 ? "watch" : "ok",
    })).sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev] || b.late.length - a.late.length || b.list.length - a.list.length);
  }, [running]);
  return (
    <Table rowKey={(r) => r.key} rows={rows} empty="No running orders." columns={[
      { key: "stage", label: "Stage", render: (r) => <b>{r.name}</b> },
      { key: "orders", label: "Orders", right: true, render: (r) => <CountLink n={r.list.length} onClick={() => ctx.openOrders({ title: `At ${r.name}`, sub: "Running orders at this stage", orders: r.list })} /> },
      { key: "late", label: "Past Due", right: true, render: (r) => <CountLink n={r.late.length} late onClick={() => ctx.openOrders({ title: `Past Due at ${r.name}`, sub: "Running orders at this stage past their due date", orders: r.late })} /> },
      { key: "share", label: "% Past Due", right: true, render: (r) => `${r.share}%` },
      { key: "avg", label: "Average Days at Stage", right: true, render: (r) => (r.avg == null ? "–" : fmtDays(r.avg)) },
      { key: "sev", label: "Severity", flow: "one", render: (r) => <i className={`pmf2-sev is-${r.sev}`}>{SEVERITY[r.sev]}</i> },
    ]} />
  );
}

/** Pieces at each stage split by the channel of their order, as a shaded table. */
function ChannelStages({ ctx, pieces }) {
  const { rows, chans, max } = useMemo(() => {
    const totals = {};
    const list = FLOOR_STEPS.map((g) => {
      const here = pieces.filter((c) => floorKey(c) === g.key);
      const by = {};
      here.forEach((c) => {
        const o = ctx.ordersById[c.order_id];
        const k = o ? channelOf(o) : "Not known";
        (by[k] || (by[k] = [])).push(c);
        totals[k] = (totals[k] || 0) + 1;
      });
      return { key: g.key, name: g.label, here, by };
    }).filter((r) => r.here.length);
    const names = Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const all = { key: "all", name: "All stages", here: list.flatMap((r) => r.here), by: {}, total: true };
    names.forEach((k) => { all.by[k] = list.flatMap((r) => r.by[k] || []); });
    const top = Math.max(1, ...list.flatMap((r) => names.map((k) => (r.by[k] || []).length)));
    return { rows: list.length ? [...list, all] : [], chans: names, max: top };
  }, [pieces, ctx.ordersById]);
  if (!rows.length) return <Empty text="No pieces on the floor." />;
  const level = (n) => (n / max > 0.75 ? 4 : n / max > 0.5 ? 3 : n / max > 0.25 ? 2 : 1);
  const cell = (r, list, label, isTotal) => (list.length
    ? (
      <button type="button" className={`pmf2-heat${isTotal || r.total ? " is-total" : ` is-${level(list.length)}`}`}
        onClick={() => ctx.openPieces({ title: r.total ? label : `${r.name}: ${label}`, sub: "Pieces of running orders on the floor", pieces: list })}>
        {num(list.length)}
      </button>
    )
    : <span className="pm-muted">–</span>);
  return (
    <Table rowKey={(r) => r.key} rows={rows} columns={[
      { key: "stage", label: "Stage", render: (r) => <b>{r.name}</b> },
      ...chans.map((k) => ({ key: `c-${k}`, label: k, right: true, render: (r) => cell(r, r.by[k] || [], k, false) })),
      { key: "total", label: "Total", right: true, render: (r) => cell(r, r.here, r.total ? "All Pieces on the Floor" : "All channels", true) },
    ]} />
  );
}

/** Pieces in the warehouse past their stage limit, by stage and days over. */
function StuckBars({ ctx, stuck }) {
  const rows = useMemo(() => FLOOR_STEPS.map((g) => {
    const here = stuck.filter((c) => floorKey(c) === g.key);
    return {
      g, here,
      segs: [
        { key: "a", label: "7–14 days", list: here.filter((c) => idleDays(c) <= 14) },
        { key: "b", label: "15–30 days", list: here.filter((c) => idleDays(c) >= 15 && idleDays(c) <= 30) },
        { key: "c", label: "31+ days", list: here.filter((c) => idleDays(c) >= 31) },
      ],
    };
  }).filter((r) => r.here.length), [stuck]);
  if (!rows.length) return <Empty text="No piece of an active order has waited a week." />;
  const max = Math.max(...rows.map((r) => r.here.length), 1);
  return (
    <div className="pmf-stuck">
      <div className="pmf-legend"><span><i className="is-a" />7–14 days</span><span><i className="is-b" />15–30 days</span><span><i className="is-c" />31+ days</span></div>
      {rows.map(({ g, here, segs }) => (
        <div key={g.key} className="pmf-row">
          <button type="button" className="pmf-name" onClick={() => ctx.openPieces({ title: `Stuck: ${g.label}`, sub: "Pieces of active orders not moved for 7+ days", pieces: here })}>
            <b>{g.label}</b><small>{num(here.length)}</small>
          </button>
          <span className="pmf-track">
            <span className="pmf-fill" style={{ width: `${(here.length / max) * 100}%` }}>
            {segs.filter((s) => s.list.length).map((s) => (
              <button key={s.key} type="button" className={`pmf-seg is-${s.key}`} style={{ flexGrow: s.list.length }} title={`${num(s.list.length)} ${s.label}`}
                onClick={() => ctx.openPieces({ title: `${g.label}: ${s.label}`, sub: "Pieces of active orders not moved for 7+ days", pieces: s.list })}>
                <span>{num(s.list.length)}</span>
              </button>
            ))}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

export default function FloorPage({ ctx }) {
  const { need, lazy, openOrders, openPieces, piecesById, componentsByOrder, orders: allOrders } = ctx;
  useEffect(() => { need("scans30"); }, [need]);
  const [drawer, setDrawer] = useState(false);
  const [channels, setChannels] = useState([]);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const channelList = useMemo(() => {
    const m = {};
    allOrders.filter(isRunning).forEach((o) => { const k = channelOf(o); m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k]) => ({ value: k, label: k }));
  }, [allOrders]);
  const filtered = channels.length > 0 || urgentOnly;
  // Every figure on the page follows the filters: the orders, their pieces and their scans.
  const orders = useMemo(() => (filtered ? allOrders.filter((o) => (!channels.length || channels.includes(channelOf(o))) && (!urgentOnly || isUrgent(o))) : allOrders), [allOrders, channels, urgentOnly, filtered]);
  const floor = useFloor({ orders, componentsByOrder });
  const keep = useMemo(() => new Set(orders.map((o) => o.id)), [orders]);
  const allScans = lazy.scans30?.rows;
  const scans = useMemo(() => (allScans && filtered ? allScans.filter((t) => keep.has(t.order_id)) : allScans), [allScans, filtered, keep]);

  // Everything that needs the 30 days of scans, in one pass.
  const flow = useMemo(() => {
    if (!scans) return null;
    const start = todayStart(); start.setDate(start.getDate() - 29);
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = todayStart(); d.setDate(d.getDate() - i);
      days.push({ key: dayKey(d), name: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), set: new Set() });
    }
    const dayBy = Object.fromEntries(days.map((d) => [d.key, d]));
    const finishedAt = {}; // component -> last finish time in the window
    const byComp = {};
    scans.forEach((t) => {
      (byComp[t.component_id] || (byComp[t.component_id] = [])).push(t);
      if (FINISH.has(t.to_stage) && !FINISH.has(t.from_stage)) {
        const d = dayBy[dayKey(new Date(t.scanned_at))];
        if (d) d.set.add(t.component_id);
        const ms = new Date(t.scanned_at).getTime();
        if (!finishedAt[t.component_id] || ms > finishedAt[t.component_id]) finishedAt[t.component_id] = ms;
      }
    });
    // Stage stays and stage-to-stage moves, per piece (scans arrive oldest first).
    const stays = {};
    const moves = {};
    Object.entries(byComp).forEach(([cid, list]) => {
      let cur = null;
      let since = null;
      list.forEach((t) => {
        const g = groupOf(t.to_stage);
        if (!g || g === cur) return; // gate scans and moves inside a stage keep the stay going
        const at = new Date(t.scanned_at).getTime();
        if (cur && since != null) {
          (stays[cur] || (stays[cur] = [])).push((at - since) / DAY);
          const k = `${cur}>${g}`;
          const m = moves[k] || (moves[k] = { key: k, from: cur, to: g, ids: new Set(), value: 0 });
          m.value += 1; m.ids.add(cid);
        } else if (t.from_stage) {
          const fg = groupOf(t.from_stage);
          if (fg && fg !== g) {
            const k = `${fg}>${g}`;
            const m = moves[k] || (moves[k] = { key: k, from: fg, to: g, ids: new Set(), value: 0 });
            m.value += 1; m.ids.add(cid);
          }
        }
        cur = g; since = at;
      });
    });
    const bottlenecks = STAGE_GROUPS.filter((g) => g.key !== "packaging" && stays[g.key]?.length)
      .map((g) => {
        const list = stays[g.key];
        const avgDays = list.reduce((s, v) => s + v, 0) / list.length;
        return { key: g.key, name: g.label, value: Math.round(avgDays * 10) / 10, median: median(list), n: list.length };
      })
      .sort((a, b) => b.value - a.value);
    // Lead time: orders whose live pieces are all finished now, the last one inside the window.
    const lead = [];
    const leadOrders = [];
    orders.forEach((o) => {
      const live = (componentsByOrder[o.id] || []).filter((c) => !c.cancelled_at && pieceState(c) !== "disposed");
      if (!live.length || !live.every((c) => pieceState(c) === "finished")) return;
      const times = live.map((c) => finishedAt[c.id]).filter(Boolean);
      if (!times.length) return;
      const last = Math.max(...times);
      if (last < start.getTime()) return;
      const placed = new Date(o.created_at).getTime();
      if (!placed || last < placed) return;
      lead.push((last - placed) / DAY);
      leadOrders.push(o);
    });
    const finishedIds = new Set(days.flatMap((d) => [...d.set]));
    return {
      days: days.map((d) => ({ name: d.name, value: d.set.size, ids: [...d.set] })),
      finishedIds: [...finishedIds],
      bottlenecks,
      moves: Object.values(moves).sort((a, b) => b.value - a.value),
      leadAvg: lead.length ? lead.reduce((s, v) => s + v, 0) / lead.length : null,
      leadMedian: lead.length ? median(lead) : null,
      leadOrders,
    };
  }, [scans, orders, componentsByOrder]);

  const ageing = useMemo(() => {
    const B = [
      { name: "0–7 days", min: 0, max: 7 }, { name: "8–14 days", min: 8, max: 14 }, { name: "15–30 days", min: 15, max: 30 },
      { name: "31–60 days", min: 31, max: 60 }, { name: "60+ days", min: 61, max: Infinity },
    ].map((b) => ({ ...b, list: [] }));
    const today = todayStart();
    floor.running.forEach((o) => {
      const placed = new Date(o.created_at); placed.setHours(0, 0, 0, 0);
      const age = Math.round((today - placed) / DAY);
      const b = B.find((x) => age >= x.min && age <= x.max);
      if (b) b.list.push(o);
    });
    return B.map((b) => ({ name: b.name, value: b.list.length, list: b.list }));
  }, [floor.running]);

  const rework = useMemo(() => {
    const m = {};
    floor.pieces.filter((c) => Number(c.re_journey_count) > 0 && !["finished", "removed"].includes(pieceState(c))).forEach((c) => {
      const k = floorKey(c) || "other";
      const r = m[k] || (m[k] = { key: k, name: GROUP_LABEL[k] || "Other", value: 0, list: [] });
      r.value += 1; r.list.push(c);
    });
    return Object.values(m).sort((a, b) => b.value - a.value);
  }, [floor.pieces]);

  const slowest = flow?.bottlenecks?.[0];
  const activeInHouse = floor.inHouse.filter((c) => !floor.dormantIds.has(c.order_id));
  const stuckShare = pct(floor.stuckActive.length, activeInHouse.length);
  const notStartedActive = floor.notStarted.filter((c) => !floor.dormantIds.has(c.order_id));
  // Pieces in the warehouse by days since they last moved.
  const idle = useMemo(() => {
    const now = Date.now();
    const B = [
      { name: "0–2 days", min: 0, max: 2 }, { name: "3–7 days", min: 3, max: 7 }, { name: "8–14 days", min: 8, max: 14 },
      { name: "15–30 days", min: 15, max: 30 }, { name: "31–90 days", min: 31, max: 90 }, { name: "90+ days", min: 91, max: Infinity },
    ].map((b) => ({ ...b, list: [] }));
    floor.inHouse.forEach((c) => { const d = idleDays(c, now); const b = B.find((x) => d >= x.min && d <= x.max); if (b) b.list.push(c); });
    return B.map((b) => ({ name: b.name, value: b.list.length, list: b.list }));
  }, [floor.inHouse]);
  const movedWeek = idle[0].value + idle[1].value;
  const idle30 = idle[4].value + idle[5].value;
  const finishedPieces = flow ? flow.finishedIds.map((id) => piecesById[id]).filter(Boolean) : [];
  const loading = !flow;
  const floorPieces = useMemo(() => [...floor.inHouse, ...floor.atVendor], [floor.inHouse, floor.atVendor]);

  // Work in progress: every running order the filters keep. No money and no contact details.
  const exportWip = () => {
    const now = Date.now();
    csvFromObjects("work in progress", floor.running.map((o) => {
      const comps = componentsByOrder[o.id] || [];
      const due = dueDay(o);
      const left = daysLeft(o);
      const at = orderDaysAtStage(o, now);
      return {
        "Order No": o.order_no || "",
        Client: clientOf(o, ctx.vendorMap),
        Salesperson: o.salesperson || "",
        Store: o.salesperson_store || "",
        Channel: channelOf(o),
        Products: productsOf(o),
        Pieces: comps.filter((c) => !isRemovedPiece(c)).length,
        "Current Stage": (o.warehouse_stage && getStageLabel(o.warehouse_stage)) || o.warehouse_stage || "Order Received",
        "Days at Stage": at == null ? "" : Math.floor(at),
        "Order Date": fmtDate(o.created_at) || "",
        "Due Date": due ? fmtDate(due) : "",
        "Client Delivery Date": o.delivery_date ? fmtDate(o.delivery_date) : "",
        "Days Late": left == null ? "No date" : !hasPromise(o) ? "Not counted" : left < 0 ? -left : 0,
        Priority: isUrgent(o) ? "Urgent" : "Normal",
        Status: orderStatus(o, comps),
      };
    }));
  };

  return (
    <div className="ceo-page">
      <PageHead title="Floor & Flow" desc="Where the pieces are, where they are held up and how fast they move. Based on the live floor and the last 30 days of scans.">
        <CsvButton label="Export work in progress" onClick={exportWip} disabled={!floor.running.length} />
        <FilterButton count={(channels.length ? 1 : 0) + (urgentOnly ? 1 : 0)} onClick={() => setDrawer(true)} />
      </PageHead>
      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} onClear={() => { setChannels([]); setUrgentOnly(false); }}
        count={floor.running.length} noun="running orders" sub="Show the floor for some orders only">
        <FilterGroup label="Priority"><Chips options={[{ value: "urgent", label: "Urgent only" }]} value={urgentOnly ? "urgent" : ""} onChange={(v) => setUrgentOnly(v === "urgent")} /></FilterGroup>
        <FilterGroup label="Channel"><Chips options={channelList} value={channels} onChange={setChannels} /></FilterGroup>
      </FilterDrawer>
      <div className="ceo-tiles">
        <Tile icon="movements" label="Pieces on the Floor" value={num(floor.inHouse.length)} note={`${num(movedWeek)} moved in the last 7 days`} onClick={() => openPieces({ title: "Pieces on the Floor", sub: "Being worked on in the warehouse", pieces: floor.inHouse })} />
        <Tile icon="warehouse" label="At Vendors" value={num(floor.atVendor.length)} note={`${num(floor.wh2.length)} more at our Delhi (2)`} onClick={() => openPieces({ title: "At Outside Vendors", sub: "Out with an outside vendor right now", pieces: floor.atVendor })} />
        <Tile icon="alert" tone={floor.stuckActive.length ? "warn" : undefined} label="Stuck Pieces" value={num(floor.stuckActive.length)} note={`${stuckShare}% of live pieces in our warehouses`} onClick={() => openPieces({ title: "Stuck Pieces", sub: "Pieces of active orders not moved for 7+ days", pieces: floor.stuckActive })} />
        <Tile icon="stock" label="Not Started" value={num(notStartedActive.length)} note={`Active orders · ${num(floor.notStarted.length - notStartedActive.length)} more on quiet ones`} onClick={() => openPieces({ title: "Not Started", sub: "Pieces of active orders waiting for Cloth Issue", pieces: notStartedActive })} />
        <Tile icon="trend" label="Average Lead Time" value={loading ? <Dots /> : flow.leadAvg == null ? "–" : fmtDays(flow.leadAvg)}
          note={loading ? "Loading the scans" : flow.leadMedian == null ? "No finished orders" : `Median ${fmtDays(flow.leadMedian)} · ${plural(flow.leadOrders.length, "order")}`}
          onClick={loading || !flow.leadOrders.length ? undefined : () => openOrders({ title: "Finished in the Last 30 Days", sub: "Orders whose last piece was finished in the last 30 days", orders: flow.leadOrders })} />
      </div>

      <div className="pmq-insights pmf-says">
        {floor.inHouse.length > 0 && (
          <Insight tone={idle30 > movedWeek ? "warn" : "gold"}>
            Of <b>{num(floor.inHouse.length)}</b> pieces in our two warehouses, <b>{num(movedWeek)}</b> moved in the last 7 days and <b>{num(idle30)}</b> have not moved for more than 30 days. Most of those belong to the <b>{num(floor.dormant.length)}</b> orders that have gone quiet.
          </Insight>
        )}
        {slowest && <Insight>Over the last 30 days pieces spent longest at <b>{slowest.name}</b>: {fmtDays(slowest.value)} on average (median {fmtDays(slowest.median)}).</Insight>}
        {activeInHouse.length > 0 && <Insight tone={stuckShare >= 50 ? "warn" : "gold"}>Even on active orders, <b>{stuckShare}%</b> of the pieces in our warehouses ({num(floor.stuckActive.length)} of {num(activeInHouse.length)}) have not moved for a week or more.</Insight>}
        {flow && flow.leadAvg != null && <Insight>Orders finished in the last 30 days took <b>{fmtDays(flow.leadAvg)}</b> on average from order to last piece finished (median {fmtDays(flow.leadMedian)}).</Insight>}
      </div>

      <div className="ceo-grid">
        <Card span={7} md={12} title="The Floor Right Now" sub={`${num(floor.inHouse.length - floor.wh2.length)} at Delhi (1) · ${num(floor.wh2.length)} at Delhi (2) · ${num(floor.atVendor.length)} at outside vendors`}>
          <FloorBars ctx={ctx} pieces={floorPieces} />
        </Card>
        <Card span={5} md={12} title="Stuck by Stage" sub={`${num(floor.stuckActive.length)} pieces of active orders not moved for 7+ days`}>
          <StuckBars ctx={ctx} stuck={floor.stuckActive} />
        </Card>

        <Card span={12} title="Late Orders by Stage" sub={`${num(floor.running.length)} running orders by the stage they are at · ${num(floor.late.length)} past their due date`}>
          <LateByStage ctx={ctx} running={floor.running} />
        </Card>
        <Card span={12} title="The Floor by Channel" sub="Pieces at each stage by the channel of their order. Click a number to see the pieces.">
          <ChannelStages ctx={ctx} pieces={floorPieces} />
        </Card>

        <Card span={5} md={12} title="Bottlenecks" sub="Average days spent in each stage, last 30 days">
          {loading ? <Loading text="Loading the last 30 days of scans" /> : (
            <RankBars rows={flow.bottlenecks} limit={12} format={(v) => fmtDays(v)}
              sub={(r) => `Median ${fmtDays(r.median)} · ${plural(r.n, "stay")}`}
              onRow={(r) => openPieces({ title: `At ${r.name} Now`, sub: "Pieces of running orders at this stage", pieces: floor.pieces.filter((c) => floorKey(c) === r.key && pieceState(c) !== "finished") })} />
          )}
        </Card>
        <Card span={7} md={12} title="Daily Throughput" sub={loading ? undefined : `${num(finishedPieces.length)} pieces finished in 30 days. Click a day to see them.`}>
          {loading ? <Loading /> : (
            <Columns data={flow.days} money={false} name="Pieces finished" height={260} highlight={(d) => d === flow.days[flow.days.length - 1]}
              onPick={(d) => openPieces({ title: `Finished: ${d.name}`, sub: "Pieces that reached Completed, Packaging or Dispatched", pieces: (d.ids || []).map((id) => piecesById[id]).filter(Boolean) })} />
          )}
        </Card>

        <Card span={6} md={12} title="Where Pieces Went Next" sub="The most common stage-to-stage moves, last 30 days">
          {loading ? <Loading /> : (
            <RankBars rows={flow.moves.map((m) => ({ ...m, name: `${GROUP_LABEL[m.from] || m.from} → ${GROUP_LABEL[m.to] || m.to}` }))} limit={10}
              format={(v) => plural(v, "move")} sub={(r) => plural(r.ids.size, "piece")}
              onRow={(r) => openPieces({ title: r.name, sub: "Pieces that made this move in the last 30 days", pieces: [...r.ids].map((id) => piecesById[id]).filter(Boolean) })} />
          )}
        </Card>
        <Card span={6} md={12} title="Ageing of Running Orders" sub="Days since the order was placed. Click a bar to see the orders.">
          <Columns data={ageing} money={false} name="Orders" height={260} highlight={(d) => d.name === "60+ days" || d.name === "31–60 days"}
            onPick={(d) => { const b = ageing.find((x) => x.name === d.name); if (b) openOrders({ title: `Placed ${b.name} Ago`, sub: "Running orders", orders: b.list }); }} />
        </Card>

        <Card span={6} md={12} title="How Long Since Pieces Last Moved" sub="Pieces in the warehouse by days since their last scan. Click a bar to see them.">
          <Columns data={idle} money={false} name="Pieces" height={260} highlight={(d) => d.name === "31–90 days" || d.name === "90+ days"}
            onPick={(d) => { const b = idle.find((x) => x.name === d.name); if (b) openPieces({ title: `Not Moved for ${b.name}`, sub: "Pieces in the warehouse", pieces: b.list }); }} />
        </Card>
        <Card span={6} md={12} title="Re-work by Stage" sub={`${num(rework.reduce((s, r) => s + r.value, 0))} pieces of running orders have been sent back at least once`}>
          <RankBars rows={rework} limit={12} format={(v) => plural(v, "piece")}
            onRow={(r) => openPieces({ title: `Re-work at ${r.name}`, sub: "Sent back at least once, now at this stage", pieces: r.list })} />
        </Card>
      </div>
    </div>
  );
}
