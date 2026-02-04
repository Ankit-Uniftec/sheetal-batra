import React, { useEffect, useState, useMemo } from "react";
import "./OrderDetailPage.css";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import Logo from "../images/logo.png";
import formatIndianNumber from "../utils/formatIndianNumber";
import formatPhoneNumber from "../utils/formatPhoneNumber";
import formatDate from "../utils/formatDate";
import { downloadCustomerPdf, downloadWarehousePdf } from "../utils/pdfUtils";
import { usePopup } from "../components/Popup";
import AlterationModal from "../components/AlterationModal";

// Size options
const WOMEN_SIZE_OPTIONS = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL", "8XL"];
const KIDS_SIZE_OPTIONS = [
  "1-2 yrs", "2-3 yrs", "3-4 yrs", "4-5 yrs", "5-6 yrs",
  "6-7 yrs", "7-8 yrs", "8-9 yrs", "9-10 yrs", "10-11 yrs",
  "11-12 yrs", "12-13 yrs", "13-14 yrs", "14-15 yrs", "15-16 yrs",
];

// Time calculation helpers
const getHoursSinceDelivery = (deliveredAt) => {
  if (!deliveredAt) return Infinity;
  const deliveryDate = new Date(deliveredAt);
  const now = new Date();
  return (now - deliveryDate) / (1000 * 60 * 60);
};

// Color display component
function ColorDot({ color }) {
  if (!color) return null;

  let hex = "#888";
  let name = "";

  if (typeof color === "string") {
    name = color;
    hex = color.startsWith("#") ? color : "#888";
  } else if (typeof color === "object" && color !== null) {
    name = color.name || "";
    hex = color.hex || "#888";
  }

  return (
    <span className="odp-color-dot-wrapper">
      <span className="odp-color-dot" style={{ backgroundColor: hex }}></span>
      {name && <span className="odp-color-name">{name}</span>}
    </span>
  );
}

// Status badge component
function StatusBadge({ status }) {
  const getStatusClass = (s) => {
    switch (s?.toLowerCase()) {
      case "delivered": return "delivered";
      case "cancelled": return "cancelled";
      case "revoked": return "cancelled";
      case "pending": return "pending";
      case "in_production": return "in-production";
      case "ready": return "ready";
      case "shipped": return "shipped";
      default: return "active";
    }
  };

  const getStatusText = (s) => {
    switch (s?.toLowerCase()) {
      case "delivered": return "Delivered";
      case "cancelled": return "Cancelled";
      case "revoked": return "Revoked";
      case "pending": return "Pending";
      case "in_production": return "In Production";
      case "ready": return "Ready";
      case "shipped": return "Shipped";
      default: return s || "Active";
    }
  };

  return (
    <span className={`odp-status-badge ${getStatusClass(status)}`}>
      {getStatusText(status)}
    </span>
  );
}

export default function OrderDetailPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { orderId } = useParams();

  const fromAssociate = location.state?.fromAssociate;
  const customerFromState = location.state?.customer;

  const [order, setOrder] = useState(null);
  const [alterations, setAlterations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(null);

  // Alteration modal state
  const [alterationModal, setAlterationModal] = useState({
    isOpen: false,
    item: null,
    itemIndex: null,
  });

  // Popup hook
  const { showPopup, PopupComponent } = usePopup();

  // Image URL helper
  const publicImageUrl = (src) => {
    if (!src) return "/placeholder.png";
    if (/^https?:\/\//i.test(src)) return src;
    const { data } = supabase.storage.from("product-images").getPublicUrl(src);
    return data?.publicUrl || src;
  };

  // Fetch order and its alterations
  useEffect(() => {
    const fetchOrderData = async () => {
      try {
        setLoading(true);

        // Fetch the main order
        const { data: orderData, error: orderError } = await supabase
          .from("orders")
          .select("*")
          .eq("id", orderId)
          .single();

        if (orderError) throw orderError;
        setOrder(orderData);

        // Fetch alterations for this order
        const { data: alterationsData, error: altError } = await supabase
          .from("orders")
          .select("*")
          .eq("parent_order_id", orderId)
          .eq("is_alteration", true)
          .order("created_at", { ascending: true });

        if (!altError) {
          setAlterations(alterationsData || []);
        }

      } catch (err) {
        console.error("Error fetching order:", err);
        showPopup({
          type: "error",
          title: "Error",
          message: "Failed to load order details",
          confirmText: "OK",
        });
      } finally {
        setLoading(false);
      }
    };

    if (orderId) {
      fetchOrderData();
    }
  }, [orderId]);

  // Get alteration count for a specific item
  const getItemAlterationCount = (itemIndex) => {
    return alterations.filter(a => a.parent_item_index === itemIndex).length;
  };

  // Get alterations for a specific item
  const getItemAlterations = (itemIndex) => {
    return alterations.filter(a => a.parent_item_index === itemIndex);
  };

  // Check if alteration can be requested for this order
  const canRequestAlteration = () => {
    if (!order) return false;
    const status = order.status?.toLowerCase();
    // Only delivered orders can have alterations
    if (status !== "completed" && status !== "delivered") return false;
    // Can't alter an alteration order
    if (order.is_alteration) return false;
    return true;
  };

  // Check if alteration can be requested for a specific item
  const canAlterItem = (itemIndex) => {
    if (!canRequestAlteration()) return false;
    const count = getItemAlterationCount(itemIndex);
    return count < 2; // Max 2 alterations per product
  };

  // Open alteration modal
  const openAlterationModal = (item, itemIndex) => {
    setAlterationModal({
      isOpen: true,
      item,
      itemIndex,
    });
  };

  // Close alteration modal
  const closeAlterationModal = () => {
    setAlterationModal({
      isOpen: false,
      item: null,
      itemIndex: null,
    });
  };

  // Handle alteration submission
  const handleAlterationSubmit = async (alterationData) => {
    try {
      const item = alterationModal.item;
      const itemIndex = alterationModal.itemIndex;
      const alterationCount = getItemAlterationCount(itemIndex);
      const newAlterationNumber = alterationCount + 1;

      // Generate alteration order number
      const alterationOrderNo = newAlterationNumber === 1
        ? `${order.order_no}-A`
        : `${order.order_no}-A${newAlterationNumber}`;

      // Prepare the new alteration order
      const alterationOrder = {
        // Copy relevant fields from parent order
        user_id: order.user_id,
        delivery_name: order.delivery_name,
        delivery_email: order.delivery_email,
        delivery_phone: order.delivery_phone,
        delivery_country: alterationData.delivery_type === "Home Delivery" 
          ? (alterationData.delivery_country || order.delivery_country)
          : "India",
        delivery_address: alterationData.delivery_type === "Home Delivery"
          ? (alterationData.delivery_address || order.delivery_address)
          : "",
        delivery_city: alterationData.delivery_type === "Home Delivery"
          ? (alterationData.delivery_city || order.delivery_city)
          : "",
        delivery_state: alterationData.delivery_type === "Home Delivery"
          ? (alterationData.delivery_state || order.delivery_state)
          : "",
        delivery_pincode: alterationData.delivery_type === "Home Delivery"
          ? (alterationData.delivery_pincode || order.delivery_pincode)
          : "",
        mode_of_delivery: alterationData.delivery_type,
        delivery_date: alterationData.delivery_date,
        
        // Salesperson info
        salesperson: order.salesperson,
        salesperson_phone: order.salesperson_phone,
        salesperson_email: order.salesperson_email,

        // Order details
        order_no: alterationOrderNo,
        order_type: order.order_type,
        order_flag: alterationData.status === "Upcoming Occasion" ? "Urgent" : "Normal",

        // Items - only the selected product with updated measurements
        items: [{
          ...item,
          measurements: alterationData.measurements || item.measurements,
          size: alterationData.size || item.size,
        }],
        total_quantity: 1,

        // Pricing - alterations are typically free (service)
        grand_total: 0,
        advance_payment: 0,
        remaining_payment: 0,
        net_total: 0,

        // Alteration specific fields
        parent_order_id: order.id,
        parent_item_index: itemIndex,
        is_alteration: true,
        alteration_number: newAlterationNumber,
        alteration_type: alterationData.alteration_type,
        alteration_location: alterationData.alteration_location,
        alteration_notes: alterationData.notes || "",
        alteration_attachments: alterationData.attachments || [],

        // Status
        status: "pending",
        created_at: new Date().toISOString(),
      };

      // Insert the alteration order
      const { data: insertedOrder, error: insertError } = await supabase
        .from("orders")
        .insert(alterationOrder)
        .select()
        .single();

      if (insertError) throw insertError;

      // Update local state
      setAlterations(prev => [...prev, insertedOrder]);

      // Close modal
      closeAlterationModal();

      // Show success message
      showPopup({
        type: "success",
        title: "Alteration Submitted",
        message: `Alteration request ${alterationOrderNo} has been created successfully!${
          alterationData.alteration_location === "Warehouse" 
            ? " Warehouse has been notified." 
            : ""
        }`,
        confirmText: "OK",
      });

    } catch (err) {
      console.error("Error creating alteration:", err);
      showPopup({
        type: "error",
        title: "Error",
        message: "Failed to create alteration: " + err.message,
        confirmText: "OK",
      });
    }
  };

  // Handle PDF download
  const handlePrintPdf = async (type) => {
    setPdfLoading(type);
    try {
      if (type === "customer") {
        await downloadCustomerPdf(order);
      } else {
        await downloadWarehousePdf(order);
      }
    } catch (error) {
      console.error("PDF download failed:", error);
    } finally {
      setPdfLoading(null);
    }
  };

  // Navigation
  const handleBack = () => {
    if (fromAssociate) {
      navigate("/orderHistory", { 
        state: { fromAssociate: true, customer: customerFromState } 
      });
    } else {
      navigate(-1);
    }
  };

  const handleLogout = () => {
    navigate("/AssociateDashboard", { replace: true });
  };

  if (loading) {
    return (
      <div className="odp-loading">
        <img src={Logo} alt="Loading" className="odp-loading-logo" />
        <p>Loading order details...</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="odp-error">
        <h2>Order not found</h2>
        <button onClick={handleBack}>Go Back</button>
      </div>
    );
  }

  const items = order.items || [];
  const isDelivered = order.status?.toLowerCase() === "delivered";

  return (
    <div className="odp-page">
      {/* Popup Component */}
      {PopupComponent}

      {/* Alteration Modal */}
      <AlterationModal
        isOpen={alterationModal.isOpen}
        onClose={closeAlterationModal}
        onSubmit={handleAlterationSubmit}
        item={alterationModal.item}
        itemIndex={alterationModal.itemIndex}
        order={order}
        existingAlterations={getItemAlterations(alterationModal.itemIndex)}
      />

      {/* Header */}
      <header className="odp-header">
        <img src={Logo} alt="logo" className="odp-logo" onClick={handleLogout} />
        <h1 className="odp-page-title">Order Details</h1>
        <button className="odp-back-btn" onClick={handleBack}>
          ← Back
        </button>
      </header>

      {/* Order Summary Bar */}
      <div className="odp-summary-bar">
        <div className="odp-summary-left">
          <span className="odp-order-no">{order.order_no}</span>
          <StatusBadge status={order.status} />
          {order.order_flag === "Urgent" && (
            <span className="odp-urgent-badge">URGENT</span>
          )}
          {order.is_alteration && (
            <span className="odp-alteration-badge">Alteration</span>
          )}
        </div>
        <div className="odp-summary-right">
          <button
            className="odp-pdf-btn"
            onClick={() => handlePrintPdf("customer")}
            disabled={pdfLoading === "customer"}
          >
            {pdfLoading === "customer" ? "..." : "📄 Customer PDF"}
          </button>
          <button
            className="odp-pdf-btn secondary"
            onClick={() => handlePrintPdf("warehouse")}
            disabled={pdfLoading === "warehouse"}
          >
            {pdfLoading === "warehouse" ? "..." : "📄 Warehouse PDF"}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="odp-content">
        {/* Products Section */}
        <section className="odp-section">
          <h2 className="odp-section-title">
            Products ({items.length})
          </h2>

          <div className="odp-products-list">
            {items.map((item, index) => {
              const imgSrc = publicImageUrl(item.image_url);
              const itemAlterations = getItemAlterations(index);
              const alterationCount = itemAlterations.length;
              const canAlter = canAlterItem(index);

              return (
                <div key={index} className="odp-product-card">
                  {/* Product Header */}
                  <div className="odp-product-header">
                    <span className="odp-product-number">Product {index + 1}</span>
                    {alterationCount > 0 && (
                      <span className="odp-alteration-count">
                        {alterationCount}/2 Alterations
                      </span>
                    )}
                  </div>

                  {/* Product Body */}
                  <div className="odp-product-body">
                    <div className="odp-product-image">
                      <img src={imgSrc} alt={item.product_name} />
                    </div>

                    <div className="odp-product-details">
                      <h3 className="odp-product-name">{item.product_name}</h3>
                      
                      {item.sku_id && (
                        <p className="odp-product-sku">SKU: {item.sku_id}</p>
                      )}

                      <div className="odp-product-grid">
                        <div className="odp-product-field">
                          <label>Top:</label>
                          <span>
                            {item.top || "—"}
                            {item.top_color && <ColorDot color={item.top_color} />}
                          </span>
                        </div>
                        <div className="odp-product-field">
                          <label>Bottom:</label>
                          <span>
                            {item.bottom || "—"}
                            {item.bottom_color && <ColorDot color={item.bottom_color} />}
                          </span>
                        </div>
                        <div className="odp-product-field">
                          <label>Size:</label>
                          <span>{item.size || "—"}</span>
                        </div>
                        <div className="odp-product-field">
                          <label>Category:</label>
                          <span>{item.category || (item.isKids ? "Kids" : "Women")}</span>
                        </div>
                        <div className="odp-product-field">
                          <label>Price:</label>
                          <span className="odp-price">₹{formatIndianNumber(item.price || 0)}</span>
                        </div>
                        <div className="odp-product-field">
                          <label>Quantity:</label>
                          <span>{item.quantity || 1}</span>
                        </div>
                      </div>

                      {/* Extras */}
                      {item.extras && item.extras.length > 0 && (
                        <div className="odp-extras">
                          <label>Extras:</label>
                          <div className="odp-extras-list">
                            {item.extras.map((ex, i) => (
                              <span key={i} className="odp-extra-tag">
                                {ex.name}
                                {ex.color && <ColorDot color={ex.color} />}
                                <span>(₹{formatIndianNumber(ex.price)})</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Notes */}
                      {item.notes && (
                        <div className="odp-product-notes">
                          <label>Notes:</label>
                          <p>{item.notes}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Alteration History */}
                  {itemAlterations.length > 0 && (
                    <div className="odp-alteration-history">
                      <h4>Alteration History</h4>
                      {itemAlterations.map((alt, altIndex) => (
                        <div 
                          key={alt.id} 
                          className="odp-alteration-item"
                          onClick={() => navigate(`/order/${alt.id}`)}
                        >
                          <div className="odp-alteration-item-header">
                            <span className="odp-alteration-order-no">{alt.order_no}</span>
                            <StatusBadge status={alt.status} />
                          </div>
                          <div className="odp-alteration-item-details">
                            <span>{alt.alteration_type}</span>
                            <span>•</span>
                            <span>{alt.alteration_location}</span>
                            <span>•</span>
                            <span>Delivery: {formatDate(alt.delivery_date)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Product Actions */}
                  {isDelivered && !order.is_alteration && (
                    <div className="odp-product-actions">
                      <button
                        className={`odp-action-btn alteration ${!canAlter ? "disabled" : ""}`}
                        onClick={() => canAlter && openAlterationModal(item, index)}
                        disabled={!canAlter}
                        title={!canAlter ? "Maximum 2 alterations reached" : "Request Alteration"}
                      >
                        Alteration {alterationCount > 0 ? `(${alterationCount}/2)` : ""}
                      </button>
                      {/* Future buttons can be added here */}
                      {/* <button className="odp-action-btn exchange">Exchange</button> */}
                      {/* <button className="odp-action-btn return">Return</button> */}
                    </div>
                  )}

                  {/* Max alterations notice */}
                  {isDelivered && !canAlter && alterationCount >= 2 && (
                    <div className="odp-max-alterations-notice">
                      ℹ️ Maximum alterations (2) reached for this product
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Order Info Section */}
        <section className="odp-section">
          <h2 className="odp-section-title">Order Information</h2>
          
          <div className="odp-info-grid">
            <div className="odp-info-card">
              <h3>Order Details</h3>
              <div className="odp-info-row">
                <label>Order Date:</label>
                <span>{formatDate(order.created_at)}</span>
              </div>
              <div className="odp-info-row">
                <label>Delivery Date:</label>
                <span>{formatDate(order.delivery_date)}</span>
              </div>
              <div className="odp-info-row">
                <label>Order Type:</label>
                <span>{order.order_type || "Standard"}</span>
              </div>
              <div className="odp-info-row">
                <label>Delivery Mode:</label>
                <span>{order.mode_of_delivery}</span>
              </div>
              {order.salesperson && (
                <div className="odp-info-row">
                  <label>Salesperson:</label>
                  <span>
                    {order.salesperson}
                    {order.salesperson_phone && ` (${formatPhoneNumber(order.salesperson_phone)})`}
                  </span>
                </div>
              )}
            </div>

            <div className="odp-info-card">
              <h3>Payment Summary</h3>
              <div className="odp-info-row">
                <label>Total Amount:</label>
                <span className="odp-amount">₹{formatIndianNumber(order.grand_total)}</span>
              </div>
              {order.discount_amount > 0 && (
                <div className="odp-info-row">
                  <label>Discount:</label>
                  <span className="odp-discount">-₹{formatIndianNumber(order.discount_amount)}</span>
                </div>
              )}
              {order.store_credit_used > 0 && (
                <div className="odp-info-row">
                  <label>Store Credit:</label>
                  <span className="odp-discount">-₹{formatIndianNumber(order.store_credit_used)}</span>
                </div>
              )}
              <div className="odp-info-row">
                <label>Net Payable:</label>
                <span className="odp-amount">₹{formatIndianNumber(order.net_total)}</span>
              </div>
              <div className="odp-info-row">
                <label>Advance Paid:</label>
                <span>₹{formatIndianNumber(order.advance_payment)}</span>
              </div>
              <div className="odp-info-row">
                <label>Balance:</label>
                <span className={order.remaining_payment > 0 ? "odp-balance" : ""}>
                  ₹{formatIndianNumber(order.remaining_payment)}
                </span>
              </div>
              <div className="odp-info-row">
                <label>Payment Mode:</label>
                <span>{order.payment_mode}</span>
              </div>
            </div>

            <div className="odp-info-card">
              <h3>Delivery Details</h3>
              <div className="odp-info-row">
                <label>Name:</label>
                <span>{order.delivery_name}</span>
              </div>
              <div className="odp-info-row">
                <label>Phone:</label>
                <span>{formatPhoneNumber(order.delivery_phone)}</span>
              </div>
              <div className="odp-info-row">
                <label>Email:</label>
                <span>{order.delivery_email}</span>
              </div>
              {order.mode_of_delivery === "Home Delivery" && (
                <div className="odp-info-row full-width">
                  <label>Address:</label>
                  <span>
                    {[
                      order.delivery_address,
                      order.delivery_city,
                      order.delivery_state,
                      order.delivery_pincode,
                      order.delivery_country
                    ].filter(Boolean).join(", ")}
                  </span>
                </div>
              )}
              {order.delivery_notes && (
                <div className="odp-info-row full-width">
                  <label>Notes:</label>
                  <span>{order.delivery_notes}</span>
                </div>
              )}
            </div>

            {/* Alteration Info (if this is an alteration order) */}
            {order.is_alteration && (
              <div className="odp-info-card alteration-info">
                <h3>Alteration Details</h3>
                <div className="odp-info-row">
                  <label>Alteration Type:</label>
                  <span>{order.alteration_type}</span>
                </div>
                <div className="odp-info-row">
                  <label>Location:</label>
                  <span>{order.alteration_location}</span>
                </div>
                <div className="odp-info-row">
                  <label>Alteration #:</label>
                  <span>{order.alteration_number} of 2</span>
                </div>
                {order.alteration_notes && (
                  <div className="odp-info-row full-width">
                    <label>Notes:</label>
                    <span>{order.alteration_notes}</span>
                  </div>
                )}
                {order.alteration_attachments && order.alteration_attachments.length > 0 && (
                  <div className="odp-info-row full-width">
                    <label>Attachments:</label>
                    <div className="odp-attachments">
                      {order.alteration_attachments.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                          📎 Attachment {i + 1}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                <div className="odp-parent-order-link">
                  <button onClick={() => navigate(`/order/${order.parent_order_id}`)}>
                    ← View Original Order
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Floating Back Button */}
      <button className="odp-floating-back" onClick={handleBack}>←</button>
    </div>
  );
}