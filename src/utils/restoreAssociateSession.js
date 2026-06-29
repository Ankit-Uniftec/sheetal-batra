import { supabase } from "../lib/supabaseClient";

/**
 * Restore the SALES-ASSOCIATE login session after an order-placement flow.
 *
 * There are two distinct auth sessions in the order flow:
 *   1. The associate's LOGIN session  — saved to sessionStorage `associateSession`
 *      (access/refresh tokens) when the SA starts an order from the dashboard.
 *   2. The customer's ORDER-PLACING session — created by the WhatsApp OTP step
 *      (supabase.auth.verifyOtp), which REPLACES the live Supabase session.
 *
 * When the SA backs out of (or completes) the order flow, the customer's
 * order-placing session must be discarded and the associate's login session
 * put back, so the SA returns to their dashboard still logged in — instead of
 * the dashboard's role check seeing the customer user, failing, and bouncing
 * to /login.
 *
 * This logic used to live only inline in ProductForm's exit path, so backing
 * out earlier (e.g. the OTP / customer-details page, before ProductForm) never
 * restored the session and dumped the SA at the login screen. This helper is
 * the single source of truth, called from EVERY exit point of the flow.
 *
 * @param {(path: string, opts?: object) => void} navigate  react-router navigate
 * @returns {Promise<string>} the dashboard route the caller was sent to
 */
export async function restoreAssociateSession(navigate) {
  // Per-order form caches — always clear so a fresh order starts clean.
  sessionStorage.removeItem("screen4FormData");
  sessionStorage.removeItem("screen6FormData");

  // Route back to whichever dashboard the user started from. Stock orders
  // placed by non-SA roles (admin / GM / assistant_cmo) set returnDashboard
  // before navigating into the flow; the regular SA flow falls back to
  // /AssociateDashboard. Without this fallback, non-SA users hit the SA role
  // check on AssociateDashboard and get force-signed-out.
  const returnDashboard =
    sessionStorage.getItem("returnDashboard") || "/AssociateDashboard";

  try {
    const savedSession = sessionStorage.getItem("associateSession");

    if (savedSession) {
      const session = JSON.parse(savedSession);

      // Put the associate's login session back in Supabase, replacing the
      // customer's order-placing session created by OTP.
      const { error } = await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });

      if (error) {
        // Tokens expired / invalid — can't restore the SA; send to login.
        console.error("Failed to restore associate session:", error);
        navigate("/login", { replace: true });
        return "/login";
      }
    }

    // Clean up the order-flow breadcrumbs (whether or not a session existed)
    // so they can't leak into a later flow, then return to the dashboard. The
    // password-verification flag re-confirms the SA on the dashboard.
    sessionStorage.removeItem("associateSession");
    sessionStorage.removeItem("returnToAssociate");
    sessionStorage.removeItem("returnDashboard");
    sessionStorage.setItem("requirePasswordVerificationOnReturn", "true");
    navigate(returnDashboard, { replace: true });
    return returnDashboard;
  } catch (e) {
    console.error("restoreAssociateSession error:", e);
    navigate("/login", { replace: true });
    return "/login";
  }
}
