-- ============================================================
-- 35. Backfill: give the pre-existing COMMS orders their components/barcodes.
--
-- WHY: comms component generation was only added on 2026-07-10 (commit 3390f28,
-- CommsReviewOrder.jsx "Generate order components (barcodes) — same as the
-- retail/B2B flow"). Every comms order placed BEFORE that date was inserted
-- without any order_components rows, so it has no barcodes, no scannable
-- pieces, no production journey and no "View Journey" button. Comms orders
-- placed after that date are fine — this is legacy data only, not a bug.
--
-- WHAT: creates the missing top / bottom / dupatta / extra components for comms
-- orders, mirroring generateOrderComponents() (barcodeService.js:484-574)
-- exactly:
--     TOP  -> <STORE>-<SEQ>-TOP[n]        when item.top or item.product_name
--     BTM  -> <STORE>-<SEQ>-BTM[n]        when item.bottom
--     DUP  -> <STORE>-<SEQ>-DUP[n]        when item.includes_dupatta is true
--     EX   -> <STORE>-<SEQ>-EX<k>[-n]     one per item.extras[] entry
--   where <STORE> = 2nd segment of order_no, <SEQ> = last segment, and the
--   [n] suffix is (item_index + 1) for items after the first (JS: itemIndex > 0).
--   Components are created INACTIVE (is_active defaults false) at
--   order_received — exactly like a fresh order. They activate normally on the
--   first Cloth Issue scan (activate_components), so the whole 14-stage flow
--   works unchanged. Comms follows the identical production flow — nothing in
--   creation/activation/scanning branches on channel.
--
-- SCOPE: comms orders only (salesperson_store = 'COMMS' OR is_comms), created
-- BEFORE 2026-07-10 (the fix date) — i.e. exactly the orders the code missed.
-- As of writing that is 7 orders on prod (2026-06-01 .. 2026-07-04), and every
-- one has a UNIQUE <STORE>-<SEQ> root, so the barcode unique key is safe here.
--
-- ⚠ BARCODE COLLISION NOTE (see 18_backfill_dupatta_components.sql:92-101):
-- the <STORE>-<SEQ> root is NOT unique across all time — the same 6-digit
-- sequence gets reused across months (SB-DLC-0226-000443 and SB-DLC-0426-000443
-- both -> DLC-000443). That is why this backfill is scoped to comms only (store
-- code COM/GEN, a small set with verified-unique roots) and is guarded three
-- ways: skip if the order already has that component, skip if the barcode
-- already exists at all, and ON CONFLICT (barcode) DO NOTHING.
--
-- IDEMPOTENT: safe to re-run; inserts only what is genuinely missing.
-- Run the PREVIEW first, eyeball it, then run the INSERT. UAT, then prod.
-- ============================================================

-- ------------------------------------------------------------
-- PREVIEW — run this ALONE first. It shows exactly what the INSERT
-- below would create, without writing anything.
-- ------------------------------------------------------------
-- WITH item_rows AS (
--   SELECT o.id AS order_id, o.order_no, (it.idx - 1) AS item_index, it.item,
--          split_part(o.order_no, '-', 2) AS store_code,
--          split_part(o.order_no, '-', array_length(string_to_array(o.order_no, '-'), 1)) AS seq_part
--   FROM orders o
--   CROSS JOIN LATERAL jsonb_array_elements(
--     CASE jsonb_typeof(o.items) WHEN 'array' THEN o.items ELSE '[]'::jsonb END
--   ) WITH ORDINALITY AS it(item, idx)
--   WHERE (o.salesperson_store = 'COMMS' OR o.is_comms IS TRUE)
--     AND o.created_at < '2026-07-10'
-- )
-- SELECT order_no, item_index,
--        (item ->> 'top') AS top, (item ->> 'bottom') AS bottom,
--        (item ->> 'includes_dupatta') AS includes_dupatta,
--        jsonb_array_length(COALESCE(item -> 'extras', '[]'::jsonb)) AS extras_count,
--        (SELECT COUNT(*) FROM order_components oc WHERE oc.order_id = item_rows.order_id) AS existing_components
-- FROM item_rows ORDER BY order_no, item_index;

-- ------------------------------------------------------------
-- The shared item expansion: one row per (order, item), with the
-- barcode root already resolved. Used by all four inserts below.
-- ------------------------------------------------------------
CREATE TEMP VIEW _comms_item_rows AS
SELECT
  o.id                                        AS order_id,
  o.order_no                                  AS order_no,
  (it.idx - 1)                                AS item_index,
  it.item                                     AS item,
  split_part(o.order_no, '-', 2)              AS store_code,
  split_part(o.order_no, '-', array_length(string_to_array(o.order_no, '-'), 1)) AS seq_part,
  -- JS: `${itemIndex > 0 ? itemIndex + 1 : ""}` for TOP/BTM/DUP
  CASE WHEN (it.idx - 1) > 0 THEN (it.idx)::text ELSE '' END AS idx_suffix
FROM orders o
CROSS JOIN LATERAL jsonb_array_elements(
  CASE jsonb_typeof(o.items) WHEN 'array' THEN o.items ELSE '[]'::jsonb END
) WITH ORDINALITY AS it(item, idx)
WHERE (o.salesperson_store = 'COMMS' OR o.is_comms IS TRUE)
  AND o.created_at < '2026-07-10';   -- only orders the code missed

-- ── A) TOP ───────────────────────────────────────────────────
-- JS: if (item?.top || item?.product_name)
INSERT INTO order_components (order_id, order_no, barcode, component_type, component_label, item_index, extra_index)
SELECT r.order_id, r.order_no,
       r.store_code || '-' || r.seq_part || '-TOP' || r.idx_suffix,
       'top',
       COALESCE(NULLIF(r.item ->> 'top', ''), NULLIF(r.item ->> 'product_name', ''), 'Top'),
       r.item_index, NULL
FROM _comms_item_rows r
WHERE (COALESCE(r.item ->> 'top', '') <> '' OR COALESCE(r.item ->> 'product_name', '') <> '')
  AND NOT EXISTS (SELECT 1 FROM order_components oc
                  WHERE oc.order_id = r.order_id AND oc.component_type = 'top' AND oc.item_index = r.item_index)
  AND NOT EXISTS (SELECT 1 FROM order_components oc2
                  WHERE oc2.barcode = r.store_code || '-' || r.seq_part || '-TOP' || r.idx_suffix)
ON CONFLICT (barcode) DO NOTHING;

-- ── B) BOTTOM ────────────────────────────────────────────────
-- JS: if (item?.bottom)
INSERT INTO order_components (order_id, order_no, barcode, component_type, component_label, item_index, extra_index)
SELECT r.order_id, r.order_no,
       r.store_code || '-' || r.seq_part || '-BTM' || r.idx_suffix,
       'bottom',
       COALESCE(NULLIF(r.item ->> 'bottom', ''), 'Bottom'),
       r.item_index, NULL
FROM _comms_item_rows r
WHERE COALESCE(r.item ->> 'bottom', '') <> ''
  AND NOT EXISTS (SELECT 1 FROM order_components oc
                  WHERE oc.order_id = r.order_id AND oc.component_type = 'bottom' AND oc.item_index = r.item_index)
  AND NOT EXISTS (SELECT 1 FROM order_components oc2
                  WHERE oc2.barcode = r.store_code || '-' || r.seq_part || '-BTM' || r.idx_suffix)
ON CONFLICT (barcode) DO NOTHING;

-- ── C) DUPATTA ───────────────────────────────────────────────
-- JS: if (item?.includes_dupatta)
-- NOTE: deliberately NOT inferring a dupatta from the product name here (unlike
-- file 18, which was a dedicated dupatta sweep). This backfill's job is to
-- reproduce what generateOrderComponents would have created at placement, and
-- that reads ONLY the includes_dupatta flag. Orders carrying a dupatta as an
-- `extras` entry get it via (D) below, as an extra — same as a live order would.
-- If the older comms orders need name-inferred dupattas too, run file 18's
-- sweep separately (mind its 2-day scope / collision caveat).
INSERT INTO order_components (order_id, order_no, barcode, component_type, component_label, item_index, extra_index)
SELECT r.order_id, r.order_no,
       r.store_code || '-' || r.seq_part || '-DUP' || r.idx_suffix,
       'dupatta', 'Dupatta', r.item_index, NULL
FROM _comms_item_rows r
WHERE (r.item ->> 'includes_dupatta')::boolean IS TRUE
  AND NOT EXISTS (SELECT 1 FROM order_components oc
                  WHERE oc.order_id = r.order_id AND oc.component_type = 'dupatta' AND oc.item_index = r.item_index)
  AND NOT EXISTS (SELECT 1 FROM order_components oc2
                  WHERE oc2.barcode = r.store_code || '-' || r.seq_part || '-DUP' || r.idx_suffix)
ON CONFLICT (barcode) DO NOTHING;

-- ── D) EXTRAS ────────────────────────────────────────────────
-- JS: item.extras.forEach((extra, extraIndex) => ... `-EX${extraIndex+1}${itemIndex>0 ? "-"+(itemIndex+1) : ""}`)
-- Note the extras barcode suffix differs from TOP/BTM/DUP: it's "-EX<k>" then
-- an OPTIONAL "-<itemNo>" (with a dash), not a bare digit.
INSERT INTO order_components (order_id, order_no, barcode, component_type, component_label, item_index, extra_index)
SELECT r.order_id, r.order_no,
       r.store_code || '-' || r.seq_part || '-EX' || ex.k::text
         || CASE WHEN r.item_index > 0 THEN '-' || (r.item_index + 1)::text ELSE '' END,
       'extra',
       COALESCE(NULLIF(ex.extra ->> 'name', ''), 'Extra ' || ex.k::text),
       r.item_index,
       (ex.k - 1)
FROM _comms_item_rows r
CROSS JOIN LATERAL jsonb_array_elements(
  CASE jsonb_typeof(r.item -> 'extras') WHEN 'array' THEN r.item -> 'extras' ELSE '[]'::jsonb END
) WITH ORDINALITY AS ex(extra, k)
WHERE NOT EXISTS (SELECT 1 FROM order_components oc
                  WHERE oc.order_id = r.order_id AND oc.component_type = 'extra'
                    AND oc.item_index = r.item_index AND oc.extra_index = (ex.k - 1))
  AND NOT EXISTS (SELECT 1 FROM order_components oc2
                  WHERE oc2.barcode = r.store_code || '-' || r.seq_part || '-EX' || ex.k::text
                    || CASE WHEN r.item_index > 0 THEN '-' || (r.item_index + 1)::text ELSE '' END)
ON CONFLICT (barcode) DO NOTHING;

DROP VIEW _comms_item_rows;

-- ------------------------------------------------------------
-- VERIFY — every comms order should now have >= 1 component.
-- ------------------------------------------------------------
-- SELECT o.order_no, o.created_at::date AS placed,
--        COUNT(oc.id) AS components,
--        string_agg(oc.barcode || ' (' || oc.component_type || ')', ', ' ORDER BY oc.component_type) AS pieces
-- FROM orders o
-- LEFT JOIN order_components oc ON oc.order_id = o.id
-- WHERE (o.salesperson_store = 'COMMS' OR o.is_comms IS TRUE)
-- GROUP BY o.id, o.order_no, o.created_at
-- ORDER BY o.created_at;

NOTIFY pgrst, 'reload schema';
