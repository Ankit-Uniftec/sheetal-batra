import { supabase } from "../lib/supabaseClient";
import { getStageLabel } from "./barcodeService";

// ============================================================
// Scan report — every component scan in a date range, one row per scan.
//
// "Which pieces moved today / this week?" Source of truth is
// stage_transitions: every stage movement writes one row there (station scans,
// PM/PH manual overrides, security-gate vendor exits/entries, QC re-journeys),
// each stamped with scanned_at, so a date-range filter IS the report. No
// state reconstruction needed.
// ============================================================

// Human labels for transition_type, so the CSV's Type column reads plainly.
const TYPE_LABEL = {
    scan: "Scan",
    manual_override: "Manual Override",
    security_exit: "Sent to Vendor",
    security_entry: "Back from Vendor",
    rejourney: "Re-journey (QC)",
};

// Fetch every transition scanned within [from, to] (inclusive, whole days).
// Paged: a busy week can exceed PostgREST's row cap, and .range() pages are
// the same pattern the dashboards already use for orders/components.
export async function fetchScanReport({ from, to }) {
    if (!from || !to) return [];
    const fromIso = `${from}T00:00:00`;
    const toIso = `${to}T23:59:59.999`;

    const PAGE = 1000;
    let rows = [];
    let start = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const { data, error } = await supabase
            .from("stage_transitions")
            .select("id, order_id, order_no, barcode, from_stage, to_stage, scanned_by, station_name, transition_type, notes, scanned_at, order_components ( component_label, component_type )")
            .gte("scanned_at", fromIso)
            .lte("scanned_at", toIso)
            .order("scanned_at", { ascending: true })
            .range(start, start + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        rows = rows.concat(data);
        if (data.length < PAGE) break;
        start += PAGE;
    }

    return rows.map((t) => ({
        ...t,
        component_label: t.order_components?.component_label || null,
        component_type: t.order_components?.component_type || null,
        type_label: TYPE_LABEL[t.transition_type] || t.transition_type || "Scan",
    }));
}

// CSV-escape: wrap anything holding a comma/quote/newline; double the quotes.
const esc = (v) => {
    const s = (v ?? "").toString();
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Build the CSV text for a set of report rows (full-detail columns).
export function scanReportCsv(rows) {
    const headers = ["Date", "Time", "Order No", "Barcode", "Component", "From Stage", "To Stage", "Scanned By", "Station", "Type", "Notes"];
    const body = rows.map((t) => {
        const d = t.scanned_at ? new Date(t.scanned_at) : null;
        return [
            d ? d.toLocaleDateString("en-GB") : "",
            d ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "",
            t.order_no || "",
            t.barcode || "",
            t.component_label || t.component_type || "",
            t.from_stage ? (getStageLabel(t.from_stage) || t.from_stage) : "",
            t.to_stage ? (getStageLabel(t.to_stage) || t.to_stage) : "",
            t.scanned_by || "",
            t.station_name || "",
            t.type_label,
            t.notes || "",
        ].map(esc).join(",");
    });
    return [headers.join(","), ...body].join("\n");
}
