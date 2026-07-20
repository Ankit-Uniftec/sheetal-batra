-- ============================================================
-- 42. Ten Ludhiana orders placed by Jyoti Sharma are actually STOCK orders.
--
-- WHY: they were raised through the normal store flow (so they carry
-- SB-LDHC-… numbers and is_stock_order = false) but they are internal stock,
-- not customer orders. Left as-is they inflate Ludhiana store revenue and
-- customer-order counts on every dashboard.
--
-- The FLAG is what dashboards filter on (is_stock_order), so setting it is
-- sufficient. The order NUMBERS are deliberately left alone: order_no is
-- stamped into order_components, stage_transitions, qc_records, generated
-- barcodes and any already-printed PDFs — renumbering would orphan all of
-- that for a cosmetic gain. All ten are still at status='order_received'
-- (nothing scanned into production), so there is no production history to
-- reconcile either way.
--
-- Idempotent: re-running matches nothing once fixed.
-- Run on uat first, then prod.
-- ============================================================

-- PREVIEW — expect exactly these 10 rows, all is_stock_order = false:
-- SELECT order_no, is_stock_order, salesperson, status, created_at::date
-- FROM orders
-- WHERE order_no IN (
--   'SB-LDHC-0526-001460','SB-LDHC-0526-001461','SB-LDHC-0526-001466',
--   'SB-LDHC-0526-001493','SB-LDHC-0626-002506','SB-LDHC-0626-002507',
--   'SB-LDHC-0626-002508','SB-LDHC-0626-002510','SB-LDHC-0626-002511',
--   'SB-LDHC-0626-002512')
-- ORDER BY order_no;

UPDATE orders
SET is_stock_order = TRUE
WHERE order_no IN (
  'SB-LDHC-0526-001460','SB-LDHC-0526-001461','SB-LDHC-0526-001466',
  'SB-LDHC-0526-001493','SB-LDHC-0626-002506','SB-LDHC-0626-002507',
  'SB-LDHC-0626-002508','SB-LDHC-0626-002510','SB-LDHC-0626-002511',
  'SB-LDHC-0626-002512')
  AND is_stock_order IS DISTINCT FROM TRUE;

-- VERIFY — expect all 10 with is_stock_order = true:
-- SELECT order_no, is_stock_order FROM orders
-- WHERE order_no IN (
--   'SB-LDHC-0526-001460','SB-LDHC-0526-001461','SB-LDHC-0526-001466',
--   'SB-LDHC-0526-001493','SB-LDHC-0626-002506','SB-LDHC-0626-002507',
--   'SB-LDHC-0626-002508','SB-LDHC-0626-002510','SB-LDHC-0626-002511',
--   'SB-LDHC-0626-002512')
-- ORDER BY order_no;
