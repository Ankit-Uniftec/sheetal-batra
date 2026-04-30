import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./RetailManagerDashboard.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell, LineChart, Line, AreaChart, Area
} from "recharts";

// Timeline options
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

const STATUS_TABS = [
    { value: "all", label: "All Orders" },
    { value: "unfulfilled", label: "Unfulfilled" },
    { value: "prepared", label: "Prepared" },
    { value: "delivered", label: "Delivered" },
    { value: "cancelled", label: "Cancelled" },
];

const ITEMS_PER_PAGE = 15;

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
    "sage": "#9caf88", "sage green": "#9caf88", "olive": "#6b8e23",
    "mint": "#98fb98", "forest green": "#228b22",
    "sky blue": "#87ceeb", "royal blue": "#4169e1", "powder blue": "#b0c4de",
    "taupe": "#8b8378", "tan": "#d2b48c", "camel": "#c19a6b", "khaki": "#c3b091",
    "charcoal": "#36454f", "off white": "#faf0e6", "off-white": "#faf0e6",
    "magenta": "#c2185b", "lilac": "#c8a2c8", "plum": "#8e4585", "mauve": "#e0b0ff",
    "copper": "#b87333", "rose": "#e8a0bf", "rose gold": "#b76e79", "emerald": "#50c878",
    "aqua": "#00bcd4", "indigo": "#3f51b5", "mustard": "#e1ad01",
    "nude": "#e3bc9a", "champagne": "#f7e7ce", "sand": "#c2b280", "slate": "#708090",
    "denim": "#1560bd", "cobalt": "#0047ab", "fuchsia": "#ff00ff",
    "scarlet": "#ff2400", "crimson": "#dc143c",
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
    return `hsl(${Math.abs(hash) % 360}, 55%, 50%)`;
};

// Wrapped axis tick for colour bars
const WrappedAxisTick = ({ x, y, payload }) => {
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
    if (lines.length > 2) { lines.length = 2; lines[1] = lines[1].substring(0, 10) + "\u2026"; }
    return (
        <g transform={`translate(${x},${y})`}>
            {lines.map((line, i) => (
                <text key={i} x={0} y={i * 14 + 8} textAnchor="middle" fill="#666" fontSize={11} fontFamily="inherit">{line}</text>
            ))}
        </g>
    );
};

// Growth Indicator
const GrowthIndicator = ({ value }) => {
    if (value === 0 || isNaN(value)) return null;
    const isPositive = value > 0;
    return (
        <span className={`growth-indicator ${isPositive ? 'positive' : 'negative'}`}>
            <span className="growth-arrow">{isPositive ? '\u2191' : '\u2193'}</span>
            {Math.abs(value).toFixed(1)}%
        </span>
    );
};

export default function RetailManagerDashboard() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [orders, setOrders] = useState([]);
    const [products, setProducts] = useState([]);
    const [activeTab, setActiveTab] = useState("store_analytics");
    const [showSidebar, setShowSidebar] = useState(false);

    // Timeline
    const [timeline, setTimeline] = useState("monthly");
    const [comparison, setComparison] = useState("none");
    const [customDateFrom, setCustomDateFrom] = useState("");
    const [customDateTo, setCustomDateTo] = useState("");
    const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);

    // Product analytics timeline
    const [analyticsTimeline, setAnalyticsTimeline] = useState("monthly");
    const [analyticsCustomFrom, setAnalyticsCustomFrom] = useState("");
    const [analyticsCustomTo, setAnalyticsCustomTo] = useState("");
    const [showAnalyticsCustomPicker, setShowAnalyticsCustomPicker] = useState(false);

    // Day-wise tab
    const [dayWiseStore, setDayWiseStore] = useState("all");

    // Orders tab
    const [orderSearch, setOrderSearch] = useState("");
    const [statusTab, setStatusTab] = useState("all");
    const [sortBy, setSortBy] = useState("newest");
    const [ordersPage, setOrdersPage] = useState(1);
    const [filters, setFilters] = useState({
        dateFrom: "", dateTo: "", minPrice: 0, maxPrice: 500000,
        payment: [], priority: [], orderType: [], store: [], salesperson: ""
    });
    const [openDropdown, setOpenDropdown] = useState(null);
    const dropdownRef = useRef(null);

    // ═══════════════════════════════════════════════════════════
    // AUTH & DATA FETCH
    // ═══════════════════════════════════════════════════════════
    useEffect(() => {
        const checkAuthAndFetch = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) { navigate("/login", { replace: true }); return; }

            const { data: userRecord } = await supabase
                .from("salesperson")
                .select("role")
                .eq("email", session.user.email?.toLowerCase())
                .single();

            if (!userRecord || userRecord.role !== "retail_manager") {
                await supabase.auth.signOut();
                navigate("/login", { replace: true });
                return;
            }
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

    // ═══════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════
    const isLxrtsOrder = (order) => order.items?.[0]?.sync_enabled === true;

    const getOrderChannel = (order) => {
        if (isLxrtsOrder(order)) return "Website (LXRTS)";
        const store = (order.salesperson_store || "").trim();
        if (!store) return "Other";
        if (store.toLowerCase() === "b2b") return "B2B";
        return store;
    };

    // ★ CORE FILTER: exclude B2B from everything
    const retailOrders = useMemo(() => {
        return orders.filter(o => getOrderChannel(o) !== "B2B");
    }, [orders]);

    const getOrderSalesperson = (order) => order.salesperson || null;

    const knownStoreNames = useMemo(() => {
        const stores = new Set();
        retailOrders.forEach(o => {
            const s = (o.salesperson_store || "").trim();
            if (s) stores.add(s);
        });
        return stores;
    }, [retailOrders]);

    const isPersonName = (name) => {
        if (!name || name === "-" || name === "Unknown") return false;
        return !knownStoreNames.has(name);
    };

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

    // ═══════════════════════════════════════════════════════════
    // DATE RANGE HELPERS
    // ═══════════════════════════════════════════════════════════
    const getDateRange = (timelineValue) => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        switch (timelineValue) {
            case "today": return { start: today, end: now };
            case "yesterday": {
                const y = new Date(today); y.setDate(y.getDate() - 1);
                const ye = new Date(today); ye.setMilliseconds(-1);
                return { start: y, end: ye };
            }
            case "weekly": { const w = new Date(today); w.setDate(w.getDate() - 7); return { start: w, end: now }; }
            case "monthly": { const m = new Date(today); m.setDate(m.getDate() - 30); return { start: m, end: now }; }
            case "yearly": { const yr = new Date(today); yr.setDate(yr.getDate() - 365); return { start: yr, end: now }; }
            case "custom": return {
                start: customDateFrom ? new Date(customDateFrom) : new Date(0),
                end: customDateTo ? new Date(customDateTo + "T23:59:59") : now
            };
            default: return { start: today, end: now };
        }
    };

    const getComparisonDateRange = (timelineValue, comparisonType) => {
        const currentRange = getDateRange(timelineValue);
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (comparisonType === "previous_year") {
            const s = new Date(currentRange.start); s.setFullYear(s.getFullYear() - 1);
            const e = new Date(currentRange.end); e.setFullYear(e.getFullYear() - 1);
            return { start: s, end: e };
        }
        if (comparisonType !== "previous_period") return null;
        switch (timelineValue) {
            case "today": { const y = new Date(today); y.setDate(y.getDate() - 1); const ye = new Date(today); ye.setMilliseconds(-1); return { start: y, end: ye }; }
            case "yesterday": { const t = new Date(today); t.setDate(t.getDate() - 2); const te = new Date(today); te.setDate(te.getDate() - 1); te.setMilliseconds(-1); return { start: t, end: te }; }
            case "weekly": { const a = new Date(today); a.setDate(a.getDate() - 14); const b = new Date(today); b.setDate(b.getDate() - 7); b.setMilliseconds(-1); return { start: a, end: b }; }
            case "monthly": { const a = new Date(today); a.setDate(a.getDate() - 60); const b = new Date(today); b.setDate(b.getDate() - 30); b.setMilliseconds(-1); return { start: a, end: b }; }
            case "yearly": { const a = new Date(today); a.setDate(a.getDate() - 730); const b = new Date(today); b.setDate(b.getDate() - 365); b.setMilliseconds(-1); return { start: a, end: b }; }
            case "custom": {
                if (customDateFrom && customDateTo) {
                    const cs = new Date(customDateFrom); const ce = new Date(customDateTo + "T23:59:59");
                    const dur = ce - cs; const pe = new Date(cs); pe.setMilliseconds(-1); const ps = new Date(pe - dur);
                    return { start: ps, end: pe };
                }
                return null;
            }
            default: return null;
        }
    };

    const filterByDateRange = (list, range) => {
        if (!range) return list;
        return list.filter(o => { const d = new Date(o.created_at); return d >= range.start && d <= range.end; });
    };

    const calcGrowth = (cur, prev) => { if (prev === 0) return cur > 0 ? 100 : 0; return ((cur - prev) / prev) * 100; };

    const getAnalyticsDateRange = (tv) => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        switch (tv) {
            case "today": return { start: today, end: now };
            case "yesterday": { const y = new Date(today); y.setDate(y.getDate() - 1); const ye = new Date(today); ye.setMilliseconds(-1); return { start: y, end: ye }; }
            case "weekly": { const w = new Date(today); w.setDate(w.getDate() - 7); return { start: w, end: now }; }
            case "monthly": { const m = new Date(today); m.setDate(m.getDate() - 30); return { start: m, end: now }; }
            case "yearly": { const yr = new Date(today); yr.setDate(yr.getDate() - 365); return { start: yr, end: now }; }
            case "custom": return {
                start: analyticsCustomFrom ? new Date(analyticsCustomFrom) : new Date(0),
                end: analyticsCustomTo ? new Date(analyticsCustomTo + "T23:59:59") : now
            };
            default: return { start: today, end: now };
        }
    };

    // ═══════════════════════════════════════════════════════════
    // TAB 1: STORE ANALYTICS (no B2B)
    // ═══════════════════════════════════════════════════════════
    const dashboardStats = useMemo(() => {
        const dateRange = getDateRange(timeline);
        const compRange = getComparisonDateRange(timeline, comparison);
        const cur = filterByDateRange(retailOrders, dateRange);
        const prev = compRange ? filterByDateRange(retailOrders, compRange) : [];

        const totalRevenue = cur.reduce((s, o) => s + Number(o.grand_total || 0), 0);
        const totalOrders = cur.length;
        const deliveredOrders = cur.filter(o => o.status === "delivered").length;
        const prevRevenue = prev.reduce((s, o) => s + Number(o.grand_total || 0), 0);
        const prevOrders = prev.length;
        const prevDelivered = prev.filter(o => o.status === "delivered").length;

        const totalItems = cur.reduce((s, o) => s + (o.items?.reduce((q, it) => q + (it.quantity || 1), 0) || 0), 0);
        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

        // Channel breakdown (no B2B since retailOrders already filtered)
        const channelMap = {};
        cur.forEach(o => {
            const ch = getOrderChannel(o);
            if (!channelMap[ch]) channelMap[ch] = { name: ch, revenue: 0, orders: 0 };
            channelMap[ch].revenue += Number(o.grand_total || 0);
            channelMap[ch].orders += 1;
        });
        const channelBreakdown = Object.values(channelMap).sort((a, b) => b.revenue - a.revenue);
        const revenueMix = channelBreakdown.map(ch => ({
            ...ch,
            percent: totalRevenue > 0 ? ((ch.revenue / totalRevenue) * 100).toFixed(1) : 0
        }));

        // Top products
        const productSales = {};
        cur.forEach(order => {
            (order.items || []).forEach(item => {
                const name = item.product_name || "Unknown";
                if (!productSales[name]) productSales[name] = { name, sales: 0, count: 0 };
                productSales[name].sales += Number(item.price || 0) * Number(item.quantity || 1);
                productSales[name].count += Number(item.quantity || 1);
            });
        });
        const topProducts = Object.values(productSales).sort((a, b) => b.sales - a.sales).slice(0, 10);

        // Top colours
        const colorSales = {};
        cur.forEach(order => {
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
        const topColors = Object.values(colorSales).sort((a, b) => b.sales - a.sales).slice(0, 10);

        return {
            totalRevenue, totalOrders, deliveredOrders, totalItems, avgOrderValue,
            revenueGrowth: calcGrowth(totalRevenue, prevRevenue),
            ordersGrowth: calcGrowth(totalOrders, prevOrders),
            deliveredGrowth: calcGrowth(deliveredOrders, prevDelivered),
            showComparison: comparison !== "none",
            channelBreakdown, revenueMix, topProducts, topColors,
        };
    }, [retailOrders, timeline, comparison, customDateFrom, customDateTo]);

    // ═══════════════════════════════════════════════════════════
    // TAB 2: DAY-WISE SALES (Delhi & Ludhiana)
    // ═══════════════════════════════════════════════════════════
    const dayWiseData = useMemo(() => {
        const dateRange = getDateRange(timeline);
        const storeOrders = filterByDateRange(retailOrders, dateRange).filter(o => !isLxrtsOrder(o));

        // Split by store
        const delhiOrders = storeOrders.filter(o => (o.salesperson_store || "").toLowerCase().includes("delhi") || (o.salesperson_store || "") === "DLC");
        const ludhianaOrders = storeOrders.filter(o => (o.salesperson_store || "").toLowerCase().includes("ludhiana") || (o.salesperson_store || "") === "Ludhiana Store" || (o.salesperson_store || "").toLowerCase().includes("ldhc") || (o.salesperson_store || "").toLowerCase().includes("llc"));

        const buildDailyBuckets = (ordersList) => {
            const buckets = {};
            ordersList.forEach(o => {
                const d = new Date(o.created_at);
                const key = `${d.getDate()}/${d.getMonth() + 1}`;
                if (!buckets[key]) buckets[key] = { date: key, fullDate: d.toISOString().split("T")[0], revenue: 0, orders: 0 };
                buckets[key].revenue += Number(o.grand_total || 0);
                buckets[key].orders += 1;
            });
            return Object.values(buckets).sort((a, b) => a.fullDate.localeCompare(b.fullDate)).map(b => ({
                ...b, aov: b.orders > 0 ? Math.round(b.revenue / b.orders) : 0
            }));
        };

        const delhiDaily = buildDailyBuckets(delhiOrders);
        const ludhianaDaily = buildDailyBuckets(ludhianaOrders);

        // Combined daily (merge by date)
        const combinedMap = {};
        [...delhiOrders, ...ludhianaOrders].forEach(o => {
            const d = new Date(o.created_at);
            const key = `${d.getDate()}/${d.getMonth() + 1}`;
            if (!combinedMap[key]) combinedMap[key] = { date: key, fullDate: d.toISOString().split("T")[0], delhi: 0, ludhiana: 0 };
        });
        delhiOrders.forEach(o => {
            const d = new Date(o.created_at);
            const key = `${d.getDate()}/${d.getMonth() + 1}`;
            if (!combinedMap[key]) combinedMap[key] = { date: key, fullDate: d.toISOString().split("T")[0], delhi: 0, ludhiana: 0 };
            combinedMap[key].delhi += Number(o.grand_total || 0);
        });
        ludhianaOrders.forEach(o => {
            const d = new Date(o.created_at);
            const key = `${d.getDate()}/${d.getMonth() + 1}`;
            if (!combinedMap[key]) combinedMap[key] = { date: key, fullDate: d.toISOString().split("T")[0], delhi: 0, ludhiana: 0 };
            combinedMap[key].ludhiana += Number(o.grand_total || 0);
        });
        const combinedDaily = Object.values(combinedMap).sort((a, b) => a.fullDate.localeCompare(b.fullDate));

        return {
            delhiDaily, ludhianaDaily, combinedDaily,
            delhiTotal: delhiOrders.reduce((s, o) => s + Number(o.grand_total || 0), 0),
            ludhianaTotal: ludhianaOrders.reduce((s, o) => s + Number(o.grand_total || 0), 0),
            delhiOrders: delhiOrders.length,
            ludhianaOrders: ludhianaOrders.length,
        };
    }, [retailOrders, timeline, customDateFrom, customDateTo]);

    // ═══════════════════════════════════════════════════════════
    // TAB 3: PRODUCT ANALYTICS (no B2B)
    // ═══════════════════════════════════════════════════════════
    const productAnalytics = useMemo(() => {
        const dateRange = getAnalyticsDateRange(analyticsTimeline);
        const valid = retailOrders.filter(o => {
            if (o.status === "cancelled") return false;
            const d = new Date(o.created_at);
            return d >= dateRange.start && d <= dateRange.end;
        });

        // Products
        const productSales = {};
        valid.forEach(order => {
            (order.items || []).forEach(item => {
                const name = item.product_name || "Unknown";
                if (!productSales[name]) productSales[name] = { name, sales: 0, count: 0 };
                productSales[name].sales += Number(item.price || 0) * Number(item.quantity || 1);
                productSales[name].count += Number(item.quantity || 1);
            });
        });
        const sorted = Object.values(productSales).sort((a, b) => b.sales - a.sales);
        const topProducts = sorted.slice(0, 10);
        const bottomProducts = [...sorted].sort((a, b) => a.sales - b.sales).slice(0, 10);

        // Colors
        const colorSales = {};
        valid.forEach(order => {
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
        const topColors = sortedColors.slice(0, 10);
        const bottomColors = [...sortedColors].sort((a, b) => a.sales - b.sales).slice(0, 5);

        // Salesperson performance
        const spData = {};
        valid.forEach(order => {
            const sp = getOrderSalesperson(order);
            if (!sp || !isPersonName(sp)) return;
            if (!spData[sp]) spData[sp] = { name: sp, sales: 0, discount: 0, count: 0 };
            spData[sp].sales += Number(order.grand_total || 0);
            spData[sp].discount += Number(order.discount_amount || 0);
            spData[sp].count += 1;
        });
        const salesBySalesperson = Object.values(spData).sort((a, b) => b.sales - a.sales).slice(0, 10);

        // Store breakdown
        const storeSales = {};
        valid.forEach(order => {
            const store = getOrderChannel(order);
            if (!storeSales[store]) storeSales[store] = { name: store, sales: 0, count: 0 };
            storeSales[store].sales += Number(order.grand_total || 0);
            storeSales[store].count += 1;
        });
        const salesByStore = Object.values(storeSales).sort((a, b) => b.sales - a.sales);

        return { topProducts, bottomProducts, topColors, bottomColors, salesBySalesperson, salesByStore };
    }, [retailOrders, analyticsTimeline, analyticsCustomFrom, analyticsCustomTo]);

    // ═══════════════════════════════════════════════════════════
    // TAB 4: ORDERS (no customer PII, no B2B)
    // ═══════════════════════════════════════════════════════════
    const salespersons = useMemo(() => {
        const spSet = new Set();
        retailOrders.forEach(o => {
            const sp = getOrderSalesperson(o);
            if (sp && isPersonName(sp)) spSet.add(sp);
        });
        return Array.from(spSet).sort();
    }, [retailOrders, knownStoreNames]);

    // Only non-LXRTS, non-B2B orders in the orders tab
    const filteredByStatus = useMemo(() => {
        return retailOrders.filter(o => {
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
    }, [retailOrders, statusTab]);

    const filteredOrders = useMemo(() => {
        let result = filteredByStatus;
        if (orderSearch.trim()) {
            const q = orderSearch.toLowerCase();
            result = result.filter(order => {
                const item = order.items?.[0] || {};
                return order.order_no?.toLowerCase().includes(q) ||
                    item.product_name?.toLowerCase().includes(q) ||
                    (getOrderSalesperson(order) || "").toLowerCase().includes(q);
            });
        }
        if (filters.dateFrom || filters.dateTo) {
            result = result.filter(order => {
                const d = new Date(order.created_at);
                if (filters.dateFrom && d < new Date(filters.dateFrom)) return false;
                if (filters.dateTo && d > new Date(filters.dateTo + "T23:59:59")) return false;
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
    }, [filteredByStatus, orderSearch, filters, sortBy]);

    const orderTabCounts = useMemo(() => {
        const valid = retailOrders.filter(o => !isLxrtsOrder(o));
        return {
            all: valid.length,
            unfulfilled: valid.filter(o => { const s = o.status?.toLowerCase(); return s !== "completed" && s !== "delivered" && s !== "cancelled"; }).length,
            prepared: valid.filter(o => o.status?.toLowerCase() === "completed").length,
            delivered: valid.filter(o => o.status?.toLowerCase() === "delivered").length,
            cancelled: valid.filter(o => o.status?.toLowerCase() === "cancelled").length,
        };
    }, [retailOrders]);

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

    const toggleFilter = (category, value) => setFilters(prev => ({
        ...prev, [category]: prev[category].includes(value) ? prev[category].filter(v => v !== value) : [...prev[category], value]
    }));

    useEffect(() => { setOrdersPage(1); }, [orderSearch, statusTab, filters, sortBy]);

    // ═══════════════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════════════
    if (loading) {
        return (
            <div className="rm-page">
                <div className="rm-loading">
                    <div className="rm-spinner"></div>
                    <span>Loading Dashboard...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="rm-page">
            {/* HEADER */}
            <header className="rm-header">
                <div className="rm-header-left">
                    <button className="rm-hamburger" onClick={() => setShowSidebar(!showSidebar)}>
                        <span /><span /><span />
                    </button>
                    <img src={Logo} alt="Sheetal Batra" className="rm-logo" />
                </div>
                <h1 className="rm-title">Retail Manager</h1>
                <div className="rm-header-right">
                    <button className="rm-logout-btn" onClick={handleLogout}>Logout</button>
                </div>
            </header>

            <div className="rm-layout">
                {/* SIDEBAR */}
                <aside className={`rm-sidebar ${showSidebar ? "open" : ""}`}>
                    <nav className="rm-nav">
                        <button className={`rm-nav-item ${activeTab === "store_analytics" ? "active" : ""}`} onClick={() => { setActiveTab("store_analytics"); setShowSidebar(false); }}>Store Analytics</button>
                        <button className={`rm-nav-item ${activeTab === "daywise_sales" ? "active" : ""}`} onClick={() => { setActiveTab("daywise_sales"); setShowSidebar(false); }}>Day-wise Sales</button>
                        <button className={`rm-nav-item ${activeTab === "product_analytics" ? "active" : ""}`} onClick={() => { setActiveTab("product_analytics"); setShowSidebar(false); }}>Product Analytics</button>
                        <button className={`rm-nav-item ${activeTab === "orders" ? "active" : ""}`} onClick={() => { setActiveTab("orders"); setShowSidebar(false); }}>Orders</button>
                        <button className="rm-nav-item logout" onClick={handleLogout}>Logout</button>
                    </nav>
                </aside>

                {/* CONTENT */}
                <main className="rm-content">

                    {/* ═══════════ TAB 1: STORE ANALYTICS ═══════════ */}
                    {activeTab === "store_analytics" && (
                        <div className="rm-analytics-tab">
                            <div className="rm-tab-header">
                                <h2 className="rm-section-title">Store Analytics</h2>
                                <div className="rm-filters-row">
                                    <div className="rm-timeline-pills">
                                        {TIMELINE_OPTIONS.map(opt => (
                                            <button key={opt.value} className={`rm-pill ${timeline === opt.value ? "active" : ""}`}
                                                onClick={() => { setTimeline(opt.value); setShowCustomDatePicker(opt.value === "custom"); }}>
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="rm-filters-right">
                                        {showCustomDatePicker && (
                                            <div className="rm-date-range">
                                                <input type="date" value={customDateFrom} onChange={(e) => setCustomDateFrom(e.target.value)} />
                                                <span className="rm-date-sep">{"\u2192"}</span>
                                                <input type="date" value={customDateTo} onChange={(e) => setCustomDateTo(e.target.value)} />
                                            </div>
                                        )}
                                        <select className="rm-compare-select" value={comparison} onChange={(e) => setComparison(e.target.value)}>
                                            {COMPARISON_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* KPIs */}
                            <h3 className="rm-subsection-title">Retail Performance</h3>
                            <div className="rm-stats-grid overview-grid">
                                <div className="rm-stat-card overview-card">
                                    <span className="stat-label">Total Revenue</span>
                                    <span className="stat-value">{"\u20B9"}{formatIndianNumber(dashboardStats.totalRevenue)}</span>
                                    {dashboardStats.showComparison && <GrowthIndicator value={dashboardStats.revenueGrowth} />}
                                </div>
                                <div className="rm-stat-card overview-card">
                                    <span className="stat-label">Total Orders</span>
                                    <span className="stat-value">{formatIndianNumber(dashboardStats.totalOrders)}</span>
                                    {dashboardStats.showComparison && <GrowthIndicator value={dashboardStats.ordersGrowth} />}
                                </div>
                                <div className="rm-stat-card overview-card">
                                    <span className="stat-label">Items Sold</span>
                                    <span className="stat-value">{formatIndianNumber(dashboardStats.totalItems)}</span>
                                </div>
                                <div className="rm-stat-card overview-card">
                                    <span className="stat-label">Avg Order Value</span>
                                    <span className="stat-value">{"\u20B9"}{formatIndianNumber(dashboardStats.avgOrderValue.toFixed(0))}</span>
                                </div>
                                <div className="rm-stat-card overview-card">
                                    <span className="stat-label">Delivered</span>
                                    <span className="stat-value">{dashboardStats.deliveredOrders}</span>
                                    {dashboardStats.showComparison && <GrowthIndicator value={dashboardStats.deliveredGrowth} />}
                                </div>
                            </div>

                            {/* Channel Pie + Revenue Mix */}
                            <div className="rm-charts-grid" style={{ marginBottom: 20 }}>
                                <div className="rm-chart-card">
                                    <h3 className="rm-chart-title">Sales by Channel</h3>
                                    {dashboardStats.channelBreakdown.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={300}>
                                            <PieChart>
                                                <Pie data={dashboardStats.channelBreakdown} cx="50%" cy="45%" innerRadius={55} outerRadius={95} dataKey="revenue"
                                                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`} labelLine={true}>
                                                    {dashboardStats.channelBreakdown.map((_, i) => (
                                                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                                    ))}
                                                </Pie>
                                                <Tooltip />
                                                <Legend verticalAlign="bottom" height={36} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    ) : <div className="rm-no-chart-data">No data available</div>}
                                </div>
                                <div className="rm-chart-card">
                                    <h3 className="rm-chart-title">Channel Revenue Breakdown</h3>
                                    {dashboardStats.revenueMix.length > 0 ? (
                                        <div className="rm-revenue-mix-list">
                                            {dashboardStats.revenueMix.map((ch, i) => (
                                                <div key={i} className="rm-revenue-mix-row">
                                                    <div className="rm-revenue-mix-info">
                                                        <span className="rm-revenue-mix-dot" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}></span>
                                                        <span className="rm-revenue-mix-name">{ch.name}</span>
                                                    </div>
                                                    <div className="rm-revenue-mix-bar-wrap">
                                                        <div className="rm-revenue-mix-bar" style={{ width: `${ch.percent}%`, background: PIE_COLORS[i % PIE_COLORS.length] }}></div>
                                                    </div>
                                                    <span className="rm-revenue-mix-val">{ch.percent}%</span>
                                                    <span className="rm-revenue-mix-amt">{"\u20B9"}{formatIndianNumber(Math.round(ch.revenue))}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : <div className="rm-no-chart-data">No data available</div>}
                                </div>
                            </div>

                            {/* Top Products */}
                            <div className="rm-chart-card" style={{ marginBottom: 20 }}>
                                <h3 className="rm-chart-title">Top Selling Products</h3>
                                {dashboardStats.topProducts.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={380}>
                                        <BarChart data={dashboardStats.topProducts} layout="vertical" margin={{ top: 5, right: 40, left: 5, bottom: 5 }}>
                                            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#eee" />
                                            <XAxis type="number" tickFormatter={(v) => `\u20B9${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} />
                                            <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: '#444' }}
                                                tickFormatter={(v) => v.length > 20 ? v.substring(0, 20) + '\u2026' : v} axisLine={false} tickLine={false} />
                                            <Tooltip content={({ active, payload, label }) => {
                                                if (!active || !payload?.length) return null;
                                                const item = dashboardStats.topProducts.find(p => p.name === label);
                                                return (
                                                    <div className="rm-chart-tooltip">
                                                        <p className="rm-chart-tooltip-label">{label}</p>
                                                        <p className="rm-chart-tooltip-row">Sales: {"\u20B9"}{formatIndianNumber(payload[0].value)}</p>
                                                        <p className="rm-chart-tooltip-row">Qty sold: {item?.count || 0}</p>
                                                    </div>
                                                );
                                            }} />
                                            <Bar dataKey="sales" radius={[0, 6, 6, 0]} barSize={20}>
                                                {dashboardStats.topProducts.map((_, i) => (
                                                    <Cell key={i} fill={`rgba(213, 184, 90, ${1 - i * 0.07})`} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : <div className="rm-no-chart-data">No data available</div>}
                            </div>

                            {/* Top Colours */}
                            <div className="rm-chart-card">
                                <h3 className="rm-chart-title">Top Performing Colours</h3>
                                {dashboardStats.topColors.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={380}>
                                        <BarChart data={dashboardStats.topColors} margin={{ top: 10, right: 20, left: 10, bottom: 80 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                                            <XAxis dataKey="name" interval={0} tick={<WrappedAxisTick />} axisLine={false} tickLine={false} height={50} />
                                            <YAxis tickFormatter={(v) => `\u20B9${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                                            <Tooltip content={({ active, payload, label }) => {
                                                if (!active || !payload?.length) return null;
                                                return (
                                                    <div className="rm-chart-tooltip">
                                                        <p className="rm-chart-tooltip-label"><span className="rm-chart-tooltip-dot" style={{ background: getColorHex(label) }}></span>{label}</p>
                                                        <p className="rm-chart-tooltip-row">Sales: {"\u20B9"}{formatIndianNumber(payload[0].value)}</p>
                                                    </div>
                                                );
                                            }} />
                                            <Bar dataKey="sales" radius={[6, 6, 0, 0]} barSize={32}>
                                                {dashboardStats.topColors.map((entry, i) => (
                                                    <Cell key={i} fill={getColorHex(entry.name)} stroke="rgba(0,0,0,0.08)" strokeWidth={1} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : <div className="rm-no-chart-data">No data available</div>}
                            </div>
                        </div>
                    )}

                    {/* ═══════════ TAB 2: DAY-WISE SALES ═══════════ */}
                    {activeTab === "daywise_sales" && (
                        <div className="rm-analytics-tab">
                            <div className="rm-tab-header">
                                <h2 className="rm-section-title">Day-wise Sales</h2>
                                <div className="rm-filters-row">
                                    <div className="rm-timeline-pills">
                                        {TIMELINE_OPTIONS.map(opt => (
                                            <button key={opt.value} className={`rm-pill ${timeline === opt.value ? "active" : ""}`}
                                                onClick={() => { setTimeline(opt.value); setShowCustomDatePicker(opt.value === "custom"); }}>
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="rm-filters-right">
                                        {showCustomDatePicker && (
                                            <div className="rm-date-range">
                                                <input type="date" value={customDateFrom} onChange={(e) => setCustomDateFrom(e.target.value)} />
                                                <span className="rm-date-sep">{"\u2192"}</span>
                                                <input type="date" value={customDateTo} onChange={(e) => setCustomDateTo(e.target.value)} />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Store summary cards */}
                            <div className="rm-stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                                <div className="rm-stat-card overview-card">
                                    <span className="stat-label">Delhi Revenue</span>
                                    <span className="stat-value">{"\u20B9"}{formatIndianNumber(dayWiseData.delhiTotal)}</span>
                                    <span className="stat-sub">{dayWiseData.delhiOrders} orders</span>
                                </div>
                                <div className="rm-stat-card overview-card">
                                    <span className="stat-label">Ludhiana Revenue</span>
                                    <span className="stat-value">{"\u20B9"}{formatIndianNumber(dayWiseData.ludhianaTotal)}</span>
                                    <span className="stat-sub">{dayWiseData.ludhianaOrders} orders</span>
                                </div>
                                <div className="rm-stat-card overview-card">
                                    <span className="stat-label">Combined Revenue</span>
                                    <span className="stat-value">{"\u20B9"}{formatIndianNumber(dayWiseData.delhiTotal + dayWiseData.ludhianaTotal)}</span>
                                    <span className="stat-sub">{dayWiseData.delhiOrders + dayWiseData.ludhianaOrders} orders</span>
                                </div>
                                <div className="rm-stat-card overview-card">
                                    <span className="stat-label">Delhi AOV</span>
                                    <span className="stat-value">{"\u20B9"}{dayWiseData.delhiOrders > 0 ? formatIndianNumber(Math.round(dayWiseData.delhiTotal / dayWiseData.delhiOrders)) : 0}</span>
                                </div>
                            </div>

                            {/* Store toggle */}
                            <div className="rm-store-toggle">
                                <button className={`rm-store-btn ${dayWiseStore === "all" ? "active" : ""}`} onClick={() => setDayWiseStore("all")}>Both Stores</button>
                                <button className={`rm-store-btn ${dayWiseStore === "delhi" ? "active" : ""}`} onClick={() => setDayWiseStore("delhi")}>Delhi</button>
                                <button className={`rm-store-btn ${dayWiseStore === "ludhiana" ? "active" : ""}`} onClick={() => setDayWiseStore("ludhiana")}>Ludhiana</button>
                            </div>

                            {/* Combined chart */}
                            {dayWiseStore === "all" && (
                                <div className="rm-chart-card" style={{ marginBottom: 20 }}>
                                    <h3 className="rm-chart-title">Daily Revenue {"\u2014"} Delhi vs Ludhiana</h3>
                                    {dayWiseData.combinedDaily.length > 1 ? (
                                        <ResponsiveContainer width="100%" height={350}>
                                            <BarChart data={dayWiseData.combinedDaily} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                                                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                                                <YAxis tickFormatter={(v) => `\u20B9${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                                                <Tooltip formatter={(v, name) => [`\u20B9${formatIndianNumber(v)}`, name === "delhi" ? "Delhi" : "Ludhiana"]} />
                                                <Legend />
                                                <Bar dataKey="delhi" name="Delhi" fill="#d5b85a" radius={[4, 4, 0, 0]} />
                                                <Bar dataKey="ludhiana" name="Ludhiana" fill="#8B7355" radius={[4, 4, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : <div className="rm-no-chart-data">Select a wider date range to see trends</div>}
                                </div>
                            )}

                            {/* Delhi chart */}
                            {(dayWiseStore === "delhi" || dayWiseStore === "all") && dayWiseStore !== "ludhiana" && dayWiseStore !== "all" && null}
                            {dayWiseStore === "delhi" && (
                                <div className="rm-chart-card" style={{ marginBottom: 20 }}>
                                    <h3 className="rm-chart-title">Daily Revenue {"\u2014"} Delhi Store</h3>
                                    {dayWiseData.delhiDaily.length > 1 ? (
                                        <ResponsiveContainer width="100%" height={300}>
                                            <AreaChart data={dayWiseData.delhiDaily} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                                                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                                                <YAxis tickFormatter={(v) => `\u20B9${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                                                <Tooltip formatter={(v, name) => [`\u20B9${formatIndianNumber(v)}`, name === "revenue" ? "Revenue" : "AOV"]} />
                                                <Legend />
                                                <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#d5b85a" fill="rgba(213,184,90,0.15)" strokeWidth={2} />
                                                <Line type="monotone" dataKey="aov" name="AOV" stroke="#8B7355" strokeWidth={2} dot={false} />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    ) : <div className="rm-no-chart-data">Not enough data for Delhi</div>}
                                </div>
                            )}

                            {/* Ludhiana chart */}
                            {dayWiseStore === "ludhiana" && (
                                <div className="rm-chart-card" style={{ marginBottom: 20 }}>
                                    <h3 className="rm-chart-title">Daily Revenue {"\u2014"} Ludhiana Store</h3>
                                    {dayWiseData.ludhianaDaily.length > 1 ? (
                                        <ResponsiveContainer width="100%" height={300}>
                                            <AreaChart data={dayWiseData.ludhianaDaily} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                                                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                                                <YAxis tickFormatter={(v) => `\u20B9${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                                                <Tooltip formatter={(v, name) => [`\u20B9${formatIndianNumber(v)}`, name === "revenue" ? "Revenue" : "AOV"]} />
                                                <Legend />
                                                <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#8B7355" fill="rgba(139,115,85,0.15)" strokeWidth={2} />
                                                <Line type="monotone" dataKey="aov" name="AOV" stroke="#C9A94E" strokeWidth={2} dot={false} />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    ) : <div className="rm-no-chart-data">Not enough data for Ludhiana</div>}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ═══════════ TAB 3: PRODUCT ANALYTICS ═══════════ */}
                    {activeTab === "product_analytics" && (
                        <div className="rm-analytics-tab">
                            <div className="rm-tab-header">
                                <h2 className="rm-section-title">Product Analytics</h2>
                                <div className="rm-filters-row">
                                    <div className="rm-timeline-pills">
                                        {TIMELINE_OPTIONS.map(opt => (
                                            <button key={opt.value} className={`rm-pill ${analyticsTimeline === opt.value ? "active" : ""}`}
                                                onClick={() => { setAnalyticsTimeline(opt.value); setShowAnalyticsCustomPicker(opt.value === "custom"); }}>
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="rm-filters-right">
                                        {showAnalyticsCustomPicker && (
                                            <div className="rm-date-range">
                                                <input type="date" value={analyticsCustomFrom} onChange={(e) => setAnalyticsCustomFrom(e.target.value)} />
                                                <span className="rm-date-sep">{"\u2192"}</span>
                                                <input type="date" value={analyticsCustomTo} onChange={(e) => setAnalyticsCustomTo(e.target.value)} />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="rm-charts-grid">
                                {/* Top Products */}
                                <div className="rm-chart-card">
                                    <h3 className="rm-chart-title">Top-Performing Products</h3>
                                    {productAnalytics.topProducts.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={400}>
                                            <BarChart data={productAnalytics.topProducts} layout="vertical" margin={{ top: 5, right: 40, left: 5, bottom: 5 }}>
                                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#eee" />
                                                <XAxis type="number" tickFormatter={(v) => `\u20B9${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} />
                                                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: '#444' }}
                                                    tickFormatter={(v) => v.length > 20 ? v.substring(0, 20) + '\u2026' : v} axisLine={false} tickLine={false} />
                                                <Tooltip content={({ active, payload, label }) => {
                                                    if (!active || !payload?.length) return null;
                                                    const item = productAnalytics.topProducts.find(p => p.name === label);
                                                    return (
                                                        <div className="rm-chart-tooltip">
                                                            <p className="rm-chart-tooltip-label">{label}</p>
                                                            <p className="rm-chart-tooltip-row">Sales: {"\u20B9"}{formatIndianNumber(payload[0].value)}</p>
                                                            <p className="rm-chart-tooltip-row">Qty: {item?.count || 0}</p>
                                                        </div>
                                                    );
                                                }} />
                                                <Bar dataKey="sales" radius={[0, 6, 6, 0]} barSize={20}>
                                                    {productAnalytics.topProducts.map((_, i) => (
                                                        <Cell key={i} fill={`rgba(213, 184, 90, ${1 - i * 0.07})`} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : <div className="rm-no-chart-data">No data available</div>}
                                </div>

                                {/* Bottom Products */}
                                <div className="rm-chart-card">
                                    <h3 className="rm-chart-title">Bottom-Performing Products</h3>
                                    {productAnalytics.bottomProducts.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={400}>
                                            <BarChart data={productAnalytics.bottomProducts} layout="vertical" margin={{ top: 5, right: 40, left: 5, bottom: 5 }}>
                                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#eee" />
                                                <XAxis type="number" tickFormatter={(v) => `\u20B9${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} />
                                                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: '#444' }}
                                                    tickFormatter={(v) => v.length > 20 ? v.substring(0, 20) + '\u2026' : v} axisLine={false} tickLine={false} />
                                                <Tooltip content={({ active, payload, label }) => {
                                                    if (!active || !payload?.length) return null;
                                                    return (
                                                        <div className="rm-chart-tooltip">
                                                            <p className="rm-chart-tooltip-label">{label}</p>
                                                            <p className="rm-chart-tooltip-row">Sales: {"\u20B9"}{formatIndianNumber(payload[0].value)}</p>
                                                        </div>
                                                    );
                                                }} />
                                                <Bar dataKey="sales" radius={[0, 6, 6, 0]} barSize={20}>
                                                    {productAnalytics.bottomProducts.map((_, i) => (
                                                        <Cell key={i} fill={`rgba(198, 40, 40, ${0.9 - i * 0.07})`} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : <div className="rm-no-chart-data">No data available</div>}
                                </div>

                                {/* Top Colours */}
                                <div className="rm-chart-card">
                                    <h3 className="rm-chart-title">Top Performing Colours</h3>
                                    {productAnalytics.topColors.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={380}>
                                            <BarChart data={productAnalytics.topColors} margin={{ top: 10, right: 20, left: 10, bottom: 80 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                                                <XAxis dataKey="name" interval={0} tick={<WrappedAxisTick />} axisLine={false} tickLine={false} height={50} />
                                                <YAxis tickFormatter={(v) => `\u20B9${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                                                <Tooltip content={({ active, payload, label }) => {
                                                    if (!active || !payload?.length) return null;
                                                    return (
                                                        <div className="rm-chart-tooltip">
                                                            <p className="rm-chart-tooltip-label"><span className="rm-chart-tooltip-dot" style={{ background: getColorHex(label) }}></span>{label}</p>
                                                            <p className="rm-chart-tooltip-row">Sales: {"\u20B9"}{formatIndianNumber(payload[0].value)}</p>
                                                        </div>
                                                    );
                                                }} />
                                                <Bar dataKey="sales" radius={[6, 6, 0, 0]} barSize={32}>
                                                    {productAnalytics.topColors.map((entry, i) => <Cell key={i} fill={getColorHex(entry.name)} stroke="rgba(0,0,0,0.08)" strokeWidth={1} />)}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : <div className="rm-no-chart-data">No data available</div>}
                                </div>

                                {/* Bottom Colours */}
                                <div className="rm-chart-card">
                                    <h3 className="rm-chart-title">Bottom Performing Colours</h3>
                                    {productAnalytics.bottomColors.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={380}>
                                            <BarChart data={productAnalytics.bottomColors} margin={{ top: 10, right: 20, left: 10, bottom: 80 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                                                <XAxis dataKey="name" interval={0} tick={<WrappedAxisTick />} axisLine={false} tickLine={false} height={50} />
                                                <YAxis tickFormatter={(v) => `\u20B9${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                                                <Tooltip content={({ active, payload, label }) => {
                                                    if (!active || !payload?.length) return null;
                                                    return (
                                                        <div className="rm-chart-tooltip">
                                                            <p className="rm-chart-tooltip-label"><span className="rm-chart-tooltip-dot" style={{ background: getColorHex(label) }}></span>{label}</p>
                                                            <p className="rm-chart-tooltip-row">Sales: {"\u20B9"}{formatIndianNumber(payload[0].value)}</p>
                                                        </div>
                                                    );
                                                }} />
                                                <Bar dataKey="sales" radius={[6, 6, 0, 0]} barSize={32}>
                                                    {productAnalytics.bottomColors.map((entry, i) => <Cell key={i} fill={getColorHex(entry.name)} stroke="rgba(0,0,0,0.08)" strokeWidth={1} />)}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : <div className="rm-no-chart-data">No data available</div>}
                                </div>

                                {/* Sales by Salesperson */}
                                <div className="rm-chart-card">
                                    <h3 className="rm-chart-title">Sales by Salesperson</h3>
                                    {productAnalytics.salesBySalesperson.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={380}>
                                            <BarChart data={productAnalytics.salesBySalesperson} layout="vertical" margin={{ top: 5, right: 40, left: 5, bottom: 5 }}>
                                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#eee" />
                                                <XAxis type="number" tickFormatter={(v) => `\u20B9${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} />
                                                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: '#444' }} axisLine={false} tickLine={false} />
                                                <Tooltip content={({ active, payload, label }) => {
                                                    if (!active || !payload?.length) return null;
                                                    const item = productAnalytics.salesBySalesperson.find(s => s.name === label);
                                                    return (
                                                        <div className="rm-chart-tooltip">
                                                            <p className="rm-chart-tooltip-label">{label}</p>
                                                            <p className="rm-chart-tooltip-row">Sales: {"\u20B9"}{formatIndianNumber(payload[0].value)}</p>
                                                            <p className="rm-chart-tooltip-row">Orders: {item?.count || 0}</p>
                                                        </div>
                                                    );
                                                }} />
                                                <Bar dataKey="sales" radius={[0, 6, 6, 0]} barSize={20}>
                                                    {productAnalytics.salesBySalesperson.map((_, i) => (
                                                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : <div className="rm-no-chart-data">No data available</div>}
                                </div>

                                {/* Sales by Store */}
                                <div className="rm-chart-card">
                                    <h3 className="rm-chart-title">Sales by Store</h3>
                                    {productAnalytics.salesByStore.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={300}>
                                            <PieChart>
                                                <Pie data={productAnalytics.salesByStore} cx="50%" cy="45%" innerRadius={55} outerRadius={95} dataKey="sales"
                                                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`} labelLine={true}>
                                                    {productAnalytics.salesByStore.map((_, i) => (
                                                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                                    ))}
                                                </Pie>
                                                <Tooltip formatter={(v) => [`\u20B9${formatIndianNumber(v)}`, "Sales"]} />
                                                <Legend verticalAlign="bottom" height={36} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    ) : <div className="rm-no-chart-data">No data available</div>}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ═══════════ TAB 4: ORDERS (no PII, no export, no PDF) ═══════════ */}
                    {activeTab === "orders" && (
                        <div className="rm-analytics-tab">
                            <h2 className="rm-section-title">Orders</h2>
                            <div className="rm-toolbar">
                                <div className="rm-search-wrapper">
                                    <span className="rm-search-icon">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg>
                                    </span>
                                    <input type="text" placeholder="Search Order #, Product, Salesperson..." value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} className="rm-search-input" />
                                    {orderSearch && <button className="rm-search-clear" onClick={() => setOrderSearch("")}>{"\u00D7"}</button>}
                                </div>
                                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="rm-sort-select">
                                    <option value="newest">Newest First</option>
                                    <option value="oldest">Oldest First</option>
                                    <option value="delivery">Delivery Date</option>
                                    <option value="amount_high">Amount: High to Low</option>
                                    <option value="amount_low">Amount: Low to High</option>
                                </select>
                                {/* NO EXPORT BUTTON */}
                            </div>

                            <div className="rm-status-tabs">
                                {STATUS_TABS.map(tab => (
                                    <button key={tab.value} className={`rm-status-tab ${statusTab === tab.value ? "active" : ""}`} onClick={() => setStatusTab(tab.value)}>
                                        {tab.label}<span className="rm-tab-count">{orderTabCounts[tab.value]}</span>
                                    </button>
                                ))}
                            </div>

                            <div className="rm-filter-bar" ref={dropdownRef}>
                                <div className="rm-filter-dropdown">
                                    <button className={`rm-filter-btn ${(filters.dateFrom || filters.dateTo) ? "active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "date" ? null : "date")}>Date Range {"\u25BE"}</button>
                                    {openDropdown === "date" && (
                                        <div className="rm-dropdown-panel">
                                            <div className="rm-dropdown-title">Select Date Range</div>
                                            <div className="rm-date-inputs">
                                                <input type="date" value={filters.dateFrom} onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))} />
                                                <span>to</span>
                                                <input type="date" value={filters.dateTo} onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value }))} />
                                            </div>
                                            <button className="rm-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>
                                <div className="rm-filter-dropdown">
                                    <button className={`rm-filter-btn ${(filters.minPrice > 0 || filters.maxPrice < 500000) ? "active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "price" ? null : "price")}>Price {"\u25BE"}</button>
                                    {openDropdown === "price" && (
                                        <div className="rm-dropdown-panel rm-price-panel">
                                            <div className="rm-dropdown-title">Order Value</div>
                                            <div className="rm-price-inputs">
                                                <div className="rm-price-input-wrap"><span>{"\u20B9"}</span><input type="number" value={filters.minPrice} onChange={(e) => setFilters(prev => ({ ...prev, minPrice: Math.min(Number(e.target.value), prev.maxPrice - 1000) }))} /></div>
                                                <span>to</span>
                                                <div className="rm-price-input-wrap"><span>{"\u20B9"}</span><input type="number" value={filters.maxPrice} onChange={(e) => setFilters(prev => ({ ...prev, maxPrice: Math.max(Number(e.target.value), prev.minPrice + 1000) }))} /></div>
                                            </div>
                                            <button className="rm-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>
                                <div className="rm-filter-dropdown">
                                    <button className={`rm-filter-btn ${filters.payment.length > 0 ? "active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "payment" ? null : "payment")}>Payment {"\u25BE"}</button>
                                    {openDropdown === "payment" && (
                                        <div className="rm-dropdown-panel">
                                            <div className="rm-dropdown-title">Payment Status</div>
                                            {["paid", "partial", "unpaid"].map(opt => (
                                                <label key={opt} className="rm-checkbox-label">
                                                    <input type="checkbox" checked={filters.payment.includes(opt)} onChange={() => toggleFilter("payment", opt)} />
                                                    <span>{opt === "unpaid" ? "Unpaid (COD)" : opt.charAt(0).toUpperCase() + opt.slice(1)}</span>
                                                </label>
                                            ))}
                                            <button className="rm-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>
                                <div className="rm-filter-dropdown">
                                    <button className={`rm-filter-btn ${filters.priority.length > 0 ? "active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "priority" ? null : "priority")}>Priority {"\u25BE"}</button>
                                    {openDropdown === "priority" && (
                                        <div className="rm-dropdown-panel">
                                            <div className="rm-dropdown-title">Priority</div>
                                            {["normal", "urgent"].map(opt => (
                                                <label key={opt} className="rm-checkbox-label">
                                                    <input type="checkbox" checked={filters.priority.includes(opt)} onChange={() => toggleFilter("priority", opt)} />
                                                    <span>{opt.charAt(0).toUpperCase() + opt.slice(1)}</span>
                                                </label>
                                            ))}
                                            <button className="rm-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>
                                <div className="rm-filter-dropdown">
                                    <button className={`rm-filter-btn ${filters.store.length > 0 ? "active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "store" ? null : "store")}>Store {"\u25BE"}</button>
                                    {openDropdown === "store" && (
                                        <div className="rm-dropdown-panel">
                                            <div className="rm-dropdown-title">Store</div>
                                            {["Delhi Store", "Ludhiana Store"].map(opt => (
                                                <label key={opt} className="rm-checkbox-label">
                                                    <input type="checkbox" checked={filters.store.includes(opt)} onChange={() => toggleFilter("store", opt)} />
                                                    <span>{opt}</span>
                                                </label>
                                            ))}
                                            <button className="rm-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>
                                <div className="rm-filter-dropdown">
                                    <select className="rm-filter-btn" style={{ cursor: 'pointer' }} value={filters.salesperson} onChange={(e) => setFilters(prev => ({ ...prev, salesperson: e.target.value }))}>
                                        <option value="">All Salespersons</option>
                                        {salespersons.map(sp => <option key={sp} value={sp}>{sp}</option>)}
                                    </select>
                                </div>
                            </div>

                            {appliedFilters.length > 0 && (
                                <div className="rm-applied-filters">
                                    <span className="rm-applied-label">Applied:</span>
                                    {appliedFilters.map((chip, i) => (
                                        <span key={i} className="rm-filter-chip">{chip.label}<button onClick={() => removeFilter(chip.type, chip.value)}>{"\u00D7"}</button></span>
                                    ))}
                                    <button className="rm-clear-all" onClick={clearAllFilters}>Clear All</button>
                                </div>
                            )}

                            <div className="rm-orders-count">Showing {filteredOrders.length} orders</div>

                            <div className="rm-table-wrapper">
                                <div className="rm-table-container">
                                    <table className="rm-table">
                                        {/* NO Customer column, NO Actions/PDF column */}
                                        <thead>
                                            <tr>
                                                <th>Order ID</th>
                                                <th>Product</th>
                                                <th>Amount</th>
                                                <th>Payment</th>
                                                <th>Status</th>
                                                <th>Store</th>
                                                <th>Salesperson</th>
                                                <th>Date</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {currentOrders.length === 0 ? (
                                                <tr><td colSpan="8" className="rm-no-data">No orders found</td></tr>
                                            ) : currentOrders.map(order => {
                                                const isUrgent = getPriority(order) === "urgent";
                                                return (
                                                    <tr key={order.id} className={isUrgent ? "urgent-row" : ""}>
                                                        <td>
                                                            <span className="rm-order-id">{order.order_no || "-"}</span>
                                                            {isUrgent && <span className="rm-urgent-badge">URGENT</span>}
                                                        </td>
                                                        <td className="rm-product-cell">{order.items?.[0]?.product_name || "-"}</td>
                                                        <td>{"\u20B9"}{formatIndianNumber(order.grand_total || 0)}</td>
                                                        <td>
                                                            <span className={`rm-payment-badge ${getPaymentStatus(order)}`}>
                                                                {getPaymentStatus(order).charAt(0).toUpperCase() + getPaymentStatus(order).slice(1)}
                                                            </span>
                                                        </td>
                                                        <td>
                                                            <span className={`rm-status-badge ${(order.status || "pending").replace(" ", "_")}`}>
                                                                {(order.status || "pending").charAt(0).toUpperCase() + (order.status || "pending").slice(1).replace("_", " ")}
                                                            </span>
                                                        </td>
                                                        <td>{order.salesperson_store || "-"}</td>
                                                        <td>{getOrderSalesperson(order) || "-"}</td>
                                                        <td>{formatDate(order.created_at)}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {ordersTotalPages > 1 && (
                                <div className="rm-pagination">
                                    <button onClick={() => setOrdersPage(p => Math.max(1, p - 1))} disabled={ordersPage === 1}>Prev</button>
                                    <span>Page {ordersPage} of {ordersTotalPages}</span>
                                    <button onClick={() => setOrdersPage(p => Math.min(ordersTotalPages, p + 1))} disabled={ordersPage === ordersTotalPages}>Next</button>
                                </div>
                            )}
                        </div>
                    )}

                </main>
            </div>
        </div>
    );
}