import React from "react";
import { getStageLabel } from "../utils/barcodeService";
import "./ReJourneyTable.css";

/**
 * ReJourneyTable — one card per component currently in re-journey (rework).
 * Shows the piece, where it restarted to / is now, how many times it's been
 * re-journeyed (with at/over-limit flags), the last QC-fail reason, and how
 * overdue it is. Data comes from fetchReJourneys (order_components enriched
 * with the latest rework qc_record as `lastFail`).
 *
 * @param {object[]} rows
 * @param {boolean}  loading
 * @param {string}   [emptyText]
 */
export default function ReJourneyTable({ rows = [], loading, emptyText = "No components currently in re-journey." }) {
    if (loading) return <p className="rj-empty">Loading re-journeys…</p>;
    if (!rows.length) return <p className="rj-empty">{emptyText}</p>;

    return (
        <div className="rj-list">
            {rows.map((r) => {
                const count = Number(r.re_journey_count) || 0;
                const restartedTo = r.lastFail?.rejourney_to_stage || r.current_stage;
                return (
                    <div key={r.id} className={`rj-row ${r.overdue ? "rj-row-overdue" : ""}`}>
                        <div className="rj-row-head">
                            <span className="rj-barcode">{r.barcode}</span>
                            {r.order_no && <span className="rj-order">{r.order_no}</span>}
                            <span className="rj-label">{r.component_label || r.component_type}</span>
                            <span className={`rj-count ${r.overLimit ? "rj-count-over" : r.atLimit ? "rj-count-at" : ""}`}>
                                {r.overLimit ? `${count}× (over limit)` : r.atLimit ? `${count}× (at limit)` : `${count}× re-journey`}
                            </span>
                            {r.overdue && <span className="rj-overdue">{r.daysOverdue} day{r.daysOverdue === 1 ? "" : "s"} overdue</span>}
                        </div>

                        <div className="rj-stages">
                            <span className="rj-stage-chip">Restarted from: {getStageLabel(restartedTo) || restartedTo || "—"}</span>
                            <span className="rj-arrow">→</span>
                            <span className="rj-stage-chip rj-stage-now">Now at: {getStageLabel(r.current_stage) || r.current_stage || "—"}</span>
                        </div>

                        {r.lastFail && (
                            <div className="rj-detail">
                                {r.lastFail.fail_reason && <div><strong>Last fail:</strong> {r.lastFail.fail_reason}</div>}
                                <div className="rj-detail-meta">
                                    {r.lastFail.which_qc === "final" ? "Final QC" : "QC 1"}
                                    {r.lastFail.inspected_by ? ` · by ${r.lastFail.inspected_by}` : ""}
                                    {r.lastFail.created_at ? ` · ${new Date(r.lastFail.created_at).toLocaleString("en-GB")}` : ""}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
