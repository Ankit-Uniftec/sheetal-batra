import React from "react";
import "./Popup.css";

/**
 * Reusable Popup Component
 * 
 * @param {boolean} isOpen - Controls visibility
 * @param {function} onClose - Called when popup is closed
 * @param {string} title - Popup title
 * @param {string} message - Popup message
 * @param {string} type - "info" | "warning" | "error" | "success" | "confirm"
 * @param {function} onConfirm - Called when confirm button is clicked (for confirm type)
 * @param {string} confirmText - Text for confirm button (default: "OK")
 * @param {string} cancelText - Text for cancel button (default: "Cancel")
 * @param {boolean} showCancel - Show cancel button (default: true for confirm type)
 */
export default function Popup({
  isOpen,
  onClose,
  title = "Alert",
  message = "",
  type = "info",
  onConfirm,
  confirmText = "OK",
  cancelText = "Cancel",
  showCancel = false,
  children,
}) {
  if (!isOpen) return null;

  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm();
    }
    onClose();
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const getIcon = () => {
    switch (type) {
      case "success":
        return "✓";
      case "error":
        return "✕";
      case "warning":
        return "⚠";
      case "confirm":
        return "?";
      default:
        return "ℹ";
    }
  };

  return (
    <div className="popup-overlay" onClick={handleOverlayClick}>
      <div className={`popup-box popup-${type}`}>
        <div className="popup-header">
          <span className={`popup-icon popup-icon-${type}`}>{getIcon()}</span>
          <h3 className="popup-title">{title}</h3>
          <button className="popup-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="popup-body">
          {message && <p className="popup-message">{message}</p>}
          {children}
        </div>

        <div className="popup-actions">
          {(showCancel || type === "confirm") && (
            <button className="popup-btn popup-btn-cancel" onClick={onClose}>
              {cancelText}
            </button>
          )}
          <button className="popup-btn popup-btn-confirm" onClick={handleConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook for using popup easily
 * Usage:
 * const { showPopup, PopupComponent } = usePopup();
 * showPopup({ title: "Error", message: "Something went wrong", type: "error" });
 */
export function usePopup() {
  const [popupState, setPopupState] = React.useState({
    isOpen: false,
    title: "",
    message: "",
    type: "info",
    onConfirm: null,
    confirmText: "OK",
    cancelText: "Cancel",
    showCancel: false,
  });

  const showPopup = (options) => {
    setPopupState({
      isOpen: true,
      title: options.title || "Alert",
      message: options.message || "",
      type: options.type || "info",
      onConfirm: options.onConfirm || null,
      confirmText: options.confirmText || "OK",
      cancelText: options.cancelText || "Cancel",
      showCancel: options.showCancel || options.type === "confirm",
    });
  };

  const hidePopup = () => {
    setPopupState((prev) => ({ ...prev, isOpen: false }));
  };

  const PopupComponent = (
    <Popup
      isOpen={popupState.isOpen}
      onClose={hidePopup}
      title={popupState.title}
      message={popupState.message}
      type={popupState.type}
      onConfirm={popupState.onConfirm}
      confirmText={popupState.confirmText}
      cancelText={popupState.cancelText}
      showCancel={popupState.showCancel}
    />
  );

  return { showPopup, hidePopup, PopupComponent };
}