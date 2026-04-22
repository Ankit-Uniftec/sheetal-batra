import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./AssistantCmoDashboard.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import { usePopup } from "../../components/Popup";
import NotificationBell from "../../components/NotificationBell";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line,
} from "recharts";

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

export default function AssistantCmoDashboard() {
  const { PopupComponent } = usePopup();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("overview");
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [consignment, setConsignment] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const [showSidebar, setShowSidebar] = useState(false);

  useEffect(() => {
    const checkAuthAndFetch = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/login", { replace: true }); return; }

      const { data: userRecord } = await supabase
        .from("salesperson")
        .select("role")
        .eq("email", session.user.email?.toLowerCase())
        .single();

      if (!userRecord || userRecord.role !== "assistant_cmo") {
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
        return;
      }

      setCurrentUserEmail(session.user.email?.toLowerCase() || "");
      fetchAllData();
    };
    checkAuthAndFetch();
  }, [navigate]);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      const [ordersRes, productsRes, profilesRes, consRes] = await Promise.all([
        supabase.from("orders").select("*").order("created_at", { ascending: false }),
        supabase.from("products").select("*").order("name", { ascending: true }),
        supabase.from("profiles").select("id, full_name, email, dob, loyalty_points, created_at"),
        supabase.from("consignment_inventory").select("*"),
      ]);
      if (ordersRes.data) setOrders(ordersRes.data);
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

  const isRevenueOrder = (o) => (o.status === "delivered" || o.status === "completed") && o.status !== "cancelled";

  // ==================== OVERVIEW (Bhawna's own section) ====================
  const overview = useMemo(() => {
    // Store-wise sales
    const storeMap = {};
    orders.forEach((o) => {
      const store = getOrderStore(o);
      if (!storeMap[store]) storeMap[store] = { name: store, orderCount: 0, revenue: 0, refundCount: 0, cancelCount: 0, returnCount: 0 };
      storeMap[store].orderCount += 1;
      if (isRevenueOrder(o)) storeMap[store].revenue += Number(o.grand_total || 0);
      if (o.refund_status === "processed" || o.refund_status === "completed" || o.refund_status === "refunded") storeMap[store].refundCount += 1;
      if (o.status === "cancelled") storeMap[store].cancelCount += 1;
      if (o.return_reason || o.status === "returned") storeMap[store].returnCount += 1;
    });

    // Product-wise sales analytics
    const productMap = {};
    orders.forEach((o) => {
      if (!isRevenueOrder(o)) return;
      (o.items || []).forEach((item) => {
        const name = item.product_name;
        if (!name) return;
        if (!productMap[name]) productMap[name] = { name, qty: 0, revenue: 0 };
        productMap[name].qty += Number(item.quantity || 1);
        productMap[name].revenue += Number(item.price || 0) * Number(item.quantity || 1);
      });
    });
    const topProducts = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

    // Refund / Cancellation / Return totals
    const refunds = orders.filter((o) => o.refund_status === "processed" || o.refund_status === "completed" || o.refund_status === "refunded");
    const cancellations = orders.filter((o) => o.status === "cancelled");
    const returns = orders.filter((o) => o.return_reason || o.status === "returned");
    const refundValue = refunds.reduce((s, o) => s + Number(o.grand_total || 0), 0);
    const cancelValue = cancellations.reduce((s, o) => s + Number(o.grand_total || 0), 0);
    const returnValue = returns.reduce((s, o) => s + Number(o.grand_total || 0), 0);

    // Discount impact
    let totalDiscount = 0;
    let ordersWithDiscount = 0;
    orders.forEach((o) => {
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
      refundCount: refunds.length, refundValue,
      cancelCount: cancellations.length, cancelValue,
      returnCount: returns.length, returnValue,
      totalDiscount, avgDiscount, ordersWithDiscount,
      returnReasons,
      storeTargets: Object.values(storeTargets),
    };
  }, [orders]);

  // ==================== BRAND PERFORMANCE ====================
  const brandPerformance = useMemo(() => {
    let totalRefundQty = 0;
    let totalRefundValue = 0;
    orders.forEach((o) => {
      if (o.refund_status === "processed" || o.refund_status === "completed" || o.refund_status === "refunded") {
        totalRefundQty += 1;
        totalRefundValue += Number(o.grand_total || 0);
      }
    });

    // Top products + colors (overall)
    const productMap = {};
    const colorMap = {};
    orders.forEach((o) => {
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
  }, [orders]);

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
      const amt = Number(o.grand_total || 0);

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
          monthRev += Number(o.grand_total || 0);
        }
      });
      monthsTrend.push({ month: label, revenue: Math.round(monthRev) });
    }

    return {
      todayRev, yesterdayRev, mtdRev, lastMonthRev, ytdRev, lastYearRev,
      aovOverall, aovMtd,
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

    // Repeat customer rate
    const customerOrders = {};
    orders.forEach((o) => {
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
  }, [orders, profiles]);

  // ==================== INVENTORY ====================
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
      const amt = Number(o.grand_total || 0);
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
            <button className={`acmo-nav-item ${activeTab === "inventory" ? "active" : ""}`} onClick={() => { setActiveTab("inventory"); setShowSidebar(false); }}>Inventory</button>
            <button className={`acmo-nav-item ${activeTab === "cost" ? "active" : ""}`} onClick={() => { setActiveTab("cost"); setShowSidebar(false); }}>Cost & Expenditure</button>
          </nav>
        </aside>

        <main className="acmo-main">
          {/* ==================== OVERVIEW ==================== */}
          {activeTab === "overview" && (
            <>
              <h2 className="acmo-section-title">Overview</h2>

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
                          <tr key={p.name}>
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
                      <thead><tr><th>Reason</th><th>Count</th></tr></thead>
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

              <div className="acmo-stats-grid">
                <StatCard
                  title="Cumulative Refunds"
                  value={brandPerformance.totalRefundQty}
                  subtitle={`₹${formatIndianNumber(Math.round(brandPerformance.totalRefundValue))}`}
                  highlight={brandPerformance.totalRefundQty > 0}
                />
              </div>

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
                      <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={18}>
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
                        <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={24}>
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
                        <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={24}>
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
                        <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={16} fill="#d5b85a" />
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
                        <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={24}>
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
                        <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={24}>
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

              <div className="acmo-stats-grid">
                <StatCard title="Average Client Age" value={clientInsights.avgClientAge !== "—" ? `${clientInsights.avgClientAge} yrs` : "—"} subtitle={`${clientInsights.totalClients} total clients`} />
                <StatCard title="Repeat Customer Rate" value={`${clientInsights.repeatRate}%`} subtitle={`${clientInsights.repeatCustomers} of ${clientInsights.totalCustomers}`} highlight={Number(clientInsights.repeatRate) > 30} />
                <StatCard title="New Clients (Last 7 Days)" value={clientInsights.newLast7} />
                <StatCard title="New Clients (Last 30 Days)" value={clientInsights.newLast30} />
              </div>
            </>
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

          {/* ==================== COST & EXPENDITURE ==================== */}
          {activeTab === "cost" && (
            <>
              <h2 className="acmo-section-title">Cost & Expenditure</h2>

              <div className="acmo-stats-grid">
                <StatCard title="Discounts Given" value={`₹${formatIndianNumber(Math.round(costExpenditure.totalDiscount))}`} subtitle={`${costExpenditure.discountPct}% of gross revenue · ${costExpenditure.discountedOrders} orders`} />
                <StatCard title="Refunds Value" value={`₹${formatIndianNumber(Math.round(costExpenditure.refundValue))}`} subtitle="Across all channels" highlight={costExpenditure.refundValue > 0} />
                <StatCard title="Returns Value" value={`₹${formatIndianNumber(Math.round(costExpenditure.returnValue))}`} subtitle="Across all channels" highlight={costExpenditure.returnValue > 0} />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
