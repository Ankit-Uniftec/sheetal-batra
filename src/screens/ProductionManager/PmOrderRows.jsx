import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import formatDate from "../../utils/formatDate";
import { Empty, Icon, InfoTip, Thumb } from "../CeoDashboard/CeoUi";
import { orderStatus } from "./PmCommon";
import {
  channelOf, clientOf, daysLeft, dueDay, hasPromise, isDormant, isLate, isRunning, isUrgent, pieceName, pieceState, plural, stageName,
} from "./pmModel";

// ============================================================
// The full order row: everything the floor needs about an order, grouped and
// labelled, with every action on the row itself. Columns: Order · Products ·
// Client & Sales · Dates · Progress · Actions. The table scrolls sideways on
// small screens (nothing is pinned, so it never covers the content).
// No money and no client contact details.
// ============================================================

const HEAD = [
  { key: "order", label: "Order" },
  { key: "products", label: "Products" },
  { key: "people", label: "Client & Sales" },
  { key: "dates", label: "Dates", info: "Ordered: when the order was placed. Due (T-2): the warehouse date, two days before the client's delivery date. Delivery: the date promised to the client, and how it reaches them." },
  { key: "progress", label: "Progress", info: "Where the order stands, how many of its pieces are finished, and the stage each piece is at now." },
  { key: "act", label: "Actions" },
];

const colour = (c) => (c && typeof c === "object" ? c.name : c) || "";
const STATE_WORD = { finished: "Finished", at_vendor: "At vendor", at_wh2: "At Delhi (2)", not_started: "Not started", disposed: "Disposed", removed: "Cancelled" };
const short = (d) => (d ? formatDate(d) : "–");

/** A label and its value on one line: "Top  Choga · Hot Pink". */
const Line = ({ label, children, tone }) => (
  <span className={`pmo-line${tone ? ` is-${tone}` : ""}`}><i>{label}</i><span>{children}</span></span>
);

/** The "More" menu on a row, drawn over the page so the table never clips it. */
function RowMenu({ items }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", close);
    };
  }, [open]);
  const toggle = (e) => {
    e.stopPropagation();
    const r = btn.current.getBoundingClientRect();
    const h = items.length * 42 + 12;
    const top = r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6;
    setPos({ top, left: Math.max(8, Math.min(r.right - 220, window.innerWidth - 228)) });
    setOpen((v) => !v);
  };
  const host = document.querySelector(".ceo") || document.body;
  return (
    <>
      <button ref={btn} type="button" className="ceo-btn is-small pmo-more" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        More<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && pos && createPortal(
        <div className="pmo-menu" role="menu" style={{ top: pos.top, left: pos.left }} onMouseDown={(e) => e.stopPropagation()}>
          {items.filter(Boolean).map((it) => (
            <button key={it.label} type="button" role="menuitem" className={it.danger ? "is-danger" : undefined} disabled={it.disabled}
              onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick(); }}>
              <Icon name={it.icon} />{it.label}
            </button>
          ))}
        </div>,
        host,
      )}
    </>
  );
}

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
            const running = isRunning(o);
            const quiet = running && isDormant(o, comps);
            const left = daysLeft(o);
            const late = isLate(o);
            const busy = (k) => actions.busy === `${o.id}-${k}`;
            const status = orderStatus(o, comps);
            const ageDays = Math.max(0, Math.round((Date.now() - new Date(o.created_at)) / 864e5));
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
                        {late && <i className="pm-tag is-urgent">Late</i>}
                        {quiet && <i className="pm-tag">Quiet 30+ days</i>}
                        {o.is_alteration && <i className="pm-tag">Alteration</i>}
                      </span>
                    </span>
                  </span>
                </td>

                <td className="pmo-products">
                  {items.slice(0, 2).map((it, i) => (
                    <span key={`${it.product_name}-${i}`} className="pmo-item">
                      <b>{it.product_name || "–"}</b>
                      {it.top && <Line label="Top">{it.top}{colour(it.top_color) ? ` · ${colour(it.top_color)}` : ""}</Line>}
                      {it.bottom && <Line label="Bottom">{it.bottom}{colour(it.bottom_color) ? ` · ${colour(it.bottom_color)}` : ""}</Line>}
                      {(it.size || Number(it.quantity) > 1) && <Line label="Size">{it.size || "–"}{Number(it.quantity) > 1 ? ` · Qty ${it.quantity}` : ""}</Line>}
                      {Array.isArray(it.extras) && it.extras.length > 0 && <Line label="Extras">{it.extras.map((e) => e.name).filter(Boolean).join(", ")}</Line>}
                    </span>
                  ))}
                  {items.length > 2 && <small className="pm-muted">+{plural(items.length - 2, "more product")}</small>}
                </td>

                <td className="pmo-people">
                  <Line label="Client">{clientOf(o, ctx.vendorMap) || "–"}</Line>
                  {o.po_number && <Line label="PO">{o.po_number}</Line>}
                  <Line label="Sales">{o.salesperson || "–"}</Line>
                  {o.salesperson_store && o.salesperson_store !== o.salesperson && <Line label="Store">{o.salesperson_store}</Line>}
                </td>

                <td className="pmo-dates">
                  <Line label="Ordered">{short(o.created_at)} <em>{plural(ageDays, "day")} ago</em></Line>
                  <Line label="Due (T-2)" tone={late ? "late" : running && hasPromise(o) && left != null && left <= 2 ? "soon" : undefined}>
                    {short(dueDay(o))}
                    {running && left != null && <em>{left < 0 ? (hasPromise(o) ? `${plural(-left, "day")} late` : `${plural(-left, "day")} past`) : left === 0 ? "today" : `in ${plural(left, "day")}`}</em>}
                  </Line>
                  <Line label="Delivery">{short(o.delivery_date)} <em>{o.mode_of_delivery || ""}</em></Line>
                </td>

                <td className="pmo-progress">
                  <span className="pmo-status">
                    <b className={`pmo-pill is-${status.toLowerCase().replace(/\s+/g, "-")}`}>{status}</b>
                    <small>{live.length ? `${done} of ${plural(live.length, "piece")} finished` : "No pieces yet"}</small>
                  </span>
                  {live.length > 0 && <span className="pm-mini-bar pmo-bar"><i style={{ width: `${(done / live.length) * 100}%` }} /></span>}
                  <span className="pmo-chips">
                    {comps.slice(0, 4).map((c) => {
                      const st = pieceState(c);
                      const where = st === "at_vendor" ? `At ${c.vendor_name || "vendor"}` : st === "at_wh2" ? `${stageName(c)} · Delhi (2)` : st === "in_house" ? stageName(c) : STATE_WORD[st] || stageName(c);
                      return <span key={c.id} className={`pmo-chip is-${st}`} title={c.barcode}><b>{pieceName(c)}</b>{where}</span>;
                    })}
                    {comps.length > 4 && <small className="pm-muted">+{comps.length - 4} more pieces</small>}
                  </span>
                </td>

                <td className="pmo-act">
                  <span className="pmo-btns">
                    <button type="button" className="ceo-btn is-small" onClick={stop(() => ctx.openJourney(o))} disabled={!comps.length}><Icon name="movements" />Journey</button>
                    <button type="button" className="ceo-btn is-small" onClick={stop(() => actions.warehousePdf(o))} disabled={busy("pdf")}><Icon name="download" />{busy("pdf") ? "Opening" : "PDF"}</button>
                    <RowMenu items={[
                      { label: "Open order", icon: "orders", onClick: () => ctx.openOrder(o) },
                      { label: "Edit order", icon: "edit", onClick: () => actions.edit(o) },
                      { label: isUrgent(o) ? "Change priority" : "Set priority", icon: "alert", onClick: () => actions.priority(o) },
                      { label: "Move or override pieces", icon: "transfer", disabled: !comps.length, onClick: () => actions.override(o) },
                      running && { label: "Mark as completed", icon: "sale", disabled: busy("complete"), onClick: () => actions.complete(o) },
                      running && { label: "Cancel order", icon: "close", danger: true, onClick: () => actions.cancel(o) },
                    ]} />
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
