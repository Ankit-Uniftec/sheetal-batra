import React, { useEffect, useMemo, useState } from "react";
import useStockRoomView from "../StockRoom/useStockRoomView";
import { TYPE_CUSTOM, TYPE_LABELS, TYPE_LXRTS, TYPE_MTO, sizeLabel, sortSizes } from "../StockRoom/stockRoomModel";
import { getOrderChannelKey, CHANNEL_KEY_LABELS } from "../../utils/barcodeService";
import { Chips, Columns, Drawer, Empty, FilterGroup, Insight, PageHead, Pager, RankBars, Thumb, num } from "../CeoDashboard/CeoUi";
import { CsvButton, FilterDrawer, ListTools, Stat, defineKit } from "../CeoDashboard/dashKit";
import { csvFromObjects } from "./PmCommon";
import { FloorBars } from "./PmToday";
import { isDormant, isRunning, pieceState, plural } from "./pmModel";

// ============================================================
// Stock: the finished stock the floor makes for, from the SAME records and the
// SAME calculations Stock Room uses (useStockRoomView over its own loaders), so
// every count here matches Stock Room. Added for production: the stock orders
// being made right now, what to make next, and Half Made pieces. No prices or
// stock values are shown.
// ============================================================

const { Tile, Card, Table } = defineKit({
  tiles: {
    "Pieces in Stock": "Finished pieces held, exactly as Stock Room counts them: LXRTS designs by size, custom pieces as a total. Made-to-order designs hold no stock. Impossible counts (negative or corrupted) are left out, as in Stock Room.",
    "Low Stock": "Stocked designs with 1 to 4 pieces left (Stock Room's rule).",
    "Out of Stock": "Stocked designs with no pieces left.",
    "Being Made for Stock": "Stock orders (retail, B2B and website stock) still in production, and the pieces in them.",
    "Make Next": "Stocked designs that sold in the last 90 days and will run short: fewer pieces in stock and being made than were sold in 90 days.",
  },
  cards: {
    "What To Make Next": "Designs that sold in the last 90 days, with what is in stock and what stock orders are already making. Cover is how many days the stock would last at the last 90 days' selling rate. Sorted by the shortest cover first.",
    "Stock Orders on the Floor": "Where the pieces of running stock orders are now, by stage. Click a bar to see the pieces.",
    "Stock Being Made by Channel": "Running stock orders by the stock they are for. Click a row to see the orders.",
    "Stock by Size": "LXRTS pieces held in each size, across all designs.",
    "Designs in Stock": "Every stocked design with its pieces and sizes, exactly as Stock Room holds them. Click a design for its sizes and what is being made.",
    "Designs Being Made for Stock": "Pieces ordered on stock orders that are still in production, by design, with whether Stock Room holds that design as LXRTS, a custom piece or made to order.",
    "Half Made Pieces": "Pieces taken off an order part-made (for example when the order was cancelled) and kept to finish for another order.",
  },
  columns: {
    Cover: "Days the current stock would last at the selling rate of the last 90 days.",
    "Being Made": "Pieces of this design in stock orders that are still in production.",
  },
});

const STOCK_CHANNELS = ["retail_stock", "b2b_stock", "shopify_stock"];
const LEVELS = [{ value: "ok", label: "In stock" }, { value: "low", label: "Low (1–4)" }, { value: "out", label: "Out of stock" }];
const TYPES = [{ value: TYPE_LXRTS, label: "LXRTS" }, { value: TYPE_CUSTOM, label: "Custom piece" }];
const STOCK_SORTS = [
  { value: "most", label: "Most pieces" }, { value: "least", label: "Fewest pieces" },
  { value: "making", label: "Most being made" }, { value: "name", label: "Name, A to Z" },
];
const LEVEL_WORD = { ok: "In stock", low: "Low", out: "Out of stock", unlimited: "Unlimited", untracked: "Made to order" };
const PAGE = 15;
const pcs = (r) => (r.stock.tracked && !r.stock.unlimited ? r.stock.total : 0);
const sizeLine = (r) => (r.stock.bySize
  ? sortSizes(Object.keys(r.stock.bySize)).map((s) => `${sizeLabel(s)} ${r.stock.bySize[s]}`).join(" · ")
  : r.stock.unlimited ? "Unlimited" : `${num(r.stock.total)} pieces`);

export default function StockPage({ ctx }) {
  const { lazy, need, orders, componentsByOrder, openOrders, openPieces } = ctx;
  useEffect(() => { need("stockRoom"); need("halfMade"); }, [need]);
  const sr = lazy.stockRoom?.rows;
  const view = useStockRoomView(sr?.data || null, 90, sr?.ledger || null);
  const halfMade = lazy.halfMade?.rows;

  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("");
  const [type, setType] = useState("");
  const [sortBy, setSortBy] = useState("most");
  const [makingF, setMakingF] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [page, setPage] = useState(1);
  const [design, setDesign] = useState(null);
  useEffect(() => { setPage(1); }, [search, level, type, sortBy, makingF]);
  // Opened from the header search: show that design once Stock Room's data is in.
  useEffect(() => {
    if (!ctx.stockFocus || !view) return;
    const r = view.rowsById[ctx.stockFocus];
    if (r) setDesign(r);
    ctx.setStockFocus(null);
  }, [ctx.stockFocus, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stock orders still in production, and what they are making, per design and size.
  const making = useMemo(() => {
    const running = orders.filter((o) => isRunning(o) && STOCK_CHANNELS.includes(getOrderChannelKey(o)));
    const byProduct = {};
    const byName = {};
    running.forEach((o) => (o.items || []).forEach((it) => {
      const qty = Number(it.quantity) || 1;
      const nm = it.product_name || "Unnamed design";
      const g = byName[nm] || (byName[nm] = { name: nm, value: 0, list: [], productId: it.product_id || null });
      g.value += qty; if (!g.list.includes(o)) g.list.push(o);
      if (!it.product_id) return;
      const p = byProduct[it.product_id] || (byProduct[it.product_id] = { qty: 0, bySize: {}, orders: [] });
      p.qty += qty;
      const s = sizeLabel(it.size || "");
      if (s) p.bySize[s] = (p.bySize[s] || 0) + qty;
      if (!p.orders.includes(o)) p.orders.push(o);
    }));
    const byChannel = STOCK_CHANNELS.map((k) => {
      const list = running.filter((o) => getOrderChannelKey(o) === k);
      return { key: k, name: CHANNEL_KEY_LABELS[k] || k, value: list.length, list, pieces: list.reduce((s, o) => s + (componentsByOrder[o.id] || []).filter((c) => !c.cancelled_at).length, 0) };
    }).filter((r) => r.value);
    const pieces = running.flatMap((o) => (componentsByOrder[o.id] || []).filter((c) => !c.cancelled_at));
    const quiet = running.filter((o) => isDormant(o, componentsByOrder[o.id] || []));
    return { running, byProduct, byChannel, pieces, quiet, designs: Object.values(byName).sort((a, b) => b.value - a.value) };
  }, [orders, componentsByOrder]);

  const data = useMemo(() => {
    if (!view) return null;
    const stocked = view.rows.filter((r) => r.type !== TYPE_MTO);
    const counted = stocked.filter((r) => !r.stock.unlimited);
    const next = counted.filter((r) => r.sold90 > 0).map((r) => {
      const mk = making.byProduct[r.id]?.qty || 0;
      const rate = r.sold90 / 90;
      return { ...r, making: mk, cover: rate ? Math.floor(pcs(r) / rate) : null, short: Math.max(0, r.sold90 - pcs(r) - mk) };
    }).sort((a, b) => (a.cover ?? 1e9) - (b.cover ?? 1e9) || b.sold90 - a.sold90);
    const makeNext = next.filter((r) => r.short > 0);
    const held = view.heldBySize || {};
    const bySize = sortSizes(Object.keys(held)).map((name) => ({ name, value: held[name] }));
    // Stock orders made for designs Stock Room does not hold as stock (made to order).
    const madeToOrderMaking = making.designs.filter((d) => d.productId && view.rowsById[d.productId]?.type === TYPE_MTO);
    const mtoPieces = madeToOrderMaking.reduce((a, d) => a + d.value, 0);
    // Stock that has not sold in 90 days, and sizes that sell faster than they are held.
    const slow = counted.filter((r) => pcs(r) > 0 && r.sold90 === 0);
    const soldBySize = view.sales?.trackedBySize || {};
    const sizeGap = sortSizes(Object.keys(soldBySize)).map((sz) => ({ size: sz, sold: soldBySize[sz] || 0, held: held[sz] || 0 }))
      .filter((x) => x.sold > 0 && x.size !== "Custom").sort((a, b) => (b.sold - b.held) - (a.sold - a.held))[0] || null;
    return { stocked, counted, next, makeNext, bySize, withStock: counted.filter((r) => pcs(r) > 0), mtoPieces, madeToOrderMaking, slow, sizeGap };
  }, [view, making]);

  const list = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.stocked.filter((r) => (!q || [r.product.name, r.product.sku_id].some((v) => String(v || "").toLowerCase().includes(q)))
      && (!level || r.status === level) && (!type || r.type === type)
      && (!makingF || (makingF === "yes") === ((making.byProduct[r.id]?.qty || 0) > 0)))
      .sort((a, b) => {
        const byName = String(a.product.name).localeCompare(String(b.product.name));
        if (sortBy === "least") return pcs(a) - pcs(b) || byName;
        if (sortBy === "making") return (making.byProduct[b.id]?.qty || 0) - (making.byProduct[a.id]?.qty || 0) || pcs(b) - pcs(a);
        if (sortBy === "name") return byName;
        return pcs(b) - pcs(a) || byName;
      });
  }, [data, search, level, type, sortBy, makingF, making]);

  const hmOpen = (halfMade || []).filter((h) => !["used", "written_off"].includes(String(h.status || "").toLowerCase()));

  if (lazy.stockRoom?.error) return <div className="ceo-page"><PageHead title="Stock" /><section className="ceo-card"><Empty text={`Stock could not be loaded: ${lazy.stockRoom.error}`} /></section></div>;
  if (!view || !data) return <div className="ceo-page"><PageHead title="Stock" /><section className="ceo-card"><Empty text="Loading stock from Stock Room…" /></section></div>;
  const t = view.totals;
  const exportList = () => csvFromObjects("designs in stock", list.map((r) => ({
    SKU: r.product.sku_id || "", Design: r.product.name, Type: TYPE_LABELS[r.type] || "", Pieces: pcs(r), Sizes: sizeLine(r),
    Status: LEVEL_WORD[r.status] || r.status, "Sold in 90 Days": r.sold90, "Being Made": making.byProduct[r.id]?.qty || 0,
  })));
  const exportNext = () => csvFromObjects("what to make next", data.next.map((r) => ({
    SKU: r.product.sku_id || "", Design: r.product.name, Type: TYPE_LABELS[r.type] || "", "In Stock": pcs(r), "Sold in 90 Days": r.sold90,
    "Being Made": r.making, "Cover (days)": r.cover ?? "", "Short By": r.short,
  })));
  const top = data.makeNext[0];
  const outSold = data.counted.filter((r) => r.status === "out" && r.sold90 > 0);

  return (
    <div className="ceo-page">
      <PageHead title="Stock" desc="Finished stock, counted exactly as Stock Room counts it, and the stock orders the floor is making. Click any figure to see what is behind it." />
      <div className="ceo-tiles">
        <Tile icon="stock" label="Pieces in Stock" value={num(t.trackedUnits)} note={`${num(data.withStock.length)} designs · ${num(t.lxrtsUnits)} LXRTS · ${num(t.customUnits)} custom`}
          onClick={() => { setLevel(""); setType(""); document.querySelector(".pms-list")?.scrollIntoView({ behavior: "smooth" }); }} />
        <Tile icon="alert" tone={t.low ? "warn" : undefined} label="Low Stock" value={num(t.low)} note="1 to 4 pieces left"
          onClick={() => { setLevel("low"); document.querySelector(".pms-list")?.scrollIntoView({ behavior: "smooth" }); }} />
        <Tile icon="alert" tone={t.out ? "warn" : undefined} label="Out of Stock" value={num(t.out)} note={`${num(outSold.length)} sold in the last 90 days`}
          onClick={() => { setLevel("out"); document.querySelector(".pms-list")?.scrollIntoView({ behavior: "smooth" }); }} />
        <Tile icon="movements" label="Being Made for Stock" value={num(making.running.length)} note={`${plural(making.pieces.length, "piece")} on the floor`}
          onClick={() => openOrders({ title: "Stock Orders in Production", sub: "Retail, B2B and website stock orders still being made", orders: making.running })} />
        <Tile icon="trend" tone={data.makeNext.length ? "warn" : undefined} label="Make Next" value={num(data.makeNext.length)} note="Designs that will run short"
          onClick={() => document.querySelector(".pms-next")?.scrollIntoView({ behavior: "smooth" })} />
      </div>

      <div className="ceo-grid">
        <Card span={12} title="What This Says">
          <div className="pmq-insights">
            <Insight><b>{num(t.trackedUnits)}</b> finished pieces are in stock across <b>{num(data.withStock.length)}</b> designs; {num(t.low)} designs are low and {num(t.out)} are out of stock{outSold.length ? <>, <b>{num(outSold.length)}</b> of which sold in the last 90 days</> : null}.</Insight>
            {top && <Insight tone="warn">Most urgent to make: <b>{top.product.name}</b>. It sold {plural(top.sold90, "piece")} in 90 days, has {num(pcs(top))} in stock and {num(top.making)} being made, so it is short by about {num(top.short)}.</Insight>}
            <Insight tone={making.quiet.length ? "warn" : "gold"}>{num(making.running.length)} stock orders ({plural(making.pieces.length, "barcoded piece")}) are in production{making.byChannel.length ? <>: {making.byChannel.map((c) => `${num(c.value)} ${c.name.toLowerCase()}`).join(", ")}</> : null}.{making.quiet.length ? <> <b>{num(making.quiet.length)}</b> of them have had nothing scanned for 30 days or more.</> : null}</Insight>
            {data.slow.length > 0 && <Insight tone="warn"><b>{num(data.slow.reduce((a, r) => a + pcs(r), 0))}</b> pieces across <b>{plural(data.slow.length, "design")}</b> have not sold in the last 90 days; check those before making more of the same.{" "}<button type="button" className="ceo-link" onClick={() => { setLevel(""); setType(""); setSearch(""); setDesign(null); document.querySelector(".pms-list")?.scrollIntoView({ behavior: "smooth" }); }}>See designs in stock</button></Insight>}
            {data.sizeGap && data.sizeGap.sold > data.sizeGap.held && <Insight>Size <b>{data.sizeGap.size}</b> sells fastest against what is held: {plural(data.sizeGap.sold, "piece")} sold in 90 days and {num(data.sizeGap.held)} in stock across LXRTS designs.</Insight>}
            {data.mtoPieces > 0 && <Insight tone="warn"><b>{num(data.mtoPieces)}</b> of the {num(making.designs.reduce((a, d) => a + d.value, 0))} garments ordered on running stock orders are made-to-order designs ({num(data.madeToOrderMaking.length)} designs). Stock Room does not hold made-to-order designs as stock, so finishing them will not raise the counts on this page.</Insight>}
            {halfMade && <Insight>{hmOpen.length ? <><b>{plural(hmOpen.length, "Half Made piece")}</b> {hmOpen.length === 1 ? "is" : "are"} waiting to be finished for another order.</> : <>No Half Made pieces are waiting; {plural((halfMade || []).length, "piece")} recorded so far {(halfMade || []).length === 1 ? "has" : "have"} been used or written off.</>}</Insight>}
          </div>
        </Card>

        <Card span={12} className="pms-next" title="What To Make Next" sub={`${num(data.next.length)} stocked designs sold in the last 90 days; ${num(data.makeNext.length)} will run short. Shortest cover first.`}>
          <div className="gm-actions"><CsvButton disabled={!data.next.length} onClick={exportNext} /></div>
          <Table rowKey={(r) => r.id} rows={data.next.slice(0, 12)} onRow={setDesign} empty="No stocked design sold in the last 90 days." columns={[
            { key: "d", label: "Design", render: (r) => <span className="ceo-ocell"><Thumb src={r.product.image_url} alt="" /><span><b>{r.product.name}</b><small>{r.product.sku_id || "–"} · {TYPE_LABELS[r.type]}</small></span></span> },
            { key: "s", label: "In Stock", right: true, render: (r) => num(pcs(r)) },
            { key: "sold", label: "Sold in 90 Days", right: true, hide: true, render: (r) => num(r.sold90) },
            { key: "mk", label: "Being Made", right: true, hide: true, render: (r) => num(r.making) },
            { key: "cover", label: "Cover", right: true, render: (r) => <span className={r.cover != null && r.cover < 14 ? "pm-late" : undefined}>{r.cover == null ? "–" : plural(r.cover, "day")}</span> },
          ]} />
        </Card>

        <Card span={7} md={12} title="Stock Orders on the Floor" sub={`${plural(making.pieces.length, "piece")} of ${plural(making.running.length, "stock order")} in production`}>
          {making.pieces.length ? <FloorBars ctx={ctx} pieces={making.pieces.filter((c) => ["in_house", "at_wh2", "at_vendor"].includes(pieceState(c)))} /> : <Empty text="No stock orders are in production." />}
          {making.pieces.length > 0 && (
            <p className="pm-foot-note">
              {num(making.pieces.filter((c) => pieceState(c) === "not_started").length)} not started · {num(making.pieces.filter((c) => pieceState(c) === "finished").length)} finished, waiting to go into stock.
              {" "}<button type="button" className="ceo-link" onClick={() => openPieces({ title: "Stock Pieces Not Started", sub: "Pieces of running stock orders waiting for Cloth Issue", pieces: making.pieces.filter((c) => pieceState(c) === "not_started") })}>See the ones not started</button>
            </p>
          )}
        </Card>
        <Card span={5} md={12} title="Stock Being Made by Channel">
          <RankBars rows={making.byChannel} format={(v) => plural(v, "order")} sub={(r) => plural(r.pieces, "piece")}
            onRow={(r) => openOrders({ title: `${r.name} Orders in Production`, sub: "Stock orders still being made", orders: r.list })} />
        </Card>

        <Card span={6} md={12} title="Designs Being Made for Stock" sub="Garments ordered on running stock orders, by design. Click one to see its orders.">
          <RankBars rows={making.designs} limit={10} format={(v) => plural(v, "garment")}
            sub={(r) => `${plural(r.list.length, "order")}${r.productId && view.rowsById[r.productId] ? ` · ${TYPE_LABELS[view.rowsById[r.productId].type]}` : ""}`}
            onRow={(r) => openOrders({ title: `Making for Stock: ${r.name}`, sub: "Stock orders still in production", orders: r.list })} />
        </Card>
        <Card span={6} md={12} title="Stock by Size" sub="LXRTS pieces held in each size, across every design">
          <Columns data={data.bySize} money={false} name="Pieces" height={260} />
        </Card>

        <Card span={12} className="pms-list" title="Designs in Stock" sub={`${num(data.stocked.length)} stocked designs (LXRTS and custom pieces); ${num(t.mto)} made-to-order designs hold no stock and are not listed.`}>
          <ListTools search={search} onSearch={setSearch} placeholder="Search design or SKU" filters={(level ? 1 : 0) + (type ? 1 : 0) + (makingF ? 1 : 0) + (sortBy !== "most" ? 1 : 0)} onFilters={() => setDrawer(true)} exportDisabled={!list.length} onExport={exportList} />
          <Table rowKey={(r) => r.id} rows={list.slice((page - 1) * PAGE, page * PAGE)} onRow={setDesign} empty="No designs match." columns={[
            { key: "d", label: "Design", render: (r) => <span className="ceo-ocell"><Thumb src={r.product.image_url} alt="" /><span><b>{r.product.name}</b><small>{r.product.sku_id || "–"} · {TYPE_LABELS[r.type]}</small></span></span> },
            { key: "sizes", label: "Sizes", hide: true, lap: true, render: (r) => <small className="pm-muted">{sizeLine(r)}</small> },
            { key: "mk", label: "Being Made", right: true, hide: true, render: (r) => num(making.byProduct[r.id]?.qty || 0) },
            { key: "p", label: "Pieces", right: true, render: (r) => <span className="pm-cell is-right"><b>{r.stock.unlimited ? "Unlimited" : num(pcs(r))}</b><small className={r.status === "out" ? "pm-late" : r.status === "low" ? "pm-soon" : undefined}>{LEVEL_WORD[r.status] || r.status}</small></span> },
          ]} />
          <Pager page={page} pages={Math.ceil(list.length / PAGE)} onChange={setPage} />
          <p className="pm-count-line">{plural(list.length, "design")} · {num(list.reduce((s, r) => s + pcs(r), 0))} pieces</p>
        </Card>

        <Card span={12} title="Half Made Pieces" sub={halfMade ? `${num(hmOpen.length)} waiting to be finished · ${num((halfMade || []).length)} recorded in all` : "Loading…"}>
          {!halfMade ? <Empty text="Loading…" /> : !(halfMade || []).length ? <Empty text="No Half Made pieces recorded yet." /> : (
            <Table rowKey={(h) => h.id} rows={halfMade.slice(0, 10)} empty="None." columns={[
              { key: "p", label: "Piece", render: (h) => <span className="pm-cell"><b>{h.product_name || "–"} · {h.component_label || h.component_type}</b><small>{[h.size && `Size ${h.size}`, h.colors, h.source_order_no && `From ${h.source_order_no}`].filter(Boolean).join(" · ")}</small></span> },
              { key: "r", label: "Reason", hide: true, render: (h) => h.reason || "–" },
              { key: "s", label: "Status", right: true, render: (h) => <span className="pm-cell is-right"><b>{String(h.status || "").replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase())}</b><small>{h.used_order_no ? `Used for ${h.used_order_no}` : h.location || ""}</small></span> },
            ]} />
          )}
        </Card>
      </div>

      <FilterDrawer open={drawer} onClose={() => setDrawer(false)} onClear={() => { setLevel(""); setType(""); setSortBy("most"); setMakingF(""); }} count={list.length} noun="designs" sub="Narrow the designs in stock">
        <FilterGroup label="Sort By"><Chips options={STOCK_SORTS} value={sortBy} onChange={(v) => setSortBy(v || "most")} /></FilterGroup>
        <FilterGroup label="Being Made"><Chips options={[{ value: "yes", label: "Being made now" }, { value: "no", label: "Not being made" }]} value={makingF} onChange={setMakingF} /></FilterGroup>
        <FilterGroup label="Stock Level"><Chips options={LEVELS} value={level} onChange={setLevel} /></FilterGroup>
        <FilterGroup label="Type"><Chips options={TYPES} value={type} onChange={setType} /></FilterGroup>
      </FilterDrawer>

      {design && <DesignDrawer row={design} making={making.byProduct[design.id]} onClose={() => setDesign(null)} openOrders={openOrders} />}
    </div>
  );
}

/** One design: its sizes in stock, sales and what stock orders are making. */
function DesignDrawer({ row: r, making, onClose, openOrders }) {
  const sizes = sortSizes([...Object.keys(r.stock.bySize || {}), ...Object.keys(making?.bySize || {})].map(sizeLabel));
  return (
    <Drawer title={r.product.name} sub={`${r.product.sku_id || "–"} · ${TYPE_LABELS[r.type]}`} onClose={onClose}>
      <div className="ceo-dstats">
        <Stat label="In Stock" info="Pieces held now, as Stock Room counts them."><b>{r.stock.unlimited ? "Unlimited" : num(pcs(r))}</b></Stat>
        <Stat label="Sold in 90 Days" info="Pieces sold on client orders in the last 90 days (stock orders and cancelled orders left out, as in Stock Room)."><b>{num(r.sold90)}</b></Stat>
        <Stat label="Being Made" info="Pieces of this design in stock orders still in production."><b>{num(making?.qty || 0)}</b></Stat>
      </div>
      {r.product.image_url && <div className="pms-photo"><Thumb src={r.product.image_url} alt={r.product.name} large /></div>}
      {sizes.length > 0 && (
        <Table rowKey={(s) => s} rows={sizes} columns={[
          { key: "s", label: "Size", render: (s) => s },
          { key: "h", label: "In Stock", right: true, render: (s) => (r.stock.bySize ? num(Object.entries(r.stock.bySize).filter(([k]) => sizeLabel(k) === s).reduce((a, [, v]) => a + v, 0)) : "–") },
          { key: "m", label: "Being Made", right: true, render: (s) => num(making?.bySize?.[s] || 0) },
        ]} />
      )}
      {making?.orders?.length > 0 && (
        <div className="gm-actions"><button type="button" className="ceo-btn" onClick={() => { onClose(); openOrders({ title: `Making: ${r.product.name}`, sub: "Stock orders still in production", orders: making.orders }); }}>See the {plural(making.orders.length, "stock order")}</button></div>
      )}
    </Drawer>
  );
}
