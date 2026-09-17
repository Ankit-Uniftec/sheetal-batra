import React, { useMemo, useState } from "react";
import {
  Topline, SearchField, FilterButton, FilterDrawer, Facet, ActiveFilters, ProductCell, Badge, Icon, usePaged, SearchSelect,
  Seg, FormModal,
} from "./StockRoomUi";
import { PField, StockHint } from "./ProductFormUi";
import { receiveTransfer, newRequestId } from "./stockRoomData";
import { formatUnits, formatDay, sizeLabel, REASON_LABELS } from "./stockRoomModel";
import { buildCsv, downloadCsv } from "../../components/AddProduct/csvHelpers";

const REASON_TONE = {
  placement: "gold", transfer_out: "plain", transfer_in: "plain", sale: "crit",
  sale_assignment: "low", receipt: "ok", adjustment: "info",
};

const SHOPIFY_LABEL = { pending: "Not settled", not_sent: "Not sent", sent: "Sent", failed: "Failed" };

const PERIODS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

const when = (iso) => `${formatDay(iso)} ${new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;

export default function MovementsScreen({ view, openProduct }) {
  const ledger = view.ledger;
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [reason, setReason] = useState("");
  const [locationId, setLocationId] = useState("");
  const [period, setPeriod] = useState("");
  const [now] = useState(() => Date.now());

  const locationName = (id) => (!id ? "Unassigned" : id === ledger.transitId ? "In transit" : ledger.locationsById[id]?.name || "Closed location");
  const q = search.trim().toLowerCase();

  const rows = useMemo(() => ledger.movements.filter((m) => {
    if (reason && m.reason !== reason) return false;
    if (locationId && m.location_id !== locationId) return false;
    if (period && new Date(m.occurred_at).getTime() < now - Number(period) * 86400000) return false;
    if (!q) return true;
    const p = view.productsById[m.product_id];
    return [p?.name, p?.sku_id, m.ref_id, m.note, m.actor_email].some((v) => String(v || "").toLowerCase().includes(q));
  }), [ledger.movements, reason, locationId, period, q, now, view.productsById]);

  const [visible, more] = usePaged(rows, 60, `${reason}|${locationId}|${period}|${q}`);

  const exportCsv = () => {
    const headers = ["when", "sku_id", "design", "size", "location", "change", "stock_count_change", "reason", "reference", "note", "by", "shopify"];
    const data = rows.map((m) => {
      const p = view.productsById[m.product_id];
      return {
        when: m.occurred_at, sku_id: p?.sku_id || "", design: p?.name || m.product_id, size: m.size,
        location: locationName(m.location_id), change: m.delta, stock_count_change: m.legacy_delta,
        reason: REASON_LABELS[m.reason] || m.reason, reference: m.ref_id || "", note: m.note || "",
        by: m.actor_email || "", shopify: SHOPIFY_LABEL[m.shopify_status] || "",
      };
    });
    downloadCsv(`stock-movements-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(headers, data));
  };

  const reasonOptions = Object.entries(REASON_LABELS).map(([value, label]) => ({ value, label }));
  const locationOptions = ledger.locations.map((l) => ({ value: l.id, label: l.name }));
  const activeCount = [reason, locationId, period].filter(Boolean).length;

  return (
    <>
      <Topline title="Movements" sub={`${formatUnits(ledger.movements.length)} recorded changes · newest first`}>
        <SearchField value={search} onChange={setSearch} placeholder="Design, SKU, reference or person" label="Search movements" />
        <FilterButton count={activeCount} onClick={() => setDrawer(true)} />
        <button type="button" className="sr-btn" onClick={exportCsv} disabled={!rows.length}><Icon name="download" width={1.7} />Export CSV</button>
      </Topline>
      <div className="sr-body">
        <ActiveFilters items={[
          { key: "reason", label: "Type", value: reason, display: REASON_LABELS[reason], onClear: () => setReason("") },
          { key: "loc", label: "Location", value: locationId, display: locationName(locationId), onClear: () => setLocationId("") },
          { key: "period", label: "When", value: period, display: PERIODS.find((p) => p.value === period)?.label, onClear: () => setPeriod("") },
        ]} />
        <div style={{ marginBottom: 14, overflowX: "auto" }}>
          <Seg label="Movement type" value={reason} onChange={setReason}
            options={[{ value: "", label: "All" }, ...reasonOptions]} />
        </div>
        <div className="sr-card">
          <p className="sr-card-sub">
            Every stock change made in the Stock Room. Nothing here is ever edited or deleted — a correction is a new row.
            “Stock count” is how much the change moved the existing count the order form reads.
          </p>
          <div className="sr-scroller">
            <table className="sr-table sr-rtable" style={{ "--sr-table-min": "1080px" }}>
              <thead>
                <tr><th>Design</th><th>When</th><th>Type</th><th>Size</th><th>Location</th><th className="n">Change</th><th className="n">Stock count</th><th>Reference</th><th>By</th><th>Shopify</th></tr>
              </thead>
              <tbody>
                {visible.map((m) => {
                  const p = view.productsById[m.product_id];
                  return (
                    <tr key={m.id} className={p ? "is-link" : undefined} onClick={() => p && openProduct(p.id)}>
                      <td className="is-primary">{p ? <ProductCell product={p} /> : <span className="sr-muted">Product no longer live</span>}</td>
                      <td data-label="When">{when(m.occurred_at)}</td>
                      <td data-label="Type"><Badge tone={REASON_TONE[m.reason] || "plain"}>{REASON_LABELS[m.reason] || m.reason}</Badge></td>
                      <td data-label="Size">{m.size ? sizeLabel(m.size) : "—"}</td>
                      <td data-label="Location">{locationName(m.location_id)}</td>
                      <td data-label="Change" className={`n tot ${m.delta > 0 ? "sr-pos" : "sr-neg"}`}>{m.delta > 0 ? "+" : ""}{m.delta}</td>
                      <td data-label="Stock count" className="n">{m.legacy_delta ? `${m.legacy_delta > 0 ? "+" : ""}${m.legacy_delta}` : "—"}</td>
                      <td data-label="Reference" className="wrap" title={m.note || undefined}>{m.ref_id || (m.note ? <span className="sr-muted">{m.note}</span> : "—")}</td>
                      <td data-label="By">{m.actor_email || "—"}</td>
                      <td data-label="Shopify">
                        {m.shopify_status === "not_needed" ? <span className="sr-muted">—</span>
                          : <Badge tone={m.shopify_status === "sent" ? "ok" : m.shopify_status === "failed" ? "crit" : "low"}>{SHOPIFY_LABEL[m.shopify_status]}</Badge>}
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr><td colSpan={10} className="sr-empty">{ledger.movements.length ? "No movements match these filters." : "No stock has been moved yet. Start by placing unassigned stock into its locations."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {more}
        </div>
      </div>
      {drawer && (
        <FilterDrawer sub={`${formatUnits(rows.length)} of ${formatUnits(ledger.movements.length)} movements`} onClose={() => setDrawer(false)}
          onClear={() => { setReason(""); setLocationId(""); setPeriod(""); }}>
          <Facet label="Type" options={reasonOptions} value={reason} onChange={setReason} />
          <Facet label="When" options={PERIODS} value={period} onChange={setPeriod} />
          <div className="sr-facet">
            <span className="sr-label">Location</span>
            <SearchSelect options={locationOptions} value={locationId} onChange={setLocationId} placeholder="Any location" label="Location" />
          </div>
        </FilterDrawer>
      )}
    </>
  );
}

export function TransfersScreen({ view, openReceiveTransfer, openAction, canWrite, initialStatus }) {
  const ledger = view.ledger;
  const [open, setOpen] = useState({});
  const [status, setStatus] = useState(initialStatus || "all");
  const rows = useMemo(() => ledger.transfers.filter((t) => status === "all" || t.status === status), [ledger.transfers, status]);
  const [visible, more] = usePaged(rows, 40, `transfers|${status}`);
  const name = (id) => ledger.locationsById[id]?.name || "Closed location";
  const inTransit = ledger.transfers.filter((t) => t.status === "transit");

  return (
    <>
      <Topline title="Transfers" sub={`${formatUnits(ledger.transfers.length)} transfers · ${formatUnits(inTransit.length)} in transit`}>
        <Seg value={status} onChange={setStatus} label="Transfer status" options={[
          { value: "all", label: "All" },
          { value: "transit", label: `In transit${inTransit.length ? ` (${inTransit.length})` : ""}` },
          { value: "received", label: "Received" },
        ]} />
        {canWrite && (
          <button type="button" className="sr-btn sr-btn-primary" onClick={() => openAction("transfer")}><Icon name="transfer" width={1.8} />New transfer</button>
        )}
      </Topline>
      <div className="sr-body">
        <div className="sr-card">
          <p className="sr-card-sub">
            Stock moved between stores and warehouses. A transfer never changes the stock count, only where units are.
            Units sent in transit belong to neither location until they are received.
          </p>
          <div className="sr-scroller">
            <table className="sr-table sr-rtable" style={{ "--sr-table-min": "1120px" }}>
              <thead><tr><th>Route</th><th>Status</th><th>Sent</th><th>Received</th><th className="n">Designs</th><th className="n">Units</th><th>By</th><th>Note</th><th /></tr></thead>
              <tbody>
                {visible.map((t) => (
                  <React.Fragment key={t.id}>
                    <tr className="is-link" onClick={() => setOpen((o) => ({ ...o, [t.id]: !o[t.id] }))}>
                      <td className="is-primary">
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
                          <span className="sr-caret" style={{ transform: open[t.id] ? "rotate(90deg)" : undefined }}><Icon name="chevron" width={2} /></span>
                          {name(t.from)} → {name(t.to)}
                        </span>
                      </td>
                      <td data-label="Status">{t.status === "transit" ? <Badge tone="low">In transit</Badge> : <Badge tone="ok">Received</Badge>}</td>
                      <td data-label="Sent">{when(t.occurred_at)}</td>
                      <td data-label="Received">{t.status === "transit" ? <span className="sr-muted">Waiting</span> : when(t.receivedAt || t.occurred_at)}</td>
                      <td data-label="Designs" className="n">{new Set(t.lines.map((l) => l.product_id)).size}</td>
                      <td data-label="Units" className="n tot">{formatUnits(t.units)}</td>
                      <td data-label="By">{t.actor_email || "—"}</td>
                      <td data-label="Note" className="wrap">{t.note || <span className="sr-muted">—</span>}</td>
                      <td data-label="Action">
                        {t.status === "transit" && canWrite ? (
                          <button type="button" className="sr-btn" onClick={(e) => { e.stopPropagation(); openReceiveTransfer(t); }}>
                            <Icon name="receive" width={1.7} />Receive
                          </button>
                        ) : null}
                      </td>
                    </tr>
                    {open[t.id] && t.lines.map((l, i) => {
                      const p = view.productsById[l.product_id];
                      return (
                        <tr key={`${t.id}-${i}`} className="sr-subrow">
                          <td colSpan={4}>{p ? `${p.name} · ${p.sku_id || ""}` : "Product no longer live"}</td>
                          <td className="n">{l.size ? sizeLabel(l.size) : "One size"}</td>
                          <td className="n">{formatUnits(l.qty)}</td>
                          <td colSpan={3} />
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
                {!rows.length && <tr><td colSpan={9} className="sr-empty">{ledger.transfers.length ? "No transfers with this status." : "No transfers yet."}</td></tr>}
              </tbody>
            </table>
          </div>
          {more}
        </div>
      </div>
    </>
  );
}

/** Confirms that an in-transit transfer arrived, moving its units into the destination. */
export function ReceiveTransferForm({ transfer, view, onClose, onDone }) {
  const ledger = view.ledger;
  const [requestId] = useState(newRequestId);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const name = (id) => ledger.locationsById[id]?.name || "Closed location";
  const units = `${formatUnits(transfer.units)} unit${transfer.units === 1 ? "" : "s"}`;

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      await receiveTransfer({ requestId, transferId: transfer.id, note });
      onDone({ text: `Received ${units} at ${name(transfer.to)}.`, tone: "ok" });
    } catch (e) {
      setError(e.message || "The transfer could not be received.");
      setSubmitting(false);
    }
  };

  return (
    <FormModal title="Receive Transfer" sub={`${name(transfer.from)} → ${name(transfer.to)} · sent ${when(transfer.occurred_at)}`}
      onClose={onClose} onSubmit={submit} submitLabel={`Receive ${units}`} submitting={submitting} error={error} width={720} submitInHead>
      <StockHint title={`Arriving at ${name(transfer.to)}`} chips={Object.entries(transfer.lines.reduce((acc, l) => {
        const k = l.size ? sizeLabel(l.size) : "One size";
        acc[k] = (acc[k] || 0) + l.qty;
        return acc;
      }, {})).map(([label, qty]) => ({ label, qty }))} />
      <div className="sr-grid-scroll" style={{ marginBottom: 18 }}>
        <table className="sr-grid-table">
          <thead><tr><th>Design</th><th>Size</th><th className="n">Units</th></tr></thead>
          <tbody>
            {transfer.lines.map((l, i) => {
              const p = view.productsById[l.product_id];
              return (
                <tr key={i}>
                  <td>{p ? <ProductCell product={p} /> : "Product no longer live"}</td>
                  <td>{l.size ? sizeLabel(l.size) : "One size"}</td>
                  <td className="n tot">{formatUnits(l.qty)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PField label="Note (Optional)" htmlFor="rt-note" help="If a piece arrived damaged, receive the transfer and then adjust the stock.">
        <input id="rt-note" className="sr-input" value={note} onChange={(e) => setNote(e.target.value)} />
      </PField>
    </FormModal>
  );
}
