/* eslint-disable no-console */
// Self-check for the cancel-order eligibility rules. Pure predicates only — the
// cancelOrder() write path itself needs Supabase, so it is not exercised here.
//
//   node src/utils/cancelOrder.selfcheck.js
//
// These two predicates are duplicated by design: the merchandiser has a 24h
// window, the PM does not. If either copy drifts from what is asserted here,
// somebody either lost the ability to cancel or gained it wrongly.

const assert = require("assert");

// Both dashboards gate on the DERIVED status (what the badge shows), not the
// raw orders.status column. This stub mirrors the branches of
// getOrderProgressStatus that the gate actually depends on — crucially, an
// order is "Dispatched" if warehouse_stage says so even when status does not.
const derivedStatus = (o) => {
    const s = (o.status || "").toLowerCase();
    if (s === "cancelled") return "Cancelled";
    if (s === "delivered") return "Delivered";
    if (s === "dispatched" || o.warehouse_stage === "dispatched") return "Dispatched";
    if (s === "completed") return "Completed";
    return "In Production";
};

// Mirrors canCancelFromCard in B2bMerchandiserDashboard.jsx
const merchCanCancel = (o, isDesignatedMerch) => {
    if (!o) return false;
    if (["Dispatched", "Delivered", "Cancelled"].includes(derivedStatus(o))) return false;
    const hours = o.created_at ? (Date.now() - new Date(o.created_at).getTime()) / 36e5 : Infinity;
    return hours < 24 || isDesignatedMerch;
};

// Mirrors the button condition in ProductionManagerDashboard.jsx
const pmCanCancel = (o) =>
    !["Dispatched", "Delivered", "Cancelled"].includes(derivedStatus(o));

const hoursAgo = (h) => new Date(Date.now() - h * 36e5).toISOString();

function demo() {
    const fresh = { status: "order_received", created_at: hoursAgo(2) };
    const old = { status: "order_received", created_at: hoursAgo(72) };

    // --- merchandiser: the 24h window ---
    assert.equal(merchCanCancel(fresh, false), true, "fresh order is cancellable");
    assert.equal(merchCanCancel(old, false), false, "past 24h a normal merchandiser cannot cancel");
    assert.equal(merchCanCancel(old, true), true, "the designated merchandiser overrides the window");

    // --- terminal states are terminal for BOTH roles ---
    for (const status of ["cancelled", "delivered", "dispatched"]) {
        assert.equal(merchCanCancel({ status, created_at: hoursAgo(1) }, true), false,
            `merch must not re-cancel a ${status} order`);
        assert.equal(pmCanCancel({ status }), false,
            `PM must not cancel a ${status} order`);
    }

    // --- PM: no time limit (the whole point of the role difference) ---
    assert.equal(pmCanCancel(old), true, "PM can cancel an old order");
    assert.equal(pmCanCancel({ status: "in_production" }), true, "PM can cancel mid-production");
    assert.equal(pmCanCancel({ status: "completed" }), true,
        "completed = made but not shipped, so it is still cancellable");

    // Case-insensitivity: statuses arrive from several writers.
    assert.equal(pmCanCancel({ status: "Cancelled" }), false, "status compare is case-insensitive");
    assert.equal(merchCanCancel({ status: "DELIVERED", created_at: hoursAgo(1) }, true), false);

    // --- THE BUG THIS CAUGHT (UAT, SB-DLC-0826-000247-A) ---
    // Card badge read "Dispatched" off warehouse_stage while orders.status was
    // still earlier, so a raw-column gate kept offering Cancel on a shipped
    // garment. The gate must follow the badge.
    const shippedByStage = { status: "order_received", warehouse_stage: "dispatched", created_at: hoursAgo(1) };
    assert.equal(derivedStatus(shippedByStage), "Dispatched");
    assert.equal(pmCanCancel(shippedByStage), false,
        "PM must not cancel an order dispatched via warehouse_stage");
    assert.equal(merchCanCancel(shippedByStage, true), false,
        "not even the designated merchandiser cancels a shipped garment");

    // A missing created_at must not silently grant a cancel window.
    assert.equal(merchCanCancel({ status: "order_received" }, false), false,
        "no created_at => treated as outside the window");

    console.log("cancelOrder.selfcheck: all assertions passed");
}

demo();
