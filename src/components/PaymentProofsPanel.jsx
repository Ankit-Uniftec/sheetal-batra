import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import formatDate from "../utils/formatDate";
import formatIndianNumber from "../utils/formatIndianNumber";
import { canAttachPaymentProof, isCashMode, isWebsiteOrder, listPaymentProofs, proofPaymentLabel, proofSignedUrl } from "../utils/paymentProofs";
import PaymentProofModal from "./PaymentProofModal";
import "./PaymentProofModal.css";

/**
 * "Payment Proofs" card on the order details page (meeting point 26) — the
 * proofs uploaded for this order, each with a View link (a proof attached in
 * Update Payment also names the payment it proves), plus "Add proof" for the
 * ADVANCE (never a ledger row, so it can't be proved in Update Payment) or for
 * a proof forgotten at payment time. Offered when the order has a non-cash
 * payment; never on a website (Shopify) order. Rendered for staff only (the caller
 * shows it in the associate flow, never on the customer's own order page).
 *
 * @param {object}   order
 * @param {function} showPopup
 * @param {string}  [uploadedBy]
 * @param {string}  [className]   the page's card class, so it sits like its siblings
 */
export default function PaymentProofsPanel({ order, showPopup, uploadedBy, className = "" }) {
  const [proofs, setProofs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [laterNonCash, setLaterNonCash] = useState(false);
  const [paymentsById, setPaymentsById] = useState({});
  const [modalOpen, setModalOpen] = useState(false);
  const [opening, setOpening] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [list, pays] = await Promise.all([
        listPaymentProofs(order.id),
        supabase.from("order_payments").select("id, payment_mode, amount, paid_at").eq("order_id", order.id),
      ]);
      setProofs(list);
      setLaterNonCash((pays.data || []).some((p) => p.payment_mode && !isCashMode(p.payment_mode)));
      setPaymentsById(Object.fromEntries((pays.data || []).map((p) => [p.id, p])));
    } catch (err) {
      console.error("Payment proofs load failed:", err);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [order.id]);

  useEffect(() => { load(); }, [load]);

  const canAdd = canAttachPaymentProof(order, laterNonCash);
  const paymentLabel = (p) => {
    const pay = paymentsById[p.payment_id];
    // A linked payment row first; otherwise the mode + amount stored with the
    // proof itself (advance proofs, Release 12).
    return pay ? `${pay.payment_mode} ₹${formatIndianNumber(pay.amount)}${pay.paid_at ? ` · ${formatDate(pay.paid_at)}` : ""}` : proofPaymentLabel(p);
  };

  const openProof = async (p) => {
    setOpening(p.id);
    try {
      window.open(await proofSignedUrl(p.file_path), "_blank", "noopener");
    } catch (err) {
      showPopup({ type: "error", title: "Can't open file", message: err.message || "Please try again.", confirmText: "OK" });
    } finally {
      setOpening(null);
    }
  };

  // Website orders never carry proofs. Otherwise, with nothing to show and
  // nothing to add (a cash-only order), the card would only say "not
  // applicable", so leave it out.
  if (isWebsiteOrder(order)) return null;
  if (!loading && !failed && !proofs.length && !canAdd) return null;

  return (
    <div className={className}>
      <h3>Payment Proofs</h3>
      {loading ? (
        <p className="ppm-muted">Loading…</p>
      ) : failed ? (
        <p className="ppm-error">Could not load the payment proofs.</p>
      ) : proofs.length === 0 ? (
        <p className="ppm-muted">No payment proofs yet.</p>
      ) : (
        <ul className="ppm-list">
          {proofs.map((p) => (
            <li key={p.id} className="ppm-item">
              <span className={`ppm-tag ppm-tag-${p.checkpoint}`}>{p.checkpoint === "advance" ? "Advance" : "Balance"}</span>
              <span className="ppm-name" title={p.file_name}>{p.file_name || "file"}</span>
              {paymentLabel(p) && <span className="ppm-pay">{paymentLabel(p)}</span>}
              <span className="ppm-meta">{formatDate(p.created_at)}{p.uploaded_by ? ` · ${p.uploaded_by}` : ""}</span>
              <button className="ppm-view" onClick={() => openProof(p)} disabled={opening === p.id}>
                {opening === p.id ? "…" : "View"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <button className="ppm-view" style={{ marginTop: 12 }} onClick={() => setModalOpen(true)}>
          + Add proof
        </button>
      )}
      {modalOpen && (
        <PaymentProofModal
          order={order}
          showPopup={showPopup}
          uploadedBy={uploadedBy}
          onClose={() => { setModalOpen(false); load(); }}
        />
      )}
    </div>
  );
}
