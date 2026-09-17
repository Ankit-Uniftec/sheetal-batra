import React, { useMemo, useState } from "react";
import { FormModal, Field, SearchSelect, Icon, Seg } from "./StockRoomUi";
import {
  placeStock, transferStock, sellStock, receiveStock, adjustStock, assignSale, newRequestId,
} from "./stockRoomData";
import { settleShopify, SHOPIFY_SYNC_ON } from "./stockRoomShopify";
import { formatUnits, sizeLabel, orderPrefix, formatDay, TYPE_LXRTS, TYPE_CUSTOM } from "./stockRoomModel";

// ============================================================
// Stock Room — one form for every stock action.
//
//   place     unassigned units → a location          (total unchanged)
//   transfer  location → location                    (total unchanged)
//   sell      a location or unassigned → sold        (total goes down)
//   receive   new units → a location or unassigned   (total goes up)
//   adjust    recount a location, or a design total  (total moves by the difference)
//   assign    say which location a sale made elsewhere left from (total unchanged)
//
// The form shows what each line can take, but the database function is the
// authority: it re-checks everything under a lock and its message is shown
// as-is if it refuses.
// ============================================================

const UNASSIGNED = "";

const COPY = {
  place: {
    title: "Place stock",
    sub: "Put unassigned units into a store or warehouse. Stock totals don't change.",
    submit: "Place stock",
  },
  transfer: {
    title: "Transfer stock",
    sub: "Move units from one location to another. Stock totals don't change.",
    submit: "Transfer",
  },
  sell: {
    title: "Mark as sold",
    sub: "Record units sold from a location. This lowers the stock count, the same as placing an order.",
    submit: "Mark as sold",
  },
  receive: {
    title: "Receive stock",
    sub: "Add new units — a delivery from production or a return. This raises the stock count.",
    submit: "Receive stock",
  },
  adjust: {
    title: "Recount stock",
    sub: "Enter what was actually counted. The difference is recorded as found or missing stock.",
    submit: "Save count",
  },
  assign: {
    title: "Assign a sale to a location",
    sub: "This sale was made in the order form or on the website. Choose the location the piece left from.",
    submit: "Assign sale",
  },
};

let lineKey = 0;
const makeLine = (l = {}) => ({ key: (lineKey += 1), productId: l.productId || "", size: l.size ?? "", qty: l.qty != null ? String(l.qty) : "1", orderLine: l.orderLine });

const pluralUnits = (n) => `${formatUnits(n)} unit${Number(n) === 1 ? "" : "s"}`;

export default function StockActionForm({ mode, initial = {}, view, onClose, onDone }) {
  const copy = COPY[mode];
  const ledger = view.ledger;
  const [requestId] = useState(newRequestId);
  const [locationId, setLocationId] = useState(initial.locationId ?? (mode === "sell" || mode === "receive" || mode === "adjust" ? UNASSIGNED : ""));
  const [fromId, setFromId] = useState(initial.fromId || "");
  const [toId, setToId] = useState(initial.toId || "");
  // Transfers go "in transit" by default and are received at the other end.
  const [inTransit, setInTransit] = useState(initial.inTransit ?? true);
  const [lines, setLines] = useState(() => (initial.lines && initial.lines.length ? initial.lines.map(makeLine) : [makeLine()]));
  const [reference, setReference] = useState(initial.reference || "");
  const [note, setNote] = useState(initial.note || "");
  const [counted, setCounted] = useState(initial.counted != null ? String(initial.counted) : "");
  const [candidateKey, setCandidateKey] = useState(initial.candidateKey || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const locationOptions = useMemo(
    () => ledger.locations.map((l) => ({ value: l.id, label: `${l.name}${l.kind === "store" ? " · store" : ""}` })),
    [ledger.locations],
  );
  const nameOf = (id) => (id ? ledger.locationsById[id]?.name || "Location" : "Unassigned stock");

  // Where units come from, for the modes that take from somewhere.
  const sourceId = mode === "transfer" ? fromId : mode === "sell" ? locationId : mode === "place" ? UNASSIGNED : null;
  const takesFromLocation = !!sourceId;

  const placedAt = (loc, productId, size) => ledger.index.byLocation[loc]?.[productId]?.[size] || 0;

  // What one line may take, before other lines on the form are counted.
  const capacity = (row, size, source) => {
    const p = ledger.placementById[row.id];
    if (!p) return 0;
    if (source) return placedAt(source, row.id, size);
    if (row.type === TYPE_CUSTOM) return p.unassigned;
    return p.unassignedBySize[size] || 0;
  };

  const productOptions = useMemo(() => {
    const rows = view.tracked.filter((r) => !r.stock.unlimited).filter((r) => {
      if (mode === "receive" || mode === "adjust") return true;
      if (mode === "assign") return !!ledger.placementById[r.id]?.toAssign;
      const p = ledger.placementById[r.id];
      if (!p) return false;
      if (sourceId) return !!ledger.index.byLocation[sourceId]?.[r.id];
      return p.unassigned > 0;
    });
    return rows.map((r) => ({ value: r.id, label: `${r.product.name} · ${r.product.sku_id || "no SKU"}` }));
  }, [view.tracked, ledger, mode, sourceId]);

  const sizeOptions = (row, source) => {
    if (!row) return [];
    let sizes;
    if (source) {
      sizes = Object.keys(ledger.index.byLocation[source]?.[row.id] || {});
    } else if (row.type === TYPE_LXRTS) {
      sizes = row.stock.sizes.filter((s) => !row.stock.invalidSizes.includes(s));
      if (mode === "place" || mode === "sell") sizes = sizes.filter((s) => (ledger.placementById[row.id]?.unassignedBySize[s] || 0) > 0);
    } else {
      sizes = row.stock.sizes.length ? row.stock.sizes : [""];
    }
    return sizes.map((s) => ({ value: s, label: s ? sizeLabel(s) : "One size" }));
  };

  // Units already asked for by OTHER lines of the same product (and size, for LXRTS).
  const usedElsewhere = (line, row) => lines.reduce((sum, l) => {
    if (l.key === line.key || l.productId !== line.productId) return sum;
    if (row.type === TYPE_LXRTS || sourceId) { if (l.size !== line.size) return sum; }
    return sum + (Number(l.qty) || 0);
  }, 0);

  const lineCheck = (line) => {
    const row = view.rowsById[line.productId];
    if (!row) return { row: null, available: null, problem: "Choose a design." };
    const sizes = sizeOptions(row, takesFromLocation ? sourceId : null);
    if (!sizes.some((s) => s.value === line.size)) return { row, available: null, problem: "Choose a size." };
    const qty = Number(line.qty);
    if (!Number.isInteger(qty) || qty <= 0) return { row, available: null, problem: "Enter a whole number above zero." };
    if (mode === "receive") return { row, available: null, problem: null };
    let available = capacity(row, line.size, takesFromLocation ? sourceId : null) - usedElsewhere(line, row);
    // Selling can never exceed the design's existing total either.
    if (mode === "sell") available = Math.min(available, row.stock.bySize ? row.stock.bySize[line.size] || 0 : row.stock.total);
    available = Math.max(0, available);
    return { row, available, problem: qty > available ? `Only ${formatUnits(available)} available.` : null };
  };

  const updateLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // ---------- adjust & assign: one design, one size ----------
  const single = lines[0];
  const singleRow = view.rowsById[single.productId];

  const adjustCurrent = (() => {
    if (mode !== "adjust" || !singleRow) return null;
    if (locationId) return placedAt(locationId, singleRow.id, single.size);
    if (singleRow.stock.invalidSizes.includes(single.size)) return null;
    if (singleRow.type === TYPE_CUSTOM) return singleRow.stock.total;
    return singleRow.stock.bySize?.[single.size] ?? null;
  })();

  // Sizes a recount can target: at a location, what is there plus what the
  // design is made in (a count can find a size that was never recorded there).
  const adjustSizes = (() => {
    if (mode !== "adjust" || !singleRow) return [];
    const made = singleRow.type === TYPE_LXRTS ? singleRow.stock.sizes : (singleRow.stock.sizes.length ? singleRow.stock.sizes : [""]);
    const here = locationId ? Object.keys(ledger.index.byLocation[locationId]?.[singleRow.id] || {}) : [];
    // A size with an impossible count can only be fixed by recounting the total.
    return [...new Set([...here, ...made])].filter((s) => !locationId || !singleRow.stock.invalidSizes.includes(s));
  })();
  const fixingInvalid = mode === "adjust" && !!singleRow && !locationId && singleRow.stock.invalidSizes.includes(single.size);
  const adjustNeedsSize = !!singleRow && !(singleRow.type === TYPE_CUSTOM && !locationId);

  const assignItem = mode === "assign" && singleRow
    ? ledger.toAssign.find((t) => t.row.id === singleRow.id && (singleRow.type === TYPE_CUSTOM || t.size === single.size))
    : null;
  const candidate = assignItem?.candidates.find((c) => `${c.order.id}|${c.line}` === candidateKey) || null;

  const assignLocationOptions = useMemo(() => {
    if (mode !== "assign" || !singleRow) return [];
    return ledger.locations
      .map((l) => {
        const held = singleRow.type === TYPE_CUSTOM
          ? Object.values(ledger.index.byLocation[l.id]?.[singleRow.id] || {}).reduce((a, q) => a + q, 0)
          : placedAt(l.id, singleRow.id, single.size);
        return { value: l.id, label: `${l.name} · holds ${formatUnits(held)}`, held };
      })
      .filter((o) => o.held > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, singleRow, single.size, ledger]);

  // ---------- validation ----------
  const problems = (() => {
    const out = [];
    if (mode === "place" && !locationId) out.push("Choose where the units go.");
    if (mode === "transfer") {
      if (!fromId || !toId) out.push("Choose both locations.");
      else if (fromId === toId) out.push("Choose two different locations.");
    }
    if (mode === "adjust") {
      if (!singleRow) out.push("Choose a design.");
      if (adjustNeedsSize && !adjustSizes.includes(single.size)) out.push("Choose a size.");
      if (counted === "" || !Number.isInteger(Number(counted)) || Number(counted) < 0) out.push("Enter the counted number (zero or more).");
      if (!note.trim()) out.push("Say why the count changed.");
    } else if (mode === "assign") {
      if (!locationId) out.push("Choose the location the sale left from.");
      const qty = Number(single.qty);
      if (!Number.isInteger(qty) || qty <= 0) out.push("Enter a whole number above zero.");
      else if (assignItem && qty > assignItem.qty) out.push(`Only ${formatUnits(assignItem.qty)} sold unit${assignItem.qty === 1 ? " is" : "s are"} waiting for a location.`);
    } else {
      lines.forEach((l, i) => {
        const c = lineCheck(l);
        if (c.problem) out.push(`Line ${i + 1}: ${c.problem}`);
      });
    }
    return out;
  })();

  const touchesShopify = ["sell", "receive", "adjust"].includes(mode) && !fixingInvalid
    && lines.some((l) => view.rowsById[l.productId]?.type === TYPE_LXRTS);

  const totalUnits = lines.reduce((a, l) => a + (Number(l.qty) || 0), 0);

  // ---------- submit ----------
  const submit = async () => {
    if (problems.length) { setError(problems[0]); return; }
    setSubmitting(true);
    setError("");
    try {
      const payloadLines = lines.map((l) => ({ productId: l.productId, size: l.size, qty: Number(l.qty), orderLine: l.orderLine }));
      let result;
      let message;
      if (mode === "place") {
        result = await placeStock({ requestId, locationId, lines: payloadLines, note });
        message = `Placed ${pluralUnits(totalUnits)} in ${nameOf(locationId)}.`;
      } else if (mode === "transfer") {
        result = await transferStock({ requestId, fromId, toId, lines: payloadLines, note, inTransit });
        message = inTransit
          ? `Sent ${pluralUnits(totalUnits)} from ${nameOf(fromId)} to ${nameOf(toId)}. Receive them under Transfers when they arrive.`
          : `Moved ${pluralUnits(totalUnits)} from ${nameOf(fromId)} to ${nameOf(toId)}.`;
      } else if (mode === "sell") {
        result = await sellStock({ requestId, locationId, lines: payloadLines, reference, note });
        message = `Marked ${pluralUnits(totalUnits)} sold from ${nameOf(locationId)}.`;
      } else if (mode === "receive") {
        result = await receiveStock({ requestId, locationId, lines: payloadLines, reference, note, orderId: initial.orderId });
        message = `Received ${pluralUnits(totalUnits)} into ${nameOf(locationId)}.`;
      } else if (mode === "adjust") {
        result = await adjustStock({ requestId, locationId, productId: single.productId, size: single.size, counted, note });
        message = result?.replaced_invalid
          ? `Corrected ${singleRow.product.name}${single.size ? ` (${sizeLabel(single.size)})` : ""} to ${formatUnits(counted)}. Check the same size in Shopify by hand.`
          : result?.unchanged
          ? "The count matched — nothing changed."
          : `Recounted ${singleRow.product.name}${single.size ? ` (${sizeLabel(single.size)})` : ""}: ${formatUnits(adjustCurrent)} → ${formatUnits(counted)}.`;
      } else {
        result = await assignSale({
          requestId, locationId, productId: single.productId, size: single.size, qty: single.qty,
          orderId: candidate?.order.id, orderNo: candidate?.order.order_no, orderLine: candidate?.line, note,
        });
        message = `Sale assigned to ${nameOf(locationId)}.`;
      }

      const shopify = await settleShopify(result?.movements);
      let tone = "ok";
      if (shopify.failed.length) {
        tone = "crit";
        message += ` Shopify was NOT updated for ${shopify.failed.length} line${shopify.failed.length === 1 ? "" : "s"} — see Integrity.`;
      } else if (shopify.notSent) {
        tone = "warn";
        message += ` Shopify not updated (sync is off here) — listed under Integrity.`;
      } else if (shopify.sent) {
        message += " Shopify updated.";
      }
      onDone({ text: message, tone });
    } catch (e) {
      setError(e.message || "The change could not be saved.");
      setSubmitting(false);
    }
  };

  // ---------- render ----------
  // The empty choice in SearchSelect doubles as "Unassigned" where that is allowed.
  const locationField = (label, value, onChange, { allowUnassigned = false, unassignedLabel = "Unassigned stock", hint } = {}) => (
    <Field label={label} hint={hint}>
      <SearchSelect
        options={locationOptions}
        value={value}
        onChange={onChange}
        placeholder={allowUnassigned ? unassignedLabel : "Choose a location"}
        label={label}
      />
    </Field>
  );

  const lineEditor = (
    <>
      <div className="sr-lines">
        <div className="sr-lines-head" aria-hidden="true"><span>Design</span><span>Size</span><span style={{ textAlign: "right" }}>Units</span><span /></div>
        {lines.map((line) => {
          const c = lineCheck(line);
          const row = c.row;
          const sizes = row ? sizeOptions(row, takesFromLocation ? sourceId : null) : [];
          return (
            <div className="sr-line" key={line.key}>
              <SearchSelect
                options={productOptions}
                value={line.productId}
                onChange={(v) => {
                  const r = view.rowsById[v];
                  const first = r ? sizeOptions(r, takesFromLocation ? sourceId : null)[0]?.value ?? "" : "";
                  updateLine(line.key, { productId: v, size: first });
                }}
                placeholder="Search design or SKU"
                label="Design"
              />
              <select className="sr-select" value={line.size} onChange={(e) => updateLine(line.key, { size: e.target.value })}
                disabled={!row || !sizes.length} aria-label="Size">
                {!sizes.length && <option value="">—</option>}
                {sizes.map((s) => <option key={s.value || "one"} value={s.value}>{s.label}</option>)}
              </select>
              <span>
                <input className="sr-input is-num" type="number" min="1" step="1" inputMode="numeric" value={line.qty}
                  onChange={(e) => updateLine(line.key, { qty: e.target.value })} aria-label="Units" />
                {c.available != null && (
                  <span className={`sr-line-avail${c.problem && Number(line.qty) > c.available ? " is-over" : ""}`}>
                    {formatUnits(c.available)} available
                  </span>
                )}
              </span>
              <button type="button" className="sr-line-remove" aria-label="Remove line"
                disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}>×</button>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <button type="button" className="sr-btn" onClick={() => setLines((ls) => [...ls, makeLine({ qty: 1 })])}>+ Add another design</button>
        <span className="sr-summary-line">{lines.length} line{lines.length === 1 ? "" : "s"} · {pluralUnits(totalUnits)}</span>
      </div>
    </>
  );

  let body;
  if (mode === "place") {
    body = (
      <>
        <div className="sr-form-grid">{locationField("Place into", locationId, setLocationId)}</div>
        {lineEditor}
      </>
    );
  } else if (mode === "transfer") {
    body = (
      <>
        <div className="sr-form-grid">
          {locationField("From", fromId, (v) => { setFromId(v); setLines([makeLine()]); })}
          {locationField("To", toId, setToId)}
          <Field label="Delivery" wide>
            <Seg value={inTransit ? "transit" : "now"} onChange={(v) => setInTransit(v === "transit")} label="Delivery"
              options={[{ value: "transit", label: "In transit — receive later" }, { value: "now", label: "Arrived now" }]} />
          </Field>
        </div>
        {fromId ? lineEditor : <p className="sr-muted" style={{ marginBottom: 18 }}>Choose where the units are now to see what can be moved.</p>}
      </>
    );
  } else if (mode === "sell" || mode === "receive") {
    body = (
      <>
        <div className="sr-form-grid">
          {locationField(mode === "sell" ? "Sold from" : "Receive into", locationId,
            (v) => { setLocationId(v); if (mode === "sell") setLines([makeLine()]); },
            { allowUnassigned: true, hint: locationId ? null : "Leave empty to use unassigned stock." })}
          <Field label="Reference" hint={mode === "sell" ? "Invoice or bill number, optional." : "Delivery note or order number, optional."}>
            <input className="sr-input" value={reference} onChange={(e) => setReference(e.target.value)} disabled={!!initial.orderId} />
          </Field>
        </div>
        {lineEditor}
      </>
    );
  } else if (mode === "adjust") {
    const diff = adjustCurrent != null && counted !== "" ? Number(counted) - adjustCurrent : null;
    body = (
      <div className="sr-form-grid">
        {locationField("Where was it counted", locationId, setLocationId,
          { allowUnassigned: true, unassignedLabel: "The design's total (all stock)", hint: locationId ? null : "Leave empty to set the total stock count itself." })}
        <Field label="Design">
          <SearchSelect options={productOptions} value={single.productId} placeholder="Search design or SKU" label="Design"
            onChange={(v) => { const r = view.rowsById[v]; updateLine(single.key, { productId: v, size: r ? (r.type === TYPE_LXRTS ? r.stock.sizes.find((s) => !r.stock.invalidSizes.includes(s)) || "" : r.stock.sizes[0] || "") : "" }); }} />
        </Field>
        {adjustNeedsSize && (
          <Field label="Size">
            <select className="sr-select" value={single.size} onChange={(e) => updateLine(single.key, { size: e.target.value })}>
              {!adjustSizes.includes(single.size) && <option value={single.size}>Choose a size</option>}
              {adjustSizes.map((s) => <option key={s || "one"} value={s}>{s ? sizeLabel(s) : "One size"}</option>)}
            </select>
          </Field>
        )}
        <Field label="Counted" hint={fixingInvalid
          ? "The stock record holds an impossible number. What you enter replaces it; Shopify is not changed."
          : adjustCurrent != null ? `Recorded now: ${formatUnits(adjustCurrent)}${diff ? ` · ${diff > 0 ? "+" : ""}${diff} will be recorded` : ""}` : null}>
          <input className="sr-input is-num" type="number" min="0" step="1" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value)} />
        </Field>
        <Field label="Why the count changed" wide>
          <textarea className="sr-textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Monthly count at Delhi — 1 piece damaged" />
        </Field>
      </div>
    );
  } else {
    body = (
      <>
        {singleRow && (
          <p className="sr-summary-line" style={{ marginBottom: 16 }}>
            {singleRow.product.name}{single.size ? ` · ${sizeLabel(single.size)}` : ""} — {formatUnits(assignItem?.qty || 0)} sold unit{assignItem?.qty === 1 ? "" : "s"} waiting for a location
          </p>
        )}
        <div className="sr-form-grid">
          {assignItem && assignItem.candidates.length > 0 && (
            <Field label="Which order" hint="Recent orders for this design and size that have no location yet." wide>
              <select className="sr-select" value={candidateKey} onChange={(e) => {
                const key = e.target.value;
                setCandidateKey(key);
                const c = assignItem.candidates.find((x) => `${x.order.id}|${x.line}` === key);
                if (c) {
                  updateLine(single.key, { qty: String(Math.min(c.qty, assignItem.qty)) });
                  if (c.suggestedLocationId && assignLocationOptions.some((o) => o.value === c.suggestedLocationId)) setLocationId(c.suggestedLocationId);
                }
              }}>
                <option value="">Not linked to a specific order</option>
                {assignItem.candidates.slice(0, 30).map((c) => (
                  <option key={`${c.order.id}|${c.line}`} value={`${c.order.id}|${c.line}`}>
                    {c.order.order_no} · {formatDay(c.order.created_at)} · {c.qty} unit{c.qty === 1 ? "" : "s"}{orderPrefix(c.order.order_no) ? ` · ${orderPrefix(c.order.order_no)}` : ""}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Left from" hint={assignLocationOptions.length ? null : "No location holds this design and size."}>
            <select className="sr-select" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Choose a location</option>
              {assignLocationOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          {singleRow?.type === TYPE_CUSTOM && locationId && (
            <Field label="Size at that location">
              <select className="sr-select" value={single.size} onChange={(e) => updateLine(single.key, { size: e.target.value })}>
                {Object.keys(ledger.index.byLocation[locationId]?.[singleRow.id] || {}).map((s) => <option key={s || "one"} value={s}>{s ? sizeLabel(s) : "One size"}</option>)}
              </select>
            </Field>
          )}
          <Field label="Units">
            <input className="sr-input is-num" type="number" min="1" step="1" value={single.qty} onChange={(e) => updateLine(single.key, { qty: e.target.value })} />
          </Field>
        </div>
      </>
    );
  }

  return (
    <FormModal title={copy.title} sub={copy.sub} onClose={onClose} onSubmit={submit}
      submitLabel={copy.submit} submitting={submitting} error={error} width={mode === "adjust" || mode === "assign" ? 680 : 860}>
      {touchesShopify && (
        <p className={`sr-callout ${SHOPIFY_SYNC_ON ? "is-info" : "is-warn"}`}>
          <Icon name="alert" width={1.8} />
          <span>
            {SHOPIFY_SYNC_ON
              ? "LXRTS lines will also update Shopify, so the order form shows the new stock."
              : "Shopify will not be updated from this environment. LXRTS changes are saved here and listed under Integrity as not sent."}
          </span>
        </p>
      )}
      {body}
      {mode !== "adjust" && (
        <Field label="Note" hint="Optional. Saved with the movement.">
          <textarea className="sr-textarea" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      )}
    </FormModal>
  );
}
