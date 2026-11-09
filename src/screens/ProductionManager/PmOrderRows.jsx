import React from "react";
import formatDate from "../../utils/formatDate";
import { Empty, Icon, InfoTip, Thumb } from "../CeoDashboard/CeoUi";
import { DueCell, orderStatus, piecesLine } from "./PmCommon";
import {
  channelOf, clientOf, daysLeft, isDormant, isRunning, isUrgent, pieceName, pieceState, plural, stageName,
} from "./pmModel";

// ============================================================
// The full order row: everything the floor needs about an order without
// opening it. The table scrolls sideways on smaller screens; the order number
// and photo stay pinned on the left. Click a row for the full order panel.
// No money and no client contact details.
// ============================================================

const HEAD = [
  { key: "order", label: "Order" },
  { key: "products", label: "Products" },
  { key: "client", label: "Client" },
  { key: "dates", label: "Order Date", info: "The day the order was placed." },
  { key: "due", label: "Due Date", info: "The warehouse date: two days before the client's delivery date." },
  { key: "delivery", label: "Client Delivery", info: "The date promised to the client, and how it will reach them." },
  { key: "status", label: "Status", info: "Where the order stands, worked out from its pieces, with how many pieces are finished." },
  { key: "pieces", label: "Pieces Now", info: "Each piece of the order and the stage it is at now." },
  { key: "sales", label: "Salesperson" },
  { key: "act", label: "" },
];

const optionLine = (it) => [
  it.top && `${it.top}${it.top_color?.name ? ` (${it.top_color.name})` : ""}`,
  it.bottom && `${it.bottom}${it.bottom_color?.name ? ` (${it.bottom_color.name})` : ""}`,
  it.size && `Size ${it.size}`,
  Number(it.quantity) > 1 && `Qty ${it.quantity}`,
].filter(Boolean).join(" · ");

export default function OrderRows({ ctx, rows }) {
  const { componentsByOrder, actions } = ctx;
  if (!rows.length) return <Empty text="No orders match." />;
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  return (
    <div className="ceo-table-wrap pmo-wrap">
      <table className="ceo-table pmo-table">
        <thead>
          <tr>{HEAD.map((h) => <th key={h.key} className={`pmo-${h.key}`}>{h.info ? <InfoTip text={h.info}>{h.label}</InfoTip> : h.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const comps = componentsByOrder[o.id] || [];
            const live = comps.filter((c) => !c.cancelled_at);
            const done = live.filter((c) => pieceState(c) === "finished").length;
            const items = o.items || [];
            const first = items[0] || {};
            const quiet = isRunning(o) && isDormant(o, comps);
            const left = daysLeft(o);
            const busyPdf = actions.busy === `${o.id}-pdf`;
            return (
              <tr key={o.id} className="is-link" tabIndex={0} onClick={() => ctx.openOrder(o)} onKeyDown={(e) => { if (e.key === "Enter") ctx.openOrder(o); }}>
                <td className="pmo-order">
                  <span className="pmo-ordercell">
                    <Thumb src={first.image_url} alt={first.product_name || ""} />
                    <span>
                      <b>{o.order_no}</b>
                      <small>{channelOf(o)}</small>
                      <span className="pmo-tags">
                        {isUrgent(o) && <i className="pm-tag is-urgent">Urgent</i>}
                        {quiet && <i className="pm-tag">Quiet 30+ days</i>}
                        {o.is_alteration && <i className="pm-tag">Alteration</i>}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="pmo-products">
                  {items.slice(0, 2).map((it, i) => (
                    <span key={`${it.product_name}-${i}`} className="pm-cell pmo-item">
                      <b>{it.product_name || "–"}</b>
                      <small>{optionLine(it) || "–"}</small>
                      {Array.isArray(it.extras) && it.extras.length > 0 && <small>Extras: {it.extras.map((e) => e.name).filter(Boolean).join(", ")}</small>}
                    </span>
                  ))}
                  {items.length > 2 && <small className="pm-muted">+{plural(items.length - 2, "more product")}</small>}
                </td>
                <td className="pmo-client"><span className="pm-cell"><b>{clientOf(o, ctx.vendorMap) || "–"}</b>{o.po_number && <small>PO {o.po_number}</small>}</span></td>
                <td className="pmo-dates"><span className="pm-cell"><b>{formatDate(o.created_at)}</b><small>{plural(Math.max(0, Math.round((Date.now() - new Date(o.created_at)) / 864e5)), "day")} ago</small></span></td>
                <td className="pmo-due"><DueCell o={o} /></td>
                <td className="pmo-delivery"><span className="pm-cell"><b>{o.delivery_date ? formatDate(o.delivery_date) : "–"}</b><small>{o.mode_of_delivery || "–"}</small></span></td>
                <td className="pmo-status">
                  <span className="pm-cell">
                    <b>{orderStatus(o, comps)}</b>
                    <small>{piecesLine(comps)}</small>
                    {live.length > 0 && <span className="pm-mini-bar"><i style={{ width: `${(done / live.length) * 100}%` }} /></span>}
                    {isRunning(o) && left != null && left < 0 && <small className="pm-late">{plural(-left, "day")} past due</small>}
                  </span>
                </td>
                <td className="pmo-pieces">
                  <span className="pmo-chips">
                    {comps.slice(0, 5).map((c) => (
                      <span key={c.id} className={`pmo-chip is-${pieceState(c)}`} title={c.barcode}>
                        <b>{pieceName(c)}</b>
                        {pieceState(c) === "at_vendor" ? `At ${c.vendor_name || "vendor"}` : pieceState(c) === "at_wh2" ? `Delhi (2) · ${stageName(c)}` : stageName(c)}
                      </span>
                    ))}
                    {comps.length > 5 && <small className="pm-muted">+{comps.length - 5} more</small>}
                    {!comps.length && <small className="pm-muted">No pieces yet</small>}
                  </span>
                </td>
                <td className="pmo-sales"><span className="pm-cell"><b>{o.salesperson || "–"}</b>{o.salesperson_store && o.salesperson_store !== o.salesperson && <small>{o.salesperson_store}</small>}</span></td>
                <td className="pmo-act">
                  <span className="pmo-btns">
                    <button type="button" className="ceo-btn is-small" onClick={stop(() => ctx.openJourney(o))} disabled={!comps.length} title="View the production journey"><Icon name="movements" />Journey</button>
                    <button type="button" className="ceo-btn is-small" onClick={stop(() => actions.warehousePdf(o))} disabled={busyPdf} title="Open the warehouse PDF"><Icon name="download" />{busyPdf ? "Opening" : "PDF"}</button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
