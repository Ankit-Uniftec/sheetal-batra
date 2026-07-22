-- ============================================================
-- 46. Remove the production_complete stage - "completed" is a STATUS.
--
-- 44 introduced a production_complete component stage. The client's clarified
-- model does not need it: finishing production is an ORDER STATUS change
-- (orders.status = 'completed'), and components legitimately stay at
-- final_qc_passed until the Packaging & Dispatch scan moves them to dispatched.
-- One vocabulary, no duplicate "Production Complete" / "Completed" badges.
--
-- THE FLOW (definitive):
--   order_received -> [cloth_issued ... final_qc_passed] -> completed
--                  -> dispatched (packaging scan) -> delivered (SA / courier API)
--
-- WHERE TO RUN:
--   * uat  - 44 and 45 were applied here, so this REVERSES 44's stage while
--            keeping 45's fixes. Run the whole file.
--   * prod - 44/45 were NEVER applied. Run this file as the ONLY migration of
--            the three: it deploys the same end state (Final QC mandatory,
--            manual-override auto-activation, status-only completion) without
--            ever introducing production_complete.
--
-- The enum label 'production_complete' added by 44 on uat is NOT dropped -
-- Postgres cannot remove an enum label - but nothing references it once these
-- functions are replaced. On prod it never existed.
--
-- Idempotent (CREATE OR REPLACE). Safe to re-run.
-- ============================================================


-- -- STEP 0 (uat only) - park anything left at production_complete back at
-- final_qc_passed, where the new model expects it. Matches nothing on prod.
UPDATE order_components
   SET current_stage = 'final_qc_passed', stage_updated_at = NOW(), updated_at = NOW()
 WHERE current_stage::text = 'production_complete';

UPDATE orders
   SET warehouse_stage = 'final_qc_passed'
 WHERE warehouse_stage::text = 'production_complete';


-- -- STEP 1 - stage model without production_complete.
CREATE OR REPLACE FUNCTION public.get_stage_step(stage production_stage)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
BEGIN
  RETURN CASE stage
    WHEN 'order_received'              THEN 0
    WHEN 'cloth_issued'               THEN 1
    WHEN 'dyeing_in_progress'         THEN 2
    WHEN 'dyeing_completed'           THEN 2
    WHEN 'pattern_cutting_in_progress' THEN 3
    WHEN 'pattern_cutting_completed'  THEN 3
    WHEN 'embroidery_in_progress'     THEN 4
    WHEN 'embroidery_completed'       THEN 4
    WHEN 'dry_cleaning_in_progress'   THEN 5
    WHEN 'dry_cleaning_completed'     THEN 5
    WHEN 'qc_in_progress'             THEN 6   -- QC 1
    WHEN 'qc_passed'                  THEN 6
    WHEN 'qc_failed'                  THEN 6
    WHEN 'stitching_in_progress'      THEN 7
    WHEN 'stitching_completed'        THEN 7
    WHEN 'hemming_in_progress'        THEN 8
    WHEN 'hemming_completed'          THEN 8
    WHEN 'final_qc_in_progress'       THEN 9
    WHEN 'final_qc_passed'            THEN 9
    WHEN 'final_qc_failed'            THEN 9
    WHEN 'packaging_dispatch'         THEN 10
    WHEN 'dispatched'                 THEN 10
    -- Removed / terminal stages -> 0 (not part of the new flow ordering)
    ELSE 0
  END;
END;
$function$;


-- -- STEP 2 - Final QC mandatory for packaging/dispatch.
CREATE OR REPLACE FUNCTION public.is_min_stages_met(p_component_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM component_stage_progress
    WHERE component_id = p_component_id AND step = 1 AND status = 'completed'
  )
  AND (
    EXISTS (
      SELECT 1 FROM component_stage_progress
      WHERE component_id = p_component_id AND step = 9 AND status = 'completed'
    )
    OR EXISTS (
      SELECT 1 FROM order_components
      WHERE id = p_component_id
        AND current_stage = 'final_qc_passed'
    )
  );
END;
$function$;


-- -- STEP 3 - advance_component_stage: 45's body carried forward verbatim
-- (Final QC message, manual-override auto-activation, cloth-issue ledger fix,
-- dispatched terminal guard).
CREATE OR REPLACE FUNCTION public.advance_component_stage(
  p_barcode text,
  p_to_stage production_stage,
  p_scanned_by text,
  p_station_name text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_transition_type text DEFAULT 'scan'
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_component order_components%ROWTYPE;
  v_to_step   INTEGER := get_stage_step(p_to_stage);
  v_is_in     BOOLEAN;
  v_is_out    BOOLEAN;
  v_max_days  INTEGER;
  v_deadline  timestamptz;
  v_order_total numeric;
  v_time_in_stage INTERVAL;
  v_is_on_time BOOLEAN := TRUE;
  v_open_step INTEGER;
BEGIN
  SELECT * INTO v_component FROM order_components WHERE barcode = p_barcode;
  IF v_component IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'BARCODE_NOT_FOUND',
      'message', 'No component found with barcode: ' || p_barcode);
  END IF;

  IF NOT v_component.is_active THEN
    -- A Production Head/Manager override may start a piece that was never
    -- activated (activation normally happens at the first Cloth Issue scan).
    -- The override IS the authoritative start — auto-activate and continue.
    -- Normal station scans still require activation first.
    IF p_transition_type = 'manual_override' THEN
      UPDATE order_components
        SET is_active = TRUE, activated_at = COALESCE(activated_at, NOW())
        WHERE id = v_component.id;
      v_component.is_active := TRUE;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'COMPONENT_NOT_ACTIVE',
        'message', 'Component is not yet activated for production', 'barcode', p_barcode);
    END IF;
  END IF;

  -- Outside-WH guard: a piece physically AT A VENDOR cannot be advanced by any
  -- path except the security-gate return. Manual override is NOT exempt.
  IF v_component.is_outside_wh AND p_transition_type <> 'security_entry' THEN
    RETURN jsonb_build_object('success', false, 'error', 'COMPONENT_OUTSIDE_WH',
      'message', 'This piece is out at a vendor (' || COALESCE(v_component.vendor_name, 'Unknown') ||
                 '). Scan it back in at the Security Gate before advancing or overriding it.',
      'barcode', p_barcode, 'vendor_name', v_component.vendor_name);
  END IF;

  -- Terminal states can't be scanned. 'dispatched' is terminal too — a
  -- completed/dispatched piece must not be re-scanned through any station.
  IF v_component.current_stage IN ('disposed', 'scrapped', 'dispatched') THEN
    RETURN jsonb_build_object('success', false, 'error', 'COMPONENT_TERMINATED',
      'message', 'This piece is ' || v_component.current_stage::text || ' and can no longer be scanned.',
      'barcode', p_barcode);
  END IF;

  v_is_out := p_to_stage::text LIKE '%_completed' OR p_to_stage::text LIKE '%_passed' OR p_to_stage = 'dispatched';
  v_is_in  := NOT v_is_out;

  -- ---- Validity ----
  IF p_transition_type = 'manual_override' THEN
    NULL; -- Production Head override: full bypass, still records ledger + pointer below.
  ELSIF v_is_in THEN
    IF EXISTS (
      SELECT 1 FROM component_stage_progress
      WHERE component_id = v_component.id AND step = v_to_step AND status = 'completed'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'STAGE_ALREADY_COMPLETED',
        'message', 'This stage is already completed for this piece. Scan it at the next station. '
                || 'A completed stage can only be redone if QC sends it back for rework.',
        'barcode', p_barcode, 'current_stage', v_component.current_stage::text);
    END IF;

    v_open_step := any_open_stage_except(v_component.id, v_to_step);
    IF v_open_step IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'PRIOR_STAGE_IN_PROGRESS',
        'message', step_label(v_open_step) || ' is still In-Progress for this piece. '
                || 'Scan it to Completed before starting ' || step_label(v_to_step) || '.',
        'barcode', p_barcode, 'current_stage', v_component.current_stage::text,
        'open_stage', step_label(v_open_step));
    END IF;

    IF NOT all_mandatory_prior_done(v_component.id, v_to_step) THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_TRANSITION',
        'message', 'Cloth Issue must be completed before scanning ' || p_to_stage::text || '.',
        'barcode', p_barcode, 'current_stage', v_component.current_stage::text);
    END IF;
    IF v_to_step = 10 AND NOT is_min_stages_met(v_component.id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'MIN_STAGES_NOT_MET',
        'message', 'Final QC must be passed before this piece can be packaged/dispatched. '
                || '(Cloth Issue and Final QC are mandatory.)',
        'barcode', p_barcode);
    END IF;
  END IF;

  -- ---- SLA deadline (clock from Scan-In) ----
  IF p_to_stage = 'embroidery_in_progress' THEN
    SELECT COALESCE(o.net_total, o.grand_total_after_discount, o.grand_total, NULL)
      INTO v_order_total FROM orders o WHERE o.id = v_component.order_id;
    v_max_days := get_embroidery_max_days(v_order_total);
  ELSE
    v_max_days := get_stage_max_days(p_to_stage);
  END IF;
  v_deadline := NOW() + (v_max_days || ' days')::INTERVAL;

  v_time_in_stage := NOW() - v_component.stage_updated_at;
  IF v_component.stage_deadline IS NOT NULL THEN
    v_is_on_time := NOW() <= v_component.stage_deadline;
  END IF;

  -- ---- Update component (pointer) ----
  UPDATE order_components SET
    previous_stage = current_stage,
    current_stage = p_to_stage,
    stage_updated_at = NOW(),
    stage_deadline = CASE WHEN v_is_in THEN v_deadline ELSE stage_deadline END,
    is_delayed = NOT v_is_on_time,
    delay_days = CASE WHEN NOT v_is_on_time
      THEN GREATEST(0, EXTRACT(DAY FROM v_time_in_stage) - COALESCE(v_max_days,1))::INTEGER ELSE 0 END,
    is_outside_wh = CASE WHEN p_transition_type = 'security_entry' THEN FALSE ELSE is_outside_wh END,
    vendor_return_at = CASE WHEN p_transition_type = 'security_entry' THEN NOW() ELSE vendor_return_at END,
    updated_at = NOW()
  WHERE id = v_component.id;

  -- ---- Progress ledger ----
  IF v_to_step > 0 THEN
    IF p_transition_type = 'manual_override' THEN
      -- FIX (34): a manual override is an authoritative correction. Close every
      -- stage still 'in_progress' from a prior scan that is NOT the new target
      -- (reconcile deliberately ignores skippable steps, which is what left them
      -- open and blocked the next scan). The target's own row is set below.
      UPDATE component_stage_progress
         SET status = 'completed', scan_out_at = NOW(), scanned_out_by = p_scanned_by
       WHERE component_id = v_component.id
         AND status = 'in_progress'
         AND step <> v_to_step;

      PERFORM reconcile_ledger_to_step(v_component.id,
              CASE WHEN v_is_out THEN v_to_step ELSE v_to_step - 1 END,
              p_scanned_by, 'override');
      IF p_to_stage = 'cloth_issued' THEN
        -- Cloth Issue is a single-scan stage (in + out at once): record step 1
        -- COMPLETED, exactly as activate_components seeds it. Leaving it
        -- in_progress would block every later station scan
        -- (PRIOR_STAGE_IN_PROGRESS / all_mandatory_prior_done).
        PERFORM reconcile_ledger_to_step(v_component.id, 1, p_scanned_by, 'override');
      ELSIF v_is_in THEN
        INSERT INTO component_stage_progress
          (component_id, step, stage_in, status, source, scan_in_at, deadline, scanned_in_by, created_at)
        VALUES (v_component.id, v_to_step, p_to_stage, 'in_progress', 'override', NOW(), v_deadline, p_scanned_by, NOW())
        ON CONFLICT (component_id, step) DO UPDATE
          SET stage_in = EXCLUDED.stage_in,
              status = CASE WHEN component_stage_progress.status = 'completed' THEN 'completed' ELSE 'in_progress' END,
              scan_in_at = NOW(), deadline = EXCLUDED.deadline, scanned_in_by = p_scanned_by;
      ELSE
        PERFORM reconcile_ledger_to_step(v_component.id, v_to_step, p_scanned_by, 'override');
      END IF;
    ELSIF v_is_in THEN
      PERFORM auto_skip_leapfrogged(v_component.id, v_to_step);
      INSERT INTO component_stage_progress
        (component_id, step, stage_in, status, scan_in_at, deadline, scanned_in_by, created_at)
      VALUES (v_component.id, v_to_step, p_to_stage, 'in_progress', NOW(), v_deadline, p_scanned_by, NOW())
      ON CONFLICT (component_id, step) DO UPDATE
        SET stage_in = EXCLUDED.stage_in, status = 'in_progress',
            scan_in_at = NOW(), deadline = EXCLUDED.deadline, scanned_in_by = p_scanned_by;
    ELSE
      PERFORM reconcile_ledger_to_step(v_component.id, v_to_step - 1, p_scanned_by, 'reconcile');
      INSERT INTO component_stage_progress
        (component_id, step, stage_out, status, scan_out_at, scanned_out_by, is_on_time, created_at)
      VALUES (v_component.id, v_to_step, p_to_stage, 'completed', NOW(), p_scanned_by, v_is_on_time, NOW())
      ON CONFLICT (component_id, step) DO UPDATE
        SET stage_out = p_to_stage, status = 'completed',
            scan_out_at = NOW(), scanned_out_by = p_scanned_by, is_on_time = v_is_on_time;
    END IF;
  END IF;

  -- ---- Audit trail ----
  INSERT INTO stage_transitions (
    component_id, order_id, order_no, barcode,
    from_stage, to_stage, scanned_by, station_name, transition_type,
    notes, is_on_time, time_in_stage
  ) VALUES (
    v_component.id, v_component.order_id, v_component.order_no, p_barcode,
    v_component.current_stage, p_to_stage, p_scanned_by, p_station_name, p_transition_type,
    p_notes, v_is_on_time, v_time_in_stage
  );

  RETURN jsonb_build_object(
    'success', true,
    'component_id', v_component.id,
    'barcode', p_barcode,
    'order_no', v_component.order_no,
    'component_type', v_component.component_type::text,
    'component_label', v_component.component_label,
    'from_stage', v_component.current_stage::text,
    'to_stage', p_to_stage::text,
    'is_on_time', v_is_on_time,
    'scan_kind', CASE WHEN v_is_in THEN 'scan_in' ELSE 'scan_out' END,
    'transition_type', p_transition_type
  );
END;
$function$;


-- -- STEP 4 - verify_packaging_components (44's body, production_complete
-- removed from the eligible set).
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

  -- Final QC gate — every in-scope piece must have PASSED Final QC (or
  -- already be past it, i.e. packaging/dispatched).
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


-- -- STEP 5 - manual_complete_order v4: STATUS ONLY.
-- Final QC stays mandatory. What changed vs 44: components are no longer
-- moved anywhere - marking an order completed is a statement about the
-- ORDER, and the pieces stay at final_qc_passed so the Packaging & Dispatch
-- scan picks them up exactly as it always has.
CREATE OR REPLACE FUNCTION public.manual_complete_order(
  p_order_id uuid,
  p_by text,
  p_item_index int DEFAULT NULL      -- NULL = whole order
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  r RECORD;
  v_blocking jsonb := '[]'::jsonb;
  v_scope_count int := 0;
  v_any_left boolean;
BEGIN
  -- ---- Final QC gate (mandatory, no bypass) ----
  FOR r IN
    SELECT barcode, component_label, current_stage
    FROM order_components
    WHERE order_id = p_order_id
      AND is_active = TRUE
      AND current_stage NOT IN
        ('final_qc_passed','packaging_dispatch','dispatched','disposed','scrapped')
      AND (p_item_index IS NULL OR item_index = p_item_index)
  LOOP
    v_blocking := v_blocking || jsonb_build_object(
      'barcode', r.barcode,
      'component_label', r.component_label,
      'current_stage', r.current_stage::text);
  END LOOP;

  IF jsonb_array_length(v_blocking) > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'FINAL_QC_REQUIRED',
      'blocking', v_blocking,
      'message', 'Cannot mark as completed - ' || jsonb_array_length(v_blocking)
              || ' piece(s) have not passed Final QC yet. Final QC is mandatory.');
  END IF;

  SELECT count(*) INTO v_scope_count
  FROM order_components
  WHERE order_id = p_order_id AND is_active = TRUE
    AND current_stage NOT IN ('disposed','scrapped')
    AND (p_item_index IS NULL OR item_index = p_item_index);

  IF v_scope_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_COMPONENTS',
      'message', CASE WHEN p_item_index IS NULL
                      THEN 'This order has no active components.'
                      ELSE 'Product ' || (p_item_index + 1) || ' has no active components.'
                 END);
  END IF;

  -- ---- ORDER STATUS ONLY ----
  -- Components are deliberately NOT moved. They stay at final_qc_passed until
  -- the Packaging & Dispatch scan advances them to dispatched. warehouse_stage
  -- is left to the sync trigger (44 forced 'dispatched' here, which claimed the
  -- order had shipped).
  SELECT EXISTS (
    SELECT 1 FROM order_components
    WHERE order_id = p_order_id AND is_active = TRUE
      AND current_stage NOT IN ('final_qc_passed','packaging_dispatch','dispatched','disposed','scrapped')
  ) INTO v_any_left;

  IF NOT v_any_left THEN
    UPDATE orders SET status = 'completed' WHERE id = p_order_id;
  END IF;

  -- Audit: one row per piece covered, recording who completed it and when.
  INSERT INTO stage_transitions (
    component_id, order_id, order_no, barcode,
    from_stage, to_stage, scanned_by, station_name, transition_type, notes
  )
  SELECT oc.id, p_order_id, oc.order_no, oc.barcode,
         oc.current_stage, oc.current_stage, p_by, 'Mark as Completed', 'manual_override',
         CASE WHEN p_item_index IS NULL
              THEN 'Production marked complete'
              ELSE 'Product ' || (p_item_index + 1) || ' production marked complete' END
  FROM order_components oc
  WHERE oc.order_id = p_order_id AND oc.is_active = TRUE
    AND oc.current_stage NOT IN ('disposed','scrapped')
    AND (p_item_index IS NULL OR oc.item_index = p_item_index);

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id,
    'components_completed', v_scope_count,
    'item_index', p_item_index,
    'order_completed', NOT v_any_left,
    'message', CASE WHEN p_item_index IS NULL
                    THEN 'Marked as completed - ready for Packaging & Dispatch.'
                    ELSE 'Product ' || (p_item_index + 1) || ' marked as completed - ready for Packaging & Dispatch.'
                         || CASE WHEN v_any_left THEN ' Other products remain in production.' ELSE '' END
               END);
END;
$function$;

NOTIFY pgrst, 'reload schema';


-- ------------------------------------------------------------
-- VERIFY
-- ------------------------------------------------------------
-- 1) Nothing parked at the dead stage (expect 0 and 0):
--   SELECT count(*) FROM order_components WHERE current_stage::text = 'production_complete';
--   SELECT count(*) FROM orders           WHERE warehouse_stage::text = 'production_complete';
-- 2) The dispatched terminal guard survived the redeploy - must list 'dispatched':
--   SELECT substring(prosrc from 'IN \(''disposed''[^)]*\)')
--   FROM pg_proc WHERE proname = 'advance_component_stage';
-- 3) Functional (uat):
--    a. Order with every piece final_qc_passed -> Mark as Completed:
--       orders.status = 'completed', components STILL final_qc_passed.
--    b. That same order packaging-scans normally -> components dispatched.
--    c. Order with a piece mid-production -> Mark as Completed refused,
--       listing the blocking pieces.
--    d. PM manual advance -> Cloth Issued on an order_received piece still
--       works (45's auto-activation) and then scans normally at the next
--       station (45's cloth-issue ledger fix).
