import { supabase } from "../lib/supabaseClient";
import { releaseStockPiece } from "./shopifyInventory";
import { staffClient } from "./staffSession";

// ============================================================
// Release 35 — piece labels (one per garment): NAS-RED-ST-L-001.
//
// The code is looked up in `stock_pieces`, never decoded from its letters.
// Holding / releasing goes through shopify-inventory-v2 (holdStockPiece /
// releaseStockPiece in shopifyInventory.js) because an LXRTS hold changes
// Shopify. Everything here is plain database reads/RPCs.
//
// Pieces held by the order in progress are listed in sessionStorage
// (HELD_KEY) so the order screens can keep them alive and the review screen
// can sell them. Leaving the order flow stops the keep-alive; the hold then
// runs out and the every-minute sync puts the piece back on sale.
// ============================================================

export const HELD_KEY = "sbHeldPieces";
export const KEEP_ALIVE_MS = 5 * 60 * 1000;

// Same shape the database makes: 3 letters - 3 letters - ST|CT - size - serial.
const PIECE_CODE_RE = /^[A-Z]{3}-[A-Z]{3}-(ST|CT)-[A-Z0-9]+-\d{3,}$/;
export const looksLikePieceCode = (code) => PIECE_CODE_RE.test(String(code || "").trim().toUpperCase());

/** First 3 letters A–Z of a word, upper case (mirrors stock_piece_letters in SQL). */
export const pieceLetters = (text) => String(text || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);

export function readHeldCodes() {
  try {
    const v = JSON.parse(sessionStorage.getItem(HELD_KEY) || "[]");
    return Array.isArray(v) ? v.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function writeHeldCodes(codes) {
  try {
    const unique = [...new Set((codes || []).filter(Boolean))];
    if (unique.length) sessionStorage.setItem(HELD_KEY, JSON.stringify(unique));
    else sessionStorage.removeItem(HELD_KEY);
  } catch { /* storage blocked: holds simply expire on time */ }
}

/** Extend this SA's holds (order form still open). Never throws. */
export async function extendHolds(codes) {
  if (!codes?.length) return 0;
  const db = await staffClient();
  const { data, error } = await db.rpc("stock_pieces_extend", { p_codes: codes });
  if (error) { console.warn("Keeping piece holds failed:", error.message); return 0; }
  return data || 0;
}

/**
 * Order placed: mark the scanned pieces sold.
 * @returns {Promise<Object>} code → { result, stock_done }. Empty on any failure,
 *   which makes the order lower stock the old way (never blocks placement).
 */
export async function sellStockPieces(codes, orderNo) {
  const out = {};
  if (!codes?.length) return out;
  try {
    const db = await staffClient(); // as the SA: the live session is the customer's
    const { data, error } = await db.rpc("stock_pieces_sell", { p_codes: codes, p_order_no: orderNo || null });
    if (error) { console.error("Marking scanned pieces sold failed:", error.message); return out; }
    (data || []).forEach((r) => { out[String(r.code).toUpperCase()] = r; });
  } catch (err) {
    console.error("Marking scanned pieces sold failed:", err);
  }
  return out;
}

/** Release every hold this order flow still lists (order abandoned). Never throws. */
export async function releaseAllHeld() {
  const codes = readHeldCodes();
  writeHeldCodes([]);
  await Promise.all(codes.map((c) => releaseStockPiece(c).catch(() => null)));
}

/** All pieces of some designs (for the SA inventory / Stock Room). */
export async function loadPieces(productIds) {
  let q = supabase.from("stock_pieces")
    .select("code, product_id, colour, colour_type, size, serial, mrp, status, held_by, held_by_name, held_store, held_until, sold_order_no, sold_at, created_at")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (productIds?.length) q = q.in("product_id", productIds);
  const { data, error } = await q;
  if (error) return { pieces: [], installed: !/does not exist|schema cache|PGRST205|42P01/i.test(`${error.code} ${error.message}`) };
  return { pieces: data || [], installed: true };
}

/** One piece by its code (read only — for "what is this garment?"). */
export async function findPiece(code) {
  const { data, error } = await supabase.from("stock_pieces").select("*").eq("code", String(code || "").trim().toUpperCase()).maybeSingle();
  if (error) throw new Error(/does not exist|schema cache/i.test(error.message) ? "Piece labels are not set up yet." : error.message);
  return data;
}

/** Short wording for a scan result the SA must act on. */
export function scanProblem(r) {
  const p = r?.piece || {};
  const time = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "");
  switch (r?.result) {
    case "not_found": return { title: "Label not recognised", message: `No piece has the code ${r.code || ""}. Check the label or scan again.` };
    case "sold": return { title: "Already sold", message: `${p.code} was sold on order ${p.sold_order_no || "—"}.` };
    case "void": return { title: "Label cancelled", message: `${p.code} was cancelled by the Stock Room${p.void_reason ? ` (${p.void_reason})` : ""}. Ask them for a new label.` };
    case "held_by_other": return {
      title: "Held by another SA",
      message: `${p.code} is held by ${p.held_by_name || p.held_by || "another SA"}${p.held_store ? ` at ${p.held_store}` : ""} until ${time(p.held_until)}. It frees up if their order is not placed.`,
    };
    default: return null;
  }
}

/**
 * What a label prints for a product name (client format, Release 35):
 *   "NASIRA - RED HABUTAI SILK GOTA PATTI KURTA" + colour "Red"
 *   → { title: "NASIRA", description: "HABUTAI SILK GOTA PATTI KURTA" }
 * The colour is removed from the name only on the label. "LXRTS" never
 * prints (it is an internal word), with or without brackets.
 */
export function labelNameParts(name, colour) {
  let text = String(name || "").replace(/\(\s*lxrts\s*\)/gi, " ").replace(/\blxrts\b\s*-?\s*/gi, " ");
  text = text.replace(/\s+/g, " ").trim().replace(/^-\s*/, "");
  const at = text.indexOf(" - ");
  let title = at >= 0 ? text.slice(0, at) : text;
  let description = at >= 0 ? text.slice(at + 3) : "";
  const c = String(colour || "").trim();
  if (c) {
    const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "gi");
    description = description.replace(re, " ");
    if (description.trim()) title = title.replace(re, " ");
  }
  const tidy = (s) => s.replace(/\s+/g, " ").replace(/^[\s,-]+|[\s,-]+$/g, "").trim().toUpperCase();
  return { title: tidy(title), description: tidy(description) };
}
