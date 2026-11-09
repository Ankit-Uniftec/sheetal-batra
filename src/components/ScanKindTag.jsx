import React from "react";

// Small pill that labels a timeline entry as an INTERNAL production scan
// (green) or an EXTERNAL / vendor movement (orange). Shared by every timeline
// so the internal-vs-external segregation looks identical everywhere. Uses
// inline styles so it drops into any timeline CSS (cjm-, wd-, po-) unchanged.
// look="brand": the quiet brand tones (neutral for internal, copper for vendor).
export default function ScanKindTag({ kind, look }) {
  const external = kind === "external";
  if (look === "brand") {
    return (
      <span style={{ display: "inline-block", fontSize: "10.5px", fontWeight: 600, lineHeight: 1, letterSpacing: "0.03em", padding: "4px 8px", borderRadius: "999px", textTransform: "uppercase", whiteSpace: "nowrap", color: external ? "#85582d" : "#5a5448", backgroundColor: external ? "#f4ebe2" : "#f2f1ed" }}>
        {external ? "External / Vendor" : "Internal Scan"}
      </span>
    );
  }
  const style = {
    display: "inline-block",
    fontSize: "10px",
    fontWeight: 700,
    lineHeight: 1,
    letterSpacing: "0.02em",
    padding: "3px 7px",
    borderRadius: "999px",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    color: external ? "#8a4b00" : "#1c6b3a",
    backgroundColor: external ? "rgba(224,145,63,0.18)" : "rgba(46,160,90,0.16)",
    border: `1px solid ${external ? "rgba(224,145,63,0.45)" : "rgba(46,160,90,0.4)"}`,
  };
  return <span style={style}>{external ? "External / Vendor" : "Internal Scan"}</span>;
}
