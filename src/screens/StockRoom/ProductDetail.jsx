import React, { useMemo, useState } from "react";
import { Modal, StockBadge, Badge, Icon, Seg } from "./StockRoomUi";
import {
  formatUnits, formatInr, formatDay, sizeLabel, sortSizes, canonicalSize, productFacts, SIZE_SCALE,
  REASON_LABELS, TYPE_LABELS, TYPE_LXRTS, TYPE_CUSTOM,
} from "./stockRoomModel";

const plural = (n, word) => `${formatUnits(n)} ${word}${Number(n) === 1 ? "" : "s"}`;
const listText = (v) => (Array.isArray(v) ? v.filter(Boolean).join(", ") : String(v || "").trim());

const MEASURES = [
  { value: "onhand", label: "On hand" },
  { value: "sold", label: "Sold" },
  { value: "moves", label: "Movements" },
];
const AXES = [
  { value: "location", label: "Rows: location" },
  { value: "size", label: "Rows: size" },
];

// Sizes in garment order; places in a fixed order with the non-locations last.
const TAIL = ["In transit", "Unassigned", "Not assigned", "Closed location"];
const sizeRank = (label) => { const i = SIZE_SCALE.indexOf(canonicalSize(label)); return i >= 0 ? i : label === "Custom" ? 50 : 60; };

/** A small pivot over productFacts rows: one axis down, the other across, totals on both. */
function FactsPivot({ facts, rowsBy, locationOrder }) {
  const colsBy = rowsBy === "location" ? "size" : "location";
  const order = (key) => (a, b) => (key === "size"
    ? sizeRank(a) - sizeRank(b) || a.localeCompare(b)
    : (locationOrder(a) - locationOrder(b)) || a.localeCompare(b));
  const rows = [...new Set(facts.map((f) => f[rowsBy]))].sort(order(rowsBy));
  const cols = [...new Set(facts.map((f) => f[colsBy]))].sort(order(colsBy));
  const cell = {};
  facts.forEach((f) => { const k = `${f[rowsBy]}|${f[colsBy]}`; cell[k] = (cell[k] || 0) + f.value; });
  const rowTotal = (r) => cols.reduce((a, c) => a + (cell[`${r}|${c}`] || 0), 0);
  const colTotal = (c) => rows.reduce((a, r) => a + (cell[`${r}|${c}`] || 0), 0);
  if (!rows.length) return <p className="sr-empty">Nothing recorded for this design yet.</p>;
  return (
    <div className="sr-scroller" style={{ marginBottom: 20 }}>
      <table className="sr-table sr-matrix" style={{ "--sr-table-min": "0px" }}>
        <thead><tr><th>{rowsBy === "location" ? "Location" : "Size"}</th>{cols.map((c) => <th key={c} className="c">{c}</th>)}<th className="n">Total</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <td>{r}</td>
              {cols.map((c) => { const n = cell[`${r}|${c}`] || 0; return <td key={c} className={`c ${n ? "sr-cell-has" : "sr-cell-none"}`}>{n ? formatUnits(n) : "–"}</td>; })}
              <td className="n tot">{formatUnits(rowTotal(r))}</td>
            </tr>
          ))}
          <tr className="sr-total">
            <td>Total</td>
            {cols.map((c) => <td key={c} className="c">{formatUnits(colTotal(c))}</td>)}
            <td className="n">{formatUnits(rows.reduce((a, r) => a + rowTotal(r), 0))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function ProductDetail({ row, view, warehousesById, salesDays = 90, onClose, openAction, canWrite, canEditProducts, openEditor }) {
  const p = row.product;
  const ledger = view.ledger;
  const salesBySize = useMemo(() => (view.sales && view.sales.byProduct[row.id] ? view.sales.byProduct[row.id].bySize : {}), [view.sales, row.id]);
  const legacy = view.legacyByProduct[row.id] || [];
  const counted = row.stock.tracked && !row.stock.unlimited;
  const placement = ledger?.installed ? ledger.placementById[row.id] : null;
  const collections = (ledger?.collectionsByProduct?.[row.id] || []).map((id) => ledger.collectionsById[id]).filter(Boolean);
  const movements = ledger?.installed ? ledger.movements.filter((m) => m.product_id === row.id).slice(0, 12) : [];
  const product = { productId: row.id };
  const [measure, setMeasure] = useState("onhand");
  const [rowsBy, setRowsBy] = useState("location");
  const [now] = useState(() => Date.now());

  const inTransitBySize = placement && ledger.transitId ? placement.byLocation[ledger.transitId] || {} : {};
  const inTransitUnits = Object.values(inTransitBySize).reduce((a, n) => a + n, 0);

  // Sizes held somewhere (records for LXRTS, any location for a custom piece) out of the sizes offered.
  const offered = new Set(row.stock.sizes.map(sizeLabel));
  const held = new Set(row.stock.bySize
    ? Object.entries(row.stock.bySize).filter(([s, n]) => n > 0 && !row.stock.invalidSizes.includes(s)).map(([s]) => sizeLabel(s))
    : placement ? Object.values(placement.byLocation).flatMap((bySize) => Object.entries(bySize).filter(([, n]) => n > 0).map(([s]) => sizeLabel(s))) : []);

  const variants = useMemo(() => {
    const bySize = {};
    (view.variantsByProduct?.[row.id] || []).forEach((v) => { (bySize[v.size] || (bySize[v.size] = [])).push(v); });
    return sortSizes(Object.keys(bySize)).map((s) => ({ size: s, rows: bySize[s] }));
  }, [view.variantsByProduct, row.id]);

  const facts = useMemo(() => (placement ? productFacts({
    row, placement, locationsById: ledger.locationsById, transitId: ledger.transitId,
    orderSalesBySize: salesBySize, movements: ledger.movements, measure, days: salesDays, now,
  }) : []), [row, placement, ledger, salesBySize, measure, salesDays, now]);

  const locationOrder = (name) => {
    const t = TAIL.indexOf(name);
    if (t >= 0) return 1000 + t;
    const i = (ledger?.locations || []).findIndex((l) => l.name === name);
    return i >= 0 ? i : 999;
  };

  const garment = [
    ["Store listing", (p.store_category || "").trim() || "All Stores"],
    ["Tops", listText(p.top_options)],
    ["Default top", p.default_top],
    ["Bottoms", listText(p.bottom_options)],
    ["Default bottom", p.default_bottom],
    ["Colour", p.default_color],
    ["Dupatta", p.has_dupatta ? (p.default_dupatta_color ? `Yes · ${p.default_dupatta_color}` : "Yes") : "No"],
  ].filter(([, v]) => v);

  const meta = (
    <>
      <span>{p.sku_id || "No SKU"}</span>
      <Badge tone="plain">{TYPE_LABELS[row.type]}</Badge>
      <Badge tone="plain">{(p.store_category || "").trim() || "All Stores"}</Badge>
      <StockBadge status={row.status} />
      {row.type === TYPE_LXRTS && <span className="sr-mono">{p.shopify_product_id || "No Shopify ID"}</span>}
      {collections.map((c) => <Badge key={c.id} tone="gold">{c.name}</Badge>)}
    </>
  );

  // Locations holding any of this design.
  const locationRows = placement
    ? ledger.locations.map((l) => ({ l, bySize: placement.byLocation[l.id] || {} }))
      .filter((x) => Object.values(x.bySize).some((n) => n > 0))
    : [];

  const sizes = row.stock.bySize
    ? row.stock.sizes
    : sortSizes([...row.stock.sizes, ...locationRows.flatMap((x) => Object.keys(x.bySize))]);
  const sizeHead = (s) => (s ? sizeLabel(s) : "One size");

  const cell = (n) => <td className={`c ${n ? "sr-cell-has" : "sr-cell-none"}`}>{n ? formatUnits(n) : "–"}</td>;

  return (
    <Modal title={p.name} meta={meta} thumb={p.image_url} onClose={onClose}>
      {(canEditProducts || (canWrite && counted)) && (
        <div className="sr-detail-actions">
          {canWrite && counted && (
            <>
              <button type="button" className="sr-btn sr-btn-primary" onClick={() => openAction("receive", { lines: [{ ...product, size: sizes[0] || "", qty: 1 }] })}><Icon name="plus" width={2} />Receive</button>
              {placement?.unassigned > 0 && (
                <button type="button" className="sr-btn" onClick={() => openAction("place", {
                  lines: [{ ...product, size: row.type === TYPE_CUSTOM ? (row.stock.sizes[0] || "") : (sortSizes(Object.keys(placement.unassignedBySize))[0] || ""), qty: 1 }],
                })}>Place</button>
              )}
              {locationRows.length > 0 && (
                <>
                  <button type="button" className="sr-btn" onClick={() => openAction("transfer", { fromId: locationRows[0].l.id, lines: [{ ...product, size: sortSizes(Object.keys(locationRows[0].bySize))[0], qty: 1 }] })}>Transfer</button>
                  <button type="button" className="sr-btn" onClick={() => openAction("sell", { locationId: locationRows[0].l.id, lines: [{ ...product, size: sortSizes(Object.keys(locationRows[0].bySize))[0], qty: 1 }] })}>Mark sold</button>
                </>
              )}
              <button type="button" className="sr-btn" onClick={() => openAction("adjust", { locationId: "", lines: [{ ...product, size: row.type === TYPE_CUSTOM ? "" : (row.stock.sizes.find((s) => !row.stock.invalidSizes.includes(s)) || "") }] })}>Recount</button>
            </>
          )}
          {canEditProducts && (
            <button type="button" className="sr-btn" onClick={() => openEditor(row.id)}><Icon name="edit" width={1.7} />Edit product</button>
          )}
        </div>
      )}

      <div className="sr-mk">
        <div className="sr-mk-item"><span className="sr-label">On hand</span><span className="sr-mk-v">{!row.stock.tracked ? "Not tracked" : row.stock.unlimited ? "Unlimited" : formatUnits(row.stock.total)}</span></div>
        <div className="sr-mk-item"><span className="sr-label">Sold, 90 days</span><span className="sr-mk-v">{formatUnits(row.sold90)}</span></div>
        <div className="sr-mk-item">
          <span className="sr-label">Sizes held</span>
          <span className="sr-mk-v">{counted && offered.size ? `${held.size} of ${offered.size}` : "—"}</span>
        </div>
        <div className="sr-mk-item">
          <span className="sr-label">Stock value</span>
          <span className="sr-mk-v">{counted ? formatInr(row.value) : "—"}</span>
          {row.price > 0 && <span className="sr-muted" style={{ fontSize: 12 }}>{formatInr(row.price)} each</span>}
        </div>
      </div>

      {placement?.toAssign > 0 && (
        <p className="sr-callout is-warn">
          <Icon name="alert" width={1.8} />
          <span style={{ flex: 1 }}>
            {plural(placement.toAssign, "unit")} sold through the order form or website still {placement.toAssign === 1 ? "sits" : "sit"} in a location. Say which one {placement.toAssign === 1 ? "it" : "they"} left from.
          </span>
          {canWrite && (
            <button type="button" className="sr-btn" onClick={() => openAction("assign", {
              lines: [{ ...product, size: row.type === TYPE_CUSTOM ? "" : (sortSizes(Object.keys(placement.toAssignBySize))[0] || ""), qty: 1 }],
            })}>Assign</button>
          )}
        </p>
      )}

      {counted && (
        <>
          <div className="sr-section-head"><h3>{placement ? "Where it is" : row.stock.bySize ? "By size" : "Sizes"}</h3></div>
          <p className="sr-card-sub">
            {row.type === TYPE_CUSTOM
              ? "A custom piece has one stock count for the whole design; locations record which sizes they hold."
              : "Totals are the size stock records the order form reads."}
            {row.stock.invalidSizes.length > 0 && ` Size ${row.stock.invalidSizes.join(", ")} holds an impossible count and is left out — check it in Shopify and correct it.`}
          </p>
          {sizes.length > 0 && (
            <div className="sr-scroller" style={{ marginBottom: 20 }}>
              <table className="sr-table sr-matrix" style={{ "--sr-table-min": "0px" }}>
                <thead><tr><th>{placement ? "Location" : "Stock"}</th>{sizes.map((s) => <th key={s || "one"} className="c">{sizeHead(s)}</th>)}<th className="n">Units</th></tr></thead>
                <tbody>
                  {locationRows.map(({ l, bySize }) => (
                    <tr key={l.id}>
                      <td>{l.name}<span className="sr-muted"> · {l.kind === "store" ? "store" : "warehouse"}</span></td>
                      {sizes.map((s) => <React.Fragment key={s || "one"}>{cell(bySize[s] || 0)}</React.Fragment>)}
                      <td className="n tot">{formatUnits(Object.values(bySize).reduce((a, n) => a + n, 0))}</td>
                    </tr>
                  ))}
                  {inTransitUnits > 0 && (
                    <tr>
                      <td>In transit<span className="sr-muted"> · not yet received</span></td>
                      {sizes.map((s) => <React.Fragment key={s || "one"}>{cell(inTransitBySize[s] || 0)}</React.Fragment>)}
                      <td className="n tot">{formatUnits(inTransitUnits)}</td>
                    </tr>
                  )}
                  {placement && (
                    <tr>
                      <td>Unassigned</td>
                      {row.type === TYPE_CUSTOM
                        ? <td colSpan={sizes.length} className="c sr-muted">not split by size</td>
                        : sizes.map((s) => <React.Fragment key={s}>{cell(placement.unassignedBySize[s] || 0)}</React.Fragment>)}
                      <td className="n tot">{formatUnits(placement.unassigned)}</td>
                    </tr>
                  )}
                  {placement?.toAssign > 0 && (
                    <tr className="sr-subrow">
                      <td>Sold elsewhere, to assign</td>
                      {row.type === TYPE_CUSTOM
                        ? <td colSpan={sizes.length} />
                        : sizes.map((s) => <React.Fragment key={s}>{cell(placement.toAssignBySize[s] || 0)}</React.Fragment>)}
                      <td className="n">{formatUnits(placement.toAssign)}</td>
                    </tr>
                  )}
                  {row.stock.bySize && (
                    <tr className="sr-total">
                      <td>Stock records</td>
                      {sizes.map((s) => (row.stock.invalidSizes.includes(s)
                        ? <td key={s} className="c sr-cell-invalid" title="Impossible count in the stock record — left out of the total">!</td>
                        : <td key={s} className="c">{formatUnits(row.stock.bySize[s] || 0)}</td>))}
                      <td className="n">{formatUnits(row.stock.total)}</td>
                    </tr>
                  )}
                  <tr className="sr-subrow">
                    <td>Sold in the selected period</td>
                    {sizes.map((s) => <td key={s || "one"} className="c">{salesBySize[s] || "–"}</td>)}
                    <td className="n">{formatUnits(Object.values(salesBySize).reduce((a, n) => a + n, 0))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {placement && counted && (
        <>
          <div className="sr-section-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h3>Explore</h3>
            <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Seg options={MEASURES} value={measure} onChange={setMeasure} label="Measure" />
              <Seg options={AXES} value={rowsBy} onChange={setRowsBy} label="Rows" />
            </span>
          </div>
          <p className="sr-card-sub">
            {measure === "onhand" && "Units by location and size, including stock in transit and not yet placed."}
            {measure === "sold" && `Units sold in the selected period (${salesDays === 365 ? "last year" : `last ${salesDays} days`}). Order form and website sales show under the location they were assigned to, or Not assigned.`}
            {measure === "moves" && "How many stock movements were recorded, by location and size."}
          </p>
          <FactsPivot facts={facts} rowsBy={rowsBy} locationOrder={locationOrder} />
        </>
      )}

      {garment.length > 0 && (
        <>
          <div className="sr-section-head"><h3>Garment</h3></div>
          <dl className="sr-facts">
            {garment.map(([k, v]) => (
              <div key={k}><dt className="sr-label">{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </>
      )}

      {row.type === TYPE_LXRTS && variants.length > 0 && (
        <>
          <div className="sr-section-head"><h3>Sizes and Shopify variants</h3></div>
          <div className="sr-scroller" style={{ marginBottom: 20 }}>
            <table className="sr-table" style={{ "--sr-table-min": "0px" }}>
              <thead><tr><th>Size</th><th>Shopify variant ID</th><th className="n">Stock record</th></tr></thead>
              <tbody>
                {variants.flatMap(({ size, rows: vs }) => vs.map((v, i) => (
                  <tr key={v.id}>
                    <td>{sizeLabel(size)}{vs.length > 1 && <span className="sr-muted"> · copy {i + 1} of {vs.length}</span>}</td>
                    <td className="sr-mono">{v.shopify_variant_id || <span className="sr-muted">None</span>}</td>
                    <td className={`n${row.stock.invalidSizes.includes(size) && !(Number(v.inventory) >= 0 && Number(v.inventory) < 9999) ? " sr-cell-invalid" : ""}`}>{formatUnits(v.inventory)}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!counted && (
        <>
          <div className="sr-section-head"><h3>Sizes</h3></div>
          <p className="sr-card-sub">
            {row.stock.tracked ? "Set to unlimited (9999), so its stock is not counted." : "Made to order: no stock is held, so every size can always be ordered."}
          </p>
          <div className="sr-sizechips">
            {row.stock.sizes.length
              ? row.stock.sizes.map((s) => <span key={s} className="sr-sizechip">{sizeLabel(s)}{salesBySize[s] ? <> · <b>{salesBySize[s]}</b> sold</> : null}</span>)
              : <span className="sr-muted">No sizes listed on this design.</span>}
          </div>
        </>
      )}

      {movements.length > 0 && (
        <>
          <div className="sr-section-head"><h3>Recent movements</h3></div>
          <table className="sr-table" style={{ "--sr-table-min": "0px" }}>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td className="sr-muted">{formatDay(m.occurred_at)}</td>
                  <td>{REASON_LABELS[m.reason] || m.reason}</td>
                  <td>{m.size ? sizeLabel(m.size) : "—"}</td>
                  <td>{m.location_id ? ledger.locationsById[m.location_id]?.name || "Closed location" : "Unassigned"}</td>
                  <td className={`n tot ${m.delta > 0 ? "sr-pos" : "sr-neg"}`}>{m.delta > 0 ? "+" : ""}{m.delta}</td>
                  <td className="wrap sr-muted">{m.ref_id || m.note || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {row.stock.tracked && legacy.length > 0 && (
        <details style={{ marginTop: 18 }}>
          <summary className="sr-linkbtn" style={{ cursor: "pointer" }}>The old Warehouses tab records {plural(legacy.reduce((a, ws) => a + (Number(ws.quantity) || 0), 0), "unit")} of this design, without sizes</summary>
          <table className="sr-table" style={{ "--sr-table-min": "0px", marginTop: 8 }}>
            <tbody>
              {legacy.map((ws) => (
                <tr key={ws.id}><td>{warehousesById[ws.warehouse_id]?.name || "Warehouse"}</td><td className="n">{formatUnits(ws.quantity)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </Modal>
  );
}
