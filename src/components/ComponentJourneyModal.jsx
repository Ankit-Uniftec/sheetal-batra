import React, { useEffect, useState } from "react";
import Badge from "./Badge";
import formatDate from "../utils/formatDate";
import {
  getStageLabel,
  getStageColor,
  getStageMaxDays,
  getStagesOutsideLabel,
  describeTransition,
  fetchTransitionHistory,
  fetchMovementHistory,
} from "../utils/barcodeService";
import ScanKindTag from "./ScanKindTag";
import "./ComponentJourneyModal.css";

/**
 * ComponentJourneyModal — the full production journey of an order's components.
 *
 * Two panes: component tabs on the left, the selected component's Vendor
 * History (every external trip) + stage-by-stage scan timeline on the right.
 * Security-gate steps read "Sent to Vendor" / "Returned to Warehouse" (the gate
 * doesn't change the stage). Fetches its own transition + movement data.
 *
 * Shared by the Warehouse (retail PH) and B2B Production dashboards so the
 * journey view stays identical everywhere.
 *
 * @param {string}   orderNo     order number for the modal title
 * @param {object[]} components  the order's components (id, barcode, labels, stage, vendor fields)
 * @param {Function} onClose     close handler
 */

// For a component currently out at a vendor, build the "At [vendor] · due
// [date]" tag. The due-back date is the ACTUAL return_date the PH configured on
// the current (exited) movement — the same date shown in Vendor History — so
// the tag and the table agree. Falls back to vendor_exit_at + the stage's
// allowed days only when no movement return_date is available.
const getVendorTagInfo = (comp, movements = []) => {
  if (!comp?.is_outside_wh) return null;
  const vendor = comp.vendor_name || "Vendor";

  // The trip it's currently out on (most recent 'exited' movement).
  const activeMov = (movements || [])
    .filter((m) => m.status === "exited")
    .sort((a, b) => new Date(b.exit_scan_at || b.created_at || 0) - new Date(a.exit_scan_at || a.created_at || 0))[0];

  let due = null;
  if (activeMov?.return_date) {
    due = new Date(activeMov.return_date);
  } else {
    // Fallback: derive from exit + stage SLA.
    const maxDays = getStageMaxDays(comp.current_stage);
    const exit = comp.vendor_exit_at ? new Date(comp.vendor_exit_at) : null;
    if (exit && !isNaN(exit.getTime()) && maxDays != null) {
      due = new Date(exit);
      due.setDate(due.getDate() + maxDays);
    }
  }

  if (!due || isNaN(due.getTime())) {
    return { text: `At ${vendor}`, overdue: false };
  }

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOfDay(due) - startOfDay(new Date())) / 86400000);

  if (diffDays < 0) {
    const od = Math.abs(diffDays);
    return { text: `At ${vendor} · ${od} day${od === 1 ? "" : "s"} overdue`, overdue: true };
  }
  return { text: `At ${vendor} · due ${formatDate(due)}`, overdue: false };
};

const ComponentJourneyModal = ({ orderNo, components = [], onClose }) => {
  const [journeyData, setJourneyData] = useState([]); // [{ component, transitions, movements }]
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await Promise.all(
          components.map(async (component) => {
            let transitions = [];
            let movements = [];
            try {
              [transitions, movements] = await Promise.all([
                fetchTransitionHistory(component.id),
                fetchMovementHistory(component.id),
              ]);
            } catch (e) { console.error("journey fetch failed for", component.barcode, e); }
            return { component, transitions: transitions || [], movements: movements || [] };
          })
        );
        if (cancelled) return;
        setJourneyData(data);
        setSelectedId(data[0]?.component?.id || null);
      } catch (err) {
        console.error("Failed to load journey:", err);
        if (!cancelled) setJourneyData([]);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [components]);

  const selected = journeyData.find((d) => d.component.id === selectedId) || journeyData[0];

  return (
    <div className="cjm-overlay" onClick={onClose}>
      <div className="cjm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cjm-head">
          <h3 className="cjm-title">Component Journey — {orderNo}</h3>
          <button className="cjm-close" onClick={onClose}>×</button>
        </div>

        {loading ? (
          <p className="cjm-empty">Loading journey…</p>
        ) : journeyData.length === 0 ? (
          <p className="cjm-empty">No components found for this order.</p>
        ) : (
          <div className="cjm-body">
            {/* Left: one tab per component */}
            <div className="cjm-tabs">
              {journeyData.map(({ component: c, movements: cm }) => {
                const out = c.is_outside_wh ? getVendorTagInfo(c, cm) : null;
                return (
                  <button
                    key={c.id}
                    className={`cjm-tab ${selected?.component.id === c.id ? "active" : ""}`}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <span className="cjm-tab-dot" style={{ backgroundColor: getStageColor(c.current_stage) }} />
                    <span className="cjm-tab-text">
                      <span className="cjm-tab-name">{c.component_label || c.component_type}</span>
                      <span className="cjm-tab-bc">{c.barcode}</span>
                    </span>
                    {out && <span className={`cjm-tab-flag ${out.overdue ? "overdue" : ""}`} title={out.text}>●</span>}
                  </button>
                );
              })}
            </div>

            {/* Right: selected component's vendor history + stage timeline */}
            <div className="cjm-detail">
              {selected && (() => {
                const c = selected.component;
                const transitions = selected.transitions;
                const movements = selected.movements || [];
                const info = c.is_outside_wh ? getVendorTagInfo(c, movements) : null;
                // When the piece is physically out at a vendor, show "Out to
                // Vendor (<stage>)" (the stage it went out for, from the active
                // exited movement) instead of the raw current_stage.
                const outStageLabel = c.is_outside_wh
                  ? getStagesOutsideLabel(movements.find((m) => m.status === "exited")?.stages_outside)
                  : null;
                return (
                  <>
                    <div className="cjm-comp-head">
                      <span className="cjm-comp-name">{c.component_label || c.component_type}</span>
                      <span className="cjm-comp-bc">{c.barcode}</span>
                      {c.is_outside_wh ? (
                        <Badge color="#e0913f">{outStageLabel ? `Out to Vendor (${outStageLabel})` : "Out to Vendor"}</Badge>
                      ) : (
                        <Badge color={getStageColor(c.current_stage)}>{getStageLabel(c.current_stage)}</Badge>
                      )}
                      {info && (
                        <span className={`cjm-vendor-now ${info.overdue ? "cjm-overdue" : ""}`}>
                          {info.text}
                        </span>
                      )}
                    </div>

                    {/* Disposed / scrapped: show the stage it was removed at and why */}
                    {(c.current_stage === "disposed" || c.current_stage === "scrapped") && (
                      <div className="cjm-disposed-line">
                        <strong>
                          {c.disposition === "scrap" || c.current_stage === "scrapped" ? "Scrapped" : "Disposed"}
                          {c.previous_stage
                            ? ` at ${getStageLabel(c.previous_stage).replace(/ In-Progress$/, "")}`
                            : ""}
                        </strong>
                        {c.disposition_reason ? (
                          <span className="cjm-disposed-reason"> · Reason: {c.disposition_reason}</span>
                        ) : null}
                      </div>
                    )}

                    {/* Vendor history — every external trip for this component */}
                    {movements.length > 0 && (
                      <div className="cjm-vendor-hist">
                        <p className="cjm-section-title">Vendor History</p>
                        <table className="cjm-vendor-table">
                          <thead>
                            <tr>
                              <th>Vendor</th>
                              <th>Stage</th>
                              <th>Sent</th>
                              <th>Returned</th>
                              <th>Due</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {movements.map((m) => (
                              <tr key={m.id}>
                                <td>
                                  <strong>{m.vendor_name || "—"}</strong>
                                  {m.vendor_location ? <span className="cjm-vendor-loc"> · {m.vendor_location}</span> : null}
                                </td>
                                <td>{getStagesOutsideLabel(m.stages_outside) || "—"}</td>
                                <td>{m.exit_scan_at ? formatDate(m.exit_scan_at) : "—"}</td>
                                <td>{m.entry_scan_at ? formatDate(m.entry_scan_at) : "—"}</td>
                                <td>{m.return_date ? formatDate(m.return_date) : "—"}</td>
                                <td><span className={`cjm-vhs cjm-vhs-${m.status}`}>{m.status}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <p className="cjm-section-title">Stage History</p>
                    {transitions.length === 0 ? (
                      <p className="cjm-empty-inline">Not started yet — no scans recorded.</p>
                    ) : (
                      <div className="cjm-timeline">
                        {transitions.map((t) => {
                          // Shared classifier: internal production scan vs external
                          // vendor movement (+ headline). The security gate doesn't
                          // change the stage, so it reads "Sent to Vendor (Dyeing)"
                          // instead of "Stage → same Stage".
                          const d = describeTransition(t, movements);
                          return (
                            <div key={t.id} className="cjm-timeline-item">
                              <div className="cjm-timeline-dot" style={{ backgroundColor: getStageColor(t.to_stage) }} />
                              <div className="cjm-timeline-content">
                                <p className="cjm-timeline-stage" style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                  {d.headline}
                                  <ScanKindTag kind={d.kind} />
                                </p>
                                <p className="cjm-timeline-meta">
                                  {t.scanned_by} {'•'} {new Date(t.scanned_at).toLocaleString("en-GB")}
                                  {d.showType && ` (${t.transition_type})`}
                                </p>
                                {t.notes && <p className="cjm-timeline-notes">{t.notes}</p>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ComponentJourneyModal;
