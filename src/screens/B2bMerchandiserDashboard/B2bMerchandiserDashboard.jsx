import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./B2bMerchandiserDashboard.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";

export default function B2bMerchandiserDashboard() {
    const navigate = useNavigate();

    const [activeTab, setActiveTab] = useState("dashboard");
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [orders, setOrders] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [vendorMap, setVendorMap] = useState({});
    const [loading, setLoading] = useState(true);
    const [showSidebar, setShowSidebar] = useState(false);

    // Approvals
    const [approvalModal, setApprovalModal] = useState(null);
    const [approvalReason, setApprovalReason] = useState("");
    const [approvalProcessing, setApprovalProcessing] = useState(false);

    // Orders tab filters
    const [orderSearch, setOrderSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [typeFilter, setTypeFilter] = useState("all");
    const [currentPage, setCurrentPage] = useState(1);
    const ORDERS_PER_PAGE = 20;

    // Vendor tab
    const [vendorSearch, setVendorSearch] = useState("");
    const [vendorPage, setVendorPage] = useState(1);
    const VENDORS_PER_PAGE = 10;

    // ==================== FETCH DATA ====================
    const loadAllData = useCallback(async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { setLoading(false); return; }
            setUser(user);

            const [profileResult, ordersResult, vendorsResult] = await Promise.all([
                supabase.from("salesperson").select("*").eq("email", user.email?.toLowerCase()).maybeSingle(),
                supabase.from("orders").select("*").eq("is_b2b", true).order("created_at", { ascending: false }),
                supabase.from("vendors").select("*").eq("is_active", true).order("store_brand_name", { ascending: true })
            ]);

            if (profileResult.data) setProfile(profileResult.data);
            if (ordersResult.data) {
                setOrders(ordersResult.data);
                const vendorIds = [...new Set((ordersResult.data || []).map(o => o.vendor_id).filter(Boolean))];
                if (vendorIds.length > 0) {
                    const { data: vData } = await supabase
                        .from("vendors")
                        .select("id, store_brand_name, vendor_code, location")
                        .in("id", vendorIds);
                    const vMap = {};
                    (vData || []).forEach(v => { vMap[v.id] = v; });
                    setVendorMap(vMap);
                }
            }
            if (vendorsResult.data) setVendors(vendorsResult.data);
            setLoading(false);
        } catch (err) {
            console.error("Load error:", err);
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadAllData(); }, [loadAllData]);

    // ==================== STATS ====================
    const stats = useMemo(() => {
        const totalRevenue = orders.reduce((sum, o) => sum + Number(o.grand_total || 0), 0);
        const pending = orders.filter(o => o.approval_status === "pending");
        const approved = orders.filter(o => o.approval_status === "approved");
        const rejected = orders.filter(o => o.approval_status === "rejected");
        const buyoutValue = orders.filter(o => o.b2b_order_type === "Buyout").reduce((sum, o) => sum + Number(o.grand_total || 0), 0);
        const consignmentValue = orders.filter(o => o.b2b_order_type === "Consignment").reduce((sum, o) => sum + Number(o.grand_total || 0), 0);
        return { totalRevenue, totalOrders: orders.length, pending, approved, rejected, buyoutValue, consignmentValue };
    }, [orders]);

    // ==================== FILTERED ORDERS ====================
    const filteredOrders = useMemo(() => {
        let filtered = [...orders];
        if (statusFilter !== "all") filtered = filtered.filter(o => o.approval_status === statusFilter);
        if (typeFilter !== "all") filtered = filtered.filter(o => o.b2b_order_type?.toLowerCase() === typeFilter);
        if (orderSearch.trim()) {
            const q = orderSearch.toLowerCase();
            filtered = filtered.filter(o =>
                o.order_no?.toLowerCase().includes(q) || o.po_number?.toLowerCase().includes(q) ||
                o.merchandiser_name?.toLowerCase().includes(q) || vendorMap[o.vendor_id]?.store_brand_name?.toLowerCase().includes(q)
            );
        }
        return filtered;
    }, [orders, statusFilter, typeFilter, orderSearch, vendorMap]);

    const paginatedOrders = useMemo(() => {
        const start = (currentPage - 1) * ORDERS_PER_PAGE;
        return filteredOrders.slice(start, start + ORDERS_PER_PAGE);
    }, [filteredOrders, currentPage]);

    const filteredVendors = useMemo(() => {
        if (!vendorSearch.trim()) return vendors;
        const q = vendorSearch.toLowerCase();
        return vendors.filter(v => v.store_brand_name?.toLowerCase().includes(q) || v.vendor_code?.toLowerCase().includes(q) || v.location?.toLowerCase().includes(q));
    }, [vendors, vendorSearch]);

    const paginatedVendors = useMemo(() => {
        const start = (vendorPage - 1) * VENDORS_PER_PAGE;
        return filteredVendors.slice(start, start + VENDORS_PER_PAGE);
    }, [filteredVendors, vendorPage]);

    const totalVendorPages = Math.ceil(filteredVendors.length / VENDORS_PER_PAGE);

    // ==================== APPROVAL ACTIONS ====================
    const handleApprovalAction = async () => {
        if (!approvalModal) return;
        if (approvalModal.action === "reject" && !approvalReason.trim()) return;
        setApprovalProcessing(true);
        try {
            const { order, action } = approvalModal;
            const newStatus = action === "approve" ? "approved" : "rejected";

            const { error: orderError } = await supabase.from("orders").update({
                approval_status: newStatus, approved_by: user?.email || "unknown",
                approved_at: new Date().toISOString(),
            }).eq("id", order.id);
            if (orderError) throw orderError;

            await supabase.from("b2b_approvals").update({
                status: newStatus, reviewed_by: user?.email || "unknown",
                reviewed_at: new Date().toISOString(), notes: approvalReason.trim() || null,
            }).eq("order_id", order.id).eq("status", "pending");

            if (newStatus === "approved" && order.b2b_order_type === "Buyout" && order.vendor_id) {
                const { data: vendor } = await supabase.from("vendors").select("current_credit_used").eq("id", order.vendor_id).single();
                if (vendor) {
                    await supabase.from("vendors").update({ current_credit_used: (vendor.current_credit_used || 0) + (order.grand_total || 0) }).eq("id", order.vendor_id);
                }
            }

            setApprovalModal(null);
            setApprovalReason("");
            loadAllData();
        } catch (err) {
            console.error("Approval error:", err);
            alert("Failed to process. Please try again.");
        } finally { setApprovalProcessing(false); }
    };

    // ==================== HELPERS ====================
    const handleLogout = async () => { await supabase.auth.signOut(); navigate("/login"); };
    const handleViewOrder = (orderId) => navigate(`/b2b-order-view/${orderId}`);
    const handleViewVendorOrders = (vendorId) => {
        const vendor = vendorMap[vendorId] || vendors.find(v => v.id === vendorId);
        setOrderSearch(vendor?.store_brand_name || "");
        setStatusFilter("all");
        setTypeFilter("all");
        setCurrentPage(1);
        setActiveTab("orders");
    };

    const getStatusBadgeClass = (status) => {
        switch (status?.toLowerCase()) {
            case "approved": return "merch-status-approved";
            case "rejected": return "merch-status-rejected";
            default: return "merch-status-pending";
        }
    };

    if (loading) return <p className="loading-text">Loading Dashboard...</p>;

    return (
        <div className="merch-dashboard-wrapper">
            {/* ===== HEADER ===== */}
            <header className="merch-header">
                <img src={Logo} alt="logo" className="merch-header-logo" onClick={() => setActiveTab("dashboard")} />
                <div className="merch-header-right">
                    <button className="merch-header-btn" onClick={handleLogout}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /></svg>
                    </button>
                    <div className="merch-hamburger-icon" onClick={() => setShowSidebar(!showSidebar)}>
                        <div className="merch-bar"></div><div className="merch-bar"></div><div className="merch-bar"></div>
                    </div>
                </div>
            </header>

            {/* ===== GRID LAYOUT ===== */}
            <div className={`merch-grid-table ${showSidebar ? "merch-sidebar-open" : ""}`}>

                {/* ===== SIDEBAR ===== */}
                <aside className={`merch-sidebar ${showSidebar ? "merch-open" : ""}`}>
                    <nav className="merch-menu">
                        <a className={`merch-menu-item ${activeTab === "profile" ? "active" : ""}`} onClick={() => { setActiveTab("profile"); setShowSidebar(false); }}>View Profile</a>
                        <a className={`merch-menu-item ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => { setActiveTab("dashboard"); setShowSidebar(false); }}>Dashboard</a>
                        <a className={`merch-menu-item ${activeTab === "approvals" ? "active" : ""}`} onClick={() => { setActiveTab("approvals"); setShowSidebar(false); }}>Approvals {stats.pending.length > 0 && <span className="merch-badge-count">{stats.pending.length}</span>}</a>
                        <a className={`merch-menu-item ${activeTab === "orders" ? "active" : ""}`} onClick={() => { setActiveTab("orders"); setShowSidebar(false); }}>All Orders</a>
                        <a className={`merch-menu-item ${activeTab === "vendors" ? "active" : ""}`} onClick={() => { setActiveTab("vendors"); setShowSidebar(false); }}>Vendor Book</a>
                        <a className={`merch-menu-item ${activeTab === "consignment" ? "active" : ""}`} onClick={() => { setActiveTab("consignment"); setShowSidebar(false); }}>Consignment</a>
                        <a className="merch-menu-item-logout" onClick={handleLogout}>Log Out</a>
                    </nav>
                </aside>

                {/* ===== DASHBOARD TAB ===== */}
                {activeTab === "dashboard" && (
                    <>
                        <div className="merch-cell merch-stat-1">
                            <StatCard title="Pending Approval" value={stats.pending.length} change={`Total: ${stats.totalOrders}`} highlight />
                        </div>
                        <div className="merch-cell merch-stat-2">
                            <StatCard title="Total Revenue" value={`\u20B9${formatIndianNumber(stats.totalRevenue)}`} change={`Approved: ${stats.approved.length}`} />
                        </div>
                        <div className="merch-cell merch-stat-3">
                            <StatCard title="Vendors" value={vendors.length} change="Active" />
                        </div>

                        <div className="merch-cell merch-revenue-section">
                            <div className="merch-revenue-card">
                                <div className="merch-revenue-header"><p className="merch-rev-label">Revenue Breakdown</p></div>
                                <div className="merch-rev-row">
                                    <div className="merch-rev-item"><span className="merch-rev-title">Buyout</span><span className="merch-rev-val">{`\u20B9${formatIndianNumber(stats.buyoutValue)}`}</span></div>
                                    <div className="merch-rev-divider"></div>
                                    <div className="merch-rev-item"><span className="merch-rev-title">Consignment</span><span className="merch-rev-val">{`\u20B9${formatIndianNumber(stats.consignmentValue)}`}</span></div>
                                    <div className="merch-rev-divider"></div>
                                    <div className="merch-rev-item"><span className="merch-rev-title">Approved</span><span className="merch-rev-val">{stats.approved.length}</span></div>
                                    <div className="merch-rev-divider"></div>
                                    <div className="merch-rev-item"><span className="merch-rev-title">Rejected</span><span className="merch-rev-val merch-red">{stats.rejected.length}</span></div>
                                </div>
                            </div>
                        </div>

                        <aside className="merch-cell merch-pending-box">
                            <div className="merch-pending-header">
                                <span className="merch-pending-title">Pending Approvals</span>
                                <button className="merch-view-btn" onClick={() => setActiveTab("approvals")}>View All</button>
                            </div>
                            <div className="merch-pending-body">
                                {stats.pending.length === 0 ? (
                                    <p className="merch-muted">{"\u2728"} All caught up!</p>
                                ) : (
                                    stats.pending.slice(0, 8).map(order => (
                                        <div key={order.id} className="merch-pending-item">
                                            <div className="merch-pending-top">
                                                <b className="merch-gold-text">{order.order_no}</b>
                                                <span className={`merch-type-tag ${order.b2b_order_type === "Buyout" ? "merch-tag-buyout" : "merch-tag-consignment"}`}>{order.b2b_order_type || "\u2014"}</span>
                                            </div>
                                            <p style={{ fontSize: 12, color: "#777", margin: "2px 0" }}>PO: {order.po_number || "\u2014"} {"\u00B7"} {`\u20B9${formatIndianNumber(order.grand_total || 0)}`}</p>
                                            <div className="merch-pending-btns">
                                                <button className="merch-approve-sm" onClick={() => setApprovalModal({ order, action: "approve" })}>{"\u2713"}</button>
                                                <button className="merch-reject-sm" onClick={() => setApprovalModal({ order, action: "reject" })}>{"\u2715"}</button>
                                                <button className="merch-detail-sm" onClick={() => handleViewOrder(order.id)}>View</button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </aside>

                        <div className="merch-cell merch-recent-orders">
                            <div className="merch-orders-card">
                                <div className="merch-card-header">
                                    <span className="merch-card-title">Recent Orders ({orders.slice(0, 10).length})</span>
                                    <button className="merch-view-btn" onClick={() => setActiveTab("orders")}>View All</button>
                                </div>
                                <div className="merch-cardbox">
                                    {orders.length === 0 ? (<p className="merch-muted">No orders yet</p>) : (
                                        orders.slice(0, 10).map(o => (
                                            <div className="merch-order-item" key={o.id} onClick={() => handleViewOrder(o.id)} style={{ cursor: "pointer" }}>
                                                <p><b>Order No:</b> {o.order_no}</p>
                                                <p><b>PO:</b> {o.po_number || "\u2014"} &nbsp;|&nbsp; <b>Vendor:</b> {vendorMap[o.vendor_id]?.store_brand_name || "\u2014"}</p>
                                                <p><b>Type:</b> {o.b2b_order_type || "\u2014"} &nbsp;|&nbsp; <b>Status:</b> <span className={getStatusBadgeClass(o.approval_status)}>{o.approval_status || "Pending"}</span></p>
                                                <p><b>Total:</b> {`\u20B9${formatIndianNumber(o.grand_total || 0)}`} &nbsp;|&nbsp; <b>Date:</b> {formatDate(o.created_at)}</p>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {/* ===== APPROVALS TAB ===== */}
                {activeTab === "approvals" && (
                    <div className="merch-tab-wrapper">
                        <h2 className="merch-tab-title">Pending Approvals ({stats.pending.length})</h2>
                        {stats.pending.length === 0 ? (
                            <p className="merch-muted" style={{ padding: 40, textAlign: "center" }}>{"\u2728"} All caught up! No pending approvals.</p>
                        ) : (
                            <div className="merch-approval-list-scroll">
                                {stats.pending.map(order => {
                                    const item = order.items?.[0] || {};
                                    const imgSrc = item.image_url || "/placeholder.png";
                                    return (
                                        <div key={order.id} className="merch-approval-card">
                                            <div className="merch-appr-header">
                                                <div className="merch-appr-info">
                                                    <div className="merch-appr-field"><span className="merch-appr-label">ORDER NO:</span><span className="merch-appr-value">{order.order_no || "\u2014"}</span></div>
                                                    <div className="merch-appr-field"><span className="merch-appr-label">PO NUMBER:</span><span className="merch-appr-value">{order.po_number || "\u2014"}</span></div>
                                                    <div className="merch-appr-field"><span className="merch-appr-label">DATE:</span><span className="merch-appr-value">{formatDate(order.created_at)}</span></div>
                                                </div>
                                                <div className="merch-appr-badges">
                                                    <div className="merch-order-status-badge merch-status-pending">Pending</div>
                                                    {order.b2b_order_type && (<div className={`merch-order-type-badge ${order.b2b_order_type === "Buyout" ? "merch-type-buyout" : "merch-type-consignment"}`}>{order.b2b_order_type}</div>)}
                                                </div>
                                            </div>
                                            <div className="merch-appr-content">
                                                <div className="merch-appr-thumb" onClick={() => handleViewOrder(order.id)}><img src={imgSrc} alt={item.product_name || "Product"} /></div>
                                                <div className="merch-appr-details">
                                                    <div className="merch-appr-row"><span className="merch-appr-dlabel">Product:</span><span className="merch-appr-dvalue">{item.product_name || "\u2014"}</span></div>
                                                    <div className="merch-appr-row"><span className="merch-appr-dlabel">Vendor:</span><span className="merch-appr-dvalue">{vendorMap[order.vendor_id]?.store_brand_name || "\u2014"}</span></div>
                                                    <div className="merch-appr-row"><span className="merch-appr-dlabel">Merchandiser:</span><span className="merch-appr-dvalue">{order.merchandiser_name || "\u2014"}</span></div>
                                                    <div className="merch-appr-grid">
                                                        <div className="merch-appr-gitem"><span className="merch-appr-dlabel">Amount:</span><span className="merch-appr-dvalue">{`\u20B9${formatIndianNumber(order.grand_total || 0)}`}</span></div>
                                                        <div className="merch-appr-gitem"><span className="merch-appr-dlabel">Qty:</span><span className="merch-appr-dvalue">{order.total_quantity || 1}</span></div>
                                                        <div className="merch-appr-gitem"><span className="merch-appr-dlabel">Markdown:</span><span className="merch-appr-dvalue">{order.markdown_percent || 0}%</span></div>
                                                        <div className="merch-appr-gitem"><span className="merch-appr-dlabel">Delivery:</span><span className="merch-appr-dvalue">{formatDate(order.delivery_date) || "\u2014"}</span></div>
                                                    </div>
                                                    {order.comments && (<div className="merch-appr-notes"><span className="merch-appr-dlabel">Notes:</span><span className="merch-appr-dvalue">{order.comments}</span></div>)}
                                                </div>
                                            </div>
                                            <div className="merch-appr-actions">
                                                <button className="merch-btn-approve" onClick={() => setApprovalModal({ order, action: "approve" })}>{"\u2713"} Approve</button>
                                                <button className="merch-btn-reject" onClick={() => setApprovalModal({ order, action: "reject" })}>{"\u2715"} Reject</button>
                                                <button className="merch-btn-detail" onClick={() => handleViewOrder(order.id)}>View Full Details</button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* ===== ALL ORDERS TAB ===== */}
                {activeTab === "orders" && (
                    <div className="merch-tab-wrapper">
                        <h2 className="merch-tab-title">All Orders</h2>
                        <div className="merch-filters-row">
                            <input type="text" placeholder="Search order #, PO, vendor, merchandiser..." value={orderSearch} onChange={(e) => { setOrderSearch(e.target.value); setCurrentPage(1); }} className="merch-search-input" />
                            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }} className="merch-filter-select"><option value="all">All Status</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select>
                            <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setCurrentPage(1); }} className="merch-filter-select"><option value="all">All Types</option><option value="buyout">Buyout</option><option value="consignment">Consignment</option></select>
                        </div>
                        <div className="merch-order-list-scroll">
                            {filteredOrders.length === 0 && <p className="merch-muted">No orders match your filters.</p>}
                            {paginatedOrders.map(order => {
                                const item = order.items?.[0] || {};
                                const imgSrc = item.image_url || "/placeholder.png";
                                return (
                                    <div key={order.id} className="merch-order-card-full" onClick={() => handleViewOrder(order.id)} style={{ cursor: "pointer" }}>
                                        <div className="merch-ocard-header">
                                            <div className="merch-ocard-info">
                                                <div className="merch-ocard-field"><span className="merch-ocard-label">ORDER NO:</span><span className="merch-ocard-val">{order.order_no || "\u2014"}</span></div>
                                                <div className="merch-ocard-field"><span className="merch-ocard-label">PO NUMBER:</span><span className="merch-ocard-val">{order.po_number || "\u2014"}</span></div>
                                                <div className="merch-ocard-field"><span className="merch-ocard-label">DATE:</span><span className="merch-ocard-val">{formatDate(order.created_at)}</span></div>
                                            </div>
                                            <div className="merch-ocard-badges">
                                                <div className={`merch-order-status-badge ${getStatusBadgeClass(order.approval_status)}`}>{order.approval_status || "Pending"}</div>
                                                {order.b2b_order_type && (<div className={`merch-order-type-badge ${order.b2b_order_type === "Buyout" ? "merch-type-buyout" : "merch-type-consignment"}`}>{order.b2b_order_type}</div>)}
                                            </div>
                                        </div>
                                        <div className="merch-ocard-content">
                                            <div className="merch-ocard-thumb"><img src={imgSrc} alt={item.product_name || "Product"} /></div>
                                            <div className="merch-ocard-details">
                                                <div className="merch-ocard-row"><span className="merch-ocard-dlabel">Product:</span><span className="merch-ocard-dval">{item.product_name || "\u2014"}</span></div>
                                                <div className="merch-ocard-row"><span className="merch-ocard-dlabel">Vendor:</span><span className="merch-ocard-dval">{vendorMap[order.vendor_id]?.store_brand_name || "\u2014"}</span></div>
                                                <div className="merch-ocard-row"><span className="merch-ocard-dlabel">Merchandiser:</span><span className="merch-ocard-dval">{order.merchandiser_name || "\u2014"}</span></div>
                                                <div className="merch-ocard-grid">
                                                    <div className="merch-ocard-gitem"><span className="merch-ocard-dlabel">Amount:</span><span className="merch-ocard-dval">{`\u20B9${formatIndianNumber(order.grand_total || 0)}`}</span></div>
                                                    <div className="merch-ocard-gitem"><span className="merch-ocard-dlabel">Qty:</span><span className="merch-ocard-dval">{order.total_quantity || 1}</span></div>
                                                    <div className="merch-ocard-gitem"><span className="merch-ocard-dlabel">Markdown:</span><span className="merch-ocard-dval">{order.markdown_percent || 0}%</span></div>
                                                </div>
                                            </div>
                                        </div>
                                        {order.approval_status === "pending" && (
                                            <div className="merch-ocard-actions" onClick={(e) => e.stopPropagation()}>
                                                <button className="merch-btn-approve" onClick={() => setApprovalModal({ order, action: "approve" })}>{"\u2713"} Approve</button>
                                                <button className="merch-btn-reject" onClick={() => setApprovalModal({ order, action: "reject" })}>{"\u2715"} Reject</button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {filteredOrders.length > ORDERS_PER_PAGE && (
                                <div className="merch-pagination">
                                    <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="merch-pagination-btn">{"\u2190"} Previous</button>
                                    <span className="merch-pagination-info">Page {currentPage} of {Math.ceil(filteredOrders.length / ORDERS_PER_PAGE)}</span>
                                    <button disabled={currentPage >= Math.ceil(filteredOrders.length / ORDERS_PER_PAGE)} onClick={() => setCurrentPage(p => p + 1)} className="merch-pagination-btn">Next {"\u2192"}</button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ===== VENDOR BOOK TAB ===== */}
                {activeTab === "vendors" && (
                    <div className="merch-tab-wrapper">
                        <h2 className="merch-tab-title">Vendor Book</h2>
                        <div className="merch-vendor-search-bar"><input type="text" placeholder="Search vendors by name, code, or location..." value={vendorSearch} onChange={(e) => { setVendorSearch(e.target.value); setVendorPage(1); }} /></div>
                        <div className="merch-order-list-scroll">
                            {filteredVendors.length === 0 ? (<p className="merch-muted">No vendors found</p>) : (
                                paginatedVendors.map(vendor => {
                                    const creditUsed = vendor.current_credit_used || 0;
                                    const creditLimit = vendor.credit_limit || 0;
                                    const available = creditLimit - creditUsed;
                                    const pct = creditLimit > 0 ? (creditUsed / creditLimit) * 100 : 0;
                                    return (
                                        <div key={vendor.id} className="merch-vendor-card-full" onClick={() => handleViewVendorOrders(vendor.id)} style={{ cursor: "pointer" }}>
                                            {/* Header - like order card */}
                                            <div className="merch-ocard-header">
                                                <div className="merch-ocard-info">
                                                    <div className="merch-ocard-field"><span className="merch-ocard-label">VENDOR NAME:</span><span className="merch-ocard-val">{vendor.store_brand_name || "\u2014"}</span></div>
                                                    <div className="merch-ocard-field"><span className="merch-ocard-label">VENDOR CODE:</span><span className="merch-ocard-val">{vendor.vendor_code || "\u2014"}</span></div>
                                                    <div className="merch-ocard-field"><span className="merch-ocard-label">LOCATION:</span><span className="merch-ocard-val">{vendor.location || "\u2014"}</span></div>
                                                </div>
                                                <div className="merch-ocard-badges">
                                                    <div className={`merch-vc-pct-badge ${pct > 80 ? "danger" : pct > 50 ? "warn" : "safe"}`}>{pct.toFixed(0)}% Credit Used</div>
                                                </div>
                                            </div>

                                            {/* Content - like order card */}
                                            <div className="merch-ocard-content">
                                                <div className="merch-vc-avatar-lg">{vendor.store_brand_name?.charAt(0) || "V"}</div>
                                                <div className="merch-ocard-details">
                                                    {vendor.gst_number && (
                                                        <div className="merch-ocard-row"><span className="merch-ocard-dlabel">GST Number:</span><span className="merch-ocard-dval">{vendor.gst_number}</span></div>
                                                    )}
                                                    <div className="merch-ocard-grid">
                                                        <div className="merch-ocard-gitem"><span className="merch-ocard-dlabel">Credit Limit:</span><span className="merch-ocard-dval">{`\u20B9${formatIndianNumber(creditLimit)}`}</span></div>
                                                        <div className="merch-ocard-gitem"><span className="merch-ocard-dlabel">Credit Used:</span><span className="merch-ocard-dval">{`\u20B9${formatIndianNumber(creditUsed)}`}</span></div>
                                                        <div className="merch-ocard-gitem"><span className="merch-ocard-dlabel">Available:</span><span className={`merch-ocard-dval ${available <= 0 ? "merch-red" : ""}`}>{`\u20B9${formatIndianNumber(available)}`}</span></div>
                                                    </div>
                                                    <div className="merch-vc-bar-row">
                                                        <div className="merch-vc-bar-full"><div className={`merch-vc-fill ${pct > 80 ? "danger" : pct > 50 ? "warn" : "safe"}`} style={{ width: `${Math.min(pct, 100)}%` }}></div></div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Footer action */}
                                            <div className="merch-vc-footer">
                                                <p className="merch-vc-action">View Orders {"\u2192"}</p>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                            {totalVendorPages > 1 && (
                                <div className="merch-pagination">
                                    <button disabled={vendorPage === 1} onClick={() => setVendorPage(p => p - 1)} className="merch-pagination-btn">{"\u2190"} Previous</button>
                                    <span className="merch-pagination-info">Page {vendorPage} of {totalVendorPages} ({filteredVendors.length} vendors)</span>
                                    <button disabled={vendorPage >= totalVendorPages} onClick={() => setVendorPage(p => p + 1)} className="merch-pagination-btn">Next {"\u2192"}</button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ===== CONSIGNMENT TAB ===== */}
                {activeTab === "consignment" && (
                    <div className="merch-tab-wrapper">
                        <h2 className="merch-tab-title">Consignment Orders</h2>
                        <div className="merch-consignment-stats">
                            <div className="merch-cstat"><span className="merch-cstat-val">{orders.filter(o => o.b2b_order_type === "Consignment").length}</span><span className="merch-cstat-label">Total</span></div>
                            <div className="merch-cstat"><span className="merch-cstat-val">{`\u20B9${formatIndianNumber(orders.filter(o => o.b2b_order_type === "Consignment").reduce((s, o) => s + Number(o.grand_total || 0), 0))}`}</span><span className="merch-cstat-label">Value</span></div>
                            <div className="merch-cstat"><span className="merch-cstat-val">{orders.filter(o => o.b2b_order_type === "Consignment" && o.approval_status === "pending").length}</span><span className="merch-cstat-label">Pending</span></div>
                            <div className="merch-cstat"><span className="merch-cstat-val">{orders.filter(o => o.b2b_order_type === "Consignment" && o.approval_status === "approved").length}</span><span className="merch-cstat-label">Approved</span></div>
                        </div>
                        <div className="merch-order-list-scroll">
                            {orders.filter(o => o.b2b_order_type === "Consignment").length === 0 ? (
                                <p className="merch-muted" style={{ textAlign: "center", padding: 40 }}>No consignment orders yet</p>
                            ) : (
                                orders.filter(o => o.b2b_order_type === "Consignment").map(order => (
                                    <div key={order.id} className="merch-order-item" onClick={() => handleViewOrder(order.id)} style={{ cursor: "pointer" }}>
                                        <p><b>Order No:</b> {order.order_no} &nbsp;|&nbsp; <b>PO:</b> {order.po_number || "\u2014"}</p>
                                        <p><b>Vendor:</b> {vendorMap[order.vendor_id]?.store_brand_name || "\u2014"} &nbsp;|&nbsp; <b>Status:</b> <span className={getStatusBadgeClass(order.approval_status)}>{order.approval_status || "Pending"}</span></p>
                                        <p><b>Total:</b> {`\u20B9${formatIndianNumber(order.grand_total || 0)}`} &nbsp;|&nbsp; <b>Qty:</b> {order.total_quantity || 0} &nbsp;|&nbsp; <b>Date:</b> {formatDate(order.created_at)}</p>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* ===== PROFILE TAB ===== */}
                {activeTab === "profile" && (
                    <div className="merch-tab-wrapper merch-profile-wrap">
                        <h2 className="merch-profile-title">My Profile</h2>
                        <div className="merch-profile-card">
                            <div className="merch-profile-row"><span className="merch-plabel">Name</span><span className="merch-pvalue">{profile?.saleperson || "User"}</span></div>
                            <div className="merch-profile-row"><span className="merch-plabel">Email</span><span className="merch-pvalue">{user?.email}</span></div>
                            <div className="merch-profile-row"><span className="merch-plabel">Role</span><span className="merch-pvalue">B2B Merchandiser</span></div>
                            <div className="merch-profile-row"><span className="merch-plabel">Store</span><span className="merch-pvalue">{profile?.store_name || "N/A"}</span></div>
                        </div>
                    </div>
                )}
            </div>

            {/* ===== APPROVAL MODAL ===== */}
            {approvalModal && (
                <div className="merch-modal-overlay" onClick={() => { setApprovalModal(null); setApprovalReason(""); }}>
                    <div className="merch-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="merch-modal-top">
                            <h3>{approvalModal.action === "approve" ? "\u2705 Approve Order" : "\u274C Reject Order"}</h3>
                            <button className="merch-modal-close" onClick={() => { setApprovalModal(null); setApprovalReason(""); }}>{"\u00D7"}</button>
                        </div>
                        <div className="merch-modal-body">
                            <div className="merch-modal-info">
                                <p><b>Order:</b> {approvalModal.order.order_no}</p>
                                <p><b>PO:</b> {approvalModal.order.po_number || "N/A"}</p>
                                <p><b>Type:</b> {approvalModal.order.b2b_order_type || "N/A"}</p>
                                <p><b>Total:</b> <span className="merch-gold-text">{`\u20B9${formatIndianNumber(approvalModal.order.grand_total || 0)}`}</span></p>
                            </div>
                            <div className="merch-modal-field">
                                <label>{approvalModal.action === "approve" ? "Notes (Optional)" : "Reason for Rejection *"}</label>
                                <textarea placeholder={approvalModal.action === "approve" ? "Any notes..." : "Please provide a reason..."} value={approvalReason} onChange={(e) => setApprovalReason(e.target.value)} rows={4} />
                            </div>
                        </div>
                        <div className="merch-modal-footer">
                            <button className="merch-modal-cancel" onClick={() => { setApprovalModal(null); setApprovalReason(""); }}>Cancel</button>
                            <button className={`merch-modal-confirm ${approvalModal.action}`} onClick={handleApprovalAction} disabled={approvalProcessing || (approvalModal.action === "reject" && !approvalReason.trim())}>{approvalProcessing ? "Processing..." : approvalModal.action === "approve" ? "Confirm Approve" : "Confirm Reject"}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function StatCard({ title, value, change, highlight }) {
    return (
        <div className={`merch-stat-card-inner ${highlight ? "merch-stat-highlight" : ""}`}>
            <p className="merch-stat-title">{title}</p>
            <div className="merch-stat-content">
                <span className="merch-stat-value">{value}</span>
                <span className="merch-stat-change">{change}</span>
            </div>
        </div>
    );
}