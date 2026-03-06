import React from "react";
import "./ExtrasPopup.css";

/**
 * ExtrasPopup – A popup specifically for adding extras.
 * Unlike the shared Popup component, this allows overflow
 * so SearchableSelect dropdowns render properly.
 *
 * @param {boolean}  isOpen   - Controls visibility
 * @param {function} onClose  - Called when popup is closed
 * @param {string}   title    - Popup title
 * @param {React.ReactNode} children - Body content
 */
export default function ExtrasPopup({ isOpen, onClose, title = "Add Extras", children }) {
  if (!isOpen) return null;

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="extras-popup-overlay" onClick={handleOverlayClick}>
      <div className="extras-popup-box">
        <div className="extras-popup-header">
          <span className="extras-popup-icon">+</span>
          <h3 className="extras-popup-title">{title}</h3>
        </div>

        <div className="extras-popup-body">
          {children}
        </div>

        <div className="extras-popup-footer">
          <button className="ep-close-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}