import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { NOTIFICATION_TYPES, sendNotification } from "../utils/notificationService";
import { sendWhatsApp, WA_TEMPLATES } from "../utils/whatsappService";
import "../screens/OrderHistory.css";

// ============================================================
// The order edit modal — lifted out of OrderHistory so every dashboard that
// offers "Edit Order" on a card runs the same save (items, delivery, notes,
// stale-PDF purge, warehouse notification) instead of a copy.
// Callers own the eligibility rule (when to show the button) and the list
// update (onSaved receives the fresh row).
// ============================================================

// Measurement categories and fields (same as Screen4)
const CATEGORY_KEY_MAP = {
  "Kurta/Choga/Kaftan": "KurtaChogaKaftan",
  "Blouse": "Blouse",
  "Anarkali": "Anarkali",
  "Salwar/Dhoti": "SalwarDhoti",
  "Churidaar/Trouser/Pants/Plazo": "ChuridaarTrouserPantsPlazo",
  "Sharara/Gharara": "ShararaGharara",
  "Lehenga": "Lehenga",
};

const measurementCategories = Object.keys(CATEGORY_KEY_MAP);

const measurementFields = {
  KurtaChogaKaftan: [
    "Height", "Shoulder", "Neck", "Upper Bust", "Bust", "Dart Point",
    "Sleeves", "Bicep", "Arm Hole", "Waist", "Hip", "Length",
    "Front Cross", "Back Cross", "Front Neck", "Back Neck",
  ],
  Blouse: [
    "Shoulder", "Upper Bust", "Bust", "Dart Point", "Sleeves", "Arm Hole",
    "Waist", "Length", "Front Cross", "Back Cross", "Front Neck", "Back Neck",
  ],
  Anarkali: [
    "Shoulder", "Upper Bust", "Bust", "Dart Point", "Sleeves", "Bicep",
    "Arm Hole", "Length", "Front Neck", "Back Neck",
  ],
  SalwarDhoti: ["Waist", "Hip", "Length"],
  ChuridaarTrouserPantsPlazo: [
    "Waist", "Hip", "Length", "Thigh", "Calf", "Ankle", "Knee", "Yoke Length",
  ],
  ShararaGharara: ["Waist", "Hip", "Length"],
  Lehenga: ["Waist", "Hip", "Length"],
};

const WOMEN_SIZE_OPTIONS = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL", "8XL"];

const KIDS_SIZE_OPTIONS = [
  "1-2 yrs", "2-3 yrs", "3-4 yrs", "4-5 yrs", "5-6 yrs",
  "6-7 yrs", "7-8 yrs", "8-9 yrs", "9-10 yrs", "10-11 yrs",
  "11-12 yrs", "12-13 yrs", "13-14 yrs", "14-15 yrs", "15-16 yrs",
];

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
 */
export default function EditOrderModal({ order, onClose, onSaved, showPopup, notifyCustomer = true }) {
  const [colors, setColors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [activeCategory, setActiveCategory] = useState("Kurta/Choga/Kaftan");
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
    isKids: item.isKids || item.category === "Kids" || false,
    comments: order.comments || "",
  });
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  useEffect(() => {
    supabase.from("colors").select("name, hex").order("name").then(({ data, error }) => {
      if (!error && data) setColors(data);
    });
  }, []);

  const updateMeasurement = (categoryKey, field, value) => {
    setMeasurements((prev) => ({
      ...prev,
      [categoryKey]: { ...(prev[categoryKey] || {}), [field]: value },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const topColorObj = colors.find(c => c.name === form.top_color) || { name: form.top_color, hex: "#888" };
      const bottomColorObj = colors.find(c => c.name === form.bottom_color) || { name: form.bottom_color, hex: "#888" };

      const updatedItems = order.items?.map((it, i) => i === 0 ? {
        ...it,
        size: form.size,
        top: form.top,
        bottom: form.bottom,
        top_color: topColorObj,
        bottom_color: bottomColorObj,
        measurements: cleanMeasurements(measurements),
      } : it);

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

      // Re-read so the PDF regenerates from the saved measurements
      const { data: freshOrder } = await supabase.from("orders").select("*").eq("id", order.id).single();
      if (freshOrder) onSaved?.(freshOrder);
      onClose();
      showPopup({ type: "success", title: "Order Updated", message: "Order has been updated successfully!", confirmText: "OK" });

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
        metadata: { client_name: order.delivery_name },
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
            background: form.isKids ? '#e8f5e9' : '#fce4ec',
            borderRadius: '4px',
            display: 'inline-block',
            fontSize: '13px',
            fontWeight: '500',
            color: form.isKids ? '#2e7d32' : '#c2185b'
          }}>
            Category: {form.isKids ? 'Kids' : 'Women'}
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
                {(form.isKids ? KIDS_SIZE_OPTIONS : WOMEN_SIZE_OPTIONS).map(s => <option key={s} value={s}>{s}</option>)}
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
        </div>
        <div className="oh-modal-footer">
          <button className="oh-modal-btn cancel" onClick={onClose}>Cancel</button>
          <button className="oh-modal-btn save" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
