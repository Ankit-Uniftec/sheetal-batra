import { supabase } from "../lib/supabaseClient";

// ============================================================
// SB WH Delhi (1) / SB WH Delhi (2) — meeting points 28 + 29 (Release 6).
//
// SB WH Delhi (2) is our own second floor (Stitching / Hemming / Final QC), not
// a vendor. A trip there runs through two gates:
//   SB WH Delhi (1) guard EXIT → SB WH Delhi (2) guard ENTRY ("Arrived")
//   → scans at SB WH Delhi (2) → SB WH Delhi (2) guard EXIT ("Left")
//   → SB WH Delhi (1) guard ENTRY.
// The rules live in the database (db/meeting_points/r6_01_factory2.sql); this
// file only tells the gate screen which of the four scans a guard is making,
// and labels scans for View Journey.
//
// Every warehouse/scan login carries salesperson.factory — like an SA's store.
// Before the SQL is run the column does not exist; every read here then falls
// back to "no factory", which is exactly today's behaviour.
// ============================================================

export const WH1 = "SB WH Delhi (1)";
export const WH2 = "SB WH Delhi (2)";

/** The login's warehouse, or null (unassigned / column not there yet). */
export async function fetchMyFactory(email) {
  if (!email) return null;
  const { data, error } = await supabase
    .from("salesperson").select("factory").eq("email", email.toLowerCase()).maybeSingle();
  if (error) return null;
  return data?.factory || null;
}

/** The piece's open SB WH Delhi (2) trip, or null. */
export async function fetchOpenFactory2Trip(componentId) {
  const { data, error } = await supabase
    .from("external_movements")
    .select("id, stages_outside, f2_arrived_at, f2_left_at")
    .eq("component_id", componentId)
    .eq("status", "exited")
    .eq("is_factory2", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

/**
 * Which gate scan this is.
 * @returns {{ scanType: "entry"|"exit", leg: "f2_arrival"|"f2_departure"|null }}
 *   leg = an SB WH Delhi (2) guard scan; null = an ordinary gate exit/entry.
 */
export function gateLeg({ isOutside, myFactory, trip }) {
  if (myFactory === WH2 && isOutside && trip) {
    return trip.f2_arrived_at && !trip.f2_left_at
      ? { scanType: "exit", leg: "f2_departure" }
      : { scanType: "entry", leg: "f2_arrival" };
  }
  return { scanType: isOutside ? "entry" : "exit", leg: null };
}

/** The transition_type a gate scan writes — the 30-minute duplicate guard keys on it. */
export const gateTransitionType = ({ scanType, leg }) =>
  leg || (scanType === "exit" ? "security_exit" : "security_entry");

/** Badge text for a scan row's warehouse — the same names as the vendor list — or "". */
export const factoryBadge = (factory) => (factory === WH1 || factory === WH2 ? factory : "");
