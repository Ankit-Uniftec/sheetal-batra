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
              <h2 className="comms-section-title">Orders</h2>
              {renderStub("Order list + create-new entry point", [
                "Full order list with search and status filter",
                "Filter by engagement type (Barter / Gifting / Sourcing / Personal)",
                "Order card: Order No, Client, Type, Status, Delivery Date",
                "Create New Order button (use the New Comms Order button on Overview for now)",
                "Return button on sourcing orders",
              ])}
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
