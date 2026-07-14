import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import Logo from "../../images/logo.png";
import ScanStation from "../../components/ScanStation";
import "../../components/ScanStation.css";
import QcHistoryPanel from "../../components/QcHistoryPanel";
import { fetchQcRecords } from "../../utils/qcHistory";
import "./ScanStationPage.css";

// Standalone Scan Station page — for workers whose only role is
// `scan_station`. They land here on login. A small sidebar switches between
// the Scan Station (scanning) and their own QC History.

export default function ScanStationPage() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [assignedStations, setAssignedStations] = useState(null);
  const [activeTab, setActiveTab] = useState("scan");
  const [showSidebar, setShowSidebar] = useState(false);

  // QC History tab (this worker's own qc_records). Only workers who actually
  // do QC see it. Matching ScanStation's own access rule: a null/undefined
  // assigned_stations = full access (all stations, so can do QC); an ARRAY
  // limits them to exactly those stations (so it must include "qc"/"final_qc").
  // A cloth-issue-only worker never produces QC records, so the tab is hidden.
  const canDoQc =
    !Array.isArray(assignedStations) ||
    assignedStations.includes("qc") ||
    assignedStations.includes("final_qc");
  const [qcHistory, setQcHistory] = useState([]);
  const [qcHistoryLoading, setQcHistoryLoading] = useState(false);

  useEffect(() => {
    const checkAuthAndFetch = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/login", { replace: true });
        return;
      }

      const { data: userRecord } = await supabase
        .from("salesperson")
        .select("role, saleperson, assigned_stations")
        .eq("email", session.user.email?.toLowerCase())
        .single();

      // Only the dedicated `scan_station` role lands on this standalone page.
      // Warehouse users get the full dashboard which embeds ScanStation in
      // a tab — they shouldn't be redirected here.
      if (!userRecord || userRecord.role !== "scan_station") {
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
        return;
      }

      setCurrentUserEmail(session.user.email?.toLowerCase() || "");
      setUserName(userRecord.saleperson || "");
      // Keep null/undefined as-is (= full station access); only a real array
      // limits the worker. Don't coerce to [] — that would wrongly read as
      // "no stations" both here and in ScanStation.
      setAssignedStations(userRecord.assigned_stations ?? null);
      setLoading(false);
    };

    checkAuthAndFetch();
  }, [navigate]);

  // Load this worker's own QC history when the tab opens.
  useEffect(() => {
    if (activeTab !== "qc_history" || !canDoQc || !currentUserEmail) return;
    let cancelled = false;
    (async () => {
      setQcHistoryLoading(true);
      const recs = await fetchQcRecords({ inspectedBy: currentUserEmail });
      if (!cancelled) { setQcHistory(recs); setQcHistoryLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [activeTab, canDoQc, currentUserEmail]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  if (loading) {
    return (
      <div className="ssp-page">
        <div className="ssp-loading">
          <div className="ssp-spinner" />
          <p>Loading Scan Station…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ssp-page">
      <header className="ssp-header">
        <div className="ssp-header-left">
          <button className="ssp-hamburger" onClick={() => setShowSidebar(v => !v)} aria-label="Menu">
            <span /><span /><span />
          </button>
          <img src={Logo} alt="Logo" className="ssp-logo" />
          <h1 className="ssp-title">{activeTab === "qc_history" ? "QC History" : "Scan Station"}</h1>
        </div>
        <div className="ssp-header-right">
          {userName && <span className="ssp-user">{userName}</span>}
        </div>
      </header>

      <div className="ssp-layout">
        <aside className={`ssp-sidebar ${showSidebar ? "open" : ""}`}>
          <nav className="ssp-nav">
            <button className={`ssp-nav-item ${activeTab === "scan" ? "active" : ""}`} onClick={() => { setActiveTab("scan"); setShowSidebar(false); }}>Scan Station</button>
            {canDoQc && (
              <button className={`ssp-nav-item ${activeTab === "qc_history" ? "active" : ""}`} onClick={() => { setActiveTab("qc_history"); setShowSidebar(false); }}>QC History</button>
            )}
            <button className="ssp-nav-item ssp-nav-logout" onClick={handleLogout}>Logout</button>
          </nav>
        </aside>

        <main className="ssp-content">
          {activeTab === "scan" && (
            <ScanStation
              currentUserEmail={currentUserEmail}
              allowedStations={assignedStations}
            />
          )}
          {activeTab === "qc_history" && canDoQc && (
            <div className="ssp-qc-history">
              <h2 className="ssp-section-title">My QC History</h2>
              <QcHistoryPanel records={qcHistory} loading={qcHistoryLoading} showInspectorFilter={false} showOrderNo={true} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
