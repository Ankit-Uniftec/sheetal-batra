import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import formatIndianNumber from "../utils/formatIndianNumber";
import {
  PROOF_ACCEPT, advanceProofParts, matchAdvanceProofs, listPaymentProofs, proofSignedUrl,
  uploadPaymentProof, validateProofFile,
} from "../utils/paymentProofs";
import "./PaymentProofModal.css";

/**
 * "Advance proof" inside the Update Payment popup (Release 12): attach the
 * proof of the ADVANCE taken at order time. One line per non-cash part of the
 * advance ("UPI ₹5,000"), each with its own Upload — it does not need a new
 * payment to be recorded, so an SA can open the popup just to add it.
 * Renders nothing when the advance needs no proof (cash, none, website…).
 */
export default function AdvanceProofSection({ order, disabled }) {
  const parts = useMemo(() => advanceProofParts(order), [order]);
  const [proofs, setProofs] = useState(null);       // null = loading
  const [files, setFiles] = useState({});           // part key → File
  const [errors, setErrors] = useState({});         // part key → message
  const [busy, setBusy] = useState(null);           // part key uploading
  const [done, setDone] = useState("");

  const load = useCallback(async () => {
    try {
      setProofs(await listPaymentProofs(order.id));
    } catch (err) {
      console.error("Advance proofs load failed:", err);
      setProofs([]);
    }
  }, [order.id]);

  useEffect(() => { if (parts.length) load(); }, [parts.length, load]);

  if (!parts.length) return null;
  const { parts: matched } = matchAdvanceProofs(parts, proofs || []);

  const pick = (key, file) => {
    if (!file) return;
    const problem = validateProofFile(file);
    setFiles((f) => ({ ...f, [key]: problem ? undefined : file }));
    setErrors((e) => ({ ...e, [key]: problem || "" }));
    setDone("");
  };

  const upload = async (part) => {
    setBusy(part.key);
    setDone("");
    try {
      const { data } = await supabase.auth.getUser();
      await uploadPaymentProof({
        order, checkpoint: "advance", file: files[part.key],
        uploadedBy: data?.user?.email || null,
        paymentMode: part.mode, amount: part.amount,
      });
      setFiles((f) => ({ ...f, [part.key]: undefined }));
      setDone(`Advance proof saved for ${part.mode} ₹${formatIndianNumber(part.amount)}.`);
      await load();
    } catch (err) {
      setErrors((e) => ({ ...e, [part.key]: err.message || "Upload failed. Please try again." }));
    } finally {
      setBusy(null);
    }
  };

  const view = async (p) => {
    try {
      window.open(await proofSignedUrl(p.file_path), "_blank", "noopener");
    } catch (err) {
      setDone("");
      setErrors((e) => ({ ...e, _view: err.message || "Could not open the file." }));
    }
  };

  return (
    <div className="dpm-adv-proof">
      <p className="dpm-adv-title">Advance proof <span className="dpm-proof-opt">(optional · JPEG, PNG or PDF · 5 MB)</span></p>
      {proofs === null ? (
        <p className="dpm-proof-opt">Loading…</p>
      ) : matched.map((part) => (
        <div key={part.key} className="dpm-adv-line">
          <span className="dpm-adv-part">{part.mode} ₹{formatIndianNumber(part.amount)}</span>
          {part.proofs.length > 0 && (
            <span className="dpm-adv-have">
              ✓ {part.proofs.length} attached ·{" "}
              <button type="button" className="dpm-adv-link" onClick={() => view(part.proofs[0])}>View</button>
            </span>
          )}
          {files[part.key] ? (
            <>
              <span className="dpm-proof-name" title={files[part.key].name}>📎 {files[part.key].name}</span>
              <button type="button" className="dpm-proof-remove" aria-label="Remove file"
                onClick={() => setFiles((f) => ({ ...f, [part.key]: undefined }))} disabled={busy === part.key}>×</button>
              <button type="button" className="dpm-adv-upload" onClick={() => upload(part)} disabled={disabled || !!busy}>
                {busy === part.key ? "Uploading…" : "Upload"}
              </button>
            </>
          ) : (
            <label className="dpm-proof-pick">
              📎 {part.proofs.length ? "Add another" : "Attach advance proof"}
              <input type="file" accept={PROOF_ACCEPT} hidden disabled={disabled || !!busy}
                onChange={(e) => { pick(part.key, e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          )}
          {errors[part.key] && <span className="dpm-proof-error">{errors[part.key]}</span>}
        </div>
      ))}
      {errors._view && <p className="dpm-proof-error">{errors._view}</p>}
      {done && <p className="dpm-adv-done">{done}</p>}
    </div>
  );
}
