import React, { useState, useEffect, useCallback, useMemo } from "react";
import { usePopup } from "./Popup";
import Paginator from "./Paginator";
import { SearchableSelect } from "./SearchableSelect";
import formatDate from "../utils/formatDate";
import {
  fetchApprovedVendors,
  fetchAllVendors,
  configureExternalMovement,
  initiateReplacementJourney,
  fetchAllMovements,
  updateExternalMovement,
  fetchComponentByBarcode,
  SCAN_STATIONS,
  PRODUCTION_STAGES,
  getStepLabel,
} from "../utils/barcodeService";

// The skippable (optional) production steps — mirrors the DB is_step_skippable().
// Only Cloth Issue (step 1) is mandatory now; every other step is skippable and
// a piece can be scanned/sent to a vendor for any stage in any order. Used only
// to name which stages an error refers to (the DB is the real gate).
const SKIPPABLE_STEPS = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10]);

// Distinct mandatory stage labels between the component's current step and the
// target external step (exclusive), that gate the move — e.g. current=Cloth
// Issued(1), target=Stitching(7) -> ["Embroidery", "Dry Cleaning"].
const missingMandatoryStages = (currentStep, targetStep) => {
  const seen = new Set();
  const labels = [];
  for (let step = currentStep + 1; step < targetStep; step++) {
    if (SKIPPABLE_STEPS.has(step)) continue;
    const s = PRODUCTION_STAGES.find((p) => p.step === step && p.mandatory);
    // Use a clean label (strip the "In-Progress"/"Completed" suffix).
    const name = s ? s.label.replace(/\s*(In-Progress|Completed|Passed).*$/i, "").trim() : null;
    if (name && !seen.has(name)) { seen.add(name); labels.push(name); }
  }
  return labels;
};

// Logical steps eligible for external vendor work (Rule 7: stages 2..8).
// Built from SCAN_STATIONS so labels stay in sync.
// Pattern Cutting (step 3) and QC 1 (step 6) are intentionally NOT offered as
// external stages for now (client request) — they're hidden from the picker.
const EXTERNAL_HIDDEN_STEPS = new Set([3, 6]);
const EXTERNAL_ELIGIBLE_STEPS = SCAN_STATIONS
  .filter((s) => s.step >= 2 && s.step <= 8 && !EXTERNAL_HIDDEN_STEPS.has(s.step))
  .map((s) => ({ step: s.step, label: s.label }));

// Render a stages_outside step-number array as readable stage labels. Resolve
// from the FULL stage model (getStepLabel), not the eligible-picker list, so
// historical movements to a now-hidden stage (Pattern Cutting / QC 1) still
// show their real name instead of "Step 3".
const stepLabels = (steps) => {
  if (!Array.isArray(steps) || steps.length === 0) return "—";
  return steps.map((n) => getStepLabel(n) || `Step ${n}`).join(", ");
};

const PAGE_SIZE = 10;

// Friendly messages for the configure/update RPC error codes — so the PH sees
// plain guidance instead of the raw technical DB message.
const MOVEMENT_ERROR_MESSAGES = {
  BARCODE_NOT_FOUND: "No component found with that barcode. Check and try again.",
  VENDOR_NOT_APPROVED: "That vendor isn't approved. Pick an approved vendor.",
  INVALID_RETURN_DATE: "The return date can't be in the past.",
  NO_STAGES: "Select at least one stage that goes outside.",
  INVALID_STAGE_FOR_MOVEMENT: "This piece isn't ready to go to a vendor yet — Cloth Issue must be completed first.",
  PRIOR_STAGE_IN_PROGRESS: "This piece has a stage still In-Progress. Scan it to Completed before sending it to a vendor.",
  NOT_EDITABLE: "This movement has already been scanned out, so it can no longer be edited.",
  MOVEMENT_NOT_FOUND: "That movement no longer exists.",
};
const friendlyMovementError = (res) =>
  MOVEMENT_ERROR_MESSAGES[res?.error] || res?.message || "Could not complete the request. Please try again.";

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

  // Vendors
  const [approvedVendors, setApprovedVendors] = useState([]);
  const [allVendors, setAllVendors] = useState([]);

  // Movement history + edit
  const [movements, setMovements] = useState([]);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movPage, setMovPage] = useState(1);
  const [vendorPage, setVendorPage] = useState(1);
  // Movement History filters
  const [movVendorFilter, setMovVendorFilter] = useState("");
  const [movTypeFilter, setMovTypeFilter] = useState("");      // component category
  const [movReturnFilter, setMovReturnFilter] = useState("");  // exact return date
  // Vendors tab filters
  const [vendorStageFilter, setVendorStageFilter] = useState("");
  const [vendorStatusFilter, setVendorStatusFilter] = useState("");
  const [editMov, setEditMov] = useState(null); // the movement being edited
  const [editVendorId, setEditVendorId] = useState("");
  const [editReturnDate, setEditReturnDate] = useState("");
  const [editStages, setEditStages] = useState([]);
  const [editSaving, setEditSaving] = useState(false);

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

  const loadMovements = useCallback(async () => {
    setMovementsLoading(true);
    try { setMovements(await fetchAllMovements()); setMovPage(1); }
    catch (e) { console.error("Failed to load movements:", e); }
    setMovementsLoading(false);
  }, []);

  // Distinct vendor names present in the history (for its vendor filter).
  const movVendorOptions = useMemo(() => {
    const set = new Set();
    movements.forEach((m) => { if (m.vendor_name) set.add(m.vendor_name); });
    return [...set].sort();
  }, [movements]);

  // Movement History after vendor / component-category / return-date filters.
  const filteredMovements = useMemo(() => movements.filter((m) => {
    if (movVendorFilter && m.vendor_name !== movVendorFilter) return false;
    if (movTypeFilter && m.component_type !== movTypeFilter) return false;
    if (movReturnFilter && m.return_date !== movReturnFilter) return false;
    return true;
  }), [movements, movVendorFilter, movTypeFilter, movReturnFilter]);
  useEffect(() => { setMovPage(1); }, [movVendorFilter, movTypeFilter, movReturnFilter]);

  // Vendors tab after stage / status filters.
  const filteredVendors = useMemo(() => allVendors.filter((v) => {
    if (vendorStageFilter && String(v.stage_number) !== vendorStageFilter) return false;
    if (vendorStatusFilter && v.status !== vendorStatusFilter) return false;
    return true;
  }), [allVendors, vendorStageFilter, vendorStatusFilter]);
  useEffect(() => { setVendorPage(1); }, [vendorStageFilter, vendorStatusFilter]);

  // Open the edit modal for a still-'configured' movement.
  const openEdit = (m) => {
    setEditMov(m);
    setEditVendorId(m.vendor_id || "");
    setEditReturnDate(m.return_date || "");
    setEditStages(Array.isArray(m.stages_outside) ? m.stages_outside : []);
  };
  const toggleEditStage = (step) =>
    setEditStages((prev) => prev.includes(step) ? prev.filter((s) => s !== step) : [...prev, step]);

  // Build the error message for a failed configure/update. For the stage guard
  // (INVALID_STAGE_FOR_MOVEMENT) it fetches the component and names the exact
  // mandatory stages still to be done before it can go out — instead of a vague
  // generic hint.
  const stageAwareError = async (res, bc, selectedStages) => {
    if (res?.error !== "INVALID_STAGE_FOR_MOVEMENT") return friendlyMovementError(res);
    try {
      const comp = await fetchComponentByBarcode(bc);
      const curStep = (PRODUCTION_STAGES.find((p) => p.value === comp.current_stage)?.step) ?? 0;
      const earliest = Math.min(...(selectedStages.length ? selectedStages : [1]));
      const missing = missingMandatoryStages(curStep, earliest);
      const target = EXTERNAL_ELIGIBLE_STEPS.find((s) => s.step === earliest)?.label || "the selected stage";
      if (missing.length > 0) {
        const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
        return `This piece must complete ${list} before it can go out for ${target}.`;
      }
    } catch { /* fall through to generic */ }
    return friendlyMovementError(res);
  };

  const handleUpdateMovement = async () => {
    if (!editVendorId) return showPopup({ title: "Required", message: "Select an approved vendor", type: "warning", confirmText: "OK" });
    if (!editReturnDate) return showPopup({ title: "Required", message: "Pick a return date", type: "warning", confirmText: "OK" });
    if (editStages.length === 0) return showPopup({ title: "Required", message: "Select at least one stage", type: "warning", confirmText: "OK" });
    setEditSaving(true);
    try {
      const res = await updateExternalMovement({
        movementId: editMov.id,
        vendorId: editVendorId,
        returnDate: editReturnDate,
        stagesOutside: editStages,
        updatedBy: currentUserEmail,
      });
      if (res?.success) {
        showPopup({ title: "Movement Updated", message: `Now sent to ${res.vendor} — return by ${res.return_date}.`, type: "success", confirmText: "OK" });
        setEditMov(null);
        loadMovements();
      } else {
        const msg = await stageAwareError(res, editMov.barcode, editStages);
        showPopup({ title: "Could not update", message: msg, type: "error", confirmText: "OK" });
      }
    } catch (e) {
      showPopup({ title: "Error", message: e.message || "Failed to update movement", type: "error", confirmText: "OK" });
    }
    setEditSaving(false);
  };

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
        showPopup({ title: "Movement Configured", message: `Sent to ${res.vendor} — return by ${res.return_date}. It can now be scanned out at the Security Gate.`, type: "success", confirmText: "OK" });
        setBarcode(""); setVendorId(""); setReturnDate(""); setStages([]);
      } else {
        const msg = await stageAwareError(res, barcode.trim().toUpperCase(), stages);
        showPopup({ title: "Could not configure", message: msg, type: "error", confirmText: "OK" });
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
        costLoss: 0, // cost-loss field removed from the form (client request)
        requestedBy: currentUserEmail,
      });
      if (res?.success) {
        showPopup({ title: "Request Submitted", message: res.message || "Sent to Production Manager for approval.", type: "success", confirmText: "OK" });
        // Notify the Production Manager that a request awaits approval.
        try {
          const { sendNotification, NOTIFICATION_TYPES } = await import("../utils/notificationService");
          await sendNotification(NOTIFICATION_TYPES.REPLACEMENT_REQUESTED, {
            orderNo: res.order_no || "",
            metadata: { barcode: failBarcode.trim().toUpperCase(), failure_type: failType, cost_loss: 0 },
          });
        } catch (notifErr) { console.error("Replacement-requested notification failed:", notifErr); }
        setFailBarcode(""); setFailType("damage"); setFailReason("");
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
        <button className={`phv-tab ${tab === "history" ? "active" : ""}`} onClick={() => { setTab("history"); loadMovements(); }}>Movement History</button>
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

          <button className="phv-submit" onClick={handleReportFailure} disabled={submitting}>
            {submitting ? "Submitting…" : "Request Replacement Journey"}
          </button>
        </div>
      )}

      {tab === "vendors" && (
        <div className="phv-card">
          <h3 className="phv-title">Vendors</h3>
          <p className="phv-hint">New vendors are requested by the Production Manager and approved by Manish. You can select any <strong>approved</strong> vendor when configuring a movement.</p>
          <div className="phv-filter-bar">
            <select value={vendorStageFilter} onChange={(e) => setVendorStageFilter(e.target.value)} className="phv-filter-select">
              <option value="">All stages</option>
              {EXTERNAL_ELIGIBLE_STEPS.map((s) => <option key={s.step} value={String(s.step)}>{s.label}</option>)}
            </select>
            <select value={vendorStatusFilter} onChange={(e) => setVendorStatusFilter(e.target.value)} className="phv-filter-select">
              <option value="">All statuses</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </select>
            {(vendorStageFilter || vendorStatusFilter) && (
              <button className="phv-filter-clear" onClick={() => { setVendorStageFilter(""); setVendorStatusFilter(""); }}>Clear</button>
            )}
          </div>

          {filteredVendors.length === 0 ? (
            <p className="phv-hint">{allVendors.length === 0 ? "No vendors yet." : "No vendors match the filters."}</p>
          ) : (
            <>
              <div className="phv-vendor-list">
                {filteredVendors.slice((vendorPage - 1) * PAGE_SIZE, vendorPage * PAGE_SIZE).map((v) => (
                  <div key={v.id} className="phv-vendor-row">
                    <div className="phv-vendor-info">
                      <span className="phv-vendor-name">{v.vendor_name}{v.vendor_location ? ` — ${v.vendor_location}` : ""}</span>
                      <span className="phv-vendor-stage">{v.stage_name || (v.stage_number != null ? stepLabels([v.stage_number]) : "Stage not set")}</span>
                    </div>
                    <span className={`phv-status phv-status-${v.status}`}>{v.status}</span>
                  </div>
                ))}
              </div>
              <Paginator page={vendorPage} totalPages={Math.ceil(filteredVendors.length / PAGE_SIZE)} onChange={setVendorPage} />
            </>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="phv-card">
          <h3 className="phv-title">Movement History</h3>
          <p className="phv-hint">Configured external movements. A movement can be edited only while it's still <strong>configured</strong> (before the component is scanned out); exited/returned movements are read-only history.</p>
          <div className="phv-filter-bar">
            <select value={movVendorFilter} onChange={(e) => setMovVendorFilter(e.target.value)} className="phv-filter-select">
              <option value="">All vendors</option>
              {movVendorOptions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select value={movTypeFilter} onChange={(e) => setMovTypeFilter(e.target.value)} className="phv-filter-select">
              <option value="">All components</option>
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
              <option value="dupatta">Dupatta</option>
              <option value="extra">Extra</option>
            </select>
            <label className="phv-filter-date">
              Return date
              <input type="date" value={movReturnFilter} onChange={(e) => setMovReturnFilter(e.target.value)} />
            </label>
            {(movVendorFilter || movTypeFilter || movReturnFilter) && (
              <button className="phv-filter-clear" onClick={() => { setMovVendorFilter(""); setMovTypeFilter(""); setMovReturnFilter(""); }}>Clear</button>
            )}
          </div>

          {movementsLoading ? (
            <p className="phv-hint">Loading…</p>
          ) : filteredMovements.length === 0 ? (
            <p className="phv-hint">{movements.length === 0 ? "No external movements configured yet." : "No movements match the filters."}</p>
          ) : (
            <>
              <div className="phv-mov-list">
                {filteredMovements.slice((movPage - 1) * PAGE_SIZE, movPage * PAGE_SIZE).map((m) => (
                  <div key={m.id} className={`phv-mov-row phv-mov-${m.status}`}>
                    <div className="phv-mov-main">
                      <span className="phv-mov-bc">
                        {m.barcode || "—"}
                        {m.component_type && <span className="phv-mov-type"> · {m.component_type.charAt(0).toUpperCase() + m.component_type.slice(1)}</span>}
                      </span>
                      <span className="phv-mov-vendor">{m.vendor_name}{m.vendor_location ? ` · ${m.vendor_location}` : ""}</span>
                      <span className="phv-mov-stages">{stepLabels(m.stages_outside)}</span>
                    </div>
                    <div className="phv-mov-meta">
                      <span>Ordered {m.order_created_at ? formatDate(m.order_created_at) : "—"}</span>
                      <span>Return by {m.return_date ? formatDate(m.return_date) : "—"}</span>
                      <span className={`phv-status phv-status-${m.status}`}>{m.status}</span>
                      {m.status === "configured" ? (
                        <button className="phv-mov-edit" onClick={() => openEdit(m)}>Edit</button>
                      ) : (
                        <span className="phv-mov-locked" title="Only configured movements can be edited">locked</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <Paginator page={movPage} totalPages={Math.ceil(filteredMovements.length / PAGE_SIZE)} onChange={setMovPage} />
            </>
          )}
        </div>
      )}

      {/* Edit modal — configured movements only */}
      {editMov && (
        <div className="phv-modal-overlay" onClick={() => setEditMov(null)}>
          <div className="phv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="phv-modal-head">
              <h3 className="phv-title" style={{ margin: 0 }}>Edit Movement — {editMov.barcode}</h3>
              <button className="phv-modal-close" onClick={() => setEditMov(null)}>×</button>
            </div>

            <label className="phv-label">Vendor (approved only)</label>
            <SearchableSelect
              options={vendorOptions}
              value={editVendorId}
              onChange={setEditVendorId}
              placeholder="Search vendor by name or stage…"
            />

            <label className="phv-label">Return Date (cannot be backdated)</label>
            <input className="phv-input" type="date" min={todayStr} value={editReturnDate} onChange={(e) => setEditReturnDate(e.target.value)} />

            <label className="phv-label">Stages being done outside</label>
            <div className="phv-stage-grid">
              {EXTERNAL_ELIGIBLE_STEPS.map((s) => (
                <label key={s.step} className={`phv-stage-pill ${editStages.includes(s.step) ? "active" : ""}`}>
                  <input type="checkbox" checked={editStages.includes(s.step)} onChange={() => toggleEditStage(s.step)} />
                  {s.label}
                </label>
              ))}
            </div>

            <button className="phv-submit" onClick={handleUpdateMovement} disabled={editSaving}>
              {editSaving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductionHeadVendors;
