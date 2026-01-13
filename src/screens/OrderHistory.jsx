import React, { useEffect, useState, useMemo } from "react";
import "./OrderHistory.css";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { useNavigate, useLocation } from "react-router-dom";
import Logo from "../images/logo.png";
import formatIndianNumber from "../utils/formatIndianNumber";
import formatPhoneNumber from "../utils/formatPhoneNumber";
import formatDate from "../utils/formatDate";
import { downloadCustomerPdf, downloadWarehousePdf } from "../utils/pdfUtils";

// Measurement categories and fields (same as Screen4)
const CATEGORY_KEY_MAP = {
  "Kurta/Choga/Kaftan": "KurtaChogaKaftan",
  "Blouse": "Blouse",
  "Anarkali": "Anarkali",
  "Salwar/Dhoti": "SalwarDhoti",
  "Churidaar/Trouser/Pants/Plazo": "ChuridaarTrouserPantsPlazo",
  "Sharara/Gharara": "ShararaGharara",
  "Lehenga": "Lehenga",
};

const measurementCategories = [
  "Kurta/Choga/Kaftan",
  "Blouse",
  "Anarkali",
  "Salwar/Dhoti",
  "Churidaar/Trouser/Pants/Plazo",
  "Sharara/Gharara",
  "Lehenga",
];

const measurementFields = {
  KurtaChogaKaftan: [
    "Height", "Shoulder", "Neck", "Upper Bust", "Bust", "Dart Point",
    "Sleeves", "Bicep", "Arm Hole", "Waist", "Hip", "Length",
    "Front Cross", "Back Cross", "Front Neck", "Back Neck",
  ],
  Blouse: [
    "Shoulder", "Upper Bust", "Bust", "Dart Point", "Sleeves", "Arm Hole",
    "Waist", "Length", "Front Cross", "Back Cross", "Front Neck", "Back Neck",
  ],
  Anarkali: [
    "Shoulder", "Upper Bust", "Bust", "Dart Point", "Sleeves", "Bicep",
    "Arm Hole", "Length", "Front Neck", "Back Neck",
  ],
  SalwarDhoti: ["Waist", "Hip", "Length"],
  ChuridaarTrouserPantsPlazo: [
    "Waist", "Hip", "Length", "Thigh", "Calf", "Ankle", "Knee", "Yoke Length",
  ],
  ShararaGharara: ["Waist", "Hip", "Length"],
  Lehenga: ["Waist", "Hip", "Length"],
};

// Size options
const WOMEN_SIZE_OPTIONS = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL", "8XL"];

const KIDS_SIZE_OPTIONS = [
  "1-2 yrs", "2-3 yrs", "3-4 yrs", "4-5 yrs", "5-6 yrs",
  "6-7 yrs", "7-8 yrs", "8-9 yrs", "9-10 yrs", "10-11 yrs",
  "11-12 yrs", "12-13 yrs", "13-14 yrs", "14-15 yrs", "15-16 yrs",
];

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
  const [measurementsHistory, setMeasurementsHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("orders");
  const [actionLoading, setActionLoading] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [userDesignation, setUserDesignation] = useState("Sales Associate");
  const [pdfLoading, setPdfLoading] = useState(null);
  const [warehousePdfLoading, setWarehousePdfLoading] = useState(null);

  // Colors for dropdown
  const [colors, setColors] = useState([]);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const ordersPerPage = 5;

  // Edit modal state
  const [editingOrder, setEditingOrder] = useState(null);
  const [editFormData, setEditFormData] = useState({});
  const [editActiveCategory, setEditActiveCategory] = useState("Kurta/Choga/Kaftan");
  const [editMeasurements, setEditMeasurements] = useState({});

  // Action dropdowns state
  const [selectedCancellation, setSelectedCancellation] = useState({});
  const [selectedExchange, setSelectedExchange] = useState({});

  // Search state
  // Search state
  const [searchQuery, setSearchQuery] = useState("");

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Customer info
  const customerName = customerFromState?.name || profile?.full_name || "Customer";
  const customerEmail = customerFromState?.email || profile?.email || "";
  const customerPhone = customerFromState?.phone || profile?.phone || "";

  const [attachmentLoading, setAttachmentLoading] = useState(null);

  const isSM = userRole === "SM";

  // Image URL helper
  const publicImageUrl = (src) => {
    if (!src) return "/placeholder.png";
    if (/^https?:\/\//i.test(src)) return src;
    const { data } = supabase.storage.from("product-images").getPublicUrl(src);
    return data?.publicUrl || src;
  };

  // Filter orders by search query
  const filteredOrders = useMemo(() => {
    if (!searchQuery.trim()) return orders;

    const query = searchQuery.toLowerCase().trim();
    return orders.filter((order) => {
      const item = order.items?.[0] || {};
      return (
        order.order_no?.toLowerCase().includes(query) ||
        item.product_name?.toLowerCase().includes(query) ||
        item.sku_id?.toLowerCase().includes(query) ||
        order.status?.toLowerCase().includes(query) ||
        order.delivery_address?.toLowerCase().includes(query) ||
        order.salesperson?.toLowerCase().includes(query)
      );
    });
  }, [orders, searchQuery]);

  // Pagination - use filteredOrders instead of orders
  const totalPages = Math.ceil(filteredOrders.length / ordersPerPage);
  const startIndex = (currentPage - 1) * ordersPerPage;
  const currentOrders = filteredOrders.slice(startIndex, startIndex + ordersPerPage);
  const goToPage = (page) => setCurrentPage(page);
  const goToPrevious = () => setCurrentPage((prev) => Math.max(prev - 1, 1));
  const goToNext = () => setCurrentPage((prev) => Math.min(prev + 1, totalPages));

  const recent = useMemo(() => orders.slice(0, 2), [orders]);

  // Fetch colors
  useEffect(() => {
    const fetchColors = async () => {
      const { data, error } = await supabase
        .from("colors")
        .select("name, hex")
        .order("name");
      if (!error && data) {
        setColors(data);
      }
    };
    fetchColors();
  }, []);

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
        if (sp?.designation) {
          setUserDesignation(sp.designation);
          if (sp.designation.toLowerCase().includes("manager")){
            setUserRole("SM");
          }
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
          // Build orders query
          let query = supabase.from("orders").select("*");

          if (customerFromState.user_id) {
            query = query.eq("user_id", customerFromState.user_id);

            // ✅ Also fetch profile by user_id
            const { data: profileData } = await supabase
              .from("profiles")
              .select("*")
              .eq("id", customerFromState.user_id)
              .single();
            setProfile(profileData || null);

            // ✅ Fetch measurements history
            const { data: measurementsData } = await supabase
              .from("customer_measurements")
              .select("*, orders(order_no)")
              .eq("customer_id", customerFromState.user_id)
              .order("created_at", { ascending: false });
            setMeasurementsHistory(measurementsData || []);

          } else if (customerFromState.email) {
            query = query.eq("delivery_email", customerFromState.email);

            // ✅ Also fetch profile by email
            const { data: profileData } = await supabase
              .from("profiles")
              .select("*")
              .eq("email", customerFromState.email)
              .single();
            setProfile(profileData || null);
          }

          const { data } = await query.order("created_at", { ascending: false });
          setOrders(data || []);

        } else {
          if (!user) { setLoading(false); return; }
          const [{ data: ordersData }, { data: profileData }, { data: measurementsData }] = await Promise.all([
            supabase.from("orders").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
            supabase.from("profiles").select("*").eq("id", user.id).single(),
            supabase.from("customer_measurements").select("*, orders(order_no)").eq("customer_id", user.id).order("created_at", { ascending: false }),
          ]);
          setOrders(ordersData || []);
          setProfile(profileData || null);
          setMeasurementsHistory(measurementsData || []);
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
    return [
      { value: "change_in_requirement", label: "Change in Requirement" },
      { value: "delivery_timeline_no_longer_works", label: "Delivery Timeline No Longer Works" },
      { value: "duplicate_order", label: "Duplicate Order" },
      { value: "order_placed_by_mistake", label: "Order Placed by Mistake" },
    ];
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

    // Get color values
    let topColorVal = "";
    let bottomColorVal = "";

    if (typeof item.top_color === 'object' && item.top_color !== null) {
      topColorVal = item.top_color.name || "";
    } else {
      topColorVal = item.top_color || "";
    }

    if (typeof item.bottom_color === 'object' && item.bottom_color !== null) {
      bottomColorVal = item.bottom_color.name || "";
    } else {
      bottomColorVal = item.bottom_color || "";
    }

    setEditFormData({
      size: item.size || "",
      top: item.top || "",
      bottom: item.bottom || "",
      top_color: topColorVal,
      bottom_color: bottomColorVal,
      delivery_date: order.delivery_date?.slice(0, 10) || "",
      delivery_address: order.delivery_address || "",
      delivery_city: order.delivery_city || "",
      delivery_state: order.delivery_state || "",
      delivery_pincode: order.delivery_pincode || "",
      mode_of_delivery: order.mode_of_delivery || "",
      isKids: item.isKids || item.category === "Kids" || false,
    });

    // Set measurements from the item
    setEditMeasurements(item.measurements || {});
    setEditActiveCategory("Kurta/Choga/Kaftan");
    setEditingOrder(order);
  };

  // Update measurement in edit modal
  const updateEditMeasurement = (categoryKey, field, value) => {
    setEditMeasurements((prev) => ({
      ...prev,
      [categoryKey]: {
        ...(prev[categoryKey] || {}),
        [field]: value,
      },
    }));
  };

  const handleSaveEdit = async () => {
    if (!editingOrder) return;
    setActionLoading(editingOrder.id);
    try {
      // Find the color objects
      const topColorObj = colors.find(c => c.name === editFormData.top_color) || { name: editFormData.top_color, hex: "#888" };
      const bottomColorObj = colors.find(c => c.name === editFormData.bottom_color) || { name: editFormData.bottom_color, hex: "#888" };

      const updatedItems = editingOrder.items?.map((item, i) => {
        if (i === 0) {
          return {
            ...item,
            size: editFormData.size,
            top: editFormData.top,
            bottom: editFormData.bottom,
            top_color: topColorObj,
            bottom_color: bottomColorObj,
            measurements: editMeasurements,
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
      setEditMeasurements({});
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
    // await supabase.auth.signOut();
    navigate("/AssociateDashboard", { replace: true });
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

  // Get current category key for measurements
  const editCategoryKey = CATEGORY_KEY_MAP[editActiveCategory];

  return (
    <div className="oh-page">
      {/* Edit Modal */}
      {editingOrder && (
        <div className="oh-modal-overlay">
          <div className="oh-modal oh-modal-large">
            <div className="oh-modal-header">
              <h3>Edit Order</h3>
              <button className="oh-modal-close" onClick={() => { setEditingOrder(null); setEditMeasurements({}); }}>✕</button>
            </div>
            <div className="oh-modal-body">
              {/* Category Indicator */}
              <div className="oh-category-badge" style={{
                marginBottom: '15px',
                padding: '6px 12px',
                background: editFormData.isKids ? '#e8f5e9' : '#fce4ec',
                borderRadius: '4px',
                display: 'inline-block',
                fontSize: '13px',
                fontWeight: '500',
                color: editFormData.isKids ? '#2e7d32' : '#c2185b'
              }}>
                Category: {editFormData.isKids ? 'Kids' : 'Women'}
              </div>

              {/* Top & Bottom with Colors */}
              <div className="oh-modal-row">
                <div className="oh-modal-field">
                  <label>Top</label>
                  <input
                    type="text"
                    value={editFormData.top}
                    onChange={(e) => setEditFormData({ ...editFormData, top: e.target.value })}
                  />
                </div>
                <div className="oh-modal-field">
                  <label>Top Color</label>
                  <select
                    value={editFormData.top_color}
                    onChange={(e) => setEditFormData({ ...editFormData, top_color: e.target.value })}
                    className="oh-color-select"
                  >
                    <option value="">Select Color</option>
                    {colors.map(c => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="oh-modal-row">
                <div className="oh-modal-field">
                  <label>Bottom</label>
                  <input
                    type="text"
                    value={editFormData.bottom}
                    onChange={(e) => setEditFormData({ ...editFormData, bottom: e.target.value })}
                  />
                </div>
                <div className="oh-modal-field">
                  <label>Bottom Color</label>
                  <select
                    value={editFormData.bottom_color}
                    onChange={(e) => setEditFormData({ ...editFormData, bottom_color: e.target.value })}
                    className="oh-color-select"
                  >
                    <option value="">Select Color</option>
                    {colors.map(c => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="oh-modal-row">
                <div className="oh-modal-field">
                  <label>Size</label>
                  <select value={editFormData.size} onChange={(e) => setEditFormData({ ...editFormData, size: e.target.value })}>
                    <option value="">Select</option>
                    {(editFormData.isKids ? KIDS_SIZE_OPTIONS : WOMEN_SIZE_OPTIONS).map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="oh-modal-field">
                  <label>Delivery Date</label>
                  <input type="date" value={editFormData.delivery_date} onChange={(e) => setEditFormData({ ...editFormData, delivery_date: e.target.value })} />
                </div>
                <div className="oh-modal-field">
                  <label>Mode of Delivery</label>
                  <select value={editFormData.mode_of_delivery} onChange={(e) => setEditFormData({ ...editFormData, mode_of_delivery: e.target.value })}>
                    <option value="Home Delivery">Home Delivery</option>
                    <option value="Delhi Store">Delhi Store</option>
                    <option value="Ludhiana Store">Ludhiana Store</option>
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

              {/* Measurements Section */}
              <div className="oh-measurements-section">
                <h4>Custom Measurements (in)</h4>
                <div className="oh-measure-container">
                  <div className="oh-measure-menu">
                    {measurementCategories.map((cat) => (
                      <div
                        key={cat}
                        className={`oh-measure-item ${editActiveCategory === cat ? "active" : ""}`}
                        onClick={() => setEditActiveCategory(cat)}
                      >
                        {cat}
                      </div>
                    ))}
                  </div>
                  <div className="oh-measure-fields">
                    <div className="oh-measure-grid">
                      {(measurementFields[editCategoryKey] || []).map((field) => (
                        <div className="oh-measure-field" key={field}>
                          <label>{field}</label>
                          <input
                            type="number"
                            value={editMeasurements[editCategoryKey]?.[field] || ""}
                            onChange={(e) => updateEditMeasurement(editCategoryKey, field, e.target.value)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="oh-modal-footer">
              <button className="oh-modal-btn cancel" onClick={() => { setEditingOrder(null); setEditMeasurements({}); }}>Cancel</button>
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
              {/* Search Bar */}
              <div className="oh-search-bar">
                <input
                  type="text"
                  placeholder="Search by Order No, Product, SKU, Status..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="oh-search-input"
                />
                {searchQuery && (
                  <button className="oh-search-clear" onClick={() => setSearchQuery("")}>
                    ✕
                  </button>
                )}
              </div>

              {filteredOrders.length === 0 && (
                <p className="oh-empty">
                  {searchQuery ? `No orders found for "${searchQuery}"` : "No orders found."}
                </p>
              )}

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
                          <span className="oh-header-label">Delivery Date:</span>
                          <span className="oh-header-value">{formatDate(order.delivery_date) || "—"}</span>
                        </div>
                      </div>
                      <div className="oh-card-badges">
                        <span className={`oh-badge ${getStatusClass(order.status)}`}>{getStatusText(order.status)}</span>
                        {editOk && <span className="oh-badge editable">Editable ({Math.floor(36 - hrs)}h)</span>}
                        <button
                          className="ad-print-pdf-btn active"
                          onClick={(e) => handlePrintPdf(e, order)}
                          disabled={pdfLoading === order.id}
                        >
                          {pdfLoading === order.id ? "..." : "📄Customer PDF"}
                        </button>
                        <button
                          className="ad-print-pdf-btn"
                          onClick={(e) => handlePrintWarehousePdf(e, order)}
                          disabled={warehousePdfLoading === order.id}
                        >
                          {warehousePdfLoading === order.id ? "..." : "📄Warehouse PDF"}
                        </button>

                        {/* Attachments Button - Only show if attachments exist */}
                        {order.attachments && order.attachments.length > 0 && (
                          <button
                            className="oh-attachments-btn"
                            onClick={(e) => handleDownloadAttachments(e, order)}
                            disabled={attachmentLoading === order.id}
                            title={`Download ${order.attachments.length} attachment(s)`}
                          >
                            {attachmentLoading === order.id ? "..." : `📎Attachments(${order.attachments.length})`}
                          </button>
                        )}
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
                          <div className="oh-detail">
                            <span className="oh-label">Category:</span>
                            <span className="oh-value">{item.category || (item.isKids ? "Kids" : "Women")}</span>
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
                            <span className="oh-label">{userDesignation}</span>
                            <span className="oh-value">{order.salesperson || "—"} {order.salesperson_phone && `(${formatPhoneNumber(order.salesperson_phone)})`}</span>
                          </div>
                        </div>

                        {item.extras && item.extras.length > 0 && (
                          <div className="oh-extras">
                            <span className="oh-label">Extras:</span>
                            {item.extras.map((ex, i) => (
                              <span key={i} className="oh-extra-tag">
                                {ex.name}
                                {ex.color?.hex && (
                                  <>
                                    <span
                                      style={{
                                        display: 'inline-block',
                                        width: 12,
                                        height: 12,
                                        backgroundColor: ex.color.hex,
                                        borderRadius: '50%',
                                        marginLeft: 6,
                                        border: '1px solid #ccc',
                                        verticalAlign: 'middle'
                                      }}
                                    />
                                    <span style={{ marginLeft: 4 }}>{ex.color.name}</span>
                                  </>
                                )}
                                <span style={{ marginLeft: 4 }}>(₹{formatIndianNumber(ex.price)})</span>
                              </span>
                            ))}
                          </div>
                        )}
                        {/* Additionals */}
                        {item.additionals && item.additionals.filter(a => a.name && a.name.trim() !== "").length > 0 && (
                          <div className="oh-extras" style={{ gridColumn: 'span 2' }}>
                            <span className="oh-label">Additionals:</span>
                            <span className="oh-extra-tag">
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

              {/* Measurements History */}
              <h3 style={{ marginTop: "30px" }}>Measurements History</h3>
              {measurementsHistory.length === 0 ? (
                <p className="oh-no-measurements">No saved measurements found.</p>
              ) : (
                <div className="oh-measurements-history">
                  {measurementsHistory.map((record, idx) => (
                    <div key={record.id || idx} className="oh-measurement-card">
                      <div className="oh-measurement-card-header">
                        <span className="oh-measurement-date">
                          {new Date(record.created_at).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric"
                          })}
                        </span>
                        {record.orders?.order_no && (
                          <span className="oh-measurement-order">Order #{record.orders.order_no}</span>
                        )}
                      </div>
                      <div className="oh-measurement-card-body">
                        {Object.entries(record.measurements || {}).map(([category, fields]) => (
                          <div key={category} className="oh-measurement-category">
                            <strong>{category.replace(/([A-Z])/g, ' $1').trim()}:</strong>
                            <div className="oh-measurement-fields-inline">
                              {Object.entries(fields || {}).map(([field, value]) => (
                                value && <span key={field}>{field}: {value}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Floating Back */}
      <button className="oh-floating-back" onClick={handleBack}>←</button>
    </div>
  );
}