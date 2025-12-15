
import React, { useEffect, useState } from "react";
import "./WarehouseDashboard.css";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Logo from "../images/logo.png";
const WarehouseDashboard = () => {
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  // Format measurements safely
  const renderMeasurements = (m) => {
    if (!m || typeof m !== "object") {
      return <span>-</span>;
    }

    return Object.entries(m).map(([key, value]) => {
      // CASE 1: value is a nested object (Blouse, Salwar, etc.)
      if (typeof value === "object" && value !== null) {
        return (
          <div key={key} className="measurement-group">
            <p className="measure-title"><strong>{key}</strong></p>
            <div className="measure-sub">
              {Object.entries(value).map(([subKey, subValue]) => (
                <p key={subKey} className="measure-line">
                  {subKey}: {subValue}
                </p>
              ))}
            </div>
          </div>
        );
      }

      // CASE 2: value is a primitive
      return (
        <p key={key} className="measure-line">
          {key}: {value}
        </p>
      );
    });
  };


  const fetchOrders = async () => {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error) {
      setOrders(data.map((o) => ({ ...o, open: false })));
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const toggleDropdown = (id) => {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === id ? { ...o, open: !o.open } : o
      )
    );
  };

  const markAsCompleted = async (orderId) => {
    const { error } = await supabase
      .from("orders")
      .update({ status: "completed" })
      .eq("id", orderId);

    if (!error) fetchOrders();
  };

  return (
    <div className="dashboard-wrapper">
      {/* HEADER */}
      <div className="top-header">
        <div className="header-left">
          <img src={Logo} className="logo" alt="logo" />
        </div>

        <h1 className="title">Warehouse Dashboard</h1>
        <button className="logout-btn" onClick={handleLogout}>↪</button>
      </div>

      {/* ORDERS */}
      <div className="orders-container">
        {loading ? (
          <p className="loading-text">Loading orders...</p>
        ) : orders.length === 0 ? (
          <p className="no-orders">No orders found.</p>
        ) : (
          orders.map((order) => {
            const firstItem = Array.isArray(order.items)
              ? order.items[0] || {}
              : order.items || {};

            return (
              <div className="order-wrapper" key={order.id}>

                {/* CLICKABLE BOX */}
                <div
                  className="order-box"
                  onClick={() => toggleDropdown(order.id)}
                >
                  {firstItem.product_name || "Product"}
                </div>

                {/* DROPDOWN */}
                {order.open && (
                  <div className="order-dropdown">
                    <h3 className="dropdown-title">Product Details</h3>

                    <div className="dropdown-content">

                      {/* IMAGE — you currently do NOT send image, so hiding */}
                      <div className="dropdown-img">
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
                          <div className="placeholder-img-box">
                            <span>No Image</span>
                          </div>
                        )}
                      </div>


                      <div className="dropdown-info">
                        <p><strong>Product Name:</strong> {firstItem.product_name}</p>
                        <p><strong>Color:</strong> {firstItem.color}</p>
                        <p><strong>Top:</strong> {firstItem.top || "-"}</p>
                        <p><strong>Bottom:</strong> {firstItem.bottom || "-"}</p>
                        <p><strong>Extras:</strong> {firstItem.extra || "-"}</p>
                        <p><strong>Size:</strong> {firstItem.size || "-"}</p>

                        <div className="measurement-block">
                          <strong>Measurements:</strong>
                          {renderMeasurements(firstItem.measurements)}
                        </div>

                        <button
                          className="complete-btn"
                          disabled={order.status === "completed"}
                          onClick={() => markAsCompleted(order.id)}
                        >
                          {order.status === "completed" ? "Completed ✔" : "Mark as Completed"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default WarehouseDashboard;
