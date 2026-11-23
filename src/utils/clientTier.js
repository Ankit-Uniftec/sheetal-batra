import { supabase } from "../lib/supabaseClient";

// ============================================================
// Collectors Circle tiers (Release 39, client policy of 18 Nov 2026).
//
// Worked out by the database (client_tiers, db r39_18): eligible MRP spend
// over the last 12 months, pooled across the client's accounts with the same
// phone number. Levels come from the loyalty_tiers table, so this file holds
// no thresholds. Until that SQL has run, every lookup returns nothing and the
// screens simply show no tier.
// ============================================================

const CHUNK = 200;

/**
 * @param {string[]} profileIds client account ids
 * @returns {Promise<Object<string, {spend, tierCode, tierName, nextTierName, toNext, orders}>>}
 */
export async function fetchClientTiers(profileIds) {
  const ids = [...new Set((profileIds || []).filter(Boolean))];
  const out = {};
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase.rpc("client_tiers", { p_profile_ids: ids.slice(i, i + CHUNK) });
    if (error) {
      // Not installed yet, or no access: show no tier rather than an error.
      console.warn("client_tiers unavailable:", error.message);
      return out;
    }
    (data || []).forEach((r) => {
      out[r.profile_id] = {
        spend: Number(r.spend_12m) || 0,
        tierCode: r.tier_code,
        tierName: r.tier_name,
        nextTierName: r.next_tier_name,
        toNext: r.to_next_tier == null ? null : Number(r.to_next_tier),
        orders: r.orders_12m || 0,
      };
    });
  }
  return out;
}

/** Shorter label for tight spaces ("The Patron" -> "Patron"). */
export const tierShortName = (name) => String(name || "").replace(/^The\s+/i, "").replace(/\s+Member$/i, "");
