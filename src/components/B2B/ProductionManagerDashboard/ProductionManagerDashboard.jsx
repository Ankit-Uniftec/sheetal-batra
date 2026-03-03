import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import "./ProductionManagerDashboard.css";
import Logo from "../../../images/logo.png";
import formatIndianNumber from "../../../utils/formatIndianNumber";
import formatDate from "../../../utils/formatDate";
import { usePopup } from "../../../components/Popup";

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

// ==================== STAT CARD ====================
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

    // Orders tab state
    const [orderSearch, setOrderSearch] = useState("");
    const [channelFilter, setChannelFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState("all");
    const [currentPage, setCurrentPage] = useState(1);
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

            const [profileResult, ordersResult] = await Promise.all([
                supabase.from("salesperson").select("*").eq("email", user.email?.toLowerCase()).maybeSingle(),
                supabase.from("orders").select("*").order("created_at", { ascending: false })
            ]);

            if (profileResult.data) setProfile(profileResult.data);
            if (ordersResult.data) setOrders(ordersResult.data);

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

    // ==================== COMPUTED STATS ====================
    const channelStats = useMemo(() => {
        const total = orders.length;
        const b2b = orders.filter(o => o.is_b2b === true).length;
        const lxrts = orders.filter(o => !o.is_b2b && o.order_no?.startsWith("LXRTS")).length;
        const store = total - b2b - lxrts;
        return {
            total, b2b, website: lxrts, store: store > 0 ? store : 0,
            b2bPct: total > 0 ? Math.round((b2b / total) * 100) : 0,
            websitePct: total > 0 ? Math.round((lxrts / total) * 100) : 0,
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

    // Hardcoded production stats (replace later)
    const productionMetrics = useMemo(() => ({
        productionLoad: { active: statusStats.inProd, capacity: 150, percentage: statusStats.inProd > 0 ? Math.min(Math.round((statusStats.inProd / 150) * 100), 100) : 34 },
        bottlenecks: { count: 3, critical: 1, areas: ["Embroidery", "QC Check", "Packaging"] },
        staffCapacity: { total: 45, active: 38, onLeave: 7, utilization: 84 },
        rework: { percentage: 4.2, totalReworks: 12, trend: "down" },
        dispatchBacklog: { pending: statusStats.readyForDispatch || 8, overdue: 2, avgDelay: "1.5 days" },
    }), [statusStats]);

    const recentOrders = useMemo(() => orders.slice(0, 10), [orders]);

    // ==================== FILTERED + PAGINATED ORDERS ====================
    const filteredOrders = useMemo(() => {
        let filtered = [...orders];
        if (channelFilter === "b2b") filtered = filtered.filter(o => o.is_b2b === true);
        else if (channelFilter === "website") filtered = filtered.filter(o => !o.is_b2b && o.order_no?.startsWith("LXRTS"));
        else if (channelFilter === "store") filtered = filtered.filter(o => !o.is_b2b && !o.order_no?.startsWith("LXRTS"));

        if (statusFilter !== "all") filtered = filtered.filter(o => o.status?.toLowerCase() === statusFilter);

        if (orderSearch.trim()) {
            const q = orderSearch.toLowerCase();
            filtered = filtered.filter(o => {
                const productName = o.items?.[0]?.product_name || "";
                return (o.order_no || "").toLowerCase().includes(q) || (o.delivery_name || "").toLowerCase().includes(q) || (o.delivery_phone || "").toLowerCase().includes(q) || (o.po_number || "").toLowerCase().includes(q) || productName.toLowerCase().includes(q);
            });
        }
        return filtered;
    }, [orders, channelFilter, statusFilter, orderSearch]);

    const totalPages = Math.ceil(filteredOrders.length / ORDERS_PER_PAGE);
    const paginatedOrders = useMemo(() => {
        const start = (currentPage - 1) * ORDERS_PER_PAGE;
        return filteredOrders.slice(start, start + ORDERS_PER_PAGE);
    }, [filteredOrders, currentPage]);

    // ==================== HELPERS ====================
    const handleLogout = async () => { await supabase.auth.signOut(); navigate("/login"); };

    const getChannelLabel = (order) => { if (order.is_b2b) return "B2B"; if (order.order_no?.startsWith("LXRTS")) return "Website"; return "Store"; };
    const getChannelClass = (order) => { if (order.is_b2b) return "pm-channel-b2b"; if (order.order_no?.startsWith("LXRTS")) return "pm-channel-website"; return "pm-channel-store"; };

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
                                    <option value="">Normal</option><option value="low">Low</option><option value="high">High</option><option value="urgent">Urgent</option>
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
                    <img src={Logo} alt="logo" className="pm-header-logo" onClick={() => setActiveTab("overview")} />
                    <div className="pm-header-center"><p className="pm-header-title">Production Manager</p></div>
                    <div className="pm-header-right">
                        <button className="pm-header-btn" onClick={handleLogout}><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/></svg></button>
                        <div className="pm-hamburger-icon" onClick={() => setShowSidebar(!showSidebar)}><div className="pm-bar"></div><div className="pm-bar"></div><div className="pm-bar"></div></div>
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
                                    <StatCard title="Total Orders (All Channels)" value={formatIndianNumber(channelStats.total)} subtitle={`B2B: ${channelStats.b2b} | Website: ${channelStats.website} | Store: ${channelStats.store}`} highlight={true} icon="📦" />
                                    <StatCard title="Production Load" value={`${productionMetrics.productionLoad.percentage}%`} subtitle={`${productionMetrics.productionLoad.active} of ${productionMetrics.productionLoad.capacity} capacity`} icon="⚙️" />
                                    <StatCard title="Bottlenecks" value={productionMetrics.bottlenecks.count} subtitle={`${productionMetrics.bottlenecks.critical} critical · ${productionMetrics.bottlenecks.areas[0]}`} highlight={productionMetrics.bottlenecks.critical > 0} icon="⚠️" />
                                </div>
                                <div className="pm-stats-row-3">
                                    <StatCard title="Staff Capacity" value={`${productionMetrics.staffCapacity.utilization}%`} subtitle={`${productionMetrics.staffCapacity.active} active / ${productionMetrics.staffCapacity.total} total · ${productionMetrics.staffCapacity.onLeave} on leave`} icon="👥" />
                                    <StatCard title="Rework %" value={`${productionMetrics.rework.percentage}%`} subtitle={`${productionMetrics.rework.totalReworks} items · Trend: ${productionMetrics.rework.trend === "down" ? "↓ Improving" : "↑ Rising"}`} icon="🔄" />
                                    <StatCard title="Dispatch Backlog" value={productionMetrics.dispatchBacklog.pending} subtitle={`${productionMetrics.dispatchBacklog.overdue} overdue · Avg delay: ${productionMetrics.dispatchBacklog.avgDelay}`} highlight={productionMetrics.dispatchBacklog.overdue > 0} icon="🚚" />
                                </div>
                                <div className="pm-channel-card">
                                    <p className="pm-card-title">Orders by Channel</p>
                                    <div className="pm-channel-body">
                                        <ChannelRow label="Website (Online)" count={channelStats.website} percentage={channelStats.websitePct} color="#1565c0" />
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
                                <h2 className="pm-tab-title">All Orders ({filteredOrders.length})</h2>
                                <div className="pm-filters-row">
                                    <input type="text" placeholder="Search order #, client, product, PO..." value={orderSearch} onChange={(e) => { setOrderSearch(e.target.value); setCurrentPage(1); }} className="pm-search-input" />
                                    <select value={channelFilter} onChange={(e) => { setChannelFilter(e.target.value); setCurrentPage(1); }} className="pm-filter-select">
                                        <option value="all">All Channels</option><option value="b2b">B2B</option><option value="website">Website</option><option value="store">Store</option>
                                    </select>
                                    <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }} className="pm-filter-select">
                                        <option value="all">All Statuses</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="prepared">Prepared</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option>
                                    </select>
                                </div>

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
                                                    <button className="pm-action-btn pm-edit-btn" onClick={(e) => openEditModal(e, order)}>✏️ Edit Order</button>
                                                    <button className="pm-action-btn pm-priority-btn" onClick={(e) => openPriorityModal(e, order)}>🏷️ {order.priority ? `Priority: ${order.priority}` : "Set Priority"}</button>
                                                    <span className={`pm-recent-status ${getStatusClass(statusLabel)}`} style={{ marginLeft: "auto" }}>{statusLabel}</span>
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

                        {/* ===== PLACEHOLDER TABS ===== */}
                        {activeTab === "production" && <div className="pm-placeholder-tab"><p className="pm-placeholder-title">Production</p><p className="pm-muted">Production tracking — coming soon</p></div>}
                        {activeTab === "dispatch" && <div className="pm-placeholder-tab"><p className="pm-placeholder-title">Dispatch</p><p className="pm-muted">Dispatch management — coming soon</p></div>}
                        {activeTab === "calendar" && <div className="pm-placeholder-tab"><p className="pm-placeholder-title">Calendar</p><p className="pm-muted">Delivery calendar — coming soon</p></div>}
                        {activeTab === "staff" && <div className="pm-placeholder-tab"><p className="pm-placeholder-title">Staff</p><p className="pm-muted">Staff management — coming soon</p></div>}
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