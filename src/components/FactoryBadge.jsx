import React from "react";
import { factoryBadge, WH2 } from "../utils/factory2";

/**
 * Which warehouse a scan was made in — "SB WH Delhi (1)" / "SB WH Delhi (2)"
 * (meeting point 28, Release 6). stage_transitions.factory is stamped from the
 * scanner's login at scan time; older rows were back-filled from the logins'
 * assignment. Renders nothing for an unassigned login (PH, PM).
 */
export default function FactoryBadge({ factory }) {
  const text = factoryBadge(factory);
  if (!text) return null;
  const two = factory === WH2;
  return (
    <span
      style={{
        display: "inline-block",
        marginLeft: 6,
        padding: "1px 7px",
        borderRadius: 10,
        fontSize: 10.5,
        fontWeight: 600,
        whiteSpace: "nowrap",
        background: two ? "#ede7f6" : "#e3f2fd",
        color: two ? "#4527a0" : "#0d47a1",
        border: `1px solid ${two ? "#d1c4e9" : "#bbdefb"}`,
      }}
    >
      {text}
    </span>
  );
}
