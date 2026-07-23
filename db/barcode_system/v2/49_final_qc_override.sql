-- ============================================================
-- 49. Final QC override — PH / PM can Mark as Completed anyway.
--
-- WHY: Final QC is mandatory (48). manual_complete_order refuses with
-- FINAL_QC_REQUIRED while any active piece of the chosen product has not
-- reached final_qc_passed. The client now wants the Production Head and the
-- Production Manager to be able to override that gate and complete the
-- product regardless of the stage its pieces are on.
--
-- WHAT CHANGES: manual_complete_order gains p_override boolean DEFAULT false.
--   p_override = false -> byte-for-byte today's behaviour (the gate runs, the
--                         sweep only touches final_qc_passed pieces). Every
--                         existing caller keeps working untouched.
--   p_override = true  -> the gate is skipped and the sweep takes the chosen
--                         product's pieces from ANY stage to
--                         production_complete — INCLUDING pieces that were
--                         never cloth-issued (is_active = FALSE). Those are
--                         activated on the way, exactly as
--                         advance_component_stage does for an override (48
--                         sec. E): the override IS the authoritative start.
--                         Without that, an untouched order would report
--                         success while moving nothing.
--
-- Still refused even when overriding — these are not QC judgement calls:
--   * disposed / scrapped pieces. The garment is physically gone; completing
--     it would be false data, and 48's order-status rule already treats them
--     as not-outstanding.
--   * pieces out at a vendor (is_outside_wh). advance_component_stage refuses
--     to move those by ANY path except the security-gate return (48 sec. E);
--     letting completion leapfrog it would mark a garment finished while it
--     sits in someone else's building.
--
-- AUDIT: an override is recorded twice —
--   * stage_transitions, as today (transition_type 'manual_override'), and
--   * qc_records, as a which_qc='final' row flagged is_override, so the
--     order card's QC Report shows "overridden by ..." instead of silently
--     showing no Final QC at all. result stays 'pass' so any existing CHECK
--     constraint on that column still validates; is_override is what marks
--     the row, and the UI reads that, never result.
--
-- CONSEQUENCE (intended, worth stating): packaging accepts anything at
-- production_complete (48 sec. F), so an overridden piece can be packaged and
-- dispatched without ever passing Final QC. That is what "override the Final
-- QC to mark it complete" means.
--
-- Idempotent. Run on uat first, then prod.
-- ============================================================


-- ---- 1) qc_records: flag the override rows ----
ALTER TABLE public.qc_records ADD COLUMN IF NOT EXISTS is_override boolean NOT NULL DEFAULT false;
ALTER TABLE public.qc_records ADD COLUMN IF NOT EXISTS overridden_by text;

COMMENT ON COLUMN public.qc_records.is_override IS
  'TRUE when this Final QC row was created by a PH/PM Mark-as-Completed override rather than a real QC inspection. result is ''pass'' on these rows only so legacy CHECK constraints still validate — never read result to detect an override, read this.';


-- ---- 2) manual_complete_order + p_override ----
CREATE OR REPLACE FUNCTION public.manual_complete_order(
  p_order_id uuid,
  p_by text,
  p_item_index int DEFAULT NULL,     -- NULL = whole order; else one product
  p_override boolean DEFAULT false   -- TRUE = PH/PM bypasses the Final QC gate
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  r RECORD;
  v_blocking jsonb := '[]'::jsonb;
  v_count int := 0;
  v_overridden int := 0;
  v_any_left boolean;
BEGIN
  -- ---- Final QC gate, scoped to the chosen product ----
  -- Skipped entirely when overriding. Unchanged from 48 otherwise.
  IF NOT p_override THEN
    FOR r IN
      SELECT barcode, component_label, current_stage
      FROM order_components
      WHERE order_id = p_order_id
        -- NOT filtered on is_active. A never-cloth-issued piece is
        -- is_active = FALSE and has obviously not passed Final QC, so it
        -- BLOCKS — and blocking is what offers the override. Requiring
        -- is_active here made such a piece invisible to the gate (nothing to
        -- block) yet ineligible for the non-override sweep (which wants
        -- final_qc_passed), so the call fell through to NOTHING_TO_COMPLETE
        -- and the user was never offered the override at all.
        AND current_stage NOT IN
          ('final_qc_passed','production_complete','packaging_dispatch','dispatched','disposed','scrapped')
        AND (p_item_index IS NULL OR item_index = p_item_index)
    LOOP
      v_blocking := v_blocking || jsonb_build_object(
        'barcode', r.barcode,
        'component_label', r.component_label,
        'current_stage', r.current_stage::text);
    END LOOP;

    IF jsonb_array_length(v_blocking) > 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'FINAL_QC_REQUIRED',
        'blocking', v_blocking, 'item_index', p_item_index,
        'can_override', true,
        'message', 'Cannot mark as completed - ' || jsonb_array_length(v_blocking)
                || ' piece(s) have not passed Final QC yet. Final QC is mandatory.');
    END IF;
  END IF;

  -- ---- Vendor guard — refused even when overriding ----
  -- A piece physically at a vendor cannot be declared finished. Report it the
  -- same shape as the QC block so the UI can list the offending pieces, but
  -- WITHOUT can_override: there is no second confirm that gets past this.
  -- is_active = TRUE is deliberate HERE (unlike the QC gate above): a piece
  -- that never started production was never sent to a vendor, so it cannot be
  -- outside the warehouse.
  FOR r IN
    SELECT barcode, component_label, vendor_name
    FROM order_components
    WHERE order_id = p_order_id
      AND is_active = TRUE
      AND is_outside_wh = TRUE
      AND current_stage NOT IN ('disposed','scrapped')
      AND (p_item_index IS NULL OR item_index = p_item_index)
  LOOP
    v_blocking := v_blocking || jsonb_build_object(
      'barcode', r.barcode,
      'component_label', r.component_label,
      'vendor_name', COALESCE(r.vendor_name, 'Unknown'));
  END LOOP;

  IF jsonb_array_length(v_blocking) > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'COMPONENT_OUTSIDE_WH',
      'blocking', v_blocking, 'item_index', p_item_index,
      'can_override', false,
      'message', jsonb_array_length(v_blocking) || ' piece(s) are out at a vendor. '
              || 'Scan them back in at the Security Gate before completing this product.');
  END IF;

  -- ---- Move the scoped product's pieces to production_complete ----
  -- Normal run: only final_qc_passed pieces (48's behaviour), and only active
  --             ones — an inactive piece cannot have passed Final QC anyway.
  -- Override:   any stage except disposed/scrapped and anything already at or
  --             past production_complete (re-completing those is a no-op).
  --             INACTIVE PIECES INCLUDED: a piece that was never cloth-issued
  --             has is_active = FALSE, and "any stage" includes not-started.
  --             Filtering on is_active here would silently complete nothing
  --             and still report success. advance_component_stage already
  --             settles this the same way (48 sec. E): an override IS the
  --             authoritative start, so activate and carry on.
  FOR r IN
    SELECT id, order_no, barcode, current_stage, component_label, is_active
    FROM order_components
    WHERE order_id = p_order_id
      AND (p_override OR is_active = TRUE)
      AND (p_item_index IS NULL OR item_index = p_item_index)
      AND current_stage NOT IN
        ('production_complete','packaging_dispatch','dispatched','disposed','scrapped')
      AND (p_override OR current_stage = 'final_qc_passed')
  LOOP
    UPDATE order_components SET
      previous_stage = r.current_stage,
      current_stage = 'production_complete',
      -- Never-started piece being overridden: the override is its start.
      is_active = TRUE,
      activated_at = COALESCE(activated_at, NOW()),
      activated_by = COALESCE(activated_by, p_by),
      stage_updated_at = NOW(),
      updated_at = NOW()
    WHERE id = r.id;

    -- A piece that had genuinely passed Final QC is NOT an override, even on
    -- an override run — only the ones that skipped the gate are flagged.
    IF p_override AND r.current_stage <> 'final_qc_passed' THEN
      v_overridden := v_overridden + 1;

      INSERT INTO qc_records (
        component_id, order_id, order_no, barcode,
        result, which_qc, fail_reason, inspected_by,
        is_override, overridden_by
      ) VALUES (
        r.id, p_order_id, r.order_no, r.barcode,
        'pass', 'final',
        'Final QC overridden at ' || r.current_stage::text || ' by ' || p_by,
        p_by,
        TRUE, p_by
      );
    END IF;

    INSERT INTO stage_transitions (
      component_id, order_id, order_no, barcode,
      from_stage, to_stage, scanned_by, station_name, transition_type, notes
    ) VALUES (
      r.id, p_order_id, r.order_no, r.barcode,
      r.current_stage, 'production_complete', p_by, 'Mark as Completed', 'manual_override',
      CASE
        WHEN p_override AND r.current_stage <> 'final_qc_passed'
          THEN 'Final QC OVERRIDDEN at ' || r.current_stage::text
            || CASE WHEN NOT r.is_active THEN ' (piece had not started production)' ELSE '' END
            || CASE WHEN p_item_index IS NULL THEN '' ELSE ' (product ' || (p_item_index + 1) || ')' END
        WHEN p_item_index IS NULL THEN 'Production marked complete'
        ELSE 'Product ' || (p_item_index + 1) || ' production marked complete'
      END
    );

    v_count := v_count + 1;
  END LOOP;

  -- ---- Nothing moved? Say so, don't report a success that did nothing. ----
  -- Reaching here with v_count = 0 means the scope matched no completable
  -- piece — a bad p_item_index, or every piece already dispatched/disposed.
  -- Returning success would have the UI announce "marked as completed" over a
  -- no-op.
  IF v_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOTHING_TO_COMPLETE',
      'item_index', p_item_index,
      'can_override', false,
      'message', CASE WHEN p_item_index IS NULL
                      THEN 'This order has no pieces left to complete.'
                      ELSE 'Product ' || (p_item_index + 1) || ' has no pieces left to complete.'
                 END);
  END IF;

  -- ---- Order status: 'completed' ONLY when every active piece is at least
  -- production_complete (least-advanced-product rule). Unchanged from 48 —
  -- and the is_active filter is still right here: the override activates every
  -- piece it completes, so anything left inactive belongs to a DIFFERENT
  -- product that nobody has started. Those must not hold the order open (48's
  -- rule), and equally must not let it close: they are simply not outstanding
  -- work yet. ----
  SELECT EXISTS (
    SELECT 1 FROM order_components
    WHERE order_id = p_order_id AND is_active = TRUE
      AND current_stage NOT IN ('production_complete','packaging_dispatch','dispatched','disposed','scrapped')
  ) INTO v_any_left;

  IF NOT v_any_left THEN
    UPDATE orders SET status = 'completed', warehouse_stage_updated_at = NOW()
    WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id,
    'components_completed', v_count,
    'components_overridden', v_overridden,
    'item_index', p_item_index,
    'was_override', p_override,
    'order_completed', NOT v_any_left,
    'message', CASE WHEN p_item_index IS NULL
                    THEN 'Marked as completed - ' || v_count || ' piece(s) ready for Packaging & Dispatch.'
                    ELSE 'Product ' || (p_item_index + 1) || ' marked as completed - ' || v_count
                         || ' piece(s) ready for Packaging & Dispatch.'
                         || CASE WHEN v_any_left THEN ' Other products remain in production.' ELSE '' END
               END
            || CASE WHEN v_overridden > 0
                    THEN ' Final QC was OVERRIDDEN on ' || v_overridden || ' piece(s).'
                    ELSE '' END);
END;
$function$;

NOTIFY pgrst, 'reload schema';


-- ------------------------------------------------------------
-- VERIFY
-- ------------------------------------------------------------
-- 1) flag column exists:
--    SELECT column_name FROM information_schema.columns
--     WHERE table_name='qc_records' AND column_name IN ('is_override','overridden_by');
--
-- 2) default arg keeps old behaviour — a product with pieces short of Final QC:
--    SELECT manual_complete_order('<order_id>','me@x.com',0);
--    -> success=false, error=FINAL_QC_REQUIRED, can_override=true
--
-- 3) override completes it from any stage:
--    SELECT manual_complete_order('<order_id>','me@x.com',0,true);
--    -> success=true, components_overridden>0,
--       message ends "Final QC was OVERRIDDEN on N piece(s)."
--
-- 4) the QC Report row is there:
--    SELECT barcode, which_qc, result, is_override, overridden_by, fail_reason
--      FROM qc_records WHERE order_id='<order_id>' AND is_override;
--
-- 5) vendor guard holds even with override=true:
--    (set a piece is_outside_wh=true, then call with true)
--    -> success=false, error=COMPONENT_OUTSIDE_WH, can_override=false
--
-- 6) a genuinely-passed piece on an override run is NOT flagged:
--    product where 1 piece is final_qc_passed and 1 is at stitching, override
--    -> components_completed=2, components_overridden=1
--
-- 7) NEVER CLOTH-ISSUED piece (is_active=FALSE) — the case that motivated the
--    activate-on-override rule. Single-product order, nothing scanned at all:
--    SELECT manual_complete_order('<order_id>','me@x.com',NULL,true);
--    -> components_completed = the piece count (NOT 0), and afterwards:
--       SELECT is_active, activated_by, current_stage FROM order_components
--        WHERE order_id='<order_id>';   -- t | me@x.com | production_complete
--       SELECT to_stage, notes FROM stage_transitions
--        WHERE order_id='<order_id>' ORDER BY created_at DESC LIMIT 1;
--       -- production_complete | 'Final QC OVERRIDDEN at order_received
--       --                        (piece had not started production)'
--    and orders.status = 'completed'.
--
-- 8) no silent no-op: call with an item_index that matches nothing
--    -> success=false, error=NOTHING_TO_COMPLETE (never success with 0)
--
-- 9) the never-started piece is OFFERED the override (regression guard).
--    An is_active=FALSE piece must BLOCK on the plain call, not fall through
--    to NOTHING_TO_COMPLETE — otherwise the override is unreachable:
--    SELECT manual_complete_order('<order_id>','me@x.com',NULL,false);
--    -> success=false, error=FINAL_QC_REQUIRED, can_override=true,
--       blocking lists the piece at 'order_received'
--    THEN with true -> success, components_overridden=1.
