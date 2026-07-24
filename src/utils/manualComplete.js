import { supabase } from "../lib/supabaseClient";

// ============================================================
// Mark as Completed — shared caller for the manual_complete_order RPC.
//
// Final QC is mandatory: the RPC refuses (FINAL_QC_REQUIRED) while any active
// piece of the chosen product is short of it. ONLY the Production Manager may
// override that and complete the product anyway — the RPC's p_override
// argument (migration 49). Everyone else (retail PH, B2B PH, B2B
// merchandiser) can Mark as Completed only once Final QC has actually passed;
// for them the block is terminal and surfaces as an error.
//
// Four dashboards do this identically (PM, retail PH, B2B PH, B2B
// merchandiser), so the retry-with-override handshake lives here once instead
// of being re-implemented — and re-diverging — in each of them. The single
// allowOverride flag is what separates the PM from the rest, so the rule
// lives in one place and can't drift per dashboard.
// ============================================================

// One RPC call. Returns the raw jsonb payload; throws on a transport error.
async function callRpc(orderId, by, itemIndex, override) {
  const { data, error } = await supabase.rpc("manual_complete_order", {
    p_order_id: orderId,
    p_by: by,
    p_item_index: itemIndex,
    p_override: override,
  });
  if (error) throw new Error(error.message);
  return data;
}

// Human-readable list of the pieces blocking completion, for the confirm body.
export function describeBlocking(blocking = []) {
  return blocking
    .map((b) => {
      const label = b.component_label || b.barcode || "piece";
      if (b.vendor_name) return `• ${label} — at vendor: ${b.vendor_name}`;
      const stage = (b.current_stage || "").replace(/_/g, " ");
      return `• ${label} (${b.barcode}) — ${stage || "not started"}`;
    })
    .join("\n");
}

/**
 * Run Mark as Completed over the picked products, offering the Final QC
 * override when the RPC blocks on it — but only when allowOverride is true.
 *
 * Scopes are looped one product at a time (null = the whole order), exactly as
 * each dashboard did before. If a scope comes back FINAL_QC_REQUIRED and the
 * caller is allowed to override, we ask `confirmOverride` — showing which
 * pieces are short — and, on yes, re-run that same scope with p_override=true.
 * On no, the whole run stops: completing some products and silently skipping
 * others would be a worse outcome than doing nothing.
 *
 * When allowOverride is false (everyone except the Production Manager), a
 * FINAL_QC_REQUIRED block is terminal — it throws the RPC's message so the
 * caller shows "Final QC not done yet" instead of an override prompt.
 *
 * COMPONENT_OUTSIDE_WH is never overridable (can_override=false) — a piece
 * sitting at a vendor has to come back through the Security Gate first.
 *
 * @param {object}   opts
 * @param {string}   opts.orderId
 * @param {string}   opts.by                       PH/PM email, for the audit trail
 * @param {number[]|null} opts.picked              item indexes, or null for the whole order
 * @param {boolean}  opts.allowOverride            true only for the Production Manager
 * @param {function} opts.confirmOverride          async ({ blocking, message, itemIndex }) => boolean (only called when allowOverride)
 * @returns {Promise<{ok: boolean, cancelled: boolean, last: object|null, overridden: number}>}
 */
export async function runManualCompleteWithOverride({ orderId, by, picked, allowOverride = false, confirmOverride }) {
  const scopes = picked === null || picked === undefined ? [null] : picked;
  let last = null;
  let overridden = 0;

  for (const idx of scopes) {
    let data = await callRpc(orderId, by, idx, false);

    if (data?.success === false) {
      // Only the Final QC gate is overridable, only when the RPC says so, and
      // only for a caller cleared to override (the Production Manager). For
      // everyone else the block is terminal — surface the message as-is.
      if (data.error !== "FINAL_QC_REQUIRED" || data.can_override !== true || !allowOverride) {
        throw new Error(data.message || "Could not complete the order.");
      }

      const ok = await confirmOverride({
        blocking: data.blocking || [],
        message: data.message,
        itemIndex: idx,
      });
      if (!ok) return { ok: false, cancelled: true, last, overridden };

      data = await callRpc(orderId, by, idx, true);
      if (data?.success === false) {
        throw new Error(data.message || "Could not complete the order.");
      }
    }

    overridden += Number(data?.components_overridden || 0);
    last = data;
  }

  return { ok: true, cancelled: false, last, overridden };
}
