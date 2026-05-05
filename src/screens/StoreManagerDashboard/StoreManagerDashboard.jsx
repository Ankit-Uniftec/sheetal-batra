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
    // RM-style filters (copied pattern). orderType kept for parity even though
    // SM doesn't currently filter on it — leaves the door open.
    const [filters, setFilters] = useState({
        dateFrom: "", dateTo: "", minPrice: 0, maxPrice: 500000,
        payment: [], priority: [], orderType: [], salesperson: ""
    });
    const [openDropdown, setOpenDropdown] = useState(null);

    // Returns tab — drill-down list when a stat-card number is clicked
    const [returnsDrillType, setReturnsDrillType] = useState(null);

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

        // Extras breakdown — count `included` (no extra cost) vs `excluded`
        // (charged separately). An extra with price > 0 = paid/excluded;
        // price === 0 (or missing) = bundled/included.
        let extrasIncluded = 0, extrasExcluded = 0;
        period.forEach(o => (o.items || []).forEach(it => {
            (it.extras || []).forEach(ex => {
                const p = Number(ex.price || 0);
                if (p > 0) extrasExcluded += 1;
                else extrasIncluded += 1;
            });
        }));
        const extrasTotal = extrasIncluded + extrasExcluded;

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

        return { totalRevenue, totalOrders, totalItems, aov, totalDiscount, dailySales, paid, partial, unpaid, extrasIncluded, extrasExcluded, extrasTotal };
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

        // Filter chip logic — mirrors RM dashboard (filters.dateFrom, etc.)
        if (filters.dateFrom || filters.dateTo) {
            result = result.filter(o => {
                const d = new Date(o.created_at);
                if (filters.dateFrom && d < new Date(filters.dateFrom)) return false;
                if (filters.dateTo && d > new Date(filters.dateTo + "T23:59:59")) return false;
                return true;
            });
        }
        if (filters.minPrice > 0 || filters.maxPrice < 500000) {
            result = result.filter(o => {
                const total = o.grand_total || o.net_total || 0;
                return total >= filters.minPrice && total <= filters.maxPrice;
            });
        }
        if (filters.payment.length > 0) result = result.filter(o => filters.payment.includes(getPaymentStatus(o)));
        if (filters.priority.length > 0) result = result.filter(o => filters.priority.includes((o.order_flag || "Normal").toLowerCase()));
        if (filters.salesperson) result = result.filter(o => getOrderSalesperson(o) === filters.salesperson);

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
    }, [filteredByStatus, orderSearch, sortBy, filters]);

    // Filter helpers — RM-style
    const appliedFilters = useMemo(() => {
        const chips = [];
        if (filters.dateFrom || filters.dateTo) {
            const label = filters.dateFrom && filters.dateTo
                ? `${filters.dateFrom} to ${filters.dateTo}`
                : filters.dateFrom ? `From ${filters.dateFrom}` : `Until ${filters.dateTo}`;
            chips.push({ type: "date", label });
        }
        if (filters.minPrice > 0 || filters.maxPrice < 500000) {
            chips.push({ type: "price", label: `₹${(filters.minPrice / 1000).toFixed(0)}K - ₹${(filters.maxPrice / 1000).toFixed(0)}K` });
        }
        filters.payment.forEach(p => chips.push({ type: "payment", value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }));
        filters.priority.forEach(p => chips.push({ type: "priority", value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }));
        if (filters.salesperson) chips.push({ type: "salesperson", label: filters.salesperson });
        return chips;
    }, [filters]);

    const removeFilter = (type, value) => {
        if (type === "date") setFilters(prev => ({ ...prev, dateFrom: "", dateTo: "" }));
        else if (type === "price") setFilters(prev => ({ ...prev, minPrice: 0, maxPrice: 500000 }));
        else if (type === "salesperson") setFilters(prev => ({ ...prev, salesperson: "" }));
        else setFilters(prev => ({ ...prev, [type]: prev[type].filter(v => v !== value) }));
    };

    const clearAllFilters = () => setFilters({
        dateFrom: "", dateTo: "", minPrice: 0, maxPrice: 500000,
        payment: [], priority: [], orderType: [], salesperson: ""
    });

    const toggleFilter = (category, value) => setFilters(prev => ({
        ...prev,
        [category]: prev[category].includes(value)
            ? prev[category].filter(v => v !== value)
            : [...prev[category], value]
    }));

    // List of unique salespersons (for the dropdown)
    const salespersonOptions = useMemo(() => {
        const set = new Set();
        storeOrders.forEach(o => {
            const sp = getOrderSalesperson(o);
            if (sp && isPersonName(sp)) set.add(sp);
        });
        return Array.from(set).sort();
    }, [storeOrders]);

    // CSV Export — uses real-time sale data (grand_total, advance_payment,
    // discount_amount, store_credit_used) from the order rows. Not MRP.
    const exportOrdersCsv = () => {
        const escape = (v) => {
            if (v === null || v === undefined) return "";
            const s = String(v).replace(/"/g, '""');
            return /[",\n]/.test(s) ? `"${s}"` : s;
        };
        const headers = [
            "Order No", "Order Date", "Delivery Date", "Customer", "Phone",
            "Salesperson", "Status", "Payment Status", "Mode of Payment",
            "Order Value (₹)", "Discount (₹)", "Store Credit Used (₹)",
            "Advance Paid (₹)", "Net Sale (₹)", "QTY",
        ];
        const rows = filteredOrders.map(o => {
            const qty = o.items?.reduce((q, it) => q + (it.quantity || 1), 0) || 0;
            const grand = Number(o.grand_total || 0);
            const discount = Number(o.discount_amount || 0);
            const credit = Number(o.store_credit_used || 0);
            const advance = Number(o.advance_payment || 0);
            // Real-time net sale = grand_total minus discount and store credit
            // (advance is what customer paid so far; net is what was actually
            // realised from the customer for the goods).
            const netSale = grand - discount - credit;
            return [
                o.order_no || "",
                o.created_at ? new Date(o.created_at).toLocaleDateString("en-GB") : "",
                o.delivery_date ? new Date(o.delivery_date).toLocaleDateString("en-GB") : "",
                o.delivery_name || "",
                o.delivery_phone || "",
                getOrderSalesperson(o) || "",
                o.status || "",
                getPaymentStatus(o),
                o.payment_mode || "",
                grand,
                discount,
                credit,
                advance,
                netSale,
                qty,
            ].map(escape).join(",");
        });
        const csv = [headers.join(","), ...rows].join("\n");
        const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const stamp = new Date().toISOString().slice(0, 10);
        a.download = `${storeLabel}-orders-${stamp}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

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

        // SA who handled the most cancellations (top of saIssues sorted by cancellation count)
        const saIssuesList = Object.values(saIssues);
        const topCancelSA = saIssuesList
            .filter(s => s.cancellations > 0)
            .sort((a, b) => b.cancellations - a.cancellations)[0] || null;

        return {
            cancelledCount: cancelled.length, cancelledValue: cancelled.reduce((s, o) => s + Number(o.grand_total || 0), 0),
            returnedCount: returned.length, returnedValue: returned.reduce((s, o) => s + Number(o.grand_total || 0), 0),
            refundedCount: refunded.length, refundedValue: refunded.reduce((s, o) => s + Number(o.grand_total || 0), 0),
            exchangedCount: exchanged.length, exchangedValue: exchanged.reduce((s, o) => s + Number(o.grand_total || 0), 0),
            revokedCount: revoked.length,
            // ↓ raw arrays kept so the drill-down list can render the actual orders
            cancelled, returned, refunded, exchanged, revoked,
            cancellationReasons: analyzeReasons(cancelled, "cancellation_reason"),
            returnReasons: analyzeReasons(returned, "return_reason"),
            refundReasons: analyzeReasons(refunded, "refund_reason"),
            exchangeReasons: analyzeReasons(exchanged, "exchange_reason"),
            saIssues: saIssuesList.sort((a, b) => (b.cancellations + b.returns + b.refunds + b.exchanges + b.revokes) - (a.cancellations + a.returns + a.refunds + a.exchanges + a.revokes)),
            topCancelSA,
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
                    name, phone,
                    // City is tracked privately so we can build cohorts; not
                    // shown in the table per spec.
                    city: (order.delivery_city || order.city || "").trim(),
                    state: (order.delivery_state || "").trim(),
                    totalSpend: 0, orderCount: 0, qty: 0,
                    refunds: 0,
                    storeCredit: 0,
                    firstOrder: order.created_at, lastOrder: order.created_at,
                };
            }
            const c = clientMap[phone];
            c.totalSpend += Number(order.grand_total || 0);
            c.orderCount += 1;
            c.qty += (order.items?.reduce((q, it) => q + (it.quantity || 1), 0) || 0);
            // Refunds — there's no refund_amount column. The refund flow
            // (OrderHistory.handleRefund) sets status='refund_requested' +
            // refund_reason + refund_status, and the modal text states
            // "Full refund will be initiated". So we treat the full
            // grand_total as the refund amount when any of those flags are set.
            const isRefund = order.status === "refund_requested" ||
                !!order.refund_reason ||
                !!order.refund_status;
            if (isRefund) {
                c.refunds += Number(order.grand_total || 0);
            }
            // Store credit applied to the order at checkout
            c.storeCredit += Number(order.store_credit_used || 0);
            // Use the most recent non-empty city/state we see for this client
            const newDate = new Date(order.created_at);
            if (newDate > new Date(c.lastOrder)) c.lastOrder = order.created_at;
            if (newDate < new Date(c.firstOrder)) c.firstOrder = order.created_at;
            const oCity = (order.delivery_city || order.city || "").trim();
            const oState = (order.delivery_state || "").trim();
            if (!c.city && oCity) c.city = oCity;
            if (!c.state && oState) c.state = oState;
            if (c.name === "Unknown" && name !== "Unknown") c.name = name;
        });

        // Full unfiltered, unsorted list — used as the source of truth for
        // top clients + cohorts so neither is affected by the search box.
        const allClients = Object.values(clientMap).map(c => ({
            ...c, aov: c.orderCount > 0 ? c.totalSpend / c.orderCount : 0,
        }));

        // ─── Top Clients (top 5 by spend, full-store regardless of search) ───
        const topClients = [...allClients]
            .sort((a, b) => b.totalSpend - a.totalSpend)
            .slice(0, 5);

        // ─── Cohorts by city ───
        // Buckets each client by their primary city, then aggregates client
        // count + revenue per bucket. "—" bucket holds clients with no
        // delivery city (e.g. store pickup).
        const cohortMap = {};
        allClients.forEach(c => {
            const key = c.city || "(No city)";
            if (!cohortMap[key]) cohortMap[key] = { city: key, clients: 0, revenue: 0, orders: 0 };
            cohortMap[key].clients += 1;
            cohortMap[key].revenue += c.totalSpend;
            cohortMap[key].orders += c.orderCount;
        });
        const cohorts = Object.values(cohortMap)
            .sort((a, b) => b.clients - a.clients);

        // ─── Searchable + sortable table list ───
        let clients = allClients;
        if (clientSearch.trim()) {
            const q = clientSearch.toLowerCase();
            clients = clients.filter(c =>
                c.name?.toLowerCase().includes(q) ||
                c.phone?.includes(q) ||
                c.city?.toLowerCase().includes(q)
            );
        }
        if (clientSort === "totalSpend") clients.sort((a, b) => b.totalSpend - a.totalSpend);
        else if (clientSort === "orderCount") clients.sort((a, b) => b.orderCount - a.orderCount);
        else if (clientSort === "recent") clients.sort((a, b) => new Date(b.lastOrder) - new Date(a.lastOrder));

        const totalClients = allClients.length;            // FULL store count
        const filteredCount = clients.length;              // After search
        const repeatClients = allClients.filter(c => c.orderCount > 1).length;
        const repeatRate = totalClients > 0 ? ((repeatClients / totalClients) * 100).toFixed(1) : 0;

        const segmentation = [
            { name: "One-time", value: allClients.filter(c => c.orderCount === 1).length },
            { name: "Repeat (2-3)", value: allClients.filter(c => c.orderCount >= 2 && c.orderCount <= 3).length },
            { name: "Loyal (4+)", value: allClients.filter(c => c.orderCount >= 4).length },
        ];

        const totalPages = Math.ceil(clients.length / ITEMS_PER_PAGE);
        const current = clients.slice((clientPage - 1) * ITEMS_PER_PAGE, clientPage * ITEMS_PER_PAGE);

        return { totalClients, filteredCount, repeatRate, segmentation, current, totalPages, topClients, cohorts };
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
    useEffect(() => { setOrdersPage(1); }, [orderSearch, statusTab, sortBy, filters]);

    // Close filter dropdowns when clicking outside
    useEffect(() => {
        const onDoc = (e) => {
            if (!e.target.closest(".sm-filter-dropdown")) setOpenDropdown(null);
        };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, []);
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
                            { key: "roster", label: "Store Roster" },
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
                                <div className="sm-stat-card"><span className="sm-stat-label">QTY</span><span className="sm-stat-value">{salesStats.totalItems}</span></div>
                                <div className="sm-stat-card"><span className="sm-stat-label">AOV</span><span className="sm-stat-value">{"\u20B9"}{formatIndianNumber(Math.round(salesStats.aov))}</span></div>
                                <div className="sm-stat-card"><span className="sm-stat-label">Discounts</span><span className="sm-stat-value">{"\u20B9"}{formatIndianNumber(Math.round(salesStats.totalDiscount))}</span></div>
                                <div className="sm-stat-card">
                                    <span className="sm-stat-label">Extra Items Sold</span>
                                    <span className="sm-stat-value">{salesStats.extrasTotal}</span>
                                    <span className="sm-stat-sub" style={{ fontSize: 11, marginTop: 4 }}>
                                        <span style={{ color: '#2e7d32' }}>+{salesStats.extrasIncluded} incl.</span>
                                        {" / "}
                                        <span style={{ color: '#c62828' }}>+{salesStats.extrasExcluded} excl.</span>
                                    </span>
                                </div>
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

                            {/* SA Sales */}
                            <h3 className="sm-subsection-title">Sales Performance</h3>
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
                                            <thead><tr><th>SA Name</th><th className="amount">Revenue</th><th>Orders</th><th>QTY</th><th className="amount">AOV</th><th className="amount">Discount</th><th>Delivered</th><th>Cancelled</th></tr></thead>
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

                    {/* ═══════════ TAB: STORE ROSTER (standalone) ═══════════ */}
                    {activeTab === "roster" && (
                        <div>
                            <h2 className="sm-section-title">{storeLabel} Store Roster</h2>
                            <div className="sm-stats-grid">
                                <div className="sm-stat-card">
                                    <span className="sm-stat-label">Total SAs</span>
                                    <span className="sm-stat-value">{storeSAs.length}</span>
                                </div>
                            </div>
                            <div className="sm-table-wrapper" style={{ marginTop: 16 }}>
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
                        </div>
                    )}

                    {/* ═══════════ TAB 3: ORDERS ═══════════ */}
                    {activeTab === "orders" && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                                <h2 className="sm-section-title">{storeLabel} Orders</h2>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button
                                        className="sm-export-btn"
                                        onClick={exportOrdersCsv}
                                        title="Export filtered orders as CSV (real-time sales \u2014 not MRP)"
                                    >{"\u2B07"} Export CSV</button>
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

                            {/* \u2500\u2500\u2500 Filters (RM dashboard pattern) \u2500\u2500\u2500 */}
                            <div className="sm-filter-bar">
                                <div className="sm-filter-dropdown">
                                    <button
                                        className={`sm-filter-btn ${(filters.dateFrom || filters.dateTo) ? "active" : ""}`}
                                        onClick={() => setOpenDropdown(openDropdown === "date" ? null : "date")}
                                    >Date Range {"\u25BE"}</button>
                                    {openDropdown === "date" && (
                                        <div className="sm-dropdown-panel">
                                            <div className="sm-dropdown-title">Select Date Range</div>
                                            <div className="sm-date-inputs">
                                                <input type="date" value={filters.dateFrom} onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))} />
                                                <span>to</span>
                                                <input type="date" value={filters.dateTo} onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value }))} />
                                            </div>
                                            <button className="sm-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>
                                <div className="sm-filter-dropdown">
                                    <button
                                        className={`sm-filter-btn ${(filters.minPrice > 0 || filters.maxPrice < 500000) ? "active" : ""}`}
                                        onClick={() => setOpenDropdown(openDropdown === "price" ? null : "price")}
                                    >Price {"\u25BE"}</button>
                                    {openDropdown === "price" && (
                                        <div className="sm-dropdown-panel sm-price-panel">
                                            <div className="sm-dropdown-title">Order Value</div>
                                            <div className="sm-price-inputs">
                                                <div className="sm-price-input-wrap"><span>{"\u20B9"}</span><input type="number" value={filters.minPrice} onChange={(e) => setFilters(prev => ({ ...prev, minPrice: Math.min(Number(e.target.value), prev.maxPrice - 1000) }))} /></div>
                                                <span>to</span>
                                                <div className="sm-price-input-wrap"><span>{"\u20B9"}</span><input type="number" value={filters.maxPrice} onChange={(e) => setFilters(prev => ({ ...prev, maxPrice: Math.max(Number(e.target.value), prev.minPrice + 1000) }))} /></div>
                                            </div>
                                            <button className="sm-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>
                                <div className="sm-filter-dropdown">
                                    <button
                                        className={`sm-filter-btn ${filters.payment.length > 0 ? "active" : ""}`}
                                        onClick={() => setOpenDropdown(openDropdown === "payment" ? null : "payment")}
                                    >Payment {"\u25BE"}</button>
                                    {openDropdown === "payment" && (
                                        <div className="sm-dropdown-panel">
                                            <div className="sm-dropdown-title">Payment Status</div>
                                            {["paid", "partial", "unpaid"].map(opt => (
                                                <label key={opt} className="sm-checkbox-label">
                                                    <input type="checkbox" checked={filters.payment.includes(opt)} onChange={() => toggleFilter("payment", opt)} />
                                                    <span>{opt === "unpaid" ? "Unpaid (COD)" : opt.charAt(0).toUpperCase() + opt.slice(1)}</span>
                                                </label>
                                            ))}
                                            <button className="sm-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>
                                <div className="sm-filter-dropdown">
                                    <button
                                        className={`sm-filter-btn ${filters.priority.length > 0 ? "active" : ""}`}
                                        onClick={() => setOpenDropdown(openDropdown === "priority" ? null : "priority")}
                                    >Priority {"\u25BE"}</button>
                                    {openDropdown === "priority" && (
                                        <div className="sm-dropdown-panel">
                                            <div className="sm-dropdown-title">Priority</div>
                                            {["normal", "urgent"].map(opt => (
                                                <label key={opt} className="sm-checkbox-label">
                                                    <input type="checkbox" checked={filters.priority.includes(opt)} onChange={() => toggleFilter("priority", opt)} />
                                                    <span>{opt.charAt(0).toUpperCase() + opt.slice(1)}</span>
                                                </label>
                                            ))}
                                            <button className="sm-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>
                                <div className="sm-filter-dropdown">
                                    <select
                                        className="sm-filter-btn"
                                        style={{ cursor: 'pointer' }}
                                        value={filters.salesperson}
                                        onChange={(e) => setFilters(prev => ({ ...prev, salesperson: e.target.value }))}
                                    >
                                        <option value="">All Salespersons</option>
                                        {salespersonOptions.map(sp => <option key={sp} value={sp}>{sp}</option>)}
                                    </select>
                                </div>
                            </div>

                            {appliedFilters.length > 0 && (
                                <div className="sm-applied-filters">
                                    <span className="sm-applied-label">Applied:</span>
                                    {appliedFilters.map((chip, i) => (
                                        <span key={i} className="sm-filter-chip">
                                            {chip.label}
                                            <button onClick={() => removeFilter(chip.type, chip.value)}>{"\u00D7"}</button>
                                        </span>
                                    ))}
                                    <button className="sm-clear-all" onClick={clearAllFilters}>Clear All</button>
                                </div>
                            )}

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
                                    <thead><tr><th>Order ID</th><th>Customer</th><th>Product</th><th className="amount">Amount</th><th>Payment</th><th>Status</th><th>SA</th><th>Order Date</th><th>Journey</th></tr></thead>
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
                            {/* Stat cards \u2014 click a count to drill into the underlying orders */}
                            <div className="sm-stats-grid">
                                <button type="button" className={`sm-stat-card sm-stat-clickable ${returnsDrillType === "cancelled" ? "active" : ""}`} onClick={() => setReturnsDrillType(returnsDrillType === "cancelled" ? null : "cancelled")}>
                                    <span className="sm-stat-label">Cancellations</span>
                                    <span className="sm-stat-value">{returnsStats.cancelledCount}</span>
                                    <span className="sm-stat-sub">{"\u20B9"}{formatIndianNumber(Math.round(returnsStats.cancelledValue))}</span>
                                </button>
                                <button type="button" className={`sm-stat-card sm-stat-clickable ${returnsDrillType === "returned" ? "active" : ""}`} onClick={() => setReturnsDrillType(returnsDrillType === "returned" ? null : "returned")}>
                                    <span className="sm-stat-label">Returns</span>
                                    <span className="sm-stat-value">{returnsStats.returnedCount}</span>
                                    <span className="sm-stat-sub">{"\u20B9"}{formatIndianNumber(Math.round(returnsStats.returnedValue))}</span>
                                </button>
                                <button type="button" className={`sm-stat-card sm-stat-clickable ${returnsDrillType === "refunded" ? "active" : ""}`} onClick={() => setReturnsDrillType(returnsDrillType === "refunded" ? null : "refunded")}>
                                    <span className="sm-stat-label">Refunds</span>
                                    <span className="sm-stat-value">{returnsStats.refundedCount}</span>
                                    <span className="sm-stat-sub">{"\u20B9"}{formatIndianNumber(Math.round(returnsStats.refundedValue))}</span>
                                </button>
                                <button type="button" className={`sm-stat-card sm-stat-clickable ${returnsDrillType === "exchanged" ? "active" : ""}`} onClick={() => setReturnsDrillType(returnsDrillType === "exchanged" ? null : "exchanged")}>
                                    <span className="sm-stat-label">Exchanges</span>
                                    <span className="sm-stat-value">{returnsStats.exchangedCount}</span>
                                    <span className="sm-stat-sub">{"\u20B9"}{formatIndianNumber(Math.round(returnsStats.exchangedValue))}</span>
                                </button>
                                <button type="button" className={`sm-stat-card sm-stat-clickable ${returnsDrillType === "revoked" ? "active" : ""}`} onClick={() => setReturnsDrillType(returnsDrillType === "revoked" ? null : "revoked")}>
                                    <span className="sm-stat-label">Revoked</span>
                                    <span className="sm-stat-value">{returnsStats.revokedCount}</span>
                                </button>
                            </div>

                            {/* Top SA handling cancellations */}
                            {returnsStats.topCancelSA && (
                                <div className="sm-stats-grid" style={{ marginTop: 16 }}>
                                    <div className="sm-stat-card" style={{ borderLeft: '4px solid #c62828' }}>
                                        <span className="sm-stat-label">Top SA \u2014 Cancellations</span>
                                        <span className="sm-stat-value" style={{ fontSize: 18 }}>{returnsStats.topCancelSA.name}</span>
                                        <span className="sm-stat-sub">
                                            {returnsStats.topCancelSA.cancellations} cancellation{returnsStats.topCancelSA.cancellations !== 1 ? 's' : ''}
                                            {" \u00B7 "}
                                            {"\u20B9"}{formatIndianNumber(Math.round(returnsStats.topCancelSA.value))} value
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* Drill-down list \u2014 appears when a stat-card above is clicked */}
                            {returnsDrillType && (() => {
                                const list = returnsStats[returnsDrillType] || [];
                                const labelMap = {
                                    cancelled: "Cancelled Orders",
                                    returned: "Returned Orders",
                                    refunded: "Refunded Orders",
                                    exchanged: "Exchange Orders",
                                    revoked: "Revoked Orders",
                                };
                                const reasonField = {
                                    cancelled: "cancellation_reason",
                                    returned: "return_reason",
                                    refunded: "refund_reason",
                                    exchanged: "exchange_reason",
                                    revoked: "revoked_reason",
                                }[returnsDrillType];
                                return (
                                    <div className="sm-drilldown" style={{ marginTop: 16 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                            <h3 className="sm-subsection-title" style={{ margin: 0 }}>
                                                {labelMap[returnsDrillType]} ({list.length})
                                            </h3>
                                            <button className="sm-clear-all" onClick={() => setReturnsDrillType(null)}>Close</button>
                                        </div>
                                        {list.length === 0 ? (
                                            <p className="sm-no-data">No orders in this category for the selected period.</p>
                                        ) : (
                                            <div className="sm-table-wrapper">
                                                <table className="sm-table">
                                                    <thead>
                                                        <tr>
                                                            <th>Order ID</th>
                                                            <th>Customer</th>
                                                            <th>SA</th>
                                                            <th>Order Date</th>
                                                            <th className="amount">Amount</th>
                                                            <th>Reason</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {list.map(o => (
                                                            <tr key={o.id}>
                                                                <td><span className="sm-order-id">{o.order_no || "-"}</span></td>
                                                                <td>{o.delivery_name || "-"}</td>
                                                                <td>{getOrderSalesperson(o) || "-"}</td>
                                                                <td>{formatDate(o.created_at)}</td>
                                                                <td className="amount">{"\u20B9"}{formatIndianNumber(o.grand_total || 0)}</td>
                                                                <td>{o[reasonField] || "\u2014"}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

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
                                <div className="sm-stat-card"><span className="sm-stat-label">Number of Clients</span><span className="sm-stat-value">{clientBook.totalClients}</span></div>
                                <div className="sm-stat-card"><span className="sm-stat-label">Repeat Rate</span><span className="sm-stat-value">{clientBook.repeatRate}%</span></div>
                            </div>

                            {/* \u2500\u2500\u2500 Top Clients (top 5 by spend, full-store) \u2500\u2500\u2500 */}
                            {clientBook.topClients.length > 0 && (
                                <>
                                    <h3 className="sm-subsection-title" style={{ marginTop: 20 }}>
                                        Top Clients {"\u2014"} {storeLabel}
                                    </h3>
                                    <div className="sm-top-clients-grid">
                                        {clientBook.topClients.map((c, i) => (
                                            <div key={c.phone} className="sm-top-client-card">
                                                <div className="sm-top-client-rank">#{i + 1}</div>
                                                <div className="sm-top-client-info">
                                                    <div className="sm-top-client-name">{c.name}</div>
                                                    <div className="sm-top-client-meta">{c.phone}{c.city ? ` \u00B7 ${c.city}` : ""}</div>
                                                    <div className="sm-top-client-stats">
                                                        <span><b>{"\u20B9"}{formatIndianNumber(Math.round(c.totalSpend))}</b></span>
                                                        <span className="sm-top-client-sub">{c.orderCount} orders {"\u00B7"} {c.qty} qty</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}

                            {/* \u2500\u2500\u2500 Cohorts by city \u2500\u2500\u2500 */}
                            {clientBook.cohorts.length > 0 && (
                                <>
                                    <h3 className="sm-subsection-title" style={{ marginTop: 24 }}>
                                        Address Cohorts {"\u2014"} Clients by City
                                    </h3>
                                    <div className="sm-cohorts-row">
                                        <div className="sm-table-wrapper" style={{ flex: 1 }}>
                                            <table className="sm-table">
                                                <thead>
                                                    <tr>
                                                        <th>City</th>
                                                        <th className="amount">Clients</th>
                                                        <th className="amount">Orders</th>
                                                        <th className="amount">Revenue</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {clientBook.cohorts.slice(0, 12).map(c => (
                                                        <tr key={c.city}>
                                                            <td style={{ fontWeight: 500 }}>{c.city}</td>
                                                            <td className="amount">{c.clients}</td>
                                                            <td className="amount">{c.orders}</td>
                                                            <td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(c.revenue))}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        {clientBook.cohorts.length > 1 && (
                                            <div className="sm-chart-card" style={{ flex: 1, padding: 14 }}>
                                                <ResponsiveContainer width="100%" height={260}>
                                                    <BarChart data={clientBook.cohorts.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 20, left: 4, bottom: 4 }}>
                                                        <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={false} />
                                                        <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} />
                                                        <YAxis type="category" dataKey="city" tick={{ fontSize: 11 }} width={100} axisLine={false} tickLine={false} />
                                                        <Tooltip />
                                                        <Bar dataKey="clients" fill="#d5b85a" name="Clients" radius={[0, 4, 4, 0]} barSize={18} />
                                                    </BarChart>
                                                </ResponsiveContainer>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}

                            {/* Segmentation pie */}
                            {clientBook.segmentation.some(s => s.value > 0) && (
                                <div className="sm-chart-card" style={{ marginTop: 24 }}>
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

                            {/* Full client list \u2014 search & sort */}
                            <h3 className="sm-subsection-title" style={{ marginTop: 24 }}>
                                Full Client Book ({clientBook.totalClients} clients)
                            </h3>
                            <div className="sm-toolbar" style={{ marginTop: 8 }}>
                                <div className="sm-search-wrapper">
                                    <input type="text" placeholder="Search name, phone, or city..." value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} className="sm-search-input" />
                                    {clientSearch && <button className="sm-search-clear" onClick={() => setClientSearch("")}>{"\u00D7"}</button>}
                                </div>
                                <select value={clientSort} onChange={(e) => setClientSort(e.target.value)} className="sm-sort-select">
                                    <option value="totalSpend">Highest Spend</option><option value="orderCount">Most Orders</option><option value="recent">Most Recent</option>
                                </select>
                            </div>

                            <div className="sm-orders-count">
                                Showing {clientBook.filteredCount} of {clientBook.totalClients} clients
                                {clientSearch && " (filtered)"}
                            </div>

                            <div className="sm-table-wrapper">
                                <table className="sm-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Name</th>
                                            <th>Phone</th>
                                            <th className="amount">Orders</th>
                                            <th className="amount">QTY</th>
                                            <th className="amount">Total Spend</th>
                                            <th className="amount">AOV</th>
                                            <th className="amount">Refunds</th>
                                            <th className="amount">Store Credit</th>
                                            <th>Last Order</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {clientBook.current.length === 0 ? <tr><td colSpan="10" className="sm-no-data">No clients found</td></tr> :
                                            clientBook.current.map((c, idx) => (
                                                <tr key={c.phone}>
                                                    <td>{(clientPage - 1) * ITEMS_PER_PAGE + idx + 1}</td>
                                                    <td style={{ fontWeight: 500 }}>{c.name}</td>
                                                    <td>{c.phone}</td>
                                                    <td className="amount">{c.orderCount}</td>
                                                    <td className="amount">{c.qty}</td>
                                                    <td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(c.totalSpend))}</td>
                                                    <td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(c.aov))}</td>
                                                    <td className="amount" style={{ color: c.refunds > 0 ? '#c62828' : 'inherit' }}>
                                                        {c.refunds > 0 ? `\u20B9${formatIndianNumber(Math.round(c.refunds))}` : "\u2014"}
                                                    </td>
                                                    <td className="amount" style={{ color: c.storeCredit > 0 ? '#7b1fa2' : 'inherit' }}>
                                                        {c.storeCredit > 0 ? `\u20B9${formatIndianNumber(Math.round(c.storeCredit))}` : "\u2014"}
                                                    </td>
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