import React, { useMemo } from "react";
import formatDate from "../../utils/formatDate";
import { STAGE_GROUPS } from "../../utils/barcodeService";
import { Icon, num } from "../CeoDashboard/CeoUi";
import { Card } from "./PmCommon";
import {
  DAY, channelOf, dayKey, daysLeft, dueIn, floorKey, idleDays, isLate, isOwnTrip, isStuck, isUrgent, pct, pieceState, plural, readyToDispatch,
  todayStart,
} from "./pmModel";

// ============================================================
// The dashboard reading its own data: a short written briefing for the day
// and plain answers to the questions a production manager is asked most.
// Every sentence is worked out from the live orders, pieces, scans, QC
// checks, vendor trips and requests; each one opens the list behind it.
// ============================================================

const STEP_OF = Object.fromEntries(STAGE_GROUPS.map((g) => [g.key, g.step]));
const LABEL_OF = Object.fromEntries(STAGE_GROUPS.map((g) => [g.key, g.label]));
const STITCHING_STEP = STEP_OF.stitching;
const FINISH = new Set(["production_complete", "packaging_dispatch", "dispatched"]);
const dayName = (d) => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
const Bold = ({ children }) => <b>{children}</b>;

/**
 * Everything the briefing and the questions need, worked out once.
 * `floor` is useFloor(ctx); scans/qc/moves/waiting may still be loading (null).
 */
export function useInsights(ctx, floor) {
  const { orders, componentsByOrder, piecesById, lazy } = ctx;
  const scans = lazy.scans8?.rows || null;
  const qc = lazy.qc8?.rows || null;
  const moves = lazy.movements?.rows || null;
  const waiting = lazy.waiting?.rows || null;

  return useMemo(() => {
    const now = Date.now();
    const today = todayStart();
    const { running, dormant, active, activePieces, inHouse, atVendor, notStarted } = floor;
    const live = (o) => (componentsByOrder[o.id] || []).filter((c) => !c.cancelled_at && pieceState(c) !== "removed");

    // ---- this week's deliveries: made, moving or at risk
    const week = running.filter((o) => dueIn(o, 0, 6, today));
    const overdueAway = new Set(moves ? moves.filter((m) => m.overdue && m.component_id && !isOwnTrip(m)).map((m) => m.component_id) : []);
    const made = []; const risk = []; const moving = [];
    week.forEach((o) => {
      const ps = live(o);
      if (ps.length && ps.every((c) => pieceState(c) === "finished")) { made.push(o); return; }
      const left = daysLeft(o, today);
      const early = ps.some((c) => {
        const st = pieceState(c);
        if (st === "not_started" || st === "disposed") return true;
        const k = floorKey(c);
        return st !== "finished" && left <= 3 && (STEP_OF[k] ?? 0) < STITCHING_STEP;
      });
      const late = ps.some((c) => overdueAway.has(c.id));
      (early || late || !ps.length ? risk : moving).push(o);
    });

    // ---- the last working day (the latest day before today with scans)
    let lastDay = null; let todayRow = null; const days = [];
    if (scans) {
      const by = {};
      scans.forEach((t) => {
        const d = new Date(t.scanned_at); const k = dayKey(d);
        const r = by[k] || (by[k] = { key: k, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), scans: 0, finished: new Set(), people: {}, gate: {}, stations: new Set() });
        r.scans += 1;
        if (FINISH.has(t.to_stage) && !FINISH.has(t.from_stage)) r.finished.add(t.component_id);
        const who = String(t.scanned_by || "").trim() || "Not recorded";
        r.people[who] = (r.people[who] || 0) + 1;
        // Security gate scans are not production work: noted so the top maker can be named.
        if (/security|gate/i.test(t.station_name || "")) r.gate[who] = (r.gate[who] || 0) + 1;
        if (t.station_name) r.stations.add(t.station_name);
      });
      Object.values(by).sort((a, b) => a.date - b.date).forEach((r) => days.push(r));
      todayRow = by[dayKey(today)] || null;
      lastDay = [...days].reverse().find((r) => r.key !== dayKey(today) && r.scans > 0) || null;
    }
    const prior = days.filter((r) => r.key !== dayKey(today) && r !== lastDay);
    const avgFinished = prior.length ? prior.reduce((s, r) => s + r.finished.size, 0) / prior.length : null;
    const avgScans = prior.length ? prior.reduce((s, r) => s + r.scans, 0) / prior.length : null;

    // ---- where live work is piling up (active orders only)
    const activeIds = new Set(active.map((o) => o.id));
    const liveInHouse = inHouse.filter((c) => activeIds.has(c.order_id));
    const pile = {};
    liveInHouse.forEach((c) => {
      const k = floorKey(c); if (!k) return;
      const r = pile[k] || (pile[k] = { key: k, name: LABEL_OF[k], all: [], over: [], idle: [] });
      r.all.push(c); if (isStuck(c, now)) r.over.push(c); r.idle.push(idleDays(c, now));
    });
    const piles = Object.values(pile).map((r) => ({ ...r, avgIdle: r.idle.reduce((s, v) => s + v, 0) / r.idle.length }));
    const worstPile = [...piles].sort((a, b) => b.over.length - a.over.length)[0] || null;
    const slowest = piles.map((r) => ({ ...r, week: r.all.filter((c) => idleDays(c, now) >= 7) }))
      .sort((a, b) => b.week.length - a.week.length)[0] || null;

    // ---- vendors
    let vendorTop = null; let vendorOverdue = []; let vendorReturns = null;
    if (moves) {
      const overdue = moves.filter((m) => m.overdue && m.component_id && !isOwnTrip(m));
      vendorOverdue = [...new Set(overdue.map((m) => m.component_id))].map((id) => piecesById[id]).filter(Boolean);
      const byV = {};
      overdue.forEach((m) => {
        const v = (m.vendor_name || "Unknown vendor").trim();
        const r = byV[v] || (byV[v] = { name: v, ids: new Set(), oldest: 0 });
        r.ids.add(m.component_id); r.oldest = Math.max(r.oldest, m.daysOverdue || 0);
      });
      vendorTop = Object.values(byV).sort((a, b) => b.ids.size - a.ids.size)[0] || null;
      const since = new Date(today); since.setDate(since.getDate() - 29);
      const back = moves.filter((m) => !isOwnTrip(m) && m.status === "returned" && m.entry_scan_at && new Date(m.entry_scan_at) >= since && m.return_date);
      const onTime = back.filter((m) => new Date(m.entry_scan_at).setHours(0, 0, 0, 0) <= new Date(m.return_date).setHours(0, 0, 0, 0));
      vendorReturns = { back: back.length, onTime: onTime.length };
    }

    // ---- quality, last 7 days
    let quality = null;
    if (qc) {
      const since = new Date(today); since.setDate(since.getDate() - 6);
      const rows = qc.filter((r) => !r.is_override && new Date(r.created_at) >= since);
      const fails = rows.filter((r) => r.result === "fail");
      quality = { checks: rows.length, fails, rate: rows.length ? ((rows.length - fails.length) / rows.length) * 100 : null };
    }

    // ---- other answers
    const ready = readyToDispatch(orders, componentsByOrder, now);
    const readyLong = ready.filter((r) => r.waitDays >= 2);
    const weekStart = new Date(today); weekStart.setDate(weekStart.getDate() - 6);
    const newToday = orders.filter((o) => new Date(o.created_at) >= today && String(o.status || "").toLowerCase() !== "cancelled");
    const newWeek = orders.filter((o) => new Date(o.created_at) >= weekStart && String(o.status || "").toLowerCase() !== "cancelled");
    const newWeekStarted = newWeek.filter((o) => live(o).some((c) => pieceState(c) !== "not_started"));
    const lateActive = active.filter((o) => isLate(o, today));
    const urgentStill = active.filter((o) => isUrgent(o) && live(o).some((c) => pieceState(c) !== "finished") && Math.min(...live(o).map((c) => idleDays(c, now))) >= 3);
    const lateByChannel = {};
    lateActive.forEach((o) => { const k = channelOf(o); (lateByChannel[k] || (lateByChannel[k] = [])).push(o); });
    const worstChannel = Object.entries(lateByChannel).sort((a, b) => b[1].length - a[1].length)[0] || null;
    const notStartedActive = notStarted.filter((c) => activeIds.has(c.order_id));
    const oldestWaiting = notStartedActive.length ? Math.max(...notStartedActive.map((c) => idleDays(c, now))) : 0;
    const dormantByAge = { d30: [], d90: [], d180: [] };
    dormant.forEach((o) => {
      const idle = (now - Math.max(...(live(o).length ? live(o).map((c) => new Date(c.stage_updated_at || c.created_at).getTime()) : [new Date(o.created_at).getTime()]))) / DAY;
      if (idle >= 180) dormantByAge.d180.push(o); else if (idle >= 90) dormantByAge.d90.push(o); else dormantByAge.d30.push(o);
    });
    const topPerson = lastDay
      ? Object.entries(lastDay.people).map(([n, v]) => [n, v - (lastDay.gate[n] || 0)]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0] || null
      : null;

    return {
      running, dormant, active, activePieces, inHouse, atVendor, week, made, risk, moving,
      lastDay, todayRow, avgFinished, avgScans, worstPile, slowest, liveInHouse,
      vendorTop, vendorOverdue, vendorReturns, quality, ready, readyLong,
      newToday, newWeek, newWeekStarted, urgentStill, lateActive, worstChannel, notStartedActive, oldestWaiting, dormantByAge, topPerson,
      waiting, loading: { scans: !scans, qc: !qc, moves: !moves, waiting: !waiting },
    };
  }, [floor, orders, componentsByOrder, piecesById, scans, qc, moves, waiting]);
}

/** One written line of the briefing with an optional link to its list. */
function Line({ tone = "gold", icon = "trend", children, cta, onClick }) {
  return (
    <div className={`pmb-line is-${tone}`}>
      <span className="pmb-ico"><Icon name={icon} /></span>
      <p>{children}</p>
      {onClick && <button type="button" className="pmb-go" onClick={onClick}>{cta || "See"}<Icon name="chevron" /></button>}
    </div>
  );
}

/** "Today's Briefing": the floor in a few sentences, most important first. */
export function BriefingCard({ ctx, ins }) {
  const { openOrders, openPieces, go } = ctx;
  const pieces = (ids) => [...ids].map((id) => ctx.piecesById[id]).filter(Boolean);
  const L = ins.lastDay;
  const above = L && ins.avgFinished != null ? L.finished.size >= ins.avgFinished : null;
  return (
    <Card span={12} title="Today's Briefing" sub="What the data says this morning, written out. Each line opens the list behind it.">
      <div className="pmb-lines">
        <Line icon="orders" tone={ins.dormant.length > ins.active.length ? "warn" : "gold"} cta="Nothing moving"
          onClick={ins.dormant.length ? () => openOrders({ title: "Nothing Moved in 30+ Days", sub: "Running orders with no scan on any piece for 30 days or more", orders: ins.dormant }) : undefined}>
          <Bold>{num(ins.running.length)}</Bold> orders are in production. <Bold>{num(ins.active.length)}</Bold> are moving; <Bold>{num(ins.dormant.length)}</Bold> have had nothing scanned for 30 days or more and most likely need closing or chasing.
        </Line>

        {L && (
          <Line icon="trend" tone={above === false ? "warn" : "gold"} cta="Pieces finished"
            onClick={() => openPieces({ title: `Finished on ${dayName(L.date)}`, sub: "The last working day", pieces: pieces(L.finished) })}>
            On <Bold>{dayName(L.date)}</Bold>, the last working day, the floor finished <Bold>{num(L.finished.size)}</Bold> pieces from <Bold>{num(L.scans)}</Bold> scans
            {ins.avgFinished != null ? <>, {above ? "above" : "below"} the daily average of {num(Math.round(ins.avgFinished))} finished</> : null}.
            {ins.todayRow ? <> Today so far: {num(ins.todayRow.finished.size)} finished from {num(ins.todayRow.scans)} scans.</> : " No scans yet today."}
          </Line>
        )}

        <Line icon="alert" tone={ins.risk.length ? "crit" : "gold"} cta="At-risk orders"
          onClick={ins.risk.length ? () => openOrders({ title: "At Risk This Week", sub: "Due in 7 days with pieces not started, at a vendor past the return date, or still before Stitching with 3 days or less to go", orders: ins.risk }) : undefined}>
          <Bold>{num(ins.week.length)}</Bold> client orders are due this week: <Bold>{num(ins.made.length)}</Bold> are made, <Bold>{num(ins.moving.length)}</Bold> are on their way and <Bold>{num(ins.risk.length)}</Bold> look at risk.
        </Line>

        {ins.worstPile && ins.worstPile.over.length > 0 && (
          <Line icon="movements" tone="warn" cta="Those pieces"
            onClick={() => openPieces({ title: `Held Up at ${ins.worstPile.name}`, sub: "Pieces of active orders with no scan for 7 days or more", pieces: ins.worstPile.over })}>
            The biggest pile-up of live work is at <Bold>{ins.worstPile.name}</Bold>: <Bold>{num(ins.worstPile.over.length)}</Bold> of its {num(ins.worstPile.all.length)} pieces of active orders have not moved for a week or more.
          </Line>
        )}

        {ins.vendorTop && (
          <Line icon="warehouse" tone="crit" cta="Overdue pieces"
            onClick={() => openPieces({ title: `Overdue at ${ins.vendorTop.name}`, sub: "Past the return date set when they were sent", pieces: pieces(ins.vendorTop.ids) })}>
            <Bold>{ins.vendorTop.name}</Bold> holds <Bold>{num(ins.vendorTop.ids.size)}</Bold> of our pieces past their return date, the most of any vendor; the oldest is {plural(ins.vendorTop.oldest, "day")} late. {num(ins.vendorOverdue.length)} pieces are overdue at vendors in all.
          </Line>
        )}

        {ins.quality && ins.quality.rate != null && (
          <Line icon="integrity" tone={ins.quality.rate < 95 ? "warn" : "gold"} cta="Failed pieces" onClick={ins.quality.fails.length ? () => go("quality") : undefined}>
            QC passed <Bold>{ins.quality.rate.toFixed(1)}%</Bold> of {num(ins.quality.checks)} checks in the last 7 days; <Bold>{num(ins.quality.fails.length)}</Bold> {ins.quality.fails.length === 1 ? "piece failed" : "pieces failed"}.
          </Line>
        )}

        <Line icon="transfer" tone={ins.readyLong.length ? "warn" : "gold"} cta="Ready orders"
          onClick={ins.ready.length ? () => openOrders({ title: "Ready to Dispatch", sub: "Every piece made, waiting to be sent", orders: ins.ready.map((r) => r.o) }) : undefined}>
          <Bold>{num(ins.ready.length)}</Bold> orders are fully made and waiting to be sent; <Bold>{num(ins.readyLong.length)}</Bold> have waited more than 2 days.
        </Line>

        {ins.waiting && (ins.waiting.requests + ins.waiting.replacements) > 0 && (
          <Line icon="edit" tone="crit" cta="Open approvals" onClick={() => go("approvals")}>
            <Bold>{num(ins.waiting.requests)}</Bold> stage change {ins.waiting.requests === 1 ? "request" : "requests"} and <Bold>{num(ins.waiting.replacements)}</Bold> replacement {ins.waiting.replacements === 1 ? "request wait" : "requests wait"} for your decision.
          </Line>
        )}
      </div>
    </Card>
  );
}

/** Plain answers to the questions a production manager is asked most. */
export function QuestionsCard({ ctx, ins }) {
  const { openOrders, openPieces, go } = ctx;
  const pieces = (ids) => [...ids].map((id) => ctx.piecesById[id]).filter(Boolean);
  const L = ins.lastDay;
  const loadingText = "Working this out…";
  const qs = [
    {
      q: "Are we on track for this week's deliveries?",
      a: ins.week.length
        ? `${pct(ins.made.length + ins.moving.length, ins.week.length)}% of the ${num(ins.week.length)} client orders due this week are made or on their way; ${num(ins.risk.length)} need attention.`
        : "No client orders are due this week.",
      open: ins.week.length ? () => openOrders({ title: "Due This Week", sub: "Client orders due in the next 7 days", orders: ins.week }) : null,
    },
    {
      q: "Which orders could miss their date?",
      a: ins.risk.length
        ? `${num(ins.risk.length)} orders due within 7 days have pieces not started, at a vendor past the return date, or still before Stitching with 3 days or less to go.`
        : "None of this week's orders look at risk.",
      open: ins.risk.length ? () => openOrders({ title: "At Risk This Week", sub: "Due in 7 days and behind", orders: ins.risk }) : null,
    },
    {
      q: "How many orders are late, and where from?",
      a: ins.worstChannel
        ? `${num(ins.lateActive.length)} active orders are past their due date; ${ins.worstChannel[0]} has the most (${num(ins.worstChannel[1].length)}). More late orders have had nothing scanned for 30 days.`
        : "No client order is past its due date.",
      open: ins.lateActive.length ? () => openOrders({ title: "Late and Still Moving", sub: "Past the due date, with something scanned in the last 30 days", orders: ins.lateActive }) : null,
    },
    {
      q: "Where is work piling up?",
      a: ins.slowest && ins.slowest.week.length
        ? `${ins.slowest.name}: ${num(ins.slowest.week.length)} of its ${num(ins.slowest.all.length)} pieces of active orders have not moved for a week or more (${Math.round(ins.slowest.avgIdle)} days on average), more than at any other stage.`
        : "No stage has live work that has sat for a week.",
      open: ins.slowest && ins.slowest.week.length ? () => openPieces({ title: `Not Moved for a Week: ${ins.slowest.name}`, sub: "Pieces of active orders, no scan for 7 days or more", pieces: ins.slowest.week }) : null,
    },
    {
      q: "What did the floor do on the last working day?",
      a: ins.loading.scans ? loadingText : L
        ? `${dayName(L.date)}: ${num(L.scans)} scans by ${plural(Object.keys(L.people).length, "person", "people")} at ${plural(L.stations.size, "station")}; ${num(L.finished.size)} pieces finished.${ins.topPerson ? ` Leaving the security gate aside, ${ins.topPerson[0]} scanned the most (${num(ins.topPerson[1])}).` : ""}`
        : "No scans in the last 7 days.",
      open: L ? () => go("people") : null, cta: "Open People",
    },
    {
      q: "Which vendor should we call today?",
      a: ins.loading.moves ? loadingText : ins.vendorTop
        ? `${ins.vendorTop.name}: ${num(ins.vendorTop.ids.size)} pieces past their return date, the oldest ${plural(ins.vendorTop.oldest, "day")} late.`
        : "No vendor has a piece past its return date.",
      open: ins.vendorTop ? () => openPieces({ title: `Overdue at ${ins.vendorTop.name}`, sub: "Past the return date", pieces: pieces(ins.vendorTop.ids) }) : null,
    },
    {
      q: "Are vendors bringing work back on time?",
      a: ins.loading.moves ? loadingText : ins.vendorReturns && ins.vendorReturns.back
        ? `${pct(ins.vendorReturns.onTime, ins.vendorReturns.back)}% of the ${num(ins.vendorReturns.back)} trips that came back in the last 30 days were back by their return date.`
        : "No dated vendor trips came back in the last 30 days.",
      open: () => go("vendors"), cta: "Open Vendors",
    },
    {
      q: "How is quality this week?",
      a: ins.loading.qc ? loadingText : ins.quality && ins.quality.checks
        ? `${ins.quality.rate.toFixed(1)}% of ${num(ins.quality.checks)} QC checks passed in the last 7 days; ${num(ins.quality.fails.length)} failed.`
        : "No QC checks were recorded in the last 7 days.",
      open: () => go("quality"), cta: "Open Quality",
    },
    {
      q: "What came in this week, and has it started?",
      a: `${num(ins.newWeek.length)} orders were placed in the last 7 days (${num(ins.newToday.length)} today); ${num(ins.newWeekStarted.length)} of them have a piece past Cloth Issue.`,
      open: ins.newWeek.length ? () => openOrders({ title: "Placed in the Last 7 Days", sub: "Every channel", orders: ins.newWeek }) : null,
    },
    {
      q: "Which urgent orders are not moving?",
      a: ins.urgentStill.length
        ? `${num(ins.urgentStill.length)} urgent orders have had no piece scanned for 3 days or more.`
        : "Every urgent order has moved in the last 3 days.",
      open: ins.urgentStill.length ? () => openOrders({ title: "Urgent, Not Moving", sub: "No scan for 3 days or more", orders: ins.urgentStill }) : null,
    },
    {
      q: "How much is waiting to start?",
      a: ins.notStartedActive.length
        ? `${num(ins.notStartedActive.length)} pieces of active orders wait for Cloth Issue; the oldest has waited ${plural(ins.oldestWaiting, "day")}.`
        : "No piece of an active order is waiting to start.",
      open: ins.notStartedActive.length ? () => openPieces({ title: "Waiting for Cloth Issue", sub: "Pieces of active orders", pieces: ins.notStartedActive }) : null,
    },
    {
      q: "What is ready to go out?",
      a: `${num(ins.ready.length)} orders are fully made; ${num(ins.readyLong.length)} of them have waited more than 2 days to be sent.`,
      open: () => go("dispatch"), cta: "Open Dispatch",
    },
    {
      q: "How many orders have gone quiet?",
      a: `${num(ins.dormant.length)} running orders have had nothing scanned for 30 days or more: ${num(ins.dormantByAge.d30.length)} for 30–89 days, ${num(ins.dormantByAge.d90.length)} for 90–179 days and ${num(ins.dormantByAge.d180.length)} for 180 days or more.`,
      open: ins.dormant.length ? () => openOrders({ title: "Gone Quiet", sub: "Nothing scanned for 30 days or more", orders: ins.dormant }) : null,
    },
    {
      q: "Is anything waiting for my decision?",
      a: ins.loading.waiting ? loadingText : `${plural(ins.waiting.requests, "stage change request")} and ${plural(ins.waiting.replacements, "replacement request")} are waiting.`,
      open: () => go("approvals"), cta: "Open Approvals",
    },
  ];
  return (
    <Card span={12} title="Questions This Answers" sub="The questions a production manager is asked most, answered from today's data.">
      <div className="pmb-qs">
        {qs.map((x) => (
          <div key={x.q} className="pmb-q">
            <span className="pmb-q-mark" aria-hidden="true">?</span>
            <div className="pmb-q-body">
              <b>{x.q}</b>
              <p>{x.a}</p>
              {x.open && <button type="button" className="pmb-go" onClick={x.open}>{x.cta || "See the list"}<Icon name="chevron" /></button>}
            </div>
          </div>
        ))}
      </div>
      <p className="pm-foot-note">An order counts as active when something on it was scanned in the last 30 days. Due dates are the warehouse date (T-2); website and stock orders are not promised by a date.{` Worked out ${formatDate(new Date())}.`}</p>
    </Card>
  );
}
