// ============================================================
// Vendor delays (Release 20) — the analytics behind the Production Manager's
// "Vendor Delays" tab. Pure functions over the vendor trips the PM dashboard
// already loads (external_movements via fetchExternalMovements) and the orders
// it already holds — no extra queries.
//
// A trip is LATE when it came back (or, still out, is now) after the END of its
// promised return day, India time. Days late = whole days past that point,
// rounded up — the same rule the penalty SQL (r20_01) uses.
// Our own warehouse (SB WH Delhi (2)) is not a vendor and is left out.
// ============================================================
import { getStagesOutsideLabel, getStepLabel, getOrderChannelLabel } from "./barcodeService";

const DAY = 86400000;
export const OWN_WAREHOUSE = "SB WH Delhi (2)";
export const PIECE_LABEL = { top: "Top", bottom: "Bottom", dupatta: "Dupatta", extra: "Extra" };

// End of a YYYY-MM-DD day in India (UTC+5:30, no DST).
export const endOfDayIst = (ymd) => (ymd ? Date.parse(`${ymd}T23:59:59.999+05:30`) : NaN);
// The India calendar date (YYYY-MM-DD) of an instant.
export const istDate = (ms) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);
const addDaysYmd = (ymd, n) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};
const dayDiff = (fromYmd, toYmd) => Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / DAY);

/**
 * The promised day a vendor is judged against. Normally the trip's return
 * date. But a trip can be SET UP long before it is sent out, so the return date
 * may already have passed when the piece leaves — the vendor never had those
 * days. Then the clock starts on the send date + the turnaround that was
 * planned at set-up (return date − set-up date, at least 1 day). The penalty
 * SQL (r20_01) uses exactly this rule.
 */
export function effectiveDueDate(m) {
    const promised = String(m.return_date).slice(0, 10);
    const sentAt = Date.parse(m.exit_scan_at);
    if (!(sentAt > endOfDayIst(promised))) return { due: promised, adjusted: false };
    const setupDay = istDate(Date.parse(m.created_at || m.exit_scan_at));
    const planned = Math.max(1, dayDiff(setupDay, promised));
    return { due: addDaysYmd(istDate(sentAt), planned), adjusted: true, planned };
}

/** Production deadline = delivery date − 2 days (the T-2 rule), end of day IST. */
export function productionDeadline(deliveryDate) {
    if (!deliveryDate) return NaN;
    const d = new Date(`${String(deliveryDate).slice(0, 10)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 2);
    return endOfDayIst(d.toISOString().slice(0, 10));
}

/**
 * Turn movements + orders into trip rows with the delay facts.
 * Only trips that actually went out (exited / returned) with a promised date.
 */
export function buildDelayTrips(movements = [], orderById = {}, now = Date.now()) {
    const out = [];
    for (const m of movements) {
        if (!m || m.vendor_name === OWN_WAREHOUSE || m.is_factory2) continue;
        if (m.status !== "exited" && m.status !== "returned") continue;
        if (!m.return_date || !m.exit_scan_at) continue;
        const eff = effectiveDueDate(m);
        const due = endOfDayIst(eff.due);
        const sentAt = Date.parse(m.exit_scan_at);
        if (!Number.isFinite(due) || !Number.isFinite(sentAt)) continue;
        const returned = m.status === "returned" && !!m.entry_scan_at;
        const endAt = returned ? Date.parse(m.entry_scan_at) : now;
        const daysLate = Math.max(0, Math.ceil((endAt - due) / DAY));
        const order = orderById[m.order_id] || null;
        const item = order && Array.isArray(order.items) && m.item_index != null ? order.items[m.item_index] : null;
        const deadline = productionDeadline(order?.delivery_date);
        const steps = [...(m.stages_outside || [])].sort((a, b) => a - b);
        out.push({
            id: m.id,
            movement: m,
            vendor: m.vendor_name || "—",
            vendorId: m.vendor_id || null,
            piece: m.component_type || "extra",
            pieceLabel: PIECE_LABEL[m.component_type] || m.component_type || "Extra",
            // Main work = the first stage the piece went out for (Dyeing,
            // Embroidery, Stitching…); the full list stays on the card.
            work: getStepLabel(steps[0]) || "—",
            workDetail: getStagesOutsideLabel(steps) || "—",
            barcode: m.barcode || "",
            orderId: m.order_id || null,
            orderNo: order?.order_no || m.order_no || "",
            client: order?.delivery_name || "",
            channel: order ? getOrderChannelLabel(order) : "—",
            product: item?.product_name || "",
            sentAt,
            due,
            promisedOriginal: endOfDayIst(String(m.return_date).slice(0, 10)),
            dueAdjusted: eff.adjusted,
            returnedAt: returned ? endAt : null,
            isOut: !returned,
            isLate: daysLate > 0,
            daysLate,
            promisedDays: Math.max(0, Math.round((due - sentAt) / DAY)),
            actualDays: returned ? +((endAt - sentAt) / DAY).toFixed(1) : null,
            deadline,
            missedDeadline: daysLate > 0 && Number.isFinite(deadline) && endAt > deadline,
            penaltyId: null,
            createdBy: m.created_by || "",
            isRepeat: !!m.isRepeat,
        });
    }
    return out;
}

/** Attach penalty ids from vendor_penalty_trips rows ({ movement_id, penalty_id }). */
export function attachPenalties(trips, penaltyTrips = []) {
    const byMove = new Map(penaltyTrips.map((p) => [p.movement_id, p.penalty_id]));
    return trips.map((t) => (byMove.has(t.id) ? { ...t, penaltyId: byMove.get(t.id) } : t));
}

const pct = (a, b) => (b > 0 ? Math.round((100 * a) / b) : 0);
const avg = (sum, n) => (n > 0 ? +(sum / n).toFixed(1) : 0);

/** Headline numbers for a set of trips. */
export function delaySummary(trips = []) {
    const returned = trips.filter((t) => !t.isOut);
    const lateReturned = returned.filter((t) => t.isLate);
    const overdueNow = trips.filter((t) => t.isOut && t.isLate);
    return {
        returned: returned.length,
        onTimePct: pct(returned.length - lateReturned.length, returned.length),
        lateReturned: lateReturned.length,
        avgDaysLate: avg(lateReturned.reduce((s, t) => s + t.daysLate, 0), lateReturned.length),
        overdueNow: overdueNow.length,
        oldestOverdue: overdueNow.reduce((m, t) => Math.max(m, t.daysLate), 0),
        missedDeadline: trips.filter((t) => t.missedDeadline).length,
    };
}

/** Group helper: key → stats + the trips behind it (for click-through). */
export function groupTrips(trips, keyOf) {
    const map = new Map();
    for (const t of trips) {
        const k = keyOf(t);
        if (k == null) continue;
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(t);
    }
    return [...map.entries()].map(([key, list]) => {
        const done = list.filter((t) => !t.isOut);
        const late = list.filter((t) => t.isLate);
        const lateDone = done.filter((t) => t.isLate);
        return {
            key,
            trips: list,
            n: list.length,
            judged: done.length + list.filter((t) => t.isOut && t.isLate).length,
            late: late.length,
            latePct: pct(late.length, done.length + list.filter((t) => t.isOut && t.isLate).length),
            avgDaysLate: avg(late.reduce((s, t) => s + t.daysLate, 0), late.length),
            worstDaysLate: late.reduce((m, t) => Math.max(m, t.daysLate), 0),
            overdueNow: list.filter((t) => t.isOut && t.isLate).length,
            missedDeadline: list.filter((t) => t.missedDeadline).length,
            avgPromised: avg(done.reduce((s, t) => s + t.promisedDays, 0), done.length),
            avgActual: avg(done.reduce((s, t) => s + (t.actualDays || 0), 0), done.length),
            lateDone: lateDone.length,
        };
    });
}

/** Vendor scorecard, with the change in late % vs a previous period's trips. */
export function vendorScorecard(trips, prevTrips = null) {
    const prev = prevTrips ? new Map(groupTrips(prevTrips, (t) => t.vendor).map((g) => [g.key, g])) : null;
    return groupTrips(trips, (t) => t.vendor)
        .map((g) => {
            const p = prev?.get(g.key);
            return { ...g, prevLatePct: p && p.judged >= 10 ? p.latePct : null };
        })
        .sort((a, b) => b.late - a.late || b.latePct - a.latePct);
}

/** Matrix vendor × column for a heatmap. Cells below minN are shown blank. */
export function heatmap(trips, colOf, { minN = 5, vendors = null } = {}) {
    const cols = [...new Set(trips.map(colOf).filter(Boolean))].sort();
    const rows = groupTrips(trips, (t) => t.vendor)
        .filter((g) => !vendors || vendors.includes(g.key))
        .sort((a, b) => b.n - a.n)
        .map((g) => {
            const cells = {};
            groupTrips(g.trips, colOf).forEach((c) => { cells[c.key] = c.judged >= minN ? c : { ...c, sparse: true }; });
            return { vendor: g.key, latePct: g.latePct, judged: g.judged, cells };
        });
    return { cols, rows };
}

/** Weekly late % (by sent-out week, Monday start). */
export function weeklyTrend(trips) {
    const weekOf = (ms) => {
        const d = new Date(ms + 5.5 * 3600000); // IST calendar
        const day = (d.getUTCDay() + 6) % 7;
        d.setUTCDate(d.getUTCDate() - day);
        return d.toISOString().slice(0, 10);
    };
    return groupTrips(trips, (t) => weekOf(t.sentAt))
        .filter((g) => g.judged > 0)
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((g) => ({ week: g.key, latePct: g.latePct, late: g.late, judged: g.judged, trips: g.trips }));
}

export const LATENESS_BUCKETS = [
    { key: "1 day", test: (d) => d === 1 },
    { key: "2–3 days", test: (d) => d >= 2 && d <= 3 },
    { key: "4–7 days", test: (d) => d >= 4 && d <= 7 },
    { key: "8+ days", test: (d) => d >= 8 },
];
export const OVERDUE_BUCKETS = [
    { key: "1–2 days", test: (d) => d >= 1 && d <= 2 },
    { key: "3–5 days", test: (d) => d >= 3 && d <= 5 },
    { key: "6–10 days", test: (d) => d >= 6 && d <= 10 },
    { key: "10+ days", test: (d) => d > 10 },
];

/** How late returned trips were. */
export function latenessBuckets(trips) {
    const late = trips.filter((t) => t.isLate && !t.isOut);
    return LATENESS_BUCKETS.map((b) => {
        const list = late.filter((t) => b.test(t.daysLate));
        return { bucket: b.key, count: list.length, trips: list };
    });
}

/** Pieces overdue right now, by vendor and age. */
export function overdueAging(trips) {
    const over = trips.filter((t) => t.isOut && t.isLate);
    return groupTrips(over, (t) => t.vendor)
        .sort((a, b) => b.n - a.n)
        .map((g) => {
            const row = { vendor: g.key, total: g.n, trips: g.trips };
            OVERDUE_BUCKETS.forEach((b) => { row[b.key] = g.trips.filter((t) => b.test(t.daysLate)); });
            return row;
        });
}

/** Products most delayed at vendors (product × vendor, ≥ minN trips). */
export function productDelays(trips, { minN = 5, limit = 15 } = {}) {
    return groupTrips(trips.filter((t) => t.product), (t) => `${t.product}|||${t.vendor}`)
        .filter((g) => g.judged >= minN && g.late > 0)
        .map((g) => {
            const [product, vendor] = g.key.split("|||");
            return { ...g, product, vendor };
        })
        .sort((a, b) => b.latePct - a.latePct || b.late - a.late)
        .slice(0, limit);
}

/** Late returns that pushed orders past their production deadline, by channel. */
export function deadlineImpact(trips) {
    return groupTrips(trips.filter((t) => t.missedDeadline), (t) => t.channel)
        .map((g) => ({ channel: g.key, trips: g.trips, count: g.n, orders: new Set(g.trips.map((t) => t.orderId)).size }))
        .sort((a, b) => b.count - a.count);
}

/**
 * Plain-language insights, each with the trips it is about (clickable).
 * Only from samples big enough to mean something (minN judged trips).
 */
export function buildInsights(trips, prevTrips = null, { minN = 20, overdueNow = null } = {}) {
    const out = [];
    const all = delaySummary(trips);
    const judgedAll = trips.filter((t) => !t.isOut || t.isLate);
    const shopPct = pct(trips.filter((t) => t.isLate).length, judgedAll.length);
    const vendors = groupTrips(trips, (t) => t.vendor).filter((g) => g.judged >= minN);

    // 1. Worst vendors vs the shop average.
    vendors
        .filter((g) => g.latePct >= shopPct + 15)
        .sort((a, b) => b.latePct - a.latePct)
        .slice(0, 3)
        .forEach((g) => out.push({
            tone: "bad",
            text: `${g.key} returns late on ${g.latePct}% of trips (average ${shopPct}%), ${g.avgDaysLate} days late on average.`,
            trips: g.trips.filter((t) => t.isLate),
        }));

    // 2. Most reliable vendors.
    const best = vendors.filter((g) => g.latePct <= Math.max(5, shopPct - 15)).sort((a, b) => a.latePct - b.latePct).slice(0, 2);
    if (best.length) out.push({
        tone: "good",
        text: `Most reliable: ${best.map((g) => `${g.key} (${g.latePct}% late)`).join(", ")}.`,
        trips: best.flatMap((g) => g.trips),
    });

    // 3. A vendor much worse on one piece type than on their own average.
    for (const v of vendors) {
        groupTrips(v.trips, (t) => t.pieceLabel)
            .filter((c) => c.judged >= minN && c.latePct >= v.latePct + 15)
            .forEach((c) => out.push({
                tone: "bad",
                text: `${v.key} is late on ${c.latePct}% of ${c.key.toLowerCase()}s vs ${v.latePct}% on their other work.`,
                trips: c.trips.filter((t) => t.isLate),
            }));
    }

    // 4. Work type: best vs worst.
    const works = groupTrips(trips, (t) => t.work).filter((g) => g.judged >= minN).sort((a, b) => b.latePct - a.latePct);
    if (works.length >= 2 && works[0].latePct - works[works.length - 1].latePct >= 15) {
        const w = works[0], b = works[works.length - 1];
        out.push({
            tone: "bad",
            text: `${w.key} trips are late ${w.latePct}% of the time vs ${b.latePct}% for ${b.key}.`,
            trips: w.trips.filter((t) => t.isLate),
        });
    }

    // 5. Promised dates too short for a vendor (slow on average, not occasionally).
    vendors
        .filter((g) => g.avgActual - g.avgPromised >= 1)
        .sort((a, b) => (b.avgActual - b.avgPromised) - (a.avgActual - a.avgPromised))
        .slice(0, 2)
        .forEach((g) => out.push({
            tone: "warn",
            text: `${g.key} is promised ${g.avgPromised} days but takes ${g.avgActual} on average — the return dates set for them are too short, or they are consistently slow.`,
            trips: g.trips.filter((t) => !t.isOut),
        }));

    // 6. Customer impact.
    if (all.missedDeadline > 0) {
        const worst = groupTrips(trips.filter((t) => t.missedDeadline), (t) => t.vendor).sort((a, b) => b.n - a.n)[0];
        out.push({
            tone: "bad",
            text: `${all.missedDeadline} late returns came back after the order's production deadline${worst ? ` — most from ${worst.key} (${worst.n})` : ""}.`,
            trips: trips.filter((t) => t.missedDeadline),
        });
    }

    // 7. Trend vs the previous period.
    if (prevTrips && prevTrips.length) {
        const prevJudged = prevTrips.filter((t) => !t.isOut || t.isLate);
        const prevPct = pct(prevTrips.filter((t) => t.isLate).length, prevJudged.length);
        if (prevJudged.length >= minN && Math.abs(shopPct - prevPct) >= 5) {
            out.push({
                tone: shopPct > prevPct ? "bad" : "good",
                text: `Late returns ${shopPct > prevPct ? "rose" : "fell"} from ${prevPct}% to ${shopPct}% compared with the previous period.`,
                trips: trips.filter((t) => t.isLate),
            });
        }
    }

    // 8. Overdue right now — today's state, so the caller may pass every
    // overdue trip (not only those sent out in the period).
    const over = overdueNow || trips.filter((t) => t.isOut && t.isLate);
    if (over.length > 0) {
        const oldest = over.reduce((m, t) => Math.max(m, t.daysLate), 0);
        out.push({
            tone: "warn",
            text: `${over.length} piece${over.length === 1 ? " is" : "s are"} overdue at vendors right now; the oldest is ${oldest} days late.`,
            trips: over,
        });
    }
    return out;
}

/** Suggested penalty: per-day rate × total days late of the selected trips. */
export function suggestedPenalty(selected = [], ratePerDay) {
    const days = selected.reduce((s, t) => s + (t.daysLate || 0), 0);
    const rate = Number(ratePerDay);
    return { days, amount: Number.isFinite(rate) && rate > 0 ? Math.round(rate * days) : null };
}

/** Which selected trips can be penalised together, and why not. */
export function penaltyEligibility(selected = []) {
    if (selected.length === 0) return { ok: false, reason: "Select late trips first." };
    const vendors = new Set(selected.map((t) => t.vendor));
    if (vendors.size > 1) return { ok: false, reason: "Select trips of one vendor at a time." };
    if (selected.some((t) => !t.isLate)) return { ok: false, reason: "Only late trips can carry a penalty." };
    if (selected.some((t) => t.penaltyId)) return { ok: false, reason: "Some selected trips already have a penalty." };
    return { ok: true, vendor: selected[0].vendor, vendorId: selected[0].vendorId };
}
