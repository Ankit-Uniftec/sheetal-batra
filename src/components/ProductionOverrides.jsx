import React, { useState, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import FactoryBadge from "./FactoryBadge";
import {
  fetchComponentByBarcode,
  fetchOrderComponents,
  fetchTransitionHistory,
  fetchMovementHistory,
  securityGuardScan,
  enrichComponentsWithMovements,
  describeTransition,
  buildStagePassMap,
  getStagesOutsideLabel,
  recordOverride,
  PRODUCTION_STAGES,
  REJOURNEY_STAGES,
  getStageLabel,
  getComponentStageLabel,
  getStageColor,
} from "../utils/barcodeService";
import ScanKindTag from "./ScanKindTag";
import { getWarehouseDate } from "../utils/warehouseDate";
import formatDate from "../utils/formatDate";
import { applyStageOverride, OVERRIDE_KINDS } from "../utils/stageOverride";
import StageRequestsPanel from "./StageRequestsPanel";

const ProductionOverrides = ({ currentUserEmail }) => {
  const [searchBarcode, setSearchBarcode] = useState("");
  const [searchOrderNo, setSearchOrderNo] = useState("");
  // Several orders matched the order search: listed for the PM to pick one.
  const [orderMatches, setOrderMatches] = useState([]);
  const [component, setComponent] = useState(null);
  const [orderComponents, setOrderComponents] = useState([]);
  const [history, setHistory] = useState([]);
  const [movements, setMovements] = useState([]);
  // Pass number per timeline row, rebuilt from this component's scan history so
  // a re-journeyed stage reads "Cloth Issued (2)" on the row itself.
  const historyPassMap = useMemo(() => buildStagePassMap(history), [history]);
  const [loading, setLoading] = useState(false);
  const [actionResult, setActionResult] = useState(null);

  // Override form
  const [overrideType, setOverrideType] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [targetStage, setTargetStage] = useState("");
  const [extendDays, setExtendDays] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load a component's scan history + its vendor trips together, so the
  // timeline can name the stage each security exit/entry was for and tag it
  // Internal vs External (shared describeTransition).
  const loadHistoryAndMovements = async (componentId) => {
    const [hist, movs] = await Promise.all([
      fetchTransitionHistory(componentId),
      fetchMovementHistory(componentId),
    ]);
    setHistory(hist);
    setMovements(movs);
  };

  // Fetch an order's components and attach stages_outside for any out at a
  // vendor, so the stage badge reads "Out to Vendor (Embroidery)".
  const loadOrderComponents = async (orderId) => {
    const comps = await enrichComponentsWithMovements(await fetchOrderComponents(orderId));
    setOrderComponents(comps);
    return comps;
  };

  // Search by barcode
  const handleBarcodeSearch = async () => {
    if (!searchBarcode.trim()) return;
    setLoading(true);
    setActionResult(null);
    try {
      const comp = await fetchComponentByBarcode(searchBarcode.trim().toUpperCase());
      const [enriched] = await enrichComponentsWithMovements([comp]);
      setComponent(enriched || comp);
      await loadOrderComponents(comp.order_id);
      await loadHistoryAndMovements(comp.id);
    } catch (err) {
      setActionResult({ success: false, message: "Component not found: " + err.message });
      setComponent(null);
    }
    setLoading(false);
  };

  // Open one order: load its pieces and select the first. An order with no
  // barcodes yet (a flagged web order, an unminted stock order) has nothing to
  // override, so say so instead of leaving the screen silently empty.
  const openOrder = async (order) => {
    setOrderMatches([]);
    const allComps = await loadOrderComponents(order.id);
    if (allComps.length > 0) {
      setComponent(allComps[0]);
      await loadHistoryAndMovements(allComps[0].id);
    } else {
      setComponent(null);
      setHistory([]);
      setMovements([]);
      setActionResult({ success: false, message: `${order.order_no} has no barcodes yet, so there is nothing to override.` });
    }
  };

  // Search by our order number OR Shopify's (meeting point 15).
  //
  // Our number matches as a substring, so "000023" still finds
  // SB-DLC-0726-000023. Shopify's is matched EXACTLY on shopify_order_name
  // ("#28166"), typed with or without the "#".
  //
  // Every match is shown when there is more than one. The old search took the
  // first substring hit (limit 1), so a short number could silently open the
  // wrong order — on the screen where the next click forces a stage.
  //
  // Two plain queries merged here rather than one .or(): the typed text goes
  // into a PostgREST filter string, where a comma or bracket would break it.
  const handleOrderSearch = async () => {
    const raw = searchOrderNo.trim();
    if (!raw) return;
    setLoading(true);
    setActionResult(null);
    setOrderMatches([]);
    setComponent(null);
    setOrderComponents([]);
    try {
      const cols = "id, order_no, shopify_order_name, created_at";
      const likeTerm = raw.replace(/[\\%_]/g, (m) => `\\${m}`);
      const shopifyDigits = /^#?\d{3,7}$/.test(raw) ? raw.replace(/^#/, "") : null;

      const [byOrderNo, byShopify] = await Promise.all([
        supabase.from("orders").select(cols).ilike("order_no", `%${likeTerm}%`)
          .order("created_at", { ascending: false }).limit(20),
        shopifyDigits
          ? supabase.from("orders").select(cols).eq("shopify_order_name", `#${shopifyDigits}`).limit(20)
          : Promise.resolve({ data: [] }),
      ]);
      if (byOrderNo.error) throw byOrderNo.error;
      if (byShopify.error) throw byShopify.error;

      // Exact hits first (the full order number, or the Shopify number), then
      // newest first. De-duplicated: one order can match both ways.
      const seen = new Set();
      const isExact = (o) =>
        (o.order_no || "").toUpperCase() === raw.toUpperCase() ||
        (shopifyDigits && o.shopify_order_name === `#${shopifyDigits}`);
      const matches = [...(byShopify.data || []), ...(byOrderNo.data || [])]
        .filter((o) => (seen.has(o.id) ? false : seen.add(o.id)))
        .sort((a, b) => (isExact(b) - isExact(a)) || (new Date(b.created_at) - new Date(a.created_at)));

      if (matches.length === 0) {
        setActionResult({ success: false, message: `No order found for "${raw}".` });
      } else if (matches.length === 1) {
        await openOrder(matches[0]);
      } else {
        setOrderMatches(matches);
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
      await loadHistoryAndMovements(comp.id);
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
      if (overrideType === "manual_advance" || overrideType === "skip_stage") {
        if (!targetStage) {
          setActionResult({ success: false, message: overrideType === "skip_stage" ? "Select which stage to skip to" : "Select a target stage" });
          setIsSubmitting(false);
          return;
        }

        // Shared with approving a floor request (utils/stageOverride) — the
        // override itself plus its stage_overrides log.
        const result = await applyStageOverride({
          component,
          kind: overrideType,
          targetStage,
          reason: overrideReason,
          by: currentUserEmail,
        });

        if (result.success) {
          setActionResult({ success: true, message: `${OVERRIDE_KINDS[overrideType].doneLabel} ${getStageLabel(targetStage)}` });

          // Refresh component
          const updated = await fetchComponentByBarcode(component.barcode);
          const [enriched] = await enrichComponentsWithMovements([updated]);
          setComponent(enriched || updated);
          await loadHistoryAndMovements(updated.id);
          await loadOrderComponents(updated.order_id);
        } else {
          setActionResult({ success: false, message: result.message });
        }

      } else if (overrideType === "vendor_return") {
        // The piece is physically back but the Security Gate entry scan never
        // happened, so is_outside_wh is still TRUE and the DB refuses every
        // other override (COMPONENT_OUTSIDE_WH). This fires the SAME gate-entry
        // event the guard would have — same RPC, same vendor-stage completion
        // and pointer advance — stamped with the PM's email and the reason.
        // See db/barcode_system/v2/86_pm_force_vendor_return.sql.
        const result = await securityGuardScan({
          barcode: component.barcode,
          scanType: "entry",
          scannedBy: currentUserEmail,
          notes: `PM override — no gate entry scan. ${overrideReason.trim()}`,
          // Release 6: also bypasses "not completed at SB WH Delhi (2)".
          force: true,
        });

        if (result.success) {
          // Audit it like the other three. Without this the reason lived ONLY in
          // the movement-history notes, so a vendor return was invisible to any
          // override report — the one override type that bypasses a physical
          // security scan is the one most worth being able to review.
          await recordOverride({
            componentId: component.id,
            orderId: component.order_id,
            orderNo: component.order_no,
            barcode: component.barcode,
            overrideType: "vendor_return",
            fromStage: component.current_stage,
            toStage: component.current_stage,
            reason: overrideReason.trim(),
            overriddenBy: currentUserEmail,
          });

          setActionResult({ success: true, message: result.message || "Returned from vendor." });

          const updated = await fetchComponentByBarcode(component.barcode);
          const [enriched] = await enrichComponentsWithMovements([updated]);
          setComponent(enriched || updated);
          await loadHistoryAndMovements(updated.id);
          await loadOrderComponents(updated.order_id);
        } else {
          setActionResult({ success: false, message: result.message || result.error });
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
          const [enriched] = await enrichComponentsWithMovements([updated]);
          setComponent(enriched || updated);
          await loadOrderComponents(updated.order_id);
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

  // Stages a Production Head can override to. Override is the full-bypass
  // correction tool, so it offers EVERY stage — forward OR backward — not just
  // the ones after the current stage (a common reason to override is pushing a
  // piece BACK to an earlier stage). Terminal states are excluded. The DB
  // (advance_component_stage, manual_override) accepts any direction; this must
  // match, or the PH can't request a backward correction.
  const getAdvanceableStages = () => {
    if (!component) return [];
    return PRODUCTION_STAGES.filter((s) =>
      !["disposed", "scrapped", "order_received"].includes(s.value)
    );
  };

  return (
    <div className="pm-override-section">
      <h2 className="pm-tab-title">Scan & Overrides</h2>

      {/* Skip / advance requests from production heads (meeting point 5) —
          here in Overrides, as asked, rather than a menu item of its own.
          An approval moves pieces, so whatever order is open below reloads. */}
      <StageRequestsPanel
        currentUserEmail={currentUserEmail}
        onApplied={() => { if (component?.order_id) loadOrderComponents(component.order_id).catch(() => {}); }}
      />

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
            <label>Search by Order No or Shopify No</label>
            <div className="pm-override-input-row">
              <input
                type="text"
                value={searchOrderNo}
                onChange={e => setSearchOrderNo(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleOrderSearch()}
                placeholder="e.g. 000023 or #28166"
              />
              <button onClick={handleOrderSearch} disabled={loading}>Search</button>
            </div>
          </div>
        </div>
      </div>

      {loading && <p style={{ textAlign: "center", color: "#999", padding: 20 }}>Loading...</p>}

      {/* More than one order matched: the PM picks, the screen never guesses. */}
      {orderMatches.length > 0 && (
        <div className="pm-override-matches">
          <p className="pm-override-matches-title">
            {orderMatches.length} orders match "{searchOrderNo.trim()}" — pick one
            {orderMatches.length === 20 ? " (showing the first 20; type more of the number to narrow it)" : ""}
          </p>
          <div className="pm-override-matches-list">
            {orderMatches.map((o) => (
              <button
                key={o.id}
                type="button"
                className="pm-override-match"
                disabled={loading}
                onClick={async () => {
                  setLoading(true);
                  setActionResult(null);
                  try { await openOrder(o); } catch (err) { setActionResult({ success: false, message: err.message }); }
                  setLoading(false);
                }}
              >
                <span className="pm-override-match-no">{o.order_no}</span>
                {o.shopify_order_name && <span className="pm-override-match-shop">Shopify {o.shopify_order_name}</span>}
                <span className="pm-override-match-date">{formatDate(o.created_at)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

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
                  {comp.is_outside_wh ? (
                    <span className="pm-comp-card-stage" style={{ backgroundColor: "#e0913f", color: "#fff" }}>
                      {getStagesOutsideLabel(comp.stages_outside)
                        ? `Out to Vendor (${getStagesOutsideLabel(comp.stages_outside)})`
                        : "Out to Vendor"}
                    </span>
                  ) : (
                    <span
                      className="pm-comp-card-stage"
                      style={{ backgroundColor: getStageColor(comp.current_stage) }}
                    >
                      {getComponentStageLabel(comp)}
                    </span>
                  )}
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
              {component.is_outside_wh ? (
                <span className="pm-comp-card-stage" style={{ backgroundColor: "#e0913f", color: "#fff" }}>
                  {getStagesOutsideLabel(component.stages_outside)
                    ? `Out to Vendor (${getStagesOutsideLabel(component.stages_outside)})`
                    : "Out to Vendor"}
                </span>
              ) : (
                <span className="pm-comp-card-stage" style={{ backgroundColor: getStageColor(component.current_stage) }}>
                  {getComponentStageLabel(component)}
                </span>
              )}
            </div>
            <div className="pm-override-detail-item">
              <span className="pm-detail-label">QC Status</span>
              <span className="pm-detail-value">{component.qc_status || "pending"}</span>
            </div>
            <div className="pm-override-detail-item">
              <span className="pm-detail-label">Re-journeys</span>
              <span className="pm-detail-value">{component.re_journey_count || 0}</span>
            </div>
            {/* No client identity here, and the WAREHOUSE (T-2) deadline rather
                than the customer's date — this is a production surface.
                See utils/productionPrivacy.js */}
            {component.orders && (
              <div className="pm-override-detail-item">
                <span className="pm-detail-label">Dispatch By</span>
                <span className="pm-detail-value">
                  {getWarehouseDate(component.orders.delivery_date, component.orders.created_at)}
                </span>
              </div>
            )}
          </div>

          {/* Override Actions */}
          {!["disposed", "scrapped", "dispatched"].includes(component.current_stage) && (
            <div className="pm-override-actions">
              <h4 className="pm-override-actions-title">Override Actions</h4>

              {/* A piece at a vendor is frozen: the DB accepts only the gate
                  return for it, so offer that instead of three buttons that
                  can only fail. */}
              {component.is_outside_wh ? (
                <>
                  <p className="pm-muted" style={{ fontSize: 13, margin: "0 0 12px" }}>
                    This piece is out at <b>{component.vendor_name || "a vendor"}</b>. It cannot be
                    advanced, skipped or rescheduled until it is back in the building. Use this only
                    when the piece is physically here and the Security Gate entry scan was missed.
                  </p>
                  <div className="pm-override-type-btns">
                    <button
                      className={`pm-override-type-btn ${overrideType === "vendor_return" ? "active" : ""}`}
                      onClick={() => setOverrideType("vendor_return")}
                    >
                      Force Return from Vendor
                    </button>
                  </div>
                </>
              ) : (
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
              )}

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
                {history.map((t) => {
                  const d = describeTransition(t, movements, historyPassMap);
                  return (
                  <div key={t.id} className="pm-timeline-item">
                    <div className="pm-timeline-dot" style={{ backgroundColor: getStageColor(t.to_stage) }} />
                    <div className="pm-timeline-content">
                      <p className="pm-timeline-stage" style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        {d.headline}
                        <ScanKindTag kind={d.kind} />
                      </p>
                      <p className="pm-timeline-meta">
                        {t.scanned_by}<FactoryBadge factory={t.factory} /> {"\u2022"} {new Date(t.scanned_at).toLocaleString()}
                        {d.showType && <span className="pm-timeline-type"> ({t.transition_type})</span>}
                      </p>
                      {t.notes && <p className="pm-timeline-notes">{t.notes}</p>}
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProductionOverrides;