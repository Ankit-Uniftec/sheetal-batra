import React, { useState, useEffect, useCallback } from "react";
import { usePopup } from "./Popup";
import {
  fetchApprovedVendors,
  fetchAllVendors,
  configureExternalMovement,
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

  const [tab, setTab] = useState("movement"); // 'movement' | 'vendors'

  // Movement form
  const [barcode, setBarcode] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [stages, setStages] = useState([]); // logical steps
  const [submitting, setSubmitting] = useState(false);

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

  return (
    <div className="phv-wrap">
      {PopupComponent}

      <div className="phv-tabs">
        <button className={`phv-tab ${tab === "movement" ? "active" : ""}`} onClick={() => setTab("movement")}>Configure External Movement</button>
        <button className={`phv-tab ${tab === "vendors" ? "active" : ""}`} onClick={() => setTab("vendors")}>Vendors</button>
      </div>

      {tab === "movement" && (
        <div className="phv-card">
          <h3 className="phv-title">Send a Component to an External Vendor</h3>
          <p className="phv-hint">Configure the movement first; the Security Gate will only allow exit after this is set.</p>

          <label className="phv-label">Component Barcode</label>
          <input className="phv-input" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="e.g. DLC-000082-TOP" />

          <label className="phv-label">Vendor (approved only)</label>
          <select className="phv-input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">Select vendor…</option>
            {approvedVendors.map((v) => (
              <option key={v.id} value={v.id}>{v.vendor_name}{v.vendor_location ? ` — ${v.vendor_location}` : ""}</option>
            ))}
          </select>
          {approvedVendors.length === 0 && <p className="phv-warn">No approved vendors yet. Add one under the Vendors tab.</p>}

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
