-- ============================================================
-- 36. Per-product dispatch: let one product of a multi-product order be
--     packaged/dispatched without waiting for the rest.
--
-- WHY: an order can hold several products (order.items[]), each generating its
-- own components (TOP/BTM/DUP), tagged with order_components.item_index. Today
-- packaging is all-or-nothing per ORDER: verify_packaging_components requires
-- EVERY active component of the order to have cleared Final QC, and expects
-- EVERY barcode to be scanned. So one product stuck at Embroidery holds
-- finished products hostage — they cannot be packed or shipped.
--
-- Real example (prod, SB-DLC-0726-003136): product 1's bottom+dupatta are at
-- dyeing_completed while product 2's are still at order_received. Product 1 can
-- never ship first.
--
-- WHAT: both functions take an OPTIONAL p_item_index.
--     NULL (default) -> today's exact behaviour, whole order. Unchanged.
--     0,1,2...       -> scope to that one product's components.
-- The data model already supports this: item_index is populated correctly by
-- generateOrderComponents (and encoded in the barcode: DLC-003136-TOP2 is
-- product 2's top), advance_component_stage is already per-barcode, and
-- external movements are already per-component. Only these two order-wide
-- gates stand in the way.
--
-- The order-completion trigger (fn_sync_order_warehouse_stage) already does the
-- right thing and is deliberately NOT touched: it flips the order to completed
-- only when ALL active components are dispatched, and otherwise reports the
-- least-advanced component's stage. Dispatching product 1 correctly leaves the
-- order open, tracking the remaining products.
--
-- Idempotent (CREATE OR REPLACE). Run on uat first, then prod.
-- ============================================================

-- ------------------------------------------------------------
-- A) verify_packaging_components — optional per-product scope.
-- Redeploys file 10's definition with p_item_index added; the mismatch
-- identification logic is unchanged.
--
-- NOTE: the new arg has a DEFAULT, so existing 2-arg callers keep working and
-- resolve to this same function. Postgres would treat a 3-arg version as an
-- OVERLOAD of the old 2-arg one (leaving both live and making unqualified
-- calls ambiguous), so drop the old signature first.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.verify_packaging_components(uuid, text[]);

CREATE OR REPLACE FUNCTION public.verify_packaging_components(
  p_order_id uuid,
  p_scanned_barcodes text[],
  p_item_index int DEFAULT NULL      -- NULL = whole order (unchanged behaviour)
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_expected TEXT[];
  v_missing TEXT[];
  v_extra TEXT[];
  v_all_qc_passed BOOLEAN;
  v_extra_info JSONB := '[]'::jsonb;
  v_missing_info JSONB := '[]'::jsonb;
  v_bc TEXT;
BEGIN
  -- Expected = the order's active pieces, scoped to one product when asked.
  SELECT ARRAY_AGG(barcode ORDER BY barcode) INTO v_expected
  FROM order_components
  WHERE order_id = p_order_id AND is_active = TRUE
    AND current_stage NOT IN ('disposed','scrapped')
    AND (p_item_index IS NULL OR item_index = p_item_index);

  -- Guard: an item_index that matches nothing is a caller bug — fail loudly
  -- rather than silently "verifying" an empty set as success.
  IF COALESCE(array_length(v_expected,1),0) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_COMPONENTS',
      'message', CASE WHEN p_item_index IS NULL
                      THEN 'This order has no active components to dispatch'
                      ELSE 'Product ' || (p_item_index + 1) || ' has no active components to dispatch'
                 END);
  END IF;

  -- QC gate — same rule, but only over the pieces being dispatched. A product
  -- still in production no longer blocks a finished one.
  SELECT NOT EXISTS (
    SELECT 1 FROM order_components
    WHERE order_id = p_order_id AND is_active = TRUE
      AND current_stage NOT IN ('disposed','scrapped','final_qc_passed','packaging_dispatch','dispatched')
      AND (p_item_index IS NULL OR item_index = p_item_index)
  ) INTO v_all_qc_passed;

  IF NOT v_all_qc_passed THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ALL_QC_PASSED',
      'message', CASE WHEN p_item_index IS NULL
                      THEN 'Not all components have passed Final QC yet'
                      ELSE 'Not all of product ' || (p_item_index + 1) || '''s components have passed Final QC yet'
                 END);
  END IF;

  SELECT ARRAY_AGG(b) INTO v_missing
  FROM unnest(v_expected) b WHERE b <> ALL(p_scanned_barcodes);

  SELECT ARRAY_AGG(b) INTO v_extra
  FROM unnest(p_scanned_barcodes) b WHERE b <> ALL(v_expected);

  IF COALESCE(array_length(v_missing,1),0) > 0 OR COALESCE(array_length(v_extra,1),0) > 0 THEN
    -- For each EXTRA (wrong) barcode: find its correct order + component + last location
    FOREACH v_bc IN ARRAY COALESCE(v_extra, ARRAY[]::text[]) LOOP
      v_extra_info := v_extra_info || COALESCE((
        SELECT jsonb_build_object(
          'barcode', oc.barcode,
          'belongs_to_order_id', oc.order_id,
          'belongs_to_order_no', oc.order_no,
          'component_id', oc.id,
          'component_label', oc.component_label,
          'current_stage', oc.current_stage::text,
          'location', CASE WHEN oc.is_outside_wh THEN 'At vendor: ' || COALESCE(oc.vendor_name,'?')
                           ELSE 'SB WH Delhi (1)' END)
        FROM order_components oc WHERE oc.barcode = v_bc
      ), jsonb_build_object('barcode', v_bc, 'belongs_to_order_no', 'UNKNOWN'));
    END LOOP;

    -- For each MISSING (expected) component: show last recorded location/stage
    FOREACH v_bc IN ARRAY COALESCE(v_missing, ARRAY[]::text[]) LOOP
      v_missing_info := v_missing_info || COALESCE((
        SELECT jsonb_build_object(
          'barcode', oc.barcode,
          'component_label', oc.component_label,
          'last_stage', oc.current_stage::text,
          'location', CASE WHEN oc.is_outside_wh THEN 'At vendor: ' || COALESCE(oc.vendor_name,'?')
                           ELSE 'SB WH Delhi (1)' END)
        FROM order_components oc WHERE oc.barcode = v_bc
      ), jsonb_build_object('barcode', v_bc));
    END LOOP;

    RETURN jsonb_build_object('success', false, 'error', 'COMPONENT_MISMATCH',
      'message', 'Scanned components do not match order',
      'missing', COALESCE(v_missing,'{}'), 'extra', COALESCE(v_extra,'{}'),
      'extra_details', v_extra_info, 'missing_details', v_missing_info);
  END IF;

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id,
    'item_index', p_item_index,
    'verified_count', array_length(v_expected,1),
    'message', CASE WHEN p_item_index IS NULL
                    THEN 'All components verified — ready for dispatch'
                    ELSE 'Product ' || (p_item_index + 1) || ' verified — ready for dispatch'
               END);
END;
$function$;

-- ------------------------------------------------------------
-- B) manual_complete_order — optional per-product scope.
-- Redeploys file 32's definition with p_item_index added.
--
-- ⚠ The important change beyond the loop filter: file 32 ALWAYS set the order
-- to status='completed' / warehouse_stage='dispatched' at the end. Completing
-- ONE product must NOT complete the whole order — so that update now only runs
-- when nothing active is left undispatched. The fn_sync_order_warehouse_stage
-- trigger already computes exactly this, so a partial run simply leaves the
-- order to the trigger (which reports the remaining products' stage).
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.manual_complete_order(uuid, text);

CREATE OR REPLACE FUNCTION public.manual_complete_order(
  p_order_id uuid,
  p_by text,
  p_item_index int DEFAULT NULL      -- NULL = whole order (unchanged behaviour)
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  r RECORD;
  v_count int := 0;
  v_any_left boolean;
BEGIN
  FOR r IN
    SELECT id, order_no, barcode, current_stage, is_active
    FROM order_components
    WHERE order_id = p_order_id
      AND current_stage NOT IN ('dispatched','disposed','scrapped')
      AND (p_item_index IS NULL OR item_index = p_item_index)
  LOOP
    -- Close any open vendor movement for this piece.
    UPDATE external_movements
      SET status = 'returned', entry_scan_at = COALESCE(entry_scan_at, NOW())
      WHERE component_id = r.id AND status = 'exited';

    -- Force-activate a piece that never entered production.
    IF NOT r.is_active THEN
      UPDATE order_components
        SET is_active = TRUE, activated_at = COALESCE(activated_at, NOW())
        WHERE id = r.id;
    END IF;

    UPDATE order_components SET
      current_stage = 'dispatched',
      previous_stage = r.current_stage,
      is_outside_wh = FALSE,
      stage_updated_at = NOW(),
      updated_at = NOW()
    WHERE id = r.id;

    -- Backfill the ledger so the piece reads as a completed journey.
    INSERT INTO component_stage_progress
      (component_id, step, stage_in, stage_out, status, scan_in_at, scan_out_at, scanned_in_by, scanned_out_by, created_at)
    VALUES (r.id, 1, 'cloth_issued', 'cloth_issued', 'completed', NOW(), NOW(), p_by, p_by, NOW())
    ON CONFLICT (component_id, step) DO UPDATE
      SET status = 'completed', scan_out_at = NOW(), scanned_out_by = EXCLUDED.scanned_out_by;

    INSERT INTO component_stage_progress
      (component_id, step, stage_in, stage_out, status, scan_in_at, scan_out_at, scanned_in_by, scanned_out_by, created_at)
    VALUES (r.id, 10, 'packaging_dispatch', 'dispatched', 'completed', NOW(), NOW(), p_by, p_by, NOW())
    ON CONFLICT (component_id, step) DO UPDATE
      SET status = 'completed', scan_out_at = NOW(), scanned_out_by = EXCLUDED.scanned_out_by;

    INSERT INTO stage_transitions (
      component_id, order_id, order_no, barcode,
      from_stage, to_stage, scanned_by, station_name, transition_type, notes
    ) VALUES (
      r.id, p_order_id, r.order_no, r.barcode,
      r.current_stage, 'dispatched', p_by, 'Manual Completion', 'manual_override',
      CASE WHEN p_item_index IS NULL
           THEN 'Order manually completed'
           ELSE 'Product ' || (p_item_index + 1) || ' manually completed' END
    );

    v_count := v_count + 1;
  END LOOP;

  -- Only complete the ORDER when nothing active is left undispatched. With
  -- p_item_index set, other products usually remain — the order must stay open.
  SELECT EXISTS (
    SELECT 1 FROM order_components
    WHERE order_id = p_order_id AND is_active = TRUE
      AND current_stage NOT IN ('dispatched','disposed','scrapped')
  ) INTO v_any_left;

  IF NOT v_any_left THEN
    UPDATE orders SET
      status = 'completed',
      warehouse_stage = 'dispatched',
      warehouse_stage_updated_at = NOW()
    WHERE id = p_order_id;
  END IF;

  -- Keep file 32's response contract intact (callers read .message on failure
  -- and the key names are part of the existing API); item_index and
  -- order_completed are additive.
  RETURN jsonb_build_object('success', true, 'order_id', p_order_id,
    'components_dispatched', v_count,
    'item_index', p_item_index,
    'order_completed', NOT v_any_left,
    'message', CASE WHEN p_item_index IS NULL
                    THEN 'Order manually completed — ' || v_count || ' component(s) dispatched.'
                    ELSE 'Product ' || (p_item_index + 1) || ' manually completed — ' || v_count
                         || ' component(s) dispatched.'
                         || CASE WHEN v_any_left THEN ' Other products remain in production.' ELSE '' END
               END);
END;
$function$;

-- ------------------------------------------------------------
-- VERIFY — a multi-product order's pieces, grouped by product.
-- ------------------------------------------------------------
-- SELECT o.order_no, oc.item_index AS product,
--        string_agg(oc.barcode || ' [' || oc.current_stage || ']', ', '
--                   ORDER BY oc.component_type::text) AS pieces
-- FROM orders o JOIN order_components oc ON oc.order_id = o.id
-- WHERE o.order_no = 'SB-DLC-0726-003136'
-- GROUP BY o.order_no, oc.item_index ORDER BY oc.item_index;

NOTIFY pgrst, 'reload schema';
