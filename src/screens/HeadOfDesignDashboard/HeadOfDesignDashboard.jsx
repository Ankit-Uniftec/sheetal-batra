import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { fetchAllRows } from "../../utils/fetchAllRows";
import "./HeadOfDesignDashboard.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import SearchByDropdown from "../../components/SearchByDropdown";

// Head of Design Dashboard — read-only view for Tanuja Singh.
// Two focused tabs:
//   1. Order Status (transparency across all channels)
//   2. B2B Orders (full B2B transparency: vendor, merchandiser, PO, approval)

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

const APPROVAL_COLORS = {
  approved: "#2e7d32",
  pending:  "#ef6c00",
  rejected: "#c62828",
};

const ChartTooltip = ({ active, payload, label, prefix = "₹" }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="hod-chart-tooltip">
      <p className="hod-chart-tooltip-label">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: {prefix}{formatIndianNumber(Math.round(entry.value))}
        </p>
      ))}
    </div>
  );
};

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

export default function HeadOfDesignDashboard() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [currentUserName, setCurrentUserName] = useState("");

  // Tabs
  const [activeTab, setActiveTab] = useState("status");
  const [showSidebar, setShowSidebar] = useState(false);

  // Filter state
  const [timeline, setTimeline] = useState("monthly");
  const [customDateFrom, setCustomDateFrom] = useState("");
  const [customDateTo, setCustomDateTo] = useState("");
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);

  // Order Status drill-down
  const [statusFilter, setStatusFilter] = useState("all");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderSearchField, setOrderSearchField] = useState("order_no");
  const [ordersPage, setOrdersPage] = useState(1);

  // B2B tab filters
  const [b2bSearch, setB2bSearch] = useState("");
  const [b2bApprovalFilter, setB2bApprovalFilter] = useState("all"); // 'all'|'pending'|'approved'|'rejected'
  const [b2bVendorFilter, setB2bVendorFilter] = useState("");
  const [b2bPage, setB2bPage] = useState(1);

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

      if (!userRecord || userRecord.role !== "head_of_design") {
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
        return;
      }
      setCurrentUserName(userRecord.saleperson || "");

      const [ordersRes, vendorsRes] = await Promise.all([
        fetchAllRows("orders", (q) => q.select("*").order("created_at", { ascending: false })),
        supabase.from("vendors").select("id, store_brand_name, vendor_code, location"),
      ]);
      if (!ordersRes.error) setOrders(ordersRes.data || []);
      if (!vendorsRes.error) setVendors(vendorsRes.data || []);
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

  // Vendor lookup
  const vendorById = useMemo(() => {
    const map = {};
    vendors.forEach(v => { map[v.id] = v; });
    return map;
  }, [vendors]);

  // ─── Status stats (Tab 1) ────────────────────────────────────
  const statusStats = useMemo(() => {
    const counts = {};
    STATUS_FLOW.forEach(s => { counts[s.key] = 0; });
    periodOrders.forEach(o => {
      const k = getOrderStatus(o);
      if (counts[k] !== undefined) counts[k] += 1;
    });
    return STATUS_FLOW.map(s => ({ ...s, count: counts[s.key] }));
  }, [periodOrders]);

  const filteredOrdersForTable = useMemo(() => {
    let list = periodOrders;
    if (statusFilter !== "all") list = list.filter(o => getOrderStatus(o) === statusFilter);
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

  // ─── B2B (Tab 2) ─────────────────────────────────────────────
  const b2bAll = useMemo(
    () => periodOrders.filter(o => o.is_b2b || (o.salesperson_store || "").toLowerCase() === "b2b"),
    [periodOrders]
  );

  const b2bStats = useMemo(() => {
    const totalValue = b2bAll.reduce((s, o) => s + Number(o.grand_total || 0), 0);
    const pending  = b2bAll.filter(o => o.approval_status === "pending").length;
    const approved = b2bAll.filter(o => o.approval_status === "approved").length;
    const rejected = b2bAll.filter(o => o.approval_status === "rejected").length;
    const inProduction = b2bAll.filter(o => {
      const s = getOrderStatus(o);
      return s === "in_production" || s === "ready_for_dispatch";
    }).length;
    const delivered = b2bAll.filter(o => getOrderStatus(o) === "delivered").length;
    const dispatched = b2bAll.filter(o => getOrderStatus(o) === "dispatched").length;
    return { total: b2bAll.length, totalValue, pending, approved, rejected, inProduction, dispatched, delivered };
  }, [b2bAll]);

  // Vendor breakdown table
  const b2bByVendor = useMemo(() => {
    const map = {};
    b2bAll.forEach(o => {
      const vid = o.vendor_id || "_none";
      if (!map[vid]) {
        const v = vendorById[o.vendor_id];
        map[vid] = {
          vendor_id: o.vendor_id || null,
          name: v?.store_brand_name || (o.vendor_id ? "(unknown vendor)" : "(no vendor)"),
          code: v?.vendor_code || "—",
          location: v?.location || "—",
          orders: 0,
          value: 0,
          pending: 0,
        };
      }
      map[vid].orders += 1;
      map[vid].value += Number(o.grand_total || 0);
      if (o.approval_status === "pending") map[vid].pending += 1;
    });
    return Object.values(map).sort((a, b) => b.value - a.value);
  }, [b2bAll, vendorById]);

  // Status distribution for B2B only
  const b2bStatusStats = useMemo(() => {
    const counts = {};
    STATUS_FLOW.forEach(s => { counts[s.key] = 0; });
    b2bAll.forEach(o => {
      const k = getOrderStatus(o);
      if (counts[k] !== undefined) counts[k] += 1;
    });
    return STATUS_FLOW.map(s => ({ ...s, count: counts[s.key] })).filter(s => s.count > 0);
  }, [b2bAll]);

  // Filtered B2B list for the orders table
  const b2bFiltered = useMemo(() => {
    let list = b2bAll;
    if (b2bApprovalFilter !== "all") list = list.filter(o => o.approval_status === b2bApprovalFilter);
    if (b2bVendorFilter) list = list.filter(o => o.vendor_id === b2bVendorFilter);
    if (b2bSearch.trim()) {
      const q = b2bSearch.trim().toLowerCase();
      list = list.filter(o =>
        (o.order_no || "").toLowerCase().includes(q) ||
        (o.po_number || "").toLowerCase().includes(q) ||
        (o.merchandiser_name || "").toLowerCase().includes(q) ||
        (vendorById[o.vendor_id]?.store_brand_name || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [b2bAll, b2bApprovalFilter, b2bVendorFilter, b2bSearch, vendorById]);

  const b2bTotalPages = Math.max(1, Math.ceil(b2bFiltered.length / ITEMS_PER_PAGE));
  const currentB2bPage = useMemo(
    () => b2bFiltered.slice((b2bPage - 1) * ITEMS_PER_PAGE, b2bPage * ITEMS_PER_PAGE),
    [b2bFiltered, b2bPage]
  );
  useEffect(() => { setB2bPage(1); }, [b2bApprovalFilter, b2bVendorFilter, b2bSearch, timeline, customDateFrom, customDateTo]);

  if (loading) {
    return (
      <div className="hod-page">
        <div className="hod-loading">
          <div className="hod-spinner" />
          <p>Loading Head of Design Dashboard…</p>
        </div>
      </div>
    );
  }

  // ─── Reusable: Timeline filter bar ───
  const TimelineBar = (
    <div className="hod-filters-bar">
      <div className="hod-timeline-pills">
        {TIMELINE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            className={`hod-pill ${timeline === opt.value ? "active" : ""}`}
            onClick={() => { setTimeline(opt.value); setShowCustomDatePicker(opt.value === "custom"); }}
          >{opt.label}</button>
        ))}
      </div>
      {showCustomDatePicker && (
        <div className="hod-date-range">
          <input type="date" value={customDateFrom} onChange={(e) => setCustomDateFrom(e.target.value)} />
          <span>{"→"}</span>
          <input type="date" value={customDateTo} onChange={(e) => setCustomDateTo(e.target.value)} />
        </div>
      )}
    </div>
  );

  return (
    <div className="hod-page">
      {/* HEADER */}
      <header className="hod-header">
        <div className="hod-header-left">
          <button className="hod-hamburger" onClick={() => setShowSidebar(!showSidebar)}>
            <span /><span /><span />
          </button>
          <img src={Logo} alt="Logo" className="hod-logo" />
        </div>
        <h1 className="hod-title">Head of Design</h1>
        <div className="hod-header-right">
          {currentUserName && <span className="hod-user">{currentUserName}</span>}
          <button className="hod-logout-btn" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <div className="hod-layout">
        {/* SIDEBAR */}
        <aside className={`hod-sidebar ${showSidebar ? "open" : ""}`}>
          <nav className="hod-nav">
            <span className="hod-nav-section">Dashboard</span>
            {[
              { key: "status", label: "Order Status" },
              { key: "b2b",    label: "B2B Orders" },
            ].map(t => (
              <button
                key={t.key}
                className={`hod-nav-item ${activeTab === t.key ? "active" : ""}`}
                onClick={() => { setActiveTab(t.key); setShowSidebar(false); }}
              >{t.label}</button>
            ))}
          </nav>
        </aside>

        {/* MAIN */}
        <main className="hod-content">
          {TimelineBar}

          {/* ═══════════ ORDER STATUS ═══════════ */}
          {activeTab === "status" && (
            <div>
              <h2 className="hod-section-title">Order Status (All Channels)</h2>
              <p className="hod-help" style={{ marginBottom: 16 }}>
                Click a status card to drill down — the table below filters to that status.
              </p>

              <div className="hod-status-grid">
                <button
                  className={`hod-status-card ${statusFilter === "all" ? "active" : ""}`}
                  style={{ "--bar": "#444" }}
                  onClick={() => setStatusFilter("all")}
                >
                  <span className="hod-status-card-label">All</span>
                  <span className="hod-status-card-value">{periodOrders.length}</span>
                </button>
                {statusStats.map(s => (
                  <button
                    key={s.key}
                    className={`hod-status-card ${statusFilter === s.key ? "active" : ""}`}
                    style={{ "--bar": s.color }}
                    onClick={() => setStatusFilter(statusFilter === s.key ? "all" : s.key)}
                  >
                    <span className="hod-status-card-label">{s.label}</span>
                    <span className="hod-status-card-value">{s.count}</span>
                  </button>
                ))}
              </div>

              <div className="hod-card">
                <h3 className="hod-card-title">Status Distribution</h3>
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

              <div className="hod-card">
                <div className="hod-card-toolbar">
                  <h3 className="hod-card-title">
                    Orders {statusFilter !== "all" && `— ${STATUS_FLOW.find(s => s.key === statusFilter)?.label}`}
                    <span className="hod-count">({filteredOrdersForTable.length})</span>
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

                <div className="hod-table-wrapper">
                  <table className="hod-table">
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
                        <tr><td colSpan="6" className="hod-no-data">No orders found</td></tr>
                      ) : currentOrdersPage.map(o => {
                        const s = STATUS_FLOW.find(x => x.key === getOrderStatus(o));
                        const ch = getOrderChannel(o);
                        return (
                          <tr key={o.id}>
                            <td><span className="hod-order-id">{o.order_no || "-"}</span></td>
                            <td>{formatDate(o.created_at)}</td>
                            <td>{o.delivery_name || "-"}</td>
                            <td>
                              <span className="hod-channel-dot" style={{ background: CHANNEL_COLORS[ch] || "#999" }} />
                              {ch}
                            </td>
                            <td>
                              <span className="hod-status-pill" style={{ background: (s?.color || "#999") + "22", color: s?.color || "#999" }}>
                                {s?.label || "—"}
                              </span>
                            </td>
                            <td className="amount">{"₹"}{formatIndianNumber(o.grand_total || 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {ordersTotalPages > 1 && (
                  <div className="hod-pagination">
                    <button onClick={() => setOrdersPage(p => Math.max(1, p - 1))} disabled={ordersPage === 1}>Prev</button>
                    <span>Page {ordersPage} of {ordersTotalPages}</span>
                    <button onClick={() => setOrdersPage(p => Math.min(ordersTotalPages, p + 1))} disabled={ordersPage === ordersTotalPages}>Next</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══════════ B2B ORDERS ═══════════ */}
          {activeTab === "b2b" && (
            <div>
              <h2 className="hod-section-title">B2B Orders</h2>

              <div className="hod-stats-grid">
                <div className="hod-stat-card">
                  <span className="hod-stat-label">Total B2B Orders</span>
                  <span className="hod-stat-value">{b2bStats.total}</span>
                </div>
                <div className="hod-stat-card">
                  <span className="hod-stat-label">Total Value</span>
                  <span className="hod-stat-value">{"₹"}{formatIndianNumber(Math.round(b2bStats.totalValue))}</span>
                </div>
                <div className="hod-stat-card hod-stat-pending">
                  <span className="hod-stat-label">Pending Approval</span>
                  <span className="hod-stat-value">{b2bStats.pending}</span>
                </div>
                <div className="hod-stat-card hod-stat-approved">
                  <span className="hod-stat-label">Approved</span>
                  <span className="hod-stat-value">{b2bStats.approved}</span>
                </div>
                <div className="hod-stat-card">
                  <span className="hod-stat-label">In Production</span>
                  <span className="hod-stat-value">{b2bStats.inProduction}</span>
                </div>
                <div className="hod-stat-card">
                  <span className="hod-stat-label">Dispatched</span>
                  <span className="hod-stat-value">{b2bStats.dispatched}</span>
                </div>
                <div className="hod-stat-card">
                  <span className="hod-stat-label">Delivered</span>
                  <span className="hod-stat-value">{b2bStats.delivered}</span>
                </div>
              </div>

              <div className="hod-row">
                {b2bByVendor.length > 0 && (
                  <div className="hod-card hod-card-flex-1">
                    <h3 className="hod-card-title">Top Vendors by Value</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={b2bByVendor.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 30, left: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} axisLine={false} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} axisLine={false} tickLine={false}
                          tickFormatter={(v) => v.length > 18 ? v.substring(0, 18) + "…" : v} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="value" name="Value" fill="#7b1fa2" radius={[0, 4, 4, 0]} barSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {b2bStatusStats.length > 0 && (
                  <div className="hod-card hod-card-flex-1">
                    <h3 className="hod-card-title">B2B Status Distribution</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={b2bStatusStats} layout="vertical" margin={{ top: 4, right: 20, left: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} />
                        <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={140} axisLine={false} tickLine={false} />
                        <Tooltip />
                        <Bar dataKey="count" name="Orders" radius={[0, 4, 4, 0]} barSize={16}>
                          {b2bStatusStats.map((s, i) => <Cell key={i} fill={s.color} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="hod-card">
                <h3 className="hod-card-title">Vendor Breakdown</h3>
                <div className="hod-table-wrapper">
                  <table className="hod-table">
                    <thead>
                      <tr>
                        <th>Vendor</th>
                        <th>Code</th>
                        <th>Location</th>
                        <th className="amount">Orders</th>
                        <th className="amount">Pending</th>
                        <th className="amount">Total Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b2bByVendor.length === 0 ? (
                        <tr><td colSpan="6" className="hod-no-data">No B2B orders in this period</td></tr>
                      ) : b2bByVendor.map(v => (
                        <tr key={v.vendor_id || "_none"}>
                          <td style={{ fontWeight: 500 }}>{v.name}</td>
                          <td>{v.code}</td>
                          <td>{v.location}</td>
                          <td className="amount">{v.orders}</td>
                          <td className="amount" style={{ color: v.pending > 0 ? '#ef6c00' : 'inherit', fontWeight: v.pending > 0 ? 600 : 400 }}>
                            {v.pending || "—"}
                          </td>
                          <td className="amount">{"₹"}{formatIndianNumber(Math.round(v.value))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* B2B orders list with rich filters */}
              <div className="hod-card">
                <div className="hod-card-toolbar">
                  <h3 className="hod-card-title">
                    B2B Orders <span className="hod-count">({b2bFiltered.length})</span>
                  </h3>
                  <div className="hod-toolbar-inputs">
                    <select className="hod-select" value={b2bApprovalFilter} onChange={(e) => setB2bApprovalFilter(e.target.value)}>
                      <option value="all">All Approvals</option>
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                    <select className="hod-select" value={b2bVendorFilter} onChange={(e) => setB2bVendorFilter(e.target.value)}>
                      <option value="">All Vendors</option>
                      {vendors.map(v => (
                        <option key={v.id} value={v.id}>{v.store_brand_name}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      className="hod-search"
                      placeholder="Search order #, PO, vendor, merchandiser…"
                      value={b2bSearch}
                      onChange={(e) => setB2bSearch(e.target.value)}
                    />
                  </div>
                </div>

                <div className="hod-table-wrapper">
                  <table className="hod-table">
                    <thead>
                      <tr>
                        <th>Order #</th>
                        <th>PO #</th>
                        <th>Date</th>
                        <th>Vendor</th>
                        <th>Merchandiser</th>
                        <th>Approval</th>
                        <th>Status</th>
                        <th>Delivery</th>
                        <th className="amount">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentB2bPage.length === 0 ? (
                        <tr><td colSpan="9" className="hod-no-data">No B2B orders match these filters</td></tr>
                      ) : currentB2bPage.map(o => {
                        const v = vendorById[o.vendor_id];
                        const s = STATUS_FLOW.find(x => x.key === getOrderStatus(o));
                        const apc = APPROVAL_COLORS[o.approval_status] || "#999";
                        return (
                          <tr key={o.id}>
                            <td><span className="hod-order-id">{o.order_no || "-"}</span></td>
                            <td>{o.po_number || "—"}</td>
                            <td>{formatDate(o.created_at)}</td>
                            <td>{v?.store_brand_name || "—"}</td>
                            <td>{o.merchandiser_name || "—"}</td>
                            <td>
                              <span className="hod-status-pill" style={{ background: apc + "22", color: apc }}>
                                {o.approval_status || "—"}
                              </span>
                            </td>
                            <td>
                              <span className="hod-status-pill" style={{ background: (s?.color || "#999") + "22", color: s?.color || "#999" }}>
                                {s?.label || "—"}
                              </span>
                            </td>
                            <td>{o.delivery_date ? formatDate(o.delivery_date) : "—"}</td>
                            <td className="amount">{"₹"}{formatIndianNumber(o.grand_total || 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {b2bTotalPages > 1 && (
                  <div className="hod-pagination">
                    <button onClick={() => setB2bPage(p => Math.max(1, p - 1))} disabled={b2bPage === 1}>Prev</button>
                    <span>Page {b2bPage} of {b2bTotalPages}</span>
                    <button onClick={() => setB2bPage(p => Math.min(b2bTotalPages, p + 1))} disabled={b2bPage === b2bTotalPages}>Next</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
