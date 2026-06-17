import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { fetchAllRows } from "../../utils/fetchAllRows";
import { isRevenueOrder } from "../../utils/revenue";
import "./AccountantDashboard.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import SearchByDropdown from "../../components/SearchByDropdown";
import { totalNetSbRevenue } from "../../utils/exhibitionService";

// Accountant Dashboard — for the "ACCOUNTANT — DISPATCH & LOGISTICS" role.
// Sidebar with 4 tabs (Overview + the 3 spec items).

const TIMELINE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "weekly", label: "Last 7 Days" },
  { value: "monthly", label: "Last 30 Days" },
  { value: "yearly", label: "Last 365 Days" },
  { value: "all", label: "All Time" },
  { value: "custom", label: "Custom" },
];

const ITEMS_PER_PAGE = 15;

const CHANNEL_COLORS = {
  "Website (LXRTS)": "#1976d2",
  "Delhi Store": "#d5b85a",
  "Ludhiana Store": "#8B7355",
  "B2B": "#7b1fa2",
  "Private": "#c62828",
  "Exhibition": "#2e7d32",
  "Other": "#999",
};

// Order-flow stages (left → right). Used by the funnel + status cards.
const STATUS_FLOW = [
  { key: "order_received", label: "Order Received", color: "#9e9e9e" },
  { key: "in_production",  label: "In Production",  color: "#3f51b5" },
  { key: "ready_for_dispatch", label: "Ready for Dispatch", color: "#2e7d32" },
  { key: "dispatched", label: "Dispatched", color: "#1565c0" },
  { key: "delivered",  label: "Delivered",  color: "#0d47a1" },
  { key: "cancelled",  label: "Cancelled",  color: "#c62828" },
  { key: "exchange_return", label: "Exchange / Return", color: "#ef6c00" },
  { key: "refund_requested", label: "Refund Requested", color: "#7b1fa2" },
  { key: "revoked",    label: "Revoked",    color: "#6d4c41" },
];

const ChartTooltip = ({ active, payload, label, prefix = "₹" }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="acct-chart-tooltip">
      <p className="acct-chart-tooltip-label">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: {prefix}{formatIndianNumber(Math.round(entry.value))}
        </p>
      ))}
    </div>
  );
};

// Map an order to a channel label.
const getOrderChannel = (order) => {
  if (order.items?.[0]?.sync_enabled === true) return "Website (LXRTS)";
  if (order.is_b2b || (order.salesperson_store || "").toLowerCase() === "b2b") return "B2B";
  if (order.is_private_order) return "Private";
  const store = (order.salesperson_store || "").trim();
  if (!store) return "Other";
  if (/exhib/i.test(store)) return "Exhibition";
  if (/delhi/i.test(store)) return "Delhi Store";
  if (/ludhi/i.test(store)) return "Ludhiana Store";
  return store;
};

// Map an order to a status bucket — uses explicit timestamps when set,
// falls back to status string. Returns one of STATUS_FLOW keys.
const getOrderStatus = (order) => {
  if (order.refund_status === "pending" || order.refund_reason) return "refund_requested";
  if (order.exchange_reason || order.return_reason) return "exchange_return";
  if (order.revoked_at) return "revoked";
  const s = (order.status || "").toLowerCase();
  if (s === "cancelled") return "cancelled";
  if (s === "delivered") return "delivered";
  if (s === "completed" || order.dispatched_at) return "dispatched";
  if (order.ready_for_dispatch_at) return "ready_for_dispatch";
  if (order.in_production_at) return "in_production";
  return "order_received";
};

export default function AccountantDashboard() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [currentUserName, setCurrentUserName] = useState("");

  // Tabs
  const [activeTab, setActiveTab] = useState("overview");
  const [showSidebar, setShowSidebar] = useState(false);

  // Filter state
  const [timeline, setTimeline] = useState("monthly");
  const [customDateFrom, setCustomDateFrom] = useState("");
  const [customDateTo, setCustomDateTo] = useState("");
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);

  // Order Status tab — drill-down + table
  const [statusFilter, setStatusFilter] = useState("all");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderSearchField, setOrderSearchField] = useState("order_no");
  const [ordersPage, setOrdersPage] = useState(1);

  // Returns & Refunds tab — issue list pagination
  const [issuePage, setIssuePage] = useState(1);

  // ─── Auth + fetch ─────────────────────────────────────────────
  useEffect(() => {
    const checkAuthAndFetch = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/login", { replace: true }); return; }

      const { data: userRecord } = await supabase
        .from("salesperson")
        .select("role, saleperson")
        .eq("email", session.user.email?.toLowerCase())
        .single();

      if (!userRecord || userRecord.role !== "accountant") {
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
        return;
      }
      setCurrentUserName(userRecord.saleperson || "");

      const { data, error } = await fetchAllRows("orders", (q) =>
        q.select("*").order("created_at", { ascending: false })
      );
      if (!error) setOrders((data || []).filter(o => !o.is_comms));
      setLoading(false);
    };
    checkAuthAndFetch();
  }, [navigate]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  // ─── Date range helpers ──────────────────────────────────────
  const dateRange = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    switch (timeline) {
      case "today":     return { start: today, end: now };
      case "yesterday": {
        const y = new Date(today); y.setDate(y.getDate() - 1);
        const ye = new Date(today); ye.setMilliseconds(-1);
        return { start: y, end: ye };
      }
      case "weekly":  { const w = new Date(today); w.setDate(w.getDate() - 7);   return { start: w, end: now }; }
      case "monthly": { const m = new Date(today); m.setDate(m.getDate() - 30);  return { start: m, end: now }; }
      case "yearly":  { const y = new Date(today); y.setDate(y.getDate() - 365); return { start: y, end: now }; }
      case "all":     return null;
      case "custom":
        return {
          start: customDateFrom ? new Date(customDateFrom) : new Date(0),
          end: customDateTo ? new Date(customDateTo + "T23:59:59") : now,
        };
      default: return { start: today, end: now };
    }
  }, [timeline, customDateFrom, customDateTo]);

  const periodOrders = useMemo(() => {
    if (!dateRange) return orders;
    return orders.filter(o => {
      const d = new Date(o.created_at);
      return d >= dateRange.start && d <= dateRange.end;
    });
  }, [orders, dateRange]);

  // ─── Channel stats ───────────────────────────────────────────
  const channelStats = useMemo(() => {
    const map = {};
    periodOrders.forEach(o => {
      const ch = getOrderChannel(o);
      if (!map[ch]) map[ch] = { name: ch, orders: 0, revenue: 0 };
      map[ch].orders += 1;
      if (isRevenueOrder(o)) map[ch].revenue += Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0);
    });
    const list = Object.values(map).sort((a, b) => b.revenue - a.revenue);
    const totalRevenue = list.reduce((s, c) => s + c.revenue, 0);
    const totalOrders = list.reduce((s, c) => s + c.orders, 0);
    // Net SB Revenue: exhibition orders net of commission, others at gross.
    const netSb = totalNetSbRevenue(periodOrders.filter(isRevenueOrder));
    return { list, totalRevenue, totalOrders, netSb };
  }, [periodOrders]);

  // ─── Status stats ────────────────────────────────────────────
  const statusStats = useMemo(() => {
    const counts = {};
    STATUS_FLOW.forEach(s => { counts[s.key] = 0; });
    periodOrders.forEach(o => {
      const k = getOrderStatus(o);
      if (counts[k] !== undefined) counts[k] += 1;
    });
    return STATUS_FLOW.map(s => ({ ...s, count: counts[s.key] }));
  }, [periodOrders]);

  // ─── Status drill-down table ─────────────────────────────────
  const filteredOrdersForTable = useMemo(() => {
    let list = periodOrders;
    if (statusFilter !== "all") {
      list = list.filter(o => getOrderStatus(o) === statusFilter);
    }
    if (orderSearch.trim()) {
      const q = orderSearch.trim().toLowerCase();
      list = list.filter(o => {
        switch (orderSearchField) {
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
    return list;
  }, [periodOrders, statusFilter, orderSearch, orderSearchField]);

  const ordersTotalPages = Math.max(1, Math.ceil(filteredOrdersForTable.length / ITEMS_PER_PAGE));
  const currentOrdersPage = useMemo(
    () => filteredOrdersForTable.slice((ordersPage - 1) * ITEMS_PER_PAGE, ordersPage * ITEMS_PER_PAGE),
    [filteredOrdersForTable, ordersPage]
  );
  useEffect(() => { setOrdersPage(1); }, [statusFilter, orderSearch, orderSearchField, timeline, customDateFrom, customDateTo]);

  // ─── Returns + refunds ───────────────────────────────────────
  const returnsRefunds = useMemo(() => {
    const cancelled = periodOrders.filter(o => o.status?.toLowerCase() === "cancelled");
    const refunded  = periodOrders.filter(o => o.refund_reason || o.refund_status || o.status === "refund_requested");
    const returned  = periodOrders.filter(o => o.return_reason);
    const exchanged = periodOrders.filter(o => o.exchange_reason);
    const revoked   = periodOrders.filter(o => o.revoked_at);

    const sum = (list) => list.reduce((s, o) => s + Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0), 0);

    const allIssues = [...cancelled, ...refunded, ...returned, ...exchanged, ...revoked];
    const seenIds = new Set();
    const dedupedIssues = allIssues.filter(o => {
      if (seenIds.has(o.id)) return false;
      seenIds.add(o.id);
      return true;
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const byChannel = {};
    dedupedIssues.forEach(o => {
      const ch = getOrderChannel(o);
      if (!byChannel[ch]) byChannel[ch] = { name: ch, count: 0, value: 0 };
      byChannel[ch].count += 1;
      byChannel[ch].value += Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0);
    });
    const channelBreakdown = Object.values(byChannel).sort((a, b) => b.count - a.count);

    return {
      cancelled: { count: cancelled.length, value: sum(cancelled) },
      refunded:  { count: refunded.length,  value: sum(refunded)  },
      returned:  { count: returned.length,  value: sum(returned)  },
      exchanged: { count: exchanged.length, value: sum(exchanged) },
      revoked:   { count: revoked.length,   value: sum(revoked)   },
      channelBreakdown,
      issues: dedupedIssues,
    };
  }, [periodOrders]);

  const issuesTotalPages = Math.max(1, Math.ceil(returnsRefunds.issues.length / ITEMS_PER_PAGE));
  const currentIssuesPage = useMemo(
    () => returnsRefunds.issues.slice((issuePage - 1) * ITEMS_PER_PAGE, issuePage * ITEMS_PER_PAGE),
    [returnsRefunds.issues, issuePage]
  );
  useEffect(() => { setIssuePage(1); }, [timeline, customDateFrom, customDateTo]);

  if (loading) {
    return (
      <div className="acct-page">
        <div className="acct-loading">
          <div className="acct-spinner" />
          <p>Loading Accountant Dashboard…</p>
        </div>
      </div>
    );
  }

  // ─── Reusable: Timeline filter bar ───
  const TimelineBar = (
    <div className="acct-filters-bar">
      <div className="acct-timeline-pills">
        {TIMELINE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            className={`acct-pill ${timeline === opt.value ? "active" : ""}`}
            onClick={() => { setTimeline(opt.value); setShowCustomDatePicker(opt.value === "custom"); }}
          >{opt.label}</button>
        ))}
      </div>
      {showCustomDatePicker && (
        <div className="acct-date-range">
          <input type="date" value={customDateFrom} onChange={(e) => setCustomDateFrom(e.target.value)} />
          <span>{"→"}</span>
          <input type="date" value={customDateTo} onChange={(e) => setCustomDateTo(e.target.value)} />
        </div>
      )}
    </div>
  );

  return (
    <div className="acct-page">
      {/* HEADER */}
      <header className="acct-header">
        <div className="acct-header-left">
          <button className="acct-hamburger" onClick={() => setShowSidebar(!showSidebar)}>
            <span /><span /><span />
          </button>
          <img src={Logo} alt="Logo" className="acct-logo" />
        </div>
        <h1 className="acct-title">Accountant — Dispatch & Logistics</h1>
        <div className="acct-header-right">
          {currentUserName && <span className="acct-user">{currentUserName}</span>}
          <button className="acct-logout-btn" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <div className="acct-layout">
        {/* SIDEBAR */}
        <aside className={`acct-sidebar ${showSidebar ? "open" : ""}`}>
          <nav className="acct-nav">
            <span className="acct-nav-section">Dashboard</span>
            {[
              { key: "overview", label: "Overview" },
              { key: "channels", label: "Orders by Channel" },
              { key: "status",   label: "Order Status" },
              { key: "returns",  label: "Returns & Refunds" },
            ].map(t => (
              <button
                key={t.key}
                className={`acct-nav-item ${activeTab === t.key ? "active" : ""}`}
                onClick={() => { setActiveTab(t.key); setShowSidebar(false); }}
              >{t.label}</button>
            ))}
          </nav>
        </aside>

        {/* MAIN */}
        <main className="acct-content">
          {TimelineBar}

          {/* ═══════════ OVERVIEW ═══════════ */}
          {activeTab === "overview" && (
            <div>
              <h2 className="acct-section-title">Overview</h2>
              <div className="acct-stats-grid">
                <div className="acct-stat-card">
                  <span className="acct-stat-label">Total Orders</span>
                  <span className="acct-stat-value">{channelStats.totalOrders}</span>
                </div>
                <div className="acct-stat-card">
                  <span className="acct-stat-label">Total Revenue</span>
                  <span className="acct-stat-value">{"₹"}{formatIndianNumber(Math.round(channelStats.totalRevenue))}</span>
                </div>
                <div className="acct-stat-card">
                  <span className="acct-stat-label">Net SB Revenue</span>
                  <span className="acct-stat-value">{"₹"}{formatIndianNumber(Math.round(channelStats.netSb))}</span>
                </div>
                <div className="acct-stat-card">
                  <span className="acct-stat-label">Channels Active</span>
                  <span className="acct-stat-value">{channelStats.list.length}</span>
                </div>
                <div className="acct-stat-card acct-stat-cancelled">
                  <span className="acct-stat-label">Cancellations</span>
                  <span className="acct-stat-value">{returnsRefunds.cancelled.count}</span>
                </div>
                <div className="acct-stat-card acct-stat-refund">
                  <span className="acct-stat-label">Refunds</span>
                  <span className="acct-stat-value">{returnsRefunds.refunded.count}</span>
                </div>
              </div>

              <div className="acct-row">
                {channelStats.list.length > 0 && (
                  <div className="acct-card acct-card-flex-1">
                    <h3 className="acct-card-title">Revenue by Channel</h3>
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie
                          data={channelStats.list}
                          cx="50%" cy="50%"
                          innerRadius={50} outerRadius={90}
                          dataKey="revenue"
                          label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                        >
                          {channelStats.list.map((c, i) => (
                            <Cell key={i} fill={CHANNEL_COLORS[c.name] || "#999"} />
                          ))}
                        </Pie>
                        <Tooltip content={<ChartTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}

                <div className="acct-card acct-card-flex-1">
                  <h3 className="acct-card-title">Status Distribution</h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={statusStats} layout="vertical" margin={{ top: 4, right: 20, left: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} />
                      <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={130} axisLine={false} tickLine={false} />
                      <Tooltip />
                      <Bar dataKey="count" name="Orders" radius={[0, 4, 4, 0]} barSize={14}>
                        {statusStats.map((s, i) => <Cell key={i} fill={s.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <p className="acct-help">Use the sidebar tabs for the detailed view of each section.</p>
            </div>
          )}

          {/* ═══════════ ORDERS BY CHANNEL ═══════════ */}
          {activeTab === "channels" && (
            <div>
              <h2 className="acct-section-title">Orders by Channel</h2>
              <div className="acct-stats-grid">
                <div className="acct-stat-card">
                  <span className="acct-stat-label">Total Orders</span>
                  <span className="acct-stat-value">{channelStats.totalOrders}</span>
                </div>
                <div className="acct-stat-card">
                  <span className="acct-stat-label">Total Revenue</span>
                  <span className="acct-stat-value">{"₹"}{formatIndianNumber(Math.round(channelStats.totalRevenue))}</span>
                </div>
                <div className="acct-stat-card">
                  <span className="acct-stat-label">Channels Active</span>
                  <span className="acct-stat-value">{channelStats.list.length}</span>
                </div>
              </div>

              <div className="acct-row">
                {channelStats.list.length > 0 && (
                  <div className="acct-card acct-card-flex-1">
                    <h3 className="acct-card-title">Revenue Share</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={channelStats.list}
                          cx="50%" cy="50%"
                          innerRadius={55} outerRadius={100}
                          dataKey="revenue"
                          label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                        >
                          {channelStats.list.map((c, i) => (
                            <Cell key={i} fill={CHANNEL_COLORS[c.name] || "#999"} />
                          ))}
                        </Pie>
                        <Tooltip content={<ChartTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}

                <div className="acct-card acct-card-flex-1">
                  <h3 className="acct-card-title">Order Count</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={channelStats.list} margin={{ top: 4, right: 20, left: 4, bottom: 30 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="orders" name="Orders" radius={[4, 4, 0, 0]} barSize={32}>
                        {channelStats.list.map((c, i) => <Cell key={i} fill={CHANNEL_COLORS[c.name] || "#999"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="acct-card">
                <h3 className="acct-card-title">Channel Breakdown</h3>
                <div className="acct-table-wrapper">
                  <table className="acct-table">
                    <thead>
                      <tr>
                        <th>Channel</th>
                        <th className="amount">Orders</th>
                        <th className="amount">Revenue</th>
                        <th className="amount">% of Total</th>
                        <th className="amount">Avg Order Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {channelStats.list.length === 0 ? (
                        <tr><td colSpan="5" className="acct-no-data">No orders in this period</td></tr>
                      ) : channelStats.list.map(c => (
                        <tr key={c.name}>
                          <td>
                            <span className="acct-channel-dot" style={{ background: CHANNEL_COLORS[c.name] || "#999" }} />
                            {c.name}
                          </td>
                          <td className="amount">{c.orders}</td>
                          <td className="amount">{"₹"}{formatIndianNumber(Math.round(c.revenue))}</td>
                          <td className="amount">
                            {channelStats.totalRevenue > 0
                              ? `${((c.revenue / channelStats.totalRevenue) * 100).toFixed(1)}%`
                              : "0%"}
                          </td>
                          <td className="amount">
                            {c.orders > 0
                              ? `₹${formatIndianNumber(Math.round(c.revenue / c.orders))}`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════ ORDER STATUS ═══════════ */}
          {activeTab === "status" && (
            <div>
              <h2 className="acct-section-title">Order Status</h2>
              <p className="acct-help" style={{ marginBottom: 16 }}>
                Click any status card to drill down — the table below filters to that status.
              </p>

              <div className="acct-status-grid">
                <button
                  className={`acct-status-card ${statusFilter === "all" ? "active" : ""}`}
                  style={{ "--bar": "#444" }}
                  onClick={() => setStatusFilter("all")}
                >
                  <span className="acct-status-card-label">All</span>
                  <span className="acct-status-card-value">{periodOrders.length}</span>
                </button>
                {statusStats.map(s => (
                  <button
                    key={s.key}
                    className={`acct-status-card ${statusFilter === s.key ? "active" : ""}`}
                    style={{ "--bar": s.color }}
                    onClick={() => setStatusFilter(statusFilter === s.key ? "all" : s.key)}
                  >
                    <span className="acct-status-card-label">{s.label}</span>
                    <span className="acct-status-card-value">{s.count}</span>
                  </button>
                ))}
              </div>

              <div className="acct-card">
                <h3 className="acct-card-title">Status Distribution</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={statusStats} layout="vertical" margin={{ top: 4, right: 30, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} />
                    <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={150} axisLine={false} tickLine={false} />
                    <Tooltip />
                    <Bar dataKey="count" name="Orders" radius={[0, 4, 4, 0]} barSize={18}>
                      {statusStats.map((s, i) => <Cell key={i} fill={s.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="acct-card">
                <div className="acct-card-toolbar">
                  <h3 className="acct-card-title">
                    Orders {statusFilter !== "all" && `— ${STATUS_FLOW.find(s => s.key === statusFilter)?.label}`}
                    <span className="acct-count">({filteredOrdersForTable.length})</span>
                  </h3>
                  <SearchByDropdown
                    fields={[
                      { value: "order_no", label: "Order Number" },
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
                </div>

                <div className="acct-table-wrapper">
                  <table className="acct-table">
                    <thead>
                      <tr>
                        <th>Order #</th>
                        <th>Date</th>
                        <th>Customer</th>
                        <th>Channel</th>
                        <th>Status</th>
                        <th className="amount">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentOrdersPage.length === 0 ? (
                        <tr><td colSpan="6" className="acct-no-data">No orders found</td></tr>
                      ) : currentOrdersPage.map(o => {
                        const s = STATUS_FLOW.find(x => x.key === getOrderStatus(o));
                        const ch = getOrderChannel(o);
                        return (
                          <tr key={o.id}>
                            <td><span className="acct-order-id">{o.order_no || "-"}</span></td>
                            <td>{formatDate(o.created_at)}</td>
                            <td>{o.delivery_name || "-"}</td>
                            <td>
                              <span className="acct-channel-dot" style={{ background: CHANNEL_COLORS[ch] || "#999" }} />
                              {ch}
                            </td>
                            <td>
                              <span className="acct-status-pill" style={{ background: (s?.color || "#999") + "22", color: s?.color || "#999" }}>
                                {s?.label || "—"}
                              </span>
                            </td>
                            <td className="amount">{"₹"}{formatIndianNumber(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {ordersTotalPages > 1 && (
                  <div className="acct-pagination">
                    <button onClick={() => setOrdersPage(p => Math.max(1, p - 1))} disabled={ordersPage === 1}>Prev</button>
                    <span>Page {ordersPage} of {ordersTotalPages}</span>
                    <button onClick={() => setOrdersPage(p => Math.min(ordersTotalPages, p + 1))} disabled={ordersPage === ordersTotalPages}>Next</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══════════ RETURNS & REFUNDS ═══════════ */}
          {activeTab === "returns" && (
            <div>
              <h2 className="acct-section-title">Returns & Refunds (All Channels)</h2>

              <div className="acct-stats-grid">
                <div className="acct-stat-card acct-stat-cancelled">
                  <span className="acct-stat-label">Cancellations</span>
                  <span className="acct-stat-value">{returnsRefunds.cancelled.count}</span>
                  <span className="acct-stat-sub">{"₹"}{formatIndianNumber(Math.round(returnsRefunds.cancelled.value))}</span>
                </div>
                <div className="acct-stat-card acct-stat-refund">
                  <span className="acct-stat-label">Refunds</span>
                  <span className="acct-stat-value">{returnsRefunds.refunded.count}</span>
                  <span className="acct-stat-sub">{"₹"}{formatIndianNumber(Math.round(returnsRefunds.refunded.value))}</span>
                </div>
                <div className="acct-stat-card acct-stat-return">
                  <span className="acct-stat-label">Returns</span>
                  <span className="acct-stat-value">{returnsRefunds.returned.count}</span>
                  <span className="acct-stat-sub">{"₹"}{formatIndianNumber(Math.round(returnsRefunds.returned.value))}</span>
                </div>
                <div className="acct-stat-card acct-stat-exchange">
                  <span className="acct-stat-label">Exchanges</span>
                  <span className="acct-stat-value">{returnsRefunds.exchanged.count}</span>
                  <span className="acct-stat-sub">{"₹"}{formatIndianNumber(Math.round(returnsRefunds.exchanged.value))}</span>
                </div>
                <div className="acct-stat-card acct-stat-revoked">
                  <span className="acct-stat-label">Revoked</span>
                  <span className="acct-stat-value">{returnsRefunds.revoked.count}</span>
                  <span className="acct-stat-sub">{"₹"}{formatIndianNumber(Math.round(returnsRefunds.revoked.value))}</span>
                </div>
              </div>

              <div className="acct-card">
                <h3 className="acct-card-title">Issues by Channel</h3>
                <div className="acct-table-wrapper">
                  <table className="acct-table">
                    <thead>
                      <tr>
                        <th>Channel</th>
                        <th className="amount">Orders Affected</th>
                        <th className="amount">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {returnsRefunds.channelBreakdown.length === 0 ? (
                        <tr><td colSpan="3" className="acct-no-data">No returns/refunds in this period</td></tr>
                      ) : returnsRefunds.channelBreakdown.map(c => (
                        <tr key={c.name}>
                          <td>
                            <span className="acct-channel-dot" style={{ background: CHANNEL_COLORS[c.name] || "#999" }} />
                            {c.name}
                          </td>
                          <td className="amount">{c.count}</td>
                          <td className="amount">{"₹"}{formatIndianNumber(Math.round(c.value))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {returnsRefunds.issues.length > 0 && (
                <div className="acct-card">
                  <h3 className="acct-card-title">Issue Orders <span className="acct-count">({returnsRefunds.issues.length})</span></h3>
                  <div className="acct-table-wrapper">
                    <table className="acct-table">
                      <thead>
                        <tr>
                          <th>Order #</th>
                          <th>Date</th>
                          <th>Customer</th>
                          <th>Channel</th>
                          <th>Type</th>
                          <th>Reason</th>
                          <th className="amount">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentIssuesPage.map(o => {
                          const ch = getOrderChannel(o);
                          let type = "—", color = "#999", reason = "—";
                          if (o.refund_reason || o.refund_status || o.status === "refund_requested") {
                            type = "Refund"; color = "#7b1fa2"; reason = o.refund_reason || "—";
                          } else if (o.return_reason) {
                            type = "Return"; color = "#ef6c00"; reason = o.return_reason;
                          } else if (o.exchange_reason) {
                            type = "Exchange"; color = "#1565c0"; reason = o.exchange_reason;
                          } else if (o.status?.toLowerCase() === "cancelled") {
                            type = "Cancelled"; color = "#c62828"; reason = o.cancellation_reason || "—";
                          } else if (o.revoked_at) {
                            type = "Revoked"; color = "#6d4c41"; reason = o.revoke_reason || "—";
                          }
                          return (
                            <tr key={o.id}>
                              <td><span className="acct-order-id">{o.order_no || "-"}</span></td>
                              <td>{formatDate(o.created_at)}</td>
                              <td>{o.delivery_name || "-"}</td>
                              <td>{ch}</td>
                              <td>
                                <span className="acct-status-pill" style={{ background: color + "22", color }}>
                                  {type}
                                </span>
                              </td>
                              <td className="acct-cell-trunc" title={reason}>{reason}</td>
                              <td className="amount">{"₹"}{formatIndianNumber(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {issuesTotalPages > 1 && (
                    <div className="acct-pagination">
                      <button onClick={() => setIssuePage(p => Math.max(1, p - 1))} disabled={issuePage === 1}>Prev</button>
                      <span>Page {issuePage} of {issuesTotalPages}</span>
                      <button onClick={() => setIssuePage(p => Math.min(issuesTotalPages, p + 1))} disabled={issuePage === issuesTotalPages}>Next</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
