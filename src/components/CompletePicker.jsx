import React, { useState } from "react";
import "./CompletePicker.css";

// ============================================================
// CompletePicker — "which products to Mark as Completed" modal.
//
// A multi-product order can have some products finished (all pieces at Final
// QC) while others are still in production. This lets the Production Head/
// Manager complete just the finished ones. Extracted from the Production
// Manager dashboard so every dashboard with a Mark-as-Completed button shows
// the same picker (PM, Warehouse PH, B2B Production, B2B Merchandiser).
//
// A product whose pieces are ALL already dispatched is shown but not
// selectable (nothing left to complete).
//
// Props:
//   order        the order row (needs order_no + items[])
//   components   that order's order_components (item_index, current_stage, …)
//   productIdxs  the distinct product indexes to offer
//   onConfirm    (pickedIndexes | null) => void   null = every product (whole order)
//   onClose      () => void
// ============================================================
const TERMINAL = ["disposed", "scrapped"];
// A piece at or beyond production_complete has already been marked completed —
// there's nothing left to complete for it.
const COMPLETED_OR_BEYOND = ["production_complete", "packaging_dispatch", "dispatched"];

export default function CompletePicker({ order, components = [], productIdxs = [], onConfirm, onClose }) {
    const [sel, setSel] = useState([]);
    const items = Array.isArray(order?.items) ? order.items : [];

    const rows = productIdxs.map((idx) => {
        const pieces = components.filter(
            (c) => (c.item_index ?? 0) === idx && !TERMINAL.includes(c.current_stage)
        );
        // A product is "done" for this dialog once EVERY piece is already
        // completed or shipped — it should not be offered for completion again.
        const doneCount = pieces.filter((c) => COMPLETED_OR_BEYOND.includes(c.current_stage)).length;
        const dispatchedCount = pieces.filter((c) => c.current_stage === "dispatched").length;
        const allDone = pieces.length > 0 && doneCount === pieces.length;
        const it = items[idx] || {};
        return {
            idx,
            pieces,
            allOut: allDone,
            // What to show instead of the "N pcs" count when it's not selectable.
            doneLabel: allDone
                ? (dispatchedCount === pieces.length ? "dispatched" : "completed")
                : null,
            name: it.product_name || pieces[0]?.component_label || `Product ${idx + 1}`,
            // Duplicate product names are common (two identical dupattas); the
            // size/colour is what tells them apart.
            meta: [it.size, it.color?.name || it.top_color?.name].filter(Boolean).join(" · "),
        };
    });

    const selectable = rows.filter((r) => !r.allOut);
    const allSelected = selectable.length > 0 && sel.length === selectable.length;

    const toggle = (idx) =>
        setSel((prev) => (prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]));

    const run = () => {
        const picked = [...sel].sort((a, b) => a - b);
        onClose?.();
        // Selecting every remaining product IS the whole order — pass null so
        // the RPC completes the order rather than looping per product.
        onConfirm?.(allSelected ? null : picked);
    };

    return (
        <div className="cpick-overlay" onClick={onClose}>
            <div className="cpick-modal" onClick={(e) => e.stopPropagation()}>
                <div className="cpick-head">
                    <p className="cpick-title">Mark as Completed</p>
                    <span className="cpick-order">{order?.order_no}</span>
                    <button className="cpick-close" onClick={onClose}>✕</button>
                </div>
                <p className="cpick-hint">
                    This order has {rows.length} products. Select which to complete —
                    every selected product must have passed Final QC. The order stays
                    open until every product is done.
                </p>

                <div className="cpick-list">
                    {rows.map((r) => (
                        <label
                            key={r.idx}
                            className={`cpick-item ${r.allOut ? "cpick-done" : ""} ${sel.includes(r.idx) ? "cpick-sel" : ""}`}
                        >
                            <input
                                type="checkbox"
                                className="cpick-check"
                                checked={sel.includes(r.idx)}
                                disabled={r.allOut}
                                onChange={() => toggle(r.idx)}
                            />
                            <span className="cpick-item-body">
                                <span className="cpick-item-top">
                                    <span className="cpick-item-name">{r.name}</span>
                                    <span className="cpick-item-count">
                                        {r.allOut ? r.doneLabel : `${r.pieces.length} pc${r.pieces.length === 1 ? "" : "s"}`}
                                    </span>
                                </span>
                                {r.meta && <span className="cpick-item-meta">{r.meta}</span>}
                                <span className="cpick-item-pieces">
                                    {r.pieces.map((p) => p.component_label || p.component_type).join(" · ")}
                                </span>
                            </span>
                        </label>
                    ))}
                </div>

                <div className="cpick-actions">
                    <button className="cpick-go" disabled={sel.length === 0} onClick={run}>
                        {sel.length === 0
                            ? "Select at least one product"
                            : allSelected
                                ? "Complete the whole order"
                                : `Complete ${sel.length} product${sel.length === 1 ? "" : "s"}`}
                    </button>
                    <button className="cpick-cancel" onClick={onClose}>Cancel</button>
                </div>
            </div>
        </div>
    );
}
