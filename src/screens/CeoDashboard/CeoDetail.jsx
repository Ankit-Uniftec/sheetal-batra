import React, { useMemo } from "react";
import formatDate from "../../utils/formatDate";
import { getOrderStatusLabel, getStageLabel, normalizeOrderStatus } from "../../utils/barcodeService";
import { isSaleOrder } from "../../utils/revenue";
import { orderRevenue, shortInr, sumRevenue } from "./ceoInsights";
import { channelProfile, clientProfile, designProfile, personProfile } from "./ceoOwner";
import { Drawer, Empty, fullInr, Icon, num, RankBars, Spark, Thumb } from "./CeoUi";

// ============================================================
// The panel behind every click. Any number, name or row on the dashboard opens a
// layer here; each layer links on to the next (design → client → order), and the
// back arrow walks the way home.
// ============================================================

const Stat = ({ label, value, title, tone }) => (
  <div className="ceo-dstat">
    <small>{label}</small>
    <b className={tone ? `is-${tone}` : undefined} title={title}>{value}</b>
  </div>
);

const Pills = ({ title, rows, format = (v) => num(v) }) => (rows?.length ? (
  <div className="ceo-dblock">
    <span className="ceo-label">{title}</span>
    <div className="ceo-dpills">
      {rows.map((r) => <span key={r.name}>{r.name}<em>{format(r.value)}</em></span>)}
    </div>
  </div>
) : null);

const Section = ({ title, children }) => (
  <div className="ceo-dblock">
    <span className="ceo-label">{title}</span>
    {children}
  </div>
);

const statusTone = (o) => {
  const s = normalizeOrderStatus(o.status);
  if (s === "cancelled") return "crit";
  if (s === "delivered" || s === "completed") return "ok";
  return "gold";
};

export function OrderList({ orders, open, limit = 40 }) {
  if (!orders?.length) return <Empty text="No orders here." />;
  return (
    <div className="ceo-olist">
      {orders.slice(0, limit).map((o) => (
        <button key={o.id} type="button" onClick={() => open({ type: "order", order: o })}>
          <Thumb src={o.items?.[0]?.image_url} alt="" />
          <span className="ceo-olist-main">
            <b title={o.delivery_name}>{o.delivery_name || o.order_no}</b>
            <small title={o.items?.[0]?.product_name}>{o.items?.[0]?.product_name || "–"}{(o.items?.length || 0) > 1 ? ` +${o.items.length - 1} more` : ""}</small>
            <small>{o.order_no} · {formatDate(o.created_at)}</small>
          </span>
          <span className="ceo-olist-val">
            <b>{shortInr(orderRevenue(o))}</b>
            <i className={`ceo-pill is-${statusTone(o)}`}>{getOrderStatusLabel(o.status)}</i>
          </span>
        </button>
      ))}
      {orders.length > limit && <p className="ceo-foot">Showing the first {limit} of {num(orders.length)}. The Orders page has them all.</p>}
    </div>
  );
}

function OrderDetail({ order, ctx, open, close }) {
  const o = order;
  const total = orderRevenue(o);
  const paid = Number(o.total_paid ?? o.advance_payment) || 0;
  const balance = Math.max(0, Number(o.remaining_payment) || 0);
  const person = ctx.personOf(o);
  const lateBy = o.delivery_date && ["order_received"].includes(normalizeOrderStatus(o.status))
    ? Math.floor((Date.now() - new Date(o.delivery_date).getTime()) / 864e5) : 0;
  return (
    <>
      <div className="ceo-dstats">
        <Stat label="Order Value" value={shortInr(total)} title={fullInr(total)} />
        <Stat label="Amount Received" value={shortInr(paid)} title={fullInr(paid)} />
        <Stat label="Balance Due" value={shortInr(balance)} title={fullInr(balance)} tone={balance > 0 ? "warn" : undefined} />
      </div>
      <Section title="Items Ordered">
        <div className="ceo-ditems">
          {(o.items || []).map((it, i) => (
            <button key={`${it.product_name}-${i}`} type="button" onClick={() => open({ type: "design", name: it.product_name })}>
              <Thumb src={it.image_url} alt={it.product_name} />
              <span>
                <b>{it.product_name || "–"}</b>
                <small>
                  {[it.size && `Size ${it.size}`, it.top_color?.name || it.color?.name, Number(it.quantity) > 1 && `Qty ${it.quantity}`].filter(Boolean).join(" · ")}
                </small>
              </span>
              <Icon name="chevron" width={1.6} />
            </button>
          ))}
        </div>
      </Section>
      <Section title="Order Details">
        <dl className="ceo-dl">
          <dt>Status</dt><dd><i className={`ceo-pill is-${statusTone(o)}`}>{getOrderStatusLabel(o.status)}</i></dd>
          {o.warehouse_stage && <><dt>Production Stage</dt><dd>{getStageLabel(o.warehouse_stage)}</dd></>}
          <dt>Order Date</dt><dd>{formatDate(o.created_at)}</dd>
          {o.delivery_date && <><dt>Promised Delivery Date</dt><dd>{formatDate(o.delivery_date)}{lateBy > 0 ? <em className="ceo-text-crit"> · {lateBy} days late</em> : null}</dd></>}
          {o.delivered_at && <><dt>Delivered On</dt><dd>{formatDate(o.delivered_at)}</dd></>}
          <dt>Sales Channel</dt><dd><button type="button" className="ceo-inline" onClick={() => open({ type: "channel", name: ctx.channelOf(o) })}>{ctx.channelOf(o)}</button></dd>
          {person && <><dt>Sold By</dt><dd><button type="button" className="ceo-inline" onClick={() => open({ type: "person", name: person })}>{person}</button></dd></>}
          {Number(o.discount_amount) > 0 && <><dt>Discount</dt><dd>{fullInr(o.discount_amount)}{o.discount_code ? ` (${o.discount_code})` : ""}</dd></>}
          {o.delivery_phone && <><dt>Client</dt><dd><button type="button" className="ceo-inline" onClick={() => open({ type: "client", phone: o.delivery_phone })}>{o.delivery_name || o.delivery_phone}</button></dd></>}
          {o.delivery_city && <><dt>City</dt><dd>{o.delivery_city}</dd></>}
          {o.cancellation_reason && <><dt>Cancellation Reason</dt><dd>{o.cancellation_reason}</dd></>}
        </dl>
      </Section>
      <button type="button" className="ceo-btn is-primary is-block" onClick={() => { close(); ctx.navigate(`/order/${o.id}`); }}>Open Full Order</button>
    </>
  );
}

function ClientDetail({ phone, ctx, open }) {
  const p = useMemo(() => clientProfile(ctx.allOrders, phone), [ctx.allOrders, phone]);
  return (
    <>
      <div className="ceo-dstats">
        <Stat label="Lifetime Spend" value={shortInr(p.spend)} title={fullInr(p.spend)} />
        <Stat label="Orders" value={num(p.count)} />
        <Stat label="Average Order Value" value={shortInr(p.aov)} />
        <Stat label="Balance Due" value={shortInr(p.balance)} tone={p.balance > 0 ? "warn" : undefined} />
      </div>
      <dl className="ceo-dl">
        {p.phone && <><dt>Phone</dt><dd><a className="ceo-inline" href={`tel:${p.phone}`}>{p.phone}</a></dd></>}
        {p.email && <><dt>Email</dt><dd>{p.email}</dd></>}
        {p.city && <><dt>City</dt><dd>{p.city}</dd></>}
        {p.first && <><dt>First Order</dt><dd>{formatDate(p.first)}</dd></>}
        {p.last && <><dt>Latest Order</dt><dd>{formatDate(p.last)}</dd></>}
      </dl>
      {p.designs.length > 0 && (
        <Section title="Top Designs Bought">
          <RankBars rows={p.designs} limit={5} onRow={(r) => open({ type: "design", name: r.name })} />
        </Section>
      )}
      <Pills title="Sizes Ordered" rows={p.sizes} />
      <Pills title="Colours Ordered" rows={p.colours} />
      <Pills title="Sales Associates" rows={p.people} />
      <Section title={`All Orders (${num(p.orders.length)})`}><OrderList orders={p.orders} open={open} /></Section>
    </>
  );
}

function DesignDetail({ name, ctx, open }) {
  const p = useMemo(() => designProfile(ctx.allSales, name, ctx.inPeriod, ctx.products), [ctx.allSales, name, ctx.inPeriod, ctx.products]);
  return (
    <>
      <div className="ceo-dhero">
        <Thumb src={p.image} alt={p.name} large />
        <div className="ceo-dstats is-stack">
          <Stat label={`Sales, ${ctx.periodName}`} value={shortInr(p.periodRevenue)} title={`${num(p.periodPieces)} pieces`} />
          <Stat label="Lifetime Sales" value={shortInr(p.lifetime)} title={fullInr(p.lifetime)} />
          <Stat label="Pieces Sold" value={num(p.pieces)} />
          {p.product?.base_price > 0 && <Stat label="Price" value={fullInr(p.product.base_price)} />}
        </div>
      </div>
      {p.product?.sku_id && <p className="ceo-foot">SKU {p.product.sku_id}</p>}
      <Section title="Sales, Last 6 Months"><div className="ceo-dspark"><Spark data={p.trend} /></div></Section>
      <Pills title="Sizes" rows={p.sizes} />
      <Pills title="Colours" rows={p.colours} />
      {p.people.length > 0 && <Section title="Top Sales Associates"><RankBars rows={p.people} limit={5} onRow={(r) => open({ type: "person", name: r.name })} /></Section>}
      <Section title={`Recent Orders (${num(p.orders.length)})`}><OrderList orders={p.orders} open={open} limit={15} /></Section>
    </>
  );
}

function PersonDetail({ name, ctx, open }) {
  const target = ctx.saProgress.find((s) => s.name === name)?.target || 0;
  const p = useMemo(() => personProfile(ctx.allSales, ctx.personOf, name, ctx.inPeriod, target), [ctx.allSales, ctx.personOf, name, ctx.inPeriod, target]);
  const pct = p.target > 0 ? (p.month / p.target) * 100 : null;
  return (
    <>
      <div className="ceo-dstats">
        <Stat label={`Sales, ${ctx.periodName}`} value={shortInr(p.revenue)} title={fullInr(p.revenue)} />
        <Stat label="Orders" value={num(p.count)} />
        <Stat label="Average Order Value" value={shortInr(p.aov)} />
        <Stat label="Discount Rate" value={`${p.discountRate.toFixed(0)}%`} tone={p.discountRate > 25 ? "warn" : undefined} />
      </div>
      {pct != null && (
        <Section title="Monthly Target Achieved">
          <div className="ceo-meter is-wide">
            <span><i style={{ width: `${Math.min(100, pct)}%`, background: "#b8922e" }} /></span>
            <b>{pct.toFixed(0)}%</b>
          </div>
          <p className="ceo-foot">{shortInr(p.month)} of {shortInr(p.target)}</p>
        </Section>
      )}
      <Section title="Sales, Last 6 Months"><div className="ceo-dspark"><Spark data={p.trend} /></div></Section>
      {p.designs.length > 0 && <Section title="Top Designs Sold"><RankBars rows={p.designs} limit={5} onRow={(r) => open({ type: "design", name: r.name })} /></Section>}
      <Section title={`Orders This Period (${num(p.orders.length)})`}><OrderList orders={p.orders} open={open} limit={25} /></Section>
    </>
  );
}

function ChannelDetail({ name, ctx, open }) {
  const p = useMemo(() => channelProfile(ctx.allSales, ctx.channelOf, ctx.personOf, name, ctx.inPeriod), [ctx.allSales, ctx.channelOf, ctx.personOf, name, ctx.inPeriod]);
  return (
    <>
      <div className="ceo-dstats">
        <Stat label={`Sales, ${ctx.periodName}`} value={shortInr(p.revenue)} title={fullInr(p.revenue)} />
        <Stat label="Orders" value={num(p.count)} />
        <Stat label="Average Order Value" value={shortInr(p.aov)} />
      </div>
      <Section title="Sales, Last 6 Months"><div className="ceo-dspark"><Spark data={p.trend} /></div></Section>
      {p.designs.length > 0 && <Section title="Top Designs"><RankBars rows={p.designs} limit={5} onRow={(r) => open({ type: "design", name: r.name })} /></Section>}
      {p.people.length > 0 && <Section title="Top Sales Associates"><RankBars rows={p.people} limit={5} onRow={(r) => open({ type: "person", name: r.name })} /></Section>}
      <Section title={`Orders This Period (${num(p.orders.length)})`}><OrderList orders={p.orders} open={open} limit={25} /></Section>
    </>
  );
}

function ExhibitionDetail({ exhibition: e, open }) {
  return (
    <>
      <div className="ceo-dstats">
        <Stat label="Total Sales" value={shortInr(e.gross)} title={fullInr(e.gross)} />
        <Stat label="Net Revenue After Partner Share" value={shortInr(e.net)} title={fullInr(e.net)} />
        <Stat label="Orders" value={num(e.count)} />
      </div>
      <dl className="ceo-dl">
        <dt>Location</dt><dd>{[e.location, e.country].filter(Boolean).join(", ") || "–"}</dd>
        <dt>Dates</dt><dd>{e.start_date ? formatDate(e.start_date) : "–"} to {e.end_date ? formatDate(e.end_date) : "–"}</dd>
        <dt>Partner</dt><dd>{e.company_name || "–"} ({e.commission_split}% partner share)</dd>
        <dt>Sheetal Batra Representative</dt><dd>{e.sb_representative || "–"}</dd>
      </dl>
      <Section title="Exhibition Orders"><OrderList orders={e.orders} open={open} limit={30} /></Section>
    </>
  );
}

function VendorDetail({ vendor: v, ctx, open }) {
  const byId = useMemo(() => Object.fromEntries(ctx.allOrders.map((o) => [o.id, o])), [ctx.allOrders]);
  const overdueOrders = useMemo(() => {
    const seen = new Set();
    return v.overdue.map((m) => byId[m.order_id]).filter((o) => o && !seen.has(o.id) && seen.add(o.id));
  }, [v, byId]);
  return (
    <>
      <div className="ceo-dstats">
        <Stat label="Pieces Out Now" value={num(v.outNow)} />
        <Stat label="Past Return Date" value={num(v.pastDate)} tone={v.pastDate ? "warn" : undefined} />
        <Stat label="Pieces Returned" value={num(v.returned)} />
        <Stat label="On-Time Return Rate" value={v.onTimeRate == null ? "–" : `${v.onTimeRate.toFixed(0)}%`} />
      </div>
      <dl className="ceo-dl">
        {v.location && <><dt>Location</dt><dd>{v.location}</dd></>}
        <dt>Returned Late</dt><dd>{num(v.late)} of {num(v.returned)} pieces, {ctx.periodName.toLowerCase()}</dd>
        {v.averageDaysLate != null && <><dt>Average Days Late</dt><dd>{v.averageDaysLate.toFixed(1)} days</dd></>}
        {v.averageDaysOut != null && <><dt>Average Days Out</dt><dd>{v.averageDaysOut.toFixed(1)} days</dd></>}
      </dl>
      <Pills title="Work Given (Pieces)" rows={v.work} />
      <Section title={`Orders With Pieces Past Return Date (${num(overdueOrders.length)})`}>
        <OrderList orders={overdueOrders} open={open} limit={40} />
      </Section>
    </>
  );
}

const titleOf = (layer, ctx) => {
  switch (layer.type) {
    case "order": return { title: layer.order.order_no || "Order", sub: layer.order.delivery_name };
    case "client": return { title: clientProfile(ctx.allOrders, layer.phone).name, sub: "Client" };
    case "design": return { title: layer.name, sub: "Design" };
    case "person": return { title: layer.name, sub: "Team Member" };
    case "channel": return { title: layer.name, sub: "Sales Channel" };
    case "exhibition": return { title: layer.exhibition.name, sub: "Exhibition" };
    case "vendor": return { title: layer.vendor.name, sub: "Vendor" };
    default: return { title: layer.title, sub: layer.sub };
  }
};

/** Draws the top layer of the stack. */
export default function CeoDetail({ stack, setStack, ctx }) {
  if (!stack.length) return null;
  const layer = stack[stack.length - 1];
  const open = (next) => setStack((s) => [...s, next]);
  const close = () => setStack([]);
  const back = stack.length > 1 ? () => setStack((s) => s.slice(0, -1)) : undefined;
  const { title, sub } = titleOf(layer, ctx);

  let body;
  if (layer.type === "order") body = <OrderDetail order={layer.order} ctx={ctx} open={open} close={close} />;
  else if (layer.type === "client") body = <ClientDetail phone={layer.phone} ctx={ctx} open={open} />;
  else if (layer.type === "design") body = <DesignDetail name={layer.name} ctx={ctx} open={open} />;
  else if (layer.type === "person") body = <PersonDetail name={layer.name} ctx={ctx} open={open} />;
  else if (layer.type === "channel") body = <ChannelDetail name={layer.name} ctx={ctx} open={open} />;
  else if (layer.type === "exhibition") body = <ExhibitionDetail exhibition={layer.exhibition} open={open} />;
  else if (layer.type === "vendor") body = <VendorDetail vendor={layer.vendor} ctx={ctx} open={open} />;
  else {
    const sales = (layer.orders || []).filter(isSaleOrder);
    body = (
      <>
        <div className="ceo-dstats">
          <Stat label="Orders" value={num(layer.orders?.length)} />
          <Stat label="Total Order Value" value={shortInr(sumRevenue(sales))} title={fullInr(sumRevenue(sales))} />
        </div>
        {layer.note && <p className="ceo-dnote">{layer.note}</p>}
        <OrderList orders={layer.orders} open={open} limit={60} />
        {layer.tab && (
          <button type="button" className="ceo-btn is-block" onClick={() => { close(); ctx.go(layer.tab); }}>{layer.tabLabel || "Open Full Page"}</button>
        )}
      </>
    );
  }
  return <Drawer title={title} sub={sub} onClose={close} onBack={back}>{body}</Drawer>;
}
