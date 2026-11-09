import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { fmtDate as formatDate } from "./pmModel";
import { usePopup } from "../../components/Popup";
import useTabParam from "../../hooks/useTabParam";
import NotificationBell from "../../components/NotificationBell";
import LogoLoader from "../../components/LogoLoader";
import ComponentJourneyModal from "../../components/ComponentJourneyModal";
import ComponentStageBadge from "../../components/ComponentStageBadge";
import CompletePicker from "../../components/CompletePicker";
import useHalfMadeSuggestions from "../../hooks/useHalfMadeSuggestions";
import { HalfMadeBadge } from "../../components/HalfMadeSuggestion";
import { runManualCompleteWithOverride, describeBlocking } from "../../utils/manualComplete";
import { cancelOrder } from "../../utils/cancelOrder";
import { downloadWarehousePdf } from "../../utils/pdfLazy";
import { fetchFullOrder, PM_LIST_SELECT } from "../../utils/pmOrderColumns";
import { fetchExternalMovements } from "../../utils/externalMovements";
import { fetchQcRecords } from "../../utils/qcHistory";
import { fetchReJourneys } from "../../utils/reJourneys";
import { listHalfMade } from "../../utils/halfMade";
import { loadLedger, loadSales, loadStockOrders, loadStockRoomCatalogue } from "../StockRoom/stockRoomData";
import { getStagesOutsideLabel } from "../../utils/barcodeService";
import { fetchAllRowsParallel } from "../../utils/fetchAllRowsParallel";
import Logo from "../../images/logo.png";
import { CalendarIcon, Chips, DateRange, Drawer, FilterGroup, GlobalSearch, Icon, MenuIcon, Thumb, num } from "../CeoDashboard/CeoUi";
import { Stat } from "../CeoDashboard/dashKit";
import "../CeoDashboard/CeoMakeover.css";
import "../GMDashboard/GmMakeover.css";
import "./PmMakeover.css";
import {
  channelOf, clientOf, dayKey, daysLeft, dueDay, groupPieces, isLate, isRunning, isUrgent, loadOrderPieces, loadPmCore, loadQc, loadScans,
  atVendor, isOwnTrip, loadDispatchScans, loadWaiting, pieceName, pieceState, plural,
} from "./pmModel";
import { OrdersTable, PiecesTable, orderStatus, piecesLine } from "./PmCommon";
import { DEFAULT_PERIOD, PM_PERIODS, pmPeriod } from "./pmPeriod";
import { PmCancelModal, PmEditOrderModal, PmPriorityModal } from "./PmModals";
import TodayPage from "./PmToday";
import OrdersPage from "./PmOrders";
import FloorPage from "./PmFloor";
import PlanningPage from "./PmPlanning";
import QualityPage from "./PmQuality";
import VendorsPage from "./PmVendors";
import DispatchPage from "./PmDispatch";
import PeoplePage from "./PmPeople";
import RequestsPanel from "./PmApprovals";
import { ProfileBody } from "./PmMore";
import { clearSnapshots, hasSnapshotFlag, readSnapshot, writeSnapshot } from "./pmCache";
import ProductionOverrides from "../../components/ProductionOverrides";
import "../../components/ProductionOverrides.css";
import OverrideHistory from "../../components/OverrideHistory";
import StockPage from "./PmStock";

// ============================================================
// Production Manager dashboard. Everything the old dashboard did, in the
// building blocks of the CEO, GM and Comms dashboards, with no money and no
// client contact details. The old layout stays at
// /production-manager-dashboard/classic, linked from the menu.
// ============================================================

// Every order action (journey, PDF, edit, priority, overrides, complete,
// cancel) lives on the order itself, so the menu holds pages to read only.
// Requests & Overrides and the Profile open as side panels over any page.
const NAV = [
  {
    group: "Run the Floor",
    items: [
      { id: "today", label: "Today", icon: "overview" },
      { id: "orders", label: "Orders", icon: "orders" },
      { id: "floor", label: "Floor & Flow", icon: "movements" },
      { id: "planning", label: "Planning", icon: "calendar" },
      { id: "dispatch", label: "Dispatch & Delivery", icon: "transfer" },
    ],
  },
  {
    group: "Watch",
    items: [
      { id: "quality", label: "Quality", icon: "integrity" },
      { id: "vendors", label: "Vendors", icon: "warehouse" },
      { id: "stock", label: "Stock", icon: "stock" },
      { id: "people", label: "People", icon: "trend" },
    ],
  },
];
// Old links (bookmarks, notifications) still land on the right page, or open
// the right panel.
const TAB_ALIASES = {
  overview: "today", production: "floor", qc_history: "quality", rejourneys: "quality", delivery_report: "dispatch",
  dispatch_report: "dispatch", vendor_delays: "vendors", calendar: "planning", staff: "people", cancellations: "orders",
  approvals: "today", overrides: "today", override_log: "today", replacements: "today", profile: "today",
};
const PANEL_TABS = { approvals: "overrides", overrides: "overrides", override_log: "log", replacements: "replacements" };
const CalIcon = () => <CalendarIcon />;

// The slower data sets Today reads, kept in the snapshot so it opens complete.
const SNAPSHOT_LAZY = ["waiting", "scans8", "qc8", "movements"];

// Loaded the first time a page asks for them, then kept.
const LOADERS = {
  scans8: () => loadScans(8),
  scans30: () => loadScans(30),
  qc8: () => loadQc(8),
  dispatch120: () => loadDispatchScans(120),
  qc90: () => loadQc(90),
  movements: () => fetchExternalMovements(),
  waiting: () => loadWaiting(),
  qcAll: () => fetchQcRecords({ paged: true }),
  rejourneys: () => fetchReJourneys({ paged: true }),
  // Stock Room's own loaders, so the Stock page counts exactly what Stock Room counts.
  stockRoom: async () => {
    const [catalogue, stockOrders, ledger, recentOrders] = await Promise.all([
      loadStockRoomCatalogue(), loadStockOrders(), loadLedger().catch(() => ({ installed: false })), loadSales(90),
    ]);
    return { data: { ...catalogue, stockOrders, recentOrders, ordersReady: true, salesReady: true }, ledger };
  },
  halfMade: () => listHalfMade(),
  // Design names for the header search (a small list; the full stock data loads on the Stock page).
  designs: async () => {
    const res = await fetchAllRowsParallel("products_live", (q) => q.select("id, name, sku_id").order("id"));
    if (res.error) throw res.error;
    return (res.data || []).filter((d) => d && d.name);
  },
};

// Scans, QC checks and dispatch scans for any number of days back, asked for
// by the date range ("qc180", "scans90", "dispatch400").
const loaderFor = (key) => {
  if (LOADERS[key]) return LOADERS[key];
  const m = String(key).match(/^(scans|qc|dispatch)(\d+)$/);
  if (!m) return null;
  const days = Number(m[2]);
  return m[1] === "scans" ? () => loadScans(days) : m[1] === "qc" ? () => loadQc(days) : () => loadDispatchScans(days);
};

// The pages that report on the header's date range.
const PERIOD_TABS = ["quality", "vendors", "dispatch", "people"];
const PERIOD_KEY = "sb-pm-period";
const readPeriod = () => {
  try { const v = JSON.parse(sessionStorage.getItem(PERIOD_KEY) || "null"); if (v && v.key) return v; } catch { /* nothing saved */ }
  return { key: DEFAULT_PERIOD, from: "", to: "" };
};

export default function PmDashboard() {
  const navigate = useNavigate();
  const { showPopup, PopupComponent } = usePopup();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [orders, setOrders] = useState([]);
  const [components, setComponents] = useState([]);
  const [vendorMap, setVendorMap] = useState({});
  const [syncedAt, setSyncedAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lazy, setLazy] = useState({});
  const started = useRef({});

  const [rawTab, setActiveTab] = useTabParam("today");
  const activeTab = TAB_ALIASES[rawTab] || rawTab;
  const [navOpen, setNavOpen] = useState(false);
  const [stack, setStack] = useState([]);
  const [journey, setJourney] = useState(null);
  const [picker, setPicker] = useState(null);
  const [editing, setEditing] = useState(null);
  const [prioritising, setPrioritising] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [busy, setBusy] = useState(null);
  const [requests, setRequests] = useState(null);   // { view } when the Requests & Overrides panel is open
  const [overriding, setOverriding] = useState(null); // the order whose pieces are being moved
  const [overrideLog, setOverrideLog] = useState(null); // the order whose override history is open
  const [profileOpen, setProfileOpen] = useState(false);
  const [ordersTab, setOrdersTab] = useState(null);  // a tab the Orders page should open on
  const [stockFocus, setStockFocus] = useState(null); // a design the Stock page should open
  // The header's date range, kept for this browser tab.
  const [periodSel, setPeriodSel] = useState(readPeriod);
  const [periodOpen, setPeriodOpen] = useState(false);
  const period = useMemo(() => pmPeriod(periodSel.key, periodSel.from, periodSel.to), [periodSel]);
  const pickPeriod = (next) => {
    const v = { ...periodSel, ...next };
    setPeriodSel(v);
    try { sessionStorage.setItem(PERIOD_KEY, JSON.stringify(v)); } catch { /* storage blocked */ }
  };
  // Old links to Approvals, Overrides or Profile open their panel over Today;
  // an old Cancellations link opens Orders on the Cancelled tab.
  useEffect(() => {
    if (PANEL_TABS[rawTab]) setRequests({ view: PANEL_TABS[rawTab] });
    if (rawTab === "profile") setProfileOpen(true);
    if (rawTab === "cancellations") setOrdersTab("cancelled");
  }, [rawTab]);

  const apply = useCallback(({ orders: o, components: c, vendorMap: v }, at = new Date()) => {
    setOrders(o);
    setComponents(c);
    setVendorMap(v);
    setSyncedAt(at);
  }, []);

  // Opening: the role check, the last saved snapshot and the fresh data all
  // start together. Once the role check passes the snapshot (if any) shows at
  // once, with "Updating" in the header; the fresh data replaces it when it
  // arrives. The logo screen shows only when there is no snapshot yet (the
  // very first visit on this browser, or after a day away).
  const [stale, setStale] = useState(false);
  const [quickStart] = useState(hasSnapshotFlag);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/login", { replace: true }); return; }
      const email = session.user.email?.toLowerCase();
      const data = loadPmCore().catch((err) => ({ error: err }));
      const saved = readSnapshot(email);
      const { data: sp } = await supabase.from("salesperson").select("*").eq("email", email).maybeSingle();
      if (cancelled) return;
      if (!sp || sp.role !== "production_manager") {
        await clearSnapshots();
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
        return;
      }
      setProfile(sp);
      const snap = await saved;
      if (cancelled) return;
      if (snap?.core) {
        apply(snap.core, new Date(snap.savedAt));
        // The saved slower data sets show too; each is fetched again in the background.
        // Saved sets only fill gaps: anything already loaded fresh is kept.
        setLazy((s) => ({ ...Object.fromEntries(Object.entries(snap.lazy || {}).map(([k, rows]) => [k, { loading: false, rows }])), ...s }));
        setStale(true);
        setLoading(false);
      }
      const loaded = await data;
      if (cancelled) return;
      if (loaded.error) {
        console.error("Production data failed:", loaded.error);
        showPopup({
          title: "Data Not Updated",
          message: snap?.core
            ? "The latest production data could not be loaded, so the dashboard is showing what it last saved. Use Refresh in the menu to try again."
            : "The production data could not be loaded. Please refresh the page.",
          type: "error", confirmText: "Ok",
        });
      } else apply(loaded);
      setStale(false);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [navigate, apply]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Ask for a slower data set once; pages read it from ctx.lazy[key]. Saved rows stay on screen while it reloads. */
  const need = useCallback((key) => {
    const load = loaderFor(key);
    if (started.current[key] || !load) return;
    started.current[key] = true;
    setLazy((s) => ({ ...s, [key]: { loading: true, rows: s[key]?.rows ?? null } }));
    load()
      .then((rows) => setLazy((s) => ({ ...s, [key]: { loading: false, rows } })))
      .catch((err) => {
        console.error(`Loading ${key} failed:`, err);
        started.current[key] = false;
        setLazy((s) => ({ ...s, [key]: { loading: false, rows: null, error: err.message || "Could not load" } }));
      });
  }, []);
  // Today needs the requests, the vendor trips and a week of scans.
  useEffect(() => { if (!loading) { need("waiting"); need("movements"); need("scans8"); need("qc8"); need("designs"); } }, [loading, need]);

  const openRequests = useCallback((view = "overrides") => setRequests({ view }), []);
  /** Re-read what is waiting for a decision (after the Requests panel closes). */
  const refreshWaiting = useCallback(() => {
    loadWaiting().then((rows) => setLazy((st) => ({ ...st, waiting: { loading: false, rows } }))).catch(() => {});
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      apply(await loadPmCore());
      const keys = Object.keys(started.current).filter((k) => started.current[k]);
      started.current = {};
      keys.forEach(need);
    } catch (err) {
      showPopup({ title: "Not Updated", message: "The data could not be updated. Please try again.", type: "error", confirmText: "Ok" });
    } finally { setRefreshing(false); }
  };

  // Keep the snapshot current: a few seconds after fresh data (or an action)
  // settles, save the production data and the small sets Today reads.
  useEffect(() => {
    if (loading || stale || !profile?.email || !orders.length) return undefined;
    const t = setTimeout(() => {
      const keep = Object.fromEntries(SNAPSHOT_LAZY.filter((k) => lazy[k]?.rows && !lazy[k].loading).map((k) => [k, lazy[k].rows]));
      writeSnapshot(profile.email, { core: { orders, components, vendorMap }, lazy: keep });
    }, 4000);
    return () => clearTimeout(t);
  }, [loading, stale, profile, orders, components, vendorMap, lazy]);

  const componentsByOrder = useMemo(() => groupPieces(components), [components]);
  const ordersById = useMemo(() => Object.fromEntries(orders.map((o) => [o.id, o])), [orders]);
  const halfMade = useHalfMadeSuggestions(orders);

  /** Update one order in place after an action. */
  const patchOrder = useCallback((fresh) => setOrders((prev) => prev.map((o) => (o.id === fresh.id ? { ...o, ...fresh } : o))), []);
  /** Re-read one order and its pieces (after Complete or Cancel) instead of everything. */
  const reloadOrder = useCallback(async (orderId) => {
    const [{ data: row }, pieces] = await Promise.all([
      supabase.from("orders").select(PM_LIST_SELECT).eq("id", orderId).maybeSingle(),
      loadOrderPieces(orderId).catch(() => null),
    ]);
    if (row) patchOrder(row);
    if (pieces) setComponents((prev) => [...prev.filter((c) => c.order_id !== orderId), ...pieces]);
  }, [patchOrder]);

  // ------------------------------------------------------------ drawers
  const open = useCallback((layer) => setStack((s) => [...s, layer]), []);
  const openOrder = useCallback((order) => open({ type: "order", id: order.id }), [open]);
  const openOrders = useCallback(({ title, sub, orders: list }) => open({ type: "orders", title, sub, ids: list.map((o) => o.id) }), [open]);
  const openPieces = useCallback(({ title, sub, pieces }) => open({ type: "pieces", title, sub, ids: pieces.map((c) => c.id) }), [open]);
  const go = useCallback((id) => { setActiveTab(id); setNavOpen(false); setStack([]); }, [setActiveTab]);
  const piecesById = useMemo(() => Object.fromEntries(components.map((c) => [c.id, c])), [components]);

  // ------------------------------------------------------------ actions
  const openJourney = (order) => {
    const comps = componentsByOrder[order.id] || [];
    if (!comps.length) {
      showPopup({ title: "No Pieces Yet", message: `${order.order_no} has no barcoded pieces yet, so there is no journey to show.`, type: "info", confirmText: "Ok" });
      return;
    }
    setJourney({ orderNo: order.order_no, components: comps, orderId: order.id });
  };

  const warehousePdf = async (order) => {
    if (busy) return;
    setBusy(`${order.id}-pdf`);
    try {
      const result = await downloadWarehousePdf(await fetchFullOrder(order), null, false);
      if (!result) throw new Error("no file");
      const urls = Array.isArray(result) ? result : [result];
      patchOrder({ id: order.id, warehouse_urls: urls, warehouse_url: urls[0] });
    } catch (err) {
      console.error("Warehouse PDF failed:", err);
      showPopup({ type: "error", title: "PDF Not Opened", message: "The warehouse PDF could not be opened. Please try again.", confirmText: "Ok" });
    } finally { setBusy(null); }
  };

  const ask = (opts) => new Promise((resolve) => showPopup({ type: "confirm", cancelText: "Cancel", ...opts, onConfirm: () => resolve(true), onCancel: () => resolve(false) }));

  // Mark as Completed: the same RPC and Final QC override handshake as before.
  // A multi-product order asks which products first.
  const complete = async (order, picked = undefined) => {
    const comps = componentsByOrder[order.id] || [];
    const products = [...new Set(comps.filter((c) => !["disposed", "scrapped"].includes(c.current_stage)).map((c) => c.item_index ?? 0))].sort((a, b) => a - b);
    if (picked === undefined && products.length > 1) { setPicker({ order, products }); return; }
    const pick = Array.isArray(picked) && picked.length ? picked : null;
    const names = pick ? pick.map((i) => order.items?.[i]?.product_name || `product ${i + 1}`).join(" + ") : null;
    const scope = pick ? `${names} of ${order.order_no}` : `order ${order.order_no}`;
    const ok = await ask({ title: "Mark as Completed", message: `Mark ${scope} as completed? Its pieces become ready for Packaging & Dispatch. If any piece has not passed Final QC you will be asked to confirm an override.`, confirmText: "Yes, complete it" });
    if (!ok) return;
    setBusy(`${order.id}-complete`);
    try {
      const res = await runManualCompleteWithOverride({
        orderId: order.id,
        by: profile?.email,
        picked: pick,
        allowOverride: true,
        confirmOverride: ({ blocking }) => ask({
          title: "Override Final QC?",
          message: `${blocking.length} piece(s) have NOT passed Final QC:\n\n${describeBlocking(blocking)}\n\nCompleting now skips Final QC for them. They become ready for Packaging & Dispatch, and this is recorded against your name in the order's QC report.`,
          confirmText: "Override & complete",
        }),
      });
      if (res.cancelled) return;
      await reloadOrder(order.id);
      showPopup({ type: "success", title: "Done", message: res.last?.message || `${scope} marked as completed.`, confirmText: "Ok" });
    } catch (err) {
      console.error("Complete failed:", err);
      showPopup({ type: "error", title: "Not Completed", message: err.message || "The order could not be updated.", confirmText: "Ok" });
    } finally { setBusy(null); }
  };

  const confirmCancel = async (reason) => {
    const order = cancelling;
    setBusy(`${order.id}-cancel`);
    try {
      const { cancelledComponents } = await cancelOrder(await fetchFullOrder(order), reason, { cancelledBy: profile?.saleperson || profile?.email || "", email: profile?.email || "" });
      setCancelling(null);
      await reloadOrder(order.id);
      showPopup({ type: "success", title: "Order Cancelled", message: `${order.order_no} has been cancelled.${cancelledComponents ? ` ${cancelledComponents} piece(s) taken off the floor.` : ""}`, confirmText: "Ok" });
    } catch (err) {
      showPopup({ type: "error", title: "Not Cancelled", message: err.message || "The order could not be cancelled.", confirmText: "Ok" });
    } finally { setBusy(null); }
  };

  const edit = async (order) => {
    setBusy(`${order.id}-edit`);
    try { setEditing(await fetchFullOrder(order)); } finally { setBusy(null); }
  };

  const handleLogout = async () => { await clearSnapshots(); await supabase.auth.signOut(); navigate("/login"); };

  const pages = NAV.flatMap((g) => g.items);
  const ctx = {
    profile, email: profile?.email || "", orders, ordersById, components, componentsByOrder, piecesById, vendorMap, halfMade,
    lazy, need, syncedAt, period,
    openOrder, openOrders, openPieces, go, openJourney, showPopup, navigate, ordersTab, setOrdersTab, stockFocus, setStockFocus,
    openRequests,
    openOverrideLog: (order) => setOverrideLog(order),
    actions: { complete, cancel: setCancelling, edit, priority: setPrioritising, warehousePdf, override: (o) => setOverriding(o), busy },
  };
  // The header search: everything this dashboard can see. The box itself
  // matches pages and order or PO numbers; these add, in this order, orders by
  // Shopify number, clients, products, piece barcodes, stock designs, vendors,
  // floor staff and salespeople (up to 4 of each). Picking one opens its order,
  // its list of orders or pieces, or its page, from any screen.
  const searchIndex = useMemo(() => {
    const out = [];
    const group = (keyOf) => {
      const m = {};
      orders.forEach((o) => {
        (keyOf(o) || []).forEach((name) => {
          const n = String(name || "").trim();
          if (!n) return;
          const k = n.toLowerCase();
          const g = m[k] || (m[k] = { name: n, list: [] });
          if (!g.list.includes(o)) g.list.push(o);
        });
      });
      return Object.values(m).sort((x, y) => y.list.length - x.list.length);
    };
    orders.forEach((o) => {
      if (!o.shopify_order_name && !o.shopify_order_id) return;
      out.push({ key: `s${o.id}`, kind: "Order", label: o.order_no, meta: `Shopify ${o.shopify_order_name || o.shopify_order_id}`, text: `${o.shopify_order_name || ""} ${o.shopify_order_id || ""}`, go: () => openOrder(o) });
    });
    group((o) => [clientOf(o, vendorMap)]).forEach((g) => out.push({
      key: `c${g.name}`, kind: "Client", label: g.name, meta: plural(g.list.length, "order"), text: g.name,
      go: () => openOrders({ title: g.name, sub: "Every order for this client", orders: g.list }),
    }));
    group((o) => (o.items || []).map((it) => it.product_name)).forEach((g) => out.push({
      key: `p${g.name}`, kind: "Product", label: g.name, meta: plural(g.list.length, "order"), text: g.name,
      go: () => openOrders({ title: g.name, sub: "Every order with this product", orders: g.list }),
    }));
    components.forEach((c) => {
      if (!c.barcode) return;
      out.push({ key: `b${c.id}`, kind: "Piece", label: c.barcode, meta: `${pieceName(c)} · ${c.order_no || ""}`, text: c.barcode, go: () => { const o = ordersById[c.order_id]; if (o) openOrder(o); } });
    });
    (lazy.designs?.rows || []).forEach((d) => out.push({
      key: `d${d.id}`, kind: "Design", label: d.name, meta: d.sku_id || "Stock", text: `${d.name} ${d.sku_id || ""}`,
      go: () => { setStockFocus(d.id); go("stock"); },
    }));
    const vendors = {};
    (lazy.movements?.rows || []).forEach((m) => {
      const n = String(m.vendor_name || "").trim();
      if (!n || isOwnTrip(m)) return;
      (vendors[n.toLowerCase()] || (vendors[n.toLowerCase()] = { name: n, trips: 0 })).trips += 1;
    });
    Object.values(vendors).forEach((v) => out.push({
      key: `v${v.name}`, kind: "Vendor", label: v.name, meta: plural(v.trips, "trip"), text: v.name,
      go: () => {
        const here = components.filter((c) => atVendor(c) && String(c.vendor_name || "").trim().toLowerCase() === v.name.toLowerCase() && ordersById[c.order_id]);
        if (here.length) openPieces({ title: `At ${v.name} Now`, sub: "Pieces out with this vendor right now", pieces: here });
        else go("vendors");
      },
    }));
    const staff = {};
    (lazy.scans8?.rows || lazy.scans30?.rows || []).forEach((t) => {
      const n = String(t.scanned_by || "").trim();
      if (!n) return;
      const g = staff[n.toLowerCase()] || (staff[n.toLowerCase()] = { name: n, ids: new Set(), scans: 0 });
      g.scans += 1; if (t.component_id) g.ids.add(t.component_id);
    });
    Object.values(staff).forEach((g) => out.push({
      key: `f${g.name}`, kind: "Floor staff", label: g.name, meta: `${plural(g.scans, "scan")} in 8 days`, text: g.name,
      go: () => openPieces({ title: `Scanned by ${g.name}`, sub: "Pieces this person scanned in the last 8 days", pieces: [...g.ids].map((id) => piecesById[id]).filter(Boolean) }),
    }));
    group((o) => [o.salesperson]).forEach((g) => out.push({
      key: `sp${g.name}`, kind: "Salesperson", label: g.name, meta: plural(g.list.length, "order"), text: g.name,
      go: () => openOrders({ title: `Sold by ${g.name}`, sub: "Every order this salesperson placed", orders: g.list }),
    }));
    return out;
  }, [orders, components, vendorMap, ordersById, piecesById, lazy.designs, lazy.movements, lazy.scans8, lazy.scans30, openOrder, openOrders, openPieces, go]);
  const userName = profile?.saleperson || "";
  const waitingCount = lazy.waiting?.rows ? lazy.waiting.rows.requests + lazy.waiting.rows.replacements : 0;
  const initials = (userName || "PM").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  const top = stack[stack.length - 1];
  const back = stack.length > 1 ? () => setStack((s) => s.slice(0, -1)) : undefined;
  const closeAll = () => setStack([]);

  return (
    <>
      {PopupComponent}
      <div className={`ceo gm pm${navOpen ? " is-nav-open" : ""}`}>
        {loading && !quickStart && (
          <div className="ceo-welcome" role="status">
            <LogoLoader />
            <p className="ceo-welcome-state">Bringing the floor together</p>
          </div>
        )}

        <button type="button" className="ceo-nav-veil" aria-label="Close menu" onClick={() => setNavOpen(false)} />
        <nav className="ceo-nav" aria-label="Production Manager dashboard">
          <button type="button" className="ceo-logo" onClick={() => go("today")} aria-label="Home"><img src={Logo} alt="Sheetal Batra" /></button>
          {NAV.map((g) => (
            <div className="ceo-nav-group" key={g.group}>
              <span className="ceo-label ceo-nav-title">{g.group}</span>
              {g.items.map((item) => (
                <button key={item.id} type="button" className="ceo-nav-item" aria-current={activeTab === item.id ? "page" : undefined} onClick={() => go(item.id)}>
                  {item.icon === "calendar" ? <CalIcon /> : <Icon name={item.icon} />}{item.label}
                </button>
              ))}
            </div>
          ))}
          <div className="ceo-nav-group">
            <span className="ceo-label ceo-nav-title">Decide</span>
            <button type="button" className="ceo-nav-item" onClick={() => { setNavOpen(false); setRequests({ view: "overrides" }); }}>
              <Icon name="edit" />Requests &amp; Overrides{waitingCount > 0 && <b className="pm-nav-count">{num(waitingCount)}</b>}
            </button>
          </div>
          <div className="ceo-nav-group">
            <button type="button" className="ceo-nav-item" onClick={() => navigate("/production-manager-dashboard/classic")}><Icon name="movements" />Old Production dashboard</button>
          </div>
          <div className="ceo-nav-foot">
            <button type="button" className="ceo-who pm-who" onClick={() => { setNavOpen(false); setProfileOpen(true); }} title="Your profile">
              <span className="ceo-avatar">{initials}</span>
              <span><b title={userName}>{userName || profile?.email}</b><small>{syncedAt ? `Data updated ${syncedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : "Production Manager"}</small></span>
            </button>
            <div className="ceo-foot-actions">
              <button type="button" className="ceo-btn" onClick={refresh} disabled={refreshing}><Icon name="refresh" />{refreshing ? "Updating" : "Refresh"}</button>
              <button type="button" className="ceo-btn" onClick={handleLogout}><Icon name="logout" />Log out</button>
            </div>
          </div>
        </nav>

        <main className="ceo-main">
          <div className="ceo-top">
            <button type="button" className="ceo-icon-btn ceo-menu-btn" aria-label="Open menu" onClick={() => setNavOpen(true)}><MenuIcon /></button>
            <GlobalSearch
              pages={pages} orders={orders} products={[]} clients={[]} extra={searchIndex}
              placeholder="Search orders, clients, products, barcodes, vendors, people…"
              onPage={go} onOrder={openOrder} onClient={() => {}} onDesign={() => {}}
            />
            {PERIOD_TABS.includes(activeTab) && (
              <button type="button" className="ceo-view" onClick={() => setPeriodOpen(true)}>
                <CalendarIcon />
                <b>{period.label}</b>
                <span>Date range</span>
              </button>
            )}
            <div className="ceo-top-end">
              {(stale || refreshing) && <span className="pm-updating" role="status"><i />Updating</span>}
              <NotificationBell userEmail={profile?.email} look="soft" onOrderClick={(id) => { const o = ordersById[id]; if (o) openOrder(o); }} />
            </div>
          </div>

          <div className="ceo-scroll">
            {loading && quickStart && (
              <div className="ceo-page pm-skeleton" aria-busy="true" aria-label="Loading">
                <span className="pm-sk is-head" />
                <div className="pm-sk-row">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="pm-sk is-tile" />)}</div>
                <span className="pm-sk is-card" />
                <span className="pm-sk is-card is-short" />
              </div>
            )}
            {!loading && (
              <>
                {activeTab === "today" && <TodayPage ctx={ctx} />}
                {activeTab === "orders" && <OrdersPage ctx={ctx} />}
                {activeTab === "floor" && <FloorPage ctx={ctx} />}
                {activeTab === "planning" && <PlanningPage ctx={ctx} />}
                {activeTab === "quality" && <QualityPage ctx={ctx} />}
                {activeTab === "vendors" && <VendorsPage ctx={ctx} />}
                {activeTab === "dispatch" && <DispatchPage ctx={ctx} />}
                {activeTab === "people" && <PeoplePage ctx={ctx} />}
                {activeTab === "stock" && <StockPage ctx={ctx} />}
              </>
            )}
          </div>

          <div className="ceo-tabbar">
            {[["today", "Today", "overview"], ["orders", "Orders", "orders"], ["floor", "Floor", "movements"], ["quality", "Quality", "integrity"]].map(([id, label, icon]) => (
              <button key={id} type="button" aria-current={activeTab === id ? "page" : undefined} onClick={() => go(id)}><Icon name={icon} />{label}</button>
            ))}
            <button type="button" onClick={() => setNavOpen(true)}><MenuIcon />More</button>
          </div>
        </main>

        {top && top.type === "orders" && (
          <Drawer wide title={top.title} sub={top.sub} onClose={closeAll} onBack={back}>
            <OrdersTable key={`${stack.length}${top.title}`} ctx={ctx} title={top.title} orders={top.ids.map((id) => ordersById[id]).filter(Boolean)} />
          </Drawer>
        )}
        {top && top.type === "pieces" && (
          <Drawer wide title={top.title} sub={top.sub} onClose={closeAll} onBack={back}>
            <PiecesTable key={`${stack.length}${top.title}`} ctx={ctx} title={top.title} pieces={top.ids.map((id) => piecesById[id]).filter(Boolean)} />
          </Drawer>
        )}
        {top && top.type === "order" && ordersById[top.id] && (
          <OrderDrawer order={ordersById[top.id]} ctx={ctx} onClose={closeAll} onBack={back} />
        )}
        {requests && (
          <Drawer wide title="Requests & Overrides" sub="Stage change requests, replacements, moving pieces by override, and the record of every override" onClose={() => { setRequests(null); refreshWaiting(); }}>
            <RequestsPanel ctx={ctx} initialView={requests.view} />
          </Drawer>
        )}
        {overriding && (
          <Drawer wide title="Move or Override Pieces" sub={`${overriding.order_no} · choose a piece, then the override`} onClose={() => { const id = overriding.id; setOverriding(null); reloadOrder(id); }}>
            <div className="pm-classic ceo-keep"><ProductionOverrides currentUserEmail={profile?.email} initialOrder={overriding} /></div>
          </Drawer>
        )}
        {overrideLog && (
          <Drawer wide title="Override History" sub={`Every override recorded on ${overrideLog.order_no}`} onClose={() => setOverrideLog(null)}>
            <div className="pm-classic ceo-keep"><OverrideHistory title="Overrides on this order" initialSearch={overrideLog.order_no} /></div>
          </Drawer>
        )}
        {periodOpen && (
          <Drawer
            title="Date Range"
            sub="Quality, Vendors, Dispatch & Delivery and People all show this range"
            onClose={() => setPeriodOpen(false)}
            footer={(
              <>
                <button type="button" className="ceo-btn" onClick={() => pickPeriod({ key: DEFAULT_PERIOD, from: "", to: "" })}>Reset</button>
                <button type="button" className="ceo-btn is-primary" onClick={() => setPeriodOpen(false)}>Done</button>
              </>
            )}
          >
            <FilterGroup label="Show">
              <Chips
                options={PM_PERIODS}
                value={periodSel.key}
                onChange={(v) => (v === "custom"
                  // Choosing dates starts from the range on screen, so the pages do not jump.
                  ? pickPeriod({ key: "custom", from: dayKey(period.start), to: dayKey(new Date(period.end.getTime() - 1)) })
                  : pickPeriod({ key: v || DEFAULT_PERIOD }))}
              />
            </FilterGroup>
            {periodSel.key === "custom" && (
              <FilterGroup label="Pick the first and last day">
                <DateRange from={periodSel.from} to={periodSel.to} onChange={(a, b) => pickPeriod({ from: a, to: b })} />
              </FilterGroup>
            )}
            <p className="pm-period-note">Showing <b>{period.dates}</b>{period.days > 1 ? ` (${num(period.days)} days)` : ""}.</p>
          </Drawer>
        )}
        {profileOpen && (
          <Drawer title="Your Profile" sub="Your account on the production system" onClose={() => setProfileOpen(false)}>
            <ProfileBody ctx={ctx} />
            <div className="gm-actions"><button type="button" className="ceo-btn" onClick={handleLogout}><Icon name="logout" />Log out</button></div>
          </Drawer>
        )}
      </div>

      {journey && createPortal(
        <ComponentJourneyModal orderNo={journey.orderNo} components={journey.components} onClose={() => { const id = journey.orderId; setJourney(null); reloadOrder(id); }} />,
        document.body,
      )}
      {picker && createPortal(
        <CompletePicker
          order={picker.order}
          components={componentsByOrder[picker.order.id] || []}
          productIdxs={picker.products}
          onConfirm={(picked) => { const o = picker.order; setPicker(null); complete(o, picked); }}
          onClose={() => setPicker(null)}
        />,
        document.body,
      )}
      {editing && <PmEditOrderModal order={editing} onClose={() => setEditing(null)} onSaved={patchOrder} showPopup={showPopup} />}
      {prioritising && <PmPriorityModal order={prioritising} onClose={() => setPrioritising(null)} onSaved={patchOrder} showPopup={showPopup} />}
      {cancelling && <PmCancelModal order={cancelling} onClose={() => setCancelling(null)} onConfirm={confirmCancel} busy={busy === `${cancelling.id}-cancel`} />}
    </>
  );
}

const MEASURE_LABELS = {
  KurtaChogaKaftan: "Kurta / Choga / Kaftan", Blouse: "Blouse", Anarkali: "Anarkali", SalwarDhoti: "Salwar / Dhoti",
  ChuridaarTrouserPantsPlazo: "Churidaar / Trouser / Pants / Plazo", ShararaGharara: "Sharara / Gharara", Lehenga: "Lehenga",
};
/** The client's measurements on a product, grouped by garment, in inches. */
function Measurements({ m }) {
  const groups = Object.entries(m || {}).filter(([, f]) => f && typeof f === "object" && Object.values(f).some((v) => v !== "" && v != null));
  if (!groups.length) return <small className="pm-muted">No measurements recorded (standard size).</small>;
  return (
    <div className="pm-measure">
      {groups.map(([k, f]) => (
        <div key={k} className="pm-measure-group">
          <span>{MEASURE_LABELS[k] || k} (in)</span>
          <div className="pm-measure-chips">
            {Object.entries(f).filter(([, v]) => v !== "" && v != null).map(([name, v]) => <i key={name}><small>{name}</small>{v}</i>)}
          </div>
        </div>
      ))}
    </div>
  );
}

/** This order's own requests waiting for a decision, and its QC checks. */
function OrderChecks({ order: o, ctx }) {
  const [qc, setQc] = useState(null);
  useEffect(() => {
    let alive = true;
    supabase.from("qc_records").select("id, barcode, which_qc, result, fail_reason, outcome, inspected_by, created_at, is_override")
      .eq("order_id", o.id).order("created_at", { ascending: false })
      .then(({ data }) => { if (alive) setQc(data || []); });
    return () => { alive = false; };
  }, [o.id]);
  const waiting = (ctx.lazy.waiting?.rows?.requestRows || []).filter((r) => r.order_id === o.id);
  const waitingRep = (ctx.lazy.waiting?.rows?.replacementRows || []).filter((r) => r.order_id === o.id);
  const fails = (qc || []).filter((r) => r.result === "fail" && !r.is_override);
  return (
    <>
      {(waiting.length > 0 || waitingRep.length > 0) && (
        <div className="pm-od-alert">
          <Icon name="alert" />
          <span>
            {waiting.length > 0 && <>{plural(new Set(waiting.map((r) => r.request_group || r.id)).size, "stage change request")} </>}
            {waiting.length > 0 && waitingRep.length > 0 && "and "}
            {waitingRep.length > 0 && <>{plural(waitingRep.length, "replacement request")} </>}
            on this order {waiting.length + waitingRep.length === 1 ? "is" : "are"} waiting for your decision.
          </span>
          <button type="button" className="ceo-btn is-small" onClick={() => ctx.openRequests(waiting.length ? "overrides" : "replacements")}>Decide now</button>
        </div>
      )}
      {qc && qc.length > 0 && (
        <>
          <p className="pm-dsection">QC Checks on This Order <span className="pm-dsection-note">{plural(qc.length, "check")} · {plural(fails.length, "failure")}</span></p>
          <div className="pm-qc-list">
            {qc.slice(0, 8).map((r) => (
              <div key={r.id} className={`pm-qc-row is-${r.is_override ? "override" : r.result}`}>
                <span className="pm-qc-result">{r.is_override ? "Override" : r.result === "fail" ? "Failed" : "Passed"}</span>
                <span className="pm-qc-main">
                  <b>{r.which_qc === "final" ? "Final QC" : "QC 1"} · <span className="pm-code">{r.barcode}</span></b>
                  <small>{[formatDate(r.created_at), r.inspected_by, r.fail_reason && `Reason: ${r.fail_reason.trim()}`, r.outcome === "rework" && "Sent back for re-work", r.outcome === "dispose" && "Disposed"].filter(Boolean).join(" · ")}</small>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** One order in the side panel: where it stands, its pieces, and every action. */
function OrderDrawer({ order: o, ctx, onClose, onBack }) {
  const comps = ctx.componentsByOrder[o.id] || [];
  const live = comps.filter((c) => !c.cancelled_at);
  const finished = live.filter((c) => pieceState(c) === "finished").length;
  const status = orderStatus(o, comps);
  const left = daysLeft(o);
  const d = dueDay(o);
  const running = isRunning(o);
  const { actions } = ctx;
  const busy = (k) => actions.busy === `${o.id}-${k}`;
  const canAct = running && String(o.status || "").toLowerCase() !== "cancelled";
  const who = clientOf(o, ctx.vendorMap);
  return (
    <Drawer wide title={o.order_no} sub={[who, channelOf(o)].filter(Boolean).join(" · ")} onClose={onClose} onBack={onBack}>
      <div className="ceo-dstats">
        <Stat label="Status" info="Where the order stands, worked out from its pieces."><b>{status}</b></Stat>
        <Stat label="Due Date" info="The warehouse date: two days before the client's delivery date.">
          <b className={isLate(o) ? "is-warn" : undefined}>{d ? formatDate(d) : "–"}</b>
        </Stat>
        <Stat label={running && left != null && left < 0 ? "Late By" : "Days Left"} info="Calendar days to the due date, or past it.">
          <b className={isLate(o) ? "is-warn" : undefined}>{!running || left == null ? "–" : plural(Math.abs(left), "day")}</b>
        </Stat>
      </div>

      <div className="pm-progress">
        <div className="pm-progress-top"><span>{finished} of {live.length} pieces finished</span><b>{live.length ? Math.round((finished / live.length) * 100) : 0}%</b></div>
        <span className="pm-progress-bar"><i style={{ width: `${live.length ? (finished / live.length) * 100 : 0}%` }} /></span>
      </div>

      <div className="gm-actions">
        <button type="button" className="ceo-btn is-primary" onClick={() => ctx.openJourney(o)} disabled={!comps.length}><Icon name="movements" />View Journey</button>
        <button type="button" className="ceo-btn" onClick={() => actions.warehousePdf(o)} disabled={busy("pdf")}><Icon name="warehouse" />{busy("pdf") ? "Opening" : "Warehouse PDF"}</button>
        <button type="button" className="ceo-btn" onClick={() => actions.edit(o)} disabled={busy("edit")}><Icon name="edit" />Edit</button>
        <button type="button" className="ceo-btn" onClick={() => actions.priority(o)}><Icon name="alert" />{isUrgent(o) ? "Priority: Urgent" : "Set Priority"}</button>
        {canAct && <button type="button" className="ceo-btn" onClick={() => actions.complete(o)} disabled={busy("complete")}><Icon name="sale" />{busy("complete") ? "Completing" : "Mark as Completed"}</button>}
        <button type="button" className="ceo-btn" onClick={() => actions.override(o)} disabled={!comps.length}><Icon name="transfer" />Move or Override Pieces</button>
        <button type="button" className="ceo-btn" onClick={() => ctx.openOverrideLog(o)}><Icon name="doc" />Override History</button>
        {canAct && <button type="button" className="ceo-btn" onClick={() => actions.cancel(o)}><Icon name="close" />Cancel Order</button>}
      </div>
      <OrderChecks order={o} ctx={ctx} />
      {ctx.halfMade?.byOrder?.[o.id] && (
        <div className="pm-halfmade"><HalfMadeBadge order={o} suggestions={ctx.halfMade.byOrder[o.id]} by={ctx.halfMade.me?.email} onUsed={ctx.halfMade.reload} /></div>
      )}

      <div className="pm-od-grid">
      <div className="pm-od-col">
      <p className="pm-dsection">Pieces</p>
      <div className="pm-pieces">
        {!comps.length && <p className="ceo-muted">No barcoded pieces yet.</p>}
        {comps.map((c) => (
          <div key={c.id} className={`pm-piece is-${pieceState(c)}`}>
            <span className="pm-piece-main">
              <b>{pieceName(c)}</b>
              <small className="pm-code">{c.barcode}</small>
            </span>
            <span className="pm-piece-side">
              <span className="ceo-keep"><ComponentStageBadge comp={c} /></span>
              {c.is_outside_wh && <small>At {c.vendor_name || "vendor"}{c.stages_outside ? ` · ${getStagesOutsideLabel(c.stages_outside) || ""}` : ""}</small>}
            </span>
          </div>
        ))}
      </div>

      <p className="pm-dsection">Order Details</p>

      <dl className="ceo-dl">
        <dt>Channel</dt><dd>{channelOf(o)}</dd>
        {who && <><dt>Client</dt><dd>{who}</dd></>}
        <dt>Order Date</dt><dd>{formatDate(o.created_at)}</dd>
        {o.delivery_date && <><dt>Client Delivery Date</dt><dd>{formatDate(o.delivery_date)}</dd></>}
        {o.mode_of_delivery && <><dt>Delivery Mode</dt><dd>{o.mode_of_delivery}</dd></>}
        <dt>Priority</dt><dd>{isUrgent(o) ? "Urgent" : "Normal"}</dd>
        {o.salesperson && <><dt>Salesperson</dt><dd>{o.salesperson}</dd></>}
        {o.po_number && <><dt>PO Number</dt><dd>{o.po_number}</dd></>}
        {o.notes && <><dt>Production Notes</dt><dd>{o.notes}</dd></>}
        {o.cancellation_reason && <><dt>Cancellation Reason</dt><dd>{o.cancellation_reason}</dd></>}
        <dt>Pieces</dt><dd>{piecesLine(comps)}</dd>
        <dt>Pieces in total</dt><dd>{num(live.length)}</dd>
      </dl>
      </div>

      <div className="pm-od-col">
      <p className="pm-dsection">Products</p>
      <div className="pm-products">
        {(o.items || []).map((it, i) => (
          <div key={`${it.product_name}-${i}`} className="pm-product">
            <Thumb src={it.image_url} alt={it.product_name} large />
            <div className="pm-product-body">
              <b>{it.product_name || "–"}</b>
              <small>{[it.top && `${it.top}${it.top_color?.name ? ` (${it.top_color.name})` : ""}`, it.bottom && `${it.bottom}${it.bottom_color?.name ? ` (${it.bottom_color.name})` : ""}`, it.size && `Size ${it.size}`, Number(it.quantity) > 1 && `Qty ${it.quantity}`].filter(Boolean).join(" · ")}</small>
              {it.dupatta_color && <small>Dupatta: {typeof it.dupatta_color === "object" ? it.dupatta_color.name : it.dupatta_color}</small>}
              {Array.isArray(it.extras) && it.extras.length > 0 && <small>Extras: {it.extras.map((e) => `${e.name}${e.color?.name ? ` (${e.color.name})` : ""}`).join(", ")}</small>}
              {it.notes && <small>Note: {it.notes}</small>}
              <Measurements m={it.measurements} />
            </div>
          </div>
        ))}
      </div>
      </div>
      </div>
    </Drawer>
  );
}
