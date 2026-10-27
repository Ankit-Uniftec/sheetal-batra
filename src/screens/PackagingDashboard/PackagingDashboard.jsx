import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { fetchAllRows } from "../../utils/fetchAllRows";
import { usePopup } from "../../components/Popup";
import { usePeriodFilterParam } from "../../components/PeriodFilter";
import Paginator from "../../components/Paginator";
import SearchByDropdown from "../../components/SearchByDropdown";
import QcReportModal from "../../components/QcReportModal";
import ComponentJourneyModal from "../../components/ComponentJourneyModal";
import ScanStation from "../../components/ScanStation";
import "../../components/ScanStation.css";
import DeliveryPerformancePanel from "../../components/DeliveryPerformancePanel";
import ProductionOverview from "../../components/ProductionOverview";
import useTabParam from "../../hooks/useTabParam";
import formatDate from "../../utils/formatDate";
import { getWarehouseDate, getWarehouseDateObj } from "../../utils/warehouseDate";
import { shippingAddressOf } from "../../utils/shippingAddress";
import { orderPayment } from "../../utils/orderPayment";
import { dispatchSummary } from "../../utils/shipmentStatus";
import DispatchBadge from "../../components/DispatchBadge";
import { isAllLxrtsOrder } from "../../utils/lxrtsProduct.mjs";
import DispatchCalendar from "./DispatchCalendar";
import DispatchOverrideModal from "../../components/DispatchOverrideModal";
import {
  getOrderStatusLabel, getOrderChannelLabel, getOrderChannelKey, CHANNEL_SEGMENTS,
  getComponentStageLabel, getStageColor, getStageLabel,
} from "../../utils/barcodeService";
import { downloadCsv } from "../../utils/downloadCsv";
import { EXPORT_HEADERS, buildPackagingExportRows } from "../../utils/packagingExport";
import "./PackagingDashboard.css";
import DashboardHeader from "../../components/DashboardHeader";
import DispatchReport from "../../components/DispatchReport";

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
  { value: "shopify_order_name", label: "Shopify #" },
  { value: "po_number", label: "PO No" },
];

// "#29067" and "29067" both find Shopify order #29067.
const normaliseSearch = (field, q) => (field === "shopify_order_name" ? q.replace(/^#/, "") : q);

const inr = (n) => (n == null || isNaN(n) ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`);
const colorName = (c) => (c && typeof c === "object" ? c.name || "" : c || "");
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// T-2 dispatch-date buckets for the filter (the date the desk ships by).
const T2_OPTIONS = [
  { value: "overdue", label: "T-2 passed" },
  { value: "today", label: "T-2 today" },
  { value: "week", label: "T-2 in next 7 days" },
  { value: "later", label: "T-2 later" },
];

// Orders this desk acts on. Everything else is noise to a packer: an order
// still on the production floor is not theirs to box yet.
const DISPATCH_STATUSES = ["completed", "dispatched", "delivered"];

// Orders still on the production floor (meeting point 34a: "show all orders
// even if not marked complete by the warehouse"). Shown on their own
// "In Production" tab so the desk can see what is coming — VIEW ONLY: the
// cards carry no pack or dispatch action, and the Scan Station tab's database
// rules still refuse any piece that has not cleared Final QC. Kept out of
// "All", which stays the dispatch working set. Cancelled / revoked / returned
// orders are not coming to this desk, so they are not listed.
const IN_PRODUCTION_STATUSES = ["order_received", "in_production"];

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
  const [paymentFilter, setPaymentFilter] = useState("");
  const [t2Filter, setT2Filter] = useState("");
  const [dayFilter, setDayFilter] = useState("");          // "YYYY-MM-DD" picked on the calendar
  const [view, setView] = useState("list");                // "list" | "calendar"
  const [vendors, setVendors] = useState({});              // id → vendor (B2B buyer brand)
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null);   // order id whose details are open
  const [qcReportFor, setQcReportFor] = useState(null);
  const [journeyFor, setJourneyFor] = useState(null);   // { order_no, components } for View Journey
  const [overrideFor, setOverrideFor] = useState(null); // order for the Dispatch Override popup
  const [overrideLog, setOverrideLog] = useState(null); // packaging_override rows, loaded on the tab
  const [exporting, setExporting] = useState(false);
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
      // without them, and that is this role's whole job. Money IS fetched since
      // meeting point 34: the client asked for the card to show payment like
      // the Shopify cards (paid / balance / mode), so the desk knows what to
      // collect before a parcel leaves.
      const ORDER_COLUMNS = [
        "id", "order_no", "created_at", "delivery_date", "status", "warehouse_stage",
        "delivered_at", "total_quantity", "items", "comments", "delivery_notes",
        "delivery_name", "delivery_phone", "delivery_email",
        "delivery_address", "delivery_city", "delivery_state", "delivery_pincode",
        "is_b2b", "is_comms", "is_gifting", "is_stock_order", "is_alteration",
        // getOrderChannelLabel/getOrderChannelKey fallbacks. salesperson_store
        // is the last resort for an order whose order_no prefix is unrecognised
        // (SB-LLC-, SB-GEN-, SB-PO-…) — without it those 4 orders label as a
        // bare "Store" and drop out of the channel filter. is_private_order and
        // shopify_order_id cover a row whose store string doesn't name the
        // channel. Not optional just because the prefix usually wins.
        "salesperson_store", "is_private_order", "shopify_order_id",
        // In Production tab: a B2B order counts only once the merchandiser has
        // approved it (same rule as the PM and Warehouse dashboards).
        "approval_status",
        // Point 34: store-delivery orders carry no address — the store's is
        // used (utils/shippingAddress); billing + references for the details.
        "mode_of_delivery",
        // (orders has no billing_city/state/pincode — the address is one field.)
        "billing_same", "billing_company", "billing_gstin", "billing_address", "billing_country",
        "shopify_order_name", "po_number", "vendor_id",
        // Payment on the card (utils/orderPayment — same rules as the export).
        "shopify_financial_status", "shopify_tags",
        "payment_mode", "is_split_payment", "total_paid", "advance_payment", "remaining_payment",
        "net_total", "grand_total_after_discount", "grand_total",
      ].join(", ");

      // fetchAllRows everywhere — all three tables grow past the silent
      // 1000-row cap Supabase applies to unpaged queries.
      const [ordersRes, compsRes, shipRes, vendorsRes] = await Promise.all([
        fetchAllRows("orders", (q) =>
          q.select(ORDER_COLUMNS).order("created_at", { ascending: false })),
        fetchAllRows("order_components", (q) =>
          // Vendor, disposition and pass-count fields feed the In Production
          // tab's stage badges and View Journey (which shows "At <vendor>").
          q.select("id, order_id, order_no, barcode, component_type, component_label, current_stage, previous_stage, stage_updated_at, is_active, item_index, is_outside_wh, vendor_name, vendor_exit_at, disposition, disposition_reason, stage_pass_counts, re_journey_count")),
        fetchAllRows("shipments", (q) =>
          // Which pieces went in each box → "Packed" marks on the pieces.
          q.select("id, order_id, status, awb, courier_name, dispatched_at, delivered_at, shipment_components(component_id)")),
        // B2B buyer's brand: a B2B order has no delivery_name.
        supabase.from("vendors").select("id, store_brand_name, vendor_code"),
      ]);

      setOrders(ordersRes.data || []);
      setComponents(compsRes.data || []);
      setShipments(shipRes.data || []);
      setVendors(Object.fromEntries((vendorsRes.data || []).map((v) => [v.id, v])));
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

  // Ready stock (LXRTS — "OTR", point #12): the piece already exists on the
  // shelf, nothing is produced. STORE ready-stock orders are packed at the
  // store and never come to this desk, so they are left out entirely. WEBSITE
  // ready-stock orders do come here, and are ready to pack as soon as they are
  // placed — they never pass through production, so they must not wait in
  // In Production for a status that would never come.
  const isReadyStock = useCallback((o) => isAllLxrtsOrder(o), []);
  const deskOrders = useMemo(
    () => orders.filter((o) => !(isReadyStock(o) && !o.shopify_order_id)),
    [orders, isReadyStock]
  );
  const isOpenReadyStock = useCallback(
    (o) => isReadyStock(o) && !!o.shopify_order_id && IN_PRODUCTION_STATUSES.includes((o.status || "").toLowerCase()),
    [isReadyStock]
  );

  // The dispatch desk working set: past production, in the chosen date range.
  const dispatchOrders = useMemo(
    () => deskOrders.filter((o) => DISPATCH_STATUSES.includes((o.status || "").toLowerCase()) || isOpenReadyStock(o)),
    [deskOrders, isOpenReadyStock]
  );

  // Not finished yet — the view-only In Production tab. A B2B order is only in
  // production once the merchandiser approves it (a rejected or pending one
  // never reaches this desk), the same rule the PM and Warehouse dashboards use.
  const productionOrders = useMemo(
    () => deskOrders.filter((o) =>
      IN_PRODUCTION_STATUSES.includes((o.status || "").toLowerCase()) &&
      !isOpenReadyStock(o) &&
      (!o.is_b2b || o.approval_status === "approved")),
    [deskOrders, isOpenReadyStock]
  );
  const isInProduction = (o) => IN_PRODUCTION_STATUSES.includes((o.status || "").toLowerCase());

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

  const isShopifyOrder = (o) => getOrderChannelKey(o) === "shopify";
  // Payment per order, computed once — the card badge, the details panel and
  // the payment filter all read this one map (utils/orderPayment).
  const paymentById = useMemo(() => {
    const map = {};
    orders.forEach((o) => { map[o.id] = orderPayment(o, { isShopify: getOrderChannelKey(o) === "shopify" }); });
    return map;
  }, [orders]);

  // T-2 = the date this desk must ship by (utils/warehouseDate, shared rule).
  const t2Of = useCallback((o) => getWarehouseDateObj(o.delivery_date, o.created_at), []);
  const t2Bucket = useCallback((o) => {
    const d = t2Of(o);
    if (!d) return "none";
    d.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((d - today) / 86400000);
    if (days < 0) return "overdue";
    if (days === 0) return "today";
    return days <= 7 ? "week" : "later";
  }, [t2Of]);

  // Every filter EXCEPT the calendar day — the calendar counts read this, so a
  // day's number is exactly what clicking it lists.
  const filteredOrders = useMemo(() => {
    const q = normaliseSearch(searchField, search.trim().toLowerCase());
    // The In Production tab reads its own set; every other pill filters the
    // dispatch working set exactly as before.
    const base = statusFilter === "in_production" ? productionOrders : dispatchOrders;
    return base.filter((o) => {
      if (!inPeriod(o.created_at)) return false;

      const status = (o.status || "").toLowerCase();
      if (statusFilter === "ready" && !((status === "completed" || isOpenReadyStock(o)) && !isDispatched(o))) return false;
      if (statusFilter === "dispatched" && !(isDispatched(o) && status !== "delivered")) return false;
      if (statusFilter === "delivered" && status !== "delivered") return false;

      if (channelFilter && getOrderChannelLabel(o) !== channelFilter) return false;
      if (urgencyFilter && urgencyOf(o) !== urgencyFilter) return false;
      if (paymentFilter && paymentById[o.id]?.label !== paymentFilter) return false;
      if (t2Filter && t2Bucket(o) !== t2Filter) return false;

      if (!q) return true;
      return (o[searchField] || "").toString().toLowerCase().includes(q);
    });
  }, [dispatchOrders, productionOrders, inPeriod, statusFilter, channelFilter, urgencyFilter,
      paymentFilter, t2Filter, paymentById, t2Bucket, search, searchField, isDispatched, urgencyOf, isOpenReadyStock]);

  const visibleOrders = useMemo(() => {
    if (!dayFilter) return filteredOrders;
    return filteredOrders.filter((o) => { const d = t2Of(o); return d && dayKey(d) === dayFilter; });
  }, [filteredOrders, dayFilter, t2Of]);

  // Payment states present in the list being looked at — no dead options.
  const paymentOptions = useMemo(() => {
    const base = statusFilter === "in_production" ? productionOrders : dispatchOrders;
    return [...new Set(base.map((o) => paymentById[o.id]?.label).filter(Boolean))].sort();
  }, [dispatchOrders, productionOrders, statusFilter, paymentById]);

  const totalPages = Math.max(1, Math.ceil(visibleOrders.length / PER_PAGE));
  const pageRows = useMemo(
    () => visibleOrders.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [visibleOrders, page]
  );

  // "Export Excel" (meeting point 43): every order the current tab and filters
  // show — all pages, not just this one — one row per product.
  //
  // The money columns are loaded with the orders since point 34 (the card
  // shows payment), so the export reads them from the same rows instead of a
  // second query. buildPackagingExportRows still takes them as a separate map.
  const handleExport = async () => {
    if (!visibleOrders.length || exporting) return;
    setExporting(true);
    try {
      const money = Object.fromEntries(visibleOrders.map((o) => [o.id, o]));
      const rows = buildPackagingExportRows(
        visibleOrders,
        componentsByOrder,
        money,
        {
          channelLabel: getOrderChannelLabel,
          stageLabel: getComponentStageLabel,
          warehouseDate: getWarehouseDate,
          formatDate,
          isShopify: isShopifyOrder,
        }
      );
      if (!rows.length) {
        showPopup({ title: "Nothing to export", message: "No products in the orders shown.", type: "info", confirmText: "OK" });
        return;
      }
      const tab = statusFilter === "all" ? "all" : statusFilter.replace(/_/g, "-");
      downloadCsv({ filename: `packaging_${tab}_orders`, headers: EXPORT_HEADERS, rows });
    } catch (err) {
      console.error("Packaging export failed:", err);
      showPopup({ title: "Export failed", message: err.message || "Could not build the export. Please try again.", type: "error", confirmText: "OK" });
    } finally {
      setExporting(false);
    }
  };

  // Any filter change invalidates the current page number.
  useEffect(() => { setPage(1); }, [search, searchField, statusFilter, channelFilter, urgencyFilter,
    paymentFilter, t2Filter, dayFilter, visibleOrders.length]);

  // Counts use the SAME predicates the filter does, so a pill can never
  // disagree with the list it opens.
  const counts = useMemo(() => ({
    all: dispatchOrders.length,
    ready: dispatchOrders.filter((o) => (o.status === "completed" || isOpenReadyStock(o)) && !isDispatched(o)).length,
    dispatched: dispatchOrders.filter((o) => isDispatched(o) && o.status !== "delivered").length,
    delivered: dispatchOrders.filter((o) => o.status === "delivered").length,
    in_production: productionOrders.length,
  }), [dispatchOrders, productionOrders, isDispatched, isOpenReadyStock]);

  // Only channels actually present in the list being looked at — an option
  // that matches nothing is noise on a shop-floor screen.
  const channelOptions = useMemo(() => {
    const base = statusFilter === "in_production" ? productionOrders : dispatchOrders;
    const present = new Set(base.map(getOrderChannelLabel));
    return CHANNEL_SEGMENTS.map((c) => c.label).filter((l) => present.has(l));
  }, [dispatchOrders, productionOrders, statusFilter]);

  // Analytics scope: the date-filtered set across ALL statuses, not just the
  // dispatch queue — on-time production is a question about every order.
  const analyticsOrders = useMemo(
    () => orders.filter((o) => inPeriod(o.created_at)),
    [orders, inPeriod]
  );

  // B2B orders have no delivery_name: the buyer is the vendor's brand.
  const customerName = (o) => o.delivery_name || (o.is_b2b && vendors[o.vendor_id]?.store_brand_name) || "—";

  // Billing as the customer gave it; "Same as shipping" when they ticked it.
  const billingLines = (o) => {
    const addr = [o.billing_address, o.billing_country]
      .filter((v) => v && String(v).trim() !== "").join(", ");
    return {
      company: o.billing_company || "",
      gstin: (o.billing_gstin || "").trim(),
      address: o.billing_same ? "Same as shipping address" : addr,
    };
  };

  // Products of the order with their pieces under each (point 34: "use
  // components and pieces"). Charge lines have no pieces and are skipped.
  // Pieces with an item_index past the items list still show, under "Other".
  const productsOf = (o, comps) => {
    const items = (o.items || []).map((it, idx) => ({ it, idx })).filter(({ it }) => !it?.is_charge);
    const groups = items.map(({ it, idx }) => ({
      key: idx,
      name: it.product_name || `Product ${idx + 1}`,
      size: it.size || it.size_label || "",
      color: [...new Set([colorName(it.top_color), colorName(it.bottom_color)].filter(Boolean))].join(" / "),
      pieces: comps.filter((c) => (c.item_index ?? 0) === idx),
    }));
    const known = new Set(items.map(({ idx }) => idx));
    const other = comps.filter((c) => !known.has(c.item_index ?? 0));
    if (other.length) groups.push({ key: "other", name: "Other pieces", size: "", color: "", pieces: other });
    return groups;
  };

  // Component ids that went into a live box — the "Packed" mark on a piece.
  const packedIds = useMemo(() => {
    const ids = new Set();
    shipments.forEach((s) => {
      if (["cancelled", "returned"].includes((s.status || "").toLowerCase())) return;
      (s.shipment_components || []).forEach((sc) => ids.add(sc.component_id));
    });
    return ids;
  }, [shipments]);

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
      {overrideFor && (
        <DispatchOverrideModal
          order={overrideFor}
          components={componentsByOrder[overrideFor.id] || []}
          packedIds={packedIds}
          by={profile?.email || ""}
          onClose={() => setOverrideFor(null)}
          onDone={() => { loadData(); setOverrideLog(null); }}
        />
      )}
      {journeyFor && (
        <ComponentJourneyModal
          orderNo={journeyFor.order_no}
          components={journeyFor.components}
          onClose={() => setJourneyFor(null)}
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
              className={`pkg-nav-item ${activeTab === "overrides" ? "active" : ""}`}
              onClick={() => { setActiveTab("overrides"); setShowSidebar(false); }}
            >Override Log</button>
            <button
              className={`pkg-nav-item ${activeTab === "analytics" ? "active" : ""}`}
              onClick={() => { setActiveTab("analytics"); setShowSidebar(false); }}
            >Analytics &amp; Reports</button>
            <button
              className={`pkg-nav-item ${activeTab === "dispatch_report" ? "active" : ""}`}
              onClick={() => { setActiveTab("dispatch_report"); setShowSidebar(false); }}
            >Dispatch Report</button>
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
            <select
              className="pkg-filter-select"
              value={t2Filter}
              onChange={(e) => setT2Filter(e.target.value)}
              aria-label="Filter by T-2 dispatch date"
            >
              <option value="">Any T-2 date</option>
              {T2_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <select
              className="pkg-filter-select"
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value)}
              aria-label="Filter by payment"
            >
              <option value="">Any payment</option>
              {paymentOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            {(channelFilter || urgencyFilter || paymentFilter || t2Filter || dayFilter || search) && (
              <button
                className="pkg-filter-clear"
                onClick={() => {
                  setChannelFilter(""); setUrgencyFilter(""); setPaymentFilter("");
                  setT2Filter(""); setDayFilter(""); setSearch("");
                }}
              >Clear</button>
            )}
            <div className="pkg-view-toggle" role="group" aria-label="View">
              <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>List</button>
              <button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>Calendar</button>
            </div>
          </div>

          <div className="pkg-status-tabs">
            {[
              { key: "all", label: "All" },
              { key: "ready", label: "Ready to Pack" },
              { key: "dispatched", label: "Dispatched" },
              { key: "delivered", label: "Delivered" },
              { key: "in_production", label: "In Production" },
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

          {view === "calendar" && (
            <DispatchCalendar
              orders={filteredOrders}
              dateOf={t2Of}
              dayKey={dayKey}
              selectedDay={dayFilter}
              onPickDay={(d) => { setDayFilter(d); setView("list"); }}
            />
          )}

          <div className="pkg-result-row">
            <p className="pkg-result-line">
              {visibleOrders.length} order{visibleOrders.length === 1 ? "" : "s"}
              {statusFilter === "in_production" && " · still in production — view only, not ready to pack"}
              {dayFilter && (
                <button className="pkg-day-chip" onClick={() => setDayFilter("")} title="Show all days">
                  T-2 {formatDate(dayFilter)} ✕
                </button>
              )}
            </p>
            <button
              className="pkg-export-btn"
              onClick={handleExport}
              disabled={exporting || visibleOrders.length === 0}
              title="Download every order shown (all pages), one row per product"
            >
              {exporting ? "Exporting…" : "Export Excel"}
            </button>
          </div>

          {pageRows.length === 0 ? (
            <p className="pkg-empty">No orders match these filters.</p>
          ) : (
            <div className="pkg-list">
              {pageRows.map((o) => {
                const comps = componentsByOrder[o.id] || [];
                const ship = (shipmentsByOrder[o.id] || [])[0];
                const isOpen = expanded === o.id;
                const pay = paymentById[o.id];
                const shipTo = shippingAddressOf(o);
                const sent = dispatchSummary(shipmentsByOrder[o.id], comps.length);
                const ref = o.shopify_order_name ? `Shopify ${o.shopify_order_name}` : o.po_number ? `PO ${o.po_number}` : "";
                return (
                  <div key={o.id} className={`pkg-card ${isOpen ? "open" : ""}`}>
                    <div className="pkg-card-head" onClick={() => setExpanded(isOpen ? null : o.id)}>
                      <div className="pkg-card-main">
                        <span className="pkg-order-no">{o.order_no}</span>
                        <span className="pkg-channel">{getOrderChannelLabel(o)}</span>
                        {ref && <span className="pkg-ref">{ref}</span>}
                      </div>
                      <div className="pkg-card-dates">
                        <span>Ordered: <b>{formatDate(o.created_at)}</b></span>
                        <span>T-2: <b>{getWarehouseDate(o.delivery_date, o.created_at)}</b></span>
                        <span>Delivery: <b>{o.delivery_date ? formatDate(o.delivery_date) : "—"}</b></span>
                        <span>{comps.length} piece{comps.length === 1 ? "" : "s"}</span>
                      </div>

                      <div className="pkg-card-meta">
                        <span className="pkg-customer">{customerName(o)}</span>
                        {shipTo.store && <span className="pkg-store-tag">{shipTo.store}</span>}
                        {shipTo.missing && <span className="pkg-addr-missing">Address missing</span>}
                        {pay && <span className={`pkg-pay pkg-pay-${pay.variant}`}>{pay.label}</span>}
                        <DispatchBadge summary={sent} />
                        {isReadyStock(o) && <span className="pkg-store-tag" title="Ready stock (LXRTS) — on the shelf, nothing to produce">Ready stock</span>}
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
                            <p className="pkg-detail-value">{customerName(o)}</p>
                            <p className="pkg-detail-value">{o.delivery_phone || "—"}</p>
                            <p className="pkg-detail-value">{o.delivery_email || "—"}</p>
                            {o.shopify_order_name && <p className="pkg-detail-value">Shopify order: {o.shopify_order_name}</p>}
                            {o.po_number && <p className="pkg-detail-value">PO no.: {o.po_number}</p>}
                            {o.is_b2b && vendors[o.vendor_id]?.vendor_code && (
                              <p className="pkg-detail-value">Vendor code: {vendors[o.vendor_id].vendor_code}</p>
                            )}
                          </div>
                          <div>
                            <p className="pkg-detail-label">Shipping Address</p>
                            {shipTo.store && <p className="pkg-detail-value"><b>{shipTo.store}</b></p>}
                            <p className={`pkg-detail-value ${shipTo.missing ? "pkg-missing" : ""}`}>
                              {shipTo.missing ? "No address on the order" : shipTo.address}
                            </p>
                            {o.mode_of_delivery && o.mode_of_delivery !== shipTo.store && (
                              <p className="pkg-detail-value pkg-muted">{o.mode_of_delivery}</p>
                            )}
                          </div>
                          {(() => {
                            const b = billingLines(o);
                            return (
                              <div>
                                <p className="pkg-detail-label">Billing</p>
                                {b.company && <p className="pkg-detail-value">{b.company}</p>}
                                {b.gstin && <p className="pkg-detail-value">GSTIN: {b.gstin}</p>}
                                <p className="pkg-detail-value">{b.address || "—"}</p>
                              </div>
                            );
                          })()}
                          {pay && (
                            <div>
                              <p className="pkg-detail-label">Payment</p>
                              <p className="pkg-detail-value">
                                <span className={`pkg-pay pkg-pay-${pay.variant}`}>{pay.label}</span>
                              </p>
                              {pay.total != null && <p className="pkg-detail-value">Total: {inr(pay.total)}</p>}
                              {pay.paid != null && <p className="pkg-detail-value">Paid: {inr(pay.paid)}</p>}
                              {pay.balance != null && (
                                <p className={`pkg-detail-value ${pay.balance > 0 ? "pkg-balance-due" : ""}`}>
                                  Balance: {inr(pay.balance)}
                                </p>
                              )}
                              {pay.mode && <p className="pkg-detail-value pkg-muted">{pay.mode}</p>}
                            </div>
                          )}
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

                        {/* Products, each with its pieces (point 34). Every
                            barcode on the order, not just is_active ones:
                            is_active means "activated by a Cloth Issue scan"
                            (it defaults to FALSE — see v2/35), not "is a real
                            piece". Filtering on it showed an empty piece list
                            while the header still counted 2 pieces. */}
                        <div className="pkg-products">
                          {productsOf(o, comps).map((g) => (
                            <div key={g.key} className="pkg-product">
                              <p className="pkg-product-name">
                                {g.name}
                                {(g.size || g.color) && (
                                  <span className="pkg-muted"> · {[g.size && `Size ${g.size}`, g.color].filter(Boolean).join(" · ")}</span>
                                )}
                              </p>
                              <div className="pkg-pieces">
                                {g.pieces.length === 0 && <span className="pkg-muted">No barcodes yet</span>}
                                {g.pieces.map((c) => (
                                  <span key={c.id} className="pkg-piece">
                                    {c.component_label || c.component_type} · {c.barcode}
                                    <span
                                      className="pkg-piece-stage"
                                      style={{ backgroundColor: c.is_outside_wh ? "#e0913f" : getStageColor(c.current_stage) }}
                                    >
                                      {c.is_outside_wh ? `At ${c.vendor_name || "vendor"}` : getComponentStageLabel(c)}
                                    </span>
                                    {packedIds.has(c.id) && <span className="pkg-piece-packed">Packed</span>}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="pkg-card-actions">
                          {isInProduction(o) && comps.length > 0 && (
                            <button
                              className="pkg-action"
                              onClick={() => setJourneyFor({ order_no: o.order_no, components: comps })}
                            >
                              View Journey
                            </button>
                          )}
                          {/* Dispatch Override (points 10 + 34): anything not yet
                              fully out — ready to pack or still in production. */}
                          {(isInProduction(o) || ((o.status || "").toLowerCase() === "completed" && !isDispatched(o)))
                            && comps.length > 0 && (
                            <button className="pkg-action pkg-action-override" onClick={() => setOverrideFor(o)}>
                              Dispatch Override
                            </button>
                          )}
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

      {activeTab === "overrides" && (
        <>
          <div className="pkg-tab-header">
            <h2 className="pkg-section-title">Override Log</h2>
          </div>
          <OverrideLog rows={overrideLog} onLoad={setOverrideLog} />
        </>
      )}

      {/* Dispatch report (open point #11): every box dispatched, printable. */}
      {activeTab === "dispatch_report" && (
        <>
          <div className="pkg-tab-header">
            <h2 className="pkg-section-title">Dispatch Report</h2>
          </div>
          <DispatchReport />
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

// Every Dispatch Override, newest first (meeting points 10 + 34): who, when,
// which piece, from which stage, and why. Read from stage_overrides, where the
// PM's own override history shows the same rows as "Packaging Override".
function OverrideLog({ rows, onLoad }) {
  useEffect(() => {
    if (rows) return;
    fetchAllRows("stage_overrides", (q) => q
      .select("id, order_no, barcode, from_stage, reason, overridden_by, created_at")
      .eq("override_type", "packaging_override")
      .order("created_at", { ascending: false }))
      .then(({ data, error }) => {
        if (error) console.error("Override log load failed:", error);
        onLoad(data || []);
      });
  }, [rows, onLoad]);

  if (!rows) return <p className="pkg-empty">Loading…</p>;
  if (!rows.length) return <p className="pkg-empty">No dispatch overrides yet.</p>;
  return (
    <div className="pkg-log">
      <table>
        <thead>
          <tr><th>When</th><th>Order</th><th>Piece</th><th>Was at</th><th>Reason</th><th>By</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{formatDate(r.created_at)}</td>
              <td>{r.order_no}</td>
              <td className="pkg-mono">{r.barcode}</td>
              <td>{getStageLabel(r.from_stage) || r.from_stage || "—"}</td>
              <td>{r.reason}</td>
              <td>{r.overridden_by}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
