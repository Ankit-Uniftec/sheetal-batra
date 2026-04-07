import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./GMDashboard.css";
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

const STATUS_TABS = [
    { value: "all", label: "All Orders" },
    { value: "unfulfilled", label: "Unfulfilled" },
    { value: "prepared", label: "Prepared" },
    { value: "delivered", label: "Delivered" },
    { value: "cancelled", label: "Cancelled" },
];

const TIMELINE_OPTIONS = [
    { value: "today", label: "Today" },
    { value: "yesterday", label: "Yesterday" },
    { value: "weekly", label: "Last 7 Days" },
    { value: "monthly", label: "Last 30 Days" },
    { value: "yearly", label: "Last 365 Days" },
    { value: "custom", label: "Custom" },
];

const COMPARISON_OPTIONS = [
    { value: "none", label: "No comparison" },
    { value: "previous_period", label: "Previous period" },
    { value: "previous_year", label: "Previous year" },
];

const ITEMS_PER_PAGE = 15;
const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL", "6XL"];

const CHART_COLORS = ["#d5b85a", "#8B7355", "#C9A94E", "#A67C52", "#D4AF37", "#BDB76B", "#DAA520", "#B8860B", "#CD853F", "#DEB887"];
const PIE_COLORS = ["#d5b85a", "#8B7355", "#C9A94E", "#A67C52", "#D4AF37"];

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
    if (COLOR_NAME_MAP[lower]) return COLOR_NAME_MAP[lower];
    for (const [key, hex] of Object.entries(COLOR_NAME_MAP)) {
        if (lower.includes(key) || key.includes(lower)) return hex;
    }
    let hash = 0;
    for (let i = 0; i < lower.length; i++) hash = lower.charCodeAt(i) + ((hash << 5) - hash);
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, 55%, 50%)`;
};

const ChartTooltip = ({ active, payload, label, prefix = "\u20B9", suffix = "" }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="cmo-chart-tooltip">
            <p className="cmo-chart-tooltip-label">{label}</p>
            {payload.map((entry, i) => (
                <p key={i} style={{ color: entry.color }}>
                    {entry.name}: {prefix}{formatIndianNumber(Math.round(entry.value))}{suffix}
                </p>
            ))}
        </div>
    );
};

export default function GMDashboard() {
    const navigate = useNavigate();
    const { showPopup, PopupComponent } = usePopup();
    const dropdownRef = useRef(null);

    // Core state
    const [loading, setLoading] = useState(true);
    const [orders, setOrders] = useState([]);
    const [products, setProducts] = useState([]);
    const [salespersonTable, setSalespersonTable] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [consignmentInventory, setConsignmentInventory] = useState([]);
    const [currentUserEmail, setCurrentUserEmail] = useState("");
    const [currentUserName, setCurrentUserName] = useState("");

    // UI state
    const [activeTab, setActiveTab] = useState("store_performance");
    const [showSidebar, setShowSidebar] = useState(false);
    const [timeline, setTimeline] = useState("monthly");
    const [comparison, setComparison] = useState("none");
    const [customDateFrom, setCustomDateFrom] = useState("");
    const [customDateTo, setCustomDateTo] = useState("");
    const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);

    // Orders tab
    const [orderSearch, setOrderSearch] = useState("");
    const [statusTab, setStatusTab] = useState("all");
    const [ordersPage, setOrdersPage] = useState(1);
    const [sortBy, setSortBy] = useState("newest");
    const [filters, setFilters] = useState({ dateFrom: "", dateTo: "", minPrice: 0, maxPrice: 500000, payment: [], priority: [], orderType: [], store: [], salesperson: "" });
    const [openDropdown, setOpenDropdown] = useState(null);
    const [statusUpdating, setStatusUpdating] = useState(null);
    const [pdfLoading, setPdfLoading] = useState(null);

    // Store performance tab
    const [storeFilter, setStoreFilter] = useState("all");
    const [saFilter, setSaFilter] = useState("");

    // Accounts tab
    const [accountsSearch, setAccountsSearch] = useState("");
    const [accountsDateFrom, setAccountsDateFrom] = useState("");
    const [accountsDateTo, setAccountsDateTo] = useState("");
    const [accountsStatus, setAccountsStatus] = useState("");
    const [accountsStore, setAccountsStore] = useState("");
    const [accountsSA, setAccountsSA] = useState("");
    const [accountsPage, setAccountsPage] = useState(1);

    // B2B tab
    const [b2bSearch, setB2bSearch] = useState("");
    const [b2bPage, setB2bPage] = useState(1);

    // Returns tab
    const [returnsFilter, setReturnsFilter] = useState("all");

    // Inventory
    const [inventorySearch, setInventorySearch] = useState("");
    const [inventoryPage, setInventoryPage] = useState(1);
    const [variantInventory, setVariantInventory] = useState({});
    const [lxrtsSyncLoading, setLxrtsSyncLoading] = useState(false);

    // Auth & fetch
    useEffect(() => {
        const checkAuthAndFetch = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) { navigate("/login", { replace: true }); return; }

            const { data: userRecord } = await supabase
                .from("salesperson")
                .select("role, saleperson")
                .eq("email", session.user.email?.toLowerCase())
                .single();

            if (!userRecord || userRecord.role !== "gm") {
                console.log("\u274C Access denied - not a GM");
                await supabase.auth.signOut();
                navigate("/login", { replace: true });
                return;
            }

            setCurrentUserEmail(session.user.email?.toLowerCase() || "");
            setCurrentUserName(userRecord.saleperson || "");
            fetchAllData();
        };
        checkAuthAndFetch();
    }, [navigate]);

    const fetchAllData = async () => {
        setLoading(true);
        try {
            const [ordersRes, productsRes, spRes, vendorsRes, consignmentRes] = await Promise.all([
                supabase.from("orders").select("*").order("created_at", { ascending: false }),
                supabase.from("products").select("*").order("name", { ascending: true }),
                supabase.from("salesperson").select("saleperson, role, email, phone, store_name, sales_target, designation"),
                supabase.from("vendors").select("*"),
                supabase.from("consignment_inventory").select("*"),
            ]);
            if (ordersRes.data) setOrders(ordersRes.data);
            if (productsRes.data) setProducts(productsRes.data);
            if (spRes.data) setSalespersonTable(spRes.data);
            if (vendorsRes.data) setVendors(vendorsRes.data);
            if (consignmentRes.data) setConsignmentInventory(consignmentRes.data);
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

    // ═══════════════════════════════════════════════════════════
    // HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════════
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

    const getOrderChannel = (order) => {
        if (isLxrtsOrder(order)) return "Website (LXRTS)";
        const store = (order.salesperson_store || "").trim();
        if (!store) return "Other";
        if (store.toLowerCase() === "b2b") return "B2B";
        return store;
    };

    const getOrderSalesperson = (order) => {
        if (order.is_b2b || (order.salesperson_store || "").toLowerCase() === "b2b") {
            return order.merchandiser_name || order.salesperson || null;
        }
        return order.salesperson || null;
    };

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

    const salespersons = useMemo(() => {
        const spSet = new Set();
        orders.forEach(o => {
            const sp = getOrderSalesperson(o);
            if (sp && isPersonName(sp)) spSet.add(sp);
        });
        return [...spSet].sort();
    }, [orders, knownStoreNames]);

    // ═══════════════════════════════════════════════════════════
    // DATE RANGE HELPERS
    // ═══════════════════════════════════════════════════════════
    const getDateRange = (timelineValue) => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        switch (timelineValue) {
            case "today": return { start: today, end: now };
            case "yesterday":
                const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayEnd = new Date(today); yesterdayEnd.setMilliseconds(-1);
                return { start: yesterday, end: yesterdayEnd };
            case "weekly":
                const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
                return { start: weekAgo, end: now };
            case "monthly":
                const monthAgo = new Date(today); monthAgo.setDate(monthAgo.getDate() - 30);
                return { start: monthAgo, end: now };
            case "yearly":
                const yearAgo = new Date(today); yearAgo.setDate(yearAgo.getDate() - 365);
                return { start: yearAgo, end: now };
            case "custom":
                return { start: customDateFrom ? new Date(customDateFrom) : new Date(0), end: customDateTo ? new Date(customDateTo + "T23:59:59") : now };
            default: return { start: today, end: now };
        }
    };

    const getComparisonDateRange = (timelineValue, comparisonType) => {
        const currentRange = getDateRange(timelineValue);
        if (comparisonType === "previous_year") {
            const s = new Date(currentRange.start); s.setFullYear(s.getFullYear() - 1);
            const e = new Date(currentRange.end); e.setFullYear(e.getFullYear() - 1);
            return { start: s, end: e };
        }
        const duration = currentRange.end - currentRange.start;
        const prevEnd = new Date(currentRange.start); prevEnd.setMilliseconds(-1);
        const prevStart = new Date(prevEnd - duration);
        return { start: prevStart, end: prevEnd };
    };

    const filterOrdersByDateRange = (ordersList, dateRange) => {
        if (!dateRange) return ordersList;
        return ordersList.filter(o => { const d = new Date(o.created_at); return d >= dateRange.start && d <= dateRange.end; });
    };

    const calculateGrowth = (current, previous) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return ((current - previous) / previous) * 100;
    };

    // ═══════════════════════════════════════════════════════════
    // STORE PERFORMANCE STATS
    // ═══════════════════════════════════════════════════════════
    const storePerformanceStats = useMemo(() => {
        const dateRange = getDateRange(timeline);
        const compRange = comparison !== "none" ? getComparisonDateRange(timeline, comparison) : null;
        const currentOrders = filterOrdersByDateRange(orders.filter(o => !isLxrtsOrder(o)), dateRange);
        const prevOrders = compRange ? filterOrdersByDateRange(orders.filter(o => !isLxrtsOrder(o)), compRange) : [];

        const totalRevenue = currentOrders.reduce((s, o) => s + Number(o.grand_total || 0), 0);
        const totalOrders = currentOrders.length;
        const prevRevenue = prevOrders.reduce((s, o) => s + Number(o.grand_total || 0), 0);

        // Store-wise breakdown
        const storeMap = {};
        currentOrders.forEach(o => {
            const store = o.salesperson_store || "Other";
            if (!storeMap[store]) storeMap[store] = { name: store, revenue: 0, orders: 0, items: 0 };
            storeMap[store].revenue += Number(o.grand_total || 0);
            storeMap[store].orders += 1;
            storeMap[store].items += (o.items?.reduce((q, it) => q + (it.quantity || 1), 0) || 0);
        });
        const storeBreakdown = Object.values(storeMap).sort((a, b) => b.revenue - a.revenue);

        // SA-wise breakdown
        const saMap = {};
        currentOrders.forEach(o => {
            const sp = getOrderSalesperson(o);
            if (!sp || !isPersonName(sp)) return;
            const store = o.salesperson_store || "Other";
            if (!saMap[sp]) saMap[sp] = { name: sp, store, revenue: 0, orders: 0, items: 0, discount: 0 };
            saMap[sp].revenue += Number(o.grand_total || 0);
            saMap[sp].orders += 1;
            saMap[sp].items += (o.items?.reduce((q, it) => q + (it.quantity || 1), 0) || 0);
            saMap[sp].discount += Number(o.discount_amount || 0);
        });
        let saBreakdown = Object.values(saMap).sort((a, b) => b.revenue - a.revenue);
        if (storeFilter !== "all") saBreakdown = saBreakdown.filter(s => s.store === storeFilter);

        // Store growth comparison
        const prevStoreMap = {};
        prevOrders.forEach(o => {
            const store = o.salesperson_store || "Other";
            if (!prevStoreMap[store]) prevStoreMap[store] = { revenue: 0 };
            prevStoreMap[store].revenue += Number(o.grand_total || 0);
        });
        const storeGrowth = storeBreakdown.map(s => ({
            ...s,
            prevRevenue: prevStoreMap[s.name]?.revenue || 0,
            growth: calculateGrowth(s.revenue, prevStoreMap[s.name]?.revenue || 0),
        }));

        // Staff productivity (orders per SA per store)
        const storeStaffCount = {};
        salespersonTable.forEach(sp => {
            const store = sp.store_name || "Other";
            if (sp.role === "associate" || sp.role === "salesperson") {
                if (!storeStaffCount[store]) storeStaffCount[store] = 0;
                storeStaffCount[store] += 1;
            }
        });
        const staffProductivity = storeBreakdown.map(s => ({
            name: s.name,
            orders: s.orders,
            staff: storeStaffCount[s.name] || 1,
            ordersPerStaff: Math.round(s.orders / (storeStaffCount[s.name] || 1)),
        }));

        return {
            totalRevenue, totalOrders,
            revenueGrowth: calculateGrowth(totalRevenue, prevRevenue),
            ordersGrowth: calculateGrowth(totalOrders, prevOrders.length),
            showComparison: comparison !== "none",
            storeBreakdown, storeGrowth, saBreakdown, staffProductivity,
            aov: totalOrders > 0 ? totalRevenue / totalOrders : 0,
        };
    }, [orders, timeline, comparison, customDateFrom, customDateTo, storeFilter, salespersonTable]);

    // ═══════════════════════════════════════════════════════════
    // DAY-WISE SALES
    // ═══════════════════════════════════════════════════════════
    const dayWiseSales = useMemo(() => {
        const dateRange = getDateRange(timeline);
        const validOrders = orders.filter(o => {
            if (isLxrtsOrder(o)) return false;
            const d = new Date(o.created_at);
            return d >= dateRange.start && d <= dateRange.end;
        });
        const buckets = {};
        validOrders.forEach(o => {
            const d = new Date(o.created_at);
            const key = d.toISOString().split("T")[0];
            const label = `${d.getDate()}/${d.getMonth() + 1}`;
            if (!buckets[key]) buckets[key] = { date: label, fullDate: key, revenue: 0, orders: 0, delhiRevenue: 0, ludhianaRevenue: 0, b2bRevenue: 0 };
            const amount = Number(o.grand_total || 0);
            buckets[key].revenue += amount;
            buckets[key].orders += 1;
            const store = (o.salesperson_store || "").toLowerCase();
            if (store.includes("delhi") || store === "dlc") buckets[key].delhiRevenue += amount;
            else if (store.includes("ludhiana") || store === "ldhc" || store === "llc") buckets[key].ludhianaRevenue += amount;
            else if (store === "b2b") buckets[key].b2bRevenue += amount;
        });
        return Object.values(buckets).sort((a, b) => a.fullDate.localeCompare(b.fullDate));
    }, [orders, timeline, customDateFrom, customDateTo]);

    // ═══════════════════════════════════════════════════════════
    // B2B STATS
    // ═══════════════════════════════════════════════════════════
    const b2bStats = useMemo(() => {
        const allB2bOrders = orders.filter(o => getOrderChannel(o) === "B2B");
        const dateRange = getDateRange(timeline);
        const currentB2b = allB2bOrders.filter(o => { const d = new Date(o.created_at); return d >= dateRange.start && d <= dateRange.end; });

        const totalB2bRevenue = currentB2b.reduce((s, o) => s + Number(o.grand_total || 0), 0);
        const totalAllRevenue = filterOrdersByDateRange(orders, dateRange).reduce((s, o) => s + Number(o.grand_total || 0), 0);
        const b2bContribution = totalAllRevenue > 0 ? ((totalB2bRevenue / totalAllRevenue) * 100).toFixed(1) : 0;

        const buyoutOrders = currentB2b.filter(o => o.b2b_order_type === "Buyout");
        const consignmentOrders = currentB2b.filter(o => o.b2b_order_type === "Consignment");
        const clientOrderOrders = currentB2b.filter(o => o.b2b_order_type === "Client Order");

        const clientSales = {};
        currentB2b.forEach(o => {
            const client = o.delivery_name || "Unknown";
            if (!clientSales[client]) clientSales[client] = { name: client, sales: 0, orders: 0, advance: 0, balance: 0 };
            clientSales[client].sales += Number(o.grand_total || 0);
            clientSales[client].orders += 1;
            clientSales[client].advance += Number(o.advance_payment || 0);
            clientSales[client].balance += Math.max(0, Number(o.grand_total || 0) - Number(o.advance_payment || 0));
        });
        const allClientSales = Object.values(clientSales).sort((a, b) => b.sales - a.sales);

        let filteredB2b = allClientSales;
        if (b2bSearch.trim()) {
            const q = b2bSearch.toLowerCase();
            filteredB2b = filteredB2b.filter(c => c.name.toLowerCase().includes(q));
        }
        const b2bTotalPages = Math.ceil(filteredB2b.length / ITEMS_PER_PAGE);
        const currentB2bClients = filteredB2b.slice((b2bPage - 1) * ITEMS_PER_PAGE, b2bPage * ITEMS_PER_PAGE);

        // Product analysis
        const productSales = {};
        currentB2b.forEach(o => {
            (o.items || []).forEach(item => {
                const name = item.product_name || "Unknown";
                if (!productSales[name]) productSales[name] = { name, qty: 0, revenue: 0 };
                productSales[name].qty += Number(item.quantity || 1);
                productSales[name].revenue += Number(item.price || 0) * Number(item.quantity || 1);
            });
        });
        const topB2bProducts = Object.values(productSales).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

        // Growth
        const periodMs = dateRange.end - dateRange.start;
        const prevB2b = allB2bOrders.filter(o => { const d = new Date(o.created_at); return d >= new Date(dateRange.start.getTime() - periodMs) && d < dateRange.start; });
        const prevRevenue = prevB2b.reduce((s, o) => s + Number(o.grand_total || 0), 0);

        return {
            totalB2bRevenue, totalB2bOrders: currentB2b.length, b2bContribution,
            buyoutCount: buyoutOrders.length, buyoutValue: buyoutOrders.reduce((s, o) => s + Number(o.grand_total || 0), 0),
            consignmentCount: consignmentOrders.length, consignmentValue: consignmentOrders.reduce((s, o) => s + Number(o.grand_total || 0), 0),
            clientOrderCount: clientOrderOrders.length, clientOrderValue: clientOrderOrders.reduce((s, o) => s + Number(o.grand_total || 0), 0),
            currentB2bClients, b2bTotalPages, allClientSales, topB2bProducts,
            advancePending: allClientSales.filter(c => c.balance > 0).sort((a, b) => b.balance - a.balance),
            revenueGrowth: calculateGrowth(totalB2bRevenue, prevRevenue),
        };
    }, [orders, timeline, customDateFrom, customDateTo, b2bSearch, b2bPage]);

    // ═══════════════════════════════════════════════════════════
    // INVENTORY STATS
    // ═══════════════════════════════════════════════════════════
    const inventoryStats = useMemo(() => {
        const total = products.length;
        let totalInventory = 0, lowStock = 0, outOfStock = 0;
        products.forEach(p => {
            const qty = p.sync_enabled ? getLxrtsTotalInventory(p.id) : (p.inventory || 0);
            totalInventory += qty;
            if (qty === 0) outOfStock++;
            else if (qty < 5) lowStock++;
        });

        // Consignment stats
        const totalConsignmentPieces = consignmentInventory.reduce((s, c) => s + (c.quantity_sent || 0), 0);
        const soldConsignment = consignmentInventory.reduce((s, c) => s + (c.quantity_sold || 0), 0);
        const remainingConsignment = consignmentInventory.reduce((s, c) => s + (c.quantity_remaining || 0), 0);
        const lostConsignment = consignmentInventory.reduce((s, c) => s + (c.quantity_lost || 0), 0);

        // Stock vs Sales analysis
        const dateRange = getDateRange(timeline);
        const recentOrders = orders.filter(o => {
            if (isLxrtsOrder(o)) return false;
            const d = new Date(o.created_at);
            return d >= dateRange.start && d <= dateRange.end;
        });
        const soldQty = recentOrders.reduce((s, o) => s + (o.items?.reduce((q, it) => q + (it.quantity || 1), 0) || 0), 0);

        // Filtered products for table
        let filtered = products;
        if (inventorySearch) {
            const q = inventorySearch.toLowerCase();
            filtered = filtered.filter(p => p.name?.toLowerCase().includes(q) || p.sku_id?.toLowerCase().includes(q));
        }
        const inventoryTotalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
        const currentProducts = filtered.slice((inventoryPage - 1) * ITEMS_PER_PAGE, inventoryPage * ITEMS_PER_PAGE);

        return {
            total, totalInventory, lowStock, outOfStock,
            totalConsignmentPieces, soldConsignment, remainingConsignment, lostConsignment,
            soldQty, currentProducts, inventoryTotalPages,
        };
    }, [products, consignmentInventory, orders, timeline, customDateFrom, customDateTo, inventorySearch, inventoryPage, variantInventory]);

    // ═══════════════════════════════════════════════════════════
    // RETURNS & ANALYTICS
    // ═══════════════════════════════════════════════════════════
    const returnsAnalytics = useMemo(() => {
        const dateRange = getDateRange(timeline);
        const periodOrders = filterOrdersByDateRange(orders, dateRange);

        const cancelled = periodOrders.filter(o => o.status === "cancelled");
        const returned = periodOrders.filter(o => o.return_reason);
        const refunded = periodOrders.filter(o => o.refund_reason);
        const exchanged = periodOrders.filter(o => o.exchange_reason);
        const revoked = periodOrders.filter(o => o.revoked_at);

        // Reason analysis
        const analyzeReasons = (items, reasonField) => {
            const map = {};
            items.forEach(o => {
                const reason = o[reasonField] || "Not specified";
                if (!map[reason]) map[reason] = 0;
                map[reason]++;
            });
            return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
        };

        // SA-wise breakdown for returns/cancellations
        const saIssues = {};
        [...cancelled, ...returned, ...refunded, ...exchanged, ...revoked].forEach(o => {
            const sp = getOrderSalesperson(o);
            if (!sp || !isPersonName(sp)) return;
            if (!saIssues[sp]) saIssues[sp] = { name: sp, cancellations: 0, returns: 0, refunds: 0, exchanges: 0, revokes: 0, totalValue: 0 };
            if (o.status === "cancelled") saIssues[sp].cancellations++;
            if (o.return_reason) saIssues[sp].returns++;
            if (o.refund_reason) saIssues[sp].refunds++;
            if (o.exchange_reason) saIssues[sp].exchanges++;
            if (o.revoked_at) saIssues[sp].revokes++;
            saIssues[sp].totalValue += Number(o.grand_total || 0);
        });
        const saIssuesList = Object.values(saIssues).sort((a, b) => (b.cancellations + b.returns + b.refunds + b.exchanges + b.revokes) - (a.cancellations + a.returns + a.refunds + a.exchanges + a.revokes));

        const totalIssueValue = [...cancelled, ...returned, ...refunded, ...exchanged].reduce((s, o) => s + Number(o.grand_total || 0), 0);

        return {
            cancelledCount: cancelled.length, cancelledValue: cancelled.reduce((s, o) => s + Number(o.grand_total || 0), 0),
            returnedCount: returned.length, returnedValue: returned.reduce((s, o) => s + Number(o.grand_total || 0), 0),
            refundedCount: refunded.length, refundedValue: refunded.reduce((s, o) => s + Number(o.grand_total || 0), 0),
            exchangedCount: exchanged.length, exchangedValue: exchanged.reduce((s, o) => s + Number(o.grand_total || 0), 0),
            revokedCount: revoked.length,
            totalIssueValue,
            cancellationReasons: analyzeReasons(cancelled, "cancellation_reason"),
            returnReasons: analyzeReasons(returned, "return_reason"),
            refundReasons: analyzeReasons(refunded, "refund_reason"),
            exchangeReasons: analyzeReasons(exchanged, "exchange_reason"),
            saIssuesList,
        };
    }, [orders, timeline, customDateFrom, customDateTo]);

    // ═══════════════════════════════════════════════════════════
    // ACCOUNTS (line items)
    // ═══════════════════════════════════════════════════════════
    const accountsLineItems = useMemo(() => {
        const items = [];
        orders.forEach(order => {
            if (isLxrtsOrder(order)) return;
            (order.items || []).forEach((item, idx) => {
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

    const accountsStoreOptions = useMemo(() => [...new Set(accountsLineItems.map(i => i.store).filter(s => s && s !== "-"))].sort(), [accountsLineItems]);
    const accountsSAOptions = useMemo(() => [...new Set(accountsLineItems.map(i => i.sa_name).filter(s => s && s !== "-" && isPersonName(s)))].sort(), [accountsLineItems, knownStoreNames]);
    const accountsTotalPages = Math.ceil(filteredAccountItems.length / 20);
    const currentAccountItems = useMemo(() => filteredAccountItems.slice((accountsPage - 1) * 20, accountsPage * 20), [filteredAccountItems, accountsPage]);
    const accountsTotals = useMemo(() => ({
        gross: filteredAccountItems.reduce((sum, i) => sum + i.gross_value, 0),
        discount: filteredAccountItems.reduce((sum, i) => sum + i.discount, 0),
        taxable: filteredAccountItems.reduce((sum, i) => sum + i.taxable_value, 0),
        gst: filteredAccountItems.reduce((sum, i) => sum + i.gst, 0),
        invoice: filteredAccountItems.reduce((sum, i) => sum + i.invoice_value, 0),
    }), [filteredAccountItems]);

    // ═══════════════════════════════════════════════════════════
    // ORDERS TAB LOGIC
    // ═══════════════════════════════════════════════════════════
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
            result = result.filter(order => { const total = order.grand_total || order.net_total || 0; return total >= filters.minPrice && total <= filters.maxPrice; });
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
        const valid = orders.filter(o => !isLxrtsOrder(o));
        return {
            all: valid.length,
            unfulfilled: valid.filter(o => { const s = o.status?.toLowerCase(); return s !== "completed" && s !== "delivered" && s !== "cancelled"; }).length,
            prepared: valid.filter(o => o.status?.toLowerCase() === "completed").length,
            delivered: valid.filter(o => o.status?.toLowerCase() === "delivered").length,
            cancelled: valid.filter(o => o.status?.toLowerCase() === "cancelled").length,
        };
    }, [orders]);

    const ordersTotalPages = Math.ceil(filteredOrders.length / ITEMS_PER_PAGE);
    const currentOrders = useMemo(() => filteredOrders.slice((ordersPage - 1) * ITEMS_PER_PAGE, ordersPage * ITEMS_PER_PAGE), [filteredOrders, ordersPage]);

    const appliedFilters = useMemo(() => {
        const chips = [];
        if (filters.dateFrom || filters.dateTo) chips.push({ type: "date", label: `${filters.dateFrom || "..."} to ${filters.dateTo || "..."}` });
        if (filters.minPrice > 0 || filters.maxPrice < 500000) chips.push({ type: "price", label: `\u20B9${(filters.minPrice / 1000).toFixed(0)}K - \u20B9${(filters.maxPrice / 1000).toFixed(0)}K` });
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
    const toggleFilter = (category, value) => setFilters(prev => ({ ...prev, [category]: prev[category].includes(value) ? prev[category].filter(v => v !== value) : [...prev[category], value] }));

    const handleExportCSV = () => {
        if (filteredOrders.length === 0) return;
        const headers = ["Order No", "Product Name", "Customer Name", "Customer Number", "Size", "Amount", "SA Name", "Store", "Status", "Order Date", "Delivery Date"];
        const rows = filteredOrders.map(order => {
            const item = order.items?.[0] || {};
            return [order.order_no || "", item.product_name || "", order.delivery_name || "", order.delivery_phone || "",
                item.size || "", order.grand_total || 0, order.salesperson || "", order.salesperson_store || "",
                order.status || "", order.created_at ? new Date(order.created_at).toLocaleDateString("en-GB") : "",
                order.delivery_date ? new Date(order.delivery_date).toLocaleDateString("en-GB") : ""].map(v => `"${String(v).replace(/"/g, '""')}"`);
        });
        const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = `gm_orders_export_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
        URL.revokeObjectURL(url);
    };

    const handleGeneratePdf = async (order, type = "customer") => {
        setPdfLoading(order.id);
        try {
            if (type === "warehouse") await downloadWarehousePdf(order, null, true);
            else await downloadCustomerPdf(order);
        } catch (error) { console.error("PDF generation failed:", error); }
        finally { setPdfLoading(null); }
    };

    // Reset pages on filter change
    useEffect(() => { setOrdersPage(1); }, [orderSearch, statusTab, filters, sortBy]);
    useEffect(() => { setAccountsPage(1); }, [accountsSearch, accountsDateFrom, accountsDateTo, accountsStatus, accountsStore, accountsSA]);
    useEffect(() => { setB2bPage(1); }, [b2bSearch]);
    useEffect(() => { setInventoryPage(1); }, [inventorySearch]);

    const handleTimelineChange = (value) => {
        setTimeline(value);
        setShowCustomDatePicker(value === "custom");
    };

    // ═══════════════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════════════
    if (loading) {
        return (
            <div className="admin-page">
                <div className="admin-loading"><div className="admin-spinner"></div><p>Loading GM Dashboard...</p></div>
            </div>
        );
    }

    return (
        <div className="admin-page">
            {PopupComponent}

            {/* HEADER */}
            <header className="admin-header">
                <div className="admin-header-left">
                    <button className="admin-hamburger" onClick={() => setShowSidebar(!showSidebar)}><span></span><span></span><span></span></button>
                    <img src={Logo} alt="Logo" className="admin-logo" onClick={() => navigate("/login")} />
                </div>
                <h1 className="admin-title">GM Dashboard</h1>
                <div className="admin-header-right">
                    <NotificationBell userEmail={currentUserEmail} onOrderClick={() => {}} />
                    <button className="admin-logout-btn" onClick={handleLogout}>Logout</button>
                </div>
            </header>

            <div className="admin-layout">
                {/* SIDEBAR */}
                <aside className={`admin-sidebar ${showSidebar ? "open" : ""}`}>
                    <nav className="admin-nav">
                        <span className="nav-section-label">Dashboard</span>
                        <button className={`admin-nav-item ${activeTab === "store_performance" ? "active" : ""}`} onClick={() => { setActiveTab("store_performance"); setShowSidebar(false); }}>Store Performance</button>
                        <button className={`admin-nav-item ${activeTab === "day_sales" ? "active" : ""}`} onClick={() => { setActiveTab("day_sales"); setShowSidebar(false); }}>Day-wise Sales</button>
                        <button className={`admin-nav-item ${activeTab === "b2b_overview" ? "active" : ""}`} onClick={() => { setActiveTab("b2b_overview"); setShowSidebar(false); }}>B2B Overview</button>
                        <button className={`admin-nav-item ${activeTab === "inventory" ? "active" : ""}`} onClick={() => { setActiveTab("inventory"); setShowSidebar(false); }}>Inventory Health</button>
                        <button className={`admin-nav-item ${activeTab === "returns" ? "active" : ""}`} onClick={() => { setActiveTab("returns"); setShowSidebar(false); }}>Returns & Analytics</button>
                        <span className="nav-section-label" style={{ marginTop: '12px' }}>Operations</span>
                        <button className={`admin-nav-item ${activeTab === "orders" ? "active" : ""}`} onClick={() => { setActiveTab("orders"); setShowSidebar(false); }}>Orders</button>
                        <button className={`admin-nav-item ${activeTab === "accounts" ? "active" : ""}`} onClick={() => { setActiveTab("accounts"); setShowSidebar(false); }}>Accounts</button>
                    </nav>
                </aside>

                <main className="admin-main">

                    {/* ═══════════ TIMELINE CONTROLS (shown on dashboard tabs) ═══════════ */}
                    {["store_performance", "day_sales", "b2b_overview", "inventory", "returns"].includes(activeTab) && (
                        <div className="cmo-filters-bar">
                            <div className="cmo-timeline-group">
                                {TIMELINE_OPTIONS.map(opt => (
                                    <button key={opt.value} className={`cmo-pill ${timeline === opt.value ? "active" : ""}`} onClick={() => handleTimelineChange(opt.value)}>{opt.label}</button>
                                ))}
                            </div>
                            {activeTab === "store_performance" && (
                                <div className="cmo-compare-group">
                                    <select className="cmo-compare-select" value={comparison} onChange={(e) => setComparison(e.target.value)}>
                                        {COMPARISON_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                    </select>
                                </div>
                            )}
                            {showCustomDatePicker && (
                                <div className="cmo-date-range">
                                    <input type="date" value={customDateFrom} onChange={(e) => setCustomDateFrom(e.target.value)} />
                                    <span className="cmo-date-sep">\u2192</span>
                                    <input type="date" value={customDateTo} onChange={(e) => setCustomDateTo(e.target.value)} />
                                </div>
                            )}
                        </div>
                    )}

                    {/* ═══════════ TAB 1: STORE PERFORMANCE ═══════════ */}
                    {activeTab === "store_performance" && (
                        <div>
                            <h2 className="admin-section-title">Overall Store Performance</h2>

                            {/* Summary cards */}
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Total Revenue</span><span className="stat-value">{"\u20B9"}{formatIndianNumber(Math.round(storePerformanceStats.totalRevenue))}</span></div>
                                    {storePerformanceStats.showComparison && <span className={`stat-growth ${storePerformanceStats.revenueGrowth >= 0 ? "positive" : "negative"}`}>{storePerformanceStats.revenueGrowth >= 0 ? "\u25B2" : "\u25BC"} {Math.abs(storePerformanceStats.revenueGrowth).toFixed(1)}%</span>}</div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Total Orders</span><span className="stat-value">{storePerformanceStats.totalOrders}</span></div>
                                    {storePerformanceStats.showComparison && <span className={`stat-growth ${storePerformanceStats.ordersGrowth >= 0 ? "positive" : "negative"}`}>{storePerformanceStats.ordersGrowth >= 0 ? "\u25B2" : "\u25BC"} {Math.abs(storePerformanceStats.ordersGrowth).toFixed(1)}%</span>}</div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">AOV</span><span className="stat-value">{"\u20B9"}{formatIndianNumber(Math.round(storePerformanceStats.aov))}</span></div></div>
                            </div>

                            {/* Store-wise sales chart */}
                            <h3 className="admin-subsection-title">Store-wise Revenue & Growth</h3>
                            {storePerformanceStats.storeGrowth.length > 0 ? (
                                <div className="admin-chart-container">
                                    <ResponsiveContainer width="100%" height={300}>
                                        <BarChart data={storePerformanceStats.storeGrowth}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                                            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                                            <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `\u20B9${(v / 1000).toFixed(0)}K`} />
                                            <Tooltip content={<ChartTooltip />} />
                                            <Bar dataKey="revenue" fill="#d5b85a" name="Revenue" radius={[4, 4, 0, 0]} />
                                            {storePerformanceStats.showComparison && <Bar dataKey="prevRevenue" fill="#BDB76B" name="Previous" radius={[4, 4, 0, 0]} />}
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : <p className="no-data">No store data available</p>}

                            {/* SA-wise breakdown */}
                            <h3 className="admin-subsection-title" style={{ marginTop: 24 }}>SA-wise Performance</h3>
                            <div style={{ marginBottom: 12 }}>
                                <select className="cmo-compare-select" value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}>
                                    <option value="all">All Stores</option>
                                    {storePerformanceStats.storeBreakdown.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                                </select>
                            </div>
                            <div className="admin-table-wrapper">
                                <div className="admin-table-container">
                                    <table className="admin-table">
                                        <thead><tr><th>SA Name</th><th>Store</th><th className="amount">Revenue</th><th>Orders</th><th>Items</th><th className="amount">Discount</th><th className="amount">Avg Order</th></tr></thead>
                                        <tbody>
                                            {storePerformanceStats.saBreakdown.length === 0 ? <tr><td colSpan="7" className="no-data">No data</td></tr> :
                                                storePerformanceStats.saBreakdown.map(sa => (
                                                    <tr key={sa.name}>
                                                        <td>{sa.name}</td>
                                                        <td>{sa.store}</td>
                                                        <td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(sa.revenue))}</td>
                                                        <td>{sa.orders}</td>
                                                        <td>{sa.items}</td>
                                                        <td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(sa.discount))}</td>
                                                        <td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(sa.orders > 0 ? sa.revenue / sa.orders : 0))}</td>
                                                    </tr>
                                                ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Staff Productivity */}
                            <h3 className="admin-subsection-title" style={{ marginTop: 24 }}>Staff Productivity (Orders per Store)</h3>
                            <div className="admin-stats-grid">
                                {storePerformanceStats.staffProductivity.map(sp => (
                                    <div className="admin-stat-card" key={sp.name}>
                                        <div className="stat-info">
                                            <span className="stat-label">{sp.name}</span>
                                            <span className="stat-value">{sp.ordersPerStaff} orders/SA</span>
                                        </div>
                                        <span className="stat-sublabel">{sp.orders} orders {"\u00B7"} {sp.staff} staff</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ═══════════ TAB 2: DAY-WISE SALES ═══════════ */}
                    {activeTab === "day_sales" && (
                        <div>
                            <h2 className="admin-section-title">Day-wise Sales</h2>

                            {dayWiseSales.length > 0 ? (
                                <>
                                    <div className="admin-chart-container">
                                        <ResponsiveContainer width="100%" height={350}>
                                            <AreaChart data={dayWiseSales}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                                                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                                                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `\u20B9${(v / 1000).toFixed(0)}K`} />
                                                <Tooltip content={<ChartTooltip />} />
                                                <Legend />
                                                <Area type="monotone" dataKey="revenue" stroke="#d5b85a" fill="#d5b85a" fillOpacity={0.15} name="Total Revenue" />
                                                <Area type="monotone" dataKey="delhiRevenue" stroke="#1565c0" fill="#1565c0" fillOpacity={0.1} name="Delhi" />
                                                <Area type="monotone" dataKey="ludhianaRevenue" stroke="#2e7d32" fill="#2e7d32" fillOpacity={0.1} name="Ludhiana" />
                                                <Area type="monotone" dataKey="b2bRevenue" stroke="#7b1fa2" fill="#7b1fa2" fillOpacity={0.1} name="B2B" />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>

                                    {/* Day-wise table */}
                                    <div className="admin-table-wrapper" style={{ marginTop: 20 }}>
                                        <div className="admin-table-container">
                                            <table className="admin-table">
                                                <thead><tr><th>Date</th><th className="amount">Total Revenue</th><th>Orders</th><th className="amount">Delhi</th><th className="amount">Ludhiana</th><th className="amount">B2B</th><th className="amount">AOV</th></tr></thead>
                                                <tbody>
                                                    {dayWiseSales.map(d => (
                                                        <tr key={d.fullDate}>
                                                            <td>{d.date}</td>
                                                            <td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(d.revenue))}</td>
                                                            <td>{d.orders}</td>
                                                            <td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(d.delhiRevenue))}</td>
                                                            <td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(d.ludhianaRevenue))}</td>
                                                            <td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(d.b2bRevenue))}</td>
                                                            <td className="amount">{"\u20B9"}{formatIndianNumber(d.orders > 0 ? Math.round(d.revenue / d.orders) : 0)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </>
                            ) : <p className="no-data">No sales data for this period</p>}
                        </div>
                    )}

                    {/* ═══════════ TAB 3: B2B OVERVIEW ═══════════ */}
                    {activeTab === "b2b_overview" && (
                        <div>
                            <h2 className="admin-section-title">B2B Overview</h2>

                            <div className="admin-stats-grid">
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">B2B Revenue</span><span className="stat-value">{"\u20B9"}{formatIndianNumber(Math.round(b2bStats.totalB2bRevenue))}</span></div>
                                    <span className={`stat-growth ${b2bStats.revenueGrowth >= 0 ? "positive" : "negative"}`}>{b2bStats.revenueGrowth >= 0 ? "\u25B2" : "\u25BC"} {Math.abs(b2bStats.revenueGrowth).toFixed(1)}%</span></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">B2B Orders</span><span className="stat-value">{b2bStats.totalB2bOrders}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">B2B Contribution</span><span className="stat-value">{b2bStats.b2bContribution}%</span></div></div>
                            </div>

                            {/* Order type breakdown */}
                            <h3 className="admin-subsection-title">Buyout vs Consignment Split</h3>
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Buyout</span><span className="stat-value">{b2bStats.buyoutCount} orders</span></div><span className="stat-sublabel">{"\u20B9"}{formatIndianNumber(Math.round(b2bStats.buyoutValue))}</span></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Consignment</span><span className="stat-value">{b2bStats.consignmentCount} orders</span></div><span className="stat-sublabel">{"\u20B9"}{formatIndianNumber(Math.round(b2bStats.consignmentValue))}</span></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Client Order</span><span className="stat-value">{b2bStats.clientOrderCount} orders</span></div><span className="stat-sublabel">{"\u20B9"}{formatIndianNumber(Math.round(b2bStats.clientOrderValue))}</span></div>
                            </div>

                            {/* Client sales */}
                            <h3 className="admin-subsection-title" style={{ marginTop: 24 }}>Client-wise Sales</h3>
                            <div className="admin-search-wrapper" style={{ maxWidth: 300, marginBottom: 12 }}>
                                <input type="text" placeholder="Search client..." value={b2bSearch} onChange={(e) => setB2bSearch(e.target.value)} className="admin-search-input" />
                            </div>
                            <div className="admin-table-wrapper">
                                <div className="admin-table-container">
                                    <table className="admin-table">
                                        <thead><tr><th>Client</th><th className="amount">Sales</th><th>Orders</th><th className="amount">Advance</th><th className="amount">Balance</th></tr></thead>
                                        <tbody>
                                            {b2bStats.currentB2bClients.length === 0 ? <tr><td colSpan="5" className="no-data">No B2B clients found</td></tr> :
                                                b2bStats.currentB2bClients.map(c => (
                                                    <tr key={c.name}>
                                                        <td>{c.name}</td>
                                                        <td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(c.sales))}</td>
                                                        <td>{c.orders}</td>
                                                        <td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(c.advance))}</td>
                                                        <td className="amount" style={{ color: c.balance > 0 ? '#c62828' : '#2e7d32' }}>{"\u20B9"}{formatIndianNumber(Math.round(c.balance))}</td>
                                                    </tr>
                                                ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            {b2bStats.b2bTotalPages > 1 && (
                                <div className="admin-pagination">
                                    <button onClick={() => setB2bPage(p => Math.max(1, p - 1))} disabled={b2bPage === 1}>Prev</button>
                                    <span>Page {b2bPage} of {b2bStats.b2bTotalPages}</span>
                                    <button onClick={() => setB2bPage(p => Math.min(b2bStats.b2bTotalPages, p + 1))} disabled={b2bPage === b2bStats.b2bTotalPages}>Next</button>
                                </div>
                            )}

                            {/* Top B2B products */}
                            {b2bStats.topB2bProducts.length > 0 && (
                                <>
                                    <h3 className="admin-subsection-title" style={{ marginTop: 24 }}>Top B2B Products</h3>
                                    <div className="admin-chart-container">
                                        <ResponsiveContainer width="100%" height={300}>
                                            <BarChart data={b2bStats.topB2bProducts} layout="vertical">
                                                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                                                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `\u20B9${(v / 1000).toFixed(0)}K`} />
                                                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={150} />
                                                <Tooltip content={<ChartTooltip />} />
                                                <Bar dataKey="revenue" fill="#d5b85a" name="Revenue" radius={[0, 4, 4, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </>
                            )}

                            {/* Advance pending */}
                            {b2bStats.advancePending.length > 0 && (
                                <>
                                    <h3 className="admin-subsection-title" style={{ marginTop: 24 }}>{"\u26A0\uFE0F"} Advance Pending Clients</h3>
                                    <div className="admin-table-wrapper">
                                        <div className="admin-table-container">
                                            <table className="admin-table">
                                                <thead><tr><th>Client</th><th className="amount">Total Sales</th><th className="amount">Advance Paid</th><th className="amount">Balance Due</th></tr></thead>
                                                <tbody>
                                                    {b2bStats.advancePending.slice(0, 10).map(c => (
                                                        <tr key={c.name}>
                                                            <td>{c.name}</td>
                                                            <td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(c.sales))}</td>
                                                            <td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(c.advance))}</td>
                                                            <td className="amount" style={{ color: '#c62828', fontWeight: 600 }}>{"\u20B9"}{formatIndianNumber(Math.round(c.balance))}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* ═══════════ TAB 4: INVENTORY HEALTH ═══════════ */}
                    {activeTab === "inventory" && (
                        <div>
                            <h2 className="admin-section-title">Inventory Health</h2>

                            <div className="admin-stats-grid">
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Total Products</span><span className="stat-value">{inventoryStats.total}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Total Stock</span><span className="stat-value">{formatIndianNumber(inventoryStats.totalInventory)}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Low Stock</span><span className="stat-value" style={{ color: '#ef6c00' }}>{inventoryStats.lowStock}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Out of Stock</span><span className="stat-value" style={{ color: '#c62828' }}>{inventoryStats.outOfStock}</span></div></div>
                            </div>

                            {/* Stock vs Sales */}
                            <h3 className="admin-subsection-title">Stock vs Sales (Period)</h3>
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Current Stock</span><span className="stat-value">{formatIndianNumber(inventoryStats.totalInventory)} pcs</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Sold (Period)</span><span className="stat-value">{formatIndianNumber(inventoryStats.soldQty)} pcs</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Stock-to-Sales Ratio</span><span className="stat-value">{inventoryStats.soldQty > 0 ? (inventoryStats.totalInventory / inventoryStats.soldQty).toFixed(1) : "\u221E"}x</span></div></div>
                            </div>

                            {/* Consignment */}
                            <h3 className="admin-subsection-title" style={{ marginTop: 24 }}>Consignment Inventory</h3>
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Total Sent</span><span className="stat-value">{inventoryStats.totalConsignmentPieces}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Sold</span><span className="stat-value" style={{ color: '#2e7d32' }}>{inventoryStats.soldConsignment}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Remaining</span><span className="stat-value">{inventoryStats.remainingConsignment}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Lost</span><span className="stat-value" style={{ color: '#c62828' }}>{inventoryStats.lostConsignment}</span></div></div>
                            </div>

                            {/* Product list */}
                            <h3 className="admin-subsection-title" style={{ marginTop: 24 }}>Product Inventory</h3>
                            <div className="admin-search-wrapper" style={{ maxWidth: 300, marginBottom: 12 }}>
                                <input type="text" placeholder="Search product or SKU..." value={inventorySearch} onChange={(e) => setInventorySearch(e.target.value)} className="admin-search-input" />
                            </div>
                            <div className="admin-table-wrapper">
                                <div className="admin-table-container">
                                    <table className="admin-table">
                                        <thead><tr><th>Product</th><th>SKU</th><th>Type</th><th>Stock</th></tr></thead>
                                        <tbody>
                                            {inventoryStats.currentProducts.length === 0 ? <tr><td colSpan="4" className="no-data">No products found</td></tr> :
                                                inventoryStats.currentProducts.map(p => {
                                                    const qty = p.sync_enabled ? getLxrtsTotalInventory(p.id) : (p.inventory || 0);
                                                    return (
                                                        <tr key={p.id}>
                                                            <td>{p.name || "-"}</td>
                                                            <td>{p.sku_id || "-"}</td>
                                                            <td>{p.sync_enabled ? "LXRTS" : (p.inventory === 9999 ? "MTO" : "Regular")}</td>
                                                            <td><span className={qty === 0 ? "admin-stock-out" : qty < 5 ? "admin-stock-low" : "admin-stock-ok"}>{qty === 9999 ? "MTO" : qty}</span></td>
                                                        </tr>
                                                    );
                                                })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            {inventoryStats.inventoryTotalPages > 1 && (
                                <div className="admin-pagination">
                                    <button onClick={() => setInventoryPage(p => Math.max(1, p - 1))} disabled={inventoryPage === 1}>Prev</button>
                                    <span>Page {inventoryPage} of {inventoryStats.inventoryTotalPages}</span>
                                    <button onClick={() => setInventoryPage(p => Math.min(inventoryStats.inventoryTotalPages, p + 1))} disabled={inventoryPage === inventoryStats.inventoryTotalPages}>Next</button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ═══════════ TAB 5: RETURNS & ANALYTICS ═══════════ */}
                    {activeTab === "returns" && (
                        <div>
                            <h2 className="admin-section-title">Returns, Cancellations & Analytics</h2>

                            <div className="admin-stats-grid">
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Cancellations</span><span className="stat-value">{returnsAnalytics.cancelledCount}</span></div><span className="stat-sublabel">{"\u20B9"}{formatIndianNumber(Math.round(returnsAnalytics.cancelledValue))}</span></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Returns</span><span className="stat-value">{returnsAnalytics.returnedCount}</span></div><span className="stat-sublabel">{"\u20B9"}{formatIndianNumber(Math.round(returnsAnalytics.returnedValue))}</span></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Refunds</span><span className="stat-value">{returnsAnalytics.refundedCount}</span></div><span className="stat-sublabel">{"\u20B9"}{formatIndianNumber(Math.round(returnsAnalytics.refundedValue))}</span></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Exchanges</span><span className="stat-value">{returnsAnalytics.exchangedCount}</span></div><span className="stat-sublabel">{"\u20B9"}{formatIndianNumber(Math.round(returnsAnalytics.exchangedValue))}</span></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Revoked</span><span className="stat-value">{returnsAnalytics.revokedCount}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Total Issue Value</span><span className="stat-value" style={{ color: '#c62828' }}>{"\u20B9"}{formatIndianNumber(Math.round(returnsAnalytics.totalIssueValue))}</span></div></div>
                            </div>

                            {/* Reason charts */}
                            {returnsAnalytics.cancellationReasons.length > 0 && (
                                <>
                                    <h3 className="admin-subsection-title" style={{ marginTop: 24 }}>Cancellation Reasons</h3>
                                    <div className="admin-chart-container">
                                        <ResponsiveContainer width="100%" height={250}>
                                            <BarChart data={returnsAnalytics.cancellationReasons.slice(0, 8)} layout="vertical">
                                                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                                                <XAxis type="number" />
                                                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={180} />
                                                <Tooltip />
                                                <Bar dataKey="value" fill="#f44336" name="Count" radius={[0, 4, 4, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </>
                            )}

                            {returnsAnalytics.returnReasons.length > 0 && (
                                <>
                                    <h3 className="admin-subsection-title" style={{ marginTop: 24 }}>Return Reasons</h3>
                                    <div className="admin-chart-container">
                                        <ResponsiveContainer width="100%" height={250}>
                                            <BarChart data={returnsAnalytics.returnReasons.slice(0, 8)} layout="vertical">
                                                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                                                <XAxis type="number" />
                                                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={180} />
                                                <Tooltip />
                                                <Bar dataKey="value" fill="#ff9800" name="Count" radius={[0, 4, 4, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </>
                            )}

                            {returnsAnalytics.refundReasons.length > 0 && (
                                <>
                                    <h3 className="admin-subsection-title" style={{ marginTop: 24 }}>Refund Reasons</h3>
                                    <div className="admin-chart-container">
                                        <ResponsiveContainer width="100%" height={250}>
                                            <BarChart data={returnsAnalytics.refundReasons.slice(0, 8)} layout="vertical">
                                                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                                                <XAxis type="number" />
                                                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={180} />
                                                <Tooltip />
                                                <Bar dataKey="value" fill="#9c27b0" name="Count" radius={[0, 4, 4, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </>
                            )}

                            {returnsAnalytics.exchangeReasons.length > 0 && (
                                <>
                                    <h3 className="admin-subsection-title" style={{ marginTop: 24 }}>Exchange Reasons</h3>
                                    <div className="admin-chart-container">
                                        <ResponsiveContainer width="100%" height={250}>
                                            <BarChart data={returnsAnalytics.exchangeReasons.slice(0, 8)} layout="vertical">
                                                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                                                <XAxis type="number" />
                                                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={180} />
                                                <Tooltip />
                                                <Bar dataKey="value" fill="#1565c0" name="Count" radius={[0, 4, 4, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </>
                            )}

                            {/* SA-wise issues */}
                            {returnsAnalytics.saIssuesList.length > 0 && (
                                <>
                                    <h3 className="admin-subsection-title" style={{ marginTop: 24 }}>SA-wise Issue Breakdown</h3>
                                    <div className="admin-table-wrapper">
                                        <div className="admin-table-container">
                                            <table className="admin-table">
                                                <thead><tr><th>SA Name</th><th>Cancellations</th><th>Returns</th><th>Refunds</th><th>Exchanges</th><th>Revokes</th><th className="amount">Value</th></tr></thead>
                                                <tbody>
                                                    {returnsAnalytics.saIssuesList.map(sa => (
                                                        <tr key={sa.name}>
                                                            <td>{sa.name}</td>
                                                            <td>{sa.cancellations || 0}</td>
                                                            <td>{sa.returns || 0}</td>
                                                            <td>{sa.refunds || 0}</td>
                                                            <td>{sa.exchanges || 0}</td>
                                                            <td>{sa.revokes || 0}</td>
                                                            <td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(sa.totalValue))}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* ═══════════ TAB 6: ORDERS ═══════════ */}
                    {activeTab === "orders" && (
                        <div className="admin-orders-tab">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                                <h2 className="admin-section-title">Order Management</h2>
                                <button className="admin-export-btn" onClick={() => navigate("/order")} style={{ background: '#d5b85a', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>
                                    + Place Order
                                </button>
                            </div>

                            <div className="admin-toolbar">
                                <div className="admin-search-wrapper">
                                    <span className="search-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg></span>
                                    <input type="text" placeholder="Search Order #, Customer, Phone..." value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} className="admin-search-input" />
                                    {orderSearch && <button className="search-clear" onClick={() => setOrderSearch("")}>{"\u00D7"}</button>}
                                </div>
                                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="admin-sort-select">
                                    <option value="newest">Newest First</option><option value="oldest">Oldest First</option><option value="delivery">Delivery Date</option><option value="amount_high">Amount: High to Low</option><option value="amount_low">Amount: Low to High</option>
                                </select>
                                <button className="admin-export-btn" onClick={handleExportCSV} title="Export CSV">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                    Export CSV
                                </button>
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
                                    <button className={`filter-btn ${(filters.dateFrom || filters.dateTo) ? "active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "date" ? null : "date")}>Date Range {"\u25BE"}</button>
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
                                    <button className={`filter-btn ${filters.payment.length > 0 ? "active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "payment" ? null : "payment")}>Payment {"\u25BE"}</button>
                                    {openDropdown === "payment" && (
                                        <div className="dropdown-panel">
                                            <div className="dropdown-title">Payment Status</div>
                                            {["paid", "partial", "unpaid"].map(opt => (<label key={opt} className="checkbox-label"><input type="checkbox" checked={filters.payment.includes(opt)} onChange={() => toggleFilter("payment", opt)} /><span>{opt === "unpaid" ? "Unpaid (COD)" : opt.charAt(0).toUpperCase() + opt.slice(1)}</span></label>))}
                                            <button className="dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>
                                <div className="filter-dropdown">
                                    <button className={`filter-btn ${filters.store.length > 0 ? "active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "store" ? null : "store")}>Store {"\u25BE"}</button>
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
                                    {appliedFilters.map((chip, i) => (<span key={i} className="filter-chip">{chip.label}<button onClick={() => removeFilter(chip.type, chip.value)}>{"\u00D7"}</button></span>))}
                                    <button className="clear-all" onClick={clearAllFilters}>Clear All</button>
                                </div>
                            )}

                            <div className="orders-count">Showing {filteredOrders.length} orders</div>

                            <div className="admin-table-wrapper">
                                <div className="admin-table-container">
                                    <table className="admin-table orders-table">
                                        <thead><tr><th>Order ID</th><th>Customer</th><th>Product</th><th>Amount</th><th>Payment</th><th>Status</th><th>SA</th><th>Store</th><th>Date</th><th>Journey</th><th>Actions</th></tr></thead>
                                        <tbody>
                                            {currentOrders.length === 0 ? <tr><td colSpan="11" className="no-data">No orders found</td></tr> :
                                                currentOrders.map(order => {
                                                    const isUrgent = getPriority(order) === "urgent";
                                                    return (
                                                        <tr key={order.id} className={isUrgent ? "urgent-row" : ""}>
                                                            <td><span className="order-id">{order.order_no || "-"}</span>{isUrgent && <span className="urgent-badge">URGENT</span>}</td>
                                                            <td>{order.delivery_name || "-"}</td>
                                                            <td className="product-cell">{order.items?.[0]?.product_name || "-"}</td>
                                                            <td>{"\u20B9"}{formatIndianNumber(order.grand_total || 0)}</td>
                                                            <td><span className={`payment-badge ${getPaymentStatus(order)}`}>{getPaymentStatus(order).charAt(0).toUpperCase() + getPaymentStatus(order).slice(1)}</span></td>
                                                            <td><span className={`status-badge ${order.status}`}>{order.status || "pending"}</span></td>
                                                            <td>{getOrderSalesperson(order) || "-"}</td>
                                                            <td>{order.salesperson_store || "-"}</td>
                                                            <td>{formatDate(order.created_at)}</td>
                                                            <td>
                                                                <div style={{ fontSize: 11, lineHeight: 1.4 }}>
                                                                    {order.in_production_at && <div>{"\u2705"} Production: {formatDate(order.in_production_at)}</div>}
                                                                    {order.ready_for_dispatch_at && <div>{"\u2705"} Ready: {formatDate(order.ready_for_dispatch_at)}</div>}
                                                                    {order.dispatched_at && <div>{"\u2705"} Dispatched: {formatDate(order.dispatched_at)}</div>}
                                                                    {order.delivered_at && <div>{"\u2705"} Delivered: {formatDate(order.delivered_at)}</div>}
                                                                    {!order.in_production_at && !order.dispatched_at && !order.delivered_at && <span style={{ color: '#999' }}>Pending</span>}
                                                                </div>
                                                            </td>
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

                    {/* ═══════════ TAB 7: ACCOUNTS ═══════════ */}
                    {activeTab === "accounts" && (
                        <div className="admin-accounts-tab">
                            <h2 className="admin-section-title">Accounts & Finance</h2>
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Gross Value</span><span className="stat-value">{"\u20B9"}{formatIndianNumber(accountsTotals.gross.toFixed(0))}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Total Discount</span><span className="stat-value">{"\u20B9"}{formatIndianNumber(accountsTotals.discount.toFixed(0))}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Total GST</span><span className="stat-value">{"\u20B9"}{formatIndianNumber(accountsTotals.gst.toFixed(0))}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Invoice Value</span><span className="stat-value">{"\u20B9"}{formatIndianNumber(accountsTotals.invoice.toFixed(0))}</span></div></div>
                            </div>

                            <div className="acc-filter-bar">
                                <div className="admin-search-wrapper" style={{ flex: '0 0 auto', maxWidth: 280 }}>
                                    <span className="search-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg></span>
                                    <input type="text" placeholder="Search Order, Customer..." value={accountsSearch} onChange={(e) => setAccountsSearch(e.target.value)} className="admin-search-input" />
                                </div>
                                <div className="cmo-date-range">
                                    <input type="date" value={accountsDateFrom} onChange={(e) => setAccountsDateFrom(e.target.value)} />
                                    <span className="cmo-date-sep">{"\u2192"}</span>
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
                                                        <td className="amount">{"\u20B9"}{formatIndianNumber(item.gross_value)}</td>
                                                        <td className="amount">{"\u20B9"}{formatIndianNumber(item.discount)}</td>
                                                        <td className="amount">{"\u20B9"}{formatIndianNumber(item.taxable_value)}</td>
                                                        <td className="amount">{"\u20B9"}{formatIndianNumber(item.gst)}</td>
                                                        <td className="amount invoice">{"\u20B9"}{formatIndianNumber(item.invoice_value)}</td>
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

                </main>
            </div>
        </div>
    );
}