// ============================================================
// Stock Room — pure derivations over rows read from EXISTING tables.
//
// Nothing here reads or writes the database. Every function takes plain rows
// (products_live, product_variants, orders, warehouses, warehouse_stock) and
// returns plain values, so the rules can be unit-tested and the screens stay
// dumb. Keep it that way: a Supabase call in this file would make the rules
// untestable and would hide a read inside what looks like arithmetic.
//
// THE THREE PRODUCT TYPES, as the database spells them (AddProduct.jsx:611):
//   LXRTS         sync_enabled = true            stock per size in product_variants
//   Custom piece  is_custom_piece = true         ONE number in products.inventory
//   Made to order neither                        untracked — no inventory by definition
//
// Totals always come from those existing columns. The Stock Room never invents
// a total: location data (added in a later step) only says WHERE those units are.
// ============================================================

export const SIZE_ORDER = [
  "XXS", "XS", "S", "M", "L", "XL", "XXL",
  "2XL", "3XL", "XXXL", "4XL", "5XL", "6XL", "Custom", "7XL", "8XL",
];

// products.inventory = 9999 is the app's "unlimited" sentinel (AddProduct.jsx:622).
export const UNLIMITED_SENTINEL = 9999;

// Made to order counts at or above this are the sentinel worn down by sales
// (production: 9998 ×175, 9997 ×76, …), not stock someone entered.
export const MTO_DRIFT_FLOOR = 1000;

// Same threshold the current inventory dashboard uses (InventoryDashboard.jsx
// getInventoryClass), so both screens call the same products "low".
export const LOW_STOCK_BELOW = 5;

export const TYPE_LXRTS = "lxrts";
export const TYPE_CUSTOM = "custom";
export const TYPE_MTO = "mto";

export const TYPE_LABELS = {
  [TYPE_LXRTS]: "LXRTS",
  [TYPE_CUSTOM]: "Custom piece",
  [TYPE_MTO]: "Made to order",
};

// Stored shape verified in shopifyInventory.js normalizeShopifyId: full GID.
const SHOPIFY_PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;

export function productType(product) {
  if (!product) return TYPE_MTO;
  if (product.sync_enabled === true) return TYPE_LXRTS;
  if (product.is_custom_piece === true) return TYPE_CUSTOM;
  return TYPE_MTO;
}

export const isTrackedType = (type) => type === TYPE_LXRTS || type === TYPE_CUSTOM;

// The sizes on offer. The range stops at 6XL: anything larger is made as a
// Custom size, so 7XL / 8XL rows in the data read as "Custom" (the data is not
// changed). The data also spells some sizes two ways — XXL and 2XL, XXXL and
// 3XL, Custom and CUSTOM — so those fold together.
export const SIZE_SCALE = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"];
export const CUSTOM_SIZE = "Custom";
const SIZE_ALIASES = { XXL: "2XL", XXXL: "3XL" };

/** Comparison key: uppercase, aliases folded, and every size above 6XL → "CUSTOM". */
export function canonicalSize(size) {
  const upper = String(size || "").trim().toUpperCase();
  const plusXl = upper.match(/^(\d+)XL$/);
  if (plusXl && Number(plusXl[1]) > 6) return CUSTOM_SIZE.toUpperCase();
  return SIZE_ALIASES[upper] || upper;
}

/** How a size is shown: the scale name, "Custom", or the value as stored. */
export function sizeLabel(size) {
  const c = canonicalSize(size);
  if (SIZE_SCALE.includes(c)) return c;
  if (c === CUSTOM_SIZE.toUpperCase()) return CUSTOM_SIZE;
  return String(size || "").trim();
}

/**
 * A readable summary of a size list: which scale slots it covers, anything
 * off the scale ("Custom"), and short text — contiguous runs become ranges,
 * so XXS…8XL reads "XXS to 8XL" instead of thirteen comma-separated names.
 * `contiguous` is true when the sizes form one unbroken run with nothing off the scale.
 */
export function describeSizes(sizes) {
  const slots = new Set();
  const extras = [];
  (sizes || []).forEach((s) => {
    const c = canonicalSize(s);
    const i = SIZE_SCALE.indexOf(c);
    if (i >= 0) slots.add(i);
    else if (c && !extras.some((e) => canonicalSize(e) === c)) extras.push(sizeLabel(s));
  });
  const indices = [...slots].sort((a, b) => a - b);
  const runs = [];
  indices.forEach((i) => {
    const last = runs[runs.length - 1];
    if (last && i === last[1] + 1) last[1] = i;
    else runs.push([i, i]);
  });
  const text = runs
    .map(([a, b]) => (a === b ? SIZE_SCALE[a] : b === a + 1 ? `${SIZE_SCALE[a]}, ${SIZE_SCALE[b]}` : `${SIZE_SCALE[a]} to ${SIZE_SCALE[b]}`))
    .concat(extras)
    .join(", ");
  return {
    indices, extras, text,
    count: indices.length + extras.length,
    contiguous: runs.length === 1 && extras.length === 0,
    labels: indices.map((i) => SIZE_SCALE[i]).concat(extras),
  };
}

/** Known sizes in garment order, then anything unrecognised alphabetically. */
export function sortSizes(sizes) {
  const unique = Array.from(new Set((sizes || []).filter(Boolean).map(String)));
  return unique.sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a);
    const ib = SIZE_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}

/**
 * A size count that cannot be real stock: negative, or at/above the unlimited
 * sentinel. Production holds rows at 1,073,741,824 / 1,610,612,736 /
 * 2,130,706,432 — corrupted values, not counts — and a single one of them
 * turns every total into billions. They are excluded from every total and
 * reported under Integrity instead.
 */
export const isInvalidCount = (n) => !Number.isFinite(n) || n < 0 || n >= UNLIMITED_SENTINEL;

/**
 * product_variants rows → { [product_id]: { [size]: qty } }.
 *
 * DUPLICATE ROWS: production has hundreds of (product, size) pairs stored 2–3
 * times, usually as identical copies. Summing them doubles the stock, so the
 * LARGEST row wins — the same row order placement decrements
 * (ReviewDetail.js picks the fullest variant). Invalid counts only win when
 * the size has nothing else, so one corrupted copy cannot hide a real count.
 * Duplicates are listed by variantDuplicates() for Integrity.
 */
export function buildVariantIndex(variants) {
  const index = {};
  (variants || []).forEach((v) => {
    if (!v || !v.product_id || !v.size) return;
    const qty = Number(v.inventory);
    const sizes = index[v.product_id] || (index[v.product_id] = {});
    if (!(v.size in sizes)) { sizes[v.size] = qty; return; }
    const prev = sizes[v.size];
    if (isInvalidCount(prev) && !isInvalidCount(qty)) sizes[v.size] = qty;
    else if (!isInvalidCount(prev) && !isInvalidCount(qty) && qty > prev) sizes[v.size] = qty;
  });
  return index;
}

/** (product, size) pairs stored in more than one product_variants row. */
export function variantDuplicates(variants) {
  const groups = {};
  (variants || []).forEach((v) => {
    if (!v || !v.product_id || !v.size) return;
    (groups[`${v.product_id}|${v.size}`] || (groups[`${v.product_id}|${v.size}`] = [])).push(Number(v.inventory));
  });
  const byProduct = {};
  Object.entries(groups).forEach(([key, counts]) => {
    if (counts.length < 2) return;
    const [productId, size] = key.split("|");
    (byProduct[productId] || (byProduct[productId] = [])).push({ size, counts });
  });
  return byProduct;
}

/**
 * The stock position of one product, from existing columns only.
 *
 * @returns {{
 *   type: string, tracked: boolean, unlimited: boolean,
 *   total: number,               // units on hand; 0 for untracked/unlimited
 *   bySize: Object|null,         // LXRTS only — Custom pieces have no per-size count
 *   sizes: string[],             // sizes the product is made in
 * }}
 */
export function stockFor(product, variantIndex) {
  const type = productType(product);

  if (type === TYPE_LXRTS) {
    const raw = (variantIndex && variantIndex[product.id]) || {};
    const bySize = {};
    const invalidSizes = [];
    let total = 0;
    Object.keys(raw).forEach((size) => {
      // A negative or impossible count is a data fault, not stock: it counts
      // as nothing here and is listed under Integrity.
      if (isInvalidCount(raw[size])) {
        invalidSizes.push(size);
        bySize[size] = 0;
        return;
      }
      bySize[size] = raw[size];
      total += raw[size];
    });
    return {
      type, tracked: true, unlimited: false, total, bySize,
      sizes: sortSizes(Object.keys(raw)), invalidSizes: sortSizes(invalidSizes),
    };
  }

  const sizes = sortSizes(Array.isArray(product.available_size) ? product.available_size : []);

  if (type === TYPE_CUSTOM) {
    const inv = Number(product.inventory) || 0;
    if (inv >= UNLIMITED_SENTINEL) {
      return { type, tracked: true, unlimited: true, total: 0, bySize: null, sizes, invalidSizes: [] };
    }
    return { type, tracked: true, unlimited: false, total: Math.max(0, inv), bySize: null, sizes, invalidSizes: [] };
  }

  return { type, tracked: false, unlimited: true, total: 0, bySize: null, sizes, invalidSizes: [] };
}

/** "out" | "low" | "ok" | "unlimited" | "untracked". */
export function stockStatus(stock) {
  if (!stock.tracked) return "untracked";
  if (stock.unlimited) return "unlimited";
  if (stock.total <= 0) return "out";
  if (stock.total < LOW_STOCK_BELOW) return "low";
  return "ok";
}

/** Sizes of an LXRTS product that hold nothing (a size with an invalid count is unknown, not out). */
export function sizesOut(stock) {
  if (!stock.bySize) return [];
  return stock.sizes.filter((s) => (stock.bySize[s] || 0) <= 0 && !stock.invalidSizes.includes(s));
}

// ---------------- sales, from existing orders ----------------

const isCancelled = (order) => String(order?.status || "").toLowerCase() === "cancelled";

/**
 * Units sold per product and size within a window, from orders.items.
 * Stock orders are procurement, not sales, and cancelled orders gave their
 * stock back (restoreOrderInventory.js), so both are excluded.
 *
 * @returns {{ byProduct: Object, bySize: Object, byDay: Object, units: number }}
 */
export function salesSummary(orders, { days, now = Date.now() } = {}) {
  const since = days ? now - days * 86400000 : -Infinity;
  const byProduct = {};
  const bySize = {};
  const byDay = {};
  let units = 0;

  (orders || []).forEach((order) => {
    if (!order || order.is_stock_order === true || isCancelled(order)) return;
    const ts = new Date(order.created_at).getTime();
    if (!(ts >= since) || ts > now) return;
    const day = new Date(ts).toISOString().slice(0, 10);

    (Array.isArray(order.items) ? order.items : []).forEach((item) => {
      if (!item || !item.product_id) return;
      const qty = Number(item.quantity) || 1;
      units += qty;
      const p = byProduct[item.product_id] || (byProduct[item.product_id] = { units: 0, bySize: {} });
      p.units += qty;
      if (item.size) {
        p.bySize[item.size] = (p.bySize[item.size] || 0) + qty;
        bySize[item.size] = (bySize[item.size] || 0) + qty;
      }
      byDay[day] = (byDay[day] || 0) + qty;
    });
  });

  return { byProduct, bySize, byDay, units };
}

// ---------------- data integrity ----------------

/**
 * Problems visible in the existing data. Read-only: each finding names the
 * rows so a person can fix them in the product form — nothing is corrected here.
 */
export function integrityFindings(products, variantIndex, variants = []) {
  const byShopifyId = {};
  const malformedShopifyIds = [];
  const lxrtsWithoutVariants = [];
  const invalidVariants = [];
  const duplicateSizes = [];
  const mtoWithStock = [];
  const customUnlimited = [];
  const productsById = {};
  (products || []).forEach((p) => { productsById[p.id] = p; });

  // From the raw rows, not the index: the index keeps one value per size, so a
  // corrupted copy sitting next to a good one would otherwise go unreported.
  (variants || []).forEach((v) => {
    const product = productsById[v?.product_id];
    if (!product || productType(product) !== TYPE_LXRTS) return;
    if (isInvalidCount(Number(v.inventory))) invalidVariants.push({ product, size: v.size, qty: Number(v.inventory) });
  });
  Object.entries(variantDuplicates(variants)).forEach(([pid, sizes]) => {
    const product = productsById[pid];
    if (product && productType(product) === TYPE_LXRTS) duplicateSizes.push({ product, sizes });
  });

  (products || []).forEach((p) => {
    const type = productType(p);
    const sid = String(p.shopify_product_id || "").trim();

    if (type === TYPE_LXRTS) {
      if (sid) {
        (byShopifyId[sid] || (byShopifyId[sid] = [])).push(p);
        if (!SHOPIFY_PRODUCT_GID.test(sid)) malformedShopifyIds.push(p);
      } else {
        malformedShopifyIds.push(p);
      }
      const sizes = (variantIndex && variantIndex[p.id]) || {};
      if (Object.keys(sizes).length === 0) lxrtsWithoutVariants.push(p);
    }

    const inv = Number(p.inventory) || 0;
    // Made to order carries no inventory by definition. Order placement still
    // subtracts from products.inventory (ReviewDetail.js), so the 9999 sentinel
    // drifts down — 9998, 9997… — on every sale. Those are not counts. Only a
    // small number (below MTO_DRIFT_FLOOR) looks like real stock entered on a
    // design that was probably meant to be a Custom piece: surfaced, never converted.
    if (type === TYPE_MTO && inv > 0 && inv < MTO_DRIFT_FLOOR) mtoWithStock.push(p);
    if (type === TYPE_CUSTOM && inv >= UNLIMITED_SENTINEL) customUnlimited.push(p);
  });

  const duplicateShopifyIds = Object.keys(byShopifyId)
    .filter((sid) => byShopifyId[sid].length > 1)
    .map((sid) => ({ shopifyId: sid, products: byShopifyId[sid] }));

  return {
    duplicateShopifyIds,
    malformedShopifyIds,
    invalidVariants,
    duplicateSizes,
    lxrtsWithoutVariants,
    customUnlimited,
    mtoWithStock,
  };
}

/**
 * Findings that make a stock number wrong or a sync fail. Made to order rows
 * holding a count are informational — they change no total — so they are left
 * out, and the red Integrity badge only counts what needs fixing.
 */
export function integrityCount(findings) {
  return (
    findings.duplicateShopifyIds.length +
    findings.malformedShopifyIds.length +
    findings.invalidVariants.length +
    findings.duplicateSizes.length +
    findings.lxrtsWithoutVariants.length +
    findings.customUnlimited.length
  );
}

// ---------------- stock orders ----------------

export const STOCK_WINDOW_HOURS = 36; // same window as StockOrdersTab.jsx

export function stockOrderStatusKey(status) {
  const s = String(status || "").toLowerCase();
  return !s || s === "pending" ? "order_received" : s;
}

// Labels mirror StockOrdersTab.jsx statusLabel so both screens name a status the same way.
export function stockOrderStatusLabel(status) {
  const s = stockOrderStatusKey(status);
  if (s === "order_received") return "Order received";
  if (s === "completed") return "Completed & dispatched";
  if (s === "delivered") return "Delivered";
  if (s === "cancelled") return "Cancelled";
  if (s === "exchange_return") return "Exchange / return";
  if (s === "processing") return "Processing";
  if (s === "revoked") return "Revoked";
  return status;
}

export const isOpenStockOrder = (order) => stockOrderStatusKey(order?.status) === "order_received";

export function hoursSince(iso, now = Date.now()) {
  if (!iso) return Infinity;
  return (now - new Date(iso).getTime()) / 3600000;
}

// ---------------- formatting ----------------

export const formatUnits = (n) => Number(n || 0).toLocaleString("en-IN");

export const formatInr = (n) =>
  "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");

/** DD.MM.YYYY — the date format the stock order cards already use. */
export function formatDay(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, ".");
}

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return "—";
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 31) return `${days}d ago`;
  return formatDay(iso);
}

// ---------------- locations (Stock Room ledger) ----------------
//
// The ledger only says WHERE units are. Totals still come from the existing
// counts (stockFor), so:
//   placed      units recorded at a location
//   unassigned  total - placed, per size for LXRTS, per design for a custom piece
//   toAssign    placed - total: a sale made elsewhere (order form, website)
//               lowered the total, and someone must say which location it left

export const REASON_LABELS = {
  placement: "Placed",
  transfer_out: "Transferred out",
  transfer_in: "Transferred in",
  sale: "Sold",
  sale_assignment: "Sale assigned",
  receipt: "Received",
  adjustment: "Recount",
};

/** stock_room_placed rows → lookups by product and by location. */
export function buildPlacementIndex(placedRows) {
  const byProduct = {};   // { product: { size: { location: qty } } }
  const byLocation = {};  // { location: { product: { size: qty } } }
  (placedRows || []).forEach((r) => {
    const qty = Number(r.qty) || 0;
    if (!qty || !r.product_id || !r.location_id) return;
    const size = r.size || "";
    const p = byProduct[r.product_id] || (byProduct[r.product_id] = {});
    const s = p[size] || (p[size] = {});
    s[r.location_id] = (s[r.location_id] || 0) + qty;
    const l = byLocation[r.location_id] || (byLocation[r.location_id] = {});
    const lp = l[r.product_id] || (l[r.product_id] = {});
    lp[size] = (lp[size] || 0) + qty;
  });
  return { byProduct, byLocation };
}

/**
 * Where one design's units are, against its existing total.
 * @param stock a stockFor() result
 */
export function placementFor(productId, stock, index) {
  const placed = (index && index.byProduct[productId]) || {};
  const byLocation = {};
  const placedBySize = {};
  let placedTotal = 0;
  Object.entries(placed).forEach(([size, locs]) => {
    Object.entries(locs).forEach(([loc, qty]) => {
      placedTotal += qty;
      placedBySize[size] = (placedBySize[size] || 0) + qty;
      (byLocation[loc] || (byLocation[loc] = {}))[size] = qty;
    });
  });

  const empty = { byLocation, placedBySize, placedTotal, unassigned: 0, unassignedBySize: {}, toAssign: 0, toAssignBySize: {} };
  if (!stock || !stock.tracked || stock.unlimited) return empty;

  if (stock.bySize) {
    const unassignedBySize = {};
    const toAssignBySize = {};
    let unassigned = 0;
    let toAssign = 0;
    sortSizes([...stock.sizes, ...Object.keys(placedBySize)]).forEach((size) => {
      // A size with an impossible count has no knowable free stock.
      if (stock.invalidSizes.includes(size)) return;
      const total = stock.bySize[size] || 0;
      const pl = placedBySize[size] || 0;
      if (total > pl) { unassignedBySize[size] = total - pl; unassigned += total - pl; }
      if (pl > total) { toAssignBySize[size] = pl - total; toAssign += pl - total; }
    });
    return { byLocation, placedBySize, placedTotal, unassigned, unassignedBySize, toAssign, toAssignBySize };
  }

  // Custom piece: one total for the design, placed size by size.
  return {
    ...empty,
    unassigned: Math.max(0, stock.total - placedTotal),
    toAssign: Math.max(0, placedTotal - stock.total),
  };
}

/** The order-number prefix: SB-DLC-0926-000001 → "DLC". */
export const orderPrefix = (orderNo) => String(orderNo || "").split("-")[1] || "";

/**
 * Recent customer orders that could explain a sale waiting for a location,
 * newest first, with the location their store prefix suggests. Lines already
 * assigned are left out.
 */
export function saleCandidates({ productId, size, isCustom }, orders, assignedKeys, locations) {
  const out = [];
  (orders || []).forEach((order) => {
    if (!order || order.is_stock_order === true) return;
    if (String(order.status || "").toLowerCase() === "cancelled") return;
    (Array.isArray(order.items) ? order.items : []).forEach((item, line) => {
      if (!item || item.product_id !== productId) return;
      if (!isCustom && (item.size || "") !== size) return;
      if (assignedKeys && assignedKeys.has(`${order.id}|${line}`)) return;
      const prefix = orderPrefix(order.order_no);
      const suggested = (locations || []).find((l) => l.is_active && (l.order_prefixes || []).includes(prefix));
      out.push({ order, line, qty: Number(item.quantity) || 1, size: item.size || "", suggestedLocationId: suggested ? suggested.id : null });
    });
  });
  return out.sort((a, b) => new Date(b.order.created_at) - new Date(a.order.created_at));
}

/** order_id|line keys for every order line already given a location. */
export function assignedOrderLines(movements) {
  const keys = new Set();
  (movements || []).forEach((m) => {
    if (m.reason === "sale_assignment" && m.order_id != null && m.order_line != null) keys.add(`${m.order_id}|${m.order_line}`);
  });
  return keys;
}

/** order_id → [{ line, location_id, qty, occurred_at }] for stock order receipts. */
export function receiptsByOrder(movements) {
  const map = {};
  (movements || []).forEach((m) => {
    if (m.reason !== "receipt" || !m.order_id) return;
    (map[m.order_id] || (map[m.order_id] = [])).push({ line: m.order_line, location_id: m.location_id, qty: m.delta, occurred_at: m.occurred_at });
  });
  return map;
}

/**
 * Movements grouped into transfers, newest first.
 * A transfer sent "in transit" has an outgoing leg at its origin, an incoming
 * leg at the transit location (carrying destination_id), and, once received,
 * a leg out of transit and one into the destination.
 */
export function groupTransfers(movements, transitId) {
  const groups = {};
  (movements || []).forEach((m) => {
    if (!m.transfer_id) return;
    const g = groups[m.transfer_id] || (groups[m.transfer_id] = {
      id: m.transfer_id, occurred_at: m.occurred_at, actor_email: m.actor_email, note: m.note,
      from: null, to: null, lines: [], units: 0, waiting: 0, receivedAt: null, viaTransit: false,
    });
    if (new Date(m.occurred_at) < new Date(g.occurred_at)) g.occurred_at = m.occurred_at;
    if (transitId && m.location_id === transitId) {
      g.viaTransit = true;
      g.waiting += m.delta;
      if (m.destination_id) g.to = m.destination_id;
      return;
    }
    if (m.reason === "transfer_out") {
      g.from = m.location_id;
      g.units += -m.delta;
      g.lines.push({ product_id: m.product_id, size: m.size, qty: -m.delta });
    }
    if (m.reason === "transfer_in") {
      g.to = m.location_id;
      if (!g.receivedAt || new Date(m.occurred_at) > new Date(g.receivedAt)) g.receivedAt = m.occurred_at;
    }
  });
  return Object.values(groups)
    .map((g) => ({ ...g, status: g.waiting > 0 ? "transit" : "received" }))
    .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
}

/**
 * Transfer suggestions: a store has none of a size that another location holds
 * at least two of. Sizes that sold most in the sales window come first.
 */
export function rebalanceSuggestions({ tracked, placementById, locations, salesByProduct, limit = 8 }) {
  const stores = (locations || []).filter((l) => l.kind === "store");
  const holders = (locations || []).filter((l) => l.kind !== "transit");
  const out = [];
  (tracked || []).forEach((row) => {
    const p = placementById && placementById[row.id];
    if (!p || !p.placedTotal) return;
    const sizes = new Set();
    Object.values(p.byLocation).forEach((bySize) => Object.keys(bySize).forEach((s) => sizes.add(s)));
    sizes.forEach((size) => {
      let donor = null;
      let have = 0;
      holders.forEach((l) => {
        const q = (p.byLocation[l.id] && p.byLocation[l.id][size]) || 0;
        if (q > have) { have = q; donor = l; }
      });
      if (!donor || have < 2) return;
      const needy = stores.find((l) => l.id !== donor.id && !((p.byLocation[l.id] && p.byLocation[l.id][size]) > 0));
      if (!needy) return;
      const sold = (salesByProduct && salesByProduct[row.id] && salesByProduct[row.id].bySize[size]) || 0;
      out.push({ row, size, from: donor, to: needy, have, sold });
    });
  });
  return out.sort((a, b) => b.sold - a.sold || b.have - a.have).slice(0, limit);
}

export const AGE_BUCKETS = [
  { key: "0-30", label: "0-30 days", max: 30, tone: "ok" },
  { key: "31-90", label: "31-90 days", max: 90, tone: "gold" },
  { key: "91-180", label: "91-180 days", max: 180, tone: "low" },
  { key: "180+", label: "Over 180 days", max: Infinity, tone: "crit" },
];

/**
 * Units in locations by how long since they last arrived there (placed,
 * received or transferred in). Units in transit are not counted.
 */
export function stockAgeing(movements, index, transitId, now = Date.now()) {
  const lastIn = {};
  (movements || []).forEach((m) => {
    if (!m.location_id || m.location_id === transitId || m.delta <= 0) return;
    const key = m.location_id + "|" + m.product_id + "|" + m.size;
    const t = new Date(m.occurred_at).getTime();
    if (!(lastIn[key] >= t)) lastIn[key] = t;
  });
  const buckets = AGE_BUCKETS.map((b) => ({ ...b, units: 0 }));
  Object.entries((index && index.byLocation) || {}).forEach(([loc, products]) => {
    if (loc === transitId) return;
    Object.entries(products).forEach(([pid, sizes]) => {
      Object.entries(sizes).forEach(([size, qty]) => {
        if (qty <= 0) return;
        const t = lastIn[loc + "|" + pid + "|" + size];
        if (!t) return;
        const days = (now - t) / 86400000;
        buckets.find((x) => days <= x.max).units += qty;
      });
    });
  });
  return buckets;
}

/**
 * Facts about one design for the product pivot, as { location, size, value } rows.
 *   onhand  units at each location, unassigned and in transit
 *   sold    units sold in the window: Stock Room sales at their location, order
 *           sales at the location they were assigned to, the rest "Not assigned"
 *   moves   number of recorded movements
 */
export function productFacts({ row, placement, locationsById, transitId, orderSalesBySize, movements, measure, days = 90, now = Date.now() }) {
  const out = [];
  const locName = (id) => (!id ? "Unassigned" : id === transitId ? "In transit" : (locationsById[id] && locationsById[id].name) || "Closed location");
  const sizeName = (s) => (s ? sizeLabel(s) : "One size");
  const mine = (movements || []).filter((m) => m.product_id === row.id);

  if (measure === "onhand") {
    if (!placement) return out;
    Object.entries(placement.byLocation).forEach(([loc, bySize]) => {
      Object.entries(bySize).forEach(([s, q]) => { if (q) out.push({ location: locName(loc), size: sizeName(s), value: q }); });
    });
    if (row.stock.bySize) {
      Object.entries(placement.unassignedBySize).forEach(([s, q]) => out.push({ location: "Unassigned", size: sizeName(s), value: q }));
    } else if (placement.unassigned) {
      out.push({ location: "Unassigned", size: "Any size", value: placement.unassigned });
    }
    return out;
  }

  const since = now - days * 86400000;
  if (measure === "sold") {
    const assignedBySize = {};
    mine.forEach((m) => {
      if (new Date(m.occurred_at).getTime() < since) return;
      if (m.reason === "sale") out.push({ location: locName(m.location_id), size: sizeName(m.size), value: -m.delta });
      if (m.reason === "sale_assignment") {
        out.push({ location: locName(m.location_id), size: sizeName(m.size), value: -m.delta });
        assignedBySize[m.size] = (assignedBySize[m.size] || 0) - m.delta;
      }
    });
    Object.entries(orderSalesBySize || {}).forEach(([s, q]) => {
      const rest = q - (assignedBySize[s] || 0);
      if (rest > 0) out.push({ location: "Not assigned", size: sizeName(s), value: rest });
    });
    return out;
  }

  mine.forEach((m) => out.push({ location: locName(m.location_id), size: sizeName(m.size), value: 1 }));
  return out;
}
