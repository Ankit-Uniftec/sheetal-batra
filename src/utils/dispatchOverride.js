import { advanceComponentStage, createShipment, recordOverride } from "./barcodeService";

// ============================================================
// Dispatch Override — the packaging desk sends pieces out without the normal
// Packaging & Dispatch scan (meeting points 10 + 34). The client asked for
// BOTH cases: a piece that won't scan, and a piece that has not passed Final
// QC. Reason mandatory, logged; no PM approval (for now).
//
// Per piece it is the database's own override — the same path the PM's
// Manually Advance uses (advance_component_stage, transition 'manual_override',
// which the Final QC lock lets through) — straight to 'dispatched'. Then ONE
// shipment for the box (create_shipment, exactly as the scan does), then a
// stage_overrides row per piece with type 'packaging_override', so the PM's
// override history shows it too. The order completes through the existing
// trigger once nothing is left on the floor.
// ============================================================

export const OVERRIDE_STATION = "Packaging Override";

// Past these the piece needs no Final QC override — only the missing scan.
const QC_DONE = new Set(["final_qc_passed", "production_complete", "packaging_dispatch"]);
const GONE = { dispatched: "Already dispatched", disposed: "Disposed", scrapped: "Scrapped" };

/**
 * Why a piece can't go in the box, or null when it can.
 * A piece out at a vendor stays blocked: it must come back through the gate
 * first, so the vendor trip is closed properly.
 */
export function pieceBlock(c, packedIds) {
  if (GONE[c.current_stage]) return GONE[c.current_stage];
  if (packedIds?.has(c.id)) return "Already in a box";
  if (c.is_outside_wh) return `At ${c.vendor_name || "a vendor"} — bring it back through the gate first`;
  return null;
}

/** What the override skips for this piece — shown so the desk knows what it is signing for. */
export const pieceNeed = (c) => (QC_DONE.has(c.current_stage) ? "Not scanned" : "Not past Final QC");

/**
 * @param {object}   opts
 * @param {object}   opts.order   { id, order_no }
 * @param {object[]} opts.pieces  order_components rows to send
 * @param {string}   opts.reason  required
 * @param {string}   opts.by      packer's email
 * @returns {Promise<{ moved: object[], failed: {barcode, error}[], shipmentError: string, logFailed: number }>}
 */
export async function dispatchOverride({ order, pieces, reason, by }) {
  const why = String(reason || "").trim();
  if (!why) throw new Error("A reason is required for a dispatch override.");
  if (!pieces?.length) throw new Error("Pick at least one piece.");

  const moved = [];
  const failed = [];
  for (const c of pieces) {
    try {
      const res = await advanceComponentStage(c.barcode, "dispatched", by, OVERRIDE_STATION,
        `Dispatch override: ${why}`, "manual_override");
      if (res?.success === false) failed.push({ barcode: c.barcode, error: res.message || res.error || "refused" });
      else moved.push(c);
    } catch (err) {
      failed.push({ barcode: c.barcode, error: err.message || "failed" });
    }
  }

  // The box. Non-fatal like the scan's own: the pieces have left either way,
  // and create_shipment can be re-run for them later.
  let shipmentError = "";
  if (moved.length) {
    try {
      const ship = await createShipment(order.id, moved.map((c) => c.id), by);
      if (!ship?.success) shipmentError = ship?.message || ship?.error || "shipment not recorded";
    } catch (err) {
      shipmentError = err.message || "shipment not recorded";
    }
  }

  let logFailed = 0;
  for (const c of moved) {
    try {
      await recordOverride({
        componentId: c.id, orderId: order.id, orderNo: order.order_no, barcode: c.barcode,
        overrideType: "packaging_override", fromStage: c.current_stage, toStage: "dispatched",
        reason: why, overriddenBy: by,
      });
    } catch (err) {
      console.error("Dispatch override log failed:", err);
      logFailed += 1;
    }
  }

  return { moved, failed, shipmentError, logFailed };
}
