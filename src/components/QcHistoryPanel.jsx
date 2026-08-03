import React, { useEffect, useMemo, useState } from "react";
import QcHistoryTable from "./QcHistoryTable";
import Paginator from "./Paginator";
import { qcSummary, filterQcRecords, distinctInspectors, distinctChannels } from "../utils/qcHistory";
import { usePeriodFilter } from "./PeriodFilter";
import { CHANNEL_KEY_LABELS } from "../utils/barcodeService";
import downloadCsv from "../utils/downloadCsv";
import "./QcHistoryPanel.css";

// QC history can be thousands of records (the PM fetch pages the whole table) —
// rendering them all as cards is the main lag source on this tab. Paginate.
const PAGE_SIZE = 25;

/**
 * QcHistoryPanel — the full dashboard QC-history view: a filter bar
 * (time period, Pass/Fail, QC1/Final, QC person, order/barcode search),
 * a summary counts line, and the shared QcHistoryTable below.
 *
 * Fully self-contained (client-side filtering) — the caller only supplies
 * the records + loading. Used by Production Manager and both Production
 * Head dashboards; the only difference upstream is which records feed in.
 *
 * @param {object[]} records
 * @param {boolean}  loading
 * @param {boolean}  [showInspectorFilter=true]  hide when it's already one person (My QC History)
 * @param {boolean}  [showChannelFilter=true]    hide when the records are already one channel
 *                                               (e.g. the B2B dashboards, where every row is B2B)
 * @param {boolean}  [showOrderNo=true]          show order_no on each row
 * @param {function} [onOrderClick]              (orderId, orderNo) => void — jump to the order
 * @param {function} [onScopeChange]             ({channelLabel, result}) => void — what is
 *                                               ACTUALLY on screen right now, so the host heading
 *                                               can describe it. Both null/"" when unscoped.
 *                                               The host must not describe the panel from the
 *                                               values it passed IN: initialResult only seeds the
 *                                               filter, and the user can change it afterwards —
 *                                               reading the seed made the heading claim "showing
 *                                               failures" while the user sat on Pass.
 * @param {string}   [initialResult=""]          preselect the Pass/Fail/Overridden filter, so a
 *                                               caller can deep-link here already scoped (e.g. the
 *                                               QC Failures KPI card lands on 'fail'). The filter
 *                                               stays user-editable; changing it later is not
 *                                               overridden, but a NEW drill-down re-applies.
 */
export default function QcHistoryPanel({ records = [], loading, showInspectorFilter = true, showChannelFilter = true, showOrderNo = true, onOrderClick, onScopeChange, initialResult = "" }) {
  // Time scope via the shared PeriodFilter (by inspection time, created_at).
  const {
    control: periodControl, timeline, inPeriod, range: periodRange, props: periodProps,
  } = usePeriodFilter("all", { variant: "select", label: "Date:" });
  // Seeded from initialResult so a drill-down lands pre-scoped. The tab that
  // hosts this panel unmounts when inactive, so every fresh drill-in remounts
  // and re-seeds; the filter stays freely editable while the tab is open.
  const [result, setResult] = useState(initialResult);
  const [whichQc, setWhichQc] = useState("");
  const [inspectedBy, setInspectedBy] = useState("");
  const [channel, setChannel] = useState("");
  const [search, setSearch] = useState("");

  const inspectors = useMemo(() => distinctInspectors(records), [records]);
  // Options are the channels actually present, so nothing in the list can
  // select to an empty result. The control itself still renders regardless
  // (see the filter bar) — only its OPTIONS depend on the data.
  const channels = useMemo(
    () => (showChannelFilter ? distinctChannels(records) : []),
    [records, showChannelFilter]
  );
  const periodRecords = useMemo(
    () => (periodRange ? records.filter((r) => inPeriod(r.created_at)) : records),
    [records, periodRange, inPeriod]
  );
  const filtered = useMemo(
    () => filterQcRecords(periodRecords, { result, whichQc, inspectedBy, channel, search }),
    [periodRecords, result, whichQc, inspectedBy, channel, search]
  );
  const summary = useMemo(() => qcSummary(filtered), [filtered]);

  // Report the LIVE scope up so the host heading describes what's on screen.
  // Depends on the primitives (not an object literal) so it fires only on a
  // real change; `result` is the panel's own state, which is why the heading
  // stays correct after the user edits a seeded drill-down.
  const channelLabel = channel ? (channels.find((c) => c.key === channel)?.label || channel) : null;
  useEffect(() => { onScopeChange?.({ channelLabel, result }); }, [channelLabel, result, onScopeChange]);

  // Page within the FILTERED set; any filter change starts back at page 1.
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [records, periodRange, result, whichQc, inspectedBy, channel, search]);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageRecords = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  const clear = () => {
    periodProps.setTimeline("all"); periodProps.setCustomFrom(""); periodProps.setCustomTo("");
    setResult(""); setWhichQc(""); setInspectedBy(""); setChannel(""); setSearch("");
  };

  // Export what the filters currently select — `filtered`, NOT `pageRecords`.
  // Exporting the visible page would silently hand over 25 of N rows under a
  // heading that says N.
  const exportCsv = () => {
    downloadCsv({
      filename: "qc_history",
      headers: [
        "Order No", "Barcode", "Channel", "QC Stage", "Result",
        "Fail Reason", "Outcome", "Re-journey #", "Scrap Loss", "Scrap Location",
        "Inspected By", "Inspected At",
      ],
      rows: filtered.map((r) => [
        r.order_no || "",
        r.barcode || "",
        CHANNEL_KEY_LABELS[r.channel_key] || r.channel_key || "",
        r.which_qc === "final" ? "Final QC" : r.which_qc === "qc1" ? "QC 1" : (r.which_qc || ""),
        // An override is result='pass' on paper only — nobody inspected the
        // garment. Labelling it "Pass" in an export would overstate quality.
        r.is_override ? "Overridden" : (r.result || ""),
        r.fail_reason || "",
        r.outcome || "",
        r.rejourney_number ?? "",
        r.scrap_loss_amount ?? "",
        r.scrap_location || "",
        r.is_override ? (r.overridden_by || r.inspected_by || "") : (r.inspected_by || ""),
        r.created_at ? new Date(r.created_at).toLocaleString("en-GB") : "",
      ]),
    });
  };
  // "Clear" is offered against the panel's own baseline: when the caller drilled
  // in on Fail, sitting on Fail is not a user-applied filter to clear.
  const hasFilters = timeline !== "all" || result !== initialResult || whichQc || inspectedBy || channel || search;

  return (
    <div className="qch-panel">
      <div className="qch-filters">
        <input className="qch-input" type="text" placeholder="Search order # or barcode…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {periodControl}
        <select className="qch-input" value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="">All results</option>
          <option value="pass">Pass</option>
          <option value="fail">Fail</option>
          <option value="override">Overridden</option>
        </select>
        <select className="qch-input" value={whichQc} onChange={(e) => setWhichQc(e.target.value)}>
          <option value="">All QC stages</option>
          <option value="qc1">QC 1</option>
          <option value="final">Final QC</option>
        </select>
        {/* Rendered whenever the surface is multi-channel, even if the CURRENT
            records happen to be one channel — hiding it then made the filter
            look broken. Single-channel surfaces opt out via showChannelFilter. */}
        {showChannelFilter && (
          <select className="qch-input" value={channel} onChange={(e) => setChannel(e.target.value)} disabled={channels.length === 0}>
            <option value="">All channels</option>
            {channels.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        )}
        {showInspectorFilter && (
          <select className="qch-input" value={inspectedBy} onChange={(e) => setInspectedBy(e.target.value)}>
            <option value="">All QC people</option>
            {inspectors.map((email) => <option key={email} value={email}>{email}</option>)}
          </select>
        )}
        {hasFilters && <button className="qch-clear" onClick={clear}>Clear</button>}
        <button className="qch-export" onClick={exportCsv} disabled={filtered.length === 0} title={filtered.length === 0 ? "Nothing to export" : `Export ${filtered.length} record${filtered.length === 1 ? "" : "s"}`}>
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          Export ({filtered.length})
        </button>
      </div>

      <div className="qch-summary">
        <span className="qch-sum-item"><b>{summary.total}</b> records</span>
        <span className="qch-sum-item qch-sum-pass"><b>{summary.pass}</b> pass</span>
        <span className="qch-sum-item qch-sum-fail"><b>{summary.fail}</b> fail</span>
        {summary.override > 0 && (
          <span className="qch-sum-item qch-sum-override"><b>{summary.override}</b> overridden</span>
        )}
        <span className="qch-sum-item"><b>{summary.failRatePct}%</b> fail rate</span>
      </div>

      {/* Badge the channel on multi-channel surfaces — including when the
          current records are all one channel, which is itself worth seeing. */}
      <QcHistoryTable records={pageRecords} loading={loading} showOrderNo={showOrderNo} showChannel={showChannelFilter} onOrderClick={onOrderClick} emptyText={hasFilters ? "No QC records match these filters." : "No QC records yet."} />
      <Paginator page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}
