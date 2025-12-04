import React, { useEffect, useState } from "react";
import "./AssociateDashboard.css";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

export default function Dashboard() {
  const navigate = useNavigate();

  const [salesperson, setSalesperson] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [enteredPassword, setEnteredPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  // ---------------------------------------------
  //  COMPUTED STATS (Auto-updated from orders)
  // ---------------------------------------------
  const totalRevenue = orders.reduce(
    (sum, o) => sum + Number(o.grand_total || 0),
    0
  );

  const totalOrders = orders.length;

  const totalClients = new Set(orders.map((o) => o.user_id)).size;

  const activeOrders = orders.filter(
    (o) => o.status !== "completed" && o.status !== "cancelled"
  );


  // ---------------------------------------------
  //  1️⃣ GET LOGGED-IN USER (EMAIL LOGIN)
  useEffect(() => {
    const logUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      console.log("🟦 LOGGED IN USER EMAIL:", user?.email);
    };
    logUser();
  }, []);

  //----------------Ask for password if associate person come back to dashboard
  useEffect(() => {
    const mustVerify = sessionStorage.getItem("requireDashboardPassword");
    if (mustVerify === "true") {
      setShowPasswordModal(true);
    }
  }, []);
  //password verification function:
  const verifyPassword = async () => {
    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: enteredPassword
    });

    if (error) {
      setPasswordError("Incorrect password!");
      return;
    }

    // SUCCESS
    sessionStorage.removeItem("requireDashboardPassword");
    setShowPasswordModal(false);
  };

  //-----------------------------
  // ---------------------------------------------
  useEffect(() => {
    const fetchSalesAssociate = async () => {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user?.email) {
        console.log("⚠ No logged-in user");
        return;
      }

      const { data, error } = await supabase
        .from("salesperson")
        .select("*")
        .eq("email", user.email)
        .single();

      if (error) {
        console.log("❌ Salesperson lookup error:", error);
        return;
      }

      console.log("Salesperson record:", data);
      setSalesperson(data);
    };

    fetchSalesAssociate();
  }, []);


  // ---------------------------------------------
  // 2️⃣ FETCH ORDERS ASSIGNED TO THIS SALESPERSON
  // ---------------------------------------------
  useEffect(() => {
    if (!salesperson) return;

    const loadOrders = async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("salesperson_email", salesperson.email);

      if (error) {
        console.log("❌ Orders fetch error:", error);
      }

      console.log("Orders fetched:", data);
      setOrders(data || []);
      setLoading(false);
    };

    loadOrders();
  }, [salesperson]);


  // ---------------------------------------------
  // LOGOUT
  // ---------------------------------------------
  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  // ---------------------------------------------
  // UI LOADING STATE
  // ---------------------------------------------
  if (loading) {
    return <p className="loading-text">Loading Dashboard...</p>;
  }




  return (

    <div className="dashboard-wrapper">
      {showPasswordModal && (
        <div className="password-modal">
          <div className="password-box">
            <h3>Re-enter Password</h3>

            <input
              type="password"
              placeholder="Enter your password"
              value={enteredPassword}
              onChange={(e) => setEnteredPassword(e.target.value)}
            />

            {passwordError && <p className="error-text">{passwordError}</p>}

            <button onClick={verifyPassword}>Verify</button>
          </div>
        </div>
      )}

      {/* ---------------- HEADER ---------------- */}
      <div className="top-header">
        <div className="header-left">
          <img src="/logo.png" className="logo" alt="logo" />
        </div>

        <h1 className="title">My Dashboard</h1>
        <button className="logout-btn" onClick={handleLogout}>↪</button>
      </div>

      {/* ---------------- GRID TABLE ---------------- */}
      <div className="grid-table">

        {/* SIDEBAR */}
        <aside className="sidebar">
          <div className="hello-box">Hello, {salesperson?.saleperson || "Associate"}</div>

          <nav className="menu">
            <a className="menu-item active">Dashboard</a>
            <a className="menu-item">Order Details</a>
            <a className="menu-item">Clients Book</a>
          </nav>
        </aside>

        {/* TOTAL REVENUE */}
        <div className="cell total-revenue">
          <StatCard title="Total Revenue" value={`₹${totalRevenue.toLocaleString()}`} change="+10.6%" />
        </div>

        {/* TOTAL ORDERS */}
        <div className="cell total-orders">
          <StatCard title="Total Orders" value={totalOrders} change="+2.6%" />
        </div>

        {/* TOTAL CLIENTS */}
        <div className="cell total-clients">
          <StatCard title="Total Clients" value={totalClients} change="+2.6%" />
        </div>

        {/* SALES TARGET */}
        <div className="cell sales-target">
          <div className="sales-card">
            <div className="sales-header">
              <div>
                <p className="sales-label">Sales Target</p>
                <p className="sales-progress">In Progress</p>
              </div>
              <p className="sales-total">Sales Target <b>8L</b></p>
            </div>

            <div className="sales-scale">
              <span>5L</span>
              <span>8L</span>
            </div>

            <div className="progress-bar">
              <div className="progress-fill"></div>
            </div>
          </div>
        </div>

        {/* ACTIVE ORDERS */}
        <div className="cell active-orders">
          <div className="orders-card">
            <div className="card-header">
              <span className="card-title">Active Orders</span>
              <button className="view-btn">View All</button>
            </div>

            <div className="card-box">
              {activeOrders.length === 0 ? (
                <p>No active orders</p>
              ) : (
                activeOrders.map((o) => (
                  <div className="order-item" key={o.id}>
                    <p><b>Order:</b> {o.id}</p>
                    <p><b>Total:</b> ₹{o.grand_total}</p>
                    <p><b>Status:</b> {o.status}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ALERTS */}
        <aside className="cell alerts-box">
          <div className="alerts-header">
            <span className="alerts-title">Alerts</span>
            <button className="view-btn">View All</button>
          </div>
          <div className="alerts-body">No alerts right now.</div>
        </aside>

      </div>

      {/* ADD ORDER */}
      <button
        className="add-btn"
        onClick={() => {
          sessionStorage.setItem("requireDashboardPassword", "true");
          navigate("/buyerVerification");
        }}
      >
        +
      </button>

      {/* BACK */}
      <button className="back-btn" onClick={() => { navigate("/") }}>‹</button>
    </div>
  );
}

// ---------------- STAT CARD ------------------
function StatCard({ title, value, change }) {
  return (
    <div className="stat-card">
      <p className="stat-title">{title}</p>
      <div className="stat-content">
        <span className="stat-value">{value}</span>
        <span className="stat-change">{change}</span>
      </div>
    </div>
  );
}
