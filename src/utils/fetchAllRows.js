import { supabase } from "../lib/supabaseClient";

// Supabase enforces a default 1000-row cap per request (configurable per project).
// To fetch tables that exceed this, paginate with .range() in chunks until
// fewer than PAGE_SIZE rows come back.
const PAGE_SIZE = 1000;

/**
 * Fetch every row from a Supabase table, working around the 1000-row default cap.
 *
 * Usage:
 *   const { data, error } = await fetchAllRows("orders", (q) =>
 *     q.select("*").order("created_at", { ascending: false }).eq("status", "pending")
 *   );
 *
 * @param {string} table - Table name (e.g. "orders")
 * @param {(qb) => any} buildQuery - Callback that receives `supabase.from(table)`
 *   and returns the configured query (with .select(), filters, .order(), etc.).
 *   Do NOT call .range() or .limit() inside — this helper handles pagination.
 *   If omitted, defaults to `q.select("*")`.
 * @returns {Promise<{ data: any[], error: any }>}
 */
export async function fetchAllRows(table, buildQuery) {
  const all = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const configured = buildQuery
      ? buildQuery(supabase.from(table))
      : supabase.from(table).select("*");
    const { data, error } = await configured.range(from, to);
    if (error) return { data: null, error };
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { data: all, error: null };
}
