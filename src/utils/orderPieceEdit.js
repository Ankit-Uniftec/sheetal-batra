import { buildOrderComponents, getBarcodeRoot } from "./barcodeService";
import { pieceState } from "./breakdownChange";

// ============================================================
// Editing dupatta and extras on a placed order (point #9, Release 27).
//
// Works out, BEFORE anything is saved, what a change means for the pieces and
// the money. The database function (edit_order_pieces, db r27_01) re-checks
// every piece and works out the money again from the stored order; this is the
// preview, and what it is asked to do.
//
// Extra barcodes follow position, so pieces are matched by barcode. Removing
// EX1 of two extras therefore renames EX1 to the second garment and removes
// EX2. Both must be unstarted, which is why a started later extra blocks it.
// ============================================================

const IN_SCOPE = new Set(["dupatta", "extra"]);
const clean = (s) => String(s ?? "").trim();

/** Sum of extras prices across an items array. */
export const extrasTotal = (items) =>
  (items || []).reduce(
    (sum, it) => sum + (Array.isArray(it?.extras) ? it.extras : []).reduce((s, x) => s + (Number(x?.price) || 0), 0),
    0
  );

const pieceShape = (it) => JSON.stringify([
  it?.includes_dupatta === true,
  (Array.isArray(it?.extras) ? it.extras : []).map((x) => clean(x?.name)),
]);

/**
 * Which products had their dupatta or extras changed. Only those are planned:
 * an old order whose flags and pieces already disagree must not have pieces
 * removed, or its edit blocked, by a change nobody made to it.
 */
export function touchedItemIndexes(oldItems, newItems) {
  const touched = new Set();
  const count = Math.max((oldItems || []).length, (newItems || []).length);
  for (let i = 0; i < count; i += 1) {
    if (pieceShape(oldItems?.[i]) !== pieceShape(newItems?.[i])) touched.add(i);
  }
  return touched;
}

/**
 * @param {object}   order       { id, order_no, items }
 * @param {object[]} newItems    the order's items after the edit
 * @param {object[]} components  its order_components rows
 * @param {Set}      packedIds   component ids in a live box
 * @returns {{ add: object[], remove: object[], relabel: {id, label}[], blocked: {barcode, why}[], changed: boolean }}
 */
export function planPieceSync(order, newItems, components, packedIds) {
  const { storeCode, seqPart } = getBarcodeRoot(order.order_no);
  const root = `${storeCode}-${seqPart}-`;
  const touched = touchedItemIndexes(order.items, newItems);
  const target = buildOrderComponents({ ...order, items: newItems }).filter(
    (t) => IN_SCOPE.has(t.component_type) && touched.has(t.item_index ?? 0)
  );
  const live = (components || []).filter(
    (c) =>
      !c.cancelled_at &&
      IN_SCOPE.has(c.component_type) &&
      touched.has(c.item_index ?? 0) &&
      String(c.barcode).startsWith(root)
  );
  const targetByBarcode = new Map(target.map((t) => [t.barcode, t]));
  const liveBarcodes = new Set(live.map((c) => c.barcode));

  const add = target.filter((t) => !liveBarcodes.has(t.barcode));
  const remove = [];
  const relabel = [];
  const blocked = [];
  const stateOf = (c) => pieceState(c, packedIds);

  live.forEach((c) => {
    const t = targetByBarcode.get(c.barcode);
    if (!t) {
      const st = stateOf(c);
      if (st.state === "fresh") remove.push(c);
      else blocked.push({ barcode: c.barcode, why: st.why || "has already started production" });
      return;
    }
    if (c.component_type === "extra" && clean(c.component_label) !== clean(t.component_label)) {
      const st = stateOf(c);
      if (st.state === "fresh") relabel.push({ id: c.id, label: t.component_label });
      else blocked.push({ barcode: c.barcode, why: st.why || "has already started production" });
    }
  });

  (newItems || []).forEach((it, i) => {
    if (!touched.has(i)) return;
    const hasGarment = [it?.top, it?.bottom].some((g) => clean(g) && !["na", "n/a"].includes(clean(g).toLowerCase()));
    const hasExtras = Array.isArray(it?.extras) && it.extras.length > 0;
    if (!hasGarment && !it?.includes_dupatta && !hasExtras) {
      blocked.push({ barcode: it?.product_name || `Product ${i + 1}`, why: "would have no pieces left" });
    }
  });

  return { add, remove, relabel, blocked, changed: add.length + remove.length + relabel.length > 0 };
}

/**
 * The order's money after the edit. Discounts never apply to extras, so the
 * full price moves. A 0-total order (free, stock, gift) stays at 0.
 * @returns {{ delta: number, oldTotal: number, newTotal: number, newDue: number, belowPaid: boolean }}
 */
export function previewMoney(order, newItems) {
  const oldTotal = Number(order?.net_total ?? order?.grand_total_after_discount ?? order?.grand_total ?? 0);
  const paid = Number(order?.total_paid) || 0;
  const delta = Number(order?.grand_total) > 0 ? extrasTotal(newItems) - extrasTotal(order?.items) : 0;
  const newTotal = oldTotal + delta;
  return {
    delta,
    oldTotal,
    newTotal,
    newDue: Math.max(0, newTotal - paid),
    belowPaid: delta !== 0 && (newTotal < paid || newTotal < 0),
  };
}

/** One piece's state by position, for showing it locked in the popup. */
export function pieceLock(components, packedIds, itemIndex, type, extraIndex = null) {
  const c = (components || []).find(
    (p) =>
      !p.cancelled_at &&
      p.component_type === type &&
      (p.item_index ?? 0) === itemIndex &&
      (type !== "extra" || p.extra_index === extraIndex)
  );
  if (!c) return null;
  const st = pieceState(c, packedIds);
  return st.state === "fresh" ? null : st.why || "Started";
}

/** The arguments edit_order_pieces takes for a plan. */
export const planToRpcArgs = (plan) => ({
  p_remove: plan.remove.map((c) => c.id),
  p_relabel: plan.relabel,
  p_add: plan.add.map((t) => ({
    barcode: t.barcode,
    component_type: t.component_type,
    component_label: t.component_label,
    item_index: t.item_index ?? 0,
    extra_index: t.extra_index,
  })),
});
