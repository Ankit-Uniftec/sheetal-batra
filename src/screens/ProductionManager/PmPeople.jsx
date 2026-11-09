import React, { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import formatDate from "../../utils/formatDate";
import { Columns, Empty, PageHead, Pager, RankBars, Seg, barValueLabel, num, sparseBarLabel, textOn } from "../CeoDashboard/CeoUi";
import { CsvButton, defineKit } from "../CeoDashboard/dashKit";
import { csvFromObjects } from "./PmCommon";
import { dayKey, pct, plural, todayStart } from "./pmModel";

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
    "Scans per Day": "Scans each day, split by the warehouse the scan was made in. The number on top is the day's total.",
    "QC Inspectors": "QC checks each inspector recorded in the period and the share that failed. Final QC overrides are left out because nobody inspected the garment.",
    "Manual Moves": "Who moved pieces by manual override in the period, and how many.",
    "Everyone": "One row per person for the period. Export downloads the full list.",
  },
  columns: {
    "On Time": "Share of this person's timed scans where the piece moved on within the stage's time limit.",
  },
});

const PERIODS = [{ value: "1", label: "Today" }, { value: "7", label: "Last 7 Days" }, { value: "30", label: "Last 30 Days" }];
const FACTORIES = [
  { key: "SB WH Delhi (1)", name: "SB WH Delhi (1)", color: "#a9821f" },
  { key: "SB WH Delhi (2)", name: "SB WH Delhi (2)", color: "#e6d18f" },
  { key: "other", name: "Not recorded", color: "#6a4f0c" },
];
const time = (ms) => new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const nameOf = (v) => String(v || "").trim() || "Not recorded";

export default function PeoplePage({ ctx }) {
  const { need, lazy, openPieces, piecesById } = ctx;
  useEffect(() => { need("scans30"); need("qc90"); }, [need]);
  const [period, setPeriod] = useState("7");
  const [page, setPage] = useState(1);
  const scans = lazy.scans30?.rows;
  const qc = lazy.qc90?.rows;
  const days = Number(period);
  const start = useMemo(() => { const d = todayStart(); d.setDate(d.getDate() - (days - 1)); return d.getTime(); }, [days]);
  const periodName = PERIODS.find((p) => p.value === period)?.label;
  useEffect(() => { setPage(1); }, [period]);

  const data = useMemo(() => {
    if (!scans) return null;
    const list = scans.filter((t) => new Date(t.scanned_at).getTime() >= start);
    const people = {};
    const stations = {};
    const hours = Array.from({ length: 24 }, (_, h) => ({ name: `${String(h).padStart(2, "0")}:00`, value: 0, ids: new Set() }));
    const dayRows = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = todayStart(); d.setDate(d.getDate() - i);
      dayRows.push({ key: dayKey(d), name: days === 1 ? "Today" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), total: 0, ...Object.fromEntries(FACTORIES.map((f) => [f.key, 0])) });
    }
    const dayBy = Object.fromEntries(dayRows.map((d) => [d.key, d]));
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
      const d = dayBy[dayKey(at)];
      if (d) {
        const f = t.factory === "SB WH Delhi (1)" || t.factory === "SB WH Delhi (2)" ? t.factory : "other";
        d[f] += 1; d.total += 1;
      }
    });
    const peopleList = Object.values(people).sort((a, b) => b.value - a.value);
    return {
      list, timed, onTime, manual, hours, dayRows, allPieces, latePieces,
      people: peopleList,
      stations: Object.values(stations).sort((a, b) => b.value - a.value),
      manualPeople: peopleList.filter((p) => p.manual > 0).sort((a, b) => b.manual - a.manual),
      factoriesUsed: FACTORIES.filter((f) => dayRows.some((d) => d[f.key] > 0)),
    };
  }, [scans, start, days]);

  const inspectors = useMemo(() => {
    if (!qc) return null;
    const m = {};
    qc.forEach((r) => {
      if (new Date(r.created_at).getTime() < start || r.is_override) return;
      const who = nameOf(r.inspected_by);
      const g = m[who] || (m[who] = { name: who, value: 0, fails: 0, pieces: new Set(), failPieces: new Set() });
      g.value += 1;
      if (r.component_id) g.pieces.add(r.component_id);
      if (r.result === "fail") { g.fails += 1; if (r.component_id) g.failPieces.add(r.component_id); }
    });
    return Object.values(m).sort((a, b) => b.value - a.value);
  }, [qc, start]);

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
        <Seg label="Period" value={period} onChange={setPeriod} options={PERIODS} />
      </PageHead>
      <div className="ceo-tiles">
        <Tile icon="trend" label="Active Scanners" value={loading ? "…" : num(data.people.length)} note={periodName}
          onClick={loading ? undefined : () => openPieces({ title: "Pieces Scanned", sub: periodName, pieces: piecesOf(data.allPieces) })} />
        <Tile icon="movements" label="Scans" value={loading ? "…" : num(data.list.length)} note={loading ? "" : `${num(Math.round(data.list.length / days))} a day on average`}
          onClick={loading ? undefined : () => openPieces({ title: "Pieces Scanned", sub: periodName, pieces: piecesOf(data.allPieces) })} />
        <Tile icon="sale" label="On-Time Scans" value={loading ? "…" : data.timed ? `${pct(data.onTime, data.timed)}%` : "–"} note={loading ? "" : `${num(data.onTime)} of ${num(data.timed)} timed scans`}
          onClick={loading || !data.latePieces.size ? undefined : () => openPieces({ title: "Moved On Late", sub: `Pieces with a scan past the stage's time limit, ${periodName.toLowerCase()}`, pieces: piecesOf(data.latePieces) })} />
        <Tile icon="edit" tone={!loading && data.manual ? "warn" : undefined} label="Manual Moves" value={loading ? "…" : num(data.manual)} note={loading ? "" : `${pct(data.manual, data.list.length)}% of scans`}
          onClick={loading || !data.manual ? undefined : () => openPieces({ title: "Moved by Manual Override", sub: periodName, pieces: piecesOf(new Set(data.manualPeople.flatMap((p) => [...p.manualPieces]))) })} />
      </div>

      {loading ? <section className="ceo-card"><Empty text="Loading the scans…" /></section> : (
        <div className="ceo-grid">
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
          <Card span={6} md={12} title="Scans per Day" sub="Split by the warehouse the scan was made in">
            <DayStack rows={data.dayRows} factories={data.factoriesUsed} />
          </Card>

          <Card span={6} md={12} title="QC Inspectors" sub={`Checks and failures, ${periodName.toLowerCase()}`}>
            {!inspectors ? <Empty text="Loading the QC checks…" /> : (
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

          <Card span={12} title="Everyone" sub={`${plural(data.people.length, "person", "people")}, ${periodName.toLowerCase()}`}>
            <div className="gm-actions"><CsvButton disabled={!data.people.length} onClick={() => csvFromObjects(`people ${periodName}`, peopleRows(data.people))} /></div>
            <Table rowKey={(r) => r.name} rows={data.people.slice((page - 1) * 15, page * 15)} empty="No scans in this period."
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
      <div style={{ width: "100%", height: 250 }}>
        <ResponsiveContainer initialDimension={{ width: 1, height: 1 }}>
          <BarChart data={rows} margin={{ top: 22, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#f1ede2" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#8a8478" }} axisLine={false} tickLine={false} minTickGap={6} />
            <YAxis tick={{ fontSize: 11, fill: "#8a8478" }} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
            <Tooltip cursor={{ fill: "rgba(184,146,46,.07)" }} />
            {factories.map((f, i) => (
              <Bar key={f.key} dataKey={f.key} name={f.name} stackId="a" fill={f.color} maxBarSize={36} isAnimationActive={false}>
                <LabelList dataKey={f.key} content={segLabel(f.color)} />
                {i === factories.length - 1 && <LabelList dataKey="total" content={rows.length > 16 ? sparseBarLabel(rows, "total", num) : barValueLabel(num)} />}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="pmp-legend">{factories.map((f) => <span key={f.key}><i style={{ background: f.color }} />{f.name}</span>)}</div>
    </>
  );
}
