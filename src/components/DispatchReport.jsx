import React, { useCallback, useEffect, useMemo, useState } from "react";
import formatDate from "../utils/formatDate";
import formatIndianNumber from "../utils/formatIndianNumber";
import downloadCsv from "../utils/downloadCsv";
import { fetchDispatchReport } from "../utils/dispatchReport";
import "./DispatchReport.css";

// Dispatch report (open point #11) — every box dispatched in the period, one
// row per box, refreshed every minute while open, printable on A4. Shared by
// the Packaging and Production Manager dashboards. Read-only.

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

export default function DispatchReport() {
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

  const totals = useMemo(() => ({
    boxes: shown.length,
    orders: new Set(shown.map((r) => r.orderId)).size,
    value: shown.reduce((s, r) => s + (r.boxValue || 0), 0),
    collect: shown.reduce((s, r) => s + (r.toCollect || 0), 0),
  }), [shown]);

  const periodText = preset === "today" ? `Today, ${formatDate(start)}`
    : preset === "yesterday" ? `Yesterday, ${formatDate(start)}`
    : `${formatDate(start)} – ${formatDate(addDays(end, -1))}`;

  const HEADERS = ["Box", "Order No", "Order details", "Order date", "Delivery date", "Dispatched", "Name", "Delivery address", "Pincode", "Box value", "To collect", "Mode of payment", "Courier / AWB"];
  const cells = (r) => [
    r.box + (r.part ? ` (${r.part})` : ""),
    r.orderNo,
    `${r.products.join("; ")}${r.pieces.length ? ` — ${r.pieces.length} piece${r.pieces.length === 1 ? "" : "s"}` : ""}`,
    r.orderDate ? formatDate(r.orderDate) : "",
    r.deliveryDate ? formatDate(r.deliveryDate) : "",
    r.dispatchedAt ? `${formatDate(r.dispatchedAt)} ${time(r.dispatchedAt)}` : "",
    r.name,
    r.address,
    r.pincode,
    money(r.boxValue),
    money(r.toCollect),
    r.paymentMode,
    [r.courier, r.awb].filter(Boolean).join(" · "),
  ];

  const exportCsv = () => downloadCsv({
    filename: `dispatch_report_${toInput(start)}`,
    headers: HEADERS,
    rows: shown.map(cells),
  });

  // A clean A4 sheet in its own window: just the report, nothing of the dashboard.
  const print = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Dispatch report — ${esc(periodText)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: Arial, sans-serif; font-size: 10px; color: #222; }
  h1 { font-size: 16px; margin: 0 0 4px; } .meta { margin-bottom: 8px; color: #555; }
  table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #ccc; padding: 4px; text-align: left; vertical-align: top; }
  th { background: #f3eedf; } td.n { text-align: right; white-space: nowrap; }
  tfoot td { font-weight: bold; background: #faf8f2; }
</style></head><body>
<h1>Sheetal Batra — Dispatch report</h1>
<div class="meta">${esc(periodText)} · ${totals.boxes} box${totals.boxes === 1 ? "" : "es"} · ${totals.orders} order${totals.orders === 1 ? "" : "s"}${channel !== "all" ? ` · ${esc(channel)}` : ""}${courier !== "all" ? ` · ${esc(courier)}` : ""} · printed ${esc(new Date().toLocaleString("en-IN"))}</div>
<table><thead><tr>${HEADERS.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>
${shown.map((r) => `<tr>${cells(r).map((c, i) => `<td${i === 9 || i === 10 ? ' class="n"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("\n")}
</tbody><tfoot><tr><td colspan="9">Total</td><td class="n">${esc(money(totals.value))}</td><td class="n">${esc(money(totals.collect))}</td><td colspan="2"></td></tr></tfoot></table>
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
          <input type="search" placeholder="Order no, box, name, pincode, AWB…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="button" onClick={() => load()} disabled={loading}>Refresh</button>
          <button type="button" onClick={exportCsv} disabled={!shown.length}>⬇ CSV</button>
          <button type="button" className="primary" onClick={print} disabled={!shown.length}>🖨 Print</button>
        </div>
      </div>

      <div className="dr-summary">
        <span><b>{totals.boxes}</b> box{totals.boxes === 1 ? "" : "es"}</span>
        <span><b>{totals.orders}</b> order{totals.orders === 1 ? "" : "s"}</span>
        <span>Box value <b>{money(totals.value)}</b></span>
        <span>To collect <b>{money(totals.collect)}</b></span>
        <span className="dr-muted">{periodText}{updatedAt ? ` · updated ${time(updatedAt)} (auto every minute)` : ""}</span>
      </div>

      {error && <div className="dr-error">Could not load the report: {error}</div>}

      {loading && !rows.length ? (
        <div className="dr-empty">Loading dispatches…</div>
      ) : !shown.length ? (
        <div className="dr-empty">No boxes dispatched in this period.</div>
      ) : (
        <div className="dr-table-wrap">
          <table className="dr-table">
            <thead><tr>{HEADERS.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.shipmentId}>
                  <td className="dr-mono">{r.box || "—"}{r.part && <div className="dr-muted">part {r.part}</div>}</td>
                  <td className="dr-mono">{r.orderNo}<div className="dr-muted">{r.channel}</div></td>
                  <td>{r.products.join("; ") || "—"}{r.pieces.length > 0 && <div className="dr-muted">{r.pieces.join(", ")}</div>}</td>
                  <td>{r.orderDate ? formatDate(r.orderDate) : "—"}</td>
                  <td>{r.deliveryDate ? formatDate(r.deliveryDate) : "—"}</td>
                  <td>{r.dispatchedAt ? <>{formatDate(r.dispatchedAt)}<div className="dr-muted">{time(r.dispatchedAt)}</div></> : "—"}</td>
                  <td>{r.name || "—"}{r.phone && <div className="dr-muted">{r.phone}</div>}</td>
                  <td>{r.address || "—"}{r.modeOfDelivery && <div className="dr-muted">{r.modeOfDelivery}</div>}</td>
                  <td>{r.pincode || "—"}</td>
                  <td className="dr-num">{money(r.boxValue)}</td>
                  <td className={`dr-num ${r.toCollect > 0 ? "dr-due" : ""}`}>{money(r.toCollect)}</td>
                  <td>{r.paymentMode || "—"}</td>
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
