import React, { useState, useMemo } from "react";
import formatIndianNumber from "../utils/formatIndianNumber";
import "./SplitPaymentModal.css";
import { usePopup } from "../components/Popup";

const paymentModes = [
  { label: "UPI", value: "UPI" },
  { label: "Cash", value: "Cash" },
  { label: "Credit Card", value: "Credit Card" },
  { label: "Debit Card", value: "Debit Card" },
  { label: "Net Banking", value: "Net Banking" },
];

export default function SplitPaymentModal({ isOpen, onClose, onSave, maxAmount, minAdvance = 0 }) {
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

  // Total amount entered by SA (this becomes the advance payment)
  const totalEntered = useMemo(() => {
    return payments.reduce(
      (sum, p) => sum + (parseFloat(p.amount) || 0),
      0
    );
  }, [payments]);

  // Balance = Net Payable - Entered (what customer will pay later)
  const balance = useMemo(() => {
    return maxAmount - totalEntered;
  }, [maxAmount, totalEntered]);

  // Status check
  const isExceeded = totalEntered > maxAmount;
  const isBelowMin = totalEntered > 0 && totalEntered < minAdvance;

  const handleSave = () => {
    const validPayments = payments.filter(
      (p) => p.mode && parseFloat(p.amount) > 0
    );

    if (validPayments.length < 2) {
      showPopup({
        title: "Payment Methods",
        message: "Please add at least 2 payment methods for split payment.",
        type: "warning",
        confirmText: "Ok",
      });
      return;
    }

    if (totalEntered > maxAmount) {
      showPopup({
        title: "Amount Exceeded",
        message: `Entered amount (₹${formatIndianNumber(totalEntered)}) exceeds net payable (₹${formatIndianNumber(maxAmount)})`,
        type: "error",
        confirmText: "Ok",
      });
      return;
    }

    if (totalEntered <= 0) {
      showPopup({
        title: "Enter Amount",
        message: "Please enter payment amounts.",
        type: "warning",
        confirmText: "Ok",
      });
      return;
    }

    onSave(validPayments, totalEntered);
    handleClose();
  };

  const handleClose = () => {
    setPayments([{ mode: "UPI", amount: "" }]);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="split-modal-overlay">
      {PopupComponent}
      <div className="split-modal">
        <div className="split-modal-header">
          <h3>Split Payment</h3>
          <button onClick={handleClose} className="split-modal-close">×</button>
        </div>

        {/* Real-time Summary */}
        <div className="split-summary">
          <div className="split-summary-item">
            <span className="split-label">Net Payable</span>
            <span className="split-value">₹{formatIndianNumber(maxAmount)}</span>
          </div>
          
          {minAdvance > 0 && (
            <div className="split-summary-item">
              <span className="split-label">Min. Advance</span>
              <span className="split-value min">₹{formatIndianNumber(minAdvance)}</span>
            </div>
          )}
          
          <div className="split-divider"></div>
          
          <div className="split-summary-item">
            <span className="split-label">Advance Entered</span>
            <span className={`split-value ${isExceeded ? 'error' : isBelowMin ? 'warning' : totalEntered > 0 ? 'success' : ''}`}>
              ₹{formatIndianNumber(totalEntered)}
            </span>
          </div>
          
          <div className={`split-summary-item balance-row ${isExceeded ? 'error-bg' : ''}`}>
            <span className="split-label">{isExceeded ? 'Exceeded by' : 'Balance'}</span>
            <span className={`split-value ${isExceeded ? 'error' : ''}`}>
              ₹{formatIndianNumber(Math.abs(balance))}
            </span>
          </div>

          {isBelowMin && !isExceeded && (
            <div className="split-warning">
              Below minimum advance (₹{formatIndianNumber(minAdvance)})
            </div>
          )}
        </div>

        {/* Payment Methods */}
        <div className="split-payments">
          {payments.map((payment, index) => (
            <div key={index} className="split-row">
              <span className="split-num">{index + 1}</span>
              <select
                value={payment.mode}
                onChange={(e) => updatePayment(index, "mode", e.target.value)}
                className="split-select"
              >
                {paymentModes.map((pm) => (
                  <option key={pm.value} value={pm.value}>{pm.label}</option>
                ))}
              </select>
              <div className="split-input-wrap">
                <span className="split-rupee">₹</span>
                <input
                  type="number"
                  placeholder="Amount"
                  value={payment.amount}
                  onChange={(e) => updatePayment(index, "amount", e.target.value)}
                  className="split-input"
                />
              </div>
              {payments.length > 1 && (
                <button
                  onClick={() => removePaymentRow(index)}
                  className="split-remove"
                >×</button>
              )}
            </div>
          ))}
          
          <button onClick={addPaymentRow} className="split-add">
            + Add Payment Method
          </button>
        </div>

        {/* Actions */}
        <div className="split-actions">
          <button onClick={handleClose} className="split-btn-cancel">Cancel</button>
          <button 
            onClick={handleSave} 
            className={`split-btn-save ${totalEntered > 0 && !isExceeded ? 'active' : ''}`}
            disabled={isExceeded || totalEntered <= 0}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}