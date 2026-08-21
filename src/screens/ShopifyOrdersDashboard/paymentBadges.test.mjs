import assert from "node:assert/strict";
import { paymentLabel } from "./pay.mjs";
const o = (status, tags = []) => ({ shopify_financial_status: status, shopify_tags: tags });
const cases = [
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
let bad = 0;
for (const [ord, want] of cases) {
  const got = paymentLabel(ord);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${JSON.stringify(ord.shopify_financial_status)} ${JSON.stringify(ord.shopify_tags||[])} -> "${got}"${ok?"":`  (want "${want}")`}`);
}
assert.equal(bad, 0, `${bad} wrong`);
console.log("\nall payment badge checks passed");
