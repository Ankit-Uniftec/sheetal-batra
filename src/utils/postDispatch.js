import { supabase } from "../lib/supabaseClient";

// ============================================================
// B2B Revoke and Post Dispatch Action (point #1, Release 29).
//
// A Post Dispatch Action is a RECORD: what the partner reported after dispatch,
// with text and files. It changes nothing on the order, its pieces, money or
// stock. Rows are never edited or deleted (db r29_01).
// ============================================================

export const POST_DISPATCH_TYPES = [
  { value: "exchange", label: "Exchange" },
  { value: "return", label: "Return" },
  { value: "alteration", label: "Alteration" },
];
export const postDispatchLabel = (value) => POST_DISPATCH_TYPES.find((t) => t.value === value)?.label || value || "";

export const POST_DISPATCH_BUCKET = "post-dispatch-files";
export const POST_DISPATCH_MAX_FILES = 5;
export const POST_DISPATCH_MAX_BYTES = 5 * 1024 * 1024;
export const POST_DISPATCH_ACCEPT = ".jpg,.jpeg,.pdf,image/jpeg,application/pdf";

const REVOKE_AFTER_HOURS = 24;
const TERMINAL = ["cancelled", "revoked"];
const statusOf = (o) => String(o?.status || "").toLowerCase();
const hoursSince = (ts, now) => (ts ? (now - new Date(ts).getTime()) / 36e5 : Infinity);

/**
 * Has this order left? Same rule as the B2B Production dashboard's Dispatched
 * group: completed orders count, because that is how most older orders closed.
 * dispatched_at is never filled on B2B orders.
 */
export const isB2bDispatched = (o) =>
  ["completed", "delivered", "dispatched"].includes(statusOf(o)) || o?.warehouse_stage === "dispatched";

/** Does the Post Dispatch Action button show? Internal stock has no partner. */
export const canPostDispatch = (o) =>
  !!o && !o.is_stock_order && !TERMINAL.includes(statusOf(o)) && isB2bDispatched(o);

/** null when the order can be revoked, otherwise why not. */
export function revokeBlock(o, now = Date.now()) {
  if (!o) return { kind: "none", message: "" };
  if (TERMINAL.includes(statusOf(o))) return { kind: "done", message: `This order is already ${statusOf(o)}.` };
  if (o.is_stock_order) return { kind: "stock", message: "Internal stock orders can't be revoked." };
  if (isB2bDispatched(o)) return { kind: "shipped", message: "This order has been dispatched. Use Post Dispatch Action instead." };
  if (hoursSince(o.created_at, now) <= REVOKE_AFTER_HOURS) {
    return { kind: "early", message: `An order can be revoked ${REVOKE_AFTER_HOURS} hours after it was placed. Until then, cancel it.` };
  }
  return null;
}

/** null when the form can be saved, otherwise the message to show. */
export function validatePostDispatch({ actionType, note, files }) {
  if (!POST_DISPATCH_TYPES.some((t) => t.value === actionType)) return "Choose Exchange, Return or Alteration.";
  if (!String(note || "").trim()) return "Please describe the QC failure.";
  const list = files || [];
  if (list.length > POST_DISPATCH_MAX_FILES) return `Up to ${POST_DISPATCH_MAX_FILES} files.`;
  const bad = list.find((f) => !["image/jpeg", "application/pdf"].includes(f.type));
  if (bad) return `${bad.name} is not a JPEG or PDF.`;
  const big = list.find((f) => f.size > POST_DISPATCH_MAX_BYTES);
  if (big) return `${big.name} is larger than 5 MB.`;
  return null;
}

const orderValue = (o) => Number(o?.net_total ?? o?.grand_total_after_discount ?? o?.grand_total) || 0;

/**
 * Totals for the analytics. The same order can have several actions, so value
 * counts each order once per group it appears in.
 * @param {object[]} actions
 * @param {object}   ordersById
 * @param {object}   vendorMap  vendor id → vendors row
 */
export function summarisePostDispatch(actions, ordersById, vendorMap) {
  const rows = (actions || []).map((a) => {
    const o = ordersById?.[a.order_id];
    return {
      ...a,
      value: orderValue(o),
      partner: vendorMap?.[o?.vendor_id]?.store_brand_name || "—",
      merchandiser: String(o?.merchandiser_name || "").trim() || "—",
      po: o?.po_number || "",
    };
  });
  const groupBy = (keyOf) => {
    const map = new Map();
    rows.forEach((r) => {
      const key = keyOf(r);
      const g = map.get(key) || { key, count: 0, value: 0, orders: new Set() };
      g.count += 1;
      if (!g.orders.has(r.order_id)) { g.orders.add(r.order_id); g.value += r.value; }
      map.set(key, g);
    });
    return [...map.values()].map(({ orders, ...g }) => g).sort((a, b) => b.count - a.count);
  };
  const orderIds = new Set(rows.map((r) => r.order_id));
  return {
    rows,
    count: rows.length,
    orders: orderIds.size,
    value: [...orderIds].reduce((s, id) => s + orderValue(ordersById?.[id]), 0),
    byType: POST_DISPATCH_TYPES.map((t) => {
      const mine = groupBy((r) => r.action_type).find((g) => g.key === t.value);
      return { key: t.label, count: mine?.count || 0, value: mine?.value || 0 };
    }),
    byPartner: groupBy((r) => r.partner),
    byMerchandiser: groupBy((r) => r.merchandiser),
  };
}

/** Every action, newest first. Throws if the table is not there yet. */
export async function fetchPostDispatchActions() {
  const { data, error } = await supabase.from("b2b_post_dispatch_actions")
    .select("id, order_id, order_no, action_type, note, files, created_by, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export const groupActionsByOrder = (actions) =>
  (actions || []).reduce((m, a) => {
    (m[a.order_id] = m[a.order_id] || []).push(a);
    return m;
  }, {});

/** Files first, then the row. If the row fails nothing points at the files. */
export async function savePostDispatchAction({ order, actionType, note, files, by }) {
  const problem = validatePostDispatch({ actionType, note, files });
  if (problem) throw new Error(problem);
  const stored = [];
  for (const file of files || []) {
    const ext = file.type === "application/pdf" ? "pdf" : "jpg";
    const path = `${order.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from(POST_DISPATCH_BUCKET).upload(path, file, { contentType: file.type });
    if (error) throw error;
    stored.push({ path, name: file.name, type: file.type, size: file.size });
  }
  const { data, error } = await supabase.from("b2b_post_dispatch_actions").insert({
    order_id: order.id,
    order_no: order.order_no,
    action_type: actionType,
    note: note.trim(),
    files: stored,
    created_by: by,
  }).select("id, order_id, order_no, action_type, note, files, created_by, created_at").single();
  if (error) throw error;
  return data;
}

/** A link that opens the file for 10 minutes. */
export async function postDispatchFileUrl(path) {
  const { data, error } = await supabase.storage.from(POST_DISPATCH_BUCKET).createSignedUrl(path, 600);
  if (error) throw error;
  return data.signedUrl;
}
