import { advanceComponentStage, recordOverride } from "./barcodeService";

// ============================================================
// The Production Manager's "Manually Advance" / "Skip to Stage" — one
// implementation for the Overrides screen AND for approving a floor request
// (meeting point 5), so an approved request is exactly the PM's own override.
//
// Lifted unchanged out of ProductionOverrides.handleOverrideSubmit: both kinds
// call advance_component_stage with transition 'manual_override' (the database's
// full-bypass override, still logged) and then record it in stage_overrides.
// They differ only in the log type and the note ("Skip: " prefix).
// ============================================================

export const OVERRIDE_KINDS = {
  manual_advance: { notePrefix: "", doneLabel: "Manually advanced to" },
  skip_stage: { notePrefix: "Skip: ", doneLabel: "Skipped to" },
};

/**
 * @param {object} opts
 * @param {object} opts.component    order_components row (id, order_id, order_no, barcode, current_stage)
 * @param {"manual_advance"|"skip_stage"} opts.kind
 * @param {string} opts.targetStage
 * @param {string} opts.reason       required
 * @param {string} opts.by           actor's email
 * @param {string} [opts.station]    station name on the scan record
 * @returns {Promise<{success: boolean, message?: string}>}
 */
export async function applyStageOverride({ component, kind, targetStage, reason, by, station = "Production Head Override" }) {
  const k = OVERRIDE_KINDS[kind];
  if (!k) throw new Error(`Unknown override kind: ${kind}`);
  if (!component?.barcode) throw new Error("No piece to override");
  if (!targetStage) throw new Error("Select a target stage");
  if (!String(reason || "").trim()) throw new Error("Reason is mandatory for all overrides");

  const result = await advanceComponentStage(
    component.barcode,
    targetStage,
    by,
    station,
    k.notePrefix + reason,
    "manual_override"
  );
  if (!result?.success) return { success: false, message: result?.message || "The override was refused." };

  await recordOverride({
    componentId: component.id,
    orderId: component.order_id,
    orderNo: component.order_no,
    barcode: component.barcode,
    overrideType: kind,
    fromStage: component.current_stage,
    toStage: targetStage,
    reason,
    overriddenBy: by,
  });
  return { success: true };
}
