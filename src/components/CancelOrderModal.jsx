import React, { useState } from "react";
import { cancelOrder } from "../utils/cancelOrder";
import "../screens/OrderHistory.css";

/**
 * Reason box + confirm for a card-level "Cancel Order". The cancellation itself
 * (status, components off the floor, inventory, notify production) is
 * utils/cancelOrder — this is only the UI in front of it.
 *
 * @param {object}   order
 * @param {function} onClose
 * @param {function} onCancelled   (order, reason) => void — update the caller's list
 * @param {function} showPopup     the caller's usePopup().showPopup
 * @param {object}  [opts]         passed through to cancelOrder (cancelledBy, email)
 */
export default function CancelOrderModal({ order, onClose, onCancelled, showPopup, opts = {} }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const { cancelledComponents } = await cancelOrder(order, trimmed, opts);
      onCancelled?.(order, trimmed);
      onClose();
      showPopup({
        type: "success",
        title: "Order Cancelled",
        message: `Order ${order.order_no} has been cancelled.`
          + (cancelledComponents ? ` ${cancelledComponents} piece(s) pulled out of production.` : ""),
        confirmText: "OK",
      });
    } catch (err) {
      showPopup({ type: "error", title: "Error", message: "Failed to cancel: " + (err.message || "Unknown error"), confirmText: "OK" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="oh-modal-overlay">
      <div className="oh-modal">
        <div className="oh-modal-header">
          <h3>Cancel Order {order.order_no}</h3>
          <button className="oh-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="oh-modal-body">
          <div className="oh-modal-field full">
            <label>Reason for cancellation *</label>
            <textarea
              className="oh-textarea"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why is this order being cancelled?"
            />
          </div>
        </div>
        <div className="oh-modal-footer">
          <button className="oh-modal-btn cancel" onClick={onClose}>Back</button>
          <button className="oh-modal-btn save" onClick={handleConfirm} disabled={saving || !reason.trim()}>
            {saving ? "Cancelling..." : "Confirm Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
