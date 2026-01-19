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
import { usePopup } from "../components/Popup";

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

const getHoursSinceDelivery = (deliveredAt) => {
  if (!deliveredAt) return Infinity;
  const deliveryDate = new Date(deliveredAt);
  const now = new Date();
  return (now - deliveryDate) / (1000 * 60 * 60);
};

// Check if order is non-returnable/non-exchangeable
// Refund is still applicable for brand-fault cases
const checkNonReturnable = (order) => {
  const item = order.items?.[0] || {};
  const reasons = [];

  // 1. Custom orders (order_type is "Custom")
  const isCustomOrder = order.order_type === "Custom";
  if (isCustomOrder) reasons.push("Custom order");

  // 2. International orders
  const isInternational = order.delivery_country &&
    order.delivery_country.toLowerCase() !== "india";
  if (isInternational) reasons.push("International order");

  // 3. Discounted / sale items
  const isDiscounted = Number(order.discount_percent) > 0 ||
    Number(order.discount_amount) > 0;
  if (isDiscounted) reasons.push("Discounted/sale item");

  // 4. Orders paid with store credits
  const paidWithStoreCredit = Number(order.store_credit_used) > 0;
  if (paidWithStoreCredit) reasons.push("Store credit order");

  // 5. Gift certificate orders
  const isGiftCertificate = order.is_gift_certificate || item.is_gift_certificate;
  if (isGiftCertificate) reasons.push("Gift certificate");

  // 6. Orders with extras (customized items)
  const hasExtras = item.extras && item.extras.length > 0;
  if (hasExtras) reasons.push("Customized with extras");

  return {
    isNonReturnable: reasons.length > 0,
    reasons
  };
};

// Reason Options
const CANCEL_REASONS = [
  { value: "new_order_placed", label: "New order placed" },
  { value: "change_in_requirement", label: "Change in requirement" },
  { value: "delivery_timeline_not_suitable", label: "Delivery timeline not suitable" },
  { value: "other", label: "Other" },
];

const EXCHANGE_TYPES = [
  { value: "size_exchange", label: "Size Exchange" },
  { value: "product_exchange", label: "Product Exchange" },
];

const PRODUCT_EXCHANGE_REASONS = [
  { value: "fit_not_meet_expectations", label: "Fit did not meet expectations" },
  { value: "style_preference_changed", label: "Style preference changed" },
  { value: "fabric_or_finish_concern", label: "Fabric or finish concern" },
  { value: "color_variation", label: "Color variation" },
  { value: "other", label: "Other" },
];

const RETURN_REASONS = [
  { value: "fit_not_meet_expectations", label: "Fit did not meet expectations" },
  { value: "style_preference_changed", label: "Style preference changed" },
  { value: "fabric_or_finish_concern", label: "Fabric or finish concern" },
  { value: "delivery_timeline_concern", label: "Delivery timeline concern" },
  { value: "change_in_requirement", label: "Change in requirement" },
  { value: "other", label: "Other" },
];

const REFUND_REASONS = [
  { value: "product_was_faulty", label: "Product was faulty" },
  { value: "incorrect_product_delivered", label: "Incorrect product delivered" },
  { value: "delivery_delayed", label: "Delivery delayed" },
  { value: "other", label: "Other" },
];

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

  // Action modal state
  const [actionModal, setActionModal] = useState(null); // { type: 'cancel'|'revoke'|'exchange'|'return'|'refund', order: order }
  const [actionReason, setActionReason] = useState("");
  const [actionOtherReason, setActionOtherReason] = useState("");
  const [exchangeType, setExchangeType] = useState("");
  const [exchangeReason, setExchangeReason] = useState("");

  // Search state
  const [searchQuery, setSearchQuery] = useState("");

  const [attachmentLoading, setAttachmentLoading] = useState(null);

  // Popup hook
  const { showPopup, PopupComponent } = usePopup();

  const isSM = userRole === "SM";

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Customer info
  const customerName = customerFromState?.name || profile?.full_name || "Customer";
  const customerEmail = customerFromState?.email || profile?.email || "";
  const customerPhone = customerFromState?.phone || profile?.phone || "";

  // Image URL helper
  const publicImageUrl = (src) => {
    if (!src) return "/placeholder.png";
    if (/^https?:\/\//i.test(src)) return src;
    const { data } = supabase.storage.from("product-images").getPublicUrl(src);
    return data?.publicUrl || src;
  };

  // Filter orders by search query
  const filteredOrders = useMemo(() => {
    // First, filter by alteration location
    // Show regular orders + In-Store alterations only (not Warehouse alterations)
    const baseOrders = orders.filter((order) => {
      if (order.is_alteration) {
        return order.alteration_location === "In-Store";
      }
      return true;
    });

    // Then apply search filter
    if (!searchQuery.trim()) return baseOrders;

    const query = searchQuery.toLowerCase().trim();
    return baseOrders.filter((order) => {
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
          if (sp.designation.toLowerCase().includes("manager")) {
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

  // ==================== PERMISSION HELPERS ====================

  // 1. Edit - within 36 hrs, Pending only
  const canEdit = (order) => {
    const hoursSince = getHoursSinceOrder(order.created_at);
    return hoursSince <= 36 && order.status?.toLowerCase() === "pending";
  };

  // 2. Cancel - within 24 hrs, Pending only
  const canCancel = (order) => {
    const hoursSince = getHoursSinceOrder(order.created_at);
    return hoursSince <= 24 && order.status?.toLowerCase() === "pending";
  };

  // 3. Revoke - after 24 hrs, Pending only (replaces Cancel)
  const canRevoke = (order) => {
    const hoursSince = getHoursSinceOrder(order.created_at);
    return hoursSince > 24 && order.status?.toLowerCase() === "pending";
  };

  // 4. Check if within 72 hrs post delivery
  const isWithin72HrsPostDelivery = (order) => {
    if (order.status?.toLowerCase() !== "delivered" || !order.delivered_at) return false;
    const hoursSinceDelivery = getHoursSinceDelivery(order.delivered_at);
    return hoursSinceDelivery <= 72;
  };

  // 5. Exchange - within 72 hrs post delivery, NOT for non-returnable items
  const canExchange = (order) => {
    if (!isWithin72HrsPostDelivery(order)) return false;
    const { isNonReturnable } = checkNonReturnable(order);
    return !isNonReturnable;
  };

  // 6. Return for Store Credit - within 72 hrs post delivery, NOT for non-returnable items
  const canReturn = (order) => {
    if (!isWithin72HrsPostDelivery(order)) return false;
    const { isNonReturnable } = checkNonReturnable(order);
    return !isNonReturnable;
  };

  // 7. Refund - within 72 hrs post delivery, available for ALL items (brand-fault only)
  const canRefund = (order) => {
    return isWithin72HrsPostDelivery(order);
  };

  // ==================== ACTION HANDLERS ====================

  // Open action modal
  const openActionModal = (e, type, order) => {
    e.stopPropagation();
    setActionModal({ type, order });
    setActionReason("");
    setActionOtherReason("");
    setExchangeType("");
    setExchangeReason("");
  };

  // Close action modal
  const closeActionModal = () => {
    setActionModal(null);
    setActionReason("");
    setActionOtherReason("");
    setExchangeType("");
    setExchangeReason("");
  };

  // Handle Cancel Order
  const handleCancelOrder = async () => {
    if (!actionModal?.order) return;

    if (!actionReason) {
      showPopup({ type: "warning", title: "Selection Required", message: "Please select a reason", confirmText: "OK" });
      return;
    }

    if (actionReason === "other" && !actionOtherReason.trim()) {
      showPopup({ type: "warning", title: "Input Required", message: "Please provide a reason in the text field", confirmText: "OK" });
      return;
    }

    const order = actionModal.order;
    const finalReason = actionReason === "other" ? `Other: ${actionOtherReason}` : actionReason;

    setActionLoading(order.id);
    try {
      await supabase.from("orders").update({
        status: "cancelled",
        cancellation_reason: finalReason,
        cancelled_at: new Date().toISOString(),
      }).eq("id", order.id);

      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "cancelled", cancellation_reason: finalReason } : o));
      closeActionModal();
      showPopup({ type: "success", title: "Order Cancelled", message: "Order has been cancelled successfully!", confirmText: "OK" });
    } catch (err) {
      showPopup({ type: "error", title: "Error", message: "Failed: " + err.message, confirmText: "OK" });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Revoke Order
  const handleRevokeOrder = async () => {
    if (!actionModal?.order) return;

    const order = actionModal.order;

    setActionLoading(order.id);
    try {
      await supabase.from("orders").update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        cancellation_reason: "Brand-Initiated (Pre-Delivery) - Unable to fulfil order",
      }).eq("id", order.id);

      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "revoked" } : o));
      closeActionModal();
      showPopup({ type: "success", title: "Order Revoked", message: "Order revoked successfully! Full refund will be initiated.", confirmText: "OK" });
    } catch (err) {
      showPopup({ type: "error", title: "Error", message: "Failed: " + err.message, confirmText: "OK" });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Exchange
  const handleExchange = async () => {
    if (!actionModal?.order) return;

    if (!exchangeType) {
      showPopup({ type: "warning", title: "Selection Required", message: "Please select exchange type", confirmText: "OK" });
      return;
    }

    if (exchangeType === "product_exchange") {
      if (!exchangeReason) {
        showPopup({ type: "warning", title: "Selection Required", message: "Please select a reason for product exchange", confirmText: "OK" });
        return;
      }
      if (exchangeReason === "other" && !actionOtherReason.trim()) {
        showPopup({ type: "warning", title: "Input Required", message: "Please provide a reason in the text field", confirmText: "OK" });
        return;
      }
    }

    const order = actionModal.order;
    let finalReason = exchangeType === "size_exchange"
      ? "Size Exchange"
      : exchangeReason === "other"
        ? `Product Exchange - Other: ${actionOtherReason}`
        : `Product Exchange - ${exchangeReason}`;

    setActionLoading(order.id);
    try {
      await supabase.from("orders").update({
        status: "exchange_return",
        exchange_reason: finalReason,
        exchange_requested_at: new Date().toISOString(),
      }).eq("id", order.id);

      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "exchange_return", exchange_reason: finalReason } : o));
      closeActionModal();
      showPopup({ type: "success", title: "Exchange Processed", message: "Exchange request has been processed successfully!", confirmText: "OK" });
    } catch (err) {
      showPopup({ type: "error", title: "Error", message: "Failed: " + err.message, confirmText: "OK" });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Return for Store Credit
  const handleReturn = async () => {
    if (!actionModal?.order) return;

    if (!actionReason) {
      showPopup({ type: "warning", title: "Selection Required", message: "Please select a reason", confirmText: "OK" });
      return;
    }

    if (actionReason === "other" && !actionOtherReason.trim()) {
      showPopup({ type: "warning", title: "Input Required", message: "Please provide a reason in the text field", confirmText: "OK" });
      return;
    }

    const order = actionModal.order;
    const finalReason = actionReason === "other" ? `Other: ${actionOtherReason}` : actionReason;

    setActionLoading(order.id);
    try {
      // Update order status
      await supabase.from("orders").update({
        status: "return_store_credit",
        return_reason: finalReason,
        exchange_requested_at: new Date().toISOString(),
      }).eq("id", order.id);

      // Add store credit to user profile
      const creditAmount = Number(order.grand_total) || 0;
      const expiryDate = new Date();
      expiryDate.setMonth(expiryDate.getMonth() + 12); // 12 months validity

      // Get current store credit
      const currentCredit = Number(profile?.store_credit) || 0;
      const newCredit = currentCredit + creditAmount;

      await supabase.from("profiles").update({
        store_credit: newCredit,
        store_credit_expiry: expiryDate.toISOString().split('T')[0],
      }).eq("id", order.user_id);

      // Update local profile state
      setProfile(prev => ({
        ...prev,
        store_credit: newCredit,
        store_credit_expiry: expiryDate.toISOString().split('T')[0],
      }));

      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "return_store_credit", return_reason: finalReason } : o));
      closeActionModal();
      showPopup({ type: "success", title: "Return Processed", message: `₹${formatIndianNumber(creditAmount)} store credits added to your account. Valid for 12 months.`, confirmText: "OK" });
    } catch (err) {
      showPopup({ type: "error", title: "Error", message: "Failed: " + err.message, confirmText: "OK" });
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Refund Request
  const handleRefund = async () => {
    if (!actionModal?.order) return;

    if (!actionReason) {
      showPopup({ type: "warning", title: "Selection Required", message: "Please select a reason", confirmText: "OK" });
      return;
    }

    if (actionReason === "other" && !actionOtherReason.trim()) {
      showPopup({ type: "warning", title: "Input Required", message: "Please provide a reason in the text field", confirmText: "OK" });
      return;
    }

    const order = actionModal.order;
    const finalReason = actionReason === "other" ? `Other: ${actionOtherReason}` : actionReason;

    setActionLoading(order.id);
    try {
      await supabase.from("orders").update({
        status: "refund_requested",
        refund_reason: finalReason,
        refund_status: "pending",
        exchange_requested_at: new Date().toISOString(),
      }).eq("id", order.id);

      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "refund_requested", refund_reason: finalReason } : o));
      closeActionModal();
      showPopup({ type: "success", title: "Refund Submitted", message: "Refund request submitted successfully! Subject to approval.", confirmText: "OK" });
    } catch (err) {
      showPopup({ type: "error", title: "Error", message: "Failed: " + err.message, confirmText: "OK" });
    } finally {
      setActionLoading(null);
    }
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
      showPopup({ type: "success", title: "Order Updated", message: "Order has been updated successfully!", confirmText: "OK" });
    } catch (err) {
      showPopup({ type: "error", title: "Error", message: "Failed: " + err.message, confirmText: "OK" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleBack = () => {
    if (fromAssociate) navigate("/AssociateDashboard");
    else navigate(-1);
  };

  const handleLogout = async () => {
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
      showPopup({ type: "error", title: "Download Failed", message: "Failed to download attachments. Please try again.", confirmText: "OK" });
    } finally {
      setAttachmentLoading(null);
    }
  };

  const getStatusClass = (status) => {
    switch (status?.toLowerCase()) {
      case "delivered": return "delivered";
      case "cancelled": return "cancelled";
      case "revoked": return "cancelled";
      case "exchange_return": return "exchange";
      case "return_store_credit": return "exchange";
      case "refund_requested": return "exchange";
      default: return "active";
    }
  };

  const getStatusText = (status) => {
    switch (status?.toLowerCase()) {
      case "delivered": return "Delivered";
      case "cancelled": return "Cancelled";
      case "revoked": return "Revoked";
      case "exchange_return": return "Exchange/Return";
      case "return_store_credit": return "Return (Store Credit)";
      case "refund_requested": return "Refund Requested";
      default: return "Active";
    }
  };

  if (loading) return <p className="loading">Loading...</p>;

  // Get current category key for measurements
  const editCategoryKey = CATEGORY_KEY_MAP[editActiveCategory];

  return (
    <div className="oh-page">
      {/* Popup Component */}
      {PopupComponent}

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

      {/* Action Modal */}
      {actionModal && (
        <div className="oh-modal-overlay">
          <div className="oh-modal">
            <div className="oh-modal-header">
              <h3>
                {actionModal.type === "cancel" && "Cancel Order"}
                {actionModal.type === "revoke" && "Revoke Order"}
                {actionModal.type === "exchange" && "Exchange Request"}
                {actionModal.type === "return" && "Return for Store Credit"}
                {actionModal.type === "refund" && "Cash Refund Request"}
              </h3>
              <button className="oh-modal-close" onClick={closeActionModal}>✕</button>
            </div>
            <div className="oh-modal-body">
              <p className="oh-modal-order-info">
                <strong>Order:</strong> {actionModal.order?.order_no} |
                <strong> Amount:</strong> ₹{formatIndianNumber(actionModal.order?.grand_total)}
              </p>

              {/* Cancel Order Form */}
              {actionModal.type === "cancel" && (
                <>
                  <div className="oh-modal-field">
                    <label>Reason for Cancellation *</label>
                    <select
                      value={actionReason}
                      onChange={(e) => setActionReason(e.target.value)}
                      className="oh-select-full"
                    >
                      <option value="">Select Reason</option>
                      {CANCEL_REASONS.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                  {actionReason === "other" && (
                    <div className="oh-modal-field">
                      <label>Please specify *</label>
                      <textarea
                        value={actionOtherReason}
                        onChange={(e) => setActionOtherReason(e.target.value)}
                        placeholder="Enter reason..."
                        className="oh-textarea"
                      />
                    </div>
                  )}
                </>
              )}

              {/* Revoke Order Form */}
              {actionModal.type === "revoke" && (
                <div className="oh-revoke-notice">
                  <p>⚠️ This action is used when the brand is unable to fulfil the order within the committed delivery timeline due to production, operational, or unforeseen constraints.</p>
                  <ul>
                    <li>Order will be cancelled as Brand-Initiated (Pre-Delivery)</li>
                    <li>Full refund will be initiated to the original payment mode</li>
                    <li>Warehouse will be notified to stop production</li>
                  </ul>
                </div>
              )}

              {/* Exchange Form */}
              {actionModal.type === "exchange" && (
                <>
                  <div className="oh-modal-field">
                    <label>Exchange Type *</label>
                    <select
                      value={exchangeType}
                      onChange={(e) => { setExchangeType(e.target.value); setExchangeReason(""); }}
                      className="oh-select-full"
                    >
                      <option value="">Select Type</option>
                      {EXCHANGE_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  {exchangeType === "product_exchange" && (
                    <>
                      <div className="oh-modal-field">
                        <label>Reason for Exchange *</label>
                        <select
                          value={exchangeReason}
                          onChange={(e) => setExchangeReason(e.target.value)}
                          className="oh-select-full"
                        >
                          <option value="">Select Reason</option>
                          {PRODUCT_EXCHANGE_REASONS.map(r => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      </div>
                      {exchangeReason === "other" && (
                        <div className="oh-modal-field">
                          <label>Please specify * (Subject to approval)</label>
                          <textarea
                            value={actionOtherReason}
                            onChange={(e) => setActionOtherReason(e.target.value)}
                            placeholder="Enter reason..."
                            className="oh-textarea"
                          />
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {/* Return Form */}
              {actionModal.type === "return" && (
                <>
                  <div className="oh-modal-field">
                    <label>Reason for Return *</label>
                    <select
                      value={actionReason}
                      onChange={(e) => setActionReason(e.target.value)}
                      className="oh-select-full"
                    >
                      <option value="">Select Reason</option>
                      {RETURN_REASONS.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                  {actionReason === "other" && (
                    <div className="oh-modal-field">
                      <label>Please specify * (Subject to approval)</label>
                      <textarea
                        value={actionOtherReason}
                        onChange={(e) => setActionOtherReason(e.target.value)}
                        placeholder="Enter reason..."
                        className="oh-textarea"
                      />
                    </div>
                  )}
                  <div className="oh-credit-notice">
                    <p>💳 Store Credit: ₹{formatIndianNumber(actionModal.order?.grand_total)} will be added to customer's account</p>
                    <p>📅 Validity: 12 months from today</p>
                  </div>
                </>
              )}

              {/* Refund Form */}
              {actionModal.type === "refund" && (
                <>
                  <div className="oh-modal-field">
                    <label>Reason for Refund * (Brand-fault cases only)</label>
                    <select
                      value={actionReason}
                      onChange={(e) => setActionReason(e.target.value)}
                      className="oh-select-full"
                    >
                      <option value="">Select Reason</option>
                      {REFUND_REASONS.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                  {actionReason === "other" && (
                    <div className="oh-modal-field">
                      <label>Please specify * (Subject to approval)</label>
                      <textarea
                        value={actionOtherReason}
                        onChange={(e) => setActionOtherReason(e.target.value)}
                        placeholder="Enter reason..."
                        className="oh-textarea"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="oh-modal-footer">
              <button className="oh-modal-btn cancel" onClick={closeActionModal}>Cancel</button>
              <button
                className={`oh-modal-btn ${actionModal.type === "cancel" || actionModal.type === "revoke" ? "danger" : "save"}`}
                onClick={() => {
                  if (actionModal.type === "cancel") handleCancelOrder();
                  else if (actionModal.type === "revoke") handleRevokeOrder();
                  else if (actionModal.type === "exchange") handleExchange();
                  else if (actionModal.type === "return") handleReturn();
                  else if (actionModal.type === "refund") handleRefund();
                }}
                disabled={actionLoading === actionModal.order?.id}
              >
                {actionLoading === actionModal.order?.id ? "Processing..." : "Confirm"}
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
            <h4>Store Credits</h4>
            {profile?.store_credit > 0 ? (
              <div className="oh-store-credit-info">
                <p className="oh-credit-amount">₹{formatIndianNumber(profile.store_credit)}</p>
                <p className="oh-credit-expiry">Valid till: {formatDate(profile.store_credit_expiry)}</p>
              </div>
            ) : (
              <p className="muted">No store credits</p>
            )}
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
                const revokeOk = canRevoke(order);
                const exchangeOk = canExchange(order);
                const returnOk = canReturn(order);
                const refundOk = canRefund(order);
                const { isNonReturnable, reasons: nonReturnableReasons } = checkNonReturnable(order);

                return (
                  <div
                    key={order.id}
                    className="oh-order-card"
                    onClick={() => navigate(`/order/${order.id}`, {
                      state: { fromAssociate, customer: customerFromState }
                    })}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Card Header */}
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
                            <span className="oh-value">{order.salesperson || "—"} {order.salesperson_phone && `( ${formatPhoneNumber(order.salesperson_phone)})`}</span>
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
                                  {idx < arr.length - 1 && <span style={{ margin: '0 8px' }}>|</span>}
                                </span>
                              ))}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Card Footer - Actions */}
                    <div className="oh-card-actions">
                      {/* Edit Button */}
                      {editOk && (
                        <button className="oh-btn edit" onClick={(e) => openEditModal(e, order)}>
                          Edit Order
                        </button>
                      )}

                      {/* Cancel Button - within 24 hrs */}
                      {cancelOk && (
                        <button className="oh-btn danger" onClick={(e) => openActionModal(e, "cancel", order)}>
                          Cancel Order
                        </button>
                      )}

                      {/* Revoke Button - after 24 hrs, before delivery */}
                      {revokeOk && (
                        <button className="oh-btn warning" onClick={(e) => openActionModal(e, "revoke", order)}>
                          Revoke Order
                        </button>
                      )}

                      {/* Post-delivery actions */}
                      {/* Exchange - NOT for non-returnable items */}
                      {exchangeOk && (
                        <button className="oh-btn primary" onClick={(e) => openActionModal(e, "exchange", order)}>
                          Exchange
                        </button>
                      )}

                      {/* Return for Store Credit - NOT for non-returnable items */}
                      {returnOk && (
                        <button className="oh-btn secondary" onClick={(e) => openActionModal(e, "return", order)}>
                          Return (Store Credit)
                        </button>
                      )}

                      {/* Refund - available for ALL items (brand-fault only) */}
                      {refundOk && (
                        <button className="oh-btn outline" onClick={(e) => openActionModal(e, "refund", order)}>
                          Refund Request
                        </button>
                      )}

                      {/* Non-returnable notice */}
                      {isWithin72HrsPostDelivery(order) && isNonReturnable && (
                        <div className="oh-non-returnable-notice">
                          <span className="oh-notice-icon">ℹ️</span>
                          <span>Exchange/Return not available: {nonReturnableReasons.join(", ")}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Pagination */}
              {filteredOrders.length > ordersPerPage && (
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

              {/* Store Credits Section */}
              <h3 style={{ marginTop: "30px" }}>Store Credits</h3>
              {profile?.store_credit > 0 ? (
                <div className="oh-store-credit-card">
                  <div className="oh-credit-balance">
                    <span className="oh-credit-label">Available Balance</span>
                    <span className="oh-credit-value">₹{formatIndianNumber(profile.store_credit)}</span>
                  </div>
                  <div className="oh-credit-expiry-info">
                    <span>Valid till: {formatDate(profile.store_credit_expiry)}</span>
                  </div>
                </div>
              ) : (
                <p className="oh-no-measurements">No store credits available.</p>
              )}

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