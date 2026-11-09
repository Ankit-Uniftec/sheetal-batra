import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import formatIndianNumber from "../../utils/formatIndianNumber";
import { Icon } from "../StockRoom/StockRoomUi";
import { shortInr } from "./ceoInsights";

// ============================================================
// CEO dashboard building blocks. Every control here is our own, drawn in the
// brand's type and colour: no browser dropdowns, calendars or checkboxes.
// ============================================================

export { Icon };
export const fullInr = (v) => `₹${formatIndianNumber(Math.round(Number(v) || 0))}`;
export const num = (v) => (Number(v) || 0).toLocaleString("en-IN");
export const PALETTE = ["#b8922e", "#7b3a5e", "#2f6f73", "#c9785a", "#6d6a9c", "#8a9a5b", "#a9821f", "#54442c"];

export const MenuIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);
export const ClientsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.900 1.900 6.500 5.500" /><path d="M15.500 4.800a3.500 3.500 0 0 1 0 6.400M18 14.900c1.900.7 3.100 2.400 3.500 5.100" /></svg>
);
export const CalendarIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
);

/**
 * A defined term. The label itself carries a fine dotted underline, the way a
 * printed glossary marks a word; pointing at it (or tapping it on a phone)
 * opens a small card with the definition. No extra icon competes with the
 * figure. It lives inside clickable tiles and rows, so it is a span (not a
 * nested button) and keeps its clicks to itself.
 */
export function InfoTip({ text, term, children }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const anchor = useRef(null);
  const show = () => {
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(290, window.innerWidth - 24);
    const centre = r.left + Math.min(r.width, 160) / 2;
    const left = Math.max(12, Math.min(centre - width / 2, window.innerWidth - width - 12));
    const below = window.innerHeight - r.bottom > 150;
    const arrow = Math.max(14, Math.min(width - 14, centre - left));
    setPos({ left, width, "--ceo-arrow": `${arrow}px`, ...(below ? { top: r.bottom + 9 } : { bottom: window.innerHeight - r.top + 9 }), below });
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!anchor.current?.contains(e.target)) setOpen(false); };
    const hide = () => setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open]);
  if (!text) return children || null;
  const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
  const { below, ...style } = pos || {};
  return (
    <span
      ref={anchor}
      className={`ceo-term${open ? " is-open" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`${typeof children === "string" ? children : term || "Definition"}: ${text}`}
      onClick={(e) => { stop(e); show(); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { stop(e); show(); } if (e.key === "Escape") setOpen(false); }}
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
      onFocus={show}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && pos && createPortal(
        <div className={`ceo-info-pop${below ? "" : " is-above"}`} role="tooltip" style={style}>
          {(term || typeof children === "string") && <b className="ceo-info-term">{term || children}</b>}
          <span className="ceo-info-text">{text}</span>
        </div>,
        document.body,
      )}
    </span>
  );
}

/** A change, coloured by whether it is good news. Nothing when there is no fair comparison. */
export function Delta({ value, inverse = false, suffix = "%" }) {
  // Against almost nothing, "+90,000%" says nothing. Leave it out.
  if (value == null || Number.isNaN(value) || Math.abs(value) >= 1000) return null;
  const up = value > 0;
  const flat = Math.abs(value) < 0.5;
  const good = inverse ? !up : up;
  const tone = flat ? "flat" : good ? "good" : "bad";
  return (
    <span className={`ceo-delta is-${tone}`}>
      {!flat && <span aria-hidden="true">{up ? "▲" : "▼"}</span>}
      {flat ? "Level" : `${Math.abs(value).toFixed(Math.abs(value) >= 100 ? 0 : 1)}${suffix}`}
    </span>
  );
}

/**
 * `span` is the card's share of 12 columns on a wide screen; `md` its share on a
 * laptop or tablet. Each row is planned to add up to 12, so no row leaves a hole.
 */
export function Card({ title, sub, action, onAction, children, className = "", span, md, info }) {
  return (
    <section className={`ceo-card ${className}`} style={span ? { "--span": span, "--md": md || 12 } : undefined}>
      {(title || action) && (
        <header className="ceo-card-head">
          <div className="ceo-card-titles">
            {title && <h3>{info ? <InfoTip text={info}>{title}</InfoTip> : title}</h3>}
            {sub && <p>{sub}</p>}
          </div>
          {action && (
            <button type="button" className="ceo-link" onClick={onAction}>
              {action}<Icon name="chevron" width={1.8} />
            </button>
          )}
        </header>
      )}
      {children}
    </section>
  );
}

/** A headline figure. It opens something whenever onClick is given. */
export function Tile({ label, value, title, delta, inverse, note, icon, onClick, tone, info }) {
  const body = (
    <>
      {icon && <span className={`ceo-tile-ico${tone ? ` is-${tone}` : ""}`}><Icon name={icon} /></span>}
      <span className="ceo-tile-body">
        <span className="ceo-tile-label">{info ? <InfoTip text={info}>{label}</InfoTip> : label}</span>
        <span className="ceo-tile-value" title={title}>{value}</span>
        <span className="ceo-tile-foot">
          <Delta value={delta} inverse={inverse} />
          {note && <span className="ceo-tile-note">{note}</span>}
        </span>
      </span>
      {onClick && <span className="ceo-tile-go" aria-hidden="true"><Icon name="chevron" /></span>}
    </>
  );
  return onClick
    ? <button type="button" className="ceo-tile is-link" onClick={onClick}>{body}</button>
    : <div className="ceo-tile">{body}</div>;
}

export function Spark({ data, dataKey = "revenue" }) {
  return (
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 1, height: 1 }}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <Area type="monotone" dataKey={dataKey} stroke="#b8922e" strokeWidth={1.5} fill="#b8922e" fillOpacity={0.12} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

const ChartTip = ({ active, payload, label, money = true }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="ceo-tip">
      <b>{label || payload[0]?.payload?.name}</b>
      {payload.map((p) => (
        <span key={p.dataKey}>
          <i style={{ background: p.color || p.stroke || p.fill }} />
          {p.name}: {money ? fullInr(p.value) : num(p.value)}
        </span>
      ))}
    </div>
  );
};

const axis = { fontSize: 11, fill: "#8a8478" };
const pickFrom = (handler) => (state) => {
  const row = state?.activePayload?.[0]?.payload;
  if (row && handler) handler(row);
};

/** Revenue over time, with the period before as a quiet dashed line. */
export function TrendChart({ data, height = 280, onPick }) {
  if (!data?.length) return <Empty />;
  return (
    <div style={{ width: "100%", height, cursor: onPick ? "pointer" : undefined }}>
      <ResponsiveContainer initialDimension={{ width: 1, height: 1 }}>
        <ComposedChart data={data} margin={{ top: 8, right: 6, left: 0, bottom: 0 }} onClick={pickFrom(onPick)}>
          <defs>
            <linearGradient id="ceoRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c9a23e" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#c9a23e" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#f1ede2" vertical={false} />
          <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} minTickGap={22} />
          <YAxis tickFormatter={(v) => shortInr(v).replace("₹", "")} tick={axis} axisLine={false} tickLine={false} width={44} />
          <Tooltip content={<ChartTip />} />
          <Area type="monotone" dataKey="revenue" name="Sales" stroke="#b8922e" strokeWidth={2.4} fill="url(#ceoRevenue)" isAnimationActive={false} />
          {data.some((d) => d.previous != null) && (
            <Line type="monotone" dataKey="previous" name="Previous period" stroke="#b9b3a4" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Donut({ data, center, sub, height = 220, valueKey = "value", money = true, onPick, colorOf }) {
  const rows = (data || []).filter((d) => Number(d[valueKey]) > 0);
  if (!rows.length) return <Empty />;
  return (
    <div className="ceo-donut" style={{ height }}>
      <ResponsiveContainer initialDimension={{ width: 1, height: 1 }}>
        <PieChart>
          <Pie data={rows} dataKey={valueKey} nameKey="name" innerRadius="66%" outerRadius="96%" paddingAngle={2} stroke="none" isAnimationActive={false}
            onClick={onPick ? (d) => onPick(d.payload?.payload || d) : undefined} style={onPick ? { cursor: "pointer" } : undefined}>
            {rows.map((r, i) => <Cell key={i} fill={(colorOf && colorOf(r)) || PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip content={<ChartTip money={money} />} />
        </PieChart>
      </ResponsiveContainer>
      {center && <div className="ceo-donut-center"><b>{center}</b>{sub && <span>{sub}</span>}</div>}
    </div>
  );
}

/** Ranked rows with a bar behind each. The easiest chart there is to read. */
export function RankBars({ rows, valueKey = "value", format = shortInr, sub, limit = 8, colorOf, onRow, swatchOf }) {
  const list = (rows || []).slice(0, limit);
  if (!list.length) return <Empty />;
  const max = Math.max(...list.map((r) => Number(r[valueKey]) || 0), 1);
  return (
    <div className="ceo-rank">
      {list.map((r, i) => {
        const rowId = `${r.key || r.name}-${i}`;
        const content = (
          <>
            <span className="ceo-rank-top">
              <span className="ceo-rank-name" title={r.name}>
                {swatchOf && <i className="ceo-swatch" style={{ background: swatchOf(r) || "#ddd" }} />}
                <span>{r.name}</span>
              </span>
              <span className="ceo-rank-val">{format(r[valueKey])}</span>
            </span>
            <span className="ceo-rank-track">
              <span style={{ width: `${Math.max(1.5, ((Number(r[valueKey]) || 0) / max) * 100)}%`, background: colorOf ? colorOf(r, i) : "linear-gradient(90deg,#d4b04c,#a9821f)" }} />
            </span>
            {sub && <span className="ceo-rank-sub">{sub(r)}</span>}
          </>
        );
        return onRow
          ? <button type="button" key={rowId} className="ceo-rank-row is-link" onClick={() => onRow(r)}>{content}</button>
          : <div key={rowId} className="ceo-rank-row">{content}</div>;
      })}
    </div>
  );
}

export function Columns({ data, valueKey = "value", labelKey = "name", name = "Revenue", height = 240, money = true, highlight, onPick }) {
  if (!data?.length) return <Empty />;
  return (
    <div style={{ width: "100%", height, cursor: onPick ? "pointer" : undefined }}>
      <ResponsiveContainer initialDimension={{ width: 1, height: 1 }}>
        <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} onClick={pickFrom(onPick)}>
          <CartesianGrid stroke="#f1ede2" vertical={false} />
          <XAxis dataKey={labelKey} tick={axis} axisLine={false} tickLine={false} minTickGap={6} />
          <YAxis tickFormatter={(v) => (money ? shortInr(v).replace("₹", "") : v)} tick={axis} axisLine={false} tickLine={false} width={44} />
          <Tooltip content={<ChartTip money={money} />} cursor={{ fill: "rgba(184,146,46,.07)" }} />
          <Bar dataKey={valueKey} name={name} radius={[6, 6, 0, 0]} maxBarSize={44} isAnimationActive={false}>
            {data.map((d, i) => <Cell key={i} fill={highlight && highlight(d) ? "#a9821f" : "#e4d3a0"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A calendar of selling days: the darker the square, the better the day. */
export function SalesCalendar({ heat, onPick }) {
  const months = useMemo(() => {
    const labels = [];
    let last = -1;
    heat.cols.forEach((col, i) => {
      const first = col.find(Boolean);
      if (first && first.date.getMonth() !== last) {
        last = first.date.getMonth();
        labels.push({ i, name: first.date.toLocaleString("en-IN", { month: "short" }) });
      }
    });
    return labels;
  }, [heat]);
  const shade = (v) => {
    if (!v) return "#f4f0e5";
    const r = v / (heat.max || 1);
    if (r < 0.2) return "#f1e4bb";
    if (r < 0.4) return "#e4cd86";
    if (r < 0.65) return "#cfae4e";
    if (r < 0.85) return "#ab8524";
    return "#7c5e12";
  };
  return (
    <div className="ceo-cal-wrap">
      <div className="ceo-heat" style={{ "--cols": heat.cols.length }}>
        <div className="ceo-heat-months">
          {months.map((m) => <span key={`${m.name}-${m.i}`} style={{ gridColumn: m.i + 1 }}>{m.name}</span>)}
        </div>
        <div className="ceo-heat-grid">
          {heat.cols.map((col, i) => (
            <div key={i} className="ceo-heat-col">
              {col.map((d, j) => (d
                ? (
                  <button
                    key={d.key}
                    type="button"
                    style={{ background: shade(d.revenue) }}
                    title={`${d.date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}: ${shortInr(d.revenue)}, ${d.count} orders`}
                    aria-label={`${d.key}, ${shortInr(d.revenue)}`}
                    onClick={() => onPick?.(d)}
                  />
                )
                : <i key={j} />))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Empty({ text = "Nothing to show for this period." }) {
  return <div className="ceo-empty">{text}</div>;
}

export function PageHead({ title, desc, children }) {
  return (
    <div className="ceo-page-head">
      <div>
        <h1>{title}</h1>
        {desc && <p>{desc}</p>}
      </div>
      {children && <div className="ceo-page-actions">{children}</div>}
    </div>
  );
}

/** One line that says what the numbers mean. */
export function Insight({ children, tone = "gold" }) {
  return (
    <div className={`ceo-insight is-${tone}`}>
      <span className="ceo-insight-ico"><Icon name={tone === "warn" ? "alert" : "trend"} /></span>
      <p>{children}</p>
    </div>
  );
}

export function Thumb({ src, alt = "", large = false }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span className={`ceo-thumb is-empty${large ? " is-large" : ""}`} aria-hidden="true" />;
  const size = large ? "_600x600" : "_160x160";
  const sized = src.includes("cdn.shopify.com") ? src.replace(/(\.[a-zA-Z]+)(\?|$)/, `${size}$1$2`) : src;
  return <img className={`ceo-thumb${large ? " is-large" : ""}`} src={sized} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

/** A plain table. Rows open on click when onRow is given. `hide` drops a column on phones, `lap` on laptops too. */
export function Table({ columns, rows, rowKey = (r) => r.id, onRow, empty }) {
  if (!rows?.length) return <Empty text={empty} />;
  const cls = (c) => [c.right ? "is-right" : "", c.hide ? "ceo-hide-sm" : "", c.lap ? "ceo-hide-lap" : "", c.tab ? "ceo-hide-tab" : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="ceo-table-wrap">
      <table className="ceo-table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={cls(c)}>{c.info ? <InfoTip text={c.info}>{c.label}</InfoTip> : c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={rowKey(r, i)}
              className={onRow ? "is-link" : undefined}
              tabIndex={onRow ? 0 : undefined}
              onClick={onRow ? () => onRow(r) : undefined}
              onKeyDown={onRow ? (e) => { if (e.key === "Enter") onRow(r); } : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={cls(c)}>{c.render ? c.render(r, i) : r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ page, pages, onChange }) {
  if (!pages || pages < 2) return null;
  return (
    <div className="ceo-pager">
      <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
      <span>Page {page} of {num(pages)}</span>
      <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }) {
  return (
    <label className="ceo-search">
      <Icon name="search" />
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && <button type="button" onClick={() => onChange("")} aria-label="Clear search"><Icon name="close" /></button>}
    </label>
  );
}

export function Seg({ options, value, onChange, label }) {
  return (
    <div className="ceo-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}{o.count != null && <small>{num(o.count)}</small>}
        </button>
      ))}
    </div>
  );
}

/**
 * Our dropdown. The list is drawn on top of the page so a table or a drawer can
 * never cut it off, and flips upward when there is no room below.
 */
export function Select({ value, onChange, options, placeholder = "Choose", label, search, compact, disabled, tone }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState(null);
  const button = useRef(null);
  const list = useRef(null);
  const showSearch = search ?? options.length > 8;
  const current = options.find((o) => String(o.value) === String(value));

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const height = Math.min(320, options.length * 38 + (showSearch ? 54 : 12));
    const below = window.innerHeight - r.bottom;
    const up = below < height + 12 && r.top > below;
    const width = Math.max(r.width, 190);
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      width,
      ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
    });
  }, [open, options.length, showSearch]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (button.current?.contains(e.target) || list.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    const onScroll = (e) => { if (!list.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? options.filter((o) => String(o.label).toLowerCase().includes(t)) : options;
  }, [q, options]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`ceo-select${compact ? " is-compact" : ""}${tone ? ` is-${tone}` : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); setQ(""); setOpen(!open); }}
      >
        <span>{current ? current.label : placeholder}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && pos && createPortal(
        <div className="ceo-pop-root">
          <div ref={list} className="ceo-pop" style={pos} role="listbox" aria-label={label} onClick={(e) => e.stopPropagation()}>
            {showSearch && (
              <div className="ceo-pop-search">
                <input autoFocus type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to find" aria-label="Type to find" />
              </div>
            )}
            <div className="ceo-pop-list">
              {shown.length === 0 && <div className="ceo-pop-none">No match</div>}
              {shown.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={String(o.value) === String(value)}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                >
                  {o.label}
                  {String(o.value) === String(value) && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const toKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Our calendar. First tap sets the start, second tap sets the end. */
export function DateRange({ from, to, onChange }) {
  const [view, setView] = useState(() => {
    const d = from ? new Date(`${from}T12:00:00`) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const today = toKey(new Date());
  const cells = useMemo(() => {
    const out = [];
    const lead = (view.getDay() + 6) % 7;
    for (let i = 0; i < lead; i += 1) out.push(null);
    const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= days; d += 1) out.push(new Date(view.getFullYear(), view.getMonth(), d));
    return out;
  }, [view]);
  const pick = (key) => {
    if (!from || (from && to) || key < from) onChange(key, "");
    else onChange(from, key);
  };
  const move = (n) => setView(new Date(view.getFullYear(), view.getMonth() + n, 1));
  return (
    <div className="ceo-calendar">
      <div className="ceo-cal-head">
        <button type="button" onClick={() => move(-1)} aria-label="Previous month"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg></button>
        <b>{view.toLocaleString("en-IN", { month: "long", year: "numeric" })}</b>
        <button type="button" onClick={() => move(1)} aria-label="Next month"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></button>
      </div>
      <div className="ceo-cal-grid">
        {WEEK.map((w) => <span key={w} className="ceo-cal-dow">{w}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={`x${i}`} />;
          const key = toKey(d);
          const edge = key === from || key === to;
          const between = from && to && key > from && key < to;
          const future = key > today;
          return (
            <button
              key={key}
              type="button"
              disabled={future}
              aria-pressed={edge}
              className={`${edge ? "is-edge" : ""}${between ? " is-between" : ""}${key === today ? " is-today" : ""}`}
              onClick={() => pick(key)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <p className="ceo-cal-note">
        {from && to && `${from.split("-").reverse().join("-")} to ${to.split("-").reverse().join("-")}`}
        {from && !to && `From ${from.split("-").reverse().join("-")}. Now choose the end date.`}
        {!from && "Choose a start date."}
      </p>
    </div>
  );
}

/** Panel that slides in from the right. Closes on Escape or a click outside. */
export function Drawer({ title, sub, onClose, onBack, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Drawn at the top of the dashboard, not inside the page: a fixed panel inside
  // a scrolling area is clipped to that area on iPhone Safari, so it opened
  // inside the page instead of over the whole window.
  const host = typeof document !== "undefined" ? document.querySelector(".ceo") : null;
  const panel = (
    <div className="ceo-drawer-root" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "Details"}>
      <button type="button" className="ceo-drawer-back" aria-label="Close" onClick={onClose} />
      <aside className={`ceo-drawer${wide ? " is-wide" : ""}`}>
        <header className="ceo-drawer-head">
          {onBack && (
            <button type="button" className="ceo-icon-btn" onClick={onBack} aria-label="Back">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
            </button>
          )}
          <div className="ceo-drawer-titles">
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <button type="button" className="ceo-icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </header>
        <div className="ceo-drawer-body">{children}</div>
        {footer && <footer className="ceo-drawer-foot">{footer}</footer>}
      </aside>
    </div>
  );
  return host ? createPortal(panel, host) : panel;
}

export function FilterGroup({ label, children }) {
  return (
    <div className="ceo-fgroup">
      <span className="ceo-label">{label}</span>
      {children}
    </div>
  );
}

/** Tap to choose. One value, or many when `value` is a list. */
export function Chips({ options, value, onChange }) {
  const many = Array.isArray(value);
  const on = (v) => (many ? value.includes(v) : value === v);
  const tap = (v) => {
    if (many) onChange(on(v) ? value.filter((x) => x !== v) : [...value, v]);
    else onChange(on(v) ? "" : v);
  };
  return (
    <div className="ceo-chips">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={on(o.value)} onClick={() => tap(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function FilterButton({ count = 0, onClick, label = "Filters" }) {
  return (
    <button type="button" className={`ceo-btn${count ? " is-on" : ""}`} onClick={onClick}>
      <Icon name="filter" />{label}{count > 0 && <b>{count}</b>}
    </button>
  );
}

const norm = (s) => String(s || "").toLowerCase();

/** Find anything from one box: a page, an order, a client or a design. Press / to jump to it. */
export function GlobalSearch({ pages, orders, products, clients, onPage, onOrder, onClient, onDesign }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const input = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      const typing = /input|textarea/i.test(e.target?.tagName || "");
      if (e.key === "/" && !typing) { e.preventDefault(); input.current?.focus(); }
      if (e.key === "Escape") setOpen(false);
    };
    const onDoc = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDoc); };
  }, []);

  const results = useMemo(() => {
    const t = norm(q).trim();
    if (t.length < 2) return [];
    const out = [];
    pages.filter((p) => norm(p.label).includes(t)).slice(0, 3)
      .forEach((p) => out.push({ key: `p${p.id}`, kind: "Page", label: p.label, go: () => onPage(p.id) }));
    (orders || []).filter((o) => norm(o.order_no).includes(t) || norm(o.po_number).includes(t)).slice(0, 4)
      .forEach((o) => out.push({ key: `o${o.id}`, kind: "Order", label: o.order_no, meta: o.delivery_name || "", go: () => onOrder(o) }));
    (clients || []).filter((c) => norm(c.name).includes(t) || norm(c.phone).includes(t)).slice(0, 4)
      .forEach((c) => out.push({ key: `c${c.phone}`, kind: "Client", label: c.name, meta: shortInr(c.totalSpend), go: () => onClient(c) }));
    (products || []).filter((p) => norm(p.name).includes(t) || norm(p.sku_id).includes(t)).slice(0, 4)
      .forEach((p) => out.push({ key: `d${p.id}`, kind: "Design", label: p.name, meta: p.sku_id || "", go: () => onDesign(p) }));
    return out;
  }, [q, pages, orders, products, clients, onPage, onOrder, onClient, onDesign]);

  return (
    <div className="ceo-global" ref={box}>
      <label className="ceo-search">
        <Icon name="search" />
        <input
          ref={input}
          type="text"
          value={q}
          placeholder="Search orders, clients or designs"
          aria-label="Find an order, client, design or page"
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
        <kbd>/</kbd>
      </label>
      {open && q.trim().length >= 2 && (
        <div className="ceo-global-list">
          {results.length === 0 && <div className="ceo-empty">Nothing matches "{q.trim()}".</div>}
          {results.map((r) => (
            <button key={r.key} type="button" onClick={() => { setOpen(false); setQ(""); r.go(); }}>
              <span className="ceo-tag">{r.kind}</span>
              <b title={r.label}>{r.label}</b>
              {r.meta && <small>{r.meta}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
