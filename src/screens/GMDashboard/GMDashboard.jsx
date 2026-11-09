import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { fetchAllRows } from "../../utils/fetchAllRows";
import { isSaleOrder } from "../../utils/revenue";
import formatDate from "../../utils/formatDate";
import { downloadCustomerPdf, downloadWarehousePdf } from "../../utils/pdfLazy";
import { usePopup } from "../../components/Popup";
import useTabParam from "../../hooks/useTabParam";
import NotificationBell from "../../components/NotificationBell";
import ComponentJourneyModal from "../../components/ComponentJourneyModal";
import UpdatePaymentModal from "../../components/UpdatePaymentModal";
import { b2bPaymentState, canUpdateB2bPayment, paymentRecordedPopup, recordPayment } from "../../utils/recordPayment";
import { enrichComponentsWithMovements, getOrderChannelLabel, getOrderStatusLabel, getStageLabel } from "../../utils/barcodeService";
import { usePeriodFilter, comparisonPeriodRange, periodLabel, PERIOD_OPTIONS } from "../../components/PeriodFilter";
import { startOrderMode } from "../../utils/orderMode";
import { cleanMerchandiserName } from "../../utils/merchandiserName";
import { loadLedger, loadSales, loadStockOrders, loadStockRoomCatalogue } from "../StockRoom/stockRoomData";
import Logo from "../../images/logo.png";
import LogoLoader from "../../components/LogoLoader";
import { shortInr } from "../CeoDashboard/ceoInsights";
import { CalendarIcon, Chips, DateRange, Drawer, FilterGroup, GlobalSearch, Icon, MenuIcon, Select, Thumb, fullInr } from "../CeoDashboard/CeoUi";
import "../CeoDashboard/CeoMakeover.css";
import "./GMDashboard.css";
import "./GmMakeover.css";
import {
  AccountsPage, B2bPage, DeliveryPage, ExhibitionsPage, InventoryPage, OrdersList, OrdersPage, OutstandingPage,
  OverridePage, ReturnsPage, StorePerformancePage, PaymentPill, Stat, journeyLine,
} from "./GmPages";

// ============================================================
// GM (Anushree) dashboard. Same pages and figures as before, drawn with the
// building blocks of Sheetal's dashboard. Inventory Health reads Stock Room's
// own tables, so its counts always match Stock Room.
// ============================================================

const COMPARISON_OPTIONS = [
  { value: "none", label: "No comparison" },
  { value: "previous_period", label: "Previous period" },
  { value: "previous_year", label: "Previous year" },
];

// Icons the Stock Room set has no match for.
const ApprovalIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1M9 13l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const DeliveryIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M2 7h11v9H2zM13 10h4l3 3v3h-7" strokeLinejoin="round" /><circle cx="6" cy="17.5" r="1.8" /><circle cx="16.5" cy="17.5" r="1.8" />
  </svg>
);
const CUSTOM_ICONS = { approval: ApprovalIcon, delivery: DeliveryIcon };

const NAV = [
  {
    group: "Dashboard",
    items: [
      { id: "store_performance", label: "Store Performance", icon: "overview" },
      { id: "b2b_overview", label: "B2B Overview", icon: "transfer" },
      { id: "outstanding", label: "Client Outstanding", icon: "inr" },
      { id: "inventory", label: "Inventory Health", icon: "products" },
      { id: "returns", label: "Returns & Analytics", icon: "receive" },
    ],
  },
  {
    group: "Operations",
    items: [
      { id: "orders", label: "Orders", icon: "orders" },
      { id: "delivery_watch", label: "Delivery Watch", icon: "delivery" },
      { id: "accounts", label: "Accounts", icon: "doc" },
      { id: "exhibition_approvals", label: "Exhibition Approvals", icon: "approval" },
      { id: "override_log", label: "Override Log", icon: "movements" },
    ],
  },
];
// Day-wise Sales is now part of Store Performance, and Stock part of Inventory
// Health; old links to either still open the right page.
const TAB_ALIASES = { day_sales: "store_performance", stock: "inventory" };
const PERIOD_TABS = ["store_performance", "b2b_overview", "returns"];
// Names that sit in the salesperson column but are not people.
const NOT_PEOPLE = /^(exhibitions?|private( order)?|website|shopify|online|b2b|comms|stock|-|unknown)$/i;

export default function GMDashboard() {
  const navigate = useNavigate();
  const { showPopup, PopupComponent } = usePopup();

  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [salespersonTable, setSalespersonTable] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [consignment, setConsignment] = useState([]);
  const [monthlyTargets, setMonthlyTargets] = useState([]);
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [syncedAt, setSyncedAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [rawTab, setActiveTab] = useTabParam("store_performance");
  const activeTab = TAB_ALIASES[rawTab] || rawTab;
  const [navOpen, setNavOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const { range, inPeriod, timeline, props: periodProps } = usePeriodFilter("month");
  const [comparison, setComparison] = useState("none");

  const [stack, setStack] = useState([]); // drawers: { type: "order" | "orders", ... }
  const [journey, setJourney] = useState(null); // { orderNo, components } | { loading }
  const [paymentOrder, setPaymentOrder] = useState(null);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(null);
  const [stockRoom, setStockRoom] = useState({ data: null, error: null, started: false });

  const fetchAllData = useCallback(async () => {
    try {
      const [ordersRes, spRes, vendorsRes, consignmentRes, targetsRes] = await Promise.all([
        fetchAllRows("orders", (q) => q.select("*").order("created_at", { ascending: false })),
        supabase.from("salesperson").select("saleperson, role, email, phone, store_name, sales_target, designation"),
        supabase.from("vendors").select("*"),
        supabase.from("consignment_inventory").select("*"),
        supabase.from("sa_monthly_targets").select("salesperson_email, target_amount, year, month"),
      ]);
      if (targetsRes?.data) setMonthlyTargets(targetsRes.data);
      if (ordersRes.data) setOrders(ordersRes.data.filter((o) => !o.is_comms));
      if (spRes.data) setSalespersonTable(spRes.data);
      if (vendorsRes.data) setVendors(vendorsRes.data);
      if (consignmentRes.data) setConsignment(consignmentRes.data);
      setSyncedAt(new Date());
    } catch (err) { console.error("Error fetching data:", err); }
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/login", { replace: true }); return; }
      const { data: userRecord } = await supabase
        .from("salesperson")
        .select("saleperson, role, email, phone, store_name, designation, can_place_stock_orders")
        .eq("email", session.user.email?.toLowerCase())
        .single();
      if (!userRecord || userRecord.role !== "gm") {
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
        return;
      }
      setCurrentUserEmail(session.user.email?.toLowerCase() || "");
      setCurrentUserProfile(userRecord);
      await fetchAllData();
      setLoading(false);
    })();
  }, [navigate, fetchAllData]);

  // Stock Room's catalogue, stock orders, locations and 90 days of sales: loaded
  // the first time Inventory Health or Stock opens, the same reads Stock Room makes.
  useEffect(() => {
    if (activeTab !== "inventory" || stockRoom.started) return;
    setStockRoom((s) => ({ ...s, started: true }));
    (async () => {
      try {
        const [catalogue, stockOrders, ledger] = await Promise.all([
          loadStockRoomCatalogue(), loadStockOrders(),
          loadLedger().catch((err) => { console.error("Stock Room locations failed:", err); return { installed: false }; }),
        ]);
        setStockRoom({ started: true, error: null, ledger, data: { ...catalogue, stockOrders, recentOrders: [], ordersReady: true, salesReady: false } });
        const recent = await loadSales(90);
        setStockRoom((s) => ({ ...s, data: { ...s.data, recentOrders: recent, salesReady: true } }));
      } catch (err) {
        console.error("Stock Room data failed:", err);
        setStockRoom({ started: true, data: null, error: err.message || "unknown error" });
      }
    })();
  }, [activeTab, stockRoom.started]);

  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/login"); };
  const refresh = async () => {
    setRefreshing(true);
    await fetchAllData();
    setStockRoom({ data: null, error: null, started: false });
    setRefreshing(false);
  };

  const saveAssociateSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) sessionStorage.setItem("associateSession", JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token, user: { email: session.user?.email } }));
  };

  // Stock-order entry, same flow as the SA dashboard. Gated on can_place_stock_orders.
  const handleStartStockOrder = async () => {
    if (!currentUserProfile) {
      showPopup({ title: "Access Denied", message: "User profile not loaded. Please refresh and try again.", type: "error", confirmText: "Ok" });
      return;
    }
    await saveAssociateSession();
    sessionStorage.setItem("returnToAssociate", "true");
    // Back to the GM dashboard after the order: OrderPlaced otherwise goes to
    // /AssociateDashboard, whose role check logs out non-SA users.
    sessionStorage.setItem("returnDashboard", "/gm-dashboard");
    sessionStorage.setItem("requirePasswordVerificationOnReturn", "true");
    sessionStorage.setItem("currentSalesperson", JSON.stringify({
      name: currentUserProfile.saleperson, email: currentUserProfile.email, phone: currentUserProfile.phone,
      store: currentUserProfile.store_name, designation: currentUserProfile.designation,
    }));
    startOrderMode("stock");
    navigate("/product", { state: { fromAssociate: true, isStockOrder: true } });
  };

  const startPlaceOrder = async () => {
    await saveAssociateSession();
    // The resolved store, verbatim. ReviewDetail.js refuses the write if it is empty.
    sessionStorage.setItem("currentSalesperson", JSON.stringify({ store: currentUserProfile?.store_name || "", name: currentUserProfile?.saleperson || "", email: currentUserEmail }));
    sessionStorage.setItem("returnDashboard", "/gm-dashboard");
    // A regular client order: drop any stale stock/comms/exhibition flag.
    startOrderMode("client");
    navigate("/buyerVerification");
  };

  // ---------------------------------------------------------- shared rules
  const vendorById = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors]);
  const vendorName = useCallback((o) => vendorById[o.vendor_id]?.store_brand_name || o.delivery_name || "Unknown partner", [vendorById]);
  // B2B orders carry no delivery name: the partner is the client there.
  const clientOf = useCallback((o) => {
    if (o.is_b2b) return vendorById[o.vendor_id]?.store_brand_name || o.delivery_name || "B2B partner";
    return o.delivery_name || o.billing_name || "–";
  }, [vendorById]);
  const personOf = useCallback((o) => {
    if (o.is_b2b || String(o.salesperson_store || "").toLowerCase() === "b2b") return cleanMerchandiserName(o.merchandiser_name || o.salesperson) || null;
    return o.salesperson || null;
  }, []);
  const storeNames = useMemo(() => new Set(orders.map((o) => String(o.salesperson_store || "").trim()).filter(Boolean)), [orders]);
  const isPerson = useCallback((name) => !!name && !storeNames.has(String(name).trim()) && !NOT_PEOPLE.test(String(name).trim()), [storeNames]);

  const prevRange = useMemo(() => comparisonPeriodRange(range, "previous_period"), [range]);
  const compRange = useMemo(() => comparisonPeriodRange(range, comparison), [range, comparison]);
  const sales = useMemo(() => orders.filter((o) => isSaleOrder(o) && inPeriod(o.created_at)), [orders, inPeriod]);
  const prevSales = useMemo(() => (compRange ? orders.filter((o) => {
    if (!isSaleOrder(o) || !o.created_at) return false;
    const t = new Date(o.created_at);
    return t >= compRange.start && t <= compRange.end;
  }) : []), [orders, compRange]);
  const periodName = timeline === "custom" && range ? `${formatDate(range.start)} to ${formatDate(range.end)}` : periodLabel(timeline);
  const compareName = comparison !== "none" && range ? COMPARISON_OPTIONS.find((c) => c.value === comparison)?.label : "";

  // ---------------------------------------------------------- actions
  const open = (layer) => setStack((s) => [...s, layer]);
  const openOrder = (order) => open({ type: "order", id: order.id });
  const openOrders = ({ title, sub, orders: list, b2b }) => open({ type: "orders", title, sub, ids: list.map((o) => o.id), b2b });

  const makePdf = async (order, type) => {
    setPdfBusy(order.id);
    try {
      if (type === "warehouse") await downloadWarehousePdf(order, null, true);
      else await downloadCustomerPdf(order);
    } catch (err) {
      console.error("PDF generation failed:", err);
      showPopup({ title: "PDF Not Created", message: "The PDF could not be made. Please try again.", type: "error", confirmText: "Ok" });
    } finally { setPdfBusy(null); }
  };

  // Each piece's own journey, the same view the production dashboards show.
  const openJourney = async (order) => {
    setJourney({ loading: true, orderNo: order.order_no });
    // The same columns the B2B merchandiser's journey view reads.
    const { data, error } = await supabase
      .from("order_components")
      .select("id, order_id, barcode, component_type, component_label, current_stage, previous_stage, item_index, is_outside_wh, re_journey_count, stage_pass_counts")
      .eq("order_id", order.id)
      .order("created_at", { ascending: true });
    if (error) {
      setJourney(null);
      showPopup({ title: "Journey Not Loaded", message: error.message, type: "error", confirmText: "Ok" });
      return;
    }
    if (!data?.length) {
      setJourney(null);
      showPopup({ title: "No Pieces Yet", message: `${order.order_no} has no barcoded pieces yet, so there is no production journey to show.${order.is_b2b && order.approval_status !== "approved" ? " B2B pieces are created when the order is approved." : ""}`, type: "info", confirmText: "Ok" });
      return;
    }
    setJourney({ orderNo: order.order_no, components: await enrichComponentsWithMovements(data) });
  };

  const handleB2bPayment = async (payment) => {
    if (!paymentOrder) return;
    setPaymentSaving(true);
    try {
      const result = await recordPayment(paymentOrder, payment, currentUserEmail || null);
      if (result.fresh) setOrders((prev) => prev.map((o) => (o.id === result.fresh.id ? { ...o, ...result.fresh } : o)));
      setPaymentOrder(null);
      showPopup({ ...paymentRecordedPopup(result), confirmText: "Ok" });
    } catch (err) {
      console.error("B2B payment failed:", err);
      showPopup({ title: "Payment Not Recorded", message: err?.message || "The payment could not be saved. Nothing was recorded.", type: "error", confirmText: "Ok" });
    } finally { setPaymentSaving(false); }
  };

  const go = (id) => { setActiveTab(id); setNavOpen(false); setStack([]); };
  const pages = NAV.flatMap((g) => g.items);
  const ctx = {
    orders, sales, prevSales, inPeriod, range, prevRange, periodName, compareName,
    salespersonTable, monthlyTargets, consignment, currentUserProfile, currentUserEmail, stockRoom,
    channelOf: getOrderChannelLabel, personOf, isPerson, clientOf, vendorName,
    openOrder, openOrders, openJourney, makePdf, pdfBusy, payB2b: setPaymentOrder, startPlaceOrder, navigate,
  };

  const userName = currentUserProfile?.saleperson || "";
  const initials = (userName || "GM").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  const top = stack[stack.length - 1];
  const ordersById = useMemo(() => Object.fromEntries(orders.map((o) => [o.id, o])), [orders]);

  return (
    <>
      {PopupComponent}
      <div className={`ceo gm${navOpen ? " is-nav-open" : ""}`}>
        {loading && (
          <div className="ceo-welcome" role="status">
            <LogoLoader />
            <p className="ceo-welcome-state">Bringing your numbers together</p>
          </div>
        )}

        <button type="button" className="ceo-nav-veil" aria-label="Close menu" onClick={() => setNavOpen(false)} />
        <nav className="ceo-nav" aria-label="GM dashboard">
          <button type="button" className="ceo-logo" onClick={() => go("store_performance")} aria-label="Home"><img src={Logo} alt="Sheetal Batra" /></button>
          {NAV.map((g) => (
            <div className="ceo-nav-group" key={g.group}>
              <span className="ceo-label ceo-nav-title">{g.group}</span>
              {g.items.map((item) => (
                <button key={item.id} type="button" className="ceo-nav-item" aria-current={activeTab === item.id ? "page" : undefined} onClick={() => go(item.id)}>
                  {CUSTOM_ICONS[item.icon] ? React.createElement(CUSTOM_ICONS[item.icon]) : <Icon name={item.icon} />}{item.label}
                </button>
              ))}
              {g.group === "Operations" && currentUserProfile?.can_place_stock_orders && (
                <button type="button" className="ceo-nav-item" onClick={() => { setNavOpen(false); handleStartStockOrder(); }}><Icon name="plus" />Stock Order</button>
              )}
            </div>
          ))}
          <div className="ceo-nav-foot">
            <div className="ceo-who">
              <span className="ceo-avatar">{initials}</span>
              <span><b title={userName}>{userName || currentUserEmail}</b><small>{syncedAt ? `Data updated ${syncedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : "General Manager"}</small></span>
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
                <span>{compareName ? `vs ${compareName.toLowerCase()}` : "No comparison"}</span>
              </button>
            )}
            <div className="ceo-top-end"><NotificationBell userEmail={currentUserEmail} look="soft" /></div>
          </div>

          <div className="ceo-scroll">
            {!loading && (
              <>
                {activeTab === "store_performance" && <StorePerformancePage ctx={ctx} />}
                {activeTab === "b2b_overview" && <B2bPage ctx={ctx} />}
                {activeTab === "outstanding" && <OutstandingPage ctx={ctx} />}
                {activeTab === "inventory" && <InventoryPage ctx={ctx} />}
                {activeTab === "returns" && <ReturnsPage ctx={ctx} />}
                {activeTab === "orders" && <OrdersPage ctx={ctx} />}
                {activeTab === "delivery_watch" && <DeliveryPage ctx={ctx} />}
                {activeTab === "accounts" && <AccountsPage ctx={ctx} />}
                {activeTab === "exhibition_approvals" && <ExhibitionsPage ctx={ctx} />}
                {activeTab === "override_log" && <OverridePage />}
              </>
            )}
          </div>

          <div className="ceo-tabbar">
            {[["store_performance", "Stores", "overview"], ["b2b_overview", "B2B", "transfer"], ["orders", "Orders", "orders"], ["inventory", "Inventory", "products"]].map(([id, label, icon]) => (
              <button key={id} type="button" aria-current={activeTab === id ? "page" : undefined} onClick={() => go(id)}><Icon name={icon} />{label}</button>
            ))}
            <button type="button" onClick={() => setNavOpen(true)}><MenuIcon />More</button>
          </div>
        </main>

        {viewOpen && (
          <Drawer
            title="Dashboard Filters"
            sub="Store Performance, B2B Overview and Returns follow these choices"
            onClose={() => setViewOpen(false)}
            footer={(
              <>
                <button type="button" className="ceo-btn" onClick={() => { periodProps.setTimeline("month"); periodProps.setCustomFrom(""); periodProps.setCustomTo(""); setComparison("none"); }}>Reset Filters</button>
                <button type="button" className="ceo-btn is-primary" onClick={() => setViewOpen(false)}>Done</button>
              </>
            )}
          >
            <FilterGroup label="Period">
              <Chips options={PERIOD_OPTIONS.map((o) => ({ value: o.value, label: o.value === "custom" ? "Choose dates" : o.label }))} value={timeline} onChange={(v) => periodProps.setTimeline(v || "month")} />
              {timeline === "custom" && <DateRange from={periodProps.customFrom} to={periodProps.customTo} onChange={(a, b) => { periodProps.setCustomFrom(a); periodProps.setCustomTo(b); }} />}
            </FilterGroup>
            <FilterGroup label="Compare With">
              <Select label="Compare with" value={comparison} onChange={setComparison} options={COMPARISON_OPTIONS} search={false} />
            </FilterGroup>
          </Drawer>
        )}

        {top && top.type === "orders" && (
          <Drawer wide title={top.title} sub={top.sub} onClose={() => setStack([])} onBack={stack.length > 1 ? () => setStack((s) => s.slice(0, -1)) : undefined}>
            <OrdersList ctx={ctx} title={top.title} b2b={top.b2b} orders={top.ids.map((id) => ordersById[id]).filter(Boolean)} />
          </Drawer>
        )}
        {top && top.type === "order" && ordersById[top.id] && (
          <OrderDrawer
            order={ordersById[top.id]}
            ctx={ctx}
            onClose={() => setStack([])}
            onBack={stack.length > 1 ? () => setStack((s) => s.slice(0, -1)) : undefined}
          />
        )}
      </div>

      {journey && !journey.loading && createPortal(
        <ComponentJourneyModal orderNo={journey.orderNo} components={journey.components} onClose={() => setJourney(null)} />,
        document.body,
      )}
      {paymentOrder && createPortal(
        <UpdatePaymentModal order={paymentOrder} saving={paymentSaving} onCancel={() => { if (!paymentSaving) setPaymentOrder(null); }} onConfirm={handleB2bPayment} />,
        document.body,
      )}
    </>
  );
}

function OrderDrawer({ order: o, ctx, onClose, onBack }) {
  const pay = b2bPaymentState(o);
  const balance = o.is_b2b ? pay.balance : Math.max(0, Number(o.remaining_payment) || 0);
  const person = ctx.personOf(o);
  const warehouseReady = !o.is_b2b || o.approval_status === "approved";
  return (
    <Drawer title={o.order_no} sub={ctx.clientOf(o)} onClose={onClose} onBack={onBack}>
      <div className="ceo-dstats">
        <Stat label="Order Value" info="The order's value after discounts."><b title={fullInr(pay.total)}>{shortInr(pay.total)}</b></Stat>
        <Stat label="Amount Received" info="Money received so far, including any advance."><b title={fullInr(pay.received)}>{shortInr(pay.received)}</b></Stat>
        <Stat label="Balance Due" info="Money still owed on this order."><b className={balance > 0 ? "is-warn" : undefined} title={fullInr(balance)}>{shortInr(balance)}</b></Stat>
      </div>
      <div className="gm-actions">
        <button type="button" className="ceo-btn" onClick={() => ctx.openJourney(o)}><Icon name="movements" />View Journey</button>
        <button type="button" className="ceo-btn" onClick={() => ctx.makePdf(o, "customer")} disabled={ctx.pdfBusy === o.id}><Icon name="doc" />{ctx.pdfBusy === o.id ? "Making PDF" : "Customer PDF"}</button>
        {warehouseReady && <button type="button" className="ceo-btn" onClick={() => ctx.makePdf(o, "warehouse")} disabled={ctx.pdfBusy === o.id}><Icon name="warehouse" />Warehouse PDF</button>}
        {canUpdateB2bPayment(o) && <button type="button" className="ceo-btn is-primary" onClick={() => ctx.payB2b(o)}><Icon name="inr" />Update Payment</button>}
      </div>
      <div className="ceo-ditems">
        {(o.items || []).map((it, i) => (
          <div key={`${it.product_name}-${i}`} className="gm-item">
            <Thumb src={it.image_url} alt={it.product_name} />
            <span>
              <b>{it.product_name || "–"}</b>
              <small>{[it.size && `Size ${it.size}`, it.top_color?.name || it.color?.name, Number(it.quantity) > 1 && `Qty ${it.quantity}`].filter(Boolean).join(" · ")}</small>
            </span>
          </div>
        ))}
      </div>
      <dl className="ceo-dl">
        <dt>{o.is_b2b ? "Partner" : "Client"}</dt><dd><button type="button" className="ceo-inline" onClick={() => ctx.openOrders(o.is_b2b
          ? { title: ctx.clientOf(o), sub: "Every B2B order from this partner", orders: ctx.orders.filter((x) => x.is_b2b && ctx.clientOf(x) === ctx.clientOf(o)), b2b: true }
          : { title: ctx.clientOf(o), sub: "Every order from this client", orders: ctx.orders.filter((x) => (o.delivery_phone ? x.delivery_phone === o.delivery_phone : x.id === o.id)) })}>{ctx.clientOf(o)}</button></dd>
        {o.delivery_phone && <><dt>Phone</dt><dd>{o.delivery_phone}</dd></>}
        <dt>Sales Channel</dt><dd><button type="button" className="ceo-inline" onClick={() => ctx.openOrders({ title: ctx.channelOf(o), sub: `Sales, ${ctx.periodName}`, orders: ctx.sales.filter((x) => ctx.channelOf(x) === ctx.channelOf(o)) })}>{ctx.channelOf(o)}</button></dd>
        {person && <><dt>{o.is_b2b ? "Merchandiser" : "Sales Associate"}</dt><dd><button type="button" className="ceo-inline" onClick={() => ctx.openOrders({ title: person, sub: `Sales, ${ctx.periodName}`, orders: ctx.sales.filter((x) => ctx.personOf(x) === person), b2b: !!o.is_b2b })}>{person}</button></dd></>}
        {o.salesperson_store && <><dt>Store</dt><dd>{o.salesperson_store}</dd></>}
        {o.is_b2b && o.b2b_order_type && <><dt>B2B Order Type</dt><dd>{o.b2b_order_type}</dd></>}
        {o.is_b2b && o.po_number && <><dt>PO Number</dt><dd>{o.po_number}</dd></>}
        <dt>Status</dt><dd>{getOrderStatusLabel(o.status)}</dd>
        <dt>Payment</dt><dd><PaymentPill order={o} /></dd>
        <dt>Production</dt><dd>{journeyLine(o)}</dd>
        {o.warehouse_stage && <><dt>Production Stage</dt><dd>{getStageLabel(o.warehouse_stage)}</dd></>}
        <dt>Order Date</dt><dd>{formatDate(o.created_at)}</dd>
        {o.delivery_date && <><dt>Delivery Date</dt><dd>{formatDate(o.delivery_date)}</dd></>}
        {Number(o.discount_amount) > 0 && <><dt>Discount</dt><dd>{fullInr(o.discount_amount)}</dd></>}
        {o.cancellation_reason && <><dt>Cancellation Reason</dt><dd>{o.cancellation_reason}</dd></>}
      </dl>
      <button type="button" className="ceo-btn is-primary is-block" onClick={() => ctx.navigate(o.is_b2b ? `/b2b-order-view/${o.id}` : `/order/${o.id}`)}>Open Full Order</button>
    </Drawer>
  );
}
