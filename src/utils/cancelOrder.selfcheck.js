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
    // Revoked outranks delivered: a brand-initiated revoke can land on an
    // already-delivered order, and delivered_at stays set on that row.
    if (s === "revoked") return "Revoked";
    if (s === "delivered") return "Delivered";
    if (s === "dispatched" || o.warehouse_stage === "dispatched") return "Dispatched";
    if (s === "completed") return "Completed";
    return "In Production";
};

// Mirrors canCancelFromCard in B2bMerchandiserDashboard.jsx
const merchCanCancel = (o, isDesignatedMerch) => {
    if (!o) return false;
    if (["Dispatched", "Delivered", "Cancelled", "Revoked"].includes(derivedStatus(o))) return false;
    const hours = o.created_at ? (Date.now() - new Date(o.created_at).getTime()) / 36e5 : Infinity;
    return hours < 24 || isDesignatedMerch;
};

// Mirrors the button condition in ProductionManagerDashboard.jsx
const pmCanCancel = (o) =>
    !["Dispatched", "Delivered", "Cancelled", "Revoked"].includes(derivedStatus(o));

const hoursAgo = (h) => new Date(Date.now() - h * 36e5).toISOString();

function demo() {
    const fresh = { status: "order_received", created_at: hoursAgo(2) };
    const old = { status: "order_received", created_at: hoursAgo(72) };

    // --- merchandiser: the 24h window ---
    assert.equal(merchCanCancel(fresh, false), true, "fresh order is cancellable");
    assert.equal(merchCanCancel(old, false), false, "past 24h a normal merchandiser cannot cancel");
    assert.equal(merchCanCancel(old, true), true, "the designated merchandiser overrides the window");

    // --- terminal states are terminal for BOTH roles ---
    for (const status of ["cancelled", "revoked", "delivered", "dispatched"]) {
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

    // --- THE BUG THIS CAUGHT (PROD, SB-DLC-0626-002386) ---
    // A client-directed revoke landed on a DELIVERED order. getOrderProgressStatus
    // had no "revoked" branch, so the badge fell through to the delivered/
    // component fallback and kept reading "Delivered" — the PM dashboard
    // disagreed with the Accountant/GM/COO screens (which key off revoked_at via
    // getOrderProgressStatusStage) about the same row.
    const revokedAfterDelivery = {
        status: "revoked", delivered_at: "2026-08-14T13:39:03Z", created_at: hoursAgo(2000),
    };
    assert.equal(derivedStatus(revokedAfterDelivery), "Revoked",
        "a revoke on a delivered order must read Revoked, not Delivered");
    assert.equal(pmCanCancel(revokedAfterDelivery), false,
        "PM must not cancel an already-revoked order");
    assert.equal(merchCanCancel(revokedAfterDelivery, true), false,
        "not even the designated merchandiser re-cancels a revoked order");

    // Pre-delivery revoke (the normal UI path) is equally terminal.
    assert.equal(derivedStatus({ status: "revoked", warehouse_stage: "stitching" }), "Revoked",
        "a mid-production revoke must not read as In Production");

    // --- THE REASON COLUMN (PROD: all 27 revoked orders rendered "—") ---
    // cancelOrder() writes BOTH a cancel's and a revoke's reason to
    // cancellation_reason. Three screens read o.revoke_reason / "revoked_reason"
    // instead — columns that have never existed on orders, so JS handed back
    // undefined and the dashboards printed an em-dash. If a future revoke path
    // ever introduces a dedicated column, this assertion is what fails first.
    const reasonOf = (o) => o.cancellation_reason || "—";
    assert.equal(reasonOf({ status: "revoked", cancellation_reason: "Sizing issue" }), "Sizing issue",
        "a revoke's reason must be read from cancellation_reason");
    assert.equal(reasonOf({ status: "cancelled", cancellation_reason: "Changed mind" }), "Changed mind",
        "a cancel reads the same column — one field for both");
    assert.equal(reasonOf({ status: "revoked" }), "—",
        "a reasonless revoke still degrades to an em-dash, not undefined");

    // A missing created_at must not silently grant a cancel window.
    assert.equal(merchCanCancel({ status: "order_received" }, false), false,
        "no created_at => treated as outside the window");

    console.log("cancelOrder.selfcheck: all assertions passed");
}

demo();
