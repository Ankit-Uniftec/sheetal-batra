import config from "../config/config";

/**
 * appEnvironment — which Supabase project this build is pointed at.
 *
 * PROD and UAT are two DIFFERENT Supabase projects, so a `.env` is NOT
 * necessarily prod (see CLAUDE.md). The project ref inside REACT_APP_SUPABASE_URL
 * is the only reliable signal available in the client, so that is what we read —
 * NODE_ENV would say "production" for any `npm run build`, including a UAT build.
 *
 * Use this ONLY for the handful of values that are genuinely a different real-world
 * identity per environment (e.g. a person's login address differs between the two
 * projects). Anything role- or permission-shaped belongs in the DB, not here.
 */

// Supabase project refs, from the dashboard URLs.
const PROD_PROJECT_REF = "qlqvchcvuwjnfranqcmx";
const UAT_PROJECT_REF = "pgtiikhukgeyjcpjndqh";

// "https://<ref>.supabase.co" -> "<ref>"
const projectRef = (() => {
  try {
    return new URL(config.SUPABASE_URL || "").hostname.split(".")[0] || "";
  } catch {
    return "";
  }
})();

export const isProdEnvironment = projectRef === PROD_PROJECT_REF;
export const isUatEnvironment = projectRef === UAT_PROJECT_REF;

/**
 * Pick the value for the current environment.
 * Falls back to the UAT value on an unrecognised project (a local/dev clone), so
 * a stray project ref can never hand out prod-only access.
 *
 * @param {{prod: any, uat: any}} values
 */
export const byEnvironment = ({ prod, uat }) => (isProdEnvironment ? prod : uat);

/**
 * B2B merchandisers who may cancel a B2B order at ANY time (a reason is still
 * required). Every other merchandiser has the 48-hour window.
 *
 * Prastuti and Tanuja, not Khushi (client decision, 2026-10-11, meeting points
 * 1/17). Production visibility — View Journey and QC Report — is no longer
 * tied to this list: every merchandiser has it.
 *
 * Login addresses differ between the two projects, hence the split.
 */
export const B2B_CANCEL_ANYTIME_EMAILS = byEnvironment({
  prod: [
    "merchendiser.sheetalbatra@gmail.com", // Prastuti Kaushik
    "merchendiser2.sheetalbatra@gmail.com", // Tanuja Singh
  ],
  uat: ["merch@sheetalbatra.com"],
});

/** Case-insensitive check that `email` is on that list. */
export const canCancelB2bAnytime = (email) =>
  !!email && B2B_CANCEL_ANYTIME_EMAILS.includes(email.trim().toLowerCase());
