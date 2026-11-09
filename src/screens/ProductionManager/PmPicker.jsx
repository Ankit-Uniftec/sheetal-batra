import React, { useState } from "react";
import { getStageLabel } from "../../utils/barcodeService";
import { applyHalfMadePiece } from "../../utils/halfMade";
import { PmModal } from "./PmModals";
import { fmtDate } from "./pmModel";

// ============================================================
// Two small windows in the dashboard's own look:
//   PmCompletePicker  which products of an order to Mark as Completed
//   HalfMadeButton    the "Half Made available" button and its window
// They do exactly what the shared CompletePicker and HalfMadeSuggestion do
// (the older dashboards keep those): the picker hands back the products
// chosen (null = the whole order) and the half-made window calls
// applyHalfMadePiece with the same arguments.
// ============================================================

// Pieces taken off the floor do not count; pieces at or past Production
// Complete have already been completed.
const TERMINAL = ["disposed", "scrapped"];
const COMPLETED_OR_BEYOND = ["production_complete", "packaging_dispatch", "dispatched"];
const TYPE = { top: "Top", bottom: "Bottom", dupatta: "Dupatta", extra: "Extra" };

export function PmCompletePicker({ order, components = [], productIdxs = [], onConfirm, onClose }) {
  const [sel, setSel] = useState([]);
  const items = Array.isArray(order?.items) ? order.items : [];
  const rows = productIdxs.map((idx) => {
    const pieces = components.filter((c) => (c.item_index ?? 0) === idx && !TERMINAL.includes(c.current_stage));
    const doneCount = pieces.filter((c) => COMPLETED_OR_BEYOND.includes(c.current_stage)).length;
    const dispatchedCount = pieces.filter((c) => c.current_stage === "dispatched").length;
    const allDone = pieces.length > 0 && doneCount === pieces.length;
    const it = items[idx] || {};
    return {
      idx, pieces, allDone,
      doneLabel: allDone ? (dispatchedCount === pieces.length ? "Already dispatched" : "Already completed") : null,
      name: it.product_name || pieces[0]?.component_label || `Product ${idx + 1}`,
      meta: [it.size && `Size ${it.size}`, it.color?.name || it.top_color?.name].filter(Boolean).join(" · "),
    };
  });
  const selectable = rows.filter((r) => !r.allDone);
  const allSelected = selectable.length > 0 && sel.length === selectable.length;
  const toggle = (idx) => setSel((p) => (p.includes(idx) ? p.filter((i) => i !== idx) : [...p, idx]));
  const run = () => {
    const picked = [...sel].sort((a, b) => a - b);
    onClose?.();
    // Every remaining product is the whole order: null completes the order itself.
    onConfirm?.(allSelected ? null : picked);
  };

  return (
    <PmModal
      title="Mark as Completed"
      sub={`${order?.order_no || ""} · ${rows.length} products`}
      onClose={onClose}
      width={560}
      footer={(
        <>
          <button type="button" className="ceo-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="ceo-btn is-primary" disabled={!sel.length} onClick={run}>
            {!sel.length ? "Choose at least one product" : allSelected ? "Complete the whole order" : `Complete ${sel.length} product${sel.length === 1 ? "" : "s"}`}
          </button>
        </>
      )}
    >
      <p className="pmx-note">Choose the products to complete. Every chosen product must have passed Final QC; the order stays open until every product is done.</p>
      <div className="pmk-list">
        {rows.map((r) => {
          const on = sel.includes(r.idx);
          return (
            <button key={r.idx} type="button" className={`pmk-item${on ? " is-on" : ""}`} disabled={r.allDone} aria-pressed={on} onClick={() => toggle(r.idx)}>
              <span className="pmk-check" aria-hidden="true">{on ? "✓" : ""}</span>
              <span className="pmk-body">
                <b>{r.name}</b>
                {r.meta && <small>{r.meta}</small>}
                <small>{r.pieces.map((p) => p.component_label || TYPE[p.component_type] || p.component_type).join(" · ") || "No pieces"}</small>
              </span>
              <span className="pmk-count">{r.allDone ? r.doneLabel : `${r.pieces.length} piece${r.pieces.length === 1 ? "" : "s"}`}</span>
            </button>
          );
        })}
      </div>
    </PmModal>
  );
}

/** The button on an order when a matching Half Made piece is in inventory, and its window. */
export function HalfMadeButton({ order, suggestions, by, onUsed }) {
  const [open, setOpen] = useState(false);
  if (!suggestions?.length) return null;
  return (
    <>
      <button type="button" className="ceo-btn pm-halfmade-btn" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
        Half Made available<b>{suggestions.length}</b>
      </button>
      {open && <HalfMadeWindow orderNo={order.order_no} suggestions={suggestions} by={by} onClose={() => setOpen(false)} onUsed={onUsed} />}
    </>
  );
}

function HalfMadeWindow({ orderNo, suggestions, by, onClose, onUsed }) {
  const [confirm, setConfirm] = useState(null); // { component, piece }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const use = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await applyHalfMadePiece({ halfMadeId: confirm.piece.id, targetComponentId: confirm.component.id, by });
      if (!res?.success) { setError(res?.message || "Could not use the piece."); return; }
      setDone({ ...confirm, stage: res.stage });
      setConfirm(null);
      onUsed?.();
    } catch (err) {
      setError(err.message || "Could not use the piece.");
    } finally {
      setBusy(false);
    }
  };
  const stage = (s) => getStageLabel(s) || s;
  const footer = done
    ? <button type="button" className="ceo-btn is-primary" onClick={onClose}>Done</button>
    : confirm
      ? <><button type="button" className="ceo-btn" onClick={() => setConfirm(null)} disabled={busy}>Back</button><button type="button" className="ceo-btn is-primary" onClick={use} disabled={busy}>{busy ? "Saving" : "Use this piece"}</button></>
      : <button type="button" className="ceo-btn" onClick={onClose}>Close</button>;

  return (
    <PmModal title="Half Made Pieces" sub={orderNo} onClose={busy ? () => {} : onClose} width={620} footer={footer}>
      {done ? (
        <div className="pmk-done">
          <b><span className="pm-code">{done.component.barcode}</span> now continues from {stage(done.stage)}, using half-made piece <span className="pm-code">{done.piece.source_barcode}</span>.</b>
          <p className="pmx-note">The old label ({done.piece.source_barcode}) now scans as {done.component.barcode}. Print the new label when convenient.</p>
        </div>
      ) : confirm ? (
        <div className="pmk-done">
          <b>Use half-made <span className="pm-code">{confirm.piece.source_barcode}</span> for <span className="pm-code">{confirm.component.barcode}</span>?</b>
          <p className="pmx-note">{confirm.component.barcode} will start at <b>{stage(confirm.piece.stage_reached)}</b>; the stages already done on the half-made piece count as done. It is at {confirm.piece.location || "an unknown place"}.</p>
        </div>
      ) : (
        <>
          <p className="pmx-note">These pieces match pieces of this order (same product, piece, size and colour) and are already in Half Made Inventory. Using one lets the piece continue from the stage it reached.</p>
          {suggestions.map(({ component, item, matches }) => (
            <div key={component.id} className="pmk-group">
              <div className="pmk-group-head"><b>{item?.product_name || "Product"} · {component.component_label || TYPE[component.component_type]}</b><span className="pm-code">{component.barcode}</span></div>
              {matches.map((m) => (
                <div key={m.id} className="pmk-match">
                  <span className="pmk-body">
                    <b>Reached {stage(m.stage_reached)}</b>
                    <small>At {m.location || "–"} · from {m.source_order_no} ({m.source_barcode}) · {m.reason} · {fmtDate(m.moved_at)}</small>
                  </span>
                  <button type="button" className="ceo-btn" onClick={() => setConfirm({ component, piece: m })}>Use</button>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
      {error && <p className="pmx-error">{error}</p>}
    </PmModal>
  );
}
