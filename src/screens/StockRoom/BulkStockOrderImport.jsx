import React, { useEffect, useMemo, useState } from "react";
import { FormModal, Badge } from "./StockRoomUi";
import { DropZone } from "./ProductFormUi";
import { loadBulkOrderOptions, bulkCreateStockOrders, newRequestId } from "./stockRoomData";
import { parseCsv, buildCsv, downloadCsv } from "../../components/AddProduct/csvHelpers";
import {
  BULK_COLUMNS, ERROR_COLUMNS, SUMMARY_COLUMNS, REFERENCE_COLUMNS,
  validateBulkFile, toRpcOrders, errorRows, summaryRows, referenceRows, templateRows,
  sizesForProduct, MAX_UNITS_PER_ORDER, MAX_ORDERS_PER_FILE, MAX_LINES_PER_FILE,
} from "./bulkStockOrders";

// ============================================================
// Stock Room — raise many stock orders from one CSV.
//
// Upload → preview every row → create. The preview is a courtesy: the database
// function re-checks every rule when it writes (bulkStockOrders.js explains
// them). Nothing here is guessed or auto-corrected; a value that does not match
// exactly fails its order and comes back in the errors file.
//
// Two files go back to the user: what was created (with the order number on
// every line) and what failed (their own rows, plus the reason).
// ============================================================

// "Today" in IST, so a delivery date typed in India is not called past-dated by
// a browser clock somewhere else.
const istToday = () => {
  const now = new Date();
  return new Date(now.getTime() + (5.5 * 60 * 60 * 1000)).toISOString().slice(0, 10);
};

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

// SHA-256 of the file's text, so the batch record can say "this exact file was
// already imported". Hashing is not available on an insecure origin, so a
// missing hash is fine — the batch simply cannot warn about a repeat.
const hashFile = async (text) => {
  try {
    const bytes = new TextEncoder().encode(text);
    const digest = await window.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
};

export default function BulkStockOrderImport({ view, user, onClose, onDone }) {
  const [options, setOptions] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [file, setFile] = useState(null);
  const [checked, setChecked] = useState(null);     // validateBulkFile result
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);       // what came back

  useEffect(() => {
    let alive = true;
    loadBulkOrderOptions()
      .then((o) => { if (alive) setOptions(o); })
      .catch((e) => { if (alive) setLoadError(e.message); });
    return () => { alive = false; };
  }, []);

  // The catalogue rows already on screen, plus each LXRTS design's real sizes.
  const ctx = useMemo(() => {
    if (!options) return null;
    const rows = (view?.rows || []).map((r) => ({
      product: r.product,
      variantSizes: (view.variantsByProduct?.[r.id] || []).map((v) => v.size).filter(Boolean),
    }));
    return { ...options, rows, today: istToday() };
  }, [options, view]);

  const check = async (f) => {
    setFile(f);
    setChecked(null);
    setError("");
    setResult(null);
    if (!ctx) return;
    setChecking(true);
    try {
      const parsed = parseCsv(f.text);
      setChecked(validateBulkFile(parsed, ctx));
      setFile({ ...f, hash: await hashFile(f.text) });
    } catch (e) {
      setError(e.message || "That file could not be read.");
    } finally {
      setChecking(false);
    }
  };

  const downloadTemplate = () => {
    const first = (ctx?.rows || [])[0];
    const sizes = first ? sizesForProduct(first) : [];
    downloadCsv("bulk-stock-orders-template.csv", buildCsv(BULK_COLUMNS, templateRows({
      sku: first?.product?.sku_id,
      size: sizes[0] || "",
      color: ctx?.colors?.[0]?.name,
      head: ctx?.heads?.[0]?.name,
      date: ctx?.today,
    })));
  };

  const downloadReference = () =>
    downloadCsv("bulk-stock-orders-reference.csv", buildCsv(REFERENCE_COLUMNS, referenceRows(ctx)));

  const downloadErrors = (failures) =>
    downloadCsv(`bulk-stock-orders-failed-${stamp()}.csv`, buildCsv(ERROR_COLUMNS, errorRows(failures)));

  const create = async () => {
    if (!checked?.orders?.length) return;
    setSubmitting(true);
    setError("");
    try {
      // The request id is minted once per attempt: if the answer is lost on the
      // way back, the same id replays the result instead of raising it all again.
      const requestId = newRequestId();
      const res = await bulkCreateStockOrders({
        requestId,
        file: { name: file?.name, hash: file?.hash },
        orders: toRpcOrders(checked.orders),
      });

      const created = res?.created || [];
      const serverFailed = res?.failed || [];
      const meta = {
        batch_id: res?.batch_id || "",
        created_at: new Date().toISOString(),
        created_by: user?.email || "",
      };

      // The summary downloads straight away — it is the record of the run.
      if (created.length) {
        downloadCsv(`bulk-stock-orders-${stamp()}.csv`,
          buildCsv(SUMMARY_COLUMNS, summaryRows(created, checked.orders, meta)));
      }

      setResult({ created, serverFailed, meta });
    } catch (e) {
      setError(e.message || "The orders could not be raised.");
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------- what the modal shows ----------------

  const counts = checked?.counts;
  const canCreate = !!checked?.orders?.length && !result;

  const submit = result
    ? { label: "Done", run: async () => onDone({ text: doneText(result), tone: result.serverFailed.length ? "warn" : "ok" }) }
    : { label: counts?.orders ? `Create ${counts.orders} Order${counts.orders === 1 ? "" : "s"}` : "Create Orders", run: create };

  return (
    <FormModal
      title="Bulk Stock Orders"
      sub="One row per line, grouped into orders by order_ref. Every value must match exactly — nothing is guessed."
      onClose={onClose}
      onSubmit={submit.run}
      submitLabel={submit.label}
      submitting={submitting}
      disabled={!result && !canCreate}
      error={error || loadError}
      width={1040}
    >
      {!result && (
        <>
          <div className="sr-bulk-actions">
            <button type="button" className="sr-linkbtn" onClick={downloadTemplate} disabled={!ctx}>Download template</button>
            <button type="button" className="sr-linkbtn" onClick={downloadReference} disabled={!ctx}>Download reference list</button>
            <span className="sr-bulk-hint">
              Up to {MAX_LINES_PER_FILE} lines and {MAX_ORDERS_PER_FILE} orders per file · {MAX_UNITS_PER_ORDER} units per order
            </span>
          </div>

          <DropZone
            file={file}
            onFile={check}
            onClear={() => { setFile(null); setChecked(null); setError(""); }}
            rows={checked ? checked.counts.rows : null}
            hint="or drag it here · the header row must match the template"
          />

          {checking && <p className="sr-help">Checking the file…</p>}

          {checked?.fileErrors?.length > 0 && (
            <div className="sr-bulk-file-errors">
              {checked.fileErrors.map((e) => <p key={e}>{e}</p>)}
            </div>
          )}

          {checked && !checked.fileErrors.length && (
            <>
              <p className="sr-bulk-summary">
                <b>{counts.rows} row{counts.rows === 1 ? "" : "s"}</b> → {counts.orders} order{counts.orders === 1 ? "" : "s"},{" "}
                {counts.lines} line{counts.lines === 1 ? "" : "s"}, {counts.units} unit{counts.units === 1 ? "" : "s"}
                {counts.failedRows > 0 && (
                  <> · <span className="sr-bulk-bad">{counts.failedRows} row{counts.failedRows === 1 ? "" : "s"} need fixing
                    ({counts.failedOrders} order{counts.failedOrders === 1 ? "" : "s"} will not be created)</span></>
                )}
              </p>

              {checked.failures.length > 0 && (
                <div className="sr-bulk-errors">
                  <div className="sr-bulk-errors-head">
                    <b>Rows that will not be created</b>
                    <button type="button" className="sr-linkbtn" onClick={() => downloadErrors(checked.failures)}>
                      Download failed rows
                    </button>
                  </div>
                  <div className="sr-grid-scroll" style={{ maxHeight: 320, overflowY: "auto" }}>
                    <table className="sr-grid-table">
                      <thead><tr><th>Row</th><th>SKU</th><th>Order</th><th>Why</th></tr></thead>
                      <tbody>
                        {checked.failures.slice(0, 50).map((f) => (
                          <tr key={f.row}>
                            <td>{f.row}</td>
                            <td>{f.raw.sku_id || f.raw.design || "—"}</td>
                            <td>{f.raw.order_ref || "—"}</td>
                            <td className="sr-bulk-why">{f.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {checked.failures.length > 50 && (
                    <p className="sr-help">Showing the first 50. The file has them all.</p>
                  )}
                </div>
              )}

              {checked.orders.length > 0 && (
                <div className="sr-grid-scroll" style={{ maxHeight: 320, overflowY: "auto" }}>
                  <table className="sr-grid-table">
                    <thead>
                      <tr><th>Order</th><th>Channel</th><th>Head</th><th>Lines</th><th>Units</th><th>Due</th></tr>
                    </thead>
                    <tbody>
                      {checked.orders.map((o, i) => (
                        <tr key={`${o.order_ref || "row"}-${i}`}>
                          <td>{o.order_ref || <span className="sr-muted">single line</span>}</td>
                          <td><Badge tone={o.channel === "b2b" ? "info" : "gold"}>{o.channel}</Badge></td>
                          <td>{o.production_head || <span className="sr-muted">by channel</span>}</td>
                          <td>{o.lines.length}</td>
                          <td>{o.lines.reduce((n, l) => n + l.quantity, 0)}</td>
                          <td>{o.lines.map((l) => l.delivery_date).sort()[0]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

      {result && (
        <div className="sr-bulk-done">
          <p className="sr-bulk-summary">
            <b>{result.created.length} order{result.created.length === 1 ? "" : "s"} created.</b>{" "}
            The summary file has downloaded, with the order number on every line.
          </p>

          {result.created.length > 0 && (
            <div className="sr-grid-scroll" style={{ maxHeight: 320, overflowY: "auto" }}>
              <table className="sr-grid-table">
                <thead><tr><th>Order no</th><th>Reference</th><th>Units</th><th>Pieces</th></tr></thead>
                <tbody>
                  {result.created.map((c) => (
                    <tr key={c.order_no}>
                      <td>{c.order_no}</td>
                      <td>{c.order_ref || <span className="sr-muted">single line</span>}</td>
                      <td>{c.units}</td>
                      <td>{(c.barcodes || []).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.serverFailed.length > 0 && (
            <div className="sr-bulk-errors">
              <div className="sr-bulk-errors-head">
                <b>{result.serverFailed.length} order{result.serverFailed.length === 1 ? "" : "s"} were refused when writing</b>
              </div>
              <ul className="sr-bulk-server-failed">
                {result.serverFailed.map((f, i) => (
                  <li key={i}><b>{f.order_ref || "single line"}</b>: {f.error}</li>
                ))}
              </ul>
              <p className="sr-help">
                These were checked again as they were written and did not pass. Nothing was left half-created — fix the
                rows and upload them again.
              </p>
            </div>
          )}
        </div>
      )}
    </FormModal>
  );
}

function doneText(result) {
  const made = result.created.length;
  const failed = result.serverFailed.length;
  return `${made} stock order${made === 1 ? "" : "s"} created${failed ? `; ${failed} refused` : ""}.`;
}
