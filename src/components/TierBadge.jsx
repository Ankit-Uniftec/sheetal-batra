import React from "react";
import formatIndianNumber from "../utils/formatIndianNumber";
import { tierShortName } from "../utils/clientTier";
import "./TierBadge.css";

// Collectors Circle tier as a small pill. `detail` adds the 12-month spend and
// how far the next tier is. Renders nothing when no tier is known.
export default function TierBadge({ tier, detail = false, short = false }) {
  if (!tier?.tierCode) return null;
  const name = short ? tierShortName(tier.tierName) : tier.tierName;
  const info = `Collectors Circle: ${tier.tierName}. Eligible spend in the last 12 months: Rs ${formatIndianNumber(tier.spend)}`
    + (tier.nextTierName ? `. Rs ${formatIndianNumber(tier.toNext)} more to ${tier.nextTierName}.` : ".");
  return (
    <span className={`sb-tier${detail ? " has-detail" : ""}`} title={info}>
      <span className={`sb-tier-pill is-${tier.tierCode}`}>{name}</span>
      {detail && (
        <span className="sb-tier-detail">
          ₹{formatIndianNumber(tier.spend)} in 12 months
          {tier.nextTierName ? ` · ₹${formatIndianNumber(tier.toNext)} to ${tierShortName(tier.nextTierName)}` : ""}
        </span>
      )}
    </span>
  );
}
