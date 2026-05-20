import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./CommsDashboard.css";
import Logo from "../../images/logo.png";
import { usePopup } from "../../components/Popup";
import NotificationBell from "../../components/NotificationBell";

/**
 * Comms Dashboard (Nazreen — Communications Executive)
 *
 * PHASE 1 SCOPE (this file): foundational scaffolding only.
 *   - Auth guard (role = "comms")
 *   - 7-tab sidebar with stubs
 *   - Header + NotificationBell
 *   - No order placement, no reports, no PR performance form yet
 *
 * PHASE 2 BACKLOG (separate sessions):
 *   1. Dashboard tab — engagement-type cards, recent orders, calendar with
 *      color-coded segments
 *   2. Orders tab — list + filters + "create new order" entry to CommsOrderForm
 *   3. CommsOrderForm + CommsReviewOrder screens
 *   4. Sourcing Returns tab — per-product return tracking
 *   5. Inventory tab — read-only inventory view + temporary-block UX
 *   6. Reports tab — three CSV/Excel exports
 *   7. PR Performance tab — per-order PR tracking form (writes to
 *      comms_pr_performance table)
 *   8. My Calendar tab — comms_calendar_events CRUD
 *   9. Integrations to build / verify:
 *      - generate_order_no RPC needs COMMS branch (see db/comms_dashboard.sql)
 *      - decrement_inventory / increment_inventory RPCs for sourcing flow
 *      - spur-whatsapp edge function delivery to +91 9773983394
 *      - Cap-and-approve flow for Gifting/Barter > Rs 35,000 (Jahnavi approval)
 *      - Alert wiring (24h before / 24h after outfit return date)
 */
export default function CommsDashboard() {
  const navigate = useNavigate();
  const { showPopup, PopupComponent } = usePopup();

  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [showSidebar, setShowSidebar] = useState(false);

  // Auth guard — only role="comms" can access this dashboard.
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
      setLoading(false);
    };
    checkAuth();
    return () => { cancelled = true; };
  }, [navigate]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  if (loading) {
    return <div className="comms-loading">Loading...</div>;
  }

  // Tab definitions. Each tab is stubbed in Phase 1 — features land per the
  // backlog above.
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
      <p className="comms-muted">This tab is part of Phase 2. Coming next:</p>
      <ul className="comms-stub-list">
        {items.map((i, idx) => <li key={idx}>{i}</li>)}
      </ul>
    </div>
  );

  return (
    <div className="comms-page">
      {PopupComponent}

      {/* ───────── HEADER ───────── */}
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
        {/* ───────── SIDEBAR ───────── */}
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

        {/* ───────── MAIN ───────── */}
        <main className="comms-main">
          {activeTab === "overview" && (
            <>
              <h2 className="comms-section-title">Overview</h2>
              {renderStub("Engagement-type cards + recent orders + calendar", [
                "Cards: Barter / Gifting / Sourcing / Personal counts",
                "Recent orders list (last 10)",
                "Upcoming deliveries widget",
                "Upcoming sourcing returns (return date approaching)",
                "Color-coded order calendar (blue/green/orange/purple)",
              ])}
            </>
          )}

          {activeTab === "orders" && (
            <>
              <h2 className="comms-section-title">Orders</h2>
              {renderStub("Order list + create-new entry point", [
                "Full order list with search and status filter",
                "Filter by engagement type (Barter / Gifting / Sourcing / Personal)",
                "Order card: Order No, Client, Type, Status, Delivery Date",
                "Create New Order button → CommsOrderForm",
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
