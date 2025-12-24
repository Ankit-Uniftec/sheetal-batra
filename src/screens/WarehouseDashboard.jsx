import React, { useEffect, useState } from "react";
import "./WarehouseDashboard.css";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Logo from "../images/logo.png";
import formatDate from "../utils/formatDate";

const WarehouseDashboard = () => {
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("orders");
  const [showSidebar, setShowSidebar] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const ordersPerPage = 5;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

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

  const markAsCompleted = async (orderId) => {
    const { error } = await supabase
      .from("orders")
      .update({ status: "completed" })
      .eq("id", orderId);

    if (!error) fetchOrders();
  };

  // Pagination logic
  const totalPages = Math.ceil(orders.length / ordersPerPage);
  const startIndex = (currentPage - 1) * ordersPerPage;
  const endIndex = startIndex + ordersPerPage;
  const currentOrders = orders.slice(startIndex, endIndex);

  const goToPage = (page) => {
    setCurrentPage(page);
  };

  const goToPrevious = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  const goToNext = () => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  };

  return (
    <div className="wd-dashboard-wrapper">
      {/* HEADER - UNCHANGED */}
      <div className="wd-top-header">
        <div className="wd-header-left">
          <img src={Logo} className="logo" alt="logo" />
        </div>

        <h1 className="wd-title">Warehouse Dashboard</h1>

        {/* Logout for desktop */}
        {/* <button className="wd-logout-btn wd-desktop-only" onClick={handleLogout}>↪</button> */}

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

            <a className="wd-menu-item" onClick={handleLogout}>
              Log Out
            </a>
          </nav>
        </aside>

        {/* CONTENT AREA */}
        <div className="wd-content-area">
          {/* ORDER HISTORY TAB */}
          {activeTab === "orders" && (
            <div className="wd-orders-section">
              {/* Header with count */}
              <div className="wd-orders-header">
                <h2 className="wd-section-title">Order History</h2>
                <span className="wd-orders-count">{orders.length} Orders</span>
              </div>

              {/* Scrollable Orders Container */}
              <div className="wd-orders-scroll-container">
                {loading ? (
                  <p className="wd-loading-text">Loading orders...</p>
                ) : orders.length === 0 ? (
                  <p className="wd-no-orders">No orders found.</p>
                ) : (
                  currentOrders.map((order) => {
                    const firstItem = Array.isArray(order.items)
                      ? order.items[0] || {}
                      : order.items || {};

                    return (
                      <div className="wd-order-dropdown">
                        <div style={{ display: "flex", justifyContent: 'space-between', alignItems:'center' }}>
                          <h3 className="wd-dropdown-title">Product Details</h3>
                          <div>
                            
                            <a href={order.warehouse_url} target="new">
                          <button className="wd-pdf-Btn">Generate PDF</button></a>
                          </div>
                        </div>
                        <div className="wd-dropdown-content">
                          {/* IMAGE — you currently do NOT send image, so hiding */}
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
                             <p><strong className="wd-label">Order Id:</strong> {order.id}</p>
                            <p><strong className="wd-label">Product Name:</strong> {firstItem.product_name}</p>
                            {/* <p><strong>Color:</strong> {firstItem.color.name}</p> */}
                            <div style={{ display: "flex", alignItems: 'center', gap: 70 }}>
                              <div style={{ display: "flex", alignItems: 'center', gap: 10 }}>
                                <p><strong className="wd-label">Top:</strong> {firstItem.top || "-"} </p>
                                <p style={{ backgroundColor: firstItem.top_color.hex, width: 20, height: 20 }}></p>
                              </div>
                              <div style={{ display: "flex", alignItems: 'center', gap: 10 }}>
                                <p><strong className="wd-label">Bottom:</strong> {firstItem.bottom || "-"}</p>
                                <p style={{ backgroundColor: firstItem.bottom_color.hex, width: 20, height: 20 }}></p>
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
                              <p><strong className="wd-label">Delivery Date:</strong> {formatDate(order.delivery_date)}</p>
                            </div>

                            <button
                              className="wd-complete-btn"
                              disabled={order.status === "completed"}
                              onClick={() => markAsCompleted(order.id)}
                            >
                              {order.status === "completed" ? "Completed ✔" : "Mark as Completed"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Pagination Controls */}
              {!loading && orders.length > ordersPerPage && (
                <div className="wd-pagination">
                  <button
                    className="wd-pagination-btn"
                    onClick={goToPrevious}
                    disabled={currentPage === 1}
                  >
                    ← Prev
                  </button>

                  <div className="wd-pagination-pages">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                      (page) => (
                        <button
                          key={page}
                          className={`wd-pagination-page ${currentPage === page ? "active" : ""
                            }`}
                          onClick={() => goToPage(page)}
                        >
                          {page}
                        </button>
                      )
                    )}
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
        </div>
      </div>
    </div>
  );
};

export default WarehouseDashboard;