import React, { useEffect, useMemo, useRef, useState } from "react";
import { FormModal, Badge, Seg } from "./StockRoomUi";
import { FormSection, PField, DropZone } from "./ProductFormUi";
import {
  loadProductFormOptions, loadLiveProductNames, loadAllSkus, importProducts, placeStock, newRequestId,
} from "./stockRoomData";
import {
  CSV_COLUMNS, TEMPLATE_DEMO_ROWS, parseCsv, buildCsv, downloadCsv, validateRow, checkDuplicateName,
} from "../../components/AddProduct/csvHelpers";
import { formatUnits, sizeLabel, sortSizes, TYPE_CUSTOM, TYPE_LXRTS } from "./stockRoomModel";

// ============================================================
// Stock Room — CSV imports.
//
//   products  new made-to-order / custom products, using the SAME column
//             schema and row validation as the Add Product CSV import
//             (components/AddProduct/csvHelpers.js), so a file that imports
//             there imports here and vice versa.
//   opening   place unassigned stock into locations in bulk. The template is
//             pre-filled with every design and size that still has
//             unassigned units — only the location needs filling in.
// ============================================================

const OPENING_COLUMNS = ["sku_id", "design", "size", "unassigned_now", "location", "units"];

// ---------------- products ----------------

function ProductsImport({ onDone, setError, setSubmit }) {
  const [file, setFile] = useState(null);
  const [checked, setChecked] = useState(null);
  const [checking, setChecking] = useState(false);

  const check = async (f) => {
    setFile(f);
    setChecked(null);
    setError("");
    setChecking(true);
    try {
      const { headers, data } = parseCsv(f.text);
      const missing = ["name", "base_price"].filter((h) => !headers.includes(h));
      if (missing.length) throw new Error(`The file is missing the ${missing.join(" and ")} column${missing.length > 1 ? "s" : ""}. Download the template to see the expected columns.`);
      if (!data.length) throw new Error("The file has no rows.");
      const [opts, live, skus] = await Promise.all([loadProductFormOptions(), loadLiveProductNames(), loadAllSkus()]);
      const seenNames = [...live];
      const seenSkus = new Set();
      const rows = data.map((raw, i) => {
        const v = validateRow(raw, i + 2, opts.dupattaColors);
        const errors = v.ok ? [] : [...v.errors];
        let normalized = v.ok ? { ...v.normalized } : null;
        if (normalized) {
          const dup = checkDuplicateName(normalized.name, normalized.store_category, seenNames);
          if (!dup.ok) errors.push(dup.error);
          else {
            if (dup.renameTo) normalized.name = dup.renameTo;
            seenNames.push({ name: normalized.name, store_category: normalized.store_category });
          }
          const sku = normalized.sku_id ? normalized.sku_id.toUpperCase() : null;
          if (sku && (skus.has(sku) || seenSkus.has(sku))) errors.push(`SKU ${normalized.sku_id} is already used.`);
          if (sku) seenSkus.add(sku);
          normalized = { ...normalized, sync_enabled: false };
          // A custom piece holds real stock; "MTO" on one would hide it from every stock total.
          if (normalized.is_custom_piece && normalized.inventory === 9999) errors.push("A custom piece needs a real stock count, not MTO.");
        }
        return { line: i + 2, raw, normalized, errors, renamed: normalized && normalized.name !== (raw.name || "").trim() };
      });
      setChecked(rows);
    } catch (e) {
      setError(e.message);
    } finally {
      setChecking(false);
    }
  };

  const valid = (checked || []).filter((r) => !r.errors.length);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setSubmit({
    label: valid.length ? `Import ${valid.length} Valid Row${valid.length === 1 ? "" : "s"}` : "Import Valid Rows",
    disabled: !valid.length,
    run: async () => {
      const { saved, failed } = await importProducts(valid.map((r) => r.normalized));
      onDone({
        text: `${saved.length} product${saved.length === 1 ? "" : "s"} imported${failed.length ? `; ${failed.length} failed: ${failed.slice(0, 3).join("; ")}` : ""}.`,
        tone: failed.length ? "crit" : "ok",
      });
    },
  }));

  const useSample = () => check({ name: "sample-row.csv", size: 0, text: buildCsv(CSV_COLUMNS, TEMPLATE_DEMO_ROWS) });

  return (
    <>
      <FormSection title="Choose File"
        note="Header row must match the export. Use | between multiple values, and MTO for unlimited stock. LXRTS designs need a Shopify ID and sizes, so add those with Add Product." />
      <PField label="CSV File"
        actions={(
          <>
            <button type="button" className="sr-linkbtn" onClick={useSample}>Use Sample Row</button>
            <button type="button" className="sr-linkbtn" onClick={() => downloadCsv("stock-room-products-template.csv", buildCsv(CSV_COLUMNS, TEMPLATE_DEMO_ROWS))}>Download Template</button>
          </>
        )}
        help="Leave sku_id empty to number new designs automatically.">
        <DropZone file={file} rows={checked ? checked.length : null} onFile={check} onClear={() => { setFile(null); setChecked(null); setError(""); }} />
      </PField>
      {checking && <p className="sr-help">Checking the file…</p>}
      {checked && (
        <PField label="Preview" actions={<span className="sr-help" style={{ marginTop: 0 }}>{valid.length} of {checked.length} rows will import</span>}>
          <div className="sr-grid-scroll" style={{ maxHeight: 420, overflowY: "auto" }}>
            <table className="sr-grid-table">
              <thead><tr><th>Row</th><th>Design</th><th>Type</th><th>Sizes</th><th className="n">Price</th><th className="n">Stock</th><th>Status</th></tr></thead>
              <tbody>
                {checked.map((r) => (
                  <tr key={r.line} className={r.errors.length ? "is-off" : undefined}>
                    <td className="sr-g-size">{r.line}</td>
                    <td>{r.normalized?.name || r.raw.name || <span className="sr-muted">no name</span>}</td>
                    <td>{r.normalized ? (r.normalized.is_custom_piece ? "Custom Piece" : "Made to Order") : "—"}</td>
                    <td>{r.normalized?.available_size?.join(" ") || "—"}</td>
                    <td className="n">{r.normalized?.base_price ?? r.raw.base_price ?? "—"}</td>
                    <td className="n">{r.normalized ? (r.normalized.inventory === 9999 ? "MTO" : formatUnits(r.normalized.inventory)) : (r.raw.inventory || "—")}</td>
                    <td>
                      {r.errors.length
                        ? <Badge tone="crit">{r.errors[0]}</Badge>
                        : <Badge tone={r.renamed ? "low" : "ok"}>{r.renamed ? "Renamed for store" : "Ready"}</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PField>
      )}
    </>
  );
}

// ---------------- opening stock by location ----------------

function OpeningImport({ view, onDone, setError, setSubmit }) {
  const ledger = view.ledger;
  const [file, setFile] = useState(null);
  const [checked, setChecked] = useState(null);

  const bySku = useMemo(() => {
    const map = {};
    view.tracked.forEach((r) => { if (r.product.sku_id) map[String(r.product.sku_id).trim().toUpperCase()] = r; });
    return map;
  }, [view.tracked]);
  const locationByName = useMemo(() => {
    const map = {};
    ledger.locations.forEach((l) => { map[l.name.trim().toLowerCase()] = l; });
    return map;
  }, [ledger.locations]);

  const downloadTemplate = () => {
    const rows = [];
    view.tracked.forEach((r) => {
      const p = ledger.placementById[r.id];
      if (!p || !p.unassigned) return;
      if (r.type === TYPE_CUSTOM) {
        rows.push({ sku_id: r.product.sku_id, design: r.product.name, size: r.stock.sizes[0] || "", unassigned_now: p.unassigned, location: "", units: "" });
      } else {
        sortSizes(Object.keys(p.unassignedBySize)).forEach((s) => rows.push({
          sku_id: r.product.sku_id, design: r.product.name, size: s, unassigned_now: p.unassignedBySize[s], location: "", units: "",
        }));
      }
    });
    downloadCsv(`opening-stock-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(OPENING_COLUMNS, rows));
  };

  const check = (f) => {
    setFile(f);
    setError("");
    try {
      const { headers, data } = parseCsv(f.text);
      const missing = ["sku_id", "size", "location", "units"].filter((h) => !headers.includes(h));
      if (missing.length) throw new Error(`The file is missing: ${missing.join(", ")}. Download the template for the expected columns.`);
      const used = {}; // key → units requested so far in this file
      const rows = data
        .filter((raw) => String(raw.location || "").trim() || String(raw.units || "").trim())
        .map((raw, i) => {
          const errors = [];
          const row = bySku[String(raw.sku_id || "").trim().toUpperCase()];
          const location = locationByName[String(raw.location || "").trim().toLowerCase()];
          const units = Number(String(raw.units || "").trim());
          let size = String(raw.size || "").trim();
          if (!row) errors.push(`SKU ${raw.sku_id || "(empty)"} is not a tracked design.`);
          if (!location) errors.push(`No location called "${raw.location || ""}".`);
          if (!Number.isInteger(units) || units <= 0) errors.push("Units must be a whole number above zero.");
          let key = null;
          if (row) {
            const p = ledger.placementById[row.id];
            if (row.type === TYPE_LXRTS) {
              const match = row.stock.sizes.find((s) => s.toUpperCase() === size.toUpperCase());
              if (!match) errors.push(`${row.product.name} has no size "${size}".`);
              else size = match;
              key = `${row.id}|${size}`;
              const free = p?.unassignedBySize[size] || 0;
              if (match && Number.isInteger(units) && (used[key] || 0) + units > free) errors.push(`Only ${free} unassigned in size ${sizeLabel(size)}.`);
            } else {
              key = row.id;
              const free = p?.unassigned || 0;
              if (Number.isInteger(units) && (used[key] || 0) + units > free) errors.push(`Only ${free} unassigned for this design.`);
            }
            if (!errors.length) used[key] = (used[key] || 0) + units;
          }
          return { line: i + 2, raw, row, location, size, units, errors };
        });
      if (!rows.length) throw new Error("No rows have a location and units filled in.");
      setChecked(rows);
    } catch (e) {
      setChecked(null);
      setError(e.message);
    }
  };

  const valid = (checked || []).filter((r) => !r.errors.length);
  const groups = useMemo(() => {
    const g = {};
    valid.forEach((r) => { (g[r.location.id] || (g[r.location.id] = { location: r.location, lines: [] })).lines.push(r); });
    return Object.values(g);
  }, [valid]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setSubmit({
    label: valid.length ? `Place ${formatUnits(valid.reduce((a, r) => a + r.units, 0))} Units` : "Place Stock",
    disabled: !valid.length,
    run: async () => {
      const done = [];
      const failed = [];
      for (const g of groups) {
        try {
          await placeStock({
            requestId: newRequestId(), locationId: g.location.id, note: `Opening stock import (${file?.name || "CSV"})`,
            lines: g.lines.map((r) => ({ productId: r.row.id, size: r.size, qty: r.units })),
          });
          done.push(g.location.name);
        } catch (e) {
          failed.push(`${g.location.name}: ${e.message}`);
        }
      }
      onDone({
        text: failed.length
          ? `Placed stock in ${done.length ? done.join(", ") : "no location"}. Not placed — ${failed.join(" · ")}`
          : `Opening stock placed in ${done.join(", ")}.`,
        tone: failed.length ? "crit" : "ok",
      });
    },
  }));

  return (
    <>
      <FormSection title="Choose File"
        note="The template lists every design and size with unassigned units. Fill in location (the name as on the Locations screen) and units; copy a row to split a size." />
      <PField label="CSV File"
        actions={(
          <button type="button" className="sr-linkbtn" onClick={downloadTemplate} disabled={!ledger.totals.unassignedUnits}>
            Download Template ({formatUnits(ledger.totals.unassignedUnits)} unassigned units)
          </button>
        )}>
        <DropZone file={file} rows={checked ? checked.length : null} onFile={check} hint="or drag it here · use the downloaded template"
          onClear={() => { setFile(null); setChecked(null); setError(""); }} />
      </PField>
      {checked && (
        <PField label="Preview"
          actions={<span className="sr-help" style={{ marginTop: 0 }}>{valid.length} of {checked.length} rows will be placed across {groups.length} location{groups.length === 1 ? "" : "s"}</span>}>
          <div className="sr-grid-scroll" style={{ maxHeight: 420, overflowY: "auto" }}>
            <table className="sr-grid-table">
              <thead><tr><th>Row</th><th>Design</th><th>Size</th><th>Location</th><th className="n">Units</th><th>Status</th></tr></thead>
              <tbody>
                {checked.map((r) => (
                  <tr key={r.line} className={r.errors.length ? "is-off" : undefined}>
                    <td className="sr-g-size">{r.line}</td>
                    <td>{r.row?.product.name || r.raw.sku_id}</td>
                    <td>{r.size ? sizeLabel(r.size) : "—"}</td>
                    <td>{r.location?.name || r.raw.location}</td>
                    <td className="n">{r.raw.units}</td>
                    <td>{r.errors.length ? <Badge tone="crit">{r.errors[0]}</Badge> : <Badge tone="ok">Ready</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PField>
      )}
    </>
  );
}

export default function ProductImport({ mode: initialMode = "products", view, onClose, onDone }) {
  const [mode, setMode] = useState(initialMode);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submitRef = useRef({ label: "Import", disabled: true, run: null });
  const [, force] = useState(0);

  // Children report their submit button without re-rendering the parent in a loop.
  const setSubmit = (next) => {
    const cur = submitRef.current;
    if (cur.label !== next.label || cur.disabled !== next.disabled) {
      submitRef.current = next;
      Promise.resolve().then(() => force((n) => n + 1));
    } else {
      submitRef.current.run = next.run;
    }
  };

  const run = async () => {
    if (!submitRef.current.run) return;
    setSubmitting(true);
    setError("");
    try {
      await submitRef.current.run();
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  const ledgerReady = view.ledger?.installed;

  const switchMode = (next) => {
    setMode(next);
    setError("");
    submitRef.current = { label: next === "products" ? "Import Valid Rows" : "Place Stock", disabled: true, run: null };
  };

  return (
    <FormModal title={mode === "products" ? "Import Products" : "Import Opening Stock"} submitInHead width={1280}
      sub={mode === "products"
        ? "Every row is checked before anything is written. Nothing imports until the whole file has been read."
        : "Place unassigned stock into locations in bulk. Every row is checked first."}
      onClose={onClose} onSubmit={run} submitLabel={submitRef.current.label}
      disabled={submitRef.current.disabled} submitting={submitting} error={error}>
      {ledgerReady && (
        <div style={{ marginBottom: 18 }}>
          <Seg label="What to import" value={mode} onChange={switchMode}
            options={[{ value: "products", label: "New Products" }, { value: "opening", label: "Opening Stock by Location" }]} />
        </div>
      )}
      {mode === "products"
        ? <ProductsImport key="products" onDone={onDone} setError={setError} setSubmit={setSubmit} />
        : <OpeningImport key="opening" view={view} onDone={onDone} setError={setError} setSubmit={setSubmit} />}
    </FormModal>
  );
}
