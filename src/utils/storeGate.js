// ============================================================
// Store Gate (Release 22) — the guard at each store's gate scans
// pieces IN (from the warehouse / back from a customer) and OUT
// (delivered to the customer / back to the warehouse for work).
//
// Mirrors db/meeting_points/r22_01_store_gate.sql. All writes go
// through the store_gate_scan RPC (all-or-nothing, never blocks:
// unusual scans are accepted and flagged). Only warehouse -> store
// orders pass a store gate; courier orders never do.
// ============================================================
import { supabase } from "../lib/supabaseClient";

export const GATE_EVENTS = {
  in_from_warehouse: "Received at store",
  in_from_customer: "Received from customer",
  out_delivered: "Delivered to customer",
  out_to_warehouse: "Sent to warehouse",
};

export const GATE_REASONS = ["Alteration", "Repair / fix", "Size issue", "Other"];

export const GATE_FLAGS = {
  not_dispatched: "Not dispatched by warehouse",
  not_store_order: "Not a store-pickup order",
  other_store: "Belongs to the other store",
  no_in_scan: "Never scanned in",
  balance_due: "Left with balance due",
  not_in_store: "Was sent to warehouse",
  not_delivered_before: "Was never delivered",
};

const IN_EVENTS = ["in_from_warehouse", "in_from_customer"];

/** Where a piece is now, in words, from its latest gate event. */
export function pieceWhere(piece) {
  if (!piece?.gate_event) return piece?.dispatched ? "Dispatched by warehouse" : "Not dispatched yet";
  const label = GATE_EVENTS[piece.gate_event] || piece.gate_event;
  return piece.gate_store ? `${label} · ${piece.gate_store}` : label;
}

/**
 * The actions that make sense for the selected pieces, most likely first.
 * Nothing is ever hidden for being "wrong" — the server accepts and flags —
 * but the obvious next step is offered first so the guard rarely has to think.
 */
export function gateActions(pieces = []) {
  if (pieces.length === 0) return [];
  const events = pieces.map((p) => p.gate_event || null);
  const all = (fn) => events.every(fn);

  if (all((e) => IN_EVENTS.includes(e))) return ["out_delivered", "out_to_warehouse"];
  if (all((e) => e === "out_delivered")) return ["in_from_customer", "out_to_warehouse"];
  if (all((e) => e === null || e === "out_to_warehouse")) return ["in_from_warehouse", "out_delivered", "out_to_warehouse"];
  // a mix (e.g. part of the order already handed over): offer everything
  return ["in_from_warehouse", "out_delivered", "out_to_warehouse", "in_from_customer"];
}

export async function gateLookup(code) {
  const { data, error } = await supabase.rpc("store_gate_lookup", { p_code: code });
  if (error) throw error;
  return data;
}

export async function gateScan(componentIds, event, reason = null, note = null) {
  const { data, error } = await supabase.rpc("store_gate_scan", {
    p_component_ids: componentIds,
    p_event: event,
    p_reason: reason,
    p_note: note,
  });
  if (error) throw error;
  return data;
}

export async function gateDashboard() {
  const { data, error } = await supabase.rpc("store_gate_dashboard");
  if (error) throw error;
  return data;
}

/** An order's gate history (read-only; any logged-in user). [] if none / not set up yet. */
export async function fetchOrderGateEvents(orderId) {
  const { data, error } = await supabase
    .from("store_gate_events")
    .select("barcode, store, event, reason, note, flags, marked_delivered, scanned_by, scanned_at")
    .eq("order_id", orderId)
    .order("scanned_at", { ascending: true });
  if (error) return []; // table not created yet (SQL not run) → nothing to show
  return data || [];
}
