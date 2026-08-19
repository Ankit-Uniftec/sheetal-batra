import React, { useEffect, useMemo, useState } from "react";
import formatIndianNumber from "../utils/formatIndianNumber";
import { computeDeliveryCharge, COD_CHARGE, isHomeDelivery, DELIVERY_METHODS } from "../utils/deliveryCharge";
import { supabase } from "../lib/supabaseClient";
import { shipmentBalances } from "../utils/shipmentBalance";
import "./DeliveryPaymentModal.css";

const PAYMENT_MODES = ["Cash", "UPI", "Credit Card", "Debit Card", "Bank Transfer"];

// Money is summed across shipments here, so trim float noise before it reaches a
// rupee figure the SA has to match exactly.
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

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
  // Everything received so far, NOT the order-time advance. advance_payment is
  // frozen at placement; using it here would show a balance that never shrinks
  // after an interim "Update Payment" — collecting the same money twice AND
  // applying the ₹250 COD charge on a balance that is really zero (goodsBalance
  // feeds computeDeliveryCharge below). Falls back for pre-backfill rows.
  const paidSoFar = Number(order?.total_paid ?? order?.advance_payment) || 0;

  // ── Shipments (78_shipments.sql) ──────────────────────────────────────────
  // An order whose products finished at different times has several boxes, each
  // dispatched, delivered and paid for separately. Orders placed before shipments
  // existed have none — `shipments` stays empty and everything below falls back to
  // the whole-order behaviour, so nothing about the single-box case changes.
  const [shipments, setShipments] = useState([]);
  // Multi-select: several boxes are often handed over together, and forcing the SA
  // through the modal once per box would record one physical handover as two
  // separate collections.
  const [selectedIds, setSelectedIds] = useState([]);
  const [shipmentsLoading, setShipmentsLoading] = useState(true);
  const [balances, setBalances] = useState(null);
  const [balanceError, setBalanceError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!order?.id) return;
      setShipmentsLoading(true);
      try {
        const [shipRes, compRes, payRes] = await Promise.all([
          supabase.from("shipments").select("*, shipment_components(component_id)")
            .eq("order_id", order.id).order("created_at", { ascending: true }),
          supabase.from("order_components").select("id, item_index, barcode, component_label, current_stage, is_active")
            .eq("order_id", order.id),
          supabase.from("order_payments").select("amount, shipment_id").eq("order_id", order.id),
        ]);
        if (cancelled) return;

        // Shipments may not exist yet: the migration that creates them (78) can
        // legitimately trail this code, and an order-level deployment must keep
        // working without it. Supabase RETURNS errors rather than throwing, so
        // check explicitly — otherwise a missing table looks like "no shipments"
        // by accident rather than by design.
        if (shipRes.error || payRes.error) {
          setShipments([]);
          setShipmentsLoading(false);
          return;   // silent: this is the expected pre-migration state, not a fault
        }

        const ships = shipRes.data;
        const comps = compRes.data;
        const pays  = payRes.data;

        const undelivered = (ships || []).filter(
          (s) => !["delivered", "cancelled", "returned"].includes(s.status)
        );
        setShipments(undelivered);

        if (undelivered.length > 0) {
          const links = (ships || []).flatMap((s) =>
            (s.shipment_components || []).map((sc) => ({
              shipment_id: s.id, component_id: sc.component_id,
            }))
          );
          // Balances are computed over ALL shipments so the pro-rata shares of the
          // advance divide against each other and sum exactly; only undelivered
          // ones are offered for collection.
          setBalances(shipmentBalances(order, ships || [], comps || [], links, pays || []));
          // Default to the first box only. Pre-ticking everything would invite an SA
          // to collect for garments still sitting in the warehouse.
          setSelectedIds([undelivered[0].id]);
        }
      } catch (e) {
        // A broken split must not block a handover — fall back to the order-level
        // balance and say why, rather than showing a figure we cannot stand behind.
        if (!cancelled) { setShipments([]); setBalanceError(e.message || String(e)); }
      } finally {
        if (!cancelled) setShipmentsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [order]);

  const perShipment = shipments.length > 0 && balances;

  // Totals across every selected box — one handover, one amount to collect.
  const selected = useMemo(
    () => (perShipment ? selectedIds.map((id) => balances.get(id)).filter(Boolean) : []),
    [perShipment, selectedIds, balances]
  );
  const sumOf = (key) => selected.reduce((s, b) => s + (Number(b?.[key]) || 0), 0);
  const selectedTotal = sumOf("total");
  const selectedPaidShare = sumOf("advanceShare") + sumOf("unattributedShare") + sumOf("paidDirect");

  // Goods balance (before any delivery charge): the selected boxes', or the whole
  // order's when the order has no shipments (legacy, or single-box).
  const goodsBalance = perShipment
    ? Math.max(0, round2(sumOf("balance")))
    : Math.max(0, orderTotal - paidSoFar);

  const remainingAfterSelection = perShipment ? shipments.length - selected.length : 0;

  const toggleShipment = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    setError("");
  };

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
    if (perShipment && selected.length === 0) {
      setError("Select at least one shipment being handed over.");
      return;
    }
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
      // The boxes being handed over, each with the share of the collection that
      // belongs to it, so the money stays attributable per shipment. Empty = the
      // whole order (legacy orders with no shipments) — today's behaviour exactly.
      shipmentAllocations: perShipment
        ? selectedIds.map((id) => ({ id, balance: Number(balances.get(id)?.balance) || 0 }))
        : [],
      // True when nothing is left outstanding, so the caller knows the ORDER is
      // finished. The DB decides this too (recalc_order_delivery); the UI only needs
      // it for the confirmation wording.
      isLastShipment: perShipment ? remainingAfterSelection === 0 : true,
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

        {/* Which box is being handed over. Only shown when the order actually has
            more than one outstanding shipment — a single-box order must not gain a
            step it never had. */}
        {shipments.length > 1 && balances && (
          <div className="dpm-field">
            <div className="dpm-rows-header">
              <label>Which shipment(s) are being handed over?</label>
              <button
                type="button"
                className="dpm-add-btn"
                onClick={() => {
                  setSelectedIds(
                    selectedIds.length === shipments.length ? [] : shipments.map((s) => s.id)
                  );
                  setError("");
                }}
              >{selectedIds.length === shipments.length ? "Clear all" : "Select all"}</button>
            </div>
            <div className="dpm-ship-list">
              {shipments.map((s, i) => {
                const b = balances.get(s.id);
                const on = selectedIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`dpm-ship-btn ${on ? "on" : ""}`}
                    onClick={() => toggleShipment(s.id)}
                    aria-pressed={on}
                  >
                    <span className="dpm-ship-check" aria-hidden="true">{on ? "✓" : ""}</span>
                    <span className="dpm-ship-name">
                      {s.blitz_order_code || `Shipment ${i + 1}`}
                      {b?.itemIndexes?.length > 0 && (
                        <span className="dpm-ship-sub">
                          {" "}· {b.itemIndexes.map((n) => `Product ${n + 1}`).join(", ")}
                        </span>
                      )}
                    </span>
                    <span className="dpm-ship-amt">₹{formatIndianNumber(b?.balance ?? 0)}</span>
                  </button>
                );
              })}
            </div>
            <span className="dpm-method-changed">
              {remainingAfterSelection === 0
                ? "All shipments selected — the order will be marked delivered."
                : `${remainingAfterSelection} shipment${remainingAfterSelection === 1 ? "" : "s"} will stay outstanding — the order stays open until all are delivered.`}
            </span>
          </div>
        )}

        {balanceError && (
          <p className="dpm-error">
            Could not split this order per shipment ({balanceError}). Showing the whole
            order's balance instead.
          </p>
        )}

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
          {/* When collecting for one box, show how its balance was arrived at —
              an SA asked for ₹19,600 on a ₹33,000 order needs to see why. */}
          {perShipment && selected.length > 0 && (
            <>
              <div className="dpm-summary-row">
                <span>{selected.length > 1 ? `Selected Shipments (${selected.length})` : "This Shipment"}</span>
                <span>₹{formatIndianNumber(round2(selectedTotal))}</span>
              </div>
              <div className="dpm-summary-row">
                <span>Less {selected.length > 1 ? "their" : "its"} share of payments</span>
                <span>−₹{formatIndianNumber(round2(selectedPaidShare))}</span>
              </div>
            </>
          )}
          {deliveryCharge > 0 && (
            <div className="dpm-summary-row">
              <span>Delivery Charge (COD)</span>
              <span>₹{formatIndianNumber(deliveryCharge)}</span>
            </div>
          )}
          <div className="dpm-summary-row dpm-balance">
            <span>
              {perShipment
                ? (nothingToCollect ? "Shipment Balance" : "Collect for This Shipment")
                : (nothingToCollect ? "Balance" : "Balance Due")}
            </span>
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
            disabled={saving || shipmentsLoading || !exactlyMatches || (perShipment && selected.length === 0)}
          >{saving ? "Saving…" : (
            perShipment && shipments.length > 1
              ? `${nothingToCollect ? "Mark" : "Confirm &"} Deliver ${selected.length > 1 ? `${selected.length} Shipments` : "Shipment"}`
              : (nothingToCollect ? "Mark Delivered" : "Confirm & Mark Delivered")
          )}</button>
        </div>
      </div>
    </div>
  );
}
