import { buildOrderComponents } from "./barcodeService";

// ============================================================
// Changing a wrong garment breakdown (meeting point 8, Release 11).
//
// A line's breakdown ("Top + Bottom", "Extras only"…) decides its barcodes.
// When it is corrected, this works out — BEFORE anything is saved — what
// happens to every piece of that line:
//   keep     same barcode in the old and the new breakdown
//   convert  an old piece paired 1:1 with a new one (Top → Extra): the SAME
//            piece keeps its history and stage, gets the new barcode / type /
//            label, and its old barcode stays scannable (barcode_aliases)
//   remove   an old piece with no partner that never started → deleted
//   retire   an old piece with no partner that HAS started → taken off the
//            floor (only from the Breakdown Changes screen)
//   add      a new piece with no partner → minted by the re-map, as today
// The database function (r11_01) re-checks every piece; this is the preview.
//
// New barcodes come from the app's own buildOrderComponents, which is kept in
// step with the sync function's — so the re-map that follows finds exactly
// these barcodes and mints only the genuinely new ones.
// ============================================================

const RANK = { top: 0, bottom: 1, dupatta: 2, extra: 3 };
const byRank = (a, b) => (RANK[a.component_type] ?? 9) - (RANK[b.component_type] ?? 9)
  || String(a.barcode).localeCompare(String(b.barcode));

/** The line as the sync function's applyBreakdownOverride makes it (mapper.ts). */
export function applyChoiceToItem(item, choice) {
  return {
    ...item,
    top: choice.top || "",
    bottom: choice.bottom || "",
    includes_dupatta: choice.includes_dupatta === true,
    extras: choice.includes_extra === true
      ? [{ name: String(item?.product_name || "").trim() || "Extra" }]
      : [],
  };
}

/** The pieces the line WOULD have under `choice`. */
export function targetPieces(order, itemIndex, choice) {
  const items = (order.items || []).map((it, i) => (i === itemIndex ? applyChoiceToItem(it, choice) : it));
  return buildOrderComponents({ ...order, items }).filter((c) => (c.item_index ?? 0) === itemIndex);
}

/**
 * Where a piece stands, for the change.
 *   "fresh"   never started — safe to delete
 *   "started" activated / scanned — can only be converted or retired
 *   blocked reasons: at a vendor, packed / dispatched, already retired
 */
export function pieceState(c, packedIds) {
  if (c.cancelled_at) return { state: "blocked", why: "Already taken off the floor" };
  if (c.current_stage === "dispatched") return { state: "blocked", why: "Already dispatched" };
  if (packedIds?.has(c.id)) return { state: "blocked", why: "Already packed in a box" };
  if (c.is_outside_wh) return { state: "blocked", why: `At ${c.vendor_name || "a vendor"} — bring it back through the gate first` };
  if (c.is_active || (c.current_stage && c.current_stage !== "order_received")) return { state: "started" };
  return { state: "fresh" };
}

/**
 * @param {object[]} current  the line's existing pieces (order_components rows)
 * @param {object[]} target   targetPieces(...)
 * @param {Set}      packedIds component ids in a live box
 * @returns {{ keep, convert: {from, to}[], remove, retire, add, blocked: {piece, why}[], startedCount }}
 */
export function planBreakdownChange(current, target, packedIds) {
  const live = current.filter((c) => !c.cancelled_at);
  const targetBarcodes = new Set(target.map((t) => t.barcode));
  const currentBarcodes = new Set(live.map((c) => c.barcode));

  const keep = live.filter((c) => targetBarcodes.has(c.barcode));
  const leaving = live.filter((c) => !targetBarcodes.has(c.barcode)).sort(byRank);
  const arriving = target.filter((t) => !currentBarcodes.has(t.barcode)).sort(byRank);

  const convert = [];
  const remove = [];
  const retire = [];
  const blocked = [];
  leaving.forEach((piece, i) => {
    const st = pieceState(piece, packedIds);
    if (st.state === "blocked") { blocked.push({ piece, why: st.why }); return; }
    const to = arriving[i];
    if (to) convert.push({ from: piece, to, started: st.state === "started" });
    else if (st.state === "fresh") remove.push(piece);
    else retire.push(piece);
  });
  const add = arriving.slice(leaving.length);

  const startedCount = convert.filter((c) => c.started).length + retire.length;
  return { keep, convert, remove, retire, add, blocked, startedCount };
}

/** True when nothing would change for the line. */
export const isNoChange = (plan) =>
  !plan.convert.length && !plan.remove.length && !plan.retire.length && !plan.add.length && !plan.blocked.length;
