import React, { useMemo, useState } from "react";
import formatDate from "../../utils/formatDate";
import downloadCsv from "../../utils/downloadCsv";
import ComponentStageBadge from "../../components/ComponentStageBadge";
import { getOrderProgressStatus, getStagesOutsideLabel } from "../../utils/barcodeService";
import { Pager, num } from "../CeoDashboard/CeoUi";
import { CsvButton, Stat, defineKit, slug } from "../CeoDashboard/dashKit";
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
      "Days Past Stage Limit": overdueDays(c) || "",
      Client: clientOf(o, ctx.vendorMap),
      Channel: o.id ? channelOf(o) : "",
      "Due Date (T-2)": dueDay(o) ? formatDate(dueDay(o)) : "",
    };
  });
}
export const exportPieces = (title, pieces, ctx) => csvFromObjects(title, pieceRows(pieces, ctx));

const PAGE = 12;

/** A list of orders, for a page or a side panel. Click a row to open the order. */
export function OrdersTable({ ctx, orders, title, stats = true, sort = "due", empty = "No orders here." }) {
  const [page, setPage] = useState(1);
  const sorted = useMemo(() => {
    const list = [...orders];
    if (sort === "due") list.sort((a, b) => (dueDay(a) || 8.64e15) - (dueDay(b) || 8.64e15));
    else list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return list;
  }, [orders, sort]);
  const late = sorted.filter((o) => isLate(o)).length;
  const pieces = sorted.reduce((s, o) => s + (ctx.componentsByOrder[o.id] || []).filter((c) => !c.cancelled_at).length, 0);
  return (
    <>
      {stats && (
        <div className="ceo-dstats">
          <Stat label="Orders" info="The orders in this list."><b>{num(sorted.length)}</b></Stat>
          <Stat label="Pieces" info="Barcoded garment pieces in these orders, not counting cancelled ones."><b>{num(pieces)}</b></Stat>
          <Stat label="Late" info="Orders still in production after their due date (T-2). Website and stock orders are not counted."><b className={late ? "is-warn" : undefined}>{num(late)}</b></Stat>
        </div>
      )}
      <div className="gm-actions"><CsvButton disabled={!sorted.length} onClick={() => exportOrders(title, sorted, ctx)} /></div>
      <Table
        rowKey={(r) => r.id}
        rows={sorted.slice((page - 1) * PAGE, page * PAGE)}
        onRow={ctx.openOrder}
        empty={empty}
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

/** A list of pieces. Click a row to open its order. */
export function PiecesTable({ ctx, pieces, title, stats = true, empty = "No pieces here." }) {
  const [page, setPage] = useState(1);
  const orders = new Set(pieces.map((c) => c.order_id)).size;
  const vendor = pieces.filter(atVendor).length;
  return (
    <>
      {stats && (
        <div className="ceo-dstats">
          <Stat label="Pieces" info="Garment pieces in this list."><b>{num(pieces.length)}</b></Stat>
          <Stat label="Orders" info="The orders these pieces belong to."><b>{num(orders)}</b></Stat>
          <Stat label="At Vendors" info="Pieces in this list that are out with an outside vendor right now. Our own SB WH Delhi (2) is not a vendor."><b>{num(vendor)}</b></Stat>
        </div>
      )}
      <div className="gm-actions"><CsvButton disabled={!pieces.length} onClick={() => exportPieces(title, pieces, ctx)} /></div>
      <Table
        rowKey={(r) => r.id}
        rows={pieces.slice((page - 1) * PAGE, page * PAGE)}
        onRow={(c) => ctx.ordersById[c.order_id] && ctx.openOrder(ctx.ordersById[c.order_id])}
        empty={empty}
        columns={[
          { key: "piece", label: "Piece", render: (c) => <span className="pm-cell"><b>{pieceName(c)} <span className="pm-code">{c.barcode}</span></b><small>{clientOf(ctx.ordersById[c.order_id] || {}, ctx.vendorMap) || c.order_no}</small></span> },
          { key: "stage", label: "Stage", hide: true, render: (c) => <span className="ceo-keep"><ComponentStageBadge comp={c} /></span> },
          {
            key: "age", label: "At Stage", right: true, render: (c) => {
              const od = overdueDays(c);
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
