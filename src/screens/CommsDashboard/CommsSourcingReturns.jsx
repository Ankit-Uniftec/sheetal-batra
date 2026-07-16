import React, { useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import formatDate from "../../utils/formatDate";

/**
 * CommsSourcingReturns — list of sourcing orders and a per-order Mark Returned
 * modal. Splits the orders into three buckets:
 *   - Pending: outfit return date is in the future OR today, still out
 *   - Overdue: return date has passed, still not Returned
 *   - Returned: comms_return_status === 'Returned'
 *
 * On "Mark Returned":
 *   - Captures status, condition, new location, damage notes
 *   - Updates the order row's comms_return_* columns
 *   - Increments inventory back for each item in the order (mirrors the
 *     decrement that happened on placement)
 */

const RETURN_CONDITIONS = [
  "Perfect",
  "Minor damage",
  "Major damage",
  "Missing component",
  "Others",
];

const NEW_LOCATION_OPTIONS = [
  "Delhi store",
  "Ludhiana store",
  "Delhi WH (1)",
  "Delhi WH (2)",
  "Consignment",
  "Others",
];

export default function CommsSourcingReturns({ orders, onOrderUpdated, showPopup }) {
  // Filter to Sourcing orders only.
  const sourcingOrders = useMemo(
    () => orders.filter((o) => o.comms_engagement_type === "Sourcing"),
    [orders]
  );

  const now = new Date();
  // Strip time so date comparisons treat today's return as not overdue.
  now.setHours(0, 0, 0, 0);

  // Bucket: pending / overdue / returned
  const buckets = useMemo(() => {
    const pending = [];
    const overdue = [];
    const returned = [];
    sourcingOrders.forEach((o) => {
      if (o.comms_return_status === "Returned") {
        returned.push(o);
        return;
      }
      const rd = o.comms_outfit_return_date ? new Date(o.comms_outfit_return_date) : null;
      if (rd && rd < now) overdue.push(o);
      else pending.push(o);
    });
    // Sort each: pending ascending by return date (soonest first),
    // overdue ascending (longest-overdue first), returned descending by approved_at/created_at.
    pending.sort((a, b) => new Date(a.comms_outfit_return_date || 0) - new Date(b.comms_outfit_return_date || 0));
    overdue.sort((a, b) => new Date(a.comms_outfit_return_date || 0) - new Date(b.comms_outfit_return_date || 0));
    returned.sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
    return { pending, overdue, returned };
  }, [sourcingOrders, now]);

  // Search across all three buckets (order no / client). The bucket split
  // itself already acts as the status filter.
  const [search, setSearch] = useState("");
  const filteredBuckets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return buckets;
    const match = (o) =>
      (o.order_no || "").toLowerCase().includes(q) ||
      (o.delivery_name || "").toLowerCase().includes(q);
    return {
      pending: buckets.pending.filter(match),
      overdue: buckets.overdue.filter(match),
      returned: buckets.returned.filter(match),
    };
  }, [buckets, search]);

  // Modal state
  const [returnModal, setReturnModal] = useState(null); // { order }
  const [returnCondition, setReturnCondition] = useState("Perfect");
  const [returnLocation, setReturnLocation] = useState("Delhi store");
  const [returnLocationOther, setReturnLocationOther] = useState("");
  const [returnConditionOther, setReturnConditionOther] = useState("");
  const [returnDamageNotes, setReturnDamageNotes] = useState("");
  const [processing, setProcessing] = useState(false);

  const openReturnModal = (order) => {
    setReturnCondition("Perfect");
    setReturnLocation("Delhi store");
    setReturnLocationOther("");
    setReturnConditionOther("");
    setReturnDamageNotes("");
    setReturnModal({ order });
  };

  const closeReturnModal = () => {
    if (processing) return;
    setReturnModal(null);
  };

  const handleSubmitReturn = async () => {
    if (!returnModal) return;
    const { order } = returnModal;

    // Validation
    if (returnLocation === "Others" && !returnLocationOther.trim()) {
      showPopup({ title: "Required", message: "Please specify the new product location.", type: "warning" });
      return;
    }
    if (returnCondition === "Others" && !returnConditionOther.trim()) {
      showPopup({ title: "Required", message: "Please describe the condition.", type: "warning" });
      return;
    }
    if ((returnCondition === "Minor damage" || returnCondition === "Major damage" || returnCondition === "Missing component") && !returnDamageNotes.trim()) {
      showPopup({ title: "Required", message: "Please describe the damage / missing component in the notes.", type: "warning" });
      return;
    }

    setProcessing(true);
    try {
      const finalCondition = returnCondition === "Others" ? returnConditionOther.trim() : returnCondition;
      const finalLocation = returnLocation === "Others" ? returnLocationOther.trim() : returnLocation;

      // 1) Update the order row with return details
      const { data: updated, error: updateErr } = await supabase
        .from("orders")
        .update({
          comms_return_status: "Returned",
          comms_return_condition: finalCondition,
          comms_return_new_location: finalLocation,
          comms_return_damage_notes: returnDamageNotes.trim() || null,
        })
        .eq("id", order.id)
        .select()
        .single();
      if (updateErr) throw updateErr;

      // 2) Increment inventory back for each item.
      // Only when the item came back in usable condition. For "Major damage"
      // and "Missing component", the piece can't be sold again — don't add
      // it back to live inventory. Nazreen / inventory team handles those
      // out-of-band (write-off, repair queue, etc.).
      const isReusable = finalCondition === "Perfect" || finalCondition === "Minor damage";
      if (isReusable) {
        try {
          for (const item of (order.items || [])) {
            if (!item.product_id) continue;
            const quantityReturned = item.quantity || 1;
            if (item.sync_enabled) {
              // LXRTS / Shopify-synced — variant-level inventory
              const { data: variants } = await supabase
                .from("product_variants")
                .select("id, inventory, size")
                .eq("product_id", item.product_id)
                .eq("size", item.size)
                .limit(1);
              if (variants && variants.length > 0) {
                const variant = variants[0];
                const newInventory = (variant.inventory || 0) + quantityReturned;
                await supabase
                  .from("product_variants")
                  .update({ inventory: newInventory })
                  .eq("id", variant.id);
              }
            } else {
              const { data: productData } = await supabase
                .from("products")
                .select("inventory")
                .eq("id", item.product_id)
                .single();
              if (productData) {
                const newInventory = (productData.inventory || 0) + quantityReturned;
                await supabase
                  .from("products")
                  .update({ inventory: newInventory })
                  .eq("id", item.product_id);
              }
            }
          }
        } catch (invErr) {
          console.warn("Comms inventory increment failed (non-blocking):", invErr);
        }
      }

      onOrderUpdated(updated);
      setReturnModal(null);
      showPopup({
        title: "Return recorded",
        message: isReusable
          ? `Order ${order.order_no} marked as Returned. Inventory updated.`
          : `Order ${order.order_no} marked as Returned. Inventory NOT incremented because the condition is ${finalCondition} — handle write-off separately.`,
        type: "success",
        confirmText: "OK",
      });
    } catch (err) {
      console.error("Sourcing return failed:", err);
      showPopup({
        title: "Failed to record return",
        message: err.message || "Could not update the order. Please try again.",
        type: "error",
        confirmText: "OK",
      });
    } finally {
      setProcessing(false);
    }
  };

  const renderTable = (rows, kind) => (
    <table className="comms-table">
      <thead>
        <tr>
          <th>Order No</th>
          <th>Client</th>
          <th>Return Date</th>
          {kind === "returned" && <th>Condition</th>}
          {kind === "returned" && <th>New Location</th>}
          <th>Items</th>
          {kind !== "returned" && <th>Action</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => (
          <tr key={o.id}>
            <td><span className="comms-mono">{o.order_no || "—"}</span></td>
            <td>{o.delivery_name || "—"}</td>
            <td>{o.comms_outfit_return_date ? formatDate(o.comms_outfit_return_date) : "—"}</td>
            {kind === "returned" && <td>{o.comms_return_condition || "—"}</td>}
            {kind === "returned" && <td>{o.comms_return_new_location || "—"}</td>}
            <td>{(o.items || []).length}</td>
            {kind !== "returned" && (
              <td>
                <button
                  onClick={() => openReturnModal(o)}
                  style={{
                    background: "#2e7d32", color: "#fff", border: "none",
                    borderRadius: 6, padding: "5px 12px", fontSize: 12,
                    fontWeight: 600, cursor: "pointer",
                  }}
                >Mark Returned</button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      {sourcingOrders.length === 0 && (
        <div className="comms-card">
          <p className="comms-muted">No sourcing orders yet. They appear here when an order's engagement type is Sourcing.</p>
        </div>
      )}

      {sourcingOrders.length > 0 && (
        <div className="comms-card">
          <input
            type="text"
            className="comms-search"
            placeholder="Search order no or client..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {sourcingOrders.length > 0 &&
        filteredBuckets.overdue.length === 0 &&
        filteredBuckets.pending.length === 0 &&
        filteredBuckets.returned.length === 0 && (
        <div className="comms-card">
          <p className="comms-muted">No sourcing orders match your search.</p>
        </div>
      )}

      {filteredBuckets.overdue.length > 0 && (
        <div className="comms-card">
          <h3 className="comms-card-title">
            Overdue
            <span style={{ color: "#c62828", marginLeft: 8 }}>({filteredBuckets.overdue.length})</span>
          </h3>
          {renderTable(filteredBuckets.overdue, "overdue")}
        </div>
      )}

      {filteredBuckets.pending.length > 0 && (
        <div className="comms-card">
          <h3 className="comms-card-title">
            Pending Return
            <span style={{ color: "#ef6c00", marginLeft: 8 }}>({filteredBuckets.pending.length})</span>
          </h3>
          {renderTable(filteredBuckets.pending, "pending")}
        </div>
      )}

      {filteredBuckets.returned.length > 0 && (
        <div className="comms-card">
          <h3 className="comms-card-title">
            Returned
            <span style={{ color: "#2e7d32", marginLeft: 8 }}>({filteredBuckets.returned.length})</span>
          </h3>
          {renderTable(filteredBuckets.returned, "returned")}
        </div>
      )}

      {/* Return modal */}
      {returnModal && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
          }}
          onClick={closeReturnModal}
        >
          <div
            style={{
              background: "#fff", borderRadius: 12, padding: 24,
              width: "92%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, color: "#2e7d32" }}>Mark Sourcing Order as Returned</h3>
            <p style={{ fontSize: 13, color: "#555", lineHeight: 1.5 }}>
              <strong>Order:</strong> {returnModal.order.order_no}<br />
              <strong>Client:</strong> {returnModal.order.delivery_name || "—"}<br />
              <strong>Items:</strong> {(returnModal.order.items || []).length}
            </p>

            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "#555", display: "block", marginBottom: 6 }}>
                Return Condition <span style={{ color: "#c62828" }}>*</span>
              </label>
              <select
                value={returnCondition}
                onChange={(e) => setReturnCondition(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", border: "1px solid #d4d4d4", borderRadius: 6, fontSize: 13 }}
              >
                {RETURN_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {returnCondition === "Others" && (
                <input
                  type="text"
                  placeholder="Specify condition"
                  value={returnConditionOther}
                  onChange={(e) => setReturnConditionOther(e.target.value)}
                  style={{ marginTop: 6, width: "100%", padding: "8px 10px", border: "1px solid #d4d4d4", borderRadius: 6, fontSize: 13 }}
                />
              )}
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "#555", display: "block", marginBottom: 6 }}>
                New Product Location <span style={{ color: "#c62828" }}>*</span>
              </label>
              <select
                value={returnLocation}
                onChange={(e) => setReturnLocation(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", border: "1px solid #d4d4d4", borderRadius: 6, fontSize: 13 }}
              >
                {NEW_LOCATION_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              {returnLocation === "Others" && (
                <input
                  type="text"
                  placeholder="Specify location"
                  value={returnLocationOther}
                  onChange={(e) => setReturnLocationOther(e.target.value)}
                  style={{ marginTop: 6, width: "100%", padding: "8px 10px", border: "1px solid #d4d4d4", borderRadius: 6, fontSize: 13 }}
                />
              )}
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "#555", display: "block", marginBottom: 6 }}>
                Notes {(returnCondition === "Minor damage" || returnCondition === "Major damage" || returnCondition === "Missing component") && <span style={{ color: "#c62828" }}>*</span>}
              </label>
              <textarea
                rows={3}
                placeholder={returnCondition === "Perfect" ? "Optional notes…" : "Describe the damage or missing component"}
                value={returnDamageNotes}
                onChange={(e) => setReturnDamageNotes(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", border: "1px solid #d4d4d4", borderRadius: 6, fontSize: 13, resize: "vertical" }}
              />
            </div>

            {(returnCondition === "Major damage" || returnCondition === "Missing component") && (
              <p style={{ fontSize: 12, color: "#c62828", marginTop: 10, lineHeight: 1.4 }}>
                Inventory will NOT be incremented because the item isn't reusable. Handle write-off separately.
              </p>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
              <button
                disabled={processing}
                onClick={closeReturnModal}
                style={{ padding: "8px 16px", border: "1px solid #d4d4d4", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 13 }}
              >Cancel</button>
              <button
                disabled={processing}
                onClick={handleSubmitReturn}
                style={{
                  padding: "8px 16px", border: "none", borderRadius: 6, color: "#fff",
                  background: "#2e7d32",
                  cursor: processing ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600,
                  opacity: processing ? 0.6 : 1,
                }}
              >{processing ? "Saving…" : "Confirm Return"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
