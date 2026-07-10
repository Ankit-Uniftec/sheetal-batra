import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./B2bProductionDashboard.css";
import Logo from "../../images/logo.png";
import formatDate from "../../utils/formatDate";
import { downloadWarehousePdf } from "../../utils/pdfUtils";
import NotificationBell from "../../components/NotificationBell";
import ProductionHeadVendors from "../../components/ProductionHeadVendors";
import "../../components/ProductionHeadVendors.css";
import ComponentStageBadge from "../../components/ComponentStageBadge";
import ComponentJourneyModal from "../../components/ComponentJourneyModal";
import StageCountCards from "../../components/StageCountCards";
import ProductionOverview from "../../components/ProductionOverview";
import { getStageLabel, getStageGroupKey, enrichComponentsWithMovements, classifyComponentForStageCard, STAGE_GROUPS } from "../../utils/barcodeService";

export default function B2bProductionDashboard() {
    const navigate = useNavigate();

    const [activeTab, setActiveTab] = useState("dashboard");
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [orders, setOrders] = useState([]);
    const [components, setComponents] = useState([]); // order_components for the journey row
    // Order whose full component journey is open (shared ComponentJourneyModal).
    const [journeyOrder, setJourneyOrder] = useState(null); // { order_no, components }
    const openJourney = (order, comps) => setJourneyOrder({ order_no: order.order_no, components: comps || [] });
    const [vendorMap, setVendorMap] = useState({});
    const [loading, setLoading] = useState(true);
    const [showSidebar, setShowSidebar] = useState(false);
    const [pdfLoading, setPdfLoading] = useState(null);

    // Temporary Manual Completion confirm modal
    const [manualCompleteOrder, setManualCompleteOrder] = useState(null);
    const [manualCompleteProcessing, setManualCompleteProcessing] = useState(false);

    // Calendar
    const [calendarDate, setCalendarDate] = useState(() => new Date());
    const [selectedCalendarDate, setSelectedCalendarDate] = useState(null);

    // All Orders tab
    const [orderSearch, setOrderSearch] = useState("");
    const [prodFilter, setProdFilter] = useState("all");
    const [currentPage, setCurrentPage] = useState(1);
    const ORDERS_PER_PAGE = 20;

    // Queue tab
    const [queueSearch, setQueueSearch] = useState("");
    const [queueType, setQueueType] = useState("all");
    const [queuePage, setQueuePage] = useState(1);

    // In Production tab
    const [inprodSearch, setInprodSearch] = useState("");
    const [inprodType, setInprodType] = useState("all");
    const [inprodPage, setInprodPage] = useState(1);

    // Dispatch tab
    const [dispatchSearch, setDispatchSearch] = useState("");
    const [dispatchType, setDispatchType] = useState("all");
    const [dispatchSection, setDispatchSection] = useState("ready");
    const [dispatchPage, setDispatchPage] = useState(1);

    // All Orders type filter
    const [allTypeFilter, setAllTypeFilter] = useState("all");
    const [merchandiserFilter, setMerchandiserFilter] = useState("all");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    // Stage-card drill-through: filter the All Orders list to a stage (and kind).
    const [stageFilter, setStageFilter] = useState(null);      // stage group key or null
    const [stageKindFilter, setStageKindFilter] = useState("both"); // 'both' | 'internal' | 'external'

    // Overview date-period filter for the stage cards (by piece scan time, not
    // order placement date — same pattern as PM / Offline PH dashboards).
    const [overviewPeriod, setOverviewPeriod] = useState("all"); // all | day | month | year | custom
    const [overviewFrom, setOverviewFrom] = useState("");
    const [overviewTo, setOverviewTo] = useState("");

    // ==================== FETCH DATA ====================
    const loadAllData = useCallback(async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                navigate("/login", { replace: true });
                return;
            }

            // ✅ Role check - only production users allowed
            const { data: roleCheck } = await supabase
                .from("salesperson")
                .select("role")
                .eq("email", user.email?.toLowerCase())
                .single();

            if (!roleCheck || roleCheck.role !== "production") {
                await supabase.auth.signOut();
                navigate("/login", { replace: true });
                return;
            }

            setUser(user);

            const [profileResult, ordersResult] = await Promise.all([
                supabase.from("salesperson").select("*").eq("email", user.email?.toLowerCase()).maybeSingle(),
                supabase.from("orders").select("*").eq("is_b2b", true).order("created_at", { ascending: false })
            ]);

            if (profileResult.data) setProfile(profileResult.data);
            if (ordersResult.data) {
                // Production head only sees approved orders
                const approvedOrders = ordersResult.data.filter(o => o.approval_status === "approved");
                setOrders(approvedOrders);
                const vendorIds = [...new Set(approvedOrders.map(o => o.vendor_id).filter(Boolean))];
                if (vendorIds.length > 0) {
                    const { data: vData } = await supabase
                        .from("vendors")
                        .select("id, store_brand_name, vendor_code, location")
                        .in("id", vendorIds);
                    const vMap = {};
                    (vData || []).forEach(v => { vMap[v.id] = v; });
                    setVendorMap(vMap);
                }

                // Per-piece components for the order-card journey row. Fetch ALL
                // B2B components, paged past the 1000-row cap, and group by
                // order_id client-side (componentsByOrder). We deliberately do
                // NOT use .in(order_id, [...all ids]) — on a busy live DB that
                // list is huge and the request silently fails/truncates (which
                // is why the journey showed on UAT but not on live). Mirrors the
                // working Production Manager dashboard fetch.
                {
                    const PAGE = 1000;
                    let all = [];
                    let from = 0;
                    // eslint-disable-next-line no-constant-condition
                    while (true) {
                        const { data: cData, error: cErr } = await supabase
                            .from("order_components")
                            .select("id, order_id, barcode, component_type, component_label, current_stage, item_index, is_outside_wh, vendor_name, vendor_location, vendor_exit_at, stage_updated_at")
                            .order("created_at", { ascending: false })
                            .range(from, from + PAGE - 1);
                        if (cErr) { console.warn("order_components fetch failed:", cErr.message); break; }
                        if (!cData || cData.length === 0) break;
                        all = [...all, ...cData];
                        if (cData.length < PAGE) break;
                        from += PAGE;
                    }
                    // Keep ONLY components of THIS dashboard's B2B (approved)
                    // orders. The query above pages the whole order_components
                    // table (no server-side order filter — a big .in() list
                    // truncates on live), so we scope it here. Without this the
                    // "Orders by Production Stage" cards would count every piece
                    // in the system, not just B2B.
                    const b2bOrderIds = new Set(approvedOrders.map(o => o.id));
                    all = all.filter(c => b2bOrderIds.has(c.order_id));
                    // Attach stages_outside for pieces out at a vendor so the badge
                    // reads "Out to Vendor (Embroidery)" (shared helper — one impl).
                    all = await enrichComponentsWithMovements(all);
                    setComponents(all);
                }
            }
            setLoading(false);
        } catch (err) {
            console.error("Load error:", err);
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadAllData(); }, [loadAllData]);

    // ==================== PRODUCTION STAGE HELPERS ====================
    // The dashboard segments orders by their REAL barcode production stage
    // (order.warehouse_stage, maintained by the DB trigger from component
    // stages) — NOT a manual status. Bucket an order into one of:
    //   queue         — not started yet (no stage / order_received)
    //   in_production — a component is somewhere in the flow (cloth issue..final QC)
    //   ready         — reached packaging, not yet dispatched
    //   dispatched    — fully dispatched, OR the order is completed/delivered
    //                   (covers Temporary Manual Completion + PM-delivered).
    const getStageBucket = (order) => {
        const st = (order.status || "").toLowerCase();
        if (st === "completed" || st === "delivered" || st === "dispatched") return "dispatched";
        const ws = order.warehouse_stage;
        if (ws === "dispatched") return "dispatched";
        if (ws === "packaging_dispatch") return "ready";
        const group = getStageGroupKey(ws); // null for order_received/none/legacy
        return group ? "in_production" : "queue";
    };

    // Per-order component lookup for the card journey row (O(1) per card),
    // sorted by item then a stable TOP -> BTM -> DUP -> EXTRA order.
    const componentsByOrder = useMemo(() => {
        const TYPE_ORDER = { top: 0, bottom: 1, dupatta: 2, extra: 3 };
        const map = {};
        components.forEach((c) => { (map[c.order_id] || (map[c.order_id] = [])).push(c); });
        Object.values(map).forEach((arr) => arr.sort((a, b) =>
            (a.item_index ?? 0) - (b.item_index ?? 0) ||
            (TYPE_ORDER[a.component_type] ?? 9) - (TYPE_ORDER[b.component_type] ?? 9)
        ));
        return map;
    }, [components]);

    // order_id -> status, so bypass-completed orders' pieces land under
    // Packaging & Dispatch on the stage cards, not their stalled stage.
    const orderStatusById = useMemo(() => {
        const m = {};
        orders.forEach((o) => { m[o.id] = o.status; });
        return m;
    }, [orders]);

    // Components whose stage activity (stage_updated_at) falls in the selected
    // Overview period — powers the stage cards. Filtered by the PIECE's own
    // scan time, not its order's created_at, so a scan today on an old order
    // shows up under "Today".
    const componentsInPeriod = useMemo(() => {
        if (overviewPeriod === "all") return components;
        const now = new Date();
        let from = null, to = null;
        if (overviewPeriod === "day") from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        else if (overviewPeriod === "month") from = new Date(now.getFullYear(), now.getMonth(), 1);
        else if (overviewPeriod === "year") from = new Date(now.getFullYear(), 0, 1);
        else if (overviewPeriod === "custom") {
            from = overviewFrom ? new Date(overviewFrom) : null;
            to = overviewTo ? new Date(new Date(overviewTo).setHours(23, 59, 59, 999)) : null;
        }
        return components.filter((c) => {
            const ts = c.stage_updated_at || c.created_at;
            if (!ts) return false;
            const dt = new Date(ts);
            if (from && dt < from) return false;
            if (to && dt > to) return false;
            return true;
        });
    }, [components, overviewPeriod, overviewFrom, overviewTo]);

    // order_id -> { stageKey: Set('internal'|'external') }, using the SAME
    // classifier the cards use, so clicking a card / sub-count drills the order
    // list to exactly the pieces the card counted.
    const orderStageGroups = useMemo(() => {
        const map = {};
        componentsInPeriod.forEach((c) => {
            const info = classifyComponentForStageCard(c, orderStatusById[c.order_id]);
            if (!info || !info.key) return;
            const byStage = map[c.order_id] || (map[c.order_id] = {});
            (byStage[info.key] || (byStage[info.key] = new Set())).add(info.kind);
        });
        return map;
    }, [componentsInPeriod, orderStatusById]);

    // Clicking a stage card / sub-count: filter the All Orders list to that
    // stage (kind narrows to in-house / vendor) and jump to the orders tab.
    const handleStageCardClick = (stageKey, kind = "both") => {
        setStageFilter(stageKey);
        setStageKindFilter(kind);
        setProdFilter("all");
        setCurrentPage(1);
        setActiveTab("orders");
    };
    const pendingProduction = useMemo(() => orders.filter(o => getStageBucket(o) === "queue"), [orders]); // eslint-disable-line react-hooks/exhaustive-deps
    const inProduction = useMemo(() => orders.filter(o => getStageBucket(o) === "in_production"), [orders]); // eslint-disable-line react-hooks/exhaustive-deps
    const readyForDispatch = useMemo(() => orders.filter(o => getStageBucket(o) === "ready"), [orders]); // eslint-disable-line react-hooks/exhaustive-deps
    const dispatched = useMemo(() => orders.filter(o => getStageBucket(o) === "dispatched"), [orders]); // eslint-disable-line react-hooks/exhaustive-deps

    const stats = useMemo(() => {
        const salesOrders = orders.filter(o => o.b2b_order_type !== "Consignment");
        const consignmentOrders = orders.filter(o => o.b2b_order_type === "Consignment");
        return {
            total: orders.length,
            salesCount: salesOrders.length,
            // Counts now come from the real-stage buckets (below).
            pending: pendingProduction.length,   // not started
            inProd: inProduction.length,         // somewhere in the flow
            ready: readyForDispatch.length,      // at packaging
            dispatched: dispatched.length,       // dispatched / completed / delivered
            consignmentCount: consignmentOrders.length,
        };
    }, [orders, pendingProduction, inProduction, readyForDispatch, dispatched]);

    // Calendar orders by delivery date
    const ordersByDate = useMemo(() => {
        return orders.reduce((acc, order) => {
            const date = order.delivery_date ? formatDate(order.delivery_date) : null;
            if (date) acc[date] = (acc[date] || 0) + 1;
            return acc;
        }, {});
    }, [orders]);

    const uniqueMerchandisers = useMemo(() => {
        const names = [...new Set(orders.map(o => o.merchandiser_name).filter(Boolean))];
        return names.sort();
    }, [orders]);

    // ==================== FILTERED ORDERS ====================
    const filteredOrders = useMemo(() => {
        let filtered = [...orders];
        if (prodFilter !== "all") filtered = filtered.filter(o => getStageBucket(o) === prodFilter);
        if (allTypeFilter !== "all") filtered = filtered.filter(o => o.b2b_order_type === allTypeFilter);
        if (merchandiserFilter !== "all") filtered = filtered.filter(o => o.merchandiser_name === merchandiserFilter);
        if (dateFrom) filtered = filtered.filter(o => o.created_at >= new Date(dateFrom).toISOString());
        if (dateTo) {
            const endDate = new Date(dateTo);
            endDate.setHours(23, 59, 59, 999);
            filtered = filtered.filter(o => o.created_at <= endDate.toISOString());
        }
        if (orderSearch.trim()) {
            const q = orderSearch.toLowerCase();
            filtered = filtered.filter(o =>
                o.order_no?.toLowerCase().includes(q) || o.po_number?.toLowerCase().includes(q) ||
                vendorMap[o.vendor_id]?.store_brand_name?.toLowerCase().includes(q)
            );
        }
        // Stage-card drill-through: any-piece-at-stage, narrowed by kind.
        if (stageFilter) {
            filtered = filtered.filter(o => {
                const kinds = orderStageGroups[o.id]?.[stageFilter];
                if (!kinds) return false;
                if (stageKindFilter === "internal") return kinds.has("internal");
                if (stageKindFilter === "external") return kinds.has("external");
                return true;
            });
        }
        return filtered;
    }, [orders, prodFilter, allTypeFilter, merchandiserFilter, dateFrom, dateTo, orderSearch, vendorMap, stageFilter, stageKindFilter, orderStageGroups]);

    const paginatedOrders = useMemo(() => {
        const start = (currentPage - 1) * ORDERS_PER_PAGE;
        return filteredOrders.slice(start, start + ORDERS_PER_PAGE);
    }, [filteredOrders, currentPage]);

    // Helper to filter by search + type
    const applyFilters = (list, search, type) => {
        let result = [...list];
        if (type !== "all") result = result.filter(o => o.b2b_order_type === type);
        if (search.trim()) {
            const q = search.toLowerCase();
            result = result.filter(o =>
                o.order_no?.toLowerCase().includes(q) || o.po_number?.toLowerCase().includes(q) ||
                vendorMap[o.vendor_id]?.store_brand_name?.toLowerCase().includes(q)
            );
        }
        return result;
    };

    // Queue filtered + paginated
    const filteredQueue = useMemo(() => applyFilters(pendingProduction, queueSearch, queueType), [pendingProduction, queueSearch, queueType, vendorMap]);
    const paginatedQueue = useMemo(() => filteredQueue.slice((queuePage - 1) * ORDERS_PER_PAGE, queuePage * ORDERS_PER_PAGE), [filteredQueue, queuePage]);

    // In Production filtered + paginated
    const filteredInprod = useMemo(() => applyFilters(inProduction, inprodSearch, inprodType), [inProduction, inprodSearch, inprodType, vendorMap]);
    const paginatedInprod = useMemo(() => filteredInprod.slice((inprodPage - 1) * ORDERS_PER_PAGE, inprodPage * ORDERS_PER_PAGE), [filteredInprod, inprodPage]);

    // Dispatch filtered + paginated
    const filteredReady = useMemo(() => applyFilters(readyForDispatch, dispatchSearch, dispatchType), [readyForDispatch, dispatchSearch, dispatchType, vendorMap]);
    const filteredDispatched = useMemo(() => applyFilters(dispatched, dispatchSearch, dispatchType), [dispatched, dispatchSearch, dispatchType, vendorMap]);
    const dispatchList = useMemo(() => dispatchSection === "ready" ? filteredReady : filteredDispatched, [dispatchSection, filteredReady, filteredDispatched]);
    const paginatedDispatch = useMemo(() => dispatchList.slice((dispatchPage - 1) * ORDERS_PER_PAGE, dispatchPage * ORDERS_PER_PAGE), [dispatchList, dispatchPage]);

    // ==================== STATUS UPDATE ====================
    // Temporary Manual Completion — force the order completed WITHOUT the normal
    // production flow (bypass). Opens a styled confirm modal (below); the actual
    // update runs in confirmManualComplete.
    const markManualComplete = (order) => setManualCompleteOrder(order);

    const confirmManualComplete = async () => {
        if (!manualCompleteOrder) return;
        setManualCompleteProcessing(true);
        try {
            // Force-complete: dispatch every active component (badge -> Dispatched,
            // pieces non-scannable) + mark the order completed, via one RPC.
            const { data, error } = await supabase.rpc("manual_complete_order", {
                p_order_id: manualCompleteOrder.id, p_by: user?.email,
            });
            if (error || data?.success === false) throw new Error(error?.message || data?.message);
            setOrders(prev => prev.map(o => o.id === manualCompleteOrder.id ? { ...o, status: "completed", warehouse_stage: "dispatched" } : o));
            setManualCompleteOrder(null);
            // Re-fetch components so the piece badges reflect "Dispatched" live.
            loadAllData();
        } catch (err) {
            console.error("Manual complete error:", err);
        } finally {
            setManualCompleteProcessing(false);
        }
    };


    // ==================== HELPERS ====================
    const handleLogout = async () => { await supabase.auth.signOut(); navigate("/login"); };
    const handleViewOrder = (orderId) => navigate(`/b2b-order-view/${orderId}`);

    const handleDownloadWarehousePdf = async (e, order) => {
        e.stopPropagation();
        setPdfLoading(order.id);
        try {
            await downloadWarehousePdf(order, null, true);
        } catch (err) {
            console.error("Warehouse PDF failed:", err);
        } finally {
            setPdfLoading(null);
        }
    };

    // Status badge label from the real bucket. For an in-production order, show
    // the actual current stage (e.g. "Embroidery") so the badge matches the
    // per-piece journey chips instead of a generic word.
    const getStageStatusLabel = (order) => {
        const bucket = getStageBucket(order);
        if (bucket === "queue") return "Not Started";
        if (bucket === "ready") return "Ready for Dispatch";
        if (bucket === "dispatched") {
            const st = (order.status || "").toLowerCase();
            return st === "completed" ? "Completed" : st === "delivered" ? "Delivered" : "Dispatched";
        }
        // in_production → name the actual stage
        return getStageLabel(order.warehouse_stage) || "In Production";
    };

    const getStageStatusClass = (order) => {
        switch (getStageBucket(order)) {
            case "in_production": return "prod-status-inprod";
            case "ready": return "prod-status-ready";
            case "dispatched": return "prod-status-dispatched";
            default: return "prod-status-pending";
        }
    };

    if (loading) return <p className="loading-text">Loading Dashboard...</p>;

    const MIN_CALENDAR_DATE = new Date(2025, 11, 1);

    return (
        <div className="prod-dashboard-wrapper">
            {/* ===== HEADER ===== */}
            <header className="prod-header">
                <img src={Logo} alt="logo" className="prod-header-logo" onClick={() => setActiveTab("dashboard")} />
                <h1 className="prod-header-title">B2B Production</h1>
                <div className="prod-header-right">
                    <NotificationBell
                        userEmail={user?.email}
                        onOrderClick={(orderId) => handleViewOrder(orderId)}
                    />
                    <div className="prod-hamburger-icon" onClick={() => setShowSidebar(!showSidebar)}>
                        <div className="prod-bar"></div><div className="prod-bar"></div><div className="prod-bar"></div>
                    </div>
                </div>
            </header>

            {/* ===== GRID LAYOUT ===== */}
            <div className={`prod-grid-table ${showSidebar ? "prod-sidebar-open" : ""}`}>

                {/* ===== SIDEBAR ===== */}
                <aside className={`prod-sidebar ${showSidebar ? "prod-open" : ""}`}>
                    <nav className="prod-menu">
                        <a className={`prod-menu-item ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => { setActiveTab("dashboard"); setShowSidebar(false); }}>Overview</a>
                        {/* Production Queue / In Production / Dispatch tabs hidden —
                            everything they showed is available in Order History (with
                            stage badges + status filter). The tab BLOCKS remain in
                            the code, just not linked, so they're easy to restore. */}
                        <a className={`prod-menu-item ${activeTab === "orders" ? "active" : ""}`} onClick={() => { setActiveTab("orders"); setShowSidebar(false); }}>Order History</a>
                        <a className={`prod-menu-item ${activeTab === "calendar" ? "active" : ""}`} onClick={() => { setActiveTab("calendar"); setShowSidebar(false); }}>Calendar</a>
                        <a className={`prod-menu-item ${activeTab === "vendors" ? "active" : ""}`} onClick={() => { setActiveTab("vendors"); setShowSidebar(false); }}>Vendor / External</a>
                        <a className="prod-menu-item prod-menu-item-logout" onClick={handleLogout}>Log Out</a>
                    </nav>
                </aside>

                {/* ===== DASHBOARD TAB ===== */}
                {activeTab === "dashboard" && (
                    <>
                        {/* Orders by Production Stage — piece counts, split internal vs
                            out-at-vendor. Shown on top. B2B PH sees B2B orders only,
                            so this is already channel-scoped by the data load. Date
                            pills filter by piece scan time (stage_updated_at), not
                            order placement date. */}
                        <div className="prod-cell prod-stage-cards">
                            <div className="prod-orders-card">
                                <div className="prod-card-header">
                                    <span className="prod-card-title">Orders by Production Stage</span>
                                </div>
                                <div className="prod-overview-period">
                                    {[
                                        { key: "all", label: "All Time" },
                                        { key: "day", label: "Today" },
                                        { key: "month", label: "This Month" },
                                        { key: "year", label: "This Year" },
                                        { key: "custom", label: "Custom" },
                                    ].map((p) => (
                                        <button
                                            key={p.key}
                                            className={`prod-period-pill ${overviewPeriod === p.key ? "active" : ""}`}
                                            onClick={() => setOverviewPeriod(p.key)}
                                        >{p.label}</button>
                                    ))}
                                    {overviewPeriod === "custom" && (
                                        <span className="prod-period-custom">
                                            <input type="date" value={overviewFrom} onChange={(e) => setOverviewFrom(e.target.value)} />
                                            <span>→</span>
                                            <input type="date" value={overviewTo} min={overviewFrom || undefined} onChange={(e) => setOverviewTo(e.target.value)} />
                                        </span>
                                    )}
                                </div>
                                <StageCountCards components={componentsInPeriod} orderStatusById={orderStatusById} onStageClick={handleStageCardClick} />
                            </div>
                        </div>

                        <div className="prod-cell prod-stat-1">
                            <StatCard title="Alerts" value={stats.pending} change={`Sales Orders: ${stats.salesCount}`} highlight={stats.pending > 0} />
                        </div>
                        <div className="prod-cell prod-stat-2">
                            <StatCard title="In Production" value={stats.inProd} change={`Ready: ${stats.ready}`} />
                        </div>
                        <div className="prod-cell prod-stat-3">
                            <StatCard title="Dispatched" value={stats.dispatched} change={`Consignment: ${stats.consignmentCount}`} />
                        </div>

                        {/* Alerts */}
                        <aside className="prod-cell prod-pending-box">
                            <div className="prod-pending-header">
                                <span className="prod-pending-title">Alerts</span>
                                <button className="prod-view-btn" onClick={() => setActiveTab("orders")}>View All</button>
                            </div>
                            <div className="prod-pending-body">
                                {pendingProduction.length === 0 ? (
                                    <p className="prod-muted">{"\u2728"} No pending orders!</p>
                                ) : (
                                    pendingProduction.slice(0, 8).map(order => (
                                        <div key={order.id} className="prod-pending-item">
                                            <div className="prod-pending-top">
                                                <b className="prod-gold-text">{order.order_no}</b>
                                                <span className={`prod-type-tag ${order.b2b_order_type === "Buyout" ? "prod-tag-buyout" : "prod-tag-consignment"}`}>{order.b2b_order_type || "\u2014"}</span>
                                            </div>
                                            <p style={{ fontSize: 12, color: "#777", margin: "2px 0" }}>{vendorMap[order.vendor_id]?.store_brand_name || "\u2014"}</p>
                                            <div className="prod-pending-btns">
                                                <button className="prod-detail-sm" onClick={() => handleViewOrder(order.id)}>View</button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </aside>

                        {/* Recent Orders */}
                        <div className="prod-cell prod-recent-orders">
                            <div className="prod-orders-card">
                                <div className="prod-card-header">
                                    <span className="prod-card-title">Recent Orders ({orders.slice(0, 10).length})</span>
                                    <button className="prod-view-btn" onClick={() => setActiveTab("orders")}>View All</button>
                                </div>
                                <div className="prod-cardbox">
                                    {orders.length === 0 ? (<p className="prod-muted">No approved orders yet</p>) : (
                                        orders.slice(0, 10).map(o => {
                                            return (
                                                <div className="prod-order-item" key={o.id} onClick={() => handleViewOrder(o.id)} style={{ cursor: "pointer" }}>
                                                    <p><b>Order No:</b> {o.order_no} &nbsp;|&nbsp; <b>PO:</b> {o.po_number || "\u2014"}</p>
                                                    <p><b>Vendor:</b> {vendorMap[o.vendor_id]?.store_brand_name || "\u2014"} &nbsp;|&nbsp; <b>Type:</b> {o.b2b_order_type || "\u2014"}</p>
                                                    <p><b>Order Date:</b> {formatDate(o.created_at) || "\u2014"} &nbsp;|&nbsp; <b>Delivery:</b> {formatDate(o.delivery_date) || "\u2014"}</p>
                                                    <p><b>Status:</b> <span className={getStageStatusClass(o)}>{getStageStatusLabel(o)}</span></p>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Production Overview — operational metrics for THIS
                            dashboard's B2B orders (single channel, no channel split). */}
                        <div className="prod-cell prod-overview-cell">
                            <ProductionOverview orders={orders} totalLabel="Total B2B Orders" />
                        </div>
                    </>
                )}

                {/* ===== PRODUCTION QUEUE TAB ===== */}
                {activeTab === "queue" && (
                    <div className="prod-tab-wrapper">
                        <h2 className="prod-tab-title">Production Queue ({pendingProduction.length})</h2>
                        <div className="prod-filters-row">
                            <input type="text" placeholder="Search order #, PO, vendor..." value={queueSearch} onChange={(e) => { setQueueSearch(e.target.value); setQueuePage(1); }} className="prod-search-input" />
                            <select value={queueType} onChange={(e) => { setQueueType(e.target.value); setQueuePage(1); }} className="prod-filter-select">
                                <option value="all">All Types</option>
                                <option value="Buyout">Buyout</option>
                                <option value="Consignment">Consignment</option>
                            </select>
                        </div>
                        {filteredQueue.length === 0 ? (
                            <p className="prod-muted" style={{ padding: 40, textAlign: "center" }}>{"\u2728"} No orders pending production!</p>
                        ) : (
                            <div className="prod-list-scroll">
                                {paginatedQueue.map(order => <OrderCard key={order.id} order={order} vendorMap={vendorMap} components={componentsByOrder[order.id] || []} onJourney={openJourney} onManualComplete={markManualComplete} onView={handleViewOrder} getStageStatusClass={getStageStatusClass} getStageStatusLabel={getStageStatusLabel} onWarehousePdf={handleDownloadWarehousePdf} pdfLoading={pdfLoading} />)}
                                {filteredQueue.length > ORDERS_PER_PAGE && (
                                    <div className="prod-pagination">
                                        <button disabled={queuePage === 1} onClick={() => setQueuePage(p => p - 1)} className="prod-pagination-btn">{"\u2190"} Previous</button>
                                        <span className="prod-pagination-info">Page {queuePage} of {Math.ceil(filteredQueue.length / ORDERS_PER_PAGE)}</span>
                                        <button disabled={queuePage >= Math.ceil(filteredQueue.length / ORDERS_PER_PAGE)} onClick={() => setQueuePage(p => p + 1)} className="prod-pagination-btn">Next {"\u2192"}</button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ===== IN PRODUCTION TAB ===== */}
                {activeTab === "inprod" && (
                    <div className="prod-tab-wrapper">
                        <h2 className="prod-tab-title">In Production ({inProduction.length})</h2>
                        <div className="prod-filters-row">
                            <input type="text" placeholder="Search order #, PO, vendor..." value={inprodSearch} onChange={(e) => { setInprodSearch(e.target.value); setInprodPage(1); }} className="prod-search-input" />
                            <select value={inprodType} onChange={(e) => { setInprodType(e.target.value); setInprodPage(1); }} className="prod-filter-select">
                                <option value="all">All Types</option>
                                <option value="Buyout">Buyout</option>
                                <option value="Consignment">Consignment</option>
                            </select>
                        </div>
                        {filteredInprod.length === 0 ? (
                            <p className="prod-muted" style={{ padding: 40, textAlign: "center" }}>No orders in production</p>
                        ) : (
                            <div className="prod-list-scroll">
                                {paginatedInprod.map(order => <OrderCard key={order.id} order={order} vendorMap={vendorMap} components={componentsByOrder[order.id] || []} onJourney={openJourney} onManualComplete={markManualComplete} onView={handleViewOrder} getStageStatusClass={getStageStatusClass} getStageStatusLabel={getStageStatusLabel} onWarehousePdf={handleDownloadWarehousePdf} pdfLoading={pdfLoading} />)}
                                {filteredInprod.length > ORDERS_PER_PAGE && (
                                    <div className="prod-pagination">
                                        <button disabled={inprodPage === 1} onClick={() => setInprodPage(p => p - 1)} className="prod-pagination-btn">{"\u2190"} Previous</button>
                                        <span className="prod-pagination-info">Page {inprodPage} of {Math.ceil(filteredInprod.length / ORDERS_PER_PAGE)}</span>
                                        <button disabled={inprodPage >= Math.ceil(filteredInprod.length / ORDERS_PER_PAGE)} onClick={() => setInprodPage(p => p + 1)} className="prod-pagination-btn">Next {"\u2192"}</button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ===== DISPATCH TAB ===== */}
                {activeTab === "dispatch" && (
                    <div className="prod-tab-wrapper">
                        <h2 className="prod-tab-title">Dispatch</h2>
                        <div className="prod-dispatch-stats">
                            <div className="prod-dstat"><span className="prod-dstat-val">{stats.ready}</span><span className="prod-dstat-label">Ready for Dispatch</span></div>
                            <div className="prod-dstat"><span className="prod-dstat-val">{stats.dispatched}</span><span className="prod-dstat-label">Dispatched</span></div>
                        </div>
                        <div className="prod-filters-row">
                            <input type="text" placeholder="Search order #, PO, vendor..." value={dispatchSearch} onChange={(e) => { setDispatchSearch(e.target.value); setDispatchPage(1); }} className="prod-search-input" />
                            <select value={dispatchType} onChange={(e) => { setDispatchType(e.target.value); setDispatchPage(1); }} className="prod-filter-select">
                                <option value="all">All Types</option>
                                <option value="Buyout">Buyout</option>
                                <option value="Consignment">Consignment</option>
                            </select>
                            <select value={dispatchSection} onChange={(e) => { setDispatchSection(e.target.value); setDispatchPage(1); }} className="prod-filter-select">
                                <option value="ready">Ready for Dispatch</option>
                                <option value="dispatched">Dispatched</option>
                            </select>
                        </div>
                        {dispatchList.length === 0 ? (
                            <p className="prod-muted" style={{ padding: 40, textAlign: "center" }}>No {dispatchSection === "ready" ? "orders ready for dispatch" : "dispatched orders"}</p>
                        ) : (
                            <div className="prod-list-scroll">
                                {paginatedDispatch.map(order => (
                                    <OrderCard key={order.id} order={order} vendorMap={vendorMap} components={componentsByOrder[order.id] || []} onJourney={openJourney} onManualComplete={markManualComplete} onView={handleViewOrder}
                                        getStageStatusClass={getStageStatusClass} getStageStatusLabel={getStageStatusLabel} onWarehousePdf={handleDownloadWarehousePdf} pdfLoading={pdfLoading} />
                                ))}
                                {dispatchList.length > ORDERS_PER_PAGE && (
                                    <div className="prod-pagination">
                                        <button disabled={dispatchPage === 1} onClick={() => setDispatchPage(p => p - 1)} className="prod-pagination-btn">{"\u2190"} Previous</button>
                                        <span className="prod-pagination-info">Page {dispatchPage} of {Math.ceil(dispatchList.length / ORDERS_PER_PAGE)}</span>
                                        <button disabled={dispatchPage >= Math.ceil(dispatchList.length / ORDERS_PER_PAGE)} onClick={() => setDispatchPage(p => p + 1)} className="prod-pagination-btn">Next {"\u2192"}</button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ===== ALL ORDERS TAB ===== */}
                {activeTab === "orders" && (
                    <div className="prod-tab-wrapper">
                        <h2 className="prod-tab-title">All Orders</h2>
                        <div className="prod-filters-row" style={{ flexWrap: "wrap" }}>
                            <input type="text" placeholder="Search order #, PO, vendor..." value={orderSearch} onChange={(e) => { setOrderSearch(e.target.value); setCurrentPage(1); }} className="prod-search-input" />
                            <select value={prodFilter} onChange={(e) => { setProdFilter(e.target.value); setCurrentPage(1); }} className="prod-filter-select">
                                <option value="all">All Status</option>
                                <option value="queue">Not Started</option>
                                <option value="in_production">In Production</option>
                                <option value="ready">Ready for Dispatch</option>
                                <option value="dispatched">Dispatched / Done</option>
                            </select>
                            <select value={allTypeFilter} onChange={(e) => { setAllTypeFilter(e.target.value); setCurrentPage(1); }} className="prod-filter-select">
                                <option value="all">All Types</option>
                                <option value="Buyout">Buyout</option>
                                <option value="Consignment">Consignment</option>
                                <option value="Client Order">Client Order</option>
                            </select>
                            <select value={merchandiserFilter} onChange={(e) => { setMerchandiserFilter(e.target.value); setCurrentPage(1); }} className="prod-filter-select">
                                <option value="all">All Merchandisers</option>
                                {uniqueMerchandisers.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setCurrentPage(1); }} className="prod-filter-select" title="From date" />
                            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setCurrentPage(1); }} className="prod-filter-select" title="To date" />
                            {stageFilter && (
                                <button onClick={() => { setStageFilter(null); setStageKindFilter("both"); setCurrentPage(1); }} title="Clear stage filter"
                                    style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid #d5b85a", background: "#faf6e8", color: "#6b5842", fontSize: 12, cursor: "pointer", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
                                    {(STAGE_GROUPS.find(g => g.key === stageFilter)?.label || stageFilter)}
                                    {stageKindFilter === "internal" ? " · In-house" : stageKindFilter === "external" ? " · Vendor" : ""}
                                    <span aria-hidden="true">{"✕"}</span>
                                </button>
                            )}
                            {(prodFilter !== "all" || allTypeFilter !== "all" || merchandiserFilter !== "all" || dateFrom || dateTo) && (
                                <button onClick={() => { setProdFilter("all"); setAllTypeFilter("all"); setMerchandiserFilter("all"); setDateFrom(""); setDateTo(""); setCurrentPage(1); }} style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "#e53935", color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: 500 }}>Clear</button>
                            )}
                        </div>
                        <div className="prod-list-scroll">
                            {filteredOrders.length === 0 && <p className="prod-muted">No orders match your filters.</p>}
                            {paginatedOrders.map(order => {
                                return <OrderCard key={order.id} order={order} vendorMap={vendorMap} components={componentsByOrder[order.id] || []} onJourney={openJourney} onManualComplete={markManualComplete} onView={handleViewOrder} getStageStatusClass={getStageStatusClass} getStageStatusLabel={getStageStatusLabel} onWarehousePdf={handleDownloadWarehousePdf} pdfLoading={pdfLoading} />;
                            })}
                            {filteredOrders.length > ORDERS_PER_PAGE && (
                                <div className="prod-pagination">
                                    <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="prod-pagination-btn">{"\u2190"} Previous</button>
                                    <span className="prod-pagination-info">Page {currentPage} of {Math.ceil(filteredOrders.length / ORDERS_PER_PAGE)}</span>
                                    <button disabled={currentPage >= Math.ceil(filteredOrders.length / ORDERS_PER_PAGE)} onClick={() => setCurrentPage(p => p + 1)} className="prod-pagination-btn">Next {"\u2192"}</button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ===== CALENDAR TAB ===== */}
                {activeTab === "calendar" && (
                    <div className="prod-calendar-wrapper">
                        <div className="prod-ios-calendar">
                            <div className="prod-ios-cal-header">
                                <button className="prod-ios-nav-btn" disabled={new Date(calendarDate).getFullYear() === MIN_CALENDAR_DATE.getFullYear() && new Date(calendarDate).getMonth() === MIN_CALENDAR_DATE.getMonth()} onClick={() => setCalendarDate(d => { const n = new Date(d); n.setMonth(n.getMonth() - 1); return n; })}>{"\u2039"}</button>
                                <span className="prod-ios-month-year">{new Date(calendarDate).toLocaleString("default", { month: "long", year: "numeric" })}</span>
                                <button className="prod-ios-nav-btn" onClick={() => setCalendarDate(d => { const n = new Date(d); n.setMonth(n.getMonth() + 1); return n; })}>{"\u203A"}</button>
                            </div>
                            <div className="prod-ios-days-row">
                                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (<div key={day} className="prod-ios-day-label">{day}</div>))}
                            </div>
                            <div className="prod-ios-date-grid">
                                {(() => {
                                    const year = new Date(calendarDate).getFullYear();
                                    const month = new Date(calendarDate).getMonth();
                                    const firstDay = new Date(year, month, 1).getDay();
                                    const daysInMonth = new Date(year, month + 1, 0).getDate();
                                    const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
                                    return Array.from({ length: totalCells }).map((_, i) => {
                                        const date = i - firstDay + 1;
                                        if (date <= 0 || date > daysInMonth) return <div key={i} className="prod-ios-date-cell prod-ios-empty" />;
                                        const currentDay = new Date(year, month, date);
                                        const fullDate = formatDate(currentDay);
                                        const todayDate = formatDate(new Date());
                                        const isToday = fullDate === todayDate;
                                        const isSelected = selectedCalendarDate === fullDate;
                                        const orderCount = ordersByDate[fullDate] || 0;
                                        return (
                                            <div key={i} className={`prod-ios-date-cell ${isToday ? "prod-ios-today" : ""} ${isSelected ? "prod-ios-selected" : ""}`} onClick={() => setSelectedCalendarDate(fullDate)}>
                                                <span className="prod-ios-date-num">{date}</span>
                                                {orderCount > 0 && <span className="prod-ios-order-count">{orderCount}</span>}
                                            </div>
                                        );
                                    });
                                })()}
                            </div>
                        </div>

                        {selectedCalendarDate && (
                            <div className="prod-calendar-orders-section">
                                <div className="prod-card-header">
                                    <span className="prod-card-title">Deliveries for {selectedCalendarDate} ({orders.filter(o => formatDate(o.delivery_date) === selectedCalendarDate).length})</span>
                                </div>
                                <div className="prod-calendar-orders-list">
                                    {orders.filter(o => formatDate(o.delivery_date) === selectedCalendarDate).length === 0 ? (
                                        <p className="prod-muted">No deliveries on this date</p>
                                    ) : (
                                        orders.filter(o => formatDate(o.delivery_date) === selectedCalendarDate).map(order => {
                                            return (
                                                <div className="prod-order-item" key={order.id} onClick={() => handleViewOrder(order.id)} style={{ cursor: "pointer" }}>
                                                    <p><b>Order No:</b> {order.order_no} &nbsp;|&nbsp; <b>PO:</b> {order.po_number || "\u2014"}</p>
                                                    <p><b>Vendor:</b> {vendorMap[order.vendor_id]?.store_brand_name || "\u2014"}</p>
                                                    <p><b>Status:</b> <span className={getStageStatusClass(order)}>{getStageStatusLabel(order)}</span></p>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ===== PROFILE TAB ===== */}
                {activeTab === "profile" && (
                    <div className="prod-tab-wrapper prod-profile-wrap">
                        <h2 className="prod-profile-title">My Profile</h2>
                        <div className="prod-profile-card">
                            <div className="prod-profile-row"><span className="prod-plabel">Name</span><span className="prod-pvalue">{profile?.saleperson || "User"}</span></div>
                            <div className="prod-profile-row"><span className="prod-plabel">Email</span><span className="prod-pvalue">{user?.email}</span></div>
                            <div className="prod-profile-row"><span className="prod-plabel">Role</span><span className="prod-pvalue">B2B Production Head</span></div>
                            <div className="prod-profile-row"><span className="prod-plabel">Store</span><span className="prod-pvalue">{profile?.store_name || "N/A"}</span></div>
                        </div>
                    </div>
                )}

                {/* ===== VENDOR / EXTERNAL (Production Head workspace) ===== */}
                {activeTab === "vendors" && (
                    <div className="prod-tab-wrapper">
                        <ProductionHeadVendors currentUserEmail={profile?.email || user?.email} />
                    </div>
                )}
            </div>

            {/* ===== COMPONENT JOURNEY MODAL (shared) ===== */}
            {journeyOrder && (
                <ComponentJourneyModal
                    orderNo={journeyOrder.order_no}
                    components={journeyOrder.components}
                    onClose={() => setJourneyOrder(null)}
                />
            )}


            {/* ===== TEMPORARY MANUAL COMPLETION CONFIRM ===== */}
            {manualCompleteOrder && (
                <div className="prod-modal-overlay" onClick={() => !manualCompleteProcessing && setManualCompleteOrder(null)}>
                    <div className="prod-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="prod-modal-top">
                            <h3>Temporary Manual Completion</h3>
                            <button className="prod-modal-close" onClick={() => setManualCompleteOrder(null)}>{"×"}</button>
                        </div>
                        <div className="prod-modal-body">
                            <p>Mark order <b>{manualCompleteOrder.order_no}</b> as completed <b>without</b> the production checks?</p>
                            <p style={{ color: "#c4631a", fontSize: 13, marginTop: 8 }}>This bypasses the normal production flow.</p>
                        </div>
                        <div className="prod-modal-footer">
                            <button className="prod-modal-cancel" onClick={() => setManualCompleteOrder(null)} disabled={manualCompleteProcessing}>Cancel</button>
                            <button className="prod-modal-confirm" onClick={confirmManualComplete} disabled={manualCompleteProcessing}>{manualCompleteProcessing ? "Completing..." : "Yes, complete it"}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ==================== ORDER CARD COMPONENT ====================
function OrderCard({ order, vendorMap, components = [], onView, getStageStatusClass, getStageStatusLabel, onWarehousePdf, pdfLoading, onJourney, onManualComplete }) {
    const item = order.items?.[0] || {};
    const imgSrc = item.image_url || "/placeholder.png";

    return (
        <div className="prod-order-card-full" onClick={() => onView(order.id)} style={{ cursor: "pointer" }}>
            <div className="prod-ocard-header">
                <div className="prod-ocard-info">
                    <div className="prod-ocard-field"><span className="prod-ocard-label">ORDER NO:</span><span className="prod-ocard-val">{order.order_no || "\u2014"}</span></div>
                    <div className="prod-ocard-field"><span className="prod-ocard-label">ORDER DATE:</span><span className="prod-ocard-val">{formatDate(order.created_at) || "\u2014"}</span></div>
                    <div className="prod-ocard-field"><span className="prod-ocard-label">DELIVERY:</span><span className="prod-ocard-val">{formatDate(order.delivery_date) || "\u2014"}</span></div>
                    <div className="prod-ocard-field"><span className="prod-ocard-label">PO NUMBER:</span><span className="prod-ocard-val">{order.po_number || "\u2014"}</span></div>
                </div>
                <div className="prod-ocard-badges">
                    <div className={`prod-order-status-badge ${getStageStatusClass(order)}`}>{getStageStatusLabel(order)}</div>
                    {order.b2b_order_type && (<div className={`prod-order-type-badge ${order.b2b_order_type === "Buyout" ? "prod-type-buyout" : "prod-type-consignment"}`}>{order.b2b_order_type}</div>)}
                    {order.order_flag === "Urgent" && (<div className="prod-urgent-badge">{"\u26A0"} Urgent</div>)}
                    <button className="prod-pdf-btn" onClick={(e) => onWarehousePdf(e, order)} disabled={pdfLoading === order.id}>
                        {pdfLoading === order.id ? "..." : "\uD83D\uDCC4 Warehouse PDF"}
                    </button>
                </div>
            </div>
            <div className="prod-ocard-content">
                <div className="prod-ocard-thumb"><img src={imgSrc} alt={item.product_name || "Product"} /></div>
                <div className="prod-ocard-details">
                    <div className="prod-ocard-row"><span className="prod-ocard-dlabel">Product:</span><span className="prod-ocard-dval">{item.product_name || "\u2014"}</span></div>
                    <div className="prod-ocard-row"><span className="prod-ocard-dlabel">Vendor:</span><span className="prod-ocard-dval">{vendorMap[order.vendor_id]?.store_brand_name || "\u2014"}</span></div>
                    <div className="prod-ocard-grid">
                        <div className="prod-ocard-gitem"><span className="prod-ocard-dlabel">Qty:</span><span className="prod-ocard-dval">{order.total_quantity || 1}</span></div>
                        <div className="prod-ocard-gitem"><span className="prod-ocard-dlabel">Delivery:</span><span className="prod-ocard-dval">{formatDate(order.delivery_date) || "\u2014"}</span></div>
                    </div>
                </div>
            </div>
            {components.length > 0 && (
                <div className="prod-comp-journey">
                    {components.map((comp) => (
                        <div key={comp.id} className="prod-comp-card">
                            <div className="prod-comp-info">
                                <span className="prod-comp-barcode">{comp.barcode}</span>
                                <span className="prod-comp-label">{comp.component_label || comp.component_type}</span>
                            </div>
                            <ComponentStageBadge comp={comp} />
                        </div>
                    ))}
                </div>
            )}
            <div className="prod-ocard-actions" onClick={(e) => e.stopPropagation()}>
                {onJourney && components.length > 0 && (
                    <button className="prod-btn-journey" onClick={() => onJourney(order, components)}>View Journey</button>
                )}
                <button className="prod-btn-detail" onClick={() => onView(order.id)}>View Details</button>
                {/* Production Head: force-complete bypassing the flow. */}
                {onManualComplete && !["completed", "delivered", "cancelled"].includes((order.status || "").toLowerCase()) && (
                    <button className="prod-btn-manual-complete" onClick={() => onManualComplete(order)}>Temporary Manual Completion</button>
                )}
            </div>
        </div>
    );
}

function StatCard({ title, value, change, highlight }) {
    return (
        <div className={`prod-stat-card-inner ${highlight ? "prod-stat-highlight" : ""}`}>
            <p className="prod-stat-title">{title}</p>
            <div className="prod-stat-content">
                <span className="prod-stat-value">{value}</span>
                <span className="prod-stat-change">{change}</span>
            </div>
        </div>
    );
}