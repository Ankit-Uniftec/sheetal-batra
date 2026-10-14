import { supabase } from "../lib/supabaseClient";
import config from "../config/config";
import { NOTIFICATION_TYPES, sendNotification } from "./notificationService";

// ============================================================
// Saving a garment-breakdown correction (meeting point 8, Release 11).
// utils/breakdownChange.js works out the plan; this file loads what the plan
// needs, saves it through the database (change_line_breakdown, db r11_01 —
// one atomic step that re-checks every piece) and re-maps the order so any
// genuinely new barcode is minted, exactly as choosing a breakdown always has.
// ============================================================

/** The order's pieces and the ids already packed in a live box. */
export async function fetchLinePieces(orderId) {
  const [compsRes, shipRes] = await Promise.all([
    supabase.from("order_components")
      .select("id, order_id, barcode, component_type, component_label, item_index, extra_index, current_stage, is_active, is_outside_wh, vendor_name, cancelled_at")
      .eq("order_id", orderId),
    supabase.from("shipments").select("status, shipment_components(component_id)").eq("order_id", orderId),
  ]);
  if (compsRes.error) throw compsRes.error;
  const packedIds = new Set();
  (shipRes.data || []).forEach((s) => {
    if (["cancelled", "returned"].includes(String(s.status || "").toLowerCase())) return;
    (s.shipment_components || []).forEach((sc) => packedIds.add(sc.component_id));
  });
  return { components: compsRes.data || [], packedIds };
}

/**
 * Re-map ONE order from its stored Shopify snapshot (the sync function's
 * remap-items) — re-derives its items and review state and mints any missing
 * barcode. Throws when the order was not touched (an older deployed function).
 */
export async function remapOrder(orderNo) {
  const res = await fetch(`${config.SUPABASE_URL}/functions/v1/shopify-order-sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.SUPABASE_KEY}` },
    body: JSON.stringify({ mode: "remap-items", orderNo }),
  });
  if (!res.ok) throw new Error(`Re-map failed (${res.status})`);
  const out = await res.json().catch(() => null);
  if (!(out?.results || []).some((r) => r.order_no === orderNo)) {
    throw new Error("the sync function did not update this order — it may be running an older deployed version");
  }
  return out;
}

/**
 * Save a change.
 * @param {object} p
 * @param {object} p.order        { id, order_no, items }
 * @param {number} p.itemIndex
 * @param {object} p.choice       a BREAKDOWN_CHOICES entry ({ key, label, value })
 * @param {object} p.plan         planBreakdownChange(...)
 * @param {boolean} p.allowStarted  true only from the Breakdown Changes screen
 * @param {string} p.by           the desk's email
 * @param {string} p.reason
 * @returns {Promise<{ success: boolean, message?: string, remapError?: string }>}
 */
export async function saveBreakdownChange({ order, itemIndex, choice, plan, allowStarted, by, reason }) {
  if (!String(reason || "").trim()) return { success: false, message: "A reason is required." };
  const { data, error } = await supabase.rpc("change_line_breakdown", {
    p_order_id: order.id,
    p_item_index: itemIndex,
    p_entry: choice.value,
    p_convert: plan.convert.map(({ from, to }) => ({
      id: from.id,
      new_barcode: to.barcode,
      new_type: to.component_type,
      new_label: to.component_label,
      new_extra_index: to.extra_index ?? null,
    })),
    p_remove: plan.remove.map((p) => p.id),
    p_retire: plan.retire.map((p) => p.id),
    p_add: plan.add.map((p) => p.barcode),
    p_allow_started: !!allowStarted,
    p_by: by || null,
    p_reason: reason.trim(),
  });
  if (error) return { success: false, message: error.message };
  if (!data?.success) return { success: false, message: data?.message || "The change was refused." };

  // Production is told when pieces that already started are affected.
  if (data.after_start) notifyProduction(order, itemIndex, choice, plan, by, reason).catch(() => {});

  // New barcodes (plan.add) come from the usual re-map. The change itself is
  // already saved; a re-map failure is reported, never undone.
  try {
    await remapOrder(order.order_no);
  } catch (err) {
    return { success: true, remapError: err.message };
  }
  return { success: true };
}

async function notifyProduction(order, itemIndex, choice, plan, by, reason) {
  let headEmail = null;
  try {
    const { data } = await supabase.rpc("get_production_head_email", { p_order_id: order.id });
    headEmail = data || null;
  } catch { /* the PM still gets it */ }
  await sendNotification(NOTIFICATION_TYPES.BREAKDOWN_CHANGED, {
    orderId: order.id,
    orderNo: order.order_no,
    metadata: {
      product_name: order.items?.[itemIndex]?.product_name || "",
      to_label: choice.label,
      retired: plan.retire.map((p) => p.barcode).join(", "),
      converted: plan.convert.map(({ from, to }) => `${from.barcode} → ${to.barcode}`).join(", "),
      reason: String(reason || "").trim(),
      changed_by: by,
    },
    extraRecipients: headEmail ? [{ email: String(headEmail).toLowerCase(), channel: "in_app" }] : [],
  });
}

/** The change log, newest first (Breakdown Changes screen). */
export async function listBreakdownChanges({ from, to, afterStartOnly } = {}) {
  let q = supabase.from("breakdown_changes")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (from) q = q.gte("created_at", from);
  if (to) q = q.lte("created_at", to);
  if (afterStartOnly) q = q.eq("after_start", true);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
