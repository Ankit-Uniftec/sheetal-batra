import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { fetchAllRows } from "../../utils/fetchAllRows";
import "./CeoAssistantDashboard.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";
import { usePopup } from "../../components/Popup";
import NotificationBell from "../../components/NotificationBell";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
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
  <div className="ca-stat-card ca-placeholder-card">
    <div className="ca-placeholder-badge">Coming Soon</div>
    <p className="ca-stat-title">{title}</p>
    <p className="ca-placeholder-note">{note || "Data source pending"}</p>
  </div>
);

const StatCard = ({ title, value, subtitle, highlight }) => (
  <div className={`ca-stat-card ${highlight ? "ca-highlight" : ""}`}>
    <p className="ca-stat-title">{title}</p>
    <p className="ca-stat-value">{value}</p>
    {subtitle && <p className="ca-stat-subtitle">{subtitle}</p>}
  </div>
);

export default function CeoAssistantDashboard() {
  const { showPopup, PopupComponent } = usePopup();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("store_performance");
  const [orders, setOrders] = useState([]);
  const [salespersonTable, setSalespersonTable] = useState([]);
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

      if (!userRecord || userRecord.role !== "ceo_assistant") {
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
      const [ordersRes, spRes] = await Promise.all([
        fetchAllRows("orders", (q) => q.select("*").order("created_at", { ascending: false })),
        supabase.from("salesperson").select("saleperson, role, email, phone, store_name"),
      ]);
      if (ordersRes.data) setOrders(ordersRes.data);
      if (spRes.data) setSalespersonTable(spRes.data);
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


  // ==================== STORE PERFORMANCE ====================
  const storePerformance = useMemo(() => {
    const stores = {};
    orders.forEach((o) => {
      const store = getOrderStore(o);
      if (!stores[store]) {
        stores[store] = {
          name: store,
          orderCount: 0,
          revenue: 0,
          refundCount: 0, refundAmount: 0,
          returnCount: 0, returnAmount: 0,
          exchangeCount: 0, exchangeAmount: 0,
          cancelCount: 0, cancelAmount: 0,
          revokeCount: 0, revokeAmount: 0,
        };
      }
      stores[store].orderCount += 1;
      if (o.status === "delivered" || o.status === "completed") {
        stores[store].revenue += Number(o.grand_total || 0);
      }
      const amt = Number(o.grand_total || 0);
      if (o.refund_status === "processed" || o.refund_status === "completed" || o.refund_status === "refunded") {
        stores[store].refundCount += 1;
        stores[store].refundAmount += amt;
      }
      if (o.return_reason || o.status === "returned" || (Array.isArray(o.returned_items) && o.returned_items.length > 0)) {
        stores[store].returnCount += 1;
        stores[store].returnAmount += amt;
      }
      if (o.exchange_reason || o.exchange_requested_at) {
        stores[store].exchangeCount += 1;
        stores[store].exchangeAmount += amt;
      }
      if (o.status === "cancelled") {
        stores[store].cancelCount += 1;
        stores[store].cancelAmount += amt;
      }
      if (o.revoked_at || o.revoke_reason) {
        stores[store].revokeCount += 1;
        stores[store].revokeAmount += amt;
      }
    });
    return Object.values(stores);
  }, [orders]);

  // SA-wise impact (who has the most returns/refunds/cancellations)
  const saImpact = useMemo(() => {
    const findName = (email) => {
      if (!email) return "—";
      const sp = salespersonTable.find((s) => s.email?.toLowerCase() === email.toLowerCase());
      return sp?.saleperson || email;
    };
    const saMap = {};
    orders.forEach((o) => {
      const email = o.salesperson_email;
      if (!email) return;
      if (!saMap[email]) {
        saMap[email] = { email, name: findName(email), refund: 0, return: 0, exchange: 0, cancel: 0, revoke: 0 };
      }
      if (o.refund_status === "processed" || o.refund_status === "completed" || o.refund_status === "refunded") saMap[email].refund += 1;
      if (o.return_reason || o.status === "returned") saMap[email].return += 1;
      if (o.exchange_reason || o.exchange_requested_at) saMap[email].exchange += 1;
      if (o.status === "cancelled") saMap[email].cancel += 1;
      if (o.revoked_at || o.revoke_reason) saMap[email].revoke += 1;
    });
    const values = Object.values(saMap);
    const topBy = (key) => values.slice().sort((a, b) => b[key] - a[key])[0] || { name: "—", [key]: 0 };
    return {
      topRefund: topBy("refund"),
      topReturn: topBy("return"),
      topExchange: topBy("exchange"),
      topCancel: topBy("cancel"),
      topRevoke: topBy("revoke"),
    };
  }, [orders, salespersonTable]);

  // Top performing days
  const topDays = useMemo(() => {
    const dayMap = {};
    orders.forEach((o) => {
      if (o.status === "cancelled") return;
      const d = new Date(o.created_at);
      if (isNaN(d.getTime())) return;
      const key = d.toISOString().split("T")[0];
      const store = getOrderStore(o);
      if (!dayMap[key]) dayMap[key] = { date: key, total: 0, byStore: {} };
      dayMap[key].total += 1;
      dayMap[key].byStore[store] = (dayMap[key].byStore[store] || 0) + 1;
    });
    return Object.values(dayMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [orders]);

  // ==================== PRODUCT / STYLE / DESIGN ====================
  const productPerformance = useMemo(() => {
    const isRevenue = (o) => (o.status === "delivered" || o.status === "completed");

    const productMap = {};
    const colorMap = {};
    const returnStyleMap = {};
    const alterationStyleMap = {};
    let totalAlterations = 0;
    let alterationItemCount = 0;

    orders.forEach((o) => {
      (o.items || []).forEach((item) => {
        const name = item.product_name;
        const color = getItemColor(item);
        const qty = Number(item.quantity || 1);

        if (isRevenue(o)) {
          if (name) {
            if (!productMap[name]) productMap[name] = { name, count: 0 };
            productMap[name].count += qty;
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

        if ((o.return_reason || o.status === "returned") && name) {
          if (!returnStyleMap[name]) returnStyleMap[name] = { name, returnCount: 0, totalCount: 0 };
          returnStyleMap[name].returnCount += 1;
        }
        if (name) {
          if (!returnStyleMap[name]) returnStyleMap[name] = { name, returnCount: 0, totalCount: 0 };
          returnStyleMap[name].totalCount += 1;
        }
      });
    });

    const topProducts = Object.values(productMap).sort((a, b) => b.count - a.count).slice(0, 10);
    const sortedColors = Object.values(colorMap).sort((a, b) => b.count - a.count);
    const topColors = sortedColors.slice(0, 8);
    const bottomColors = sortedColors.slice(-5).reverse();

    const highAlterationStyles = Object.values(alterationStyleMap).sort((a, b) => b.count - a.count).slice(0, 10);
    const repetitiveAlterations = highAlterationStyles.filter((s) => s.count >= 3);
    const avgAlterationsPerOutfit = alterationItemCount > 0 ? (totalAlterations / alterationItemCount).toFixed(2) : "0.00";

    const highReturnStyles = Object.values(returnStyleMap)
      .filter((s) => s.totalCount >= 3)
      .map((s) => ({ ...s, returnRate: ((s.returnCount / s.totalCount) * 100).toFixed(1) }))
      .sort((a, b) => Number(b.returnRate) - Number(a.returnRate))
      .slice(0, 10);

    return {
      topProducts, topColors, bottomColors,
      highAlterationStyles, repetitiveAlterations, avgAlterationsPerOutfit,
      highReturnStyles,
    };
  }, [orders]);

  // ==================== OPERATIONAL FLAGS ====================
  const operationalFlags = useMemo(() => {
    const now = new Date();
    const delayed = orders.filter((o) => {
      if (o.status === "delivered" || o.status === "completed" || o.status === "cancelled") return false;
      if (!o.delivery_date) return false;
      return new Date(o.delivery_date) < now;
    }).length;

    const productionBacklog = orders.filter(
      (o) => o.status !== "delivered" && o.status !== "completed" && o.status !== "cancelled"
    ).length;

    return { delayed, productionBacklog };
  }, [orders]);

  // ==================== LOADING ====================
  if (loading) {
    return (
      <div className="ca-loading-container">
        <div className="ca-spinner"></div>
        <p>Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div className="ca-dashboard-wrapper">
      {PopupComponent}

      <header className="ca-header">
        <img src={Logo} alt="logo" className="ca-logo" onClick={handleLogout} />
        <h1 className="ca-title">CEO Assistant</h1>
        <div className="ca-header-right">
          <NotificationBell userEmail={currentUserEmail} />
          <button className="ca-logout-btn" onClick={handleLogout}>Logout</button>
          <div className="ca-hamburger" onClick={() => setShowSidebar(!showSidebar)}>
            <div className="ca-bar"></div>
            <div className="ca-bar"></div>
            <div className="ca-bar"></div>
          </div>
        </div>
      </header>

      <div className="ca-layout">
        <aside className={`ca-sidebar ${showSidebar ? "ca-open" : ""}`}>
          <nav className="ca-nav">
            <button className={`ca-nav-item ${activeTab === "store_performance" ? "active" : ""}`} onClick={() => { setActiveTab("store_performance"); setShowSidebar(false); }}>Store Performance</button>
            <button className={`ca-nav-item ${activeTab === "product_style" ? "active" : ""}`} onClick={() => { setActiveTab("product_style"); setShowSidebar(false); }}>Product & Style</button>
            <button className={`ca-nav-item ${activeTab === "ops_flags" ? "active" : ""}`} onClick={() => { setActiveTab("ops_flags"); setShowSidebar(false); }}>Operational Flags</button>
            <button className={`ca-nav-item ${activeTab === "monthly_five" ? "active" : ""}`} onClick={() => { setActiveTab("monthly_five"); setShowSidebar(false); }}>Monthly Five</button>
            <button className={`ca-nav-item ${activeTab === "attendance" ? "active" : ""}`} onClick={() => { setActiveTab("attendance"); setShowSidebar(false); }}>Retail Attendance</button>
          </nav>
        </aside>

        <main className="ca-main">
          {/* ==================== STORE PERFORMANCE ==================== */}
          {activeTab === "store_performance" && (
            <>
              <h2 className="ca-section-title">Store Performance</h2>

              {/* Store-wise order count */}
              <div className="ca-card">
                <p className="ca-card-title">Store-wise Order Count</p>
                <div className="ca-stats-grid">
                  {storePerformance.map((s) => (
                    <StatCard
                      key={s.name}
                      title={s.name}
                      value={s.orderCount}
                      subtitle={`₹${formatIndianNumber(Math.round(s.revenue))} revenue`}
                    />
                  ))}
                </div>
              </div>

              {/* Refunds / Returns / Exchanges / Cancellations / Revokes */}
              <div className="ca-card">
                <p className="ca-card-title">Refunds, Returns, Exchanges, Cancellations & Revoked Orders — Store-wise</p>
                <div className="ca-table-wrapper">
                  <table className="ca-table">
                    <thead>
                      <tr>
                        <th>Store</th>
                        <th>Refunds (Qty / ₹)</th>
                        <th>Returns (Qty / ₹)</th>
                        <th>Exchanges (Qty / ₹)</th>
                        <th>Cancellations (Qty / ₹)</th>
                        <th>Revoked (Qty / ₹)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {storePerformance.map((s) => (
                        <tr key={s.name}>
                          <td><strong>{s.name}</strong></td>
                          <td>{s.refundCount} / ₹{formatIndianNumber(Math.round(s.refundAmount))}</td>
                          <td>{s.returnCount} / ₹{formatIndianNumber(Math.round(s.returnAmount))}</td>
                          <td>{s.exchangeCount} / ₹{formatIndianNumber(Math.round(s.exchangeAmount))}</td>
                          <td>{s.cancelCount} / ₹{formatIndianNumber(Math.round(s.cancelAmount))}</td>
                          <td>{s.revokeCount} / ₹{formatIndianNumber(Math.round(s.revokeAmount))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* SA with max count in each category */}
              <div className="ca-card">
                <p className="ca-card-title">Sales Associates with Highest Counts</p>
                <div className="ca-stats-grid">
                  <StatCard title="Top Refunds" value={saImpact.topRefund.refund} subtitle={saImpact.topRefund.name} highlight={saImpact.topRefund.refund > 0} />
                  <StatCard title="Top Returns" value={saImpact.topReturn.return} subtitle={saImpact.topReturn.name} highlight={saImpact.topReturn.return > 0} />
                  <StatCard title="Top Exchanges" value={saImpact.topExchange.exchange} subtitle={saImpact.topExchange.name} highlight={saImpact.topExchange.exchange > 0} />
                  <StatCard title="Top Cancellations" value={saImpact.topCancel.cancel} subtitle={saImpact.topCancel.name} highlight={saImpact.topCancel.cancel > 0} />
                  <StatCard title="Top Revoked" value={saImpact.topRevoke.revoke} subtitle={saImpact.topRevoke.name} highlight={saImpact.topRevoke.revoke > 0} />
                </div>
              </div>

              {/* Top-performing days */}
              <div className="ca-card">
                <p className="ca-card-title">Top-Performing Days (by order count)</p>
                {topDays.length === 0 ? (
                  <p className="ca-empty">No orders yet</p>
                ) : (
                  <div className="ca-table-wrapper">
                    <table className="ca-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Total Orders</th>
                          <th>Per Store</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topDays.map((d) => (
                          <tr key={d.date}>
                            <td>{formatDate(d.date)}</td>
                            <td><strong>{d.total}</strong></td>
                            <td>{Object.entries(d.byStore).map(([store, count]) => `${store}: ${count}`).join(" · ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Live inventory placeholder (would need warehouse_stock aggregation) */}
              <div className="ca-card">
                <p className="ca-card-title">Live Inventory at Stores</p>
                <PlaceholderCard title="Store-wise live inventory" note="Needs store-warehouse mapping — placeholder until integrated" />
              </div>

              {/* SA Attendance — no data */}
              <div className="ca-card">
                <p className="ca-card-title">SA Attendance Report (Store-wise)</p>
                <PlaceholderCard title="SA attendance tracking" note="No attendance table exists yet" />
              </div>

              {/* Footfall — no data */}
              <div className="ca-card">
                <p className="ca-card-title">Store-wise Footfall</p>
                <PlaceholderCard title="Daily / Weekly / Monthly footfall" note="No footfall tracking table exists yet" />
              </div>
            </>
          )}

          {/* ==================== PRODUCT & STYLE ==================== */}
          {activeTab === "product_style" && (
            <>
              <h2 className="ca-section-title">Product, Style & Design Performance</h2>

              <div className="ca-card">
                <p className="ca-card-title">Top-Performing Products</p>
                {productPerformance.topProducts.length === 0 ? (
                  <p className="ca-empty">No delivered orders yet</p>
                ) : (
                  <ResponsiveContainer width="100%" height={340}>
                    <BarChart data={productPerformance.topProducts} layout="vertical" margin={{ top: 10, right: 30, left: 0, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#eee" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "#888" }} allowDecimals={false} axisLine={false} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={160}
                        tick={{ fontSize: 11, fill: "#444" }}
                        tickFormatter={(v) => (v.length > 20 ? v.slice(0, 20) + "…" : v)}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e8e2d0", borderRadius: 10, fontSize: 12 }} />
                      <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={18}>
                        {productPerformance.topProducts.map((_, i) => (
                          <Cell key={i} fill={`rgba(213, 184, 90, ${1 - i * 0.07})`} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="ca-charts-grid">
                <div className="ca-card">
                  <p className="ca-card-title">Top Performing Colours</p>
                  {productPerformance.topColors.length === 0 ? (
                    <p className="ca-empty">No data yet</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={productPerformance.topColors} margin={{ top: 10, right: 20, left: 0, bottom: 50 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                        <XAxis dataKey="name" interval={0} tick={{ fontSize: 11, fill: "#555" }} angle={-25} textAnchor="end" height={60} />
                        <YAxis tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e8e2d0", borderRadius: 10, fontSize: 12 }} />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={24}>
                          {productPerformance.topColors.map((c, i) => (
                            <Cell key={i} fill={getColorHex(c.name)} stroke="rgba(0,0,0,0.08)" />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                <div className="ca-card">
                  <p className="ca-card-title">Bottom Performing Colours</p>
                  {productPerformance.bottomColors.length === 0 ? (
                    <p className="ca-empty">No data yet</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={productPerformance.bottomColors} margin={{ top: 10, right: 20, left: 0, bottom: 50 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                        <XAxis dataKey="name" interval={0} tick={{ fontSize: 11, fill: "#555" }} angle={-25} textAnchor="end" height={60} />
                        <YAxis tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e8e2d0", borderRadius: 10, fontSize: 12 }} />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={24}>
                          {productPerformance.bottomColors.map((c, i) => (
                            <Cell key={i} fill={getColorHex(c.name)} stroke="rgba(0,0,0,0.08)" />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="ca-card">
                <p className="ca-card-title">Alteration Insights</p>
                <div className="ca-stats-grid">
                  <StatCard title="Average Alterations / Outfit" value={productPerformance.avgAlterationsPerOutfit} subtitle="Across all altered items" />
                  <StatCard title="Repetitive Alterations (Flagged)" value={productPerformance.repetitiveAlterations.length} subtitle="Styles with 3+ alteration requests" highlight={productPerformance.repetitiveAlterations.length > 0} />
                  <StatCard title="High-Alteration Styles" value={productPerformance.highAlterationStyles.length} subtitle="Top styles with most alterations" />
                </div>
              </div>

              <div className="ca-card">
                <p className="ca-card-title">Styles with High Alterations</p>
                {productPerformance.highAlterationStyles.length === 0 ? (
                  <p className="ca-empty">No alteration data yet</p>
                ) : (
                  <div className="ca-table-wrapper">
                    <table className="ca-table">
                      <thead>
                        <tr><th>Style / Product</th><th>Alterations</th><th>Flag</th></tr>
                      </thead>
                      <tbody>
                        {productPerformance.highAlterationStyles.map((s) => (
                          <tr key={s.name}>
                            <td>{s.name}</td>
                            <td><strong>{s.count}</strong></td>
                            <td>{s.count >= 3 ? <span className="ca-flag-warning">Repetitive</span> : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="ca-card">
                <p className="ca-card-title">High-Return Styles (%)</p>
                {productPerformance.highReturnStyles.length === 0 ? (
                  <p className="ca-empty">No significant return data yet</p>
                ) : (
                  <div className="ca-table-wrapper">
                    <table className="ca-table">
                      <thead>
                        <tr><th>Style</th><th>Returned</th><th>Total Sold</th><th>Return Rate</th></tr>
                      </thead>
                      <tbody>
                        {productPerformance.highReturnStyles.map((s) => (
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

              <div className="ca-card">
                <p className="ca-card-title">Customisation Trends</p>
                <div className="ca-stats-grid">
                  <PlaceholderCard title="Length-related customisation" note="Needs customisation tagging on order items" />
                  <PlaceholderCard title="Fit & structure trends" note="Needs customisation tagging on order items" />
                  <PlaceholderCard title="Silhouette preferences" note="Needs customisation tagging on order items" />
                  <PlaceholderCard title="Colour-driven trends" note="Needs customisation tagging on order items" />
                </div>
              </div>
            </>
          )}

          {/* ==================== OPERATIONAL FLAGS ==================== */}
          {activeTab === "ops_flags" && (
            <>
              <h2 className="ca-section-title">Operational Flags</h2>
              <div className="ca-stats-grid">
                <StatCard title="Orders Delayed" value={operationalFlags.delayed} subtitle="Past delivery date, not yet delivered" highlight={operationalFlags.delayed > 0} />
                <PlaceholderCard title="QC Failures" note="No QC tracking table exists yet" />
                <StatCard title="Production Backlog" value={operationalFlags.productionBacklog} subtitle="Open, non-cancelled orders" highlight={operationalFlags.productionBacklog > 10} />
              </div>
            </>
          )}

          {/* ==================== MONTHLY FIVE ==================== */}
          {activeTab === "monthly_five" && (
            <>
              <h2 className="ca-section-title">Monthly Five Submission</h2>
              <div className="ca-card">
                <p className="ca-card-title">Monthly Report to CEO</p>
                <PlaceholderCard
                  title="Monthly Five report submission"
                  note="Upload/submit 5 bullet points to CEO at end of each month. Submission tracking needs a dedicated table."
                />
                <div style={{ marginTop: 16 }}>
                  <button
                    className="ca-btn-primary"
                    onClick={() => showPopup({
                      title: "Coming Soon",
                      message: "Monthly Five report upload will be connected to a reports table once created.",
                      type: "info",
                      confirmText: "Ok",
                    })}
                  >
                    Submit Monthly Report
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ==================== ATTENDANCE ==================== */}
          {activeTab === "attendance" && (
            <>
              <h2 className="ca-section-title">Retail Employee Attendance</h2>
              <div className="ca-card">
                <p className="ca-card-title">Employee-wise Attendance</p>
                <PlaceholderCard
                  title="Attendance tracking"
                  note="No attendance table exists yet — will show employee-wise daily attendance once the tracking system is in place."
                />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
