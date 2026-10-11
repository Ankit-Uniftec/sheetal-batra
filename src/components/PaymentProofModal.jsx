import React, { useCallback, useEffect, useState } from "react";
import formatDate from "../utils/formatDate";
import {
  CHECKPOINTS, PROOF_ACCEPT, listPaymentProofs, proofSignedUrl,
  uploadPaymentProof, validateProofFile,
} from "../utils/paymentProofs";
import "../screens/OrderHistory.css";
import "./PaymentProofModal.css";

/**
 * Payment proofs for one order (meeting point 26): the proofs already
 * uploaded, and a form to add one (Advance / Balance, JPEG / PNG / PDF up to
 * 5 MB). Optional — nothing in the order flow waits on it. No delete, by
 * design: a wrong upload is fixed by uploading the right one.
 *
 * @param {object}   order
 * @param {function} onClose
 * @param {function} showPopup    the caller's usePopup().showPopup
 * @param {string}  [uploadedBy]  the uploader's email
 */
export default function PaymentProofModal({ order, onClose, showPopup, uploadedBy }) {
  const [proofs, setProofs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [checkpoint, setCheckpoint] = useState("");
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [opening, setOpening] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      setProofs(await listPaymentProofs(order.id));
    } catch (err) {
      console.error("Payment proofs load failed:", err);
      setLoadError("Could not load the payment proofs. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [order.id]);

  useEffect(() => { load(); }, [load]);

  const pickFile = (e) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setFileError(f ? validateProofFile(f) || "" : "");
  };

  const handleUpload = async () => {
    if (!checkpoint || !file || fileError) return;
    setUploading(true);
    try {
      await uploadPaymentProof({ order, checkpoint, file, uploadedBy });
      setFile(null);
      setCheckpoint("");
      await load();
      showPopup({ type: "success", title: "Proof Uploaded", message: `Payment proof added to ${order.order_no}.`, confirmText: "OK" });
    } catch (err) {
      console.error("Payment proof upload failed:", err);
      showPopup({ type: "error", title: "Upload Failed", message: err.message || "Could not upload the file. Please try again.", confirmText: "OK" });
    } finally {
      setUploading(false);
    }
  };

  const openProof = async (p) => {
    setOpening(p.id);
    try {
      window.open(await proofSignedUrl(p.file_path), "_blank", "noopener");
    } catch (err) {
      showPopup({ type: "error", title: "Can't open file", message: err.message || "Please try again.", confirmText: "OK" });
    } finally {
      setOpening(null);
    }
  };

  const canSubmit = checkpoint && file && !fileError && !uploading;

  return (
    <div className="oh-modal-overlay" onClick={(e) => e.stopPropagation()}>
      <div className="oh-modal">
        <div className="oh-modal-header">
          <h3>Payment Proof — {order.order_no}</h3>
          <button className="oh-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="oh-modal-body">
          <p className="ppm-section-title">Uploaded proofs</p>
          {loading ? (
            <p className="ppm-muted">Loading…</p>
          ) : loadError ? (
            <p className="ppm-error">{loadError}</p>
          ) : proofs.length === 0 ? (
            <p className="ppm-muted">No payment proofs yet.</p>
          ) : (
            <ul className="ppm-list">
              {proofs.map((p) => (
                <li key={p.id} className="ppm-item">
                  <span className={`ppm-tag ppm-tag-${p.checkpoint}`}>{p.checkpoint === "advance" ? "Advance" : "Balance"}</span>
                  <span className="ppm-name" title={p.file_name}>{p.file_name || "file"}</span>
                  <span className="ppm-meta">{formatDate(p.created_at)}{p.uploaded_by ? ` · ${p.uploaded_by}` : ""}</span>
                  <button className="ppm-view" onClick={() => openProof(p)} disabled={opening === p.id}>
                    {opening === p.id ? "…" : "View"}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="ppm-section-title" style={{ marginTop: 18 }}>Add a proof</p>
          <div className="ppm-checkpoints" role="radiogroup" aria-label="Payment checkpoint">
            {CHECKPOINTS.map((c) => (
              <label key={c.value} className={`ppm-check ${checkpoint === c.value ? "active" : ""}`}>
                <input
                  type="radio"
                  name="ppm-checkpoint"
                  value={c.value}
                  checked={checkpoint === c.value}
                  onChange={() => setCheckpoint(c.value)}
                />
                {c.label}
              </label>
            ))}
          </div>
          <input className="ppm-file" type="file" accept={PROOF_ACCEPT} onChange={pickFile} />
          <p className="ppm-muted">JPEG, PNG or PDF · up to 5 MB</p>
          {fileError && <p className="ppm-error">{fileError}</p>}
        </div>
        <div className="oh-modal-footer">
          <button className="oh-modal-btn cancel" onClick={onClose}>Close</button>
          <button
            className="oh-modal-btn save"
            onClick={handleUpload}
            disabled={!canSubmit}
            title={!checkpoint ? "Choose Advance or Balance" : !file ? "Choose a file" : undefined}
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}
