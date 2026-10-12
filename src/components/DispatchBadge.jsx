import React from "react";
import formatDate from "../utils/formatDate";
import "./DispatchBadge.css";

/**
 * Green "Dispatched · 12 Oct · BlueDart · AWB 123" pill (meeting point 34:
 * production sees when the packaging desk has sent an order). Renders nothing
 * until a box has left. `summary` comes from utils/shipmentStatus.dispatchSummary.
 */
export default function DispatchBadge({ summary }) {
  if (!summary) return null;
  const head = summary.delivered ? "Delivered" : summary.partial ? `Partly dispatched · ${summary.pieces} pc` : "Dispatched";
  const parts = [head, summary.at && formatDate(summary.at), summary.courier, summary.awb && `AWB ${summary.awb}`].filter(Boolean);
  return (
    <span className={`dispatch-badge ${summary.partial ? "partial" : ""}`} title={parts.join(" · ")}>
      {parts.join(" · ")}
    </span>
  );
}
