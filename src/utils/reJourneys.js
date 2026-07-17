import { supabase } from "../lib/supabaseClient";

// ============================================================
// Re-journeys — the live "currently in rework" list for the PM and
// Production Head dashboards. A component is in re-journey when a QC fail
// sent it back to an earlier stage for rework (order_components.is_rework).
//
// Source of truth is order_components (the live rework STATE); each row is
// enriched with its most recent qc_records rework event (the "why it
// failed / restarted to"). Mirrors the shape of qcHistory.js.
// ============================================================

// A component still counts as "currently in rework" only until it clears QC /
// leaves production. is_rework is never reset, so exclude terminal stages.
const TERMINAL_STAGES = new Set([
    "qc_passed", "final_qc_passed", "packaging_dispatch", "dispatched", "disposed", "scrapped",
]);

const COMPONENT_COLUMNS =
    "id, order_id, order_no, barcode, component_type, component_label, current_stage, previous_stage, re_journey_count, is_rework, is_active, is_delayed, stage_deadline, stage_updated_at";

const QC_ENRICH_COLUMNS =
    "component_id, fail_reason, which_qc, rejourney_to_stage, rejourney_number, inspected_by, created_at";

// Attach live-state derived flags used by the card.
function decorate(row) {
    const deadline = row.stage_deadline ? new Date(row.stage_deadline) : null;
    const now = new Date();
    const overdue = !!(deadline && now > deadline);
    const daysOverdue = overdue ? Math.floor((now - deadline) / 86400000) : 0;
    const count = Number(row.re_journey_count) || 0;
    return { ...row, overdue, daysOverdue, atLimit: count >= 2, overLimit: count >= 3 };
}

// Fetch the live in-rework components (PM = all via paged; PH = own channel
// via orderIds), enriched with each piece's latest rework fail event.
export async function fetchReJourneys({ orderIds, paged } = {}) {
    try {
        let components = [];

        if (Array.isArray(orderIds)) {
            if (orderIds.length === 0) return [];
            for (let i = 0; i < orderIds.length; i += 200) {
                const chunk = orderIds.slice(i, i + 200);
                const { data, error } = await supabase
                    .from("order_components")
                    .select(COMPONENT_COLUMNS)
                    .in("order_id", chunk)
                    .eq("is_rework", true)
                    .eq("is_active", true);
                if (error) throw error;
                components = components.concat(data || []);
            }
        } else if (paged) {
            const PAGE = 1000;
            let from = 0;
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const { data, error } = await supabase
                    .from("order_components")
                    .select(COMPONENT_COLUMNS)
                    .eq("is_rework", true)
                    .eq("is_active", true)
                    .range(from, from + PAGE - 1);
                if (error) throw error;
                if (!data || data.length === 0) break;
                components = components.concat(data);
                if (data.length < PAGE) break;
                from += PAGE;
            }
        } else {
            return [];
        }

        // Exclude pieces that have since cleared production (no longer "current").
        components = components.filter(c => !TERMINAL_STAGES.has(c.current_stage));
        if (components.length === 0) return [];

        // Enrich with the latest rework qc_record per component.
        const compIds = components.map(c => c.id);
        const latestByComp = {};
        for (let i = 0; i < compIds.length; i += 200) {
            const chunk = compIds.slice(i, i + 200);
            const { data, error } = await supabase
                .from("qc_records")
                .select(QC_ENRICH_COLUMNS)
                .in("component_id", chunk)
                .eq("outcome", "rework")
                .order("created_at", { ascending: false });
            if (error) throw error;
            (data || []).forEach(r => {
                // First seen per component is the newest (ordered desc).
                if (!latestByComp[r.component_id]) latestByComp[r.component_id] = r;
            });
        }

        const rows = components.map(c => decorate({ ...c, lastFail: latestByComp[c.id] || null }));

        // Overdue first, then most re-journeys, then most recently updated.
        rows.sort((a, b) => {
            if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
            if ((b.re_journey_count || 0) !== (a.re_journey_count || 0)) return (b.re_journey_count || 0) - (a.re_journey_count || 0);
            return new Date(b.stage_updated_at || 0) - new Date(a.stage_updated_at || 0);
        });
        return rows;
    } catch (err) {
        console.error("fetchReJourneys failed:", err);
        return [];
    }
}

export function reJourneySummary(rows = []) {
    return {
        total: rows.length,
        overdue: rows.filter(r => r.overdue).length,
        atLimit: rows.filter(r => r.atLimit).length,
    };
}

// Distinct current stages present (for the stage dropdown).
export function reJourneyStages(rows = []) {
    return [...new Set(rows.map(r => r.current_stage).filter(Boolean))];
}

// Per-stage counts, busiest first — { stage, count }[]. Lets the panel show
// which stage has the most re-journeys and label the dropdown with counts.
export function reJourneyStageCounts(rows = []) {
    const counts = {};
    rows.forEach(r => { if (r.current_stage) counts[r.current_stage] = (counts[r.current_stage] || 0) + 1; });
    return Object.entries(counts)
        .map(([stage, count]) => ({ stage, count }))
        .sort((a, b) => b.count - a.count);
}

// Client-side filtering for the panel controls.
//   search      : order_no / barcode substring
//   stage       : current_stage exact
//   overdueOnly : only overdue rows
//   atLimitOnly : only rows at/over the re-journey limit (>= 2)
export function filterReJourneys(rows = [], { search, stage, overdueOnly, atLimitOnly } = {}) {
    const q = (search || "").trim().toLowerCase();
    return rows.filter(r => {
        if (stage && r.current_stage !== stage) return false;
        if (overdueOnly && !r.overdue) return false;
        if (atLimitOnly && !r.atLimit) return false;
        if (q) {
            const hay = `${r.order_no || ""} ${r.barcode || ""}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
}
