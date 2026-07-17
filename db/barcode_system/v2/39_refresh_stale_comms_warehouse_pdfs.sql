-- ============================================================
-- 39. Refresh stale comms warehouse PDFs (no barcodes in the stored file).
--
-- WHY: a warehouse PDF is generated once at order placement and cached in
-- orders.warehouse_urls; every dashboard click just opens the stored file.
-- The pre-fix comms orders got their components/barcodes LATER, via migration
-- 35's backfill — so their placement-time PDFs were rendered with no
-- components and contain no barcodes. Observed as: PM dashboard opens the
-- cached file (no barcodes) while the comms dashboard force-regenerated on
-- every click (barcodes) and silently overwrote the stored file, after which
-- the PM showed barcodes too.
--
-- FIX: clear the cached URLs on exactly the orders whose components arrived
-- well after placement (the backfilled ones). The next warehouse-PDF click on
-- any dashboard hits the cache-miss path, regenerates WITH barcodes, uploads
-- to the same storage path (upsert) and re-caches the URLs. One regeneration,
-- then cached-correct forever. New comms orders are unaffected — placement
-- now creates components before the PDFs.
--
-- Scoped to comms orders only: B2B legitimately creates components at
-- APPROVAL (long after placement), so a blanket late-components rule would
-- wrongly clear healthy B2B caches.
--
-- Idempotent: re-running matches nothing once cleared.
-- Run on uat first, then prod.
-- ============================================================

-- PREVIEW — run alone first: the orders whose cache will be cleared.
-- SELECT o.order_no, o.created_at, MIN(oc.created_at) AS first_component_at,
--        o.warehouse_urls
-- FROM orders o
-- JOIN order_components oc ON oc.order_id = o.id
-- WHERE (o.salesperson_store = 'COMMS' OR o.is_comms IS TRUE)
--   AND (o.warehouse_urls IS NOT NULL OR o.warehouse_url IS NOT NULL)
-- GROUP BY o.id, o.order_no, o.created_at, o.warehouse_urls
-- HAVING MIN(oc.created_at) > o.created_at + INTERVAL '1 hour';

UPDATE orders o
SET warehouse_urls = NULL,
    warehouse_url = NULL
WHERE (o.salesperson_store = 'COMMS' OR o.is_comms IS TRUE)
  AND (o.warehouse_urls IS NOT NULL OR o.warehouse_url IS NOT NULL)
  AND EXISTS (
    SELECT 1 FROM order_components oc
    WHERE oc.order_id = o.id
    GROUP BY oc.order_id
    HAVING MIN(oc.created_at) > o.created_at + INTERVAL '1 hour'
  );

-- VERIFY — expect 0 rows still cached among the late-component comms orders:
-- SELECT count(*) FROM orders o
-- WHERE (o.salesperson_store = 'COMMS' OR o.is_comms IS TRUE)
--   AND o.warehouse_urls IS NOT NULL
--   AND EXISTS (SELECT 1 FROM order_components oc WHERE oc.order_id = o.id
--               GROUP BY oc.order_id
--               HAVING MIN(oc.created_at) > o.created_at + INTERVAL '1 hour');
