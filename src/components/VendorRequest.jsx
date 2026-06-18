import React, { useState, useEffect, useCallback } from "react";
import { usePopup } from "./Popup";
import { fetchAllVendors, requestVendor } from "../utils/barcodeService";
import "./VendorRequest.css";

/**
 * VendorRequest — Production Manager view (Rule 12).
 * The Production Manager requests new vendors here; each goes to 'pending'
 * until Manish (COO) approves it in the Vendor Approvals tab. Read-only
 * status list shows where each request stands.
 */
const VendorRequest = ({ currentUserEmail }) => {
  const { showPopup, PopupComponent } = usePopup();
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [all, setAll] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try { setAll((await fetchAllVendors()) || []); }
    catch (e) { console.error("Failed to load vendors:", e); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRequest = async () => {
    if (!name.trim()) return showPopup({ title: "Required", message: "Enter vendor name", type: "warning", confirmText: "OK" });
    setSubmitting(true);
    try {
      await requestVendor({ vendorName: name.trim(), vendorLocation: location.trim(), requestedBy: currentUserEmail });
      showPopup({ title: "Vendor Requested", message: "Sent to Manish for approval. It becomes selectable once approved.", type: "success", confirmText: "OK" });
      setName(""); setLocation("");
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
            </div>
            <span className={`vr-status vr-status-${v.status}`}>{v.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default VendorRequest;
