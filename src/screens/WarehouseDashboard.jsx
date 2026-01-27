import React, { useEffect, useState, useMemo } from "react";
import "./WarehouseDashboard.css";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Logo from "../images/logo.png";
import formatDate from "../utils/formatDate";
import { downloadWarehousePdf } from "../utils/pdfUtils";

// Status options for alterations
const ALTERATION_STATUS_OPTIONS = [
  { value: "pending", label: "Pending", color: "#ff9800" },
  { value: "in_production", label: "In Production", color: "#2196f3" },
  { value: "ready", label: "Ready", color: "#4caf50" },
  { value: "dispatched", label: "Dispatched", color: "#9c27b0" },
  { value: "delivered", label: "Delivered", color: "#388e3c" },
];

// Filter tabs
const FILTER_TABS = [
  { value: "all", label: "All Orders" },
  { value: "regular", label: "Regular Orders" },
  { value: "alterations", label: "Alterations" },
  { value: "urgent", label: "Urgent" },
];

const WarehouseDashboard = () => {
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("orders");
  const [showSidebar, setShowSidebar] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState("all");
  const [statusUpdating, setStatusUpdating] = useState(null);

  // Calendar state
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const ordersPerPage = 5;

  // Image viewer modal
  const [viewingImages, setViewingImages] = useState(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const getWarehouseDate = (dateStr) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    if (isNaN(d)) return "—";
    // Subtract 2 days for warehouse deadline
    d.setDate(d.getDate() - 2);
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  // Format measurements safely
  const renderMeasurements = (m) => {
    if (!m || typeof m !== "object") {
      return <span className="wd-no-measurements">No measurements</span>;
    }

    return Object.entries(m).map(([key, value]) => {
      if (typeof value === "object" && value !== null) {
        return (
          <div key={key} className="wd-measurement-card">
            <div className="wd-measurement-card-title">{key}</div>
            <div className="wd-measurement-card-values">
              {Object.entries(value).map(([subKey, subValue]) => (
                <span key={subKey} className="wd-measurement-item">
                  <span className="wd-measurement-key">{subKey}:</span>
                  <span className="wd-measurement-value">{subValue}</span>
                </span>
              ))}
            </div>
          </div>
        );
      }

      return (
        <div key={key} className="wd-measurement-card wd-flat">
          <span className="wd-measurement-item">
            <span className="wd-measurement-key">{key}:</span>
            <span className="wd-measurement-value">{value}</span>
          </span>
        </div>
      );
    });
  };

  const fetchOrders = async () => {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error) {
      setOrders(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  // Calendar minimum date
  const MIN_CALENDAR_DATE = new Date(2025, 11, 1); // December 2025

  // Filter orders based on filter tab
  // Only show Warehouse alterations (not In-Store)
  const filteredByTab = useMemo(() => {
    switch (filterTab) {
      case "regular":
        return orders.filter(o => !o.is_alteration);
      case "alterations":
        // Only show alterations meant for Warehouse
        return orders.filter(o => o.is_alteration && o.alteration_location === "Warehouse");
      case "urgent":
        return orders.filter(o =>
          (o.alteration_status === "upcoming_occasion" || o.is_urgent) &&
          (!o.is_alteration || o.alteration_location === "Warehouse")
        );
      default:
        // "All" tab - show regular orders + Warehouse alterations only
        return orders.filter(o => !o.is_alteration || o.alteration_location === "Warehouse");
    }
  }, [orders, filterTab]);

  // Filter orders based on search
  const filteredOrders = useMemo(() => {
    if (!searchQuery.trim()) return filteredByTab;

    const query = searchQuery.toLowerCase();
    return filteredByTab.filter((order) => {
      const item = order.items?.[0] || {};
      return (
        order.order_no?.toLowerCase().includes(query) ||
        item.product_name?.toLowerCase().includes(query) ||
        order.delivery_name?.toLowerCase().includes(query) ||
        order.status?.toLowerCase().includes(query) ||
        order.alteration_type?.toLowerCase().includes(query)
      );
    });
  }, [filteredByTab, searchQuery]);

  // Get counts for tabs
  const tabCounts = useMemo(() => ({
    all: orders.filter(o => !o.is_alteration || o.alteration_location === "Warehouse").length,
    regular: orders.filter(o => !o.is_alteration).length,
    alterations: orders.filter(o => o.is_alteration && o.alteration_location === "Warehouse").length,
    urgent: orders.filter(o =>
      (o.alteration_status === "upcoming_occasion" || o.is_urgent) &&
      (!o.is_alteration || o.alteration_location === "Warehouse")
    ).length,
  }), [orders]);

  // Memoize ordersByDate for calendar
  const ordersByDate = useMemo(() => {
    return orders.reduce((acc, order) => {
      const date = order.delivery_date ? formatDate(order.delivery_date) : null;
      if (date) {
        acc[date] = (acc[date] || 0) + 1;
      }
      return acc;
    }, {});
  }, [orders]);

  const markAsCompleted = async (orderId) => {
    const { error } = await supabase
      .from("orders")
      .update({ status: "completed" })
      .eq("id", orderId);

    if (!error) fetchOrders();
  };

  // Update alteration status
  const updateAlterationStatus = async (orderId, newStatus) => {
    setStatusUpdating(orderId);
    try {
      const updateData = { status: newStatus };

      // If marking as delivered, set delivered_at
      if (newStatus === "delivered") {
        updateData.delivered_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from("orders")
        .update(updateData)
        .eq("id", orderId);

      if (!error) {
        fetchOrders();
      } else {
        console.error("Status update failed:", error);
        alert("Failed to update status");
      }
    } catch (err) {
      console.error("Error updating status:", err);
    } finally {
      setStatusUpdating(null);
    }
  };

  // Handle PDF generation on-demand
  const handleGeneratePdf = async (order) => {
    setPdfLoading(order.id);
    try {
      await downloadWarehousePdf(order);
      fetchOrders();
    } catch (error) {
      console.error("PDF generation failed:", error);
    } finally {
      setPdfLoading(null);
    }
  };

  // Navigate to parent order
  const viewParentOrder = (parentOrderId) => {
    const parentOrder = orders.find(o => o.id === parentOrderId);
    if (parentOrder) {
      // Scroll to that order or highlight it
      setSearchQuery(parentOrder.order_no);
      setFilterTab("all");
    }
  };

  // Pagination logic
  const totalPages = Math.ceil(filteredOrders.length / ordersPerPage);
  const startIndex = (currentPage - 1) * ordersPerPage;
  const endIndex = startIndex + ordersPerPage;
  const currentOrders = filteredOrders.slice(startIndex, endIndex);

  // Reset to page 1 when search or filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterTab]);

  const goToPage = (page) => setCurrentPage(page);
  const goToPrevious = () => { if (currentPage > 1) setCurrentPage(currentPage - 1); };
  const goToNext = () => { if (currentPage < totalPages) setCurrentPage(currentPage + 1); };

  // Smart pagination - generate page numbers with ellipsis
  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;
    
    if (totalPages <= maxVisible + 2) {
      // Show all pages if total is small (7 or fewer)
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);
      
      // Calculate start and end of visible window
      let start = Math.max(2, currentPage - 1);
      let end = Math.min(totalPages - 1, currentPage + 1);
      
      // Adjust window to show at least 3 middle pages
      if (currentPage <= 3) {
        end = Math.min(totalPages - 1, 4);
      }
      if (currentPage >= totalPages - 2) {
        start = Math.max(2, totalPages - 3);
      }
      
      // Add ellipsis before middle pages if needed
      if (start > 2) {
        pages.push('...');
      }
      
      // Add middle pages
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      
      // Add ellipsis after middle pages if needed
      if (end < totalPages - 1) {
        pages.push('...');
      }
      
      // Always show last page
      pages.push(totalPages);
    }
    
    return pages;
  };

  // Get alteration type display
  const getAlterationTypeLabel = (type) => {
    const types = {
      fitting_tightening: "Fitting Issue (Tightening)",
      fitting_loosening: "Fitting Issue (Loosening)",
      length_issue: "Length Issue",
      fabric_issue: "Fabric Issue",
      other: "Other",
    };
    return types[type] || type || "—";
  };

  // Get status color
  const getStatusColor = (status) => {
    const option = ALTERATION_STATUS_OPTIONS.find(o => o.value === status);
    return option?.color || "#666";
  };

  return (
    <div className="wd-dashboard-wrapper">
      {/* HEADER */}
      <div className="wd-top-header">
        <div className="wd-header-left">
          <img src={Logo} className="logo" alt="logo" />
        </div>
        <h1 className="wd-title">Warehouse Dashboard</h1>
      </div>

      {/* MAIN LAYOUT WITH SIDEBAR */}
      <div className="wd-main-layout">
        {/* Hamburger for mobile */}
        <div className="wd-hamburger-icon" onClick={() => setShowSidebar(!showSidebar)}>
          <div className="wd-bar"></div>
          <div className="wd-bar"></div>
          <div className="wd-bar"></div>
        </div>

        {/* SIDEBAR */}
        <aside className={`wd-sidebar ${showSidebar ? "wd-open" : ""}`}>
          <nav className="wd-menu">
            <a
              className={`wd-menu-item ${activeTab === "orders" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("orders");
                setShowSidebar(false);
              }}
            >
              Order History
            </a>
            <a
              className={`wd-menu-item ${activeTab === "calendar" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("calendar");
                setShowSidebar(false);
              }}
            >
              Calendar
            </a>
            <a className="wd-menu-item" onClick={handleLogout}>
              Log Out
            </a>
          </nav>
        </aside>

        {/* CONTENT AREA */}
        <div className="wd-content-area">
          {/* ORDERS TAB */}
          {activeTab === "orders" && (
            <div className="wd-orders-section">
              {/* Header with count */}
              <div className="wd-orders-header">
                <h2 className="wd-section-title">Order History</h2>
                <span className="wd-orders-count">{filteredOrders.length} Orders</span>
              </div>

              {/* Filter Tabs */}
              <div className="wd-filter-tabs">
                {FILTER_TABS.map((tab) => (
                  <button
                    key={tab.value}
                    className={`wd-filter-tab ${filterTab === tab.value ? "active" : ""}`}
                    onClick={() => setFilterTab(tab.value)}
                  >
                    {tab.label}
                    <span className="wd-tab-count">({tabCounts[tab.value]})</span>
                  </button>
                ))}
              </div>

              {/* Search Bar */}
              <div className="wd-search-bar">
                <input
                  type="text"
                  placeholder="Search by Order ID, Product Name, Customer Name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="wd-search-input"
                />
                {searchQuery && (
                  <button
                    className="wd-search-clear"
                    onClick={() => setSearchQuery("")}
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Scrollable Orders Container */}
              <div className="wd-orders-scroll-container">
                {loading ? (
                  <p className="wd-loading-text">Loading orders...</p>
                ) : filteredOrders.length === 0 ? (
                  <p className="wd-no-orders">No orders found.</p>
                ) : (
                  currentOrders.map((order) => {
                    const firstItem = Array.isArray(order.items)
                      ? order.items[0] || {}
                      : order.items || {};

                    const isAlteration = order.is_alteration;
                    const isUrgent = order.alteration_status === "upcoming_occasion" || order.is_urgent;

                    return (
                      <div
                        key={order.id}
                        className={`wd-order-dropdown ${isAlteration ? "wd-alteration-order" : ""} ${isUrgent ? "wd-urgent-order" : ""}`}
                      >
                        {/* Order Header with Badges */}
                        <div className="wd-order-header-row">
                          <div className="wd-order-badges">
                            <h3 className="wd-dropdown-title">
                              {isAlteration ? "🔧 Alteration Order" : "Product Details"}
                            </h3>

                            {/* Alteration Badge */}
                            {isAlteration && (
                              <span className="wd-badge wd-badge-alteration">
                                ALTERATION
                              </span>
                            )}

                            {/* Urgent Badge */}
                            {isUrgent && (
                              <span className="wd-badge wd-badge-urgent">
                                🔥 URGENT
                              </span>
                            )}

                            {/* Alteration Number */}
                            {isAlteration && order.alteration_number && (
                              <span className="wd-badge wd-badge-number">
                                #{order.alteration_number}
                              </span>
                            )}
                          </div>

                          <div className="wd-order-actions">
                            <button
                              className="wd-pdf-Btn"
                              onClick={() => handleGeneratePdf(order)}
                              disabled={pdfLoading === order.id}
                            >
                              {pdfLoading === order.id ? "Generating..." : "Generate PDF"}
                            </button>
                          </div>
                        </div>

                        {/* Parent Order Link (for alterations) */}
                        {isAlteration && order.parent_order_id && (
                          <div className="wd-parent-order-link">
                            <span>Original Order: </span>
                            <button
                              className="wd-link-btn"
                              onClick={() => viewParentOrder(order.parent_order_id)}
                            >
                              View Parent Order →
                            </button>
                          </div>
                        )}

                        {/* Alteration Details Section */}
                        {isAlteration && (
                          <div className="wd-alteration-details">
                            <div className="wd-alteration-grid">
                              <div className="wd-alteration-field">
                                <span className="wd-alt-label">Alteration Type:</span>
                                <span className="wd-alt-value">{getAlterationTypeLabel(order.alteration_type)}</span>
                              </div>
                              <div className="wd-alteration-field">
                                <span className="wd-alt-label">Location:</span>
                                <span className="wd-alt-value">{order.alteration_location || "—"}</span>
                              </div>
                              <div className="wd-alteration-field">
                                <span className="wd-alt-label">Status:</span>
                                <select
                                  className="wd-status-select"
                                  value={order.status || "pending"}
                                  onChange={(e) => updateAlterationStatus(order.id, e.target.value)}
                                  disabled={statusUpdating === order.id}
                                  style={{ borderColor: getStatusColor(order.status) }}
                                >
                                  {ALTERATION_STATUS_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            {/* Alteration Notes */}
                            {order.alteration_notes && (
                              <div className="wd-alteration-notes">
                                <span className="wd-alt-label">Notes:</span>
                                <p className="wd-alt-notes-text">{order.alteration_notes}</p>
                              </div>
                            )}

                            {/* Alteration Attachments */}
                            {order.alteration_attachments && order.alteration_attachments.length > 0 && (
                              <div className="wd-alteration-attachments">
                                <span className="wd-alt-label">Attachments:</span>
                                <div className="wd-attachment-thumbnails">
                                  {order.alteration_attachments.map((url, idx) => (
                                    <img
                                      key={idx}
                                      src={url}
                                      alt={`Attachment ${idx + 1}`}
                                      className="wd-attachment-thumb"
                                      onClick={() => {
                                        setViewingImages(order.alteration_attachments);
                                        setCurrentImageIndex(idx);
                                      }}
                                    />
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="wd-dropdown-content">
                          {/* IMAGE */}
                          <div className="wd-dropdown-img">
                            {firstItem.image_url ? (
                              <img
                                src={firstItem.image_url}
                                alt={firstItem.product_name || "Product"}
                                onError={(e) => {
                                  e.target.onerror = null;
                                  e.target.src = "/placeholder.png";
                                }}
                              />
                            ) : (
                              <div className="wd-placeholder-img-box">
                                <span>No Image</span>
                              </div>
                            )}
                          </div>

                          <div className="wd-dropdown-info">
                            <p><strong className="wd-label">Order Id:</strong> {order.order_no}</p>
                            <p><strong className="wd-label">Product Name:</strong> {firstItem.product_name}</p>

                            <div style={{ display: "flex", alignItems: 'center', gap: 70 }}>
                              <p><strong className="wd-label">Client Name:</strong> {order.delivery_name || "-"}</p>
                              <p><strong className="wd-label">SA Name:</strong> {order.salesperson_name || "-"}</p>
                            </div>

                            <div style={{ display: "flex", alignItems: 'center', gap: 70 }}>
                              <div style={{ display: "flex", alignItems: 'center', gap: 10 }}>
                                <p><strong className="wd-label">Top:</strong> {firstItem.top || "-"} </p>
                                {firstItem.top_color?.hex && (
                                  <p style={{ backgroundColor: firstItem.top_color.hex, width: 20, height: 20 }}></p>
                                )}
                              </div>
                              <div style={{ display: "flex", alignItems: 'center', gap: 10 }}>
                                <p><strong className="wd-label">Bottom:</strong> {firstItem.bottom || "-"}</p>
                                {firstItem.bottom_color?.hex && (
                                  <p style={{ backgroundColor: firstItem.bottom_color.hex, width: 20, height: 20 }}></p>
                                )}
                              </div>
                            </div>

                            <div style={{ display: "flex", alignItems: 'center', gap: 50 }}>
                              <p><strong className="wd-label">Extras:</strong> {firstItem.extra || "-"}</p>
                              <p><strong className="wd-label">Size:</strong> {firstItem.size || "-"}</p>
                            </div>

                            <div className="wd-measurement-section">
                              <strong className="wd-label wd-measurement-label">Measurements:</strong>
                              <div className="wd-measurement-grid">
                                {renderMeasurements(firstItem.measurements)}
                              </div>
                            </div>

                            <div style={{ display: "flex", alignItems: 'center', gap: 70 }}>
                              <p><strong className="wd-label">Order Date:</strong> {formatDate(order.created_at)}</p>
                              <p><strong className="wd-label">Delivery Date:</strong> {getWarehouseDate(order.delivery_date)}</p>
                            </div>

                            {/* Status Button - Different for alterations vs regular orders */}
                            {!isAlteration && (
                              <button
                                className="wd-complete-btn"
                                disabled={order.status === "completed"}
                                onClick={() => markAsCompleted(order.id)}
                              >
                                {order.status === "completed" ? "Completed ✔" : "Mark as Completed"}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Pagination Controls - SMART PAGINATION */}
              {!loading && filteredOrders.length > ordersPerPage && (
                <div className="wd-pagination">
                  <button
                    className="wd-pagination-btn"
                    onClick={goToPrevious}
                    disabled={currentPage === 1}
                  >
                    ← Prev
                  </button>

                  <div className="wd-pagination-pages">
                    {getPageNumbers().map((page, idx) => (
                      page === '...' ? (
                        <span key={`ellipsis-${idx}`} className="wd-pagination-ellipsis">...</span>
                      ) : (
                        <button
                          key={page}
                          className={`wd-pagination-page ${currentPage === page ? "active" : ""}`}
                          onClick={() => goToPage(page)}
                        >
                          {page}
                        </button>
                      )
                    ))}
                  </div>

                  <button
                    className="wd-pagination-btn"
                    onClick={goToNext}
                    disabled={currentPage === totalPages}
                  >
                    Next →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* CALENDAR TAB - ✅ INSIDE wd-content-area */}
          {activeTab === "calendar" && (
            <div className="wd-calendar-wrapper">
              <h2 className="wd-section-title">Calendar</h2>

              <div className="wd-ios-calendar">
                <div className="wd-ios-cal-header">
                  <button
                    className="wd-ios-nav-btn"
                    disabled={new Date(calendarDate).getFullYear() === 2025 && new Date(calendarDate).getMonth() === 11}
                    onClick={() => setCalendarDate(prev => {
                      const d = new Date(prev);
                      d.setMonth(d.getMonth() - 1);
                      if (d < MIN_CALENDAR_DATE) return prev;
                      return d;
                    })}
                  >
                    ‹
                  </button>
                  <span className="wd-ios-month-year">
                    {new Date(calendarDate).toLocaleString("default", { month: "long", year: "numeric" })}
                  </span>
                  <button
                    className="wd-ios-nav-btn"
                    onClick={() => setCalendarDate(prev => {
                      const d = new Date(prev);
                      d.setMonth(d.getMonth() + 1);
                      return d;
                    })}
                  >
                    ›
                  </button>
                </div>

                <div className="wd-ios-days-row">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
                    <div key={day} className="wd-ios-day-label">{day}</div>
                  ))}
                </div>

                <div className="wd-ios-date-grid">
                  {(() => {
                    const year = new Date(calendarDate).getFullYear();
                    const month = new Date(calendarDate).getMonth();
                    const firstDayOfMonth = new Date(year, month, 1).getDay();
                    const daysInMonth = new Date(year, month + 1, 0).getDate();
                    const totalCells = Math.ceil((firstDayOfMonth + daysInMonth) / 7) * 7;

                    return Array.from({ length: totalCells }).map((_, i) => {
                      const date = i - firstDayOfMonth + 1;
                      if (date <= 0 || date > daysInMonth) {
                        return <div key={i} className="wd-ios-date-cell wd-ios-empty" />;
                      }

                      const currentDay = new Date(year, month, date);
                      const fullDate = formatDate(currentDay);
                      const todayDate = formatDate(new Date());
                      const isToday = fullDate === todayDate;
                      const isSelected = selectedCalendarDate === fullDate;
                      const orderCount = ordersByDate[fullDate] || 0;

                      return (
                        <div
                          key={i}
                          className={`wd-ios-date-cell ${isToday ? "wd-ios-today" : ""} ${isSelected ? "wd-ios-selected" : ""} ${orderCount > 0 ? "wd-ios-has-orders" : ""}`}
                          onClick={() => setSelectedCalendarDate(fullDate)}
                        >
                          <span className="wd-ios-date-num">{date}</span>
                          {orderCount > 0 && (
                            <span className="wd-ios-order-count">{orderCount}</span>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {selectedCalendarDate && (
                <div className="wd-calendar-orders-section">
                  <div className="wd-calendar-header">
                    <span className="wd-calendar-title">
                      Orders for {selectedCalendarDate} ({orders.filter(o => formatDate(o.delivery_date) === selectedCalendarDate).length})
                    </span>
                  </div>

                  <div className="wd-calendar-orders-list">
                    {orders.filter(o => formatDate(o.delivery_date) === selectedCalendarDate).length === 0 ? (
                      <p className="wd-no-orders">No orders scheduled for this date</p>
                    ) : (
                      orders
                        .filter(o => formatDate(o.delivery_date) === selectedCalendarDate)
                        .map((order) => (
                          <div
                            className="wd-calendar-order-item"
                            key={order.id}
                          >
                            <p><b>Order No:</b> {order.order_no}</p>
                            <p><b>Client Name:</b> {order.delivery_name}</p>
                            <p><b>Status:</b> {order.status || "Pending"}</p>
                            <p><b>Delivery Date:</b> {formatDate(order.delivery_date)}</p>
                          </div>
                        ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Image Viewer Modal - OUTSIDE main layout but inside dashboard wrapper */}
      {viewingImages && (
        <div className="wd-image-modal" onClick={() => setViewingImages(null)}>
          <div className="wd-image-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="wd-image-close" onClick={() => setViewingImages(null)}>✕</button>
            <img src={viewingImages[currentImageIndex]} alt="Attachment" className="wd-image-full" />
            {viewingImages.length > 1 && (
              <div className="wd-image-nav">
                <button
                  onClick={() => setCurrentImageIndex((prev) => (prev - 1 + viewingImages.length) % viewingImages.length)}
                >
                  ←
                </button>
                <span>{currentImageIndex + 1} / {viewingImages.length}</span>
                <button
                  onClick={() => setCurrentImageIndex((prev) => (prev + 1) % viewingImages.length)}
                >
                  →
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default WarehouseDashboard;