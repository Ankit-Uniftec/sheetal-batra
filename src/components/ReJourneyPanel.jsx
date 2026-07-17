import React, { useEffect, useMemo, useState } from "react";
import ReJourneyTable from "./ReJourneyTable";
import Paginator from "./Paginator";
import { reJourneySummary, filterReJourneys, reJourneyStageCounts } from "../utils/reJourneys";
import { getStageLabel } from "../utils/barcodeService";
import "./ReJourneyPanel.css";

const PAGE_SIZE = 20;

/**
 * ReJourneyPanel — the full "currently in re-journey" view: a filter bar
 * (search, stage, overdue-only, at-limit-only), a summary line, and the
 * ReJourneyTable. Self-contained client-side filtering. Used by the
 * Production Manager and both Production Head dashboards.
 *
 * @param {object[]} rows           from fetchReJourneys
 * @param {boolean}  loading
 * @param {function} [onOrderClick] (orderId, orderNo) => void — jump to the order
 */
export default function ReJourneyPanel({ rows = [], loading, onOrderClick }) {
    const [search, setSearch] = useState("");
    const [stage, setStage] = useState("");
    const [overdueOnly, setOverdueOnly] = useState(false);
    const [atLimitOnly, setAtLimitOnly] = useState(false);

    // Per-stage counts (busiest first) — powers "most re-journeys" and the
    // count-labelled dropdown. Computed over ALL rows so it's a stable overview.
    const stageCounts = useMemo(() => reJourneyStageCounts(rows), [rows]);
    const topStage = stageCounts[0] || null;
    const filtered = useMemo(
        () => filterReJourneys(rows, { search, stage, overdueOnly, atLimitOnly }),
        [rows, search, stage, overdueOnly, atLimitOnly]
    );
    const summary = useMemo(() => reJourneySummary(filtered), [filtered]);

    // Page within the filtered set; filter changes reset to page 1.
    const [page, setPage] = useState(1);
    useEffect(() => { setPage(1); }, [rows, search, stage, overdueOnly, atLimitOnly]);
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const pageRows = useMemo(
        () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
        [filtered, page]
    );

    const hasFilters = search || stage || overdueOnly || atLimitOnly;
    const clear = () => { setSearch(""); setStage(""); setOverdueOnly(false); setAtLimitOnly(false); };

    return (
        <div className="rj-panel">
            <div className="rj-filters">
                <input className="rj-input" type="text" placeholder="Search order # or barcode…" value={search} onChange={(e) => setSearch(e.target.value)} />
                <select className="rj-input" value={stage} onChange={(e) => setStage(e.target.value)}>
                    <option value="">All stages</option>
                    {stageCounts.map(({ stage: s, count }) => (
                        <option key={s} value={s}>{(getStageLabel(s) || s)} ({count})</option>
                    ))}
                </select>
                <label className="rj-check"><input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only</label>
                <label className="rj-check"><input type="checkbox" checked={atLimitOnly} onChange={(e) => setAtLimitOnly(e.target.checked)} /> At limit (2+)</label>
                {hasFilters && <button className="rj-clear" onClick={clear}>Clear</button>}
            </div>

            <div className="rj-summary">
                <span className="rj-sum-item"><b>{summary.total}</b> in re-journey</span>
                <span className="rj-sum-item rj-sum-overdue"><b>{summary.overdue}</b> overdue</span>
                <span className="rj-sum-item rj-sum-limit"><b>{summary.atLimit}</b> at/over limit</span>
                {topStage && (
                    <button
                        type="button"
                        className={`rj-sum-item rj-sum-top ${stage === topStage.stage ? "active" : ""}`}
                        title="The stage with the most re-journeys — click to filter"
                        onClick={() => setStage(stage === topStage.stage ? "" : topStage.stage)}
                    >
                        Most re-journeys: <b>{getStageLabel(topStage.stage) || topStage.stage}</b> ({topStage.count})
                    </button>
                )}
            </div>

            <ReJourneyTable rows={pageRows} loading={loading} onOrderClick={onOrderClick} emptyText={hasFilters ? "No re-journeys match these filters." : "No components currently in re-journey."} />
            <Paginator page={page} totalPages={totalPages} onChange={setPage} />
        </div>
    );
}
