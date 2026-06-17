import React, { useState, useEffect, useCallback } from "react";
import { usePopup } from "./Popup";
import { fetchPendingVendors, fetchAllVendors, setVendorApproval } from "../utils/barcodeService";
import "./VendorApprovals.css";

/**
 * VendorApprovals — COO (Manish) view.
 * Lists pending vendor requests with Approve / Reject actions, plus a
 * read-only list of all vendors and their status. Only an approved vendor
 * becomes selectable by Production Heads for external movements (Rule 12).
 */
const VendorApprovals = ({ currentUserEmail }) => {
  const { showPopup, PopupComponent } = usePopup();
  const [pending, setPending] = useState([]);
  const [all, setAll] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([fetchPendingVendors(), fetchAllVendors()]);
      setPending(p || []);
      setAll(a || []);
    } catch (e) {
      console.error("Failed to load vendors:", e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (vendor, approve) => {
    // Reject requires a reason
    const proceed = async (reason) => {
      setBusyId(vendor.id);
      try {
        await setVendorApproval({ vendorId: vendor.id, approve, approvedBy: currentUserEmail, reason: reason || null });
        showPopup({
          title: approve ? "Vendor Approved" : "Vendor Rejected",
          message: `${vendor.vendor_name} has been ${approve ? "approved and is now selectable" : "rejected"}.`,
          type: approve ? "success" : "info",
          confirmText: "OK",
        });
        load();
      } catch (e) {
        showPopup({ title: "Error", message: e.message || "Action failed", type: "error", confirmText: "OK" });
      }
      setBusyId(null);
    };

    if (approve) {
      proceed(null);
    } else {
      // simple prompt-style reason via popup input is overkill here; reject with a default note.
      proceed("Rejected by COO");
    }
  };

  return (
    <div className="va-wrap">
      {PopupComponent}

      <h2 className="va-title">Vendor Approvals</h2>
      <p className="va-hint">New vendor requests from the Production Manager appear here. Approve to make a vendor selectable for external movements.</p>

      <h3 className="va-section">Pending Requests ({pending.length})</h3>
      {pending.length === 0 ? (
        <p className="va-empty">No pending vendor requests.</p>
      ) : (
        <div className="va-list">
          {pending.map((v) => (
            <div key={v.id} className="va-row">
              <div className="va-info">
                <span className="va-name">{v.vendor_name}</span>
                {v.vendor_location && <span className="va-loc">{v.vendor_location}</span>}
                <span className="va-req">Requested by {v.requested_by}</span>
              </div>
              <div className="va-actions">
                <button className="va-approve" disabled={busyId === v.id} onClick={() => act(v, true)}>
                  {busyId === v.id ? "…" : "Approve"}
                </button>
                <button className="va-reject" disabled={busyId === v.id} onClick={() => act(v, false)}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className="va-section">All Vendors ({all.length})</h3>
      <div className="va-list">
        {all.map((v) => (
          <div key={v.id} className="va-row">
            <div className="va-info">
              <span className="va-name">{v.vendor_name}</span>
              {v.vendor_location && <span className="va-loc">{v.vendor_location}</span>}
            </div>
            <span className={`va-status va-status-${v.status}`}>{v.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default VendorApprovals;
