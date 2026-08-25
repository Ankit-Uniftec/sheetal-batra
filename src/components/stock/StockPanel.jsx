import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { fetchAllRows } from "../../utils/fetchAllRows";
import { POOL_DEFS } from "../../utils/stockVisibility";
import formatIndianNumber from "../../utils/formatIndianNumber";
import Paginator from "../Paginator";
import "./StockPanel.css";

// ============================================================
// StockPanel — the ONE stock view, shown on every dashboard that is allowed
// stock, scoped by the `pools` its parent passes in (see utils/stockVisibility).
//
// Read-only by design. Editing inventory stays on the Inventory dashboard,
// which owns the write paths; every other dashboard looks but does not touch.
//
// WHAT IT DOES NOT DO: reconcile the three stock models. products.inventory
// (global), product_channel_stock (per-channel) and warehouse_stock
// (per-location) have never agreed and this panel does not pretend they do —
// each pool is labelled with where its number came from. Merging them would
// invent a number nobody wrote down.
//
// Presentation follows InventoryOverviewTab (dot + count + proportional bar +
// %), which follows the Production Manager dashboard, so "stock, broken down"
// reads the same wherever it appears.
// ============================================================

const ITEMS_PER_PAGE = 15;

// Proportional bar row — dot, label, count, bar, percentage.
function PoolRow({ label, count, percentage, color, note }) {
  return (
    <div className="stkp-channel-row">
      <div className="stkp-channel-label">
        <span className="stkp-channel-dot" style={{ background: color }} />
        <span>{label}</span>
        {note && <span className="stkp-channel-note">{note}</span>}
      </div>
      <div className="stkp-channel-right">
        <span className={`stkp-channel-count ${count < 0 ? "negative" : ""}`}>
          {formatIndianNumber(count)}
        </span>
        <div className="stkp-channel-bar-bg">
          <div
            className="stkp-channel-bar-fill"
            style={{ width: `${percentage}%`, background: color }}
          />
        </div>
        <span className="stkp-channel-pct">{percentage}%</span>
      </div>
    </div>
  );
}

export default function StockPanel({ pools = [] }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [poolFilter, setPoolFilter] = useState("all");
  const [page, setPage] = useState(1);

  // { productId: { poolKey: qty } } — one flat shape whatever the backing store,
  // so the table below doesn't branch per pool kind.
  const [qtyByProduct, setQtyByProduct] = useState({});
  const [productMeta, setProductMeta] = useState({}); // { id: { name, sku_id } }
  // Warehouse pools that resolved to no warehouse row. Rendered as an explicit
  // "not configured" note — NOT as 0, which would read as "we have none here".
  const [unconfigured, setUnconfigured] = useState([]);
  // Consignment is vendor-keyed, not product-keyed, so it gets its own summary
  // rather than a column in the per-product table.
  const [consignment, setConsignment] = useState(null);

  // Only the pools this user may see, in POOL_DEFS order, ignoring unknown keys.
  const defs = useMemo(
    () => pools.map((k) => ({ key: k, ...POOL_DEFS[k] })).filter((d) => d.kind),
    [pools]
  );

  // Pools that appear as columns in the per-product table (everything but
  // consignment, which has no product dimension).
  const productPools = useMemo(
    () => defs.filter((d) => d.kind !== "consignment"),
    [defs]
  );

  const poolsKey = useMemo(() => defs.map((d) => d.key).join(","), [defs]);

  // ==================== FETCH ====================
  // One fetch per pool KIND actually requested — a store manager never fetches
  // consignment, an SA never fetches warehouses they can't see.
  useEffect(() => {
    let cancelled = false;
    if (defs.length === 0) {
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      setError(null);

      const wantChannel = defs.filter((d) => d.kind === "channel");
      const wantWarehouse = defs.filter((d) => d.kind === "warehouse");
      const wantConsignment = defs.some((d) => d.kind === "consignment");

      const qty = {};
      const meta = {};
      const missing = [];
      const addQty = (productId, poolKey, n) => {
        if (!qty[productId]) qty[productId] = {};
        qty[productId][poolKey] = (qty[productId][poolKey] || 0) + (n || 0);
      };

      try {
        const [channelRes, whRes, consignRes] = await Promise.all([
          // Per-channel balances. Paged: one row per (product, channel).
          wantChannel.length
            ? fetchAllRows("product_channel_stock", (q) =>
                q.select("product_id, channel_key, quantity")
              )
            : Promise.resolve({ data: [], error: null }),

          // Per-location stock, joined to the product for name/SKU.
          wantWarehouse.length
            ? Promise.all([
                supabase.from("warehouses").select("id, name").eq("is_active", true),
                fetchAllRows("warehouse_stock", (q) =>
                  q.select("warehouse_id, product_id, quantity, products(name, sku_id)")
                ),
              ])
            : Promise.resolve(null),

          wantConsignment
            ? fetchAllRows("consignment_inventory", (q) =>
                q.select("quantity_sent, quantity_sold, quantity_remaining, quantity_lost")
              )
            : Promise.resolve({ data: [], error: null }),
        ]);

        if (cancelled) return;

        // ── Channel pools ──
        if (channelRes?.error) throw channelRes.error;
        const wantedChannelKeys = new Set(wantChannel.map((d) => d.channelKey));
        (channelRes?.data || []).forEach((row) => {
          if (!wantedChannelKeys.has(row.channel_key)) return;
          const def = wantChannel.find((d) => d.channelKey === row.channel_key);
          addQty(row.product_id, def.key, row.quantity);
        });

        // ── Warehouse pools ──
        if (whRes) {
          const [whList, whStock] = whRes;
          if (whList?.error) throw whList.error;
          if (whStock?.error) throw whStock.error;

          // warehouses.name is free text typed by hand, so each pool claims the
          // warehouses whose name matches its pattern. A pool matching none is
          // recorded as unconfigured rather than silently reading zero.
          const poolByWarehouseId = {};
          wantWarehouse.forEach((def) => {
            const matched = (whList.data || []).filter((w) => def.match.test(w.name || ""));
            if (matched.length === 0) missing.push(def.label);
            matched.forEach((w) => {
              poolByWarehouseId[w.id] = def.key;
            });
          });

          (whStock.data || []).forEach((row) => {
            const poolKey = poolByWarehouseId[row.warehouse_id];
            if (!poolKey) return; // a warehouse outside this user's pools
            addQty(row.product_id, poolKey, row.quantity);
            if (row.products) {
              meta[row.product_id] = {
                name: row.products.name,
                sku_id: row.products.sku_id,
              };
            }
          });
        }

        // ── Consignment ──
        if (wantConsignment) {
          if (consignRes?.error) throw consignRes.error;
          const rows = consignRes?.data || [];
          setConsignment(
            rows.reduce(
              (a, c) => ({
                sent: a.sent + (c.quantity_sent || 0),
                sold: a.sold + (c.quantity_sold || 0),
                remaining: a.remaining + (c.quantity_remaining || 0),
                lost: a.lost + (c.quantity_lost || 0),
              }),
              { sent: 0, sold: 0, remaining: 0, lost: 0 }
            )
          );
        }

        // Names/SKUs for any product the warehouse join didn't already cover
        // (channel rows carry only product_id). Chunked to keep the URL short.
        const needMeta = Object.keys(qty).filter((id) => !meta[id]);
        for (let i = 0; i < needMeta.length; i += 200) {
          const chunk = needMeta.slice(i, i + 200);
          const { data } = await supabase
            .from("products_live")
            .select("id, name, sku_id")
            .in("id", chunk);
          if (cancelled) return;
          (data || []).forEach((p) => {
            meta[p.id] = { name: p.name, sku_id: p.sku_id };
          });
        }

        if (cancelled) return;
        setQtyByProduct(qty);
        setProductMeta(meta);
        setUnconfigured(missing);
      } catch (e) {
        if (cancelled) return;
        console.error("StockPanel load error:", e);
        setError(e?.message || "Could not load stock.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [poolsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ==================== DERIVED ====================
  const totals = useMemo(() => {
    const byPool = Object.fromEntries(productPools.map((p) => [p.key, 0]));
    const withStock = Object.fromEntries(productPools.map((p) => [p.key, 0]));
    let negatives = 0;

    Object.values(qtyByProduct).forEach((byPool_) => {
      productPools.forEach((p) => {
        const q = byPool_?.[p.key];
        if (q === undefined) return;
        byPool[p.key] += q;
        if (q > 0) withStock[p.key] += 1;
        if (q < 0) negatives += 1;
      });
    });

    const grand = productPools.reduce((s, p) => s + byPool[p.key], 0);
    return { byPool, withStock, negatives, grand };
  }, [qtyByProduct, productPools]);

  // Percentages are of the POSITIVE total only. A negative balance is a
  // discrepancy, not a share of stock — letting it shrink the denominator would
  // make every other pool's bar overstate itself.
  const positiveTotal = useMemo(
    () => productPools.reduce((s, p) => s + Math.max(0, totals.byPool[p.key]), 0),
    [totals, productPools]
  );
  const pct = (n) =>
    positiveTotal > 0 ? Math.round((Math.max(0, n) / positiveTotal) * 100) : 0;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return Object.entries(qtyByProduct)
      .map(([id, byPool]) => {
        const cells = Object.fromEntries(productPools.map((p) => [p.key, byPool[p.key] || 0]));
        if (productPools.every((p) => cells[p.key] === 0)) return null;
        if (poolFilter !== "all" && cells[poolFilter] === 0) return null;

        const m = productMeta[id] || {};
        if (q && !(m.name?.toLowerCase().includes(q) || m.sku_id?.toLowerCase().includes(q))) {
          return null;
        }
        const total = productPools.reduce((s, p) => s + cells[p.key], 0);
        return { id, name: m.name, sku_id: m.sku_id, cells, total };
      })
      .filter(Boolean)
      // Negatives first — they are the rows that need attention — then by size.
      .sort((a, b) => {
        const aNeg = productPools.some((p) => a.cells[p.key] < 0);
        const bNeg = productPools.some((p) => b.cells[p.key] < 0);
        if (aNeg !== bNeg) return aNeg ? -1 : 1;
        return b.total - a.total;
      });
  }, [qtyByProduct, productMeta, productPools, search, poolFilter]);

  const totalPages = Math.ceil(rows.length / ITEMS_PER_PAGE);
  const paged = useMemo(
    () => rows.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE),
    [rows, page]
  );
  useEffect(() => {
    setPage(1);
  }, [search, poolFilter]);

  // ==================== RENDER ====================
  if (defs.length === 0) return null;

  if (loading) {
    return (
      <div className="stkp-panel">
        <div className="stkp-loading">
          <span className="stkp-spinner" />
          <p>Loading stock…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stkp-panel">
        <div className="stkp-warning">Could not load stock — {error}</div>
      </div>
    );
  }

  const hasAnyData = Object.keys(qtyByProduct).length > 0;

  return (
    <div className="stkp-panel">
      {/* ── Per-pool totals ── */}
      <div className="stkp-stats-grid">
        {productPools.map((p) => {
          const isMissing = unconfigured.includes(p.label);
          return (
            <div key={p.key} className="stkp-stat-card" style={{ borderTopColor: p.color }}>
              <span className="stkp-stat-label">{p.label}</span>
              {isMissing ? (
                <>
                  <span className="stkp-stat-value stkp-stat-na">—</span>
                  <span className="stkp-stat-sub">not configured</span>
                </>
              ) : (
                <>
                  <span
                    className={`stkp-stat-value ${totals.byPool[p.key] < 0 ? "negative" : ""}`}
                    style={{ color: totals.byPool[p.key] < 0 ? undefined : p.color }}
                  >
                    {formatIndianNumber(totals.byPool[p.key])}
                  </span>
                  <span className="stkp-stat-sub">
                    {totals.withStock[p.key]} product
                    {totals.withStock[p.key] === 1 ? "" : "s"} in stock
                  </span>
                </>
              )}
            </div>
          );
        })}
        {productPools.length > 1 && (
          <div className="stkp-stat-card stkp-stat-total">
            <span className="stkp-stat-label">Total Units</span>
            <span className="stkp-stat-value">{formatIndianNumber(totals.grand)}</span>
            <span className="stkp-stat-sub">across the pools you can see</span>
          </div>
        )}
      </div>

      {/* A per-location pool with no matching warehouse row has no number to
          show. Saying so beats printing 0, which claims the shelf is empty. */}
      {unconfigured.length > 0 && (
        <div className="stkp-notice">
          No warehouse is set up for <strong>{unconfigured.join(", ")}</strong>. Per-location
          stock is read from the Warehouses tab — create a warehouse with a matching name and
          assign stock to it, and these figures will fill in.
        </div>
      )}

      {/* A negative balance means stock left a channel without a matching stock
          order, or a sale was booked against the wrong channel. Surfaced, never
          hidden — db/…/v2/72 permits negatives precisely so this can be seen. */}
      {totals.negatives > 0 && (
        <div className="stkp-warning">
          <strong>{totals.negatives}</strong> negative balance
          {totals.negatives === 1 ? "" : "s"} — stock sold without a matching stock order, or
          booked to the wrong pool. Shown first in the table below.
        </div>
      )}

      {/* ── Consignment: vendor-keyed, so its own summary rather than a column ── */}
      {consignment && (
        <div className="stkp-card">
          <h3 className="stkp-card-title">B2B Consignment</h3>
          <div className="stkp-consign-grid">
            <div className="stkp-consign-item">
              <span className="stkp-consign-value">{formatIndianNumber(consignment.remaining)}</span>
              <span className="stkp-consign-label">Units on hand</span>
            </div>
            <div className="stkp-consign-item">
              <span className="stkp-consign-value">{formatIndianNumber(consignment.sent)}</span>
              <span className="stkp-consign-label">Sent</span>
            </div>
            <div className="stkp-consign-item">
              <span className="stkp-consign-value">{formatIndianNumber(consignment.sold)}</span>
              <span className="stkp-consign-label">Sold</span>
            </div>
            <div className="stkp-consign-item">
              <span className="stkp-consign-value">{formatIndianNumber(consignment.lost)}</span>
              <span className="stkp-consign-label">Lost</span>
            </div>
            <div className="stkp-consign-item">
              <span className="stkp-consign-value">
                {consignment.sent > 0
                  ? `${Math.round((consignment.sold / consignment.sent) * 100)}%`
                  : "—"}
              </span>
              <span className="stkp-consign-label">Sell-through</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Proportional split ── */}
      {productPools.length > 1 && (
        <div className="stkp-card">
          <h3 className="stkp-card-title">Stock Split</h3>
          {positiveTotal === 0 ? (
            <p className="stkp-empty-inline">
              {hasAnyData ? "No positive stock in any pool yet." : "No stock recorded yet."}
            </p>
          ) : (
            <div className="stkp-channel-list">
              {productPools.map((p) => (
                <PoolRow
                  key={p.key}
                  label={p.label}
                  count={totals.byPool[p.key]}
                  percentage={pct(totals.byPool[p.key])}
                  color={p.color}
                  note={unconfigured.includes(p.label) ? "not configured" : null}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Per-product breakdown ── */}
      <div className="stkp-card">
        <div className="stkp-card-header">
          <h3 className="stkp-card-title">Stock by Product</h3>
          <div className="stkp-toolbar">
            <input
              className="stkp-search"
              type="text"
              placeholder="Search by name or SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {productPools.length > 1 && (
              <select
                className="stkp-select"
                value={poolFilter}
                onChange={(e) => setPoolFilter(e.target.value)}
              >
                <option value="all">All pools</option>
                {productPools.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="stkp-empty-inline">
            {hasAnyData ? "No products match your filters." : "No stock recorded yet."}
          </p>
        ) : (
          <>
            <div className="stkp-table-wrap">
              <table className="stkp-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Product</th>
                    {productPools.map((p) => (
                      <th key={p.key} className="stkp-th-num">
                        {p.label}
                      </th>
                    ))}
                    {productPools.length > 1 && <th className="stkp-th-num">Total</th>}
                  </tr>
                </thead>
                <tbody>
                  {paged.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <span className="stkp-sku">{r.sku_id || "—"}</span>
                      </td>
                      <td className="stkp-name">{r.name || "—"}</td>
                      {productPools.map((p) => (
                        <td key={p.key} className="stkp-td-num">
                          <span
                            className={`stkp-qty ${
                              r.cells[p.key] < 0 ? "negative" : r.cells[p.key] === 0 ? "zero" : ""
                            }`}
                          >
                            {r.cells[p.key]}
                          </span>
                        </td>
                      ))}
                      {productPools.length > 1 && (
                        <td className="stkp-td-num">
                          <strong className={r.total < 0 ? "stkp-total-negative" : ""}>
                            {r.total}
                          </strong>
                        </td>
                      )}
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
