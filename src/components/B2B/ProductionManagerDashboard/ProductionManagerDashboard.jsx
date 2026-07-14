import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
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
import ReJourneyPanel from "../../../components/ReJourneyPanel";
import { fetchReJourneys } from "../../../utils/reJourneys";
import Badge from "../../../components/Badge";
import ComponentStageBadge from "../../../components/ComponentStageBadge";
import ComponentJourneyModal from "../../../components/ComponentJourneyModal";
import "../../../components/ProductionOverrides.css";
import { downloadWarehousePdf } from "../../../utils/pdfUtils";
import { PRODUCTION_STAGES, getStageLabel, getStageColor, getStageGroupKey, STAGE_GROUPS, enrichComponentsWithMovements, classifyComponentForStageCard } from "../../../utils/barcodeService";
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
};

// ==================== STATUS TABS ====================
const STATUS_TABS = [
    { value: "all", label: "All Orders" },
    { value: "unfulfilled", label: "Unfulfilled" },
    { value: "completed", label: "Completed" },
    { value: "delivered", label: "Delivered" },
    { value: "cancelled", label: "Cancelled" },
];


const StatCard = ({ title, value, subtitle, highlight, icon }) => (
    <div className={`pm-stat-card-inner ${highlight ? "pm-stat-highlight" : ""}`}>
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

// ==================== CHANNEL BREAKDOWN ROW ====================
const ChannelRow = ({ label, count, percentage, color }) => (
    <div className="pm-channel-row">
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

    // Restore tab from navigation state (e.g. when returning from order detail)
    const [activeTab, setActiveTab] = useState(location.state?.activeTab || "overview");
    const [highlightOrderId, setHighlightOrderId] = useState(location.state?.highlightOrderId || null);
    const [qcHistory, setQcHistory] = useState([]);
    const [qcHistoryLoading, setQcHistoryLoading] = useState(false);
    const [reJourneys, setReJourneys] = useState([]);
    const [reJourneysLoading, setReJourneysLoading] = useState(false);
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
    const [orderSearch, setOrderSearch] = useState("");
    const [orderSearchField, setOrderSearchField] = useState("order_no");
    const [channelFilter, setChannelFilter] = useState("all");
    const [statusTab, setStatusTab] = useState("all");
    const [sortBy, setSortBy] = useState("newest");
    const [filters, setFilters] = useState({ dateFrom: "", dateTo: "", minPrice: 0, maxPrice: 500000, payment: [], priority: [], store: [], salesperson: "", stage: [], stageKind: "both" });
    // Overview period filter (scopes the stage cards by each component's ORDER date).
    const [overviewPeriod, setOverviewPeriod] = useState("all"); // all | day | month | year | custom
    const [overviewFrom, setOverviewFrom] = useState("");
    const [overviewTo, setOverviewTo] = useState("");
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
    const [warehousePdfLoading, setWarehousePdfLoading] = useState(null);

    // Delivery Report state
    const [drDateFrom, setDrDateFrom] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return d.toISOString().split("T")[0];
    });
    const [drDateTo, setDrDateTo] = useState(() => new Date().toISOString().split("T")[0]);
    const [drChannel, setDrChannel] = useState("all");
    const [drBucket, setDrBucket] = useState("all");
    const [drSearch, setDrSearch] = useState("");

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
                    .select("id, order_id, order_no, barcode, component_type, component_label, current_stage, item_index, is_outside_wh, stage_updated_at")
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

    // Load QC records (all channels) when the QC History tab opens.
    useEffect(() => {
        if (activeTab !== "qc_history") return;
        let cancelled = false;
        (async () => {
            setQcHistoryLoading(true);
            const recs = await fetchQcRecords({ paged: true });
            if (!cancelled) { setQcHistory(recs); setQcHistoryLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [activeTab]);

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
    useEffect(() => { setCurrentPage(1); }, [orderSearch, orderSearchField, statusTab, channelFilter, filters, sortBy]);

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
        if (type === "date") setFilters(prev => ({ ...prev, dateFrom: "", dateTo: "" }));
        else if (type === "price") setFilters(prev => ({ ...prev, minPrice: 0, maxPrice: 500000 }));
        else if (type === "salesperson") setFilters(prev => ({ ...prev, salesperson: "" }));
        else if (type === "stage") setFilters(prev => ({ ...prev, stage: prev.stage.filter(v => v !== value), stageKind: "both" }));
        else setFilters(prev => ({ ...prev, [type]: prev[type].filter(v => v !== value) }));
    };

    const clearAllFilters = () => setFilters({ dateFrom: "", dateTo: "", minPrice: 0, maxPrice: 500000, payment: [], priority: [], store: [], salesperson: "", stage: [], stageKind: "both" });

    // Clicking a stage-count card: scope the orders list to that one stage and
    // jump to the All Orders tab (status reset to "all" so nothing else hides it).
    // kind: 'both' (whole card), 'internal' (in-house sub-count), 'external' (vendor).
    const handleStageCardClick = (stageKey, kind = "both") => {
        setFilters(prev => ({ ...prev, stage: [stageKey], stageKind: kind }));
        setStatusTab("all");
        setActiveTab("orders");
    };

    const appliedFilters = useMemo(() => {
        const chips = [];
        if (filters.dateFrom || filters.dateTo) {
            const label = filters.dateFrom && filters.dateTo ? `${filters.dateFrom} to ${filters.dateTo}` : filters.dateFrom ? `From ${filters.dateFrom}` : `Until ${filters.dateTo}`;
            chips.push({ type: "date", label });
        }
        if (filters.minPrice > 0 || filters.maxPrice < 500000) chips.push({ type: "price", label: `₹${(filters.minPrice / 1000).toFixed(0)}K - ₹${(filters.maxPrice / 1000).toFixed(0)}K` });
        filters.payment.forEach(p => chips.push({ type: "payment", value: p, label: p === "unpaid" ? "Unpaid (COD)" : p.charAt(0).toUpperCase() + p.slice(1) }));
        filters.priority.forEach(p => chips.push({ type: "priority", value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }));
        filters.store.forEach(s => chips.push({ type: "store", value: s, label: s }));
        filters.stage.forEach(k => {
            const base = STAGE_GROUPS.find(g => g.key === k)?.label || k;
            const suffix = filters.stageKind === "internal" ? " · In-house" : filters.stageKind === "external" ? " · Vendor" : "";
            chips.push({ type: "stage", value: k, label: base + suffix });
        });
        if (filters.salesperson) chips.push({ type: "salesperson", label: filters.salesperson });
        return chips;
    }, [filters]);

    const handleExportCSV = () => {
        if (filteredOrders.length === 0) return;
        const headers = ["Order No", "Product Name", "Customer Name", "Size", "Amount", "Top Color", "Bottom Color", "SA Name", "Store", "Status", "Priority", "Notes", "Order Date", "Delivery Date"];
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
                order.delivery_date ? new Date(order.delivery_date).toLocaleDateString("en-GB") : "",
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

    // Mark an order as complete (delivered) — triggered from production tab
    const handleMarkComplete = async (order, e) => {
        if (e) e.stopPropagation();
        const confirmed = await new Promise((resolve) => {
            showPopup({
                type: "confirm",
                title: "Mark as Complete",
                message: `Mark order ${order.order_no} as delivered? This will finalise the order.`,
                confirmText: "Yes, Mark Complete",
                cancelText: "Cancel",
                onConfirm: () => resolve(true),
                onCancel: () => resolve(false),
            });
        });
        if (!confirmed) return;
        try {
            setActionLoading(order.id);
            // Dispatch every active component (badge -> Dispatched, non-scannable),
            // then stamp the order as delivered with the dispatch metadata (the
            // "Mark as Delivered" semantics + Recently-Dispatched fields).
            const { data: rpcData, error: rpcErr } = await supabase.rpc("manual_complete_order", {
                p_order_id: order.id, p_by: currentUserEmail,
            });
            if (rpcErr || rpcData?.success === false) throw new Error(rpcErr?.message || rpcData?.message || "Could not update order");
            const { error } = await supabase
                .from("orders")
                .update({
                    status: "delivered",
                    production_status: "dispatched",
                    delivered_at: new Date().toISOString(),
                    dispatched_at: order.dispatched_at || new Date().toISOString(),
                    dispatched_by: order.dispatched_by || currentUserEmail,
                })
                .eq("id", order.id);
            if (error) throw error;
            setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "delivered", production_status: "dispatched", warehouse_stage: "dispatched", delivered_at: new Date().toISOString() } : o));
            // Re-fetch components so the piece badges reflect "Dispatched" live.
            loadAllData();
            showPopup({ type: "success", title: "Done", message: `Order ${order.order_no} marked as delivered.` });
        } catch (err) {
            console.error("Mark complete error:", err);
            showPopup({ type: "error", title: "Failed", message: err.message || "Could not update order" });
        } finally {
            setActionLoading(null);
        }
    };

    // Temporary Manual Completion — force the order completed WITHOUT the normal
    // production flow (bypass), behind a confirm. Sets status='completed' (same
    // as the Production Head dashboards), separate from 'Mark as Delivered'.
    const markManualComplete = async (order, e) => {
        if (e) e.stopPropagation();
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
        try {
            setActionLoading(order.id);
            // Force-complete: dispatch every active component (badge -> Dispatched,
            // pieces non-scannable) + mark the order completed, via one RPC.
            const { data, error } = await supabase.rpc("manual_complete_order", {
                p_order_id: order.id, p_by: currentUserEmail,
            });
            if (error || data?.success === false) throw new Error(error?.message || data?.message || "Could not update order");
            setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "completed", warehouse_stage: "dispatched" } : o));
            // Re-fetch components so the piece badges reflect "Dispatched" live.
            loadAllData();
            showPopup({ type: "success", title: "Done", message: `Order ${order.order_no} marked as completed.` });
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


    // Channel + status counts are computed by the same logic over either the
    // full order set (shared with the Production tab) or the Overview
    // period-filtered set (overviewOrders). Extracted so the Overview filter can
    // reuse it without changing the shared (full-orders) versions.
    const computeChannelStats = (list) => {
        const total = list.length;
        const b2b = list.filter(o => o.is_b2b === true).length;
        const store = total - b2b;
        return {
            total, b2b, store: store > 0 ? store : 0,
            b2bPct: total > 0 ? Math.round((b2b / total) * 100) : 0,
            storePct: total > 0 ? Math.round((store > 0 ? store : 0) / total * 100) : 0,
        };
    };
    const computeStatusStats = (list) => {
        const pending = list.filter(o => o.status === "pending" || o.status === "order_received" || o.status === "confirmed").length;
        const inProd = list.filter(o => o.status === "prepared" || o.production_status === "in_production").length;
        const dispatched = list.filter(o => o.status === "delivered" || o.production_status === "dispatched").length;
        const readyForDispatch = list.filter(o => o.production_status === "ready_for_dispatch").length;
        return { pending, inProd, dispatched, readyForDispatch };
    };
    const channelStats = useMemo(() => computeChannelStats(orders), [orders]); // eslint-disable-line react-hooks/exhaustive-deps
    const statusStats = useMemo(() => computeStatusStats(orders), [orders]); // eslint-disable-line react-hooks/exhaustive-deps

    // Human label for the current Overview period (used in the revenue card etc.).
    const overviewPeriodLabel =
        overviewPeriod === "day" ? "Today" :
        overviewPeriod === "month" ? "This Month" :
        overviewPeriod === "year" ? "This Year" :
        overviewPeriod === "custom" ? "Custom Range" : "All Time";

    // Per-stage component counts. Source of truth: order_components.current_stage
    // (advanced live by the warehouse Scan Station). One row per top/bottom/
    // dupatta/extra so a single order contributes multiple data points.
    // Orders placed within the selected Overview period. Their COMPONENTS
    // (overviewComponents) feed the "Orders by Production Stage" cards, which
    // count pieces and split in-house vs out-at-vendor.
    const overviewOrders = useMemo(() => {
        if (overviewPeriod === "all") return orders;
        const now = new Date();
        let from = null, to = null;
        if (overviewPeriod === "day") {
            from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (overviewPeriod === "month") {
            from = new Date(now.getFullYear(), now.getMonth(), 1);
        } else if (overviewPeriod === "year") {
            from = new Date(now.getFullYear(), 0, 1);
        } else if (overviewPeriod === "custom") {
            from = overviewFrom ? new Date(overviewFrom) : null;
            to = overviewTo ? new Date(new Date(overviewTo).setHours(23, 59, 59, 999)) : null;
        }
        return orders.filter((o) => {
            if (!o.created_at) return false;
            const dt = new Date(o.created_at);
            if (from && dt < from) return false;
            if (to && dt > to) return false;
            return true;
        });
    }, [orders, overviewPeriod, overviewFrom, overviewTo]);

    // Components whose stage activity (stage_updated_at) falls in the selected
    // Overview period — powers the piece-count stage cards with the in-house/
    // vendor split. Filtered by the PIECE's own scan time, not its order's
    // created_at, so a scan today on an old order shows up under "Today".
    // (components carry is_outside_wh + stages_outside from enrichComponentsWithMovements.)
    const overviewComponents = useMemo(() => {
        if (overviewPeriod === "all") return components;
        const now = new Date();
        let from = null, to = null;
        if (overviewPeriod === "day") {
            from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (overviewPeriod === "month") {
            from = new Date(now.getFullYear(), now.getMonth(), 1);
        } else if (overviewPeriod === "year") {
            from = new Date(now.getFullYear(), 0, 1);
        } else if (overviewPeriod === "custom") {
            from = overviewFrom ? new Date(overviewFrom) : null;
            to = overviewTo ? new Date(new Date(overviewTo).setHours(23, 59, 59, 999)) : null;
        }
        return components.filter((c) => {
            const ts = c.stage_updated_at || c.created_at;
            if (!ts) return false;
            const dt = new Date(ts);
            if (from && dt < from) return false;
            if (to && dt > to) return false;
            return true;
        });
    }, [components, overviewPeriod, overviewFrom, overviewTo]);

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

    const computeProductionMetrics = (orders, statusStats) => {
        const now = new Date();
        const activeOrders = orders.filter(o => o.status !== "delivered" && o.status !== "completed" && o.status !== "cancelled");
        const delayed = activeOrders.filter(o => o.delivery_date && new Date(o.delivery_date) < now);
        const reworkOrders = orders.filter(o => o.is_rework);
        const qcFailed = orders.filter(o => o.qc_fail_reason);
        const reworkPct = orders.length > 0 ? ((reworkOrders.length / orders.length) * 100) : 0;
        const qcFailRate = orders.length > 0 ? ((qcFailed.length / orders.length) * 100) : 0;

        // Bottleneck logic — only orders genuinely in production flow
        // Excludes raw "pending" orders (not yet confirmed, not a production stage)
        const inFlowOrders = activeOrders.filter(o =>
            o.warehouse_stage ||
            o.status === "confirmed" ||
            o.status === "prepared"
        );

        const stageData = {};
        inFlowOrders.forEach(o => {
            const stage = o.warehouse_stage || o.status || "unknown";
            if (!stageData[stage]) stageData[stage] = { total: 0, overdue: 0, totalOverdueDays: 0 };
            stageData[stage].total++;
            if (o.delivery_date && new Date(o.delivery_date) < now) {
                const days = Math.ceil((now - new Date(o.delivery_date)) / (1000 * 60 * 60 * 24));
                stageData[stage].overdue++;
                stageData[stage].totalOverdueDays += days;
            }
        });

        const stuckByStage = Object.entries(stageData)
            .map(([name, data]) => ({
                name: name.replace(/_/g, " "),
                total: data.total,
                overdue: data.overdue,
                avgOverdueDays: data.overdue > 0 ? Math.round(data.totalOverdueDays / data.overdue) : 0,
                severity: data.overdue > 0 ? "critical" : data.total >= 3 ? "warning" : "normal",
            }))
            .sort((a, b) => b.overdue - a.overdue || b.total - a.total);

        const criticalBottlenecks = stuckByStage.filter(s => s.severity === "critical").length;
        const topBottleneck = stuckByStage[0] || null;

        const readyNotDispatched = orders.filter(o => o.ready_for_dispatch_at && !o.dispatched_at && o.status !== "cancelled");
        const overdueDispatch = readyNotDispatched.filter(o => o.delivery_date && new Date(o.delivery_date) < now);

        return {
            productionLoad: { active: statusStats.inProd, percentage: activeOrders.length > 0 ? Math.round((statusStats.inProd / activeOrders.length) * 100) : 0 },
            bottlenecks: { count: criticalBottlenecks, critical: criticalBottlenecks, topBottleneck: topBottleneck?.name || "None", topOverdue: topBottleneck?.overdue || 0, topAvgDays: topBottleneck?.avgOverdueDays || 0 },
            rework: { percentage: reworkPct.toFixed(1), totalReworks: reworkOrders.length, trend: reworkPct < 5 ? "down" : "up" },
            dispatchBacklog: { pending: readyNotDispatched.length, overdue: overdueDispatch.length, avgDelay: delayed.length > 0 ? `${Math.round(delayed.reduce((s, o) => s + (now - new Date(o.delivery_date)) / (1000 * 60 * 60 * 24), 0) / delayed.length)}d` : "0d" },
            delayed: delayed.length, delayRate: activeOrders.length > 0 ? ((delayed.length / activeOrders.length) * 100).toFixed(1) : "0",
            qcFailed: qcFailed.length, qcFailRate: qcFailRate.toFixed(1), stuckByStage,
            avgLeadTime: (() => { let total = 0, count = 0; orders.forEach(o => { if (o.in_production_at && (o.ready_for_dispatch_at || o.delivered_at)) { const days = (new Date(o.ready_for_dispatch_at || o.delivered_at) - new Date(o.in_production_at)) / (1000 * 60 * 60 * 24); if (days > 0 && days < 365) { total += days; count++; } } }); return count > 0 ? (total / count).toFixed(1) : "0"; })(),
            exceedingDelivery: orders.filter(o => o.status !== "delivered" && o.status !== "completed" && o.status !== "cancelled" && o.delivery_date && new Date(o.delivery_date) < now).sort((a, b) => new Date(a.delivery_date) - new Date(b.delivery_date)),
        };
    };
    const productionMetrics = useMemo(() => computeProductionMetrics(orders, statusStats), [orders, statusStats]); // eslint-disable-line react-hooks/exhaustive-deps

    const recentOrders = useMemo(() => orders.slice(0, 10), [orders]);

    // ==================== SALES & REVENUE METRICS (Overview, period-scoped) ====================
    // Computed over the selected Overview period (overviewOrders — orders PLACED
    // in the window). Revenue is the period TOTAL (not month/year), so the whole
    // Overview reflects the chosen filter consistently.
    const salesMetrics = useMemo(() => {
        const now = new Date();
        const isRevenue = isRevenueOrder; // shared rule — src/utils/revenue.js

        // Total revenue for the period.
        const revenuePeriod = overviewOrders.reduce((sum, o) => sum + (isRevenue(o) ? Number(o.grand_total || 0) : 0), 0);

        // Pending + Delayed (open orders in the period).
        const openOrders = overviewOrders.filter(o => o.status !== "delivered" && o.status !== "completed" && o.status !== "cancelled");
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

    // Overview-scoped copies of the SHARED memos, computed over the period set.
    // The originals (channelStats/statusStats/productionMetrics over full orders)
    // stay untouched so the Production tab is unaffected.
    const statusStatsOv = useMemo(() => computeStatusStats(overviewOrders), [overviewOrders]); // eslint-disable-line react-hooks/exhaustive-deps
    const channelStatsOv = useMemo(() => computeChannelStats(overviewOrders), [overviewOrders]); // eslint-disable-line react-hooks/exhaustive-deps
    const productionMetricsOv = useMemo(() => computeProductionMetrics(overviewOrders, statusStatsOv), [overviewOrders, statusStatsOv]); // eslint-disable-line react-hooks/exhaustive-deps
    const recentOrdersOv = useMemo(() => overviewOrders.slice(0, 10), [overviewOrders]);

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
            if (channelFilter === "b2b" && !o.is_b2b) return false;
            if (channelFilter === "store" && o.is_b2b) return false;
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
                    case "order_no":
                    default:
                        return (o.order_no || "").toLowerCase().includes(q);
                }
            });
        }
        if (filters.dateFrom || filters.dateTo) {
            result = result.filter(o => {
                const d = new Date(o.created_at);
                if (filters.dateFrom && d < new Date(filters.dateFrom)) return false;
                if (filters.dateTo && d > new Date(filters.dateTo + "T23:59:59")) return false;
                return true;
            });
        }
        if (filters.minPrice > 0 || filters.maxPrice < 500000) {
            result = result.filter(o => { const t = o.grand_total || 0; return t >= filters.minPrice && t <= filters.maxPrice; });
        }
        if (filters.payment.length > 0) result = result.filter(o => filters.payment.includes(getPaymentStatus(o)));
        if (filters.priority.length > 0) result = result.filter(o => filters.priority.includes(getPriority(o)));
        if (filters.store.length > 0) result = result.filter(o => filters.store.includes(o.salesperson_store));
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
    }, [filteredByStatus, orderSearch, orderSearchField, filters, sortBy, vendorMap, orderStageGroups]);

    const orderTabCounts = useMemo(() => {
        const base = channelFilter === "b2b" ? orders.filter(o => o.is_b2b) : channelFilter === "store" ? orders.filter(o => !o.is_b2b) : orders;
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

    const getChannelLabel = (order) => { if (order.is_b2b) return "B2B"; return "Store"; };
    const getChannelClass = (order) => { if (order.is_b2b) return "pm-channel-b2b"; return "pm-channel-store"; };

    const getStatusLabel = (order) => {
        if (order.production_status === "dispatched" || order.status === "delivered") return "Dispatched";
        if (order.production_status === "ready_for_dispatch") return "Ready";
        if (order.production_status === "in_production" || order.status === "prepared") return "In Production";
        if (order.status === "cancelled") return "Cancelled";
        return "Pending";
    };

    const getStatusClass = (status) => {
        switch (status) { case "Dispatched": return "pm-status-dispatched"; case "Ready": return "pm-status-ready"; case "In Production": return "pm-status-inprod"; case "Cancelled": return "pm-status-cancelled"; default: return "pm-status-pending"; }
    };

    const getStatusBadgeClass = (status) => {
        switch (status?.toLowerCase()) { case "delivered": return "pm-badge-delivered"; case "cancelled": return "pm-badge-cancelled"; case "prepared": return "pm-badge-prepared"; case "confirmed": return "pm-badge-confirmed"; default: return "pm-badge-pending"; }
    };

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

    if (loading) return <p className="loading-text">Loading Dashboard...</p>;

    return (
        <>
            {PopupComponent}

            {/* ===== COMPONENT JOURNEY MODAL (shared) ===== */}
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
                                        <option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="prepared">Prepared</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option>
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
                            <a className={`pm-menu-item ${activeTab === "qc_history" ? "active" : ""}`} onClick={() => { setActiveTab("qc_history"); setShowSidebar(false); }}>QC History</a>
                            <a className={`pm-menu-item ${activeTab === "rejourneys" ? "active" : ""}`} onClick={() => { setActiveTab("rejourneys"); setShowSidebar(false); }}>Re-journeys</a>
                            <a className={`pm-menu-item ${activeTab === "dispatch" ? "active" : ""}`} onClick={() => { setActiveTab("dispatch"); setShowSidebar(false); }}>Dispatch</a>
                            <a className={`pm-menu-item ${activeTab === "delivery_report" ? "active" : ""}`} onClick={() => { setActiveTab("delivery_report"); setShowSidebar(false); }}>Delivery Report</a>
                            <a className={`pm-menu-item ${activeTab === "overrides" ? "active" : ""}`} onClick={() => { setActiveTab("overrides"); setShowSidebar(false); }}>Scan & Overrides</a>
                            <a className={`pm-menu-item ${activeTab === "vendors" ? "active" : ""}`} onClick={() => { setActiveTab("vendors"); setShowSidebar(false); }}>Vendors</a>
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
                                    <p className="pm-card-title" style={{ margin: 0, color: "#8B7355" }}>Orders by Production Stage</p>
                                    <div className="pm-period-pills">
                                        {[
                                            { key: "all", label: "All Time" },
                                            { key: "day", label: "Today" },
                                            { key: "month", label: "This Month" },
                                            { key: "year", label: "This Year" },
                                            { key: "custom", label: "Custom" },
                                        ].map((p) => (
                                            <button
                                                key={p.key}
                                                className={`pm-period-pill ${overviewPeriod === p.key ? "active" : ""}`}
                                                onClick={() => setOverviewPeriod(p.key)}
                                            >{p.label}</button>
                                        ))}
                                    </div>
                                </div>
                                {overviewPeriod === "custom" && (
                                    <div className="pm-period-custom">
                                        <input type="date" value={overviewFrom} onChange={(e) => setOverviewFrom(e.target.value)} />
                                        <span>→</span>
                                        <input type="date" value={overviewTo} min={overviewFrom || undefined} onChange={(e) => setOverviewTo(e.target.value)} />
                                    </div>
                                )}
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
                                        title="Pending / Delayed Orders"
                                        value={`${salesMetrics.pendingCount} / ${salesMetrics.delayedCount}`}
                                        subtitle={salesMetrics.delayedCount > 0 ? `${salesMetrics.delayedCount} past delivery date` : "All on track"}
                                        highlight={salesMetrics.delayedCount > 0}
                                        icon={Icons.clock}
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
                                </div>

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

                                {/* ===== PRODUCTION METRICS SECTION ===== */}
                                <p className="pm-card-title" style={{ margin: "18px 0 10px 2px", color: "#8B7355" }}>Production Overview</p>
                                <div className="pm-stats-row-3">
                                    <StatCard title="Total Orders (All Channels)" value={formatIndianNumber(channelStatsOv.total)} subtitle={`B2B: ${channelStatsOv.b2b} | Store: ${channelStatsOv.store}`} highlight={true} icon={Icons.package} />
                                    <StatCard title="Production Load" value={`${productionMetricsOv.productionLoad.percentage}%`} subtitle={`${productionMetricsOv.productionLoad.active} in production`} icon={Icons.gear} />
                                    <StatCard title="Bottlenecks" value={productionMetricsOv.bottlenecks.count} subtitle={productionMetricsOv.bottlenecks.count > 0 ? `${productionMetricsOv.bottlenecks.topBottleneck} · ${productionMetricsOv.bottlenecks.topOverdue} overdue · avg ${productionMetricsOv.bottlenecks.topAvgDays}d late` : "No overdue stages"} highlight={productionMetricsOv.bottlenecks.count > 0} icon={Icons.warning} />
                                </div>
                                <div className="pm-stats-row-3">
                                    <StatCard title="Delayed Orders" value={productionMetricsOv.delayed} subtitle={`Delay rate: ${productionMetricsOv.delayRate}%`} highlight={productionMetricsOv.delayed > 0} icon={Icons.clock} />
                                    <StatCard title="Rework %" value={`${productionMetricsOv.rework.percentage}%`} subtitle={`${productionMetricsOv.rework.totalReworks} items ${"\u00B7"} ${productionMetricsOv.rework.trend === "down" ? "\u2193 Improving" : "\u2191 Rising"}`} icon={Icons.refresh} />
                                    <StatCard title="Dispatch Backlog" value={productionMetricsOv.dispatchBacklog.pending} subtitle={`${productionMetricsOv.dispatchBacklog.overdue} overdue ${"\u00B7"} Avg: ${productionMetricsOv.dispatchBacklog.avgDelay}`} highlight={productionMetricsOv.dispatchBacklog.overdue > 0} icon={Icons.truck} />
                                </div>
                                <div className="pm-channel-card">
                                    <p className="pm-card-title">Orders by Channel</p>
                                    <div className="pm-channel-body">
                                        <ChannelRow label="Store (Offline)" count={channelStatsOv.store} percentage={channelStatsOv.storePct} color="#2e7d32" />
                                        <ChannelRow label="B2B" count={channelStatsOv.b2b} percentage={channelStatsOv.b2bPct} color="#d5b85a" />
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
                                            {[{ label: "Pending", count: statusStatsOv.pending, cls: "pm-dot-pending" }, { label: "In Production", count: statusStatsOv.inProd, cls: "pm-dot-inprod" }, { label: "Ready for Dispatch", count: statusStatsOv.readyForDispatch, cls: "pm-dot-ready" }, { label: "Dispatched", count: statusStatsOv.dispatched, cls: "pm-dot-dispatched" }].map(s => (
                                                <div className="pm-pipeline-stage" key={s.label}><div className="pm-pipeline-label"><span className={`pm-pipeline-dot ${s.cls}`}></span><span>{s.label}</span></div><span className="pm-pipeline-count">{s.count}</span></div>
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
                                            ]}
                                            selectedField={orderSearchField}
                                            onFieldChange={setOrderSearchField}
                                            query={orderSearch}
                                            onQueryChange={setOrderSearch}
                                            placeholder="Type to search..."
                                        />
                                    </div>
                                    <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} className="pm-filter-select" style={{ flex: "0 0 auto" }}>
                                        <option value="all">All Channels</option>
                                        <option value="b2b">B2B</option>
                                        <option value="store">Store</option>
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
                                    {/* Date Range */}
                                    <div style={{ position: "relative" }}>
                                        <button className={`pm-filter-select ${(filters.dateFrom || filters.dateTo) ? "pm-filter-active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "date" ? null : "date")} style={{ cursor: "pointer" }}>Date Range {"\u25BE"}</button>
                                        {openDropdown === "date" && (
                                            <div className="pm-dropdown-panel">
                                                <div className="pm-dropdown-title">Select Date Range</div>
                                                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                                    <input type="date" value={filters.dateFrom} onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))} style={{ padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }} />
                                                    <span>to</span>
                                                    <input type="date" value={filters.dateTo} onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value }))} style={{ padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }} />
                                                </div>
                                                <button className="pm-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                            </div>
                                        )}
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

                                    {/* Store */}
                                    <div style={{ position: "relative" }}>
                                        <button className={`pm-filter-select ${filters.store.length > 0 ? "pm-filter-active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "store" ? null : "store")} style={{ cursor: "pointer" }}>Store {"\u25BE"}</button>
                                        {openDropdown === "store" && (
                                            <div className="pm-dropdown-panel">
                                                <div className="pm-dropdown-title">Store</div>
                                                {["Delhi Store", "Ludhiana Store", "B2B"].map(opt => (
                                                    <label key={opt} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", fontSize: 13 }}>
                                                        <input type="checkbox" checked={filters.store.includes(opt)} onChange={() => toggleFilter("store", opt)} />
                                                        <span>{opt}</span>
                                                    </label>
                                                ))}
                                                <button className="pm-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                            </div>
                                        )}
                                    </div>

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
                                                        <div className="pm-oheader-item"><span className="pm-oheader-label">ORDER DATE</span><span className="pm-oheader-value">{formatDate(order.created_at) || "—"}</span></div>
                                                        <div className="pm-oheader-item"><span className="pm-oheader-label">DELIVERY</span><span className="pm-oheader-value">{formatDate(order.delivery_date) || "—"}</span></div>
                                                    </div>
                                                    <div className="pm-oheader-actions">
                                                        <span className={`pm-channel-tag ${getChannelClass(order)}`}>{getChannelLabel(order)}</span>
                                                        {/* Cancelled takes precedence over any stale production stage — a
                                                            cancelled order must read "Cancelled", not its last stage. */}
                                                        {order.status === "cancelled" ? (
                                                            <div className={`pm-order-status-badge ${getStatusBadgeClass("cancelled")}`}>Cancelled</div>
                                                        ) : getStageGroupKey(order.warehouse_stage) ? (
                                                            <Badge color={getStageColor(order.warehouse_stage)}>{getStageLabel(order.warehouse_stage)}</Badge>
                                                        ) : (
                                                            <div className={`pm-order-status-badge ${getStatusBadgeClass(order.status)}`}>{order.status === "pending" ? "Order Received" : (order.status === "order_received" ? "Order Received" : (order.status || "Order Received"))}</div>
                                                        )}
                                                        {order.priority && <span className={`pm-priority-tag pm-priority-${order.priority}`}>{order.priority === "urgent" ? "🔴" : order.priority === "high" ? "🟠" : "🟢"} {order.priority}</span>}
                                                    </div>
                                                </div>

                                                <div className="pm-order-content">
                                                    <div className="pm-product-thumb"><img src={imgSrc} alt={item.product_name || "Product"} /></div>
                                                    <div className="pm-product-details">
                                                        <div className="pm-product-name"><span className="pm-order-label">Product:</span><span className="pm-ovalue">{item.product_name || "—"}</span></div>
                                                        <div className="pm-product-name"><span className="pm-order-label">Client:</span><span className="pm-ovalue">{getClientName(order) || "—"}</span></div>
                                                        <div className="pm-product-name"><span className="pm-order-label">SA Name:</span><span className="pm-ovalue">{order.salesperson || "—"}{order.salesperson_store ? ` (${order.salesperson_store})` : ""}</span></div>
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
                                                    <button
                                                        className="pm-action-btn pm-complete-btn"
                                                        disabled={order.status === "completed" || order.status === "delivered" || order.status === "cancelled" || actionLoading === order.id}
                                                        onClick={(e) => handleMarkComplete(order, e)}
                                                    >
                                                        {order.status === "delivered" ? "Delivered" :
                                                            order.status === "completed" ? "Completed" :
                                                                order.status === "cancelled" ? "Cancelled" :
                                                                    actionLoading === order.id ? "Marking..." :
                                                                        "Mark as Delivered"}
                                                    </button>
                                                    {/* Force-complete bypassing the production flow (status='completed'). */}
                                                    {!["completed", "delivered", "cancelled"].includes(order.status) && (
                                                        <button
                                                            className="pm-action-btn pm-manual-complete-btn"
                                                            disabled={actionLoading === order.id}
                                                            onClick={(e) => markManualComplete(order, e)}
                                                        >
                                                            Temporary Manual Completion
                                                        </button>
                                                    )}
                                                    {/* <span className={`pm-recent-status ${getStatusClass(statusLabel)}`} style={{ marginLeft: "auto" }}>{statusLabel}</span> */}
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {filteredOrders.length > ORDERS_PER_PAGE && (
                                        <div className="pm-pagination">
                                            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="pm-pagination-btn">← Previous</button>
                                            <span className="pm-pagination-info">Page {currentPage} of {totalPages}</span>
                                            <button disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)} className="pm-pagination-btn">Next →</button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* ===== PRODUCTION TAB ===== */}
                        {activeTab === "production" && (
                            <div className="pm-orders-tab">
                                <h2 className="pm-tab-title">Production Tracking</h2>

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

                                <div className="pm-stats-row-3" style={{ marginTop: 16 }}>
                                    <StatCard title="In Production" value={statusStats.inProd} icon={Icons.gear} />
                                    <StatCard title="QC Failures" value={productionMetrics.qcFailed} subtitle={`${productionMetrics.qcFailRate}% fail rate`} highlight={productionMetrics.qcFailed > 0} icon={Icons.xCircle} />
                                    <StatCard title="Avg Lead Time" value={`${productionMetrics.avgLeadTime}d`} subtitle="Confirmation to QC" icon={Icons.timer} />
                                </div>
                                <div className="pm-stats-row-3">
                                    <StatCard title="Rework" value={productionMetrics.rework.totalReworks} subtitle={`${productionMetrics.rework.percentage}% rate`} icon={Icons.refresh} />
                                    <StatCard title="Delayed" value={productionMetrics.delayed} subtitle={`${productionMetrics.delayRate}% delay rate`} highlight={productionMetrics.delayed > 0} icon={Icons.warning} />
                                    <StatCard title="Received (Total)" value={channelStats.total} icon={Icons.inbox} />
                                </div>

                                {productionMetrics.stuckByStage.length > 0 && (
                                    <div className="pm-channel-card" style={{ marginTop: 20 }}>
                                        <p className="pm-card-title">Production Stage Bottlenecks</p>
                                        <div style={{ overflowX: "auto" }}>
                                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                                <thead>
                                                    <tr style={{ borderBottom: "2px solid #e0e0e0", textAlign: "left", background: "#fafafa" }}>
                                                        <th style={{ padding: "10px 12px" }}>Stage</th>
                                                        <th style={{ padding: "10px 12px", textAlign: "center" }}>Total Orders</th>
                                                        <th style={{ padding: "10px 12px", textAlign: "center" }}>Overdue</th>
                                                        <th style={{ padding: "10px 12px", textAlign: "center" }}>Avg Days Late</th>
                                                        <th style={{ padding: "10px 12px", textAlign: "center" }}>Status</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {productionMetrics.stuckByStage.map((s, i) => (
                                                        <tr key={i} style={{ borderBottom: "1px solid #f0f0f0", background: s.severity === "critical" ? "#fff5f5" : s.severity === "warning" ? "#fffde7" : "#fff" }}>
                                                            <td style={{ padding: "10px 12px", fontWeight: 600, textTransform: "capitalize" }}>{s.name}</td>
                                                            <td style={{ padding: "10px 12px", textAlign: "center" }}>{s.total}</td>
                                                            <td style={{ padding: "10px 12px", textAlign: "center", color: s.overdue > 0 ? "#c62828" : "#666", fontWeight: s.overdue > 0 ? 700 : 400 }}>{s.overdue > 0 ? s.overdue : "—"}</td>
                                                            <td style={{ padding: "10px 12px", textAlign: "center", color: s.avgOverdueDays > 0 ? "#c62828" : "#666" }}>{s.avgOverdueDays > 0 ? `${s.avgOverdueDays}d` : "—"}</td>
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
                                            {"🔴 Critical = stage has overdue orders · 🟡 Watch = 3+ orders piling up · 🟢 OK = on track"}
                                        </p>
                                    </div>
                                )}
                                {productionMetrics.stuckByStage.length === 0 && (
                                    <div className="pm-channel-card" style={{ marginTop: 20, textAlign: "center", padding: 32 }}>
                                        <p style={{ color: "#2e7d32", fontWeight: 600, fontSize: 15 }}>{"✅ No production bottlenecks detected"}</p>
                                        <p className="pm-muted" style={{ marginTop: 6 }}>All in-flow orders are on track</p>
                                    </div>
                                )}

                                {productionMetrics.exceedingDelivery.length > 0 && (
                                    <div className="pm-channel-card" style={{ marginTop: 20 }}>
                                        <p className="pm-card-title">{"\u26A0\uFE0F"} Exceeding Delivery Date ({productionMetrics.exceedingDelivery.length})</p>
                                        <div style={{ overflowX: "auto" }}>
                                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                                <thead><tr style={{ borderBottom: "2px solid #e0e0e0", textAlign: "left" }}><th style={{ padding: "8px 10px" }}>Order</th><th style={{ padding: "8px 10px" }}>Product</th><th style={{ padding: "8px 10px" }}>Delivery</th><th style={{ padding: "8px 10px" }}>Overdue</th><th style={{ padding: "8px 10px" }}>Stage</th><th style={{ padding: "8px 10px", textAlign: "center" }}>Actions</th></tr></thead>
                                                <tbody>{productionMetrics.exceedingDelivery.slice(0, 15).map(o => {
                                                    const overdue = Math.ceil((new Date() - new Date(o.delivery_date)) / (1000 * 60 * 60 * 24));
                                                    const isBusy = actionLoading === o.id;
                                                    return (<tr key={o.id} style={{ borderBottom: "1px solid #f0f0f0", cursor: "pointer" }} onClick={() => viewOrderDetails(o)}>
                                                        <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{o.order_no || "-"}</td>
                                                        <td style={{ padding: "8px 10px", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.items?.[0]?.product_name || "-"}</td>
                                                        <td style={{ padding: "8px 10px" }}>{formatDate(o.delivery_date)}</td>
                                                        <td style={{ padding: "8px 10px", color: "#c62828", fontWeight: 600 }}>{overdue}d</td>
                                                        <td style={{ padding: "8px 10px", textTransform: "capitalize" }}>{(o.warehouse_stage || (o.status === "pending" ? "order received" : (o.status || "order received"))).replace(/_/g, " ")}</td>
                                                        <td style={{ padding: "8px 10px", textAlign: "center", whiteSpace: "nowrap" }}>
                                                            <button
                                                                onClick={(e) => handleMarkComplete(o, e)}
                                                                disabled={isBusy}
                                                                className="pm-action-btn pm-action-complete"
                                                                title="Mark this order as delivered"
                                                            >
                                                                {isBusy ? "..." : "\u2713 Deliver"}
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
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ===== QC HISTORY TAB (all channels) ===== */}
                        {activeTab === "qc_history" && (
                            <>
                                <p className="pm-card-title" style={{ margin: "0 0 14px 2px", color: "#8B7355" }}>QC History — All Channels</p>
                                <QcHistoryPanel records={qcHistory} loading={qcHistoryLoading} />
                            </>
                        )}

                        {/* ===== RE-JOURNEYS TAB (all channels) ===== */}
                        {activeTab === "rejourneys" && (
                            <>
                                <p className="pm-card-title" style={{ margin: "0 0 14px 2px", color: "#8B7355" }}>Re-journeys — Currently in Rework (All Channels)</p>
                                <ReJourneyPanel rows={reJourneys} loading={reJourneysLoading} />
                            </>
                        )}

                        {/* ===== DISPATCH TAB ===== */}
                        {activeTab === "dispatch" && (() => {
                            const now = new Date();
                            const readyNotDispatched = orders.filter(o => o.ready_for_dispatch_at && !o.dispatched_at && o.status !== "cancelled");
                            // An order is dispatched when it actually reached a finished
                            // state — NOT only when the manual dispatched_at was set (that
                            // field is written only by the "Mark as Delivered" button, so
                            // the list used to freeze whenever orders were completed by any
                            // other path: barcode packaging, warehouse manual-complete, etc.).
                            const DONE = new Set(["delivered", "completed", "dispatched"]);
                            const isDispatched = (o) =>
                                DONE.has((o.status || "").toLowerCase()) || o.warehouse_stage === "dispatched";
                            // Best available "dispatched on" timestamp, newest signal first.
                            const dispatchedDate = (o) => o.dispatched_at || o.delivered_at || o.updated_at || null;
                            const recentlyDispatched = orders
                                .filter(isDispatched)
                                .sort((a, b) => new Date(dispatchedDate(b) || 0) - new Date(dispatchedDate(a) || 0))
                                .slice(0, 20);
                            const overdueReady = readyNotDispatched.filter(o => o.delivery_date && new Date(o.delivery_date) < now);
                            const avgWaitDays = readyNotDispatched.length > 0 ? (readyNotDispatched.reduce((s, o) => s + (now - new Date(o.ready_for_dispatch_at)) / (1000 * 60 * 60 * 24), 0) / readyNotDispatched.length).toFixed(1) : "0";
                            return (
                                <div className="pm-orders-tab">
                                    <h2 className="pm-tab-title">Dispatch Management</h2>
                                    <div className="pm-stats-row-3">
                                        <StatCard title="Ready for Dispatch" value={readyNotDispatched.length} highlight={readyNotDispatched.length > 0} icon={Icons.package} />
                                        <StatCard title="Overdue Dispatch" value={overdueReady.length} subtitle="Past delivery date" highlight={overdueReady.length > 0} icon={Icons.warning} />
                                        <StatCard title="Avg Wait Time" value={`${avgWaitDays}d`} subtitle="Since ready" icon={Icons.hourglass} />
                                    </div>

                                    {readyNotDispatched.length > 0 && (
                                        <div className="pm-channel-card" style={{ marginTop: 20 }}>
                                            <p className="pm-card-title">Pending Dispatch ({readyNotDispatched.length})</p>
                                            <div style={{ overflowX: "auto" }}>
                                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                                    <thead><tr style={{ borderBottom: "2px solid #e0e0e0", textAlign: "left" }}><th style={{ padding: "8px 10px" }}>Order</th><th style={{ padding: "8px 10px" }}>Customer</th><th style={{ padding: "8px 10px" }}>Product</th><th style={{ padding: "8px 10px" }}>Ready Since</th><th style={{ padding: "8px 10px" }}>Delivery Due</th><th style={{ padding: "8px 10px" }}>Wait</th></tr></thead>
                                                    <tbody>{readyNotDispatched.sort((a, b) => new Date(a.ready_for_dispatch_at) - new Date(b.ready_for_dispatch_at)).map(o => {
                                                        const waitDays = Math.ceil((now - new Date(o.ready_for_dispatch_at)) / (1000 * 60 * 60 * 24));
                                                        const isOverdue = o.delivery_date && new Date(o.delivery_date) < now;
                                                        return (<tr key={o.id} style={{ borderBottom: "1px solid #f0f0f0", background: isOverdue ? "#fff8e1" : "transparent" }}><td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{o.order_no || "-"}</td><td style={{ padding: "8px 10px" }}>{o.delivery_name || "-"}</td><td style={{ padding: "8px 10px", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.items?.[0]?.product_name || "-"}</td><td style={{ padding: "8px 10px" }}>{formatDate(o.ready_for_dispatch_at)}</td><td style={{ padding: "8px 10px", color: isOverdue ? "#c62828" : "inherit" }}>{formatDate(o.delivery_date) || "-"}</td><td style={{ padding: "8px 10px", fontWeight: 600, color: waitDays > 3 ? "#c62828" : "#333" }}>{waitDays}d</td></tr>);
                                                    })}</tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}

                                    {recentlyDispatched.length > 0 && (
                                        <div className="pm-channel-card" style={{ marginTop: 20 }}>
                                            <p className="pm-card-title">Recently Dispatched</p>
                                            <div style={{ overflowX: "auto" }}>
                                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                                    <thead><tr style={{ borderBottom: "2px solid #e0e0e0", textAlign: "left" }}><th style={{ padding: "8px 10px" }}>Order</th><th style={{ padding: "8px 10px" }}>Customer</th><th style={{ padding: "8px 10px" }}>Dispatched On</th><th style={{ padding: "8px 10px" }}>By</th></tr></thead>
                                                    <tbody>{recentlyDispatched.map(o => (<tr key={o.id} style={{ borderBottom: "1px solid #f0f0f0" }}><td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{o.order_no || "-"}</td><td style={{ padding: "8px 10px" }}>{getClientName(o) || "-"}</td><td style={{ padding: "8px 10px" }}>{formatDate(dispatchedDate(o)) || "-"}</td><td style={{ padding: "8px 10px" }}>{o.dispatched_by || "-"}</td></tr>))}</tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        {/* ===== DELIVERY REPORT TAB ===== */}
                        {activeTab === "delivery_report" && (() => {
                            const now = new Date();
                            const todayStr = now.toISOString().split("T")[0];

                            // Date range filter — applied to delivery_date for open orders, delivered_at for completed
                            const fromDate = drDateFrom ? new Date(drDateFrom + "T00:00:00") : null;
                            const toDate = drDateTo ? new Date(drDateTo + "T23:59:59") : null;

                            // Channel filter
                            const channelMatch = (o) => {
                                if (drChannel === "all") return true;
                                if (drChannel === "b2b") return !!o.is_b2b;
                                if (drChannel === "store") return !o.is_b2b;
                                return true;
                            };

                            // Bucketing helper: days = how late (negative = on-time)
                            const bucketOf = (daysLate) => {
                                if (daysLate <= 0) return "ontime";
                                if (daysLate <= 2) return "0_2";
                                if (daysLate <= 7) return "2_7";
                                if (daysLate <= 14) return "7_14";
                                return "14_plus";
                            };

                            // ==================== COMPLETED ORDERS (historical) ====================
                            // Delivered/Completed orders — compare delivered_at (or updated_at fallback) vs delivery_date
                            const completedRows = [];
                            orders.forEach(o => {
                                if (o.status !== "delivered" && o.status !== "completed") return;
                                if (!o.delivery_date) return;
                                if (!channelMatch(o)) return;

                                const actualDeliveryStr = o.delivered_at || o.updated_at;
                                if (!actualDeliveryStr) return;
                                const actualDate = new Date(actualDeliveryStr);
                                // Apply date range against actual delivery date
                                if (fromDate && actualDate < fromDate) return;
                                if (toDate && actualDate > toDate) return;

                                const promisedDate = new Date(o.delivery_date);
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
                                if (o.status === "delivered" || o.status === "completed" || o.status === "cancelled") return;
                                if (!o.delivery_date) return;
                                if (!channelMatch(o)) return;

                                const promisedDate = new Date(o.delivery_date);
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
                            const bucketStyle = (b) => {
                                switch (b) {
                                    case "ontime": return { bg: "#e8f5e9", fg: "#2e7d32", label: "On-time" };
                                    case "0_2": return { bg: "#fffde7", fg: "#f57f17", label: "0\u20132d late" };
                                    case "2_7": return { bg: "#fff3e0", fg: "#e65100", label: "2\u20137d late" };
                                    case "7_14": return { bg: "#ffebee", fg: "#c62828", label: "7\u201314d late" };
                                    case "14_plus": return { bg: "#b71c1c", fg: "#fff", label: "14+d critical" };
                                    default: return { bg: "#f5f5f5", fg: "#333", label: b };
                                }
                            };

                            // ==================== EXPORT ====================
                            const handleDrExport = () => {
                                const rows = [...filteredCompleted, ...filteredOpen];
                                if (rows.length === 0) {
                                    showPopup({ type: "info", title: "Nothing to export", message: "No orders match the current filters." });
                                    return;
                                }
                                const headers = ["Order No", "Type", "Customer", "SA Name", "Store", "Channel", "Product", "Size", "Amount", "Order Date", "Promised Delivery", "Actual Delivery", "Days Late", "Bucket", "Status"];
                                const csvRows = rows.map(r => {
                                    const o = r.order;
                                    const item = o.items?.[0] || {};
                                    return [
                                        o.order_no || "",
                                        r.isOpen ? "Open (Running Late)" : "Completed",
                                        getClientName(o) || "",
                                        o.salesperson || "",
                                        o.salesperson_store || "",
                                        o.is_b2b ? "B2B" : "Store",
                                        item.product_name || "",
                                        item.size || "",
                                        o.grand_total || 0,
                                        o.created_at ? new Date(o.created_at).toLocaleDateString("en-GB") : "",
                                        o.delivery_date ? new Date(o.delivery_date).toLocaleDateString("en-GB") : "",
                                        r.actualDelivery ? r.actualDelivery.toLocaleDateString("en-GB") : "Not yet delivered",
                                        r.daysLate <= 0 ? "On-time" : r.daysLate,
                                        bucketStyle(r.bucket).label,
                                        o.status || "",
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
                                            border: active ? `2px solid ${style.fg}` : "1px solid #e0e0e0",
                                            borderRadius: 12,
                                            padding: "14px 16px",
                                            transition: "all 0.15s",
                                            boxShadow: active ? "0 2px 8px rgba(0,0,0,0.08)" : "none",
                                        }}
                                    >
                                        <p style={{ fontSize: 12, color: "#666", margin: 0, fontWeight: 500 }}>{title}</p>
                                        <p style={{ fontSize: 24, fontWeight: 700, margin: "6px 0 2px", color: highlight ? style.fg : "#333" }}>{value}</p>
                                        {subtitle && <p style={{ fontSize: 11, color: "#999", margin: 0 }}>{subtitle}</p>}
                                    </div>
                                );
                            };

                            return (
                                <div className="pm-orders-tab">
                                    <h2 className="pm-tab-title">Delivery Report</h2>

                                    {/* ===== CONTROLS ===== */}
                                    <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 12, padding: "14px 16px", marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                            <label style={{ fontSize: 11, color: "#666", fontWeight: 600 }}>From</label>
                                            <input type="date" value={drDateFrom} onChange={(e) => setDrDateFrom(e.target.value)} style={{ border: "1px solid #ddd", borderRadius: 6, padding: "6px 10px", fontSize: 13 }} />
                                        </div>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                            <label style={{ fontSize: 11, color: "#666", fontWeight: 600 }}>To</label>
                                            <input type="date" value={drDateTo} onChange={(e) => setDrDateTo(e.target.value)} style={{ border: "1px solid #ddd", borderRadius: 6, padding: "6px 10px", fontSize: 13 }} />
                                        </div>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                            <label style={{ fontSize: 11, color: "#666", fontWeight: 600 }}>Channel</label>
                                            <select value={drChannel} onChange={(e) => setDrChannel(e.target.value)} style={{ border: "1px solid #ddd", borderRadius: 6, padding: "6px 10px", fontSize: 13, background: "#fff" }}>
                                                <option value="all">All Channels</option>
                                                <option value="store">Store</option>
                                                <option value="b2b">B2B</option>
                                            </select>
                                        </div>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 200px", minWidth: 180 }}>
                                            <label style={{ fontSize: 11, color: "#666", fontWeight: 600 }}>Search</label>
                                            <input type="text" value={drSearch} onChange={(e) => setDrSearch(e.target.value)} placeholder="Order no, customer, SA, product..." style={{ border: "1px solid #ddd", borderRadius: 6, padding: "6px 10px", fontSize: 13 }} />
                                        </div>
                                        <div style={{ display: "flex", gap: 8, marginLeft: "auto", alignSelf: "flex-end" }}>
                                            {drBucket !== "all" && (
                                                <button onClick={() => setDrBucket("all")} style={{ background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 6, padding: "7px 12px", cursor: "pointer", fontSize: 12 }}>Clear bucket</button>
                                            )}
                                            <button onClick={handleDrExport} style={{ display: "flex", alignItems: "center", gap: 6, background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, padding: "7px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                                Export CSV
                                            </button>
                                        </div>
                                    </div>

                                    {/* ===== HEADLINE KPI ===== */}
                                    <div style={{ background: "linear-gradient(135deg, #faf6e8 0%, #fff 100%)", border: "1px solid #d5b85a", borderRadius: 12, padding: "16px 20px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                                        <div>
                                            <p style={{ fontSize: 12, color: "#8B7355", margin: 0, fontWeight: 600 }}>ON-TIME DELIVERY RATE</p>
                                            <p style={{ fontSize: 32, fontWeight: 700, margin: "4px 0 0", color: Number(ontimePct) >= 80 ? "#2e7d32" : Number(ontimePct) >= 60 ? "#e65100" : "#c62828" }}>{ontimePct}%</p>
                                            <p style={{ fontSize: 11, color: "#666", margin: "2px 0 0" }}>{summary.ontime} of {totalCompleted} completed orders on-time</p>
                                        </div>
                                        <div style={{ textAlign: "right" }}>
                                            <p style={{ fontSize: 12, color: "#8B7355", margin: 0, fontWeight: 600 }}>CURRENTLY RUNNING LATE</p>
                                            <p style={{ fontSize: 32, fontWeight: 700, margin: "4px 0 0", color: openRows.length > 0 ? "#c62828" : "#2e7d32" }}>{openRows.length}</p>
                                            <p style={{ fontSize: 11, color: "#666", margin: "2px 0 0" }}>open orders past delivery date</p>
                                        </div>
                                    </div>

                                    {/* ===== BUCKET CARDS ===== */}
                                    <p className="pm-card-title" style={{ margin: "4px 0 10px 2px", color: "#8B7355" }}>Completed Orders by Delay Bucket (click to filter)</p>
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
                                        <BucketCard title="On-time" value={summary.ontime} bucketKey="ontime" highlight={true} />
                                        <BucketCard title="0–2 days late" value={summary.b0_2} bucketKey="0_2" highlight={summary.b0_2 > 0} />
                                        <BucketCard title="2–7 days late" value={summary.b2_7} bucketKey="2_7" highlight={summary.b2_7 > 0} />
                                        <BucketCard title="7–14 days late" value={summary.b7_14} bucketKey="7_14" highlight={summary.b7_14 > 0} />
                                        <BucketCard title="14+ days critical" value={summary.b14_plus} bucketKey="14_plus" highlight={summary.b14_plus > 0} />
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
                                                    <tbody>{filteredOpen.slice(0, 100).map(r => {
                                                        const o = r.order;
                                                        const style = bucketStyle(r.bucket);
                                                        return (
                                                            <tr key={o.id} style={{ borderBottom: "1px solid #f0f0f0", cursor: "pointer" }} onClick={() => viewOrderDetails(o)}>
                                                                <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 12 }}>{o.order_no || "-"}</td>
                                                                <td style={{ padding: "8px 12px" }}>{getClientName(o) || "-"}</td>
                                                                <td style={{ padding: "8px 12px", fontSize: 12 }}>{o.salesperson || "-"}</td>
                                                                <td style={{ padding: "8px 12px", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.items?.[0]?.product_name || "-"}</td>
                                                                <td style={{ padding: "8px 12px" }}>{formatDate(o.delivery_date)}</td>
                                                                <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 700, color: "#c62828" }}>{r.daysLate}d</td>
                                                                <td style={{ padding: "8px 12px", textAlign: "center" }}>
                                                                    <span style={{ background: style.bg, color: style.fg, borderRadius: 4, padding: "2px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{style.label}</span>
                                                                </td>
                                                                <td style={{ padding: "8px 12px", textTransform: "capitalize" }}>{(o.warehouse_stage || (o.status === "pending" ? "order received" : (o.status || "order received"))).replace(/_/g, " ")}</td>
                                                            </tr>
                                                        );
                                                    })}</tbody>
                                                </table>
                                            </div>
                                            {filteredOpen.length > 100 && <p style={{ fontSize: 11, color: "#999", marginTop: 8, textAlign: "center" }}>Showing top 100 of {filteredOpen.length} {"\u2014"} use filters to narrow</p>}
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
                                                    <tbody>{filteredCompleted.slice(0, 200).map(r => {
                                                        const o = r.order;
                                                        const style = bucketStyle(r.bucket);
                                                        return (
                                                            <tr key={o.id} style={{ borderBottom: "1px solid #f0f0f0", cursor: "pointer" }} onClick={() => viewOrderDetails(o)}>
                                                                <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 12 }}>{o.order_no || "-"}</td>
                                                                <td style={{ padding: "8px 12px" }}>{getClientName(o) || "-"}</td>
                                                                <td style={{ padding: "8px 12px", fontSize: 12 }}>{o.salesperson || "-"}</td>
                                                                <td style={{ padding: "8px 12px", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.items?.[0]?.product_name || "-"}</td>
                                                                <td style={{ padding: "8px 12px" }}>{formatDate(o.created_at)}</td>
                                                                <td style={{ padding: "8px 12px" }}>{formatDate(o.delivery_date)}</td>
                                                                <td style={{ padding: "8px 12px" }}>{r.actualDelivery ? r.actualDelivery.toLocaleDateString("en-GB") : "-"}</td>
                                                                <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 700, color: r.daysLate <= 0 ? "#2e7d32" : "#c62828" }}>{r.daysLate <= 0 ? "\u2713" : `${r.daysLate}d`}</td>
                                                                <td style={{ padding: "8px 12px", textAlign: "center" }}>
                                                                    <span style={{ background: style.bg, color: style.fg, borderRadius: 4, padding: "2px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{style.label}</span>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}</tbody>
                                                </table>
                                                {filteredCompleted.length > 200 && <p style={{ fontSize: 11, color: "#999", marginTop: 8, textAlign: "center" }}>Showing top 200 of {filteredCompleted.length} {"\u2014"} use filters or export for full list</p>}
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

                            const goToPrevMonth = () => { setSelectedCalendarDate(null); if (month === 0) { setCalendarMonth(11); setCalendarYear(year - 1); } else setCalendarMonth(month - 1); };
                            const goToNextMonth = () => { setSelectedCalendarDate(null); if (month === 11) { setCalendarMonth(0); setCalendarYear(year + 1); } else setCalendarMonth(month + 1); };
                            const goToToday = () => { setSelectedCalendarDate(null); setCalendarMonth(now.getMonth()); setCalendarYear(now.getFullYear()); };
                            const jumpToDate = (e) => {
                                const v = e.target.value; // YYYY-MM-DD
                                if (!v) return;
                                const d = new Date(v);
                                setCalendarMonth(d.getMonth());
                                setCalendarYear(d.getFullYear());
                                setSelectedCalendarDate(v);
                            };

                            const deliveryMap = {};
                            orders.forEach(o => {
                                if (o.delivery_date && o.status !== "cancelled") {
                                    const key = new Date(o.delivery_date).toISOString().split("T")[0];
                                    if (!deliveryMap[key]) deliveryMap[key] = { total: 0, delivered: 0, pending: 0 };
                                    deliveryMap[key].total++;
                                    if (o.status === "delivered" || o.status === "completed") deliveryMap[key].delivered++;
                                    else deliveryMap[key].pending++;
                                }
                            });

                            const cells = [];
                            for (let i = 0; i < firstDay; i++) cells.push(null);
                            for (let d = 1; d <= daysInMonth; d++) cells.push(d);

                            const monthOrders = orders.filter(o => {
                                if (!o.delivery_date || o.status === "cancelled") return false;
                                const dd = new Date(o.delivery_date);
                                return dd.getMonth() === month && dd.getFullYear() === year;
                            }).sort((a, b) => new Date(a.delivery_date) - new Date(b.delivery_date));

                            // Selected-day orders (if a date has been clicked)
                            const selectedDayOrders = selectedCalendarDate ? orders.filter(o => {
                                if (!o.delivery_date || o.status === "cancelled") return false;
                                return new Date(o.delivery_date).toISOString().split("T")[0] === selectedCalendarDate;
                            }).sort((a, b) => (a.order_no || "").localeCompare(b.order_no || "")) : [];

                            // Export handler — exports the current visible scope
                            const handleCalendarExport = () => {
                                const scope = selectedCalendarDate ? selectedDayOrders : monthOrders;
                                if (scope.length === 0) {
                                    showPopup({ type: "info", title: "Nothing to export", message: "No deliveries in the selected range." });
                                    return;
                                }
                                const headers = ["Order No", "Customer Name", "Product", "Size", "Amount", "Top Color", "Bottom Color", "SA Name", "Store", "Status", "Stage", "Priority", "Notes", "Order Date", "Delivery Date"];
                                const rows = scope.map(o => {
                                    const it = o.items?.[0] || {};
                                    return [
                                        o.order_no || "",
                                        o.delivery_name || "",
                                        it.product_name || "",
                                        it.size || "",
                                        o.grand_total || 0,
                                        it.top_color?.name || "",
                                        it.bottom_color?.name || "",
                                        o.salesperson || "",
                                        o.salesperson_store || "",
                                        o.status || "",
                                        (o.warehouse_stage || o.status || "").replace(/_/g, " "),
                                        o.priority || "normal",
                                        o.notes || "",
                                        o.created_at ? new Date(o.created_at).toLocaleDateString("en-GB") : "",
                                        o.delivery_date ? new Date(o.delivery_date).toLocaleDateString("en-GB") : "",
                                    ].map(v => `"${String(v).replace(/"/g, '""')}"`);
                                });
                                const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
                                const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                const label = selectedCalendarDate ? selectedCalendarDate : `${monthNames[month]}_${year}`;
                                a.download = `delivery_calendar_${label}.csv`;
                                a.click();
                                URL.revokeObjectURL(url);
                            };

                            // Date input value (YYYY-MM-DD) for jump-to
                            const jumpValue = selectedCalendarDate || `${year}-${String(month + 1).padStart(2, "0")}-01`;

                            return (
                                <div className="pm-orders-tab">
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
                                        <h2 className="pm-tab-title" style={{ margin: 0 }}>Delivery Calendar</h2>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                            <button onClick={goToPrevMonth} style={{ background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 16 }}>{"\u25C0"}</button>
                                            <span style={{ fontWeight: 600, fontSize: 16, minWidth: 140, textAlign: "center" }}>{monthNames[month]} {year}</span>
                                            <button onClick={goToNextMonth} style={{ background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 16 }}>{"\u25B6"}</button>
                                            <input
                                                type="date"
                                                value={jumpValue}
                                                onChange={jumpToDate}
                                                style={{ border: "1px solid #ddd", borderRadius: 6, padding: "6px 10px", fontSize: 13, cursor: "pointer" }}
                                                title="Jump to any date"
                                            />
                                            <button onClick={goToToday} style={{ background: "#d5b85a", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Today</button>
                                            <button onClick={handleCalendarExport} style={{ display: "flex", alignItems: "center", gap: 6, background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                                Export
                                            </button>
                                        </div>
                                    </div>
                                    <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 12, padding: 16, marginBottom: 20 }}>
                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, textAlign: "center", marginBottom: 8 }}>
                                            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (<div key={d} style={{ fontSize: 11, fontWeight: 600, color: "#999", padding: "6px 0" }}>{d}</div>))}
                                        </div>
                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                                            {cells.map((day, i) => {
                                                if (!day) return <div key={`e${i}`} />;
                                                const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                                                const info = deliveryMap[dateKey];
                                                const isToday = day === now.getDate() && month === now.getMonth() && year === now.getFullYear();
                                                const isPast = new Date(dateKey) < new Date(now.toISOString().split("T")[0]);
                                                const isSelected = selectedCalendarDate === dateKey;
                                                const hasOrders = !!info;
                                                return (
                                                    <div
                                                        key={day}
                                                        onClick={() => setSelectedCalendarDate(isSelected ? null : dateKey)}
                                                        style={{
                                                            border: isSelected ? "2px solid #2e7d32" : isToday ? "2px solid #d5b85a" : "1px solid #f0f0f0",
                                                            borderRadius: 8,
                                                            padding: "6px 4px",
                                                            minHeight: 56,
                                                            background: isSelected ? "#e8f5e9" : isToday ? "#faf6e8" : isPast ? "#fafafa" : "#fff",
                                                            cursor: "pointer",
                                                            transition: "all 0.15s",
                                                        }}
                                                        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = hasOrders ? "#fff8e1" : "#f5f5f5"; }}
                                                        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = isToday ? "#faf6e8" : isPast ? "#fafafa" : "#fff"; }}
                                                    >
                                                        <div style={{ fontSize: 12, fontWeight: isToday || isSelected ? 700 : 400, color: isSelected ? "#2e7d32" : isToday ? "#d5b85a" : "#333" }}>{day}</div>
                                                        {info && (<div style={{ marginTop: 2 }}>
                                                            {info.pending > 0 && <div style={{ fontSize: 9, background: "#fff3e0", color: "#e65100", borderRadius: 4, padding: "1px 4px", marginTop: 2 }}>{info.pending} due</div>}
                                                            {info.delivered > 0 && <div style={{ fontSize: 9, background: "#e8f5e9", color: "#2e7d32", borderRadius: 4, padding: "1px 4px", marginTop: 2 }}>{info.delivered} done</div>}
                                                        </div>)}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <p style={{ fontSize: 11, color: "#999", marginTop: 10, textAlign: "center" }}>Click any date to see its deliveries {"\u00B7"} Use the date picker to jump to any month/year</p>
                                    </div>

                                    {/* ===== SELECTED DAY PANEL ===== */}
                                    {selectedCalendarDate && (
                                        <div className="pm-channel-card" style={{ marginBottom: 20, borderLeft: "4px solid #2e7d32" }}>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                                                <p className="pm-card-title" style={{ margin: 0 }}>{"\uD83D\uDCC5"} Deliveries on {formatDate(selectedCalendarDate)} {"\u2014"} {selectedDayOrders.length} orders</p>
                                                <button onClick={() => setSelectedCalendarDate(null)} style={{ background: "transparent", border: "1px solid #ddd", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>Clear</button>
                                            </div>
                                            {selectedDayOrders.length > 0 ? (
                                                <div style={{ overflowX: "auto" }}>
                                                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                                        <thead><tr style={{ borderBottom: "2px solid #e0e0e0", textAlign: "left", background: "#fafafa" }}><th style={{ padding: "8px 10px" }}>Order</th><th style={{ padding: "8px 10px" }}>Customer</th><th style={{ padding: "8px 10px" }}>Product</th><th style={{ padding: "8px 10px" }}>Amount</th><th style={{ padding: "8px 10px" }}>Stage</th><th style={{ padding: "8px 10px" }}>Status</th></tr></thead>
                                                        <tbody>{selectedDayOrders.map(o => (
                                                            <tr key={o.id} style={{ borderBottom: "1px solid #f0f0f0", cursor: "pointer" }} onClick={() => viewOrderDetails(o)}>
                                                                <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{o.order_no || "-"}</td>
                                                                <td style={{ padding: "8px 10px" }}>{o.delivery_name || "-"}</td>
                                                                <td style={{ padding: "8px 10px", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.items?.[0]?.product_name || "-"}</td>
                                                                <td style={{ padding: "8px 10px" }}>{"\u20B9"}{formatIndianNumber(o.grand_total || 0)}</td>
                                                                <td style={{ padding: "8px 10px", textTransform: "capitalize" }}>{(o.warehouse_stage || (o.status === "pending" ? "order received" : (o.status || "order received"))).replace(/_/g, " ")}</td>
                                                                <td style={{ padding: "8px 10px", textTransform: "capitalize" }}>{o.status || "-"}</td>
                                                            </tr>
                                                        ))}</tbody>
                                                    </table>
                                                </div>
                                            ) : (
                                                <p className="pm-muted" style={{ textAlign: "center", padding: 14 }}>No deliveries scheduled for this date</p>
                                            )}
                                        </div>
                                    )}

                                    {/* ===== FULL MONTH TABLE (only shown when no date selected) ===== */}
                                    {!selectedCalendarDate && monthOrders.length > 0 && (
                                        <div className="pm-channel-card">
                                            <p className="pm-card-title">All Deliveries in {monthNames[month]} {"\u2014"} {monthOrders.length} orders</p>
                                            <div style={{ overflowX: "auto" }}>
                                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                                    <thead><tr style={{ borderBottom: "2px solid #e0e0e0", textAlign: "left" }}><th style={{ padding: "8px 10px" }}>Order</th><th style={{ padding: "8px 10px" }}>Customer</th><th style={{ padding: "8px 10px" }}>Product</th><th style={{ padding: "8px 10px" }}>Delivery Date</th><th style={{ padding: "8px 10px" }}>Status</th></tr></thead>
                                                    <tbody>{monthOrders.map(o => (
                                                        <tr key={o.id} style={{ borderBottom: "1px solid #f0f0f0", cursor: "pointer" }} onClick={() => viewOrderDetails(o)}>
                                                            <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{o.order_no || "-"}</td>
                                                            <td style={{ padding: "8px 10px" }}>{o.delivery_name || "-"}</td>
                                                            <td style={{ padding: "8px 10px", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.items?.[0]?.product_name || "-"}</td>
                                                            <td style={{ padding: "8px 10px" }}>{formatDate(o.delivery_date)}</td>
                                                            <td style={{ padding: "8px 10px", textTransform: "capitalize" }}>{(o.warehouse_stage || (o.status === "pending" ? "order received" : (o.status || "order received"))).replace(/_/g, " ")}</td>
                                                        </tr>
                                                    ))}</tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                    {!selectedCalendarDate && monthOrders.length === 0 && <p className="pm-muted" style={{ textAlign: "center", padding: 20 }}>No deliveries for {monthNames[month]} {year}</p>}
                                </div>
                            );
                        })()}

                        {activeTab === "overrides" && (
                            <div className="pm-orders-tab">
                                <ProductionOverrides currentUserEmail={currentUserEmail} />
                            </div>
                        )}
                        {activeTab === "vendors" && (
                            <div className="pm-orders-tab">
                                <VendorRequest currentUserEmail={currentUserEmail} />
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