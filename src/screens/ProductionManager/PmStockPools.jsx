import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { fetchAllRows } from "../../utils/fetchAllRows";
import { POOL_DEFS, poolsForUser } from "../../utils/stockVisibility";
import { Chips, Empty, FilterGroup, Pager, num } from "../CeoDashboard/CeoUi";
import { FilterDrawer, ListTools, Stat } from "../CeoDashboard/dashKit";
import { Card, Loading, Table, Tile, csvFromObjects } from "./PmCommon";
import { pct, plural } from "./pmModel";
import "./PmRecords2.css";

// ============================================================
// Stock by Pool: the per-pool stock the older Production Manager dashboard
// showed in its shared StockPanel, in this dashboard's design. Same pools
// (stockVisibility: factory, retail_stock, b2b_stock, shopify_stock for the
// production_manager role) and the SAME read-only selects StockPanel makes:
//
//   product_channel_stock  product_id, channel_key, quantity      (Retail, B2B, Website stock)
//   warehouses             id, name where is_active               (the "Factory" one, by name)
//   warehouse_stock        warehouse_id, product_id, quantity, products(name, sku_id)
//   products_live          id, name, sku_id for products the above did not name
//
// Nothing is written. Units only, no values or prices. The three stock records
// have never agreed, so each pool is shown as its own number and never merged
// with the Stock Room counts above it. A negative balance is a real mismatch
// (stock sold without a matching stock order, or booked to the wrong pool) and
// is listed first; a pool with no matching warehouse says "not configured"
// rather than 0.
// ============================================================

const PAGE = 15;
const ROLE_POOLS = poolsForUser({ role: "production_manager" });
// Shades of the brand gold, darkest first, with the text colour that reads on each.
const SHADES = [["#6f5414", "#fff"], ["#a9821f", "#fff"], ["#d4b04c", "#3b2f12"], ["#ecdcaa", "#3b2f12"], ["#f6efd9", "#3b2f12"]];
const SORTS = [{ value: "", label: "Negatives first, then most units" }, { value: "most", label: "Most units" }, { value: "name", label: "Name, A to Z" }];
const lc = (v) => String(v || "").toLowerCase();

/** Loads every pool the Production Manager may see, exactly as StockPanel does. */
async function loadPools(defs) {
  const wantChannel = defs.filter((d) => d.kind === "channel");
  const wantWarehouse = defs.filter((d) => d.kind === "warehouse");
  const qty = {};
  const meta = {};
  const missing = [];
  const add = (productId, key, n) => {
    if (!qty[productId]) qty[productId] = {};
    qty[productId][key] = (qty[productId][key] || 0) + (n || 0);
  };
  const [channelRes, whRes] = await Promise.all([
    wantChannel.length
      ? fetchAllRows("product_channel_stock", (q) => q.select("product_id, channel_key, quantity"))
      : Promise.resolve({ data: [], error: null }),
    wantWarehouse.length
      ? Promise.all([
        supabase.from("warehouses").select("id, name").eq("is_active", true),
        fetchAllRows("warehouse_stock", (q) => q.select("warehouse_id, product_id, quantity, products(name, sku_id)")),
      ])
      : Promise.resolve(null),
  ]);
  if (channelRes?.error) throw channelRes.error;
  (channelRes?.data || []).forEach((row) => {
    const def = wantChannel.find((d) => d.channelKey === row.channel_key);
    if (def) add(row.product_id, def.key, row.quantity);
  });
  if (whRes) {
    const [whList, whStock] = whRes;
    if (whList?.error) throw whList.error;
    if (whStock?.error) throw whStock.error;
    // warehouses.name is typed by hand, so each pool claims the warehouses whose name matches it.
    const poolOf = {};
    wantWarehouse.forEach((def) => {
      const matched = (whList.data || []).filter((w) => def.match.test(w.name || ""));
      if (!matched.length) missing.push(def.key);
      matched.forEach((w) => { poolOf[w.id] = def.key; });
    });
    (whStock.data || []).forEach((row) => {
      const key = poolOf[row.warehouse_id];
      if (!key) return;
      add(row.product_id, key, row.quantity);
      if (row.products) meta[row.product_id] = { name: row.products.name, sku_id: row.products.sku_id };
    });
  }
  // Names and SKUs for products only the channel rows mention, 200 at a time.
  const need = Object.keys(qty).filter((id) => !meta[id]);
  for (let i = 0; i < need.length; i += 200) {
    const { data } = await supabase.from("products_live").select("id, name, sku_id").in("id", need.slice(i, i + 200));
    (data || []).forEach((p) => { meta[p.id] = { name: p.name, sku_id: p.sku_id }; });
  }
  return { qty, meta, missing };
}

export function StockPools({ ctx }) { // eslint-disable-line no-unused-vars
  // ctx is taken for the same shape as the other sections; the pools load on their own.
  const defs = useMemo(() => ROLE_POOLS.map((k) => ({ key: k, ...POOL_DEFS[k] })).filter((d) => d.kind === "channel" || d.kind === "warehouse"), []);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [pool, setPool] = useState("");
  const [negOnly, setNegOnly] = useState("");
  const [sort, setSort] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let off = false;
    loadPools(defs)
      .then((d) => { if (!off) { setData(d); setError(""); } })
      .catch((e) => { if (!off) setError(e?.message || String(e)); });
    return () => { off = true; };
  }, [defs]);

  const missing = useMemo(() => new Set(data?.missing || []), [data]);
  const shown = useMemo(() => defs.filter((d) => !missing.has(d.key)), [defs, missing]);

  // Every product with any stock in any pool, one row each.
  const all = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.qty).map(([id, by]) => {
      const cells = Object.fromEntries(defs.map((d) => [d.key, by[d.key] || 0]));
      const m = data.meta[id] || {};
      return { id, name: m.name || "", sku: m.sku_id || "", cells, total: defs.reduce((s, d) => s + cells[d.key], 0), negative: defs.some((d) => cells[d.key] < 0) };
    }).filter((r) => defs.some((d) => r.cells[d.key] !== 0));
  }, [data, defs]);

  const totals = useMemo(() => {
    const units = Object.fromEntries(defs.map((d) => [d.key, 0]));
    const products = Object.fromEntries(defs.map((d) => [d.key, 0]));
    let negatives = 0;
    all.forEach((r) => defs.forEach((d) => {
      const q = r.cells[d.key];
      units[d.key] += q;
      if (q > 0) products[d.key] += 1;
      if (q < 0) negatives += 1;
    }));
    // Shares are of the positive units only: a negative balance is a mismatch, not a share of stock.
    const positive = defs.reduce((s, d) => s + Math.max(0, units[d.key]), 0);
    return { units, products, negatives, positive, grand: defs.reduce((s, d) => s + units[d.key], 0) };
  }, [all, defs]);

  const list = useMemo(() => {
    const q = lc(search).trim();
    const out = all.filter((r) => (!pool || r.cells[pool] !== 0) && (!negOnly || r.negative)
      && (!q || lc(r.name).includes(q) || lc(r.sku).includes(q)));
    const byName = (a, b) => String(a.name).localeCompare(String(b.name));
    if (sort === "name") out.sort(byName);
    else if (sort === "most") out.sort((a, b) => b.total - a.total || byName(a, b));
    else out.sort((a, b) => (a.negative === b.negative ? b.total - a.total || byName(a, b) : a.negative ? -1 : 1));
    return out;
  }, [all, search, pool, negOnly, sort]);
  useEffect(() => { setPage(1); }, [list]);

  const exportCsv = () => csvFromObjects("stock by pool", list.map((r) => ({
    SKU: r.sku, Product: r.name, ...Object.fromEntries(defs.map((d) => [d.label, missing.has(d.key) ? "" : r.cells[d.key]])), Total: r.total,
  })));
  const active = [pool, negOnly, sort].filter(Boolean).length;
  const shade = (i) => SHADES[i % SHADES.length];

  return (
    <Card span={12} className="pm-pools" title="Stock by Pool (Factory, Retail, B2B, Shopify)"
      info="Units held in each stock pool, read from the stock records the older dashboard showed: the Factory warehouse (warehouse stock) and the Retail, B2B and Website stock balances. These records are kept apart from Stock Room, so these numbers can differ from the counts above. Units only, no values."
      sub="Units in each stock pool, read as they are recorded. Kept apart from the Stock Room counts above.">
      {error ? <Empty text={`Stock by pool could not be loaded: ${error}`} /> : !data ? <Loading text="Loading stock by pool" /> : (
        <>
          <div className="ceo-tiles pm-pools-tiles">
            {defs.map((d) => (missing.has(d.key)
              ? <Tile key={d.key} icon="stock" label={d.label} value="–" note="Not configured" info={`No warehouse named like "${d.label}" is set up, so there is no number to show.`} />
              : <Tile key={d.key} icon="stock" tone={totals.units[d.key] < 0 ? "warn" : undefined} label={d.label} value={num(totals.units[d.key])}
                note={`${plural(totals.products[d.key], "product")} in stock`} info={d.kind === "warehouse" ? `Units in the ${d.label} warehouse, from warehouse stock.` : `The live ${d.label} balance: raised by finished stock orders, lowered by sales. It can go below zero.`}
                onClick={() => { setPool(d.key); setPage(1); }} />))}
            <Tile icon="stock" label="Total Units" value={num(totals.grand)} note="Across these pools" info="All the pools above added together. Negative balances are included as they are." />
          </div>

          {missing.size > 0 && (
            <p className="pm-pools-note">
              No warehouse is set up for <b>{defs.filter((d) => missing.has(d.key)).map((d) => d.label).join(", ")}</b>. Its stock is read from the Warehouses tab: once a warehouse with a matching name holds stock, this figure fills in.
            </p>
          )}
          {totals.negatives > 0 && (
            <p className="pm-pools-warn">
              <b>{plural(totals.negatives, "negative balance")}</b>: stock sold without a matching stock order, or booked to the wrong pool. {totals.negatives === 1 ? "It is" : "They are"} listed first below.
            </p>
          )}

          <h4 className="pm-pools-sub">Stock split</h4>
          {totals.positive === 0 ? <Empty text={all.length ? "No pool holds any stock yet." : "No stock recorded yet."} /> : (
            <>
              <div className="pm-split" role="img" aria-label={shown.map((d) => `${d.label} ${totals.units[d.key]} units`).join(", ")}>
                {shown.map((d, i) => {
                  const share = pct(Math.max(0, totals.units[d.key]), totals.positive);
                  if (totals.units[d.key] <= 0) return null;
                  const [bg, fg] = shade(i);
                  return (
                    <span key={d.key} className="pm-split-seg" style={{ flexGrow: Math.max(0, totals.units[d.key]), background: bg, color: fg }} title={`${d.label}: ${num(totals.units[d.key])} units (${share}%)`}>
                      {share >= 12 ? `${d.label} ${num(totals.units[d.key])}` : num(totals.units[d.key])}
                    </span>
                  );
                })}
              </div>
              <div className="pm-split-key">
                {defs.map((d) => {
                  const i = shown.indexOf(d);
                  return (
                    <span key={d.key}>
                      <i style={{ background: i >= 0 ? shade(i)[0] : "#ddd" }} />{d.label}{" "}
                      <b className={totals.units[d.key] < 0 ? "pm-late" : undefined}>{missing.has(d.key) ? "not configured" : `${num(totals.units[d.key])} (${pct(Math.max(0, totals.units[d.key]), totals.positive)}%)`}</b>
                    </span>
                  );
                })}
              </div>
            </>
          )}

          <h4 className="pm-pools-sub">Stock by product</h4>
          <ListTools search={search} onSearch={setSearch} placeholder="Search product or SKU" filters={active} onFilters={() => setOpen(true)} onExport={exportCsv} exportDisabled={!list.length} />
          <div className="ceo-dstats pm-pools-stats">
            <Stat label="Products" info="Products with stock (or a negative balance) in any pool, matching the filters."><b>{num(list.length)}</b></Stat>
            <Stat label="Units" info="Units of these products across the pools."><b>{num(list.reduce((s, r) => s + r.total, 0))}</b></Stat>
            <Stat label="Negative Balances" info="Products with a balance below zero in at least one pool."><b className={list.some((r) => r.negative) ? "is-warn" : undefined}>{num(list.filter((r) => r.negative).length)}</b></Stat>
          </div>
          <Table rowKey={(r) => r.id} rows={list.slice((page - 1) * PAGE, page * PAGE)} empty={all.length ? "No products match these filters." : "No stock recorded yet."}
            columns={[
              { key: "sku", label: "SKU", flow: "one", render: (r) => <span className="pm-code">{r.sku || "–"}</span> },
              { key: "name", label: "Product", render: (r) => <span className="pm-cell"><b>{r.name || "–"}</b>{r.negative && <small><i className="pm-tag is-urgent">Negative balance</i></small>}</span> },
              ...defs.map((d) => ({
                key: d.key, label: d.label, right: true, flow: "one", hide: true,
                render: (r) => (missing.has(d.key) ? <span className="pm-muted">–</span>
                  : r.cells[d.key] < 0 ? <i className="pm-tag is-urgent">{num(r.cells[d.key])}</i>
                    : r.cells[d.key] === 0 ? <span className="pm-muted">0</span> : num(r.cells[d.key])),
              })),
              { key: "total", label: "Total", right: true, render: (r) => <b className={r.total < 0 ? "pm-late" : undefined}>{num(r.total)}</b> },
            ]} />
          <Pager page={page} pages={Math.ceil(list.length / PAGE)} onChange={setPage} />
        </>
      )}
      <FilterDrawer open={open} onClose={() => setOpen(false)} onClear={() => { setPool(""); setNegOnly(""); setSort(""); }} count={list.length} noun="products" sub="Narrow the stock by product">
        <FilterGroup label="Sort By"><Chips options={SORTS} value={sort} onChange={(v) => setSort(v || "")} /></FilterGroup>
        <FilterGroup label="Pool"><Chips options={shown.map((d) => ({ value: d.key, label: d.label }))} value={pool} onChange={setPool} /></FilterGroup>
        <FilterGroup label="Show"><Chips options={[{ value: "neg", label: "Negative balances only" }]} value={negOnly} onChange={setNegOnly} /></FilterGroup>
      </FilterDrawer>
    </Card>
  );
}

export default StockPools;
