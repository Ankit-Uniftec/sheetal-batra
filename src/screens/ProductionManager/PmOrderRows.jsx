import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fmtDate as formatDate } from "./pmModel";
import { supabase } from "../../lib/supabaseClient";
import { getItemCategory } from "../../utils/itemCategory";
import { STAGE_GROUPS, getStageGroupKey } from "../../utils/barcodeService";
import { Empty, Icon, InfoTip, Thumb } from "../CeoDashboard/CeoUi";
import { orderStatus } from "./PmCommon";
import {
  channelOf, clientOf, daysLeft, dueDay, floorKey, hasPromise, isDormant, isLate, isRunning, isUrgent, pieceName, pieceState, plural, stageName,
} from "./pmModel";

// ============================================================
// The orders as cards (the Stock Room look): a header band with the order's
// number, dates, client and people, its status and tags; one line per
// product with the photo, category, size, quantity and each garment's colour;
// a pieces panel with progress and where each piece is; and a footer with the
// delivery mode and the actions. Clicking a card opens the order's side
// panel. No money and no client contact details.
// ============================================================

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


// ---- measurements and the pieces' stage tracks
const MEASURE_LABELS = {
  KurtaChogaKaftan: "Kurta / Choga / Kaftan", Blouse: "Blouse", Anarkali: "Anarkali", SalwarDhoti: "Salwar / Dhoti",
  ChuridaarTrouserPantsPlazo: "Churidaar / Trouser / Pants / Plazo", ShararaGharara: "Sharara / Gharara", Lehenga: "Lehenga",
};
/** The client's measurements on a product, by garment, in inches. */
function Measures({ m }) {
  const groups = Object.entries(m || {}).filter(([, f]) => f && typeof f === "object" && Object.values(f).some((v) => v !== "" && v != null));
  if (!groups.length) return <span className="pm-muted">Standard size, no measurements</span>;
  return (
    <span className="pmc-measures">
      {groups.map(([k, f]) => (
        <span key={k} className="pmc-mgroup">
          <b>{MEASURE_LABELS[k] || k}</b>
          {Object.entries(f).filter(([, v]) => v !== "" && v != null).map(([name, v]) => <i key={name}><small>{name}</small>{v}</i>)}
        </span>
      ))}
    </span>
  );
}

// The production stages a piece moves through (Order Received is the start, not a step).
const TRACK = STAGE_GROUPS.filter((g) => g.key !== "order_received");
/** One piece: its name, a dot per stage (done, now, to come) and where it is. */
function PieceTrack({ c }) {
  const st = pieceState(c);
  const key = floorKey(c) || getStageGroupKey(c.current_stage);
  const at = st === "finished" ? TRACK.length : st === "not_started" || st === "removed" ? -1 : TRACK.findIndex((g) => g.key === key);
  const where = st === "at_vendor" ? `${stageName(c).replace(/ In-Progress$/, "")} · at ${c.vendor_name || "a vendor"}`
    : st === "at_wh2" ? `${stageName(c)} · Delhi (2)` : st === "not_started" ? "Not started" : st === "finished" ? "Finished"
      : st === "disposed" ? "Disposed" : st === "removed" ? "Cancelled" : stageName(c);
  return (
    <div className={`pmc-ptrack is-${st}`} title={c.barcode}>
      <b className="pmc-pname">{pieceName(c)}</b>
      <span className="pmc-dots" aria-label={where}>
        {TRACK.map((g, i) => <i key={g.key} title={g.label} className={i < at ? "is-done" : i === at ? "is-now" : undefined} />)}
      </span>
      <span className="pmc-where">{where}</span>
    </div>
  );
}

/** A label over a value, for the card header. */
const HeadItem = ({ label, children, sub, tone }) => (
  <div className="pmc-hitem">
    <span className="pmc-hlabel">{label}</span>
    <span className="pmc-hvalue">{children}</span>
    {sub && <small className={tone ? `is-${tone}` : undefined}>{sub}</small>}
  </div>
);
/** A label beside a value, for the card body. */
const Line = ({ label, children }) => (
  <div className="pmc-line"><span className="pmc-label">{label}</span><span className="pmc-value">{children}</span></div>
);

export default function OrderRows({ ctx, rows }) {
  const { componentsByOrder, actions } = ctx;
  const hexOf = useColourHex();
  if (!rows.length) return <Empty text="No orders match." />;
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  return (
    <div className="pmc-list">
      {rows.map((o) => {
        const comps = componentsByOrder[o.id] || [];
        const live = comps.filter((c) => !c.cancelled_at);
        const done = live.filter((c) => pieceState(c) === "finished").length;
        const items = (o.items || []).filter((it) => it && !it.is_charge);
        const shownItems = (items.length ? items : [{}]).slice(0, MAX_PRODUCTS);
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
        const client = clientOf(o, ctx.vendorMap);
        return (
          <article key={o.id} className={`pmc-card${late ? " is-late" : ""}`} onClick={open} role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter") open(); }} aria-label={`Order ${o.order_no}`}>
            <header className="pmc-head">
              <HeadItem label="Order No" sub={channelOf(o)}>{o.order_no}</HeadItem>
              <HeadItem label="Order Date" sub={ageDays === 0 ? "Today" : `${plural(ageDays, "day")} ago`}>{formatDate(o.created_at)}</HeadItem>
              <HeadItem label={<InfoTip text="The warehouse date: two days before the client's delivery date.">Due Date</InfoTip>} sub={dueNote} tone={dueTone}>{dueDay(o) ? formatDate(dueDay(o)) : "–"}</HeadItem>
              <HeadItem label="Delivery">{o.delivery_date ? formatDate(o.delivery_date) : "–"}</HeadItem>
              <HeadItem label="Client">{client || "–"}</HeadItem>
              <HeadItem label="SA" sub={o.salesperson_store && o.salesperson_store !== o.salesperson ? o.salesperson_store : null}>{o.salesperson || "–"}</HeadItem>
              {o.po_number && <HeadItem label="PO No">{o.po_number}</HeadItem>}
              <div className="pmc-tags">
                <b className={`pmo-pill is-${status.toLowerCase().replace(/\s+/g, "-")}`}>{status}</b>
                {isUrgent(o) && <i className="pm-tag is-urgent">Urgent</i>}
                {late && <i className="pm-tag is-urgent">Late</i>}
                {quiet && <i className="pm-tag">Quiet 30+ days</i>}
                {o.is_alteration && <i className="pm-tag">Alteration</i>}
              </div>
            </header>

            <div className="pmc-body">
              <div className="pmc-products">
                {shownItems.map((it, i) => (
                  <div key={i} className="pmc-product">
                    <Thumb src={it.image_url} alt={it.product_name || ""} className="pmc-thumb" />
                    <div className="pmc-pinfo">
                      <Line label="Product">{it.product_name || "–"}</Line>
                      <Line label="Category">{it.product_name ? getItemCategory(it) : "–"}</Line>
                      <Line label="Size">{it.size ? <span className="pmo-size-pill">{it.size}</span> : "–"}<span className="pmc-qty">Qty <b>{Number(it.quantity) || 1}</b></span></Line>
                    </div>
                    <div className="pmc-garments">
                      <Line label="Top"><Garment name={it.top} colour={it.top_color} hexOf={hexOf} /></Line>
                      <Line label="Bottom"><Garment name={it.bottom} colour={it.bottom_color} hexOf={hexOf} /></Line>
                      {(it.dupatta_color || (Array.isArray(it.extras) && it.extras.length > 0)) && (
                        <Line label="Extras">
                          <span className="pmo-extras">
                            {it.dupatta_color && <span className="pmo-garment"><b>Dupatta</b><Colour value={it.dupatta_color} hexOf={hexOf} /></span>}
                            {(it.extras || []).map((x, k) => <span key={k} className="pmo-garment"><b>{x.name || "Extra"}</b><Colour value={x.color} hexOf={hexOf} /></span>)}
                          </span>
                        </Line>
                      )}
                    </div>
                    <div className="pmc-mrow"><span className="pmc-label">Measurements</span><Measures m={it.measurements} /></div>
                  </div>
                ))}
                {items.length > MAX_PRODUCTS && <p className="pmc-more">+{plural(items.length - MAX_PRODUCTS, "more product")} · open the order to see all</p>}
              </div>

              <div className="pmc-pieces">
                <div className="pmc-pieces-head">
                  <span className="pmc-hlabel">Pieces</span>
                  {live.length ? <b>{done} of {live.length} finished</b> : <span className="pm-muted">No pieces yet</span>}
                </div>
                {live.length > 0 && <span className="pm-mini-bar pmc-bar"><i style={{ width: `${(done / live.length) * 100}%` }} /></span>}
                <div className="pmc-ptracks">
                  {comps.slice(0, 6).map((c) => <PieceTrack key={c.id} c={c} />)}
                  {comps.length > 6 && <small className="pm-muted">+{comps.length - 6} more pieces</small>}
                </div>
              </div>
            </div>

            <footer className="pmc-foot">
              <span className="pmc-foot-note">
                {o.mode_of_delivery ? <>Delivery: <b>{o.mode_of_delivery}</b></> : null}
                {items.length > 1 ? <span>{plural(items.length, "product")}</span> : null}
                {o.notes ? <span className="pmc-note" title={o.notes}>Note: <b>{o.notes}</b></span> : null}
              </span>
              <span className="pmo-btns pmc-actions" onClick={(e) => e.stopPropagation()} role="presentation">
                <button type="button" className="ceo-btn is-small" onClick={stop(() => ctx.openJourney(o))} disabled={!comps.length}><Icon name="movements" />View Journey</button>
                <button type="button" className="ceo-btn is-small" onClick={stop(() => actions.warehousePdf(o))} disabled={busy("pdf")}><Icon name="download" />{busy("pdf") ? "Opening" : "Warehouse PDF"}</button>
                <RowMenu items={[
                  { label: "Open order", icon: "orders", onClick: open },
                  { label: "Edit order", icon: "edit", onClick: () => actions.edit(o) },
                  { label: isUrgent(o) ? "Change priority" : "Set priority", icon: "alert", onClick: () => actions.priority(o) },
                  { label: "Move or override pieces", icon: "transfer", disabled: !comps.length, onClick: () => actions.override(o) },
                  running && { label: "Mark as completed", icon: "sale", disabled: busy("complete"), onClick: () => actions.complete(o) },
                  running && { label: "Cancel order", icon: "close", danger: true, onClick: () => actions.cancel(o) },
                ]} />
              </span>
            </footer>
          </article>
        );
      })}
    </div>
  );
}
