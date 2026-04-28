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
export const PRODUCTION_STAGES = [
  { value: "order_received", label: "Order Received", step: 1, color: "#9e9e9e", maxDays: 0 },
  { value: "cloth_issued", label: "Cloth Issued", step: 2, color: "#795548", maxDays: 1 },
  { value: "dyeing_in_progress", label: "Dyeing In-Progress", step: 3, color: "#e91e63", maxDays: 1, optional: true },
  { value: "dyeing_completed", label: "Dyeing Completed", step: 3, color: "#e91e63", optional: true },
  { value: "pattern_cutting_in_progress", label: "Pattern Cutting In-Progress", step: 4, color: "#9c27b0", maxDays: 1, optional: true },
  { value: "pattern_cutting_completed", label: "Pattern Cutting Completed", step: 4, color: "#9c27b0", optional: true },
  { value: "pattern_printing_in_progress", label: "Pattern Printing In-Progress", step: 5, color: "#673ab7", maxDays: 1 },
  { value: "pattern_printing_completed", label: "Pattern Printing Completed", step: 5, color: "#673ab7" },
  { value: "embroidery_in_progress", label: "Embroidery In-Progress", step: 6, color: "#3f51b5", maxDays: 21 },
  { value: "embroidery_completed", label: "Embroidery Completed", step: 6, color: "#3f51b5" },
  { value: "dry_cleaning_in_progress", label: "Dry Cleaning In-Progress", step: 7, color: "#00bcd4", maxDays: 1, optional: true },
  { value: "dry_cleaning_completed", label: "Dry Cleaning Completed", step: 7, color: "#00bcd4", optional: true },
  { value: "trims_in_progress", label: "Trims In-Progress", step: 8, color: "#009688", maxDays: 1 },
  { value: "trims_completed", label: "Trims Completed", step: 8, color: "#009688" },
  { value: "cutting_in_progress", label: "Cutting In-Progress", step: 9, color: "#ff9800", maxDays: 1 },
  { value: "cutting_completed", label: "Cutting Completed", step: 9, color: "#ff9800" },
  { value: "stitching_in_progress", label: "Stitching In-Progress", step: 10, color: "#ef6c00", maxDays: 2 },
  { value: "stitching_completed", label: "Stitching Completed", step: 10, color: "#ef6c00" },
  { value: "hemming_in_progress", label: "Hemming In-Progress", step: 11, color: "#ff5722", maxDays: 1 },
  { value: "hemming_completed", label: "Hemming Completed", step: 11, color: "#ff5722" },
  { value: "finishing_in_progress", label: "Finishing In-Progress", step: 12, color: "#607d8b", maxDays: 1 },
  { value: "finishing_completed", label: "Finishing Completed", step: 12, color: "#607d8b" },
  { value: "qc_in_progress", label: "QC In-Progress", step: 13, color: "#f44336", maxDays: 1 },
  { value: "qc_passed", label: "QC Passed", step: 13, color: "#4caf50" },
  { value: "qc_failed", label: "QC Failed", step: 13, color: "#d32f2f" },
  { value: "packaging_dispatch", label: "Packaging & Dispatch", step: 14, color: "#2e7d32", maxDays: 1 },
  { value: "dispatched", label: "Dispatched", step: 14, color: "#1b5e20" },
  { value: "disposed", label: "Disposed", step: 0, color: "#424242" },
  { value: "scrapped", label: "Scrapped", step: 0, color: "#616161" },
];

// Stages available for re-journey restart (Production Head dropdown)
export const REJOURNEY_STAGES = [
  { value: "dyeing_in_progress", label: "Dyeing" },
  { value: "pattern_cutting_in_progress", label: "Pattern Cutting" },
  { value: "pattern_printing_in_progress", label: "Pattern Printing" },
  { value: "embroidery_in_progress", label: "Embroidery" },
  { value: "dry_cleaning_in_progress", label: "Dry Cleaning" },
  { value: "trims_in_progress", label: "Trims" },
  { value: "cutting_in_progress", label: "Cutting" },
  { value: "stitching_in_progress", label: "Stitching" },
  { value: "hemming_in_progress", label: "Hemming" },
  { value: "finishing_in_progress", label: "Finishing" },
];

// Scan stations — each maps to the stage it transitions TO
export const SCAN_STATIONS = [
  { value: "cloth_issue", label: "Cloth Issue", inStage: "cloth_issued", outStage: null, step: 2 },
  { value: "pattern_cutting", label: "Pattern Cutting", inStage: "pattern_cutting_in_progress", outStage: "pattern_cutting_completed", step: 4 },
  { value: "pattern_printing", label: "Pattern Printing", inStage: "pattern_printing_in_progress", outStage: "pattern_printing_completed", step: 5 },
  { value: "embroidery", label: "Embroidery", inStage: "embroidery_in_progress", outStage: "embroidery_completed", step: 6 },
  { value: "trims", label: "Trims", inStage: "trims_in_progress", outStage: "trims_completed", step: 8 },
  { value: "cutting", label: "Cutting", inStage: "cutting_in_progress", outStage: "cutting_completed", step: 9 },
  { value: "stitching", label: "Stitching", inStage: "stitching_in_progress", outStage: "stitching_completed", step: 10 },
  { value: "hemming", label: "Hemming", inStage: "hemming_in_progress", outStage: "hemming_completed", step: 11 },
  { value: "finishing", label: "Finishing", inStage: "finishing_in_progress", outStage: "finishing_completed", step: 12 },
  { value: "qc", label: "Quality Check", inStage: "qc_in_progress", outStage: null, step: 13 },
  { value: "packaging", label: "Packaging & Dispatch", inStage: "packaging_dispatch", outStage: null, step: 14 },
  { value: "security_gate", label: "Security Gate", inStage: null, outStage: null, step: 0 },
];

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
    .select("*, orders(order_no, delivery_name, delivery_date, salesperson, status)")
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

    // DUPATTA component — if product typically includes dupatta
    // Check if dupatta is part of top_options/bottom_options or product type
    if (item?.dupatta || item?.includes_dupatta) {
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