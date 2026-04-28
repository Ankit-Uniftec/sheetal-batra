import React, { useState, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import {
  advanceComponentStage,
  fetchComponentByBarcode,
  fetchOrderComponents,
  fetchTransitionHistory,
  recordOverride,
  PRODUCTION_STAGES,
  REJOURNEY_STAGES,
  getStageLabel,
  getStageColor,
} from "../utils/barcodeService";

const ProductionOverrides = ({ currentUserEmail }) => {
  const [searchBarcode, setSearchBarcode] = useState("");
  const [searchOrderNo, setSearchOrderNo] = useState("");
  const [component, setComponent] = useState(null);
  const [orderComponents, setOrderComponents] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionResult, setActionResult] = useState(null);

  // Override form
  const [overrideType, setOverrideType] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [targetStage, setTargetStage] = useState("");
  const [extendDays, setExtendDays] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Search by barcode
  const handleBarcodeSearch = async () => {
    if (!searchBarcode.trim()) return;
    setLoading(true);
    setActionResult(null);
    try {
      const comp = await fetchComponentByBarcode(searchBarcode.trim().toUpperCase());
      setComponent(comp);
      const allComps = await fetchOrderComponents(comp.order_id);
      setOrderComponents(allComps);
      const hist = await fetchTransitionHistory(comp.id);
      setHistory(hist);
    } catch (err) {
      setActionResult({ success: false, message: "Component not found: " + err.message });
      setComponent(null);
    }
    setLoading(false);
  };

  // Search by order number
  const handleOrderSearch = async () => {
    if (!searchOrderNo.trim()) return;
    setLoading(true);
    setActionResult(null);
    try {
      const { data: orders } = await supabase
        .from("orders")
        .select("id, order_no")
        .ilike("order_no", `%${searchOrderNo.trim()}%`)
        .limit(1);

      if (orders && orders.length > 0) {
        const allComps = await fetchOrderComponents(orders[0].id);
        setOrderComponents(allComps);
        if (allComps.length > 0) {
          setComponent(allComps[0]);
          const hist = await fetchTransitionHistory(allComps[0].id);
          setHistory(hist);
        }
      } else {
        setActionResult({ success: false, message: "Order not found" });
      }
    } catch (err) {
      setActionResult({ success: false, message: err.message });
    }
    setLoading(false);
  };

  // Select a specific component from the list
  const selectComponent = async (comp) => {
    setComponent(comp);
    try {
      const hist = await fetchTransitionHistory(comp.id);
      setHistory(hist);
    } catch (err) {
      console.error("Failed to fetch history:", err);
    }
    setOverrideType("");
    setOverrideReason("");
    setTargetStage("");
    setExtendDays("");
    setActionResult(null);
  };

  // Submit override
  const handleOverrideSubmit = async () => {
    if (!component) return;
    if (!overrideReason.trim()) {
      setActionResult({ success: false, message: "Reason is mandatory for all overrides" });
      return;
    }

    setIsSubmitting(true);
    setActionResult(null);

    try {
      if (overrideType === "manual_advance") {
        if (!targetStage) {
          setActionResult({ success: false, message: "Select a target stage" });
          setIsSubmitting(false);
          return;
        }

        // Advance the component
        const result = await advanceComponentStage(
          component.barcode,
          targetStage,
          currentUserEmail,
          "Production Head Override",
          overrideReason,
          "manual_override"
        );

        if (result.success) {
          // Log the override
          await recordOverride({
            componentId: component.id,
            orderId: component.order_id,
            orderNo: component.order_no,
            barcode: component.barcode,
            overrideType: "manual_advance",
            fromStage: component.current_stage,
            toStage: targetStage,
            reason: overrideReason,
            overriddenBy: currentUserEmail,
          });

          setActionResult({ success: true, message: `Manually advanced to ${getStageLabel(targetStage)}` });

          // Refresh component
          const updated = await fetchComponentByBarcode(component.barcode);
          setComponent(updated);
          const hist = await fetchTransitionHistory(updated.id);
          setHistory(hist);
          const allComps = await fetchOrderComponents(updated.order_id);
          setOrderComponents(allComps);
        } else {
          setActionResult({ success: false, message: result.message });
        }

      } else if (overrideType === "skip_stage") {
        if (!targetStage) {
          setActionResult({ success: false, message: "Select which stage to skip to" });
          setIsSubmitting(false);
          return;
        }

        const result = await advanceComponentStage(
          component.barcode,
          targetStage,
          currentUserEmail,
          "Production Head Override",
          "Skip: " + overrideReason,
          "manual_override"
        );

        if (result.success) {
          await recordOverride({
            componentId: component.id,
            orderId: component.order_id,
            orderNo: component.order_no,
            barcode: component.barcode,
            overrideType: "skip_stage",
            fromStage: component.current_stage,
            toStage: targetStage,
            reason: overrideReason,
            overriddenBy: currentUserEmail,
          });

          setActionResult({ success: true, message: `Skipped to ${getStageLabel(targetStage)}` });

          const updated = await fetchComponentByBarcode(component.barcode);
          setComponent(updated);
          const hist = await fetchTransitionHistory(updated.id);
          setHistory(hist);
          const allComps = await fetchOrderComponents(updated.order_id);
          setOrderComponents(allComps);
        } else {
          setActionResult({ success: false, message: result.message });
        }

      } else if (overrideType === "timeline_extension") {
        const days = parseInt(extendDays);
        if (!days || days <= 0) {
          setActionResult({ success: false, message: "Enter valid number of days" });
          setIsSubmitting(false);
          return;
        }

        const newDeadline = new Date();
        newDeadline.setDate(newDeadline.getDate() + days);

        // Update component deadline directly
        const { error } = await supabase
          .from("order_components")
          .update({
            stage_deadline: newDeadline.toISOString(),
            is_delayed: false,
            delay_days: 0,
          })
          .eq("id", component.id);

        if (!error) {
          await recordOverride({
            componentId: component.id,
            orderId: component.order_id,
            orderNo: component.order_no,
            barcode: component.barcode,
            overrideType: "timeline_extension",
            fromStage: component.current_stage,
            toStage: component.current_stage,
            reason: overrideReason,
            overriddenBy: currentUserEmail,
            originalDeadline: component.stage_deadline,
            newDeadline: newDeadline.toISOString(),
            extendedDays: days,
          });

          setActionResult({ success: true, message: `Timeline extended by ${days} days` });

          const updated = await fetchComponentByBarcode(component.barcode);
          setComponent(updated);
          const allComps = await fetchOrderComponents(updated.order_id);
          setOrderComponents(allComps);
        } else {
          setActionResult({ success: false, message: error.message });
        }
      }
    } catch (err) {
      setActionResult({ success: false, message: err.message });
    }

    setIsSubmitting(false);
    setOverrideType("");
    setOverrideReason("");
    setTargetStage("");
    setExtendDays("");
  };

  // Get stages that come after current stage (for manual advance)
  const getAdvanceableStages = () => {
    if (!component) return [];
    const currentIdx = PRODUCTION_STAGES.findIndex(s => s.value === component.current_stage);
    return PRODUCTION_STAGES.filter((s, idx) => idx > currentIdx && !["disposed", "scrapped"].includes(s.value));
  };

  return (
    <div className="pm-override-section">
      <h2 className="pm-tab-title">Scan & Overrides</h2>

      {/* Search Section */}
      <div className="pm-override-search">
        <div className="pm-override-search-row">
          <div className="pm-override-search-group">
            <label>Search by Barcode</label>
            <div className="pm-override-input-row">
              <input
                type="text"
                value={searchBarcode}
                onChange={e => setSearchBarcode(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleBarcodeSearch()}
                placeholder="e.g. DLC-000023-TOP"
                style={{ fontFamily: "monospace" }}
              />
              <button onClick={handleBarcodeSearch} disabled={loading}>Search</button>
            </div>
          </div>
          <div className="pm-override-search-group">
            <label>Search by Order Number</label>
            <div className="pm-override-input-row">
              <input
                type="text"
                value={searchOrderNo}
                onChange={e => setSearchOrderNo(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleOrderSearch()}
                placeholder="e.g. 000023"
              />
              <button onClick={handleOrderSearch} disabled={loading}>Search</button>
            </div>
          </div>
        </div>
      </div>

      {loading && <p style={{ textAlign: "center", color: "#999", padding: 20 }}>Loading...</p>}

      {/* Action Result */}
      {actionResult && (
        <div className={`pm-override-result ${actionResult.success ? "pm-result-success" : "pm-result-error"}`}>
          {actionResult.message}
        </div>
      )}

      {/* All Components List */}
      {orderComponents.length > 0 && (
        <div className="pm-override-components">
          <h3 className="pm-override-subtitle">
            Components {component?.order_no ? `\u2014 ${component.order_no}` : ""}
          </h3>
          <div className="pm-override-comp-grid">
            {orderComponents.map(comp => (
              <div
                key={comp.id}
                className={`pm-override-comp-card ${component?.id === comp.id ? "pm-comp-selected" : ""} ${comp.is_delayed ? "pm-comp-delayed" : ""}`}
                onClick={() => selectComponent(comp)}
              >
                <div className="pm-comp-card-top">
                  <span className="pm-comp-card-barcode">{comp.barcode}</span>
                  <span
                    className="pm-comp-card-stage"
                    style={{ backgroundColor: getStageColor(comp.current_stage) }}
                  >
                    {getStageLabel(comp.current_stage)}
                  </span>
                </div>
                <div className="pm-comp-card-bottom">
                  <span className="pm-comp-card-label">{comp.component_label || comp.component_type}</span>
                  <div className="pm-comp-card-tags">
                    {!comp.is_active && <span className="pm-tag pm-tag-inactive">Inactive</span>}
                    {comp.is_delayed && <span className="pm-tag pm-tag-delayed">Delayed</span>}
                    {comp.is_outside_wh && <span className="pm-tag pm-tag-vendor">At Vendor</span>}
                    {comp.re_journey_count > 0 && <span className="pm-tag pm-tag-rework">Rework {comp.re_journey_count}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Selected Component Detail + Override Actions */}
      {component && (
        <div className="pm-override-detail">
          <div className="pm-override-detail-grid">
            <div className="pm-override-detail-item">
              <span className="pm-detail-label">Barcode</span>
              <span className="pm-detail-value" style={{ fontFamily: "monospace" }}>{component.barcode}</span>
            </div>
            <div className="pm-override-detail-item">
              <span className="pm-detail-label">Current Stage</span>
              <span className="pm-comp-card-stage" style={{ backgroundColor: getStageColor(component.current_stage) }}>
                {getStageLabel(component.current_stage)}
              </span>
            </div>
            <div className="pm-override-detail-item">
              <span className="pm-detail-label">QC Status</span>
              <span className="pm-detail-value">{component.qc_status || "pending"}</span>
            </div>
            <div className="pm-override-detail-item">
              <span className="pm-detail-label">Re-journeys</span>
              <span className="pm-detail-value">{component.re_journey_count || 0}</span>
            </div>
            {component.orders && (
              <>
                <div className="pm-override-detail-item">
                  <span className="pm-detail-label">Client</span>
                  <span className="pm-detail-value">{component.orders.delivery_name}</span>
                </div>
                <div className="pm-override-detail-item">
                  <span className="pm-detail-label">Delivery Date</span>
                  <span className="pm-detail-value">{component.orders.delivery_date}</span>
                </div>
              </>
            )}
          </div>

          {/* Override Actions */}
          {!["disposed", "scrapped", "dispatched"].includes(component.current_stage) && (
            <div className="pm-override-actions">
              <h4 className="pm-override-actions-title">Override Actions</h4>

              <div className="pm-override-type-btns">
                <button
                  className={`pm-override-type-btn ${overrideType === "manual_advance" ? "active" : ""}`}
                  onClick={() => setOverrideType("manual_advance")}
                >
                  Manual Advance
                </button>
                <button
                  className={`pm-override-type-btn ${overrideType === "skip_stage" ? "active" : ""}`}
                  onClick={() => setOverrideType("skip_stage")}
                >
                  Skip Stage
                </button>
                <button
                  className={`pm-override-type-btn ${overrideType === "timeline_extension" ? "active" : ""}`}
                  onClick={() => setOverrideType("timeline_extension")}
                >
                  Extend Timeline
                </button>
              </div>

              {overrideType && (
                <div className="pm-override-form">
                  {(overrideType === "manual_advance" || overrideType === "skip_stage") && (
                    <div className="pm-override-field">
                      <label>{overrideType === "manual_advance" ? "Advance to Stage" : "Skip to Stage"}</label>
                      <select value={targetStage} onChange={e => setTargetStage(e.target.value)}>
                        <option value="">Select stage...</option>
                        {getAdvanceableStages().map(s => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {overrideType === "timeline_extension" && (
                    <div className="pm-override-field">
                      <label>Extend by (days)</label>
                      <input
                        type="number"
                        value={extendDays}
                        onChange={e => setExtendDays(e.target.value)}
                        placeholder="e.g. 5"
                        min="1"
                      />
                    </div>
                  )}

                  <div className="pm-override-field">
                    <label>Reason (mandatory)</label>
                    <textarea
                      value={overrideReason}
                      onChange={e => setOverrideReason(e.target.value)}
                      placeholder="e.g. Scanner malfunction, pre-dyed fabric, complex embroidery design..."
                      rows={3}
                    />
                  </div>

                  <button
                    className="pm-override-submit-btn"
                    onClick={handleOverrideSubmit}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "Processing..." : "Apply Override"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Stage History Timeline */}
          {history.length > 0 && (
            <div className="pm-override-history">
              <h4>Stage History</h4>
              <div className="pm-timeline">
                {history.map((t) => (
                  <div key={t.id} className="pm-timeline-item">
                    <div className="pm-timeline-dot" style={{ backgroundColor: getStageColor(t.to_stage) }} />
                    <div className="pm-timeline-content">
                      <p className="pm-timeline-stage">
                        {t.from_stage ? `${getStageLabel(t.from_stage)} \u2192 ` : ""}{getStageLabel(t.to_stage)}
                      </p>
                      <p className="pm-timeline-meta">
                        {t.scanned_by} {"\u2022"} {new Date(t.scanned_at).toLocaleString()}
                        {t.transition_type !== "scan" && <span className="pm-timeline-type"> ({t.transition_type})</span>}
                      </p>
                      {t.notes && <p className="pm-timeline-notes">{t.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProductionOverrides;