import React, { useMemo, useState } from "react";
import ReJourneyTable from "./ReJourneyTable";
import { reJourneySummary, filterReJourneys, reJourneyStages } from "../utils/reJourneys";
import { getStageLabel } from "../utils/barcodeService";
import "./ReJourneyPanel.css";

/**
 * ReJourneyPanel — the full "currently in re-journey" view: a filter bar
 * (search, stage, overdue-only, at-limit-only), a summary line, and the
 * ReJourneyTable. Self-contained client-side filtering. Used by the
 * Production Manager and both Production Head dashboards.
 *
 * @param {object[]} rows      from fetchReJourneys
 * @param {boolean}  loading
 */
export default function ReJourneyPanel({ rows = [], loading }) {
    const [search, setSearch] = useState("");
    const [stage, setStage] = useState("");
    const [overdueOnly, setOverdueOnly] = useState(false);
    const [atLimitOnly, setAtLimitOnly] = useState(false);

    const stages = useMemo(() => reJourneyStages(rows), [rows]);
    const filtered = useMemo(
        () => filterReJourneys(rows, { search, stage, overdueOnly, atLimitOnly }),
        [rows, search, stage, overdueOnly, atLimitOnly]
    );
    const summary = useMemo(() => reJourneySummary(filtered), [filtered]);

    const hasFilters = search || stage || overdueOnly || atLimitOnly;
    const clear = () => { setSearch(""); setStage(""); setOverdueOnly(false); setAtLimitOnly(false); };

    return (
        <div className="rj-panel">
            <div className="rj-filters">
                <input className="rj-input" type="text" placeholder="Search order # or barcode…" value={search} onChange={(e) => setSearch(e.target.value)} />
                <select className="rj-input" value={stage} onChange={(e) => setStage(e.target.value)}>
                    <option value="">All stages</option>
                    {stages.map((s) => <option key={s} value={s}>{getStageLabel(s) || s}</option>)}
                </select>
                <label className="rj-check"><input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only</label>
                <label className="rj-check"><input type="checkbox" checked={atLimitOnly} onChange={(e) => setAtLimitOnly(e.target.checked)} /> At limit (2+)</label>
                {hasFilters && <button className="rj-clear" onClick={clear}>Clear</button>}
            </div>

            <div className="rj-summary">
                <span className="rj-sum-item"><b>{summary.total}</b> in re-journey</span>
                <span className="rj-sum-item rj-sum-overdue"><b>{summary.overdue}</b> overdue</span>
                <span className="rj-sum-item rj-sum-limit"><b>{summary.atLimit}</b> at/over limit</span>
            </div>

            <ReJourneyTable rows={filtered} loading={loading} emptyText={hasFilters ? "No re-journeys match these filters." : "No components currently in re-journey."} />
        </div>
    );
}
