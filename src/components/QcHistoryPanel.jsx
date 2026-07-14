import React, { useMemo, useState } from "react";
import QcHistoryTable from "./QcHistoryTable";
import { qcSummary, filterQcRecords, distinctInspectors } from "../utils/qcHistory";
import "./QcHistoryPanel.css";

/**
 * QcHistoryPanel — the full dashboard QC-history view: a filter bar
 * (date range, Pass/Fail, QC1/Final, QC person, order/barcode search),
 * a summary counts line, and the shared QcHistoryTable below.
 *
 * Fully self-contained (client-side filtering) — the caller only supplies
 * the records + loading. Used by Production Manager and both Production
 * Head dashboards; the only difference upstream is which records feed in.
 *
 * @param {object[]} records
 * @param {boolean}  loading
 * @param {boolean}  [showInspectorFilter=true]  hide when it's already one person (My QC History)
 * @param {boolean}  [showOrderNo=true]          show order_no on each row
 */
export default function QcHistoryPanel({ records = [], loading, showInspectorFilter = true, showOrderNo = true }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState("");
  const [whichQc, setWhichQc] = useState("");
  const [inspectedBy, setInspectedBy] = useState("");
  const [search, setSearch] = useState("");

  const inspectors = useMemo(() => distinctInspectors(records), [records]);
  const filtered = useMemo(
    () => filterQcRecords(records, { from, to, result, whichQc, inspectedBy, search }),
    [records, from, to, result, whichQc, inspectedBy, search]
  );
  const summary = useMemo(() => qcSummary(filtered), [filtered]);

  const clear = () => { setFrom(""); setTo(""); setResult(""); setWhichQc(""); setInspectedBy(""); setSearch(""); };
  const hasFilters = from || to || result || whichQc || inspectedBy || search;

  return (
    <div className="qch-panel">
      <div className="qch-filters">
        <input className="qch-input" type="text" placeholder="Search order # or barcode…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="qch-date-range">
          <input className="qch-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span>→</span>
          <input className="qch-input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
        <select className="qch-input" value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="">All results</option>
          <option value="pass">Pass</option>
          <option value="fail">Fail</option>
        </select>
        <select className="qch-input" value={whichQc} onChange={(e) => setWhichQc(e.target.value)}>
          <option value="">QC1 & Final</option>
          <option value="qc1">QC 1</option>
          <option value="final">Final QC</option>
        </select>
        {showInspectorFilter && (
          <select className="qch-input" value={inspectedBy} onChange={(e) => setInspectedBy(e.target.value)}>
            <option value="">All QC people</option>
            {inspectors.map((email) => <option key={email} value={email}>{email}</option>)}
          </select>
        )}
        {hasFilters && <button className="qch-clear" onClick={clear}>Clear</button>}
      </div>

      <div className="qch-summary">
        <span className="qch-sum-item"><b>{summary.total}</b> records</span>
        <span className="qch-sum-item qch-sum-pass"><b>{summary.pass}</b> pass</span>
        <span className="qch-sum-item qch-sum-fail"><b>{summary.fail}</b> fail</span>
        <span className="qch-sum-item"><b>{summary.failRatePct}%</b> fail rate</span>
      </div>

      <QcHistoryTable records={filtered} loading={loading} showOrderNo={showOrderNo} emptyText={hasFilters ? "No QC records match these filters." : "No QC records yet."} />
    </div>
  );
}
