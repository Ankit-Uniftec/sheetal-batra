import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getComponentStageLabel } from "../utils/barcodeService";
import { dispatchOverride, pieceBlock, pieceNeed } from "../utils/dispatchOverride";
import "../screens/OrderHistory.css";
import "./StageRequestModal.css";

const PIECE_LABEL = { top: "Top", bottom: "Bottom", dupatta: "Dupatta", extra: "Extra" };

/**
 * "Dispatch Override" on the packaging desk (meeting points 10 + 34): send
 * pieces out without the Packaging & Dispatch scan — a piece that won't scan,
 * or one that has not passed Final QC. Reason mandatory; every piece is logged
 * as a Packaging Override (utils/dispatchOverride). Rendered into <body> so
 * the page can't clip it.
 *
 * @param {object}   order        { id, order_no, items }
 * @param {object[]} components   the order's pieces
 * @param {Set}      packedIds    component ids already in a live box
 * @param {string}   by           packer's email
 * @param {function} onClose
 * @param {function} onDone       called after anything moved, to reload the desk
 */
export default function DispatchOverrideModal({ order, components, packedIds, by, onClose, onDone }) {
  const pieces = useMemo(() => (components || []).map((c) => ({
    c,
    blocked: pieceBlock(c, packedIds),
    product: order.items?.[c.item_index ?? 0]?.product_name || "",
  })), [components, packedIds, order.items]);
  const pickable = pieces.filter((p) => !p.blocked);

  const [picked, setPicked] = useState(() => new Set());
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const toggle = (id) => setPicked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allPicked = pickable.length > 0 && pickable.every((p) => picked.has(p.c.id));
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(pickable.map((p) => p.c.id)));
  const chosen = pieces.filter((p) => picked.has(p.c.id)).map((p) => p.c);
  const skipsQc = chosen.filter((c) => pieceNeed(c) === "Not past Final QC").length;
  const canSend = chosen.length > 0 && reason.trim() && !busy;

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await dispatchOverride({ order, pieces: chosen, reason, by });
      setResult(res);
      if (res.moved.length) onDone?.();
    } catch (err) {
      setError(err.message || "Override failed.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const shell = (title, body, footer) => createPortal(
    <div className="oh-modal-overlay" onClick={(e) => e.stopPropagation()}>
      <div className="oh-modal srm-modal">
        <div className="oh-modal-header">
          <h3>{title}</h3>
          <button className="oh-modal-close" onClick={onClose} disabled={busy}>✕</button>
        </div>
        <div className="oh-modal-body">{body}</div>
        <div className="oh-modal-footer">{footer}</div>
      </div>
    </div>,
    document.body
  );

  if (result) {
    return shell(`Dispatch Override — ${order.order_no}`, (
      <>
        {result.moved.length > 0 && (
          <p className="srm-title">✓ {result.moved.length} piece{result.moved.length === 1 ? "" : "s"} dispatched: {result.moved.map((c) => c.barcode).join(", ")}</p>
        )}
        {result.failed.length > 0 && (
          <p className="srm-warn">Not dispatched: {result.failed.map((f) => `${f.barcode} — ${f.error}`).join("; ")}</p>
        )}
        {result.shipmentError && <p className="srm-warn">Box not recorded ({result.shipmentError}). The pieces are dispatched — tell the Production Manager so the shipment can be added.</p>}
        {result.logFailed > 0 && <p className="srm-warn">{result.logFailed} override log entr{result.logFailed === 1 ? "y" : "ies"} could not be saved. The pieces are dispatched.</p>}
      </>
    ), <button className="oh-modal-btn save" onClick={onClose}>OK</button>);
  }

  if (confirming) {
    return shell("Confirm Dispatch Override", (
      <>
        <p className="srm-title">Dispatch {chosen.length} piece{chosen.length === 1 ? "" : "s"} of {order.order_no} without the dispatch scan?</p>
        <ul className="srm-pm-pieces">
          {chosen.map((c) => <li key={c.id}>{c.barcode} — {getComponentStageLabel(c)} · {pieceNeed(c)}</li>)}
        </ul>
        {skipsQc > 0 && <p className="srm-warn">{skipsQc} piece{skipsQc === 1 ? " has" : "s have"} not passed Final QC.</p>}
        <p className="srm-muted">Reason: {reason.trim()}</p>
        <p className="srm-muted">This is logged under your name and cannot be undone from this screen.</p>
        {error && <p className="srm-warn">{error}</p>}
      </>
    ), (
      <>
        <button className="oh-modal-btn cancel" onClick={() => setConfirming(false)} disabled={busy}>Back</button>
        <button className="oh-modal-btn save" onClick={send} disabled={busy}>{busy ? "Dispatching…" : "Confirm dispatch"}</button>
      </>
    ));
  }

  return shell(`Dispatch Override — ${order.order_no}`, (
    <>
      <p className="srm-muted">Send pieces out without the Packaging &amp; Dispatch scan — when a piece won't scan or hasn't passed Final QC. Every piece is logged with your reason.</p>
      <p className="srm-title">Pieces going in this box</p>
      {pieces.length === 0 ? (
        <p className="srm-muted">This order has no barcoded pieces.</p>
      ) : (
        <>
          <label className="srm-piece srm-all">
            <input type="checkbox" checked={allPicked} onChange={toggleAll} disabled={!pickable.length} />
            All pieces{pickable.length < pieces.length ? ` (${pickable.length} of ${pieces.length} can go)` : ""}
          </label>
          {pieces.map(({ c, blocked, product }) => (
            <label key={c.id} className={`srm-piece ${blocked ? "srm-blocked" : ""}`}>
              <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} disabled={!!blocked} />
              <span className="srm-piece-main">
                <b>{product || "—"}</b> · {c.component_label || PIECE_LABEL[c.component_type] || c.component_type}
                <span className="srm-barcode">{c.barcode}</span>
              </span>
              <span className="srm-stage">{blocked || `${getComponentStageLabel(c)} · ${pieceNeed(c)}`}</span>
            </label>
          ))}
        </>
      )}
      <div className="oh-modal-field full">
        <label>Reason *</label>
        <textarea className="oh-textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this going out without the scan? e.g. barcode label torn" />
      </div>
      {error && <p className="srm-warn">{error}</p>}
    </>
  ), (
    <>
      <button className="oh-modal-btn cancel" onClick={onClose}>Close</button>
      <button className="oh-modal-btn save" onClick={() => setConfirming(true)} disabled={!canSend}
        title={!chosen.length ? "Pick at least one piece" : !reason.trim() ? "Enter a reason" : undefined}>
        Dispatch selected
      </button>
    </>
  ));
}
