-- ============================================================
-- 40. Fix legacy B2B orders whose is_b2b flag was never set.
--
-- WHY: 176 prod orders (Jan-Feb 2026, e.g. SB-B2B-0126-000204) carry
-- salesperson_store = 'B2B' but is_b2b = false — they predate the flag being
-- written at placement. Everything that classifies by the flag mislabels
-- them: the PM order card shows a "STORE" badge on a B2B order, the B2B
-- channel filter excludes them, channel stats and CSV exports miscount them,
-- and notification-scheduler's .eq(is_b2b) queries skip them. The canonical
-- classifier (getOrderChannelKey) tolerates the drift by checking the store
-- string too, but dozens of call sites use the raw flag — the durable fix is
-- to make the flag truthful, not to teach every consumer the workaround.
--
-- TRAP HANDLED HERE: the PM/PH dashboards hide B2B orders whose
-- approval_status isn't 'approved'. These legacy orders are all
-- approval_status='pending' (the approval flow didn't exist yet), so flipping
-- is_b2b alone would make all 176 VANISH from the dashboards. Orders already
-- terminal (completed/delivered/cancelled) are therefore auto-approved in the
-- same pass — they demonstrably went through production; there is nothing
-- left to approve. Non-terminal ones (if any) keep their pending status and
-- will surface in the merchandiser approval queue, which is correct — they
-- are genuinely unapproved B2B orders.
--
-- Idempotent: re-running matches nothing once fixed.
-- Run on uat first, then prod.
-- ============================================================

-- PREVIEW 1 — the orders whose flag will be fixed:
-- SELECT order_no, status, approval_status, created_at::date
-- FROM orders
-- WHERE salesperson_store = 'B2B' AND is_b2b IS DISTINCT FROM TRUE
-- ORDER BY created_at;

-- PREVIEW 2 — how many are NOT terminal (these will appear in the
-- merchandiser approval queue after the fix — expect few or zero):
-- SELECT count(*) FROM orders
-- WHERE salesperson_store = 'B2B' AND is_b2b IS DISTINCT FROM TRUE
--   AND lower(coalesce(status,'')) NOT IN ('completed','delivered','cancelled');

-- ── A) Terminal legacy orders: fix the flag AND auto-approve ──
UPDATE orders
SET is_b2b = TRUE,
    approval_status = 'approved'
WHERE salesperson_store = 'B2B'
  AND is_b2b IS DISTINCT FROM TRUE
  AND lower(coalesce(status, '')) IN ('completed', 'delivered', 'cancelled')
  AND coalesce(approval_status, 'pending') <> 'approved';

-- ── B) Everything else with the B2B store: fix the flag only ──
UPDATE orders
SET is_b2b = TRUE
WHERE salesperson_store = 'B2B'
  AND is_b2b IS DISTINCT FROM TRUE;

-- VERIFY — expect 0:
-- SELECT count(*) FROM orders
-- WHERE salesperson_store = 'B2B' AND is_b2b IS DISTINCT FROM TRUE;
