import React from "react";
import "./QcHistoryTable.css";

/**
 * QcHistoryTable — renders a list of qc_records rows (pass/fail), shared by
 * every QC-history surface (QC person's own history, Production Manager,
 * Production Heads, and WarehouseDashboard's per-order QC Report).
 *
 * Extracted from WarehouseDashboard's inline QC Report so there's one
 * implementation. Each row shows barcode, which_qc, PASS/FAIL, fail detail
 * (kept for historical records that used the old scrap/loss fields), and
 * the inspector + timestamp. Optionally shows the order number per row
 * (useful in the dashboard views that span many orders).
 *
 * @param {object[]} records
 * @param {boolean}  loading
 * @param {string}   [emptyText]
 * @param {boolean}  [showOrderNo]  show the order_no on each row
 */
export default function QcHistoryTable({ records = [], loading, emptyText = "No QC checks recorded.", showOrderNo = false }) {
  if (loading) return <p className="qch-empty">Loading QC records…</p>;
  if (!records.length) return <p className="qch-empty">{emptyText}</p>;

  return (
    <div className="qch-list">
      {records.map((q) => (
        <div key={q.id} className={`qch-row ${q.result === "fail" ? "qch-row-fail" : "qch-row-pass"}`}>
          <div className="qch-row-head">
            <span className="qch-barcode">{q.barcode}</span>
            {showOrderNo && q.order_no && <span className="qch-order">{q.order_no}</span>}
            <span className="qch-which">{q.which_qc === "final" ? "Final QC" : "QC 1"}</span>
            <span className={`qch-result ${q.result === "fail" ? "qch-fail" : "qch-pass"}`}>
              {q.result === "fail" ? "FAIL" : "PASS"}
            </span>
          </div>
          {q.result === "fail" && (
            <div className="qch-detail">
              {q.fail_reason && <div><strong>Reason:</strong> {q.fail_reason}</div>}
              {q.outcome && <div><strong>Outcome:</strong> {q.outcome}{q.rejourney_number ? ` (re-journey ${q.rejourney_number})` : ""}</div>}
              {q.scrap_location && <div><strong>Scrap location:</strong> {q.scrap_location}</div>}
              {Number(q.scrap_loss_amount) > 0 && <div><strong>Loss:</strong> ₹{q.scrap_loss_amount}</div>}
            </div>
          )}
          <div className="qch-meta">
            {q.inspected_by ? `Inspected by ${q.inspected_by}` : ""}
            {q.created_at ? ` · ${new Date(q.created_at).toLocaleString("en-GB")}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}
