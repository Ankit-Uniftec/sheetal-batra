import React, { useMemo, useState } from "react";
import { Topline, ProductCell, Badge, StockBadge, usePaged, SearchField } from "./StockRoomUi";
import { formatUnits, TYPE_LABELS } from "./stockRoomModel";
import { SizeChips } from "./StockScreen";

const UNASSIGNED = "__unassigned__";

export default function WarehousesScreen({ view, warehouses, openProduct }) {
  const [selected, setSelected] = useState(UNASSIGNED);
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();

  const legacyTotals = useMemo(() => {
    const t = {};
    Object.entries(view.legacyByWarehouse).forEach(([wid, list]) => {
      t[wid] = {
        units: list.reduce((a, ws) => a + (Number(ws.quantity) || 0), 0),
        designs: new Set(list.map((ws) => ws.product_id)).size,
      };
    });
    return t;
  }, [view.legacyByWarehouse]);

  const unassignedRows = useMemo(() => view.tracked
    .filter((r) => !r.stock.unlimited && r.stock.total > 0)
    .filter((r) => !q || [r.product.name, r.product.sku_id].some((v) => String(v || "").toLowerCase().includes(q))),
  [view.tracked, q]);

  const legacyRows = useMemo(() => {
    if (selected === UNASSIGNED) return [];
    return (view.legacyByWarehouse[selected] || [])
      .map((ws) => ({ ws, product: view.productsById[ws.product_id] }))
      .filter((x) => x.product)
      .filter((x) => !q || [x.product.name, x.product.sku_id].some((v) => String(v || "").toLowerCase().includes(q)))
      .sort((a, b) => String(a.product.name).localeCompare(String(b.product.name)));
  }, [selected, view.legacyByWarehouse, view.productsById, q]);

  const [visibleUnassigned, moreUnassigned] = usePaged(unassignedRows, 50, `${selected}|${q}`);
  const [visibleLegacy, moreLegacy] = usePaged(legacyRows, 50, `${selected}|${q}`);

  const current = warehouses.find((w) => w.id === selected);

  return (
    <>
      <Topline title="Warehouses"
        sub={`${warehouses.length} active warehouses · ${formatUnits(view.totals.trackedUnits)} tracked units not yet placed`}>
        <SearchField value={search} onChange={setSearch} placeholder="Design or SKU" label="Search this location" />
      </Topline>
      <div className="sr-body">
        <div className="sr-grid k4">
          <button type="button" className="sr-wh-card" aria-pressed={selected === UNASSIGNED} onClick={() => setSelected(UNASSIGNED)}>
            <span className="sr-wh-top"><span className="sr-wh-name">Unassigned</span><Badge tone="low">To place</Badge></span>
            <span className="sr-wh-v">{formatUnits(view.totals.trackedUnits)}</span>
            <span className="sr-wh-meta">units across {formatUnits(unassignedRows.length)} designs</span>
          </button>
          {warehouses.map((w) => (
            <button type="button" key={w.id} className="sr-wh-card" aria-pressed={selected === w.id} onClick={() => setSelected(w.id)}>
              <span className="sr-wh-top"><span className="sr-wh-name">{w.name}</span></span>
              <span className="sr-wh-v">0</span>
              <span className="sr-wh-meta">
                {w.location ? `${w.location} · ` : ""}
                {legacyTotals[w.id] ? `${formatUnits(legacyTotals[w.id].units)} units in the Warehouses tab` : "no placed stock"}
              </span>
            </button>
          ))}
        </div>

        {selected === UNASSIGNED ? (
          <div className="sr-card">
            <div className="sr-card-head"><h2>Unassigned stock</h2><Badge tone="low">{formatUnits(view.totals.trackedUnits)} units</Badge></div>
            <p className="sr-card-sub">
              Tracked units with no location yet. The current system records stock per size or per design, but never
              which warehouse holds each size — so every unit starts here until it is placed.
            </p>
            <div className="sr-scroller">
              <table className="sr-table sr-rtable" style={{ "--sr-table-min": "900px" }}>
                <thead><tr><th>Design</th><th>Type</th><th>Sizes</th><th className="n">Units</th><th>Status</th></tr></thead>
                <tbody>
                  {visibleUnassigned.map((r) => (
                    <tr key={r.id} className="is-link" onClick={() => openProduct(r.id)}>
                      <td className="is-primary"><ProductCell product={r.product} /></td>
                      <td data-label="Type">{TYPE_LABELS[r.type]}</td>
                      <td data-label="Sizes" className="wrap is-wide"><SizeChips stock={r.stock} /></td>
                      <td data-label="Units" className="n tot">{formatUnits(r.stock.total)}</td>
                      <td data-label="Status"><StockBadge status={r.status} /></td>
                    </tr>
                  ))}
                  {!unassignedRows.length && <tr><td colSpan={5} className="sr-empty">{q ? "Nothing matches that search." : "No tracked units on hand."}</td></tr>}
                </tbody>
              </table>
            </div>
            {moreUnassigned}
          </div>
        ) : (
          <div className="sr-card">
            <div className="sr-card-head">
              <h2>{current?.name || "Warehouse"}</h2>
              <Badge tone="plain">{current?.location || "No address"}</Badge>
            </div>
            <p className="sr-card-sub">
              Nothing has been placed here by size yet. Below is what the current Warehouses tab records for this
              warehouse — one quantity per design, without sizes. It is shown for reference when placing stock.
            </p>
            <div className="sr-scroller">
              <table className="sr-table sr-rtable">
                <thead><tr><th>Design</th><th>Type</th><th className="n">Recorded here</th><th className="n">Total stock</th></tr></thead>
                <tbody>
                  {visibleLegacy.map(({ ws, product }) => {
                    const row = view.rowsById[product.id];
                    return (
                      <tr key={ws.id} className="is-link" onClick={() => openProduct(product.id)}>
                        <td className="is-primary"><ProductCell product={product} /></td>
                        <td data-label="Type">{row ? TYPE_LABELS[row.type] : "—"}</td>
                        <td data-label="Recorded here" className="n tot">{formatUnits(ws.quantity)}</td>
                        <td data-label="Total stock" className="n">{row?.stock.tracked && !row.stock.unlimited ? formatUnits(row.stock.total) : "—"}</td>
                      </tr>
                    );
                  })}
                  {!legacyRows.length && (
                    <tr><td colSpan={4} className="sr-empty">{q ? "Nothing matches that search." : "The Warehouses tab has no stock recorded for this warehouse."}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {moreLegacy}
          </div>
        )}
      </div>
    </>
  );
}
