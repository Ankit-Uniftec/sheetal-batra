import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getComponentStageLabel } from "../../utils/barcodeService";
import { planBreakdownChange, targetPieces, isNoChange } from "../../utils/breakdownChange";
import { fetchLinePieces, saveBreakdownChange } from "../../utils/breakdownChangeApi";
import { BREAKDOWN_CHOICES, breakdownForItem, matchChoice } from "./breakdown.mjs";
import "../OrderHistory.css";
import "../../components/StageRequestModal.css";

const TYPE = { top: "Top", bottom: "Bottom", dupatta: "Dupatta", extra: "Extra" };
const stageOf = (c) => (c.current_stage && c.current_stage !== "order_received" ? getComponentStageLabel(c) : "Not started");

/**
 * Change the garment breakdown of ONE line after its barcodes exist (meeting
 * point 8, Release 11). Shows, before anything is saved, what happens to every
 * piece: kept, converted to a new barcode (the old label keeps scanning),
 * removed, taken off the floor, or added. Reason required.
 *
 * @param {boolean} allowStarted  false on an order card (pieces must not have
 *                                started); true on the Breakdown Changes screen
 */
export default function BreakdownChangeModal({ order, itemIndex, allowStarted, by, onClose, onDone }) {
  const item = order.items?.[itemIndex] || {};
  const currentKey = matchChoice(breakdownForItem(order, itemIndex));
  const [choiceKey, setChoiceKey] = useState(currentKey || "");
  const [pieces, setPieces] = useState(null);
  const [packedIds, setPackedIds] = useState(new Set());
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    fetchLinePieces(order.id)
      .then(({ components, packedIds: p }) => { setPieces(components); setPackedIds(p); })
      .catch((err) => setError(err.message || "Could not load the pieces."));
  }, [order.id]);

  const choice = BREAKDOWN_CHOICES.find((c) => c.key === choiceKey);
  const line = useMemo(() => (pieces || []).filter((c) => (c.item_index ?? 0) === itemIndex), [pieces, itemIndex]);
  const plan = useMemo(() => {
    if (!choice || !pieces) return null;
    return planBreakdownChange(line, targetPieces(order, itemIndex, choice.value), packedIds);
  }, [choice, pieces, line, order, itemIndex, packedIds]);

  // A barcode taken off the floor earlier can't be brought back by a change
  // (its retired piece still holds that barcode).
  const blockedReAdd = plan ? plan.add.filter((a) => line.some((c) => c.cancelled_at && c.barcode === a.barcode)) : [];
  const startedNotAllowed = plan && !allowStarted && plan.startedCount > 0;
  const canSave = plan && !isNoChange(plan) && !plan.blocked.length && !blockedReAdd.length
    && !startedNotAllowed && reason.trim() && !busy;

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await saveBreakdownChange({ order, itemIndex, choice, plan, allowStarted, by, reason });
      if (!res.success) { setError(res.message); setConfirming(false); return; }
      setResult(res);
      onDone?.();
    } catch (err) {
      setError(err.message || "Could not save the change.");
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
    return shell("Breakdown changed", (
      <>
        <p className="srm-title">✓ {order.order_no} · “{item.product_name}” is now <b>{choice.label}</b>.</p>
        {plan.convert.length > 0 && <p className="srm-muted">Relabelled: {plan.convert.map(({ from, to }) => `${from.barcode} → ${to.barcode}`).join(", ")} — the old labels still scan.</p>}
        {plan.remove.length + plan.retire.length > 0 && <p className="srm-muted">No longer made: {[...plan.remove, ...plan.retire].map((p) => p.barcode).join(", ")}.</p>}
        {plan.retire.length > 0 && <p className="srm-muted">Production has been notified.</p>}
        <p className="srm-title">Print the Warehouse PDF again for the corrected barcodes.</p>
        {result.remapError && <p className="srm-warn">The change is saved, but new barcodes were not created yet ({result.remapError}). Re-run sync for this order.</p>}
      </>
    ), <button className="oh-modal-btn save" onClick={onClose}>OK</button>);
  }

  const row = (key, text, tone) => <li key={key} style={{ color: tone }}>{text}</li>;
  const preview = plan && (
    <ul className="srm-pm-pieces">
      {plan.keep.map((p) => row(`k${p.id}`, `${p.barcode} — stays (${TYPE[p.component_type]}, ${stageOf(p)})`))}
      {plan.convert.map(({ from, to, started }) => row(`c${from.id}`,
        `${from.barcode} → ${to.barcode} (${TYPE[to.component_type]} “${to.component_label}”) — same piece${started ? `, keeps its stage: ${stageOf(from)}` : ""}; the old label keeps scanning`, "#8d6e00"))}
      {plan.remove.map((p) => row(`r${p.id}`, `${p.barcode} — removed (not started)`, "#c62828"))}
      {plan.retire.map((p) => row(`t${p.id}`, `${p.barcode} — at ${stageOf(p)}: will be TAKEN OFF THE FLOOR (history kept)`, "#c62828"))}
      {plan.add.map((p) => row(`a${p.barcode}`, `${p.barcode} — new piece (${TYPE[p.component_type]}), needs its label printed`, "#2e7d32"))}
      {plan.blocked.map(({ piece, why }) => row(`b${piece.id}`, `${piece.barcode} — ${why}. Can't change this line.`, "#c62828"))}
      {blockedReAdd.map((p) => row(`x${p.barcode}`, `${p.barcode} was taken off the floor earlier and can't be brought back here.`, "#c62828"))}
    </ul>
  );

  if (confirming) {
    return shell("Confirm — production has started", (
      <>
        <p className="srm-title">{plan.startedCount} piece{plan.startedCount === 1 ? "" : "s"} of {order.order_no} already started production.</p>
        {preview}
        <p className="srm-warn">Pieces taken off the floor stop being made. The production head and the PM are notified.</p>
        <p className="srm-muted">Reason: {reason.trim()}</p>
        {error && <p className="srm-warn">{error}</p>}
      </>
    ), (
      <>
        <button className="oh-modal-btn cancel" onClick={() => setConfirming(false)} disabled={busy}>Back</button>
        <button className="oh-modal-btn save" onClick={save} disabled={busy}>{busy ? "Saving…" : "Confirm change"}</button>
      </>
    ));
  }

  return shell(`Change breakdown — ${order.order_no}`, (
    <>
      <p className="srm-title">“{item.product_name}”</p>
      <p className="srm-muted">Current: <b>{BREAKDOWN_CHOICES.find((c) => c.key === currentKey)?.label || "not set"}</b>. Pick what production should really make.</p>
      <div className="srm-row" style={{ flexWrap: "wrap", gap: 6, marginTop: 4 }}>
        {BREAKDOWN_CHOICES.map((c) => (
          <label key={c.key} className={`srm-piece ${choiceKey === c.key ? "srm-all" : ""}`} style={{ flex: "1 1 45%" }}>
            <input type="radio" name="bd-choice" checked={choiceKey === c.key} onChange={() => setChoiceKey(c.key)} />
            <span className="srm-piece-main">{c.label} <span className="srm-barcode">{c.hint}</span></span>
          </label>
        ))}
      </div>
      {!pieces ? (
        <p className="srm-muted">Loading the pieces…</p>
      ) : !plan ? null : isNoChange(plan) ? (
        <p className="srm-muted">That is the current breakdown — nothing would change.</p>
      ) : (
        <>
          <p className="srm-title" style={{ marginTop: 12 }}>What happens to the pieces</p>
          {preview}
          {startedNotAllowed && (
            <p className="srm-warn">Some pieces already started production. Make this change from Breakdown Changes in the sidebar.</p>
          )}
        </>
      )}
      <div className="oh-modal-field full">
        <label>Reason *</label>
        <textarea className="oh-textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="Why was the breakdown wrong? e.g. it is a potli, not a top" />
      </div>
      {error && <p className="srm-warn">{error}</p>}
    </>
  ), (
    <>
      <button className="oh-modal-btn cancel" onClick={onClose}>Close</button>
      <button className="oh-modal-btn save" disabled={!canSave}
        onClick={() => (plan.startedCount > 0 ? setConfirming(true) : save())}
        title={!reason.trim() ? "Enter a reason" : undefined}>
        {busy ? "Saving…" : "Save change"}
      </button>
    </>
  ));
}
