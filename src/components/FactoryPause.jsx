import React, { useState, useEffect, useCallback } from "react";
import { usePopup } from "./Popup";
import Badge from "./Badge";
import { fetchFactoryPause, pauseFactory, resumeFactory } from "../utils/barcodeService";
import "./FactoryPause.css";

/**
 * FactoryPause — Manish-only global pause control.
 * Pausing freezes all SLA/escalation timers across every order (the
 * check_escalations / check_rejourney_escalations RPCs early-return while
 * is_factory_paused() is true). This is distinct from a per-order hold.
 *
 * The button is only rendered for Manish (COO) by the host dashboard; we also
 * record paused_by/resumed_by for the audit trail.
 */
const FactoryPause = ({ currentUserEmail }) => {
  const { showPopup, PopupComponent } = usePopup();
  const [pause, setPause] = useState(null);   // open pause row or null
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setPause(await fetchFactoryPause()); }
    catch (e) { console.error("Failed to load factory pause:", e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const doPause = async () => {
    if (!reason.trim()) {
      showPopup({ title: "Reason required", message: "Please enter a reason for pausing the factory.", type: "warning", confirmText: "OK" });
      return;
    }
    setBusy(true);
    try {
      await pauseFactory({ pausedBy: currentUserEmail, reason: reason.trim() });
      showPopup({ title: "Factory Paused", message: "All SLA and escalation timers are frozen until you resume.", type: "info", confirmText: "OK" });
      setReason("");
      load();
    } catch (e) {
      showPopup({ title: "Error", message: e.message || "Could not pause", type: "error", confirmText: "OK" });
    }
    setBusy(false);
  };

  const doResume = async () => {
    setBusy(true);
    try {
      await resumeFactory({ resumedBy: currentUserEmail });
      showPopup({ title: "Factory Resumed", message: "SLA and escalation timers are running again.", type: "success", confirmText: "OK" });
      load();
    } catch (e) {
      showPopup({ title: "Error", message: e.message || "Could not resume", type: "error", confirmText: "OK" });
    }
    setBusy(false);
  };

  return (
    <div className="fp-wrap">
      {PopupComponent}
      <div className="fp-head">
        <h2 className="fp-title">Factory Pause</h2>
        {!loading && (
          <Badge variant={pause ? "danger" : "success"}>{pause ? "PAUSED" : "Running"}</Badge>
        )}
      </div>
      <p className="fp-hint">Pausing freezes all production SLA and escalation timers across every order. Use during a factory-wide stoppage (holiday, outage, etc.). Resume to restart the clocks.</p>

      {loading ? (
        <p className="fp-muted">Loading…</p>
      ) : pause ? (
        <div className="fp-card fp-card-paused">
          <div className="fp-row"><span className="fp-label">Paused by</span><span>{pause.paused_by}</span></div>
          <div className="fp-row"><span className="fp-label">Reason</span><span>{pause.reason}</span></div>
          <div className="fp-row"><span className="fp-label">Since</span><span>{new Date(pause.paused_at).toLocaleString()}</span></div>
          <button className="fp-resume" onClick={doResume} disabled={busy}>{busy ? "…" : "Resume Factory"}</button>
        </div>
      ) : (
        <div className="fp-card">
          <label className="fp-field-label">Reason for pause</label>
          <textarea className="fp-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Diwali holiday — factory closed 1–5 Nov" />
          <button className="fp-pause" onClick={doPause} disabled={busy}>{busy ? "…" : "Pause Factory"}</button>
        </div>
      )}
    </div>
  );
};

export default FactoryPause;
