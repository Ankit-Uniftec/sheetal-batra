import React, { useEffect, useMemo, useState } from "react";
import ProductionOverrides from "../../components/ProductionOverrides";
import "../../components/ProductionOverrides.css";
import OverrideHistory from "../../components/OverrideHistory";
import ReplacementApprovals from "../../components/ReplacementApprovals";
import { fetchScanReport, scanReportCsv } from "../../utils/scanReport";
import { Chips, DateRange, Icon, Insight, Seg, num } from "../CeoDashboard/CeoUi";
import { listRecentDecisions } from "../../utils/stageRequests";
import { Card, Dots } from "./PmCommon";
import { DAY, dayKey, plural, todayStart } from "./pmModel";

// ============================================================
// Requests & Overrides: everything that waits for the Production Manager's
// decision, in one side panel opened from the menu or the header. The panels
// are the same ones the old dashboard used, so every approval, override and
// rejection is saved exactly as before. Overrides for one order open from that
// order's own actions instead.
// ============================================================

const VIEWS = [
  { value: "overrides", label: "Requests & Overrides" },
  { value: "replacements", label: "Replacements" },
  { value: "log", label: "Override Log" },
];

export default function RequestsPanel({ ctx, initialView = "overrides" }) {
  const { lazy, need } = ctx;
  const [view, setView] = useState(initialView);
  useEffect(() => { need("waiting"); need("scans8"); }, [need]);
  const w = lazy.waiting?.rows;
  const scans = lazy.scans8?.rows;
  const [decided, setDecided] = useState(null);
  useEffect(() => { listRecentDecisions(200).then(setDecided).catch(() => setDecided([])); }, []);

  // What the approvals say: what is waiting and for how long, how quickly
  // requests get decided, and how often the floor moves pieces by override.
  const says = useMemo(() => {
    const now = Date.now();
    const out = [];
    if (w) {
      const oldest = w.requestRows.length ? Math.min(...w.requestRows.map((r) => new Date(r.requested_at).getTime())) : null;
      out.push(w.requests
        ? { tone: "warn", text: <><b>{plural(w.requests, "stage change request")}</b> {w.requests === 1 ? "is" : "are"} waiting for you; the oldest was raised {plural(Math.floor((now - oldest) / DAY), "day")} ago.</> }
        : { tone: "gold", text: <>No stage change request is waiting for you.</> });
      if (w.replacements) out.push({ tone: "warn", text: <><b>{plural(w.replacements, "replacement request")}</b> from the Production Head {w.replacements === 1 ? "is" : "are"} waiting for your approval.</> });
    }
    if (decided) {
      const since = now - 30 * DAY;
      const recent = decided.filter((g) => g.rows?.[0]?.decided_at && new Date(g.rows[0].decided_at).getTime() >= since);
      const approved = recent.filter((g) => g.status === "approved").length;
      const hours = recent.map((g) => (new Date(g.rows[0].decided_at) - new Date(g.requested_at)) / 3600000).filter((h) => h >= 0);
      const avg = hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null;
      out.push(recent.length
        ? { tone: avg != null && avg > 24 ? "warn" : "gold", text: <>In the last 30 days you decided <b>{plural(recent.length, "request")}</b>: {num(approved)} approved and {num(recent.length - approved)} rejected{avg != null ? <>, in <b>{avg < 1 ? "under an hour" : avg < 48 ? plural(Math.round(avg), "hour") : plural(Math.round(avg / 24), "day")}</b> on average</> : null}.</> }
        : { tone: "gold", text: <>No stage change requests were decided in the last 30 days.</> });
    }
    if (scans) {
      const manual = scans.filter((t) => t.transition_type === "manual_override");
      const byWho = {};
      manual.forEach((t) => { const k = String(t.scanned_by || "").trim() || "Not recorded"; byWho[k] = (byWho[k] || 0) + 1; });
      const top = Object.entries(byWho).sort((a, b) => b[1] - a[1])[0];
      out.push(manual.length
        ? { tone: manual.length / Math.max(scans.length, 1) > 0.1 ? "warn" : "gold", text: <><b>{num(manual.length)}</b> pieces were moved by manual override instead of a station scan in the last 8 days ({Math.round((manual.length / Math.max(scans.length, 1)) * 100)}% of all moves){top ? <>, most by <b>{top[0]}</b> ({num(top[1])})</> : null}. Each one is in the Override Log.</> }
        : { tone: "gold", text: <>No piece was moved by manual override in the last 8 days.</> });
    }
    return out;
  }, [w, decided, scans]);
  return (
    <>
      <div className="ceo-tiles pm-panel-tiles">
        <button type="button" className="ceo-tile is-link" onClick={() => setView("overrides")}>
          <span className={`ceo-tile-ico${w?.requests ? " is-warn" : ""}`}><Icon name="edit" /></span>
          <span className="ceo-tile-body"><span className="ceo-tile-label">Stage Requests Waiting</span><span className="ceo-tile-value">{w ? num(w.requests) : <Dots />}</span><span className="ceo-tile-foot"><span className="ceo-tile-note">From the floor</span></span></span>
        </button>
        <button type="button" className="ceo-tile is-link" onClick={() => setView("replacements")}>
          <span className={`ceo-tile-ico${w?.replacements ? " is-warn" : ""}`}><Icon name="transfer" /></span>
          <span className="ceo-tile-body"><span className="ceo-tile-label">Replacements Waiting</span><span className="ceo-tile-value">{w ? num(w.replacements) : <Dots />}</span><span className="ceo-tile-foot"><span className="ceo-tile-note">From the Production Head</span></span></span>
        </button>
      </div>
      {says.length > 0 && (
        <section className="ceo-card pm-says-card">
          <h3 className="pm-says-title">What This Says</h3>
          <div className="pmq-insights">{says.map((x, i) => <Insight key={i} tone={x.tone}>{x.text}</Insight>)}</div>
        </section>
      )}
      <div className="pm-tabs-scroll"><Seg label="Approvals" value={view} onChange={setView} options={VIEWS} /></div>
      <section className="ceo-card pm-classic ceo-keep">
        {view === "overrides" && <ProductionOverrides currentUserEmail={ctx.email} />}
        {view === "replacements" && <ReplacementApprovals currentUserEmail={ctx.email} hideMoney />}
        {view === "log" && <OverrideHistory />}
      </section>
    </>
  );
}

const QUICK = [{ value: "1", label: "Today" }, { value: "7", label: "Last 7 Days" }, { value: "30", label: "Last 30 Days" }];

/** Every scan in a date range, one CSV row per scan (station scans, overrides, gate and re-work). */
export function ScanReport({ ctx }) {
  const today = dayKey(todayStart());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [quick, setQuick] = useState("1");
  const [busy, setBusy] = useState(false);
  const pick = (v) => {
    setQuick(v);
    if (!v) return;
    const s = todayStart(); s.setDate(s.getDate() - (Number(v) - 1));
    setFrom(dayKey(s)); setTo(today);
  };
  const run = async () => {
    setBusy(true);
    try {
      const rows = await fetchScanReport({ from, to });
      if (!rows.length) { ctx.showPopup({ type: "info", title: "No Scans", message: `No pieces were scanned between ${from} and ${to}.`, confirmText: "Ok" }); return; }
      const blob = new Blob([`﻿${scanReportCsv(rows)}`], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = from === to ? `scan_report_${from}.csv` : `scan_report_${from}_to_${to}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      ctx.showPopup({ type: "error", title: "Not Exported", message: err.message || "The scan report could not be read.", confirmText: "Ok" });
    } finally { setBusy(false); }
  };
  return (
    <Card title="Scan Report" sub="Every scan in the chosen dates as a CSV: station scans, overrides, vendor gate and re-work, each labelled by type.">
      <div className="pm-report">
        <Chips options={QUICK} value={quick} onChange={pick} />
        <DateRange from={from} to={to} onChange={(a, b) => { setQuick(""); setFrom(a); setTo(b || a); }} />
        <button type="button" className="ceo-btn is-primary" onClick={run} disabled={busy || !from}><Icon name="download" />{busy ? "Exporting" : "Export CSV"}</button>
      </div>
    </Card>
  );
}
