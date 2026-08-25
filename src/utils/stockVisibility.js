import { CHANNEL_KEY_LABELS, CHANNEL_SEGMENTS } from "./barcodeService";
import { normalizeStore } from "./storeCategory";

// ============================================================
// WHO SEES WHICH STOCK — the one role→pools map.
//
// Mirrors the CHANNELS_OWNED_BY_DESIGNATION pattern in barcodeService.js: one
// table here, consumed by <StockPanel>, instead of a hand-built stock section
// per dashboard drifting apart the moment one is edited.
//
// THREE BACKING STORES, DELIBERATELY NOT MERGED
// The app carries three parallel stock models that have never reconciled, and
// this file does not try to reconcile them either — it labels each at the point
// of display so a reader knows which number they are looking at:
//
//   kind: "channel"     → product_channel_stock. The live per-channel balance
//                         (db/…/v2/72), raised by completed stock orders and
//                         lowered by sales. MAY GO NEGATIVE, on purpose — a
//                         negative is a real discrepancy meant to be seen, so
//                         nothing here clamps it.
//   kind: "warehouse"   → warehouse_stock, the only per-LOCATION quantity table
//                         in the system. Matched to a physical place by
//                         warehouses.name. See the warning below.
//   kind: "consignment" → consignment_inventory, vendor-keyed units sent out on
//                         consignment (quantity_sent/sold/remaining/lost).
//
// WHY DELHI AND LUDHIANA ARE NOT CHANNEL POOLS
// There is no per-store stock balance and there never was. db/…/v2/72 says it
// outright — "A Delhi sale and a Ludhiana sale both draw the same retail pool"
// — and stock_pool_for_channel maps both 'delhi' and 'ludhiana' to
// 'retail_stock'. So a per-store number can only come from warehouse_stock,
// which is populated by hand through the Warehouses tab. Where no warehouse row
// matches, StockPanel says "not configured" rather than rendering 0: a zero
// would read as "we have none in Delhi", which is a different and wrong claim.
//
// "Factory" is the same story, more so — the only `factory` in the codebase is
// factory_pause, the SLA-freeze switch. It is a warehouse row or it is nothing.
// ============================================================

// Colors come from CHANNEL_SEGMENTS by label so a pool renders in the same
// color here as in every other channel breakdown in the app.
const colorFor = (label) =>
  CHANNEL_SEGMENTS.find((s) => s.label === label)?.color || "#888";

// The pools a dashboard can ask for. `match` is tested against warehouses.name.
export const POOL_DEFS = {
  // ── Live channel balances (product_channel_stock) ──
  retail_stock: {
    kind: "channel",
    channelKey: "retail_stock",
    label: CHANNEL_KEY_LABELS.retail_stock,
    color: colorFor(CHANNEL_KEY_LABELS.retail_stock),
  },
  b2b_stock: {
    kind: "channel",
    channelKey: "b2b_stock",
    label: CHANNEL_KEY_LABELS.b2b_stock,
    color: colorFor(CHANNEL_KEY_LABELS.b2b_stock),
  },
  shopify_stock: {
    kind: "channel",
    channelKey: "shopify_stock",
    label: CHANNEL_KEY_LABELS.shopify_stock,
    color: colorFor(CHANNEL_KEY_LABELS.shopify_stock),
  },

  // ── Physical locations (warehouse_stock, matched by warehouses.name) ──
  // The regexes are deliberately loose: these rows are typed by hand in the
  // Warehouses tab, so "Delhi Store", "Delhi Warehouse" and "delhi" must all
  // match. A warehouse matching no pool simply doesn't appear in this panel —
  // it is still visible on the Warehouses tab.
  delhi: {
    kind: "warehouse",
    match: /delhi/i,
    label: CHANNEL_KEY_LABELS.delhi,
    color: colorFor(CHANNEL_KEY_LABELS.delhi),
  },
  ludhiana: {
    kind: "warehouse",
    match: /ludhiana/i,
    label: CHANNEL_KEY_LABELS.ludhiana,
    color: colorFor(CHANNEL_KEY_LABELS.ludhiana),
  },
  factory: {
    kind: "warehouse",
    match: /factory/i,
    label: "Factory",
    color: "#6d4c41",
  },

  // ── Consignment (consignment_inventory) ──
  consignment: {
    kind: "consignment",
    label: "B2B Consignment",
    color: "#8d6e63",
  },
};

// Everything, in display order. Locations first (a physical place is the more
// concrete question), then the channel balances, then consignment.
const ALL_POOLS = [
  "delhi",
  "ludhiana",
  "factory",
  "retail_stock",
  "b2b_stock",
  "shopify_stock",
  "consignment",
];

// Role → the pools that role may see.
//
// Roles absent from this map see NO stock panel at all. That is the default and
// it is the safe one: adding a role here is a deliberate act, forgetting to add
// one shows nothing rather than showing everything.
export const POOLS_BY_ROLE = {
  // 1. Full visibility — leadership + the inventory desk.
  admin: ALL_POOLS,          // Jahnavi (role 'admin', designation 'CMO')
  assistant_cmo: ALL_POOLS,  // Bhawna
  gm: ALL_POOLS,             // Anushree
  coo: ALL_POOLS,            // Manish
  ceo: ALL_POOLS,            // Sheetal
  inventory: ALL_POOLS,      // the Inventory dashboard

  // 2. Store managers — both stores, the factory, and the retail pool they sell
  //    from. No B2B and no Shopify: neither is their business.
  store_manager: ["delhi", "ludhiana", "factory", "retail_stock"],

  // 3. Retail manager — the store manager's view plus the B2B side.
  retail_manager: [
    "delhi",
    "ludhiana",
    "factory",
    "retail_stock",
    "b2b_stock",
    "consignment",
  ],

  // 4. Production Manager — produces for every channel, so every stock pool,
  //    but has no reason to see the shop floors' own counts.
  production_manager: ["factory", "retail_stock", "b2b_stock", "shopify_stock"],

  // 5. B2B merchandiser (Prastuti) — B2B only.
  merchandiser: ["b2b_stock", "consignment"],

  // 6 & 7. Sales associates — their OWN store plus the retail pool they sell
  //    from, resolved at runtime by store_name. Listed here as [] so the role is
  //    known-and-handled rather than missing; poolsForUser fills it in.
  salesperson: [],
  sa_services: [],
};

// Roles whose stock view is derived from their own store rather than the map.
const STORE_SCOPED_ROLES = new Set(["salesperson", "sa_services"]);

// normalizeStore returns "Delhi" | "Ludhiana" | null — the app-wide normalizer,
// which already handles "DLC"/"LDHC"/"Delhi Store" and friends.
const POOL_BY_STORE = { Delhi: "delhi", Ludhiana: "ludhiana" };

/**
 * The stock pools a given user may see.
 *
 * @param {{ role?: string, store_name?: string }} user — as read by every
 *   dashboard's own mount guard, so no extra query is needed.
 * @returns {string[]} pool keys into POOL_DEFS, in display order. Empty means
 *   "show no stock panel".
 */
export function poolsForUser(user) {
  const role = (user?.role || "").trim().toLowerCase();
  if (!role) return [];

  if (STORE_SCOPED_ROLES.has(role)) {
    // An SA sees their own store's shelf plus the retail pool that supplies it.
    // An SA whose store_name doesn't resolve (Exhibition, Private, or simply
    // unset) gets the retail pool only — never another store's shelf.
    const store = POOL_BY_STORE[normalizeStore(user?.store_name)];
    return store ? [store, "retail_stock"] : ["retail_stock"];
  }

  return POOLS_BY_ROLE[role] || [];
}

/** Convenience: does this user get a stock panel at all? */
export const canSeeStock = (user) => poolsForUser(user).length > 0;
