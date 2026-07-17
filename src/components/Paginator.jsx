import React, { useState } from "react";
import "./Paginator.css";

// ============================================================
// Paginator — the ONE pagination control for every list in the app.
//
// Before this, ~40 lists hand-rolled their own pager: most were Prev/Next only
// (reaching page 10 took 10 clicks), three screens copy-pasted the same
// numbered-pages logic, and exactly one list in the whole app scrolled back to
// the top on page change. This replaces all of that:
//
//   - numbered pages with ellipsis (1 … 4 [5] 6 … 20)
//   - Prev / Next
//   - jump-to-page input (appears once there are enough pages to need it)
//   - scrolls to the top of the list on every page change (pass scrollTo:
//     a ref to scroll that element into view, false to disable, or leave the
//     default to scroll the window)
//
// Usage:
//   <Paginator page={currentPage} totalPages={totalPages} onChange={setCurrentPage} />
//   <Paginator page={p} totalPages={n} onChange={setP} scrollTo={listRef} />
//
// Renders nothing when there's a single page — safe to drop under any list.
// ============================================================

// 1 … c-1 c c+1 … n  (numbers + "…" markers)
function pageNumbers(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = [1];
    if (current > 3) pages.push("…");
    for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
    if (current < total - 2) pages.push("…");
    pages.push(total);
    return pages;
}

export default function Paginator({ page, totalPages, onChange, scrollTo, showJump = true }) {
    const [jump, setJump] = useState("");

    if (!totalPages || totalPages <= 1) return null;

    const go = (p) => {
        const target = Math.min(Math.max(1, p), totalPages);
        if (target === page) return;
        onChange(target);
        // Back to the top of the list — the old pagers left the user stranded
        // at the bottom of the page after every Next click.
        if (scrollTo === false) return;
        if (scrollTo?.current) scrollTo.current.scrollIntoView({ behavior: "smooth", block: "start" });
        else window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const submitJump = (e) => {
        e.preventDefault();
        const n = parseInt(jump, 10);
        if (!isNaN(n)) go(n);
        setJump("");
    };

    return (
        <div className="pgn">
            <button className="pgn-btn" disabled={page === 1} onClick={() => go(page - 1)}>‹ Prev</button>

            <div className="pgn-pages">
                {pageNumbers(page, totalPages).map((p, i) =>
                    p === "…" ? (
                        <span key={`e${i}`} className="pgn-ellipsis">…</span>
                    ) : (
                        <button
                            key={p}
                            className={`pgn-num ${p === page ? "active" : ""}`}
                            onClick={() => go(p)}
                        >
                            {p}
                        </button>
                    )
                )}
            </div>

            <button className="pgn-btn" disabled={page === totalPages} onClick={() => go(page + 1)}>Next ›</button>

            {showJump && totalPages > 7 && (
                <form className="pgn-jump" onSubmit={submitJump}>
                    <input
                        className="pgn-jump-input"
                        type="number"
                        min="1"
                        max={totalPages}
                        placeholder="Pg"
                        value={jump}
                        onChange={(e) => setJump(e.target.value)}
                        aria-label="Jump to page"
                    />
                    <button type="submit" className="pgn-btn">Go</button>
                </form>
            )}
        </div>
    );
}
