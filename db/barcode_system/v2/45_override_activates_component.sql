-- ============================================================
-- 45. Manual override can start a never-activated piece (Cloth Issue by PM).
--
-- BUG 1: the PM's manual stage advance on a piece still at order_received
-- failed with COMPONENT_NOT_ACTIVE — activation normally happens at the first
-- Cloth Issue scan, and the not-active guard fired BEFORE the manual_override
-- bypass. An override from the Production Manager/Head is the authoritative
-- start of that piece's journey, so it now auto-activates and proceeds.
-- Normal station scans still require activation (floor flow unchanged).
--
-- BUG 2 (found while verifying 1): an override TO cloth_issued wrote the
-- step-1 ledger row as in_progress. Cloth Issue is a single-scan stage —
-- activate_components seeds it COMPLETED (see 11) — and an open step 1 blocks
-- every later station scan with PRIOR_STAGE_IN_PROGRESS and fails
-- all_mandatory_prior_done. The override now records step 1 completed via
-- reconcile_ledger_to_step(…, 1, …), matching the normal activation path, so
-- scan stations behave identically afterwards. (This was a latent bug for
-- overrides-to-cloth-issue on active pieces too.)
--
-- Redeploys advance_component_stage from 44's body VERBATIM with only these
-- two patches (per 37's lesson: always base a redeploy on the latest deployed
-- body). Run on uat first, then prod (AFTER 44).
-- ============================================================

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

NOTIFY pgrst, 'reload schema';

-- VERIFY
-- 1) The dispatched terminal guard survived the redeploy:
--   SELECT substring(prosrc from 'IN (''disposed''[^)]*)')
--   FROM pg_proc WHERE proname = 'advance_component_stage';  -- must include 'dispatched'
-- 2) Functional (uat):
--    a. PM manual advance -> Cloth Issued on an order_received piece succeeds;
--       the piece shows is_active = TRUE, activated_at set, and its step-1
--       ledger row is status='completed' (NOT in_progress):
--         SELECT step, status FROM component_stage_progress
--         WHERE component_id = '<id>' ORDER BY step;
--    b. The SAME piece then scans normally at the next station (e.g. Dyeing
--       In) with no PRIOR_STAGE_IN_PROGRESS / INVALID_TRANSITION error.
--    c. A normal (non-override) scan on a different never-activated piece is
--       still refused with COMPONENT_NOT_ACTIVE.
