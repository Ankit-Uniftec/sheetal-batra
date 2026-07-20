-- ============================================================
-- 43. Jyoti's stock orders: renumber the UNSCANNED ones LDHC -> STOCK.
--
-- Ten Ludhiana orders are internal stock, not customer orders. Migration 42
-- flags all ten (is_stock_order = TRUE) which is what dashboards filter on.
-- This migration additionally renumbers the EIGHT that have never been
-- scanned, so their order numbers read SB-STOCK-… like real stock orders.
--
-- WHY ONLY EIGHT: SB-LDHC-0626-002507 (8 scans) and SB-LDHC-0626-002512
-- (126 scans) have live production history. Their barcodes are printed and
-- referenced by stage_transitions; renumbering would break the link between
-- the physical label and the row. Those two keep their LDHC numbers and are
-- handled by migration 42's flag alone.
--
-- WHAT MOVES TOGETHER: the barcode is DERIVED from the order number's prefix
-- (barcodeService.generateOrderComponents: "SB-LDHC-0526-001460" ->
-- "LDHC-001460-TOP"). So order_no and order_components.barcode must change in
-- lockstep or scanning breaks. warehouse_urls is cleared so the cached PDF
-- regenerates with the new barcodes instead of serving the old LDHC labels.
--
-- ⚠ AFTER RUNNING: any warehouse PDF already PRINTED for these eight carries
-- LDHC-… barcodes on paper. Those printouts must be discarded and reprinted,
-- or the physical labels will not scan.
--
-- Run on uat first, then prod. Steps are numbered — run them in order.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- STEP 1 — SEQUENCE SANITY CHECK.
-- The order sequence is GLOBAL across stores (one counter: DLC-001, LDHC-002,
-- B2B-003 …), so a sequence value is issued exactly once system-wide and
-- swapping only the prefix cannot collide. This query proves that for the 8:
-- every proposed number must come back collides = false, and each sequence
-- must appear exactly once across ALL prefixes (seq_holders = 1).
-- If anything reads otherwise, STOP.
-- ────────────────────────────────────────────────────────────
SELECT o.order_no,
       replace(o.order_no, 'SB-LDHC-', 'SB-STOCK-') AS proposed_no,
       EXISTS (SELECT 1 FROM orders x
               WHERE x.order_no = replace(o.order_no, 'SB-LDHC-', 'SB-STOCK-')) AS collides,
       (SELECT count(*) FROM orders y
        WHERE split_part(y.order_no, '-', 4) = split_part(o.order_no, '-', 4)) AS seq_holders
FROM orders o
WHERE o.order_no IN (
  'SB-LDHC-0526-001460','SB-LDHC-0526-001461','SB-LDHC-0526-001466',
  'SB-LDHC-0526-001493','SB-LDHC-0626-002506','SB-LDHC-0626-002508',
  'SB-LDHC-0626-002510','SB-LDHC-0626-002511')
ORDER BY o.order_no;


-- ────────────────────────────────────────────────────────────
-- STEP 2 — SAFETY RE-CHECK.  Expect scans = 0 on all 8 rows.
-- (Guards against someone scanning one of these between your first query
--  and running this migration.)
-- ────────────────────────────────────────────────────────────
SELECT o.order_no, count(st.id) AS scans
FROM orders o
LEFT JOIN stage_transitions st ON st.order_id = o.id
WHERE o.order_no IN (
  'SB-LDHC-0526-001460','SB-LDHC-0526-001461','SB-LDHC-0526-001466',
  'SB-LDHC-0526-001493','SB-LDHC-0626-002506','SB-LDHC-0626-002508',
  'SB-LDHC-0626-002510','SB-LDHC-0626-002511')
GROUP BY o.order_no
ORDER BY o.order_no;


-- ────────────────────────────────────────────────────────────
-- STEP 3 — PREVIEW the barcode rewrite.  Eyeball old -> new.
-- Expect e.g. LDHC-001460-TOP -> STOCK-001460-TOP
-- ────────────────────────────────────────────────────────────
SELECT oc.order_no,
       oc.barcode AS old_barcode,
       replace(oc.barcode, 'LDHC-', 'STOCK-') AS new_barcode
FROM order_components oc
WHERE oc.order_no IN (
  'SB-LDHC-0526-001460','SB-LDHC-0526-001461','SB-LDHC-0526-001466',
  'SB-LDHC-0526-001493','SB-LDHC-0626-002506','SB-LDHC-0626-002508',
  'SB-LDHC-0626-002510','SB-LDHC-0626-002511')
ORDER BY oc.order_no, oc.component_type;


-- ────────────────────────────────────────────────────────────
-- STEP 4 — THE WRITE.  One transaction: all of it lands or none of it.
-- Only run once steps 1-3 look right.
-- ────────────────────────────────────────────────────────────
BEGIN;

-- 4a) components first — they still match on the OLD order_no here
UPDATE order_components oc
SET barcode  = replace(oc.barcode, 'LDHC-', 'STOCK-'),
    order_no = replace(oc.order_no, 'SB-LDHC-', 'SB-STOCK-')
WHERE oc.order_no IN (
  'SB-LDHC-0526-001460','SB-LDHC-0526-001461','SB-LDHC-0526-001466',
  'SB-LDHC-0526-001493','SB-LDHC-0626-002506','SB-LDHC-0626-002508',
  'SB-LDHC-0626-002510','SB-LDHC-0626-002511');

-- 4b) then the orders themselves: new number, stock flag, drop the stale PDF
UPDATE orders
SET order_no       = replace(order_no, 'SB-LDHC-', 'SB-STOCK-'),
    is_stock_order = TRUE,
    warehouse_urls = NULL
WHERE order_no IN (
  'SB-LDHC-0526-001460','SB-LDHC-0526-001461','SB-LDHC-0526-001466',
  'SB-LDHC-0526-001493','SB-LDHC-0626-002506','SB-LDHC-0626-002508',
  'SB-LDHC-0626-002510','SB-LDHC-0626-002511');

COMMIT;


-- ────────────────────────────────────────────────────────────
-- STEP 5 — VERIFY.  Expect 8 rows, all SB-STOCK-…, is_stock_order = true,
-- components carrying STOCK-… barcodes, and no LDHC left behind.
-- ────────────────────────────────────────────────────────────
SELECT o.order_no, o.is_stock_order, o.warehouse_urls IS NULL AS pdf_cleared,
       count(oc.id) AS components,
       count(*) FILTER (WHERE oc.barcode LIKE 'LDHC-%') AS stale_barcodes
FROM orders o
LEFT JOIN order_components oc ON oc.order_id = o.id
WHERE o.order_no IN (
  'SB-STOCK-0526-001460','SB-STOCK-0526-001461','SB-STOCK-0526-001466',
  'SB-STOCK-0526-001493','SB-STOCK-0626-002506','SB-STOCK-0626-002508',
  'SB-STOCK-0626-002510','SB-STOCK-0626-002511')
GROUP BY o.order_no, o.is_stock_order, o.warehouse_urls
ORDER BY o.order_no;
-- stale_barcodes must be 0 on every row.

-- And the two scanned ones keep LDHC but must now be flagged (from mig 42):
SELECT order_no, is_stock_order FROM orders
WHERE order_no IN ('SB-LDHC-0626-002507','SB-LDHC-0626-002512');
