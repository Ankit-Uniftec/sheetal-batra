import { supabase } from "../lib/supabaseClient";

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
// stage is skippable (Dyeing, Pattern Cutting, Dry Cleaning). Two QCs:
// the existing qc_* values are QC 1 (after Embroidery); final_qc_* are QC 2
// (before Packaging).
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
  { value: "dry_cleaning_in_progress", label: "Dry Cleaning In-Progress", step: 5, color: "#00bcd4", maxDays: 1 },
  { value: "dry_cleaning_completed", label: "Dry Cleaning Completed", step: 5, color: "#00bcd4" },
  { value: "qc_in_progress", label: "QC 1 In-Progress", step: 6, color: "#f44336", maxDays: 1, mandatory: true },
  { value: "qc_passed", label: "QC 1 Passed", step: 6, color: "#4caf50", mandatory: true },
  { value: "qc_failed", label: "QC 1 Failed", step: 6, color: "#d32f2f", mandatory: true },
  { value: "stitching_in_progress", label: "Stitching In-Progress", step: 7, color: "#ef6c00", maxDays: 2, mandatory: true },
  { value: "stitching_completed", label: "Stitching Completed", step: 7, color: "#ef6c00", mandatory: true },
  { value: "hemming_in_progress", label: "Hemming In-Progress", step: 8, color: "#ff5722", maxDays: 1, mandatory: true },
  { value: "hemming_completed", label: "Hemming Completed", step: 8, color: "#ff5722", mandatory: true },
  { value: "final_qc_in_progress", label: "Final QC In-Progress", step: 9, color: "#c2185b", maxDays: 1, mandatory: true },
  { value: "final_qc_passed", label: "Final QC Passed", step: 9, color: "#388e3c", mandatory: true },
  { value: "final_qc_failed", label: "Final QC Failed", step: 9, color: "#b71c1c", mandatory: true },
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
export const STAGE_GROUPS = [
  { key: "cloth_issue", label: "Cloth Issue", step: 1, color: "#795548", members: ["cloth_issued"] },
  { key: "dyeing", label: "Dyeing", step: 2, color: "#e91e63", members: ["dyeing_in_progress", "dyeing_completed"] },
  { key: "pattern_cutting", label: "Pattern Cutting", step: 3, color: "#9c27b0", members: ["pattern_cutting_in_progress", "pattern_cutting_completed"] },
  { key: "embroidery", label: "Embroidery", step: 4, color: "#3f51b5", members: ["embroidery_in_progress", "embroidery_completed"] },
  { key: "dry_cleaning", label: "Dry Cleaning", step: 5, color: "#00bcd4", members: ["dry_cleaning_in_progress", "dry_cleaning_completed"] },
  { key: "qc1", label: "QC 1", step: 6, color: "#f44336", members: ["qc_in_progress", "qc_passed", "qc_failed"] },
  { key: "stitching", label: "Stitching", step: 7, color: "#ef6c00", members: ["stitching_in_progress", "stitching_completed"] },
  { key: "hemming", label: "Hemming", step: 8, color: "#ff5722", members: ["hemming_in_progress", "hemming_completed"] },
  { key: "final_qc", label: "Final QC", step: 9, color: "#c2185b", members: ["final_qc_in_progress", "final_qc_passed", "final_qc_failed"] },
  { key: "packaging", label: "Packaging & Dispatch", step: 10, color: "#2e7d32", members: ["packaging_dispatch", "dispatched"] },
];

// Map a raw stage value (e.g. "embroidery_completed") to its group key
// (e.g. "embroidery"). Returns null for stages outside the 10 (e.g.
// order_received / disposed / scrapped / legacy).
export function getStageGroupKey(stageValue) {
  if (!stageValue) return null;
  const g = STAGE_GROUPS.find(grp => grp.members.includes(stageValue));
  return g ? g.key : null;
}

// Text color for a stage badge. Stage colors are mid/dark tones, so we use
// white text consistently across all stage badges for a uniform look.
export function getStageTextColor() {
  return "#ffffff";
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
export async function verifyPackagingComponents(orderId, scannedBarcodes) {
  const { data, error } = await supabase.rpc("verify_packaging_components", {
    p_order_id: orderId,
    p_scanned_barcodes: scannedBarcodes,
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
  const { data, error } = await supabase
    .from("order_components")
    .select("*, orders(order_no, delivery_name, delivery_date, salesperson, salesperson_email, status)")
    .eq("barcode", barcode)
    .single();

  if (error) throw error;
  return data;
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
export async function generateOrderComponents(order) {
  const components = [];
  const orderNo = order.order_no;
  // Extract store code from order_no: "SB-DLC-0425-000376" → "DLC"
  const storeCode = orderNo?.split("-")[1] || "SB";

  // Get the sequence number part: last 6 digits
  const seqPart = orderNo?.split("-").pop() || "000000";

  const items = Array.isArray(order.items) ? order.items : [order.items];

  items.forEach((item, itemIndex) => {
    // TOP component — if item has a top option selected
    if (item?.top || item?.product_name) {
      components.push({
        order_id: order.id,
        order_no: orderNo,
        barcode: `${storeCode}-${seqPart}-TOP${itemIndex > 0 ? itemIndex + 1 : ""}`,
        component_type: "top",
        component_label: item.top || item.product_name || "Top",
        item_index: itemIndex,
        extra_index: null,
      });
    }

    // BOTTOM component — if item has a bottom option selected
    if (item?.bottom) {
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
    .select("id, vendor_name, vendor_location, status")
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
  const { data, error } = await supabase
    .from("order_components")
    .select("current_stage, is_active, is_delayed, is_outside_wh, is_rework, qc_status, re_journey_count")
    .eq("is_active", true);

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