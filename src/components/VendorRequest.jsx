import React, { useState, useEffect, useCallback } from "react";
import { usePopup } from "./Popup";
import { fetchAllVendors, requestVendor, SCAN_STATIONS, getStepLabel } from "../utils/barcodeService";
import "./VendorRequest.css";

/**
 * VendorRequest — Production Manager view (Rule 12).
 * The Production Manager requests new vendors here; each goes to 'pending'
 * until Manish (COO) approves it in the Vendor Approvals tab. Read-only
 * status list shows where each request stands.
 *
 * A vendor MUST be created with the stage it does, because the Production Head's
 * movement picker only offers vendors whose stage_number matches the stages going
 * outside (ProductionHeadVendors) — a stage-less vendor is invisible there and
 * renders as "Stage not set".
 */
// Stages a vendor can be engaged for — mirrors EXTERNAL_ELIGIBLE_STEPS in
// ProductionHeadVendors.jsx (logical steps 2..8, minus Pattern Cutting/QC 1
// which are not offered externally).
const VENDOR_HIDDEN_STEPS = new Set([3, 6]);
const VENDOR_STAGE_OPTIONS = SCAN_STATIONS
  .filter((s) => s.step >= 2 && s.step <= 8 && !VENDOR_HIDDEN_STEPS.has(s.step))
  .map((s) => ({ step: s.step, label: s.label }));

const VendorRequest = ({ currentUserEmail }) => {
  const { showPopup, PopupComponent } = usePopup();
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [stageStep, setStageStep] = useState("");
  const [all, setAll] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try { setAll((await fetchAllVendors()) || []); }
    catch (e) { console.error("Failed to load vendors:", e); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRequest = async () => {
    if (!name.trim()) return showPopup({ title: "Required", message: "Enter vendor name", type: "warning", confirmText: "OK" });
    if (!stageStep) return showPopup({ title: "Required", message: "Pick the stage this vendor does. Without it the vendor can't be selected for an external movement.", type: "warning", confirmText: "OK" });
    setSubmitting(true);
    try {
      await requestVendor({
        vendorName: name.trim(),
        vendorLocation: location.trim(),
        stageStep: Number(stageStep),
        requestedBy: currentUserEmail,
      });
      showPopup({ title: "Vendor Requested", message: "Sent to Manish for approval. It becomes selectable once approved.", type: "success", confirmText: "OK" });
      setName(""); setLocation(""); setStageStep("");
      load();
    } catch (e) {
      showPopup({ title: "Error", message: e.message || "Failed to request vendor", type: "error", confirmText: "OK" });
    }
    setSubmitting(false);
  };

  return (
    <div className="vr-wrap">
      {PopupComponent}
      <h2 className="vr-title">Vendors</h2>
      <p className="vr-hint">Request a new external vendor. Requests require Manish's approval before Production Heads can select them.</p>

      <div className="vr-card">
        <h3 className="vr-section">Request a New Vendor</h3>
        <label className="vr-label">Vendor Name</label>
        <input className="vr-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Premium Dyeing Co." />
        <label className="vr-label">Location</label>
        <input className="vr-input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Ludhiana" />
        <label className="vr-label">Stage</label>
        <select className="vr-input" value={stageStep} onChange={(e) => setStageStep(e.target.value)}>
          <option value="">Select the stage this vendor does…</option>
          {VENDOR_STAGE_OPTIONS.map((s) => <option key={s.step} value={String(s.step)}>{s.label}</option>)}
        </select>
        <button className="vr-submit" onClick={handleRequest} disabled={submitting}>
          {submitting ? "Requesting…" : "Request Vendor"}
        </button>
      </div>

      <h3 className="vr-section">All Vendors ({all.length})</h3>
      <div className="vr-list">
        {all.length === 0 ? <p className="vr-empty">No vendors yet.</p> : all.map((v) => (
          <div key={v.id} className="vr-row">
            <div className="vr-info">
              <span className="vr-name">{v.vendor_name}</span>
              {v.vendor_location && <span className="vr-loc">{v.vendor_location}</span>}
              <span className="vr-loc">{v.stage_name || (v.stage_number != null ? getStepLabel(v.stage_number) : "Stage not set")}</span>
            </div>
            <span className={`vr-status vr-status-${v.status}`}>{v.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default VendorRequest;
