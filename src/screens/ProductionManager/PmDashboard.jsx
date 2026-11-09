import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import formatDate from "../../utils/formatDate";
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
import { fetchFullOrder, PM_ORDER_SELECT } from "../../utils/pmOrderColumns";
import { fetchExternalMovements } from "../../utils/externalMovements";
import { fetchQcRecords } from "../../utils/qcHistory";
import { fetchReJourneys } from "../../utils/reJourneys";
import { getStagesOutsideLabel } from "../../utils/barcodeService";
import Logo from "../../images/logo.png";
import { CalendarIcon, Drawer, GlobalSearch, Icon, MenuIcon, Thumb, num } from "../CeoDashboard/CeoUi";
import { Stat } from "../CeoDashboard/dashKit";
import "../CeoDashboard/CeoMakeover.css";
import "../GMDashboard/GmMakeover.css";
import "./PmMakeover.css";
import {
  channelOf, clientOf, daysLeft, dueDay, groupPieces, isLate, isRunning, isUrgent, loadOrderPieces, loadPmCore, loadQc, loadScans,
  loadDispatchScans, loadWaiting, pieceName, pieceState, plural,
} from "./pmModel";
import { OrdersTable, PiecesTable, orderStatus, piecesLine } from "./PmCommon";
import { PmCancelModal, PmEditOrderModal, PmPriorityModal } from "./PmModals";
import TodayPage from "./PmToday";
import OrdersPage from "./PmOrders";
import FloorPage from "./PmFloor";
import PlanningPage from "./PmPlanning";
import QualityPage from "./PmQuality";
import VendorsPage from "./PmVendors";
import DispatchPage from "./PmDispatch";
import PeoplePage from "./PmPeople";
import ApprovalsPage from "./PmApprovals";
import { CancellationsPage, ProfilePage, StockPage } from "./PmMore";

// ============================================================
// Production Manager dashboard. Everything the old dashboard did, in the
// building blocks of the CEO, GM and Comms dashboards, with no money and no
// client contact details. The old layout stays at
// /production-manager-dashboard/classic, linked from the menu.
// ============================================================

const NAV = [
  {
    group: "Run the Floor",
    items: [
      { id: "today", label: "Today", icon: "overview" },
      { id: "orders", label: "Orders", icon: "orders" },
      { id: "floor", label: "Floor & Flow", icon: "movements" },
      { id: "planning", label: "Planning", icon: "calendar" },
    ],
  },
  {
    group: "Watch",
    items: [
      { id: "quality", label: "Quality", icon: "integrity" },
      { id: "vendors", label: "Vendors", icon: "warehouse" },
      { id: "dispatch", label: "Dispatch & Delivery", icon: "transfer" },
    ],
  },
  {
    group: "Team",
    items: [
      { id: "people", label: "People", icon: "trend" },
      { id: "approvals", label: "Approvals", icon: "sale" },
      { id: "cancellations", label: "Cancellations", icon: "close" },
      { id: "stock", label: "Stock", icon: "stock" },
      { id: "profile", label: "Profile", icon: "doc" },
    ],
  },
];
// Old links (bookmarks, notifications) still land on the right page.
const TAB_ALIASES = {
  overview: "today", production: "floor", qc_history: "quality", rejourneys: "quality", delivery_report: "dispatch",
  dispatch_report: "dispatch", overrides: "approvals", override_log: "approvals", replacements: "approvals",
  vendor_delays: "vendors", calendar: "planning", staff: "people",
};
const CalIcon = () => <CalendarIcon />;

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

  const apply = useCallback(({ orders: o, components: c, vendorMap: v }) => {
    setOrders(o);
    setComponents(c);
    setVendorMap(v);
    setSyncedAt(new Date());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/login", { replace: true }); return; }
      // The role check and the data reads start together; nothing is shown
      // until the role check passes.
      const data = loadPmCore().catch((err) => ({ error: err }));
      const { data: sp } = await supabase.from("salesperson").select("*").eq("email", session.user.email?.toLowerCase()).maybeSingle();
      if (cancelled) return;
      if (!sp || sp.role !== "production_manager") {
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
        return;
      }
      setProfile(sp);
      const loaded = await data;
      if (cancelled) return;
      if (loaded.error) {
        console.error("Production data failed:", loaded.error);
        showPopup({ title: "Data Not Loaded", message: "The production data could not be loaded. Please refresh the page.", type: "error", confirmText: "Ok" });
      } else apply(loaded);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [navigate, apply]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Ask for a slower data set once; pages read it from ctx.lazy[key]. */
  const need = useCallback((key) => {
    if (started.current[key] || !LOADERS[key]) return;
    started.current[key] = true;
    setLazy((s) => ({ ...s, [key]: { loading: true, rows: null } }));
    LOADERS[key]()
      .then((rows) => setLazy((s) => ({ ...s, [key]: { loading: false, rows } })))
      .catch((err) => {
        console.error(`Loading ${key} failed:`, err);
        started.current[key] = false;
        setLazy((s) => ({ ...s, [key]: { loading: false, rows: null, error: err.message || "Could not load" } }));
      });
  }, []);
  // Today needs the requests, the vendor trips and a week of scans.
  useEffect(() => { if (!loading) { need("waiting"); need("movements"); need("scans8"); need("qc8"); } }, [loading, need]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      apply(await loadPmCore());
      const keys = Object.keys(started.current).filter((k) => started.current[k]);
      started.current = {};
      setLazy({});
      keys.forEach(need);
    } catch (err) {
      showPopup({ title: "Not Updated", message: "The data could not be updated. Please try again.", type: "error", confirmText: "Ok" });
    } finally { setRefreshing(false); }
  };

  const componentsByOrder = useMemo(() => groupPieces(components), [components]);
  const ordersById = useMemo(() => Object.fromEntries(orders.map((o) => [o.id, o])), [orders]);
  const halfMade = useHalfMadeSuggestions(orders);

  /** Update one order in place after an action. */
  const patchOrder = useCallback((fresh) => setOrders((prev) => prev.map((o) => (o.id === fresh.id ? { ...o, ...fresh } : o))), []);
  /** Re-read one order and its pieces (after Complete or Cancel) instead of everything. */
  const reloadOrder = useCallback(async (orderId) => {
    const [{ data: row }, pieces] = await Promise.all([
      supabase.from("orders").select(PM_ORDER_SELECT).eq("id", orderId).maybeSingle(),
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

  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/login"); };

  const pages = NAV.flatMap((g) => g.items);
  const ctx = {
    profile, email: profile?.email || "", orders, ordersById, components, componentsByOrder, piecesById, vendorMap, halfMade,
    lazy, need, syncedAt,
    openOrder, openOrders, openPieces, go, openJourney, showPopup, navigate,
    actions: { complete, cancel: setCancelling, edit, priority: setPrioritising, warehousePdf, busy },
  };
  const barcodeSearch = useMemo(() => components.filter((c) => c.barcode).map((c) => ({
    key: `b${c.id}`, kind: "Piece", label: c.barcode, meta: `${pieceName(c)} · ${c.order_no || ""}`, text: c.barcode,
    go: () => { const o = ordersById[c.order_id]; if (o) openOrder(o); },
  })), [components, ordersById, openOrder]);
  const userName = profile?.saleperson || "";
  const initials = (userName || "PM").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  const top = stack[stack.length - 1];
  const back = stack.length > 1 ? () => setStack((s) => s.slice(0, -1)) : undefined;
  const closeAll = () => setStack([]);

  return (
    <>
      {PopupComponent}
      <div className={`ceo gm pm${navOpen ? " is-nav-open" : ""}`}>
        {loading && (
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
            <button type="button" className="ceo-nav-item" onClick={() => navigate("/production-manager-dashboard/classic")}><Icon name="movements" />Old Production dashboard</button>
          </div>
          <div className="ceo-nav-foot">
            <div className="ceo-who">
              <span className="ceo-avatar">{initials}</span>
              <span><b title={userName}>{userName || profile?.email}</b><small>{syncedAt ? `Data updated ${syncedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : "Production Manager"}</small></span>
            </div>
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
              pages={pages} orders={orders} products={[]} clients={[]} extra={barcodeSearch}
              placeholder="Search an order, barcode or page"
              onPage={go} onOrder={openOrder} onClient={() => {}} onDesign={() => {}}
            />
            <div className="ceo-top-end">
              <span className="gm-top-actions">
                <button type="button" className="ceo-btn" onClick={() => go("approvals")} aria-label="Scan and overrides"><Icon name="edit" /><span>Scan & Override</span></button>
              </span>
              <NotificationBell userEmail={profile?.email} look="soft" onOrderClick={(id) => { const o = ordersById[id]; if (o) openOrder(o); }} />
            </div>
          </div>

          <div className="ceo-scroll">
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
                {activeTab === "approvals" && <ApprovalsPage ctx={ctx} />}
                {activeTab === "cancellations" && <CancellationsPage ctx={ctx} />}
                {activeTab === "stock" && <StockPage ctx={ctx} />}
                {activeTab === "profile" && <ProfilePage ctx={ctx} />}
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
            <OrdersTable ctx={ctx} title={top.title} orders={top.ids.map((id) => ordersById[id]).filter(Boolean)} />
          </Drawer>
        )}
        {top && top.type === "pieces" && (
          <Drawer wide title={top.title} sub={top.sub} onClose={closeAll} onBack={back}>
            <PiecesTable ctx={ctx} title={top.title} pieces={top.ids.map((id) => piecesById[id]).filter(Boolean)} />
          </Drawer>
        )}
        {top && top.type === "order" && ordersById[top.id] && (
          <OrderDrawer order={ordersById[top.id]} ctx={ctx} onClose={closeAll} onBack={back} />
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
    <Drawer title={o.order_no} sub={[who, channelOf(o)].filter(Boolean).join(" · ")} onClose={onClose} onBack={onBack}>
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
        {canAct && <button type="button" className="ceo-btn" onClick={() => actions.cancel(o)}><Icon name="close" />Cancel Order</button>}
      </div>
      {ctx.halfMade?.byOrder?.[o.id] && (
        <div className="pm-halfmade"><HalfMadeBadge order={o} suggestions={ctx.halfMade.byOrder[o.id]} by={ctx.halfMade.me?.email} onUsed={ctx.halfMade.reload} /></div>
      )}

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

      <p className="pm-dsection">Products</p>
      <div className="ceo-ditems">
        {(o.items || []).map((it, i) => (
          <div key={`${it.product_name}-${i}`} className="gm-item">
            <Thumb src={it.image_url} alt={it.product_name} />
            <span>
              <b>{it.product_name || "–"}</b>
              <small>{[it.top && `${it.top}${it.top_color?.name ? ` (${it.top_color.name})` : ""}`, it.bottom && `${it.bottom}${it.bottom_color?.name ? ` (${it.bottom_color.name})` : ""}`, it.size && `Size ${it.size}`, Number(it.quantity) > 1 && `Qty ${it.quantity}`].filter(Boolean).join(" · ")}</small>
              {Array.isArray(it.extras) && it.extras.length > 0 && <small>Extras: {it.extras.map((e) => `${e.name}${e.color?.name ? ` (${e.color.name})` : ""}`).join(", ")}</small>}
            </span>
          </div>
        ))}
      </div>

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
    </Drawer>
  );
}
