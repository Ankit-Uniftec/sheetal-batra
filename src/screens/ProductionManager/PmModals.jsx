import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabaseClient";
import { getItemCategory, sizeOptionsFor, CATEGORY_KIDS } from "../../utils/itemCategory";

// ============================================================
// The Production Manager's order windows: Edit, Set Priority and Cancel.
// They save exactly what the old dashboard saved, with two changes asked for:
//   - no client phone or address on screen (production never needs them);
//   - no raw "Order Status" box: status moves only through Mark as Completed
//     and Cancel, which keep the pieces and the order in step.
// ============================================================

const CATEGORY_KEY_MAP = {
  "Kurta/Choga/Kaftan": "KurtaChogaKaftan",
  Blouse: "Blouse",
  Anarkali: "Anarkali",
  "Salwar/Dhoti": "SalwarDhoti",
  "Churidaar/Trouser/Pants/Plazo": "ChuridaarTrouserPantsPlazo",
  "Sharara/Gharara": "ShararaGharara",
  Lehenga: "Lehenga",
};
const MEASURE_CATEGORIES = Object.keys(CATEGORY_KEY_MAP);
const MEASURE_FIELDS = {
  KurtaChogaKaftan: ["Height", "Shoulder", "Neck", "Upper Bust", "Bust", "Dart Point", "Sleeves", "Bicep", "Arm Hole", "Waist", "Hip", "Length", "Front Cross", "Back Cross", "Front Neck", "Back Neck"],
  Blouse: ["Shoulder", "Upper Bust", "Bust", "Dart Point", "Sleeves", "Arm Hole", "Waist", "Length", "Front Cross", "Back Cross", "Front Neck", "Back Neck"],
  Anarkali: ["Shoulder", "Upper Bust", "Bust", "Dart Point", "Sleeves", "Bicep", "Arm Hole", "Length", "Front Neck", "Back Neck"],
  SalwarDhoti: ["Waist", "Hip", "Length"],
  ChuridaarTrouserPantsPlazo: ["Waist", "Hip", "Length", "Thigh", "Calf", "Ankle", "Knee", "Yoke Length"],
  ShararaGharara: ["Waist", "Hip", "Length"],
  Lehenga: ["Waist", "Hip", "Length"],
};

const cleanMeasurements = (m) => {
  const out = {};
  Object.entries(m || {}).forEach(([cat, fields]) => {
    if (!fields || typeof fields !== "object") return;
    const kept = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== "" && v !== null && v !== undefined));
    if (Object.keys(kept).length) out[cat] = kept;
  });
  return out;
};
const colourName = (c) => (c && typeof c === "object" ? c.name || "" : c || "");

/** A centred window over the whole page, in the dashboard's look. */
export function PmModal({ title, sub, onClose, children, footer, width = 520 }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="pmx-overlay" onClick={onClose}>
      <div className="pmx-modal" style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="pmx-head">
          <div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>
          <button type="button" className="pmx-x" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="pmx-body">{children}</div>
        {footer && <footer className="pmx-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

const Field = ({ label, children, full }) => (
  <label className={`pmx-field${full ? " is-full" : ""}`}><span>{label}</span>{children}</label>
);

/** Edit an order's production details. `order` is the FULL row (fetchFullOrder). */
export function PmEditOrderModal({ order, onClose, onSaved, showPopup }) {
  const item = order.items?.[0] || {};
  const [colours, setColours] = useState([]);
  const [busy, setBusy] = useState(false);
  const [cat, setCat] = useState(MEASURE_CATEGORIES[0]);
  const [m, setM] = useState(item.measurements || {});
  const [f, setF] = useState({
    product_name: item.product_name || "",
    top: item.top || "",
    bottom: item.bottom || "",
    top_color: colourName(item.top_color),
    bottom_color: colourName(item.bottom_color),
    size: item.size || "",
    category: getItemCategory(item),
    delivery_date: order.delivery_date?.slice(0, 10) || "",
    delivery_name: order.delivery_name || "",
    mode_of_delivery: order.mode_of_delivery || "",
    priority: order.priority || "",
    notes: order.notes || "",
  });
  useEffect(() => {
    supabase.from("colors").select("name, hex").order("name").then(({ data }) => setColours(data || []));
  }, []);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const catKey = CATEGORY_KEY_MAP[cat];

  const save = async () => {
    setBusy(true);
    try {
      const topColour = colours.find((c) => c.name === f.top_color) || { name: f.top_color, hex: "#888" };
      const bottomColour = colours.find((c) => c.name === f.bottom_color) || { name: f.bottom_color, hex: "#888" };
      const items = (order.items || []).map((it, i) => (i === 0 ? {
        ...it,
        product_name: f.product_name,
        size: f.size,
        top: f.top,
        bottom: f.bottom,
        top_color: topColour,
        bottom_color: bottomColour,
        measurements: cleanMeasurements(m),
      } : it));
      // The PDFs are made again on next open, so they show the change.
      try {
        if (order.order_no) {
          const paths = [`orders/${order.order_no}_customer.pdf`, ...(order.items || []).map((_, i) => `orders/${order.order_no}_warehouse_${i + 1}.pdf`)];
          await supabase.storage.from("invoices").remove(paths);
        }
      } catch { /* a missing PDF is fine */ }
      const { error } = await supabase.from("orders").update({
        items,
        delivery_date: f.delivery_date || null,
        delivery_name: f.delivery_name,
        mode_of_delivery: f.mode_of_delivery,
        priority: f.priority || null,
        notes: f.notes || null,
        updated_at: new Date().toISOString(),
        warehouse_url: null,
        warehouse_urls: null,
        customer_url: null,
      }).eq("id", order.id);
      if (error) throw error;
      onSaved({ id: order.id, items, delivery_date: f.delivery_date || null, delivery_name: f.delivery_name, mode_of_delivery: f.mode_of_delivery, priority: f.priority || null, notes: f.notes || null, warehouse_url: null, warehouse_urls: null });
      showPopup({ type: "success", title: "Order Updated", message: `${order.order_no} has been updated.`, confirmText: "Ok" });
      onClose();
    } catch (err) {
      showPopup({ type: "error", title: "Not Saved", message: `The changes could not be saved: ${err.message}`, confirmText: "Ok" });
    } finally { setBusy(false); }
  };

  return (
    <PmModal
      title={`Edit ${order.order_no}`}
      sub={`${f.category}${(order.items || []).length > 1 ? " · changes apply to the first product" : ""}`}
      onClose={onClose}
      width={760}
      footer={(
        <>
          <button type="button" className="pmx-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="pmx-btn is-primary" onClick={save} disabled={busy}>{busy ? "Saving" : "Save Changes"}</button>
        </>
      )}
    >
      <p className="pmx-section">Product</p>
      <div className="pmx-grid">
        <Field label="Product Name" full><input value={f.product_name} onChange={set("product_name")} /></Field>
        <Field label="Top"><input value={f.top} onChange={set("top")} /></Field>
        <Field label="Top Colour">
          <select value={f.top_color} onChange={set("top_color")}>
            <option value="">Choose colour</option>
            {f.top_color && !colours.some((c) => c.name === f.top_color) && <option value={f.top_color}>{f.top_color}</option>}
            {colours.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Bottom"><input value={f.bottom} onChange={set("bottom")} /></Field>
        <Field label="Bottom Colour">
          <select value={f.bottom_color} onChange={set("bottom_color")}>
            <option value="">Choose colour</option>
            {f.bottom_color && !colours.some((c) => c.name === f.bottom_color) && <option value={f.bottom_color}>{f.bottom_color}</option>}
            {colours.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </Field>
        <Field label={`Size${f.category === CATEGORY_KIDS ? " (kids)" : ""}`}>
          <select value={f.size} onChange={set("size")}>
            <option value="">Choose size</option>
            {f.size && !sizeOptionsFor(f.category).includes(f.size) && <option value={f.size}>{f.size}</option>}
            {sizeOptionsFor(f.category).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>

      <p className="pmx-section">Delivery and Priority</p>
      <div className="pmx-grid">
        <Field label="Client Name"><input value={f.delivery_name} onChange={set("delivery_name")} /></Field>
        <Field label="Delivery Date"><input type="date" value={f.delivery_date} onChange={set("delivery_date")} /></Field>
        <Field label="Mode of Delivery">
          <select value={f.mode_of_delivery} onChange={set("mode_of_delivery")}>
            <option value="">Not set</option>
            {["Home Delivery", "Delhi Store", "Ludhiana Store"].map((v) => <option key={v} value={v}>{v}</option>)}
            {f.mode_of_delivery && !["Home Delivery", "Delhi Store", "Ludhiana Store"].includes(f.mode_of_delivery) && <option value={f.mode_of_delivery}>{f.mode_of_delivery}</option>}
          </select>
        </Field>
        <Field label="Priority">
          <select value={f.priority} onChange={set("priority")}>
            <option value="">Normal</option><option value="urgent">Urgent</option><option value="high">High</option><option value="low">Low</option>
          </select>
        </Field>
        <Field label="Production Notes" full><textarea rows={2} value={f.notes} onChange={set("notes")} placeholder="Notes for the floor" /></Field>
      </div>

      <p className="pmx-section">Measurements (inches)</p>
      <div className="pmx-measure">
        <div className="pmx-measure-cats">
          {MEASURE_CATEGORIES.map((c) => {
            const filled = Object.keys(m[CATEGORY_KEY_MAP[c]] || {}).filter((k) => m[CATEGORY_KEY_MAP[c]][k] !== "").length;
            return (
              <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)}>
                {c}{filled > 0 && <small>{filled}</small>}
              </button>
            );
          })}
        </div>
        <div className="pmx-measure-grid">
          {(MEASURE_FIELDS[catKey] || []).map((field) => (
            <Field key={field} label={field}>
              <input type="number" inputMode="decimal" value={m[catKey]?.[field] ?? ""} onChange={(e) => setM((p) => ({ ...p, [catKey]: { ...(p[catKey] || {}), [field]: e.target.value } }))} />
            </Field>
          ))}
        </div>
      </div>
    </PmModal>
  );
}

export function PmPriorityModal({ order, onClose, onSaved, showPopup }) {
  const [value, setValue] = useState(order.priority || "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.from("orders").update({ priority: value, updated_at: new Date().toISOString() }).eq("id", order.id);
      if (error) throw error;
      onSaved({ id: order.id, priority: value });
      onClose();
    } catch (err) {
      showPopup({ type: "error", title: "Not Saved", message: err.message, confirmText: "Ok" });
    } finally { setBusy(false); }
  };
  return (
    <PmModal title="Set Priority" sub={order.order_no} onClose={onClose} width={420}
      footer={<><button type="button" className="pmx-btn" onClick={onClose}>Cancel</button><button type="button" className="pmx-btn is-primary" onClick={save} disabled={busy}>{busy ? "Saving" : "Set Priority"}</button></>}>
      <div className="pmx-choice">
        {[["", "Normal", "Made in the usual order."], ["urgent", "Urgent", "Moves to the top of every list and is marked on the floor."]].map(([v, l, d]) => (
          <button key={l} type="button" aria-pressed={value === v} onClick={() => setValue(v)}><b>{l}</b><small>{d}</small></button>
        ))}
      </div>
    </PmModal>
  );
}

export function PmCancelModal({ order, onClose, onConfirm, busy }) {
  const [reason, setReason] = useState("");
  return (
    <PmModal title="Cancel Order" sub={order.order_no} onClose={onClose} width={480}
      footer={(
        <>
          <button type="button" className="pmx-btn" onClick={onClose}>Keep Order</button>
          <button type="button" className="pmx-btn is-danger" onClick={() => onConfirm(reason.trim())} disabled={busy || !reason.trim()}>{busy ? "Cancelling" : "Cancel Order"}</button>
        </>
      )}>
      <p className="pmx-warn">This cancels the order and takes every piece off the production floor; the scan stations will refuse them. Reserved stock is returned and production is told. It cannot be undone here.</p>
      <Field label="Why is it being cancelled?" full>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: cancelled by the store on 15 Sep" autoFocus />
      </Field>
    </PmModal>
  );
}
