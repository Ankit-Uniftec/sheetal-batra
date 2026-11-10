import React, { useCallback, useEffect, useMemo, useState } from "react";
import formatDate from "../utils/formatDate";
import formatIndianNumber from "../utils/formatIndianNumber";
import downloadCsv from "../utils/downloadCsv";
import { fetchDispatchReport } from "../utils/dispatchReport";
import "./DispatchReport.css";

// Dispatch report (open point #11) — every box dispatched in the period, one
// row per box, refreshed every minute while open, printable on A4. Shared by
// the Packaging and Production Manager dashboards. Read-only.
//
// hideMoney: production dashboards show no money and no client contact
// details, so the address, pincode, phone, box value, to-collect and payment
// columns are left out of the table, the CSV and the printout.

const REFRESH_MS = 60 * 1000;

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const toInput = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "");
const money = (n) => (n == null ? "—" : `₹${formatIndianNumber(Math.round(n))}`);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function rangeFor(preset, from, to) {
  const today = startOfDay(new Date());
  if (preset === "yesterday") return [addDays(today, -1), today];
  if (preset === "7d") return [addDays(today, -6), addDays(today, 1)];
  if (preset === "custom" && from && to) return [startOfDay(new Date(from)), addDays(startOfDay(new Date(to)), 1)];
  return [today, addDays(today, 1)];
}

// Columns (by position in ALL_HEADERS) left out when hideMoney is on.
const MONEY_OR_CONTACT = new Set([7, 8, 9, 10, 11]);

export default function DispatchReport({ hideMoney = false }) {
  const [preset, setPreset] = useState("today");
  const [from, setFrom] = useState(toInput(new Date()));
  const [to, setTo] = useState(toInput(new Date()));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [channel, setChannel] = useState("all");
  const [courier, setCourier] = useState("all");
  const [q, setQ] = useState("");
  // Release 34: tick boxes to print / export only some rows (none ticked = all shown).
  const [picked, setPicked] = useState(() => new Set());

  const [start, end] = useMemo(() => rangeFor(preset, from, to), [preset, from, to]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const data = await fetchDispatchReport(start.toISOString(), end.toISOString());
      setRows(data);
      setError("");
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  // Live: reload on period change and every minute while the tab is open.
  useEffect(() => {
    load();
    const iv = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(iv);
  }, [load]);

  const channels = useMemo(() => [...new Set(rows.map((r) => r.channel).filter(Boolean))].sort(), [rows]);
  const couriers = useMemo(() => [...new Set(rows.map((r) => r.courier).filter(Boolean))].sort(), [rows]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) =>
      (channel === "all" || r.channel === channel) &&
      (courier === "all" || r.courier === courier) &&
      (!s || [r.orderNo, r.box, r.name, r.pincode, r.awb, ...r.products].some((x) => String(x || "").toLowerCase().includes(s))));
  }, [rows, channel, courier, q]);

  // Ticked rows that are still on screen (a filter can hide a ticked row).
  const pickedShown = useMemo(() => shown.filter((r) => picked.has(r.shipmentId)), [shown, picked]);
  const output = pickedShown.length ? pickedShown : shown;
  const allTicked = shown.length > 0 && pickedShown.length === shown.length;
  const toggleRow = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setPicked(allTicked ? new Set() : new Set(shown.map((r) => r.shipmentId)));

  const sumOf = (list) => ({
    boxes: list.length,
    orders: new Set(list.map((r) => r.orderId)).size,
    value: list.reduce((s, r) => s + (r.boxValue || 0), 0),
    collect: list.reduce((s, r) => s + (r.toCollect || 0), 0),
  });
  const totals = useMemo(() => sumOf(shown), [shown]);

  const periodText = preset === "today" ? `Today, ${formatDate(start)}`
    : preset === "yesterday" ? `Yesterday, ${formatDate(start)}`
    : `${formatDate(start)} – ${formatDate(addDays(end, -1))}`;

  const ALL_HEADERS = ["Box", "Order No", "Order details", "Order date", "Delivery date", "Dispatched", "Name", "Delivery address", "Pincode", "Box value", "To collect", "Mode of payment", "Courier / AWB"];
  const keep = (_, i) => !hideMoney || !MONEY_OR_CONTACT.has(i);
  const HEADERS = ALL_HEADERS.filter(keep);
  const allCells = (r) => [
    r.box + (r.part ? ` (${r.part})` : ""),
    r.orderNo,
    `${r.products.join("; ")}${r.pieces.length ? ` — ${r.pieces.length} piece${r.pieces.length === 1 ? "" : "s"}` : ""}`,
    r.orderDate ? formatDate(r.orderDate) : "",
    r.deliveryDate ? formatDate(r.deliveryDate) : "",
    r.dispatchedAt ? `${formatDate(r.dispatchedAt)} ${time(r.dispatchedAt)}` : "",
    r.name,
    r.store ? `${r.store}, ${r.address}` : r.address,
    r.pincode,
    money(r.boxValue),
    money(r.toCollect),
    r.paymentMode,
    [r.courier, r.awb].filter(Boolean).join(" · "),
  ];
  const cells = (r) => allCells(r).filter(keep);

  const exportCsv = () => downloadCsv({
    filename: `dispatch_report_${toInput(start)}`,
    headers: HEADERS,
    rows: output.map(cells),
  });

  // A clean A4 sheet in its own window: just the report, nothing of the dashboard.
  const print = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    const t = sumOf(output);
    const summary = [
      ["Period", periodText],
      ["Boxes", String(t.boxes)],
      ["Orders", String(t.orders)],
      ...(hideMoney ? [] : [["Box value", money(t.value)], ["To collect", money(t.collect)]]),
      ...(channel !== "all" ? [["Channel", channel]] : []),
      ...(courier !== "all" ? [["Courier", courier]] : []),
      ...(pickedShown.length ? [["Rows", `${pickedShown.length} selected of ${shown.length}`]] : []),
      ["Printed", new Date().toLocaleString("en-IN")],
    ];
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Dispatch report — ${esc(periodText)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: Arial, sans-serif; font-size: 10px; color: #222; }
  h1 { font-size: 16px; margin: 0 0 4px; } .meta { margin-bottom: 8px; color: #555; }
  table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #ccc; padding: 4px; text-align: center; vertical-align: middle; }
  th { background: #f3eedf; } td.n { white-space: nowrap; }
  tfoot td { font-weight: bold; background: #faf8f2; }
  table.sum { width: auto; margin-bottom: 10px; } table.sum th { text-align: center; font-weight: bold; } table.sum td { font-weight: bold; }
</style></head><body>
<h1>Sheetal Batra — Dispatch report</h1>
<table class="sum"><tr>${summary.map(([k]) => `<th>${esc(k)}</th>`).join("")}</tr><tr>${summary.map(([, v]) => `<td>${esc(v)}</td>`).join("")}</tr></table>
<table><thead><tr>${HEADERS.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>
${output.map((r) => `<tr>${cells(r).map((c, i) => `<td${!hideMoney && (i === 9 || i === 10) ? ' class="n"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("\n")}
</tbody>${hideMoney ? "" : `<tfoot><tr><td colspan="9">Total</td><td class="n">${esc(money(t.value))}</td><td class="n">${esc(money(t.collect))}</td><td colspan="2"></td></tr></tfoot>`}</table>
<script>window.onload = function () { window.print(); };</script>
</body></html>`);
    w.document.close();
  };

  return (
    <div className="dr-wrap">
      <div className="dr-toolbar">
        <div className="dr-presets">
          {[["today", "Today"], ["yesterday", "Yesterday"], ["7d", "Last 7 days"], ["custom", "Custom"]].map(([k, l]) => (
            <button key={k} type="button" className={preset === k ? "on" : ""} onClick={() => setPreset(k)}>{l}</button>
          ))}
          {preset === "custom" && (
            <span className="dr-custom">
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
              <span>to</span>
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </span>
          )}
        </div>
        <div className="dr-filters">
          <select value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="all">All channels</option>
            {channels.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={courier} onChange={(e) => setCourier(e.target.value)}>
            <option value="all">All couriers</option>
            {couriers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="search" placeholder={hideMoney ? "Order no, box, name, AWB…" : "Order no, box, name, pincode, AWB…"} value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="button" onClick={() => load()} disabled={loading}>Refresh</button>
          <button type="button" onClick={exportCsv} disabled={!shown.length}>⬇ CSV{pickedShown.length ? ` (${pickedShown.length})` : ""}</button>
          <button type="button" className="primary" onClick={print} disabled={!shown.length}>
            🖨 {pickedShown.length ? `Print selected (${pickedShown.length})` : "Print all"}
          </button>
        </div>
      </div>

      <div className="dr-summary">
        <span><b>{totals.boxes}</b> box{totals.boxes === 1 ? "" : "es"}</span>
        <span><b>{totals.orders}</b> order{totals.orders === 1 ? "" : "s"}</span>
        {!hideMoney && <span>Box value <b>{money(totals.value)}</b></span>}
        {!hideMoney && <span>To collect <b>{money(totals.collect)}</b></span>}
        <span className="dr-muted">{periodText}{updatedAt ? ` · updated ${time(updatedAt)} (auto every minute)` : ""}</span>
        {pickedShown.length > 0 && (
          <span className="dr-picked">{pickedShown.length} selected <button type="button" onClick={() => setPicked(new Set())}>Clear</button></span>
        )}
      </div>

      {error && <div className="dr-error">Could not load the report: {error}</div>}

      {loading && !rows.length ? (
        <div className="dr-empty">Loading dispatches…</div>
      ) : !shown.length ? (
        <div className="dr-empty">No boxes dispatched in this period.</div>
      ) : (
        <div className="dr-table-wrap">
          <table className="dr-table">
            <thead><tr>
              <th className="dr-check"><input type="checkbox" checked={allTicked} onChange={toggleAll} aria-label="Select all rows" /></th>
              {HEADERS.map((h) => <th key={h}>{h}</th>)}
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.shipmentId} className={picked.has(r.shipmentId) ? "dr-row-on" : ""}>
                  <td className="dr-check"><input type="checkbox" checked={picked.has(r.shipmentId)} onChange={() => toggleRow(r.shipmentId)} aria-label={`Select box ${r.box || r.orderNo}`} /></td>
                  <td className="dr-mono">{r.box || "—"}{r.part && <div className="dr-muted">part {r.part}</div>}</td>
                  <td className="dr-mono">{r.orderNo}<div className="dr-muted">{r.channel}</div></td>
                  <td>{r.products.join("; ") || "—"}{r.pieces.length > 0 && <div className="dr-muted">{r.pieces.join(", ")}</div>}</td>
                  <td>{r.orderDate ? formatDate(r.orderDate) : "—"}</td>
                  <td>{r.deliveryDate ? formatDate(r.deliveryDate) : "—"}</td>
                  <td>{r.dispatchedAt ? <>{formatDate(r.dispatchedAt)}<div className="dr-muted">{time(r.dispatchedAt)}</div></> : "—"}</td>
                  <td>{r.name || "—"}{!hideMoney && r.phone && <div className="dr-muted">{r.phone}</div>}{hideMoney && r.modeOfDelivery && <div className="dr-muted">{r.modeOfDelivery}</div>}</td>
                  {!hideMoney && <td>{r.store && <b>{r.store}</b>}<div>{r.address || "—"}</div>{r.modeOfDelivery && r.modeOfDelivery !== r.store && <div className="dr-muted">{r.modeOfDelivery}</div>}</td>}
                  {!hideMoney && <td>{r.pincode || "—"}</td>}
                  {!hideMoney && <td className="dr-num">{money(r.boxValue)}</td>}
                  {!hideMoney && <td className={`dr-num ${r.toCollect > 0 ? "dr-due" : ""}`}>{money(r.toCollect)}</td>}
                  {!hideMoney && <td>{r.paymentMode || "—"}</td>}
                  <td>{r.courier || "—"}{r.awb && <div className="dr-muted dr-mono">{r.awb}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
