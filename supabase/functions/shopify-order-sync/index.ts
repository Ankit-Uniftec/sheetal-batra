import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildOrderComponents,
  mapShopifyOrder,
  normalizeColorKey,
  SHOPIFY_STORE_KEY,
} from "./mapper.ts";

// ============================================================
// shopify-order-sync — ingest website orders into `orders`.
//
// A Shopify order is an ORDINARY order that happens to be placed on the
// website. Once it lands here it behaves exactly like a store / B2B /
// exhibition order: same production flow, same warehouse stages, same dispatch
// and delivery. The only thing unique to this channel is how the order arrives.
//
// Runs with the SERVICE ROLE key — it must create auth users and write orders,
// neither of which the browser's anon key can do (and the Shopify token must
// never reach the client).
//
// Three ways in, ONE mapper and ONE idempotent write path, so a duplicate
// delivery is a harmless no-op:
//
//   A. WEBHOOK  — Shopify POSTs on orders/create|updated|cancelled. Identified
//      by the X-Shopify-Hmac-Sha256 header (no `mode` in the body). Verified
//      against SHOPIFY_WEBHOOK_SECRET, then used as a TRIGGER ONLY: we take the
//      order id and re-fetch through the same GraphQL query as every other
//      mode. Near-instant.
//
//   B. RECONCILE POLL — pg_cron every 5 min over a 15 min window (deliberate
//      overlap so nothing falls between runs). Filters on CREATED_AT. This is
//      the safety net for INGESTION: webhooks are silently dropped during a
//      deploy, a cold start, or after Shopify exhausts its retries, and a lost
//      paid order is not an acceptable failure mode.
//
//   C. REFRESH SWEEP — pg_cron hourly over a 24h window, filtering on
//      UPDATED_AT. The safety net for FRESHNESS: an order paid hours after
//      checkout never re-enters a created_at window, so reconcile can never
//      see it. Kept separate from reconcile on purpose — see the fetchOrders
//      docblock for the paging hazard that separation avoids.
//      REFRESH-ONLY: it updates orders we already have and SKIPS ones we do
//      not. Its updated_at window is full of old orders that were never
//      ingested, and creating those retro-actively mints out-of-sequence
//      order numbers and past-due production work. Only A and B create.
//
// "Idempotent" means REFRESH, not skip. A known order has its payment state
// (financial status + tags) updated from the fresh node; everything production
// depends on — order_no, items, delivery_date, status — is left alone. See
// refreshExistingOrder.
//
// Manual modes:
//   { mode: "sync-now",  sinceDays?, first? }   dashboard "Sync now" button
//   { mode: "order",     id: "gid://..." }      re-ingest/refresh one order
//   { mode: "refresh",   sinceMinutes?, first? } catch-up sweep on updated_at
//   { mode: "remap-items" }                     re-run the mapper over stored
//                                               shopify_raw (no Shopify call)
//   { mode: "backfill-components" }             mint components for older rows
//   Add "dryRun": true to any pull mode to map without writing.
//
// Secrets (Supabase function config):
//   SHOPIFY_ACCESS_TOKEN    Admin API token (read_orders, read_products)
//   SHOPIFY_WEBHOOK_SECRET  webhook signing secret, from the Shopify admin
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOPIFY_ACCESS_TOKEN = Deno.env.get("SHOPIFY_ACCESS_TOKEN")!;
// Shopify's webhook signing secret. Shown once when the webhook is created in
// the Shopify admin (Settings → Notifications → Webhooks). Without it the
// webhook path rejects every request rather than trusting unverified payloads.
const SHOPIFY_WEBHOOK_SECRET = Deno.env.get("SHOPIFY_WEBHOOK_SECRET") || "";

const SHOPIFY_STORE = "sheetalbatraindia.myshopify.com";
const SHOPIFY_API_VERSION = "2024-01"; // match shopify-inventory
const SHOPIFY_GRAPHQL_URL = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ─── Shopify-order prefixes ─────────────────────────────────
// Orders now mint SB-SHOPIFY-MMYY-NNNNNN. They used to mint SB-SHOP-, and some
// existing orders KEEP that old prefix permanently: renaming an order whose
// barcode has already been scanned would orphan its stage history and make the
// printed label unscannable, so 56_rename_shop_orders.sql deliberately skips
// those. Every query that selects Shopify orders must therefore match BOTH.
//
// Matched as full segments ('SB-SHOP-' / 'SB-SHOPIFY-', each with its trailing
// dash) rather than a loose 'SB-SHOP%', which would also swallow a future
// SHOPIFYSTOCK — a different channel with different semantics.
const ORDER_NO_PREFIXES = ["SB-SHOPIFY-", "SB-SHOP-"];
const ORDER_NO_PREFIX_FILTER = ORDER_NO_PREFIXES
  .map((p) => `order_no.like.${p}%`)
  .join(",");

const hasShopifyPrefix = (orderNo: string) =>
  ORDER_NO_PREFIXES.some((p) => orderNo.startsWith(p));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── The one GraphQL selection set ──────────────────────────
// Every mode fetches through this, so there is a single field shape to reason
// about. NOTE: Order.metafields(first:N) is gated on this store (protected
// customer data) and returns a PARSE_ERROR — and orders carry no metafields
// anyway. The delivery date comes from the PRODUCT's shipping_timeline.
const ORDER_FIELDS = `
  id
  name
  createdAt
  cancelledAt
  displayFinancialStatus
  displayFulfillmentStatus
  email
  phone
  note
  tags
  currencyCode
  totalPriceSet         { shopMoney { amount currencyCode } }
  subtotalPriceSet      { shopMoney { amount } }
  totalTaxSet           { shopMoney { amount } }
  totalShippingPriceSet { shopMoney { amount } }
  totalDiscountsSet     { shopMoney { amount } }
  paymentGatewayNames
  billingAddressMatchesShippingAddress
  customer { id firstName lastName email phone }
  shippingAddress { name phone address1 address2 city province provinceCode country zip }
  billingAddress  { name address1 address2 city province country zip }
  customAttributes { key value }
  lineItems(first: 50) {
    edges {
      node {
        id
        title
        quantity
        sku
        variantTitle
        originalUnitPriceSet   { shopMoney { amount } }
        discountedUnitPriceSet { shopMoney { amount } }
        customAttributes { key value }
        variant {
          id
          sku
          selectedOptions { name value }
          product {
            id
            handle
            title
            featuredImage { url }
            topStyle:     metafield(namespace: "custom", key: "top_style")         { value }
            bottomStyle:  metafield(namespace: "custom", key: "bottom_style")      { value }
            shipTimeline: metafield(namespace: "custom", key: "shipping_timeline") { value }
            readyToShip:  metafield(namespace: "custom", key: "ready_to_ship")     { value }
            # Whether the product includes a dupatta, for the ~108 products that
            # have no With/Without-Dupatta Style option (Set products, where it
            # is always included so no choice was ever offered). Not yet
            # populated: until it is, those lines quarantine as DUPATTA_UNKNOWN
            # rather than being guessed from the product name.
            hasDupatta:   metafield(namespace: "custom", key: "has_dupatta")       { value }
          }
        }
      }
    }
  }
`;

/**
 * name → hex from the app's `colors` table, keyed on a normalised name so
 * Shopify's spelling still matches ("Rosepink" → "rosepink" → "Rose Pink").
 *
 * Loaded once per invocation and passed into the mapper, which stays pure.
 * A colour that isn't in the table keeps its NAME with an empty hex — the name
 * is real information from Shopify and belongs on the work order; only the
 * swatch is missing. We never invent a hex.
 */
async function loadColorHexMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data, error } = await supabase.from("colors").select("name, hex");
  if (error) {
    console.error("loadColorHexMap failed (colours will have no hex):", error.message);
    return map;
  }
  for (const c of data || []) {
    if (c?.name && c?.hex) map.set(normalizeColorKey(c.name), c.hex);
  }
  return map;
}

async function shopifyGraphql(query: string) {
  const res = await fetch(SHOPIFY_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(`Shopify GraphQL: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

/**
 * Fetch a page of orders, newest first.
 *
 * `dateField` decides BOTH the filter and the sort, and they must agree:
 *
 *   created_at — the reconcile poll. We want orders PLACED in the window.
 *   updated_at — a catch-up sweep, for orders edited after ingestion.
 *
 * Getting this wrong is subtle and dangerous. Filtering on `updated_at` while
 * sorting by CREATED_AT means an old order that was merely re-touched (a
 * fulfilment, a tag, a payment capture) occupies a slot in the page, and a
 * genuinely NEW order can fall off the end of `first` — silently never
 * ingested. Measured on the live store, a 30-minute `updated_at` window
 * returned orders spanning #26663…#26946 and hit the 50 cap, so the risk was
 * real, not theoretical.
 */
async function fetchOrders(
  first: number,
  sinceIso: string | null,
  dateField: "created_at" | "updated_at" = "created_at",
) {
  const filter = sinceIso ? `, query: "${dateField}:>=${sinceIso}"` : "";
  const sortKey = dateField === "updated_at" ? "UPDATED_AT" : "CREATED_AT";
  const data = await shopifyGraphql(`
    query {
      orders(first: ${first}, sortKey: ${sortKey}, reverse: true${filter}) {
        edges { node { ${ORDER_FIELDS} } }
      }
    }
  `);
  return (data?.orders?.edges || []).map((e: any) => e.node);
}

/** Fetch exactly one order by GID — the webhook path. */
async function fetchOrderById(gid: string) {
  const data = await shopifyGraphql(`
    query { node(id: "${gid}") { ... on Order { ${ORDER_FIELDS} } } }
  `);
  return data?.node || null;
}

// ─── Customer resolution ────────────────────────────────────
//
// orders.user_id → profiles.id is effectively NOT NULL, and profiles.id IS the
// auth.users id, so an unknown web customer needs a real auth user.
//
// Phone-first, matching how the app identifies customers everywhere else
// (OtpVerification looks up profiles by canonical E.164 phone).
async function resolveProfileId(
  phone: string,
  email: string,
  fullName: string
): Promise<string | null> {
  // 1. By phone — the app's canonical identity.
  if (phone) {
    const { data } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("phone", phone)
      .maybeSingle(); // never .single(): it ERRORS on zero rows
    if (data?.id) {
      // Enrich only what's missing. Never overwrite a curated store-customer
      // profile with a guest checkout's typo'd details.
      if (email && !data.email) {
        await supabase.from("profiles").update({ email }).eq("id", data.id);
      }
      return data.id;
    }
  }

  // 2. By email.
  if (email) {
    const { data } = await supabase
      .from("profiles")
      .select("id, phone")
      .eq("email", email)
      .maybeSingle();
    if (data?.id) {
      if (phone && !data.phone) {
        await supabase.from("profiles").update({ phone }).eq("id", data.id);
      }
      return data.id;
    }
  }

  // 3. Create. Needs at least one identifier.
  if (!phone && !email) return null;

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: email || undefined,
    phone: phone || undefined,
    email_confirm: true,
    phone_confirm: true,
  });

  if (createErr || !created?.user?.id) {
    // Most likely cause: a concurrent ingestion just created this same
    // customer (two orders, same new buyer). Re-select rather than failing.
    if (phone) {
      const { data } = await supabase.from("profiles").select("id").eq("phone", phone).maybeSingle();
      if (data?.id) return data.id;
    }
    if (email) {
      const { data } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle();
      if (data?.id) return data.id;
    }
    console.error("resolveProfileId: createUser failed:", createErr?.message);
    return null;
  }

  const id = created.user.id;
  // The profiles row is the app-level record; auth.users alone isn't enough.
  const { error: profErr } = await supabase.from("profiles").insert({
    id,
    full_name: fullName || null,
    phone: phone || null,
    email: email || null,
    created_at: new Date().toISOString(),
  });
  if (profErr) console.error("resolveProfileId: profiles insert failed:", profErr.message);

  return id;
}

// ─── Refresh an order that already exists ───────────────────

/**
 * Payment state moves AFTER the order reaches us. A COD order becomes
 * "COD Confirmed" when GoKwik confirms it; a PENDING order becomes PAID when
 * the customer actually pays. Without this, the dashboard badge means "was
 * unpaid when we received it" and never changes — the order stays PENDING
 * forever even after Shopify says PAID.
 *
 * ─── WHAT THIS DELIBERATELY DOES NOT TOUCH ───────────────────
 * Only fields that are Shopify's to own and that production does not build on.
 * NEVER order_no (printed on physical barcodes — changing it orphans every
 * work order already on the floor), NEVER items (components/barcodes are
 * minted from it, and a Shopify-side product edit must not re-shape an order
 * mid-production), NEVER delivery_date (production schedules to it via T-2),
 * NEVER status/warehouse_stage (derived from order_components by scans, never
 * from Shopify), and NEVER user_id, money or addresses.
 *
 * `remap-items` stays the deliberate, human-triggered way to re-derive items.
 * A refresh is automatic; re-shaping a live order must not be.
 *
 * Returns `already_exists` unchanged when nothing actually differs — the
 * reconcile poll re-presents the same recent orders every 5 minutes, and
 * writing a no-op row 288 times a day would bury the real signal in the audit
 * log and churn the table for nothing.
 */
async function refreshExistingOrder(
  existing: { id: string; order_no?: string; shopify_financial_status?: string | null; shopify_tags?: string[] | null },
  node: any,
  gid: string,
  colorMap?: Map<string, string>,
) {
  const base = { gid, order_no: existing.order_no, id: existing.id };

  let orderRow: any;
  try {
    ({ orderRow } = mapShopifyOrder(node, colorMap));
  } catch {
    // A mapping failure must not turn a harmless duplicate delivery into an
    // error — the order is already safely stored. Fall back to the old answer.
    return { ...base, outcome: "already_exists" };
  }

  const nextStatus = orderRow.shopify_financial_status ?? null;
  const nextTags: string[] = orderRow.shopify_tags || [];
  const prevStatus = existing.shopify_financial_status ?? null;
  const prevTags: string[] = existing.shopify_tags || [];

  const changed: string[] = [];
  if (nextStatus !== prevStatus) changed.push("shopify_financial_status");
  // Compare as a SET: Shopify does not promise tag order, so a merely
  // re-ordered list must not read as a change and trigger a pointless write.
  // Sorted copies compared element-wise -- joining into a single string
  // would make ["ab","c"] and ["a","bc"] compare equal.
  const nextSorted = [...nextTags].sort();
  const prevSorted = [...prevTags].sort();
  const sameTags =
    nextSorted.length === prevSorted.length &&
    nextSorted.every((t, i) => t === prevSorted[i]);
  if (!sameTags) changed.push("shopify_tags");

  if (changed.length === 0) return { ...base, outcome: "already_exists" };

  const { error } = await supabase
    .from("orders")
    .update({
      shopify_financial_status: nextStatus,
      shopify_tags: nextTags,
      // Keep the stored snapshot honest: remap-items replays THIS blob, so a
      // stale one would make a later remap re-apply outdated Shopify data.
      shopify_raw: node,
      // Until now this column meant "first ingested" — ingestOrder returned
      // before ever writing it again. Now it means what its name says.
      shopify_synced_at: new Date().toISOString(),
    })
    .eq("id", existing.id);

  if (error) {
    return { ...base, outcome: "failed", reason: "REFRESH_FAILED", detail: error.message };
  }
  return { ...base, outcome: "refreshed", changed };
}

// ─── Ingest one order ───────────────────────────────────────

/**
 * `refreshOnly` makes this REFRESH-OR-SKIP: an order we do not already have
 * is left alone instead of being created.
 *
 * The refresh sweep queries UPDATED_AT, so its window contains every order
 * Shopify has TOUCHED, including old ones we deliberately never ingested. On
 * a 7-day window that made a single call create 75 orders (46 with barcodes),
 * minting order numbers in FETCH order so a June order got an August number,
 * and surfacing long-shipped garments as overdue production work.
 *
 * Ingestion already has two paths that are supposed to create orders: the
 * webhook and the reconcile poll, both keyed on CREATED_AT. A freshness sweep
 * has no business minting anything.
 */
async function ingestOrder(
  node: any,
  colorMap?: Map<string, string>,
  refreshOnly = false,
) {
  const gid = String(node?.id || "");
  if (!gid) return { gid: "", outcome: "skipped", reason: "no id" };

  // ── Idempotency FIRST, before minting an order number.
  // The order-number sequence is a single GLOBAL counter. Generating before
  // this check would burn a number on every duplicate webhook delivery,
  // leaving gaps that read as deleted orders in an audit.
  //
  // The payment columns come back too so refreshExistingOrder can diff without
  // a second round trip.
  const { data: existing } = await supabase
    .from("orders")
    .select("id, order_no, shopify_financial_status, shopify_tags")
    .eq("shopify_order_id", gid)
    .maybeSingle();
  if (existing?.id) {
    // Known order: refresh the fields Shopify owns rather than skipping. This
    // is what makes an orders/updated webhook and the refresh sweep do anything
    // at all — previously both re-fetched live data and threw it away.
    return await refreshExistingOrder(existing as any, node, gid, colorMap);
  }

  // Unknown order on a refresh sweep: NOT ours to create. See the docblock.
  if (refreshOnly) {
    return { gid, outcome: "skipped", reason: "NOT_INGESTED" };
  }

  const { orderRow, blockers } = mapShopifyOrder(node, colorMap);

  // ── Customer
  const userId = await resolveProfileId(
    String(orderRow.delivery_phone || ""),
    String(orderRow.delivery_email || ""),
    String(orderRow.delivery_name || "")
  );
  if (!userId) {
    // orders.user_id is NOT NULL — without a profile we cannot write the row
    // at all. Report it rather than silently dropping a paid order.
    return {
      gid,
      outcome: "failed",
      reason: "CUSTOMER_UNRESOLVED",
      detail: "No phone/email on the order, or profile creation failed",
    };
  }

  // ── Order number. 'Shopify' → SB-SHOPIFY-MMYY-NNNNNN
  // (db/barcode_system/v2/55_shopify_prefix_rename.sql).
  const { data: orderNo, error: rpcErr } = await supabase.rpc("generate_order_no", {
    p_store: SHOPIFY_STORE_KEY,
  });
  if (rpcErr || !orderNo) {
    return { gid, outcome: "failed", reason: "ORDER_NO_FAILED", detail: rpcErr?.message };
  }
  if (!hasShopifyPrefix(String(orderNo))) {
    // The generate_order_no 'Shopify' branch is missing, so this fell through
    // to GEN. GEN is not in CHANNEL_BY_ORDER_PREFIX, so the order would report
    // as STORE revenue forever. Refuse to write rather than corrupt reporting.
    return {
      gid,
      outcome: "failed",
      reason: "CHANNEL_PREFIX_MISSING",
      detail: `generate_order_no('Shopify') returned ${orderNo} — apply db/barcode_system/v2/55_shopify_prefix_rename.sql`,
    };
  }

  const row = {
    ...orderRow,
    order_no: orderNo,
    user_id: userId,
    shopify_synced_at: new Date().toISOString(),
    shopify_raw: node,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("orders")
    .insert(row)
    .select("id, order_no, web_order_status")
    .single();

  if (insertErr) {
    // 23505 = unique violation on shopify_order_id: a concurrent delivery won
    // the race. That is success, not an error.
    if ((insertErr as any).code === "23505") {
      const { data: winner } = await supabase
        .from("orders")
        .select("id, order_no, shopify_financial_status, shopify_tags")
        .eq("shopify_order_id", gid)
        .maybeSingle();
      // Refresh here too, for the same reason as the pre-check above: the
      // winner may have been written from a slightly older Shopify node than
      // the one we are holding.
      if (winner?.id) {
        return await refreshExistingOrder(winner as any, node, gid, colorMap);
      }
      return { gid, outcome: "already_exists", order_no: winner?.order_no, id: winner?.id };
    }
    return { gid, outcome: "failed", reason: "INSERT_FAILED", detail: insertErr.message };
  }

  // ── Components (the scannable pieces). Only for orders that mapped cleanly:
  // a needs_review order is missing the garment breakdown, and minting from
  // that would produce a single mislabelled barcode for what may be a
  // multi-piece garment. Those mint on approval instead.
  let componentCount = 0;
  if (inserted.web_order_status !== "needs_review") {
    componentCount = await ensureComponents({ ...row, id: inserted.id });
  }

  return {
    gid,
    outcome: "inserted",
    id: inserted.id,
    order_no: inserted.order_no,
    web_order_status: inserted.web_order_status,
    components: componentCount,
    blockers: blockers.length ? blockers : undefined,
  };
}

/**
 * Mint order_components for an order, idempotently.
 *
 * Mirrors ensureOrderComponents() in barcodeService.js: a no-op when rows
 * already exist, so it is safe against webhook retries, a re-run of the
 * reconcile poll, and manual re-approval.
 *
 * Components are inserted INACTIVE — a Production Head activates them through
 * the activate_components RPC, exactly like every other channel.
 */
async function ensureComponents(order: any): Promise<number> {
  // Count rather than limit(1): the caller reports this number, and a
  // truncated "1" for an already-minted order reads as though components were
  // lost. `head: true` fetches no rows.
  const { count, error: checkErr } = await supabase
    .from("order_components")
    .select("id", { count: "exact", head: true })
    .eq("order_id", order.id);
  if (checkErr) {
    console.error("ensureComponents: check failed", checkErr.message);
    return 0;
  }
  if ((count || 0) > 0) return count as number;

  const components = buildOrderComponents(order);
  if (components.length === 0) return 0;

  const { data, error } = await supabase
    .from("order_components")
    .insert(components)
    .select("id");
  if (error) {
    // Non-fatal: the order itself is already saved and correct. Losing the
    // components is recoverable (re-run the sync); losing the order is not.
    console.error(`ensureComponents: insert failed for ${order.order_no}`, error.message);
    return 0;
  }
  return data?.length || 0;
}

// ─── Webhook verification ───────────────────────────────────

/**
 * Verify Shopify's HMAC over the RAW request body.
 *
 * Must run on the exact bytes Shopify signed — re-serialising a parsed object
 * changes key order and whitespace and the signature will never match. Uses a
 * timing-safe comparison so a wrong signature leaks nothing about the right one.
 */
async function verifyShopifyHmac(rawBody: string, header: string | null): Promise<boolean> {
  if (!header || !SHOPIFY_WEBHOOK_SECRET) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SHOPIFY_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

/** Best-effort audit row. Never throws — logging must not break ingestion. */
async function logSync(entry: Record<string, unknown>) {
  const { error } = await supabase.from("shopify_sync_log").insert(entry);
  if (error) console.error("shopify_sync_log insert failed:", error.message);
}

// ─── HTTP ───────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!SHOPIFY_ACCESS_TOKEN) throw new Error("SHOPIFY_ACCESS_TOKEN not configured");

    // Read the body ONCE as text — the webhook path needs the raw bytes for
    // HMAC, and a Request body can only be consumed a single time.
    const rawBody = await req.text();
    let body: any = {};
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      /* empty or non-JSON body is fine for the manual modes */
    }

    // ── WEBHOOK. Shopify sends its own payload shape (REST-ish, no `mode`),
    // identified by the HMAC header. We treat it as a TRIGGER ONLY: take the
    // order id and re-fetch that order through the same GraphQL query every
    // other mode uses, so there is one field shape to reason about and no
    // REST/GraphQL drift.
    const hmacHeader = req.headers.get("X-Shopify-Hmac-Sha256");
    if (hmacHeader) {
      const topic = req.headers.get("X-Shopify-Topic") || "unknown";

      if (!await verifyShopifyHmac(rawBody, hmacHeader)) {
        // 401 and stop. Do not process unverified payloads.
        await logSync({ mode: `webhook:${topic}`, outcome: "rejected", error: "HMAC verification failed" });
        return json({ success: false, error: "HMAC verification failed" }, 401);
      }

      // Shopify's REST payload carries a numeric id; GraphQL wants the GID.
      const numericId = body?.admin_graphql_api_id || body?.id;
      const gid = String(numericId || "").startsWith("gid://")
        ? String(numericId)
        : `gid://shopify/Order/${numericId}`;

      if (!numericId) {
        await logSync({ mode: `webhook:${topic}`, outcome: "failed", error: "no order id in payload" });
        return json({ success: true, note: "no order id — ignored" });
      }

      try {
        const colorMap = await loadColorHexMap();
        const node = await fetchOrderById(gid);
        if (!node) {
          await logSync({ shopify_order_id: gid, mode: `webhook:${topic}`, outcome: "failed", error: "order not found on re-fetch" });
          return json({ success: true, note: "order not found" });
        }
        const result = await ingestOrder(node, colorMap);
        await logSync({
          shopify_order_id: gid,
          mode: `webhook:${topic}`,
          outcome: result.outcome,
          error: (result as any).detail || null,
        });
        return json({ success: true, mode: `webhook:${topic}`, result });
      } catch (e) {
        // Answer 200 even on a mapping failure. Shopify retries any non-2xx
        // for ~48h, and a PERMANENT failure would just generate two days of
        // retry noise. The reconcile poll is the real safety net, and the log
        // row above makes the failure visible.
        await logSync({ shopify_order_id: gid, mode: `webhook:${topic}`, outcome: "failed", error: (e as Error).message });
        console.error(`webhook ${topic} failed for ${gid}:`, (e as Error).message);
        return json({ success: false, handled: true, error: (e as Error).message });
      }
    }

    const mode = body?.mode || "sync-now";
    const dryRun = body?.dryRun === true;

    // Reject an unrecognised mode rather than silently falling through to
    // sync-now. The default is a REAL ingest, so a typo'd or made-up mode
    // would quietly write live orders — which is exactly what a caller
    // experimenting with an unknown mode does not expect.
    const KNOWN_MODES = [
      "sync-now", "order", "reconcile", "refresh", "remap-items", "backfill-components",
    ];
    if (!KNOWN_MODES.includes(mode)) {
      return json({
        success: false,
        error: `Unknown mode "${mode}". Expected one of: ${KNOWN_MODES.join(", ")}`,
      }, 400);
    }

    // ── backfill-components: mint components for website orders that were
    // ingested before component minting existed. Idempotent, so it is safe to
    // re-run; it touches no Shopify API at all.
    if (mode === "backfill-components") {
      const { data: rows, error } = await supabase
        .from("orders")
        .select("id, order_no, items, web_order_status")
        .or(ORDER_NO_PREFIX_FILTER)
        .neq("web_order_status", "needs_review")
        .order("created_at", { ascending: true });
      if (error) throw error;

      const out = [];
      for (const o of rows || []) {
        const n = await ensureComponents(o);
        out.push({ order_no: o.order_no, components: n });
      }
      return json({
        success: true,
        mode,
        orders: out.length,
        components: out.reduce((s, r) => s + r.components, 0),
        results: out,
      });
    }

    // Colour name → hex, loaded once and shared by every order in this run.
    const colorMap = await loadColorHexMap();

    // ── remap: re-run the mapper over shopify_raw for orders already ingested,
    // and rewrite items[]. Uses the STORED raw node, so it touches no Shopify
    // API and cannot change money, dates or identity — only the derived item
    // fields. For rolling out a mapper fix (e.g. colours as {hex,name}) without
    // deleting and re-ingesting.
    if (mode === "remap-items") {
      const { data: rows, error } = await supabase
        .from("orders")
        .select("id, order_no, shopify_raw")
        .or(ORDER_NO_PREFIX_FILTER)
        .not("shopify_raw", "is", null)
        .order("created_at", { ascending: true });
      if (error) throw error;

      const out = [];
      for (const o of rows || []) {
        const { orderRow, items } = mapShopifyOrder(o.shopify_raw, colorMap);

        // Re-derive the REVIEW STATE too, not just items[]. A mapper fix can
        // newly discover that something is unknown (e.g. DUPATTA_UNKNOWN), and
        // leaving a stale 'ready' would let an order enter production on data
        // we no longer trust.
        //
        // shopify_order_name comes along so this mode also backfills Shopify's
        // own order number onto orders ingested before that column existed —
        // from the STORED raw node, with no Shopify call. (55_…sql backfills it
        // too; both are idempotent, so either or both is fine.)
        const { error: upErr } = await supabase
          .from("orders")
          .update({
            items,
            shopify_order_name: orderRow.shopify_order_name,
            // Payment state Shopify already told us, backfilled from the same
            // stored raw node. Still no Shopify call, and still no money —
            // these are order-state strings, not amounts. See
            // 64_shopify_payment_fields.sql.
            shopify_financial_status: orderRow.shopify_financial_status,
            shopify_tags: orderRow.shopify_tags,
            web_order_status: orderRow.web_order_status,
            web_order_issues: orderRow.web_order_issues,
          })
          .eq("id", o.id);

        out.push({
          order_no: o.order_no,
          items: items.length,
          status: orderRow.web_order_status,
          ...(upErr ? { error: upErr.message } : {}),
        });
      }

      const flagged = out.filter((r) => r.status === "needs_review").length;
      return json({ success: true, mode, orders: out.length, flagged, results: out });
    }

    // Gather the orders to process.
    let nodes: any[] = [];
    if (mode === "order") {
      if (!body?.id) throw new Error("mode 'order' requires { id }");
      const node = await fetchOrderById(String(body.id));
      if (node) nodes = [node];
    } else if (mode === "reconcile") {
      // Orders PLACED in the window — created_at, not updated_at. See
      // fetchOrders: filtering on updated_at while sorting by CREATED_AT lets
      // a re-touched old order push a genuinely new one off the page.
      const mins = Number(body?.sinceMinutes) || 30;
      const since = new Date(Date.now() - mins * 60_000).toISOString();
      nodes = await fetchOrders(Math.min(Number(body?.first) || 50, 100), since, "created_at");
    } else if (mode === "refresh") {
      // Orders TOUCHED in the window — updated_at, and fetchOrders sorts by
      // UPDATED_AT to match. This is the catch-up sweep the fetchOrders
      // docblock describes: a payment captured hours after checkout never
      // re-enters a created_at window, so reconcile can never see it.
      //
      // Kept as a SEPARATE mode from reconcile on purpose. Reconcile's job is
      // "no placed order is ever lost"; an updated_at filter there would let a
      // re-touched old order occupy a page slot and push a genuinely NEW order
      // off the end — measured on the live store, not theoretical. Two modes,
      // two windows, no interference.
      const mins = Number(body?.sinceMinutes) || 1440; // 24h
      const since = new Date(Date.now() - mins * 60_000).toISOString();
      nodes = await fetchOrders(Math.min(Number(body?.first) || 100, 100), since, "updated_at");
    } else {
      // sync-now
      const days = Number(body?.sinceDays) || 0;
      const since = days > 0 ? new Date(Date.now() - days * 86_400_000).toISOString() : null;
      nodes = await fetchOrders(Math.min(Number(body?.first) || 25, 100), since);
    }

    // Dry run: map only, write nothing. For verifying the mapping against real
    // orders before letting anything touch the database.
    if (dryRun) {
      const preview = nodes.map((n) => {
        const { orderRow, items, blockers } = mapShopifyOrder(n, colorMap);
        return {
          shopify_name: n?.name,
          shopify_order_id: orderRow.shopify_order_id,
          delivery_date: orderRow.delivery_date,
          delivery_name: orderRow.delivery_name,
          // The two a dry-run `refresh` is actually about.
          shopify_financial_status: orderRow.shopify_financial_status,
          shopify_tags: orderRow.shopify_tags,
          payment_mode: orderRow.payment_mode,
          grand_total: orderRow.grand_total,
          advance_payment: orderRow.advance_payment,
          remaining_payment: orderRow.remaining_payment,
          web_order_status: orderRow.web_order_status,
          blockers,
          items: items.map((i: any) => ({
            product_name: i.product_name,
            top: i.top,
            bottom: i.bottom,
            includes_dupatta: i.includes_dupatta,
            size: i.size,
            color: i.color,
            quantity: i.quantity,
            price: i.price,
          })),
        };
      });
      return json({ success: true, mode, dryRun: true, count: preview.length, preview });
    }

    // A refresh sweep must never CREATE an order -- its updated_at window is
    // full of old orders we never ingested. See the ingestOrder docblock.
    const refreshOnly = mode === "refresh";

    const results = [];
    for (const node of nodes) {
      try {
        results.push(await ingestOrder(node, colorMap, refreshOnly));
      } catch (e) {
        results.push({ gid: node?.id, outcome: "failed", detail: (e as Error).message });
      }
    }

    const summary = results.reduce((acc: Record<string, number>, r: any) => {
      acc[r.outcome] = (acc[r.outcome] || 0) + 1;
      return acc;
    }, {});

    // Log only what the polls actually CHANGED. Both run on a schedule and
    // almost always find nothing to do (reconcile: the webhook got there first;
    // refresh: most orders' payment state is settled), so logging every run
    // would bury the real signal under thousands of no-op rows.
    //
    // `already_exists` is deliberately never logged — for refresh that is the
    // overwhelmingly common outcome and means "checked, nothing moved".
    if (mode === "reconcile" || mode === "refresh") {
      for (const r of results as any[]) {
        if (r.outcome === "inserted" || r.outcome === "refreshed" || r.outcome === "failed") {
          await logSync({
            shopify_order_id: r.gid,
            mode,
            outcome: r.outcome,
            // On a refresh, record WHICH fields moved — that is the whole
            // audit value ("this order went PENDING -> PAID at 14:02").
            error: r.detail || (r.changed ? `changed: ${r.changed.join(", ")}` : null),
          });
        }
      }
    }

    return json({ success: true, mode, fetched: nodes.length, summary, results });
  } catch (error) {
    return json({ success: false, error: (error as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
