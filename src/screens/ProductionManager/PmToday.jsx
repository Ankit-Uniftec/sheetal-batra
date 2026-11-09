import React, { useMemo } from "react";
import { fmtDate as formatDate } from "./pmModel";
import { Columns, Empty, Icon, PageHead, RankBars, num } from "../CeoDashboard/CeoUi";
import { Card, Dots, Loading, orderColumns, Table, Tile } from "./PmCommon";
import { ActionsCard, BriefingCard, useInsights } from "./PmBriefing";
import {
  FLOOR_STEPS, atVendor, atWh2, channelOf, dayKey, daysLeft, floorKey, hasPromise, isDormant, isLate, isOwnTrip, isRunning, isStuck, isUrgent, pct, pieceState,
  plural, todayStart,
} from "./pmModel";

// ============================================================
// Today: what needs the Production Manager now, where every piece is, and how
// today compares with the last week. Every number opens the list behind it.
// ============================================================

const FINISH = new Set(["production_complete", "packaging_dispatch", "dispatched"]);
const TAG = { crit: "Act now", warn: "Follow up", gold: "Today" };

/** Running orders and their live pieces, split the ways every page needs. */
export function useFloor(ctx) {
  const { orders, componentsByOrder } = ctx;
  return useMemo(() => {
    const today = todayStart();
    const running = orders.filter(isRunning);
    const pieces = running.flatMap((o) => (componentsByOrder[o.id] || []).filter((c) => !c.cancelled_at));
    const by = (s) => pieces.filter((c) => pieceState(c) === s);
    // In our warehouses: Delhi (1) and our own Delhi (2). Outside vendors apart.
    const wh2 = by("at_wh2");
    const inHouse = [...by("in_house"), ...wh2];
    const atVendor = by("at_vendor");
    const late = running.filter((o) => isLate(o, today));
    // Active: something on the order was scanned in the last 30 days.
    const now = Date.now();
    const dormant = running.filter((o) => isDormant(o, componentsByOrder[o.id] || [], now));
    const dormantIds = new Set(dormant.map((o) => o.id));
    const active = running.filter((o) => !dormantIds.has(o.id));
    const stuck = inHouse.filter((c) => isStuck(c, now));
    return {
      today, running, pieces, inHouse, wh2, atVendor, late, dormant, active, dormantIds,
      activePieces: pieces.filter((c) => !dormantIds.has(c.order_id)),
      notStarted: by("not_started"), finished: by("finished"), disposed: by("disposed"),
      stuck, stuckActive: stuck.filter((c) => !dormantIds.has(c.order_id)),
      lateActive: late.filter((o) => !dormantIds.has(o.id)),
    };
  }, [orders, componentsByOrder]);
}

/** One row per stage: pieces in the warehouse and at vendors, as a stacked bar with the numbers on it. */
export function FloorBars({ ctx, pieces, stuckOnly = false }) {
  const rows = useMemo(() => FLOOR_STEPS.map((g) => {
    const here = pieces.filter((c) => floorKey(c) === g.key);
    const inside = here.filter((c) => !c.is_outside_wh);
    const second = here.filter(atWh2);
    const outside = here.filter(atVendor);
    return { g, here, inside, second, outside, stuck: [...inside, ...second].filter((c) => isStuck(c)) };
  }).filter((r) => r.here.length), [pieces]);
  if (!rows.length) return <Empty text="No pieces on the floor." />;
  const max = Math.max(...rows.map((r) => r.here.length), 1);
  return (
    <div className="pm-floor">
      <div className="pm-floor-legend"><span><i className="is-in" />SB WH Delhi (1)</span><span><i className="is-wh2" />SB WH Delhi (2)</span><span><i className="is-out" />Outside vendors</span>{!stuckOnly && <span><i className="is-stuck" />Not moved for 7+ days</span>}</div>
      {rows.map(({ g, here, inside, second, outside, stuck }) => (
        <div key={g.key} className="pm-floor-row">
          <button type="button" className="pm-floor-name" onClick={() => ctx.openPieces({ title: g.label, sub: "Pieces of running orders at this stage", pieces: here })}>
            <b>{g.label}</b><small>{num(here.length)}</small>
          </button>
          <span className="pm-floor-track">
            {inside.length > 0 && (
              <button type="button" className="pm-floor-seg is-in" style={{ width: `${(inside.length / max) * 100}%` }} title={`${num(inside.length)} at SB WH Delhi (1)`}
                onClick={() => ctx.openPieces({ title: `${g.label}: SB WH Delhi (1)`, sub: "Being worked on in the main warehouse", pieces: inside })}>
                <span>{num(inside.length)}</span>
              </button>
            )}
            {second.length > 0 && (
              <button type="button" className="pm-floor-seg is-wh2" style={{ width: `${(second.length / max) * 100}%` }} title={`${num(second.length)} at SB WH Delhi (2)`}
                onClick={() => ctx.openPieces({ title: `${g.label}: SB WH Delhi (2)`, sub: "At our second warehouse", pieces: second })}>
                <span>{num(second.length)}</span>
              </button>
            )}
            {outside.length > 0 && (
              <button type="button" className="pm-floor-seg is-out" style={{ width: `${(outside.length / max) * 100}%` }} title={`${num(outside.length)} at outside vendors`}
                onClick={() => ctx.openPieces({ title: `${g.label}: At Outside Vendors`, sub: "Out with an outside vendor", pieces: outside })}>
                <span>{num(outside.length)}</span>
              </button>
            )}
          </span>
          {!stuckOnly && (
            <button type="button" className={`pm-floor-stuck${stuck.length ? "" : " is-zero"}`} disabled={!stuck.length}
              onClick={() => ctx.openPieces({ title: `${g.label}: Not Moved for 7+ Days`, sub: "In our warehouses, no scan for a week or more", pieces: stuck })}>
              {num(stuck.length)}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export default function TodayPage({ ctx }) {
  const { lazy, openOrders, openPieces, go, piecesById, openRequests } = ctx;
  const floor = useFloor(ctx);
  const ins = useInsights(ctx, floor);
  const scans = lazy.scans8?.rows;
  const moves = lazy.movements?.rows;
  const waiting = lazy.waiting?.rows;
  const qc = lazy.qc8?.rows;

  // Scans, finished pieces and QC fails per day for the last 8 days.
  const days = useMemo(() => {
    if (!scans || !qc) return null;
    const out = [];
    for (let i = 7; i >= 0; i--) {
      const d = todayStart(); d.setDate(d.getDate() - i);
      out.push({ key: dayKey(d), name: i === 0 ? "Today" : d.toLocaleDateString("en-GB", { weekday: "short" }), date: d, scans: 0, onTime: 0, timed: 0, finished: new Set(), fails: new Set() });
    }
    const byKey = Object.fromEntries(out.map((d) => [d.key, d]));
    scans.forEach((t) => {
      const d = byKey[dayKey(new Date(t.scanned_at))];
      if (!d) return;
      d.scans += 1;
      if (t.is_on_time != null) { d.timed += 1; if (t.is_on_time) d.onTime += 1; }
      if (FINISH.has(t.to_stage) && !FINISH.has(t.from_stage)) d.finished.add(t.component_id);
    });
    qc.forEach((r) => {
      if (r.result !== "fail" || r.is_override) return;
      const d = byKey[dayKey(new Date(r.created_at))];
      if (d) d.fails.add(r.component_id);
    });
    return out.map((d) => ({ ...d, finishedN: d.finished.size, failsN: d.fails.size }));
  }, [scans, qc]);
  const todayRow = days?.[days.length - 1];
  const prior = days ? days.slice(0, -1) : [];
  const avgOf = (k) => (prior.length ? prior.reduce((s, d) => s + d[k], 0) / prior.length : 0);

  const attention = useMemo(() => {
    const { running, late, stuckActive, notStarted, today, dormant, dormantIds } = floor;
    const dueSoon = running.filter((o) => hasPromise(o) && [0, 1].includes(daysLeft(o, today)));
    const longStuck = stuckActive;
    const overdueTrips = (moves || []).filter((m) => m.overdue && m.component_id && !isOwnTrip(m));
    const overduePieces = [...new Set(overdueTrips.map((m) => m.component_id))].map((id) => piecesById[id]).filter(Boolean);
    const wh2Trips = (moves || []).filter((m) => m.overdue && m.component_id && isOwnTrip(m));
    const wh2Late = [...new Set(wh2Trips.map((m) => m.component_id))].map((id) => piecesById[id]).filter(Boolean);
    const notStartedSoon = running.filter((o) => {
      const left = daysLeft(o, today);
      const live = (ctx.componentsByOrder[o.id] || []).filter((c) => !c.cancelled_at);
      return hasPromise(o) && left != null && left >= 0 && left <= 5 && live.length && live.every((c) => pieceState(c) === "not_started");
    });
    const readyToClose = running.filter((o) => {
      const live = (ctx.componentsByOrder[o.id] || []).filter((c) => !c.cancelled_at && pieceState(c) !== "disposed");
      return live.length && live.every((c) => ["final_qc_passed", "production_complete", "packaging_dispatch", "dispatched"].includes(c.current_stage))
        && live.some((c) => c.current_stage === "final_qc_passed");
    });
    const failsToday = todayRow ? [...todayRow.fails].map((id) => piecesById[id]).filter(Boolean) : [];
    const urgent = running.filter(isUrgent);
    const notStartedActive = notStarted.filter((c) => !dormantIds.has(c.order_id));
    return [
      { key: "late", icon: "alert", tone: "crit", count: late.length, label: "Orders past their due date, still in production", open: () => openOrders({ title: "Late Orders", sub: "Past the due date (T-2), still in production", orders: late }) },
      { key: "due", icon: "bell", tone: "crit", count: dueSoon.length, label: "Orders due today or tomorrow, not finished", open: () => openOrders({ title: "Due Today or Tomorrow", sub: "Still in production", orders: dueSoon }) },
      { key: "vendor", icon: "warehouse", tone: "crit", count: overduePieces.length, label: "Pieces still at outside vendors after their return date", loading: !moves, open: () => openPieces({ title: "Overdue at Vendors", sub: "Past the return date set when they were sent; our own SB WH Delhi (2) is not counted", pieces: overduePieces }) },
      { key: "wh2", icon: "warehouse", tone: "warn", count: wh2Late.length, label: "Pieces at SB WH Delhi (2) past their planned return date", loading: !moves, open: () => openPieces({ title: "Late at SB WH Delhi (2)", sub: "At our second warehouse past the planned return date", pieces: wh2Late }) },
      { key: "stuck", icon: "refresh", tone: "warn", count: longStuck.length, label: "Pieces of active orders not moved for 7+ days", open: () => openPieces({ title: "Stuck: Not Moved for 7+ Days", sub: "Pieces of active orders in our warehouses with no scan for a week or more", pieces: longStuck }) },
      { key: "close", icon: "sale", tone: "warn", count: readyToClose.length, label: "Orders with every piece past Final QC, ready to mark completed", open: () => openOrders({ title: "Ready to Mark Completed", sub: "Every piece has passed Final QC", orders: readyToClose }) },
      { key: "start", icon: "orders", tone: "warn", count: notStartedSoon.length, label: "Orders due within 5 days with no piece started", open: () => openOrders({ title: "Not Started, Due Soon", sub: "Due within 5 days, no piece scanned yet", orders: notStartedSoon }) },
      { key: "fails", icon: "integrity", tone: "warn", count: failsToday.length, label: "Pieces that failed QC today", loading: !scans || !qc, open: () => openPieces({ title: "Failed QC Today", sub: formatDate(new Date()), pieces: failsToday }) },
      { key: "quiet", icon: "doc", tone: "warn", count: dormant.length, label: "Orders with nothing scanned for 30+ days: close them if made, chase them if not", open: () => openOrders({ title: "Gone Quiet", sub: "Running orders with no scan on any piece for 30 days or more", orders: dormant }) },
      { key: "requests", icon: "edit", tone: "gold", count: waiting ? waiting.requests : 0, label: "Stage change requests waiting for you", loading: !waiting, cta: "Decide now", open: () => openRequests() },
      { key: "replace", icon: "transfer", tone: "gold", count: waiting ? waiting.replacements : 0, label: "Replacement requests waiting for you", loading: !waiting, cta: "Decide now", open: () => openRequests() },
      { key: "urgent", icon: "trend", tone: "gold", count: urgent.length, label: "Urgent orders in production", open: () => openOrders({ title: "Urgent Orders", sub: "Marked urgent, still in production", orders: urgent }) },
      { key: "notstarted", icon: "stock", tone: "gold", count: notStartedActive.length, label: "Pieces of active orders waiting to start at Cloth Issue", open: () => openPieces({ title: "Not Started", sub: "Pieces of active orders waiting for Cloth Issue", pieces: notStartedActive }) },
    ];
  }, [floor, moves, waiting, todayRow, scans, qc, piecesById, openOrders, openPieces, openRequests, ctx.componentsByOrder]);
  const shown = attention.filter((a) => a.count > 0 || a.loading);
  const urgentN = shown.filter((a) => a.tone === "crit" && a.count > 0).length;

  // Running promised orders by how near their due date is.
  const pressure = useMemo(() => {
    const B = [
      { name: "Late 8+", test: (d) => d <= -8 }, { name: "Late 1–7", test: (d) => d < 0 && d > -8 }, { name: "Today", test: (d) => d === 0 },
      { name: "1–3 days", test: (d) => d >= 1 && d <= 3 }, { name: "4–7 days", test: (d) => d >= 4 && d <= 7 }, { name: "8–14 days", test: (d) => d >= 8 && d <= 14 },
      { name: "15+ days", test: (d) => d >= 15 },
    ].map((b) => ({ ...b, list: [] }));
    floor.running.filter(hasPromise).forEach((o) => {
      const d = daysLeft(o, floor.today);
      if (d == null) return;
      const b = B.find((x) => x.test(d));
      if (b) b.list.push(o);
    });
    return B.map((b) => ({ name: b.name, value: b.list.length, list: b.list }));
  }, [floor]);

  const lateByChannel = useMemo(() => {
    const m = {};
    floor.late.forEach((o) => { const k = channelOf(o); (m[k] || (m[k] = { name: k, value: 0, list: [] })).list.push(o); m[k].value += 1; });
    return Object.values(m).sort((a, b) => b.value - a.value);
  }, [floor.late]);

  const dueWeek = useMemo(() => floor.running.filter((o) => { const d = daysLeft(o, floor.today); return hasPromise(o) && d != null && d >= 0 && d <= 6; })
    .sort((a, b) => daysLeft(a, floor.today) - daysLeft(b, floor.today)), [floor]);

  const now = new Date();
  const hello = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";
  const first = (ctx.profile?.saleperson || "").split(/\s+/)[0];
  const scansAvg = avgOf("scans");
  const finAvg = avgOf("finishedN");
  const failAvg = avgOf("failsN");
  const onTimeToday = todayRow?.timed ? pct(todayRow.onTime, todayRow.timed) : null;
  const onTimeWeek = prior.reduce((s, d) => s + d.timed, 0) ? pct(prior.reduce((s, d) => s + d.onTime, 0), prior.reduce((s, d) => s + d.timed, 0)) : null;
  const vs = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
  const lastScan = scans?.length ? new Date(scans[scans.length - 1].scanned_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
  const quietDay = todayRow && !todayRow.scans;

  return (
    <div className="ceo-page">
      <PageHead title={`${hello}${first ? `, ${first}` : ""}`} desc={`${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}. Here is the floor today; click any number to see what is behind it.`} />
      <div className="ceo-tiles">
        <Tile icon="orders" label="In Production" value={num(floor.running.length)} note={`${num(floor.active.length)} moving · ${num(floor.dormant.length)} quiet 30+ days`} onClick={() => openOrders({ title: "In Production", sub: "Every running order", orders: floor.running })} />
        <Tile icon="alert" tone={floor.late.length ? "warn" : undefined} label="Late Orders" value={num(floor.late.length)} note={`${num(floor.lateActive.length)} still moving · ${pct(floor.late.length, floor.running.filter(hasPromise).length)}% of dated orders`} onClick={() => openOrders({ title: "Late Orders", sub: "Past the due date (T-2), still in production", orders: floor.late })} />
        <Tile icon="bell" label="Due This Week" value={num(dueWeek.length)} note="Next 7 days" onClick={() => openOrders({ title: "Due This Week", sub: "Due in the next 7 days, still in production", orders: dueWeek })} />
        <Tile icon="movements" label="Pieces on the Floor" value={num(floor.inHouse.length)} note={`${num(floor.wh2.length)} at Delhi (2) · ${num(floor.atVendor.length)} at vendors`} onClick={() => openPieces({ title: "Pieces on the Floor", sub: "Being worked on in the warehouse", pieces: floor.inHouse })} />
        <Tile icon="trend" label="Scans Today" value={todayRow ? num(todayRow.scans) : <Dots />} delta={todayRow?.scans ? vs(todayRow.scans, scansAvg) : null} note={todayRow && !todayRow.scans ? (lastScan ? `None yet · last ${lastScan}` : "None yet today") : "vs 7-day average"} onClick={() => go("people")} />
      </div>

      <div className="ceo-grid">
        <BriefingCard ctx={ctx} ins={ins} />
        <Card span={12} title="Needs Your Attention" sub={shown.length ? `${num(shown.filter((a) => a.count).length)} things to look at${urgentN ? `, ${num(urgentN)} to act on now` : ""}. Click one to see the list.` : undefined}>
          {!shown.length ? <Empty text="Nothing needs your attention right now." /> : (
            <div className="pm-actions">
              {shown.map((a) => (
                <button key={a.key} type="button" className="pm-action" onClick={a.open} disabled={a.loading}>
                  <span className="pm-action-top">
                    <span className={`pm-action-ico is-${a.tone}`}><Icon name={a.icon} /></span>
                    <span className="pm-action-when">{TAG[a.tone]}</span>
                  </span>
                  <b className="pm-action-num">{a.loading ? <Dots /> : num(a.count)}</b>
                  <span className="pm-action-text">{a.label}</span>
                  <span className="pm-action-go">{a.cta || "See the list"}<Icon name="chevron" /></span>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card span={7} md={12} title="The Floor Right Now" sub={`${num(floor.inHouse.length - floor.wh2.length)} at Delhi (1) · ${num(floor.wh2.length)} at Delhi (2) · ${num(floor.atVendor.length)} at outside vendors · ${num(floor.stuck.length)} not moved for 7+ days`}>
          <FloorBars ctx={ctx} pieces={[...floor.inHouse, ...floor.atVendor]} />
        </Card>

        <Card span={5} md={12} title="Today vs Last 7 Days" sub={quietDay ? `No scans yet today${lastScan ? `; the last scan was ${lastScan}` : ""}. The bars fill in as the floor scans.` : "Today so far against the daily average of the 7 days before"}>
          {!days ? <Loading text="Loading the week's scans" /> : (
            <div className="pm-compare">
              {[
                { label: "Scans", today: todayRow.scans, avg: scansAvg, fmt: num },
                { label: "Pieces finished", today: todayRow.finishedN, avg: finAvg, fmt: num },
                { label: "QC failures", today: todayRow.failsN, avg: failAvg, fmt: num, inverse: true },
                { label: "On-time scans", today: onTimeToday ?? 0, avg: onTimeWeek ?? 0, fmt: (v) => `${Math.round(v)}%`, max: 100 },
              ].map((r) => {
                const max = r.max || Math.max(r.today, r.avg, 1);
                const better = r.inverse ? r.today <= r.avg : r.today >= r.avg;
                const flag = quietDay ? "Not started" : better ? "On track" : "Behind";
                return (
                  <div key={r.label} className="pm-compare-row">
                    <span className="pm-compare-label">{r.label}</span>
                    <span className="pm-compare-bars">
                      <span className="pm-compare-bar is-today"><i style={{ width: `${(r.today / max) * 100}%` }} /><b>{r.fmt(r.today)}</b></span>
                      <span className="pm-compare-bar"><i style={{ width: `${(r.avg / max) * 100}%` }} /><b>{r.fmt(Math.round(r.avg))}</b></span>
                    </span>
                    <span className={`pm-compare-flag ${quietDay ? "is-quiet" : better ? "is-good" : "is-bad"}`}>{flag}</span>
                  </div>
                );
              })}
              <div className="pm-compare-key"><span><i className="is-today" />Today</span><span><i />7-day average</span></div>
            </div>
          )}
        </Card>

        <ActionsCard ctx={ctx} ins={ins} />

        <Card span={6} md={12} title="Daily Throughput" sub="Pieces finished each day, last 8 days. Click a day to see the pieces.">
          {!days ? <Loading /> : (
            <Columns data={days.map((d) => ({ name: d.name, value: d.finishedN, ids: [...d.finished] }))} money={false} name="Pieces finished" height={250}
              highlight={(d) => d.name === "Today"}
              onPick={(d) => openPieces({ title: `Finished: ${d.name}`, sub: "Pieces that reached Completed, Packaging or Dispatched", pieces: (d.ids || []).map((id) => piecesById[id]).filter(Boolean) })} />
          )}
        </Card>

        <Card span={6} md={12} title="Due Date Pressure" sub={`Client orders by days to their due date; ${num(floor.late.length - floor.lateActive.length)} of the ${num(floor.late.length)} late ones have had nothing scanned for 30+ days. Click a bar to see the orders.`}>
          <Columns data={pressure} money={false} name="Orders" height={250} highlight={(d) => d.name.startsWith("Late") || d.name === "Today"}
            onPick={(d) => { const b = pressure.find((x) => x.name === d.name); if (b) openOrders({ title: `Due: ${b.name}`, sub: "Running orders, by their due date (T-2)", orders: b.list }); }} />
        </Card>

        <Card span={5} md={12} title="Late by Channel" sub="Click a channel to see its late orders">
          <RankBars rows={lateByChannel} format={(v) => plural(v, "order")} sub={(r) => `${pct(r.value, floor.late.length)}% of late orders`}
            onRow={(r) => openOrders({ title: `Late: ${r.name}`, sub: "Past the due date, still in production", orders: r.list })} />
        </Card>

        <Card span={7} md={12} title="Due Next 7 Days" sub="Soonest first. Click an order to open it.">
          <Table rowKey={(r) => r.id} rows={dueWeek.slice(0, 8)} onRow={ctx.openOrder} empty="Nothing due in the next 7 days." columns={orderColumns(ctx)} />
          {dueWeek.length > 8 && <button type="button" className="ceo-link pm-more" onClick={() => openOrders({ title: "Due This Week", sub: "Due in the next 7 days, still in production", orders: dueWeek })}>See all {num(dueWeek.length)}<Icon name="chevron" /></button>}
        </Card>
      </div>
      <p className="pm-foot-note">Due dates are the warehouse date, two days before the client's delivery date. Website and stock orders are not counted as late. {ctx.syncedAt ? `Data from ${ctx.syncedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}; use Refresh in the menu for the latest.` : ""}</p>
    </div>
  );
}
