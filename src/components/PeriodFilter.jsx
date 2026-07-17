import React, { useCallback, useMemo, useState } from "react";
import "./PeriodFilter.css";

// ============================================================
// PeriodFilter — the ONE time-wise filter for dashboard overviews.
//
// Extracted from AssistantCMO's inline TimelineFilter (the best existing
// implementation) so every dashboard shows the same control instead of five
// hand-rolled variants. Dropdown + custom-range inputs.
//
// Most callers want the hook:
//
//   const { control, inPeriod, timeline } = usePeriodFilter("all");
//   const periodOrders = useMemo(
//     () => orders.filter((o) => inPeriod(o.created_at)),
//     [orders, inPeriod]
//   );
//   ...
//   {control}   // render above the stat cards
//
// then compute the overview stats from periodOrders. `inPeriod` is stable per
// selection (useCallback), so the memo only recomputes when the range changes.
// ============================================================

export const PERIOD_OPTIONS = [
    { value: "all", label: "All time" },
    { value: "today", label: "Today" },
    { value: "yesterday", label: "Yesterday" },
    { value: "7d", label: "Last 7 days" },
    { value: "30d", label: "Last 30 days" },
    { value: "month", label: "This month" },
    { value: "year", label: "This year" },
    { value: "custom", label: "Custom range" },
];

// {start, end} for a selection, or null = no bound (all time / incomplete custom).
export function periodRange(timeline, customFrom, customTo) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    switch (timeline) {
        case "today": return { start: today, end: now };
        case "yesterday": {
            const start = new Date(today); start.setDate(start.getDate() - 1);
            const end = new Date(today.getTime() - 1);
            return { start, end };
        }
        case "7d": { const start = new Date(today); start.setDate(start.getDate() - 7); return { start, end: now }; }
        case "30d": { const start = new Date(today); start.setDate(start.getDate() - 30); return { start, end: now }; }
        case "month": return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
        case "year": return { start: new Date(now.getFullYear(), 0, 1), end: now };
        case "custom": {
            if (!customFrom && !customTo) return null;
            return {
                start: customFrom ? new Date(`${customFrom}T00:00:00`) : new Date(0),
                end: customTo ? new Date(`${customTo}T23:59:59.999`) : now,
            };
        }
        default: return null; // "all"
    }
}

export default function PeriodFilter({ timeline, setTimeline, customFrom, setCustomFrom, customTo, setCustomTo, label = "Showing data for:", variant = "select" }) {
    // "pills" — the app-standard presentation (Admin/StoreManager/COO tab
    // headers): a filled strip of pill buttons, gold active pill. Fills a
    // full-width band naturally; use for dashboard overviews.
    if (variant === "pills") {
        return (
            <div className="pfx-row">
                <div className="pfx-pills">
                    {PERIOD_OPTIONS.map((o) => (
                        <button
                            key={o.value}
                            type="button"
                            className={`pfx-pill ${timeline === o.value ? "active" : ""}`}
                            onClick={() => setTimeline(o.value)}
                        >
                            {o.label}
                        </button>
                    ))}
                </div>
                {timeline === "custom" && (
                    <div className="pfx-custom">
                        <input className="pfx-date" type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} />
                        <span className="pfx-to">to</span>
                        <input className="pfx-date" type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} />
                    </div>
                )}
            </div>
        );
    }

    // "select" — compact dropdown, for toolbars that already hold other controls.
    return (
        <div className="pfx">
            <label className="pfx-label">{label}</label>
            <select className="pfx-select" value={timeline} onChange={(e) => setTimeline(e.target.value)}>
                {PERIOD_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                ))}
            </select>
            {timeline === "custom" && (
                <>
                    <input className="pfx-date" type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} />
                    <span className="pfx-to">to</span>
                    <input className="pfx-date" type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} />
                </>
            )}
        </div>
    );
}

// Self-contained state + predicate + rendered control, for one-line adoption.
// opts: { label, variant: "select" | "pills" }
export function usePeriodFilter(defaultTimeline = "all", opts = {}) {
    const { label, variant } = opts;
    const [timeline, setTimeline] = useState(defaultTimeline);
    const [customFrom, setCustomFrom] = useState("");
    const [customTo, setCustomTo] = useState("");

    const range = useMemo(
        () => periodRange(timeline, customFrom, customTo),
        [timeline, customFrom, customTo]
    );

    // Stable per selection so downstream useMemo deps work naturally.
    const inPeriod = useCallback(
        (dateStr) => {
            if (!range) return true;
            if (!dateStr) return false;
            const t = new Date(dateStr).getTime();
            return t >= range.start.getTime() && t <= range.end.getTime();
        },
        [range]
    );

    const control = (
        <PeriodFilter
            timeline={timeline} setTimeline={setTimeline}
            customFrom={customFrom} setCustomFrom={setCustomFrom}
            customTo={customTo} setCustomTo={setCustomTo}
            label={label} variant={variant}
        />
    );

    return { timeline, range, inPeriod, control };
}
