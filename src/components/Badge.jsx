import React from "react";
import "./Badge.css";

/**
 * Badge — one reusable pill badge for the whole app.
 *
 * Two ways to use it:
 *  1. Color-driven (e.g. a stage color): pass `color` and the text color is
 *     auto-chosen (black/white) for readable contrast via luminance. This fixes
 *     the "dark text on dark background" problem with the stage badges.
 *       <Badge color="#00bcd4">Dry Cleaning</Badge>
 *  2. Variant-driven (semantic): pass `variant` for soft, consistent styles.
 *       <Badge variant="success">Approved</Badge>
 *
 * Props:
 *   color?    string  hex background; text auto-contrasted. Takes precedence.
 *   variant?  "neutral"|"success"|"warning"|"danger"|"info"  (default neutral)
 *   soft?     boolean  with `color`, render a soft tinted style instead of solid
 *   size?     "sm"|"md"  (default "sm")
 *   className?, style?, children
 */

// Pick black or white text for a given hex bg, based on perceived luminance.
function readableTextColor(hex) {
  if (!hex || typeof hex !== "string") return "#fff";
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return "#fff";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // Relative luminance (sRGB). >0.6 → use dark text, else white.
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#1a1a1a" : "#ffffff";
}

// Soft tinted background from a hex (low-alpha) for the `soft` variant.
function softBg(hex) {
  let h = (hex || "").replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return "rgba(0,0,0,0.06)";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.16)`;
}

const Badge = ({ color, variant = "neutral", soft = false, autoContrast = false, size = "sm", className = "", style = {}, children }) => {
  let computedStyle = { ...style };
  let variantClass = "";

  let solidClass = "";
  if (color) {
    if (soft) {
      computedStyle = { backgroundColor: softBg(color), color: color, ...style };
    } else {
      // Solid color badges use white text for a consistent look across all
      // stage badges. We also add `badge-solid` which forces white via CSS
      // !important, so no competing class rule (e.g. wd-/pm- badge styles)
      // can override it. autoContrast opts back into luminance-based text.
      const textColor = autoContrast ? readableTextColor(color) : "#ffffff";
      computedStyle = { backgroundColor: color, color: textColor, ...style };
      if (!autoContrast) solidClass = "badge-solid";
    }
  } else {
    variantClass = `badge-${variant}`;
  }

  return (
    <span className={`badge badge-${size} ${variantClass} ${solidClass} ${className}`} style={computedStyle}>
      {children}
    </span>
  );
};

export default Badge;
