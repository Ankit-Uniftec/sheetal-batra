#!/usr/bin/env node
/**
 * Re-send the "order placed" WhatsApp (with the customer PDF button) for
 * specific orders, via the spur-whatsapp edge function.
 *
 * One-off recovery tool for orders whose WhatsApp never reached the client.
 * It reads customer_url from the order row — it does NOT regenerate PDFs.
 *
 * Usage:
 *   # 1. Dry run (default) — shows exactly what would be sent, sends nothing
 *   node scripts/resend-order-pdf.js --env uat --orders SB-XXX-0926-00XXXX
 *
 *   # 2. Send to an override number (test on your own phone first)
 *   node scripts/resend-order-pdf.js --env uat --orders SB-... --to 9XXXXXXXXX --send
 *
 *   # 3. Real send to the customer's own number (prod needs --i-know-this-is-prod)
 *   node scripts/resend-order-pdf.js --env prod --orders A,B,C --send --i-know-this-is-prod
 *
 * Credentials (never hardcoded):
 *   --env uat   -> UAT_SUPABASE_URL  + UAT_SUPABASE_KEY
 *   --env prod  -> reads ./.env (REACT_APP_SUPABASE_*) unless PROD_SUPABASE_* are set
 */
const fs = require("fs");
const path = require("path");

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? def : (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true);
};
const has = (name) => argv.includes(`--${name}`);

const env = flag("env");
const ordersArg = flag("orders");
const overrideTo = flag("to");
const doSend = has("send");

if (!env || !["uat", "prod"].includes(env) || !ordersArg || ordersArg === true) {
  console.error("Usage: node scripts/resend-order-pdf.js --env <uat|prod> --orders <no,no,...> [--to <phone>] [--send]");
  process.exit(1);
}

// Prod sending is the irreversible one: real messages to real clients.
if (env === "prod" && doSend && !has("i-know-this-is-prod")) {
  console.error("Refusing: --env prod --send also requires --i-know-this-is-prod");
  process.exit(1);
}

const orderNos = String(ordersArg).split(",").map((s) => s.trim()).filter(Boolean);

// ---------- credentials ----------
function readDotEnv() {
  const p = path.join(process.cwd(), ".env");
  if (!fs.existsSync(p)) return {};
  return Object.fromEntries(
    fs.readFileSync(p, "utf8").split(/\r?\n/)
      .map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean)
      .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, "")])
  );
}

let URL_, KEY_;
if (env === "uat") {
  URL_ = process.env.UAT_SUPABASE_URL;
  KEY_ = process.env.UAT_SUPABASE_KEY;
  if (!URL_ || !KEY_) {
    console.error("Missing UAT_SUPABASE_URL / UAT_SUPABASE_KEY in the environment.");
    console.error("PowerShell:  $env:UAT_SUPABASE_URL='https://<ref>.supabase.co'; $env:UAT_SUPABASE_KEY='<anon key>'");
    process.exit(1);
  }
} else {
  const dot = readDotEnv();
  URL_ = process.env.PROD_SUPABASE_URL || dot.REACT_APP_SUPABASE_URL;
  KEY_ = process.env.PROD_SUPABASE_KEY || dot.REACT_APP_SUPABASE_KEY;
  if (!URL_ || !KEY_) { console.error("Could not resolve prod credentials."); process.exit(1); }
}

const ref = (URL_.match(/https:\/\/([^.]+)\./) || [])[1] || "?";

// ---------- main ----------
(async () => {
  console.log(`\nproject : ${ref}  (--env ${env})`);
  console.log(`mode    : ${doSend ? "SEND" : "DRY RUN (nothing will be sent)"}`);
  if (overrideTo && overrideTo !== true) console.log(`override: all messages -> ${overrideTo}`);
  console.log("");

  const q = orderNos.map((n) => `"${n}"`).join(",");
  const res = await fetch(
    `${URL_}/rest/v1/orders?select=order_no,delivery_name,delivery_phone,delivery_country,customer_url&order_no=in.(${q})`,
    { headers: { apikey: KEY_, Authorization: `Bearer ${KEY_}` } }
  );
  if (!res.ok) { console.error("Order fetch failed:", res.status, await res.text()); process.exit(1); }
  const rows = await res.json();

  for (const n of orderNos) {
    if (!rows.find((r) => r.order_no === n)) console.warn(`!  ${n} — not found, skipping`);
  }

  let sent = 0, skipped = 0, failed = 0;

  for (const o of rows) {
    // The template's button REQUIRES a URL parameter — sending without one is
    // the exact (#131008) Meta rejection this whole investigation was about.
    if (!o.customer_url) {
      console.warn(`!  ${o.order_no} — no customer_url, skipping (would 400)`);
      skipped++;
      continue;
    }

    const to = (overrideTo && overrideTo !== true) ? String(overrideTo) : o.delivery_phone;
    if (!to) { console.warn(`!  ${o.order_no} — no phone, skipping`); skipped++; continue; }

    const body = {
      customerName: o.delivery_name,
      customerPhone: to,
      customerCountry: (overrideTo && overrideTo !== true) ? "India" : (o.delivery_country || "India"),
      template: "store_orderplaced_dev",
      pdfUrl: o.customer_url,
    };

    if (!doSend) {
      console.log(`DRY  ${o.order_no} -> ${to}  (${o.delivery_name})`);
      console.log(`     pdf: ${o.customer_url}`);
      continue;
    }

    try {
      const r = await fetch(`${URL_}/functions/v1/spur-whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: KEY_, Authorization: `Bearer ${KEY_}` },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.success) {
        console.log(`OK   ${o.order_no} -> ${to}   msgId=${j?.data?.id ?? "?"}  wamid=${j?.data?.metaMessageId ?? "?"}`);
        sent++;
      } else {
        console.error(`FAIL ${o.order_no} -> ${to}  HTTP ${r.status}  ${JSON.stringify(j).slice(0, 300)}`);
        failed++;
      }
    } catch (e) {
      console.error(`FAIL ${o.order_no} -> ${to}  ${e.message}`);
      failed++;
    }

    // WhatsApp dislikes bursts to one number; these five are all the same client.
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(`\nsent=${sent} skipped=${skipped} failed=${failed}${doSend ? "" : "  (dry run)"}\n`);
})();
