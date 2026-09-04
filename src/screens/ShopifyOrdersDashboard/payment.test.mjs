// Self-check for pay.mjs — the payment badge and the payment HOLD.
//
// Runs the real module the dashboard imports, no copy:
//   node src/screens/ShopifyOrdersDashboard/payment.test.mjs
//
// The hold is the money gate: held → Needs Review, cleared → the Orders work
// queue, where somebody cuts cloth. Both directions are wrong in an expensive
// way, so every settlement shape the shop actually sees is pinned here.
import assert from "node:assert/strict";
import { paymentLabel, isPaymentHeld } from "./pay.mjs";

const o = (status, tags = []) => ({ shopify_financial_status: status, shopify_tags: tags });

const badges = [
  [o("PENDING", ["COD"]), "COD"],
  [o("PENDING", ["COD", "COD Confirmed"]), "COD Confirmed"],
  [o("PENDING", ["COD Confirmed"]), "COD Confirmed"],
  [o("", ["COD"]), "COD"],
  [o("PAID", ["COD"]), "COD"],
  // A bare "COD" must never satisfy the confirmed test.
  [o("PENDING", ["CODE RED"]), "Not Paid"],
  [o("PAID"), "Fully Paid"],
  [o("PARTIALLY_PAID"), "Partial Paid"],
  [o("AUTHORIZED"), "Partial Paid"],
  [o("PENDING"), "Not Paid"],
  [o(""), "Not Paid"],
  [o(null), "Not Paid"],
  [o("REFUNDED"), "Refunded"],
  [o("VOIDED"), "Voided"],
  // Marketing tag must NOT read as COD.
  [o("PAID", ["SW-WhatsApp COD Confirmation & COD to pr"]), "Fully Paid"],
];

const holds = [
  // Cleared: money is in, or committed.
  [o("PAID"), false],
  [o("PARTIALLY_PAID"), false],
  [o("AUTHORIZED"), false],
  // Partial payment clears on its own — a stale COD tag must not re-hold it.
  [o("PARTIALLY_PAID", ["COD"]), false],
  // COD settles on delivery, so the confirmation is what clears it.
  [o("PENDING", ["COD", "COD Confirmed"]), false],
  [o("PENDING", ["Only Labels Confirmed"]), false],
  // Held: nothing collected and nobody has confirmed.
  [o("PENDING"), true],
  [o("PENDING", ["COD"]), true],
  [o("PENDING", ["SW-WhatsApp COD Confirmation & COD to pr"]), true],
  // End states are not "waiting for money". A cancelled order is pulled into
  // Needs Review by its own predicate in the dashboard, not by this one.
  [o("REFUNDED"), false],
  [o("VOIDED"), false],
  [o("PARTIALLY_REFUNDED"), false],
  [o("CANCELLED"), false],
  // No status at all is a sync gap, not evidence of non-payment.
  [o(""), false],
  [o(null), false],
];

let bad = 0;
const check = (ok, line) => { if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"}  ${line}`); };
const shape = (ord) =>
  `${JSON.stringify(ord.shopify_financial_status)} ${JSON.stringify(ord.shopify_tags || [])}`;

console.log("— badge —");
for (const [ord, want] of badges) {
  const got = paymentLabel(ord);
  check(got === want, `${shape(ord)} -> "${got}"${got === want ? "" : `  (want "${want}")`}`);
}

console.log("\n— hold —");
for (const [ord, want] of holds) {
  const got = isPaymentHeld(ord);
  check(got === want, `${shape(ord)} -> ${got ? "HELD" : "cleared"}${got === want ? "" : `  (want ${want ? "HELD" : "cleared"})`}`);
}

assert.equal(bad, 0, `${bad} wrong`);
console.log("\nall payment checks passed");
