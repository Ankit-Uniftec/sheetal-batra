import React, { useEffect, useMemo, useState } from "react";
import { getItemCategory, sizeOptionsFor, CATEGORY_KIDS } from "../utils/itemCategory";
import { supabase } from "../lib/supabaseClient";
import { NOTIFICATION_TYPES, sendNotification } from "../utils/notificationService";
import { sendWhatsApp, WA_TEMPLATES } from "../utils/whatsappService";
import { fetchLinePieces } from "../utils/breakdownChangeApi";
import { planPieceSync, previewMoney, pieceLock, planToRpcArgs } from "../utils/orderPieceEdit";
import "../screens/OrderHistory.css";
import { MEASUREMENT_FIELDS, GROUP_DISPLAY_NAMES, TOP_GROUPS, BOTTOM_GROUPS } from "../utils/measurementChart";

// ============================================================
// The order edit modal — lifted out of OrderHistory so every dashboard that
// offers "Edit Order" on a card runs the same save (items, delivery, notes,
// stale-PDF purge, warehouse notification) instead of a copy.
// Callers own the eligibility rule (when to show the button) and the list
// update (onSaved receives the fresh row).
// ============================================================

// Measurement categories and fields (same as Screen4)
// Release 38: categories and fields come from the client's chart
// (utils/measurementChart.js), the same one the order form uses.
const CATEGORY_KEY_MAP = Object.fromEntries(
  ["Height", ...TOP_GROUPS, ...BOTTOM_GROUPS].map((k) => [GROUP_DISPLAY_NAMES[k], k])
);
const measurementCategories = Object.keys(CATEGORY_KEY_MAP);
const measurementFields = MEASUREMENT_FIELDS;

const colorName = (c) => (typeof c === "object" && c !== null ? c.name || "" : c || "");

const cleanMeasurements = (measurements) => {
  const cleaned = {};
  for (const [category, fields] of Object.entries(measurements || {})) {
    if (fields && typeof fields === "object") {
      const cleanedFields = {};
      for (const [field, value] of Object.entries(fields)) {
        if (value !== "" && value !== null && value !== undefined) {
          cleanedFields[field] = value;
        }
      }
      if (Object.keys(cleanedFields).length > 0) {
        cleaned[category] = cleanedFields;
      }
    }
  }
  return cleaned;
};

/**
 * @param {object}   order          the orders row being edited
 * @param {function} onClose
 * @param {function} onSaved        (freshOrder) => void — the re-read row
 * @param {function} showPopup      the caller's usePopup().showPopup
 * @param {boolean} [notifyCustomer] false skips the ORDER_EDITED WhatsApp
 *                                  (Comms orders have no paying customer)
 * @param {boolean} [requireReason]  true shows a mandatory "Reason for edit" box;
 *                                  the reason is written to order_edit_log and
 *                                  carried on the ORDER_EDITED notification
 *                                  (Comms, meeting point 9). Off by default, so
 *                                  Store Order History is unchanged.
 * @param {string}  [reasonSource]   order_edit_log.source, e.g. "comms"
 * @param {string}  [editedBy]       order_edit_log.edited_by (the user's email)
 * @param {function}[recheck]        (order) => string|null, run again at Save:
 *                                  a message blocks the save (e.g. the caller's
 *                                  time window ran out while the modal was open)
 */
export default function EditOrderModal({
  order, onClose, onSaved, showPopup, notifyCustomer = true,
  requireReason = false, reasonSource = null, editedBy = null, recheck = null,
}) {
  const [colors, setColors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState("");
  const [activeCategory, setActiveCategory] = useState(GROUP_DISPLAY_NAMES.KurtaChogaKaftan);
  const item = order.items?.[0] || {};
  const [measurements, setMeasurements] = useState(item.measurements || {});
  const [form, setForm] = useState({
    size: item.size || "",
    top: item.top || "",
    bottom: item.bottom || "",
    top_color: colorName(item.top_color),
    bottom_color: colorName(item.bottom_color),
    delivery_date: order.delivery_date?.slice(0, 10) || "",
    delivery_address: order.delivery_address || "",
    delivery_city: order.delivery_city || "",
    delivery_state: order.delivery_state || "",
    delivery_pincode: order.delivery_pincode || "",
    mode_of_delivery: order.mode_of_delivery || "",
    category: getItemCategory(item),
    comments: order.comments || "",
  });
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  // Dupatta and extras, per product (point #9).
  const pieceEditable = !/^SB-SHOP/i.test(order.order_no || "");
  const freeOrder = !(Number(order.grand_total) > 0);
  const [pieceItems, setPieceItems] = useState(() => (order.items || []).map((it) => ({
    includes_dupatta: it.includes_dupatta === true,
    dupatta_color: colorName(it.dupatta_color),
    extras: Array.isArray(it.extras) ? it.extras : [],
  })));
  const [pieceIdx, setPieceIdx] = useState(0);
  const [pieces, setPieces] = useState({ components: [], packedIds: new Set(), loaded: false, failed: false });
  const [extrasList, setExtrasList] = useState([]);
  const [dupattaColors, setDupattaColors] = useState([]);
  const [newExtra, setNewExtra] = useState("");
  const [newExtraColor, setNewExtraColor] = useState("");

  useEffect(() => {
    supabase.from("colors").select("name, hex").order("name").then(({ data, error }) => {
      if (!error && data) setColors(data);
    });
  }, []);

  useEffect(() => {
    if (!pieceEditable) return;
    fetchLinePieces(order.id)
      .then(({ components, packedIds }) => setPieces({ components, packedIds, loaded: true, failed: false }))
      .catch(() => setPieces((p) => ({ ...p, failed: true })));
    supabase.from("extras").select("name, price, sort_order").order("sort_order", { ascending: true })
      .then(({ data, error }) => { if (!error && data) setExtrasList(data); });
    supabase.from("dupatta_colors").select("name").order("name")
      .then(({ data, error }) => { if (!error && data) setDupattaColors(data.map((d) => d.name)); });
  }, [order.id, pieceEditable]);

  const activePiece = pieceItems[pieceIdx] || { includes_dupatta: false, dupatta_color: "", extras: [] };
  const changePieceItem = (patch) =>
    setPieceItems((prev) => prev.map((p, i) => (i === pieceIdx ? { ...p, ...patch } : p)));
  const removeExtra = (index) => changePieceItem({ extras: activePiece.extras.filter((_, i) => i !== index) });
  const addExtra = () => {
    const details = extrasList.find((x) => x.name === newExtra);
    const color = colors.find((c) => c.name === newExtraColor) || { name: newExtraColor, hex: "#888" };
    changePieceItem({
      extras: [...activePiece.extras, { name: newExtra, color, price: freeOrder ? 0 : Number(details?.price) || 0 }],
    });
    setNewExtra("");
    setNewExtraColor("");
  };
  const dupattaLock = activePiece.includes_dupatta
    ? pieceLock(pieces.components, pieces.packedIds, pieceIdx, "dupatta")
    : null;

  // The items with the dupatta and extras edits applied. A dupatta colour left
  // alone keeps exactly what was stored.
  const pieceDraftItems = useMemo(() => (order.items || []).map((it, i) => {
    const p = pieceItems[i];
    if (!p) return it;
    return {
      ...it,
      includes_dupatta: p.includes_dupatta,
      dupatta_color: !p.includes_dupatta
        ? null
        : p.dupatta_color === colorName(it.dupatta_color) ? it.dupatta_color : (p.dupatta_color || null),
      extras: p.extras,
    };
  }), [order.items, pieceItems]);

  const piecePlan = useMemo(
    () => (pieceEditable && pieces.loaded
      ? planPieceSync(order, pieceDraftItems, pieces.components, pieces.packedIds)
      : null),
    [pieceEditable, pieces, order, pieceDraftItems]
  );
  const pieceChanged = !!piecePlan?.changed;
  const pieceMoney = previewMoney(order, pieceDraftItems);
  const pieceProblem = !pieceChanged && !piecePlan?.blocked.length ? null
    : piecePlan.blocked.length ? piecePlan.blocked.map((b) => `${b.barcode} ${b.why}`).join(". ")
    : pieceMoney.belowPaid ? `The new total would be below the ₹${Number(order.total_paid || 0).toLocaleString("en-IN")} already paid.`
    : null;
  const needReason = requireReason || pieceChanged;

  const updateMeasurement = (categoryKey, field, value) => {
    setMeasurements((prev) => ({
      ...prev,
      [categoryKey]: { ...(prev[categoryKey] || {}), [field]: value },
    }));
  };

  const handleSave = async () => {
    const trimmedReason = reason.trim();
    if (needReason && !trimmedReason) return;
    if (pieceProblem) return;
    const blocked = recheck?.(order);
    if (blocked) {
      showPopup({ type: "error", title: "Can't edit this order", message: blocked, confirmText: "OK" });
      return;
    }
    setSaving(true);
    try {
      const topColorObj = colors.find(c => c.name === form.top_color) || { name: form.top_color, hex: "#888" };
      const bottomColorObj = colors.find(c => c.name === form.bottom_color) || { name: form.bottom_color, hex: "#888" };

      const updatedItems = pieceDraftItems.map((it, i) => i === 0 ? {
        ...it,
        size: form.size,
        top: form.top,
        bottom: form.bottom,
        top_color: topColorObj,
        bottom_color: bottomColorObj,
        measurements: cleanMeasurements(measurements),
      } : it);

      // Pieces and money first, in one database step. A refusal stops the whole
      // save, so nothing below runs for an edit that did not land.
      if (pieceChanged) {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        const { data: pieceResult, error: pieceError } = await supabase.rpc("edit_order_pieces", {
          p_order_id: order.id,
          p_items: updatedItems,
          ...planToRpcArgs(piecePlan),
          p_reason: trimmedReason,
          p_by: editedBy || authUser?.email || null,
          p_source: reasonSource || "order_history",
        });
        if (pieceError) throw pieceError;
        if (!pieceResult?.success) {
          showPopup({ type: "error", title: "Can't save this change", message: pieceResult?.message || "The change could not be saved.", confirmText: "OK" });
          return;
        }
      }

      // Delete old PDF files from storage to force regeneration
      try {
        if (order.order_no) {
          const paths = [`orders/${order.order_no}_customer.pdf`];
          (order.items || []).forEach((_, i) => paths.push(`orders/${order.order_no}_warehouse_${i + 1}.pdf`));
          await supabase.storage.from("invoices").remove(paths);
        }
      } catch (err) {
        /* PDF cleanup failed */
      }

      const { error } = await supabase.from("orders").update({
        items: updatedItems,
        delivery_date: form.delivery_date,
        delivery_address: form.delivery_address,
        delivery_city: form.delivery_city,
        delivery_state: form.delivery_state,
        delivery_pincode: form.delivery_pincode,
        mode_of_delivery: form.mode_of_delivery,
        comments: form.comments || "",
        updated_at: new Date().toISOString(),
        warehouse_url: null,
        warehouse_urls: null,
        customer_url: null,
      }).eq("id", order.id);
      if (error) throw error;

      // The reason is recorded AFTER the edit lands, so a failed save never
      // leaves a log row for an edit that did not happen. If only this insert
      // fails, the edit stands and the user is told the reason was not stored
      // (it still travels on the ORDER_EDITED notification below).
      let reasonNotSaved = false;
      if (requireReason && !pieceChanged) { // edit_order_pieces has already logged it
        const { error: logErr } = await supabase.from("order_edit_log").insert({
          order_id: order.id,
          order_no: order.order_no,
          reason: trimmedReason,
          edited_by: editedBy,
          source: reasonSource,
        });
        if (logErr) {
          console.error("order_edit_log insert failed (order WAS updated):", logErr);
          reasonNotSaved = true;
        }
      }

      // Re-read so the PDF regenerates from the saved measurements
      const { data: freshOrder } = await supabase.from("orders").select("*").eq("id", order.id).single();
      if (freshOrder) onSaved?.(freshOrder);
      onClose();
      showPopup(reasonNotSaved
        ? { type: "warning", title: "Order Updated", message: "The order was updated, but the reason for the edit could not be saved. Please tell the admin.", confirmText: "OK" }
        : { type: "success", title: "Order Updated", message: pieceChanged ? "Order has been updated. The pieces changed, so please reprint the work order." : "Order has been updated successfully!", confirmText: "OK" });

      if (notifyCustomer) {
        sendWhatsApp({
          customerName: order.delivery_name,
          customerPhone: order.delivery_phone,
          customerCountry: order.delivery_country,
          template: WA_TEMPLATES.ORDER_EDITED,
          pdfUrl: freshOrder?.customer_url,
        }).catch(err => console.error("WA edited error:", err));
      }

      sendNotification(NOTIFICATION_TYPES.ORDER_EDITED, {
        orderId: order.id,
        orderNo: order.order_no,
        metadata: {
          client_name: order.delivery_name,
          ...(requireReason ? { edit_reason: trimmedReason } : {}),
        },
      }).catch(err => console.error("Edit notification error:", err));

      if (order.salesperson_store === "Private") {
        sendNotification(NOTIFICATION_TYPES.PVT_ORDER_EDITED, {
          orderId: order.id,
          orderNo: order.order_no,
          metadata: { client_name: order.delivery_name },
        }).catch(err => console.error("PVT edit notification error:", err));
      }
    } catch (err) {
      showPopup({ type: "error", title: "Error", message: "Failed: " + err.message, confirmText: "OK" });
    } finally {
      setSaving(false);
    }
  };

  const categoryKey = CATEGORY_KEY_MAP[activeCategory];

  return (
    <div className="oh-modal-overlay">
      <div className="oh-modal oh-modal-large">
        <div className="oh-modal-header">
          <h3>Edit Order</h3>
          <button className="oh-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="oh-modal-body">
          {/* Category Indicator */}
          <div className="oh-category-badge" style={{
            marginBottom: '15px',
            padding: '6px 12px',
            background: form.category === CATEGORY_KIDS ? '#e8f5e9' : '#fce4ec',
            borderRadius: '4px',
            display: 'inline-block',
            fontSize: '13px',
            fontWeight: '500',
            color: form.category === CATEGORY_KIDS ? '#2e7d32' : '#c2185b'
          }}>
            Category: {form.category}
          </div>

          {/* Top & Bottom with Colors */}
          <div className="oh-modal-row">
            <div className="oh-modal-field">
              <label>Top</label>
              <input type="text" value={form.top} onChange={set("top")} />
            </div>
            <div className="oh-modal-field">
              <label>Top Color</label>
              <select value={form.top_color} onChange={set("top_color")} className="oh-color-select">
                <option value="">Select Color</option>
                {colors.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div className="oh-modal-row">
            <div className="oh-modal-field">
              <label>Bottom</label>
              <input type="text" value={form.bottom} onChange={set("bottom")} />
            </div>
            <div className="oh-modal-field">
              <label>Bottom Color</label>
              <select value={form.bottom_color} onChange={set("bottom_color")} className="oh-color-select">
                <option value="">Select Color</option>
                {colors.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div className="oh-modal-row">
            <div className="oh-modal-field">
              <label>Size</label>
              <select value={form.size} onChange={set("size")}>
                <option value="">Select</option>
                {sizeOptionsFor(form.category).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="oh-modal-field">
              <label>Delivery Date</label>
              <input type="date" value={form.delivery_date} onChange={set("delivery_date")} />
            </div>
            <div className="oh-modal-field">
              <label>Mode of Delivery</label>
              <select value={form.mode_of_delivery} onChange={set("mode_of_delivery")}>
                <option value="Home Delivery">Home Delivery</option>
                <option value="Delhi Store">Delhi Store</option>
                <option value="Ludhiana Store">Ludhiana Store</option>
              </select>
            </div>
          </div>

          <div className="oh-modal-field full">
            <label>Address</label>
            <input type="text" value={form.delivery_address} onChange={set("delivery_address")} />
          </div>
          <div className="oh-modal-row">
            <div className="oh-modal-field">
              <label>City</label>
              <input type="text" value={form.delivery_city} onChange={set("delivery_city")} />
            </div>
            <div className="oh-modal-field">
              <label>State</label>
              <input type="text" value={form.delivery_state} onChange={set("delivery_state")} />
            </div>
            <div className="oh-modal-field">
              <label>Pincode</label>
              <input type="text" value={form.delivery_pincode} onChange={set("delivery_pincode")} />
            </div>
          </div>

          {/* Measurements Section */}
          <div className="oh-measurements-section">
            <h4>Custom Measurements (in)</h4>
            <div className="oh-measure-container">
              <div className="oh-measure-menu">
                {measurementCategories.map((cat) => (
                  <div
                    key={cat}
                    className={`oh-measure-item ${activeCategory === cat ? "active" : ""}`}
                    onClick={() => setActiveCategory(cat)}
                  >
                    {cat}
                  </div>
                ))}
              </div>
              <div className="oh-measure-fields">
                <div className="oh-measure-grid">
                  {(measurementFields[categoryKey] || []).map((field) => (
                    <div className="oh-measure-field" key={field}>
                      <label>{field}</label>
                      <input
                        type="number"
                        value={measurements[categoryKey]?.[field] || ""}
                        onChange={(e) => updateMeasurement(categoryKey, field, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Dupatta and extras (point #9). Website orders keep Breakdown Changes. */}
          {pieceEditable && (
            <div style={{ marginTop: '15px', padding: '12px', border: '1px solid #e0d6c3', borderRadius: '8px' }}>
              <div style={{ fontWeight: 600, marginBottom: '10px' }}>Dupatta and Extras</div>

              {pieces.failed ? (
                <p style={{ margin: 0, fontSize: '13px', color: '#c62828' }}>
                  Could not load this order's pieces, so dupatta and extras can't be changed right now.
                </p>
              ) : !pieces.loaded ? (
                <p style={{ margin: 0, fontSize: '13px', color: '#666' }}>Loading pieces...</p>
              ) : (
                <>
                  {pieceItems.length > 1 && (
                    <div className="oh-modal-field" style={{ marginBottom: '10px' }}>
                      <label>Product</label>
                      <select value={pieceIdx} onChange={(e) => setPieceIdx(Number(e.target.value))}>
                        {(order.items || []).map((it, i) => (
                          <option key={i} value={i}>{it.product_name || `Product ${i + 1}`}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="oh-modal-row">
                    <div className="oh-modal-field">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="checkbox"
                          style={{ width: 'auto' }}
                          checked={activePiece.includes_dupatta}
                          disabled={!!dupattaLock}
                          onChange={(e) => changePieceItem({ includes_dupatta: e.target.checked })}
                        />
                        Dupatta included {dupattaLock ? `(locked: ${dupattaLock})` : ""}
                      </label>
                    </div>
                    <div className="oh-modal-field">
                      <label>Dupatta Color</label>
                      <select
                        value={activePiece.dupatta_color}
                        disabled={!activePiece.includes_dupatta}
                        onChange={(e) => changePieceItem({ dupatta_color: e.target.value })}
                      >
                        <option value="">Select Color</option>
                        {activePiece.dupatta_color && !dupattaColors.includes(activePiece.dupatta_color) && (
                          <option value={activePiece.dupatta_color}>{activePiece.dupatta_color}</option>
                        )}
                        {dupattaColors.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="oh-modal-field full" style={{ marginTop: '10px' }}>
                    <label>Extras</label>
                    {activePiece.extras.length === 0 && (
                      <div style={{ fontSize: '13px', color: '#666' }}>No extras on this product.</div>
                    )}
                    {activePiece.extras.map((x, i) => {
                      const lock = pieceLock(pieces.components, pieces.packedIds, pieceIdx, "extra", i);
                      return (
                        <div key={`${x.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', padding: '4px 0' }}>
                          <span style={{ flex: 1 }}>
                            {x.name}{colorName(x.color) ? ` (${colorName(x.color)})` : ""}{freeOrder ? "" : ` · ₹${Number(x.price || 0).toLocaleString("en-IN")}`}
                          </span>
                          {lock
                            ? <span style={{ color: '#666' }}>Locked: {lock}</span>
                            : <button type="button" className="oh-modal-btn cancel" onClick={() => removeExtra(i)}>Remove</button>}
                        </div>
                      );
                    })}
                  </div>

                  <div className="oh-modal-row" style={{ marginTop: '10px' }}>
                    <div className="oh-modal-field">
                      <label>Add Extra</label>
                      <select value={newExtra} onChange={(e) => setNewExtra(e.target.value)}>
                        <option value="">Select Extra</option>
                        {extrasList.map((x) => (
                          <option key={x.name} value={x.name}>
                            {x.name}{freeOrder ? "" : ` (₹${Number(x.price || 0).toLocaleString("en-IN")})`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="oh-modal-field">
                      <label>Extra Color</label>
                      <select value={newExtraColor} onChange={(e) => setNewExtraColor(e.target.value)}>
                        <option value="">Select Color</option>
                        {colors.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
                    <button
                      type="button"
                      className="oh-modal-btn save"
                      disabled={!newExtra || !newExtraColor}
                      onClick={addExtra}
                    >
                      Add
                    </button>
                  </div>

                  {pieceChanged && (
                    <div style={{ marginTop: '10px', padding: '8px 10px', background: '#fff8e1', borderRadius: '6px', fontSize: '13px' }}>
                      {piecePlan.add.length > 0 && <div>Adds: {piecePlan.add.map((a) => a.barcode).join(", ")}</div>}
                      {piecePlan.remove.length > 0 && <div>Removes: {piecePlan.remove.map((c) => c.barcode).join(", ")}</div>}
                      {piecePlan.relabel.length > 0 && <div>Renames: {piecePlan.relabel.map((r) => r.label).join(", ")}</div>}
                      {pieceMoney.delta !== 0 && (
                        <div>Total: ₹{pieceMoney.oldTotal.toLocaleString("en-IN")} → ₹{pieceMoney.newTotal.toLocaleString("en-IN")} (balance ₹{pieceMoney.newDue.toLocaleString("en-IN")})</div>
                      )}
                    </div>
                  )}
                  {pieceProblem && (
                    <div style={{ marginTop: '8px', fontSize: '13px', color: '#c62828' }}>{pieceProblem}</div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Order Notes */}
          <div className="oh-modal-field full" style={{ marginTop: '15px' }}>
            <label>Order Notes</label>
            <textarea
              className="oh-textarea"
              placeholder="Add notes for this order..."
              value={form.comments}
              onChange={set("comments")}
              rows={3}
              style={{ minHeight: '80px' }}
            />
          </div>

          {needReason && (
            <div className="oh-modal-field full" style={{ marginTop: '15px' }}>
              <label>Reason for edit *</label>
              <textarea
                className="oh-textarea"
                placeholder="Why is this order being changed?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
              />
            </div>
          )}
        </div>
        <div className="oh-modal-footer">
          <button className="oh-modal-btn cancel" onClick={onClose}>Cancel</button>
          <button
            className="oh-modal-btn save"
            onClick={handleSave}
            disabled={saving || !!pieceProblem || (needReason && !reason.trim())}
            title={needReason && !reason.trim() ? "Enter a reason for the edit first" : undefined}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
