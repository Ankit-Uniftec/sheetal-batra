import { supabase } from "../lib/supabaseClient";
import { fetchComponentByBarcode, getStageLabel } from "./barcodeService";
import { applyStageOverride } from "./stageOverride";
import { NOTIFICATION_TYPES, sendNotification } from "./notificationService";

// ============================================================
// Skip / advance requests (meeting point 5). A production head picks pieces by
// product name and asks; the Production Manager approves or rejects in the
// Overrides screen. Approving runs the PM's own override (utils/stageOverride),
// so the result is identical to the PM doing it by hand. Table + staff-only
// rules: db/meeting_points/r9_01_stage_change_requests.sql.
// ============================================================

export const REQUEST_TYPES = [
  { value: "advance", label: "Advance to", kind: "manual_advance" },
  { value: "skip", label: "Skip to", kind: "skip_stage" },
];

const kindFor = (type) => REQUEST_TYPES.find((t) => t.value === type)?.kind;

// Stations whose workers never move production stages: the security gate only
// logs pieces out / in, and packaging only boxes finished pieces.
const NON_PRODUCTION_STATIONS = ["security_gate", "packaging"];

/**
 * May a scan-station user ask for a skip / advance? Everyone except a user whose
 * ONLY stations are the security gate and/or packaging (the guards, the
 * packing desk). assigned_stations null/undefined means "every station".
 */
export const canRequestStageChange = (assignedStations) =>
  !Array.isArray(assignedStations) ||
  assignedStations.some((s) => !NON_PRODUCTION_STATIONS.includes(s));

/** The product a piece belongs to, by its item_index on the order. */
export const pieceProductName = (order, comp) =>
  order?.items?.[comp?.item_index ?? 0]?.product_name || "";

/**
 * Why a piece can't be requested, or null when it can. The same pieces the
 * override itself refuses or that make no sense to move.
 *
 * @param {object} comp
 * @param {Set<string>} pendingIds  component ids that already have a pending request
 */
export function pieceBlock(comp, pendingIds = new Set()) {
  if (!comp) return "Unknown piece";
  if (pendingIds.has(comp.id)) return "Already has a pending request";
  if (comp.current_stage === "dispatched") return "Dispatched";
  if (["disposed", "scrapped"].includes(comp.current_stage)) return "Disposed — restart at Cloth Issue";
  if (comp.is_outside_wh) return `At vendor${comp.vendor_name ? ` (${comp.vendor_name})` : ""}`;
  return null;
}

/**
 * Rows → one entry per request as it was sent (request_group), newest first.
 * Group status: pending while any piece is pending, else the decision.
 */
export function groupRequests(rows) {
  const by = new Map();
  for (const r of rows || []) {
    if (!by.has(r.request_group)) {
      by.set(r.request_group, {
        group: r.request_group,
        order_id: r.order_id,
        order_no: r.order_no,
        request_type: r.request_type,
        target_stage: r.target_stage,
        reason: r.reason,
        requested_by: r.requested_by,
        requested_at: r.requested_at,
        decided_by: r.decided_by,
        decided_at: r.decided_at,
        decision_note: r.decision_note,
        rows: [],
      });
    }
    by.get(r.request_group).rows.push(r);
  }
  return [...by.values()]
    .map((g) => ({
      ...g,
      status: g.rows.some((r) => r.status === "pending") ? "pending" : g.rows[0].status,
      appliedCount: g.rows.filter((r) => r.applied).length,
    }))
    .sort((a, b) => new Date(b.requested_at) - new Date(a.requested_at));
}

const SELECT = "id, request_group, order_id, order_no, component_id, barcode, request_type, from_stage, target_stage, reason, requested_by, requested_at, status, decided_by, decided_at, decision_note, applied, apply_error";

/** Every request for one order (for the requester's popup), grouped. */
export async function listOrderRequests(orderId) {
  const { data, error } = await supabase.from("stage_change_requests").select(SELECT)
    .eq("order_id", orderId).order("requested_at", { ascending: false });
  if (error) throw error;
  return groupRequests(data);
}

/** Pending requests for the PM, grouped, newest first. */
export async function listPendingRequests() {
  const { data, error } = await supabase.from("stage_change_requests").select(SELECT)
    .eq("status", "pending").order("requested_at", { ascending: false });
  if (error) throw error;
  return groupRequests(data);
}

/** Recently decided requests for the PM's "Recent decisions" list. */
export async function listRecentDecisions(limit = 60) {
  const { data, error } = await supabase.from("stage_change_requests").select(SELECT)
    .neq("status", "pending").order("decided_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return groupRequests(data);
}

/** Component ids among these orders that already have a pending request. */
export async function pendingComponentIds(orderId) {
  const { data, error } = await supabase.from("stage_change_requests")
    .select("component_id").eq("order_id", orderId).eq("status", "pending");
  if (error) throw error;
  return new Set((data || []).map((r) => r.component_id));
}

/**
 * Send one request for the chosen pieces. One row per piece, sharing a
 * request_group. The PM is notified (best-effort — a failed notification never
 * undoes the request).
 */
export async function createStageRequests({ order, components, type, targetStage, reason, by }) {
  if (!components?.length) throw new Error("Pick at least one piece.");
  if (!kindFor(type)) throw new Error("Choose Advance or Skip.");
  if (!targetStage) throw new Error("Choose the target stage.");
  if (!String(reason || "").trim()) throw new Error("A reason is required.");
  // The table's request_group column is a uuid, so a real one is required;
  // every supported browser has crypto.randomUUID.
  if (typeof window === "undefined" || !window.crypto?.randomUUID) throw new Error("This browser can't create a request id — please update it.");
  const group = window.crypto.randomUUID();
  const rows = components.map((c) => ({
    request_group: group,
    order_id: order.id,
    order_no: order.order_no,
    component_id: c.id,
    barcode: c.barcode,
    request_type: type,
    from_stage: c.current_stage,
    target_stage: targetStage,
    reason: reason.trim(),
    requested_by: by || null,
  }));
  const { error } = await supabase.from("stage_change_requests").insert(rows);
  if (error) {
    // The one-pending-per-piece rule (unique index) — someone asked first.
    if (error.code === "23505") throw new Error("One of these pieces already has a pending request. Refresh and try again.");
    throw error;
  }
  sendNotification(NOTIFICATION_TYPES.STAGE_REQUEST_RAISED, {
    orderId: order.id,
    orderNo: order.order_no,
    metadata: {
      requested_by: by,
      request_type: type,
      piece_count: rows.length,
      target_label: getStageLabel(targetStage) || targetStage,
    },
  }).catch((err) => console.error("Request notification failed (request WAS sent):", err));
  return group;
}

/**
 * Approve a whole request. First CLAIMS it — flips its still-pending rows to
 * approved in one conditional update — so two people approving at once can't
 * both apply it. Then runs the PM's override on each claimed piece (re-read
 * fresh, so the log records where it really was) and records what happened per
 * piece. A piece the database refuses is marked "not applied" with the reason;
 * the others still go through.
 *
 * @returns {Promise<{claimed: number, applied: number, failed: {barcode: string, error: string}[]}>}
 */
export async function approveRequest(group, by) {
  const decidedAt = new Date().toISOString();
  const { data: claimed, error } = await supabase.from("stage_change_requests")
    .update({ status: "approved", decided_by: by || null, decided_at: decidedAt })
    .eq("request_group", group.group).eq("status", "pending")
    .select(SELECT);
  if (error) throw error;
  if (!claimed?.length) return { claimed: 0, applied: 0, failed: [] };

  let applied = 0;
  const failed = [];
  for (const row of claimed) {
    let ok = false;
    let message = "";
    try {
      const component = await fetchComponentByBarcode(row.barcode);
      const res = await applyStageOverride({
        component,
        kind: kindFor(row.request_type),
        targetStage: row.target_stage,
        reason: `Approved request from ${row.requested_by || "the floor"}: ${row.reason}`,
        by,
      });
      ok = res.success;
      message = res.message || "";
    } catch (err) {
      message = err.message || "Override failed";
    }
    if (ok) applied++;
    else failed.push({ barcode: row.barcode, error: message });
    await supabase.from("stage_change_requests")
      .update({ applied: ok, apply_error: ok ? null : message })
      .eq("id", row.id);
  }

  notifyDecision(group, "approved", { applied, by });
  return { claimed: claimed.length, applied, failed };
}

/** Reject a whole request with a note (required). */
export async function rejectRequest(group, by, note) {
  if (!String(note || "").trim()) throw new Error("Say why it is rejected.");
  const { data, error } = await supabase.from("stage_change_requests")
    .update({ status: "rejected", decided_by: by || null, decided_at: new Date().toISOString(), decision_note: note.trim(), applied: false })
    .eq("request_group", group.group).eq("status", "pending")
    .select("id");
  if (error) throw error;
  if (data?.length) notifyDecision({ ...group, decision_note: note.trim() }, "rejected", { applied: 0, by });
  return data?.length || 0;
}

function notifyDecision(group, decision, { applied }) {
  if (!group.requested_by) return;
  sendNotification(NOTIFICATION_TYPES.STAGE_REQUEST_DECIDED, {
    orderId: group.order_id,
    orderNo: group.order_no,
    metadata: {
      decision,
      request_type: group.request_type,
      piece_count: group.rows.length,
      applied_count: applied,
      target_label: getStageLabel(group.target_stage) || group.target_stage,
      decision_note: group.decision_note || "",
    },
    extraRecipients: [{ email: String(group.requested_by).toLowerCase(), channel: "in_app" }],
  }).catch((err) => console.error("Decision notification failed:", err));
}
