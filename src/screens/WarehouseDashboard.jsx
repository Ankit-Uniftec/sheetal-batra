import React, { useEffect, useState, useMemo, useRef } from "react";
import "./WarehouseDashboard.css";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { fetchAllRows } from "../utils/fetchAllRows";
import Logo from "../images/logo.png";
import formatDate from "../utils/formatDate";
import { getWarehouseDate as sharedWarehouseDate, getWarehouseDateObj } from "../utils/warehouseDate";
import { downloadWarehousePdf } from "../utils/pdfUtils";
import { usePopup } from "../components/Popup";
import NotificationBell from "../components/NotificationBell";
import ScanStation from "../components/ScanStation";
import "../components/ScanStation.css";
import ProductionHeadVendors from "../components/ProductionHeadVendors";
import "../components/ProductionHeadVendors.css";
import { getStageGroupKey, STAGE_GROUPS, enrichComponentsWithMovements, scopeOrdersToDesignation, getChannelKeyForDesignation, getOrderChannelKey, classifyComponentForStageCard } from "../utils/barcodeService";
import ComponentJourneyModal from "../components/ComponentJourneyModal";
import ComponentStageBadge from "../components/ComponentStageBadge";
import QcHistoryTable from "../components/QcHistoryTable";
import QcHistoryPanel from "../components/QcHistoryPanel";
import { fetchQcRecords } from "../utils/qcHistory";
import ReJourneyPanel from "../components/ReJourneyPanel";
import { fetchReJourneys } from "../utils/reJourneys";
import StageCountCards from "../components/StageCountCards";
import ProductionOverview from "../components/ProductionOverview";
import SearchByDropdown from "../components/SearchByDropdown";
import useTabParam from "../hooks/useTabParam";
import Paginator from "../components/Paginator";

// Status options for alterations
const ALTERATION_STATUS_OPTIONS = [
  { value: "order_received", label: "Order Received", color: "#ff9800" },
  { value: "in_production", label: "In Production", color: "#2196f3" },
  { value: "ready", label: "Ready", color: "#4caf50" },
  { value: "dispatched", label: "Dispatched", color: "#9c27b0" },
  { value: "delivered", label: "Delivered", color: "#388e3c" },
];

// Warehouse production stages (manual dropdown)
// const WAREHOUSE_STAGES = [
//   { value: "order_received", label: "Order Received", color: "#9e9e9e" },
//   { value: "cloth_issued", label: "Cloth Issued", color: "#795548" },
//   { value: "dyeing_in_progress", label: "Dyeing In-Progress", color: "#e91e63" },
//   { value: "pattern_cutting_in_progress", label: "Pattern Cutting In-Progress", color: "#9c27b0" },
//   { value: "pattern_printing_in_progress", label: "Pattern Printing In-Progress", color: "#673ab7" },
//   { value: "embroidery_in_progress", label: "Embroidery In-Progress", color: "#3f51b5" },
//   { value: "dry_cleaning_in_progress", label: "Dry Cleaning In-Progress", color: "#00bcd4" },
//   { value: "trims_in_progress", label: "Trims In-Progress", color: "#009688" },
//   { value: "cutting_stitching_in_progress", label: "Cutting & Stitching In-Progress", color: "#ff9800" },
//   { value: "hemming_in_progress", label: "Hemming In-Progress", color: "#ff5722" },
//   { value: "finishing_in_progress", label: "Finishing In-Progress", color: "#607d8b" },
//   { value: "qc_in_progress", label: "QC In-Progress", color: "#f44336" },
//   { value: "qc_passed", label: "QC Passed", color: "#4caf50" },
//   { value: "qc_failed", label: "QC Failed", color: "#d32f2f" },
//   { value: "packaging_dispatch", label: "Packaging & Dispatch", color: "#2e7d32" },
// ];

// // Stages available for re-journey restart
// const REJOURNEY_STAGES = [
//   { value: "dyeing_in_progress", label: "Dyeing" },
//   { value: "pattern_cutting_in_progress", label: "Pattern Cutting" },
//   { value: "pattern_printing_in_progress", label: "Pattern Printing" },
//   { value: "embroidery_in_progress", label: "Embroidery" },
//   { value: "dry_cleaning_in_progress", label: "Dry Cleaning" },
//   { value: "trims_in_progress", label: "Trims" },
//   { value: "cutting_stitching_in_progress", label: "Cutting & Stitching" },
//   { value: "hemming_in_progress", label: "Hemming" },
//   { value: "finishing_in_progress", label: "Finishing" },
// ];

// Status Tabs (Primary Filter - Mutually Exclusive by Order Lifecycle)
const STATUS_TABS = [
  { value: "all", label: "All Orders" },
  { value: "unfulfilled", label: "Unfulfilled" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  // { value: "alteration", label: "Alterations" },
];

const getMeasurementLabel = (key) => {
  if (!key) return key;
  const topKeys = ["KurtaChogaKaftan", "Blouse", "Anarkali"];
  const bottomKeys = ["SalwarDhoti", "ChuridaarTrouserPantsPlazo", "ShararaGharara"];
  if (topKeys.includes(key)) return "Top";
  if (bottomKeys.includes(key)) return "Bottom";
  if (key === "Lehenga") return "Lehenga";
  return key;
};

const WarehouseDashboard = () => {
  const { showPopup, PopupComponent } = usePopup();
  const navigate = useNavigate();

  const isLxrtsOrder = (order) => {
    return order.items?.[0]?.sync_enabled === true;
  };

  const [orders, setOrders] = useState([]);
  // Components of THIS PH's channel orders — powers the channel-scoped
  // "Orders by Production Stage" overview (Offline/Online head only). The order
  // LIST stays global; only these analytics are scoped to their channel.
  const [overviewComponents, setOverviewComponents] = useState([]);
  const [overviewLoading, setOverviewLoading] = useState(false);
  // Overview date-period filter (scopes the stage cards + Production Overview by
  // order placement date). all | day | month | year | custom.
  const [overviewPeriod, setOverviewPeriod] = useState("all");
  const [overviewFrom, setOverviewFrom] = useState("");
  const [overviewTo, setOverviewTo] = useState("");
  // Maps vendor.id → vendor row. Used to resolve B2B orders' "client name"
  // (B2B orders have no delivery_name; the vendor's store_brand_name is the
  // operations-facing analogue, same convention as PM dashboard + PDFs).
  const [vendorMap, setVendorMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useTabParam("orders");
  const [showSidebar, setShowSidebar] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(null);
  const [statusUpdating, setStatusUpdating] = useState(null);
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  // Stations the logged-in warehouse user is allowed to scan at. Empty array
  // means no restriction (passed-through ScanStation will show all stations).
  const [assignedStations, setAssignedStations] = useState([]);
  const [userDesignation, setUserDesignation] = useState("");

  // Warehouse-based Production Heads who get the Vendor / External tools here:
  // Offline (Khushnuma — Store/Exhibition) and Online (Gulafsha — Website/LXRTS).
  // Other heads (B2B/Comms/Pvt) work from their own dashboards.
  const _designNorm = (userDesignation || "").trim().toLowerCase();
  const isWarehouseProdHead = _designNorm === "offline production head" || _designNorm === "online production head";
  // The Offline PH runs the Retail dashboard — B2B orders belong to the B2B
  // Production Head, so they're hidden from this list (only for this designation;
  // every other warehouse user's view is unchanged).
  const isOfflineProdHead = _designNorm === "offline production head";

  // The Offline Production Head handles retail (Store/Exhibition) orders, so
  // their header reads "Retail Order Dashboard" instead of the generic title.
  const dashboardTitle = isOfflineProdHead ? "Retail Order Dashboard" : "Warehouse Dashboard";

  // Search & Sort
  const [searchQuery, setSearchQuery] = useState("");
  const [searchField, setSearchField] = useState("order_no");
  const [sortBy, setSortBy] = useState("newest");

  const WAREHOUSE_SEARCH_FIELDS = [
    { value: "order_no", label: "Order Number" },
    { value: "product_name", label: "Product Name" },
  ];

  // Status Tab (Primary Filter)
  const [statusTab, setStatusTab] = useState("all");

  // Secondary Filters
  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    minPrice: 0,
    maxPrice: 500000,
    priority: [],
    orderType: [],
    store: [],
    salesperson: "",
    stage: [],   // stage group keys
    stageKind: "both", // 'both' | 'internal' | 'external' (from a card sub-count click)
  });

  // Filter dropdown states
  const [openDropdown, setOpenDropdown] = useState(null);
  const dropdownRef = useRef(null);

  // Tracks the previous activeTab so we can detect "Scan -> back to Orders/
  // Calendar" transitions and re-fetch fresh data (otherwise the per-order
  // component cache would still show pre-scan stages).
  const prevTabRef = useRef("orders");

  // Calendar state
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const ordersPerPage = 5;

  // Image viewer modal
  const [viewingImages, setViewingImages] = useState(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const [attachmentLoading, setAttachmentLoading] = useState(null);

  // Component tracking per order
  const [orderComponentsMap, setOrderComponentsMap] = useState({});
  const [componentLoadingMap, setComponentLoadingMap] = useState({});
  // QC report modal: the order whose QC report is open + its qc_records.
  const [qcReportOrder, setQcReportOrder] = useState(null); // { id, order_no }
  const [qcReportRecords, setQcReportRecords] = useState([]);
  const [qcReportLoading, setQcReportLoading] = useState(false);
  // QC History tab (channel-scoped to this PH's orders).
  const [qcHistory, setQcHistory] = useState([]);
  const [qcHistoryLoading, setQcHistoryLoading] = useState(false);
  // Re-journeys tab (channel-scoped).
  const [reJourneys, setReJourneys] = useState([]);
  const [reJourneysLoading, setReJourneysLoading] = useState(false);
  // Order whose full component journey is being viewed (shared modal).
  const [journeyOrder, setJourneyOrder] = useState(null); // { order_no, components }

  // QC Fail Popup state
  // const [qcFailPopup, setQcFailPopup] = useState({
  //   isOpen: false,
  //   orderId: null,
  //   orderNo: "",
  //   reason: "",
  //   outcome: "", // dispose | scrap | rejourney
  //   rejourneyStage: "",
  // });
  // const [stageUpdating, setStageUpdating] = useState(null);

  // Orders visible on THIS dashboard. The Offline Production Head runs the
  // Retail dashboard, so B2B orders (owned by the B2B Production Head) are
  // hidden from every list/count/calendar here. Every other warehouse user
  // (generic warehouse, Online PH) sees the full set, unchanged. Data-load and
  // the channel-scoped overview are handled separately and are not affected.
  // NOTE: detect B2B by BOTH the is_b2b flag AND salesperson_store='B2B' — some
  // B2B orders carry the store but not the flag, so !is_b2b alone let them slip
  // through (this is why they were still showing).
  const isB2bOrder = (o) => o?.is_b2b === true || (o?.salesperson_store || "").trim().toUpperCase() === "B2B";
  const visibleOrders = useMemo(
    () => (isOfflineProdHead ? orders.filter(o => !isB2bOrder(o)) : orders),
    [orders, isOfflineProdHead]
  );

  // Get unique salespersons from orders
  const salespersons = useMemo(() => {
    const spSet = new Set();
    visibleOrders.forEach(o => {
      if (o.salesperson) spSet.add(o.salesperson);
    });
    return Array.from(spSet).sort();
  }, [visibleOrders]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  // The T-2 rule lives in src/utils/warehouseDate.js — one definition shared by
  // this dashboard, the warehouse PDF and the Production Manager, so every
  // warehouse-facing surface shows the same deadline for an order.
  const getWarehouseDate = (dateStr, orderDateStr) => sharedWarehouseDate(dateStr, orderDateStr, "-");
  // Calendar keys off a real formatted date or null — never a placeholder.
  const getWarehouseDateForCalendar = (dateStr, orderDateStr) => {
    const d = getWarehouseDateObj(dateStr, orderDateStr);
    return d ? formatDate(d) : null;
  };

  const renderMeasurements = (m) => {
    if (!m || typeof m !== "object") {
      return <span className="wd-no-measurements">No measurements</span>;
    }
    return Object.entries(m).map(([key, value]) => {
      if (typeof value === "object" && value !== null) {
        const nonEmptyFields = Object.entries(value).filter(
          ([_, v]) => v !== '' && v !== null && v !== undefined
        );
        if (nonEmptyFields.length === 0) return null;
        const displayLabel = getMeasurementLabel(key);
        return (
          <div key={key} className="wd-measurement-card">
            <div className="wd-measurement-card-title">{displayLabel}</div>
            <div className="wd-measurement-card-values">
              {nonEmptyFields.map(([subKey, subValue]) => (
                <span key={subKey} className="wd-measurement-item">
                  <span className="wd-measurement-key">{subKey}:</span>
                  <span className="wd-measurement-value">{subValue}</span>
                </span>
              ))}
            </div>
          </div>
        );
      }
      if (value === '' || value === null || value === undefined) return null;
      return (
        <div key={key} className="wd-measurement-card wd-flat">
          <span className="wd-measurement-item">
            <span className="wd-measurement-key">{key}:</span>
            <span className="wd-measurement-value">{value}</span>
          </span>
        </div>
      );
    });
  };

  const fetchOrders = async () => {
    // Paginate past Supabase's default 1000-row cap so warehouse can see all orders
    const { data, error } = await fetchAllRows("orders", (q) =>
      q.select("*").order("created_at", { ascending: false })
    );
    if (!error) {
      const filtered = (data || []).filter(o => {
        // Private orders are not visible in warehouse — handled outside warehouse flow
        if (o.is_private_order) return false;
        // Comms orders DO run the warehouse pipeline now (they get barcodes and
        // scan through all stages since 2026-07-10), so they are visible here.
        // B2B orders only visible after merchandiser approval
        if (o.is_b2b) return o.approval_status === "approved";
        return true;
      });
      setOrders(filtered);

      // Resolve B2B "client name" — fetch vendors referenced by B2B orders.
      const vendorIds = [...new Set(
        filtered
          .filter(o => o.is_b2b && o.vendor_id)
          .map(o => o.vendor_id)
      )];
      if (vendorIds.length > 0) {
        const { data: vData } = await supabase
          .from("vendors")
          .select("id, store_brand_name, vendor_code")
          .in("id", vendorIds);
        if (vData) {
          const vMap = {};
          vData.forEach(v => { vMap[v.id] = v; });
          setVendorMap(vMap);
        }
      }
    }
    setLoading(false);
  };

  // Returns the client-facing name for an order. B2B orders use the vendor's
  // store_brand_name (resolved via vendorMap); retail uses delivery_name.
  const getClientName = (order) => {
    if (order?.is_b2b) {
      const v = order.vendor_id ? vendorMap[order.vendor_id] : null;
      return v?.store_brand_name || order.delivery_name || "";
    }
    return order?.delivery_name || "";
  };

  // Jump to the Orders tab, scope filters to make the order visible, and
  // visually highlight its card. Used by the NotificationBell click and by
  // calendar order items.
  const goToOrder = (orderId, orderNo) => {
    setActiveTab("orders");
    setStatusTab("all");
    setSearchQuery(orderNo || "");
    setTimeout(() => {
      const el = document.querySelector(`[data-order-id="${orderId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.outline = "2px solid #d5b85a";
        setTimeout(() => { el.style.outline = ""; }, 3000);
      }
    }, 300);
  };

  // Fetch components for a specific order
  const fetchComponentsForOrder = async (orderId) => {
    if (orderComponentsMap[orderId] || componentLoadingMap[orderId]) return;

    setComponentLoadingMap(prev => ({ ...prev, [orderId]: true }));
    try {
      const { data, error } = await supabase
        .from("order_components")
        .select("id, barcode, component_type, component_label, current_stage, is_active, qc_status, is_delayed, re_journey_count, is_outside_wh, vendor_name, vendor_location, vendor_exit_at")
        .eq("order_id", orderId)
        .order("component_type", { ascending: true });

      if (!error && data) {
        // Attach stages_outside for any piece out at a vendor so the badge can
        // read "Out to Vendor (Embroidery)" (shared helper — one impl app-wide).
        const enriched = await enrichComponentsWithMovements(data);
        setOrderComponentsMap(prev => ({ ...prev, [orderId]: enriched }));
      }
    } catch (err) {
      console.error("Failed to fetch components:", err);
    }
    setComponentLoadingMap(prev => ({ ...prev, [orderId]: false }));
  };

  // Orders scoped to THIS Production Head's channel (Offline → retail/store,
  // Online → website). Used ONLY for the overview analytics; the order list
  // stays global so heads can still look up any order.
  const scopedOrders = useMemo(() => {
    const scoped = scopeOrdersToDesignation(orders, userDesignation);
    // Comms orders are produced in THIS warehouse, so the Offline head's
    // overview includes them alongside the store/exhibition channel.
    if (getChannelKeyForDesignation(userDesignation) === "offline") {
      const have = new Set(scoped.map((o) => o.id));
      orders.forEach((o) => {
        if (!have.has(o.id) && getOrderChannelKey(o) === "comms") scoped.push(o);
      });
    }
    return scoped;
  }, [orders, userDesignation]);

  // Load QC records for this PH's channel when the QC History tab opens.
  useEffect(() => {
    if (!isWarehouseProdHead || activeTab !== "qc_history") return;
    let cancelled = false;
    (async () => {
      setQcHistoryLoading(true);
      const recs = await fetchQcRecords({ orderIds: scopedOrders.map((o) => o.id) });
      if (!cancelled) { setQcHistory(recs); setQcHistoryLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [isWarehouseProdHead, activeTab, scopedOrders]);

  // Load live re-journeys for this PH's channel when the Re-journeys tab opens.
  useEffect(() => {
    if (!isWarehouseProdHead || activeTab !== "rejourneys") return;
    let cancelled = false;
    (async () => {
      setReJourneysLoading(true);
      const rows = await fetchReJourneys({ orderIds: scopedOrders.map((o) => o.id) });
      if (!cancelled) { setReJourneys(rows); setReJourneysLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [isWarehouseProdHead, activeTab, scopedOrders]);

  // Channel-scoped orders further narrowed by the Overview date period (by order
  // created_at). Drives the orders-count label + Production Overview summary —
  // NOT the stage cards, which filter by the piece's own scan time instead (see
  // overviewComponentsInPeriod below).
  const periodScopedOrders = useMemo(() => {
    if (overviewPeriod === "all") return scopedOrders;
    const now = new Date();
    let from = null, to = null;
    if (overviewPeriod === "day") from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    else if (overviewPeriod === "month") from = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (overviewPeriod === "year") from = new Date(now.getFullYear(), 0, 1);
    else if (overviewPeriod === "custom") {
      from = overviewFrom ? new Date(overviewFrom) : null;
      to = overviewTo ? new Date(new Date(overviewTo).setHours(23, 59, 59, 999)) : null;
    }
    return scopedOrders.filter((o) => {
      if (!o.created_at) return false;
      const dt = new Date(o.created_at);
      if (from && dt < from) return false;
      if (to && dt > to) return false;
      return true;
    });
  }, [scopedOrders, overviewPeriod, overviewFrom, overviewTo]);

  // order_id -> status for ALL channel-scoped orders (not date-narrowed), so a
  // bypass-completed order's pieces show under Packaging & Dispatch even when
  // its own created_at falls outside the selected period.
  const overviewOrderStatusById = useMemo(() => {
    const m = {};
    scopedOrders.forEach((o) => { m[o.id] = o.status; });
    return m;
  }, [scopedOrders]);

  // Components whose stage activity (stage_updated_at) falls in the selected
  // Overview period — powers the stage cards. Filtered by the PIECE's own scan
  // time, not its order's created_at, so a scan today on an old order shows up
  // under "Today".
  const overviewComponentsInPeriod = useMemo(() => {
    if (overviewPeriod === "all") return overviewComponents;
    const now = new Date();
    let from = null, to = null;
    if (overviewPeriod === "day") from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    else if (overviewPeriod === "month") from = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (overviewPeriod === "year") from = new Date(now.getFullYear(), 0, 1);
    else if (overviewPeriod === "custom") {
      from = overviewFrom ? new Date(overviewFrom) : null;
      to = overviewTo ? new Date(new Date(overviewTo).setHours(23, 59, 59, 999)) : null;
    }
    return overviewComponents.filter((c) => {
      const ts = c.stage_updated_at || c.created_at;
      if (!ts) return false;
      const dt = new Date(ts);
      if (from && dt < from) return false;
      if (to && dt > to) return false;
      return true;
    });
  }, [overviewComponents, overviewPeriod, overviewFrom, overviewTo]);

  // order_id -> { stageKey: Set('internal'|'external') }, from the period-
  // filtered overview components, so clicking a card / sub-count drills the
  // order list to exactly the pieces the card counted.
  const overviewOrderStageGroups = useMemo(() => {
    const map = {};
    overviewComponentsInPeriod.forEach((c) => {
      const info = classifyComponentForStageCard(c, overviewOrderStatusById[c.order_id]);
      if (!info || !info.key) return;
      const byStage = map[c.order_id] || (map[c.order_id] = {});
      (byStage[info.key] || (byStage[info.key] = new Set())).add(info.kind);
    });
    return map;
  }, [overviewComponentsInPeriod, overviewOrderStatusById]);

  // Clicking a stage card / sub-count on the Overview: filter the order list to
  // that stage (kind narrows to in-house / vendor) and jump to Order History.
  const handleStageCardClick = (stageKey, kind = "both") => {
    setFilters((prev) => ({ ...prev, stage: [stageKey], stageKind: kind }));
    setStatusTab("all");
    setActiveTab("orders");
  };

  // Load the components of the PH's channel orders (ALL dates — the stage
  // cards apply their own period filter by scan time, see
  // overviewComponentsInPeriod) when the Overview tab opens, enriched with
  // vendor movement so the stage cards can split internal/external.
  useEffect(() => {
    if (!isWarehouseProdHead || activeTab !== "overview") return;
    if (scopedOrders.length === 0) { setOverviewComponents([]); return; }
    let cancelled = false;
    (async () => {
      setOverviewLoading(true);
      try {
        const ids = scopedOrders.map((o) => o.id);
        let all = [];
        for (let i = 0; i < ids.length; i += 200) {
          const chunk = ids.slice(i, i + 200);
          const { data, error } = await supabase
            .from("order_components")
            .select("id, order_id, barcode, component_type, current_stage, is_active, is_outside_wh, stage_updated_at")
            .in("order_id", chunk);
          if (error) { console.error("overview components fetch failed:", error); break; }
          all = all.concat(data || []);
        }
        const enriched = await enrichComponentsWithMovements(all);
        if (!cancelled) setOverviewComponents(enriched);
      } catch (e) {
        console.error("overview components load error:", e);
      }
      if (!cancelled) setOverviewLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isWarehouseProdHead, activeTab, scopedOrders]);

  // Open the QC report for an order — loads every QC check (QC 1 + Final QC)
  // recorded for its components, newest stage first per component.
  const openQcReport = async (order) => {
    setQcReportOrder({ id: order.id, order_no: order.order_no });
    setQcReportLoading(true);
    setQcReportRecords([]);
    try {
      const { data, error } = await supabase
        .from("qc_records")
        .select("id, barcode, component_id, result, which_qc, fail_reason, outcome, rejourney_number, scrap_loss_amount, scrap_location, inspected_by, created_at")
        .eq("order_id", order.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      setQcReportRecords(data || []);
    } catch (err) {
      console.error("Failed to load QC report:", err);
      setQcReportRecords([]);
    }
    setQcReportLoading(false);
  };

  // Open the full-journey modal (shared ComponentJourneyModal fetches the
  // transition + movement data itself).
  const openJourney = (order) => {
    setJourneyOrder({ order_no: order.order_no, components: orderComponentsMap[order.id] || [] });
  };

  useEffect(() => {
    const checkAuthAndFetch = async () => {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        navigate("/login", { replace: true });
        return;
      }

      // ✅ Role check - only warehouse users allowed
      const { data: userRecord } = await supabase
        .from("salesperson")
        .select("role, assigned_stations, designation")
        .eq("email", session.user.email?.toLowerCase())
        .single();

      if (!userRecord || userRecord.role !== "warehouse") {
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
        return;
      }

      setCurrentUserEmail(session.user.email?.toLowerCase() || "");
      setAssignedStations(userRecord.assigned_stations || []);
      setUserDesignation(userRecord.designation || "");
      fetchOrders();
    };

    checkAuthAndFetch();
  }, [navigate]);

  // After the worker scans something at the Scan Station tab and switches
  // back to Orders or Calendar, re-pull the orders + clear the per-order
  // component cache so the cards reflect the latest stages without a
  // manual page refresh.
  useEffect(() => {
    const prev = prevTabRef.current;
    prevTabRef.current = activeTab;
    if (prev === "scan" && activeTab !== "scan") {
      fetchOrders();
      setOrderComponentsMap({});
      setComponentLoadingMap({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const MIN_CALENDAR_DATE = new Date(2025, 11, 1);

  // Get priority of an order
  const getPriority = (order) => {
    if (order.is_urgent || order.order_flag === "Urgent" || order.alteration_status === "upcoming_occasion" || order.priority === "urgent") {
      return "urgent";
    }
    return "normal";
  };

  // Product name(s) for an order. The card UI shows items[0].product_name, but
  // an order can have multiple items, so for the export we list every product
  // name (deduped, comma-separated) to keep the column genuinely useful.
  const getProductNames = (order) => {
    const items = Array.isArray(order.items) ? order.items : order.items ? [order.items] : [];
    const names = items.map((it) => (it?.product_name || "").trim()).filter(Boolean);
    return [...new Set(names)].join(", ");
  };

  // Get order type. Stock and B2B are treated as their own categories so the
  // filter selects all matching orders regardless of their alteration/custom
  // flags. Stock orders skip the customer/B2B flow entirely, so they take
  // precedence over B2B.
  const getOrderType = (order) => {
    if (order.is_stock_order) return "stock";
    if (order.is_b2b) return "b2b";
    if (order.is_alteration) return "alteration";
    const item = order.items?.[0];
    if (item?.order_type === "Custom" || item?.payment_order_type === "Custom") return "custom";
    return "standard";
  };

  // Filter orders based on status tab
  const filteredByStatus = useMemo(() => {
    return visibleOrders.filter(o => {
      if (isLxrtsOrder(o)) return false;

      const status = o.status?.toLowerCase();

      switch (statusTab) {
        case "unfulfilled":
          // All orders that are still being worked on (not completed/delivered/cancelled)
          return status !== "completed" &&
            status !== "delivered" &&
            status !== "cancelled" &&
            (!o.is_alteration || o.alteration_location === "Warehouse");
        case "completed":
          // Finished orders
          return (status === "completed" || status === "delivered") &&
            (!o.is_alteration || o.alteration_location === "Warehouse");
        case "cancelled":
          return status === "cancelled" &&
            (!o.is_alteration || o.alteration_location === "Warehouse");
        case "alteration":
          return o.is_alteration && o.alteration_location === "Warehouse";
        default:
          // "all" - show everything except in-store alterations
          return !o.is_alteration || o.alteration_location === "Warehouse";
      }
    });
  }, [visibleOrders, statusTab]);

  // Apply secondary filters
  const filteredOrders = useMemo(() => {
    let result = filteredByStatus;

    // Search filter — user picks the field via the dropdown
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      result = result.filter((order) => {
        switch (searchField) {
          case "product_name":
            return (order.items || []).some(
              (it) => it?.product_name?.toLowerCase().includes(query)
            );
          case "order_no":
          default:
            return order.order_no?.toLowerCase().includes(query);
        }
      });
    }

    // Date range filter
    if (filters.dateFrom || filters.dateTo) {
      result = result.filter((order) => {
        const warehouseDate = getWarehouseDateForCalendar(order.delivery_date, order.created_at);
        if (!warehouseDate) return false;
        const [day, month, year] = warehouseDate.split("-");
        const orderDate = new Date(year, month - 1, day);
        if (filters.dateFrom && orderDate < new Date(filters.dateFrom)) return false;
        if (filters.dateTo && orderDate > new Date(filters.dateTo)) return false;
        return true;
      });
    }

    // Price range filter
    if (filters.minPrice > 0 || filters.maxPrice < 500000) {
      result = result.filter((order) => {
        const total = order.net_total ?? order.grand_total_after_discount ?? order.grand_total ?? 0;
        return total >= filters.minPrice && total <= filters.maxPrice;
      });
    }

    // Priority filter
    if (filters.priority.length > 0) {
      result = result.filter((order) => filters.priority.includes(getPriority(order)));
    }

    // Order type filter
    if (filters.orderType.length > 0) {
      result = result.filter((order) => filters.orderType.includes(getOrderType(order)));
    }

    // Store filter
    if (filters.store.length > 0) {
      result = result.filter((order) => filters.store.includes(order.salesperson_store));
    }

    // Stage filter. Two sources match the same filters.stage:
    //   • Card drill-through (PH overview): component-level, "any piece at this
    //     stage", optionally narrowed to in-house / vendor (filters.stageKind).
    //     Uses overviewOrderStageGroups (built from the channel-scoped pieces).
    //   • Manual Stage dropdown (any warehouse user): order-level fallback on
    //     warehouse_stage, since the component map only covers the PH channel.
    if (filters.stage.length > 0) {
      result = result.filter((order) => {
        const byStage = overviewOrderStageGroups[order.id];
        if (byStage) {
          return filters.stage.some((k) => {
            const kinds = byStage[k];
            if (!kinds) return false;
            if (filters.stageKind === "internal") return kinds.has("internal");
            if (filters.stageKind === "external") return kinds.has("external");
            return true;
          });
        }
        // Fallback: order-level warehouse_stage group match (kind not available).
        const ws = order.warehouse_stage;
        const key = ws === "order_received" ? "order_received" : getStageGroupKey(ws);
        return filters.stage.includes(key);
      });
    }

    // Salesperson filter
    if (filters.salesperson) {
      result = result.filter((order) => order.salesperson === filters.salesperson);
    }

    // Sorting
    const getOrderNum = (no) => {
      const clean = (no || "").replace(/-[A-Z]\d*$/, "");
      const match = clean.match(/(\d{2})(\d{2})-(\d{6})$/);
      if (!match) return 0;
      return parseInt(match[2] + match[1] + match[3]);
    };

    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case "oldest":
          return getOrderNum(a.order_no) - getOrderNum(b.order_no);
        case "delivery":
          return new Date(a.delivery_date || 0) - new Date(b.delivery_date || 0);
        case "amount_high":
          return (b.net_total ?? b.grand_total_after_discount ?? b.grand_total ?? 0) - (a.net_total ?? a.grand_total_after_discount ?? a.grand_total ?? 0);
        case "amount_low":
          return (a.net_total ?? a.grand_total_after_discount ?? a.grand_total ?? 0) - (b.net_total ?? b.grand_total_after_discount ?? b.grand_total ?? 0);
        default:
          return getOrderNum(b.order_no) - getOrderNum(a.order_no);
      }
    });

    return result;
  }, [filteredByStatus, searchQuery, searchField, filters, sortBy, overviewOrderStageGroups]);

  const handleExportCSV = () => {
    if (filteredOrders.length === 0) return;
    const headers = [
      "Order No", "Order Date", "Customer Name", "Product Name",
      "Delivery Date", "Mode of Delivery", "Item Count",
      "Priority", "Status", "Salesperson", "Store",
    ];
    const rows = filteredOrders.map((order) => [
      order.order_no || "",
      order.created_at ? new Date(order.created_at).toLocaleDateString("en-GB") : "",
      getClientName(order) || "",
      getProductNames(order),
      order.delivery_date ? new Date(order.delivery_date).toLocaleDateString("en-GB") : "",
      order.mode_of_delivery || order.delivery_location || order.delivery_city || "",
      Array.isArray(order.items) ? order.items.length : 0,
      getPriority(order),
      order.status || "",
      order.salesperson || "",
      order.salesperson_store || "",
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`));
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `warehouse_orders_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Tab counts
  const tabCounts = useMemo(() => {
    const validOrders = visibleOrders.filter(o => !isLxrtsOrder(o));
    return {
      all: validOrders.filter(o => !o.is_alteration || o.alteration_location === "Warehouse").length,
      unfulfilled: validOrders.filter(o => {
        const status = o.status?.toLowerCase();
        return status !== "completed" &&
          status !== "delivered" &&
          status !== "cancelled" &&
          (!o.is_alteration || o.alteration_location === "Warehouse");
      }).length,
      completed: validOrders.filter(o => {
        const status = o.status?.toLowerCase();
        return (status === "completed" || status === "delivered") &&
          (!o.is_alteration || o.alteration_location === "Warehouse");
      }).length,
      cancelled: validOrders.filter(o => {
        const status = o.status?.toLowerCase();
        return status === "cancelled" &&
          (!o.is_alteration || o.alteration_location === "Warehouse");
      }).length,
      alteration: validOrders.filter(o => o.is_alteration && o.alteration_location === "Warehouse").length,
    };
  }, [visibleOrders]);

  // Applied filters for chips
  const appliedFilters = useMemo(() => {
    const chips = [];
    if (filters.dateFrom || filters.dateTo) {
      const label = filters.dateFrom && filters.dateTo
        ? `${filters.dateFrom} to ${filters.dateTo}`
        : filters.dateFrom ? `From ${filters.dateFrom}` : `Until ${filters.dateTo}`;
      chips.push({ type: "date", label });
    }
    if (filters.minPrice > 0 || filters.maxPrice < 500000) {
      chips.push({ type: "price", label: `Rs.${(filters.minPrice / 1000).toFixed(0)}K - Rs.${(filters.maxPrice / 1000).toFixed(0)}K` });
    }
    filters.priority.forEach(p => chips.push({ type: "priority", value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }));
    filters.orderType.forEach(t => chips.push({ type: "orderType", value: t, label: t === "b2b" ? "B2B" : (t.charAt(0).toUpperCase() + t.slice(1)) }));
    filters.store.forEach(s => chips.push({ type: "store", value: s, label: s }));
    filters.stage.forEach(k => {
      const base = STAGE_GROUPS.find(g => g.key === k)?.label || k;
      const suffix = filters.stageKind === "internal" ? " · In-house" : filters.stageKind === "external" ? " · Vendor" : "";
      chips.push({ type: "stage", value: k, label: base + suffix });
    });
    if (filters.salesperson) {
      chips.push({ type: "salesperson", label: filters.salesperson });
    }
    return chips;
  }, [filters]);

  // Remove a filter
  const removeFilter = (type, value) => {
    if (type === "date") {
      setFilters(prev => ({ ...prev, dateFrom: "", dateTo: "" }));
    } else if (type === "price") {
      setFilters(prev => ({ ...prev, minPrice: 0, maxPrice: 500000 }));
    } else if (type === "salesperson") {
      setFilters(prev => ({ ...prev, salesperson: "" }));
    } else if (type === "stage") {
      setFilters(prev => ({ ...prev, stage: prev.stage.filter(v => v !== value), stageKind: "both" }));
    } else {
      setFilters(prev => ({ ...prev, [type]: prev[type].filter(v => v !== value) }));
    }
  };

  // Clear all filters
  const clearAllFilters = () => {
    setFilters({
      dateFrom: "",
      dateTo: "",
      minPrice: 0,
      maxPrice: 500000,
      priority: [],
      orderType: [],
      store: [],
      salesperson: "",
      stage: [],
      stageKind: "both",
    });
  };

  // Toggle filter checkbox
  const toggleFilter = (category, value) => {
    setFilters(prev => ({
      ...prev,
      [category]: prev[category].includes(value)
        ? prev[category].filter(v => v !== value)
        : [...prev[category], value],
      // Manual stage-dropdown picks are kind-agnostic.
      ...(category === "stage" ? { stageKind: "both" } : {}),
    }));
  };

  // Download all attachments
  const handleDownloadAttachments = async (e, order) => {
    e.stopPropagation();
    if (!order.attachments || order.attachments.length === 0) return;

    setAttachmentLoading(order.id);
    try {
      for (let i = 0; i < order.attachments.length; i++) {
        const url = order.attachments[i];
        const response = await fetch(url);
        const blob = await response.blob();

        const fileName = url.split("/").pop() || `attachment_${i + 1}`;
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${order.order_no}_${fileName}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        if (i < order.attachments.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    } catch (err) {
      console.error("Download failed:", err);
      showPopup({
        type: "error",
        title: "Download Failed",
        message: "Failed to download attachments",
        confirmText: "OK",
      });
    } finally {
      setAttachmentLoading(null);
    }
  };

  // Orders complete automatically once every component is scanned through to
  // Dispatch (DB trigger fn_sync_order_warehouse_stage), so there's no manual
  // "Mark as Completed" — only the Production-Head bypass below for orders that
  // can't finish the normal flow.

  // Temporary Manual Completion — the old pre-gate behaviour: mark the order
  // completed WITHOUT the finished-stages check, behind a confirm. For the
  // Production Head to force-complete an order that can't go through the normal
  // gated flow. Only rendered for the Production Head (see the button below).
  const markManualComplete = async (order) => {
    const ok = await new Promise((resolve) => {
      showPopup({
        type: "confirm",
        title: "Temporary Manual Completion",
        message: `Mark order ${order.order_no} as completed WITHOUT the production checks? This bypasses the normal flow.`,
        confirmText: "Yes, complete it",
        cancelText: "Cancel",
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!ok) return;

    // Force-complete the whole order: dispatch every active component (badge ->
    // Dispatched, pieces become non-scannable) and mark the order completed —
    // one atomic RPC instead of just flipping orders.status.
    const { data, error } = await supabase.rpc("manual_complete_order", {
      p_order_id: order.id,
      p_by: currentUserEmail,
    });
    if (error || data?.success === false) {
      showPopup({ type: "error", title: "Update Failed", message: error?.message || data?.message || "Could not complete the order.", confirmText: "OK" });
      return;
    }
    fetchOrders();
  };

  // Calendar ordersByDate
  const ordersByDate = useMemo(() => {
    return visibleOrders
      .filter(o => !isLxrtsOrder(o))
      .reduce((acc, order) => {
        if (!order.delivery_date) return acc;
        const warehouseDate = getWarehouseDateForCalendar(order.delivery_date, order.created_at);
        if (warehouseDate) {
          acc[warehouseDate] = (acc[warehouseDate] || 0) + 1;
        }
        return acc;
      }, {});
  }, [visibleOrders]);

  // Set of calendar dates that have at least one stock order. Rendered as a
  // small brown dot on the calendar so WH staff spot stock days at a glance.
  const stockOrderDates = useMemo(() => {
    const s = new Set();
    visibleOrders
      .filter(o => !isLxrtsOrder(o) && o.is_stock_order && o.delivery_date)
      .forEach((order) => {
        const d = getWarehouseDateForCalendar(order.delivery_date, order.created_at);
        if (d) s.add(d);
      });
    return s;
  }, [visibleOrders]);

  // Update warehouse stage from dropdown
  // const updateWarehouseStage = async (orderId, orderNo, newStage) => {
  //   // If QC Failed selected, open popup instead of saving directly
  //   if (newStage === "qc_failed") {
  //     setQcFailPopup({
  //       isOpen: true,
  //       orderId,
  //       orderNo,
  //       reason: "",
  //       outcome: "",
  //       rejourneyStage: "",
  //     });
  //     return;
  //   }

  //   setStageUpdating(orderId);
  //   try {
  //     const updateData = {
  //       warehouse_stage: newStage,
  //       warehouse_stage_updated_at: new Date().toISOString(),
  //     };

  //     // If Packaging & Dispatch, auto-complete the order
  //     if (newStage === "packaging_dispatch") {
  //       updateData.status = "completed";
  //     }

  //     const { error } = await supabase
  //       .from("orders")
  //       .update(updateData)
  //       .eq("id", orderId);

  //     if (!error) {
  //       fetchOrders();
  //       if (newStage === "packaging_dispatch") {
  //         showPopup({
  //           title: "Order Completed",
  //           message: `Order ${orderNo} has been marked as Packaging & Dispatch. Status updated to Completed.`,
  //           type: "success",
  //           confirmText: "OK",
  //         });
  //       }
  //     } else {
  //       showPopup({ title: "Error", message: "Failed to update stage", type: "error", confirmText: "OK" });
  //     }
  //   } catch (err) {
  //     console.error("Stage update error:", err);
  //     showPopup({ title: "Error", message: "Something went wrong", type: "error", confirmText: "OK" });
  //   } finally {
  //     setStageUpdating(null);
  //   }
  // };

  // Handle QC Fail popup submission
  // const handleQcFailSubmit = async () => {
  //   const { orderId, reason, outcome, rejourneyStage } = qcFailPopup;

  //   if (!reason.trim()) {
  //     showPopup({ title: "Required", message: "Please enter a reason for QC failure", type: "warning", confirmText: "OK" });
  //     return;
  //   }
  //   if (!outcome) {
  //     showPopup({ title: "Required", message: "Please select an outcome (Dispose, Scrap, or Re-journey)", type: "warning", confirmText: "OK" });
  //     return;
  //   }
  //   if (outcome === "rejourney" && !rejourneyStage) {
  //     showPopup({ title: "Required", message: "Please select which stage to restart from", type: "warning", confirmText: "OK" });
  //     return;
  //   }

  //   setStageUpdating(orderId);
  //   try {
  //     // Get current order to check rejourney count
  //     const { data: currentOrder } = await supabase
  //       .from("orders")
  //       .select("rejourney_count")
  //       .eq("id", orderId)
  //       .single();

  //     const currentCount = currentOrder?.rejourney_count || 0;

  //     let updateData = {
  //       qc_fail_reason: reason,
  //       qc_fail_outcome: outcome,
  //       warehouse_stage_updated_at: new Date().toISOString(),
  //     };

  //     if (outcome === "dispose") {
  //       updateData.warehouse_stage = "disposed";
  //     } else if (outcome === "scrap") {
  //       updateData.warehouse_stage = "scrapped";
  //     } else if (outcome === "rejourney") {
  //       const newCount = currentCount + 1;
  //       updateData.warehouse_stage = rejourneyStage;
  //       updateData.rejourney_count = newCount;
  //       updateData.is_rework = true;

  //       // Alert on 3rd re-journey
  //       if (newCount >= 3) {
  //         // We'll show alert after update
  //       }
  //     }

  //     const { error } = await supabase
  //       .from("orders")
  //       .update(updateData)
  //       .eq("id", orderId);

  //     if (!error) {
  //       fetchOrders();
  //       setQcFailPopup({ isOpen: false, orderId: null, orderNo: "", reason: "", outcome: "", rejourneyStage: "" });

  //       if (outcome === "rejourney" && currentCount + 1 >= 3) {
  //         showPopup({
  //           title: "⚠ Re-journey Alert",
  //           message: `This order has been sent for re-journey ${currentCount + 1} times. Please alert Manish Batra.`,
  //           type: "warning",
  //           confirmText: "OK",
  //         });
  //       } else if (outcome === "dispose") {
  //         showPopup({ title: "Disposed", message: "Component marked as disposed.", type: "info", confirmText: "OK" });
  //       } else if (outcome === "scrap") {
  //         showPopup({ title: "Scrapped", message: "Component moved to scrap.", type: "info", confirmText: "OK" });
  //       } else {
  //         const stageLabel = REJOURNEY_STAGES.find(s => s.value === rejourneyStage)?.label || rejourneyStage;
  //         showPopup({ title: "Re-journey Started", message: `Order sent back to ${stageLabel} stage.`, type: "success", confirmText: "OK" });
  //       }
  //     } else {
  //       showPopup({ title: "Error", message: "Failed to update QC status", type: "error", confirmText: "OK" });
  //     }
  //   } catch (err) {
  //     console.error("QC fail update error:", err);
  //     showPopup({ title: "Error", message: "Something went wrong", type: "error", confirmText: "OK" });
  //   } finally {
  //     setStageUpdating(null);
  //   }
  // };

  // // Get stage label and color for display
  // const getStageInfo = (stageValue) => {
  //   const stage = WAREHOUSE_STAGES.find(s => s.value === stageValue);
  //   return stage || { label: stageValue || "Order Received", color: "#9e9e9e" };
  // };

  const updateAlterationStatus = async (orderId, newStatus) => {
    setStatusUpdating(orderId);
    try {
      const updateData = { status: newStatus };
      if (newStatus === "delivered") {
        updateData.delivered_at = new Date().toISOString();
      }
      const { error } = await supabase
        .from("orders")
        .update(updateData)
        .eq("id", orderId);
      if (!error) {
        fetchOrders();
      } else {
        console.error("Status update failed:", error);
        showPopup({ title: "Status update", message: "Failed to update status", type: "error", confirmText: "Ok" });
      }
    } catch (err) {
      console.error("Error updating status:", err);
    } finally {
      setStatusUpdating(null);
    }
  };

  const handleGeneratePdf = async (order) => {
    setPdfLoading(order.id);
    try {
      await downloadWarehousePdf(order, null, true);
      fetchOrders();
    } catch (error) {
      console.error("PDF generation failed:", error);
    } finally {
      setPdfLoading(null);
    }
  };

  const viewParentOrder = (parentOrderId) => {
    const parentOrder = orders.find(o => o.id === parentOrderId);
    if (parentOrder) {
      setSearchQuery(parentOrder.order_no);
      setStatusTab("all");
    }
  };

  // Pagination
  const totalPages = Math.ceil(filteredOrders.length / ordersPerPage);
  const startIndex = (currentPage - 1) * ordersPerPage;
  const currentOrders = filteredOrders.slice(startIndex, startIndex + ordersPerPage);

  // Auto-fetch components for visible orders
  useEffect(() => {
    if (currentOrders && currentOrders.length > 0) {
      currentOrders.forEach(order => {
        if (!orderComponentsMap[order.id] && !componentLoadingMap[order.id]) {
          fetchComponentsForOrder(order.id);
        }
      });
    }
  }, [currentOrders]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusTab, filters, sortBy]);

  const getAlterationTypeLabel = (type) => {
    const types = {
      fitting_tightening: "Fitting Issue (Tightening)",
      fitting_loosening: "Fitting Issue (Loosening)",
      length_issue: "Length Issue",
      fabric_issue: "Fabric Issue",
      other: "Other",
    };
    return types[type] || type || "-";
  };

  const getStatusColor = (status) => {
    const option = ALTERATION_STATUS_OPTIONS.find(o => o.value === status);
    return option?.color || "#666";
  };

  return (
    <div className="wd-dashboard-wrapper">
      {PopupComponent}

      {/* ===== QC REPORT MODAL ===== */}
      {qcReportOrder && (
        <div className="wd-qc-overlay" onClick={() => setQcReportOrder(null)}>
          <div className="wd-qc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="wd-qc-modal-head">
              <h3 className="wd-qc-modal-title">QC Report — {qcReportOrder.order_no}</h3>
              <button className="wd-qc-modal-close" onClick={() => setQcReportOrder(null)}>×</button>
            </div>

            <div style={{ padding: "12px 16px" }}>
              <QcHistoryTable records={qcReportRecords} loading={qcReportLoading} emptyText="No QC checks recorded for this order yet." />
            </div>
          </div>
        </div>
      )}

      {/* ===== COMPONENT JOURNEY MODAL (shared) ===== */}
      {journeyOrder && (
        <ComponentJourneyModal
          orderNo={journeyOrder.order_no}
          components={journeyOrder.components}
          onClose={() => setJourneyOrder(null)}
        />
      )}

      {/* HEADER */}
      <div className="wd-top-header">
        <div className="wd-hamburger-icon" onClick={() => setShowSidebar(!showSidebar)}>
          <div className="wd-bar"></div>
          <div className="wd-bar"></div>
          <div className="wd-bar"></div>
        </div>
        <div className="wd-header-left">
          <img src={Logo} className="logo" alt="logo" />
        </div>
        <h1 className="wd-title">{dashboardTitle}</h1>
        <div className="wd-header-right">
          <NotificationBell
            userEmail={currentUserEmail}
            onOrderClick={goToOrder}
          />
        </div>
      </div>

      {/* MAIN LAYOUT */}
      <div className="wd-main-layout">

        {/* Sidebar Overlay — click outside to close on mobile/tablet */}
        {showSidebar && <div className="wd-sidebar-overlay" onClick={() => setShowSidebar(false)} />}

        {/* SIDEBAR */}
        <aside className={`wd-sidebar ${showSidebar ? "wd-open" : ""}`}>
          <nav className="wd-menu">
            {isWarehouseProdHead && (
              <a className={`wd-menu-item ${activeTab === "overview" ? "active" : ""}`}
                onClick={() => { setActiveTab("overview"); setShowSidebar(false); }}>
                Overview
              </a>
            )}
            <a className={`wd-menu-item ${activeTab === "orders" ? "active" : ""}`}
              onClick={() => { setActiveTab("orders"); setShowSidebar(false); }}>
              Order History
            </a>
            <a className={`wd-menu-item ${activeTab === "calendar" ? "active" : ""}`}
              onClick={() => { setActiveTab("calendar"); setShowSidebar(false); }}>
              Calendar
            </a>
            <a className={`wd-menu-item ${activeTab === "scan" ? "active" : ""}`}
              onClick={() => { setActiveTab("scan"); setShowSidebar(false); }}>
              Scan Station
            </a>
            {isWarehouseProdHead && (
              <a className={`wd-menu-item ${activeTab === "vendors" ? "active" : ""}`}
                onClick={() => { setActiveTab("vendors"); setShowSidebar(false); }}>
                Vendor / External
              </a>
            )}
            {isWarehouseProdHead && (
              <a className={`wd-menu-item ${activeTab === "qc_history" ? "active" : ""}`}
                onClick={() => { setActiveTab("qc_history"); setShowSidebar(false); }}>
                QC History
              </a>
            )}
            {isWarehouseProdHead && (
              <a className={`wd-menu-item ${activeTab === "rejourneys" ? "active" : ""}`}
                onClick={() => { setActiveTab("rejourneys"); setShowSidebar(false); }}>
                Re-journeys
              </a>
            )}
            <a className="wd-menu-item" onClick={handleLogout}>Log Out</a>
          </nav>
        </aside>

        {/* CONTENT AREA */}
        <div className="wd-content-area">
          {activeTab === "overview" && isWarehouseProdHead && (
            <div className="wd-orders-section">
              <div className="wd-orders-header">
                <h2 className="wd-section-title">Production Stages (Components)</h2>
                <span className="wd-orders-count">{periodScopedOrders.length} orders in your channel</span>
              </div>

              {/* Date-period filter — scopes the stage cards by piece scan time
                  (stage_updated_at) and Production Overview by order placement
                  date (created_at). Same pattern as the PM dashboard. */}
              <div className="wd-overview-period">
                {[
                  { key: "all", label: "All Time" },
                  { key: "day", label: "Today" },
                  { key: "month", label: "This Month" },
                  { key: "year", label: "This Year" },
                  { key: "custom", label: "Custom" },
                ].map((p) => (
                  <button
                    key={p.key}
                    className={`wd-period-pill ${overviewPeriod === p.key ? "active" : ""}`}
                    onClick={() => setOverviewPeriod(p.key)}
                  >{p.label}</button>
                ))}
                {overviewPeriod === "custom" && (
                  <span className="wd-period-custom">
                    <input type="date" value={overviewFrom} onChange={(e) => setOverviewFrom(e.target.value)} />
                    <span>→</span>
                    <input type="date" value={overviewTo} min={overviewFrom || undefined} onChange={(e) => setOverviewTo(e.target.value)} />
                  </span>
                )}
              </div>

              {overviewLoading ? (
                <p className="wd-muted" style={{ padding: "12px 2px" }}>Loading production stages…</p>
              ) : (
                <StageCountCards components={overviewComponentsInPeriod} orderStatusById={overviewOrderStatusById} onStageClick={handleStageCardClick} />
              )}

              {/* Production Overview — operational metrics for the PH's own
                  channel orders (retail for Offline, website for Online). */}
              <ProductionOverview orders={periodScopedOrders} totalLabel="Total Orders (Your Channel)" />
            </div>
          )}

          {activeTab === "orders" && (
            <div className="wd-orders-section">
              {/* Header */}
              <div className="wd-orders-header">
                <h2 className="wd-section-title">Order History</h2>
                <span className="wd-orders-count">{filteredOrders.length} Orders</span>
              </div>

              {/* Search & Sort Bar */}
              <div className="wd-search-sort-bar">
                <SearchByDropdown
                  fields={WAREHOUSE_SEARCH_FIELDS}
                  selectedField={searchField}
                  onFieldChange={setSearchField}
                  query={searchQuery}
                  onQueryChange={setSearchQuery}
                  placeholder="Type to search..."
                />
                <div className="wd-sort-export">
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="wd-sort-select">
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                    <option value="delivery">Delivery Date</option>
                    <option value="amount_high">Amount: High to Low</option>
                    <option value="amount_low">Amount: Low to High</option>
                  </select>
                  {userDesignation?.trim().toLowerCase() === "offline production head" && (
                    <button
                      className="wd-export-btn"
                      onClick={handleExportCSV}
                      title="Export current view to CSV"
                      disabled={filteredOrders.length === 0}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Export CSV
                    </button>
                  )}
                </div>
              </div>

              {/* Status Tabs */}
              <div className="wd-status-tabs">
                {STATUS_TABS.map((tab) => (
                  <button
                    key={tab.value}
                    className={`wd-status-tab ${statusTab === tab.value ? "active" : ""}`}
                    onClick={() => setStatusTab(tab.value)}
                  >
                    {tab.label}
                    <span className="wd-tab-count">{tabCounts[tab.value]}</span>
                  </button>
                ))}
              </div>

              {/* Horizontal Filter Dropdowns */}
              <div className="wd-filter-dropdowns" ref={dropdownRef}>
                {/* Date Filter */}
                <div className="wd-filter-dropdown">
                  <button
                    className={`wd-filter-btn ${(filters.dateFrom || filters.dateTo) ? "active" : ""}`}
                    onClick={() => setOpenDropdown(openDropdown === "date" ? null : "date")}
                  >
                    Date Range
                    <span className="wd-dropdown-arrow">&#9662;</span>
                  </button>
                  {openDropdown === "date" && (
                    <div className="wd-dropdown-panel">
                      <div className="wd-dropdown-title">Select Date Range</div>
                      <div className="wd-date-inputs">
                        <input
                          type="date"
                          value={filters.dateFrom}
                          onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
                        />
                        <span>to</span>
                        <input
                          type="date"
                          value={filters.dateTo}
                          onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value }))}
                        />
                      </div>
                      <button className="wd-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                    </div>
                  )}
                </div>

                {/* Price Filter */}
                <div className="wd-filter-dropdown">
                  <button
                    className={`wd-filter-btn ${(filters.minPrice > 0 || filters.maxPrice < 500000) ? "active" : ""}`}
                    onClick={() => setOpenDropdown(openDropdown === "price" ? null : "price")}
                  >
                    Price
                    <span className="wd-dropdown-arrow">&#9662;</span>
                  </button>
                  {openDropdown === "price" && (
                    <div className="wd-dropdown-panel wd-price-panel">
                      <div className="wd-dropdown-title">Order Value</div>
                      <div className="wd-price-slider-container">
                        <div className="wd-price-track">
                          <div
                            className="wd-price-track-filled"
                            style={{
                              left: `${(filters.minPrice / 500000) * 100}%`,
                              width: `${((filters.maxPrice - filters.minPrice) / 500000) * 100}%`
                            }}
                          />
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="500000"
                          step="5000"
                          value={filters.minPrice}
                          onChange={(e) => setFilters(prev => ({ ...prev, minPrice: Math.min(Number(e.target.value), prev.maxPrice - 5000) }))}
                          className="wd-price-slider wd-price-slider-min"
                        />
                        <input
                          type="range"
                          min="0"
                          max="500000"
                          step="5000"
                          value={filters.maxPrice}
                          onChange={(e) => setFilters(prev => ({ ...prev, maxPrice: Math.max(Number(e.target.value), prev.minPrice + 5000) }))}
                          className="wd-price-slider wd-price-slider-max"
                        />
                      </div>
                      <div className="wd-price-labels">
                        <span>Rs.0</span>
                        <span>Rs.5,00,000</span>
                      </div>
                      <div className="wd-price-inputs">
                        <div className="wd-price-input-wrap">
                          <span>Rs.</span>
                          <input
                            type="number"
                            value={filters.minPrice}
                            onChange={(e) => setFilters(prev => ({ ...prev, minPrice: Math.min(Number(e.target.value), prev.maxPrice - 5000) }))}
                          />
                        </div>
                        <span>to</span>
                        <div className="wd-price-input-wrap">
                          <span>Rs.</span>
                          <input
                            type="number"
                            value={filters.maxPrice}
                            onChange={(e) => setFilters(prev => ({ ...prev, maxPrice: Math.max(Number(e.target.value), prev.minPrice + 5000) }))}
                          />
                        </div>
                      </div>
                      <button className="wd-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                    </div>
                  )}
                </div>

                {/* Priority Filter */}
                <div className="wd-filter-dropdown">
                  <button
                    className={`wd-filter-btn ${filters.priority.length > 0 ? "active" : ""}`}
                    onClick={() => setOpenDropdown(openDropdown === "priority" ? null : "priority")}
                  >
                    Priority
                    <span className="wd-dropdown-arrow">&#9662;</span>
                  </button>
                  {openDropdown === "priority" && (
                    <div className="wd-dropdown-panel">
                      <div className="wd-dropdown-title">Priority</div>
                      {["normal", "urgent"].map(opt => (
                        <label key={opt} className="wd-checkbox-label">
                          <input
                            type="checkbox"
                            checked={filters.priority.includes(opt)}
                            onChange={() => toggleFilter("priority", opt)}
                          />
                          <span>{opt.charAt(0).toUpperCase() + opt.slice(1)}</span>
                        </label>
                      ))}
                      <button className="wd-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                    </div>
                  )}
                </div>

                {/* Order Type Filter */}
                <div className="wd-filter-dropdown">
                  <button
                    className={`wd-filter-btn ${filters.orderType.length > 0 ? "active" : ""}`}
                    onClick={() => setOpenDropdown(openDropdown === "orderType" ? null : "orderType")}
                  >
                    Order Type
                    <span className="wd-dropdown-arrow">&#9662;</span>
                  </button>
                  {openDropdown === "orderType" && (
                    <div className="wd-dropdown-panel">
                      <div className="wd-dropdown-title">Order Type</div>
                      {["standard", "custom", "alteration", "b2b", "stock"].map(opt => (
                        <label key={opt} className="wd-checkbox-label">
                          <input
                            type="checkbox"
                            checked={filters.orderType.includes(opt)}
                            onChange={() => toggleFilter("orderType", opt)}
                          />
                          <span>{opt === "b2b" ? "B2B" : opt.charAt(0).toUpperCase() + opt.slice(1)}</span>
                        </label>
                      ))}
                      <button className="wd-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                    </div>
                  )}
                </div>

                {/* Store Filter */}
                <div className="wd-filter-dropdown">
                  <button
                    className={`wd-filter-btn ${filters.store.length > 0 ? "active" : ""}`}
                    onClick={() => setOpenDropdown(openDropdown === "store" ? null : "store")}
                  >
                    Store
                    <span className="wd-dropdown-arrow">&#9662;</span>
                  </button>
                  {openDropdown === "store" && (
                    <div className="wd-dropdown-panel">
                      <div className="wd-dropdown-title">Store</div>
                      {["Delhi Store", "Ludhiana Store"].map(opt => (
                        <label key={opt} className="wd-checkbox-label">
                          <input
                            type="checkbox"
                            checked={filters.store.includes(opt)}
                            onChange={() => toggleFilter("store", opt)}
                          />
                          <span>{opt}</span>
                        </label>
                      ))}
                      <button className="wd-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                    </div>
                  )}
                </div>

                {/* Stage Filter — by the order's warehouse_stage (10 V2 stages) */}
                <div className="wd-filter-dropdown">
                  <button
                    className={`wd-filter-btn ${filters.stage.length > 0 ? "active" : ""}`}
                    onClick={() => setOpenDropdown(openDropdown === "stage" ? null : "stage")}
                  >
                    Stage
                    <span className="wd-dropdown-arrow">&#9662;</span>
                  </button>
                  {openDropdown === "stage" && (
                    <div className="wd-dropdown-panel">
                      <div className="wd-dropdown-title">Production Stage</div>
                      {STAGE_GROUPS.map(g => (
                        <label key={g.key} className="wd-checkbox-label">
                          <input
                            type="checkbox"
                            checked={filters.stage.includes(g.key)}
                            onChange={() => toggleFilter("stage", g.key)}
                          />
                          <span>{g.label}</span>
                        </label>
                      ))}
                      <button className="wd-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                    </div>
                  )}
                </div>

                {/* Salesperson Filter */}
                <div className="wd-filter-dropdown">
                  <button
                    className={`wd-filter-btn ${filters.salesperson ? "active" : ""}`}
                    onClick={() => setOpenDropdown(openDropdown === "salesperson" ? null : "salesperson")}
                  >
                    Salesperson
                    <span className="wd-dropdown-arrow">&#9662;</span>
                  </button>
                  {openDropdown === "salesperson" && (
                    <div className="wd-dropdown-panel">
                      <div className="wd-dropdown-title">Salesperson</div>
                      <select
                        value={filters.salesperson}
                        onChange={(e) => setFilters(prev => ({ ...prev, salesperson: e.target.value }))}
                        className="wd-sp-select"
                      >
                        <option value="">All Salespersons</option>
                        {salespersons.map(sp => (
                          <option key={sp} value={sp}>{sp}</option>
                        ))}
                      </select>
                      <button className="wd-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Applied Filter Chips */}
              {appliedFilters.length > 0 && (
                <div className="wd-applied-filters">
                  <span className="wd-applied-label">Applied:</span>
                  {appliedFilters.map((chip, i) => (
                    <span key={i} className="wd-filter-chip">
                      {chip.label}
                      <button onClick={() => removeFilter(chip.type, chip.value)}>x</button>
                    </span>
                  ))}
                  <button className="wd-clear-all" onClick={clearAllFilters}>Clear All</button>
                </div>
              )}

              {/* Orders List - OLD DESIGN */}
              <div className="wd-orders-scroll-container">
                {loading ? (
                  <p className="wd-loading-text">Loading orders...</p>
                ) : filteredOrders.length === 0 ? (
                  <p className="wd-no-orders">No orders found.</p>
                ) : (
                  currentOrders.map((order) => {
                    const firstItem = Array.isArray(order.items) ? order.items[0] || {} : order.items || {};
                    const isAlteration = order.is_alteration;
                    const isUrgent = order.alteration_status === "upcoming_occasion" || order.is_urgent || order.order_flag === "Urgent" || order.priority === "urgent";

                    return (
                      <div
                        key={order.id}
                        data-order-id={order.id}
                        className={`wd-order-dropdown ${isAlteration ? "wd-alteration-order" : ""} ${isUrgent ? "wd-urgent-order" : ""}`}
                      >
                        {/* Order Header with Badges */}
                        <div className="wd-order-header-row">
                          <div className="wd-order-badges">
                            <h3 className="wd-dropdown-title">
                              {isAlteration ? "Alteration Order" : "Product Details"}
                            </h3>

                            {isAlteration && (
                              <span className="wd-badge wd-badge-alteration">
                                ALTERATION
                              </span>
                            )}

                            {isUrgent && (
                              <span className="wd-badge wd-badge-urgent">
                                URGENT
                              </span>
                            )}
                            {/* 
                            {order.is_rework && (
                              <span className="wd-badge wd-badge-rework">
                                REWORK
                              </span>
                            )} */}

                            {isAlteration && order.alteration_number && (
                              <span className="wd-badge wd-badge-number">
                                #{order.alteration_number}
                              </span>
                            )}
                          </div>

                          <div className="wd-order-actions">
                            <span className="wd-product-count-label">
                              {Array.isArray(order.items) ? order.items.length : 1} Product{(Array.isArray(order.items) ? order.items.length : 1) !== 1 ? "s" : ""}
                            </span>
                            <button
                              className="wd-pdf-Btn"
                              onClick={() => handleGeneratePdf(order)}
                              disabled={pdfLoading === order.id}
                            >
                              {pdfLoading === order.id ? "Generating..." : "Generate PDF"}
                            </button>
                            {order.attachments && order.attachments.length > 0 && (
                              <button
                                className="ad-attachments-btn"
                                onClick={(e) => handleDownloadAttachments(e, order)}
                                disabled={attachmentLoading === order.id}
                                title={`Download ${order.attachments.length} attachment(s)`}
                              >
                                {attachmentLoading === order.id ? "..." : `📎 Attachments`}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Parent Order Link (for alterations) */}
                        {isAlteration && order.parent_order_id && (
                          <div className="wd-parent-order-link">
                            <span>Original Order: </span>
                            <button
                              className="wd-link-btn"
                              onClick={() => viewParentOrder(order.parent_order_id)}
                            >
                              View Parent Order
                            </button>
                          </div>
                        )}

                        {/* Alteration Details Section */}
                        {isAlteration && (
                          <div className="wd-alteration-details">
                            <div className="wd-alteration-grid">
                              <div className="wd-alteration-field">
                                <span className="wd-alt-label">Alteration Type:</span>
                                <span className="wd-alt-value">{getAlterationTypeLabel(order.alteration_type)}</span>
                              </div>
                              <div className="wd-alteration-field">
                                <span className="wd-alt-label">Location:</span>
                                <span className="wd-alt-value">{order.alteration_location || "-"}</span>
                              </div>
                              <div className="wd-alteration-field">
                                <span className="wd-alt-label">Status:</span>
                                <select
                                  className="wd-status-select"
                                  value={order.status === "pending" ? "order_received" : (order.status || "order_received")}
                                  onChange={(e) => updateAlterationStatus(order.id, e.target.value)}
                                  disabled={statusUpdating === order.id}
                                  style={{ borderColor: getStatusColor(order.status) }}
                                >
                                  {ALTERATION_STATUS_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            {order.alteration_notes && (
                              <div className="wd-alteration-notes">
                                <span className="wd-alt-label">Notes:</span>
                                <p className="wd-alt-notes-text">{order.alteration_notes}</p>
                              </div>
                            )}

                            {order.alteration_attachments && order.alteration_attachments.length > 0 && (
                              <div className="wd-alteration-attachments">
                                <span className="wd-alt-label">Attachments:</span>
                                <div className="wd-attachment-thumbnails">
                                  {order.alteration_attachments.map((url, idx) => (
                                    <img
                                      key={idx}
                                      src={url}
                                      alt={`Attachment ${idx + 1}`}
                                      className="wd-attachment-thumb"
                                      onClick={() => {
                                        setViewingImages(order.alteration_attachments);
                                        setCurrentImageIndex(idx);
                                      }}
                                    />
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="wd-dropdown-content">
                          {/* IMAGE */}
                          <div className="wd-dropdown-img">
                            {firstItem.image_url ? (
                              <img
                                src={firstItem.image_url}
                                alt={firstItem.product_name || "Product"}
                                onError={(e) => {
                                  e.target.onerror = null;
                                  e.target.src = "/placeholder.png";
                                }}
                              />
                            ) : (
                              <div className="wd-placeholder-img-box">
                                <span>No Image</span>
                              </div>
                            )}
                          </div>

                          <div className="wd-dropdown-info">
                            <p><strong className="wd-label">Order Id:</strong> {order.order_no}</p>
                            {order.is_b2b && order.po_number && (
                              <p><strong className="wd-label">PO Number:</strong> {order.po_number}</p>
                            )}
                            <p><strong className="wd-label">Product Name:</strong> {firstItem.product_name}</p>

                            {/* Client & SA Name — responsive row. For exhibition orders the SA is
                                always stored as "Exhibition"; the actual person is on sb_representative_name. */}
                            <div className="wd-info-row">
                              <p><strong className="wd-label">Client Name:</strong> {getClientName(order) || "-"}</p>
                              <p><strong className="wd-label">SA Name:</strong> {order.sb_representative_name || order.salesperson_name || order.salesperson || "-"}</p>
                            </div>

                            {/* Exhibition Name — only present on exhibition orders */}
                            {order.exb_name && (
                              <p><strong className="wd-label">Exhibition:</strong> {order.exb_name}</p>
                            )}

                            {/* Top & Bottom colors — responsive row */}
                            <div className="wd-info-row">
                              <div className="wd-color-info">
                                <p><strong className="wd-label">Top:</strong> {firstItem.top || "-"}</p>
                                {firstItem.top_color?.hex && (
                                  <>
                                    <span className="wd-color-swatch" style={{ backgroundColor: firstItem.top_color.hex }}></span>
                                    <p>{firstItem.top_color?.name}</p>
                                  </>
                                )}
                              </div>
                              <div className="wd-color-info">
                                <p><strong className="wd-label">Bottom:</strong> {firstItem.bottom || "-"}</p>
                                {firstItem.bottom_color?.hex && (
                                  <>
                                    <span className="wd-color-swatch" style={{ backgroundColor: firstItem.bottom_color.hex }}></span>
                                    <p>{firstItem.bottom_color?.name}</p>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Extras & Size — responsive row */}
                            <div className="wd-info-row">
                              {firstItem.extras && firstItem.extras.length > 0 && (
                                <p><strong className="wd-label">Extras:</strong> {firstItem.extras.map(e => e.name).join(", ")}</p>
                              )}
                              <p><strong className="wd-label">Size:</strong> {firstItem.size || "-"}</p>
                            </div>

                            <div className="wd-measurement-section">
                              <strong className="wd-label wd-measurement-label">Body Measurements:</strong>
                              <div className="wd-measurement-grid">
                                {renderMeasurements(firstItem.measurements)}
                              </div>
                            </div>

                            {/* Order Date & Delivery Date — responsive row */}
                            <div className="wd-info-row">
                              <p><strong className="wd-label">Order Date:</strong> {formatDate(order.created_at)}</p>
                              <p><strong className="wd-label">Delivery Date:</strong> {getWarehouseDate(order.delivery_date, order.created_at)}</p>
                            </div>

                            {/* Per-component barcode stage tracker — shows each
                                component's live production stage (re-enabled with the scan flow). */}
                            {!isAlteration && (
                              <div className="wd-component-tracker">
                                {order.status === "cancelled" ? (
                                  <div className="wd-order-status-badge wd-status-cancelled">Cancelled</div>
                                ) : componentLoadingMap[order.id] ? (
                                  <p className="wd-comp-loading">Loading stages...</p>
                                ) : orderComponentsMap[order.id] && orderComponentsMap[order.id].length > 0 ? (
                                  <>
                                    <div className="wd-comp-list">
                                      {orderComponentsMap[order.id].map(comp => (
                                        <div key={comp.id} className={`wd-comp-row ${comp.is_delayed ? "wd-comp-delayed" : ""}`}>
                                          <div className="wd-comp-left">
                                            <span className="wd-comp-barcode">{comp.barcode}</span>
                                            <span className="wd-comp-label">{comp.component_label || comp.component_type}</span>
                                          </div>
                                          <div className="wd-comp-right">
                                            {/* "At Vendor" removed from the row — vendor + due-back
                                                now live in the View Journey modal. */}
                                            {comp.re_journey_count > 0 && (
                                              <span className="wd-comp-rework-tag">Rework {comp.re_journey_count}</span>
                                            )}
                                            <ComponentStageBadge comp={comp} />
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                    {order.status === "completed" && (
                                      <div className="wd-order-status-badge wd-status-completed">All Dispatched</div>
                                    )}
                                    {order.status === "delivered" && (
                                      <div className="wd-order-status-badge wd-status-delivered">Delivered</div>
                                    )}
                                  </>
                                ) : (
                                  <div className="wd-order-status-badge wd-status-pending">
                                    {order.status === "completed" ? "Completed" :
                                      order.status === "delivered" ? "Delivered" :
                                        (order.status === "pending" || order.status === "order_received") ? "Order Received" :
                                          "Awaiting Production"}
                                  </div>
                                )}
                                {/* View Journey — full stage-by-stage flow of every
                                    component in this order (vendor trips included,
                                    shown inline on the security-gate steps). */}
                                {(orderComponentsMap[order.id] || []).length > 0 && (
                                  <button
                                    className="wd-vendor-btn"
                                    onClick={() => openJourney(order)}
                                  >
                                    View Journey
                                  </button>
                                )}
                                {/* View the QC report (QC 1 + Final QC results) for this order */}
                                <button
                                  className="wd-qc-report-btn"
                                  onClick={() => openQcReport(order)}
                                >
                                  QC Report
                                </button>
                                {/* No manual "Mark as Completed": an order completes
                                    automatically once every component is scanned through
                                    to Dispatch (DB trigger fn_sync_order_warehouse_stage).
                                    Only the manual bypass below remains, for the
                                    Production Head, when the flow can't finish normally. */}
                                {isWarehouseProdHead && !["completed", "delivered", "cancelled"].includes(order.status) && (
                                  <button
                                    className="wd-manual-complete-btn"
                                    onClick={() => markManualComplete(order)}
                                  >
                                    Temporary Manual Completion
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Pagination */}
              {!loading && (
                <Paginator page={currentPage} totalPages={totalPages} onChange={setCurrentPage} />
              )}
            </div>
          )}

          {/* CALENDAR TAB */}
          {activeTab === "calendar" && (
            <div className="wd-calendar-wrapper">
              <h2 className="wd-section-title">Calendar</h2>
              <div className="wd-ios-calendar">
                <div className="wd-ios-cal-header">
                  <button
                    className="wd-ios-nav-btn"
                    disabled={new Date(calendarDate).getFullYear() === 2025 && new Date(calendarDate).getMonth() === 11}
                    onClick={() => setCalendarDate(prev => {
                      const d = new Date(prev);
                      d.setMonth(d.getMonth() - 1);
                      if (d < MIN_CALENDAR_DATE) return prev;
                      return d;
                    })}
                  >
                    &#8249;
                  </button>
                  <span className="wd-ios-month-year">
                    {new Date(calendarDate).toLocaleString("default", { month: "long", year: "numeric" })}
                  </span>
                  <button
                    className="wd-ios-nav-btn"
                    onClick={() => setCalendarDate(prev => {
                      const d = new Date(prev);
                      d.setMonth(d.getMonth() + 1);
                      return d;
                    })}
                  >
                    &#8250;
                  </button>
                </div>

                <div className="wd-ios-days-row">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
                    <div key={day} className="wd-ios-day-label">{day}</div>
                  ))}
                </div>

                <div className="wd-ios-date-grid">
                  {(() => {
                    const year = new Date(calendarDate).getFullYear();
                    const month = new Date(calendarDate).getMonth();
                    const firstDayOfMonth = new Date(year, month, 1).getDay();
                    const daysInMonth = new Date(year, month + 1, 0).getDate();
                    const totalCells = Math.ceil((firstDayOfMonth + daysInMonth) / 7) * 7;

                    return Array.from({ length: totalCells }).map((_, i) => {
                      const date = i - firstDayOfMonth + 1;
                      if (date <= 0 || date > daysInMonth) {
                        return <div key={i} className="wd-ios-date-cell wd-ios-empty" />;
                      }
                      const currentDay = new Date(year, month, date);
                      const fullDate = formatDate(currentDay);
                      const todayDate = formatDate(new Date());
                      const isToday = fullDate === todayDate;
                      const isSelected = selectedCalendarDate === fullDate;
                      const orderCount = ordersByDate[fullDate] || 0;
                      const hasStock = stockOrderDates.has(fullDate);

                      return (
                        <div
                          key={i}
                          className={`wd-ios-date-cell ${isToday ? "wd-ios-today" : ""} ${isSelected ? "wd-ios-selected" : ""} ${orderCount > 0 ? "wd-ios-has-orders" : ""}`}
                          onClick={() => setSelectedCalendarDate(fullDate)}
                        >
                          <span className="wd-ios-date-num">{date}</span>
                          {orderCount > 0 && <span className="wd-ios-order-count">{orderCount}</span>}
                          {hasStock && <span className="wd-ios-stock-dot" title="Stock order on this date" />}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {selectedCalendarDate && (
                <div className="wd-calendar-orders-section">
                  <div className="wd-calendar-header">
                    <span className="wd-calendar-title">
                      Orders for {selectedCalendarDate} ({visibleOrders.filter(o => getWarehouseDateForCalendar(o.delivery_date, o.created_at) === selectedCalendarDate).length})
                    </span>
                  </div>
                  <div className="wd-calendar-orders-list">
                    {visibleOrders.filter(o => getWarehouseDateForCalendar(o.delivery_date, o.created_at) === selectedCalendarDate).length === 0 ? (
                      <p className="wd-no-orders">No orders scheduled for this date</p>
                    ) : (
                      visibleOrders
                        .filter(o => getWarehouseDateForCalendar(o.delivery_date, o.created_at) === selectedCalendarDate)
                        .map((order) => (
                          <div
                            className="wd-calendar-order-item wd-calendar-order-clickable"
                            key={order.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => goToOrder(order.id, order.order_no)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                goToOrder(order.id, order.order_no);
                              }
                            }}
                          >
                            <p><b>Order No:</b> {order.order_no}</p>
                            {order.is_b2b && order.po_number && (
                              <p><b>PO Number:</b> {order.po_number}</p>
                            )}
                            <p><b>Client Name:</b> {getClientName(order) || "-"}</p>
                            <p><b>Status:</b> {order.status === "pending" || order.status === "order_received" || !order.status ? "Order Received" : order.status}</p>
                          </div>
                        ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {activeTab === "scan" && (
            <ScanStation
              currentUserEmail={currentUserEmail}
              allowedStations={assignedStations}
            />
          )}
          {activeTab === "vendors" && isWarehouseProdHead && (
            <ProductionHeadVendors currentUserEmail={currentUserEmail} />
          )}
          {activeTab === "qc_history" && isWarehouseProdHead && (
            <div className="wd-orders-section" style={{ maxWidth: "none" }}>
              <div className="wd-orders-header">
                <h2 className="wd-section-title">QC History</h2>
                <span className="wd-orders-count">{scopedOrders.length} orders in your channel</span>
              </div>
              <QcHistoryPanel records={qcHistory} loading={qcHistoryLoading} />
            </div>
          )}
          {activeTab === "rejourneys" && isWarehouseProdHead && (
            <div className="wd-orders-section" style={{ maxWidth: "none" }}>
              <div className="wd-orders-header">
                <h2 className="wd-section-title">Re-journeys</h2>
                <span className="wd-orders-count">Currently in rework · your channel</span>
              </div>
              <ReJourneyPanel rows={reJourneys} loading={reJourneysLoading} />
            </div>
          )}
        </div>
      </div>

      {/* QC Fail Popup */}
      {/* {qcFailPopup.isOpen && (
        <div className="popup-overlay" onClick={(e) => { if (e.target === e.currentTarget) setQcFailPopup(prev => ({ ...prev, isOpen: false })); }}>
          <div className="popup-box popup-warning" style={{ maxWidth: 480 }}>
            <div className="popup-header">
              <span className="popup-icon popup-icon-error">✕</span>
              <h3 className="popup-title">QC Failed — {qcFailPopup.orderNo}</h3>
            </div>

            <div className="popup-body"> */}
      {/* Reason Field */}
      {/* <div className="wd-qc-field">
                <label className="wd-qc-label">Reason for QC Failure *</label>
                <textarea
                  className="wd-qc-textarea"
                  placeholder="Describe why QC failed..."
                  value={qcFailPopup.reason}
                  onChange={(e) => setQcFailPopup(prev => ({ ...prev, reason: e.target.value }))}
                  rows={3}
                />
              </div> */}

      {/* Outcome Selection */}
      {/* <div className="wd-qc-field">
                <label className="wd-qc-label">Select Outcome *</label>
                <div className="wd-qc-outcome-btns">
                  <button
                    className={`wd-qc-outcome-btn wd-qc-dispose ${qcFailPopup.outcome === "dispose" ? "active" : ""}`}
                    onClick={() => setQcFailPopup(prev => ({ ...prev, outcome: "dispose", rejourneyStage: "" }))}
                  >
                    Dispose
                  </button>
                  <button
                    className={`wd-qc-outcome-btn wd-qc-scrap ${qcFailPopup.outcome === "scrap" ? "active" : ""}`}
                    onClick={() => setQcFailPopup(prev => ({ ...prev, outcome: "scrap", rejourneyStage: "" }))}
                  >
                    Scrap
                  </button>
                  <button
                    className={`wd-qc-outcome-btn wd-qc-rejourney ${qcFailPopup.outcome === "rejourney" ? "active" : ""}`}
                    onClick={() => setQcFailPopup(prev => ({ ...prev, outcome: "rejourney" }))}
                  >
                    Re-journey
                  </button>
                </div>
              </div> */}

      {/* Re-journey Stage Dropdown (only if rejourney selected) */}
      {/* {qcFailPopup.outcome === "rejourney" && (
                <div className="wd-qc-field">
                  <label className="wd-qc-label">Restart from Stage *</label>
                  <select
                    className="wd-qc-rejourney-select"
                    value={qcFailPopup.rejourneyStage}
                    onChange={(e) => setQcFailPopup(prev => ({ ...prev, rejourneyStage: e.target.value }))}
                  >
                    <option value="">— Select Stage —</option>
                    {REJOURNEY_STAGES.map((stage) => (
                      <option key={stage.value} value={stage.value}>
                        {stage.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="popup-actions">
              <button
                className="popup-btn popup-btn-cancel"
                onClick={() => setQcFailPopup({ isOpen: false, orderId: null, orderNo: "", reason: "", outcome: "", rejourneyStage: "" })}
              >
                Cancel
              </button>
              <button
                className="popup-btn popup-btn-confirm"
                onClick={handleQcFailSubmit}
                disabled={stageUpdating === qcFailPopup.orderId}
              >
                {stageUpdating === qcFailPopup.orderId ? "Saving..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )} */}

      {/* Image Viewer Modal */}
      {viewingImages && (
        <div className="wd-image-modal" onClick={() => setViewingImages(null)}>
          <div className="wd-image-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="wd-image-close" onClick={() => setViewingImages(null)}>x</button>
            <img src={viewingImages[currentImageIndex]} alt="Attachment" className="wd-image-full" />
            {viewingImages.length > 1 && (
              <div className="wd-image-nav">
                <button onClick={() => setCurrentImageIndex((prev) => (prev - 1 + viewingImages.length) % viewingImages.length)}>
                  &#8592;
                </button>
                <span>{currentImageIndex + 1} / {viewingImages.length}</span>
                <button onClick={() => setCurrentImageIndex((prev) => (prev + 1) % viewingImages.length)}>
                  &#8594;
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default WarehouseDashboard;