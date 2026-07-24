import { fetchAllMovements, getStagesOutsideLabel } from "./barcodeService";

// ============================================================
// External vendor movements — the "items out to external vendors" view for the
// Production Manager (and, later, Production Head) dashboards.
//
// Source of truth is external_movements (one row per vendor trip), already
// joined to its component (barcode / order_no / component_type) and its order's
// placement date by fetchAllMovements(). Each row is decorated with the flags
// the panel needs, then filtered client-side. Mirrors qcHistory.js / reJourneys.js.
//
// Movement lifecycle statuses:
//   configured -> movement set up, piece not yet scanned out (still in-house)
//   exited     -> scanned out; physically AT the vendor right now ("currently out")
//   returned   -> scanned back in (history)
// ============================================================

// A component still counts as "currently out at a vendor" only while exited.
const OUT_STATUS = "exited";

function decorate(row) {
    const due = row.return_date ? new Date(row.return_date) : null;
    const now = new Date();
    const isOut = row.status === OUT_STATUS;
    // Overdue only applies to pieces still out past their return date.
    const overdue = !!(isOut && due && now > due);
    const daysOverdue = overdue ? Math.floor((now - due) / 86400000) : 0;
    return {
        ...row,
        isOut,
        overdue,
        daysOverdue,
        stageLabel: getStagesOutsideLabel(row.stages_outside) || "—",
    };
}

// Fetch every external movement, decorated and sorted (still-out first, then
// overdue, then most recently created). PM sees all; a channel-scoped caller
// passes channel to keep only its own side: "retail" drops B2B movements,
// "b2b" keeps only B2B. (orderIds still works for an explicit id-scoped view.)
export async function fetchExternalMovements({ orderIds, channel } = {}) {
    try {
        let rows = (await fetchAllMovements()) || [];
        if (Array.isArray(orderIds)) {
            if (orderIds.length === 0) return [];
            const idSet = new Set(orderIds);
            rows = rows.filter((r) => r.order_id && idSet.has(r.order_id));
        }
        // Channel scope: is_b2b is resolved per movement in fetchAllMovements.
        if (channel === "retail") rows = rows.filter((r) => !r.is_b2b);
        else if (channel === "b2b") rows = rows.filter((r) => r.is_b2b);
        const decorated = rows.map(decorate);
        decorated.sort((a, b) => {
            // Currently out first, then overdue, then newest.
            if (a.isOut !== b.isOut) return a.isOut ? -1 : 1;
            if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
            return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        });
        return decorated;
    } catch (err) {
        console.error("fetchExternalMovements failed:", err);
        return [];
    }
}

export function externalMovementSummary(rows = []) {
    return {
        total: rows.length,
        out: rows.filter((r) => r.isOut).length,
        overdue: rows.filter((r) => r.overdue).length,
        returned: rows.filter((r) => r.status === "returned").length,
    };
}

// Per-stage counts (by the stage a piece went OUT for), busiest first.
export function externalMovementStages(rows = []) {
    const counts = {};
    rows.forEach(r => { const k = r.stageLabel || "—"; counts[k] = (counts[k] || 0) + 1; });
    return Object.entries(counts)
        .map(([stage, count]) => ({ stage, count }))
        .sort((a, b) => b.count - a.count);
}

// Distinct vendor names present (for the vendor dropdown).
export function externalMovementVendors(rows = []) {
    return [...new Set(rows.map((r) => r.vendor_name).filter(Boolean))].sort();
}

// Client-side filtering for the panel controls.
//   search        : order_no / barcode substring
//   vendor        : vendor_name exact
//   componentType : top / bottom / dupatta / extra
//   status        : "" (all) | 'exited' (out) | 'returned' | 'configured'
//   overdueOnly   : only overdue rows
//   from / to     : YYYY-MM-DD bounds (inclusive) on the SENT-OUT date
//                   (exit_scan_at). A piece still awaiting scan-out has no
//                   exit_scan_at, so it falls outside any bounded range — which
//                   is correct: it has not gone out yet.
export function filterExternalMovements(rows = [], { search, vendor, componentType, status, overdueOnly, stage, from, to } = {}) {
    const q = (search || "").trim().toLowerCase();
    const fromT = from ? new Date(from + "T00:00:00").getTime() : null;
    const toT = to ? new Date(to + "T23:59:59.999").getTime() : null;
    return rows.filter((r) => {
        if (vendor && r.vendor_name !== vendor) return false;
        if (stage && (r.stageLabel || "—") !== stage) return false;
        if (componentType && r.component_type !== componentType) return false;
        if (status && r.status !== status) return false;
        if (overdueOnly && !r.overdue) return false;
        if (fromT || toT) {
            if (!r.exit_scan_at) return false;
            const t = new Date(r.exit_scan_at).getTime();
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

// CSV rows for the export — one array of header-keyed objects. Excel opens the
// resulting UTF-8-BOM CSV natively (the app has no XLSX library; every export
// is CSV). Uses the same labels the panel shows.
export function externalMovementsToCsvRows(rows = [], { formatDate } = {}) {
    const fmt = formatDate || ((d) => (d ? String(d) : ""));
    const STATUS = { configured: "Awaiting scan-out", exited: "Out at vendor", returned: "Returned" };
    const TYPE = { top: "Top", bottom: "Bottom", dupatta: "Dupatta", extra: "Extra" };
    return rows.map((r) => ({
        "Barcode": r.barcode || "",
        "Order No": r.order_no || "",
        "Component": TYPE[r.component_type] || r.component_type || "",
        "Vendor": r.vendor_name || "",
        "Vendor Location": r.vendor_location || "",
        "Stage (out for)": r.stageLabel || "",
        "Status": STATUS[r.status] || r.status || "",
        "Overdue (days)": r.overdue ? r.daysOverdue : "",
        "Sent Out": r.exit_scan_at ? fmt(r.exit_scan_at) : "",
        "Return By": r.return_date ? fmt(r.return_date) : "",
        "Returned": r.entry_scan_at ? fmt(r.entry_scan_at) : "",
        "Ordered": r.order_created_at ? fmt(r.order_created_at) : "",
    }));
}
