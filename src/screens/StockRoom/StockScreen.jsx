import React, { useMemo, useState } from "react";
import { Topline, Seg, SearchField, StockBadge, ProductCell, Icon, Badge, usePaged, SearchSelect } from "./StockRoomUi";
import { formatUnits, formatInr, sortSizes, sizeLabel, TYPE_LXRTS, TYPE_CUSTOM } from "./stockRoomModel";

const TYPE_OPTIONS = [
  { value: "all", label: "All tracked" },
  { value: TYPE_LXRTS, label: "LXRTS" },
  { value: TYPE_CUSTOM, label: "Custom pieces" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "Any stock" },
  { value: "out", label: "Out of stock" },
  { value: "attention", label: "Out or low" },
];

const matches = (r, q) => {
  if (!q) return true;
  const p = r.product;
  return [p.name, p.sku_id, p.shopify_product_id].some((v) => String(v || "").toLowerCase().includes(q));
};

/**
 * Size chips for one design. LXRTS shows each size with its count; a custom
 * piece has no per-size count, so it lists the sizes it is made in, dashed.
 */
export function SizeChips({ stock, compact = false }) {
  if (!stock.bySize) {
    if (!stock.sizes.length) return <span className="sr-muted">No sizes listed</span>;
    return (
      <span className="sr-szc-list" title="Custom pieces hold one count for the whole design">
        {stock.sizes.map((s) => <span key={s} className="sr-szc is-plain">{sizeLabel(s)}</span>)}
      </span>
    );
  }
  if (!stock.sizes.length) return <span className="sr-muted">No size records</span>;

  // Compact (list rows): sizes holding stock or a fault stay visible; empty
  // sizes fold into one chip, so an eleven-size design with nothing left reads
  // "11 sizes, all empty" instead of a line of zeros.
  const empty = stock.sizes.filter((s) => !stock.bySize[s] && !stock.invalidSizes.includes(s));
  const shown = compact ? stock.sizes.filter((s) => !empty.includes(s)) : stock.sizes;
  const folded = compact && empty.length > 0 && (empty.length > 2 || shown.length === 0);
  const visibleSizes = folded ? shown : stock.sizes;

  return (
    <span className="sr-szc-list">
      {folded && shown.length === 0 && (
        <span className="sr-szc is-zero" title={empty.join(", ")}>{empty.length} sizes, all empty</span>
      )}
      {visibleSizes.map((s) => {
        if (stock.invalidSizes.includes(s)) {
          return (
            <span key={s} className="sr-szc is-invalid" title="This size's stock record holds an impossible number. Left out of totals — see Integrity.">
              {sizeLabel(s)} <b>!</b>
            </span>
          );
        }
        const n = stock.bySize[s] || 0;
        return <span key={s} className={`sr-szc${n ? "" : " is-zero"}`}>{sizeLabel(s)} <b>{n}</b></span>;
      })}
      {folded && shown.length > 0 && (
        <span className="sr-szc is-zero" title={`Empty: ${empty.join(", ")}`}>+{empty.length} empty</span>
      )}
    </span>
  );
}

/** Size chips for a { size: qty } map (units at one place). */
export function QtyChips({ bySize }) {
  const sizes = sortSizes(Object.keys(bySize || {}).filter((s) => bySize[s]));
  if (!sizes.length) return <span className="sr-muted">—</span>;
  return (
    <span className="sr-szc-list">
      {sizes.map((s) => <span key={s || "one"} className="sr-szc">{s ? sizeLabel(s) : "One size"} <b>{formatUnits(bySize[s])}</b></span>)}
    </span>
  );
}

const firstSize = (bySize) => sortSizes(Object.keys(bySize || {}).filter((s) => bySize[s] > 0))[0] ?? "";

function StockDetail({ row, view, warehousesById, openProduct, openAction, canWrite }) {
  const ledger = view.ledger;
  const legacy = view.legacyByProduct[row.id] || [];

  if (ledger?.installed) {
    const p = ledger.placementById[row.id];
    const here = ledger.locations
      .map((l) => ({ l, bySize: p?.byLocation[l.id] || {} }))
      .map((x) => ({ ...x, units: Object.values(x.bySize).reduce((a, n) => a + n, 0) }))
      .filter((x) => x.units > 0);
    const product = { productId: row.id };
    return (
      <div className="sr-sl-detail">
        {p?.toAssign > 0 && (
          <div className="sr-sl-loc" style={{ borderColor: "var(--sr-warn)", background: "var(--sr-warn-bg)" }}>
            <span className="sr-sl-loc-name">Sold elsewhere<em>Order form or website — no location chosen yet</em></span>
            {row.type === TYPE_CUSTOM ? <span className="sr-szc-list" /> : <QtyChips bySize={p.toAssignBySize} />}
            <span className="sr-sl-loc-v">{formatUnits(p.toAssign)}</span>
            {canWrite && (
              <button type="button" className="sr-rowbtn" onClick={() => openAction("assign", {
                lines: [{ ...product, size: row.type === TYPE_CUSTOM ? "" : firstSize(p.toAssignBySize), qty: 1 }],
              })}>Assign</button>
            )}
          </div>
        )}
        {here.map(({ l, bySize, units }) => (
          <div className="sr-sl-loc" key={l.id}>
            <span className="sr-sl-loc-name">{l.name}<em>{l.kind === "store" ? "Store" : "Warehouse"}{l.city ? ` · ${l.city}` : ""}</em></span>
            <QtyChips bySize={bySize} />
            <span className="sr-sl-loc-v">{formatUnits(units)}</span>
            {canWrite && (
              <span style={{ whiteSpace: "nowrap" }}>
                <button type="button" className="sr-rowbtn" onClick={() => openAction("sell", { locationId: l.id, lines: [{ ...product, size: firstSize(bySize), qty: 1 }] })}>Sell</button>
                <button type="button" className="sr-rowbtn" onClick={() => openAction("transfer", { fromId: l.id, lines: [{ ...product, size: firstSize(bySize), qty: 1 }] })}>Move</button>
                <button type="button" className="sr-rowbtn" onClick={() => openAction("adjust", { locationId: l.id, lines: [{ ...product, size: firstSize(bySize) }], counted: bySize[firstSize(bySize)] })}>Recount</button>
              </span>
            )}
          </div>
        ))}
        {(() => {
          const transit = ledger.transitId ? p?.byLocation[ledger.transitId] || {} : {};
          const units = Object.values(transit).reduce((a, n) => a + n, 0);
          if (!units) return null;
          return (
            <div className="sr-sl-loc">
              <span className="sr-sl-loc-name">In transit<em>Sent, not yet received</em></span>
              <QtyChips bySize={transit} />
              <span className="sr-sl-loc-v">{formatUnits(units)}</span>
            </div>
          );
        })()}
        {(p?.unassigned > 0 || !here.length) && (
          <div className="sr-sl-loc">
            <span className="sr-sl-loc-name">Unassigned<em>Counted, but not yet placed in a location</em></span>
            {row.type === TYPE_CUSTOM ? <span className="sr-szc-list"><span className="sr-szc">All sizes <b>{formatUnits(p?.unassigned || 0)}</b></span></span> : <QtyChips bySize={p?.unassignedBySize} />}
            <span className="sr-sl-loc-v">{formatUnits(p?.unassigned || 0)}</span>
            {canWrite && p?.unassigned > 0 && (
              <button type="button" className="sr-rowbtn" onClick={() => openAction("place", {
                lines: [{ ...product, size: row.type === TYPE_CUSTOM ? (row.stock.sizes[0] || "") : firstSize(p.unassignedBySize), qty: 1 }],
              })}>Place</button>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canWrite && (
            <>
              <button type="button" className="sr-btn" onClick={() => openAction("receive", { lines: [{ ...product, size: row.stock.sizes[0] || "", qty: 1 }] })}>Receive stock</button>
              <button type="button" className="sr-btn" onClick={() => openAction("adjust", { locationId: "", lines: [{ ...product, size: row.type === TYPE_CUSTOM ? "" : (row.stock.sizes.find((s) => !row.stock.invalidSizes.includes(s)) || "") }] })}>Recount total</button>
            </>
          )}
          <button type="button" className="sr-btn" onClick={() => openProduct(row.id)}>Open full breakdown<Icon name="chevron" width={2} /></button>
        </div>
      </div>
    );
  }

  return (
    <div className="sr-sl-detail">
      <div className="sr-sl-loc">
        <span className="sr-sl-loc-name">Unassigned<em>Not yet placed in a location</em></span>
        <SizeChips stock={row.stock} />
        <span className="sr-sl-loc-v">{row.stock.unlimited ? "—" : formatUnits(row.stock.total)}</span>
      </div>
      {legacy.map((ws) => (
        <div className="sr-sl-loc" key={ws.id}>
          <span className="sr-sl-loc-name">{warehousesById[ws.warehouse_id]?.name || "Warehouse"}<em>Warehouses tab record · no sizes</em></span>
          <span className="sr-szc-list" />
          <span className="sr-sl-loc-v">{formatUnits(ws.quantity)}</span>
        </div>
      ))}
      <div>
        <button type="button" className="sr-btn" onClick={() => openProduct(row.id)}>
          Open full breakdown<Icon name="chevron" width={2} />
        </button>
      </div>
    </div>
  );
}

export default function StockScreen({ view, warehousesById, initialStatus, openProduct, openAction, canWrite }) {
  const ledger = view.ledger;
  const [type, setType] = useState("all");
  const [status, setStatus] = useState(initialStatus || "all");
  const [locationId, setLocationId] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState({});
  const q = search.trim().toLowerCase();

  const statusOptions = ledger?.installed
    ? [...STATUS_OPTIONS, { value: "unassigned", label: "Has unassigned" }, { value: "toassign", label: "Sold elsewhere" }]
    : STATUS_OPTIONS;

  const rows = useMemo(() => view.tracked.filter((r) => {
    if (type !== "all" && r.type !== type) return false;
    if (status === "attention" && r.status !== "out" && r.status !== "low") return false;
    if (status === "out" && r.status !== "out") return false;
    if (status === "unassigned" && !(ledger?.placementById[r.id]?.unassigned > 0)) return false;
    if (status === "toassign" && !(ledger?.placementById[r.id]?.toAssign > 0)) return false;
    if (locationId && !ledger?.index.byLocation[locationId]?.[r.id]) return false;
    return matches(r, q);
  }), [view.tracked, type, status, locationId, ledger, q]);

  const summary = useMemo(() => {
    const bySize = {};
    let units = 0;
    let value = 0;
    rows.forEach((r) => {
      if (r.stock.unlimited) return;
      units += r.stock.total;
      value += r.value;
      if (r.stock.bySize) Object.entries(r.stock.bySize).forEach(([s, n]) => { const l = sizeLabel(s); bySize[l] = (bySize[l] || 0) + n; });
    });
    const sizes = sortSizes(Object.keys(bySize)).filter((s) => bySize[s] > 0);
    return { bySize, sizes, units, value };
  }, [rows]);

  const [visible, more] = usePaged(rows, 50, `${type}|${status}|${locationId}|${q}`);
  const toggle = (id) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  const sub = ledger?.installed
    ? `${formatUnits(view.totals.trackedUnits)} units · ${formatUnits(ledger.totals.placedUnits)} placed · ${formatUnits(ledger.totals.unassignedUnits)} unassigned${ledger.totals.toAssignUnits ? ` · ${formatUnits(ledger.totals.toAssignUnits)} sold elsewhere` : ""}`
    : `${formatUnits(view.totals.trackedUnits)} units across ${formatUnits(view.tracked.length)} designs · Made to order is not tracked`;

  return (
    <>
      <Topline title="Stock" sub={sub}>
        <SearchField value={search} onChange={setSearch} placeholder="Design, SKU or Shopify ID" label="Search stock" />
        {canWrite && (
          <>
            <button type="button" className="sr-btn" onClick={() => openAction("place")}>Place</button>
            <button type="button" className="sr-btn" onClick={() => openAction("transfer")}><Icon name="transfer" width={1.7} />Transfer</button>
            <button type="button" className="sr-btn" onClick={() => openAction("sell")}>Mark sold</button>
            <button type="button" className="sr-btn" onClick={() => openAction("adjust")}>Recount</button>
            <button type="button" className="sr-btn sr-btn-primary" onClick={() => openAction("receive")}><Icon name="plus" width={2} />Receive stock</button>
          </>
        )}
      </Topline>
      <div className="sr-body">
        <div className="sr-card">
          <div className="sr-card-head" style={{ marginBottom: 14 }}>
            <h2>Stock by design</h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Seg label="Product type" options={TYPE_OPTIONS} value={type} onChange={setType} />
              <Seg label="Stock status" options={statusOptions} value={status} onChange={setStatus} />
              {ledger?.installed && (
                <span style={{ width: 200 }}>
                  <SearchSelect options={ledger.locations.map((l) => ({ value: l.id, label: l.name }))} value={locationId}
                    onChange={setLocationId} placeholder="Every location" label="Location" />
                </span>
              )}
            </div>
          </div>

          {summary.sizes.length > 0 && (
            <div className="sr-sl-summary">
              <span className="sr-label">LXRTS units by size</span>
              {summary.sizes.map((s) => <span key={s} className="sr-szc">{s} <b>{formatUnits(summary.bySize[s])}</b></span>)}
            </div>
          )}

          <div className="sr-scroller">
          <div role="list" className="sr-sl-list">
            <div className="sr-sl-head" aria-hidden="true">
              <span />
              <span>Design</span>
              <span>Sizes</span>
              <span>Status</span>
              <span className="n">Units</span>
            </div>
            {visible.map((r) => {
              const isOpen = !!open[r.id];
              return (
                <div key={r.id} className={`sr-sl-item${isOpen ? " is-open" : ""}`} role="listitem">
                  <button type="button" className="sr-sl-row" aria-expanded={isOpen} onClick={() => toggle(r.id)}>
                    <span className="sr-caret"><Icon name="chevron" width={2} /></span>
                    <ProductCell product={r.product}
                      meta={<>{r.product.sku_id || "No SKU"}<span className="sr-sl-type"><Badge tone="plain">{r.type === TYPE_CUSTOM ? "Custom piece" : "LXRTS"}</Badge></span></>} />
                    {/* One group on narrow screens, two columns on wide ones (display: contents). */}
                    <span className="sr-sl-meta">
                      <SizeChips stock={r.stock} compact />
                      <span className="sr-sl-status"><StockBadge status={r.status} /></span>
                    </span>
                    <span className="n sr-sl-total">{r.stock.unlimited ? "∞" : formatUnits(r.stock.total)}</span>
                  </button>
                  {isOpen && <StockDetail row={r} view={view} warehousesById={warehousesById} openProduct={openProduct} openAction={openAction} canWrite={canWrite} />}
                </div>
              );
            })}
            {!rows.length && <p className="sr-empty">{q ? "Nothing matches that search." : "No designs match these filters."}</p>}
          </div>
          </div>
          {more}
          {rows.length > 0 && (
            <div className="sr-sl-totalbar">
              <span>{rows.length === view.tracked.length ? "All tracked designs" : `${formatUnits(rows.length)} designs shown`}</span>
              <span>{formatUnits(summary.units)} units · {formatInr(summary.value)}</span>
            </div>
          )}
          <p className="sr-note">
            Totals come from the same stock records the order form and the current inventory dashboard use.
            {ledger?.installed
              ? " Open a design to see which locations hold it, and to sell, move or recount it there."
              : " Every unit shows as unassigned until location tracking is set up. Open a design to see where it is recorded."}
          </p>
        </div>
      </div>
    </>
  );
}
