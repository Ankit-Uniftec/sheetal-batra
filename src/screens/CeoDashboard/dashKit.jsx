import React, { useMemo, useState } from "react";
import {
  Card as BaseCard, Chips, DateRange, Drawer, FilterButton, FilterGroup, Icon, InfoTip, SearchBox,
  Table as BaseTable, Tile as BaseTile, num,
} from "./CeoUi";

// ============================================================
// The shared pieces every redesigned dashboard uses (GM, Comms, …), so lists,
// filters, exports and definitions look and behave the same everywhere:
//
//   <ListTools>     one toolbar for every list: search · Filters · Export CSV
//   <FilterDrawer>  the side panel the Filters button opens, with a standard footer
//   usePagePeriod   an order-date filter for one list, with <PeriodFacet>
//   CsvButton, Stat, slug
//   defineKit()     Tile / Card / Table that carry a page's definitions
// ============================================================

/** A file-name-safe version of a title. */
export const slug = (t) => String(t || "export").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** The download button. Same size as Filters and every other toolbar control. */
export const CsvButton = ({ onClick, disabled, label = "Export CSV" }) => (
  <button type="button" className="ceo-btn" onClick={onClick} disabled={disabled}><Icon name="download" />{label}</button>
);

/** A small figure in a drawer, with its definition. */
export const Stat = ({ label, info, children }) => (
  <div className="ceo-dstat"><small>{info ? <InfoTip text={info}>{label}</InfoTip> : label}</small>{children}</div>
);

/**
 * The one toolbar above every list: search on the left; Filters (with how many
 * are on) and Export CSV on the right. Any part can be left out. `children`
 * sits between search and the buttons (for example status tabs).
 */
export function ListTools({ search, onSearch, placeholder = "Search", filters, onFilters, onExport, exportDisabled, children }) {
  return (
    <div className="ceo-tools dash-tools">
      {onSearch && <SearchBox value={search} onChange={onSearch} placeholder={placeholder} />}
      {children}
      <span className="dash-tools-end">
        {onFilters && <FilterButton count={filters || 0} onClick={onFilters} />}
        {onExport && <CsvButton onClick={onExport} disabled={exportDisabled} />}
      </span>
    </div>
  );
}

/** The side panel behind a Filters button. The footer clears or closes it. */
export function FilterDrawer({ open, onClose, onClear, count, noun = "results", sub = "Narrow the list", children }) {
  if (!open) return null;
  return (
    <Drawer
      title="Filters"
      sub={sub}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="ceo-btn" onClick={onClear}>Clear Filters</button>
          <button type="button" className="ceo-btn is-primary" onClick={onClose}>Show {num(count)} {noun}</button>
        </>
      )}
    >
      {children}
    </Drawer>
  );
}

const PAGE_PERIODS = [
  { value: "all", label: "All Time" }, { value: "today", label: "Today" }, { value: "week", label: "Last 7 Days" },
  { value: "month", label: "This Month" }, { value: "year", label: "This Year" }, { value: "custom", label: "Choose dates" },
];

/** An order-date filter for one list. Starts at All Time. */
export function usePagePeriod(start = "all") {
  const [period, setPeriod] = useState(start);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const range = useMemo(() => {
    if (period === "all") return null;
    const now = new Date();
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === "custom") return from ? { start: new Date(`${from}T00:00:00`), end: to ? new Date(`${to}T23:59:59.999`) : new Date(`${from}T23:59:59.999`) } : null;
    if (period === "today") return { start: day, end: now };
    if (period === "week") { day.setDate(day.getDate() - 6); return { start: day, end: now }; }
    if (period === "month") return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
    if (period === "year") return { start: new Date(now.getFullYear(), 0, 1), end: now };
    return null;
  }, [period, from, to]);
  const inPeriod = (ts) => !range || (ts && new Date(ts) >= range.start && new Date(ts) <= range.end);
  return {
    period, setPeriod, from, to, range, inPeriod,
    setRange: (a, b) => { setFrom(a); setTo(b); },
    reset: () => { setPeriod(start); setFrom(""); setTo(""); },
    active: period !== start,
  };
}

/** The period chips (and calendar for chosen dates) inside a FilterDrawer. */
export function PeriodFacet({ p, label = "Order Date" }) {
  return (
    <FilterGroup label={label}>
      <Chips options={PAGE_PERIODS} value={p.period} onChange={(v) => p.setPeriod(v || "all")} />
      {p.period === "custom" && <DateRange from={p.from} to={p.to} onChange={p.setRange} />}
    </FilterGroup>
  );
}

/**
 * Tile, Card and Table that look up their own definitions (the hover card on a
 * label) from a page's dictionaries. A page can still pass its own `info`.
 */
export function defineKit({ tiles = {}, cards = {}, columns = {} }) {
  const Tile = (p) => <BaseTile info={tiles[p.label]} {...p} />;
  const Card = (p) => <BaseCard info={cards[p.title]} {...p} />;
  const Table = ({ columns: cols, ...p }) => (
    <BaseTable {...p} columns={cols.map((c) => (c.info || !columns[c.label] ? c : { ...c, info: columns[c.label] }))} />
  );
  return { Tile, Card, Table };
}
