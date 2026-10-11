import React, { useMemo, useState } from "react";
import formatIndianNumber from "../utils/formatIndianNumber";
import { PROOF_ACCEPT, isCashMode, isWebsiteOrder, validateProofFile } from "../utils/paymentProofs";
import "./DeliveryPaymentModal.css";
import "./PaymentProofModal.css";

// Standalone "Update Payment" — record a payment against an order's balance at
// any time (not tied to delivery). Unlike the delivery flow it does NOT touch
// the delivery method, address, COD charge, or order status. It simply records
// the collected amount(s) and the new outstanding balance.
//
// Partial payments are allowed: the SA may collect part of the balance now and
// the rest later (or at delivery). Over-collection is blocked.
//
// Each non-cash row can carry an optional proof of payment — a screenshot or
// PDF (meeting point 26). It is handed to onConfirm as row.proofFile and
// uploaded by utils/recordPayment after the payment is saved, linked to that
// row. Cash rows and website (Shopify) orders get no picker.

const PAYMENT_MODES = ["Cash", "UPI", "Credit Card", "Debit Card", "Bank Transfer"];

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function UpdatePaymentModal({ order, onCancel, onConfirm, saving }) {
  const mrp = Number(order?.grand_total) || 0;
  const orderTotal = Number(order?.net_total ?? order?.grand_total_after_discount ?? order?.grand_total ?? 0);
  const advancePaid = Number(order?.advance_payment) || 0;
  // Everything received so far, NOT the order-time advance. advance_payment is
  // frozen at placement, so using it here would leave balanceDue permanently at
  // its original value and let the same money be collected again — the
  // over-collection guard below reads this same figure and would not catch it.
  // Falls back to advance_payment for rows predating the total_paid backfill.
  const paidSoFar = Number(order?.total_paid ?? order?.advance_payment) || 0;
  const balanceDue = Math.max(0, orderTotal - paidSoFar);

  const [paidAt, setPaidAt] = useState(todayISO());
  const [rows, setRows] = useState([{ id: 1, mode: "Cash", amount: "" }]);
  const [error, setError] = useState("");
  const proofAllowed = !isWebsiteOrder(order);

  // Keep a picked file only if it passes the rules (type / 5 MB); otherwise
  // show why on that row and keep nothing.
  const pickProof = (id, file) => {
    if (!file) return;
    const problem = validateProofFile(file);
    updateRow(id, problem ? { proofFile: null, proofError: problem } : { proofFile: file, proofError: "" });
  };

  const totalEntered = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [rows]
  );
  const remainingAfter = balanceDue - totalEntered;
  const overpaying = totalEntered > balanceDue + 0.01;
  const validToSubmit = totalEntered > 0 && !overpaying;

  const updateRow = (id, patch) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setError("");
  };

  const addRow = () => {
    if (rows.length >= PAYMENT_MODES.length) return;
    const usedModes = new Set(rows.map((r) => r.mode));
    const nextMode = PAYMENT_MODES.find((m) => !usedModes.has(m)) || PAYMENT_MODES[0];
    setRows((prev) => [...prev, { id: Date.now(), mode: nextMode, amount: "" }]);
  };

  const removeRow = (id) => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const handleConfirm = () => {
    if (!paidAt) { setError("Please pick a collection date."); return; }
    if (overpaying) { setError("Amount can't exceed the balance due."); return; }
    const validRows = rows
      .filter((r) => Number(r.amount) > 0)
      .map((r) => ({
        mode: r.mode,
        amount: Number(r.amount),
        // A file picked before the row was switched to Cash is dropped here.
        ...(proofAllowed && r.proofFile && !isCashMode(r.mode) ? { proofFile: r.proofFile } : {}),
      }));
    if (validRows.length === 0) { setError("Enter at least one payment amount."); return; }
    onConfirm({ paidAt, rows: validRows });
  };

  return (
    <div className="dpm-overlay" onClick={saving ? undefined : onCancel}>
      <div className="dpm-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="dpm-title">Update Payment</h3>
        <p className="dpm-sub">Order {order?.order_no || ""} · {order?.delivery_name || ""}</p>

        <div className="dpm-summary">
          {mrp !== orderTotal && mrp > 0 && (
            <div className="dpm-summary-row">
              <span>MRP</span>
              <span>₹{formatIndianNumber(mrp)}</span>
            </div>
          )}
          <div className="dpm-summary-row">
            <span>Order Total</span>
            <span>₹{formatIndianNumber(orderTotal)}</span>
          </div>
          {/* Label follows the figure: once anything beyond the original
              advance has come in, "Advance Paid" would be a lie. */}
          <div className="dpm-summary-row">
            <span>{paidSoFar > advancePaid ? "Paid So Far" : "Advance Paid"}</span>
            <span>₹{formatIndianNumber(paidSoFar)}</span>
          </div>
          <div className="dpm-summary-row dpm-balance">
            <span>Balance Due</span>
            <span>₹{formatIndianNumber(balanceDue)}</span>
          </div>
        </div>

        {balanceDue <= 0 ? (
          <p className="dpm-nothing">This order is fully paid — nothing to collect.</p>
        ) : (
          <>
            <div className="dpm-field">
              <label>Collection Date</label>
              <input
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
                max={todayISO()}
              />
            </div>

            <div className="dpm-rows-header">
              <label>Payment(s) Received</label>
              <button
                type="button"
                className="dpm-add-btn"
                onClick={addRow}
                disabled={rows.length >= PAYMENT_MODES.length}
              >+ Add another mode</button>
            </div>

            <div className="dpm-rows">
              {rows.map((row) => (
                <React.Fragment key={row.id}>
                <div className="dpm-row">
                  <select
                    value={row.mode}
                    onChange={(e) => updateRow(row.id, { mode: e.target.value })}
                  >
                    {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <div className="dpm-amount-wrap">
                    <span className="dpm-rupee">₹</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="0"
                      value={row.amount}
                      onChange={(e) => updateRow(row.id, { amount: e.target.value })}
                    />
                  </div>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      className="dpm-remove-btn"
                      onClick={() => removeRow(row.id)}
                      aria-label="Remove payment row"
                    >×</button>
                  )}
                  {rows.length === 1 && <span className="dpm-remove-placeholder" />}
                </div>
                {proofAllowed && !isCashMode(row.mode) && (
                  <div className="dpm-proof">
                    {row.proofFile ? (
                      <>
                        <span className="dpm-proof-name" title={row.proofFile.name}>📎 {row.proofFile.name}</span>
                        <button
                          type="button"
                          className="dpm-proof-remove"
                          onClick={() => updateRow(row.id, { proofFile: null, proofError: "" })}
                          disabled={saving}
                          aria-label="Remove proof"
                        >×</button>
                      </>
                    ) : (
                      <label className="dpm-proof-pick">
                        📎 Attach proof <span className="dpm-proof-opt">(optional · JPEG, PNG or PDF · 5 MB)</span>
                        <input
                          type="file"
                          accept={PROOF_ACCEPT}
                          hidden
                          disabled={saving}
                          onChange={(e) => { pickProof(row.id, e.target.files?.[0]); e.target.value = ""; }}
                        />
                      </label>
                    )}
                    {row.proofError && <span className="dpm-proof-error">{row.proofError}</span>}
                  </div>
                )}
                </React.Fragment>
              ))}
            </div>

            <div className={`dpm-left ${overpaying ? "dpm-left-over" : (Math.abs(remainingAfter) < 0.01 ? "dpm-left-ok" : "")}`}>
              <span>{overpaying ? "Over by" : "Balance after"}</span>
              <span>₹{formatIndianNumber(Math.abs(remainingAfter))}</span>
            </div>
          </>
        )}

        {error && <p className="dpm-error">{error}</p>}

        <div className="dpm-actions">
          <button
            type="button"
            className="dpm-btn dpm-btn-secondary"
            onClick={onCancel}
            disabled={saving}
          >Cancel</button>
          <button
            type="button"
            className="dpm-btn dpm-btn-primary"
            onClick={handleConfirm}
            disabled={saving || balanceDue <= 0 || !validToSubmit}
          >{saving ? "Saving…" : "Record Payment"}</button>
        </div>
      </div>
    </div>
  );
}
