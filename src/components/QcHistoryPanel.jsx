import React, { useEffect, useMemo, useState } from "react";
import QcHistoryTable from "./QcHistoryTable";
import Paginator from "./Paginator";
import { qcSummary, filterQcRecords, distinctInspectors } from "../utils/qcHistory";
import { usePeriodFilter } from "./PeriodFilter";
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
 * @param {boolean}  [showOrderNo=true]          show order_no on each row
 * @param {function} [onOrderClick]              (orderId, orderNo) => void — jump to the order
 */
export default function QcHistoryPanel({ records = [], loading, showInspectorFilter = true, showOrderNo = true, onOrderClick }) {
  // Time scope via the shared PeriodFilter (by inspection time, created_at).
  const {
    control: periodControl, timeline, inPeriod, range: periodRange, props: periodProps,
  } = usePeriodFilter("all", { variant: "select", label: "Date:" });
  const [result, setResult] = useState("");
  const [whichQc, setWhichQc] = useState("");
  const [inspectedBy, setInspectedBy] = useState("");
  const [search, setSearch] = useState("");

  const inspectors = useMemo(() => distinctInspectors(records), [records]);
  const periodRecords = useMemo(
    () => (periodRange ? records.filter((r) => inPeriod(r.created_at)) : records),
    [records, periodRange, inPeriod]
  );
  const filtered = useMemo(
    () => filterQcRecords(periodRecords, { result, whichQc, inspectedBy, search }),
    [periodRecords, result, whichQc, inspectedBy, search]
  );
  const summary = useMemo(() => qcSummary(filtered), [filtered]);

  // Page within the FILTERED set; any filter change starts back at page 1.
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [records, periodRange, result, whichQc, inspectedBy, search]);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageRecords = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  const clear = () => {
    periodProps.setTimeline("all"); periodProps.setCustomFrom(""); periodProps.setCustomTo("");
    setResult(""); setWhichQc(""); setInspectedBy(""); setSearch("");
  };
  const hasFilters = timeline !== "all" || result || whichQc || inspectedBy || search;

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
        {summary.override > 0 && (
          <span className="qch-sum-item qch-sum-override"><b>{summary.override}</b> overridden</span>
        )}
        <span className="qch-sum-item"><b>{summary.failRatePct}%</b> fail rate</span>
      </div>

      <QcHistoryTable records={pageRecords} loading={loading} showOrderNo={showOrderNo} onOrderClick={onOrderClick} emptyText={hasFilters ? "No QC records match these filters." : "No QC records yet."} />
      <Paginator page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}
