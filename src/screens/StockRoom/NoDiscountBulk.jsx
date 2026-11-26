import React, { useMemo, useState } from "react";
import { FormModal } from "./StockRoomUi";
import { FormSection } from "./ProductFormUi";
import { formatUnits } from "./stockRoomModel";
import { setNoDiscountAmounts } from "./stockRoomData";
import { buildCsv, downloadCsv, parseCsv } from "../../components/AddProduct/csvHelpers";

// ============================================================
// Update no-discount amounts in bulk (Release 39). The amount is the part of a
// design's price that % discount codes leave out, e.g. a dupatta or potli
// charge. A CSV of sku_id + no_discount_amount; nothing else on the design
// changes. Applies to new orders only.
// ============================================================

const COLUMNS = ["sku_id", "name", "retail_price", "no_discount_amount"];

export default function NoDiscountBulk({ view, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null); // [{ row, amount, error }]
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const bySku = useMemo(() => {
    const m = {};
    view.rows.forEach((r) => { if (r.product.sku_id) m[String(r.product.sku_id).trim().toUpperCase()] = r; });
    return m;
  }, [view.rows]);

  // The current amounts of every design that has one, plus the column layout.
  const downloadCurrent = () => {
    const data = view.rows
      .filter((r) => Number(r.product.discount_exempt_amount) > 0)
      .map((r) => ({ sku_id: r.product.sku_id, name: r.product.name, retail_price: r.product.base_price, no_discount_amount: Math.round(Number(r.product.discount_exempt_amount)) }));
    downloadCsv(`no-discount-amounts-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(COLUMNS, data.length ? data : [{ sku_id: "SKU-1733", name: "", retail_price: "", no_discount_amount: 4500 }]));
  };

  const read = async (f) => {
    setError(""); setRows(null); setFile(f);
    if (!f) return;
    const { headers, data } = parseCsv(await f.text());
    const missing = ["sku_id", "no_discount_amount"].filter((h) => !headers.includes(h));
    if (missing.length) { setError(`The file needs the column${missing.length > 1 ? "s" : ""} ${missing.join(" and ")}.`); return; }
    const seen = new Set();
    setRows(data.map((d) => {
      const sku = String(d.sku_id || "").trim().toUpperCase();
      const row = bySku[sku];
      const raw = String(d.no_discount_amount ?? "").replace(/[₹,\s]/g, "");
      const amount = raw === "" ? 0 : Number(raw);
      let err = "";
      if (!sku) err = "No SKU.";
      else if (!row) err = `${sku} is not a live design.`;
      else if (seen.has(sku)) err = `${sku} is listed twice.`;
      else if (!Number.isInteger(amount) || amount < 0) err = "Amount must be a whole number of rupees, 0 or more.";
      else if (amount >= Number(row.product.base_price || 0)) err = `Amount must be less than the price (₹${Math.round(Number(row.product.base_price || 0)).toLocaleString("en-IN")}).`;
      seen.add(sku);
      return { sku, row, amount, error: err, changed: row ? Math.round(Number(row.product.discount_exempt_amount) || 0) !== amount : false };
    }));
  };

  const valid = (rows || []).filter((r) => !r.error && r.changed);
  const bad = (rows || []).filter((r) => r.error);

  const submit = async () => {
    if (!rows) { setError("Choose a CSV file first."); return; }
    if (!valid.length) { setError(bad.length ? "Fix the rows with problems first." : "Nothing to change: every amount is already set."); return; }
    setSubmitting(true); setError("");
    const res = await setNoDiscountAmounts(valid.map((r) => ({ id: r.row.id, amount: r.amount })));
    if (res.failed.length) { setError(`${res.saved} saved; ${res.failed.length} failed: ${res.failed[0]}`); setSubmitting(false); return; }
    onDone({ text: `No-discount amount updated on ${formatUnits(res.saved)} design${res.saved === 1 ? "" : "s"}.`, tone: "ok" });
  };

  return (
    <FormModal title="Update No-Discount Amounts" sub="The part of a design's price that % discount codes leave out, e.g. a dupatta or potli charge. Applies to new orders; clients never see it."
      onClose={onClose} onSubmit={submit} submitLabel={valid.length ? `Update ${formatUnits(valid.length)} design${valid.length === 1 ? "" : "s"}` : "Update"}
      submitting={submitting} error={error} width={880} submitInHead>
      <FormSection title="1. Get the file" note="Columns: sku_id and no_discount_amount (name and retail_price are only for reference). Use 0 to remove an amount." />
      <button type="button" className="sr-btn" onClick={downloadCurrent}>Download current amounts</button>

      <FormSection title="2. Upload it" />
      <input type="file" accept=".csv,text/csv" onChange={(e) => read(e.target.files?.[0] || null)} aria-label="CSV file" />
      {file && rows && (
        <p className="sr-note" style={{ marginTop: 10 }}>
          {formatUnits(rows.length)} rows · <b>{formatUnits(valid.length)}</b> to change · {formatUnits(rows.length - valid.length - bad.length)} already set · {formatUnits(bad.length)} with problems
        </p>
      )}
      {rows && rows.length > 0 && (
        <div className="sr-scroller" style={{ maxHeight: 340 }}>
          <table className="sr-table">
            <thead><tr><th>SKU</th><th>Design</th><th className="n">Price</th><th className="n">Now</th><th className="n">New</th><th>Note</th></tr></thead>
            <tbody>
              {rows.slice(0, 300).map((r, i) => (
                <tr key={`${r.sku}-${i}`}>
                  <td className="sr-mono">{r.sku || "—"}</td>
                  <td>{r.row?.product.name || "—"}</td>
                  <td className="n">{r.row ? `₹${Math.round(Number(r.row.product.base_price || 0)).toLocaleString("en-IN")}` : "—"}</td>
                  <td className="n">{r.row ? `₹${Math.round(Number(r.row.product.discount_exempt_amount) || 0).toLocaleString("en-IN")}` : "—"}</td>
                  <td className="n">₹{Number.isFinite(r.amount) ? r.amount.toLocaleString("en-IN") : "?"}</td>
                  <td className={r.error ? "sr-neg" : undefined} style={{ whiteSpace: "normal" }}>{r.error || (r.changed ? "Will change" : "Already set")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FormModal>
  );
}
