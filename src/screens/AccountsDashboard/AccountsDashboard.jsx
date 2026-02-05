import React, { useEffect, useState, useMemo } from "react";
import "./AccountsDashboard.css";
import { supabase } from "../../lib/supabaseClient";
import { useNavigate } from "react-router-dom";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";

export default function AccountsDashboard() {
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // Fetch all orders
  useEffect(() => {
    const fetchOrders = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("orders")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) throw error;
        setOrders(data || []);
      } catch (err) {
        console.error("Error fetching orders:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, []);

  // Flatten orders into line items (products + extras as separate rows)
  const lineItems = useMemo(() => {
    const items = [];

    orders.forEach((order) => {
      const orderItems = order.items || [];

      orderItems.forEach((item, itemIndex) => {
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
          id: `${order.id}-product-${itemIndex}`,
          order_id: order.id,
          order_no: order.order_no,
          order_date: order.created_at,
          sa_name: order.salesperson || "—",
          client_name: order.delivery_name || "—",
          address: order.delivery_address || "—",
          city: order.delivery_city || "—",
          state: order.delivery_state || "—",
          pincode: order.delivery_pincode || "—",
          product_name: item.product_name || "—",
          gross_value: Math.round(grossValue * 100) / 100,
          discount: Math.round(productDiscount * 100) / 100,
          taxable_value: Math.round(taxableValue * 100) / 100,
          gst: Math.round(gst * 100) / 100,
          invoice_value: Math.round(invoiceValue * 100) / 100,
          shipping_charges: itemIndex === 0 ? (order.shipping_charge || 0) : 0,
          cod_charges: itemIndex === 0 ? (order.cod_charge || 0) : 0,
          quantity: quantity,
          status: order.status || "pending",
          delivery_date: item.delivery_date || order.delivery_date,
          reason: order.cancellation_reason || order.exchange_reason || "—",
          type: "product",
        });

        const extras = item.extras || [];
        extras.forEach((extra, extraIndex) => {
          const extraPrice = extra.price || 0;
          const extraGross = extraPrice * quantity;
          const extraDiscount = orderDiscount > 0 ? extraGross * discountRatio : 0;
          const extraTaxable = extraGross - extraDiscount;
          const extraGst = extraTaxable * gstRate;
          const extraInvoice = extraTaxable + extraGst;

          items.push({
            id: `${order.id}-extra-${itemIndex}-${extraIndex}`,
            order_id: order.id,
            order_no: order.order_no,
            order_date: order.created_at,
            sa_name: order.salesperson || "—",
            client_name: order.delivery_name || "—",
            address: order.delivery_address || "—",
            city: order.delivery_city || "—",
            state: order.delivery_state || "—",
            pincode: order.delivery_pincode || "—",
            product_name: `↳ Extra: ${extra.name || "Unknown"}`,
            gross_value: Math.round(extraGross * 100) / 100,
            discount: Math.round(extraDiscount * 100) / 100,
            taxable_value: Math.round(extraTaxable * 100) / 100,
            gst: Math.round(extraGst * 100) / 100,
            invoice_value: Math.round(extraInvoice * 100) / 100,
            shipping_charges: 0,
            cod_charges: 0,
            quantity: quantity,
            status: order.status || "pending",
            delivery_date: item.delivery_date || order.delivery_date,
            reason: order.cancellation_reason || order.exchange_reason || "—",
            type: "extra",
          });
        });
      });
    });

    return items;
  }, [orders]);

  // Filter line items
  const filteredItems = useMemo(() => {
    let filtered = lineItems;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.order_no?.toLowerCase().includes(query) ||
          item.sa_name?.toLowerCase().includes(query) ||
          item.client_name?.toLowerCase().includes(query) ||
          item.product_name?.toLowerCase().includes(query) ||
          item.city?.toLowerCase().includes(query)
      );
    }

    if (dateFrom) {
      filtered = filtered.filter(
        (item) => new Date(item.order_date) >= new Date(dateFrom)
      );
    }
    if (dateTo) {
      filtered = filtered.filter(
        (item) => new Date(item.order_date) <= new Date(dateTo + "T23:59:59")
      );
    }

    if (statusFilter) {
      filtered = filtered.filter((item) => item.status === statusFilter);
    }

    return filtered;
  }, [lineItems, searchQuery, dateFrom, dateTo, statusFilter]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredItems.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentItems = filteredItems.slice(startIndex, endIndex);

  const goToPage = (page) => setCurrentPage(page);
  const goToPrevious = () => setCurrentPage((prev) => Math.max(prev - 1, 1));
  const goToNext = () => setCurrentPage((prev) => Math.min(prev + 1, totalPages));

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, dateFrom, dateTo, statusFilter]);

  // Page numbers for pagination
  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;
    
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) pages.push(i);
        pages.push("...");
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push("...");
        for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1);
        pages.push("...");
        for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i);
        pages.push("...");
        pages.push(totalPages);
      }
    }
    return pages;
  };

  // Calculate totals
  const totals = useMemo(() => {
    const raw = filteredItems.reduce(
      (acc, item) => ({
        gross_value: acc.gross_value + item.gross_value,
        discount: acc.discount + item.discount,
        taxable_value: acc.taxable_value + item.taxable_value,
        gst: acc.gst + item.gst,
        invoice_value: acc.invoice_value + item.invoice_value,
        shipping_charges: acc.shipping_charges + item.shipping_charges,
        cod_charges: acc.cod_charges + item.cod_charges,
        quantity: acc.quantity + item.quantity,
      }),
      {
        gross_value: 0,
        discount: 0,
        taxable_value: 0,
        gst: 0,
        invoice_value: 0,
        shipping_charges: 0,
        cod_charges: 0,
        quantity: 0,
      }
    );
    
    // Round all values to 2 decimal places
    return {
      gross_value: Math.round(raw.gross_value * 100) / 100,
      discount: Math.round(raw.discount * 100) / 100,
      taxable_value: Math.round(raw.taxable_value * 100) / 100,
      gst: Math.round(raw.gst * 100) / 100,
      invoice_value: Math.round(raw.invoice_value * 100) / 100,
      shipping_charges: Math.round(raw.shipping_charges * 100) / 100,
      cod_charges: Math.round(raw.cod_charges * 100) / 100,
      quantity: raw.quantity,
    };
  }, [filteredItems]);

  // Export to CSV
  const exportToCSV = () => {
    const headers = [
      "SA Name",
      "Order ID",
      "Order Date",
      "Client Name",
      "Address",
      "City",
      "State",
      "Pincode",
      "Product Name",
      "Gross Value",
      "Discount",
      "Taxable Value",
      "GST",
      "Invoice Value",
      "Shipping Charges",
      "COD Charges",
      "Quantity",
      "Status",
      "Delivery Date",
      "Reason",
    ];

    const rows = filteredItems.map((item) => [
      item.sa_name,
      item.order_no,
      formatDate(item.order_date),
      item.client_name,
      item.address,
      item.city,
      item.state,
      item.pincode,
      item.product_name,
      item.gross_value.toFixed(2),
      item.discount.toFixed(2),
      item.taxable_value.toFixed(2),
      item.gst.toFixed(2),
      item.invoice_value.toFixed(2),
      item.shipping_charges.toFixed(2),
      item.cod_charges.toFixed(2),
      item.quantity,
      item.status,
      formatDate(item.delivery_date),
      item.reason,
    ]);

    const csvContent =
      [headers.join(","), ...rows.map((row) => row.map((cell) => `"${cell}"`).join(","))].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `accounts_report_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  };

  const getStatusClass = (status) => {
    switch (status?.toLowerCase()) {
      case "delivered":
        return "acc-status-delivered";
      case "cancelled":
        return "acc-status-cancelled";
      case "exchange_return":
        return "acc-status-exchange";
      default:
        return "acc-status-active";
    }
  };

  const handleBack = () => {
    navigate("/login", { replace: true });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  if (loading) {
    return (
      <div className="acc-loading">
        <div className="acc-spinner"></div>
        <p>Loading accounts data...</p>
      </div>
    );
  }

  return (
    <div className="acc-page">
      {/* Header */}
      <header className="acc-header">
        <div className="acc-header-left">
          <img
            src={Logo}
            alt="logo"
            className="acc-logo"
            onClick={() => navigate("/login")}
          />
        </div>
        <h1 className="acc-title">Accounts Dashboard</h1>
        <div className="acc-header-right">
          <button className="acc-logout-btn" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="acc-content">
        {/* Stats Cards */}
        <div className="acc-stats-grid">
          <div className="acc-stat-card">
            <div className="acc-stat-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                <rect width="8" height="4" x="8" y="2" rx="1" ry="1"/>
              </svg>
            </div>
            <div className="acc-stat-info">
              <span className="acc-stat-value">{filteredItems.length}</span>
              <span className="acc-stat-label">Total Records</span>
            </div>
          </div>
          <div className="acc-stat-card gross">
            <div className="acc-stat-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" x2="12" y1="2" y2="22"/>
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
            </div>
            <div className="acc-stat-info">
              <span className="acc-stat-value">₹{formatIndianNumber(totals.gross_value)}</span>
              <span className="acc-stat-label">Gross Value</span>
            </div>
          </div>
          <div className="acc-stat-card discount">
            <div className="acc-stat-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 5 5 19"/>
                <circle cx="6.5" cy="6.5" r="2.5"/>
                <circle cx="17.5" cy="17.5" r="2.5"/>
              </svg>
            </div>
            <div className="acc-stat-info">
              <span className="acc-stat-value">₹{formatIndianNumber(totals.discount)}</span>
              <span className="acc-stat-label">Total Discount</span>
            </div>
          </div>
          <div className="acc-stat-card invoice">
            <div className="acc-stat-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/>
                <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/>
                <path d="M12 17.5v-11"/>
              </svg>
            </div>
            <div className="acc-stat-info">
              <span className="acc-stat-value">₹{formatIndianNumber(totals.invoice_value)}</span>
              <span className="acc-stat-label">Invoice Value</span>
            </div>
          </div>
        </div>

        {/* Filters & Search */}
        <div className="acc-toolbar">
          <div className="acc-search-wrapper">
            <span className="acc-search-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.3-4.3"/>
              </svg>
            </span>
            <input
              type="text"
              placeholder="Search by Order ID, SA, Client, Product..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="acc-search-input"
            />
            {searchQuery && (
              <button
                className="acc-search-clear"
                onClick={() => setSearchQuery("")}
              >
                ✕
              </button>
            )}
          </div>

          <div className="acc-filters">
            <div className="acc-filter-item">
              <label>From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="acc-filter-item">
              <label>To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div className="acc-filter-item">
              <label>Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="delivered">Delivered</option>
                <option value="cancelled">Cancelled</option>
                <option value="exchange_return">Exchange/Return</option>
              </select>
            </div>
            <button className="acc-export-btn" onClick={exportToCSV}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" x2="12" y1="15" y2="3"/>
              </svg>
              Export CSV
            </button>
          </div>
        </div>

        {/* Showing Info */}
        <div className="acc-showing-info">
          Showing {filteredItems.length > 0 ? startIndex + 1 : 0}-
          {Math.min(endIndex, filteredItems.length)} of {filteredItems.length} records
        </div>

        {/* Table */}
        <div className="acc-table-container">
          <table className="acc-table">
            <thead>
              <tr>
                <th>SA Name</th>
                <th>Order ID</th>
                <th>Order Date</th>
                <th>Client Name</th>
                <th>Address</th>
                <th>City</th>
                <th>State</th>
                <th>Pincode</th>
                <th>Product Name</th>
                <th>Gross</th>
                <th>Discount</th>
                <th>Taxable</th>
                <th>GST</th>
                <th>Invoice</th>
                <th>Shipping</th>
                <th>COD</th>
                <th>Qty</th>
                <th>Status</th>
                <th>Delivery Date</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {currentItems.length === 0 ? (
                <tr>
                  <td colSpan="20" className="acc-no-data">
                    {searchQuery || dateFrom || dateTo || statusFilter
                      ? "No records match your filters"
                      : "No records found"}
                  </td>
                </tr>
              ) : (
                currentItems.map((item) => (
                  <tr
                    key={item.id}
                    className={item.type === "extra" ? "acc-extra-row" : ""}
                  >
                    <td>{item.sa_name}</td>
                    <td><span className="acc-order-id">{item.order_no}</span></td>
                    <td>{formatDate(item.order_date)}</td>
                    <td>{item.client_name}</td>
                    <td className="acc-address-cell" title={item.address}>{item.address}</td>
                    <td>{item.city}</td>
                    <td>{item.state}</td>
                    <td>{item.pincode}</td>
                    <td className="acc-product-cell" title={item.product_name}>{item.product_name}</td>
                    <td className="acc-amount">₹{formatIndianNumber(item.gross_value)}</td>
                    <td className="acc-amount">₹{formatIndianNumber(item.discount)}</td>
                    <td className="acc-amount">₹{formatIndianNumber(item.taxable_value)}</td>
                    <td className="acc-amount">₹{formatIndianNumber(item.gst)}</td>
                    <td className="acc-amount acc-invoice">₹{formatIndianNumber(item.invoice_value)}</td>
                    <td className="acc-amount">₹{formatIndianNumber(item.shipping_charges)}</td>
                    <td className="acc-amount">₹{formatIndianNumber(item.cod_charges)}</td>
                    <td className="acc-qty">{item.quantity}</td>
                    <td>
                      <span className={`acc-status ${getStatusClass(item.status)}`}>
                        {item.status}
                      </span>
                    </td>
                    <td>{formatDate(item.delivery_date)}</td>
                    <td className="acc-reason-cell" title={item.reason}>{item.reason}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="acc-totals-row">
                <td colSpan="9"><strong>TOTALS</strong></td>
                <td className="acc-amount"><strong>₹{formatIndianNumber(totals.gross_value)}</strong></td>
                <td className="acc-amount"><strong>₹{formatIndianNumber(totals.discount)}</strong></td>
                <td className="acc-amount"><strong>₹{formatIndianNumber(totals.taxable_value)}</strong></td>
                <td className="acc-amount"><strong>₹{formatIndianNumber(totals.gst)}</strong></td>
                <td className="acc-amount"><strong>₹{formatIndianNumber(totals.invoice_value)}</strong></td>
                <td className="acc-amount"><strong>₹{formatIndianNumber(totals.shipping_charges)}</strong></td>
                <td className="acc-amount"><strong>₹{formatIndianNumber(totals.cod_charges)}</strong></td>
                <td className="acc-qty"><strong>{totals.quantity}</strong></td>
                <td colSpan="3"></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="acc-pagination">
            <button
              className="acc-page-btn nav"
              onClick={goToPrevious}
              disabled={currentPage === 1}
            >
              ← Prev
            </button>

            <div className="acc-page-numbers">
              {getPageNumbers().map((page, index) =>
                page === "..." ? (
                  <span key={`dots-${index}`} className="acc-page-dots">
                    ...
                  </span>
                ) : (
                  <button
                    key={page}
                    className={`acc-page-btn ${currentPage === page ? "active" : ""}`}
                    onClick={() => goToPage(page)}
                  >
                    {page}
                  </button>
                )
              )}
            </div>

            <button
              className="acc-page-btn nav"
              onClick={goToNext}
              disabled={currentPage === totalPages}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Back Button */}
      <button className="acc-back-btn" onClick={handleBack}>
        ←
      </button>
    </div>
  );
}