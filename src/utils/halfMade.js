import { supabase } from "../lib/supabaseClient";
import { fetchAllRows } from "./fetchAllRows";

// ============================================================
// Half Made Inventory (Release 15).
//
// A piece in production (order cancelled, piece damaged, other) is MOVED to
// Half Made Inventory with a snapshot of what it is and every stage done; a
// piece of another order that has not started can later USE it and continue
// from the stage it reached (meeting point 21). The rules live in the database
// (db/meeting_points/r15_01): move_to_half_made, use_half_made_piece,
// write_off_half_made. This file is the app's side of them.
// ============================================================

// Who may move / use a piece (decision 2026-10-19: everyone in production).
// Mirrors is_production_user() in r15_01 — the database is the real gate.
// Release 16: the Shopify Orders desk counts too (website production).
export const PRODUCTION_ROLES = ["production_manager", "warehouse", "production", "scan_station", "shopify_orders"];
export const HALF_MADE_REASONS = ["Order cancelled", "Damaged", "Other"];
export const PHOTO_BUCKET = "half-made-photos";
export const PHOTO_TYPES = ["image/jpeg", "image/png"];
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** The logged-in user's role from salesperson (null when unknown). */
export async function fetchMyRole() {
  const { data: auth } = await supabase.auth.getUser();
  const email = auth?.user?.email;
  if (!email) return { email: null, role: null };
  const { data } = await supabase.from("salesperson").select("role").eq("email", email.toLowerCase()).maybeSingle();
  return { email, role: data?.role || null };
}

export const isProductionRole = (role) => PRODUCTION_ROLES.includes(role);

export async function moveToHalfMade({ componentId, reason, note, by, confirmActive = false }) {
  const { data, error } = await supabase.rpc("move_to_half_made", {
    p_component_id: componentId,
    p_reason: reason,
    p_note: note || null,
    p_by: by,
    p_confirm_active: confirmActive,
  });
  if (error) throw error;
  return data;
}

export async function applyHalfMadePiece({ halfMadeId, targetComponentId, by }) {
  const { data, error } = await supabase.rpc("use_half_made_piece", {
    p_half_made_id: halfMadeId,
    p_target_component_id: targetComponentId,
    p_by: by,
  });
  if (error) throw error;
  return data;
}

export async function writeOffHalfMade({ halfMadeId, reason, by }) {
  const { data, error } = await supabase.rpc("write_off_half_made", {
    p_half_made_id: halfMadeId,
    p_reason: reason,
    p_by: by,
  });
  if (error) throw error;
  return data;
}

/** Every half-made piece, newest first (optionally one status). */
export async function listHalfMade({ status } = {}) {
  const { data, error } = await fetchAllRows("half_made_inventory", (q) => {
    let query = q.select("*").order("moved_at", { ascending: false });
    if (status) query = query.eq("status", status);
    return query;
  });
  if (error) throw error;
  return data || [];
}

export const validatePhoto = (file) => {
  if (!file) return "Choose a photo.";
  if (!PHOTO_TYPES.includes(file.type)) return "Only JPEG or PNG photos can be uploaded.";
  if (file.size > PHOTO_MAX_BYTES) return `The photo is ${(file.size / 1048576).toFixed(1)} MB — the limit is 5 MB.`;
  return null;
};

/** Optional photo of a half-made piece. Never deleted (no delete rule). */
export async function uploadHalfMadePhoto(halfMadeId, file) {
  const problem = validatePhoto(file);
  if (problem) throw new Error(problem);
  const ext = file.type === "image/png" ? "png" : "jpg";
  const path = `${halfMadeId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  const { error: rpcErr } = await supabase.rpc("add_half_made_photo", { p_half_made_id: halfMadeId, p_path: path });
  if (rpcErr) throw rpcErr;
  return path;
}

export async function photoUrl(path) {
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, 600);
  if (error) throw error;
  return data.signedUrl;
}

// ---- Picking a half-made piece for a new piece ----------------------------
const norm = (s) => String(s || "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const colorName = (c) => (c && typeof c === "object" ? c.name || "" : c || "");

/**
 * Available half-made pieces that could become `target` (same piece type),
 * best match first: same product, then shared words in the product name,
 * then same colour, then same size; newest first among equals.
 *
 * @param {object}   target  order_components row { component_type }
 * @param {object}   item    the target's order line { product_name, size, top_color, bottom_color }
 * @param {object[]} pieces  half_made_inventory rows
 * @returns {{ piece, score, why: string[] }[]}
 */
export function rankHalfMadeFor(target, item, pieces) {
  const product = norm(item?.product_name);
  const words = new Set(product.split(" ").filter((w) => w.length > 2));
  const colors = [colorName(item?.top_color), colorName(item?.bottom_color)].map(norm).filter(Boolean);
  const size = norm(item?.size || item?.size_label);

  return (pieces || [])
    .filter((p) => p.status === "available" && p.component_type === target?.component_type)
    .map((p) => {
      const why = [];
      let score = 0;
      const pp = norm(p.product_name);
      if (product && pp === product) { score += 100; why.push("same product"); }
      else {
        const shared = pp.split(" ").filter((w) => words.has(w)).length;
        if (shared) { score += 10 * shared; why.push(`${shared} word${shared === 1 ? "" : "s"} of the name match`); }
      }
      if (colors.length && String(p.colors || "").split("/").map(norm).some((c) => c && colors.includes(c))) { score += 5; why.push("same colour"); }
      if (size && norm(p.size) === size) { score += 3; why.push("same size"); }
      return { piece: p, score, why };
    })
    .sort((a, b) => b.score - a.score || String(b.piece.moved_at).localeCompare(String(a.piece.moved_at)));
}

// ---- Exact matches: the order-card suggestion (Release 16) -----------------
// Decision 2026-10-19 (option A): a half-made piece is SUGGESTED only when the
// piece type, product name, size AND colour(s) are the same — compared the way
// the database compares them (hm_norm / hm_item_key / hm_row_key in
// db/meeting_points/r16_01), so the card badge and the notification agree.
const colorsKeyOfItem = (item) =>
  [colorName(item?.top_color), colorName(item?.bottom_color)].map(norm).filter(Boolean).join("/");
const colorsKeyOfText = (text) => String(text || "").split("/").map(norm).filter(Boolean).join("/");

/** The match key of an order line for a piece type. */
export const itemMatchKey = (type, item) =>
  [String(type || "").toLowerCase(), norm(item?.product_name), norm(item?.size || item?.size_label), colorsKeyOfItem(item)].join("|");

/** The match key of a half-made piece. */
export const halfMadeMatchKey = (hm) =>
  [String(hm?.component_type || "").toLowerCase(), norm(hm?.product_name), norm(hm?.size), colorsKeyOfText(hm?.colors)].join("|");

/** Available half-made pieces that exactly match this piece type + order line. */
export const exactHalfMadeMatches = (type, item, pieces) => {
  const key = itemMatchKey(type, item);
  return (pieces || []).filter((p) => p.status === "available" && halfMadeMatchKey(p) === key);
};
