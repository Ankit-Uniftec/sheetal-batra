import React from "react";
import Badge from "./Badge";
import { getStageLabel, getStageColor, getStagesOutsideLabel } from "../utils/barcodeService";

// The ONE badge used everywhere to show a component's production status.
// When the piece is out at an external vendor (is_outside_wh), it reads
// "Out to Vendor (Embroidery)" in the vendor orange; otherwise it shows the
// current internal stage. Every dashboard renders this same component so the
// badge can never drift between screens again.
//
// For the stage name it needs `comp.stages_outside` — attach it first with
// enrichComponentsWithMovements(components) from barcodeService (falls back to
// a plain "Out to Vendor" if the stage array isn't present).
const OUT_TO_VENDOR_COLOR = "#e0913f";

export default function ComponentStageBadge({ comp, className }) {
  if (!comp) return null;

  if (comp.is_outside_wh) {
    const stage = getStagesOutsideLabel(comp.stages_outside);
    return (
      <Badge color={OUT_TO_VENDOR_COLOR} className={className}>
        {stage ? `Out to Vendor (${stage})` : "Out to Vendor"}
      </Badge>
    );
  }

  return (
    <Badge color={getStageColor(comp.current_stage)} className={className}>
      {getStageLabel(comp.current_stage)}
    </Badge>
  );
}
