import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./B2bVendorOrders.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";

const ORDERS_PER_PAGE = 6;

export default function B2bVendorOrders() {
    const navigate = useNavigate();
    const { vendorId } = useParams();

    // Data
    const [vendor, setVendor] = useState(null);
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);

    // Stats
    const [stats, setStats] = useState({
        totalOrders: 0,
        totalRevenue: 0,
        pendingOrders: 0,
        avgOrderValue: 0,
    });

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);

    // ==================== FETCH DATA ====================
    useEffect(() => {
        const fetchData = async () => {
            if (!vendorId) return;

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

                // Fetch vendor
                const { data: vendorData, error: vendorError } = await supabase
                    .from("vendors")
                    .select("*")
                    .eq("id", vendorId)
                    .single();

                if (vendorError) throw vendorError;
                setVendor(vendorData);

                // Fetch orders for this vendor
                const { data: ordersData, error: ordersError } = await supabase
                    .from("orders")
                    .select("*")
                    .eq("vendor_id", vendorId)
                    .eq("is_b2b", true)
                    .order("created_at", { ascending: false });

                if (ordersError) throw ordersError;

                const allOrders = ordersData || [];
                setOrders(allOrders);
                setTotalPages(Math.ceil(allOrders.length / ORDERS_PER_PAGE));

                // Calculate stats
                const totalRevenue = allOrders.reduce((sum, o) => sum + (o.grand_total || 0), 0);
                const pendingOrders = allOrders.filter(o => o.approval_status === "pending").length;

                setStats({
                    totalOrders: allOrders.length,
                    totalRevenue: totalRevenue,
                    pendingOrders: pendingOrders,
                    avgOrderValue: allOrders.length > 0 ? totalRevenue / allOrders.length : 0,
                });
            } catch (err) {
                console.error("Error fetching data:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [vendorId]);

    // ==================== HANDLERS ====================
    const handleViewOrder = (orderId) => {
        navigate(`/b2b-order-view/${orderId}`);
    };

    const handleNewOrder = () => {
        // Pre-select this vendor for new order
        sessionStorage.setItem("b2bVendorData", JSON.stringify({
            selectedVendorId: vendorId,
            vendor: vendor,
        }));
        navigate("/b2b-vendor-selection");
    };

    const handleBack = () => {
        navigate("/b2b-order-history");
    };

    const getStatusBadge = (status) => {
        const statusMap = {
            pending: { class: "status-pending", label: "Pending" },
            approved: { class: "status-approved", label: "Approved" },
            rejected: { class: "status-rejected", label: "Rejected" },
        };
        const s = statusMap[status?.toLowerCase()] || statusMap.pending;
        return <span className={`status-badge ${s.class}`}>{s.label}</span>;
    };

    // Get paginated orders
    const paginatedOrders = orders.slice(
        (currentPage - 1) * ORDERS_PER_PAGE,
        currentPage * ORDERS_PER_PAGE
    );

    if (loading) {
        return (
            <div className="b2b-vo-container">
                <div className="loading-state">
                    <span className="loading-spinner"></span>
                    <p>Loading vendor orders...</p>
                </div>
            </div>
        );
    }

    if (!vendor) {
        return (
            <div className="b2b-vo-container">
                <div className="empty-state">
                    <span className="empty-icon">❌</span>
                    <h3>Vendor not found</h3>
                    <button className="back-btn-large" onClick={handleBack}>
                        ← Back to Order History
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="b2b-vo-container">
            {/* Header */}
            <header className="b2b-vo-header">
                <div className="header-left">
                    <button className="back-btn" onClick={handleBack}>←</button>
                    <img src={Logo} alt="Logo" className="header-logo" />
                </div>
                <div className="header-right">
                    <button className="new-order-btn" onClick={handleNewOrder}>
                        + New Order for {vendor.store_brand_name}
                    </button>
                </div>
            </header>

            {/* Vendor Info Card */}
            <div className="vendor-hero">
                <div className="vendor-hero-left">
                    <div className="vendor-avatar">
                        {vendor.store_brand_name?.charAt(0) || "V"}
                    </div>
                    <div className="vendor-hero-info">
                        <h1>{vendor.store_brand_name}</h1>
                        <div className="vendor-meta">
                            <span className="vendor-code">{vendor.vendor_code}</span>
                            {vendor.location && <span className="vendor-location">📍 {vendor.location}</span>}
                        </div>
                        {vendor.gst_number && (
                            <span className="vendor-gst">GST: {vendor.gst_number}</span>
                        )}
                    </div>
                </div>
                <div className="vendor-hero-stats">
                    <div className="hero-stat">
                        <span className="stat-value">{stats.totalOrders}</span>
                        <span className="stat-label">Total Orders</span>
                    </div>
                    <div className="hero-stat">
                        <span className="stat-value">₹{formatIndianNumber(stats.totalRevenue)}</span>
                        <span className="stat-label">Total Revenue</span>
                    </div>
                    <div className="hero-stat">
                        <span className="stat-value">{stats.pendingOrders}</span>
                        <span className="stat-label">Pending</span>
                    </div>
                    <div className="hero-stat">
                        <span className="stat-value">₹{formatIndianNumber(stats.avgOrderValue.toFixed(0))}</span>
                        <span className="stat-label">Avg Order Value</span>
                    </div>
                </div>
            </div>

            {/* Orders Section */}
            <div className="b2b-vo-content">
                <div className="section-header">
                    <h2>Order History</h2>
                    <span className="order-count">{orders.length} orders</span>
                </div>

                {orders.length === 0 ? (
                    <div className="empty-state">
                        <span className="empty-icon">📭</span>
                        <h3>No orders yet</h3>
                        <p>Create the first order for this vendor</p>
                        <button className="create-btn" onClick={handleNewOrder}>
                            Create New Order
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="orders-grid">
                            {paginatedOrders.map((order) => (
                                <div
                                    key={order.id}
                                    className="order-card"
                                    onClick={() => handleViewOrder(order.id)}
                                >
                                    <div className="order-card-header">
                                        <div className="order-main-info">
                                            <span className="order-no">{order.order_no}</span>
                                            {getStatusBadge(order.approval_status)}
                                        </div>
                                        <span className={`order-type ${order.b2b_order_type?.toLowerCase()}`}>
                                            {order.b2b_order_type || "N/A"}
                                        </span>
                                    </div>

                                    <div className="order-card-body">
                                        <div className="info-row">
                                            <span className="label">PO Number</span>
                                            <span className="value">{order.po_number || "N/A"}</span>
                                        </div>
                                        <div className="info-row">
                                            <span className="label">Merchandiser</span>
                                            <span className="value">{order.merchandiser_name || "N/A"}</span>
                                        </div>
                                        <div className="info-row">
                                            <span className="label">Items</span>
                                            <span className="value">{order.total_quantity || 0} units</span>
                                        </div>
                                        <div className="info-row">
                                            <span className="label">Delivery</span>
                                            <span className="value">
                                                {order.delivery_date ? formatDate(order.delivery_date) : "N/A"}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="order-card-footer">
                                        <span className="order-date">{formatDate(order.created_at)}</span>
                                        <span className="order-total">
                                            ₹{formatIndianNumber(order.grand_total || 0)}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="pagination">
                                <button
                                    className="page-btn"
                                    disabled={currentPage === 1}
                                    onClick={() => setCurrentPage(p => p - 1)}
                                >
                                    ← Previous
                                </button>
                                <div className="page-numbers">
                                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                                        <button
                                            key={page}
                                            className={`page-num ${currentPage === page ? "active" : ""}`}
                                            onClick={() => setCurrentPage(page)}
                                        >
                                            {page}
                                        </button>
                                    ))}
                                </div>
                                <button
                                    className="page-btn"
                                    disabled={currentPage === totalPages}
                                    onClick={() => setCurrentPage(p => p + 1)}
                                >
                                    Next →
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}