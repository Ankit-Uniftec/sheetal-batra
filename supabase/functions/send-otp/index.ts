// supabase/functions/send-otp/index.ts
//
// FIXES:
//  - Bug 5: no server-side phone validation — malformed/typo numbers still sent.
//    Now we validate E.164 shape (defense-in-depth; the client also validates
//    with libphonenumber-js). Rejects clearly-invalid numbers before sending.
//  - Bug 6: rate limit keyed on the exact phone STRING, so a typo'd variant
//    bypassed it. Now rate-limit on the normalized (digits-only) phone.
//  - Nov 2026: Spur sometimes answers with an HTML error page instead of JSON.
//    That crashed the function and the raw "Unexpected token '<'" text reached
//    the store's screen, and the stored OTP row then blocked a retry for 30s.
//    Now: Spur's reply is read as text, a failed send is retried once with the
//    same code, and if it still fails the OTP row is removed (so the store can
//    retry straight away) and a plain-English JSON error is returned.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SPUR_API_URL = Deno.env.get("SPUR_API_URL") || "https://api.spurnow.com";
const SPUR_API_KEY = Deno.env.get("SPUR_API_KEY");
const SPUR_FROM_NUMBER = "919667706043";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SEND_FAILED_MESSAGE = "Couldn't send the OTP on WhatsApp right now. Please try again in a minute.";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const generateOTP = (): string => Math.floor(100000 + Math.random() * 900000).toString();

const digitsOnly = (phone: string): string => (phone || "").replace(/\D/g, "");

// Basic E.164 sanity check (defense-in-depth; the client validates per-country
// with libphonenumber-js). E.164 = optional '+', country code + national number,
// total 8–15 digits.
const isPlausibleE164 = (phone: string): boolean => {
  const d = digitsOnly(phone);
  return d.length >= 8 && d.length <= 15;
};

const formatPhoneForWhatsApp = (phone: string): string => {
  let formatted = digitsOnly(phone);
  if (formatted.startsWith("0")) formatted = formatted.slice(1);
  return formatted;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One call to Spur. Never throws: returns ok + status + a short description.
// Spur's reply is read as text first because it is sometimes an HTML page.
async function sendViaSpur(payload: unknown): Promise<{ ok: boolean; status: number; detail: string }> {
  try {
    const response = await fetch(`${SPUR_API_URL}/send-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SPUR_API_KEY}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* not JSON, e.g. an HTML error page */ }
    if (response.ok && parsed !== null) return { ok: true, status: response.status, detail: "" };
    const detail = parsed !== null
      ? JSON.stringify(parsed).slice(0, 500)
      : `non-JSON reply (${response.headers.get("content-type") || "no content-type"}): ${text.slice(0, 200).replace(/\s+/g, " ")}`;
    return { ok: false, status: response.status, detail };
  } catch (e) {
    return { ok: false, status: 0, detail: `request failed: ${(e as Error).message}` };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { phone } = await req.json();

    if (!phone) return json({ success: false, error: "Phone number is required" }, 400);

    // Server-side validation (Bug 5) — reject implausible numbers before sending.
    if (!isPlausibleE164(phone)) return json({ success: false, error: "Invalid phone number" }, 400);

    if (!SPUR_API_KEY) {
      console.error("SPUR_API_KEY not configured");
      return json({ success: false, error: "SPUR_API_KEY not configured" }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const phoneDigits = digitsOnly(phone);

    // Rate limit (Bug 6) — keyed on normalized digits.
    const { data: recentOtps } = await supabase
      .from("otp_codes")
      .select("phone, created_at")
      .gte("created_at", new Date(Date.now() - 30 * 1000).toISOString());

    const hitRecently = (recentOtps || []).some((r) => digitsOnly(r.phone) === phoneDigits);
    if (hitRecently) {
      return json({ success: false, error: "Please wait 30 seconds before requesting another OTP" }, 429);
    }

    // Delete any existing OTPs for this phone (exact string — that's how it was
    // stored; verify-otp matches the same string the client sends).
    await supabase.from("otp_codes").delete().eq("phone", phone);

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    const { error: insertError } = await supabase
      .from("otp_codes")
      .insert({ phone: phone, code: otp, expires_at: expiresAt.toISOString() });

    if (insertError) {
      console.error("Failed to store OTP:", insertError);
      return json({ success: false, error: "Failed to generate OTP" }, 500);
    }

    const whatsappPhone = formatPhoneForWhatsApp(phone);
    console.log(`Sending OTP to ${whatsappPhone}`);

    const payload = {
      channel: "whatsapp",
      to: whatsappPhone,
      content: {
        type: "template",
        template: {
          name: "otp_verification",
          components: [{ type: "body", parameters: [{ type: "text", text: otp }] }],
          language: { code: "en" },
        },
      },
      options: { from: SPUR_FROM_NUMBER },
    };

    // Try twice with the SAME code, so whichever message arrives still works.
    let attempt = await sendViaSpur(payload);
    if (!attempt.ok) {
      console.error(`Spur send failed (try 1, status ${attempt.status}): ${attempt.detail}`);
      await sleep(1500);
      attempt = await sendViaSpur(payload);
    }

    if (!attempt.ok) {
      console.error(`Spur send failed (try 2, status ${attempt.status}): ${attempt.detail}`);
      // Remove the code so the 30-second limit doesn't block an immediate retry.
      await supabase.from("otp_codes").delete().eq("phone", phone).eq("code", otp);
      return json({ success: false, error: SEND_FAILED_MESSAGE, spur_status: attempt.status }, 502);
    }

    console.log("✅ OTP sent successfully via WhatsApp");
    return json({ success: true, message: "OTP sent to WhatsApp", expiresIn: 300 }, 200);
  } catch (error) {
    console.error("Edge function error:", error);
    return json({ success: false, error: SEND_FAILED_MESSAGE }, 500);
  }
});
