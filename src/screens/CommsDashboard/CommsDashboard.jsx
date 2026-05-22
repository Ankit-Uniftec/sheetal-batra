import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./CommsDashboard.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";
import { usePopup } from "../../components/Popup";
import NotificationBell from "../../components/NotificationBell";

/**
 * Comms Dashboard (Nazreen — Communications Executive)
 *
 * Phase 2a scope:
 *   - Auth guard (role = "comms")
 *   - 7-tab sidebar
 *   - Overview tab: real data — engagement-type cards, recent orders,
 *     "Create New Order" entry point that navigates to /comms-order-form
 *   - Other 6 tabs still stubs (Phase 2b backlog below)
 *
 * Phase 2b backlog:
 *   - Orders tab (list + filters + create-new entry)
 *   - Admin approval UI on AdminDashboard (for >Rs 35,000 Gifting/Barter)
 *
 * Phase 3 backlog (future sessions):
 *   - Sourcing Returns tab + decrement/increment_inventory RPCs
 *   - Inventory tab (read-only view + temp-block UX)
 *   - Reports tab (3 CSV/Excel exports)
 *   - PR Performance tab (per-order PR tracking form)
 *   - My Calendar tab (comms_calendar_events CRUD)
 *   - Alerts (24h before/after outfit return date)
 *   - WhatsApp PDF delivery wiring/verification
 */
export default function CommsDashboard() {
  const navigate = useNavigate();
  const { showPopup, PopupComponent } = usePopup();

  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [showSidebar, setShowSidebar] = useState(false);

  // Comms orders loaded once after auth. Used by Overview cards + recent list.
  const [orders, setOrders] = useState([]);

  // Orders tab filter state. Engagement filter is "all" or one of the 4
  // engagement types; status filter slices the lifecycle.
  const [ordersSearch, setOrdersSearch] = useState("");
  const [engagementFilter, setEngagementFilter] = useState("all");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");

  // Auth guard
  useEffect(() => {
    let cancelled = false;
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/login", { replace: true });
        return;
      }

      const { data: sp } = await supabase
        .from("salesperson")
        .select("email, role, saleperson, phone, designation, store_name")
        .eq("email", session.user.email?.toLowerCase())
        .maybeSingle();

      if (cancelled) return;
      if (!sp || sp.role !== "comms") {
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
        return;
      }

      setUser(session.user);
      setProfile(sp);

      // Load all comms orders for the dashboard. Filtered to is_comms=true so
      // the comms team only ever sees comms-channel orders.
      const { data: ordersData } = await supabase
        .from("orders")
        .select("*")
        .eq("is_comms", true)
        .order("created_at", { ascending: false });
      if (!cancelled && ordersData) setOrders(ordersData);

      setLoading(false);
    };
    checkAuth();
    return () => { cancelled = true; };
  }, [navigate]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  // Counts per engagement type — drives the Overview cards.
  const engagementCounts = useMemo(() => {
    const counts = { Barter: 0, Gifting: 0, Sourcing: 0, "Personal order": 0 };
    orders.forEach((o) => {
      const t = o.comms_engagement_type;
      if (t && counts.hasOwnProperty(t)) counts[t] += 1;
    });
    return counts;
  }, [orders]);

  // Recent orders for the overview list.
  const recentOrders = useMemo(() => orders.slice(0, 10), [orders]);

  // Full filtered list for the Orders tab.
  const filteredOrders = useMemo(() => {
    const q = ordersSearch.trim().toLowerCase();
    return orders.filter((o) => {
      // Engagement filter
      if (engagementFilter !== "all" && o.comms_engagement_type !== engagementFilter) return false;
      // Status filter — buckets the lifecycle into 4 user-friendly states
      if (orderStatusFilter !== "all") {
        const s = (o.status || "").toLowerCase();
        const ap = o.approval_status;
        if (orderStatusFilter === "pending_approval" && ap !== "pending_approval") return false;
        if (orderStatusFilter === "active") {
          if (ap === "pending_approval") return false;
          if (s === "completed" || s === "delivered" || s === "cancelled") return false;
        }
        if (orderStatusFilter === "completed" && !(s === "completed" || s === "delivered")) return false;
        if (orderStatusFilter === "cancelled" && s !== "cancelled") return false;
      }
      // Search by order_no, client name, agency name, POC
      if (q) {
        const hay = [
          o.order_no, o.delivery_name, o.comms_agency_name, o.comms_poc_name,
        ].filter(Boolean).map((v) => String(v).toLowerCase()).join(" ");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [orders, ordersSearch, engagementFilter, orderStatusFilter]);

  // Upcoming sourcing returns — sourcing orders whose return date is in the
  // next 14 days. Helps Nazreen flag follow-ups before the alerts wire up.
  const upcomingReturns = useMemo(() => {
    const now = new Date();
    const horizon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    return orders
      .filter((o) =>
        o.comms_engagement_type === "Sourcing" &&
        o.comms_outfit_return_date &&
        o.comms_return_status !== "Returned"
      )
      .filter((o) => {
        const d = new Date(o.comms_outfit_return_date);
        return d >= now && d <= horizon;
      })
      .sort((a, b) => new Date(a.comms_outfit_return_date) - new Date(b.comms_outfit_return_date))
      .slice(0, 5);
  }, [orders]);

  if (loading) return <div className="comms-loading">Loading...</div>;

  const TABS = [
    { key: "overview", label: "Overview" },
    { key: "orders", label: "Orders" },
    { key: "sourcing_returns", label: "Sourcing Returns" },
    { key: "inventory", label: "Inventory" },
    { key: "reports", label: "Reports" },
    { key: "pr_performance", label: "PR Performance" },
    { key: "my_calendar", label: "My Calendar" },
  ];

  const renderStub = (label, items) => (
    <div className="comms-card">
      <h3 className="comms-card-title">{label}</h3>
      <p className="comms-muted">This tab is part of a later phase. Coming next:</p>
      <ul className="comms-stub-list">
        {items.map((i, idx) => <li key={idx}>{i}</li>)}
      </ul>
    </div>
  );

  // Engagement-type chip color, used by the Overview cards + recent list rows.
  const engagementColor = (type) => {
    switch (type) {
      case "Barter": return "#1976d2";       // blue
      case "Gifting": return "#2e7d32";      // green
      case "Sourcing": return "#ef6c00";     // orange
      case "Personal order": return "#7b1fa2"; // purple
      default: return "#888";
    }
  };

  return (
    <div className="comms-page">
      {PopupComponent}

      {/* HEADER */}
      <header className="comms-header">
        <div className="comms-header-left">
          <button
            className="comms-hamburger"
            onClick={() => setShowSidebar((s) => !s)}
            aria-label="Toggle menu"
          >
            <span /><span /><span />
          </button>
          <img src={Logo} alt="Sheetal Batra" className="comms-logo" />
        </div>
        <h1 className="comms-title">Comms Dashboard</h1>
        <div className="comms-header-right">
          <NotificationBell userEmail={user?.email} onOrderClick={() => { }} />
          <span className="comms-user-name">{profile?.saleperson || "—"}</span>
        </div>
      </header>

      <div className="comms-body">
        {/* SIDEBAR */}
        <aside className={`comms-sidebar ${showSidebar ? "comms-sidebar-open" : ""}`}>
          <nav className="comms-nav">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                className={`comms-nav-item ${activeTab === tab.key ? "active" : ""}`}
                onClick={() => { setActiveTab(tab.key); setShowSidebar(false); }}
              >
                {tab.label}
              </button>
            ))}
            <button className="comms-nav-item comms-nav-logout" onClick={handleLogout}>
              Logout
            </button>
          </nav>
        </aside>

        {/* MAIN */}
        <main className="comms-main">
          {activeTab === "overview" && (
            <>
              <div className="comms-overview-header">
                <h2 className="comms-section-title">Overview</h2>
                <button
                  className="comms-primary-btn"
                  onClick={() => navigate("/comms-order-form")}
                >
                  + New Comms Order
                </button>
              </div>

              {/* Engagement-type cards */}
              <div className="comms-cards-row">
                {Object.entries(engagementCounts).map(([type, count]) => (
                  <div
                    key={type}
                    className="comms-stat-card"
                    style={{ borderLeftColor: engagementColor(type) }}
                  >
                    <p className="comms-stat-label">{type}</p>
                    <p className="comms-stat-value">{count}</p>
                    <p className="comms-stat-sub">orders</p>
                  </div>
                ))}
              </div>

              {/* Upcoming sourcing returns */}
              {upcomingReturns.length > 0 && (
                <div className="comms-card">
                  <h3 className="comms-card-title">
                    Upcoming Sourcing Returns
                    <span className="comms-card-subtitle">Next 14 days</span>
                  </h3>
                  <table className="comms-table">
                    <thead>
                      <tr>
                        <th>Order No</th>
                        <th>Client</th>
                        <th>Return Date</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {upcomingReturns.map((o) => (
                        <tr key={o.id}>
                          <td><span className="comms-mono">{o.order_no || "—"}</span></td>
                          <td>{o.delivery_name || "—"}</td>
                          <td>{formatDate(o.comms_outfit_return_date)}</td>
                          <td>{o.comms_return_status || "Pending"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Recent orders */}
              <div className="comms-card">
                <h3 className="comms-card-title">Recent Orders</h3>
                {recentOrders.length === 0 ? (
                  <p className="comms-muted">No comms orders yet. Click "+ New Comms Order" to create one.</p>
                ) : (
                  <table className="comms-table">
                    <thead>
                      <tr>
                        <th>Order No</th>
                        <th>Client</th>
                        <th>Engagement</th>
                        <th>Delivery</th>
                        <th>Status</th>
                        <th className="comms-amount">Notional Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentOrders.map((o) => {
                        const notionalValue = (o.items || []).reduce((sum, it) => {
                          const base = Number(it.price || 0) * Number(it.quantity || 1);
                          const extras = Array.isArray(it.extras)
                            ? it.extras.reduce((s, e) => s + Number(e.price || 0), 0)
                            : 0;
                          return sum + base + extras;
                        }, 0);
                        return (
                          <tr key={o.id}>
                            <td><span className="comms-mono">{o.order_no || "—"}</span></td>
                            <td>{o.delivery_name || "—"}</td>
                            <td>
                              <span
                                className="comms-chip"
                                style={{ background: `${engagementColor(o.comms_engagement_type)}1a`, color: engagementColor(o.comms_engagement_type) }}
                              >
                                {o.comms_engagement_type || "—"}
                              </span>
                            </td>
                            <td>{o.delivery_date ? formatDate(o.delivery_date) : "—"}</td>
                            <td>{o.status === "pending_approval" ? "Pending Approval" : (o.status || "—")}</td>
                            <td className="comms-amount">₹{formatIndianNumber(notionalValue)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          {activeTab === "orders" && (
            <>
              <div className="comms-overview-header">
                <h2 className="comms-section-title">Orders</h2>
                <button
                  className="comms-primary-btn"
                  onClick={() => navigate("/comms-order-form")}
                >
                  + New Comms Order
                </button>
              </div>

              {/* Search */}
              <div className="comms-card" style={{ marginBottom: 12 }}>
                <input
                  type="text"
                  className="comms-search"
                  placeholder="Search by order no, client, agency, POC…"
                  value={ordersSearch}
                  onChange={(e) => setOrdersSearch(e.target.value)}
                />

                {/* Engagement chips */}
                <div className="comms-chip-row">
                  {["all", "Barter", "Gifting", "Sourcing", "Personal order"].map((opt) => (
                    <button
                      key={opt}
                      className={`comms-filter-chip ${engagementFilter === opt ? "active" : ""}`}
                      style={engagementFilter === opt && opt !== "all"
                        ? { background: engagementColor(opt), borderColor: engagementColor(opt), color: "#fff" }
                        : undefined}
                      onClick={() => setEngagementFilter(opt)}
                    >
                      {opt === "all" ? "All Engagements" : opt}
                    </button>
                  ))}
                </div>

                {/* Status chips */}
                <div className="comms-chip-row" style={{ marginTop: 6 }}>
                  {[
                    { key: "all", label: "All Status" },
                    { key: "pending_approval", label: "Pending Approval" },
                    { key: "active", label: "Active" },
                    { key: "completed", label: "Completed" },
                    { key: "cancelled", label: "Cancelled" },
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      className={`comms-filter-chip ${orderStatusFilter === opt.key ? "active" : ""}`}
                      onClick={() => setOrderStatusFilter(opt.key)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Results */}
              <div className="comms-card">
                <p className="comms-muted" style={{ marginBottom: 10 }}>
                  Showing {filteredOrders.length} of {orders.length} orders
                </p>
                {filteredOrders.length === 0 ? (
                  <p className="comms-muted">No orders match the current filters.</p>
                ) : (
                  <table className="comms-table">
                    <thead>
                      <tr>
                        <th>Order No</th>
                        <th>Client</th>
                        <th>Engagement</th>
                        <th>Purpose</th>
                        <th>Order Date</th>
                        <th>Delivery</th>
                        <th>Status</th>
                        <th className="comms-amount">Notional ₹</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOrders.map((o) => {
                        const notional = (o.items || []).reduce((sum, it) => {
                          const base = Number(it.price || 0) * Number(it.quantity || 1);
                          const extras = Array.isArray(it.extras)
                            ? it.extras.reduce((s, e) => s + Number(e.price || 0), 0)
                            : 0;
                          return sum + base + extras;
                        }, 0);
                        const isPending = o.approval_status === "pending_approval";
                        const isReject = o.approval_status === "rejected";
                        const statusLabel = isPending ? "Pending Approval"
                          : isReject ? "Rejected"
                          : (o.status === "pending" ? "Order Received" : (o.status || "—"));
                        return (
                          <tr key={o.id}>
                            <td><span className="comms-mono">{o.order_no || "—"}</span></td>
                            <td>{o.delivery_name || "—"}</td>
                            <td>
                              <span
                                className="comms-chip"
                                style={{
                                  background: `${engagementColor(o.comms_engagement_type)}1a`,
                                  color: engagementColor(o.comms_engagement_type),
                                }}
                              >
                                {o.comms_engagement_type || "—"}
                              </span>
                            </td>
                            <td>{o.comms_purpose || "—"}</td>
                            <td>{o.created_at ? formatDate(o.created_at) : "—"}</td>
                            <td>{o.delivery_date ? formatDate(o.delivery_date) : "—"}</td>
                            <td>{statusLabel}</td>
                            <td className="comms-amount">₹{formatIndianNumber(notional)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          {activeTab === "sourcing_returns" && (
            <>
              <h2 className="comms-section-title">Sourcing Returns</h2>
              {renderStub("Per-product return tracking for sourcing orders", [
                "List of sourcing orders due for return",
                "Per-product: return status, condition, damage notes",
                "New product location after return",
                "Auto-update inventory on return (calls increment_inventory RPC)",
              ])}
            </>
          )}

          {activeTab === "inventory" && (
            <>
              <h2 className="comms-section-title">Inventory</h2>
              {renderStub("Live inventory view + export", [
                "Read products + product_variants for all locations",
                "Filter by category, store, warehouse, consignment",
                "Export to Excel (image, name, location, size, color, MRP)",
                "Temporary-block-with-timeline UX (design TBD)",
              ])}
            </>
          )}

          {activeTab === "reports" && (
            <>
              <h2 className="comms-section-title">Reports</h2>
              {renderStub("Three report formats with CSV/Excel export", [
                "Monthly Report — Agency & Individual",
                "Monthly Report — Private Orders",
                "PR Performance Report (aggregate)",
              ])}
            </>
          )}

          {activeTab === "pr_performance" && (
            <>
              <h2 className="comms-section-title">PR Performance</h2>
              {renderStub("Per-order PR tracking form", [
                "Active for delivered Gifting/Barter/Sourcing orders",
                "Outfit used Yes/No, deliverables Yes/No/Partial",
                "Coverage type multi-select (IG Post, Reel, Magazine, etc.)",
                "Upload links + images",
                "Estimated reach + impressions + outcome impact",
                "Writes to comms_pr_performance table",
              ])}
            </>
          )}

          {activeTab === "my_calendar" && (
            <>
              <h2 className="comms-section-title">My Calendar</h2>
              {renderStub("Personal notes calendar for the comms team", [
                "Editable events (follow-ups, shoots, etc.)",
                "Read/write to comms_calendar_events table",
                "Linkable to specific orders",
                "Alert notifications for upcoming events",
              ])}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
