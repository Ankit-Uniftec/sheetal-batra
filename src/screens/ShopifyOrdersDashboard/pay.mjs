// Shopify payment state: the COD tags, the one-word badge, and the payment
// hold that decides whether an order is cleared for the work queue.
//
// A plain .mjs with no React and no imports so node can run it directly — the
// dashboard imports it as ./pay.mjs (fully specified, which webpack needs for
// .mjs) and payment.test.mjs runs the SAME code, not a copy of it:
//   node src/screens/ShopifyOrdersDashboard/payment.test.mjs

// ─── Shopify payment state ─────────────────────────────────────────────────

// The COD-related tags on an order, from the stored array.
//
// `shopify_tags` is a SHARED field: alongside the payment tags it carries
// gateway names (GoKwik, UPI, Cards, Wallets), GoKwik risk scores (Low/Medium/
// High Risk), campaign codes (SB-lxrts_delhi_mumbai_…), call-attempt notes and
// marketing-automation tags. Only the payment ones belong on a warehouse card.
//
// Anchored, NOT a bare /cod/ substring. Live PROD tags include
//   "SW-WhatsApp COD Confirmation & COD to pr"
// — a truncated marketing-automation tag that a substring match would render as
// a COD chip and count as a COD order in the filter. Requiring the tag to START
// with COD keeps the real ones ("COD", "COD Confirmed") and drops that.
//
// Still a pattern rather than a fixed list, so a new payment tag in the same
// shape ("COD Cancelled", …) works with no code change.
const COD_TAG_RE = /^cod\b/i;

const codTags = (order) =>
  (order?.shopify_tags || []).filter((t) => COD_TAG_RE.test(String(t).trim()));

// Has a COD order been CONFIRMED? GoKwik adds "COD Confirmed" alongside the
// plain "COD" tag once the customer verifies the order by call or WhatsApp.
// Matched on the whole tag so a bare "COD" can never satisfy it.
//
// "Labels Confirmed" (in any wording containing those words, e.g. "Only
// Labels Confirmed") counts the same as "COD Confirmed" (asked for
// 2026-09-02): the labels workflow is an alternative confirmation path, so an
// order carrying it is cleared for production even without a COD tag.
const isCodConfirmed = (order) =>
  (order?.shopify_tags || []).some((t) => {
    const tag = String(t).trim();
    return /^cod\s+confirmed\b/i.test(tag) || /\blabels?\s+confirmed\b/i.test(tag);
  });

// Does this order settle as COD? Any COD tag, or a confirmation tag — a
// labels-confirmed order is COD by definition even when the bare "COD" tag
// never got written. Used by the filter and the issue detail.
export const isCodTagged = (order) => codTags(order).length > 0 || isCodConfirmed(order);

// ─── Payment badge: one word for where the money got to ───────────────────
//
// The card used to print Shopify's raw `displayFinancialStatus` ("PENDING",
// "PARTIALLY_PAID") plus one chip per COD tag, so an order could read
// "PENDING · COD · COD Confirmed" — three chips saying one thing, in Shopify's
// vocabulary rather than the floor's.
//
// Now it says ONE thing:
//   COD + confirmed              → COD Confirmed
//   any other COD tag            → COD          (collects on delivery)
//   PAID                         → Fully Paid
//   PARTIALLY_PAID / AUTHORIZED  → Partial Paid
//   REFUNDED / VOIDED / …        → the end state, said plainly
//   anything else                → Not Paid
//
// COD wins over the status because it describes how the order settles at all —
// a COD order sitting at PENDING is not "not paid", it is waiting for the
// courier.
//
// Confirmed and unconfirmed COD are told apart, because they land on DIFFERENT
// TABS: a confirmed COD is in the work queue and cleared to cut, an unconfirmed
// one is held in Needs Review until the customer verifies by call or WhatsApp.
// Showing both as a bare "COD" would make two operationally different states
// look identical on the badge row.
const PAYMENT_STATUS_LABELS = {
  PAID: "Fully Paid",
  PARTIALLY_PAID: "Partial Paid",
  AUTHORIZED: "Partial Paid",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Partially Refunded",
  VOIDED: "Voided",
  CANCELLED: "Cancelled",
};

export const paymentLabel = (order) => {
  // Confirmation first: it also covers labels-confirmed orders with no COD tag.
  if (isCodConfirmed(order)) return "COD Confirmed";
  if (isCodTagged(order)) return "COD";
  const s = String(order?.shopify_financial_status || "").toUpperCase();
  return PAYMENT_STATUS_LABELS[s] || "Not Paid";
};

export const paymentLabelVariant = (label) => {
  // Confirmed COD is cleared to work on, so it reads like a settled state.
  if (label === "Fully Paid" || label === "COD Confirmed") return "success";
  if (label === "COD") return "info";
  if (label === "Partial Paid" || label === "Not Paid") return "warning";
  return "danger";
};

// ─── Payment hold: is this order cleared to be worked on? ──────────────────
//
// The Orders tab is the WORK QUEUE — everything on it is cleared to cut. An
// order whose money is not settled sits in Needs Review until it is, because
// the one irreversible thing here is cutting cloth for an order that is never
// paid for.
//
// Three ways to clear, matching how the business actually takes money:
//   • Prepaid  — Shopify says PAID.
//   • COD      — Shopify says PENDING and stays that way (it collects on
//                delivery, so it never flips to PAID). The confirmation call is
//                what makes it real, so "COD Confirmed" clears it.
//   • Part-paid — PARTIALLY_PAID / AUTHORIZED. Money is down and the customer
//                is committed, so these belong in the work queue (asked for
//                2026-09-03) rather than in Needs Review, where they buried the
//                orders that genuinely need a fix. The "Partial Paid" badge
//                still says a balance is outstanding, and dispatch has its own
//                fully-paid gate.
//
// Anything else — PENDING with no confirmation, a bare "COD" tag still awaiting
// the call — is held.
//
// REFUNDED / VOIDED / CANCELLED are deliberately NOT holds. Those are
// end-states, not "waiting for money", and an order cancelled mid-production is
// its own operational decision — sweeping it in here would misrepresent it as a
// payment problem.
//
// Reads ONLY Shopify's own words. Nothing here uses the mapper's isCod
// derivation, which treats every PENDING order as COD and over-matches.
const PARTIAL_PAID_STATES = new Set(["PARTIALLY_PAID", "AUTHORIZED"]);

const PAYMENT_END_STATES = new Set([
  "REFUNDED", "VOIDED", "PARTIALLY_REFUNDED", "CANCELLED",
]);

export const isPaymentHeld = (order) => {
  const s = String(order?.shopify_financial_status || "").toUpperCase();
  // No status at all: nothing to judge. Don't invent a hold — a missing value
  // is a sync gap, not evidence the order is unpaid.
  if (!s) return false;
  if (s === "PAID" || PARTIAL_PAID_STATES.has(s) || PAYMENT_END_STATES.has(s))
    return false;
  // Everything below is money-not-settled. A confirmed COD is the one case the
  // business treats as good to work on despite that.
  return !isCodConfirmed(order);
};
