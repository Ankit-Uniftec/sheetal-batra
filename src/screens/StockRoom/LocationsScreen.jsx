import React, { useMemo, useState } from "react";
import {
  Topline, ProductCell, Badge, SearchField, Icon, usePaged, FormModal,
} from "./StockRoomUi";
import { PField, FieldRow, Combo } from "./ProductFormUi";
import { formatUnits, formatDay, sizeLabel, sortSizes, orderPrefix, TYPE_CUSTOM, TYPE_LABELS } from "./stockRoomModel";
import { saveLocation, newRequestId } from "./stockRoomData";
import { SizeChips, QtyChips } from "./StockScreen";
import WarehousesScreen from "./WarehousesScreen";

const UNASSIGNED = "__unassigned__";
const TRANSIT = "__transit__";

export function LocationForm({ location, existingNames = [], onClose, onDone }) {
  const [requestId] = useState(newRequestId);
  const [name, setName] = useState(location?.name || "");
  const [kind, setKind] = useState(location?.kind || "warehouse");
  const [city, setCity] = useState(location?.city || "");
  const [prefixes, setPrefixes] = useState((location?.order_prefixes || []).join(", "));
  const [sortOrder, setSortOrder] = useState(String(location?.sort_order ?? 100));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const save = async (isActive) => {
    if (!name.trim()) { setError("Give the location a name."); return; }
    if (!location && existingNames.includes(name.trim().toLowerCase())) { setError(`A location called “${name.trim()}” already exists.`); return; }
    setSubmitting(true);
    setError("");
    try {
      await saveLocation({
        requestId: isActive === false ? newRequestId() : requestId,
        id: location?.id, name, kind, city,
        orderPrefixes: prefixes.split(/[,\s]+/).map((p) => p.trim()).filter(Boolean),
        isActive: isActive !== false, sortOrder,
      });
      onDone({ text: isActive === false ? `${name.trim()} closed.` : location ? `${name.trim()} saved.` : `${name.trim()} added.`, tone: "ok" });
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  const takenName = !location && name.trim() && existingNames.includes(name.trim().toLowerCase());
  return (
    <FormModal title={location ? `Edit ${location.name}` : "New Location"} submitInHead
      sub={location ? "Stores are where orders are placed; warehouses hold stock transferred from the stores." : "A store or storage location. Transfer stock in once it exists."}
      onClose={onClose} onSubmit={() => save(true)} submitLabel={location ? "Save Location" : "Create Location"}
      submitting={submitting} error={error} width={560}>
      <PField label="Location Name" htmlFor="lf-name" help={takenName ? `A location called “${name.trim()}” already exists.` : null} helpTone={takenName ? "crit" : undefined}>
        <input id="lf-name" className="sr-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mumbai" autoFocus />
      </PField>
      <FieldRow>
        <PField label="Type" htmlFor="lf-kind">
          <Combo id="lf-kind" value={kind} onChange={setKind}
            options={[{ value: "store", label: "Store — orders are placed here" }, { value: "warehouse", label: "Warehouse — holds transferred stock" }]} />
        </PField>
        <PField label="City" htmlFor="lf-city">
          <input id="lf-city" className="sr-input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. New Delhi" />
        </PField>
      </FieldRow>
      {kind === "store" && (
        <PField label="Order Number Codes" htmlFor="lf-prefix" help="The code in this store's order numbers, e.g. DLC for SB-DLC-…. Used to suggest where a sale came from.">
          <input id="lf-prefix" className="sr-input" value={prefixes} onChange={(e) => setPrefixes(e.target.value)} placeholder="DLC" />
        </PField>
      )}
      <PField label="Order In Lists" htmlFor="lf-sort" help="Lower numbers are listed first.">
        <input id="lf-sort" className="sr-input is-num" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
      </PField>
      {location && (
        <div className="sr-stock-hint" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span>Closing hides this location from every list. It must hold no stock.</span>
          <button type="button" className="sr-rowbtn" onClick={() => save(false)} disabled={submitting}>Close Location</button>
        </div>
      )}
    </FormModal>
  );
}

export default function LocationsScreen({ view, warehouses, openProduct, openAction, canWrite, onEditLocation, openReceiveTransfer, go }) {
  const ledger = view.ledger;
  const [selected, setSelected] = useState(UNASSIGNED);
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();

  const matches = (r) => !q || [r.product.name, r.product.sku_id].some((v) => String(v || "").toLowerCase().includes(q));

  const unassignedRows = useMemo(() => {
    if (!ledger?.installed) return [];
    return view.tracked.filter((r) => (ledger.placementById[r.id]?.unassigned || 0) > 0).filter(matches);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.tracked, ledger, q]);

  const locationRows = useMemo(() => {
    if (!ledger?.installed || selected === UNASSIGNED) return [];
    const products = ledger.index.byLocation[selected] || {};
    return Object.entries(products)
      .map(([pid, bySize]) => ({ row: view.rowsById[pid], bySize, units: Object.values(bySize).reduce((a, n) => a + n, 0) }))
      .filter((x) => x.row && x.units > 0 && matches(x.row))
      .sort((a, b) => String(a.row.product.name).localeCompare(String(b.row.product.name)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger, selected, view.rowsById, q]);

  const [visibleUnassigned, moreUnassigned] = usePaged(unassignedRows, 50, `${selected}|${q}`);
  const [visibleHere, moreHere] = usePaged(locationRows, 50, `${selected}|${q}`);
  const [visibleAssign, moreAssign] = usePaged(ledger?.toAssign || [], 10, "assign");

  // Location tracking not set up on this database: keep today's view.
  if (!ledger?.installed) {
    return (
      <>
        {ledger?.ready && (
          <div style={{ padding: "16px 26px 0" }}>
            <p className="sr-callout is-info" style={{ margin: 0 }}>
              <Icon name="alert" width={1.8} />
              <span>Location tracking isn't set up on this database yet, so this shows the current Warehouses tab records.</span>
            </p>
          </div>
        )}
        <WarehousesScreen view={view} warehouses={warehouses} openProduct={openProduct} />
      </>
    );
  }

  const location = ledger.locationsById[selected];
  const stores = ledger.locations.filter((l) => l.kind === "store");
  const others = ledger.locations.filter((l) => l.kind !== "store");
  const openTransfers = ledger.transfers.filter((t) => t.status === "transit");
  const legacy = location?.warehouse_id ? (view.legacyByWarehouse[location.warehouse_id] || []) : [];

  const card = (l) => {
    const s = ledger.locationStats[l.id] || { units: 0, designs: 0 };
    return (
      <button type="button" key={l.id} className="sr-wh-card" aria-pressed={selected === l.id} onClick={() => setSelected(l.id)}>
        <span className="sr-wh-top"><span className="sr-wh-name">{l.name}</span><Badge tone={l.kind === "store" ? "gold" : "plain"}>{l.kind === "store" ? "Store" : "Warehouse"}</Badge></span>
        <span className="sr-wh-v">{formatUnits(s.units)}</span>
        <span className="sr-wh-meta">{s.designs ? `${formatUnits(s.designs)} design${s.designs === 1 ? "" : "s"}` : "No stock placed"}{l.city ? ` · ${l.city}` : ""}</span>
      </button>
    );
  };

  return (
    <>
      <Topline title="Locations"
        sub={`${stores.length} stores · ${others.length} warehouses · ${formatUnits(ledger.totals.placedUnits - ledger.totals.inTransitUnits)} units placed${ledger.totals.inTransitUnits ? ` · ${formatUnits(ledger.totals.inTransitUnits)} in transit` : ""} · ${formatUnits(ledger.totals.unassignedUnits)} unassigned`}>
        <SearchField value={search} onChange={setSearch} placeholder="Design or SKU" label="Search this location" />
        {canWrite && (
          <>
            <button type="button" className="sr-btn" onClick={() => openAction("transfer", { fromId: location?.id })}><Icon name="transfer" width={1.7} />Transfer</button>
            <button type="button" className="sr-btn" onClick={() => onEditLocation(null)}>+ Add location</button>
          </>
        )}
      </Topline>
      <div className="sr-body">
        {ledger.toAssign.length > 0 && (
          <div className="sr-card" style={{ marginBottom: 16, borderColor: "var(--sr-gold-line)" }}>
            <div className="sr-card-head">
              <h2>Sales waiting for a location</h2>
              <Badge tone="low">{formatUnits(ledger.totals.toAssignUnits)} unit{ledger.totals.toAssignUnits === 1 ? "" : "s"}</Badge>
            </div>
            <p className="sr-card-sub">
              These were sold through the order form or the website, so the stock count already went down — but the units are still
              recorded at a location. Choose where each one left from.
            </p>
            <div className="sr-scroller">
              <table className="sr-table sr-rtable" style={{ "--sr-table-min": "860px" }}>
                <thead><tr><th>Design</th><th>Size</th><th className="n">Waiting</th><th>Latest matching order</th><th>Suggested</th><th /></tr></thead>
                <tbody>
                  {visibleAssign.map((t) => {
                    const c = t.candidates[0];
                    const suggested = c?.suggestedLocationId && ledger.locationsById[c.suggestedLocationId];
                    const holdsSuggested = suggested && (t.row.type === TYPE_CUSTOM
                      ? Object.values(ledger.index.byLocation[suggested.id]?.[t.row.id] || {}).some((n) => n > 0)
                      : (ledger.index.byLocation[suggested.id]?.[t.row.id]?.[t.size] || 0) > 0);
                    return (
                      <tr key={`${t.row.id}|${t.size}`}>
                        <td className="is-primary"><ProductCell product={t.row.product} /></td>
                        <td data-label="Size">{t.size ? sizeLabel(t.size) : TYPE_LABELS[t.row.type]}</td>
                        <td data-label="Waiting" className="n tot">{formatUnits(t.qty)}</td>
                        <td data-label="Latest matching order">{c ? <>{c.order.order_no}<span className="sr-muted"> · {formatDay(c.order.created_at)}</span></> : <span className="sr-muted">No recent order found</span>}</td>
                        <td data-label="Suggested">{suggested ? `${suggested.name}${holdsSuggested ? "" : " (holds none)"}` : c ? <span className="sr-muted">{orderPrefix(c.order.order_no) || "—"} · choose</span> : "—"}</td>
                        <td>
                          {canWrite && (
                            <button type="button" className="sr-rowbtn" onClick={() => openAction("assign", {
                              lines: [{ productId: t.row.id, size: t.size, qty: Math.min(t.qty, c?.qty || t.qty) }],
                              locationId: holdsSuggested ? suggested.id : "",
                              candidateKey: c ? `${c.order.id}|${c.line}` : "",
                            })}>Assign</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {moreAssign}
          </div>
        )}

        <div className="sr-grid k4">
          <button type="button" className="sr-wh-card" aria-pressed={selected === UNASSIGNED} onClick={() => setSelected(UNASSIGNED)}>
            <span className="sr-wh-top"><span className="sr-wh-name">Unassigned</span><Badge tone="low">To place</Badge></span>
            <span className="sr-wh-v">{formatUnits(ledger.totals.unassignedUnits)}</span>
            <span className="sr-wh-meta">units not yet in a location</span>
          </button>
          {stores.map(card)}
        </div>
        {(others.length > 0 || openTransfers.length > 0) && (
          <div className="sr-grid k4">
            {others.map(card)}
            {ledger.transitId && (
              <button type="button" className="sr-wh-card" aria-pressed={selected === TRANSIT} onClick={() => setSelected(TRANSIT)}>
                <span className="sr-wh-top"><span className="sr-wh-name">In transit</span><Badge tone={openTransfers.length ? "low" : "plain"}>On the way</Badge></span>
                <span className="sr-wh-v">{formatUnits(ledger.totals.inTransitUnits)}</span>
                <span className="sr-wh-meta">{openTransfers.length ? `${openTransfers.length} transfer${openTransfers.length === 1 ? "" : "s"} to receive` : "Nothing on the way"}</span>
              </button>
            )}
          </div>
        )}
        {selected === TRANSIT ? (
          <div className="sr-card">
            <div className="sr-card-head">
              <h2>In transit</h2>
              <button type="button" className="sr-btn" onClick={() => go("transfers", { status: "transit" })}>All transfers</button>
            </div>
            <p className="sr-card-sub">Units sent from one location and not yet received at the other. They count towards neither until received.</p>
            <div className="sr-scroller">
              <table className="sr-table sr-rtable" style={{ "--sr-table-min": "820px" }}>
                <thead><tr><th>Route</th><th>Sent</th><th>Designs</th><th className="n">Units</th><th /></tr></thead>
                <tbody>
                  {openTransfers.map((t) => (
                    <tr key={t.id}>
                      <td className="is-primary">{ledger.locationsById[t.from]?.name || "Closed location"} → {ledger.locationsById[t.to]?.name || "Closed location"}</td>
                      <td data-label="Sent">{formatDay(t.occurred_at)}</td>
                      <td data-label="Designs" className="wrap">
                        {t.lines.map((l) => `${view.productsById[l.product_id]?.name || "Product"}${l.size ? ` (${sizeLabel(l.size)})` : ""} × ${l.qty}`).join(", ")}
                      </td>
                      <td data-label="Units" className="n tot">{formatUnits(t.units)}</td>
                      <td>{canWrite && <button type="button" className="sr-rowbtn" onClick={() => openReceiveTransfer(t)}>Receive</button>}</td>
                    </tr>
                  ))}
                  {!openTransfers.length && <tr><td colSpan={5} className="sr-empty">Nothing is in transit.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        ) : selected === UNASSIGNED || !location ? (
          <div className="sr-card">
            <div className="sr-card-head">
              <h2>Unassigned stock</h2>
              {canWrite && ledger.totals.unassignedUnits > 0 && (
                <button type="button" className="sr-btn sr-btn-primary" onClick={() => openAction("place")}>Place stock</button>
              )}
            </div>
            <p className="sr-card-sub">Units counted in the stock records that no location holds yet. Place them where they physically are.</p>
            <div className="sr-scroller">
              <table className="sr-table sr-rtable" style={{ "--sr-table-min": "820px" }}>
                <thead><tr><th>Design</th><th>Type</th><th>Unassigned</th><th className="n">Units</th><th /></tr></thead>
                <tbody>
                  {visibleUnassigned.map((r) => {
                    const p = ledger.placementById[r.id];
                    return (
                      <tr key={r.id} className="is-link" onClick={() => openProduct(r.id)}>
                        <td className="is-primary"><ProductCell product={r.product} /></td>
                        <td data-label="Type">{TYPE_LABELS[r.type]}</td>
                        <td data-label="Unassigned" className="is-wide">
                          {r.type === TYPE_CUSTOM ? <SizeChips stock={r.stock} compact /> : <QtyChips bySize={p.unassignedBySize} />}
                        </td>
                        <td data-label="Units" className="n tot">{formatUnits(p.unassigned)}</td>
                        <td>
                          {canWrite && (
                            <button type="button" className="sr-rowbtn" onClick={(e) => {
                              e.stopPropagation();
                              const size = r.type === TYPE_CUSTOM ? (r.stock.sizes[0] || "") : Object.keys(p.unassignedBySize)[0];
                              openAction("place", { lines: [{ productId: r.id, size, qty: 1 }] });
                            }}>Place</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!unassignedRows.length && <tr><td colSpan={5} className="sr-empty">{q ? "Nothing matches that search." : "Every unit is in a location."}</td></tr>}
                </tbody>
              </table>
            </div>
            {moreUnassigned}
          </div>
        ) : (
          <div className="sr-card">
            <div className="sr-card-head">
              <div>
                <h2>{location.name}</h2>
                <span className="sr-sub">
                  {location.kind === "store" ? "Store" : "Warehouse"}{location.city ? ` · ${location.city}` : ""}
                  {location.order_prefixes?.length ? ` · orders ${location.order_prefixes.join(", ")}` : ""}
                </span>
              </div>
              {canWrite && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="sr-btn" onClick={() => openAction("place", { locationId: location.id })}>Place here</button>
                  <button type="button" className="sr-btn" onClick={() => openAction("receive", { locationId: location.id })}>Receive</button>
                  <button type="button" className="sr-btn" onClick={() => openAction("sell", { locationId: location.id })}>Mark sold</button>
                  <button type="button" className="sr-btn" onClick={() => openAction("transfer", { fromId: location.id })}>Transfer out</button>
                  <button type="button" className="sr-btn" onClick={() => onEditLocation(location)}>Edit</button>
                </div>
              )}
            </div>
            <p className="sr-card-sub" style={{ marginTop: 8 }}>
              {formatUnits(ledger.locationStats[location.id]?.units || 0)} units across {formatUnits(locationRows.length)} designs, size by size.
            </p>
            <div className="sr-scroller">
              <table className="sr-table sr-rtable" style={{ "--sr-table-min": "820px" }}>
                <thead><tr><th>Design</th><th>Sizes here</th><th className="n">Units</th><th /></tr></thead>
                <tbody>
                  {visibleHere.map(({ row, bySize, units }) => {
                    const firstSize = sortSizes(Object.keys(bySize).filter((s) => bySize[s] > 0))[0] ?? "";
                    return (
                      <tr key={row.id} className="is-link" onClick={() => openProduct(row.id)}>
                        <td className="is-primary"><ProductCell product={row.product} /></td>
                        <td data-label="Sizes here" className="is-wide"><QtyChips bySize={bySize} /></td>
                        <td data-label="Units" className="n tot">{formatUnits(units)}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {canWrite && (
                            <span style={{ whiteSpace: "nowrap" }}>
                              <button type="button" className="sr-rowbtn" onClick={() => openAction("sell", { locationId: location.id, lines: [{ productId: row.id, size: firstSize, qty: 1 }] })}>Sell</button>
                              <button type="button" className="sr-rowbtn" onClick={() => openAction("transfer", { fromId: location.id, lines: [{ productId: row.id, size: firstSize, qty: 1 }] })}>Move</button>
                              <button type="button" className="sr-rowbtn" onClick={() => openAction("adjust", { locationId: location.id, lines: [{ productId: row.id, size: firstSize }], counted: bySize[firstSize] })}>Recount</button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!locationRows.length && <tr><td colSpan={4} className="sr-empty">{q ? "Nothing matches that search." : "Nothing is placed here yet."}</td></tr>}
                </tbody>
              </table>
            </div>
            {moreHere}
            {legacy.length > 0 && (
              <details style={{ marginTop: 16 }}>
                <summary className="sr-linkbtn" style={{ cursor: "pointer" }}>
                  The old Warehouses tab records {formatUnits(legacy.reduce((a, ws) => a + (Number(ws.quantity) || 0), 0))} units here, without sizes
                </summary>
                <p className="sr-note">For reference while placing stock. These records aren't used by the Stock Room.</p>
                <table className="sr-table" style={{ "--sr-table-min": "0px", marginTop: 8 }}>
                  <tbody>
                    {legacy.map((ws) => (
                      <tr key={ws.id}><td>{view.productsById[ws.product_id]?.name || "Product"}</td><td className="n">{formatUnits(ws.quantity)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </div>
        )}
      </div>
    </>
  );
}
