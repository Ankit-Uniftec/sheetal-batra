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
// overdue, then most recently created). PM sees all; a channel-scoped caller can
// pass orderIds to keep only its own channel's movements.
export async function fetchExternalMovements({ orderIds } = {}) {
    try {
        let rows = (await fetchAllMovements()) || [];
        if (Array.isArray(orderIds)) {
            if (orderIds.length === 0) return [];
            const idSet = new Set(orderIds);
            rows = rows.filter((r) => r.order_id && idSet.has(r.order_id));
        }
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
export function filterExternalMovements(rows = [], { search, vendor, componentType, status, overdueOnly, stage } = {}) {
    const q = (search || "").trim().toLowerCase();
    return rows.filter((r) => {
        if (vendor && r.vendor_name !== vendor) return false;
        if (stage && (r.stageLabel || "—") !== stage) return false;
        if (componentType && r.component_type !== componentType) return false;
        if (status && r.status !== status) return false;
        if (overdueOnly && !r.overdue) return false;
        if (q) {
            const hay = `${r.order_no || ""} ${r.barcode || ""}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
}
