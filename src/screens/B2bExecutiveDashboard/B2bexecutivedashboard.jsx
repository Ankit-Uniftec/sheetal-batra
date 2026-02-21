import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./B2bExecutiveDashboard.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";

export default function B2bExecutiveDashboard() {
    const navigate = useNavigate();

    const [activeTab, setActiveTab] = useState("dashboard");
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [orders, setOrders] = useState([]);
    const [vendors, setVendors] = useState({});
    const [loading, setLoading] = useState(true);
    const [showSidebar, setShowSidebar] = useState(false);

    // Calendar
    const [calendarDate, setCalendarDate] = useState(() => new Date());
    const [selectedCalendarDate, setSelectedCalendarDate] = useState(null);

    // Order History tab
    const [orderSearch, setOrderSearch] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const ORDERS_PER_PAGE = 20;

    // ==================== FETCH DATA ====================
    useEffect(() => {
        const loadAllData = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) {
                    navigate("/login", { replace: true });
                    return;
                }

                // ✅ Role check - only executive users allowed
                const { data: roleCheck } = await supabase
                    .from("salesperson")
                    .select("role")
                    .eq("email", user.email?.toLowerCase())
                    .single();

                if (!roleCheck || roleCheck.role !== "executive") {
                    console.log("❌ Access denied - not an executive");
                    await supabase.auth.signOut();
                    navigate("/login", { replace: true });
                    return;
                }

                setUser(user);

                const [profileResult, ordersResult] = await Promise.all([
                    supabase.from("salesperson").select("*").eq("email", user.email?.toLowerCase()).maybeSingle(),
                    supabase.from("orders").select("*").eq("is_b2b", true).order("created_at", { ascending: false })
                ]);

                if (profileResult.data) setProfile(profileResult.data);
                if (ordersResult.data) {
                    setOrders(ordersResult.data);
                    // Fetch vendor details
                    const vendorIds = [...new Set((ordersResult.data || []).map(o => o.vendor_id).filter(Boolean))];
                    if (vendorIds.length > 0) {
                        const { data: vendorsData } = await supabase
                            .from("vendors")
                            .select("id, store_brand_name, vendor_code, location")
                            .in("id", vendorIds);
                        const vendorMap = {};
                        (vendorsData || []).forEach(v => { vendorMap[v.id] = v; });
                        setVendors(vendorMap);
                    }
                }
                setLoading(false);
            } catch (err) {
                console.error("Load error:", err);
                setLoading(false);
            }
        };
        loadAllData();
    }, []);

    // ==================== STATS ====================
    const stats = useMemo(() => {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        const totalRevenue = orders.reduce((sum, o) => sum + Number(o.grand_total || 0), 0);
        const totalOrders = orders.length;
        const pendingOrders = orders.filter(o => o.approval_status === "pending");
        const thisMonthOrders = orders.filter(o => o.created_at >= monthStart);
        const todayOrders = orders.filter(o => formatDate(o.created_at) === formatDate(new Date()));

        return { totalRevenue, totalOrders, pendingOrders, thisMonthOrders, todayOrders };
    }, [orders]);

    const ordersByDate = useMemo(() => {
        return orders.reduce((acc, order) => {
            const date = order.delivery_date ? formatDate(order.delivery_date) : null;
            if (date) acc[date] = (acc[date] || 0) + 1;
            return acc;
        }, {});
    }, [orders]);

    // Filtered orders for Order History tab
    const filteredOrders = useMemo(() => {
        if (!orderSearch.trim()) return orders;
        const q = orderSearch.toLowerCase();
        return orders.filter((order) => {
            const orderNo = order.order_no?.toLowerCase() || "";
            const poNumber = order.po_number?.toLowerCase() || "";
            const vendorName = vendors[order.vendor_id]?.store_brand_name?.toLowerCase() || "";
            const itemName = order.items?.[0]?.product_name?.toLowerCase() || "";
            return orderNo.includes(q) || poNumber.includes(q) || vendorName.includes(q) || itemName.includes(q);
        });
    }, [orders, orderSearch, vendors]);

    const paginatedOrders = useMemo(() => {
        const startIndex = (currentPage - 1) * ORDERS_PER_PAGE;
        return filteredOrders.slice(startIndex, startIndex + ORDERS_PER_PAGE);
    }, [filteredOrders, currentPage]);

    // ==================== HANDLERS ====================
    const handleLogout = async () => {
        await supabase.auth.signOut();
        navigate("/login");
    };

    const handleNewOrder = () => navigate("/b2b-vendor-selection");
    const handleViewOrder = (orderId) => navigate(`/b2b-order-view/${orderId}`);

    const handleEditOrder = async (order) => {
        try {
            // Fetch full vendor data
            let vendorFull = null;
            if (order.vendor_id) {
                const { data } = await supabase.from("vendors").select("*").eq("id", order.vendor_id).single();
                vendorFull = data;
            }

            sessionStorage.setItem("b2bEditingOrderId", order.id);

            sessionStorage.setItem("b2bVendorData", JSON.stringify({
                selectedVendorId: order.vendor_id,
                vendor: vendorFull,
                vendorContacts: [],
                primaryContact: null,
                poNumber: order.po_number || "",
                merchandiser: order.merchandiser_name || "",
                orderType: order.b2b_order_type || "Buyout",
                discountPercent: order.markdown_percent || 0,
                remarks: order.comments || "",
                availableCredit: vendorFull ? (vendorFull.credit_limit || 0) - (vendorFull.current_credit_used || 0) : 0,
            }));

            sessionStorage.setItem("b2bProductFormData", JSON.stringify({
                orderItems: order.items || [],
                deliveryDate: order.delivery_date || "",
                modeOfDelivery: order.mode_of_delivery || "Delhi Store",
                orderFlag: order.order_flag || "Normal",
                comments: order.comments || "",
                attachments: order.attachments || [],
                urgentReason: order.urgent_reason || "",
                subtotal: order.subtotal || 0,
                taxes: order.taxes || 0,
                grandTotal: order.grand_total || 0,
                totalQuantity: order.total_quantity || 0,
            }));

            sessionStorage.setItem("b2bOrderDetailsData", JSON.stringify({
                deliveryAddress: order.delivery_address || "",
                orderNotes: order.delivery_notes || order.comments || "",
            }));

            navigate("/b2b-vendor-selection");
        } catch (err) {
            console.error("Error preparing edit:", err);
            alert("Failed to load order for editing.");
        }
    };


    const getStatusBadgeClass = (status) => {
        switch (status?.toLowerCase()) {
            case "approved": return "b2b-status-approved";
            case "rejected": return "b2b-status-rejected";
            default: return "b2b-status-pending";
        }
    };

    if (loading) return <p className="loading-text">Loading Dashboard...</p>;

    const MIN_CALENDAR_DATE = new Date(2025, 11, 1);

    return (
        <div className="b2b-dashboard-wrapper">
            {/* ===== HEADER ===== */}
            <header className="b2b-header">
                <img src={Logo} alt="logo" className="b2b-header-logo" onClick={handleLogout} />
                <div className="b2b-header-right">
                    <button className="b2b-header-btn" onClick={handleLogout}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /></svg>
                    </button>
                    <div className="b2b-hamburger-icon" onClick={() => setShowSidebar(!showSidebar)}>
                        <div className="b2b-bar"></div>
                        <div className="b2b-bar"></div>
                        <div className="b2b-bar"></div>
                    </div>
                </div>
            </header>

            {/* ===== GRID LAYOUT ===== */}
            <div className={`b2b-grid-table ${showSidebar ? "b2b-sidebar-open" : ""}`}>

                {/* ===== SIDEBAR ===== */}
                <aside className={`b2b-sidebar ${showSidebar ? "b2b-open" : ""}`}>
                    <nav className="b2b-menu">
                        <a className={`b2b-menu-item ${activeTab === "profile" ? "active" : ""}`} onClick={() => { setActiveTab("profile"); setShowSidebar(false); }}>View Profile</a>
                        <a className={`b2b-menu-item ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => { setActiveTab("dashboard"); setShowSidebar(false); }}>Dashboard</a>
                        <a className={`b2b-menu-item ${activeTab === "calendar" ? "active" : ""}`} onClick={() => { setActiveTab("calendar"); setShowSidebar(false); }}>Calendar</a>
                        <a className={`b2b-menu-item ${activeTab === "orders" ? "active" : ""}`} onClick={() => { setActiveTab("orders"); setShowSidebar(false); }}>Order History</a>
                        <a className="b2b-menu-item-logout" onClick={handleLogout}>Log Out</a>
                    </nav>
                </aside>

                {/* ===== DASHBOARD TAB ===== */}
                {activeTab === "dashboard" && (
                    <>
                        {/* Row 1: Stat Cards */}
                        <div className="b2b-cell b2b-total-revenue">
                            <StatCard title="Total Revenue" value={`₹${formatIndianNumber(stats.totalRevenue)}`} change={`This Month: ${stats.thisMonthOrders.length}`} />
                        </div>
                        <div className="b2b-cell b2b-total-orders">
                            <StatCard title="Total Orders" value={formatIndianNumber(stats.totalOrders)} change={`Pending: ${stats.pendingOrders.length}`} />
                        </div>
                        <div className="b2b-cell b2b-total-pending">
                            <StatCard title="Pending Approval" value={formatIndianNumber(stats.pendingOrders.length)} change={`Today: ${stats.todayOrders.length}`} />
                        </div>

                        {/* Row 2: Quick Actions (spans 2 cols) */}
                        <div className="b2b-cell b2b-quick-actions">
                            <div className="b2b-sales-card">
                                <div className="b2b-sales-header">
                                    <div>
                                        <p className="b2b-sales-label">Quick Actions</p>
                                    </div>
                                </div>
                                <div className="b2b-quick-btns">
                                    <button className="b2b-quick-btn primary" onClick={handleNewOrder}>+ New B2B Order</button>
                                    <button className="b2b-quick-btn" onClick={() => navigate("/b2b-order-history")}>Order History</button>
                                    <button className="b2b-quick-btn" onClick={() => setActiveTab("calendar")}>Calendar</button>
                                </div>
                            </div>
                        </div>

                        {/* Row 2-3: Alerts (col 4, spans 2 rows) */}
                        <aside className="b2b-cell b2b-alerts-box">
                            <div className="b2b-alerts-header">
                                <span className="b2b-alerts-title">Alerts</span>
                                <button className="b2b-view-btn" onClick={() => navigate("/b2b-order-history")}>View All</button>
                            </div>
                            <div className="b2b-alerts-body">
                                {orders.filter(o => o.approval_status === "rejected").length === 0 ? (
                                    <p className="b2b-muted">No alerts right now.</p>
                                ) : (
                                    orders.filter(o => o.approval_status === "rejected").slice(0, 8).map(order => (
                                        <div key={order.id} className="b2b-alert-item">
                                            <div className="b2b-alert-top">
                                                <b className="b2b-gold-text">{order.order_no}</b>
                                                <span className="b2b-rejected-badge">Rejected</span>
                                            </div>
                                            {order.rejection_reason && (
                                                <p className="b2b-alert-reason">{order.rejection_reason}</p>
                                            )}
                                            <div className="b2b-alert-actions">
                                                <button className="b2b-alert-edit-btn" onClick={() => handleEditOrder(order)}>Edit & Resubmit</button>
                                                <button className="b2b-alert-view-btn" onClick={() => handleViewOrder(order.id)}>View</button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </aside>

                        {/* Row 3: Recent Orders (spans 2 cols) */}
                        <div className="b2b-cell b2b-active-orders">
                            <div className="b2b-orders-card">
                                <div className="b2b-card-header">
                                    <span className="b2b-card-title">Recent Orders ({orders.slice(0, 10).length})</span>
                                    <button className="b2b-view-btn" onClick={() => navigate("/b2b-order-history")}>View All</button>
                                </div>
                                <div className="b2b-cardbox">
                                    {orders.length === 0 ? (
                                        <p className="b2b-muted">No orders yet</p>
                                    ) : (
                                        orders.slice(0, 10).map((o) => (
                                            <div className="b2b-order-item" key={o.id} onClick={() => handleViewOrder(o.id)} style={{ cursor: "pointer" }}>
                                                <p><b>Order No:</b> {o.order_no}</p>
                                                <p><b>PO Number:</b> {o.po_number || "—"}</p>
                                                <p><b>Type:</b> {o.b2b_order_type || "—"} &nbsp; | &nbsp; <b>Status:</b> <span className={getStatusBadgeClass(o.approval_status)}>{o.approval_status || "Pending"}</span></p>
                                                <p><b>Total:</b> ₹{formatIndianNumber(o.grand_total || 0)} &nbsp; | &nbsp; <b>Date:</b> {formatDate(o.created_at)}</p>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {/* ===== ORDER HISTORY TAB ===== */}
                {activeTab === "orders" && (
                    <div className="b2b-order-details-wrapper">
                        <h2 className="b2b-order-title">Order History</h2>
                        <div className="b2b-order-search-bar">
                            <input
                                type="text"
                                placeholder="Search by Order No, PO Number, or Vendor Name"
                                value={orderSearch}
                                onChange={(e) => {
                                    setOrderSearch(e.target.value);
                                    setCurrentPage(1);
                                }}
                            />
                        </div>

                        <div className="b2b-order-list-scroll">
                            {filteredOrders.length === 0 && <p className="b2b-muted">No orders found.</p>}

                            {paginatedOrders.map((order) => {
                                const item = order.items?.[0] || {};
                                const imgSrc = item.image_url || "/placeholder.png";

                                return (
                                    <div
                                        key={order.id}
                                        className="b2b-order-card"
                                        onClick={() => navigate("/b2b-order-history")}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        {/* Header Row */}
                                        <div className="b2b-order-header">
                                            <div className="b2b-header-info">
                                                <div className="b2b-header-item">
                                                    <span className="b2b-header-label">ORDER NO:</span>
                                                    <span className="b2b-header-value">{order.order_no || "—"}</span>
                                                </div>
                                                <div className="b2b-header-item">
                                                    <span className="b2b-header-label">ORDER DATE:</span>
                                                    <span className="b2b-header-value">{formatDate(order.created_at) || "—"}</span>
                                                </div>
                                                <div className="b2b-header-item">
                                                    <span className="b2b-header-label">PO NUMBER:</span>
                                                    <span className="b2b-header-value">{order.po_number || "—"}</span>
                                                </div>
                                            </div>
                                            <div className="b2b-header-actions">
                                                <div className={`b2b-order-status-badge ${getStatusBadgeClass(order.approval_status)}`}>
                                                    {order.approval_status || "Pending"}
                                                </div>
                                                {order.b2b_order_type && (
                                                    <div className={`b2b-order-type-badge ${order.b2b_order_type === "Buyout" ? "b2b-type-buyout" : "b2b-type-consignment"}`}>
                                                        {order.b2b_order_type}
                                                    </div>
                                                )}
                                                {order.order_flag === "Urgent" && (
                                                    <div className="b2b-urgent-badge">{"\u26A0"} Urgent</div>
                                                )}
                                                {order.credit_exceeded && (
                                                    <div className="b2b-credit-badge">Credit Exceeded</div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Content Row */}
                                        <div className="b2b-order-content">
                                            <div className="b2b-product-thumb" onClick={() => handleViewOrder(order.id)}>
                                                <img src={imgSrc} alt={item.product_name || "Product"} />
                                            </div>
                                            <div className="b2b-product-details">
                                                <div className="b2b-product-name">
                                                    <span className="b2b-order-label">Product:</span>
                                                    <span className="b2b-field-value">{item.product_name || "—"}</span>
                                                </div>
                                                <div className="b2b-product-name">
                                                    <span className="b2b-order-label">Vendor:</span>
                                                    <span className="b2b-field-value">{vendors[order.vendor_id]?.store_brand_name || "—"}</span>
                                                </div>
                                                <div className="b2b-product-name">
                                                    <span className="b2b-order-label">Merchandiser:</span>
                                                    <span className="b2b-field-value">{order.merchandiser_name || order.merchandiser || "—"}</span>
                                                </div>
                                                <div className="b2b-details-grid">
                                                    <div className="b2b-detail-item">
                                                        <span className="b2b-order-label">Amount:</span>
                                                        <span className="b2b-field-value">₹{formatIndianNumber(order.grand_total || 0)}</span>
                                                    </div>
                                                    <div className="b2b-detail-item">
                                                        <span className="b2b-order-label">Qty:</span>
                                                        <span className="b2b-field-value">{order.total_quantity || 1}</span>
                                                    </div>
                                                    <div className="b2b-detail-item">
                                                        <span className="b2b-order-label">Top:</span>
                                                        <span className="b2b-field-value">
                                                            {item.top || "—"}
                                                            {item.top_color?.hex && (
                                                                <>
                                                                    <span style={{ display: 'inline-block', width: 12, height: 12, backgroundColor: item.top_color.hex, borderRadius: '50%', marginLeft: 6, border: '1px solid #ccc', verticalAlign: 'middle' }} />
                                                                    <span style={{ marginLeft: 4 }}>{item.top_color.name}</span>
                                                                </>
                                                            )}
                                                        </span>
                                                    </div>
                                                    <div className="b2b-detail-item">
                                                        <span className="b2b-order-label">Bottom:</span>
                                                        <span className="b2b-field-value">
                                                            {item.bottom || "—"}
                                                            {item.bottom_color?.hex && (
                                                                <>
                                                                    <span style={{ display: 'inline-block', width: 12, height: 12, backgroundColor: item.bottom_color.hex, borderRadius: '50%', marginLeft: 6, border: '1px solid #ccc', verticalAlign: 'middle' }} />
                                                                    <span style={{ marginLeft: 4 }}>{item.bottom_color.name}</span>
                                                                </>
                                                            )}
                                                        </span>
                                                    </div>
                                                    <div className="b2b-detail-item">
                                                        <span className="b2b-order-label">Size:</span>
                                                        <span className="b2b-field-value">{item.size || "—"}</span>
                                                    </div>
                                                    <div className="b2b-detail-item">
                                                        <span className="b2b-order-label">Delivery:</span>
                                                        <span className="b2b-field-value">{formatDate(order.delivery_date) || "—"}</span>
                                                    </div>
                                                </div>
                                                {item.extras && item.extras.length > 0 && (
                                                    <div className="b2b-detail-item" style={{ gridColumn: 'span 2' }}>
                                                        <span className="b2b-order-label">Extras:</span>
                                                        <span className="b2b-field-value">
                                                            {item.extras.map((extra, idx) => (
                                                                <span key={idx}>
                                                                    {extra.name}
                                                                    {extra.color?.hex && (
                                                                        <>
                                                                            <span style={{ display: 'inline-block', width: 12, height: 12, backgroundColor: extra.color.hex, borderRadius: '50%', marginLeft: 6, border: '1px solid #ccc', verticalAlign: 'middle' }} />
                                                                            <span style={{ marginLeft: 4 }}>{extra.color.name}</span>
                                                                        </>
                                                                    )}
                                                                    {idx < item.extras.length - 1 && <span style={{ margin: '0 8px' }}>|</span>}
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
                            {filteredOrders.length > ORDERS_PER_PAGE && (
                                <div className="b2b-pagination">
                                    <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="b2b-pagination-btn">← Previous</button>
                                    <span className="b2b-pagination-info">Page {currentPage} of {Math.ceil(filteredOrders.length / ORDERS_PER_PAGE)}</span>
                                    <button disabled={currentPage >= Math.ceil(filteredOrders.length / ORDERS_PER_PAGE)} onClick={() => setCurrentPage(p => p + 1)} className="b2b-pagination-btn">Next →</button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ===== CALENDAR TAB ===== */}
                {activeTab === "calendar" && (
                    <div className="b2b-calendar-wrapper">
                        <div className="b2b-ios-calendar">
                            <div className="b2b-ios-cal-header">
                                <button
                                    className="b2b-ios-nav-btn"
                                    disabled={new Date(calendarDate).getFullYear() === MIN_CALENDAR_DATE.getFullYear() && new Date(calendarDate).getMonth() === MIN_CALENDAR_DATE.getMonth()}
                                    onClick={() => setCalendarDate(d => { const n = new Date(d); n.setMonth(n.getMonth() - 1); return n; })}
                                >‹</button>
                                <span className="b2b-ios-month-year">
                                    {new Date(calendarDate).toLocaleString("default", { month: "long", year: "numeric" })}
                                </span>
                                <button className="b2b-ios-nav-btn" onClick={() => setCalendarDate(d => { const n = new Date(d); n.setMonth(n.getMonth() + 1); return n; })}>›</button>
                            </div>

                            <div className="b2b-ios-days-row">
                                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
                                    <div key={day} className="b2b-ios-day-label">{day}</div>
                                ))}
                            </div>

                            <div className="b2b-ios-date-grid">
                                {(() => {
                                    const year = new Date(calendarDate).getFullYear();
                                    const month = new Date(calendarDate).getMonth();
                                    const firstDayOfMonth = new Date(year, month, 1).getDay();
                                    const daysInMonth = new Date(year, month + 1, 0).getDate();
                                    const totalCells = Math.ceil((firstDayOfMonth + daysInMonth) / 7) * 7;

                                    return Array.from({ length: totalCells }).map((_, i) => {
                                        const date = i - firstDayOfMonth + 1;
                                        if (date <= 0 || date > daysInMonth) {
                                            return <div key={i} className="b2b-ios-date-cell b2b-ios-empty" />;
                                        }
                                        const currentDay = new Date(year, month, date);
                                        const fullDate = formatDate(currentDay);
                                        const todayDate = formatDate(new Date());
                                        const isToday = fullDate === todayDate;
                                        const isSelected = selectedCalendarDate === fullDate;
                                        const orderCount = ordersByDate[fullDate] || 0;

                                        return (
                                            <div key={i} className={`b2b-ios-date-cell ${isToday ? "b2b-ios-today" : ""} ${isSelected ? "b2b-ios-selected" : ""}`} onClick={() => setSelectedCalendarDate(fullDate)}>
                                                <span className="b2b-ios-date-num">{date}</span>
                                                {orderCount > 0 && <span className="b2b-ios-order-count">{orderCount}</span>}
                                            </div>
                                        );
                                    });
                                })()}
                            </div>
                        </div>

                        {selectedCalendarDate && (
                            <div className="b2b-calendar-orders-section">
                                <div className="b2b-card-header">
                                    <span className="b2b-card-title">Orders for {selectedCalendarDate} ({orders.filter(o => formatDate(o.delivery_date) === selectedCalendarDate).length})</span>
                                </div>
                                <div className="b2b-calendar-orders-list">
                                    {orders.filter(o => formatDate(o.delivery_date) === selectedCalendarDate).length === 0 ? (
                                        <p className="b2b-muted">No orders scheduled for this date</p>
                                    ) : (
                                        orders.filter(o => formatDate(o.delivery_date) === selectedCalendarDate).map((order) => (
                                            <div className="b2b-order-item" key={order.id} onClick={() => handleViewOrder(order.id)} style={{ cursor: "pointer" }}>
                                                <p><b>Order No:</b> {order.order_no}</p>
                                                <p><b>PO:</b> {order.po_number || "—"}</p>
                                                <p><b>Status:</b> {order.approval_status || "Pending"}</p>
                                                {order.order_flag === "Urgent" && <p><b style={{color: "#e53935"}}>{"\u26A0"} Urgent</b></p>}
                                                <p><b>Delivery:</b> {formatDate(order.delivery_date)}</p>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ===== PROFILE TAB ===== */}
                {activeTab === "profile" && (
                    <div className="b2b-order-details-wrapper b2b-profile-wrapper">
                        <h2 className="b2b-profile-title">My Profile</h2>
                        <div className="b2b-profile-card">
                            <div className="b2b-profile-row"><span className="b2b-label">Name</span><span className="b2b-value">{profile?.saleperson || "User"}</span></div>
                            <div className="b2b-profile-row"><span className="b2b-label">Email</span><span className="b2b-value">{user?.email}</span></div>
                            <div className="b2b-profile-row"><span className="b2b-label">Role</span><span className="b2b-value">B2B Executive</span></div>
                            <div className="b2b-profile-row"><span className="b2b-label">Store</span><span className="b2b-value">{profile?.store_name || "N/A"}</span></div>
                        </div>
                    </div>
                )}
            </div>

            {/* ===== FLOATING ADD BUTTON ===== */}
            <button className="b2b-add-btn" onClick={handleNewOrder}>+</button>
        </div>
    );
}

function StatCard({ title, value, change }) {
    return (
        <div className="b2b-stat-card">
            <p className="b2b-stat-title">{title}</p>
            <div className="b2b-stat-content">
                <span className="b2b-stat-value">{value}</span>
                <span className="b2b-stat-change">{change}</span>
            </div>
        </div>
    );
}