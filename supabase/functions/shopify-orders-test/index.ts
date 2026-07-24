import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ============================================================
// shopify-orders-test — a THROWAWAY probe for the Shopify Orders API.
//
// Reads orders from Shopify using the SAME store, API version and
// SHOPIFY_ACCESS_TOKEN secret as the existing shopify-inventory function, so we
// can see the real shape of an order before building the orders dashboard —
// WITHOUT anyone having to reveal or handle the raw token.
//
// It only READS (read_orders scope). Delete this function once the real
// integration is built.
//
// Call it (no body needed — optional { "first": N } or { "sinceDays": N }):
//   POST {SUPABASE_URL}/functions/v1/shopify-orders-test
//   headers: apikey + Authorization: Bearer {anon key}
// ============================================================

const SHOPIFY_STORE = "sheetalbatraindia.myshopify.com";
const SHOPIFY_API_VERSION = "2024-01"; // match shopify-inventory
const SHOPIFY_GRAPHQL_URL = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SHOPIFY_ACCESS_TOKEN = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    if (!SHOPIFY_ACCESS_TOKEN) throw new Error("SHOPIFY_ACCESS_TOKEN not configured");

    // Optional knobs; sensible defaults so an empty body works.
    let first = 10;
    let sinceDays: number | null = null;
    try {
      const body = await req.json();
      if (body?.first) first = Math.min(Number(body.first) || 10, 50);
      if (body?.sinceDays) sinceDays = Number(body.sinceDays);
    } catch { /* empty body is fine */ }

    // Optional created_at filter, Shopify search syntax.
    let queryFilter = "";
    if (sinceDays && sinceDays > 0) {
      const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
      queryFilter = `, query: "created_at:>=${since}"`;
    }

    const gql = `
      query {
        orders(first: ${first}, sortKey: CREATED_AT, reverse: true${queryFilter}) {
          edges {
            node {
              id
              name
              createdAt
              displayFinancialStatus
              displayFulfillmentStatus
              totalPriceSet { shopMoney { amount currencyCode } }
              customer { firstName lastName email phone }
              shippingAddress { city province country zip }

              # ---- ORDER-LEVEL METADATA ----
              note
              tags
              customAttributes { key value }          # checkout cart attributes
              metafields(first: 30) {                  # custom metafields on the order
                edges { node { namespace key value type } }
              }

              lineItems(first: 20) {
                edges {
                  node {
                    title
                    quantity
                    variantTitle
                    sku
                    variant { id product { id } }

                    # ---- LINE-ITEM METADATA ----
                    customAttributes { key value }     # per-product checkout attributes
                    # (line-item metafields are also possible; add if needed)
                  }
                }
              }
            }
          }
        }
      }
    `;

    const res = await fetch(SHOPIFY_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
      },
      body: JSON.stringify({ query: gql }),
    });

    const data = await res.json();

    // Surface Shopify's own errors (e.g. a missing scope) clearly.
    if (data.errors) {
      return new Response(
        JSON.stringify({ success: false, shopify_errors: data.errors }, null, 2),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const orders = (data.data?.orders?.edges || []).map((e: any) => e.node);
    return new Response(
      JSON.stringify({ success: true, count: orders.length, orders }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
