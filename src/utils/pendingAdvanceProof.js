import { uploadPaymentProof } from "./paymentProofs";

// ============================================================
// Advance proof picked WHILE PLACING an order (Release 12).
//
// The proof is chosen on the payment screen (/confirmDetail), but the order —
// and so its id, which the file is stored under — only exists after Place
// Order on the review screen (/orderDetail). In between, the File is held
// here, in this browser tab's memory: a File cannot be saved in a draft or in
// sessionStorage, so a page refresh or a resumed draft simply starts with no
// file (the review screen offers the picker again).
//
// It is uploaded by ReviewDetail straight after the order is inserted — under
// the customer's session, which r12_02 allows for an advance proof on their
// own order within its first hour — so closing the app afterwards loses
// nothing. Anything not attached here is added later from Update Payment or
// the order page.
//
// Keyed by the advance part ("UPI|5000", see advanceProofParts), so a file
// picked for a part that no longer exists (mode or amount changed) is ignored.
// ============================================================

let pending = {};

export const getPendingAdvanceProofs = () => ({ ...pending });

export function setPendingAdvanceProof(key, file) {
  if (file) pending = { ...pending, [key]: file };
  else {
    const { [key]: _gone, ...rest } = pending;
    pending = rest;
  }
}

export function clearPendingAdvanceProofs() {
  pending = {};
}

/**
 * After the order is placed: upload the held file of every advance part that
 * still exists. Never throws — the order is already placed, so a failure is
 * reported (the SA adds the proof later from Update Payment), not raised.
 *
 * @returns {{ saved: number, failed: string[] }}
 */
export async function uploadPendingAdvanceProofs(order, parts, uploadedBy) {
  let saved = 0;
  const failed = [];
  for (const part of parts) {
    const file = pending[part.key];
    if (!file) continue;
    try {
      await uploadPaymentProof({
        order, checkpoint: "advance", file, uploadedBy,
        paymentMode: part.mode, amount: part.amount,
      });
      saved += 1;
    } catch (err) {
      console.error("Advance proof upload failed (order WAS placed):", err);
      failed.push(`${file.name} (${part.mode} ₹${part.amount})`);
    }
  }
  clearPendingAdvanceProofs();
  return { saved, failed };
}
