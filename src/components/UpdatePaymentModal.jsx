import React, { useMemo, useState } from "react";
import formatIndianNumber from "../utils/formatIndianNumber";
import "./DeliveryPaymentModal.css";

// Standalone "Update Payment" — record a payment against an order's balance at
// any time (not tied to delivery). Unlike the delivery flow it does NOT touch
// the delivery method, address, COD charge, or order status. It simply records
// the collected amount(s) and the new outstanding balance.
//
// Partial payments are allowed: the SA may collect part of the balance now and
// the rest later (or at delivery). Over-collection is blocked.

const PAYMENT_MODES = ["Cash", "UPI", "Credit Card", "Debit Card", "Bank Transfer"];

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function UpdatePaymentModal({ order, onCancel, onConfirm, saving }) {
  const mrp = Number(order?.grand_total) || 0;
  const orderTotal = Number(order?.net_total ?? order?.grand_total_after_discount ?? order?.grand_total ?? 0);
  const advancePaid = Number(order?.advance_payment) || 0;
  const balanceDue = Math.max(0, orderTotal - advancePaid);

  const [paidAt, setPaidAt] = useState(todayISO());
  const [rows, setRows] = useState([{ id: 1, mode: "Cash", amount: "" }]);
  const [error, setError] = useState("");

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
      .map((r) => ({ mode: r.mode, amount: Number(r.amount) }));
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
          <div className="dpm-summary-row">
            <span>Advance Paid</span>
            <span>₹{formatIndianNumber(advancePaid)}</span>
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
                <div key={row.id} className="dpm-row">
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
