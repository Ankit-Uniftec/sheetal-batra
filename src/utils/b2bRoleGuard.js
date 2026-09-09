/**
 * B2B ROLE GATE — the one place that decides "is this user allowed on this
 * B2B screen", for the nine screens that used to inline their own copy.
 *
 * WHY THIS EXISTS: every copy read the role as `const { data: sp } = await
 * supabase.from("salesperson")...` — dropping `error` on the floor. A failed
 * read (network blip, an expired JWT being refreshed mid-request, an RLS or
 * statement timeout) returns data === null, which is byte-for-byte identical
 * to "this user has no role". The screens then called supabase.auth.signOut().
 *
 * So a transient read failure logged the user out. That is the reported bug:
 * placing a B2B stock order hangs on loading (the effect early-returned before
 * ever clearing its loading state), and the refresh lands on a screen whose
 * guard re-runs against a session that has since been destroyed -> login.
 *
 * A read that did not complete is NOT an authorization denial. Only an actual
 * answer from the DB can deny. On error we fail closed on navigation (send the
 * user back, they can retry) but never destroy their session.
 */
import { supabase } from "../lib/supabaseClient";

// The three B2B roles. Screens that need exactly one role pass their own list.
export const B2B_ROLES = ["executive", "merchandiser", "production"];

/**
 * @returns {{ ok: true, user, role: string }}
 *        | { ok: false, reason: "unauthenticated" | "denied" | "unavailable", user?, error? }
 *
 * Callers must branch on `reason`:
 *   unauthenticated -> navigate("/login")            (no session at all)
 *   denied          -> signOut() + navigate("/login") (a real answer: wrong role)
 *   unavailable     -> show an error / navigate back; DO NOT sign out.
 */
export async function checkB2bRole(allowedRoles = B2B_ROLES) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData?.user || null;

  // getUser() failing is a transport problem, not proof of no session.
  if (authError) return { ok: false, reason: "unavailable", error: authError };
  if (!user) return { ok: false, reason: "unauthenticated" };

  // maybeSingle(), never single(): single() raises PGRST116 when it gets zero
  // rows, so a legitimately-missing profile arrived as an error and was
  // indistinguishable from a broken connection.
  const { data: sp, error } = await supabase
    .from("salesperson")
    .select("role")
    .eq("email", user.email?.toLowerCase())
    .maybeSingle();

  if (error) return { ok: false, reason: "unavailable", user, error };
  if (!sp?.role || !allowedRoles.includes(sp.role)) {
    return { ok: false, reason: "denied", user };
  }
  return { ok: true, user, role: sp.role };
}
