/**
 * Self-check for orderMode.js — run with:  node src/utils/orderMode.selfcheck.js
 *
 * Covers the bug this module exists to prevent: a stock order abandoned
 * mid-flow leaving isStockOrder set, so the NEXT order raised in the same tab
 * silently inherits stock behaviour (zeroed pricing, wrong route).
 */
const store = {};
global.sessionStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const { startOrderMode, clearOrderMode, isOrderMode } = require("./orderMode");
const assert = require("assert");

// 1. Entering a mode sets exactly that mode.
startOrderMode("stock");
assert(isOrderMode("stock"), "stock mode not set");
assert(!isOrderMode("comms"), "comms leaked into stock");
assert(!isOrderMode("exhibition"), "exhibition leaked into stock");

// 2. THE BUG: an abandoned stock order must not survive into a client order.
startOrderMode("client");
assert(!isOrderMode("stock"), "stale stock flag survived a client order");

// 3. Modes are mutually exclusive — switching drops the previous one.
startOrderMode("stock");
startOrderMode("comms");
assert(isOrderMode("comms") && !isOrderMode("stock"), "modes not exclusive");

// 4. Exhibition carries a JSON payload, not the string "true".
startOrderMode("exhibition", JSON.stringify({ exhibition_id: 7 }));
assert(isOrderMode("exhibition"), "exhibition payload not detected");
assert(JSON.parse(sessionStorage.getItem("exhibitionOrder")).exhibition_id === 7, "payload lost");

// 5. Half-finished drafts are dropped on a mode switch.
sessionStorage.setItem("screen4FormData", "{}");
startOrderMode("stock");
assert(sessionStorage.getItem("screen4FormData") === null, "stale draft survived");

// 6. Route state wins on first render, before storage is written.
clearOrderMode();
assert(isOrderMode("stock", { isStockOrder: true }), "route state ignored");
assert(!isOrderMode("stock", {}), "cleared mode still reported");

// 7. Unknown mode fails loudly rather than silently doing nothing.
assert.throws(() => startOrderMode("nonsense"), /Unknown order mode/);

// 8. The comms payload is written BEFORE comms mode is entered and is read
//    downstream, so entering the mode must NOT wipe it.
clearOrderMode();
sessionStorage.setItem("commsOrderPayload", '{"a":1}');
sessionStorage.setItem("isStockOrder", "true");
startOrderMode("comms");
assert(sessionStorage.getItem("commsOrderPayload") === '{"a":1}', "comms payload wiped");
assert(!isOrderMode("stock"), "stale stock flag survived comms");

// 9. Auth/session keys the order flow depends on must never be touched.
clearOrderMode();
const KEEP = ["associateSession", "returnToAssociate", "returnDashboard",
  "currentSalesperson", "requirePasswordVerificationOnReturn", "sp_email"];
KEEP.forEach((k) => sessionStorage.setItem(k, "v"));
startOrderMode("stock");
clearOrderMode();
startOrderMode("client");
KEEP.forEach((k) => assert(sessionStorage.getItem(k) === "v", `clobbered ${k}`));

console.log("orderMode selfcheck: all 9 checks passed");
