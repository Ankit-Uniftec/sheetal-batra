-- ============================================================
-- 50. Re-journey to Cloth Issue must require an actual Cloth Issue scan.
--
-- BUG: QC fails a piece and re-journeys it to Cloth Issue. The worker takes it
-- to the Cloth Issue station, scans, and is refused:
--
--   "This stage is already completed for this piece. Scan it at the next
--    station. A completed stage can only be redone if QC sends it back for
--    rework."   (STAGE_ALREADY_COMPLETED)
--
-- ...which is exactly the case QC just created. Two migrations disagree:
--
--   * 33 re-seeds step 1 as 'completed' on a re-journey to Cloth Issue, so the
--     mandatory-cloth-issue gate (all_mandatory_prior_done) keeps passing and
--     the piece is not stranded.
--   * 48's validity check refuses any scan-IN whose step is already
--     'completed'.
--
-- So 33 pre-completes step 1 and 48 then reads that as "already done, don't
-- scan it". The piece is scannable at the NEXT station but never at Cloth
-- Issue — the one place QC deliberately sent it.
--
-- WHY 33 DID THAT: Cloth Issue is a SINGLE-SCAN stage. cloth_issued IS its
-- completed state; there is no cloth_issued_completed to scan out to. The
-- generic engine treats every non-_completed/_passed stage as a scan-IN and
-- writes 'in_progress' (48 sec. E), so a re-scan could only ever leave step 1
-- open — and all_mandatory_prior_done requires step 1 'completed'. Deleting
-- 33's re-seed on its own would therefore strand the piece for good.
--
-- ROOT FIX: teach the scan engine what 33 worked around. A Cloth Issue scan-IN
-- IS the completion of step 1, so record it as 'completed' rather than
-- 'in_progress'. advance_component_stage already encodes exactly this for the
-- override path (48 sec. E, the p_to_stage = 'cloth_issued' branch) — this
-- gives the normal scan path the same truth. Then 33's re-seed is no longer
-- load-bearing and can stop pre-completing the step, so the worker must
-- genuinely re-issue the cloth.
--
-- RESULT: after a re-journey to Cloth Issue, step 1 is OPEN. The piece cannot
-- advance (the mandatory gate fails) until it is scanned at Cloth Issue, and
-- that scan closes step 1 in one action, as it does on the first pass.
--
-- Idempotent (CREATE OR REPLACE). Run on uat first, then prod.
-- ============================================================


-- -- SECTION A - advance_component_stage: Cloth Issue scan-in completes step 1.
-- 48 section E verbatim, with ONE change, marked FIX (50) below.
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
          (component_id, step, stage_in, status, scan_in_at, deadline, scanned_in_by, created_at)
        VALUES (v_component.id, v_to_step, p_to_stage, 'in_progress', 'override', NOW(), v_deadline, p_scanned_by, NOW())
        ON CONFLICT (component_id, step) DO UPDATE
          SET stage_in = EXCLUDED.stage_in,
              status = CASE WHEN component_stage_progress.status = 'completed' THEN 'completed' ELSE 'in_progress' END,
              scan_in_at = NOW(), deadline = EXCLUDED.deadline, scanned_in_by = p_scanned_by;
      ELSE
        PERFORM reconcile_ledger_to_step(v_component.id, v_to_step, p_scanned_by, 'override');
      END IF;

    -- FIX (50): Cloth Issue is a SINGLE-SCAN stage — its scan-IN *is* its
    -- completion (there is no cloth_issued_completed to scan out to). Record
    -- step 1 as 'completed', not 'in_progress'. The override branch above
    -- already treats it this way; this gives the normal station scan the same
    -- truth. Without it, a re-issued piece would sit at step 1 'in_progress'
    -- forever and never satisfy all_mandatory_prior_done — which is precisely
    -- why 33 had to pre-complete the step and, in doing so, made the station
    -- scan itself impossible (STAGE_ALREADY_COMPLETED).
    ELSIF p_to_stage = 'cloth_issued' THEN
      PERFORM auto_skip_leapfrogged(v_component.id, v_to_step);
      INSERT INTO component_stage_progress
        (component_id, step, stage_in, stage_out, status, scan_in_at, scan_out_at,
         deadline, scanned_in_by, scanned_out_by, is_on_time, created_at)
      VALUES (v_component.id, v_to_step, 'cloth_issued', 'cloth_issued', 'completed', NOW(), NOW(),
              v_deadline, p_scanned_by, p_scanned_by, v_is_on_time, NOW())
      ON CONFLICT (component_id, step) DO UPDATE
        SET stage_in = 'cloth_issued', stage_out = 'cloth_issued', status = 'completed',
            scan_in_at = NOW(), scan_out_at = NOW(), deadline = EXCLUDED.deadline,
            scanned_in_by = p_scanned_by, scanned_out_by = p_scanned_by,
            is_on_time = EXCLUDED.is_on_time;

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


-- -- SECTION B - record_qc_result: stop pre-completing step 1 on re-journey.
-- 33's body verbatim EXCEPT its re-seed block, which is now removed: with
-- SECTION A in place the Cloth Issue scan closes step 1 itself, so leaving the
-- step OPEN is both safe and correct — the cloth genuinely has not been
-- re-issued until someone re-issues it.
CREATE OR REPLACE FUNCTION public.record_qc_result(
  p_barcode text,
  p_result text,
  p_inspected_by text,
  p_which_qc text DEFAULT 'qc1',
  p_fail_reason text DEFAULT NULL,
  p_outcome text DEFAULT NULL,
  p_rejourney_to_stage production_stage DEFAULT NULL,
  p_scrap_loss_amount numeric DEFAULT 0,
  p_scrap_location text DEFAULT NULL,
  p_usable_material text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_component order_components%ROWTYPE;
  v_entry_stage production_stage;
  v_pass_stage  production_stage;
  v_new_stage   production_stage;
  v_is_final    boolean := (p_which_qc = 'final');
  v_outcome     text := COALESCE(p_outcome, '');
  v_is_urgent   boolean := FALSE;
BEGIN
  SELECT * INTO v_component FROM order_components WHERE barcode = p_barcode;
  IF v_component IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'BARCODE_NOT_FOUND');
  END IF;

  -- Resolve which QC we're recording
  IF v_is_final THEN
    v_entry_stage := 'final_qc_in_progress';
    v_pass_stage  := 'final_qc_passed';
  ELSE
    v_entry_stage := 'qc_in_progress';
    v_pass_stage  := 'qc_passed';
  END IF;

  IF v_component.current_stage <> v_entry_stage THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'NOT_AT_QC',
      'message', 'Component is at ' || v_component.current_stage::text ||
                 ', not at ' || v_entry_stage::text
    );
  END IF;

  -- Is the order urgent/priority? (highlight separately on fail)
  SELECT (
            COALESCE((row_to_json(o)::jsonb ->> 'is_urgent')::boolean, FALSE)
            OR (row_to_json(o)::jsonb ->> 'order_flag') = 'Urgent'
            OR (row_to_json(o)::jsonb ->> 'alteration_status') = 'upcoming_occasion'
         )
  INTO v_is_urgent
  FROM orders o WHERE o.id = v_component.order_id;

  -- ---------------- PASS ----------------
  IF p_result = 'pass' THEN
    v_new_stage := v_pass_stage;
    UPDATE order_components SET
      current_stage = v_pass_stage,
      previous_stage = v_entry_stage,
      qc_status = 'passed',
      stage_updated_at = NOW(),
      stage_deadline = NOW() + INTERVAL '1 day',
      updated_at = NOW()
    WHERE id = v_component.id;

    UPDATE component_stage_progress
      SET status = 'completed', scan_out_at = NOW(), scanned_out_by = p_inspected_by
      WHERE component_id = v_component.id AND step = get_stage_step(v_entry_stage);

  -- ---------------- FAIL ----------------
  ELSIF p_result = 'fail' THEN
    IF p_fail_reason IS NULL OR p_fail_reason = '' THEN
      RETURN jsonb_build_object('success', false, 'error', 'FAIL_REASON_REQUIRED');
    END IF;

    -- normalise outcome: legacy 'rejourney' == 'rework'
    IF v_outcome = 'rejourney' THEN v_outcome := 'rework'; END IF;

    IF v_outcome = 'rework' THEN
      IF p_rejourney_to_stage IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'REJOURNEY_STAGE_REQUIRED');
      END IF;
      v_new_stage := p_rejourney_to_stage;
      UPDATE order_components SET
        current_stage = p_rejourney_to_stage,
        previous_stage = v_entry_stage,
        qc_status = 'failed',
        re_journey_count = v_component.re_journey_count + 1,
        is_rework = TRUE,                 -- Rework priority tag
        stage_updated_at = NOW(),
        stage_deadline = NOW() + (get_stage_max_days(p_rejourney_to_stage) || ' days')::INTERVAL,
        scrap_loss_amount = COALESCE(scrap_loss_amount, 0) + p_scrap_loss_amount,
        updated_at = NOW()
      WHERE id = v_component.id;

      -- REWORK STRICTNESS: reopen the chosen stage AND everything after it in
      -- the progress ledger, so the worker must genuinely re-scan through them
      -- (their old 'completed' rows no longer satisfy all_mandatory_prior_done).
      -- We delete those rows; they get re-created on the next Scan-In.
      DELETE FROM component_stage_progress
      WHERE component_id = v_component.id
        AND step >= get_stage_step(p_rejourney_to_stage);

      -- FIX (50): 33's re-seed of step 1 is GONE. It existed only because a
      -- Cloth Issue scan could not complete step 1 itself; SECTION A now makes
      -- it do so. Re-seeding here marked the cloth as re-issued before anyone
      -- re-issued it, and made the Cloth Issue station reject the very scan QC
      -- had just asked for (STAGE_ALREADY_COMPLETED). Step 1 now stays OPEN
      -- after a re-journey to Cloth Issue: the piece cannot advance until it is
      -- genuinely scanned there, which is the point of sending it back.

    ELSIF v_outcome = 'dispose' THEN
      v_new_stage := 'disposed';
      UPDATE order_components SET
        current_stage = 'disposed', previous_stage = v_entry_stage,
        qc_status = 'failed', disposition = 'dispose',
        disposition_reason = p_fail_reason, scrap_loss_amount = p_scrap_loss_amount,
        stage_updated_at = NOW(), updated_at = NOW()
      WHERE id = v_component.id;

    ELSIF v_outcome = 'scrap' THEN
      v_new_stage := 'scrapped';
      UPDATE order_components SET
        current_stage = 'scrapped', previous_stage = v_entry_stage,
        qc_status = 'failed', disposition = 'scrap',
        disposition_reason = p_fail_reason, scrap_loss_amount = p_scrap_loss_amount,
        scrap_location = p_scrap_location,
        stage_updated_at = NOW(), updated_at = NOW()
      WHERE id = v_component.id;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'INVALID_OUTCOME');
    END IF;
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_RESULT');
  END IF;

  -- QC record (which_qc captured for reporting)
  INSERT INTO qc_records (
    component_id, order_id, order_no, barcode,
    result, fail_reason, outcome, which_qc,
    rejourney_to_stage, rejourney_number,
    scrap_loss_amount, scrap_location, usable_material, inspected_by
  ) VALUES (
    v_component.id, v_component.order_id, v_component.order_no, p_barcode,
    p_result, p_fail_reason, v_outcome, p_which_qc,
    p_rejourney_to_stage,
    CASE WHEN v_outcome = 'rework' THEN v_component.re_journey_count + 1 ELSE NULL END,
    p_scrap_loss_amount, p_scrap_location, p_usable_material, p_inspected_by
  );

  -- audit trail
  INSERT INTO stage_transitions (
    component_id, order_id, order_no, barcode,
    from_stage, to_stage, scanned_by, station_name, transition_type, notes
  ) VALUES (
    v_component.id, v_component.order_id, v_component.order_no, p_barcode,
    v_entry_stage, v_new_stage, p_inspected_by,
    CASE WHEN v_is_final THEN 'Final QC' ELSE 'QC 1' END,
    CASE WHEN p_result = 'pass' THEN 'scan'
         WHEN v_outcome = 'rework' THEN 'rejourney' ELSE 'scan' END,
    COALESCE(p_notes, p_fail_reason)
  );

  RETURN jsonb_build_object(
    'success', true,
    'barcode', p_barcode,
    'which_qc', p_which_qc,
    'result', p_result,
    'outcome', v_outcome,
    'new_stage', v_new_stage::text,
    'rejourney_count', v_component.re_journey_count + (CASE WHEN v_outcome = 'rework' THEN 1 ELSE 0 END),
    'is_urgent', v_is_urgent,
    'alert_fail', (p_result = 'fail'),
    'alert_manish', (v_component.re_journey_count + 1) >= 3
  );
END;
$function$;


-- ------------------------------------------------------------
-- SECTION C - repair pieces ALREADY stuck by this (run once).
--
-- A piece re-journeyed to Cloth Issue BEFORE this migration carries 33's
-- pre-completed step 1, so the Cloth Issue station still refuses it. Re-open
-- step 1 for those so they can be scanned normally.
--
-- NARROW BY DESIGN: only pieces that are (a) at cloth_issued, (b) flagged
-- is_rework, and (c) have been through QC at least once. A first-pass piece
-- sitting at cloth_issued legitimately has step 1 completed by
-- activate_components — those must NOT be touched, or the whole warehouse
-- would be asked to re-scan cloth it already issued.
--
-- PREVIEW FIRST — run this SELECT alone and eyeball the list:
--   SELECT oc.barcode, oc.order_no, oc.re_journey_count, p.status
--     FROM order_components oc
--     JOIN component_stage_progress p
--       ON p.component_id = oc.id AND p.step = 1
--    WHERE oc.is_active = TRUE
--      AND oc.current_stage = 'cloth_issued'
--      AND oc.is_rework = TRUE
--      AND oc.re_journey_count > 0
--      AND p.status = 'completed'
--    ORDER BY oc.order_no, oc.barcode;
--
-- Then run the DELETE below. Deleting (not updating) matches what the rework
-- path does for every other stage: the row is re-created by the scan.
-- ------------------------------------------------------------
DELETE FROM component_stage_progress p
 USING order_components oc
 WHERE p.component_id = oc.id
   AND p.step = 1
   AND p.status = 'completed'
   AND oc.is_active = TRUE
   AND oc.current_stage = 'cloth_issued'
   AND oc.is_rework = TRUE
   AND oc.re_journey_count > 0;

NOTIFY pgrst, 'reload schema';


-- ------------------------------------------------------------
-- VERIFY
-- ------------------------------------------------------------
-- 1) First pass is unchanged — a NEW piece scanned at Cloth Issue closes
--    step 1 in one scan:
--    SELECT status, scan_in_at, scan_out_at FROM component_stage_progress
--     WHERE component_id = '<id>' AND step = 1;     -- completed, both stamped
--
-- 2) THE BUG: QC 1 fail -> rework -> re-journey to Cloth Issue.
--    a. immediately after the QC call, step 1 must be GONE (not completed):
--       SELECT count(*) FROM component_stage_progress
--        WHERE component_id = '<id>' AND step = 1;          -- 0
--    b. the piece must NOT be able to skip ahead — scan it at, say, Stitching:
--       -> INVALID_TRANSITION ("Cloth Issue must be completed before ...")
--    c. scan it at Cloth Issue -> success (NOT STAGE_ALREADY_COMPLETED),
--       and step 1 is 'completed' again.
--    d. it can then move on to the next station normally.
--
-- 3) Re-journey to a NON-cloth stage still behaves as before (e.g. to
--    Stitching): steps >= that one are deleted, step 1 stays completed, and
--    the piece is scannable at Stitching.
--
-- 4) Override path untouched: a manual_override to cloth_issued still lands
--    step 1 'completed' in one action.
--
-- 5) Section C repaired the backlog:
--    SELECT count(*) FROM order_components oc
--      JOIN component_stage_progress p ON p.component_id = oc.id AND p.step = 1
--     WHERE oc.current_stage='cloth_issued' AND oc.is_rework
--       AND oc.re_journey_count > 0 AND p.status='completed';   -- 0
