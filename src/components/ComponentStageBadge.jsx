import React from "react";
import Badge from "./Badge";
import { getStageLabel, getStageColor, getStagesOutsideLabel } from "../utils/barcodeService";

// The ONE badge used everywhere to show a component's production status.
// When the piece is out at an external vendor (is_outside_wh), it reads
// "Out to Vendor (Embroidery)" in the vendor orange; otherwise it shows the
// current internal stage. Every dashboard renders this same component so the
// badge can never drift between screens again.
//
// A re-journeyed piece gets its pass number appended — "Cloth Issued (2)" —
// so the floor can tell a second pass from a fresh one. Without it a re-worked
// piece back at cloth issue reads identically to a brand-new one, which is
// what was confusing the department. Requires `stage_pass_counts` in the
// component select.
//
// For the stage name it needs `comp.stages_outside` — attach it first with
// enrichComponentsWithMovements(components) from barcodeService (falls back to
// a plain "Out to Vendor" if the stage array isn't present).
const OUT_TO_VENDOR_COLOR = "#e0913f";

// Pass number is PER STAGE, counted only for the stage QC re-journeyed the
// piece TO (order_components.stage_pass_counts, keyed by that stage):
//
//   Final QC fail -> Dry Cleaning  ->  "Dry Cleaning (2)"
//   Final QC fail -> Cloth Issue   ->  "Cloth Issue (2)"   dry cleaning unmoved
//   Final QC fail -> Dry Cleaning  ->  "Dry Cleaning (3)"  cloth issue unmoved
//
// It deliberately does NOT read re_journey_count: that is one counter for the
// whole piece, so it bumped EVERY stage's badge on any re-journey — a
// re-journey to dry cleaning made the cloth-issue badge read (3). Stages the
// piece merely passes through again carry no number; only a re-journey target
// does. Blank on a first-pass piece, so normal flow reads exactly as before.
function passSuffix(comp, stage) {
  const n = Number(comp?.stage_pass_counts?.[stage]) || 0;
  return n > 0 ? ` (${n + 1})` : "";
}

export default function ComponentStageBadge({ comp, className }) {
  if (!comp) return null;

  // Both branches count against the piece's CURRENT stage — an out-at-vendor
  // piece is still at that stage, it is just not in the building.
  if (comp.is_outside_wh) {
    const stage = getStagesOutsideLabel(comp.stages_outside);
    return (
      <Badge color={OUT_TO_VENDOR_COLOR} className={className}>
        {stage ? `Out to Vendor (${stage})` : "Out to Vendor"}{passSuffix(comp, comp.current_stage)}
      </Badge>
    );
  }

  return (
    <Badge color={getStageColor(comp.current_stage)} className={className}>
      {getStageLabel(comp.current_stage)}{passSuffix(comp, comp.current_stage)}
    </Badge>
  );
}
