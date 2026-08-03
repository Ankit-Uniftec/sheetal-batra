import { supabase } from "../lib/supabaseClient";
import { CHANNEL_KEY_LABELS, distinctChannelKeys } from "./barcodeService";

// ============================================================
// QC history — shared data helpers for every qc_records view
// (QC person's own history, Production Manager, Production Heads).
// qc_records.result is the literal 'pass' | 'fail'; which_qc is
// 'qc1' | 'final'; inspected_by is the QC person's login email.
// ============================================================

export const QC_RECORD_COLUMNS =
  "id, barcode, component_id, order_id, order_no, result, which_qc, fail_reason, outcome, rejourney_number, scrap_loss_amount, scrap_location, inspected_by, created_at, is_override, overridden_by, channel_key";

// Channel labels/keys are shared with every other channel_key surface (the
// Re-journeys tab reads the same stored column on order_components) — see
// CHANNEL_KEY_LABELS in barcodeService.js. Re-exported so the QC components
// that already import from here don't need a second import path.
export { CHANNEL_KEY_LABELS };

// Human label for qc_records.which_qc ('qc1' | 'final'). Shared so the QC
// History rows and the Re-journeys "last fail" line can't drift apart.
export function whichQcLabel(whichQc) {
  return whichQc === "final" ? "Final QC" : "QC 1";
}

// Fetch QC records, scoped one of three ways:
//   { inspectedBy }        -> that QC person's own records ("My QC History")
//   { orderIds: [...] }     -> records for a set of orders (channel-scoped PH);
//                             chunked in 200s so a big list can't blow the .in() limit
//   { paged: true }         -> ALL records, paged past the 1000-row cap (Production Manager)
// Always newest-first.
export async function fetchQcRecords({ inspectedBy, orderIds, paged } = {}) {
  try {
    if (inspectedBy) {
      const { data, error } = await supabase
        .from("qc_records")
        .select(QC_RECORD_COLUMNS)
        .eq("inspected_by", inspectedBy)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    }

    if (Array.isArray(orderIds)) {
      if (orderIds.length === 0) return [];
      let all = [];
      for (let i = 0; i < orderIds.length; i += 200) {
        const chunk = orderIds.slice(i, i + 200);
        const { data, error } = await supabase
          .from("qc_records")
          .select(QC_RECORD_COLUMNS)
          .in("order_id", chunk)
          .order("created_at", { ascending: false });
        if (error) throw error;
        all = all.concat(data || []);
      }
      // Merge from multiple chunks -> re-sort newest first.
      return all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    if (paged) {
      const PAGE = 1000;
      let all = [];
      let from = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await supabase
          .from("qc_records")
          .select(QC_RECORD_COLUMNS)
          .order("created_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all = all.concat(data);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return all;
    }

    return [];
  } catch (err) {
    console.error("fetchQcRecords failed:", err);
    return [];
  }
}

// Pass/fail summary for the counts line.
// Overrides (PH/PM marked a piece complete without Final QC) are their OWN
// bucket, never counted as a pass: they carry result='pass' purely to satisfy
// the column's constraint, and folding them into the pass count would inflate
// the pass rate with garments nobody inspected. They're excluded from the fail
// rate's denominator too — an override is not a QC outcome either way.
export function qcSummary(records = []) {
  let pass = 0, fail = 0, override = 0;
  records.forEach((r) => {
    if (r.is_override === true) override++;
    else if (r.result === "fail") fail++;
    else pass++;
  });
  const total = records.length;
  const inspected = pass + fail;
  const failRatePct = inspected > 0 ? Math.round((fail / inspected) * 1000) / 10 : 0;
  return { total, pass, fail, override, failRatePct };
}

// Distinct channels present in a record set, as { key, label } for the dropdown.
//
// channel_key is a STORED fact, not something re-derived here: the DB writes it
// at inspection time from the order (trg_qc_records_set_channel →
// resolve_order_channel_key, db/…/v2/61), applying the same
// stock-flag-outranks-prefix rule as getOrderChannelKey. Inferring it in JS from
// the order_no prefix would mis-file stock raised through a store, whose flags
// aren't on qc_records at all.
//
// The Re-journeys tab reads the same stored column on order_components, so the
// implementation is shared rather than duplicated per surface.
export const distinctChannels = distinctChannelKeys;

// Client-side filtering for the dashboard controls. All filters optional.
//   from/to      : YYYY-MM-DD date bounds (inclusive) on created_at
//   result       : 'pass' | 'fail' | 'override'  ('pass'/'fail' exclude
//                  overrides — those rows are result='pass' on paper only)
//   whichQc      : 'qc1' | 'final'
//   inspectedBy  : exact QC-person email
//   channel      : exact qc_records.channel_key (see CHANNEL_KEY_LABELS)
//   search       : substring match on order_no or barcode (case-insensitive)
export function filterQcRecords(records = [], { from, to, result, whichQc, inspectedBy, channel, search } = {}) {
  const fromT = from ? new Date(from + "T00:00:00").getTime() : null;
  const toT = to ? new Date(to + "T23:59:59.999").getTime() : null;
  const q = (search || "").trim().toLowerCase();
  return records.filter((r) => {
    const isOverride = r.is_override === true;
    if (result === "override") { if (!isOverride) return false; }
    else if (result && (isOverride || r.result !== result)) return false;
    if (whichQc && r.which_qc !== whichQc) return false;
    if (inspectedBy && r.inspected_by !== inspectedBy) return false;
    if (channel && r.channel_key !== channel) return false;
    if (fromT || toT) {
      const t = new Date(r.created_at).getTime();
      if (fromT && t < fromT) return false;
      if (toT && t > toT) return false;
    }
    if (q) {
      const hay = `${r.order_no || ""} ${r.barcode || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// Distinct inspector emails present in a record set (for the QC-person dropdown).
export function distinctInspectors(records = []) {
  return [...new Set(records.map((r) => r.inspected_by).filter(Boolean))].sort();
}
