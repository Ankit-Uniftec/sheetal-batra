import { supabase } from "../lib/supabaseClient";

// ============================================================
// QC history — shared data helpers for every qc_records view
// (QC person's own history, Production Manager, Production Heads).
// qc_records.result is the literal 'pass' | 'fail'; which_qc is
// 'qc1' | 'final'; inspected_by is the QC person's login email.
// ============================================================

export const QC_RECORD_COLUMNS =
  "id, barcode, component_id, order_id, order_no, result, which_qc, fail_reason, outcome, rejourney_number, scrap_loss_amount, scrap_location, inspected_by, created_at";

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
export function qcSummary(records = []) {
  let pass = 0, fail = 0;
  records.forEach((r) => {
    if (r.result === "fail") fail++;
    else pass++;
  });
  const total = records.length;
  const failRatePct = total > 0 ? Math.round((fail / total) * 1000) / 10 : 0;
  return { total, pass, fail, failRatePct };
}

// Client-side filtering for the dashboard controls. All filters optional.
//   from/to      : YYYY-MM-DD date bounds (inclusive) on created_at
//   result       : 'pass' | 'fail'
//   whichQc      : 'qc1' | 'final'
//   inspectedBy  : exact QC-person email
//   search       : substring match on order_no or barcode (case-insensitive)
export function filterQcRecords(records = [], { from, to, result, whichQc, inspectedBy, search } = {}) {
  const fromT = from ? new Date(from + "T00:00:00").getTime() : null;
  const toT = to ? new Date(to + "T23:59:59.999").getTime() : null;
  const q = (search || "").trim().toLowerCase();
  return records.filter((r) => {
    if (result && r.result !== result) return false;
    if (whichQc && r.which_qc !== whichQc) return false;
    if (inspectedBy && r.inspected_by !== inspectedBy) return false;
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
