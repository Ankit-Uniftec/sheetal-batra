import React, { useMemo, useState } from "react";
import { FormModal, Icon } from "./StockRoomUi";
import { PField, FieldRow, Combo, StockHint } from "./ProductFormUi";
import {
  placeStock, transferStock, sellStock, receiveStock, adjustStock, assignSale, newRequestId,
} from "./stockRoomData";
import { settleShopify, SHOPIFY_SYNC_ON } from "./stockRoomShopify";
import { formatUnits, formatInr, sizeLabel, sortSizes, orderPrefix, formatDay, TYPE_LXRTS, TYPE_CUSTOM } from "./stockRoomModel";

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
    title: "Place Stock",
    sub: "Put unassigned units into a store or warehouse. Stock totals don't change.",
    submit: "Place Stock",
  },
  transfer: {
    title: "Transfer Stock",
    sub: "Move any number of designs and sizes in one movement. Both legs write together.",
    submit: "Transfer",
  },
  sell: {
    title: "Mark As Sold",
    sub: "Deducts from that location and records each sale in the ledger.",
    submit: "Mark Sold",
  },
  receive: {
    title: "Add Stock",
    sub: "Records a receipt for each line against the chosen location. This raises the stock count.",
    submit: "Add Stock",
  },
  adjust: {
    title: "Adjust Stock",
    sub: "Enter what was actually counted. Corrections always carry a reason, so the difference is explained.",
    submit: "Record Adjustment",
  },
  assign: {
    title: "Assign Sale",
    sub: "This sale was made in the order form or on the website. Choose the location the piece left from.",
    submit: "Assign Sale",
  },
};

const ADJUST_REASONS = ["Stocktake · damaged", "Stocktake · miscount", "Returned to atelier", "Found in store", "Correcting a wrong entry"];

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
  const [reason, setReason] = useState(initial.reason || "");
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
      if (!reason) out.push("Choose the reason for the adjustment.");
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
        result = await adjustStock({ requestId, locationId, productId: single.productId, size: single.size, counted, note: note.trim() ? `${reason} — ${note.trim()}` : reason });
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
  const locationCombo = (id, value, onChange, { allowUnassigned = false, unassignedLabel = "Unassigned stock", exclude } = {}) => (
    <Combo id={id} value={value} onChange={onChange} placeholder="Choose a location"
      options={[
        ...(allowUnassigned ? [{ value: UNASSIGNED, label: unassignedLabel }] : []),
        ...locationOptions.filter((o) => o.value !== exclude),
      ]} />
  );

  // "Held at …": what the source location holds, size by size, above the lines.
  const hint = (() => {
    if (mode === "adjust" || mode === "assign") return null;
    const loc = mode === "transfer" ? fromId : mode === "place" ? UNASSIGNED : locationId;
    if (mode === "transfer" && !fromId) return null;
    const totals = {};
    if (loc) {
      Object.values(ledger.index.byLocation[loc] || {}).forEach((sizes) => Object.entries(sizes).forEach(([s, q]) => {
        if (q > 0) totals[sizeLabel(s) || "One size"] = (totals[sizeLabel(s) || "One size"] || 0) + q;
      }));
    } else {
      view.tracked.forEach((r) => {
        const p = ledger.placementById[r.id];
        if (!p) return;
        if (r.stock.bySize) Object.entries(p.unassignedBySize).forEach(([s, q]) => { totals[sizeLabel(s)] = (totals[sizeLabel(s)] || 0) + q; });
        else if (p.unassigned) totals["Custom pieces"] = (totals["Custom pieces"] || 0) + p.unassigned;
      });
    }
    const chips = sortSizes(Object.keys(totals)).map((label) => ({ label, qty: totals[label] }));
    return <StockHint title={loc ? `Held at ${nameOf(loc)}` : "Unassigned stock"} chips={chips} />;
  })();

  const LINE_LABEL = { place: "What Is Being Placed", transfer: "What Is Moving", sell: "What Sold", receive: "What Arrived" };
  const totalValue = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (view.rowsById[l.productId]?.price || 0), 0);

  const lineEditor = (
    <div className="sr-plines">
      <div className="sr-plines-head">
        <span className="sr-label">{LINE_LABEL[mode]}</span>
        <button type="button" className="sr-rowbtn" onClick={() => setLines((ls) => [...ls, makeLine({ qty: 1 })])}>+ Add line</button>
      </div>
      <table className="sr-plines-table">
        <thead><tr><th>Design</th><th>Size</th><th className="n">Units</th><th /></tr></thead>
        <tbody>
          {lines.map((line) => {
            const c = lineCheck(line);
            const row = c.row;
            const source = takesFromLocation ? sourceId : null;
            const sizes = row ? sizeOptions(row, source) : [];
            const sizeChoices = sizes.map((s) => {
              if (mode === "receive" || !row) return { value: s.value, label: s.value ? `Size ${s.label}` : s.label };
              const free = capacity(row, s.value, source);
              return { value: s.value, label: `${s.value ? `Size ${s.label}` : s.label} · ${formatUnits(free)} ${source ? "free" : "unassigned"}`, disabled: free <= 0 };
            });
            return (
              <tr key={line.key}>
                <td>
                  <Combo options={productOptions} value={line.productId} placeholder="Type a design name" ariaLabel="Design"
                    onChange={(v) => {
                      const r = view.rowsById[v];
                      const first = r ? sizeOptions(r, source).find((s) => mode === "receive" || capacity(r, s.value, source) > 0)?.value ?? sizeOptions(r, source)[0]?.value ?? "" : "";
                      updateLine(line.key, { productId: v, size: first });
                    }} />
                </td>
                <td>
                  <Combo options={sizeChoices} value={line.size} placeholder={row ? "Size" : "Choose a design first"} disabled={!row} ariaLabel="Size"
                    onChange={(v) => updateLine(line.key, { size: v })} />
                </td>
                <td>
                  <input className="sr-input is-num" type="number" min="1" step="1" inputMode="numeric" value={line.qty}
                    onChange={(e) => updateLine(line.key, { qty: e.target.value })} aria-label="Units" />
                  {c.available != null && (
                    <div className={`sr-avail${c.problem && Number(line.qty) > c.available ? " is-over" : ""}`}>{formatUnits(c.available)} available</div>
                  )}
                </td>
                <td>
                  {lines.length > 1 && (
                    <button type="button" className="sr-rowbtn" onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}>Remove</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="sr-plines-foot">
        {lines.length} line{lines.length === 1 ? "" : "s"} · {pluralUnits(totalUnits)}{totalValue ? ` · ${formatInr(totalValue)}` : ""}
      </div>
    </div>
  );

  const noteField = (placeholder) => (
    <PField label="Note (Optional)" htmlFor="sa-note">
      <input id="sa-note" className="sr-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholder} />
    </PField>
  );

  let body;
  if (mode === "place") {
    body = (
      <>
        {hint}
        <FieldRow>
          <PField label="Place Into" htmlFor="sa-into">{locationCombo("sa-into", locationId, (v) => setLocationId(v))}</PField>
          {noteField("e.g. Opening count at Delhi")}
        </FieldRow>
        {lineEditor}
      </>
    );
  } else if (mode === "transfer") {
    body = (
      <>
        {hint}
        <FieldRow>
          <PField label="From" htmlFor="sa-from">
            {locationCombo("sa-from", fromId, (v) => { setFromId(v); if (v === toId) setToId(""); setLines([makeLine()]); })}
          </PField>
          <PField label="To" htmlFor="sa-to">{locationCombo("sa-to", toId, setToId, { exclude: fromId })}</PField>
        </FieldRow>
        <FieldRow>
          <PField label="Delivery" htmlFor="sa-delivery"
            help={inTransit ? "Units wait under In transit until someone receives them at the destination." : "Units land at the destination straight away."}>
            <Combo id="sa-delivery" value={inTransit ? "transit" : "now"} onChange={(v) => setInTransit(v === "transit")}
              options={[{ value: "transit", label: "In transit — receive later" }, { value: "now", label: "Arrived now" }]} />
          </PField>
          {noteField("e.g. Courier AWB 5521")}
        </FieldRow>
        {fromId ? lineEditor : <p className="sr-help" style={{ marginBottom: 18 }}>Choose where the units are now to see what can be moved.</p>}
      </>
    );
  } else if (mode === "sell" || mode === "receive") {
    body = (
      <>
        {hint}
        <FieldRow>
          <PField label={mode === "sell" ? "Sold From" : "Into"} htmlFor="sa-loc"
            help={locationId ? null : mode === "sell" ? "Unassigned stock is used when no location is chosen." : "Leave as unassigned stock if it isn't in a location yet."}>
            {locationCombo("sa-loc", locationId, (v) => { setLocationId(v); if (mode === "sell") setLines([makeLine()]); }, { allowUnassigned: true })}
          </PField>
          <PField label="Reference (Optional)" htmlFor="sa-ref">
            <input id="sa-ref" className="sr-input" value={reference} onChange={(e) => setReference(e.target.value)} disabled={!!initial.orderId}
              placeholder={mode === "sell" ? "Order number or buyer" : "Stock order number"} />
          </PField>
        </FieldRow>
        {lineEditor}
        {noteField(mode === "sell" ? "e.g. Sold at the Ludhiana trunk show" : "e.g. Delivery from the atelier")}
      </>
    );
  } else if (mode === "adjust") {
    const diff = adjustCurrent != null && counted !== "" ? Number(counted) - adjustCurrent : null;
    const sizeChoices = adjustSizes.map((s) => {
      const have = locationId ? placedAt(locationId, singleRow.id, s) : singleRow?.stock.bySize?.[s];
      return { value: s, label: `${s ? `Size ${sizeLabel(s)}` : "One size"}${have != null && !(singleRow?.stock.invalidSizes.includes(s) && !locationId) ? ` · ${formatUnits(have)} on hand` : ""}` };
    });
    body = (
      <>
        <PField label="Location" htmlFor="sa-loc" help={locationId ? null : "Leave on the design total to correct the stock count itself."}>
          {locationCombo("sa-loc", locationId, setLocationId, { allowUnassigned: true, unassignedLabel: "The design's total (all stock)" })}
        </PField>
        <PField label="Design" htmlFor="sa-design">
          <Combo id="sa-design" options={productOptions} value={single.productId} placeholder="Type a design name"
            onChange={(v) => { const r = view.rowsById[v]; updateLine(single.key, { productId: v, size: r ? (r.type === TYPE_LXRTS ? r.stock.sizes.find((s) => !r.stock.invalidSizes.includes(s)) || r.stock.sizes[0] || "" : r.stock.sizes[0] || "") : "" }); }} />
        </PField>
        {adjustNeedsSize && (
          <PField label="Size" htmlFor="sa-size">
            <Combo id="sa-size" options={sizeChoices} value={single.size} placeholder="Choose a size" onChange={(v) => updateLine(single.key, { size: v })} />
          </PField>
        )}
        <PField label="Counted (Units Actually There)" htmlFor="sa-counted"
          helpTone={fixingInvalid ? "warn" : undefined}
          help={fixingInvalid
            ? "The stock record holds an impossible number. What you enter replaces it; Shopify is not changed."
            : adjustCurrent != null ? `${formatUnits(adjustCurrent)} on hand${diff ? ` · ${diff > 0 ? "+" : ""}${diff} will be recorded` : ""}.` : null}>
          <input id="sa-counted" className="sr-input is-num" type="number" min="0" step="1" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value)} />
        </PField>
        <PField label="Reason" htmlFor="sa-reason">
          <Combo id="sa-reason" value={reason} onChange={setReason} placeholder="Why the count changed"
            options={ADJUST_REASONS.map((r) => ({ value: r, label: r }))} />
        </PField>
        {noteField("e.g. One piece damaged in the trial room")}
      </>
    );
  } else {
    body = (
      <>
        {singleRow && (
          <div className="sr-stock-hint">
            <span className="sr-label">Waiting for a location</span>
            <div style={{ marginTop: 6 }}>
              {singleRow.product.name}{single.size ? ` · ${sizeLabel(single.size)}` : ""} — {formatUnits(assignItem?.qty || 0)} sold unit{assignItem?.qty === 1 ? "" : "s"}
            </div>
          </div>
        )}
        {assignItem && assignItem.candidates.length > 0 && (
          <PField label="Which Order" htmlFor="sa-order" help="Recent orders for this design and size that have no location yet.">
            <Combo id="sa-order" value={candidateKey} placeholder="Not linked to a specific order"
              options={[{ value: "", label: "Not linked to a specific order" }, ...assignItem.candidates.slice(0, 30).map((c) => ({
                value: `${c.order.id}|${c.line}`,
                label: `${c.order.order_no} · ${formatDay(c.order.created_at)} · ${c.qty} unit${c.qty === 1 ? "" : "s"}${orderPrefix(c.order.order_no) ? ` · ${orderPrefix(c.order.order_no)}` : ""}`,
              }))]}
              onChange={(key) => {
                setCandidateKey(key);
                const c = assignItem.candidates.find((x) => `${x.order.id}|${x.line}` === key);
                if (c) {
                  updateLine(single.key, { qty: String(Math.min(c.qty, assignItem.qty)) });
                  if (c.suggestedLocationId && assignLocationOptions.some((o) => o.value === c.suggestedLocationId)) setLocationId(c.suggestedLocationId);
                }
              }} />
          </PField>
        )}
        <FieldRow>
          <PField label="Left From" htmlFor="sa-left" help={assignLocationOptions.length ? null : "No location holds this design and size."}>
            <Combo id="sa-left" value={locationId} onChange={setLocationId} placeholder="Choose a location"
              options={assignLocationOptions.map((o) => ({ value: o.value, label: o.label }))} />
          </PField>
          <PField label="Units" htmlFor="sa-units">
            <input id="sa-units" className="sr-input is-num" type="number" min="1" step="1" value={single.qty} onChange={(e) => updateLine(single.key, { qty: e.target.value })} />
          </PField>
        </FieldRow>
        {singleRow?.type === TYPE_CUSTOM && locationId && (
          <PField label="Size At That Location" htmlFor="sa-csize">
            <Combo id="sa-csize" value={single.size} onChange={(v) => updateLine(single.key, { size: v })}
              options={Object.keys(ledger.index.byLocation[locationId]?.[singleRow.id] || {}).map((s) => ({ value: s, label: s ? `Size ${sizeLabel(s)}` : "One size" }))} />
          </PField>
        )}
        {noteField("Optional")}
      </>
    );
  }

  const narrow = mode === "adjust" || mode === "assign";
  return (
    <FormModal title={copy.title} sub={copy.sub} onClose={onClose} onSubmit={submit}
      submitLabel={copy.submit} submitting={submitting} error={error} width={narrow ? 560 : 940} submitInHead>
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
    </FormModal>
  );
}
