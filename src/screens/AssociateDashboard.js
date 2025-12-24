import React, { useEffect, useState } from "react";
import "./AssociateDashboard.css";
import "./OrderHistory.css"; // reuse same card UI
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Logo from "../images/logo.png";
import formatIndianNumber from "../utils/formatIndianNumber";
import formatPhoneNumber from "../utils/formatPhoneNumber";
import formatDate from "../utils/formatDate"; // Import formatDate

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();

  const [activeTab, setActiveTab] = useState("dashboard");

  const [salesperson, setSalesperson] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSidebar, setShowSidebar] = useState(false); // New state for sidebar visibility

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [enteredPassword, setEnteredPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [clients, setClients] = useState([]);
  const [calendarDate, setCalendarDate] = useState(
    () => new Date() // Initialize with a Date object
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
      formatDate(o.created_at) === formatDate(new Date())
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

  useEffect(() => {
    const fromBuyerVerification =
      location.state?.fromBuyerVerification ||
      sessionStorage.getItem("fromBuyerVerification") === "true";

    if (fromBuyerVerification) {
      setShowPasswordModal(true);
      sessionStorage.removeItem("fromBuyerVerification");
    }
  }, []);

  useEffect(() => {
    const requireLogoutVerification = sessionStorage.getItem("requirePasswordVerificationOnDashboard") === "true";
    const requireReturnVerification = sessionStorage.getItem("requirePasswordVerificationOnReturn") === "true";

    if (requireLogoutVerification || requireReturnVerification) {
      setShowPasswordModal(true);
      sessionStorage.removeItem("requirePasswordVerificationOnDashboard");
      sessionStorage.removeItem("requirePasswordVerificationOnReturn");
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
        dob: formatDate(profileMap.get(c.email)?.dob),
      }));

      setClients(finalClients);
      setClientsLoading(false);
    };

    loadClients();
  }, [salesperson]);



  const handleLogout = async () => {
    await supabase.auth.signOut();
    sessionStorage.setItem("requirePasswordVerificationOnDashboard", "true");
    navigate("/login");
  };

  if (loading) return <p className="ad-loading-text">Loading Dashboard...</p>;

  const statusBadge = (status) =>
    status === "complete" ? "complete" : "active";

  const calendarOrders = orders.filter(
    (o) => o.delivery_date && formatDate(o.delivery_date) === formatDate(calendarDate)
  );

  // Group orders by delivery date for calendar view
  const ordersByDate = orders.reduce((acc, order) => {
    const date = order.delivery_date ? formatDate(order.delivery_date) : null;
    if (date) {
      acc[date] = (acc[date] || 0) + 1;
    }
    return acc;
  }, {});

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

  // ---- constants 
  const MIN_CALENDAR_DATE = new Date(2025, 11, 1); // December 2025 (month is 0-based)


  return (
    <div className="ad-dashboardContent">
      {/* PASSWORD MODAL */}
      {showPasswordModal && (
        <div className="ad-password-modal">
          <div className="ad-password-box">
            <h3>Re-enter Password</h3>
            <input
              type="password"
              placeholder="Enter password"
              value={enteredPassword}
              onChange={(e) => setEnteredPassword(e.target.value)}
            />
            {passwordError && <p className="ad-error-text">{passwordError}</p>}
            {passwordError && <p className="ad-error-text">{passwordError}</p>}
            <button onClick={verifyPassword}>Verify</button>
          </div>
        </div>
      )}

      <div className={`ad-dashboard-wrapper ${showPasswordModal ? "ad-blurred" : "ad-none"}`}>



        {/* HEADER */}
        {/* <div className="ad-top-header">
          
            <img src={Logo} className="ad-logo" alt="logo" />
            <h1 className="ad-title">My Dashboard</h1>
            <button className="ad-logout-btn" onClick={handleLogout}>↪</button>
          

          

          
        </div> */}

        <div className="ad-top-header">
          <img src={Logo} className="logo4" alt="logo" />
          <h1 className="ad-order-title">My Dashboard</h1>
          {/* Logout button for larger screens */}
          <button className="ad-logout-btn ad-desktop-logout-btn" onClick={handleLogout}>↪</button>
          {/* Hamburger icon for smaller screens */}
          <div className="ad-hamburger-icon" onClick={() => setShowSidebar(!showSidebar)}>
            <div className="ad-bar"></div>
            <div className="ad-bar"></div>
            <div className="ad-bar"></div>
          </div>
        </div>

        {/* MAIN TABLE */}
        <div className={`ad-grid-table ${showSidebar ? "ad-sidebar-open" : ""}`}>

          {/* SIDEBAR */}
          <aside className={`ad-sidebar ${showSidebar ? "ad-open" : ""}`}>
            {/* <div
              className={`ad-hello-box ad-clickable ${activeTab === "profile" ? "ad-active" : ""}`}
             
            >
              Hello, {salesperson?.saleperson || "Associate"}
            </div> */}
            {/* Logout button for mobile sidebar */}




            <nav className="ad-menu">
              <a
                className={`ad-menu-item ${activeTab === "profile" ? "active" : ""}`}
                onClick={() => { setActiveTab("profile"); setShowSidebar(false); }}
              >
                View Profile
              </a>

              <a
                className={`ad-menu-item ${activeTab === "dashboard" ? "active" : ""}`}
                onClick={() => { setActiveTab("dashboard"); setShowSidebar(false); }}
              >
                Dashboard
              </a>
              <a
                className={`ad-menu-item ${activeTab === "calendar" ? "active" : ""}`}
                onClick={() => { setActiveTab("calendar"); setShowSidebar(false); }}
              >
                Calendar
              </a>

              <a
                className={`ad-menu-item ${activeTab === "orders" ? "active" : ""}`}
                onClick={() => { setActiveTab("orders"); setShowSidebar(false); }}
              >
                Order History
              </a>



              <a
                className={`ad-menu-item ${activeTab === "clients" ? "active" : ""}`}
                onClick={() => { setActiveTab("clients"); setShowSidebar(false); }}
              >
                Client Book
              </a>
              <a
                className={`ad-menu-item-logout `}
                onClick={handleLogout}
              >
                Log Out
              </a>
            </nav>
          </aside>

          {/* --------------- DASHBOARD CARDS ---------------- */}
          {activeTab === "dashboard" && (
            <>
              <div className="ad-cell ad-total-revenue">
                {/* i have removed the change value  */}
                <StatCard title="Total Revenue" value={`₹${formatIndianNumber(totalRevenue)}`} />
              </div>

              <div className="ad-cell ad-total-orders">
                <StatCard title="Total Orders" className="gold-text" value={formatIndianNumber(totalOrders)} />
              </div>

              <div className="ad-cell ad-total-clients">
                <StatCard title="Total Clients" value={formatIndianNumber(totalClients)} />
              </div>

              <div className="ad-cell ad-sales-target">
                <div className="ad-sales-card">
                  <div className="ad-sales-header">
                    <div>
                      <p className="ad-sales-label">Sales Target</p>
                      <p className="ad-sales-progress">In Progress</p>
                    </div>
                    {/* <p className="ad-sales-total">Sales Target <b>{formatIndianNumber(800000)}</b></p> */}
                  </div>

                  <div className="ad-sales-scale">
                    <span>₹{formatIndianNumber(totalRevenue)}</span>
                    <span>₹{formatIndianNumber(800000)}</span>
                  </div>

                  <div className="ad-progress-bar">
                    <div
                      className="ad-progress-fill"
                      style={{ width: `${(totalRevenue / 800000) * 100}%`, height: '10px', background: ' #d5b85a', borderRadius: '20px' }}
                    ></div>
                  </div>
                </div>
              </div>

              <div className="ad-cell ad-active-orders">
                <div className="ad-orders-card">
                  <div className="ad-card-header">
                    <span className="ad-card-title">Today's Orders</span>
                    <button className="ad-view-btn" onClick={() => setActiveTab("orders")} >View All</button>

                  </div>

                  <div className="cardbox" >
                    {activeOrders.length === 0 ? (
                      <p>No active orders</p>
                    ) : (
                      activeOrders.map((o) => (
                        <div className="ad-order-item" key={o.id} style={{ borderBottom: '1px solid #d5b85a' }}>
                          <p><b>Order No:</b> {o.id}</p>
                          {/* <p><b>Total:</b> ₹{o.grand_total}</p> */}
                          <p><b>Status:</b> {o.status}</p>
                          <p><b>Delivery Date:</b> {formatDate(o.delivery_date)}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <aside className="ad-cell ad-alerts-box">
                <div className="ad-alerts-header">
                  <span className="ad-alerts-title">Alerts</span>
                  <button className="ad-view-btn">View All</button>
                </div>
                <div className="ad-alerts-body">No alerts right now.</div>
              </aside>
            </>
          )}

          {/* ------------- ORDER DETAILS TAB (OrderHistory UI) ------------ */}
          {activeTab === "orders" && (
            <div className="ad-order-details-wrapper">

              <h2 className="ad-order-title">Order History</h2>
              <div className="ad-order-search-bar">
                <input
                  type="text"
                  placeholder="Search by Order ID, Product Name or Client Name or delivery date"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                />
              </div>

              <div className="ad-order-list-scroll">
                {filteredOrders.length === 0 && (
                  <p className="ad-muted">No orders found for this associate.</p>
                )}

                {filteredOrders.map((order) => {
                  const item = order.items?.[0] || {};
                  const imgSrc = item.image_url || "/placeholder.png";

                  return (
                    <div key={order.id} className="ad-order-card">
                      {/* Top Header Row */}
                      <div className="ad-order-header">
                        <div className="ad-header-info">
                          <div className="ad-header-item">
                            <span className="ad-header-label">Order No.:</span>
                            <span className="ad-header-value">{order.id?.slice(0, 8) || "—"}</span>
                          </div>
                          <div className="ad-header-item">
                            <span className="ad-header-label">Order Date.:</span>
                            <span className="ad-header-value">{formatDate(order.created_at) || "—"}</span>
                          </div>
                          <div className="ad-header-item">
                            <span className="ad-header-label">EDD:</span>
                            <span className="ad-header-value">{formatDate(order.delivery_date) || "—"}</span>
                          </div>
                        </div>
                        <div className="ad-header-actions">
                          {/* <button className="ad-view-details-btn" onClick={() => handleViewDetails(order)}>
                            View order details
                          </button> */}
                          {/* <button className="print-pdf-btn" onClick={() => handlePrintPdf(order)}>
                            <span className="pdf-icon">📄</span> Print PDF
                          </button> */}
                        </div>
                      </div>

                      {/* Product Content Row */}
                      <div className="ad-order-content">
                        <div className="ad-product-thumb">
                          <img src={imgSrc} alt={item.product_name || "Product"} />
                        </div>

                        <div className="ad-product-details">
                          {/* Product Name Row with Status Badge */}
                          <div className="ad-product-name-row">
                            <div className="ad-product-name">
                              <span className="ad-order-label">Product Name:</span>
                              <span className="ad-value">{item.product_name || "—"}</span>
                            </div>
                            {/* <div className={`ad-status-badge ${order.status === "complete" ? "ad-complete" : "ad-active"}`}>
                              {order.status === "complete" ? "Complete" : "Active"}
                            </div> */}
                          </div>
                          <div className="ad-product-name">
                            <span className="ad-order-label">Client Name:</span>
                            <span className="ad-value">{order.delivery_name || "—"}</span>
                          </div>

                          {/* Details Grid */}
                          <div className="ad-details-grid">
                            <div className="ad-detail-item">
                              <span className="ad-order-label">Amount:</span>
                              <span className="ad-value">₹{formatIndianNumber(order.grand_total)}</span>
                            </div>
                            <div className="ad-detail-item">
                              <span className="ad-order-label">Qty:</span>
                              <span className="ad-value">{order.total_quantity || 1}</span>
                            </div>
                            <div className="ad-detail-item">
                              <span className="ad-order-label">Color:</span>
                              <span className="ad-value">{item.color?.name || "—"}</span>
                            </div>
                            <div className="ad-detail-item">
                              <span className="ad-order-label">Size:</span>
                              <span className="ad-value">{item.size || "—"}</span>
                            </div>
                          </div>

                          {/* Sales Associate Row */}
                          <div className="ad-sa-row">
                            <span className="ad-order-label">SA:</span>
                            <span className="ad-value">
                              {order.salesperson || "—"}
                              {order.salesperson_phone ? ` (${formatPhoneNumber(order.salesperson_phone)})` : ""}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Decorative Line */}
                      <div className="ad-decorative-line"></div>
                    </div>
                  );
                })}
              </div>

            </div>
          )}

          {/* ------------- CALENDAR TAB ------------ */}


          {activeTab === "calendar" && (
            <div className="ad-order-details-wrapper">
              <h2 className="ad-order-title">Calendar</h2>

              {/* ---------- CONTROLS ---------- */}
              <div className="ad-calendar-controls">
                <button
                  disabled={
                    new Date(calendarDate).getFullYear() === 2025 &&
                    new Date(calendarDate).getMonth() === 11
                  }
                  onClick={() =>
                    setCalendarDate(prev => {
                      const d = new Date(prev);
                      d.setMonth(d.getMonth() - 1);

                      // block before December 2025
                      if (d < MIN_CALENDAR_DATE) return prev;

                      return d;
                    })
                  }
                >
                  {"<"}
                </button>

                <span>
                  {new Date(calendarDate).toLocaleString("default", {
                    month: "long",
                    year: "numeric",
                  })}
                </span>

                <button
                  onClick={() =>
                    setCalendarDate(prev => {
                      const d = new Date(prev);
                      d.setMonth(d.getMonth() + 1);
                      return d;
                    })
                  }
                >
                  {">"}
                </button>
              </div>

              {/* ---------- GRID ---------- */}
              <div className="ad-calendar-grid">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
                  <div key={day} className="ad-calendar-day-label">
                    {day}
                  </div>
                ))}

                {(() => {
                  const year = new Date(calendarDate).getFullYear();
                  const month = new Date(calendarDate).getMonth();

                  const firstDayOfMonth = new Date(year, month, 1).getDay();
                  const daysInMonth = new Date(year, month + 1, 0).getDate();
                  const totalCells = firstDayOfMonth + daysInMonth;

                  return Array.from({ length: totalCells }).map((_, i) => {
                    const date = i - firstDayOfMonth + 1;

                    if (date <= 0) {
                      return (
                        <div key={i} className="ad-calendar-date-box ad-empty" />
                      );
                    }

                    const currentDay = new Date(year, month, date);
                    const fullDate = formatDate(currentDay);
                    const todayDate = formatDate(new Date());
                    const orderCount = ordersByDate[fullDate] || 0;

                    return (
                      <div
                        key={i}
                        className={`ad-calendar-date-box ${fullDate === todayDate ? "ad-today" : ""
                          }`}
                        onClick={() => {
                          if (orderCount > 0) {
                            // setOrderSearch(fullDate);
                            setActiveTab("orders");
                          }
                        }}
                      >
                        <span className="ad-date-number">{date}</span>

                        {orderCount > 0 && (
                          <span className="ad-order-count">
                            {orderCount} Orders
                          </span>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}
          {/* ----------- SALES PERSON PROFILE TAB ----------- */}
          {activeTab === "profile" && salesperson && (
            <div className="ad-order-details-wrapper ad-profile-wrapper">

              <h2 className="ad-profile-title">My Profile</h2>

              <div className="ad-profile-card">
                <div className="ad-profile-row">
                  <span className="ad-label">Name</span>
                  <span className="ad-value">{salesperson.saleperson}</span>
                </div>

                <div className="ad-profile-row">
                  <span className="ad-label">Email</span>
                  <span className="ad-value">{salesperson.email}</span>
                </div>

                <div className="ad-profile-row">
                  <span className="ad-label">Phone</span>
                  <span className="ad-value">{formatPhoneNumber(salesperson.personal_phone)}</span>
                </div>

                <div className="ad-profile-row">
                  <span className="ad-label">Joining Date</span>
                  <span className="ad-value">
                    {formatDate(salesperson.join_date)}
                  </span>

                </div>
                <div className="ad-profile-row">
                  <span className="ad-label">Store Name</span>
                  <span className="ad-value">
                    {salesperson.store_name}
                  </span>

                </div>
                <div className="ad-profile-row">
                  <span className="ad-label">Designation</span>
                  <span className="ad-value">
                    {salesperson.designation}
                  </span>

                </div>
              </div>
            </div>
          )}

          {activeTab === "clients" && (
            <div className="ad-order-details-wrapper">
              <h2 className="ad-order-title">Client Book</h2>

              {clientsLoading ? (
                <p className="ad-loading-text">Loading clients...</p>
              ) : clients.length === 0 ? (
                <p className="ad-muted">No client found</p>
              ) : (
                <div className="ad-table-wrapper">
                  <table className="ad-clients-table">
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
                          <td data-label="Phone">{c.phone}</td>
                          <td data-label="Gender">{c.gender}</td>
                          <td data-label="Date of Birth">{formatDate(c.dob)}</td>
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
          className="ad-add-btn"
          onClick={async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
              sessionStorage.setItem("associateSession", JSON.stringify(session));
            }
            sessionStorage.setItem("returnToAssociate", "true");
            sessionStorage.setItem("requirePasswordVerificationOnReturn", "true"); // Set flag before navigating away
            navigate("/buyerVerification", { state: { fromAssociate: true } });
          }}
        >
          +
        </button>

        {/* BACK */}
        {/* <button className="ad-back-btn" onClick={() => {
          sessionStorage.setItem("requirePasswordVerificationOnReturn", "true"); // Set flag before navigating away
          navigate("/");
        }}>‹</button> */}
      </div>
    </div>
  );
}

function StatCard({ title, value, change }) {
  return (
    <div className="ad-stat-card">
      <p className="ad-stat-title">{title}</p>
      <div className="ad-stat-content">
        <span className="ad-stat-value">{value}</span>
        <span className="ad-stat-change">{change}</span>
      </div>
    </div>
  );
}