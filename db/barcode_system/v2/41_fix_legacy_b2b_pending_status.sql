-- ============================================================
-- 41. Legacy B2B orders stuck at status='Pending' — mark delivered + approved.
--
-- WHY: four Feb-2026 B2B orders (SB-B2B-0226-000078, -000080, -000155,
-- -000376) still carry status='Pending' and approval_status='pending'. They
-- were made and delivered at the time, but they predate BOTH the B2B approval
-- flow and the barcode/warehouse production tracking — which is why their
-- warehouse_stage is still 'order_received' and dispatched_at/delivered_at are
-- null. That absence is missing history, not evidence they were never made.
--
-- Migration 40 flagged them is_b2b, so they now surface in the merchandiser's
-- approval queue as if they were awaiting action, six months after delivery.
-- 40's auto-approve pass skipped them because it only matched orders whose
-- status was already terminal ('completed'/'delivered'/'cancelled') — theirs
-- says 'Pending'.
--
-- The durable fix is to make the status truthful: they were delivered, so say
-- delivered, and approve them (same reasoning as 40 — they demonstrably went
-- through the business process; there is nothing left to approve). The
-- merchandiser queue then drops them via the normal terminal-status filter.
--
-- delivered_at is deliberately left NULL: we do not know the real delivery
-- date and inventing one would corrupt the delivery report (which buckets a
-- delivered order with no date under "no_date" rather than fabricating a
-- lateness). Status is the fact we know; the timestamp is not.
--
-- NOTE the capitalised 'Pending' — this column holds mixed casing, so the
-- match is done case-insensitively.
--
-- Idempotent: re-running matches nothing once fixed.
-- Run on uat first, then prod.
-- ============================================================

-- PREVIEW — exactly the rows that will change (expect the 4 Feb orders; the
-- July ones are genuinely new and must NOT appear here):
-- SELECT order_no, status, approval_status, warehouse_stage, created_at::date
-- FROM orders
-- WHERE is_b2b = TRUE
--   AND lower(coalesce(status, '')) = 'pending'
--   AND created_at < '2026-03-01'
-- ORDER BY created_at;

UPDATE orders
SET status = 'delivered',
    approval_status = 'approved'
WHERE is_b2b = TRUE
  AND lower(coalesce(status, '')) = 'pending'
  AND created_at < '2026-03-01';   -- legacy only; today's real pending orders stay

-- VERIFY — expect 0 legacy rows left, and the recent genuinely-pending ones
-- untouched:
-- SELECT order_no, status, approval_status, created_at::date
-- FROM orders
-- WHERE is_b2b = TRUE AND coalesce(approval_status,'pending') = 'pending'
-- ORDER BY created_at;
