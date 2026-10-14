import React, { useState } from "react";
import formatIndianNumber from "../utils/formatIndianNumber";
import { PROOF_ACCEPT, validateProofFile } from "../utils/paymentProofs";
import { getPendingAdvanceProofs, setPendingAdvanceProof } from "../utils/pendingAdvanceProof";
import "./PaymentProofModal.css";

/**
 * "Advance payment proof (optional)" while PLACING an order (Release 12) — on
 * the payment screen under the advance amount, and again on the review screen.
 * One picker per non-cash part of the advance. Nothing uploads here: the file
 * is held (utils/pendingAdvanceProof) and uploaded right after Place Order.
 *
 * @param {object[]} parts  advanceProofParts(...) of the order being placed
 */
export default function AdvanceProofPicker({ parts }) {
  const [files, setFiles] = useState(getPendingAdvanceProofs);
  const [errors, setErrors] = useState({});
  if (!parts?.length) return null;

  const set = (key, file) => {
    setPendingAdvanceProof(key, file);
    setFiles(getPendingAdvanceProofs());
  };
  const pick = (key, file) => {
    if (!file) return;
    const problem = validateProofFile(file);
    setErrors((e) => ({ ...e, [key]: problem || "" }));
    if (!problem) set(key, file);
  };

  return (
    <div className="dpm-adv-proof">
      <p className="dpm-adv-title">
        Advance payment proof <span className="dpm-proof-opt">(optional · JPEG, PNG or PDF · 5 MB · saved after the order is placed)</span>
      </p>
      {parts.map((part) => (
        <div key={part.key} className="dpm-adv-line">
          <span className="dpm-adv-part">{part.mode} ₹{formatIndianNumber(part.amount)}</span>
          {files[part.key] ? (
            <>
              <span className="dpm-proof-name" title={files[part.key].name}>✓ 📎 {files[part.key].name}</span>
              <label className="dpm-proof-pick">
                Change
                <input type="file" accept={PROOF_ACCEPT} hidden
                  onChange={(e) => { pick(part.key, e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              <button type="button" className="dpm-proof-remove" aria-label="Remove file" onClick={() => set(part.key, null)}>×</button>
            </>
          ) : (
            <label className="dpm-proof-pick">
              📎 Attach proof
              <input type="file" accept={PROOF_ACCEPT} hidden
                onChange={(e) => { pick(part.key, e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          )}
          {errors[part.key] && <span className="dpm-proof-error">{errors[part.key]}</span>}
        </div>
      ))}
    </div>
  );
}
