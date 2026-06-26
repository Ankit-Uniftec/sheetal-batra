import React, { useState, useEffect, useCallback, useMemo } from "react";
import { usePopup } from "./Popup";
import { SearchableSelect } from "./SearchableSelect";
import {
  fetchApprovedVendors,
  fetchAllVendors,
  configureExternalMovement,
  initiateReplacementJourney,
  SCAN_STATIONS,
} from "../utils/barcodeService";

// Logical steps eligible for external vendor work (Rule 7: stages 2..8).
// Built from SCAN_STATIONS so labels stay in sync.
const EXTERNAL_ELIGIBLE_STEPS = SCAN_STATIONS
  .filter((s) => s.step >= 2 && s.step <= 8)
  .map((s) => ({ step: s.step, label: s.label }));

/**
 * ProductionHeadVendors
 *
 * Visible only to the Offline Production Head. Two functions:
 *  1. Configure External Movement — pick a component (barcode), an approved
 *     vendor, a non-backdated return date, and which stages go outside. This
 *     creates the movement record the Security Gate exit scan requires.
 *  2. Vendors — list all vendors and (for Production Manager) request a new one.
 *     New vendors stay 'pending' until Manish approves.
 */
const ProductionHeadVendors = ({ currentUserEmail }) => {
  const { showPopup, PopupComponent } = usePopup();

  const [tab, setTab] = useState("movement"); // 'movement' | 'vendors' | 'failure'

  // Movement form
  const [barcode, setBarcode] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [stages, setStages] = useState([]); // logical steps
  const [submitting, setSubmitting] = useState(false);

  // Vendor-failure / replacement-journey form
  const [failBarcode, setFailBarcode] = useState("");
  const [failType, setFailType] = useState("damage"); // damage | loss | misplacement
  const [failReason, setFailReason] = useState("");
  const [failCost, setFailCost] = useState("");

  // Vendors
  const [approvedVendors, setApprovedVendors] = useState([]);
  const [allVendors, setAllVendors] = useState([]);

  const loadVendors = useCallback(async () => {
    try {
      const [approved, all] = await Promise.all([fetchApprovedVendors(), fetchAllVendors()]);
      setApprovedVendors(approved || []);
      setAllVendors(all || []);
    } catch (e) {
      console.error("Failed to load vendors:", e);
    }
  }, []);

  useEffect(() => { loadVendors(); }, [loadVendors]);

  // Minimum selectable return date = today (no backdating; RPC also enforces).
  const todayStr = new Date().toISOString().slice(0, 10);

  const toggleStage = (step) => {
    setStages((prev) => prev.includes(step) ? prev.filter((s) => s !== step) : [...prev, step]);
  };

  // Vendor dropdown options. Label shows the vendor's STAGE (replacing the old
  // location). When stage checkboxes are ticked, only vendors whose assigned
  // stage matches one of the checked stages are shown. SearchableSelect adds a
  // type-to-search box over these options.
  const vendorOptions = useMemo(() => {
    const list = stages.length > 0
      ? approvedVendors.filter((v) => v.stage_number != null && stages.includes(v.stage_number))
      : approvedVendors;
    return list.map((v) => ({
      value: v.id,
      label: `${v.vendor_name}${v.stage_name ? ` — ${v.stage_name}` : ""}`,
    }));
  }, [approvedVendors, stages]);

  // If the selected vendor no longer matches the checked-stage filter, clear it
  // so we never submit a vendor that's hidden from the (now-filtered) list.
  useEffect(() => {
    if (vendorId && !vendorOptions.some((o) => o.value === vendorId)) {
      setVendorId("");
    }
  }, [vendorOptions, vendorId]);

  const handleConfigure = async () => {
    if (!barcode.trim()) return showPopup({ title: "Required", message: "Enter the component barcode", type: "warning", confirmText: "OK" });
    if (!vendorId) return showPopup({ title: "Required", message: "Select an approved vendor", type: "warning", confirmText: "OK" });
    if (!returnDate) return showPopup({ title: "Required", message: "Pick a return date (cannot be backdated)", type: "warning", confirmText: "OK" });
    if (stages.length === 0) return showPopup({ title: "Required", message: "Select at least one stage being done outside", type: "warning", confirmText: "OK" });

    setSubmitting(true);
    try {
      const res = await configureExternalMovement({
        barcode: barcode.trim().toUpperCase(),
        vendorId,
        returnDate,
        stagesOutside: stages,
        createdBy: currentUserEmail,
      });
      if (res?.success) {
        showPopup({ title: "Movement Configured", message: `${res.vendor} — return by ${res.return_date}. The component can now be scanned out at the Security Gate.`, type: "success", confirmText: "OK" });
        setBarcode(""); setVendorId(""); setReturnDate(""); setStages([]);
      } else {
        showPopup({ title: "Could not configure", message: res?.message || res?.error || "Failed", type: "error", confirmText: "OK" });
      }
    } catch (e) {
      showPopup({ title: "Error", message: e.message || "Failed to configure movement", type: "error", confirmText: "OK" });
    }
    setSubmitting(false);
  };

  // Report a vendor failure → request a replacement journey (PM approves).
  const handleReportFailure = async () => {
    if (!failBarcode.trim()) return showPopup({ title: "Required", message: "Enter the component barcode", type: "warning", confirmText: "OK" });
    if (!failReason.trim()) return showPopup({ title: "Required", message: "Describe what happened", type: "warning", confirmText: "OK" });
    setSubmitting(true);
    try {
      const res = await initiateReplacementJourney({
        barcode: failBarcode.trim().toUpperCase(),
        failureType: failType,
        reason: failReason.trim(),
        costLoss: Number(failCost) || 0,
        requestedBy: currentUserEmail,
      });
      if (res?.success) {
        showPopup({ title: "Request Submitted", message: res.message || "Sent to Production Manager for approval.", type: "success", confirmText: "OK" });
        // Notify the Production Manager that a request awaits approval.
        try {
          const { sendNotification, NOTIFICATION_TYPES } = await import("../utils/notificationService");
          await sendNotification(NOTIFICATION_TYPES.REPLACEMENT_REQUESTED, {
            orderNo: res.order_no || "",
            metadata: { barcode: failBarcode.trim().toUpperCase(), failure_type: failType, cost_loss: Number(failCost) || 0 },
          });
        } catch (notifErr) { console.error("Replacement-requested notification failed:", notifErr); }
        setFailBarcode(""); setFailType("damage"); setFailReason(""); setFailCost("");
      } else {
        showPopup({ title: "Could not submit", message: res?.message || res?.error || "Failed", type: "error", confirmText: "OK" });
      }
    } catch (e) {
      showPopup({ title: "Error", message: e.message || "Failed to submit request", type: "error", confirmText: "OK" });
    }
    setSubmitting(false);
  };

  return (
    <div className="phv-wrap">
      {PopupComponent}

      <div className="phv-tabs">
        <button className={`phv-tab ${tab === "movement" ? "active" : ""}`} onClick={() => setTab("movement")}>Configure External Movement</button>
        <button className={`phv-tab ${tab === "failure" ? "active" : ""}`} onClick={() => setTab("failure")}>Report Vendor Failure</button>
        <button className={`phv-tab ${tab === "vendors" ? "active" : ""}`} onClick={() => setTab("vendors")}>Vendors</button>
      </div>

      {tab === "movement" && (
        <div className="phv-card">
          <h3 className="phv-title">Send a Component to an External Vendor</h3>
          <p className="phv-hint">Configure the movement first; the Security Gate will only allow exit after this is set.</p>

          <label className="phv-label">Component Barcode</label>
          <input className="phv-input" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="e.g. DLC-000082-TOP" />

          <label className="phv-label">Vendor (approved only)</label>
          <SearchableSelect
            options={vendorOptions}
            value={vendorId}
            onChange={setVendorId}
            placeholder="Search vendor by name or stage…"
          />
          {approvedVendors.length === 0 && <p className="phv-warn">No approved vendors yet. Add one under the Vendors tab.</p>}
          {approvedVendors.length > 0 && vendorOptions.length === 0 && (
            <p className="phv-warn">No approved vendors match the selected stage(s).</p>
          )}

          <label className="phv-label">Return Date (cannot be backdated)</label>
          <input className="phv-input" type="date" min={todayStr} value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />

          <label className="phv-label">Stages being done outside</label>
          <div className="phv-stage-grid">
            {EXTERNAL_ELIGIBLE_STEPS.map((s) => (
              <label key={s.step} className={`phv-stage-pill ${stages.includes(s.step) ? "active" : ""}`}>
                <input type="checkbox" checked={stages.includes(s.step)} onChange={() => toggleStage(s.step)} />
                {s.label}
              </label>
            ))}
          </div>

          <button className="phv-submit" onClick={handleConfigure} disabled={submitting}>
            {submitting ? "Configuring…" : "Configure Movement"}
          </button>
        </div>
      )}

      {tab === "failure" && (
        <div className="phv-card">
          <h3 className="phv-title">Report Vendor Failure</h3>
          <p className="phv-hint">If a vendor damaged, lost, or misplaced a component, request a replacement journey. The Production Manager approves it; the component then resets to Cloth Issue, the cost is booked as a loss, and the Vendor Failure Ledger is updated.</p>

          <label className="phv-label">Component Barcode</label>
          <input className="phv-input" value={failBarcode} onChange={(e) => setFailBarcode(e.target.value)} placeholder="e.g. DLC-000082-TOP" />

          <label className="phv-label">Failure Type</label>
          <select className="phv-input" value={failType} onChange={(e) => setFailType(e.target.value)}>
            <option value="damage">Damaged</option>
            <option value="loss">Lost</option>
            <option value="misplacement">Misplaced</option>
          </select>

          <label className="phv-label">What happened?</label>
          <textarea className="phv-input" rows={3} value={failReason} onChange={(e) => setFailReason(e.target.value)} placeholder="Describe the failure…" />

          <label className="phv-label">Estimated Cost Loss (₹)</label>
          <input className="phv-input" type="number" value={failCost} onChange={(e) => setFailCost(e.target.value)} placeholder="0" />

          <button className="phv-submit" onClick={handleReportFailure} disabled={submitting}>
            {submitting ? "Submitting…" : "Request Replacement Journey"}
          </button>
        </div>
      )}

      {tab === "vendors" && (
        <div className="phv-card">
          <h3 className="phv-title">Vendors</h3>
          <p className="phv-hint">New vendors are requested by the Production Manager and approved by Manish. You can select any <strong>approved</strong> vendor when configuring a movement.</p>
          <div className="phv-vendor-list">
            {allVendors.length === 0 ? (
              <p className="phv-hint">No vendors yet.</p>
            ) : allVendors.map((v) => (
              <div key={v.id} className="phv-vendor-row">
                <span className="phv-vendor-name">{v.vendor_name}{v.vendor_location ? ` — ${v.vendor_location}` : ""}</span>
                <span className={`phv-status phv-status-${v.status}`}>{v.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductionHeadVendors;
