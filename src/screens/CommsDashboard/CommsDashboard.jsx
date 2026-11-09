import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { fetchAllRows } from "../../utils/fetchAllRows";
import formatDate from "../../utils/formatDate";
import { usePopup } from "../../components/Popup";
import useTabParam from "../../hooks/useTabParam";
import NotificationBell from "../../components/NotificationBell";
import LogoLoader from "../../components/LogoLoader";
import ComponentJourneyModal from "../../components/ComponentJourneyModal";
import ComponentStageBadge from "../../components/ComponentStageBadge";
import EditOrderModal from "../../components/EditOrderModal";
import CancelOrderModal from "../../components/CancelOrderModal";
import { enrichComponentsWithMovements } from "../../utils/barcodeService";
import { downloadCustomerPdf, downloadWarehousePdf } from "../../utils/pdfLazy";
import { usePeriodFilter, periodLabel, PERIOD_OPTIONS } from "../../components/PeriodFilter";
import { loadLedger, loadSales, loadStockOrders, loadStockRoomCatalogue } from "../StockRoom/stockRoomData";
import Logo from "../../images/logo.png";
import { shortInr } from "../CeoDashboard/ceoInsights";
import { CalendarIcon, Chips, DateRange, Drawer, FilterGroup, GlobalSearch, Icon, MenuIcon, Thumb, fullInr } from "../CeoDashboard/CeoUi";
import { Stat } from "../CeoDashboard/dashKit";
import "../CeoDashboard/CeoMakeover.css";
import "../GMDashboard/GmMakeover.css";
import "./CommsDashboard.css";
import "./CommsMakeover.css";
import {
  CalendarPage, CommsOrdersList, InventoryPage, OrdersPage, OverviewPage, PrPage, ReportsPage, SourcingPage, VendorsPage,
  canCancelOrder, canEditOrder, engagementTone, notionalOf, statusOf, windowExpiredMessage,
} from "./CommsPages";
import { RecipientDrawer } from "./CommsInsights";

// ============================================================
// Comms dashboard (Nazreen). The same pages as before, redrawn with the
// building blocks of Sheetal's and Anushree's dashboards. The previous layout
// stays at /comms-dashboard/classic, linked from the menu.
// ============================================================

const NAV = [
  {
    group: "Dashboard",
    items: [
      { id: "overview", label: "Overview", icon: "overview" },
      { id: "orders", label: "Orders", icon: "orders" },
      { id: "sourcing_returns", label: "Sourcing Returns", icon: "transfer" },
      { id: "pr_performance", label: "PR Performance", icon: "trend" },
    ],
  },
  {
    group: "Plan",
    items: [
      { id: "calendar", label: "Calendar", icon: "calendar" },
      { id: "inventory", label: "Inventory", icon: "stock" },
      { id: "reports", label: "Reports", icon: "doc" },
      { id: "vendors", label: "Vendor / External", icon: "warehouse" },
    ],
  },
];
// The two calendars are one page now; old links still open it.
const TAB_ALIASES = { order_calendar: "calendar", my_calendar: "calendar" };
const PERIOD_TABS = ["overview"];
const CalIcon = () => <CalendarIcon />;

export default function CommsDashboard() {
  const navigate = useNavigate();
  const { showPopup, PopupComponent } = usePopup();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [orders, setOrders] = useState([]);
  const [componentsByOrder, setComponentsByOrder] = useState({});
  const [prRecords, setPrRecords] = useState({});
  const [syncedAt, setSyncedAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [rawTab, setActiveTab] = useTabParam("overview");
  const activeTab = TAB_ALIASES[rawTab] || rawTab;
  const [navOpen, setNavOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const { range, inPeriod, timeline, props: periodProps } = usePeriodFilter("month");

  const [stack, setStack] = useState([]); // drawers: { type: "order" | "orders", ... }
  const [journey, setJourney] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [cancellingOrder, setCancellingOrder] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(null);
  const [eventSignal, setEventSignal] = useState(0); // the header's New Event button
  const [stockRoom, setStockRoom] = useState({ data: null, ledger: null, error: null, started: false });

  // Everything the dashboard shows, read side by side: orders, their pieces and
  // the PR records do not depend on each other (pieces are found by the Comms
  // order number, SB-COM-…), so nothing waits for anything else. Only the
  // vendor-trip lookup needs the pieces first.
  const fetchAll = useCallback(async () => {
    const [ordersRes, compsRes, prRes] = await Promise.all([
      fetchAllRows("orders", (q) => q.select("*").eq("is_comms", true).order("created_at", { ascending: false })),
      fetchAllRows("order_components", (q) => q
        .select("id, order_id, order_no, barcode, component_type, component_label, current_stage, previous_stage, item_index, is_outside_wh, stage_updated_at, disposition, disposition_reason, re_journey_count, stage_pass_counts")
        .like("order_no", "SB-COM-%")
        .order("id")),
      supabase.from("comms_pr_performance").select("*"),
    ]);
    if (ordersRes.error) throw ordersRes.error;
    const list = ordersRes.data || [];
    const ids = new Set(list.map((o) => o.id));
    const enriched = await enrichComponentsWithMovements((compsRes.data || []).filter((c) => ids.has(c.order_id)));
    const TYPE_ORDER = { top: 0, bottom: 1, dupatta: 2, extra: 3 };
    const comps = {};
    enriched.forEach((c) => { (comps[c.order_id] || (comps[c.order_id] = [])).push(c); });
    Object.values(comps).forEach((arr) => arr.sort((x, y) => (x.item_index ?? 0) - (y.item_index ?? 0) || (TYPE_ORDER[x.component_type] ?? 9) - (TYPE_ORDER[y.component_type] ?? 9)));
    const pr = {};
    (prRes.data || []).forEach((r) => { if (ids.has(r.order_id)) pr[r.order_id] = r; });
    return { list, comps, pr };
  }, []);
  const apply = useCallback(({ list, comps, pr }) => {
    setOrders(list);
    setComponentsByOrder(comps);
    setPrRecords(pr);
    setSyncedAt(new Date());
  }, []);
  const loadOrders = useCallback(async () => apply(await fetchAll()), [fetchAll, apply]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/login", { replace: true }); return; }
      // The role check and the data reads start together; nothing is shown
      // until the role check passes.
      const data = fetchAll().catch((err) => ({ error: err }));
      const { data: sp } = await supabase
        .from("salesperson")
        .select("email, role, saleperson, phone, designation, store_name")
        .eq("email", session.user.email?.toLowerCase())
        .maybeSingle();
      if (cancelled) return;
      if (!sp || sp.role !== "comms") {
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
        return;
      }
      setProfile(sp);
      const loaded = await data;
      if (cancelled) return;
      if (loaded.error) {
        console.error("Comms data failed:", loaded.error);
        showPopup({ title: "Data Not Loaded", message: "The Comms orders could not be loaded. Please refresh the page.", type: "error", confirmText: "Ok" });
      } else apply(loaded);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [navigate, fetchAll, apply]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stock Room's catalogue, locations and 90 days of sales: loaded the first time
  // Inventory opens, the same reads Stock Room makes, so stock always matches it.
  useEffect(() => {
    if (activeTab !== "inventory" || stockRoom.started) return;
    setStockRoom((s) => ({ ...s, started: true }));
    (async () => {
      try {
        const [catalogue, stockOrders, ledger] = await Promise.all([
          loadStockRoomCatalogue(), loadStockOrders(),
          loadLedger().catch(() => ({ installed: false })),
        ]);
        setStockRoom({ started: true, error: null, ledger, data: { ...catalogue, stockOrders, recentOrders: [], ordersReady: true, salesReady: false } });
        const recent = await loadSales(90);
        setStockRoom((s) => ({ ...s, data: { ...s.data, recentOrders: recent, salesReady: true } }));
      } catch (err) {
        console.error("Stock Room data failed:", err);
        setStockRoom({ started: true, data: null, ledger: null, error: err.message || "unknown error" });
      }
    })();
  }, [activeTab, stockRoom.started]);

  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/login"); };
  const refresh = async () => {
    setRefreshing(true);
    await loadOrders();
    setStockRoom({ data: null, ledger: null, error: null, started: false });
    setRefreshing(false);
  };

  const ordersById = useMemo(() => Object.fromEntries(orders.map((o) => [o.id, o])), [orders]);
  const replaceOrder = (fresh) => setOrders((prev) => prev.map((o) => (o.id === fresh.id ? { ...o, ...fresh } : o)));
  const open = (layer) => setStack((s) => [...s, layer]);
  const openOrder = (order) => open({ type: "order", id: order.id });
  const openOrders = ({ title, sub, orders: list }) => open({ type: "orders", title, sub, ids: list.map((o) => o.id) });
  const openRecipient = (name) => open({ type: "recipient", name });
  const go = (id) => { setActiveTab(id); setNavOpen(false); setStack([]); };

  const makePdf = async (order, type) => {
    setPdfBusy(`${order.id}-${type}`);
    try {
      if (type === "warehouse") {
        const result = await downloadWarehousePdf(order, null, false);
        if (result) {
          const urls = Array.isArray(result) ? result : [result];
          replaceOrder({ id: order.id, warehouse_urls: urls, warehouse_url: urls[0] });
        }
      } else await downloadCustomerPdf(order);
    } catch (err) {
      console.error("PDF failed:", err);
      showPopup({ title: "PDF Not Opened", message: "The PDF could not be opened. Please try again.", type: "error", confirmText: "Ok" });
    } finally { setPdfBusy(null); }
  };
  const openJourney = (order) => {
    const comps = componentsByOrder[order.id] || [];
    if (!comps.length) {
      showPopup({ title: "No Pieces Yet", message: `${order.order_no} has no barcoded pieces yet, so there is no production journey to show.`, type: "info", confirmText: "Ok" });
      return;
    }
    setJourney({ orderNo: order.order_no, components: comps });
  };

  const periodName = timeline === "custom" && range ? `${formatDate(range.start)} to ${formatDate(range.end)}` : periodLabel(timeline);
  const pages = NAV.flatMap((g) => g.items);
  const ctx = {
    orders, ordersById, componentsByOrder, prRecords, setPrRecords, profile, stockRoom,
    inPeriod, range, periodName,
    openOrder, openOrders, openRecipient, go, notionalOf, statusOf, openJourney, makePdf, pdfBusy, replaceOrder, showPopup, navigate, eventSignal,
    newOrder: () => navigate("/comms-order-form"),
  };
  const userName = profile?.saleperson || "";
  const initials = (userName || "CM").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  const top = stack[stack.length - 1];

  return (
    <>
      {PopupComponent}
      <div className={`ceo gm comms${navOpen ? " is-nav-open" : ""}`}>
        {loading && (
          <div className="ceo-welcome" role="status">
            <LogoLoader />
            <p className="ceo-welcome-state">Bringing your orders together</p>
          </div>
        )}

        <button type="button" className="ceo-nav-veil" aria-label="Close menu" onClick={() => setNavOpen(false)} />
        <nav className="ceo-nav" aria-label="Comms dashboard">
          <button type="button" className="ceo-logo" onClick={() => go("overview")} aria-label="Home"><img src={Logo} alt="Sheetal Batra" /></button>
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
            <button type="button" className="ceo-nav-item" onClick={() => navigate("/comms-order-form")}><Icon name="plus" />New Comms Order</button>
            <button type="button" className="ceo-nav-item" onClick={() => navigate("/comms-dashboard/classic")}><Icon name="movements" />Old Comms dashboard</button>
          </div>
          <div className="ceo-nav-foot">
            <div className="ceo-who">
              <span className="ceo-avatar">{initials}</span>
              <span><b title={userName}>{userName || profile?.email}</b><small>{syncedAt ? `Data updated ${syncedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : "Communications"}</small></span>
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
            <GlobalSearch pages={pages} orders={orders} products={[]} clients={[]} onPage={go} onOrder={openOrder} onClient={() => {}} onDesign={() => {}} />
            {PERIOD_TABS.includes(activeTab) && (
              <button type="button" className="ceo-view" onClick={() => setViewOpen(true)}>
                <CalendarIcon />
                <b>{periodName}</b>
                <span>Order date</span>
              </button>
            )}
            <div className="ceo-top-end">
              <span className="gm-top-actions">
                {activeTab === "calendar" && <button type="button" className="ceo-btn" onClick={() => setEventSignal((n) => n + 1)} aria-label="New event"><Icon name="plus" /><span>New Event</span></button>}
                <button type="button" className="ceo-btn is-primary" onClick={() => navigate("/comms-order-form")} aria-label="New Comms order"><Icon name="plus" /><span>New Comms Order</span></button>
              </span>
              <NotificationBell userEmail={profile?.email} look="soft" />
            </div>
          </div>

          <div className="ceo-scroll">
            {!loading && (
              <>
                {activeTab === "overview" && <OverviewPage ctx={ctx} />}
                {activeTab === "orders" && <OrdersPage ctx={ctx} />}
                {activeTab === "sourcing_returns" && <SourcingPage ctx={ctx} />}
                {activeTab === "pr_performance" && <PrPage ctx={ctx} />}
                {activeTab === "calendar" && <CalendarPage ctx={ctx} />}
                {activeTab === "inventory" && <InventoryPage ctx={ctx} />}
                {activeTab === "reports" && <ReportsPage ctx={ctx} />}
                {activeTab === "vendors" && <VendorsPage ctx={ctx} />}
              </>
            )}
          </div>

          <div className="ceo-tabbar">
            {[["overview", "Overview", "overview"], ["orders", "Orders", "orders"], ["sourcing_returns", "Returns", "transfer"], ["calendar", "Calendar", "calendar"]].map(([id, label, icon]) => (
              <button key={id} type="button" aria-current={activeTab === id ? "page" : undefined} onClick={() => go(id)}>{icon === "calendar" ? <CalIcon /> : <Icon name={icon} />}{label}</button>
            ))}
            <button type="button" onClick={() => setNavOpen(true)}><MenuIcon />More</button>
          </div>
        </main>

        {viewOpen && (
          <Drawer
            title="Dashboard Filters"
            sub="The Overview follows this period"
            onClose={() => setViewOpen(false)}
            footer={(
              <>
                <button type="button" className="ceo-btn" onClick={() => { periodProps.setTimeline("month"); periodProps.setCustomFrom(""); periodProps.setCustomTo(""); }}>Reset Filters</button>
                <button type="button" className="ceo-btn is-primary" onClick={() => setViewOpen(false)}>Done</button>
              </>
            )}
          >
            <FilterGroup label="Order Date">
              <Chips options={PERIOD_OPTIONS.map((o) => ({ value: o.value, label: o.value === "custom" ? "Choose dates" : o.label }))} value={timeline} onChange={(v) => periodProps.setTimeline(v || "month")} />
              {timeline === "custom" && <DateRange from={periodProps.customFrom} to={periodProps.customTo} onChange={(a, b) => { periodProps.setCustomFrom(a); periodProps.setCustomTo(b); }} />}
            </FilterGroup>
          </Drawer>
        )}

        {top && top.type === "orders" && (
          <Drawer wide title={top.title} sub={top.sub} onClose={() => setStack([])} onBack={stack.length > 1 ? () => setStack((s) => s.slice(0, -1)) : undefined}>
            <CommsOrdersList ctx={ctx} title={top.title} orders={top.ids.map((id) => ordersById[id]).filter(Boolean)} />
          </Drawer>
        )}
        {top && top.type === "recipient" && (
          <RecipientDrawer ctx={ctx} name={top.name} onClose={() => setStack([])} onBack={stack.length > 1 ? () => setStack((s) => s.slice(0, -1)) : undefined} />
        )}
        {top && top.type === "order" && ordersById[top.id] && (
          <CommsOrderDrawer
            order={ordersById[top.id]}
            ctx={ctx}
            onEdit={setEditingOrder}
            onCancel={setCancellingOrder}
            onClose={() => setStack([])}
            onBack={stack.length > 1 ? () => setStack((s) => s.slice(0, -1)) : undefined}
          />
        )}
      </div>

      {journey && createPortal(
        <ComponentJourneyModal orderNo={journey.orderNo} components={journey.components} onClose={() => setJourney(null)} />,
        document.body,
      )}
      {editingOrder && createPortal(
        <EditOrderModal
          order={editingOrder}
          onClose={() => setEditingOrder(null)}
          onSaved={(fresh) => replaceOrder(fresh)}
          showPopup={showPopup}
          notifyCustomer={false}
          requireReason
          reasonSource="comms"
          editedBy={profile?.email || null}
          recheck={windowExpiredMessage}
        />,
        document.body,
      )}
      {cancellingOrder && createPortal(
        <CancelOrderModal
          order={cancellingOrder}
          onClose={() => setCancellingOrder(null)}
          onCancelled={(order, reason) => replaceOrder({ id: order.id, status: "cancelled", cancellation_reason: reason })}
          showPopup={showPopup}
          opts={{ cancelledBy: profile?.saleperson || "", email: profile?.email || "" }}
          recheck={windowExpiredMessage}
        />,
        document.body,
      )}
    </>
  );
}

/** One Comms order in the side panel: who it is for, why, its pieces, and what can be done. */
function CommsOrderDrawer({ order: o, ctx, onEdit, onCancel, onClose, onBack }) {
  const comps = ctx.componentsByOrder[o.id] || [];
  const status = statusOf(o, comps);
  const pieces = (o.items || []).reduce((s, it) => s + (Number(it.quantity) || 1), 0);
  const tone = engagementTone(o.comms_engagement_type);
  return (
    <Drawer title={o.order_no} sub={o.delivery_name || o.comms_agency_name || "–"} onClose={onClose} onBack={onBack}>
      <div className="ceo-dstats">
        <Stat label="Notional Value" info="The outfit's full price, including extras."><b title={fullInr(notionalOf(o))}>{shortInr(notionalOf(o))}</b></Stat>
        <Stat label="Pieces" info="Garments in this order."><b>{pieces || 1}</b></Stat>
        <Stat label="Status" info="Where the order stands now."><b className={status === "Cancelled" || status === "Rejected" ? "is-warn" : undefined}>{status}</b></Stat>
      </div>
      <div className="gm-actions">
        <button type="button" className="ceo-btn" onClick={() => ctx.openJourney(o)} disabled={!comps.length}><Icon name="movements" />View Journey</button>
        <button type="button" className="ceo-btn" onClick={() => ctx.makePdf(o, "customer")} disabled={ctx.pdfBusy === `${o.id}-customer`}><Icon name="doc" />{ctx.pdfBusy === `${o.id}-customer` ? "Opening" : "Customer PDF"}</button>
        <button type="button" className="ceo-btn" onClick={() => ctx.makePdf(o, "warehouse")} disabled={ctx.pdfBusy === `${o.id}-warehouse`}><Icon name="warehouse" />{ctx.pdfBusy === `${o.id}-warehouse` ? "Opening" : "Warehouse PDF"}</button>
        {canEditOrder(o, comps) && <button type="button" className="ceo-btn" onClick={() => onEdit(o)}><Icon name="edit" />Edit Order</button>}
        {canCancelOrder(o, comps) && <button type="button" className="ceo-btn" onClick={() => onCancel(o)}><Icon name="close" />Cancel Order</button>}
      </div>
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
      {comps.length > 0 && (
        <div className="comms-chips">
          {comps.map((c) => (
            <span key={c.id} className="comms-chip-piece"><b>{c.component_label || c.component_type}</b><ComponentStageBadge comp={c} /></span>
          ))}
        </div>
      )}
      <dl className="ceo-dl">
        <dt>Engagement</dt><dd><i className={`ceo-pill comms-eng is-${tone}`}>{o.comms_engagement_type || "–"}</i></dd>
        <dt>Recipient</dt><dd>{o.delivery_name ? <button type="button" className="ceo-inline" onClick={() => ctx.openRecipient(o.delivery_name)}>{o.delivery_name}</button> : "–"}</dd>
        {o.comms_purpose && <><dt>Purpose</dt><dd>{o.comms_purpose}</dd></>}
        {o.comms_agency_name && <><dt>Agency</dt><dd>{o.comms_agency_name}</dd></>}
        {o.comms_poc_name && <><dt>Point of Contact</dt><dd>{o.comms_poc_name}</dd></>}
        {o.delivery_phone && <><dt>Phone</dt><dd>{o.delivery_phone}</dd></>}
        <dt>Order Date</dt><dd>{formatDate(o.created_at)}</dd>
        {o.delivery_date && <><dt>Delivery Date</dt><dd>{formatDate(o.delivery_date)}</dd></>}
        {o.comms_engagement_type === "Sourcing" && <><dt>Return Date</dt><dd>{o.comms_outfit_return_date ? formatDate(o.comms_outfit_return_date) : "–"}{o.comms_return_status ? ` · ${o.comms_return_status}` : ""}</dd></>}
        {o.cancellation_reason && <><dt>Cancellation Reason</dt><dd>{o.cancellation_reason}</dd></>}
      </dl>
      <p className="ceo-muted comms-note">Edit and Cancel are available for 48 hours after the order is placed, while production has not started.</p>
    </Drawer>
  );
}
