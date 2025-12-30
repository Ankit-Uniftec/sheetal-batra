import React, { useEffect, useState, useMemo } from "react";
import "./OrderHistory.css";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { useNavigate, useLocation } from "react-router-dom";
import Logo from "../images/logo.png";
import formatIndianNumber from "../utils/formatIndianNumber";
import formatPhoneNumber from "../utils/formatPhoneNumber";
import formatDate from "../utils/formatDate";
import { downloadCustomerPdf } from "../utils/pdfUtils";

// Time calculation helpers
const getHoursSinceOrder = (createdAt) => {
  const orderDate = new Date(createdAt);
  const now = new Date();
  return (now - orderDate) / (1000 * 60 * 60);
};

const isAfterDeliveryDate = (deliveryDate) => {
  if (!deliveryDate) return false;
  return new Date() > new Date(deliveryDate);
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
    <span className="oh-color-dot-wrapper">
      <span className="oh-color-dot" style={{ backgroundColor: hex }}></span>
      {name && <span className="oh-color-name">{name}</span>}
    </span>
  );
}

export default function OrderHistory() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const customerFromState = location.state?.customer;
  const fromAssociate = location.state?.fromAssociate;

  const [orders, setOrders] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("orders");
  const [actionLoading, setActionLoading] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const ordersPerPage = 5;

  // Edit modal state
  const [editingOrder, setEditingOrder] = useState(null);
  const [editFormData, setEditFormData] = useState({});

  // Action dropdowns state
  const [selectedCancellation, setSelectedCancellation] = useState({});
  const [selectedExchange, setSelectedExchange] = useState({});

  // Customer info
  const customerName = customerFromState?.name || profile?.full_name || "Customer";
  const customerEmail = customerFromState?.email || profile?.email || "";
  const customerPhone = customerFromState?.phone || profile?.phone || "";

  const isSM = userRole === "SM";

  // Image URL helper
  const publicImageUrl = (src) => {
    if (!src) return "/placeholder.png";
    if (/^https?:\/\//i.test(src)) return src;
    const { data } = supabase.storage.from("product-images").getPublicUrl(src);
    return data?.publicUrl || src;
  };

  // Pagination
  const totalPages = Math.ceil(orders.length / ordersPerPage);
  const startIndex = (currentPage - 1) * ordersPerPage;
  const currentOrders = orders.slice(startIndex, startIndex + ordersPerPage);
  const goToPage = (page) => setCurrentPage(page);
  const goToPrevious = () => setCurrentPage((prev) => Math.max(prev - 1, 1));
  const goToNext = () => setCurrentPage((prev) => Math.min(prev + 1, totalPages));

  const recent = useMemo(() => orders.slice(0, 2), [orders]);

  // Handle PDF download
  const handlePrintPdf = async (e, order) => {
    e.stopPropagation();
    setPdfLoading(order.id);
    try {
      await downloadCustomerPdf(order);
    } catch (error) {
      console.error("PDF download failed:", error);
    } finally {
      setPdfLoading(null);
    }
  };


  // Check user role
  useEffect(() => {
    const checkUserRole = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        const { data: sp } = await supabase
          .from("salesperson")
          .select("designation")
          .eq("email", user.email)
          .single();
        if (sp?.designation?.toLowerCase().includes("manager")) {
          setUserRole("SM");
        }
      }
    };
    checkUserRole();
  }, []);

  // Load orders
  useEffect(() => {
    const fetchData = async () => {
      try {
        if (fromAssociate && customerFromState) {
          let query = supabase.from("orders").select("*");
          if (customerFromState.user_id) {
            query = query.eq("user_id", customerFromState.user_id);
          } else if (customerFromState.email) {
            query = query.eq("delivery_email", customerFromState.email);
          }
          const { data } = await query.order("created_at", { ascending: false });
          setOrders(data || []);
        } else {
          if (!user) { setLoading(false); return; }
          const [{ data: ordersData }, { data: profileData }] = await Promise.all([
            supabase.from("orders").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
            supabase.from("profiles").select("*").eq("id", user.id).single(),
          ]);
          setOrders(ordersData || []);
          setProfile(profileData || null);
        }
      } catch (err) {
        console.error("Error:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user, fromAssociate, customerFromState]);

  // Permission helpers
  const canEdit = (order) => getHoursSinceOrder(order.created_at) <= 36 && order.status !== "cancelled";
  const canCancel = (order) => {
    const hrs = getHoursSinceOrder(order.created_at);
    const afterDel = isAfterDeliveryDate(order.delivery_date);
    return (hrs <= 24 || afterDel || (isSM && hrs > 24)) && order.status !== "cancelled";
  };
  const canExchangeReturn = (order) => {
    const afterDel = isAfterDeliveryDate(order.delivery_date);
    const isDel = order.status?.toLowerCase() === "delivered";
    const hrs = getHoursSinceOrder(order.created_at);
    return (afterDel || isDel || (isSM && hrs > 24)) && order.status !== "cancelled" && order.status !== "exchange_return";
  };

  // Options
  const getCancellationOptions = (order) => {
    const hrs = getHoursSinceOrder(order.created_at);
    const afterDel = isAfterDeliveryDate(order.delivery_date);
    const opts = [];
    if (hrs <= 24) {
      opts.push(
        { value: "client_no_longer_wants", label: "Client No Longer Wants" },
        { value: "wh_cannot_expedite", label: "WH Cannot Expedite" },
        { value: "new_order_placed", label: "New Order Placed" }
      );
    }
    if (isSM && hrs > 24 && !afterDel) {
      opts.push({ value: "store_credit_given", label: "Store Credit Given" });
    }
    if (afterDel) {
      opts.push(
        { value: "delayed_delivery", label: "Delayed Delivery" },
        { value: "incorrect_product", label: "Incorrect Product" },
        { value: "quality_failure", label: "Quality Failure" }
      );
    }
    return opts;
  };

  const getExchangeOptions = (order) => {
    const hrs = getHoursSinceOrder(order.created_at);
    const afterDel = isAfterDeliveryDate(order.delivery_date);
    const isDel = order.status?.toLowerCase() === "delivered";
    const opts = [];
    if (afterDel || isDel) {
      opts.push(
        { value: "exchange_size", label: "Exchange (Size)" },
        { value: "exchange_other", label: "Exchange (Other)" },
        { value: "client_not_like_product", label: "Client Didn't Like Product" },
        { value: "client_not_like_quality", label: "Client Didn't Like Quality" }
      );
    }
    if (isSM && hrs > 24 && !afterDel) {
      opts.push({ value: "store_credit_given", label: "Store Credit Given" });
    }
    return opts;
  };

  // Edit handlers
  const openEditModal = (e, order) => {
    e.stopPropagation();
    const item = order.items?.[0] || {};
    let colorVal = "";
    if (typeof item.color === 'object' && item.color !== null) {
      colorVal = item.color.name || item.color.hex || "";
    } else {
      colorVal = item.color || "";
    }
    setEditFormData({
      size: item.size || "",
      color: colorVal,
      delivery_date: order.delivery_date?.slice(0, 10) || "",
      delivery_address: order.delivery_address || "",
      delivery_city: order.delivery_city || "",
      delivery_state: order.delivery_state || "",
      delivery_pincode: order.delivery_pincode || "",
      mode_of_delivery: order.mode_of_delivery || "",
    });
    setEditingOrder(order);
  };

  const handleSaveEdit = async () => {
    if (!editingOrder) return;
    setActionLoading(editingOrder.id);
    try {
      const updatedItems = editingOrder.items?.map((item, i) => {
        if (i === 0) {
          return {
            ...item,
            size: editFormData.size,
            color: typeof item.color === 'object' ? { ...item.color, name: editFormData.color } : editFormData.color,
          };
        }
        return item;
      });
      const { error } = await supabase.from("orders").update({
        items: updatedItems,
        delivery_date: editFormData.delivery_date,
        delivery_address: editFormData.delivery_address,
        delivery_city: editFormData.delivery_city,
        delivery_state: editFormData.delivery_state,
        delivery_pincode: editFormData.delivery_pincode,
        mode_of_delivery: editFormData.mode_of_delivery,
        updated_at: new Date().toISOString(),
      }).eq("id", editingOrder.id);
      if (error) throw error;
      setOrders(prev => prev.map(o => o.id === editingOrder.id ? { ...o, items: updatedItems, ...editFormData } : o));
      setEditingOrder(null);
      alert("Order updated!");
    } catch (err) {
      alert("Failed: " + err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancellation = async (e, order) => {
    e.stopPropagation();
    const reason = selectedCancellation[order.id];
    if (!reason) { alert("Select a reason"); return; }
    if (!window.confirm("Cancel this order?")) return;
    setActionLoading(order.id);
    try {
      await supabase.from("orders").update({
        status: "cancelled",
        cancellation_reason: reason,
        cancelled_at: new Date().toISOString(),
      }).eq("id", order.id);
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "cancelled" } : o));
      setSelectedCancellation(prev => ({ ...prev, [order.id]: "" }));
      alert("Order cancelled!");
    } catch (err) {
      alert("Failed: " + err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleExchangeReturn = async (e, order) => {
    e.stopPropagation();
    const reason = selectedExchange[order.id];
    if (!reason) { alert("Select a reason"); return; }
    if (!window.confirm("Process exchange/return?")) return;
    setActionLoading(order.id);
    try {
      await supabase.from("orders").update({
        status: "exchange_return",
        exchange_reason: reason,
        exchange_requested_at: new Date().toISOString(),
      }).eq("id", order.id);
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "exchange_return" } : o));
      setSelectedExchange(prev => ({ ...prev, [order.id]: "" }));
      alert("Exchange/Return processed!");
    } catch (err) {
      alert("Failed: " + err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleBack = () => {
    if (fromAssociate) navigate("/AssociateDashboard");
    else navigate(-1);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  const getStatusClass = (status) => {
    switch (status?.toLowerCase()) {
      case "delivered": return "delivered";
      case "cancelled": return "cancelled";
      case "exchange_return": return "exchange";
      default: return "active";
    }
  };

  const getStatusText = (status) => {
    switch (status?.toLowerCase()) {
      case "delivered": return "Delivered";
      case "cancelled": return "Cancelled";
      case "exchange_return": return "Exchange/Return";
      default: return "Active";
    }
  };

  if (loading) return <p className="loading">Loading...</p>;

  return (
    <div className="oh-page">
      {/* Edit Modal */}
      {editingOrder && (
        <div className="oh-modal-overlay">
          <div className="oh-modal">
            <div className="oh-modal-header">
              <h3>Edit Order</h3>
              <button className="oh-modal-close" onClick={() => setEditingOrder(null)}>✕</button>
            </div>
            <div className="oh-modal-body">
              <div className="oh-modal-row">
                <div className="oh-modal-field">
                  <label>Size</label>
                  <select value={editFormData.size} onChange={(e) => setEditFormData({ ...editFormData, size: e.target.value })}>
                    <option value="">Select</option>
                    {["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL"].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="oh-modal-field">
                  <label>Color</label>
                  <input type="text" value={editFormData.color} onChange={(e) => setEditFormData({ ...editFormData, color: e.target.value })} />
                </div>
              </div>
              <div className="oh-modal-row">
                <div className="oh-modal-field">
                  <label>Delivery Date</label>
                  <input type="date" value={editFormData.delivery_date} onChange={(e) => setEditFormData({ ...editFormData, delivery_date: e.target.value })} />
                </div>
                <div className="oh-modal-field">
                  <label>Mode of Delivery</label>
                  <select value={editFormData.mode_of_delivery} onChange={(e) => setEditFormData({ ...editFormData, mode_of_delivery: e.target.value })}>
                    <option value="Home Delivery">Home Delivery</option>
                    <option value="Store Pickup">Store Pickup</option>
                  </select>
                </div>
              </div>
              <div className="oh-modal-field full">
                <label>Address</label>
                <input type="text" value={editFormData.delivery_address} onChange={(e) => setEditFormData({ ...editFormData, delivery_address: e.target.value })} />
              </div>
              <div className="oh-modal-row">
                <div className="oh-modal-field">
                  <label>City</label>
                  <input type="text" value={editFormData.delivery_city} onChange={(e) => setEditFormData({ ...editFormData, delivery_city: e.target.value })} />
                </div>
                <div className="oh-modal-field">
                  <label>State</label>
                  <input type="text" value={editFormData.delivery_state} onChange={(e) => setEditFormData({ ...editFormData, delivery_state: e.target.value })} />
                </div>
                <div className="oh-modal-field">
                  <label>Pincode</label>
                  <input type="text" value={editFormData.delivery_pincode} onChange={(e) => setEditFormData({ ...editFormData, delivery_pincode: e.target.value })} />
                </div>
              </div>
            </div>
            <div className="oh-modal-footer">
              <button className="oh-modal-btn cancel" onClick={() => setEditingOrder(null)}>Cancel</button>
              <button className="oh-modal-btn save" onClick={handleSaveEdit} disabled={actionLoading === editingOrder.id}>
                {actionLoading === editingOrder.id ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="oh-header">
        <img src={Logo} alt="logo" className="oh-logo" onClick={handleLogout} />
        <h1 className="oh-page-title">Order History</h1>
        <button className="oh-back-btn" onClick={handleBack}>
          ← {fromAssociate ? "Dashboard" : "Back"}
        </button>
      </header>

      {/* Customer Banner */}
      {fromAssociate && customerFromState && (
        <div className="oh-customer-banner">
          <div className="oh-customer-left">
            <span className="oh-customer-name">{customerName}</span>
            <span className="oh-customer-contact">{customerEmail} {customerPhone && `• ${formatPhoneNumber(customerPhone)}`}</span>
          </div>
          <div className="oh-customer-right">
            <span className="oh-order-count">{orders.length} Order(s)</span>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="oh-main">
        {/* Sidebar */}
        <aside className="oh-sidebar">
          <div className="oh-sidebar-card">
            <h4>Recent Orders</h4>
            {recent.length === 0 ? <p className="muted">No orders yet</p> : recent.map(o => (
              <div key={o.id} className="oh-recent-item">
                <span>#{o.order_no}</span>
                <span className={`oh-mini-badge ${getStatusClass(o.status)}`}>{getStatusText(o.status)}</span>
              </div>
            ))}
          </div>
          <div className="oh-sidebar-card">
            <h4>Loyalty Points</h4>
            <p className="muted">Coming soon</p>
          </div>
        </aside>

        {/* Content */}
        <section className="oh-content">
          <div className="oh-tabs">
            <button className={`oh-tab ${tab === "orders" ? "active" : ""}`} onClick={() => setTab("orders")}>My Orders</button>
            <button className={`oh-tab ${tab === "profile" ? "active" : ""}`} onClick={() => setTab("profile")}>Profile</button>
          </div>

          {tab === "orders" && (
            <div className="oh-orders-list">
              {orders.length === 0 && <p className="oh-empty">No orders found.</p>}

              {currentOrders.map((order) => {
                const item = order.items?.[0] || {};
                const imgSrc = publicImageUrl(item.image_url);
                const hrs = getHoursSinceOrder(order.created_at);
                const editOk = canEdit(order);
                const cancelOk = canCancel(order);
                const exchangeOk = canExchangeReturn(order);
                const cancelOpts = getCancellationOptions(order);
                const exchangeOpts = getExchangeOptions(order);

                return (
                  <div key={order.id} className="oh-order-card">
                    {/* Card Header */}
                    {/* Card Header - Replace existing oh-card-top */}
                    <div className="oh-card-top">
                      <div className="oh-card-info">
                        <div className="oh-header-item">
                          <span className="oh-header-label">Order No:</span>
                          <span className="oh-header-value">{order.order_no || "—"}</span>
                        </div>
                        <div className="oh-header-item">
                          <span className="oh-header-label">Order Date:</span>
                          <span className="oh-header-value">{formatDate(order.created_at) || "—"}</span>
                        </div>
                        <div className="oh-header-item">
                          <span className="oh-header-label">EDD:</span>
                          <span className="oh-header-value">{formatDate(order.delivery_date) || "—"}</span>
                        </div>
                      </div>
                      <div className="oh-card-badges">
                        <span className={`oh-badge ${getStatusClass(order.status)}`}>{getStatusText(order.status)}</span>
                        {editOk && <span className="oh-badge editable">Editable ({Math.floor(36 - hrs)}h)</span>}
                        {/* <div className="ad-header-actions"> */}
                          <button
                            className="ad-print-pdf-btn active"
                            onClick={(e) => handlePrintPdf(e, order)}
                            disabled={pdfLoading === order.id}
                          >
                            {pdfLoading === order.id ? "..." : "📄 PDF"}
                          </button>
                        {/* </div> */}
                      </div>
                    </div>

                    {/* Card Body */}
                    <div className="oh-card-body">
                      <div className="oh-card-img">
                        <img src={imgSrc} alt={item.product_name || "Product"} />
                      </div>
                      <div className="oh-card-details">
                        <h3 className="oh-product-title">{item.product_name || "—"}</h3>

                        <div className="oh-details-row">
                          <div className="oh-detail">
                            <span className="oh-label">Top</span>
                            <span className="oh-value">{item.top || "—"} {item.top_color && <ColorDot color={item.top_color} />}</span>
                          </div>
                          <div className="oh-detail">
                            <span className="oh-label">Bottom</span>
                            <span className="oh-value">{item.bottom || "—"} {item.bottom_color && <ColorDot color={item.bottom_color} />}</span>
                          </div>
                          {/* <div className="oh-detail">
                            <span className="oh-label">Color</span>
                            <span className="oh-value"><ColorDot color={item.color} /></span>
                          </div> */}
                          <div className="oh-detail">
                            <span className="oh-label">Size</span>
                            <span className="oh-value">{item.size || "—"}</span>
                          </div>
                        </div>

                        <div className="oh-details-row">
                          <div className="oh-detail">
                            <span className="oh-label">Amount</span>
                            <span className="oh-value oh-amount">₹{formatIndianNumber(order.grand_total)}</span>
                          </div>
                          <div className="oh-detail">
                            <span className="oh-label">Qty</span>
                            <span className="oh-value">{order.total_quantity || 1}</span>
                          </div>
                          <div className="oh-detail wide">
                            <span className="oh-label">Sales Associate</span>
                            <span className="oh-value">{order.salesperson || "—"} {order.salesperson_phone && `(${formatPhoneNumber(order.salesperson_phone)})`}</span>
                          </div>
                        </div>

                        {item.extras && item.extras.length > 0 && (
                          <div className="oh-extras">
                            <span className="oh-label">Extras:</span>
                            {item.extras.map((ex, i) => (
                              <span key={i} className="oh-extra-tag">{ex.name} (₹{formatIndianNumber(ex.price)})</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Card Footer - Actions */}
                    <div className="oh-card-actions">
                      {editOk && (
                        <button className="oh-btn edit" onClick={(e) => openEditModal(e, order)}>Edit Order</button>
                      )}
                      {cancelOk && cancelOpts.length > 0 && (
                        <div className="oh-action-group">
                          <select
                            value={selectedCancellation[order.id] || ""}
                            onChange={(e) => setSelectedCancellation({ ...selectedCancellation, [order.id]: e.target.value })}
                            className="oh-select"
                          >
                            <option value="">Cancel Order</option>
                            {cancelOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          {selectedCancellation[order.id] && (
                            <button className="oh-btn danger" onClick={(e) => handleCancellation(e, order)} disabled={actionLoading === order.id}>
                              {actionLoading === order.id ? "..." : "Confirm"}
                            </button>
                          )}
                        </div>
                      )}
                      {exchangeOk && exchangeOpts.length > 0 && (
                        <div className="oh-action-group">
                          <select
                            value={selectedExchange[order.id] || ""}
                            onChange={(e) => setSelectedExchange({ ...selectedExchange, [order.id]: e.target.value })}
                            className="oh-select"
                          >
                            <option value="">Exchange / Return</option>
                            {exchangeOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          {selectedExchange[order.id] && (
                            <button className="oh-btn primary" onClick={(e) => handleExchangeReturn(e, order)} disabled={actionLoading === order.id}>
                              {actionLoading === order.id ? "..." : "Process"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Pagination */}
              {orders.length > ordersPerPage && (
                <div className="oh-pagination">
                  <button onClick={goToPrevious} disabled={currentPage === 1}>← Prev</button>
                  <span className="oh-page-info">Page {currentPage} of {totalPages}</span>
                  <button onClick={goToNext} disabled={currentPage === totalPages}>Next →</button>
                </div>
              )}
            </div>
          )}

          {tab === "profile" && (
            <div className="oh-profile-card">
              <h3>Personal Details</h3>
              <div className="oh-profile-grid">
                <div><strong>Name:</strong> {profile?.full_name || customerName || "—"}</div>
                <div><strong>Email:</strong> {profile?.email || customerEmail || "—"}</div>
                <div><strong>Phone:</strong> {profile?.phone || customerPhone || "—"}</div>
                <div><strong>Gender:</strong> {profile?.gender || "—"}</div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Floating Back */}
      <button className="oh-floating-back" onClick={handleBack}>←</button>
    </div>
  );
}