import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import "./ProductionManagerDashboard.css";
import Logo from "../../../images/logo.png";
import formatIndianNumber from "../../../utils/formatIndianNumber";
import formatDate from "../../../utils/formatDate";
import { isRevenueOrder } from "../../../utils/revenue";
import { usePopup } from "../../../components/Popup";
import NotificationBell from "../../../components/NotificationBell";
import SearchByDropdown from "../../../components/SearchByDropdown";
import ProductionOverrides from "../../../components/ProductionOverrides";
import VendorRequest from "../../../components/VendorRequest";
import ReplacementApprovals from "../../../components/ReplacementApprovals";
import StageCountCards from "../../../components/StageCountCards";
import QcHistoryPanel from "../../../components/QcHistoryPanel";
import { fetchQcRecords } from "../../../utils/qcHistory";
import { runManualCompleteWithOverride, describeBlocking } from "../../../utils/manualComplete";
import ReJourneyPanel from "../../../components/ReJourneyPanel";
import { fetchReJourneys } from "../../../utils/reJourneys";
import ExternalVendorsPanel from "../../../components/ExternalVendorsPanel";
import { fetchExternalMovements } from "../../../utils/externalMovements";
// The PM works to the WAREHOUSE deadline (T-2), the same date the warehouse
// dashboard and the warehouse PDF show — not the customer's delivery date.
import { getWarehouseDate, getWarehouseDateObj } from "../../../utils/warehouseDate";
import { fetchScanReport, scanReportCsv } from "../../../utils/scanReport";
import useTabParam from "../../../hooks/useTabParam";
import useFilterParam from "../../../hooks/useFilterParam";
import Paginator from "../../../components/Paginator";
import ComponentStageBadge from "../../../components/ComponentStageBadge";
import ComponentJourneyModal from "../../../components/ComponentJourneyModal";
import PeriodFilter, { usePeriodFilter, periodLabel } from "../../../components/PeriodFilter";
import CompletePicker from "../../../components/CompletePicker";
import "../../../components/ProductionOverrides.css";
import { downloadWarehousePdf } from "../../../utils/pdfLazy";
import { PRODUCTION_STAGES, getStageLabel, getStageColor, STAGE_GROUPS, enrichComponentsWithMovements, classifyComponentForStageCard, getOrderChannelKey, getOrderChannelLabel, CHANNEL_SEGMENTS, getOrderStatusLabel, getOrderProgressStatus, getOrderProgressStatusKey } from "../../../utils/barcodeService";
import { computeChannelBreakdown, computeStatusStats, computeProductionMetrics, computeReJourneyCount, countActiveComponents, computeDispatchReady, isOrderStillRunning } from "../../../utils/productionMetrics";
import downloadCsv from "../../../utils/downloadCsv";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const PM_CHART_COLORS = ["#d5b85a", "#8B7355", "#C9A94E", "#A67C52", "#D4AF37", "#BDB76B"];

// ==================== MEASUREMENT CONSTANTS ====================
const CATEGORY_KEY_MAP = {
    "Kurta/Choga/Kaftan": "KurtaChogaKaftan",
    "Blouse": "Blouse",
    "Anarkali": "Anarkali",
    "Salwar/Dhoti": "SalwarDhoti",
    "Churidaar/Trouser/Pants/Plazo": "ChuridaarTrouserPantsPlazo",
    "Sharara/Gharara": "ShararaGharara",
    "Lehenga": "Lehenga",
};

const measurementCategories = [
    "Kurta/Choga/Kaftan", "Blouse", "Anarkali", "Salwar/Dhoti",
    "Churidaar/Trouser/Pants/Plazo", "Sharara/Gharara", "Lehenga",
];

const measurementFields = {
    KurtaChogaKaftan: ["Height", "Shoulder", "Neck", "Upper Bust", "Bust", "Dart Point", "Sleeves", "Bicep", "Arm Hole", "Waist", "Hip", "Length", "Front Cross", "Back Cross", "Front Neck", "Back Neck"],
    Blouse: ["Shoulder", "Upper Bust", "Bust", "Dart Point", "Sleeves", "Arm Hole", "Waist", "Length", "Front Cross", "Back Cross", "Front Neck", "Back Neck"],
    Anarkali: ["Shoulder", "Upper Bust", "Bust", "Dart Point", "Sleeves", "Bicep", "Arm Hole", "Length", "Front Neck", "Back Neck"],
    SalwarDhoti: ["Waist", "Hip", "Length"],
    ChuridaarTrouserPantsPlazo: ["Waist", "Hip", "Length", "Thigh", "Calf", "Ankle", "Knee", "Yoke Length"],
    ShararaGharara: ["Waist", "Hip", "Length"],
    Lehenga: ["Waist", "Hip", "Length"],
};

const WOMEN_SIZE_OPTIONS = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL", "8XL"];
const KIDS_SIZE_OPTIONS = [
    "1-2 yrs", "2-3 yrs", "3-4 yrs", "4-5 yrs", "5-6 yrs",
    "6-7 yrs", "7-8 yrs", "8-9 yrs", "9-10 yrs", "10-11 yrs",
    "11-12 yrs", "12-13 yrs", "13-14 yrs", "14-15 yrs", "15-16 yrs",
];

// ==================== SVG ICONS ====================
const Icons = {
    package: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d5b85a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16.5 9.4 7.55 4.24" /><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.29 7 12 12 20.71 7" /><line x1="12" y1="22" x2="12" y2="12" /></svg>,
    gear: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d5b85a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>,
    warning: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c62828" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
    clock: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e65100" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
    refresh: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d5b85a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>,
    truck: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d5b85a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>,
    xCircle: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c62828" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>,
    timer: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d5b85a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /><path d="M5 3 2 6" /><path d="m22 6-3-3" /><path d="M6.38 18.7 4 21" /><path d="M17.64 18.67 20 21" /></svg>,
    inbox: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d5b85a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>,
    hourglass: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d5b85a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 22h14" /><path d="M5 2h14" /><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" /><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" /></svg>,
    rupee: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12" /><path d="M6 8h12" /><path d="m6 13 8.5 8" /><path d="M6 13h3" /><path d="M9 13c6.667 0 6.667-10 0-10" /></svg>,
    trendingUp: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg>,
    trendingDown: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c62828" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7" /><polyline points="16 17 22 17 22 11" /></svg>,
    rotate: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d5b85a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>,
    tag: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d5b85a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>,
    wallet: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c62828" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></svg>,
    layers: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d5b85a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>,
};

// ==================== STATUS TABS ====================
const STATUS_TABS = [
    { value: "all", label: "All Orders" },
    { value: "unfulfilled", label: "Unfulfilled" },
    { value: "completed", label: "Completed" },
    { value: "delivered", label: "Delivered" },
    { value: "cancelled", label: "Cancelled" },
];


const StatCard = ({ title, value, subtitle, highlight, icon, onClick }) => (
    <div
        className={`pm-stat-card-inner ${highlight ? "pm-stat-highlight" : ""} ${onClick ? "pm-stat-clickable" : ""}`}
        onClick={onClick}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") onClick(e); } : undefined}
    >
        <div className="pm-stat-top-row">
            {icon && <span className="pm-stat-icon">{icon}</span>}
            <p className="pm-stat-title">{title}</p>
        </div>
        <div className="pm-stat-content">
            <span className="pm-stat-value">{value}</span>
            {subtitle && <span className="pm-stat-change">{subtitle}</span>}
        </div>
    </div>
);

// ==================== CHANNEL BREAKDOWN OPTIONS ====================
// Every channel the client operates — the source of truth for the Overview's
// channel breakdowns (Currently Running Late by Channel, Orders vs Late).
// Delhi, Ludhiana and Exhibition all resolve to the "offline" channel key, so
// they're disambiguated by salesperson_store; the rest match on
// getOrderChannelKey. The set is exhaustive (website included) so a breakdown's
// parts always sum to the total. Channel comes from the order-number prefix
// (see getOrderChannelKey). The two physical stores share the "offline"
// channel, so they still split on the store name.
//
// The All Orders list does NOT filter through this — it uses the single "All
// Channels" <select>, which matches on getOrderChannelLabel. `value` here must
// therefore stay identical to that label (note the SINGULAR "Exhibition"), so
// clicking a by-channel row drills into the matching orders.
//
// There is no LXRTS option: LXRTS is an order TYPE (Shopify-synced product),
// not a channel — those orders sit under whichever channel they were placed in.
// "Shopify" here is different: it is the real channel for orders the CUSTOMER
// placed on the website (prefix SB-SHOPIFY-). See CHANNEL_BY_ORDER_PREFIX.
//
// Keep this list in step with CHANNEL_SEGMENTS in barcodeService.js — it is
// hand-written rather than derived, so a channel added there is silently
// missing here (and a breakdown's parts would stop summing to the total).
const STORE_FILTER_OPTIONS = [
    { value: "Delhi Store", label: "Delhi Store", color: "#2e7d32", match: (o) => getOrderChannelLabel(o) === "Delhi Store" },
    { value: "Ludhiana Store", label: "Ludhiana Store", color: "#00897b", match: (o) => getOrderChannelLabel(o) === "Ludhiana Store" },
    { value: "Shopify", label: "Shopify", color: "#0288d1", match: (o) => getOrderChannelKey(o) === "shopify" },
    { value: "B2B", label: "B2B", color: "#d5b85a", match: (o) => getOrderChannelKey(o) === "b2b" },
    { value: "Private", label: "Private", color: "#8e24aa", match: (o) => getOrderChannelKey(o) === "private" },
    { value: "Comms", label: "Comms", color: "#1565c0", match: (o) => getOrderChannelKey(o) === "comms" },
    { value: "Exhibition", label: "Exhibition", color: "#6d4c41", match: (o) => getOrderChannelKey(o) === "exhibition" },
    { value: "Stock", label: "Stock", color: "#546e7a", match: (o) => getOrderChannelKey(o) === "stock" },
];

// "Currently running late" — the single source of truth for every delayed
// figure on this dashboard (the In-Progress/Delayed card, the Currently
// Running Late by-channel list, the Total-vs-Late chart, and the delayedOnly
// order filter). An order is late only while it is STILL RUNNING: dispatched
// counts as done (out of production), same as delivered/completed/cancelled, so
// the number drops the moment an order is dispatched/finished. Past its
// customer delivery date is the "late" test.
// Heading suffix for the QC History tab, describing the panel's LIVE result
// filter. Keyed by the panel's own filter values ('' = unscoped, no suffix).
const QC_RESULT_SUFFIX = {
    fail: "showing failures",
    pass: "showing passes",
    override: "showing overrides",
};

const DONE_STATUSES = new Set(["delivered", "completed", "dispatched", "cancelled"]);
const isOrderRunningLate = (o, now = new Date()) => {
    const s = (o.status || "").toLowerCase();
    if (DONE_STATUSES.has(s) || o.warehouse_stage === "dispatched") return false;
    return o.delivery_date && new Date(o.delivery_date) < now;
};

// Component stages that mean "production is finished with this piece — it is
// waiting to go out". This is the Dispatch Queue's source set.
//
// Verified against PROD (Aug 2026): `packaging_dispatch` has ZERO rows — the
// floor scans pieces from production straight to `dispatched`, so a queue keyed
// on packaging_dispatch alone is permanently empty while ~600 pieces really are
// awaiting dispatch. packaging_dispatch is kept in the set so nothing breaks if
// that scan step is adopted later.
//
// Ordered most-finished first, so a piece is labelled by the furthest point it
// has reached.
const READY_TO_DISPATCH_ORDER = ["packaging_dispatch", "final_qc_passed", "production_complete"];
const READY_TO_DISPATCH = new Set(READY_TO_DISPATCH_ORDER);

// The distinct products (item_index) still dispatchable in an order's component
// list. An order can hold several products, each with its own pieces; >1 here
// means the PM must pick which product to force-complete.
const distinctItemIndexes = (comps = []) =>
    [...new Set(
        (comps || [])
            .filter(c => !["disposed", "scrapped"].includes(c.current_stage))
            .map(c => c.item_index ?? 0)
    )].sort((a, b) => a - b);

// ==================== CHANNEL BREAKDOWN ROW ====================
const ChannelRow = ({ label, count, percentage, color, onClick }) => (
    <div
        className={`pm-channel-row ${onClick ? "pm-channel-row-click" : ""}`}
        onClick={onClick}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } } : undefined}
        title={onClick ? `View ${label} delayed orders` : undefined}
    >
        <div className="pm-channel-label">
            <span className="pm-channel-dot" style={{ background: color }}></span>
            <span>{label}</span>
        </div>
        <div className="pm-channel-right">
            <span className="pm-channel-count">{count}</span>
            <div className="pm-channel-bar-bg">
                <div className="pm-channel-bar-fill" style={{ width: `${percentage}%`, background: color }}></div>
            </div>
            <span className="pm-channel-pct">{percentage}%</span>
        </div>
    </div>
);

export default function ProductionManagerDashboard() {
    const navigate = useNavigate();
    const location = useLocation();
    const { showPopup, PopupComponent } = usePopup();

    // Tab lives in the URL (?tab=orders) — Back from a detail page returns to
    // the tab the user was on, and browser Back moves between tabs. The hook
    // still honours location.state?.activeTab for the flows that push it.
    const [activeTab, setActiveTab] = useTabParam("overview");
    // Direct search-param access, for handlers that must set the tab AND several
    // filters in ONE navigation (see goToOrder). Calling the individual setters
    // in sequence loses all but the last, because useTabParam pushes while
    // useFilterParam replaces.
    const [, setSearchParams] = useSearchParams();
    // Sub-tab within a merged section (Delivery Report → dispatch/report,
    // Vendors → directory/external). Plain state, NOT a second useTabParam —
    // two hooks both writing searchParams with functional updaters clobber
    // each other when a sidebar click sets both tab and subtab at once.
    const [subTab, setSubTab] = useState("dispatch");
    const [highlightOrderId, setHighlightOrderId] = useState(location.state?.highlightOrderId || null);
    const [qcHistory, setQcHistory] = useState([]);
    const [qcHistoryLoading, setQcHistoryLoading] = useState(false);
    // Fetched-once guard: QC History and Production both read qcHistory, so the
    // paged fetch must not re-run every time the user switches between them.
    const [qcHistoryLoaded, setQcHistoryLoaded] = useState(false);
    // Preselected Pass/Fail scope for the QC History panel, set when the user
    // drills in from the QC Failures KPI card ("fail") vs opening the tab from
    // the menu (""). Kept in the URL so Back/refresh preserve the drill-down,
    // the same reason tab state lives there.
    const [qcResultFilter, setQcResultFilter] = useFilterParam("qcr", "");
    // What the QC History panel is ACTUALLY showing right now — the panel owns
    // the filters and reports its live scope up. Display-only; the panel stays
    // the source of truth for the filtering itself.
    //
    // Must not be derived from qcResultFilter: that URL param only SEEDS the
    // panel (initialResult) and never changes again, so a heading driven by it
    // kept saying "showing failures" after the user switched the dropdown to
    // Pass.
    const [qcScope, setQcScope] = useState({ channelLabel: null, result: "" });
    // Same for the Re-journeys panel — heading reports the live channel scope.
    const [rjScope, setRjScope] = useState({ channelLabel: null });
    const [reJourneys, setReJourneys] = useState([]);
    const [reJourneysLoading, setReJourneysLoading] = useState(false);
    const [extMovements, setExtMovements] = useState([]);
    const [extMovementsLoading, setExtMovementsLoading] = useState(false);
    // Which product to force-complete, for multi-product orders.
    // { order, products:[itemIndex] } — null when closed.
    const [completePicker, setCompletePicker] = useState(null);
    // Scan report export — every scan in [from, to], straight to CSV.
    const todayStr = new Date().toISOString().slice(0, 10);
    const [scanReportFrom, setScanReportFrom] = useState(todayStr);
    const [scanReportTo, setScanReportTo] = useState(todayStr);
    const [scanReportBusy, setScanReportBusy] = useState(false);
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [orders, setOrders] = useState([]);
    // Maps vendor.id → vendor row. Used to resolve a B2B order's "client name"
    // (B2B orders have no delivery_name; the vendor's store_brand_name is the
    // analogue). Populated alongside orders so we don't fetch on every render.
    const [vendorMap, setVendorMap] = useState({});
    // Per-component stage tracking (from order_components table). Each row =
    // one trackable piece (top, bottom, dupatta, extra) of an order. We use
    // these for the live stage-count cards on the Production tab.
    const [components, setComponents] = useState([]);
    // Drill-down: which stage's components list is the user looking at?
    const [stageDrillDown, setStageDrillDown] = useState(null); // string|null
    const [loading, setLoading] = useState(true);
    const [showSidebar, setShowSidebar] = useState(false);
    const [currentUserEmail, setCurrentUserEmail] = useState("");

    // Orders tab state
    const [orderSearch, setOrderSearch] = useFilterParam("q", "");
    const [orderSearchField, setOrderSearchField] = useFilterParam("qf", "order_no");
    const [channelFilter, setChannelFilter] = useFilterParam("channel", "all");
    const [statusTab, setStatusTab] = useFilterParam("status", "all");
    const [sortBy, setSortBy] = useFilterParam("sort", "newest");
    const [filters, setFilters] = useState({ minPrice: 0, maxPrice: 500000, payment: [], priority: [], salesperson: "", stage: [], stageKind: "both", disposedOnly: false, delayedOnly: false, dispatchedOnly: false, dispatchReadyOnly: false, orderIdSet: null, orderIdSetLabel: "" });
    // Order-date scope for the orders list — shared PeriodFilter (select),
    // rendered inline in the filter bar as the "Date Range" dropdown.
    const {
        timeline: ordersTimeline, inPeriod: inOrdersPeriod,
        range: ordersPeriodRange, props: ordersPeriodProps,
    } = usePeriodFilter("all", { variant: "select", label: "Date Range:" });
    const clearOrdersPeriod = () => { ordersPeriodProps.setTimeline("all"); ordersPeriodProps.setCustomFrom(""); ordersPeriodProps.setCustomTo(""); };
    // Overview period filter — shared PeriodFilter (scopes the stage cards + business metrics).
    const { control: overviewPeriodControl, timeline: overviewTimeline, inPeriod: inOverviewPeriod } = usePeriodFilter("all", { variant: "pills" });
    const [openDropdown, setOpenDropdown] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const dropdownRef = useRef(null);
    const ORDERS_PER_PAGE = 20;

    // Edit modal state
    const [editingOrder, setEditingOrder] = useState(null);
    const [editFormData, setEditFormData] = useState({});
    const [actionLoading, setActionLoading] = useState(null);
    // Order whose full component journey is open (shared ComponentJourneyModal).
    const [journeyOrder, setJourneyOrder] = useState(null); // { order_no, components }
    const openJourney = (e, order, comps) => { e?.stopPropagation?.(); setJourneyOrder({ order_no: order.order_no, components: comps || [] }); };
    const [editMeasurements, setEditMeasurements] = useState({});
    const [editActiveCategory, setEditActiveCategory] = useState("Kurta/Choga/Kaftan");
    const [colors, setColors] = useState([]);

    // Priority modal
    const [priorityOrder, setPriorityOrder] = useState(null);
    const [priorityValue, setPriorityValue] = useState("");
    const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
    const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
    const [selectedCalendarDate, setSelectedCalendarDate] = useState(null);
    // Calendar scope. A month can hold 400+ deliveries (Aug 2026: 471, 154 of
    // them on one day), so the list is capped and grown on demand — it used to
    // render every row at once, which was the tab's main lag source.
    const [calChannel, setCalChannel] = useState("all");
    const [calLimit, setCalLimit] = useState(25);
    useEffect(() => { setCalLimit(25); }, [calendarMonth, calendarYear, calChannel, selectedCalendarDate]);
    const [warehousePdfLoading, setWarehousePdfLoading] = useState(null);

    // Delivery Report state — same pills + channel-in-slot arrangement as the
    // Dispatch tab, so both sub-tabs filter identically.
    const { props: drPeriodProps, range: drPeriodRange, timeline: drTimeline } =
        usePeriodFilter("30d", { variant: "pills" });
    const drPeriodLabel = periodLabel(drTimeline);
    const [drChannel, setDrChannel] = useState("all");
    const [drStatus, setDrStatus] = useState("all");
    const [drBucket, setDrBucket] = useState("all");
    const [drSearch, setDrSearch] = useState("");
    // Row caps, grown on demand — the report can hold thousands of rows and the
    // old hard slice(0, 50) silently hid the rest behind a jump-to-All-Orders
    // button, so the table could never show what its own count claimed.
    const [drOpenLimit, setDrOpenLimit] = useState(25);
    const [drDoneLimit, setDrDoneLimit] = useState(25);
    useEffect(() => { setDrOpenLimit(25); setDrDoneLimit(25); }, [drPeriodRange, drChannel, drStatus, drBucket, drSearch]);

    // Production tab: same pills + channel bar as Dispatch / Delivery Report.
    // Default "all" — the Production tab is a live view of what is on the floor
    // right now, so defaulting to a window would hide long-running work.
    const { props: prodPeriodProps, inPeriod: inProdPeriod } =
        usePeriodFilter("all", { variant: "pills" });
    const [prodChannel, setProdChannel] = useState("all");

    // Dispatch sub-tab: date + channel scope (the same two filters the Delivery
    // Report offers, via the shared PeriodFilter so every dashboard's time
    // control looks and behaves identically). Default "all" — the dispatch
    // queue is a live worklist, so hiding older packed-but-unshipped orders
    // behind a default window would bury exactly the ones that need chasing.
    const { props: dispatchPeriodProps, range: dispatchPeriodRange, timeline: dispatchTimeline } =
        usePeriodFilter("all", { variant: "pills" });
    // Human label for the selection, so period-scoped cards can name their own
    // window instead of claiming a hardcoded one.
    const dispatchPeriodLabel = periodLabel(dispatchTimeline);
    const [dispatchChannel, setDispatchChannel] = useState("all");
    // Urgency filter (all | overdue | today | partial), free-text search, and
    // how many queue rows are rendered. The list is capped and grown on demand
    // rather than rendered whole — the queue can hold hundreds of orders and
    // this tab must stay light.
    const [dispatchFilter, setDispatchFilter] = useState("all");
    const [dispatchSearch, setDispatchSearch] = useState("");
    const [dispatchLimit, setDispatchLimit] = useState(50);
    // Narrowing the queue must restart the row cap — otherwise a limit grown on
    // the full list carries over and the filtered view renders in one go.
    useEffect(() => { setDispatchLimit(50); }, [dispatchFilter, dispatchSearch, dispatchChannel, dispatchPeriodRange]);

    // ==================== FETCH DATA ====================
    const loadAllData = useCallback(async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                navigate("/login", { replace: true });
                return;
            }

            const { data: roleCheck } = await supabase
                .from("salesperson")
                .select("role")
                .eq("email", user.email?.toLowerCase())
                .single();

            if (!roleCheck || roleCheck.role !== "production_manager") {
                await supabase.auth.signOut();
                navigate("/login", { replace: true });
                return;
            }

            setUser(user);
            setCurrentUserEmail(user.email?.toLowerCase() || "");

            const profileResult = await supabase.from("salesperson").select("*").eq("email", user.email?.toLowerCase()).maybeSingle();
            if (profileResult.data) setProfile(profileResult.data);

            // Fetch all orders in batches to bypass Supabase 1000-row default limit
            const PAGE_SIZE = 1000;
            let allOrders = [];
            let from = 0;
            let done = false;
            while (!done) {
                const { data, error } = await supabase
                    .from("orders")
                    .select("*")
                    .order("created_at", { ascending: false })
                    .range(from, from + PAGE_SIZE - 1);
                if (error) throw error;
                if (data && data.length > 0) {
                    allOrders = [...allOrders, ...data];
                    from += PAGE_SIZE;
                    if (data.length < PAGE_SIZE) done = true;
                } else {
                    done = true;
                }
            }
            // B2B orders enter production only AFTER the merchandiser approves
            // them — an unapproved B2B order isn't real production yet, so it's
            // hidden from the Production Manager (same rule the B2B Production
            // Head + Warehouse dashboards already apply). Non-B2B orders are
            // unaffected.
            allOrders = allOrders.filter(o => !o.is_b2b || o.approval_status === "approved");
            setOrders(allOrders);

            // Resolve B2B "client name" — fetch all vendors referenced by the
            // loaded B2B orders. delivery_name is empty for B2B; store_brand_name
            // is the right analogue for the production manager view.
            const vendorIds = [...new Set(
                allOrders
                    .filter(o => o.is_b2b && o.vendor_id)
                    .map(o => o.vendor_id)
            )];
            if (vendorIds.length > 0) {
                const { data: vData } = await supabase
                    .from("vendors")
                    .select("id, store_brand_name, vendor_code, location")
                    .in("id", vendorIds);
                if (vData) {
                    const vMap = {};
                    vData.forEach(v => { vMap[v.id] = v; });
                    setVendorMap(vMap);
                }
            }

            // Fetch every order_components row so the Production tab can
            // aggregate counts per stage. Paged to bypass the 1000-row cap.
            let allComponents = [];
            let cFrom = 0;
            let cDone = false;
            while (!cDone) {
                const { data: cData, error: cErr } = await supabase
                    .from("order_components")
                    .select("id, order_id, order_no, barcode, component_type, component_label, current_stage, previous_stage, item_index, is_outside_wh, stage_updated_at, disposition, disposition_reason, re_journey_count, stage_pass_counts, is_rework, is_active")
                    .order("created_at", { ascending: false })
                    .range(cFrom, cFrom + PAGE_SIZE - 1);
                if (cErr) {
                    console.warn("order_components fetch failed:", cErr.message);
                    break;
                }
                if (cData && cData.length > 0) {
                    allComponents = [...allComponents, ...cData];
                    cFrom += PAGE_SIZE;
                    if (cData.length < PAGE_SIZE) cDone = true;
                } else {
                    cDone = true;
                }
            }
            // Keep only components of the orders we actually show (allOrders is
            // already filtered to exclude unapproved B2B), so the stage cards
            // don't count pieces of orders that aren't in production yet.
            const visibleOrderIds = new Set(allOrders.map(o => o.id));
            allComponents = allComponents.filter(c => visibleOrderIds.has(c.order_id));
            // Attach stages_outside for pieces out at a vendor so the badge reads
            // "Out to Vendor (Embroidery)" instead of the stalled stage.
            allComponents = await enrichComponentsWithMovements(allComponents);
            setComponents(allComponents);

            setLoading(false);
        } catch (err) {
            console.error("Load error:", err);
            setLoading(false);
        }
    }, [navigate]);

    useEffect(() => { loadAllData(); }, [loadAllData]);

    // Load QC records (all channels) when a tab that needs them opens.
    // The Production tab needs them too: qc_records is the ONLY real signal for
    // the QC Failures and Avg Lead Time cards (orders.qc_fail_reason /
    // in_production_at are dead columns nothing writes). Fetched once and
    // reused by both tabs — switching tabs must not refetch ~1000s of rows.
    useEffect(() => {
        if (activeTab !== "qc_history" && activeTab !== "production") return;
        if (qcHistoryLoaded) return;
        let cancelled = false;
        (async () => {
            setQcHistoryLoading(true);
            const recs = await fetchQcRecords({ paged: true });
            if (!cancelled) { setQcHistory(recs); setQcHistoryLoaded(true); setQcHistoryLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [activeTab, qcHistoryLoaded]);

    // Load live re-journeys (all channels) when the Re-journeys tab opens.
    useEffect(() => {
        if (activeTab !== "rejourneys") return;
        let cancelled = false;
        (async () => {
            setReJourneysLoading(true);
            const rows = await fetchReJourneys({ paged: true });
            if (!cancelled) { setReJourneys(rows); setReJourneysLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [activeTab]);

    // Load external vendor movements when the Vendors → At External Vendors
    // sub-tab opens.
    useEffect(() => {
        if (!(activeTab === "vendors" && subTab === "external")) return;
        let cancelled = false;
        (async () => {
            setExtMovementsLoading(true);
            const rows = await fetchExternalMovements();
            if (!cancelled) { setExtMovements(rows); setExtMovementsLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [activeTab, subTab]);

    // Fetch colors
    useEffect(() => {
        const fetchColors = async () => {
            const { data, error } = await supabase.from("colors").select("name, hex").order("name");
            if (!error && data) setColors(data);
        };
        fetchColors();
    }, []);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClick = (e) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpenDropdown(null); };
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, []);

    // Reset page when filters change
    useEffect(() => { setCurrentPage(1); }, [orderSearch, orderSearchField, statusTab, channelFilter, filters, sortBy, ordersPeriodRange]);

    // When highlighted order is set (e.g. from navigation state), scroll to it once orders are loaded
    useEffect(() => {
        if (!highlightOrderId || loading || orders.length === 0) return;
        const t = setTimeout(() => {
            const card = document.querySelector(`[data-order-id="${highlightOrderId}"]`);
            if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 300);
        const clearT = setTimeout(() => setHighlightOrderId(null), 4000);
        return () => { clearTimeout(t); clearTimeout(clearT); };
    }, [highlightOrderId, loading, orders.length]);

    // ==================== HELPER FUNCTIONS ====================
    const getPaymentStatus = (order) => {
        const paid = Number(order.amount_paid || 0);
        const total = Number(order.grand_total || order.net_total || 0);
        if (paid <= 0) return "unpaid";
        if (paid >= total) return "paid";
        return "partial";
    };

    const getPriority = (order) => order.priority || "normal";

    const salespersons = useMemo(() => {
        const spSet = new Set();
        orders.forEach(o => { if (o.salesperson && o.salesperson.trim()) spSet.add(o.salesperson.trim()); });
        return Array.from(spSet).sort();
    }, [orders]);

    const toggleFilter = (category, value) => setFilters(prev => ({
        ...prev,
        [category]: prev[category].includes(value) ? prev[category].filter(v => v !== value) : [...prev[category], value],
        // Picking stages from the dropdown is a plain (kind-agnostic) filter.
        ...(category === "stage" ? { stageKind: "both" } : {}),
    }));

    const removeFilter = (type, value) => {
        if (type === "date") clearOrdersPeriod();
        else if (type === "price") setFilters(prev => ({ ...prev, minPrice: 0, maxPrice: 500000 }));
        else if (type === "salesperson") setFilters(prev => ({ ...prev, salesperson: "" }));
        else if (type === "stage") setFilters(prev => ({ ...prev, stage: prev.stage.filter(v => v !== value), stageKind: "both" }));
        else if (type === "disposedOnly") setFilters(prev => ({ ...prev, disposedOnly: false }));
        else if (type === "delayedOnly") setFilters(prev => ({ ...prev, delayedOnly: false }));
        else if (type === "dispatchedOnly") setFilters(prev => ({ ...prev, dispatchedOnly: false }));
        else if (type === "dispatchReadyOnly") setFilters(prev => ({ ...prev, dispatchReadyOnly: false }));
        else if (type === "orderIdSet") setFilters(prev => ({ ...prev, orderIdSet: null, orderIdSetLabel: "" }));
        else setFilters(prev => ({ ...prev, [type]: prev[type].filter(v => v !== value) }));
    };

    const clearAllFilters = () => {
        setFilters({ minPrice: 0, maxPrice: 500000, payment: [], priority: [], salesperson: "", stage: [], stageKind: "both", disposedOnly: false, delayedOnly: false, dispatchedOnly: false, dispatchReadyOnly: false, orderIdSet: null, orderIdSetLabel: "" });
        clearOrdersPeriod();
    };

    // Jump from any reporting row to that order's card in All Orders: switch
    // tab, search by order #, highlight + scroll, then auto-clear the highlight.
    // Resets the other filters so nothing hides the target.
    //
    // Used by QC History, Re-journeys, External Vendors, the notification bell,
    // and (via openOrderInList) every row on the Production, Dispatch, Delivery
    // Report and Calendar tabs.
    const goToOrder = (orderId, orderNo) => {
        // ONE navigation for every URL-backed value. activeTab, statusTab,
        // channelFilter, orderSearchField and orderSearch are all search params;
        // calling their setters in sequence used to leave the user on the
        // current tab, because useTabParam PUSHES while useFilterParam REPLACES
        // — the replace landed last and discarded the pushed tab entry. Writing
        // the params together is the same fix useClearFilterParams applies.
        setSearchParams((prev) => {
            const p = new URLSearchParams(prev);
            p.set("tab", "orders");
            p.delete("status");        // "all"       — default, keep the URL clean
            p.delete("channel");       // "all"       — default
            p.delete("qf");            // "order_no"  — default
            if (orderNo) p.set("q", orderNo); else p.delete("q");
            return p;
        });
        // Plain useState — unaffected by the search-param batching above, so
        // these still need their own setters. The orders period is one of them
        // (usePeriodFilter holds state locally); it must be cleared or an order
        // outside the current window lands on an empty list.
        clearOrdersPeriod();
        setFilters({ minPrice: 0, maxPrice: 500000, payment: [], priority: [], salesperson: "", stage: [], stageKind: "both", disposedOnly: false, delayedOnly: false, dispatchedOnly: false, dispatchReadyOnly: false, orderIdSet: null, orderIdSetLabel: "" });
        setCurrentPage(1);
        setHighlightOrderId(orderId);
        setTimeout(() => {
            const card = document.querySelector(`[data-order-id="${orderId}"]`);
            if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 350);
        setTimeout(() => setHighlightOrderId(null), 4000);
    };

    // Clicking a stage-count card: scope the orders list to that one stage and
    // jump to the All Orders tab (status reset to "all" so nothing else hides it).
    // kind: 'both' (whole card), 'internal' (in-house sub-count), 'external' (vendor).
    const handleStageCardClick = (stageKey, kind = "both") => {
        setFilters(prev => ({ ...prev, stage: [stageKey], stageKind: kind, orderIdSet: null, orderIdSetLabel: "" }));
        setStatusTab("all");
        setActiveTab("orders");
    };

    // Disposed pieces are excluded from stage grouping, so the stage filter
    // can't target them — drill via a dedicated disposedOnly flag instead.
    // Delivery Report -> All Orders, carrying the report's channel and which
    // half of the report you were on. The report lists only 50 rows (it is a
    // summary, not a browser); this hands the full set to the real order list
    // where paging, search and every filter already exist.
    const showAllFromReport = (which) => {
        setChannelFilter(drChannel);
        setStatusTab(which === "open" ? "unfulfilled" : "completed");
        setFilters(prev => ({ ...prev, delayedOnly: which === "open", orderIdSet: null, orderIdSetLabel: "" }));
        setActiveTab("orders");
    };

    const handleDisposedClick = () => {
        setFilters(prev => ({ ...prev, disposedOnly: true, orderIdSet: null, orderIdSetLabel: "" }));
        setStatusTab("all");
        setActiveTab("orders");
    };

    // Pending/Delayed card: drill to the delayed (past-delivery) open orders when
    // there are any — the urgent set — otherwise to all pending/open orders.
    // "Pending" == the existing "unfulfilled" status tab; "Delayed" adds the
    // past-delivery-date filter on top of it.
    const handlePendingDelayedClick = () => {
        const hasDelayed = (salesMetrics?.delayedCount || 0) > 0;
        setFilters(prev => ({ ...prev, delayedOnly: hasDelayed }));
        setStatusTab("unfulfilled");
        setChannelFilter("all");
        setActiveTab("orders");
    };

    // Drill from a "Currently Running Late by Channel" row into that channel's
    // late orders: the delayed filter, scoped by the All Orders channel select.
    // The row's key is a STORE_FILTER_OPTIONS `value`, which is kept identical
    // to getOrderChannelLabel so it feeds channelFilter directly.
    const handleDelayedChannelClick = (channelValue) => {
        setFilters(prev => ({ ...prev, delayedOnly: true }));
        setStatusTab("unfulfilled");
        setChannelFilter(channelValue);
        setActiveTab("orders");
    };

    // Drill from the "QC Failures" KPI card into the QC History tab, already
    // scoped to failures. Overrides are excluded there too, so the row count
    // reconciles with the card.
    const handleQcFailuresClick = () => {
        setQcResultFilter("fail");
        setActiveTab("qc_history");
    };

    // Drill from the "Delayed" KPI card into the delayed orders list — the same
    // delayedOnly filter every other delayed figure on this dashboard uses, so
    // the list length matches the card.
    const handleDelayedClick = () => {
        setFilters(prev => ({
            ...prev,
            delayedOnly: true, disposedOnly: false, dispatchedOnly: false, dispatchReadyOnly: false,
            stage: [], stageKind: "both", orderIdSet: null, orderIdSetLabel: "",
        }));
        setStatusTab("all");
        setChannelFilter("all");
        setActiveTab("orders");
    };

    // Drill from the "Dispatch Backlog" card into orders that have a component
    // ready at the packaging_dispatch stage.
    const handleDispatchBacklogClick = () => {
        setFilters(prev => ({ ...prev, dispatchReadyOnly: true, orderIdSet: null, orderIdSetLabel: "" }));
        setStatusTab("all");
        setChannelFilter("all");
        setActiveTab("orders");
    };

    // Production tab export — every order still ON THE FLOOR in the current
    // period + channel scope, one row each, with where it is sitting and how
    // late it is. That is the list a PM actually chases; the bottleneck table
    // above it is a summary OF this list, so exporting the underlying orders is
    // strictly more useful than exporting the five summary rows.
    const handleProductionExport = () => {
        const rows = prodOrders.filter(isOrderStillRunning);
        if (rows.length === 0) {
            showPopup({ type: "info", title: "Nothing to export", message: "No orders are currently in production for this period and channel." });
            return;
        }
        const now = new Date();
        // Pieces per order, so the export shows how much work each row carries.
        const pieceCount = {};
        prodComponents.forEach((c) => {
            if (["disposed", "scrapped"].includes(c.current_stage)) return;
            pieceCount[c.order_id] = (pieceCount[c.order_id] || 0) + 1;
        });
        downloadCsv({
            filename: `production_wip_${prodChannel === "all" ? "all_channels" : prodChannel.toLowerCase().replace(/\s+/g, "_")}`,
            headers: [
                "Order No", "Customer", "SA", "Store", "Channel", "Product", "Pieces",
                "Current Stage", "Days at Stage", "Order Date", "Dispatch By",
                "Customer Delivery", "Days Late", "Priority", "Status",
            ],
            rows: rows.map((o) => {
                const due = getWarehouseDateObj(o.delivery_date, o.created_at);
                const daysLate = due
                    ? Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate())
                        - new Date(due.getFullYear(), due.getMonth(), due.getDate())) / 86400000)
                    : null;
                const since = o.warehouse_stage_updated_at || o.created_at;
                const daysAtStage = since ? Math.floor((now - new Date(since)) / 86400000) : null;
                return [
                    o.order_no || "",
                    getClientName(o) || "",
                    o.salesperson || "",
                    o.salesperson_store || "",
                    getChannelLabel(o),
                    o.items?.[0]?.product_name || "",
                    pieceCount[o.id] ?? 0,
                    getStageLabel(o.warehouse_stage) || o.warehouse_stage || "Order Received",
                    daysAtStage ?? "",
                    o.created_at ? new Date(o.created_at).toLocaleDateString("en-GB") : "",
                    due ? due.toLocaleDateString("en-GB") : "",
                    formatDate(o.delivery_date) || "",
                    // Negative = still has time. Only positive values are "late".
                    daysLate == null ? "" : daysLate > 0 ? daysLate : "On time",
                    o.priority || "Normal",
                    getOrderStatusLabel(o.status),
                ];
            }),
        });
    };

    // Drill from a Production Stage Bottlenecks row into the orders behind it.
    // `which` picks the column that was clicked: "overdue" = only the orders
    // past their T-2 deadline at that stage, "total" = everything sitting there.
    // The row hands over the exact ids it counted (row.orderIds /
    // row.overdueOrderIds), so the list length always equals the number clicked.
    const handleBottleneckClick = (row, which = "overdue") => {
        const ids = which === "overdue" ? row.overdueOrderIds : row.orderIds;
        if (!ids || ids.length === 0) return;
        setChannelFilter("all");
        setStatusTab("all");
        setFilters(prev => ({
            ...prev,
            delayedOnly: false, disposedOnly: false, dispatchedOnly: false, dispatchReadyOnly: false,
            stage: [], stageKind: "both",
            orderIdSet: new Set(ids),
            orderIdSetLabel: `${which === "overdue" ? "Overdue at" : "At"} ${row.name}`,
        }));
        setCurrentPage(1);
        setActiveTab("orders");
    };

    // Drill from a Production Pipeline row into the matching orders. Each row
    // clears the mutually-exclusive drill flags then sets its own target status
    // (Dispatched has no status tab, so it uses the dispatchedOnly flag).
    const handlePipelineClick = (key) => {
        setChannelFilter("all");
        setFilters(prev => ({
            ...prev,
            delayedOnly: false, disposedOnly: false, dispatchReadyOnly: false,
            dispatchedOnly: key === "dispatched",
            stage: key === "order_received" ? ["order_received"] : [],
            stageKind: "both", orderIdSet: null, orderIdSetLabel: "",
        }));
        switch (key) {
            case "order_received": setStatusTab("unfulfilled"); break;
            case "in_production": setStatusTab("unfulfilled"); break;
            case "completed": setStatusTab("completed"); break;
            case "dispatched": setStatusTab("all"); break;
            case "delivered": setStatusTab("delivered"); break;
            default: setStatusTab("all");
        }
        setActiveTab("orders");
    };

    const appliedFilters = useMemo(() => {
        const chips = [];
        if (ordersTimeline !== "all") {
            chips.push({ type: "date", label: periodLabel(ordersTimeline) });
        }
        if (filters.minPrice > 0 || filters.maxPrice < 500000) chips.push({ type: "price", label: `₹${(filters.minPrice / 1000).toFixed(0)}K - ₹${(filters.maxPrice / 1000).toFixed(0)}K` });
        filters.payment.forEach(p => chips.push({ type: "payment", value: p, label: p === "unpaid" ? "Unpaid (COD)" : p.charAt(0).toUpperCase() + p.slice(1) }));
        filters.priority.forEach(p => chips.push({ type: "priority", value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }));
        filters.stage.forEach(k => {
            const base = STAGE_GROUPS.find(g => g.key === k)?.label || k;
            const suffix = filters.stageKind === "internal" ? " · In-house" : filters.stageKind === "external" ? " · Vendor" : "";
            chips.push({ type: "stage", value: k, label: base + suffix });
        });
        if (filters.salesperson) chips.push({ type: "salesperson", label: filters.salesperson });
        if (filters.disposedOnly) chips.push({ type: "disposedOnly", label: "Disposed components" });
        if (filters.delayedOnly) chips.push({ type: "delayedOnly", label: "Currently running late" });
        if (filters.dispatchedOnly) chips.push({ type: "dispatchedOnly", label: "Dispatched" });
        if (filters.dispatchReadyOnly) chips.push({ type: "dispatchReadyOnly", label: "Ready for dispatch" });
        // Bottleneck drill-down — the chip carries its own label ("Stuck at
        // Dyeing", "Overdue at Dyeing") set by handleBottleneckClick.
        if (filters.orderIdSet) chips.push({ type: "orderIdSet", label: filters.orderIdSetLabel || "Selected orders" });
        return chips;
    }, [filters, ordersTimeline]);

    const handleExportCSV = () => {
        if (filteredOrders.length === 0) return;
        const headers = ["Order No", "Product Name", "Customer Name", "Size", "Amount", "Top Color", "Bottom Color", "SA Name", "Store", "Status", "Priority", "Notes", "Order Date", "Warehouse Date (T-2)"];
        const rows = filteredOrders.map(order => {
            const item = order.items?.[0] || {};
            return [
                order.order_no || "",
                item.product_name || "",
                getClientName(order) || "",
                item.size || "",
                order.grand_total || 0,
                item.top_color?.name || "",
                item.bottom_color?.name || "",
                order.salesperson || "",
                order.salesperson_store || "",
                order.status || "",
                order.priority || "normal",
                order.notes || "",
                order.created_at ? new Date(order.created_at).toLocaleDateString("en-GB") : "",
                getWarehouseDate(order.delivery_date, order.created_at, ""),
            ].map(v => `"${String(v).replace(/"/g, '""')}"`);
        });
        const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `production_orders_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Export every scan in [scanReportFrom, scanReportTo] as a CSV — the
    // "what moved today / this week" report. One row per stage_transitions row
    // (station scans, overrides, vendor gate, re-journeys — labelled by Type).
    const handleScanReportExport = async () => {
        if (!scanReportFrom || !scanReportTo) return;
        if (scanReportFrom > scanReportTo) {
            showPopup({ type: "warning", title: "Check the dates", message: "The From date is after the To date.", confirmText: "OK" });
            return;
        }
        setScanReportBusy(true);
        try {
            const rows = await fetchScanReport({ from: scanReportFrom, to: scanReportTo });
            if (rows.length === 0) {
                showPopup({ type: "info", title: "No scans", message: `No components were scanned between ${scanReportFrom} and ${scanReportTo}.`, confirmText: "OK" });
                return;
            }
            const csv = scanReportCsv(rows);
            const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = scanReportFrom === scanReportTo
                ? `scan_report_${scanReportFrom}.csv`
                : `scan_report_${scanReportFrom}_to_${scanReportTo}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Scan report export failed:", err);
            showPopup({ type: "error", title: "Export failed", message: err.message || "Could not fetch the scan report.", confirmText: "OK" });
        } finally {
            setScanReportBusy(false);
        }
    };

    // Quick picks for the scan report range.
    const setScanReportRange = (days) => {
        const to = new Date();
        const from = new Date();
        from.setDate(from.getDate() - (days - 1)); // 1 = today only
        setScanReportFrom(from.toISOString().slice(0, 10));
        setScanReportTo(to.toISOString().slice(0, 10));
    };

    // The picker hands back an array of item indexes; null means "whole order".
    // An empty array is treated as null so a stray call can't silently no-op.
    const normaliseItemPick = (pick) => {
        if (pick === null || pick === undefined) return null;
        const arr = Array.isArray(pick) ? pick : [pick];
        return arr.length ? arr : null;
    };

    // "product 2 of SB-…" / "Kurta Set + Dupatta of SB-…" / "order SB-…"
    const describeItemPick = (order, picked) => {
        if (picked === null) return `order ${order.order_no}`;
        const items = Array.isArray(order.items) ? order.items : [];
        const names = picked.map(i => items[i]?.product_name || `product ${i + 1}`);
        return `${names.join(" + ")} of ${order.order_no}`;
    };

    // manual_complete_order takes ONE item index, so a multi-product pick loops.
    // Returns the LAST result — order_completed is only true on the call that
    // leaves nothing active, which is what the caller keys the order stamp off.
    // Final QC is mandatory; the Production Manager may override it and
    // complete the product anyway. The shared helper does the retry handshake
    // and asks confirmOverride first, listing the pieces that are short.
    const runManualComplete = async (order, picked) => {
        const res = await runManualCompleteWithOverride({
            orderId: order.id,
            by: currentUserEmail,
            picked,
            // Only the Production Manager may override an incomplete Final QC.
            allowOverride: true,
            confirmOverride: ({ blocking }) => new Promise((resolve) => {
                showPopup({
                    type: "confirm",
                    title: "Override Final QC?",
                    message:
                        `${blocking.length} piece(s) have NOT passed Final QC:\n\n${describeBlocking(blocking)}\n\n` +
                        `Completing now skips Final QC for them — they become ready for Packaging & Dispatch. ` +
                        `This is recorded against your name in the order's QC Report.`,
                    confirmText: "Override & complete",
                    cancelText: "Cancel",
                    onConfirm: () => resolve(true),
                    onCancel: () => resolve(false),
                });
            }),
        });
        return res.cancelled ? null : res.last;
    };

    // Mark as Completed — production is finished making the garment. Final QC is
    // mandatory: the RPC refuses if any piece has not passed it — but the
    // Production Manager can override that and complete it anyway (a second
    // confirm lists what's being skipped; it lands in the QC Report).
    // Components stay at final_qc_passed — packaging & dispatch is a separate,
    // later event that moves them to dispatched. Completed ≠ dispatched ≠
    // delivered.
    //
    // An order can hold several products; itemIndexes completes just those
    // (null = the whole order). For a multi-product order we ask first.
    const markManualComplete = async (order, e, itemIndexes = null) => {
        if (e) e.stopPropagation();

        // Multi-product order and nothing chosen yet → ask first.
        const products = distinctItemIndexes(componentsByOrder[order.id]);
        if (itemIndexes === null && products.length > 1) {
            setCompletePicker({ order, products });
            return;
        }

        const picked = normaliseItemPick(itemIndexes);
        const scopeLabel = describeItemPick(order, picked);
        const ok = await new Promise((resolve) => {
            showPopup({
                type: "confirm",
                title: "Mark as Completed",
                message: `Mark ${scopeLabel} as completed? Pieces become ready for Packaging & Dispatch. If any piece has not passed Final QC you'll be asked to confirm an override.`,
                confirmText: "Yes, complete it",
                cancelText: "Cancel",
                onConfirm: () => resolve(true),
                onCancel: () => resolve(false),
            });
        });
        if (!ok) return;
        try {
            setActionLoading(order.id);
            // The RPC gates on Final QC and completes the ORDER only when every
            // active piece has passed it.
            const data = await runManualComplete(order, picked);
            if (data === null) return;   // override declined — nothing changed
            if (data?.order_completed) {
                setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "completed" } : o));
            }
            // Re-fetch components so the piece badges reflect the new stage live.
            loadAllData();
            showPopup({ type: "success", title: "Done", message: data?.message || `${scopeLabel} marked as completed.` });
        } catch (err) {
            console.error("Manual complete error:", err);
            showPopup({ type: "error", title: "Failed", message: err.message || "Could not update order" });
        } finally {
            setActionLoading(null);
        }
    };

    // Open warehouse PDF in a new tab (generates on-the-fly if not yet created).
    // PM only ever sees the warehouse PDF, never the customer PDF.
    const handleViewWarehousePdf = async (order, e) => {
        if (e) e.stopPropagation();
        if (warehousePdfLoading === order.id) return;
        try {
            setWarehousePdfLoading(order.id);
            const result = await downloadWarehousePdf(order, null, false);
            if (!result) {
                showPopup({ type: "error", title: "PDF Failed", message: "Could not open or generate the warehouse PDF. Please try again." });
                return;
            }
            // If we just generated fresh URLs, reflect them in local state so
            // subsequent clicks skip regeneration.
            const cleanUrls = Array.isArray(result) ? result : [result];
            setOrders(prev => prev.map(o => o.id === order.id ? { ...o, warehouse_urls: cleanUrls, warehouse_url: cleanUrls[0] } : o));
        } catch (err) {
            console.error("Warehouse PDF error:", err);
            showPopup({ type: "error", title: "PDF Failed", message: err.message || "Could not generate the warehouse PDF." });
        } finally {
            setWarehousePdfLoading(null);
        }
    };


    // Status counts come from the shared util (src/utils/productionMetrics.js)
    // so every dashboard shares ONE implementation. Each tab computes its own
    // scope: statusStatsOv (Overview period) and statusStatsProd (Production
    // period + channel). There is no unscoped copy — nothing renders one.

    // Human label for the current Overview period (used in the revenue card etc.).
    const overviewPeriodLabel = periodLabel(overviewTimeline);

    // Per-stage component counts. Source of truth: order_components.current_stage
    // (advanced live by the warehouse Scan Station). One row per top/bottom/
    // dupatta/extra so a single order contributes multiple data points.
    // Orders placed within the selected Overview period. Their COMPONENTS
    // (overviewComponents) feed the "Orders by Production Stage" cards, which
    // count pieces and split in-house vs out-at-vendor.
    const overviewOrders = useMemo(
        () => orders.filter((o) => inOverviewPeriod(o.created_at)),
        [orders, inOverviewPeriod]
    );

    // Components whose stage activity (stage_updated_at) falls in the selected
    // Overview period — powers the piece-count stage cards with the in-house/
    // vendor split. Filtered by the PIECE's own scan time, not its order's
    // created_at, so a scan today on an old order shows up under "Today".
    // (components carry is_outside_wh + stages_outside from enrichComponentsWithMovements.)
    const overviewComponents = useMemo(
        () => components.filter((c) => inOverviewPeriod(c.stage_updated_at || c.created_at)),
        [components, inOverviewPeriod]
    );

    // Total components CONTAINED IN the orders shown on the Overview — counted by
    // order membership, NOT by scan time. This is the count that lines up with
    // the Total Orders card: 2 orders with 3 + 4 pieces = 7. (overviewComponents
    // above is scan-time-scoped for the stage cards, so it can't be used here —
    // it would exclude pieces of orders that weren't scanned in the period.)
    const overviewComponentCount = useMemo(() => {
        const ids = new Set(overviewOrders.map(o => o.id));
        return components.reduce((n, c) => n + (ids.has(c.order_id) ? 1 : 0), 0);
    }, [components, overviewOrders]);

    // Disposed components in the selected Overview period (disposal sets
    // stage_updated_at = NOW(), so overviewComponents already scopes by when it
    // was disposed). Powers the clickable "Disposed" Business Performance card.
    const disposedCount = useMemo(
        () => overviewComponents.filter((c) => c.current_stage === "disposed").length,
        [overviewComponents]
    );
    // Orders (all-time, not period-scoped) that contain a disposed component —
    // the set the "Disposed" card drills the order list into.
    const disposedOrderIds = useMemo(() => {
        const s = new Set();
        components.forEach((c) => { if (c.current_stage === "disposed") s.add(c.order_id); });
        return s;
    }, [components]);
    // Orders with ≥1 component sitting at packaging_dispatch (ready, not yet
    // dispatch-scanned) — the set the "Dispatch Backlog" card drills into.
    const dispatchReadyOrderIds = useMemo(() => {
        const s = new Set();
        components.forEach((c) => { if (c.current_stage === "packaging_dispatch") s.add(c.order_id); });
        return s;
    }, [components]);


    const stageStats = useMemo(() => {
        const counts = {};
        components.forEach((c) => {
            const k = c.current_stage || "order_received";
            counts[k] = (counts[k] || 0) + 1;
        });
        // PRODUCTION_STAGES is already in workflow order; keep that order.
        const list = PRODUCTION_STAGES.map((s) => ({
            value: s.value,
            label: s.label,
            color: s.color,
            count: counts[s.value] || 0,
        })).filter((s) => s.count > 0);
        const total = components.length;
        return { list, total };
    }, [components]);

    // Per-order component lookup for the card journey row (O(1) per card vs.
    // filtering the full list each render). Sorted by item_index then a stable
    // TOP -> BTM -> DUP -> EXTRA order so each outfit's pieces read naturally.
    const componentsByOrder = useMemo(() => {
        const TYPE_ORDER = { top: 0, bottom: 1, dupatta: 2, extra: 3 };
        const map = {};
        components.forEach((c) => {
            (map[c.order_id] || (map[c.order_id] = [])).push(c);
        });
        Object.values(map).forEach((arr) => arr.sort((a, b) =>
            (a.item_index ?? 0) - (b.item_index ?? 0) ||
            (TYPE_ORDER[a.component_type] ?? 9) - (TYPE_ORDER[b.component_type] ?? 9)
        ));
        return map;
    }, [components]);

    // order_id -> status, so the cards can bucket a bypass-completed order's
    // pieces under Packaging & Dispatch instead of their stalled stage.
    const orderStatusById = useMemo(() => {
        const m = {};
        orders.forEach((o) => { m[o.id] = o.status; });
        return m;
    }, [orders]);

    // For each order, which stage buckets its pieces occupy AND of what kind
    // (internal / external), using the SAME classifier the cards use. Shape:
    //   { [orderId]: { [stageKey]: Set('internal'|'external') } }
    // The Stage filter matches an order if ANY of its pieces is at the chosen
    // stage; the in-house/vendor sub-count click narrows it to that kind.
    const orderStageGroups = useMemo(() => {
        const map = {};
        components.forEach((c) => {
            const info = classifyComponentForStageCard(c, orderStatusById[c.order_id]);
            if (!info || !info.key) return;
            const byStage = map[c.order_id] || (map[c.order_id] = {});
            (byStage[info.key] || (byStage[info.key] = new Set())).add(info.kind);
        });
        return map;
    }, [components, orderStatusById]);

    // Components in the currently-drilled-down stage (for the modal list)
    const drillDownComponents = useMemo(() => {
        if (!stageDrillDown) return [];
        return components.filter((c) => (c.current_stage || "order_received") === stageDrillDown);
    }, [components, stageDrillDown]);

    // order_id -> order, so the dispatch-backlog helper can flag overdue-ready
    // pieces against their order's delivery date. Full-orders scope.
    const orderById = useMemo(() => {
        const m = {};
        orders.forEach(o => { m[o.id] = o; });
        return m;
    }, [orders]);

    // ==================== DISPATCH TAB DATA ====================
    // Everything the Dispatch sub-tab shows, derived from the REAL scan signal.
    //
    // This whole tab used to read orders.ready_for_dispatch_at / dispatched_at —
    // dead columns no RPC ever writes (same dead pair called out on the metrics
    // opts below). Every KPI therefore read 0 and both tables never rendered.
    // The truth lives in order_components.current_stage.
    //
    // QUEUE = READY_TO_DISPATCH, not packaging_dispatch alone. Verified against
    // PROD (Aug 2026): the floor scans pieces straight from production into
    // `dispatched` and NEVER uses `packaging_dispatch` — that stage has zero
    // rows, while 321 pieces sit at final_qc_passed and 281 at
    // production_complete. Keying the queue on packaging_dispatch alone made it
    // permanently empty and hid ~600 pieces genuinely awaiting dispatch.
    // packaging_dispatch stays in the set so the tab keeps working unchanged if
    // that scan step is adopted later.
    //
    // An order joins the queue when ANY of its pieces is ready, because that is
    // the unit a PM dispatches. The per-stage split is carried through so a
    // part-ready order can't masquerade as fully packed.
    //
    // PERIOD + CHANNEL SCOPE. Both are applied INSIDE this memo, so the KPI
    // cards and the tables always describe the same set — cards computed over
    // the full data while the tables showed a filtered slice would contradict
    // each other on screen.
    //
    // The period deliberately applies to a DIFFERENT date per list, because
    // "when did this happen" means something different on each side:
    //   queue      -> when the piece was PACKED (readySince)
    //   dispatched -> when it actually SHIPPED (at)
    // Filtering the queue by order-creation date would hide exactly the old,
    // urgent orders the queue exists to surface.
    const dispatchData = useMemo(() => {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const from = dispatchPeriodRange ? dispatchPeriodRange.start.getTime() : null;
        const to = dispatchPeriodRange ? dispatchPeriodRange.end.getTime() : null;
        // A row with no usable timestamp can't be placed in a bounded window, so
        // a date-bounded view drops it rather than guessing (never invent a date).
        const inWindow = (t) => {
            if (from == null && to == null) return true;
            if (t == null) return false;
            return t >= from && t <= to;
        };
        const channelOk = (o) => dispatchChannel === "all" || getOrderChannelLabel(o) === dispatchChannel;

        // Pieces grouped per order, tagged by which side of the line they're on.
        // `inProduction` = still upstream of ready, which is what makes an order
        // only PARTLY ready. Disposed/scrapped pieces are out of the flow and
        // must not count as outstanding work.
        const OUT_OF_FLOW = new Set(["disposed", "scrapped"]);
        const byOrder = new Map();
        components.forEach((c) => {
            if (OUT_OF_FLOW.has(c.current_stage)) return;
            let g = byOrder.get(c.order_id);
            if (!g) { g = { ready: [], dispatched: [], inProduction: 0 }; byOrder.set(c.order_id, g); }
            if (READY_TO_DISPATCH.has(c.current_stage)) g.ready.push(c);
            else if (c.current_stage === "dispatched") g.dispatched.push(c);
            else g.inProduction++;
        });

        // Waiting to go out: the actionable queue.
        //
        // Built in TWO scopes, because the date filter is not meaningful for
        // every figure on this tab:
        //   pendingAll — channel-filtered only. Deadline figures (Overdue, Due
        //                Today) are about WHEN AN ORDER IS DUE, so scoping them
        //                by when a piece became ready is wrong: picking "Today"
        //                would drop an order that turned ready last week and is
        //                due today — the exact order that needs dispatching.
        //   pending    — additionally date-filtered; drives the queue table and
        //                the wait-time figures, which ARE about the ready date.
        const pendingAll = [];
        const pending = [];
        byOrder.forEach((g, orderId) => {
            if (g.ready.length === 0) return;
            const o = orderById[orderId];
            if (!o || o.status === "cancelled") return;
            if (!channelOk(o)) return;
            // Ready-since = the most recent ready-stage scan among its pieces
            // (stage_updated_at is stamped by advance_component_stage).
            const readySince = g.ready.reduce((latest, c) => {
                const t = c.stage_updated_at ? new Date(c.stage_updated_at).getTime() : NaN;
                return Number.isFinite(t) && (latest == null || t > latest) ? t : latest;
            }, null);
            const waitDays = readySince != null ? Math.floor((now - readySince) / 86400000) : null;
            // Where the ready pieces actually sit. Because the floor skips
            // packaging_dispatch, "ready" spans several stages — the table shows
            // which, so the PM knows whether a piece cleared Final QC or merely
            // finished production.
            const stageCounts = {};
            g.ready.forEach((c) => { stageCounts[c.current_stage] = (stageCounts[c.current_stage] || 0) + 1; });
            const readyStages = READY_TO_DISPATCH_ORDER
                .filter((k) => stageCounts[k])
                .map((k) => ({ stage: k, label: getStageLabel(k), count: stageCounts[k] }));
            const warehouseDue = getWarehouseDateObj(o.delivery_date, o.created_at);
            // Overdue is measured against the T-2 WAREHOUSE deadline, the date
            // production actually works to — every other figure on this
            // dashboard uses T-2, and the old code used the raw customer date.
            const overdue = warehouseDue ? warehouseDue < startOfToday : false;
            const daysToDue = warehouseDue
                ? Math.round((new Date(warehouseDue.getFullYear(), warehouseDue.getMonth(), warehouseDue.getDate()) - startOfToday) / 86400000)
                : null;
            const row = {
                order: o,
                readyCount: g.ready.length,
                dispatchedCount: g.dispatched.length,
                inProductionCount: g.inProduction,
                partial: g.inProduction > 0,
                readyStages,
                readySince,
                waitDays,
                warehouseDue,
                daysToDue,
                overdue,
            };
            pendingAll.push(row);
            if (inWindow(readySince)) pending.push(row);   // date scope = when it became ready
        });
        // Most urgent first: overdue, then nearest deadline, then longest waiting.
        const byUrgency = (a, b) =>
            (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) ||
            (a.daysToDue ?? 9999) - (b.daysToDue ?? 9999) ||
            (b.waitDays ?? -1) - (a.waitDays ?? -1);
        pendingAll.sort(byUrgency);
        pending.sort(byUrgency);

        // Recently dispatched: orders whose pieces have actually left. Ordered by
        // the real scan time, never updated_at (any later edit rewrites that and
        // it reads as a fresh dispatch on a months-old order).
        const dispatched = [];
        byOrder.forEach((g, orderId) => {
            if (g.dispatched.length === 0) return;
            const o = orderById[orderId];
            if (!o) return;
            if (!channelOk(o)) return;
            const at = g.dispatched.reduce((latest, c) => {
                const t = c.stage_updated_at ? new Date(c.stage_updated_at).getTime() : NaN;
                return Number.isFinite(t) && (latest == null || t > latest) ? t : latest;
            }, null);
            if (!inWindow(at)) return;              // period = when it shipped
            const warehouseDue = getWarehouseDateObj(o.delivery_date, o.created_at);
            // Was the dispatch itself on time against T-2?
            let daysLate = null;
            if (at != null && warehouseDue) {
                const atMid = new Date(new Date(at).getFullYear(), new Date(at).getMonth(), new Date(at).getDate());
                const dueMid = new Date(warehouseDue.getFullYear(), warehouseDue.getMonth(), warehouseDue.getDate());
                daysLate = Math.round((atMid - dueMid) / 86400000);
            }
            dispatched.push({
                order: o,
                pieces: g.dispatched.length,
                stillPending: g.ready.length,
                at,
                daysLate,
            });
        });
        dispatched.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));

        // KPI figures — all over the pending queue, the set a PM can act on.
        //
        // "Due" is a DEADLINE window, so it reads pendingAll (channel-scoped)
        // and is bounded by the selected period's dates rather than by when a
        // piece became ready. The period control IS the window — there is no
        // hardcoded "today" card, so a PM picks Today / Yesterday / This month
        // and the card follows. With no period set it means "due at any point"
        // (everything still waiting), which is the honest unbounded reading.
        const overdueCount = pendingAll.filter(p => p.overdue).length;
        const partialCount = pendingAll.filter(p => p.partial).length;
        const dueCount = pendingAll.filter((p) => {
            if (!p.warehouseDue) return false;
            if (from == null && to == null) return true;
            const t = p.warehouseDue.getTime();
            return t >= from && t <= to;
        }).length;
        // Wait-time figures stay on the date-scoped set — they ARE about when a
        // piece became ready, so the period filter is meaningful for them.
        const readyPieces = pending.reduce((n, p) => n + p.readyCount, 0);
        const waits = pending.map(p => p.waitDays).filter(d => d != null);
        const avgWait = waits.length > 0 ? (waits.reduce((a, b) => a + b, 0) / waits.length).toFixed(1) : null;
        const oldestWait = waits.length > 0 ? Math.max(...waits) : null;

        // Throughput + on-time rate: `dispatched` is already period-filtered by
        // ship date, so both are simply "in the selected period". No hardcoded
        // today/7d/30d windows — the period control is the only window.
        const periodScoped = dispatchPeriodRange != null;
        const dispatchedInScope = dispatched.length;
        const rated = dispatched.filter(d => d.daysLate != null);
        const onTimeRated = rated.filter(d => d.daysLate <= 0).length;
        const onTimePct = rated.length > 0 ? Math.round((onTimeRated / rated.length) * 100) : null;

        return {
            pending, pendingAll, dispatched,
            overdueCount, dueCount, partialCount, readyPieces, avgWait, oldestWait,
            dispatchedInScope, periodScoped,
            onTimePct, onTimeSample: rated.length, onTimeOrders: onTimeRated,
        };
    }, [components, orderById, dispatchPeriodRange, dispatchChannel]);

    // NOTE: the full-scope productionMetrics/productionOpts/visibleQcRecords
    // memos that used to live here are gone. The Production tab now has its own
    // period+channel scope (productionMetricsProd below) and the Overview has
    // productionMetricsOv, so nothing consumed the unscoped set any more — and
    // computing it meant walking every component on each render for no reader.

    // ==================== SALES & REVENUE METRICS (Overview, period-scoped) ====================
    // Computed over the selected Overview period (overviewOrders — orders PLACED
    // in the window). Revenue is the period TOTAL (not month/year), so the whole
    // Overview reflects the chosen filter consistently.
    const salesMetrics = useMemo(() => {
        const now = new Date();
        const isRevenue = isRevenueOrder; // shared rule — src/utils/revenue.js

        // Total revenue for the period.
        const revenuePeriod = overviewOrders.reduce((sum, o) => sum + (isRevenue(o) ? Number(o.grand_total || 0) : 0), 0);

        // Pending + Delayed (still-running orders in the period). Dispatched is
        // treated as done (out of production), so it's excluded from both — the
        // In-Progress and Delayed numbers count only orders still on the floor.
        const openOrders = overviewOrders.filter(o => {
            const s = (o.status || "").toLowerCase();
            return !DONE_STATUSES.has(s) && o.warehouse_stage !== "dispatched";
        });
        const pendingCount = openOrders.length;
        const delayedCount = openOrders.filter(o => o.delivery_date && new Date(o.delivery_date) < now).length;

        // Returns & Exchanges (in period).
        const returnedOrders = overviewOrders.filter(o => o.return_reason || (o.returned_items && Array.isArray(o.returned_items) && o.returned_items.length > 0) || o.status === "returned");
        const exchangeOrders = overviewOrders.filter(o => o.exchange_requested_at || o.exchange_reason);
        const deliveredCount = overviewOrders.filter(isRevenue).length;
        const returnRate = deliveredCount > 0 ? ((returnedOrders.length / deliveredCount) * 100).toFixed(1) : "0.0";

        // Refunded amount (in period).
        const refundedAmount = overviewOrders
            .filter(o => {
                const rs = (o.refund_status || "").toLowerCase();
                return rs === "processed" || rs === "completed" || rs === "refunded" || rs === "paid";
            })
            .reduce((sum, o) => sum + Number(o.grand_total || 0), 0);

        // Top selling product (in period).
        const productCount = {};
        overviewOrders.forEach(o => {
            if (!isRevenue(o)) return;
            (o.items || []).forEach(item => {
                const name = item.product_name;
                if (!name) return;
                productCount[name] = (productCount[name] || 0) + Number(item.quantity || 1);
            });
        });
        const topProductEntry = Object.entries(productCount).sort((a, b) => b[1] - a[1])[0];
        const topProduct = topProductEntry ? { name: topProductEntry[0], count: topProductEntry[1] } : { name: "—", count: 0 };

        return {
            revenuePeriod,
            pendingCount, delayedCount,
            returnCount: returnedOrders.length, returnRate,
            exchangeCount: exchangeOrders.length,
            refundedAmount,
            topProduct,
        };
    }, [overviewOrders]);

    // Which channel the currently-running-late orders are coming from — same
    // period + same isOrderRunningLate rule as the In-Progress/Delayed card (a
    // still-running order past its delivery date; dispatched/completed excluded),
    // bucketed by the shared channel definitions so the parts sum to the card's
    // delayed count. Sorted worst-first.
    const delayedByChannel = useMemo(() => {
        const now = new Date();
        const delayed = overviewOrders.filter(o => isOrderRunningLate(o, now));
        const total = delayed.length;
        const rows = STORE_FILTER_OPTIONS.map(opt => {
            const count = delayed.filter(opt.match).length;
            return {
                key: opt.value,
                label: opt.label,
                color: opt.color,
                count,
                percentage: total > 0 ? Math.round((count / total) * 100) : 0,
            };
        }).filter(r => r.count > 0);
        rows.sort((a, b) => b.count - a.count);
        return { total, rows };
    }, [overviewOrders]);

    // Total orders vs currently-running-late, per channel — the grouped-bar
    // chart on the Overview. "Late" uses the SAME isOrderRunningLate rule as the
    // list/card, so as orders are dispatched/completed the Late bar shrinks live.
    // Zero-order channels are dropped so the chart only shows active ones.
    const channelOrdersVsLate = useMemo(() => {
        const now = new Date();
        return STORE_FILTER_OPTIONS.map(opt => {
            const inChannel = overviewOrders.filter(opt.match);
            const late = inChannel.filter(o => isOrderRunningLate(o, now)).length;
            return { name: opt.label, color: opt.color, Total: inChannel.length, Late: late };
        }).filter(r => r.Total > 0);
    }, [overviewOrders]);

    // Overview-scoped copies of the SHARED memos, computed over the period set.
    // The originals (channelStats/statusStats/productionMetrics over full orders)
    // stay untouched so the Production tab is unaffected.
    const statusStatsOv = useMemo(() => computeStatusStats(overviewOrders), [overviewOrders]); // eslint-disable-line react-hooks/exhaustive-deps
    const channelBreakdownOv = useMemo(() => computeChannelBreakdown(overviewOrders), [overviewOrders]);
    // Piece-level opts for the Overview's Production Overview cards, scoped to the
    // period's components (Re-journey % and Dispatch Backlog from the real
    // order_components signals). overviewComponents is already period-scoped by
    // scan time (stage_updated_at), which is the right scope for "currently in
    // rework" — a rework re-stamps stage_updated_at.
    const overviewOrderById = useMemo(() => {
        const m = {};
        overviewOrders.forEach(o => { m[o.id] = o; });
        return m;
    }, [overviewOrders]);
    // QC records for the period's orders only, so the Overview's QC figures move
    // with the period filter like every other card on that tab.
    const overviewQcRecords = useMemo(() => {
        if (!qcHistoryLoaded) return null;
        return qcHistory.filter(r => overviewOrderById[r.order_id]);
    }, [qcHistory, qcHistoryLoaded, overviewOrderById]);

    const productionOptsOv = useMemo(() => ({
        reJourneyActive: computeReJourneyCount(overviewComponents),
        reJourneyDenom: countActiveComponents(overviewComponents),
        dispatchReady: computeDispatchReady(overviewComponents, overviewOrderById),
        qcRecords: overviewQcRecords,
    }), [overviewComponents, overviewOrderById, overviewQcRecords]);
    const productionMetricsOv = useMemo(() => computeProductionMetrics(overviewOrders, statusStatsOv, productionOptsOv), [overviewOrders, statusStatsOv, productionOptsOv]); // eslint-disable-line react-hooks/exhaustive-deps
    const recentOrdersOv = useMemo(() => overviewOrders.slice(0, 10), [overviewOrders]);

    // ==================== PRODUCTION TAB SCOPE ====================
    // Period + channel scoped copies of the same shared metrics, so every figure
    // on the Production tab moves with its own filter bar. Mirrors the Overview
    // block above exactly — one implementation (productionMetrics.js), three
    // scopes (full / overview / production).
    //
    // Orders are scoped by created_at (when the order was placed) and components
    // by their own scan time (stage_updated_at), the same split the Overview
    // uses: a scan today on an old order belongs in "Today" for stage-activity
    // figures, but that order belongs to the month it was placed.
    const prodOrders = useMemo(
        () => orders.filter((o) =>
            inProdPeriod(o.created_at) &&
            (prodChannel === "all" || getOrderChannelLabel(o) === prodChannel)
        ),
        [orders, inProdPeriod, prodChannel]
    );
    const prodOrderById = useMemo(() => {
        const m = {};
        prodOrders.forEach(o => { m[o.id] = o; });
        return m;
    }, [prodOrders]);
    // Components scoped by scan time AND restricted to the visible orders, so a
    // channel filter can't leak pieces from orders the tab is no longer showing.
    const prodComponents = useMemo(
        () => components.filter((c) =>
            inProdPeriod(c.stage_updated_at || c.created_at) && prodOrderById[c.order_id]
        ),
        [components, inProdPeriod, prodOrderById]
    );
    const prodQcRecords = useMemo(() => {
        if (!qcHistoryLoaded) return null;
        return qcHistory.filter(r => prodOrderById[r.order_id]);
    }, [qcHistory, qcHistoryLoaded, prodOrderById]);
    const statusStatsProd = useMemo(() => computeStatusStats(prodOrders), [prodOrders]); // eslint-disable-line react-hooks/exhaustive-deps
    const productionOptsProd = useMemo(() => ({
        reJourneyActive: computeReJourneyCount(prodComponents),
        reJourneyDenom: countActiveComponents(prodComponents),
        dispatchReady: computeDispatchReady(prodComponents, prodOrderById),
        qcRecords: prodQcRecords,
    }), [prodComponents, prodOrderById, prodQcRecords]);
    const productionMetricsProd = useMemo(
        () => computeProductionMetrics(prodOrders, statusStatsProd, productionOptsProd),
        [prodOrders, statusStatsProd, productionOptsProd]
    ); // eslint-disable-line react-hooks/exhaustive-deps

    // ==================== TOP PRODUCT / COLOR / SIZE BY STORE (period-scoped) ====================
    const topByStore = useMemo(() => {
        const orders = overviewOrders; // scope to the Overview period
        const isRevenue = isRevenueOrder; // shared rule — see src/utils/revenue.js

        const getStore = (o) => {
            if (o.is_b2b) return "B2B";
            const s = (o.salesperson_store || "").trim();
            return s || "Other";
        };

        const storeSet = new Set();
        orders.forEach(o => { if (isRevenue(o)) storeSet.add(getStore(o)); });
        const storeList = Array.from(storeSet);

        const productMap = {};
        const colorMap = {};
        const sizeMap = {};

        orders.forEach(o => {
            if (!isRevenue(o)) return;
            const store = getStore(o);
            (o.items || []).forEach(item => {
                const qty = Number(item.quantity || 1);

                const pname = item.product_name;
                if (pname) {
                    if (!productMap[pname]) productMap[pname] = { name: pname };
                    productMap[pname][store] = (productMap[pname][store] || 0) + qty;
                }

                const topColor = typeof item.top_color === "object" ? item.top_color?.name : item.top_color;
                const bottomColor = typeof item.bottom_color === "object" ? item.bottom_color?.name : item.bottom_color;
                const fallbackColor = typeof item.color === "object" ? item.color?.name : item.color;
                const color = topColor || fallbackColor || bottomColor;
                if (color) {
                    if (!colorMap[color]) colorMap[color] = { name: color };
                    colorMap[color][store] = (colorMap[color][store] || 0) + qty;
                }

                const size = item.size;
                if (size) {
                    if (!sizeMap[size]) sizeMap[size] = { name: size };
                    sizeMap[size][store] = (sizeMap[size][store] || 0) + qty;
                }
            });
        });

        const totalOf = (entry) => storeList.reduce((sum, s) => sum + (entry[s] || 0), 0);

        const topProducts = Object.values(productMap).sort((a, b) => totalOf(b) - totalOf(a)).slice(0, 6);
        const topColors = Object.values(colorMap).sort((a, b) => totalOf(b) - totalOf(a)).slice(0, 6);

        const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL", "6XL"];
        const topSizes = Object.values(sizeMap).sort((a, b) => {
            const ai = SIZE_ORDER.indexOf(a.name);
            const bi = SIZE_ORDER.indexOf(b.name);
            if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
        });

        return { stores: storeList, topProducts, topColors, topSizes };
    }, [overviewOrders]); // eslint-disable-line react-hooks/exhaustive-deps

    // Resolves the "client" string for either channel: retail uses delivery_name,
    // B2B uses the vendor's store_brand_name (resolved via vendorMap). Returns
    // empty string if neither is available (caller decides the fallback dash).
    // Declared BEFORE the filter memos below, which call it when searching by
    // client name — a const isn't hoisted, so a later declaration would crash
    // (TDZ: "Cannot access before initialization") the moment you type a search.
    const getClientName = (order) => {
        if (order?.is_b2b) {
            const v = order.vendor_id ? vendorMap[order.vendor_id] : null;
            return v?.store_brand_name || order.delivery_name || "";
        }
        return order?.delivery_name || "";
    };

    // ==================== FILTERED + PAGINATED ORDERS ====================
    const filteredByStatus = useMemo(() => {
        return orders.filter(o => {
            // Channel is the shared classifier's label (Delhi Store, B2B, …) —
            // the old check was a b2b/store binary that could not express the
            // other channels the Delivery Report and badges already use.
            if (channelFilter !== "all" && getOrderChannelLabel(o) !== channelFilter) return false;
            const status = o.status?.toLowerCase();
            switch (statusTab) {
                case "unfulfilled": return status !== "completed" && status !== "delivered" && status !== "cancelled";
                case "completed": return status === "completed";
                case "delivered": return status === "delivered";
                case "cancelled": return status === "cancelled";
                default: return true;
            }
        });
    }, [orders, statusTab, channelFilter]);

    const filteredOrders = useMemo(() => {
        let result = filteredByStatus;
        if (orderSearch.trim()) {
            const q = orderSearch.trim().toLowerCase();
            result = result.filter(o => {
                switch (orderSearchField) {
                    case "product_name":
                        return (o.items || []).some(it => it?.product_name?.toLowerCase().includes(q));
                    case "client_name":
                        return getClientName(o).toLowerCase().includes(q);
                    case "phone":
                        return (o.delivery_phone || "").toLowerCase().includes(q);
                    case "po_number":
                        return (o.po_number || "").toLowerCase().includes(q);
                    case "shopify_order_name":
                        // Tolerate the "#" being typed or not — same rule as the
                        // Shopify dashboard's search.
                        return (o.shopify_order_name || "").toLowerCase().replace("#", "")
                            .includes(q.replace("#", ""));
                    case "order_no":
                    default:
                        return (o.order_no || "").toLowerCase().includes(q);
                }
            });
        }
        if (ordersPeriodRange) result = result.filter(o => inOrdersPeriod(o.created_at));
        if (filters.minPrice > 0 || filters.maxPrice < 500000) {
            result = result.filter(o => { const t = o.grand_total || 0; return t >= filters.minPrice && t <= filters.maxPrice; });
        }
        if (filters.payment.length > 0) result = result.filter(o => filters.payment.includes(getPaymentStatus(o)));
        if (filters.priority.length > 0) result = result.filter(o => filters.priority.includes(getPriority(o)));
        if (filters.salesperson) result = result.filter(o => o.salesperson === filters.salesperson);
        if (filters.stage.length > 0) result = result.filter(o => {
            const byStage = orderStageGroups[o.id];
            if (!byStage) return false;
            return filters.stage.some(k => {
                const kinds = byStage[k];
                if (!kinds) return false;
                if (filters.stageKind === "internal") return kinds.has("internal");
                if (filters.stageKind === "external") return kinds.has("external");
                return true; // 'both'
            });
        });
        // Disposed drill-down: keep only orders that have ≥1 disposed component.
        if (filters.disposedOnly) result = result.filter(o => disposedOrderIds.has(o.id));
        // Currently-running-late drill-down: same isOrderRunningLate rule as the
        // Currently Running Late card/list (dispatched/completed excluded).
        if (filters.delayedOnly) {
            const now = new Date();
            result = result.filter(o => isOrderRunningLate(o, now));
        }
        // Dispatched drill-down: from the Production Pipeline "Dispatched" row.
        if (filters.dispatchedOnly) {
            result = result.filter(o => (o.status || "").toLowerCase() === "dispatched" || o.warehouse_stage === "dispatched");
        }
        // Ready-for-dispatch drill-down: from the "Dispatch Backlog" card —
        // orders with ≥1 component at the packaging_dispatch stage.
        if (filters.dispatchReadyOnly) result = result.filter(o => dispatchReadyOrderIds.has(o.id));
        // Exact-set drill-down: the Production Stage Bottlenecks table hands over
        // the very order ids it counted, so the list can never disagree with the
        // number that was clicked. (The Stage filter above buckets by COMPONENT
        // stage groups, a different population — re-deriving there would drift.)
        if (filters.orderIdSet) result = result.filter(o => filters.orderIdSet.has(o.id));
        const getOrderNum = (no) => {
            const clean = (no || "").replace(/-[A-Z]\d*$/, "");
            const match = clean.match(/(\d{2})(\d{2})-(\d{6})$/);
            if (!match) return 0;
            return parseInt(match[2] + match[1] + match[3]);
        };

        result = [...result].sort((a, b) => {
            switch (sortBy) {
                case "oldest": return getOrderNum(a.order_no) - getOrderNum(b.order_no);
                case "delivery": return new Date(a.delivery_date || 0) - new Date(b.delivery_date || 0);
                case "amount_high": return (b.grand_total || 0) - (a.grand_total || 0);
                case "amount_low": return (a.grand_total || 0) - (b.grand_total || 0);
                default: return getOrderNum(b.order_no) - getOrderNum(a.order_no);
            }
        });
        return result;
        // vendorMap is a dep because client_name search resolves through it for B2B orders
        // orderStageGroups is a dep because the Stage filter matches on it (any-piece-at-stage)
    }, [filteredByStatus, orderSearch, orderSearchField, filters, sortBy, vendorMap, orderStageGroups, disposedOrderIds, dispatchReadyOrderIds, ordersPeriodRange, inOrdersPeriod]);

    const orderTabCounts = useMemo(() => {
        const base = channelFilter === "all" ? orders : orders.filter(o => getOrderChannelLabel(o) === channelFilter);
        return {
            all: base.length,
            unfulfilled: base.filter(o => { const s = o.status?.toLowerCase(); return s !== "completed" && s !== "delivered" && s !== "cancelled"; }).length,
            completed: base.filter(o => o.status?.toLowerCase() === "completed").length,
            delivered: base.filter(o => o.status?.toLowerCase() === "delivered").length,
            cancelled: base.filter(o => o.status?.toLowerCase() === "cancelled").length,
        };
    }, [orders, channelFilter]);

    const totalPages = Math.ceil(filteredOrders.length / ORDERS_PER_PAGE);
    const paginatedOrders = useMemo(() => {
        const start = (currentPage - 1) * ORDERS_PER_PAGE;
        return filteredOrders.slice(start, start + ORDERS_PER_PAGE);
    }, [filteredOrders, currentPage]);

    // ==================== HELPERS ====================
    const handleLogout = async () => { await supabase.auth.signOut(); navigate("/login"); };

    // Channel badge — the full channel model, not the old binary B2B/Store
    // (Comms, Private and Website orders all read as "Store" before).
    // Use the SHARED label helper rather than a local map. The map this replaced
    // had no `shopify` entry, so its `|| "Store"` default silently tagged every
    // Shopify order as a store order — the failure mode of duplicating a
    // channel list: a new channel is not a missing case, it is a WRONG one.
    // getOrderChannelLabel also splits offline into Delhi/Ludhiana, which is
    // more precise than the flat "Store" this used to show.
    const getChannelLabel = (order) => getOrderChannelLabel(order) || "Store";
    const getChannelClass = (order) => {
        const key = getOrderChannelKey(order);
        return `pm-channel-${key === "offline" ? "store" : key}`;
    };

    // Order status = the shared 5-step ladder, derived from the order's PIECES:
    //   Order Received -> In Production -> Completed -> Dispatched -> Delivered
    //
    // Replaces a local map that branched on orders.production_status — a column
    // no RPC writes. Every check against it failed, so real in-production orders
    // fell through to a literal "Pending", a status this system does not have.
    // The pieces are the truth: the moment one is scanned past Order Received,
    // the order IS in production.
    const getStatusLabel = (order) => getOrderProgressStatus(order, componentsByOrder[order.id]);

    const getStatusClass = (status) => `pm-status-${getOrderProgressStatusKey(status)}`;

    // ==================== MEASUREMENT HELPERS ====================
    const editCategoryKey = CATEGORY_KEY_MAP[editActiveCategory];

    const updateEditMeasurement = (categoryKey, field, value) => {
        setEditMeasurements((prev) => ({
            ...prev,
            [categoryKey]: { ...(prev[categoryKey] || {}), [field]: value },
        }));
    };

    const cleanMeasurements = (measurements) => {
        const cleaned = {};
        for (const [category, fields] of Object.entries(measurements || {})) {
            if (fields && typeof fields === "object") {
                const cleanedFields = {};
                for (const [field, value] of Object.entries(fields)) {
                    if (value !== "" && value !== null && value !== undefined) cleanedFields[field] = value;
                }
                if (Object.keys(cleanedFields).length > 0) cleaned[category] = cleanedFields;
            }
        }
        return cleaned;
    };

    // ==================== EDIT (PM can edit everything, no restrictions) ====================
    const openEditModal = (e, order) => {
        e.stopPropagation();
        const item = order.items?.[0] || {};

        let topColorVal = "";
        let bottomColorVal = "";
        if (typeof item.top_color === "object" && item.top_color !== null) topColorVal = item.top_color.name || "";
        else topColorVal = item.top_color || "";
        if (typeof item.bottom_color === "object" && item.bottom_color !== null) bottomColorVal = item.bottom_color.name || "";
        else bottomColorVal = item.bottom_color || "";

        setEditFormData({
            product_name: item.product_name || "",
            top: item.top || "",
            bottom: item.bottom || "",
            top_color: topColorVal,
            bottom_color: bottomColorVal,
            size: item.size || "",
            isKids: item.isKids || item.category === "Kids" || false,
            delivery_date: order.delivery_date?.slice(0, 10) || "",
            delivery_name: order.delivery_name || "",
            delivery_phone: order.delivery_phone || "",
            delivery_address: order.delivery_address || "",
            delivery_city: order.delivery_city || "",
            delivery_state: order.delivery_state || "",
            delivery_pincode: order.delivery_pincode || "",
            mode_of_delivery: order.mode_of_delivery || "",
            status: order.status || "order_received",
            production_status: order.production_status || "",
            priority: order.priority || "",
            notes: order.notes || "",
        });
        setEditMeasurements(item.measurements || {});
        setEditActiveCategory("Kurta/Choga/Kaftan");
        setEditingOrder(order);
    };

    const handleSaveEdit = async () => {
        if (!editingOrder) return;
        setActionLoading(editingOrder.id);
        try {
            const topColorObj = colors.find(c => c.name === editFormData.top_color) || { name: editFormData.top_color, hex: "#888" };
            const bottomColorObj = colors.find(c => c.name === editFormData.bottom_color) || { name: editFormData.bottom_color, hex: "#888" };
            const cleanedMeasurements = cleanMeasurements(editMeasurements);

            const updatedItems = editingOrder.items?.map((item, i) => {
                if (i === 0) {
                    return {
                        ...item,
                        product_name: editFormData.product_name,
                        size: editFormData.size,
                        top: editFormData.top,
                        bottom: editFormData.bottom,
                        top_color: topColorObj,
                        bottom_color: bottomColorObj,
                        measurements: cleanedMeasurements,
                    };
                }
                return item;
            });

            const updatePayload = {
                items: updatedItems,
                delivery_date: editFormData.delivery_date,
                delivery_name: editFormData.delivery_name,
                delivery_phone: editFormData.delivery_phone,
                delivery_address: editFormData.delivery_address,
                delivery_city: editFormData.delivery_city,
                delivery_state: editFormData.delivery_state,
                delivery_pincode: editFormData.delivery_pincode,
                mode_of_delivery: editFormData.mode_of_delivery,
                status: editFormData.status,
                production_status: editFormData.production_status || null,
                priority: editFormData.priority || null,
                notes: editFormData.notes || null,
                updated_at: new Date().toISOString(),
                warehouse_url: null,
                warehouse_urls: null,
                customer_url: null,
            };

            // Delete old PDFs to force regeneration
            try {
                const orderNo = editingOrder.order_no;
                if (orderNo) {
                    await supabase.storage.from("invoices").remove([`orders/${orderNo}_customer.pdf`]);
                    const items = editingOrder.items || [];
                    for (let i = 0; i < items.length; i++) {
                        await supabase.storage.from("invoices").remove([`orders/${orderNo}_warehouse_${i + 1}.pdf`]);
                    }
                }
            } catch (err) { /* PDF cleanup failed */ }

            const { error } = await supabase.from("orders").update(updatePayload).eq("id", editingOrder.id);
            if (error) throw error;

            // Fetch fresh data from DB
            const { data: freshOrder } = await supabase.from("orders").select("*").eq("id", editingOrder.id).single();
            if (freshOrder) {
                setOrders(prev => prev.map(o => o.id === editingOrder.id ? freshOrder : o));
            }

            setEditingOrder(null);
            setEditMeasurements({});
            showPopup({ type: "success", title: "Order Updated", message: `Order #${editingOrder.order_no} updated successfully!`, confirmText: "OK" });
        } catch (err) {
            console.error("Save edit error:", err);
            showPopup({ type: "error", title: "Error", message: "Failed to save: " + err.message, confirmText: "OK" });
        } finally { setActionLoading(null); }
    };

    // ==================== PRIORITY ====================
    const openPriorityModal = (e, order) => { e.stopPropagation(); setPriorityOrder(order); setPriorityValue(order.priority || ""); };

    const handleSavePriority = async () => {
        if (!priorityOrder) return;
        setActionLoading(priorityOrder.id);
        try {
            const { error } = await supabase.from("orders").update({ priority: priorityValue, updated_at: new Date().toISOString() }).eq("id", priorityOrder.id);
            if (error) throw error;
            setOrders(prev => prev.map(o => o.id === priorityOrder.id ? { ...o, priority: priorityValue } : o));
            setPriorityOrder(null);
            showPopup({ type: "success", title: "Priority Updated", message: `Priority set to "${priorityValue || "Normal"}"`, confirmText: "OK" });
        } catch (err) { showPopup({ type: "error", title: "Error", message: err.message, confirmText: "OK" }); }
        finally { setActionLoading(null); }
    };

    const viewOrderDetails = (order) => {
        navigate(`/order/${order.id}`, { state: { fromProductionManager: true } });
    };

    // Row click on the REPORTING tabs (Production, Dispatch, Delivery Report,
    // Calendar). These lists are for scanning and acting, so a click hands the
    // order to All Orders — where the full card, its component journey and every
    // action already live — instead of pushing the read-only Order Details page
    // and dropping the user out of the dashboard.
    //
    // goToOrder resets the period + filters, so the target can never land
    // outside the current All Orders scope and render an empty list.
    const openOrderInList = (order) => goToOrder(order.id, order.order_no);

    if (loading) return <p className="loading-text">Loading Dashboard...</p>;

    return (
        <>
            {PopupComponent}

            {/* Which products to Mark as Completed — shared picker (same as the
                Warehouse / B2B Production / B2B Merchandiser dashboards). */}
            {completePicker && (
                <CompletePicker
                    order={completePicker.order}
                    components={componentsByOrder[completePicker.order.id] || []}
                    productIdxs={completePicker.products}
                    onConfirm={(picked) => markManualComplete(completePicker.order, null, picked)}
                    onClose={() => setCompletePicker(null)}
                />
            )}

            {journeyOrder && (
                <ComponentJourneyModal
                    orderNo={journeyOrder.order_no}
                    components={journeyOrder.components}
                    onClose={() => setJourneyOrder(null)}
                />
            )}

            {/* ===== EDIT MODAL ===== */}
            {editingOrder && (
                <div className="pm-edit-modal">
                    <div className="pm-edit-box">
                        <h3>Edit Order — {editingOrder.order_no}</h3>
                        <button className="pm-close-modal" onClick={() => { setEditingOrder(null); setEditMeasurements({}); }}>✕</button>
                        <div className="pm-edit-form">

                            {/* Category Badge */}
                            <div style={{ marginBottom: 12, padding: "6px 12px", background: editFormData.isKids ? "#e8f5e9" : "#fce4ec", borderRadius: 4, display: "inline-block", fontSize: 13, fontWeight: 500, color: editFormData.isKids ? "#2e7d32" : "#c2185b" }}>
                                Category: {editFormData.isKids ? "Kids" : "Women"}
                            </div>

                            <p className="pm-edit-section-title">Product Details</p>
                            <div className="pm-edit-row">
                                <div className="pm-edit-field"><label>Product Name</label><input type="text" value={editFormData.product_name} onChange={(e) => setEditFormData({ ...editFormData, product_name: e.target.value })} /></div>
                            </div>

                            {/* Top & Bottom with Color Dropdowns */}
                            <div className="pm-edit-row">
                                <div className="pm-edit-field"><label>Top</label><input type="text" value={editFormData.top} onChange={(e) => setEditFormData({ ...editFormData, top: e.target.value })} /></div>
                                <div className="pm-edit-field"><label>Top Color</label>
                                    <select value={editFormData.top_color} onChange={(e) => setEditFormData({ ...editFormData, top_color: e.target.value })}>
                                        <option value="">Select Color</option>
                                        {colors.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="pm-edit-row">
                                <div className="pm-edit-field"><label>Bottom</label><input type="text" value={editFormData.bottom} onChange={(e) => setEditFormData({ ...editFormData, bottom: e.target.value })} /></div>
                                <div className="pm-edit-field"><label>Bottom Color</label>
                                    <select value={editFormData.bottom_color} onChange={(e) => setEditFormData({ ...editFormData, bottom_color: e.target.value })}>
                                        <option value="">Select Color</option>
                                        {colors.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                                    </select>
                                </div>
                            </div>

                            {/* Size - Kids vs Women */}
                            <div className="pm-edit-row">
                                <div className="pm-edit-field"><label>Size</label>
                                    <select value={editFormData.size} onChange={(e) => setEditFormData({ ...editFormData, size: e.target.value })}>
                                        <option value="">Select Size</option>
                                        {(editFormData.isKids ? KIDS_SIZE_OPTIONS : WOMEN_SIZE_OPTIONS).map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                            </div>

                            <p className="pm-edit-section-title">Status & Priority</p>
                            <div className="pm-edit-row">
                                <div className="pm-edit-field"><label>Order Status</label>
                                    <select value={editFormData.status} onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })}>
                                        <option value="order_received">Order Received</option><option value="completed">Completed</option><option value="dispatched">Dispatched</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option>
                                    </select>
                                </div>
                                <div className="pm-edit-field"><label>Production Status</label>
                                    <select value={editFormData.production_status} onChange={(e) => setEditFormData({ ...editFormData, production_status: e.target.value })}>
                                        <option value="">Not Set</option><option value="pending_production">Pending Production</option><option value="in_production">In Production</option><option value="ready_for_dispatch">Ready for Dispatch</option><option value="dispatched">Dispatched</option>
                                    </select>
                                </div>
                            </div>
                            <div className="pm-edit-row">
                                <div className="pm-edit-field"><label>Priority</label>
                                    <select value={editFormData.priority} onChange={(e) => setEditFormData({ ...editFormData, priority: e.target.value })}>
                                        <option value="">Normal</option><option value="high">High</option><option value="urgent">Urgent</option><option value="low">Low</option>
                                    </select>
                                </div>
                                <div className="pm-edit-field"><label>Notes</label><input type="text" value={editFormData.notes} onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })} placeholder="Internal notes..." /></div>
                            </div>

                            <p className="pm-edit-section-title">Delivery Details</p>
                            <div className="pm-edit-row">
                                <div className="pm-edit-field"><label>Delivery Date</label><input type="date" value={editFormData.delivery_date} onChange={(e) => setEditFormData({ ...editFormData, delivery_date: e.target.value })} /></div>
                                <div className="pm-edit-field"><label>Mode of Delivery</label>
                                    <select value={editFormData.mode_of_delivery} onChange={(e) => setEditFormData({ ...editFormData, mode_of_delivery: e.target.value })}>
                                        <option value="Home Delivery">Home Delivery</option><option value="Delhi Store">Delhi Store</option><option value="Ludhiana Store">Ludhiana Store</option>
                                    </select>
                                </div>
                            </div>
                            <div className="pm-edit-row">
                                <div className="pm-edit-field"><label>Client Name</label><input type="text" value={editFormData.delivery_name} onChange={(e) => setEditFormData({ ...editFormData, delivery_name: e.target.value })} /></div>
                                <div className="pm-edit-field"><label>Client Phone</label><input type="text" value={editFormData.delivery_phone} onChange={(e) => setEditFormData({ ...editFormData, delivery_phone: e.target.value })} /></div>
                            </div>
                            <div className="pm-edit-field pm-edit-full"><label>Delivery Address</label><input type="text" value={editFormData.delivery_address} onChange={(e) => setEditFormData({ ...editFormData, delivery_address: e.target.value })} /></div>
                            <div className="pm-edit-row">
                                <div className="pm-edit-field"><label>City</label><input type="text" value={editFormData.delivery_city} onChange={(e) => setEditFormData({ ...editFormData, delivery_city: e.target.value })} /></div>
                                <div className="pm-edit-field"><label>State</label><input type="text" value={editFormData.delivery_state} onChange={(e) => setEditFormData({ ...editFormData, delivery_state: e.target.value })} /></div>
                                <div className="pm-edit-field"><label>Pincode</label><input type="text" value={editFormData.delivery_pincode} onChange={(e) => setEditFormData({ ...editFormData, delivery_pincode: e.target.value })} /></div>
                            </div>

                            {/* ===== MEASUREMENTS SECTION ===== */}
                            <p className="pm-edit-section-title">Custom Measurements (in)</p>
                            <div className="pm-measure-container">
                                <div className="pm-measure-menu">
                                    {measurementCategories.map((cat) => (
                                        <div key={cat} className={`pm-measure-item ${editActiveCategory === cat ? "active" : ""}`} onClick={() => setEditActiveCategory(cat)}>
                                            {cat}
                                        </div>
                                    ))}
                                </div>
                                <div className="pm-measure-fields">
                                    <div className="pm-measure-grid">
                                        {(measurementFields[editCategoryKey] || []).map((field) => (
                                            <div className="pm-measure-field" key={field}>
                                                <label>{field}</label>
                                                <input type="number" value={editMeasurements[editCategoryKey]?.[field] || ""} onChange={(e) => updateEditMeasurement(editCategoryKey, field, e.target.value)} />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="pm-edit-actions">
                                <button className="pm-edit-cancel" onClick={() => { setEditingOrder(null); setEditMeasurements({}); }}>Cancel</button>
                                <button className="pm-edit-save" onClick={handleSaveEdit} disabled={actionLoading === editingOrder.id}>{actionLoading === editingOrder.id ? "Saving..." : "Save Changes"}</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== PRIORITY MODAL ===== */}
            {priorityOrder && (
                <div className="pm-edit-modal">
                    <div className="pm-edit-box" style={{ maxWidth: 400 }}>
                        <h3>Set Priority — {priorityOrder.order_no}</h3>
                        <button className="pm-close-modal" onClick={() => setPriorityOrder(null)}>✕</button>
                        <div className="pm-edit-form">
                            <div className="pm-edit-field"><label>Priority Level</label>
                                <select value={priorityValue} onChange={(e) => setPriorityValue(e.target.value)}>
                                    <option value="">Normal</option><option value="urgent">Urgent</option>
                                </select>
                            </div>
                            <div className="pm-edit-actions">
                                <button className="pm-edit-cancel" onClick={() => setPriorityOrder(null)}>Cancel</button>
                                <button className="pm-edit-save" onClick={handleSavePriority} disabled={actionLoading === priorityOrder.id}>{actionLoading === priorityOrder.id ? "Saving..." : "Set Priority"}</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className={`pm-dashboard-wrapper ${editingOrder || priorityOrder ? "pm-blurred" : ""}`}>
                {/* ===== HEADER ===== */}
                <header className="pm-header">
                    <div className="pm-header-left">
                        <div className="pm-hamburger-icon" onClick={() => setShowSidebar(!showSidebar)}><div className="pm-bar"></div><div className="pm-bar"></div><div className="pm-bar"></div></div>
                        <img src={Logo} alt="logo" className="pm-header-logo" onClick={() => setActiveTab("overview")} />
                    </div>
                    <h1 className="pm-header-title">Production Manager</h1>
                    <div className="pm-header-right">
                        <NotificationBell
                            userEmail={currentUserEmail}
                            onOrderClick={(orderId, orderNo) => {
                                // Switch to All Orders tab, highlight + scroll to the order card
                                setActiveTab("orders");
                                setOrderSearch(orderNo || "");
                                setCurrentPage(1);
                                setHighlightOrderId(orderId);
                                setTimeout(() => {
                                    const card = document.querySelector(`[data-order-id="${orderId}"]`);
                                    if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
                                }, 350);
                                // Auto-clear highlight after a few seconds
                                setTimeout(() => setHighlightOrderId(null), 4000);
                            }}
                        />
                        <button className="pm-header-btn" onClick={handleLogout}>Logout</button>
                    </div>
                </header>

                {/* ===== GRID LAYOUT ===== */}
                <div className={`pm-grid-layout ${showSidebar ? "pm-sidebar-open" : ""}`}>
                    <aside className={`pm-sidebar ${showSidebar ? "pm-open" : ""}`}>
                        <nav className="pm-menu">
                            <a className={`pm-menu-item ${activeTab === "overview" ? "active" : ""}`} onClick={() => { setActiveTab("overview"); setShowSidebar(false); }}>Overview</a>
                            <a className={`pm-menu-item ${activeTab === "orders" ? "active" : ""}`} onClick={() => { setActiveTab("orders"); setShowSidebar(false); }}>All Orders <span className="pm-badge-count">{orders.length}</span></a>
                            <a className={`pm-menu-item ${activeTab === "production" ? "active" : ""}`} onClick={() => { setActiveTab("production"); setShowSidebar(false); }}>Production</a>
                            {/* Opening QC History from the menu shows ALL records —
                                clear any Fail scope left by the KPI drill-down. */}
                            <a className={`pm-menu-item ${activeTab === "qc_history" ? "active" : ""}`} onClick={() => { setQcResultFilter(""); setActiveTab("qc_history"); setShowSidebar(false); }}>QC History</a>
                            <a className={`pm-menu-item ${activeTab === "rejourneys" ? "active" : ""}`} onClick={() => { setActiveTab("rejourneys"); setShowSidebar(false); }}>Re-journeys</a>
                            <a className={`pm-menu-item ${activeTab === "delivery_report" ? "active" : ""}`} onClick={() => { setActiveTab("delivery_report"); setSubTab("dispatch"); setShowSidebar(false); }}>Delivery Report</a>
                            <a className={`pm-menu-item ${activeTab === "overrides" ? "active" : ""}`} onClick={() => { setActiveTab("overrides"); setShowSidebar(false); }}>Scan & Overrides</a>
                            <a className={`pm-menu-item ${activeTab === "vendors" ? "active" : ""}`} onClick={() => { setActiveTab("vendors"); setSubTab("directory"); setShowSidebar(false); }}>Vendors</a>
                            <a className={`pm-menu-item ${activeTab === "replacements" ? "active" : ""}`} onClick={() => { setActiveTab("replacements"); setShowSidebar(false); }}>Replacement Approvals</a>
                            <a className={`pm-menu-item ${activeTab === "calendar" ? "active" : ""}`} onClick={() => { setActiveTab("calendar"); setShowSidebar(false); }}>Calendar</a>
                            <a className={`pm-menu-item ${activeTab === "staff" ? "active" : ""}`} onClick={() => { setActiveTab("staff"); setShowSidebar(false); }}>Staff</a>
                            <a className={`pm-menu-item ${activeTab === "profile" ? "active" : ""}`} onClick={() => { setActiveTab("profile"); setShowSidebar(false); }}>Profile</a>
                            <a className="pm-menu-item-logout" onClick={handleLogout}>Log Out</a>
                        </nav>
                    </aside>

                    <main className="pm-main-content">
                        {/* ===== OVERVIEW TAB ===== */}
                        {activeTab === "overview" && (
                            <>
                                {/* ===== ORDERS BY PRODUCTION STAGE (click a card to drill into the orders list) ===== */}
                                <div className="pm-overview-head">
                                    <p className="pm-card-title" style={{ margin: 0, color: "#8B7355" }}>Production Stages (Components)</p>
                                </div>
                                {overviewPeriodControl}
                                <StageCountCards components={overviewComponents} orderStatusById={orderStatusById} onStageClick={handleStageCardClick} />

                                {/* ===== BUSINESS METRICS SECTION (scoped to the selected period) ===== */}
                                <p className="pm-card-title" style={{ margin: "4px 0 10px 2px", color: "#8B7355" }}>Business Performance</p>
                                <div className="pm-stats-row-3">
                                    <StatCard
                                        title={`Revenue (${overviewPeriodLabel})`}
                                        value={`\u20B9${formatIndianNumber(Math.round(salesMetrics.revenuePeriod))}`}
                                        subtitle={`${overviewOrders.length} order${overviewOrders.length === 1 ? "" : "s"} placed`}
                                        highlight={true}
                                        icon={Icons.rupee}
                                    />
                                    <StatCard
                                        title="Top Product"
                                        value={salesMetrics.topProduct.count > 0 ? `${salesMetrics.topProduct.count} pcs` : "\u2014"}
                                        subtitle={salesMetrics.topProduct.name}
                                        icon={Icons.trendingUp}
                                    />
                                    <StatCard
                                        title="In-Progress / Delayed"
                                        value={`${salesMetrics.pendingCount} / ${salesMetrics.delayedCount}`}
                                        subtitle={salesMetrics.delayedCount > 0 ? `View ${salesMetrics.delayedCount} past delivery date` : salesMetrics.pendingCount > 0 ? "View in-progress orders" : "All on track"}
                                        highlight={salesMetrics.delayedCount > 0}
                                        icon={Icons.clock}
                                        onClick={salesMetrics.pendingCount > 0 ? handlePendingDelayedClick : undefined}
                                    />
                                </div>
                                <div className="pm-stats-row-3">
                                    <StatCard
                                        title="Return Rate"
                                        value={`${salesMetrics.returnRate}%`}
                                        subtitle={`${salesMetrics.returnCount} returns \u00B7 ${salesMetrics.exchangeCount} exchanges`}
                                        highlight={Number(salesMetrics.returnRate) > 5}
                                        icon={Icons.rotate}
                                    />
                                    <StatCard
                                        title="Refunded Amount"
                                        value={`\u20B9${formatIndianNumber(Math.round(salesMetrics.refundedAmount))}`}
                                        subtitle="Total processed refunds"
                                        icon={Icons.wallet}
                                    />
                                    <StatCard
                                        title="Disposed"
                                        value={disposedCount}
                                        subtitle={disposedCount > 0 ? "View disposed components" : "No components disposed"}
                                        highlight={disposedCount > 0}
                                        icon={Icons.xCircle}
                                        onClick={disposedCount > 0 ? handleDisposedClick : undefined}
                                    />
                                </div>

                                {/* ===== PRODUCTION METRICS SECTION ===== */}
                                <p className="pm-card-title" style={{ margin: "18px 0 10px 2px", color: "#8B7355" }}>Production Overview</p>
                                <div className="pm-stats-row-3">
                                    <StatCard title="Total Orders (All Channels)" value={formatIndianNumber(channelBreakdownOv.total)} subtitle={`across ${channelBreakdownOv.segments.length} channels`} highlight={true} icon={Icons.package} />
                                    <StatCard title="Total Components" value={formatIndianNumber(overviewComponentCount)} subtitle={`across ${overviewOrders.length} order${overviewOrders.length === 1 ? "" : "s"}`} icon={Icons.layers} />
                                    <StatCard title="Production Load" value={`${productionMetricsOv.productionLoad.percentage}%`} subtitle={`${productionMetricsOv.productionLoad.active} in production`} icon={Icons.gear} />
                                </div>
                                <div className="pm-stats-row-3">
                                    <StatCard title="Bottlenecks" value={productionMetricsOv.bottlenecks.count} subtitle={productionMetricsOv.bottlenecks.count > 0 ? `${productionMetricsOv.bottlenecks.topBottleneck} · ${productionMetricsOv.bottlenecks.topOverdue} overdue · avg ${productionMetricsOv.bottlenecks.topAvgDays}d at stage` : "No overdue stages"} highlight={productionMetricsOv.bottlenecks.count > 0} icon={Icons.warning} />
                                    <StatCard title="Delayed Orders" value={productionMetricsOv.delayed} subtitle={productionMetricsOv.delayed > 0 ? `Delay rate: ${productionMetricsOv.delayRate}% ${"·"} View delayed orders` : `Delay rate: ${productionMetricsOv.delayRate}%`} highlight={productionMetricsOv.delayed > 0} icon={Icons.clock} onClick={productionMetricsOv.delayed > 0 ? handleDelayedClick : undefined} />
                                    <StatCard title="Re-journey %" value={`${productionMetricsOv.rework.percentage}%`} subtitle={`${productionMetricsOv.rework.totalReworks} piece${productionMetricsOv.rework.totalReworks === 1 ? "" : "s"} in rework ${"\u00B7"} View re-journeys`} highlight={productionMetricsOv.rework.totalReworks > 0} icon={Icons.refresh} onClick={() => setActiveTab("rejourneys")} />
                                </div>
                                <div className="pm-stats-row-3">
                                    <StatCard title="Dispatch Backlog" value={productionMetricsOv.dispatchBacklog.pending} subtitle={productionMetricsOv.dispatchBacklog.pending > 0 ? `${productionMetricsOv.dispatchBacklog.overdue} overdue ${"\u00B7"} ready to dispatch` : "Nothing awaiting dispatch"} highlight={productionMetricsOv.dispatchBacklog.overdue > 0} icon={Icons.truck} onClick={productionMetricsOv.dispatchBacklog.pending > 0 ? handleDispatchBacklogClick : undefined} />
                                </div>
                                <div className="pm-channel-card">
                                    <p className="pm-card-title">Orders by Channel</p>
                                    <div className="pm-channel-body">
                                        {channelBreakdownOv.segments.map((seg) => (
                                            <ChannelRow key={seg.label} label={seg.label} count={seg.count} percentage={seg.pct} color={seg.color} />
                                        ))}
                                    </div>
                                </div>
                                {/* ===== TOTAL ORDERS vs CURRENTLY RUNNING LATE (by channel) ===== */}
                                <p className="pm-card-title" style={{ margin: "18px 0 10px 2px", color: "#8B7355" }}>Orders vs Currently Running Late by Channel</p>
                                <div className="pm-chart-card">
                                    {channelOrdersVsLate.length === 0 ? (
                                        <p className="pm-chart-empty">No orders in this period</p>
                                    ) : (
                                        <ResponsiveContainer width="100%" height={320}>
                                            <BarChart data={channelOrdersVsLate} margin={{ top: 10, right: 20, left: 0, bottom: 40 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                                                <XAxis dataKey="name" interval={0} tick={{ fontSize: 11, fill: "#555" }} angle={-20} textAnchor="end" height={50} />
                                                <YAxis tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} allowDecimals={false} />
                                                <Tooltip
                                                    contentStyle={{ background: "#fff", border: "1px solid #e8e2d0", borderRadius: 10, fontSize: 12 }}
                                                    cursor={{ fill: "rgba(213, 184, 90, 0.08)" }}
                                                />
                                                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                                                <Bar dataKey="Total" name="Total orders" fill="#d5b85a" radius={[4, 4, 0, 0]} barSize={22} />
                                                <Bar dataKey="Late" name="Currently running late" fill="#c62828" radius={[4, 4, 0, 0]} barSize={22} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    )}
                                </div>
                                {/* Which channel the currently-running-late orders are coming from */}
                                {delayedByChannel.total > 0 && (
                                    <div className="pm-channel-card" style={{ marginTop: 18, borderLeft: "4px solid #c62828" }}>
                                        <p className="pm-card-title">Currently Running Late Orders by Channel <span className="pm-muted" style={{ fontSize: 12, fontWeight: 400 }}>({delayedByChannel.total} still open, past delivery date)</span></p>
                                        <div className="pm-channel-body">
                                            {delayedByChannel.rows.map(r => (
                                                <ChannelRow
                                                    key={r.key}
                                                    label={r.label}
                                                    count={r.count}
                                                    percentage={r.percentage}
                                                    color={r.color}
                                                    onClick={() => handleDelayedChannelClick(r.key)}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* ===== TOP SELLING CHARTS BY STORE ===== */}
                                <p className="pm-card-title" style={{ margin: "18px 0 10px 2px", color: "#8B7355" }}>Top Sellers by Store</p>
                                <div className="pm-charts-grid">
                                    {/* Top Products */}
                                    <div className="pm-chart-card">
                                        <p className="pm-chart-title">Top Selling Products</p>
                                        {topByStore.topProducts.length === 0 ? (
                                            <p className="pm-chart-empty">No delivered orders yet</p>
                                        ) : (
                                            <ResponsiveContainer width="100%" height={320}>
                                                <BarChart data={topByStore.topProducts} margin={{ top: 10, right: 20, left: 0, bottom: 70 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                                                    <XAxis
                                                        dataKey="name"
                                                        interval={0}
                                                        tick={{ fontSize: 10, fill: "#555" }}
                                                        angle={-30}
                                                        textAnchor="end"
                                                        height={70}
                                                        tickFormatter={(v) => v.length > 18 ? v.substring(0, 18) + "\u2026" : v}
                                                    />
                                                    <YAxis tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} allowDecimals={false} />
                                                    <Tooltip
                                                        contentStyle={{ background: "#fff", border: "1px solid #e8e2d0", borderRadius: 10, fontSize: 12 }}
                                                        cursor={{ fill: "rgba(213, 184, 90, 0.08)" }}
                                                    />
                                                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                                                    {topByStore.stores.map((store, i) => (
                                                        <Bar key={store} dataKey={store} fill={PM_CHART_COLORS[i % PM_CHART_COLORS.length]} radius={[4, 4, 0, 0]} barSize={18} />
                                                    ))}
                                                </BarChart>
                                            </ResponsiveContainer>
                                        )}
                                    </div>

                                    {/* Top Colors */}
                                    <div className="pm-chart-card">
                                        <p className="pm-chart-title">Top Selling Colors</p>
                                        {topByStore.topColors.length === 0 ? (
                                            <p className="pm-chart-empty">No delivered orders yet</p>
                                        ) : (
                                            <ResponsiveContainer width="100%" height={320}>
                                                <BarChart data={topByStore.topColors} margin={{ top: 10, right: 20, left: 0, bottom: 50 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                                                    <XAxis
                                                        dataKey="name"
                                                        interval={0}
                                                        tick={{ fontSize: 11, fill: "#555" }}
                                                        angle={-20}
                                                        textAnchor="end"
                                                        height={50}
                                                    />
                                                    <YAxis tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} allowDecimals={false} />
                                                    <Tooltip
                                                        contentStyle={{ background: "#fff", border: "1px solid #e8e2d0", borderRadius: 10, fontSize: 12 }}
                                                        cursor={{ fill: "rgba(213, 184, 90, 0.08)" }}
                                                    />
                                                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                                                    {topByStore.stores.map((store, i) => (
                                                        <Bar key={store} dataKey={store} fill={PM_CHART_COLORS[i % PM_CHART_COLORS.length]} radius={[4, 4, 0, 0]} barSize={18} />
                                                    ))}
                                                </BarChart>
                                            </ResponsiveContainer>
                                        )}
                                    </div>

                                    {/* Top Sizes */}
                                    <div className="pm-chart-card">
                                        <p className="pm-chart-title">Top Selling Sizes</p>
                                        {topByStore.topSizes.length === 0 ? (
                                            <p className="pm-chart-empty">No delivered orders yet</p>
                                        ) : (
                                            <ResponsiveContainer width="100%" height={320}>
                                                <BarChart data={topByStore.topSizes} margin={{ top: 10, right: 20, left: 0, bottom: 30 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                                                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#555" }} />
                                                    <YAxis tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} allowDecimals={false} />
                                                    <Tooltip
                                                        contentStyle={{ background: "#fff", border: "1px solid #e8e2d0", borderRadius: 10, fontSize: 12 }}
                                                        cursor={{ fill: "rgba(213, 184, 90, 0.08)" }}
                                                    />
                                                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                                                    {topByStore.stores.map((store, i) => (
                                                        <Bar key={store} dataKey={store} fill={PM_CHART_COLORS[i % PM_CHART_COLORS.length]} radius={[4, 4, 0, 0]} barSize={22} />
                                                    ))}
                                                </BarChart>
                                            </ResponsiveContainer>
                                        )}
                                    </div>
                                </div>

                                <div className="pm-bottom-row">
                                    <div className="pm-recent-card">
                                        <div className="pm-card-header"><p className="pm-card-title">Recent Orders</p><button className="pm-view-all-btn" onClick={() => setActiveTab("orders")}>View All</button></div>
                                        <div className="pm-recent-list">
                                            {recentOrdersOv.length === 0 ? <p className="pm-muted">No orders yet</p> : recentOrdersOv.map(order => {
                                                const sl = getStatusLabel(order);
                                                return (<div className="pm-recent-item" key={order.id} onClick={() => viewOrderDetails(order)} style={{ cursor: "pointer" }}><div className="pm-recent-top"><span className="pm-recent-orderno">{order.order_no || "—"}</span><span className={`pm-channel-tag ${getChannelClass(order)}`}>{getChannelLabel(order)}</span></div><div className="pm-recent-bottom"><span className="pm-recent-amount">₹{formatIndianNumber(order.grand_total || 0)}</span><span className={`pm-recent-status ${getStatusClass(sl)}`}>{sl}</span></div></div>);
                                            })}
                                        </div>
                                    </div>
                                    <div className="pm-pipeline-card">
                                        <p className="pm-card-title">Production Pipeline</p>
                                        <div className="pm-pipeline-body">
                                            {[{ label: "Order Received", count: statusStatsOv.orderReceived, cls: "pm-dot-pending", key: "order_received" }, { label: "In Production", count: statusStatsOv.inProd, cls: "pm-dot-inprod", key: "in_production" }, { label: "Completed", count: statusStatsOv.completed, cls: "pm-dot-ready", key: "completed" }, { label: "Dispatched", count: statusStatsOv.dispatched, cls: "pm-dot-dispatched", key: "dispatched" }, { label: "Delivered", count: statusStatsOv.delivered, cls: "pm-dot-delivered", key: "delivered" }].map(s => (
                                                <div className="pm-pipeline-stage pm-pipeline-clickable" key={s.label} role="button" tabIndex={0} onClick={() => handlePipelineClick(s.key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handlePipelineClick(s.key); } }} title={`View ${s.label} orders`} style={{ cursor: "pointer" }}><div className="pm-pipeline-label"><span className={`pm-pipeline-dot ${s.cls}`}></span><span>{s.label}</span></div><span className="pm-pipeline-count">{s.count}</span></div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}

                        {/* ===== ALL ORDERS TAB ===== */}
                        {activeTab === "orders" && (
                            <div className="pm-orders-tab">

                                {/* Row 1: Title + Export */}
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                                    <h2 className="pm-tab-title" style={{ margin: 0 }}>All Orders</h2>
                                    <button onClick={handleExportCSV} style={{ display: "flex", alignItems: "center", gap: 6, background: "#d5b85a", color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                        Export CSV
                                    </button>
                                </div>

                                {/* Row 2: Search + Channel + Sort */}
                                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
                                    <div style={{ flex: "1 1 220px", minWidth: 180 }}>
                                        <SearchByDropdown
                                            fields={[
                                                { value: "order_no", label: "Order Number" },
                                                { value: "product_name", label: "Product Name" },
                                                { value: "client_name", label: "Client Name" },
                                                { value: "phone", label: "Phone" },
                                                { value: "po_number", label: "PO Number" },
                                                { value: "shopify_order_name", label: "Shopify Order No" },
                                            ]}
                                            selectedField={orderSearchField}
                                            onFieldChange={setOrderSearchField}
                                            query={orderSearch}
                                            onQueryChange={setOrderSearch}
                                            placeholder="Type to search..."
                                        />
                                    </div>
                                    {/* The one channel filter for this list (Shopify included).
                                        CHANNEL_SEGMENTS ends with a bare "Store" fallback used
                                        only to label orders whose prefix is unknown — it is not a
                                        real channel, so it is dropped from the picker. */}
                                    <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} className="pm-filter-select" style={{ flex: "0 0 auto" }}>
                                        <option value="all">All Channels</option>
                                        {CHANNEL_SEGMENTS.filter(seg => seg.label !== "Store").map(seg => (
                                            <option key={seg.label} value={seg.label}>{seg.label}</option>
                                        ))}
                                    </select>
                                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="pm-filter-select" style={{ flex: "0 0 auto" }}>
                                        <option value="newest">Newest First</option>
                                        <option value="oldest">Oldest First</option>
                                        <option value="delivery">Delivery Date</option>
                                        <option value="amount_high">Amount: High to Low</option>
                                        <option value="amount_low">Amount: Low to High</option>
                                    </select>
                                </div>

                                {/* Row 3: Status Tabs */}
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                                    {STATUS_TABS.map(tab => (
                                        <button key={tab.value} onClick={() => setStatusTab(tab.value)} style={{ padding: "6px 14px", borderRadius: 20, border: "1px solid", fontSize: 13, cursor: "pointer", fontWeight: statusTab === tab.value ? 700 : 400, background: statusTab === tab.value ? "#d5b85a" : "#fff", color: statusTab === tab.value ? "#fff" : "#555", borderColor: statusTab === tab.value ? "#d5b85a" : "#ddd" }}>
                                            {tab.label} <span style={{ marginLeft: 4, background: statusTab === tab.value ? "rgba(255,255,255,0.3)" : "#f0f0f0", color: statusTab === tab.value ? "#fff" : "#666", borderRadius: 10, padding: "1px 7px", fontSize: 11 }}>{orderTabCounts[tab.value]}</span>
                                        </button>
                                    ))}
                                </div>

                                {/* Row 4: Filter Bar (all inline) */}
                                <div ref={dropdownRef} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                                    {/* Date Range \u2014 one plain dropdown, no nested panel. Picking
                                        "Custom range" reveals the two date inputs inline. */}
                                    <div className={`pm-period-inline ${ordersTimeline !== "all" ? "pm-filter-active" : ""}`}>
                                        <PeriodFilter {...ordersPeriodProps} variant="select" label="Date Range:" />
                                    </div>

                                    {/* Price */}
                                    <div style={{ position: "relative" }}>
                                        <button className={`pm-filter-select ${(filters.minPrice > 0 || filters.maxPrice < 500000) ? "pm-filter-active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "price" ? null : "price")} style={{ cursor: "pointer" }}>Price {"\u25BE"}</button>
                                        {openDropdown === "price" && (
                                            <div className="pm-dropdown-panel">
                                                <div className="pm-dropdown-title">Order Value</div>
                                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                                    <div style={{ display: "flex", alignItems: "center", gap: 4, border: "1px solid #ddd", borderRadius: 6, padding: "4px 8px" }}><span style={{ color: "#888" }}>{"₹"}</span><input type="number" value={filters.minPrice} onChange={(e) => setFilters(prev => ({ ...prev, minPrice: Math.min(Number(e.target.value), prev.maxPrice - 1000) }))} style={{ width: 80, border: "none", outline: "none", fontSize: 13 }} /></div>
                                                    <span>to</span>
                                                    <div style={{ display: "flex", alignItems: "center", gap: 4, border: "1px solid #ddd", borderRadius: 6, padding: "4px 8px" }}><span style={{ color: "#888" }}>{"₹"}</span><input type="number" value={filters.maxPrice} onChange={(e) => setFilters(prev => ({ ...prev, maxPrice: Math.max(Number(e.target.value), prev.minPrice + 1000) }))} style={{ width: 80, border: "none", outline: "none", fontSize: 13 }} /></div>
                                                </div>
                                                <button className="pm-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Payment */}
                                    <div style={{ position: "relative" }}>
                                        <button className={`pm-filter-select ${filters.payment.length > 0 ? "pm-filter-active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "payment" ? null : "payment")} style={{ cursor: "pointer" }}>Payment {"\u25BE"}</button>
                                        {openDropdown === "payment" && (
                                            <div className="pm-dropdown-panel">
                                                <div className="pm-dropdown-title">Payment Status</div>
                                                {["paid", "partial", "unpaid"].map(opt => (
                                                    <label key={opt} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", fontSize: 13 }}>
                                                        <input type="checkbox" checked={filters.payment.includes(opt)} onChange={() => toggleFilter("payment", opt)} />
                                                        <span>{opt === "unpaid" ? "Unpaid (COD)" : opt.charAt(0).toUpperCase() + opt.slice(1)}</span>
                                                    </label>
                                                ))}
                                                <button className="pm-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Priority */}
                                    <div style={{ position: "relative" }}>
                                        <button className={`pm-filter-select ${filters.priority.length > 0 ? "pm-filter-active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "priority" ? null : "priority")} style={{ cursor: "pointer" }}>Priority {"\u25BE"}</button>
                                        {openDropdown === "priority" && (
                                            <div className="pm-dropdown-panel">
                                                <div className="pm-dropdown-title">Priority</div>
                                                {["normal", "urgent"].map(opt => (
                                                    <label key={opt} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", fontSize: 13 }}>
                                                        <input type="checkbox" checked={filters.priority.includes(opt)} onChange={() => toggleFilter("priority", opt)} />
                                                        <span>{opt.charAt(0).toUpperCase() + opt.slice(1)}</span>
                                                    </label>
                                                ))}
                                                <button className="pm-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                            </div>
                                        )}
                                    </div>

                                    {/* No "Store" filter here \u2014 the "All Channels" select above is
                                        the one channel filter (it already covers both stores,
                                        Shopify, B2B, Private, Comms, Exhibition and Stock). */}

                                    {/* Stage (10 V2 stages, by order's warehouse_stage) */}
                                    <div style={{ position: "relative" }}>
                                        <button className={`pm-filter-select ${filters.stage.length > 0 ? "pm-filter-active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "stage" ? null : "stage")} style={{ cursor: "pointer" }}>Stage {"▾"}</button>
                                        {openDropdown === "stage" && (
                                            <div className="pm-dropdown-panel">
                                                <div className="pm-dropdown-title">Production Stage</div>
                                                {STAGE_GROUPS.map(g => (
                                                    <label key={g.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", fontSize: 13 }}>
                                                        <input type="checkbox" checked={filters.stage.includes(g.key)} onChange={() => toggleFilter("stage", g.key)} />
                                                        <span>{g.label}</span>
                                                    </label>
                                                ))}
                                                <button className="pm-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Disposed — orders with a disposed component. Disposed pieces
                                        are excluded from stage grouping, so the Stage filter can't
                                        reach them; this toggle is their only filter path. */}
                                    <button
                                        className={`pm-filter-select ${filters.disposedOnly ? "pm-filter-active" : ""}`}
                                        onClick={() => setFilters(prev => ({ ...prev, disposedOnly: !prev.disposedOnly }))}
                                        style={{ cursor: "pointer" }}
                                    >Disposed{filters.disposedOnly ? " ✓" : ""}</button>

                                    {/* Salesperson */}
                                    <select className="pm-filter-select" value={filters.salesperson || ""} onChange={(e) => setFilters(prev => ({ ...prev, salesperson: e.target.value }))}>
                                        <option value="">All Salespersons</option>
                                        {salespersons.map(sp => <option key={sp} value={sp}>{sp}</option>)}
                                    </select>
                                </div>

                                {/* Applied Filter Chips */}
                                {appliedFilters.length > 0 && (
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                                        <span style={{ fontSize: 12, color: "#888", alignSelf: "center" }}>Applied:</span>
                                        {appliedFilters.map((chip, i) => (
                                            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#fff8e1", border: "1px solid #d5b85a", borderRadius: 12, padding: "3px 10px", fontSize: 12, color: "#8a6d00" }}>
                                                {chip.label}
                                                <button onClick={() => removeFilter(chip.type, chip.value)} style={{ background: "none", border: "none", cursor: "pointer", color: "#8a6d00", fontSize: 14, padding: 0, lineHeight: 1 }}>{"×"}</button>
                                            </span>
                                        ))}
                                        <button onClick={clearAllFilters} style={{ background: "none", border: "1px solid #ccc", borderRadius: 12, padding: "3px 10px", fontSize: 12, cursor: "pointer", color: "#666" }}>Clear All</button>
                                    </div>
                                )}

                                <div style={{ fontSize: 13, color: "#888", marginBottom: 10 }}>Showing {filteredOrders.length} orders</div>

                                <div className="pm-order-list-scroll">
                                    {filteredOrders.length === 0 && <p className="pm-muted" style={{ textAlign: "center", padding: 40 }}>No orders found.</p>}

                                    {paginatedOrders.map((order) => {
                                        const item = order.items?.[0] || {};
                                        const imgSrc = item.image_url || "/placeholder.png";
                                        const statusLabel = getStatusLabel(order);

                                        return (
                                            <div key={order.id} data-order-id={order.id} className={`pm-order-card ${highlightOrderId === order.id ? "pm-order-card-highlight" : ""}`} onClick={() => viewOrderDetails(order)} style={{ cursor: "pointer" }}>
                                                <div className="pm-order-header">
                                                    <div className="pm-oheader-info">
                                                        <div className="pm-oheader-item"><span className="pm-oheader-label">ORDER NO</span><span className="pm-oheader-value">{order.order_no || "—"}</span></div>
                                                        {/* Shopify's own number, beside ours — the same pairing the Shopify
                                                            dashboard and the warehouse PDF show, because the warehouse and
                                                            catalogue teams refer to website orders by THAT number. Gated on
                                                            the channel (like PO NUMBER is on is_b2b) so it appears only where
                                                            it exists; legacy SB-SHOP- orders resolve to the same channel. */}
                                                        {getOrderChannelKey(order) === "shopify" && (
                                                            <div className="pm-oheader-item"><span className="pm-oheader-label">SHOPIFY ORDER NO</span><span className="pm-oheader-value">{order.shopify_order_name || "—"}</span></div>
                                                        )}
                                                        <div className="pm-oheader-item"><span className="pm-oheader-label">ORDER DATE</span><span className="pm-oheader-value">{formatDate(order.created_at) || "—"}</span></div>
                                                        <div className="pm-oheader-item"><span className="pm-oheader-label">DELIVERY</span><span className="pm-oheader-value" title={`Warehouse deadline (T-2). Customer date: ${formatDate(order.delivery_date)}`}>{getWarehouseDate(order.delivery_date, order.created_at)}</span></div>
                                                        {/* PO number is a B2B-only field — gate on is_b2b like WarehouseDashboard and the warehouse PDF do. */}
                                                        {order.is_b2b && order.po_number && <div className="pm-oheader-item"><span className="pm-oheader-label">PO NUMBER</span><span className="pm-oheader-value">{order.po_number}</span></div>}
                                                    </div>
                                                    <div className="pm-oheader-actions">
                                                        <span className={`pm-channel-tag ${getChannelClass(order)}`}>{getChannelLabel(order)}</span>
                                                        {/* ORDER status — the shared ladder, never a component stage.
                                                            This used to render the warehouse_stage badge ("Cloth Issued"),
                                                            which answers "where is one piece", not "where is the order":
                                                            the per-component chips below the card already show the stage,
                                                            and an order whose pieces sit at different stages has no single
                                                            stage to show. One piece past Order Received = In Production. */}
                                                        {(() => {
                                                            const st = getOrderProgressStatus(order, componentsByOrder[order.id]);
                                                            return (
                                                                <span className={`pm-status-badge pm-status-${getOrderProgressStatusKey(st)}`}>{st}</span>
                                                            );
                                                        })()}
                                                        {order.priority && <span className={`pm-priority-tag pm-priority-${order.priority}`}>{order.priority === "urgent" ? "🔴" : order.priority === "high" ? "🟠" : "🟢"} {order.priority}</span>}
                                                    </div>
                                                </div>

                                                <div className="pm-order-content">
                                                    <div className="pm-product-thumb"><img src={imgSrc} alt={item.product_name || "Product"} /></div>
                                                    <div className="pm-product-details">
                                                        <div className="pm-product-name"><span className="pm-order-label">Product:</span><span className="pm-ovalue">{item.product_name || "—"}</span></div>
                                                        <div className="pm-product-name"><span className="pm-order-label">Client:</span><span className="pm-ovalue">{getClientName(order) || "—"}</span></div>
                                                        {/* Skip the store suffix when it just repeats the name. A Shopify
                                                            order has no human SA, so both fields read "Shopify" and the
                                                            row rendered "Shopify (Shopify)". */}
                                                        <div className="pm-product-name"><span className="pm-order-label">SA Name:</span><span className="pm-ovalue">{order.salesperson || "—"}{order.salesperson_store && order.salesperson_store !== order.salesperson ? ` (${order.salesperson_store})` : ""}</span></div>
                                                        <div className="pm-odetails-grid">
                                                            <div className="pm-odetail-item"><span className="pm-order-label">Amount:</span><span className="pm-ovalue">₹{formatIndianNumber(order.grand_total || 0)}</span></div>
                                                            <div className="pm-odetail-item"><span className="pm-order-label">Qty:</span><span className="pm-ovalue">{order.total_quantity || 1}</span></div>
                                                            <div className="pm-odetail-item"><span className="pm-order-label">Top:</span><span className="pm-ovalue">{item.top || "—"}{item.top_color?.hex && (<><span style={{ display: "inline-block", width: 12, height: 12, backgroundColor: item.top_color.hex, borderRadius: "50%", marginLeft: 6, border: "1px solid #ccc", verticalAlign: "middle" }} /><span style={{ marginLeft: 4 }}>{item.top_color.name}</span></>)}</span></div>
                                                            <div className="pm-odetail-item"><span className="pm-order-label">Bottom:</span><span className="pm-ovalue">{item.bottom || "—"}{item.bottom_color?.hex && (<><span style={{ display: "inline-block", width: 12, height: 12, backgroundColor: item.bottom_color.hex, borderRadius: "50%", marginLeft: 6, border: "1px solid #ccc", verticalAlign: "middle" }} /><span style={{ marginLeft: 4 }}>{item.bottom_color.name}</span></>)}</span></div>
                                                            <div className="pm-odetail-item"><span className="pm-order-label">Size:</span><span className="pm-ovalue">{item.size || "—"}</span></div>
                                                            <div className="pm-odetail-item"><span className="pm-order-label">Category:</span><span className="pm-ovalue">{item.isKids ? "Kids" : "Women"}</span></div>
                                                        </div>
                                                        {item.extras && item.extras.length > 0 && (
                                                            <div className="pm-odetail-item"><span className="pm-order-label">Extras:</span><span className="pm-ovalue">{item.extras.map((extra, idx) => (<span key={idx}>{extra.name}{extra.color?.hex && (<><span style={{ display: "inline-block", width: 12, height: 12, backgroundColor: extra.color.hex, borderRadius: "50%", marginLeft: 6, border: "1px solid #ccc", verticalAlign: "middle" }} /><span style={{ marginLeft: 4 }}>{extra.color.name}</span></>)}{idx < item.extras.length - 1 && <span style={{ margin: "0 8px" }}>|</span>}</span>))}</span></div>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Component journey — one chip per piece (TOP/BTM/DUP/extra)
                                                    with its current production stage, mirroring the warehouse view. */}
                                                {(componentsByOrder[order.id]?.length > 0) && (
                                                    <div className="pm-comp-journey">
                                                        {componentsByOrder[order.id].map((comp) => (
                                                            <div key={comp.id} className="pm-comp-card">
                                                                <div className="pm-comp-info">
                                                                    <span className="pm-comp-barcode">{comp.barcode}</span>
                                                                    <span className="pm-comp-label">{comp.component_label || comp.component_type}</span>
                                                                </div>
                                                                <ComponentStageBadge comp={comp} />
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Why-disposed strip — one line per disposed piece with
                                                    the stage it died at and the QC reason. */}
                                                {(componentsByOrder[order.id] || []).some((c) => c.current_stage === "disposed") && (
                                                    <div className="pm-disposed-note">
                                                        {componentsByOrder[order.id].filter((c) => c.current_stage === "disposed").map((c) => (
                                                            <div key={c.id} className="pm-disposed-line">
                                                                <b>{c.component_label || c.component_type || c.barcode}</b>
                                                                {" disposed"}
                                                                {c.previous_stage ? ` at ${getStageLabel(c.previous_stage) || c.previous_stage}` : ""}
                                                                {c.disposition_reason ? <> — <span className="pm-disposed-reason">{c.disposition_reason}</span></> : ""}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                <div className="pm-order-actions">
                                                    {(componentsByOrder[order.id]?.length > 0) && (
                                                        <button className="pm-action-btn pm-journey-btn" onClick={(e) => openJourney(e, order, componentsByOrder[order.id])}>View Journey</button>
                                                    )}
                                                    {/* A cancelled order can't be edited or re-prioritised. */}
                                                    {order.status !== "cancelled" && (
                                                        <>
                                                            <button className="pm-action-btn pm-edit-btn" onClick={(e) => openEditModal(e, order)}>Edit Order</button>
                                                            <button className="pm-action-btn pm-priority-btn" onClick={(e) => openPriorityModal(e, order)}>{order.priority ? `Priority: ${order.priority}` : "Set Priority"}</button>
                                                        </>
                                                    )}
                                                    {/* Production completion only — dispatch belongs to Packaging
                                                        (Aryadeep's flow), delivery to the SA flow. Final QC is
                                                        enforced by the RPC. */}
                                                    {!["completed", "delivered", "cancelled"].includes(order.status) && (
                                                        <button
                                                            className="pm-action-btn pm-manual-complete-btn"
                                                            disabled={actionLoading === order.id}
                                                            onClick={(e) => markManualComplete(order, e)}
                                                        >
                                                            {actionLoading === order.id ? "Marking..." : "Mark as Completed"}
                                                        </button>
                                                    )}
                                                    {/* <span className={`pm-recent-status ${getStatusClass(statusLabel)}`} style={{ marginLeft: "auto" }}>{statusLabel}</span> */}
                                                </div>
                                            </div>
                                        );
                                    })}

                                    <Paginator page={currentPage} totalPages={totalPages} onChange={setCurrentPage} />
                                </div>
                            </div>
                        )}

                        {/* ===== PRODUCTION TAB ===== */}
                        {activeTab === "production" && (
                            <div className="pm-orders-tab">
                                <h2 className="pm-tab-title">Production Tracking</h2>
                                <p className="pm-muted" style={{ margin: "-6px 0 4px 2px", fontSize: 12 }}>
                                    What is on the floor right now &mdash; where work is sitting, what is delayed, and where quality is failing.
                                </p>

                                {/* ===== PERIOD + CHANNEL (same bar as the other tabs) ===== */}
                                <PeriodFilter {...prodPeriodProps} variant="pills">
                                    <select
                                        className="pm-dispatch-channel"
                                        value={prodChannel}
                                        onChange={(e) => setProdChannel(e.target.value)}
                                    >
                                        <option value="all">All Channels</option>
                                        {CHANNEL_SEGMENTS.map(seg => (
                                            <option key={seg.label} value={seg.label}>{seg.label}</option>
                                        ))}
                                    </select>
                                    <button className="pm-dispatch-export" onClick={handleProductionExport}>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                        Export
                                    </button>
                                </PeriodFilter>

                                {/* TEMP (prod): per-stage component cards (barcode-derived) hidden —
                                    re-enable when scan flow is ready.
                                {stageStats.list.length > 0 && (
                                    <>
                                        <p className="pm-stage-cards-help">
                                            Live count of components at each warehouse stage —
                                            click any card to see which orders are there.
                                            <span className="pm-stage-total"> Total tracked: <b>{stageStats.total}</b></span>
                                        </p>
                                        <div className="pm-stage-cards-grid">
                                            {stageStats.list.map((s) => (
                                                <button
                                                    key={s.value}
                                                    type="button"
                                                    className="pm-stage-card"
                                                    style={{ "--stage-color": s.color }}
                                                    onClick={() => setStageDrillDown(s.value)}
                                                >
                                                    <span className="pm-stage-card-count">{s.count}</span>
                                                    <span className="pm-stage-card-label">{s.label}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                )}
                                */}

                                <div className="pm-stats-row-3">
                                    <StatCard title="In Production" value={statusStatsProd.inProd} subtitle={`of ${prodOrders.length} orders received`} icon={Icons.gear} />
                                    {/* QC Failures / Avg Lead Time read qc_records. While that
                                        paged fetch is in flight the values are null — show "—"
                                        rather than a 0 that reads as "no failures". */}
                                    <StatCard
                                        title="QC Failures"
                                        value={productionMetricsProd.qcFailed == null ? "—" : productionMetricsProd.qcFailed}
                                        subtitle={productionMetricsProd.qcFailed == null
                                            ? (qcHistoryLoading ? "Loading QC records…" : "No QC data")
                                            : `${productionMetricsProd.qcFailRate}% of ${productionMetricsProd.qcInspected} inspections ${"·"} View QC report`}
                                        highlight={productionMetricsProd.qcFailed > 0}
                                        icon={Icons.xCircle}
                                        onClick={productionMetricsProd.qcFailed > 0 ? handleQcFailuresClick : undefined}
                                    />
                                    <StatCard
                                        title="Avg Lead Time"
                                        value={productionMetricsProd.avgLeadTime == null ? "—" : `${productionMetricsProd.avgLeadTime}d`}
                                        subtitle={productionMetricsProd.avgLeadTime == null
                                            ? (qcHistoryLoading ? "Loading QC records…" : "No order has reached QC yet")
                                            : `Order to QC ${"·"} ${productionMetricsProd.leadTimeSample} order${productionMetricsProd.leadTimeSample === 1 ? "" : "s"}`}
                                        icon={Icons.timer}
                                    />
                                </div>
                                <div className="pm-stats-row-3">
                                    <StatCard
                                        title="Re-journey"
                                        value={productionMetricsProd.rework.totalReworks}
                                        subtitle={`${productionMetricsProd.rework.percentage}% of active pieces ${"·"} View re-journeys`}
                                        highlight={productionMetricsProd.rework.totalReworks > 0}
                                        icon={Icons.refresh}
                                        onClick={() => setActiveTab("rejourneys")}
                                    />
                                    <StatCard
                                        title="Delayed"
                                        value={productionMetricsProd.delayed}
                                        subtitle={`${productionMetricsProd.delayRate}% of orders still running ${"·"} View delayed orders`}
                                        highlight={productionMetricsProd.delayed > 0}
                                        icon={Icons.warning}
                                        onClick={productionMetricsProd.delayed > 0 ? handleDelayedClick : undefined}
                                    />
                                    <StatCard
                                        title="Orders Received"
                                        value={prodOrders.length}
                                        subtitle={`${statusStatsProd.dispatched + statusStatsProd.delivered} dispatched ${"·"} ${statusStatsProd.orderReceived} not started`}
                                        icon={Icons.inbox}
                                    />
                                </div>

                                {productionMetricsProd.stuckByStage.length > 0 && (
                                    <div className="pm-channel-card" style={{ marginTop: 20 }}>
                                        <p className="pm-card-title">Production Stage Bottlenecks</p>
                                        <p className="pm-muted" style={{ margin: "0 0 12px", fontSize: 12 }}>
                                            Where the {productionMetricsProd.stuckByStage.reduce((n, s) => n + s.total, 0)} orders still in production
                                            are sitting right now. Click any count to see those orders.
                                        </p>
                                        <div style={{ overflowX: "auto" }}>
                                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                                <thead>
                                                    <tr style={{ borderBottom: "2px solid #e0e0e0", textAlign: "left", background: "#fafafa" }}>
                                                        <th style={{ padding: "10px 12px" }}>Stage</th>
                                                        <th style={{ padding: "10px 12px", textAlign: "center" }}>Orders Here</th>
                                                        <th style={{ padding: "10px 12px", textAlign: "center" }} title="Past the T-2 warehouse deadline">Overdue</th>
                                                        <th style={{ padding: "10px 12px", textAlign: "center" }} title="Average time these orders have been parked at this stage">Avg Days at Stage</th>
                                                        <th style={{ padding: "10px 12px", textAlign: "center" }}>Status</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {productionMetricsProd.stuckByStage.map((s) => (
                                                        <tr key={s.key} style={{ borderBottom: "1px solid #f0f0f0", background: s.severity === "critical" ? "#fff5f5" : s.severity === "warning" ? "#fffde7" : "#fff" }}>
                                                            <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                                                                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: s.color, marginRight: 8 }} />
                                                                {s.name}
                                                            </td>
                                                            {/* Both counts drill into exactly the orders they represent. */}
                                                            <td style={{ padding: "10px 12px", textAlign: "center" }}>
                                                                <button className="pm-linkish" onClick={() => handleBottleneckClick(s, "total")} title={`View the ${s.total} orders at ${s.name}`}>{s.total}</button>
                                                            </td>
                                                            <td style={{ padding: "10px 12px", textAlign: "center" }}>
                                                                {s.overdue > 0 ? (
                                                                    <button className="pm-linkish pm-linkish-danger" onClick={() => handleBottleneckClick(s, "overdue")} title={`View the ${s.overdue} overdue orders at ${s.name}`}>
                                                                        {s.overdue} <span style={{ fontWeight: 400, fontSize: 11 }}>({s.overduePct}%)</span>
                                                                    </button>
                                                                ) : <span style={{ color: "#666" }}>—</span>}
                                                            </td>
                                                            <td style={{ padding: "10px 12px", textAlign: "center", color: s.avgDaysAtStage > 0 ? "#333" : "#666" }}>{s.avgDaysAtStage > 0 ? `${s.avgDaysAtStage}d` : "—"}</td>
                                                            <td style={{ padding: "10px 12px", textAlign: "center" }}>
                                                                {s.severity === "critical" && <span style={{ background: "#ffebee", color: "#c62828", borderRadius: 4, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>🔴 Critical</span>}
                                                                {s.severity === "warning" && <span style={{ background: "#fffde7", color: "#f57f17", borderRadius: 4, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>🟡 Watch</span>}
                                                                {s.severity === "normal" && <span style={{ background: "#e8f5e9", color: "#2e7d32", borderRadius: 4, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>🟢 OK</span>}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <p style={{ fontSize: 11, color: "#999", marginTop: 10, padding: "0 4px" }}>
                                            {"🔴 Critical = orders here are past the T-2 warehouse deadline · 🟡 Watch = 3+ orders piling up · 🟢 OK = on track. Dispatched, delivered, completed and cancelled orders are excluded."}
                                        </p>
                                    </div>
                                )}
                                {productionMetricsProd.stuckByStage.length === 0 && (
                                    <div className="pm-channel-card" style={{ marginTop: 20, textAlign: "center", padding: 32 }}>
                                        <p style={{ color: "#2e7d32", fontWeight: 600, fontSize: 15 }}>{"✅ No production bottlenecks detected"}</p>
                                        <p className="pm-muted" style={{ marginTop: 6 }}>All in-flow orders are on track</p>
                                    </div>
                                )}

                                {productionMetricsProd.exceedingDelivery.length > 0 && (
                                    <div className="pm-channel-card" style={{ marginTop: 20 }}>
                                        <p className="pm-card-title">{"\u26A0\uFE0F"} Exceeding Delivery Date ({productionMetricsProd.exceedingDelivery.length})</p>
                                        <div style={{ overflowX: "auto" }}>
                                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                                <thead><tr style={{ borderBottom: "2px solid #e0e0e0", textAlign: "left" }}><th style={{ padding: "8px 10px" }}>Order</th><th style={{ padding: "8px 10px" }}>Product</th><th style={{ padding: "8px 10px" }}>Delivery</th><th style={{ padding: "8px 10px" }}>Overdue</th><th style={{ padding: "8px 10px" }}>Stage</th><th style={{ padding: "8px 10px", textAlign: "center" }}>Actions</th></tr></thead>
                                                <tbody>{productionMetricsProd.exceedingDelivery.slice(0, 15).map(o => {
                                                    const overdue = Math.ceil((new Date() - new Date(o.delivery_date)) / (1000 * 60 * 60 * 24));
                                                    const isBusy = actionLoading === o.id;
                                                    return (<tr key={o.id} style={{ borderBottom: "1px solid #f0f0f0", cursor: "pointer" }} onClick={() => openOrderInList(o)}>
                                                        <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{o.order_no || "-"}</td>
                                                        <td style={{ padding: "8px 10px", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.items?.[0]?.product_name || "-"}</td>
                                                        <td style={{ padding: "8px 10px" }} title={`Customer date: ${formatDate(o.delivery_date)}`}>{getWarehouseDate(o.delivery_date, o.created_at)}</td>
                                                        <td style={{ padding: "8px 10px", color: "#c62828", fontWeight: 600 }}>{overdue}d</td>
                                                        <td style={{ padding: "8px 10px", textTransform: "capitalize" }}>{(o.warehouse_stage ? o.warehouse_stage.replace(/_/g, " ") : getOrderStatusLabel(o.status))}</td>
                                                        <td style={{ padding: "8px 10px", textAlign: "center", whiteSpace: "nowrap" }}>
                                                            <button
                                                                onClick={(e) => markManualComplete(o, e)}
                                                                disabled={isBusy}
                                                                className="pm-action-btn pm-action-complete"
                                                                title="Mark this order as completed (Final QC required)"
                                                            >
                                                                {isBusy ? "..." : "\u2713 Complete"}
                                                            </button>
                                                            <button
                                                                onClick={(e) => handleViewWarehousePdf(o, e)}
                                                                disabled={warehousePdfLoading === o.id}
                                                                className="pm-action-btn pm-action-view"
                                                                title="View warehouse PDF (generates if missing)"
                                                            >
                                                                {warehousePdfLoading === o.id ? "Generating..." : `\uD83D\uDCC4 View PDF`}
                                                            </button>
                                                        </td>
                                                    </tr>);
                                                })}</tbody>
                                            </table>
                                        </div>
                                        {/* The table is a top-15 summary; hand the full set to the
                                            orders list, where paging/search/filters already exist. */}
                                        {productionMetricsProd.exceedingDelivery.length > 15 && (
                                            <button className="pm-showall-btn" onClick={handleDelayedClick}>
                                                View all {productionMetricsProd.exceedingDelivery.length} delayed orders {"→"}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ===== QC HISTORY TAB (all channels) ===== */}
                        {activeTab === "qc_history" && (
                            <>
                                <p className="pm-card-title" style={{ margin: "0 0 14px 2px", color: "#8B7355" }}>
                                    QC History — {qcScope.channelLabel || "All Channels"}
                                    {QC_RESULT_SUFFIX[qcScope.result] && (
                                        <span className="pm-muted" style={{ fontSize: 12, fontWeight: 400 }}> · {QC_RESULT_SUFFIX[qcScope.result]}</span>
                                    )}
                                </p>
                                <QcHistoryPanel records={qcHistory} loading={qcHistoryLoading} onOrderClick={goToOrder} onScopeChange={setQcScope} initialResult={qcResultFilter} />
                            </>
                        )}

                        {/* ===== RE-JOURNEYS TAB (all channels) ===== */}
                        {activeTab === "rejourneys" && (
                            <>
                                <p className="pm-card-title" style={{ margin: "0 0 14px 2px", color: "#8B7355" }}>
                                    Re-journeys — Currently in Rework ({rjScope.channelLabel || "All Channels"})
                                </p>
                                <ReJourneyPanel rows={reJourneys} loading={reJourneysLoading} onOrderClick={goToOrder} onScopeChange={setRjScope} />
                            </>
                        )}

                        {/* ===== EXTERNAL VENDORS TAB (all channels) ===== */}
                        {/* ===== DELIVERY REPORT (Dispatch + Report sub-tabs) ===== */}
                        {activeTab === "delivery_report" && (
                            <div className="pm-subtab-bar">
                                <button className={`pm-subtab ${subTab === "dispatch" ? "active" : ""}`} onClick={() => setSubTab("dispatch")}>Dispatch</button>
                                <button className={`pm-subtab ${subTab === "report" ? "active" : ""}`} onClick={() => setSubTab("report")}>Delivery Report</button>
                            </div>
                        )}

                        {/* ===== DISPATCH sub-tab ===== */}
                        {/* The PM's outbound queue: what is packed and waiting to leave, how
                            urgent each one is, and what actually went out. Every figure comes
                            from order_components scans (dispatchData) — the orders.*_at columns
                            this tab used to read are never written by any RPC. */}
                        {activeTab === "delivery_report" && subTab === "dispatch" && (() => {
                            const d = dispatchData;
                            const q = dispatchSearch.trim().toLowerCase();
                            // Is a date/channel scope active? Empty states must say "nothing in
                            // this period" rather than "everything has shipped" — the two mean
                            // very different things to a PM.
                            const scoped = dispatchPeriodRange != null || dispatchChannel !== "all";
                            const matches = (o) => !q ||
                                (o.order_no || "").toLowerCase().includes(q) ||
                                getClientName(o).toLowerCase().includes(q) ||
                                (o.salesperson || "").toLowerCase().includes(q);

                            // Urgency filter. The deadline views (overdue / due today /
                            // partially ready) read the date-UNSCOPED set, so clicking a
                            // chip shows exactly the count on its own label and on the KPI
                            // card above it. Only the unfiltered "All" view follows the
                            // date filter, which is what that filter is for.
                            const urgencySource = dispatchFilter === "all" ? d.pending : d.pendingAll;
                            // "Due" uses the same deadline window as its KPI card: bounded
                            // by the selected period, or unbounded when no period is set.
                            const dueInPeriod = (p) => {
                                if (!p.warehouseDue) return false;
                                if (!dispatchPeriodRange) return true;
                                const t = p.warehouseDue.getTime();
                                return t >= dispatchPeriodRange.start.getTime() && t <= dispatchPeriodRange.end.getTime();
                            };
                            const pendingFiltered = urgencySource.filter(p => {
                                if (!matches(p.order)) return false;
                                if (dispatchFilter === "overdue") return p.overdue;
                                if (dispatchFilter === "due") return dueInPeriod(p);
                                if (dispatchFilter === "partial") return p.partial;
                                return true;
                            });
                            const dispatchedFiltered = d.dispatched.filter(x => matches(x.order));

                            const handleDispatchExport = () => {
                                if (pendingFiltered.length === 0) {
                                    showPopup({ type: "info", title: "Nothing to export", message: "No orders match the current filters." });
                                    return;
                                }
                                const headers = ["Order No", "Customer", "SA", "Channel", "Pieces Ready", "Stage", "Still in Production", "Ready Since", "Waiting (days)", "Dispatch By", "Customer Delivery", "Status"];
                                const rows = pendingFiltered.map(p => [
                                    p.order.order_no || "",
                                    getClientName(p.order) || "",
                                    p.order.salesperson || "",
                                    getChannelLabel(p.order),
                                    p.readyCount,
                                    p.readyStages.map(s => `${s.label} (${s.count})`).join(" + "),
                                    p.inProductionCount,
                                    p.readySince ? new Date(p.readySince).toLocaleDateString("en-GB") : "",
                                    p.waitDays == null ? "" : p.waitDays,
                                    p.warehouseDue ? p.warehouseDue.toLocaleDateString("en-GB") : "",
                                    formatDate(p.order.delivery_date) || "",
                                    p.overdue ? "Overdue" : p.daysToDue === 0 ? "Due today" : p.partial ? "Partially ready" : "On track",
                                ].map(v => `"${String(v).replace(/"/g, '""')}"`));
                                const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
                                const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                // Name the file after the scope it was taken under, so a
                                // downloaded export is never ambiguous about what it covers.
                                const scopeTag = dispatchChannel === "all" ? "all_channels" : dispatchChannel.toLowerCase().replace(/\s+/g, "_");
                                a.download = `dispatch_queue_${scopeTag}_${new Date().toISOString().slice(0, 10)}.csv`;
                                a.click();
                                URL.revokeObjectURL(url);
                            };

                            return (
                                <div className="pm-orders-tab">
                                    <h2 className="pm-tab-title">Dispatch Management</h2>
                                    <p className="pm-muted" style={{ margin: "-6px 0 4px 2px", fontSize: 12 }}>
                                        Orders that have finished production and are waiting to be dispatched.
                                    </p>

                                    {/* ===== PERIOD + CHANNEL =====
                                        Same pills bar the other dashboards use, channel select riding
                                        in its right-hand slot. Sits above the KPIs because it scopes
                                        every figure below it. */}
                                    <PeriodFilter {...dispatchPeriodProps} variant="pills">
                                        <select
                                            className="pm-dispatch-channel"
                                            value={dispatchChannel}
                                            onChange={(e) => setDispatchChannel(e.target.value)}
                                        >
                                            <option value="all">All Channels</option>
                                            {CHANNEL_SEGMENTS.map(seg => (
                                                <option key={seg.label} value={seg.label}>{seg.label}</option>
                                            ))}
                                        </select>
                                    </PeriodFilter>

                                    {/* ===== HEADLINE ===== */}
                                    <div className="pm-dispatch-hero">
                                        <div>
                                            <p className="pm-dispatch-hero-label">AWAITING DISPATCH</p>
                                            <p className="pm-dispatch-hero-value" style={{ color: d.pending.length > 0 ? "#8B7355" : "#2e7d32" }}>{d.pending.length}</p>
                                            <p className="pm-dispatch-hero-sub">{d.readyPieces} piece{d.readyPieces === 1 ? "" : "s"} ready across {d.pending.length} order{d.pending.length === 1 ? "" : "s"}</p>
                                        </div>
                                        <div style={{ textAlign: "right" }}>
                                            <p className="pm-dispatch-hero-label">ON-TIME DISPATCH</p>
                                            <p className="pm-dispatch-hero-value" style={{ color: d.onTimePct == null ? "#90a4ae" : d.onTimePct >= 80 ? "#2e7d32" : d.onTimePct >= 60 ? "#e65100" : "#c62828" }}>
                                                {d.onTimePct == null ? "—" : `${d.onTimePct}%`}
                                            </p>
                                            <p className="pm-dispatch-hero-sub">
                                                {d.onTimeSample > 0
                                                    ? `${d.onTimeOrders} of ${d.onTimeSample} orders on time`
                                                    : "no orders dispatched yet"}
                                            </p>
                                        </div>
                                    </div>

                                    {/* ===== KPI CARDS (click to filter the queue) ===== */}
                                    <div className="pm-dispatch-kpis">
                                        <StatCard
                                            title="Overdue Dispatch"
                                            value={d.overdueCount}
                                            subtitle={d.overdueCount > 0 ? "dispatch now" : "nothing overdue"}
                                            highlight={d.overdueCount > 0}
                                            icon={Icons.warning}
                                            onClick={d.overdueCount > 0 ? () => setDispatchFilter(dispatchFilter === "overdue" ? "all" : "overdue") : undefined}
                                        />
                                        <StatCard
                                            title="Due"
                                            value={d.dueCount}
                                            subtitle={d.periodScoped ? `due ${dispatchPeriodLabel.toLowerCase()}` : "due for dispatch"}
                                            highlight={d.dueCount > 0}
                                            icon={Icons.clock}
                                            onClick={d.dueCount > 0 ? () => setDispatchFilter(dispatchFilter === "due" ? "all" : "due") : undefined}
                                        />
                                        <StatCard
                                            title="Avg Wait to Dispatch"
                                            value={d.avgWait == null ? "—" : `${d.avgWait}d`}
                                            subtitle={d.oldestWait != null ? `oldest waiting ${d.oldestWait}d` : "nothing waiting"}
                                            highlight={d.oldestWait != null && d.oldestWait > 3}
                                            icon={Icons.hourglass}
                                        />
                                        <StatCard
                                            title="Dispatched"
                                            value={d.dispatchedInScope}
                                            subtitle={d.periodScoped ? `dispatched ${dispatchPeriodLabel.toLowerCase()}` : "dispatched all time"}
                                            icon={Icons.truck}
                                        />
                                        <StatCard
                                            title="Partially Ready"
                                            value={d.partialCount}
                                            subtitle="some pieces still in production"
                                            highlight={d.partialCount > 0}
                                            icon={Icons.layers}
                                            onClick={d.partialCount > 0 ? () => setDispatchFilter(dispatchFilter === "partial" ? "all" : "partial") : undefined}
                                        />
                                    </div>

                                    {/* ===== CONTROLS ===== */}
                                    <div className="pm-dispatch-controls">
                                        <div className="pm-dispatch-chips">
                                            {[
                                                { key: "all", label: `All (${d.pending.length})` },
                                                { key: "overdue", label: `Overdue (${d.overdueCount})` },
                                                { key: "due", label: `Due (${d.dueCount})` },
                                                { key: "partial", label: `Partially ready (${d.partialCount})` },
                                            ].map(f => (
                                                <button
                                                    key={f.key}
                                                    className={`pm-dispatch-chip ${dispatchFilter === f.key ? "active" : ""}`}
                                                    onClick={() => setDispatchFilter(f.key)}
                                                >
                                                    {f.label}
                                                </button>
                                            ))}
                                        </div>
                                        <input
                                            type="text"
                                            className="pm-dispatch-search"
                                            value={dispatchSearch}
                                            onChange={(e) => setDispatchSearch(e.target.value)}
                                            placeholder="Order no, customer, SA..."
                                        />
                                        <button className="pm-dispatch-export" onClick={handleDispatchExport}>
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                            Export Queue
                                        </button>
                                    </div>

                                    {/* ===== DISPATCH QUEUE ===== */}
                                    <div className="pm-channel-card">
                                        <p className="pm-card-title">
                                            Dispatch Queue ({pendingFiltered.length}{dispatchFilter !== "all" || q ? ` of ${d.pending.length}` : ""})
                                        </p>
                                        {pendingFiltered.length === 0 ? (
                                            <p className="pm-muted" style={{ textAlign: "center", padding: 24 }}>
                                                {d.pending.length > 0
                                                    ? "No orders match the current filters."
                                                    : scoped
                                                        ? "Nothing is waiting to be dispatched in this period / channel."
                                                        : "Nothing is waiting to be dispatched — every packed piece has gone out."}
                                            </p>
                                        ) : (
                                            <div className="pm-dispatch-table-wrap">
                                                <table className="pm-dispatch-table">
                                                    <thead>
                                                        <tr>
                                                            <th>Order</th>
                                                            <th>Customer</th>
                                                            <th>Channel</th>
                                                            <th style={{ textAlign: "center" }}>Pieces</th>
                                                            <th>Stage</th>
                                                            <th>Ready Since</th>
                                                            <th style={{ textAlign: "center" }}>Waiting</th>
                                                            <th>Dispatch By</th>
                                                            <th style={{ textAlign: "center" }}>Urgency</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {pendingFiltered.slice(0, dispatchLimit).map(p => {
                                                            const o = p.order;
                                                            const urgency = p.overdue
                                                                ? { cls: "pm-urg-overdue", label: p.daysToDue == null ? "Overdue" : `${Math.abs(p.daysToDue)}d overdue` }
                                                                : p.daysToDue === 0 ? { cls: "pm-urg-today", label: "Due today" }
                                                                    : p.daysToDue != null && p.daysToDue <= 2 ? { cls: "pm-urg-soon", label: `${p.daysToDue}d left` }
                                                                        : p.daysToDue == null ? { cls: "pm-urg-none", label: "No date" }
                                                                            : { cls: "pm-urg-ok", label: `${p.daysToDue}d left` };
                                                            return (
                                                                <tr
                                                                    key={o.id}
                                                                    className={p.overdue ? "pm-dispatch-row-overdue" : ""}
                                                                    onClick={() => openOrderInList(o)}
                                                                >
                                                                    <td className="pm-mono">{o.order_no || "-"}</td>
                                                                    <td>{getClientName(o) || "-"}</td>
                                                                    <td><span className={`pm-channel-tag ${getChannelClass(o)}`}>{getChannelLabel(o)}</span></td>
                                                                    <td style={{ textAlign: "center" }}>
                                                                        <span className="pm-piece-count">{p.readyCount}</span>
                                                                        {p.partial && (
                                                                            <span className="pm-partial-flag" title={`${p.inProductionCount} piece(s) still in production`}>
                                                                                +{p.inProductionCount} in prod
                                                                            </span>
                                                                        )}
                                                                    </td>
                                                                    <td>
                                                                        {p.readyStages.map(s => (
                                                                            <span key={s.stage} className="pm-stage-chip" style={{ "--chip-fg": getStageColor(s.stage) }}>
                                                                                {s.label}{p.readyStages.length > 1 || s.count > 1 ? ` ${s.count}` : ""}
                                                                            </span>
                                                                        ))}
                                                                    </td>
                                                                    <td>{p.readySince ? formatDate(new Date(p.readySince).toISOString()) : "—"}</td>
                                                                    <td style={{ textAlign: "center", fontWeight: 700, color: p.waitDays != null && p.waitDays > 3 ? "#c62828" : "#333" }}>
                                                                        {p.waitDays == null ? "—" : `${p.waitDays}d`}
                                                                    </td>
                                                                    <td>{p.warehouseDue ? p.warehouseDue.toLocaleDateString("en-GB") : "—"}</td>
                                                                    <td style={{ textAlign: "center" }}>
                                                                        <span className={`pm-urgency-badge ${urgency.cls}`}>{urgency.label}</span>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                                {pendingFiltered.length > dispatchLimit && (
                                                    <div style={{ marginTop: 12, textAlign: "center" }}>
                                                        <button className="pm-showall-btn" onClick={() => setDispatchLimit(l => l + 50)}>
                                                            Show 50 more ({pendingFiltered.length - dispatchLimit} remaining)
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* ===== RECENTLY DISPATCHED ===== */}
                                    <div className="pm-channel-card">
                                        <p className="pm-card-title">Recently Dispatched</p>
                                        {dispatchedFiltered.length === 0 ? (
                                            <p className="pm-muted" style={{ textAlign: "center", padding: 24 }}>
                                                {d.dispatched.length > 0
                                                    ? "No dispatched orders match your search."
                                                    : scoped
                                                        ? "No orders were dispatched in this period / channel."
                                                        : "No dispatch scans recorded yet."}
                                            </p>
                                        ) : (
                                            <div className="pm-dispatch-table-wrap">
                                                <table className="pm-dispatch-table">
                                                    <thead>
                                                        <tr>
                                                            <th>Order</th>
                                                            <th>Customer</th>
                                                            <th>Channel</th>
                                                            <th style={{ textAlign: "center" }}>Pieces</th>
                                                            <th>Dispatched On</th>
                                                            <th style={{ textAlign: "center" }}>On Time</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {dispatchedFiltered.slice(0, 20).map(x => (
                                                            <tr key={x.order.id} onClick={() => openOrderInList(x.order)}>
                                                                <td className="pm-mono">{x.order.order_no || "-"}</td>
                                                                <td>{getClientName(x.order) || "-"}</td>
                                                                <td><span className={`pm-channel-tag ${getChannelClass(x.order)}`}>{getChannelLabel(x.order)}</span></td>
                                                                <td style={{ textAlign: "center" }}>
                                                                    <span className="pm-piece-count">{x.pieces}</span>
                                                                    {x.stillPending > 0 && (
                                                                        <span className="pm-partial-flag" title={`${x.stillPending} piece(s) still awaiting dispatch`}>
                                                                            {x.stillPending} pending
                                                                        </span>
                                                                    )}
                                                                </td>
                                                                <td>{x.at ? formatDate(new Date(x.at).toISOString()) : "—"}</td>
                                                                <td style={{ textAlign: "center", fontWeight: 700, color: x.daysLate == null ? "#90a4ae" : x.daysLate <= 0 ? "#2e7d32" : "#c62828" }}>
                                                                    {x.daysLate == null ? "—" : x.daysLate <= 0 ? "✓ on time" : `${x.daysLate}d late`}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}

                        {/* ===== DELIVERY REPORT sub-tab ===== */}
                        {activeTab === "delivery_report" && subTab === "report" && (() => {
                            const now = new Date();
                            const todayStr = now.toISOString().split("T")[0];

                            // Date range filter — applied to delivery_date for open orders, delivered_at for completed
                            const fromDate = drPeriodRange ? drPeriodRange.start : null;
                            const toDate = drPeriodRange ? drPeriodRange.end : null;

                            // Channel filter
                            // Channel from the shared classifier — the old check was a
                            // binary is_b2b, so Delhi/Ludhiana/Private/Exhibition all
                            // collapsed into one "Store" option.
                            const channelMatch = (o) => drChannel === "all" || getOrderChannelLabel(o) === drChannel;

                            // Completed vs still-open. "Pending" in this report is not an
                            // order status — it labels an OPEN order already past its
                            // deadline (see the open-orders pass below).
                            const statusMatch = (isOpen) =>
                                drStatus === "all" || (drStatus === "open" ? isOpen : !isOpen);

                            // Bucketing helper: days = how late (negative = on-time)
                            const bucketOf = (daysLate) => {
                                if (daysLate <= 0) return "ontime";
                                if (daysLate <= 2) return "0_2";
                                if (daysLate <= 7) return "2_7";
                                if (daysLate <= 14) return "7_14";
                                return "14_plus";
                            };

                            // ==================== COMPLETED ORDERS (historical) ====================
                            // Delivered/Completed orders — how late was the order actually
                            // finished, vs the warehouse deadline. The "when was it finished"
                            // timestamp must be a REAL one: delivered_at, else dispatched_at,
                            // else the stage-sync timestamp from the moment the last component
                            // dispatched. NEVER updated_at — any edit (payment change, exchange,
                            // a migration) rewrites it, which had completed orders showing
                            // 60-107 days "late" against what was really the row's last touch.
                            const orderDoneDate = (o) =>
                                o.delivered_at || o.dispatched_at ||
                                (o.warehouse_stage === "dispatched" ? o.warehouse_stage_updated_at : null) || null;

                            const completedRows = [];
                            orders.forEach(o => {
                                if (!statusMatch(false)) return;
                                if (o.status !== "delivered" && o.status !== "completed") return;
                                if (!o.delivery_date) return;
                                if (!channelMatch(o)) return;

                                // Measured against the WAREHOUSE deadline (T-2), not the customer
                                // date — production is late when it misses its own deadline.
                                const promisedDate = getWarehouseDateObj(o.delivery_date, o.created_at);
                                if (!promisedDate) return;

                                const actualDeliveryStr = orderDoneDate(o);
                                if (!actualDeliveryStr) {
                                    // No trustworthy completion date — show the order without
                                    // inventing one (no days-late, its own "no date" bucket).
                                    // A date-bounded view cannot place it, so skip it there.
                                    if (fromDate || toDate) return;
                                    completedRows.push({
                                        order: o,
                                        actualDelivery: null,
                                        promisedDate,
                                        daysLate: null,
                                        bucket: "no_date",
                                        isOpen: false,
                                    });
                                    return;
                                }
                                const actualDate = new Date(actualDeliveryStr);
                                // Apply date range against actual delivery date
                                if (fromDate && actualDate < fromDate) return;
                                if (toDate && actualDate > toDate) return;

                                // normalize to midnight for day diff
                                const promisedMid = new Date(promisedDate.getFullYear(), promisedDate.getMonth(), promisedDate.getDate());
                                const actualMid = new Date(actualDate.getFullYear(), actualDate.getMonth(), actualDate.getDate());
                                const daysLate = Math.round((actualMid - promisedMid) / (1000 * 60 * 60 * 24));
                                const bucket = bucketOf(daysLate);

                                completedRows.push({
                                    order: o,
                                    actualDelivery: actualDate,
                                    promisedDate,
                                    daysLate,
                                    bucket,
                                    isOpen: false,
                                });
                            });

                            // ==================== OPEN ORDERS (currently running late) ====================
                            const openRows = [];
                            orders.forEach(o => {
                                if (!statusMatch(true)) return;
                                if (o.status === "delivered" || o.status === "completed" || o.status === "cancelled") return;
                                // Dispatched = production complete, so there's no late work to chase.
                                // status and warehouse_stage track different things: an order that
                                // shipped and was then returned reads status='exchange_return' with
                                // warehouse_stage='dispatched'. Filtering on status alone let that
                                // through, listing an already-delivered order as 13 days late against
                                // a date it had actually met.
                                if (o.warehouse_stage === "dispatched") return;
                                if (!o.delivery_date) return;
                                if (!channelMatch(o)) return;

                                // The warehouse deadline (T-2), so "late" means late for production.
                                const promisedDate = getWarehouseDateObj(o.delivery_date, o.created_at);
                                if (!promisedDate) return;
                                const promisedMid = new Date(promisedDate.getFullYear(), promisedDate.getMonth(), promisedDate.getDate());
                                const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                                const daysLate = Math.round((todayMid - promisedMid) / (1000 * 60 * 60 * 24));
                                if (daysLate <= 0) return; // still within promise
                                const bucket = bucketOf(daysLate);

                                // For open orders, apply date range against delivery_date
                                if (fromDate && promisedDate < fromDate) return;
                                if (toDate && promisedDate > toDate) return;

                                openRows.push({
                                    order: o,
                                    actualDelivery: null,
                                    promisedDate,
                                    daysLate,
                                    bucket,
                                    isOpen: true,
                                });
                            });

                            // ==================== SUMMARY COUNTS (completed orders only) ====================
                            const summary = {
                                ontime: completedRows.filter(r => r.bucket === "ontime").length,
                                b0_2: completedRows.filter(r => r.bucket === "0_2").length,
                                b2_7: completedRows.filter(r => r.bucket === "2_7").length,
                                b7_14: completedRows.filter(r => r.bucket === "7_14").length,
                                b14_plus: completedRows.filter(r => r.bucket === "14_plus").length,
                            };
                            const totalCompleted = completedRows.length;
                            const ontimePct = totalCompleted > 0 ? ((summary.ontime / totalCompleted) * 100).toFixed(1) : "0.0";

                            // ==================== HEADLINE METRICS ====================
                            // Average and worst delay across LATE completed orders only —
                            // averaging in the on-time ones (negative days) would cancel the
                            // lateness out and report a healthy-looking number.
                            const lateRows = completedRows.filter(r => r.daysLate != null && r.daysLate > 0);
                            const avgDelay = lateRows.length > 0
                                ? (lateRows.reduce((s, r) => s + r.daysLate, 0) / lateRows.length).toFixed(1)
                                : null;
                            const worstDelay = lateRows.length > 0 ? Math.max(...lateRows.map(r => r.daysLate)) : null;
                            // Orders with no trustworthy completion date — surfaced rather than
                            // hidden, because they are a data-quality signal the PM should see.
                            const noDateCount = completedRows.filter(r => r.bucket === "no_date").length;

                            // ==================== BREAKDOWN: CHANNEL / SA ====================
                            // Which channel (and which salesperson) is actually driving the
                            // delays. A single on-time % hides that one channel can be fine
                            // while another is the whole problem.
                            const groupPerf = (rows, keyOf) => {
                                const m = {};
                                rows.forEach((r) => {
                                    const k = keyOf(r) || "Unassigned";
                                    const g = m[k] || (m[k] = { key: k, total: 0, ontime: 0, lateDays: 0, lateCount: 0 });
                                    g.total++;
                                    if (r.daysLate != null && r.daysLate <= 0) g.ontime++;
                                    if (r.daysLate != null && r.daysLate > 0) { g.lateDays += r.daysLate; g.lateCount++; }
                                });
                                return Object.values(m)
                                    .map(g => ({
                                        ...g,
                                        pct: g.total > 0 ? Math.round((g.ontime / g.total) * 100) : 0,
                                        avgLate: g.lateCount > 0 ? (g.lateDays / g.lateCount).toFixed(1) : null,
                                    }))
                                    // Worst performer first — that's the row worth acting on.
                                    .sort((a, b) => a.pct - b.pct || b.total - a.total);
                            };
                            const byChannel = groupPerf(completedRows, r => getOrderChannelLabel(r.order));
                            const bySA = groupPerf(completedRows, r => r.order.salesperson).slice(0, 8);

                            // ==================== FILTER BY BUCKET + SEARCH ====================
                            const applyBucketAndSearch = (rows) => {
                                let r = rows;
                                if (drBucket !== "all") r = r.filter(x => x.bucket === drBucket);
                                if (drSearch.trim()) {
                                    const q = drSearch.toLowerCase();
                                    r = r.filter(x => (x.order.order_no || "").toLowerCase().includes(q) ||
                                        getClientName(x.order).toLowerCase().includes(q) ||
                                        (x.order.salesperson || "").toLowerCase().includes(q) ||
                                        ((x.order.items?.[0]?.product_name) || "").toLowerCase().includes(q));
                                }
                                return r;
                            };

                            const filteredCompleted = applyBucketAndSearch(completedRows).sort((a, b) => b.daysLate - a.daysLate);
                            const filteredOpen = applyBucketAndSearch(openRows).sort((a, b) => b.daysLate - a.daysLate);

                            // ==================== BUCKET STYLING ====================
                            // bg/fg style the BADGE (fg reads on bg). accent is the card
                            // colour — the number and active border sit on a WHITE card, so
                            // it can never be white itself: the critical bucket's fg is #fff,
                            // which rendered an invisible count.
                            const bucketStyle = (b) => {
                                switch (b) {
                                    case "ontime": return { bg: "#e8f5e9", fg: "#2e7d32", accent: "#2e7d32", label: "On-time" };
                                    case "0_2": return { bg: "#fffde7", fg: "#f57f17", accent: "#f57f17", label: "0\u20132d late" };
                                    case "2_7": return { bg: "#fff3e0", fg: "#e65100", accent: "#e65100", label: "2\u20137d late" };
                                    case "7_14": return { bg: "#ffebee", fg: "#c62828", accent: "#c62828", label: "7\u201314d late" };
                                    case "14_plus": return { bg: "#b71c1c", fg: "#fff", accent: "#b71c1c", label: "14+d critical" };
                                    case "no_date": return { bg: "#eceff1", fg: "#546e7a", accent: "#546e7a", label: "no completion date" };
                                    default: return { bg: "#f5f5f5", fg: "#333", accent: "#333", label: b };
                                }
                            };

                            // ==================== EXPORT ====================
                            const handleDrExport = () => {
                                const rows = [...filteredCompleted, ...filteredOpen];
                                if (rows.length === 0) {
                                    showPopup({ type: "info", title: "Nothing to export", message: "No orders match the current filters." });
                                    return;
                                }
                                const headers = ["Order No", "Type", "Customer", "SA Name", "Store", "Channel", "Product", "Size", "Amount", "Order Date", "Promised Date", "Actual Delivery", "Days Late", "Bucket", "Status"];
                                const csvRows = rows.map(r => {
                                    const o = r.order;
                                    const item = o.items?.[0] || {};
                                    return [
                                        o.order_no || "",
                                        r.isOpen ? "Open (Running Late)" : "Completed",
                                        getClientName(o) || "",
                                        o.salesperson || "",
                                        o.salesperson_store || "",
                                        getChannelLabel(o),
                                        item.product_name || "",
                                        item.size || "",
                                        o.grand_total || 0,
                                        o.created_at ? new Date(o.created_at).toLocaleDateString("en-GB") : "",
                                        getWarehouseDate(o.delivery_date, o.created_at, ""),
                                        r.actualDelivery ? r.actualDelivery.toLocaleDateString("en-GB") : (r.isOpen ? "Not yet delivered" : "No completion date recorded"),
                                        r.daysLate == null ? "-" : (r.daysLate <= 0 ? "On-time" : r.daysLate),
                                        bucketStyle(r.bucket).label,
                                        getOrderStatusLabel(o.status),
                                    ].map(v => `"${String(v).replace(/"/g, '""')}"`);
                                });
                                const csv = [headers.join(","), ...csvRows.map(r => r.join(","))].join("\n");
                                const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = `delivery_report_${todayStr}.csv`;
                                a.click();
                                URL.revokeObjectURL(url);
                            };

                            // ==================== BUCKET CARD ====================
                            const BucketCard = ({ title, value, bucketKey, highlight, subtitle }) => {
                                const active = drBucket === bucketKey;
                                const style = bucketStyle(bucketKey === "all" ? "ontime" : bucketKey);
                                return (
                                    <div
                                        onClick={() => setDrBucket(active ? "all" : bucketKey)}
                                        style={{
                                            cursor: "pointer",
                                            background: "#fff",
                                            border: active ? `2px solid ${style.accent}` : "1px solid #e0e0e0",
                                            borderRadius: 12,
                                            padding: "14px 16px",
                                            transition: "all 0.15s",
                                            boxShadow: active ? "0 2px 8px rgba(0,0,0,0.08)" : "none",
                                        }}
                                    >
                                        <p style={{ fontSize: 12, color: "#666", margin: 0, fontWeight: 500 }}>{title}</p>
                                        <p style={{ fontSize: 24, fontWeight: 700, margin: "6px 0 2px", color: highlight ? style.accent : "#333" }}>{value}</p>
                                        {subtitle && <p style={{ fontSize: 11, color: "#999", margin: 0 }}>{subtitle}</p>}
                                    </div>
                                );
                            };

                            return (
                                <div className="pm-orders-tab">
                                    <h2 className="pm-tab-title">Delivery Report</h2>

                                    <p className="pm-muted" style={{ margin: "-6px 0 4px 2px", fontSize: 12 }}>
                                        Delivery performance against the promised date &mdash; how many orders landed on time, and where the delays are.
                                    </p>

                                    {/* ===== PERIOD + CHANNEL (same bar as the Dispatch tab) ===== */}
                                    <PeriodFilter {...drPeriodProps} variant="pills">
                                        <select
                                            className="pm-dispatch-channel"
                                            value={drChannel}
                                            onChange={(e) => setDrChannel(e.target.value)}
                                        >
                                            <option value="all">All Channels</option>
                                            {CHANNEL_SEGMENTS.map(seg => (
                                                <option key={seg.label} value={seg.label}>{seg.label}</option>
                                            ))}
                                        </select>
                                    </PeriodFilter>

                                    {/* ===== HEADLINE ===== */}
                                    <div className="pm-dispatch-hero">
                                        <div>
                                            <p className="pm-dispatch-hero-label">ON-TIME DELIVERY RATE</p>
                                            <p className="pm-dispatch-hero-value" style={{ color: Number(ontimePct) >= 80 ? "#2e7d32" : Number(ontimePct) >= 60 ? "#e65100" : "#c62828" }}>{ontimePct}%</p>
                                            <p className="pm-dispatch-hero-sub">{summary.ontime} of {totalCompleted} completed orders on time</p>
                                        </div>
                                        <div style={{ textAlign: "right" }}>
                                            <p className="pm-dispatch-hero-label">CURRENTLY RUNNING LATE</p>
                                            <p className="pm-dispatch-hero-value" style={{ color: openRows.length > 0 ? "#c62828" : "#2e7d32" }}>{openRows.length}</p>
                                            <p className="pm-dispatch-hero-sub">open orders past their date</p>
                                        </div>
                                    </div>

                                    {/* ===== KPI CARDS ===== */}
                                    <div className="pm-dispatch-kpis">
                                        <StatCard
                                            title="Delivered"
                                            value={totalCompleted}
                                            subtitle={`completed ${drPeriodLabel.toLowerCase()}`}
                                            icon={Icons.package}
                                        />
                                        <StatCard
                                            title="Delivered Late"
                                            value={lateRows.length}
                                            subtitle={totalCompleted > 0 ? `${Math.round((lateRows.length / totalCompleted) * 100)}% of deliveries` : "none"}
                                            highlight={lateRows.length > 0}
                                            icon={Icons.warning}
                                        />
                                        <StatCard
                                            title="Avg Delay"
                                            value={avgDelay == null ? "—" : `${avgDelay}d`}
                                            subtitle={avgDelay == null ? "nothing delivered late" : "across late orders"}
                                            highlight={avgDelay != null && Number(avgDelay) > 7}
                                            icon={Icons.hourglass}
                                        />
                                        <StatCard
                                            title="Worst Delay"
                                            value={worstDelay == null ? "—" : `${worstDelay}d`}
                                            subtitle={worstDelay == null ? "nothing delivered late" : "single worst order"}
                                            highlight={worstDelay != null && worstDelay > 14}
                                            icon={Icons.clock}
                                        />
                                        <StatCard
                                            title="Critical (14d+)"
                                            value={summary.b14_plus}
                                            subtitle="severely delayed"
                                            highlight={summary.b14_plus > 0}
                                            icon={Icons.xCircle}
                                            onClick={summary.b14_plus > 0 ? () => setDrBucket(drBucket === "14_plus" ? "all" : "14_plus") : undefined}
                                        />
                                    </div>

                                    {/* ===== PERFORMANCE BREAKDOWN =====
                                        A single on-time % hides which channel or SA is driving the
                                        misses. Worst performer first — that's the actionable row. */}
                                    {totalCompleted > 0 && (
                                        <div className="pm-dr-split">
                                            <div className="pm-channel-card">
                                                <p className="pm-card-title">On-time by Channel</p>
                                                <div className="pm-dispatch-table-wrap">
                                                    <table className="pm-dispatch-table">
                                                        <thead>
                                                            <tr>
                                                                <th>Channel</th>
                                                                <th style={{ textAlign: "center" }}>Orders</th>
                                                                <th style={{ textAlign: "center" }}>On-time</th>
                                                                <th style={{ textAlign: "center" }}>Avg Delay</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {byChannel.map(g => (
                                                                <tr key={g.key} className="pm-row-static">
                                                                    <td>{g.key}</td>
                                                                    <td style={{ textAlign: "center" }}>{g.total}</td>
                                                                    <td style={{ textAlign: "center" }}>
                                                                        <span className="pm-pct-badge" style={{ "--pct-fg": g.pct >= 80 ? "#2e7d32" : g.pct >= 60 ? "#e65100" : "#c62828" }}>{g.pct}%</span>
                                                                    </td>
                                                                    <td style={{ textAlign: "center", color: "#666" }}>{g.avgLate == null ? "—" : `${g.avgLate}d`}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                            <div className="pm-channel-card">
                                                <p className="pm-card-title">On-time by Salesperson</p>
                                                <div className="pm-dispatch-table-wrap">
                                                    <table className="pm-dispatch-table">
                                                        <thead>
                                                            <tr>
                                                                <th>Salesperson</th>
                                                                <th style={{ textAlign: "center" }}>Orders</th>
                                                                <th style={{ textAlign: "center" }}>On-time</th>
                                                                <th style={{ textAlign: "center" }}>Avg Delay</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {bySA.map(g => (
                                                                <tr key={g.key} className="pm-row-static">
                                                                    <td>{g.key}</td>
                                                                    <td style={{ textAlign: "center" }}>{g.total}</td>
                                                                    <td style={{ textAlign: "center" }}>
                                                                        <span className="pm-pct-badge" style={{ "--pct-fg": g.pct >= 80 ? "#2e7d32" : g.pct >= 60 ? "#e65100" : "#c62828" }}>{g.pct}%</span>
                                                                    </td>
                                                                    <td style={{ textAlign: "center", color: "#666" }}>{g.avgLate == null ? "—" : `${g.avgLate}d`}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* ===== STATUS + SEARCH + EXPORT ===== */}
                                    <div className="pm-dispatch-controls">
                                        <div className="pm-dispatch-chips">
                                            {[
                                                { key: "all", label: "All" },
                                                { key: "done", label: `Delivered (${completedRows.length})` },
                                                { key: "open", label: `Running late (${openRows.length})` },
                                            ].map(f => (
                                                <button
                                                    key={f.key}
                                                    className={`pm-dispatch-chip ${drStatus === f.key ? "active" : ""}`}
                                                    onClick={() => setDrStatus(f.key)}
                                                >
                                                    {f.label}
                                                </button>
                                            ))}
                                            {drBucket !== "all" && (
                                                <button className="pm-dispatch-chip active" onClick={() => setDrBucket("all")}>
                                                    {bucketStyle(drBucket).label} {"×"}
                                                </button>
                                            )}
                                        </div>
                                        <input
                                            type="text"
                                            className="pm-dispatch-search"
                                            value={drSearch}
                                            onChange={(e) => setDrSearch(e.target.value)}
                                            placeholder="Order no, customer, SA, product..."
                                        />
                                        <button className="pm-dispatch-export" onClick={handleDrExport}>
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                            Export CSV
                                        </button>
                                    </div>

                                    {/* ===== BUCKET CARDS ===== */}
                                    <p className="pm-card-title" style={{ margin: "4px 0 10px 2px", color: "#8B7355" }}>
                                        Completed Orders by Delay Bucket (click to filter)
                                    </p>
                                    <div className="pm-dr-buckets">
                                        <BucketCard title="On-time" value={summary.ontime} bucketKey="ontime" highlight={true} />
                                        <BucketCard title="0–2 days late" value={summary.b0_2} bucketKey="0_2" highlight={summary.b0_2 > 0} />
                                        <BucketCard title="2–7 days late" value={summary.b2_7} bucketKey="2_7" highlight={summary.b2_7 > 0} />
                                        <BucketCard title="7–14 days late" value={summary.b7_14} bucketKey="7_14" highlight={summary.b7_14 > 0} />
                                        <BucketCard title="14+ days critical" value={summary.b14_plus} bucketKey="14_plus" highlight={summary.b14_plus > 0} />
                                        {noDateCount > 0 && (
                                            <BucketCard title="No delivery date" value={noDateCount} bucketKey="no_date" highlight={true} subtitle="not recorded" />
                                        )}
                                    </div>

                                    {/* ===== OPEN ORDERS RUNNING LATE ===== */}
                                    {filteredOpen.length > 0 && (
                                        <div className="pm-channel-card" style={{ marginBottom: 20, borderLeft: "4px solid #c62828" }}>
                                            <p className="pm-card-title">{"\uD83D\uDD25"} Open Orders Running Late ({filteredOpen.length})</p>
                                            <div style={{ overflowX: "auto" }}>
                                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                                    <thead><tr style={{ borderBottom: "2px solid #e0e0e0", textAlign: "left", background: "#fafafa" }}>
                                                        <th style={{ padding: "10px 12px" }}>Order</th>
                                                        <th style={{ padding: "10px 12px" }}>Customer</th>
                                                        <th style={{ padding: "10px 12px" }}>SA</th>
                                                        <th style={{ padding: "10px 12px" }}>Product</th>
                                                        <th style={{ padding: "10px 12px" }}>Promised</th>
                                                        <th style={{ padding: "10px 12px", textAlign: "center" }}>Days Late</th>
                                                        <th style={{ padding: "10px 12px", textAlign: "center" }}>Bucket</th>
                                                        <th style={{ padding: "10px 12px" }}>Stage</th>
                                                    </tr></thead>
                                                    <tbody>{filteredOpen.slice(0, drOpenLimit).map(r => {
                                                        const o = r.order;
                                                        const style = bucketStyle(r.bucket);
                                                        return (
                                                            <tr key={o.id} style={{ borderBottom: "1px solid #f0f0f0", cursor: "pointer" }} onClick={() => openOrderInList(o)}>
                                                                <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 12 }}>{o.order_no || "-"}</td>
                                                                <td style={{ padding: "8px 12px" }}>{getClientName(o) || "-"}</td>
                                                                <td style={{ padding: "8px 12px", fontSize: 12 }}>{o.salesperson || "-"}</td>
                                                                <td style={{ padding: "8px 12px", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.items?.[0]?.product_name || "-"}</td>
                                                                <td style={{ padding: "8px 12px" }}>{formatDate(o.delivery_date)}</td>
                                                                <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 700, color: "#c62828" }}>{r.daysLate}d</td>
                                                                <td style={{ padding: "8px 12px", textAlign: "center" }}>
                                                                    <span className="pm-bucket-badge" style={{ background: style.bg, "--bucket-fg": style.fg }}>{style.label}</span>
                                                                </td>
                                                                <td style={{ padding: "8px 12px", textTransform: "capitalize" }}>{(o.warehouse_stage ? o.warehouse_stage.replace(/_/g, " ") : getOrderStatusLabel(o.status))}</td>
                                                            </tr>
                                                        );
                                                    })}</tbody>
                                                </table>
                                            </div>
                                            {filteredOpen.length > drOpenLimit && (
                                                <div className="pm-dr-more">
                                                    <button className="pm-showall-btn" onClick={() => setDrOpenLimit(l => l + 50)}>
                                                        Show 50 more ({filteredOpen.length - drOpenLimit} remaining)
                                                    </button>
                                                    <button className="pm-showall-btn" onClick={() => showAllFromReport("open")}>
                                                        Open all {filteredOpen.length} in All Orders
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* ===== COMPLETED ORDERS ===== */}
                                    <div className="pm-channel-card">
                                        <p className="pm-card-title">Completed Deliveries ({filteredCompleted.length}{drBucket !== "all" ? ` \u00B7 filtered to ${bucketStyle(drBucket).label}` : ""})</p>
                                        {filteredCompleted.length === 0 ? (
                                            <p className="pm-muted" style={{ textAlign: "center", padding: 20 }}>No completed orders match the current filters</p>
                                        ) : (
                                            <div style={{ overflowX: "auto" }}>
                                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                                    <thead><tr style={{ borderBottom: "2px solid #e0e0e0", textAlign: "left", background: "#fafafa" }}>
                                                        <th style={{ padding: "10px 12px" }}>Order</th>
                                                        <th style={{ padding: "10px 12px" }}>Customer</th>
                                                        <th style={{ padding: "10px 12px" }}>SA</th>
                                                        <th style={{ padding: "10px 12px" }}>Product</th>
                                                        <th style={{ padding: "10px 12px" }}>Order Date</th>
                                                        <th style={{ padding: "10px 12px" }}>Promised</th>
                                                        <th style={{ padding: "10px 12px" }}>Delivered</th>
                                                        <th style={{ padding: "10px 12px", textAlign: "center" }}>Days Late</th>
                                                        <th style={{ padding: "10px 12px", textAlign: "center" }}>Bucket</th>
                                                    </tr></thead>
                                                    <tbody>{filteredCompleted.slice(0, drDoneLimit).map(r => {
                                                        const o = r.order;
                                                        const style = bucketStyle(r.bucket);
                                                        return (
                                                            <tr key={o.id} style={{ borderBottom: "1px solid #f0f0f0", cursor: "pointer" }} onClick={() => openOrderInList(o)}>
                                                                <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 12 }}>{o.order_no || "-"}</td>
                                                                <td style={{ padding: "8px 12px" }}>{getClientName(o) || "-"}</td>
                                                                <td style={{ padding: "8px 12px", fontSize: 12 }}>{o.salesperson || "-"}</td>
                                                                <td style={{ padding: "8px 12px", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.items?.[0]?.product_name || "-"}</td>
                                                                <td style={{ padding: "8px 12px" }}>{formatDate(o.created_at)}</td>
                                                                <td style={{ padding: "8px 12px" }}>{formatDate(o.delivery_date)}</td>
                                                                <td style={{ padding: "8px 12px" }}>{r.actualDelivery ? r.actualDelivery.toLocaleDateString("en-GB") : "-"}</td>
                                                                <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 700, color: r.daysLate == null ? "#90a4ae" : r.daysLate <= 0 ? "#2e7d32" : "#c62828" }}>{r.daysLate == null ? "\u2014" : r.daysLate <= 0 ? "\u2713" : `${r.daysLate}d`}</td>
                                                                <td style={{ padding: "8px 12px", textAlign: "center" }}>
                                                                    <span className="pm-bucket-badge" style={{ background: style.bg, "--bucket-fg": style.fg }}>{style.label}</span>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}</tbody>
                                                </table>
                                                {filteredCompleted.length > drDoneLimit && (
                                                    <div className="pm-dr-more">
                                                        <button className="pm-showall-btn" onClick={() => setDrDoneLimit(l => l + 50)}>
                                                            Show 50 more ({filteredCompleted.length - drDoneLimit} remaining)
                                                        </button>
                                                        <button className="pm-showall-btn" onClick={() => showAllFromReport("completed")}>
                                                            Open all {filteredCompleted.length} in All Orders
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}

                        {/* ===== CALENDAR TAB ===== */}
                        {activeTab === "calendar" && (() => {
                            const now = new Date();
                            const year = calendarYear;
                            const month = calendarMonth;
                            const daysInMonth = new Date(year, month + 1, 0).getDate();
                            const firstDay = new Date(year, month, 1).getDay();
                            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                            const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

                            const goToPrevMonth = () => { setSelectedCalendarDate(null); if (month === 0) { setCalendarMonth(11); setCalendarYear(year - 1); } else setCalendarMonth(month - 1); };
                            const goToNextMonth = () => { setSelectedCalendarDate(null); if (month === 11) { setCalendarMonth(0); setCalendarYear(year + 1); } else setCalendarMonth(month + 1); };
                            const goToToday = () => { setSelectedCalendarDate(null); setCalendarMonth(now.getMonth()); setCalendarYear(now.getFullYear()); };
                            // An order is finished when it has left production — the same rule
                            // the rest of the dashboard uses, so a "done" day here agrees with
                            // every other tab.
                            const isFinished = (o) =>
                                ["delivered", "completed", "dispatched"].includes((o.status || "").toLowerCase()) ||
                                o.warehouse_stage === "dispatched";

                            // delivery_date is a plain YYYY-MM-DD column, so slice it rather
                            // than round-tripping through Date — new Date(d).toISOString()
                            // shifts the day backwards for any timezone behind UTC.
                            const dayKeyOf = (o) => (o.delivery_date || "").slice(0, 10);

                            const calOrders = orders.filter((o) => {
                                if (!o.delivery_date || o.status === "cancelled") return false;
                                if (calChannel !== "all" && getOrderChannelLabel(o) !== calChannel) return false;
                                return true;
                            });

                            // Per-day buckets. `late` = still unfinished and the date has passed;
                            // that is the state a PM needs to spot on a calendar.
                            const deliveryMap = {};
                            calOrders.forEach((o) => {
                                const key = dayKeyOf(o);
                                if (!key) return;
                                const b = deliveryMap[key] || (deliveryMap[key] = { total: 0, done: 0, pending: 0, late: 0 });
                                b.total++;
                                if (isFinished(o)) b.done++;
                                else { b.pending++; if (key < todayKey) b.late++; }
                            });

                            const cells = [];
                            for (let i = 0; i < firstDay; i++) cells.push(null);
                            for (let d = 1; d <= daysInMonth; d++) cells.push(d);

                            const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
                            const monthOrders = calOrders
                                .filter((o) => dayKeyOf(o).startsWith(monthPrefix))
                                .sort((a, b) => dayKeyOf(a).localeCompare(dayKeyOf(b)) || (a.order_no || "").localeCompare(b.order_no || ""));

                            const selectedDayOrders = selectedCalendarDate
                                ? calOrders.filter((o) => dayKeyOf(o) === selectedCalendarDate)
                                    .sort((a, b) => (a.order_no || "").localeCompare(b.order_no || ""))
                                : [];

                            // The one number worth calling out beside the month: work that
                            // is past its date and still unfinished.
                            const monthLate = monthOrders.filter((o) => !isFinished(o) && dayKeyOf(o) < todayKey).length;

                            // What the list below the grid is showing right now.
                            const listOrders = selectedCalendarDate ? selectedDayOrders : monthOrders;
                            const listLabel = selectedCalendarDate
                                ? `Deliveries on ${formatDate(selectedCalendarDate)}`
                                : `All deliveries in ${monthNames[month]} ${year}`;

                            const handleCalendarExport = () => {
                                if (listOrders.length === 0) {
                                    showPopup({ type: "info", title: "Nothing to export", message: "No deliveries in the selected range." });
                                    return;
                                }
                                downloadCsv({
                                    filename: `delivery_calendar_${selectedCalendarDate || `${monthNames[month]}_${year}`}`,
                                    dated: false,
                                    headers: [
                                        "Order No", "Customer", "SA", "Store", "Channel", "Product", "Size", "Amount",
                                        "Delivery Date", "Dispatch By", "Current Stage", "Status", "Priority",
                                    ],
                                    rows: listOrders.map((o) => {
                                        const it = o.items?.[0] || {};
                                        return [
                                            o.order_no || "",
                                            getClientName(o) || "",
                                            o.salesperson || "",
                                            o.salesperson_store || "",
                                            getChannelLabel(o),
                                            it.product_name || "",
                                            it.size || "",
                                            o.grand_total || 0,
                                            formatDate(o.delivery_date) || "",
                                            getWarehouseDate(o.delivery_date, o.created_at, ""),
                                            getStageLabel(o.warehouse_stage) || o.warehouse_stage || "Order Received",
                                            getOrderStatusLabel(o.status),
                                            o.priority || "Normal",
                                        ];
                                    }),
                                });
                            };

                            const jumpValue = selectedCalendarDate || `${monthPrefix}-01`;

                            return (
                                <div className="pm-orders-tab">
                                    <h2 className="pm-tab-title">Delivery Calendar</h2>
                                    <p className="pm-muted" style={{ margin: "-6px 0 4px 2px", fontSize: 12 }}>
                                        When orders are promised to customers. Click any date to see that day&apos;s deliveries.
                                    </p>

                                    {/* ===== MONTH NAV ===== */}
                                    {/* One row: move through months, scope by channel, export.
                                        Deliberately minimal — this tab answers "what is due when",
                                        so anything that isn't the month, the days, or the list is
                                        noise competing with the calendar itself. */}
                                    <div className="pm-cal-bar">
                                        <div className="pm-cal-nav">
                                            <button className="pm-cal-arrow" onClick={goToPrevMonth} title="Previous month">{"◀"}</button>
                                            <span className="pm-cal-month">{monthNames[month]} {year}</span>
                                            <button className="pm-cal-arrow" onClick={goToNextMonth} title="Next month">{"▶"}</button>
                                            <button className="pm-cal-today" onClick={goToToday}>Today</button>
                                            <span className="pm-cal-count">
                                                {monthOrders.length} deliver{monthOrders.length === 1 ? "y" : "ies"}
                                                {monthLate > 0 && <b className="pm-cal-count-late"> {"·"} {monthLate} overdue</b>}
                                            </span>
                                        </div>
                                        <div className="pm-cal-scope">
                                            <select className="pm-dispatch-channel" value={calChannel} onChange={(e) => setCalChannel(e.target.value)}>
                                                <option value="all">All Channels</option>
                                                {CHANNEL_SEGMENTS.map(seg => (
                                                    <option key={seg.label} value={seg.label}>{seg.label}</option>
                                                ))}
                                            </select>
                                            <button className="pm-dispatch-export" onClick={handleCalendarExport}>
                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                                Export
                                            </button>
                                        </div>
                                    </div>

                                    {/* ===== GRID ===== */}
                                    <div className="pm-cal-card">
                                        <div className="pm-cal-dow">
                                            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => <div key={d}>{d}</div>)}
                                        </div>
                                        <div className="pm-cal-grid">
                                            {cells.map((day, i) => {
                                                if (!day) return <div key={`e${i}`} className="pm-cal-empty" />;
                                                const dateKey = `${monthPrefix}-${String(day).padStart(2, "0")}`;
                                                const info = deliveryMap[dateKey];
                                                const isToday = dateKey === todayKey;
                                                const isPast = dateKey < todayKey;
                                                const isSelected = selectedCalendarDate === dateKey;
                                                const cls = [
                                                    "pm-cal-day",
                                                    isSelected ? "selected" : "",
                                                    isToday ? "today" : "",
                                                    isPast && !isSelected ? "past" : "",
                                                    info?.late > 0 ? "has-late" : "",
                                                ].filter(Boolean).join(" ");
                                                return (
                                                    <button
                                                        type="button"
                                                        key={day}
                                                        className={cls}
                                                        onClick={() => setSelectedCalendarDate(isSelected ? null : dateKey)}
                                                        title={info ? `${info.total} deliver${info.total === 1 ? "y" : "ies"}${info.late ? ` · ${info.late} overdue` : ""}` : "No deliveries"}
                                                    >
                                                        <span className="pm-cal-daynum">{day}</span>
                                                        {/* One number per day: how many orders are due. Three
                                                            stacked pills (late/due/done) turned a 31-day grid
                                                            into ~90 competing labels — the day's total is what
                                                            the grid is for, and the row colour already says
                                                            whether any of it is overdue. The breakdown is one
                                                            click away in the list below. */}
                                                        {info && (
                                                            <span className={`pm-cal-count-badge ${info.late > 0 ? "late" : info.pending === 0 ? "done" : "due"}`}>
                                                                {info.total}
                                                            </span>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* ===== LIST (selected day, else whole month) ===== */}
                                    <div className="pm-channel-card">
                                        <div className="pm-cal-list-head">
                                            <p className="pm-card-title" style={{ margin: 0 }}>
                                                {listLabel} {"—"} {listOrders.length} order{listOrders.length === 1 ? "" : "s"}
                                            </p>
                                            {selectedCalendarDate && (
                                                <button className="pm-dispatch-chip" onClick={() => setSelectedCalendarDate(null)}>
                                                    Show whole month
                                                </button>
                                            )}
                                        </div>
                                        {listOrders.length === 0 ? (
                                            <p className="pm-muted" style={{ textAlign: "center", padding: 24 }}>
                                                {calChannel !== "all"
                                                    ? `No ${calChannel} deliveries here.`
                                                    : "No deliveries scheduled."}
                                            </p>
                                        ) : (
                                            <div className="pm-dispatch-table-wrap">
                                                <table className="pm-dispatch-table">
                                                    <thead>
                                                        <tr>
                                                            <th>Order</th>
                                                            <th>Customer</th>
                                                            <th>Channel</th>
                                                            <th>Product</th>
                                                            <th>Delivery Date</th>
                                                            <th>Current Stage</th>
                                                            <th style={{ textAlign: "center" }}>Status</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {listOrders.slice(0, calLimit).map((o) => {
                                                            const key = dayKeyOf(o);
                                                            const done = isFinished(o);
                                                            const late = !done && key < todayKey;
                                                            // Ladder status from the order's own pieces (componentsByOrder
                                                            // is the existing per-order lookup), so a status column and a
                                                            // stage column say different, non-contradictory things.
                                                            const statusLabel = getOrderProgressStatus(o, componentsByOrder[o.id]);
                                                            return (
                                                                <tr key={o.id} className={late ? "pm-dispatch-row-overdue" : ""} onClick={() => openOrderInList(o)}>
                                                                    <td className="pm-mono">{o.order_no || "-"}</td>
                                                                    <td>{getClientName(o) || "-"}</td>
                                                                    <td><span className={`pm-channel-tag ${getChannelClass(o)}`}>{getChannelLabel(o)}</span></td>
                                                                    <td style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.items?.[0]?.product_name || "-"}</td>
                                                                    <td>{formatDate(o.delivery_date)}</td>
                                                                    <td>{getStageLabel(o.warehouse_stage) || "Order Received"}</td>
                                                                    <td style={{ textAlign: "center" }}>
                                                                        {/* The real ladder status, never an invented word. "Overdue"
                                                                            is a separate fact (past its date, still running), so it
                                                                            rides alongside rather than replacing the status. */}
                                                                        <span className={`pm-status-badge pm-status-${getOrderProgressStatusKey(statusLabel)}`}>
                                                                            {statusLabel}
                                                                        </span>
                                                                        {late && <span className="pm-status-late">Overdue</span>}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                                {listOrders.length > calLimit && (
                                                    <div className="pm-dr-more">
                                                        <button className="pm-showall-btn" onClick={() => setCalLimit(l => l + 50)}>
                                                            Show 50 more ({listOrders.length - calLimit} remaining)
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}


                        {activeTab === "overrides" && (
                            <div className="pm-orders-tab">
                                {/* Scan report — every scan in a date range, one CSV row per scan. */}
                                <div className="pm-channel-card" style={{ marginBottom: 20 }}>
                                    <p className="pm-card-title">Scan Report</p>
                                    <p className="pm-muted" style={{ fontSize: 13, margin: "0 0 12px" }}>
                                        Export every component scan in the selected dates — station scans, overrides,
                                        vendor gate and re-journeys, each labelled by type.
                                    </p>
                                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#555" }}>
                                            From
                                            <input type="date" value={scanReportFrom} max={scanReportTo || undefined} onChange={(e) => setScanReportFrom(e.target.value)} style={{ border: "1px solid #ddd", borderRadius: 6, padding: "7px 10px", fontSize: 13 }} />
                                        </label>
                                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#555" }}>
                                            To
                                            <input type="date" value={scanReportTo} min={scanReportFrom || undefined} onChange={(e) => setScanReportTo(e.target.value)} style={{ border: "1px solid #ddd", borderRadius: 6, padding: "7px 10px", fontSize: 13 }} />
                                        </label>
                                        <div style={{ display: "flex", gap: 6 }}>
                                            <button className="pm-view-all-btn" onClick={() => setScanReportRange(1)}>Today</button>
                                            <button className="pm-view-all-btn" onClick={() => setScanReportRange(7)}>Last 7 days</button>
                                            <button className="pm-view-all-btn" onClick={() => setScanReportRange(30)}>Last 30 days</button>
                                        </div>
                                        <button
                                            onClick={handleScanReportExport}
                                            disabled={scanReportBusy}
                                            style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, background: "#d5b85a", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: scanReportBusy ? "wait" : "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", opacity: scanReportBusy ? 0.7 : 1 }}
                                        >
                                            {scanReportBusy ? "Exporting…" : "⬇ Export CSV"}
                                        </button>
                                    </div>
                                </div>
                                <ProductionOverrides currentUserEmail={currentUserEmail} />
                            </div>
                        )}
                        {/* ===== VENDORS (Directory + At External Vendors sub-tabs) ===== */}
                        {activeTab === "vendors" && (
                            <div className="pm-orders-tab">
                                <div className="pm-subtab-bar">
                                    <button className={`pm-subtab ${subTab === "directory" ? "active" : ""}`} onClick={() => setSubTab("directory")}>Vendor Directory</button>
                                    <button className={`pm-subtab ${subTab === "external" ? "active" : ""}`} onClick={() => setSubTab("external")}>At External Vendors</button>
                                </div>
                                {subTab === "external" ? (
                                    <>
                                        <p className="pm-card-title" style={{ margin: "0 0 14px 2px", color: "#8B7355" }}>At External Vendors — Items Out & History (All Channels)</p>
                                        <ExternalVendorsPanel rows={extMovements} loading={extMovementsLoading} onOrderClick={goToOrder} />
                                    </>
                                ) : (
                                    <VendorRequest currentUserEmail={currentUserEmail} />
                                )}
                            </div>
                        )}
                        {activeTab === "replacements" && (
                            <div className="pm-orders-tab">
                                <ReplacementApprovals currentUserEmail={currentUserEmail} />
                            </div>
                        )}
                        {/* ===== STAFF TAB (no DB tables yet) ===== */}
                        {activeTab === "staff" && <div className="pm-placeholder-tab"><p className="pm-placeholder-title">Staff</p><p className="pm-muted">Staff capacity & attendance tracking — requires attendance tables (coming soon)</p></div>}
                        {activeTab === "profile" && (
                            <div className="pm-placeholder-tab"><p className="pm-placeholder-title">Profile</p>
                                {profile && (<div className="pm-profile-box">
                                    <div className="pm-profile-row"><span className="pm-plabel">Name</span><span className="pm-pvalue">{profile.name || "—"}</span></div>
                                    <div className="pm-profile-row"><span className="pm-plabel">Email</span><span className="pm-pvalue">{profile.email || "—"}</span></div>
                                    <div className="pm-profile-row"><span className="pm-plabel">Role</span><span className="pm-pvalue">Production Manager</span></div>
                                    <div className="pm-profile-row"><span className="pm-plabel">Store</span><span className="pm-pvalue">{profile.store || "All"}</span></div>
                                </div>)}
                            </div>
                        )}
                    </main>
                </div>
            </div>

            {/* TEMP (prod): stage drill-down modal hidden — re-enable when scan flow is ready.
            {stageDrillDown && (() => {
                const stageLabel = getStageLabel(stageDrillDown) || stageDrillDown;
                const stageColor = getStageColor(stageDrillDown) || "#666";
                return (
                    <div className="pm-stage-modal-overlay" onClick={() => setStageDrillDown(null)}>
                        <div className="pm-stage-modal" onClick={(e) => e.stopPropagation()}>
                            <div className="pm-stage-modal-head">
                                <div>
                                    <span className="pm-stage-modal-dot" style={{ background: stageColor }} />
                                    <h3 className="pm-stage-modal-title">{stageLabel}</h3>
                                    <span className="pm-stage-modal-count">{drillDownComponents.length} components</span>
                                </div>
                                <button className="pm-stage-modal-close" onClick={() => setStageDrillDown(null)}>×</button>
                            </div>
                            <div className="pm-stage-modal-body">
                                {drillDownComponents.length === 0 ? (
                                    <p className="pm-stage-modal-empty">No components currently at this stage.</p>
                                ) : (
                                    <table className="pm-stage-modal-table">
                                        <thead>
                                            <tr>
                                                <th>Order #</th>
                                                <th>Component</th>
                                                <th>Type</th>
                                                <th>Barcode</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {drillDownComponents.map((c) => (
                                                <tr key={c.id}>
                                                    <td className="pm-stage-modal-order">{c.order_no}</td>
                                                    <td>{c.component_label || c.component_type || "—"}</td>
                                                    <td style={{ textTransform: "capitalize", color: "#888" }}>{c.component_type}</td>
                                                    <td className="pm-stage-modal-barcode">{c.barcode}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}
            */}
        </>
    );
}