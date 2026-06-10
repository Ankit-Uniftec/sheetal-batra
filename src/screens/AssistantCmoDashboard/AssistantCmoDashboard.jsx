import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { fetchAllRows } from "../../utils/fetchAllRows";
import { isRevenueOrder } from "../../utils/revenue";
import "./AssistantCmoDashboard.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import { splitPhoneNumber } from "../../utils/formatPhoneNumber";
import { usePopup } from "../../components/Popup";
import NotificationBell from "../../components/NotificationBell";
import SearchByDropdown from "../../components/SearchByDropdown";
import WalkInsView from "../../components/WalkInsView/WalkInsView";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line,
} from "recharts";

const TIMELINE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "weekly", label: "Last 7 Days" },
  { value: "monthly", label: "Last 30 Days" },
  { value: "yearly", label: "Last 365 Days" },
  { value: "all", label: "All Time" },
  { value: "custom", label: "Custom" },
];

const COLOR_NAME_MAP = {
  black: "#1a1a1a", white: "#f5f5f5", red: "#c62828", blue: "#1565c0",
  navy: "#0d2137", green: "#2e7d32", yellow: "#f9a825", pink: "#e91e8f",
  purple: "#7b1fa2", orange: "#ef6c00", brown: "#5d4037", beige: "#d7ccc8",
  cream: "#fffdd0", grey: "#757575", gold: "#d5b85a", maroon: "#6a1b29",
  teal: "#008080", coral: "#ff7f50", olive: "#6b8e23", mint: "#98fb98",
  "carnation pink": "#ffa6c9", lavender: "#b39ddb", ivory: "#fffff0",
  mustard: "#e1ad01", rust: "#b7410e", wine: "#722f37", silver: "#bdbdbd",
};

const getColorHex = (name) => {
  if (!name) return "#d5b85a";
  const k = name.toLowerCase().trim();
  if (COLOR_NAME_MAP[k]) return COLOR_NAME_MAP[k];
  for (const [key, hex] of Object.entries(COLOR_NAME_MAP)) {
    if (k.includes(key) || key.includes(k)) return hex;
  }
  return "#d5b85a";
};

const PlaceholderCard = ({ title, note }) => (
  <div className="acmo-stat-card acmo-placeholder-card">
    <div className="acmo-placeholder-badge">Coming Soon</div>
    <p className="acmo-stat-title">{title}</p>
    <p className="acmo-placeholder-note">{note || "Data source pending"}</p>
  </div>
);

const StatCard = ({ title, value, subtitle, highlight }) => (
  <div className={`acmo-stat-card ${highlight ? "acmo-highlight" : ""}`}>
    <p className="acmo-stat-title">{title}</p>
    <p className="acmo-stat-value">{value}</p>
    {subtitle && <p className="acmo-stat-subtitle">{subtitle}</p>}
  </div>
);

// Inline timeline picker — dropdown + optional custom-range inputs. Shared by
// overview, brand performance, and client insights tabs.
const TimelineFilter = ({ timeline, setTimeline, customFrom, setCustomFrom, customTo, setCustomTo }) => (
  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 16 }}>
    <label style={{ fontSize: 13, color: "#666" }}>Showing data for:</label>
    <select
      value={timeline}
      onChange={(e) => setTimeline(e.target.value)}
      style={{ padding: "8px 12px", border: "1px solid #e0d5c5", borderRadius: 8, fontSize: 13, background: "#fff", color: "#333", cursor: "pointer", outline: "none" }}
    >
      {TIMELINE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
    {timeline === "custom" && (
      <>
        <input
          type="date"
          value={customFrom}
          onChange={(e) => setCustomFrom(e.target.value)}
          style={{ padding: "7px 10px", border: "1px solid #e0d5c5", borderRadius: 8, fontSize: 13 }}
        />
        <span style={{ color: "#888", fontSize: 13 }}>to</span>
        <input
          type="date"
          value={customTo}
          onChange={(e) => setCustomTo(e.target.value)}
          style={{ padding: "7px 10px", border: "1px solid #e0d5c5", borderRadius: 8, fontSize: 13 }}
        />
      </>
    )}
  </div>
);

export default function AssistantCmoDashboard() {
  const { showPopup, PopupComponent } = usePopup();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("overview");
  // Date-wise filter for overview / brand performance / client insights tabs.
  // Defaults to "all" — viewing the full dataset is the most useful starting
  // point on this dashboard (CMO ops, not daily SA-style monitoring).
  const [timeline, setTimeline] = useState("all");
  const [customDateFrom, setCustomDateFrom] = useState("");
  const [customDateTo, setCustomDateTo] = useState("");
  // Set when user clicks a top-product row. The Orders tab reads this on
  // mount via an effect to pre-fill the search box with the product name.
  const [productFilterForOrders, setProductFilterForOrders] = useState("");

  // Orders tab state
  const [orderSearch, setOrderSearch] = useState("");
  const [orderSearchField, setOrderSearchField] = useState("order_no");
  const [orderStatusTab, setOrderStatusTab] = useState("all");
  const [orderSortBy, setOrderSortBy] = useState("newest");
  const [ordersPage, setOrdersPage] = useState(1);
  // Order-date range filter (by created_at). "" = no bound.
  const [orderDateFrom, setOrderDateFrom] = useState("");
  const [orderDateTo, setOrderDateTo] = useState("");
  const ORDERS_PER_PAGE = 20;

  // Client Book tab state
  const [clientSearch, setClientSearch] = useState("");
  const [clientStoreFilter, setClientStoreFilter] = useState("all");
  const [clientsPage, setClientsPage] = useState(1);
  // Client Book order-date range filter — limits to clients whose orders fall
  // in the range (by order created_at). "" = no bound.
  const [clientDateFrom, setClientDateFrom] = useState("");
  const [clientDateTo, setClientDateTo] = useState("");
  const CLIENTS_PER_PAGE = 25;
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [consignment, setConsignment] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  // Logged-in user's salesperson row. Drives the gated Stock Order sidebar item.
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [showSidebar, setShowSidebar] = useState(false);

  useEffect(() => {
    const checkAuthAndFetch = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/login", { replace: true }); return; }

      const { data: userRecord } = await supabase
        .from("salesperson")
        .select("saleperson, role, email, phone, store_name, designation, can_place_stock_orders")
        .eq("email", session.user.email?.toLowerCase())
        .single();

      if (!userRecord || userRecord.role !== "assistant_cmo") {
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
        return;
      }

      setCurrentUserEmail(session.user.email?.toLowerCase() || "");
      setCurrentUserProfile(userRecord);
      fetchAllData();
    };
    checkAuthAndFetch();
  }, [navigate]);

  // Stock-order entry — same flow as SA dashboard. Gated on
  // salesperson.can_place_stock_orders.
  const handleStartStockOrder = async () => {
    if (!currentUserProfile) {
      showPopup({
        title: "Access Denied",
        message: "User profile not loaded. Please refresh and try again.",
        type: "error",
        confirmText: "Ok",
      });
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (session) sessionStorage.setItem("associateSession", JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      user: { email: session.user?.email },
    }));
    sessionStorage.setItem("returnToAssociate", "true");
    // Route back to the assistant-CMO dashboard after the order is placed.
    // Without this, OrderPlaced.handleBackToDashboard defaults to
    // /AssociateDashboard, whose role check fails and logs out non-SA users.
    sessionStorage.setItem("returnDashboard", "/assistant-cmo-dashboard");
    sessionStorage.setItem("requirePasswordVerificationOnReturn", "true");
    sessionStorage.setItem("currentSalesperson", JSON.stringify({
      name: currentUserProfile.saleperson,
      email: currentUserProfile.email,
      phone: currentUserProfile.phone,
      store: currentUserProfile.store_name,
      designation: currentUserProfile.designation,
    }));
    sessionStorage.setItem("isStockOrder", "true");
    sessionStorage.removeItem("screen4FormData");
    sessionStorage.removeItem("screen6FormData");
    navigate("/product", { state: { fromAssociate: true, isStockOrder: true } });
  };

  const fetchAllData = async () => {
    setLoading(true);
    try {
      // Only the order columns this dashboard actually reads. Pulling select("*")
      // dragged the full per-row JSON (measurements, addresses, billing, etc.) —
      // ~1.6 MB and 40s+ over many paginated pages. This narrow list cuts the
      // payload to what the analytics, client book, and order list use.
      const ORDER_COLUMNS = [
        "id", "created_at", "delivered_at", "delivery_date",
        "delivery_email", "delivery_name", "delivery_phone",
        "discount_amount", "grand_total", "grand_total_after_discount", "net_total",
        "is_alteration", "is_b2b", "is_comms",
        "items", "order_no", "refund_status", "return_reason",
        "salesperson", "salesperson_store", "status", "user_id",
      ].join(", ");
      const [ordersRes, productsRes, profilesRes, consRes] = await Promise.all([
        fetchAllRows("orders", (q) => q.select(ORDER_COLUMNS).order("created_at", { ascending: false })),
        supabase.from("products").select("*").order("name", { ascending: true }),
        supabase.from("profiles").select("id, full_name, phone, email, dob, loyalty_points, created_at"),
        supabase.from("consignment_inventory").select("*"),
      ]);
      if (ordersRes.data) setOrders(ordersRes.data.filter(o => !o.is_comms));
      if (productsRes.data) setProducts(productsRes.data);
      if (profilesRes.data) setProfiles(profilesRes.data);
      if (consRes.data) setConsignment(consRes.data);
    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  // ==================== HELPERS ====================
  // Resolve the start/end of the active timeline. Mirrors AdminDashboard's
  // getDateRange so future changes can be unified. "all" returns an open range.
  const getDateRange = (tl) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    switch (tl) {
      case "today": return { start: today, end: now };
      case "yesterday": {
        const y = new Date(today); y.setDate(y.getDate() - 1);
        const yEnd = new Date(today); yEnd.setMilliseconds(-1);
        return { start: y, end: yEnd };
      }
      case "weekly": {
        const d = new Date(today); d.setDate(d.getDate() - 7);
        return { start: d, end: now };
      }
      case "monthly": {
        const d = new Date(today); d.setDate(d.getDate() - 30);
        return { start: d, end: now };
      }
      case "yearly": {
        const d = new Date(today); d.setDate(d.getDate() - 365);
        return { start: d, end: now };
      }
      case "custom":
        return {
          start: customDateFrom ? new Date(customDateFrom) : new Date(0),
          end: customDateTo ? new Date(customDateTo + "T23:59:59") : now,
        };
      case "all":
      default:
        return { start: new Date(0), end: now };
    }
  };

  // The orders slice that the date-aware tabs (overview, brand, clients)
  // compute their metrics from. Other tabs (revenue, product, inventory)
  // still iterate the full `orders` array.
  const dateFilteredOrders = useMemo(() => {
    const range = getDateRange(timeline);
    if (timeline === "all") return orders;
    return orders.filter((o) => {
      if (!o.created_at) return false;
      const d = new Date(o.created_at);
      return d >= range.start && d <= range.end;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, timeline, customDateFrom, customDateTo]);

  const getOrderStore = (o) => {
    if (o.is_b2b) return "B2B";
    const s = (o.salesperson_store || "").trim();
    return s || "Other";
  };

  const getItemColor = (item) => {
    const topColor = typeof item.top_color === "object" ? item.top_color?.name : item.top_color;
    const bottomColor = typeof item.bottom_color === "object" ? item.bottom_color?.name : item.bottom_color;
    const fallback = typeof item.color === "object" ? item.color?.name : item.color;
    return topColor || fallback || bottomColor;
  };

  // Revenue rule (received minus cancelled/refunded) — imported from the
  // shared src/utils/revenue.js so every dashboard stays consistent.

  // ==================== OVERVIEW (Bhawna's own section) ====================
  const overview = useMemo(() => {
    // Scoped to the active timeline (see dateFilteredOrders memo).
    const _orders = dateFilteredOrders;
    // Store-wise sales
    const storeMap = {};
    _orders.forEach((o) => {
      const store = getOrderStore(o);
      if (!storeMap[store]) storeMap[store] = { name: store, orderCount: 0, revenue: 0, refundCount: 0, cancelCount: 0, returnCount: 0 };
      storeMap[store].orderCount += 1;
      if (isRevenueOrder(o)) storeMap[store].revenue += Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0);
      if (o.refund_status === "processed" || o.refund_status === "completed" || o.refund_status === "refunded") storeMap[store].refundCount += 1;
      if (o.status === "cancelled") storeMap[store].cancelCount += 1;
      if (o.return_reason || o.status === "returned") storeMap[store].returnCount += 1;
    });

    // Product-wise sales analytics (overall + per-store).
    // Per-store enables the "Top products by store" view used for ad targeting.
    const productMap = {};
    const productByStoreMap = {}; // { storeName: { productName: {qty, revenue} } }
    _orders.forEach((o) => {
      if (!isRevenueOrder(o)) return;
      const store = getOrderStore(o);
      if (!productByStoreMap[store]) productByStoreMap[store] = {};
      (o.items || []).forEach((item) => {
        const name = item.product_name;
        if (!name) return;
        const qty = Number(item.quantity || 1);
        const rev = Number(item.price || 0) * qty;
        if (!productMap[name]) productMap[name] = { name, qty: 0, revenue: 0 };
        productMap[name].qty += qty;
        productMap[name].revenue += rev;
        const storeMap = productByStoreMap[store];
        if (!storeMap[name]) storeMap[name] = { name, qty: 0, revenue: 0 };
        storeMap[name].qty += qty;
        storeMap[name].revenue += rev;
      });
    });
    const topProducts = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
    // Per-store top-10 by revenue. Stores with no products are excluded.
    const topProductsByStore = Object.entries(productByStoreMap)
      .map(([store, pm]) => ({
        store,
        products: Object.values(pm).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
      }))
      .filter((s) => s.products.length > 0)
      .sort((a, b) => a.store.localeCompare(b.store));

    // Refund / Cancellation / Return totals
    const refunds = _orders.filter((o) => o.refund_status === "processed" || o.refund_status === "completed" || o.refund_status === "refunded");
    const cancellations = _orders.filter((o) => o.status === "cancelled");
    const returns = _orders.filter((o) => o.return_reason || o.status === "returned");
    const refundValue = refunds.reduce((s, o) => s + Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0), 0);
    const cancelValue = cancellations.reduce((s, o) => s + Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0), 0);
    const returnValue = returns.reduce((s, o) => s + Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0), 0);

    // Discount impact
    let totalDiscount = 0;
    let ordersWithDiscount = 0;
    _orders.forEach((o) => {
      const d = Number(o.discount_amount || 0);
      if (d > 0) {
        totalDiscount += d;
        ordersWithDiscount += 1;
      }
    });
    const avgDiscount = ordersWithDiscount > 0 ? totalDiscount / ordersWithDiscount : 0;

    // Return reason analytics
    const returnReasonMap = {};
    returns.forEach((o) => {
      const reason = (o.return_reason || "Not specified").trim();
      if (!returnReasonMap[reason]) returnReasonMap[reason] = { name: reason, count: 0 };
      returnReasonMap[reason].count += 1;
    });
    const returnReasons = Object.values(returnReasonMap).sort((a, b) => b.count - a.count);

    // Target progress (store-level only — no SA breakdown)
    const storeTargets = {};
    Object.values(storeMap).forEach((s) => {
      storeTargets[s.name] = { name: s.name, revenue: s.revenue };
    });

    return {
      storePerformance: Object.values(storeMap),
      topProducts,
      topProductsByStore,
      refundCount: refunds.length, refundValue,
      cancelCount: cancellations.length, cancelValue,
      returnCount: returns.length, returnValue,
      totalDiscount, avgDiscount, ordersWithDiscount,
      returnReasons,
      storeTargets: Object.values(storeTargets),
    };
  }, [dateFilteredOrders]);

  // ==================== BRAND PERFORMANCE ====================
  const brandPerformance = useMemo(() => {
    // Scoped to the active timeline.
    const _orders = dateFilteredOrders;
    let totalRefundQty = 0;
    let totalRefundValue = 0;
    _orders.forEach((o) => {
      if (o.refund_status === "processed" || o.refund_status === "completed" || o.refund_status === "refunded") {
        totalRefundQty += 1;
        totalRefundValue += Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0);
      }
    });

    // Top products + colors (overall)
    const productMap = {};
    const colorMap = {};
    _orders.forEach((o) => {
      if (!isRevenueOrder(o)) return;
      (o.items || []).forEach((item) => {
        const name = item.product_name;
        const color = getItemColor(item);
        const qty = Number(item.quantity || 1);
        if (name) {
          if (!productMap[name]) productMap[name] = { name, count: 0 };
          productMap[name].count += qty;
        }
        if (color) {
          if (!colorMap[color]) colorMap[color] = { name: color, count: 0 };
          colorMap[color].count += qty;
        }
      });
    });

    const sortedColors = Object.values(colorMap).sort((a, b) => b.count - a.count);

    return {
      totalRefundQty, totalRefundValue,
      topProducts: Object.values(productMap).sort((a, b) => b.count - a.count).slice(0, 10),
      topColors: sortedColors.slice(0, 8),
      bottomColors: sortedColors.slice(-5).reverse(),
    };
  }, [dateFilteredOrders]);

  // ==================== REVENUE & DRIVERS ====================
  const revenueMetrics = useMemo(() => {
    const now = new Date();
    const today = now.toDateString();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toDateString();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
    const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;

    let todayRev = 0, yesterdayRev = 0, mtdRev = 0, lastMonthRev = 0, ytdRev = 0, lastYearRev = 0;
    let mtdCount = 0, ytdCount = 0;

    orders.forEach((o) => {
      if (!isRevenueOrder(o)) return;
      const d = new Date(o.delivered_at || o.created_at);
      if (isNaN(d.getTime())) return;
      const amt = Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0);

      if (d.toDateString() === today) { todayRev += amt; }
      if (d.toDateString() === yesterday) yesterdayRev += amt;
      if (d.getMonth() === thisMonth && d.getFullYear() === thisYear) {
        mtdRev += amt;
        mtdCount += 1;
      }
      if (d.getMonth() === lastMonth && d.getFullYear() === lastMonthYear) lastMonthRev += amt;
      if (d.getFullYear() === thisYear) {
        ytdRev += amt;
        ytdCount += 1;
      }
      if (d.getFullYear() === thisYear - 1) lastYearRev += amt;
    });

    const aovOverall = ytdCount > 0 ? ytdRev / ytdCount : 0;
    const aovMtd = mtdCount > 0 ? mtdRev / mtdCount : 0;

    // AOV per store (YTD basis, same scope as aovOverall). Lets CMO compare
    // ticket size across locations.
    const aovStoreMap = {};
    orders.forEach((o) => {
      if (!isRevenueOrder(o)) return;
      const d = new Date(o.delivered_at || o.created_at);
      if (isNaN(d.getTime())) return;
      if (d.getFullYear() !== thisYear) return;
      const store = getOrderStore(o);
      if (!aovStoreMap[store]) aovStoreMap[store] = { name: store, revenue: 0, count: 0 };
      aovStoreMap[store].revenue += Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0);
      aovStoreMap[store].count += 1;
    });
    const aovByStore = Object.values(aovStoreMap)
      .map((s) => ({ ...s, aov: s.count > 0 ? s.revenue / s.count : 0 }))
      .sort((a, b) => b.aov - a.aov);

    const dailyGrowth = yesterdayRev > 0 ? (((todayRev - yesterdayRev) / yesterdayRev) * 100).toFixed(1) : (todayRev > 0 ? "100.0" : "0.0");
    const momGrowth = lastMonthRev > 0 ? (((mtdRev - lastMonthRev) / lastMonthRev) * 100).toFixed(1) : (mtdRev > 0 ? "100.0" : "0.0");
    const yoyGrowth = lastYearRev > 0 ? (((ytdRev - lastYearRev) / lastYearRev) * 100).toFixed(1) : (ytdRev > 0 ? "100.0" : "0.0");

    // Last 12 months trend
    const monthsTrend = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(thisYear, thisMonth - i, 1);
      const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      let monthRev = 0;
      orders.forEach((o) => {
        if (!isRevenueOrder(o)) return;
        const od = new Date(o.delivered_at || o.created_at);
        if (od.getMonth() === d.getMonth() && od.getFullYear() === d.getFullYear()) {
          monthRev += Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0);
        }
      });
      monthsTrend.push({ month: label, revenue: Math.round(monthRev) });
    }

    return {
      todayRev, yesterdayRev, mtdRev, lastMonthRev, ytdRev, lastYearRev,
      aovOverall, aovMtd, aovByStore,
      dailyGrowth, momGrowth, yoyGrowth,
      monthsTrend,
    };
  }, [orders]);

  // ==================== PRODUCT & STYLE ====================
  const productStyle = useMemo(() => {
    const productMap = {};
    const productByStore = {};
    const colorMap = {};
    const returnStyleMap = {};
    const alterationStyleMap = {};
    let totalAlterations = 0;
    let alterationItemCount = 0;

    orders.forEach((o) => {
      const store = getOrderStore(o);
      (o.items || []).forEach((item) => {
        const name = item.product_name;
        const color = getItemColor(item);
        const qty = Number(item.quantity || 1);

        if (isRevenueOrder(o)) {
          if (name) {
            if (!productMap[name]) productMap[name] = { name, count: 0 };
            productMap[name].count += qty;

            const key = `${name}||${store}`;
            if (!productByStore[key]) productByStore[key] = { product: name, store, count: 0 };
            productByStore[key].count += qty;
          }
          if (color) {
            if (!colorMap[color]) colorMap[color] = { name: color, count: 0 };
            colorMap[color].count += qty;
          }
        }

        if (o.is_alteration && name) {
          if (!alterationStyleMap[name]) alterationStyleMap[name] = { name, count: 0 };
          alterationStyleMap[name].count += 1;
          totalAlterations += 1;
          alterationItemCount += 1;
        }

        if (name) {
          if (!returnStyleMap[name]) returnStyleMap[name] = { name, returnCount: 0, totalCount: 0 };
          returnStyleMap[name].totalCount += 1;
          if (o.return_reason || o.status === "returned") returnStyleMap[name].returnCount += 1;
        }
      });
    });

    const sortedProducts = Object.values(productMap).sort((a, b) => b.count - a.count);
    const sortedColors = Object.values(colorMap).sort((a, b) => b.count - a.count);

    const highAlterationStyles = Object.values(alterationStyleMap).sort((a, b) => b.count - a.count).slice(0, 10);
    const repetitiveAlterations = highAlterationStyles.filter((s) => s.count >= 3);
    const avgAlterationsPerOutfit = alterationItemCount > 0 ? (totalAlterations / alterationItemCount).toFixed(2) : "0.00";

    const highReturnStyles = Object.values(returnStyleMap)
      .filter((s) => s.totalCount >= 3)
      .map((s) => ({ ...s, returnRate: ((s.returnCount / s.totalCount) * 100).toFixed(1) }))
      .sort((a, b) => Number(b.returnRate) - Number(a.returnRate))
      .slice(0, 10);

    return {
      topProducts: sortedProducts.slice(0, 10),
      bottomProducts: sortedProducts.slice(-5).reverse(),
      topColors: sortedColors.slice(0, 8),
      bottomColors: sortedColors.slice(-5).reverse(),
      productByStore: Object.values(productByStore).sort((a, b) => b.count - a.count).slice(0, 15),
      highAlterationStyles,
      repetitiveAlterations,
      avgAlterationsPerOutfit,
      highReturnStyles,
    };
  }, [orders]);

  // ==================== CLIENT INSIGHTS ====================
  const clientInsights = useMemo(() => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    let totalAgeYears = 0;
    let withDob = 0;
    profiles.forEach((p) => {
      if (p.dob) {
        const dob = new Date(p.dob);
        if (!isNaN(dob.getTime())) {
          const age = (now.getTime() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
          if (age > 0 && age < 120) {
            totalAgeYears += age;
            withDob += 1;
          }
        }
      }
    });
    const avgClientAge = withDob > 0 ? (totalAgeYears / withDob).toFixed(1) : "—";

    // Repeat customer rate — scoped to the active timeline so "% of customers
    // who ordered more than once" reflects the chosen period (e.g. monthly
    // repeat rate). avgClientAge / newLast{7,30} stay full-dataset metrics.
    const customerOrders = {};
    dateFilteredOrders.forEach((o) => {
      const id = o.user_id || o.delivery_email;
      if (!id) return;
      customerOrders[id] = (customerOrders[id] || 0) + 1;
    });
    const totalCustomers = Object.keys(customerOrders).length;
    const repeatCustomers = Object.values(customerOrders).filter((c) => c > 1).length;
    const repeatRate = totalCustomers > 0 ? ((repeatCustomers / totalCustomers) * 100).toFixed(1) : "0.0";

    // New clients (weekly / monthly)
    const newLast7 = profiles.filter((p) => p.created_at && new Date(p.created_at) >= sevenDaysAgo).length;
    const newLast30 = profiles.filter((p) => p.created_at && new Date(p.created_at) >= thirtyDaysAgo).length;

    return {
      avgClientAge,
      totalClients: profiles.length,
      repeatRate, repeatCustomers, totalCustomers,
      newLast7, newLast30,
    };
  }, [dateFilteredOrders, profiles]);

  // ==================== INVENTORY ====================
  // ==================== ORDERS TAB ====================
  // Status tabs: same shape Admin uses, scoped to the buckets that make sense
  // for a CMO view. "all" is everything; the rest are buckets by lifecycle.
  const ORDER_STATUS_TABS = useMemo(() => [
    { value: "all", label: "All Orders" },
    { value: "unfulfilled", label: "Unfulfilled" },
    { value: "completed", label: "Completed / Delivered" },
    { value: "cancelled", label: "Cancelled" },
  ], []);

  const matchOrderStatus = (o, tab) => {
    const s = (o.status || "").toLowerCase();
    switch (tab) {
      case "unfulfilled": return s !== "completed" && s !== "delivered" && s !== "cancelled";
      case "completed": return s === "completed" || s === "delivered";
      case "cancelled": return s === "cancelled";
      case "all":
      default: return true;
    }
  };

  // Filter + sort + paginate. Uses the full `orders` dataset (Orders tab is
  // intentionally NOT bound to the dashboard timeline filter — CMO needs
  // search-by-order-no to work across history).
  const filteredOrders = useMemo(() => {
    let result = orders.filter((o) => matchOrderStatus(o, orderStatusTab));
    // Order-date range (created_at). From = start of day, To = end of day.
    const fromTs = orderDateFrom ? new Date(orderDateFrom + "T00:00:00").getTime() : null;
    const toTs = orderDateTo ? new Date(orderDateTo + "T23:59:59.999").getTime() : null;
    if (fromTs != null || toTs != null) {
      result = result.filter((o) => {
        if (!o.created_at) return false;
        const ts = new Date(o.created_at).getTime();
        if (fromTs != null && ts < fromTs) return false;
        if (toTs != null && ts > toTs) return false;
        return true;
      });
    }
    const q = orderSearch.trim().toLowerCase();
    if (q) {
      result = result.filter((o) => {
        switch (orderSearchField) {
          case "product_name":
            return (o.items || []).some((it) => it?.product_name?.toLowerCase().includes(q));
          case "client_name":
            return (o.delivery_name || "").toLowerCase().includes(q);
          case "phone":
            return (o.delivery_phone || "").includes(q);
          case "salesperson":
            return (o.salesperson || "").toLowerCase().includes(q);
          case "order_no":
          default:
            return (o.order_no || "").toLowerCase().includes(q);
        }
      });
    }
    // Sort
    const getOrderNum = (no) => {
      const m = (no || "").replace(/-[A-Z]\d*$/, "").match(/(\d{2})(\d{2})-(\d{6})$/);
      return m ? parseInt(m[2] + m[1] + m[3]) : 0;
    };
    result = [...result].sort((a, b) => {
      switch (orderSortBy) {
        case "oldest": return getOrderNum(a.order_no) - getOrderNum(b.order_no);
        case "delivery": return new Date(a.delivery_date || 0) - new Date(b.delivery_date || 0);
        case "amount_high": return (b.net_total ?? b.grand_total_after_discount ?? b.grand_total ?? 0) - (a.net_total ?? a.grand_total_after_discount ?? a.grand_total ?? 0);
        case "amount_low": return (a.net_total ?? a.grand_total_after_discount ?? a.grand_total ?? 0) - (b.net_total ?? b.grand_total_after_discount ?? b.grand_total ?? 0);
        default: return getOrderNum(b.order_no) - getOrderNum(a.order_no);
      }
    });
    return result;
  }, [orders, orderStatusTab, orderSearch, orderSearchField, orderSortBy, orderDateFrom, orderDateTo]);

  // Status tab counts
  const orderTabCounts = useMemo(() => {
    return ORDER_STATUS_TABS.reduce((acc, tab) => {
      acc[tab.value] = orders.filter((o) => matchOrderStatus(o, tab.value)).length;
      return acc;
    }, {});
  }, [orders, ORDER_STATUS_TABS]);

  // Reset pagination when filters change
  useEffect(() => { setOrdersPage(1); }, [orderSearch, orderSearchField, orderStatusTab, orderSortBy, orderDateFrom, orderDateTo]);

  // Top-product click-through: when a product name is set, pre-fill the
  // Orders search with it and clear the consumed value.
  useEffect(() => {
    if (productFilterForOrders) {
      setOrderSearch(productFilterForOrders);
      setOrderSearchField("product_name");
      setOrderStatusTab("all");
      setProductFilterForOrders("");
    }
  }, [productFilterForOrders]);

  // CSV export — mirrors GM/Admin pattern: UTF-8 BOM + text/csv blob + temp anchor.
  const handleOrdersExportCSV = () => {
    if (filteredOrders.length === 0) return;
    // Normal quoted CSV cell + Excel "text cell" (="..." keeps long phone
    // digit-strings from turning into 9.16E+11 scientific notation).
    const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const textCell = (v) => `="${String(v).replace(/"/g, '""')}"`;
    const headers = [
      "Order No", "Order Date", "Customer", "Country Code", "Phone", "Salesperson", "Store",
      "Product", "Status", "Amount", "Delivery Date",
    ];
    const rows = filteredOrders.map((o) => {
      const item = o.items?.[0] || {};
      const { countryCode, number } = splitPhoneNumber(o.delivery_phone);
      return [
        cell(o.order_no || ""),
        cell(o.created_at ? new Date(o.created_at).toLocaleDateString("en-GB") : ""),
        cell(o.delivery_name || ""),
        cell(countryCode),
        textCell(number),
        cell(o.salesperson || ""),
        cell(getOrderStore(o)),
        cell(item.product_name || ""),
        cell(o.status || ""),
        cell(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0),
        cell(o.delivery_date ? new Date(o.delivery_date).toLocaleDateString("en-GB") : ""),
      ];
    });
    const csv = [headers.map(cell).join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `acmo_orders_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ==================== CLIENT BOOK ====================
  // Builds the same client/order aggregation Admin uses, with one addition:
  // each client carries a primary store derived from their most recent order.
  // The Client Book tab uses that to filter by store.
  const clientBook = useMemo(() => {
    const orderIndex = {}; // key -> { sas:Set, orderCount, lastOrderAt, storeCounts:{store:n}, lastOrderStore }
    const addToIndex = (key, order) => {
      if (!key) return;
      if (!orderIndex[key]) orderIndex[key] = { sas: new Set(), orderCount: 0, lastOrderAt: null, storeCounts: {}, lastOrderStore: null };
      const entry = orderIndex[key];
      const sa = (order.salesperson || "").trim();
      if (sa) entry.sas.add(sa);
      entry.orderCount += 1;
      const store = getOrderStore(order);
      entry.storeCounts[store] = (entry.storeCounts[store] || 0) + 1;
      if (order.created_at && (!entry.lastOrderAt || new Date(order.created_at) > new Date(entry.lastOrderAt))) {
        entry.lastOrderAt = order.created_at;
        entry.lastOrderStore = store;
      }
    };
    // Date-range filter (by order created_at). When active, only orders in the
    // range feed the index — so the book shows clients who ordered in that window.
    const cFromTs = clientDateFrom ? new Date(clientDateFrom + "T00:00:00").getTime() : null;
    const cToTs = clientDateTo ? new Date(clientDateTo + "T23:59:59.999").getTime() : null;
    const dateActive = cFromTs != null || cToTs != null;
    const inDateRange = (o) => {
      if (!dateActive) return true;
      if (!o.created_at) return false;
      const ts = new Date(o.created_at).getTime();
      if (cFromTs != null && ts < cFromTs) return false;
      if (cToTs != null && ts > cToTs) return false;
      return true;
    };

    orders.forEach((o) => {
      if (!inDateRange(o)) return;
      const phone = (o.delivery_phone || o.phone || "").trim();
      if (phone) addToIndex(`phone:${phone}`, o);
      if (o.user_id) addToIndex(`uid:${o.user_id}`, o);
    });

    const all = profiles.map((p) => {
      const phone = (p.phone || "").trim();
      const email = (p.email || "").trim().toLowerCase();
      const byUid = p.id ? orderIndex[`uid:${p.id}`] : null;
      const byPhone = phone ? orderIndex[`phone:${phone}`] : null;

      const sas = new Set();
      let orderCount = 0;
      let lastOrderAt = null;
      let lastOrderStore = null;
      let bestStoreCounts = {};
      [byUid, byPhone].forEach((src) => {
        if (!src) return;
        src.sas.forEach((s) => sas.add(s));
        orderCount += src.orderCount;
        if (src.lastOrderAt && (!lastOrderAt || new Date(src.lastOrderAt) > new Date(lastOrderAt))) {
          lastOrderAt = src.lastOrderAt;
          lastOrderStore = src.lastOrderStore;
        }
        Object.entries(src.storeCounts).forEach(([k, v]) => {
          bestStoreCounts[k] = (bestStoreCounts[k] || 0) + v;
        });
      });
      if (byUid && byPhone) {
        orderCount = Math.max(byUid.orderCount, byPhone.orderCount);
      }
      // Primary store: most-frequent across this client's orders (fallback to last).
      const primaryStore = Object.entries(bestStoreCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || lastOrderStore || "";

      return {
        id: p.id,
        name: (p.full_name || "").trim() || "—",
        phone,
        email,
        sas: Array.from(sas).sort(),
        orderCount,
        lastOrderAt,
        primaryStore,
      };
    });

    // Hide abandoned signups (no name, no email, no orders) — same as Admin.
    const isAbandoned = (c) => c.name === "—" && !c.email && c.orderCount === 0;
    // With a date range active, show only clients who actually ordered in it.
    const visible = all.filter((c) => !isAbandoned(c) && (!dateActive || c.orderCount > 0));

    // Store filter
    let filtered = visible;
    if (clientStoreFilter !== "all") {
      filtered = filtered.filter((c) => c.primaryStore === clientStoreFilter);
    }
    // Search filter
    const q = clientSearch.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.sas.some((s) => s.toLowerCase().includes(q))
      );
    }
    const sorted = filtered.sort((a, b) => a.name.localeCompare(b.name));
    const totalPages = Math.max(1, Math.ceil(sorted.length / CLIENTS_PER_PAGE));
    const safePage = Math.min(clientsPage, totalPages);
    const start = (safePage - 1) * CLIENTS_PER_PAGE;
    const pageRows = sorted.slice(start, start + CLIENTS_PER_PAGE);

    // Per-store counts (for the chip-bar)
    const storeBreakdown = visible.reduce((acc, c) => {
      const s = c.primaryStore || "—";
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});

    return {
      all: sorted,
      pageRows,
      totalPages,
      safePage,
      totalCount: sorted.length,
      visibleCount: visible.length,
      storeBreakdown,
    };
  }, [profiles, orders, clientSearch, clientStoreFilter, clientsPage, clientDateFrom, clientDateTo]);

  // Reset to page 1 when search or store filter changes
  useEffect(() => { setClientsPage(1); }, [clientSearch, clientStoreFilter, clientDateFrom, clientDateTo]);

  // CSV export for client book
  const handleClientBookExportCSV = () => {
    if (clientBook.all.length === 0) return;
    // Normal quoted CSV cell.
    const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
    // Excel "text cell" — wraps the value as ="..." so long digit strings keep
    // their full form (no 9.16E+11 scientific notation, no dropped leading 0s).
    const textCell = (v) => `="${String(v).replace(/"/g, '""')}"`;
    const headers = ["Client Name", "Country Code", "Phone", "Email", "Primary Store", "Connected SA(s)", "Total Orders", "Last Order Date"];
    const rows = clientBook.all.map((c) => {
      const { countryCode, number } = splitPhoneNumber(c.phone);
      return [
        cell(c.name),
        cell(countryCode),
        textCell(number),
        cell(c.email),
        cell(c.primaryStore || ""),
        cell(c.sas.join("; ")),
        cell(c.orderCount),
        cell(c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString("en-GB") : ""),
      ];
    });
    const csv = [headers.map(cell).join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `acmo_client_book_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const inventoryMetrics = useMemo(() => {
    const now = new Date();
    const delayedDeliveries = orders.filter((o) => {
      if (o.status === "delivered" || o.status === "completed" || o.status === "cancelled") return false;
      return o.delivery_date && new Date(o.delivery_date) < now;
    }).length;

    const activeLxrts = products.filter((p) => p.sync_enabled || p.shopify_product_id).length;

    // Quantity-only view (no financial values per Assistant CMO permissions)
    const consignmentQty = consignment.reduce((sum, c) => sum + Number(c.quantity || 0), 0);

    return {
      delayedDeliveries,
      activeLxrts,
      consignmentQty,
      productCount: products.length,
    };
  }, [orders, products, consignment]);

  // ==================== COST & EXPENDITURE ====================
  const costExpenditure = useMemo(() => {
    let totalDiscount = 0;
    let totalRevenue = 0;
    let discountedOrders = 0;
    let refundValue = 0;
    let returnValue = 0;

    orders.forEach((o) => {
      const amt = Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0);
      const disc = Number(o.discount_amount || 0);
      if (disc > 0) {
        totalDiscount += disc;
        discountedOrders += 1;
      }
      if (isRevenueOrder(o)) totalRevenue += amt;
      if (o.refund_status === "processed" || o.refund_status === "completed" || o.refund_status === "refunded") refundValue += amt;
      if (o.return_reason || o.status === "returned") returnValue += amt;
    });

    const discountPct = totalRevenue > 0 ? ((totalDiscount / (totalRevenue + totalDiscount)) * 100).toFixed(1) : "0.0";

    return {
      totalDiscount, discountPct, discountedOrders,
      refundValue, returnValue,
    };
  }, [orders]);

  // ==================== LOADING ====================
  if (loading) {
    return (
      <div className="acmo-loading-container">
        <div className="acmo-spinner"></div>
        <p>Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div className="acmo-dashboard-wrapper">
      {PopupComponent}

      <header className="acmo-header">
        <img src={Logo} alt="logo" className="acmo-logo" onClick={handleLogout} />
        <h1 className="acmo-title">Assistant CMO</h1>
        <div className="acmo-header-right">
          <NotificationBell userEmail={currentUserEmail} />
          <button className="acmo-logout-btn" onClick={handleLogout}>Logout</button>
          <div className="acmo-hamburger" onClick={() => setShowSidebar(!showSidebar)}>
            <div className="acmo-bar"></div>
            <div className="acmo-bar"></div>
            <div className="acmo-bar"></div>
          </div>
        </div>
      </header>

      <div className="acmo-layout">
        <aside className={`acmo-sidebar ${showSidebar ? "acmo-open" : ""}`}>
          <nav className="acmo-nav">
            <button className={`acmo-nav-item ${activeTab === "overview" ? "active" : ""}`} onClick={() => { setActiveTab("overview"); setShowSidebar(false); }}>Overview</button>
            <button className={`acmo-nav-item ${activeTab === "brand" ? "active" : ""}`} onClick={() => { setActiveTab("brand"); setShowSidebar(false); }}>Brand Performance</button>
            <button className={`acmo-nav-item ${activeTab === "revenue" ? "active" : ""}`} onClick={() => { setActiveTab("revenue"); setShowSidebar(false); }}>Revenue & Drivers</button>
            <button className={`acmo-nav-item ${activeTab === "product" ? "active" : ""}`} onClick={() => { setActiveTab("product"); setShowSidebar(false); }}>Product & Style</button>
            <button className={`acmo-nav-item ${activeTab === "clients" ? "active" : ""}`} onClick={() => { setActiveTab("clients"); setShowSidebar(false); }}>Client Insights</button>
            <button className={`acmo-nav-item ${activeTab === "orders" ? "active" : ""}`} onClick={() => { setActiveTab("orders"); setShowSidebar(false); }}>Orders</button>
            <button className={`acmo-nav-item ${activeTab === "client_book" ? "active" : ""}`} onClick={() => { setActiveTab("client_book"); setShowSidebar(false); }}>Client Book</button>
            <button className={`acmo-nav-item ${activeTab === "walkins" ? "active" : ""}`} onClick={() => { setActiveTab("walkins"); setShowSidebar(false); }}>Walk-Ins</button>
            <button className={`acmo-nav-item ${activeTab === "inventory" ? "active" : ""}`} onClick={() => { setActiveTab("inventory"); setShowSidebar(false); }}>Inventory</button>
            {currentUserProfile?.can_place_stock_orders && (
              <button
                className="acmo-nav-item"
                onClick={() => { setShowSidebar(false); handleStartStockOrder(); }}
              >Stock Order</button>
            )}
          </nav>
        </aside>

        <main className="acmo-main">
          {/* ==================== OVERVIEW ==================== */}
          {activeTab === "overview" && (
            <>
              <h2 className="acmo-section-title">Overview</h2>
              <TimelineFilter timeline={timeline} setTimeline={setTimeline} customFrom={customDateFrom} setCustomFrom={setCustomDateFrom} customTo={customDateTo} setCustomTo={setCustomDateTo} />

              <div className="acmo-card">
                <p className="acmo-card-title">Store-wise Sales Breakdown</p>
                <div className="acmo-stats-grid">
                  {overview.storePerformance.map((s) => (
                    <StatCard
                      key={s.name}
                      title={s.name}
                      value={`₹${formatIndianNumber(Math.round(s.revenue))}`}
                      subtitle={`${s.orderCount} orders`}
                    />
                  ))}
                </div>
              </div>

              <div className="acmo-card">
                <p className="acmo-card-title">Top Products (by Revenue)</p>
                {overview.topProducts.length === 0 ? (
                  <p className="acmo-empty">No delivered orders yet</p>
                ) : (
                  <div className="acmo-table-wrapper">
                    <table className="acmo-table">
                      <thead><tr><th>Product</th><th>Qty Sold</th><th>Revenue</th></tr></thead>
                      <tbody>
                        {overview.topProducts.map((p) => (
                          <tr
                            key={p.name}
                            onClick={() => { setProductFilterForOrders(p.name); setActiveTab("orders"); }}
                            style={{ cursor: "pointer" }}
                            title="Click to see all orders with this product"
                          >
                            <td>{p.name}</td>
                            <td>{p.qty}</td>
                            <td>₹{formatIndianNumber(Math.round(p.revenue))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Top products grouped by store — helps target ads per location. */}
              {overview.topProductsByStore.length > 0 && (
                <div className="acmo-card">
                  <p className="acmo-card-title">Top Products by Store</p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
                    {overview.topProductsByStore.map((s) => (
                      <div key={s.store} style={{ border: "1px solid #f0e8d4", borderRadius: 10, padding: 12, background: "#fff" }}>
                        <p style={{ margin: "0 0 8px 0", fontWeight: 600, color: "#8B7355" }}>{s.store}</p>
                        <div className="acmo-table-wrapper">
                          <table className="acmo-table">
                            <thead><tr><th>Product</th><th>Qty</th><th>Revenue</th></tr></thead>
                            <tbody>
                              {s.products.map((p) => (
                                <tr
                                  key={p.name}
                                  onClick={() => { setProductFilterForOrders(p.name); setActiveTab("orders"); }}
                                  style={{ cursor: "pointer" }}
                                  title="Click to see all orders with this product"
                                >
                                  <td>{p.name}</td>
                                  <td>{p.qty}</td>
                                  <td>₹{formatIndianNumber(Math.round(p.revenue))}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="acmo-card">
                <p className="acmo-card-title">Refunds, Cancellations & Returns</p>
                <div className="acmo-stats-grid">
                  <StatCard title="Refunds" value={overview.refundCount} subtitle={`₹${formatIndianNumber(Math.round(overview.refundValue))}`} highlight={overview.refundCount > 0} />
                  <StatCard title="Cancellations" value={overview.cancelCount} subtitle={`₹${formatIndianNumber(Math.round(overview.cancelValue))}`} highlight={overview.cancelCount > 0} />
                  <StatCard title="Returns" value={overview.returnCount} subtitle={`₹${formatIndianNumber(Math.round(overview.returnValue))}`} highlight={overview.returnCount > 0} />
                </div>
              </div>

              <div className="acmo-card">
                <p className="acmo-card-title">Discount Impact</p>
                <div className="acmo-stats-grid">
                  <StatCard title="Total Discount Given" value={`₹${formatIndianNumber(Math.round(overview.totalDiscount))}`} subtitle={`${overview.ordersWithDiscount} orders`} />
                  <StatCard title="Average Discount / Order" value={`₹${formatIndianNumber(Math.round(overview.avgDiscount))}`} subtitle="When discounted" />
                </div>
              </div>

              <div className="acmo-card">
                <p className="acmo-card-title">Return Reason Analytics</p>
                {overview.returnReasons.length === 0 ? (
                  <p className="acmo-empty">No returns yet</p>
                ) : (
                  <div className="acmo-table-wrapper">
                    <table className="acmo-table">
                      <thead><tr><th>Reason</th><th>Qty</th></tr></thead>
                      <tbody>
                        {overview.returnReasons.map((r) => (
                          <tr key={r.name}><td>{r.name}</td><td><strong>{r.count}</strong></td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="acmo-card">
                <p className="acmo-card-title">Target Progress — Store-level</p>
                <p className="acmo-helper-note">Shows store-level revenue only (no employee split per permissions)</p>
                <div className="acmo-stats-grid">
                  {overview.storeTargets.map((s) => (
                    <StatCard
                      key={s.name}
                      title={s.name}
                      value={`₹${formatIndianNumber(Math.round(s.revenue))}`}
                      subtitle="YTD achieved"
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ==================== BRAND PERFORMANCE ==================== */}
          {activeTab === "brand" && (
            <>
              <h2 className="acmo-section-title">Overall Brand Performance</h2>
              <TimelineFilter timeline={timeline} setTimeline={setTimeline} customFrom={customDateFrom} setCustomFrom={setCustomDateFrom} customTo={customDateTo} setCustomTo={setCustomDateTo} />

              <div className="acmo-card">
                <p className="acmo-card-title">Top-Performing Products (Overall)</p>
                {brandPerformance.topProducts.length === 0 ? (
                  <p className="acmo-empty">No data yet</p>
                ) : (
                  <ResponsiveContainer width="100%" height={340}>
                    <BarChart data={brandPerformance.topProducts} layout="vertical" margin={{ top: 10, right: 30, left: 0, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#eee" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "#888" }} allowDecimals={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 11, fill: "#444" }} tickFormatter={(v) => (v.length > 20 ? v.slice(0, 20) + "…" : v)} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e8e2d0", borderRadius: 10, fontSize: 12 }} />
                      <Bar dataKey="count" name="Qty" radius={[0, 6, 6, 0]} barSize={18}>
                        {brandPerformance.topProducts.map((_, i) => (
                          <Cell key={i} fill={`rgba(213, 184, 90, ${1 - i * 0.07})`} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="acmo-charts-grid">
                <div className="acmo-card">
                  <p className="acmo-card-title">Top Performing Colours</p>
                  {brandPerformance.topColors.length === 0 ? <p className="acmo-empty">No data yet</p> : (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={brandPerformance.topColors} margin={{ top: 10, right: 20, left: 0, bottom: 50 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                        <XAxis dataKey="name" interval={0} tick={{ fontSize: 11, fill: "#555" }} angle={-25} textAnchor="end" height={60} />
                        <YAxis tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e8e2d0", borderRadius: 10, fontSize: 12 }} />
                        <Bar dataKey="count" name="Qty" radius={[4, 4, 0, 0]} barSize={24}>
                          {brandPerformance.topColors.map((c, i) => (
                            <Cell key={i} fill={getColorHex(c.name)} stroke="rgba(0,0,0,0.08)" />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                <div className="acmo-card">
                  <p className="acmo-card-title">Bottom Performing Colours</p>
                  {brandPerformance.bottomColors.length === 0 ? <p className="acmo-empty">No data yet</p> : (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={brandPerformance.bottomColors} margin={{ top: 10, right: 20, left: 0, bottom: 50 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                        <XAxis dataKey="name" interval={0} tick={{ fontSize: 11, fill: "#555" }} angle={-25} textAnchor="end" height={60} />
                        <YAxis tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e8e2d0", borderRadius: 10, fontSize: 12 }} />
                        <Bar dataKey="count" name="Qty" radius={[4, 4, 0, 0]} barSize={24}>
                          {brandPerformance.bottomColors.map((c, i) => (
                            <Cell key={i} fill={getColorHex(c.name)} stroke="rgba(0,0,0,0.08)" />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ==================== REVENUE & DRIVERS ==================== */}
          {activeTab === "revenue" && (
            <>
              <h2 className="acmo-section-title">Revenue & Business Drivers</h2>

              <div className="acmo-card">
                <p className="acmo-card-title">Growth % — Daily vs MoM vs YoY</p>
                <div className="acmo-stats-grid">
                  <StatCard title="Daily Growth" value={`${Number(revenueMetrics.dailyGrowth) >= 0 ? "+" : ""}${revenueMetrics.dailyGrowth}%`} subtitle={`Today: ₹${formatIndianNumber(Math.round(revenueMetrics.todayRev))}`} highlight={Number(revenueMetrics.dailyGrowth) < 0} />
                  <StatCard title="Month-on-Month" value={`${Number(revenueMetrics.momGrowth) >= 0 ? "+" : ""}${revenueMetrics.momGrowth}%`} subtitle={`MTD: ₹${formatIndianNumber(Math.round(revenueMetrics.mtdRev))}`} highlight={Number(revenueMetrics.momGrowth) < 0} />
                  <StatCard title="Year-on-Year" value={`${Number(revenueMetrics.yoyGrowth) >= 0 ? "+" : ""}${revenueMetrics.yoyGrowth}%`} subtitle={`YTD: ₹${formatIndianNumber(Math.round(revenueMetrics.ytdRev))}`} highlight={Number(revenueMetrics.yoyGrowth) < 0} />
                </div>
              </div>

              <div className="acmo-card">
                <p className="acmo-card-title">Average Order Value</p>
                <div className="acmo-stats-grid">
                  <StatCard title="AOV (YTD)" value={`₹${formatIndianNumber(Math.round(revenueMetrics.aovOverall))}`} subtitle="Across all delivered orders this year" />
                  <StatCard title="AOV (This Month)" value={`₹${formatIndianNumber(Math.round(revenueMetrics.aovMtd))}`} subtitle="Delivered orders this month" />
                </div>
                {revenueMetrics.aovByStore.length > 0 && (
                  <>
                    <p style={{ margin: "16px 0 8px 0", fontSize: 13, color: "#666" }}>By store (YTD)</p>
                    <div className="acmo-stats-grid">
                      {revenueMetrics.aovByStore.map((s) => (
                        <StatCard
                          key={s.name}
                          title={`AOV — ${s.name}`}
                          value={`₹${formatIndianNumber(Math.round(s.aov))}`}
                          subtitle={`${s.count} orders · ₹${formatIndianNumber(Math.round(s.revenue))} revenue`}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="acmo-card">
                <p className="acmo-card-title">Revenue Trend (Last 12 Months)</p>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={revenueMetrics.monthsTrend} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#555" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#888" }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => `₹${formatIndianNumber(v)}`} contentStyle={{ background: "#fff", border: "1px solid #e8e2d0", borderRadius: 10, fontSize: 12 }} />
                    <Line type="monotone" dataKey="revenue" stroke="#d5b85a" strokeWidth={3} dot={{ fill: "#d5b85a", r: 4 }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {/* ==================== PRODUCT & STYLE ==================== */}
          {activeTab === "product" && (
            <>
              <h2 className="acmo-section-title">Product, Style & Design Performance</h2>

              <div className="acmo-charts-grid">
                <div className="acmo-card">
                  <p className="acmo-card-title">Top-Performing Products</p>
                  {productStyle.topProducts.length === 0 ? <p className="acmo-empty">No data</p> : (
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={productStyle.topProducts} layout="vertical" margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal vertical={false} stroke="#eee" />
                        <XAxis type="number" tick={{ fontSize: 11, fill: "#888" }} allowDecimals={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11, fill: "#444" }} tickFormatter={(v) => (v.length > 18 ? v.slice(0, 18) + "…" : v)} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e8e2d0", borderRadius: 10, fontSize: 12 }} />
                        <Bar dataKey="count" name="Qty" radius={[0, 6, 6, 0]} barSize={16} fill="#d5b85a" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                <div className="acmo-card">
                  <p className="acmo-card-title">Bottom-Performing Products</p>
                  {productStyle.bottomProducts.length === 0 ? <p className="acmo-empty">No data</p> : (
                    <div className="acmo-table-wrapper">
                      <table className="acmo-table">
                        <thead><tr><th>Product</th><th>Qty Sold</th></tr></thead>
                        <tbody>
                          {productStyle.bottomProducts.map((p) => (
                            <tr key={p.name}><td>{p.name}</td><td>{p.count}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              <div className="acmo-charts-grid">
                <div className="acmo-card">
                  <p className="acmo-card-title">Top Colours</p>
                  {productStyle.topColors.length === 0 ? <p className="acmo-empty">No data</p> : (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={productStyle.topColors} margin={{ top: 10, right: 20, left: 0, bottom: 50 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                        <XAxis dataKey="name" interval={0} tick={{ fontSize: 11, fill: "#555" }} angle={-25} textAnchor="end" height={60} />
                        <YAxis tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e8e2d0", borderRadius: 10, fontSize: 12 }} />
                        <Bar dataKey="count" name="Qty" radius={[4, 4, 0, 0]} barSize={24}>
                          {productStyle.topColors.map((c, i) => (
                            <Cell key={i} fill={getColorHex(c.name)} stroke="rgba(0,0,0,0.08)" />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                <div className="acmo-card">
                  <p className="acmo-card-title">Bottom Colours</p>
                  {productStyle.bottomColors.length === 0 ? <p className="acmo-empty">No data</p> : (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={productStyle.bottomColors} margin={{ top: 10, right: 20, left: 0, bottom: 50 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                        <XAxis dataKey="name" interval={0} tick={{ fontSize: 11, fill: "#555" }} angle={-25} textAnchor="end" height={60} />
                        <YAxis tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e8e2d0", borderRadius: 10, fontSize: 12 }} />
                        <Bar dataKey="count" name="Qty" radius={[4, 4, 0, 0]} barSize={24}>
                          {productStyle.bottomColors.map((c, i) => (
                            <Cell key={i} fill={getColorHex(c.name)} stroke="rgba(0,0,0,0.08)" />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="acmo-card">
                <p className="acmo-card-title">Alteration Insights</p>
                <div className="acmo-stats-grid">
                  <StatCard title="Average Alterations / Outfit" value={productStyle.avgAlterationsPerOutfit} subtitle="Across altered items" />
                  <StatCard title="Repetitive Alterations (Flagged)" value={productStyle.repetitiveAlterations.length} subtitle="Styles with 3+ requests" highlight={productStyle.repetitiveAlterations.length > 0} />
                  <StatCard title="High-Alteration Styles" value={productStyle.highAlterationStyles.length} subtitle="Top flagged styles" />
                </div>
              </div>

              <div className="acmo-card">
                <p className="acmo-card-title">Styles with High Alterations</p>
                {productStyle.highAlterationStyles.length === 0 ? (
                  <p className="acmo-empty">No alteration data yet</p>
                ) : (
                  <div className="acmo-table-wrapper">
                    <table className="acmo-table">
                      <thead><tr><th>Style / Product</th><th>Alterations</th><th>Flag</th></tr></thead>
                      <tbody>
                        {productStyle.highAlterationStyles.map((s) => (
                          <tr key={s.name}>
                            <td>{s.name}</td>
                            <td><strong>{s.count}</strong></td>
                            <td>{s.count >= 3 ? <span className="acmo-flag-warning">Repetitive</span> : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="acmo-card">
                <p className="acmo-card-title">High-Return Styles (%)</p>
                {productStyle.highReturnStyles.length === 0 ? (
                  <p className="acmo-empty">No significant return data yet</p>
                ) : (
                  <div className="acmo-table-wrapper">
                    <table className="acmo-table">
                      <thead><tr><th>Style</th><th>Returned</th><th>Total Sold</th><th>Return Rate</th></tr></thead>
                      <tbody>
                        {productStyle.highReturnStyles.map((s) => (
                          <tr key={s.name}>
                            <td>{s.name}</td>
                            <td>{s.returnCount}</td>
                            <td>{s.totalCount}</td>
                            <td><strong>{s.returnRate}%</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="acmo-card">
                <p className="acmo-card-title">Customisation Trends</p>
                <div className="acmo-stats-grid">
                  <PlaceholderCard title="Length-related" note="Needs customisation tagging" />
                  <PlaceholderCard title="Fit & Structure" note="Needs customisation tagging" />
                  <PlaceholderCard title="Silhouette-wise" note="Needs customisation tagging" />
                  <PlaceholderCard title="Colour-driven" note="Needs customisation tagging" />
                </div>
              </div>
            </>
          )}

          {/* ==================== CLIENT INSIGHTS ==================== */}
          {activeTab === "clients" && (
            <>
              <h2 className="acmo-section-title">Client Insights</h2>
              <TimelineFilter timeline={timeline} setTimeline={setTimeline} customFrom={customDateFrom} setCustomFrom={setCustomDateFrom} customTo={customDateTo} setCustomTo={setCustomDateTo} />

              <div className="acmo-stats-grid">
                <StatCard title="Average Client Age" value={clientInsights.avgClientAge !== "—" ? `${clientInsights.avgClientAge} yrs` : "—"} subtitle={`${clientInsights.totalClients} total clients`} />
                <StatCard title="Repeat Customer Rate" value={`${clientInsights.repeatRate}%`} subtitle={`${clientInsights.repeatCustomers} of ${clientInsights.totalCustomers}`} highlight={Number(clientInsights.repeatRate) > 30} />
                <StatCard title="New Clients (Last 7 Days)" value={clientInsights.newLast7} />
                <StatCard title="New Clients (Last 30 Days)" value={clientInsights.newLast30} />
              </div>
            </>
          )}

          {/* ==================== ORDERS ==================== */}
          {activeTab === "orders" && (() => {
            const pagedOrders = filteredOrders.slice((ordersPage - 1) * ORDERS_PER_PAGE, ordersPage * ORDERS_PER_PAGE);
            const totalPages = Math.max(1, Math.ceil(filteredOrders.length / ORDERS_PER_PAGE));
            return (
              <>
                <h2 className="acmo-section-title">Orders</h2>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 12 }}>
                  <SearchByDropdown
                    fields={[
                      { value: "order_no", label: "Order Number" },
                      { value: "product_name", label: "Product Name" },
                      { value: "client_name", label: "Client Name" },
                      { value: "phone", label: "Phone" },
                      { value: "salesperson", label: "Salesperson" },
                    ]}
                    selectedField={orderSearchField}
                    onFieldChange={setOrderSearchField}
                    query={orderSearch}
                    onQueryChange={setOrderSearch}
                    placeholder="Type to search..."
                  />
                  <select
                    value={orderSortBy}
                    onChange={(e) => setOrderSortBy(e.target.value)}
                    style={{ padding: "10px 14px", border: "1px solid #e0d5c5", borderRadius: 8, fontSize: 14, background: "#fff", cursor: "pointer", outline: "none" }}
                  >
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                    <option value="delivery">Delivery Date</option>
                    <option value="amount_high">Amount: High to Low</option>
                    <option value="amount_low">Amount: Low to High</option>
                  </select>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="date"
                      value={orderDateFrom}
                      onChange={(e) => setOrderDateFrom(e.target.value)}
                      max={orderDateTo || undefined}
                      aria-label="Order date from"
                      style={{ padding: "10px 12px", border: "1px solid #e0d5c5", borderRadius: 8, fontSize: 14, background: "#fff", cursor: "pointer", outline: "none" }}
                    />
                    <span style={{ color: "#999" }}>→</span>
                    <input
                      type="date"
                      value={orderDateTo}
                      onChange={(e) => setOrderDateTo(e.target.value)}
                      min={orderDateFrom || undefined}
                      aria-label="Order date to"
                      style={{ padding: "10px 12px", border: "1px solid #e0d5c5", borderRadius: 8, fontSize: 14, background: "#fff", cursor: "pointer", outline: "none" }}
                    />
                    {(orderDateFrom || orderDateTo) && (
                      <button
                        onClick={() => { setOrderDateFrom(""); setOrderDateTo(""); }}
                        title="Clear date filter"
                        style={{ padding: "8px 10px", border: "1px solid #e0d5c5", borderRadius: 8, background: "#fff", color: "#8B7355", cursor: "pointer", fontSize: 13 }}
                      >Clear</button>
                    )}
                  </div>
                  <button
                    onClick={handleOrdersExportCSV}
                    disabled={filteredOrders.length === 0}
                    title="Export filtered orders to CSV"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6, height: 42,
                      padding: "0 16px", border: "1px solid #d5b85a", borderRadius: 8,
                      background: filteredOrders.length === 0 ? "#f5f5f5" : "#faf6e8",
                      color: filteredOrders.length === 0 ? "#999" : "#8B7355",
                      fontSize: 14, fontWeight: 500,
                      cursor: filteredOrders.length === 0 ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap", transition: "all 0.2s",
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Export CSV
                  </button>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {ORDER_STATUS_TABS.map((tab) => {
                    const active = orderStatusTab === tab.value;
                    return (
                      <button
                        key={tab.value}
                        onClick={() => setOrderStatusTab(tab.value)}
                        style={{
                          padding: "8px 14px",
                          border: `1px solid ${active ? "#d5b85a" : "#e0d5c5"}`,
                          borderRadius: 20,
                          background: active ? "#d5b85a" : "#fff",
                          color: active ? "#fff" : "#666",
                          fontSize: 13, fontWeight: 500, cursor: "pointer",
                          transition: "all 0.15s",
                        }}
                      >
                        {tab.label}
                        <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.8 }}>
                          ({orderTabCounts[tab.value] || 0})
                        </span>
                      </button>
                    );
                  })}
                </div>

                <p style={{ color: "#888", fontSize: 13, marginBottom: 12 }}>
                  Showing {pagedOrders.length} of {filteredOrders.length} orders
                </p>

                <div className="acmo-table-wrapper">
                  <table className="acmo-table">
                    <thead>
                      <tr>
                        <th>Order No</th>
                        <th>Order Date</th>
                        <th>Customer</th>
                        <th>Product</th>
                        <th>SA</th>
                        <th>Store</th>
                        <th>Status</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedOrders.length === 0 ? (
                        <tr><td colSpan={8} className="acmo-empty">No orders match the current filters.</td></tr>
                      ) : (
                        pagedOrders.map((o) => {
                          const item = o.items?.[0] || {};
                          return (
                            <tr key={o.id}>
                              <td style={{ fontFamily: "monospace", fontSize: 12 }}>{o.order_no || "—"}</td>
                              <td>{o.created_at ? new Date(o.created_at).toLocaleDateString("en-GB") : "—"}</td>
                              <td>{o.delivery_name || "—"}</td>
                              <td>{item.product_name || "—"}</td>
                              <td>{o.salesperson || "—"}</td>
                              <td>{getOrderStore(o)}</td>
                              <td>{o.status || "—"}</td>
                              <td>₹{formatIndianNumber(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0)}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 16 }}>
                    <button
                      onClick={() => setOrdersPage((p) => Math.max(1, p - 1))}
                      disabled={ordersPage === 1}
                      style={{ padding: "6px 14px", border: "1px solid #e0d5c5", borderRadius: 6, background: "#fff", cursor: ordersPage === 1 ? "not-allowed" : "pointer", opacity: ordersPage === 1 ? 0.5 : 1 }}
                    >Prev</button>
                    <span style={{ fontSize: 13, color: "#666" }}>Page {ordersPage} of {totalPages}</span>
                    <button
                      onClick={() => setOrdersPage((p) => Math.min(totalPages, p + 1))}
                      disabled={ordersPage === totalPages}
                      style={{ padding: "6px 14px", border: "1px solid #e0d5c5", borderRadius: 6, background: "#fff", cursor: ordersPage === totalPages ? "not-allowed" : "pointer", opacity: ordersPage === totalPages ? 0.5 : 1 }}
                    >Next</button>
                  </div>
                )}
              </>
            );
          })()}

          {/* ==================== CLIENT BOOK ==================== */}
          {activeTab === "client_book" && (() => {
            // Build the chip list dynamically — show whichever stores have at
            // least one client. Always include "All" first.
            const storeChips = ["all", ...Object.keys(clientBook.storeBreakdown).sort()];
            return (
              <>
                <h2 className="acmo-section-title">Client Book</h2>
                <p style={{ color: "#666", fontSize: 13, marginTop: -8, marginBottom: 14 }}>
                  Clients grouped by their primary (most-frequent) store.
                </p>

                {/* Store filter chips */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                  {storeChips.map((s) => {
                    const active = clientStoreFilter === s;
                    const label = s === "all" ? "All" : s;
                    const count = s === "all" ? clientBook.visibleCount : (clientBook.storeBreakdown[s] || 0);
                    return (
                      <button
                        key={s}
                        onClick={() => setClientStoreFilter(s)}
                        style={{
                          padding: "8px 14px",
                          border: `1px solid ${active ? "#d5b85a" : "#e0d5c5"}`,
                          borderRadius: 20,
                          background: active ? "#d5b85a" : "#fff",
                          color: active ? "#fff" : "#666",
                          fontSize: 13, fontWeight: 500, cursor: "pointer",
                          transition: "all 0.15s",
                        }}
                      >
                        {label}
                        <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.85 }}>({count})</span>
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 12 }}>
                  <input
                    type="text"
                    placeholder="Search by name, phone, email, or SA..."
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    style={{ flex: "1 1 280px", maxWidth: 480, padding: "10px 14px", border: "1px solid #e0d5c5", borderRadius: 8, fontSize: 14, outline: "none" }}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="date"
                      value={clientDateFrom}
                      onChange={(e) => setClientDateFrom(e.target.value)}
                      max={clientDateTo || undefined}
                      aria-label="Order date from"
                      title="Filter to clients who ordered from this date"
                      style={{ padding: "10px 12px", border: "1px solid #e0d5c5", borderRadius: 8, fontSize: 14, background: "#fff", cursor: "pointer", outline: "none" }}
                    />
                    <span style={{ color: "#999" }}>→</span>
                    <input
                      type="date"
                      value={clientDateTo}
                      onChange={(e) => setClientDateTo(e.target.value)}
                      min={clientDateFrom || undefined}
                      aria-label="Order date to"
                      title="Filter to clients who ordered up to this date"
                      style={{ padding: "10px 12px", border: "1px solid #e0d5c5", borderRadius: 8, fontSize: 14, background: "#fff", cursor: "pointer", outline: "none" }}
                    />
                    {(clientDateFrom || clientDateTo) && (
                      <button
                        onClick={() => { setClientDateFrom(""); setClientDateTo(""); }}
                        title="Clear date filter"
                        style={{ padding: "8px 10px", border: "1px solid #e0d5c5", borderRadius: 8, background: "#fff", color: "#8B7355", cursor: "pointer", fontSize: 13 }}
                      >Clear</button>
                    )}
                  </div>
                  <span style={{ color: "#888", fontSize: 13 }}>
                    {clientBook.totalCount} {clientBook.totalCount === 1 ? "client" : "clients"}
                  </span>
                  <button
                    onClick={handleClientBookExportCSV}
                    disabled={clientBook.all.length === 0}
                    title="Export the entire (filtered) client book to CSV"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6, height: 42,
                      padding: "0 16px", border: "1px solid #d5b85a", borderRadius: 8,
                      background: clientBook.all.length === 0 ? "#f5f5f5" : "#faf6e8",
                      color: clientBook.all.length === 0 ? "#999" : "#8B7355",
                      fontSize: 14, fontWeight: 500,
                      cursor: clientBook.all.length === 0 ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap", transition: "all 0.2s",
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Export CSV
                  </button>
                </div>

                <div className="acmo-table-wrapper">
                  <table className="acmo-table">
                    <thead>
                      <tr>
                        <th>Client Name</th>
                        <th>Phone</th>
                        <th>Email</th>
                        <th>Primary Store</th>
                        <th>Connected SA(s)</th>
                        <th>Orders</th>
                        <th>Last Order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientBook.pageRows.length === 0 ? (
                        <tr><td colSpan={7} className="acmo-empty">No clients match the current filters.</td></tr>
                      ) : (
                        clientBook.pageRows.map((c) => (
                          <tr key={c.id || `${c.phone}-${c.email}`}>
                            <td style={{ fontWeight: 500 }}>{c.name}</td>
                            <td>{c.phone || "—"}</td>
                            <td>{c.email || "—"}</td>
                            <td>{c.primaryStore || "—"}</td>
                            <td>
                              {c.sas.length === 0 ? (
                                <span style={{ color: "#aaa" }}>—</span>
                              ) : (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                  {c.sas.map((sa) => (
                                    <span key={sa} style={{ background: "#f5f0e8", color: "#8B7355", padding: "2px 8px", borderRadius: 10, fontSize: 12, fontWeight: 500 }}>{sa}</span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td>{c.orderCount}</td>
                            <td>{c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString("en-GB") : "—"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {clientBook.totalPages > 1 && (
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 16 }}>
                    <button
                      onClick={() => setClientsPage((p) => Math.max(1, p - 1))}
                      disabled={clientBook.safePage === 1}
                      style={{ padding: "6px 14px", border: "1px solid #e0d5c5", borderRadius: 6, background: "#fff", cursor: clientBook.safePage === 1 ? "not-allowed" : "pointer", opacity: clientBook.safePage === 1 ? 0.5 : 1 }}
                    >Prev</button>
                    <span style={{ fontSize: 13, color: "#666" }}>Page {clientBook.safePage} of {clientBook.totalPages}</span>
                    <button
                      onClick={() => setClientsPage((p) => Math.min(clientBook.totalPages, p + 1))}
                      disabled={clientBook.safePage === clientBook.totalPages}
                      style={{ padding: "6px 14px", border: "1px solid #e0d5c5", borderRadius: 6, background: "#fff", cursor: clientBook.safePage === clientBook.totalPages ? "not-allowed" : "pointer", opacity: clientBook.safePage === clientBook.totalPages ? 0.5 : 1 }}
                    >Next</button>
                  </div>
                )}
              </>
            );
          })()}

          {/* ==================== WALK-INS ==================== */}
          {activeTab === "walkins" && (
            <WalkInsView orders={orders} showPopup={showPopup} />
          )}

          {/* ==================== INVENTORY ==================== */}
          {activeTab === "inventory" && (
            <>
              <h2 className="acmo-section-title">Inventory Overview</h2>

              <div className="acmo-stats-grid">
                <StatCard title="Delayed Deliveries" value={inventoryMetrics.delayedDeliveries} subtitle="Past due, not delivered" highlight={inventoryMetrics.delayedDeliveries > 0} />
                <StatCard title="Total Products" value={formatIndianNumber(inventoryMetrics.productCount)} subtitle="In the catalogue" />
                <StatCard title="Active LXRTS Products" value={inventoryMetrics.activeLxrts} subtitle={`of ${inventoryMetrics.productCount} products`} />
                <StatCard title="Consignment Inventory" value={formatIndianNumber(inventoryMetrics.consignmentQty)} subtitle="Units out on consignment" />
              </div>

              <div className="acmo-card">
                <p className="acmo-card-title">Inventory Quantity by Store</p>
                <PlaceholderCard title="Store-wise live inventory" note="Needs store-warehouse mapping — warehouse system is live but not yet tied to each store" />
              </div>
            </>
          )}

        </main>
      </div>
    </div>
  );
}
