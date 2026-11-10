import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabaseClient";
import { canUpdateB2bPayment, b2bPaymentState, recordPayment } from "../../utils/recordPayment";
import { PROOF_ACCEPT, validateProofFile } from "../../utils/paymentProofs";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";

// ============================================================
// Money received from a B2B partner (Release 33, client point 4).
//
// The merchandiser ticks the partner's orders the money is for and the amount
// for each (client decision: she picks the orders). Each ticked order gets an
// order_payments row via recordPayment — the same write as the per-order
// "Update Payment" button — so total_paid / the balance update on every
// dashboard through the existing trigger.
// The partner's used credit only ever went UP for approved Buyout orders, so
// the Buyout part of the money brings it back down.
// Consignment is shown on its own line and is not part of the outstanding
// (client decision: paid when the piece sells).
// ============================================================

// Same modes as the per-order Update Payment window (UpdatePaymentModal).
const PAYMENT_MODES = ["Bank Transfer", "UPI", "Cash", "Credit Card", "Debit Card"];
const rupees = (n) => `₹${formatIndianNumber(Math.round(Number(n) || 0))}`;
const isConsignment = (o) => String(o.b2b_order_type || "").toLowerCase() === "consignment";
const today = () => new Date().toISOString().slice(0, 10);

export default function VendorPaymentModal({ vendor, orders, userEmail, onClose, onRecorded, showPopup }) {
  const mine = useMemo(() => (orders || []).filter((o) => o.vendor_id === vendor.id && canUpdateB2bPayment(o)), [orders, vendor.id]);
  const owing = useMemo(() => mine.filter((o) => !isConsignment(o)).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)), [mine]);
  const consignment = useMemo(() => mine.filter(isConsignment), [mine]);
  const outstanding = owing.reduce((s, o) => s + b2bPaymentState(o).balance, 0);
  const consignmentDue = consignment.reduce((s, o) => s + b2bPaymentState(o).balance, 0);

  const [picked, setPicked] = useState({}); // order id → amount text
  const [mode, setMode] = useState(PAYMENT_MODES[0]);
  const [paidOn, setPaidOn] = useState(today());
  const [proof, setProof] = useState(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState(null);

  useEffect(() => {
    let off = false;
    (async () => {
      const ids = (orders || []).filter((o) => o.vendor_id === vendor.id).map((o) => o.id);
      if (!ids.length) { setHistory([]); return; }
      const { data } = await supabase.from("order_payments")
        .select("id, order_id, amount, payment_mode, paid_at, recorded_by, kind")
        .in("order_id", ids.slice(0, 300)).eq("kind", "balance")
        .order("paid_at", { ascending: false }).limit(15);
      if (!off) setHistory(data || []);
    })();
    return () => { off = true; };
  }, [orders, vendor.id]);

  const orderNo = (id) => (orders || []).find((o) => o.id === id)?.order_no || "";
  const total = Object.values(picked).reduce((s, v) => s + (Number(v) || 0), 0);
  const toggle = (o) => setPicked((p) => {
    const n = { ...p };
    if (o.id in n) delete n[o.id]; else n[o.id] = String(Math.round(b2bPaymentState(o).balance));
    return n;
  });

  const problem = (() => {
    if (!Object.keys(picked).length) return "Tick at least one order.";
    for (const o of owing) {
      if (!(o.id in picked)) continue;
      const a = Number(picked[o.id]);
      if (!(a > 0)) return `Enter an amount for ${o.order_no}.`;
      if (a > b2bPaymentState(o).balance + 0.5) return `${o.order_no} owes only ${rupees(b2bPaymentState(o).balance)}.`;
    }
    if (!paidOn) return "Pick the date the money was received.";
    if (paidOn > today()) return "The date can't be in the future.";
    return null;
  })();

  const save = async () => {
    if (problem || saving) return;
    setSaving(true);
    const done = []; const failed = []; const fresh = [];
    let buyoutPaid = 0;
    for (const o of owing) {
      if (!(o.id in picked)) continue;
      const amount = Number(picked[o.id]);
      try {
        const r = await recordPayment(o, { paidAt: new Date(`${paidOn}T12:00:00`).toISOString(), rows: [{ mode, amount, proofFile: proof || undefined }] }, userEmail);
        done.push(`${o.order_no}: ${rupees(amount)}`);
        if (r.fresh) fresh.push(r.fresh);
        if (o.b2b_order_type === "Buyout") buyoutPaid += amount;
      } catch (err) {
        failed.push(`${o.order_no}: ${err?.message || err}`);
      }
    }
    let creditNote = "";
    if (buyoutPaid > 0) {
      const { data: v, error: rErr } = await supabase.from("vendors").select("current_credit_used").eq("id", vendor.id).single();
      const next = Math.max(0, Number(v?.current_credit_used || 0) - buyoutPaid);
      const { error: uErr } = rErr ? { error: rErr } : await supabase.from("vendors").update({ current_credit_used: next }).eq("id", vendor.id);
      creditNote = uErr ? ` Credit used could NOT be lowered (${uErr.message}).` : ` Credit used lowered by ${rupees(buyoutPaid)}.`;
      if (!uErr) onRecorded({ fresh, vendorPatch: { id: vendor.id, current_credit_used: next } });
      else onRecorded({ fresh });
    } else {
      onRecorded({ fresh });
    }
    setSaving(false);
    showPopup({
      title: failed.length ? (done.length ? "Payment partly recorded" : "Payment not recorded") : "Payment recorded",
      type: failed.length ? (done.length ? "warning" : "error") : "success",
      message: [
        done.length ? `Recorded for ${vendor.store_brand_name}: ${done.join(", ")}.${creditNote}` : "",
        failed.length ? `Not recorded: ${failed.join("; ")}` : "",
      ].filter(Boolean).join("\n\n"),
    });
    if (!failed.length) onClose();
  };

  return createPortal(
    <div className="merch-pay-overlay" onClick={onClose}>
      <div className="merch-pay-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Record payment">
        <div className="merch-pay-head">
          <div>
            <h3>Record payment {"·"} {vendor.store_brand_name}</h3>
            <p>Outstanding <b>{rupees(outstanding)}</b> on {owing.length} order{owing.length === 1 ? "" : "s"}
              {consignment.length ? <> {"·"} Consignment (paid when sold) {rupees(consignmentDue)} on {consignment.length}</> : null}</p>
          </div>
          <button className="merch-pay-x" onClick={onClose} aria-label="Close">{"×"}</button>
        </div>

        <div className="merch-pay-body">
          <h4>1. Tick the orders this money is for</h4>
          {owing.length === 0 ? <p className="merch-an-empty">Nothing outstanding for this partner.</p> : (
            <div className="merch-pay-list">
              {owing.map((o) => {
                const s = b2bPaymentState(o);
                const on = o.id in picked;
                return (
                  <label key={o.id} className={`merch-pay-row ${on ? "is-on" : ""}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(o)} />
                    <span className="merch-pay-ord"><b>{o.order_no}</b><em>{o.b2b_order_type || "—"} {"·"} {formatDate(o.created_at)}</em></span>
                    <span className="merch-pay-num">Total {rupees(s.total)}<em>Paid {rupees(s.received)}</em></span>
                    <span className="merch-pay-num merch-pay-owes"><b>Owes {rupees(s.balance)}</b></span>
                    <input className="merch-pay-amt" inputMode="numeric" disabled={!on} value={on ? picked[o.id] : ""} placeholder="Amount"
                      onClick={(e) => e.preventDefault()}
                      onChange={(e) => setPicked((p) => ({ ...p, [o.id]: e.target.value.replace(/[^\d.]/g, "") }))}
                      aria-label={`Amount for ${o.order_no}`} />
                  </label>
                );
              })}
            </div>
          )}

          <h4>2. How and when it was received</h4>
          <div className="merch-pay-form">
            <label>Mode
              <select value={mode} onChange={(e) => setMode(e.target.value)}>{PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}</select>
            </label>
            <label>Received on
              <input type="date" value={paidOn} max={today()} onChange={(e) => setPaidOn(e.target.value)} />
            </label>
            <label>Proof (optional)
              <input type="file" accept={PROOF_ACCEPT} onChange={(e) => {
                const f = e.target.files?.[0] || null;
                const err = f ? validateProofFile(f) : null;
                if (err) { showPopup({ title: "File not accepted", message: err, type: "warning" }); e.target.value = ""; setProof(null); return; }
                setProof(f);
              }} />
            </label>
          </div>
        </div>

        <div className="merch-pay-foot">
          <span className={problem ? "merch-pay-warn" : ""}>{problem || `Recording ${rupees(total)} on ${Object.keys(picked).length} order(s).`}</span>
          <button className="merch-pay-cancel" onClick={onClose}>Cancel</button>
          <button className="merch-pay-save" disabled={!!problem || saving} onClick={save}>{saving ? "Saving…" : `Record ${rupees(total)}`}</button>
        </div>

        <div className="merch-pay-hist">
          <h4>Recent payments from this partner</h4>
          {history === null ? <p className="merch-an-empty">Loading…</p> : history.length === 0 ? <p className="merch-an-empty">None recorded yet.</p> : (
            history.map((h) => (
              <div key={h.id} className="merch-pay-hrow">
                <span>{formatDate(h.paid_at)}</span><span>{orderNo(h.order_id)}</span><span>{h.payment_mode}</span><b>{rupees(h.amount)}</b>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
