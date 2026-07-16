-- ============================================================
-- 38. Daily WhatsApp scan report — storage bucket + pg_cron schedule.
--
-- Every evening the scan-report-daily edge function queries the day's
-- stage_transitions, builds the scan-report CSV (same columns as the PM
-- dashboard's export), uploads it to the public `reports` bucket, and sends it
-- through spur-whatsapp using the daily_scan_report template — a Document-
-- header template, so the file lands IN the chat as an attachment.
--
-- PREREQUISITES (Supabase dashboard, once per environment):
--   1. Deploy the functions:  supabase functions deploy spur-whatsapp
--                             supabase functions deploy scan-report-daily
--   2. Function secrets:      SCAN_REPORT_TO = comma-separated numbers
--                             prod: 9650702500,9582466004
--                             (SCAN_REPORT_TEMPLATE optional, defaults to
--                              daily_scan_report — which must be APPROVED in
--                              Spur/Meta before sends will succeed)
--   3. Set the two placeholders below before running.
--
-- Schedule: 00:30 UTC = 06:00 IST — each morning it sends YESTERDAY's report
-- (the completed day: at 6am on the 17th you get the 16th's scans), via the
-- function's { "day": "yesterday" } mode.
-- Same invoke-an-edge-function-from-pg_cron pattern as notification-scheduler.
-- ============================================================

-- ── A) The public bucket the CSVs live in ─────────────────────
-- (WhatsApp fetches the document from a URL, so it must be publicly readable.
--  Idempotent: ON CONFLICT keeps re-runs safe.)
INSERT INTO storage.buckets (id, name, public)
VALUES ('reports', 'reports', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- ── B) The daily schedule ─────────────────────────────────────
-- REPLACE the two placeholders first:
--   <PROJECT_REF>       e.g. pgtiikhukgeyjcpjndqh (uat) / qlqvchcvuwjnfranqcmx (prod)
--   <SERVICE_ROLE_KEY>  the project's service-role key (Settings → API)
--
-- Re-running replaces the existing job (unschedule-if-exists first).
SELECT cron.unschedule('scan-report-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scan-report-daily');

SELECT cron.schedule(
  'scan-report-daily',
  '30 0 * * *',   -- 00:30 UTC = 06:00 IST daily
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/scan-report-daily',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{"day": "yesterday"}'::jsonb
  );
  $$
);

-- ── VERIFY ────────────────────────────────────────────────────
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'scan-report-daily';
-- SELECT id, public FROM storage.buckets WHERE id = 'reports';
--
-- Manual test (any shell) — send TODAY's report to one number:
--   curl -X POST 'https://<PROJECT_REF>.supabase.co/functions/v1/scan-report-daily' \
--     -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' -H 'Content-Type: application/json' \
--     -d '{"to": "9616774672"}'
-- ... or exactly what the 6am cron will send (yesterday's report):
--   -d '{"day": "yesterday", "to": "9616774672"}'
