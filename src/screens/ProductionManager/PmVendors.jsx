import React, { useEffect, useMemo, useState } from "react";
import { fmtDate as formatDate } from "./pmModel";
import { Chips, Empty, FilterButton, FilterGroup, Insight, PageHead, Seg, num } from "../CeoDashboard/CeoUi";
import { FilterDrawer, defineKit } from "../CeoDashboard/dashKit";
import { CARD_INFO, COLUMN_INFO, TILE_INFO } from "./pmDefinitions";
import { csvFromObjects, Loading } from "./PmCommon";
import { DAY, isOwnTrip, localDay, pct, plural } from "./pmModel";
import { VendorTripsList } from "./PmRecords";
import { VendorDelays, VendorDirectory } from "./PmVendorTools";
import { GOLD, StackBars } from "./PmQuality";

// ============================================================
// Vendors: who has our pieces, who brings them back on time, and the three
// old vendor tabs (pieces at vendors, delays and penalties, the directory)
// underneath, unchanged. Penalties stay visible, as asked.
//
// Worked out from external_movements (one row per trip):
//   sent     the trip has a gate exit scan (a trip only set up is not counted)
//   out now  scanned out and not back yet
//   overdue  out now and past the return date set when it was sent
//   on time  came back on or before that return date (calendar days)
// ============================================================

const LOCAL_TILES = {
  "At Vendors Now": "Pieces out with an outside vendor right now: sent out at the gate and not yet scanned back in. This includes pieces of orders that are already closed but whose return was never scanned, so it can be a little higher than the Today page, which counts running orders only.",
  "Overdue at Vendors": "Pieces still out after the return date set when they were sent.",
  "Returned": "Trips that came back through the gate in the period.",
  "Returned On Time": "Share of trips back in the period that came back on or before their return date.",
  "Repeat Sends": "Trips in the period where a piece went back to a vendor it had already been to, usually to fix something.",
  "Vendors Used": "Different vendors that had at least one piece sent to them in the period.",
};
const LOCAL_CARDS = {
  "Vendor Scorecard": "One row per vendor for the period: trips sent, pieces out and overdue now, trips back, the share back on time, the average days a piece was away, and repeat sends. Click a vendor to see its pieces.",
  "Out Now by Vendor": "Pieces at each vendor right now, split into within the return date and overdue. Click a bar to see the pieces.",
  "Overdue Right Now": "Pieces still out after their return date, longest overdue first. Click a row to open the order.",
  "Days Away by Stage": "Average days a piece spent at the vendor, by the stage it was sent for, for trips that came back in the period.",
};
const { Tile, Card, Table } = defineKit({ tiles: { ...TILE_INFO, ...LOCAL_TILES }, cards: { ...CARD_INFO, ...LOCAL_CARDS }, columns: COLUMN_INFO });

const SORTS = [
  { value: "out", label: "Most pieces out now" }, { value: "overdue", label: "Most overdue" }, { value: "sent", label: "Most trips sent" },
  { value: "ontime", label: "Lowest on time" }, { value: "away", label: "Longest away" }, { value: "name", label: "Name, A to Z" },
];
const stageOfTrip = (m) => (m.stageLabel && m.stageLabel !== "—" ? m.stageLabel : "Not recorded");
const vendorOf = (m) => (m.vendor_name || "Unknown vendor").trim();
const sentAt = (m) => m.exit_scan_at || null;
const daysAway = (m) => (m.exit_scan_at && m.entry_scan_at ? Math.max(0, Math.round((localDay(m.entry_scan_at) - localDay(m.exit_scan_at)) / DAY)) : null);
const backOnTime = (m) => (m.return_date && m.entry_scan_at ? localDay(m.entry_scan_at) <= localDay(m.return_date) : null);
const one = (v) => (Math.round(v * 10) / 10).toLocaleString("en-IN");

export default function VendorsPage({ ctx }) {
  const { lazy, need, piecesById, ordersById, openPieces, openOrder, period } = ctx;
  const [view, setView] = useState("out");
  const [drawer, setDrawer] = useState(false);
  const [vendorF, setVendorF] = useState([]);
  const [stageF, setStageF] = useState([]);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [sort, setSort] = useState("out");
  const filterCount = (vendorF.length ? 1 : 0) + (stageF.length ? 1 : 0) + (overdueOnly ? 1 : 0) + (sort !== "out" ? 1 : 0);
  useEffect(() => { need("movements"); }, [need]);
  const moves = lazy.movements?.rows;
  const onOrderClick = (id) => ordersById[id] && openOrder(ordersById[id]);

  const piecesOf = (list) => [...new Set(list.map((m) => m.component_id).filter(Boolean))].map((id) => piecesById[id]).filter(Boolean);
  const openTrips = (title, sub, list) => openPieces({ title, sub, pieces: piecesOf(list) });

  const data = useMemo(() => {
    if (!moves) return null;
    // Outside vendors only: trips to our own SB WH Delhi (2) are not vendor work.
    const ownTrips = moves.filter(isOwnTrip);
    const ownOut = new Set(ownTrips.filter((m) => m.isOut).map((m) => m.component_id)).size;
    const inP = period.inP;
    const outside = moves.filter((m) => !isOwnTrip(m) && (!vendorF.length || vendorF.includes(vendorOf(m))) && (!stageF.length || stageF.includes(stageOfTrip(m))));
    const outNow = outside.filter((m) => m.isOut);
    const overdue = outNow.filter((m) => m.overdue).sort((a, b) => b.daysOverdue - a.daysOverdue);
    const sent = outside.filter((m) => inP(sentAt(m)));
    const back = outside.filter((m) => m.status === "returned" && inP(m.entry_scan_at));
    const timed = back.filter((m) => backOnTime(m) != null);
    const onTime = timed.filter((m) => backOnTime(m));
    const repeats = sent.filter((m) => m.isRepeat);

    const by = {};
    const row = (name) => by[name] || (by[name] = { name, sent: [], out: [], overdue: [], back: [], timed: 0, onTime: 0, away: [], repeats: [] });
    sent.forEach((m) => { const r = row(vendorOf(m)); r.sent.push(m); if (m.isRepeat) r.repeats.push(m); });
    outNow.forEach((m) => { const r = row(vendorOf(m)); r.out.push(m); if (m.overdue) r.overdue.push(m); });
    back.forEach((m) => {
      const r = row(vendorOf(m));
      r.back.push(m);
      const ok = backOnTime(m);
      if (ok != null) { r.timed += 1; if (ok) r.onTime += 1; }
      const d = daysAway(m);
      if (d != null) r.away.push(d);
    });
    const vendors = Object.values(by).map((r) => ({
      ...r,
      onTimePct: r.timed ? pct(r.onTime, r.timed) : null,
      avgAway: r.away.length ? r.away.reduce((s, v) => s + v, 0) / r.away.length : null,
    }));
    const byOut = (a, b) => b.out.length - a.out.length || b.sent.length - a.sent.length;
    const SORT_FN = {
      out: byOut,
      overdue: (a, b) => b.overdue.length - a.overdue.length || byOut(a, b),
      sent: (a, b) => b.sent.length - a.sent.length || byOut(a, b),
      ontime: (a, b) => (a.onTimePct ?? 101) - (b.onTimePct ?? 101) || byOut(a, b),
      away: (a, b) => (b.avgAway ?? -1) - (a.avgAway ?? -1) || byOut(a, b),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    vendors.sort(SORT_FN[sort] || byOut);
    const shown = overdueOnly ? vendors.filter((v) => v.overdue.length) : vendors;

    const outBars = [...vendors].sort(byOut).filter((v) => v.out.length).slice(0, 10)
      .map((v) => ({ name: v.name, within: v.out.length - v.overdue.length, overdue: v.overdue.length, v }));

    const stage = {};
    back.forEach((m) => {
      const d = daysAway(m);
      if (d == null) return;
      const k = stageOfTrip(m);
      (stage[k] || (stage[k] = { name: k, list: [], days: [] })).list.push(m);
      stage[k].days.push(d);
    });
    const byStage = Object.values(stage).map((s) => ({ name: s.name, avg: Math.round((s.days.reduce((a, b) => a + b, 0) / s.days.length) * 10) / 10, list: s.list, n: s.list.length }))
      .sort((a, b) => b.avg - a.avg);

    // Pieces, not trips: a piece can have more than one open trip on record.
    const distinct = (list) => new Set(list.map((m) => m.component_id || `m${m.id}`)).size;
    return { ownOut, outNow, overdue, outPieces: distinct(outNow), overduePieces: distinct(overdue), sent, back, timed, onTime, repeats, vendors, shown, outBars, byStage, used: vendors.filter((v) => v.sent.length).length };
  }, [moves, period, vendorF, stageF, sort, overdueOnly]);

  // Filter choices from the trips on record: vendors with the most trips first.
  const choices = useMemo(() => {
    const count = (keyOf) => { const m = {}; (moves || []).filter((x) => !isOwnTrip(x)).forEach((x) => { const k = keyOf(x); m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k]) => ({ value: k, label: k })); };
    return { vendors: count(vendorOf).slice(0, 30), stages: count(stageOfTrip) };
  }, [moves]);

  const label = period.label;
  const exportScorecard = () => csvFromObjects(`vendor scorecard ${label}`, data.shown.map((v) => ({
    Vendor: v.name, "Trips Sent": v.sent.length, "Out Now": v.out.length, "Overdue Now": v.overdue.length, Returned: v.back.length,
    "Returned On Time %": v.onTimePct ?? "", "Average Days Away": v.avgAway == null ? "" : one(v.avgAway), "Repeat Sends": v.repeats.length,
  })));
  const exportOverdue = () => csvFromObjects("overdue at vendors", data.overdue.map((m) => ({
    "Order No": m.order_no, Barcode: m.barcode, Vendor: vendorOf(m), Stage: m.stageLabel, Sent: m.exit_scan_at ? formatDate(m.exit_scan_at) : "",
    "Return Date": m.return_date ? formatDate(m.return_date) : "", "Days Overdue": m.daysOverdue,
  })));
  const OUT_SERIES = [{ key: "within", name: "Within return date", color: GOLD[2] }, { key: "overdue", name: "Overdue", color: GOLD[0] }];

  return (
    <div className="ceo-page">
      <PageHead title="Vendors" desc="Which vendors have our pieces, who brings them back on time, and every trip, delay and penalty.">
        <FilterButton count={filterCount} onClick={() => setDrawer(true)} />
      </PageHead>
      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} count={data ? data.shown.length : 0} noun="vendors" sub="Narrow every figure on this page"
        onClear={() => { setVendorF([]); setStageF([]); setOverdueOnly(false); setSort("out"); }}>
        <FilterGroup label="Sort the Scorecard By"><Chips options={SORTS} value={sort} onChange={(v) => setSort(v || "out")} /></FilterGroup>
        <FilterGroup label="Show"><Chips options={[{ value: "overdue", label: "Vendors with overdue pieces" }]} value={overdueOnly ? "overdue" : ""} onChange={(v) => setOverdueOnly(v === "overdue")} /></FilterGroup>
        <FilterGroup label="Sent For"><Chips options={choices.stages} value={stageF} onChange={setStageF} /></FilterGroup>
        <FilterGroup label="Vendor"><Chips options={choices.vendors} value={vendorF} onChange={setVendorF} /></FilterGroup>
      </FilterDrawer>
      {!data ? <section className="ceo-card">{lazy.movements?.error ? <Empty text={`Vendor trips could not be loaded: ${lazy.movements.error}`} /> : <Loading text="Loading vendor trips" />}</section> : (
        <>
          <div className="ceo-tiles">
            <Tile icon="warehouse" label="At Vendors Now" value={num(data.outPieces)} note={`Outside vendors · ${num(data.ownOut)} more at our Delhi (2)`} onClick={() => openTrips("At Vendors Now", "Out with an outside vendor", data.outNow)} />
            <Tile icon="alert" tone={data.overdue.length ? "warn" : undefined} label="Overdue at Vendors" value={num(data.overduePieces)} note={`${pct(data.overduePieces, data.outPieces)}% of pieces out`} onClick={() => openTrips("Overdue at Vendors", "Past the return date", data.overdue)} />
            <Tile icon="receive" label="Returned" value={num(data.back.length)} note={label} onClick={() => openTrips("Back from Vendors", label, data.back)} />
            <Tile icon="sale" label="Returned On Time" value={data.timed.length ? `${pct(data.onTime.length, data.timed.length)}%` : "–"} note={`${num(data.onTime.length)} of ${num(data.timed.length)} trips`} onClick={() => openTrips("Back Late", `${label}: came back after the return date`, data.timed.filter((m) => !backOnTime(m)))} />
            <Tile icon="refresh" label="Repeat Sends" value={num(data.repeats.length)} note={label} onClick={() => openTrips("Repeat Sends", "Sent back to a vendor it had already been to", data.repeats)} />
          </div>

          <div className="ceo-grid">
            {(
              <Card span={12} title="What This Says">
                <div className="pmq-insights">
                  <Insight>This page covers outside vendors only. <b>{num(data.ownOut)}</b> more pieces are at our own SB WH Delhi (2); they count as on the floor (see Floor &amp; Flow).</Insight>
                  {data.overdue.length > 0 && <Insight tone="warn"><b>{plural(data.overdue.length, "piece")}</b> {data.overdue.length === 1 ? "is" : "are"} past the return date; the longest has been overdue for {plural(data.overdue[0].daysOverdue, "day")} at {vendorOf(data.overdue[0])}.</Insight>}
                  {(() => {
                    const worst = data.vendors.filter((v) => v.timed >= 5 && v.onTimePct != null).sort((a, b) => a.onTimePct - b.onTimePct)[0];
                    return worst ? <Insight tone={worst.onTimePct < 70 ? "warn" : "gold"}>Of vendors with at least 5 trips back, <b>{worst.name}</b> has the lowest on-time return: {worst.onTimePct}% ({label.toLowerCase()}).</Insight> : null;
                  })()}
                  <Insight>{plural(data.used, "vendor")} had pieces sent to them ({label.toLowerCase()}); {plural(data.sent.length, "trip")} in all.</Insight>
                </div>
              </Card>
            )}

            <Card span={12} title="Vendor Scorecard" sub={`${label}; out now and overdue are live. Sorted by ${SORTS.find((s) => s.value === sort).label.toLowerCase()}. Click a vendor to see its pieces.`}>
              <Table rowKey={(r) => r.name} rows={data.shown} empty="No vendor trips in this period."
                onRow={(v) => (v.out.length ? openTrips(`At ${v.name} Now`, "Out with this vendor", v.out) : openTrips(`Sent to ${v.name}`, label, v.sent.length ? v.sent : v.back))}
                columns={[
                  { key: "name", label: "Vendor", render: (v) => <span className="pm-cell"><b>{v.name}</b>{v.overdue.length > 0 && <small className="pm-late">{plural(v.overdue.length, "piece")} overdue</small>}</span> },
                  { key: "sent", label: "Trips Sent", right: true, render: (v) => num(v.sent.length) },
                  { key: "out", label: "Out Now", right: true, render: (v) => num(v.out.length) },
                  { key: "back", label: "Returned", right: true, hide: true, render: (v) => num(v.back.length) },
                  { key: "ontime", label: "On Time", right: true, render: (v) => (v.onTimePct == null ? "–" : `${v.onTimePct}%`) },
                  { key: "away", label: "Avg Days Away", right: true, hide: true, render: (v) => (v.avgAway == null ? "–" : one(v.avgAway)) },
                  { key: "rep", label: "Repeat Sends", right: true, lap: true, render: (v) => num(v.repeats.length) },
                ]} />
              {data.vendors.length > 0 && <div className="gm-actions pmv-under"><button type="button" className="ceo-btn" onClick={exportScorecard}>Export CSV</button></div>}
            </Card>

            <Card span={7} md={12} title="Out Now by Vendor" sub="The 10 vendors holding the most pieces; the total is above each bar">
              <StackBars data={data.outBars} series={OUT_SERIES} height={270}
                onPick={(b, key) => { const r = data.outBars.find((x) => x.name === b.name); if (r) openTrips(`${r.name}: ${key === "overdue" ? "Overdue" : "Out Now"}`, "Live", key === "overdue" ? r.v.overdue : r.v.out); }} />
              <div className="pmq-legend">{OUT_SERIES.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.name}</span>)}</div>
            </Card>

            <Card span={5} md={12} title="Days Away by Stage" sub={`Average days at the vendor, trips back (${label.toLowerCase()})`}>
              <StackBars data={data.byStage.slice(0, 8).map((s) => ({ name: s.name, avg: s.avg, s }))} series={[{ key: "avg", name: "Average days away", color: GOLD[1] }]} height={270} format={one}
                onPick={(b) => { const s = data.byStage.find((x) => x.name === b.name); if (s) openTrips(`Back from ${s.name}`, `${plural(s.n, "trip")}, ${one(s.avg)} days on average`, s.list); }} />
            </Card>

            <Card span={12} title="Overdue Right Now" sub="Longest overdue first. Click a row to open the order.">
              <Table rowKey={(m) => m.id} rows={data.overdue.slice(0, 10)} onRow={(m) => onOrderClick(m.order_id)} empty="Nothing is overdue at a vendor." columns={[
                { key: "piece", label: "Piece", render: (m) => <span className="pm-cell"><b><span className="pm-code">{m.barcode || "–"}</span></b><small>{m.order_no}</small></span> },
                { key: "vendor", label: "Vendor", render: (m) => <span className="pm-cell"><b>{vendorOf(m)}</b><small>{m.stageLabel}</small></span> },
                { key: "sent", label: "Sent", right: true, hide: true, render: (m) => (m.exit_scan_at ? formatDate(m.exit_scan_at) : "–") },
                { key: "due", label: "Overdue", right: true, render: (m) => <span className="pm-cell is-right"><b className="pm-late">{plural(m.daysOverdue || 0, "day")}</b><small>Due {m.return_date ? formatDate(m.return_date) : "–"}</small></span> },
              ]} />
              {data.overdue.length > 0 && (
                <div className="gm-actions pmv-under">
                  {data.overdue.length > 10 && <button type="button" className="ceo-btn" onClick={() => openTrips("Overdue at Vendors", "Past the return date", data.overdue)}>See all {num(data.overdue.length)}</button>}
                  <button type="button" className="ceo-btn" onClick={exportOverdue}>Export CSV</button>
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      <div className="pm-tabs-scroll pmq-tabs">
        <Seg label="Vendor records" value={view} onChange={setView} options={[{ value: "out", label: "Trips" }, { value: "delays", label: "Delays & Penalties" }, { value: "directory", label: "Directory" }]} />
      </div>
      {view === "out" && <section className="ceo-card pm-records"><VendorTripsList ctx={ctx} rows={moves} loading={!moves} /></section>}
      {view !== "out" && <section className="ceo-card pm-records">
        {view === "delays" && <VendorDelays ctx={ctx} moves={moves} />}
        {view === "directory" && <VendorDirectory ctx={ctx} />}
      </section>}
    </div>
  );
}
