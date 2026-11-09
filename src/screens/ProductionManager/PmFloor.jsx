import React, { useEffect, useMemo, useState } from "react";
import { STAGE_GROUPS, getStageGroupKey } from "../../utils/barcodeService";
import { Chips, Columns, Empty, FilterButton, FilterGroup, Insight, PageHead, RankBars, num } from "../CeoDashboard/CeoUi";
import { FilterDrawer, defineKit } from "../CeoDashboard/dashKit";
import { FloorBars, useFloor } from "./PmToday";
import {
  DAY, FLOOR_STEPS, channelOf, dayKey, floorKey, idleDays, isRunning, isUrgent, median, pct, pieceState, plural, todayStart,
} from "./pmModel";

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
  },
});

const FINISH = new Set(["production_complete", "packaging_dispatch", "dispatched"]);
const GROUP_LABEL = Object.fromEntries(STAGE_GROUPS.map((g) => [g.key, g.label]));
const fmtDays = (v) => (v >= 10 ? `${Math.round(v)} days` : `${v.toFixed(1)} days`);
const groupOf = (stage) => (stage === "order_received" ? "order_received" : getStageGroupKey(stage));

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
            {segs.filter((s) => s.list.length).map((s) => (
              <button key={s.key} type="button" className={`pmf-seg is-${s.key}`} style={{ width: `${(s.list.length / max) * 100}%` }} title={`${num(s.list.length)} ${s.label}`}
                onClick={() => ctx.openPieces({ title: `${g.label}: ${s.label}`, sub: "Pieces of active orders not moved for 7+ days", pieces: s.list })}>
                <span>{num(s.list.length)}</span>
              </button>
            ))}
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

  return (
    <div className="ceo-page">
      <PageHead title="Floor & Flow" desc="Where the pieces are, where they are held up and how fast they move. Based on the live floor and the last 30 days of scans.">
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
        <Tile icon="trend" label="Average Lead Time" value={loading ? "…" : flow.leadAvg == null ? "–" : fmtDays(flow.leadAvg)}
          note={loading ? "Loading scans" : flow.leadMedian == null ? "No finished orders" : `Median ${fmtDays(flow.leadMedian)} · ${plural(flow.leadOrders.length, "order")}`}
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
          <FloorBars ctx={ctx} pieces={[...floor.inHouse, ...floor.atVendor]} />
        </Card>
        <Card span={5} md={12} title="Stuck by Stage" sub={`${num(floor.stuckActive.length)} pieces of active orders not moved for 7+ days`}>
          <StuckBars ctx={ctx} stuck={floor.stuckActive} />
        </Card>

        <Card span={5} md={12} title="Bottlenecks" sub="Average days spent in each stage, last 30 days">
          {loading ? <Empty text="Loading the last 30 days of scans…" /> : (
            <RankBars rows={flow.bottlenecks} limit={12} format={(v) => fmtDays(v)}
              sub={(r) => `Median ${fmtDays(r.median)} · ${plural(r.n, "stay")}`}
              onRow={(r) => openPieces({ title: `At ${r.name} Now`, sub: "Pieces of running orders at this stage", pieces: floor.pieces.filter((c) => floorKey(c) === r.key && pieceState(c) !== "finished") })} />
          )}
        </Card>
        <Card span={7} md={12} title="Daily Throughput" sub={loading ? undefined : `${num(finishedPieces.length)} pieces finished in 30 days. Click a day to see them.`}>
          {loading ? <Empty text="Loading…" /> : (
            <Columns data={flow.days} money={false} name="Pieces finished" height={260} highlight={(d) => d === flow.days[flow.days.length - 1]}
              onPick={(d) => openPieces({ title: `Finished: ${d.name}`, sub: "Pieces that reached Completed, Packaging or Dispatched", pieces: (d.ids || []).map((id) => piecesById[id]).filter(Boolean) })} />
          )}
        </Card>

        <Card span={6} md={12} title="Where Pieces Went Next" sub="The most common stage-to-stage moves, last 30 days">
          {loading ? <Empty text="Loading…" /> : (
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
