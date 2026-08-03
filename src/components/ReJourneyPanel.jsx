import React, { useEffect, useMemo, useState } from "react";
import ReJourneyTable from "./ReJourneyTable";
import Paginator from "./Paginator";
import { reJourneySummary, filterReJourneys, reJourneyStageCounts, reJourneyDate } from "../utils/reJourneys";
import { getStageLabel, distinctChannelKeys, CHANNEL_KEY_LABELS } from "../utils/barcodeService";
import { usePeriodFilter } from "./PeriodFilter";
import downloadCsv from "../utils/downloadCsv";
import "./ReJourneyPanel.css";

const PAGE_SIZE = 20;

/**
 * ReJourneyPanel — the full "currently in re-journey" view: a filter bar
 * (search, time period, stage, channel, overdue-only, at-limit-only), a summary
 * line, and the ReJourneyTable. Self-contained client-side filtering. Used by
 * the Production Manager and both Production Head dashboards.
 *
 * @param {object[]} rows                    from fetchReJourneys
 * @param {boolean}  loading
 * @param {boolean}  [showChannelFilter=true] hide when the rows are already one
 *                                            channel (the B2B dashboards)
 * @param {function} [onOrderClick]          (orderId, orderNo) => void — jump to the order
 * @param {function} [onScopeChange]         ({channelLabel}) => void — what's ACTUALLY
 *                                            on screen, so the host heading can
 *                                            describe it instead of hardcoding a scope.
 */
export default function ReJourneyPanel({ rows = [], loading, showChannelFilter = true, onOrderClick, onScopeChange }) {
    // Time scope via the shared PeriodFilter, by when QC sent the piece back
    // (reJourneyDate) — see its note on why not stage_updated_at.
    const {
        control: periodControl, timeline, inPeriod, range: periodRange, props: periodProps,
    } = usePeriodFilter("all", { variant: "select", label: "Date:" });
    const [search, setSearch] = useState("");
    const [stage, setStage] = useState("");
    const [channel, setChannel] = useState("");
    const [overdueOnly, setOverdueOnly] = useState(false);
    const [atLimitOnly, setAtLimitOnly] = useState(false);

    // Per-stage counts (busiest first) — powers "most re-journeys" and the
    // count-labelled dropdown. Computed over ALL rows so it's a stable overview.
    const stageCounts = useMemo(() => reJourneyStageCounts(rows), [rows]);
    const topStage = stageCounts[0] || null;
    // Options are the channels actually present, so nothing in the list can
    // select to an empty result. The control itself still renders regardless
    // (see the filter bar) — only its OPTIONS depend on the data.
    const channels = useMemo(
        () => (showChannelFilter ? distinctChannelKeys(rows) : []),
        [rows, showChannelFilter]
    );
    const filtered = useMemo(
        () => filterReJourneys(rows, { search, stage, channel, inPeriod: periodRange ? inPeriod : null, overdueOnly, atLimitOnly }),
        [rows, search, stage, channel, periodRange, inPeriod, overdueOnly, atLimitOnly]
    );
    const summary = useMemo(() => reJourneySummary(filtered), [filtered]);

    // Report the live scope up so the host heading describes what's on screen.
    const channelLabel = channel ? (channels.find((c) => c.key === channel)?.label || channel) : null;
    useEffect(() => { onScopeChange?.({ channelLabel }); }, [channelLabel, onScopeChange]);

    // Page within the filtered set; filter changes reset to page 1.
    const [page, setPage] = useState(1);
    useEffect(() => { setPage(1); }, [rows, search, stage, channel, periodRange, overdueOnly, atLimitOnly]);
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const pageRows = useMemo(
        () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
        [filtered, page]
    );

    const hasFilters = timeline !== "all" || search || stage || channel || overdueOnly || atLimitOnly;
    const clear = () => {
        periodProps.setTimeline("all"); periodProps.setCustomFrom(""); periodProps.setCustomTo("");
        setSearch(""); setStage(""); setChannel(""); setOverdueOnly(false); setAtLimitOnly(false);
    };

    // Export the filtered set, not the visible page — see QcHistoryPanel.
    const exportCsv = () => {
        downloadCsv({
            filename: "re_journeys",
            headers: [
                "Order No", "Barcode", "Piece", "Channel", "Currently At", "Sent Back From",
                "Re-journey Count", "At Limit", "Overdue", "Days Overdue", "Stage Deadline",
                "Fail Reason", "QC Stage", "Inspected By", "Sent Back On",
            ],
            rows: filtered.map((r) => [
                r.order_no || "",
                r.barcode || "",
                r.component_label || r.component_type || "",
                CHANNEL_KEY_LABELS[r.channel_key] || r.channel_key || "",
                getStageLabel(r.current_stage) || r.current_stage || "",
                getStageLabel(r.previous_stage) || r.previous_stage || "",
                r.re_journey_count ?? 0,
                r.atLimit ? "Yes" : "No",
                r.overdue ? "Yes" : "No",
                r.overdue ? r.daysOverdue : 0,
                r.stage_deadline ? new Date(r.stage_deadline).toLocaleDateString("en-GB") : "",
                // The QC event that sent the piece back is enriched onto
                // row.lastFail; reJourneyDate() is the shared "sent back when"
                // rule (falls back to stage_updated_at for pre-V2 rows).
                r.lastFail?.fail_reason || "",
                r.lastFail?.which_qc === "final" ? "Final QC" : r.lastFail?.which_qc === "qc1" ? "QC 1" : (r.lastFail?.which_qc || ""),
                r.lastFail?.inspected_by || "",
                reJourneyDate(r) ? new Date(reJourneyDate(r)).toLocaleString("en-GB") : "",
            ]),
        });
    };

    return (
        <div className="rj-panel">
            <div className="rj-filters">
                <input className="rj-input" type="text" placeholder="Search order # or barcode…" value={search} onChange={(e) => setSearch(e.target.value)} />
                {periodControl}
                <select className="rj-input" value={stage} onChange={(e) => setStage(e.target.value)}>
                    <option value="">All stages</option>
                    {stageCounts.map(({ stage: s, count }) => (
                        <option key={s} value={s}>{(getStageLabel(s) || s)} ({count})</option>
                    ))}
                </select>
                {/* Rendered whenever the surface is multi-channel, even if the
                    CURRENT rows happen to be one channel. Hiding it then made
                    the filter look broken, and left no on-screen signal that
                    the list was single-channel at all. Single-channel surfaces
                    opt out explicitly via showChannelFilter. */}
                {showChannelFilter && (
                    <select className="rj-input" value={channel} onChange={(e) => setChannel(e.target.value)} disabled={channels.length === 0}>
                        <option value="">All channels</option>
                        {channels.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                )}
                <label className="rj-check"><input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only</label>
                <label className="rj-check"><input type="checkbox" checked={atLimitOnly} onChange={(e) => setAtLimitOnly(e.target.checked)} /> At limit (2+)</label>
                {hasFilters && <button className="rj-clear" onClick={clear}>Clear</button>}
                <button className="rj-export" onClick={exportCsv} disabled={filtered.length === 0} title={filtered.length === 0 ? "Nothing to export" : `Export ${filtered.length} piece${filtered.length === 1 ? "" : "s"}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                    Export ({filtered.length})
                </button>
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

            {/* Badge the channel on multi-channel surfaces — including when the
                current rows are all one channel, which is itself worth seeing. */}
            <ReJourneyTable rows={pageRows} loading={loading} showChannel={showChannelFilter} onOrderClick={onOrderClick} emptyText={hasFilters ? "No re-journeys match these filters." : "No components currently in re-journey."} />
            <Paginator page={page} totalPages={totalPages} onChange={setPage} />
        </div>
    );
}
