import { supabase } from "../lib/supabaseClient";

// ============================================================
// Payment proofs (meeting point 26) — the one place that knows the bucket, the
// file rules, the "cash only" rule and how a proof is stored.
//
// Files live in the PRIVATE bucket `payment-proofs` and open through
// short-lived signed links: a proof is usually a screenshot of a bank or UPI
// app, so it must never have a public URL (the app's `attachments` bucket is
// public). Table + bucket + staff-only rules: db/meeting_points/
// r3_01_payment_proofs.sql. Nothing here deletes a proof — by design.
// ============================================================

export const PROOF_BUCKET = "payment-proofs";
export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const PROOF_TYPES = { "image/jpeg": "JPEG", "image/png": "PNG", "application/pdf": "PDF" };
export const PROOF_ACCEPT = ".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf";
export const CHECKPOINTS = [
  { value: "advance", label: "Advance" },
  { value: "balance", label: "Balance" },
];

const CLOSED = ["cancelled", "revoked"];

/**
 * A website (Shopify) order. The customer pays on the website, never to a
 * sales associate, so these get NO payment proof anywhere (client decision,
 * 2026-10-12). Same signals as the app's channel resolver: the SB-SHOPIFY- /
 * legacy SB-SHOP- prefix, or a Shopify order id on the row.
 */
export const isWebsiteOrder = (order) =>
  /^SB-SHOP(IFY)?-/i.test(String(order?.order_no || "")) || !!order?.shopify_order_id;

// "Cash" in any case / spacing. Exported for the Update Payment rows, which hide
// the proof picker on a cash row.
export const isCashMode = (mode) => String(mode || "").trim().toLowerCase() === "cash";
const isCash = isCashMode;

/**
 * Every payment mode recorded at order time: the plain payment_mode, or each
 * part of a split payment (payment_mode holds a JSON array of {mode, amount}).
 * Blank / missing modes are ignored — they say nothing either way.
 */
export function orderTimeModes(order) {
  const raw = order?.payment_mode;
  if (raw == null || String(raw).trim() === "") return [];
  if (order?.is_split_payment || String(raw).trim().startsWith("[")) {
    try {
      const parts = JSON.parse(raw);
      if (Array.isArray(parts)) return parts.map((p) => p?.mode).filter((m) => m && String(m).trim());
    } catch {
      /* not JSON — treat as one plain mode */
    }
  }
  return [String(raw)];
}

/**
 * Should this order offer "Payment Proof"? Proof is for every payment mode
 * EXCEPT cash, so the button shows when at least one payment on the order is
 * non-cash: a mode taken at order time (any part of a split) or any later
 * balance payment (order_payments). An order whose every known payment is
 * cash gets no button. Cancelled / revoked orders get none either.
 *
 * @param {object}  order
 * @param {boolean} hasNonCashLaterPayment  any order_payments row for it that
 *                                          is not Cash (caller looks this up)
 */
export function canAttachPaymentProof(order, hasNonCashLaterPayment = false) {
  if (!order || isWebsiteOrder(order)) return false;
  if (CLOSED.includes(String(order.status || "").toLowerCase())) return false;
  if (hasNonCashLaterPayment) return true;
  return orderTimeModes(order).some((m) => !isCash(m));
}

/** null when the file is acceptable, otherwise the message to show. */
export function validateProofFile(file) {
  if (!file) return "Choose a file to upload.";
  if (!PROOF_TYPES[file.type]) return "Only JPEG, PNG or PDF files can be uploaded.";
  if (file.size > PROOF_MAX_BYTES) return `The file is ${(file.size / 1048576).toFixed(1)} MB — the limit is 5 MB.`;
  if (file.size === 0) return "The file is empty.";
  return null;
}

/** Proofs for one order, newest first. */
export async function listPaymentProofs(orderId) {
  const { data, error } = await supabase
    .from("payment_proofs")
    .select("id, checkpoint, payment_id, file_path, file_name, mime_type, size_bytes, uploaded_by, created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

/** A link that opens the file for 10 minutes. */
export async function proofSignedUrl(filePath) {
  const { data, error } = await supabase.storage.from(PROOF_BUCKET).createSignedUrl(filePath, 600);
  if (error) throw error;
  return data.signedUrl;
}

const EXT = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };

/**
 * Upload one proof: the file first, then its row. If the row cannot be written
 * the file is left in the bucket but nothing points at it (no delete rule
 * exists, by design), and the error is thrown so the user retries.
 */
export async function uploadPaymentProof({ order, checkpoint, file, uploadedBy, paymentId = null }) {
  const problem = validateProofFile(file);
  if (problem) throw new Error(problem);
  if (!CHECKPOINTS.some((c) => c.value === checkpoint)) throw new Error("Choose Advance or Balance.");

  // <order id>/<checkpoint>/<time>-<random>.<ext> — never the user's file
  // name, which can carry characters storage rejects.
  const path = `${order.id}/${checkpoint}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${EXT[file.type]}`;
  const { error: upErr } = await supabase.storage
    .from(PROOF_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw upErr;

  const { data, error } = await supabase
    .from("payment_proofs")
    .insert({
      order_id: order.id,
      order_no: order.order_no,
      checkpoint,
      file_path: path,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      uploaded_by: uploadedBy || null,
      payment_id: paymentId,   // the order_payments row it proves, when known
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}
