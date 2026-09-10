/**
 * STOCK ORDER → PRODUCTION HEAD OVERRIDE
 *
 * A stock order's production head used to be derived entirely from the flow
 * that raised it: retail stock (SB-STOCK-…) belonged to the Offline head, B2B
 * stock (SB-B2BSTOCK-…) to the B2B head, decided at placement and unchangeable.
 * The B2B head could not see a retail stock order, and vice versa, even when
 * their team was physically running the pieces.
 *
 * This module is the one definition of the override that fixes that. The SA
 * picks a head while raising the order; that head's dashboard then shows it.
 *
 * TWO PROPERTIES THAT ARE EASY TO BREAK — read before editing:
 *
 * 1. IT IS ADDITIVE, NOT A REASSIGNMENT. The order keeps appearing everywhere
 *    it already does: the placing SA's dashboard, the warehouse, the PM. The
 *    selected head gains it ON TOP. Never "move" an order by making the
 *    default owner's query exclude assigned rows — that turns a visibility
 *    feature into a silent handoff, and the SA who raised the order loses it.
 *
 * 2. IT STORES A DESIGNATION, NOT AN EMAIL. Same shape as
 *    orders.comms_order_assign: the head of a channel is a role that changes
 *    hands, and those dropdown addresses are not necessarily real logins.
 *    Resolution to a mailbox happens at send time in SQL
 *    (resolve_email_by_designation) so replacing the person needs no backfill.
 *
 * Mirrors db/barcode_system/v2/90_stock_order_production_head.sql. The CHECK
 * constraint there accepts exactly the designations listed below — add to one
 * without the other and placement fails at the insert with a constraint error.
 */

// The heads a stock order may be pointed at. Deliberately only the two that
// actually run stock production: offering Online Production Head or Private SA
// would push stock into queues nobody watches, and an unwatched queue is worse
// than no assignment at all.
//
// `name` is display-only — the designation is what is stored and matched.
export const STOCK_HEAD_OPTIONS = [
  { name: "Khushnuma Khan", designation: "Offline Production Head" },
  { name: "Tara Gupta", designation: "B2B Production Head" },
];

export const STOCK_HEAD_DESIGNATIONS = STOCK_HEAD_OPTIONS.map((o) => o.designation);

/** Is this a designation a stock order may be assigned to? Guards the write. */
export function isValidStockHeadDesignation(designation) {
  const d = (designation || "").trim();
  return STOCK_HEAD_DESIGNATIONS.some((v) => v.toLowerCase() === d.toLowerCase());
}

/**
 * The designation explicitly assigned to this order, or null.
 *
 * Only trusts a value that is BOTH a stock order and a recognised designation.
 * A stray value on a non-stock row (nothing writes one today) must not quietly
 * start rerouting a customer order's escalations, and an unrecognised string
 * resolves to no mailbox — so both are treated as "not assigned" here, matching
 * the SQL resolver's fall-through.
 */
export function getAssignedHeadDesignation(order) {
  if (!order?.is_stock_order) return null;
  const d = (order.production_head_designation || "").trim();
  return isValidStockHeadDesignation(d) ? d : null;
}

/** Is this order explicitly assigned to the head holding `designation`? */
export function isAssignedToHead(order, designation) {
  const assigned = getAssignedHeadDesignation(order);
  if (!assigned || !designation) return false;
  return assigned.toLowerCase() === String(designation).trim().toLowerCase();
}
