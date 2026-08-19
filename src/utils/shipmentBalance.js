// What is owed for one shipment.
//
// A shipment is a box holding some of an order's components (78_shipments.sql). The
// customer owes it the value of the garments inside, less their share of whatever has
// already been paid.
//
// ── HOW THE MONEY SPLITS ──────────────────────────────────────────────────────
//   shipmentTotal     = Σ itemAmounts(order, item).final  for the items in the box
//   advanceShare      = the order-time advance, pro-rata by shipmentTotal
//   unattributedShare = payments with no shipment_id, pro-rata the same way
//   paidDirect        = payments collected against THIS shipment
//   balance           = shipmentTotal − advanceShare − unattributedShare − paidDirect
//
// Pro-rata for the advance because a ₹10,000 advance on a ₹33,000 order covers ~30% of
// every garment — it is not "the first box is paid for". Unattributed payments spread
// the same way, so an order that took an order-level balance payment before shipments
// existed does not show every box still fully owing.
//
// ── ROUNDING ──────────────────────────────────────────────────────────────────
// Shares are allocated with a running remainder and the LAST box absorbs the
// difference, so Σ shares === the amount being split, exactly. Naive per-box rounding
// leaks rupees, and a leak here means a customer is asked for the wrong amount.
//
// ── WHY THIS THROWS ───────────────────────────────────────────────────────────
// If the items do not add up to the order's own total, the basis for every share is
// wrong and every balance derived from it is wrong. Rather than quietly collecting a
// figure nobody can reconcile, it refuses and names both numbers.

import { itemAmounts, orderItemsFinal } from "./itemNetAmount";

export const orderNetTotal = (order) =>
    Number(order?.net_total ?? order?.grand_total_after_discount ?? order?.grand_total ?? 0);

// Allocate `total` across `weights`, exactly. Last weight takes the remainder.
export const allocate = (total, weights) => {
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum <= 0) return weights.map(() => 0);
    let used = 0;
    return weights.map((w, i) => {
        if (i === weights.length - 1) return round2(total - used);
        const share = round2((total * w) / sum);
        used = round2(used + share);
        return share;
    });
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// The item indexes a shipment covers, from its component rows.
// Components carry item_index for display; the shipment's CONTENTS are keyed on
// component id (see 78's header) — this only maps them back to items for pricing.
export const shipmentItemIndexes = (shipmentComponents = []) =>
    [...new Set(shipmentComponents.map((c) => c.item_index ?? 0))].sort((a, b) => a - b);

/**
 * Balances for every shipment of an order, in one pass so the pro-rata shares are
 * allocated against each other and sum exactly.
 *
 * @param {object} order        the order row (items, net_total, advance_payment)
 * @param {Array}  shipments    [{ id, status, ... }]
 * @param {Array}  components   order_components rows, each with { id, item_index }
 * @param {Array}  links        shipment_components rows [{ shipment_id, component_id }]
 * @param {Array}  payments     order_payments rows [{ amount, shipment_id }]
 * @returns {Map<string, {total, advanceShare, unattributedShare, paidDirect, balance, itemIndexes}>}
 */
export function shipmentBalances(order, shipments = [], components = [], links = [], payments = []) {
    const items = order?.items || [];
    const netTotal = orderNetTotal(order);

    // Refuse to split a basis that does not reconcile — see header.
    const itemsFinal = round2(orderItemsFinal(order));
    if (items.length > 0 && Math.abs(itemsFinal - round2(netTotal)) > 1) {
        throw new Error(
            `Cannot split this order per shipment: its products add up to ₹${itemsFinal} ` +
            `but the order total is ₹${round2(netTotal)}. Fix the order's pricing first.`
        );
    }

    const componentById = new Map(components.map((c) => [c.id, c]));
    const bySh = new Map(shipments.map((s) => [s.id, []]));
    links.forEach((l) => {
        const c = componentById.get(l.component_id);
        if (c && bySh.has(l.shipment_id)) bySh.get(l.shipment_id).push(c);
    });

    // Each shipment's worth. An item is priced into the FIRST shipment that carries any
    // of its components: components of one garment ship together in practice, and
    // charging the same garment to two boxes would double-bill.
    const claimed = new Set();
    const totals = shipments.map((s) => {
        const idxs = shipmentItemIndexes(bySh.get(s.id) || []);
        let t = 0;
        idxs.forEach((i) => {
            if (claimed.has(i)) return;
            claimed.add(i);
            if (items[i]) t += itemAmounts(order, items[i]).final;
        });
        return round2(t);
    });

    const advance = Number(order?.advance_payment) || 0;
    const unattributed = payments
        .filter((p) => !p.shipment_id)
        .reduce((s, p) => s + (Number(p.amount) || 0), 0);

    const advanceShares = allocate(advance, totals);
    const unattribShares = allocate(unattributed, totals);

    const out = new Map();
    shipments.forEach((s, i) => {
        const paidDirect = payments
            .filter((p) => p.shipment_id === s.id)
            .reduce((a, p) => a + (Number(p.amount) || 0), 0);

        const balance = Math.max(
            0,
            round2(totals[i] - advanceShares[i] - unattribShares[i] - paidDirect)
        );

        out.set(s.id, {
            total: totals[i],
            advanceShare: advanceShares[i],
            unattributedShare: unattribShares[i],
            paidDirect: round2(paidDirect),
            balance,
            itemIndexes: shipmentItemIndexes(bySh.get(s.id) || []),
        });
    });
    return out;
}
