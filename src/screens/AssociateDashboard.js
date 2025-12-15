import React, { useEffect, useState } from "react";
import "./AssociateDashboard.css";
import "./OrderHistory.css"; // reuse same card UI
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Logo from "../images/logo.png";
import formatIndianNumber from "../utils/formatIndianNumber";

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();

  const [activeTab, setActiveTab] = useState("dashboard");

  const [salesperson, setSalesperson] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [enteredPassword, setEnteredPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  // ------------ Stats -------------
  const totalRevenue = orders.reduce(
    (sum, o) => sum + Number(o.grand_total || 0),
    0
  );
  const totalOrders = orders.length;
  const totalClients = new Set(orders.map((o) => o.user_id)).size;

  const activeOrders = orders.filter(
    (o) => o.status !== "completed" && o.status !== "cancelled"
  );

  // ---------- Who is logged in ----------
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      console.log("Logged in:", data.user?.email);
    });
  }, []);

  // ---------- Show password modal on return ----------
  useEffect(() => {
    if (location.state?.fromBuyerVerification) {
      setShowPasswordModal(true);
    }
  }, [location]);

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

    setShowPasswordModal(false);
  };

  // ---------- Load salesperson record ----------
  useEffect(() => {
    const loadSalesperson = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) return;

      const { data, error } = await supabase
        .from("salesperson")
        .select("*")
        .eq("email", user.email)
        .single();

      if (error) {
        console.log("Salesperson fetch error:", error);
        return;
      }

      setSalesperson(data);
    };

    loadSalesperson();
  }, []);

  // ---------- Load orders belonging to this salesperson ----------
  useEffect(() => {
    if (!salesperson) return;

    const loadOrders = async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*") // IMPORTANT: items is JSONB, no join needed
        .eq("salesperson_email", salesperson.email)
        .order("created_at", { ascending: false });

      if (error) console.log("Orders fetch error:", error);

      console.log("Orders:", data);
      setOrders(data || []);
      setLoading(false);
    };

    loadOrders();
  }, [salesperson]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  if (loading) return <p className="loading-text">Loading Dashboard...</p>;

  const statusBadge = (status) =>
    status === "complete" ? "complete" : "active";

  return (
<div>
    {/* PASSWORD MODAL */}
      {showPasswordModal && (
        <div className="password-modal">
          <div className="password-box">
            <h3>Re-enter Password</h3>
            <input
              type="password"
              placeholder="Enter password"
              value={enteredPassword}
              onChange={(e) => setEnteredPassword(e.target.value)}
            />
            {passwordError && <p className="error-text">{passwordError}</p>}
            <button onClick={verifyPassword}>Verify</button>
          </div>
        </div>
      )}

    <div className={`dashboard-wrapper ${showPasswordModal ? "blurred" : "none"}`}>


      
      {/* HEADER */}
      <div className="top-header">
        <div className="header-left">
          <img src={Logo} className="logo" alt="logo" />
        </div>

        <h1 className="title">My Dashboard</h1>

        <button className="logout-btn" onClick={handleLogout}>↪</button>
      </div>

      {/* MAIN TABLE */}
      <div className="grid-table">

        {/* SIDEBAR */}
        <aside className="sidebar">
          <div
            className="hello-box clickable"
            onClick={() => setActiveTab("profile")}
          >
            Hello, {salesperson?.saleperson || "Associate"}
          </div>


          <nav className="menu">
            <a
              className={`menu-item ${activeTab === "dashboard" ? "active" : ""}`}
              onClick={() => setActiveTab("dashboard")}
            >
              Dashboard
            </a>

            <a
              className={`menu-item ${activeTab === "orders" ? "active" : ""}`}
              onClick={() => setActiveTab("orders")}
            >
              Order Details
            </a>

            <a
              className={`menu-item ${activeTab === "clients" ? "active" : ""}`}
              onClick={() => setActiveTab("clients")}
            >
              Clients Book
            </a>
          </nav>
        </aside>

        {/* --------------- DASHBOARD CARDS ---------------- */}
        {activeTab === "dashboard" && (
          <>
            <div className="cell total-revenue">
              {/* i have removed the change value  */}
              <StatCard title="Total Revenue" value={`₹${formatIndianNumber(totalRevenue)}`} />
            </div>

            <div className="cell total-orders">
              <StatCard title="Total Orders" value={formatIndianNumber(totalOrders)} />
            </div>

            <div className="cell total-clients">
              <StatCard title="Total Clients" value={formatIndianNumber(totalClients)} />
            </div>

            <div className="cell sales-target">
              <div className="sales-card">
                <div className="sales-header">
                  <div>
                    <p className="sales-label">Sales Target</p>
                    <p className="sales-progress">In Progress</p>
                  </div>
                  <p className="sales-total">Sales Target <b>{formatIndianNumber(800000)}</b></p>
                </div>

                <div className="sales-scale">
                  <span>{formatIndianNumber(500000)}</span>
                  <span>{formatIndianNumber(800000)}</span>
                </div>

                <div className="progress-bar">
                  <div className="progress-fill"></div>
                </div>
              </div>
            </div>

            <div className="cell active-orders">
              <div className="orders-card">
                <div className="card-header">
                  <span className="card-title">Active Orders</span>
                  <button className="view-btn" onClick={() => setActiveTab("orders")}>View All</button>

                </div>

                <div className="cardbox" >
                  {activeOrders.length === 0 ? (
                    <p>No active orders</p>
                  ) : (
                    activeOrders.map((o) => (
                      <div className="order-item" key={o.id} style={{ borderBottom: '1px solid #d5b85a' }}>
                        <p><b>Order No:</b> {o.id}</p>
                        {/* <p><b>Total:</b> ₹{o.grand_total}</p> */}
                        <p><b>Status:</b> {o.status}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <aside className="cell alerts-box">
              <div className="alerts-header">
                <span className="alerts-title">Alerts</span>
                <button className="view-btn">View All</button>
              </div>
              <div className="alerts-body">No alerts right now.</div>
            </aside>
          </>
        )}

        {/* ------------- ORDER DETAILS TAB (OrderHistory UI) ------------ */}
        {activeTab === "orders" && (
          <div className="order-details-wrapper">

            <h2 className="order-title">Order Details</h2>

            <div className="order-list-scroll">
              {orders.length === 0 && (
                <p className="muted">No orders found for this associate.</p>
              )}

              {orders.map((order) => {
                const item = order.items?.[0] || {};
                const imgSrc = item.image_url || "/placeholder.png";

                return (
                  <div key={order.id} className="order-card">
                    {/* Status Badge */}
                    <div className={`state-badge ${order.status === "complete" ? "complete" : "active"}`}>
                      {order.status === "complete" ? "Complete" : "Active"}
                    </div>

                    <div className="order-row">
                      <div className="thumb">
                        <img src={imgSrc} alt={item.product_name || "Product"} />
                      </div>

                      <div className="details">
                        <div className="row space">
                          <div className="kv"></div>
                          <div className="kv"></div>
                          <div className="kv">
                            <div className="small muted">EDD</div>
                            <div>{order.delivery_date || "—"}</div>
                          </div>
                        </div>

                        <div className="grid-2">
                          <div className="kv">
                            <div className="label">Product Name</div>
                            <div className="value">{item.product_name || "—"}</div>
                          </div>

                          <div className="kv">
                            <div className="label">Amount</div>
                            <div className="value">₹{formatIndianNumber(order.grand_total)}</div>
                          </div>

                          <div className="kv">
                            <div className="label">Qty</div>
                            <div className="value">{formatIndianNumber(order.total_quantity)}</div>
                          </div>

                          <div className="kv">
                            <div className="label">Color</div>

                            <div className="value"> <div
                              style={{
                                background: item.color,
                                height: "15px",
                                width: "30px",
                                borderRadius: "14px",
                                marginBottom: "5px",
                              }}
                            />{item.color || "—"}</div>
                          </div>

                          <div className="kv">
                            <div className="label">Size</div>
                            <div className="value">{item.size || "—"}</div>
                          </div>

                          <div className="kv">
                            <div className="label">SA</div>
                            <div className="value">
                              {order.salesperson || "-"}{" "}
                              {order.salesperson_phone ? `(${order.salesperson_phone})` : ""}
                            </div>
                          </div>
                        </div>

                        {/* <button className="view-btn">View order details</button> */}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
        )}

        {/* ----------- SALES PERSON PROFILE TAB ----------- */}
        {activeTab === "profile" && salesperson && (
          <div className="order-details-wrapper profile-wrapper">

            <h2 className="profile-title">My Profile</h2>

            <div className="profile-card">
              <div className="profile-row">
                <span className="label">Name</span>
                <span className="value">{salesperson.saleperson}</span>
              </div>

              <div className="profile-row">
                <span className="label">Email</span>
                <span className="value">{salesperson.email}</span>
              </div>

              <div className="profile-row">
                <span className="label">Phone</span>
                <span className="value">{salesperson.phone}</span>
              </div>

              <div className="profile-row">
                <span className="label">Joined On</span>
                <span className="value">
                  {salesperson.created_at
                    ? new Date(salesperson.created_at).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })
                    : "—"}
                </span>

              </div>
            </div>
          </div>
        )}



      </div>

      {/* CREATE ORDER BUTTON */}
      <button
        className="add-btn"
        onClick={async () => {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            sessionStorage.setItem("associateSession", JSON.stringify(session));
          }
          sessionStorage.setItem("returnToAssociate", "true");
          navigate("/buyerVerification", { state: { fromAssociate: true } });
        }}
      >
        +
      </button>

      {/* BACK */}
      <button className="back-btn" onClick={() => navigate("/")}>‹</button>
    </div>
    </div>
  );
}

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
