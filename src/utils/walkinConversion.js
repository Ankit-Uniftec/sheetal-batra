import { supabase } from "../lib/supabaseClient";

// ============================================================
// Walk-in conversion logic — shared by the SA WalkInTab and the
// Admin dashboard Walk-Ins tab so both compute it identically.
//
// A walk-in "converts" when that visitor later places an order.
// Two inputs decide the effective status, manual ALWAYS winning:
//   - auto:   does any order's delivery_phone match this walk-in's phone?
//   - manual: converted_manual (true/false) forced by an SA/admin; NULL = follow auto
//
//   effective = converted_manual ?? autoMatch
// ============================================================

/** Strip everything but digits, then drop a leading country-code-ish prefix
 *  so "+91 98xxxx", "098xxxx" and "98xxxx" all compare equal. We compare on
 *  the last 10 digits, which is the stable part of an Indian mobile number. */
export const normalizePhone = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};

/** Build a Set of normalized phones from a list of orders' delivery_phone. */
export const buildOrderPhoneSet = (orders) => {
  const set = new Set();
  (orders || []).forEach((o) => {
    const p = normalizePhone(o.delivery_phone);
    if (p.length >= 6) set.add(p);
  });
  return set;
};

/** Auto-match: is this walk-in's phone present in the order-phone set? */
export const isAutoConverted = (walkin, orderPhoneSet) => {
  const p = normalizePhone(walkin?.phone);
  return p.length >= 6 && orderPhoneSet.has(p);
};

/** Effective converted status — manual override wins over auto. */
export const effectiveConverted = (walkin, orderPhoneSet) => {
  if (walkin?.converted_manual === true) return true;
  if (walkin?.converted_manual === false) return false;
  return isAutoConverted(walkin, orderPhoneSet);
};

/** Whether the effective status came from a human override vs auto-detection. */
export const conversionSource = (walkin) =>
  walkin?.converted_manual === true || walkin?.converted_manual === false ? "manual" : "auto";

/**
 * Reconcile auto-matches with the DB. For any walk-in whose stored `converted`
 * disagrees with the freshly computed effective status (and which is NOT under a
 * manual override that already matches), write the corrected value back so
 * exports, filters and other users stay accurate.
 *
 * Returns the walk-ins array with up-to-date `converted` values applied in memory,
 * regardless of whether the DB writes succeed.
 */
export const reconcileConversions = async (walkins, orderPhoneSet) => {
  const updates = [];
  const next = (walkins || []).map((w) => {
    const eff = effectiveConverted(w, orderPhoneSet);
    if (eff !== !!w.converted) {
      // Only persist auto-driven flips here; manual flips are written by the
      // toggle handler at the moment the user clicks. But if a manual override
      // exists, `eff` already reflects it, so persisting keeps the row honest.
      updates.push({
        id: w.id,
        converted: eff,
        converted_at: eff ? (w.converted_at || new Date().toISOString()) : null,
      });
      return { ...w, converted: eff, converted_at: eff ? (w.converted_at || new Date().toISOString()) : null };
    }
    return w;
  });

  // Persist each changed row. Kept as individual updates (small N) so one
  // failure doesn't block the rest; errors are logged, not thrown.
  for (const u of updates) {
    const { error } = await supabase
      .from("walkins")
      .update({ converted: u.converted, converted_at: u.converted_at })
      .eq("id", u.id);
    if (error) console.error("walkin conversion sync failed:", u.id, error);
  }

  return next;
};

/**
 * Apply a manual override and persist it. `value` is true (force converted),
 * false (force not-converted), or null (clear override → follow auto again).
 * Returns the updated row fields to merge into local state.
 */
export const setManualConversion = async (walkinId, value, autoMatch) => {
  // Effective status after this override resolves.
  const eff = value === true ? true : value === false ? false : autoMatch;
  const patch = {
    converted_manual: value,
    converted: eff,
    converted_at: eff ? new Date().toISOString() : null,
  };
  const { error } = await supabase
    .from("walkins")
    .update(patch)
    .eq("id", walkinId);
  if (error) {
    console.error("walkin manual conversion update failed:", walkinId, error);
    throw error;
  }
  return patch;
};
