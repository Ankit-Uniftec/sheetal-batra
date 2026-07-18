import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

// ============================================================
// scan-report-daily — WhatsApp the day's scan report as an Excel (.xlsx) file.
//
// Queries stage_transitions for one day (every station scan, manual override,
// vendor-gate exit/entry and QC re-journey is one row there), builds the same
// table as the Production Manager's "Scan Report" export as a real .xlsx
// workbook, uploads it to the public `reports` storage bucket, and sends it
// through the spur-whatsapp function using the daily_scan_report template —
// whose Document header makes the file appear IN the chat as an attachment.
//
// NOTE: the file MUST be .xlsx, not .csv. WhatsApp does not reliably deliver
// CSV documents — it accepts the send (returns a message id, no error) but
// silently fails to deliver. XLSX is a WhatsApp-supported document type and
// delivers reliably. (This was the cause of "sent but not received".)
//
// Invocation:
//   pg_cron daily (see db/barcode_system/v2/38_scan_report_cron.sql), or
//   manually. Body options:
//     {}                          -> today's scans (IST)
//     { "day": "yesterday" }      -> the previous IST day — what the morning
//                                    cron sends: at 6am on the 17th, the
//                                    completed day is the 16th
//     { "date": "2026-07-16" }    -> a specific day
//     { "to": "9616774672" }      -> override recipient(s), comma-separated
//
// Secrets (Supabase function config):
//   SCAN_REPORT_TO       comma-separated recipient numbers (no + / spaces)
//   SCAN_REPORT_TEMPLATE template name (default daily_scan_report)
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REPORT_TO = Deno.env.get("SCAN_REPORT_TO") || "";
const REPORT_TEMPLATE = Deno.env.get("SCAN_REPORT_TEMPLATE") || "daily_scan_report";
const BUCKET = "reports";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// The report runs on IST days — scans happen in India, and "today's report"
// must mean the Indian day, not UTC (which is 5h30 behind).
const IST_OFFSET_MIN = 330;
// The IST calendar day, offset by daysAgo (0 = today, 1 = yesterday).
const istDay = (daysAgo = 0): string => {
  const now = new Date(Date.now() + IST_OFFSET_MIN * 60000 - daysAgo * 86400000);
  return now.toISOString().slice(0, 10);
};
// IST midnight expressed in UTC, for querying timestamptz columns.
const istDayToUtcRange = (day: string) => {
  const startUtc = new Date(new Date(`${day}T00:00:00Z`).getTime() - IST_OFFSET_MIN * 60000);
  const endUtc = new Date(startUtc.getTime() + 24 * 3600000 - 1);
  return { startUtc: startUtc.toISOString(), endUtc: endUtc.toISOString() };
};

// Human labels — mirror src/utils/scanReport.js so the WhatsApp file reads the
// same as the dashboard export.
const TYPE_LABEL: Record<string, string> = {
  scan: "Scan",
  manual_override: "Manual Override",
  security_exit: "Sent to Vendor",
  security_entry: "Back from Vendor",
  rejourney: "Re-journey (QC)",
};

const STAGE_LABEL: Record<string, string> = {
  order_received: "Order Received",
  cloth_issued: "Cloth Issued",
  dyeing_in_progress: "Dyeing In-Progress", dyeing_completed: "Dyeing Completed",
  pattern_cutting_in_progress: "Pattern Cutting In-Progress", pattern_cutting_completed: "Pattern Cutting Completed",
  embroidery_in_progress: "Embroidery In-Progress", embroidery_completed: "Embroidery Completed",
  dry_cleaning_in_progress: "Dry Cleaning In-Progress", dry_cleaning_completed: "Dry Cleaning Completed",
  qc_in_progress: "QC 1 In-Progress", qc_passed: "QC 1 Passed", qc_failed: "QC 1 Failed",
  stitching_in_progress: "Stitching In-Progress", stitching_completed: "Stitching Completed",
  hemming_in_progress: "Hemming In-Progress", hemming_completed: "Hemming Completed",
  final_qc_in_progress: "Final QC In-Progress", final_qc_passed: "Final QC Passed", final_qc_failed: "Final QC Failed",
  packaging_dispatch: "Packaging & Dispatch", dispatched: "Dispatched",
  disposed: "Disposed", scrapped: "Scrapped",
};
const stageLabel = (s: string | null) => (s ? STAGE_LABEL[s] || s : "");

serve(async (req) => {
  try {
    // Refuse a malformed body rather than silently treating it as {} — an
    // empty body falls back to the SCAN_REPORT_TO secret, so a shell-quoting
    // mishap would send the report to the real recipients instead of the test
    // number the caller asked for. (That happened.) An EMPTY body is still
    // fine — that's the cron's intentional shape.
    const raw = await req.text();
    let body: Record<string, unknown> = {};
    if (raw.trim() !== "") {
      try {
        body = JSON.parse(raw);
      } catch {
        return new Response(
          JSON.stringify({ success: false, error: `Request body is not valid JSON: ${raw.slice(0, 120)}` }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
    }
    // Explicit date wins; "yesterday" is the morning-cron mode (the completed
    // day); default is today (the manual "send me now" mode).
    const day: string = (body.date as string) || (body.day === "yesterday" ? istDay(1) : istDay(0));
    const toOverride: string = (body.to as string) || "";
    console.log(`Request: day=${day} (mode=${body.day || body.date || "today"}), to=${toOverride || "(secret)"}`);
    const { startUtc, endUtc } = istDayToUtcRange(day);

    // ---- 1) The day's scans (paged past the 1000-row cap) ----
    type Row = Record<string, any>;
    let rows: Row[] = [];
    const PAGE = 1000;
    for (let start = 0; ; start += PAGE) {
      const { data, error } = await supabase
        .from("stage_transitions")
        .select("order_no, barcode, from_stage, to_stage, scanned_by, station_name, transition_type, notes, scanned_at, order_components ( component_label, component_type )")
        .gte("scanned_at", startUtc)
        .lte("scanned_at", endUtc)
        .order("scanned_at", { ascending: true })
        .range(start, start + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      rows = rows.concat(data);
      if (data.length < PAGE) break;
    }

    if (rows.length === 0) {
      console.log(`No scans on ${day} — nothing to send.`);
      return new Response(JSON.stringify({ success: true, day, scans: 0, sent: false, message: "No scans that day" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ---- 2) Build the XLSX (same columns as the dashboard export) ----
    const headers = ["Date", "Time", "Order No", "Barcode", "Component", "From Stage", "To Stage", "Scanned By", "Station", "Type", "Notes"];
    const aoa: (string | number)[][] = [headers];
    rows.forEach((t) => {
      const d = new Date(new Date(t.scanned_at).getTime() + IST_OFFSET_MIN * 60000); // display in IST
      aoa.push([
        `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`,
        `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`,
        t.order_no || "",
        t.barcode || "",
        t.order_components?.component_label || t.order_components?.component_type || "",
        stageLabel(t.from_stage),
        stageLabel(t.to_stage),
        t.scanned_by || "",
        t.station_name || "",
        TYPE_LABEL[t.transition_type] || t.transition_type || "Scan",
        t.notes || "",
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Scan Report");
    // Uint8Array of the .xlsx binary — what we upload and WhatsApp delivers.
    const xlsx: Uint8Array = XLSX.write(wb, { type: "array", bookType: "xlsx" });

    // ---- 3) Upload to storage (public URL WhatsApp can fetch) ----
    const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const filename = `scan_report_${day}.xlsx`;
    const path = `scan-reports/${filename}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, new Blob([xlsx], { type: XLSX_MIME }), { upsert: true, contentType: XLSX_MIME });
    if (upErr) throw new Error(`Storage upload failed: ${upErr.message} — does the public '${BUCKET}' bucket exist?`);

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const fileUrl = pub.publicUrl;

    // ---- 4) Send via spur-whatsapp (document-header template) ----
    const recipients = (toOverride || REPORT_TO).split(",").map((s) => s.trim()).filter(Boolean);
    if (recipients.length === 0) {
      throw new Error("No recipient — set the SCAN_REPORT_TO secret or pass { to } in the request.");
    }

    const dayDisplay = day.split("-").reverse().join("-"); // 2026-07-16 -> 16-07-2026
    const results: Record<string, unknown>[] = [];
    for (const to of recipients) {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/spur-whatsapp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          customerName: dayDisplay,          // {{1}} = the date
          bodyParams: [String(rows.length)], // {{2}} = scan count
          customerPhone: to,
          template: REPORT_TEMPLATE,
          documentUrl: fileUrl,
          documentFilename: filename,
        }),
      });
      const out = await res.json();
      results.push({ to, ok: res.ok, out });
      if (!res.ok) console.error(`Send to ${to} failed:`, out);
    }

    const sentCount = results.filter((r) => r.ok).length;
    console.log(`Scan report ${day}: ${rows.length} scans, sent to ${sentCount}/${recipients.length}`);

    return new Response(
      JSON.stringify({ success: sentCount > 0, day, scans: rows.length, file: fileUrl, results }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("scan-report-daily error:", error);
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
