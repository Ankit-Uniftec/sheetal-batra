// ============================================================
// The house adult size chart — single source of truth for the
// default size→measurement chart and the B2B size list.
//
// Named for B2B because that is where it started, but it is no
// longer B2B-only: the B2B order form (auto-fill on size pick),
// the vendor admin form (custom-chart grid) and the WAREHOUSE PDF
// (standard measurements for Shopify orders) all import from here,
// so the grid, the order form and the work order can never drift.
//
// A vendor may override this with their own chart stored in
// vendors.size_chart (same shape). NULL / invalid → this default.
//
// NOTE: src/screens/ProductForm.js still keeps a private, byte-
// identical copy of SIZE_CHART_US. Verified identical at the time
// the PDF was wired up here; folding it in is a separate change.
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

// ── Standard-size lookup (used by the warehouse PDF) ──────────
//
// Shopify sells STANDARD SIZES, not made-to-measure: a web order carries a
// size ("L") and no measurements at all. The warehouse still needs numbers to
// cut to, so the work order prints the house chart's row for that size.
//
// Alias map, not a normaliser. The catalogue uses "2XL" but live Shopify
// variants also carry "XXL" (confirmed in both the product export and the
// order data), and "XXL" is NOT a key in SIZE_CHART_US. Left unmapped it
// would resolve to nothing and the PDF would silently print no measurements
// for a real, orderable size — the exact silent-failure mode we avoid. Any
// size NOT listed here must match a chart key exactly.
const SIZE_ALIASES = {
    XXL: "2XL",
    XXXL: "3XL",
};

// Sizes that are a deliberate "no standard measurements" choice rather than a
// missing value. "Custom" is a real, selectable Shopify option (and matches
// CUSTOM_SIZE in ProductForm). "Free Size" carries no measurements by
// definition. Both must yield NO chart row so the PDF prints nothing rather
// than inventing numbers the garment was never cut to.
const NON_STANDARD_SIZES = new Set(["custom", "free size", "freesize", "one size"]);

/**
 * The house chart row for a standard size, or null.
 *
 * Returns null — never a default row — when the size is blank, non-standard
 * ("Custom"), or simply unknown. A wrong measurement on a work order is worse
 * than no measurement: the floor would cut to it. Callers must render nothing
 * when this is null.
 *
 * Adult chart only. Kids sizes ("5-6 yrs") live in a separate chart and
 * deliberately do not resolve here.
 *
 * Returns a COPY: SIZE_CHART_US is a shared module-level constant, so handing
 * out the live row would let one caller's edit silently rewrite the house
 * chart for every screen in the session.
 */
export function standardSizeMeasurements(size) {
    const raw = String(size ?? "").trim();
    if (!raw) return null;
    if (NON_STANDARD_SIZES.has(raw.toLowerCase())) return null;

    const key = raw.toUpperCase();
    const resolved = SIZE_ALIASES[key] || key;
    const row = SIZE_CHART_US[resolved];
    return row ? { ...row } : null;
}

// ── Garment name → measurement category ───────────────────────
//
// Mirrors CATEGORY_KEY_MAP in ProductForm.js for the garment names that
// actually reach us from Shopify's topStyle / bottomStyle metafields. Those
// are STRUCTURED product fields, not parsed from the product title.
//
// Observed live vocabulary (whole catalogue):
//   topStyle    Kurta · Long Kurta · Short Kurta · Choga · Long Choga · Kaftan
//   bottomStyle Salwar · Dhoti · Palazzo · Sharara
//
// Keys are lower-cased and trimmed on lookup: the catalogue contains
// "Long Kurta " with a trailing space, which would otherwise miss.
const GARMENT_CATEGORY = {
    // Tops
    "kurta": "KurtaChogaKaftan",
    "long kurta": "KurtaChogaKaftan",
    "short kurta": "KurtaChogaKaftan",
    "short a-line kurta": "KurtaChogaKaftan",
    "choga": "KurtaChogaKaftan",
    "long choga": "KurtaChogaKaftan",
    "short choga": "KurtaChogaKaftan",
    "chauga": "KurtaChogaKaftan",
    "kaftan": "KurtaChogaKaftan",
    "blouse": "Blouse",
    "anarkali": "Anarkali",
    // Bottoms
    "salwar": "SalwarDhoti",
    "dhoti": "SalwarDhoti",
    "churidaar": "ChuridaarTrouserPantsPlazo",
    "churidar": "ChuridaarTrouserPantsPlazo",
    "trouser": "ChuridaarTrouserPantsPlazo",
    "trousers": "ChuridaarTrouserPantsPlazo",
    "pants": "ChuridaarTrouserPantsPlazo",
    "palazzo": "ChuridaarTrouserPantsPlazo",
    "plazo": "ChuridaarTrouserPantsPlazo",
    "sharara": "ShararaGharara",
    "gharara": "ShararaGharara",
    "lehenga": "Lehenga",
};

// Which chart measurements each category actually takes — mirrors
// measurementFields in ProductForm.js, restricted to the four the size chart
// can fill. This is why a retail work order shows Bust/Waist/Hip on the Top box
// but only Waist/Hip on the Bottom: a bottom garment has no bust.
//
// The adult chart carries no Length, so Length simply never fills from it.
const CATEGORY_CHART_FIELDS = {
    KurtaChogaKaftan: ["Bust", "Waist", "Hip", "Length"],
    Blouse: ["Bust", "Waist", "Length"],
    Anarkali: ["Bust", "Length"],
    SalwarDhoti: ["Waist", "Hip", "Length"],
    ChuridaarTrouserPantsPlazo: ["Waist", "Hip", "Length"],
    ShararaGharara: ["Waist", "Hip", "Length"],
    Lehenga: ["Waist", "Hip", "Length"],
};

/**
 * Build the standard-size measurements for an item, in the SAME shape a retail
 * order stores them: { [categoryKey]: { Bust, Waist, ... } }.
 *
 * This is what lets a Shopify work order render through the ordinary
 * "Body Measurements" section with its Top / Bottom boxes, instead of needing
 * a parallel display of its own. A web "L" and a store "L" then print
 * identically, because both are the same chart resolved the same way.
 *
 * Takes the garment names from the item's STRUCTURED `top` / `bottom` fields
 * (Shopify's topStyle / bottomStyle metafields) — never parsed from the
 * product name.
 *
 * Returns {} when the size has no chart row (Custom / Free Size / kids /
 * unknown) or when neither garment maps to a category, so callers can treat an
 * empty object as "nothing to show" exactly as they do for a retail order with
 * no measurements.
 */
export function standardSizeMeasurementsByCategory(item) {
    const chartRow = standardSizeMeasurements(item?.size);
    if (!chartRow) return {};

    const categoryFor = (name) =>
        GARMENT_CATEGORY[String(name ?? "").trim().toLowerCase()] || null;

    const out = {};
    [item?.top, item?.bottom].forEach((garment) => {
        const category = categoryFor(garment);
        if (!category || out[category]) return;

        const fields = CATEGORY_CHART_FIELDS[category] || [];
        const values = {};
        fields.forEach((field) => {
            if (chartRow[field] != null) values[field] = chartRow[field];
        });
        if (Object.keys(values).length > 0) out[category] = values;
    });

    return out;
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
