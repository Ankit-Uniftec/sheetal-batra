import { createClient } from "@supabase/supabase-js";
import config from "../config/config";
import { supabase } from "../lib/supabaseClient";

// ============================================================
// Release 35 — act as the SALES ASSOCIATE during an order.
//
// Inside the order flow the live Supabase session belongs to the CUSTOMER
// (the WhatsApp OTP step replaces it — see restoreAssociateSession.js). The
// SA's own login is parked in sessionStorage `associateSession`. Piece holds
// belong to the SA, so those calls send the SA's token instead of the live one.
//
// If the parked access token is about to expire it is refreshed and the NEW
// pair is written back, so restoreAssociateSession later restores a valid
// session (a refresh token works once; the old pair is dead after this).
// Outside an order (no parked session) the live session is used.
// ============================================================

const KEY = "associateSession";

const expiresAt = (jwt) => {
  try {
    const part = String(jwt).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return (JSON.parse(atob(part)).exp || 0) * 1000;
  } catch {
    return 0;
  }
};

let refreshing = null;

async function refreshParked(saved) {
  const res = await fetch(`${config.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.SUPABASE_KEY },
    body: JSON.stringify({ refresh_token: saved.refresh_token }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(body.error_description || body.msg || "Could not refresh the SA login.");
  const next = { ...saved, access_token: body.access_token, refresh_token: body.refresh_token || saved.refresh_token };
  sessionStorage.setItem(KEY, JSON.stringify(next));
  return next.access_token;
}

/** The SA's access token (parked during an order, else the live session's). */
export async function getStaffToken() {
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { saved = null; }
  const { data: { session: live } } = await supabase.auth.getSession();
  const liveEmail = String(live?.user?.email || "").toLowerCase();
  // The live session is still the SA (no OTP step in this order): use it, and
  // never refresh the parked copy — the app keeps refreshing the live one, and
  // reusing a spent refresh token would sign the SA out.
  if (live?.access_token && liveEmail && liveEmail === String(saved?.user?.email || "").toLowerCase()) return live.access_token;
  if (saved?.access_token) {
    if (expiresAt(saved.access_token) - Date.now() > 90_000) return saved.access_token;
    if (saved.refresh_token) {
      if (!refreshing) refreshing = refreshParked(saved).finally(() => { refreshing = null; });
      try { return await refreshing; } catch (err) { console.warn(err.message); }
    }
  }
  return live?.access_token || null;
}

let cached = { token: null, client: null };

/** A database client signed in as the SA (for holds / sales of pieces). */
export async function staffClient() {
  const token = await getStaffToken();
  if (!token) return supabase;
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token === token) return supabase; // not inside an order: the live session IS the SA
  if (cached.token === token) return cached.client;
  cached = { token, client: null };
  cached.client = createClient(config.SUPABASE_URL, config.SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "sb-staff-oneoff" },
  });
  return cached.client;
}
