import React, { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";
import "./EditOrder.css";

function ColorDotDisplay({ colorObject }) {
  if (!colorObject) return null;

  let displayColorName = "";
  let displayColorHex = "#000000";

  if (typeof colorObject === "string") {
    displayColorName = colorObject;
    displayColorHex = colorObject.startsWith("#") ? colorObject : "gray";
  } else if (typeof colorObject === "object" && colorObject !== null) {
    displayColorName = colorObject.name || "";
    displayColorHex = colorObject.hex || "";
  } else {
    return <span>Invalid Color</span>;
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <div
        style={{
          background: displayColorHex,
          height: "14px",
          width: "28px",
          borderRadius: "8px",
          border: "1px solid #ccc",
        }}
      />
      <span>{displayColorName}</span>
    </div>
  );
}

export default function EditOrder() {
  const navigate = useNavigate();
  const location = useLocation();
  const orderFromState = location.state?.order;

  const [order, setOrder] = useState(orderFromState);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [userRole, setUserRole] = useState(null); // 'SM' for Store Manager

  // Editable fields
  const [editedItems, setEditedItems] = useState([]);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryCity, setDeliveryCity] = useState("");
  const [deliveryState, setDeliveryState] = useState("");
  const [deliveryPincode, setDeliveryPincode] = useState("");
  const [modeOfDelivery, setModeOfDelivery] = useState("");

  // Cancellation / Exchange
  const [cancellationReason, setCancellationReason] = useState("");
  const [exchangeReason, setExchangeReason] = useState("");

  // Time calculations
  const orderCreatedAt = useMemo(() => new Date(order?.created_at), [order]);
  const now = new Date();
  const hoursSinceOrder = useMemo(() => {
    return (now - orderCreatedAt) / (1000 * 60 * 60);
  }, [orderCreatedAt, now]);

  const isWithin36Hours = hoursSinceOrder <= 36;
  const isWithin24Hours = hoursSinceOrder <= 24;
  const isAfterDeliveryDate = order?.delivery_date ? new Date() > new Date(order.delivery_date) : false;
  const isDelivered = order?.status?.toLowerCase() === "delivered";

  // Can edit only within 36 hours
  const canEdit = isWithin36Hours;

  // Can cancel within 24 hours OR after delivery date
  const canCancel = isWithin24Hours || isAfterDeliveryDate;

  // Can exchange/return only after delivery date or if delivered
  const canExchangeReturn = isAfterDeliveryDate || isDelivered;

  // Check if user is Store Manager (SM)
  const isSM = userRole === "SM";

  // Cancellation reasons based on time
  const cancellationOptions = useMemo(() => {
    const options = [];
    if (isWithin24Hours) {
      options.push(
        { value: "client_no_longer_wants", label: "Client No Longer Wants The Product" },
        { value: "wh_cannot_expedite", label: "WH Cannot Expedite Production" },
        { value: "new_order_placed", label: "New Order Placed" }
      );
    }
    if (isSM && hoursSinceOrder > 24 && !isAfterDeliveryDate) {
      options.push({ value: "store_credit_given", label: "Store Credit Given" });
    }
    if (isAfterDeliveryDate) {
      options.push(
        { value: "delayed_delivery", label: "Delayed Delivery" },
        { value: "incorrect_product", label: "Incorrect Product Delivered" },
        { value: "quality_failure", label: "Quality Failure" }
      );
    }
    return options;
  }, [isWithin24Hours, isAfterDeliveryDate, isSM, hoursSinceOrder]);

  // Exchange/Return reasons (only after delivery)
  const exchangeOptions = useMemo(() => {
    const options = [];
    if (isAfterDeliveryDate || isDelivered) {
      options.push(
        { value: "exchange_size", label: "Product Exchange (Size)" },
        { value: "exchange_other", label: "Product Exchange (Other)" },
        { value: "client_not_like_product", label: "Client Did Not Like Product" },
        { value: "client_not_like_quality", label: "Client Did Not Like Quality" }
      );
    }
    if (isSM && hoursSinceOrder > 24 && !isAfterDeliveryDate) {
      options.push({ value: "store_credit_given", label: "Store Credit Given" });
    }
    return options;
  }, [isAfterDeliveryDate, isDelivered, isSM, hoursSinceOrder]);

  // Load order data and user role
  useEffect(() => {
    if (!order) {
      navigate(-1);
      return;
    }

    // Initialize editable fields
    setEditedItems(order.items?.map(item => ({ ...item })) || []);
    setDeliveryDate(order.delivery_date?.slice(0, 10) || "");
    setDeliveryAddress(order.delivery_address || "");
    setDeliveryCity(order.delivery_city || "");
    setDeliveryState(order.delivery_state || "");
    setDeliveryPincode(order.delivery_pincode || "");
    setModeOfDelivery(order.mode_of_delivery || "");

    // Check user role
    const checkUserRole = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        const { data: salesperson } = await supabase
          .from("salesperson")
          .select("designation")
          .eq("email", user.email)
          .single();

        if (salesperson?.designation?.toLowerCase().includes("manager")) {
          setUserRole("SM");
        }
      }
    };
    checkUserRole();
  }, [order, navigate]);

  // Handle item field changes
  const handleItemChange = (index, field, value) => {
    setEditedItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  // Save changes
  const handleSave = async () => {
    try {
      setSaving(true);

      const updates = {
        items: editedItems,
        delivery_date: deliveryDate,
        delivery_address: deliveryAddress,
        delivery_city: deliveryCity,
        delivery_state: deliveryState,
        delivery_pincode: deliveryPincode,
        mode_of_delivery: modeOfDelivery,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("orders")
        .update(updates)
        .eq("id", order.id);

      if (error) throw error;

      setOrder({ ...order, ...updates });
      setIsEditing(false);
      alert("Order updated successfully!");

    } catch (err) {
      console.error("Save error:", err);
      alert("Failed to save: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Handle cancellation
  const handleCancellation = async () => {
    if (!cancellationReason) {
      alert("Please select a cancellation reason");
      return;
    }

    if (!window.confirm("Are you sure you want to cancel this order?")) return;

    try {
      setSaving(true);

      const { error } = await supabase
        .from("orders")
        .update({
          status: "cancelled",
          cancellation_reason: cancellationReason,
          cancelled_at: new Date().toISOString(),
        })
        .eq("id", order.id);

      if (error) throw error;

      alert("Order cancelled successfully");
      navigate(-1);

    } catch (err) {
      console.error("Cancellation error:", err);
      alert("Failed to cancel: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Handle exchange/return
  const handleExchangeReturn = async () => {
    if (!exchangeReason) {
      alert("Please select an exchange/return reason");
      return;
    }

    if (!window.confirm("Are you sure you want to process this exchange/return?")) return;

    try {
      setSaving(true);

      const { error } = await supabase
        .from("orders")
        .update({
          status: "exchange_return",
          exchange_reason: exchangeReason,
          exchange_requested_at: new Date().toISOString(),
        })
        .eq("id", order.id);

      if (error) throw error;

      alert("Exchange/Return processed successfully");
      navigate(-1);

    } catch (err) {
      console.error("Exchange error:", err);
      alert("Failed to process: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => navigate(-1);

  if (!order) {
    return (
      <div className="edit-order-page">
        <div className="no-order">No order found</div>
      </div>
    );
  }

  const item = order.items?.[0] || {};

  return (
    <div className="edit-order-page">
      {saving && (
        <div className="global-loader">
          <img src={Logo} alt="Loading" className="loader-logo" />
          <p>Saving changes...</p>
        </div>
      )}

      {/* Header */}
      <div className="eo-header">
        <img src={Logo} className="eo-logo" alt="logo" onClick={handleBack} />
        <h2 className="eo-title">Order Details</h2>
        <button className="eo-back-btn" onClick={handleBack}>Back</button>
      </div>

      {/* Time Status Banner */}
      <div className={`eo-status-banner ${canEdit ? "editable" : "readonly"}`}>
        <div className="eo-status-info">
          <span className="eo-status-label">Order Date:</span>
          <span className="eo-status-value">{formatDate(order.created_at)}</span>
        </div>
        <div className="eo-status-info">
          <span className="eo-status-label">Time Elapsed:</span>
          <span className="eo-status-value">{Math.floor(hoursSinceOrder)} hours</span>
        </div>
        <div className="eo-status-info">
          <span className={`eo-status-badge ${canEdit ? "active" : "expired"}`}>
            {canEdit ? `Edit Available (${Math.floor(36 - hoursSinceOrder)}h left)` : "Edit Period Expired"}
          </span>
        </div>
      </div>

      <div className="eo-container">
        {/* Product Details */}
        <div className="eo-section-box">
          <div className="eo-section-header">
            <h3>Product Details</h3>
            {canEdit && !isEditing && (
              <button className="eo-edit-btn" onClick={() => setIsEditing(true)}>Edit</button>
            )}
            {isEditing && (
              <div className="eo-edit-actions">
                <button className="eo-save-btn" onClick={handleSave} disabled={saving}>Save</button>
                <button className="eo-cancel-btn" onClick={() => setIsEditing(false)}>Cancel</button>
              </div>
            )}
          </div>

          {editedItems.map((item, i) => (
            <div key={i} className="eo-product-box">
              <img src={item.image_url} className="eo-prod-img" alt="" />
              <div className="eo-product-fields">
                <div className="eo-row">
                  <div className="eo-field eo-field-wide">
                    <label>Product Name:</label>
                    <span>{item.product_name}</span>
                  </div>
                </div>

                <div className="eo-row">
                  <div className="eo-field">
                    <label>Top:</label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={item.top || ""}
                        onChange={(e) => handleItemChange(i, "top", e.target.value)}
                      />
                    ) : (
                      <div className="eo-field-value">
                        <span>{item.top}</span>
                        {item.top_color && <ColorDotDisplay colorObject={item.top_color} />}
                      </div>
                    )}
                  </div>
                  <div className="eo-field">
                    <label>Bottom:</label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={item.bottom || ""}
                        onChange={(e) => handleItemChange(i, "bottom", e.target.value)}
                      />
                    ) : (
                      <div className="eo-field-value">
                        <span>{item.bottom}</span>
                        {item.bottom_color && <ColorDotDisplay colorObject={item.bottom_color} />}
                      </div>
                    )}
                  </div>
                  <div className="eo-field">
                    <label>Size:</label>
                    {isEditing ? (
                      <select
                        value={item.size || ""}
                        onChange={(e) => handleItemChange(i, "size", e.target.value)}
                      >
                        <option value="">Select Size</option>
                        {["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL"].map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    ) : (
                      <span>{item.size}</span>
                    )}
                  </div>
                </div>

                <div className="eo-row">
                  <div className="eo-field">
                    <label>Color:</label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={item.color?.name || item.color || ""}
                        onChange={(e) => handleItemChange(i, "color", { name: e.target.value, hex: item.color?.hex || "#000" })}
                      />
                    ) : (
                      <ColorDotDisplay colorObject={item.color} />
                    )}
                  </div>
                  <div className="eo-field">
                    <label>Amount:</label>
                    <span>₹{formatIndianNumber(order.grand_total)}</span>
                  </div>
                  <div className="eo-field">
                    <label>Qty:</label>
                    <span>{order.total_quantity || 1}</span>
                  </div>
                </div>

                {item.extras && item.extras.length > 0 && (
                  <div className="eo-row">
                    <div className="eo-field eo-field-wide">
                      <label>Extras:</label>
                      <div className="eo-extras-display">
                        {item.extras.map((extra, idx) => (
                          <div key={idx} className="eo-extra-item">
                            <span>{extra.name} (₹{formatIndianNumber(extra.price)})</span>
                            {extra.color && <ColorDotDisplay colorObject={extra.color} />}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Delivery Details */}
        <div className="eo-section-box">
          <h3>Delivery Details</h3>
          <div className="eo-row">
            <div className="eo-field">
              <label>Delivery Date:</label>
              {isEditing ? (
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                />
              ) : (
                <span>{formatDate(order.delivery_date)}</span>
              )}
            </div>
            <div className="eo-field">
              <label>Mode of Delivery:</label>
              {isEditing ? (
                <select
                  value={modeOfDelivery}
                  onChange={(e) => setModeOfDelivery(e.target.value)}
                >
                  <option value="Home Delivery">Home Delivery</option>
                  <option value="Store Pickup">Store Pickup</option>
                </select>
              ) : (
                <span>{order.mode_of_delivery}</span>
              )}
            </div>
            <div className="eo-field">
              <label>Status:</label>
              <span className={`eo-order-status ${order.status?.toLowerCase()}`}>
                {order.status || "Pending"}
              </span>
            </div>
          </div>

          {isEditing ? (
            <>
              <div className="eo-row">
                <div className="eo-field eo-field-wide">
                  <label>Address:</label>
                  <input
                    type="text"
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    placeholder="Address"
                  />
                </div>
              </div>
              <div className="eo-row">
                <div className="eo-field">
                  <label>City:</label>
                  <input
                    type="text"
                    value={deliveryCity}
                    onChange={(e) => setDeliveryCity(e.target.value)}
                  />
                </div>
                <div className="eo-field">
                  <label>State:</label>
                  <input
                    type="text"
                    value={deliveryState}
                    onChange={(e) => setDeliveryState(e.target.value)}
                  />
                </div>
                <div className="eo-field">
                  <label>Pincode:</label>
                  <input
                    type="text"
                    value={deliveryPincode}
                    onChange={(e) => setDeliveryPincode(e.target.value)}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="eo-row">
              <div className="eo-field eo-field-wide">
                <label>Address:</label>
                <span>
                  {[order.delivery_address, order.delivery_city, order.delivery_state, order.delivery_pincode]
                    .filter(Boolean).join(", ")}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Salesperson Details */}
        <div className="eo-section-box">
          <h3>Salesperson Details</h3>
          <div className="eo-row">
            <div className="eo-field">
              <label>Name:</label>
              <span>{order.salesperson || "—"}</span>
            </div>
            <div className="eo-field">
              <label>Email:</label>
              <span>{order.salesperson_email || "—"}</span>
            </div>
            <div className="eo-field">
              <label>Phone:</label>
              <span>{order.salesperson_phone || "—"}</span>
            </div>
          </div>
        </div>

        {/* Payment Details */}
        <div className="eo-section-box">
          <h3>Payment Details</h3>
          <div className="eo-row">
            <div className="eo-field">
              <label>Total Amount:</label>
              <span>₹{formatIndianNumber(order.grand_total)}</span>
            </div>
            <div className="eo-field">
              <label>Advance Payment:</label>
              <span>₹{formatIndianNumber(order.advance_payment || 0)}</span>
            </div>
            <div className="eo-field">
              <label>Balance:</label>
              <span>₹{formatIndianNumber(order.remaining_payment || 0)}</span>
            </div>
          </div>
        </div>

        {/* Order Actions */}
        <div className="eo-section-box eo-actions-box">
          <h3>Order Actions</h3>

          {/* Cancellation */}
          {canCancel && cancellationOptions.length > 0 && (
            <div className="eo-action-row">
              <div className="eo-field eo-field-wide">
                <label>Order Cancellation:</label>
                <div className="eo-action-group">
                  <select
                    value={cancellationReason}
                    onChange={(e) => setCancellationReason(e.target.value)}
                    className="eo-action-select"
                  >
                    <option value="">Select Reason</option>
                    {cancellationOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <button
                    className="eo-action-btn eo-cancel-order-btn"
                    onClick={handleCancellation}
                    disabled={!cancellationReason || saving}
                  >
                    Cancel Order
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Exchange/Return */}
          {canExchangeReturn && exchangeOptions.length > 0 && (
            <div className="eo-action-row">
              <div className="eo-field eo-field-wide">
                <label>Exchange / Return:</label>
                <div className="eo-action-group">
                  <select
                    value={exchangeReason}
                    onChange={(e) => setExchangeReason(e.target.value)}
                    className="eo-action-select"
                  >
                    <option value="">Select Reason</option>
                    {exchangeOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <button
                    className="eo-action-btn eo-exchange-btn"
                    onClick={handleExchangeReturn}
                    disabled={!exchangeReason || saving}
                  >
                    Process Exchange/Return
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* No actions available message */}
          {!canCancel && !canExchangeReturn && (
            <p className="eo-no-actions">
              No actions available at this time. Cancellation is available within 24 hours or after delivery date.
              Exchange/Return is available after delivery.
            </p>
          )}
        </div>
      </div>

      {/* Floating back button */}
      <button className="eo-floating-back" onClick={handleBack}>←</button>
    </div>
  );
}