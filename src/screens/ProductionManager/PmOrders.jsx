import React, { useEffect, useMemo, useState } from "react";
import { HalfMadeBanner } from "../../components/HalfMadeSuggestion";
import { STAGE_GROUPS } from "../../utils/barcodeService";
import { Chips, Drawer, FilterGroup, PageHead, Pager, Seg, num } from "../CeoDashboard/CeoUi";
import { CancellationInsights, CancellationReport } from "./PmMore";
import { FilterDrawer, ListTools, PeriodFacet, usePagePeriod } from "../CeoDashboard/dashKit";
import { exportOrders } from "./PmCommon";
import OrderRows from "./PmOrderRows";
import "./PmOrders2.css";
import {
  atVendor, atWh2, channelOf, clientOf, daysLeft, disposalsByOrder, dueDay, dueIn, floorKey, hasPromise, isDormant, isLate, isRunning, isUrgent, overdueDays, pieceState,
  priorityOf, productsOf, shopifyNo, statusOf, todayStart,
} from "./pmModel";

// ============================================================
// Orders: every order the floor makes, with search, status tabs, filters in a
// side panel and every action in the order's side panel.
// ============================================================

const TABS = [
  { value: "running", label: "In Production" },
  { value: "late", label: "Late" },
  { value: "week", label: "Due in 7 Days" },
  { value: "completed", label: "Completed" },
  { value: "dispatched", label: "Dispatched" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All" },
];
const SORTS = [
  { value: "due", label: "Due date, soonest first" },
  { value: "late", label: "Most late first" },
  { value: "new", label: "Newest order first" },
  { value: "old", label: "Oldest order first" },
];
const PIECE_FILTERS = [
  { value: "vendor", label: "Has pieces at outside vendors" },
  { value: "wh2", label: "Has pieces at SB WH Delhi (2)" },
  { value: "stuck", label: "Has stuck pieces" },
  { value: "notstarted", label: "Nothing started yet" },
  { value: "disposed", label: "Has disposed pieces" },
  { value: "rework", label: "Has re-work" },
];
const ACTIVITY = [
  { value: "moving", label: "Moving (scanned in the last 30 days)" },
  { value: "quiet", label: "Quiet (nothing scanned for 30+ days)" },
];
const PRIORITIES = [
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];
// Old tab names still open the right tab.
const TAB_ALIAS = { out: "dispatched", dispatched_delivered: "dispatched" };
const tabFor = (t) => TAB_ALIAS[t] || t;
const PAGE = 15;
const TOP_SALESPEOPLE = 25;

const inTab = (o, tab, today) => {
  const s = statusOf(o);
  if (tab === "running") return isRunning(o);
  if (tab === "late") return isLate(o, today);
  if (tab === "week") return dueIn(o, 0, 6, today);
  if (tab === "completed") return s === "completed" && o.warehouse_stage !== "dispatched";
  // Delivered: the delivery is recorded. Dispatched: sent, not yet delivered.
  const delivered = s !== "cancelled" && (s === "delivered" || !!o.delivered_at);
  if (tab === "delivered") return delivered;
  if (tab === "dispatched") return !delivered && (s === "dispatched" || (o.warehouse_stage === "dispatched" && s !== "cancelled"));
  if (tab === "cancelled") return s === "cancelled";
  return true;
};

export default function OrdersPage({ ctx }) {
  const { orders, componentsByOrder, halfMade, need, lazy } = ctx;
  const [tab, setTab] = useState(tabFor(ctx.ordersTab) || "running");
  const [report, setReport] = useState(false);
  // Opened from an old Cancellations link (or anywhere that asks for a tab).
  useEffect(() => { if (ctx.ordersTab) { setTab(tabFor(ctx.ordersTab)); ctx.setOrdersTab(null); } }, [ctx.ordersTab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("due");
  const [channels, setChannels] = useState([]);
  const [stages, setStages] = useState([]);
  const [pieceF, setPieceF] = useState([]);
  const [priorities, setPriorities] = useState([]);
  const [salespeople, setSalespeople] = useState([]);
  const [activity, setActivity] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [page, setPage] = useState(1);
  const p = usePagePeriod();
  const today = todayStart();

  const channelList = useMemo(() => [...new Set(orders.map(channelOf))].sort(), [orders]);
  // Why pieces were disposed comes from the QC ledger (all qc_records).
  useEffect(() => { need("qcAll"); }, [need]);
  const qcRows = lazy?.qcAll?.rows;
  const disposals = useMemo(() => disposalsByOrder(qcRows), [qcRows]);
  // The salespeople on this tab's orders, most orders first (the top 25, plus any already picked).
  const salesList = useMemo(() => {
    const n = {};
    orders.forEach((o) => { if (o.salesperson && inTab(o, tab, today)) n[o.salesperson] = (n[o.salesperson] || 0) + 1; });
    const top = Object.entries(n).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP_SALESPEOPLE).map(([k]) => k);
    salespeople.forEach((v) => { if (!top.includes(v)) top.push(v); });
    return top.map((v) => ({ value: v, label: n[v] ? `${v} (${num(n[v])})` : v }));
  }, [orders, tab, salespeople]); // eslint-disable-line react-hooks/exhaustive-deps

  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (channels.length && !channels.includes(channelOf(o))) return false;
      if (priorities.length && !priorities.includes(priorityOf(o))) return false;
      if (salespeople.length && !salespeople.includes(o.salesperson)) return false;
      if (activity && isRunning(o) !== true) return false;
      if (activity && (activity === "quiet") !== isDormant(o, componentsByOrder[o.id] || [])) return false;
      if (p.range && !p.inPeriod(o.created_at)) return false;
      const comps = (componentsByOrder[o.id] || []).filter((c) => !c.cancelled_at);
      if (stages.length && !comps.some((c) => stages.includes(floorKey(c)))) return false;
      if (pieceF.includes("vendor") && !comps.some(atVendor)) return false;
      if (pieceF.includes("wh2") && !comps.some(atWh2)) return false;
      if (pieceF.includes("stuck") && !comps.some((c) => pieceState(c) === "in_house" && overdueDays(c) > 0)) return false;
      if (pieceF.includes("notstarted") && !(comps.length && comps.every((c) => pieceState(c) === "not_started"))) return false;
      if (pieceF.includes("disposed") && !disposals[o.id] && !comps.some((c) => pieceState(c) === "disposed")) return false;
      if (pieceF.includes("rework") && !comps.some((c) => Number(c.re_journey_count) > 0)) return false;
      if (!q) return true;
      const brand = o.is_b2b ? ctx.vendorMap?.[o.vendor_id]?.store_brand_name : "";
      return [o.order_no, clientOf(o, ctx.vendorMap), brand, o.delivery_name, productsOf(o), o.po_number, o.salesperson, shopifyNo(o)].some((v) => String(v || "").toLowerCase().includes(q))
        || comps.some((c) => String(c.barcode || "").toLowerCase().includes(q));
    });
  }, [orders, componentsByOrder, search, channels, stages, pieceF, priorities, salespeople, activity, p.range, ctx.vendorMap, disposals]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.value, scoped.filter((o) => inTab(o, t.value, today)).length])), [scoped]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => {
    const l = scoped.filter((o) => inTab(o, tab, today));
    const due = (o) => (dueDay(o) || new Date(8.64e15)).getTime();
    // Urgent first, then orders promised to a client by their due date, then
    // website and stock orders (not promised by a date).
    if (sort === "due") l.sort((a, b) => (isUrgent(b) - isUrgent(a)) || (hasPromise(b) - hasPromise(a)) || due(a) - due(b));
    else if (sort === "late") l.sort((a, b) => (daysLeft(a, today) ?? 1e9) - (daysLeft(b, today) ?? 1e9));
    else if (sort === "new") l.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    else l.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return l;
  }, [scoped, tab, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, [tab, search, sort, channels, stages, pieceF, priorities, salespeople, activity, p.range]);

  const filterCount = (channels.length ? 1 : 0) + (stages.length ? 1 : 0) + (pieceF.length ? 1 : 0) + (priorities.length ? 1 : 0) + (salespeople.length ? 1 : 0) + (activity ? 1 : 0) + (p.active ? 1 : 0) + (sort !== "due" ? 1 : 0);
  const clear = () => { setChannels([]); setStages([]); setPieceF([]); setPriorities([]); setSalespeople([]); setActivity(""); setSort("due"); p.reset(); };
  const tabLabel = TABS.find((t) => t.value === tab)?.label;
  // One line that reads the list out: how much of it is late, quiet or urgent.
  const summary = useMemo(() => {
    const runningHere = list.filter(isRunning);
    const quiet = runningHere.filter((o) => isDormant(o, componentsByOrder[o.id] || [])).length;
    const late = list.filter((o) => isLate(o, today)).length;
    const urgent = list.filter(isUrgent).length;
    const parts = [`${num(list.length)} ${list.length === 1 ? "order" : "orders"}`];
    if (runningHere.length) parts.push(`${num(runningHere.length - quiet)} moving, ${num(quiet)} quiet for 30+ days`);
    if (late) parts.push(`${num(late)} late`);
    if (urgent) parts.push(`${num(urgent)} urgent`);
    if (tab === "late" || tab === "week") parts.push("website and stock orders are not promised by a date, so they are not listed here");
    return parts.join(" · ");
  }, [list, componentsByOrder, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ceo-page">
      <PageHead title="Orders" desc="Every order the floor makes, with all its details on the row. Journey, PDF and every other action are on the row; click an order for its full details." />
      {halfMade?.count > 0 && (
        <div className="pm-halfmade-banner"><HalfMadeBanner byOrder={halfMade.byOrder} orders={orders} by={halfMade.me?.email} onUsed={halfMade.reload} /></div>
      )}
      <div className="pm-tabs-scroll">
        <Seg label="Order status" value={tab} onChange={setTab} options={TABS.map((t) => ({ ...t, count: counts[t.value] }))} />
      </div>
      {tab === "cancelled" && <CancellationInsights ctx={ctx} onReport={() => setReport(true)} />}
      <ListTools
        search={search} onSearch={setSearch} placeholder="Search order, client, brand, product, barcode, PO or Shopify no"
        filters={filterCount} onFilters={() => setDrawer(true)}
        onExport={() => exportOrders(`orders ${tabLabel}`, list, ctx)} exportDisabled={!list.length}
      />
      <section className="ceo-card pm-orders-list">
        {/* The summary and the pages at the top as well as the bottom. */}
        <div className="pm-list-top">
          <p className="pm-count-line">{summary}</p>
          <Pager page={page} pages={Math.ceil(list.length / PAGE)} onChange={setPage} />
        </div>
        <OrderRows ctx={ctx} disposals={disposals} rows={list.slice((page - 1) * PAGE, page * PAGE)} />
        <Pager page={page} pages={Math.ceil(list.length / PAGE)}
          onChange={(p) => { setPage(p); document.querySelector(".pm-orders-list")?.scrollIntoView({ block: "start", behavior: "smooth" }); }} />
        <p className="pm-count-line">{summary}</p>
      </section>

      {report && (
        <Drawer wide title="Cancellation Report" sub="Cancelled orders by period, channel, reason and how far they had got" onClose={() => setReport(false)}>
          <CancellationReport ctx={ctx} />
        </Drawer>
      )}
      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} onClear={clear} count={list.length} noun="orders" sub="Narrow the order list">
        <FilterGroup label="Sort By"><Chips options={SORTS} value={sort} onChange={(v) => setSort(v || "due")} /></FilterGroup>
        <FilterGroup label="Priority"><Chips options={PRIORITIES} value={priorities} onChange={setPriorities} /></FilterGroup>
        <FilterGroup label="Activity"><Chips options={ACTIVITY} value={activity} onChange={setActivity} /></FilterGroup>
        {salesList.length > 0 && <FilterGroup label="Salesperson"><Chips options={salesList} value={salespeople} onChange={setSalespeople} /></FilterGroup>}
        <FilterGroup label="Channel"><Chips options={channelList.map((c) => ({ value: c, label: c }))} value={channels} onChange={setChannels} /></FilterGroup>
        <FilterGroup label="Has a Piece At"><Chips options={STAGE_GROUPS.filter((g) => g.key !== "order_received").map((g) => ({ value: g.key, label: g.label }))} value={stages} onChange={setStages} /></FilterGroup>
        <FilterGroup label="Pieces"><Chips options={PIECE_FILTERS} value={pieceF} onChange={setPieceF} /></FilterGroup>
        <PeriodFacet p={p} label="Order Date" />
      </FilterDrawer>
    </div>
  );
}

