import React, { useCallback, useEffect, useState } from "react";
import { getStageLabel } from "../utils/barcodeService";
import formatDate from "../utils/formatDate";
import { approveRequest, listPendingRequests, listRecentDecisions, rejectRequest } from "../utils/stageRequests";
import "./StageRequestModal.css";

/**
 * "Requests" — inside the PM's Overrides screen (meeting point 5; the client
 * asked for it there, not as a new menu item). Skip / advance requests sent by
 * production heads; Approve runs the PM's own override on each piece
 * (utils/stageOverride), Reject needs a note.
 *
 * @param {string}   currentUserEmail  the PM
 * @param {function} [onApplied]       called after an approval moved pieces,
 *                                     so the screen can refresh what it shows
 */
export default function StageRequestsPanel({ currentUserEmail, onApplied }) {
  const [pending, setPending] = useState([]);
  const [recent, setRecent] = useState([]);
  const [showRecent, setShowRecent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);         // group id being decided
  const [notes, setNotes] = useState({});         // group id → reject note
  const [result, setResult] = useState(null);     // last decision's outcome

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [p, r] = await Promise.all([listPendingRequests(), listRecentDecisions()]);
      setPending(p);
      setRecent(r);
    } catch (err) {
      console.error("Requests load failed:", err);
      setError("Could not load requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const approve = async (g) => {
    setBusy(g.group);
    setResult(null);
    try {
      const res = await approveRequest(g, currentUserEmail);
      setResult(res.claimed === 0
        ? { ok: false, text: `${g.order_no}: already decided by someone else.` }
        : {
          ok: res.failed.length === 0,
          text: `${g.order_no}: ${res.applied} of ${res.claimed} piece${res.claimed === 1 ? "" : "s"} moved to ${getStageLabel(g.target_stage) || g.target_stage}.`
            + (res.failed.length ? ` Not applied: ${res.failed.map((f) => `${f.barcode} — ${f.error}`).join("; ")}` : ""),
        });
      if (res.applied) onApplied?.();
    } catch (err) {
      setResult({ ok: false, text: `${g.order_no}: ${err.message || "approval failed"}` });
    } finally {
      setBusy(null);
      load();
    }
  };

  const reject = async (g) => {
    setBusy(g.group);
    setResult(null);
    try {
      const n = await rejectRequest(g, currentUserEmail, notes[g.group]);
      setResult({ ok: true, text: n ? `${g.order_no}: request rejected.` : `${g.order_no}: already decided by someone else.` });
      setNotes((prev) => ({ ...prev, [g.group]: "" }));
    } catch (err) {
      setResult({ ok: false, text: err.message || "Could not reject." });
    } finally {
      setBusy(null);
      load();
    }
  };

  const card = (g, decided) => (
    <div key={g.group} className="srm-pm-card">
      <div className="srm-pm-line">
        <b>{g.order_no}</b> · {g.request_type === "skip" ? "Skip" : "Advance"} {g.rows.length} piece{g.rows.length === 1 ? "" : "s"} to{" "}
        <b>{getStageLabel(g.target_stage) || g.target_stage}</b>
        {decided && <span className={`srm-status srm-status-${g.status}`} style={{ marginLeft: 8 }}>{g.status}</span>}
      </div>
      <div className="srm-pm-line">Reason: {g.reason}</div>
      <div className="srm-pm-line srm-meta">Asked by {g.requested_by || "—"} · {formatDate(g.requested_at)}
        {decided && ` · decided by ${g.decided_by || "—"}`}</div>
      <ul className="srm-pm-pieces">
        {g.rows.map((r) => (
          <li key={r.id}>
            <span className="srm-barcode" style={{ marginLeft: 0 }}>{r.barcode}</span> — at {getStageLabel(r.from_stage) || r.from_stage} when asked
            {decided && r.status === "approved" && (r.applied ? " · moved" : ` · not applied (${r.apply_error || "refused"})`)}
          </li>
        ))}
      </ul>
      {decided ? (
        g.decision_note && <div className="srm-pm-line">Note: {g.decision_note}</div>
      ) : (
        <div className="srm-pm-actions">
          <button className="srm-btn srm-btn-approve" onClick={() => approve(g)} disabled={busy === g.group}>
            {busy === g.group ? "Working…" : "Approve"}
          </button>
          <input
            type="text"
            placeholder="Reason for rejecting (required to reject)"
            value={notes[g.group] || ""}
            onChange={(e) => setNotes((prev) => ({ ...prev, [g.group]: e.target.value }))}
            disabled={busy === g.group}
          />
          <button className="srm-btn srm-btn-reject" onClick={() => reject(g)}
            disabled={busy === g.group || !(notes[g.group] || "").trim()}>Reject</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="srm-pm-section">
      <div className="srm-pm-head">
        <h3>Requests from the floor {pending.length ? `(${pending.length} pending)` : ""}</h3>
        <button className="srm-pm-toggle" onClick={() => setShowRecent((v) => !v)}>
          {showRecent ? "Hide recent decisions" : "Show recent decisions"}
        </button>
      </div>
      {result && (
        <div className={`pm-override-result ${result.ok ? "pm-result-success" : "pm-result-error"}`} style={{ marginTop: 12 }}>
          {result.text}
        </div>
      )}
      {loading ? (
        <p className="srm-muted">Loading…</p>
      ) : error ? (
        <p className="srm-warn">{error}</p>
      ) : pending.length === 0 ? (
        <p className="srm-muted">No pending skip / advance requests.</p>
      ) : (
        pending.map((g) => card(g, false))
      )}
      {showRecent && !loading && (
        recent.length === 0 ? <p className="srm-muted">No decisions yet.</p> : recent.map((g) => card(g, true))
      )}
    </div>
  );
}
