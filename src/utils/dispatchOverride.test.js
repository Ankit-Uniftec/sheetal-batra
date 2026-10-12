const mockAdvance = jest.fn();
const mockShip = jest.fn();
const mockRecord = jest.fn();
jest.mock("./barcodeService", () => ({
  advanceComponentStage: (...a) => mockAdvance(...a),
  createShipment: (...a) => mockShip(...a),
  recordOverride: (...a) => mockRecord(...a),
}));
import { dispatchOverride, pieceBlock, pieceNeed } from "./dispatchOverride";

const order = { id: "o1", order_no: "SB-DLC-1" };
const top = { id: "c1", barcode: "DLC-000001-TOP", current_stage: "embroidery_completed" };
const btm = { id: "c2", barcode: "DLC-000001-BTM", current_stage: "production_complete" };

beforeEach(() => {
  mockAdvance.mockResolvedValue({ success: true });
  mockShip.mockResolvedValue({ success: true });
  mockRecord.mockResolvedValue({});
});

test("each piece: database override to dispatched, one box, one log row", async () => {
  const res = await dispatchOverride({ order, pieces: [top, btm], reason: " label torn ", by: "pack@sb.com" });
  expect(mockAdvance).toHaveBeenCalledWith("DLC-000001-TOP", "dispatched", "pack@sb.com", "Packaging Override",
    "Dispatch override: label torn", "manual_override");
  expect(mockShip).toHaveBeenCalledTimes(1);
  expect(mockShip).toHaveBeenCalledWith("o1", ["c1", "c2"], "pack@sb.com");
  expect(mockRecord).toHaveBeenCalledTimes(2);
  expect(mockRecord.mock.calls[0][0]).toMatchObject({
    componentId: "c1", orderNo: "SB-DLC-1", overrideType: "packaging_override",
    fromStage: "embroidery_completed", toStage: "dispatched", reason: "label torn", overriddenBy: "pack@sb.com",
  });
  expect(res).toEqual({ moved: [top, btm], failed: [], shipmentError: "", logFailed: 0 });
});

test("a refused piece is reported, left out of the box and the log", async () => {
  mockAdvance.mockResolvedValueOnce({ success: false, message: "out at vendor" });
  const res = await dispatchOverride({ order, pieces: [top, btm], reason: "x", by: "p" });
  expect(res.failed).toEqual([{ barcode: "DLC-000001-TOP", error: "out at vendor" }]);
  expect(mockShip).toHaveBeenCalledWith("o1", ["c2"], "p");
  expect(mockRecord).toHaveBeenCalledTimes(1);
});

test("nothing moved → no box; reason and pieces required", async () => {
  mockAdvance.mockResolvedValue({ success: false, message: "no" });
  await dispatchOverride({ order, pieces: [top], reason: "x", by: "p" });
  expect(mockShip).not.toHaveBeenCalled();
  await expect(dispatchOverride({ order, pieces: [top], reason: "  ", by: "p" })).rejects.toThrow(/reason/i);
  await expect(dispatchOverride({ order, pieces: [], reason: "x", by: "p" })).rejects.toThrow(/piece/);
});

test("blocks and needs", () => {
  expect(pieceBlock({ current_stage: "dispatched" })).toBe("Already dispatched");
  expect(pieceBlock({ id: "c9", current_stage: "production_complete" }, new Set(["c9"]))).toBe("Already in a box");
  expect(pieceBlock({ current_stage: "embroidery_in_progress", is_outside_wh: true, vendor_name: "Rana" })).toMatch(/At Rana/);
  expect(pieceBlock(top, new Set())).toBeNull();
  expect(pieceNeed(top)).toBe("Not past Final QC");
  expect(pieceNeed(btm)).toBe("Not scanned");
});
