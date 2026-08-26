import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildOrderComponents,
  mapShopifyOrder,
  normalizeColorKey,
  setDeliveryDays,
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
 * AMOUNT only. The table keeps one row (category = '*') holding the four band
 * values.
 *
 * On ANY failure — table missing, RLS, empty — the mapper keeps its identical
 * hardcoded copy. That is a genuine equivalent, not a degraded guess, so a
 * missing table cannot silently change a single delivery date.
 */
async function loadDeliveryMatrix(): Promise<void> {
  const { data, error } = await supabase
    .from("shopify_delivery_matrix")
    .select("category, d10_25k, d25_40k, d40_75k, d75k_up")
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
  setDeliveryDays([data.d10_25k, data.d25_40k, data.d40_75k, data.d75k_up]);
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
  if (rawIsStale(existing.shopify_raw)) changed.push("shopify_raw");

  // Cancelled on Shopify. `cancelledAt` has been in ORDER_FIELDS all along and
  // was read by nothing — every path fetched it and threw it away.
  //
  // Guarded on our OWN status, not on the timestamp: the hourly refresh sweep
  // re-presents the same 24h of orders every run, so an ungated write would
  // rewrite a cancelled order 24 times a day and fire the orders audit trigger
  // on each one. First transition only.
  const cancelledAt = node?.cancelledAt || null;
  const alreadyCancelled =
    String(existing.status || "").trim().toLowerCase() === "cancelled";
  const newlyCancelled = Boolean(cancelledAt) && !alreadyCancelled;
  if (newlyCancelled) changed.push("status:cancelled");

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
      // Same three columns the four in-app cancel paths write
      // (OrderHistory.jsx:679, AssociateDashboard.js:933, EditOrder.jsx:246,
      // B2bMerchandiserDashboard.jsx:748), so a Shopify cancellation is
      // indistinguishable from a hand-cancelled one to every reader downstream.
      ...(newlyCancelled
        ? {
          status: "cancelled",
          cancelled_at: cancelledAt,
          cancellation_reason: "Cancelled on Shopify",
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
        await loadDeliveryMatrix();
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
      "sync-now", "order", "reconcile", "refresh", "refresh-raw", "remap-items",
      "backfill-components", "backfill-cancelled", "redate", "restate-money",
      "restate-totals",
    ];
    if (!KNOWN_MODES.includes(mode)) {
      return json({
        success: false,
        error: `Unknown mode "${mode}". Expected one of: ${KNOWN_MODES.join(", ")}`,
      }, 400);
    }

    // ── backfill-cancelled: settle orders cancelled on Shopify BEFORE
    // refreshExistingOrder learned to read cancelledAt.
    //
    // Two sources, see the `useLive` note below: the stored shopify_raw (free,
    // but under-reports — a cancellation that moved neither payment status nor
    // tags never had its snapshot rewritten), or Shopify itself (`live: true`,
    // one fetch per unsettled order, authoritative). Prefer live for the real
    // run; the stored path is the cheap re-check afterwards.
    //
    // These are the orders that hurt: cancelled on the storefront, still
    // reading "Order Received" on the dashboard, sitting in the work queue with
    // live barcodes. Run once after deploying; idempotent, so re-running is a
    // no-op (the status filter excludes anything already settled).
    //
    // Supports dryRun like every pull mode — always preview first.
    if (mode === "backfill-cancelled") {
      const { data: rows, error } = await supabase
        .from("orders")
        .select("id, order_no, status, delivery_name, shopify_order_id, shopify_raw")
        .or(ORDER_NO_PREFIX_FILTER)
        .order("created_at", { ascending: true });
      if (error) throw error;

      // Not-yet-cancelled on OUR side. Everything below decides which of these
      // Shopify considers dead.
      const live = (rows || []).filter(
        (o: any) => String(o.status || "").trim().toLowerCase() !== "cancelled"
      );

      // ── Where to read cancelledAt from.
      //
      // The stored snapshot UNDER-REPORTS, and by design: shopify_raw is only
      // rewritten when refreshExistingOrder finds a diff, and until this change
      // a cancellation produced no diff entry of its own. A REFUND moved
      // shopify_financial_status so those blobs got rewritten — but a COD
      // cancellation typically moves neither status nor tags, and rawIsStale
      // only inspects line-item shape. Those orders' snapshots still say
      // cancelledAt: null, however long ago they were cancelled.
      //
      // So `live: true` ASKS SHOPIFY instead of trusting the blob. Slower (one
      // GraphQL fetch per unsettled order) but authoritative, which is what a
      // one-off backfill should be. Default stays off so the cheap version is
      // still there for a re-run.
      const useLive = body?.live === true;

      // Bound the batch, same as refresh-raw's `limit` and for the same reason:
      // one edge-function invocation has a wall-clock budget and Shopify has a
      // cost limit, and `live` spends one GraphQL call per unsettled order.
      // Idempotent, so the way to cover a large backlog is to run it again —
      // each pass settles what it reaches and the next starts from what's left.
      const liveLimit = Math.max(1, Number(body?.limit) || 50);
      const toCheck = useLive ? live.slice(0, liveLimit) : live;

      const pending: any[] = [];
      const unreadable: any[] = [];
      if (useLive) {
        for (const o of toCheck) {
          if (!o.shopify_order_id) continue;
          // Per-order try/catch, NOT one around the loop. shopifyGraphql throws
          // on any GraphQL error, and 126 sequential calls will eventually meet
          // Shopify's cost limit — an unguarded throw abandoned the whole run
          // with a 500 and settled nothing, which is how this first failed.
          //
          // A read failure is UNKNOWN, never "not cancelled": it is reported in
          // `unreadable` so the count is honest about what it could not see,
          // rather than silently under-reporting.
          let node: any = null;
          try {
            node = await fetchOrderById(String(o.shopify_order_id));
          } catch (e) {
            unreadable.push({ order_no: o.order_no, error: (e as Error).message });
            continue;
          }
          // Not found on Shopify: say nothing. A missing order is not evidence
          // of cancellation, and guessing here would kill a live order.
          if (!node?.cancelledAt) continue;
          pending.push({ ...o, _cancelledAt: node.cancelledAt });
        }
      } else {
        // Filtered in JS, not SQL: the cancelledAt lives inside a JSONB blob and
        // a .not("shopify_raw->>cancelledAt", "is", null) filter is easy to get
        // subtly wrong against a null-vs-absent key. The Shopify order set is
        // small enough that reading it and testing here is honest and cheap.
        for (const o of live) {
          const at = o?.shopify_raw?.cancelledAt;
          if (at) pending.push({ ...o, _cancelledAt: at });
        }
      }

      if (dryRun) {
        return json({
          success: true,
          mode,
          dryRun: true,
          source: useLive ? "shopify" : "stored_raw",
          scanned: rows?.length || 0,
          checked: toCheck.length,
          // Unsettled orders this pass did not reach (live batch cap). Re-run
          // to continue; mirrors refresh-raw's `remaining`.
          remaining: live.length - toCheck.length,
          would_cancel: pending.length,
          orders: pending.map((o: any) => ({
            order_no: o.order_no,
            status_now: o.status,
            cancelled_at: o._cancelledAt,
          })),
          // Orders Shopify would not answer for. NOT zero-cancelled — unknown.
          // Re-run to settle them; the mode is idempotent.
          ...(unreadable.length
            ? { unreadable: unreadable.length, unreadable_orders: unreadable }
            : {}),
        });
      }

      // Backfill is SILENT by default. These cancellations are historical — some
      // weeks old — and firing the bell for all of them at once would bury the
      // Production Manager in alerts about orders nobody can act on any more,
      // training them to ignore the one that matters. Pass notify:true to send
      // them anyway (e.g. a backfill covering only the last day or two).
      const notify = body?.notify === true;

      const done: any[] = [];
      const failures: any[] = [];
      for (const o of pending) {
        const { error: upErr } = await supabase
          .from("orders")
          .update({
            status: "cancelled",
            cancelled_at: o._cancelledAt,
            cancellation_reason: "Cancelled on Shopify",
          })
          .eq("id", o.id);
        if (upErr) { failures.push({ order_no: o.order_no, error: upErr.message }); continue; }
        done.push({ order_no: o.order_no, cancelled_at: o._cancelledAt });
        if (notify) {
          await notifyOrderCancelled({
            id: o.id,
            order_no: o.order_no,
            delivery_name: o.delivery_name,
          });
        }
      }

      return json({
        success: true,
        mode,
        source: useLive ? "shopify" : "stored_raw",
        scanned: rows?.length || 0,
        checked: toCheck.length,
        remaining: live.length - toCheck.length,
        cancelled: done.length,
        results: done,
        ...(failures.length ? { failures } : {}),
        ...(unreadable.length
          ? { unreadable: unreadable.length, unreadable_orders: unreadable }
          : {}),
      });
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
    // Delivery-date matrix, likewise loaded once per invocation.
    await loadDeliveryMatrix();

    // ── remap: re-run the mapper over shopify_raw for orders already ingested,
    // and rewrite items[]. Uses the STORED raw node, so it touches no Shopify
    // API and cannot change money, dates or identity — only the derived item
    // fields. For rolling out a mapper fix (e.g. colours as {hex,name}) without
    // deleting and re-ingesting.
    // ── refresh-raw: re-fetch orders whose STORED SNAPSHOT predates a query
    // change, one Shopify call each, driven off OUR table rather than a window.
    //
    // Why this exists rather than widening `refresh`: that sweep pages Shopify
    // by updated_at, capped at 100 orders with no cursor, and most of that page
    // is orders we never ingested. Backfilling ~125 stale snapshots through it
    // would need pagination on the shared path that also carries reconcile —
    // the lost-order safety net — for a one-off catch-up. This mode instead
    // SELECTS exactly the orders that need it, so it cannot miss one and cannot
    // touch anything else.
    //
    // Refresh-only by construction: every row comes from our own table, so
    // there is nothing here to create. It writes only what refreshExistingOrder
    // writes (payment state + the snapshot) — never items, order_no or dates.
    //
    // Run `remap-items` AFTERWARDS to actually re-derive items/issues from the
    // now-complete snapshots; this mode only makes that replay possible.
    if (mode === "refresh-raw") {
      // TWO different bounds, and conflating them is a bug:
      //
      //   scan  — how many rows to READ. Must cover the whole table, or older
      //           stale orders are never even looked at. Cheap: one query.
      //   batch — how many to REFRESH. Each costs a sequential Shopify call, so
      //           this is a TIME budget; 200 exceeded the edge runtime's limit
      //           on a real backlog and the isolate was killed mid-flight.
      //
      // Capping the SELECT at the batch size would re-scan the same newest N
      // rows every run and never drain the tail.
      const batchSize = Math.min(Number(body?.limit) || 40, 200);
      const scanSize = Math.min(Number(body?.scan) || 1000, 5000);
      const { data: rows, error } = await supabase
        .from("orders")
        .select("id, order_no, shopify_order_id, shopify_financial_status, shopify_tags, shopify_raw")
        .or(ORDER_NO_PREFIX_FILTER)
        .not("shopify_order_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(scanSize);
      if (error) throw error;

      // Only rows that HAVE a snapshot can have a stale one. A NULL shopify_raw
      // is a different problem (never ingested with a raw node) and is not
      // something re-fetching here would fix.
      const stale = (rows || []).filter(
        (o: any) => o?.shopify_raw != null && rawIsStale(o.shopify_raw),
      );
      // A dry run must not call Shopify at all. Fetching first and THEN checking
      // dryRun meant a 200-order backlog made 200 sequential API calls just to
      // report a count — long enough for the edge runtime to kill the isolate,
      // which surfaces as a 500 with NO log line because the catch never runs.
      if (body?.dryRun) {
        return json({
          success: true,
          mode,
          dryRun: true,
          scanned: (rows || []).length,
          stale: stale.length,
          would_refresh: stale.map((o: any) => o.order_no),
        });
      }

      // Bound the WORK, not just the scan: `limit` caps rows read, but the
      // sequential Shopify calls are what cost time. Process at most `limit`
      // of them and report the remainder so the caller knows to re-run.
      const batch = stale.slice(0, batchSize);
      const remaining = stale.length - batch.length;

      const out = [];
      for (const o of batch) {
        const gid = String(o.shopify_order_id);
        try {
          const node = await fetchOrderById(gid);
          if (!node) {
            out.push({ order_no: o.order_no, outcome: "failed", reason: "NOT_FOUND_IN_SHOPIFY" });
            continue;
          }
          const r = await refreshExistingOrder(o as any, node, gid, colorMap);
          out.push({ order_no: o.order_no, outcome: (r as any).outcome, changed: (r as any).changed });
        } catch (e) {
          out.push({ order_no: o.order_no, outcome: "failed", detail: (e as Error).message });
        }
      }

      const summary = out.reduce((acc: Record<string, number>, r: any) => {
        acc[r.outcome] = (acc[r.outcome] || 0) + 1;
        return acc;
      }, {});
      return json({
        success: true,
        mode,
        scanned: (rows || []).length,
        stale: stale.length,
        processed: batch.length,
        // Non-zero means there is more to do: run the same call again.
        remaining,
        summary,
        results: out,
      });
    }

    if (mode === "remap-items") {
      // Optional single-order scope. The dashboard re-maps ONE order after a
      // human sets its breakdown; replaying all ~125 for that would be a lot of
      // writes to apply one decision. Absent, it still sweeps everything.
      const onlyOrderNo = String(body?.orderNo ?? "").trim();

      let q = supabase
        .from("orders")
        .select("id, order_no, shopify_raw, manual_line_breakdown")
        .not("shopify_raw", "is", null);
      q = onlyOrderNo
        ? q.eq("order_no", onlyOrderNo)
        : q.or(ORDER_NO_PREFIX_FILTER);
      const { data: rows, error } = await q.order("created_at", { ascending: true });
      if (error) throw error;

      const out = [];
      for (const o of rows || []) {
        // The stored override is re-applied on every replay. Without it this
        // mode would re-derive "no product, nothing to read" and silently
        // revert a human's breakdown decision. See 83_manual_line_breakdown.sql.
        const { orderRow, items } = mapShopifyOrder(
          o.shopify_raw,
          colorMap,
          (o as any).manual_line_breakdown,
        );

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
            // Derived FROM items, so it has to move with them or the two
            // disagree. It counts garments only (a customisation charge is not
            // a piece), and leaving it behind is what left #27567 reading
            // "3 pieces" for one kurta set even after items[] was corrected.
            // Not money — a count.
            total_quantity: orderRow.total_quantity,
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

        // Mint the pieces for an order that is now READY. Ingestion skips
        // component minting for a needs_review order (the breakdown isn't
        // trustworthy yet) and mints on the way in otherwise — but nothing
        // minted for the order that ARRIVES flagged and is cleared later,
        // which is exactly what a human setting the breakdown does. Those
        // orders sat ready, with a full top/bottom breakdown, and no barcodes
        // and no View Journey. ensureComponents is idempotent and mints only
        // missing barcodes, so re-mapping an already-minted order writes
        // nothing; a still-flagged order is left alone as before.
        let componentCount;
        if (!upErr && orderRow.web_order_status !== "needs_review") {
          componentCount = await ensureComponents({ ...o, items });
        }

        out.push({
          order_no: o.order_no,
          items: items.length,
          status: orderRow.web_order_status,
          ...(componentCount === undefined ? {} : { components: componentCount }),
          ...(upErr ? { error: upErr.message } : {}),
        });
      }

      const flagged = out.filter((r) => r.status === "needs_review").length;
      return json({ success: true, mode, orders: out.length, flagged, results: out });
    }

    // ── redate: recompute delivery_date from the STORED shopify_raw and write
    // ONLY that column. No Shopify call.
    //
    // WHY THIS IS ITS OWN MODE, AND NOT PART OF remap-items
    // remap-items deliberately never writes delivery_date: re-deriving items[]
    // must not silently move a deadline the floor is already working to. That
    // guard is right, and it stays. But when the RULE itself changes — as it
    // did when delivery dates moved from the shipping_timeline metafield to the
    // category x price matrix — existing orders keep dates computed under the
    // old rule forever. This is the deliberate, separately-invoked way to
    // restate them.
    //
    // ALWAYS DRY-RUN FIRST. `dryRun: true` returns every before/after with no
    // write, which is the only way to see the real blast radius before
    // committing to it.
    if (mode === "redate") {
      const { data: rows, error } = await supabase
        .from("orders")
        .select("id, order_no, created_at, delivery_date, shopify_raw, status, web_order_status, web_order_issues, manual_line_breakdown")
        .or(ORDER_NO_PREFIX_FILTER)
        .not("shopify_raw", "is", null)
        .order("created_at", { ascending: true });
      if (error) throw error;

      // Orders past order_received have components on the floor being scanned
      // to a deadline. Moving their date mid-production changes a live SLA and
      // every escalation timer hanging off it. Skipped unless explicitly asked
      // for, and reported either way so the count is never silently hidden.
      const includeInProduction = body?.includeInProduction === true;

      const changes = [];
      const skipped = [];
      const unresolved = [];

      for (const o of rows || []) {
        const { orderRow } = mapShopifyOrder(
          o.shopify_raw,
          colorMap,
          (o as any).manual_line_breakdown,
        );
        const next = orderRow.delivery_date as string | null;
        const prev = o.delivery_date as string | null;

        // The mapper could not resolve a date under the new rule (no category
        // on some line item). Never blank out a date the floor already has —
        // that would strip a working deadline and replace it with nothing.
        if (!next) {
          if (prev) unresolved.push({ order_no: o.order_no, kept: prev });
          continue;
        }
        // A row flagged under the OLD category rule carries a stale
        // DELIVERY_DATE_UNRESOLVED blocker that pins it in Needs Review even
        // though it HAS a date. The blocker is now unreachable (the amount-only
        // rule always resolves a date), so it is obsolete, not merely
        // satisfied — drop it, and clear needs_review when nothing else
        // remains. Other blockers stay: they are still real.
        //
        // Computed BEFORE the `next === prev` gate on purpose. The common case
        // is an order whose date is already correct under the current rule and
        // whose ONLY remaining problem is the dead flag — gating this on "the
        // date moved" would skip exactly those rows and leave them stuck.
        const priorIssues = ((o as any).web_order_issues || []);
        const issues = priorIssues
          .filter((i: any) => i.code !== "DELIVERY_DATE_UNRESOLVED");
        const unblocked = priorIssues.length !== issues.length;

        // Date already correct. Still write if a dead flag needs clearing —
        // that is a status correction, not a deadline change, so it is safe
        // regardless of production status.
        if (next === prev) {
          if (unblocked) {
            changes.push({
              order_no: o.order_no,
              from: prev,
              to: next,
              days: 0,
              issues,
              unblocked,
              flagOnly: true,
            });
          }
          continue;
        }

        if (o.status !== "order_received" && !includeInProduction) {
          skipped.push({
            order_no: o.order_no,
            status: o.status,
            from: prev,
            to: next,
          });
          continue;
        }

        const days = prev
          ? Math.round(
            (new Date(next).getTime() - new Date(prev).getTime()) / 86400000,
          )
          : null;
        changes.push({
          order_no: o.order_no,
          from: prev,
          to: next,
          days,
          issues,
          unblocked,
        });
      }

      if (body?.dryRun) {
        return json({
          success: true,
          mode,
          dryRun: true,
          scanned: (rows || []).length,
          would_change: changes.length,
          earlier: changes.filter((c) => (c.days ?? 0) < 0).length,
          later: changes.filter((c) => (c.days ?? 0) > 0).length,
          would_unblock: changes.filter((c) => c.unblocked).length,
          skipped_in_production: skipped.length,
          unresolved_kept_existing: unresolved.length,
          changes,
          skipped,
          unresolved,
        });
      }

      let updated = 0;
      const failures = [];
      for (const c of changes) {
        const row = (rows || []).find((r: any) => r.order_no === c.order_no);
        const { error: upErr } = await supabase
          .from("orders")
          .update({
            // A flag-only correction leaves the date alone — rewriting an
            // identical value would fire the orders audit trigger for nothing.
            ...(c.flagOnly ? {} : { delivery_date: c.to }),
            ...(c.unblocked
              ? {
                // Mirror mapper.ts exactly: "ready"/"needs_review", and an
                // empty issue list is stored as null, not [].
                web_order_issues: c.issues.length ? c.issues : null,
                web_order_status: c.issues.length ? "needs_review" : "ready",
              }
              : {}),
          })
          .eq("id", row.id);
        if (upErr) failures.push({ order_no: c.order_no, error: upErr.message });
        else updated++;
      }

      return json({
        success: true,
        mode,
        scanned: (rows || []).length,
        updated,
        unblocked: changes.filter((c) => c.unblocked).length,
        skipped_in_production: skipped.length,
        unresolved_kept_existing: unresolved.length,
        ...(failures.length ? { failures } : {}),
      });
    }

    // ── restate-money: rewrite the discount split from the STORED shopify_raw.
    // No Shopify call, and no other column touched.
    //
    // WHY THIS IS ITS OWN MODE, AND NOT PART OF remap-items
    // remap-items deliberately never writes money — re-deriving items[] must
    // not silently move an amount somebody has reconciled against a bank
    // statement. That guard is right, and it stays. But the mapper used to put
    // Shopify's ALREADY-NET total into grand_total, while the rest of the app
    // means "before discount" by that column (CustomerOrderPdf.js:450 computes
    // netTotal = grand_total - discount_amount). So a discounted web order's
    // invoice subtracted the discount a SECOND time: #27567 was paid ₹2,40,500
    // and printed ₹2,28,500. Existing rows keep that split until restated.
    //
    // Only orders that CARRY a discount can be affected — with discount 0 the
    // old and new arithmetic agree exactly, so undiscounted orders are
    // untouched by construction, not by a filter.
    //
    // The total the customer PAID never changes here. This only moves which
    // column holds the pre- and post-discount figures.
    //
    // ALWAYS DRY-RUN FIRST.
    if (mode === "restate-money") {
      const onlyOrderNo = String(body?.orderNo ?? "").trim();
      let q = supabase
        .from("orders")
        .select("id, order_no, grand_total, grand_total_after_discount, net_total, discount_amount, advance_payment, remaining_payment, total_paid, status, shopify_raw")
        .not("shopify_raw", "is", null);
      q = onlyOrderNo ? q.eq("order_no", onlyOrderNo) : q.or(ORDER_NO_PREFIX_FILTER);
      const { data: rows, error } = await q.order("created_at", { ascending: true });
      if (error) throw error;

      const changes = [];
      const mismatched = [];

      for (const o of rows || []) {
        let orderRow: any;
        try {
          ({ orderRow } = mapShopifyOrder(o.shopify_raw, colorMap, (o as any).manual_line_breakdown));
        } catch {
          continue;
        }

        const nextGrand = Number(orderRow.grand_total) || 0;
        const nextNet = Number(orderRow.net_total) || 0;
        const nextDisc = Number(orderRow.discount_amount) || 0;
        const prevGrand = Number(o.grand_total) || 0;
        const prevNet = Number(o.net_total) || 0;

        if (nextGrand === prevGrand && nextNet === prevNet) continue;

        // ── Only restate a row whose ONLY problem is the discount split.
        //
        // This mode's whole contract is "move which column holds the pre- vs
        // post-discount figure, never change what the customer paid". The
        // signature of that bug is exact: the stored grand_total equals the
        // PAID total, because the old mapper wrote Shopify's already-net figure
        // into a pre-discount column. net_total therefore must not move.
        //
        // Prod turned up 11 orders that fail this test — two line items, but a
        // grand_total holding only one of them, and total_quantity stuck at 1
        // (found by this mode's own dry run, e.g. #004591: stored ₹29,150 vs
        // Shopify ₹58,050). That is a DIFFERENT and older defect: a dropped or
        // uncounted line item, ~₹1.9L under-recorded in total.
        //
        // Restating those here would raise grand_total to the true amount while
        // leaving total_quantity and items[] wrong — a half-correction that
        // reads as fixed and is not. Worse, it would silently move net_total,
        // which this mode promises never to do. So they are reported and left
        // for the deliberate items-level fix (refresh-raw + remap-items), which
        // is the only path that can repair the count and the lines together.
        if (nextNet !== prevNet) {
          mismatched.push({
            order_no: o.order_no,
            stored_grand_total: prevGrand,
            shopify_paid: nextNet,
            difference: nextNet - prevNet,
            reason:
              "net_total would move — the stored total does not match Shopify's, so this is a missing/uncounted line item, not the discount split. Fix with refresh-raw + remap-items.",
          });
          continue;
        }

        // The paid figure must not move. If what the customer actually paid
        // (total_paid) disagrees with the net we are about to write, something
        // other than this bug is going on — a manual correction, a partial
        // refund — and restating it would paper over that. Report, never write.
        const paid = o.total_paid == null ? null : Number(o.total_paid);
        if (paid != null && paid > 0 && paid !== nextNet) {
          mismatched.push({
            order_no: o.order_no,
            total_paid: paid,
            would_set_net: nextNet,
            reason: "total_paid disagrees with the restated net — left untouched for a human",
          });
          continue;
        }

        changes.push({
          order_no: o.order_no,
          id: o.id,
          status: o.status,
          discount: nextDisc,
          grand_total: { from: prevGrand, to: nextGrand },
          net_total: { from: prevNet, to: nextNet },
          // What the customer's invoice prints, before and after. This is the
          // number the whole mode exists to correct.
          invoice_prints: { from: prevGrand - Number(o.discount_amount || 0), to: nextGrand - nextDisc },
        });
      }

      if (body?.dryRun) {
        return json({
          success: true,
          mode,
          dryRun: true,
          scanned: (rows || []).length,
          would_change: changes.length,
          mismatched_left_alone: mismatched.length,
          changes,
          mismatched,
        });
      }

      let updated = 0;
      const failures = [];
      for (const c of changes) {
        const { error: upErr } = await supabase
          .from("orders")
          .update({
            grand_total: c.grand_total.to,
            grand_total_after_discount: c.net_total.to,
            net_total: c.net_total.to,
            discount_amount: c.discount,
          })
          .eq("id", c.id);
        if (upErr) failures.push({ order_no: c.order_no, error: upErr.message });
        else updated++;
      }

      return json({
        success: true,
        mode,
        scanned: (rows || []).length,
        updated,
        mismatched_left_alone: mismatched.length,
        ...(mismatched.length ? { mismatched } : {}),
        ...(failures.length ? { failures } : {}),
      });
    }

    // ── restate-totals: rewrite the FULL money set for NAMED orders, from the
    // stored shopify_raw. No Shopify call.
    //
    // WHY THIS EXISTS SEPARATELY FROM restate-money
    // restate-money only ever moves the discount split and refuses any row
    // where net_total would change — because a moving net means the stored
    // total disagrees with Shopify's, which is a missing/uncounted line item,
    // not a column mix-up. That guard is right and stays.
    //
    // But those rows still need fixing. After refresh-raw + remap-items
    // restored their items[] and total_quantity, only the AMOUNTS remain stale
    // (remap-items deliberately never writes money). This is the deliberate,
    // explicitly-scoped way to finish them.
    //
    // ── THE TWO SAFETY RULES, both non-negotiable
    //
    // 1. NAMED ORDERS ONLY. `orderNos` is required — there is no sweep-
    //    everything form. Each of these rows needs a human to have looked at
    //    it, so the caller states exactly which.
    //
    // 2. NOTHING COLLECTED. A row is refused unless total_paid, advance_payment
    //    and every order_payments row are zero/absent. Raising the total on an
    //    order where money HAS changed hands would silently make a settled
    //    order look underpaid and could trigger a wrongful collection call to a
    //    customer who already paid. For a COD order awaiting delivery there is
    //    nothing to reconcile — the amount simply has not been collected yet,
    //    and the corrected figure is what the driver must collect.
    //
    // Prepaid orders in this state (Shopify says PAID but our total_paid holds
    // the old wrong figure) are deliberately NOT covered: they need the
    // gateway/bank record checked first. Rule 2 refuses them by design.
    //
    // ALWAYS DRY-RUN FIRST.
    if (mode === "restate-totals") {
      const orderNos: string[] = Array.isArray(body?.orderNos)
        ? body.orderNos.map((s: unknown) => String(s).trim()).filter(Boolean)
        : [];
      if (orderNos.length === 0) {
        throw new Error(
          "mode 'restate-totals' requires { orderNos: [...] } — it never sweeps the whole table",
        );
      }

      const { data: rows, error } = await supabase
        .from("orders")
        .select("id, order_no, status, grand_total, grand_total_after_discount, net_total, discount_amount, advance_payment, remaining_payment, total_paid, total_quantity, shopify_raw, manual_line_breakdown")
        .in("order_no", orderNos);
      if (error) throw error;

      // Any recorded payment disqualifies a row, whatever the columns say.
      const ids = (rows || []).map((r: any) => r.id);
      const { data: payRows } = ids.length
        ? await supabase.from("order_payments").select("order_id, amount").in("order_id", ids)
        : { data: [] as any[] };
      const paidByOrder = new Map<string, number>();
      for (const p of payRows || []) {
        paidByOrder.set(p.order_id, (paidByOrder.get(p.order_id) || 0) + (Number(p.amount) || 0));
      }

      const changes = [];
      const refused = [];
      const notFound = orderNos.filter(
        (no) => !(rows || []).some((r: any) => r.order_no === no),
      );

      for (const o of rows || []) {
        const collected =
          (Number(o.total_paid) || 0) +
          (Number(o.advance_payment) || 0) +
          (paidByOrder.get(o.id) || 0);
        if (collected > 0) {
          refused.push({
            order_no: o.order_no,
            collected,
            reason:
              "money has already been collected on this order — reconcile against the gateway/bank before restating, this mode only touches orders with nothing paid",
          });
          continue;
        }

        let orderRow: any;
        try {
          ({ orderRow } = mapShopifyOrder(o.shopify_raw, colorMap, (o as any).manual_line_breakdown));
        } catch (e) {
          refused.push({ order_no: o.order_no, reason: `mapper failed: ${(e as Error).message}` });
          continue;
        }

        const next = {
          grand_total: Number(orderRow.grand_total) || 0,
          net_total: Number(orderRow.net_total) || 0,
          discount_amount: Number(orderRow.discount_amount) || 0,
          advance_payment: Number(orderRow.advance_payment) || 0,
          remaining_payment: Number(orderRow.remaining_payment) || 0,
        };

        // The mapper must agree with itself, or we are writing nonsense.
        if (Math.abs(next.grand_total - next.discount_amount - next.net_total) > 0.01) {
          refused.push({
            order_no: o.order_no,
            reason: `mapper produced an inconsistent total (${next.grand_total} - ${next.discount_amount} != ${next.net_total})`,
          });
          continue;
        }

        if (
          next.grand_total === Number(o.grand_total) &&
          next.net_total === Number(o.net_total)
        ) continue;

        changes.push({
          order_no: o.order_no,
          id: o.id,
          status: o.status,
          total_quantity: o.total_quantity,
          grand_total: { from: Number(o.grand_total), to: next.grand_total },
          net_total: { from: Number(o.net_total), to: next.net_total },
          discount_amount: { from: Number(o.discount_amount), to: next.discount_amount },
          // What a COD driver must collect — the number this mode exists to fix.
          to_collect: { from: Number(o.remaining_payment), to: next.remaining_payment },
          next,
        });
      }

      if (body?.dryRun) {
        return json({
          success: true,
          mode,
          dryRun: true,
          requested: orderNos.length,
          would_change: changes.length,
          refused: refused.length,
          not_found: notFound,
          changes,
          refused_detail: refused,
        });
      }

      let updated = 0;
      const failures = [];
      for (const c of changes) {
        const { error: upErr } = await supabase
          .from("orders")
          .update({
            grand_total: c.next.grand_total,
            grand_total_after_discount: c.next.net_total,
            net_total: c.next.net_total,
            discount_amount: c.next.discount_amount,
            advance_payment: c.next.advance_payment,
            remaining_payment: c.next.remaining_payment,
          })
          .eq("id", c.id);
        if (upErr) failures.push({ order_no: c.order_no, error: upErr.message });
        else updated++;
      }

      return json({
        success: true,
        mode,
        requested: orderNos.length,
        updated,
        refused: refused.length,
        ...(refused.length ? { refused_detail: refused } : {}),
        ...(notFound.length ? { not_found: notFound } : {}),
        ...(failures.length ? { failures } : {}),
      });
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
