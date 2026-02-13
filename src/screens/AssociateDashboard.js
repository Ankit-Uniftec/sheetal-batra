import React, { useEffect, useState, useMemo } from "react";
import "./AssociateDashboard.css";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Logo from "../images/logo.png";
import formatIndianNumber from "../utils/formatIndianNumber";
import formatPhoneNumber from "../utils/formatPhoneNumber";
import formatDate from "../utils/formatDate";
import { downloadCustomerPdf, downloadWarehousePdf } from "../utils/pdfUtils";
import { usePopup } from "../components/Popup";

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

  // Popup hook
  const { showPopup, PopupComponent } = usePopup();

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

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const ORDERS_PER_PAGE = 20;

  // Check if user is Store Manager
  const isSM = useMemo(() => {
    return salesperson?.designation?.toLowerCase().includes("manager");
  }, [salesperson]);

  // ✅ OPTIMIZED: Memoize heavy calculations
  const stats = useMemo(() => {
    // Filter out Warehouse alterations for all stats
    const displayOrders = orders.filter((o) => {
      if (o.is_alteration) {
        return o.alteration_location === "In-Store";
      }
      return true;
    });

    const totalRevenue = displayOrders.reduce((sum, o) => sum + Number(o.grand_total || 0), 0);
    const totalOrders = displayOrders.length;
    const totalClients = new Set(displayOrders.map((o) => o.user_id)).size;
    const activeOrders = displayOrders.filter(
      (o) => o.status !== "completed" && o.status !== "cancelled" && o.status !== "delivered" &&
        formatDate(o.created_at) === formatDate(new Date())
    );

    return { totalRevenue, totalOrders, totalClients, activeOrders };
  }, [orders]);

  // Sales Target - use DB value or default to 800000
  const DEFAULT_SALES_TARGET = 800000;
  const salesTarget = salesperson?.sales_target > 0 ? salesperson.sales_target : DEFAULT_SALES_TARGET;

  // ✅ OPTIMIZED: Memoize ordersByDate
  const ordersByDate = useMemo(() => {
    return orders.reduce((acc, order) => {
      const date = order.delivery_date ? formatDate(order.delivery_date) : null;
      if (date) {
        acc[date] = (acc[date] || 0) + 1;
      }
      return acc;
    }, {});
  }, [orders]);

  // ✅ OPTIMIZED: Memoize filtered orders
  // Filter out Warehouse alterations - only show regular orders + In-Store alterations
  const filteredOrders = useMemo(() => {
    // First, filter by alteration location
    const baseOrders = orders.filter((order) => {
      if (order.is_alteration) {
        return order.alteration_location === "In-Store";
      }
      return true; // Show all regular orders
    });

    // Then apply search filter
    if (!orderSearch.trim()) return baseOrders;

    const q = orderSearch.toLowerCase();
    return baseOrders.filter((order) => {
      const productName = order.items?.[0]?.product_name?.toLowerCase() || "";
      const productId = String(order.id || "").toLowerCase();
      const clientName = order.delivery_name?.toLowerCase() || "";
      const orderNo = order.order_no?.toLowerCase() || "";
      return productId.includes(q) || productName.includes(q) || clientName.includes(q) || orderNo.includes(q);
    });
  }, [orders, orderSearch]);

  // ✅ OPTIMIZED: Paginated orders
  const paginatedOrders = useMemo(() => {
    const startIndex = (currentPage - 1) * ORDERS_PER_PAGE;
    return filteredOrders.slice(startIndex, startIndex + ORDERS_PER_PAGE);
  }, [filteredOrders, currentPage]);

  // ✅ OPTIMIZED: Memoize filtered clients
  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients;
    const q = clientSearch.toLowerCase();
    return clients.filter((client) => {
      const name = client.name?.toLowerCase() || "";
      const phone = client.phone?.toLowerCase() || "";
      return name.includes(q) || phone.includes(q);
    });
  }, [clients, clientSearch]);

  // ✅ OPTIMIZED: Consolidated password modal check
  useEffect(() => {
    const needsPassword =
      location.state?.fromBuyerVerification ||
      sessionStorage.getItem("fromBuyerVerification") === "true" ||
      sessionStorage.getItem("requirePasswordVerificationOnDashboard") === "true" ||
      sessionStorage.getItem("requirePasswordVerificationOnReturn") === "true";

    if (needsPassword) {
      setShowPasswordModal(true);
      // Clear all flags at once
      sessionStorage.removeItem("fromBuyerVerification");
      sessionStorage.removeItem("requirePasswordVerificationOnDashboard");
      sessionStorage.removeItem("requirePasswordVerificationOnReturn");
    }
  }, [location.state]);

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
    setPasswordError("");
  };

  // ✅ OPTIMIZED: Extract clients from orders (no extra DB query)
  const extractClientsFromOrders = async (orders) => {
    setClientsLoading(true);

    const map = new Map();
    orders.forEach((order) => {
      if (order.user_id) {  // Use user_id as key instead of email
        map.set(order.user_id, {
          name: order.delivery_name,
          email: order.delivery_email,
          phone: order.delivery_phone,
          user_id: order.user_id,
        });
      }
    });

    const uniqueClients = Array.from(map.values());

    if (uniqueClients.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("email, gender, dob")
        .in("email", uniqueClients.map((c) => c.email));

      const profileMap = new Map((profiles || []).map((p) => [p.email, p]));

      const finalClients = uniqueClients.map((c) => ({
        ...c,
        gender: profileMap.get(c.email)?.gender || "—",
        dob: formatDate(profileMap.get(c.email)?.dob),
      }));

      setClients(finalClients);
    }

    setClientsLoading(false);
  };

  // ✅ OPTIMIZED: Single useEffect for ALL data loading (parallel)
  useEffect(() => {
    const loadAllData = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();

        if (!user?.email) {
          console.log('❌ No user - stopping load');
          setLoading(false);
          return;
        }
        // ✅ Fetch salesperson and orders in PARALLEL
        const [salespersonResult, ordersResult] = await Promise.all([
          supabase.from("salesperson").select("*").eq("email", user.email).single(),
          supabase.from("orders").select("*").eq("salesperson_email", user.email).order("created_at", { ascending: false })
        ]);

        if (salespersonResult.data) {
          setSalesperson(salespersonResult.data);
          localStorage.setItem("sp_email", user.email);
        }

        if (ordersResult.data) {
          setOrders(ordersResult.data);

          // ✅ Extract clients from orders (no extra DB query for orders)
          extractClientsFromOrders(ordersResult.data);
        }

        setLoading(false);
      } catch (err) {
        console.error("Load error:", err);
        setLoading(false);
      }
    };

    loadAllData();
  }, []);


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
      await downloadWarehousePdf(order, null, true);
    } catch (error) {
      console.error("PDF download failed:", error);
    } finally {
      setWarehousePdfLoading(null);
    }
  };

  // Mark as Delivered
  const handleMarkDelivered = async (e, order) => {
    e.stopPropagation();

    showPopup({
      type: "confirm",
      title: "Mark as Delivered",
      message: "Mark this order as delivered?",
      confirmText: "Yes, Deliver",
      cancelText: "Cancel",
      onConfirm: async () => {
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

          setOrders(prev => prev.map(o =>
            o.id === order.id ? { ...o, status: "delivered", delivered_at: new Date().toISOString() } : o
          ));

          showPopup({
            type: "success",
            title: "Order Delivered",
            message: "Order marked as delivered!",
            confirmText: "OK",
          });
        } catch (err) {
          console.error("Mark delivered error:", err);
          showPopup({
            type: "error",
            title: "Error",
            message: "Failed to update: " + err.message,
            confirmText: "OK",
          });
        } finally {
          setActionLoading(null);
        }
      },
    });
  };

  // Handle Cancellation
  const handleCancellation = async (e, order) => {
    e.stopPropagation();
    const reason = selectedCancellation[order.id];
    if (!reason) {
      showPopup({
        type: "warning",
        title: "Selection Required",
        message: "Please select a cancellation reason",
        confirmText: "OK",
      });
      return;
    }

    showPopup({
      type: "confirm",
      title: "Cancel Order",
      message: "Are you sure you want to cancel this order?",
      confirmText: "Yes, Cancel",
      cancelText: "No",
      onConfirm: async () => {
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
          showPopup({
            type: "success",
            title: "Order Cancelled",
            message: "Order cancelled successfully!",
            confirmText: "OK",
          });
        } catch (err) {
          console.error("Cancellation error:", err);
          showPopup({
            type: "error",
            title: "Error",
            message: "Failed to cancel: " + err.message,
            confirmText: "OK",
          });
        } finally {
          setActionLoading(null);
        }
      },
    });
  };

  // Handle Exchange/Return
  const handleExchangeReturn = async (e, order) => {
    e.stopPropagation();
    const reason = selectedExchange[order.id];
    if (!reason) {
      showPopup({
        type: "warning",
        title: "Selection Required",
        message: "Please select an exchange/return reason",
        confirmText: "OK",
      });
      return;
    }

    showPopup({
      type: "confirm",
      title: "Exchange/Return",
      message: "Process this exchange/return request?",
      confirmText: "Yes, Process",
      cancelText: "Cancel",
      onConfirm: async () => {
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
          showPopup({
            type: "success",
            title: "Request Processed",
            message: "Exchange/Return processed successfully!",
            confirmText: "OK",
          });
        } catch (err) {
          console.error("Exchange error:", err);
          showPopup({
            type: "error",
            title: "Error",
            message: "Failed to process: " + err.message,
            confirmText: "OK",
          });
        } finally {
          setActionLoading(null);
        }
      },
    });
  };

  // Open Edit Modal
  const openEditModal = (e, order) => {
    e.stopPropagation();
    const item = order.items?.[0] || {};
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
      showPopup({
        type: "success",
        title: "Order Updated",
        message: "Order updated successfully!",
        confirmText: "OK",
      });
    } catch (err) {
      console.error("Save edit error:", err);
      showPopup({
        type: "error",
        title: "Error",
        message: "Failed to save: " + err.message,
        confirmText: "OK",
      });
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
  const canEdit = (order) => getHoursSinceOrder(order.created_at) <= 36 && order.status?.toLowerCase() === "pending";
  const canCancel = (order) => {
    const hoursSince = getHoursSinceOrder(order.created_at);
    return hoursSince <= 24 && order.status?.toLowerCase() === "pending";
  };
  const canExchangeReturn = (order) => {
    const isDelivered = order.status?.toLowerCase() === "delivered";
    if (!isDelivered || !order.delivered_at) return false;

    const hoursSinceDelivery = (new Date() - new Date(order.delivered_at)) / (1000 * 60 * 60);
    return hoursSinceDelivery <= 72;
  };
  const canMarkDelivered = (order) => {
    const status = order.status?.toLowerCase();
    return status !== "delivered" && status !== "cancelled" && status !== "exchange_return" && status !== "revoked";
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

  if (loading) return <p className="loading-text">Loading Dashboard...</p>;

  const MIN_CALENDAR_DATE = new Date(2025, 11, 1);

  return (
    <div className="ad-dashboardContent">
      {/* Popup Component */}
      {PopupComponent}

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
                onKeyDown={(e) => e.key === "Enter" && verifyPassword()}
              />
              <p
                type="button"
                className="ad-eye-btn"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ?
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" /></svg>
                  :
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-eye-closed-icon lucide-eye-closed"><path d="m15 18-.722-3.25" /><path d="M2 8a10.645 10.645 0 0 0 20 0" /><path d="m20 15-1.726-2.05" /><path d="m4 15 1.726-2.05" /><path d="m9 18 .722-3.25" /></svg>
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
        <header className="ad-header">
          <img src={Logo} alt="logo" className="ad-header-logo" onClick={handleLogout} />
          {/* <h1 className="ad-header-title">Associate Dashboard</h1> */}
          <div className="ad-header-right">
            <button className="ad-header-btn" onClick={handleLogout}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-log-out-icon lucide-log-out"><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /></svg>
            </button>
            <div className="ad-hamburger-icon" onClick={() => setShowSidebar(!showSidebar)}>
              <div className="ad-bar"></div>
              <div className="ad-bar"></div>
              <div className="ad-bar"></div>
            </div>
          </div>
        </header>

        <div className={`ad-grid-table ${showSidebar ? "ad-sidebar-open" : ""}`}>
          <aside className={`ad-sidebar ${showSidebar ? "ad-open" : ""}`}>
            {/* <div
              className={`ad-hello-box ad-clickable ${activeTab === "profile" ? "ad-active" : ""}`}
             
            >
              Hello, {salesperson?.saleperson || "Associate"}
            </div> */}
            {/* Logout button for mobile sidebar */}




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
                      {showRevenue ? `₹${formatIndianNumber(stats.totalRevenue)}` : "₹ ••••••"}
                    </span>
                    <button
                      className="bg-transparent border-none"
                      onClick={() => setShowRevenue(!showRevenue)}
                    >
                      {showRevenue ?
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" /></svg>
                        :
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-eye-closed-icon lucide-eye-closed"><path d="m15 18-.722-3.25" /><path d="M2 8a10.645 10.645 0 0 0 20 0" /><path d="m20 15-1.726-2.05" /><path d="m4 15 1.726-2.05" /><path d="m9 18 .722-3.25" /></svg>
                      }
                    </button>
                  </div>
                </div>
              </div>
              <div className="ad-cell ad-total-orders">
                <StatCard title="Total Orders" className="gold-text" value={formatIndianNumber(stats.totalOrders)} />
              </div>
              <div className="ad-cell ad-total-clients">
                <StatCard title="Total Clients" value={formatIndianNumber(stats.totalClients)} />
              </div>
              <div className="ad-cell ad-sales-target">
                <div className="ad-sales-card">
                  <div className="ad-sales-header">
                    <div>
                      <p className="ad-sales-label">Sales Target
                        <span className="ad-sales-percent">({Math.min((stats.totalRevenue / salesTarget) * 100, 100).toFixed(1)}%)</span></p>
                      <p className="ad-sales-progress">{stats.totalRevenue >= salesTarget ? "Completed! " : "In Progress "}</p>
                    </div>
                  </div>
                  <div className="ad-sales-scale">
                    <span>₹{formatIndianNumber(stats.totalRevenue)}</span>
                    <span>₹{formatIndianNumber(salesTarget)}</span>
                  </div>
                  <div className="ad-progress-bar">
                    <div
                      className="ad-progress-fill"
                      style={{
                        width: `${Math.min((stats.totalRevenue / salesTarget) * 100, 100)}%`,
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
                    <span className="ad-card-title">Today's Orders ({stats.activeOrders.length})</span>
                    <button className="ad-view-btn" onClick={() => setActiveTab("orders")}>View All</button>
                  </div>
                  <div className="ad-cardbox">
                    {stats.activeOrders.length === 0 ? (
                      <p>No active orders</p>
                    ) : (
                      stats.activeOrders.map((o) => (
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
                  onChange={(e) => {
                    setOrderSearch(e.target.value);
                    setCurrentPage(1); // Reset to first page on search
                  }}
                />
              </div>

              <div className="ad-order-list-scroll">
                {filteredOrders.length === 0 && <p className="ad-muted">No orders found for this associate.</p>}

                {paginatedOrders.map((order) => {
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
                          {item.additionals && item.additionals.filter(a => a.name && a.name.trim() !== "").length > 0 && (
                            <div className="ad-detail-item" style={{ gridColumn: 'span 2' }}>
                              <span className="ad-order-label">Additionals:</span>
                              <span className="ad-value">
                                {item.additionals.filter(a => a.name && a.name.trim() !== "").map((additional, idx, arr) => (
                                  <span key={idx}>
                                    {additional.name} (₹{formatIndianNumber(additional.price)})
                                    {idx < arr.length - 1 && <span style={{ margin: '0 8px' }}>|</span>}
                                  </span>
                                ))}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

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

                {/* Pagination Controls */}
                {filteredOrders.length > ORDERS_PER_PAGE && (
                  <div className="ad-pagination">
                    <button
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(p => p - 1)}
                      className="ad-pagination-btn"
                    >
                      ← Previous
                    </button>
                    <span className="ad-pagination-info">
                      Page {currentPage} of {Math.ceil(filteredOrders.length / ORDERS_PER_PAGE)}
                    </span>
                    <button
                      disabled={currentPage >= Math.ceil(filteredOrders.length / ORDERS_PER_PAGE)}
                      onClick={() => setCurrentPage(p => p + 1)}
                      className="ad-pagination-btn"
                    >
                      Next →
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "calendar" && (
            <div className="ad-order-details-wrapper">
              <h2 className="ad-order-title">Calendar</h2>

              <div className="ad-ios-calendar">
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

                <div className="ad-ios-days-row">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
                    <div key={day} className="ad-ios-day-label">{day}</div>
                  ))}
                </div>

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
                <div className="ad-profile-row"><span className="ad-label">Phone</span><span className="ad-value">+91 {(salesperson.personal_phone)}</span></div>
                <div className="ad-profile-row"><span className="ad-label">Joining Date</span><span className="ad-value">{formatDate(salesperson.join_date)}</span></div>
                <div className="ad-profile-row"><span className="ad-label">Store Name</span><span className="ad-value">{salesperson.store_name}</span></div>
                <div className="ad-profile-row"><span className="ad-label">Designation</span><span className="ad-value">{salesperson.designation}</span></div>
              </div>
            </div>
          )}

          {activeTab === "clients" && (
            <div className="ad-order-details-wrapper">
              <h2 className="ad-order-title">Client Book ({filteredClients.length})</h2>

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
                        <th>Phone</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredClients.map((c, i) => (
                        <tr key={i}>
                          <td data-label="Name">{c.name}</td>
                          <td data-label="Phone">{c.phone}</td>
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

            // ✅ Save salesperson data for the entire order flow
            if (salesperson) {
              sessionStorage.setItem("currentSalesperson", JSON.stringify({
                name: salesperson.saleperson,
                email: salesperson.email,
                phone: salesperson.phone,
                store: salesperson.store_name,
              }));
            }

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