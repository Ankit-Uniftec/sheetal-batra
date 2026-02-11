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
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
];

const ITEMS_PER_PAGE = 15;

// LXRTS Size order for display
const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL", "6XL"];

export default function AdminDashboard() {
    const { showPopup, PopupComponent } = usePopup();
    const navigate = useNavigate();

    // Active sidebar tab
    const [activeTab, setActiveTab] = useState("dashboard");
    const [showSidebar, setShowSidebar] = useState(false);

    // Data states
    const [orders, setOrders] = useState([]);
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);

    // PDF loading states
    const [pdfLoading, setPdfLoading] = useState(null);

    // ============ DASHBOARD TAB STATES ============
    const [recentOrdersCount, setRecentOrdersCount] = useState(10);

    // ============ INVENTORY TAB STATES ============
    const [inventorySearch, setInventorySearch] = useState("");
    const [inventoryPage, setInventoryPage] = useState(1);
    const [editingProductId, setEditingProductId] = useState(null);
    const [editInventoryValue, setEditInventoryValue] = useState("");
    const [savingInventory, setSavingInventory] = useState(false);

    // LXRTS States
    const [expandedProduct, setExpandedProduct] = useState(null);
    // const [shopifyVariants, setShopifyVariants] = useState({});
    // const [loadingVariants, setLoadingVariants] = useState(null);
    const [editingVariant, setEditingVariant] = useState(null);
    const [variantEditValue, setVariantEditValue] = useState("");
    const [savingVariant, setSavingVariant] = useState(false);
    const [syncToggling, setSyncToggling] = useState(null);
    const [variantInventory, setVariantInventory] = useState({}); // { productId: { S: 4, M: 2, ... } }
    const [lxrtsSyncLoading, setLxrtsSyncLoading] = useState(false);

    // ============ ORDERS TAB STATES ============
    const [orderSearch, setOrderSearch] = useState("");
    const [sortBy, setSortBy] = useState("newest");
    const [statusTab, setStatusTab] = useState("all");
    const [ordersPage, setOrdersPage] = useState(1);
    const [statusUpdating, setStatusUpdating] = useState(null);

    // Order Filters
    const [filters, setFilters] = useState({
        dateFrom: "",
        dateTo: "",
        minPrice: 0,
        maxPrice: 500000,
        payment: [],
        priority: [],
        orderType: [],
        store: [],
        salesperson: "",
    });
    const [openDropdown, setOpenDropdown] = useState(null);
    const dropdownRef = useRef(null);

    // ============ ACCOUNTS TAB STATES ============
    const [accountsSearch, setAccountsSearch] = useState("");
    const [accountsDateFrom, setAccountsDateFrom] = useState("");
    const [accountsDateTo, setAccountsDateTo] = useState("");
    const [accountsStatus, setAccountsStatus] = useState("");
    const [accountsPage, setAccountsPage] = useState(1);

    // ============ FETCH DATA ============

    useEffect(() => {
        const checkAuthAndFetch = async () => {
            const { data: { session } } = await supabase.auth.getSession();

            if (!session) {
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
        } catch (err) {
            console.error("Error fetching data:", err);
        } finally {
            setLoading(false);
        }
    };

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setOpenDropdown(null);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // ============ LOGOUT ============
    const handleLogout = async () => {
        await supabase.auth.signOut();
        navigate("/login");
    };

    // ============ HELPER FUNCTIONS ============
    const getPaymentStatus = (order) => {
        const total = order.grand_total || order.net_total || 0;
        const advance = order.advance_payment || 0;
        if (advance >= total) return "paid";
        if (advance > 0) return "partial";
        return "unpaid";
    };

    const getPriority = (order) => {
        if (order.is_urgent || order.order_flag === "Urgent" || order.alteration_status === "upcoming_occasion") {
            return "urgent";
        }
        return "normal";
    };

    const getOrderType = (order) => {
        if (order.is_alteration) return "alteration";
        const item = order.items?.[0];
        if (item?.order_type === "Custom" || item?.payment_order_type === "Custom") return "custom";
        return "standard";
    };

    const isLxrtsOrder = (order) => {
        return order.items?.[0]?.sync_enabled === true;
    };

    const isLxrtsProduct = (product) => {
        return product.sync_enabled === true;
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
        const extraSizes = Object.keys(variants)
            .filter((s) => !SIZE_ORDER.includes(s))
            .sort();
        return [...knownSizes, ...extraSizes];
    };

    const getInventoryClass = (count) => {
        if (count === 0) return "admin-stock-out";
        if (count < 5) return "admin-stock-low";
        return "admin-stock-ok";
    };

    // ============ DASHBOARD STATS ============
    const dashboardStats = useMemo(() => {
        const validOrders = orders.filter(o => !isLxrtsOrder(o));
        const today = formatDate(new Date());

        const totalRevenue = validOrders.reduce((sum, o) => sum + Number(o.grand_total || 0), 0);
        const totalOrders = validOrders.length;
        const todayOrders = validOrders.filter(o => formatDate(o.created_at) === today).length;
        const pendingOrders = validOrders.filter(o =>
            o.status !== "completed" && o.status !== "delivered" && o.status !== "cancelled"
        ).length;
        const completedOrders = validOrders.filter(o =>
            o.status === "completed" || o.status === "delivered"
        ).length;
        const cancelledOrders = validOrders.filter(o => o.status === "cancelled").length;

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthlyOrders = validOrders.filter(o => new Date(o.created_at) >= monthStart);
        const monthlyRevenue = monthlyOrders.reduce((sum, o) => sum + Number(o.grand_total || 0), 0);

        return {
            totalRevenue,
            totalOrders,
            todayOrders,
            pendingOrders,
            completedOrders,
            cancelledOrders,
            monthlyRevenue,
            monthlyOrders: monthlyOrders.length,
        };
    }, [orders]);

    const inventoryStats = useMemo(() => {
        const total = products.length;
        const onShopify = products.filter(p => p.shopify_product_id).length;

        let lowStock = 0;
        let outOfStock = 0;
        let totalInventory = 0;

        products.forEach((p) => {
            if (p.sync_enabled) {
                // LXRTS: use variant totals
                const totalQty = getLxrtsTotalInventory(p.id);
                totalInventory += totalQty;
                if (totalQty === 0) {
                    outOfStock++;
                } else if (totalQty < 5) {
                    lowStock++;
                }
            } else {
                // Regular: use products.inventory
                const qty = p.inventory || 0;
                totalInventory += qty;
                if (qty === 0) {
                    outOfStock++;
                } else if (qty < 5) {
                    lowStock++;
                }
            }
        });

        return { total, onShopify, lowStock, outOfStock, totalInventory };
    }, [products, variantInventory]);

    const recentOrders = useMemo(() => {
        return orders.filter(o => !isLxrtsOrder(o)).slice(0, recentOrdersCount);
    }, [orders, recentOrdersCount]);

    // ============ INVENTORY TAB ============
    const filteredProducts = useMemo(() => {
        return products.filter(p =>
            p.name?.toLowerCase().includes(inventorySearch.toLowerCase()) ||
            p.sku_id?.toLowerCase().includes(inventorySearch.toLowerCase())
        );
    }, [products, inventorySearch]);

    const inventoryTotalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);
    const currentProducts = useMemo(() => {
        const start = (inventoryPage - 1) * ITEMS_PER_PAGE;
        return filteredProducts.slice(start, start + ITEMS_PER_PAGE);
    }, [filteredProducts, inventoryPage]);

    // Regular product inventory update
    const handleInventoryUpdate = async (productId) => {
        if (editInventoryValue === "" || isNaN(Number(editInventoryValue))) {
            showPopup({ title: "Invalid", message: "Please enter a valid number.", type: "warning" });
            return;
        }
        setSavingInventory(true);
        const { error } = await supabase
            .from("products")
            .update({ inventory: Number(editInventoryValue) })
            .eq("id", productId);

        if (error) {
            showPopup({ title: "Error", message: "Failed to update inventory.", type: "error" });
        } else {
            setProducts(prev => prev.map(p => p.id === productId ? { ...p, inventory: Number(editInventoryValue) } : p));
            setEditingProductId(null);
            setEditInventoryValue("");
        }
        setSavingInventory(false);
    };

    // ============ LXRTS SHOPIFY FUNCTIONS ============

    // Fetch Shopify variants for a product
    // const fetchShopifyVariants = async (product) => {
    //     setLoadingVariants(product.id);
    //     try {
    //         const response = await fetch(
    //             `${config.SUPABASE_URL}/functions/v1/shopify-inventory`,
    //             {
    //                 method: "POST",
    //                 headers: {
    //                     "Content-Type": "application/json",
    //                     apikey: config.SUPABASE_KEY,
    //                     Authorization: `Bearer ${config.SUPABASE_KEY}`,
    //                 },
    //                 body: JSON.stringify({
    //                     action: "fetch",
    //                     product_id: product.id,
    //                 }),
    //             }
    //         );

    //         const result = await response.json();

    //         if (result.success && result.inventory) {
    //             // Convert inventory map to sorted array format for display
    //             const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL", "6XL"];

    //             const variantsArray = Object.entries(result.inventory).map(([size, qty]) => ({
    //                 size,
    //                 inventory_quantity: qty,
    //             }));

    //             // Sort by SIZE_ORDER
    //             variantsArray.sort((a, b) => {
    //                 const aIndex = SIZE_ORDER.indexOf(a.size);
    //                 const bIndex = SIZE_ORDER.indexOf(b.size);
    //                 if (aIndex === -1 && bIndex === -1) return a.size.localeCompare(b.size);
    //                 if (aIndex === -1) return 1;
    //                 if (bIndex === -1) return -1;
    //                 return aIndex - bIndex;
    //             });

    //             setShopifyVariants((prev) => ({
    //                 ...prev,
    //                 [product.id]: variantsArray,
    //             }));
    //         } else {
    //             console.error("Failed to fetch Shopify variants:", result.error);
    //             // Fallback: try to get from product_variants table
    //             const { data: variants } = await supabase
    //                 .from("product_variants")
    //                 .select("size, inventory")
    //                 .eq("product_id", product.id);

    //             if (variants && variants.length > 0) {
    //                 const variantsArray = variants.map((v) => ({
    //                     size: v.size,
    //                     inventory_quantity: v.inventory || 0,
    //                 }));
    //                 setShopifyVariants((prev) => ({
    //                     ...prev,
    //                     [product.id]: variantsArray,
    //                 }));
    //             }
    //         }
    //     } catch (err) {
    //         console.error("Error fetching variants:", err);
    //     }
    //     setLoadingVariants(null);
    // };

    const fetchAllLxrtsInventory = async (lxrtsProducts) => {
        setLxrtsSyncLoading(true);
        const inventoryMap = {};

        await Promise.allSettled(
            lxrtsProducts.map(async (product) => {
                try {
                    const response = await fetch(
                        `${config.SUPABASE_URL}/functions/v1/shopify-inventory`,
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                apikey: config.SUPABASE_KEY,
                                Authorization: `Bearer ${config.SUPABASE_KEY}`,
                            },
                            body: JSON.stringify({
                                action: "fetch",
                                product_id: product.id,
                            }),
                        }
                    );

                    const result = await response.json();

                    if (result.success && result.inventory) {
                        inventoryMap[product.id] = result.inventory;
                    } else {
                        // Fallback to database
                        const { data: variants } = await supabase
                            .from("product_variants")
                            .select("size, inventory")
                            .eq("product_id", product.id);

                        if (variants) {
                            const map = {};
                            variants.forEach((v) => {
                                map[v.size] = v.inventory || 0;
                            });
                            inventoryMap[product.id] = map;
                        }
                    }
                } catch (err) {
                    console.error(`Error syncing ${product.name}:`, err);
                    // Fallback to database
                    const { data: variants } = await supabase
                        .from("product_variants")
                        .select("size, inventory")
                        .eq("product_id", product.id);

                    if (variants) {
                        const map = {};
                        variants.forEach((v) => {
                            map[v.size] = v.inventory || 0;
                        });
                        inventoryMap[product.id] = map;
                    }
                }
            })
        );

        setVariantInventory(inventoryMap);
        setLxrtsSyncLoading(false);
    };

    // Toggle expand/collapse for LXRTS product
    const handleExpandProduct = (product) => {
        setExpandedProduct(expandedProduct === product.id ? null : product.id);
    };

    // Update variant inventory via Shopify edge function
    // Update variant inventory via Shopify edge function
    const handleVariantInventoryUpdate = async (productId, size) => {
        const newQty = Number(variantEditValue);
        if (variantEditValue === "" || isNaN(newQty) || newQty < 0) {
            return;
        }

        setSavingVariant(true);

        try {
            const oldQty = variantInventory[productId]?.[size] || 0;

            // 1. Update product_variants in Supabase
            const { error: updateError } = await supabase
                .from("product_variants")
                .update({ inventory: newQty })
                .eq("product_id", productId)
                .eq("size", size);

            if (updateError) {
                console.error("Supabase update error:", updateError);
                throw new Error("Failed to update Supabase");
            }

            // 2. Sync to Shopify using "reduce" with delta
            const delta = oldQty - newQty; // positive = reduce, negative = increase

            if (delta !== 0) {
                try {
                    const response = await fetch(
                        `${config.SUPABASE_URL}/functions/v1/shopify-inventory`,
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                apikey: config.SUPABASE_KEY,
                                Authorization: `Bearer ${config.SUPABASE_KEY}`,
                            },
                            body: JSON.stringify({
                                action: "reduce",
                                product_id: productId,
                                size: size,
                                quantity: delta,
                            }),
                        }
                    );

                    const result = await response.json();
                    if (!result.success) {
                        console.error("Shopify sync failed:", result.error);
                    }
                } catch (shopifyErr) {
                    console.error("Shopify sync error:", shopifyErr);
                }
            }

            // 3. Update local state
            setVariantInventory((prev) => ({
                ...prev,
                [productId]: {
                    ...prev[productId],
                    [size]: newQty,
                },
            }));

        } catch (err) {
            console.error("Variant update error:", err);
        }

        setEditingVariant(null);
        setVariantEditValue("");
        setSavingVariant(false);
    };

    // Toggle sync for product
    const handleSyncToggle = async (productId, currentValue) => {
        setSyncToggling(productId);
        const { error } = await supabase
            .from("products")
            .update({ sync_enabled: !currentValue })
            .eq("id", productId);

        if (error) {
            showPopup({ title: "Error", message: "Failed to toggle sync.", type: "error" });
        } else {
            setProducts(prev => prev.map(p => p.id === productId ? { ...p, sync_enabled: !currentValue } : p));
        }
        setSyncToggling(null);
    };


    // ============ ORDERS TAB ============
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
                case "unfulfilled":
                    return status !== "completed" && status !== "delivered" && status !== "cancelled";
                case "completed":
                    return status === "completed" || status === "delivered";
                case "cancelled":
                    return status === "cancelled";
                default:
                    return true;
            }
        });
    }, [orders, statusTab]);

    const filteredOrders = useMemo(() => {
        let result = filteredByStatus;

        if (orderSearch.trim()) {
            const q = orderSearch.toLowerCase();
            result = result.filter(order => {
                const item = order.items?.[0] || {};
                return (
                    order.order_no?.toLowerCase().includes(q) ||
                    item.product_name?.toLowerCase().includes(q) ||
                    order.delivery_name?.toLowerCase().includes(q) ||
                    order.delivery_phone?.includes(q) ||
                    order.salesperson?.toLowerCase().includes(q)
                );
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

        if (filters.payment.length > 0) {
            result = result.filter(order => filters.payment.includes(getPaymentStatus(order)));
        }

        if (filters.priority.length > 0) {
            result = result.filter(order => filters.priority.includes(getPriority(order)));
        }

        if (filters.orderType.length > 0) {
            result = result.filter(order => filters.orderType.includes(getOrderType(order)));
        }

        if (filters.store.length > 0) {
            result = result.filter(order => filters.store.includes(order.salesperson_store));
        }

        if (filters.salesperson) {
            result = result.filter(order => order.salesperson === filters.salesperson);
        }

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
            unfulfilled: validOrders.filter(o => {
                const s = o.status?.toLowerCase();
                return s !== "completed" && s !== "delivered" && s !== "cancelled";
            }).length,
            completed: validOrders.filter(o => {
                const s = o.status?.toLowerCase();
                return s === "completed" || s === "delivered";
            }).length,
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
            const label = filters.dateFrom && filters.dateTo
                ? `${filters.dateFrom} to ${filters.dateTo}`
                : filters.dateFrom ? `From ${filters.dateFrom}` : `Until ${filters.dateTo}`;
            chips.push({ type: "date", label });
        }
        if (filters.minPrice > 0 || filters.maxPrice < 500000) {
            chips.push({ type: "price", label: `Rs.${(filters.minPrice / 1000).toFixed(0)}K - Rs.${(filters.maxPrice / 1000).toFixed(0)}K` });
        }
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

    const clearAllFilters = () => {
        setFilters({
            dateFrom: "", dateTo: "", minPrice: 0, maxPrice: 500000,
            payment: [], priority: [], orderType: [], store: [], salesperson: "",
        });
    };

    const toggleFilter = (category, value) => {
        setFilters(prev => ({
            ...prev,
            [category]: prev[category].includes(value)
                ? prev[category].filter(v => v !== value)
                : [...prev[category], value]
        }));
    };

    const updateOrderStatus = async (orderId, newStatus) => {
        setStatusUpdating(orderId);
        const updateData = { status: newStatus };
        if (newStatus === "delivered") updateData.delivered_at = new Date().toISOString();

        const { error } = await supabase.from("orders").update(updateData).eq("id", orderId);
        if (error) {
            showPopup({ title: "Error", message: "Failed to update status.", type: "error" });
        } else {
            setOrders(prev => prev.map(o => o.id === orderId ? { ...o, ...updateData } : o));
        }
        setStatusUpdating(null);
    };

    // ============ ACCOUNTS TAB ============
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
                    id: `${order.id}-${idx}`,
                    order_no: order.order_no,
                    order_date: order.created_at,
                    sa_name: order.salesperson || "-",
                    client_name: order.delivery_name || "-",
                    address: order.delivery_address || "-",
                    city: order.delivery_city || "-",
                    state: order.delivery_state || "-",
                    pincode: order.delivery_pincode || "-",
                    product_name: item.product_name || "-",
                    gross_value: Math.round(grossValue * 100) / 100,
                    discount: Math.round(productDiscount * 100) / 100,
                    taxable_value: Math.round(taxableValue * 100) / 100,
                    gst: Math.round(gst * 100) / 100,
                    invoice_value: Math.round(invoiceValue * 100) / 100,
                    shipping_charges: idx === 0 ? (order.shipping_charge || 0) : 0,
                    cod_charges: idx === 0 ? (order.cod_charge || 0) : 0,
                    quantity,
                    status: order.status || "pending",
                    delivery_date: item.delivery_date || order.delivery_date,
                });
            });
        });
        return items;
    }, [orders]);

    const filteredAccountItems = useMemo(() => {
        let result = accountsLineItems;
        if (accountsSearch.trim()) {
            const q = accountsSearch.toLowerCase();
            result = result.filter(item =>
                item.order_no?.toLowerCase().includes(q) ||
                item.client_name?.toLowerCase().includes(q) ||
                item.product_name?.toLowerCase().includes(q) ||
                item.sa_name?.toLowerCase().includes(q)
            );
        }
        if (accountsDateFrom) {
            result = result.filter(item => new Date(item.order_date) >= new Date(accountsDateFrom));
        }
        if (accountsDateTo) {
            result = result.filter(item => new Date(item.order_date) <= new Date(accountsDateTo + "T23:59:59"));
        }
        if (accountsStatus) {
            result = result.filter(item => item.status === accountsStatus);
        }
        return result;
    }, [accountsLineItems, accountsSearch, accountsDateFrom, accountsDateTo, accountsStatus]);

    const accountsTotalPages = Math.ceil(filteredAccountItems.length / 20);
    const currentAccountItems = useMemo(() => {
        const start = (accountsPage - 1) * 20;
        return filteredAccountItems.slice(start, start + 20);
    }, [filteredAccountItems, accountsPage]);

    const accountsTotals = useMemo(() => {
        return {
            gross: filteredAccountItems.reduce((sum, i) => sum + i.gross_value, 0),
            discount: filteredAccountItems.reduce((sum, i) => sum + i.discount, 0),
            taxable: filteredAccountItems.reduce((sum, i) => sum + i.taxable_value, 0),
            gst: filteredAccountItems.reduce((sum, i) => sum + i.gst, 0),
            invoice: filteredAccountItems.reduce((sum, i) => sum + i.invoice_value, 0),
        };
    }, [filteredAccountItems]);

    // ============ PDF GENERATION ============
    const handleGeneratePdf = async (order, type = "customer") => {
        setPdfLoading(order.id);
        try {
            if (type === "warehouse") {
                await downloadWarehousePdf(order, null, true);
            } else {
                await downloadCustomerPdf(order);
            }
        } catch (error) {
            console.error("PDF generation failed:", error);
        } finally {
            setPdfLoading(null);
        }
    };

    // Reset pages when filters change
    useEffect(() => { setInventoryPage(1); }, [inventorySearch]);
    useEffect(() => { setOrdersPage(1); }, [orderSearch, statusTab, filters, sortBy]);
    useEffect(() => { setAccountsPage(1); }, [accountsSearch, accountsDateFrom, accountsDateTo, accountsStatus]);

    useEffect(() => {
        if (activeTab === "dashboard") {
            const lxrtsProducts = products.filter((p) => p.sync_enabled);
            if (lxrtsProducts.length > 0 && Object.keys(variantInventory).length === 0) {
                fetchAllLxrtsInventory(lxrtsProducts);
            }
        }
    }, [activeTab, products]);


    // ============ RENDER ============
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
                    <button className="admin-logout-btn" onClick={handleLogout}>
                        Logout
                    </button>
                </div>
            </header>

            <div className="admin-layout">
                {/* SIDEBAR */}
                <aside className={`admin-sidebar ${showSidebar ? "open" : ""}`}>
                    <nav className="admin-nav">
                        <button
                            className={`admin-nav-item ${activeTab === "dashboard" ? "active" : ""}`}
                            onClick={() => { setActiveTab("dashboard"); setShowSidebar(false); }}
                        >
                            Dashboard
                        </button>
                        <button
                            className={`admin-nav-item ${activeTab === "inventory" ? "active" : ""}`}
                            onClick={() => { setActiveTab("inventory"); setShowSidebar(false); }}
                        >
                            Inventory
                        </button>
                        <button
                            className={`admin-nav-item ${activeTab === "orders" ? "active" : ""}`}
                            onClick={() => { setActiveTab("orders"); setShowSidebar(false); }}
                        >
                            Orders
                        </button>
                        <button
                            className={`admin-nav-item ${activeTab === "accounts" ? "active" : ""}`}
                            onClick={() => { setActiveTab("accounts"); setShowSidebar(false); }}
                        >
                            Accounts
                        </button>
                        <button className="admin-nav-item logout" onClick={handleLogout}>
                            Logout
                        </button>
                    </nav>
                </aside>

                {/* MAIN CONTENT */}
                <main className="admin-content">
                    {/* ============ DASHBOARD TAB ============ */}
                    {activeTab === "dashboard" && (
                        <div className="admin-dashboard-tab">
                            <h2 className="admin-section-title">Overview</h2>

                            {/* Stats Grid */}
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card">
                                    <div className="stat-icon">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-indian-rupee-icon lucide-indian-rupee"><path d="M6 3h12" /><path d="M6 8h12" /><path d="m6 13 8.5 8" /><path d="M6 13h3" /><path d="M9 13c6.667 0 6.667-10 0-10" /></svg>
                                    </div>
                                    <div className="stat-info">
                                        <span className="stat-value">&#8377;{formatIndianNumber(dashboardStats.totalRevenue.toFixed(0))}</span>
                                        <span className="stat-label">Total Revenue</span>
                                    </div>
                                </div>
                                <div className="admin-stat-card">
                                    <div className="stat-icon">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-shopping-cart-icon lucide-shopping-cart"><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></svg>
                                    </div>
                                    <div className="stat-info">
                                        <span className="stat-value">{formatIndianNumber(dashboardStats.totalOrders)}</span>
                                        <span className="stat-label">Total Orders</span>
                                    </div>
                                </div>
                                <div className="admin-stat-card">
                                    <div className="stat-icon">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-calendar-arrow-down-icon lucide-calendar-arrow-down"><path d="m14 18 4 4 4-4" /><path d="M16 2v4" /><path d="M18 14v8" /><path d="M21 11.354V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7.343" /><path d="M3 10h18" /><path d="M8 2v4" /></svg>
                                    </div>
                                    <div className="stat-info">
                                        <span className="stat-value">{dashboardStats.todayOrders}</span>
                                        <span className="stat-label">Today's Orders</span>
                                    </div>
                                </div>
                                <div className="admin-stat-card">
                                    <div className="stat-icon">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-hourglass-icon lucide-hourglass"><path d="M5 22h14" /><path d="M5 2h14" /><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" /><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" /></svg>
                                    </div>
                                    <div className="stat-info">
                                        <span className="stat-value">{dashboardStats.pendingOrders}</span>
                                        <span className="stat-label">Pending</span>
                                    </div>
                                </div>
                            </div>

                            {/* Secondary Stats */}
                            <div className="admin-stats-grid secondary">
                                <div className="admin-stat-card small">
                                    <span className="stat-label">Monthly Revenue</span>
                                    <span className="stat-value">&#8377;{formatIndianNumber(dashboardStats.monthlyRevenue.toFixed(0))}</span>
                                </div>
                                <div className="admin-stat-card small">
                                    <span className="stat-label">Monthly Orders</span>
                                    <span className="stat-value">{dashboardStats.monthlyOrders}</span>
                                </div>
                                <div className="admin-stat-card small">
                                    <span className="stat-label">Completed</span>
                                    <span className="stat-value">{dashboardStats.completedOrders}</span>
                                </div>
                                <div className="admin-stat-card small">
                                    <span className="stat-label">Cancelled</span>
                                    <span className="stat-value">{dashboardStats.cancelledOrders}</span>
                                </div>
                            </div>

                            {/* Inventory Quick Stats */}
                            <h3 className="admin-subsection-title">Inventory Overview</h3>
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card">
                                    <div className="stat-icon">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v6" /><path d="M16.76 3a2 2 0 0 1 1.8 1.1l2.23 4.479a2 2 0 0 1 .21.891V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9.472a2 2 0 0 1 .211-.894L5.45 4.1A2 2 0 0 1 7.24 3z" /><path d="M3.054 9.013h17.893" /></svg>
                                    </div>
                                    <div className="stat-info">
                                        <span className="stat-value">{inventoryStats.total}</span>
                                        <span className="stat-label">Total Products</span>
                                    </div>
                                </div>
                                <div className="admin-stat-card">
                                    <div className="stat-icon">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                                    </div>
                                    <div className="stat-info">
                                        <span className="stat-value">{inventoryStats.onShopify}</span>
                                        <span className="stat-label">On Shopify</span>
                                    </div>
                                </div>
                                <div className="admin-stat-card warning">
                                    <div className="stat-icon">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
                                    </div>
                                    <div className="stat-info">
                                        <span className="stat-value">{inventoryStats.lowStock}</span>
                                        <span className="stat-label">Low Stock</span>
                                    </div>
                                </div>
                                <div className="admin-stat-card danger">
                                    <div className="stat-icon">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.929 4.929 19.07 19.071" /><circle cx="12" cy="12" r="10" /></svg>
                                    </div>
                                    <div className="stat-info">
                                        <span className="stat-value">{inventoryStats.outOfStock}</span>
                                        <span className="stat-label">Out of Stock</span>
                                    </div>
                                </div>
                            </div>

                            {/* Recent Orders */}
                            <div className="admin-recent-orders">
                                <div className="recent-header">
                                    <h3 className="admin-subsection-title">Recent Orders</h3>
                                    <select
                                        value={recentOrdersCount}
                                        onChange={(e) => setRecentOrdersCount(Number(e.target.value))}
                                        className="recent-count-select"
                                    >
                                        <option value={5}>Last 5</option>
                                        <option value={10}>Last 10</option>
                                        <option value={20}>Last 20</option>
                                    </select>
                                </div>
                                <div className="admin-table-wrapper">
                                    <div className="admin-table-container">
                                        <table className="admin-table">
                                            <thead>
                                                <tr>
                                                    <th>Order ID</th>
                                                    <th>Customer</th>
                                                    <th>Product</th>
                                                    <th>Amount</th>
                                                    <th>Status</th>
                                                    <th>Date</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {recentOrders.map(order => (
                                                    <tr key={order.id}>
                                                        <td><span className="order-id">{order.order_no || "-"}</span></td>
                                                        <td>{order.delivery_name || "-"}</td>
                                                        <td className="product-cell">{order.items?.[0]?.product_name || "-"}</td>
                                                        <td>&#8377;{formatIndianNumber(order.grand_total || 0)}</td>
                                                        <td>
                                                            <span className={`status-badge ${order.status || "pending"}`}>
                                                                {order.status || "Pending"}
                                                            </span>
                                                        </td>
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

                    {/* ============ INVENTORY TAB ============ */}
                    {activeTab === "inventory" && (
                        <div className="admin-inventory-tab">
                            <h2 className="admin-section-title">Inventory Management</h2>

                            {/* Stats */}
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card">
                                    <div className="stat-info">
                                        <span className="stat-value">{inventoryStats.total}</span>
                                        <span className="stat-label">Total Products</span>
                                    </div>
                                </div>
                                <div className="admin-stat-card">
                                    <div className="stat-info">
                                        <span className="stat-value">{formatIndianNumber(inventoryStats.totalInventory)}</span>
                                        <span className="stat-label">Total Stock</span>
                                    </div>
                                </div>
                                <div className="admin-stat-card warning">
                                    <div className="stat-info">
                                        <span className="stat-value">{inventoryStats.lowStock}</span>
                                        <span className="stat-label">Low Stock (&lt;5)</span>
                                    </div>
                                </div>
                                <div className="admin-stat-card danger">
                                    <div className="stat-info">
                                        <span className="stat-value">{inventoryStats.outOfStock}</span>
                                        <span className="stat-label">Out of Stock</span>
                                    </div>
                                </div>
                            </div>

                            {/* Search */}
                            <div className="admin-toolbar">
                                <div className="admin-search-wrapper">
                                    <span className="search-icon">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-search-icon lucide-search"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg>
                                    </span>
                                    <input
                                        type="text"
                                        placeholder="Search by name or SKU..."
                                        value={inventorySearch}
                                        onChange={(e) => setInventorySearch(e.target.value)}
                                        className="admin-search-input"
                                    />
                                    {inventorySearch && (
                                        <button className="search-clear" onClick={() => setInventorySearch("")}>x</button>
                                    )}
                                </div>
                                <span className="showing-info">
                                    Showing {currentProducts.length} of {filteredProducts.length} products
                                </span>
                            </div>

                            {/* Table */}
                            <div className="admin-table-wrapper">
                                <div className="admin-table-container">
                                    <table className="admin-table inventory-table">
                                        <thead>
                                            <tr>
                                                <th>SKU</th>
                                                <th>Product Name</th>
                                                <th>Default Top</th>
                                                <th>Default Bottom</th>
                                                <th>Base Price</th>
                                                <th>Inventory</th>
                                                {/* <th>Sync</th> */}
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {currentProducts.map(product => {
                                                const isLxrts = isLxrtsProduct(product);
                                                const isExpanded = expandedProduct === product.id;

                                                return (
                                                    <React.Fragment key={product.id}>
                                                        <tr className={`${isLxrts ? "lxrts-row" : ""} ${isExpanded ? "expanded" : ""}`}>
                                                            <td><span className="sku-code">{product.sku_id || "-"}</span></td>
                                                            <td className="product-name-cell">
                                                                {product.name || "-"}
                                                                {isLxrts && <span className="lxrts-badge">LXRTS</span>}
                                                            </td>
                                                            <td>{product.default_top || "-"}</td>
                                                            <td>{product.default_bottom || "-"}</td>
                                                            <td>&#8377;{formatIndianNumber(product.base_price || 0)}</td>
                                                            <td className="inventory-cell">
                                                                {isLxrts ? (
                                                                    <span className="inventory-value lxrts">
                                                                        {lxrtsSyncLoading ? "..." : getLxrtsTotalInventory(product.id)}
                                                                    </span>
                                                                ) : editingProductId === product.id ? (
                                                                    <div className="inventory-edit">
                                                                        <input
                                                                            type="number"
                                                                            value={editInventoryValue}
                                                                            onChange={(e) => setEditInventoryValue(e.target.value)}
                                                                            autoFocus
                                                                            onKeyDown={(e) => {
                                                                                if (e.key === "Enter") handleInventoryUpdate(product.id);
                                                                                if (e.key === "Escape") { setEditingProductId(null); setEditInventoryValue(""); }
                                                                            }}
                                                                        />
                                                                        <button onClick={() => handleInventoryUpdate(product.id)} disabled={savingInventory}>
                                                                            {savingInventory ? "..." : "Save"}
                                                                        </button>
                                                                        <button onClick={() => { setEditingProductId(null); setEditInventoryValue(""); }}>X</button>
                                                                    </div>
                                                                ) : (
                                                                    <span
                                                                        className={`inventory-value ${(product.inventory || 0) === 0 ? "out" : (product.inventory || 0) < 5 ? "low" : "ok"}`}
                                                                        onClick={() => { setEditingProductId(product.id); setEditInventoryValue(String(product.inventory || 0)); }}
                                                                    >
                                                                        {product.inventory || 0}
                                                                    </span>
                                                                )}
                                                            </td>
                                                            {/* <td className="sync-cell">
                                                                {isLxrts ? (
                                                                    <label className="sync-toggle">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={product.sync_enabled || false}
                                                                            onChange={() => handleSyncToggle(product.id, product.sync_enabled)}
                                                                            disabled={syncToggling === product.id}
                                                                        />
                                                                        <span className="sync-slider"></span>
                                                                    </label>
                                                                ) : (
                                                                    <span className="na-text">-</span>
                                                                )}
                                                            </td> */}
                                                            <td>
                                                                {isLxrts && (
                                                                    <button
                                                                        className={`expand-btn ${isExpanded ? "expanded" : ""}`}
                                                                        onClick={() => handleExpandProduct(product)}
                                                                    >
                                                                        {isExpanded ? "Collapse" : "Expand"}
                                                                    </button>
                                                                )}
                                                            </td>
                                                        </tr>

                                                        {/* LXRTS Expanded Variants */}
                                                        {isLxrts && isExpanded && (
                                                            <tr className="variants-row">
                                                                <td colSpan="8">
                                                                    <div className="variants-container">
                                                                        <div className="variants-header">
                                                                            <span className="variants-title">Size Variants - {product.name}</span>
                                                                            <span className="variants-total">
                                                                                Total: <strong>{getLxrtsTotalInventory(product.id)}</strong>
                                                                            </span>
                                                                        </div>
                                                                        {lxrtsSyncLoading ? (
                                                                            <p className="loading-text">Syncing inventory from Shopify...</p>
                                                                        ) : getProductSizes(product.id).length === 0 ? (
                                                                            <p className="no-variants">No variant data available</p>
                                                                        ) : (
                                                                            <div className="variants-grid">
                                                                                {getProductSizes(product.id).map((size) => {
                                                                                    const qty = variantInventory[product.id]?.[size] || 0;
                                                                                    const isEditingThis =
                                                                                        editingVariant?.productId === product.id &&
                                                                                        editingVariant?.size === size;

                                                                                    return (
                                                                                        <div key={size} className={`variant-card ${getInventoryClass(qty)}`}>
                                                                                            <span className="variant-size">{size}</span>
                                                                                            {isEditingThis ? (
                                                                                                <div className="variant-edit">
                                                                                                    <input
                                                                                                        type="number"
                                                                                                        value={variantEditValue}
                                                                                                        onChange={(e) => setVariantEditValue(e.target.value)}
                                                                                                        autoFocus
                                                                                                        min="0"
                                                                                                        onKeyDown={(e) => {
                                                                                                            if (e.key === "Enter") handleVariantInventoryUpdate(product.id, size);
                                                                                                            if (e.key === "Escape") { setEditingVariant(null); setVariantEditValue(""); }
                                                                                                        }}
                                                                                                    />
                                                                                                    <button
                                                                                                        onClick={() => handleVariantInventoryUpdate(product.id, size)}
                                                                                                        disabled={savingVariant}
                                                                                                    >
                                                                                                        {savingVariant ? "..." : "OK"}
                                                                                                    </button>
                                                                                                    <button onClick={() => { setEditingVariant(null); setVariantEditValue(""); }}>x</button>
                                                                                                </div>
                                                                                            ) : (
                                                                                                <span
                                                                                                    className="variant-qty"
                                                                                                    onClick={() => {
                                                                                                        setEditingVariant({ productId: product.id, size });
                                                                                                        setVariantEditValue(String(qty));
                                                                                                    }}
                                                                                                >
                                                                                                    {qty}
                                                                                                </span>
                                                                                            )}
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

                            {/* Pagination */}
                            {inventoryTotalPages > 1 && (
                                <div className="admin-pagination">
                                    <button onClick={() => setInventoryPage(p => Math.max(1, p - 1))} disabled={inventoryPage === 1}>Prev</button>
                                    <span>Page {inventoryPage} of {inventoryTotalPages}</span>
                                    <button onClick={() => setInventoryPage(p => Math.min(inventoryTotalPages, p + 1))} disabled={inventoryPage === inventoryTotalPages}>Next</button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ============ ORDERS TAB ============ */}
                    {activeTab === "orders" && (
                        <div className="admin-orders-tab">
                            <h2 className="admin-section-title">Order Management</h2>

                            {/* Search & Sort */}
                            <div className="admin-toolbar">
                                <div className="admin-search-wrapper">
                                    <span className="search-icon">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-search-icon lucide-search"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg>
                                    </span>
                                    <input
                                        type="text"
                                        placeholder="Search Order #, Customer, Phone..."
                                        value={orderSearch}
                                        onChange={(e) => setOrderSearch(e.target.value)}
                                        className="admin-search-input"
                                    />
                                    {orderSearch && (
                                        <button className="search-clear" onClick={() => setOrderSearch("")}>x</button>
                                    )}
                                </div>
                                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="admin-sort-select">
                                    <option value="newest">Newest First</option>
                                    <option value="oldest">Oldest First</option>
                                    <option value="delivery">Delivery Date</option>
                                    <option value="amount_high">Amount: High to Low</option>
                                    <option value="amount_low">Amount: Low to High</option>
                                </select>
                            </div>

                            {/* Status Tabs */}
                            <div className="admin-status-tabs">
                                {STATUS_TABS.map(tab => (
                                    <button
                                        key={tab.value}
                                        className={`status-tab ${statusTab === tab.value ? "active" : ""}`}
                                        onClick={() => setStatusTab(tab.value)}
                                    >
                                        {tab.label}
                                        <span className="tab-count">{orderTabCounts[tab.value]}</span>
                                    </button>
                                ))}
                            </div>

                            {/* Filter Dropdowns */}
                            <div className="admin-filter-bar" ref={dropdownRef}>
                                {/* Date Filter */}
                                <div className="filter-dropdown">
                                    <button
                                        className={`filter-btn ${(filters.dateFrom || filters.dateTo) ? "active" : ""}`}
                                        onClick={() => setOpenDropdown(openDropdown === "date" ? null : "date")}
                                    >
                                        Date Range &#9662;
                                    </button>
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

                                {/* Price Filter */}
                                <div className="filter-dropdown">
                                    <button
                                        className={`filter-btn ${(filters.minPrice > 0 || filters.maxPrice < 500000) ? "active" : ""}`}
                                        onClick={() => setOpenDropdown(openDropdown === "price" ? null : "price")}
                                    >
                                        Price &#9662;
                                    </button>
                                    {openDropdown === "price" && (
                                        <div className="dropdown-panel price-panel">
                                            <div className="dropdown-title">Order Value</div>
                                            <div className="price-inputs">
                                                <div className="price-input-wrap">
                                                    <span>Rs.</span>
                                                    <input
                                                        type="number"
                                                        value={filters.minPrice}
                                                        onChange={(e) => setFilters(prev => ({ ...prev, minPrice: Math.min(Number(e.target.value), prev.maxPrice - 1000) }))}
                                                    />
                                                </div>
                                                <span>to</span>
                                                <div className="price-input-wrap">
                                                    <span>Rs.</span>
                                                    <input
                                                        type="number"
                                                        value={filters.maxPrice}
                                                        onChange={(e) => setFilters(prev => ({ ...prev, maxPrice: Math.max(Number(e.target.value), prev.minPrice + 1000) }))}
                                                    />
                                                </div>
                                            </div>
                                            <button className="dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>

                                {/* Payment Filter */}
                                <div className="filter-dropdown">
                                    <button
                                        className={`filter-btn ${filters.payment.length > 0 ? "active" : ""}`}
                                        onClick={() => setOpenDropdown(openDropdown === "payment" ? null : "payment")}
                                    >
                                        Payment &#9662;
                                    </button>
                                    {openDropdown === "payment" && (
                                        <div className="dropdown-panel">
                                            <div className="dropdown-title">Payment Status</div>
                                            {["paid", "partial", "unpaid"].map(opt => (
                                                <label key={opt} className="checkbox-label">
                                                    <input type="checkbox" checked={filters.payment.includes(opt)} onChange={() => toggleFilter("payment", opt)} />
                                                    <span>{opt === "unpaid" ? "Unpaid (COD)" : opt.charAt(0).toUpperCase() + opt.slice(1)}</span>
                                                </label>
                                            ))}
                                            <button className="dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>

                                {/* Priority Filter */}
                                <div className="filter-dropdown">
                                    <button
                                        className={`filter-btn ${filters.priority.length > 0 ? "active" : ""}`}
                                        onClick={() => setOpenDropdown(openDropdown === "priority" ? null : "priority")}
                                    >
                                        Priority &#9662;
                                    </button>
                                    {openDropdown === "priority" && (
                                        <div className="dropdown-panel">
                                            <div className="dropdown-title">Priority</div>
                                            {["normal", "urgent"].map(opt => (
                                                <label key={opt} className="checkbox-label">
                                                    <input type="checkbox" checked={filters.priority.includes(opt)} onChange={() => toggleFilter("priority", opt)} />
                                                    <span>{opt.charAt(0).toUpperCase() + opt.slice(1)}</span>
                                                </label>
                                            ))}
                                            <button className="dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>

                                {/* Order Type Filter */}
                                <div className="filter-dropdown">
                                    <button
                                        className={`filter-btn ${filters.orderType.length > 0 ? "active" : ""}`}
                                        onClick={() => setOpenDropdown(openDropdown === "orderType" ? null : "orderType")}
                                    >
                                        Type &#9662;
                                    </button>
                                    {openDropdown === "orderType" && (
                                        <div className="dropdown-panel">
                                            <div className="dropdown-title">Order Type</div>
                                            {["standard", "custom", "alteration"].map(opt => (
                                                <label key={opt} className="checkbox-label">
                                                    <input type="checkbox" checked={filters.orderType.includes(opt)} onChange={() => toggleFilter("orderType", opt)} />
                                                    <span>{opt.charAt(0).toUpperCase() + opt.slice(1)}</span>
                                                </label>
                                            ))}
                                            <button className="dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>

                                {/* Store Filter */}
                                <div className="filter-dropdown">
                                    <button
                                        className={`filter-btn ${filters.store.length > 0 ? "active" : ""}`}
                                        onClick={() => setOpenDropdown(openDropdown === "store" ? null : "store")}
                                    >
                                        Store &#9662;
                                    </button>
                                    {openDropdown === "store" && (
                                        <div className="dropdown-panel">
                                            <div className="dropdown-title">Store</div>
                                            {["Delhi Store", "Ludhiana Store"].map(opt => (
                                                <label key={opt} className="checkbox-label">
                                                    <input type="checkbox" checked={filters.store.includes(opt)} onChange={() => toggleFilter("store", opt)} />
                                                    <span>{opt}</span>
                                                </label>
                                            ))}
                                            <button className="dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>

                                {/* Salesperson Filter */}
                                <div className="filter-dropdown">
                                    <button
                                        className={`filter-btn ${filters.salesperson ? "active" : ""}`}
                                        onClick={() => setOpenDropdown(openDropdown === "salesperson" ? null : "salesperson")}
                                    >
                                        Salesperson &#9662;
                                    </button>
                                    {openDropdown === "salesperson" && (
                                        <div className="dropdown-panel">
                                            <div className="dropdown-title">Salesperson</div>
                                            <select
                                                value={filters.salesperson}
                                                onChange={(e) => setFilters(prev => ({ ...prev, salesperson: e.target.value }))}
                                                className="sp-select"
                                            >
                                                <option value="">All Salespersons</option>
                                                {salespersons.map(sp => <option key={sp} value={sp}>{sp}</option>)}
                                            </select>
                                            <button className="dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Applied Filters */}
                            {appliedFilters.length > 0 && (
                                <div className="admin-applied-filters">
                                    <span className="applied-label">Applied:</span>
                                    {appliedFilters.map((chip, i) => (
                                        <span key={i} className="filter-chip">
                                            {chip.label}
                                            <button onClick={() => removeFilter(chip.type, chip.value)}>x</button>
                                        </span>
                                    ))}
                                    <button className="clear-all" onClick={clearAllFilters}>Clear All</button>
                                </div>
                            )}

                            {/* Orders Count */}
                            <div className="orders-count">Showing {filteredOrders.length} orders</div>

                            {/* Orders Table */}
                            <div className="admin-table-wrapper">
                                <div className="admin-table-container">
                                    <table className="admin-table orders-table">
                                        <thead>
                                            <tr>
                                                <th>Order ID</th>
                                                <th>Customer</th>
                                                <th>Product</th>
                                                <th>Amount</th>
                                                <th>Payment</th>
                                                <th>Status</th>
                                                <th>Store</th>
                                                <th>Date</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {currentOrders.length === 0 ? (
                                                <tr><td colSpan="9" className="no-data">No orders found</td></tr>
                                            ) : (
                                                currentOrders.map(order => {
                                                    const isUrgent = getPriority(order) === "urgent";
                                                    return (
                                                        <tr key={order.id} className={isUrgent ? "urgent-row" : ""}>
                                                            <td>
                                                                <span className="order-id">{order.order_no || "-"}</span>
                                                                {isUrgent && <span className="urgent-badge">URGENT</span>}
                                                            </td>
                                                            <td>
                                                                <div>{order.delivery_name || "-"}</div>
                                                                {/* <small className="phone-text">{order.delivery_phone || ""}</small> */}
                                                            </td>
                                                            <td className="product-cell">{order.items?.[0]?.product_name || "-"}</td>
                                                            <td>&#8377;{formatIndianNumber(order.grand_total || 0)}</td>
                                                            <td>
                                                                <span className={`payment-badge ${getPaymentStatus(order)}`}>
                                                                    {getPaymentStatus(order).charAt(0).toUpperCase() + getPaymentStatus(order).slice(1)}
                                                                </span>
                                                            </td>
                                                            <td>
                                                                <select
                                                                    className="status-select"
                                                                    value={order.status || "pending"}
                                                                    onChange={(e) => updateOrderStatus(order.id, e.target.value)}
                                                                    disabled={statusUpdating === order.id}
                                                                >
                                                                    {ORDER_STATUS_OPTIONS.map(opt => (
                                                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                                    ))}
                                                                </select>
                                                            </td>
                                                            <td>{order.salesperson_store || "-"}</td>
                                                            <td>{formatDate(order.created_at)}</td>
                                                            <td>
                                                                <div className="action-buttons">
                                                                    <button
                                                                        className="action-btn pdf"
                                                                        onClick={() => handleGeneratePdf(order, "customer")}
                                                                        disabled={pdfLoading === order.id}
                                                                        title="Customer PDF"
                                                                    >
                                                                        {pdfLoading === order.id ? "..." : "PDF"}
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Pagination */}
                            {ordersTotalPages > 1 && (
                                <div className="admin-pagination">
                                    <button onClick={() => setOrdersPage(p => Math.max(1, p - 1))} disabled={ordersPage === 1}>Prev</button>
                                    <span>Page {ordersPage} of {ordersTotalPages}</span>
                                    <button onClick={() => setOrdersPage(p => Math.min(ordersTotalPages, p + 1))} disabled={ordersPage === ordersTotalPages}>Next</button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ============ ACCOUNTS TAB ============ */}
                    {activeTab === "accounts" && (
                        <div className="admin-accounts-tab">
                            <h2 className="admin-section-title">Accounts & Finance</h2>

                            {/* Summary Cards */}
                            <div className="admin-stats-grid">
                                <div className="admin-stat-card">
                                    <div className="stat-info">
                                        <span className="stat-value">&#8377;{formatIndianNumber(accountsTotals.gross.toFixed(0))}</span>
                                        <span className="stat-label">Gross Value</span>
                                    </div>
                                </div>
                                <div className="admin-stat-card">
                                    <div className="stat-info">
                                        <span className="stat-value">&#8377;{formatIndianNumber(accountsTotals.discount.toFixed(0))}</span>
                                        <span className="stat-label">Total Discount</span>
                                    </div>
                                </div>
                                <div className="admin-stat-card">
                                    <div className="stat-info">
                                        <span className="stat-value">&#8377;{formatIndianNumber(accountsTotals.gst.toFixed(0))}</span>
                                        <span className="stat-label">Total GST</span>
                                    </div>
                                </div>
                                <div className="admin-stat-card">
                                    <div className="stat-info">
                                        <span className="stat-value">&#8377;{formatIndianNumber(accountsTotals.invoice.toFixed(0))}</span>
                                        <span className="stat-label">Invoice Value</span>
                                    </div>
                                </div>
                            </div>

                            {/* Filters */}
                            <div className="admin-toolbar accounts-toolbar">
                                <div className="admin-search-wrapper">
                                    <span className="search-icon">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-search-icon lucide-search"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg>
                                    </span>
                                    <input
                                        type="text"
                                        placeholder="Search Order, Customer, Product..."
                                        value={accountsSearch}
                                        onChange={(e) => setAccountsSearch(e.target.value)}
                                        className="admin-search-input"
                                    />
                                </div>
                                <div className="accounts-filters">
                                    <input type="date" value={accountsDateFrom} onChange={(e) => setAccountsDateFrom(e.target.value)} />
                                    <span>to</span>
                                    <input type="date" value={accountsDateTo} onChange={(e) => setAccountsDateTo(e.target.value)} />
                                    <div>
                                        <select value={accountsStatus} onChange={(e) => setAccountsStatus(e.target.value)}>
                                            <option value="">All Status</option>
                                            <option value="pending">Pending</option>
                                            <option value="in_production">In Production</option>
                                            <option value="ready">Ready</option>
                                            <option value="dispatched">Dispatched</option>
                                            <option value="delivered">Delivered</option>
                                            <option value="completed">Completed</option>
                                            <option value="cancelled">Cancelled</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Accounts Table */}
                            <div className="admin-table-wrapper">
                                <div className="admin-table-container accounts-table-container">
                                    <table className="admin-table accounts-table">
                                        <thead>
                                            <tr>
                                                <th>SA Name</th>
                                                <th>Order ID</th>
                                                <th>Date</th>
                                                <th>Customer</th>
                                                <th>Product</th>
                                                <th>Gross</th>
                                                <th>Discount</th>
                                                <th>Taxable</th>
                                                <th>GST</th>
                                                <th>Invoice</th>
                                                <th>Qty</th>
                                                <th>Status</th>
                                                <th>Delivery Date</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {currentAccountItems.length === 0 ? (
                                                <tr><td colSpan="12" className="no-data">No records found</td></tr>
                                            ) : (
                                                currentAccountItems.map(item => (
                                                    <tr key={item.id}>
                                                        <td>{item.sa_name}</td>
                                                        <td><span className="order-id">{item.order_no}</span></td>
                                                        <td>{formatDate(item.order_date)}</td>
                                                        <td>{item.client_name}</td>
                                                        <td className="product-cell">{item.product_name}</td>
                                                        <td className="amount">&#8377;{formatIndianNumber(item.gross_value)}</td>
                                                        <td className="amount">&#8377;{formatIndianNumber(item.discount)}</td>
                                                        <td className="amount">&#8377;{formatIndianNumber(item.taxable_value)}</td>
                                                        <td className="amount">&#8377;{formatIndianNumber(item.gst)}</td>
                                                        <td className="amount invoice">&#8377;{formatIndianNumber(item.invoice_value)}</td>
                                                        <td>{item.quantity}</td>
                                                        <td><span className={`status-badge ${item.status}`}>{item.status}</span></td>
                                                        <td>{formatDate(item.delivery_date)}</td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Pagination */}
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