import React, { useEffect, useState } from "react";
import Badge from "./Badge";
import formatDate from "../utils/formatDate";
import {
  getStageLabel,
  getStageColor,
  getStageMaxDays,
  fetchTransitionHistory,
  fetchMovementHistory,
} from "../utils/barcodeService";
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
// [date]" tag. Due-back = vendor_exit_at + the current stage's allowed days.
const getVendorTagInfo = (comp) => {
  if (!comp?.is_outside_wh) return null;
  const vendor = comp.vendor_name || "Vendor";
  const maxDays = getStageMaxDays(comp.current_stage);
  const exit = comp.vendor_exit_at ? new Date(comp.vendor_exit_at) : null;

  if (!exit || isNaN(exit.getTime()) || maxDays == null) {
    return { text: `At ${vendor}`, overdue: false };
  }

  const due = new Date(exit);
  due.setDate(due.getDate() + maxDays);
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
              {journeyData.map(({ component: c }) => {
                const out = c.is_outside_wh ? getVendorTagInfo(c) : null;
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
                const info = c.is_outside_wh ? getVendorTagInfo(c) : null;
                return (
                  <>
                    <div className="cjm-comp-head">
                      <span className="cjm-comp-name">{c.component_label || c.component_type}</span>
                      <span className="cjm-comp-bc">{c.barcode}</span>
                      <Badge color={getStageColor(c.current_stage)}>{getStageLabel(c.current_stage)}</Badge>
                      {info && (
                        <span className={`cjm-vendor-now ${info.overdue ? "cjm-overdue" : ""}`}>
                          {info.text}
                        </span>
                      )}
                    </div>

                    {/* Vendor history — every external trip for this component */}
                    {movements.length > 0 && (
                      <div className="cjm-vendor-hist">
                        <p className="cjm-section-title">Vendor History</p>
                        <table className="cjm-vendor-table">
                          <thead>
                            <tr>
                              <th>Vendor</th>
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
                          // The security gate doesn't change the stage (physical
                          // in/out checkpoint) — show a clear action label instead
                          // of "Stage → same Stage".
                          const isExit = t.transition_type === "security_exit";
                          const isEntry = t.transition_type === "security_entry";
                          const headline = isExit
                            ? "Sent to Vendor"
                            : isEntry
                              ? "Returned to Warehouse"
                              : `${t.from_stage ? `${getStageLabel(t.from_stage)} → ` : ""}${getStageLabel(t.to_stage)}`;
                          return (
                            <div key={t.id} className="cjm-timeline-item">
                              <div className="cjm-timeline-dot" style={{ backgroundColor: getStageColor(t.to_stage) }} />
                              <div className="cjm-timeline-content">
                                <p className="cjm-timeline-stage">{headline}</p>
                                <p className="cjm-timeline-meta">
                                  {t.scanned_by} {'•'} {new Date(t.scanned_at).toLocaleString("en-GB")}
                                  {!isExit && !isEntry && t.transition_type && t.transition_type !== "scan" && ` (${t.transition_type})`}
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
