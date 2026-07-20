import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { fetchAllRows } from "../../utils/fetchAllRows";
import "./CommsDashboard.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";
import { usePopup } from "../../components/Popup";
import NotificationBell from "../../components/NotificationBell";
import ProductionHeadVendors from "../../components/ProductionHeadVendors";
import "../../components/ProductionHeadVendors.css";
import ComponentJourneyModal from "../../components/ComponentJourneyModal";
import ComponentStageBadge from "../../components/ComponentStageBadge";
import { enrichComponentsWithMovements } from "../../utils/barcodeService";
import { downloadCustomerPdf, downloadWarehousePdf } from "../../utils/pdfUtils";
import CommsSourcingReturns from "./CommsSourcingReturns";
import CommsReports from "./CommsReports";
import CommsPRPerformance from "./CommsPRPerformance";
import CommsInventory from "./CommsInventory";
import CommsCalendar from "./CommsCalendar";
import CommsOrderCalendar from "./CommsOrderCalendar";
import useTabParam from "../../hooks/useTabParam";
import Paginator from "../../components/Paginator";
import { usePeriodFilter } from "../../components/PeriodFilter";

// Comms order cards are heavy (image, colour swatches, component chips) —
// rendering the whole filtered list lags once orders grow. Paginate.
const ORDERS_PER_PAGE = 10;

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
  const [activeTab, setActiveTab] = useTabParam("overview");
  const [showSidebar, setShowSidebar] = useState(false);

  // Comms orders loaded once after auth. Used by Overview cards + recent list.
  const [orders, setOrders] = useState([]);

  // Orders tab filter state. Engagement filter is "all" or one of the 4
  // engagement types; status filter slices the lifecycle. Date range is
  // applied against created_at (order placement date) — "" = no bound.
  const [ordersSearch, setOrdersSearch] = useState("");
  const [engagementFilter, setEngagementFilter] = useState("all");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [orderDateFrom, setOrderDateFrom] = useState("");
  const [orderDateTo, setOrderDateTo] = useState("");

  // Per-order PDF loading state — disables the button while the PDF is
  // being generated/opened. Mirrors AssociateDashboard's pattern.
  const [pdfLoading, setPdfLoading] = useState(null);
  const [warehousePdfLoading, setWarehousePdfLoading] = useState(null);

  // Production journey (shared ComponentJourneyModal). Comms orders run the
  // SAME 14-stage flow as every other channel — nothing in component
  // creation/activation/scanning branches on channel — so the same modal works
  // here unchanged. componentsByOrder gates the button: orders placed before
  // comms barcode generation existed have no components and get no button.
  const [componentsByOrder, setComponentsByOrder] = useState({});
  const [journeyOrder, setJourneyOrder] = useState(null); // { order_no, components }
  const openJourney = (e, order) => {
    e?.stopPropagation?.();
    setJourneyOrder({ order_no: order.order_no, components: componentsByOrder[order.id] || [] });
  };

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
      // Paged past Supabase's 1000-row cap
      const { data: ordersData } = await fetchAllRows("orders", (q) => q
        .select("*")
        .eq("is_comms", true)
        .order("created_at", { ascending: false }));
      if (!cancelled && ordersData) setOrders(ordersData);

      // Components for those orders — powers the per-order "View Journey"
      // button. Chunked .in() because a single huge id list can silently 400
      // on URL length (same reason the other dashboards chunk).
      if (!cancelled && ordersData?.length) {
        const ids = ordersData.map((o) => o.id);
        let comps = [];
        for (let i = 0; i < ids.length; i += 100) {
          const { data, error } = await supabase
            .from("order_components")
            .select("id, order_id, order_no, barcode, component_type, component_label, current_stage, previous_stage, item_index, is_outside_wh, stage_updated_at, disposition, disposition_reason, re_journey_count")
            .in("order_id", ids.slice(i, i + 100));
          if (error) { console.error("Comms component fetch failed:", error); break; }
          comps = comps.concat(data || []);
        }
        // Attach stages_outside so the journey badge reads "Out to Vendor (…)"
        // — the one shared helper every dashboard uses for that.
        const enriched = await enrichComponentsWithMovements(comps);
        if (!cancelled) {
          const TYPE_ORDER = { top: 0, bottom: 1, dupatta: 2, extra: 3 };
          const map = {};
          enriched.forEach((c) => { (map[c.order_id] || (map[c.order_id] = [])).push(c); });
          Object.values(map).forEach((arr) => arr.sort((a, b) =>
            (a.item_index ?? 0) - (b.item_index ?? 0) ||
            (TYPE_ORDER[a.component_type] ?? 9) - (TYPE_ORDER[b.component_type] ?? 9)
          ));
          setComponentsByOrder(map);
        }
      }

      setLoading(false);
    };
    checkAuth();
    return () => { cancelled = true; };
  }, [navigate]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  // Open the customer / warehouse PDF for a specific order. downloadCustomerPdf
  // and downloadWarehousePdf cache-bust the URL and window.open it in a new
  // tab — exactly what Nazreen needs when she clicks the PDF buttons.
  const handlePrintCustomerPdf = async (e, order) => {
    e.stopPropagation();
    setPdfLoading(order.id);
    try {
      await downloadCustomerPdf(order);
    } catch (err) {
      console.error("Customer PDF open failed:", err);
    } finally {
      setPdfLoading(null);
    }
  };

  const handlePrintWarehousePdf = async (e, order) => {
    e.stopPropagation();
    setWarehousePdfLoading(order.id);
    try {
      // Open the cached PDF; regenerate only on a cache miss — regenerating on
      // EVERY click (the old forceRegenerate=true) re-rendered and re-uploaded
      // the PDFs each view, and silently masked stale caches elsewhere: the PM
      // opened the same order's cached file without barcodes while this button
      // rebuilt it. Migration 39 clears the caches that predate the order's
      // components, so the cache is trustworthy now.
      const result = await downloadWarehousePdf(order, null, false);
      // Reflect freshly generated URLs in state so the next click uses the cache.
      if (result) {
        const urls = Array.isArray(result) ? result : [result];
        setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, warehouse_urls: urls, warehouse_url: urls[0] } : o)));
      }
    } catch (err) {
      console.error("Warehouse PDF open failed:", err);
    } finally {
      setWarehousePdfLoading(null);
    }
  };

  // Period filter for the Overview stats (Orders tab keeps its own date range).
  const { control: periodControl, inPeriod } = usePeriodFilter("all", { variant: "pills" });
  const periodOrders = useMemo(
    () => orders.filter((o) => inPeriod(o.created_at)),
    [orders, inPeriod]
  );

  // Counts per engagement type — drives the Overview cards.
  const engagementCounts = useMemo(() => {
    const counts = { Barter: 0, Gifting: 0, Sourcing: 0, "Personal order": 0 };
    periodOrders.forEach((o) => {
      const t = o.comms_engagement_type;
      if (t && counts.hasOwnProperty(t)) counts[t] += 1;
    });
    return counts;
  }, [periodOrders]);

  // Recent orders for the overview list.
  const recentOrders = useMemo(() => periodOrders.slice(0, 10), [periodOrders]);

  // Full filtered list for the Orders tab.
  const filteredOrders = useMemo(() => {
    const q = ordersSearch.trim().toLowerCase();
    // Convert date filters to comparable timestamps. From = start of day,
    // To = end of day, so the From/To pair is inclusive of both endpoints.
    const fromTs = orderDateFrom ? new Date(orderDateFrom + "T00:00:00").getTime() : null;
    const toTs = orderDateTo ? new Date(orderDateTo + "T23:59:59.999").getTime() : null;
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
      // Date range filter (applied to created_at — order placement date)
      if (fromTs != null || toTs != null) {
        if (!o.created_at) return false;
        const ts = new Date(o.created_at).getTime();
        if (fromTs != null && ts < fromTs) return false;
        if (toTs != null && ts > toTs) return false;
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
  }, [orders, ordersSearch, engagementFilter, orderStatusFilter, orderDateFrom, orderDateTo]);

  // Page within the filtered orders; any filter change resets to page 1.
  const [ordersPage, setOrdersPage] = useState(1);
  useEffect(() => { setOrdersPage(1); }, [ordersSearch, engagementFilter, orderStatusFilter, orderDateFrom, orderDateTo]);
  const ordersTotalPages = Math.ceil(filteredOrders.length / ORDERS_PER_PAGE);
  const pagedOrders = useMemo(
    () => filteredOrders.slice((ordersPage - 1) * ORDERS_PER_PAGE, ordersPage * ORDERS_PER_PAGE),
    [filteredOrders, ordersPage]
  );

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
    { key: "order_calendar", label: "Order Calendar" },
    { key: "my_calendar", label: "My Calendar" },
    { key: "vendors", label: "Vendor / External" },
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

      {journeyOrder && (
        <ComponentJourneyModal
          orderNo={journeyOrder.order_no}
          components={journeyOrder.components}
          onClose={() => setJourneyOrder(null)}
        />
      )}

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

              {periodControl}

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

              {/* Filters: search + 3 labelled rows in a structured grid */}
              <div className="comms-filters-card">
                {/* Search bar — full width, top of the card */}
                <div className="comms-filters-search">
                  <span className="comms-filters-search-icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    placeholder="Search by order no, client, agency, POC…"
                    value={ordersSearch}
                    onChange={(e) => setOrdersSearch(e.target.value)}
                  />
                </div>

                {/* Engagement row */}
                <div className="comms-filters-row">
                  <span className="comms-filters-row-label">Engagement</span>
                  <div className="comms-filters-row-controls">
                    {["all", "Barter", "Gifting", "Sourcing", "Personal order"].map((opt) => (
                      <button
                        key={opt}
                        className={`comms-filter-chip ${engagementFilter === opt ? "active" : ""}`}
                        style={engagementFilter === opt && opt !== "all"
                          ? { background: engagementColor(opt), borderColor: engagementColor(opt), color: "#fff" }
                          : undefined}
                        onClick={() => setEngagementFilter(opt)}
                      >
                        {opt === "all" ? "All" : opt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Status row */}
                <div className="comms-filters-row">
                  <span className="comms-filters-row-label">Status</span>
                  <div className="comms-filters-row-controls">
                    {[
                      { key: "all", label: "All" },
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

                {/* Date range row */}
                <div className="comms-filters-row">
                  <span className="comms-filters-row-label">Order Date</span>
                  <div className="comms-filters-row-controls comms-filters-date-controls">
                    <input
                      type="date"
                      className="comms-date-input"
                      value={orderDateFrom}
                      onChange={(e) => setOrderDateFrom(e.target.value)}
                      max={orderDateTo || undefined}
                      aria-label="From date"
                    />
                    <span className="comms-date-sep" aria-hidden="true">→</span>
                    <input
                      type="date"
                      className="comms-date-input"
                      value={orderDateTo}
                      onChange={(e) => setOrderDateTo(e.target.value)}
                      min={orderDateFrom || undefined}
                      aria-label="To date"
                    />
                    {(orderDateFrom || orderDateTo) && (
                      <button
                        className="comms-date-clear"
                        onClick={() => { setOrderDateFrom(""); setOrderDateTo(""); }}
                      >Clear</button>
                    )}
                  </div>
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
                  <div className="comms-order-cards">
                    {pagedOrders.map((o) => {
                      const item = o.items?.[0] || {};
                      const imgSrc = item.image_url || "/placeholder.png";
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
                        : (o.status === "pending" || !o.status ? "Order Received"
                          : (o.status === "order_received" ? "Order Received"
                            : o.status));
                      // Status badge color class — borrows convention from
                      // status semantics: green for delivered/completed, amber for pending, red for cancelled/rejected.
                      const statusClass = (() => {
                        const s = (o.status || "").toLowerCase();
                        if (isPending) return "pending";
                        if (isReject || s === "cancelled") return "cancelled";
                        if (s === "delivered" || s === "completed") return "delivered";
                        return "order-received";
                      })();
                      return (
                        <div key={o.id} className="comms-order-card" data-order-id={o.id}>
                          <div className="comms-order-header">
                            <div className="comms-order-header-info">
                              <div className="comms-order-header-item">
                                <span className="comms-order-header-label">ORDER NO:</span>
                                <span className="comms-order-header-value">{o.order_no || "—"}</span>
                              </div>
                              <div className="comms-order-header-item">
                                <span className="comms-order-header-label">ORDER DATE:</span>
                                <span className="comms-order-header-value">{o.created_at ? formatDate(o.created_at) : "—"}</span>
                              </div>
                              <div className="comms-order-header-item">
                                <span className="comms-order-header-label">DELIVERY:</span>
                                <span className="comms-order-header-value">{o.delivery_date ? formatDate(o.delivery_date) : "—"}</span>
                              </div>
                            </div>
                            <div className="comms-order-header-actions">
                              <div className={`comms-order-status-badge comms-status-${statusClass}`}>
                                {statusLabel}
                              </div>
                              <button
                                className="comms-pdf-btn"
                                onClick={(e) => handlePrintCustomerPdf(e, o)}
                                disabled={pdfLoading === o.id}
                              >
                                {pdfLoading === o.id ? "..." : "📄 Customer PDF"}
                              </button>
                              <button
                                className="comms-pdf-btn"
                                onClick={(e) => handlePrintWarehousePdf(e, o)}
                                disabled={warehousePdfLoading === o.id}
                              >
                                {warehousePdfLoading === o.id ? "..." : "📄 Warehouse PDF"}
                              </button>
                            </div>
                          </div>

                          <div className="comms-order-content">
                            <div className="comms-product-thumb">
                              <img src={imgSrc} alt={item.product_name || "Product"} />
                            </div>
                            <div className="comms-product-details">
                              <div className="comms-product-row">
                                <span className="comms-product-label">Product:</span>
                                <span className="comms-product-value">{item.product_name || "—"}</span>
                              </div>
                              <div className="comms-product-row">
                                <span className="comms-product-label">Client:</span>
                                <span className="comms-product-value">{o.delivery_name || "—"}</span>
                              </div>
                              <div className="comms-product-row">
                                <span className="comms-product-label">Engagement:</span>
                                <span
                                  className="comms-chip"
                                  style={{
                                    background: `${engagementColor(o.comms_engagement_type)}1a`,
                                    color: engagementColor(o.comms_engagement_type),
                                  }}
                                >
                                  {o.comms_engagement_type || "—"}
                                </span>
                              </div>
                              {o.comms_purpose && (
                                <div className="comms-product-row">
                                  <span className="comms-product-label">Purpose:</span>
                                  <span className="comms-product-value">{o.comms_purpose}</span>
                                </div>
                              )}
                              {o.comms_agency_name && (
                                <div className="comms-product-row">
                                  <span className="comms-product-label">Agency:</span>
                                  <span className="comms-product-value">{o.comms_agency_name}</span>
                                </div>
                              )}

                              <div className="comms-details-grid">
                                <div className="comms-detail-item">
                                  <span className="comms-product-label">Notional ₹:</span>
                                  <span className="comms-product-value">₹{formatIndianNumber(notional)}</span>
                                </div>
                                <div className="comms-detail-item">
                                  <span className="comms-product-label">Qty:</span>
                                  <span className="comms-product-value">{o.total_quantity || (o.items || []).reduce((s, it) => s + (it.quantity || 1), 0) || 1}</span>
                                </div>
                                {item.top && (
                                  <div className="comms-detail-item">
                                    <span className="comms-product-label">Top:</span>
                                    <span className="comms-product-value">
                                      {item.top}
                                      {item.top_color?.hex && (
                                        <>
                                          <span
                                            style={{
                                              display: 'inline-block', width: 12, height: 12,
                                              backgroundColor: item.top_color.hex, borderRadius: '50%',
                                              marginLeft: 6, border: '1px solid #ccc', verticalAlign: 'middle',
                                            }}
                                          />
                                          {item.top_color.name && <span style={{ marginLeft: 4 }}>{item.top_color.name}</span>}
                                        </>
                                      )}
                                    </span>
                                  </div>
                                )}
                                {item.bottom && (
                                  <div className="comms-detail-item">
                                    <span className="comms-product-label">Bottom:</span>
                                    <span className="comms-product-value">
                                      {item.bottom}
                                      {item.bottom_color?.hex && (
                                        <>
                                          <span
                                            style={{
                                              display: 'inline-block', width: 12, height: 12,
                                              backgroundColor: item.bottom_color.hex, borderRadius: '50%',
                                              marginLeft: 6, border: '1px solid #ccc', verticalAlign: 'middle',
                                            }}
                                          />
                                          {item.bottom_color.name && <span style={{ marginLeft: 4 }}>{item.bottom_color.name}</span>}
                                        </>
                                      )}
                                    </span>
                                  </div>
                                )}
                                {item.size && (
                                  <div className="comms-detail-item">
                                    <span className="comms-product-label">Size:</span>
                                    <span className="comms-product-value">{item.size}</span>
                                  </div>
                                )}
                              </div>

                              {item.extras && item.extras.length > 0 && (
                                <div className="comms-product-row">
                                  <span className="comms-product-label">Extras:</span>
                                  <span className="comms-product-value">
                                    {item.extras.map((extra, idx) => (
                                      <span key={idx}>
                                        {extra.name}
                                        {extra.color?.hex && (
                                          <>
                                            <span
                                              style={{
                                                display: 'inline-block', width: 12, height: 12,
                                                backgroundColor: extra.color.hex, borderRadius: '50%',
                                                marginLeft: 6, border: '1px solid #ccc', verticalAlign: 'middle',
                                              }}
                                            />
                                            {extra.color.name && <span style={{ marginLeft: 4 }}>{extra.color.name}</span>}
                                          </>
                                        )}
                                        {idx < item.extras.length - 1 && <span style={{ margin: '0 8px' }}>|</span>}
                                      </span>
                                    ))}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Component journey — one chip per piece (TOP/BTM/DUP/extra)
                              with its current production stage, mirroring the PM view. */}
                          {componentsByOrder[o.id]?.length > 0 && (
                            <div className="comms-comp-journey">
                              {componentsByOrder[o.id].map((comp) => (
                                <div key={comp.id} className="comms-comp-card">
                                  <div className="comms-comp-info">
                                    <span className="comms-comp-barcode">{comp.barcode}</span>
                                    <span className="comms-comp-label">{comp.component_label || comp.component_type}</span>
                                  </div>
                                  <ComponentStageBadge comp={comp} />
                                </div>
                              ))}
                            </div>
                          )}

                          {componentsByOrder[o.id]?.length > 0 && (
                            <div className="comms-order-actions">
                              <button className="comms-journey-btn" onClick={(e) => openJourney(e, o)}>
                                View Journey
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <Paginator page={ordersPage} totalPages={ordersTotalPages} onChange={setOrdersPage} />
              </div>
            </>
          )}

          {activeTab === "sourcing_returns" && (
            <>
              <h2 className="comms-section-title">Sourcing Returns</h2>
              <CommsSourcingReturns
                orders={orders}
                onOrderUpdated={(updated) => {
                  setOrders((prev) => prev.map((o) => o.id === updated.id ? updated : o));
                }}
                showPopup={showPopup}
              />
            </>
          )}

          {activeTab === "inventory" && (
            <>
              <h2 className="comms-section-title">Inventory</h2>
              <CommsInventory profile={profile} showPopup={showPopup} />
            </>
          )}

          {activeTab === "reports" && (
            <>
              <h2 className="comms-section-title">Reports</h2>
              <CommsReports orders={orders} showPopup={showPopup} />
            </>
          )}

          {activeTab === "pr_performance" && (
            <>
              <h2 className="comms-section-title">PR Performance</h2>
              <CommsPRPerformance orders={orders} showPopup={showPopup} />
            </>
          )}

          {activeTab === "order_calendar" && (
            <>
              <h2 className="comms-section-title">Order Calendar</h2>
              <CommsOrderCalendar orders={orders} />
            </>
          )}

          {activeTab === "my_calendar" && (
            <>
              <h2 className="comms-section-title">My Calendar</h2>
              <CommsCalendar profile={profile} orders={orders} showPopup={showPopup} />
            </>
          )}

          {activeTab === "vendors" && (
            <ProductionHeadVendors currentUserEmail={profile?.email} />
          )}
        </main>
      </div>
    </div>
  );
}
