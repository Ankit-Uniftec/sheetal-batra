import React, { useMemo, useState } from "react";
import { Topline, Seg, KpiCard, StockBadge, ProductCell, Badge, SizeSummary, Icon } from "./StockRoomUi";
import {
  formatUnits, formatInr, TYPE_LABELS, TYPE_LXRTS, sortSizes, sizeLabel, rebalanceSuggestions, stockAgeing,
} from "./stockRoomModel";
import { buildCsv, downloadCsv } from "../../components/AddProduct/csvHelpers";

const AGE_COLOR = { ok: "var(--sr-ok)", gold: "var(--sr-gold)", low: "var(--sr-warn)", crit: "var(--sr-crit)" };

const RANGES = [
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
  { value: 365, label: "Year" },
];

export default function OverviewScreen({ view, days, setDays, go, openProduct, openAction, canWrite, salesReady = true }) {
  const { totals, sales } = view;
  const ledger = view.ledger;
  const [now] = useState(() => Date.now());

  // Sizes a store has none of while another location holds spare.
  const rebalance = useMemo(() => (ledger?.installed
    ? rebalanceSuggestions({ tracked: view.tracked, placementById: ledger.placementById, locations: ledger.locations, salesByProduct: sales.byProduct })
    : []), [ledger, view.tracked, sales.byProduct]);

  const ageing = useMemo(() => (ledger?.installed ? stockAgeing(ledger.movements, ledger.index, ledger.transitId, now) : []), [ledger, now]);
  const agedUnits = ageing.reduce((a, b) => a + b.units, 0);

  // Stock by location and size: one row per design, size and place, unassigned included.
  const exportCsv = () => {
    const headers = ["sku_id", "design", "type", "size", "location", "location_type", "units"];
    const out = [];
    view.tracked.forEach((r) => {
      if (r.stock.unlimited) return;
      const base = { sku_id: r.product.sku_id || "", design: r.product.name, type: TYPE_LABELS[r.type] };
      const p = ledger?.installed ? ledger.placementById[r.id] : null;
      if (!p) {
        if (r.stock.bySize) Object.entries(r.stock.bySize).forEach(([size, units]) => out.push({ ...base, size: sizeLabel(size), location: "All", location_type: "", units }));
        else out.push({ ...base, size: "", location: "All", location_type: "", units: r.stock.total });
        return;
      }
      Object.entries(p.byLocation).forEach(([loc, bySize]) => {
        const l = ledger.locationsById[loc];
        Object.entries(bySize).forEach(([size, units]) => {
          if (units) out.push({ ...base, size: size ? sizeLabel(size) : "", location: l?.name || "Closed location", location_type: l?.kind || "", units });
        });
      });
      if (r.stock.bySize) Object.entries(p.unassignedBySize).forEach(([size, units]) => out.push({ ...base, size: sizeLabel(size), location: "Unassigned", location_type: "", units }));
      else if (p.unassigned) out.push({ ...base, size: "", location: "Unassigned", location_type: "", units: p.unassigned });
    });
    downloadCsv(`stock-by-location-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(headers, out));
  };

  // Held vs sold per size, LXRTS only: Custom pieces carry one number with no
  // size split, so they cannot sit on a size axis without inventing one.
  const curve = useMemo(() => {
    const sizes = sortSizes([...Object.keys(view.heldBySize), ...Object.keys(sales.trackedBySize)]);
    const rows = sizes.map((s) => ({ size: s, held: view.heldBySize[s] || 0, sold: sales.trackedBySize[s] || 0 }));
    const max = Math.max(1, ...rows.map((r) => Math.max(r.held, r.sold)));
    return { rows, max };
  }, [view.heldBySize, sales.trackedBySize]);

  const byCategory = useMemo(() => {
    const map = {};
    view.tracked.forEach((r) => {
      if (r.stock.unlimited) return;
      const key = (r.product.store_category || "").trim() || "All Stores";
      map[key] = (map[key] || 0) + r.stock.total;
    });
    const list = Object.entries(map).map(([name, units]) => ({ name, units })).sort((a, b) => b.units - a.units);
    return { list, max: Math.max(1, ...list.map((l) => l.units)), total: list.reduce((a, l) => a + l.units, 0) };
  }, [view.tracked]);

  const bestSellers = useMemo(() => view.tracked
    .map((r) => ({ r, sold: sales.byProduct[r.id]?.units || 0 }))
    .filter((x) => x.sold > 0)
    .sort((a, b) => b.sold - a.sold)
    .slice(0, 6), [view.tracked, sales.byProduct]);

  // A size that sold in the window and now holds nothing: the clearest reorder signal.
  const soldOut = useMemo(() => {
    const out = [];
    view.tracked.forEach((r) => {
      if (r.type !== TYPE_LXRTS) return;
      const soldBySize = sales.byProduct[r.id]?.bySize || {};
      r.sizesOut.forEach((s) => { if (soldBySize[s]) out.push({ r, size: s, sold: soldBySize[s] }); });
    });
    return out.sort((a, b) => b.sold - a.sold).slice(0, 6);
  }, [view.tracked, sales.byProduct]);

  // Out of stock designs, the ones that were selling first: an empty design
  // nobody buys matters less than one that sold last week.
  const attention = useMemo(() => view.tracked
    .filter((r) => r.status === "out")
    .sort((a, b) => b.sold90 - a.sold90 || String(a.product.name).localeCompare(String(b.product.name))), [view.tracked]);

  const rangeLabel = days === 365 ? "last year" : `last ${days} days`;

  return (
    <>
      <Topline title="Overview" sub="LXRTS and custom piece stock across the catalogue">
        <Seg label="Sales period" options={RANGES} value={days} onChange={setDays} />
        <button type="button" className="sr-btn" onClick={exportCsv}><Icon name="download" width={1.7} />Export CSV</button>
      </Topline>
      <div className="sr-body">
        <div className="sr-grid k4">
          <KpiCard icon="stock" label="Units on hand" value={formatUnits(totals.trackedUnits)}
            note={`${formatUnits(totals.lxrtsUnits)} LXRTS · ${formatUnits(totals.customUnits)} custom`}
            onClick={() => go("stock")} />
          <KpiCard icon="inr" label="Stock value" value={formatInr(totals.value)} note="at current list price"
            onClick={() => go("products")} />
          <KpiCard icon="trend" label={`Sold, ${rangeLabel}`} value={salesReady ? formatUnits(sales.trackedUnits) : "…"}
            note={salesReady ? "LXRTS and custom pieces" : "Loading sales…"} onClick={() => go("products")} />
          {/* Out of stock leads: "below 5" covers most LXRTS designs, which
              usually hold one or two of each size, so it can't lead as a number. */}
          <KpiCard icon="alert" label="Out of stock" value={formatUnits(totals.out)}
            note={`designs · ${formatUnits(totals.low)} more below 5 units`} onClick={() => go("stock", { status: "out" })} />
        </div>

        <div className="sr-grid split">
          <div className="sr-card">
            <div className="sr-card-head">
              <h2>Size curve</h2>
              <div className="sr-legend">
                <span><i style={{ background: "var(--sr-s1)" }} />Held</span>
                <span><i style={{ background: "var(--sr-s2)" }} />Sold, {rangeLabel}</span>
              </div>
            </div>
            <p className="sr-card-sub">
              LXRTS units on hand against units sold, by size. Custom pieces have no size split, so they are not on this chart.
              {!salesReady && " Sales are still loading."}
            </p>
            {curve.rows.length ? (
              <div className="sr-chart" role="img" aria-label="Units held and sold by size">
                {curve.rows.map((row) => (
                  <div className="sr-colgrp" key={row.size} title={`Size ${row.size}: ${row.held} held, ${row.sold} sold`}>
                    <div className="sr-colpair">
                      <span className="sr-col sr-col-1" style={{ height: `${Math.max(1.5, (row.held / curve.max) * 100)}%` }} />
                      <span className="sr-col sr-col-2" style={{ height: `${Math.max(1.5, (row.sold / curve.max) * 100)}%` }} />
                    </div>
                    <span className="sr-col-x">{row.size}</span>
                  </div>
                ))}
              </div>
            ) : <p className="sr-empty">No LXRTS sizes are recorded yet.</p>}
          </div>

          {view.ledger?.installed ? (
            <div className="sr-card">
              <div className="sr-card-head"><h2>Where the stock is</h2></div>
              <p className="sr-card-sub">Units held at each store and warehouse. Click one to open it.</p>
              <div className="sr-hbars">
                {(() => {
                  const bars = [
                    ...ledger.locations.map((l) => ({ id: l.id, name: l.name, note: l.kind === "store" ? "store" : "warehouse", units: ledger.locationStats[l.id]?.units || 0 })),
                    { id: "transit", name: "In transit", note: "sent, not received", units: ledger.totals.inTransitUnits },
                    { id: "unassigned", name: "Unassigned", note: "not yet placed", units: ledger.totals.unassignedUnits },
                  ].filter((b) => b.units > 0).sort((a, b) => b.units - a.units);
                  const max = Math.max(1, ...bars.map((b) => b.units));
                  const total = bars.reduce((a, b) => a + b.units, 0);
                  if (!bars.length) return <p className="sr-empty">No tracked units yet.</p>;
                  return bars.map((b) => (
                    <button type="button" className="sr-hbar-row" key={b.id} onClick={() => (b.id === "transit" ? go("transfers", { status: "transit" }) : go("locations"))}>
                      <div className="sr-hbar-l">{b.name}<em>{b.note} · {Math.round((b.units / Math.max(1, total)) * 100)}%</em></div>
                      <div className="sr-hbar-t"><div className="sr-hbar-f" style={{ width: `${Math.max(2, (b.units / max) * 100)}%`, opacity: b.id === "unassigned" || b.id === "transit" ? 0.45 : 1 }} /></div>
                      <div className="sr-hbar-v">{formatUnits(b.units)}</div>
                    </button>
                  ));
                })()}
              </div>
            </div>
          ) : (
          <div className="sr-card">
            <div className="sr-card-head"><h2>Units by store listing</h2></div>
            <p className="sr-card-sub">Where tracked designs are listed for sale. Location by warehouse starts once stock is placed.</p>
            <div className="sr-hbars">
              {byCategory.list.map((c) => (
                <div className="sr-hbar-row" key={c.name}>
                  <div className="sr-hbar-l">{c.name}<em>{Math.round((c.units / Math.max(1, byCategory.total)) * 100)}% of units</em></div>
                  <div className="sr-hbar-t"><div className="sr-hbar-f" style={{ width: `${Math.max(2, (c.units / byCategory.max) * 100)}%` }} /></div>
                  <div className="sr-hbar-v">{formatUnits(c.units)}</div>
                </div>
              ))}
              {!byCategory.list.length && <p className="sr-empty">No tracked units yet.</p>}
            </div>
          </div>
          )}
        </div>

        {ledger?.installed && (
          <div className="sr-grid halves">
            <div className="sr-card">
              <div className="sr-card-head"><h2>Rebalance suggestions</h2><Badge tone={rebalance.length ? "low" : "ok"}>{rebalance.length ? `${rebalance.length} moves` : "none"}</Badge></div>
              <p className="sr-card-sub">A store has none of a size that another location holds two or more of. Sizes that sold most come first.</p>
              <div className="sr-hbars" style={{ justifyContent: "flex-start", gap: 4 }}>
                {rebalance.map((x) => (
                  <div key={`${x.row.id}|${x.size}|${x.to.id}`} className="sr-sl-row">
                    <button type="button" className="sr-linkbtn" style={{ minWidth: 0, textAlign: "left" }} onClick={() => openProduct(x.row.id)}>
                      <ProductCell product={x.row.product} />
                    </button>
                    <span className="sr-muted" style={{ whiteSpace: "nowrap" }}>
                      {x.size ? sizeLabel(x.size) : "One size"} · {x.from.name} ({x.have}) → {x.to.name}{x.sold ? ` · ${x.sold} sold` : ""}
                    </span>
                    {canWrite && (
                      <button type="button" className="sr-rowbtn" onClick={() => openAction("transfer", {
                        fromId: x.from.id, toId: x.to.id, lines: [{ productId: x.row.id, size: x.size, qty: 1 }],
                      })}>Move 1</button>
                    )}
                  </div>
                ))}
                {!rebalance.length && <p className="sr-empty">Every store holds the sizes that other locations have spare.</p>}
              </div>
            </div>

            <div className="sr-card">
              <div className="sr-card-head"><h2>Stock ageing</h2><Badge tone="plain">{formatUnits(agedUnits)} units</Badge></div>
              <p className="sr-card-sub">Units at each location by how long ago they arrived there. Stock placed before tracking began counts from the day it was placed.</p>
              <div className="sr-hbars">
                {ageing.map((b) => (
                  <div className="sr-hbar-row" key={b.key}>
                    <div className="sr-hbar-l">{b.label}<em>{Math.round((b.units / Math.max(1, agedUnits)) * 100)}% of units</em></div>
                    <div className="sr-hbar-t"><div className="sr-hbar-f" style={{ width: `${Math.max(2, (b.units / Math.max(1, ...ageing.map((a) => a.units))) * 100)}%`, background: AGE_COLOR[b.tone] }} /></div>
                    <div className="sr-hbar-v">{formatUnits(b.units)}</div>
                  </div>
                ))}
                {!agedUnits && <p className="sr-empty">No stock has been placed in a location yet.</p>}
              </div>
            </div>
          </div>
        )}

        <div className="sr-grid halves">
          <div className="sr-card">
            <div className="sr-card-head"><h2>Best sellers</h2><Badge tone="gold">{rangeLabel}</Badge></div>
            <p className="sr-card-sub">Tracked designs by units sold, with what is left.</p>
            <div className="sr-hbars">
              {bestSellers.map(({ r, sold }) => (
                <button type="button" className="sr-hbar-row" key={r.id} onClick={() => openProduct(r.id)}>
                  <div className="sr-hbar-l" title={r.product.name}>{r.product.name}<em>{r.stock.unlimited ? "unlimited" : `${formatUnits(r.stock.total)} left`}</em></div>
                  <div className="sr-hbar-t"><div className="sr-hbar-f" style={{ width: `${Math.max(2, (sold / bestSellers[0].sold) * 100)}%` }} /></div>
                  <div className="sr-hbar-v">{formatUnits(sold)}</div>
                </button>
              ))}
              {!bestSellers.length && <p className="sr-empty">{salesReady ? "No tracked designs sold in this period." : "Loading sales…"}</p>}
            </div>
          </div>

          <div className="sr-card">
            <div className="sr-card-head"><h2>Sold out after selling</h2><Badge tone={soldOut.length ? "crit" : "ok"}>{soldOut.length ? `${soldOut.length} sizes` : "none"}</Badge></div>
            <p className="sr-card-sub">LXRTS sizes that sold in this period and now hold nothing.</p>
            <div className="sr-hbars" style={{ justifyContent: "flex-start", gap: 4 }}>
              {soldOut.map(({ r, size, sold }) => (
                <button type="button" key={`${r.id}-${size}`} className="sr-sl-row sr-soldout" onClick={() => openProduct(r.id)}>
                  <ProductCell product={r.product} />
                  <span className="sr-szc is-zero">{size} <b>0</b></span>
                  <span className="sr-muted sr-num">{sold} sold</span>
                </button>
              ))}
              {!soldOut.length && <p className="sr-empty">{salesReady ? "Every size that sold still has stock." : "Loading sales…"}</p>}
            </div>
          </div>
        </div>

        <div className="sr-card">
          <div className="sr-card-head"><h2>Out of stock</h2><Badge tone={attention.length ? "crit" : "ok"}>{attention.length ? `${attention.length} designs` : "none"}</Badge></div>
          <p className="sr-card-sub">Tracked designs with no units left, the ones that sold most in the last 90 days first.</p>
          <div className="sr-scroller">
            <table className="sr-table sr-rtable">
              <thead><tr><th>Design</th><th>Type</th><th className="n">Sold 90d</th><th>Sizes</th><th>Status</th></tr></thead>
              <tbody>
                {attention.slice(0, 10).map((r) => (
                  <tr key={r.id} className="is-link" onClick={() => openProduct(r.id)}>
                    <td className="is-primary"><ProductCell product={r.product} /></td>
                    <td data-label="Type">{TYPE_LABELS[r.type]}</td>
                    <td data-label="Sold 90d" className="n">{formatUnits(r.sold90)}</td>
                    <td data-label="Sizes" className="is-wide"><SizeSummary sizes={r.stock.sizes} stock={r.type === TYPE_LXRTS ? r.stock : null} /></td>
                    <td data-label="Status"><StockBadge status={r.status} /></td>
                  </tr>
                ))}
                {!attention.length && <tr><td colSpan={5} className="sr-empty">Every tracked design has stock.</td></tr>}
              </tbody>
            </table>
          </div>
          {attention.length > 10 && (
            <div className="sr-more"><button type="button" className="sr-btn" onClick={() => go("stock", { status: "out" })}>See all {attention.length} in Stock</button></div>
          )}
        </div>
      </div>
    </>
  );
}
