import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import formatDate from "../../utils/formatDate";
import { supabase } from "../../lib/supabaseClient";
import { Empty, Icon, InfoTip, Thumb } from "../CeoDashboard/CeoUi";
import { orderStatus } from "./PmCommon";
import {
  channelOf, clientOf, daysLeft, dueDay, hasPromise, isDormant, isLate, isRunning, isUrgent, pieceName, pieceState, plural, stageName,
} from "./pmModel";

// ============================================================
// The order table: one value per column, so every column reads the same way
// down the page. An order with several products takes one line per product;
// the order's own columns (dates, status, actions…) span those lines.
// Colours show as a swatch with their name. The table scrolls sideways on
// smaller screens; nothing is pinned. No money and no client contact details.
// ============================================================

const COLS = [
  { key: "order", label: "Order" },
  { key: "product", label: "Product" },
  { key: "top", label: "Top" },
  { key: "bottom", label: "Bottom" },
  { key: "dupatta", label: "Dupatta & Extras" },
  { key: "size", label: "Size" },
  { key: "qty", label: "Qty" },
  { key: "client", label: "Client" },
  { key: "po", label: "PO No" },
  { key: "sales", label: "Salesperson" },
  { key: "ordered", label: "Order Date" },
  { key: "due", label: "Due Date", info: "The warehouse date: two days before the client's delivery date (the real date when the order had less than two days to run)." },
  { key: "delivery", label: "Delivery Date", info: "The date promised to the client." },
  { key: "mode", label: "Delivery Mode" },
  { key: "status", label: "Status", info: "Where the order stands, worked out from its pieces." },
  { key: "done", label: "Pieces Done", info: "Pieces finished out of all the order's pieces." },
  { key: "now", label: "Pieces Now", info: "Each piece and the stage it is at right now." },
  { key: "act", label: "Actions" },
];
const MAX_PRODUCTS = 3;

// Colour names → hex, for items that stored a name only. Loaded once.
let colourCache = null;
function useColourHex() {
  const [map, setMap] = useState(colourCache || {});
  useEffect(() => {
    if (colourCache) return;
    supabase.from("colors").select("name, hex").then(({ data }) => {
      colourCache = Object.fromEntries((data || []).map((c) => [String(c.name).toLowerCase(), c.hex]));
      setMap(colourCache);
    });
  }, []);
  return map;
}

/** A colour as a swatch with its name. */
function Colour({ value, hexOf }) {
  const name = value && typeof value === "object" ? value.name : value;
  if (!name) return null;
  const hex = (value && typeof value === "object" && value.hex) || hexOf[String(name).toLowerCase()] || null;
  return (
    <span className="pmo-colour">
      <i style={hex ? { background: hex } : undefined} className={hex ? undefined : "is-unknown"} />
      {name}
    </span>
  );
}

/** A garment and its colour in one cell. */
function Garment({ name, colour, hexOf }) {
  if (!name && !colour) return <span className="pm-muted">–</span>;
  return (
    <span className="pmo-garment">
      {name && <b>{name}</b>}
      <Colour value={colour} hexOf={hexOf} />
    </span>
  );
}

/** The "More" menu on a row, drawn over the page so the table never clips it. */
function RowMenu({ items }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", close);
    document.querySelector(".ceo-scroll")?.addEventListener("scroll", close);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", close);
      document.querySelector(".ceo-scroll")?.removeEventListener("scroll", close);
    };
  }, [open]);
  const shown = items.filter(Boolean);
  const toggle = (e) => {
    e.stopPropagation();
    const r = btn.current.getBoundingClientRect();
    const h = shown.length * 42 + 12;
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
          {shown.map((it) => (
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

/** A date with a small note under it. */
const DateCell = ({ date, note, tone }) => (
  <span className="pmo-date">
    <b>{date ? formatDate(date) : "–"}</b>
    {note && <small className={tone ? `is-${tone}` : undefined}>{note}</small>}
  </span>
);

export default function OrderRows({ ctx, rows }) {
  const { componentsByOrder, actions } = ctx;
  const hexOf = useColourHex();
  if (!rows.length) return <Empty text="No orders match." />;
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  return (
    <div className="ceo-table-wrap pmo-wrap">
      <table className="ceo-table pmo-table">
        <thead>
          <tr>{COLS.map((c) => <th key={c.key} className={`pmo-${c.key}`}>{c.info ? <InfoTip text={c.info}>{c.label}</InfoTip> : c.label}</th>)}</tr>
        </thead>
        {rows.map((o, idx) => {
          const comps = componentsByOrder[o.id] || [];
          const live = comps.filter((c) => !c.cancelled_at);
          const done = live.filter((c) => pieceState(c) === "finished").length;
          const items = (o.items || []).length ? o.items : [{}];
          const shownItems = items.slice(0, MAX_PRODUCTS);
          const span = shownItems.length + (items.length > MAX_PRODUCTS ? 1 : 0);
          const running = isRunning(o);
          const quiet = running && isDormant(o, comps);
          const left = daysLeft(o);
          const late = isLate(o);
          const busy = (k) => actions.busy === `${o.id}-${k}`;
          const status = orderStatus(o, comps);
          const ageDays = Math.max(0, Math.round((Date.now() - new Date(o.created_at)) / 864e5));
          const dueNote = !running || left == null ? null
            : left < 0 ? (hasPromise(o) ? `${plural(-left, "day")} late` : `${plural(-left, "day")} past`)
              : left === 0 ? "Due today" : `In ${plural(left, "day")}`;
          const dueTone = late ? "late" : running && hasPromise(o) && left != null && left <= 2 ? "soon" : null;
          const open = () => ctx.openOrder(o);
          const R = { rowSpan: span };

          return (
            <tbody key={o.id} className={`pmo-group${idx % 2 ? " is-alt" : ""}`} onClick={open}>
              {shownItems.map((it, i) => (
                <tr key={i} className="is-link">
                  {i === 0 && (
                    <td {...R} className="pmo-order">
                      <span className="pmo-ordercell">
                        <Thumb src={it.image_url} alt={it.product_name || ""} />
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
                  )}
                  <td className="pmo-product"><span className="pmo-pname">{it.product_name || "–"}</span></td>
                  <td className="pmo-top"><Garment name={it.top} colour={it.top_color} hexOf={hexOf} /></td>
                  <td className="pmo-bottom"><Garment name={it.bottom} colour={it.bottom_color} hexOf={hexOf} /></td>
                  <td className="pmo-dupatta">
                    {(it.dupatta_color || (Array.isArray(it.extras) && it.extras.length > 0)) ? (
                      <span className="pmo-extras">
                        {it.dupatta_color && <span className="pmo-garment"><b>Dupatta</b><Colour value={it.dupatta_color} hexOf={hexOf} /></span>}
                        {(it.extras || []).map((e, k) => <span key={k} className="pmo-garment"><b>{e.name || "Extra"}</b><Colour value={e.color} hexOf={hexOf} /></span>)}
                      </span>
                    ) : <span className="pm-muted">–</span>}
                  </td>
                  <td className="pmo-size">{it.size ? <span className="pmo-size-pill">{it.size}</span> : <span className="pm-muted">–</span>}</td>
                  <td className="pmo-qty">{Number(it.quantity) || 1}</td>
                  {i === 0 && (
                    <>
                      <td {...R} className="pmo-client">{clientOf(o, ctx.vendorMap) || <span className="pm-muted">–</span>}</td>
                      <td {...R} className="pmo-po">{o.po_number || <span className="pm-muted">–</span>}</td>
                      <td {...R} className="pmo-sales"><span className="pmo-two"><b>{o.salesperson || "–"}</b>{o.salesperson_store && o.salesperson_store !== o.salesperson && <small>{o.salesperson_store}</small>}</span></td>
                      <td {...R} className="pmo-ordered"><DateCell date={o.created_at} note={ageDays === 0 ? "Today" : `${plural(ageDays, "day")} ago`} /></td>
                      <td {...R} className="pmo-due"><DateCell date={dueDay(o)} note={dueNote} tone={dueTone} /></td>
                      <td {...R} className="pmo-delivery"><DateCell date={o.delivery_date} /></td>
                      <td {...R} className="pmo-mode">{o.mode_of_delivery || <span className="pm-muted">–</span>}</td>
                      <td {...R} className="pmo-status"><b className={`pmo-pill is-${status.toLowerCase().replace(/\s+/g, "-")}`}>{status}</b></td>
                      <td {...R} className="pmo-done">
                        {live.length ? (
                          <span className="pmo-done-cell">
                            <b>{done} / {live.length}</b>
                            <span className="pm-mini-bar"><i style={{ width: `${(done / live.length) * 100}%` }} /></span>
                          </span>
                        ) : <span className="pm-muted">No pieces yet</span>}
                      </td>
                      <td {...R} className="pmo-now">
                        <span className="pmo-chips">
                          {comps.slice(0, 5).map((c) => {
                            const st = pieceState(c);
                            const where = st === "at_vendor" ? `At ${c.vendor_name || "vendor"}` : st === "at_wh2" ? `${stageName(c)} · Delhi (2)` : st === "not_started" ? "Not started" : st === "finished" ? "Finished" : st === "disposed" ? "Disposed" : st === "removed" ? "Cancelled" : stageName(c);
                            return <span key={c.id} className={`pmo-chip is-${st}`} title={c.barcode}><b>{pieceName(c)}</b><span>{where}</span></span>;
                          })}
                          {comps.length > 5 && <small className="pm-muted">+{comps.length - 5} more</small>}
                          {!comps.length && <span className="pm-muted">–</span>}
                        </span>
                      </td>
                      <td {...R} className="pmo-act" onClick={(e) => e.stopPropagation()}>
                        <span className="pmo-btns">
                          <button type="button" className="ceo-btn is-small" onClick={stop(() => ctx.openJourney(o))} disabled={!comps.length}><Icon name="movements" />Journey</button>
                          <button type="button" className="ceo-btn is-small" onClick={stop(() => actions.warehousePdf(o))} disabled={busy("pdf")}><Icon name="download" />{busy("pdf") ? "Opening" : "PDF"}</button>
                          <RowMenu items={[
                            { label: "Open order", icon: "orders", onClick: open },
                            { label: "Edit order", icon: "edit", onClick: () => actions.edit(o) },
                            { label: isUrgent(o) ? "Change priority" : "Set priority", icon: "alert", onClick: () => actions.priority(o) },
                            { label: "Move or override pieces", icon: "transfer", disabled: !comps.length, onClick: () => actions.override(o) },
                            running && { label: "Mark as completed", icon: "sale", disabled: busy("complete"), onClick: () => actions.complete(o) },
                            running && { label: "Cancel order", icon: "close", danger: true, onClick: () => actions.cancel(o) },
                          ]} />
                        </span>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {items.length > MAX_PRODUCTS && (
                <tr className="is-link"><td colSpan={6} className="pmo-moreprod">+{plural(items.length - MAX_PRODUCTS, "more product")} · open the order to see all</td></tr>
              )}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
