import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================
// Nector (Collectors Circle points), server side. Release 39, phase 2.
//
// READ ONLY for now: nothing here can add or deduct points.
//   { action: "status" }                 is Nector configured? (no secrets returned)
//   { action: "programme" }              programme name, coin name, earning / tier settings
//   { action: "triggers" }               the earning rules set up in Nector
//   { action: "lead", mobile }           one customer: name, available points, tier, lifetime spend
//
// The API key and workspace id are Supabase secrets (NECTOR_API_KEY,
// NECTOR_WORKSPACE_ID). They never reach the browser: the app calls this
// function with the signed-in staff member's session.
// Docs: https://nector.readme.io/reference
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NECTOR_API_KEY = Deno.env.get("NECTOR_API_KEY") || "";
const NECTOR_WORKSPACE_ID = Deno.env.get("NECTOR_WORKSPACE_ID") || "";
const READ_BASE = "https://cachefront.nector.io/api/v2/merchant"; // GETs (Nector's advice)

// Who may use it: management for the programme settings; any staff to look up a customer.
const ADMIN_ROLES = ["admin", "assistant_cmo", "gm", "ceo", "ceo_assistant", "coo", "retail_manager", "store_manager"];

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function staffFrom(req: Request): Promise<{ email: string; role: string } | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  const email = String(data?.user?.email || "").toLowerCase();
  if (error || !email) return null;
  const { data: sp } = await supabase.from("salesperson").select("role").eq("email", email).maybeSingle();
  return sp?.role ? { email, role: sp.role } : null;
}

async function nectorGet(path: string, query: Record<string, string> = {}) {
  const url = new URL(READ_BASE + path);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    headers: { "x-apikey": NECTOR_API_KEY, "x-workspaceid": NECTOR_WORKSPACE_ID, "x-source": "web" },
  });
  let body: any = null;
  try { body = await res.json(); } catch { /* not json */ }
  return { ok: res.ok, status: res.status, body };
}

// Nector does not document the mobile format it stores, so try the usual shapes.
const mobileVariants = (raw: string) => {
  const d = String(raw || "").replace(/\D/g, "");
  const ten = d.slice(-10);
  return [...new Set([raw.trim(), d, ten, `91${ten}`, `+91${ten}`].filter((v) => v && v.replace(/\D/g, "").length >= 10))];
};
const PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000000"; // lookup key goes in the query

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const user = await staffFrom(req);
  if (!user) return json({ error: "Sign in as staff to use this." }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = String(body.action || "status");

  if (action === "status") {
    return json({ configured: Boolean(NECTOR_API_KEY && NECTOR_WORKSPACE_ID) });
  }
  if (!NECTOR_API_KEY || !NECTOR_WORKSPACE_ID) {
    return json({ error: "Nector is not set up: NECTOR_API_KEY and NECTOR_WORKSPACE_ID are needed in Supabase secrets." }, 503);
  }

  if (action === "programme" || action === "triggers") {
    if (!ADMIN_ROLES.includes(user.role)) return json({ error: "Not allowed." }, 403);
    if (action === "programme") {
      const r = await nectorGet("/aggreegateddetails");
      if (!r.ok) return json({ error: "Nector refused the request.", status: r.status, nector: r.body?.message || r.body }, 502);
      const d = r.body?.data || {};
      const biz = d.businessinfos?.entity || d.businessinfos || {};
      return json({
        programme: {
          name: biz.program_name || biz.name || null,
          coin_name: biz.coin_name || null,
          currency: biz.currency_code || null,
          running: biz.is_running ?? null,
        },
        loyalty_action: d.actioninfos?.loyalty_action ?? null,   // earning / spending ratio
        tier_action: d.actioninfos?.tier_action ?? null,         // tiers
        coinexpiry_action: d.actioninfos?.coinexpiry_action ?? null,
        integrations: d.integrationinfos ?? null,
      });
    }
    const r = await nectorGet("/triggers", { limit: "100" });
    if (!r.ok) return json({ error: "Nector refused the request.", status: r.status, nector: r.body?.message || r.body }, 502);
    const items = r.body?.data?.items || [];
    return json({
      count: r.body?.data?.count ?? items.length,
      triggers: items.map((t: any) => ({
        id: t._id, name: t.name, slug: t.slug, content_type: t.content_type, reward_type: t.reward_type,
        rule_type: t.rule_type, reward: t.reward, rule: t.rule, open: t.is_open,
      })),
    });
  }

  if (action === "lead") {
    const variants = mobileVariants(String(body.mobile || ""));
    if (!variants.length) return json({ error: "Give a mobile number." }, 400);
    for (const m of variants) {
      const r = await nectorGet(`/leads/${PLACEHOLDER_ID}`, { mobile: m });
      const item = r.body?.data?.item;
      if (r.ok && item) {
        const w = item.wallet || {};
        return json({
          found: true,
          matched_as: m,
          lead: {
            name: item.name || null,
            country: item.country || null,
            points_available: w.available ?? null,
            tier: w.tier ?? null,
            membership: w.membership ?? null,
            lifetime_spend: w.transaction_amount ?? null,
            lifetime_orders: w.transaction_count ?? null,
          },
        });
      }
      if (r.status !== 404 && r.status !== 400 && !r.ok) {
        return json({ error: "Nector refused the request.", status: r.status, nector: r.body?.message || r.body }, 502);
      }
    }
    return json({ found: false, tried: variants.length });
  }

  return json({ error: `Unknown action "${action}".` }, 400);
});
