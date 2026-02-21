import React, { useEffect, useState, useMemo } from "react";
import "./B2bOrderHistory.css";
import { supabase } from "../../lib/supabaseClient";
import { useNavigate } from "react-router-dom";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";

// Color display component (same as OrderHistory)
function ColorDot({ color }) {
    if (!color) return null;
    let hex = "#888";
    let name = "";
    if (typeof color === "string") {
        name = color;
        hex = color.startsWith("#") ? color : "#888";
    } else if (typeof color === "object" && color !== null) {
        name = color.name || "";
        hex = color.hex || "#888";
    }
    return (
        <span className="b2boh-color-dot-wrapper">
            <span className="b2boh-color-dot" style={{ backgroundColor: hex }}></span>
            {name && <span className="b2boh-color-name">{name}</span>}
        </span>
    );
}

export default function B2bOrderHistory() {
    const navigate = useNavigate();

    const [orders, setOrders] = useState([]);
    const [vendors, setVendors] = useState({});
    const [loading, setLoading] = useState(true);

    // Filters
    const [statusFilter, setStatusFilter] = useState("all");
    const [typeFilter, setTypeFilter] = useState("all");
    const [searchQuery, setSearchQuery] = useState("");

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const ordersPerPage = 5;

    // ==================== FETCH DATA ====================
    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                // ✅ Auth check - only B2B users allowed
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) {
                    navigate("/login", { replace: true });
                    return;
                }

                const { data: sp } = await supabase.from("salesperson").select("role").eq("email", user.email?.toLowerCase()).maybeSingle();
                const allowedRoles = ["executive", "merchandiser", "production"];
                if (!sp?.role || !allowedRoles.includes(sp.role)) {
                    console.log("❌ Access denied - not a B2B user");
                    await supabase.auth.signOut();
                    navigate("/login", { replace: true });
                    return;
                }

                let query = supabase
                    .from("orders")
                    .select("*")
                    .eq("is_b2b", true)
                    .order("created_at", { ascending: false });

                if (statusFilter !== "all") {
                    query = query.eq("approval_status", statusFilter);
                }
                if (typeFilter !== "all") {
                    query = query.eq("b2b_order_type", typeFilter);
                }

                const { data: ordersData, error } = await query;
                if (error) throw error;

                setOrders(ordersData || []);

                // Fetch vendor details
                const vendorIds = [...new Set((ordersData || []).map(o => o.vendor_id).filter(Boolean))];
                if (vendorIds.length > 0) {
                    const { data: vendorsData } = await supabase
                        .from("vendors")
                        .select("id, store_brand_name, vendor_code, location")
                        .in("id", vendorIds);
                    const vendorMap = {};
                    (vendorsData || []).forEach(v => { vendorMap[v.id] = v; });
                    setVendors(vendorMap);
                }
            } catch (err) {
                console.error("Error fetching orders:", err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [statusFilter, typeFilter]);

    // ==================== FILTERED & PAGINATED ====================
    const filteredOrders = useMemo(() => {
        if (!searchQuery.trim()) return orders;
        const q = searchQuery.toLowerCase().trim();
        return orders.filter((order) => {
            const item = order.items?.[0] || {};
            return (
                order.order_no?.toLowerCase().includes(q) ||
                order.po_number?.toLowerCase().includes(q) ||
                order.vendor_name?.toLowerCase().includes(q) ||
                item.product_name?.toLowerCase().includes(q) ||
                order.approval_status?.toLowerCase().includes(q)
            );
        });
    }, [orders, searchQuery]);

    const totalPages = Math.ceil(filteredOrders.length / ordersPerPage);
    const startIndex = (currentPage - 1) * ordersPerPage;
    const currentOrders = filteredOrders.slice(startIndex, startIndex + ordersPerPage);
    const goToPrevious = () => setCurrentPage((prev) => Math.max(prev - 1, 1));
    const goToNext = () => setCurrentPage((prev) => Math.min(prev + 1, totalPages));

    // Reset page on search change
    useEffect(() => { setCurrentPage(1); }, [searchQuery]);

    const recent = useMemo(() => orders.slice(0, 3), [orders]);

    // ==================== HELPERS ====================
    const handleBack = () => navigate("/b2b-executive-dashboard");
    const handleViewOrder = (orderId) => navigate(`/b2b-order-view/${orderId}`);

    const getStatusClass = (status) => {
        switch (status?.toLowerCase()) {
            case "approved": return "approved";
            case "rejected": return "rejected";
            default: return "pending";
        }
    };

    const getStatusText = (status) => {
        switch (status?.toLowerCase()) {
            case "approved": return "Approved";
            case "rejected": return "Rejected";
            default: return "Pending";
        }
    };

    // Image URL helper
    const publicImageUrl = (src) => {
        if (!src) return "/placeholder.png";
        if (/^https?:\/\//i.test(src)) return src;
        const { data } = supabase.storage.from("product-images").getPublicUrl(src);
        return data?.publicUrl || src;
    };

    // Stats
    const stats = useMemo(() => {
        const totalRevenue = orders.reduce((sum, o) => sum + Number(o.grand_total || 0), 0);
        const pendingCount = orders.filter(o => o.approval_status === "pending").length;
        const approvedCount = orders.filter(o => o.approval_status === "approved").length;
        return { totalRevenue, pendingCount, approvedCount };
    }, [orders]);

    if (loading) return <p className="loading">Loading...</p>;

    return (
        <div className="b2boh-page">
            {/* ===== HEADER ===== */}
            <header className="b2boh-header">
                <img src={Logo} alt="logo" className="b2boh-logo" onClick={handleBack} />
                <h1 className="b2boh-page-title">B2B Order History</h1>
                <button className="b2boh-back-btn" onClick={handleBack}>
                    ← Dashboard
                </button>
            </header>

            {/* ===== MAIN LAYOUT ===== */}
            <div className="b2boh-main">
                {/* ===== SIDEBAR ===== */}
                <aside className="b2boh-sidebar">
                    <div className="b2boh-sidebar-card">
                        <h4>Recent Orders</h4>
                        {recent.length === 0 ? <p className="muted">No orders yet</p> : recent.map(o => (
                            <div key={o.id} className="b2boh-recent-item" onClick={() => handleViewOrder(o.id)} style={{ cursor: "pointer" }}>
                                <span>{o.order_flag === "Urgent" ? "\u26A0 " : ""}#{o.order_no}</span>
                                <span className={`b2boh-mini-badge ${getStatusClass(o.approval_status)}`}>{getStatusText(o.approval_status)}</span>
                            </div>
                        ))}
                    </div>
                    <div className="b2boh-sidebar-card">
                        <h4>Summary</h4>
                        <div className="b2boh-summary-info">
                            <p className="b2boh-summary-amount">₹{formatIndianNumber(stats.totalRevenue)}</p>
                            <p className="b2boh-summary-label">Total Revenue</p>
                        </div>
                        <div className="b2boh-summary-row">
                            <span>Pending: <b>{stats.pendingCount}</b></span>
                            <span>Approved: <b>{stats.approvedCount}</b></span>
                        </div>
                    </div>
                    <div className="b2boh-sidebar-card">
                        <h4>Filters</h4>
                        <div className="b2boh-sidebar-filters">
                            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="b2boh-filter-select">
                                <option value="all">All Status</option>
                                <option value="pending">Pending</option>
                                <option value="approved">Approved</option>
                                <option value="rejected">Rejected</option>
                            </select>
                            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="b2boh-filter-select">
                                <option value="all">All Types</option>
                                <option value="Buyout">Buyout</option>
                                <option value="Consignment">Consignment</option>
                            </select>
                        </div>
                    </div>
                </aside>

                {/* ===== CONTENT ===== */}
                <section className="b2boh-content">
                    {/* Tabs */}
                    <div className="b2boh-tabs">
                        <button className="b2boh-tab active">All Orders</button>
                    </div>

                    {/* Orders List */}
                    <div className="b2boh-orders-list">
                        {/* Search Bar */}
                        <div className="b2boh-search-bar">
                            <input
                                type="text"
                                placeholder="Search by Order No, PO Number, Vendor, Product..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="b2boh-search-input"
                            />
                            {searchQuery && (
                                <button className="b2boh-search-clear" onClick={() => setSearchQuery("")}>✕</button>
                            )}
                        </div>

                        {filteredOrders.length === 0 && (
                            <p className="b2boh-empty">
                                {searchQuery ? `No orders found for "${searchQuery}"` : "No orders found."}
                            </p>
                        )}

                        {currentOrders.map((order) => {
                            const item = order.items?.[0] || {};
                            const imgSrc = publicImageUrl(item.image_url);
                            const vendor = vendors[order.vendor_id];

                            return (
                                <div
                                    key={order.id}
                                    className="b2boh-order-card"
                                    onClick={() => handleViewOrder(order.id)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    {/* Card Header */}
                                    <div className="b2boh-card-top">
                                        <div className="b2boh-card-info">
                                            <div className="b2boh-header-item">
                                                <span className="b2boh-header-label">Order No:</span>
                                                <span className="b2boh-header-value">{order.order_no || "—"}</span>
                                            </div>
                                            <div className="b2boh-header-item">
                                                <span className="b2boh-header-label">Order Date:</span>
                                                <span className="b2boh-header-value">{formatDate(order.created_at) || "—"}</span>
                                            </div>
                                            <div className="b2boh-header-item">
                                                <span className="b2boh-header-label">PO Number:</span>
                                                <span className="b2boh-header-value">{order.po_number || "—"}</span>
                                            </div>
                                            <div className="b2boh-header-item">
                                                <span className="b2boh-header-label">Delivery Date:</span>
                                                <span className="b2boh-header-value">{formatDate(order.delivery_date) || "—"}</span>
                                            </div>
                                        </div>
                                        <div className="b2boh-card-badges">
                                            <span className={`b2boh-badge ${getStatusClass(order.approval_status)}`}>
                                                {getStatusText(order.approval_status)}
                                            </span>
                                            {order.b2b_order_type && (
                                                <span className={`b2boh-badge type-${order.b2b_order_type?.toLowerCase()}`}>
                                                    {order.b2b_order_type}
                                                </span>
                                            )}
                                            {order.order_flag === "Urgent" && (
                                                <span className="b2boh-badge b2boh-urgent-badge">{"\u26A0"} Urgent</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Card Body */}
                                    <div className="b2boh-card-body">
                                        <div className="b2boh-card-img">
                                            <img src={imgSrc} alt={item.product_name || "Product"} />
                                        </div>
                                        <div className="b2boh-card-details">
                                            <h3 className="b2boh-product-title">{item.product_name || "—"}</h3>

                                            {/* Vendor info row */}
                                            {vendor && (
                                                <div className="b2boh-vendor-row">
                                                    <span className="b2boh-label">Vendor</span>
                                                    <span className="b2boh-value">
                                                        {vendor.store_brand_name} ({vendor.vendor_code})
                                                    </span>
                                                </div>
                                            )}

                                            <div className="b2boh-details-row">
                                                <div className="b2boh-detail">
                                                    <span className="b2boh-label">Top</span>
                                                    <span className="b2boh-value">{item.top || "—"} {item.top_color && <ColorDot color={item.top_color} />}</span>
                                                </div>
                                                <div className="b2boh-detail">
                                                    <span className="b2boh-label">Bottom</span>
                                                    <span className="b2boh-value">{item.bottom || "—"} {item.bottom_color && <ColorDot color={item.bottom_color} />}</span>
                                                </div>
                                                <div className="b2boh-detail">
                                                    <span className="b2boh-label">Size</span>
                                                    <span className="b2boh-value">{item.size || "—"}</span>
                                                </div>
                                                <div className="b2boh-detail">
                                                    <span className="b2boh-label">Category</span>
                                                    <span className="b2boh-value">{item.category || (item.isKids ? "Kids" : "Women")}</span>
                                                </div>
                                            </div>

                                            <div className="b2boh-details-row">
                                                <div className="b2boh-detail">
                                                    <span className="b2boh-label">Amount</span>
                                                    <span className="b2boh-value b2boh-amount">₹{formatIndianNumber(order.grand_total || 0)}</span>
                                                </div>
                                                <div className="b2boh-detail">
                                                    <span className="b2boh-label">Qty</span>
                                                    <span className="b2boh-value">{order.total_quantity || 1}</span>
                                                </div>
                                                <div className="b2boh-detail wide">
                                                    <span className="b2boh-label">Merchandiser</span>
                                                    <span className="b2boh-value">{order.merchandiser || order.merchandiser_name || "—"}</span>
                                                </div>
                                            </div>

                                            {item.extras && item.extras.length > 0 && (
                                                <div className="b2boh-extras">
                                                    <span className="b2boh-label">Extras:</span>
                                                    {item.extras.map((ex, i) => (
                                                        <span key={i} className="b2boh-extra-tag">
                                                            {ex.name}
                                                            {ex.color?.hex && (
                                                                <>
                                                                    <span style={{ display: 'inline-block', width: 12, height: 12, backgroundColor: ex.color.hex, borderRadius: '50%', marginLeft: 6, border: '1px solid #ccc', verticalAlign: 'middle' }} />
                                                                    <span style={{ marginLeft: 4 }}>{ex.color.name}</span>
                                                                </>
                                                            )}
                                                            <span style={{ marginLeft: 4 }}>(₹{formatIndianNumber(ex.price)})</span>
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            {item.additionals && item.additionals.filter(a => a.name && a.name.trim() !== "").length > 0 && (
                                                <div className="b2boh-extras">
                                                    <span className="b2boh-label">Additionals:</span>
                                                    <span className="b2boh-extra-tag">
                                                        {item.additionals.filter(a => a.name && a.name.trim() !== "").map((additional, idx, arr) => (
                                                            <span key={idx}>
                                                                {additional.name} (₹{formatIndianNumber(additional.price)})
                                                                {idx < arr.length - 1 && <span style={{ margin: '0 8px' }}>|</span>}
                                                            </span>
                                                        ))}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {/* Pagination */}
                        {filteredOrders.length > ordersPerPage && (
                            <div className="b2boh-pagination">
                                <button onClick={goToPrevious} disabled={currentPage === 1}>← Prev</button>
                                <span className="b2boh-page-info">Page {currentPage} of {totalPages}</span>
                                <button onClick={goToNext} disabled={currentPage === totalPages}>Next →</button>
                            </div>
                        )}
                    </div>
                </section>
            </div>

            {/* Floating Back */}
            <button className="b2boh-floating-back" onClick={handleBack}>←</button>
        </div>
    );
}