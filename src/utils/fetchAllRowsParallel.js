import { supabase } from "../lib/supabaseClient";

const PAGE_SIZE = 1000;
// Gentle on the live database: a page of wide rows is heavy to build, and the
// database (not the network) is the bottleneck. Measured on orders (1000-row
// pages): 1 at a time 17s, 2 → 11s, 3 → 8s; 4 plus other loads at once pushed
// single pages to ~10s and into statement timeouts.
const CONCURRENCY = 3;

/**
 * Fetch pages side by side instead of one after another.
 *
 * Asks for page 0 first; if it is full, asks for the next `concurrency` pages
 * AT ONCE, and keeps going wave by wave until a page comes back short or empty.
 * No row count is needed, so it works with any query. Pages are joined back in
 * page order, so the result is in the same order a one-by-one fetch gives.
 *
 * Over-fetches at most `concurrency - 1` empty pages at the end — cheap.
 * A page that fails (e.g. a statement timeout) is retried once.
 *
 * @param {(from: number, to: number) => Promise<{data, error}>} fetchPage
 * @param {{pageSize?: number, concurrency?: number, keyOf?: (row) => any}} opts
 *   keyOf: drop a row whose key was already seen (a row that slid across a page
 *   boundary because another row was inserted mid-fetch). Default: row.id.
 * @returns {Promise<{data: any[] | null, error: any}>}
 */
export async function fetchPagesParallel(rawFetchPage, { pageSize = PAGE_SIZE, concurrency = CONCURRENCY, keyOf = (r) => r?.id, retryDelayMs = 600 } = {}) {
  const pages = [];
  const fetchPage = async (from, to) => {
    const r = await rawFetchPage(from, to);
    if (!r.error) return r;
    await new Promise((res) => setTimeout(res, retryDelayMs));
    return rawFetchPage(from, to);
  };

  const first = await fetchPage(0, pageSize - 1);
  if (first.error) return { data: null, error: first.error };
  pages.push(first.data || []);

  let next = 1;
  let more = (first.data || []).length === pageSize;
  while (more) {
    const wave = [];
    for (let i = 0; i < concurrency; i++) {
      const p = next + i;
      wave.push(fetchPage(p * pageSize, (p + 1) * pageSize - 1));
    }
    const results = await Promise.all(wave);
    for (const r of results) {
      if (r.error) return { data: null, error: r.error };
      const rows = r.data || [];
      pages.push(rows);
      if (rows.length < pageSize) { more = false; break; }
    }
    next += concurrency;
  }

  const seen = new Set();
  const all = [];
  for (const rows of pages) {
    for (const row of rows) {
      const k = keyOf ? keyOf(row) : undefined;
      if (k !== undefined && k !== null) {
        if (seen.has(k)) continue;
        seen.add(k);
      }
      all.push(row);
    }
  }
  return { data: all, error: null };
}

/**
 * Same contract as fetchAllRows(table, buildQuery) — every row, past the
 * 1000-row cap — but pages are fetched in parallel. Give buildQuery a stable
 * order with a unique tie-breaker (e.g. .order("created_at").order("id")) so
 * page boundaries never shift.
 */
export function fetchAllRowsParallel(table, buildQuery, opts) {
  return fetchPagesParallel((from, to) => {
    const q = buildQuery ? buildQuery(supabase.from(table)) : supabase.from(table).select("*");
    return q.range(from, to);
  }, opts);
}

/**
 * A select list of every column of `table` EXCEPT `exclude` — for skipping a
 * heavy column nothing on the screen reads (e.g. orders.shopify_raw, over half
 * of an order row). The columns are read from one sample row, so a column
 * added later is still loaded. Falls back to "*" if the sample can't be read.
 */
export async function selectAllExcept(table, exclude = []) {
  const { data, error } = await supabase.from(table).select("*").limit(1);
  if (error || !data || !data[0]) return "*";
  const skip = new Set(exclude);
  return Object.keys(data[0]).filter((c) => !skip.has(c)).join(",");
}

/** Run async jobs `limit` at a time; results come back in job order. */
export async function runLimited(jobs, limit = CONCURRENCY) {
  const results = new Array(jobs.length);
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const idx = i++;
      results[idx] = await jobs[idx]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}
