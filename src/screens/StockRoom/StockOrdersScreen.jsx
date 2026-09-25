import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { startOrderMode } from "../../utils/orderMode";
import {
  Topline, SearchField, FilterButton, FilterDrawer, Facet, ActiveFilters, Thumb, Badge, Icon, usePaged, SearchSelect,
} from "./StockRoomUi";
import {
  stockOrderStatusKey, stockOrderStatusLabel, isOpenStockOrder, hoursSince, formatDay, formatUnits,
  STOCK_WINDOW_HOURS, sizeLabel, SIZE_SCALE,
} from "./stockRoomModel";

const STATUS_TONE = {
  order_received: "gold",
  processing: "info",
  completed: "ok",
  delivered: "ok",
  cancelled: "crit",
  revoked: "crit",
  exchange_return: "low",
};

const PERIODS = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last year" },
];

const DELIVERY = [
  { value: "overdue", label: "Overdue" },
  { value: "week", label: "Due in 7 days" },
];

const DAY = 86400000;

const CATEGORIES = [{ value: "women", label: "Women" }, { value: "kids", label: "Kids" }];
const AGES = [
  { value: "editable", label: `Editable (under ${STOCK_WINDOW_HOURS}h)` },
  { value: "locked", label: "Locked" },
];
const itemsOf = (o) => (Array.isArray(o.items) ? o.items.filter(Boolean) : []);

function deliveryState(order, now) {
  if (!order.delivery_date || !isOpenStockOrder(order)) return null;
  const due = new Date(order.delivery_date).getTime();
  if (isNaN(due)) return null;
  const today = new Date(now).setHours(0, 0, 0, 0);
  if (due < today) return "overdue";
  if (due < today + 8 * DAY) return "week";
  return null;
}

function ColourDot({ colour }) {
  if (!colour?.hex) return null;
  return (<><span className="sr-cdot" style={{ background: colour.hex }} />{colour.name}</>);
}

function StockOrderCard({ order, now, view, openAction, canWrite }) {
  const item = (order.items && order.items[0]) || {};
  const ledger = view?.ledger;
  const receipts = (ledger?.installed && ledger.receipts[order.id]) || [];
  const receivedLines = new Set(receipts.map((r) => r.line));
  // Lines that are real stock (LXRTS or custom pieces) and not yet received.
  const receivable = (order.items || [])
    .map((it, i) => ({ it, i }))
    .filter(({ it, i }) => {
      const row = it?.product_id && view?.rowsById[it.product_id];
      return row && row.stock.tracked && !row.stock.unlimited && !receivedLines.has(i);
    });
  const closed = ["cancelled", "revoked"].includes(stockOrderStatusKey(order.status));
  const receivedInto = [...new Set(receipts.map((r) => (r.location_id ? ledger.locationsById[r.location_id]?.name || "a closed location" : "Unassigned")))];
  const statusKey = stockOrderStatusKey(order.status);
  const hoursLeft = Math.floor(STOCK_WINDOW_HOURS - hoursSince(order.created_at, now));
  const editable = isOpenStockOrder(order) && hoursLeft >= 0;
  const due = deliveryState(order, now);
  const pdfs = Array.isArray(order.warehouse_urls) ? order.warehouse_urls.filter(Boolean) : [];

  // Opens PDFs that already exist. Generating one uploads a file and updates
  // the order row (pdfUtils.downloadWarehousePdf) — existing order logic this
  // screen leaves alone. Generate them from the inventory dashboard's Stock Orders tab.
  const openPdfs = () => pdfs.forEach((url, i) => setTimeout(() => window.open(url, "_blank", "noopener"), i * 300));

  return (
    <article className="sr-so-card">
      <div className="sr-so-head">
        <div className="sr-so-hitem"><span className="sr-so-hlabel">Order no</span><span className="sr-so-hvalue">{order.order_no || "—"}</span></div>
        <div className="sr-so-hitem"><span className="sr-so-hlabel">Order date</span><span className="sr-so-hvalue">{formatDay(order.created_at)}</span></div>
        <div className="sr-so-hitem"><span className="sr-so-hlabel">Delivery</span><span className="sr-so-hvalue">{formatDay(order.delivery_date)}</span></div>
        <div className="sr-so-hitem"><span className="sr-so-hlabel">SA</span><span className="sr-so-hvalue">{order.salesperson || "—"}</span></div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Badge tone={STATUS_TONE[statusKey] || "gold"}>{stockOrderStatusLabel(order.status)}</Badge>
          {editable && <Badge tone="info">Editable ({hoursLeft}h)</Badge>}
          {due === "overdue" && <Badge tone="crit">Overdue</Badge>}
          {receipts.length > 0 && <Badge tone="ok">Received into {receivedInto.join(", ")}</Badge>}
        </div>
      </div>
      <div className="sr-so-content">
        <Thumb src={item.image_url} className="sr-so-thumb" size={160} />
        <div className="sr-so-det">
          <div className="sr-so-line"><span className="sr-so-label">Product name</span><span className="sr-so-value" title={item.product_name}>{item.product_name || "—"}</span></div>
          <div className="sr-so-line"><span className="sr-so-label">Category</span><span className="sr-so-value">{item.isKids ? "Kids" : "Women"}</span></div>
          <div className="sr-so-line"><span className="sr-so-label">Location</span><span className="sr-so-value">{order.mode_of_delivery || "—"}</span></div>
          <div className="sr-so-grid-det">
            <div className="sr-so-ditem"><span className="sr-so-label">Items</span><span className="sr-so-value">{order.items?.length || 0}</span></div>
            <div className="sr-so-ditem"><span className="sr-so-label">Qty</span><span className="sr-so-value">{order.total_quantity || 1}</span></div>
            <div className="sr-so-ditem"><span className="sr-so-label">Top</span><span className="sr-so-value">{item.top || "—"}<ColourDot colour={item.top_color} /></span></div>
            <div className="sr-so-ditem"><span className="sr-so-label">Bottom</span><span className="sr-so-value">{item.bottom || "—"}<ColourDot colour={item.bottom_color} /></span></div>
            <div className="sr-so-ditem"><span className="sr-so-label">Size</span><span className="sr-so-value">{item.size || "—"}</span></div>
            <div className="sr-so-ditem"><span className="sr-so-label">Type</span><span className="sr-so-value">Stock</span></div>
            {Array.isArray(item.extras) && item.extras.length > 0 && (
              <div className="sr-so-ditem is-wide">
                <span className="sr-so-label">Extras</span>
                <span className="sr-so-value is-wrap">
                  {item.extras.map((extra, i) => (
                    <span key={i}>{extra.name}<ColourDot colour={extra.color} />{i < item.extras.length - 1 ? " | " : ""}</span>
                  ))}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="sr-so-foot">
        <span>{order.items?.length > 1 ? `First of ${order.items.length} items shown` : due === "week" ? "Due within 7 days" : " "}</span>
        <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {canWrite && !closed && receivable.length > 0 && (
          <button type="button" className="sr-rowbtn" style={{ borderColor: "var(--sr-gold)" }}
            title="Add the pieces from this order to stock"
            onClick={() => openAction("receive", {
              orderId: order.id,
              reference: order.order_no,
              note: `Stock order ${order.order_no}`,
              lines: receivable.map(({ it, i }) => ({ productId: it.product_id, size: it.size || "", qty: Number(it.quantity) || 1, orderLine: i })),
            })}>
            Receive into stock{receipts.length ? ` (${receivable.length} left)` : ""}
          </button>
        )}
        <button type="button" className="sr-rowbtn" onClick={openPdfs} disabled={!pdfs.length}
          title={pdfs.length ? "Open the warehouse PDF" : "No warehouse PDF has been generated for this order yet"}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 13, height: 13, display: "inline-grid" }}><Icon name="doc" /></span>
            Warehouse PDF{pdfs.length > 1 ? `s (${pdfs.length})` : ""}
          </span>
        </button>
        </span>
      </div>
    </article>
  );
}

export default function StockOrdersScreen({ orders, ready = true, view, openAction, canWrite, user, canStartOrders, openBulkOrders }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [status, setStatus] = useState("");
  const [sa, setSa] = useState("");
  const [period, setPeriod] = useState("");
  const [delivery, setDelivery] = useState("");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("");
  const [design, setDesign] = useState("");
  const [size, setSize] = useState("");
  const [age, setAge] = useState("");
  // Fixed per visit so the filter memo is not invalidated on every render.
  const [now] = useState(() => Date.now());

  const statusOptions = useMemo(() => {
    const seen = new Map();
    orders.forEach((o) => {
      const k = stockOrderStatusKey(o.status);
      if (!seen.has(k)) seen.set(k, stockOrderStatusLabel(o.status));
    });
    return Array.from(seen, ([value, label]) => ({ value, label }));
  }, [orders]);

  const saOptions = useMemo(() => Array.from(new Set(orders.map((o) => o.salesperson).filter(Boolean)))
    .sort().map((name) => ({ value: name, label: name })), [orders]);

  const locationOptions = useMemo(() => Array.from(new Set(orders.map((o) => (o.mode_of_delivery || "").trim()).filter(Boolean)))
    .sort().map((v) => ({ value: v, label: v })), [orders]);
  const designOptions = useMemo(() => Array.from(new Set(orders.flatMap((o) => itemsOf(o).map((i) => i.product_name)).filter(Boolean)))
    .sort().map((v) => ({ value: v, label: v })), [orders]);
  const sizeOptions = useMemo(() => {
    const labels = Array.from(new Set(orders.flatMap((o) => itemsOf(o).map((i) => (i.size ? sizeLabel(i.size) : ""))).filter(Boolean)));
    const rank = (l) => { const i = SIZE_SCALE.indexOf(l); return i >= 0 ? i : 100; };
    return labels.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map((v) => ({ value: v, label: v }));
  }, [orders]);

  // Same hand-off to the order form the admin and GM dashboards use; the
  // order itself is placed by the existing flow, untouched.
  const raiseStockOrder = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) sessionStorage.setItem("associateSession", JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      user: { email: session.user?.email },
    }));
    sessionStorage.setItem("returnToAssociate", "true");
    sessionStorage.setItem("returnDashboard", "/stock-room?view=stockorders");
    sessionStorage.setItem("requirePasswordVerificationOnReturn", "true");
    sessionStorage.setItem("currentSalesperson", JSON.stringify({
      name: user.saleperson,
      email: user.email,
      phone: user.phone,
      store: user.store_name,
      designation: user.designation,
    }));
    startOrderMode("stock");
    navigate("/product", { state: { fromAssociate: true, isStockOrder: true } });
  };

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => orders.filter((o) => {
    if (location && (o.mode_of_delivery || "").trim() !== location) return false;
    if (category && !itemsOf(o).some((i) => (category === "kids") === !!i.isKids)) return false;
    if (design && !itemsOf(o).some((i) => i.product_name === design)) return false;
    if (size && !itemsOf(o).some((i) => i.size && sizeLabel(i.size) === size)) return false;
    if (age) {
      const editable = isOpenStockOrder(o) && hoursSince(o.created_at, now) <= STOCK_WINDOW_HOURS;
      if ((age === "editable") !== editable) return false;
    }
    if (status && stockOrderStatusKey(o.status) !== status) return false;
    if (sa && o.salesperson !== sa) return false;
    if (period && !(new Date(o.created_at).getTime() >= now - Number(period) * DAY)) return false;
    if (delivery && deliveryState(o, now) !== delivery) return false;
    if (!q) return true;
    const names = (o.items || []).map((i) => i?.product_name).join(" ");
    return [o.order_no, o.salesperson, names].some((v) => String(v || "").toLowerCase().includes(q));
  }), [orders, status, sa, period, delivery, location, category, design, size, age, q, now]);

  const filters = [status, sa, period, delivery, location, category, design, size, age];
  const [visible, more] = usePaged(filtered, 30, `${filters.join("|")}|${q}`);
  const open = orders.filter(isOpenStockOrder);
  const overdue = open.filter((o) => deliveryState(o, now) === "overdue").length;
  const activeCount = filters.filter(Boolean).length;
  const clearAll = () => {
    setStatus(""); setSa(""); setPeriod(""); setDelivery(""); setLocation(""); setCategory(""); setDesign(""); setSize(""); setAge("");
  };

  return (
    <>
      <Topline title="Stock orders"
        sub={ready
          ? `${formatUnits(orders.length)} retail stock orders · ${formatUnits(open.length)} open${overdue ? ` · ${overdue} overdue` : ""}`
          : "Loading stock orders…"}>
        <SearchField value={search} onChange={setSearch} placeholder="Order no, design or SA" label="Search stock orders" />
        <FilterButton count={activeCount} onClick={() => setDrawer(true)} />
        {/* Bulk upload sits with the single-order button: same job, many orders.
            It needs Stock Room write access only — the CSV carries the channel
            and the head, so there is nothing else to choose here. */}
        {canWrite && (
          <button type="button" className="sr-btn" onClick={openBulkOrders}><Icon name="upload" width={2} />Bulk upload</button>
        )}
        {canStartOrders && user?.can_place_stock_orders && (
          <button type="button" className="sr-btn sr-btn-primary" onClick={raiseStockOrder}><Icon name="plus" width={2} />Raise stock order</button>
        )}
      </Topline>
      <div className="sr-body">
        <ActiveFilters items={[
          { key: "status", label: "Status", value: status, display: statusOptions.find((s) => s.value === status)?.label, onClear: () => setStatus("") },
          { key: "sa", label: "SA", value: sa, onClear: () => setSa("") },
          { key: "period", label: "Ordered", value: period, display: PERIODS.find((p) => p.value === period)?.label, onClear: () => setPeriod("") },
          { key: "delivery", label: "Delivery", value: delivery, display: DELIVERY.find((d) => d.value === delivery)?.label, onClear: () => setDelivery("") },
          { key: "location", label: "Location", value: location, onClear: () => setLocation("") },
          { key: "category", label: "Category", value: category, display: CATEGORIES.find((c) => c.value === category)?.label, onClear: () => setCategory("") },
          { key: "design", label: "Design", value: design, onClear: () => setDesign("") },
          { key: "size", label: "Size", value: size, onClear: () => setSize("") },
          { key: "age", label: "Order age", value: age, display: AGES.find((a) => a.value === age)?.label, onClear: () => setAge("") },
        ]} />
        {!ready ? (
          <div className="sr-card"><div className="sr-state-box" style={{ padding: "32px 0", margin: "0 auto" }}><span className="sr-spinner" /><span className="sr-muted">Loading stock orders…</span></div></div>
        ) : filtered.length ? (
          <div className="sr-so-grid">
            {visible.map((o) => <StockOrderCard key={o.id} order={o} now={now} view={view} openAction={openAction} canWrite={canWrite} />)}
          </div>
        ) : (
          <div className="sr-card"><p className="sr-empty">{orders.length ? "No stock orders match these filters." : "No retail stock orders have been placed yet."}</p></div>
        )}
        {more}
      </div>
      {drawer && (
        <FilterDrawer sub={`${formatUnits(filtered.length)} of ${formatUnits(orders.length)} orders`} onClose={() => setDrawer(false)} onClear={clearAll}>
          <Facet label="Status" options={statusOptions} value={status} onChange={setStatus} />
          <Facet label="Delivery" options={DELIVERY} value={delivery} onChange={setDelivery} />
          <Facet label="Order date" options={PERIODS} value={period} onChange={setPeriod} />
          <Facet label="Order age" options={AGES} value={age} onChange={setAge} />
          <Facet label="Category" options={CATEGORIES} value={category} onChange={setCategory} />
          {locationOptions.length > 0 && <Facet label="Location" options={locationOptions} value={location} onChange={setLocation} />}
          {sizeOptions.length > 0 && <Facet label="Size" options={sizeOptions} value={size} onChange={setSize} />}
          {designOptions.length > 0 && (
            <div className="sr-facet">
              <span className="sr-label">Design</span>
              <SearchSelect options={designOptions} value={design} onChange={setDesign} placeholder="Any design" label="Design" />
            </div>
          )}
          {saOptions.length > 0 && (
            <div className="sr-facet">
              <span className="sr-label">Sales associate</span>
              <SearchSelect options={saOptions} value={sa} onChange={setSa} placeholder="Anyone" label="Sales associate" />
            </div>
          )}
        </FilterDrawer>
      )}
    </>
  );
}
