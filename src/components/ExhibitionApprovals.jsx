import React, { useState, useEffect, useCallback } from "react";
import { usePopup } from "./Popup";
import Badge from "./Badge";
import {
  fetchPendingExhibitions,
  fetchAllExhibitions,
  approveExhibition,
  rejectExhibition,
  EXHIBITION_STATUS,
} from "../utils/exhibitionService";
import "./ExhibitionApprovals.css";

const STATUS_BADGE = {
  [EXHIBITION_STATUS.ACTIVE]: { variant: "success", label: "Active" },
  [EXHIBITION_STATUS.PENDING]: { variant: "warning", label: "Pending Approval" },
  [EXHIBITION_STATUS.REJECTED]: { variant: "danger", label: "Rejected" },
};

/**
 * ExhibitionApprovals — approver view (Anushree=GM, Sheetal=CEO).
 * Lists exhibitions awaiting approval with Approve / Reject, plus a read-only
 * list of all exhibitions and their status. An exhibition becomes Active only
 * after approval (rule 4); editing an active one returns it here (rule 7).
 */
const ExhibitionApprovals = ({ currentUserEmail }) => {
  const { showPopup, PopupComponent } = usePopup();
  const [pending, setPending] = useState([]);
  const [all, setAll] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([fetchPendingExhibitions(), fetchAllExhibitions()]);
      setPending(p || []);
      setAll(a || []);
    } catch (e) {
      console.error("Failed to load exhibitions:", e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const doApprove = async (exb) => {
    setBusyId(exb.id);
    try {
      await approveExhibition(exb.id, currentUserEmail);
      showPopup({ title: "Approved", message: `${exb.name} is now Active.`, type: "success", confirmText: "OK" });
      load();
    } catch (e) {
      showPopup({ title: "Error", message: e.message || "Approve failed", type: "error", confirmText: "OK" });
    }
    setBusyId(null);
  };

  const doReject = async (exb) => {
    setBusyId(exb.id);
    try {
      await rejectExhibition(exb.id, currentUserEmail, "Rejected by approver");
      showPopup({ title: "Rejected", message: `${exb.name} has been rejected.`, type: "info", confirmText: "OK" });
      load();
    } catch (e) {
      showPopup({ title: "Error", message: e.message || "Reject failed", type: "error", confirmText: "OK" });
    }
    setBusyId(null);
  };

  const Row = ({ exb, showActions }) => {
    const badge = STATUS_BADGE[exb.status] || { variant: "neutral", label: exb.status };
    return (
      <div className="exa-row">
        <div className="exa-info">
          <div className="exa-name">{exb.name}</div>
          <div className="exa-meta">{exb.location}, {exb.country} · {exb.company_name}</div>
          <div className="exa-meta">{exb.start_date} → {exb.end_date} · Rep: {exb.sb_representative} · Commission: {exb.commission_split}%</div>
          <div className="exa-meta">Created by {exb.created_by}</div>
        </div>
        <div className="exa-actions">
          <Badge variant={badge.variant}>{badge.label}</Badge>
          {showActions && (
            <div className="exa-btns">
              <button className="exa-approve" disabled={busyId === exb.id} onClick={() => doApprove(exb)}>
                {busyId === exb.id ? "…" : "Approve"}
              </button>
              <button className="exa-reject" disabled={busyId === exb.id} onClick={() => doReject(exb)}>Reject</button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="exa-wrap">
      {PopupComponent}
      <h2 className="exa-title">Exhibition Approvals</h2>
      <p className="exa-hint">Approve a submitted exhibition to make it Active. Editing an active exhibition sends it back here for re-approval.</p>

      <h3 className="exa-section">Pending ({pending.length})</h3>
      {pending.length === 0 ? (
        <p className="exa-empty">No exhibitions awaiting approval.</p>
      ) : (
        <div className="exa-list">{pending.map((e) => <Row key={e.id} exb={e} showActions />)}</div>
      )}

      <h3 className="exa-section">All Exhibitions ({all.length})</h3>
      <div className="exa-list">{all.map((e) => <Row key={e.id} exb={e} showActions={false} />)}</div>
    </div>
  );
};

export default ExhibitionApprovals;
