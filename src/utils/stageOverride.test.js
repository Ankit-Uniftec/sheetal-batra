// Pins the PM's Manually Advance / Skip to Stage to exactly what the Overrides
// screen did before it was lifted into utils/stageOverride (meeting point 5):
// the database override with 'manual_override', then the stage_overrides log.
const mockAdvance = jest.fn();
const mockRecord = jest.fn();
jest.mock("./barcodeService", () => ({
  advanceComponentStage: (...a) => mockAdvance(...a),
  recordOverride: (...a) => mockRecord(...a),
}));
import { applyStageOverride } from "./stageOverride";

const comp = { id: "c1", order_id: "o1", order_no: "SB-DLC-1", barcode: "DLC-000001-TOP", current_stage: "dyeing_in_progress" };

test("manual advance: same call and log as before", async () => {
  mockAdvance.mockResolvedValue({ success: true });
  mockRecord.mockResolvedValue({});
  const res = await applyStageOverride({ component: comp, kind: "manual_advance", targetStage: "stitching_in_progress", reason: "pre-dyed", by: "pm@sb.com" });
  expect(res).toEqual({ success: true });
  expect(mockAdvance).toHaveBeenCalledWith("DLC-000001-TOP", "stitching_in_progress", "pm@sb.com", "Production Head Override", "pre-dyed", "manual_override");
  expect(mockRecord).toHaveBeenCalledWith({
    componentId: "c1", orderId: "o1", orderNo: "SB-DLC-1", barcode: "DLC-000001-TOP",
    overrideType: "manual_advance", fromStage: "dyeing_in_progress", toStage: "stitching_in_progress",
    reason: "pre-dyed", overriddenBy: "pm@sb.com",
  });
});

test("skip: note keeps its 'Skip: ' prefix and logs as skip_stage", async () => {
  mockAdvance.mockResolvedValue({ success: true });
  mockRecord.mockResolvedValue({});
  await applyStageOverride({ component: comp, kind: "skip_stage", targetStage: "final_qc_in_progress", reason: "no hemming", by: "pm@sb.com" });
  expect(mockAdvance.mock.calls[0][4]).toBe("Skip: no hemming");
  expect(mockRecord.mock.calls[0][0].overrideType).toBe("skip_stage");
});

test("a refused override is reported and NOT logged", async () => {
  mockAdvance.mockResolvedValue({ success: false, message: "out at vendor" });
  const res = await applyStageOverride({ component: comp, kind: "skip_stage", targetStage: "final_qc_in_progress", reason: "x", by: "pm@sb.com" });
  expect(res).toEqual({ success: false, message: "out at vendor" });
  expect(mockRecord).not.toHaveBeenCalled();
});

test("reason and target are required", async () => {
  await expect(applyStageOverride({ component: comp, kind: "skip_stage", targetStage: "", reason: "x", by: "p" })).rejects.toThrow(/target/);
  await expect(applyStageOverride({ component: comp, kind: "skip_stage", targetStage: "qc", reason: " ", by: "p" })).rejects.toThrow(/Reason/);
  expect(mockAdvance).not.toHaveBeenCalled();
});
