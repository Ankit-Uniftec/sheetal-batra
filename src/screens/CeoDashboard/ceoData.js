import { supabase } from "../../lib/supabaseClient";
import { fetchAllRows } from "../../utils/fetchAllRows";
import { fetchAllRowsParallel, selectAllExcept } from "../../utils/fetchAllRowsParallel";
import { fetchQcRecords } from "../../utils/qcHistory";
import { fetchAllExhibitions } from "../../utils/exhibitionService";

// ============================================================
// How the dashboard gets its data quickly:
//   1. The last copy is kept in this browser, so opening again is instant.
//   2. Fresh data then loads quietly behind the page and replaces it.
//   3. With no saved copy, the newest orders arrive first and the page opens on
//      those, while the rest of the history keeps loading.
// The saved copy is tied to the signed-in email and is wiped on log out.
// ============================================================

const DB = "sb-ceo-dashboard";
const STORE = "snapshots";
const MAX_AGE = 7 * 864e5;
const PAGE = 1000;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = action(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

export async function readSnapshot(email) {
  try {
    const snap = await run("readonly", (s) => s.get(email));
    if (!snap || Date.now() - snap.savedAt > MAX_AGE) return null;
    return snap;
  } catch {
    return null;
  }
}

export async function saveSnapshot(email, data) {
  try {
    await run("readwrite", (s) => s.put({ ...data, savedAt: Date.now() }, email));
  } catch {
    // A full or blocked browser store only costs the next instant open.
  }
}

export async function clearSnapshots() {
  try {
    await run("readwrite", (s) => s.clear());
  } catch {
    // Nothing saved, nothing to clear.
  }
}

/** Newest orders first, handing each batch over as it arrives. */
export async function loadOrders(onBatch) {
  // orders.shopify_raw is over half of an order row and nothing here reads it.
  const columns = await selectAllExcept("orders", ["shopify_raw"]);
  const fetchPage = async (p) => {
    const attempt = () => supabase.from("orders").select(columns)
      .order("created_at", { ascending: false }).order("id")
      .range(p * PAGE, (p + 1) * PAGE - 1);
    let res = await attempt();
    if (res.error) {
      await new Promise((r) => setTimeout(r, 600));
      res = await attempt();
    }
    if (res.error) throw res.error;
    return res.data || [];
  };
  const seen = new Set();
  const all = [];
  let page = 0;
  let more = true;
  while (more) {
    // eslint-disable-next-line no-loop-func
    const wave = await Promise.all([page, page + 1, page + 2].map(fetchPage));
    for (const rows of wave) {
      rows.forEach((r) => { if (!seen.has(r.id)) { seen.add(r.id); all.push(r); } });
      if (rows.length < PAGE) more = false;
    }
    page += 3;
    onBatch?.([...all], !more);
  }
  return all;
}

const quietly = (promise, fallback) => Promise.resolve(promise).catch(() => fallback);
const rows = (res) => res?.data || [];

/** What the first screen cannot do without. */
export const loadCore = async () => {
  const [products, people, vendors] = await Promise.all([
    // products_live, not products: reserved barcode rows have NULL inventory.
    fetchAllRows("products_live", (q) => q.select("*").order("name", { ascending: true })),
    supabase.from("salesperson").select("saleperson, role, email, phone, store_name, sales_target, designation"),
    supabase.from("vendors").select("id, store_brand_name, legal_name, vendor_code, is_active"),
  ]);
  return { products: rows(products), people: rows(people), vendors: rows(vendors) };
};

/** Everything else. A failure in any one of these never stops the page. */
export const loadExtras = async () => {
  const now = new Date();
  const [qc, payments, walkins, exhibitions, targets, consignment, profiles, movements] = await Promise.all([
    quietly(fetchQcRecords({ paged: true }), []),
    quietly(fetchAllRowsParallel("order_payments", (q) => q.select("id, order_id, amount, paid_at, payment_mode").order("id")).then(rows), []),
    quietly(fetchAllRows("walkins", (q) => q.select("id, sa_email, source, created_at, converted").order("id")).then(rows), []),
    quietly(fetchAllExhibitions(), []),
    quietly(supabase.from("sa_monthly_targets").select("salesperson_email, target_amount, year, month")
      .or(`year.lt.${now.getFullYear()},and(year.eq.${now.getFullYear()},month.lte.${now.getMonth() + 1})`).then(rows), []),
    quietly(supabase.from("consignment_inventory").select("*").then(rows), []),
    quietly(fetchAllRows("profiles", (q) => q.select("id, full_name, dob").not("dob", "is", null).order("id")).then(rows), []),
    quietly(fetchAllRowsParallel("external_movements", (q) => q.select("id, order_id, vendor_name, vendor_location, stages_outside, return_date, exit_scan_at, entry_scan_at, is_factory2").order("id")).then(rows), []),
  ]);
  return { qc: qc || [], payments, walkins, exhibitions: exhibitions || [], targets, consignment, profiles, movements };
};

// ---- Assignments from Today's Brief. The table arrives with r30_01; until then
// `available` is false and the page simply does not offer Assign.
const TABLE = "ceo_brief_assignments";

export async function loadAssignments() {
  const { data, error } = await supabase.from(TABLE).select("*").eq("status", "open").order("created_at", { ascending: false });
  if (error) return { available: false, rows: [] };
  return { available: true, rows: data || [] };
}

export async function saveAssignment(row) {
  const { data, error } = await supabase.from(TABLE).insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function closeAssignment(id, email) {
  const { error } = await supabase.from(TABLE).update({ status: "done", done_at: new Date().toISOString(), done_by: email }).eq("id", id);
  if (error) throw error;
}
