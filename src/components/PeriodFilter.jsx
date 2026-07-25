import React, { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
//
// Screens that need their own layout (e.g. a comparison <select> beside the
// pills) can spread `props` from the hook onto the component and pass children,
// which render in a right-hand slot:
//
//   const period = usePeriodFilter("month", { variant: "pills" });
//   <PeriodFilter {...period.props} variant="pills">
//     <select ...>{...}</select>
//   </PeriodFilter>
//
// Screens whose filters live in the URL (order lists reached via Back) use
// usePeriodFilterParam — same API, backed by search params.
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

// Human label for a selection ("month" → "This month"). For card titles etc.
export function periodLabel(timeline) {
    const opt = PERIOD_OPTIONS.find((o) => o.value === timeline);
    return opt ? opt.label : "All time";
}

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

// Strict membership test against a concrete range. Unlike the hook's
// `inPeriod` (null range = everything, for "All time"), a null range here
// matches NOTHING — the semantics wanted for comparison ranges, where null
// means "comparison off".
export function inRange(range, dateStr) {
    if (!range || !dateStr) return false;
    const t = new Date(dateStr).getTime();
    return t >= range.start.getTime() && t <= range.end.getTime();
}

// The comparison window for a period — used by the analytics dashboards'
// "vs previous period / previous year" growth figures.
//   previous_year   — same window shifted back one year.
//   previous_period — the same-length window immediately before (duration
//                     based, so "Today" compares against yesterday up to the
//                     same time of day).
// null when comparison is off or the period is unbounded ("All time").
export function comparisonPeriodRange(range, comparisonType) {
    if (!range || !comparisonType || comparisonType === "none") return null;
    if (comparisonType === "previous_year") {
        const start = new Date(range.start); start.setFullYear(start.getFullYear() - 1);
        const end = new Date(range.end); end.setFullYear(end.getFullYear() - 1);
        return { start, end };
    }
    // previous_period
    const end = new Date(range.start.getTime() - 1);
    const start = new Date(end.getTime() - (range.end.getTime() - range.start.getTime()));
    return { start, end };
}

export default function PeriodFilter({ timeline, setTimeline, customFrom, setCustomFrom, customTo, setCustomTo, label = "Showing data for:", variant = "select", children }) {
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
                {children ? <div className="pfx-slot">{children}</div> : null}
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
            {children ? <div className="pfx-slot">{children}</div> : null}
        </div>
    );
}

// Shared tail of both hooks: derive range/inPeriod/control from wherever the
// three values live (state or URL).
function usePeriodApi(timeline, setTimeline, customFrom, setCustomFrom, customTo, setCustomTo, opts = {}) {
    const { label, variant } = opts;

    const range = useMemo(
        () => periodRange(timeline, customFrom, customTo),
        [timeline, customFrom, customTo]
    );

    // Stable per selection so downstream useMemo deps work naturally.
    const inPeriod = useCallback(
        (dateStr) => (range ? inRange(range, dateStr) : true),
        [range]
    );

    const props = { timeline, setTimeline, customFrom, setCustomFrom, customTo, setCustomTo };

    const control = (
        <PeriodFilter {...props} label={label} variant={variant} />
    );

    return { timeline, range, inPeriod, control, props };
}

// Self-contained state + predicate + rendered control, for one-line adoption.
// opts: { label, variant: "select" | "pills" }
export function usePeriodFilter(defaultTimeline = "all", opts = {}) {
    const [timeline, setTimeline] = useState(defaultTimeline);
    const [customFrom, setCustomFrom] = useState("");
    const [customTo, setCustomTo] = useState("");
    return usePeriodApi(timeline, setTimeline, customFrom, setCustomFrom, customTo, setCustomTo, opts);
}

// URL-backed variant (sibling of useFilterParam): for order lists where Back
// must restore the filter and a filtered view should be linkable. All three
// params update in ONE setSearchParams call (several individual useFilterParam
// setters in the same handler would clobber each other — see useFilterParam).
// Legacy links with only ?from/?to (pre-PeriodFilter bookmarks) still apply:
// they read as a custom range.
// opts: { param, fromParam, toParam, label, variant }
export function usePeriodFilterParam(defaultTimeline = "all", opts = {}) {
    const { param = "period", fromParam = "from", toParam = "to", ...rest } = opts;
    const [searchParams, setSearchParams] = useSearchParams();

    const customFrom = searchParams.get(fromParam) || "";
    const customTo = searchParams.get(toParam) || "";
    const timeline = searchParams.get(param) || (customFrom || customTo ? "custom" : defaultTimeline);

    const update = useCallback(
        (entries) => {
            setSearchParams(
                (prev) => {
                    const p = new URLSearchParams(prev);
                    Object.entries(entries).forEach(([k, v]) => {
                        if (v) p.set(k, v); else p.delete(k);
                    });
                    return p;
                },
                { replace: true } // filters replace, never push — same rule as useFilterParam
            );
        },
        [setSearchParams]
    );

    const setTimeline = useCallback(
        (t) => {
            if (t === "custom") update({ [param]: t });
            // Leaving custom clears the dates; the default keeps a clean URL.
            else update({ [param]: t === defaultTimeline ? "" : t, [fromParam]: "", [toParam]: "" });
        },
        [update, param, fromParam, toParam, defaultTimeline]
    );
    const setCustomFrom = useCallback((v) => update({ [fromParam]: v }), [update, fromParam]);
    const setCustomTo = useCallback((v) => update({ [toParam]: v }), [update, toParam]);

    return usePeriodApi(timeline, setTimeline, customFrom, setCustomFrom, customTo, setCustomTo, rest);
}
