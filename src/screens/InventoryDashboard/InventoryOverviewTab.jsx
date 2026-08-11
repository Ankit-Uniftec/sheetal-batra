import React, { useMemo, useState } from "react";
import { CHANNEL_KEY_LABELS, CHANNEL_SEGMENTS } from "../../utils/barcodeService";
import formatIndianNumber from "../../utils/formatIndianNumber";
import Paginator from "../../components/Paginator";
import "./InventoryOverviewTab.css";

// ============================================================
// Inventory Overview — channel-wise stock bifurcation.
//
// Reads the live per-channel balance from product_channel_stock
// (db/barcode_system/v2/72): raised when a stock order for that channel
// completes (via 71's receipt ledger), lowered when that channel sells.
//
// Presentation deliberately mirrors the Production Manager dashboard's channel
// breakdown (dot + count + proportional bar + %), so "channel-wise" looks the
// same wherever it appears in the app. The row markup is re-implemented rather
// than imported because PM's ChannelRow is a private const inside a 3000-line
// screen — extracting it is a worthwhile refactor, but not one to smuggle into
// this change.
// ============================================================

// The three stock pools, in the fixed app-wide display order. Labels and colors
// come from barcodeService so they can never drift from the rest of the app.
const POOLS = ["retail_stock", "b2b_stock", "shopify_stock"].map((key) => ({
  key,
  label: CHANNEL_KEY_LABELS[key],
  color: CHANNEL_SEGMENTS.find((s) => s.label === CHANNEL_KEY_LABELS[key])?.color || "#888",
}));

const ITEMS_PER_PAGE = 15;

// Proportional bar row — dot, label, count, bar, percentage.
function ChannelRow({ label, count, percentage, color }) {
  return (
    <div className="ivo-channel-row">
      <div className="ivo-channel-label">
        <span className="ivo-channel-dot" style={{ background: color }} />
        <span>{label}</span>
      </div>
      <div className="ivo-channel-right">
        <span className={`ivo-channel-count ${count < 0 ? "negative" : ""}`}>
          {formatIndianNumber(count)}
        </span>
        <div className="ivo-channel-bar-bg">
          <div
            className="ivo-channel-bar-fill"
            style={{ width: `${percentage}%`, background: color }}
          />
        </div>
        <span className="ivo-channel-pct">{percentage}%</span>
      </div>
    </div>
  );
}

export default function InventoryOverviewTab({ products, channelStock }) {
  const [search, setSearch] = useState("");
  const [poolFilter, setPoolFilter] = useState("all");
  const [page, setPage] = useState(1);

  // Totals per pool, plus the counts that make the numbers interpretable:
  // how many distinct products carry stock, and how many are negative.
  const totals = useMemo(() => {
    const byPool = Object.fromEntries(POOLS.map((p) => [p.key, 0]));
    const productsWithStock = Object.fromEntries(POOLS.map((p) => [p.key, 0]));
    let negatives = 0;

    Object.values(channelStock || {}).forEach((byChannel) => {
      POOLS.forEach((p) => {
        const qty = byChannel?.[p.key];
        if (qty === undefined) return;
        byPool[p.key] += qty;
        if (qty > 0) productsWithStock[p.key] += 1;
        if (qty < 0) negatives += 1;
      });
    });

    const grand = POOLS.reduce((s, p) => s + byPool[p.key], 0);
    return { byPool, productsWithStock, negatives, grand };
  }, [channelStock]);

  // Percentages are of the POSITIVE total only. A negative balance is a
  // discrepancy, not a share of stock — letting it shrink the denominator would
  // make every other channel's bar overstate itself.
  const positiveTotal = useMemo(
    () => POOLS.reduce((s, p) => s + Math.max(0, totals.byPool[p.key]), 0),
    [totals]
  );

  const pct = (n) =>
    positiveTotal > 0 ? Math.round((Math.max(0, n) / positiveTotal) * 100) : 0;

  // Per-product rows. Only products that actually carry channel stock appear —
  // showing every product with three zeroes would bury the real data.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();

    return (products || [])
      .map((p) => {
        const byChannel = channelStock?.[p.id];
        if (!byChannel) return null;

        const cells = Object.fromEntries(POOLS.map((x) => [x.key, byChannel[x.key] || 0]));
        const total = POOLS.reduce((s, x) => s + cells[x.key], 0);

        // A product whose every pool is 0 has nothing to say here.
        if (POOLS.every((x) => cells[x.key] === 0)) return null;
        if (poolFilter !== "all" && cells[poolFilter] === 0) return null;
        if (q && !(p.name?.toLowerCase().includes(q) || p.sku_id?.toLowerCase().includes(q))) {
          return null;
        }

        return { id: p.id, name: p.name, sku_id: p.sku_id, cells, total };
      })
      .filter(Boolean)
      // Negatives first — they are the rows that need attention — then by size.
      .sort((a, b) => {
        const aNeg = POOLS.some((x) => a.cells[x.key] < 0);
        const bNeg = POOLS.some((x) => b.cells[x.key] < 0);
        if (aNeg !== bNeg) return aNeg ? -1 : 1;
        return b.total - a.total;
      });
  }, [products, channelStock, search, poolFilter]);

  const totalPages = Math.ceil(rows.length / ITEMS_PER_PAGE);
  const paged = useMemo(
    () => rows.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE),
    [rows, page]
  );

  // Filter changes reset to page 1, or a narrow filter lands on an empty page.
  React.useEffect(() => { setPage(1); }, [search, poolFilter]);

  const hasAnyData = Object.keys(channelStock || {}).length > 0;

  return (
    <div className="ivo-tab">
      {/* ── Per-channel totals ── */}
      <div className="ivo-stats-grid">
        {POOLS.map((p) => (
          <div key={p.key} className="ivo-stat-card" style={{ borderTopColor: p.color }}>
            <span className="ivo-stat-label">{p.label}</span>
            <span
              className={`ivo-stat-value ${totals.byPool[p.key] < 0 ? "negative" : ""}`}
              style={{ color: totals.byPool[p.key] < 0 ? undefined : p.color }}
            >
              {formatIndianNumber(totals.byPool[p.key])}
            </span>
            <span className="ivo-stat-sub">
              {totals.productsWithStock[p.key]} product
              {totals.productsWithStock[p.key] === 1 ? "" : "s"} in stock
            </span>
          </div>
        ))}
        <div className="ivo-stat-card ivo-stat-total">
          <span className="ivo-stat-label">Total Units</span>
          <span className="ivo-stat-value">{formatIndianNumber(totals.grand)}</span>
          <span className="ivo-stat-sub">across all channels</span>
        </div>
      </div>

      {/* A negative balance means stock left a channel without a matching stock
          order, or a sale was booked against the wrong channel. Surfaced, never
          hidden — 72 permits negatives precisely so this can be seen. */}
      {totals.negatives > 0 && (
        <div className="ivo-warning">
          <strong>{totals.negatives}</strong> negative balance
          {totals.negatives === 1 ? "" : "s"} — stock sold without a matching stock
          order, or booked to the wrong channel. Shown first in the table below.
        </div>
      )}

      {/* ── Proportional split ── */}
      <div className="ivo-card">
        <h3 className="ivo-card-title">Stock Split by Channel</h3>
        {positiveTotal === 0 ? (
          <p className="ivo-empty-inline">
            {hasAnyData
              ? "No positive stock in any channel yet."
              : "No channel stock recorded yet. Complete a stock order to see it here."}
          </p>
        ) : (
          <div className="ivo-channel-list">
            {POOLS.map((p) => (
              <ChannelRow
                key={p.key}
                label={p.label}
                count={totals.byPool[p.key]}
                percentage={pct(totals.byPool[p.key])}
                color={p.color}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Per-product breakdown ── */}
      <div className="ivo-card">
        <div className="ivo-card-header">
          <h3 className="ivo-card-title">Channel Stock by Product</h3>
          <div className="ivo-toolbar">
            <input
              className="ivo-search"
              type="text"
              placeholder="Search by name or SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="ivo-select"
              value={poolFilter}
              onChange={(e) => setPoolFilter(e.target.value)}
            >
              <option value="all">All channels</option>
              {POOLS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="ivo-empty-inline">
            {hasAnyData
              ? "No products match your filters."
              : "No channel stock recorded yet. Complete a stock order to see it here."}
          </p>
        ) : (
          <>
            <div className="ivo-table-wrap">
              <table className="ivo-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Product</th>
                    {POOLS.map((p) => (
                      <th key={p.key} className="ivo-th-num">{p.label}</th>
                    ))}
                    <th className="ivo-th-num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((r) => (
                    <tr key={r.id}>
                      <td><span className="ivo-sku">{r.sku_id || "—"}</span></td>
                      <td className="ivo-name">{r.name || "—"}</td>
                      {POOLS.map((p) => (
                        <td key={p.key} className="ivo-td-num">
                          <span
                            className={`ivo-qty ${
                              r.cells[p.key] < 0 ? "negative" : r.cells[p.key] === 0 ? "zero" : ""
                            }`}
                          >
                            {r.cells[p.key]}
                          </span>
                        </td>
                      ))}
                      <td className="ivo-td-num">
                        <strong className={r.total < 0 ? "ivo-total-negative" : ""}>
                          {r.total}
                        </strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginator page={page} totalPages={totalPages} onChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
