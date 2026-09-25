import { supabase } from "../../lib/supabaseClient";
import { fetchAllRows } from "../../utils/fetchAllRows";
import { getOrderChannelKey } from "../../utils/barcodeService";
import { STOCK_HEAD_OPTIONS } from "../../utils/stockProductionHead";

// ============================================================
// Stock Room — data access.
//
// Totals are read from EXISTING tables the way the current inventory
// dashboard already reads them, so both screens see the same numbers:
//   products_live         InventoryDashboard.jsx fetchProducts
//   product_variants      InventoryDashboard.jsx fetchVariantInventory
//   orders (stock)        StockOrdersTab.jsx fetchStockOrders
//   warehouses            WarehouseTab.jsx
//   warehouse_stock       WarehouseTab.jsx
//
// There is deliberately no Shopify call here. The shopify-inventory edge
// function is connected to the LIVE store and its source is not in this repo,
// so the Stock Room reads product_variants — the table the "Sync LXRTS" button
// writes Shopify's numbers into — and never calls Shopify itself.
//
// Paged tables are ordered by a unique column: fetchAllRows pages with
// .range(), and an unordered range can skip or repeat rows between pages.
// ============================================================

// Roles allowed in, identical to INVENTORY_DASHBOARD_ROLES in
// InventoryDashboard.jsx — the Stock Room shows the same stock to the same people.
export const STOCK_ROOM_ROLES = ["inventory", "admin", "assistant_cmo", "gm", "coo", "ceo"];

// Explicit columns, not "*". Production is slow enough from a browser (a
// year of orders is ~10 pages, each 1–2s) that every column counts. All of
// these are confirmed present on both staging and production.
const PRODUCT_COLUMNS =
  "id, name, sku_id, image_url, base_price, store_category, sync_enabled, is_custom_piece, inventory, available_size, shopify_product_id, " +
  "top_options, bottom_options, default_top, default_bottom, default_color, has_dupatta, default_dupatta_color";
// Stock order cards need these (StockOrdersTab.jsx shows the same fields);
// order_no is enough for getOrderChannelKey on a stock order.
const STOCK_ORDER_COLUMNS =
  "id, order_no, is_stock_order, created_at, status, items, delivery_date, salesperson, mode_of_delivery, total_quantity, warehouse_urls";
// Sales only need what salesSummary and the notice board read.
const SALES_COLUMNS = "id, order_no, is_stock_order, created_at, status, items, salesperson, salesperson_store";

/**
 * The logged-in person's salesperson row, or null when there is no session or
 * the role may not open this screen. The caller signs out and redirects, the
 * same way InventoryDashboard.jsx does.
 */
export async function loadStockRoomUser() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { user: null, reason: "no-session" };

  const { data, error } = await supabase
    .from("salesperson")
    .select("role, saleperson, email, phone, designation, store_name, can_place_stock_orders")
    .eq("email", session.user.email?.toLowerCase())
    .single();

  if (error || !data) return { user: null, reason: "no-record" };
  if (!STOCK_ROOM_ROLES.includes(data.role)) return { user: null, reason: "role" };
  return { user: data, reason: null };
}

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) {
    // Surface which read failed: "could not load warehouses" is actionable,
    // a blank screen is not.
    const err = new Error(`Could not load ${label}: ${error.message || error}`);
    err.cause = error;
    throw err;
  }
  return data || [];
}

// The data loads in three independent parts so the stock screens can render
// as soon as the catalogue arrives, instead of waiting on a year of orders.

/** Catalogue and stock: everything the Stock, Warehouses, Products and Integrity screens need. */
export async function loadStockRoomCatalogue() {
  const [products, variants, warehouses, warehouseStock] = await Promise.all([
    must("products", fetchAllRows("products_live", (q) => q.select(PRODUCT_COLUMNS).order("id"))),
    must("size stock", fetchAllRows("product_variants", (q) =>
      q.select("id, product_id, size, inventory, shopify_variant_id").order("id"))),
    must("warehouses", supabase.from("warehouses").select("id, name, location").eq("is_active", true).order("name")),
    must("warehouse stock", fetchAllRows("warehouse_stock", (q) =>
      q.select("id, warehouse_id, product_id, quantity").order("id"))),
  ]);
  return {
    products: products.filter((p) => p && p.name),
    variants,
    warehouses,
    warehouseStock,
    loadedAt: new Date().toISOString(),
  };
}

/** Retail stock orders, newest first — scoped exactly as StockOrdersTab.jsx scopes them. */
export async function loadStockOrders() {
  const rows = await must("stock orders", fetchAllRows("orders", (q) =>
    q.select(STOCK_ORDER_COLUMNS).eq("is_stock_order", true).order("id")));
  // B2B and Shopify stock orders carry the same flag but belong to other dashboards.
  return rows
    .filter((o) => getOrderChannelKey(o) === "retail_stock")
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/** Customer orders placed in the last `days` days (stock orders excluded). */
export async function loadSales(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  // `not is true` rather than `eq false`: legacy rows carry is_stock_order
  // NULL, which an equality filter would silently drop.
  return must("sales", fetchAllRows("orders", (q) =>
    q.select(SALES_COLUMNS).gte("created_at", since).not("is_stock_order", "is", true).order("id")));
}

export async function signOutOfStockRoom() {
  await supabase.auth.signOut();
}

// ============================================================
// Location tracking (the Stock Room's own tables, db/stock_room/*.sql)
//
// Reads go straight to the tables and view. Every stock change goes through
// a database function that checks the role, validates, and applies the change
// in one transaction — the browser never writes stock rows itself.
// ============================================================

// The tables not existing yet (SQL not run on this database) is a normal
// state, not an error: the Stock Room then stays read-only with a setup note.
const isMissingTable = (error) =>
  !!error && (error.code === "PGRST205" || error.code === "42P01" || /schema cache|does not exist/i.test(error.message || ""));

/** Locations, placed stock, the movement history and collections — or { installed: false }. */
export async function loadLedger() {
  const locations = await supabase.from("stock_room_location").select("*").order("sort_order").order("name");
  if (locations.error) {
    if (isMissingTable(locations.error)) return { installed: false };
    throw new Error(`Could not load locations: ${locations.error.message}`);
  }
  const [placed, movements, collections, productCollections] = await Promise.all([
    must("placed stock", fetchAllRows("stock_room_placed", (q) =>
      q.select("product_id, size, location_id, qty").order("product_id").order("size").order("location_id"))),
    must("stock movements", fetchAllRows("stock_room_movement", (q) => q.select("*").order("id", { ascending: false }))),
    must("collections", supabase.from("stock_room_collection").select("id, name").order("name")),
    must("product collections", fetchAllRows("stock_room_product_collection", (q) =>
      q.select("product_id, collection_id").order("product_id").order("collection_id"))),
  ]);
  return {
    installed: true,
    locations: locations.data || [],
    placed,
    movements,
    collections,
    productCollections,
    loadedAt: new Date().toISOString(),
  };
}

/** A fresh id for one submitted action. Reuse it when retrying the same submission. */
export function newRequestId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  // RFC 4122 v4 fallback for older browsers.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function callStockFunction(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  // Messages raised by the functions are already written for people.
  if (error) throw new Error(error.message || "The change could not be saved.");
  return data;
}

const toLines = (lines) => lines.map((l) => ({
  product_id: l.productId,
  size: l.size || "",
  qty: Number(l.qty),
  ...(l.orderLine != null ? { order_line: l.orderLine } : {}),
}));

export const placeStock = ({ requestId, locationId, lines, note }) =>
  callStockFunction("stock_room_place", {
    p_request: requestId, p_location: locationId, p_lines: toLines(lines), p_note: note || null,
  });

export const transferStock = ({ requestId, fromId, toId, lines, note, inTransit = false }) =>
  callStockFunction("stock_room_transfer", {
    p_request: requestId, p_from: fromId, p_to: toId, p_lines: toLines(lines), p_note: note || null, p_in_transit: !!inTransit,
  });

/** Receive an in-transit transfer at the location it was sent to. */
export const receiveTransfer = ({ requestId, transferId, note }) =>
  callStockFunction("stock_room_receive_transfer", { p_request: requestId, p_transfer: transferId, p_note: note || null });

export const sellStock = ({ requestId, locationId, lines, reference, note }) =>
  callStockFunction("stock_room_sell", {
    p_request: requestId, p_location: locationId || null, p_lines: toLines(lines),
    p_reference: reference || null, p_note: note || null,
  });

export const receiveStock = ({ requestId, locationId, lines, reference, note, orderId }) =>
  callStockFunction("stock_room_receive", {
    p_request: requestId, p_location: locationId || null, p_lines: toLines(lines),
    p_reference: reference || null, p_note: note || null, p_order_id: orderId || null,
  });

export const adjustStock = ({ requestId, locationId, productId, size, counted, note }) =>
  callStockFunction("stock_room_adjust", {
    p_request: requestId, p_location: locationId || null, p_product: productId, p_size: size || "",
    p_counted: Number(counted), p_note: note || null,
  });

export const assignSale = ({ requestId, locationId, productId, size, qty, orderId, orderNo, orderLine, note }) =>
  callStockFunction("stock_room_assign_sale", {
    p_request: requestId, p_location: locationId, p_product: productId, p_size: size || "", p_qty: Number(qty),
    p_order_id: orderId || null, p_order_no: orderNo || null, p_order_line: orderLine ?? null, p_note: note || null,
  });

export const saveLocation = ({ requestId, id, name, kind, city, orderPrefixes, isActive, sortOrder }) =>
  callStockFunction("stock_room_save_location", {
    p_request: requestId, p_id: id || null, p_name: name, p_kind: kind, p_city: city || null,
    p_order_prefixes: orderPrefixes || [], p_is_active: isActive !== false, p_sort_order: Number(sortOrder) || 100,
  });

// ============================================================
// Products — written the same way AddProduct.jsx writes them, so a product
// added here is indistinguishable from one added there.
// ============================================================

/**
 * Next free SKU-#### number. Reads `products`, NOT products_live: reserved
 * barcode rows hold printed numbers and must count (AddProduct.jsx fetchNextSku).
 */
export async function fetchNextSku() {
  const rows = await must("SKUs", fetchAllRows("products", (q) => q.select("sku_id").like("sku_id", "SKU-%").order("id")));
  let max = 0;
  rows.forEach((r) => {
    const m = String(r.sku_id || "").match(/^SKU-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `SKU-${String(max + 1).padStart(4, "0")}`;
}

/** Suggestions and pick-lists for the product form, from the same tables AddProduct reads. */
export async function loadProductFormOptions() {
  const [prods, colors, dupattaColors] = await Promise.all([
    must("product options", fetchAllRows("products", (q) => q.select("top_options, bottom_options").order("id"))),
    must("colours", supabase.from("colors").select("name, hex").order("name")),
    must("dupatta colours", supabase.from("dupatta_colors").select("name").order("name")),
  ]);
  const tops = new Set();
  const bottoms = new Set();
  prods.forEach((p) => {
    (p.top_options || []).forEach((v) => v && tops.add(String(v).trim()));
    (p.bottom_options || []).forEach((v) => v && bottoms.add(String(v).trim()));
  });
  return {
    tops: [...tops].sort(),
    bottoms: [...bottoms].sort(),
    colors: colors.filter((c) => c.name),
    dupattaColors: dupattaColors.map((d) => d.name).filter(Boolean),
  };
}

/** The full product row and its size rows, for editing. */
export async function loadProductForEdit(productId) {
  const { data: product, error } = await supabase.from("products").select("*").eq("id", productId).single();
  if (error) throw new Error(`Could not open this product: ${error.message}`);
  const variants = await must("sizes", supabase.from("product_variants")
    .select("id, size, price, inventory, shopify_variant_id").eq("product_id", productId).order("size"));
  return { product, variants };
}

/** Every SKU number in use, including reserved barcode rows. */
export async function loadAllSkus() {
  const rows = await must("SKUs", fetchAllRows("products", (q) => q.select("sku_id").not("sku_id", "is", null).order("id")));
  return new Set(rows.map((r) => String(r.sku_id).trim().toUpperCase()));
}

/** Every column of every live product, for the catalogue CSV export. */
export async function loadProductsForExport() {
  return must("products", fetchAllRows("products_live", (q) => q.select("*").order("name").order("id")));
}

/** Names and store listings of every live product, for the duplicate-name check. */
export async function loadLiveProductNames() {
  return must("product names", fetchAllRows("products_live", (q) => q.select("id, name, store_category").order("id")));
}

/** Other products already using this Shopify product ID. */
export async function findShopifyIdUsers(shopifyId, excludeId) {
  if (!shopifyId) return [];
  let q = supabase.from("products").select("id, name, sku_id").eq("shopify_product_id", shopifyId);
  if (excludeId) q = q.neq("id", excludeId);
  return must("Shopify ID check", q);
}

const isUniqueViolation = (error) => !!error && (error.code === "23505" || /duplicate|unique/i.test(error.message || ""));

/**
 * Create a product (and, for LXRTS, its size rows).
 * SKU collision → one retry on the next number. Size rows failing → the product
 * is parked as a draft (hidden, number kept) exactly as AddProduct does, never deleted.
 */
export async function createProduct(productRow, variantRows) {
  let row = { ...productRow, is_draft: false };
  let inserted = null;
  for (let attempt = 0; attempt < 2 && !inserted; attempt += 1) {
    const { data, error } = await supabase.from("products").insert(row).select().single();
    if (!error) { inserted = data; break; }
    if (!isUniqueViolation(error) || attempt === 1) throw new Error(error.message || "The product could not be saved.");
    row = { ...row, sku_id: await fetchNextSku() };
  }

  // A function receives the new product's id — used when the size counts must
  // be read from Shopify, which looks products up by our id.
  const sizes = typeof variantRows === "function" ? await variantRows(inserted.id) : variantRows;
  if (sizes && sizes.length) {
    const { error } = await supabase.from("product_variants")
      .insert(sizes.map((v) => ({ ...v, product_id: inserted.id })));
    if (error) {
      await supabase.from("products").update({ is_draft: true }).eq("id", inserted.id);
      throw new Error(`Nothing was saved: the sizes failed (${error.message}). ${inserted.sku_id} is kept aside for this product.`);
    }
  }
  return inserted;
}

/**
 * Update a product's details and, for LXRTS, add or remove size rows.
 * Existing size rows keep their stock count: stock changes go through the
 * Stock actions, so every change is recorded.
 */
export async function updateProduct(productId, productRow, { updateVariants = [], addVariants = [], removeVariantIds = [] } = {}) {
  const { data, error } = await supabase.from("products").update(productRow).eq("id", productId).select().maybeSingle();
  if (error) throw new Error(error.message || "The product could not be saved.");
  if (!data) throw new Error("This product could not be found — it may have been removed.");

  const problems = [];
  for (const v of updateVariants) {
    const { id, ...fields } = v;
    const { error: e } = await supabase.from("product_variants").update(fields).eq("id", id);
    if (e) problems.push(e.message);
  }
  if (addVariants.length) {
    const { error: e } = await supabase.from("product_variants")
      .insert(addVariants.map((v) => ({ ...v, product_id: productId })));
    if (e) problems.push(e.message);
  }
  if (removeVariantIds.length) {
    const { error: e } = await supabase.from("product_variants").delete().in("id", removeVariantIds);
    if (e) problems.push(e.message);
  }
  if (problems.length) throw new Error(`${data.name} was saved, but its sizes were not fully updated: ${problems.join("; ")}`);
  return data;
}

/** Insert made-to-order / custom products from a CSV, numbering blank SKUs in order. */
export async function importProducts(rows) {
  let next = parseInt((await fetchNextSku()).replace("SKU-", ""), 10);
  const saved = [];
  const failed = [];
  for (const r of rows) {
    const row = { ...r, is_draft: false };
    if (!row.sku_id) { row.sku_id = `SKU-${String(next).padStart(4, "0")}`; next += 1; }
    const { data, error } = await supabase.from("products").insert(row).select("id, sku_id, name").single();
    if (error) failed.push(`${row.name}: ${error.message}`);
    else saved.push(data);
  }
  return { saved, failed };
}

export async function createCollection(name) {
  const { data, error } = await supabase.from("stock_room_collection")
    .insert({ name: name.trim() }).select("id, name").single();
  if (error) {
    if (isUniqueViolation(error)) throw new Error(`A collection called "${name.trim()}" already exists.`);
    throw new Error(error.message);
  }
  return data;
}

/** Make a product's collections exactly `collectionIds`. */
export async function setProductCollections(productId, collectionIds, currentIds) {
  const want = new Set(collectionIds);
  const have = new Set(currentIds);
  const add = [...want].filter((id) => !have.has(id));
  const remove = [...have].filter((id) => !want.has(id));
  if (add.length) {
    const { error } = await supabase.from("stock_room_product_collection")
      .insert(add.map((collection_id) => ({ product_id: productId, collection_id })));
    if (error) throw new Error(`Collections not saved: ${error.message}`);
  }
  if (remove.length) {
    const { error } = await supabase.from("stock_room_product_collection")
      .delete().eq("product_id", productId).in("collection_id", remove);
    if (error) throw new Error(`Collections not saved: ${error.message}`);
  }
}

// ============================================================
// Bulk stock orders (see bulkStockOrders.js for the CSV rules and
// db/stock_room/07_bulk_stock_orders.sql for the writer).
// ============================================================

/**
 * The values a bulk file must match EXACTLY. Colours, dupatta colours and
 * extras are not part of the stock catalogue load, so they are fetched here;
 * designs, sizes and garment options come from the catalogue already on screen.
 *
 * The heads are the same list the stock-order form offers, which is also what
 * the CHECK constraint on orders.production_head_designation allows.
 */
export async function loadBulkOrderOptions() {
  const [colors, dupattaColors, extras] = await Promise.all([
    must("colours", supabase.from("colors").select("name, hex").order("name")),
    must("dupatta colours", supabase.from("dupatta_colors").select("name").order("name")),
    must("extras", supabase.from("extras").select("name").order("name")),
  ]);
  return {
    colors: colors.filter((c) => c.name),
    dupattaColors: dupattaColors.map((d) => d.name).filter(Boolean),
    extras: extras.map((e) => e.name).filter(Boolean),
    heads: STOCK_HEAD_OPTIONS,
  };
}

/**
 * Raise every order in one call. The function writes each order in its own
 * block, so a bad one fails alone; a retry with the same requestId replays the
 * first result instead of raising everything twice.
 *
 * @returns {{ batch_id: string, created: object[], failed: object[] }}
 */
export const bulkCreateStockOrders = ({ requestId, file, orders }) =>
  callStockFunction("stock_room_bulk_stock_orders", {
    p_request: requestId,
    p_file: { name: file?.name || null, hash: file?.hash || null },
    p_orders: orders,
  });
