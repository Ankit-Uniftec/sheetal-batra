import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabaseClient";
import formatDate from "../utils/formatDate";
import { getStageLabel } from "../utils/barcodeService";
import {
  HALF_MADE_REASONS, listHalfMade, moveToHalfMade, rankHalfMadeFor, uploadHalfMadePhoto,
  applyHalfMadePiece, validatePhoto,
} from "../utils/halfMade";
import "../screens/OrderHistory.css";
import "./StageRequestModal.css";

const TYPE = { top: "Top", bottom: "Bottom", dupatta: "Dupatta", extra: "Extra" };

const Shell = ({ title, children, footer, onClose, busy }) => createPortal(
  <div className="oh-modal-overlay" onClick={(e) => e.stopPropagation()}>
    <div className="oh-modal srm-modal">
      <div className="oh-modal-header">
        <h3>{title}</h3>
        <button className="oh-modal-close" onClick={onClose} disabled={busy}>✕</button>
      </div>
      <div className="oh-modal-body">{children}</div>
      <div className="oh-modal-footer">{footer}</div>
    </div>
  </div>,
  document.body
);

/**
 * "Move to Half Made" (Release 15). A running order gets a warning first:
 * confirming leaves the order WITHOUT this piece (decision 2026-10-19).
 * Photos are optional and upload after the move.
 */
export function MoveToHalfMadeModal({ component, orderNo, by, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState([]);
  const [photoError, setPhotoError] = useState("");
  const [warning, setWarning] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  const pick = (files) => {
    const list = Array.from(files || []);
    const bad = list.map(validatePhoto).find(Boolean);
    setPhotoError(bad || "");
    if (!bad) setPhotos((p) => [...p, ...list].slice(0, 5));
  };

  const move = async (confirmActive) => {
    setBusy(true);
    setError("");
    try {
      const res = await moveToHalfMade({ componentId: component.id, reason, note, by, confirmActive });
      if (!res?.success) {
        if (res?.error === "ORDER_ACTIVE") { setWarning(res.message); return; }
        setError(res?.message || "Could not move the piece.");
        return;
      }
      const failed = [];
      for (const f of photos) {
        try { await uploadHalfMadePhoto(res.half_made_id, f); } catch { failed.push(f.name); }
      }
      setDone({ ...res, failed });
      onDone?.();
    } catch (err) {
      setError(err.message || "Could not move the piece.");
    } finally {
      setBusy(false);
    }
  };

  const name = `${component.component_label || TYPE[component.component_type] || "Piece"} · ${component.barcode}`;

  if (done) {
    return (
      <Shell title="Moved to Half Made" onClose={onClose} footer={<button className="oh-modal-btn save" onClick={onClose}>OK</button>}>
        <p className="srm-title">✓ {name} is now in Half Made Inventory ({done.location}), at {getStageLabel(done.stage) || done.stage}.</p>
        <p className="srm-muted">It is off the floor — no more scans for {orderNo}. The Inventory team can see it under Half Made.</p>
        {done.failed.length > 0 && <p className="srm-warn">Photos not uploaded: {done.failed.join(", ")}.</p>}
      </Shell>
    );
  }

  if (warning) {
    return (
      <Shell title="⚠ This order is still running" busy={busy} onClose={onClose} footer={(
        <>
          <button className="oh-modal-btn cancel" onClick={() => setWarning("")} disabled={busy}>Back</button>
          <button className="oh-modal-btn save" style={{ background: "#c62828" }} onClick={() => move(true)} disabled={busy}>
            {busy ? "Moving…" : "Move anyway"}
          </button>
        </>
      )}>
        <p className="srm-warn" style={{ fontSize: 14 }}>{warning}</p>
        <p className="srm-muted">The order will be left without {name}. Arrange a new piece for it separately if it is still needed.</p>
        {error && <p className="srm-warn">{error}</p>}
      </Shell>
    );
  }

  return (
    <Shell title={`Move to Half Made — ${orderNo}`} busy={busy} onClose={onClose} footer={(
      <>
        <button className="oh-modal-btn cancel" onClick={onClose} disabled={busy}>Close</button>
        <button className="oh-modal-btn save" onClick={() => move(false)} disabled={busy || !reason || (reason === "Other" && !note.trim())}
          title={!reason ? "Choose a reason" : undefined}>
          {busy ? "Moving…" : "Move to Half Made"}
        </button>
      </>
    )}>
      <p className="srm-title">{name}</p>
      <p className="srm-muted">The piece leaves its order and goes to Half Made Inventory with its details and every stage done, so it can be used for another order later.</p>
      <div className="oh-modal-field full">
        <label>Reason *</label>
        <select value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">Choose…</option>
          {HALF_MADE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className="oh-modal-field full">
        <label>Note{reason === "Other" ? " *" : ""}</label>
        <textarea className="oh-textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. stain on the front panel, embroidery fine" />
      </div>
      <div className="oh-modal-field full">
        <label>Photos (optional · JPEG or PNG · 5 MB each)</label>
        <input type="file" accept="image/jpeg,image/png" multiple onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
        {photos.length > 0 && <p className="srm-muted">{photos.map((p) => p.name).join(", ")}</p>}
        {photoError && <p className="srm-warn">{photoError}</p>}
      </div>
      {error && <p className="srm-warn">{error}</p>}
    </Shell>
  );
}

/**
 * "Use Half Made piece" (Release 15, point 21) — for a piece that has not
 * started: pick an available half-made piece of the same type (best match
 * first); the piece continues from the stage the half-made one reached.
 */
export function UseHalfMadeModal({ component, orderNo, by, onClose, onDone }) {
  const [item, setItem] = useState(null);
  const [pieces, setPieces] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [{ data: order }, list] = await Promise.all([
          supabase.from("orders").select("items").eq("id", component.order_id).maybeSingle(),
          listHalfMade({ status: "available" }),
        ]);
        setItem(order?.items?.[component.item_index ?? 0] || {});
        setPieces(list);
      } catch (err) {
        setError(err.message || "Could not load Half Made Inventory.");
        setPieces([]);
      }
    })();
  }, [component.order_id, component.item_index]);

  const ranked = useMemo(() => (pieces && item ? rankHalfMadeFor(component, item, pieces) : []), [pieces, item, component]);

  const use = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await applyHalfMadePiece({ halfMadeId: chosen.id, targetComponentId: component.id, by });
      if (!res?.success) { setError(res?.message || "Could not use the piece."); setConfirming(false); return; }
      setDone(res);
      onDone?.();
    } catch (err) {
      setError(err.message || "Could not use the piece.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Shell title="Half Made piece used" onClose={onClose} footer={<button className="oh-modal-btn save" onClick={onClose}>OK</button>}>
        <p className="srm-title">✓ {component.barcode} continues from {getStageLabel(done.stage) || done.stage}, using half-made piece {chosen.source_barcode}.</p>
        <p className="srm-muted">Its old label ({chosen.source_barcode}) now scans as {component.barcode}. Print the new label when convenient.</p>
      </Shell>
    );
  }

  if (confirming) {
    return (
      <Shell title="Confirm" busy={busy} onClose={onClose} footer={(
        <>
          <button className="oh-modal-btn cancel" onClick={() => setConfirming(false)} disabled={busy}>Back</button>
          <button className="oh-modal-btn save" onClick={use} disabled={busy}>{busy ? "Saving…" : "Use this piece"}</button>
        </>
      )}>
        <p className="srm-title">Use half-made {chosen.source_barcode} for {component.barcode} ({orderNo})?</p>
        <p className="srm-muted">{component.barcode} starts at <b>{getStageLabel(chosen.stage_reached) || chosen.stage_reached}</b> — the stages already done on the half-made piece count as done. It is at {chosen.location || "?"}.</p>
        {error && <p className="srm-warn">{error}</p>}
      </Shell>
    );
  }

  return (
    <Shell title={`Use a Half Made piece — ${component.barcode}`} onClose={onClose} footer={(
      <>
        <button className="oh-modal-btn cancel" onClick={onClose}>Close</button>
        <button className="oh-modal-btn save" disabled={!chosen} onClick={() => setConfirming(true)}>Continue</button>
      </>
    )}>
      <p className="srm-muted">For “{item?.product_name || "this product"}” ({TYPE[component.component_type] || component.component_type}). Best matches first.</p>
      {pieces === null ? <p className="srm-muted">Loading…</p> : ranked.length === 0 ? (
        <p className="srm-muted">No available Half Made {TYPE[component.component_type] || "piece"}.</p>
      ) : ranked.map(({ piece, why }) => (
        <label key={piece.id} className={`srm-piece ${chosen?.id === piece.id ? "srm-all" : ""}`}>
          <input type="radio" name="hm-pick" checked={chosen?.id === piece.id} onChange={() => setChosen(piece)} />
          <span className="srm-piece-main">
            <b>{piece.product_name || "—"}</b> · {piece.component_label || TYPE[piece.component_type]}
            {piece.size ? ` · Size ${piece.size}` : ""}{piece.colors ? ` · ${piece.colors}` : ""}
            <span className="srm-barcode">{piece.source_barcode}</span>
            <div className="srm-meta">from {piece.source_order_no} · {piece.reason} · {formatDate(piece.moved_at)} · {piece.location}{why.length ? ` · ${why.join(", ")}` : ""}</div>
          </span>
          <span className="srm-stage">{getStageLabel(piece.stage_reached) || piece.stage_reached}</span>
        </label>
      ))}
      {error && <p className="srm-warn">{error}</p>}
    </Shell>
  );
}
