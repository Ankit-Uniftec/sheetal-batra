import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mapShopifyOrder, SHOPIFY_STORE_KEY, toE164 } from "./mapper.ts";

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
// Modes (all share ONE mapper + ONE idempotent write path):
//   { mode: "sync-now",  sinceDays?: n, first?: n }  manual pull (dashboard button)
//   { mode: "reconcile", sinceMinutes?: n }          pg_cron safety net (Phase 5)
//   { mode: "order",     id: "gid://..." }           single order (webhook trigger, Phase 5)
//
// Phase 2 implements sync-now/order; reconcile shares the same code path and is
// wired to cron in Phase 5.
//
// Secrets (Supabase function config):
//   SHOPIFY_ACCESS_TOKEN   Admin API token (read_orders, read_products)
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOPIFY_ACCESS_TOKEN = Deno.env.get("SHOPIFY_ACCESS_TOKEN")!;

const SHOPIFY_STORE = "sheetalbatraindia.myshopify.com";
const SHOPIFY_API_VERSION = "2024-01"; // match shopify-inventory
const SHOPIFY_GRAPHQL_URL = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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
          }
        }
      }
    }
  }
`;

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

/** Fetch a page of orders, newest first, optionally filtered by updated_at. */
async function fetchOrders(first: number, sinceIso: string | null) {
  const filter = sinceIso ? `, query: "updated_at:>=${sinceIso}"` : "";
  const data = await shopifyGraphql(`
    query {
      orders(first: ${first}, sortKey: CREATED_AT, reverse: true${filter}) {
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

// ─── Ingest one order ───────────────────────────────────────

async function ingestOrder(node: any) {
  const gid = String(node?.id || "");
  if (!gid) return { gid: "", outcome: "skipped", reason: "no id" };

  // ── Idempotency FIRST, before minting an order number.
  // The order-number sequence is a single GLOBAL counter. Generating before
  // this check would burn a number on every duplicate webhook delivery,
  // leaving gaps that read as deleted orders in an audit.
  const { data: existing } = await supabase
    .from("orders")
    .select("id, order_no")
    .eq("shopify_order_id", gid)
    .maybeSingle();
  if (existing?.id) {
    return { gid, outcome: "already_exists", order_no: existing.order_no, id: existing.id };
  }

  const { orderRow, blockers } = mapShopifyOrder(node);

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

  // ── Order number. 'Shopify' → SB-SHOP-MMYY-NNNNNN (db/website_orders.sql).
  const { data: orderNo, error: rpcErr } = await supabase.rpc("generate_order_no", {
    p_store: SHOPIFY_STORE_KEY,
  });
  if (rpcErr || !orderNo) {
    return { gid, outcome: "failed", reason: "ORDER_NO_FAILED", detail: rpcErr?.message };
  }
  if (!String(orderNo).includes("-SHOP-")) {
    // The generate_order_no 'Shopify' branch is missing, so this fell through
    // to GEN. GEN is not in CHANNEL_BY_ORDER_PREFIX, so the order would report
    // as STORE revenue forever. Refuse to write rather than corrupt reporting.
    return {
      gid,
      outcome: "failed",
      reason: "CHANNEL_PREFIX_MISSING",
      detail: `generate_order_no('Shopify') returned ${orderNo} — apply db/website_orders.sql section 4`,
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
        .select("id, order_no")
        .eq("shopify_order_id", gid)
        .maybeSingle();
      return { gid, outcome: "already_exists", order_no: winner?.order_no, id: winner?.id };
    }
    return { gid, outcome: "failed", reason: "INSERT_FAILED", detail: insertErr.message };
  }

  return {
    gid,
    outcome: "inserted",
    id: inserted.id,
    order_no: inserted.order_no,
    web_order_status: inserted.web_order_status,
    blockers: blockers.length ? blockers : undefined,
  };
}

// ─── HTTP ───────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!SHOPIFY_ACCESS_TOKEN) throw new Error("SHOPIFY_ACCESS_TOKEN not configured");

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      /* empty body is fine */
    }

    const mode = body?.mode || "sync-now";
    const dryRun = body?.dryRun === true;

    // Gather the orders to process.
    let nodes: any[] = [];
    if (mode === "order") {
      if (!body?.id) throw new Error("mode 'order' requires { id }");
      const node = await fetchOrderById(String(body.id));
      if (node) nodes = [node];
    } else if (mode === "reconcile") {
      const mins = Number(body?.sinceMinutes) || 30;
      const since = new Date(Date.now() - mins * 60_000).toISOString();
      nodes = await fetchOrders(Math.min(Number(body?.first) || 50, 100), since);
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
        const { orderRow, items, blockers } = mapShopifyOrder(n);
        return {
          shopify_name: n?.name,
          shopify_order_id: orderRow.shopify_order_id,
          delivery_date: orderRow.delivery_date,
          delivery_name: orderRow.delivery_name,
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

    const results = [];
    for (const node of nodes) {
      try {
        results.push(await ingestOrder(node));
      } catch (e) {
        results.push({ gid: node?.id, outcome: "failed", detail: (e as Error).message });
      }
    }

    const summary = results.reduce((acc: Record<string, number>, r: any) => {
      acc[r.outcome] = (acc[r.outcome] || 0) + 1;
      return acc;
    }, {});

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
