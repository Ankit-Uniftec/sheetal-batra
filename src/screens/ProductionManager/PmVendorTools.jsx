import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabaseClient";
import { PERIOD_OPTIONS, comparisonPeriodRange, inRange, periodRange } from "../../components/PeriodFilter";
import ComponentJourneyModal from "../../components/ComponentJourneyModal";
import {
  buildDelayTrips, attachPenalties, delaySummary, vendorScorecard, heatmap, weeklyTrend,
  latenessBuckets, overdueAging, productDelays, deadlineImpact, buildInsights,
  suggestedPenalty, penaltyEligibility, OVERDUE_BUCKETS, PIECE_LABEL,
} from "../../utils/vendorDelays";
import { fetchAllVendors, requestVendor, EXTERNAL_ELIGIBLE_STEPS, getStepLabel } from "../../utils/barcodeService";
import { Chips, Columns, DateRange, Drawer, FilterGroup, InfoTip, Insight, Pager, RankBars, Seg, fullInr, num } from "../CeoDashboard/CeoUi";
import { FilterDrawer, ListTools, Stat } from "../CeoDashboard/dashKit";
import { Card, Loading, Table, csvFromObjects } from "./PmCommon";
import { PmModal } from "./PmModals";
import { fmtDate, plural } from "./pmModel";

// ============================================================
// The two vendor tools on the Vendors page, in the dashboard's own design.
// They replace the older shared panels inside this dashboard only (the older
// dashboards keep VendorDelaysTab and VendorRequest) and do exactly what those
// did: the same reads, the same RPCs with the same arguments, the same rules.
//
//   VendorDelays     late vendor returns, who, on what work, the orders hit,
//                    and penalties on late trips with the penalties ledger.
//                    Vendor penalties are the only money on this dashboard,
//                    kept on purpose: the client asked for them.
//   VendorDirectory  every vendor and its approval status; request a new one.
//
// The delay maths lives in src/utils/vendorDelays.js (shared with the old tab).
// ============================================================

const money = fullInr;
const STATUS_LABEL = { pending: "Pending", settled: "Settled", waived: "Waived" };
const DRAWER_PAGE = 30;
const PAGE = 15;
const EMPTY_FILTERS = {
  dateBasis: "sent", channel: "", vendor: "", piece: "", work: "", status: "", minDays: "",
  head: "", penalty: "", missedOnly: false, repeatOnly: false, q: "",
};
const DEFAULT_PERIOD = "30d";
const DATE_BASIS = [
  { value: "sent", label: "Date sent to vendor" }, { value: "due", label: "Promised return date" }, { value: "returned", label: "Date returned" },
];
const TRIP_STATES = [
  { value: "late", label: "Late (returned or overdue)" }, { value: "ontime", label: "Returned on time" }, { value: "overdue", label: "Overdue now" },
  { value: "out", label: "Still at vendor" }, { value: "returned", label: "Returned" },
];
const MIN_DAYS = [{ value: "1", label: "1+ days late" }, { value: "2", label: "2+ days late" }, { value: "4", label: "4+ days late" }, { value: "8", label: "8+ days late" }];
const SCORE_SORTS = [
  { value: "late", label: "Most late trips" }, { value: "pct", label: "Highest late %" }, { value: "trips", label: "Most trips" },
  { value: "overdue", label: "Most overdue now" }, { value: "name", label: "Name, A to Z" },
];
const lc = (v) => String(v || "").toLowerCase();
const opts = (list) => list.map((v) => ({ value: v, label: v }));
// How strong the late % tint is (brand gold, the urgent tone at the top).
const heatLevel = (p) => (p >= 50 ? 3 : p >= 35 ? 2 : p >= 20 ? 1 : 0);
const Tag = ({ tone, children }) => <i className={`pm-tag${tone ? ` is-${tone}` : ""}`}>{children}</i>;
const Dash = () => <span className="pm-muted">–</span>;
const DateOnly = ({ ms, note, late }) => (ms || ms === 0) && Number.isFinite(ms)
  ? <span className="pm-cell"><b>{fmtDate(ms)}</b>{note && <small className={late ? "pm-late" : undefined}>{note}</small>}</span>
  : <Dash />;

/** A number in a table cell that opens the trips behind it (the row click is not fired). */
const Pick = ({ onClick, level, title, strong, children }) => (
  <button type="button" title={title} className={`pmvt-pick${level ? ` is-h${level}` : ""}${strong ? " is-strong" : ""}`}
    onClick={(e) => { e.stopPropagation(); onClick(); }}>{children}</button>
);

/** A summary figure that opens the trips behind it. */
const StatButton = ({ label, info, value, sub, warn, onClick }) => (
  <button type="button" className="ceo-dstat pmvt-stat" onClick={onClick}>
    <small><InfoTip text={info}>{label}</InfoTip></small>
    <b className={warn ? "is-warn" : undefined}>{value}</b>
    {sub && <span className="pmvt-sub">{sub}</span>}
  </button>
);

/** Rows of one page and the pager under it; back to page 1 whenever the list changes. */
function Paged({ list, size = PAGE, render }) {
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [list]);
  return (
    <>
      {render(list.slice((page - 1) * size, page * size))}
      <Pager page={page} pages={Math.ceil(list.length / size)} onChange={setPage} />
    </>
  );
}

const tripRows = (list) => list.map((t) => ({
  "Order No": t.orderNo, Client: t.client, Channel: t.channel, Product: t.product, Piece: t.pieceLabel,
  Barcode: t.barcode, Vendor: t.vendor, Work: t.workDetail, "Sent Out": fmtDate(t.sentAt), Promised: fmtDate(t.due), "Promised at Set-up": fmtDate(t.promisedOriginal),
  Returned: t.isOut ? "Still out" : fmtDate(t.returnedAt), "Days Late": t.daysLate,
  "Order Deadline": Number.isFinite(t.deadline) ? fmtDate(t.deadline) : "", "Missed Deadline": t.missedDeadline ? "Yes" : "",
  Penalised: t.penaltyId ? "Yes" : "",
}));

// ============================================================ delays and penalties
/**
 * Vendor delays and penalties, for the Production Manager.
 * @param ctx    the dashboard context (orders, ordersById, openOrder, profile)
 * @param moves  fetchExternalMovements() rows, or undefined while loading
 */
export function VendorDelays({ ctx, moves }) {
  const movements = useMemo(() => moves || [], [moves]);
  const loading = !moves;
  const orders = useMemo(() => ctx.orders || [], [ctx.orders]);
  const onOrderClick = (id) => ctx.ordersById[id] && ctx.openOrder(ctx.ordersById[id]);
  const canPenalise = (ctx.profile?.role || "").toLowerCase() === "production_manager";

  const [view, setView] = useState("analytics"); // analytics | penalties
  // Filters. The period applies to the date chosen in `dateBasis`; every
  // other filter narrows the trips behind every figure, chart and insight.
  const [f, setF] = useState(EMPTY_FILTERS);
  const setFilter = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const [timeline, setTimeline] = useState(DEFAULT_PERIOD);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const range = useMemo(() => periodRange(timeline, customFrom, customTo), [timeline, customFrom, customTo]);
  const inPeriod = useCallback((dateStr) => (range ? inRange(range, dateStr) : true), [range]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [scoreSort, setScoreSort] = useState("late");

  // ── Penalties (tolerant: before r20_01 the tables do not exist)
  const [pen, setPen] = useState({ ready: false, available: false, list: [], trips: [], rates: {} });
  const loadPenalties = useCallback(async () => {
    try {
      const [p, t] = await Promise.all([
        supabase.from("vendor_penalties").select("*").order("created_at", { ascending: false }),
        supabase.from("vendor_penalty_trips").select("penalty_id, movement_id, order_id, order_no, barcode, days_late"),
      ]);
      if (p.error || t.error) throw p.error || t.error;
      const { data: vend } = await supabase.from("production_vendors").select("id, vendor_name, per_day_penalty");
      const rates = {};
      (vend || []).forEach((v) => { rates[v.vendor_name] = { id: v.id, rate: v.per_day_penalty }; });
      setPen({ ready: true, available: true, list: p.data || [], trips: t.data || [], rates });
    } catch (e) {
      console.warn("Vendor penalties not available:", e?.message || e);
      setPen({ ready: true, available: false, list: [], trips: [], rates: {} });
    }
  }, []);
  useEffect(() => { loadPenalties(); }, [loadPenalties]);

  // ── Trips
  const orderById = useMemo(() => Object.fromEntries(orders.map((o) => [o.id, o])), [orders]);
  const allTrips = useMemo(
    () => attachPenalties(buildDelayTrips(movements, orderById), pen.trips),
    [movements, orderById, pen.trips]
  );
  const options = useMemo(() => {
    const uniq = (fn) => [...new Set(allTrips.map(fn))].filter((x) => x && x !== "—").sort();
    return {
      channels: uniq((t) => t.channel),
      vendors: uniq((t) => t.vendor),
      works: uniq((t) => t.work),
      heads: uniq((t) => t.createdBy),
    };
  }, [allTrips]);
  const scoped = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const minDays = Number(f.minDays) || 0;
    return allTrips.filter((t) =>
      (!f.channel || t.channel === f.channel) &&
      (!f.vendor || t.vendor === f.vendor) &&
      (!f.piece || t.piece === f.piece) &&
      (!f.work || t.work === f.work) &&
      (!f.head || t.createdBy === f.head) &&
      (!f.status ||
        (f.status === "late" && t.isLate) ||
        (f.status === "ontime" && !t.isLate && !t.isOut) ||
        (f.status === "overdue" && t.isOut && t.isLate) ||
        (f.status === "out" && t.isOut) ||
        (f.status === "returned" && !t.isOut)) &&
      (!minDays || t.daysLate >= minDays) &&
      (!f.penalty || (f.penalty === "yes" ? !!t.penaltyId : !t.penaltyId)) &&
      (!f.missedOnly || t.missedDeadline) &&
      (!f.repeatOnly || t.isRepeat) &&
      (!q || `${t.orderNo} ${t.barcode} ${t.product} ${t.client}`.toLowerCase().includes(q)));
  }, [allTrips, f]);
  const iso = (ms) => new Date(ms).toISOString();
  // The date the period applies to. A trip without that date (e.g. not yet
  // returned) falls outside any bounded range.
  const basisMs = useCallback(
    (t) => (f.dateBasis === "due" ? t.due : f.dateBasis === "returned" ? t.returnedAt : t.sentAt),
    [f.dateBasis]
  );
  const trips = useMemo(
    () => scoped.filter((t) => { const ms = basisMs(t); return ms == null ? !range : inPeriod(iso(ms)); }),
    [scoped, inPeriod, basisMs, range]
  );
  const activeFilters = Object.entries(f).filter(([k, v]) => k !== "dateBasis" && k !== "q" && v !== "" && v !== false).length
    + (f.dateBasis !== "sent" ? 1 : 0) + (timeline !== DEFAULT_PERIOD ? 1 : 0) + (scoreSort !== "late" ? 1 : 0);
  const prevRange = range ? comparisonPeriodRange(range, "previous_period") : null;
  const prevTrips = useMemo(
    () => (prevRange ? scoped.filter((t) => { const ms = basisMs(t); return ms != null && inRange(prevRange, iso(ms)); }) : null),
    [scoped, basisMs, prevRange?.start?.getTime(), prevRange?.end?.getTime()] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const summary = useMemo(() => delaySummary(trips), [trips]);
  const scorecard = useMemo(() => vendorScorecard(trips, prevTrips), [trips, prevTrips]);
  const topVendors = useMemo(() => scorecard.filter((v) => v.judged >= 10).slice(0, 15).map((v) => v.key), [scorecard]);
  const pieceHeat = useMemo(() => heatmap(trips, (t) => t.pieceLabel, { vendors: topVendors }), [trips, topVendors]);
  const workHeat = useMemo(() => heatmap(trips, (t) => t.work, { vendors: topVendors }), [trips, topVendors]);
  const trend = useMemo(() => weeklyTrend(trips), [trips]);
  const buckets = useMemo(() => latenessBuckets(trips), [trips]);
  const aging = useMemo(() => overdueAging(scoped), [scoped]); // overdue NOW, not period-bound
  const products = useMemo(() => productDelays(trips), [trips]);
  const impact = useMemo(() => deadlineImpact(trips), [trips]);
  const insights = useMemo(
    () => buildInsights(trips, prevTrips, { overdueNow: aging.flatMap((r) => r.trips) }),
    [trips, prevTrips, aging]
  );
  const penaltyTotal = useMemo(() => {
    const ids = new Set(trips.map((t) => t.penaltyId).filter(Boolean));
    const list = pen.list.filter((p) => ids.has(p.id));
    return {
      amount: list.filter((p) => p.status !== "waived").reduce((s, p) => s + Number(p.amount || 0), 0),
      pending: list.filter((p) => p.status === "pending").length,
      trips: trips.filter((t) => t.penaltyId),
    };
  }, [trips, pen.list]);
  // The scorecard as shown (sorting is display only; the busiest-vendor picks above keep the shared order).
  const scoreRows = useMemo(() => {
    const list = [...scorecard];
    if (scoreSort === "pct") list.sort((a, b) => b.latePct - a.latePct || b.late - a.late);
    else if (scoreSort === "trips") list.sort((a, b) => b.n - a.n);
    else if (scoreSort === "overdue") list.sort((a, b) => b.overdueNow - a.overdueNow || b.late - a.late);
    else if (scoreSort === "name") list.sort((a, b) => a.key.localeCompare(b.key));
    return list;
  }, [scorecard, scoreSort]);

  // ── Drawer (the trips behind any figure / bar / cell / insight)
  const [drawer, setDrawer] = useState(null); // { title, trips }
  const open = (title, list) => setDrawer({ title, trips: [...list].sort((a, b) => b.daysLate - a.daysLate) });

  const clearFilters = () => { setF((p) => ({ ...EMPTY_FILTERS, q: p.q })); setTimeline(DEFAULT_PERIOD); setCustomFrom(""); setCustomTo(""); setScoreSort("late"); };
  const rangeText = range ? `${fmtDate(range.start.getTime())} to ${fmtDate(range.end.getTime())}` : "All time";
  const overdueNow = aging.flatMap((r) => r.trips);
  const judgedVendors = scorecard.filter((v) => v.judged >= 10);
  const canRate = canPenalise && pen.available;

  if (loading && movements.length === 0) return <Loading text="Loading vendor trips" />;

  return (
    <>
      <div className="pmvt-head">
        <Seg label="Vendor delays" value={view} onChange={setView} options={[
          { value: "analytics", label: "Delays" },
          { value: "penalties", label: "Penalties", count: pen.available ? pen.list.length : undefined },
        ]} />
      </div>

      {view === "penalties" ? (
        <PenaltiesLedger pen={pen} canPenalise={canPenalise} onChanged={loadPenalties} allTrips={allTrips} onOpenTrips={open} />
      ) : (
        <>
          <ListTools search={f.q} onSearch={(v) => setFilter("q", v)} placeholder="Search order no, barcode, product, client"
            filters={activeFilters} onFilters={() => setFiltersOpen(true)}
            onExport={() => csvFromObjects(`vendor delays ${rangeText}`, tripRows(trips))} exportDisabled={!trips.length} />
          <p className="pmvt-line">
            Showing <b>{num(trips.length)}</b> trips · {plural(new Set(trips.map((t) => t.orderId)).size, "order")} · {rangeText}
            {" "}({DATE_BASIS.find((d) => d.value === f.dateBasis).label.toLowerCase()})
          </p>
          <div className="ceo-dstats">
            <StatButton label="On-time Returns" value={`${summary.onTimePct}%`} sub={`${num(summary.returned)} trips returned`}
              info="Trips that came back on or before the end of their promised return day, out of all trips returned."
              onClick={() => open("Trips returned", trips.filter((t) => !t.isOut))} />
            <StatButton label="Late Returns" value={num(summary.lateReturned)} sub={`${summary.avgDaysLate} days late on average`} warn={summary.lateReturned > 0}
              info="Trips that came back after the end of their promised return day."
              onClick={() => open("Late returns", trips.filter((t) => !t.isOut && t.isLate))} />
            <StatButton label="Overdue at Vendors Now" value={num(aging.reduce((s, r) => s + r.total, 0))}
              sub={`oldest ${aging.reduce((m, r) => Math.max(m, ...r.trips.map((t) => t.daysLate)), 0)} days`} warn={overdueNow.length > 0}
              info="Pieces still out today after their promised return day, whatever the date range."
              onClick={() => open("Overdue at vendors now", overdueNow)} />
            <StatButton label="Missed the Order Deadline" value={num(summary.missedDeadline)} sub="late return after delivery − 2 days" warn={summary.missedDeadline > 0}
              info="Late returns that came back after the order's production deadline (the client's delivery date minus 2 days)."
              onClick={() => open("Late returns that missed the order's production deadline", trips.filter((t) => t.missedDeadline))} />
            <StatButton label="Penalties" value={pen.available ? money(penaltyTotal.amount) : "–"}
              sub={pen.available ? `${penaltyTotal.pending} pending` : "not set up yet"}
              info="Vendor penalties on the trips shown, pending and settled (waived ones are left out)."
              onClick={() => open("Penalised trips", penaltyTotal.trips)} />
          </div>
          <p className="pmvt-note">
            A trip is late when the piece came back (or, still out, is now) after the end of its promised return day. If a piece was sent out after its return date had already passed, the vendor is judged from the send date plus the planned turnaround.
            Our own SB WH Delhi (2) is not counted. Click any number, bar, cell or insight to see the trips behind it.
          </p>

          <div className="ceo-grid">
            {insights.length > 0 && (
              <Card span={12} title="What Stands Out">
                <div className="pmq-insights">
                  {insights.map((ins, i) => (
                    <button key={i} type="button" className="pmvt-insight" onClick={() => open(ins.text, ins.trips)}>
                      <Insight tone={ins.tone === "good" ? "gold" : "warn"}>{ins.text} <span className="pmvt-more">{plural(ins.trips.length, "trip")}</span></Insight>
                    </button>
                  ))}
                </div>
              </Card>
            )}

            <Card span={12} title="Vendor Scorecard" sub={`Sorted by ${SCORE_SORTS.find((s) => s.value === scoreSort).label.toLowerCase()}. Click a vendor to see all its trips, or a number to see those trips.`}>
              <Table rowKey={(v) => v.key} rows={scoreRows} empty="No vendor trips in this period." onRow={(v) => open(`${v.key}: all trips`, v.trips)}
                columns={[
                  { key: "vendor", label: "Vendor", render: (v) => <b>{v.key}</b> },
                  { key: "n", label: "Trips", right: true, render: (v) => num(v.n) },
                  { key: "pct", label: "Late %", right: true, render: (v) => <Pick level={heatLevel(v.latePct)} onClick={() => open(`${v.key}: late trips`, v.trips.filter((t) => t.isLate))}>{v.latePct}%</Pick> },
                  {
                    key: "vs", label: "Vs Previous Period", right: true, hide: true, render: (v) => {
                      const delta = v.prevLatePct == null ? null : v.latePct - v.prevLatePct;
                      if (delta == null) return <Dash />;
                      return <span className={delta > 0 ? "pm-late" : undefined}>{delta === 0 ? "No change" : `${Math.abs(delta)} pts ${delta > 0 ? "worse" : "better"}`}</span>;
                    },
                  },
                  { key: "avg", label: "Avg Days Late", right: true, hide: true, render: (v) => v.avgDaysLate || <Dash /> },
                  { key: "worst", label: "Worst", right: true, hide: true, render: (v) => (v.worstDaysLate ? plural(v.worstDaysLate, "day") : <Dash />) },
                  { key: "over", label: "Overdue Now", right: true, render: (v) => (v.overdueNow ? <Pick onClick={() => open(`${v.key}: overdue now`, v.trips.filter((t) => t.isOut && t.isLate))}>{num(v.overdueNow)}</Pick> : <Dash />) },
                  { key: "missed", label: "Missed Deadline", right: true, hide: true, render: (v) => (v.missedDeadline ? <Pick onClick={() => open(`${v.key}: missed order deadlines`, v.trips.filter((t) => t.missedDeadline))}>{num(v.missedDeadline)}</Pick> : <Dash />) },
                  { key: "prom", label: "Promised Days", right: true, hide: true, lap: true, render: (v) => (v.lateDone || v.n ? v.avgPromised : <Dash />) },
                  { key: "act", label: "Actual Days", right: true, hide: true, lap: true, render: (v) => (v.lateDone || v.n ? v.avgActual : <Dash />) },
                  {
                    key: "pen", label: "Penalties", right: true, render: (v) => {
                      const vPen = pen.list.filter((p) => p.vendor_name === v.key && p.status !== "waived");
                      return vPen.length ? money(vPen.reduce((s, p) => s + Number(p.amount || 0), 0)) : <Dash />;
                    },
                  },
                  ...(canRate ? [{ key: "rate", label: "₹ per Day Late", right: true, render: (v) => <RateCell key={`${v.key}-${pen.rates[v.key]?.rate ?? ""}`} vendor={v.key} rate={pen.rates[v.key]} onSaved={loadPenalties} /> }] : []),
                ]} />
            </Card>

            {judgedVendors.length > 0 && (
              <Card span={12} title="Late % by Vendor" sub="Vendors with 10 or more trips. Click a vendor to see its late trips.">
                <RankBars rows={judgedVendors.map((v) => ({ key: v.key, name: v.key, value: v.latePct, v }))} limit={judgedVendors.length}
                  format={(x) => `${x}%`} sub={(r) => `${r.v.late} late of ${r.v.judged}`}
                  colorOf={(r) => (r.value >= 50 ? "#6a4f0c" : r.value >= 30 ? "#a9821f" : "#cfae4e")}
                  onRow={(r) => open(`${r.v.key}: late trips`, r.v.trips.filter((t) => t.isLate))} />
              </Card>
            )}

            <HeatCard title="Late % by Vendor and Piece" data={pieceHeat} onOpen={open} />
            <HeatCard title="Late % by Vendor and Work" data={workHeat} onOpen={open} />

            <Card span={6} md={12} title="Late % by Week" sub="By the week the piece was sent out. Click a week to see its late trips.">
              {trend.length > 1 ? (
                <Columns data={trend.map((w) => ({ name: fmtDate(w.week).slice(0, 7), value: w.latePct, w }))} money={false} name="Late %" height={240}
                  onPick={(row) => open(`Week of ${fmtDate(row.w.week)}: late trips`, row.w.trips.filter((t) => t.isLate))} />
              ) : <p className="pmvt-empty">Choose a longer period to see a trend.</p>}
            </Card>
            <Card span={6} md={12} title="How Late Were the Late Returns" sub="Trips returned late, by days late. Click a bar to see them.">
              <Columns data={buckets.map((b) => ({ name: b.bucket, value: b.count, b }))} money={false} name="Late returns" height={240}
                onPick={(row) => open(`Late returns: ${row.b.bucket}`, row.b.trips)} />
            </Card>

            <Card span={12} title="Overdue at Vendors Right Now, by Age" sub="Today, whatever the date range. Click a number to see the pieces.">
              <Table rowKey={(r) => r.vendor} rows={aging} empty="Nothing overdue right now." columns={[
                { key: "vendor", label: "Vendor", render: (r) => <Pick strong onClick={() => open(`${r.vendor}: overdue now`, r.trips)}>{r.vendor}</Pick> },
                { key: "total", label: "Total", right: true, render: (r) => <Pick onClick={() => open(`${r.vendor}: overdue now`, r.trips)}>{num(r.total)}</Pick> },
                ...OVERDUE_BUCKETS.map((b) => ({
                  key: b.key, label: b.key, right: true,
                  render: (r) => (r[b.key].length
                    ? <Pick level={heatLevel(b.key.startsWith("10") ? 60 : b.key.startsWith("6") ? 40 : 25)} onClick={() => open(`${r.vendor}: overdue ${b.key}`, r[b.key])}>{num(r[b.key].length)}</Pick>
                    : <Dash />),
                })),
              ]} />
            </Card>

            <Card span={7} md={12} title="Products Most Delayed at a Vendor" sub="Product and vendor pairs with 5 or more trips. Click a row to see the trips.">
              <Table rowKey={(p) => p.key} rows={products} empty="Not enough trips yet." onRow={(p) => open(`${p.product} at ${p.vendor}`, p.trips)} columns={[
                { key: "product", label: "Product", render: (p) => <span className="pm-wrap">{p.product}</span> },
                { key: "vendor", label: "Vendor", render: (p) => p.vendor },
                { key: "n", label: "Trips", right: true, render: (p) => num(p.n) },
                { key: "pct", label: "Late %", right: true, render: (p) => <span className={`pmvt-heat is-h${heatLevel(p.latePct)}`}>{p.latePct}%</span> },
              ]} />
            </Card>
            <Card span={5} md={12} title="Missed Order Deadlines by Channel" sub="Late returns that came back after the order's production deadline.">
              {impact.length ? (
                <RankBars rows={impact.map((d) => ({ key: d.channel, name: d.channel, value: d.count, d }))} limit={impact.length}
                  format={(x) => plural(x, "late return")} sub={(r) => plural(r.d.orders, "order")}
                  onRow={(r) => open(`${r.d.channel}: late returns after the order deadline`, r.d.trips)} />
              ) : <p className="pmvt-empty">No late return missed an order deadline in this period.</p>}
            </Card>
          </div>

          <FilterDrawer open={filtersOpen} onClose={() => setFiltersOpen(false)} onClear={clearFilters} count={trips.length} noun="trips" sub="Narrow every figure, chart and table">
            <FilterGroup label="Dates">
              <Chips options={PERIOD_OPTIONS} value={timeline} onChange={(v) => setTimeline(v || DEFAULT_PERIOD)} />
              {timeline === "custom" && <DateRange from={customFrom} to={customTo} onChange={(a, b) => { setCustomFrom(a); setCustomTo(b); }} />}
            </FilterGroup>
            <FilterGroup label="The Dates Are"><Chips options={DATE_BASIS} value={f.dateBasis} onChange={(v) => setFilter("dateBasis", v || "sent")} /></FilterGroup>
            <FilterGroup label="Sort the Scorecard By"><Chips options={SCORE_SORTS} value={scoreSort} onChange={(v) => setScoreSort(v || "late")} /></FilterGroup>
            <FilterGroup label="Trips"><Chips options={TRIP_STATES} value={f.status} onChange={(v) => setFilter("status", v)} /></FilterGroup>
            <FilterGroup label="Days Late"><Chips options={MIN_DAYS} value={f.minDays} onChange={(v) => setFilter("minDays", v)} /></FilterGroup>
            <FilterGroup label="Show">
              <Chips options={[{ value: "missed", label: "Missed order deadline" }, { value: "repeat", label: "Repeat trips (sent back)" }]}
                value={[f.missedOnly && "missed", f.repeatOnly && "repeat"].filter(Boolean)}
                onChange={(v) => setF((p) => ({ ...p, missedOnly: v.includes("missed"), repeatOnly: v.includes("repeat") }))} />
            </FilterGroup>
            {pen.available && <FilterGroup label="Penalty"><Chips options={[{ value: "yes", label: "Penalised" }, { value: "no", label: "Not penalised" }]} value={f.penalty} onChange={(v) => setFilter("penalty", v)} /></FilterGroup>}
            <FilterGroup label="Vendor"><Chips options={opts(options.vendors)} value={f.vendor} onChange={(v) => setFilter("vendor", v)} /></FilterGroup>
            <FilterGroup label="Sent For"><Chips options={opts(options.works)} value={f.work} onChange={(v) => setFilter("work", v)} /></FilterGroup>
            <FilterGroup label="Piece"><Chips options={Object.entries(PIECE_LABEL).map(([k, v]) => ({ value: k, label: v }))} value={f.piece} onChange={(v) => setFilter("piece", v)} /></FilterGroup>
            <FilterGroup label="Channel"><Chips options={opts(options.channels)} value={f.channel} onChange={(v) => setFilter("channel", v)} /></FilterGroup>
            <FilterGroup label="Set Up By"><Chips options={opts(options.heads)} value={f.head} onChange={(v) => setFilter("head", v)} /></FilterGroup>
          </FilterDrawer>
        </>
      )}

      {drawer && (
        <TripsDrawer
          title={drawer.title}
          trips={drawer.trips}
          canPenalise={canRate}
          rates={pen.rates}
          onClose={() => setDrawer(null)}
          onOrderClick={onOrderClick}
          onPenalised={async () => { await loadPenalties(); setDrawer(null); }}
        />
      )}
    </>
  );
}

/** A vendor × piece (or work) table of late %. Blank: fewer than 5 trips. */
function HeatCard({ title, data, onOpen }) {
  if (!data.rows.length) return null;
  return (
    <Card span={12} title={title} sub="The busiest vendors. A dot means fewer than 5 trips; a bold figure is 15 points or more worse than that vendor's overall.">
      <Table rowKey={(r) => r.vendor} rows={data.rows} columns={[
        { key: "vendor", label: "Vendor", render: (r) => <b>{r.vendor}</b> },
        { key: "all", label: "Overall", right: true, render: (r) => `${r.latePct}%` },
        ...data.cols.map((c) => ({
          key: `c-${c}`, label: c, right: true, render: (r) => {
            const cell = r.cells[c];
            if (!cell) return null;
            if (cell.sparse) return <span className="pm-muted" title={`${cell.n} trips`}>·</span>;
            const worse = cell.latePct - r.latePct >= 15;
            return <Pick level={heatLevel(cell.latePct)} strong={worse} title={`${cell.late} late of ${cell.judged}`} onClick={() => onOpen(`${r.vendor}: ${c}`, cell.trips)}>{cell.latePct}%</Pick>;
          },
        })),
      ]} />
    </Card>
  );
}

function RateCell({ vendor, rate, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(rate?.rate ?? "");
  const [msg, setMsg] = useState("");
  if (!rate?.id) return <Dash />;
  const save = async () => {
    const n = val === "" ? null : Number(val);
    if (n != null && (!Number.isFinite(n) || n < 0)) { setMsg("Invalid"); return; }
    const { data, error } = await supabase.rpc("set_vendor_penalty_rate", { p_vendor_id: rate.id, p_rate: n });
    if (error || !data?.success) { setMsg(error?.message || data?.message || "Failed"); return; }
    setEditing(false); setMsg(""); onSaved?.();
  };
  const stop = (e) => e.stopPropagation();
  if (!editing) {
    return (
      <button type="button" className="pmvt-mini" title={`Set ₹ per day late for ${vendor}`} onClick={(e) => { stop(e); setVal(rate.rate ?? ""); setEditing(true); }}>
        {rate.rate != null ? money(rate.rate) : "Set"}
      </button>
    );
  }
  return (
    <span className="pmvt-rate" onClick={stop} onKeyDown={stop} role="presentation">
      <input type="number" min="0" value={val} onChange={(e) => setVal(e.target.value)} aria-label={`₹ per day late for ${vendor}`} />
      <button type="button" className="pmvt-mini is-primary" onClick={save}>Save</button>
      <button type="button" className="pmvt-mini" onClick={() => setEditing(false)}>Cancel</button>
      {msg && <small className="pm-late">{msg}</small>}
    </span>
  );
}

// ------------------------------------------------------------ the trips behind a figure
const DRAWER_SORTS = [{ value: "late", label: "Most days late" }, { value: "new", label: "Sent most recently" }, { value: "due", label: "Promised date, soonest" }];
const DRAWER_SHOW = [{ value: "late", label: "Late only" }, { value: "overdue", label: "Overdue now" }, { value: "missed", label: "Missed deadline" }, { value: "open", label: "Not penalised" }];

function TripsDrawer({ title, trips, canPenalise, rates, onClose, onOrderClick, onPenalised }) {
  const [selected, setSelected] = useState(() => new Set());
  const [penaltyFor, setPenaltyFor] = useState(null);
  const [journey, setJourney] = useState(null);
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState("late");
  const [show, setShow] = useState([]);
  const list = useMemo(() => {
    const q = lc(search).trim();
    const out = trips.filter((t) => (!show.includes("late") || t.isLate) && (!show.includes("overdue") || (t.isOut && t.isLate))
      && (!show.includes("missed") || t.missedDeadline) && (!show.includes("open") || !t.penaltyId)
      && (!q || [t.orderNo, t.barcode, t.product, t.client, t.vendor].some((v) => lc(v).includes(q))));
    if (sort === "new") out.sort((a, b) => b.sentAt - a.sentAt);
    else if (sort === "due") out.sort((a, b) => a.due - b.due);
    return out; // "late": already most days late first
  }, [trips, search, show, sort]);
  const sel = trips.filter((t) => selected.has(t.id));
  const elig = penaltyEligibility(sel);
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectAllLate = () => setSelected(new Set(list.filter((t) => t.isLate && !t.penaltyId).map((t) => t.id)));
  const openJourney = async (t) => {
    const { data } = await supabase.from("order_components").select("*").eq("order_id", t.orderId);
    setJourney({ orderNo: t.orderNo, components: data || [] });
  };
  const orderCount = new Set(trips.map((t) => t.orderId)).size;
  const active = show.length + (sort !== "late" ? 1 : 0);

  return (
    <Drawer title={title} sub={`${plural(trips.length, "trip")} · ${plural(orderCount, "order")} · ${num(trips.filter((t) => t.isLate).length)} late`} onClose={onClose} wide>
      <div className="pm-records">
        <ListTools search={search} onSearch={setSearch} placeholder="Search order, barcode, product, client" filters={active} onFilters={() => setFiltersOpen((v) => !v)}
          onExport={() => csvFromObjects(`vendor delays ${title}`, tripRows(list))} exportDisabled={!list.length} />
        {filtersOpen && (
          <div className="pm-inline-filters">
            <FilterGroup label="Sort By"><Chips options={DRAWER_SORTS} value={sort} onChange={(v) => setSort(v || "late")} /></FilterGroup>
            <FilterGroup label="Show"><Chips options={DRAWER_SHOW} value={show} onChange={setShow} /></FilterGroup>
            <div className="pm-inline-foot">
              <button type="button" className="ceo-btn" onClick={() => { setSort("late"); setShow([]); }}>Clear Filters</button>
              <button type="button" className="ceo-btn is-primary" onClick={() => setFiltersOpen(false)}>Show {num(list.length)} trips</button>
            </div>
          </div>
        )}
        {canPenalise && (
          <div className="pmvt-penbar">
            <button type="button" className="ceo-btn" onClick={selectAllLate}>Select all late, not yet penalised</button>
            {sel.length > 0 && <button type="button" className="ceo-btn" onClick={() => setSelected(new Set())}>Clear ({sel.length})</button>}
            <button type="button" className="ceo-btn is-primary" disabled={!elig.ok} title={elig.ok ? "" : elig.reason}
              onClick={() => setPenaltyFor({ vendor: elig.vendor, vendorId: rates[elig.vendor]?.id || elig.vendorId, trips: sel })}>
              Add Penalty{sel.length ? ` (${sel.length})` : ""}
            </button>
            {!elig.ok && sel.length > 0 && <span className="pm-late">{elig.reason}</span>}
          </div>
        )}
        <Paged list={list} size={DRAWER_PAGE} render={(page) => (
          <Table rowKey={(t) => t.id} rows={page} empty={trips.length ? "No trips match these filters." : "No trips."} onRow={(t) => onOrderClick?.(t.orderId, t.orderNo)}
            columns={[
              ...(canPenalise ? [{
                key: "pick", label: "", render: (t) => (t.isLate && !t.penaltyId
                  ? <input type="checkbox" className="pmvt-check" checked={selected.has(t.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(t.id)} aria-label={`Select ${t.barcode || t.orderNo}`} />
                  : null),
              }] : []),
              { key: "order", label: "Order", render: (t) => <span className="pm-nowrap">{t.orderNo || "–"}</span> },
              { key: "bc", label: "Barcode", hide: true, render: (t) => <span className="pm-code">{t.barcode || "–"}</span> },
              { key: "piece", label: "Piece", hide: true, render: (t) => t.pieceLabel },
              { key: "product", label: "Product", hide: true, render: (t) => <span className="pm-wrap">{t.product || "–"}</span> },
              { key: "client", label: "Client", hide: true, lap: true, render: (t) => t.client || <Dash /> },
              { key: "channel", label: "Channel", hide: true, lap: true, render: (t) => t.channel },
              { key: "vendor", label: "Vendor", render: (t) => t.vendor },
              { key: "work", label: "Work", hide: true, render: (t) => t.workDetail },
              { key: "late", label: "Days Late", right: true, render: (t) => (t.isLate ? <Tag tone="urgent">{plural(t.daysLate, "day")}</Tag> : <Tag tone="soft">On time</Tag>) },
              {
                key: "flags", label: "Status", render: (t) => (
                  <span className="pmvt-tags">
                    {t.isOut && t.isLate && <Tag tone="urgent">Overdue now</Tag>}
                    {t.isOut && !t.isLate && <Tag>Still out</Tag>}
                    {t.missedDeadline && <Tag tone="urgent">Missed deadline</Tag>}
                    {t.penaltyId && <Tag>Penalised</Tag>}
                    {!t.isOut && !t.missedDeadline && !t.penaltyId && <Tag tone="soft">Back</Tag>}
                  </span>
                ),
              },
              { key: "sent", label: "Sent Out", right: true, render: (t) => <DateOnly ms={t.sentAt} /> },
              {
                key: "due", label: "Promised", right: true, render: (t) => (
                  <span title={t.dueAdjusted ? `Return date ${fmtDate(t.promisedOriginal)} had passed when the piece was sent` : undefined}>
                    <DateOnly ms={t.due} note={t.dueAdjusted ? `Set-up date ${fmtDate(t.promisedOriginal)} had passed; counted from the send date` : null} />
                  </span>
                ),
              },
              { key: "back", label: "Came Back", right: true, render: (t) => (t.isOut ? <span className="pm-muted">Still out</span> : <DateOnly ms={t.returnedAt} />) },
              { key: "deadline", label: "Order Deadline", right: true, hide: true, render: (t) => <DateOnly ms={t.deadline} late={t.missedDeadline} note={t.missedDeadline ? "Missed" : null} /> },
              {
                key: "act", label: "", render: (t) => (
                  <span className="pmvt-acts">
                    <button type="button" className="pmvt-mini" onClick={(e) => { e.stopPropagation(); openJourney(t); }}>View Journey</button>
                    <button type="button" className="pmvt-mini" onClick={(e) => { e.stopPropagation(); onOrderClick?.(t.orderId, t.orderNo); }}>Open Order</button>
                  </span>
                ),
              },
            ]} />
        )} />
      </div>
      {penaltyFor && (
        <PenaltyModal
          target={penaltyFor}
          rate={rates[penaltyFor.vendor]?.rate}
          onClose={() => setPenaltyFor(null)}
          onSaved={async () => { setPenaltyFor(null); setSelected(new Set()); await onPenalised?.(); }}
        />
      )}
      {journey && createPortal(
        <ComponentJourneyModal orderNo={journey.orderNo} components={journey.components} onClose={() => setJourney(null)} />,
        document.body,
      )}
    </Drawer>
  );
}

const Field = ({ label, children, full }) => (
  <label className={`pmx-field${full ? " is-full" : ""}`}><span>{label}</span>{children}</label>
);

function PenaltyModal({ target, rate, onClose, onSaved }) {
  const { days } = suggestedPenalty(target.trips, rate);
  const [basis, setBasis] = useState(rate ? "per_day" : "fixed");
  const [perDay, setPerDay] = useState(rate ?? "");
  const [amount, setAmount] = useState(rate ? Math.round(Number(rate) * days) : "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const onRate = (v) => { setPerDay(v); if (basis === "per_day" && v !== "" && Number.isFinite(Number(v))) setAmount(Math.round(Number(v) * days)); };
  const save = async () => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0 || amount === "") { setErr("Enter the penalty amount."); return; }
    if (!reason.trim()) { setErr("A reason is required."); return; }
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("create_vendor_penalty", {
      p_vendor_id: target.vendorId || null,
      p_vendor_name: target.vendor,
      p_movement_ids: target.trips.map((t) => t.id),
      p_basis: basis,
      p_rate: basis === "per_day" && perDay !== "" ? Number(perDay) : null,
      p_amount: amt,
      p_reason: reason.trim(),
    });
    setBusy(false);
    if (error || !data?.success) { setErr(error?.message || data?.message || "Could not save the penalty."); return; }
    onSaved?.();
  };
  const orderNos = [...new Set(target.trips.map((t) => t.orderNo))];
  return (
    <PmModal title={`Penalty for ${target.vendor}`} onClose={busy ? () => {} : onClose} width={520}
      sub={`${plural(target.trips.length, "late trip")} · ${plural(days, "day")} late in total`}
      footer={(
        <>
          <button type="button" className="pmx-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="pmx-btn is-primary" onClick={save} disabled={busy}>{busy ? "Saving" : "Save Penalty"}</button>
        </>
      )}>
      <p className="pmx-note">Orders {orderNos.slice(0, 6).join(", ")}{orderNos.length > 6 ? ` and ${plural(orderNos.length - 6, "more")}` : ""}.</p>
      <div className="pmx-grid">
        <Field label="Basis">
          <select value={basis} onChange={(e) => setBasis(e.target.value)}>
            <option value="per_day">Per day late</option>
            <option value="fixed">Fixed amount</option>
          </select>
        </Field>
        {basis === "per_day" && (
          <Field label="₹ per Day Late">
            <input type="number" min="0" value={perDay} onChange={(e) => onRate(e.target.value)} placeholder={rate ? "" : "No rate set for this vendor"} />
          </Field>
        )}
        <Field label="Amount (₹)" full={basis !== "per_day"}>
          <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Reason (required)" full>
          <input type="text" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: 4 embroidery pieces returned 3 days late, order deadline missed" />
        </Field>
      </div>
      {err && <p className="pmx-error">{err}</p>}
    </PmModal>
  );
}

// ------------------------------------------------------------ penalties ledger
const LEDGER_SORTS = [{ value: "new", label: "Newest first" }, { value: "old", label: "Oldest first" }, { value: "amount", label: "Largest amount" }];

function PenaltiesLedger({ pen, canPenalise, onChanged, allTrips, onOpenTrips }) {
  const [statusF, setStatusF] = useState([]);
  const [vendorF, setVendorF] = useState([]);
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState("new");
  const [noteFor, setNoteFor] = useState(null); // { penalty, to }
  const tripsByPenalty = useMemo(() => {
    const m = {};
    pen.trips.forEach((t) => { (m[t.penalty_id] = m[t.penalty_id] || []).push(t); });
    return m;
  }, [pen.trips]);
  const list = useMemo(() => {
    const q = lc(search).trim();
    const ordersOf = (p) => (tripsByPenalty[p.id] || []).map((t) => t.order_no).join(" ");
    const out = pen.list.filter((p) => (!statusF.length || statusF.includes(p.status)) && (!vendorF.length || vendorF.includes(p.vendor_name))
      && (!q || [p.vendor_name, p.reason, p.created_by, ordersOf(p)].some((v) => lc(v).includes(q))));
    if (sort === "old") out.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    else if (sort === "amount") out.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
    return out; // "new": the query's order, newest first
  }, [pen.list, statusF, vendorF, search, sort, tripsByPenalty]);
  if (!pen.ready) return <Loading text="Loading penalties" />;
  if (!pen.available) return <p className="pmvt-empty">Penalties are not set up yet (the r20_01 SQL has not been run).</p>;
  const vendors = [...new Set(pen.list.map((p) => p.vendor_name))].sort();
  const total = (s) => pen.list.filter((p) => p.status === s).reduce((a, p) => a + Number(p.amount || 0), 0);
  const active = statusF.length + vendorF.length + (sort !== "new" ? 1 : 0);
  const exportCsv = () => csvFromObjects("vendor penalties", list.map((p) => {
    const ts = tripsByPenalty[p.id] || [];
    return {
      Date: fmtDate(Date.parse(p.created_at)), Vendor: p.vendor_name, Trips: ts.length,
      Orders: [...new Set(ts.map((t) => t.order_no))].join(" "), "Days Late": p.days_late,
      Basis: p.basis === "per_day" ? "Per day" : "Fixed", "₹ per Day": p.rate_per_day ?? "", Amount: p.amount,
      Reason: p.reason, Status: STATUS_LABEL[p.status], "Status Note": p.status_note || "", "Status By": p.status_by || "", "Created By": p.created_by,
    };
  }));
  const ordersText = (ts) => { const nos = [...new Set(ts.map((t) => t.order_no))]; return `${nos.slice(0, 3).join(", ")}${ts.length > 3 ? " and more" : ""}`; };

  return (
    <>
      <ListTools search={search} onSearch={setSearch} placeholder="Search vendor, reason or order" filters={active} onFilters={() => setFiltersOpen(true)} onExport={exportCsv} exportDisabled={!list.length} />
      <div className="ceo-dstats">
        <Stat label="Pending" info="Penalties recorded and not yet settled or waived, all vendors."><b>{money(total("pending"))}</b></Stat>
        <Stat label="Settled" info="Penalties recovered from the vendor."><b>{money(total("settled"))}</b></Stat>
        <Stat label="Waived" info="Penalties let off, with a note saying why."><b>{money(total("waived"))}</b></Stat>
        <Stat label="Penalties Shown" info="Penalty records matching the search and filters."><b>{num(list.length)}</b></Stat>
      </div>
      <Paged list={list} render={(page) => (
        <Table rowKey={(p) => p.id} rows={page} empty={pen.list.length ? "No penalties match these filters." : "No penalties yet."} columns={[
          { key: "date", label: "Date", render: (p) => <DateOnly ms={Date.parse(p.created_at)} /> },
          { key: "vendor", label: "Vendor", render: (p) => <b>{p.vendor_name}</b> },
          {
            key: "trips", label: "Trips", right: true, render: (p) => {
              const ts = tripsByPenalty[p.id] || [];
              const ids = new Set(ts.map((t) => t.movement_id));
              return <Pick onClick={() => onOpenTrips(`Penalty for ${p.vendor_name}`, allTrips.filter((t) => ids.has(t.id)))}>{num(ts.length)}</Pick>;
            },
          },
          { key: "orders", label: "Orders", hide: true, render: (p) => <span className="pm-wrap">{ordersText(tripsByPenalty[p.id] || []) || "–"}</span> },
          { key: "days", label: "Days Late", right: true, hide: true, render: (p) => num(p.days_late) },
          { key: "amount", label: "Amount", right: true, render: (p) => <b>{money(p.amount)}</b> },
          { key: "basis", label: "Basis", hide: true, render: (p) => (p.basis === "per_day" ? `${money(p.rate_per_day)} per day` : "Fixed") },
          { key: "reason", label: "Reason", render: (p) => <span className="pm-wrap">{p.reason}</span> },
          { key: "status", label: "Status", render: (p) => <Tag tone={p.status === "pending" ? undefined : "soft"}>{STATUS_LABEL[p.status]}</Tag> },
          { key: "note", label: "Status Note", hide: true, render: (p) => (p.status_note ? <span className="pm-wrap">{p.status_note}</span> : <Dash />) },
          { key: "by", label: "Recorded By", hide: true, lap: true, render: (p) => p.created_by || <Dash /> },
          ...(canPenalise ? [{
            key: "act", label: "", render: (p) => (
              <span className="pmvt-acts">
                {p.status !== "settled" && <button type="button" className="pmvt-mini is-primary" onClick={() => setNoteFor({ penalty: p, to: "settled" })}>Settle</button>}
                {p.status !== "waived" && <button type="button" className="pmvt-mini" onClick={() => setNoteFor({ penalty: p, to: "waived" })}>Waive</button>}
                {p.status !== "pending" && <button type="button" className="pmvt-mini" onClick={() => setNoteFor({ penalty: p, to: "pending" })}>Reopen</button>}
              </span>
            ),
          }] : []),
        ]} />
      )} />
      <FilterDrawer open={filtersOpen} onClose={() => setFiltersOpen(false)} onClear={() => { setStatusF([]); setVendorF([]); setSort("new"); }} count={list.length} noun="penalties" sub="Narrow the penalties">
        <FilterGroup label="Sort By"><Chips options={LEDGER_SORTS} value={sort} onChange={(v) => setSort(v || "new")} /></FilterGroup>
        <FilterGroup label="Status"><Chips options={Object.entries(STATUS_LABEL).map(([k, v]) => ({ value: k, label: v }))} value={statusF} onChange={setStatusF} /></FilterGroup>
        <FilterGroup label="Vendor"><Chips options={opts(vendors)} value={vendorF} onChange={setVendorF} /></FilterGroup>
      </FilterDrawer>
      {noteFor && <StatusModal {...noteFor} onClose={() => setNoteFor(null)} onSaved={async () => { setNoteFor(null); await onChanged(); }} />}
    </>
  );
}

const STATUS_ACTION = { settled: "Settle Penalty", waived: "Waive Penalty", pending: "Reopen Penalty" };

function StatusModal({ penalty, to, onClose, onSaved }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    if (to === "waived" && !note.trim()) { setErr("A note is required to waive."); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("set_vendor_penalty_status", { p_id: penalty.id, p_status: to, p_note: note.trim() });
    setBusy(false);
    if (error || !data?.success) { setErr(error?.message || data?.message || "Could not update."); return; }
    onSaved?.();
  };
  return (
    <PmModal title={STATUS_ACTION[to]} sub={`${penalty.vendor_name} · ${money(penalty.amount)} · becomes ${STATUS_LABEL[to].toLowerCase()}`} onClose={onClose} width={460}
      footer={(
        <>
          <button type="button" className="pmx-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="pmx-btn is-primary" onClick={save} disabled={busy}>{busy ? "Saving" : "Confirm"}</button>
        </>
      )}>
      <Field label={`Note ${to === "waived" ? "(required)" : "(optional)"}`} full>
        <input type="text" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} autoFocus
          placeholder={to === "settled" ? "For example: deducted from 31 Oct payment" : to === "waived" ? "Why it is waived" : ""} />
      </Field>
      {err && <p className="pmx-error">{err}</p>}
    </PmModal>
  );
}

// ============================================================ vendor directory
const DIR_SORTS = [{ value: "new", label: "Newest first" }, { value: "name", label: "Name, A to Z" }, { value: "status", label: "Status" }];
const capital = (s) => String(s || "").replace(/^\w/, (x) => x.toUpperCase());
const stageOfVendor = (v) => v.stage_name || (v.stage_number != null ? getStepLabel(v.stage_number) : "Stage not set");

/**
 * Every vendor with its approval status, and the form to request a new one.
 * A request stays pending until Manish (COO) approves it in Vendor Approvals.
 * A vendor MUST be created with the stage it does: the Production Head's
 * movement picker only offers vendors whose stage matches the work going out.
 */
export function VendorDirectory({ ctx }) {
  const { showPopup } = ctx;
  const currentUserEmail = ctx.email;
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [stageStep, setStageStep] = useState("");
  const [all, setAll] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState("new");
  const [statusF, setStatusF] = useState([]);
  const [stageF, setStageF] = useState([]);

  const load = useCallback(async () => {
    try { setAll((await fetchAllVendors()) || []); }
    catch (e) { console.error("Failed to load vendors:", e); }
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleRequest = async () => {
    if (!name.trim()) return showPopup({ title: "Required", message: "Enter vendor name", type: "warning", confirmText: "OK" });
    if (!stageStep) return showPopup({ title: "Required", message: "Pick the stage this vendor does. Without it the vendor can't be selected for an external movement.", type: "warning", confirmText: "OK" });
    setSubmitting(true);
    try {
      await requestVendor({
        vendorName: name.trim(),
        vendorLocation: location.trim(),
        stageStep: Number(stageStep),
        requestedBy: currentUserEmail,
      });
      showPopup({ title: "Vendor Requested", message: "Sent to Manish for approval. It becomes selectable once approved.", type: "success", confirmText: "OK" });
      setName(""); setLocation(""); setStageStep("");
      load();
    } catch (e) {
      showPopup({ title: "Error", message: e.message || "Failed to request vendor", type: "error", confirmText: "OK" });
    }
    setSubmitting(false);
    return undefined;
  };

  const choices = useMemo(() => {
    const count = (keyOf) => { const m = {}; all.forEach((v) => { const k = keyOf(v); m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k]) => k); };
    return { statuses: count((v) => v.status || "unknown"), stages: count(stageOfVendor) };
  }, [all]);
  const list = useMemo(() => {
    const q = lc(search).trim();
    const out = all.filter((v) => (!statusF.length || statusF.includes(v.status || "unknown")) && (!stageF.length || stageF.includes(stageOfVendor(v)))
      && (!q || [v.vendor_name, v.vendor_location, stageOfVendor(v)].some((x) => lc(x).includes(q))));
    if (sort === "name") out.sort((a, b) => String(a.vendor_name || "").localeCompare(String(b.vendor_name || "")));
    else if (sort === "status") out.sort((a, b) => String(a.status || "").localeCompare(String(b.status || "")) || String(a.vendor_name || "").localeCompare(String(b.vendor_name || "")));
    return out; // "new": the query's order, newest first
  }, [all, search, statusF, stageF, sort]);
  const active = statusF.length + stageF.length + (sort !== "new" ? 1 : 0);
  const exportCsv = () => csvFromObjects("vendors", list.map((v) => ({
    Vendor: v.vendor_name || "", Location: v.vendor_location || "", Stage: stageOfVendor(v), Status: capital(v.status),
    "Requested By": v.requested_by || "", "Added On": v.created_at ? fmtDate(v.created_at) : "",
  })));
  const count = (s) => all.filter((v) => v.status === s).length;

  return (
    <>
      <div className="ceo-grid">
        <Card span={12} title="Request a New Vendor" sub="Requests need Manish's approval before Production Heads can pick the vendor.">
          <div className="pmx-grid pmvt-form">
            <Field label="Vendor Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Premium Dyeing Co." /></Field>
            <Field label="Location"><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="For example: Ludhiana" /></Field>
            <Field label="Stage">
              <select value={stageStep} onChange={(e) => setStageStep(e.target.value)}>
                <option value="">Choose the stage this vendor does</option>
                {EXTERNAL_ELIGIBLE_STEPS.map((s) => <option key={s.step} value={String(s.step)}>{s.label}</option>)}
              </select>
            </Field>
            <div className="pmvt-form-go">
              <button type="button" className="ceo-btn is-primary" onClick={handleRequest} disabled={submitting}>{submitting ? "Requesting" : "Request Vendor"}</button>
            </div>
          </div>
        </Card>
      </div>
      <ListTools search={search} onSearch={setSearch} placeholder="Search vendor, location or stage" filters={active} onFilters={() => setFiltersOpen(true)} onExport={exportCsv} exportDisabled={!list.length} />
      <div className="ceo-dstats">
        <Stat label="All Vendors" info="Every vendor on record, whatever its status."><b>{num(all.length)}</b></Stat>
        <Stat label="Approved" info="Vendors Production Heads can pick when sending a piece out."><b>{num(count("approved"))}</b></Stat>
        <Stat label="Waiting Approval" info="Requested and waiting for Manish to approve."><b className={count("pending") ? "is-warn" : undefined}>{num(count("pending"))}</b></Stat>
        <Stat label="Shown" info="Vendors matching the search and filters."><b>{num(list.length)}</b></Stat>
      </div>
      {!loaded ? <Loading text="Loading vendors" /> : (
        <Paged list={list} render={(page) => (
          <Table rowKey={(v) => v.id} rows={page} empty={all.length ? "No vendors match these filters." : "No vendors yet."} columns={[
            { key: "name", label: "Vendor", render: (v) => <b>{v.vendor_name}</b> },
            { key: "loc", label: "Location", render: (v) => v.vendor_location || <Dash /> },
            { key: "stage", label: "Stage", render: (v) => (v.stage_name || v.stage_number != null ? stageOfVendor(v) : <span className="pm-late">Stage not set</span>) },
            { key: "status", label: "Status", render: (v) => <Tag tone={v.status === "rejected" ? "urgent" : v.status === "pending" ? "soft" : undefined}>{capital(v.status)}</Tag> },
            { key: "by", label: "Requested By", hide: true, render: (v) => v.requested_by || <Dash /> },
            { key: "on", label: "Added On", right: true, hide: true, render: (v) => <DateOnly ms={v.created_at ? Date.parse(v.created_at) : null} /> },
          ]} />
        )} />
      )}
      <FilterDrawer open={filtersOpen} onClose={() => setFiltersOpen(false)} onClear={() => { setStatusF([]); setStageF([]); setSort("new"); }} count={list.length} noun="vendors" sub="Narrow the vendor list">
        <FilterGroup label="Sort By"><Chips options={DIR_SORTS} value={sort} onChange={(v) => setSort(v || "new")} /></FilterGroup>
        <FilterGroup label="Status"><Chips options={choices.statuses.map((s) => ({ value: s, label: capital(s) }))} value={statusF} onChange={setStatusF} /></FilterGroup>
        <FilterGroup label="Stage"><Chips options={opts(choices.stages)} value={stageF} onChange={setStageF} /></FilterGroup>
      </FilterDrawer>
    </>
  );
}
