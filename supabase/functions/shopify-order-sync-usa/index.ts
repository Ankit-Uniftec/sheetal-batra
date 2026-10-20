import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildOrderComponents,
  mapShopifyOrder,
  normalizeColorKey,
  setDeliveryDays,
  setStoreTimezone,
  SHOPIFY_STORE_KEY,
} from "./mapper.ts";

// ============================================================
// shopify-order-sync-usa — the SHOPIFY USA store (Release 19, point 36).
//
// A COPY of shopify-order-sync (the India store) with only the store-specific
// parts changed, so the India function never has to be edited or redeployed:
//   * store sheetal-batra-usa.myshopify.com
//   * access token obtained from the Dev Dashboard app's Client ID + secret
//     (client-credentials grant), renewed before it expires
//   * webhook signature: SHOPIFY_USA_WEBHOOK_SECRET, else the app's Client
//     secret (webhooks registered by the app are signed with it)
//   * only the ingest modes: sync-now / order / reconcile / refresh. The India
//     maintenance modes (backfill / remap / restate / redate) are NOT here —
//     they scan every Shopify order in our table, India's included.
//   * mapper.ts: shopify_store 'usa', the store-local placement time,
//     delivery date from custom.shipping_timeline, phone kept as Shopify gives it.
// US orders take the normal SB-SHOPIFY- numbers (same sequence) so every
// dashboard, scan and report treats them as website orders; orders.shopify_store
// tells the two stores apart.
//
// Original India header follows.
// ------------------------------------------------------------
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
//   { mode: "refresh",   sinceMinutes?, first?, after? } catch-up sweep on
//                                               updated_at; pass the response's
//                                               nextCursor back as `after` to page
//   { mode: "refresh-raw", limit?, dryRun? }    re-fetch orders whose STORED
//                                               snapshot predates a query
//                                               change, so remap-items has the
//                                               new fields to replay. Driven
//                                               off our table, not a window.
//   { mode: "remap-items" }                     re-run the mapper over stored
//                                               shopify_raw (no Shopify call)
//   { mode: "backfill-components" }             mint components for older rows
//   { mode: "backfill-cancelled", live?, limit? }
//                                               settle orders cancelled on
//                                               Shopify before the sync read
//                                               cancelledAt. Reads the STORED
//                                               shopify_raw (no Shopify call);
//                                               live:true asks Shopify per
//                                               unsettled order instead, which
//                                               catches cancellations whose
//                                               snapshot was never rewritten.
//                                               live is batched (limit, default
//                                               50) — re-run while `remaining`
//                                               is non-zero. SILENT by default;
//                                               notify:true also fires the
//                                               Order Cancelled bell per order.
//   Add "dryRun": true to any pull mode to map without writing.
//
// Secrets (Supabase function config):
//   SHOPIFY_ACCESS_TOKEN    Admin API token (read_orders, read_products)
//   SHOPIFY_WEBHOOK_SECRET  webhook signing secret, from the Shopify admin
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Dev Dashboard app credentials for the US store. Never sent to the browser.
const SHOPIFY_USA_CLIENT_ID = Deno.env.get("SHOPIFY_USA_CLIENT_ID") || "";
const SHOPIFY_USA_CLIENT_SECRET = Deno.env.get("SHOPIFY_USA_CLIENT_SECRET") || "";
// Webhook signing secret. Webhooks created in the admin (Settings →
// Notifications → Webhooks) show their own secret; webhooks registered by the
// app are signed with the app's Client secret. Without either the webhook path
// rejects every request rather than trusting unverified payloads.
const SHOPIFY_WEBHOOK_SECRET =
  Deno.env.get("SHOPIFY_USA_WEBHOOK_SECRET") || SHOPIFY_USA_CLIENT_SECRET;

const SHOPIFY_STORE = "sheetal-batra-usa.myshopify.com";
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

// PostgREST silently caps every response at 1000 rows. Every full-set read of
// Shopify orders goes through this — past 1000 orders an unpaged read dropped
// the NEWEST ones (they sort last), so backfill-cancelled never saw #29303.
// Same contract as src/utils/fetchAllRows.js. The trailing id order keeps
// pages stable when created_at ties.
async function fetchAllRows(table: string, buildQuery: (q: any) => any) {
  const PAGE_SIZE = 1000;
  const all: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(supabase.from(table))
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    all.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return { data: all, error: null };
  }
}

// ─── Cancellation signal ────────────────────────────────────
// Two ways an order is dead on Shopify. The real one is `cancelledAt`. The
// other is a TAG: the COD-verification flow marks a refused COD order
// "order_cancelled(OL)" and never presses Cancel, so cancelledAt stays null
// and the order sat in the work queue as live COD (#29303). The tag carries no
// timestamp, so cancelled_at becomes the moment we first saw it.
// Mirrored in cancelled.test.mjs.
const CANCEL_TAG_RE = /^order_cancelled\b/i;

function shopifyCancellation(
  cancelledAt: string | null | undefined,
  tags: unknown,
): { at: string; reason: string } | null {
  if (cancelledAt) return { at: cancelledAt, reason: "Cancelled on Shopify" };
  const tag = (Array.isArray(tags) ? tags : [])
    .map((t) => String(t).trim())
    .find((t) => CANCEL_TAG_RE.test(t));
  if (tag) return { at: new Date().toISOString(), reason: `Cancelled on Shopify (tag: ${tag})` };
  return null;
}

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
        # Does this line represent something PHYSICALLY SHIPPED?
        #
        # THE signal that separates a garment from a service charge. The store
        # sells customisations ("Neck and size customisation", "Sleeves
        # customisation") as their own lines priced in tens of thousands; those
        # carry requiresShipping:false and Shopify groups them under "Shipping
        # not required" in the admin. Verified on #27567 — garment true, both
        # customisations false — and true on 14 garment lines across other orders.
        #
        # Read on the LINE ITEM, not the variant: these lines have variant:null
        # (no product behind them), so a variant-level read finds nothing on
        # exactly the lines that need it. It is also the value captured AT
        # CHECKOUT, so editing the product later cannot retroactively change what
        # the customer ordered.
        requiresShipping
        variant {
          id
          sku
          selectedOptions { name value }
          product {
            id
            handle
            title
            featuredImage { url }
            # Shopify standard-taxonomy category, e.g.
            # "Apparel & Accessories > Clothing > Traditional & Ceremonial Clothing".
            # THE delivery-date signal: category x price band -> days, per the
            # client's matrix (see resolveDeliveryDate in mapper.ts). Null on
            # ~25% of the live catalogue, which flags those orders as
            # DELIVERY_DATE_UNRESOLVED until the category is set in Shopify.
            category { fullName }
            # Product TAGS. The catalogue team marks dupatta inclusion here
            # ("WITH DUPATTA" / "WITHOUT DUPATTA") on products that have no
            # With/Without-Dupatta Style option — the Set products that would
            # otherwise quarantine as DUPATTA_UNKNOWN. Read as a fallback in
            # resolveDupatta; see the resolution order there.
            tags
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

/**
 * Delivery days by price band. Client-owned numbers, kept in a table so
 * revising them is an UPDATE rather than a redeploy.
 *
 * Category is NOT read: per the client, the delivery date depends on the order
 * AMOUNT only. The table keeps one row (category = '*') holding the six band
 * values.
 *
 * On ANY failure — table missing, RLS, empty — the mapper keeps its identical
 * hardcoded copy. That is a genuine equivalent, not a degraded guess, so a
 * missing table cannot silently change a single delivery date.
 */
async function loadDeliveryMatrix(): Promise<void> {
  const { data, error } = await supabase
    .from("shopify_delivery_matrix")
    .select("category, d10_25k, d25_40k, d40_75k, d75k_150k, d150k_200k, d200k_up")
    .eq("category", "*")
    .maybeSingle();
  if (error) {
    console.error(
      "loadDeliveryMatrix failed (using built-in days):",
      error.message,
    );
    return;
  }
  if (!data) return; // no '*' row yet — keep the built-in days
  setDeliveryDays([
    data.d10_25k,
    data.d25_40k,
    data.d40_75k,
    data.d75k_150k,
    data.d150k_200k,
    data.d200k_up,
  ]);
}

// ─── Access token (client-credentials grant) ────────────────
// The Dev Dashboard app has no permanent token: the Client ID + secret are
// exchanged for a short-lived one. Kept in memory for the life of this
// function instance and renewed 5 minutes before it expires.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 5 * 60_000) {
    return cachedToken.value;
  }
  const res = await fetch(`https://${SHOPIFY_STORE}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: SHOPIFY_USA_CLIENT_ID,
      client_secret: SHOPIFY_USA_CLIENT_SECRET,
    }),
  });
  const text = await res.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* reported below */ }
  if (!res.ok || !body?.access_token) {
    // Never echo the request (it carries the secret) — only Shopify's answer.
    throw new Error(`Shopify USA token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const ttlSeconds = Number(body.expires_in) || 3600;
  cachedToken = { value: body.access_token, expiresAt: Date.now() + ttlSeconds * 1000 };
  return cachedToken.value;
}

// The store's own time zone (e.g. America/New_York), read from Shopify once per
// instance, so the placement time and delivery date follow the US calendar.
let storeTimezoneLoaded = false;
async function loadStoreTimezone(): Promise<void> {
  if (storeTimezoneLoaded) return;
  const data = await shopifyGraphql(`{ shop { ianaTimezone } }`);
  setStoreTimezone(String(data?.shop?.ianaTimezone || ""));
  storeTimezoneLoaded = true;
}

async function shopifyGraphql(query: string) {
  const res = await fetch(SHOPIFY_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": await getAccessToken(),
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
  after: string | null = null,
) {
  const filter = sinceIso ? `, query: "${dateField}:>=${sinceIso}"` : "";
  const cursor = after ? `, after: ${JSON.stringify(after)}` : "";
  const sortKey = dateField === "updated_at" ? "UPDATED_AT" : "CREATED_AT";
  const data = await shopifyGraphql(`
    query {
      orders(first: ${first}, sortKey: ${sortKey}, reverse: true${filter}${cursor}) {
        edges { node { ${ORDER_FIELDS} } }
        pageInfo { hasNextPage endCursor }
      }
    }
  `);
  const nodes = (data?.orders?.edges || []).map((e: any) => e.node);
  // Returned so a wide manual sweep can page past `first` by passing it back
  // as { after }. Null when the window is exhausted.
  const pi = data?.orders?.pageInfo;
  return { nodes, nextCursor: pi?.hasNextPage ? pi.endCursor : null };
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
 * Is the STORED snapshot missing fields the query now asks for?
 *
 * `shopify_raw` is what `remap-items` replays, so a snapshot captured before a
 * query change cannot answer questions the mapper has since learned to ask. The
 * product-tag dupatta signal is exactly that case: every order ingested before
 * `tags` was added to ORDER_FIELDS stores product nodes with no `tags` key, and
 * re-mapping them just re-quarantines them as DUPATTA_UNKNOWN.
 *
 * Detected STRUCTURALLY — "does the product node have a tags key at all" — not
 * by comparing values. An absent key means the field was never fetched; an
 * empty array means Shopify was asked and said "no tags". Those are different,
 * and only the first is staleness.
 *
 * Deliberately NOT a deep diff of the whole blob. Shopify re-serialises nodes
 * with incidental churn, so a blanket comparison would rewrite every order on
 * every sweep — the write amplification the change-detection exists to prevent.
 */
function rawIsStale(storedRaw: any): boolean {
  const edges = storedRaw?.lineItems?.edges;
  if (!Array.isArray(edges) || edges.length === 0) return false;
  return edges.some((e: any) => {
    // LINE-ITEM level first, and before the product bail-out below.
    //
    // requiresShipping is what separates a garment from a customisation charge,
    // and it lives on the line item — the charge lines have variant:null, so
    // every product-level test below returns early on exactly the lines this
    // needs to catch. Checking it here is what lets a pre-existing order like
    // #27567 be re-fetched at all; without it `refresh` reports "not stale",
    // skips the order, and the charge fix can never reach stored data.
    //
    // Absent KEY, same discipline as the product checks: `false` is Shopify
    // answering "not shipped", absent is us never having asked.
    if (!("requiresShipping" in (e?.node || {}))) return true;

    const product = e?.node?.variant?.product;
    // No product node at all (deleted product, or a non-shipped charge line)
    // tells us nothing more about the snapshot's age — don't call that stale or
    // it never stops refreshing.
    if (!product) return false;
    // Absent KEY, not an empty value: a product with no tags still has the
    // "tags" key once the query asked for it. Both keys are checked because
    // each was added to ORDER_FIELDS separately — a snapshot may carry tags
    // (dupatta work) but predate category (delivery-date matrix).
    return !("tags" in product) || !("category" in product);
  });
}

/**
 * Have a product's TAGS changed in Shopify since the snapshot was stored?
 *
 * The companion to rawIsStale, for the staleness it cannot see: rawIsStale only
 * ever inspects the STORED blob, so it can detect an absent key but never a
 * changed value. This one compares stored against the fresh node.
 *
 * Why tags specifically: they carry the dupatta signal ("WITH DUPATTA") and the
 * accessory signal ("Odhanis/Dupattas"), the two product fields that decide
 * which barcodes get minted. A tag added AFTER ingest is invisible to every
 * recovery mode — the key is present, so refresh-raw says "not stale", and
 * remap-items replays the pre-tag blob and re-derives "no dupatta" forever.
 * Seen live on 6 orders whose product was tagged after the order came in.
 *
 * Compared as a SET per product id, for the same reason as the order-tag diff
 * above: Shopify does not promise tag order, and a re-ordered list must not read
 * as a change and churn the table on every reconcile poll.
 *
 * Only products present in BOTH is a deliberate choice: a line whose product
 * appears or disappears is a line-item change, which rawIsStale and the
 * items-level paths already own.
 */
function productTagsChanged(storedRaw: any, node: any): boolean {
  const tagsById = (raw: any): Map<string, string> => {
    const m = new Map<string, string>();
    for (const e of raw?.lineItems?.edges || []) {
      const p = e?.node?.variant?.product;
      // Absent key is rawIsStale's job, not ours — skip rather than treat the
      // missing list as an empty one, which would read as a change every run.
      if (!p?.id || !Array.isArray(p.tags)) continue;
      m.set(String(p.id), [...p.tags].map(String).sort().join("\n"));
    }
    return m;
  };
  const before = tagsById(storedRaw);
  if (before.size === 0) return false;
  const after = tagsById(node);
  for (const [id, sig] of before) {
    const now = after.get(id);
    if (now !== undefined && now !== sig) return true;
  }
  return false;
}

/**
 * Fire the Order Cancelled (#21) notification for an order Shopify killed.
 *
 * Mirrors the in-app cancel paths (OrderHistory.jsx:701-715 is the reference)
 * so a Shopify cancellation reaches the same people, through the same tables,
 * as one cancelled by hand:
 *   • Production Manager — the static recipient for this type
 *     (notificationService.js RECIPIENT_MAP, ORDER_CANCELLED)
 *   • the CHANNEL-CORRECT production head, resolved per order via
 *     get_production_head_email (14_production_head_resolver.sql). For a
 *     website order that is the Online Production Head — which is exactly why
 *     the head is resolved rather than hardcoded.
 *
 * Written out longhand rather than importing notificationService: that module
 * is browser JS built on the anon client, and this is Deno on the service-role
 * key. The shape below matches insertNotification in notification-scheduler.
 *
 * NEVER throws. A notification failure must not roll back or block the
 * cancellation itself — the status write is the thing that matters, and an
 * order silently left live because the bell failed is the worse outcome.
 *
 * NO WhatsApp to the customer, deliberately: Shopify sends its own cancellation
 * email at the moment of cancelling, and a second message from us would be a
 * duplicate that can disagree with theirs. The in-app paths message the client
 * because nothing else does; here something already has.
 */
async function notifyOrderCancelled(order: {
  id: string;
  order_no?: string;
  delivery_name?: string | null;
}) {
  try {
    const recipients: any[] = [];

    // Static: Production Manager. ilike so a designation stored with different
    // casing/spacing still matches — same lookup notificationService does.
    const { data: pms } = await supabase
      .from("salesperson")
      .select("email, designation")
      .ilike("designation", "%Production Manager%");
    for (const pm of pms || []) {
      if (!pm?.email) continue;
      recipients.push({
        recipient_role: "production_manager",
        recipient_email: String(pm.email).toLowerCase(),
        recipient_designation: pm.designation,
        channel: "in_app",
      });
    }

    // Dynamic: the head who owns THIS order's channel.
    try {
      const { data: headEmail } = await supabase.rpc("get_production_head_email", {
        p_order_id: order.id,
      });
      if (headEmail) {
        recipients.push({
          recipient_role: "production_head",
          recipient_email: String(headEmail).toLowerCase(),
          recipient_designation: null,
          channel: "in_app",
        });
      }
    } catch {
      // Non-fatal: the PM still gets it from the static lookup above.
    }

    if (recipients.length === 0) return;

    const { data: notification, error: notifErr } = await supabase
      .from("notifications")
      .insert({
        type: "order_cancelled",
        title: "Order Cancelled",
        // Same wording as the TEMPLATES entry in notificationService.js, so
        // Shopify and in-app cancellations read identically in the bell.
        message: `Cancelled — ${order.order_no || ""}`,
        order_id: order.id,
        order_no: order.order_no || "",
        priority: "urgent",
        attachments: [],
        metadata: {
          client_name: order.delivery_name || null,
          source: "shopify",
          cancelled_by: "Shopify",
        },
        sent: true,
        sent_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (notifErr || !notification) {
      console.error("cancel notification insert failed:", notifErr?.message);
      return;
    }

    // Dedupe by email: the Production Manager and the resolved head can be the
    // same person, and two bells for one cancellation reads like two orders.
    const seen = new Set<string>();
    const rows = recipients
      .filter((r) => {
        if (seen.has(r.recipient_email)) return false;
        seen.add(r.recipient_email);
        return true;
      })
      .map((r) => ({ ...r, notification_id: notification.id }));

    const { error: recipErr } = await supabase
      .from("notification_recipients")
      .insert(rows);
    if (recipErr) console.error("cancel recipients insert failed:", recipErr.message);
  } catch (e) {
    console.error("notifyOrderCancelled failed (cancellation still written):", (e as Error).message);
  }
}

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
 * NEVER warehouse_stage (derived from order_components by scans, never from
 * Shopify), and NEVER user_id, money or addresses.
 *
 * ─── CANCELLATION IS THE ONE EXCEPTION, AND ONLY ONE WAY ─────
 * `status` is otherwise scan-derived and Shopify has no say in it: the ladder
 * order_received → in production → completed is answered by the floor, not the
 * storefront. Cancellation is the single state Shopify genuinely OWNS — the
 * customer or the store cancelled there, and no scan will ever tell us.
 *
 * Without this, a Shopify cancellation reached us as a REFUND on
 * shopify_financial_status and nothing else. The dashboard reads that as "no
 * longer awaiting payment" and moved the order OUT of Needs Review and INTO the
 * work queue — a cancelled order sitting in the cut list, still offering "Mark
 * as Completed", its barcodes still scanning clean at every station.
 *
 * ONE-WAY on purpose. Shopify can un-cancel an order; we do not follow that
 * back. Reviving an order into production is a decision with physical
 * consequences (cloth, machine time, a delivery date already missed) and it
 * belongs to a human, not to an hourly sweep. Un-cancel by hand if it happens.
 *
 * No inventory is restored here, and that is deliberate rather than an
 * omission: restoreOrderInventory (src/utils/restoreOrderInventory.js:31) bails
 * out on Shopify-channel orders entirely, because Shopify decremented its own
 * stock at checkout and restocks its own cancellations. Adding a restore here
 * would push a second increase and inflate the storefront.
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
  existing: {
    id: string;
    order_no?: string;
    status?: string | null;
    delivery_name?: string | null;
    shopify_financial_status?: string | null;
    shopify_tags?: string[] | null;
    shopify_raw?: any;
  },
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

  // A snapshot that predates a query change must be rewritten even when the
  // payment state is identical. Without this the fresh node is fetched, found
  // "unchanged", and thrown away — leaving remap-items replaying a blob that
  // can never answer the new question.
  //
  // Two kinds of staleness, and only the first is structural:
  //   1. The snapshot never carried the field at all (rawIsStale) — it predates
  //      a query change, so the key is absent.
  //   2. The snapshot carries the field but its VALUE has since changed in
  //      Shopify. Product tags are the case that bites: the catalogue team tags
  //      "WITH DUPATTA" after an order has already been ingested, and the stored
  //      blob keeps the pre-tag list forever. Every recovery path replays that
  //      blob, so the dupatta never gets a barcode and no mode can heal it —
  //      refresh-raw reports "stale: 0" because the key IS there.
  // Tags only: they are the product fields production actually branches on
  // (resolveDupatta / isAccessoryProduct). Deliberately not a deep diff of the
  // whole node — Shopify re-serialises with incidental churn, which is the write
  // amplification the change-detection exists to prevent.
  if (rawIsStale(existing.shopify_raw) || productTagsChanged(existing.shopify_raw, node)) {
    changed.push("shopify_raw");
  }

  // Cancelled on Shopify. `cancelledAt` has been in ORDER_FIELDS all along and
  // was read by nothing — every path fetched it and threw it away.
  //
  // Guarded on our OWN status, not on the timestamp: the hourly refresh sweep
  // re-presents the same 24h of orders every run, so an ungated write would
  // rewrite a cancelled order 24 times a day and fire the orders audit trigger
  // on each one. First transition only.
  const cancellation = shopifyCancellation(node?.cancelledAt, nextTags);
  const alreadyCancelled =
    String(existing.status || "").trim().toLowerCase() === "cancelled";
  const newlyCancelled = Boolean(cancellation) && !alreadyCancelled;
  if (newlyCancelled) changed.push("status:cancelled");

  // Order note edited in Shopify after ingest (e.g. #28961). The note is
  // Shopify-owned text production only reads, never builds on. Diffed against
  // the note in the STORED SNAPSHOT, not against orders.comments: the in-app
  // Edit Order modal also writes comments, and that edit must survive every
  // sweep until the note is actually changed again in Shopify. The shopify_raw
  // write below then records the new note, so this fires once per edit.
  // Same normalisation as the mapper (clean() || null).
  const prevNote = String(existing.shopify_raw?.note ?? "").trim() || null;
  const nextNote = orderRow.comments ?? null;
  const noteChanged = nextNote !== prevNote;
  if (noteChanged) changed.push("comments");

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
      ...(noteChanged ? { comments: nextNote } : {}),
      // Same three columns the four in-app cancel paths write
      // (OrderHistory.jsx:679, AssociateDashboard.js:933, EditOrder.jsx:246,
      // B2bMerchandiserDashboard.jsx:748), so a Shopify cancellation is
      // indistinguishable from a hand-cancelled one to every reader downstream.
      ...(newlyCancelled && cancellation
        ? {
          status: "cancelled",
          cancelled_at: cancellation.at,
          cancellation_reason: cancellation.reason,
        }
        : {}),
    })
    .eq("id", existing.id);

  if (error) {
    return { ...base, outcome: "failed", reason: "REFRESH_FAILED", detail: error.message };
  }

  // AFTER the write, and only on the first transition. Notifying before it
  // would announce a cancellation the DB may have rejected; notifying on every
  // sighting would ring the Production Manager's bell hourly, forever, for one
  // cancelled order. `newlyCancelled` is already the once-only guard.
  if (newlyCancelled) {
    await notifyOrderCancelled({
      id: existing.id,
      order_no: existing.order_no,
      delivery_name: existing.delivery_name,
    });
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
  // The payment columns and the stored raw come back too so
  // refreshExistingOrder can diff both payment state and snapshot staleness
  // without a second round trip.
  const { data: existing } = await supabase
    .from("orders")
    .select("id, order_no, status, delivery_name, shopify_financial_status, shopify_tags, shopify_raw")
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
  // USA: delivery_phone is kept exactly as Shopify gives it; the profile is
  // matched / created with the E.164 form (auth requires it).
  const userId = await resolveProfileId(
    String((orderRow as any).profile_phone || ""),
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

  const { profile_phone: _profilePhone, ...orderFields } = orderRow as any;
  const row = {
    ...orderFields,
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
        .select("id, order_no, status, shopify_financial_status, shopify_tags, shopify_raw")
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
  // Fetch the BARCODES that already exist, not just a count.
  //
  // This used to bail whenever the order had any components at all, which made
  // it all-or-nothing: an order that gained a line item after ingestion (a
  // Shopify-side edit, or a refresh that captured a second variant the original
  // ingest missed) kept the barcodes for its ORIGINAL items and never got any
  // for the new one. Seen on a real order: two sizes of the same outfit, 4
  // pieces expected, 2 minted, and no error anywhere.
  //
  // Now it mints only what is MISSING, keyed on the barcode — which is already
  // the unique physical identity of a piece — so it stays idempotent for the
  // common case (nothing missing, nothing written) while actually closing a gap
  // when there is one. It never deletes: a barcode that no longer matches the
  // items may already be printed and on a garment, so removing it is a human
  // decision, not a sync one.
  const { data: existing, error: checkErr } = await supabase
    .from("order_components")
    .select("barcode")
    .eq("order_id", order.id);
  if (checkErr) {
    console.error("ensureComponents: check failed", checkErr.message);
    return 0;
  }

  const have = new Set((existing || []).map((c: any) => c.barcode));
  const components = buildOrderComponents(order);
  if (components.length === 0) return have.size;

  const missing = components.filter((c: any) => !have.has(c.barcode));
  if (missing.length === 0) return have.size;

  const { data, error } = await supabase
    .from("order_components")
    .insert(missing)
    .select("id");
  if (error) {
    // Non-fatal: the order itself is already saved and correct. Losing the
    // components is recoverable (re-run the sync); losing the order is not.
    console.error(`ensureComponents: insert failed for ${order.order_no}`, error.message);
    return have.size;
  }
  return have.size + (data?.length || 0);
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
  // Same log table as India; every US row's mode starts with "usa:".
  const row = { ...entry, mode: `usa:${entry.mode ?? ""}` };
  const { error } = await supabase.from("shopify_sync_log").insert(row);
  if (error) console.error("shopify_sync_log insert failed:", error.message);
}

// ─── HTTP ───────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!SHOPIFY_USA_CLIENT_ID || !SHOPIFY_USA_CLIENT_SECRET) {
      throw new Error("SHOPIFY_USA_CLIENT_ID / SHOPIFY_USA_CLIENT_SECRET not configured");
    }

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
        await loadDeliveryMatrix();
        await loadStoreTimezone();
        const node = await fetchOrderById(gid);
        if (!node) {
          await logSync({ shopify_order_id: gid, mode: `webhook:${topic}`, outcome: "failed", error: "order not found on re-fetch" });
          return json({ success: true, note: "order not found" });
        }
        // USA: only orders/create may CREATE an order. The store holds old
        // orders migrated from the India store; editing or archiving one fires
        // orders/updated, which must refresh a known order, never import it.
        // A genuinely new order missed by orders/create is still picked up by
        // the 5-minute reconcile poll.
        const result = await ingestOrder(node, colorMap, topic !== "orders/create");
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
    // USA: ingest modes only (see the header).
    const KNOWN_MODES = ["sync-now", "order", "reconcile", "refresh"];
    if (!KNOWN_MODES.includes(mode)) {
      return json({
        success: false,
        error: `Unknown mode "${mode}". Expected one of: ${KNOWN_MODES.join(", ")}`,
      }, 400);
    }

    // Colour name → hex, loaded once and shared by every order in this run.
    const colorMap = await loadColorHexMap();
    // Delivery-date matrix (US fallback only), likewise loaded once per invocation.
    await loadDeliveryMatrix();
    await loadStoreTimezone();

    // Gather the orders to process.
    let nodes: any[] = [];
    let nextCursor: string | null = null;
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
      ({ nodes, nextCursor } = await fetchOrders(Math.min(Number(body?.first) || 50, 100), since, "created_at", body?.after || null));
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
      ({ nodes, nextCursor } = await fetchOrders(Math.min(Number(body?.first) || 100, 100), since, "updated_at", body?.after || null));
    } else {
      // sync-now
      const days = Number(body?.sinceDays) || 0;
      const since = days > 0 ? new Date(Date.now() - days * 86_400_000).toISOString() : null;
      ({ nodes, nextCursor } = await fetchOrders(Math.min(Number(body?.first) || 25, 100), since, "created_at", body?.after || null));
    }

    // Dry run: map only, write nothing. For verifying the mapping against real
    // orders before letting anything touch the database.
    if (dryRun) {
      const preview = [];
      for (const n of nodes) {
        const { orderRow, items, blockers } = mapShopifyOrder(n, colorMap);
        const { data: known } = await supabase
          .from("orders").select("order_no").eq("shopify_order_id", String(n?.id || "")).maybeSingle();
        preview.push({
          shopify_name: n?.name,
          // What a real run would do with this order.
          would: known?.order_no ? `refresh existing ${known.order_no}` : "create",
          shopify_order_id: orderRow.shopify_order_id,
          shopify_fulfillment_status: n?.displayFulfillmentStatus || null,
          created_at_common_clock: orderRow.created_at,
          shopify_created_at_local: orderRow.shopify_created_at_local,
          shopify_timezone: orderRow.shopify_timezone,
          delivery_date: orderRow.delivery_date,
          delivery_basis: (orderRow.web_order_issues as any[] || [])
            .find((i: any) => i.code === "DELIVERY_DATE_DERIVED")?.detail || null,
          delivery_phone: orderRow.delivery_phone,
          delivery_email: orderRow.delivery_email,
          delivery_country: orderRow.delivery_country,
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
        });
      }
      // Headline counts first, so the answer is readable without the detail.
      const summary = preview.reduce((acc: Record<string, number>, p: any) => {
        const k = p.would.startsWith("refresh") ? "refresh_existing" : "create";
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {});
      return json({ success: true, mode, dryRun: true, count: preview.length, summary, nextCursor, preview });
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

    return json({ success: true, mode, fetched: nodes.length, nextCursor, summary, results });
  } catch (error) {
    // LOG the stack, not just the message. Returning the message to the caller
    // without printing anything left a 500 with no corresponding log line —
    // undiagnosable from the dashboard, which is where these are read.
    console.error("shopify-order-sync failed:", (error as Error)?.stack || error);
    return json({
      success: false,
      error: (error as Error)?.message || String(error),
    }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
