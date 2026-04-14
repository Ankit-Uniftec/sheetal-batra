import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import "./ProductionManagerDashboard.css";
import Logo from "../../../images/logo.png";
import formatIndianNumber from "../../../utils/formatIndianNumber";
import formatDate from "../../../utils/formatDate";
import { usePopup } from "../../../components/Popup";
import NotificationBell from "../../../components/NotificationBell";

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
    package: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d5b85a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/></svg>,
    gear: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d5b85a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
    warning: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c62828" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
    clock: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e65100" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    refresh: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d5b85a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
    truck: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d5b85a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
    xCircle: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c62828" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>,
    timer: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d5b85a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><path d="M6.38 18.7 4 21"/><path d="M17.64 18.67 20 21"/></svg>,
    inbox: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d5b85a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>,
    hourglass: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d5b85a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>,
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
    const { showPopup, PopupComponent } = usePopup();

    const [activeTab, setActiveTab] = useState("overview");
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showSidebar, setShowSidebar] = useState(false);
    const [currentUserEmail, setCurrentUserEmail] = useState("");

    // Orders tab state
    const [orderSearch, setOrderSearch] = useState("");
    const [channelFilter, setChannelFilter] = useState("all");
    const [statusTab, setStatusTab] = useState("all");
    const [sortBy, setSortBy] = useState("newest");
    const [filters, setFilters] = useState({ dateFrom: "", dateTo: "", minPrice: 0, maxPrice: 500000, payment: [], priority: [], store: [], salesperson: "" });
    const [openDropdown, setOpenDropdown] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const dropdownRef = useRef(null);
    const ORDERS_PER_PAGE = 20;

    // Edit modal state
    const [editingOrder, setEditingOrder] = useState(null);
    const [editFormData, setEditFormData] = useState({});
    const [actionLoading, setActionLoading] = useState(null);
    const [editMeasurements, setEditMeasurements] = useState({});
    const [editActiveCategory, setEditActiveCategory] = useState("Kurta/Choga/Kaftan");
    const [colors, setColors] = useState([]);

    // Priority modal
    const [priorityOrder, setPriorityOrder] = useState(null);
    const [priorityValue, setPriorityValue] = useState("");
    const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
    const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());

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
            setOrders(allOrders);

            setLoading(false);
        } catch (err) {
            console.error("Load error:", err);
            setLoading(false);
        }
    }, [navigate]);

    useEffect(() => { loadAllData(); }, [loadAllData]);

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
    useEffect(() => { setCurrentPage(1); }, [orderSearch, statusTab, channelFilter, filters, sortBy]);

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
        ...prev, [category]: prev[category].includes(value) ? prev[category].filter(v => v !== value) : [...prev[category], value]
    }));

    const removeFilter = (type, value) => {
        if (type === "date") setFilters(prev => ({ ...prev, dateFrom: "", dateTo: "" }));
        else if (type === "price") setFilters(prev => ({ ...prev, minPrice: 0, maxPrice: 500000 }));
        else if (type === "salesperson") setFilters(prev => ({ ...prev, salesperson: "" }));
        else setFilters(prev => ({ ...prev, [type]: prev[type].filter(v => v !== value) }));
    };

    const clearAllFilters = () => setFilters({ dateFrom: "", dateTo: "", minPrice: 0, maxPrice: 500000, payment: [], priority: [], store: [], salesperson: "" });

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
        if (filters.salesperson) chips.push({ type: "salesperson", label: filters.salesperson });
        return chips;
    }, [filters]);

    const handleExportCSV = () => {
        if (filteredOrders.length === 0) return;
        const headers = ["Order No", "Product Name", "Customer Name", "Customer Phone", "Size", "Amount", "Top Color", "Bottom Color", "SA Name", "Store", "Status", "Priority", "Notes", "Order Date", "Delivery Date"];
        const rows = filteredOrders.map(order => {
            const item = order.items?.[0] || {};
            return [
                order.order_no || "",
                item.product_name || "",
                order.delivery_name || "",
                order.delivery_phone || "",
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


    const channelStats = useMemo(() => {
        const total = orders.length;
        const b2b = orders.filter(o => o.is_b2b === true).length;
        const store = total - b2b;
        return {
            total, b2b, store: store > 0 ? store : 0,
            b2bPct: total > 0 ? Math.round((b2b / total) * 100) : 0,
            storePct: total > 0 ? Math.round((store > 0 ? store : 0) / total * 100) : 0,
        };
    }, [orders]);

    const statusStats = useMemo(() => {
        const pending = orders.filter(o => o.status === "pending" || o.status === "confirmed").length;
        const inProd = orders.filter(o => o.status === "prepared" || o.production_status === "in_production").length;
        const dispatched = orders.filter(o => o.status === "delivered" || o.production_status === "dispatched").length;
        const readyForDispatch = orders.filter(o => o.production_status === "ready_for_dispatch").length;
        return { pending, inProd, dispatched, readyForDispatch };
    }, [orders]);

    const productionMetrics = useMemo(() => {
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
    }, [orders, statusStats]);

    const recentOrders = useMemo(() => orders.slice(0, 10), [orders]);

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
            const q = orderSearch.toLowerCase();
            result = result.filter(o => {
                const productName = o.items?.[0]?.product_name || "";
                return (o.order_no || "").toLowerCase().includes(q) || (o.delivery_name || "").toLowerCase().includes(q) || (o.delivery_phone || "").toLowerCase().includes(q) || (o.po_number || "").toLowerCase().includes(q) || productName.toLowerCase().includes(q);
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
        result = [...result].sort((a, b) => {
            switch (sortBy) {
                case "oldest": return new Date(a.created_at) - new Date(b.created_at);
                case "delivery": return new Date(a.delivery_date || 0) - new Date(b.delivery_date || 0);
                case "amount_high": return (b.grand_total || 0) - (a.grand_total || 0);
                case "amount_low": return (a.grand_total || 0) - (b.grand_total || 0);
                default: return new Date(b.created_at) - new Date(a.created_at);
            }
        });
        return result;
    }, [filteredByStatus, orderSearch, filters, sortBy]);

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
            status: order.status || "pending",
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
            } catch (err) { console.log("PDF cleanup error:", err); }

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
                        <NotificationBell userEmail={currentUserEmail} onOrderClick={() => {}} />
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
                            <a className={`pm-menu-item ${activeTab === "dispatch" ? "active" : ""}`} onClick={() => { setActiveTab("dispatch"); setShowSidebar(false); }}>Dispatch</a>
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
                                <div className="pm-stats-row-3">
                                    <StatCard title="Total Orders (All Channels)" value={formatIndianNumber(channelStats.total)} subtitle={`B2B: ${channelStats.b2b} | Store: ${channelStats.store}`} highlight={true} icon={Icons.package} />
                                    <StatCard title="Production Load" value={`${productionMetrics.productionLoad.percentage}%`} subtitle={`${productionMetrics.productionLoad.active} in production`} icon={Icons.gear} />
                                    <StatCard title="Bottlenecks" value={productionMetrics.bottlenecks.count} subtitle={productionMetrics.bottlenecks.count > 0 ? `${productionMetrics.bottlenecks.topBottleneck} · ${productionMetrics.bottlenecks.topOverdue} overdue · avg ${productionMetrics.bottlenecks.topAvgDays}d late` : "No overdue stages"} highlight={productionMetrics.bottlenecks.count > 0} icon={Icons.warning} />
                                </div>
                                <div className="pm-stats-row-3">
                                    <StatCard title="Delayed Orders" value={productionMetrics.delayed} subtitle={`Delay rate: ${productionMetrics.delayRate}%`} highlight={productionMetrics.delayed > 0} icon={Icons.clock} />
                                    <StatCard title="Rework %" value={`${productionMetrics.rework.percentage}%`} subtitle={`${productionMetrics.rework.totalReworks} items ${"\u00B7"} ${productionMetrics.rework.trend === "down" ? "\u2193 Improving" : "\u2191 Rising"}`} icon={Icons.refresh} />
                                    <StatCard title="Dispatch Backlog" value={productionMetrics.dispatchBacklog.pending} subtitle={`${productionMetrics.dispatchBacklog.overdue} overdue ${"\u00B7"} Avg: ${productionMetrics.dispatchBacklog.avgDelay}`} highlight={productionMetrics.dispatchBacklog.overdue > 0} icon={Icons.truck} />
                                </div>
                                <div className="pm-channel-card">
                                    <p className="pm-card-title">Orders by Channel</p>
                                    <div className="pm-channel-body">
                                        <ChannelRow label="Store (Offline)" count={channelStats.store} percentage={channelStats.storePct} color="#2e7d32" />
                                        <ChannelRow label="B2B" count={channelStats.b2b} percentage={channelStats.b2bPct} color="#d5b85a" />
                                    </div>
                                </div>
                                <div className="pm-bottom-row">
                                    <div className="pm-recent-card">
                                        <div className="pm-card-header"><p className="pm-card-title">Recent Orders</p><button className="pm-view-all-btn" onClick={() => setActiveTab("orders")}>View All</button></div>
                                        <div className="pm-recent-list">
                                            {recentOrders.length === 0 ? <p className="pm-muted">No orders yet</p> : recentOrders.map(order => {
                                                const sl = getStatusLabel(order);
                                                return (<div className="pm-recent-item" key={order.id} onClick={() => viewOrderDetails(order)} style={{ cursor: "pointer" }}><div className="pm-recent-top"><span className="pm-recent-orderno">{order.order_no || "—"}</span><span className={`pm-channel-tag ${getChannelClass(order)}`}>{getChannelLabel(order)}</span></div><div className="pm-recent-bottom"><span className="pm-recent-amount">₹{formatIndianNumber(order.grand_total || 0)}</span><span className={`pm-recent-status ${getStatusClass(sl)}`}>{sl}</span></div></div>);
                                            })}
                                        </div>
                                    </div>
                                    <div className="pm-pipeline-card">
                                        <p className="pm-card-title">Production Pipeline</p>
                                        <div className="pm-pipeline-body">
                                            {[{ label: "Pending", count: statusStats.pending, cls: "pm-dot-pending" }, { label: "In Production", count: statusStats.inProd, cls: "pm-dot-inprod" }, { label: "Ready for Dispatch", count: statusStats.readyForDispatch, cls: "pm-dot-ready" }, { label: "Dispatched", count: statusStats.dispatched, cls: "pm-dot-dispatched" }].map(s => (
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
                                    <div style={{ position: "relative", flex: "1 1 220px", minWidth: 180 }}>
                                        <input type="text" placeholder="Search order #, client, product, PO..." value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} className="pm-search-input" style={{ paddingLeft: 32, width: "100%", boxSizing: "border-box" }} />
                                        <svg style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", opacity: 0.4 }} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg>
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
                                            <div key={order.id} className="pm-order-card" onClick={() => viewOrderDetails(order)} style={{ cursor: "pointer" }}>
                                                <div className="pm-order-header">
                                                    <div className="pm-oheader-info">
                                                        <div className="pm-oheader-item"><span className="pm-oheader-label">ORDER NO</span><span className="pm-oheader-value">{order.order_no || "—"}</span></div>
                                                        <div className="pm-oheader-item"><span className="pm-oheader-label">ORDER DATE</span><span className="pm-oheader-value">{formatDate(order.created_at) || "—"}</span></div>
                                                        <div className="pm-oheader-item"><span className="pm-oheader-label">DELIVERY</span><span className="pm-oheader-value">{formatDate(order.delivery_date) || "—"}</span></div>
                                                    </div>
                                                    <div className="pm-oheader-actions">
                                                        <span className={`pm-channel-tag ${getChannelClass(order)}`}>{getChannelLabel(order)}</span>
                                                        <div className={`pm-order-status-badge ${getStatusBadgeClass(order.status)}`}>{order.status || "Pending"}</div>
                                                        {order.priority && <span className={`pm-priority-tag pm-priority-${order.priority}`}>{order.priority === "urgent" ? "🔴" : order.priority === "high" ? "🟠" : "🟢"} {order.priority}</span>}
                                                    </div>
                                                </div>

                                                <div className="pm-order-content">
                                                    <div className="pm-product-thumb"><img src={imgSrc} alt={item.product_name || "Product"} /></div>
                                                    <div className="pm-product-details">
                                                        <div className="pm-product-name"><span className="pm-order-label">Product:</span><span className="pm-ovalue">{item.product_name || "—"}</span></div>
                                                        <div className="pm-product-name"><span className="pm-order-label">Client:</span><span className="pm-ovalue">{order.delivery_name || "—"}</span></div>
                                                        <div className="pm-odetails-grid">
                                                            <div className="pm-odetail-item"><span className="pm-order-label">Amount:</span><span className="pm-ovalue">₹{formatIndianNumber(order.grand_total || 0)}</span></div>
                                                            <div className="pm-odetail-item"><span className="pm-order-label">Qty:</span><span className="pm-ovalue">{order.total_quantity || 1}</span></div>
                                                            <div className="pm-odetail-item"><span className="pm-order-label">Top:</span><span className="pm-ovalue">{item.top || "—"}{item.top_color?.hex && (<><span style={{display:"inline-block",width:12,height:12,backgroundColor:item.top_color.hex,borderRadius:"50%",marginLeft:6,border:"1px solid #ccc",verticalAlign:"middle"}}/><span style={{marginLeft:4}}>{item.top_color.name}</span></>)}</span></div>
                                                            <div className="pm-odetail-item"><span className="pm-order-label">Bottom:</span><span className="pm-ovalue">{item.bottom || "—"}{item.bottom_color?.hex && (<><span style={{display:"inline-block",width:12,height:12,backgroundColor:item.bottom_color.hex,borderRadius:"50%",marginLeft:6,border:"1px solid #ccc",verticalAlign:"middle"}}/><span style={{marginLeft:4}}>{item.bottom_color.name}</span></>)}</span></div>
                                                            <div className="pm-odetail-item"><span className="pm-order-label">Size:</span><span className="pm-ovalue">{item.size || "—"}</span></div>
                                                            <div className="pm-odetail-item"><span className="pm-order-label">Category:</span><span className="pm-ovalue">{item.isKids ? "Kids" : "Women"}</span></div>
                                                        </div>
                                                        {item.extras && item.extras.length > 0 && (
                                                            <div className="pm-odetail-item"><span className="pm-order-label">Extras:</span><span className="pm-ovalue">{item.extras.map((extra, idx) => (<span key={idx}>{extra.name}{extra.color?.hex && (<><span style={{display:"inline-block",width:12,height:12,backgroundColor:extra.color.hex,borderRadius:"50%",marginLeft:6,border:"1px solid #ccc",verticalAlign:"middle"}}/><span style={{marginLeft:4}}>{extra.color.name}</span></>)}{idx < item.extras.length - 1 && <span style={{margin:"0 8px"}}>|</span>}</span>))}</span></div>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="pm-order-actions">
                                                    <button className="pm-action-btn pm-edit-btn" onClick={(e) => openEditModal(e, order)}>Edit Order</button>
                                                    <button className="pm-action-btn pm-priority-btn" onClick={(e) => openPriorityModal(e, order)}>{order.priority ? `Priority: ${order.priority}` : "Set Priority"}</button>
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
                                <div className="pm-stats-row-3">
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
                                                <thead><tr style={{ borderBottom: "2px solid #e0e0e0", textAlign: "left" }}><th style={{ padding: "8px 10px" }}>Order</th><th style={{ padding: "8px 10px" }}>Product</th><th style={{ padding: "8px 10px" }}>Delivery</th><th style={{ padding: "8px 10px" }}>Overdue</th><th style={{ padding: "8px 10px" }}>Stage</th></tr></thead>
                                                <tbody>{productionMetrics.exceedingDelivery.slice(0, 15).map(o => {
                                                    const overdue = Math.ceil((new Date() - new Date(o.delivery_date)) / (1000 * 60 * 60 * 24));
                                                    return (<tr key={o.id} style={{ borderBottom: "1px solid #f0f0f0" }}><td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{o.order_no || "-"}</td><td style={{ padding: "8px 10px", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.items?.[0]?.product_name || "-"}</td><td style={{ padding: "8px 10px" }}>{formatDate(o.delivery_date)}</td><td style={{ padding: "8px 10px", color: "#c62828", fontWeight: 600 }}>{overdue}d</td><td style={{ padding: "8px 10px", textTransform: "capitalize" }}>{(o.warehouse_stage || o.status || "pending").replace(/_/g, " ")}</td></tr>);
                                                })}</tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ===== DISPATCH TAB ===== */}
                        {activeTab === "dispatch" && (() => {
                            const now = new Date();
                            const readyNotDispatched = orders.filter(o => o.ready_for_dispatch_at && !o.dispatched_at && o.status !== "cancelled");
                            const recentlyDispatched = orders.filter(o => o.dispatched_at).sort((a, b) => new Date(b.dispatched_at) - new Date(a.dispatched_at)).slice(0, 20);
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
                                                    <tbody>{recentlyDispatched.map(o => (<tr key={o.id} style={{ borderBottom: "1px solid #f0f0f0" }}><td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{o.order_no || "-"}</td><td style={{ padding: "8px 10px" }}>{o.delivery_name || "-"}</td><td style={{ padding: "8px 10px" }}>{formatDate(o.dispatched_at)}</td><td style={{ padding: "8px 10px" }}>{o.dispatched_by || "-"}</td></tr>))}</tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
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

                            const goToPrevMonth = () => { if (month === 0) { setCalendarMonth(11); setCalendarYear(year - 1); } else setCalendarMonth(month - 1); };
                            const goToNextMonth = () => { if (month === 11) { setCalendarMonth(0); setCalendarYear(year + 1); } else setCalendarMonth(month + 1); };
                            const goToToday = () => { setCalendarMonth(now.getMonth()); setCalendarYear(now.getFullYear()); };

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
                                return dd.getMonth() === month && dd.getFullYear() === year && o.status !== "delivered" && o.status !== "completed";
                            }).sort((a, b) => new Date(a.delivery_date) - new Date(b.delivery_date));

                            return (
                                <div className="pm-orders-tab">
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
                                        <h2 className="pm-tab-title" style={{ margin: 0 }}>Delivery Calendar</h2>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <button onClick={goToPrevMonth} style={{ background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 16 }}>{"\u25C0"}</button>
                                            <span style={{ fontWeight: 600, fontSize: 16, minWidth: 160, textAlign: "center" }}>{monthNames[month]} {year}</span>
                                            <button onClick={goToNextMonth} style={{ background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 16 }}>{"\u25B6"}</button>
                                            <button onClick={goToToday} style={{ background: "#d5b85a", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600, marginLeft: 4 }}>Today</button>
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
                                                return (
                                                    <div key={day} style={{ border: isToday ? "2px solid #d5b85a" : "1px solid #f0f0f0", borderRadius: 8, padding: "6px 4px", minHeight: 56, background: isToday ? "#faf6e8" : isPast ? "#fafafa" : "#fff" }}>
                                                        <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 400, color: isToday ? "#d5b85a" : "#333" }}>{day}</div>
                                                        {info && (<div style={{ marginTop: 2 }}>
                                                            {info.pending > 0 && <div style={{ fontSize: 9, background: "#fff3e0", color: "#e65100", borderRadius: 4, padding: "1px 4px", marginTop: 2 }}>{info.pending} due</div>}
                                                            {info.delivered > 0 && <div style={{ fontSize: 9, background: "#e8f5e9", color: "#2e7d32", borderRadius: 4, padding: "1px 4px", marginTop: 2 }}>{info.delivered} done</div>}
                                                        </div>)}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    {monthOrders.length > 0 && (
                                        <div className="pm-channel-card">
                                            <p className="pm-card-title">Pending Deliveries in {monthNames[month]} {"\u2014"} {monthOrders.length} orders</p>
                                            <div style={{ overflowX: "auto" }}>
                                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                                    <thead><tr style={{ borderBottom: "2px solid #e0e0e0", textAlign: "left" }}><th style={{ padding: "8px 10px" }}>Order</th><th style={{ padding: "8px 10px" }}>Customer</th><th style={{ padding: "8px 10px" }}>Product</th><th style={{ padding: "8px 10px" }}>Delivery Date</th><th style={{ padding: "8px 10px" }}>Status</th></tr></thead>
                                                    <tbody>{monthOrders.map(o => (<tr key={o.id} style={{ borderBottom: "1px solid #f0f0f0" }}><td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{o.order_no || "-"}</td><td style={{ padding: "8px 10px" }}>{o.delivery_name || "-"}</td><td style={{ padding: "8px 10px", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.items?.[0]?.product_name || "-"}</td><td style={{ padding: "8px 10px" }}>{formatDate(o.delivery_date)}</td><td style={{ padding: "8px 10px", textTransform: "capitalize" }}>{(o.warehouse_stage || o.status || "pending").replace(/_/g, " ")}</td></tr>))}</tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                    {monthOrders.length === 0 && <p className="pm-muted" style={{ textAlign: "center", padding: 20 }}>No pending deliveries for {monthNames[month]} {year}</p>}
                                </div>
                            );
                        })()}

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
        </>
    );
}