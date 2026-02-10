import React, { useEffect, useState, useMemo, useRef } from "react";
import "./WarehouseDashboard.css";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Logo from "../images/logo.png";
import formatDate from "../utils/formatDate";
import { downloadWarehousePdf } from "../utils/pdfUtils";
import { usePopup } from "../components/Popup";

// Status options for alterations
const ALTERATION_STATUS_OPTIONS = [
  { value: "pending", label: "Pending", color: "#ff9800" },
  { value: "in_production", label: "In Production", color: "#2196f3" },
  { value: "ready", label: "Ready", color: "#4caf50" },
  { value: "dispatched", label: "Dispatched", color: "#9c27b0" },
  { value: "delivered", label: "Delivered", color: "#388e3c" },
];

// Status Tabs (Primary Filter - Mutually Exclusive by Order Lifecycle)
const STATUS_TABS = [
  { value: "all", label: "All Orders" },
  { value: "unfulfilled", label: "Unfulfilled" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  // { value: "alteration", label: "Alterations" },
];

const getMeasurementLabel = (key) => {
  if (!key) return key;
  const topKeys = ["KurtaChogaKaftan", "Blouse", "Anarkali"];
  const bottomKeys = ["SalwarDhoti", "ChuridaarTrouserPantsPlazo", "ShararaGharara"];
  if (topKeys.includes(key)) return "Top";
  if (bottomKeys.includes(key)) return "Bottom";
  if (key === "Lehenga") return "Lehenga";
  return key;
};

const WarehouseDashboard = () => {
  const { showPopup, PopupComponent } = usePopup();
  const navigate = useNavigate();

  const isLxrtsOrder = (order) => {
    return order.items?.[0]?.sync_enabled === true;
  };

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("orders");
  const [showSidebar, setShowSidebar] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(null);
  const [statusUpdating, setStatusUpdating] = useState(null);

  // Search & Sort
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("newest");

  // Status Tab (Primary Filter)
  const [statusTab, setStatusTab] = useState("all");

  // Secondary Filters
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

  // Filter dropdown states
  const [openDropdown, setOpenDropdown] = useState(null);
  const dropdownRef = useRef(null);

  // Calendar state
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const ordersPerPage = 5;

  // Image viewer modal
  const [viewingImages, setViewingImages] = useState(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const [attachmentLoading, setAttachmentLoading] = useState(null);

  // Get unique salespersons from orders
  const salespersons = useMemo(() => {
    const spSet = new Set();
    orders.forEach(o => {
      if (o.salesperson) spSet.add(o.salesperson);
    });
    return Array.from(spSet).sort();
  }, [orders]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const getWarehouseDate = (dateStr, orderDateStr) => {
    if (!dateStr) return "-";
    const deliveryDate = new Date(dateStr);
    if (isNaN(deliveryDate)) return "-";
    if (orderDateStr) {
      const orderDate = new Date(orderDateStr);
      const daysDiff = Math.floor((deliveryDate - orderDate) / (1000 * 60 * 60 * 24));
      if (daysDiff >= 2) {
        deliveryDate.setDate(deliveryDate.getDate() - 2);
      }
    }
    return deliveryDate.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).replace(/\//g, "-");
  };

  const getWarehouseDateForCalendar = (dateStr, orderDateStr) => {
    if (!dateStr) return null;
    const deliveryDate = new Date(dateStr);
    if (isNaN(deliveryDate)) return null;
    if (orderDateStr) {
      const orderDate = new Date(orderDateStr);
      const daysDiff = Math.floor((deliveryDate - orderDate) / (1000 * 60 * 60 * 24));
      if (daysDiff >= 2) {
        deliveryDate.setDate(deliveryDate.getDate() - 2);
      }
    }
    return formatDate(deliveryDate);
  };

  const renderMeasurements = (m) => {
    if (!m || typeof m !== "object") {
      return <span className="wd-no-measurements">No measurements</span>;
    }
    return Object.entries(m).map(([key, value]) => {
      if (typeof value === "object" && value !== null) {
        const nonEmptyFields = Object.entries(value).filter(
          ([_, v]) => v !== '' && v !== null && v !== undefined
        );
        if (nonEmptyFields.length === 0) return null;
        const displayLabel = getMeasurementLabel(key);
        return (
          <div key={key} className="wd-measurement-card">
            <div className="wd-measurement-card-title">{displayLabel}</div>
            <div className="wd-measurement-card-values">
              {nonEmptyFields.map(([subKey, subValue]) => (
                <span key={subKey} className="wd-measurement-item">
                  <span className="wd-measurement-key">{subKey}:</span>
                  <span className="wd-measurement-value">{subValue}</span>
                </span>
              ))}
            </div>
          </div>
        );
      }
      if (value === '' || value === null || value === undefined) return null;
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

  const MIN_CALENDAR_DATE = new Date(2025, 11, 1);

  // Get payment status of an order
  const getPaymentStatus = (order) => {
    const total = order.grand_total || order.net_total || 0;
    const advance = order.advance_payment || 0;
    if (advance >= total) return "paid";
    if (advance > 0) return "partial";
    return "unpaid";
  };

  // Get priority of an order
  const getPriority = (order) => {
    if (order.is_urgent || order.order_flag === "Urgent" || order.alteration_status === "upcoming_occasion") {
      return "urgent";
    }
    return "normal";
  };

  // Get order type
  const getOrderType = (order) => {
    if (order.is_alteration) return "alteration";
    const item = order.items?.[0];
    if (item?.order_type === "Custom" || item?.payment_order_type === "Custom") return "custom";
    return "standard";
  };

  // Filter orders based on status tab
  const filteredByStatus = useMemo(() => {
    return orders.filter(o => {
      if (isLxrtsOrder(o)) return false;

      const status = o.status?.toLowerCase();

      switch (statusTab) {
        case "unfulfilled":
          // All orders that are still being worked on (not completed/delivered/cancelled)
          return status !== "completed" &&
            status !== "delivered" &&
            status !== "cancelled" &&
            (!o.is_alteration || o.alteration_location === "Warehouse");
        case "completed":
          // Finished orders
          return (status === "completed" || status === "delivered") &&
            (!o.is_alteration || o.alteration_location === "Warehouse");
        case "cancelled":
          return status === "cancelled" &&
            (!o.is_alteration || o.alteration_location === "Warehouse");
        case "alteration":
          return o.is_alteration && o.alteration_location === "Warehouse";
        default:
          // "all" - show everything except in-store alterations
          return !o.is_alteration || o.alteration_location === "Warehouse";
      }
    });
  }, [orders, statusTab]);

  // Apply secondary filters
  const filteredOrders = useMemo(() => {
    let result = filteredByStatus;

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((order) => {
        const item = order.items?.[0] || {};
        return (
          order.order_no?.toLowerCase().includes(query) ||
          item.product_name?.toLowerCase().includes(query) ||
          order.delivery_name?.toLowerCase().includes(query) ||
          order.delivery_phone?.includes(query) ||
          order.salesperson?.toLowerCase().includes(query)
        );
      });
    }

    // Date range filter
    if (filters.dateFrom || filters.dateTo) {
      result = result.filter((order) => {
        const warehouseDate = getWarehouseDateForCalendar(order.delivery_date, order.created_at);
        if (!warehouseDate) return false;
        const [day, month, year] = warehouseDate.split("-");
        const orderDate = new Date(year, month - 1, day);
        if (filters.dateFrom && orderDate < new Date(filters.dateFrom)) return false;
        if (filters.dateTo && orderDate > new Date(filters.dateTo)) return false;
        return true;
      });
    }

    // Price range filter
    if (filters.minPrice > 0 || filters.maxPrice < 500000) {
      result = result.filter((order) => {
        const total = order.grand_total || order.net_total || 0;
        return total >= filters.minPrice && total <= filters.maxPrice;
      });
    }

    // Payment status filter
    if (filters.payment.length > 0) {
      result = result.filter((order) => filters.payment.includes(getPaymentStatus(order)));
    }

    // Priority filter
    if (filters.priority.length > 0) {
      result = result.filter((order) => filters.priority.includes(getPriority(order)));
    }

    // Order type filter
    if (filters.orderType.length > 0) {
      result = result.filter((order) => filters.orderType.includes(getOrderType(order)));
    }

    // Store filter
    if (filters.store.length > 0) {
      result = result.filter((order) => filters.store.includes(order.salesperson_store));
    }

    // Salesperson filter
    if (filters.salesperson) {
      result = result.filter((order) => order.salesperson === filters.salesperson);
    }

    // Sorting
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case "oldest":
          return new Date(a.created_at) - new Date(b.created_at);
        case "delivery":
          return new Date(a.delivery_date || 0) - new Date(b.delivery_date || 0);
        case "amount_high":
          return (b.grand_total || 0) - (a.grand_total || 0);
        case "amount_low":
          return (a.grand_total || 0) - (b.grand_total || 0);
        default:
          return new Date(b.created_at) - new Date(a.created_at);
      }
    });

    return result;
  }, [filteredByStatus, searchQuery, filters, sortBy]);

  // Tab counts
  const tabCounts = useMemo(() => {
    const validOrders = orders.filter(o => !isLxrtsOrder(o));
    return {
      all: validOrders.filter(o => !o.is_alteration || o.alteration_location === "Warehouse").length,
      unfulfilled: validOrders.filter(o => {
        const status = o.status?.toLowerCase();
        return status !== "completed" &&
          status !== "delivered" &&
          status !== "cancelled" &&
          (!o.is_alteration || o.alteration_location === "Warehouse");
      }).length,
      completed: validOrders.filter(o => {
        const status = o.status?.toLowerCase();
        return (status === "completed" || status === "delivered") &&
          (!o.is_alteration || o.alteration_location === "Warehouse");
      }).length,
      cancelled: validOrders.filter(o => {
        const status = o.status?.toLowerCase();
        return status === "cancelled" &&
          (!o.is_alteration || o.alteration_location === "Warehouse");
      }).length,
      alteration: validOrders.filter(o => o.is_alteration && o.alteration_location === "Warehouse").length,
    };
  }, [orders]);

  // Applied filters for chips
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
    if (filters.salesperson) {
      chips.push({ type: "salesperson", label: filters.salesperson });
    }
    return chips;
  }, [filters]);

  // Remove a filter
  const removeFilter = (type, value) => {
    if (type === "date") {
      setFilters(prev => ({ ...prev, dateFrom: "", dateTo: "" }));
    } else if (type === "price") {
      setFilters(prev => ({ ...prev, minPrice: 0, maxPrice: 500000 }));
    } else if (type === "salesperson") {
      setFilters(prev => ({ ...prev, salesperson: "" }));
    } else {
      setFilters(prev => ({ ...prev, [type]: prev[type].filter(v => v !== value) }));
    }
  };

  // Clear all filters
  const clearAllFilters = () => {
    setFilters({
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
  };

  // Toggle filter checkbox
  const toggleFilter = (category, value) => {
    setFilters(prev => ({
      ...prev,
      [category]: prev[category].includes(value)
        ? prev[category].filter(v => v !== value)
        : [...prev[category], value]
    }));
  };

  // Download all attachments
  const handleDownloadAttachments = async (e, order) => {
    e.stopPropagation();
    if (!order.attachments || order.attachments.length === 0) return;

    setAttachmentLoading(order.id);
    try {
      for (let i = 0; i < order.attachments.length; i++) {
        const url = order.attachments[i];
        const response = await fetch(url);
        const blob = await response.blob();

        const fileName = url.split("/").pop() || `attachment_${i + 1}`;
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${order.order_no}_${fileName}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        if (i < order.attachments.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    } catch (err) {
      console.error("Download failed:", err);
      showPopup({
        type: "error",
        title: "Download Failed",
        message: "Failed to download attachments",
        confirmText: "OK",
      });
    } finally {
      setAttachmentLoading(null);
    }
  };

  // Calendar ordersByDate
  const ordersByDate = useMemo(() => {
    return orders
      .filter(o => !isLxrtsOrder(o))
      .reduce((acc, order) => {
        if (!order.delivery_date) return acc;
        const warehouseDate = getWarehouseDateForCalendar(order.delivery_date, order.created_at);
        if (warehouseDate) {
          acc[warehouseDate] = (acc[warehouseDate] || 0) + 1;
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

  const updateAlterationStatus = async (orderId, newStatus) => {
    setStatusUpdating(orderId);
    try {
      const updateData = { status: newStatus };
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
        showPopup({ title: "Status update", message: "Failed to update status", type: "error", confirmText: "Ok" });
      }
    } catch (err) {
      console.error("Error updating status:", err);
    } finally {
      setStatusUpdating(null);
    }
  };

  const handleGeneratePdf = async (order) => {
    setPdfLoading(order.id);
    try {
      await downloadWarehousePdf(order, null, true);
      fetchOrders();
    } catch (error) {
      console.error("PDF generation failed:", error);
    } finally {
      setPdfLoading(null);
    }
  };

  const viewParentOrder = (parentOrderId) => {
    const parentOrder = orders.find(o => o.id === parentOrderId);
    if (parentOrder) {
      setSearchQuery(parentOrder.order_no);
      setStatusTab("all");
    }
  };

  // Pagination
  const totalPages = Math.ceil(filteredOrders.length / ordersPerPage);
  const startIndex = (currentPage - 1) * ordersPerPage;
  const currentOrders = filteredOrders.slice(startIndex, startIndex + ordersPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusTab, filters, sortBy]);

  const goToPage = (page) => setCurrentPage(page);
  const goToPrevious = () => { if (currentPage > 1) setCurrentPage(currentPage - 1); };
  const goToNext = () => { if (currentPage < totalPages) setCurrentPage(currentPage + 1); };

  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;
    if (totalPages <= maxVisible + 2) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      let start = Math.max(2, currentPage - 1);
      let end = Math.min(totalPages - 1, currentPage + 1);
      if (currentPage <= 3) end = Math.min(totalPages - 1, 4);
      if (currentPage >= totalPages - 2) start = Math.max(2, totalPages - 3);
      if (start > 2) pages.push('...');
      for (let i = start; i <= end; i++) pages.push(i);
      if (end < totalPages - 1) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  };

  const getAlterationTypeLabel = (type) => {
    const types = {
      fitting_tightening: "Fitting Issue (Tightening)",
      fitting_loosening: "Fitting Issue (Loosening)",
      length_issue: "Length Issue",
      fabric_issue: "Fabric Issue",
      other: "Other",
    };
    return types[type] || type || "-";
  };

  const getStatusColor = (status) => {
    const option = ALTERATION_STATUS_OPTIONS.find(o => o.value === status);
    return option?.color || "#666";
  };

  return (
    <div className="wd-dashboard-wrapper">
      {PopupComponent}

      {/* HEADER */}
      <div className="wd-top-header">
        <div className="wd-header-left">
          <img src={Logo} className="logo" alt="logo" />
        </div>
        <h1 className="wd-title">Warehouse Dashboard</h1>
      </div>

      {/* MAIN LAYOUT */}
      <div className="wd-main-layout">
        {/* Hamburger */}
        <div className="wd-hamburger-icon" onClick={() => setShowSidebar(!showSidebar)}>
          <div className="wd-bar"></div>
          <div className="wd-bar"></div>
          <div className="wd-bar"></div>
        </div>

        {/* SIDEBAR */}
        <aside className={`wd-sidebar ${showSidebar ? "wd-open" : ""}`}>
          <nav className="wd-menu">
            <a className={`wd-menu-item ${activeTab === "orders" ? "active" : ""}`}
              onClick={() => { setActiveTab("orders"); setShowSidebar(false); }}>
              Order History
            </a>
            <a className={`wd-menu-item ${activeTab === "calendar" ? "active" : ""}`}
              onClick={() => { setActiveTab("calendar"); setShowSidebar(false); }}>
              Calendar
            </a>
            <a className="wd-menu-item" onClick={handleLogout}>Log Out</a>
          </nav>
        </aside>

        {/* CONTENT AREA */}
        <div className="wd-content-area">
          {activeTab === "orders" && (
            <div className="wd-orders-section">
              {/* Header */}
              <div className="wd-orders-header">
                <h2 className="wd-section-title">Order History</h2>
                <span className="wd-orders-count">{filteredOrders.length} Orders</span>
              </div>

              {/* Search & Sort Bar */}
              <div className="wd-search-sort-bar">
                <div className="wd-search-wrapper">
                  <span className="wd-search-icon">&#128269;</span>
                  <input
                    type="text"
                    placeholder="Search Order #, Customer, Product..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="wd-search-input"
                  />
                  {searchQuery && (
                    <button className="wd-search-clear" onClick={() => setSearchQuery("")}>x</button>
                  )}
                </div>
                <div className="wd-sort-export">
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="wd-sort-select">
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                    <option value="delivery">Delivery Date</option>
                    <option value="amount_high">Amount: High to Low</option>
                    <option value="amount_low">Amount: Low to High</option>
                  </select>
                </div>
              </div>

              {/* Status Tabs */}
              <div className="wd-status-tabs">
                {STATUS_TABS.map((tab) => (
                  <button
                    key={tab.value}
                    className={`wd-status-tab ${statusTab === tab.value ? "active" : ""}`}
                    onClick={() => setStatusTab(tab.value)}
                  >
                    {tab.label}
                    <span className="wd-tab-count">{tabCounts[tab.value]}</span>
                  </button>
                ))}
              </div>

              {/* Horizontal Filter Dropdowns */}
              <div className="wd-filter-dropdowns" ref={dropdownRef}>
                {/* Date Filter */}
                <div className="wd-filter-dropdown">
                  <button
                    className={`wd-filter-btn ${(filters.dateFrom || filters.dateTo) ? "active" : ""}`}
                    onClick={() => setOpenDropdown(openDropdown === "date" ? null : "date")}
                  >
                    Date Range
                    <span className="wd-dropdown-arrow">&#9662;</span>
                  </button>
                  {openDropdown === "date" && (
                    <div className="wd-dropdown-panel">
                      <div className="wd-dropdown-title">Select Date Range</div>
                      <div className="wd-date-inputs">
                        <input
                          type="date"
                          value={filters.dateFrom}
                          onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
                        />
                        <span>to</span>
                        <input
                          type="date"
                          value={filters.dateTo}
                          onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value }))}
                        />
                      </div>
                      <button className="wd-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                    </div>
                  )}
                </div>

                {/* Price Filter */}
                <div className="wd-filter-dropdown">
                  <button
                    className={`wd-filter-btn ${(filters.minPrice > 0 || filters.maxPrice < 500000) ? "active" : ""}`}
                    onClick={() => setOpenDropdown(openDropdown === "price" ? null : "price")}
                  >
                    Price
                    <span className="wd-dropdown-arrow">&#9662;</span>
                  </button>
                  {openDropdown === "price" && (
                    <div className="wd-dropdown-panel wd-price-panel">
                      <div className="wd-dropdown-title">Order Value</div>
                      <div className="wd-price-slider-container">
                        <div className="wd-price-track">
                          <div
                            className="wd-price-track-filled"
                            style={{
                              left: `${(filters.minPrice / 500000) * 100}%`,
                              width: `${((filters.maxPrice - filters.minPrice) / 500000) * 100}%`
                            }}
                          />
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="500000"
                          step="5000"
                          value={filters.minPrice}
                          onChange={(e) => setFilters(prev => ({ ...prev, minPrice: Math.min(Number(e.target.value), prev.maxPrice - 5000) }))}
                          className="wd-price-slider wd-price-slider-min"
                        />
                        <input
                          type="range"
                          min="0"
                          max="500000"
                          step="5000"
                          value={filters.maxPrice}
                          onChange={(e) => setFilters(prev => ({ ...prev, maxPrice: Math.max(Number(e.target.value), prev.minPrice + 5000) }))}
                          className="wd-price-slider wd-price-slider-max"
                        />
                      </div>
                      <div className="wd-price-labels">
                        <span>Rs.0</span>
                        <span>Rs.5,00,000</span>
                      </div>
                      <div className="wd-price-inputs">
                        <div className="wd-price-input-wrap">
                          <span>Rs.</span>
                          <input
                            type="number"
                            value={filters.minPrice}
                            onChange={(e) => setFilters(prev => ({ ...prev, minPrice: Math.min(Number(e.target.value), prev.maxPrice - 5000) }))}
                          />
                        </div>
                        <span>to</span>
                        <div className="wd-price-input-wrap">
                          <span>Rs.</span>
                          <input
                            type="number"
                            value={filters.maxPrice}
                            onChange={(e) => setFilters(prev => ({ ...prev, maxPrice: Math.max(Number(e.target.value), prev.minPrice + 5000) }))}
                          />
                        </div>
                      </div>
                      <button className="wd-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                    </div>
                  )}
                </div>

                {/* Payment Filter */}
                <div className="wd-filter-dropdown">
                  <button
                    className={`wd-filter-btn ${filters.payment.length > 0 ? "active" : ""}`}
                    onClick={() => setOpenDropdown(openDropdown === "payment" ? null : "payment")}
                  >
                    Payment
                    <span className="wd-dropdown-arrow">&#9662;</span>
                  </button>
                  {openDropdown === "payment" && (
                    <div className="wd-dropdown-panel">
                      <div className="wd-dropdown-title">Payment Status</div>
                      {["paid", "partial", "unpaid"].map(opt => (
                        <label key={opt} className="wd-checkbox-label">
                          <input
                            type="checkbox"
                            checked={filters.payment.includes(opt)}
                            onChange={() => toggleFilter("payment", opt)}
                          />
                          <span>{opt === "unpaid" ? "Unpaid (COD)" : opt.charAt(0).toUpperCase() + opt.slice(1)}</span>
                        </label>
                      ))}
                      <button className="wd-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                    </div>
                  )}
                </div>

                {/* Priority Filter */}
                <div className="wd-filter-dropdown">
                  <button
                    className={`wd-filter-btn ${filters.priority.length > 0 ? "active" : ""}`}
                    onClick={() => setOpenDropdown(openDropdown === "priority" ? null : "priority")}
                  >
                    Priority
                    <span className="wd-dropdown-arrow">&#9662;</span>
                  </button>
                  {openDropdown === "priority" && (
                    <div className="wd-dropdown-panel">
                      <div className="wd-dropdown-title">Priority</div>
                      {["normal", "urgent"].map(opt => (
                        <label key={opt} className="wd-checkbox-label">
                          <input
                            type="checkbox"
                            checked={filters.priority.includes(opt)}
                            onChange={() => toggleFilter("priority", opt)}
                          />
                          <span>{opt.charAt(0).toUpperCase() + opt.slice(1)}</span>
                        </label>
                      ))}
                      <button className="wd-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                    </div>
                  )}
                </div>

                {/* Order Type Filter */}
                <div className="wd-filter-dropdown">
                  <button
                    className={`wd-filter-btn ${filters.orderType.length > 0 ? "active" : ""}`}
                    onClick={() => setOpenDropdown(openDropdown === "orderType" ? null : "orderType")}
                  >
                    Order Type
                    <span className="wd-dropdown-arrow">&#9662;</span>
                  </button>
                  {openDropdown === "orderType" && (
                    <div className="wd-dropdown-panel">
                      <div className="wd-dropdown-title">Order Type</div>
                      {["standard", "custom", "alteration"].map(opt => (
                        <label key={opt} className="wd-checkbox-label">
                          <input
                            type="checkbox"
                            checked={filters.orderType.includes(opt)}
                            onChange={() => toggleFilter("orderType", opt)}
                          />
                          <span>{opt.charAt(0).toUpperCase() + opt.slice(1)}</span>
                        </label>
                      ))}
                      <button className="wd-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                    </div>
                  )}
                </div>

                {/* Store Filter */}
                <div className="wd-filter-dropdown">
                  <button
                    className={`wd-filter-btn ${filters.store.length > 0 ? "active" : ""}`}
                    onClick={() => setOpenDropdown(openDropdown === "store" ? null : "store")}
                  >
                    Store
                    <span className="wd-dropdown-arrow">&#9662;</span>
                  </button>
                  {openDropdown === "store" && (
                    <div className="wd-dropdown-panel">
                      <div className="wd-dropdown-title">Store</div>
                      {["Delhi Store", "Ludhiana Store"].map(opt => (
                        <label key={opt} className="wd-checkbox-label">
                          <input
                            type="checkbox"
                            checked={filters.store.includes(opt)}
                            onChange={() => toggleFilter("store", opt)}
                          />
                          <span>{opt}</span>
                        </label>
                      ))}
                      <button className="wd-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                    </div>
                  )}
                </div>

                {/* Salesperson Filter */}
                <div className="wd-filter-dropdown">
                  <button
                    className={`wd-filter-btn ${filters.salesperson ? "active" : ""}`}
                    onClick={() => setOpenDropdown(openDropdown === "salesperson" ? null : "salesperson")}
                  >
                    Salesperson
                    <span className="wd-dropdown-arrow">&#9662;</span>
                  </button>
                  {openDropdown === "salesperson" && (
                    <div className="wd-dropdown-panel">
                      <div className="wd-dropdown-title">Salesperson</div>
                      <select
                        value={filters.salesperson}
                        onChange={(e) => setFilters(prev => ({ ...prev, salesperson: e.target.value }))}
                        className="wd-sp-select"
                      >
                        <option value="">All Salespersons</option>
                        {salespersons.map(sp => (
                          <option key={sp} value={sp}>{sp}</option>
                        ))}
                      </select>
                      <button className="wd-dropdown-apply" onClick={() => setOpenDropdown(null)}>Apply</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Applied Filter Chips */}
              {appliedFilters.length > 0 && (
                <div className="wd-applied-filters">
                  <span className="wd-applied-label">Applied:</span>
                  {appliedFilters.map((chip, i) => (
                    <span key={i} className="wd-filter-chip">
                      {chip.label}
                      <button onClick={() => removeFilter(chip.type, chip.value)}>x</button>
                    </span>
                  ))}
                  <button className="wd-clear-all" onClick={clearAllFilters}>Clear All</button>
                </div>
              )}

              {/* Orders List - OLD DESIGN */}
              <div className="wd-orders-scroll-container">
                {loading ? (
                  <p className="wd-loading-text">Loading orders...</p>
                ) : filteredOrders.length === 0 ? (
                  <p className="wd-no-orders">No orders found.</p>
                ) : (
                  currentOrders.map((order) => {
                    const firstItem = Array.isArray(order.items) ? order.items[0] || {} : order.items || {};
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
                              {isAlteration ? "Alteration Order" : "Product Details"}
                            </h3>

                            {isAlteration && (
                              <span className="wd-badge wd-badge-alteration">
                                ALTERATION
                              </span>
                            )}

                            {isUrgent && (
                              <span className="wd-badge wd-badge-urgent">
                                URGENT
                              </span>
                            )}

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
                            {order.attachments && order.attachments.length > 0 && (
                              <button
                                className="ad-attachments-btn"
                                onClick={(e) => handleDownloadAttachments(e, order)}
                                disabled={attachmentLoading === order.id}
                                title={`Download ${order.attachments.length} attachment(s)`}
                              >
                                {attachmentLoading === order.id ? "..." : `📎 Attachments`}
                              </button>
                            )}
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
                              View Parent Order
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
                                <span className="wd-alt-value">{order.alteration_location || "-"}</span>
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

                            {order.alteration_notes && (
                              <div className="wd-alteration-notes">
                                <span className="wd-alt-label">Notes:</span>
                                <p className="wd-alt-notes-text">{order.alteration_notes}</p>
                              </div>
                            )}

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
                              <p><strong className="wd-label">SA Name:</strong> {order.salesperson_name || order.salesperson || "-"}</p>
                            </div>

                            <div style={{ display: "flex", alignItems: 'center', gap: 70 }}>
                              <div style={{ display: "flex", alignItems: 'center', gap: 10 }}>
                                <p><strong className="wd-label">Top:</strong> {firstItem.top || "-"} </p>
                                {firstItem.top_color?.hex && (
                                  <>
                                    <p style={{ backgroundColor: firstItem.top_color.hex, width: 20, height: 20 }}></p>
                                    <p>{firstItem.top_color?.name}</p>
                                  </>
                                )}
                              </div>
                              <div style={{ display: "flex", alignItems: 'center', gap: 10 }}>
                                <p><strong className="wd-label">Bottom:</strong> {firstItem.bottom || "-"}</p>
                                {firstItem.bottom_color?.hex && (
                                  <>
                                    <p style={{ backgroundColor: firstItem.bottom_color.hex, width: 20, height: 20 }}></p>
                                    <p>{firstItem.bottom_color?.name}</p>
                                  </>
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
                              <p><strong className="wd-label">Delivery Date:</strong> {getWarehouseDate(order.delivery_date, order.created_at)}</p>
                            </div>

                            {/* Status Button - Different for alterations vs regular orders */}
                            {!isAlteration && (
                              <button
                                className={`wd-complete-btn ${order.status === "cancelled" ? "wd-cancelled-btn" : ""} `}
                                disabled={
                                  order.status === "completed" ||
                                  order.status === "delivered" ||
                                  order.status === "cancelled"
                                }
                                onClick={() => markAsCompleted(order.id)}
                              >
                                {order.status === "completed" ? "Completed" :
                                  order.status === "delivered" ? "Delivered" :
                                    order.status === "cancelled" ? "Cancelled" :
                                      "Mark as Completed"}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Pagination */}
              {!loading && filteredOrders.length > ordersPerPage && (
                <div className="wd-pagination">
                  <button className="wd-pagination-btn" onClick={goToPrevious} disabled={currentPage === 1}>
                    Prev
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
                  <button className="wd-pagination-btn" onClick={goToNext} disabled={currentPage === totalPages}>
                    Next
                  </button>
                </div>
              )}
            </div>
          )}

          {/* CALENDAR TAB */}
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
                    &#8249;
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
                    &#8250;
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
                          {orderCount > 0 && <span className="wd-ios-order-count">{orderCount}</span>}
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
                      Orders for {selectedCalendarDate} ({orders.filter(o => getWarehouseDateForCalendar(o.delivery_date, o.created_at) === selectedCalendarDate).length})
                    </span>
                  </div>
                  <div className="wd-calendar-orders-list">
                    {orders.filter(o => getWarehouseDateForCalendar(o.delivery_date, o.created_at) === selectedCalendarDate).length === 0 ? (
                      <p className="wd-no-orders">No orders scheduled for this date</p>
                    ) : (
                      orders
                        .filter(o => getWarehouseDateForCalendar(o.delivery_date, o.created_at) === selectedCalendarDate)
                        .map((order) => (
                          <div className="wd-calendar-order-item" key={order.id}>
                            <p><b>Order No:</b> {order.order_no}</p>
                            <p><b>Client Name:</b> {order.delivery_name}</p>
                            <p><b>Status:</b> {order.status || "Pending"}</p>
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

      {/* Image Viewer Modal */}
      {viewingImages && (
        <div className="wd-image-modal" onClick={() => setViewingImages(null)}>
          <div className="wd-image-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="wd-image-close" onClick={() => setViewingImages(null)}>x</button>
            <img src={viewingImages[currentImageIndex]} alt="Attachment" className="wd-image-full" />
            {viewingImages.length > 1 && (
              <div className="wd-image-nav">
                <button onClick={() => setCurrentImageIndex((prev) => (prev - 1 + viewingImages.length) % viewingImages.length)}>
                  &#8592;
                </button>
                <span>{currentImageIndex + 1} / {viewingImages.length}</span>
                <button onClick={() => setCurrentImageIndex((prev) => (prev + 1) % viewingImages.length)}>
                  &#8594;
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