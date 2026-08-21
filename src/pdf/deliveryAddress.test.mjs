import assert from "node:assert/strict";
import { buildDeliveryAddress } from "./addr.mjs";
const t = (o, want) => {
  const got = buildDeliveryAddress(o);
  const ok = got === want;
  console.log(`${ok?"ok  ":"FAIL"}  "${got}"${ok?"":`  (want "${want}")`}`);
  return ok;
};
let bad = 0;
// Full COD order.
if (!t({ delivery_address: "12 Radstock Lane, Apt 4", delivery_city: "Radstock",
  delivery_state: "Punjab", delivery_pincode: "141001", delivery_phone: "+919876543210" },
  "12 Radstock Lane, Apt 4, Radstock, Punjab 141001  ·  +919876543210")) bad++;
// No phone.
if (!t({ delivery_address: "5 Mall Rd", delivery_city: "Delhi", delivery_state: "DL", delivery_pincode: "110001" },
  "5 Mall Rd, Delhi, DL 110001")) bad++;
// No state, no pincode — must not leave stray commas.
if (!t({ delivery_address: "5 Mall Rd", delivery_city: "Delhi" }, "5 Mall Rd, Delhi")) bad++;
// City only.
if (!t({ delivery_city: "Radstock" }, "Radstock")) bad++;
// Nothing at all -> falls back to mode.
if (!t({ mode_of_delivery: "Store Pickup" }, "Store Pickup")) bad++;
// delivery_location wins as legacy fallback when no address parts.
if (!t({ delivery_location: "GK-II Store", mode_of_delivery: "Pickup" }, "GK-II Store")) bad++;
// Empty order -> empty string, not "undefined".
if (!t({}, "")) bad++;
assert.equal(bad, 0, `${bad} wrong`);
console.log("\nall address checks passed");
