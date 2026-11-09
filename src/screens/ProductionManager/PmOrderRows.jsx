import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fmtDate as formatDate } from "./pmModel";
import { supabase } from "../../lib/supabaseClient";
import { getItemCategory } from "../../utils/itemCategory";
import { Empty, Icon, InfoTip, Thumb } from "../CeoDashboard/CeoUi";
import { orderStatus } from "./PmCommon";
import {
  channelOf, clientOf, daysLeft, dueDay, hasPromise, isDormant, isLate, isRunning, isUrgent, pieceState, plural, stageName,
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
export function useColourHex() {
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
export function Colour({ value, hexOf }) {
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


// ---- each piece with its own measurements
// Which measurement set belongs to a piece, from the piece's name ("Long Choga" -> Kurta / Choga / Kaftan).
const MEASURE_FOR = [
  [/kurta|choga|chauga|kaftan|tunic/i, "KurtaChogaKaftan"],
  [/blouse|choli/i, "Blouse"],
  [/anarkali/i, "Anarkali"],
  [/salwar|dhoti/i, "SalwarDhoti"],
  [/churi|trouser|pant|pla[z]+o|palazzo/i, "ChuridaarTrouserPantsPlazo"],
  [/sharara|gharara/i, "ShararaGharara"],
  [/lehenga|skirt/i, "Lehenga"],
];
const filled = (f) => f && typeof f === "object" && Object.values(f).some((v) => v !== "" && v != null);
function measuresFor(c, item) {
  const m = item?.measurements || {};
  const hit = MEASURE_FOR.find(([re, key]) => re.test(c.component_label || "") && filled(m[key]));
  if (hit) return m[hit[1]];
  // Otherwise the first filled set of the piece's kind (a top or a bottom).
  const kinds = c.component_type === "top" ? ["KurtaChogaKaftan", "Anarkali", "Blouse"]
    : c.component_type === "bottom" ? ["SalwarDhoti", "ChuridaarTrouserPantsPlazo", "ShararaGharara", "Lehenga"] : [];
  const k = kinds.find((x) => filled(m[x]));
  return k ? m[k] : null;
}
/** The garment a piece is made as and its colour, from the order line. */
export function garmentOf(c, item = {}) {
  const t = c.component_type;
  if (t === "top") return { name: c.component_label || item.top || "Top", colour: item.top_color };
  if (t === "bottom") return { name: c.component_label || item.bottom || "Bottom", colour: item.bottom_color };
  if (t === "dupatta") return { name: c.component_label || "Dupatta", colour: item.dupatta_color };
  const extras = Array.isArray(item.extras) ? item.extras : [];
  const label = String(c.component_label || "").toLowerCase();
  const byName = extras.find((x) => x?.name && label.includes(String(x.name).toLowerCase()));
  const n = Number((String(c.barcode || "").match(/EX(\d+)$/i) || [])[1]);
  const byIndex = n ? extras[n - 1] : null;
  const x = byName || byIndex || (extras.length === 1 ? extras[0] : null);
  return { name: c.component_label || x?.name || "Extra", colour: x?.color };
}
const whereOf = (c, st) => (st === "at_vendor" ? `At ${c.vendor_name || "vendor"}` : st === "at_wh2" ? `${stageName(c)} · Delhi (2)` : st === "not_started" ? "Not started"
  : st === "finished" ? "Finished" : st === "disposed" ? "Disposed" : st === "removed" ? "Cancelled" : stageName(c));
/** A piece: the garment and its colour, where it is now, and its measurements. */
export function PieceRow({ c, item, hexOf, showStatus = true, onOpen }) {
  const st = pieceState(c);
  const g = garmentOf(c, item);
  const m = measuresFor(c, item);
  return (
    <div className={`pmc-piece is-${st}${onOpen ? " is-link" : ""}`} title={onOpen ? `${c.barcode}: open its journey` : c.barcode}
      {...(onOpen ? { role: "button", tabIndex: 0, onClick: onOpen, onKeyDown: (ev) => { if (ev.key === "Enter") onOpen(); } } : {})}>
      <div className="pmc-piece-top">
        <span className="pmc-piece-id"><b className="pmc-piece-name">{g.name}</b>{c.barcode && <small className="pm-code">{c.barcode}</small>}</span>
        {showStatus && <span className={`pmc-pstatus is-${st}`} title="Where the piece is now">{whereOf(c, st)}</span>}
      </div>
      {g.colour ? <span className="pmc-kv"><span className="pmc-k">Colour</span><Colour value={g.colour} hexOf={hexOf || {}} /></span> : null}
      {m && (
        <span className="pmc-mblock"><span className="pmc-k">Measurements (in)</span><span className="pmc-mchips">
          {Object.entries(m).filter(([, v]) => v !== "" && v != null).map(([k, v]) => <i key={k}><small>{k}</small>{v}</i>)}
        </span></span>
      )}
    </div>
  );
}

/** A product photo shown large over the page; click anywhere or press Escape to close. */
export function PhotoView({ photo, onClose }) {
  useEffect(() => {
    // Escape closes only the photo, not the panel underneath (caught first, then stopped).
    const onKey = (ev) => { if (ev.key === "Escape") { ev.stopImmediatePropagation(); ev.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="pmc-lightbox" role="dialog" aria-modal="true" aria-label={photo.name || "Product photo"} onClick={onClose}>
      <figure onClick={(ev) => ev.stopPropagation()}>
        <img src={photo.src} alt={photo.name || ""} />
        {photo.name && <figcaption>{photo.name}</figcaption>}
      </figure>
      <button type="button" className="pmc-lightbox-x" aria-label="Close" onClick={onClose}>×</button>
    </div>,
    document.body,
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

export default function OrderRows({ ctx, rows }) {
  const { componentsByOrder, actions } = ctx;
  const hexOf = useColourHex();
  const [photo, setPhoto] = useState(null); // { src, name } shown large
  if (!rows.length) return <Empty text="No orders match." />;
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  return (
    <div className="pmc-list">
      {photo && <PhotoView photo={photo} onClose={() => setPhoto(null)} />}
      {rows.map((o) => {
        const comps = componentsByOrder[o.id] || [];
        const live = comps.filter((c) => !c.cancelled_at);
        const done = live.filter((c) => pieceState(c) === "finished").length;
        const passedQc = live.filter((c) => c.current_stage === "final_qc_passed").length;
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
        // Each product's pieces (pieces of products past the third go with the last one shown).
        const lastShown = shownItems.length - 1;
        const piecesOf = (i) => comps.filter((c) => Math.min(c.item_index ?? 0, lastShown) === i);
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
                    {it.image_url ? (
                      <button type="button" className="pmc-thumb-btn" aria-label="View the photo larger"
                        onClick={(ev) => { ev.stopPropagation(); setPhoto({ src: it.image_url, name: it.product_name }); }}>
                        <Thumb src={it.image_url} alt={it.product_name || ""} large />
                      </button>
                    ) : <Thumb src={it.image_url} alt="" large />}
                    <div className="pmc-pmain">
                      <div className="pmc-ptitle">
                        <b>{it.product_name || "–"}</b>
                        <span className="pmc-pmeta">
                          {it.product_name && <span className="pmc-kv"><span className="pmc-k">Category</span><b>{getItemCategory(it)}</b></span>}
                          <span className="pmc-kv"><span className="pmc-k">Size</span>{it.size ? <span className="pmo-size-pill">{it.size}</span> : <b>–</b>}</span>
                          <span className="pmc-kv"><span className="pmc-k">Qty</span><b>{Number(it.quantity) || 1}</b></span>
                        </span>
                      </div>
                      {piecesOf(i).length
                        ? <div className="pmc-plist">{piecesOf(i).map((c) => <PieceRow key={c.id} c={c} item={items[c.item_index ?? 0]} hexOf={hexOf} />)}</div>
                        : <span className="pm-muted">No pieces yet</span>}
                    </div>
                  </div>
                ))}
                {items.length > MAX_PRODUCTS && <p className="pmc-more">+{plural(items.length - MAX_PRODUCTS, "more product")} · open the order to see all</p>}
              </div>

            </div>

            <footer className="pmc-foot">
              <span className="pmc-foot-note">
                <span className="pmc-progress">
                  Pieces: <b>{live.length ? `${done} of ${live.length} finished` : "none yet"}</b>
                  {passedQc > 0 && <span className="pmc-ready">{passedQc} passed Final QC</span>}
                  {live.length > 0 && <span className="pm-mini-bar"><i style={{ width: `${(done / live.length) * 100}%` }} /></span>}
                </span>
                {o.mode_of_delivery ? <span>Delivery: <b>{o.mode_of_delivery}</b></span> : null}
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
