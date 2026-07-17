import React, { useEffect, useMemo, useState } from "react";
import formatDate from "../utils/formatDate";
import Paginator from "./Paginator";
import {
    externalMovementSummary,
    externalMovementVendors,
    externalMovementStages,
    filterExternalMovements,
} from "../utils/externalMovements";
import "./ExternalVendorsPanel.css";

const PAGE_SIZE = 20;

const STATUS_LABEL = { configured: "Awaiting scan-out", exited: "Out at vendor", returned: "Returned" };
const TYPE_LABEL = { top: "Top", bottom: "Bottom", dupatta: "Dupatta", extra: "Extra" };

/**
 * ExternalVendorsPanel — the "at external vendors" view: a filter bar (search,
 * vendor, component type, status, overdue-only), a clickable summary strip, and
 * one row per external movement. Shows the FULL history by default (every trip
 * that ever went out); the Status filter (or clicking a summary chip) narrows to
 * currently-out / returned / awaiting scan-out. Self-contained client-side
 * filtering. Reusable across the Production Manager and Production Head dashboards.
 *
 * @param {object[]} rows           from fetchExternalMovements
 * @param {boolean}  loading
 * @param {function} [onOrderClick] (orderId, orderNo) => void — jump to the order
 */
export default function ExternalVendorsPanel({ rows = [], loading, onOrderClick }) {
    const [search, setSearch] = useState("");
    const [vendor, setVendor] = useState("");
    const [componentType, setComponentType] = useState("");
    const [stage, setStage] = useState("");
    const [status, setStatus] = useState(""); // "" = all statuses (full history)
    const [overdueOnly, setOverdueOnly] = useState(false);

    const vendors = useMemo(() => externalMovementVendors(rows), [rows]);
    // Per-stage counts (busiest first) — the count-labelled dropdown + the
    // "most out for" insight chip.
    const stageCounts = useMemo(() => externalMovementStages(rows), [rows]);
    const topStage = stageCounts[0] || null;
    const filtered = useMemo(
        () => filterExternalMovements(rows, { search, vendor, componentType, status, overdueOnly, stage }),
        [rows, search, vendor, componentType, status, overdueOnly, stage]
    );
    // Summary reflects the whole dataset (so the counts don't collapse to the
    // filtered subset) — same intent as the other panels' summary strips.
    const summary = useMemo(() => externalMovementSummary(rows), [rows]);

    // Page within the filtered set; filter changes reset to page 1.
    const [page, setPage] = useState(1);
    useEffect(() => { setPage(1); }, [rows, search, vendor, componentType, status, overdueOnly, stage]);
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const pageRows = useMemo(
        () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
        [filtered, page]
    );

    const hasFilters = search || vendor || componentType || status || overdueOnly || stage;
    const clear = () => { setSearch(""); setVendor(""); setComponentType(""); setStatus(""); setOverdueOnly(false); setStage(""); };

    // Clicking a summary chip toggles the matching filter (click again to clear).
    const toggleStatus = (s) => { setOverdueOnly(false); setStatus((prev) => (prev === s ? "" : s)); };
    const toggleOverdue = () => { setStatus(""); setOverdueOnly((prev) => !prev); };

    return (
        <div className="ev-panel">
            <div className="ev-filters">
                <input className="ev-input" type="text" placeholder="Search order # or barcode…" value={search} onChange={(e) => setSearch(e.target.value)} />
                <select className="ev-input" value={vendor} onChange={(e) => setVendor(e.target.value)}>
                    <option value="">All vendors</option>
                    {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                <select className="ev-input" value={stage} onChange={(e) => setStage(e.target.value)}>
                    <option value="">All stages</option>
                    {stageCounts.map(({ stage: st, count }) => (
                        <option key={st} value={st}>{st} ({count})</option>
                    ))}
                </select>
                <select className="ev-input" value={componentType} onChange={(e) => setComponentType(e.target.value)}>
                    <option value="">All components</option>
                    <option value="top">Top</option>
                    <option value="bottom">Bottom</option>
                    <option value="dupatta">Dupatta</option>
                    <option value="extra">Extra</option>
                </select>
                <select className="ev-input" value={status} onChange={(e) => { setOverdueOnly(false); setStatus(e.target.value); }}>
                    <option value="">All statuses</option>
                    <option value="exited">Currently out</option>
                    <option value="returned">Returned</option>
                    <option value="configured">Awaiting scan-out</option>
                </select>
                <label className="ev-check"><input type="checkbox" checked={overdueOnly} onChange={toggleOverdue} /> Overdue only</label>
                {hasFilters && <button className="ev-clear" onClick={clear}>Clear</button>}
            </div>

            <div className="ev-summary">
                <button type="button" className={`ev-sum-item ev-sum-out ${status === "exited" ? "ev-sum-active" : ""}`} onClick={() => toggleStatus("exited")}><b>{summary.out}</b> out at vendors</button>
                <button type="button" className={`ev-sum-item ev-sum-overdue ${overdueOnly ? "ev-sum-active" : ""}`} onClick={toggleOverdue}><b>{summary.overdue}</b> overdue</button>
                <button type="button" className={`ev-sum-item ev-sum-returned ${status === "returned" ? "ev-sum-active" : ""}`} onClick={() => toggleStatus("returned")}><b>{summary.returned}</b> returned</button>
                <button type="button" className={`ev-sum-item ${!status && !overdueOnly ? "ev-sum-active" : ""}`} onClick={clear}><b>{summary.total}</b> total trips</button>
                {topStage && (
                    <button
                        type="button"
                        className={`ev-sum-item ev-sum-top ${stage === topStage.stage ? "ev-sum-active" : ""}`}
                        title="The stage most pieces went out for — click to filter"
                        onClick={() => setStage(stage === topStage.stage ? "" : topStage.stage)}
                    >
                        Most out for: <b>{topStage.stage}</b> ({topStage.count})
                    </button>
                )}
            </div>

            <ExternalVendorsList
                rows={pageRows}
                loading={loading}
                onOrderClick={onOrderClick}
                emptyText={hasFilters ? "No movements match these filters." : "No external vendor movements yet."}
            />
            <Paginator page={page} totalPages={totalPages} onChange={setPage} />
        </div>
    );
}

function ExternalVendorsList({ rows, loading, emptyText, onOrderClick }) {
    if (loading) return <p className="ev-empty">Loading vendor movements…</p>;
    if (!rows.length) return <p className="ev-empty">{emptyText}</p>;

    return (
        <div className="ev-list">
            {rows.map((m) => (
                <div
                    key={m.id}
                    className={`ev-row ev-row-${m.status} ${m.overdue ? "ev-row-overdue" : ""} ${onOrderClick && m.order_id ? "ev-row-click" : ""}`}
                    onClick={onOrderClick && m.order_id ? () => onOrderClick(m.order_id, m.order_no) : undefined}
                    role={onOrderClick && m.order_id ? "button" : undefined}
                    tabIndex={onOrderClick && m.order_id ? 0 : undefined}
                    onKeyDown={onOrderClick && m.order_id ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOrderClick(m.order_id, m.order_no); } } : undefined}
                    title={onOrderClick && m.order_id ? "View this order in All Orders" : undefined}
                >
                    <div className="ev-row-head">
                        <span className="ev-barcode">{m.barcode || "—"}</span>
                        {m.order_no && <span className="ev-order">{m.order_no}</span>}
                        {m.component_type && <span className="ev-type">{TYPE_LABEL[m.component_type] || m.component_type}</span>}
                        <span className={`ev-status ev-status-${m.status}`}>{STATUS_LABEL[m.status] || m.status}</span>
                        {m.overdue && <span className="ev-overdue">{m.daysOverdue} day{m.daysOverdue === 1 ? "" : "s"} overdue</span>}
                    </div>

                    <div className="ev-meta">
                        <span className="ev-vendor">🏭 {m.vendor_name || "—"}{m.vendor_location ? ` · ${m.vendor_location}` : ""}</span>
                        <span className="ev-stage">For: {m.stageLabel}</span>
                    </div>

                    <div className="ev-dates">
                        <span>Sent out: <b>{m.exit_scan_at ? formatDate(m.exit_scan_at) : "—"}</b></span>
                        <span>Return by: <b className={m.overdue ? "ev-date-late" : ""}>{m.return_date ? formatDate(m.return_date) : "—"}</b></span>
                        <span>Returned: <b>{m.entry_scan_at ? formatDate(m.entry_scan_at) : (m.status === "returned" ? "yes" : "—")}</b></span>
                        <span>Ordered: <b>{m.order_created_at ? formatDate(m.order_created_at) : "—"}</b></span>
                    </div>
                </div>
            ))}
        </div>
    );
}
