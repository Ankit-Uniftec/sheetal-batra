import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./COODashboard.css";
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
const CHART_COLORS = ["#d5b85a", "#8B7355", "#C9A94E", "#A67C52", "#D4AF37", "#BDB76B", "#DAA520", "#B8860B", "#CD853F", "#DEB887"];
const PIE_COLORS = ["#d5b85a", "#8B7355", "#C9A94E", "#A67C52", "#D4AF37"];

const ChartTooltip = ({ active, payload, label, prefix = "\u20B9", suffix = "" }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="cmo-chart-tooltip">
            <p className="cmo-chart-tooltip-label">{label}</p>
            {payload.map((entry, i) => (
                <p key={i} style={{ color: entry.color }}>{entry.name}: {prefix}{formatIndianNumber(Math.round(entry.value))}{suffix}</p>
            ))}
        </div>
    );
};

const CountTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="cmo-chart-tooltip">
            <p className="cmo-chart-tooltip-label">{label}</p>
            {payload.map((entry, i) => (<p key={i} style={{ color: entry.color }}>{entry.name}: {entry.value}</p>))}
        </div>
    );
};

export default function COODashboard() {
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

    // UI
    const [activeTab, setActiveTab] = useState("operations");
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

    // Inventory
    const [inventorySearch, setInventorySearch] = useState("");
    const [inventoryPage, setInventoryPage] = useState(1);
    const [variantInventory, setVariantInventory] = useState({});
    const [lxrtsSyncLoading, setLxrtsSyncLoading] = useState(false);
    const [expandedProduct, setExpandedProduct] = useState(null);

    // Auth
    useEffect(() => {
        const checkAuth = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) { navigate("/login", { replace: true }); return; }
            const { data: userRecord } = await supabase.from("salesperson").select("role, saleperson").eq("email", session.user.email?.toLowerCase()).single();
            if (!userRecord || userRecord.role !== "coo") {
                console.log("\u274C Access denied - not COO");
                await supabase.auth.signOut();
                navigate("/login", { replace: true });
                return;
            }
            setCurrentUserEmail(session.user.email?.toLowerCase() || "");
            fetchAllData();
        };
        checkAuth();
    }, [navigate]);

    const fetchAllData = async () => {
        setLoading(true);
        try {
            const [ordersRes, productsRes, spRes, vendorsRes, consRes] = await Promise.all([
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
            if (consRes.data) setConsignmentInventory(consRes.data);
        } catch (err) { console.error("Error:", err); }
        finally { setLoading(false); }
    };

    useEffect(() => {
        const handleClickOutside = (e) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpenDropdown(null); };
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

    // ═══════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════
    const isLxrtsOrder = (order) => order.items?.[0]?.sync_enabled === true;
    const nonLxrtsOrders = useMemo(() => orders.filter(o => !isLxrtsOrder(o)), [orders]);

    const getOrderChannel = (order) => {
        if (isLxrtsOrder(order)) return "Website";
        const store = (order.salesperson_store || "").trim();
        if (!store) return "Other";
        if (store.toLowerCase() === "b2b") return "B2B";
        return store;
    };

    const getOrderSalesperson = (order) => {
        if (order.is_b2b || (order.salesperson_store || "").toLowerCase() === "b2b") return order.merchandiser_name || order.salesperson || null;
        return order.salesperson || null;
    };

    const knownStoreNames = useMemo(() => { const s = new Set(); orders.forEach(o => { const st = (o.salesperson_store || "").trim(); if (st) s.add(st); }); return s; }, [orders]);
    const isPersonName = (name) => name && name !== "-" && name !== "Unknown" && !knownStoreNames.has(name);
    const salespersons = useMemo(() => { const s = new Set(); nonLxrtsOrders.forEach(o => { const sp = getOrderSalesperson(o); if (sp && isPersonName(sp)) s.add(sp); }); return [...s].sort(); }, [nonLxrtsOrders, knownStoreNames]);

    const getPaymentStatus = (order) => { const t = order.grand_total || 0; const a = order.advance_payment || 0; if (a >= t) return "paid"; if (a > 0) return "partial"; return "unpaid"; };
    const getPriority = (order) => (order.is_urgent || order.order_flag === "Urgent") ? "urgent" : "normal";
    const getOrderType = (order) => { if (order.is_alteration) return "alteration"; const item = order.items?.[0]; if (item?.order_type === "Custom" || item?.payment_order_type === "Custom") return "custom"; return "standard"; };

    const getLxrtsTotalInventory = (productId) => { const v = variantInventory[productId]; if (!v) return 0; return Object.values(v).reduce((s, q) => s + (q || 0), 0); };
    const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL", "6XL"];
    const getProductSizes = (productId) => {
        const variants = variantInventory[productId];
        if (!variants) return [];
        const knownSizes = SIZE_ORDER.filter(s => variants[s] !== undefined);
        const extraSizes = Object.keys(variants).filter(s => !SIZE_ORDER.includes(s)).sort();
        return [...knownSizes, ...extraSizes];
    };

    // ═══════════════════════════════════════════════════════════
    // DATE HELPERS
    // ═══════════════════════════════════════════════════════════
    const getDateRange = (tv) => {
        const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        switch (tv) {
            case "today": return { start: today, end: now };
            case "yesterday": const y = new Date(today); y.setDate(y.getDate() - 1); const ye = new Date(today); ye.setMilliseconds(-1); return { start: y, end: ye };
            case "weekly": const w = new Date(today); w.setDate(w.getDate() - 7); return { start: w, end: now };
            case "monthly": const m = new Date(today); m.setDate(m.getDate() - 30); return { start: m, end: now };
            case "yearly": const yr = new Date(today); yr.setDate(yr.getDate() - 365); return { start: yr, end: now };
            case "custom": return { start: customDateFrom ? new Date(customDateFrom) : new Date(0), end: customDateTo ? new Date(customDateTo + "T23:59:59") : now };
            default: return { start: today, end: now };
        }
    };
    const filterByDate = (list, dr) => { if (!dr) return list; return list.filter(o => { const d = new Date(o.created_at); return d >= dr.start && d <= dr.end; }); };
    const calcGrowth = (c, p) => { if (p === 0) return c > 0 ? 100 : 0; return ((c - p) / p) * 100; };
    const getPrevRange = () => {
        const cur = getDateRange(timeline);
        if (comparison === "previous_year") { const s = new Date(cur.start); s.setFullYear(s.getFullYear() - 1); const e = new Date(cur.end); e.setFullYear(e.getFullYear() - 1); return { start: s, end: e }; }
        const dur = cur.end - cur.start; const pe = new Date(cur.start); pe.setMilliseconds(-1); return { start: new Date(pe - dur), end: pe };
    };

    // ═══════════════════════════════════════════════════════════
    // TAB 1: OPERATIONS SUMMARY
    // ═══════════════════════════════════════════════════════════
    const opsStats = useMemo(() => {
        const dr = getDateRange(timeline);
        const period = filterByDate(nonLxrtsOrders, dr);
        const now = new Date();

        const inProduction = period.filter(o => o.status === "in_production");
        const activeOrders = period.filter(o => o.status !== "delivered" && o.status !== "completed" && o.status !== "cancelled");
        const delayed = activeOrders.filter(o => o.delivery_date && new Date(o.delivery_date) < now);
        const delayRate = activeOrders.length > 0 ? ((delayed.length / activeOrders.length) * 100) : 0;

        // Production efficiency: completed / (completed + active)
        const completed = period.filter(o => o.status === "delivered" || o.status === "completed");
        const received = period.length;
        const efficiency = received > 0 ? ((completed.length / received) * 100) : 0;

        // QC stats
        const qcFailed = period.filter(o => o.qc_fail_reason);
        const qcRate = received > 0 ? ((qcFailed.length / received) * 100) : 0;
        const reworkOrders = period.filter(o => o.is_rework);

        // Consignment sell-through
        const totalSent = consignmentInventory.reduce((s, c) => s + (c.quantity_sent || 0), 0);
        const totalSold = consignmentInventory.reduce((s, c) => s + (c.quantity_sold || 0), 0);
        const sellThrough = totalSent > 0 ? ((totalSold / totalSent) * 100) : 0;

        // Slow-moving: products with inventory but no sales in period
        const soldProductNames = new Set();
        period.forEach(o => (o.items || []).forEach(it => { if (it.product_name) soldProductNames.add(it.product_name); }));
        const slowMoving = products.filter(p => {
            const inv = p.sync_enabled ? getLxrtsTotalInventory(p.id) : (p.inventory || 0);
            return inv > 0 && inv !== 9999 && !soldProductNames.has(p.name);
        });

        // Orders stuck by stage
        const stageMap = {};
        activeOrders.forEach(o => {
            const stage = o.warehouse_stage || o.status || "unknown";
            if (!stageMap[stage]) stageMap[stage] = 0;
            stageMap[stage]++;
        });
        const stuckByStage = Object.entries(stageMap).map(([name, value]) => ({ name: name.replace(/_/g, " "), value })).sort((a, b) => b.value - a.value);

        // Avg production lead time (orders with both in_production_at and delivered_at/ready_for_dispatch_at)
        let totalLeadDays = 0, leadCount = 0;
        period.forEach(o => {
            if (o.in_production_at && (o.ready_for_dispatch_at || o.delivered_at)) {
                const start = new Date(o.in_production_at);
                const end = new Date(o.ready_for_dispatch_at || o.delivered_at);
                const days = (end - start) / (1000 * 60 * 60 * 24);
                if (days > 0 && days < 365) { totalLeadDays += days; leadCount++; }
            }
        });
        const avgLeadTime = leadCount > 0 ? (totalLeadDays / leadCount) : 0;

        // Dispatch: ready vs dispatched
        const readyForDispatch = period.filter(o => o.ready_for_dispatch_at && !o.dispatched_at);
        const dispatched = period.filter(o => o.dispatched_at);

        // Max backlog & delay by stage
        const delayByStage = {};
        delayed.forEach(o => {
            const stage = o.warehouse_stage || o.status || "unknown";
            if (!delayByStage[stage]) delayByStage[stage] = 0;
            delayByStage[stage]++;
        });
        const delayByStageData = Object.entries(delayByStage).map(([name, value]) => ({ name: name.replace(/_/g, " "), value })).sort((a, b) => b.value - a.value);

        // Exceeding delivery date
        const exceedingDelivery = nonLxrtsOrders.filter(o => {
            if (o.status === "delivered" || o.status === "completed" || o.status === "cancelled") return false;
            return o.delivery_date && new Date(o.delivery_date) < now;
        }).sort((a, b) => new Date(a.delivery_date) - new Date(b.delivery_date));

        return {
            inProduction: inProduction.length, delayed: delayed.length, delayRate: delayRate.toFixed(1),
            efficiency: efficiency.toFixed(1), qcFailed: qcFailed.length, qcRate: qcRate.toFixed(1),
            reworkCount: reworkOrders.length, sellThrough: sellThrough.toFixed(1), slowMoving: slowMoving.length,
            received, completed: completed.length, stuckByStage, avgLeadTime: avgLeadTime.toFixed(1),
            readyForDispatch: readyForDispatch.length, dispatched: dispatched.length,
            delayByStageData, exceedingDelivery: exceedingDelivery.slice(0, 20), exceedingCount: exceedingDelivery.length,
        };
    }, [nonLxrtsOrders, timeline, customDateFrom, customDateTo, consignmentInventory, products, variantInventory]);

    // ═══════════════════════════════════════════════════════════
    // TAB 2: BRAND PERFORMANCE
    // ═══════════════════════════════════════════════════════════
    const brandStats = useMemo(() => {
        const dr = getDateRange(timeline);
        const prevDr = comparison !== "none" ? getPrevRange() : null;
        const current = filterByDate(orders, dr);
        const prev = prevDr ? filterByDate(orders, prevDr) : [];

        const totalRevenue = current.reduce((s, o) => s + Number(o.grand_total || 0), 0);
        const prevRevenue = prev.reduce((s, o) => s + Number(o.grand_total || 0), 0);
        const totalRefund = current.filter(o => o.refund_reason).reduce((s, o) => s + Number(o.grand_total || 0), 0);
        const refundCount = current.filter(o => o.refund_reason).length;

        // Channel split
        const channelMap = {};
        current.forEach(o => {
            const ch = getOrderChannel(o);
            if (!channelMap[ch]) channelMap[ch] = { name: ch, revenue: 0, orders: 0 };
            channelMap[ch].revenue += Number(o.grand_total || 0);
            channelMap[ch].orders += 1;
        });
        const channelBreakdown = Object.values(channelMap).sort((a, b) => b.revenue - a.revenue);

        // Top categories
        const catMap = {};
        current.filter(o => o.status !== "cancelled").forEach(o => {
            (o.items || []).forEach(it => {
                const cat = it.category || it.product_name?.split(" ")[0] || "Other";
                if (!catMap[cat]) catMap[cat] = { name: cat, sales: 0, count: 0 };
                catMap[cat].sales += Number(it.price || 0) * Number(it.quantity || 1);
                catMap[cat].count += Number(it.quantity || 1);
            });
        });
        const topCategories = Object.values(catMap).sort((a, b) => b.sales - a.sales).slice(0, 8);

        // Top products
        const prodMap = {};
        current.filter(o => o.status !== "cancelled").forEach(o => {
            (o.items || []).forEach(it => {
                const name = it.product_name || "Unknown";
                if (!prodMap[name]) prodMap[name] = { name, sales: 0, count: 0 };
                prodMap[name].sales += Number(it.price || 0) * Number(it.quantity || 1);
                prodMap[name].count += Number(it.quantity || 1);
            });
        });
        const topProducts = Object.values(prodMap).sort((a, b) => b.sales - a.sales).slice(0, 10);

        // Top colors
        const colorMap = {};
        current.filter(o => o.status !== "cancelled").forEach(o => {
            (o.items || []).forEach(it => {
                const c = it.top_color?.name || it.color?.name;
                if (c && c !== "Unknown") { if (!colorMap[c]) colorMap[c] = { name: c, count: 0 }; colorMap[c].count += 1; }
            });
        });
        const topColors = Object.values(colorMap).sort((a, b) => b.count - a.count).slice(0, 5);

        return {
            totalRevenue, totalOrders: current.length,
            revenueGrowth: calcGrowth(totalRevenue, prevRevenue),
            ordersGrowth: calcGrowth(current.length, prev.length),
            showComparison: comparison !== "none",
            totalRefund, refundCount, channelBreakdown, topCategories, topProducts, topColors,
        };
    }, [orders, timeline, comparison, customDateFrom, customDateTo]);

    // ═══════════════════════════════════════════════════════════
    // TAB 5: QC & ISSUES
    // ═══════════════════════════════════════════════════════════
    const qcStats = useMemo(() => {
        const dr = getDateRange(timeline);
        const period = filterByDate(nonLxrtsOrders, dr);

        const qcFailed = period.filter(o => o.qc_fail_reason);
        const rework = period.filter(o => o.is_rework);
        const alterations = period.filter(o => o.is_alteration);
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

        const reworkRate = period.length > 0 ? ((rework.length / period.length) * 100) : 0;

        return {
            qcFailedCount: qcFailed.length, qcFailReasons: analyzeReasons(qcFailed, "qc_fail_reason"),
            reworkCount: rework.length, reworkRate: reworkRate.toFixed(1),
            alterationCount: alterations.length,
            cancelledCount: cancelled.length, cancelledValue: cancelled.reduce((s, o) => s + Number(o.grand_total || 0), 0),
            returnedCount: returned.length, returnedValue: returned.reduce((s, o) => s + Number(o.grand_total || 0), 0),
            refundedCount: refunded.length, refundedValue: refunded.reduce((s, o) => s + Number(o.grand_total || 0), 0),
            exchangedCount: exchanged.length, exchangedValue: exchanged.reduce((s, o) => s + Number(o.grand_total || 0), 0),
            revokedCount: revoked.length,
            returnReasons: analyzeReasons(returned, "return_reason"),
            refundReasons: analyzeReasons(refunded, "refund_reason"),
            cancellationReasons: analyzeReasons(cancelled, "cancellation_reason"),
            exchangeReasons: analyzeReasons(exchanged, "exchange_reason"),
        };
    }, [nonLxrtsOrders, timeline, customDateFrom, customDateTo]);

    // ═══════════════════════════════════════════════════════════
    // TAB 6: CONSIGNMENT
    // ═══════════════════════════════════════════════════════════
    const consignmentStats = useMemo(() => {
        const totalSent = consignmentInventory.reduce((s, c) => s + (c.quantity_sent || 0), 0);
        const totalSold = consignmentInventory.reduce((s, c) => s + (c.quantity_sold || 0), 0);
        const totalRemaining = consignmentInventory.reduce((s, c) => s + (c.quantity_remaining || 0), 0);
        const totalLost = consignmentInventory.reduce((s, c) => s + (c.quantity_lost || 0), 0);
        const sellThrough = totalSent > 0 ? ((totalSold / totalSent) * 100) : 0;

        // Aging: 0-60 days vs 60+ days
        const now = new Date();
        let under60 = 0, over60 = 0;
        consignmentInventory.forEach(c => {
            if ((c.quantity_remaining || 0) > 0) {
                const created = new Date(c.created_at);
                const days = (now - created) / (1000 * 60 * 60 * 24);
                if (days <= 60) under60 += c.quantity_remaining;
                else over60 += c.quantity_remaining;
            }
        });

        // By vendor
        const vendorMap = {};
        consignmentInventory.forEach(c => {
            const vid = c.vendor_id || "unknown";
            const vName = vendors.find(v => v.id === vid)?.store_brand_name || "Unknown Vendor";
            if (!vendorMap[vid]) vendorMap[vid] = { name: vName, sent: 0, sold: 0, remaining: 0, lost: 0 };
            vendorMap[vid].sent += c.quantity_sent || 0;
            vendorMap[vid].sold += c.quantity_sold || 0;
            vendorMap[vid].remaining += c.quantity_remaining || 0;
            vendorMap[vid].lost += c.quantity_lost || 0;
        });
        const byVendor = Object.values(vendorMap).sort((a, b) => b.sent - a.sent);

        // Consignment B2B orders in execution
        const dr = getDateRange(timeline);
        const consignmentOrders = filterByDate(orders.filter(o => o.b2b_order_type === "Consignment"), dr);

        // Dispatch daily/weekly/monthly
        const dispatched = filterByDate(orders.filter(o => o.dispatched_at && o.b2b_order_type === "Consignment"), dr);

        return {
            totalSent, totalSold, totalRemaining, totalLost, sellThrough: sellThrough.toFixed(1),
            under60, over60, byVendor,
            consignmentOrdersCount: consignmentOrders.length,
            dispatchedCount: dispatched.length,
        };
    }, [consignmentInventory, vendors, orders, timeline, customDateFrom, customDateTo]);

    // ═══════════════════════════════════════════════════════════
    // TAB 7: INVENTORY
    // ═══════════════════════════════════════════════════════════
    const inventoryStats = useMemo(() => {
        let totalInventory = 0, lowStock = 0, outOfStock = 0;
        products.forEach(p => {
            const qty = p.sync_enabled ? getLxrtsTotalInventory(p.id) : (p.inventory || 0);
            totalInventory += qty;
            if (qty === 0) outOfStock++;
            else if (qty < 5) lowStock++;
        });
        const consignmentValue = consignmentInventory.reduce((s, c) => s + (c.quantity_remaining || 0), 0);

        let filtered = products;
        if (inventorySearch) { const q = inventorySearch.toLowerCase(); filtered = filtered.filter(p => p.name?.toLowerCase().includes(q) || p.sku_id?.toLowerCase().includes(q)); }

        return {
            total: products.length, totalInventory, lowStock, outOfStock, consignmentValue,
            currentProducts: filtered.slice((inventoryPage - 1) * ITEMS_PER_PAGE, inventoryPage * ITEMS_PER_PAGE),
            inventoryTotalPages: Math.ceil(filtered.length / ITEMS_PER_PAGE),
        };
    }, [products, consignmentInventory, inventorySearch, inventoryPage, variantInventory]);

    // ═══════════════════════════════════════════════════════════
    // TAB 8: FINANCIAL
    // ═══════════════════════════════════════════════════════════
    const financialStats = useMemo(() => {
        const dr = getDateRange(timeline);
        const period = filterByDate(nonLxrtsOrders, dr);

        const totalGrand = period.reduce((s, o) => s + Number(o.grand_total || 0), 0);
        const totalAdvance = period.reduce((s, o) => s + Number(o.advance_payment || 0), 0);
        const totalPending = totalGrand - totalAdvance;

        // By channel
        const channelPayments = {};
        period.forEach(o => {
            const ch = getOrderChannel(o);
            if (!channelPayments[ch]) channelPayments[ch] = { name: ch, total: 0, advance: 0, pending: 0 };
            channelPayments[ch].total += Number(o.grand_total || 0);
            channelPayments[ch].advance += Number(o.advance_payment || 0);
            channelPayments[ch].pending += Math.max(0, Number(o.grand_total || 0) - Number(o.advance_payment || 0));
        });
        const byChannel = Object.values(channelPayments).sort((a, b) => b.total - a.total);

        // Payment mode breakdown
        const modeMap = {};
        period.forEach(o => {
            let modes = [];
            if (Array.isArray(o.payment_mode)) {
                modes = o.payment_mode;
            } else if (typeof o.payment_mode === "string" && o.payment_mode.startsWith("[")) {
                try { modes = JSON.parse(o.payment_mode); } catch { modes = [{ mode: o.payment_mode }]; }
            } else {
                modes = [{ mode: o.payment_mode || "Unknown" }];
            }
            modes.forEach(m => {
                const name = m.mode || m.name || "Unknown";
                if (!modeMap[name]) modeMap[name] = { name, count: 0, value: 0 };
                modeMap[name].count += 1;
                modeMap[name].value += Number(m.amount || 0) || Number(o.grand_total || 0) / modes.length;
            });
        });
        const byPaymentMode = Object.values(modeMap).sort((a, b) => b.value - a.value);

        // Unpaid orders (COD / no advance)
        const unpaidOrders = period.filter(o => {
            const total = o.grand_total || 0;
            const advance = o.advance_payment || 0;
            return advance < total && o.status !== "cancelled";
        }).sort((a, b) => (Number(b.grand_total || 0) - Number(b.advance_payment || 0)) - (Number(a.grand_total || 0) - Number(a.advance_payment || 0)));

        return { totalGrand, totalAdvance, totalPending, byChannel, byPaymentMode, unpaidCount: unpaidOrders.length };
    }, [nonLxrtsOrders, timeline, customDateFrom, customDateTo]);

    // ═══════════════════════════════════════════════════════════
    // ORDERS TAB
    // ═══════════════════════════════════════════════════════════
    const filteredByStatus = useMemo(() => nonLxrtsOrders.filter(o => {
        const s = o.status?.toLowerCase();
        switch (statusTab) {
            case "unfulfilled": return s !== "completed" && s !== "delivered" && s !== "cancelled";
            case "prepared": return s === "completed";
            case "delivered": return s === "delivered";
            case "cancelled": return s === "cancelled";
            default: return true;
        }
    }), [nonLxrtsOrders, statusTab]);

    const filteredOrders = useMemo(() => {
        let result = filteredByStatus;
        if (orderSearch.trim()) {
            const q = orderSearch.toLowerCase();
            result = result.filter(o => { const it = o.items?.[0] || {}; return o.order_no?.toLowerCase().includes(q) || it.product_name?.toLowerCase().includes(q) || o.delivery_name?.toLowerCase().includes(q) || o.delivery_phone?.includes(q) || (getOrderSalesperson(o) || "").toLowerCase().includes(q); });
        }
        if (filters.dateFrom || filters.dateTo) { result = result.filter(o => { const d = new Date(o.created_at); if (filters.dateFrom && d < new Date(filters.dateFrom)) return false; if (filters.dateTo && d > new Date(filters.dateTo + "T23:59:59")) return false; return true; }); }
        if (filters.minPrice > 0 || filters.maxPrice < 500000) { result = result.filter(o => { const t = o.grand_total || 0; return t >= filters.minPrice && t <= filters.maxPrice; }); }
        if (filters.payment.length > 0) result = result.filter(o => filters.payment.includes(getPaymentStatus(o)));
        if (filters.priority.length > 0) result = result.filter(o => filters.priority.includes(getPriority(o)));
        if (filters.store.length > 0) result = result.filter(o => filters.store.includes(o.salesperson_store));
        if (filters.salesperson) result = result.filter(o => getOrderSalesperson(o) === filters.salesperson);
        result = [...result].sort((a, b) => { switch (sortBy) { case "oldest": return new Date(a.created_at) - new Date(b.created_at); case "delivery": return new Date(a.delivery_date || 0) - new Date(b.delivery_date || 0); case "amount_high": return (b.grand_total || 0) - (a.grand_total || 0); case "amount_low": return (a.grand_total || 0) - (b.grand_total || 0); default: return new Date(b.created_at) - new Date(a.created_at); } });
        return result;
    }, [filteredByStatus, orderSearch, filters, sortBy]);

    const orderTabCounts = useMemo(() => ({ all: nonLxrtsOrders.length, unfulfilled: nonLxrtsOrders.filter(o => { const s = o.status?.toLowerCase(); return s !== "completed" && s !== "delivered" && s !== "cancelled"; }).length, prepared: nonLxrtsOrders.filter(o => o.status?.toLowerCase() === "completed").length, delivered: nonLxrtsOrders.filter(o => o.status?.toLowerCase() === "delivered").length, cancelled: nonLxrtsOrders.filter(o => o.status?.toLowerCase() === "cancelled").length }), [nonLxrtsOrders]);
    const ordersTotalPages = Math.ceil(filteredOrders.length / ITEMS_PER_PAGE);
    const currentOrders = useMemo(() => filteredOrders.slice((ordersPage - 1) * ITEMS_PER_PAGE, ordersPage * ITEMS_PER_PAGE), [filteredOrders, ordersPage]);

    const appliedFilters = useMemo(() => { const c = []; if (filters.dateFrom || filters.dateTo) c.push({ type: "date", label: `${filters.dateFrom || "..."} to ${filters.dateTo || "..."}` }); if (filters.minPrice > 0 || filters.maxPrice < 500000) c.push({ type: "price", label: `\u20B9${(filters.minPrice / 1000).toFixed(0)}K - \u20B9${(filters.maxPrice / 1000).toFixed(0)}K` }); filters.payment.forEach(p => c.push({ type: "payment", value: p, label: p.charAt(0).toUpperCase() + p.slice(1) })); filters.priority.forEach(p => c.push({ type: "priority", value: p, label: p.charAt(0).toUpperCase() + p.slice(1) })); filters.store.forEach(s => c.push({ type: "store", value: s, label: s })); if (filters.salesperson) c.push({ type: "salesperson", label: filters.salesperson }); return c; }, [filters]);
    const removeFilter = (type, value) => { if (type === "date") setFilters(p => ({ ...p, dateFrom: "", dateTo: "" })); else if (type === "price") setFilters(p => ({ ...p, minPrice: 0, maxPrice: 500000 })); else if (type === "salesperson") setFilters(p => ({ ...p, salesperson: "" })); else setFilters(p => ({ ...p, [type]: p[type].filter(v => v !== value) })); };
    const clearAllFilters = () => setFilters({ dateFrom: "", dateTo: "", minPrice: 0, maxPrice: 500000, payment: [], priority: [], orderType: [], store: [], salesperson: "" });
    const toggleFilter = (cat, val) => setFilters(p => ({ ...p, [cat]: p[cat].includes(val) ? p[cat].filter(v => v !== val) : [...p[cat], val] }));

    const updateOrderStatus = async (orderId, newStatus) => {
        setStatusUpdating(orderId);
        const ud = { status: newStatus };
        if (newStatus === "delivered") ud.delivered_at = new Date().toISOString();
        if (newStatus === "cancelled") ud.cancelled_at = new Date().toISOString();
        const { error } = await supabase.from("orders").update(ud).eq("id", orderId);
        if (error) showPopup({ title: "Error", message: "Failed to update.", type: "error" });
        else setOrders(prev => prev.map(o => o.id === orderId ? { ...o, ...ud } : o));
        setStatusUpdating(null);
    };

    const handleExportCSV = () => {
        if (filteredOrders.length === 0) return;
        const headers = ["Order No", "Product", "Customer", "Phone", "Amount", "SA", "Store", "Status", "Order Date", "Delivery Date"];
        const rows = filteredOrders.map(o => { const it = o.items?.[0] || {}; return [o.order_no || "", it.product_name || "", o.delivery_name || "", o.delivery_phone || "", o.grand_total || 0, o.salesperson || "", o.salesperson_store || "", o.status || "", o.created_at ? new Date(o.created_at).toLocaleDateString("en-GB") : "", o.delivery_date ? new Date(o.delivery_date).toLocaleDateString("en-GB") : ""].map(v => `"${String(v).replace(/"/g, '""')}"`); });
        const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `coo_orders_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
    };

    const handleGeneratePdf = async (order, type = "customer") => {
        setPdfLoading(order.id);
        try { if (type === "warehouse") await downloadWarehousePdf(order, null, true); else await downloadCustomerPdf(order); } catch (e) { console.error("PDF failed:", e); }
        finally { setPdfLoading(null); }
    };

    // Resets
    useEffect(() => { setOrdersPage(1); }, [orderSearch, statusTab, filters, sortBy]);
    useEffect(() => { setInventoryPage(1); }, [inventorySearch]);
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
    if (loading) return (<div className="admin-page"><div className="admin-loading"><div className="admin-spinner"></div><p>Loading COO Dashboard...</p></div></div>);

    return (
        <div className="admin-page">
            {PopupComponent}
            <header className="admin-header">
                <div className="admin-header-left"><button className="admin-hamburger" onClick={() => setShowSidebar(!showSidebar)}><span></span><span></span><span></span></button><img src={Logo} alt="Logo" className="admin-logo" onClick={() => navigate("/login")} /></div>
                <h1 className="admin-title">COO Dashboard</h1>
                <div className="admin-header-right"><NotificationBell userEmail={currentUserEmail} onOrderClick={() => { }} /><button className="admin-logout-btn" onClick={handleLogout}>Logout</button></div>
            </header>

            <div className="admin-layout">
                <aside className={`admin-sidebar ${showSidebar ? "open" : ""}`}>
                    <nav className="admin-nav">
                        <span className="nav-section-label">Dashboard</span>
                        <button className={`admin-nav-item ${activeTab === "operations" ? "active" : ""}`} onClick={() => { setActiveTab("operations"); setShowSidebar(false); }}>Operations Summary</button>
                        <button className={`admin-nav-item ${activeTab === "brand" ? "active" : ""}`} onClick={() => { setActiveTab("brand"); setShowSidebar(false); }}>Brand Performance</button>
                        <button className={`admin-nav-item ${activeTab === "qc_issues" ? "active" : ""}`} onClick={() => { setActiveTab("qc_issues"); setShowSidebar(false); }}>QC & Issues</button>
                        <button className={`admin-nav-item ${activeTab === "consignment" ? "active" : ""}`} onClick={() => { setActiveTab("consignment"); setShowSidebar(false); }}>Consignment</button>
                        <button className={`admin-nav-item ${activeTab === "inventory" ? "active" : ""}`} onClick={() => { setActiveTab("inventory"); setShowSidebar(false); }}>Inventory</button>
                        <button className={`admin-nav-item ${activeTab === "financial" ? "active" : ""}`} onClick={() => { setActiveTab("financial"); setShowSidebar(false); }}>Financial</button>
                        <span className="nav-section-label" style={{ marginTop: '12px' }}>Operations</span>
                        <button className={`admin-nav-item ${activeTab === "orders" ? "active" : ""}`} onClick={() => { setActiveTab("orders"); setShowSidebar(false); }}>Order Tracking</button>
                    </nav>
                </aside>

                <main className="admin-main">
                    {/* Timeline bar */}
                    {["operations", "brand", "qc_issues", "consignment", "inventory", "financial"].includes(activeTab) && (
                        <div className="cmo-filters-bar">
                            <div className="cmo-timeline-group">{TIMELINE_OPTIONS.map(opt => (<button key={opt.value} className={`cmo-pill ${timeline === opt.value ? "active" : ""}`} onClick={() => handleTimelineChange(opt.value)}>{opt.label}</button>))}</div>
                            {activeTab === "brand" && (<div className="cmo-compare-group"><select className="cmo-compare-select" value={comparison} onChange={(e) => setComparison(e.target.value)}>{COMPARISON_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>)}
                            {showCustomDatePicker && (<div className="cmo-date-range"><input type="date" value={customDateFrom} onChange={(e) => setCustomDateFrom(e.target.value)} /><span className="cmo-date-sep">{"\u2192"}</span><input type="date" value={customDateTo} onChange={(e) => setCustomDateTo(e.target.value)} /></div>)}
                        </div>
                    )}

                    {/* ═══════════ OPERATIONS SUMMARY ═══════════ */}
                    {activeTab === "operations" && (
                        <div>
                            <h2 className="admin-section-title">Current Operations Summary</h2>
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">In Production</span><span className="stat-value">{opsStats.inProduction}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Running Delayed</span><span className="stat-value" style={{ color: '#c62828' }}>{opsStats.delayed}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Delay Rate</span><span className="stat-value" style={{ color: Number(opsStats.delayRate) > 20 ? '#c62828' : '#2e7d32' }}>{opsStats.delayRate}%</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Efficiency</span><span className="stat-value">{opsStats.efficiency}%</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">QC Failure Rate</span><span className="stat-value" style={{ color: Number(opsStats.qcRate) > 5 ? '#c62828' : '#2e7d32' }}>{opsStats.qcRate}%</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Consignment Sell-Through</span><span className="stat-value">{opsStats.sellThrough}%</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Slow Moving Stock</span><span className="stat-value">{opsStats.slowMoving}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Avg Lead Time</span><span className="stat-value">{opsStats.avgLeadTime} days</span></div></div>
                            </div>

                            <h3 className="admin-subsection-title">Processed vs Received (Period)</h3>
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Orders Received</span><span className="stat-value">{opsStats.received}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Completed</span><span className="stat-value" style={{ color: '#2e7d32' }}>{opsStats.completed}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Ready for Dispatch</span><span className="stat-value">{opsStats.readyForDispatch}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Dispatched</span><span className="stat-value">{opsStats.dispatched}</span></div></div>
                            </div>

                            {opsStats.stuckByStage.length > 0 && (<>
                                <h3 className="admin-subsection-title" style={{ marginTop: 24 }}>Orders Stuck by Stage</h3>
                                <div className="admin-chart-container"><ResponsiveContainer width="100%" height={250}>
                                    <BarChart data={opsStats.stuckByStage} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis type="number" /><YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={160} /><Tooltip content={<CountTooltip />} /><Bar dataKey="value" fill="#d5b85a" name="Orders" radius={[0, 4, 4, 0]} /></BarChart>
                                </ResponsiveContainer></div>
                            </>)}

                            {opsStats.delayByStageData.length > 0 && (<>
                                <h3 className="admin-subsection-title" style={{ marginTop: 24 }}>Delays by Stage</h3>
                                <div className="admin-chart-container"><ResponsiveContainer width="100%" height={250}>
                                    <BarChart data={opsStats.delayByStageData} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis type="number" /><YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={160} /><Tooltip content={<CountTooltip />} /><Bar dataKey="value" fill="#f44336" name="Delayed" radius={[0, 4, 4, 0]} /></BarChart>
                                </ResponsiveContainer></div>
                            </>)}

                            {opsStats.exceedingCount > 0 && (<>
                                <h3 className="admin-subsection-title" style={{ marginTop: 24 }}>{"\u26A0\uFE0F"} Exceeding Delivery Date ({opsStats.exceedingCount})</h3>
                                <div className="admin-table-wrapper"><div className="admin-table-container">
                                    <table className="admin-table">
                                        <thead><tr><th>Product</th><th>SKU</th><th>Type</th><th>Stock</th></tr></thead>
                                        <tbody>
                                            {inventoryStats.currentProducts.length === 0 ? <tr><td colSpan="4" className="no-data">No products found</td></tr> :
                                                inventoryStats.currentProducts.map(p => {
                                                    const qty = p.sync_enabled ? getLxrtsTotalInventory(p.id) : (p.inventory || 0);
                                                    return (
                                                        <React.Fragment key={p.id}>
                                                            <tr className={p.sync_enabled ? "lxrts-row" : ""}>
                                                                <td className="product-cell">
                                                                    {p.sync_enabled && <span className="lxrts-badge">LXRTS</span>}
                                                                    {p.name || "-"}
                                                                    {p.sync_enabled && (
                                                                        <button className="expand-btn" onClick={() => setExpandedProduct(expandedProduct === p.id ? null : p.id)}>
                                                                            {expandedProduct === p.id ? "\u25B2" : "\u25BC"}
                                                                        </button>
                                                                    )}
                                                                </td>
                                                                <td>{p.sku_id || "-"}</td>
                                                                <td>{p.sync_enabled ? "LXRTS" : (p.inventory === 9999 ? "MTO" : "Regular")}</td>
                                                                <td><span className={qty === 0 ? "admin-stock-out" : qty < 5 ? "admin-stock-low" : "admin-stock-ok"}>{qty === 9999 ? "MTO" : qty}</span></td>
                                                            </tr>
                                                            {p.sync_enabled && expandedProduct === p.id && (
                                                                <tr className="variant-row"><td colSpan="4">
                                                                    <div className="variant-grid">
                                                                        {getProductSizes(p.id).map(size => (
                                                                            <div key={size} className="variant-cell">
                                                                                <span className="variant-size">{size}</span>
                                                                                <span className={`${(variantInventory[p.id]?.[size] || 0) === 0 ? "admin-stock-out" : (variantInventory[p.id]?.[size] || 0) < 5 ? "admin-stock-low" : "admin-stock-ok"}`}>
                                                                                    {variantInventory[p.id]?.[size] ?? "..."}
                                                                                </span>
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
                                </div></div>
                            </>)}
                        </div>
                    )}

                    {/* ═══════════ BRAND PERFORMANCE ═══════════ */}
                    {activeTab === "brand" && (
                        <div>
                            <h2 className="admin-section-title">Overall Brand Performance</h2>
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Total Revenue</span><span className="stat-value">{"\u20B9"}{formatIndianNumber(Math.round(brandStats.totalRevenue))}</span></div>
                                    {brandStats.showComparison && <span className={`stat-growth ${brandStats.revenueGrowth >= 0 ? "positive" : "negative"}`}>{brandStats.revenueGrowth >= 0 ? "\u25B2" : "\u25BC"} {Math.abs(brandStats.revenueGrowth).toFixed(1)}%</span>}</div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Total Orders</span><span className="stat-value">{brandStats.totalOrders}</span></div>
                                    {brandStats.showComparison && <span className={`stat-growth ${brandStats.ordersGrowth >= 0 ? "positive" : "negative"}`}>{brandStats.ordersGrowth >= 0 ? "\u25B2" : "\u25BC"} {Math.abs(brandStats.ordersGrowth).toFixed(1)}%</span>}</div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Refunds</span><span className="stat-value" style={{ color: '#c62828' }}>{brandStats.refundCount} ({"\u20B9"}{formatIndianNumber(Math.round(brandStats.totalRefund))})</span></div></div>
                            </div>

                            {brandStats.channelBreakdown.length > 0 && (<>
                                <h3 className="admin-subsection-title">Sales Channel Split</h3>
                                <div className="admin-chart-container"><ResponsiveContainer width="100%" height={280}>
                                    <PieChart><Pie data={brandStats.channelBreakdown} dataKey="revenue" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                                        {brandStats.channelBreakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                                    </Pie><Tooltip content={<ChartTooltip />} /></PieChart>
                                </ResponsiveContainer></div>
                            </>)}

                            {brandStats.topProducts.length > 0 && (<>
                                <h3 className="admin-subsection-title" style={{ marginTop: 24 }}>Top Products</h3>
                                <div className="admin-chart-container"><ResponsiveContainer width="100%" height={300}>
                                    <BarChart data={brandStats.topProducts} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `\u20B9${(v / 1000).toFixed(0)}K`} /><YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={150} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="sales" fill="#d5b85a" name="Revenue" radius={[0, 4, 4, 0]} /></BarChart>
                                </ResponsiveContainer></div>
                            </>)}

                            {brandStats.topColors.length > 0 && (<>
                                <h3 className="admin-subsection-title" style={{ marginTop: 24 }}>Top Colors (by qty)</h3>
                                <div className="admin-table-wrapper"><div className="admin-table-container"><table className="admin-table">
                                    <thead><tr><th>Color</th><th>Qty Sold</th></tr></thead>
                                    <tbody>{brandStats.topColors.map(c => (<tr key={c.name}><td>{c.name}</td><td>{c.count}</td></tr>))}</tbody>
                                </table></div></div>
                            </>)}
                        </div>
                    )}

                    {/* ═══════════ QC & ISSUES ═══════════ */}
                    {activeTab === "qc_issues" && (
                        <div>
                            <h2 className="admin-section-title">QC & Customer Issues</h2>
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">QC Failures</span><span className="stat-value" style={{ color: '#c62828' }}>{qcStats.qcFailedCount}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Rework Count</span><span className="stat-value">{qcStats.reworkCount}</span></div><span className="stat-sublabel">{qcStats.reworkRate}% rate</span></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Alterations</span><span className="stat-value">{qcStats.alterationCount}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Cancellations</span><span className="stat-value">{qcStats.cancelledCount}</span></div><span className="stat-sublabel">{"\u20B9"}{formatIndianNumber(Math.round(qcStats.cancelledValue))}</span></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Returns</span><span className="stat-value">{qcStats.returnedCount}</span></div><span className="stat-sublabel">{"\u20B9"}{formatIndianNumber(Math.round(qcStats.returnedValue))}</span></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Refunds</span><span className="stat-value">{qcStats.refundedCount}</span></div><span className="stat-sublabel">{"\u20B9"}{formatIndianNumber(Math.round(qcStats.refundedValue))}</span></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Exchanges</span><span className="stat-value">{qcStats.exchangedCount}</span></div><span className="stat-sublabel">{"\u20B9"}{formatIndianNumber(Math.round(qcStats.exchangedValue))}</span></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Revoked</span><span className="stat-value">{qcStats.revokedCount}</span></div></div>
                            </div>

                            {qcStats.qcFailReasons.length > 0 && (<><h3 className="admin-subsection-title" style={{ marginTop: 24 }}>QC Failure Reasons</h3><div className="admin-chart-container"><ResponsiveContainer width="100%" height={250}><BarChart data={qcStats.qcFailReasons.slice(0, 8)} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis type="number" /><YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={180} /><Tooltip /><Bar dataKey="value" fill="#f44336" name="Count" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div></>)}
                            {qcStats.cancellationReasons.length > 0 && (<><h3 className="admin-subsection-title" style={{ marginTop: 24 }}>Cancellation Reasons</h3><div className="admin-chart-container"><ResponsiveContainer width="100%" height={250}><BarChart data={qcStats.cancellationReasons.slice(0, 8)} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis type="number" /><YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={180} /><Tooltip /><Bar dataKey="value" fill="#ff9800" name="Count" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div></>)}
                            {qcStats.returnReasons.length > 0 && (<><h3 className="admin-subsection-title" style={{ marginTop: 24 }}>Return Reasons</h3><div className="admin-chart-container"><ResponsiveContainer width="100%" height={250}><BarChart data={qcStats.returnReasons.slice(0, 8)} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis type="number" /><YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={180} /><Tooltip /><Bar dataKey="value" fill="#9c27b0" name="Count" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div></>)}
                        </div>
                    )}

                    {/* ═══════════ CONSIGNMENT ═══════════ */}
                    {activeTab === "consignment" && (
                        <div>
                            <h2 className="admin-section-title">Consignment Overview</h2>
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Total Sent</span><span className="stat-value">{consignmentStats.totalSent}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Sold</span><span className="stat-value" style={{ color: '#2e7d32' }}>{consignmentStats.totalSold}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Remaining</span><span className="stat-value">{consignmentStats.totalRemaining}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Lost</span><span className="stat-value" style={{ color: '#c62828' }}>{consignmentStats.totalLost}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Sell-Through %</span><span className="stat-value">{consignmentStats.sellThrough}%</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Orders in Execution</span><span className="stat-value">{consignmentStats.consignmentOrdersCount}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Dispatched (Period)</span><span className="stat-value">{consignmentStats.dispatchedCount}</span></div></div>
                            </div>

                            <h3 className="admin-subsection-title">Aging Buckets</h3>
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">0-60 Days</span><span className="stat-value" style={{ color: '#2e7d32' }}>{consignmentStats.under60} pcs</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">60+ Days</span><span className="stat-value" style={{ color: '#c62828' }}>{consignmentStats.over60} pcs</span></div></div>
                            </div>

                            {consignmentStats.byVendor.length > 0 && (<>
                                <h3 className="admin-subsection-title" style={{ marginTop: 24 }}>By Vendor</h3>
                                <div className="admin-table-wrapper"><div className="admin-table-container"><table className="admin-table">
                                    <thead><tr><th>Vendor</th><th>Sent</th><th>Sold</th><th>Remaining</th><th>Lost</th></tr></thead>
                                    <tbody>{consignmentStats.byVendor.map(v => (<tr key={v.name}><td>{v.name}</td><td>{v.sent}</td><td style={{ color: '#2e7d32' }}>{v.sold}</td><td>{v.remaining}</td><td style={{ color: v.lost > 0 ? '#c62828' : 'inherit' }}>{v.lost}</td></tr>))}</tbody>
                                </table></div></div>
                            </>)}
                        </div>
                    )}

                    {/* ═══════════ INVENTORY ═══════════ */}
                    {activeTab === "inventory" && (
                        <div>
                            <h2 className="admin-section-title">Inventory Overview</h2>
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Total Products</span><span className="stat-value">{inventoryStats.total}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Store Stock</span><span className="stat-value">{formatIndianNumber(inventoryStats.totalInventory)} pcs</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Consignment Stock</span><span className="stat-value">{inventoryStats.consignmentValue} pcs</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Low Stock</span><span className="stat-value" style={{ color: '#ef6c00' }}>{inventoryStats.lowStock}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Out of Stock</span><span className="stat-value" style={{ color: '#c62828' }}>{inventoryStats.outOfStock}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Active LXRTS</span><span className="stat-value">{products.filter(p => p.sync_enabled).length}</span></div></div>
                            </div>

                            <h3 className="admin-subsection-title" style={{ marginTop: 24 }}>Products</h3>
                            <div className="admin-search-wrapper" style={{ maxWidth: 300, marginBottom: 12 }}><input type="text" placeholder="Search product or SKU..." value={inventorySearch} onChange={(e) => setInventorySearch(e.target.value)} className="admin-search-input" /></div>
                            <div className="admin-table-wrapper"><div className="admin-table-container"><table className="admin-table">
                                <thead><tr><th>Product</th><th>SKU</th><th>Type</th><th>Stock</th></tr></thead>
                                <tbody>{inventoryStats.currentProducts.length === 0 ? <tr><td colSpan="4" className="no-data">No products</td></tr> : inventoryStats.currentProducts.map(p => { const qty = p.sync_enabled ? getLxrtsTotalInventory(p.id) : (p.inventory || 0); return (<tr key={p.id}><td>{p.name || "-"}</td><td>{p.sku_id || "-"}</td><td>{p.sync_enabled ? "LXRTS" : (p.inventory === 9999 ? "MTO" : "Regular")}</td><td><span className={qty === 0 ? "admin-stock-out" : qty < 5 ? "admin-stock-low" : "admin-stock-ok"}>{qty === 9999 ? "MTO" : qty}</span></td></tr>); })}</tbody>
                            </table></div></div>
                            {inventoryStats.inventoryTotalPages > 1 && (<div className="admin-pagination"><button onClick={() => setInventoryPage(p => Math.max(1, p - 1))} disabled={inventoryPage === 1}>Prev</button><span>Page {inventoryPage} of {inventoryStats.inventoryTotalPages}</span><button onClick={() => setInventoryPage(p => Math.min(inventoryStats.inventoryTotalPages, p + 1))} disabled={inventoryPage === inventoryStats.inventoryTotalPages}>Next</button></div>)}
                        </div>
                    )}

                    {/* ═══════════ FINANCIAL ═══════════ */}
                    {activeTab === "financial" && (
                        <div>
                            <h2 className="admin-section-title">Financial Overview</h2>
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Total Order Value</span><span className="stat-value">{"\u20B9"}{formatIndianNumber(Math.round(financialStats.totalGrand))}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Advance Received</span><span className="stat-value" style={{ color: '#2e7d32' }}>{"\u20B9"}{formatIndianNumber(Math.round(financialStats.totalAdvance))}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Pending Payments</span><span className="stat-value" style={{ color: '#c62828' }}>{"\u20B9"}{formatIndianNumber(Math.round(financialStats.totalPending))}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Unpaid Orders</span><span className="stat-value">{financialStats.unpaidCount}</span></div></div>
                            </div>

                            {financialStats.byChannel.length > 0 && (<>
                                <h3 className="admin-subsection-title" style={{ marginTop: 24 }}>Payments by Channel</h3>
                                <div className="admin-table-wrapper"><div className="admin-table-container"><table className="admin-table">
                                    <thead><tr><th>Channel</th><th className="amount">Total</th><th className="amount">Advance</th><th className="amount">Pending</th></tr></thead>
                                    <tbody>{financialStats.byChannel.map(c => (<tr key={c.name}><td>{c.name}</td><td className="amount">{"\u20B9"}{formatIndianNumber(Math.round(c.total))}</td><td className="amount" style={{ color: '#2e7d32' }}>{"\u20B9"}{formatIndianNumber(Math.round(c.advance))}</td><td className="amount" style={{ color: c.pending > 0 ? '#c62828' : 'inherit' }}>{"\u20B9"}{formatIndianNumber(Math.round(c.pending))}</td></tr>))}</tbody>
                                </table></div></div>
                            </>)}

                            {financialStats.byPaymentMode.length > 0 && (<>
                                <h3 className="admin-subsection-title" style={{ marginTop: 24 }}>Payment Mode Breakdown</h3>
                                <div className="admin-chart-container"><ResponsiveContainer width="100%" height={280}>
                                    <PieChart><Pie data={financialStats.byPaymentMode} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                                        {financialStats.byPaymentMode.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                                    </Pie><Tooltip content={<ChartTooltip />} /></PieChart>
                                </ResponsiveContainer></div>
                            </>)}
                        </div>
                    )}

                    {/* ═══════════ ORDER TRACKING ═══════════ */}
                    {activeTab === "orders" && (
                        <div className="admin-orders-tab">
                            <h2 className="admin-section-title">Order Tracking</h2>
                            <div className="admin-toolbar">
                                <div className="admin-search-wrapper"><span className="search-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg></span><input type="text" placeholder="Search Order #, Customer, Phone..." value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} className="admin-search-input" />{orderSearch && <button className="search-clear" onClick={() => setOrderSearch("")}>{"\u00D7"}</button>}</div>
                                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="admin-sort-select"><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="delivery">Delivery Date</option><option value="amount_high">Amount: High</option><option value="amount_low">Amount: Low</option></select>
                                <button className="admin-export-btn" onClick={handleExportCSV}>Export CSV</button>
                            </div>

                            <div className="admin-status-tabs">{STATUS_TABS.map(tab => (<button key={tab.value} className={`status-tab ${statusTab === tab.value ? "active" : ""}`} onClick={() => setStatusTab(tab.value)}>{tab.label}<span className="tab-count">{orderTabCounts[tab.value]}</span></button>))}</div>

                            <div className="admin-filter-bar" ref={dropdownRef}>
                                <div className="filter-dropdown"><button className={`filter-btn ${(filters.dateFrom || filters.dateTo) ? "active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "date" ? null : "date")}>Date {"\u25BE"}</button>{openDropdown === "date" && (<div className="dropdown-panel"><div className="dropdown-title">Date Range</div><div className="date-inputs"><input type="date" value={filters.dateFrom} onChange={(e) => setFilters(p => ({ ...p, dateFrom: e.target.value }))} /><span>to</span><input type="date" value={filters.dateTo} onChange={(e) => setFilters(p => ({ ...p, dateTo: e.target.value }))} /></div><button className="dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button></div>)}</div>
                                <div className="filter-dropdown"><button className={`filter-btn ${filters.payment.length > 0 ? "active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "payment" ? null : "payment")}>Payment {"\u25BE"}</button>{openDropdown === "payment" && (<div className="dropdown-panel"><div className="dropdown-title">Payment</div>{["paid", "partial", "unpaid"].map(o => (<label key={o} className="checkbox-label"><input type="checkbox" checked={filters.payment.includes(o)} onChange={() => toggleFilter("payment", o)} /><span>{o.charAt(0).toUpperCase() + o.slice(1)}</span></label>))}<button className="dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button></div>)}</div>
                                <div className="filter-dropdown"><button className={`filter-btn ${filters.store.length > 0 ? "active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "store" ? null : "store")}>Store {"\u25BE"}</button>{openDropdown === "store" && (<div className="dropdown-panel"><div className="dropdown-title">Store</div>{["Delhi Store", "Ludhiana Store", "B2B"].map(o => (<label key={o} className="checkbox-label"><input type="checkbox" checked={filters.store.includes(o)} onChange={() => toggleFilter("store", o)} /><span>{o}</span></label>))}<button className="dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button></div>)}</div>
                                <select className="filter-btn" style={{ cursor: 'pointer' }} value={filters.salesperson} onChange={(e) => setFilters(p => ({ ...p, salesperson: e.target.value }))}><option value="">All SAs</option>{salespersons.map(sp => <option key={sp} value={sp}>{sp}</option>)}</select>
                            </div>

                            {appliedFilters.length > 0 && (<div className="admin-applied-filters"><span className="applied-label">Applied:</span>{appliedFilters.map((c, i) => (<span key={i} className="filter-chip">{c.label}<button onClick={() => removeFilter(c.type, c.value)}>{"\u00D7"}</button></span>))}<button className="clear-all" onClick={clearAllFilters}>Clear All</button></div>)}

                            <div className="orders-count">Showing {filteredOrders.length} orders</div>

                            <div className="admin-table-wrapper"><div className="admin-table-container"><table className="admin-table orders-table">
                                <thead><tr><th>Order ID</th><th>Customer</th><th>Product</th><th>Amount</th><th>Payment</th><th>Status</th><th>Store</th><th>Date</th><th>Actions</th></tr></thead>
                                <tbody>{currentOrders.length === 0 ? <tr><td colSpan="9" className="no-data">No orders</td></tr> : currentOrders.map(o => {
                                    const urg = getPriority(o) === "urgent"; return (
                                        <tr key={o.id} className={urg ? "urgent-row" : ""}><td><span className="order-id">{o.order_no || "-"}</span>{urg && <span className="urgent-badge">URGENT</span>}</td><td>{o.delivery_name || "-"}</td><td className="product-cell">{o.items?.[0]?.product_name || "-"}</td><td>{"\u20B9"}{formatIndianNumber(o.grand_total || 0)}</td><td><span className={`payment-badge ${getPaymentStatus(o)}`}>{getPaymentStatus(o).charAt(0).toUpperCase() + getPaymentStatus(o).slice(1)}</span></td><td><select className="status-select" value={o.status || "pending"} onChange={(e) => updateOrderStatus(o.id, e.target.value)} disabled={statusUpdating === o.id}>{ORDER_STATUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></td><td>{o.salesperson_store || "-"}</td><td>{formatDate(o.created_at)}</td><td><div className="action-buttons"><button className="action-btn pdf" onClick={() => handleGeneratePdf(o)} disabled={pdfLoading === o.id}>{pdfLoading === o.id ? "..." : "PDF"}</button></div></td></tr>
                                    );
                                })}</tbody>
                            </table></div></div>
                            {ordersTotalPages > 1 && (<div className="admin-pagination"><button onClick={() => setOrdersPage(p => Math.max(1, p - 1))} disabled={ordersPage === 1}>Prev</button><span>Page {ordersPage} of {ordersTotalPages}</span><button onClick={() => setOrdersPage(p => Math.min(ordersTotalPages, p + 1))} disabled={ordersPage === ordersTotalPages}>Next</button></div>)}
                        </div>
                    )}

                </main>
            </div>
        </div>
    );
}