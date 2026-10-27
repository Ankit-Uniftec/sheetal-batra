import React, { useCallback, useEffect, useMemo, useState } from "react";
import formatDate from "../utils/formatDate";
import formatIndianNumber from "../utils/formatIndianNumber";
import downloadCsv from "../utils/downloadCsv";
import {
  fetchCancellations, buildCancellationRows, summariseCancellations, cancelledAtOf, isSaleCancellation,
} from "../utils/cancellationAnalytics";
import "./CancellationsPanel.css";

// Cancellations (open point #4) — shared by the COO, CEO and Production
// Manager dashboards. Read-only: everything comes from what a cancellation
// already saves on the order (reason, time) plus its pieces and the audit log.

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const toInput = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const money = (n) => `₹${formatIndianNumber(Math.round(n || 0))}`;
const pct = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

function rangeFor(preset, from, to) {
  const now = new Date();
  const som = new Date(now.getFullYear(), now.getMonth(), 1);
  if (preset === "last_month") return [new Date(now.getFullYear(), now.getMonth() - 1, 1), som];
  if (preset === "3m") return [new Date(now.getFullYear(), now.getMonth() - 2, 1), new Date(now.getFullYear(), now.getMonth() + 1, 1)];
  if (preset === "year") return [new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear() + 1, 0, 1)];
  if (preset === "custom" && from && to) { const e = startOfDay(new Date(to)); e.setDate(e.getDate() + 1); return [startOfDay(new Date(from)), e]; }
  return [som, new Date(now.getFullYear(), now.getMonth() + 1, 1)];
}

function Breakdown({ title, items, total, limit = 8 }) {
  const shown = items.slice(0, limit);
  const max = Math.max(1, ...shown.map((x) => x.count));
  return (
    <div className="cx-card">
      <h4>{title}</h4>
      {shown.length === 0 ? <div className="cx-muted">—</div> : shown.map((x) => (
        <div key={x.key} className="cx-bar-row" title={`${x.count} orders · ${money(x.value)}`}>
          <span className="cx-bar-label">{x.key}</span>
          <span className="cx-bar"><span style={{ width: `${(x.count / max) * 100}%` }} /></span>
          <span className="cx-bar-num">{x.count}<small> {total ? `${Math.round((x.count / total) * 100)}%` : ""}</small></span>
          <span className="cx-bar-val">{money(x.value)}</span>
        </div>
      ))}
      {items.length > limit && <div className="cx-muted">+{items.length - limit} more in the list below / CSV</div>}
    </div>
  );
}

export default function CancellationsPanel() {
  const [preset, setPreset] = useState("month");
  const [from, setFrom] = useState(toInput(new Date()));
  const [to, setTo] = useState(toInput(new Date()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [channel, setChannel] = useState("all");
  const [showAll, setShowAll] = useState(false);

  const [start, end] = useMemo(() => rangeFor(preset, from, to), [preset, from, to]);
  const days = Math.max(1, Math.round((end - start) / 864e5));
  const grain = days > 92 ? "month" : "week";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchCancellations(start.toISOString(), end.toISOString()));
      setError("");
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => (data ? buildCancellationRows(data.orders, data.components, data.whoByOrder, data.vendorNames) : []), [data]);
  const channels = useMemo(() => [...new Set(rows.map((r) => r.channel))].sort(), [rows]);
  const shownRows = useMemo(() => rows.filter((r) => channel === "all" || r.channel === channel), [rows, channel]);

  // Previous period of the same length (count + value only).
  const prevRows = useMemo(() => {
    if (!data?.allCancelled) return [];
    const ps = new Date(start.getTime() - (end - start)).toISOString();
    const pe = start.toISOString();
    return buildCancellationRows(
      data.allCancelled.filter((o) => isSaleCancellation(o) && cancelledAtOf(o) >= ps && cancelledAtOf(o) < pe), [], {}, {})
      .filter((r) => channel === "all" || r.channel === channel);
  }, [data, start, end, channel]);

  const s = useMemo(() => summariseCancellations(shownRows, prevRows, grain), [shownRows, prevRows, grain]);
  const trendMax = Math.max(1, ...s.trend.map((t) => t.count));
  const dCount = pct(s.count, s.prevCount);
  const dValue = pct(s.value, s.prevValue);

  const exportCsv = () => downloadCsv({
    filename: `cancellations_${toInput(start)}`,
    headers: ["Order No", "Channel", "Customer", "Products", "Ordered", "Cancelled", "Value", "Reason", "Stage when cancelled", "Cancelled by", "Salesperson"],
    rows: shownRows.map((r) => [r.orderNo, r.channel, r.customer, r.products.join("; "),
      r.orderedAt ? formatDate(r.orderedAt) : "", r.cancelledAt ? formatDate(r.cancelledAt) : "",
      Math.round(r.value), r.reason, r.stage, r.cancelledBy, r.salesperson]),
  });

  return (
    <div className="cx-wrap">
      <div className="cx-toolbar">
        <div className="cx-presets">
          {[["month", "This month"], ["last_month", "Last month"], ["3m", "Last 3 months"], ["year", "This year"], ["custom", "Custom"]].map(([k, l]) => (
            <button key={k} type="button" className={preset === k ? "on" : ""} onClick={() => setPreset(k)}>{l}</button>
          ))}
          {preset === "custom" && (
            <span className="cx-custom">
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
              <span>to</span>
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </span>
          )}
        </div>
        <div className="cx-presets">
          <select value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="all">All channels</option>
            {channels.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="button" onClick={load} disabled={loading}>Refresh</button>
          <button type="button" onClick={exportCsv} disabled={!shownRows.length}>⬇ CSV</button>
        </div>
      </div>

      {error && <div className="cx-error">Could not load cancellations: {error}</div>}
      {loading && !data ? <div className="cx-empty">Loading cancellations…</div> : (
        <>
          <div className="cx-kpis">
            <div className="cx-kpi">
              <span className="cx-kpi-label">Cancelled orders</span>
              <span className="cx-kpi-val">{s.count}</span>
              <span className={`cx-delta ${dCount > 0 ? "up" : dCount < 0 ? "down" : ""}`}>{dCount == null ? `previous period ${s.prevCount}` : `${dCount > 0 ? "+" : ""}${dCount}% vs previous (${s.prevCount})`}</span>
            </div>
            <div className="cx-kpi">
              <span className="cx-kpi-label">Value cancelled</span>
              <span className="cx-kpi-val">{money(s.value)}</span>
              <span className={`cx-delta ${dValue > 0 ? "up" : dValue < 0 ? "down" : ""}`}>{dValue == null ? `previous period ${money(s.prevValue)}` : `${dValue > 0 ? "+" : ""}${dValue}% vs previous (${money(s.prevValue)})`}</span>
            </div>
            <div className="cx-kpi">
              <span className="cx-kpi-label">Cancelled after production started</span>
              <span className="cx-kpi-val">{s.byStage.filter((x) => x.key !== "Before production" && x.key !== "No pieces").reduce((a, x) => a + x.count, 0)}</span>
              <span className="cx-delta">work already done on these</span>
            </div>
          </div>

          <div className="cx-card">
            <h4>Trend ({grain === "month" ? "per month" : "per week"})</h4>
            {s.trend.length === 0 ? <div className="cx-muted">No cancellations in this period.</div> : (
              <div className="cx-trend">
                {s.trend.map((t) => (
                  <div key={t.key} className="cx-trend-col" title={`${t.count} · ${money(t.value)}`}>
                    <span className="cx-trend-num">{t.count}</span>
                    <span className="cx-trend-bar" style={{ height: `${(t.count / trendMax) * 100}%` }} />
                    <span className="cx-trend-label">{grain === "month" ? t.key : formatDate(t.key).slice(0, 5)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="cx-grid">
            <Breakdown title="By channel" items={s.byChannel} total={s.count} />
            <Breakdown title="By reason" items={s.byReason} total={s.count} />
            <Breakdown title="How far it had got" items={s.byStage} total={s.count} />
            <Breakdown title="Cancelled by" items={s.byWho} total={s.count} />
          </div>

          <div className="cx-card">
            <h4>Cancelled orders ({shownRows.length})</h4>
            {shownRows.length === 0 ? <div className="cx-muted">None.</div> : (
              <div className="cx-table-wrap">
                <table className="cx-table">
                  <thead><tr><th>Order No</th><th>Customer</th><th>Ordered</th><th>Cancelled</th><th>Value</th><th>Reason</th><th>Stage</th><th>By</th></tr></thead>
                  <tbody>
                    {(showAll ? shownRows : shownRows.slice(0, 50)).map((r) => (
                      <tr key={r.id}>
                        <td className="cx-mono">{r.orderNo}<div className="cx-muted">{r.channel}</div></td>
                        <td>{r.customer || "—"}{r.products.length > 0 && <div className="cx-muted">{r.products.join("; ")}</div>}</td>
                        <td>{r.orderedAt ? formatDate(r.orderedAt) : "—"}</td>
                        <td>{r.cancelledAt ? formatDate(r.cancelledAt) : "—"}</td>
                        <td className="cx-num">{money(r.value)}</td>
                        <td>{r.reason || "—"}</td>
                        <td>{r.stage}</td>
                        <td>{r.cancelledBy || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {shownRows.length > 50 && !showAll && (
                  <button type="button" className="cx-more" onClick={() => setShowAll(true)}>Show all {shownRows.length}</button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
