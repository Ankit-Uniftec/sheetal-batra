import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./B2bExecutiveDashboard.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";
import { usePopup } from "../../components/Popup";

// Status Tabs
const STATUS_TABS = [
    { value: "all", label: "All Orders" },
    { value: "pending", label: "Pending Approval" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
    { value: "in_production", label: "In Production" },
];

// Timeline options
const TIMELINE_OPTIONS = [
    { value: "today", label: "Today" },
    { value: "weekly", label: "Last 7 Days" },
    { value: "monthly", label: "Last 30 Days" },
    { value: "yearly", label: "This Year" },
    { value: "all", label: "All Time" },
];

const ITEMS_PER_PAGE = 15;

export default function B2bExecutiveDashboard() {
    const { showPopup, PopupComponent } = usePopup();
    const navigate = useNavigate();

    // User info (will come from auth later)
    const userName = "Nandini";

    const [activeTab, setActiveTab] = useState("dashboard");
    const [showSidebar, setShowSidebar] = useState(false);
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);

    // Dashboard states
    const [timeline, setTimeline] = useState("monthly");
    const [recentOrdersCount, setRecentOrdersCount] = useState(10);

    // Orders states
    const [orderSearch, setOrderSearch] = useState("");
    const [statusTab, setStatusTab] = useState("all");
    const [ordersPage, setOrdersPage] = useState(1);
    const [sortBy, setSortBy] = useState("newest");

    // Alerts
    const [alerts, setAlerts] = useState([]);

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
            const { data: ordersData, error: ordersError } = await supabase
                .from("orders")
                .select(`
                    *,
                    vendors (
                        id,
                        store_brand_name,
                        location,
                        vendor_code
                    )
                `)
                .eq("is_b2b", true)
                .order("created_at", { ascending: false });

            if (ordersError) throw ordersError;
            setOrders(ordersData || []);

            // Set alerts for rejected orders
            const rejectedOrders = (ordersData || []).filter(o => o.approval_status === "rejected");
            setAlerts(rejectedOrders.map(o => ({
                id: o.id,
                type: "rejection",
                message: `Order ${o.order_no} was rejected`,
                reason: o.rejection_reason,
                date: o.updated_at,
            })));
        } catch (err) {
            console.error("Error fetching data:", err);
            showPopup({ title: "Error", message: "Failed to load data: " + err.message, type: "error" });
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        navigate("/login");
    };

    // Date range helper
    const getDateRange = (timelineValue) => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        switch (timelineValue) {
            case "today": return { start: today, end: now };
            case "weekly":
                const weekAgo = new Date(today);
                weekAgo.setDate(weekAgo.getDate() - 7);
                return { start: weekAgo, end: now };
            case "monthly":
                const monthAgo = new Date(today);
                monthAgo.setDate(monthAgo.getDate() - 30);
                return { start: monthAgo, end: now };
            case "yearly":
                const yearStart = new Date(now.getFullYear(), 0, 1);
                return { start: yearStart, end: now };
            case "all":
            default:
                return { start: new Date(0), end: now };
        }
    };

    // Dashboard Stats
    const dashboardStats = useMemo(() => {
        const dateRange = getDateRange(timeline);
        const filteredOrders = orders.filter(o => {
            const orderDate = new Date(o.created_at);
            return orderDate >= dateRange.start && orderDate <= dateRange.end;
        });

        const totalOrders = filteredOrders.length;
        const totalValue = filteredOrders.reduce((sum, o) => sum + Number(o.grand_total || 0), 0);
        const pendingApproval = filteredOrders.filter(o => o.approval_status === "pending").length;
        const approved = filteredOrders.filter(o => o.approval_status === "approved").length;
        const rejected = filteredOrders.filter(o => o.approval_status === "rejected").length;
        const dispatched = filteredOrders.filter(o => o.production_status === "dispatched").length;

        return { totalOrders, totalValue, pendingApproval, approved, rejected, dispatched };
    }, [orders, timeline]);

    // Order tab counts
    const orderTabCounts = useMemo(() => ({
        all: orders.length,
        pending: orders.filter(o => o.approval_status === "pending").length,
        approved: orders.filter(o => o.approval_status === "approved").length,
        rejected: orders.filter(o => o.approval_status === "rejected").length,
        in_production: orders.filter(o => o.production_status === "in_production" || o.production_status === "accepted").length,
    }), [orders]);

    // Filtered orders
    const filteredOrders = useMemo(() => {
        let result = [...orders];

        if (statusTab !== "all") {
            if (statusTab === "in_production") {
                result = result.filter(o => o.production_status === "in_production" || o.production_status === "accepted");
            } else {
                result = result.filter(o => o.approval_status === statusTab);
            }
        }

        if (orderSearch.trim()) {
            const q = orderSearch.toLowerCase();
            result = result.filter(o =>
                o.order_no?.toLowerCase().includes(q) ||
                o.po_number?.toLowerCase().includes(q) ||
                o.vendors?.store_brand_name?.toLowerCase().includes(q) ||
                o.vendors?.vendor_code?.toLowerCase().includes(q)
            );
        }

        result.sort((a, b) => {
            switch (sortBy) {
                case "oldest": return new Date(a.created_at) - new Date(b.created_at);
                case "delivery": return new Date(a.delivery_date || 0) - new Date(b.delivery_date || 0);
                case "amount_high": return (b.grand_total || 0) - (a.grand_total || 0);
                case "amount_low": return (a.grand_total || 0) - (b.grand_total || 0);
                default: return new Date(b.created_at) - new Date(a.created_at);
            }
        });

        return result;
    }, [orders, statusTab, orderSearch, sortBy]);

    // Pagination
    const ordersTotalPages = Math.ceil(filteredOrders.length / ITEMS_PER_PAGE);
    const currentOrders = useMemo(() => {
        const start = (ordersPage - 1) * ITEMS_PER_PAGE;
        return filteredOrders.slice(start, start + ITEMS_PER_PAGE);
    }, [filteredOrders, ordersPage]);

    // Check if order can be edited (within 30 hours of submission)
    const canEditOrder = (order) => {
        if (order.approval_status === "rejected") return true;
        if (order.approval_status === "approved") return false;
        const submittedAt = new Date(order.submitted_for_approval_at || order.created_at);
        const now = new Date();
        const hoursDiff = (now - submittedAt) / (1000 * 60 * 60);
        return hoursDiff <= 30;
    };

    // Upcoming deliveries (next 7 days)
    const upcomingDeliveries = useMemo(() => {
        const now = new Date();
        const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        return orders.filter(o => {
            if (!o.delivery_date) return false;
            const delDate = new Date(o.delivery_date);
            return delDate >= now && delDate <= nextWeek && o.approval_status === "approved";
        }).slice(0, 10);
    }, [orders]);

    // Recent orders for dashboard
    const recentOrders = useMemo(() => orders.slice(0, recentOrdersCount), [orders, recentOrdersCount]);

    // Reset page on filter change
    useEffect(() => { setOrdersPage(1); }, [orderSearch, statusTab, sortBy]);

    // Handlers
    const handleCreateOrder = () => navigate("/b2b-vendor-selection");
    const handleViewOrder = (order) => navigate(`/b2b-order-view/${order.id}`);
    const handleEditOrder = (order) => {
        if (!canEditOrder(order)) {
            showPopup({ title: "Cannot Edit", message: "Edit window has closed (30 hours limit).", type: "warning" });
            return;
        }
        navigate(`/b2b-order-edit/${order.id}`);
    };

    if (loading) {
        return (
            <div className="admin-page">
                <div className="admin-loading">
                    <div className="admin-spinner"></div>
                    <p>Loading Dashboard...</p>
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
                <h1 className="admin-title">B2B Executive Dashboard</h1>
                <div className="admin-header-right">
                    <span className="admin-user-name">{userName}</span>
                    <button className="admin-logout-btn" onClick={handleLogout}>Logout</button>
                </div>
            </header>

            <div className="admin-layout">
                {/* SIDEBAR */}
                <aside className={`admin-sidebar ${showSidebar ? "open" : ""}`}>
                    <nav className="admin-nav">
                        <button className={`admin-nav-item ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => { setActiveTab("dashboard"); setShowSidebar(false); }}>
                            Dashboard
                        </button>
                        <button className={`admin-nav-item ${activeTab === "orders" ? "active" : ""}`} onClick={() => { setActiveTab("orders"); setShowSidebar(false); }}>
                            Orders {orderTabCounts.pending > 0 && <span className="nav-badge">{orderTabCounts.pending}</span>}
                        </button>
                        <button className={`admin-nav-item ${activeTab === "calendar" ? "active" : ""}`} onClick={() => { setActiveTab("calendar"); setShowSidebar(false); }}>
                            Delivery Calendar
                        </button>
                        <button className={`admin-nav-item ${activeTab === "alerts" ? "active" : ""}`} onClick={() => { setActiveTab("alerts"); setShowSidebar(false); }}>
                            Alerts {alerts.length > 0 && <span className="nav-badge danger">{alerts.length}</span>}
                        </button>
                        <button className="admin-nav-item create-order" onClick={handleCreateOrder}>
                            + Create Order
                        </button>
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
                                    <div className="timeline-buttons">
                                        {TIMELINE_OPTIONS.map(opt => (
                                            <button key={opt.value} className={`timeline-btn ${timeline === opt.value ? 'active' : ''}`} onClick={() => setTimeline(opt.value)}>
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Stats Grid - 6 cards like AdminDashboard */}
                            <div className="admin-stats-grid overview-grid">
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Total Orders</span>
                                    <span className="stat-value">{dashboardStats.totalOrders}</span>
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Total Value</span>
                                    <span className="stat-value">₹{formatIndianNumber(dashboardStats.totalValue)}</span>
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Pending Approval</span>
                                    <span className="stat-value">{dashboardStats.pendingApproval}</span>
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Approved</span>
                                    <span className="stat-value">{dashboardStats.approved}</span>
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Rejected</span>
                                    <span className="stat-value">{dashboardStats.rejected}</span>
                                </div>
                                <div className="admin-stat-card overview-card">
                                    <span className="stat-label">Dispatched</span>
                                    <span className="stat-value">{dashboardStats.dispatched}</span>
                                </div>
                            </div>

                            {/* Alerts Section */}
                            {alerts.length > 0 && (
                                <div className="b2b-alerts-section">
                                    <h3 className="admin-subsection-title">⚠️ Action Required - Rejected Orders</h3>
                                    <div className="b2b-alerts-list">
                                        {alerts.slice(0, 5).map(alert => (
                                            <div key={alert.id} className="b2b-alert-item">
                                                <div className="alert-content">
                                                    <span className="alert-message">{alert.message}</span>
                                                    {alert.reason && <span className="alert-reason">Reason: {alert.reason}</span>}
                                                </div>
                                                <button className="action-btn pdf" onClick={() => handleEditOrder(orders.find(o => o.id === alert.id))}>
                                                    Edit & Resubmit
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

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
                                                <tr>
                                                    <th>Order No</th>
                                                    <th>PO Number</th>
                                                    <th>Vendor</th>
                                                    <th>Type</th>
                                                    <th>Amount</th>
                                                    <th>Status</th>
                                                    <th>Date</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {recentOrders.map(order => (
                                                    <tr key={order.id} onClick={() => handleViewOrder(order)} style={{cursor: 'pointer'}}>
                                                        <td><span className="order-id">{order.order_no || "-"}</span></td>
                                                        <td>{order.po_number || "-"}</td>
                                                        <td>
                                                            <div className="vendor-cell">
                                                                <span className="vendor-name">{order.vendors?.store_brand_name || "-"}</span>
                                                                <span className="vendor-location">{order.vendors?.location || ""}</span>
                                                            </div>
                                                        </td>
                                                        <td><span className={`type-badge ${order.b2b_order_type?.toLowerCase()}`}>{order.b2b_order_type || "-"}</span></td>
                                                        <td>₹{formatIndianNumber(order.grand_total || 0)}</td>
                                                        <td><span className={`status-badge ${order.approval_status || "pending"}`}>{order.approval_status || "pending"}</span></td>
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

                    {/* ORDERS TAB */}
                    {activeTab === "orders" && (
                        <div className="admin-orders-tab">
                            <div className="orders-header-row">
                                <h2 className="admin-section-title">Order Management</h2>
                                <button className="create-order-btn" onClick={handleCreateOrder}>+ Create New Order</button>
                            </div>

                            {/* Toolbar */}
                            <div className="admin-toolbar">
                                <div className="admin-search-wrapper">
                                    <span className="search-icon">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg>
                                    </span>
                                    <input
                                        type="text"
                                        placeholder="Search Order #, PO, Vendor..."
                                        value={orderSearch}
                                        onChange={(e) => setOrderSearch(e.target.value)}
                                        className="admin-search-input"
                                    />
                                    {orderSearch && <button className="search-clear" onClick={() => setOrderSearch("")}>×</button>}
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
                                    <button key={tab.value} className={`status-tab ${statusTab === tab.value ? "active" : ""}`} onClick={() => setStatusTab(tab.value)}>
                                        {tab.label}<span className="tab-count">{orderTabCounts[tab.value] || 0}</span>
                                    </button>
                                ))}
                            </div>

                            <div className="orders-count">Showing {filteredOrders.length} orders</div>

                            {/* Orders Table */}
                            <div className="admin-table-wrapper">
                                <div className="admin-table-container">
                                    <table className="admin-table orders-table">
                                        <thead>
                                            <tr>
                                                <th>Order No</th>
                                                <th>PO Number</th>
                                                <th>Vendor</th>
                                                <th>Type</th>
                                                <th>Amount</th>
                                                <th>Delivery Date</th>
                                                <th>Status</th>
                                                <th>Created</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {currentOrders.length === 0 ? (
                                                <tr><td colSpan="9" className="no-data">No orders found</td></tr>
                                            ) : currentOrders.map(order => (
                                                <tr key={order.id}>
                                                    <td><span className="order-id">{order.order_no || "-"}</span></td>
                                                    <td>{order.po_number || "-"}</td>
                                                    <td>
                                                        <div className="vendor-cell">
                                                            <span className="vendor-name">{order.vendors?.store_brand_name || "-"}</span>
                                                            <span className="vendor-location">{order.vendors?.location || ""}</span>
                                                        </div>
                                                    </td>
                                                    <td><span className={`type-badge ${order.b2b_order_type?.toLowerCase()}`}>{order.b2b_order_type || "-"}</span></td>
                                                    <td>₹{formatIndianNumber(order.grand_total || 0)}</td>
                                                    <td>{order.delivery_date ? formatDate(order.delivery_date) : "-"}</td>
                                                    <td><span className={`status-badge ${order.approval_status || "pending"}`}>{order.approval_status || "pending"}</span></td>
                                                    <td>{formatDate(order.created_at)}</td>
                                                    <td>
                                                        <div className="action-buttons">
                                                            <button className="action-btn view" onClick={() => handleViewOrder(order)}>View</button>
                                                            {canEditOrder(order) && (
                                                                <button className="action-btn edit" onClick={() => handleEditOrder(order)}>Edit</button>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
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

                    {/* CALENDAR TAB */}
                    {activeTab === "calendar" && (
                        <div className="admin-calendar-tab">
                            <h2 className="admin-section-title">Delivery Calendar</h2>
                            <p className="calendar-subtitle">Upcoming deliveries in the next 7 days</p>

                            {upcomingDeliveries.length === 0 ? (
                                <div className="no-data-box">
                                    <span className="no-data-icon">📅</span>
                                    <p>No upcoming deliveries</p>
                                </div>
                            ) : (
                                <div className="delivery-list">
                                    {upcomingDeliveries.map(order => (
                                        <div key={order.id} className="delivery-item" onClick={() => handleViewOrder(order)}>
                                            <div className="delivery-date-box">
                                                <span className="day">{new Date(order.delivery_date).getDate()}</span>
                                                <span className="month">{new Date(order.delivery_date).toLocaleString("en-IN", { month: "short" })}</span>
                                            </div>
                                            <div className="delivery-info">
                                                <span className="order-no">{order.order_no}</span>
                                                <span className="vendor">{order.vendors?.store_brand_name} - {order.vendors?.location}</span>
                                                <span className="amount">₹{formatIndianNumber(order.grand_total || 0)}</span>
                                            </div>
                                            <span className={`type-badge ${order.b2b_order_type?.toLowerCase()}`}>{order.b2b_order_type}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ALERTS TAB */}
                    {activeTab === "alerts" && (
                        <div className="admin-alerts-tab">
                            <h2 className="admin-section-title">Alerts & Notifications</h2>

                            {alerts.length === 0 ? (
                                <div className="no-data-box">
                                    <span className="no-data-icon">✅</span>
                                    <p>No alerts! All orders are in good shape.</p>
                                </div>
                            ) : (
                                <div className="alerts-full-list">
                                    {alerts.map(alert => {
                                        const order = orders.find(o => o.id === alert.id);
                                        return (
                                            <div key={alert.id} className="alert-card">
                                                <div className="alert-card-header">
                                                    <span className="alert-icon-large">⚠️</span>
                                                    <div className="alert-title-area">
                                                        <h4>{alert.message}</h4>
                                                        <span className="alert-date">{formatDate(alert.date)}</span>
                                                    </div>
                                                </div>
                                                {alert.reason && (
                                                    <div className="alert-reason-box">
                                                        <strong>Rejection Reason:</strong>
                                                        <p>{alert.reason}</p>
                                                    </div>
                                                )}
                                                {order && (
                                                    <div className="alert-order-details">
                                                        <div className="detail-row"><span>Vendor:</span><span>{order.vendors?.store_brand_name} - {order.vendors?.location}</span></div>
                                                        <div className="detail-row"><span>PO Number:</span><span>{order.po_number}</span></div>
                                                        <div className="detail-row"><span>Amount:</span><span>₹{formatIndianNumber(order.grand_total || 0)}</span></div>
                                                    </div>
                                                )}
                                                <div className="alert-card-actions">
                                                    <button className="btn-secondary" onClick={() => handleViewOrder(order)}>View Details</button>
                                                    <button className="btn-primary" onClick={() => handleEditOrder(order)}>Edit & Resubmit</button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}