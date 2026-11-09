import React, { useEffect, useMemo, useState } from "react";
import { fmtDate as formatDate } from "./pmModel";
import downloadCsv from "../../utils/downloadCsv";
import ComponentStageBadge from "../../components/ComponentStageBadge";
import { getOrderProgressStatus, getStagesOutsideLabel } from "../../utils/barcodeService";
import { Chips, FilterGroup, Pager, num } from "../CeoDashboard/CeoUi";
import { ListTools, Stat, defineKit, slug } from "../CeoDashboard/dashKit";
import { CARD_INFO, COLUMN_INFO, TILE_INFO } from "./pmDefinitions";
import {
  atVendor, channelOf, clientOf, daysAtStage, daysLeft, dueDay, hasPromise, isLate, isRunning, isUrgent, overdueDays, pieceName, pieceState, plural,
  productsOf, stageName,
} from "./pmModel";

/** Download a list of plain objects as CSV (the keys are the column names). */
export function csvFromObjects(title, list) {
  if (!list.length) return 0;
  const headers = Object.keys(list[0]);
  return downloadCsv({ filename: `production_${slug(title)}`, headers, rows: list.map((r) => headers.map((h) => r[h] ?? "")) });
}

// ============================================================
// Pieces every Production Manager page uses: the order and piece tables (for
// pages and side panels), their CSV exports, and the small cells inside them.
// Nothing here shows money or client contact details.
// ============================================================

export const { Tile, Card, Table } = defineKit({ tiles: TILE_INFO, cards: CARD_INFO, columns: COLUMN_INFO });

/** Three dots that pulse in turn: something is loading. Use instead of a static "…". */
export const Dots = () => <span className="pm-dots" role="status" aria-label="Loading"><i /><i /><i /></span>;
/** A loading message with the moving dots, where a list or chart will appear. */
export const Loading = ({ text = "Loading" }) => <div className="ceo-empty pm-loading" role="status"><span>{text}</span><Dots /></div>;

/** Order number with the client and products under it. */
export function OrderCell({ o, ctx }) {
  const who = clientOf(o, ctx?.vendorMap);
  return (
    <span className="pm-cell">
      <b>{o.order_no}{isUrgent(o) && <i className="pm-tag is-urgent">Urgent</i>}</b>
      <small>{[who, productsOf(o)].filter(Boolean).join(" · ") || "–"}</small>
    </span>
  );
}

/** The warehouse (T-2) date with how many days are left, or how late it is. */
export function DueCell({ o }) {
  const d = dueDay(o);
  if (!d) return <span className="pm-muted">No date</span>;
  const left = daysLeft(o);
  const running = isRunning(o);
  const late = isLate(o);
  return (
    <span className="pm-cell is-right">
      <b>{formatDate(d)}</b>
      {running && left != null && (hasPromise(o) ? (
        <small className={late ? "pm-late" : left <= 2 ? "pm-soon" : undefined}>
          {left < 0 ? `${plural(-left, "day")} late` : left === 0 ? "Due today" : `${plural(left, "day")} left`}
        </small>
      ) : (
        // Website and internal stock orders are not promised to a client by a date.
        <small>{left < 0 ? `${plural(-left, "day")} past · not counted late` : left === 0 ? "Due today" : `${plural(left, "day")} left`}</small>
      ))}
    </span>
  );
}

/** Where the order is, in the shared five-step words. */
export const orderStatus = (o, comps) => getOrderProgressStatus(o, comps);

/** How the order's pieces are spread: "2 of 3 finished · 1 at vendor". */
export function piecesLine(comps = []) {
  const live = comps.filter((c) => !c.cancelled_at);
  if (!live.length) return "No pieces yet";
  const n = (s) => live.filter((c) => pieceState(c) === s).length;
  const parts = [`${n("finished")} of ${live.length} finished`];
  if (n("at_wh2")) parts.push(`${n("at_wh2")} at Delhi (2)`);
  if (n("at_vendor")) parts.push(`${n("at_vendor")} at vendor`);
  if (n("not_started")) parts.push(`${n("not_started")} not started`);
  if (n("disposed")) parts.push(`${n("disposed")} disposed`);
  return parts.join(" · ");
}

export function orderRows(orders, ctx) {
  return orders.map((o) => {
    const comps = ctx.componentsByOrder[o.id] || [];
    const d = dueDay(o);
    return {
      "Order No": o.order_no,
      Channel: channelOf(o),
      Client: clientOf(o, ctx.vendorMap),
      Products: productsOf(o),
      Priority: isUrgent(o) ? "Urgent" : "Normal",
      Status: orderStatus(o, comps),
      Pieces: piecesLine(comps),
      "Order Date": formatDate(o.created_at),
      "Due Date (T-2)": d ? formatDate(d) : "",
      "Client Delivery Date": o.delivery_date ? formatDate(o.delivery_date) : "",
      "Days Left": isRunning(o) && daysLeft(o) != null ? daysLeft(o) : "",
      Notes: o.notes || "",
    };
  });
}
export const exportOrders = (title, orders, ctx) => csvFromObjects(title, orderRows(orders, ctx));

export function pieceRows(pieces, ctx) {
  return pieces.map((c) => {
    const o = ctx.ordersById[c.order_id] || {};
    return {
      "Order No": c.order_no || o.order_no,
      Barcode: c.barcode,
      Piece: pieceName(c),
      Stage: stageName(c),
      Where: c.is_outside_wh ? `At ${c.vendor_name || "vendor"}${c.stages_outside ? ` (${getStagesOutsideLabel(c.stages_outside) || ""})` : ""}` : "Warehouse",
      "Days at Stage": daysAtStage(c) ?? "",
      "Days Past Stage Limit": overBy(c) || "",
      Client: clientOf(o, ctx.vendorMap),
      Channel: o.id ? channelOf(o) : "",
      "Due Date (T-2)": dueDay(o) ? formatDate(dueDay(o)) : "",
    };
  });
}
export const exportPieces = (title, pieces, ctx) => csvFromObjects(title, pieceRows(pieces, ctx));

const PAGE = 12;

// ------------------------------------------------------------ list tools
// The lists in side panels get the same toolbar as the pages: a search box,
// a Filters button (the filters open inside the panel, under the toolbar)
// and Export CSV. Sorting is one of the filters.
const lc = (v) => String(v || "").toLowerCase();
const countBy = (list, keyOf) => {
  const m = {};
  list.forEach((x) => { const k = keyOf(x); if (k) m[k] = (m[k] || 0) + 1; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k]) => ({ value: k, label: k }));
};
const many = (...vals) => vals.filter((v) => (Array.isArray(v) ? v.length : v)).length;

const ORDER_SORTS = [
  { value: "due", label: "Due date, soonest" }, { value: "late", label: "Most late" },
  { value: "new", label: "Newest order" }, { value: "old", label: "Oldest order" }, { value: "no", label: "Order number" },
];
const TIMING = [
  { value: "late", label: "Late" }, { value: "week", label: "Due in 7 days" }, { value: "later", label: "Due later" }, { value: "none", label: "No due date" },
];
const timingOf = (o) => {
  if (!dueDay(o)) return "none";
  if (isLate(o)) return "late";
  const left = daysLeft(o);
  return left != null && left <= 7 && isRunning(o) ? "week" : "later";
};

/** A list of orders, for a page or a side panel. Click a row to open the order. */
export function OrdersTable({ ctx, orders, title, stats = true, sort = "due", empty = "No orders here." }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [sortBy, setSortBy] = useState(sort === "due" ? "due" : "new");
  const [channels, setChannels] = useState([]);
  const [timing, setTiming] = useState([]);
  const [urgent, setUrgent] = useState(false);
  const channelChoices = useMemo(() => countBy(orders, channelOf), [orders]);
  const sorted = useMemo(() => {
    const q = lc(search).trim();
    const list = orders.filter((o) => (!channels.length || channels.includes(channelOf(o)))
      && (!timing.length || timing.includes(timingOf(o)))
      && (!urgent || isUrgent(o))
      && (!q || [o.order_no, clientOf(o, ctx.vendorMap), productsOf(o), o.shopify_order_name, o.po_number, o.salesperson].some((v) => lc(v).includes(q))));
    const due = (o) => (dueDay(o) || 8.64e15) - 0;
    if (sortBy === "due") list.sort((a, b) => due(a) - due(b));
    else if (sortBy === "late") list.sort((a, b) => (daysLeft(a) ?? 1e9) - (daysLeft(b) ?? 1e9));
    else if (sortBy === "old") list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    else if (sortBy === "no") list.sort((a, b) => String(a.order_no).localeCompare(String(b.order_no)));
    else list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return list;
  }, [orders, sortBy, channels, timing, urgent, search, ctx.vendorMap]);
  useEffect(() => { setPage(1); }, [sortBy, channels, timing, urgent, search]);
  const late = sorted.filter((o) => isLate(o)).length;
  const pieces = sorted.reduce((s, o) => s + (ctx.componentsByOrder[o.id] || []).filter((c) => !c.cancelled_at).length, 0);
  const active = many(channels, timing, urgent) + (sortBy !== (sort === "due" ? "due" : "new") ? 1 : 0);
  return (
    <>
      {stats && (
        <div className="ceo-dstats">
          <Stat label="Orders" info="The orders in this list."><b>{num(sorted.length)}</b></Stat>
          <Stat label="Pieces" info="Barcoded garment pieces in these orders, not counting cancelled ones."><b>{num(pieces)}</b></Stat>
          <Stat label="Late" info="Orders still in production after their due date (T-2). Website and stock orders are not counted."><b className={late ? "is-warn" : undefined}>{num(late)}</b></Stat>
        </div>
      )}
      <ListTools search={search} onSearch={setSearch} placeholder="Search order, client or product" filters={active} onFilters={() => setOpen((v) => !v)}
        onExport={() => exportOrders(title, sorted, ctx)} exportDisabled={!sorted.length} />
      {open && (
        <div className="pm-inline-filters">
          <FilterGroup label="Sort By"><Chips options={ORDER_SORTS} value={sortBy} onChange={(v) => setSortBy(v || "due")} /></FilterGroup>
          <FilterGroup label="Due"><Chips options={TIMING} value={timing} onChange={setTiming} /></FilterGroup>
          <FilterGroup label="Priority"><Chips options={[{ value: "urgent", label: "Urgent only" }]} value={urgent ? "urgent" : ""} onChange={(v) => setUrgent(v === "urgent")} /></FilterGroup>
          {channelChoices.length > 1 && <FilterGroup label="Channel"><Chips options={channelChoices} value={channels} onChange={setChannels} /></FilterGroup>}
          <div className="pm-inline-foot">
            <button type="button" className="ceo-btn" onClick={() => { setSortBy(sort === "due" ? "due" : "new"); setChannels([]); setTiming([]); setUrgent(false); }}>Clear Filters</button>
            <button type="button" className="ceo-btn is-primary" onClick={() => setOpen(false)}>Show {num(sorted.length)} orders</button>
          </div>
        </div>
      )}
      <Table
        rowKey={(r) => r.id}
        rows={sorted.slice((page - 1) * PAGE, page * PAGE)}
        onRow={ctx.openOrder}
        empty={orders.length ? "No orders match these filters." : empty}
        columns={[
          { key: "order", label: "Order", render: (o) => <OrderCell o={o} ctx={ctx} /> },
          { key: "status", label: "Status", hide: true, render: (o) => <span className="pm-cell"><b>{orderStatus(o, ctx.componentsByOrder[o.id])}</b><small>{piecesLine(ctx.componentsByOrder[o.id])}</small></span> },
          { key: "due", label: "Due Date", right: true, render: (o) => <DueCell o={o} /> },
        ]}
      />
      <Pager page={page} pages={Math.ceil(sorted.length / PAGE)} onChange={setPage} />
    </>
  );
}

const PIECE_SORTS = [
  { value: "", label: "As listed" }, { value: "age", label: "Longest at stage" }, { value: "over", label: "Most over the limit" },
  { value: "due", label: "Due date, soonest" }, { value: "no", label: "Order number" },
];
const WHERE = {
  in_house: "In Delhi (1)", at_wh2: "At Delhi (2)", at_vendor: "At a vendor", not_started: "Not started",
  finished: "Finished", disposed: "Disposed", removed: "Cancelled",
};
// Finished pieces are past every stage limit by definition; they are never "over the limit".
const overBy = (c) => (["finished", "disposed", "removed"].includes(pieceState(c)) ? 0 : overdueDays(c) || 0);
const kindName = (c) => String(c.component_type || "Piece").replace(/^\w/, (x) => x.toUpperCase());

/** A list of pieces. Click a row to open its order. */
export function PiecesTable({ ctx, pieces: all, title, stats = true, empty = "No pieces here." }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [sortBy, setSortBy] = useState("");
  const [where, setWhere] = useState([]);
  const [kinds, setKinds] = useState([]);
  const [stages, setStages] = useState([]);
  const [overOnly, setOverOnly] = useState(false);
  const choices = useMemo(() => ({
    where: countBy(all, (c) => WHERE[pieceState(c)]),
    kinds: countBy(all, kindName),
    stages: countBy(all, stageName),
  }), [all]);
  const pieces = useMemo(() => {
    const q = lc(search).trim();
    const list = all.filter((c) => (!where.length || where.includes(WHERE[pieceState(c)]))
      && (!kinds.length || kinds.includes(kindName(c)))
      && (!stages.length || stages.includes(stageName(c)))
      && (!overOnly || overBy(c) > 0)
      && (!q || [c.barcode, c.order_no, pieceName(c), c.vendor_name, clientOf(ctx.ordersById[c.order_id] || {}, ctx.vendorMap)].some((v) => lc(v).includes(q))));
    if (sortBy === "age") list.sort((a, b) => (daysAtStage(b) ?? -1) - (daysAtStage(a) ?? -1));
    else if (sortBy === "over") list.sort((a, b) => overBy(b) - overBy(a));
    else if (sortBy === "due") { const d = (c) => (dueDay(ctx.ordersById[c.order_id] || {}) || 8.64e15) - 0; list.sort((a, b) => d(a) - d(b)); }
    else if (sortBy === "no") list.sort((a, b) => String(a.barcode || a.order_no).localeCompare(String(b.barcode || b.order_no)));
    return list;
  }, [all, search, where, kinds, stages, overOnly, sortBy, ctx.ordersById, ctx.vendorMap]);
  useEffect(() => { setPage(1); }, [search, where, kinds, stages, overOnly, sortBy]);
  const orders = new Set(pieces.map((c) => c.order_id)).size;
  const vendor = pieces.filter(atVendor).length;
  const active = many(where, kinds, stages, overOnly, sortBy);
  return (
    <>
      {stats && (
        <div className="ceo-dstats">
          <Stat label="Pieces" info="Garment pieces in this list."><b>{num(pieces.length)}</b></Stat>
          <Stat label="Orders" info="The orders these pieces belong to."><b>{num(orders)}</b></Stat>
          <Stat label="At Vendors" info="Pieces in this list that are out with an outside vendor right now. Our own SB WH Delhi (2) is not a vendor."><b>{num(vendor)}</b></Stat>
        </div>
      )}
      <ListTools search={search} onSearch={setSearch} placeholder="Search barcode, order, client or vendor" filters={active} onFilters={() => setOpen((v) => !v)}
        onExport={() => exportPieces(title, pieces, ctx)} exportDisabled={!pieces.length} />
      {open && (
        <div className="pm-inline-filters">
          <FilterGroup label="Sort By"><Chips options={PIECE_SORTS} value={sortBy} onChange={(v) => setSortBy(v || "")} /></FilterGroup>
          <FilterGroup label="Show"><Chips options={[{ value: "over", label: "Over the stage time limit" }]} value={overOnly ? "over" : ""} onChange={(v) => setOverOnly(v === "over")} /></FilterGroup>
          {choices.where.length > 1 && <FilterGroup label="Where It Is"><Chips options={choices.where} value={where} onChange={setWhere} /></FilterGroup>}
          {choices.kinds.length > 1 && <FilterGroup label="Piece"><Chips options={choices.kinds} value={kinds} onChange={setKinds} /></FilterGroup>}
          {choices.stages.length > 1 && <FilterGroup label="Stage"><Chips options={choices.stages} value={stages} onChange={setStages} /></FilterGroup>}
          <div className="pm-inline-foot">
            <button type="button" className="ceo-btn" onClick={() => { setSortBy(""); setWhere([]); setKinds([]); setStages([]); setOverOnly(false); }}>Clear Filters</button>
            <button type="button" className="ceo-btn is-primary" onClick={() => setOpen(false)}>Show {num(pieces.length)} pieces</button>
          </div>
        </div>
      )}
      <Table
        rowKey={(r) => r.id}
        rows={pieces.slice((page - 1) * PAGE, page * PAGE)}
        onRow={(c) => ctx.ordersById[c.order_id] && ctx.openOrder(ctx.ordersById[c.order_id])}
        empty={all.length ? "No pieces match these filters." : empty}
        columns={[
          { key: "piece", label: "Piece", render: (c) => <span className="pm-cell"><b>{pieceName(c)} <span className="pm-code">{c.barcode}</span></b><small>{clientOf(ctx.ordersById[c.order_id] || {}, ctx.vendorMap) || c.order_no}</small></span> },
          { key: "stage", label: "Stage", hide: true, render: (c) => <span className="ceo-keep"><ComponentStageBadge comp={c} /></span> },
          {
            key: "age", label: "At Stage", right: true, render: (c) => {
              const od = overBy(c);
              const at = daysAtStage(c);
              return <span className="pm-cell is-right"><b>{at == null ? "–" : plural(at, "day")}</b>{od > 0 && <small className="pm-late">{plural(od, "day")} over limit</small>}</span>;
            },
          },
        ]}
      />
      <Pager page={page} pages={Math.ceil(pieces.length / PAGE)} onChange={setPage} />
    </>
  );
}

/** A soft label: "Urgent", "Late", "At vendor". */
export const Pill = ({ tone = "gold", children }) => <i className={`pm-tag is-${tone}`}>{children}</i>;
