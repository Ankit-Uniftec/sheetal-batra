import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { fetchAllRows } from "../../utils/fetchAllRows";
import { usePopup } from "../../components/Popup";
import { usePeriodFilterParam } from "../../components/PeriodFilter";
import Paginator from "../../components/Paginator";
import SearchByDropdown from "../../components/SearchByDropdown";
import QcReportModal from "../../components/QcReportModal";
import ScanStation from "../../components/ScanStation";
import "../../components/ScanStation.css";
import DeliveryPerformancePanel from "../../components/DeliveryPerformancePanel";
import ProductionOverview from "../../components/ProductionOverview";
import useTabParam from "../../hooks/useTabParam";
import formatDate from "../../utils/formatDate";
import { getWarehouseDate } from "../../utils/warehouseDate";
import { getOrderStatusLabel, getOrderChannelLabel, CHANNEL_SEGMENTS } from "../../utils/barcodeService";
import "./PackagingDashboard.css";
import DashboardHeader from "../../components/DashboardHeader";

// ============================================================
// PackagingDashboard — the packaging & dispatch desk (Aryadeep).
//
// Client spec (Jul 16). Points delivered here:
//   • All orders visible from ALL channels (no designation scoping)
//   • Full customer info on the order (this desk ships the parcel, so unlike
//     ShopifyOrdersDashboard — which deliberately hides contact details from
//     the vendor-facing floor — it NEEDS name/phone/address to label a box)
//   • Order-date calendar (PeriodFilter, the house standard)
//   • Final QC report per completed order, linked to the Order ID (QcReportModal)
//   • Analytics: T-2 production deadline, on-time delivery, on-time production,
//     delivery fails (DeliveryPerformancePanel)
//
// Still to come (needs a SQL migration, tracked separately): dispatch
// Scan-In/Scan-Out as two mandatory states, the "nothing leaves without
// Scan-Out" guard, retiring Mark as Delivered, and the Blue Dart label API.
// ============================================================

const PER_PAGE = 20;

const SEARCH_FIELDS = [
  { value: "order_no", label: "Order No" },
  { value: "delivery_name", label: "Customer" },
  { value: "delivery_phone", label: "Phone" },
];

// Orders this desk acts on. Everything else is noise to a packer: an order
// still on the production floor is not theirs to box yet.
const DISPATCH_STATUSES = ["completed", "dispatched", "delivered"];

export default function PackagingDashboard() {
  const navigate = useNavigate();
  const { showPopup, PopupComponent } = usePopup();

  const [activeTab, setActiveTab] = useTabParam("queue");
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [components, setComponents] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [profile, setProfile] = useState(null);
  // Which scan stations this user may operate. null/undefined = every station;
  // an ARRAY (including empty) is a strict allow-list — see ScanStation.jsx.
  const [assignedStations, setAssignedStations] = useState(null);

  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState("order_no");
  const [statusFilter, setStatusFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("");
  const [urgencyFilter, setUrgencyFilter] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null);   // order id whose details are open
  const [qcReportFor, setQcReportFor] = useState(null);
  const [showSidebar, setShowSidebar] = useState(false);

  // Order-date calendar. PeriodFilter is the house standard — never hand-roll
  // date pills or a From/To pair. The URL-backed variant so Back restores the
  // range and a filtered view is linkable, matching the URL-backed tab above.
  const { control: periodControl, inPeriod } = usePeriodFilterParam("all", {
    variant: "select", label: "Order date:",
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Only the columns this screen reads. Unlike the vendor-facing Shopify
      // board, contact + address ARE fetched: you cannot label a parcel
      // without them, and that is this role's whole job. Money columns are
      // still left out — packing does not need order values.
      const ORDER_COLUMNS = [
        "id", "order_no", "created_at", "delivery_date", "status", "warehouse_stage",
        "delivered_at", "total_quantity", "items", "comments", "delivery_notes",
        "delivery_name", "delivery_phone", "delivery_email",
        "delivery_address", "delivery_city", "delivery_state", "delivery_pincode",
        "is_b2b", "is_comms", "is_gifting", "is_stock_order", "is_alteration",
      ].join(", ");

      // fetchAllRows everywhere — all three tables grow past the silent
      // 1000-row cap Supabase applies to unpaged queries.
      const [ordersRes, compsRes, shipRes] = await Promise.all([
        fetchAllRows("orders", (q) =>
          q.select(ORDER_COLUMNS).order("created_at", { ascending: false })),
        fetchAllRows("order_components", (q) =>
          q.select("id, order_id, order_no, barcode, component_type, component_label, current_stage, stage_updated_at, is_active, item_index")),
        fetchAllRows("shipments", (q) =>
          q.select("id, order_id, status, awb, courier_name, dispatched_at, delivered_at")),
      ]);

      setOrders(ordersRes.data || []);
      setComponents(compsRes.data || []);
      setShipments(shipRes.data || []);
    } catch (err) {
      console.error("Failed to load packaging dashboard:", err);
      showPopup({ title: "Error", message: "Could not load orders. Please refresh.", type: "error", confirmText: "OK" });
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- auth + role self-guard -------------------------------------------
  // This codebase has no central role->route map: the login switch and each
  // dashboard's own guard must agree. See CLAUDE.md "Auth & roles".
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/login", { replace: true }); return; }

      const { data: userRecord } = await supabase
        .from("salesperson")
        .select("saleperson, role, email, phone, store_name, designation, assigned_stations")
        .eq("email", session.user.email?.toLowerCase())
        .single();

      if (!userRecord || userRecord.role !== "packaging") {
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
        return;
      }
      setProfile(userRecord);
      // Keep null/undefined as-is (= full station access); only a real array
      // limits the worker. Don't coerce to [] — that reads as "no stations".
      setAssignedStations(userRecord.assigned_stations ?? null);
      loadData();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  // ---- derived ------------------------------------------------------------
  const componentsByOrder = useMemo(() => {
    const map = {};
    components.forEach((c) => {
      if (!map[c.order_id]) map[c.order_id] = [];
      map[c.order_id].push(c);
    });
    return map;
  }, [components]);

  const shipmentsByOrder = useMemo(() => {
    const map = {};
    shipments.forEach((s) => {
      if (!map[s.order_id]) map[s.order_id] = [];
      map[s.order_id].push(s);
    });
    return map;
  }, [shipments]);

  // The dispatch desk working set: past production, in the chosen date range.
  const dispatchOrders = useMemo(
    () => orders.filter((o) => DISPATCH_STATUSES.includes((o.status || "").toLowerCase())),
    [orders]
  );

  // Has this order left the building? orders.status NEVER holds 'dispatched'
  // (verified on UAT: the only values present are order_received, completed,
  // delivered, cancelled, return_store_credit, revoked, exchange_return,
  // in_production). Dispatch is recorded on SHIPMENTS, so a pill keyed on
  // orders.status read a permanent 0. See db/../v2/78_shipments.sql.
  const isDispatched = useCallback(
    (o) => (shipmentsByOrder[o.id] || []).some(
      (sh) => ["dispatched", "delivered"].includes((sh.status || "").toLowerCase())
    ),
    [shipmentsByOrder]
  );

  // Delivery urgency against the customer's promised date — what a packer
  // actually triages by: what is already late, what ships today, what can wait.
  const urgencyOf = useCallback((o) => {
    if (!o.delivery_date) return "none";
    const d = new Date(o.delivery_date);
    if (isNaN(d.getTime())) return "none";
    d.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d < today) return "overdue";
    if (d.getTime() === today.getTime()) return "today";
    return "upcoming";
  }, []);

  const visibleOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dispatchOrders.filter((o) => {
      if (!inPeriod(o.created_at)) return false;

      const status = (o.status || "").toLowerCase();
      if (statusFilter === "ready" && !(status === "completed" && !isDispatched(o))) return false;
      if (statusFilter === "dispatched" && !(isDispatched(o) && status !== "delivered")) return false;
      if (statusFilter === "delivered" && status !== "delivered") return false;

      if (channelFilter && getOrderChannelLabel(o) !== channelFilter) return false;
      if (urgencyFilter && urgencyOf(o) !== urgencyFilter) return false;

      if (!q) return true;
      return (o[searchField] || "").toString().toLowerCase().includes(q);
    });
  }, [dispatchOrders, inPeriod, statusFilter, channelFilter, urgencyFilter,
      search, searchField, isDispatched, urgencyOf]);

  const totalPages = Math.max(1, Math.ceil(visibleOrders.length / PER_PAGE));
  const pageRows = useMemo(
    () => visibleOrders.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [visibleOrders, page]
  );

  // Any filter change invalidates the current page number.
  useEffect(() => { setPage(1); }, [search, searchField, statusFilter, channelFilter, urgencyFilter, visibleOrders.length]);

  // Counts use the SAME predicates the filter does, so a pill can never
  // disagree with the list it opens.
  const counts = useMemo(() => ({
    all: dispatchOrders.length,
    ready: dispatchOrders.filter((o) => o.status === "completed" && !isDispatched(o)).length,
    dispatched: dispatchOrders.filter((o) => isDispatched(o) && o.status !== "delivered").length,
    delivered: dispatchOrders.filter((o) => o.status === "delivered").length,
  }), [dispatchOrders, isDispatched]);

  // Only channels actually present in the queue — an option that matches
  // nothing is noise on a shop-floor screen.
  const channelOptions = useMemo(() => {
    const present = new Set(dispatchOrders.map(getOrderChannelLabel));
    return CHANNEL_SEGMENTS.map((c) => c.label).filter((l) => present.has(l));
  }, [dispatchOrders]);

  // Analytics scope: the date-filtered set across ALL statuses, not just the
  // dispatch queue — on-time production is a question about every order.
  const analyticsOrders = useMemo(
    () => orders.filter((o) => inPeriod(o.created_at)),
    [orders, inPeriod]
  );

  const fullAddress = (o) => [o.delivery_address, o.delivery_city, o.delivery_state, o.delivery_pincode]
    .filter(Boolean).join(", ") || "—";

  if (loading) {
    return (
      <div className="pkg-page">
        <div className="pkg-loading">
          <div className="pkg-spinner" />
          <span>Loading Dashboard...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="pkg-page">
      {PopupComponent}
      {qcReportFor && (
        <QcReportModal
          orderId={qcReportFor.id}
          orderNo={qcReportFor.order_no}
          onClose={() => setQcReportFor(null)}
        />
      )}

      {/* HEADER */}
      <DashboardHeader
          title="Packaging & Dispatch"
          onHome={() => setActiveTab("queue")}
          onMenuToggle={() => setShowSidebar(!showSidebar)}
          userEmail={profile?.email}
          onLogout={handleLogout}
      />

      <div className="pkg-layout">
        {/* SIDEBAR */}
        <aside className={`pkg-sidebar ${showSidebar ? "open" : ""}`}>
          <nav className="pkg-nav">
            <button
              className={`pkg-nav-item ${activeTab === "queue" ? "active" : ""}`}
              onClick={() => { setActiveTab("queue"); setShowSidebar(false); }}
            >Dispatch Queue</button>
            <button
              className={`pkg-nav-item ${activeTab === "scan" ? "active" : ""}`}
              onClick={() => { setActiveTab("scan"); setShowSidebar(false); }}
            >Scan Station</button>
            <button
              className={`pkg-nav-item ${activeTab === "analytics" ? "active" : ""}`}
              onClick={() => { setActiveTab("analytics"); setShowSidebar(false); }}
            >Analytics &amp; Reports</button>
            <button className="pkg-nav-item logout" onClick={handleLogout}>Logout</button>
          </nav>
        </aside>

        {/* CONTENT */}
        <main className="pkg-content">

      {activeTab === "queue" && (
        <>
          <div className="pkg-tab-header">
            <h2 className="pkg-section-title">Dispatch Queue</h2>
          </div>
          <div className="pkg-toolbar">
            {periodControl}
            <SearchByDropdown
              fields={SEARCH_FIELDS}
              selectedField={searchField}
              onFieldChange={setSearchField}
              query={search}
              onQueryChange={setSearch}
              placeholder="Search orders…"
            />
            <select
              className="pkg-filter-select"
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              aria-label="Filter by channel"
            >
              <option value="">All channels</option>
              {channelOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              className="pkg-filter-select"
              value={urgencyFilter}
              onChange={(e) => setUrgencyFilter(e.target.value)}
              aria-label="Filter by delivery urgency"
            >
              <option value="">Any delivery date</option>
              <option value="overdue">Overdue</option>
              <option value="today">Due today</option>
              <option value="upcoming">Upcoming</option>
              <option value="none">No delivery date</option>
            </select>
            {(channelFilter || urgencyFilter || search) && (
              <button
                className="pkg-filter-clear"
                onClick={() => { setChannelFilter(""); setUrgencyFilter(""); setSearch(""); }}
              >Clear</button>
            )}
          </div>

          <div className="pkg-status-tabs">
            {[
              { key: "all", label: "All" },
              { key: "ready", label: "Ready to Pack" },
              { key: "dispatched", label: "Dispatched" },
              { key: "delivered", label: "Delivered" },
            ].map((s) => (
              <button
                key={s.key}
                className={`pkg-status-tab ${statusFilter === s.key ? "active" : ""}`}
                onClick={() => setStatusFilter(s.key)}
              >
                {s.label} <span className="pkg-tab-count">{counts[s.key] ?? 0}</span>
              </button>
            ))}
          </div>

          <p className="pkg-result-line">
            {visibleOrders.length} order{visibleOrders.length === 1 ? "" : "s"}
          </p>

          {pageRows.length === 0 ? (
            <p className="pkg-empty">No orders match these filters.</p>
          ) : (
            <div className="pkg-list">
              {pageRows.map((o) => {
                const comps = componentsByOrder[o.id] || [];
                const ship = (shipmentsByOrder[o.id] || [])[0];
                const isOpen = expanded === o.id;
                return (
                  <div key={o.id} className={`pkg-card ${isOpen ? "open" : ""}`}>
                    <div className="pkg-card-head" onClick={() => setExpanded(isOpen ? null : o.id)}>
                      <div className="pkg-card-main">
                        <span className="pkg-order-no">{o.order_no}</span>
                        <span className="pkg-channel">{getOrderChannelLabel(o)}</span>
                      </div>
                      <div className="pkg-card-dates">
                        <span>Ordered: <b>{formatDate(o.created_at)}</b></span>
                        <span>T-2: <b>{getWarehouseDate(o.delivery_date, o.created_at)}</b></span>
                        <span>Delivery: <b>{o.delivery_date ? formatDate(o.delivery_date) : "—"}</b></span>
                        <span>{comps.length} piece{comps.length === 1 ? "" : "s"}</span>
                      </div>

                      <div className="pkg-card-meta">
                        <span className="pkg-customer">{o.delivery_name || "—"}</span>
                        <span className={`pkg-status pkg-status-${(o.status || "").toLowerCase()}`}>
                          {getOrderStatusLabel(o.status)}
                        </span>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="pkg-card-body">
                        <div className="pkg-detail-grid">
                          <div>
                            <p className="pkg-detail-label">Customer</p>
                            <p className="pkg-detail-value">{o.delivery_name || "—"}</p>
                            <p className="pkg-detail-value">{o.delivery_phone || "—"}</p>
                            <p className="pkg-detail-value">{o.delivery_email || "—"}</p>
                          </div>
                          <div>
                            <p className="pkg-detail-label">Shipping Address</p>
                            <p className="pkg-detail-value">{fullAddress(o)}</p>
                          </div>
                          <div>
                            <p className="pkg-detail-label">Shipment</p>
                            <p className="pkg-detail-value">
                              {ship ? `${ship.courier_name || "Courier"} · ${ship.status}` : "Not packed yet"}
                            </p>
                            <p className="pkg-detail-value">{ship?.awb ? `AWB ${ship.awb}` : "No AWB"}</p>
                          </div>
                        </div>

                        {(o.comments || o.delivery_notes) && (
                          <p className="pkg-notes">Note: {o.comments || o.delivery_notes}</p>
                        )}

                        {/* Every barcode on the order, not just is_active ones:
                            is_active means "activated by a Cloth Issue scan"
                            (it defaults to FALSE — see v2/35), not "is a real
                            piece". Filtering on it showed an empty piece list
                            while the header still counted 2 pieces. */}
                        <div className="pkg-pieces">
                          {comps.map((c) => (
                            <span key={c.id} className="pkg-piece">
                              {c.component_label || c.component_type} · {c.barcode}
                            </span>
                          ))}
                        </div>

                        <div className="pkg-card-actions">
                          <button className="pkg-action" onClick={() => setQcReportFor(o)}>
                            Final QC Report
                          </button>
                          <button className="pkg-action" onClick={() => navigate(`/order/${o.id}`)}>
                            Open Order
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <Paginator page={page} totalPages={totalPages} onChange={setPage} />
        </>
      )}

      {/* The SAME ScanStation the standalone scan-station page and the
          warehouse dashboard embed — one implementation, so a scanning rule
          change lands everywhere. allowedStations comes from the user's own
          salesperson.assigned_stations, so this desk sees exactly the
          station(s) it is assigned (e.g. ["packaging"]). */}
      {activeTab === "scan" && (
        <>
          <div className="pkg-tab-header">
            <h2 className="pkg-section-title">Scan Station</h2>
          </div>
          <ScanStation
            currentUserEmail={profile?.email || ""}
            allowedStations={assignedStations}
          />
        </>
      )}

      {activeTab === "analytics" && (
        <>
          <div className="pkg-tab-header">
            <h2 className="pkg-section-title">Analytics &amp; Reports</h2>
          </div>
          <div className="pkg-toolbar">{periodControl}</div>
          <DeliveryPerformancePanel
            orders={analyticsOrders}
            components={components}
            shipments={shipments}
          />
          <ProductionOverview
            orders={analyticsOrders}
            components={components}
            allComponents={components}
            showChannel
          />
        </>
      )}

        </main>
      </div>
    </div>
  );
}
