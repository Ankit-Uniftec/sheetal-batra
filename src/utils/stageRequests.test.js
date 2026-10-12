// Skip / advance requests (meeting point 5): which pieces can be asked for,
// how rows group back into requests, and that approving claims the request
// once and records each piece's outcome.
const mockUpdates = [];
let mockClaimRows = [];
jest.mock("../lib/supabaseClient", () => ({
  supabase: {
    from: () => ({
      update: (patch) => {
        const call = { patch, filters: [] };
        mockUpdates.push(call);
        const chain = {
          eq: (col, val) => { call.filters.push([col, val]); return chain; },
          select: () => Promise.resolve({ data: call.patch.status ? mockClaimRows : [], error: null }),
          then: (res) => Promise.resolve({ error: null }).then(res),
        };
        return chain;
      },
    }),
  },
}));
const mockFetch = jest.fn();
jest.mock("./barcodeService", () => ({
  fetchComponentByBarcode: (...a) => mockFetch(...a),
  getStageLabel: (s) => s,
}));
const mockApply = jest.fn();
jest.mock("./stageOverride", () => ({ applyStageOverride: (...a) => mockApply(...a) }));
jest.mock("./notificationService", () => ({
  NOTIFICATION_TYPES: { STAGE_REQUEST_RAISED: "r", STAGE_REQUEST_DECIDED: "d" },
  sendNotification: () => Promise.resolve(null),
}));

import { pieceBlock, groupRequests, pieceProductName, approveRequest, canRequestStageChange } from "./stageRequests";

beforeEach(() => { mockUpdates.length = 0; mockClaimRows = []; });

test("which pieces can be requested", () => {
  const pending = new Set(["p1"]);
  expect(pieceBlock({ id: "p1", current_stage: "stitching_in_progress" }, pending)).toMatch(/pending request/);
  expect(pieceBlock({ id: "p2", current_stage: "dispatched" }, pending)).toBe("Dispatched");
  expect(pieceBlock({ id: "p3", current_stage: "disposed" }, pending)).toMatch(/Disposed/);
  expect(pieceBlock({ id: "p4", current_stage: "embroidery_in_progress", is_outside_wh: true, vendor_name: "Shah" }, pending)).toBe("At vendor (Shah)");
  expect(pieceBlock({ id: "p5", current_stage: "order_received" }, pending)).toBeNull();
});

test("product name comes from the piece's item on the order", () => {
  const order = { items: [{ product_name: "Kurta Set" }, { product_name: "Potli" }] };
  expect(pieceProductName(order, { item_index: 1 })).toBe("Potli");
  expect(pieceProductName(order, {})).toBe("Kurta Set");
});

test("rows group back into requests, newest first; pending wins", () => {
  const g = groupRequests([
    { request_group: "a", requested_at: "2026-10-12T08:00:00Z", status: "approved", applied: true },
    { request_group: "b", requested_at: "2026-10-12T09:00:00Z", status: "pending" },
    { request_group: "a", requested_at: "2026-10-12T08:00:00Z", status: "approved", applied: false },
    { request_group: "b", requested_at: "2026-10-12T09:00:00Z", status: "approved" },
  ]);
  expect(g.map((x) => [x.group, x.status, x.rows.length])).toEqual([["b", "pending", 2], ["a", "approved", 2]]);
  expect(g[1].appliedCount).toBe(1);
});

test("approve: claims only pending rows, applies each, a refused piece doesn't stop the rest", async () => {
  mockClaimRows = [
    { id: "r1", barcode: "B1", request_type: "skip", target_stage: "final_qc_in_progress", reason: "pre-dyed", requested_by: "ph@sb.com" },
    { id: "r2", barcode: "B2", request_type: "skip", target_stage: "final_qc_in_progress", reason: "pre-dyed", requested_by: "ph@sb.com" },
  ];
  mockFetch.mockImplementation((b) => Promise.resolve({ id: b, barcode: b, current_stage: "dyeing_in_progress" }));
  mockApply.mockImplementation(({ component }) => Promise.resolve(
    component.barcode === "B2" ? { success: false, message: "out at vendor" } : { success: true }));

  const res = await approveRequest({ group: "g1", rows: mockClaimRows, request_type: "skip", order_no: "SB-X", requested_by: "ph@sb.com" }, "pm@sb.com");

  // 1) the claim is conditional on status = pending
  expect(mockUpdates[0].patch.status).toBe("approved");
  expect(mockUpdates[0].filters).toEqual([["request_group", "g1"], ["status", "pending"]]);
  // 2) the PM's own override, skip kind, with the requester named in the reason
  expect(mockApply.mock.calls[0][0]).toMatchObject({ kind: "skip_stage", targetStage: "final_qc_in_progress", by: "pm@sb.com" });
  expect(mockApply.mock.calls[0][0].reason).toMatch(/ph@sb\.com: pre-dyed/);
  // 3) per-piece outcome recorded
  expect(res).toEqual({ claimed: 2, applied: 1, failed: [{ barcode: "B2", error: "out at vendor" }] });
  expect(mockUpdates.slice(1).map((u) => u.patch)).toEqual([
    { applied: true, apply_error: null },
    { applied: false, apply_error: "out at vendor" },
  ]);
});

test("approve: nothing left to claim (someone else decided) → applies nothing", async () => {
  mockClaimRows = [];
  const res = await approveRequest({ group: "g2", rows: [], request_type: "advance" }, "pm@sb.com");
  expect(res).toEqual({ claimed: 0, applied: 0, failed: [] });
  expect(mockApply).not.toHaveBeenCalled();
});

test("guards and the packing desk can't request; everyone else can", () => {
  expect(canRequestStageChange(["security_gate"])).toBe(false);      // guards
  expect(canRequestStageChange(["packaging"])).toBe(false);          // packing desk
  expect(canRequestStageChange(["security_gate", "packaging"])).toBe(false);
  expect(canRequestStageChange(["stitching"])).toBe(true);
  expect(canRequestStageChange(["qc", "final_qc"])).toBe(true);
  expect(canRequestStageChange(["packaging", "stitching"])).toBe(true);
  expect(canRequestStageChange(null)).toBe(true);                    // every station
  expect(canRequestStageChange(undefined)).toBe(true);
});
