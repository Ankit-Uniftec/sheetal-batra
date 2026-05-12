import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import Logo from "../../images/logo.png";
import ScanStation from "../../components/ScanStation";
import "../../components/ScanStation.css";
import "./ScanStationPage.css";

// Standalone full-screen Scan Station page — for workers whose only role
// is `scan_station`. No dashboard, no sidebar. They land here on login,
// scan barcodes at their assigned stations, and log out.

export default function ScanStationPage() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [assignedStations, setAssignedStations] = useState([]);

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
      setAssignedStations(userRecord.assigned_stations || []);
      setLoading(false);
    };

    checkAuthAndFetch();
  }, [navigate]);

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
          <img src={Logo} alt="Logo" className="ssp-logo" />
          <h1 className="ssp-title">Scan Station</h1>
        </div>
        <div className="ssp-header-right">
          {userName && <span className="ssp-user">{userName}</span>}
          <button className="ssp-logout-btn" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <main className="ssp-content">
        <ScanStation
          currentUserEmail={currentUserEmail}
          allowedStations={assignedStations}
        />
      </main>
    </div>
  );
}
