import React, { useEffect, useMemo, useState } from "react";
import useFilterParam, { useClearFilterParams } from "../hooks/useFilterParam";
import formatDate from "../utils/formatDate";
import formatIndianNumber from "../utils/formatIndianNumber";
import downloadCsv from "../utils/downloadCsv";
import { fetchAllRowsParallel } from "../utils/fetchAllRowsParallel";
import { AGE_BUCKETS, OUTSTANDING_COLUMNS, buildOutstanding } from "../utils/outstandingAnalytics";
import "./CancellationsPanel.css";

// Outstanding balances (point #6). Read-only. Screens that already hold their
// orders pass them in (SA: their own, Store Manager: their store); without
// `orders` it loads every order with a balance (COO, CEO).
// `onOpenOrder(order)` opens a line the way that dashboard opens any order. The
// filters live in the URL, so Back from an order returns to the same list.

const money = (n) => `₹${formatIndianNumber(Math.round(n || 0))}`;
const LIST_LIMIT = 100;
const bucketLabel = (key) => AGE_BUCKETS.find((b) => b.key === key)?.label || "";
const ageText = (r) => (r.days == null ? "No date" : r.days < 0 ? `Due in ${-r.days}d` : `${r.days}d`);

function SplitTable({ title, items, onPick, picked }) {
  return (
    <div className="cx-card">
      <h4>{title}</h4>
      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#6b5842" }}>
            <th>Name</th><th style={{ textAlign: "right" }}>Orders</th>
            <th style={{ textAlign: "right" }}>Balance</th><th style={{ textAlign: "right" }}>60+ days</th>
          </tr>
        </thead>
        <tbody>
          {items.map((x) => (
            <tr key={x.key} onClick={() => onPick(picked === x.key ? "" : x.key)}
              style={{ cursor: "pointer", background: picked === x.key ? "#fff8e1" : undefined }}>
              <td style={{ padding: "4px 0" }}>{x.key}</td>
              <td style={{ textAlign: "right" }}>{x.count}</td>
              <td style={{ textAlign: "right" }}>{money(x.value)}</td>
              <td style={{ textAlign: "right" }}>{money(x.overdue60)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function OutstandingPanel({ orders = null, showSplits = true, onOpenOrder = null }) {
  const [loaded, setLoaded] = useState(null);
  const [error, setError] = useState("");
  const [sa, setSa] = useFilterParam("outSa", "");
  const [store, setStore] = useFilterParam("outStore", "");
  const [bucket, setBucket] = useFilterParam("outAge", "");
  const clearFilters = useClearFilterParams(["outSa", "outStore", "outAge"]);

  useEffect(() => {
    if (orders) return undefined;
    let cancelled = false;
    fetchAllRowsParallel("orders", (q) => q.select(OUTSTANDING_COLUMNS).gt("remaining_payment", 0).order("id"))
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) setError(err.message || "Could not load");
        else setLoaded(data || []);
      })
      .catch((err) => { if (!cancelled) setError(err.message || "Could not load"); });
    return () => { cancelled = true; };
  }, [orders]);

  const source = orders || loaded;
  const data = useMemo(() => buildOutstanding(source || []), [source]);
  const shown = useMemo(() => data.rows.filter((r) =>
    (!sa || (r.sa || "—") === sa) && (!store || (r.store || "—") === store) && (!bucket || r.bucket === bucket)
  ), [data, sa, store, bucket]);
  const shownTotal = shown.reduce((s, r) => s + r.balance, 0);

  const exportCsv = () => downloadCsv({
    filename: "outstanding_balances",
    headers: ["Order No", "Customer", "SA", "Store", "Status", "Delivery Date", "Days Past", "Age", "Total", "Paid", "Balance", "Check"],
    rows: shown.map((r) => [r.orderNo, r.customer, r.sa, r.store, r.status, r.deliveryDate ? formatDate(r.deliveryDate) : "",
      r.days ?? "", bucketLabel(r.bucket), r.total, r.paid, r.balance, r.bucket === "d60" ? "May already be collected" : ""]),
  });

  if (error) return <div className="cx-error">Could not load outstanding balances: {error}</div>;
  if (!source) return <div className="cx-empty">Loading outstanding balances…</div>;

  const old = data.buckets.find((b) => b.key === "d60");

  return (
    <div className="cx-wrap" style={{ minWidth: 0, maxWidth: "100%" }}>
      <div className="cx-kpis">
        <div className="cx-kpi">
          <span className="cx-kpi-label">Total outstanding</span>
          <span className="cx-kpi-val">{money(data.total)}</span>
          <span className="cx-delta">{data.count} orders</span>
        </div>
        {data.buckets.map((b) => (
          <div key={b.key} className="cx-kpi" role="button" tabIndex={0} style={{ cursor: "pointer", outline: bucket === b.key ? "2px solid #d5b85a" : "none" }}
            onClick={() => setBucket(bucket === b.key ? "" : b.key)}
            onKeyDown={(e) => { if (e.key === "Enter") setBucket(bucket === b.key ? "" : b.key); }}>
            <span className="cx-kpi-label">{b.label}</span>
            <span className="cx-kpi-val">{money(b.value)}</span>
            <span className="cx-delta">{b.count} orders</span>
          </div>
        ))}
      </div>

      {old.count > 0 && (
        <div style={{ background: "#fff8e1", border: "1px solid #ffe082", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
          <strong>Check: {money(old.value)} is 60+ days past delivery and may already be collected.</strong> Some older
          payments were never recorded. Please confirm each one and use Update Payment if it was received.
        </div>
      )}

      {showSplits && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
          <SplitTable title="By store" items={data.byStore} onPick={setStore} picked={store} />
          <SplitTable title="By SA" items={data.bySa} onPick={setSa} picked={sa} />
        </div>
      )}

      <div className="cx-card">
        <div className="cx-toolbar">
          <h4 style={{ margin: 0 }}>
            {shown.length} orders · {money(shownTotal)}
            {(sa || store || bucket) && (
              <button type="button" style={{ marginLeft: 10 }} onClick={clearFilters}>Clear filters</button>
            )}
          </h4>
          <div className="cx-presets"><button type="button" onClick={exportCsv} disabled={!shown.length}>Download CSV</button></div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#6b5842" }}>
                <th>Order</th><th>Customer</th><th>SA</th><th>Store</th><th>Status</th><th>Delivery</th><th>Past</th>
                <th style={{ textAlign: "right" }}>Total</th><th style={{ textAlign: "right" }}>Paid</th><th style={{ textAlign: "right" }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, LIST_LIMIT).map((r) => (
                <tr
                  key={r.id}
                  className={onOpenOrder ? "cx-row-open" : undefined}
                  style={{ borderTop: "1px solid #eee" }}
                  role={onOpenOrder ? "link" : undefined}
                  tabIndex={onOpenOrder ? 0 : undefined}
                  onClick={onOpenOrder ? () => onOpenOrder(r.order) : undefined}
                  onKeyDown={onOpenOrder ? (e) => { if (e.key === "Enter") onOpenOrder(r.order); } : undefined}
                >
                  <td style={{ padding: "4px 6px 4px 0" }}>
                    {onOpenOrder ? <span className="cx-order-link">{r.orderNo}</span> : r.orderNo}
                  </td>
                  <td>{r.customer || "—"}</td>
                  <td>{r.sa || "—"}</td>
                  <td>{r.store || "—"}</td>
                  <td>{r.status}</td>
                  <td>{r.deliveryDate ? formatDate(r.deliveryDate) : "—"}</td>
                  <td style={{ color: r.bucket === "d60" ? "#c62828" : undefined }}>{ageText(r)}</td>
                  <td style={{ textAlign: "right" }}>{money(r.total)}</td>
                  <td style={{ textAlign: "right" }}>{money(r.paid)}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{money(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length > LIST_LIMIT && (
          <div className="cx-muted" style={{ marginTop: 8 }}>Showing the oldest {LIST_LIMIT}. The CSV has all {shown.length}.</div>
        )}
        {shown.length === 0 && <div className="cx-empty">No outstanding balances here.</div>}
      </div>
    </div>
  );
}
