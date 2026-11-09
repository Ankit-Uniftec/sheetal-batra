import React, { useEffect, useState } from "react";
import ProductionOverrides from "../../components/ProductionOverrides";
import "../../components/ProductionOverrides.css";
import OverrideHistory from "../../components/OverrideHistory";
import ReplacementApprovals from "../../components/ReplacementApprovals";
import { fetchScanReport, scanReportCsv } from "../../utils/scanReport";
import { Chips, DateRange, Icon, PageHead, Seg, num } from "../CeoDashboard/CeoUi";
import { Card } from "./PmCommon";
import { dayKey, todayStart } from "./pmModel";

// ============================================================
// Approvals: everything that waits for the Production Manager's decision or
// hand. The panels are the same ones the old dashboard used, so every
// approval, override and rejection is saved exactly as before.
// ============================================================

const VIEWS = [
  { value: "overrides", label: "Scan & Overrides" },
  { value: "replacements", label: "Replacements" },
  { value: "log", label: "Override Log" },
  { value: "report", label: "Scan Report" },
];

export default function ApprovalsPage({ ctx }) {
  const { lazy, need } = ctx;
  const [view, setView] = useState("overrides");
  useEffect(() => { need("waiting"); }, [need]);
  const w = lazy.waiting?.rows;
  return (
    <div className="ceo-page">
      <PageHead title="Approvals" desc="Stage change requests, overrides, replacements and the record of every override." />
      <div className="ceo-tiles">
        <button type="button" className="ceo-tile is-link" onClick={() => setView("overrides")}>
          <span className={`ceo-tile-ico${w?.requests ? " is-warn" : ""}`}><Icon name="edit" /></span>
          <span className="ceo-tile-body"><span className="ceo-tile-label">Stage Requests Waiting</span><span className="ceo-tile-value">{w ? num(w.requests) : "…"}</span><span className="ceo-tile-foot"><span className="ceo-tile-note">From the floor</span></span></span>
        </button>
        <button type="button" className="ceo-tile is-link" onClick={() => setView("replacements")}>
          <span className={`ceo-tile-ico${w?.replacements ? " is-warn" : ""}`}><Icon name="transfer" /></span>
          <span className="ceo-tile-body"><span className="ceo-tile-label">Replacements Waiting</span><span className="ceo-tile-value">{w ? num(w.replacements) : "…"}</span><span className="ceo-tile-foot"><span className="ceo-tile-note">From the Production Head</span></span></span>
        </button>
      </div>
      <div className="pm-tabs-scroll"><Seg label="Approvals" value={view} onChange={setView} options={VIEWS} /></div>
      <section className="ceo-card pm-classic ceo-keep">
        {view === "overrides" && <ProductionOverrides currentUserEmail={ctx.email} />}
        {view === "replacements" && <ReplacementApprovals currentUserEmail={ctx.email} hideMoney />}
        {view === "log" && <OverrideHistory />}
        {view === "report" && <ScanReport ctx={ctx} />}
      </section>
    </div>
  );
}

const QUICK = [{ value: "1", label: "Today" }, { value: "7", label: "Last 7 Days" }, { value: "30", label: "Last 30 Days" }];

/** Every scan in a date range, one CSV row per scan (station scans, overrides, gate and re-work). */
function ScanReport({ ctx }) {
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
