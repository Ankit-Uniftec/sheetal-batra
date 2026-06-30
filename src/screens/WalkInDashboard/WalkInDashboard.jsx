import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { fetchAllRows } from "../../utils/fetchAllRows";
import { usePopup } from "../../components/Popup";
import WalkInsView from "../../components/WalkInsView/WalkInsView";
import Logo from "../../images/logo.png";
import "./WalkInDashboard.css";

/**
 * WalkInDashboard — a dedicated, walk-in-ONLY login.
 *
 * This dashboard shows nothing but the all-SA Walk-Ins view (footfall +
 * conversion tracking + stats + filters + CSV export). It is the landing screen
 * for the `walkin_viewer` role, who is not meant to see orders, revenue or any
 * other operational data.
 *
 * The walk-in list, conversion logic, location-split stats and filters all live
 * in the shared WalkInsView component (also used on Admin / Assistant-CMO), so
 * this screen is just a thin shell that loads the orders WalkInsView needs for
 * conversion matching and renders it.
 */
export default function WalkInDashboard() {
  const navigate = useNavigate();
  const { showPopup, PopupComponent } = usePopup();
  const [orders, setOrders] = useState([]);
  const [salespersonTable, setSalespersonTable] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);

  // Gate: only a logged-in walkin_viewer (or a higher role that legitimately
  // lands here) may view this. Others are sent to login. Mirrors the guard
  // pattern used by the other role dashboards.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) { navigate("/login", { replace: true }); return; }
      const { data: sp } = await supabase
        .from("salesperson")
        .select("role")
        .eq("email", user.email.toLowerCase())
        .single();
      if (cancelled) return;
      if (!sp || sp.role !== "walkin_viewer") {
        // Not a walk-in viewer — don't expose the screen.
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
        return;
      }
      setAuthChecked(true);
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  // Load orders (for conversion matching) + salespeople (for the location split).
  useEffect(() => {
    if (!authChecked) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [ordersRes, spRes] = await Promise.all([
          // WalkInsView only matches walk-in phones against order delivery_phone,
          // so a trimmed column set is enough and keeps the fetch light.
          fetchAllRows("orders", (q) =>
            q.select("id, delivery_phone, delivery_name, created_at")
             .order("created_at", { ascending: false })),
          supabase.from("salesperson").select("email, store_name"),
        ]);
        if (cancelled) return;
        setOrders(ordersRes.data || []);
        setSalespersonTable(spRes.data || []);
      } catch (err) {
        console.error("Walk-in dashboard load failed:", err);
        showPopup?.({ title: "Load failed", message: "Could not load walk-in data.", type: "error", confirmText: "OK" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authChecked]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  if (!authChecked) return null;

  return (
    <div className="wid-page">
      <header className="wid-header">
        <div className="wid-header-left">
          <img src={Logo} alt="logo" className="wid-logo" onClick={() => navigate("/login")} />
        </div>
        <h1 className="wid-title">Walk-In Dashboard</h1>
        <div className="wid-header-right">
          <button className="wid-logout-btn" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <main className="wid-main">
        {loading ? (
          <div className="wid-loading">
            <div className="wid-spinner" />
            <p>Loading walk-ins…</p>
          </div>
        ) : (
          <WalkInsView orders={orders} salespersonTable={salespersonTable} showPopup={showPopup} />
        )}
      </main>

      {PopupComponent}
    </div>
  );
}
