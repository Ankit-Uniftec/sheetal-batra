import React, { useEffect, useState } from "react";
import "./AssociateDashboard.css";
import "./OrderHistory.css"; // reuse same card UI
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Logo from "../images/logo.png";
import formatIndianNumber from "../utils/formatIndianNumber";
import formatPhoneNumber from "../utils/formatPhoneNumber";

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
  const [clients, setClients] = useState([]);
  const [calendarDate, setCalendarDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [clientsLoading, setClientsLoading] = useState(false);
  const [orderSearch, setOrderSearch] = useState("");

  // ------------ Stats -------------
  const totalRevenue = orders.reduce(
    (sum, o) => sum + Number(o.grand_total || 0),
    0
  );
  const totalOrders = orders.length;
  const totalClients = new Set(orders.map((o) => o.user_id)).size;

  const activeOrders = orders.filter(
    (o) => o.status !== "completed" && o.status !== "cancelled" &&
           o.created_at.slice(0, 10) === new Date().toISOString().slice(0, 10)
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

  useEffect(() => {
    if (!salesperson) return;

    const loadClients = async () => {
      setClientsLoading(true);

      // 1️⃣ Fetch clients from orders
      const { data: orderClients, error } = await supabase
        .from("orders")
        .select("delivery_name, delivery_email, delivery_phone")
        .eq("salesperson_email", salesperson.email);

      if (error) {
        console.error(error);
        setClients([]);
        setClientsLoading(false);
        return;
      }

      // 2️⃣ Deduplicate clients by email
      const map = new Map();

      orderClients.forEach((c) => {
        if (c.delivery_email) {
          map.set(c.delivery_email, {
            name: c.delivery_name,
            email: c.delivery_email,
            phone: c.delivery_phone,
          });
        }
      });

      const uniqueClients = Array.from(map.values());

      if (uniqueClients.length === 0) {
        setClients([]);
        setClientsLoading(false);
        return;
      }

      // 3️⃣ Fetch gender & dob from profiles
      const { data: profiles } = await supabase
        .from("profiles")
        .select("email, gender, dob")
        .in(
          "email",
          uniqueClients.map((c) => c.email)
        );

      const profileMap = new Map(
        (profiles || []).map((p) => [p.email, p])
      );

      // 4️⃣ Merge
      const finalClients = uniqueClients.map((c) => ({
        name: c.name,
        email: c.email,
        phone: c.phone,
        gender: profileMap.get(c.email)?.gender || "—",
        dob: profileMap.get(c.email)?.dob || "—",
      }));

      setClients(finalClients);
      setClientsLoading(false);
    };

    loadClients();
  }, [salesperson]);



  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  if (loading) return <p className="loading-text">Loading Dashboard...</p>;

  const statusBadge = (status) =>
    status === "complete" ? "complete" : "active";

  const calendarOrders = orders.filter(
    (o) => o.delivery_date && o.delivery_date.slice(0, 10) === calendarDate
  );

  const filteredOrders = orders.filter((order) => {
    if (!orderSearch.trim()) return true;

    const q = orderSearch.toLowerCase();

    const productName =
      order.items?.[0]?.product_name?.toLowerCase() || "";

    const productId = String(order.id || "").toLowerCase();

    const clientName =
      order.delivery_name?.toLowerCase() || "";

    return (
      productId.includes(q) ||
      productName.includes(q) ||
      clientName.includes(q)
    );
  });




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
              className={`hello-box clickable ${activeTab === "profile" ? "active" : ""}`}
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
                className={`menu-item ${activeTab === "calendar" ? "active" : ""}`}
                onClick={() => setActiveTab("calendar")}
              >
                Calendar
              </a>

              <a
                className={`menu-item ${activeTab === "orders" ? "active" : ""}`}
                onClick={() => setActiveTab("orders")}
              >
                Order History
              </a>

              

              <a
                className={`menu-item ${activeTab === "clients" ? "active" : ""}`}
                onClick={() => setActiveTab("clients")}
              >
                Client Book
              </a>
            </nav>
          </aside>

          {/* --------------- DASHBOARD CARDS ---------------- */}
          {activeTab === "dashboard" && (
            <>
              <div className="cell total-revenue">
                {/* i have removed the change value  */}
                <StatCard  title="Total Revenue" value={`₹${formatIndianNumber(totalRevenue)}`}  />
              </div>

              <div className="cell total-orders">
                <StatCard title="Total Orders" className="gold-text" value={formatIndianNumber(totalOrders)} />
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
                    {/* <p className="sales-total">Sales Target <b>{formatIndianNumber(800000)}</b></p> */}
                  </div>

                  <div className="sales-scale">
                    <span>₹{formatIndianNumber(500000)}</span>
                    <span>₹{formatIndianNumber(800000)}</span>
                  </div>

                  <div className="progress-bar">
                    <div className="progress-fill"></div>
                  </div>
                </div>
              </div>

              <div className="cell active-orders">
                <div className="orders-card">
                  <div className="card-header">
                    <span className="card-title">Today's Orders</span>
                    <button className="view-btn" onClick={() => setActiveTab("orders")} >View All</button>

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

              <h2 className="order-title">Order History</h2>
              <div className="order-search-bar">
                <input
                  type="text"
                  placeholder="Search by Order ID, Product Name or Client Name"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                />
              </div>

              <div className="order-list-scroll">
                {filteredOrders.length === 0 && (
                  <p className="muted">No orders found for this associate.</p>
                )}

                {filteredOrders.map((order) => {
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
                                {order.salesperson_phone ? `(${formatPhoneNumber(order.salesperson_phone)})` : ""}
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

          {/* ------------- CALENDAR TAB ------------ */}
          {activeTab === "calendar" && (
            <div className="order-details-wrapper">
              <h2 className="order-title">Calendar</h2>

              <div className="calendar-filter-row">
                <label className="calendar-label">
                  Select Date:&nbsp;
                  <input
                    type="date"
                    value={calendarDate}
                    onChange={(e) => setCalendarDate(e.target.value)}
                  />
                </label>
              </div>

              <div className="order-list-scroll">
                {calendarOrders.length === 0 ? (
                  <p className="muted">No orders on this date.</p>
                ) : (
                  calendarOrders.map((order) => {
                    const item = order.items?.[0] || {};
                    const imgSrc = item.image_url || "/placeholder.png";

                    return (
                      <div key={order.id} className="order-card">
                        <div className={`state-badge ${statusBadge(order.status)}`}>
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
                                <div className="value">
                                  ₹{formatIndianNumber(order.grand_total)}
                                </div>
                              </div>

                              <div className="kv">
                                <div className="label">Qty</div>
                                <div className="value">
                                  {formatIndianNumber(order.total_quantity)}
                                </div>
                              </div>

                              <div className="kv">
                                <div className="label">Color</div>
                                <div className="value">
                                  <div
                                    style={{
                                      background: item.color,
                                      height: "15px",
                                      width: "30px",
                                      borderRadius: "14px",
                                      marginBottom: "5px",
                                    }}
                                  />
                                  {item.color || "—"}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
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
                  <span className="value">{formatPhoneNumber(salesperson.phone)}</span>
                </div>

                <div className="profile-row">
                  <span className="label">Joining Date</span>
                  <span className="value">
                    {salesperson.join_date}
                  </span>

                </div>
                <div className="profile-row">
                  <span className="label">Store Name</span>
                  <span className="value">
                    {salesperson.store_name}
                  </span>

                </div>
                <div className="profile-row">
                  <span className="label">Designation</span>
                  <span className="value">
                    {salesperson.designation}
                  </span>

                </div>
              </div>
            </div>
          )}

          {activeTab === "clients" && (
            <div className="order-details-wrapper">
              <h2 className="order-title">Clients Book</h2>

              {clientsLoading ? (
                <p className="loading-text">Loading clients...</p>
              ) : clients.length === 0 ? (
                <p className="muted">No client found</p>
              ) : (
                <div className="table-wrapper">
                  <table className="clients-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Gender</th>
                        <th>Date of Birth</th>
                      </tr>
                    </thead>

                    <tbody>
                      {clients.map((c, i) => (
                        <tr key={i}>
                          <td data-label="Name">{c.name}</td>
                          <td data-label="Email">{c.email}</td>
                          <td data-label="Phone">{formatPhoneNumber(c.phone)}</td>
                          <td data-label="Gender">{c.gender}</td>
                          <td data-label="Date of Birth">{c.dob}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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
