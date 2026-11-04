import React, { useState } from "react";
import formatIndianNumber from "../utils/formatIndianNumber";
import { proofSummary, proofSignedUrl, proofPaymentLabel } from "../utils/paymentProofs";

// The money and proof line on an SA order card (point #6): what the order is
// worth, what is paid, and how much of it has a payment proof behind it.

const money = (n) => `₹${formatIndianNumber(Math.round(n || 0))}`;

export default function OrderProofLine({ order, proofs, payments, showPopup }) {
  const [open, setOpen] = useState(false);
  const s = proofSummary(order, proofs, payments);
  if (!s) return null;

  const stop = (e) => e.stopPropagation();
  const view = async (proof) => {
    const tab = window.open("", "_blank");
    try {
      const url = await proofSignedUrl(proof.file_path);
      if (tab) tab.location = url;
      else window.location.assign(url);
    } catch (err) {
      if (tab) tab.close();
      showPopup?.({ type: "error", title: "Could not open proof", message: err.message, confirmText: "OK" });
    }
  };

  return (
    <div onClick={stop} style={{ marginTop: 8, padding: "8px 10px", background: "#faf7ef", borderRadius: 6, fontSize: 13 }}>
      <div>
        <strong>Total</strong> {money(s.total)} · <strong>Paid</strong> {money(s.paid)} · <strong>Balance</strong> {money(s.balance)}
      </div>
      <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span>
          <strong>Proof:</strong> {s.count} attached ({money(s.attached)})
          {s.pending > 0
            ? <span style={{ color: "#c62828", fontWeight: 600 }}> · {money(s.pending)} pending</span>
            : <span style={{ color: "#2e7d32", fontWeight: 600 }}> · complete</span>}
          {s.noProofNeeded > 0 && <span style={{ color: "#666" }}> · {money(s.noProofNeeded)} cash or legacy, no proof needed</span>}
        </span>
        {s.count === 1 && <button type="button" className="ad-print-pdf-btn" onClick={() => view(proofs[0])}>View proof</button>}
        {s.count > 1 && <button type="button" className="ad-print-pdf-btn" onClick={() => setOpen(!open)}>{open ? "Hide proofs" : "View proofs"}</button>}
      </div>
      {open && s.count > 1 && (
        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {proofs.map((p) => (
            <button key={p.id} type="button" className="ad-print-pdf-btn" onClick={() => view(p)}>
              {proofPaymentLabel(p) || p.file_name || "Proof"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
