import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { fetchAllRows } from "../../utils/fetchAllRows";
import "./StoreManagerDashboard.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";
import NotificationBell from "../../components/NotificationBell";
import config from "../../config/config";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell, AreaChart, Area, Line
} from "recharts";

const STATUS_TABS = [
    { value: "all", label: "All Orders" },
    { value: "in_progress", label: "In Progress" },
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

const ITEMS_PER_PAGE = 15;
const CHART_COLORS = ["#d5b85a", "#8B7355", "#C9A94E", "#A67C52", "#D4AF37", "#BDB76B", "#DAA520", "#B8860B", "#CD853F", "#DEB887"];
const PIE_COLORS = ["#d5b85a", "#8B7355", "#C9A94E", "#A67C52", "#D4AF37"];

const ChartTooltip = ({ active, payload, label, prefix = "\u20B9" }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="sm-chart-tooltip">
            <p className="sm-chart-tooltip-label">{label}</p>
            {payload.map((entry, i) => (
                <p key={i} style={{ color: entry.color }}>{entry.name}: {prefix}{formatIndianNumber(Math.round(entry.value))}</p>
            ))}
        </div>
    );
};

// Store matching helper
const storeMatches = (orderStore, userStore) => {
    if (!orderStore || !userStore) return false;
    const os = orderStore.toLowerCase().trim();
    const us = userStore.toLowerCase().trim();
    if (os === us) return true;
    // Delhi variants
    if (us.includes("delhi") && (os.includes("delhi") || os === "dlc")) return true;
    // Ludhiana variants
    if (us.includes("ludhiana") && (os.includes("ludhiana") || os === "ldhc" || os === "llc")) return true;
    return false;
};

export default function StoreManagerDashboard() {
    const navigate = useNavigate();
    const dropdownRef = useRef(null);

    // Core state
    const [loading, setLoading] = useState(true);
    const [orders, setOrders] = useState([]);
    const [products, setProducts] = useState([]);
    const [salespersonTable, setSalespersonTable] = useState([]);
    const [currentUserEmail, setCurrentUserEmail] = useState("");
    const [currentUserName, setCurrentUserName] = useState("");
    const [userStore, setUserStore] = useState("");

    // UI
    const [activeTab, setActiveTab] = useState("sales");
    const [showSidebar, setShowSidebar] = useState(false);
    const [timeline, setTimeline] = useState("monthly");
    const [customDateFrom, setCustomDateFrom] = useState("");
    const [customDateTo, setCustomDateTo] = useState("");
    const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);

    // Orders tab
    const [orderSearch, setOrderSearch] = useState("");
    const [statusTab, setStatusTab] = useState("all");
    const [ordersPage, setOrdersPage] = useState(1);
    const [sortBy, setSortBy] = useState("newest");

    // Client book
    const [clientSearch, setClientSearch] = useState("");
    const [clientPage, setClientPage] = useState(1);
    const [clientSort, setClientSort] = useState("totalSpend");

    // Inventory LXRTS
    const [variantInventory, setVariantInventory] = useState({});
    const [expandedProduct, setExpandedProduct] = useState(null);
    const [lxrtsSyncLoading, setLxrtsSyncLoading] = useState(false);

    // ═══════════════════════════════════════════════════════════
    // AUTH & FETCH
    // ═══════════════════════════════════════════════════════════
    useEffect(() => {
        const checkAuthAndFetch = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) { navigate("/login", { replace: true }); return; }

            const { data: userRecord } = await supabase
                .from("salesperson")
                .select("role, saleperson, store_name")
                .eq("email", session.user.email?.toLowerCase())
                .single();

            if (!userRecord || userRecord.role !== "store_manager") {
                await supabase.auth.signOut();
                navigate("/login", { replace: true });
                return;
            }

            setCurrentUserEmail(session.user.email?.toLowerCase() || "");
            setCurrentUserName(userRecord.saleperson || "");
            setUserStore(userRecord.store_name || "");
            fetchAllData();
        };
        checkAuthAndFetch();
    }, [navigate]);

    const fetchAllData = async () => {
        setLoading(true);
        try {
            const [ordersRes, productsRes, spRes] = await Promise.all([
                fetchAllRows("orders", (q) => q.select("*").order("created_at", { ascending: false })),
                supabase.from("products").select("*").order("name", { ascending: true }),
                supabase.from("salesperson").select("saleperson, role, email, phone, store_name, sales_target, designation"),
            ]);
            if (ordersRes.data) setOrders(ordersRes.data);
            if (productsRes.data) setProducts(productsRes.data);
            if (spRes.data) setSalespersonTable(spRes.data);
        } catch (err) { console.error("Error fetching data:", err); }
        finally { setLoading(false); }
    };

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) { };
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleLogout = async () => { await supabase.auth.signOut(); navigate("/login"); };

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
                    if (variants) { const map = {}; variants.forEach(v => { map[v.size] = v.inventory || 0; }); inventoryMap[product.id] = map; }
                }
            } catch (err) {
                console.error(`Error syncing ${product.name}:`, err);
                const { data: variants } = await supabase.from("product_variants").select("size, inventory").eq("product_id", product.id);
                if (variants) { const map = {}; variants.forEach(v => { map[v.size] = v.inventory || 0; }); inventoryMap[product.id] = map; }
            }
        }));
        setVariantInventory(inventoryMap);
        setLxrtsSyncLoading(false);
    };

    const getLxrtsTotalInventory = (productId) => {
        const variants = variantInventory[productId];
        if (!variants) return 0;
        return Object.values(variants).reduce((sum, qty) => sum + (qty || 0), 0);
    };

    const SIZE_ORDER_LIST = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL", "6XL"];
    const getProductSizes = (productId) => {
        const variants = variantInventory[productId];
        if (!variants) return [];
        const knownSizes = SIZE_ORDER_LIST.filter(s => variants[s] !== undefined);
        const extraSizes = Object.keys(variants).filter(s => !SIZE_ORDER_LIST.includes(s)).sort();
        return [...knownSizes, ...extraSizes];
    };

    // ═══════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════
    const isLxrtsOrder = (order) => order.items?.[0]?.sync_enabled === true;

    // ★ CORE FILTER: only this store's orders (no B2B, no LXRTS)
    const storeOrders = useMemo(() => {
        return orders.filter(o => {
            if (isLxrtsOrder(o)) return false;
            if ((o.salesperson_store || "").toLowerCase() === "b2b") return false;
            return storeMatches(o.salesperson_store, userStore);
        });
    }, [orders, userStore]);

    const getOrderSalesperson = (order) => order.salesperson || null;

    const knownStoreNames = useMemo(() => {
        const stores = new Set();
        orders.forEach(o => { const s = (o.salesperson_store || "").trim(); if (s) stores.add(s); });
        return stores;
    }, [orders]);

    const isPersonName = (name) => name && name !== "-" && name !== "Unknown" && !knownStoreNames.has(name);

    const getPaymentStatus = (order) => {
        const total = order.grand_total || order.net_total || 0;
        const advance = order.advance_payment || 0;
        if (advance >= total) return "paid";
        if (advance > 0) return "partial";
        return "unpaid";
    };

    const storeSAs = useMemo(() => {
        return salespersonTable.filter(sp =>
            (sp.role === "salesperson" || sp.role === "sa_services") &&
            storeMatches(sp.store_name, userStore)
        );
    }, [salespersonTable, userStore]);

    const storeLabel = userStore.includes("udhiana") ? "Ludhiana" : userStore.includes("elhi") ? "Delhi" : userStore;

    // ═══════════════════════════════════════════════════════════
    // DATE HELPERS
    // ═══════════════════════════════════════════════════════════
    const getDateRange = (tv) => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        switch (tv) {
            case "today": return { start: today, end: now };
            case "yesterday": { const y = new Date(today); y.setDate(y.getDate() - 1); const ye = new Date(today); ye.setMilliseconds(-1); return { start: y, end: ye }; }
            case "weekly": { const w = new Date(today); w.setDate(w.getDate() - 7); return { start: w, end: now }; }
            case "monthly": { const m = new Date(today); m.setDate(m.getDate() - 30); return { start: m, end: now }; }
            case "yearly": { const yr = new Date(today); yr.setDate(yr.getDate() - 365); return { start: yr, end: now }; }
            case "custom": return { start: customDateFrom ? new Date(customDateFrom) : new Date(0), end: customDateTo ? new Date(customDateTo + "T23:59:59") : now };
            default: return { start: today, end: now };
        }
    };

    const filterByDate = (list, range) => {
        if (!range) return list;
        return list.filter(o => { const d = new Date(o.created_at); return d >= range.start && d <= range.end; });
    };

    // ═══════════════════════════════════════════════════════════
    // TAB 1: SALES OVERVIEW
    // ═══════════════════════════════════════════════════════════
    const salesStats = useMemo(() => {
        const dateRange = getDateRange(timeline);
        const period = filterByDate(storeOrders, dateRange);

        const totalRevenue = period.reduce((s, o) => s + Number(o.grand_total || 0), 0);
        const totalOrders = period.length;
        const totalItems = period.reduce((s, o) => s + (o.items?.reduce((q, it) => q + (it.quantity || 1), 0) || 0), 0);
        const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const totalDiscount = period.reduce((s, o) => s + Number(o.discount_amount || 0), 0);

        // Daily buckets
        const buckets = {};
        period.forEach(o => {
            const d = new Date(o.created_at);
            const key = d.toISOString().split("T")[0];
            const label = `${d.getDate()}/${d.getMonth() + 1}`;
            if (!buckets[key]) buckets[key] = { date: label, fullDate: key, revenue: 0, orders: 0 };
            buckets[key].revenue += Number(o.grand_total || 0);
            buckets[key].orders += 1;
        });
        const dailySales = Object.values(buckets)
            .sort((a, b) => a.fullDate.localeCompare(b.fullDate))
            .map(b => ({ ...b, aov: b.orders > 0 ? Math.round(b.revenue / b.orders) : 0 }));

        // Payment status breakdown
        const paid = period.filter(o => getPaymentStatus(o) === "paid").length;
        const partial = period.filter(o => getPaymentStatus(o) === "partial").length;
        const unpaid = period.filter(o => getPaymentStatus(o) === "unpaid").length;

        return { totalRevenue, totalOrders, totalItems, aov, totalDiscount, dailySales, paid, partial, unpaid };
    }, [storeOrders, timeline, customDateFrom, customDateTo]);

    // ═══════════════════════════════════════════════════════════
    // TAB 2: SA PERFORMANCE
    // ═══════════════════════════════════════════════════════════
    const saPerformance = useMemo(() => {
        const dateRange = getDateRange(timeline);
        const period = filterByDate(storeOrders, dateRange);

        const saMap = {};
        period.forEach(o => {
            const sp = getOrderSalesperson(o);
            if (!sp || !isPersonName(sp)) return;
            if (!saMap[sp]) saMap[sp] = { name: sp, revenue: 0, orders: 0, items: 0, discount: 0, delivered: 0, cancelled: 0 };
            saMap[sp].revenue += Number(o.grand_total || 0);
            saMap[sp].orders += 1;
            saMap[sp].items += (o.items?.reduce((q, it) => q + (it.quantity || 1), 0) || 0);
            saMap[sp].discount += Number(o.discount_amount || 0);
            if (o.status === "delivered" || o.status === "completed") saMap[sp].delivered += 1;
            if (o.status === "cancelled") saMap[sp].cancelled += 1;
        });

        const saList = Object.values(saMap).sort((a, b) => b.revenue - a.revenue).map(sa => ({
            ...sa, aov: sa.orders > 0 ? Math.round(sa.revenue / sa.orders) : 0,
        }));

        // Target info from salesperson table
        const saWithTargets = saList.map(sa => {
            const spRecord = salespersonTable.find(s => s.saleperson === sa.name);
            return { ...sa, target: Number(spRecord?.sales_target || 0) };
        });

        return { saList: saWithTargets };
    }, [storeOrders, timeline, customDateFrom, customDateTo, salespersonTable]);

    // ═══════════════════════════════════════════════════════════
    // TAB 3: ORDERS
    // ═══════════════════════════════════════════════════════════
    const filteredByStatus = useMemo(() => {
        return storeOrders.filter(o => {
            const s = o.status?.toLowerCase();
            switch (statusTab) {
                case "in_progress": return s !== "delivered" && s !== "completed" && s !== "cancelled";
                case "delivered": return s === "delivered" || s === "completed";
                case "cancelled": return s === "cancelled";
                default: return true;
            }
        });
    }, [storeOrders, statusTab]);

    const filteredOrders = useMemo(() => {
        let result = filteredByStatus;
        if (orderSearch.trim()) {
            const q = orderSearch.toLowerCase();
            result = result.filter(o => {
                const item = o.items?.[0] || {};
                return o.order_no?.toLowerCase().includes(q) ||
                    item.product_name?.toLowerCase().includes(q) ||
                    o.delivery_name?.toLowerCase().includes(q) ||
                    o.delivery_phone?.includes(q) ||
                    (getOrderSalesperson(o) || "").toLowerCase().includes(q);
            });
        }
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
    }, [filteredByStatus, orderSearch, sortBy]);

    const orderTabCounts = useMemo(() => ({
        all: storeOrders.length,
        in_progress: storeOrders.filter(o => { const s = o.status?.toLowerCase(); return s !== "delivered" && s !== "completed" && s !== "cancelled"; }).length,
        delivered: storeOrders.filter(o => o.status === "delivered" || o.status === "completed").length,
        cancelled: storeOrders.filter(o => o.status?.toLowerCase() === "cancelled").length,
    }), [storeOrders]);

    const ordersTotalPages = Math.ceil(filteredOrders.length / ITEMS_PER_PAGE);
    const currentOrders = useMemo(() => filteredOrders.slice((ordersPage - 1) * ITEMS_PER_PAGE, ordersPage * ITEMS_PER_PAGE), [filteredOrders, ordersPage]);

    // ═══════════════════════════════════════════════════════════
    // TAB 4: RETURNS & ISSUES
    // ═══════════════════════════════════════════════════════════
    const returnsStats = useMemo(() => {
        const dateRange = getDateRange(timeline);
        const period = filterByDate(storeOrders, dateRange);

        const cancelled = period.filter(o => o.status === "cancelled");
        const returned = period.filter(o => o.return_reason);
        const refunded = period.filter(o => o.refund_reason);
        const exchanged = period.filter(o => o.exchange_reason);
        const revoked = period.filter(o => o.revoked_at);

        const analyzeReasons = (items, field) => {
            const map = {};
            items.forEach(o => { const r = o[field] || "Not specified"; map[r] = (map[r] || 0) + 1; });
            return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
        };

        // SA-wise issues
        const saIssues = {};
        [...cancelled, ...returned, ...refunded, ...exchanged, ...revoked].forEach(o => {
            const sp = getOrderSalesperson(o);
            if (!sp || !isPersonName(sp)) return;
            if (!saIssues[sp]) saIssues[sp] = { name: sp, cancellations: 0, returns: 0, refunds: 0, exchanges: 0, revokes: 0, value: 0 };
            if (o.status === "cancelled") saIssues[sp].cancellations++;
            if (o.return_reason) saIssues[sp].returns++;
            if (o.refund_reason) saIssues[sp].refunds++;
            if (o.exchange_reason) saIssues[sp].exchanges++;
            if (o.revoked_at) saIssues[sp].revokes++;
            saIssues[sp].value += Number(o.grand_total || 0);
        });

        return {
            cancelledCount: cancelled.length, cancelledValue: cancelled.reduce((s, o) => s + Number(o.grand_total || 0), 0),
            returnedCount: returned.length, returnedValue: returned.reduce((s, o) => s + Number(o.grand_total || 0), 0),
            refundedCount: refunded.length, refundedValue: refunded.reduce((s, o) => s + Number(o.grand_total || 0), 0),
            exchangedCount: exchanged.length, exchangedValue: exchanged.reduce((s, o) => s + Number(o.grand_total || 0), 0),
            revokedCount: revoked.length,
            cancellationReasons: analyzeReasons(cancelled, "cancellation_reason"),
            returnReasons: analyzeReasons(returned, "return_reason"),
            refundReasons: analyzeReasons(refunded, "refund_reason"),
            exchangeReasons: analyzeReasons(exchanged, "exchange_reason"),
            saIssues: Object.values(saIssues).sort((a, b) => (b.cancellations + b.returns + b.refunds + b.exchanges + b.revokes) - (a.cancellations + a.returns + a.refunds + a.exchanges + a.revokes)),
        };
    }, [storeOrders, timeline, customDateFrom, customDateTo]);

    // ═══════════════════════════════════════════════════════════
    // TAB 5: INVENTORY
    // ═══════════════════════════════════════════════════════════
    const inventoryStats = useMemo(() => {
        let totalInventory = 0, lowStock = 0, outOfStock = 0;
        products.forEach(p => {
            const qty = p.sync_enabled ? getLxrtsTotalInventory(p.id) : (p.inventory || 0);
            if (qty === 9999) return; // MTO
            totalInventory += qty;
            if (qty === 0) outOfStock++;
            else if (qty < 5) lowStock++;
        });

        // Stock aging: products with inventory but no recent sales
        const dateRange = getDateRange(timeline);
        const recentOrders = filterByDate(storeOrders, dateRange);
        const soldProductNames = new Set();
        recentOrders.forEach(o => (o.items || []).forEach(it => { if (it.product_name) soldProductNames.add(it.product_name); }));
        const slowMoving = products.filter(p => {
            const inv = p.inventory || 0;
            return inv > 0 && inv !== 9999 && !soldProductNames.has(p.name);
        });

        return { total: products.length, totalInventory, lowStock, outOfStock, slowMovingCount: slowMoving.length, slowMoving: slowMoving.slice(0, 20) };
    }, [products, storeOrders, timeline, customDateFrom, customDateTo, variantInventory]);

    // ═══════════════════════════════════════════════════════════
    // TAB 6: CLIENT BOOK
    // ═══════════════════════════════════════════════════════════
    const clientBook = useMemo(() => {
        const clientMap = {};
        storeOrders.forEach(order => {
            const phone = order.delivery_phone || order.phone;
            const name = order.delivery_name || "Unknown";
            if (!phone) return;
            if (!clientMap[phone]) {
                clientMap[phone] = {
                    name, phone, city: order.delivery_city || order.city || "-",
                    totalSpend: 0, orderCount: 0, items: 0,
                    firstOrder: order.created_at, lastOrder: order.created_at,
                };
            }
            const c = clientMap[phone];
            c.totalSpend += Number(order.grand_total || 0);
            c.orderCount += 1;
            c.items += (order.items?.reduce((q, it) => q + (it.quantity || 1), 0) || 0);
            if (new Date(order.created_at) < new Date(c.firstOrder)) c.firstOrder = order.created_at;
            if (new Date(order.created_at) > new Date(c.lastOrder)) c.lastOrder = order.created_at;
            if (c.name === "Unknown" && name !== "Unknown") c.name = name;
        });

        let clients = Object.values(clientMap).map(c => ({
            ...c, aov: c.orderCount > 0 ? c.totalSpend / c.orderCount : 0,
        }));

        // Search
        if (clientSearch.trim()) {
            const q = clientSearch.toLowerCase();
            clients = clients.filter(c => c.name?.toLowerCase().includes(q) || c.phone?.includes(q) || c.city?.toLowerCase().includes(q));
        }

        // Sort
        if (clientSort === "totalSpend") clients.sort((a, b) => b.totalSpend - a.totalSpend);
        else if (clientSort === "orderCount") clients.sort((a, b) => b.orderCount - a.orderCount);
        else if (clientSort === "recent") clients.sort((a, b) => new Date(b.lastOrder) - new Date(a.lastOrder));

        const totalClients = clients.length;
        const repeatClients = clients.filter(c => c.orderCount > 1).length;
        const repeatRate = totalClients > 0 ? ((repeatClients / totalClients) * 100).toFixed(1) : 0;

        const segmentation = [
            { name: "One-time", value: clients.filter(c => c.orderCount === 1).length },
            { name: "Repeat (2-3)", value: clients.filter(c => c.orderCount >= 2 && c.orderCount <= 3).length },
            { name: "Loyal (4+)", value: clients.filter(c => c.orderCount >= 4).length },
        ];

        const totalPages = Math.ceil(clients.length / ITEMS_PER_PAGE);
        const current = clients.slice((clientPage - 1) * ITEMS_PER_PAGE, clientPage * ITEMS_PER_PAGE);

        return { totalClients, repeatRate, segmentation, current, totalPages };
    }, [storeOrders, clientSearch, clientSort, clientPage]);

    // ═══════════════════════════════════════════════════════════
    // TAB 7: ALTERATIONS
    // ═══════════════════════════════════════════════════════════
    const alterationStats = useMemo(() => {
        const dateRange = getDateRange(timeline);
        const period = filterByDate(storeOrders, dateRange);
        const alterations = period.filter(o => o.is_alteration);
        const totalOrders = period.length;
        const alterationRate = totalOrders > 0 ? ((alterations.length / totalOrders) * 100).toFixed(1) : 0;

        // By outfit
        const outfitMap = {};
        alterations.forEach(o => {
            (o.items || []).forEach(it => {
                const name = it.product_name || "Unknown";
                if (!outfitMap[name]) outfitMap[name] = { name, count: 0 };
                outfitMap[name].count += 1;
            });
        });
        const byOutfit = Object.values(outfitMap).sort((a, b) => b.count - a.count).slice(0, 10);

        // By customer
        const custMap = {};
        alterations.forEach(o => {
            const name = o.delivery_name || "Unknown";
            if (!custMap[name]) custMap[name] = { name, count: 0 };
            custMap[name].count += 1;
        });
        const byCustomer = Object.values(custMap).sort((a, b) => b.count - a.count).slice(0, 10);

        // By SA
        const saMap = {};
        alterations.forEach(o => {
            const sp = getOrderSalesperson(o);
            if (!sp || !isPersonName(sp)) return;
            if (!saMap[sp]) saMap[sp] = { name: sp, count: 0 };
            saMap[sp].count += 1;
        });
        const bySA = Object.values(saMap).sort((a, b) => b.count - a.count);

        // Flagged (3+ alterations on same outfit)
        const flagged = byOutfit.filter(a => a.count >= 3);

        return { total: alterations.length, alterationRate, byOutfit, byCustomer, bySA, flagged };
    }, [storeOrders, timeline, customDateFrom, customDateTo]);

    // Resets
    useEffect(() => { setOrdersPage(1); }, [orderSearch, statusTab, sortBy]);
    useEffect(() => { setClientPage(1); }, [clientSearch, clientSort]);
    useEffect(() => {
        if (activeTab === "inventory") {
            const lxrtsProducts = products.filter(p => p.sync_enabled);
            if (lxrtsProducts.length > 0 && Object.keys(variantInventory).length === 0) fetchAllLxrtsInventory(lxrtsProducts);
        }
    }, [activeTab, products]);

    const handleTimelineChange = (v) => { setTimeline(v); setShowCustomDatePicker(v === "custom"); };

    // ═══════════════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════════════
    if (loading) {
        return (<div className="sm-page"><div className="sm-loading"><div className="sm-spinner"></div><p>Loading Store Manager Dashboard...</p></div></div>);
    }

    return (
        <div className="sm-page">
            {/* HEADER */}
            <header className="sm-header">
                <div className="sm-header-left">
                    <button className="sm-hamburger" onClick={() => setShowSidebar(!showSidebar)}><span /><span /><span /></button>
                    <img src={Logo} alt="Logo" className="sm-logo" />
                </div>
                <h1 className="sm-title">{storeLabel} Store Manager</h1>
                <div className="sm-header-right">
                    <NotificationBell userEmail={currentUserEmail} onOrderClick={() => { }} />
                    <button className="sm-logout-btn" onClick={handleLogout}>Logout</button>
                </div>
            </header>

            <div className="sm-layout">
                {/* SIDEBAR */}
                <aside className={`sm-sidebar ${showSidebar ? "open" : ""}`}>
                    <nav className="sm-nav">
                        <span className="sm-nav-section">Dashboard</span>
                        {[
                            { key: "sales", label: "Sales Overview" },
                            { key: "sa_performance", label: "SA Performance" },
                            { key: "orders", label: "Orders" },
                            { key: "returns", label: "Returns & Issues" },
                            { key: "inventory", label: "Store Inventory" },
                            { key: "clients", label: "Client Book" },
                            { key: "alterations", label: "Alterations" },
                        ].map(tab => (
                            <button key={tab.key} className={`sm-nav-item ${activeTab === tab.key ? "active" : ""}`}
                                onClick={() => { setActiveTab(tab.key); setShowSidebar(false); }}>{tab.label}</button>
                        ))}
                    </nav>
                </aside>

                {/* MAIN */}
                <main className="sm-content">

                    {/* Timeline bar */}
                    {["sales", "sa_performance", "returns", "inventory", "alterations"].includes(activeTab) && (
                        <div className="sm-filters-bar">
                            <div className="sm-timeline-pills">
                                {TIMELINE_OPTIONS.map(opt => (
                                    <button key={opt.value} className={`sm-pill ${timeline === opt.value ? "active" : ""}`} onClick={() => handleTimelineChange(opt.value)}>{opt.label}</button>
                                ))}
                            </div>
                            {showCustomDatePicker && (
                                <div className="sm-date-range">
                                    <input type="date" value={customDateFrom} onChange={(e) => setCustomDateFrom(e.target.value)} />
                                    <span className="sm-date-sep">{"\u2192"}</span>
                                    <input type="date" value={customDateTo} onChange={(e) => setCustomDateTo(e.target.value)} />
                                </div>
                            )}
                        </div>
                    )}

                    {/* ═══════════ TAB 1: SALES OVERVIEW ═══════════ */}
                    {activeTab === "sales" && (
                        <div>
                            <h2 className="sm-section-title">{storeLabel} Store {"\u2014"} Sales Overview</h2>
                            <div className="sm-stats-grid">
                                <div className="sm-stat-card"><span className="sm-stat-label">Revenue</span><span className="sm-stat-value">{"\u20B9"}{formatIndianNumber(Math.round(salesStats.totalRevenue))}</span></div>
                                <div className="sm-stat-card"><span className="sm-stat-label">Orders</span><span className="sm-stat-value">{salesStats.totalOrders}</span></div>
                                <div className="sm-stat-card"><span className="sm-stat-label">Items Sold</span><span className="sm-stat-value">{salesStats.totalItems}</span></div>
                                <div className="sm-stat-card"><span className="sm-stat-label">AOV</span><span className="sm-stat-value">{"\u20B9"}{formatIndianNumber(Math.round(salesStats.aov))}</span></div>
                                <div className="sm-stat-card"><span className="sm-stat-label">Discounts</span><span className="sm-stat-value">{"\u20B9"}{formatIndianNumber(Math.round(salesStats.totalDiscount))}</span></div>
                            </div>

                            {/* Payment status */}
                            <div className="sm-stats-grid" style={{ marginTop: 16 }}>
                                <div className="sm-stat-card sm-paid"><span className="sm-stat-label">Paid</span><span className="sm-stat-value">{salesStats.paid}</span></div>
                                <div className="sm-stat-card sm-partial"><span className="sm-stat-label">Partial</span><span className="sm-stat-value">{salesStats.partial}</span></div>
                                <div className="sm-stat-card sm-unpaid"><span className="sm-stat-label">Unpaid</span><span className="sm-stat-value">{salesStats.unpaid}</span></div>
                            </div>

                            {/* Daily sales chart */}
                            {salesStats.dailySales.length > 1 && (
                                <div className="sm-chart-card" style={{ marginTop: 24 }}>
                                    <h3 className="sm-chart-title">Daily Revenue</h3>
                                    <ResponsiveContainer width="100%" height={320}>
                                        <AreaChart data={salesStats.dailySales} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                                            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                                            <YAxis tickFormatter={(v) => `\u20B9${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} tickLine={false} />
                                            <Tooltip content={<ChartTooltip />} />
                                            <Legend />
                                            <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#d5b85a" fill="rgba(213,184,90,0.15)" strokeWidth={2} />
                                            <Line type="monotone" dataKey="aov" name="AOV" stroke="#8B7355" strokeWidth={2} dot={false} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            )}

                            {/* Daily table */}
                            {salesStats.dailySales.length > 0 && (
                                <div className="sm-table-wrapper" style={{ marginTop: 16 }}>
                                    <table className="sm-table">
                                        <thead><tr><th>Date</th><th className="amount">Revenue</th><th>Orders</th><th className="amount">AOV</th></tr></thead>
                                        <tbody>
                                            {salesStats.dailySales.map(d => (
                                                <tr key={d.fullDate}><td>{d.date}</td><td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(d.revenue))}</td><td>{d.orders}</td><td className="amount">{"\u20B9"}{formatIndianNumber(d.aov)}</td></tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ═══════════ TAB 2: SA PERFORMANCE ═══════════ */}
                    {activeTab === "sa_performance" && (
                        <div>
                            <h2 className="sm-section-title">SA-wise Performance</h2>

                            {/* Store Roster */}
                            <h3 className="sm-subsection-title">Store Roster ({storeSAs.length} SAs)</h3>
                            <div className="sm-table-wrapper">
                                <table className="sm-table">
                                    <thead><tr><th>Name</th><th>Designation</th><th>Phone</th><th>Email</th></tr></thead>
                                    <tbody>
                                        {storeSAs.length === 0 ? <tr><td colSpan="4" className="sm-no-data">No SAs found for {storeLabel}</td></tr> :
                                            storeSAs.map(sa => (
                                                <tr key={sa.email}><td style={{ fontWeight: 500 }}>{sa.saleperson}</td><td>{sa.designation || "-"}</td><td>{sa.phone || "-"}</td><td>{sa.email || "-"}</td></tr>
                                            ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* SA Sales */}
                            <h3 className="sm-subsection-title" style={{ marginTop: 24 }}>Sales Performance</h3>
                            {saPerformance.saList.length > 0 ? (
                                <>
                                    <div className="sm-chart-card">
                                        <ResponsiveContainer width="100%" height={300}>
                                            <BarChart data={saPerformance.saList} layout="vertical" margin={{ top: 5, right: 40, left: 5, bottom: 5 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={false} />
                                                <XAxis type="number" tickFormatter={v => `\u20B9${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11, fill: '#888' }} axisLine={false} />
                                                <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#444' }} width={120} axisLine={false} tickLine={false} />
                                                <Tooltip content={<ChartTooltip />} />
                                                <Bar dataKey="revenue" fill="#d5b85a" name="Revenue" radius={[0, 4, 4, 0]} barSize={22} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>

                                    <div className="sm-table-wrapper" style={{ marginTop: 16 }}>
                                        <table className="sm-table">
                                            <thead><tr><th>SA Name</th><th className="amount">Revenue</th><th>Orders</th><th>Items</th><th className="amount">AOV</th><th className="amount">Discount</th><th>Delivered</th><th>Cancelled</th></tr></thead>
                                            <tbody>
                                                {saPerformance.saList.map(sa => (
                                                    <tr key={sa.name}>
                                                        <td style={{ fontWeight: 500 }}>{sa.name}</td>
                                                        <td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(sa.revenue))}</td>
                                                        <td>{sa.orders}</td><td>{sa.items}</td>
                                                        <td className="amount">{"\u20B9"}{formatIndianNumber(sa.aov)}</td>
                                                        <td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(sa.discount))}</td>
                                                        <td style={{ color: '#2e7d32' }}>{sa.delivered}</td>
                                                        <td style={{ color: sa.cancelled > 0 ? '#c62828' : 'inherit' }}>{sa.cancelled}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            ) : <p className="sm-no-data">No SA data available</p>}
                        </div>
                    )}

                    {/* ═══════════ TAB 3: ORDERS ═══════════ */}
                    {activeTab === "orders" && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                                <h2 className="sm-section-title">{storeLabel} Orders</h2>
                                <button className="sm-logout-btn" onClick={async () => {
                                    const { data: { session } } = await supabase.auth.getSession();
                                    if (session) {
                                        sessionStorage.setItem("associateSession", JSON.stringify({
                                            access_token: session.access_token,
                                            refresh_token: session.refresh_token,
                                            user: { email: session.user?.email },
                                        }));
                                    }
                                    sessionStorage.setItem("currentSalesperson", JSON.stringify({
                                        store: userStore,
                                        name: currentUserName,
                                        email: currentUserEmail,
                                    }));
                                    sessionStorage.setItem("returnDashboard", "/store-manager-dashboard");
                                    navigate("/buyerVerification");
                                }} style={{ background: '#d5b85a', color: '#fff', padding: '8px 16px', borderRadius: 6, fontWeight: 600 }}>
                                    + Place Order
                                </button>
                            </div>
                            <div className="sm-toolbar">
                                <div className="sm-search-wrapper">
                                    <input type="text" placeholder="Search Order #, Customer, Product..." value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} className="sm-search-input" />
                                    {orderSearch && <button className="sm-search-clear" onClick={() => setOrderSearch("")}>{"\u00D7"}</button>}
                                </div>
                                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="sm-sort-select">
                                    <option value="newest">Newest First</option><option value="oldest">Oldest First</option>
                                    <option value="delivery">Delivery Date</option><option value="amount_high">Amount: High</option><option value="amount_low">Amount: Low</option>
                                </select>
                            </div>

                            <div className="sm-status-tabs">
                                {STATUS_TABS.map(tab => (
                                    <button key={tab.value} className={`sm-status-tab ${statusTab === tab.value ? "active" : ""}`} onClick={() => setStatusTab(tab.value)}>
                                        {tab.label}<span className="sm-tab-count">{orderTabCounts[tab.value]}</span>
                                    </button>
                                ))}
                            </div>

                            <div className="sm-orders-count">Showing {filteredOrders.length} orders</div>

                            <div className="sm-table-wrapper">
                                <table className="sm-table">
                                    <thead><tr><th>Order ID</th><th>Customer</th><th>Product</th><th className="amount">Amount</th><th>Payment</th><th>Status</th><th>SA</th><th>Date</th><th>Journey</th></tr></thead>
                                    <tbody>
                                        {currentOrders.length === 0 ? <tr><td colSpan="9" className="sm-no-data">No orders found</td></tr> :
                                            currentOrders.map(o => (
                                                <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => {
                                                    sessionStorage.setItem("currentSalesperson", JSON.stringify({
                                                        store: userStore,
                                                        name: currentUserName,
                                                        email: currentUserEmail,
                                                    }));
                                                    sessionStorage.setItem("returnDashboard", "/store-manager-dashboard");
                                                    navigate("/orderHistory", {
                                                        state: {
                                                            customer: {
                                                                user_id: o.user_id,
                                                                name: o.delivery_name,
                                                                email: o.delivery_email,
                                                                phone: o.delivery_phone,
                                                            },
                                                            fromAssociate: true,
                                                            readOnly: false,
                                                            saEmail: null,
                                                            isServices: true,
                                                        }
                                                    });
                                                }}>
                                                    <td><span className="sm-order-id">{o.order_no || "-"}</span></td>
                                                    <td>{o.delivery_name || "-"}</td>
                                                    <td className="sm-product-cell">{o.items?.[0]?.product_name || "-"}</td>
                                                    <td className="amount">{"\u20B9"}{formatIndianNumber(o.grand_total || 0)}</td>
                                                    <td><span className={`sm-payment-badge ${getPaymentStatus(o)}`}>{getPaymentStatus(o)}</span></td>
                                                    <td><span className={`sm-status-badge ${(o.status === "pending" ? "order_received" : (o.status || "order_received"))}`}>{o.status === "pending" ? "Order Received" : (o.status === "order_received" ? "Order Received" : (o.status || "Order Received"))}</span></td>
                                                    <td>{getOrderSalesperson(o) || "-"}</td>
                                                    <td>{formatDate(o.created_at)}</td>
                                                    <td>
                                                        <div style={{ fontSize: 11, lineHeight: 1.4 }}>
                                                            {o.in_production_at && <div>{"\u2705"} Production: {formatDate(o.in_production_at)}</div>}
                                                            {o.ready_for_dispatch_at && <div>{"\u2705"} Ready: {formatDate(o.ready_for_dispatch_at)}</div>}
                                                            {o.dispatched_at && <div>{"\u2705"} Dispatched: {formatDate(o.dispatched_at)}</div>}
                                                            {o.delivered_at && <div>{"\u2705"} Delivered: {formatDate(o.delivered_at)}</div>}
                                                            {!o.in_production_at && !o.dispatched_at && !o.delivered_at && <span style={{ color: '#999' }}>Pending</span>}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                    </tbody>
                                </table>
                            </div>
                            {ordersTotalPages > 1 && (
                                <div className="sm-pagination">
                                    <button onClick={() => setOrdersPage(p => Math.max(1, p - 1))} disabled={ordersPage === 1}>Prev</button>
                                    <span>Page {ordersPage} of {ordersTotalPages}</span>
                                    <button onClick={() => setOrdersPage(p => Math.min(ordersTotalPages, p + 1))} disabled={ordersPage === ordersTotalPages}>Next</button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ═══════════ TAB 4: RETURNS & ISSUES ═══════════ */}
                    {activeTab === "returns" && (
                        <div>
                            <h2 className="sm-section-title">Returns, Cancellations & Issues</h2>
                            <div className="sm-stats-grid">
                                <div className="sm-stat-card"><span className="sm-stat-label">Cancellations</span><span className="sm-stat-value">{returnsStats.cancelledCount}</span><span className="sm-stat-sub">{"\u20B9"}{formatIndianNumber(Math.round(returnsStats.cancelledValue))}</span></div>
                                <div className="sm-stat-card"><span className="sm-stat-label">Returns</span><span className="sm-stat-value">{returnsStats.returnedCount}</span><span className="sm-stat-sub">{"\u20B9"}{formatIndianNumber(Math.round(returnsStats.returnedValue))}</span></div>
                                <div className="sm-stat-card"><span className="sm-stat-label">Refunds</span><span className="sm-stat-value">{returnsStats.refundedCount}</span><span className="sm-stat-sub">{"\u20B9"}{formatIndianNumber(Math.round(returnsStats.refundedValue))}</span></div>
                                <div className="sm-stat-card"><span className="sm-stat-label">Exchanges</span><span className="sm-stat-value">{returnsStats.exchangedCount}</span><span className="sm-stat-sub">{"\u20B9"}{formatIndianNumber(Math.round(returnsStats.exchangedValue))}</span></div>
                                <div className="sm-stat-card"><span className="sm-stat-label">Revoked</span><span className="sm-stat-value">{returnsStats.revokedCount}</span></div>
                            </div>

                            {returnsStats.cancellationReasons.length > 0 && (
                                <div className="sm-chart-card" style={{ marginTop: 24 }}>
                                    <h3 className="sm-chart-title">Cancellation Reasons</h3>
                                    <ResponsiveContainer width="100%" height={250}>
                                        <BarChart data={returnsStats.cancellationReasons.slice(0, 8)} layout="vertical">
                                            <CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis type="number" /><YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={180} />
                                            <Tooltip /><Bar dataKey="value" fill="#f44336" name="Count" radius={[0, 4, 4, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}

                            {returnsStats.returnReasons.length > 0 && (
                                <div className="sm-chart-card" style={{ marginTop: 20 }}>
                                    <h3 className="sm-chart-title">Return Reasons</h3>
                                    <ResponsiveContainer width="100%" height={250}>
                                        <BarChart data={returnsStats.returnReasons.slice(0, 8)} layout="vertical">
                                            <CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis type="number" /><YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={180} />
                                            <Tooltip /><Bar dataKey="value" fill="#ff9800" name="Count" radius={[0, 4, 4, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}

                            {returnsStats.saIssues.length > 0 && (
                                <>
                                    <h3 className="sm-subsection-title" style={{ marginTop: 24 }}>SA-wise Issues</h3>
                                    <div className="sm-table-wrapper">
                                        <table className="sm-table">
                                            <thead><tr><th>SA</th><th>Cancel</th><th>Return</th><th>Refund</th><th>Exchange</th><th>Revoke</th><th className="amount">Value</th></tr></thead>
                                            <tbody>
                                                {returnsStats.saIssues.map(sa => (
                                                    <tr key={sa.name}><td>{sa.name}</td><td>{sa.cancellations}</td><td>{sa.returns}</td><td>{sa.refunds}</td><td>{sa.exchanges}</td><td>{sa.revokes}</td><td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(sa.value))}</td></tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* ═══════════ TAB 5: INVENTORY ═══════════ */}
                    {activeTab === "inventory" && (
                        <div>
                            <h2 className="sm-section-title">Store Inventory</h2>
                            <div className="sm-stats-grid">
                                <div className="sm-stat-card"><span className="sm-stat-label">Total Products</span><span className="sm-stat-value">{inventoryStats.total}</span></div>
                                <div className="sm-stat-card"><span className="sm-stat-label">Total Stock</span><span className="sm-stat-value">{formatIndianNumber(inventoryStats.totalInventory)} pcs</span></div>
                                <div className="sm-stat-card"><span className="sm-stat-label">Low Stock (&lt;5)</span><span className="sm-stat-value" style={{ color: '#ef6c00' }}>{inventoryStats.lowStock}</span></div>
                                <div className="sm-stat-card"><span className="sm-stat-label">Out of Stock</span><span className="sm-stat-value" style={{ color: '#c62828' }}>{inventoryStats.outOfStock}</span></div>
                                <div className="sm-stat-card"><span className="sm-stat-label">Slow Moving</span><span className="sm-stat-value" style={{ color: '#7b1fa2' }}>{inventoryStats.slowMovingCount}</span></div>
                            </div>

                            {/* Full inventory table with LXRTS */}
                            <h3 className="sm-subsection-title" style={{ marginTop: 24 }}>
                                All Products {lxrtsSyncLoading && <span style={{ fontSize: 12, color: '#999' }}>(Syncing LXRTS...)</span>}
                            </h3>
                            <div className="sm-table-wrapper">
                                <table className="sm-table">
                                    <thead><tr><th>Product</th><th>SKU</th><th>Type</th><th>Stock</th></tr></thead>
                                    <tbody>
                                        {products.length === 0 ? <tr><td colSpan="4" className="sm-no-data">No products found</td></tr> :
                                            products.map(p => {
                                                const qty = p.sync_enabled ? getLxrtsTotalInventory(p.id) : (p.inventory || 0);
                                                return (
                                                    <React.Fragment key={p.id}>
                                                        <tr>
                                                            <td>
                                                                {p.sync_enabled && <span style={{ background: '#e3f2fd', color: '#1565c0', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, marginRight: 6 }}>LXRTS</span>}
                                                                {p.name || "-"}
                                                                {p.sync_enabled && (
                                                                    <button onClick={() => setExpandedProduct(expandedProduct === p.id ? null : p.id)}
                                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', marginLeft: 6, fontSize: 12, color: '#d5b85a' }}>
                                                                        {expandedProduct === p.id ? "\u25B2" : "\u25BC"}
                                                                    </button>
                                                                )}
                                                            </td>
                                                            <td>{p.sku_id || "-"}</td>
                                                            <td>{p.sync_enabled ? "LXRTS" : "Regular"}</td>
                                                            <td><span style={{ color: qty === 0 ? '#c62828' : qty < 5 ? '#ef6c00' : '#2e7d32', fontWeight: 600 }}>{qty}</span></td>
                                                        </tr>
                                                        {p.sync_enabled && expandedProduct === p.id && (
                                                            <tr><td colSpan="4" style={{ background: '#fafafa', padding: '8px 16px' }}>
                                                                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                                                    {getProductSizes(p.id).map(size => (
                                                                        <div key={size} style={{ textAlign: 'center', padding: '4px 10px', background: '#fff', border: '1px solid #eee', borderRadius: 6, minWidth: 50 }}>
                                                                            <div style={{ fontSize: 11, color: '#888' }}>{size}</div>
                                                                            <div style={{ fontWeight: 600, color: (variantInventory[p.id]?.[size] || 0) === 0 ? '#c62828' : '#2e7d32' }}>
                                                                                {variantInventory[p.id]?.[size] ?? "..."}
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </td></tr>
                                                        )}
                                                    </React.Fragment>
                                                );
                                            })}
                                    </tbody>
                                </table>
                            </div>

                            {/* Slow moving */}
                            {inventoryStats.slowMoving.length > 0 && (
                                <>
                                    <h3 className="sm-subsection-title" style={{ marginTop: 24 }}>Slow Moving Products (No sales in period)</h3>
                                    <div className="sm-table-wrapper">
                                        <table className="sm-table">
                                            <thead><tr><th>Product</th><th>SKU</th><th>Stock</th></tr></thead>
                                            <tbody>
                                                {inventoryStats.slowMoving.map(p => (
                                                    <tr key={p.id}><td>{p.name}</td><td>{p.sku_id || "-"}</td><td>{p.inventory}</td></tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* ═══════════ TAB 6: CLIENT BOOK ═══════════ */}
                    {activeTab === "clients" && (
                        <div>
                            <h2 className="sm-section-title">{storeLabel} Client Book</h2>
                            <div className="sm-stats-grid">
                                <div className="sm-stat-card"><span className="sm-stat-label">Total Clients</span><span className="sm-stat-value">{clientBook.totalClients}</span></div>
                                <div className="sm-stat-card"><span className="sm-stat-label">Repeat Rate</span><span className="sm-stat-value">{clientBook.repeatRate}%</span></div>
                            </div>

                            {/* Segmentation pie */}
                            {clientBook.segmentation.some(s => s.value > 0) && (
                                <div className="sm-chart-card" style={{ marginTop: 16 }}>
                                    <h3 className="sm-chart-title">Client Segmentation</h3>
                                    <ResponsiveContainer width="100%" height={280}>
                                        <PieChart>
                                            <Pie data={clientBook.segmentation.filter(s => s.value > 0)} cx="50%" cy="45%" innerRadius={50} outerRadius={90} dataKey="value"
                                                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`} labelLine={true}>
                                                {clientBook.segmentation.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                                            </Pie>
                                            <Tooltip /><Legend verticalAlign="bottom" height={36} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            )}

                            {/* Search & sort */}
                            <div className="sm-toolbar" style={{ marginTop: 20 }}>
                                <div className="sm-search-wrapper">
                                    <input type="text" placeholder="Search name, phone, city..." value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} className="sm-search-input" />
                                    {clientSearch && <button className="sm-search-clear" onClick={() => setClientSearch("")}>{"\u00D7"}</button>}
                                </div>
                                <select value={clientSort} onChange={(e) => setClientSort(e.target.value)} className="sm-sort-select">
                                    <option value="totalSpend">Highest Spend</option><option value="orderCount">Most Orders</option><option value="recent">Most Recent</option>
                                </select>
                            </div>

                            <div className="sm-table-wrapper">
                                <table className="sm-table">
                                    <thead><tr><th>#</th><th>Name</th><th>Phone</th><th>City</th><th>Orders</th><th>Items</th><th className="amount">Total Spend</th><th className="amount">AOV</th><th>Last Order</th></tr></thead>
                                    <tbody>
                                        {clientBook.current.length === 0 ? <tr><td colSpan="9" className="sm-no-data">No clients found</td></tr> :
                                            clientBook.current.map((c, idx) => (
                                                <tr key={c.phone}>
                                                    <td>{(clientPage - 1) * ITEMS_PER_PAGE + idx + 1}</td>
                                                    <td style={{ fontWeight: 500 }}>{c.name}</td><td>{c.phone}</td><td>{c.city}</td>
                                                    <td>{c.orderCount}</td><td>{c.items}</td>
                                                    <td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(c.totalSpend))}</td>
                                                    <td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(c.aov))}</td>
                                                    <td>{formatDate(c.lastOrder)}</td>
                                                </tr>
                                            ))}
                                    </tbody>
                                </table>
                            </div>
                            {clientBook.totalPages > 1 && (
                                <div className="sm-pagination">
                                    <button onClick={() => setClientPage(p => Math.max(1, p - 1))} disabled={clientPage === 1}>Prev</button>
                                    <span>Page {clientPage} of {clientBook.totalPages}</span>
                                    <button onClick={() => setClientPage(p => Math.min(clientBook.totalPages, p + 1))} disabled={clientPage === clientBook.totalPages}>Next</button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ═══════════ TAB 7: ALTERATIONS ═══════════ */}
                    {activeTab === "alterations" && (
                        <div>
                            <h2 className="sm-section-title">Alterations</h2>
                            <div className="sm-stats-grid">
                                <div className="sm-stat-card"><span className="sm-stat-label">Total Alterations</span><span className="sm-stat-value">{alterationStats.total}</span></div>
                                <div className="sm-stat-card"><span className="sm-stat-label">Alteration Rate</span><span className="sm-stat-value">{alterationStats.alterationRate}%</span></div>
                                <div className="sm-stat-card"><span className="sm-stat-label">Flagged (3+)</span><span className="sm-stat-value" style={{ color: alterationStats.flagged.length > 0 ? '#c62828' : '#2e7d32' }}>{alterationStats.flagged.length}</span></div>
                            </div>

                            {/* By Outfit */}
                            {alterationStats.byOutfit.length > 0 && (
                                <div className="sm-chart-card" style={{ marginTop: 24 }}>
                                    <h3 className="sm-chart-title">By Outfit</h3>
                                    <ResponsiveContainer width="100%" height={300}>
                                        <BarChart data={alterationStats.byOutfit} layout="vertical" margin={{ top: 5, right: 30, left: 5, bottom: 5 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={false} />
                                            <XAxis type="number" /><YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={160} tickFormatter={v => v.length > 22 ? v.substring(0, 22) + "\u2026" : v} />
                                            <Tooltip /><Bar dataKey="count" fill="#C9A94E" name="Alterations" radius={[0, 4, 4, 0]} barSize={18} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}

                            {/* By Customer */}
                            {alterationStats.byCustomer.length > 0 && (
                                <div className="sm-chart-card" style={{ marginTop: 20 }}>
                                    <h3 className="sm-chart-title">By Customer</h3>
                                    <ResponsiveContainer width="100%" height={300}>
                                        <BarChart data={alterationStats.byCustomer} layout="vertical" margin={{ top: 5, right: 30, left: 5, bottom: 5 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={false} />
                                            <XAxis type="number" /><YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
                                            <Tooltip /><Bar dataKey="count" fill="#A67C52" name="Alterations" radius={[0, 4, 4, 0]} barSize={18} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}

                            {/* By SA */}
                            {alterationStats.bySA.length > 0 && (
                                <>
                                    <h3 className="sm-subsection-title" style={{ marginTop: 24 }}>SA-wise Alterations</h3>
                                    <div className="sm-table-wrapper">
                                        <table className="sm-table">
                                            <thead><tr><th>SA Name</th><th>Alteration Count</th></tr></thead>
                                            <tbody>
                                                {alterationStats.bySA.map(sa => (<tr key={sa.name}><td>{sa.name}</td><td>{sa.count}</td></tr>))}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )}

                            {/* Flagged */}
                            {alterationStats.flagged.length > 0 && (
                                <>
                                    <h3 className="sm-subsection-title" style={{ marginTop: 24, color: '#c62828' }}>Flagged: 3+ Alterations on Same Outfit</h3>
                                    <div className="sm-table-wrapper">
                                        <table className="sm-table">
                                            <thead><tr><th>Outfit</th><th>Count</th><th>Status</th></tr></thead>
                                            <tbody>
                                                {alterationStats.flagged.map(a => (
                                                    <tr key={a.name} className="sm-flagged-row"><td>{a.name}</td><td>{a.count}</td><td><span className="sm-status-badge cancelled">Needs Review</span></td></tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                </main>
            </div>
        </div>
    );
}