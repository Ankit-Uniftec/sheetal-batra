import React, { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtDate as formatDate } from "./pmModel";
import { Chips, Columns, Drawer, Empty, FilterButton, FilterGroup, Icon, Insight, PageHead, Pager, RankBars, barAxis, barMinWidth, fitBarLabel, labelRoom, num, textOn } from "../CeoDashboard/CeoUi";
import { ScanReport } from "./PmApprovals";
import { CsvButton, FilterDrawer, defineKit } from "../CeoDashboard/dashKit";
import { csvFromObjects, Dots, Loading } from "./PmCommon";
import { pct, plural } from "./pmModel";
import { coverKey, periodSteps, stepOf } from "./pmPeriod";

// ============================================================
// People: who scanned what, where and when, how much of it was on time, the
// manual moves made instead of station scans, and the QC inspectors' checks.
// Worked out from the scans and QC checks of the chosen period.
// ============================================================

const { Tile, Card, Table } = defineKit({
  tiles: {
    "Active Scanners": "People who recorded at least one scan in the period.",
    Scans: "Every stage scan in the period, across all stations and both warehouses.",
    "On-Time Scans": "Share of scans in the period where the piece moved on within its stage's time limit, as recorded by the scan station. Scans with no time limit are left out.",
    "Manual Moves": "Moves recorded as a manual override instead of a station scan, in the period.",
  },
  cards: {
    "Scans by Person": "Scans each person recorded in the period, with the stations they used and their on-time share. Click a person to see the pieces they scanned.",
    "Scans by Station": "Scans recorded at each station in the period. Click a station to see the pieces scanned there.",
    "Busiest Hours": "Scans by hour of the day across the period, so you can see when the floor is busiest.",
    "Scans Over Time": "Scans each day, week or month (depending on the date range), split by the warehouse the scan was made in. The number on top is the total.",
    "QC Inspectors": "QC checks each inspector recorded in the period and the share that failed. Final QC overrides are left out because nobody inspected the garment.",
    "Manual Moves": "Who moved pieces by manual override in the period, and how many.",
    "Everyone": "One row per person for the period. Export downloads the full list.",
  },
  columns: {
    "On Time": "Share of this person's timed scans where the piece moved on within the stage's time limit.",
  },
});

const SORTS = [
  { value: "scans", label: "Most scans" }, { value: "pieces", label: "Most pieces" }, { value: "ontime", label: "Lowest on time" },
  { value: "manual", label: "Most manual moves" }, { value: "last", label: "Scanned most recently" }, { value: "name", label: "Name, A to Z" },
];
const SORT_FN = {
  scans: (a, b) => b.value - a.value,
  pieces: (a, b) => b.pieces.size - a.pieces.size || b.value - a.value,
  ontime: (a, b) => (a.timed ? a.onTime / a.timed : 2) - (b.timed ? b.onTime / b.timed : 2) || b.value - a.value,
  manual: (a, b) => b.manual - a.manual || b.value - a.value,
  last: (a, b) => b.last - a.last,
  name: (a, b) => a.name.localeCompare(b.name),
};
const factoryOf = (t) => (t.factory === "SB WH Delhi (1)" || t.factory === "SB WH Delhi (2)" ? t.factory : "other");
const FACTORIES = [
  { key: "SB WH Delhi (1)", name: "SB WH Delhi (1)", color: "#a9821f" },
  { key: "SB WH Delhi (2)", name: "SB WH Delhi (2)", color: "#e6d18f" },
  { key: "other", name: "Not recorded", color: "#6a4f0c" },
];
const time = (ms) => new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const nameOf = (v) => String(v || "").trim() || "Not recorded";

export default function PeoplePage({ ctx }) {
  const { need, lazy, openPieces, piecesById, period } = ctx;
  // Short ranges also load the same number of days before, to see who stopped scanning.
  const scanKey = coverKey("scans", period.days < 30 ? period.reach : period.back);
  const qcKey = coverKey("qc", period.back);
  useEffect(() => { need(scanKey); need(qcKey); }, [need, scanKey, qcKey]);
  const [page, setPage] = useState(1);
  const [reportOpen, setReportOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [sort, setSort] = useState("scans");
  const [houses, setHouses] = useState([]);
  const [stationF, setStationF] = useState([]);
  const [kind, setKind] = useState("");
  const loadedScans = lazy[scanKey]?.rows;
  const qc = lazy[qcKey]?.rows;
  const days = period.days;
  const start = period.start.getTime();
  const end = period.end.getTime();
  const periodName = period.label;
  const filterCount = (houses.length ? 1 : 0) + (stationF.length ? 1 : 0) + (kind ? 1 : 0) + (sort !== "scans" ? 1 : 0);
  useEffect(() => { setPage(1); }, [period, sort, houses, stationF, kind]);
  const stations = useMemo(() => {
    const m = {};
    (loadedScans || []).forEach((t) => { if (period.inP(t.scanned_at)) { const k = nameOf(t.station_name); m[k] = (m[k] || 0) + 1; } });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k]) => ({ value: k, label: k }));
  }, [loadedScans, period]);
  const scans = useMemo(() => loadedScans && loadedScans.filter((t) => (!houses.length || houses.includes(factoryOf(t)))
    && (!stationF.length || stationF.includes(nameOf(t.station_name)))
    && (!kind || (kind === "manual") === (t.transition_type === "manual_override"))), [loadedScans, houses, stationF, kind]);

  const data = useMemo(() => {
    if (!scans) return null;
    const list = scans.filter((t) => period.inP(t.scanned_at));
    const people = {};
    const stations = {};
    const hours = Array.from({ length: 24 }, (_, h) => ({ name: `${String(h).padStart(2, "0")}:00`, value: 0, ids: new Set() }));
    const { step, steps } = periodSteps(period);
    const dayRows = steps.map((s) => ({ name: days === 1 ? s.full : s.name, total: 0, ...Object.fromEntries(FACTORIES.map((f) => [f.key, 0])) }));
    let timed = 0; let onTime = 0; let manual = 0;
    const allPieces = new Set();
    const latePieces = new Set();
    list.forEach((t) => {
      const at = new Date(t.scanned_at);
      const who = nameOf(t.scanned_by);
      const p = people[who] || (people[who] = { name: who, value: 0, pieces: new Set(), stations: new Set(), timed: 0, onTime: 0, manual: 0, manualPieces: new Set(), first: Infinity, last: 0 });
      p.value += 1;
      if (t.component_id) { p.pieces.add(t.component_id); allPieces.add(t.component_id); }
      if (t.is_on_time === false && t.component_id) latePieces.add(t.component_id);
      if (t.station_name) p.stations.add(t.station_name);
      const ms = at.getTime();
      if (ms < p.first) p.first = ms;
      if (ms > p.last) p.last = ms;
      if (t.is_on_time != null) { p.timed += 1; timed += 1; if (t.is_on_time) { p.onTime += 1; onTime += 1; } }
      if (t.transition_type === "manual_override") { p.manual += 1; manual += 1; if (t.component_id) p.manualPieces.add(t.component_id); }
      const st = nameOf(t.station_name);
      const s = stations[st] || (stations[st] = { name: st, value: 0, pieces: new Set(), people: new Set() });
      s.value += 1; s.people.add(who); if (t.component_id) s.pieces.add(t.component_id);
      hours[at.getHours()].value += 1;
      if (t.component_id) hours[at.getHours()].ids.add(t.component_id);
      const d = dayRows[stepOf(steps, at)];
      if (d) { d[factoryOf(t)] += 1; d.total += 1; }
    });
    const peopleList = Object.values(people).sort(SORT_FN.scans);
    const before = new Set(scans.filter((t) => period.prev.inP(t.scanned_at)).map((t) => nameOf(t.scanned_by)));
    const missing = days < 30 ? [...before].filter((n) => !people[n] && n !== "Not recorded") : [];
    return {
      list, timed, onTime, manual, hours, dayRows, step, allPieces, latePieces, missing,
      people: peopleList,
      everyone: [...peopleList].sort(SORT_FN[sort] || SORT_FN.scans),
      stations: Object.values(stations).sort((a, b) => b.value - a.value),
      manualPeople: peopleList.filter((p) => p.manual > 0).sort((a, b) => b.manual - a.manual),
      factoriesUsed: FACTORIES.filter((f) => dayRows.some((d) => d[f.key] > 0)),
    };
  }, [scans, period, days, sort]);

  const inspectors = useMemo(() => {
    if (!qc) return null;
    const m = {};
    qc.forEach((r) => {
      const ms = new Date(r.created_at).getTime();
      if (ms < start || ms >= end || r.is_override) return;
      const who = nameOf(r.inspected_by);
      const g = m[who] || (m[who] = { name: who, value: 0, fails: 0, pieces: new Set(), failPieces: new Set() });
      g.value += 1;
      if (r.component_id) g.pieces.add(r.component_id);
      if (r.result === "fail") { g.fails += 1; if (r.component_id) g.failPieces.add(r.component_id); }
    });
    return Object.values(m).sort((a, b) => b.value - a.value);
  }, [qc, start, end]);

  const piecesOf = (ids) => [...ids].map((id) => piecesById[id]).filter(Boolean);
  const peopleRows = (list) => list.map((p) => ({
    Person: p.name, Scans: p.value, Pieces: p.pieces.size, Stations: [...p.stations].join(", "),
    "On-Time %": p.timed ? pct(p.onTime, p.timed) : "", "Manual Moves": p.manual,
    "First Scan": p.first !== Infinity ? time(p.first) : "", "Last Scan": p.last ? time(p.last) : "",
  }));
  const loading = !data;

  return (
    <div className="ceo-page">
      <PageHead title="People" desc="Who scanned what, where and when. Click a person, a station or a bar to see the pieces behind it.">
        <FilterButton count={filterCount} onClick={() => setDrawer(true)} />
        <button type="button" className="ceo-btn" onClick={() => setReportOpen(true)}><Icon name="download" />Scan Report</button>
      </PageHead>
      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} count={data ? data.list.length : 0} noun="scans" sub="Narrow every figure on this page"
        onClear={() => { setSort("scans"); setHouses([]); setStationF([]); setKind(""); }}>
        <FilterGroup label="Sort the Everyone List By"><Chips options={SORTS} value={sort} onChange={(v) => setSort(v || "scans")} /></FilterGroup>
        <FilterGroup label="Warehouse"><Chips options={FACTORIES.map((f) => ({ value: f.key, label: f.name }))} value={houses} onChange={setHouses} /></FilterGroup>
        <FilterGroup label="Scan Type"><Chips options={[{ value: "station", label: "Station scans" }, { value: "manual", label: "Manual moves" }]} value={kind} onChange={setKind} /></FilterGroup>
        <FilterGroup label="Station"><Chips options={stations} value={stationF} onChange={setStationF} /></FilterGroup>
      </FilterDrawer>
      {reportOpen && (
        <Drawer title="Scan Report" sub="Download every scan in the dates you choose" onClose={() => setReportOpen(false)}>
          <ScanReport ctx={ctx} />
        </Drawer>
      )}
      <div className="ceo-tiles">
        <Tile icon="trend" label="Active Scanners" value={loading ? <Dots /> : num(data.people.length)} note={periodName}
          onClick={loading ? undefined : () => openPieces({ title: "Pieces Scanned", sub: periodName, pieces: piecesOf(data.allPieces) })} />
        <Tile icon="movements" label="Scans" value={loading ? <Dots /> : num(data.list.length)} note={loading ? "" : `${num(Math.round(data.list.length / days))} a day on average`}
          onClick={loading ? undefined : () => openPieces({ title: "Pieces Scanned", sub: periodName, pieces: piecesOf(data.allPieces) })} />
        <Tile icon="sale" label="On-Time Scans" value={loading ? <Dots /> : data.timed ? `${pct(data.onTime, data.timed)}%` : "–"} note={loading ? "" : `${num(data.onTime)} of ${num(data.timed)} timed scans`}
          onClick={loading || !data.latePieces.size ? undefined : () => openPieces({ title: "Moved On Late", sub: `Pieces with a scan past the stage's time limit, ${periodName.toLowerCase()}`, pieces: piecesOf(data.latePieces) })} />
        <Tile icon="edit" tone={!loading && data.manual ? "warn" : undefined} label="Manual Moves" value={loading ? <Dots /> : num(data.manual)} note={loading ? "" : `${pct(data.manual, data.list.length)}% of scans`}
          onClick={loading || !data.manual ? undefined : () => openPieces({ title: "Moved by Manual Override", sub: periodName, pieces: piecesOf(new Set(data.manualPeople.flatMap((p) => [...p.manualPieces]))) })} />
      </div>

      {loading ? <section className="ceo-card"><Loading text="Loading the scans" /></section> : (
        <div className="ceo-grid">
          <Card span={12} title="What This Says">
            <div className="pmq-insights">
              {!data.list.length ? <Insight>No scans were recorded {periodName.toLowerCase()}.</Insight> : (() => {
                const top = data.people[0];
                const isGate = (p) => [...p.stations].every((st) => /security|gate/i.test(st));
                const topMaker = data.people.find((p) => !isGate(p));
                const busiest = [...data.hours].sort((a, b) => b.value - a.value)[0];
                const firstHour = data.hours.findIndex((h) => h.value > 0);
                const lastHour = 23 - [...data.hours].reverse().findIndex((h) => h.value > 0);
                const lowest = data.people.filter((x) => x.timed >= 20).sort((a, b) => a.onTime / a.timed - b.onTime / b.timed)[0];
                const topManual = data.manualPeople[0];
                return (
                  <>
                    {isGate(top) && topMaker
                      ? <Insight>Gate scans aside, <b>{topMaker.name}</b> scanned the most: <b>{num(topMaker.value)}</b> scans at {[...topMaker.stations].slice(0, 3).join(", ")}. The security gate recorded {num(top.value)} scans ({pct(top.value, data.list.length)}% of all).</Insight>
                      : <Insight><b>{top.name}</b> scanned the most: <b>{num(top.value)}</b> scans, {pct(top.value, data.list.length)}% of all {num(data.list.length)}, across {plural(top.stations.size, "station")}.</Insight>}
                    <Insight>The floor scanned between <b>{String(firstHour).padStart(2, "0")}:00</b> and <b>{String(lastHour + 1).padStart(2, "0")}:00</b>; the busiest hour was <b>{busiest.name}</b> with {plural(busiest.value, "scan")}.</Insight>
                    {data.timed > 0 && <Insight tone={pct(data.onTime, data.timed) < 80 ? "warn" : "gold"}><b>{pct(data.onTime, data.timed)}%</b> of timed scans moved pieces on within the stage limit.{lowest && pct(lowest.onTime, lowest.timed) < pct(data.onTime, data.timed) ? <> The lowest share is <b>{lowest.name}</b> at {pct(lowest.onTime, lowest.timed)}%.</> : null}</Insight>}
                    {data.manual > 0 && <Insight tone={pct(data.manual, data.list.length) > 10 ? "warn" : "gold"}><b>{num(data.manual)}</b> moves ({pct(data.manual, data.list.length)}%) were made by manual override instead of a station scan{topManual ? <>, most by <b>{topManual.name}</b> ({num(topManual.manual)})</> : null}.</Insight>}
                    {data.missing.length > 0 && <Insight tone="warn">Scanned in the {days === 1 ? "day" : `${days} days`} before but not in this range ({periodName.toLowerCase()}): <b>{data.missing.slice(0, 6).join(", ")}</b>{data.missing.length > 6 ? ` and ${num(data.missing.length - 6)} more` : ""}.</Insight>}
                  </>
                );
              })()}
            </div>
          </Card>
          <Card span={6} md={12} title="Scans by Person" sub={`${periodName}. Click a person to see the pieces they scanned.`}>
            <RankBars rows={data.people} limit={10} format={(v) => plural(v, "scan")}
              sub={(r) => `${[...r.stations].slice(0, 3).join(", ") || "No station"}${r.stations.size > 3 ? ` +${r.stations.size - 3}` : ""}${r.timed ? ` · ${pct(r.onTime, r.timed)}% on time` : ""}`}
              onRow={(r) => openPieces({ title: `Scanned by ${r.name}`, sub: periodName, pieces: piecesOf(r.pieces) })} />
          </Card>
          <Card span={6} md={12} title="Scans by Station" sub={`${periodName}. Click a station to see its pieces.`}>
            <RankBars rows={data.stations} limit={10} format={(v) => plural(v, "scan")} sub={(r) => plural(r.people.size, "person", "people")}
              onRow={(r) => openPieces({ title: `Scanned at ${r.name}`, sub: periodName, pieces: piecesOf(r.pieces) })} />
          </Card>

          <Card span={6} md={12} title="Busiest Hours" sub={`Scans by hour of the day, ${periodName.toLowerCase()}`}>
            <Columns data={data.hours.filter((h, i) => h.value > 0 || (i >= 8 && i <= 20))} money={false} name="Scans" height={250}
              highlight={(d) => d.value === Math.max(...data.hours.map((h) => h.value))}
              onPick={(d) => d.value && openPieces({ title: `Scanned ${d.name}–${String(Number(d.name.slice(0, 2)) + 1).padStart(2, "0")}:00`, sub: periodName, pieces: piecesOf(d.ids) })} />
          </Card>
          <Card span={6} md={12} title="Scans Over Time" sub={`Per ${data.step}, split by the warehouse the scan was made in`}>
            <DayStack rows={data.dayRows} factories={data.factoriesUsed} />
          </Card>

          <Card span={6} md={12} title="QC Inspectors" sub={`Checks and failures, ${periodName.toLowerCase()}`}>
            {!inspectors ? <Loading text="Loading the QC checks" /> : (
              <RankBars rows={inspectors} limit={10} format={(v) => plural(v, "check")}
                sub={(r) => `${num(r.fails)} failed · ${pct(r.fails, r.value)}% fail rate`}
                onRow={(r) => openPieces({ title: `Checked by ${r.name}`, sub: periodName, pieces: piecesOf(r.pieces) })} />
            )}
          </Card>
          <Card span={6} md={12} title="Manual Moves" sub={`Moves made by override instead of a station scan, ${periodName.toLowerCase()}`}>
            <Table rowKey={(r) => r.name} rows={data.manualPeople} empty="No manual moves in this period."
              onRow={(r) => openPieces({ title: `Manual Moves by ${r.name}`, sub: periodName, pieces: piecesOf(r.manualPieces) })}
              columns={[
                { key: "name", label: "Person", render: (r) => r.name },
                { key: "m", label: "Manual Moves", right: true, render: (r) => num(r.manual) },
                { key: "share", label: "Of Their Scans", right: true, render: (r) => `${pct(r.manual, r.value)}%` },
              ]} />
          </Card>

          <Card span={12} title="Everyone" sub={`${plural(data.people.length, "person", "people")}, ${periodName.toLowerCase()}. Sorted by ${SORTS.find((s) => s.value === sort).label.toLowerCase()}.`}>
            <div className="gm-actions"><CsvButton disabled={!data.people.length} onClick={() => csvFromObjects(`people ${periodName}`, peopleRows(data.everyone))} /></div>
            <Table rowKey={(r) => r.name} rows={data.everyone.slice((page - 1) * 15, page * 15)} empty="No scans in this period."
              onRow={(r) => openPieces({ title: `Scanned by ${r.name}`, sub: periodName, pieces: piecesOf(r.pieces) })}
              columns={[
                { key: "name", label: "Person", render: (r) => <span className="pm-cell"><b>{r.name}</b><small>{[...r.stations].join(", ") || "No station"}</small></span> },
                { key: "scans", label: "Scans", right: true, render: (r) => num(r.value) },
                { key: "pieces", label: "Pieces", right: true, hide: true, render: (r) => num(r.pieces.size) },
                { key: "ontime", label: "On Time", right: true, render: (r) => (r.timed ? `${pct(r.onTime, r.timed)}%` : "–") },
                { key: "manual", label: "Manual", right: true, hide: true, render: (r) => num(r.manual) },
                { key: "last", label: "Last Scan", right: true, lap: true, render: (r) => (r.last ? (days === 1 ? new Date(r.last).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : formatDate(r.last)) : "–") },
              ]} />
            <Pager page={page} pages={Math.ceil(data.people.length / 15)} onChange={setPage} />
          </Card>
        </div>
      )}
    </div>
  );
}

/** Scans per day stacked by warehouse, with each segment's count inside and the day's total on top. */
function DayStack({ rows, factories }) {
  if (!rows.some((r) => r.total)) return <Empty text="No scans in this period." />;
  const segLabel = (color) => ({ x, y, width, height, value }) => (
    value && height >= 14 && width >= 18
      ? <text x={x + width / 2} y={y + height / 2} dy="0.35em" textAnchor="middle" fontSize={10} fontWeight={600} fill={textOn(color)} pointerEvents="none">{num(value)}</text>
      : null
  );
  return (
    <>
      <div className="ceo-chart-scroll">
      <div style={{ width: "100%", minWidth: barMinWidth(rows.length), height: 250 }}>
        <ResponsiveContainer initialDimension={{ width: 1, height: 1 }}>
          <BarChart data={rows} margin={{ top: labelRoom(rows.map((r) => r.total)), right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#f1ede2" vertical={false} />
            <XAxis dataKey="name" axisLine={false} tickLine={false} {...barAxis(rows.length)} />
            <YAxis tick={{ fontSize: 11, fill: "#8a8478" }} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
            <Tooltip cursor={{ fill: "rgba(184,146,46,.07)" }} />
            {factories.map((f, i) => (
              <Bar key={f.key} dataKey={f.key} name={f.name} stackId="a" fill={f.color} maxBarSize={36} isAnimationActive={false}>
                <LabelList dataKey={f.key} content={segLabel(f.color)} />
                {i === factories.length - 1 && <LabelList dataKey="total" content={fitBarLabel(num, rows.map((r) => r.total))} />}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      </div>
      <div className="pmp-legend">{factories.map((f) => <span key={f.key}><i style={{ background: f.color }} />{f.name}</span>)}</div>
    </>
  );
}
