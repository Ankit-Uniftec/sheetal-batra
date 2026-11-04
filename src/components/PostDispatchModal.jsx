import React, { useState } from "react";
import formatDate from "../utils/formatDate";
import {
  POST_DISPATCH_TYPES, POST_DISPATCH_ACCEPT, POST_DISPATCH_MAX_FILES, postDispatchLabel,
  validatePostDispatch, savePostDispatchAction, postDispatchFileUrl,
} from "../utils/postDispatch";

// Post Dispatch Action (point #1): record what the partner reported after
// dispatch. Nothing on the order changes.

export default function PostDispatchModal({ order, actions = [], by, onClose, onSaved, showPopup }) {
  const [actionType, setActionType] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");

  const save = async () => {
    const msg = validatePostDispatch({ actionType, note, files });
    setProblem(msg || "");
    if (msg) return;
    setSaving(true);
    try {
      const row = await savePostDispatchAction({ order, actionType, note, files, by });
      onSaved?.(row);
      onClose();
      showPopup?.({ type: "success", title: "Recorded", message: `${postDispatchLabel(actionType)} recorded on ${order.order_no}.`, confirmText: "OK" });
    } catch (err) {
      setProblem(`Could not save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const openFile = async (file) => {
    const tab = window.open("", "_blank");
    try {
      const url = await postDispatchFileUrl(file.path);
      if (tab) tab.location = url;
      else window.location.assign(url);
    } catch (err) {
      if (tab) tab.close();
      setProblem(`Could not open ${file.name}: ${err.message}`);
    }
  };

  return (
    <div className="merch-modal-overlay" onClick={onClose}>
      <div className="merch-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="merch-modal-top">
          <h3>Post Dispatch Action</h3>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{order.order_no}</span>
        </div>
        <div className="merch-modal-body">
          <label className="merch-ocard-dlabel" style={{ display: "block", marginBottom: 6 }}>Action *</label>
          <select value={actionType} onChange={(e) => setActionType(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 8, marginBottom: 14 }}>
            <option value="">Select</option>
            {POST_DISPATCH_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>

          <label className="merch-ocard-dlabel" style={{ display: "block", marginBottom: 6 }}>QC failure by vendor *</label>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did the vendor report?"
            style={{ width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 8, marginBottom: 14, boxSizing: "border-box" }} />

          <label className="merch-ocard-dlabel" style={{ display: "block", marginBottom: 6 }}>
            Files (JPEG or PDF, up to {POST_DISPATCH_MAX_FILES}, 5 MB each)
          </label>
          <input type="file" multiple accept={POST_DISPATCH_ACCEPT} onChange={(e) => setFiles([...e.target.files])} />
          {files.length > 0 && <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>{files.map((f) => f.name).join(", ")}</div>}

          {problem && <div style={{ marginTop: 12, color: "#c62828", fontSize: 13 }}>{problem}</div>}

          {actions.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div className="merch-ocard-dlabel" style={{ marginBottom: 6 }}>Recorded so far ({actions.length})</div>
              {actions.map((a) => (
                <div key={a.id} style={{ borderTop: "1px solid #eee", padding: "8px 0", fontSize: 13 }}>
                  <strong>{postDispatchLabel(a.action_type)}</strong> · {formatDate(a.created_at)} · {a.created_by}
                  <div style={{ whiteSpace: "pre-wrap" }}>{a.note}</div>
                  {(a.files || []).map((f) => (
                    <button key={f.path} type="button" onClick={() => openFile(f)}
                      style={{ marginRight: 6, marginTop: 4, background: "none", border: "1px solid #ddd", borderRadius: 6, padding: "2px 8px", cursor: "pointer", fontSize: 12 }}>
                      {f.name}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="merch-modal-footer">
          <button type="button" className="merch-modal-cancel" onClick={onClose} disabled={saving}>Close</button>
          <button type="button" className="merch-modal-confirm approve" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
