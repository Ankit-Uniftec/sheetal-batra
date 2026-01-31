import React, { useState } from "react";
import formatIndianNumber from "../utils/formatIndianNumber";
import "./SplitPaymentModal.css"; // Optional - if you want separate CSS
import { usePopup } from "../components/Popup";

const paymentModes = [
  { label: "UPI", value: "UPI" },
  { label: "Cash", value: "Cash" },
  { label: "Credit Card", value: "Credit Card" },
  { label: "Debit Card", value: "Debit Card" },
  { label: "Net Banking", value: "Net Banking" },
];

export default function SplitPaymentModal({ isOpen, onClose, onSave, maxAmount }) {
  const { showPopup, PopupComponent } = usePopup();
  const [payments, setPayments] = useState([{ mode: "UPI", amount: "" }]);

  const addPaymentRow = () => {
    setPayments([...payments, { mode: "UPI", amount: "" }]);
  };

  const removePaymentRow = (index) => {
    if (payments.length > 1) {
      setPayments(payments.filter((_, i) => i !== index));
    }
  };

  const updatePayment = (index, field, value) => {
    const updated = [...payments];
    updated[index][field] = value;
    setPayments(updated);
  };

  const totalSplitAmount = payments.reduce(
    (sum, p) => sum + (parseFloat(p.amount) || 0),
    0
  );

  const handleSave = () => {
    const validPayments = payments.filter(
      (p) => p.mode && parseFloat(p.amount) > 0
    );

    if (validPayments.length < 2) {
      showPopup({
        title: "Payment methods",
        message: "Please add at least 2 payment methods with valid amounts for split payment.",
        type: "warning",
        confirmText: "Ok",
      })
      // alert("Please add at least 2 payment methods with valid amounts for split payment.");
      return;
    }

    if (totalSplitAmount > maxAmount) {
      alert(`Total split amount (₹${totalSplitAmount}) cannot exceed net payable (₹${maxAmount})`);
      return;
    }

    onSave(validPayments, totalSplitAmount);
    handleClose();
  };

  const handleClose = () => {
    setPayments([{ mode: "UPI", amount: "" }]);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="split-modal-overlay">
      {/* Popup Component */}
      {PopupComponent}
      <div className="split-modal">
        <div className="split-modal-header">
          <h3>Split Payment</h3>
          <button onClick={handleClose} className="split-modal-close">×</button>
        </div>

        <div className="split-modal-max-amount">
          <span>Max Amount: <strong>₹{formatIndianNumber(maxAmount)}</strong></span>
        </div>

        {payments.map((payment, index) => (
          <div key={index} className="split-payment-row">
            <select
              value={payment.mode}
              onChange={(e) => updatePayment(index, "mode", e.target.value)}
              className="split-payment-select"
            >
              {paymentModes.map((pm) => (
                <option key={pm.value} value={pm.value}>{pm.label}</option>
              ))}
            </select>
            <input
              type="number"
              placeholder="Amount"
              value={payment.amount}
              onChange={(e) => updatePayment(index, "amount", e.target.value)}
              className="split-payment-input"
            />
            {payments.length > 1 && (
              <button
                onClick={() => removePaymentRow(index)}
                className="split-payment-remove"
              >×</button>
            )}
          </div>
        ))}

        <button onClick={addPaymentRow} className="split-add-btn">
          + Add Payment Method
        </button>

        <div className={`split-total ${totalSplitAmount > maxAmount ? "error" : "success"}`}>
          <span>Total:</span>
          <strong>₹{formatIndianNumber(totalSplitAmount)}</strong>
        </div>

        <div className="split-modal-actions">
          <button onClick={handleClose} className="split-cancel-btn">Cancel</button>
          <button onClick={handleSave} className="split-save-btn">Save Split Payment</button>
        </div>
      </div>
    </div>
  );
}