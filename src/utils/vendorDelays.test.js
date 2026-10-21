import {
    buildDelayTrips, delaySummary, vendorScorecard, heatmap, latenessBuckets, overdueAging,
    deadlineImpact, buildInsights, suggestedPenalty, penaltyEligibility, productionDeadline,
    attachPenalties, endOfDayIst,
} from "./vendorDelays";

const NOW = Date.parse("2026-10-21T06:30:00Z"); // 21 Oct 12:00 IST
const mv = (o) => ({
    id: o.id, vendor_name: o.vendor || "Vendor A", vendor_id: "v-" + (o.vendor || "A"),
    status: o.status || "returned", return_date: o.due || "2026-10-10",
    exit_scan_at: o.out || "2026-10-05T05:00:00Z", entry_scan_at: o.back === undefined ? "2026-10-10T10:00:00Z" : o.back,
    stages_outside: o.stages || [4, 5], component_type: o.piece || "top", order_id: o.order || "o1",
    item_index: 0, barcode: "B-" + o.id, is_factory2: !!o.f2,
});
const orders = {
    o1: { id: "o1", order_no: "SB-DLC-1", delivery_date: "2026-10-12", delivery_name: "Asha", items: [{ product_name: "Mohsina" }] },
    o2: { id: "o2", order_no: "SB-SHOPIFY-2", delivery_date: "2026-11-30", delivery_name: "Bina", items: [{ product_name: "Aiza" }] },
};

test("on time when back by the end of the promised day (IST)", () => {
    // 10 Oct 23:00 IST = 10 Oct 17:30 UTC → still on time
    const [t] = buildDelayTrips([mv({ id: 1, back: "2026-10-10T17:30:00Z" })], orders, NOW);
    expect(t.isLate).toBe(false);
    expect(t.daysLate).toBe(0);
});

test("late: one minute past the promised day is 1 day late; 2 days later is 3", () => {
    const trips = buildDelayTrips([
        mv({ id: 1, back: "2026-10-10T18:31:00Z" }), // 11 Oct 00:01 IST
        mv({ id: 2, back: "2026-10-13T06:00:00Z" }), // 13 Oct 11:30 IST
    ], orders, NOW);
    expect(trips.map((t) => t.daysLate)).toEqual([1, 3]);
});

test("still out past the date counts as overdue now; own warehouse and F2 trips are left out", () => {
    const trips = buildDelayTrips([
        mv({ id: 1, status: "exited", back: null, due: "2026-10-15" }),
        mv({ id: 2, vendor: "SB WH Delhi (2)" }),
        mv({ id: 3, f2: true }),
        mv({ id: 4, status: "configured", back: null }),
    ], orders, NOW);
    expect(trips).toHaveLength(1);
    expect(trips[0].isOut && trips[0].isLate).toBe(true);
    expect(trips[0].daysLate).toBe(6);
});

test("deadline = delivery − 2 days; a late return after it is a missed deadline", () => {
    expect(productionDeadline("2026-10-12")).toBe(endOfDayIst("2026-10-10"));
    const trips = buildDelayTrips([
        mv({ id: 1, back: "2026-10-11T06:00:00Z", order: "o1" }), // after 10 Oct → missed
        mv({ id: 2, back: "2026-10-11T06:00:00Z", order: "o2" }), // deadline 28 Nov → fine
    ], orders, NOW);
    expect(trips.map((t) => t.missedDeadline)).toEqual([true, false]);
    expect(trips[0].product).toBe("Mohsina");
    expect(trips[0].channel).toBeTruthy();
});

test("summary and scorecard", () => {
    const trips = buildDelayTrips([
        mv({ id: 1 }), // on time
        mv({ id: 2, back: "2026-10-13T06:00:00Z" }), // 3 late
        mv({ id: 3, vendor: "B", back: "2026-10-11T06:00:00Z" }), // 1 late
        mv({ id: 4, vendor: "B", status: "exited", back: null, due: "2026-10-19" }), // 2 overdue
    ], orders, NOW);
    const s = delaySummary(trips);
    expect(s).toMatchObject({ returned: 3, lateReturned: 2, onTimePct: 33, overdueNow: 1, oldestOverdue: 2, avgDaysLate: 2 });
    const card = vendorScorecard(trips);
    expect(card.find((v) => v.key === "B")).toMatchObject({ n: 2, late: 2, latePct: 100, overdueNow: 1 });
    expect(card.find((v) => v.key === "Vendor A")).toMatchObject({ n: 2, late: 1, latePct: 50 });
});

test("heatmap blanks sparse cells; buckets and aging", () => {
    const trips = buildDelayTrips([
        mv({ id: 1, piece: "dupatta", back: "2026-10-12T06:00:00Z" }),
        mv({ id: 2, piece: "top" }),
        mv({ id: 3, status: "exited", back: null, due: "2026-10-08" }),
    ], orders, NOW);
    const h = heatmap(trips, (t) => t.pieceLabel, { minN: 2 });
    expect(h.cols).toEqual(["Dupatta", "Top"]);
    expect(h.rows[0].cells.Dupatta.sparse).toBe(true);
    expect(latenessBuckets(trips).find((b) => b.bucket === "2–3 days").count).toBe(1);
    expect(overdueAging(trips)[0]["10+ days"]).toHaveLength(1);
    expect(deadlineImpact(trips).reduce((s, c) => s + c.count, 0)).toBe(2);
});

test("insights mention the clearly worse vendor and carry their trips", () => {
    const rows = [];
    for (let i = 0; i < 25; i++) rows.push(mv({ id: "a" + i, vendor: "Slow", back: "2026-10-13T06:00:00Z" }));
    for (let i = 0; i < 25; i++) rows.push(mv({ id: "b" + i, vendor: "Fast" }));
    for (let i = 0; i < 25; i++) rows.push(mv({ id: "c" + i, vendor: "Mid", back: i < 5 ? "2026-10-11T06:00:00Z" : undefined }));
    const ins = buildInsights(buildDelayTrips(rows, orders, NOW));
    const slow = ins.find((x) => x.text.startsWith("Slow returns late"));
    expect(slow).toBeTruthy();
    expect(slow.trips.every((t) => t.vendor === "Slow" && t.isLate)).toBe(true);
    expect(ins.some((x) => x.tone === "good" && x.text.includes("Fast"))).toBe(true);
});

test("penalty eligibility and suggestion", () => {
    const trips = attachPenalties(buildDelayTrips([
        mv({ id: 1, back: "2026-10-13T06:00:00Z" }),
        mv({ id: 2, back: "2026-10-12T06:00:00Z" }),
        mv({ id: 3 }),
        mv({ id: 4, vendor: "B", back: "2026-10-12T06:00:00Z" }),
    ], orders, NOW), [{ movement_id: 2, penalty_id: "p1" }]);
    const [t1, t2, t3, t4] = trips;
    expect(penaltyEligibility([t1]).ok).toBe(true);
    expect(penaltyEligibility([t1, t4]).reason).toMatch(/one vendor/);
    expect(penaltyEligibility([t3]).reason).toMatch(/late/);
    expect(penaltyEligibility([t2]).reason).toMatch(/already/);
    expect(suggestedPenalty([t1], 200)).toEqual({ days: 3, amount: 600 });
    expect(suggestedPenalty([t1], null)).toEqual({ days: 3, amount: null });
});

test("sent out after the promised date: judged from the send date + planned turnaround", () => {
    // Set up 22 Sep, promised 24 Sep (2 days planned), sent 19 Oct, back 19 Oct → on time
    const [a] = buildDelayTrips([{ ...mv({ id: 1, due: "2026-09-24", out: "2026-10-19T05:00:00Z", back: "2026-10-19T10:00:00Z" }), created_at: "2026-09-22T05:00:00Z" }], orders, NOW);
    expect(a.dueAdjusted).toBe(true);
    expect(a.isLate).toBe(false);
    expect(a.due).toBe(endOfDayIst("2026-10-21"));
    // same trip back on 23 Oct 12:00 IST → 2 days late (due 21 Oct)
    const [b] = buildDelayTrips([{ ...mv({ id: 2, due: "2026-09-24", out: "2026-10-19T05:00:00Z", back: "2026-10-23T06:30:00Z" }), created_at: "2026-09-22T05:00:00Z" }], orders, NOW);
    expect(b.daysLate).toBe(2);
    // a normal trip is not adjusted
    const [c] = buildDelayTrips([mv({ id: 3 })], orders, NOW);
    expect(c.dueAdjusted).toBe(false);
});
