// ============================================================
// B2B size chart — the single source of truth for the default
// adult size→measurement chart and the B2B size list.
//
// Both the B2B order form (auto-fill on size pick) and the vendor
// admin form (custom-chart grid) import from here, so the grid's
// rows and the order form's lookup can never drift apart.
//
// A vendor may override this with their own chart stored in
// vendors.size_chart (same shape). NULL / invalid → this default.
// ============================================================

// The sizes a B2B order can be placed in — the grid rows and the
// order-form size buttons both derive from this exact list.
export const B2B_SIZE_OPTIONS = [
    "XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL", "8XL",
];

// The measurement columns a custom chart captures.
export const B2B_MEASUREMENT_KEYS = ["Bust", "Waist", "Hip"];

// House default adult size chart (inches). Keyed by the size names above.
export const SIZE_CHART_US = {
    XXS: { Bust: 30, Waist: 24, Hip: 34 },
    XS: { Bust: 32, Waist: 26, Hip: 36 },
    S: { Bust: 34, Waist: 28, Hip: 38 },
    M: { Bust: 36, Waist: 30, Hip: 40 },
    L: { Bust: 38, Waist: 32, Hip: 42 },
    XL: { Bust: 40, Waist: 34, Hip: 44 },
    "2XL": { Bust: 42, Waist: 36, Hip: 46 },
    "3XL": { Bust: 44, Waist: 38, Hip: 48 },
    "4XL": { Bust: 46, Waist: 40, Hip: 50 },
    "5XL": { Bust: 48, Waist: 42, Hip: 52 },
    "6XL": { Bust: 50, Waist: 44, Hip: 54 },
    "7XL": { Bust: 52, Waist: 46, Hip: 56 },
    "8XL": { Bust: 54, Waist: 48, Hip: 58 },
};

// Validate a vendor's saved size_chart. Returns the chart only if it
// has at least one size → { at least one numeric measurement } entry;
// otherwise null, so a blank/partial/toggled-off chart cleanly falls
// back to the default instead of silently auto-filling nothing.
export function normalizeSizeChart(chart) {
    if (!chart || typeof chart !== "object" || Array.isArray(chart)) return null;
    const hasUsableEntry = Object.values(chart).some(
        (row) =>
            row &&
            typeof row === "object" &&
            B2B_MEASUREMENT_KEYS.some((k) => row[k] != null && row[k] !== "" && !Number.isNaN(Number(row[k])))
    );
    return hasUsableEntry ? chart : null;
}

// The effective adult chart for a vendor: their custom chart layered OVER the
// house default, so any size (or single measurement) they left blank falls back
// to the standard number — never blank. E.g. a vendor who only filled XS–8XL
// still resolves XXS to the default XXS row. Returns SIZE_CHART_US untouched
// when the vendor has no usable custom chart.
export function resolveSizeChart(vendorChart) {
    const custom = normalizeSizeChart(vendorChart);
    if (!custom) return SIZE_CHART_US;
    const merged = {};
    B2B_SIZE_OPTIONS.forEach((size) => {
        const base = SIZE_CHART_US[size] || {};
        const over = custom[size] || {};
        const row = { ...base };
        B2B_MEASUREMENT_KEYS.forEach((k) => {
            if (over[k] != null && over[k] !== "" && !Number.isNaN(Number(over[k]))) {
                row[k] = Number(over[k]);
            }
        });
        merged[size] = row;
    });
    return merged;
}

// Every numeric value in a chart — used to recognise (and clear)
// chart-derived measurement values when a user switches to "Custom",
// while keeping values they typed themselves.
export function chartValueSet(chart) {
    const set = new Set();
    Object.values(chart || {}).forEach((row) =>
        Object.values(row || {}).forEach((v) => {
            if (v != null && v !== "") set.add(Number(v));
        })
    );
    return set;
}
