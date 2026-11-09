import React, { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getStageLabel } from "../../utils/barcodeService";
import { Chips, Empty, FilterButton, FilterGroup, Insight, PageHead, RankBars, Seg, barAxis, barMinWidth, fitBarLabel, labelRoom, num, textOn } from "../CeoDashboard/CeoUi";
import { FilterDrawer, defineKit } from "../CeoDashboard/dashKit";
import { CARD_INFO, COLUMN_INFO, TILE_INFO } from "./pmDefinitions";
import { csvFromObjects, Loading } from "./PmCommon";
import { channelOf, pct, plural, todayStart } from "./pmModel";
import { QcHistoryList, ReworkList } from "./PmRecords";
import { coverKey, periodSteps } from "./pmPeriod";

// ============================================================
// Quality: QC checks, failures, re-work and overrides, worked out from
// qc_records. The full QC History and the pieces in re-work (the old tabs)
// sit underneath, unchanged.
//
// One rule everywhere: a Final QC override is not an inspection, so it is left
// out of both sides of the pass rate (the same rule as the QC History tab).
// ============================================================

const LOCAL_TILES = {
  "QC Checks": "QC inspections recorded in the period, at QC 1 and Final QC. Overrides are not counted because nobody inspected the garment.",
  Failures: "QC checks in the period that failed.",
  "Re-work Passes": "Failed pieces sent back to an earlier stage to be fixed, in the period.",
  "Final QC Overrides": "Pieces marked complete without passing Final QC, in the period. Each one is recorded against the person who did it.",
  Disposed: "Failed pieces taken off the floor to be remade from fresh cloth, in the period.",
};
const LOCAL_CARDS = {
  "Pass Rate Over Time": "Share of QC checks that passed, per day (7 days) or per week (30 and 90 days). Overrides are left out.",
  "Why Pieces Fail": "Failure reasons as the inspector recorded them at the scan station. Click a reason to see the pieces.",
  "Where Failed Pieces Went Back To": "The stage a failed piece was sent back to for re-work. Click a stage to see the pieces.",
  "QC 1 and Final QC": "Checks and failures at each of the two QC points.",
  Inspectors: "Checks each inspector recorded in the period and how many failed. Click a row to see that inspector's failed pieces.",
  "Pieces Failing More Than Once": "Pieces that failed QC two or more times in the period. Click a row to open the order.",
};
const { Tile, Card, Table } = defineKit({ tiles: { ...TILE_INFO, ...LOCAL_TILES }, cards: { ...CARD_INFO, ...LOCAL_CARDS }, columns: COLUMN_INFO });

export const PERIODS = [{ value: "7", label: "Last 7 Days" }, { value: "30", label: "Last 30 Days" }, { value: "90", label: "Last 90 Days" }];
/** Start of a "last N days" window (today included). */
export const windowStart = (days) => { const d = todayStart(); d.setDate(d.getDate() - (Number(days) - 1)); return d; };
export const GOLD = ["#6a4f0c", "#a9821f", "#cfae4e", "#e6d18f"];
const axis = { fontSize: 11, fill: "#8a8478" };

const Tip = ({ active, payload, label, format = num }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="ceo-tip">
      <b>{label}</b>
      {payload.filter((p) => p.value != null).map((p) => <span key={p.dataKey}><i style={{ background: p.fill || p.color }} />{p.name}: {format(p.value)}</span>)}
    </div>
  );
};

/**
 * Bars with their numbers on them. One series, or several stacked: each
 * segment's count inside it when it fits, and the stack total above.
 * onPick(row, seriesKey) when a bar is clicked.
 */
export function StackBars({ data, series, height = 260, format = num, onPick, stacked = true }) {
  if (!data?.length || !data.some((d) => series.some((s) => Number(d[s.key]) > 0))) return <Empty />;
  const last = series.length - 1;
  const totals = data.map((d) => (stacked ? series.reduce((sum, x) => sum + (Number(d[x.key]) || 0), 0) : Math.max(...series.map((x) => Number(d[x.key]) || 0))));
  const inside = (color) => ({ x, y, width, height: h, value }) => (
    value && h >= 16 && width >= 18 && series.length > 1
      ? <text x={x + width / 2} y={y + h / 2} dy="0.35em" textAnchor="middle" fontSize={10.5} fontWeight={600} fill={textOn(color)} pointerEvents="none">{format(value)}</text>
      : null
  );
  return (
    <div className="ceo-chart-scroll">
    <div style={{ width: "100%", minWidth: barMinWidth(data.length), height, cursor: onPick ? "pointer" : undefined }}>
      <ResponsiveContainer initialDimension={{ width: 1, height: 1 }}>
        <BarChart data={data} margin={{ top: labelRoom(totals, format), right: 6, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#f1ede2" vertical={false} />
          <XAxis dataKey="name" axisLine={false} tickLine={false} {...barAxis(data.length)} />
          <YAxis tick={axis} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
          <Tooltip content={<Tip format={format} />} cursor={{ fill: "rgba(184,146,46,.07)" }} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} stackId={stacked ? "a" : undefined} fill={s.color} maxBarSize={44}
              radius={!stacked || i === last ? [6, 6, 0, 0] : [0, 0, 0, 0]} isAnimationActive={false}
              onClick={onPick ? (bar) => onPick(bar?.payload || bar, s.key) : undefined}>
              {series.length > 1 && stacked && <LabelList dataKey={s.key} content={inside(s.color)} />}
              {(!stacked || i === last) && (
                <LabelList
                  dataKey={stacked ? (d) => series.reduce((sum, x) => sum + (Number(d[x.key]) || 0), 0) : s.key}
                  content={fitBarLabel(format, totals)}
                />
              )}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
    </div>
  );
}

/** A small colour key under a chart. */
export const Legend = ({ series }) => (
  <div className="pmq-legend">{series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.name}</span>)}</div>
);

// Fail reasons are typed freely, often in Hinglish and often naming several
// problems at once ("Kurta front fabric Issue / stain", "Dhoti ki jagah salwar
// banwa diya"). Each reason is matched to every type of problem it mentions.
const FAIL_TYPES = [
  { name: "Wrong item, colour or design", test: /ki jagah|jagah|manga|wrong (colou?r|design|fabric)|made in wrong|wrong ban|bana tha|wrong colour/ },
  { name: "Embroidery or handwork", test: /embroid|\bemb\b|hand alt|zari|sequin|motif|dabka|gota/ },
  { name: "Dyeing or colour", test: /d[iy]+[ei]?ing|dyeing|dinging|colou?r (fade|bleed|mismatch)|fade|bleed|mismatch|printing|shade/ },
  { name: "Stains, marks or dry cleaning", test: /stain|mark|chapa|dry ?clean/ },
  { name: "Fabric", test: /fabric|febric|fata|line issue|\bsath\b|torn|hole/ },
  { name: "Measurement or fit", test: /measur|length|waist|hip|bust|mori|crotch|neck depth|neckline|armhole|bicep|size|lous|losing|lehenga issue|\d+(\.\d+)?\s*-\s*\(?\d/ },
];
/** Every type of problem a fail reason mentions ("Other" when none is recognised). */
export const failTypes = (reason) => {
  const r = String(reason || "").toLowerCase();
  if (!r.trim()) return ["No reason given"];
  const hits = FAIL_TYPES.filter((t) => t.test.test(r)).map((t) => t.name);
  return hits.length ? hits : ["Other"];
};
const pct1 = (a, b) => (b ? (Math.round((a / b) * 1000) / 10).toLocaleString("en-IN") : "0");

const inspected = (r) => r.is_override !== true;
const failed = (r) => inspected(r) && r.result === "fail";

export default function QualityPage({ ctx }) {
  const { lazy, need, piecesById, ordersById, openPieces, openOrder, period } = ctx;
  const [view, setView] = useState("history");
  const [drawer, setDrawer] = useState(false);
  const [points, setPoints] = useState([]);
  const [channels, setChannels] = useState([]);
  const [who, setWho] = useState([]);
  const [pieceKinds, setPieceKinds] = useState([]);
  // The checks for the chosen range and the same number of days before it.
  const qcKey = coverKey("qc", period.reach);
  useEffect(() => { need(qcKey); need("qcAll"); need("rejourneys"); }, [need, qcKey]);
  const loaded = lazy[qcKey]?.rows;
  const chanOf = (r) => (ordersById[r.order_id] ? channelOf(ordersById[r.order_id]) : "Not known");
  const kindOf = (r) => { const c = piecesById[r.component_id]; return c ? (c.component_type || "Piece").replace(/^\w/, (x) => x.toUpperCase()) : "Not known"; };
  const pointOf = (r) => (r.which_qc === "final" ? "final" : "qc1");
  // Filter choices come from the checks themselves.
  const choices = useMemo(() => {
    const list = (loaded || []).filter((r) => period.inP(r.created_at));
    const count = (keyOf) => { const m = {}; list.forEach((r) => { const k = keyOf(r); m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k]) => ({ value: k, label: k })); };
    return { channels: count(chanOf), inspectors: count((r) => r.inspected_by || "Not recorded").slice(0, 20), kinds: count(kindOf) };
  }, [loaded, period, ordersById, piecesById]); // eslint-disable-line react-hooks/exhaustive-deps
  const filterCount = (points.length ? 1 : 0) + (channels.length ? 1 : 0) + (who.length ? 1 : 0) + (pieceKinds.length ? 1 : 0);
  const all = useMemo(() => loaded && loaded.filter((r) => (!points.length || points.includes(pointOf(r)))
    && (!channels.length || channels.includes(chanOf(r)))
    && (!who.length || who.includes(r.inspected_by || "Not recorded"))
    && (!pieceKinds.length || pieceKinds.includes(kindOf(r)))), [loaded, points, channels, who, pieceKinds, ordersById, piecesById]); // eslint-disable-line react-hooks/exhaustive-deps

  const piecesOf = (rows) => [...new Set(rows.map((r) => r.component_id).filter(Boolean))].map((id) => piecesById[id]).filter(Boolean);
  const openRows = (title, sub, rows) => openPieces({ title, sub, pieces: piecesOf(rows) });

  const data = useMemo(() => {
    if (!all) return null;
    const rows = all.filter((r) => period.inP(r.created_at));
    // The same number of days just before, for comparison.
    const prev = all.filter((r) => period.prev.inP(r.created_at));
    const checks = rows.filter(inspected);
    const fails = rows.filter(failed);
    const rework = fails.filter((r) => r.outcome === "rework");
    const disposed = fails.filter((r) => r.outcome === "dispose");
    const overrides = rows.filter((r) => r.is_override === true);
    const rate = checks.length ? ((checks.length - fails.length) / checks.length) * 100 : null;
    const prevChecks = prev ? prev.filter(inspected) : [];
    const prevRate = prevChecks.length ? ((prevChecks.length - prevChecks.filter(failed).length) / prevChecks.length) * 100 : null;

    // Pass rate per day, week or month across the range, oldest first.
    const { step, steps } = periodSteps(period);
    const buckets = steps.map((b) => {
      const inB = checks.filter((r) => { const t = new Date(r.created_at); return t >= b.from && t < b.to; });
      const f = inB.filter(failed).length;
      return { name: b.name, full: b.full, passed: inB.length - f, failed: f, rate: inB.length ? Math.round(((inB.length - f) / inB.length) * 100) : 0, rows: inB };
    });

    const group = (list, keyOf) => {
      const m = {};
      list.forEach((r) => { const k = keyOf(r); (m[k] || (m[k] = { name: k, value: 0, rows: [] })).rows.push(r); m[k].value += 1; });
      return Object.values(m).sort((a, b) => b.value - a.value);
    };
    const reasons = group(fails, (r) => (r.fail_reason || "").trim() || "Not given");
    const typeMap = {};
    fails.forEach((r) => failTypes(r.fail_reason).forEach((k) => { (typeMap[k] || (typeMap[k] = { name: k, value: 0, rows: [] })).rows.push(r); typeMap[k].value += 1; }));
    const types = Object.values(typeMap).sort((a, b) => (a.name === "Other") - (b.name === "Other") || b.value - a.value);
    const backTo = group(fails.filter((r) => r.rejourney_to_stage), (r) => getStageLabel(r.rejourney_to_stage).replace(/ In-Progress$/, ""));
    const qcPoints = ["qc1", "final"].map((k) => {
      const c = checks.filter((r) => (r.which_qc === "final" ? "final" : "qc1") === k);
      const f = c.filter(failed);
      return { name: k === "final" ? "Final QC" : "QC 1", passed: c.length - f.length, failed: f.length, rows: c, fails: f };
    });
    const inspectors = group(checks, (r) => r.inspected_by || "Not recorded").map((g) => {
      const f = g.rows.filter(failed);
      return { ...g, fails: f, failPct: pct(f.length, g.value) };
    });
    const repeat = group(fails.filter((r) => r.component_id), (r) => r.component_id)
      .filter((g) => g.value > 1)
      .map((g) => ({ id: g.name, count: g.value, rows: g.rows, piece: piecesById[g.name], order_id: g.rows[0].order_id, order_no: g.rows[0].order_no, barcode: g.rows[0].barcode, reasons: [...new Set(g.rows.map((r) => (r.fail_reason || "").trim()).filter(Boolean))] }));
    return { rows, checks, fails, rework, disposed, overrides, rate, prevRate, buckets, reasons, types, backTo, qcPoints, inspectors, repeat, step };
  }, [all, period, piecesById]);

  const label = period.label;
  const PASSFAIL = [{ key: "passed", name: "Passed", color: GOLD[1] }, { key: "failed", name: "Failed", color: GOLD[3] }];

  return (
    <div className="ceo-page">
      <PageHead title="Quality" desc="QC checks, why pieces fail, and where they go back to. Click any figure to see the pieces behind it.">
        <FilterButton count={filterCount} onClick={() => setDrawer(true)} />
      </PageHead>
      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} onClear={() => { setPoints([]); setChannels([]); setWho([]); setPieceKinds([]); }}
        count={data ? data.checks.length : 0} noun="QC checks" sub={`Narrow the QC checks, ${label.toLowerCase()}`}>
        <FilterGroup label="Check Point"><Chips options={[{ value: "qc1", label: "QC 1" }, { value: "final", label: "Final QC" }]} value={points} onChange={setPoints} /></FilterGroup>
        <FilterGroup label="Piece"><Chips options={choices.kinds} value={pieceKinds} onChange={setPieceKinds} /></FilterGroup>
        <FilterGroup label="Channel"><Chips options={choices.channels} value={channels} onChange={setChannels} /></FilterGroup>
        <FilterGroup label="Checked By"><Chips options={choices.inspectors} value={who} onChange={setWho} /></FilterGroup>
      </FilterDrawer>
      {!data ? <section className="ceo-card">{lazy[qcKey]?.error ? <Empty text={`QC records could not be loaded: ${lazy[qcKey].error}`} /> : <Loading text="Loading QC records" />}</section> : (
        <>
          <div className="ceo-tiles">
            <Tile icon="integrity" label="QC Checks" value={num(data.checks.length)} note={label} onClick={() => openRows("QC Checks", label, data.checks)} />
            <Tile icon="sale" label="QC Pass Rate" value={data.rate == null ? "–" : `${data.rate.toFixed(1)}%`} delta={data.rate != null && data.prevRate != null ? data.rate - data.prevRate : null} note={data.prevRate != null ? "points vs the period before" : label} onClick={() => openRows("Passed QC", label, data.checks.filter((r) => !failed(r)))} />
            <Tile icon="alert" tone={data.fails.length ? "warn" : undefined} label="Failures" value={num(data.fails.length)} note={`${num(piecesOf(data.fails).length)} pieces`} onClick={() => openRows("Failed QC", label, data.fails)} />
            <Tile icon="refresh" label="Re-work Passes" value={num(data.rework.length)} note="Sent back to fix" onClick={() => openRows("Sent Back for Re-work", label, data.rework)} />
            <Tile icon="close" label="Disposed" value={num(data.disposed.length)} note="Remade from fresh cloth" onClick={() => openRows("Disposed After QC", label, data.disposed)} />
            <Tile icon="edit" label="Final QC Overrides" value={num(data.overrides.length)} note="Completed without Final QC" onClick={() => openRows("Final QC Overrides", label, data.overrides)} />
          </div>

          <div className="ceo-grid">
            <Card span={12} title="What This Says">
              <div className="pmq-insights">
                {data.rate == null ? <Insight>No QC checks were recorded in this period.</Insight> : (
                  <Insight tone={data.prevRate != null && data.rate < data.prevRate - 1 ? "warn" : "gold"}>
                    <b>{data.rate.toFixed(1)}%</b> of {plural(data.checks.length, "check")} passed{data.prevRate != null ? `, against ${data.prevRate.toFixed(1)}% in the ${plural(period.days, "day")} before` : ""}.
                  </Insight>
                )}
                {data.types[0] && data.types[0].name !== "Other" && (
                  <Insight tone="warn">The most common problem is <b>{data.types[0].name.toLowerCase()}</b>: {num(data.types[0].value)} of {plural(data.fails.length, "failure")} mention it.{data.types[1] && data.types[1].name !== "Other" ? <> Next is {data.types[1].name.toLowerCase()} ({num(data.types[1].value)}).</> : null}</Insight>
                )}
                {(() => {
                  const list = data.inspectors.filter((r) => r.value >= 20).sort((a, b) => b.fails.length / b.value - a.fails.length / a.value);
                  return list.length > 1 && list[0].fails.length > 0 && list[0].fails.length / list[0].value > (data.fails.length / data.checks.length) * 1.2
                    ? <Insight><b>{list[0].name}</b> fails the most pieces: {pct1(list[0].fails.length, list[0].value)}% of {num(list[0].value)} checks, against {pct1(data.fails.length, data.checks.length)}% overall.</Insight>
                    : null;
                })()}
                {data.backTo[0] && <Insight>Failed pieces most often go back to <b>{data.backTo[0].name}</b> ({plural(data.backTo[0].value, "time")}).</Insight>}
                {data.repeat.length > 0 && <Insight tone="warn"><b>{plural(data.repeat.length, "piece")}</b> failed QC more than once; they are listed below.</Insight>}
                {data.overrides.length > 0 && <Insight><b>{plural(data.overrides.length, "piece")}</b> {data.overrides.length === 1 ? "was" : "were"} completed without passing Final QC.</Insight>}
              </div>
            </Card>

            <Card span={7} md={12} title="Pass Rate Over Time" sub={`Passed and failed checks per ${data.step}; the total is above each bar. Click a bar for its pieces.`}>
              <StackBars data={data.buckets} series={PASSFAIL} height={260}
                onPick={(b, key) => { const row = data.buckets.find((x) => x.name === b.name); if (row) openRows(`${key === "failed" ? "Failed" : "Checked"}: ${row.full}`, `${row.rate}% passed`, key === "failed" ? row.rows.filter(failed) : row.rows); }} />
              <Legend series={PASSFAIL} />
              <div className="pmq-rates">{data.buckets.map((b) => <span key={b.full}><small>{b.name}</small><b>{b.passed + b.failed ? `${b.rate}%` : "–"}</b></span>)}</div>
            </Card>

            <Card span={5} md={12} title="QC 1 and Final QC" sub="Passed and failed at each check point">
              <StackBars data={data.qcPoints} series={PASSFAIL} height={220}
                onPick={(b, key) => { const row = data.qcPoints.find((x) => x.name === b.name); if (row) openRows(`${row.name}: ${key === "failed" ? "Failed" : "All Checks"}`, label, key === "failed" ? row.fails : row.rows); }} />
              <Legend series={PASSFAIL} />
              <div className="pmq-rates">{data.qcPoints.map((q) => <span key={q.name}><small>{q.name} pass rate</small><b>{q.passed + q.failed ? `${pct(q.passed, q.passed + q.failed)}%` : "–"}</b></span>)}</div>
            </Card>

            <Card span={12} title="Failure Types" sub="What each fail reason mentions; one failure can mention more than one problem. Click a type to see its pieces.">
              <RankBars rows={data.types} limit={8} format={(v) => plural(v, "failure")} sub={(r) => `Mentioned in ${pct(r.value, data.fails.length)}% of failures`}
                onRow={(r) => openRows(`Failed: ${r.name}`, label, r.rows)} />
            </Card>

            <Card span={6} md={12} title="Why Pieces Fail" sub="The reasons as written. Click one to see its pieces">
              <RankBars rows={data.reasons} limit={6} format={(v) => plural(v, "failure")} sub={(r) => `${pct(r.value, data.fails.length)}% of failures`}
                onRow={(r) => openRows(`Failed: ${r.name}`, label, r.rows)} />
            </Card>

            <Card span={6} md={12} title="Where Failed Pieces Went Back To" sub="The stage each failed piece was sent back to">
              <RankBars rows={data.backTo} limit={6} format={(v) => plural(v, "piece")} sub={(r) => `${pct(r.value, data.backTo.reduce((s, x) => s + x.value, 0))}% of re-work`}
                onRow={(r) => openRows(`Sent Back to ${r.name}`, label, r.rows)} />
            </Card>

            <Card span={6} md={12} title="Inspectors" sub="Click an inspector to see the pieces they failed">
              <Table rowKey={(r) => r.name} rows={data.inspectors.slice(0, 12)} onRow={(r) => openRows(`Failed by ${r.name}`, label, r.fails)} empty="No checks in this period." columns={[
                { key: "name", label: "Inspector", render: (r) => <span className="pm-cell"><b>{r.name}</b></span> },
                { key: "checks", label: "Checks", right: true, render: (r) => num(r.value) },
                { key: "fails", label: "Failed", right: true, render: (r) => num(r.fails.length) },
                { key: "pct", label: "Fail Rate", right: true, render: (r) => `${pct1(r.fails.length, r.value)}%` },
              ]} />
              {data.inspectors.length > 0 && (
                <button type="button" className="ceo-link pm-more" onClick={() => csvFromObjects(`qc inspectors ${label}`, data.inspectors.map((r) => ({ Inspector: r.name, Checks: r.value, Failed: r.fails.length, "Fail Rate %": r.failPct })))}>Export CSV</button>
              )}
            </Card>

            <Card span={6} md={12} title="Pieces Failing More Than Once" sub="Click a piece to open its order">
              <Table rowKey={(r) => r.id} rows={data.repeat.slice(0, 12)} onRow={(r) => ordersById[r.order_id] && openOrder(ordersById[r.order_id])} empty="No piece failed twice in this period." columns={[
                { key: "piece", label: "Piece", render: (r) => <span className="pm-cell"><b>{r.piece?.component_label || r.piece?.component_type || "Piece"} <span className="pm-code">{r.barcode}</span></b><small>{r.reasons.join(", ") || "No reason given"}</small></span> },
                { key: "n", label: "Failed", right: true, render: (r) => plural(r.count, "time") },
              ]} />
              {data.repeat.length > 12 && <button type="button" className="ceo-link pm-more" onClick={() => openRows("Failing More Than Once", label, data.repeat.flatMap((r) => r.rows))}>See all {num(data.repeat.length)}</button>}
            </Card>
          </div>
        </>
      )}

      <div className="pm-tabs-scroll pmq-tabs"><Seg label="Records" value={view} onChange={setView} options={[{ value: "history", label: "QC History" }, { value: "rework", label: "Pieces in Re-work" }]} /></div>
      <section className="ceo-card pm-records">
        {view === "history" && <QcHistoryList ctx={ctx} rows={lazy.qcAll?.rows} loading={!lazy.qcAll || lazy.qcAll.loading} />}
        {view === "rework" && <ReworkList ctx={ctx} rows={lazy.rejourneys?.rows} loading={!lazy.rejourneys || lazy.rejourneys.loading} />}
      </section>
      <p className="pm-foot-note">Final QC overrides are left out of the pass rate: nobody inspected those garments. The figures above follow the date range in the header; the QC History below holds every record.</p>
    </div>
  );
}
