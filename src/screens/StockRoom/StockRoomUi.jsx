import React, { useEffect, useRef, useState } from "react";
import { SIZE_SCALE, CUSTOM_SIZE, canonicalSize, describeSizes } from "./stockRoomModel";

// ============================================================
// Stock Room — small presentational pieces shared by every screen.
// No data access here; each piece renders what it is given.
// ============================================================

const PATHS = {
  overview: <path d="M3 13h8V3H3v10zM13 21h8V11h-8v10zM3 21h8v-5H3v5zM13 8h8V3h-8v5z" strokeLinejoin="round" />,
  stock: <><path d="M21 16V8l-9-5-9 5v8l9 5 9-5z" strokeLinejoin="round" /><path d="m3.3 7.5 8.7 5 8.7-5M12 22V12.5" strokeLinejoin="round" /></>,
  warehouse: <><path d="M3 21V9l9-6 9 6v12" strokeLinejoin="round" /><path d="M9 21v-7h6v7M3 21h18" strokeLinejoin="round" /></>,
  orders: <path d="M9 3h6l1 3H8l1-3zM5 6h14l-1.2 14a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9L5 6z" strokeLinejoin="round" />,
  products: <><path d="M6 2h12l2 6H4l2-6zM4 8v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" strokeLinejoin="round" /><path d="M9 12a3 3 0 0 0 6 0" strokeLinecap="round" /></>,
  integrity: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinejoin="round" /><path d="M12 8v4m0 4h.01" strokeLinecap="round" /></>,
  inr: <path d="M6 4h12M6 8.5h12M6 13h5a4.5 4.5 0 0 0 0-9M6 13l9 8" strokeLinecap="round" strokeLinejoin="round" />,
  trend: <><path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" /><path d="M17 7h4v4" strokeLinecap="round" /></>,
  alert: <path d="M12 9v4m0 4h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" strokeLinecap="round" strokeLinejoin="round" />,
  chevron: <path d="m9 18 6-6-6-6" strokeLinecap="round" />,
  close: <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4.2-4.2" strokeLinecap="round" /></>,
  filter: <path d="M3 5h18M6 12h12M10 19h4" strokeLinecap="round" />,
  refresh: <path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />,
  sale: <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />,
  pin: <><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" strokeLinejoin="round" /><circle cx="12" cy="10" r="2.5" /></>,
  doc: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" strokeLinejoin="round" /><path d="M14 3v5h5M9 13h6M9 17h6" strokeLinecap="round" /></>,
  logout: <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" strokeLinecap="round" strokeLinejoin="round" />,
  transfer: <path d="M4 7h13l-3.5-3.5M20 17H7l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />,
  movements: <><path d="M4 6h16M4 12h10M4 18h7" strokeLinecap="round" /><path d="m17 15 3 3-3 3" strokeLinecap="round" strokeLinejoin="round" /></>,
  plus: <path d="M12 5v14M5 12h14" strokeLinecap="round" />,
  receive: <><path d="M12 3v12m0 0 4-4m-4 4-4-4" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" /></>,
  download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" /></>,
  upload: <><path d="M12 15V3m0 0 4 4m-4-4-4 4" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" /></>,
  edit: <path d="M12 20h9M16.4 3.6a2 2 0 1 1 2.8 2.8L7.5 18.1 3 19.5l1.4-4.5L16.4 3.6z" strokeLinecap="round" strokeLinejoin="round" />,
  bell: <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinejoin="round" /><path d="M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" /></>,
};

export function Icon({ name, width = 1.6 }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

const BADGES = {
  ok: ["sr-b-ok", "In stock"],
  low: ["sr-b-low", "Low stock"],
  out: ["sr-b-crit", "Out of stock"],
  unlimited: ["sr-b-gold", "Unlimited"],
  untracked: ["sr-b-plain", "Not tracked"],
};

export function StockBadge({ status }) {
  const [cls, label] = BADGES[status] || BADGES.untracked;
  return <span className={`sr-badge ${cls}`}>{label}</span>;
}

export function Badge({ tone = "gold", children }) {
  return <span className={`sr-badge sr-b-${tone}`}>{children}</span>;
}

// Shopify CDN resizes on request when _WxH sits before the extension; other
// hosts are returned unchanged. Same trick as InventoryDashboard.jsx shopifyThumb.
export function thumbUrl(url, size = 96) {
  if (!url || typeof url !== "string" || !url.includes("cdn.shopify.com")) return url;
  const cleaned = url.replace(/_\d+x\d+(?=\.[a-zA-Z]+(\?|$))/, "");
  return cleaned.replace(/(\.[a-zA-Z]+)(\?|$)/, `_${size}x${size}$1$2`);
}

/** Product image, or the neutral placeholder when there is none or it fails. */
export function Thumb({ src, className = "sr-thumb", size = 96 }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span className={className} aria-hidden="true" />;
  return <img className={className} src={thumbUrl(src, size)} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

// Spans, not divs: this cell is also used inside the Stock list's row <button>,
// where block elements are invalid HTML.
export function ProductCell({ product, meta, caret = false }) {
  return (
    <span className="sr-prodcell">
      {caret && <span className="sr-caret"><Icon name="chevron" width={2} /></span>}
      <Thumb src={product.image_url} />
      <span className="sr-prodcell-text">
        <b title={product.name}>{product.name}</b>
        <em>{meta ?? (product.sku_id || "No SKU")}</em>
      </span>
    </span>
  );
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const MAX_CHIPS = 5;

/**
 * Sizes in plain words, answering the two questions a person actually has:
 * "what can I sell now?" and "what does this design come in?"
 *
 * With `stock` (LXRTS, counted per size):
 *   line 1  the sizes that have stock, with counts — "S 2  M 1"
 *           or "All 11 sizes sold out" when none do
 *   line 2  what it comes in — "Offered XS to XL · 3 sizes sold out"
 * Without (custom pieces, made to order — no per-size count):
 *   line 1  the range — "XXS to 8XL" — or the sizes themselves when few or broken up
 *   line 2  how many — "All 13 sizes"
 */
export function SizeSummary({ sizes, stock }) {
  const d = describeSizes(sizes);
  if (!d.count) return <span className="sr-muted">No sizes listed</span>;

  if (stock && stock.bySize) {
    const qty = {};
    Object.entries(stock.bySize).forEach(([s, n]) => { const c = canonicalSize(s); qty[c] = (qty[c] || 0) + n; });
    const invalid = new Set((stock.invalidSizes || []).map(canonicalSize));
    const inStock = d.labels.filter((l) => qty[canonicalSize(l)] > 0);
    const toCheck = d.labels.filter((l) => invalid.has(canonicalSize(l)));
    const soldOut = d.labels.length - inStock.length - toCheck.length;
    const shown = inStock.slice(0, MAX_CHIPS);
    const tip = d.labels.map((l) => `${l}: ${invalid.has(canonicalSize(l)) ? "check count" : qty[canonicalSize(l)] || 0}`).join("  ·  ");

    const detail = [
      `${d.count === 1 ? "Only in" : "Offered"} ${d.text}`,
      inStock.length && soldOut ? `${plural(soldOut, "size")} sold out` : null,
      toCheck.length ? `${plural(toCheck.length, "size")} to check` : null,
    ].filter(Boolean).join(" · ");

    return (
      <span className="sr-sizes" title={tip}>
        <span className="sr-sizes-main">
          {shown.length ? (
            <>
              {shown.map((l) => <span key={l} className="sr-szc">{l} <b>{qty[canonicalSize(l)]}</b></span>)}
              {inStock.length > MAX_CHIPS && <span className="sr-sizes-more">+{inStock.length - MAX_CHIPS} more</span>}
            </>
          ) : (
            <span className="sr-sizes-none">{d.count === 1 ? "Sold out" : `All ${plural(d.count, "size")} sold out`}</span>
          )}
        </span>
        <span className="sr-sizes-sub">{detail}</span>
      </span>
    );
  }

  // Not counted per size: a long unbroken run reads best as a range; a short or
  // broken-up set reads best as the sizes themselves.
  const asChips = d.count <= 4 || (!d.contiguous && d.count <= 6);
  const fullRange = d.indices.length === SIZE_SCALE.length;
  const hasCustom = d.extras.includes(CUSTOM_SIZE);
  const sub = fullRange
    ? `All ${SIZE_SCALE.length} sizes${hasCustom ? " + custom" : ""}${d.extras.length > (hasCustom ? 1 : 0) ? " + more" : ""}`
    : plural(d.count, "size");
  return (
    <span className="sr-sizes" title={d.labels.join(", ")}>
      <span className="sr-sizes-main">
        {asChips
          ? d.labels.map((l) => <span key={l} className="sr-szc is-plain">{l}</span>)
          : <span className="sr-sizes-range">{d.text}</span>}
      </span>
      <span className="sr-sizes-sub">{sub}</span>
    </span>
  );
}

export function KpiCard({ icon, label, value, note, onClick }) {
  return (
    <div className="sr-card sr-kpi-card">
      <button type="button" className="sr-kpi" onClick={onClick}>
        <span className="sr-kpi-ico"><Icon name={icon} /></span>
        <span className="sr-kpi-body">
          <span className="sr-label">{label}</span>
          <span className="sr-kpi-v">{value}</span>
          <span className="sr-kpi-note">{note}</span>
        </span>
        <span className="sr-kpi-go"><Icon name="chevron" width={1.8} /></span>
      </button>
    </div>
  );
}

export function Seg({ options, value, onChange, label }) {
  return (
    <div className="sr-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SearchField({ value, onChange, placeholder, label }) {
  return (
    <label className="sr-searchfield">
      <Icon name="search" width={1.8} />
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} />
    </label>
  );
}

function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

export function Modal({ title, meta, thumb, onClose, children, labelId = "sr-modal-title" }) {
  useEscape(onClose);
  const closeRef = useRef(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  return (
    <div className="sr-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sr-modal" role="dialog" aria-modal="true" aria-labelledby={labelId}>
        <div className="sr-modal-head">
          {thumb !== undefined && <Thumb src={thumb} className="sr-modal-thumb" size={160} />}
          <div style={{ minWidth: 0 }}>
            <h2 id={labelId}>{title}</h2>
            {meta && <div className="sr-modal-meta">{meta}</div>}
          </div>
          <button ref={closeRef} type="button" className="sr-x" onClick={onClose} aria-label="Close"><Icon name="close" width={2} /></button>
        </div>
        <div className="sr-modal-body">{children}</div>
      </div>
    </div>
  );
}

export function FilterDrawer({ title = "Filters", sub, onClose, onClear, children }) {
  useEscape(onClose);
  return (
    <div className="sr-drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="sr-drawer" role="dialog" aria-modal="true" aria-labelledby="sr-filter-title">
        <div className="sr-drawer-head">
          <div>
            <h2 id="sr-filter-title">{title}</h2>
            {sub && <span className="sr-sub">{sub}</span>}
          </div>
          <button type="button" className="sr-x" onClick={onClose} aria-label="Close filters"><Icon name="close" width={2} /></button>
        </div>
        <div className="sr-drawer-body">{children}</div>
        <div className="sr-drawer-foot">
          <button type="button" className="sr-btn" onClick={onClear}>Clear all</button>
          <button type="button" className="sr-btn sr-btn-primary" onClick={onClose}>Show results</button>
        </div>
      </aside>
    </div>
  );
}

/** Single-choice facet for the filter drawer. `value` "" means any. */
export function Facet({ label, options, value, onChange }) {
  return (
    <div className="sr-facet">
      <span className="sr-label">{label}</span>
      <div className="sr-choices">
        {options.map((o) => (
          <button key={o.value} type="button" className="sr-choice" aria-pressed={value === o.value}
            onClick={() => onChange(value === o.value ? "" : o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Pills for the filters currently applied, each removable. */
export function ActiveFilters({ items }) {
  const active = items.filter((i) => i.value);
  if (!active.length) return null;
  return (
    <div className="sr-activefilters">
      {active.map((i) => (
        <span key={i.key} className="sr-fpill">
          <b>{i.label}</b>{i.display || i.value}
          <button type="button" className="sr-fpill-x" onClick={i.onClear} aria-label={`Remove ${i.label} filter`}>×</button>
        </span>
      ))}
    </div>
  );
}

export function FilterButton({ count, onClick }) {
  return (
    <button type="button" className="sr-btn" onClick={onClick}>
      <Icon name="filter" width={1.7} />Filters
      {count > 0 && <span className="sr-btn-count">{count}</span>}
    </button>
  );
}

/**
 * Searchable single-choice dropdown. Typing filters the list; Enter picks the
 * highlighted option; Escape or clicking away closes it. `value` "" = none.
 */
export function SearchSelect({ options, value, onChange, placeholder = "Any", label }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const listId = useRef(`sr-combo-${Math.random().toString(36).slice(2, 9)}`).current;
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const q = query.trim().toLowerCase();
  const list = [{ value: "", label: placeholder }, ...options.filter((o) => !q || o.label.toLowerCase().includes(q))];

  const pick = (o) => { onChange(o.value); setOpen(false); setQuery(""); };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(list.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && open && list[active]) { e.preventDefault(); pick(list[active]); }
    else if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); }
  };

  return (
    <div className="sr-combo" ref={wrapRef}>
      <input
        className="sr-select"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        value={open ? query : (selected ? selected.label : "")}
        placeholder={selected ? selected.label : placeholder}
        onFocus={() => { setOpen(true); setActive(0); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div className="sr-combo-list" role="listbox" id={listId}>
          {list.length > 1 || !q ? list.map((o, i) => (
            <div key={o.value || "__none"} role="option" aria-selected={o.value === value}
              className={`sr-combo-item${i === active ? " is-active" : ""}${o.value === "" ? " is-none" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setActive(i)}>
              {o.hex && <i className="sr-dot" style={{ background: o.hex }} aria-hidden="true" />}
              {o.label}
            </div>
          )) : null}
          {q && list.length === 1 && <div className="sr-combo-empty">No match for “{query}”</div>}
        </div>
      )}
    </div>
  );
}

/** Renders `limit` rows at a time; returns [visible, moreButton]. */
export function usePaged(rows, step = 50, resetKey) {
  const [limit, setLimit] = useState(step);
  useEffect(() => { setLimit(step); }, [resetKey, step]);
  const visible = rows.slice(0, limit);
  const more = rows.length > limit ? (
    <div className="sr-more">
      <button type="button" className="sr-btn" onClick={() => setLimit((l) => l + step)}>
        Show {Math.min(step, rows.length - limit)} more · {rows.length - limit} remaining
      </button>
    </div>
  ) : null;
  return [visible, more];
}

/** A labelled form field. `hint` sits under the control; `error` replaces it in red. */
export function Field({ label, hint, error, children, wide = false }) {
  return (
    <label className={`sr-field${wide ? " is-wide" : ""}`}>
      <span className="sr-field-label">{label}</span>
      {children}
      {error ? <span className="sr-field-hint is-error">{error}</span> : hint ? <span className="sr-field-hint">{hint}</span> : null}
    </label>
  );
}

/** Confirmation that fades after a few seconds. `tone` "ok" | "warn" | "crit". */
export function Toast({ toast, onDone }) {
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(onDone, toast.tone === "ok" ? 4500 : 9000);
    return () => clearTimeout(t);
  }, [toast, onDone]);
  if (!toast) return null;
  return (
    <div className={`sr-toast is-${toast.tone || "ok"}`} role="status">
      <span>{toast.text}</span>
      <button type="button" className="sr-toast-x" onClick={onDone} aria-label="Dismiss">×</button>
    </div>
  );
}

/** A modal with a form footer: Cancel and one primary action. */
export function FormModal({ title, sub, onClose, onSubmit, submitLabel, submitting, error, children, width = 820, disabled = false, submitInHead = false }) {
  useEscape(onClose);
  const submitButton = (
    <button type="submit" className="sr-btn sr-btn-primary" disabled={submitting || disabled}>
      {submitting ? "Saving…" : submitLabel}
    </button>
  );
  return (
    <div className="sr-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
      <form className="sr-modal sr-form-modal" style={{ width: `min(${width}px, 100%)` }} role="dialog" aria-modal="true" aria-labelledby="sr-form-title"
        onSubmit={(e) => { e.preventDefault(); if (!submitting && !disabled) onSubmit(); }} noValidate>
        <div className={`sr-modal-head${submitInHead ? " has-submit" : ""}`}>
          <div style={{ minWidth: 0 }}>
            <h2 id="sr-form-title">{title}</h2>
            {sub && <div className="sr-modal-meta">{sub}</div>}
          </div>
          {submitInHead && submitButton}
          <button type="button" className="sr-x" onClick={onClose} disabled={submitting} aria-label="Close"><Icon name="close" width={2} /></button>
        </div>
        <div className="sr-modal-body">
          {error && <p className="sr-error" role="alert" style={{ marginBottom: 16 }}>{error}</p>}
          {children}
        </div>
        {!submitInHead && (
          <div className="sr-form-foot">
            <button type="button" className="sr-btn" onClick={onClose} disabled={submitting}>Cancel</button>
            {submitButton}
          </div>
        )}
      </form>
    </div>
  );
}

export function Topline({ title, sub, children }) {
  return (
    <div className="sr-topline">
      <div>
        <h1>{title}</h1>
        {sub && <span className="sr-sub">{sub}</span>}
      </div>
      {children && <div className="sr-tools">{children}</div>}
    </div>
  );
}
