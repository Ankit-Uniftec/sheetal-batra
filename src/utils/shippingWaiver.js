import { supabase } from "../lib/supabaseClient";

/**
 * SBFREESHIP log (Release 18). Records who waived an order's international
 * shipping charge and why, in public.shipping_waivers
 * (db/meeting_points/r18_01).
 *
 * Called AFTER the order is saved. It NEVER throws and never blocks: the waiver
 * itself is already on the order (shipping_charge = 0), so a failed log write —
 * network, RLS, or the table not existing yet — is only reported in the console.
 */
export async function logShippingWaiver(order, waiver, by) {
  if (!order?.id || !waiver?.reason) return false;
  try {
    const { error } = await supabase.from("shipping_waivers").insert({
      order_id: order.id,
      order_no: order.order_no || null,
      code: waiver.code,
      amount: Number(waiver.amount) || 0,
      reason: String(waiver.reason).trim(),
      waived_by: by || null,
    });
    if (error) {
      console.error("Shipping waiver log not saved (order is fine):", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Shipping waiver log not saved (order is fine):", err);
    return false;
  }
}
