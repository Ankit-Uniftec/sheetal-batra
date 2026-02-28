import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./AdminDashboard.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";
import { downloadCustomerPdf, downloadWarehousePdf } from "../../utils/pdfUtils";
import { usePopup } from "../../components/Popup";
import NotificationBell from "../../components/NotificationBell";
import config from "../../config/config";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell, LineChart, Line, AreaChart, Area
} from "recharts";

// Status options
const ORDER_STATUS_OPTIONS = [
    { value: "pending", label: "Pending", color: "#ff9800" },
    { value: "in_production", label: "In Production", color: "#2196f3" },
    { value: "ready", label: "Ready", color: "#4caf50" },
    { value: "dispatched", label: "Dispatched", color: "#9c27b0" },
    { value: "delivered", label: "Delivered", color: "#388e3c" },
    { value: "completed", label: "Completed", color: "#388e3c" },
    { value: "cancelled", label: "Cancelled", color: "#f44336" },
];

// Status Tabs for Orders
const STATUS_TABS = [
    { value: "all", label: "All Orders" },
    { value: "unfulfilled", label: "Unfulfilled" },
    { value: "prepared", label: "Prepared" },
    { value: "delivered", label: "Delivered" },
    { value: "cancelled", label: "Cancelled" },
];

// Timeline options for Dashboard
const TIMELINE_OPTIONS = [
    { value: "today", label: "Today" },
    { value: "yesterday", label: "Yesterday" },
    { value: "weekly", label: "Last 7 Days" },
    { value: "monthly", label: "Last 30 Days" },
    { value: "yearly", label: "Last 365 Days" },
    { value: "custom", label: "Custom" },
];

// Comparison options (like Shopify)
const COMPARISON_OPTIONS = [
    { value: "none", label: "No comparison" },
    { value: "previous_period", label: "Previous period" },
    { value: "previous_year", label: "Previous year" },
];

const ITEMS_PER_PAGE = 15;
const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL", "6XL"];

// Chart colors
const CHART_COLORS = ["#d5b85a", "#8B7355", "#C9A94E", "#A67C52", "#D4AF37", "#BDB76B", "#DAA520", "#B8860B", "#CD853F", "#DEB887"];
const PIE_COLORS = ["#d5b85a", "#8B7355", "#C9A94E", "#A67C52", "#D4AF37"];

// Channel filter options
const CHANNEL_OPTIONS = [
    { value: "all", label: "All Channels" },
    { value: "store", label: "Stores" },
    { value: "website", label: "Website" },
    { value: "b2b", label: "B2B" },
    { value: "exhibition", label: "Exhibitions" },
];

// Placeholder badge for data not yet connected
const PlaceholderBadge = ({ label }) => (
    <span className="placeholder-badge" title="Data source pending — will be connected later">⏳ {label || "Placeholder"}</span>
);

// Map color names to actual hex values for chart bars
const COLOR_NAME_MAP = {
    "black": "#1a1a1a", "white": "#f5f5f5", "red": "#c62828", "blue": "#1565c0",
    "navy": "#0d2137", "navy blue": "#0d2137", "green": "#2e7d32", "yellow": "#f9a825",
    "pink": "#e91e8f", "baby pink": "#f8bbd0", "blush pink": "#f4a0b5", "dusty pink": "#d4919a",
    "hot pink": "#ff1493", "purple": "#7b1fa2", "lavender": "#b39ddb", "orange": "#ef6c00",
    "brown": "#5d4037", "beige": "#d7ccc8", "cream": "#fffdd0", "ivory": "#fffff0",
    "grey": "#757575", "gray": "#757575", "silver": "#bdbdbd", "gold": "#d5b85a",
    "maroon": "#6a1b29", "burgundy": "#800020", "wine": "#722f37", "rust": "#b7410e",
    "teal": "#008080", "turquoise": "#40e0d0", "coral": "#ff7f50", "peach": "#ffdab9",
    "sage": "#9caf88", "sage green": "#9caf88", "olive": "#6b8e23", "olive green": "#6b8e23",
    "mint": "#98fb98", "mint green": "#98fb98", "forest green": "#228b22",
    "sky blue": "#87ceeb", "royal blue": "#4169e1", "powder blue": "#b0c4de",
    "taupe": "#8b8378", "tan": "#d2b48c", "camel": "#c19a6b", "khaki": "#c3b091",
    "charcoal": "#36454f", "off white": "#faf0e6", "off-white": "#faf0e6",
    "magenta": "#c2185b", "lilac": "#c8a2c8", "plum": "#8e4585", "mauve": "#e0b0ff",
    "copper": "#b87333", "rose": "#e8a0bf", "rose gold": "#b76e79", "emerald": "#50c878",
    "aqua": "#00bcd4", "indigo": "#3f51b5", "lemon": "#fff44f", "mustard": "#e1ad01",
    "nude": "#e3bc9a", "champagne": "#f7e7ce", "sand": "#c2b280", "slate": "#708090",
    "denim": "#1560bd", "cobalt": "#0047ab", "cerulean": "#007ba7", "fuchsia": "#ff00ff",
    "scarlet": "#ff2400", "crimson": "#dc143c", "tangerine": "#ff9966", "apricot": "#fbceb1",
    "sea green": "#2e8b57", "pistachio": "#93c572", "lime": "#a4c639", "moss": "#8a9a5b",
};

const getColorHex = (colorName) => {
    if (!colorName) return "#d5b85a";
    const lower = colorName.toLowerCase().trim();
    // Direct match
    if (COLOR_NAME_MAP[lower]) return COLOR_NAME_MAP[lower];
    // Partial match
    for (const [key, hex] of Object.entries(COLOR_NAME_MAP)) {
        if (lower.includes(key) || key.includes(lower)) return hex;
    }
    // Fallback: generate a consistent color from name hash
    let hash = 0;
    for (let i = 0; i < lower.length; i++) hash = lower.charCodeAt(i) + ((hash << 5) - hash);
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, 55%, 50%)`;
};

// Custom tooltip for charts
const ChartTooltip = ({ active, payload, label, prefix = "₹", suffix = "" }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="cmo-chart-tooltip">
            <p className="cmo-chart-tooltip-label">{label}</p>
            {payload.map((p, i) => (
                <p key={i} className="cmo-chart-tooltip-row">
                    <span className="cmo-chart-tooltip-dot" style={{ background: p.color || p.fill }}></span>
                    <span>{p.name || "Value"}: {prefix}{formatIndianNumber(Math.round(p.value))}{suffix}</span>
                </p>
            ))}
        </div>
    );
};

// Custom XAxis tick that renders text HORIZONTAL and wraps long names
const WrappedAxisTick = ({ x, y, payload, maxWidth = 80 }) => {
    const text = payload?.value || "";
    const words = text.split(/\s+/);
    const lines = [];
    let current = "";
    words.forEach(w => {
        const test = current ? current + " " + w : w;
        if (test.length > 12 && current) { lines.push(current); current = w; }
        else { current = test; }
    });
    if (current) lines.push(current);
    // Truncate to max 2 lines
    if (lines.length > 2) { lines.length = 2; lines[1] = lines[1].substring(0, 10) + "…"; }
    return (
        <g transform={`translate(${x},${y})`}>
            {lines.map((line, i) => (
                <text key={i} x={0} y={i * 14 + 8} textAnchor="middle" fill="#666" fontSize={11} fontFamily="inherit">
                    {line}
                </text>
            ))}
        </g>
    );
};

// Growth Indicator Component
const GrowthIndicator = ({ value, inverse = false }) => {
    if (value === 0 || isNaN(value)) return null;
    const isPositive = inverse ? value < 0 : value > 0;
    const displayValue = Math.abs(value).toFixed(1);

    return (
        <span className={`growth-indicator ${isPositive ? 'positive' : 'negative'}`}>
            <span className="growth-arrow">{isPositive ? '↑' : '↓'}</span>
            {displayValue}%
        </span>
    );
};

export default function AdminDashboard() {
    const { showPopup, PopupComponent } = usePopup();
    const navigate = useNavigate();

    const [activeTab, setActiveTab] = useState("brand_performance");
    const [showSidebar, setShowSidebar] = useState(false);
    const [orders, setOrders] = useState([]);
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [pdfLoading, setPdfLoading] = useState(null);

    // Dashboard states
    const [recentOrdersCount, setRecentOrdersCount] = useState(10);
    const [timeline, setTimeline] = useState("today");
    const [comparison, setComparison] = useState("previous_period");
    const [customDateFrom, setCustomDateFrom] = useState("");
    const [customDateTo, setCustomDateTo] = useState("");
    const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);

    // Inventory states
    const [inventorySearch, setInventorySearch] = useState("");
    const [inventoryPage, setInventoryPage] = useState(1);
    const [inventoryStockFilter, setInventoryStockFilter] = useState("all"); // all, in_stock, low_stock, out_of_stock
    const [inventoryTypeFilter, setInventoryTypeFilter] = useState("all"); // all, lxrts, regular
    const [editingProductId, setEditingProductId] = useState(null);
    const [editInventoryValue, setEditInventoryValue] = useState("");
    const [savingInventory, setSavingInventory] = useState(false);
    const [expandedProduct, setExpandedProduct] = useState(null);
    const [editingVariant, setEditingVariant] = useState(null);
    const [variantEditValue, setVariantEditValue] = useState("");
    const [savingVariant, setSavingVariant] = useState(false);
    const [variantInventory, setVariantInventory] = useState({});
    const [lxrtsSyncLoading, setLxrtsSyncLoading] = useState(false);

    // Orders states
    const [orderSearch, setOrderSearch] = useState("");
    const [sortBy, setSortBy] = useState("newest");
    const [statusTab, setStatusTab] = useState("all");
    const [ordersPage, setOrdersPage] = useState(1);
    const [statusUpdating, setStatusUpdating] = useState(null);
    const [filters, setFilters] = useState({
        dateFrom: "", dateTo: "", minPrice: 0, maxPrice: 500000,
        payment: [], priority: [], orderType: [], store: [], salesperson: "",
    });
    const [openDropdown, setOpenDropdown] = useState(null);
    const dropdownRef = useRef(null);

    // Accounts states
    const [accountsSearch, setAccountsSearch] = useState("");
    const [accountsDateFrom, setAccountsDateFrom] = useState("");
    const [accountsDateTo, setAccountsDateTo] = useState("");
    const [accountsStatus, setAccountsStatus] = useState("");
    const [accountsStore, setAccountsStore] = useState("");
    const [accountsSA, setAccountsSA] = useState("");
    const [accountsPage, setAccountsPage] = useState(1);

    // Clients tab states
    const [clientsSearch, setClientsSearch] = useState("");
    const [clientsPage, setClientsPage] = useState(1);
    const [clientsSortBy, setClientsSortBy] = useState("totalSpend");
    const [clientsStoreFilter, setClientsStoreFilter] = useState("");

    // B2B tab states
    const [b2bSearch, setB2bSearch] = useState("");
    const [b2bPage, setB2bPage] = useState(1);

    // Channel filter for dashboard
    const [channelFilter, setChannelFilter] = useState("all");

    // Analytics states
    const [analyticsTimeline, setAnalyticsTimeline] = useState("monthly");
    const [analyticsCustomFrom, setAnalyticsCustomFrom] = useState("");
    const [analyticsCustomTo, setAnalyticsCustomTo] = useState("");
    const [showAnalyticsCustomPicker, setShowAnalyticsCustomPicker] = useState(false);
    const [currentUserEmail, setCurrentUserEmail] = useState("");
    // Fetch data on mount
    useEffect(() => {
        const checkAuthAndFetch = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) { navigate("/login", { replace: true }); return; }

            // ✅ Role check - only admin users allowed
            const { data: userRecord } = await supabase
                .from("salesperson")
                .select("role")
                .eq("email", session.user.email?.toLowerCase())
                .single();

            if (!userRecord || userRecord.role !== "admin") {
                console.log("❌ Access denied - not an admin");
                await supabase.auth.signOut();
                navigate("/login", { replace: true });
                return;
            }

            setCurrentUserEmail(session.user.email?.toLowerCase() || "");
            fetchAllData();
        };
        checkAuthAndFetch();
    }, [navigate]);

    const fetchAllData = async () => {
        setLoading(true);
        try {
            const [ordersRes, productsRes] = await Promise.all([
                supabase.from("orders").select("*").order("created_at", { ascending: false }),
                supabase.from("products").select("*").order("name", { ascending: true }),
            ]);
            if (ordersRes.data) setOrders(ordersRes.data);
            if (productsRes.data) setProducts(productsRes.data);
        } catch (err) { console.error("Error fetching data:", err); }
        finally { setLoading(false); }
    };

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpenDropdown(null);
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleLogout = async () => { await supabase.auth.signOut(); navigate("/login"); };

    // Helper functions
    const getPaymentStatus = (order) => {
        const total = order.grand_total || order.net_total || 0;
        const advance = order.advance_payment || 0;
        if (advance >= total) return "paid";
        if (advance > 0) return "partial";
        return "unpaid";
    };

    const getPriority = (order) => {
        if (order.is_urgent || order.order_flag === "Urgent" || order.alteration_status === "upcoming_occasion") return "urgent";
        return "normal";
    };

    const getOrderType = (order) => {
        if (order.is_alteration) return "alteration";
        const item = order.items?.[0];
        if (item?.order_type === "Custom" || item?.payment_order_type === "Custom") return "custom";
        return "standard";
    };

    const isLxrtsOrder = (order) => order.items?.[0]?.sync_enabled === true;
    const isLxrtsProduct = (product) => product.sync_enabled === true;

    // Channel classifier: LXRTS → Website, B2B → B2B, store → store name
    const getOrderChannel = (order) => {
        if (isLxrtsOrder(order)) return "Website (LXRTS)";
        const store = (order.salesperson_store || "").trim();
        if (!store) return "Other";
        if (store.toLowerCase() === "b2b") return "B2B";
        return store;
    };

    // Get actual person name (not store name) for salesperson fields
    const getOrderSalesperson = (order) => {
        // For B2B orders, use merchandiser_name or approved_by as the person
        if (order.is_b2b || (order.salesperson_store || "").toLowerCase() === "b2b") {
            return order.merchandiser_name || order.salesperson || null;
        }
        return order.salesperson || null;
    };

    // Known store names to exclude from salesperson lists
    const knownStoreNames = useMemo(() => {
        const stores = new Set();
        orders.forEach(o => {
            const s = (o.salesperson_store || "").trim();
            if (s) stores.add(s);
        });
        return stores;
    }, [orders]);

    const isPersonName = (name) => {
        if (!name || name === "-" || name === "Unknown") return false;
        return !knownStoreNames.has(name);
    };

    const getLxrtsTotalInventory = (productId) => {
        const variants = variantInventory[productId];
        if (!variants) return 0;
        return Object.values(variants).reduce((sum, qty) => sum + (qty || 0), 0);
    };

    const getProductSizes = (productId) => {
        const variants = variantInventory[productId];
        if (!variants) return [];
        const knownSizes = SIZE_ORDER.filter((s) => variants[s] !== undefined);
        const extraSizes = Object.keys(variants).filter((s) => !SIZE_ORDER.includes(s)).sort();
        return [...knownSizes, ...extraSizes];
    };

    const getInventoryClass = (count) => {
        if (count === 0) return "admin-stock-out";
        if (count < 5) return "admin-stock-low";
        return "admin-stock-ok";
    };

    // Date range helpers
    const getDateRange = (timelineValue) => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        switch (timelineValue) {
            case "today": return { start: today, end: now };
            case "yesterday":
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayEnd = new Date(today);
                yesterdayEnd.setMilliseconds(-1);
                return { start: yesterday, end: yesterdayEnd };
            case "weekly":
                const weekAgo = new Date(today);
                weekAgo.setDate(weekAgo.getDate() - 7);
                return { start: weekAgo, end: now };
            case "monthly":
                const monthAgo = new Date(today);
                monthAgo.setDate(monthAgo.getDate() - 30);
                return { start: monthAgo, end: now };
            case "yearly":
                const yearAgo = new Date(today);
                yearAgo.setDate(yearAgo.getDate() - 365);
                return { start: yearAgo, end: now };
            case "custom":
                return {
                    start: customDateFrom ? new Date(customDateFrom) : new Date(0),
                    end: customDateTo ? new Date(customDateTo + "T23:59:59") : now
                };
            default: return { start: today, end: now };
        }
    };

    const getComparisonDateRange = (timelineValue, comparisonType) => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const currentRange = getDateRange(timelineValue);

        if (comparisonType === "previous_year") {
            // Same period last year
            const startLastYear = new Date(currentRange.start);
            startLastYear.setFullYear(startLastYear.getFullYear() - 1);
            const endLastYear = new Date(currentRange.end);
            endLastYear.setFullYear(endLastYear.getFullYear() - 1);
            return { start: startLastYear, end: endLastYear };
        }

        // previous_period - period immediately before current
        switch (timelineValue) {
            case "today":
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayEnd = new Date(today);
                yesterdayEnd.setMilliseconds(-1);
                return { start: yesterday, end: yesterdayEnd };
            case "yesterday":
                const twoDaysAgo = new Date(today);
                twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
                const twoDaysAgoEnd = new Date(today);
                twoDaysAgoEnd.setDate(twoDaysAgoEnd.getDate() - 1);
                twoDaysAgoEnd.setMilliseconds(-1);
                return { start: twoDaysAgo, end: twoDaysAgoEnd };
            case "weekly":
                const twoWeeksAgo = new Date(today);
                twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
                const oneWeekAgo = new Date(today);
                oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
                oneWeekAgo.setMilliseconds(-1);
                return { start: twoWeeksAgo, end: oneWeekAgo };
            case "monthly":
                const twoMonthsAgo = new Date(today);
                twoMonthsAgo.setDate(twoMonthsAgo.getDate() - 60);
                const oneMonthAgo = new Date(today);
                oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
                oneMonthAgo.setMilliseconds(-1);
                return { start: twoMonthsAgo, end: oneMonthAgo };
            case "yearly":
                const twoYearsAgo = new Date(today);
                twoYearsAgo.setDate(twoYearsAgo.getDate() - 730);
                const oneYearAgo = new Date(today);
                oneYearAgo.setDate(oneYearAgo.getDate() - 365);
                oneYearAgo.setMilliseconds(-1);
                return { start: twoYearsAgo, end: oneYearAgo };
            case "custom":
                if (customDateFrom && customDateTo) {
                    const customStart = new Date(customDateFrom);
                    const customEnd = new Date(customDateTo + "T23:59:59");
                    const customDuration = customEnd - customStart;
                    const prevEnd = new Date(customStart);
                    prevEnd.setMilliseconds(-1);
                    const prevStart = new Date(prevEnd - customDuration);
                    return { start: prevStart, end: prevEnd };
                }
                return null;
            default: return null;
        }
    };

    const filterOrdersByDateRange = (ordersList, dateRange) => {
        if (!dateRange) return ordersList;
        return ordersList.filter(o => {
            const orderDate = new Date(o.created_at);
            return orderDate >= dateRange.start && orderDate <= dateRange.end;
        });
    };

    const calculateGrowth = (current, previous) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return ((current - previous) / previous) * 100;
    };

    // Dashboard Stats (ALL orders: store + website/LXRTS + B2B)
    const dashboardStats = useMemo(() => {
        const dateRange = getDateRange(timeline);
        const comparisonRange = getComparisonDateRange(timeline, comparison);

        const currentOrders = filterOrdersByDateRange(orders, dateRange);
        const previousOrders = comparisonRange ? filterOrdersByDateRange(orders, comparisonRange) : [];

        const totalRevenue = currentOrders.reduce((sum, o) => sum + Number(o.grand_total || 0), 0);
        const totalOrders = currentOrders.length;
        const pendingOrders = currentOrders.filter(o => o.status !== "completed" && o.status !== "delivered" && o.status !== "cancelled").length;
        const preparedOrders = currentOrders.filter(o => o.status === "completed").length;
        const deliveredOrders = currentOrders.filter(o => o.status === "delivered").length;
        const cancelledOrders = currentOrders.filter(o => o.status === "cancelled").length;

        const prevRevenue = previousOrders.reduce((sum, o) => sum + Number(o.grand_total || 0), 0);
        const prevTotalOrders = previousOrders.length;
        const prevPendingOrders = previousOrders.filter(o => o.status !== "completed" && o.status !== "delivered" && o.status !== "cancelled").length;
        const prevPreparedOrders = previousOrders.filter(o => o.status === "completed").length;
        const prevDeliveredOrders = previousOrders.filter(o => o.status === "delivered").length;
        const prevCancelledOrders = previousOrders.filter(o => o.status === "cancelled").length;

        return {
            totalRevenue, totalOrders, pendingOrders, preparedOrders, deliveredOrders, cancelledOrders,
            revenueGrowth: calculateGrowth(totalRevenue, prevRevenue),
            ordersGrowth: calculateGrowth(totalOrders, prevTotalOrders),
            pendingGrowth: calculateGrowth(pendingOrders, prevPendingOrders),
            preparedGrowth: calculateGrowth(preparedOrders, prevPreparedOrders),
            deliveredGrowth: calculateGrowth(deliveredOrders, prevDeliveredOrders),
            cancelledGrowth: calculateGrowth(cancelledOrders, prevCancelledOrders),
            showComparison: comparison !== "none",
        };
    }, [orders, timeline, comparison, customDateFrom, customDateTo]);

    const inventoryStats = useMemo(() => {
        const total = products.length;
        const onShopify = products.filter(p => p.shopify_product_id).length;
        let lowStock = 0, outOfStock = 0, totalInventory = 0;

        products.forEach((p) => {
            if (p.sync_enabled) {
                const totalQty = getLxrtsTotalInventory(p.id);
                totalInventory += totalQty;
                if (totalQty === 0) outOfStock++;
                else if (totalQty < 5) lowStock++;
            } else {
                const qty = p.inventory || 0;
                totalInventory += qty;
                if (qty === 0) outOfStock++;
                else if (qty < 5) lowStock++;
            }
        });
        return { total, onShopify, lowStock, outOfStock, totalInventory };
    }, [products, variantInventory]);

    // Analytics date range helper
    const getAnalyticsDateRange = (timelineValue) => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        switch (timelineValue) {
            case "today": return { start: today, end: now };
            case "yesterday":
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayEnd = new Date(today);
                yesterdayEnd.setMilliseconds(-1);
                return { start: yesterday, end: yesterdayEnd };
            case "weekly":
                const weekAgo = new Date(today);
                weekAgo.setDate(weekAgo.getDate() - 7);
                return { start: weekAgo, end: now };
            case "monthly":
                const monthAgo = new Date(today);
                monthAgo.setDate(monthAgo.getDate() - 30);
                return { start: monthAgo, end: now };
            case "yearly":
                const yearAgo = new Date(today);
                yearAgo.setDate(yearAgo.getDate() - 365);
                return { start: yearAgo, end: now };
            case "custom":
                return {
                    start: analyticsCustomFrom ? new Date(analyticsCustomFrom) : new Date(0),
                    end: analyticsCustomTo ? new Date(analyticsCustomTo + "T23:59:59") : now
                };
            default: return { start: today, end: now };
        }
    };

    // Analytics Data
    const analyticsData = useMemo(() => {
        const dateRange = getAnalyticsDateRange(analyticsTimeline);
        const validOrders = orders.filter(o => {
            if (o.status === "cancelled") return false;
            const orderDate = new Date(o.created_at);
            return orderDate >= dateRange.start && orderDate <= dateRange.end;
        });

        // 1. Sales by Top 10 Products
        const productSales = {};
        validOrders.forEach(order => {
            (order.items || []).forEach(item => {
                const name = item.product_name || "Unknown";
                if (!productSales[name]) productSales[name] = { name, sales: 0, count: 0 };
                productSales[name].sales += Number(item.price || 0) * Number(item.quantity || 1);
                productSales[name].count += Number(item.quantity || 1);
            });
        });
        const topProducts = Object.values(productSales)
            .sort((a, b) => b.sales - a.sales)
            .slice(0, 10);

        // 2. Sales by Top 10 Colors
        const colorSales = {};
        validOrders.forEach(order => {
            (order.items || []).forEach(item => {
                const topColor = item.top_color?.name || item.color?.name || "Unknown";
                const bottomColor = item.bottom_color?.name;
                const itemSales = Number(item.price || 0) * Number(item.quantity || 1);

                if (topColor && topColor !== "Unknown") {
                    if (!colorSales[topColor]) colorSales[topColor] = { name: topColor, sales: 0, count: 0 };
                    colorSales[topColor].sales += itemSales / (bottomColor ? 2 : 1);
                    colorSales[topColor].count += 1;
                }
                if (bottomColor) {
                    if (!colorSales[bottomColor]) colorSales[bottomColor] = { name: bottomColor, sales: 0, count: 0 };
                    colorSales[bottomColor].sales += itemSales / 2;
                    colorSales[bottomColor].count += 1;
                }
            });
        });
        const topColors = Object.values(colorSales)
            .sort((a, b) => b.sales - a.sales)
            .slice(0, 10);

        // 3. Sales by Store / Channel
        const storeSales = {};
        validOrders.forEach(order => {
            const store = getOrderChannel(order);
            if (!storeSales[store]) storeSales[store] = { name: store, sales: 0, count: 0 };
            storeSales[store].sales += Number(order.grand_total || 0);
            storeSales[store].count += 1;
        });
        const salesByStore = Object.values(storeSales).sort((a, b) => b.sales - a.sales);

        // 4. Sales and Discounts by Salesperson
        const salespersonData = {};
        validOrders.forEach(order => {
            const sp = getOrderSalesperson(order);
            if (!sp || !isPersonName(sp)) return;
            if (!salespersonData[sp]) salespersonData[sp] = { name: sp, sales: 0, discount: 0, count: 0 };
            salespersonData[sp].sales += Number(order.grand_total || 0);
            salespersonData[sp].discount += Number(order.discount_amount || 0);
            salespersonData[sp].count += 1;
        });
        const salesBySalesperson = Object.values(salespersonData)
            .sort((a, b) => b.sales - a.sales)
            .slice(0, 10);

        // 5. Alteration by Outfit (filter alteration orders)
        const alterationOrders = orders.filter(o => {
            if (!o.is_alteration) return false;
            const orderDate = new Date(o.created_at);
            return orderDate >= dateRange.start && orderDate <= dateRange.end;
        });

        const outfitAlterations = {};
        alterationOrders.forEach(order => {
            (order.items || []).forEach(item => {
                const outfit = item.product_name || item.top || "Unknown";
                if (!outfitAlterations[outfit]) outfitAlterations[outfit] = { name: outfit, count: 0 };
                outfitAlterations[outfit].count += 1;
            });
        });
        const alterationsByOutfit = Object.values(outfitAlterations)
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        // 6. Alteration by Customers
        const customerAlterations = {};
        alterationOrders.forEach(order => {
            const customer = order.delivery_name || "Unknown";
            if (!customerAlterations[customer]) customerAlterations[customer] = { name: customer, count: 0 };
            customerAlterations[customer].count += 1;
        });
        const alterationsByCustomer = Object.values(customerAlterations)
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        return {
            topProducts,
            topColors,
            salesByStore,
            salesBySalesperson,
            alterationsByOutfit,
            alterationsByCustomer,
            totalAlterations: alterationOrders.length,
        };
    }, [orders, analyticsTimeline, analyticsCustomFrom, analyticsCustomTo]);

    const handleAnalyticsTimelineChange = (value) => {
        setAnalyticsTimeline(value);
        setShowAnalyticsCustomPicker(value === "custom");
    };

    const recentOrders = useMemo(() => orders.filter(o => !isLxrtsOrder(o)).slice(0, recentOrdersCount), [orders, recentOrdersCount]);

    // Inventory
    const filteredProducts = useMemo(() => {
        let result = products;
        // Search filter
        if (inventorySearch) {
            const q = inventorySearch.toLowerCase();
            result = result.filter(p => p.name?.toLowerCase().includes(q) || p.sku_id?.toLowerCase().includes(q));
        }
        // Type filter
        if (inventoryTypeFilter === "lxrts") result = result.filter(p => p.sync_enabled);
        else if (inventoryTypeFilter === "regular") result = result.filter(p => !p.sync_enabled);
        // Stock level filter
        if (inventoryStockFilter === "out_of_stock") result = result.filter(p => {
            const inv = p.sync_enabled ? getLxrtsTotalInventory(p.id) : (p.inventory || 0);
            return inv === 0;
        });
        else if (inventoryStockFilter === "low_stock") result = result.filter(p => {
            const inv = p.sync_enabled ? getLxrtsTotalInventory(p.id) : (p.inventory || 0);
            return inv > 0 && inv < 5;
        });
        else if (inventoryStockFilter === "in_stock") result = result.filter(p => {
            const inv = p.sync_enabled ? getLxrtsTotalInventory(p.id) : (p.inventory || 0);
            return inv >= 5;
        });
        return result;
    }, [products, inventorySearch, inventoryTypeFilter, inventoryStockFilter, variantInventory]);

    const inventoryTotalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);
    const currentProducts = useMemo(() => {
        const start = (inventoryPage - 1) * ITEMS_PER_PAGE;
        return filteredProducts.slice(start, start + ITEMS_PER_PAGE);
    }, [filteredProducts, inventoryPage]);

    const handleInventoryUpdate = async (productId) => {
        if (editInventoryValue === "" || isNaN(Number(editInventoryValue))) {
            showPopup({ title: "Invalid", message: "Please enter a valid number.", type: "warning" });
            return;
        }
        setSavingInventory(true);
        const { error } = await supabase.from("products").update({ inventory: Number(editInventoryValue) }).eq("id", productId);
        if (error) showPopup({ title: "Error", message: "Failed to update inventory.", type: "error" });
        else {
            setProducts(prev => prev.map(p => p.id === productId ? { ...p, inventory: Number(editInventoryValue) } : p));
            setEditingProductId(null);
            setEditInventoryValue("");
        }
        setSavingInventory(false);
    };

    // LXRTS functions
    const fetchAllLxrtsInventory = async (lxrtsProducts) => {
        setLxrtsSyncLoading(true);
        const inventoryMap = {};

        await Promise.allSettled(lxrtsProducts.map(async (product) => {
            try {
                const response = await fetch(`${config.SUPABASE_URL}/functions/v1/shopify-inventory`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", apikey: config.SUPABASE_KEY, Authorization: `Bearer ${config.SUPABASE_KEY}` },
                    body: JSON.stringify({ action: "fetch", product_id: product.id }),
                });
                const result = await response.json();
                if (result.success && result.inventory) inventoryMap[product.id] = result.inventory;
                else {
                    const { data: variants } = await supabase.from("product_variants").select("size, inventory").eq("product_id", product.id);
                    if (variants) { const map = {}; variants.forEach((v) => { map[v.size] = v.inventory || 0; }); inventoryMap[product.id] = map; }
                }
            } catch (err) {
                console.error(`Error syncing ${product.name}:`, err);
                const { data: variants } = await supabase.from("product_variants").select("size, inventory").eq("product_id", product.id);
                if (variants) { const map = {}; variants.forEach((v) => { map[v.size] = v.inventory || 0; }); inventoryMap[product.id] = map; }
            }
        }));
        setVariantInventory(inventoryMap);
        setLxrtsSyncLoading(false);
    };

    const handleExpandProduct = (product) => setExpandedProduct(expandedProduct === product.id ? null : product.id);

    const handleVariantInventoryUpdate = async (productId, size) => {
        const newQty = Number(variantEditValue);
        if (variantEditValue === "" || isNaN(newQty) || newQty < 0) return;
        setSavingVariant(true);
        try {
            const oldQty = variantInventory[productId]?.[size] || 0;
            const { error: updateError } = await supabase.from("product_variants").update({ inventory: newQty }).eq("product_id", productId).eq("size", size);
            if (updateError) throw new Error("Failed to update Supabase");
            const delta = oldQty - newQty;
            if (delta !== 0) {
                try {
                    const response = await fetch(`${config.SUPABASE_URL}/functions/v1/shopify-inventory`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json", apikey: config.SUPABASE_KEY, Authorization: `Bearer ${config.SUPABASE_KEY}` },
                        body: JSON.stringify({ action: "reduce", product_id: productId, size, quantity: delta }),
                    });
                    const result = await response.json();
                    if (!result.success) console.error("Shopify sync failed:", result.error);
                } catch (shopifyErr) { console.error("Shopify sync error:", shopifyErr); }
            }
            setVariantInventory((prev) => ({ ...prev, [productId]: { ...prev[productId], [size]: newQty } }));
        } catch (err) { console.error("Variant update error:", err); }
        setEditingVariant(null);
        setVariantEditValue("");
        setSavingVariant(false);
    };

    // Orders
    const salespersons = useMemo(() => {
        const spSet = new Set();
        orders.forEach(o => {
            const sp = getOrderSalesperson(o);
            if (sp && isPersonName(sp)) spSet.add(sp);
        });
        return Array.from(spSet).sort();
    }, [orders, knownStoreNames]);

    const filteredByStatus = useMemo(() => {
        return orders.filter(o => {
            if (isLxrtsOrder(o)) return false;
            const status = o.status?.toLowerCase();
            switch (statusTab) {
                case "unfulfilled": return status !== "completed" && status !== "delivered" && status !== "cancelled";
                case "prepared": return status === "completed";
                case "delivered": return status === "delivered";
                case "cancelled": return status === "cancelled";
                default: return true;
            }
        });
    }, [orders, statusTab]);

    const filteredOrders = useMemo(() => {
        let result = filteredByStatus;
        if (orderSearch.trim()) {
            const q = orderSearch.toLowerCase();
            result = result.filter(order => {
                const item = order.items?.[0] || {};
                return order.order_no?.toLowerCase().includes(q) || item.product_name?.toLowerCase().includes(q) ||
                    order.delivery_name?.toLowerCase().includes(q) || order.delivery_phone?.includes(q) || (getOrderSalesperson(order) || "").toLowerCase().includes(q);
            });
        }
        if (filters.dateFrom || filters.dateTo) {
            result = result.filter(order => {
                const orderDate = new Date(order.created_at);
                if (filters.dateFrom && orderDate < new Date(filters.dateFrom)) return false;
                if (filters.dateTo && orderDate > new Date(filters.dateTo + "T23:59:59")) return false;
                return true;
            });
        }
        if (filters.minPrice > 0 || filters.maxPrice < 500000) {
            result = result.filter(order => {
                const total = order.grand_total || order.net_total || 0;
                return total >= filters.minPrice && total <= filters.maxPrice;
            });
        }
        if (filters.payment.length > 0) result = result.filter(order => filters.payment.includes(getPaymentStatus(order)));
        if (filters.priority.length > 0) result = result.filter(order => filters.priority.includes(getPriority(order)));
        if (filters.orderType.length > 0) result = result.filter(order => filters.orderType.includes(getOrderType(order)));
        if (filters.store.length > 0) result = result.filter(order => filters.store.includes(order.salesperson_store));
        if (filters.salesperson) result = result.filter(order => getOrderSalesperson(order) === filters.salesperson);

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
        const validOrders = orders.filter(o => !isLxrtsOrder(o));
        return {
            all: validOrders.length,
            unfulfilled: validOrders.filter(o => { const s = o.status?.toLowerCase(); return s !== "completed" && s !== "delivered" && s !== "cancelled"; }).length,
            prepared: validOrders.filter(o => o.status?.toLowerCase() === "completed").length,
            delivered: validOrders.filter(o => o.status?.toLowerCase() === "delivered").length,
            cancelled: validOrders.filter(o => o.status?.toLowerCase() === "cancelled").length,
        };
    }, [orders]);

    const ordersTotalPages = Math.ceil(filteredOrders.length / ITEMS_PER_PAGE);
    const currentOrders = useMemo(() => {
        const start = (ordersPage - 1) * ITEMS_PER_PAGE;
        return filteredOrders.slice(start, start + ITEMS_PER_PAGE);
    }, [filteredOrders, ordersPage]);

    const appliedFilters = useMemo(() => {
        const chips = [];
        if (filters.dateFrom || filters.dateTo) {
            const label = filters.dateFrom && filters.dateTo ? `${filters.dateFrom} to ${filters.dateTo}` : filters.dateFrom ? `From ${filters.dateFrom}` : `Until ${filters.dateTo}`;
            chips.push({ type: "date", label });
        }
        if (filters.minPrice > 0 || filters.maxPrice < 500000) chips.push({ type: "price", label: `₹${(filters.minPrice / 1000).toFixed(0)}K - ₹${(filters.maxPrice / 1000).toFixed(0)}K` });
        filters.payment.forEach(p => chips.push({ type: "payment", value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }));
        filters.priority.forEach(p => chips.push({ type: "priority", value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }));
        filters.orderType.forEach(t => chips.push({ type: "orderType", value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }));
        filters.store.forEach(s => chips.push({ type: "store", value: s, label: s }));
        if (filters.salesperson) chips.push({ type: "salesperson", label: filters.salesperson });
        return chips;
    }, [filters]);

    const removeFilter = (type, value) => {
        if (type === "date") setFilters(prev => ({ ...prev, dateFrom: "", dateTo: "" }));
        else if (type === "price") setFilters(prev => ({ ...prev, minPrice: 0, maxPrice: 500000 }));
        else if (type === "salesperson") setFilters(prev => ({ ...prev, salesperson: "" }));
        else setFilters(prev => ({ ...prev, [type]: prev[type].filter(v => v !== value) }));
    };

    const clearAllFilters = () => setFilters({ dateFrom: "", dateTo: "", minPrice: 0, maxPrice: 500000, payment: [], priority: [], orderType: [], store: [], salesperson: "" });

    const toggleFilter = (category, value) => setFilters(prev => ({
        ...prev, [category]: prev[category].includes(value) ? prev[category].filter(v => v !== value) : [...prev[category], value]
    }));

    const updateOrderStatus = async (orderId, newStatus) => {
        setStatusUpdating(orderId);
        const updateData = { status: newStatus };
        if (newStatus === "delivered") updateData.delivered_at = new Date().toISOString();
        const { error } = await supabase.from("orders").update(updateData).eq("id", orderId);
        if (error) showPopup({ title: "Error", message: "Failed to update status.", type: "error" });
        else setOrders(prev => prev.map(o => o.id === orderId ? { ...o, ...updateData } : o));
        setStatusUpdating(null);
    };

    // Accounts
    const accountsLineItems = useMemo(() => {
        const items = [];
        orders.forEach(order => {
            if (isLxrtsOrder(order)) return;
            const orderItems = order.items || [];
            orderItems.forEach((item, idx) => {
                const productPrice = item.price || 0;
                const quantity = item.quantity || 1;
                const grossValue = productPrice * quantity;
                const orderSubtotal = order.subtotal || order.grand_total || 0;
                const orderDiscount = order.discount_amount || 0;
                const discountRatio = orderSubtotal > 0 ? grossValue / orderSubtotal : 0;
                const productDiscount = orderDiscount * discountRatio;
                const taxableValue = grossValue - productDiscount;
                const gstRate = 0.05;
                const gst = taxableValue * gstRate;
                const invoiceValue = taxableValue + gst;

                items.push({
                    id: `${order.id}-${idx}`, order_no: order.order_no, order_date: order.created_at,
                    sa_name: getOrderSalesperson(order) || "-", client_name: order.delivery_name || "-",
                    product_name: item.product_name || "-",
                    gross_value: Math.round(grossValue * 100) / 100, discount: Math.round(productDiscount * 100) / 100,
                    taxable_value: Math.round(taxableValue * 100) / 100, gst: Math.round(gst * 100) / 100,
                    invoice_value: Math.round(invoiceValue * 100) / 100, quantity,
                    status: order.status || "pending", delivery_date: item.delivery_date || order.delivery_date,
                    store: order.salesperson_store || "-", payment_mode: order.payment_mode || "-",
                });
            });
        });
        return items;
    }, [orders]);

    const filteredAccountItems = useMemo(() => {
        let result = accountsLineItems;
        if (accountsSearch.trim()) {
            const q = accountsSearch.toLowerCase();
            result = result.filter(item => item.order_no?.toLowerCase().includes(q) || item.client_name?.toLowerCase().includes(q) ||
                item.product_name?.toLowerCase().includes(q) || item.sa_name?.toLowerCase().includes(q));
        }
        if (accountsDateFrom) result = result.filter(item => new Date(item.order_date) >= new Date(accountsDateFrom));
        if (accountsDateTo) result = result.filter(item => new Date(item.order_date) <= new Date(accountsDateTo + "T23:59:59"));
        if (accountsStatus) result = result.filter(item => item.status === accountsStatus);
        if (accountsStore) result = result.filter(item => item.store === accountsStore);
        if (accountsSA) result = result.filter(item => item.sa_name === accountsSA);
        return result;
    }, [accountsLineItems, accountsSearch, accountsDateFrom, accountsDateTo, accountsStatus, accountsStore, accountsSA]);

    // Unique stores and SAs for account filter dropdowns
    const accountsStoreOptions = useMemo(() => [...new Set(accountsLineItems.map(i => i.store).filter(s => s && s !== "-"))].sort(), [accountsLineItems]);
    const accountsSAOptions = useMemo(() => [...new Set(accountsLineItems.map(i => i.sa_name).filter(s => s && s !== "-" && isPersonName(s)))].sort(), [accountsLineItems, knownStoreNames]);

    const accountsTotalPages = Math.ceil(filteredAccountItems.length / 20);
    const currentAccountItems = useMemo(() => {
        const start = (accountsPage - 1) * 20;
        return filteredAccountItems.slice(start, start + 20);
    }, [filteredAccountItems, accountsPage]);

    const accountsTotals = useMemo(() => ({
        gross: filteredAccountItems.reduce((sum, i) => sum + i.gross_value, 0),
        discount: filteredAccountItems.reduce((sum, i) => sum + i.discount, 0),
        taxable: filteredAccountItems.reduce((sum, i) => sum + i.taxable_value, 0),
        gst: filteredAccountItems.reduce((sum, i) => sum + i.gst, 0),
        invoice: filteredAccountItems.reduce((sum, i) => sum + i.invoice_value, 0),
    }), [filteredAccountItems]);

    // ═══════════════════════════════════════════════════════════
    // NEW: ENHANCED DASHBOARD STATS (Channel breakdown, AOV)
    // ═══════════════════════════════════════════════════════════
    const enhancedDashboardStats = useMemo(() => {
        const dateRange = getDateRange(timeline);
        const validOrders = orders.filter(o => {
            const d = new Date(o.created_at);
            return d >= dateRange.start && d <= dateRange.end;
        });

        const totalRevenue = validOrders.reduce((s, o) => s + Number(o.grand_total || 0), 0);
        const totalOrders = validOrders.length;
        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const totalItems = validOrders.reduce((s, o) => s + (o.items?.reduce((q, it) => q + (it.quantity || 1), 0) || 0), 0);

        // Channel breakdown using proper classification
        const channelMap = {};
        validOrders.forEach(o => {
            const ch = getOrderChannel(o);
            if (!channelMap[ch]) channelMap[ch] = { name: ch, revenue: 0, orders: 0 };
            channelMap[ch].revenue += Number(o.grand_total || 0);
            channelMap[ch].orders += 1;
        });
        const channelBreakdown = Object.values(channelMap).sort((a, b) => b.revenue - a.revenue);

        // Revenue mix %
        const revenueMix = channelBreakdown.map(ch => ({
            ...ch,
            percent: totalRevenue > 0 ? ((ch.revenue / totalRevenue) * 100).toFixed(1) : 0
        }));

        return { avgOrderValue, totalItems, channelBreakdown, revenueMix };
    }, [orders, timeline, customDateFrom, customDateTo]);

    // ═══════════════════════════════════════════════════════════
    // NEW: ORDER VALUE TREND (Daily line chart)
    // ═══════════════════════════════════════════════════════════
    const orderValueTrend = useMemo(() => {
        const dateRange = getDateRange(timeline);
        const validOrders = orders.filter(o => {
            const d = new Date(o.created_at);
            return d >= dateRange.start && d <= dateRange.end;
        });
        const buckets = {};
        validOrders.forEach(o => {
            const d = new Date(o.created_at);
            const key = `${d.getDate()}/${d.getMonth() + 1}`;
            if (!buckets[key]) buckets[key] = { date: key, fullDate: d.toISOString().split("T")[0], revenue: 0, orders: 0 };
            buckets[key].revenue += Number(o.grand_total || 0);
            buckets[key].orders += 1;
        });
        return Object.values(buckets)
            .sort((a, b) => a.fullDate.localeCompare(b.fullDate))
            .map(b => ({ ...b, aov: b.orders > 0 ? Math.round(b.revenue / b.orders) : 0 }));
    }, [orders, timeline, customDateFrom, customDateTo]);

    // ═══════════════════════════════════════════════════════════
    // NEW: ENHANCED ANALYTICS (bottom products, colors, flagged)
    // ═══════════════════════════════════════════════════════════
    const enhancedAnalytics = useMemo(() => {
        const dateRange = getAnalyticsDateRange(analyticsTimeline);
        const validOrders = orders.filter(o => {
            if (o.status === "cancelled") return false;
            const d = new Date(o.created_at);
            return d >= dateRange.start && d <= dateRange.end;
        });

        // Products
        const productSales = {};
        validOrders.forEach(order => {
            (order.items || []).forEach(item => {
                const name = item.product_name || "Unknown";
                if (!productSales[name]) productSales[name] = { name, sales: 0, count: 0 };
                productSales[name].sales += Number(item.price || 0) * Number(item.quantity || 1);
                productSales[name].count += Number(item.quantity || 1);
            });
        });
        const sortedProducts = Object.values(productSales).sort((a, b) => b.sales - a.sales);
        const bottomProducts = [...sortedProducts].sort((a, b) => a.sales - b.sales).slice(0, 10);

        // Colors
        const colorSales = {};
        validOrders.forEach(order => {
            (order.items || []).forEach(item => {
                const topColor = item.top_color?.name || item.color?.name;
                const bottomColor = item.bottom_color?.name;
                const itemSales = Number(item.price || 0) * Number(item.quantity || 1);
                if (topColor && topColor !== "Unknown") {
                    if (!colorSales[topColor]) colorSales[topColor] = { name: topColor, sales: 0, count: 0 };
                    colorSales[topColor].sales += bottomColor ? itemSales / 2 : itemSales;
                    colorSales[topColor].count += 1;
                }
                if (bottomColor) {
                    if (!colorSales[bottomColor]) colorSales[bottomColor] = { name: bottomColor, sales: 0, count: 0 };
                    colorSales[bottomColor].sales += itemSales / 2;
                    colorSales[bottomColor].count += 1;
                }
            });
        });
        const sortedColors = Object.values(colorSales).sort((a, b) => b.sales - a.sales);
        const bottomColors = [...sortedColors].sort((a, b) => a.sales - b.sales).slice(0, 5);

        // Alterations: flagged + avg per outfit
        const alterationOrders = orders.filter(o => {
            if (!o.is_alteration) return false;
            const d = new Date(o.created_at);
            return d >= dateRange.start && d <= dateRange.end;
        });

        const outfitAlterations = {};
        alterationOrders.forEach(order => {
            (order.items || []).forEach(item => {
                const outfit = item.product_name || "Unknown";
                if (!outfitAlterations[outfit]) outfitAlterations[outfit] = { name: outfit, count: 0 };
                outfitAlterations[outfit].count += 1;
            });
        });
        const totalAlterations = alterationOrders.length;
        const totalProductsSold = Object.values(productSales).reduce((s, p) => s + p.count, 0);
        const avgAlterationsPerOutfit = totalProductsSold > 0 ? (totalAlterations / totalProductsSold) : 0;
        const flaggedAlterations = Object.values(outfitAlterations).filter(a => a.count >= 3).sort((a, b) => b.count - a.count);

        return { bottomProducts, bottomColors, avgAlterationsPerOutfit, flaggedAlterations, totalAlterations };
    }, [orders, analyticsTimeline, analyticsCustomFrom, analyticsCustomTo]);

    // ═══════════════════════════════════════════════════════════
    // NEW: CLIENT ANALYTICS
    // ═══════════════════════════════════════════════════════════
    const clientAnalytics = useMemo(() => {
        const allOrders = orders;
        const clientMap = {};
        const now = new Date();
        const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());

        allOrders.forEach(order => {
            const phone = order.delivery_phone || order.phone;
            const name = order.delivery_name || "Unknown";
            if (!phone) return;
            if (!clientMap[phone]) {
                clientMap[phone] = {
                    name, phone,
                    city: order.delivery_city || order.city || "-",
                    totalSpend: 0, spend12M: 0, orderCount: 0, items: 0,
                    firstOrder: order.created_at, lastOrder: order.created_at,
                    stores: new Set(),
                };
            }
            const c = clientMap[phone];
            const amount = Number(order.grand_total || 0);
            c.totalSpend += amount;
            c.orderCount += 1;
            c.items += (order.items?.reduce((q, it) => q + (it.quantity || 1), 0) || 0);
            const ch = getOrderChannel(order);
            if (ch) c.stores.add(ch);
            if (new Date(order.created_at) >= twelveMonthsAgo) c.spend12M += amount;
            if (new Date(order.created_at) < new Date(c.firstOrder)) c.firstOrder = order.created_at;
            if (new Date(order.created_at) > new Date(c.lastOrder)) c.lastOrder = order.created_at;
            if (c.name === "Unknown" && name !== "Unknown") c.name = name;
        });

        const clients = Object.values(clientMap).map(c => ({
            ...c, stores: Array.from(c.stores).join(", "),
            avgOrderValue: c.orderCount > 0 ? c.totalSpend / c.orderCount : 0,
        }));

        const totalClients = clients.length;
        const repeatClients = clients.filter(c => c.orderCount > 1);
        const repeatRate = totalClients > 0 ? ((repeatClients.length / totalClients) * 100) : 0;

        const dateRange = getDateRange(timeline);
        const newClients = clients.filter(c => {
            const first = new Date(c.firstOrder);
            return first >= dateRange.start && first <= dateRange.end;
        });

        // Apply store filter
        let sortedClients = [...clients];
        if (clientsStoreFilter) {
            sortedClients = sortedClients.filter(c => c.stores.includes(clientsStoreFilter));
        }

        // Sort
        if (clientsSortBy === "totalSpend") sortedClients.sort((a, b) => b.totalSpend - a.totalSpend);
        else if (clientsSortBy === "orderCount") sortedClients.sort((a, b) => b.orderCount - a.orderCount);
        else if (clientsSortBy === "recent") sortedClients.sort((a, b) => new Date(b.lastOrder) - new Date(a.lastOrder));

        // Search
        if (clientsSearch.trim()) {
            const q = clientsSearch.toLowerCase();
            sortedClients = sortedClients.filter(c =>
                c.name?.toLowerCase().includes(q) || c.phone?.includes(q) || c.city?.toLowerCase().includes(q)
            );
        }

        const clientsTotalPages = Math.ceil(sortedClients.length / ITEMS_PER_PAGE);
        const currentClients = sortedClients.slice((clientsPage - 1) * ITEMS_PER_PAGE, clientsPage * ITEMS_PER_PAGE);

        const segmentation = [
            { name: "New", value: newClients.length },
            { name: "One-time", value: clients.filter(c => c.orderCount === 1).length },
            { name: "Repeat (2-3)", value: clients.filter(c => c.orderCount >= 2 && c.orderCount <= 3).length },
            { name: "Loyal (4+)", value: clients.filter(c => c.orderCount >= 4).length },
        ];

        const storeClients = {};
        clients.forEach(c => {
            (c.stores || "").split(", ").filter(Boolean).forEach(store => {
                if (!storeClients[store]) storeClients[store] = { name: store, count: 0, spend: 0 };
                storeClients[store].count += 1;
                storeClients[store].spend += c.totalSpend;
            });
        });

        // Unique store list for filter dropdown
        const storeList = Object.keys(storeClients).sort();

        return {
            totalClients, repeatRate: repeatRate.toFixed(1), newClientsCount: newClients.length,
            currentClients, clientsTotalPages, sortedClients,
            segmentation, storeClients: Object.values(storeClients).sort((a, b) => b.spend - a.spend),
            topClients: [...clients].sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 10),
            storeList,
        };
    }, [orders, timeline, customDateFrom, customDateTo, clientsSearch, clientsPage, clientsSortBy, clientsStoreFilter]);

    // ═══════════════════════════════════════════════════════════
    // NEW: B2B STATS
    // ═══════════════════════════════════════════════════════════
    const b2bStats = useMemo(() => {
        const b2bOrders = orders.filter(o => {
            return getOrderChannel(o) === "B2B";
        });

        const dateRange = getDateRange(timeline);
        const currentB2b = b2bOrders.filter(o => {
            const d = new Date(o.created_at);
            return d >= dateRange.start && d <= dateRange.end;
        });

        const clientSales = {};
        currentB2b.forEach(o => {
            const client = o.delivery_name || o.vendor_name || "Unknown";
            if (!clientSales[client]) clientSales[client] = { name: client, sales: 0, orders: 0, advance: 0, balance: 0 };
            clientSales[client].sales += Number(o.grand_total || 0);
            clientSales[client].orders += 1;
            clientSales[client].advance += Number(o.advance_payment || 0);
            clientSales[client].balance += Math.max(0, Number(o.grand_total || 0) - Number(o.advance_payment || 0));
        });

        const allClientSales = Object.values(clientSales).sort((a, b) => b.sales - a.sales);
        const totalB2bRevenue = currentB2b.reduce((s, o) => s + Number(o.grand_total || 0), 0);
        const totalB2bAdvance = currentB2b.reduce((s, o) => s + Number(o.advance_payment || 0), 0);

        // Search
        let filteredB2b = allClientSales;
        if (b2bSearch.trim()) {
            const q = b2bSearch.toLowerCase();
            filteredB2b = filteredB2b.filter(c => c.name.toLowerCase().includes(q));
        }

        const b2bTotalPages = Math.ceil(filteredB2b.length / ITEMS_PER_PAGE);
        const currentB2bClients = filteredB2b.slice((b2bPage - 1) * ITEMS_PER_PAGE, b2bPage * ITEMS_PER_PAGE);

        return {
            totalB2bRevenue, totalB2bOrders: currentB2b.length, totalB2bAdvance,
            totalB2bBalance: totalB2bRevenue - totalB2bAdvance,
            currentB2bClients, b2bTotalPages, allClientSales,
            advancePending: allClientSales.filter(c => c.balance > 0).sort((a, b) => b.balance - a.balance),
        };
    }, [orders, timeline, customDateFrom, customDateTo, b2bSearch, b2bPage]);

    // ═══════════════════════════════════════════════════════════
    // NEW: ENHANCED INVENTORY (Delayed deliveries)
    // ═══════════════════════════════════════════════════════════
    const enhancedInventoryStats = useMemo(() => {
        const now = new Date();
        const activeOrders = orders.filter(o =>
            !isLxrtsOrder(o) &&
            o.status !== "delivered" && o.status !== "completed" && o.status !== "cancelled"
        );
        const delayedDeliveries = activeOrders.filter(o => {
            if (!o.delivery_date) return false;
            return new Date(o.delivery_date) < now;
        });

        // Store-wise product count
        const storeProducts = {};
        products.forEach(p => {
            const store = p.store || "All Stores";
            if (!storeProducts[store]) storeProducts[store] = { name: store, count: 0, totalInventory: 0 };
            storeProducts[store].count += 1;
            storeProducts[store].totalInventory += Number(p.inventory || 0);
        });

        return {
            delayedCount: delayedDeliveries.length,
            delayedOrders: delayedDeliveries.slice(0, 20),
            storeProducts: Object.values(storeProducts).sort((a, b) => b.totalInventory - a.totalInventory),
        };
    }, [orders, products]);

    // ═══════════════════════════════════════════════════════════
    // NEW: FINANCIAL STATS (Discounts by channel, salesperson)
    // ═══════════════════════════════════════════════════════════
    const financialStats = useMemo(() => {
        const dateRange = getDateRange(timeline);
        const validOrders = orders.filter(o => {
            const d = new Date(o.created_at);
            return d >= dateRange.start && d <= dateRange.end;
        });

        const totalDiscount = validOrders.reduce((s, o) => s + Number(o.discount_amount || 0), 0);
        const totalRevenue = validOrders.reduce((s, o) => s + Number(o.grand_total || 0), 0);
        const grossRevenue = totalRevenue + totalDiscount;
        const discountPercent = grossRevenue > 0 ? ((totalDiscount / grossRevenue) * 100).toFixed(1) : 0;

        // By channel
        const channelDiscounts = {};
        validOrders.forEach(o => {
            const ch = getOrderChannel(o);
            if (!channelDiscounts[ch]) channelDiscounts[ch] = { name: ch, discount: 0, revenue: 0 };
            channelDiscounts[ch].discount += Number(o.discount_amount || 0);
            channelDiscounts[ch].revenue += Number(o.grand_total || 0);
        });

        return {
            totalDiscount, discountPercent,
            channelDiscounts: Object.values(channelDiscounts).sort((a, b) => b.discount - a.discount),
        };
    }, [orders, timeline, customDateFrom, customDateTo]);

    // ═══════════════════════════════════════════════════════════
    // NEW: TARGETS PLACEHOLDER DATA
    // ═══════════════════════════════════════════════════════════
    const targetsData = useMemo(() => {
        // Placeholder: monthly targets will come from a targets table later
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const currentMonth = new Date().getMonth();

        // Calculate actual monthly revenue from orders
        const monthlyRevenue = {};
        const currentYear = new Date().getFullYear();
        orders.filter(o => new Date(o.created_at).getFullYear() === currentYear).forEach(o => {
            const m = new Date(o.created_at).getMonth();
            if (!monthlyRevenue[m]) monthlyRevenue[m] = 0;
            monthlyRevenue[m] += Number(o.grand_total || 0);
        });

        const monthlyData = months.map((m, i) => ({
            month: m,
            target: 0, // Placeholder — will be set from targets table
            achieved: monthlyRevenue[i] || 0,
            isFuture: i > currentMonth,
        }));

        // Store-wise growth (compare current period to previous)
        const dateRange = getDateRange(timeline);
        const prevRange = {
            start: new Date(dateRange.start.getTime() - (dateRange.end - dateRange.start)),
            end: new Date(dateRange.start.getTime() - 1),
        };
        const storeGrowth = {};
        orders.forEach(o => {
            const store = getOrderChannel(o);
            const d = new Date(o.created_at);
            if (!storeGrowth[store]) storeGrowth[store] = { name: store, current: 0, previous: 0 };
            if (d >= dateRange.start && d <= dateRange.end) storeGrowth[store].current += Number(o.grand_total || 0);
            else if (d >= prevRange.start && d <= prevRange.end) storeGrowth[store].previous += Number(o.grand_total || 0);
        });
        const storeGrowthList = Object.values(storeGrowth).map(s => ({
            ...s,
            growth: s.previous > 0 ? (((s.current - s.previous) / s.previous) * 100).toFixed(1) : (s.current > 0 ? 100 : 0),
        })).sort((a, b) => Number(b.growth) - Number(a.growth));

        return { monthlyData, storeGrowthList };
    }, [orders, timeline, customDateFrom, customDateTo]);

    const handleGeneratePdf = async (order, type = "customer") => {
        setPdfLoading(order.id);
        try {
            if (type === "warehouse") await downloadWarehousePdf(order, null, true);
            else await downloadCustomerPdf(order);
        } catch (error) { console.error("PDF generation failed:", error); }
        finally { setPdfLoading(null); }
    };

    // Reset pages
    useEffect(() => { setInventoryPage(1); }, [inventorySearch, inventoryStockFilter, inventoryTypeFilter]);
    useEffect(() => { setOrdersPage(1); }, [orderSearch, statusTab, filters, sortBy]);
    useEffect(() => { setAccountsPage(1); }, [accountsSearch, accountsDateFrom, accountsDateTo, accountsStatus, accountsStore, accountsSA]);
    useEffect(() => { setClientsPage(1); }, [clientsSearch, clientsSortBy, clientsStoreFilter]);
    useEffect(() => { setB2bPage(1); }, [b2bSearch]);

    useEffect(() => {
        if (activeTab === "inventory" || activeTab === "brand_performance") {
            const lxrtsProducts = products.filter((p) => p.sync_enabled);
            if (lxrtsProducts.length > 0 && Object.keys(variantInventory).length === 0) fetchAllLxrtsInventory(lxrtsProducts);
        }
    }, [activeTab, products]);

    const handleTimelineChange = (value) => {
        setTimeline(value);
        setShowCustomDatePicker(value === "custom");
    };

    if (loading) {
        return (
            <div className="admin-page">
                <div className="admin-loading">
                    <div className="admin-spinner"></div>
                    <p>Loading Admin Dashboard...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="admin-page">
            {PopupComponent}

            {/* HEADER */}
            <header className="admin-header">
                <div className="admin-header-left">
                    <button className="admin-hamburger" onClick={() => setShowSidebar(!showSidebar)}>
                        <span></span><span></span><span></span>
                    </button>
                    <img src={Logo} alt="Logo" className="admin-logo" onClick={() => navigate("/login")} />
                </div>
                <h1 className="admin-title">Admin Dashboard</h1>
                <div className="admin-header-right">
                    <NotificationBell
                        userEmail={currentUserEmail}
                        onOrderClick={(orderId) => {
                            // Could filter or highlight order in future
                        }}
                    />
                    <button className="admin-logout-btn" onClick={handleLogout}>Logout</button>
                </div>
            </header>

            <div className="admin-layout">
                {/* SIDEBAR */}
                <aside className={`admin-sidebar ${showSidebar ? "open" : ""}`}>
                    <nav className="admin-nav">
                        <span className="nav-section-label">Dashboard</span>
                        <button className={`admin-nav-item ${activeTab === "brand_performance" ? "active" : ""}`} onClick={() => { setActiveTab("brand_performance"); setShowSidebar(false); }}>Brand Performance</button>
                        <button className={`admin-nav-item ${activeTab === "revenue" ? "active" : ""}`} onClick={() => { setActiveTab("revenue"); setShowSidebar(false); }}>Revenue & Drivers</button>
                        <button className={`admin-nav-item ${activeTab === "products_style" ? "active" : ""}`} onClick={() => { setActiveTab("products_style"); setShowSidebar(false); }}>Products & Style</button>
                        <button className={`admin-nav-item ${activeTab === "client_insights" ? "active" : ""}`} onClick={() => { setActiveTab("client_insights"); setShowSidebar(false); }}>Client Insights</button>
                        <button className={`admin-nav-item ${activeTab === "inventory" ? "active" : ""}`} onClick={() => { setActiveTab("inventory"); setShowSidebar(false); }}>Inventory Overview</button>
                        <button className={`admin-nav-item ${activeTab === "cost_expenditure" ? "active" : ""}`} onClick={() => { setActiveTab("cost_expenditure"); setShowSidebar(false); }}>Cost & Expenditure</button>
                        <button className={`admin-nav-item ${activeTab === "b2b_vendor" ? "active" : ""}`} onClick={() => { setActiveTab("b2b_vendor"); setShowSidebar(false); }}>B2B & Vendor</button>
                        <button className={`admin-nav-item ${activeTab === "targets_growth" ? "active" : ""}`} onClick={() => { setActiveTab("targets_growth"); setShowSidebar(false); }}>Targets & Growth</button>
                        <span className="nav-section-label" style={{ marginTop: '12px' }}>Operations</span>
                        <button className={`admin-nav-item ${activeTab === "orders" ? "active" : ""}`} onClick={() => { setActiveTab("orders"); setShowSidebar(false); }}>Orders</button>
                        <button className={`admin-nav-item ${activeTab === "accounts" ? "active" : ""}`} onClick={() => { setActiveTab("accounts"); setShowSidebar(false); }}>Accounts</button>
                        {/* <button className="admin-nav-item logout" onClick={handleLogout}>Logout</button> */}
                    </nav>
                </aside>

                {/* MAIN CONTENT */}
                <main className="admin-content">

                    {/* ═══════════════════════════════════════════════════════════ */}
                    {/* TAB 1: OVERALL BRAND PERFORMANCE */}
                    {/* ═══════════════════════════════════════════════════════════ */}
                    {activeTab === "brand_performance" && (
                        <div className="admin-dashboard-tab">
                            {/* Clean filter bar */}
                            <div className="cmo-tab-header">
                                <h2 className="admin-section-title">Overall Brand Performance</h2>
                                <div className="cmo-filters-row">
                                    <div className="cmo-timeline-pills">
                                        {TIMELINE_OPTIONS.map(opt => (
                                            <button key={opt.value} className={`cmo-pill ${timeline === opt.value ? "active" : ""}`}
                                                onClick={() => { setTimeline(opt.value); setShowCustomDatePicker(opt.value === "custom"); }}>
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="cmo-filters-right">
                                        {showCustomDatePicker && (
                                            <div className="cmo-date-range">
                                                <input type="date" value={customDateFrom} onChange={(e) => setCustomDateFrom(e.target.value)} />
                                                <span className="cmo-date-sep">→</span>
                                                <input type="date" value={customDateTo} onChange={(e) => setCustomDateTo(e.target.value)} />
                                            </div>
                                        )}
                                        <select className="cmo-compare-select" value={comparison} onChange={(e) => setComparison(e.target.value)}>
                                            {COMPARISON_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* 1. Cumulative Sales (website + stores + B2B + exhibitions) */}
                            <h3 className="admin-subsection-title">Cumulative Sales</h3>
                            <div className="admin-stats-grid overview-grid">
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Total Revenue</span>
                                    <span className="stat-value">₹{formatIndianNumber(dashboardStats.totalRevenue)}</span>
                                    {dashboardStats.showComparison && <GrowthIndicator value={dashboardStats.revenueGrowth} />}
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Total Orders</span>
                                    <span className="stat-value">{formatIndianNumber(dashboardStats.totalOrders)}</span>
                                    {dashboardStats.showComparison && <GrowthIndicator value={dashboardStats.ordersGrowth} />}
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Items Sold</span>
                                    <span className="stat-value">{formatIndianNumber(enhancedDashboardStats.totalItems)}</span>
                                </div>
                            </div>

                            {/* Channel breakdown */}
                            <div className="analytics-charts-grid" style={{ marginBottom: 20 }}>
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Sales by Channel</h3>
                                    {enhancedDashboardStats.channelBreakdown.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={300}>
                                            <PieChart>
                                                <Pie data={enhancedDashboardStats.channelBreakdown} cx="50%" cy="45%" innerRadius={55} outerRadius={95} dataKey="revenue"
                                                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`} labelLine={true}>
                                                    {enhancedDashboardStats.channelBreakdown.map((_, i) => (
                                                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                                    ))}
                                                </Pie>
                                                <Tooltip content={<ChartTooltip />} />
                                                <Legend verticalAlign="bottom" height={36} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    ) : <div className="no-chart-data">No data available</div>}
                                </div>
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Channel Revenue Breakdown</h3>
                                    {enhancedDashboardStats.revenueMix.length > 0 ? (
                                        <div className="revenue-mix-list">
                                            {enhancedDashboardStats.revenueMix.map((ch, i) => (
                                                <div key={i} className="revenue-mix-row">
                                                    <div className="revenue-mix-info">
                                                        <span className="revenue-mix-dot" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}></span>
                                                        <span className="revenue-mix-name">{ch.name}</span>
                                                    </div>
                                                    <div className="revenue-mix-bar-wrap">
                                                        <div className="revenue-mix-bar" style={{ width: `${ch.percent}%`, background: PIE_COLORS[i % PIE_COLORS.length] }}></div>
                                                    </div>
                                                    <span className="revenue-mix-val">{ch.percent}%</span>
                                                    <span className="revenue-mix-amt">₹{formatIndianNumber(Math.round(ch.revenue))}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : <div className="no-chart-data">No data available</div>}
                                </div>
                            </div>

                            {/* 2. Cumulative Refund */}
                            <h3 className="admin-subsection-title">Cumulative Refund</h3>
                            <div className="admin-stats-grid overview-grid">
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Refund Value</span>
                                    <span className="stat-value">₹0</span>
                                    <PlaceholderBadge label="Refund data pending" />
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Refund Quantity</span>
                                    <span className="stat-value">0</span>
                                    <PlaceholderBadge label="Refund data pending" />
                                </div>
                            </div>

                            {/* 3. Top-performing Products */}
                            <div className="analytics-chart-card" style={{ marginBottom: 20 }}>
                                <h3 className="chart-title">Top-Performing Products (Descending)</h3>
                                {analyticsData.topProducts.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={400}>
                                        <BarChart data={analyticsData.topProducts} layout="vertical" margin={{ top: 5, right: 40, left: 5, bottom: 5 }}>
                                            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#eee" />
                                            <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} />
                                            <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: '#444' }}
                                                tickFormatter={(v) => v.length > 20 ? v.substring(0, 20) + '…' : v} axisLine={false} tickLine={false} />
                                            <Tooltip content={({ active, payload, label }) => {
                                                if (!active || !payload?.length) return null;
                                                const item = analyticsData.topProducts.find(p => p.name === label);
                                                return (
                                                    <div className="cmo-chart-tooltip">
                                                        <p className="cmo-chart-tooltip-label">{label}</p>
                                                        <p className="cmo-chart-tooltip-row">Sales: ₹{formatIndianNumber(payload[0].value)}</p>
                                                        <p className="cmo-chart-tooltip-row">Qty sold: {item?.count || 0}</p>
                                                    </div>
                                                );
                                            }} />
                                            <Bar dataKey="sales" radius={[0, 6, 6, 0]} barSize={20}>
                                                {analyticsData.topProducts.map((_, i) => (
                                                    <Cell key={i} fill={`rgba(213, 184, 90, ${1 - i * 0.07})`} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : <div className="no-chart-data">No data available</div>}
                            </div>

                            {/* 4. Top & Bottom Colours — bars use ACTUAL colour */}
                            <div className="analytics-charts-grid">
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Top Performing Colours</h3>
                                    {analyticsData.topColors.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={380}>
                                            <BarChart data={analyticsData.topColors} margin={{ top: 10, right: 20, left: 10, bottom: 80 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                                                <XAxis dataKey="name" interval={0} tick={<WrappedAxisTick />} axisLine={false} tickLine={false} height={50} />
                                                <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                                                <Tooltip content={({ active, payload, label }) => {
                                                    if (!active || !payload?.length) return null;
                                                    const item = analyticsData.topColors.find(c => c.name === label);
                                                    return (
                                                        <div className="cmo-chart-tooltip">
                                                            <p className="cmo-chart-tooltip-label">
                                                                <span className="cmo-chart-tooltip-dot" style={{ background: getColorHex(label) }}></span>
                                                                {label}
                                                            </p>
                                                            <p className="cmo-chart-tooltip-row">Sales: ₹{formatIndianNumber(payload[0].value)}</p>
                                                            <p className="cmo-chart-tooltip-row">Orders: {item?.count || 0}</p>
                                                        </div>
                                                    );
                                                }} />
                                                <Bar dataKey="sales" radius={[6, 6, 0, 0]} barSize={32}>
                                                    {analyticsData.topColors.map((entry, i) => (
                                                        <Cell key={i} fill={getColorHex(entry.name)} stroke="rgba(0,0,0,0.08)" strokeWidth={1} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : <div className="no-chart-data">No data available</div>}
                                </div>
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Bottom Performing Colours</h3>
                                    {enhancedAnalytics.bottomColors.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={380}>
                                            <BarChart data={enhancedAnalytics.bottomColors} margin={{ top: 10, right: 20, left: 10, bottom: 80 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                                                <XAxis dataKey="name" interval={0} tick={<WrappedAxisTick />} axisLine={false} tickLine={false} height={50} />
                                                <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                                                <Tooltip content={({ active, payload, label }) => {
                                                    if (!active || !payload?.length) return null;
                                                    return (
                                                        <div className="cmo-chart-tooltip">
                                                            <p className="cmo-chart-tooltip-label">
                                                                <span className="cmo-chart-tooltip-dot" style={{ background: getColorHex(label) }}></span>
                                                                {label}
                                                            </p>
                                                            <p className="cmo-chart-tooltip-row">Sales: ₹{formatIndianNumber(payload[0].value)}</p>
                                                        </div>
                                                    );
                                                }} />
                                                <Bar dataKey="sales" radius={[6, 6, 0, 0]} barSize={32}>
                                                    {enhancedAnalytics.bottomColors.map((entry, i) => (
                                                        <Cell key={i} fill={getColorHex(entry.name)} stroke="rgba(0,0,0,0.08)" strokeWidth={1} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : <div className="no-chart-data">No data available</div>}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ═══════════════════════════════════════════════════════════ */}
                    {/* TAB 2: REVENUE & BUSINESS DRIVERS */}
                    {/* ═══════════════════════════════════════════════════════════ */}
                    {activeTab === "revenue" && (
                        <div className="admin-dashboard-tab">
                            <div className="cmo-tab-header">
                                <h2 className="admin-section-title">Revenue & Business Drivers</h2>
                                <div className="cmo-filters-row">
                                    <div className="cmo-timeline-pills">
                                        {TIMELINE_OPTIONS.map(opt => (
                                            <button key={opt.value} className={`cmo-pill ${timeline === opt.value ? "active" : ""}`}
                                                onClick={() => { setTimeline(opt.value); setShowCustomDatePicker(opt.value === "custom"); }}>
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="cmo-filters-right">
                                        {showCustomDatePicker && (
                                            <div className="cmo-date-range">
                                                <input type="date" value={customDateFrom} onChange={(e) => setCustomDateFrom(e.target.value)} />
                                                <span className="cmo-date-sep">→</span>
                                                <input type="date" value={customDateTo} onChange={(e) => setCustomDateTo(e.target.value)} />
                                            </div>
                                        )}
                                        <select className="cmo-compare-select" value={comparison} onChange={(e) => setComparison(e.target.value)}>
                                            {COMPARISON_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* 1. Total Revenue (multi-channel) */}
                            <h3 className="admin-subsection-title">Total Revenue</h3>
                            <div className="admin-stats-grid overview-grid">
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Total Revenue</span>
                                    <span className="stat-value">₹{formatIndianNumber(dashboardStats.totalRevenue)}</span>
                                    {dashboardStats.showComparison && <GrowthIndicator value={dashboardStats.revenueGrowth} />}
                                </div>
                                {enhancedDashboardStats.channelBreakdown.map((ch, i) => (
                                    <div key={i} className="admin-stat-card overview-card">
                                        <span className="stat-label">{ch.name}</span>
                                        <span className="stat-value">₹{formatIndianNumber(Math.round(ch.revenue))}</span>
                                        <span className="stat-sub">{ch.orders} orders</span>
                                    </div>
                                ))}
                            </div>

                            {/* 2. Revenue Mix % */}
                            <div className="analytics-chart-card" style={{ marginBottom: 20 }}>
                                <h3 className="chart-title">Revenue Mix %</h3>
                                {enhancedDashboardStats.revenueMix.length > 0 ? (
                                    <div className="revenue-mix-list">
                                        {enhancedDashboardStats.revenueMix.map((ch, i) => (
                                            <div key={i} className="revenue-mix-row">
                                                <div className="revenue-mix-info">
                                                    <span className="revenue-mix-dot" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}></span>
                                                    <span className="revenue-mix-name">{ch.name}</span>
                                                </div>
                                                <div className="revenue-mix-bar-wrap">
                                                    <div className="revenue-mix-bar" style={{ width: `${ch.percent}%`, background: PIE_COLORS[i % PIE_COLORS.length] }}></div>
                                                </div>
                                                <span className="revenue-mix-val">{ch.percent}%</span>
                                                <span className="revenue-mix-amt">₹{formatIndianNumber(Math.round(ch.revenue))}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : <div className="no-chart-data">No data available</div>}
                            </div>

                            {/* 3. Order Value Trend */}
                            <div className="analytics-chart-card" style={{ marginBottom: 20 }}>
                                <h3 className="chart-title">Order Value Trend</h3>
                                {orderValueTrend.length > 1 ? (
                                    <ResponsiveContainer width="100%" height={300}>
                                        <AreaChart data={orderValueTrend} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                                            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                                            <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                                            <Tooltip formatter={(v, name) => [`₹${formatIndianNumber(v)}`, name === "revenue" ? "Revenue" : "AOV"]} />
                                            <Legend />
                                            <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#d5b85a" fill="rgba(213,184,90,0.15)" strokeWidth={2} />
                                            <Line type="monotone" dataKey="aov" name="AOV" stroke="#8B7355" strokeWidth={2} dot={false} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                ) : <div className="no-chart-data">Select a wider date range to see trends</div>}
                            </div>

                            {/* 4. Growth % Comparison */}
                            <h3 className="admin-subsection-title">Growth % Comparison</h3>
                            <div className="admin-stats-grid overview-grid">
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Revenue Growth</span>
                                    <span className="stat-value"><GrowthIndicator value={dashboardStats.revenueGrowth} /></span>
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Orders Growth</span>
                                    <span className="stat-value"><GrowthIndicator value={dashboardStats.ordersGrowth} /></span>
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Delivered Growth</span>
                                    <span className="stat-value"><GrowthIndicator value={dashboardStats.deliveredGrowth} /></span>
                                </div>
                            </div>

                            {/* 5. Average Order Value */}
                            <h3 className="admin-subsection-title">Average Order Value</h3>
                            <div className="admin-stats-grid overview-grid">
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">AOV</span>
                                    <span className="stat-value">₹{formatIndianNumber(enhancedDashboardStats.avgOrderValue.toFixed(0))}</span>
                                </div>
                            </div>

                            {/* 6. Customer Cohorts */}
                            <h3 className="admin-subsection-title">Customer Cohorts</h3>
                            <div className="analytics-charts-grid">
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Customer Segmentation</h3>
                                    {clientAnalytics.segmentation.some(s => s.value > 0) ? (
                                        <ResponsiveContainer width="100%" height={300}>
                                            <PieChart>
                                                <Pie data={clientAnalytics.segmentation.filter(s => s.value > 0)} cx="50%" cy="45%" innerRadius={55} outerRadius={95} dataKey="value"
                                                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`} labelLine={true}>
                                                    {clientAnalytics.segmentation.map((_, i) => (
                                                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                                    ))}
                                                </Pie>
                                                <Tooltip />
                                                <Legend verticalAlign="bottom" height={36} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    ) : <div className="no-chart-data">No data available</div>}
                                </div>
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Cohort Stats</h3>
                                    <div className="admin-stats-grid" style={{ gridTemplateColumns: '1fr' }}>
                                        <div className="admin-stat-card overview-card">
                                            <span className="stat-label">Repeat Customer Rate</span>
                                            <span className="stat-value">{clientAnalytics.repeatRate}%</span>
                                        </div>
                                        <div className="admin-stat-card overview-card">
                                            <span className="stat-label">New Clients (Period)</span>
                                            <span className="stat-value">{clientAnalytics.newClientsCount}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* 7. Gross Margin Trend (Placeholder) */}
                            <div className="analytics-chart-card" style={{ marginTop: 20 }}>
                                <h3 className="chart-title">Gross Margin Trend (Overall)</h3>
                                <div className="no-chart-data" style={{ flexDirection: 'column', gap: 8 }}>
                                    <PlaceholderBadge label="COGS data integration pending" />
                                    <span>Margin trend over time will appear here</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ═══════════════════════════════════════════════════════════ */}
                    {/* TAB 3: PRODUCT, STYLE & DESIGN PERFORMANCE */}
                    {/* ═══════════════════════════════════════════════════════════ */}
                    {activeTab === "products_style" && (
                        <div className="admin-analytics-tab">
                            <div className="cmo-tab-header">
                                <h2 className="admin-section-title">Product, Style & Design Performance</h2>
                                <div className="cmo-filters-row">
                                    <div className="cmo-timeline-pills">
                                        {TIMELINE_OPTIONS.map(opt => (
                                            <button key={opt.value} className={`cmo-pill ${analyticsTimeline === opt.value ? "active" : ""}`}
                                                onClick={() => handleAnalyticsTimelineChange(opt.value)}>
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="cmo-filters-right">
                                        {showAnalyticsCustomPicker && (
                                            <div className="cmo-date-range">
                                                <input type="date" value={analyticsCustomFrom} onChange={(e) => setAnalyticsCustomFrom(e.target.value)} />
                                                <span className="cmo-date-sep">→</span>
                                                <input type="date" value={analyticsCustomTo} onChange={(e) => setAnalyticsCustomTo(e.target.value)} />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="analytics-charts-grid">
                                {/* 1. Top Products (descending) */}
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Top-Performing Products</h3>
                                    {analyticsData.topProducts.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={400}>
                                            <BarChart data={analyticsData.topProducts} layout="vertical" margin={{ top: 5, right: 40, left: 5, bottom: 5 }}>
                                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#eee" />
                                                <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} />
                                                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: '#444' }}
                                                    tickFormatter={(v) => v.length > 20 ? v.substring(0, 20) + '…' : v} axisLine={false} tickLine={false} />
                                                <Tooltip content={({ active, payload, label }) => {
                                                    if (!active || !payload?.length) return null;
                                                    const item = analyticsData.topProducts.find(p => p.name === label);
                                                    return (
                                                        <div className="cmo-chart-tooltip">
                                                            <p className="cmo-chart-tooltip-label">{label}</p>
                                                            <p className="cmo-chart-tooltip-row">Sales: ₹{formatIndianNumber(payload[0].value)}</p>
                                                            <p className="cmo-chart-tooltip-row">Qty sold: {item?.count || 0}</p>
                                                        </div>
                                                    );
                                                }} />
                                                <Bar dataKey="sales" radius={[0, 6, 6, 0]} barSize={20}>
                                                    {analyticsData.topProducts.map((_, i) => (
                                                        <Cell key={i} fill={`rgba(213, 184, 90, ${1 - i * 0.07})`} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : <div className="no-chart-data">No data available</div>}
                                </div>

                                {/* 2. Bottom Products */}
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Bottom-Performing Products</h3>
                                    {enhancedAnalytics.bottomProducts.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={400}>
                                            <BarChart data={enhancedAnalytics.bottomProducts} layout="vertical" margin={{ top: 5, right: 40, left: 5, bottom: 5 }}>
                                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#eee" />
                                                <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} />
                                                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: '#444' }}
                                                    tickFormatter={(v) => v.length > 20 ? v.substring(0, 20) + '…' : v} axisLine={false} tickLine={false} />
                                                <Tooltip content={({ active, payload, label }) => {
                                                    if (!active || !payload?.length) return null;
                                                    return (
                                                        <div className="cmo-chart-tooltip">
                                                            <p className="cmo-chart-tooltip-label">{label}</p>
                                                            <p className="cmo-chart-tooltip-row">Sales: ₹{formatIndianNumber(payload[0].value)}</p>
                                                        </div>
                                                    );
                                                }} />
                                                <Bar dataKey="sales" radius={[0, 6, 6, 0]} barSize={20}>
                                                    {enhancedAnalytics.bottomProducts.map((_, i) => (
                                                        <Cell key={i} fill={`rgba(198, 40, 40, ${0.9 - i * 0.07})`} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : <div className="no-chart-data">No data available</div>}
                                </div>

                                {/* 3. Top Colours */}
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Top Performing Colours</h3>
                                    {analyticsData.topColors.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={380}>
                                            <BarChart data={analyticsData.topColors} margin={{ top: 10, right: 20, left: 10, bottom: 80 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                                                <XAxis dataKey="name" interval={0} tick={<WrappedAxisTick />} axisLine={false} tickLine={false} height={50} />
                                                <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                                                <Tooltip content={({ active, payload, label }) => {
                                                    if (!active || !payload?.length) return null;
                                                    return (
                                                        <div className="cmo-chart-tooltip">
                                                            <p className="cmo-chart-tooltip-label"><span className="cmo-chart-tooltip-dot" style={{ background: getColorHex(label) }}></span>{label}</p>
                                                            <p className="cmo-chart-tooltip-row">Sales: ₹{formatIndianNumber(payload[0].value)}</p>
                                                        </div>
                                                    );
                                                }} />
                                                <Bar dataKey="sales" radius={[6, 6, 0, 0]} barSize={32}>
                                                    {analyticsData.topColors.map((entry, i) => <Cell key={i} fill={getColorHex(entry.name)} stroke="rgba(0,0,0,0.08)" strokeWidth={1} />)}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : <div className="no-chart-data">No data available</div>}
                                </div>

                                {/* 3b. Bottom Colours */}
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Bottom Performing Colours</h3>
                                    {enhancedAnalytics.bottomColors.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={380}>
                                            <BarChart data={enhancedAnalytics.bottomColors} margin={{ top: 10, right: 20, left: 10, bottom: 80 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                                                <XAxis dataKey="name" interval={0} tick={<WrappedAxisTick />} axisLine={false} tickLine={false} height={50} />
                                                <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                                                <Tooltip content={({ active, payload, label }) => {
                                                    if (!active || !payload?.length) return null;
                                                    return (
                                                        <div className="cmo-chart-tooltip">
                                                            <p className="cmo-chart-tooltip-label"><span className="cmo-chart-tooltip-dot" style={{ background: getColorHex(label) }}></span>{label}</p>
                                                            <p className="cmo-chart-tooltip-row">Sales: ₹{formatIndianNumber(payload[0].value)}</p>
                                                        </div>
                                                    );
                                                }} />
                                                <Bar dataKey="sales" radius={[6, 6, 0, 0]} barSize={32}>
                                                    {enhancedAnalytics.bottomColors.map((entry, i) => <Cell key={i} fill={getColorHex(entry.name)} stroke="rgba(0,0,0,0.08)" strokeWidth={1} />)}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : <div className="no-chart-data">No data available</div>}
                                </div>

                                {/* 4. High & Repetitive Alterations */}
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">High Alterations by Outfit</h3>
                                    {analyticsData.alterationsByOutfit.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={350}>
                                            <BarChart data={analyticsData.alterationsByOutfit} layout="vertical" margin={{ top: 5, right: 40, left: 5, bottom: 5 }}>
                                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#eee" />
                                                <XAxis type="number" tick={{ fontSize: 11, fill: '#888' }} axisLine={false} />
                                                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: '#444' }}
                                                    tickFormatter={(v) => v.length > 20 ? v.substring(0, 20) + '…' : v} axisLine={false} tickLine={false} />
                                                <Tooltip content={({ active, payload, label }) => {
                                                    if (!active || !payload?.length) return null;
                                                    return (<div className="cmo-chart-tooltip"><p className="cmo-chart-tooltip-label">{label}</p><p className="cmo-chart-tooltip-row">Alterations: {payload[0].value}</p></div>);
                                                }} />
                                                <Bar dataKey="count" fill="#C9A94E" radius={[0, 6, 6, 0]} barSize={20} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : <div className="no-chart-data">No alteration data available</div>}
                                </div>

                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Alterations by Customers</h3>
                                    {analyticsData.alterationsByCustomer.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={350}>
                                            <BarChart data={analyticsData.alterationsByCustomer} layout="vertical" margin={{ top: 5, right: 40, left: 5, bottom: 5 }}>
                                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#eee" />
                                                <XAxis type="number" tick={{ fontSize: 11, fill: '#888' }} axisLine={false} />
                                                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: '#444' }}
                                                    tickFormatter={(v) => v.length > 18 ? v.substring(0, 18) + '…' : v} axisLine={false} tickLine={false} />
                                                <Tooltip content={({ active, payload, label }) => {
                                                    if (!active || !payload?.length) return null;
                                                    return (<div className="cmo-chart-tooltip"><p className="cmo-chart-tooltip-label">{label}</p><p className="cmo-chart-tooltip-row">Alterations: {payload[0].value}</p></div>);
                                                }} />
                                                <Bar dataKey="count" fill="#A67C52" radius={[0, 6, 6, 0]} barSize={20} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : <div className="no-chart-data">No alteration data available</div>}
                                </div>
                            </div>

                            {/* Flagged Repetitive Alterations */}
                            <div className="analytics-chart-card wide" style={{ marginTop: 20 }}>
                                <h3 className="chart-title">🚩 Flagged: Repetitive Alterations (3+ on same outfit)</h3>
                                <p className="chart-subtitle">Avg alterations per outfit: {enhancedAnalytics.avgAlterationsPerOutfit.toFixed(2)} | Total: {enhancedAnalytics.totalAlterations}</p>
                                {enhancedAnalytics.flaggedAlterations.length > 0 ? (
                                    <div className="admin-table-wrapper" style={{ maxHeight: 300, overflow: 'auto' }}>
                                        <table className="admin-table">
                                            <thead><tr><th>Outfit / Product</th><th>Alteration Count</th><th>Status</th></tr></thead>
                                            <tbody>
                                                {enhancedAnalytics.flaggedAlterations.map((a, i) => (
                                                    <tr key={i} className="urgent-row">
                                                        <td>{a.name}</td>
                                                        <td><span className="urgent-badge" style={{ fontSize: 11 }}>{a.count} alterations</span></td>
                                                        <td><span className="status-badge cancelled">Needs Review</span></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : <div className="no-chart-data">No repetitive alterations — all good!</div>}
                            </div>

                            {/* 5. Average Alterations per Outfit */}
                            <h3 className="admin-subsection-title" style={{ marginTop: 20 }}>Alteration Stats</h3>
                            <div className="admin-stats-grid overview-grid">
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Avg Alterations / Outfit</span>
                                    <span className="stat-value">{enhancedAnalytics.avgAlterationsPerOutfit.toFixed(2)}</span>
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Total Alterations</span>
                                    <span className="stat-value">{enhancedAnalytics.totalAlterations}</span>
                                </div>
                            </div>

                            {/* 6. High Return Styles (Placeholder) */}
                            <div className="analytics-chart-card" style={{ marginTop: 20 }}>
                                <h3 className="chart-title">High Return Styles (%)</h3>
                                <div className="no-chart-data" style={{ flexDirection: 'column', gap: 8 }}>
                                    <PlaceholderBadge label="Returns data pending" />
                                    <span>Return tracking by style will be displayed here</span>
                                </div>
                            </div>

                            {/* 7. Customisation Trends (Placeholder) */}
                            <h3 className="admin-subsection-title" style={{ marginTop: 20 }}>Customisation Trends</h3>
                            <div className="admin-stats-grid overview-grid">
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Length-related</span>
                                    <span className="stat-value">—</span>
                                    <PlaceholderBadge label="Measurement aggregation pending" />
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Fit & Structure</span>
                                    <span className="stat-value">—</span>
                                    <PlaceholderBadge label="Measurement aggregation pending" />
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Silhouette-wise</span>
                                    <span className="stat-value">—</span>
                                    <PlaceholderBadge label="Measurement aggregation pending" />
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Colour-driven</span>
                                    <span className="stat-value">—</span>
                                    <PlaceholderBadge label="Measurement aggregation pending" />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ═══════════════════════════════════════════════════════════ */}
                    {/* TAB 4: CLIENT INSIGHTS */}
                    {/* ═══════════════════════════════════════════════════════════ */}
                    {activeTab === "client_insights" && (
                        <div className="admin-clients-tab">
                            <h2 className="admin-section-title">Client Insights</h2>

                            {/* Stats Row */}
                            <div className="admin-stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Total Clients</span>
                                    <span className="stat-value">{formatIndianNumber(clientAnalytics.totalClients)}</span>
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">New Clients (Period)</span>
                                    <span className="stat-value">{clientAnalytics.newClientsCount}</span>
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Repeat Customer Rate</span>
                                    <span className="stat-value">{clientAnalytics.repeatRate}%</span>
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Total SB Clients</span>
                                    <span className="stat-value">—</span>
                                    <PlaceholderBadge label="SB client book pending" />
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Avg Age of Clients</span>
                                    <span className="stat-value">—</span>
                                    <PlaceholderBadge label="DOB data pending" />
                                </div>
                            </div>

                            {/* Segmentation + Store breakdown */}
                            <div className="analytics-charts-grid" style={{ marginBottom: 20 }}>
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Client Segmentation Growth</h3>
                                    {clientAnalytics.segmentation.some(s => s.value > 0) ? (
                                        <ResponsiveContainer width="100%" height={300}>
                                            <PieChart>
                                                <Pie data={clientAnalytics.segmentation.filter(s => s.value > 0)} cx="50%" cy="45%" innerRadius={55} outerRadius={95} dataKey="value"
                                                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`} labelLine={true}>
                                                    {clientAnalytics.segmentation.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                                                </Pie>
                                                <Tooltip />
                                                <Legend verticalAlign="bottom" height={36} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    ) : <div className="no-chart-data">No data available</div>}
                                </div>
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Clients by Store</h3>
                                    {clientAnalytics.storeClients.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={300}>
                                            <BarChart data={clientAnalytics.storeClients} margin={{ top: 10, right: 30, left: 10, bottom: 50 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                                                <XAxis dataKey="name" tick={<WrappedAxisTick />} interval={0} axisLine={false} tickLine={false} height={50} />
                                                <YAxis />
                                                <Tooltip />
                                                <Bar dataKey="count" name="Clients" fill="#d5b85a" radius={[4, 4, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : <div className="no-chart-data">No data available</div>}
                                </div>
                            </div>

                            {/* 1. Top Clients per Store */}
                            <h3 className="admin-subsection-title">Top Clients per Store</h3>
                            <div className="admin-toolbar" style={{ flexWrap: 'wrap', gap: 10 }}>
                                <div className="admin-search-wrapper">
                                    <span className="search-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg></span>
                                    <input type="text" placeholder="Search name, phone, city..." value={clientsSearch} onChange={(e) => setClientsSearch(e.target.value)} className="admin-search-input" />
                                    {clientsSearch && <button className="search-clear" onClick={() => setClientsSearch("")}>×</button>}
                                </div>
                                <div className="cmo-filters-right" style={{ gap: 8 }}>
                                    <select value={clientsStoreFilter} onChange={(e) => setClientsStoreFilter(e.target.value)} className="cmo-compare-select">
                                        <option value="">All Stores</option>
                                        {clientAnalytics.storeList.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                    <select value={clientsSortBy} onChange={(e) => setClientsSortBy(e.target.value)} className="cmo-compare-select">
                                        <option value="totalSpend">Highest Spend</option>
                                        <option value="orderCount">Most Orders</option>
                                        <option value="recent">Most Recent</option>
                                    </select>
                                </div>
                            </div>
                            <div className="admin-table-wrapper">
                                <div className="admin-table-container" style={{ minWidth: 1000 }}>
                                    <table className="admin-table">
                                        <thead>
                                            <tr><th>#</th><th>Name</th><th>Phone</th><th>City</th><th>Stores</th><th>Birthday</th><th>Orders</th><th>Items</th><th className="amount">12M Spend</th><th className="amount">Lifetime Spend</th><th>Last Order</th></tr>
                                        </thead>
                                        <tbody>
                                            {clientAnalytics.currentClients.length === 0 ?
                                                <tr><td colSpan="11" className="no-data">No clients found</td></tr> :
                                                clientAnalytics.currentClients.map((c, idx) => (
                                                    <tr key={c.phone}>
                                                        <td>{(clientsPage - 1) * ITEMS_PER_PAGE + idx + 1}</td>
                                                        <td style={{ fontWeight: 500 }}>{c.name}</td>
                                                        <td>{c.phone}</td>
                                                        <td>{c.city}</td>
                                                        <td>{c.stores || "-"}</td>
                                                        <td><PlaceholderBadge label="DOB" /></td>
                                                        <td>{c.orderCount}</td>
                                                        <td>{c.items}</td>
                                                        <td className="amount">₹{formatIndianNumber(c.spend12M.toFixed(0))}</td>
                                                        <td className="amount">₹{formatIndianNumber(c.totalSpend.toFixed(0))}</td>
                                                        <td>{formatDate(c.lastOrder)}</td>
                                                    </tr>
                                                ))
                                            }
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            {clientAnalytics.clientsTotalPages > 1 && (
                                <div className="admin-pagination">
                                    <button onClick={() => setClientsPage(p => Math.max(1, p - 1))} disabled={clientsPage === 1}>Prev</button>
                                    <span>Page {clientsPage} of {clientAnalytics.clientsTotalPages}</span>
                                    <button onClick={() => setClientsPage(p => Math.min(clientAnalytics.clientsTotalPages, p + 1))} disabled={clientsPage === clientAnalytics.clientsTotalPages}>Next</button>
                                </div>
                            )}

                            {/* 2-3. Client Purchase History + SB Client Book */}
                            <div className="analytics-charts-grid" style={{ marginTop: 20 }}>
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Client Purchase History (12M + Lifetime)</h3>
                                    <div className="no-chart-data" style={{ flexDirection: 'column', gap: 8 }}>
                                        <PlaceholderBadge label="12-month rolling view pending" />
                                        <span>Monthly purchase trend per client will appear here</span>
                                    </div>
                                </div>
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">SB Client Book</h3>
                                    <div className="no-chart-data" style={{ flexDirection: 'column', gap: 8 }}>
                                        <PlaceholderBadge label="SB client book data pending" />
                                        <span>Store-based client assignments will appear here</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ═══════════════════════════════════════════════════════════ */}
                    {/* TAB 5: INVENTORY OVERVIEW */}
                    {/* ═══════════════════════════════════════════════════════════ */}
                    {activeTab === "inventory" && (
                        <div className="admin-inventory-tab">
                            <h2 className="admin-section-title">Inventory Overview</h2>
                            <div className="admin-stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                                <div className="admin-stat-card danger"><div className="stat-info"><span className="stat-label">Delayed Deliveries</span><span className="stat-value">{enhancedInventoryStats.delayedCount}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Active LXRTS Products</span><span className="stat-value">{products.filter(p => p.sync_enabled).length}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Total Products</span><span className="stat-value">{inventoryStats.total}</span></div></div>
                                {/* <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Total Stock</span><span className="stat-value">{formatIndianNumber(inventoryStats.totalInventory)}</span></div></div> */}
                                <div className="admin-stat-card warning"><div className="stat-info"><span className="stat-label">Low Stock (&lt;5)</span><span className="stat-value">{inventoryStats.lowStock}</span></div></div>
                                <div className="admin-stat-card danger"><div className="stat-info"><span className="stat-label">Out of Stock</span><span className="stat-value">{inventoryStats.outOfStock}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Consignment Inventory</span><span className="stat-value">—</span><PlaceholderBadge label="Consignment data pending" /></div></div>
                            </div>

                            {/* Delayed Deliveries Table */}
                            {enhancedInventoryStats.delayedCount > 0 && (
                                <div style={{ marginBottom: 20 }}>
                                    <h3 className="admin-subsection-title">⚠️ Delayed Deliveries ({enhancedInventoryStats.delayedCount})</h3>
                                    <div className="admin-table-wrapper"><div className="admin-table-container">
                                        <table className="admin-table">
                                            <thead><tr><th>Order ID</th><th>Customer</th><th>Product</th><th>Promise Date</th><th>Days Late</th><th>Status</th></tr></thead>
                                            <tbody>
                                                {enhancedInventoryStats.delayedOrders.map(o => {
                                                    const daysLate = Math.floor((new Date() - new Date(o.delivery_date)) / (1000 * 60 * 60 * 24));
                                                    return (
                                                        <tr key={o.id} className="urgent-row">
                                                            <td><span className="order-id">{o.order_no || "-"}</span></td>
                                                            <td>{o.delivery_name || "-"}</td>
                                                            <td className="product-cell">{o.items?.[0]?.product_name || "-"}</td>
                                                            <td>{formatDate(o.delivery_date)}</td>
                                                            <td><span className="urgent-badge">{daysLate} days</span></td>
                                                            <td><span className={`status-badge ${o.status}`}>{o.status}</span></td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div></div>
                                </div>
                            )}

                            {/* 3. Inventory by Store */}
                            <h3 className="admin-subsection-title">Inventory Quantity & Value by Store</h3>
                            {enhancedInventoryStats.storeProducts.length > 0 ? (
                                <div className="admin-table-wrapper" style={{ marginBottom: 20 }}><div className="admin-table-container">
                                    <table className="admin-table">
                                        <thead><tr><th>Store</th><th>Products</th><th>Total Inventory</th></tr></thead>
                                        <tbody>
                                            {enhancedInventoryStats.storeProducts.map((s, i) => (
                                                <tr key={i}><td style={{ fontWeight: 500 }}>{s.name}</td><td>{s.count}</td><td>{formatIndianNumber(s.totalInventory)}</td></tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div></div>
                            ) : null}

                            {/* Product Inventory Table (existing) */}
                            <h3 className="admin-subsection-title">Product Inventory Management</h3>
                            <div className="admin-toolbar" style={{ flexWrap: 'wrap', gap: 10 }}>
                                <div className="admin-search-wrapper">
                                    <span className="search-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg></span>
                                    <input type="text" placeholder="Search by name or SKU..." value={inventorySearch} onChange={(e) => setInventorySearch(e.target.value)} className="admin-search-input" />
                                    {inventorySearch && <button className="search-clear" onClick={() => setInventorySearch("")}>×</button>}
                                </div>
                                <div className="cmo-filters-right" style={{ gap: 8 }}>
                                    <select className="cmo-compare-select" value={inventoryStockFilter} onChange={(e) => setInventoryStockFilter(e.target.value)}>
                                        <option value="all">All Stock</option>
                                        <option value="in_stock">In Stock (5+)</option>
                                        <option value="low_stock">Low Stock (&lt;5)</option>
                                        <option value="out_of_stock">Out of Stock</option>
                                    </select>
                                    <select className="cmo-compare-select" value={inventoryTypeFilter} onChange={(e) => setInventoryTypeFilter(e.target.value)}>
                                        <option value="all">All Types</option>
                                        <option value="lxrts">LXRTS Only</option>
                                        <option value="regular">Regular Only</option>
                                    </select>
                                    <span className="showing-info">Showing {currentProducts.length} of {filteredProducts.length}</span>
                                </div>
                            </div>
                            <div className="admin-table-wrapper"><div className="admin-table-container">
                                <table className="admin-table">
                                    <thead><tr><th>SKU</th><th>Product Name</th><th>Default Top</th><th>Default Bottom</th><th>Default Top-Bottom</th><th>Base Price</th><th>Inventory</th></tr></thead>
                                    <tbody>
                                        {currentProducts.map(product => (
                                            <React.Fragment key={product.id}>
                                                <tr className={isLxrtsProduct(product) ? "lxrts-row" : ""}>
                                                    <td><span className="order-id">{product.sku_id || "-"}</span></td>
                                                    <td className="product-cell">
                                                        {isLxrtsProduct(product) && <span className="lxrts-badge">LXRTS</span>}
                                                        {product.name}
                                                        {isLxrtsProduct(product) && (
                                                            <button className="expand-btn" onClick={() => handleExpandProduct(product)}>
                                                                {expandedProduct === product.id ? "▲" : "▼"}
                                                            </button>
                                                        )}
                                                    </td>
                                                    <td>{product.default_top || "-"}</td>
                                                    <td>{product.default_bottom || "-"}</td>
                                                    <td>{product.default_color || "-"}</td>
                                                    <td>₹{formatIndianNumber(product.base_price || 0)}</td>
                                                    <td>
                                                        {isLxrtsProduct(product) ? (
                                                            <span className={getInventoryClass(getLxrtsTotalInventory(product.id))}>
                                                                {lxrtsSyncLoading ? "..." : getLxrtsTotalInventory(product.id)}
                                                            </span>
                                                        ) : editingProductId === product.id ? (
                                                            <div className="inline-edit">
                                                                <input type="number" value={editInventoryValue} onChange={(e) => setEditInventoryValue(e.target.value)}
                                                                    onKeyDown={(e) => { if (e.key === "Enter") handleInventoryUpdate(product.id); if (e.key === "Escape") setEditingProductId(null); }}
                                                                    autoFocus className="inline-edit-input" />
                                                                <button onClick={() => handleInventoryUpdate(product.id)} disabled={savingInventory} className="inline-save-btn">
                                                                    {savingInventory ? "..." : "✓"}
                                                                </button>
                                                                <button onClick={() => setEditingProductId(null)} className="inline-cancel-btn">✗</button>
                                                            </div>
                                                        ) : (
                                                            <span className={`editable-inventory ${getInventoryClass(product.inventory || 0)}`}
                                                                onClick={() => { setEditingProductId(product.id); setEditInventoryValue(String(product.inventory || 0)); }}>
                                                                {product.inventory || 0}
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                                {isLxrtsProduct(product) && expandedProduct === product.id && (
                                                    <tr className="variant-row"><td colSpan="7">
                                                        <div className="variant-grid">
                                                            {getProductSizes(product.id).map(size => (
                                                                <div key={size} className="variant-cell">
                                                                    <span className="variant-size">{size}</span>
                                                                    {editingVariant === `${product.id}-${size}` ? (
                                                                        <div className="inline-edit compact">
                                                                            <input type="number" value={variantEditValue} onChange={(e) => setVariantEditValue(e.target.value)}
                                                                                onKeyDown={(e) => { if (e.key === "Enter") handleVariantInventoryUpdate(product.id, size); if (e.key === "Escape") setEditingVariant(null); }}
                                                                                autoFocus className="inline-edit-input" />
                                                                            <button onClick={() => handleVariantInventoryUpdate(product.id, size)} disabled={savingVariant} className="inline-save-btn">{savingVariant ? "..." : "✓"}</button>
                                                                        </div>
                                                                    ) : (
                                                                        <span className={`editable-inventory ${getInventoryClass(variantInventory[product.id]?.[size] || 0)}`}
                                                                            onClick={() => { setEditingVariant(`${product.id}-${size}`); setVariantEditValue(String(variantInventory[product.id]?.[size] || 0)); }}>
                                                                            {variantInventory[product.id]?.[size] ?? "..."}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </td></tr>
                                                )}
                                            </React.Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            </div></div>
                            {inventoryTotalPages > 1 && (
                                <div className="admin-pagination">
                                    <button onClick={() => setInventoryPage(p => Math.max(1, p - 1))} disabled={inventoryPage === 1}>Prev</button>
                                    <span>Page {inventoryPage} of {inventoryTotalPages}</span>
                                    <button onClick={() => setInventoryPage(p => Math.min(inventoryTotalPages, p + 1))} disabled={inventoryPage === inventoryTotalPages}>Next</button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ═══════════════════════════════════════════════════════════ */}
                    {/* TAB 6: COST & EXPENDITURE */}
                    {/* ═══════════════════════════════════════════════════════════ */}
                    {activeTab === "cost_expenditure" && (
                        <div className="admin-dashboard-tab">
                            <h2 className="admin-section-title">Cost & Expenditure</h2>

                            {/* 1. Discounts Given */}
                            <h3 className="admin-subsection-title">Discounts Given</h3>
                            <div className="admin-stats-grid overview-grid">
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Total Discount</span>
                                    <span className="stat-value">₹{formatIndianNumber(financialStats.totalDiscount.toFixed(0))}</span>
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Discount %</span>
                                    <span className="stat-value">{financialStats.discountPercent}%</span>
                                </div>
                            </div>

                            {/* Discount by Channel */}
                            <div className="analytics-charts-grid" style={{ marginBottom: 20 }}>
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Discounts by Channel</h3>
                                    {financialStats.channelDiscounts.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={300}>
                                            <BarChart data={financialStats.channelDiscounts} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                                                <XAxis dataKey="name" tick={<WrappedAxisTick />} interval={0} axisLine={false} tickLine={false} height={50} />
                                                <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                                                <Tooltip content={({ active, payload, label }) => {
                                                    if (!active || !payload?.length) return null;
                                                    return (<div className="cmo-chart-tooltip"><p className="cmo-chart-tooltip-label">{label}</p><p className="cmo-chart-tooltip-row">Discount: ₹{formatIndianNumber(payload[0].value)}</p></div>);
                                                }} />
                                                <Bar dataKey="discount" name="Discount" fill="#d5b85a" radius={[6, 6, 0, 0]} barSize={36} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : <div className="no-chart-data">No data available</div>}
                                </div>
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Discount by Salesperson</h3>
                                    {analyticsData.salesBySalesperson.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={320}>
                                            <BarChart data={analyticsData.salesBySalesperson} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                                                <XAxis dataKey="name" interval={0} tick={<WrappedAxisTick />} axisLine={false} tickLine={false} height={50} />
                                                <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                                                <Tooltip content={({ active, payload, label }) => {
                                                    if (!active || !payload?.length) return null;
                                                    return (<div className="cmo-chart-tooltip"><p className="cmo-chart-tooltip-label">{label}</p>{payload.map((p, i) => (<p key={i} className="cmo-chart-tooltip-row"><span className="cmo-chart-tooltip-dot" style={{ background: p.fill }}></span>{p.name}: ₹{formatIndianNumber(p.value)}</p>))}</div>);
                                                }} />
                                                <Legend />
                                                <Bar dataKey="sales" name="Sales" fill="#d5b85a" radius={[6, 6, 0, 0]} barSize={18} />
                                                <Bar dataKey="discount" name="Discount" fill="#8B7355" radius={[6, 6, 0, 0]} barSize={18} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : <div className="no-chart-data">No data available</div>}
                                </div>
                            </div>

                            {/* 2. Refunds Value (Placeholder) */}
                            <h3 className="admin-subsection-title">Refunds Value</h3>
                            <div className="admin-stats-grid overview-grid">
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Total Refunds</span>
                                    <span className="stat-value">₹0</span>
                                    <PlaceholderBadge label="Refund data pending" />
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Refunds — Website</span>
                                    <span className="stat-value">—</span>
                                    <PlaceholderBadge label="Channel refunds pending" />
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Refunds — Stores</span>
                                    <span className="stat-value">—</span>
                                    <PlaceholderBadge label="Channel refunds pending" />
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Refunds — B2B</span>
                                    <span className="stat-value">—</span>
                                    <PlaceholderBadge label="Channel refunds pending" />
                                </div>
                            </div>

                            {/* 3. Returns Value (Placeholder) */}
                            <h3 className="admin-subsection-title">Returns Value</h3>
                            <div className="admin-stats-grid overview-grid">
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Total Returns</span>
                                    <span className="stat-value">₹0</span>
                                    <PlaceholderBadge label="Returns data pending" />
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Returns — Website</span>
                                    <span className="stat-value">—</span>
                                    <PlaceholderBadge label="Channel returns pending" />
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Returns — Stores</span>
                                    <span className="stat-value">—</span>
                                    <PlaceholderBadge label="Channel returns pending" />
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Returns — B2B</span>
                                    <span className="stat-value">—</span>
                                    <PlaceholderBadge label="Channel returns pending" />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ═══════════════════════════════════════════════════════════ */}
                    {/* TAB 7: B2B & VENDOR OVERVIEW */}
                    {/* ═══════════════════════════════════════════════════════════ */}
                    {activeTab === "b2b_vendor" && (
                        <div className="admin-b2b-tab">
                            <h2 className="admin-section-title">B2B & Vendor Overview</h2>
                            <div className="admin-stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">B2B Revenue</span>
                                    <span className="stat-value">₹{formatIndianNumber(b2bStats.totalB2bRevenue.toFixed(0))}</span>
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">B2B Orders</span>
                                    <span className="stat-value">{b2bStats.totalB2bOrders}</span>
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Advance Collected</span>
                                    <span className="stat-value">₹{formatIndianNumber(b2bStats.totalB2bAdvance.toFixed(0))}</span>
                                </div>
                                <div className="admin-stat-card overview-card danger" style={{ borderLeft: '3px solid #c62828' }}>
                                    <span className="stat-label">Balance Pending</span>
                                    <span className="stat-value">₹{formatIndianNumber(b2bStats.totalB2bBalance.toFixed(0))}</span>
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Credit Exposure</span>
                                    <span className="stat-value">—</span>
                                    <PlaceholderBadge label="Credit limit data pending" />
                                </div>
                            </div>

                            {/* 1. Client-wise Sales */}
                            <h3 className="admin-subsection-title">Client-wise Sales</h3>
                            <div className="admin-toolbar">
                                <div className="admin-search-wrapper">
                                    <span className="search-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg></span>
                                    <input type="text" placeholder="Search B2B client..." value={b2bSearch} onChange={(e) => setB2bSearch(e.target.value)} className="admin-search-input" />
                                    {b2bSearch && <button className="search-clear" onClick={() => setB2bSearch("")}>×</button>}
                                </div>
                            </div>
                            <div className="admin-table-wrapper"><div className="admin-table-container">
                                <table className="admin-table">
                                    <thead><tr><th>#</th><th>Client Name</th><th>Orders</th><th className="amount">Total Sales</th><th className="amount">Advance Paid</th><th className="amount">Balance Pending</th></tr></thead>
                                    <tbody>
                                        {b2bStats.currentB2bClients.length === 0 ?
                                            <tr><td colSpan="6" className="no-data">No B2B clients found</td></tr> :
                                            b2bStats.currentB2bClients.map((c, idx) => (
                                                <tr key={c.name + idx}>
                                                    <td>{(b2bPage - 1) * ITEMS_PER_PAGE + idx + 1}</td>
                                                    <td style={{ fontWeight: 500 }}>{c.name}</td>
                                                    <td>{c.orders}</td>
                                                    <td className="amount">₹{formatIndianNumber(c.sales.toFixed(0))}</td>
                                                    <td className="amount">₹{formatIndianNumber(c.advance.toFixed(0))}</td>
                                                    <td className="amount" style={{ color: c.balance > 0 ? '#c62828' : '#2e7d32', fontWeight: 600 }}>₹{formatIndianNumber(c.balance.toFixed(0))}</td>
                                                </tr>
                                            ))
                                        }
                                    </tbody>
                                </table>
                            </div></div>
                            {b2bStats.b2bTotalPages > 1 && (
                                <div className="admin-pagination">
                                    <button onClick={() => setB2bPage(p => Math.max(1, p - 1))} disabled={b2bPage === 1}>Prev</button>
                                    <span>Page {b2bPage} of {b2bStats.b2bTotalPages}</span>
                                    <button onClick={() => setB2bPage(p => Math.min(b2bStats.b2bTotalPages, p + 1))} disabled={b2bPage === b2bStats.b2bTotalPages}>Next</button>
                                </div>
                            )}

                            {/* 3. Advance Pending Clients */}
                            {b2bStats.advancePending.length > 0 && (
                                <div style={{ marginTop: 20 }}>
                                    <h3 className="admin-subsection-title">⚠️ Advance Pending Clients</h3>
                                    <div className="admin-table-wrapper"><div className="admin-table-container">
                                        <table className="admin-table">
                                            <thead><tr><th>Client</th><th className="amount">Total Sales</th><th className="amount">Advance Paid</th><th className="amount">Balance Due</th></tr></thead>
                                            <tbody>
                                                {b2bStats.advancePending.slice(0, 15).map((c, i) => (
                                                    <tr key={i} className="urgent-row">
                                                        <td style={{ fontWeight: 500 }}>{c.name}</td>
                                                        <td className="amount">₹{formatIndianNumber(c.sales.toFixed(0))}</td>
                                                        <td className="amount">₹{formatIndianNumber(c.advance.toFixed(0))}</td>
                                                        <td className="amount" style={{ color: '#c62828', fontWeight: 700 }}>₹{formatIndianNumber(c.balance.toFixed(0))}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div></div>
                                </div>
                            )}

                            {/* 4. Buyout vs Consignment */}
                            <div className="analytics-charts-grid" style={{ marginTop: 20 }}>
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Buyout vs Consignment Mix</h3>
                                    <div className="no-chart-data" style={{ flexDirection: 'column', gap: 8 }}>
                                        <PlaceholderBadge label="Order type classification pending" />
                                        <span>Buyout and consignment breakdown will appear here</span>
                                    </div>
                                </div>
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Client Credit Exposure</h3>
                                    <div className="no-chart-data" style={{ flexDirection: 'column', gap: 8 }}>
                                        <PlaceholderBadge label="Credit limit tracking pending" />
                                        <span>Credit utilization per B2B client will appear here</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ═══════════════════════════════════════════════════════════ */}
                    {/* TAB 8: TARGETS & GROWTH */}
                    {/* ═══════════════════════════════════════════════════════════ */}
                    {activeTab === "targets_growth" && (
                        <div className="admin-targets-tab">
                            <h2 className="admin-section-title">Targets & Growth</h2>

                            {/* 1. Monthly Targets vs Achieved */}
                            <div className="analytics-chart-card" style={{ marginBottom: 20 }}>
                                <h3 className="chart-title">Monthly Targets vs Achieved ({new Date().getFullYear()})</h3>
                                <p className="chart-subtitle"><PlaceholderBadge label="Targets not yet set — showing actual revenue only" /></p>
                                <ResponsiveContainer width="100%" height={350}>
                                    <BarChart data={targetsData.monthlyData} margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                                        <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#666' }} axisLine={false} tickLine={false} />
                                        <YAxis tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                                        <Tooltip content={({ active, payload, label }) => {
                                            if (!active || !payload?.length) return null;
                                            return (<div className="cmo-chart-tooltip"><p className="cmo-chart-tooltip-label">{label}</p>{payload.map((p, i) => (<p key={i} className="cmo-chart-tooltip-row"><span className="cmo-chart-tooltip-dot" style={{ background: p.fill }}></span>{p.name}: ₹{formatIndianNumber(p.value)}</p>))}</div>);
                                        }} />
                                        <Legend />
                                        <Bar dataKey="target" name="Target" fill="#e8e2d0" radius={[6, 6, 0, 0]} />
                                        <Bar dataKey="achieved" name="Achieved" fill="#d5b85a" radius={[6, 6, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            {/* 2. Store Growth % */}
                            <h3 className="admin-subsection-title">Store Growth %</h3>
                            <div className="admin-table-wrapper" style={{ marginBottom: 20 }}><div className="admin-table-container">
                                <table className="admin-table">
                                    <thead><tr><th>Store / Channel</th><th className="amount">Current Period</th><th className="amount">Previous Period</th><th>Growth %</th></tr></thead>
                                    <tbody>
                                        {targetsData.storeGrowthList.length === 0 ?
                                            <tr><td colSpan="4" className="no-data">No data available</td></tr> :
                                            targetsData.storeGrowthList.map((s, i) => {
                                                const g = Number(s.growth);
                                                return (
                                                    <tr key={i}>
                                                        <td style={{ fontWeight: 500 }}>{s.name}</td>
                                                        <td className="amount">₹{formatIndianNumber(s.current.toFixed(0))}</td>
                                                        <td className="amount">₹{formatIndianNumber(s.previous.toFixed(0))}</td>
                                                        <td><span className={`growth-indicator ${g >= 0 ? 'positive' : 'negative'}`} style={{ display: 'inline-flex' }}>
                                                            <span className="growth-arrow">{g >= 0 ? '↑' : '↓'}</span>{Math.abs(g).toFixed(1)}%
                                                        </span></td>
                                                    </tr>
                                                );
                                            })
                                        }
                                    </tbody>
                                </table>
                            </div></div>

                            {/* 3. B2B Growth % */}
                            <h3 className="admin-subsection-title">B2B Growth %</h3>
                            <div className="admin-stats-grid overview-grid" style={{ marginBottom: 20 }}>
                                {targetsData.storeGrowthList.filter(s => s.name.toLowerCase() === 'b2b').map((s, i) => {
                                    const g = Number(s.growth);
                                    return (
                                        <div key={i} className="admin-stat-card overview-card">
                                            <span className="stat-label">B2B Revenue</span>
                                            <span className="stat-value">₹{formatIndianNumber(s.current.toFixed(0))}</span>
                                            <span className={`growth-indicator ${g >= 0 ? 'positive' : 'negative'}`}>
                                                <span className="growth-arrow">{g >= 0 ? '↑' : '↓'}</span>{Math.abs(g).toFixed(1)}%
                                            </span>
                                        </div>
                                    );
                                })}
                                {targetsData.storeGrowthList.filter(s => s.name.toLowerCase() === 'b2b').length === 0 && (
                                    <div className="admin-stat-card overview-card">
                                        <span className="stat-label">B2B Growth</span>
                                        <span className="stat-value">—</span>
                                        <span className="stat-sub">No B2B data in period</span>
                                    </div>
                                )}
                            </div>

                            {/* 4. Website Growth % */}
                            <h3 className="admin-subsection-title">Website Growth %</h3>
                            <div className="analytics-chart-card">
                                <div className="no-chart-data" style={{ flexDirection: 'column', gap: 8 }}>
                                    <PlaceholderBadge label="Website analytics integration pending" />
                                    <span>Website traffic, conversion and revenue growth will appear here</span>
                                </div>
                            </div>
                        </div>
                    )}


                    {/* ═══════════ OPERATIONS: ORDERS ═══════════ */}
                    {activeTab === "orders" && (
                        <div className="admin-orders-tab">
                            <h2 className="admin-section-title">Order Management</h2>
                            <div className="admin-toolbar">
                                <div className="admin-search-wrapper">
                                    <span className="search-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg></span>
                                    <input type="text" placeholder="Search Order #, Customer, Phone..." value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} className="admin-search-input" />
                                    {orderSearch && <button className="search-clear" onClick={() => setOrderSearch("")}>×</button>}
                                </div>
                                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="admin-sort-select">
                                    <option value="newest">Newest First</option><option value="oldest">Oldest First</option><option value="delivery">Delivery Date</option><option value="amount_high">Amount: High to Low</option><option value="amount_low">Amount: Low to High</option>
                                </select>
                            </div>

                            <div className="admin-status-tabs">
                                {STATUS_TABS.map(tab => (
                                    <button key={tab.value} className={`status-tab ${statusTab === tab.value ? "active" : ""}`} onClick={() => setStatusTab(tab.value)}>
                                        {tab.label}<span className="tab-count">{orderTabCounts[tab.value]}</span>
                                    </button>
                                ))}
                            </div>

                            <div className="admin-filter-bar" ref={dropdownRef}>
                                <div className="filter-dropdown">
                                    <button className={`filter-btn ${(filters.dateFrom || filters.dateTo) ? "active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "date" ? null : "date")}>Date Range ▾</button>
                                    {openDropdown === "date" && (
                                        <div className="dropdown-panel">
                                            <div className="dropdown-title">Select Date Range</div>
                                            <div className="date-inputs">
                                                <input type="date" value={filters.dateFrom} onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))} />
                                                <span>to</span>
                                                <input type="date" value={filters.dateTo} onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value }))} />
                                            </div>
                                            <button className="dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>
                                <div className="filter-dropdown">
                                    <button className={`filter-btn ${(filters.minPrice > 0 || filters.maxPrice < 500000) ? "active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "price" ? null : "price")}>Price ▾</button>
                                    {openDropdown === "price" && (
                                        <div className="dropdown-panel price-panel">
                                            <div className="dropdown-title">Order Value</div>
                                            <div className="price-inputs">
                                                <div className="price-input-wrap"><span>₹</span><input type="number" value={filters.minPrice} onChange={(e) => setFilters(prev => ({ ...prev, minPrice: Math.min(Number(e.target.value), prev.maxPrice - 1000) }))} /></div>
                                                <span>to</span>
                                                <div className="price-input-wrap"><span>₹</span><input type="number" value={filters.maxPrice} onChange={(e) => setFilters(prev => ({ ...prev, maxPrice: Math.max(Number(e.target.value), prev.minPrice + 1000) }))} /></div>
                                            </div>
                                            <button className="dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>
                                <div className="filter-dropdown">
                                    <button className={`filter-btn ${filters.payment.length > 0 ? "active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "payment" ? null : "payment")}>Payment ▾</button>
                                    {openDropdown === "payment" && (
                                        <div className="dropdown-panel">
                                            <div className="dropdown-title">Payment Status</div>
                                            {["paid", "partial", "unpaid"].map(opt => (<label key={opt} className="checkbox-label"><input type="checkbox" checked={filters.payment.includes(opt)} onChange={() => toggleFilter("payment", opt)} /><span>{opt === "unpaid" ? "Unpaid (COD)" : opt.charAt(0).toUpperCase() + opt.slice(1)}</span></label>))}
                                            <button className="dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>
                                <div className="filter-dropdown">
                                    <button className={`filter-btn ${filters.priority.length > 0 ? "active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "priority" ? null : "priority")}>Priority ▾</button>
                                    {openDropdown === "priority" && (
                                        <div className="dropdown-panel">
                                            <div className="dropdown-title">Priority</div>
                                            {["normal", "urgent"].map(opt => (<label key={opt} className="checkbox-label"><input type="checkbox" checked={filters.priority.includes(opt)} onChange={() => toggleFilter("priority", opt)} /><span>{opt.charAt(0).toUpperCase() + opt.slice(1)}</span></label>))}
                                            <button className="dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>
                                <div className="filter-dropdown">
                                    <button className={`filter-btn ${filters.orderType.length > 0 ? "active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "orderType" ? null : "orderType")}>Type ▾</button>
                                    {openDropdown === "orderType" && (
                                        <div className="dropdown-panel">
                                            <div className="dropdown-title">Order Type</div>
                                            {["standard", "custom", "alteration"].map(opt => (<label key={opt} className="checkbox-label"><input type="checkbox" checked={filters.orderType.includes(opt)} onChange={() => toggleFilter("orderType", opt)} /><span>{opt.charAt(0).toUpperCase() + opt.slice(1)}</span></label>))}
                                            <button className="dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>
                                <div className="filter-dropdown">
                                    <button className={`filter-btn ${filters.store.length > 0 ? "active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "store" ? null : "store")}>Store ▾</button>
                                    {openDropdown === "store" && (
                                        <div className="dropdown-panel">
                                            <div className="dropdown-title">Store</div>
                                            {["Delhi Store", "Ludhiana Store", "B2B"].map(opt => (<label key={opt} className="checkbox-label"><input type="checkbox" checked={filters.store.includes(opt)} onChange={() => toggleFilter("store", opt)} /><span>{opt}</span></label>))}
                                            <button className="dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>
                                <div className="filter-dropdown">
                                    <select className="filter-btn" style={{ cursor: 'pointer' }} value={filters.salesperson} onChange={(e) => setFilters(prev => ({ ...prev, salesperson: e.target.value }))}>
                                        <option value="">All Salespersons</option>
                                        {salespersons.map(sp => <option key={sp} value={sp}>{sp}</option>)}
                                    </select>
                                </div>
                            </div>

                            {appliedFilters.length > 0 && (
                                <div className="admin-applied-filters">
                                    <span className="applied-label">Applied:</span>
                                    {appliedFilters.map((chip, i) => (<span key={i} className="filter-chip">{chip.label}<button onClick={() => removeFilter(chip.type, chip.value)}>×</button></span>))}
                                    <button className="clear-all" onClick={clearAllFilters}>Clear All</button>
                                </div>
                            )}

                            <div className="orders-count">Showing {filteredOrders.length} orders</div>

                            <div className="admin-table-wrapper">
                                <div className="admin-table-container">
                                    <table className="admin-table orders-table">
                                        <thead><tr><th>Order ID</th><th>Customer</th><th>Product</th><th>Amount</th><th>Payment</th><th>Status</th><th>Store</th><th>Date</th><th>Actions</th></tr></thead>
                                        <tbody>
                                            {currentOrders.length === 0 ? <tr><td colSpan="9" className="no-data">No orders found</td></tr> :
                                                currentOrders.map(order => {
                                                    const isUrgent = getPriority(order) === "urgent";
                                                    return (
                                                        <tr key={order.id} className={isUrgent ? "urgent-row" : ""}>
                                                            <td><span className="order-id">{order.order_no || "-"}</span>{isUrgent && <span className="urgent-badge">URGENT</span>}</td>
                                                            <td>{order.delivery_name || "-"}</td>
                                                            <td className="product-cell">{order.items?.[0]?.product_name || "-"}</td>
                                                            <td>₹{formatIndianNumber(order.grand_total || 0)}</td>
                                                            <td><span className={`payment-badge ${getPaymentStatus(order)}`}>{getPaymentStatus(order).charAt(0).toUpperCase() + getPaymentStatus(order).slice(1)}</span></td>
                                                            <td>
                                                                <select className="status-select" value={order.status || "pending"} onChange={(e) => updateOrderStatus(order.id, e.target.value)} disabled={statusUpdating === order.id}>
                                                                    {ORDER_STATUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                                                </select>
                                                            </td>
                                                            <td>{order.salesperson_store || "-"}</td>
                                                            <td>{formatDate(order.created_at)}</td>
                                                            <td><div className="action-buttons"><button className="action-btn pdf" onClick={() => handleGeneratePdf(order, "customer")} disabled={pdfLoading === order.id}>{pdfLoading === order.id ? "..." : "PDF"}</button></div></td>
                                                        </tr>
                                                    );
                                                })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            {ordersTotalPages > 1 && (
                                <div className="admin-pagination">
                                    <button onClick={() => setOrdersPage(p => Math.max(1, p - 1))} disabled={ordersPage === 1}>Prev</button>
                                    <span>Page {ordersPage} of {ordersTotalPages}</span>
                                    <button onClick={() => setOrdersPage(p => Math.min(ordersTotalPages, p + 1))} disabled={ordersPage === ordersTotalPages}>Next</button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ACCOUNTS TAB */}

                    {/* ═══════════ OPERATIONS: ACCOUNTS ═══════════ */}
                    {activeTab === "accounts" && (
                        <div className="admin-accounts-tab">
                            <h2 className="admin-section-title">Accounts & Finance</h2>
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Gross Value</span><span className="stat-value">₹{formatIndianNumber(accountsTotals.gross.toFixed(0))}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Total Discount</span><span className="stat-value">₹{formatIndianNumber(accountsTotals.discount.toFixed(0))}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Total GST</span><span className="stat-value">₹{formatIndianNumber(accountsTotals.gst.toFixed(0))}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Invoice Value</span><span className="stat-value">₹{formatIndianNumber(accountsTotals.invoice.toFixed(0))}</span></div></div>
                            </div>

                            <div className="acc-filter-bar">
                                <div className="admin-search-wrapper" style={{ flex: '0 0 auto', maxWidth: 280 }}>
                                    <span className="search-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg></span>
                                    <input type="text" placeholder="Search Order, Customer..." value={accountsSearch} onChange={(e) => setAccountsSearch(e.target.value)} className="admin-search-input" />
                                </div>
                                <div className="cmo-date-range">
                                    <input type="date" value={accountsDateFrom} onChange={(e) => setAccountsDateFrom(e.target.value)} />
                                    <span className="cmo-date-sep">→</span>
                                    <input type="date" value={accountsDateTo} onChange={(e) => setAccountsDateTo(e.target.value)} />
                                </div>
                                <select className="cmo-compare-select" value={accountsStatus} onChange={(e) => setAccountsStatus(e.target.value)}>
                                    <option value="">All Status</option>
                                    <option value="pending">Pending</option><option value="in_production">In Production</option><option value="ready">Ready</option>
                                    <option value="dispatched">Dispatched</option><option value="delivered">Delivered</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
                                </select>
                                <select className="cmo-compare-select" value={accountsStore} onChange={(e) => setAccountsStore(e.target.value)}>
                                    <option value="">All Stores</option>
                                    {accountsStoreOptions.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                                <select className="cmo-compare-select" value={accountsSA} onChange={(e) => setAccountsSA(e.target.value)}>
                                    <option value="">All Salespersons</option>
                                    {accountsSAOptions.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                                {(accountsDateFrom || accountsDateTo || accountsStatus || accountsStore || accountsSA) && (
                                    <button className="cmo-pill" onClick={() => { setAccountsDateFrom(""); setAccountsDateTo(""); setAccountsStatus(""); setAccountsStore(""); setAccountsSA(""); }}
                                        style={{ color: '#c62828', borderColor: '#c62828' }}>Clear</button>
                                )}
                            </div>

                            <div className="admin-table-wrapper">
                                <div className="admin-table-container accounts-table-container">
                                    <table className="admin-table accounts-table">
                                        <thead><tr><th>SA Name</th><th>Order ID</th><th>Date</th><th>Customer</th><th>Product</th><th className="amount">Gross</th><th className="amount">Discount</th><th className="amount">Taxable</th><th className="amount">GST</th><th className="amount">Invoice</th><th>Qty</th><th>Status</th><th>Delivery Date</th></tr></thead>
                                        <tbody>
                                            {currentAccountItems.length === 0 ? <tr><td colSpan="13" className="no-data">No records found</td></tr> :
                                                currentAccountItems.map(item => (
                                                    <tr key={item.id}>
                                                        <td>{item.sa_name}</td>
                                                        <td><span className="order-id">{item.order_no}</span></td>
                                                        <td>{formatDate(item.order_date)}</td>
                                                        <td>{item.client_name}</td>
                                                        <td className="product-cell">{item.product_name}</td>
                                                        <td className="amount">₹{formatIndianNumber(item.gross_value)}</td>
                                                        <td className="amount">₹{formatIndianNumber(item.discount)}</td>
                                                        <td className="amount">₹{formatIndianNumber(item.taxable_value)}</td>
                                                        <td className="amount">₹{formatIndianNumber(item.gst)}</td>
                                                        <td className="amount invoice">₹{formatIndianNumber(item.invoice_value)}</td>
                                                        <td>{item.quantity}</td>
                                                        <td><span className={`status-badge ${item.status}`}>{item.status}</span></td>
                                                        <td>{formatDate(item.delivery_date)}</td>
                                                    </tr>
                                                ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            {accountsTotalPages > 1 && (
                                <div className="admin-pagination">
                                    <button onClick={() => setAccountsPage(p => Math.max(1, p - 1))} disabled={accountsPage === 1}>Prev</button>
                                    <span>Page {accountsPage} of {accountsTotalPages}</span>
                                    <button onClick={() => setAccountsPage(p => Math.min(accountsTotalPages, p + 1))} disabled={accountsPage === accountsTotalPages}>Next</button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ═══════════════════════════════════════════════════ */}
                    {/* CLIENTS TAB */}
                    {/* ═══════════════════════════════════════════════════ */}

                </main>
            </div>
        </div>
    );
}