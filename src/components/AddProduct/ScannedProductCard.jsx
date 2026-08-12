import React from "react";

/**
 * ScannedProductCard — read-only details for a tag whose product already exists.
 *
 * Scanning a filled-in barcode is a "what is this garment?" question, not an
 * edit. Deliberately read-only: AddProduct is a create/fill form and has no
 * update path for an already-live product, so offering fields here would imply
 * an ability that doesn't exist.
 */
export default function ScannedProductCard({ product, onScanAnother, onViewInInventory }) {
  if (!product) return null;

  const inv = product.inventory === 9999 ? "Made to order" : (product.inventory ?? 0);
  const sizes = (product.available_size || []).join(", ");

  const rows = [
    ["SKU", product.sku_id],
    ["Base price", product.base_price != null ? `₹${Number(product.base_price).toLocaleString("en-IN")}` : "—"],
    ["Inventory", inv],
    ["Sizes", sizes || "—"],
    ["Store", product.store_category || "—"],
    ["Default colour", product.default_color || "—"],
    ["Dupatta", product.has_dupatta ? `Yes${product.default_dupatta_color ? ` (${product.default_dupatta_color})` : ""}` : "No"],
  ];

  return (
    <div className="ap-scanned-card">
      <div className="ap-scanned-head">
        <div>
          <div className="ap-scanned-badge">Already in the catalogue</div>
          <h3>{product.name}</h3>
        </div>
        {product.sync_enabled && <span className="ap-scanned-tag">LXRTS</span>}
        {product.is_custom_piece && <span className="ap-scanned-tag">Custom Piece</span>}
      </div>

      <div className="ap-scanned-body">
        {product.image_url && (
          <img
            className="ap-scanned-img"
            src={product.image_url}
            alt={product.name}
            onError={(e) => { e.target.style.display = "none"; }}
          />
        )}
        <dl className="ap-scanned-rows">
          {rows.map(([k, v]) => (
            <div key={k} className="ap-scanned-row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="ap-scanned-actions">
        <button type="button" className="ap-btn-primary" onClick={onScanAnother}>Scan another</button>
        {onViewInInventory && (
          <button type="button" className="ap-btn-secondary" onClick={() => onViewInInventory(product)}>
            View in Inventory
          </button>
        )}
      </div>
    </div>
  );
}
