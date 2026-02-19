import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./B2bProductionDashboard.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";

export default function B2bProductionDashboard() {
    const navigate = useNavigate();

    const [activeTab, setActiveTab] = useState("dashboard");
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [orders, setOrders] = useState([]);
    const [vendorMap, setVendorMap] = useState({});
    const [loading, setLoading] = useState(true);
    const [showSidebar, setShowSidebar] = useState(false);

    // Status update modal
    const [statusModal, setStatusModal] = useState(null);
    const [statusNote, setStatusNote] = useState("");
    const [statusProcessing, setStatusProcessing] = useState(false);

    // Calendar
    const [calendarDate, setCalendarDate] = useState(() => new Date());
    const [selectedCalendarDate, setSelectedCalendarDate] = useState(null);

    // All Orders tab
    const [orderSearch, setOrderSearch] = useState("");
    const [prodFilter, setProdFilter] = useState("all");
    const [currentPage, setCurrentPage] = useState(1);
    const ORDERS_PER_PAGE = 20;

    // Queue tab
    const [queueSearch, setQueueSearch] = useState("");
    const [queueType, setQueueType] = useState("all");
    const [queuePage, setQueuePage] = useState(1);

    // In Production tab
    const [inprodSearch, setInprodSearch] = useState("");
    const [inprodType, setInprodType] = useState("all");
    const [inprodPage, setInprodPage] = useState(1);

    // Dispatch tab
    const [dispatchSearch, setDispatchSearch] = useState("");
    const [dispatchType, setDispatchType] = useState("all");
    const [dispatchSection, setDispatchSection] = useState("ready");
    const [dispatchPage, setDispatchPage] = useState(1);

    // All Orders type filter
    const [allTypeFilter, setAllTypeFilter] = useState("all");

    // ==================== FETCH DATA ====================
    const loadAllData = useCallback(async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { setLoading(false); return; }
            setUser(user);

            const [profileResult, ordersResult] = await Promise.all([
                supabase.from("profiles").select("*").eq("id", user.id).single(),
                supabase.from("orders").select("*").eq("is_b2b", true).order("created_at", { ascending: false })
            ]);

            if (profileResult.data) setProfile(profileResult.data);
            if (ordersResult.data) {
                // Production head only sees approved orders
                const approvedOrders = ordersResult.data.filter(o => o.approval_status === "approved");
                setOrders(approvedOrders);
                const vendorIds = [...new Set(approvedOrders.map(o => o.vendor_id).filter(Boolean))];
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
            setLoading(false);
        } catch (err) {
            console.error("Load error:", err);
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadAllData(); }, [loadAllData]);

    // ==================== PRODUCTION STATUS HELPERS ====================
    const getProdStatus = (order) => order.production_status || "pending_production";

    const pendingProduction = useMemo(() => orders.filter(o => getProdStatus(o) === "pending_production"), [orders]);
    const inProduction = useMemo(() => orders.filter(o => getProdStatus(o) === "in_production"), [orders]);
    const readyForDispatch = useMemo(() => orders.filter(o => getProdStatus(o) === "ready_for_dispatch"), [orders]);
    const dispatched = useMemo(() => orders.filter(o => getProdStatus(o) === "dispatched"), [orders]);

    const stats = useMemo(() => ({
        total: orders.length,
        pending: pendingProduction.length,
        inProd: inProduction.length,
        ready: readyForDispatch.length,
        dispatched: dispatched.length,
        totalValue: orders.reduce((s, o) => s + Number(o.grand_total || 0), 0),
    }), [orders, pendingProduction, inProduction, readyForDispatch, dispatched]);

    // Calendar orders by delivery date
    const ordersByDate = useMemo(() => {
        return orders.reduce((acc, order) => {
            const date = order.delivery_date ? formatDate(order.delivery_date) : null;
            if (date) acc[date] = (acc[date] || 0) + 1;
            return acc;
        }, {});
    }, [orders]);

    // ==================== FILTERED ORDERS ====================
    const filteredOrders = useMemo(() => {
        let filtered = [...orders];
        if (prodFilter !== "all") filtered = filtered.filter(o => getProdStatus(o) === prodFilter);
        if (allTypeFilter !== "all") filtered = filtered.filter(o => o.b2b_order_type === allTypeFilter);
        if (orderSearch.trim()) {
            const q = orderSearch.toLowerCase();
            filtered = filtered.filter(o =>
                o.order_no?.toLowerCase().includes(q) || o.po_number?.toLowerCase().includes(q) ||
                vendorMap[o.vendor_id]?.store_brand_name?.toLowerCase().includes(q)
            );
        }
        return filtered;
    }, [orders, prodFilter, allTypeFilter, orderSearch, vendorMap]);

    const paginatedOrders = useMemo(() => {
        const start = (currentPage - 1) * ORDERS_PER_PAGE;
        return filteredOrders.slice(start, start + ORDERS_PER_PAGE);
    }, [filteredOrders, currentPage]);

    // Helper to filter by search + type
    const applyFilters = (list, search, type) => {
        let result = [...list];
        if (type !== "all") result = result.filter(o => o.b2b_order_type === type);
        if (search.trim()) {
            const q = search.toLowerCase();
            result = result.filter(o =>
                o.order_no?.toLowerCase().includes(q) || o.po_number?.toLowerCase().includes(q) ||
                vendorMap[o.vendor_id]?.store_brand_name?.toLowerCase().includes(q)
            );
        }
        return result;
    };

    // Queue filtered + paginated
    const filteredQueue = useMemo(() => applyFilters(pendingProduction, queueSearch, queueType), [pendingProduction, queueSearch, queueType, vendorMap]);
    const paginatedQueue = useMemo(() => filteredQueue.slice((queuePage - 1) * ORDERS_PER_PAGE, queuePage * ORDERS_PER_PAGE), [filteredQueue, queuePage]);

    // In Production filtered + paginated
    const filteredInprod = useMemo(() => applyFilters(inProduction, inprodSearch, inprodType), [inProduction, inprodSearch, inprodType, vendorMap]);
    const paginatedInprod = useMemo(() => filteredInprod.slice((inprodPage - 1) * ORDERS_PER_PAGE, inprodPage * ORDERS_PER_PAGE), [filteredInprod, inprodPage]);

    // Dispatch filtered + paginated
    const filteredReady = useMemo(() => applyFilters(readyForDispatch, dispatchSearch, dispatchType), [readyForDispatch, dispatchSearch, dispatchType, vendorMap]);
    const filteredDispatched = useMemo(() => applyFilters(dispatched, dispatchSearch, dispatchType), [dispatched, dispatchSearch, dispatchType, vendorMap]);
    const dispatchList = useMemo(() => dispatchSection === "ready" ? filteredReady : filteredDispatched, [dispatchSection, filteredReady, filteredDispatched]);
    const paginatedDispatch = useMemo(() => dispatchList.slice((dispatchPage - 1) * ORDERS_PER_PAGE, dispatchPage * ORDERS_PER_PAGE), [dispatchList, dispatchPage]);

    // ==================== STATUS UPDATE ====================
    const handleStatusUpdate = async () => {
        if (!statusModal) return;
        setStatusProcessing(true);
        try {
            const { order, newStatus } = statusModal;
            const { error } = await supabase.from("orders").update({
                production_status: newStatus,
                [`${newStatus}_at`]: new Date().toISOString(),
                [`${newStatus}_by`]: user?.email || "unknown",
                production_notes: statusNote.trim() || null,
            }).eq("id", order.id);

            if (error) throw error;
            setStatusModal(null);
            setStatusNote("");
            loadAllData();
        } catch (err) {
            console.error("Status update error:", err);
            alert("Failed to update. Please try again.");
        } finally { setStatusProcessing(false); }
    };

    // ==================== HELPERS ====================
    const handleLogout = async () => { await supabase.auth.signOut(); navigate("/login"); };
    const handleViewOrder = (orderId) => navigate(`/b2b-order-view/${orderId}`);

    const getProdStatusLabel = (status) => {
        switch (status) {
            case "in_production": return "In Production";
            case "ready_for_dispatch": return "Ready for Dispatch";
            case "dispatched": return "Dispatched";
            default: return "Pending Production";
        }
    };

    const getProdStatusClass = (status) => {
        switch (status) {
            case "in_production": return "prod-status-inprod";
            case "ready_for_dispatch": return "prod-status-ready";
            case "dispatched": return "prod-status-dispatched";
            default: return "prod-status-pending";
        }
    };

    const getNextAction = (status) => {
        switch (status) {
            case "pending_production": return { label: "Accept for Production", newStatus: "in_production" };
            case "in_production": return { label: "Mark Ready for Dispatch", newStatus: "ready_for_dispatch" };
            case "ready_for_dispatch": return { label: "Mark as Dispatched", newStatus: "dispatched" };
            default: return null;
        }
    };

    if (loading) return <p className="loading-text">Loading Dashboard...</p>;

    const MIN_CALENDAR_DATE = new Date(2025, 11, 1);

    return (
        <div className="prod-dashboard-wrapper">
            {/* ===== HEADER ===== */}
            <header className="prod-header">
                <img src={Logo} alt="logo" className="prod-header-logo" onClick={() => setActiveTab("dashboard")} />
                <div className="prod-header-right">
                    <button className="prod-header-btn" onClick={handleLogout}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /></svg>
                    </button>
                    <div className="prod-hamburger-icon" onClick={() => setShowSidebar(!showSidebar)}>
                        <div className="prod-bar"></div><div className="prod-bar"></div><div className="prod-bar"></div>
                    </div>
                </div>
            </header>

            {/* ===== GRID LAYOUT ===== */}
            <div className={`prod-grid-table ${showSidebar ? "prod-sidebar-open" : ""}`}>

                {/* ===== SIDEBAR ===== */}
                <aside className={`prod-sidebar ${showSidebar ? "prod-open" : ""}`}>
                    <nav className="prod-menu">
                        <a className={`prod-menu-item ${activeTab === "profile" ? "active" : ""}`} onClick={() => { setActiveTab("profile"); setShowSidebar(false); }}>View Profile</a>
                        <a className={`prod-menu-item ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => { setActiveTab("dashboard"); setShowSidebar(false); }}>Dashboard</a>
                        <a className={`prod-menu-item ${activeTab === "queue" ? "active" : ""}`} onClick={() => { setActiveTab("queue"); setShowSidebar(false); }}>
                            Production Queue {stats.pending > 0 && <span className="prod-badge-count">{stats.pending}</span>}
                        </a>
                        <a className={`prod-menu-item ${activeTab === "inprod" ? "active" : ""}`} onClick={() => { setActiveTab("inprod"); setShowSidebar(false); }}>In Production</a>
                        <a className={`prod-menu-item ${activeTab === "dispatch" ? "active" : ""}`} onClick={() => { setActiveTab("dispatch"); setShowSidebar(false); }}>Dispatch</a>
                        <a className={`prod-menu-item ${activeTab === "orders" ? "active" : ""}`} onClick={() => { setActiveTab("orders"); setShowSidebar(false); }}>All Orders</a>
                        <a className={`prod-menu-item ${activeTab === "calendar" ? "active" : ""}`} onClick={() => { setActiveTab("calendar"); setShowSidebar(false); }}>Calendar</a>
                        <a className="prod-menu-item-logout" onClick={handleLogout}>Log Out</a>
                    </nav>
                </aside>

                {/* ===== DASHBOARD TAB ===== */}
                {activeTab === "dashboard" && (
                    <>
                        <div className="prod-cell prod-stat-1">
                            <StatCard title="Pending Production" value={stats.pending} change={`Total: ${stats.total}`} highlight={stats.pending > 0} />
                        </div>
                        <div className="prod-cell prod-stat-2">
                            <StatCard title="In Production" value={stats.inProd} change={`Ready: ${stats.ready}`} />
                        </div>
                        <div className="prod-cell prod-stat-3">
                            <StatCard title="Dispatched" value={stats.dispatched} change={`\u20B9${formatIndianNumber(stats.totalValue)}`} />
                        </div>

                        {/* Quick Actions */}
                        <div className="prod-cell prod-quick-actions">
                            <div className="prod-sales-card">
                                <div className="prod-sales-header"><p className="prod-sales-label">Quick Actions</p></div>
                                <div className="prod-quick-btns">
                                    <button className={`prod-quick-btn ${stats.pending > 0 ? "primary" : ""}`} onClick={() => setActiveTab("queue")}>Production Queue ({stats.pending})</button>
                                    <button className="prod-quick-btn" onClick={() => setActiveTab("inprod")}>In Production ({stats.inProd})</button>
                                    <button className="prod-quick-btn" onClick={() => setActiveTab("dispatch")}>Dispatch ({stats.ready})</button>
                                    <button className="prod-quick-btn" onClick={() => setActiveTab("calendar")}>Calendar</button>
                                </div>
                            </div>
                        </div>

                        {/* Pending Production Preview */}
                        <aside className="prod-cell prod-pending-box">
                            <div className="prod-pending-header">
                                <span className="prod-pending-title">Pending Production</span>
                                <button className="prod-view-btn" onClick={() => setActiveTab("queue")}>View All</button>
                            </div>
                            <div className="prod-pending-body">
                                {pendingProduction.length === 0 ? (
                                    <p className="prod-muted">{"\u2728"} No pending orders!</p>
                                ) : (
                                    pendingProduction.slice(0, 8).map(order => (
                                        <div key={order.id} className="prod-pending-item">
                                            <div className="prod-pending-top">
                                                <b className="prod-gold-text">{order.order_no}</b>
                                                <span className={`prod-type-tag ${order.b2b_order_type === "Buyout" ? "prod-tag-buyout" : "prod-tag-consignment"}`}>{order.b2b_order_type || "\u2014"}</span>
                                            </div>
                                            <p style={{ fontSize: 12, color: "#777", margin: "2px 0" }}>{vendorMap[order.vendor_id]?.store_brand_name || "\u2014"} {"\u00B7"} {`\u20B9${formatIndianNumber(order.grand_total || 0)}`}</p>
                                            <div className="prod-pending-btns">
                                                <button className="prod-accept-sm" onClick={() => setStatusModal({ order, newStatus: "in_production" })}>{"\u2713"} Accept</button>
                                                <button className="prod-detail-sm" onClick={() => handleViewOrder(order.id)}>View</button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </aside>

                        {/* Recent Orders */}
                        <div className="prod-cell prod-recent-orders">
                            <div className="prod-orders-card">
                                <div className="prod-card-header">
                                    <span className="prod-card-title">Recent Orders ({orders.slice(0, 10).length})</span>
                                    <button className="prod-view-btn" onClick={() => setActiveTab("orders")}>View All</button>
                                </div>
                                <div className="prod-cardbox">
                                    {orders.length === 0 ? (<p className="prod-muted">No approved orders yet</p>) : (
                                        orders.slice(0, 10).map(o => {
                                            const ps = getProdStatus(o);
                                            return (
                                                <div className="prod-order-item" key={o.id} onClick={() => handleViewOrder(o.id)} style={{ cursor: "pointer" }}>
                                                    <p><b>Order No:</b> {o.order_no} &nbsp;|&nbsp; <b>PO:</b> {o.po_number || "\u2014"}</p>
                                                    <p><b>Vendor:</b> {vendorMap[o.vendor_id]?.store_brand_name || "\u2014"} &nbsp;|&nbsp; <b>Type:</b> {o.b2b_order_type || "\u2014"}</p>
                                                    <p><b>Status:</b> <span className={getProdStatusClass(ps)}>{getProdStatusLabel(ps)}</span> &nbsp;|&nbsp; <b>Total:</b> {`\u20B9${formatIndianNumber(o.grand_total || 0)}`}</p>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {/* ===== PRODUCTION QUEUE TAB ===== */}
                {activeTab === "queue" && (
                    <div className="prod-tab-wrapper">
                        <h2 className="prod-tab-title">Production Queue ({pendingProduction.length})</h2>
                        <div className="prod-filters-row">
                            <input type="text" placeholder="Search order #, PO, vendor..." value={queueSearch} onChange={(e) => { setQueueSearch(e.target.value); setQueuePage(1); }} className="prod-search-input" />
                            <select value={queueType} onChange={(e) => { setQueueType(e.target.value); setQueuePage(1); }} className="prod-filter-select">
                                <option value="all">All Types</option>
                                <option value="Buyout">Buyout</option>
                                <option value="Consignment">Consignment</option>
                            </select>
                        </div>
                        {filteredQueue.length === 0 ? (
                            <p className="prod-muted" style={{ padding: 40, textAlign: "center" }}>{"\u2728"} No orders pending production!</p>
                        ) : (
                            <div className="prod-list-scroll">
                                {paginatedQueue.map(order => <OrderCard key={order.id} order={order} vendorMap={vendorMap} onView={handleViewOrder} onAction={() => setStatusModal({ order, newStatus: "in_production" })} actionLabel={"\u2713 Accept for Production"} actionClass="prod-btn-accept" getProdStatusClass={getProdStatusClass} getProdStatusLabel={getProdStatusLabel} getProdStatus={getProdStatus} />)}
                                {filteredQueue.length > ORDERS_PER_PAGE && (
                                    <div className="prod-pagination">
                                        <button disabled={queuePage === 1} onClick={() => setQueuePage(p => p - 1)} className="prod-pagination-btn">{"\u2190"} Previous</button>
                                        <span className="prod-pagination-info">Page {queuePage} of {Math.ceil(filteredQueue.length / ORDERS_PER_PAGE)}</span>
                                        <button disabled={queuePage >= Math.ceil(filteredQueue.length / ORDERS_PER_PAGE)} onClick={() => setQueuePage(p => p + 1)} className="prod-pagination-btn">Next {"\u2192"}</button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ===== IN PRODUCTION TAB ===== */}
                {activeTab === "inprod" && (
                    <div className="prod-tab-wrapper">
                        <h2 className="prod-tab-title">In Production ({inProduction.length})</h2>
                        <div className="prod-filters-row">
                            <input type="text" placeholder="Search order #, PO, vendor..." value={inprodSearch} onChange={(e) => { setInprodSearch(e.target.value); setInprodPage(1); }} className="prod-search-input" />
                            <select value={inprodType} onChange={(e) => { setInprodType(e.target.value); setInprodPage(1); }} className="prod-filter-select">
                                <option value="all">All Types</option>
                                <option value="Buyout">Buyout</option>
                                <option value="Consignment">Consignment</option>
                            </select>
                        </div>
                        {filteredInprod.length === 0 ? (
                            <p className="prod-muted" style={{ padding: 40, textAlign: "center" }}>No orders in production</p>
                        ) : (
                            <div className="prod-list-scroll">
                                {paginatedInprod.map(order => <OrderCard key={order.id} order={order} vendorMap={vendorMap} onView={handleViewOrder} onAction={() => setStatusModal({ order, newStatus: "ready_for_dispatch" })} actionLabel="Mark Ready for Dispatch" actionClass="prod-btn-ready" getProdStatusClass={getProdStatusClass} getProdStatusLabel={getProdStatusLabel} getProdStatus={getProdStatus} />)}
                                {filteredInprod.length > ORDERS_PER_PAGE && (
                                    <div className="prod-pagination">
                                        <button disabled={inprodPage === 1} onClick={() => setInprodPage(p => p - 1)} className="prod-pagination-btn">{"\u2190"} Previous</button>
                                        <span className="prod-pagination-info">Page {inprodPage} of {Math.ceil(filteredInprod.length / ORDERS_PER_PAGE)}</span>
                                        <button disabled={inprodPage >= Math.ceil(filteredInprod.length / ORDERS_PER_PAGE)} onClick={() => setInprodPage(p => p + 1)} className="prod-pagination-btn">Next {"\u2192"}</button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ===== DISPATCH TAB ===== */}
                {activeTab === "dispatch" && (
                    <div className="prod-tab-wrapper">
                        <h2 className="prod-tab-title">Dispatch</h2>
                        <div className="prod-dispatch-stats">
                            <div className="prod-dstat"><span className="prod-dstat-val">{stats.ready}</span><span className="prod-dstat-label">Ready for Dispatch</span></div>
                            <div className="prod-dstat"><span className="prod-dstat-val">{stats.dispatched}</span><span className="prod-dstat-label">Dispatched</span></div>
                        </div>
                        <div className="prod-filters-row">
                            <input type="text" placeholder="Search order #, PO, vendor..." value={dispatchSearch} onChange={(e) => { setDispatchSearch(e.target.value); setDispatchPage(1); }} className="prod-search-input" />
                            <select value={dispatchType} onChange={(e) => { setDispatchType(e.target.value); setDispatchPage(1); }} className="prod-filter-select">
                                <option value="all">All Types</option>
                                <option value="Buyout">Buyout</option>
                                <option value="Consignment">Consignment</option>
                            </select>
                            <select value={dispatchSection} onChange={(e) => { setDispatchSection(e.target.value); setDispatchPage(1); }} className="prod-filter-select">
                                <option value="ready">Ready for Dispatch</option>
                                <option value="dispatched">Dispatched</option>
                            </select>
                        </div>
                        {dispatchList.length === 0 ? (
                            <p className="prod-muted" style={{ padding: 40, textAlign: "center" }}>No {dispatchSection === "ready" ? "orders ready for dispatch" : "dispatched orders"}</p>
                        ) : (
                            <div className="prod-list-scroll">
                                {paginatedDispatch.map(order => (
                                    <OrderCard key={order.id} order={order} vendorMap={vendorMap} onView={handleViewOrder}
                                        onAction={dispatchSection === "ready" ? () => setStatusModal({ order, newStatus: "dispatched" }) : null}
                                        actionLabel={dispatchSection === "ready" ? "Mark as Dispatched" : null}
                                        actionClass="prod-btn-dispatch" getProdStatusClass={getProdStatusClass} getProdStatusLabel={getProdStatusLabel} getProdStatus={getProdStatus} />
                                ))}
                                {dispatchList.length > ORDERS_PER_PAGE && (
                                    <div className="prod-pagination">
                                        <button disabled={dispatchPage === 1} onClick={() => setDispatchPage(p => p - 1)} className="prod-pagination-btn">{"\u2190"} Previous</button>
                                        <span className="prod-pagination-info">Page {dispatchPage} of {Math.ceil(dispatchList.length / ORDERS_PER_PAGE)}</span>
                                        <button disabled={dispatchPage >= Math.ceil(dispatchList.length / ORDERS_PER_PAGE)} onClick={() => setDispatchPage(p => p + 1)} className="prod-pagination-btn">Next {"\u2192"}</button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ===== ALL ORDERS TAB ===== */}
                {activeTab === "orders" && (
                    <div className="prod-tab-wrapper">
                        <h2 className="prod-tab-title">All Orders</h2>
                        <div className="prod-filters-row">
                            <input type="text" placeholder="Search order #, PO, vendor..." value={orderSearch} onChange={(e) => { setOrderSearch(e.target.value); setCurrentPage(1); }} className="prod-search-input" />
                            <select value={prodFilter} onChange={(e) => { setProdFilter(e.target.value); setCurrentPage(1); }} className="prod-filter-select">
                                <option value="all">All Status</option>
                                <option value="pending_production">Pending Production</option>
                                <option value="in_production">In Production</option>
                                <option value="ready_for_dispatch">Ready for Dispatch</option>
                                <option value="dispatched">Dispatched</option>
                            </select>
                            <select value={allTypeFilter} onChange={(e) => { setAllTypeFilter(e.target.value); setCurrentPage(1); }} className="prod-filter-select">
                                <option value="all">All Types</option>
                                <option value="Buyout">Buyout</option>
                                <option value="Consignment">Consignment</option>
                            </select>
                        </div>
                        <div className="prod-list-scroll">
                            {filteredOrders.length === 0 && <p className="prod-muted">No orders match your filters.</p>}
                            {paginatedOrders.map(order => {
                                const nextAction = getNextAction(getProdStatus(order));
                                return <OrderCard key={order.id} order={order} vendorMap={vendorMap} onView={handleViewOrder} onAction={nextAction ? () => setStatusModal({ order, newStatus: nextAction.newStatus }) : null} actionLabel={nextAction?.label || null} actionClass="prod-btn-accept" getProdStatusClass={getProdStatusClass} getProdStatusLabel={getProdStatusLabel} getProdStatus={getProdStatus} />;
                            })}
                            {filteredOrders.length > ORDERS_PER_PAGE && (
                                <div className="prod-pagination">
                                    <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="prod-pagination-btn">{"\u2190"} Previous</button>
                                    <span className="prod-pagination-info">Page {currentPage} of {Math.ceil(filteredOrders.length / ORDERS_PER_PAGE)}</span>
                                    <button disabled={currentPage >= Math.ceil(filteredOrders.length / ORDERS_PER_PAGE)} onClick={() => setCurrentPage(p => p + 1)} className="prod-pagination-btn">Next {"\u2192"}</button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ===== CALENDAR TAB ===== */}
                {activeTab === "calendar" && (
                    <div className="prod-calendar-wrapper">
                        <div className="prod-ios-calendar">
                            <div className="prod-ios-cal-header">
                                <button className="prod-ios-nav-btn" disabled={new Date(calendarDate).getFullYear() === MIN_CALENDAR_DATE.getFullYear() && new Date(calendarDate).getMonth() === MIN_CALENDAR_DATE.getMonth()} onClick={() => setCalendarDate(d => { const n = new Date(d); n.setMonth(n.getMonth() - 1); return n; })}>{"\u2039"}</button>
                                <span className="prod-ios-month-year">{new Date(calendarDate).toLocaleString("default", { month: "long", year: "numeric" })}</span>
                                <button className="prod-ios-nav-btn" onClick={() => setCalendarDate(d => { const n = new Date(d); n.setMonth(n.getMonth() + 1); return n; })}>{"\u203A"}</button>
                            </div>
                            <div className="prod-ios-days-row">
                                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (<div key={day} className="prod-ios-day-label">{day}</div>))}
                            </div>
                            <div className="prod-ios-date-grid">
                                {(() => {
                                    const year = new Date(calendarDate).getFullYear();
                                    const month = new Date(calendarDate).getMonth();
                                    const firstDay = new Date(year, month, 1).getDay();
                                    const daysInMonth = new Date(year, month + 1, 0).getDate();
                                    const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
                                    return Array.from({ length: totalCells }).map((_, i) => {
                                        const date = i - firstDay + 1;
                                        if (date <= 0 || date > daysInMonth) return <div key={i} className="prod-ios-date-cell prod-ios-empty" />;
                                        const currentDay = new Date(year, month, date);
                                        const fullDate = formatDate(currentDay);
                                        const todayDate = formatDate(new Date());
                                        const isToday = fullDate === todayDate;
                                        const isSelected = selectedCalendarDate === fullDate;
                                        const orderCount = ordersByDate[fullDate] || 0;
                                        return (
                                            <div key={i} className={`prod-ios-date-cell ${isToday ? "prod-ios-today" : ""} ${isSelected ? "prod-ios-selected" : ""}`} onClick={() => setSelectedCalendarDate(fullDate)}>
                                                <span className="prod-ios-date-num">{date}</span>
                                                {orderCount > 0 && <span className="prod-ios-order-count">{orderCount}</span>}
                                            </div>
                                        );
                                    });
                                })()}
                            </div>
                        </div>

                        {selectedCalendarDate && (
                            <div className="prod-calendar-orders-section">
                                <div className="prod-card-header">
                                    <span className="prod-card-title">Deliveries for {selectedCalendarDate} ({orders.filter(o => formatDate(o.delivery_date) === selectedCalendarDate).length})</span>
                                </div>
                                <div className="prod-calendar-orders-list">
                                    {orders.filter(o => formatDate(o.delivery_date) === selectedCalendarDate).length === 0 ? (
                                        <p className="prod-muted">No deliveries on this date</p>
                                    ) : (
                                        orders.filter(o => formatDate(o.delivery_date) === selectedCalendarDate).map(order => {
                                            const ps = getProdStatus(order);
                                            return (
                                                <div className="prod-order-item" key={order.id} onClick={() => handleViewOrder(order.id)} style={{ cursor: "pointer" }}>
                                                    <p><b>Order No:</b> {order.order_no} &nbsp;|&nbsp; <b>PO:</b> {order.po_number || "\u2014"}</p>
                                                    <p><b>Vendor:</b> {vendorMap[order.vendor_id]?.store_brand_name || "\u2014"}</p>
                                                    <p><b>Status:</b> <span className={getProdStatusClass(ps)}>{getProdStatusLabel(ps)}</span> &nbsp;|&nbsp; <b>Total:</b> {`\u20B9${formatIndianNumber(order.grand_total || 0)}`}</p>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ===== PROFILE TAB ===== */}
                {activeTab === "profile" && (
                    <div className="prod-tab-wrapper prod-profile-wrap">
                        <h2 className="prod-profile-title">My Profile</h2>
                        <div className="prod-profile-card">
                            <div className="prod-profile-row"><span className="prod-plabel">Name</span><span className="prod-pvalue">{profile?.full_name || "User"}</span></div>
                            <div className="prod-profile-row"><span className="prod-plabel">Email</span><span className="prod-pvalue">{user?.email}</span></div>
                            <div className="prod-profile-row"><span className="prod-plabel">Role</span><span className="prod-pvalue">B2B Production Head</span></div>
                            <div className="prod-profile-row"><span className="prod-plabel">Store</span><span className="prod-pvalue">{profile?.store_name || "N/A"}</span></div>
                        </div>
                    </div>
                )}
            </div>

            {/* ===== STATUS UPDATE MODAL ===== */}
            {statusModal && (
                <div className="prod-modal-overlay" onClick={() => { setStatusModal(null); setStatusNote(""); }}>
                    <div className="prod-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="prod-modal-top">
                            <h3>Update Production Status</h3>
                            <button className="prod-modal-close" onClick={() => { setStatusModal(null); setStatusNote(""); }}>{"\u00D7"}</button>
                        </div>
                        <div className="prod-modal-body">
                            <div className="prod-modal-info">
                                <p><b>Order:</b> {statusModal.order.order_no}</p>
                                <p><b>PO:</b> {statusModal.order.po_number || "N/A"}</p>
                                <p><b>Type:</b> {statusModal.order.b2b_order_type || "N/A"}</p>
                                <p><b>Total:</b> <span className="prod-gold-text">{`\u20B9${formatIndianNumber(statusModal.order.grand_total || 0)}`}</span></p>
                                <p><b>Vendor:</b> {vendorMap[statusModal.order.vendor_id]?.store_brand_name || "N/A"}</p>
                            </div>
                            <div className="prod-modal-status-change">
                                <span className={getProdStatusClass(getProdStatus(statusModal.order))}>{getProdStatusLabel(getProdStatus(statusModal.order))}</span>
                                <span className="prod-arrow">{"\u2192"}</span>
                                <span className={getProdStatusClass(statusModal.newStatus)}>{getProdStatusLabel(statusModal.newStatus)}</span>
                            </div>
                            <div className="prod-modal-field">
                                <label>Notes (Optional)</label>
                                <textarea placeholder="Any production notes..." value={statusNote} onChange={(e) => setStatusNote(e.target.value)} rows={3} />
                            </div>
                        </div>
                        <div className="prod-modal-footer">
                            <button className="prod-modal-cancel" onClick={() => { setStatusModal(null); setStatusNote(""); }}>Cancel</button>
                            <button className="prod-modal-confirm" onClick={handleStatusUpdate} disabled={statusProcessing}>{statusProcessing ? "Updating..." : "Confirm"}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ==================== ORDER CARD COMPONENT ====================
function OrderCard({ order, vendorMap, onView, onAction, actionLabel, actionClass, getProdStatusClass, getProdStatusLabel, getProdStatus }) {
    const item = order.items?.[0] || {};
    const imgSrc = item.image_url || "/placeholder.png";
    const ps = getProdStatus(order);

    return (
        <div className="prod-order-card-full" onClick={() => onView(order.id)} style={{ cursor: "pointer" }}>
            <div className="prod-ocard-header">
                <div className="prod-ocard-info">
                    <div className="prod-ocard-field"><span className="prod-ocard-label">ORDER NO:</span><span className="prod-ocard-val">{order.order_no || "\u2014"}</span></div>
                    <div className="prod-ocard-field"><span className="prod-ocard-label">PO NUMBER:</span><span className="prod-ocard-val">{order.po_number || "\u2014"}</span></div>
                    <div className="prod-ocard-field"><span className="prod-ocard-label">DELIVERY:</span><span className="prod-ocard-val">{formatDate(order.delivery_date) || "\u2014"}</span></div>
                </div>
                <div className="prod-ocard-badges">
                    <div className={`prod-order-status-badge ${getProdStatusClass(ps)}`}>{getProdStatusLabel(ps)}</div>
                    {order.b2b_order_type && (<div className={`prod-order-type-badge ${order.b2b_order_type === "Buyout" ? "prod-type-buyout" : "prod-type-consignment"}`}>{order.b2b_order_type}</div>)}
                </div>
            </div>
            <div className="prod-ocard-content">
                <div className="prod-ocard-thumb"><img src={imgSrc} alt={item.product_name || "Product"} /></div>
                <div className="prod-ocard-details">
                    <div className="prod-ocard-row"><span className="prod-ocard-dlabel">Product:</span><span className="prod-ocard-dval">{item.product_name || "\u2014"}</span></div>
                    <div className="prod-ocard-row"><span className="prod-ocard-dlabel">Vendor:</span><span className="prod-ocard-dval">{vendorMap[order.vendor_id]?.store_brand_name || "\u2014"}</span></div>
                    <div className="prod-ocard-grid">
                        <div className="prod-ocard-gitem"><span className="prod-ocard-dlabel">Amount:</span><span className="prod-ocard-dval">{`\u20B9${formatIndianNumber(order.grand_total || 0)}`}</span></div>
                        <div className="prod-ocard-gitem"><span className="prod-ocard-dlabel">Qty:</span><span className="prod-ocard-dval">{order.total_quantity || 1}</span></div>
                        <div className="prod-ocard-gitem"><span className="prod-ocard-dlabel">Delivery:</span><span className="prod-ocard-dval">{formatDate(order.delivery_date) || "\u2014"}</span></div>
                    </div>
                </div>
            </div>
            {onAction && actionLabel && (
                <div className="prod-ocard-actions" onClick={(e) => e.stopPropagation()}>
                    <button className={actionClass || "prod-btn-accept"} onClick={onAction}>{actionLabel}</button>
                    <button className="prod-btn-detail" onClick={() => onView(order.id)}>View Details</button>
                </div>
            )}
        </div>
    );
}

function StatCard({ title, value, change, highlight }) {
    return (
        <div className={`prod-stat-card-inner ${highlight ? "prod-stat-highlight" : ""}`}>
            <p className="prod-stat-title">{title}</p>
            <div className="prod-stat-content">
                <span className="prod-stat-value">{value}</span>
                <span className="prod-stat-change">{change}</span>
            </div>
        </div>
    );
}