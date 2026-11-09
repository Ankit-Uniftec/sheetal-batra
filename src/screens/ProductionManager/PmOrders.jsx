import React, { useEffect, useMemo, useState } from "react";
import { HalfMadeBanner } from "../../components/HalfMadeSuggestion";
import { STAGE_GROUPS } from "../../utils/barcodeService";
import { Chips, FilterGroup, PageHead, Pager, Seg, num } from "../CeoDashboard/CeoUi";
import { FilterDrawer, ListTools, PeriodFacet, usePagePeriod } from "../CeoDashboard/dashKit";
import { DueCell, OrderCell, Table, exportOrders, orderStatus, piecesLine } from "./PmCommon";
import {
  channelOf, clientOf, daysLeft, dueDay, floorKey, hasPromise, isLate, isRunning, isUrgent, overdueDays, pieceState, productsOf, statusOf,
  todayStart,
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
  { value: "out", label: "Dispatched & Delivered" },
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
  { value: "vendor", label: "Has pieces at vendors" },
  { value: "stuck", label: "Has stuck pieces" },
  { value: "notstarted", label: "Nothing started yet" },
  { value: "disposed", label: "Has disposed pieces" },
  { value: "rework", label: "Has re-work" },
];
const PAGE = 15;

const inTab = (o, tab, today) => {
  const s = statusOf(o);
  if (tab === "running") return isRunning(o);
  if (tab === "late") return isLate(o, today);
  if (tab === "week") { const d = daysLeft(o, today); return isRunning(o) && d != null && d >= 0 && d <= 6; }
  if (tab === "completed") return s === "completed" && o.warehouse_stage !== "dispatched";
  if (tab === "out") return ["dispatched", "delivered"].includes(s) || (o.warehouse_stage === "dispatched" && s !== "cancelled");
  if (tab === "cancelled") return s === "cancelled";
  return true;
};

export default function OrdersPage({ ctx }) {
  const { orders, componentsByOrder, halfMade } = ctx;
  const [tab, setTab] = useState("running");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("due");
  const [channels, setChannels] = useState([]);
  const [stages, setStages] = useState([]);
  const [pieceF, setPieceF] = useState([]);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [page, setPage] = useState(1);
  const p = usePagePeriod();
  const today = todayStart();

  const channelList = useMemo(() => [...new Set(orders.map(channelOf))].sort(), [orders]);

  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (channels.length && !channels.includes(channelOf(o))) return false;
      if (urgentOnly && !isUrgent(o)) return false;
      if (p.range && !p.inPeriod(o.created_at)) return false;
      const comps = (componentsByOrder[o.id] || []).filter((c) => !c.cancelled_at);
      if (stages.length && !comps.some((c) => stages.includes(floorKey(c)))) return false;
      if (pieceF.includes("vendor") && !comps.some((c) => c.is_outside_wh)) return false;
      if (pieceF.includes("stuck") && !comps.some((c) => pieceState(c) === "in_house" && overdueDays(c) > 0)) return false;
      if (pieceF.includes("notstarted") && !(comps.length && comps.every((c) => pieceState(c) === "not_started"))) return false;
      if (pieceF.includes("disposed") && !comps.some((c) => pieceState(c) === "disposed")) return false;
      if (pieceF.includes("rework") && !comps.some((c) => Number(c.re_journey_count) > 0)) return false;
      if (!q) return true;
      return [o.order_no, clientOf(o, ctx.vendorMap), productsOf(o), o.po_number, o.salesperson, o.shopify_order_name].some((v) => String(v || "").toLowerCase().includes(q))
        || comps.some((c) => String(c.barcode || "").toLowerCase().includes(q));
    });
  }, [orders, componentsByOrder, search, channels, stages, pieceF, urgentOnly, p.range, ctx.vendorMap]); // eslint-disable-line react-hooks/exhaustive-deps

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
  useEffect(() => { setPage(1); }, [tab, search, sort, channels, stages, pieceF, urgentOnly, p.range]);

  const filterCount = (channels.length ? 1 : 0) + (stages.length ? 1 : 0) + (pieceF.length ? 1 : 0) + (urgentOnly ? 1 : 0) + (p.active ? 1 : 0) + (sort !== "due" ? 1 : 0);
  const clear = () => { setChannels([]); setStages([]); setPieceF([]); setUrgentOnly(false); setSort("due"); p.reset(); };
  const tabLabel = TABS.find((t) => t.value === tab)?.label;

  return (
    <div className="ceo-page">
      <PageHead title="Orders" desc="Every order the floor makes. Click an order for its pieces, journey and actions." />
      {halfMade?.count > 0 && (
        <div className="pm-halfmade-banner"><HalfMadeBanner byOrder={halfMade.byOrder} orders={orders} by={halfMade.me?.email} onUsed={halfMade.reload} /></div>
      )}
      <div className="pm-tabs-scroll">
        <Seg label="Order status" value={tab} onChange={setTab} options={TABS.map((t) => ({ ...t, count: counts[t.value] }))} />
      </div>
      <ListTools
        search={search} onSearch={setSearch} placeholder="Search order, client, product, barcode or PO"
        filters={filterCount} onFilters={() => setDrawer(true)}
        onExport={() => exportOrders(`orders ${tabLabel}`, list, ctx)} exportDisabled={!list.length}
      />
      <section className="ceo-card">
        <Table
          rowKey={(r) => r.id}
          rows={list.slice((page - 1) * PAGE, page * PAGE)}
          onRow={ctx.openOrder}
          empty="No orders match."
          columns={[
            { key: "order", label: "Order", render: (o) => <OrderCell o={o} ctx={ctx} /> },
            { key: "channel", label: "Channel", lap: true, render: (o) => channelOf(o) },
            {
              key: "pieces", label: "Status", hide: true, render: (o) => {
                const comps = (componentsByOrder[o.id] || []).filter((c) => !c.cancelled_at);
                const done = comps.filter((c) => pieceState(c) === "finished").length;
                return (
                  <span className="pm-cell">
                    <b>{orderStatus(o, componentsByOrder[o.id])}</b>
                    <small>{piecesLine(componentsByOrder[o.id])}</small>
                    {comps.length > 0 && <span className="pm-mini-bar"><i style={{ width: `${(done / comps.length) * 100}%` }} /></span>}
                  </span>
                );
              },
            },
            { key: "due", label: "Due Date", right: true, render: (o) => <DueCell o={o} /> },
          ]}
        />
        <Pager page={page} pages={Math.ceil(list.length / PAGE)} onChange={setPage} />
        <p className="pm-count-line">{num(list.length)} {list.length === 1 ? "order" : "orders"}{tab === "late" ? " · website and stock orders are never counted as late" : ""}</p>
      </section>

      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} onClear={clear} count={list.length} noun="orders" sub="Narrow the order list">
        <FilterGroup label="Sort By"><Chips options={SORTS} value={sort} onChange={(v) => setSort(v || "due")} /></FilterGroup>
        <FilterGroup label="Priority"><Chips options={[{ value: "urgent", label: "Urgent only" }]} value={urgentOnly ? "urgent" : ""} onChange={(v) => setUrgentOnly(v === "urgent")} /></FilterGroup>
        <FilterGroup label="Channel"><Chips options={channelList.map((c) => ({ value: c, label: c }))} value={channels} onChange={setChannels} /></FilterGroup>
        <FilterGroup label="Has a Piece At"><Chips options={STAGE_GROUPS.filter((g) => g.key !== "order_received").map((g) => ({ value: g.key, label: g.label }))} value={stages} onChange={setStages} /></FilterGroup>
        <FilterGroup label="Pieces"><Chips options={PIECE_FILTERS} value={pieceF} onChange={setPieceF} /></FilterGroup>
        <PeriodFacet p={p} label="Order Date" />
      </FilterDrawer>
    </div>
  );
}

