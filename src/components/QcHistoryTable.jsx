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
 * @param {function} [onOrderClick] (orderId, orderNo) => void — jump to the order
 */
export default function QcHistoryTable({ records = [], loading, emptyText = "No QC checks recorded.", showOrderNo = false, onOrderClick }) {
  if (loading) return <p className="qch-empty">Loading QC records…</p>;
  if (!records.length) return <p className="qch-empty">{emptyText}</p>;

  return (
    <div className="qch-list">
      {records.map((q) => {
        const clickable = onOrderClick && q.order_id;
        // A PH/PM Mark-as-Completed override writes a Final QC row with
        // result='pass' (so the column's constraint still holds) — is_override
        // is the only honest signal. Never infer it from result.
        const isOverride = q.is_override === true;
        return (
        <div
          key={q.id}
          className={`qch-row ${isOverride ? "qch-row-override" : q.result === "fail" ? "qch-row-fail" : "qch-row-pass"} ${clickable ? "qch-row-click" : ""}`}
          onClick={clickable ? () => onOrderClick(q.order_id, q.order_no) : undefined}
          role={clickable ? "button" : undefined}
          tabIndex={clickable ? 0 : undefined}
          onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOrderClick(q.order_id, q.order_no); } } : undefined}
          title={clickable ? "View this order in All Orders" : undefined}
        >
          <div className="qch-row-head">
            <span className="qch-barcode">{q.barcode}</span>
            {showOrderNo && q.order_no && <span className="qch-order">{q.order_no}</span>}
            <span className="qch-which">{q.which_qc === "final" ? "Final QC" : "QC 1"}</span>
            <span className={`qch-result ${isOverride ? "qch-override" : q.result === "fail" ? "qch-fail" : "qch-pass"}`}>
              {isOverride ? "OVERRIDDEN" : q.result === "fail" ? "FAIL" : "PASS"}
            </span>
          </div>
          {isOverride && (
            <div className="qch-detail">
              <div><strong>Final QC skipped</strong> — marked complete without passing Final QC.</div>
              {q.fail_reason && <div>{q.fail_reason}</div>}
            </div>
          )}
          {!isOverride && q.result === "fail" && (
            <div className="qch-detail">
              {q.fail_reason && <div><strong>Reason:</strong> {q.fail_reason}</div>}
              {q.outcome && <div><strong>Outcome:</strong> {q.outcome}{q.rejourney_number ? ` (re-journey ${q.rejourney_number})` : ""}</div>}
              {q.scrap_location && <div><strong>Scrap location:</strong> {q.scrap_location}</div>}
              {Number(q.scrap_loss_amount) > 0 && <div><strong>Loss:</strong> ₹{q.scrap_loss_amount}</div>}
            </div>
          )}
          <div className="qch-meta">
            {isOverride
              ? `Overridden by ${q.overridden_by || q.inspected_by || "unknown"}`
              : q.inspected_by ? `Inspected by ${q.inspected_by}` : ""}
            {q.created_at ? ` · ${new Date(q.created_at).toLocaleString("en-GB")}` : ""}
          </div>
        </div>
        );
      })}
    </div>
  );
}
