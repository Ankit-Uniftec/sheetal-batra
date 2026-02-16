import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./AdminDashboard.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";
import { downloadCustomerPdf, downloadWarehousePdf } from "../../utils/pdfUtils";
import { usePopup } from "../../components/Popup";
import config from "../../config/config";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell
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

    const [activeTab, setActiveTab] = useState("dashboard");
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
    const [accountsPage, setAccountsPage] = useState(1);

    // Analytics states
    const [analyticsTimeline, setAnalyticsTimeline] = useState("monthly");
    const [analyticsCustomFrom, setAnalyticsCustomFrom] = useState("");
    const [analyticsCustomTo, setAnalyticsCustomTo] = useState("");
    const [showAnalyticsCustomPicker, setShowAnalyticsCustomPicker] = useState(false);

    // Fetch data on mount
    useEffect(() => {
        const checkAuthAndFetch = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) { navigate("/login", { replace: true }); return; }
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

    // Dashboard Stats
    const dashboardStats = useMemo(() => {
        const validOrders = orders.filter(o => !isLxrtsOrder(o));
        const dateRange = getDateRange(timeline);
        const comparisonRange = getComparisonDateRange(timeline, comparison);

        const currentOrders = filterOrdersByDateRange(validOrders, dateRange);
        const previousOrders = comparisonRange ? filterOrdersByDateRange(validOrders, comparisonRange) : [];

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
            if (isLxrtsOrder(o)) return false;
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

        // 3. Sales by Store
        const storeSales = {};
        validOrders.forEach(order => {
            const store = order.salesperson_store || "Unknown";
            if (!storeSales[store]) storeSales[store] = { name: store, sales: 0, count: 0 };
            storeSales[store].sales += Number(order.grand_total || 0);
            storeSales[store].count += 1;
        });
        const salesByStore = Object.values(storeSales).sort((a, b) => b.sales - a.sales);

        // 4. Sales and Discounts by Salesperson
        const salespersonData = {};
        validOrders.forEach(order => {
            const sp = order.salesperson || "Unknown";
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
            if (isLxrtsOrder(o)) return false;
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
    const filteredProducts = useMemo(() => products.filter(p =>
        p.name?.toLowerCase().includes(inventorySearch.toLowerCase()) ||
        p.sku_id?.toLowerCase().includes(inventorySearch.toLowerCase())
    ), [products, inventorySearch]);

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
        orders.forEach(o => { if (o.salesperson) spSet.add(o.salesperson); });
        return Array.from(spSet).sort();
    }, [orders]);

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
                    order.delivery_name?.toLowerCase().includes(q) || order.delivery_phone?.includes(q) || order.salesperson?.toLowerCase().includes(q);
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
        if (filters.salesperson) result = result.filter(order => order.salesperson === filters.salesperson);

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
                    sa_name: order.salesperson || "-", client_name: order.delivery_name || "-",
                    product_name: item.product_name || "-",
                    gross_value: Math.round(grossValue * 100) / 100, discount: Math.round(productDiscount * 100) / 100,
                    taxable_value: Math.round(taxableValue * 100) / 100, gst: Math.round(gst * 100) / 100,
                    invoice_value: Math.round(invoiceValue * 100) / 100, quantity,
                    status: order.status || "pending", delivery_date: item.delivery_date || order.delivery_date,
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
        return result;
    }, [accountsLineItems, accountsSearch, accountsDateFrom, accountsDateTo, accountsStatus]);

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

    const handleGeneratePdf = async (order, type = "customer") => {
        setPdfLoading(order.id);
        try {
            if (type === "warehouse") await downloadWarehousePdf(order, null, true);
            else await downloadCustomerPdf(order);
        } catch (error) { console.error("PDF generation failed:", error); }
        finally { setPdfLoading(null); }
    };

    // Reset pages
    useEffect(() => { setInventoryPage(1); }, [inventorySearch]);
    useEffect(() => { setOrdersPage(1); }, [orderSearch, statusTab, filters, sortBy]);
    useEffect(() => { setAccountsPage(1); }, [accountsSearch, accountsDateFrom, accountsDateTo, accountsStatus]);

    useEffect(() => {
        if (activeTab === "dashboard") {
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
                    <button className="admin-logout-btn" onClick={handleLogout}>Logout</button>
                </div>
            </header>

            <div className="admin-layout">
                {/* SIDEBAR */}
                <aside className={`admin-sidebar ${showSidebar ? "open" : ""}`}>
                    <nav className="admin-nav">
                        <button className={`admin-nav-item ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => { setActiveTab("dashboard"); setShowSidebar(false); }}>Dashboard</button>
                        <button className={`admin-nav-item ${activeTab === "analytics" ? "active" : ""}`} onClick={() => { setActiveTab("analytics"); setShowSidebar(false); }}>Analytics</button>
                        <button className={`admin-nav-item ${activeTab === "inventory" ? "active" : ""}`} onClick={() => { setActiveTab("inventory"); setShowSidebar(false); }}>Inventory</button>
                        <button className={`admin-nav-item ${activeTab === "orders" ? "active" : ""}`} onClick={() => { setActiveTab("orders"); setShowSidebar(false); }}>Orders</button>
                        <button className={`admin-nav-item ${activeTab === "accounts" ? "active" : ""}`} onClick={() => { setActiveTab("accounts"); setShowSidebar(false); }}>Accounts</button>
                        <button className="admin-nav-item logout" onClick={handleLogout}>Logout</button>
                    </nav>
                </aside>

                {/* MAIN CONTENT */}
                <main className="admin-content">
                    {/* DASHBOARD TAB */}
                    {activeTab === "dashboard" && (
                        <div className="admin-dashboard-tab">
                            {/* Header with Timeline Filter */}
                            <div className="dashboard-header">
                                <h2 className="admin-section-title">Overview</h2>
                                <div className="timeline-filter">
                                    <div className="timeline-row">
                                        <div className="timeline-buttons">
                                            {TIMELINE_OPTIONS.map(opt => (
                                                <button key={opt.value} className={`timeline-btn ${timeline === opt.value ? 'active' : ''}`} onClick={() => handleTimelineChange(opt.value)}>
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                        <div className="comparison-selector">
                                            <span className="comparison-label">Compare to:</span>
                                            <select
                                                value={comparison}
                                                onChange={(e) => setComparison(e.target.value)}
                                                className="comparison-select"
                                            >
                                                {COMPARISON_OPTIONS.map(opt => (
                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    {showCustomDatePicker && (
                                        <div className="custom-date-picker">
                                            <input type="date" value={customDateFrom} onChange={(e) => setCustomDateFrom(e.target.value)} />
                                            <span>to</span>
                                            <input type="date" value={customDateTo} onChange={(e) => setCustomDateTo(e.target.value)} />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Main Stats Grid - Headers Above Numbers - 6 Cards */}
                            <div className="admin-stats-grid overview-grid">
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Total Orders</span>
                                    <span className="stat-value">{formatIndianNumber(dashboardStats.totalOrders)}</span>
                                    {dashboardStats.showComparison && <GrowthIndicator value={dashboardStats.ordersGrowth} />}
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Total Revenue</span>
                                    <span className="stat-value">₹{formatIndianNumber(dashboardStats.totalRevenue.toFixed(0))}</span>
                                    {dashboardStats.showComparison && <GrowthIndicator value={dashboardStats.revenueGrowth} />}
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Pending Orders</span>
                                    <span className="stat-value">{dashboardStats.pendingOrders}</span>
                                    {dashboardStats.showComparison && <GrowthIndicator value={dashboardStats.pendingGrowth} inverse={true} />}
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Prepared</span>
                                    <span className="stat-value">{dashboardStats.preparedOrders}</span>
                                    {dashboardStats.showComparison && <GrowthIndicator value={dashboardStats.preparedGrowth} />}
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Delivered</span>
                                    <span className="stat-value">{dashboardStats.deliveredOrders}</span>
                                    {dashboardStats.showComparison && <GrowthIndicator value={dashboardStats.deliveredGrowth} />}
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Cancelled Orders</span>
                                    <span className="stat-value">{dashboardStats.cancelledOrders}</span>
                                    {dashboardStats.showComparison && <GrowthIndicator value={dashboardStats.cancelledGrowth} inverse={true} />}
                                </div>
                            </div>

                            {/* Inventory Overview */}
                            <h3 className="admin-subsection-title">Inventory Overview</h3>
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card">
                                    <div className="stat-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v6" /><path d="M16.76 3a2 2 0 0 1 1.8 1.1l2.23 4.479a2 2 0 0 1 .21.891V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9.472a2 2 0 0 1 .211-.894L5.45 4.1A2 2 0 0 1 7.24 3z" /><path d="M3.054 9.013h17.893" /></svg></div>
                                    <div className="stat-info"><span className="stat-label">Total Products</span><span className="stat-value">{inventoryStats.total}</span></div>
                                </div>
                                <div className="admin-stat-card">
                                    <div className="stat-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg></div>
                                    <div className="stat-info"><span className="stat-label">On Shopify</span><span className="stat-value">{inventoryStats.onShopify}</span></div>
                                </div>
                                <div className="admin-stat-card warning">
                                    <div className="stat-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg></div>
                                    <div className="stat-info"><span className="stat-label">Low Stock</span><span className="stat-value">{inventoryStats.lowStock}</span></div>
                                </div>
                                <div className="admin-stat-card danger">
                                    <div className="stat-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4.929 4.929 19.07 19.071" /><circle cx="12" cy="12" r="10" /></svg></div>
                                    <div className="stat-info"><span className="stat-label">Out of Stock</span><span className="stat-value">{inventoryStats.outOfStock}</span></div>
                                </div>
                            </div>

                            {/* Recent Orders */}
                            <div className="admin-recent-orders">
                                <div className="recent-header">
                                    <h3 className="admin-subsection-title">Recent Orders</h3>
                                    <select value={recentOrdersCount} onChange={(e) => setRecentOrdersCount(Number(e.target.value))} className="recent-count-select">
                                        <option value={5}>Last 5</option>
                                        <option value={10}>Last 10</option>
                                        <option value={20}>Last 20</option>
                                    </select>
                                </div>
                                <div className="admin-table-wrapper">
                                    <div className="admin-table-container">
                                        <table className="admin-table">
                                            <thead>
                                                <tr><th>Order ID</th><th>Customer</th><th>Product</th><th>Amount</th><th>Status</th><th>Date</th></tr>
                                            </thead>
                                            <tbody>
                                                {recentOrders.map(order => (
                                                    <tr key={order.id}>
                                                        <td><span className="order-id">{order.order_no || "-"}</span></td>
                                                        <td>{order.delivery_name || "-"}</td>
                                                        <td className="product-cell">{order.items?.[0]?.product_name || "-"}</td>
                                                        <td>₹{formatIndianNumber(order.grand_total || 0)}</td>
                                                        <td><span className={`status-badge ${order.status || "pending"}`}>{order.status || "Pending"}</span></td>
                                                        <td>{formatDate(order.created_at)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ANALYTICS TAB */}
                    {activeTab === "analytics" && (
                        <div className="admin-analytics-tab">
                            {/* Header with Timeline Filter */}
                            <div className="dashboard-header">
                                <h2 className="admin-section-title">Analytics</h2>
                                <div className="timeline-filter">
                                    <div className="timeline-row">
                                        <div className="timeline-buttons">
                                            {TIMELINE_OPTIONS.map(opt => (
                                                <button key={opt.value} className={`timeline-btn ${analyticsTimeline === opt.value ? 'active' : ''}`} onClick={() => handleAnalyticsTimelineChange(opt.value)}>
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    {showAnalyticsCustomPicker && (
                                        <div className="custom-date-picker">
                                            <input type="date" value={analyticsCustomFrom} onChange={(e) => setAnalyticsCustomFrom(e.target.value)} />
                                            <span>to</span>
                                            <input type="date" value={analyticsCustomTo} onChange={(e) => setAnalyticsCustomTo(e.target.value)} />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Charts Grid */}
                            <div className="analytics-charts-grid">
                                {/* 1. Sales of Top 10 Products */}
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Sales by Top 10 Products</h3>
                                    {analyticsData.topProducts.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={350}>
                                            <BarChart data={analyticsData.topProducts} layout="vertical" margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                                                <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} />
                                                <YAxis
                                                    type="category"
                                                    dataKey="name"
                                                    width={120}
                                                    tick={{ fontSize: 11 }}
                                                    tickFormatter={(v) => v.length > 15 ? v.substring(0, 15) + '...' : v}
                                                />
                                                <Tooltip
                                                    content={({ active, payload, label }) => {
                                                        if (active && payload && payload.length) {
                                                            const item = analyticsData.topProducts.find(p => p.name === label);
                                                            return (
                                                                <div style={{ background: '#fff', border: '1px solid #ccc', padding: '10px', borderRadius: '4px' }}>
                                                                    <p style={{ margin: 0, fontWeight: 'bold' }}>{label}</p>
                                                                    <p style={{ margin: '5px 0 0' }}>Sales: ₹{formatIndianNumber(payload[0].value)}</p>
                                                                    <p style={{ margin: '5px 0 0' }}>Orders: {item?.count || 0}</p>
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    }}
                                                />
                                                <Bar dataKey="sales" fill="#d5b85a" radius={[0, 4, 4, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <div className="no-chart-data">No data available</div>
                                    )}
                                </div>

                                {/* 2. Sales of Top 10 Colors */}
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Sales by Top 10 Colors</h3>
                                    {analyticsData.topColors.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={350}>
                                            <BarChart data={analyticsData.topColors} margin={{ top: 10, right: 30, left: 10, bottom: 70 }}>
                                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                                                <XAxis
                                                    dataKey="name"
                                                    interval={0}
                                                    tick={{ fontSize: 11 }}
                                                    tickFormatter={(v) => v.length > 10 ? v.substring(0, 10) + '...' : v}
                                                />
                                                <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} />
                                                <Tooltip
                                                    content={({ active, payload, label }) => {
                                                        if (active && payload && payload.length) {
                                                            const item = analyticsData.topColors.find(c => c.name === label);
                                                            return (
                                                                <div style={{ background: '#fff', border: '1px solid #ccc', padding: '10px', borderRadius: '4px' }}>
                                                                    <p style={{ margin: 0, fontWeight: 'bold' }}>{label}</p>
                                                                    <p style={{ margin: '5px 0 0' }}>Sales: ₹{formatIndianNumber(payload[0].value)}</p>
                                                                    <p style={{ margin: '5px 0 0' }}>Orders: {item?.count || 0}</p>
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    }}
                                                />
                                                <Bar dataKey="sales" fill="#d5b85a" radius={[4, 4, 0, 0]}>
                                                    {analyticsData.topColors.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <div className="no-chart-data">No data available</div>
                                    )}
                                </div>

                                {/* 3. Sales by Store */}
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Sales by Store</h3>
                                    {analyticsData.salesByStore.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={350}>
                                            <PieChart>
                                                <Pie
                                                    data={analyticsData.salesByStore}
                                                    cx="50%"
                                                    cy="45%"
                                                    innerRadius={60}
                                                    outerRadius={100}
                                                    fill="#8884d8"
                                                    dataKey="sales"
                                                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                                                    labelLine={true}
                                                >
                                                    {analyticsData.salesByStore.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                                    ))}
                                                </Pie>
                                                <Tooltip formatter={(v) => [`₹${formatIndianNumber(v)}`, "Sales"]} />
                                                <Legend verticalAlign="bottom" height={36} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <div className="no-chart-data">No data available</div>
                                    )}
                                </div>

                                {/* 4. Sales and Discounts by Salesperson */}
                                <div className="analytics-chart-card wide">
                                    <h3 className="chart-title">Sales & Discounts by Salesperson</h3>
                                    {analyticsData.salesBySalesperson.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={350}>
                                            <BarChart data={analyticsData.salesBySalesperson} margin={{ top: 10, right: 30, left: 20, bottom: 70 }}>
                                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                                                <XAxis
                                                    dataKey="name"
                                                    textAnchor="end"
                                                    interval={0}
                                                    tick={{ fontSize: 11 }}
                                                    height={70}
                                                    tickFormatter={(v) => v.length > 15 ? v.substring(0, 15) + '...' : v}
                                                />
                                                <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} />
                                                <Tooltip formatter={(v) => [`₹${formatIndianNumber(v)}`]} />
                                                <Legend verticalAlign="top" height={36} />
                                                <Bar dataKey="sales" name="Sales" fill="#d5b85a" radius={[4, 4, 0, 0]} />
                                                <Bar dataKey="discount" name="Discount" fill="#8B7355" radius={[4, 4, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <div className="no-chart-data">No data available</div>
                                    )}
                                </div>

                                {/* 5. Alteration by Outfit */}
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Alterations by Outfit</h3>
                                    <p className="chart-subtitle">Total: {analyticsData.totalAlterations} alterations</p>
                                    {analyticsData.alterationsByOutfit.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={300}>
                                            <BarChart data={analyticsData.alterationsByOutfit} layout="vertical" margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                                                <XAxis type="number" allowDecimals={false} />
                                                <YAxis
                                                    type="category"
                                                    dataKey="name"
                                                    width={120}
                                                    tick={{ fontSize: 11 }}
                                                    tickFormatter={(v) => v.length > 15 ? v.substring(0, 15) + '...' : v}
                                                />
                                                <Tooltip formatter={(v) => [v, "Alterations"]} />
                                                <Bar dataKey="count" fill="#8B7355" radius={[0, 4, 4, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <div className="no-chart-data">No alteration data available</div>
                                    )}
                                </div>

                                {/* 6. Alteration by Customers */}
                                <div className="analytics-chart-card">
                                    <h3 className="chart-title">Alterations by Customers</h3>
                                    <p className="chart-subtitle">Top 10 customers with most alterations</p>
                                    {analyticsData.alterationsByCustomer.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={300}>
                                            <BarChart data={analyticsData.alterationsByCustomer} layout="vertical" margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                                                <XAxis type="number" allowDecimals={false} />
                                                <YAxis
                                                    type="category"
                                                    dataKey="name"
                                                    width={120}
                                                    tick={{ fontSize: 11 }}
                                                    tickFormatter={(v) => v.length > 15 ? v.substring(0, 15) + '...' : v}
                                                />
                                                <Tooltip formatter={(v) => [v, "Alterations"]} />
                                                <Bar dataKey="count" fill="#A67C52" radius={[0, 4, 4, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <div className="no-chart-data">No alteration data available</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* INVENTORY TAB */}
                    {activeTab === "inventory" && (
                        <div className="admin-inventory-tab">
                            <h2 className="admin-section-title">Inventory Management</h2>
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Total Products</span><span className="stat-value">{inventoryStats.total}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Total Stock</span><span className="stat-value">{formatIndianNumber(inventoryStats.totalInventory)}</span></div></div>
                                <div className="admin-stat-card warning"><div className="stat-info"><span className="stat-label">Low Stock (&lt;5)</span><span className="stat-value">{inventoryStats.lowStock}</span></div></div>
                                <div className="admin-stat-card danger"><div className="stat-info"><span className="stat-label">Out of Stock</span><span className="stat-value">{inventoryStats.outOfStock}</span></div></div>
                            </div>

                            <div className="admin-toolbar">
                                <div className="admin-search-wrapper">
                                    <span className="search-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg></span>
                                    <input type="text" placeholder="Search by name or SKU..." value={inventorySearch} onChange={(e) => setInventorySearch(e.target.value)} className="admin-search-input" />
                                    {inventorySearch && <button className="search-clear" onClick={() => setInventorySearch("")}>×</button>}
                                </div>
                                <span className="showing-info">Showing {currentProducts.length} of {filteredProducts.length} products</span>
                            </div>

                            <div className="admin-table-wrapper">
                                <div className="admin-table-container">
                                    <table className="admin-table inventory-table">
                                        <thead><tr><th>SKU</th><th>Product Name</th><th>Default Top</th><th>Default Bottom</th><th>Base Price</th><th>Inventory</th><th>Actions</th></tr></thead>
                                        <tbody>
                                            {currentProducts.map(product => {
                                                const isLxrts = isLxrtsProduct(product);
                                                const isExpanded = expandedProduct === product.id;
                                                return (
                                                    <React.Fragment key={product.id}>
                                                        <tr className={`${isLxrts ? "lxrts-row" : ""} ${isExpanded ? "expanded" : ""}`}>
                                                            <td><span className="sku-code">{product.sku_id || "-"}</span></td>
                                                            <td className="product-name-cell">{product.name || "-"}{isLxrts && <span className="lxrts-badge">LXRTS</span>}</td>
                                                            <td>{product.default_top || "-"}</td>
                                                            <td>{product.default_bottom || "-"}</td>
                                                            <td>₹{formatIndianNumber(product.base_price || 0)}</td>
                                                            <td className="inventory-cell">
                                                                {isLxrts ? (
                                                                    <span className="inventory-value lxrts">{lxrtsSyncLoading ? "..." : getLxrtsTotalInventory(product.id)}</span>
                                                                ) : editingProductId === product.id ? (
                                                                    <div className="inventory-edit">
                                                                        <input type="number" value={editInventoryValue} onChange={(e) => setEditInventoryValue(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === "Enter") handleInventoryUpdate(product.id); if (e.key === "Escape") { setEditingProductId(null); setEditInventoryValue(""); } }} />
                                                                        <button onClick={() => handleInventoryUpdate(product.id)} disabled={savingInventory}>{savingInventory ? "..." : "Save"}</button>
                                                                        <button onClick={() => { setEditingProductId(null); setEditInventoryValue(""); }}>×</button>
                                                                    </div>
                                                                ) : (
                                                                    <span className={`inventory-value ${(product.inventory || 0) === 0 ? "out" : (product.inventory || 0) < 5 ? "low" : "ok"}`} onClick={() => { setEditingProductId(product.id); setEditInventoryValue(String(product.inventory || 0)); }}>{product.inventory || 0}</span>
                                                                )}
                                                            </td>
                                                            <td>{isLxrts && <button className={`expand-btn ${isExpanded ? "expanded" : ""}`} onClick={() => handleExpandProduct(product)}>{isExpanded ? "Collapse" : "Expand"}</button>}</td>
                                                        </tr>
                                                        {isLxrts && isExpanded && (
                                                            <tr className="variants-row">
                                                                <td colSpan="7">
                                                                    <div className="variants-container">
                                                                        <div className="variants-header">
                                                                            <span className="variants-title">Size Variants - {product.name}</span>
                                                                            <span className="variants-total">Total: <strong>{getLxrtsTotalInventory(product.id)}</strong></span>
                                                                        </div>
                                                                        {lxrtsSyncLoading ? <p className="loading-text">Syncing inventory from Shopify...</p> :
                                                                            getProductSizes(product.id).length === 0 ? <p className="no-variants">No variant data available</p> : (
                                                                                <div className="variants-grid">
                                                                                    {getProductSizes(product.id).map((size) => {
                                                                                        const qty = variantInventory[product.id]?.[size] || 0;
                                                                                        const isEditingThis = editingVariant?.productId === product.id && editingVariant?.size === size;
                                                                                        return (
                                                                                            <div key={size} className={`variant-card ${getInventoryClass(qty)}`}>
                                                                                                <span className="variant-size">{size}</span>
                                                                                                {isEditingThis ? (
                                                                                                    <div className="variant-edit">
                                                                                                        <input type="number" value={variantEditValue} onChange={(e) => setVariantEditValue(e.target.value)} autoFocus min="0" onKeyDown={(e) => { if (e.key === "Enter") handleVariantInventoryUpdate(product.id, size); if (e.key === "Escape") { setEditingVariant(null); setVariantEditValue(""); } }} />
                                                                                                        <button onClick={() => handleVariantInventoryUpdate(product.id, size)} disabled={savingVariant}>{savingVariant ? "..." : "OK"}</button>
                                                                                                        <button onClick={() => { setEditingVariant(null); setVariantEditValue(""); }}>×</button>
                                                                                                    </div>
                                                                                                ) : <span className="variant-qty" onClick={() => { setEditingVariant({ productId: product.id, size }); setVariantEditValue(String(qty)); }}>{qty}</span>}
                                                                                            </div>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            {inventoryTotalPages > 1 && (
                                <div className="admin-pagination">
                                    <button onClick={() => setInventoryPage(p => Math.max(1, p - 1))} disabled={inventoryPage === 1}>Prev</button>
                                    <span>Page {inventoryPage} of {inventoryTotalPages}</span>
                                    <button onClick={() => setInventoryPage(p => Math.min(inventoryTotalPages, p + 1))} disabled={inventoryPage === inventoryTotalPages}>Next</button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ORDERS TAB */}
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
                                    <button className={`filter-btn ${filters.salesperson ? "active" : ""}`} onClick={() => setOpenDropdown(openDropdown === "salesperson" ? null : "salesperson")}>Salesperson ▾</button>
                                    {openDropdown === "salesperson" && (
                                        <div className="dropdown-panel">
                                            <div className="dropdown-title">Salesperson</div>
                                            <select value={filters.salesperson} onChange={(e) => setFilters(prev => ({ ...prev, salesperson: e.target.value }))} className="sp-select">
                                                <option value="">All Salespersons</option>
                                                {salespersons.map(sp => <option key={sp} value={sp}>{sp}</option>)}
                                            </select>
                                            <button className="dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
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
                    {activeTab === "accounts" && (
                        <div className="admin-accounts-tab">
                            <h2 className="admin-section-title">Accounts & Finance</h2>
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Gross Value</span><span className="stat-value">₹{formatIndianNumber(accountsTotals.gross.toFixed(0))}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Total Discount</span><span className="stat-value">₹{formatIndianNumber(accountsTotals.discount.toFixed(0))}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Total GST</span><span className="stat-value">₹{formatIndianNumber(accountsTotals.gst.toFixed(0))}</span></div></div>
                                <div className="admin-stat-card"><div className="stat-info"><span className="stat-label">Invoice Value</span><span className="stat-value">₹{formatIndianNumber(accountsTotals.invoice.toFixed(0))}</span></div></div>
                            </div>

                            <div className="admin-toolbar accounts-toolbar">
                                <div className="admin-search-wrapper">
                                    <span className="search-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg></span>
                                    <input type="text" placeholder="Search Order, Customer, Product..." value={accountsSearch} onChange={(e) => setAccountsSearch(e.target.value)} className="admin-search-input" />
                                </div>
                                <div className="accounts-filters">
                                    <input type="date" value={accountsDateFrom} onChange={(e) => setAccountsDateFrom(e.target.value)} />
                                    <span>to</span>
                                    <input type="date" value={accountsDateTo} onChange={(e) => setAccountsDateTo(e.target.value)} />
                                    <select value={accountsStatus} onChange={(e) => setAccountsStatus(e.target.value)}>
                                        <option value="">All Status</option>
                                        <option value="pending">Pending</option><option value="in_production">In Production</option><option value="ready">Ready</option>
                                        <option value="dispatched">Dispatched</option><option value="delivered">Delivered</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
                                    </select>
                                </div>
                            </div>

                            <div className="admin-table-wrapper">
                                <div className="admin-table-container accounts-table-container">
                                    <table className="admin-table accounts-table">
                                        <thead><tr><th>SA Name</th><th>Order ID</th><th>Date</th><th>Customer</th><th>Product</th><th>Gross</th><th>Discount</th><th>Taxable</th><th>GST</th><th>Invoice</th><th>Qty</th><th>Status</th><th>Delivery Date</th></tr></thead>
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
                </main>
            </div>
        </div>
    );
}