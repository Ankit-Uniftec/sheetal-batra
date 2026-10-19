import React, { useState } from "react";
import { createPortal } from "react-dom";
import formatDate from "../utils/formatDate";
import { getStageLabel } from "../utils/barcodeService";
import { applyHalfMadePiece } from "../utils/halfMade";
import "../screens/OrderHistory.css";
import "./StageRequestModal.css";
import "./HalfMadeSuggestion.css";

const TYPE = { top: "Top", bottom: "Bottom", dupatta: "Dupatta", extra: "Extra" };

/**
 * One order's Half Made suggestions (Release 16): every piece of the order
 * that has not started and has an EXACT half-made match (same product, piece,
 * size, colour), with its matches and a Use button — the same confirmed step
 * as View Journey → Use Half Made piece (the piece continues from that stage).
 */
export function HalfMadeSuggestModal({ orderNo, suggestions, by, onClose, onUsed }) {
  const [confirm, setConfirm] = useState(null);   // { component, piece }
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

  return createPortal(
    <div className="oh-modal-overlay" onClick={(e) => e.stopPropagation()}>
      <div className="oh-modal srm-modal">
        <div className="oh-modal-header">
          <h3>♻ Half Made available — {orderNo}</h3>
          <button className="oh-modal-close" onClick={onClose} disabled={busy}>✕</button>
        </div>
        <div className="oh-modal-body">
          {done ? (
            <>
              <p className="srm-title">✓ {done.component.barcode} continues from {getStageLabel(done.stage) || done.stage}, using half-made piece {done.piece.source_barcode}.</p>
              <p className="srm-muted">The old label ({done.piece.source_barcode}) now scans as {done.component.barcode}. Print the new label when convenient.</p>
            </>
          ) : confirm ? (
            <>
              <p className="srm-title">Use half-made {confirm.piece.source_barcode} for {confirm.component.barcode}?</p>
              <p className="srm-muted">{confirm.component.barcode} starts at <b>{getStageLabel(confirm.piece.stage_reached) || confirm.piece.stage_reached}</b> — the stages already done on the half-made piece count as done. It is at {confirm.piece.location || "?"}.</p>
            </>
          ) : (
            <>
              <p className="srm-muted">Same product, piece, size and colour as these pieces of the order, already in Half Made Inventory. Using one lets the piece continue from the stage it reached.</p>
              {suggestions.map(({ component, item, matches }) => (
                <div key={component.id} className="hms-piece">
                  <p className="srm-title">
                    {item?.product_name || "—"} · {component.component_label || TYPE[component.component_type]}
                    <span className="srm-barcode">{component.barcode}</span>
                  </p>
                  {matches.map((m) => (
                    <div key={m.id} className="hms-match">
                      <span>
                        <b>{getStageLabel(m.stage_reached) || m.stage_reached}</b> · {m.location}
                        <span className="srm-meta"> · {m.source_barcode} from {m.source_order_no} · {m.reason} · {formatDate(m.moved_at)}</span>
                      </span>
                      <button type="button" className="hms-use" onClick={() => setConfirm({ component, piece: m })}>Use</button>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
          {error && <p className="srm-warn">{error}</p>}
        </div>
        <div className="oh-modal-footer">
          {done ? (
            <button className="oh-modal-btn save" onClick={onClose}>OK</button>
          ) : confirm ? (
            <>
              <button className="oh-modal-btn cancel" onClick={() => setConfirm(null)} disabled={busy}>Back</button>
              <button className="oh-modal-btn save" onClick={use} disabled={busy}>{busy ? "Saving…" : "Use this piece"}</button>
            </>
          ) : (
            <button className="oh-modal-btn cancel" onClick={onClose}>Close</button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** The badge on an order card. Renders nothing without a suggestion. */
export function HalfMadeBadge({ order, suggestions, by, onUsed }) {
  const [open, setOpen] = useState(false);
  if (!suggestions?.length) return null;
  const n = suggestions.length;
  return (
    <>
      <button type="button" className="hms-badge" title="A matching Half Made piece is in inventory"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
        ♻ Half Made available · {n}
      </button>
      {open && (
        <HalfMadeSuggestModal orderNo={order.order_no} suggestions={suggestions} by={by}
          onClose={() => setOpen(false)} onUsed={onUsed} />
      )}
    </>
  );
}

/** The line above a dashboard's list: every order with a suggestion. */
export function HalfMadeBanner({ byOrder, orders, by, onUsed }) {
  const [openId, setOpenId] = useState(null);
  const ids = Object.keys(byOrder || {});
  if (!ids.length) return null;
  const orderById = new Map((orders || []).map((o) => [o.id, o]));
  const open = openId && orderById.get(openId);
  return (
    <div className="hms-banner">
      <span>♻ <b>{ids.length}</b> order{ids.length === 1 ? "" : "s"} can use a Half Made piece:</span>
      {ids.map((id) => (
        <button key={id} type="button" className="hms-chip" onClick={() => setOpenId(id)}>
          {orderById.get(id)?.order_no || "order"}
        </button>
      ))}
      {open && (
        <HalfMadeSuggestModal orderNo={open.order_no} suggestions={byOrder[openId] || []} by={by}
          onClose={() => setOpenId(null)} onUsed={onUsed} />
      )}
    </div>
  );
}
