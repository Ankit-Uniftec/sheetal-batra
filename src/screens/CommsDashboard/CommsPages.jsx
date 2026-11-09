import React, { useEffect, useMemo, useState } from "react";
import formatDate from "../../utils/formatDate";
import downloadCsv from "../../utils/downloadCsv";
import { getOrderProgressStatus } from "../../utils/barcodeService";
import ProductionHeadVendors from "../../components/ProductionHeadVendors";
import "../../components/ProductionHeadVendors.css";
import useStockRoomView from "../StockRoom/useStockRoomView";
import { TYPE_LABELS, TYPE_LXRTS, TYPE_MTO } from "../StockRoom/stockRoomModel";
import { shortInr } from "../CeoDashboard/ceoInsights";
import {
  Chips, Donut, Drawer, Empty, FilterGroup, Icon, PageHead, Pager, RankBars, Seg, Select, Thumb, fullInr, num,
} from "../CeoDashboard/CeoUi";
import { CsvButton, FilterDrawer, ListTools, PeriodFacet, Stat, defineKit, slug, usePagePeriod } from "../CeoDashboard/dashKit";
import { CARD_INFO, COLUMN_INFO, TILE_INFO } from "./commsDefinitions";
import { MarkReturnedModal } from "./CommsSourcingReturns";
import { BlockModal, releaseCommsBlock } from "./CommsInventory";
import { PrEditModal } from "./CommsPRPerformance";
import { useCommsReports } from "./CommsReports";
import { EVENT_TYPES, EventModal, deleteCommsEvent, eventTypeMeta, loadCommsEvents } from "./CommsCalendar";
import { supabase } from "../../lib/supabaseClient";

// ============================================================
// Nazreen's (Comms) pages. Every figure and action from the old dashboard is
// here; the forms (Mark Returned, Block, PR record, Calendar event) are the same
// ones the old dashboard uses, so everything is saved exactly as before.
// ============================================================

const { Tile, Card, Table } = defineKit({ tiles: TILE_INFO, cards: CARD_INFO, columns: COLUMN_INFO });
const PAGE = 15;
const ordersN = (n) => `${num(n)} ${Number(n) === 1 ? "order" : "orders"}`;
const options = (list, allLabel) => [{ value: "", label: allLabel }, ...list.map((v) => ({ value: v, label: v }))];
const two = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const dateOnly = (v) => String(v || "").slice(0, 10);
const todayKey = () => dayKey(new Date());
const daysBetween = (from, to) => Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 864e5);

export const ENGAGEMENTS = ["Barter", "Gifting", "Sourcing", "Personal order"];
const TONES = { Barter: "blue", Gifting: "ok", Sourcing: "warn", "Personal order": "plum" };
export const engagementTone = (t) => TONES[t] || "gold";
const ENGAGEMENT_COLOURS = { Barter: "#2f6f73", Gifting: "#8a9a5b", Sourcing: "#c9785a", "Personal order": "#7b3a5e" };

/** The outfit's full price: each piece's price × quantity plus its extras (as before). */
export const notionalOf = (o) => (o.items || []).reduce((sum, it) => {
  const base = Number(it.price || 0) * Number(it.quantity || 1);
  const extras = Array.isArray(it.extras) ? it.extras.reduce((s, e) => s + Number(e.price || 0), 0) : 0;
  return sum + base + extras;
}, 0);

/** Where the order stands, in words. Approval comes first, then the floor's own status. */
export const statusOf = (o, comps) => {
  if (o.approval_status === "pending_approval") return "Waiting for Approval";
  if (o.approval_status === "rejected") return "Rejected";
  return getOrderProgressStatus(o, comps);
};
const isLive = (o) => o.approval_status !== "rejected" && String(o.status || "").toLowerCase() !== "cancelled";
const isDone = (s) => ["Delivered", "Cancelled", "Rejected", "Revoked"].includes(s);

// Comms may edit or cancel an order only within 48 hours of placing it, with a
// reason; the floor's own status still decides (unchanged from the old dashboard).
const COMMS_WINDOW_HOURS = 48;
const NO_CANCEL = ["Dispatched", "Delivered", "Cancelled", "Revoked"];
const hoursSince = (ts) => (ts ? (Date.now() - new Date(ts).getTime()) / 36e5 : Infinity);
const withinCommsWindow = (o) => hoursSince(o.created_at) < COMMS_WINDOW_HOURS;
export const canEditOrder = (o, comps) => o.approval_status !== "rejected" && withinCommsWindow(o) && getOrderProgressStatus(o, comps) === "Order Received";
export const canCancelOrder = (o, comps) => o.approval_status !== "rejected" && withinCommsWindow(o) && !NO_CANCEL.includes(getOrderProgressStatus(o, comps));
export const windowExpiredMessage = (o) => (withinCommsWindow(o)
  ? null
  : `This order was placed ${Math.floor(hoursSince(o.created_at))} hours ago — Comms can only edit or cancel within ${COMMS_WINDOW_HOURS} hours.`);

const EngagementPill = ({ type }) => <i className={`ceo-pill comms-eng is-${engagementTone(type)}`}>{type || "–"}</i>;
const OrderCell = ({ o }) => (
  <span className="ceo-ocell">
    <Thumb src={o.items?.[0]?.image_url} alt="" />
    <span><b>{o.order_no || "–"}</b><small>{o.delivery_name || o.comms_agency_name || "–"}</small></span>
  </span>
);

/** Every Comms order list downloads with the same columns. */
export function exportCommsOrders(title, list, ctx) {
  downloadCsv({
    filename: `comms_${slug(title)}`,
    headers: ["Order No", "Order Date", "Recipient", "Engagement", "Purpose", "Agency", "Point of Contact", "Phone", "Delivery Date", "Return Date", "Return Status", "Status", "Notional Value", "Products", "Pieces"],
    rows: list.map((o) => [
      o.order_no || "", o.created_at ? formatDate(o.created_at) : "", o.delivery_name || "", o.comms_engagement_type || "", o.comms_purpose || "",
      o.comms_agency_name || "", o.comms_poc_name || "", o.delivery_phone || "", o.delivery_date ? formatDate(o.delivery_date) : "",
      o.comms_outfit_return_date ? formatDate(o.comms_outfit_return_date) : "", o.comms_return_status || "", statusOf(o, ctx.componentsByOrder[o.id]),
      Math.round(notionalOf(o)), (o.items || []).map((it) => it.product_name).filter(Boolean).join(" | "),
      (o.items || []).reduce((s, it) => s + (Number(it.quantity) || 1), 0),
    ]),
  });
}

/** A list of orders inside a side panel, with its own download. */
export function CommsOrdersList({ ctx, orders, title }) {
  const [page, setPage] = useState(1);
  const sorted = useMemo(() => [...orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), [orders]);
  const value = sorted.reduce((s, o) => s + notionalOf(o), 0);
  return (
    <>
      <div className="ceo-dstats">
        <Stat label="Orders" info="The number of orders in this list."><b>{num(sorted.length)}</b></Stat>
        <Stat label="Notional Value" info="The full price of these outfits, including extras."><b title={fullInr(value)}>{shortInr(value)}</b></Stat>
      </div>
      <div className="gm-actions"><CsvButton disabled={!sorted.length} onClick={() => exportCommsOrders(title, sorted, ctx)} /></div>
      <Table
        rowKey={(r) => r.id}
        rows={sorted.slice((page - 1) * 12, page * 12)}
        onRow={ctx.openOrder}
        columns={[
          { key: "order", label: "Order", render: (o) => <OrderCell o={o} /> },
          { key: "eng", label: "Engagement", hide: true, render: (o) => <EngagementPill type={o.comms_engagement_type} /> },
          { key: "value", label: "Notional Value", right: true, render: (o) => fullInr(notionalOf(o)) },
        ]}
      />
      <Pager page={page} pages={Math.ceil(sorted.length / 12)} onChange={setPage} />
    </>
  );
}

// ------------------------------------------------------------ OVERVIEW
export function OverviewPage({ ctx }) {
  const { orders, componentsByOrder, prRecords, inPeriod, periodName, openOrders, openOrder, newOrder } = ctx;
  const data = useMemo(() => {
    const placed = orders.filter((o) => inPeriod(o.created_at) && isLive(o));
    const byEng = ENGAGEMENTS.map((t) => {
      const list = placed.filter((o) => o.comms_engagement_type === t);
      return { name: t, value: list.length, notional: list.reduce((s, o) => s + notionalOf(o), 0), list };
    });
    const group = (keyOf) => {
      const m = {};
      placed.forEach((o) => {
        const k = keyOf(o);
        if (!k) return;
        const g = m[k] || (m[k] = { name: k, value: 0, notional: 0, list: [] });
        g.value += 1; g.notional += notionalOf(o); g.list.push(o);
      });
      return Object.values(m).sort((a, b) => b.value - a.value || b.notional - a.notional);
    };
    const designs = {};
    placed.forEach((o) => (o.items || []).forEach((it) => {
      const k = it.product_name;
      if (!k) return;
      const g = designs[k] || (designs[k] = { name: k, value: 0, list: [] });
      g.value += Number(it.quantity) || 1;
      if (!g.list.includes(o)) g.list.push(o);
    }));
    const today = todayKey();
    const pending = orders.filter((o) => o.approval_status === "pending_approval");
    const sourcingOut = orders.filter((o) => o.comms_engagement_type === "Sourcing" && isLive(o) && o.comms_return_status !== "Returned");
    const overdue = sourcingOut.filter((o) => o.comms_outfit_return_date && dateOnly(o.comms_outfit_return_date) < today);
    const prEligible = orders.filter((o) => o.comms_engagement_type && o.comms_engagement_type !== "Personal order" && o.approval_status !== "pending_approval" && o.approval_status !== "rejected");
    const captured = prEligible.filter((o) => prRecords[o.id]);
    const dueWeek = orders.filter((o) => isLive(o) && o.delivery_date && !isDone(statusOf(o, componentsByOrder[o.id])))
      .filter((o) => { const d = daysBetween(today, dateOnly(o.delivery_date)); return d >= 0 && d <= 7; })
      .sort((a, b) => dateOnly(a.delivery_date).localeCompare(dateOnly(b.delivery_date)));
    const returns = sourcingOut.filter((o) => o.comms_outfit_return_date)
      .filter((o) => { const d = daysBetween(today, dateOnly(o.comms_outfit_return_date)); return d >= 0 && d <= 14; })
      .sort((a, b) => dateOnly(a.comms_outfit_return_date).localeCompare(dateOnly(b.comms_outfit_return_date)));
    return {
      placed, byEng, notional: placed.reduce((s, o) => s + notionalOf(o), 0),
      recipients: group((o) => o.delivery_name || o.comms_agency_name),
      designs: Object.values(designs).sort((a, b) => b.value - a.value),
      pending, sourcingOut, overdue, prEligible, captured, dueWeek, returns,
    };
  }, [orders, componentsByOrder, prRecords, inPeriod]);
  const capturedPct = data.prEligible.length ? (data.captured.length / data.prEligible.length) * 100 : 0;

  return (
    <div className="ceo-page">
      <PageHead title="Overview" desc="Comms orders at a glance. Click any figure to see the orders behind it.">
        <span className="ceo-muted">{periodName}</span>
        <CsvButton label="Export Orders" disabled={!data.placed.length} onClick={() => exportCommsOrders(`orders ${periodName}`, data.placed, ctx)} />
        <button type="button" className="ceo-btn is-primary" onClick={newOrder}><Icon name="plus" />New Comms Order</button>
      </PageHead>
      <div className="ceo-tiles">
        <Tile icon="orders" label="Comms Orders" value={num(data.placed.length)} note={periodName} onClick={() => openOrders({ title: "Comms Orders", sub: periodName, orders: data.placed })} />
        <Tile icon="inr" label="Notional Value" value={shortInr(data.notional)} title={fullInr(data.notional)} note="Full price of outfits sent" onClick={() => openOrders({ title: "Notional Value", sub: `Full price of the outfits, ${periodName}`, orders: data.placed })} />
        <Tile icon="alert" tone={data.pending.length ? "warn" : undefined} label="Waiting for Approval" value={num(data.pending.length)} note="All time" onClick={() => openOrders({ title: "Waiting for Approval", sub: "Orders waiting for an admin decision", orders: data.pending })} />
        <Tile icon="transfer" tone={data.overdue.length ? "warn" : undefined} label="Outfits Out on Sourcing" value={num(data.sourcingOut.length)} note={`${num(data.overdue.length)} past their return date`} onClick={() => openOrders({ title: "Outfits Out on Sourcing", sub: "Not yet marked returned", orders: data.sourcingOut })} />
        <Tile icon="trend" label="PR Captured" value={`${capturedPct.toFixed(0)}%`} note={`${num(data.captured.length)} of ${num(data.prEligible.length)} orders`} onClick={() => openOrders({ title: "PR Not Captured", sub: "Barter, gifting and sourcing orders without a PR record", orders: data.prEligible.filter((o) => !ctx.prRecords[o.id]) })} />
      </div>
      <div className="ceo-grid">
        <Card span={5} title="Orders by Engagement" sub="Click a type to see its orders">
          <Donut data={data.byEng} money={false} center={num(data.placed.length)} sub="orders" onPick={(d) => { const g = data.byEng.find((x) => x.name === d.name); if (g) openOrders({ title: g.name, sub: periodName, orders: g.list }); }} />
          <RankBars rows={data.byEng} format={(v) => ordersN(v)} colorOf={(r) => ENGAGEMENT_COLOURS[r.name]} sub={(r) => `${shortInr(r.notional)} notional`} onRow={(r) => openOrders({ title: r.name, sub: periodName, orders: r.list })} />
        </Card>
        <Card span={7} title="Top Recipients" sub="Click a name to see their orders">
          <RankBars rows={data.recipients} limit={10} format={(v) => ordersN(v)} sub={(r) => `${shortInr(r.notional)} notional`} onRow={(r) => openOrders({ title: r.name, sub: periodName, orders: r.list })} />
        </Card>
        <Card span={6} title="Deliveries Due This Week" sub="Click an order to open it">
          <Table rowKey={(r) => r.id} rows={data.dueWeek} onRow={openOrder} empty="Nothing due in the next 7 days." columns={[
            { key: "order", label: "Order", render: (o) => <OrderCell o={o} /> },
            { key: "eng", label: "Engagement", hide: true, render: (o) => <EngagementPill type={o.comms_engagement_type} /> },
            { key: "due", label: "Delivery Date", right: true, render: (o) => formatDate(o.delivery_date) },
          ]} />
        </Card>
        <Card span={6} title="Upcoming Returns" sub="Sourcing outfits due back in 14 days">
          <Table rowKey={(r) => r.id} rows={data.returns} onRow={openOrder} empty="No returns due in the next 14 days." columns={[
            { key: "order", label: "Order", render: (o) => <OrderCell o={o} /> },
            { key: "due", label: "Return Date", right: true, render: (o) => formatDate(o.comms_outfit_return_date) },
          ]} />
        </Card>
        <Card span={6} title="Top Designs" sub="Click a design to see its orders">
          <RankBars rows={data.designs} limit={8} format={(v) => `${num(v)} ${v === 1 ? "piece" : "pieces"}`} onRow={(r) => openOrders({ title: r.name, sub: `Comms orders with this design, ${periodName}`, orders: r.list })} />
        </Card>
        <Card span={6} title="Recent Orders" sub="Click an order to open it">
          <Table rowKey={(r) => r.id} rows={data.placed.slice(0, 8)} onRow={openOrder} empty="No Comms orders in this period." columns={[
            { key: "order", label: "Order", render: (o) => <OrderCell o={o} /> },
            { key: "eng", label: "Engagement", hide: true, render: (o) => <EngagementPill type={o.comms_engagement_type} /> },
            { key: "value", label: "Notional Value", right: true, render: (o) => shortInr(notionalOf(o)) },
          ]} />
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ ORDERS
const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "pending_approval", label: "Waiting for Approval" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];
// The same four groups the old Orders tab used.
const inStatusTab = (o, tab) => {
  const s = String(o.status || "").toLowerCase();
  const ap = o.approval_status;
  if (tab === "pending_approval") return ap === "pending_approval";
  if (tab === "active") return ap !== "pending_approval" && !["completed", "delivered", "cancelled"].includes(s);
  if (tab === "completed") return s === "completed" || s === "delivered";
  if (tab === "cancelled") return s === "cancelled";
  return true;
};

export function OrdersPage({ ctx }) {
  const { orders, componentsByOrder, openOrder, newOrder } = ctx;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  const [eng, setEng] = useState("");
  const [agency, setAgency] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [page, setPage] = useState(1);
  const p = usePagePeriod();

  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => (!eng || o.comms_engagement_type === eng)
      && (!agency || (o.comms_agency_name || "") === agency)
      && (!p.range || p.inPeriod(o.created_at))
      && (!q || [o.order_no, o.delivery_name, o.comms_agency_name, o.comms_poc_name, o.comms_purpose].some((v) => String(v || "").toLowerCase().includes(q))));
  }, [orders, search, eng, agency, p.range]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => Object.fromEntries(STATUS_TABS.map((t) => [t.value, scoped.filter((o) => inStatusTab(o, t.value)).length])), [scoped]);
  const list = useMemo(() => scoped.filter((o) => inStatusTab(o, tab)), [scoped, tab]);
  useEffect(() => { setPage(1); }, [search, tab, eng, agency, p.range]);
  const agencies = useMemo(() => [...new Set(orders.map((o) => o.comms_agency_name).filter(Boolean))].sort(), [orders]);
  const active = (eng ? 1 : 0) + (agency ? 1 : 0) + (p.active ? 1 : 0);

  return (
    <div className="ceo-page">
      <PageHead title="Orders" desc="Every Comms order. Click an order to see its pieces, follow its production, open its PDFs, or edit or cancel it within 48 hours.">
        <button type="button" className="ceo-btn is-primary" onClick={newOrder}><Icon name="plus" />New Comms Order</button>
      </PageHead>
      <Card>
        <ListTools search={search} onSearch={setSearch} placeholder="Search order, recipient, agency or contact" filters={active} onFilters={() => setDrawer(true)} exportDisabled={!list.length} onExport={() => exportCommsOrders("orders", list, ctx)}>
          <Seg label="Status" value={tab} onChange={setTab} options={STATUS_TABS.map((t) => ({ ...t, count: counts[t.value] }))} />
        </ListTools>
        <Table
          rowKey={(r) => r.id}
          rows={list.slice((page - 1) * PAGE, page * PAGE)}
          onRow={openOrder}
          empty="No orders match."
          columns={[
            { key: "order", label: "Order", render: (o) => <OrderCell o={o} /> },
            { key: "eng", label: "Engagement", render: (o) => <EngagementPill type={o.comms_engagement_type} /> },
            { key: "purpose", label: "Purpose", hide: true, lap: true, render: (o) => <span className="ceo-clip" title={o.comms_purpose}>{o.comms_purpose || "–"}</span> },
            { key: "value", label: "Notional Value", right: true, hide: true, render: (o) => fullInr(notionalOf(o)) },
            { key: "status", label: "Status", hide: true, tab: true, render: (o) => statusOf(o, componentsByOrder[o.id]) },
            { key: "due", label: "Delivery Date", right: true, hide: true, render: (o) => (o.delivery_date ? formatDate(o.delivery_date) : "–") },
          ]}
        />
        <Pager page={page} pages={Math.ceil(list.length / PAGE)} onChange={setPage} />
      </Card>
      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} onClear={() => { setEng(""); setAgency(""); p.reset(); }} count={list.length} noun="orders" sub="Narrow the order list">
        <PeriodFacet p={p} />
        <FilterGroup label="Engagement"><Chips options={ENGAGEMENTS.map((v) => ({ value: v, label: v }))} value={eng} onChange={setEng} /></FilterGroup>
        {agencies.length > 0 && <FilterGroup label="Agency"><Select label="Agency" value={agency} onChange={setAgency} options={options(agencies, "All agencies")} /></FilterGroup>}
      </FilterDrawer>
    </div>
  );
}

// ------------------------------------------------------------ SOURCING RETURNS
const RETURN_VIEWS = [
  { value: "overdue", label: "Overdue" },
  { value: "pending", label: "Out on Sourcing" },
  { value: "returned", label: "Returned" },
];
export function SourcingPage({ ctx }) {
  const { orders, openOrder, replaceOrder, showPopup } = ctx;
  const [view, setView] = useState("overdue");
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [page, setPage] = useState(1);
  const [returning, setReturning] = useState(null);
  const p = usePagePeriod();

  // The same three groups as before: past the return date, out but not due, returned.
  const buckets = useMemo(() => {
    const today = todayKey();
    const q = search.trim().toLowerCase();
    const src = orders.filter((o) => o.comms_engagement_type === "Sourcing" && (!p.range || p.inPeriod(o.created_at))
      && (!q || [o.order_no, o.delivery_name].some((v) => String(v || "").toLowerCase().includes(q))));
    const out = { pending: [], overdue: [], returned: [] };
    src.forEach((o) => {
      if (o.comms_return_status === "Returned") out.returned.push(o);
      else if (o.comms_outfit_return_date && dateOnly(o.comms_outfit_return_date) < today) out.overdue.push(o);
      else out.pending.push(o);
    });
    const byDate = (a, b) => dateOnly(a.comms_outfit_return_date).localeCompare(dateOnly(b.comms_outfit_return_date));
    out.pending.sort(byDate); out.overdue.sort(byDate);
    out.returned.sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
    return out;
  }, [orders, search, p.range]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, [view, search, p.range]);
  const list = buckets[view];
  const today = todayKey();

  return (
    <div className="ceo-page">
      <PageHead title="Sourcing Returns" desc="Outfits lent out on sourcing and when they are due back. Mark an outfit returned to record its condition and where it went; usable pieces go back into stock." />
      <div className="ceo-tiles">
        <Tile icon="alert" tone={buckets.overdue.length ? "warn" : undefined} label="Overdue" value={num(buckets.overdue.length)} note="Past the return date" onClick={() => ctx.openOrders({ title: "Overdue Sourcing Returns", sub: "Past the return date, not marked returned", orders: buckets.overdue })} />
        <Tile icon="transfer" label="Out on Sourcing" value={num(buckets.pending.length)} note="Not yet due back" onClick={() => ctx.openOrders({ title: "Out on Sourcing", sub: "Out and not yet due back", orders: buckets.pending })} />
        <Tile icon="receive" label="Returned" value={num(buckets.returned.length)} note="Marked returned" onClick={() => ctx.openOrders({ title: "Returned", sub: "Sourcing outfits marked returned", orders: buckets.returned })} />
      </div>
      <Card>
        <ListTools search={search} onSearch={setSearch} placeholder="Search order or recipient" filters={p.active ? 1 : 0} onFilters={() => setDrawer(true)} exportDisabled={!list.length} onExport={() => downloadCsv({
          filename: `comms_sourcing_${view}`,
          headers: ["Order No", "Recipient", "Order Date", "Return Date", "Days", "Pieces", "Return Status", "Condition", "New Location", "Notes"],
          rows: list.map((o) => [o.order_no, o.delivery_name || "", formatDate(o.created_at), o.comms_outfit_return_date ? formatDate(o.comms_outfit_return_date) : "", o.comms_outfit_return_date ? daysBetween(dateOnly(o.comms_outfit_return_date), today) : "", (o.items || []).length, o.comms_return_status || "Out", o.comms_return_condition || "", o.comms_return_new_location || "", o.comms_return_damage_notes || ""]),
        })}>
          <Seg label="Show" value={view} onChange={setView} options={RETURN_VIEWS.map((v) => ({ ...v, count: buckets[v.value].length }))} />
        </ListTools>
        <Table
          rowKey={(r) => r.id}
          rows={list.slice((page - 1) * PAGE, page * PAGE)}
          onRow={openOrder}
          empty={view === "overdue" ? "Nothing is overdue." : "Nothing here."}
          columns={[
            { key: "order", label: "Order", render: (o) => <OrderCell o={o} /> },
            { key: "due", label: "Return Date", hide: true, render: (o) => (o.comms_outfit_return_date ? formatDate(o.comms_outfit_return_date) : "–") },
            ...(view === "returned" ? [
              { key: "cond", label: "Condition", render: (o) => o.comms_return_condition || "–" },
              { key: "loc", label: "New Location", hide: true, render: (o) => o.comms_return_new_location || "–" },
            ] : [
              { key: "days", label: "Days", right: true, render: (o) => { if (!o.comms_outfit_return_date) return "–"; const d = daysBetween(dateOnly(o.comms_outfit_return_date), today); return d > 0 ? <span className="ceo-text-crit">{num(d)} late</span> : d === 0 ? "Today" : `in ${num(-d)}`; } },
              { key: "act", label: "", right: true, render: (o) => <button type="button" className="ceo-btn is-small" onClick={(e) => { e.stopPropagation(); setReturning(o); }}>Mark Returned</button> },
            ]),
          ]}
        />
        <Pager page={page} pages={Math.ceil(list.length / PAGE)} onChange={setPage} />
      </Card>
      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} onClear={p.reset} count={list.length} noun="orders" sub="Narrow the sourcing list">
        <PeriodFacet p={p} />
      </FilterDrawer>
      {returning && <MarkReturnedModal order={returning} onClose={() => setReturning(null)} onDone={replaceOrder} showPopup={showPopup} />}
    </div>
  );
}

// ------------------------------------------------------------ PR PERFORMANCE
export function PrPage({ ctx }) {
  const { orders, prRecords, setPrRecords, openOrders, showPopup } = ctx;
  const [search, setSearch] = useState("");
  const [eng, setEng] = useState("");
  const [captured, setCaptured] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  // The same orders the old PR tab tracked: approved barter, gifting and sourcing.
  const eligible = useMemo(() => orders.filter((o) => o.comms_engagement_type && o.comms_engagement_type !== "Personal order" && o.approval_status !== "pending_approval" && o.approval_status !== "rejected"), [orders]);
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return eligible.filter((o) => (!eng || o.comms_engagement_type === eng)
      && (!captured || (captured === "yes" ? !!prRecords[o.id] : !prRecords[o.id]))
      && (!q || [o.order_no, o.delivery_name].some((v) => String(v || "").toLowerCase().includes(q))));
  }, [eligible, prRecords, search, eng, captured]);
  useEffect(() => { setPage(1); }, [search, eng, captured]);
  const got = eligible.filter((o) => prRecords[o.id]);
  const used = eligible.filter((o) => prRecords[o.id]?.outfit_used === true);
  const high = eligible.filter((o) => prRecords[o.id]?.outcome_impact === "High");
  const yesNo = (v) => (v === true ? "Yes" : v === false ? "No" : "–");

  return (
    <div className="ceo-page">
      <PageHead title="PR Performance" desc="One PR record per order: whether the outfit was used, the coverage it got, its reach and its impact. Click an order to fill in or update its record." />
      <div className="ceo-tiles">
        <Tile icon="orders" label="PR-Eligible Orders" value={num(eligible.length)} onClick={() => openOrders({ title: "PR-Eligible Orders", sub: "Approved barter, gifting and sourcing orders", orders: eligible })} />
        <Tile icon="ok" label="Captured" value={num(got.length)} note={eligible.length ? `${((got.length / eligible.length) * 100).toFixed(0)}% of orders` : ""} onClick={() => openOrders({ title: "PR Captured", sub: "Orders with a PR record", orders: got })} />
        <Tile icon="alert" tone={eligible.length - got.length ? "warn" : undefined} label="Not Captured" value={num(eligible.length - got.length)} onClick={() => openOrders({ title: "PR Not Captured", sub: "Orders still waiting for a PR record", orders: eligible.filter((o) => !prRecords[o.id]) })} />
        <Tile icon="sale" label="Outfit Used" value={num(used.length)} onClick={() => openOrders({ title: "Outfit Used", sub: "The recipient used the outfit", orders: used })} />
        <Tile icon="trend" label="High Impact" value={num(high.length)} onClick={() => openOrders({ title: "High Impact", sub: "PR outcome recorded as high impact", orders: high })} />
      </div>
      <Card>
        <ListTools search={search} onSearch={setSearch} placeholder="Search order or recipient" filters={(eng ? 1 : 0) + (captured ? 1 : 0)} onFilters={() => setDrawer(true)} exportDisabled={!list.length} onExport={() => downloadCsv({
          filename: "comms_pr_performance",
          headers: ["Order No", "Recipient", "Engagement", "Order Date", "PR Record", "Outfit Used", "Deliverables", "Coverage", "Reach", "Impressions", "Impact", "Remarks"],
          rows: list.map((o) => { const r = prRecords[o.id]; return [o.order_no, o.delivery_name || "", o.comms_engagement_type, formatDate(o.created_at), r ? "Captured" : "Not captured", yesNo(r?.outfit_used), r?.deliverables_received || "", (r?.coverage_type || []).join(" | "), r?.estimated_reach_number || r?.estimated_reach || "", r?.estimated_impressions || "", r?.outcome_impact || "", r?.remarks || ""]; }),
        })} />
        <Table
          rowKey={(r) => r.id}
          rows={list.slice((page - 1) * PAGE, page * PAGE)}
          onRow={(o) => setEditing(o)}
          empty="No orders match."
          columns={[
            { key: "order", label: "Order", render: (o) => <OrderCell o={o} /> },
            { key: "eng", label: "Engagement", hide: true, render: (o) => <EngagementPill type={o.comms_engagement_type} /> },
            { key: "pr", label: "PR Record", render: (o) => <i className={`ceo-pill is-${prRecords[o.id] ? "ok" : "warn"}`}>{prRecords[o.id] ? "Captured" : "Not captured"}</i> },
            { key: "used", label: "Outfit Used", hide: true, tab: true, render: (o) => yesNo(prRecords[o.id]?.outfit_used) },
            { key: "impact", label: "Impact", right: true, hide: true, render: (o) => prRecords[o.id]?.outcome_impact || "–" },
          ]}
        />
        <Pager page={page} pages={Math.ceil(list.length / PAGE)} onChange={setPage} />
      </Card>
      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} onClear={() => { setEng(""); setCaptured(""); }} count={list.length} noun="orders" sub="Narrow the PR list">
        <FilterGroup label="Engagement"><Chips options={["Barter", "Gifting", "Sourcing"].map((v) => ({ value: v, label: v }))} value={eng} onChange={setEng} /></FilterGroup>
        <FilterGroup label="PR Record"><Chips options={[{ value: "yes", label: "Captured" }, { value: "no", label: "Not captured" }]} value={captured} onChange={setCaptured} /></FilterGroup>
      </FilterDrawer>
      {editing && (
        <PrEditModal order={editing} record={prRecords[editing.id] || null} showPopup={showPopup}
          onClose={() => setEditing(null)} onSaved={(row) => setPrRecords((prev) => ({ ...prev, [row.order_id]: row }))} />
      )}
    </div>
  );
}

// ------------------------------------------------------------ CALENDAR (deliveries + my events)
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CAL_VIEWS = [{ value: "all", label: "Everything" }, { value: "deliveries", label: "Deliveries" }, { value: "events", label: "My Events" }];
export function CalendarPage({ ctx }) {
  const { orders, profile, openOrder, showPopup } = ctx;
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selected, setSelected] = useState(todayKey());
  const [view, setView] = useState("all");
  const [events, setEvents] = useState([]);
  const [modal, setModal] = useState(null);
  const [eventsOpen, setEventsOpen] = useState(false);

  useEffect(() => {
    let dead = false;
    loadCommsEvents(profile?.email).then((rows) => { if (!dead) setEvents(rows); }).catch((err) => console.error("Calendar load failed:", err));
    return () => { dead = true; };
  }, [profile?.email]);

  const deliveriesBy = useMemo(() => {
    const m = {};
    orders.filter(isLive).forEach((o) => { const k = dateOnly(o.delivery_date); if (k) (m[k] || (m[k] = [])).push(o); });
    return m;
  }, [orders]);
  const eventsBy = useMemo(() => {
    const m = {};
    events.forEach((e) => { (m[e.event_date] || (m[e.event_date] = [])).push(e); });
    return m;
  }, [events]);

  const cells = useMemo(() => {
    const lead = (month.getDay() + 6) % 7;
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out = [];
    for (let i = 0; i < lead; i += 1) out.push(null);
    for (let d = 1; d <= days; d += 1) out.push(dayKey(new Date(month.getFullYear(), month.getMonth(), d)));
    while (out.length % 7) out.push(null);
    return out;
  }, [month]);
  const monthKey = `${month.getFullYear()}-${two(month.getMonth() + 1)}`;
  const monthDeliveries = Object.entries(deliveriesBy).filter(([k]) => k.startsWith(monthKey)).flatMap(([, v]) => v);
  const monthEvents = events.filter((e) => String(e.event_date).startsWith(monthKey));
  const showD = view !== "events";
  const showE = view !== "deliveries";
  const dayDeliveries = showD ? deliveriesBy[selected] || [] : [];
  const dayEvents = showE ? eventsBy[selected] || [] : [];
  const today = todayKey();

  const removeEvent = (e) => showPopup({
    title: "Delete event?", message: `Remove "${e.title}" from your calendar?`, type: "confirm", confirmText: "Delete", cancelText: "Cancel",
    onConfirm: async () => {
      try { await deleteCommsEvent(e.id); setEvents((prev) => prev.filter((x) => x.id !== e.id)); }
      catch (err) { showPopup({ title: "Failed", message: err.message || "Could not delete event.", type: "error" }); }
    },
  });

  return (
    <div className="ceo-page">
      <PageHead title="Calendar" desc="Comms deliveries and your own follow-ups, events and shoots, on one calendar. Click a day to see what is on it.">
        <button type="button" className="ceo-btn is-primary" onClick={() => setModal({ mode: "create" })}><Icon name="plus" />New Event</button>
      </PageHead>
      <div className="ceo-tiles">
        <Tile icon="orders" label="Deliveries" value={num(monthDeliveries.length)} note={month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })} onClick={() => ctx.openOrders({ title: "Deliveries", sub: month.toLocaleDateString("en-IN", { month: "long", year: "numeric" }), orders: monthDeliveries })} />
        <Tile icon="pin" label="My Events" value={num(monthEvents.length)} note={month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })} onClick={() => setEventsOpen(true)} />
      </div>
      <div className="ceo-grid">
        <Card span={8} md={12}>
          <div className="comms-cal-head">
            <button type="button" className="ceo-icon-btn" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg></button>
            <h3>{month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</h3>
            <button type="button" className="ceo-icon-btn" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><Icon name="chevron" /></button>
            <span className="comms-cal-seg"><Seg label="Show" value={view} onChange={setView} options={CAL_VIEWS} /></span>
          </div>
          <div className="comms-cal-grid">
            {WEEK.map((w) => <span key={w} className="comms-cal-dow">{w}</span>)}
            {cells.map((k, i) => {
              if (!k) return <span key={`x${i}`} className="comms-cal-cell is-empty" />;
              const d = showD ? (deliveriesBy[k] || []).length : 0;
              const e = showE ? (eventsBy[k] || []).length : 0;
              return (
                <button key={k} type="button" className={`comms-cal-cell${k === selected ? " is-selected" : ""}${k === today ? " is-today" : ""}`} onClick={() => setSelected(k)}>
                  <span className="comms-cal-num">{Number(k.slice(8))}</span>
                  <span className="comms-cal-marks">
                    {d > 0 && <i className="is-delivery">{d} {d === 1 ? "delivery" : "deliveries"}</i>}
                    {e > 0 && <i className="is-event">{e} {e === 1 ? "event" : "events"}</i>}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
        <Card span={4} md={12} title={new Date(`${selected}T12:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })} sub={`${num(dayDeliveries.length)} deliveries · ${num(dayEvents.length)} events`}>
          {!dayDeliveries.length && !dayEvents.length && <Empty text="Nothing on this day." />}
          {dayDeliveries.length > 0 && (
            <div className="comms-day-list">
              <span className="ceo-label">Deliveries</span>
              {dayDeliveries.map((o) => (
                <button key={o.id} type="button" className="comms-day-item" onClick={() => openOrder(o)}>
                  <b>{o.delivery_name || o.order_no}</b><small>{o.order_no} · {o.comms_engagement_type}</small>
                </button>
              ))}
            </div>
          )}
          {dayEvents.length > 0 && (
            <div className="comms-day-list">
              <span className="ceo-label">My Events</span>
              {dayEvents.map((e) => {
                const meta = eventTypeMeta(e.event_type);
                return (
                  <div key={e.id} className="comms-day-item is-event">
                    <span><b>{e.title}</b><small>{meta.label}{e.description ? ` · ${e.description}` : ""}</small></span>
                    <span className="comms-day-actions">
                      <button type="button" className="ceo-btn is-small" onClick={() => setModal({ mode: "edit", event: e })}>Edit</button>
                      <button type="button" className="ceo-btn is-small" onClick={() => removeEvent(e)}>Delete</button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="comms-cal-legend">{EVENT_TYPES.map((t) => <span key={t.value}>{t.label}</span>)}</div>
        </Card>
      </div>
      {eventsOpen && (
        <Drawer title="My Events" sub={month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })} onClose={() => setEventsOpen(false)}>
          <div className="gm-actions"><CsvButton disabled={!monthEvents.length} onClick={() => downloadCsv({
            filename: `comms_events_${monthKey}`,
            headers: ["Date", "Title", "Type", "Description"],
            rows: monthEvents.map((e) => [formatDate(e.event_date), e.title, eventTypeMeta(e.event_type).label, e.description || ""]),
          })} /></div>
          {!monthEvents.length && <Empty text="No events this month. Use New Event to add one." />}
          <div className="comms-day-list">
            {monthEvents.map((e) => (
              <button key={e.id} type="button" className="comms-day-item" onClick={() => { setEventsOpen(false); setSelected(e.event_date); }}>
                <span><b>{e.title}</b><small>{formatDate(e.event_date)} · {eventTypeMeta(e.event_type).label}</small></span>
              </button>
            ))}
          </div>
        </Drawer>
      )}
      {modal && (
        <EventModal mode={modal.mode} event={modal.event} defaultDate={selected} profile={profile} orders={orders} showPopup={showPopup}
          onClose={() => setModal(null)}
          onSaved={(row, mode) => {
            if (mode === "create") { setEvents((prev) => [...prev, row].sort((a, b) => a.event_date.localeCompare(b.event_date))); setSelected(row.event_date); }
            else setEvents((prev) => prev.map((x) => (x.id === row.id ? row : x)));
          }} />
      )}
    </div>
  );
}

// ------------------------------------------------------------ INVENTORY
const STOCK_LEVELS = [{ value: "ok", label: "In Stock" }, { value: "low", label: "Low Stock" }, { value: "out", label: "Out of Stock" }];
const statusText = (r) => (r.type === TYPE_MTO ? "Made to order" : ({ ok: "In stock", low: "Low", out: "Out" }[r.status] || r.status));
export function InventoryPage({ ctx }) {
  const { stockRoom, profile, showPopup, navigate } = ctx;
  const view = useStockRoomView(stockRoom.data, 90, null);
  const [blocks, setBlocks] = useState([]);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("");
  const [type, setType] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [page, setPage] = useState(1);
  const [blocking, setBlocking] = useState(null); // { row, variant }
  const [design, setDesign] = useState(null);

  useEffect(() => {
    supabase.from("comms_inventory_blocks").select("*").eq("status", "active")
      .then(({ data }) => setBlocks(data || []));
  }, []);
  const today = todayKey();
  const live = blocks.filter((b) => b.end_date >= today);
  const variantsById = useMemo(() => Object.fromEntries((stockRoom.data?.variants || []).map((v) => [v.id, v])), [stockRoom.data]);
  const blockedIds = useMemo(() => new Set(live.map((b) => b.product_id || variantsById[b.variant_id]?.product_id).filter(Boolean)), [live, variantsById]);
  const rows = useMemo(() => {
    if (!view) return [];
    const q = search.trim().toLowerCase();
    return view.rows.filter((r) => (!q || String(r.product.name || "").toLowerCase().includes(q) || String(r.product.sku_id || "").toLowerCase().includes(q))
      && (!level || r.status === level) && (!type || r.type === type));
  }, [view, search, level, type]);
  useEffect(() => { setPage(1); }, [search, level, type]);

  const release = async (b) => {
    try { await releaseCommsBlock(b); setBlocks((prev) => prev.filter((x) => x.id !== b.id)); }
    catch (err) { showPopup({ title: "Failed", message: err.message || "Could not release block.", type: "error" }); }
  };
  const nameOfBlock = (b) => {
    const v = b.variant_id ? variantsById[b.variant_id] : null;
    const pid = b.product_id || v?.product_id;
    const row = view?.rowsById[pid];
    return `${row?.product.name || "Design"}${v ? ` (size ${v.size})` : ""}`;
  };

  if (stockRoom.error) return <div className="ceo-page"><PageHead title="Inventory" /><Card><Empty text={`Stock could not be loaded: ${stockRoom.error}`} /></Card></div>;
  if (!view) return <div className="ceo-page"><PageHead title="Inventory" /><Card><Empty text="Loading stock from Stock Room…" /></Card></div>;
  const t = view.totals;

  return (
    <div className="ceo-page">
      <PageHead title="Inventory" desc="Stock read from Stock Room, so it always matches. Block a design to reserve it for a shoot, event or sourcing; stores cannot sell it on those dates.">
        <button type="button" className="ceo-btn" onClick={() => navigate("/stock-room")}><Icon name="stock" />Open Stock Room</button>
      </PageHead>
      <div className="ceo-tiles">
        <Tile icon="products" label="Designs" value={num(t.designs)} note={`${num(t.lxrts)} LXRTS · ${num(t.custom)} custom · ${num(t.mto)} made to order`} onClick={() => { setLevel(""); setType(""); }} />
        <Tile icon="stock" label="Pieces in Stock" value={num(t.trackedUnits)} note={`${num(t.lxrtsUnits)} LXRTS · ${num(t.customUnits)} custom`} />
        <Tile icon="pin" label="Active Blocks" value={num(live.length)} note="Reserved right now" />
        <Tile icon="alert" tone="warn" label="Out of Stock" value={num(t.out)} onClick={() => setLevel("out")} />
      </div>
      <div className="ceo-grid">
        <Card span={12} title="Active Blocks" sub={blocks.length > live.length ? "Blocks whose dates have passed no longer stop sales, but stay listed until released." : undefined}>
          <Table rowKey={(r) => r.id} rows={blocks} empty="No design is reserved right now." columns={[
            { key: "design", label: "Design", render: (b) => <b>{nameOfBlock(b)}</b> },
            { key: "for", label: "Reserved For", render: (b) => `${b.purpose || "–"}${b.recipient_name ? ` for ${b.recipient_name}` : ""}` },
            { key: "from", label: "From", hide: true, render: (b) => formatDate(b.start_date) },
            { key: "to", label: "Until", right: true, render: (b) => (b.end_date < today ? <span>{formatDate(b.end_date)} <i className="ceo-pill is-warn">Ended, still open</i></span> : formatDate(b.end_date)) },
            { key: "act", label: "", right: true, render: (b) => <button type="button" className="ceo-btn is-small" onClick={() => release(b)}>Release</button> },
          ]} />
        </Card>
        <Card span={12} title="Design Stock">
          <ListTools search={search} onSearch={setSearch} placeholder="Search design or SKU" filters={(level ? 1 : 0) + (type ? 1 : 0)} onFilters={() => setDrawer(true)} exportDisabled={!rows.length} onExport={() => downloadCsv({
            filename: "comms_inventory",
            headers: ["SKU", "Design", "Type", "Pieces", "Status", "List Price", "Blocked"],
            rows: rows.map((r) => [r.product.sku_id || "", r.product.name, TYPE_LABELS[r.type] || "", r.stock.tracked && !r.stock.unlimited ? r.stock.total : "", statusText(r), Math.round(r.price), blockedIds.has(r.id) ? "Yes" : "No"]),
          })} />
          <Table
            rowKey={(r) => r.id}
            rows={rows.slice((page - 1) * PAGE, page * PAGE)}
            onRow={setDesign}
            empty="No designs match."
            columns={[
              { key: "name", label: "Design", render: (r) => <span className="ceo-ocell"><Thumb src={r.product.image_url} alt="" /><span><b>{r.product.name}</b><small>{r.product.sku_id || "–"}{blockedIds.has(r.id) ? " · Reserved" : ""}</small></span></span> },
              { key: "type", label: "Type", hide: true, render: (r) => TYPE_LABELS[r.type] || "–" },
              { key: "stock", label: "Pieces", right: true, render: (r) => (r.stock.tracked && !r.stock.unlimited ? num(r.stock.total) : "–") },
              { key: "status", label: "Status", right: true, hide: true, render: (r) => statusText(r) },
              { key: "act", label: "", right: true, render: (r) => <button type="button" className="ceo-btn is-small" onClick={(e) => { e.stopPropagation(); setBlocking({ row: r, variant: null }); }}>Block</button> },
            ]}
          />
          <Pager page={page} pages={Math.ceil(rows.length / PAGE)} onChange={setPage} />
        </Card>
      </div>
      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} onClear={() => { setLevel(""); setType(""); }} count={rows.length} noun="designs" sub="Narrow the design list">
        <FilterGroup label="Stock Level"><Chips options={STOCK_LEVELS} value={level} onChange={setLevel} /></FilterGroup>
        <FilterGroup label="Type"><Chips options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))} value={type} onChange={setType} /></FilterGroup>
      </FilterDrawer>
      {design && (
        <Drawer title={design.product.name} sub={`${design.product.sku_id || ""} · ${TYPE_LABELS[design.type] || ""}`} onClose={() => setDesign(null)}>
          <div className="ceo-dstats">
            <Stat label="Pieces" info="Pieces on hand, all sizes."><b>{design.stock.tracked && !design.stock.unlimited ? num(design.stock.total) : "Made to order"}</b></Stat>
            <Stat label="List Price" info="The design's price in the catalogue."><b>{fullInr(design.price)}</b></Stat>
          </div>
          <div className="gm-actions"><button type="button" className="ceo-btn is-primary" onClick={() => setBlocking({ row: design, variant: null })}><Icon name="pin" />Block This Design</button></div>
          {design.type === TYPE_LXRTS && (view.variantsByProduct[design.id] || []).length > 0 && (
            <Table rowKey={(v) => v.id} rows={view.variantsByProduct[design.id]} columns={[
              { key: "size", label: "Size", render: (v) => <b>{v.size}</b> },
              { key: "qty", label: "Pieces", right: true, render: (v) => num(v.inventory) },
              { key: "act", label: "", right: true, render: (v) => <button type="button" className="ceo-btn is-small" onClick={() => setBlocking({ row: design, variant: v })}>Block Size</button> },
            ]} />
          )}
        </Drawer>
      )}
      {blocking && (
        <BlockModal
          product={blocking.row.product}
          variant={blocking.variant}
          currentStock={blocking.variant ? blocking.variant.inventory : blocking.row.stock.tracked && !blocking.row.stock.unlimited ? blocking.row.stock.total : "Made to order"}
          profile={profile}
          showPopup={showPopup}
          onClose={() => setBlocking(null)}
          onSaved={(row) => setBlocks((prev) => [...prev, row])}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------ REPORTS
export function ReportsPage({ ctx }) {
  const r = useCommsReports(ctx.orders, ctx.showPopup);
  const reports = [
    { title: "Monthly Report — Agency & Individual", desc: "Barter, gifting and sourcing orders for the chosen month, one row per piece.", run: r.handleExportAgency },
    { title: "Monthly Report — Personal Orders", desc: "Personal orders for the chosen month, with price, discount, advance and dispatch details.", run: r.handleExportPrivate },
    { title: "PR Performance Report", desc: "Totals from the PR records: orders tracked, engagement split, outfits used, impact, reach and impressions.", run: r.handleExportPrPerformance, busy: r.prLoading },
  ];
  return (
    <div className="ceo-page">
      <PageHead title="Reports" desc="The three monthly Comms reports, as CSV files.">
        <Select label="Month" value={r.selectedMonth} onChange={r.setSelectedMonth} options={r.monthOptions} search={false} />
      </PageHead>
      <p className="ceo-muted">{num(r.ordersInPeriod.length)} Comms {r.ordersInPeriod.length === 1 ? "order" : "orders"} in this period.</p>
      <div className="ceo-grid">
        {reports.map((rep) => (
          <Card key={rep.title} span={4} md={12} title={rep.title} sub={rep.desc}>
            <CsvButton label={rep.busy ? "Preparing…" : "Download CSV"} disabled={rep.busy} onClick={rep.run} />
          </Card>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ VENDORS
export function VendorsPage({ ctx }) {
  return (
    <div className="ceo-page">
      <PageHead title="Vendor / External" desc="Vendors and external partners, as before." />
      <Card className="gm-classic"><ProductionHeadVendors currentUserEmail={ctx.profile?.email} /></Card>
    </div>
  );
}
