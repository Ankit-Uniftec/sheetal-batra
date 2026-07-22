import { supabase } from "../lib/supabaseClient";
import { fetchAllRows } from "./fetchAllRows";

/**
 * BarcodeService
 * 
 * All Supabase interactions for the barcode tracking system.
 * Each function calls an RPC (database function) which runs atomically —
 * no partial updates, no data loss.
 */

// ============================================================
// STAGE DEFINITIONS (mirrors the database enum)
// ============================================================
// V2 model: 10 logical stages. `step` = logical step (1..10), matching the
// DB get_stage_step(). `mandatory: true` = always required; otherwise the
// stage is skippable (Dyeing, Pattern Cutting, and QC 1). Dry Cleaning is now
// MANDATORY (client rule). Two QCs: the existing qc_* values are QC 1 (after
// Embroidery), OPTIONAL — a piece may go Embroidery -> Stitching directly;
// final_qc_* are QC 2 (before Packaging), which remains mandatory. The
// authoritative skippable set lives in the DB is_step_skippable(); `mandatory`
// here is descriptive metadata only (not queried in JS).
//
// Stages marked `legacy: true` were removed from the active flow
// (pattern_printing / trims / cutting / finishing) but are KEPT here so
// historical / in-flight components still render with a proper label.
// They never appear as a scan station and are excluded from the new flow.
export const PRODUCTION_STAGES = [
  { value: "order_received", label: "Order Received", step: 0, color: "#9e9e9e", maxDays: 0 },
  { value: "cloth_issued", label: "Cloth Issued", step: 1, color: "#795548", maxDays: 1, mandatory: true },
  { value: "dyeing_in_progress", label: "Dyeing In-Progress", step: 2, color: "#e91e63", maxDays: 1 },
  { value: "dyeing_completed", label: "Dyeing Completed", step: 2, color: "#e91e63" },
  { value: "pattern_cutting_in_progress", label: "Pattern Cutting In-Progress", step: 3, color: "#9c27b0", maxDays: 1 },
  { value: "pattern_cutting_completed", label: "Pattern Cutting Completed", step: 3, color: "#9c27b0" },
  { value: "embroidery_in_progress", label: "Embroidery In-Progress", step: 4, color: "#3f51b5", maxDays: 21, mandatory: true },
  { value: "embroidery_completed", label: "Embroidery Completed", step: 4, color: "#3f51b5", mandatory: true },
  { value: "dry_cleaning_in_progress", label: "Dry Cleaning In-Progress", step: 5, color: "#00bcd4", maxDays: 1, mandatory: true },
  { value: "dry_cleaning_completed", label: "Dry Cleaning Completed", step: 5, color: "#00bcd4", mandatory: true },
  { value: "qc_in_progress", label: "QC 1 In-Progress", step: 6, color: "#f44336", maxDays: 1 },
  { value: "qc_passed", label: "QC 1 Passed", step: 6, color: "#4caf50" },
  { value: "qc_failed", label: "QC 1 Failed", step: 6, color: "#d32f2f" },
  { value: "stitching_in_progress", label: "Stitching In-Progress", step: 7, color: "#ef6c00", maxDays: 2, mandatory: true },
  { value: "stitching_completed", label: "Stitching Completed", step: 7, color: "#ef6c00", mandatory: true },
  { value: "hemming_in_progress", label: "Hemming In-Progress", step: 8, color: "#ff5722", maxDays: 1, mandatory: true },
  { value: "hemming_completed", label: "Hemming Completed", step: 8, color: "#ff5722", mandatory: true },
  { value: "final_qc_in_progress", label: "Final QC In-Progress", step: 9, color: "#c2185b", maxDays: 1, mandatory: true },
  { value: "final_qc_passed", label: "Final QC Passed", step: 9, color: "#388e3c", mandatory: true },
  { value: "final_qc_failed", label: "Final QC Failed", step: 9, color: "#b71c1c", mandatory: true },
  // Set ONLY by "Mark as Completed" (no scan pair). Sits between Final QC and
  // Packaging. Badge reads "Completed"; Packaging & Dispatch requires it.
  { value: "production_complete", label: "Completed", step: 10, color: "#388e3c", mandatory: true },
  { value: "packaging_dispatch", label: "Packaging & Dispatch", step: 10, color: "#2e7d32", maxDays: 1, mandatory: true },
  { value: "dispatched", label: "Dispatched", step: 10, color: "#1b5e20", mandatory: true },
  { value: "disposed", label: "Disposed", step: 0, color: "#424242" },
  { value: "scrapped", label: "Scrapped", step: 0, color: "#616161" },
  // ── Legacy (removed from active flow; kept for historical rendering) ──
  { value: "pattern_printing_in_progress", label: "Pattern Printing In-Progress", step: 0, color: "#673ab7", maxDays: 1, legacy: true },
  { value: "pattern_printing_completed", label: "Pattern Printing Completed", step: 0, color: "#673ab7", legacy: true },
  { value: "trims_in_progress", label: "Trims In-Progress", step: 0, color: "#009688", maxDays: 1, legacy: true },
  { value: "trims_completed", label: "Trims Completed", step: 0, color: "#009688", legacy: true },
  { value: "cutting_in_progress", label: "Cutting In-Progress", step: 0, color: "#ff9800", maxDays: 1, legacy: true },
  { value: "cutting_completed", label: "Cutting Completed", step: 0, color: "#ff9800", legacy: true },
  { value: "cutting_stitching_in_progress", label: "Cutting & Stitching In-Progress", step: 0, color: "#ef6c00", maxDays: 2, legacy: true },
  { value: "cutting_stitching_completed", label: "Cutting & Stitching Completed", step: 0, color: "#ef6c00", legacy: true },
  { value: "finishing_in_progress", label: "Finishing In-Progress", step: 0, color: "#607d8b", maxDays: 1, legacy: true },
  { value: "finishing_completed", label: "Finishing Completed", step: 0, color: "#607d8b", legacy: true },
];

// Stages available for re-journey restart (Production Head dropdown).
// Only active V2 stages — legacy/removed stages are not offered.
export const REJOURNEY_STAGES = [
  { value: "cloth_issued", label: "Cloth Issue" },
  { value: "dyeing_in_progress", label: "Dyeing" },
  { value: "pattern_cutting_in_progress", label: "Pattern Cutting" },
  { value: "embroidery_in_progress", label: "Embroidery" },
  { value: "dry_cleaning_in_progress", label: "Dry Cleaning" },
  { value: "stitching_in_progress", label: "Stitching" },
  { value: "hemming_in_progress", label: "Hemming" },
];

// Scan stations — each maps to the stage it transitions TO. `step` mirrors
// the logical step. QC 1 and Final QC (QC 2) are separate stations.
export const SCAN_STATIONS = [
  { value: "cloth_issue", label: "Cloth Issue", inStage: "cloth_issued", outStage: null, step: 1 },
  { value: "dyeing", label: "Dyeing", inStage: "dyeing_in_progress", outStage: "dyeing_completed", step: 2 },
  { value: "pattern_cutting", label: "Pattern Cutting", inStage: "pattern_cutting_in_progress", outStage: "pattern_cutting_completed", step: 3 },
  { value: "embroidery", label: "Embroidery", inStage: "embroidery_in_progress", outStage: "embroidery_completed", step: 4 },
  { value: "dry_cleaning", label: "Dry Cleaning", inStage: "dry_cleaning_in_progress", outStage: "dry_cleaning_completed", step: 5 },
  { value: "qc", label: "QC 1", inStage: "qc_in_progress", outStage: null, step: 6 },
  { value: "stitching", label: "Stitching", inStage: "stitching_in_progress", outStage: "stitching_completed", step: 7 },
  { value: "hemming", label: "Hemming", inStage: "hemming_in_progress", outStage: "hemming_completed", step: 8 },
  { value: "final_qc", label: "Final QC", inStage: "final_qc_in_progress", outStage: null, step: 9 },
  { value: "packaging", label: "Packaging & Dispatch", inStage: "packaging_dispatch", outStage: null, step: 10 },
  { value: "security_gate", label: "Security Gate", inStage: null, outStage: null, step: 0 },
];

// ============================================================
// STAGE GROUPS — the 10 logical V2 stages, each collapsing its
// in-progress/completed enum values into one group. Used for stage
// filtering and stage-count cards (one entry per logical stage).
// `key` is the group id used by filters; `members` are the raw
// production_stage enum values that map into this group.
// ============================================================
// `external` = pieces can be sent OUT to a vendor for this stage. On the
// always-internal stages (order received, cloth issue, QC, packaging) the
// stage cards hide the in-house/vendor split (there's never a "vendor" count).
export const STAGE_GROUPS = [
  { key: "order_received", label: "Order Received", step: 0, color: "#9e9e9e", external: false, members: ["order_received"] },
  { key: "cloth_issue", label: "Cloth Issue", step: 1, color: "#795548", external: false, members: ["cloth_issued"] },
  { key: "dyeing", label: "Dyeing", step: 2, color: "#e91e63", external: true, members: ["dyeing_in_progress", "dyeing_completed"] },
  { key: "pattern_cutting", label: "Pattern Cutting", step: 3, color: "#9c27b0", external: true, members: ["pattern_cutting_in_progress", "pattern_cutting_completed"] },
  { key: "embroidery", label: "Embroidery", step: 4, color: "#3f51b5", external: true, members: ["embroidery_in_progress", "embroidery_completed"] },
  { key: "dry_cleaning", label: "Dry Cleaning", step: 5, color: "#00bcd4", external: true, members: ["dry_cleaning_in_progress", "dry_cleaning_completed"] },
  { key: "qc1", label: "QC 1", step: 6, color: "#f44336", external: false, members: ["qc_in_progress", "qc_passed", "qc_failed"] },
  { key: "stitching", label: "Stitching", step: 7, color: "#ef6c00", external: true, members: ["stitching_in_progress", "stitching_completed"] },
  { key: "hemming", label: "Hemming", step: 8, color: "#ff5722", external: true, members: ["hemming_in_progress", "hemming_completed"] },
  { key: "final_qc", label: "Final QC", step: 9, color: "#c2185b", external: false, members: ["final_qc_in_progress", "final_qc_passed", "final_qc_failed"] },
  { key: "production_complete", label: "Production Completed", step: 10, color: "#388e3c", external: false, members: ["production_complete"] },
  { key: "packaging", label: "Packaging & Dispatch", step: 10, color: "#2e7d32", external: false, members: ["packaging_dispatch", "dispatched"] },
];

// Map a raw stage value (e.g. "embroidery_completed") to its group key
// (e.g. "embroidery"). Returns null for stages OFF the production flow
// (order_received / disposed / scrapped / legacy). NOTE: order_received is
// intentionally excluded here even though it now has a STAGE_GROUPS entry (for
// the stage cards) — order-LEVEL logic (getStageBucket, order filters) relies
// on this returning null for a not-yet-in-production order. Piece-level card
// bucketing uses classifyComponentForStageCard, which DOES place it.
export function getStageGroupKey(stageValue) {
  if (!stageValue || stageValue === "order_received") return null;
  const g = STAGE_GROUPS.find(grp => grp.members.includes(stageValue));
  return g ? g.key : null;
}

// Map a logical step number (1..10) to its stage group key (e.g. 4 ->
// "embroidery"). Used to bucket an out-at-vendor piece into the stage card
// for the stage it went OUT for (external_movements.stages_outside is steps).
export function getGroupKeyForStep(step) {
  const g = STAGE_GROUPS.find((grp) => grp.step === step);
  return g ? g.key : null;
}


// Which stage-card bucket a single component belongs to, and whether it's an
// INTERNAL (in-house at a stage) or EXTERNAL (out at a vendor) piece. One place
// so every dashboard's split cards agree.
//   comp         the component (needs current_stage, is_outside_wh, stages_outside)
//   orderStatus  optional status of the piece's ORDER. If the order is done
//                (completed/delivered/dispatched/cancelled), the piece counts as
//                Packaging & Dispatch even if its current_stage never advanced
//                (bypass completions leave current_stage stalled).
//   returns { key, kind: 'internal' | 'external' } or null (not on the flow).
// External pieces are bucketed by the EARLIEST stage they went out for.
export function classifyComponentForStageCard(comp, orderStatus) { // eslint-disable-line no-unused-vars
  if (!comp) return null;
  // Bucket by the COMPONENT's own stage. (This used to force every piece of a
  // "completed"/"delivered" order into the packaging bucket — which was needed
  // when completion bypassed the stages. Now completion moves pieces to a real
  // production_complete stage, and dispatch to dispatched, so the piece's own
  // stage is the truth: a production_complete piece shows under Production
  // Completed, a dispatched piece under Packaging & Dispatch.)
  // Card key for a raw stage, INCLUDING order_received (which getStageGroupKey
  // deliberately maps to null for order-level logic; the cards want its bucket).
  const cardKey = (stage) => (stage === "order_received" ? "order_received" : getStageGroupKey(stage));
  if (comp.is_outside_wh) {
    const steps = Array.isArray(comp.stages_outside) ? comp.stages_outside : [];
    const earliest = steps.length ? Math.min(...steps) : null;
    const key = earliest != null ? getGroupKeyForStep(earliest) : null;
    // Fall back to current_stage's group if stages_outside is missing, so the
    // piece still lands somewhere sensible and is still marked external.
    return { key: key || cardKey(comp.current_stage), kind: "external" };
  }
  return { key: cardKey(comp.current_stage), kind: "internal" };
}

// Text color for a stage badge. Stage colors are mid/dark tones, so we use
// white text consistently across all stage badges for a uniform look.
export function getStageTextColor() {
  return "#ffffff";
}

// ============================================================
// Production Head → channel scoping (analytics only)
// ============================================================
// Mirrors db/barcode_system/v2/14_production_head_resolver.sql
// (get_head_designation_for_source): which order channel a Production Head
// "owns", so we can scope their stage cards + overview to their own workload.
// This is for ANALYTICS ONLY — it must NOT be used to hide orders from an
// order-history list (offline heads still look up any order).
//
// Returns the channel key for an order, matching the designation buckets:
//   'comms' | 'b2b' | 'private' | 'exhibition' | 'stock' | 'offline' (= store)
//
// The ORDER NUMBER PREFIX is the authoritative signal — SB-<PREFIX>-MMYY-NNNNNN
// — because it is stamped at placement from the store the order was raised in
// and never drifts afterwards. Flags (is_b2b, is_comms…) and salesperson_store
// are only a fallback for rows with a missing/unknown prefix.
//
// There is deliberately NO "website" channel: LXRTS orders sync from Shopify
// but are PLACED in a store (or B2B, or any channel), so LXRTS is an order
// TYPE, not a channel — such an order badges and reports as whatever channel
// it was placed through. Do not reintroduce a sync_enabled → website rule.
const CHANNEL_BY_ORDER_PREFIX = {
  DLC: "offline",     // Delhi store
  LDHC: "offline",    // Ludhiana store
  EXB: "exhibition",
  PVT: "private",
  B2B: "b2b",
  COM: "comms",
  STOCK: "stock",     // internal stock orders, not a customer channel
};

// "SB-DLC-0726-003625" → "DLC"
export function getOrderPrefix(order) {
  const parts = String(order?.order_no || "").split("-");
  return parts.length > 1 ? parts[1].toUpperCase() : "";
}

// LXRTS is an order TYPE (product synced from Shopify), not a channel — an
// LXRTS order is placed through a store/B2B/etc and reports under that channel.
export const isLxrtsOrder = (order) => order?.items?.[0]?.sync_enabled === true;

// "pending" is legacy for "order_received" — the same state, written by older
// code paths and still sitting in old rows (with mixed casing: "Pending").
// Nothing branches on the difference; every consumer already maps one to the
// other, so normalise once here rather than repeating the ternary at each
// display site (where it kept getting missed — the delivery-report CSV showed
// a raw "Pending" next to "order_received" for identical orders).
export function normalizeOrderStatus(status) {
  const s = (status || "").trim().toLowerCase();
  if (!s || s === "pending") return "order_received";
  return s;
}

// Human label for an order status: "order_received" -> "Order Received".
export function getOrderStatusLabel(status) {
  return normalizeOrderStatus(status)
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Display label for revenue/channel breakdowns — same prefix authority as
// getOrderChannelKey, but the two physical stores split out. Every dashboard's
// channel breakdown must use this so the labels (and the numbers behind them)
// can't drift between screens.
export function getOrderChannelLabel(order) {
  // Stock flag first — see getOrderChannelKey; a stock order raised through a
  // store keeps that store's prefix but must not report as store revenue.
  if (order?.is_stock_order === true) return "Stock";
  const prefix = getOrderPrefix(order);
  if (prefix === "DLC") return "Delhi Store";
  if (prefix === "LDHC") return "Ludhiana Store";
  const key = getOrderChannelKey(order);
  if (key === "b2b") return "B2B";
  if (key === "comms") return "Comms";
  if (key === "private") return "Private";
  if (key === "exhibition") return "Exhibition";
  if (key === "stock") return "Stock";
  // offline with an unknown/missing prefix — try the store name.
  const store = (order?.salesperson_store || "").trim().toLowerCase();
  if (store.includes("delhi")) return "Delhi Store";
  if (store.includes("ludhiana")) return "Ludhiana Store";
  return "Store";
}

// Fixed display order + colors for channel breakdowns, shared app-wide.
export const CHANNEL_SEGMENTS = [
  { label: "Delhi Store", color: "#2e7d32" },
  { label: "Ludhiana Store", color: "#00897b" },
  { label: "B2B", color: "#d5b85a" },
  { label: "Private", color: "#8e24aa" },
  { label: "Comms", color: "#1565c0" },
  { label: "Exhibition", color: "#6d4c41" },
  { label: "Stock", color: "#546e7a" },
  { label: "Store", color: "#2e7d32" }, // offline fallback (unknown prefix)
];

export function getOrderChannelKey(order) {
  if (!order) return null;

  // The stock FLAG outranks the prefix: internal stock is sometimes raised
  // through a store's normal flow, so it carries that store's prefix (e.g.
  // SB-LDHC-…) while being stock. The flag is what dashboards filter on.
  if (order.is_stock_order === true) return "stock";

  const byPrefix = CHANNEL_BY_ORDER_PREFIX[getOrderPrefix(order)];
  if (byPrefix) return byPrefix;

  // Fallback only — order_no missing or an unrecognised prefix.
  const store = (order.salesperson_store || "").trim();
  if (store === "COMMS" || order.is_comms) return "comms";
  if (store === "B2B" || order.is_b2b) return "b2b";
  if (store === "Private" || order.is_private_order) return "private";
  return "offline";
}

// The channel key a Production Head owns, from their designation. Returns null
// for roles that aren't a single-channel head (e.g. Production Manager sees
// all channels — caller should skip scoping when this is null).
export function getChannelKeyForDesignation(designation) {
  const d = (designation || "").trim().toLowerCase();
  if (d === "communications executive") return "comms";
  if (d === "b2b production head") return "b2b";
  if (d === "private sa") return "private";
  // Store + exhibition are one production workload (the offline head owns both).
  if (d === "offline production head") return "offline";
  return null; // not a single-channel head → no scoping
}

// Channels a designation owns. Exhibition is its own channel for badges and
// revenue, but it is not its own production workload — the offline head runs
// store AND exhibition, so scoping must accept both.
const CHANNELS_OWNED_BY_DESIGNATION = {
  offline: ["offline", "exhibition", "stock"],
};

// Filter orders to the channel(s) a designation owns. If the designation isn't
// a single-channel head, returns the list unchanged (no scoping).
//
// The Online Production Head is special: "website" no longer exists as a
// channel, but the warehouse workload split is real — the online head runs the
// LXRTS-TYPE orders (whatever channel they were placed in) and the offline
// head runs the rest of store/exhibition. Scoping by type here keeps exactly
// who-sees-what from before the channel model changed.
export function scopeOrdersToDesignation(orders, designation) {
  if (!Array.isArray(orders)) return [];
  const d = (designation || "").trim().toLowerCase();
  if (d === "online production head") return orders.filter(isLxrtsOrder);

  const channel = getChannelKeyForDesignation(designation);
  if (!channel) return orders;
  const owned = CHANNELS_OWNED_BY_DESIGNATION[channel] || [channel];
  let scoped = orders.filter((o) => owned.includes(getOrderChannelKey(o)));
  // LXRTS-type pieces are the online head's workload, not the offline head's.
  if (channel === "offline") scoped = scoped.filter((o) => !isLxrtsOrder(o));
  return scoped;
}

// ============================================================
// HELPER: Get stage info by value
// ============================================================
export function getStageInfo(stageValue) {
  return PRODUCTION_STAGES.find(s => s.value === stageValue) || null;
}

export function getStageLabel(stageValue) {
  return getStageInfo(stageValue)?.label || stageValue;
}

export function getStageColor(stageValue) {
  return getStageInfo(stageValue)?.color || "#9e9e9e";
}

// Allowed days for a stage (its SLA). Used to derive an expected return/
// due-back date for components sent out to a vendor (exit date + maxDays).
// Returns null when the stage has no defined SLA.
export function getStageMaxDays(stageValue) {
  const d = getStageInfo(stageValue)?.maxDays;
  return typeof d === "number" ? d : null;
}

// Label for a logical STEP number (1..10) — e.g. 2 -> "Dyeing". Used to name
// the stage a component went out to a vendor for (external_movements.stages_outside).
export function getStepLabel(step) {
  return STAGE_GROUPS.find((g) => g.step === step)?.label || null;
}

// Labels for a stages_outside array, e.g. [2] -> "Dyeing", [2,4] -> "Dyeing, Embroidery".
export function getStagesOutsideLabel(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return null;
  const labels = steps.map(getStepLabel).filter(Boolean);
  return labels.length ? labels.join(", ") : null;
}

// ------------------------------------------------------------
// describeTransition — the ONE place that classifies a stage_transitions row
// as an INTERNAL production scan vs an EXTERNAL vendor movement, and builds its
// human headline. Every timeline (journey modal, scan station, overrides) uses
// this so internal/external segregation is identical everywhere.
//
//   t         a stage_transitions row (needs transition_type, from_stage,
//             to_stage, scanned_at)
//   movements optional external_movements[] for this component — lets us name
//             the stage a vendor trip was for ("Sent to Vendor (Dyeing)") by
//             matching the scan time to the movement's exit/entry_scan_at.
//
// Returns { kind: 'internal' | 'external', headline, tagLabel, showType }.
//   kind      drives the Internal (green) / External (orange) tag
//   headline  the primary line ("Cloth Issued → Dyeing" or "Sent to Vendor (Dyeing)")
//   tagLabel  "Internal Scan" | "External / Vendor"
//   showType  whether to append the raw "(manual_override)" etc. suffix
// ------------------------------------------------------------
export function describeTransition(t, movements) {
  const isExit = t.transition_type === "security_exit";
  const isEntry = t.transition_type === "security_entry";
  const external = isExit || isEntry;

  let stageForTrip = null;
  if (external && Array.isArray(movements)) {
    const field = isExit ? "exit_scan_at" : "entry_scan_at";
    const scanTime = new Date(t.scanned_at).getTime();
    const mov = movements
      .filter((m) => m[field])
      .map((m) => ({ m, diff: Math.abs(new Date(m[field]).getTime() - scanTime) }))
      .filter((x) => x.diff < 120000)
      .sort((a, b) => a.diff - b.diff)[0]?.m;
    stageForTrip = mov ? getStagesOutsideLabel(mov.stages_outside) : null;
  }

  const headline = isExit
    ? `Sent to Vendor${stageForTrip ? ` (${stageForTrip})` : ""}`
    : isEntry
      ? `Returned to Warehouse${stageForTrip ? ` (${stageForTrip})` : ""}`
      : `${t.from_stage ? `${getStageLabel(t.from_stage)} → ` : ""}${getStageLabel(t.to_stage)}`;

  return {
    kind: external ? "external" : "internal",
    headline,
    tagLabel: external ? "External / Vendor" : "Internal Scan",
    // only show the raw type suffix for non-scan internal rows (e.g. manual_override)
    showType: !external && t.transition_type && t.transition_type !== "scan",
  };
}

// ============================================================
// 1. ADVANCE STAGE — Main scan handler
// ============================================================
export async function advanceComponentStage(barcode, toStage, scannedBy, stationName = null, notes = null, transitionType = "scan") {
  const { data, error } = await supabase.rpc("advance_component_stage", {
    p_barcode: barcode,
    p_to_stage: toStage,
    p_scanned_by: scannedBy,
    p_station_name: stationName,
    p_notes: notes,
    p_transition_type: transitionType,
  });

  if (error) throw error;
  return data;
}

// ============================================================
// 2. ACTIVATE COMPONENTS — Step 2: Production Head
// ============================================================
export async function activateComponents(componentIds, activatedBy) {
  const { data, error } = await supabase.rpc("activate_components", {
    p_component_ids: componentIds,
    p_activated_by: activatedBy,
  });

  if (error) throw error;
  return data;
}

// ============================================================
// 3. RECORD QC RESULT — Step 12
// ============================================================
export async function recordQcResult({
  barcode,
  result,
  inspectedBy,
  whichQc = "qc1", // "qc1" (after Embroidery) | "final" (before Packaging)
  failReason = null,
  outcome = null,
  rejourneyToStage = null,
  scrapLossAmount = 0,
  scrapLocation = null,
  usableMaterial = null,
  notes = null,
}) {
  const { data, error } = await supabase.rpc("record_qc_result", {
    p_barcode: barcode,
    p_result: result,
    p_inspected_by: inspectedBy,
    p_which_qc: whichQc,
    p_fail_reason: failReason,
    p_outcome: outcome,
    p_rejourney_to_stage: rejourneyToStage,
    p_scrap_loss_amount: scrapLossAmount,
    p_scrap_location: scrapLocation,
    p_usable_material: usableMaterial,
    p_notes: notes,
  });

  if (error) throw error;
  return data;
}

// ============================================================
// 4. SECURITY GUARD SCAN — Steps 3 & 7
// ============================================================
export async function securityGuardScan({
  barcode,
  scanType, // 'exit' or 'entry'
  scannedBy,
  vendorName = null,
  vendorLocation = null,
  notes = null,
}) {
  const { data, error } = await supabase.rpc("security_guard_scan", {
    p_barcode: barcode,
    p_scan_type: scanType,
    p_scanned_by: scannedBy,
    p_vendor_name: vendorName,
    p_vendor_location: vendorLocation,
    p_notes: notes,
  });

  if (error) throw error;
  return data;
}

// ============================================================
// 5. VERIFY PACKAGING — Step 13
// ============================================================
// itemIndex scopes verification to ONE product of a multi-product order, so a
// finished product can ship without waiting for the rest. null = whole order.
export async function verifyPackagingComponents(orderId, scannedBarcodes, itemIndex = null) {
  const { data, error } = await supabase.rpc("verify_packaging_components", {
    p_order_id: orderId,
    p_scanned_barcodes: scannedBarcodes,
    p_item_index: itemIndex,
  });

  if (error) throw error;
  return data;
}

// ============================================================
// 6. FETCH COMPONENTS — Get all components for an order
// ============================================================
export async function fetchOrderComponents(orderId) {
  const { data, error } = await supabase
    .from("order_components")
    .select("*")
    .eq("order_id", orderId)
    .order("component_type", { ascending: true });

  if (error) throw error;
  return data;
}

// ============================================================
// 7. FETCH COMPONENT BY BARCODE — Quick lookup after scan
// ============================================================
export async function fetchComponentByBarcode(barcode) {
  // NOTE: intentionally NOT .single() — that throws PostgREST's cryptic
  // "Cannot coerce the result to a single JSON object" (PGRST116) when the
  // barcode matches 0 rows (wrong/mistyped scan) OR >1 row (a duplicate
  // barcode). Fetch the rows and give the worker a plain-English error instead.
  const { data, error } = await supabase
    .from("order_components")
    .select("*, orders(order_no, delivery_name, delivery_date, salesperson, salesperson_email, status)")
    .eq("barcode", barcode);

  if (error) throw error;
  if (!data || data.length === 0) {
    const e = new Error(`Barcode "${barcode}" was not found. Check the tag and scan again.`);
    e.code = "BARCODE_NOT_FOUND";
    throw e;
  }
  if (data.length > 1) {
    const e = new Error(`Barcode "${barcode}" matches more than one piece — it can't be scanned safely. Report this to the Production Head.`);
    e.code = "BARCODE_DUPLICATE";
    throw e;
  }
  return data[0];
}

// ============================================================
// 8. FETCH TRANSITION HISTORY — Full scan audit trail
// ============================================================
export async function fetchTransitionHistory(componentId) {
  const { data, error } = await supabase
    .from("stage_transitions")
    .select("*")
    .eq("component_id", componentId)
    .order("scanned_at", { ascending: true });

  if (error) throw error;
  return data;
}

// ============================================================
// 9. FETCH QC HISTORY — All QC attempts for a component
// ============================================================
export async function fetchQcHistory(componentId) {
  const { data, error } = await supabase
    .from("qc_records")
    .select("*")
    .eq("component_id", componentId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data;
}

// ============================================================
// 10. GENERATE COMPONENTS FOR ORDER — Called when order is created
// Derives components from order items (top, bottom, dupatta, extras)
// ============================================================
// A garment option is "absent" when it's blank or an explicit not-applicable
// marker. Staff type "NA"/"N/A" for line items that genuinely have no top or
// bottom — a standalone dupatta, for example. Those strings are truthy, so a
// plain `if (item.top)` check used to mint a component for a garment that does
// not physically exist: an unscannable phantom barcode that blocks the order
// (packaging requires every active component to clear Final QC).
const hasGarmentOption = (v) => {
  const s = (v ?? "").toString().trim();
  return s !== "" && !["na", "n/a", "n.a.", "none", "-"].includes(s.toLowerCase());
};

export async function generateOrderComponents(order) {
  const components = [];
  const orderNo = order.order_no;
  // Extract store code from order_no: "SB-DLC-0425-000376" → "DLC"
  const storeCode = orderNo?.split("-")[1] || "SB";

  // Get the sequence number part: last 6 digits
  const seqPart = orderNo?.split("-").pop() || "000000";

  const items = Array.isArray(order.items) ? order.items : [order.items];

  items.forEach((item, itemIndex) => {
    // Does this item name any real garment piece at all? If a line item has an
    // explicit "NA" top AND "NA" bottom (e.g. a standalone dupatta), we must not
    // fall back to product_name for the TOP — that's what created the phantoms.
    // But an item that names no top/bottom at ALL still needs one piece to track,
    // so the product_name fallback stays for that case.
    const namesNoPiece =
      !hasGarmentOption(item?.top) &&
      !hasGarmentOption(item?.bottom) &&
      !item?.includes_dupatta;

    // TOP component — if item has a top option selected
    if (hasGarmentOption(item?.top) || (namesNoPiece && item?.product_name)) {
      components.push({
        order_id: order.id,
        order_no: orderNo,
        barcode: `${storeCode}-${seqPart}-TOP${itemIndex > 0 ? itemIndex + 1 : ""}`,
        component_type: "top",
        component_label: hasGarmentOption(item?.top) ? item.top : (item.product_name || "Top"),
        item_index: itemIndex,
        extra_index: null,
      });
    }

    // BOTTOM component — if item has a bottom option selected
    if (hasGarmentOption(item?.bottom)) {
      components.push({
        order_id: order.id,
        order_no: orderNo,
        barcode: `${storeCode}-${seqPart}-BTM${itemIndex > 0 ? itemIndex + 1 : ""}`,
        component_type: "bottom",
        component_label: item.bottom || "Bottom",
        item_index: itemIndex,
        extra_index: null,
      });
    }

    // DUPATTA component — when the order item is flagged as including a
    // dupatta. `includes_dupatta` is set at order-build time from the
    // product's `has_dupatta` flag (with a staff override toggle). The
    // dupatta then runs the same production flow as the top/bottom.
    if (item?.includes_dupatta) {
      components.push({
        order_id: order.id,
        order_no: orderNo,
        barcode: `${storeCode}-${seqPart}-DUP${itemIndex > 0 ? itemIndex + 1 : ""}`,
        component_type: "dupatta",
        component_label: "Dupatta",
        item_index: itemIndex,
        extra_index: null,
      });
    }

    // EXTRAS — each extra gets its own component
    if (item?.extras && Array.isArray(item.extras)) {
      item.extras.forEach((extra, extraIndex) => {
        components.push({
          order_id: order.id,
          order_no: orderNo,
          barcode: `${storeCode}-${seqPart}-EX${extraIndex + 1}${itemIndex > 0 ? "-" + (itemIndex + 1) : ""}`,
          component_type: "extra",
          component_label: extra.name || `Extra ${extraIndex + 1}`,
          item_index: itemIndex,
          extra_index: extraIndex,
        });
      });
    }
  });

  if (components.length === 0) {
    // Fallback: at minimum create one TOP component
    components.push({
      order_id: order.id,
      order_no: orderNo,
      barcode: `${storeCode}-${seqPart}-TOP`,
      component_type: "top",
      component_label: items[0]?.product_name || "Main Component",
      item_index: 0,
      extra_index: null,
    });
  }

  const { data, error } = await supabase
    .from("order_components")
    .insert(components)
    .select();

  if (error) throw error;
  return data;
}

// ============================================================
// 10b. ENSURE COMPONENTS — idempotent wrapper around generateOrderComponents.
// Safe to call more than once for the same order (e.g. B2B orders whose
// approval can fire from multiple paths, or an edit→re-approve cycle).
// No-ops and returns the existing rows if components already exist.
// ============================================================
export async function ensureOrderComponents(order) {
  const { data: existing, error } = await supabase
    .from("order_components")
    .select("id")
    .eq("order_id", order.id)
    .limit(1);

  if (error) throw error;
  if (existing && existing.length > 0) return existing;

  return generateOrderComponents(order);
}

// ============================================================
// REPLACEMENT JOURNEY (vendor failure) — PH initiates, PM approves
// ============================================================

// Production Head reports a vendor failure and requests a replacement journey.
export async function initiateReplacementJourney({ barcode, failureType, reason, costLoss, requestedBy }) {
  const { data, error } = await supabase.rpc("initiate_replacement_journey", {
    p_barcode: barcode,
    p_failure_type: failureType,
    p_reason: reason,
    p_cost_loss: costLoss,
    p_requested_by: requestedBy,
  });
  if (error) throw error;
  return data;
}

// Pending replacement requests (Production Manager view).
export async function fetchPendingReplacements() {
  const { data, error } = await supabase
    .from("replacement_requests")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function approveReplacementJourney({ requestId, approvedBy }) {
  const { data, error } = await supabase.rpc("approve_replacement_journey", {
    p_request_id: requestId,
    p_approved_by: approvedBy,
  });
  if (error) throw error;
  return data;
}

export async function rejectReplacementJourney({ requestId, approvedBy, reason = null }) {
  const { data, error } = await supabase.rpc("reject_replacement_journey", {
    p_request_id: requestId,
    p_approved_by: approvedBy,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
}

// ============================================================
// FACTORY PAUSE (Manish only) — global freeze of SLA/escalation timers
// ============================================================

// Current pause state: returns the open pause row (resumed_at IS NULL) or null.
export async function fetchFactoryPause() {
  const { data, error } = await supabase
    .from("factory_pause")
    .select("*")
    .is("resumed_at", null)
    .order("paused_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data; // null when not paused
}

// Pause the factory. Caller must be Manish (enforced in UI; pass his email).
export async function pauseFactory({ pausedBy, reason }) {
  const { data, error } = await supabase
    .from("factory_pause")
    .insert({ paused_by: pausedBy, reason })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Resume: close the open pause row.
export async function resumeFactory({ resumedBy }) {
  const { data, error } = await supabase
    .from("factory_pause")
    .update({ resumed_at: new Date().toISOString(), resumed_by: resumedBy })
    .is("resumed_at", null)
    .select();
  if (error) throw error;
  return data;
}

// ============================================================
// EXTERNAL VENDOR / MOVEMENT (Production Head)
// ============================================================

// Approved vendors selectable for external movement
export async function fetchApprovedVendors() {
  const { data, error } = await supabase
    .from("production_vendors")
    .select("id, vendor_name, vendor_location, contact_name, stage_name, stage_number, status")
    .eq("status", "approved")
    .order("vendor_name", { ascending: true });
  if (error) throw error;
  return data;
}

// All vendors (for the request/approve list view)
export async function fetchAllVendors() {
  const { data, error } = await supabase
    .from("production_vendors")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

// Production Manager requests a new vendor (pending until Manish approves)
export async function requestVendor({ vendorName, vendorLocation, requestedBy }) {
  const { data, error } = await supabase
    .from("production_vendors")
    .insert({
      vendor_name: vendorName,
      vendor_location: vendorLocation,
      status: "pending",
      requested_by: requestedBy,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Pending vendors awaiting approval (COO / Manish view)
export async function fetchPendingVendors() {
  const { data, error } = await supabase
    .from("production_vendors")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

// COO (Manish) approves or rejects a pending vendor request.
export async function setVendorApproval({ vendorId, approve, approvedBy, reason = null }) {
  const { data, error } = await supabase
    .from("production_vendors")
    .update({
      status: approve ? "approved" : "rejected",
      approved_by: approvedBy,
      approval_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", vendorId)
    .eq("status", "pending")   // only act on still-pending rows
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Configure an external movement for a component (Production Head).
// RPC enforces: vendor approved + return date not backdated.
export async function configureExternalMovement({ barcode, vendorId, returnDate, stagesOutside, createdBy }) {
  const { data, error } = await supabase.rpc("configure_external_movement", {
    p_barcode: barcode,
    p_vendor_id: vendorId,
    p_return_date: returnDate,
    p_stages_outside: stagesOutside,
    p_created_by: createdBy,
  });
  if (error) throw error;
  return data;
}

// The PH-approved external movement awaiting an exit scan for this component —
// i.e. the 'configured' (not yet exited) row. The Security Gate reads THIS to
// lock the exit to the approved vendor + return date; the guard cannot choose.
// Returns null if the Production Head hasn't configured a movement yet.
export async function getConfiguredMovement(componentId) {
  const { data, error } = await supabase
    .from("external_movements")
    .select("id, vendor_name, vendor_location, return_date, status")
    .eq("component_id", componentId)
    .eq("status", "configured")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) { console.error("getConfiguredMovement failed:", error); return null; }
  return data;
}

// Full external-vendor movement history for a component — every trip (any
// status), newest first. Powers the "Vendor History" list in the journey modal
// so you can see which vendor a piece went to and when.
export async function fetchMovementHistory(componentId) {
  const { data, error } = await supabase
    .from("external_movements")
    .select("id, vendor_name, vendor_location, stages_outside, return_date, status, created_at, exit_scan_at, entry_scan_at")
    .eq("component_id", componentId)
    .order("created_at", { ascending: false });
  if (error) { console.error("fetchMovementHistory failed:", error); return []; }
  return data || [];
}

// Attach `stages_outside` to any components currently out at a vendor
// (is_outside_wh === true) by reading their active 'exited' external_movements
// row. This is the ONE place every dashboard uses so the "Out to Vendor (stage)"
// badge is computed identically everywhere (no per-screen re-implementation).
// Returns a new array; components not outside are returned unchanged.
export async function enrichComponentsWithMovements(components) {
  if (!Array.isArray(components) || components.length === 0) return components || [];
  const outsideIds = components.filter((c) => c && c.is_outside_wh).map((c) => c.id);
  if (outsideIds.length === 0) return components;

  const stagesById = {};
  for (let i = 0; i < outsideIds.length; i += 500) {
    const chunk = outsideIds.slice(i, i + 500);
    const { data, error } = await supabase
      .from("external_movements")
      .select("component_id, stages_outside")
      .in("component_id", chunk)
      .eq("status", "exited");
    if (error) { console.error("enrichComponentsWithMovements failed:", error); continue; }
    (data || []).forEach((m) => { stagesById[m.component_id] = m.stages_outside; });
  }

  return components.map((c) =>
    c && c.is_outside_wh && stagesById[c.id]
      ? { ...c, stages_outside: stagesById[c.id] }
      : c
  );
}

// All external movements (any status), newest first, with the component's
// barcode + order_no + type and the order's placement date — powers the
// "Movement History" tab on the Vendor/External page where the PH can review,
// filter and (while still 'configured') edit them.
export async function fetchAllMovements() {
  // Paged past Supabase's 1000-row cap — full movements table grows without bound.
  const { data, error } = await fetchAllRows("external_movements", (q) => q
    .select("id, vendor_id, vendor_name, vendor_location, stages_outside, return_date, status, created_by, created_at, exit_scan_at, entry_scan_at, order_components ( barcode, order_no, component_type, order_id )")
    .order("created_at", { ascending: false }));
  if (error) { console.error("fetchAllMovements failed:", error); return []; }

  const rows = (data || []).map((m) => ({
    ...m,
    barcode: m.order_components?.barcode || null,
    order_no: m.order_components?.order_no || null,
    component_type: m.order_components?.component_type || null,
    order_id: m.order_components?.order_id || m.order_id || null,
  }));

  // Attach each movement's ORDER date. external_movements.order_id has no FK
  // (so no nested select); batch-fetch created_at in chunks — a single .in()
  // with a huge id list silently 400s on large data (URL length).
  const orderIds = [...new Set(rows.map((r) => r.order_id).filter(Boolean))];
  const dateById = {};
  for (let i = 0; i < orderIds.length; i += 100) {
    const chunk = orderIds.slice(i, i + 100);
    const { data: ords, error: oErr } = await supabase
      .from("orders").select("id, created_at").in("id", chunk);
    if (oErr) { console.error("fetchAllMovements order-date fetch failed:", oErr); break; }
    (ords || []).forEach((o) => { dateById[o.id] = o.created_at; });
  }
  return rows.map((r) => ({ ...r, order_created_at: dateById[r.order_id] || null }));
}

// Edit a still-'configured' movement (vendor / return date / stages). The RPC
// rejects edits to exited/returned movements and re-applies the vendor + stage
// guards. Returns the RPC result { success, ... }.
export async function updateExternalMovement({ movementId, vendorId, returnDate, stagesOutside, updatedBy }) {
  const { data, error } = await supabase.rpc("update_external_movement", {
    p_movement_id: movementId,
    p_vendor_id: vendorId,
    p_return_date: returnDate,
    p_stages_outside: stagesOutside,
    p_updated_by: updatedBy,
  });
  if (error) throw error;
  return data;
}

// ============================================================
// 11. RECORD OVERRIDE — Production Head override
// ============================================================
export async function recordOverride({
  componentId,
  orderId,
  orderNo,
  barcode,
  overrideType, // 'timeline_extension' / 'skip_stage' / 'manual_advance' / 'packaging_override'
  fromStage = null,
  toStage = null,
  reason,
  overriddenBy,
  originalDeadline = null,
  newDeadline = null,
  extendedDays = null,
}) {
  const { data, error } = await supabase
    .from("stage_overrides")
    .insert({
      component_id: componentId,
      order_id: orderId,
      order_no: orderNo,
      barcode: barcode,
      override_type: overrideType,
      from_stage: fromStage,
      to_stage: toStage,
      reason: reason,
      overridden_by: overriddenBy,
      original_deadline: originalDeadline,
      new_deadline: newDeadline,
      extended_days: extendedDays,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ============================================================
// SA-FRIENDLY STAGE LABELS
// SA Dashboard shows simplified status, not full warehouse stages
// ============================================================
export function getSAStageLabel(stageValue) {
  if (!stageValue || stageValue === "order_received") return "Order Received";
  if (stageValue === "dispatched") return "Completed & Dispatched";
  if (stageValue === "packaging_dispatch") return "Ready for Dispatch";
  if (stageValue === "qc_passed") return "QC Passed";
  if (stageValue === "qc_failed") return "QC Failed";
  if (stageValue === "qc_in_progress") return "Quality Check";
  if (stageValue === "disposed") return "Disposed";
  if (stageValue === "scrapped") return "Scrapped";
  // Everything between cloth_issued and finishing_completed = In Production
  return "In Production";
}

export function getSAStageColor(stageValue) {
  if (!stageValue || stageValue === "order_received") return "#9e9e9e";
  if (stageValue === "dispatched") return "#1b5e20";
  if (stageValue === "packaging_dispatch") return "#2e7d32";
  if (stageValue === "qc_passed") return "#4caf50";
  if (stageValue === "qc_failed") return "#d32f2f";
  if (stageValue === "qc_in_progress") return "#f44336";
  if (stageValue === "disposed") return "#424242";
  if (stageValue === "scrapped") return "#616161";
  return "#3f51b5";
}

// ============================================================
// 12. FETCH DASHBOARD STATS — Component-level stats for dashboards
// ============================================================
export async function fetchComponentStats() {
  // Paged past Supabase's 1000-row cap — active pieces can exceed 1000.
  const { data, error } = await fetchAllRows("order_components", (q) => q
    .select("current_stage, is_active, is_delayed, is_outside_wh, is_rework, qc_status, re_journey_count")
    .eq("is_active", true));

  if (error) throw error;

  const stats = {
    total: data.length,
    byStage: {},
    delayed: 0,
    outsideWh: 0,
    rework: 0,
    qcPassed: 0,
    qcFailed: 0,
  };

  data.forEach(c => {
    stats.byStage[c.current_stage] = (stats.byStage[c.current_stage] || 0) + 1;
    if (c.is_delayed) stats.delayed++;
    if (c.is_outside_wh) stats.outsideWh++;
    if (c.is_rework) stats.rework++;
    if (c.qc_status === "passed") stats.qcPassed++;
    if (c.qc_status === "failed") stats.qcFailed++;
  });

  return stats;
}