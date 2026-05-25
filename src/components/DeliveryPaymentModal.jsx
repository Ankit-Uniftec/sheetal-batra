import React, { useMemo, useState } from "react";
import formatIndianNumber from "../utils/formatIndianNumber";
import "./DeliveryPaymentModal.css";

const PAYMENT_MODES = ["Cash", "UPI", "Credit Card", "Debit Card", "Bank Transfer"];

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function DeliveryPaymentModal({ order, onCancel, onConfirm, saving }) {
  // The MRP from grand_total is informational; the customer actually owes
  // the post-discount total. Use net_total / grand_total_after_discount when
  // present (modern orders) and fall back to grand_total for legacy rows.
  const mrp = Number(order?.grand_total) || 0;
  const orderTotal = Number(order?.net_total ?? order?.grand_total_after_discount ?? order?.grand_total ?? 0);
  const advancePaid = Number(order?.advance_payment) || 0;
  const balanceDue = Math.max(0, orderTotal - advancePaid);

  const [paidAt, setPaidAt] = useState(todayISO());
  const [rows, setRows] = useState([
    { id: 1, mode: "Cash", amount: "" },
  ]);
  const [error, setError] = useState("");

  const totalEntered = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [rows]
  );
  const leftToPay = balanceDue - totalEntered;
  const exactlyMatches = totalEntered > 0 && Math.abs(leftToPay) < 0.01;

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
    if (!exactlyMatches) { setError("Total must equal the balance due exactly."); return; }
    const validRows = rows
      .filter((r) => Number(r.amount) > 0)
      .map((r) => ({ mode: r.mode, amount: Number(r.amount) }));
    if (validRows.length === 0) { setError("Add at least one payment."); return; }
    onConfirm({ paidAt, rows: validRows });
  };

  return (
    <div className="dpm-overlay" onClick={saving ? undefined : onCancel}>
      <div className="dpm-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="dpm-title">Collect Balance & Mark Delivered</h3>
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
          {rows.map((row, idx) => (
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

        <div className={`dpm-left ${exactlyMatches ? "dpm-left-ok" : (leftToPay < 0 ? "dpm-left-over" : "")}`}>
          <span>{leftToPay >= 0 ? "Left to pay" : "Overpaid by"}</span>
          <span>₹{formatIndianNumber(Math.abs(leftToPay))}</span>
        </div>

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
            disabled={saving || !exactlyMatches}
          >{saving ? "Saving…" : "Confirm & Mark Delivered"}</button>
        </div>
      </div>
    </div>
  );
}
