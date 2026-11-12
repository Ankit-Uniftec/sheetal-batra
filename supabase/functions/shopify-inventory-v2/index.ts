import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  canonicalRow, chunk, deltaFor, inventoryMap, isStale, nextBatch, pickLevel, planUpdates,
  PRODUCTS_PER_QUERY, readingsFromProduct, ROTATION_BATCH, SET_ROLES,
  SHOPIFY_API_VERSION, soldProductIds, toGid,
} from "./logic.ts";

// ============================================================
// shopify-inventory-v2 — LXRTS stock between the app and Shopify.
//
// Shopify holds the true LXRTS count; product_variants.inventory is the
// app's copy of it. Replaces the old `shopify-inventory` function, which had
// no login check, adjusted "whichever location came first", and asked for a
// retired API version (served today as 2026-01; from 16 Jan 2027 it would fall
// forward to 2026-04, where its adjust call is rejected).
//
// Actions (POST JSON):
//   { action: "fetch",  product_id }                           any staff
//       Read Shopify, copy each linked size's count (and price) into
//       product_variants, return { success, inventory: { size: qty } }.
//   { action: "adjust", product_id, size, change, source, order_no? }   any staff
//       A real movement: + adds, − removes (sales, cancellations, receiving).
//   { action: "set",    product_id, size, quantity, source }  SET_ROLES only
//       A manual correction to an exact number.
//   { action: "retry",  log_id }                               SET_ROLES only
//       Send a failed change again.
//   { action: "sync" }                                         scheduled job only
//       Refresh designs sold on the website since the last run plus a
//       rotating batch, so Shopify-side changes reach the app. Also releases
//       expired piece holds (Release 35) and puts their Shopify count back.
//   { action: "hold",    code }                                any staff
//       Release 35: a scanned piece label (NAS-RED-ST-L-001). Holds the piece
//       for HOLD_MINUTES and lowers Shopify by 1 (LXRTS) so no one else can
//       sell it. Returns the piece, its product and the result.
//   { action: "release", code, force? }                        holder (force: SET_ROLES)
//       Puts a held piece back on sale and Shopify back up by 1.
//   { action: "catalogue", cursor? }                           SET_ROLES only
//       Release 36, READ ONLY: one page of Shopify products (title, handle,
//       status, tags, sizes with variant ids, price and stock). Call again with
//       the returned next_cursor until it is null.
//   Add "dry_run": true to fetch/adjust/set/hold to do every read and return
//   the plan without writing to Shopify or the database.
//
// Webhook (optional, OFF until SHOPIFY_INVENTORY_WEBHOOK_SECRET is set):
//   Shopify "inventory_levels/update" — used as a trigger only: the design is
//   re-read from Shopify, exactly like a fetch.
//
// Every change to Shopify uses compare-and-swap (changeFromQuantity = the
// number just read) and an idempotency key, so a change can never apply twice
// and never lands on a number that moved underneath it. A stale read is
// re-read and tried again, up to 3 times.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   SHOPIFY_ACCESS_TOKEN               Admin API token (read_inventory, write_inventory, read_products)
//   SHOPIFY_STOCK_SYNC_SECRET          shared with the scheduled job (any long random string)
//   SHOPIFY_LOCATION_ID                optional; the Shopify location holding LXRTS stock
//   SHOPIFY_INVENTORY_WEBHOOK_SECRET   optional; turns the webhook on
// Deploy with Supabase's JWT verification ON for now (callers send the user's
// login or, for the scheduled job, the public key): an extra layer on top of
// the function's own checks. Turn it OFF only when the Shopify webhook is added
// (Shopify cannot send a Supabase login):
//   supabase functions deploy shopify-inventory-v2 --project-ref qlqvchcvuwjnfranqcmx
// ============================================================

const SHOPIFY_STORE = "sheetalbatraindia.myshopify.com";
const GRAPHQL_URL = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOPIFY_ACCESS_TOKEN = Deno.env.get("SHOPIFY_ACCESS_TOKEN") || "";
const SYNC_SECRET = Deno.env.get("SHOPIFY_STOCK_SYNC_SECRET") || "";
const WEBHOOK_SECRET = Deno.env.get("SHOPIFY_INVENTORY_WEBHOOK_SECRET") || "";
const LOCATION_ID = toGid(Deno.env.get("SHOPIFY_LOCATION_ID") || "", "Location");

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ─── Shopify ────────────────────────────────────────────────

type GqlResult = { data?: any; errors?: any[]; extensions?: any };

async function shopify(query: string, variables: Record<string, unknown>): Promise<GqlResult> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}`);
  return await res.json();
}

const throttled = (r: GqlResult) => (r.errors || []).some((e: any) => e?.extensions?.code === "THROTTLED");

// One location configured → read that level; otherwise read the item's levels
// and let pickLevel insist on exactly one.
const LEVEL_FIELDS = LOCATION_ID
  ? `inventoryLevel(locationId: "${LOCATION_ID}") { location { id } quantities(names: ["available"]) { name quantity } }`
  : `inventoryLevels(first: 3) { nodes { location { id } quantities(names: ["available"]) { name quantity } } }`;

const VARIANT_QUERY = `query variantStock($id: ID!) {
  productVariant(id: $id) { id inventoryItem { id ${LEVEL_FIELDS} } }
}`;

const PRODUCTS_QUERY = `query productsStock($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Product {
      id
      variants(first: 30) {
        nodes { id price selectedOptions { name value } inventoryItem { id ${LEVEL_FIELDS} } }
      }
    }
  }
}`;

const ADJUST_MUTATION = `mutation adjustStock($input: InventoryAdjustQuantitiesInput!, $idempotencyKey: String!) {
  inventoryAdjustQuantities(input: $input) @idempotent(key: $idempotencyKey) {
    userErrors { field message code }
    inventoryAdjustmentGroup { reason changes { name delta } }
  }
}`;

/** Current available stock of one variant at the LXRTS location. */
async function readVariant(variantGid: string) {
  const r = await shopify(VARIANT_QUERY, { id: variantGid });
  if (r.errors?.length) throw new Error(r.errors[0]?.message || "Shopify read failed");
  const item = r.data?.productVariant?.inventoryItem;
  if (!item?.id) throw new Error("Shopify has no inventory item for this size.");
  const picked = pickLevel(LOCATION_ID, item.inventoryLevel, item.inventoryLevels?.nodes);
  if ("error" in picked) throw new Error(picked.error);
  return { inventoryItemId: item.id as string, locationId: picked.locationId, available: picked.available };
}

/** Read several designs; returns readings per Shopify product GID. */
async function readProducts(productGids: string[]) {
  const byProduct = new Map<string, ReturnType<typeof readingsFromProduct>>();
  let stoppedEarly = false;
  for (const ids of chunk(productGids, PRODUCTS_PER_QUERY)) {
    const r = await shopify(PRODUCTS_QUERY, { ids });
    if (throttled(r)) { stoppedEarly = true; break; }
    if (r.errors?.length) throw new Error(r.errors[0]?.message || "Shopify read failed");
    for (const node of r.data?.nodes || []) if (node?.id) byProduct.set(node.id, readingsFromProduct(node, LOCATION_ID));
    // Leave room for order sync and the store: stop when the bucket runs low.
    const left = r.extensions?.cost?.throttleStatus?.currentlyAvailable;
    if (typeof left === "number" && left < 400) { stoppedEarly = true; break; }
  }
  return { byProduct, stoppedEarly };
}

// ─── Database helpers ───────────────────────────────────────

const VARIANT_COLS = "id, product_id, size, inventory, price, shopify_variant_id, shopify_inventory_item_id";

/**
 * Re-read designs from Shopify and copy differences into product_variants.
 * @returns per-design results for the caller to report.
 */
async function refreshProducts(productIds: string[], dryRun = false) {
  const results: Record<string, { name?: string; updated: number; unlinked: string[]; failed: string[]; changes: unknown[]; linked?: Array<{ id: string; size: string; variantId: string }> }> = {};
  if (!productIds.length) return { results, stoppedEarly: false };
  const { data: products, error: pErr } = await supabase.from("products").select("id, name, shopify_product_id").in("id", productIds);
  if (pErr) throw new Error(pErr.message);
  const gidOf = new Map<string, string>();
  const nameOf = new Map<string, string>((products || []).map((p: any) => [p.id, p.name || p.id]));
  for (const p of products || []) {
    const gid = toGid(p.shopify_product_id, "Product");
    if (gid.startsWith("gid://shopify/Product/")) gidOf.set(p.id, gid);
    else results[p.id] = { updated: 0, unlinked: [], failed: ["Design has no valid Shopify product id"], changes: [] };
  }
  const { byProduct, stoppedEarly } = await readProducts([...new Set(gidOf.values())]);
  const { data: rows, error: vErr } = await supabase.from("product_variants").select(VARIANT_COLS).in("product_id", [...gidOf.keys()]);
  if (vErr) throw new Error(vErr.message);
  const now = new Date().toISOString();
  for (const [productId, gid] of gidOf) {
    const readings = byProduct.get(gid);
    if (!readings) { if (!stoppedEarly) results[productId] = { updated: 0, unlinked: [], failed: ["Shopify did not return this design"], changes: [] }; continue; }
    const mine = (rows || []).filter((r: any) => r.product_id === productId);
    const plan = planUpdates(mine, readings);
    let updated = 0;
    if (!dryRun) {
      for (const u of plan.updates) {
        const { error } = await supabase.from("product_variants").update({ ...u.fields, last_synced_at: now }).eq("id", u.id);
        if (error) plan.failed.push(`${u.size}: ${error.message}`); else updated += 1;
      }
      // Stamp unchanged linked rows too, so "last synced" means "checked".
      const touched = new Set(plan.updates.map((u) => u.id));
      const linkedIds = mine.filter((r: any) => !touched.has(r.id) && !plan.unlinked.includes(r.size)).map((r: any) => r.id);
      if (linkedIds.length) await supabase.from("product_variants").update({ last_synced_at: now }).in("id", linkedIds);
    }
    results[productId] = { name: nameOf.get(productId), updated, unlinked: plan.unlinked, failed: plan.failed, linked: plan.linked, changes: plan.updates.filter((u) => u.to !== null).map((u) => ({ id: u.id, size: u.size, from: u.from, to: u.to })) };
  }
  return { results, stoppedEarly };
}

async function logInsert(row: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await supabase.from("shopify_stock_log").insert(row).select("id").single();
  if (error) { console.error("shopify_stock_log insert failed:", error.message); return null; }
  return data?.id || null;
}
async function logUpdate(id: string | null, fields: Record<string, unknown>) {
  if (!id) return;
  const { error } = await supabase.from("shopify_stock_log").update(fields).eq("id", id);
  if (error) console.error("shopify_stock_log update failed:", error.message);
}

// ─── Writes ─────────────────────────────────────────────────

type WriteInput = {
  action: "adjust" | "set"; productId: string; size: string;
  change?: unknown; quantity?: unknown; source?: string; orderNo?: string;
  dryRun?: boolean; user: { email: string; role: string } | null; retryOf?: string;
};

/**
 * Change one size on Shopify, then copy Shopify's new number into the app.
 * Always resolves (never throws) with { success, ... } so callers can report.
 */
async function write(input: WriteInput) {
  const { action, productId, size, dryRun } = input;
  if (!productId || !size) return { success: false, error: "product_id and size are required." };

  // A size can have two Shopify variants (two rows): change the one holding stock.
  const { data: sameSize } = await supabase.from("product_variants")
    .select("id, inventory, shopify_variant_id").eq("product_id", productId).eq("size", size);
  const variant = canonicalRow(sameSize || []);
  let variantGid = toGid(variant?.shopify_variant_id, "ProductVariant");
  if (variant && !variantGid) {
    // Not linked yet (a new design entered with only its product id): read the
    // design from Shopify, which links its sizes by name, then use that link.
    const { results } = await refreshProducts([productId], dryRun);
    const link = (results[productId]?.linked || []).find((l) => l.id === variant.id);
    if (link) variantGid = link.variantId;
  }

  const base = {
    action, source: input.source || null, order_no: input.orderNo || null,
    product_id: productId, size, shopify_variant_id: variantGid || null,
    requested_change: action === "adjust" ? Number(input.change) : null,
    requested_quantity: action === "set" ? Number(input.quantity) : null,
    user_email: input.user?.email || null, retry_of: input.retryOf || null,
  };

  if (!variant || !variantGid.startsWith("gid://shopify/ProductVariant/")) {
    const error = "This size is not linked to a Shopify variant.";
    if (!dryRun) await logInsert({ ...base, status: "failed", retryable: false, error });
    return { success: false, error };
  }

  const logId = dryRun ? null : await logInsert({ ...base, status: "pending", retryable: false });
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    let read;
    try {
      read = await readVariant(variantGid);
    } catch (e) {
      lastError = (e as Error).message;
      await logUpdate(logId, { status: "failed", retryable: true, error: lastError });
      return { success: false, error: lastError, log_id: logId };
    }
    const d = deltaFor(action, read.available, input.change, input.quantity);
    if ("error" in d) {
      await logUpdate(logId, { status: "failed", retryable: false, error: d.error, before_qty: read.available });
      return { success: false, error: d.error, log_id: logId };
    }
    const after = read.available + d.delta;
    if (dryRun) {
      return { success: true, dry_run: true, before: read.available, delta: d.delta, after, location_id: read.locationId };
    }
    if (d.delta === 0) {
      await supabase.from("product_variants").update({ inventory: read.available, shopify_inventory_item_id: read.inventoryItemId, last_synced_at: new Date().toISOString() }).eq("id", variant.id);
      await logUpdate(logId, { status: "sent", before_qty: read.available, delta: 0, after_qty: read.available, location_id: read.locationId });
      return { success: true, before: read.available, delta: 0, after: read.available, log_id: logId };
    }

    let r: GqlResult;
    try {
      r = await shopify(ADJUST_MUTATION, {
        idempotencyKey: `${logId}-${attempt}`,
        input: {
          reason: "correction",
          name: "available",
          referenceDocumentUri: `sheetalbatra://stock/${input.source || action}/${logId}`,
          changes: [{
            delta: d.delta,
            inventoryItemId: read.inventoryItemId,
            locationId: read.locationId,
            changeFromQuantity: read.available,
          }],
        },
      });
    } catch (e) {
      // The request may or may not have reached Shopify. Do not offer a blind
      // retry of a relative change; ask for the number to be checked instead.
      lastError = (e as Error).message;
      await logUpdate(logId, { status: "unknown", retryable: false, before_qty: read.available, delta: d.delta, location_id: read.locationId,
        error: `No answer from Shopify (${lastError}). Check this size on Shopify before changing it again.` });
      return { success: false, error: lastError, log_id: logId };
    }

    const userErrors = r.data?.inventoryAdjustQuantities?.userErrors || [];
    if (!r.errors?.length && !userErrors.length && r.data?.inventoryAdjustQuantities) {
      await supabase.from("product_variants").update({ inventory: after, shopify_inventory_item_id: read.inventoryItemId, last_synced_at: new Date().toISOString() }).eq("id", variant.id);
      await logUpdate(logId, { status: "sent", before_qty: read.available, delta: d.delta, after_qty: after, location_id: read.locationId, error: null });
      return { success: true, before: read.available, delta: d.delta, after, log_id: logId };
    }
    if (isStale(userErrors) && attempt < 3) continue; // stock moved since we read it: read again
    lastError = userErrors.map((e: any) => e.message).join("; ") || r.errors?.[0]?.message || "Shopify rejected the change.";
    await logUpdate(logId, { status: "failed", retryable: true, before_qty: read.available, delta: d.delta, location_id: read.locationId, error: lastError });
    return { success: false, error: lastError, log_id: logId };
  }
  await logUpdate(logId, { status: "failed", retryable: true, error: "Stock kept changing on Shopify; try again." });
  return { success: false, error: "Stock kept changing on Shopify; try again.", log_id: logId };
}

// ─── Catalogue read (Release 36, read only) ─────────────────

const CATALOGUE_QUERY = `query catalogue($after: String) {
  products(first: 25, after: $after, sortKey: TITLE) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title handle status productType tags totalInventory
      variants(first: 30) {
        nodes { id title price sku selectedOptions { name value } inventoryItem { id ${LEVEL_FIELDS} } }
      }
    }
  }
}`;

/** Up to `pages` pages of 25 products from `cursor`. Writes nothing. */
async function readCatalogue(cursor: string | null, pages = 8) {
  const products: unknown[] = [];
  let after = cursor;
  for (let i = 0; i < pages; i++) {
    const r = await shopify(CATALOGUE_QUERY, { after });
    if (throttled(r)) return { products, next_cursor: after, throttled: true };
    if (r.errors?.length) throw new Error(r.errors[0]?.message || "Shopify read failed");
    const page = r.data?.products;
    for (const p of page?.nodes || []) {
      products.push({
        id: p.id, title: p.title, handle: p.handle, status: p.status, type: p.productType,
        tags: p.tags, total: p.totalInventory,
        sizes: readingsFromProduct(p, LOCATION_ID).map((x) => ({ size: x.size, variant_id: x.variantId, price: x.price, available: x.available, error: x.error })),
      });
    }
    if (!page?.pageInfo?.hasNextPage) return { products, next_cursor: null };
    after = page.pageInfo.endCursor;
    const left = r.extensions?.cost?.throttleStatus?.currentlyAvailable;
    if (typeof left === "number" && left < 400) return { products, next_cursor: after, throttled: true };
  }
  return { products, next_cursor: after };
}

// ─── Piece holds (Release 35) ───────────────────────────────

const HOLD_MINUTES = 30;
const PIECE_PRODUCT_COLS = "id, name, sku_id, base_price, image_url, sync_enabled, is_custom_piece, default_color, available_size, shopify_product_id";

/** True when the piece table has not been created yet (SQL not run). */
const missingPieces = (e: any) => !!e && (e.code === "PGRST202" || e.code === "PGRST205" || e.code === "42P01" || /does not exist|schema cache/i.test(e.message || ""));

async function holdPiece(rawCode: unknown, user: { email: string; role: string }, dryRun: boolean) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!code) return { success: false, error: "No label code was scanned." };
  const { data: sp } = await supabase.from("salesperson").select("*").eq("email", user.email).maybeSingle();
  const name = (sp as any)?.saleperson || "";
  const store = (sp as any)?.store_name || (sp as any)?.store || "";

  let result: any;
  if (dryRun) {
    // Local copy of the app: read only, say what a real scan would do.
    const { data: piece, error } = await supabase.from("stock_pieces").select("*").eq("code", code).maybeSingle();
    if (error) return { success: false, error: missingPieces(error) ? "Piece labels are not set up yet (run the Release 35 SQL)." : error.message };
    if (!piece) result = { result: "not_found" };
    else {
      const { data: kp } = await supabase.from("products").select("sync_enabled, is_custom_piece").eq("id", piece.product_id).maybeSingle();
      const kind = kp?.sync_enabled ? "lxrts" : kp?.is_custom_piece ? "custom" : "mto";
      const busy = piece.status === "held" && new Date(piece.held_until) > new Date() && piece.held_by !== user.email;
      result = {
        piece, kind, need_shopify: false,
        result: piece.status === "sold" || piece.status === "void" ? piece.status : kind === "mto" ? "sample" : busy ? "held_by_other" : "held",
      };
    }
  } else {
    const { data, error } = await supabase.rpc("stock_piece_hold", { p_code: code, p_email: user.email, p_name: name, p_store: store, p_minutes: HOLD_MINUTES });
    if (error) return { success: false, error: missingPieces(error) ? "Piece labels are not set up yet (run the Release 35 SQL)." : error.message };
    result = data;
  }
  if (result.result === "not_found") return { success: true, result: "not_found", code };

  const piece = result.piece;
  const { data: product } = await supabase.from("products").select(PIECE_PRODUCT_COLS).eq("id", piece.product_id).maybeSingle();

  let shopify: { ok: boolean; error?: string } | null = null;
  if (!dryRun && result.need_shopify) {
    const w = await write({ action: "adjust", productId: piece.product_id, size: piece.size, change: -1, source: "scan-hold", orderNo: code, user });
    if (w.success) {
      await supabase.rpc("stock_piece_set_stock_held", { p_code: code });
      piece.stock_held = true;
      shopify = { ok: true };
    } else {
      // The piece is still held for this SA (no other SA can scan it); only
      // the website was not told. The order will lower Shopify as usual.
      shopify = { ok: false, error: w.error };
    }
  }
  return { success: true, result: result.result, kind: result.kind, piece, product, shopify, hold_minutes: HOLD_MINUTES, dry_run: dryRun || undefined };
}

async function releasePiece(rawCode: unknown, user: { email: string; role: string }, force: boolean, dryRun: boolean) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!code) return { success: false, error: "code is required." };
  if (force && !SET_ROLES.includes(user.role)) return { success: false, error: "You are not allowed to release another person's hold." };
  if (dryRun) return { success: true, dry_run: true, released: false };
  const { data, error } = await supabase.rpc("stock_piece_release", { p_code: code, p_email: user.email, p_force: force });
  if (error) return { success: false, error: error.message };
  let shopify: unknown = null;
  if (data?.released && data.kind === "lxrts" && data.stock_held) {
    const w = await write({ action: "adjust", productId: data.product_id, size: data.size, change: 1, source: "scan-release", orderNo: code, user });
    shopify = w.success ? { ok: true } : { ok: false, error: w.error };
  }
  return { success: true, ...data, shopify };
}

/** Expired holds → back on sale, Shopify +1 each. Never throws. */
async function releaseExpiredHolds() {
  try {
    const { data, error } = await supabase.rpc("stock_pieces_release_expired");
    if (error) { if (!missingPieces(error)) console.error("release expired holds:", error.message); return 0; }
    for (const row of data || []) {
      const w = await write({ action: "adjust", productId: row.product_id, size: row.size, change: 1, source: "scan-hold-expired", orderNo: row.code, user: null });
      if (!w.success) console.error(`hold expiry +1 failed for ${row.code}:`, w.error);
    }
    return (data || []).length;
  } catch (e) {
    console.error("release expired holds:", (e as Error).message);
    return 0;
  }
}

// ─── Scheduled sync ─────────────────────────────────────────

async function runSync() {
  const now = new Date();
  // Take the run lock (one UPDATE, so two overlapping runs cannot both win).
  const { data: lock } = await supabase.from("shopify_stock_sync_state")
    .update({ running_until: new Date(now.getTime() + 55_000).toISOString() })
    .eq("id", 1)
    .or(`running_until.is.null,running_until.lt."${now.toISOString()}"`)
    .select("last_run_at, cursor").maybeSingle();
  if (!lock) return { success: true, skipped: "another sync run is still going" };

  try {
    const holdsReleased = await releaseExpiredHolds();
    const since = new Date((lock.last_run_at ? new Date(lock.last_run_at).getTime() : now.getTime() - 10 * 60_000) - 2 * 60_000);
    const { data: orders } = await supabase.from("orders").select("items")
      .like("order_no", "SB-SHOP%")
      .or(`created_at.gte."${since.toISOString()}",updated_at.gte."${since.toISOString()}"`).limit(500);
    const sold = soldProductIds(orders || []);

    const { data: synced } = await supabase.from("products").select("id").eq("sync_enabled", true);
    const allIds = (synced || []).map((p: any) => p.id);
    const { batch, cursor } = nextBatch(allIds.filter((id: string) => !sold.includes(id)), lock.cursor, ROTATION_BATCH);
    const targets = [...new Set([...sold.filter((id) => allIds.includes(id)), ...batch])];

    const { results, stoppedEarly } = await refreshProducts(targets);
    const changed = Object.values(results).reduce((s, r) => s + r.updated, 0);
    const problems = Object.values(results)
      .filter((r) => r.failed.length || r.unlinked.length)
      .map((r) => `${r.name}: ${[...r.failed, ...(r.unlinked.length ? [`no Shopify size for ${r.unlinked.join(", ")}`] : [])].join(", ")}`);
    if (changed) {
      const rows = Object.entries(results).flatMap(([productId, r]) => (r.changes as any[]).map((c) => ({
        action: "sync", source: "scheduled-sync", product_id: productId, size: c.size,
        before_qty: c.from, after_qty: c.to, delta: (c.to ?? 0) - c.from, status: "received",
      })));
      if (rows.length) await supabase.from("shopify_stock_log").insert(rows);
    }
    await supabase.from("shopify_stock_sync_state").update({
      last_run_at: now.toISOString(), last_ok_at: new Date().toISOString(), running_until: null,
      cursor: stoppedEarly ? lock.cursor : cursor,
      last_checked: targets.length, last_changed: changed,
      last_error: problems.length ? problems.slice(0, 20).join(" | ") : (stoppedEarly ? "Stopped early to stay within Shopify's API limit" : null),
    }).eq("id", 1);
    return { success: true, checked: targets.length, sold: sold.length, changed, stoppedEarly, problems: problems.length, holdsReleased };
  } catch (e) {
    await supabase.from("shopify_stock_sync_state").update({ running_until: null, last_run_at: now.toISOString(), last_error: (e as Error).message }).eq("id", 1);
    throw e;
  }
}

// ─── Webhook (off until its secret is set) ──────────────────

async function verifyHmac(rawBody: string, header: string | null): Promise<boolean> {
  if (!header || !WEBHOOK_SECRET) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

async function handleWebhook(rawBody: string, req: Request) {
  if (!await verifyHmac(rawBody, req.headers.get("X-Shopify-Hmac-Sha256"))) return json({ error: "Webhook not verified" }, 401);
  const payload = JSON.parse(rawBody || "{}");
  if (LOCATION_ID && payload.location_id && toGid(payload.location_id, "Location") !== LOCATION_ID) return json({ success: true, ignored: "other location" });
  const itemGid = toGid(payload.inventory_item_id, "InventoryItem");
  if (!itemGid) return json({ success: true, ignored: "no inventory item" });
  const { data: rows } = await supabase.from("product_variants").select("product_id").eq("shopify_inventory_item_id", itemGid);
  const ids = [...new Set((rows || []).map((r: any) => r.product_id))];
  if (!ids.length) return json({ success: true, ignored: "not an LXRTS size" });
  const { results } = await refreshProducts(ids);
  return json({ success: true, results });
}

// ─── Who is calling ─────────────────────────────────────────

async function staffFrom(req: Request): Promise<{ email: string; role: string } | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  const email = data?.user?.email?.toLowerCase();
  if (error || !email) return null;
  const { data: sp } = await supabase.from("salesperson").select("role").eq("email", email).maybeSingle();
  return sp?.role ? { email, role: sp.role } : null;
}

// ─── HTTP ───────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    if (!SHOPIFY_ACCESS_TOKEN) throw new Error("SHOPIFY_ACCESS_TOKEN not configured");
    const rawBody = await req.text();
    if (req.headers.get("X-Shopify-Hmac-Sha256")) return await handleWebhook(rawBody, req);

    const body = JSON.parse(rawBody || "{}");
    const action = String(body.action || "");

    if (action === "sync") {
      if (!SYNC_SECRET || req.headers.get("x-sync-secret") !== SYNC_SECRET) return json({ error: "Not allowed" }, 401);
      return json(await runSync());
    }

    const user = await staffFrom(req);
    if (!user) return json({ error: "Please sign in again." }, 401);
    const dryRun = body.dry_run === true;

    if (action === "fetch") {
      if (!body.product_id) return json({ error: "product_id is required" }, 400);
      const { results } = await refreshProducts([body.product_id], dryRun);
      const r = results[body.product_id];
      const { data: rows } = await supabase.from("product_variants").select("id, size, inventory").eq("product_id", body.product_id);
      if (r?.failed?.includes("Design has no valid Shopify product id")) return json({ error: "Product not found or not a sync product" }, 400);
      // A dry run wrote nothing, so lay Shopify's numbers over the stored ones.
      const shown = dryRun
        ? (rows || []).map((row: any) => {
          const c = (r?.changes as any[] || []).find((x) => x.id === row.id);
          return c ? { ...row, inventory: c.to } : row;
        })
        : rows || [];
      return json({ success: true, inventory: inventoryMap(shown), unlinked: r?.unlinked || [], failed: r?.failed || [], changes: r?.changes || [], dry_run: dryRun });
    }

    if (action === "adjust" || action === "set") {
      if (action === "set" && !SET_ROLES.includes(user.role)) return json({ error: "You are not allowed to set LXRTS stock." }, 403);
      const result = await write({
        action, productId: body.product_id, size: body.size, change: body.change, quantity: body.quantity,
        source: body.source, orderNo: body.order_no, dryRun, user,
      });
      return json(result, result.success ? 200 : 400);
    }

    if (action === "catalogue") {
      if (!SET_ROLES.includes(user.role)) return json({ error: "You are not allowed to read the Shopify catalogue." }, 403);
      return json({ success: true, ...(await readCatalogue(body.cursor ? String(body.cursor) : null)) });
    }

    if (action === "hold") {
      const result = await holdPiece(body.code, user, dryRun);
      return json(result, result.success ? 200 : 400);
    }

    if (action === "release") {
      const result = await releasePiece(body.code, user, body.force === true, dryRun);
      return json(result, result.success ? 200 : 400);
    }

    if (action === "retry") {
      if (!SET_ROLES.includes(user.role)) return json({ error: "You are not allowed to retry Shopify changes." }, 403);
      const { data: row } = await supabase.from("shopify_stock_log").select("*").eq("id", body.log_id).maybeSingle();
      if (!row) return json({ error: "Change not found" }, 404);
      if (row.status !== "failed" || !row.retryable || row.retried_at) return json({ error: "This change cannot be retried." }, 400);
      if (row.source === "stock-room") return json({ error: "Retry Stock Room changes from its own list (Shopify changes not sent)." }, 400);
      const result = await write({
        action: row.action, productId: row.product_id, size: row.size,
        change: row.requested_change, quantity: row.requested_quantity,
        source: row.source, orderNo: row.order_no, user, retryOf: row.id,
      });
      await supabase.from("shopify_stock_log").update({ retried_at: new Date().toISOString(), retried_by: user.email, retry_log_id: result.log_id || null }).eq("id", row.id);
      return json(result, result.success ? 200 : 400);
    }

    return json({ error: "Unknown action. Use fetch, adjust, set, retry, hold, release, catalogue or sync." }, 400);
  } catch (e) {
    console.error("shopify-inventory-v2:", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
