import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabaseClient";
import { PRODUCTION_STAGES, getStageLabel, getComponentStageLabel, fetchOrderComponents } from "../utils/barcodeService";
import formatDate from "../utils/formatDate";
import {
  REQUEST_TYPES, createStageRequests, listOrderRequests, pendingComponentIds,
  pieceBlock, pieceProductName,
} from "../utils/stageRequests";
import "../screens/OrderHistory.css";
import "./StageRequestModal.css";

// Same target list as the PM's own override (ProductionOverrides
// getAdvanceableStages): any stage, forward or back, except the terminal ones.
const TARGET_STAGES = PRODUCTION_STAGES.filter((s) => !["disposed", "scrapped", "order_received"].includes(s.value));

const PIECE_LABEL = { top: "Top", bottom: "Bottom", dupatta: "Dupatta", extra: "Extra" };

/**
 * "Request Skip / Advance" (meeting point 5) — a production head asks the
 * Production Manager to move pieces they can't move themselves. Pieces are
 * listed by PRODUCT NAME + piece + barcode, because a multi-product order
 * can't be told apart by SKU alone. Earlier requests for the order and their
 * outcome are shown first.
 *
 * Works from three places: the production-head dashboards (order + pieces in
 * hand), the scan-station All Orders list (order without product names), and
 * the Scan Station screen right after a scan (only the scanned piece's
 * order id + the piece to preselect). Whatever is missing — the order's
 * product names, its pieces, the requester's email — is fetched here. Rendered
 * into <body> (portal) so a page with backdrop-filter can't clip it.
 *
 * @param {object}    order          { id, order_no, items? }
 * @param {object[]}  [components]   the order's pieces; fetched when omitted
 * @param {function}  onClose
 * @param {function}  [showPopup]    caller's popup; without one the modal confirms inline
 * @param {string}    [requestedBy]  requester's email; the logged-in user when omitted
 * @param {string[]}  [preselectIds] pieces to tick on open (e.g. the one just scanned)
 */
export default function StageRequestModal({ order: orderIn, components: componentsIn, onClose, showPopup, requestedBy: requestedByIn, preselectIds }) {
  const [order, setOrder] = useState(orderIn);
  const [components, setComponents] = useState(componentsIn || []);
  const [requestedBy, setRequestedBy] = useState(requestedByIn || "");
  const [sentInline, setSentInline] = useState(false);
  const [history, setHistory] = useState([]);
  const [pending, setPending] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState(() => new Set(preselectIds || []));
  const [type, setType] = useState("");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);

  // Fill in what the caller didn't have: product names, pieces, who is asking.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!Array.isArray(orderIn.items)) {
          const { data } = await supabase.from("orders").select("id, order_no, items").eq("id", orderIn.id).single();
          if (!cancelled && data) setOrder((prev) => ({ ...prev, ...data }));
        }
        if (!componentsIn) {
          const comps = await fetchOrderComponents(orderIn.id);
          if (!cancelled) setComponents(comps || []);
        }
        if (!requestedByIn) {
          const { data } = await supabase.auth.getUser();
          if (!cancelled) setRequestedBy(data?.user?.email?.toLowerCase() || "");
        }
      } catch (err) {
        console.error("Request popup: could not load the order:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [orderIn, componentsIn, requestedByIn]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, p] = await Promise.all([listOrderRequests(order.id), pendingComponentIds(order.id)]);
      setHistory(h);
      setPending(p);
    } catch (err) {
      console.error("Request history load failed:", err);
    } finally {
      setLoading(false);
    }
  }, [order.id]);

  useEffect(() => { load(); }, [load]);

  const pieces = useMemo(() => [...components]
    .sort((a, b) => (a.item_index ?? 0) - (b.item_index ?? 0))
    .map((c) => ({ c, blocked: pieceBlock(c, pending), product: pieceProductName(order, c) })), [components, pending, order]);
  const pickable = pieces.filter((p) => !p.blocked);
  const allPicked = pickable.length > 0 && pickable.every((p) => picked.has(p.c.id));

  const toggle = (id) => setPicked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(pickable.map((p) => p.c.id)));

  const canSend = picked.size > 0 && type && target && reason.trim() && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await createStageRequests({
        order,
        components: pieces.filter((p) => picked.has(p.c.id) && !p.blocked).map((p) => p.c),
        type,
        targetStage: target,
        reason,
        by: requestedBy,
      });
      if (showPopup) {
        showPopup({ type: "success", title: "Request Sent", message: `Sent to the Production Manager for ${order.order_no}. You'll be notified when it's decided.`, confirmText: "OK" });
        onClose();
      } else {
        setSentInline(true);
      }
    } catch (err) {
      if (showPopup) showPopup({ type: "error", title: "Couldn't send", message: err.message || "Please try again.", confirmText: "OK" });
      else window.alert(err.message || "Couldn't send. Please try again.");
      load();
    } finally {
      setSending(false);
    }
  };

  if (sentInline) {
    return createPortal(
      <div className="oh-modal-overlay" onClick={(e) => e.stopPropagation()}>
        <div className="oh-modal srm-modal">
          <div className="oh-modal-header"><h3>Request Sent</h3></div>
          <div className="oh-modal-body">
            <p className="srm-title">✓ Sent to the Production Manager for {order.order_no}.</p>
            <p className="srm-muted">You'll be notified when it's decided.</p>
          </div>
          <div className="oh-modal-footer">
            <button className="oh-modal-btn save" onClick={onClose}>OK</button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="oh-modal-overlay" onClick={(e) => e.stopPropagation()}>
      <div className="oh-modal srm-modal">
        <div className="oh-modal-header">
          <h3>Request Skip / Advance — {order.order_no}</h3>
          <button className="oh-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="oh-modal-body">
          {!loading && history.length > 0 && (
            <div className="srm-history">
              <p className="srm-title">Earlier requests for this order</p>
              {history.map((g) => (
                <div key={g.group} className="srm-hist-item">
                  <span className={`srm-status srm-status-${g.status}`}>{g.status}</span>
                  <span>{g.request_type === "skip" ? "Skip" : "Advance"} {g.rows.length} piece{g.rows.length === 1 ? "" : "s"} to <b>{getStageLabel(g.target_stage) || g.target_stage}</b></span>
                  <span className="srm-meta">{formatDate(g.requested_at)} · {g.requested_by || "—"}</span>
                  {g.status === "approved" && g.appliedCount < g.rows.length && (
                    <span className="srm-warn">{g.rows.length - g.appliedCount} not applied: {g.rows.filter((r) => !r.applied).map((r) => `${r.barcode} (${r.apply_error || "refused"})`).join(", ")}</span>
                  )}
                  {g.status === "rejected" && g.decision_note && <span className="srm-warn">Rejected: {g.decision_note}</span>}
                </div>
              ))}
            </div>
          )}

          <p className="srm-title">Pieces</p>
          {pieces.length === 0 ? (
            <p className="srm-muted">This order has no barcoded pieces yet.</p>
          ) : (
            <>
              <label className="srm-piece srm-all">
                <input type="checkbox" checked={allPicked} onChange={toggleAll} disabled={!pickable.length} />
                All pieces of this order{pickable.length < pieces.length ? ` (${pickable.length} of ${pieces.length} can be requested)` : ""}
              </label>
              {pieces.map(({ c, blocked, product }) => (
                <label key={c.id} className={`srm-piece ${blocked ? "srm-blocked" : ""}`}>
                  <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} disabled={!!blocked} />
                  <span className="srm-piece-main">
                    <b>{product || "—"}</b> · {c.component_label || PIECE_LABEL[c.component_type] || c.component_type}
                    <span className="srm-barcode">{c.barcode}</span>
                  </span>
                  <span className="srm-stage">{blocked || getComponentStageLabel(c)}</span>
                </label>
              ))}
            </>
          )}

          <div className="srm-row">
            <div className="oh-modal-field">
              <label>Request</label>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">Choose…</option>
                {REQUEST_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="oh-modal-field">
              <label>Target stage</label>
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Choose…</option>
                {TARGET_STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <div className="oh-modal-field full">
            <label>Reason *</label>
            <textarea className="oh-textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Why should these pieces move? e.g. fabric came pre-dyed" />
          </div>
        </div>
        <div className="oh-modal-footer">
          <button className="oh-modal-btn cancel" onClick={onClose}>Close</button>
          <button className="oh-modal-btn save" onClick={send} disabled={!canSend}
            title={!picked.size ? "Pick at least one piece" : !type ? "Choose Advance or Skip" : !target ? "Choose the target stage" : !reason.trim() ? "Enter a reason" : undefined}>
            {sending ? "Sending…" : "Send to Production Manager"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
