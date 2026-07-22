-- ============================================================
-- 44. completed / dispatched / delivered separation — the production_complete
--     stage + Final QC made mandatory.
--
-- CLIENT MODEL (clarified 2026-07-20): "completed", "dispatched" and
-- "delivered" are three different events that today collapse into one:
--   completed  = production finished making the garment (PH/PM mark this)
--   dispatched = packaged & left the warehouse (Aryadeep's dashboard, later —
--                until then the packaging scan station keeps doing it)
--   delivered  = customer received it (SA flow / BlueDart, later)
--
-- Until now manual_complete_order force-scanned every piece to 'dispatched'
-- and stamped warehouse_stage='dispatched', so "completed" orders claimed to
-- have shipped. This migration introduces a real stage for "made, awaiting
-- packaging":
--
--   … -> final_qc_passed -> PRODUCTION_COMPLETE -> packaging_dispatch -> dispatched
--
-- and makes Final QC mandatory in BOTH paths (client decision):
--   • scan path      — a piece cannot reach packaging/dispatch without Final QC
--   • Mark as Completed — refused unless every in-scope piece passed Final QC
--     (the button stops being a bypass)
--
-- NO EXISTING ROWS ARE TOUCHED. Function/enum changes only.
--
-- ⚠ RUN ORDER: run SECTION A alone first (ALTER TYPE … ADD VALUE cannot be
-- used by functions created in the same transaction). Then run B–F together.
-- uat first, then prod.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- SECTION A — the enum value. RUN THIS STATEMENT ALONE FIRST.
-- ────────────────────────────────────────────────────────────
ALTER TYPE production_stage ADD VALUE IF NOT EXISTS 'production_complete';


-- ────────────────────────────────────────────────────────────
-- SECTION B — stage model: production_complete sits at step 10 alongside
-- packaging/dispatched (same logical step, ordered before them). Keeping it
-- at 10 means NO renumbering: historical component_stage_progress rows,
-- escalation checks and every step comparison stay valid.
-- ────────────────────────────────────────────────────────────
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
    WHEN 'production_complete'        THEN 10  -- made, awaiting packaging
    WHEN 'packaging_dispatch'         THEN 10
    WHEN 'dispatched'                 THEN 10
    -- Removed / terminal stages -> 0 (not part of the new flow ordering)
    ELSE 0
  END;
END;
$function$;


-- ────────────────────────────────────────────────────────────
-- SECTION C — Final QC becomes mandatory for step 10 (packaging/dispatch).
-- Replaces 31b's cloth-issue-only rule. A piece qualifies when its Final QC
-- ledger row (step 9) is completed, or its stage already proves the pass
-- (final_qc_passed / production_complete).
-- ────────────────────────────────────────────────────────────
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
        AND current_stage IN ('final_qc_passed','production_complete')
    )
  );
END;
$function$;


-- ────────────────────────────────────────────────────────────
-- SECTION D — advance_component_stage: 37's deployed body VERBATIM with ONE
-- change — the MIN_STAGES_NOT_MET message now names Final QC (the gate itself
-- got stricter via Section C). Per 37's lesson: redeploys are based on the
-- latest deployed body, nothing else altered. The terminal guard still blocks
-- disposed/scrapped/dispatched; production_complete is NOT terminal (the
-- packaging scan must pick pieces up from it).
-- ────────────────────────────────────────────────────────────
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
    RETURN jsonb_build_object('success', false, 'error', 'COMPONENT_NOT_ACTIVE',
      'message', 'Component is not yet activated for production', 'barcode', p_barcode);
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
      IF v_is_in THEN
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


-- ────────────────────────────────────────────────────────────
-- SECTION E — verify_packaging_components: 36's body with ONE change —
-- 'production_complete' joins the packaging-eligible set (a piece the PH
-- marked complete is exactly what Aryadeep packages next). Everything else
-- verbatim.
-- ────────────────────────────────────────────────────────────
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

  -- Final QC gate — every in-scope piece must have PASSED Final QC (or already
  -- be past it). production_complete counts: it can only be reached from
  -- final_qc_passed via Mark as Completed.
  SELECT NOT EXISTS (
    SELECT 1 FROM order_components
    WHERE order_id = p_order_id AND is_active = TRUE
      AND current_stage NOT IN ('disposed','scrapped','final_qc_passed','production_complete','packaging_dispatch','dispatched')
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


-- ────────────────────────────────────────────────────────────
-- SECTION F — manual_complete_order v3: "Mark as Completed".
--
-- WAS: force-scanned every piece (from any stage, even order_received) to
-- 'dispatched' and stamped warehouse_stage='dispatched' — a completion that
-- claimed the order had shipped.
--
-- NOW (client decisions):
--   • Final QC is REQUIRED — if any in-scope piece has not passed Final QC
--     (and isn't disposed/scrapped), the call is refused with the list of
--     blocking pieces. The button is no longer a bypass.
--   • Qualifying pieces move final_qc_passed -> production_complete. Pieces
--     already at production_complete/packaging/dispatched are left alone —
--     they are at or past the target.
--   • Pieces stay SCANNABLE: packaging & dispatch still happens later (the
--     scan station today, Aryadeep's dashboard eventually).
--   • The ORDER goes status='completed' when nothing active remains before
--     production_complete. warehouse_stage reflects the truth: 'dispatched'
--     only if every piece already shipped, else 'production_complete'.
--   • No ledger rows are written: production_complete has no scan pair; the
--     step-10 ledger row belongs to the real packaging scan.
--
-- Same signature as 36 — CREATE OR REPLACE, existing callers keep working.
-- Response keys kept (order_completed, message); components_dispatched is
-- renamed components_completed (PM/B2bMerch/Warehouse read only
-- order_completed/message/success).
-- ────────────────────────────────────────────────────────────
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
  v_count int := 0;
  v_blocking jsonb := '[]'::jsonb;
  v_any_left boolean;
  v_all_dispatched boolean;
BEGIN
  -- ---- Final QC gate (mandatory, no bypass) ----
  FOR r IN
    SELECT barcode, component_label, current_stage
    FROM order_components
    WHERE order_id = p_order_id
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
      'blocking', v_blocking,
      'message', 'Cannot mark as completed — ' || jsonb_array_length(v_blocking)
              || ' piece(s) have not passed Final QC yet. Final QC is mandatory.');
  END IF;

  -- ---- Move qualifying pieces to production_complete ----
  FOR r IN
    SELECT id, order_no, barcode, current_stage
    FROM order_components
    WHERE order_id = p_order_id
      AND current_stage = 'final_qc_passed'
      AND (p_item_index IS NULL OR item_index = p_item_index)
  LOOP
    UPDATE order_components SET
      previous_stage = r.current_stage,
      current_stage = 'production_complete',
      stage_updated_at = NOW(),
      updated_at = NOW()
    WHERE id = r.id;

    INSERT INTO stage_transitions (
      component_id, order_id, order_no, barcode,
      from_stage, to_stage, scanned_by, station_name, transition_type, notes
    ) VALUES (
      r.id, p_order_id, r.order_no, r.barcode,
      r.current_stage, 'production_complete', p_by, 'Mark as Completed', 'manual_override',
      CASE WHEN p_item_index IS NULL
           THEN 'Production marked complete'
           ELSE 'Product ' || (p_item_index + 1) || ' production marked complete' END
    );

    v_count := v_count + 1;
  END LOOP;

  -- ---- Order status: completed once nothing active is left mid-production ----
  SELECT EXISTS (
    SELECT 1 FROM order_components
    WHERE order_id = p_order_id AND is_active = TRUE
      AND current_stage NOT IN ('production_complete','packaging_dispatch','dispatched','disposed','scrapped')
  ) INTO v_any_left;

  IF NOT v_any_left THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM order_components
      WHERE order_id = p_order_id AND is_active = TRUE
        AND current_stage NOT IN ('dispatched','disposed','scrapped')
    ) INTO v_all_dispatched;

    UPDATE orders SET
      status = 'completed',
      warehouse_stage = CASE WHEN v_all_dispatched THEN 'dispatched'::production_stage
                             ELSE 'production_complete'::production_stage END,
      warehouse_stage_updated_at = NOW()
    WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id,
    'components_completed', v_count,
    'item_index', p_item_index,
    'order_completed', NOT v_any_left,
    'message', CASE WHEN p_item_index IS NULL
                    THEN 'Marked as completed — ' || v_count || ' piece(s) ready for packaging & dispatch.'
                    ELSE 'Product ' || (p_item_index + 1) || ' marked as completed — ' || v_count
                         || ' piece(s) ready for packaging & dispatch.'
                         || CASE WHEN v_any_left THEN ' Other products remain in production.' ELSE '' END
               END);
END;
$function$;

NOTIFY pgrst, 'reload schema';


-- ────────────────────────────────────────────────────────────
-- VERIFY
-- ────────────────────────────────────────────────────────────
-- 1) Enum has the new value:
--   SELECT unnest(enum_range(NULL::production_stage))::text ORDER BY 1;
-- 2) Step mapping:
--   SELECT get_stage_step('production_complete');            -- expect 10
-- 3) The dispatched terminal guard survived the redeploy (37's lesson):
--   SELECT substring(prosrc from 'IN \(''disposed''[^)]*\)')
--   FROM pg_proc WHERE proname = 'advance_component_stage';  -- must include 'dispatched'
-- 4) fn_sync_order_warehouse_stage is NOT in this repo (pre-v2). Print its
--    body and eyeball how it treats an unknown stage; if it CASEs over stage
--    names it may need production_complete added — paste it back if unsure:
--   SELECT prosrc FROM pg_proc WHERE proname = 'fn_sync_order_warehouse_stage';
-- 5) Functional test on uat: an order with all pieces final_qc_passed —
--    Mark as Completed → pieces production_complete, order completed,
--    warehouse_stage production_complete; then packaging scan still works and
--    dispatches them. An order with a piece at stitching → refused with the
--    blocking list.
