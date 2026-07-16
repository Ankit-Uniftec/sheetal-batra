import React, { useState, useEffect, useCallback, useMemo } from "react";
import { usePopup } from "./Popup";
import Badge from "./Badge";
import {
  fetchPendingReplacements,
  approveReplacementJourney,
  rejectReplacementJourney,
} from "../utils/barcodeService";
import "./ReplacementApprovals.css";

/**
 * ReplacementApprovals — Production Manager view.
 * Production Heads report vendor failures (damage/loss) and request a
 * replacement journey; the PM approves here. On approval the component resets
 * to Cloth Issue, the cost is booked as a loss, and the Vendor Failure Ledger
 * is updated.
 */
const ReplacementApprovals = ({ currentUserEmail }) => {
  const { showPopup, PopupComponent } = usePopup();
  const [pending, setPending] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [search, setSearch] = useState("");
  const [failureFilter, setFailureFilter] = useState("all");

  const failureTypes = useMemo(
    () => [...new Set(pending.map((r) => r.failure_type).filter(Boolean))],
    [pending]
  );

  const filteredPending = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pending.filter((r) => {
      if (failureFilter !== "all" && r.failure_type !== failureFilter) return false;
      if (q && !(
        r.barcode?.toLowerCase().includes(q) ||
        r.order_no?.toLowerCase().includes(q) ||
        r.vendor_name?.toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [pending, search, failureFilter]);

  const load = useCallback(async () => {
    try { setPending((await fetchPendingReplacements()) || []); }
    catch (e) { console.error("Failed to load replacement requests:", e); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const doApprove = async (req) => {
    setBusyId(req.id);
    try {
      const res = await approveReplacementJourney({ requestId: req.id, approvedBy: currentUserEmail });
      if (res?.success) {
        showPopup({ title: "Approved", message: res.message || "Replacement journey approved.", type: "success", confirmText: "OK" });
        // Notify Manish (COO, via map) + the requesting Production Head.
        try {
          const { sendNotification, NOTIFICATION_TYPES } = await import("../utils/notificationService");
          await sendNotification(NOTIFICATION_TYPES.REPLACEMENT_APPROVED, {
            orderId: req.order_id,
            orderNo: req.order_no || "",
            metadata: { barcode: req.barcode, vendor_name: req.vendor_name, cost_loss: req.cost_loss },
            extraRecipients: req.requested_by ? [{ email: req.requested_by.toLowerCase(), channel: "in_app" }] : [],
          });
        } catch (notifErr) { console.error("Replacement-approved notification failed:", notifErr); }
        load();
      } else {
        showPopup({ title: "Failed", message: res?.error || "Could not approve.", type: "error", confirmText: "OK" });
      }
    } catch (e) {
      showPopup({ title: "Error", message: e.message || "Approve failed", type: "error", confirmText: "OK" });
    }
    setBusyId(null);
  };

  const doReject = async (req) => {
    setBusyId(req.id);
    try {
      await rejectReplacementJourney({ requestId: req.id, approvedBy: currentUserEmail, reason: "Rejected by Production Manager" });
      showPopup({ title: "Rejected", message: "Replacement request rejected.", type: "info", confirmText: "OK" });
      load();
    } catch (e) {
      showPopup({ title: "Error", message: e.message || "Reject failed", type: "error", confirmText: "OK" });
    }
    setBusyId(null);
  };

  return (
    <div className="rpa-wrap">
      {PopupComponent}
      <h2 className="rpa-title">Replacement Approvals</h2>
      <p className="rpa-hint">Production Heads report vendor failures (damage/loss) and request a replacement journey. Approving resets the component to Cloth Issue, books the cost as a loss, and updates the Vendor Failure Ledger.</p>

      <h3 className="rpa-section">Pending ({pending.length})</h3>
      {pending.length === 0 ? (
        <p className="rpa-empty">No replacement requests awaiting approval.</p>
      ) : (
        <>
          <div className="rpa-filters">
            <input
              type="text"
              className="rpa-filter-search"
              placeholder="Search by barcode, order no, or vendor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="rpa-filter-select" value={failureFilter} onChange={(e) => setFailureFilter(e.target.value)}>
              <option value="all">All Failure Types</option>
              {failureTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          {filteredPending.length === 0 ? (
            <p className="rpa-empty">No replacement requests match your search.</p>
          ) : (
        <div className="rpa-list">
          {filteredPending.map((r) => (
            <div key={r.id} className="rpa-row">
              <div className="rpa-info">
                <div className="rpa-line"><span className="rpa-bc">{r.barcode}</span><Badge variant="warning">{r.failure_type}</Badge></div>
                <div className="rpa-meta">Order {r.order_no} · Vendor: {r.vendor_name || "—"}</div>
                <div className="rpa-meta">Reason: {r.reason}</div>
                <div className="rpa-meta">Cost loss: ₹{Number(r.cost_loss || 0).toLocaleString("en-IN")} · Requested by {r.requested_by}</div>
              </div>
              <div className="rpa-actions">
                <button className="rpa-approve" disabled={busyId === r.id} onClick={() => doApprove(r)}>{busyId === r.id ? "…" : "Approve"}</button>
                <button className="rpa-reject" disabled={busyId === r.id} onClick={() => doReject(r)}>Reject</button>
              </div>
            </div>
          ))}
        </div>
          )}
        </>
      )}
    </div>
  );
};

export default ReplacementApprovals;
