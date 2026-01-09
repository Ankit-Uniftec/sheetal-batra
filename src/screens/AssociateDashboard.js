import React, { useEffect, useState, useMemo } from "react";
import "./AssociateDashboard.css";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Logo from "../images/logo.png";
import formatIndianNumber from "../utils/formatIndianNumber";
import formatPhoneNumber from "../utils/formatPhoneNumber";
import formatDate from "../utils/formatDate";
import { downloadCustomerPdf, downloadWarehousePdf } from "../utils/pdfUtils";

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

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();

  const [activeTab, setActiveTab] = useState("dashboard");
  const [salesperson, setSalesperson] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSidebar, setShowSidebar] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(null);
  const [warehousePdfLoading, setWarehousePdfLoading] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [enteredPassword, setEnteredPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [clients, setClients] = useState([]);
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [clientsLoading, setClientsLoading] = useState(false);
  const [orderSearch, setOrderSearch] = useState("");
  const [clientSearch, setClientSearch] = useState("");

  // Edit modal state
  const [editingOrder, setEditingOrder] = useState(null);
  const [editFormData, setEditFormData] = useState({});

  // Action dropdowns state
  const [selectedCancellation, setSelectedCancellation] = useState({});
  const [selectedExchange, setSelectedExchange] = useState({});
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(null);

  const [attachmentLoading, setAttachmentLoading] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showRevenue, setShowRevenue] = useState(false);

  // Check if user is Store Manager
  const isSM = useMemo(() => {
    return salesperson?.designation?.toLowerCase().includes("manager");
  }, [salesperson]);

  // Stats
  const totalRevenue = orders.reduce((sum, o) => sum + Number(o.grand_total || 0), 0);
  const totalOrders = orders.length;
  const totalClients = new Set(orders.map((o) => o.user_id)).size;
  const activeOrders = orders.filter(
    (o) => o.status !== "completed" && o.status !== "cancelled" && o.status !== "delivered" &&
      formatDate(o.created_at) === formatDate(new Date())
  );

  // Sales Target - use DB value or default to 800000
  const DEFAULT_SALES_TARGET = 800000;
  const salesTarget = salesperson?.sales_target > 0 ? salesperson.sales_target : DEFAULT_SALES_TARGET;

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      // console.log("Logged in:", data.user?.email);
    });
  }, []);

  useEffect(() => {
    if (location.state?.fromBuyerVerification) {
      setShowPasswordModal(true);
    }
  }, [location]);

  useEffect(() => {
    const fromBuyerVerification =
      location.state?.fromBuyerVerification ||
      sessionStorage.getItem("fromBuyerVerification") === "true";

    if (fromBuyerVerification) {
      setShowPasswordModal(true);
      sessionStorage.removeItem("fromBuyerVerification");
    }
  }, []);

  useEffect(() => {
    const requireLogoutVerification = sessionStorage.getItem("requirePasswordVerificationOnDashboard") === "true";
    const requireReturnVerification = sessionStorage.getItem("requirePasswordVerificationOnReturn") === "true";

    if (requireLogoutVerification || requireReturnVerification) {
      setShowPasswordModal(true);
      sessionStorage.removeItem("requirePasswordVerificationOnDashboard");
      sessionStorage.removeItem("requirePasswordVerificationOnReturn");
    }
  }, [location]);

  const verifyPassword = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: enteredPassword
    });

    if (error) {
      setPasswordError("Incorrect password!");
      return;
    }
    setShowPasswordModal(false);
  };

  useEffect(() => {
    const loadSalesperson = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) return;

      const { data, error } = await supabase
        .from("salesperson")
        .select("*")
        .eq("email", user.email)
        .single();

      if (error) {
        console.log("Salesperson fetch error:", error);
        return;
      }
      setSalesperson(data);
    };
    loadSalesperson();
  }, []);

  useEffect(() => {
    if (!salesperson) return;

    const loadOrders = async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("salesperson_email", salesperson.email)
        .order("created_at", { ascending: false });

      if (error) console.log("Orders fetch error:", error);
      setOrders(data || []);
      setLoading(false);
    };
    loadOrders();
  }, [salesperson]);

  useEffect(() => {
    if (!salesperson) return;

    const loadClients = async () => {
      setClientsLoading(true);

      const { data: orderClients, error } = await supabase
        .from("orders")
        .select("delivery_name, delivery_email, delivery_phone, user_id")
        .eq("salesperson_email", salesperson.email);

      if (error) {
        console.error(error);
        setClients([]);
        setClientsLoading(false);
        return;
      }

      const map = new Map();
      orderClients.forEach((c) => {
        if (c.delivery_email) {
          map.set(c.delivery_email, {
            name: c.delivery_name,
            email: c.delivery_email,
            phone: c.delivery_phone,
            user_id: c.user_id,
          });
        }
      });

      const uniqueClients = Array.from(map.values());

      if (uniqueClients.length === 0) {
        setClients([]);
        setClientsLoading(false);
        return;
      }

      const { data: profiles } = await supabase
        .from("profiles")
        .select("email, gender, dob")
        .in("email", uniqueClients.map((c) => c.email));

      const profileMap = new Map((profiles || []).map((p) => [p.email, p]));

      const finalClients = uniqueClients.map((c) => ({
        name: c.name,
        email: c.email,
        phone: c.phone,
        user_id: c.user_id,
        gender: profileMap.get(c.email)?.gender || "—",
        dob: formatDate(profileMap.get(c.email)?.dob),
      }));

      setClients(finalClients);
      setClientsLoading(false);
    };
    loadClients();
  }, [salesperson]);

  // Download all attachments
  const downloadAttachments = async (attachments, orderNo) => {
    if (!attachments || attachments.length === 0) return;

    for (let i = 0; i < attachments.length; i++) {
      const url = attachments[i];
      try {
        const response = await fetch(url);
        const blob = await response.blob();

        // Get filename from URL
        const fileName = url.split("/").pop() || `attachment_${i + 1}`;

        // Create download link
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${orderNo}_${fileName}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        // Small delay between downloads
        if (i < attachments.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      } catch (err) {
        console.error("Download failed for:", url, err);
      }
    }
  };


  const handleLogout = async () => {
    await supabase.auth.signOut();
    sessionStorage.setItem("requirePasswordVerificationOnDashboard", "true");
    navigate("/login");
  };

  // Handle customer PDF download
  const handlePrintCustomerPdf = async (e, order) => {
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

  // Handle PDF download
  const handlePrintWarehousePdf = async (e, order) => {
    e.stopPropagation();
    setWarehousePdfLoading(order.id);
    try {
      await downloadWarehousePdf(order);
    } catch (error) {
      console.error("PDF download failed:", error);
    } finally {
      setWarehousePdfLoading(null);
    }
  };

  // Mark as Delivered
  const handleMarkDelivered = async (e, order) => {
    e.stopPropagation();
    if (!window.confirm("Mark this order as delivered?")) return;

    setActionLoading(order.id);
    try {
      const { error } = await supabase
        .from("orders")
        .update({
          status: "delivered",
          delivered_at: new Date().toISOString(),
        })
        .eq("id", order.id);

      if (error) throw error;

      // Update local state
      setOrders(prev => prev.map(o =>
        o.id === order.id ? { ...o, status: "delivered", delivered_at: new Date().toISOString() } : o
      ));

      alert("Order marked as delivered!");
    } catch (err) {
      console.error("Mark delivered error:", err);
      alert("Failed to update: " + err.message);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Cancellation
  const handleCancellation = async (e, order) => {
    e.stopPropagation();
    const reason = selectedCancellation[order.id];
    if (!reason) {
      alert("Please select a cancellation reason");
      return;
    }

    if (!window.confirm("Are you sure you want to cancel this order?")) return;

    setActionLoading(order.id);
    try {
      const { error } = await supabase
        .from("orders")
        .update({
          status: "cancelled",
          cancellation_reason: reason,
          cancelled_at: new Date().toISOString(),
        })
        .eq("id", order.id);

      if (error) throw error;

      setOrders(prev => prev.map(o =>
        o.id === order.id ? { ...o, status: "cancelled", cancellation_reason: reason } : o
      ));

      setSelectedCancellation(prev => ({ ...prev, [order.id]: "" }));
      alert("Order cancelled successfully!");
    } catch (err) {
      console.error("Cancellation error:", err);
      alert("Failed to cancel: " + err.message);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Exchange/Return
  const handleExchangeReturn = async (e, order) => {
    e.stopPropagation();
    const reason = selectedExchange[order.id];
    if (!reason) {
      alert("Please select an exchange/return reason");
      return;
    }

    if (!window.confirm("Process this exchange/return request?")) return;

    setActionLoading(order.id);
    try {
      const { error } = await supabase
        .from("orders")
        .update({
          status: "exchange_return",
          exchange_reason: reason,
          exchange_requested_at: new Date().toISOString(),
        })
        .eq("id", order.id);

      if (error) throw error;

      setOrders(prev => prev.map(o =>
        o.id === order.id ? { ...o, status: "exchange_return", exchange_reason: reason } : o
      ));

      setSelectedExchange(prev => ({ ...prev, [order.id]: "" }));
      alert("Exchange/Return processed successfully!");
    } catch (err) {
      console.error("Exchange error:", err);
      alert("Failed to process: " + err.message);
    } finally {
      setActionLoading(null);
    }
  };

  // Open Edit Modal
  const openEditModal = (e, order) => {
    e.stopPropagation();
    const item = order.items?.[0] || {};
    // Handle color as object or string
    let colorValue = "";
    if (typeof item.color === 'object' && item.color !== null) {
      colorValue = item.color.name || item.color.hex || "";
    } else {
      colorValue = item.color || "";
    }

    setEditFormData({
      size: item.size || "",
      color: colorValue,
      delivery_date: order.delivery_date?.slice(0, 10) || "",
      delivery_address: order.delivery_address || "",
      delivery_city: order.delivery_city || "",
      delivery_state: order.delivery_state || "",
      delivery_pincode: order.delivery_pincode || "",
      mode_of_delivery: order.mode_of_delivery || "",
    });
    setEditingOrder(order);
  };

  // Save Edit
  const handleSaveEdit = async () => {
    if (!editingOrder) return;

    setActionLoading(editingOrder.id);
    try {
      const updatedItems = editingOrder.items?.map((item, i) => {
        if (i === 0) {
          return {
            ...item,
            size: editFormData.size,
            color: typeof item.color === 'object'
              ? { ...item.color, name: editFormData.color }
              : editFormData.color,
          };
        }
        return item;
      });

      const { error } = await supabase
        .from("orders")
        .update({
          items: updatedItems,
          delivery_date: editFormData.delivery_date,
          delivery_address: editFormData.delivery_address,
          delivery_city: editFormData.delivery_city,
          delivery_state: editFormData.delivery_state,
          delivery_pincode: editFormData.delivery_pincode,
          mode_of_delivery: editFormData.mode_of_delivery,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingOrder.id);

      if (error) throw error;

      // Update local state
      setOrders(prev => prev.map(o => {
        if (o.id === editingOrder.id) {
          return {
            ...o,
            items: updatedItems,
            delivery_date: editFormData.delivery_date,
            delivery_address: editFormData.delivery_address,
            delivery_city: editFormData.delivery_city,
            delivery_state: editFormData.delivery_state,
            delivery_pincode: editFormData.delivery_pincode,
            mode_of_delivery: editFormData.mode_of_delivery,
          };
        }
        return o;
      }));

      setEditingOrder(null);
      alert("Order updated successfully!");
    } catch (err) {
      console.error("Save edit error:", err);
      alert("Failed to save: " + err.message);
    } finally {
      setActionLoading(null);
    }
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
      alert("Failed to download attachments");
    } finally {
      setAttachmentLoading(null);
    }
  };

  // Navigate to Customer Orders
  const viewCustomerOrders = (order) => {
    navigate("/orderHistory", {
      state: {
        customer: {
          user_id: order.user_id,
          name: order.delivery_name,
          email: order.delivery_email,
          phone: order.delivery_phone,
        },
        fromAssociate: true,
      }
    });
  };

  // Navigate from Client Book
  const viewClientOrders = (client) => {
    navigate("/orderHistory", {
      state: {
        customer: {
          user_id: client.user_id,
          name: client.name,
          email: client.email,
          phone: client.phone,
        },
        fromAssociate: true,
      }
    });
  };

  // Get cancellation options based on time
  const getCancellationOptions = (order) => {
    const hoursSince = getHoursSinceOrder(order.created_at);
    const afterDelivery = isAfterDeliveryDate(order.delivery_date);
    const options = [];

    if (hoursSince <= 24) {
      options.push(
        { value: "client_no_longer_wants", label: "Client No Longer Wants The Product" },
        { value: "wh_cannot_expedite", label: "WH Cannot Expedite Production" },
        { value: "new_order_placed", label: "New Order Placed" }
      );
    }

    if (isSM && hoursSince > 24 && !afterDelivery) {
      options.push({ value: "store_credit_given", label: "Store Credit Given" });
    }

    if (afterDelivery) {
      options.push(
        { value: "delayed_delivery", label: "Delayed Delivery" },
        { value: "incorrect_product", label: "Incorrect Product Delivered" },
        { value: "quality_failure", label: "Quality Failure" }
      );
    }

    return options;
  };

  // Get exchange options
  const getExchangeOptions = (order) => {
    const hoursSince = getHoursSinceOrder(order.created_at);
    const afterDelivery = isAfterDeliveryDate(order.delivery_date);
    const isDelivered = order.status?.toLowerCase() === "delivered";
    const options = [];

    if (afterDelivery || isDelivered) {
      options.push(
        { value: "exchange_size", label: "Product Exchange (Size)" },
        { value: "exchange_other", label: "Product Exchange (Other)" },
        { value: "client_not_like_product", label: "Client Did Not Like Product" },
        { value: "client_not_like_quality", label: "Client Did Not Like Quality" }
      );
    }

    if (isSM && hoursSince > 24 && !afterDelivery) {
      options.push({ value: "store_credit_given", label: "Store Credit Given" });
    }

    return options;
  };

  // Check permissions
  const canEdit = (order) => getHoursSinceOrder(order.created_at) <= 36;
  const canCancel = (order) => {
    const hoursSince = getHoursSinceOrder(order.created_at);
    const afterDelivery = isAfterDeliveryDate(order.delivery_date);
    return hoursSince <= 24 || afterDelivery || (isSM && hoursSince > 24);
  };
  const canExchangeReturn = (order) => {
    const afterDelivery = isAfterDeliveryDate(order.delivery_date);
    const isDelivered = order.status?.toLowerCase() === "delivered";
    const hoursSince = getHoursSinceOrder(order.created_at);
    return afterDelivery || isDelivered || (isSM && hoursSince > 24);
  };
  const canMarkDelivered = (order) => {
    const status = order.status?.toLowerCase();
    return status !== "delivered" && status !== "cancelled" && status !== "exchange_return";
  };

  // Get status badge style
  const getStatusBadgeClass = (status) => {
    switch (status?.toLowerCase()) {
      case "delivered": return "ad-status-delivered";
      case "cancelled": return "ad-status-cancelled";
      case "exchange_return": return "ad-status-exchange";
      case "processing": return "ad-status-processing";
      default: return "ad-status-active";
    }
  };

  // Filter clients based on search
  const filteredClients = clients.filter((client) => {
    if (!clientSearch.trim()) return true;
    const q = clientSearch.toLowerCase();
    const name = client.name?.toLowerCase() || "";
    const phone = client.phone?.toLowerCase() || "";
    return name.includes(q) || phone.includes(q);
  });

  if (loading) return <p className="loading-text">Loading Dashboard...</p>;

  const ordersByDate = orders.reduce((acc, order) => {
    const date = order.delivery_date ? formatDate(order.delivery_date) : null;
    if (date) {
      acc[date] = (acc[date] || 0) + 1;
    }
    return acc;
  }, {});

  const filteredOrders = orders.filter((order) => {
    if (!orderSearch.trim()) return true;
    const q = orderSearch.toLowerCase();
    const productName = order.items?.[0]?.product_name?.toLowerCase() || "";
    const productId = String(order.id || "").toLowerCase();
    const clientName = order.delivery_name?.toLowerCase() || "";
    return productId.includes(q) || productName.includes(q) || clientName.includes(q);
  });

  // console.log(orders);


  const MIN_CALENDAR_DATE = new Date(2025, 11, 1);

  return (
    <div className="ad-dashboardContent">
      {showPasswordModal && (
        <div className="ad-password-modal">
          <div className="ad-password-box">
            <h3>Re-enter Password</h3>
            <div className="ad-password-input-wrapper">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Enter password"
                value={enteredPassword}
                onChange={(e) => setEnteredPassword(e.target.value)}
              />
              <p
                type="button"
                className="ad-eye-btn"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ?
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" /></svg>
                  :
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-closed-icon lucide-eye-closed"><path d="m15 18-.722-3.25" /><path d="M2 8a10.645 10.645 0 0 0 20 0" /><path d="m20 15-1.726-2.05" /><path d="m4 15 1.726-2.05" /><path d="m9 18 .722-3.25" /></svg>
                }
              </p>
            </div>
            {passwordError && <p className="ad-error-text">{passwordError}</p>}
            <button onClick={verifyPassword}>Verify</button>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingOrder && (
        <div className="ad-edit-modal">
          <div className="ad-edit-box">
            <h3>Edit Order</h3>
            <button className="ad-close-modal" onClick={() => setEditingOrder(null)}>✕</button>

            <div className="ad-edit-form">
              <div className="ad-edit-row">
                <div className="ad-edit-field">
                  <label>Size</label>
                  <select
                    value={editFormData.size}
                    onChange={(e) => setEditFormData({ ...editFormData, size: e.target.value })}
                  >
                    <option value="">Select Size</option>
                    {["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL"].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="ad-edit-field">
                  <label>Color</label>
                  <input
                    type="text"
                    value={editFormData.color}
                    onChange={(e) => setEditFormData({ ...editFormData, color: e.target.value })}
                  />
                </div>
              </div>

              <div className="ad-edit-row">
                <div className="ad-edit-field">
                  <label>Delivery Date</label>
                  <input
                    type="date"
                    value={editFormData.delivery_date}
                    onChange={(e) => setEditFormData({ ...editFormData, delivery_date: e.target.value })}
                  />
                </div>
                <div className="ad-edit-field">
                  <label>Mode of Delivery</label>
                  <select
                    value={editFormData.mode_of_delivery}
                    onChange={(e) => setEditFormData({ ...editFormData, mode_of_delivery: e.target.value })}
                  >
                    <option value="Home Delivery">Home Delivery</option>
                    <option value="Store Pickup">Store Pickup</option>
                  </select>
                </div>
              </div>

              <div className="ad-edit-field ad-edit-full">
                <label>Delivery Address</label>
                <input
                  type="text"
                  value={editFormData.delivery_address}
                  onChange={(e) => setEditFormData({ ...editFormData, delivery_address: e.target.value })}
                />
              </div>

              <div className="ad-edit-row">
                <div className="ad-edit-field">
                  <label>City</label>
                  <input
                    type="text"
                    value={editFormData.delivery_city}
                    onChange={(e) => setEditFormData({ ...editFormData, delivery_city: e.target.value })}
                  />
                </div>
                <div className="ad-edit-field">
                  <label>State</label>
                  <input
                    type="text"
                    value={editFormData.delivery_state}
                    onChange={(e) => setEditFormData({ ...editFormData, delivery_state: e.target.value })}
                  />
                </div>
                <div className="ad-edit-field">
                  <label>Pincode</label>
                  <input
                    type="text"
                    value={editFormData.delivery_pincode}
                    onChange={(e) => setEditFormData({ ...editFormData, delivery_pincode: e.target.value })}
                  />
                </div>
              </div>

              <div className="ad-edit-actions">
                <button className="ad-edit-cancel" onClick={() => setEditingOrder(null)}>Cancel</button>
                <button
                  className="ad-edit-save"
                  onClick={handleSaveEdit}
                  disabled={actionLoading === editingOrder.id}
                >
                  {actionLoading === editingOrder.id ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={`ad-dashboard-wrapper ${showPasswordModal || editingOrder ? "ad-blurred" : ""}`}>
        <div className="ad-top-header">
          <img src={Logo} className="logo4" alt="logo" />
          {/* <h1 className="ad-order-title">My Dashboard</h1> */}
          <button className="ad-logout-btn ad-desktop-logout-btn" onClick={handleLogout}>↪</button>
          <div className="ad-hamburger-icon" onClick={() => setShowSidebar(!showSidebar)}>
            <div className="ad-bar"></div>
            <div className="ad-bar"></div>
            <div className="ad-bar"></div>
          </div>
        </div>

        <div className={`ad-grid-table ${showSidebar ? "ad-sidebar-open" : ""}`}>
          <aside className={`ad-sidebar ${showSidebar ? "ad-open" : ""}`}>
            <nav className="ad-menu">
              <a className={`ad-menu-item ${activeTab === "profile" ? "active" : ""}`} onClick={() => { setActiveTab("profile"); setShowSidebar(false); }}>View Profile</a>
              <a className={`ad-menu-item ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => { setActiveTab("dashboard"); setShowSidebar(false); }}>Dashboard</a>
              <a className={`ad-menu-item ${activeTab === "calendar" ? "active" : ""}`} onClick={() => { setActiveTab("calendar"); setShowSidebar(false); }}>Calendar</a>
              <a className={`ad-menu-item ${activeTab === "orders" ? "active" : ""}`} onClick={() => { setActiveTab("orders"); setShowSidebar(false); }}>Order History</a>
              <a className={`ad-menu-item ${activeTab === "clients" ? "active" : ""}`} onClick={() => { setActiveTab("clients"); setShowSidebar(false); }}>Client Book</a>
              <a className="ad-menu-item-logout" onClick={handleLogout}>Log Out</a>
            </nav>
          </aside>

          {activeTab === "dashboard" && (
            <>

              <div className="ad-cell ad-total-revenue">
                <div className="ad-stat-card">
                  <p className="ad-stat-title">Total Revenue</p>
                  <div className="ad-stat-content">
                    <span className="ad-stat-value">
                      {showRevenue ? `₹${formatIndianNumber(totalRevenue)}` : "₹ ••••••"}
                    </span>
                    <button
                      className="bg-transparent border-none"
                      onClick={() => setShowRevenue(!showRevenue)}
                    >
                      {showRevenue
                        ?
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" /></svg>
                        :
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-closed-icon lucide-eye-closed"><path d="m15 18-.722-3.25" /><path d="M2 8a10.645 10.645 0 0 0 20 0" /><path d="m20 15-1.726-2.05" /><path d="m4 15 1.726-2.05" /><path d="m9 18 .722-3.25" /></svg>}
                    </button>
                  </div>
                </div>
              </div>
              <div className="ad-cell ad-total-orders">
                <StatCard title="Total Orders" className="gold-text" value={formatIndianNumber(totalOrders)} />
              </div>
              <div className="ad-cell ad-total-clients">
                <StatCard title="Total Clients" value={formatIndianNumber(totalClients)} />
              </div>
              <div className="ad-cell ad-sales-target">
                <div className="ad-sales-card">
                  <div className="ad-sales-header">
                    <div>
                      <p className="ad-sales-label">Sales Target</p>
                      <p className="ad-sales-progress">{totalRevenue >= salesTarget ? "Completed!" : "In Progress"}</p>
                    </div>
                  </div>
                  <div className="ad-sales-scale">
                    <span>₹{formatIndianNumber(totalRevenue)}</span>
                    <span>₹{formatIndianNumber(salesTarget)}</span>
                  </div>
                  <div className="ad-progress-bar">
                    <div
                      className="ad-progress-fill"
                      style={{
                        width: `${Math.min((totalRevenue / salesTarget) * 100, 100)}%`,
                        height: '10px',
                        background: '#d5b85a',
                        borderRadius: '20px'
                      }}
                    ></div>
                  </div>
                </div>
              </div>
              <div className="ad-cell ad-active-orders">
                <div className="ad-orders-card">
                  <div className="ad-card-header">
                    <span className="ad-card-title">Today's Orders ({activeOrders.length})</span>
                    <button className="ad-view-btn" onClick={() => setActiveTab("orders")}>View All</button>
                  </div>
                  <div className="ad-cardbox">
                    {activeOrders.length === 0 ? (
                      <p>No active orders</p>
                    ) : (
                      activeOrders.map((o) => (
                        <div className="ad-order-item" key={o.id}>
                          <p><b>Order No:</b> {o.order_no}</p>
                          <p><b>Client Name:</b> {o.delivery_name}</p>
                          <p><b>Status:</b> {o.status || "Pending"}</p>
                          <p><b>Delivery Date:</b> {formatDate(o.delivery_date)}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
              <aside className="ad-cell ad-alerts-box">
                <div className="ad-alerts-header">
                  <span className="ad-alerts-title">Alerts</span>
                  <button className="ad-view-btn">View All</button>
                </div>
                <div className="ad-alerts-body">No alerts right now.</div>
              </aside>
            </>
          )}

          {activeTab === "orders" && (
            <div className="ad-order-details-wrapper">
              <h2 className="ad-order-title">Order History</h2>
              <div className="ad-order-search-bar">
                <input
                  type="text"
                  placeholder="Search by Order ID, Product Name or Client Name"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                />
              </div>

              <div className="ad-order-list-scroll">
                {filteredOrders.length === 0 && <p className="ad-muted">No orders found for this associate.</p>}

                {filteredOrders.map((order) => {
                  const item = order.items?.[0] || {};
                  const imgSrc = item.image_url || "/placeholder.png";
                  const hoursSince = getHoursSinceOrder(order.created_at);

                  return (
                    <div
                      key={order.id}
                      className="ad-order-card"
                      onClick={() => viewCustomerOrders(order)}
                      style={{ cursor: 'pointer' }}
                    >
                      {/* Badges Row - Top Right */}
                      <div className="ad-order-header">
                        <div className="ad-header-info">
                          <div className="ad-header-item">
                            <span className="ad-header-label">ORDER NO:</span>
                            <span className="ad-header-value">{order.order_no || "—"}</span>
                          </div>
                          <div className="ad-header-item">
                            <span className="ad-header-label">ORDER DATE:</span>
                            <span className="ad-header-value">{formatDate(order.created_at) || "—"}</span>
                          </div>
                          <div className="ad-header-item">
                            <span className="ad-header-label">DELIVERY:</span>
                            <span className="ad-header-value">{formatDate(order.delivery_date) || "—"}</span>
                          </div>
                        </div>
                        <div className="ad-header-actions">
                          <div className={`ad-order-status-badge ${getStatusBadgeClass(order.status)}`}>
                            {order.status || "Pending"}
                          </div>
                          {canEdit(order) && (
                            <div className="ad-editable-badge">
                              Editable ({Math.floor(36 - hoursSince)}h)
                            </div>
                          )}
                          <button
                            className="ad-print-pdf-btn"
                            onClick={(e) => handlePrintCustomerPdf(e, order)}
                            disabled={pdfLoading === order.id}
                          >
                            {pdfLoading === order.id ? "..." : "📄 Customer PDF"}
                          </button>
                          <button
                            className="ad-print-pdf-btn"
                            onClick={(e) => handlePrintWarehousePdf(e, order)}
                            disabled={warehousePdfLoading === order.id}
                          >
                            {warehousePdfLoading === order.id ? "..." : "📄 Warehouse PDF"}
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

                      <div className="ad-order-content">
                        <div className="ad-product-thumb" onClick={() => viewCustomerOrders(order)}>
                          <img src={imgSrc} alt={item.product_name || "Product"} />
                        </div>
                        <div className="ad-product-details">
                          <div className="ad-product-name">
                            <span className="ad-order-label">Product Name:</span>
                            <span className="ad-value">{item.product_name || "—"}</span>
                          </div>
                          <div className="ad-product-name">
                            <span className="ad-order-label">Category:</span>
                            <span className="ad-value">{item.isKids ? "Kids" : "Women"}</span>
                          </div>
                          <div className="ad-product-name">
                            <span className="ad-order-label">Client Name:</span>
                            <span className="ad-value">{order.delivery_name || "—"}</span>
                          </div>
                          <div className="ad-details-grid">
                            <div className="ad-detail-item">
                              <span className="ad-order-label">Amount:</span>
                              <span className="ad-value">₹{formatIndianNumber(order.grand_total)}</span>
                            </div>
                            <div className="ad-detail-item">
                              <span className="ad-order-label">Qty:</span>
                              <span className="ad-value">{order.total_quantity || 1}</span>
                            </div>
                            <div className="ad-detail-item">
                              <span className="ad-order-label">Top:</span>
                              <span className="ad-value">
                                {item.top || "—"}
                                {item.top_color?.hex && (
                                  <>
                                    <span
                                      style={{
                                        display: 'inline-block',
                                        width: 12,
                                        height: 12,
                                        backgroundColor: item.top_color.hex,
                                        borderRadius: '50%',
                                        marginLeft: 6,
                                        border: '1px solid #ccc',
                                        verticalAlign: 'middle'
                                      }}
                                    />
                                    <span style={{ marginLeft: 4 }}>{item.top_color.name}</span>
                                  </>
                                )}
                              </span>
                            </div>
                            <div className="ad-detail-item">
                              <span className="ad-order-label">Bottom:</span>
                              <span className="ad-value">
                                {item.bottom || "—"}
                                {item.bottom_color?.hex && (
                                  <>
                                    <span
                                      style={{
                                        display: 'inline-block',
                                        width: 12,
                                        height: 12,
                                        backgroundColor: item.bottom_color.hex,
                                        borderRadius: '50%',
                                        marginLeft: 6,
                                        border: '1px solid #ccc',
                                        verticalAlign: 'middle'
                                      }}
                                    />
                                    <span style={{ marginLeft: 4 }}>{item.bottom_color.name}</span>
                                  </>
                                )}
                              </span>
                            </div>
                            <div className="ad-detail-item">
                              <span className="ad-order-label">Size:</span>
                              <span className="ad-value">{item.size || "—"}</span>
                            </div>
                          </div>
                          {item.extras && item.extras.length > 0 && (
                            <div className="ad-detail-item" style={{ gridColumn: 'span 2' }}>
                              <span className="ad-order-label">Extras:</span>
                              <span className="ad-value">
                                {item.extras.map((extra, idx) => (
                                  <span key={idx}>
                                    {extra.name}
                                    {extra.color?.hex && (
                                      <>
                                        <span
                                          style={{
                                            display: 'inline-block',
                                            width: 12,
                                            height: 12,
                                            backgroundColor: extra.color.hex,
                                            borderRadius: '50%',
                                            marginLeft: 6,
                                            border: '1px solid #ccc',
                                            verticalAlign: 'middle'
                                          }}
                                        />
                                        <span style={{ marginLeft: 4 }}>{extra.color.name}</span>
                                      </>
                                    )}
                                    {idx < item.extras.length - 1 && <span style={{ margin: '0 8px' }}>|</span>}
                                  </span>
                                ))}
                              </span>
                            </div>
                          )}
                          {/* Additionals */}
                          {item.additionals && item.additionals.filter(a => a.name && a.name.trim() !== "").length > 0 && (
                            <div className="ad-detail-item" style={{ gridColumn: 'span 2' }}>
                              <span className="ad-order-label">Additionals:</span>
                              <span className="ad-value">
                                {item.additionals.filter(a => a.name && a.name.trim() !== "").map((additional, idx, arr) => (
                                  <span key={idx}>
                                    {additional.name} (₹{formatIndianNumber(additional.price)})
                                    {idx < item.additionals.length - 1 && <span style={{ margin: '0 8px' }}>|</span>}
                                  </span>
                                ))}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Action Buttons - Only Mark Delivered */}
                      {canMarkDelivered(order) && (
                        <div className="ad-order-actions">
                          <button
                            className="ad-action-btn ad-delivered-btn"
                            onClick={(e) => handleMarkDelivered(e, order)}
                            disabled={actionLoading === order.id}
                          >
                            {actionLoading === order.id ? "..." : "✓ Mark Delivered"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === "calendar" && (
            <div className="ad-order-details-wrapper">
              <h2 className="ad-order-title">Calendar</h2>

              {/* iPhone-style Calendar */}
              <div className="ad-ios-calendar">
                {/* Month Navigation */}
                <div className="ad-ios-cal-header">
                  <button
                    className="ad-ios-nav-btn"
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
                  <span className="ad-ios-month-year">
                    {new Date(calendarDate).toLocaleString("default", { month: "long", year: "numeric" })}
                  </span>
                  <button
                    className="ad-ios-nav-btn"
                    onClick={() => setCalendarDate(prev => {
                      const d = new Date(prev);
                      d.setMonth(d.getMonth() + 1);
                      return d;
                    })}
                  >
                    ›
                  </button>
                </div>

                {/* Day Labels */}
                <div className="ad-ios-days-row">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
                    <div key={day} className="ad-ios-day-label">{day}</div>
                  ))}
                </div>

                {/* Date Grid */}
                <div className="ad-ios-date-grid">
                  {(() => {
                    const year = new Date(calendarDate).getFullYear();
                    const month = new Date(calendarDate).getMonth();
                    const firstDayOfMonth = new Date(year, month, 1).getDay();
                    const daysInMonth = new Date(year, month + 1, 0).getDate();
                    const totalCells = Math.ceil((firstDayOfMonth + daysInMonth) / 7) * 7;

                    return Array.from({ length: totalCells }).map((_, i) => {
                      const date = i - firstDayOfMonth + 1;
                      if (date <= 0 || date > daysInMonth) {
                        return <div key={i} className="ad-ios-date-cell ad-ios-empty" />;
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
                          className={`ad-ios-date-cell ${isToday ? "ad-ios-today" : ""} ${isSelected ? "ad-ios-selected" : ""} ${orderCount > 0 ? "ad-ios-has-orders" : ""}`}
                          onClick={() => setSelectedCalendarDate(fullDate)}
                        >
                          <span className="ad-ios-date-num">{date}</span>
                          {orderCount > 0 && (
                            <span className="ad-ios-order-count">{orderCount}</span>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* Orders Section Below Calendar */}
              {selectedCalendarDate && (
                <div className="ad-calendar-orders-section">
                  <div className="ad-card-header">
                    <span className="ad-card-title">
                      Orders for {selectedCalendarDate} ({orders.filter(o => formatDate(o.delivery_date) === selectedCalendarDate).length})
                    </span>
                  </div>

                  <div className="ad-calendar-orders-list">
                    {orders.filter(o => formatDate(o.delivery_date) === selectedCalendarDate).length === 0 ? (
                      <p className="ad-muted">No orders scheduled for this date</p>
                    ) : (
                      orders
                        .filter(o => formatDate(o.delivery_date) === selectedCalendarDate)
                        .map((order) => (
                          <div
                            className="ad-order-item"
                            key={order.id}
                            onClick={() => viewCustomerOrders(order)}
                            style={{ cursor: 'pointer' }}
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

          {activeTab === "profile" && salesperson && (
            <div className="ad-order-details-wrapper ad-profile-wrapper">
              <h2 className="ad-profile-title">My Profile</h2>
              <div className="ad-profile-card">
                <div className="ad-profile-row"><span className="ad-label">Name</span><span className="ad-value">{salesperson.saleperson}</span></div>
                <div className="ad-profile-row"><span className="ad-label">Email</span><span className="ad-value">{salesperson.email}</span></div>
                <div className="ad-profile-row"><span className="ad-label">Phone</span><span className="ad-value">{formatPhoneNumber(salesperson.personal_phone)}</span></div>
                <div className="ad-profile-row"><span className="ad-label">Joining Date</span><span className="ad-value">{formatDate(salesperson.join_date)}</span></div>
                <div className="ad-profile-row"><span className="ad-label">Store Name</span><span className="ad-value">{salesperson.store_name}</span></div>
                <div className="ad-profile-row"><span className="ad-label">Designation</span><span className="ad-value">{salesperson.designation}</span></div>
              </div>
            </div>
          )}

          {activeTab === "clients" && (
            <div className="ad-order-details-wrapper">
              <h2 className="ad-order-title">Client Book ({filteredClients.length})</h2>

              {/* Client Search Bar */}
              <div className="ad-order-search-bar">
                <input
                  type="text"
                  placeholder="Search by Client Name or Phone Number"
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                />
              </div>

              {clientsLoading ? (
                <p className="ad-loading-text">Loading clients...</p>
              ) : filteredClients.length === 0 ? (
                <p className="ad-muted">{clientSearch ? "No clients found matching your search" : "No client found"}</p>
              ) : (
                <div className="ad-table-wrapper">
                  <table className="ad-clients-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        {/* <th>Email</th> */}
                        <th>Phone</th>
                        {/* <th>Gender</th>
                        <th>Date of Birth</th> */}
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredClients.map((c, i) => (
                        <tr key={i}>
                          <td data-label="Name">{c.name}</td>
                          {/* <td data-label="Email">{c.email}</td> */}
                          <td data-label="Phone">{c.phone}</td>
                          {/* <td data-label="Gender">{c.gender}</td> */}
                          {/* <td data-label="Date of Birth">{formatDate(c.dob)}</td> */}
                          <td data-label="Action">
                            <button
                              className="ad-view-btn"
                              onClick={() => viewClientOrders(c)}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <button
          className="ad-add-btn"
          onClick={async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) sessionStorage.setItem("associateSession", JSON.stringify(session));
            sessionStorage.setItem("returnToAssociate", "true");
            sessionStorage.setItem("requirePasswordVerificationOnReturn", "true");
            navigate("/buyerVerification", { state: { fromAssociate: true } });
          }}
        >+</button>
      </div>
    </div>
  );
}

function StatCard({ title, value, change }) {
  return (
    <div className="ad-stat-card">
      <p className="ad-stat-title">{title}</p>
      <div className="ad-stat-content">
        <span className="ad-stat-value">{value}</span>
        <span className="ad-stat-change">{change}</span>
      </div>
    </div>
  );
}