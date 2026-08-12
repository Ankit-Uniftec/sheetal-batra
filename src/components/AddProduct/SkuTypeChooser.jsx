import React from "react";

/**
 * SkuTypeChooser — after scanning a reserved tag, ask what kind of product it is.
 *
 * A direct overlay rather than usePopup: the hook's PopupComponent doesn't
 * forward children, so it can't render three choices. Reuses Popup's own CSS
 * classes so this looks identical to every other modal in the app.
 *
 * All three of AddProduct's product types are offered. The scan flow shouldn't
 * be able to do less than typing the SKU by hand would.
 */
export default function SkuTypeChooser({ sku, onPick, onCancel }) {
  if (!sku) return null;

  const options = [
    { key: "normal", label: "Normal Product", hint: "Regular off-the-rack piece with sizes and stock." },
    { key: "lxrts", label: "LXRTS (Shopify)", hint: "Synced to Shopify, priced and stocked per size." },
    { key: "custom_piece", label: "Custom Piece", hint: "Bespoke / made-to-order piece." },
  ];

  return (
    <div className="popup-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}>
      <div className="popup-box popup-confirm ap-type-chooser">
        <div className="popup-header">
          <span className="popup-icon popup-icon-confirm">?</span>
          <h3 className="popup-title">Scanned {sku}</h3>
        </div>

        <div className="popup-body">
          <p className="popup-message">
            This barcode has no details yet. What kind of product is it?
          </p>
          <div className="ap-type-chooser-options">
            {options.map((o) => (
              <button
                key={o.key}
                type="button"
                className="ap-type-chooser-btn"
                onClick={() => onPick(o.key)}
              >
                <strong>{o.label}</strong>
                <span>{o.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="popup-actions">
          <button className="popup-btn popup-btn-cancel" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
