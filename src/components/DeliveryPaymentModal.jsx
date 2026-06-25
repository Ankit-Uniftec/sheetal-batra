import React, { useMemo, useState } from "react";
import formatIndianNumber from "../utils/formatIndianNumber";
import { computeDeliveryCharge, COD_CHARGE, isHomeDelivery, DELIVERY_METHODS } from "../utils/deliveryCharge";
import "./DeliveryPaymentModal.css";

const PAYMENT_MODES = ["Cash", "UPI", "Credit Card", "Debit Card", "Bank Transfer"];

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Normalise the order's stored delivery method to one of the two canonical
// choices the SA confirms at delivery. Anything that isn't Home Delivery
// (store pickup, "Delhi Store", null, etc.) defaults to Store Pickup.
const normaliseMethod = (mode) =>
  isHomeDelivery(mode) ? DELIVERY_METHODS.HOME_DELIVERY : DELIVERY_METHODS.STORE_PICKUP;

export default function DeliveryPaymentModal({ order, onCancel, onConfirm, saving }) {
  // The MRP from grand_total is informational; the customer actually owes
  // the post-discount total. Use net_total / grand_total_after_discount when
  // present (modern orders) and fall back to grand_total for legacy rows.
  const mrp = Number(order?.grand_total) || 0;
  const orderTotal = Number(order?.net_total ?? order?.grand_total_after_discount ?? order?.grand_total ?? 0);
  const advancePaid = Number(order?.advance_payment) || 0;
  // Goods balance (before any delivery charge).
  const goodsBalance = Math.max(0, orderTotal - advancePaid);

  const [paidAt, setPaidAt] = useState(todayISO());
  const [rows, setRows] = useState([{ id: 1, mode: "Cash", amount: "" }]);
  const [error, setError] = useState("");

  // ── FINAL delivery method (confirmed at handover) ──
  // Pre-filled from the order's original method; the SA confirms or changes it.
  // This is what drives the COD charge — not the method chosen at order time.
  const [finalMethod, setFinalMethod] = useState(normaliseMethod(order?.mode_of_delivery));
  // SA override to waive the COD charge even when it would otherwise apply.
  const [waiveCod, setWaiveCod] = useState(false);

  // ── Delivery-address change capture ──
  const [addressChanged, setAddressChanged] = useState(false);
  const [deliveredAddress, setDeliveredAddress] = useState("");

  // COD/delivery charge, derived from the FINAL method + the goods balance.
  // Single source of truth in deliveryCharge.js. Recomputes as the SA toggles
  // method / waiver.
  const deliveryCharge = useMemo(
    () => computeDeliveryCharge({ finalMode: finalMethod, balanceDue: goodsBalance, waived: waiveCod }),
    [finalMethod, goodsBalance, waiveCod]
  );

  // Total the SA must collect at delivery = goods balance + delivery charge.
  const balanceDue = goodsBalance + deliveryCharge;

  const totalEntered = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [rows]
  );
  const leftToPay = balanceDue - totalEntered;
  // Nothing to collect (prepaid + no/ waived charge) — payment rows optional.
  const nothingToCollect = balanceDue <= 0;
  const exactlyMatches = nothingToCollect || (totalEntered > 0 && Math.abs(leftToPay) < 0.01);

  // Whether the COD charge COULD apply for this final method (Home Delivery
  // with a balance) — used to show the waive checkbox only when relevant.
  const codCouldApply = isHomeDelivery(finalMethod) && goodsBalance > 0;

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
    if (addressChanged && !deliveredAddress.trim()) {
      setError("Please enter the changed delivery address.");
      return;
    }

    // When there's money to collect, validate the payment rows + date.
    let validRows = [];
    if (!nothingToCollect) {
      if (!paidAt) { setError("Please pick a collection date."); return; }
      if (!exactlyMatches) { setError("Total must equal the amount due exactly."); return; }
      validRows = rows
        .filter((r) => Number(r.amount) > 0)
        .map((r) => ({ mode: r.mode, amount: Number(r.amount) }));
      if (validRows.length === 0) { setError("Add at least one payment."); return; }
    }

    onConfirm({
      paidAt: nothingToCollect ? null : paidAt,
      rows: validRows,
      deliveredAddress: addressChanged ? deliveredAddress.trim() : null,
      finalMethod,
      deliveryCharge,
      codWaived: waiveCod,
    });
  };

  return (
    <div className="dpm-overlay" onClick={saving ? undefined : onCancel}>
      <div className="dpm-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="dpm-title">Order Delivered</h3>
        <p className="dpm-sub">Order {order?.order_no || ""} · {order?.delivery_name || ""}</p>

        {/* ── Delivery method (confirm / change at handover) ── */}
        <div className="dpm-field">
          <label>Delivery method</label>
          <div className="dpm-addr-toggle">
            <button
              type="button"
              className={`dpm-toggle-btn ${finalMethod === DELIVERY_METHODS.STORE_PICKUP ? "on" : ""}`}
              onClick={() => { setFinalMethod(DELIVERY_METHODS.STORE_PICKUP); setError(""); }}
            >Store Pickup</button>
            <button
              type="button"
              className={`dpm-toggle-btn ${finalMethod === DELIVERY_METHODS.HOME_DELIVERY ? "on" : ""}`}
              onClick={() => { setFinalMethod(DELIVERY_METHODS.HOME_DELIVERY); setError(""); }}
            >Home Delivery</button>
          </div>
          {normaliseMethod(order?.mode_of_delivery) !== finalMethod && (
            <span className="dpm-method-changed">
              Changed from {normaliseMethod(order?.mode_of_delivery)}
            </span>
          )}
        </div>

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
          {deliveryCharge > 0 && (
            <div className="dpm-summary-row">
              <span>Delivery Charge (COD)</span>
              <span>₹{formatIndianNumber(deliveryCharge)}</span>
            </div>
          )}
          <div className="dpm-summary-row dpm-balance">
            <span>{nothingToCollect ? "Balance" : "Balance Due"}</span>
            <span>₹{formatIndianNumber(balanceDue)}</span>
          </div>
        </div>

        {/* COD waive — only meaningful when the charge could apply. */}
        {codCouldApply && (
          <label className="dpm-waive-row">
            <input
              type="checkbox"
              checked={waiveCod}
              onChange={(e) => { setWaiveCod(e.target.checked); setError(""); }}
            />
            <span>Waive ₹{formatIndianNumber(COD_CHARGE)} COD charge</span>
          </label>
        )}

        {nothingToCollect ? (
          <p className="dpm-nothing">Nothing to collect — fully paid.</p>
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

            <div className={`dpm-left ${exactlyMatches ? "dpm-left-ok" : (leftToPay < 0 ? "dpm-left-over" : "")}`}>
              <span>{leftToPay >= 0 ? "Left to pay" : "Overpaid by"}</span>
              <span>₹{formatIndianNumber(Math.abs(leftToPay))}</span>
            </div>
          </>
        )}

        {/* ── Delivery-address change ── */}
        <div className="dpm-field">
          <label>Change in delivery address?</label>
          <div className="dpm-addr-toggle">
            <button
              type="button"
              className={`dpm-toggle-btn ${!addressChanged ? "on" : ""}`}
              onClick={() => { setAddressChanged(false); setError(""); }}
            >No</button>
            <button
              type="button"
              className={`dpm-toggle-btn ${addressChanged ? "on" : ""}`}
              onClick={() => { setAddressChanged(true); setError(""); }}
            >Yes</button>
          </div>
          {addressChanged && (
            <textarea
              className="dpm-addr-input"
              rows={3}
              placeholder="Enter the address the order was actually delivered to…"
              value={deliveredAddress}
              onChange={(e) => { setDeliveredAddress(e.target.value); setError(""); }}
            />
          )}
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
          >{saving ? "Saving…" : (nothingToCollect ? "Mark Delivered" : "Confirm & Mark Delivered")}</button>
        </div>
      </div>
    </div>
  );
}
