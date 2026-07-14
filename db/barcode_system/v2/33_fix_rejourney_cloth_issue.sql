-- ============================================================
-- 33. Fix: re-journey to Cloth Issue leaves the piece unscannable.
--
-- BUG: record_qc_result's rework branch DELETEs component_stage_progress rows
-- with step >= step(target) and relies on the worker re-scanning to re-create
-- them. Cloth Issue is a SINGLE-SCAN stage — cloth_issued IS its completed
-- state (there is no cloth_issued_completed to scan out to), so the generic
-- scan engine can only ever re-open it as in_progress, never re-complete it.
-- Re-journeying TO cloth_issued (step 1) therefore deletes the seeded step-1
-- 'completed' row (from activate_components, file 11) and creates no
-- replacement -> the mandatory-cloth-issue gate (all_mandatory_prior_done)
-- fails on the next scan, and the piece is stuck.
--
-- FIX: when the re-journey target is Cloth Issue, immediately re-seed its
-- 'completed' ledger row — exactly like activation does (11_fix_cloth_issue_
-- progress.sql:51-60). Being AT cloth_issued means it IS cloth-issued/done.
--
-- Also includes a one-time repair (3a) for pieces already stuck this way.
--
-- Idempotent (CREATE OR REPLACE). Run on uat first, then prod. Redeploys the
-- single definition of record_qc_result (file 05) with only the re-seed added.
-- ============================================================

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

      -- FIX (33): Cloth Issue is a single-scan stage — cloth_issued IS its
      -- completed state and has no _completed value to scan out to, so a normal
      -- re-scan can't re-complete it. When re-journeying TO cloth issue,
      -- immediately re-seed its completed ledger row (like activation does),
      -- so the mandatory-cloth-issue gate passes and the piece is scannable.
      IF get_stage_step(p_rejourney_to_stage) = 1 THEN
        INSERT INTO component_stage_progress
          (component_id, step, stage_in, stage_out, status, scan_in_at, scan_out_at, scanned_in_by, scanned_out_by, created_at)
        VALUES (v_component.id, 1, 'cloth_issued', 'cloth_issued', 'completed', NOW(), NOW(), p_inspected_by, p_inspected_by, NOW())
        ON CONFLICT (component_id, step) DO UPDATE
          SET status = 'completed', scan_out_at = NOW(), scanned_out_by = EXCLUDED.scanned_out_by;
      END IF;

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
-- 33 repair (3a): one-time fix for pieces ALREADY stuck by this bug — active
-- components sitting AT cloth_issued but missing the step-1 'completed' ledger
-- row. Narrow: only touches pieces literally missing the marker.
-- Preview first with the SELECT, then run the INSERT.
-- ------------------------------------------------------------
-- PREVIEW (run alone first to see how many pieces would be repaired):
--   SELECT oc.barcode, oc.order_no, oc.current_stage
--   FROM order_components oc
--   WHERE oc.is_active = TRUE AND oc.current_stage = 'cloth_issued'
--     AND NOT EXISTS (SELECT 1 FROM component_stage_progress c
--                     WHERE c.component_id = oc.id AND c.step = 1 AND c.status = 'completed');

INSERT INTO component_stage_progress
  (component_id, step, stage_in, stage_out, status, scan_in_at, scan_out_at, created_at)
SELECT oc.id, 1, 'cloth_issued', 'cloth_issued', 'completed', NOW(), NOW(), NOW()
FROM order_components oc
WHERE oc.is_active = TRUE AND oc.current_stage = 'cloth_issued'
  AND NOT EXISTS (
    SELECT 1 FROM component_stage_progress c
    WHERE c.component_id = oc.id AND c.step = 1 AND c.status = 'completed'
  )
ON CONFLICT (component_id, step) DO UPDATE
  SET status = 'completed', scan_out_at = NOW();

NOTIFY pgrst, 'reload schema';
