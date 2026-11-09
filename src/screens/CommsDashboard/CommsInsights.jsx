import React, { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import formatDate from "../../utils/formatDate";
import { isOrderStillRunning } from "../../utils/productionMetrics";
import { supabase } from "../../lib/supabaseClient";
import { shortInr } from "../CeoDashboard/ceoInsights";
import { Drawer, Empty, Icon, Pager, RankBars, Thumb, fullInr, num } from "../CeoDashboard/CeoUi";
import { CsvButton, Stat, defineKit, slug } from "../CeoDashboard/dashKit";
import downloadCsv from "../../utils/downloadCsv";
import { CARD_INFO, COLUMN_INFO, TILE_INFO } from "./commsDefinitions";
import { loadCommsEvents } from "./CommsCalendar";

// ============================================================
// Comms insights: the Needs Your Attention list, the monthly trend, occasions,
// agencies and request sources, return condition, recipient history and data
// gaps. Each is worked out from the Comms orders, PR records, blocks and
// calendar events; nothing is typed in.
// ============================================================

const { Card, Table } = defineKit({ tiles: TILE_INFO, cards: CARD_INFO, columns: COLUMN_INFO });
const two = (n) => String(n).padStart(2, "0");
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };
const dateOnly = (v) => String(v || "").slice(0, 10);
const ordersN = (n) => `${num(n)} ${Number(n) === 1 ? "order" : "orders"}`;
const ENGAGEMENTS = ["Barter", "Gifting", "Sourcing", "Personal order"];
const ENG_COLOURS = { Barter: "#2f6f73", Gifting: "#8a9a5b", Sourcing: "#c9785a", "Personal order": "#7b3a5e" };
const isLive = (o) => o.approval_status !== "rejected" && String(o.status || "").toLowerCase() !== "cancelled";
const DONE = ["completed", "delivered", "dispatched"];

/** The same person however their name was typed: trimmed, single spaces, any case. */
export const recipientKey = (o) => String(o.delivery_name || "").trim().replace(/\s+/g, " ").toLowerCase();
const tidy = (v) => String(v || "").trim().replace(/\s+/g, " ");

/** Group by a text field, ignoring case and spacing; shows the most common spelling. */
function groupText(list, valueOf) {
  const m = {};
  list.forEach((o) => {
    const raw = tidy(valueOf(o));
    if (!raw) return;
    const k = raw.toLowerCase();
    const g = m[k] || (m[k] = { key: k, spellings: {}, value: 0, list: [] });
    g.spellings[raw] = (g.spellings[raw] || 0) + 1;
    g.value += 1;
    g.list.push(o);
  });
  return Object.values(m).map((g) => ({ ...g, name: Object.entries(g.spellings).sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => b.value - a.value);
}

/** Orders where the same design went to the same recipient more than once. */
function repeatDesigns(orders) {
  const m = {};
  orders.filter(isLive).forEach((o) => {
    const who = recipientKey(o);
    if (!who) return;
    (o.items || []).forEach((it) => {
      if (!it.product_name) return;
      const k = `${who}|${it.product_name.toLowerCase()}`;
      const g = m[k] || (m[k] = { who: tidy(o.delivery_name), design: it.product_name, list: [] });
      if (!g.list.includes(o)) g.list.push(o);
    });
  });
  return Object.values(m).filter((g) => g.list.length > 1);
}

// ------------------------------------------------------------ NEEDS YOUR ATTENTION
const TAG = { crit: "Act now", warn: "Follow up", gold: "Today" };
export function AttentionCard({ ctx }) {
  const { orders, prRecords, openOrders, go } = ctx;
  const [blocks, setBlocks] = useState([]);
  const [events, setEvents] = useState([]);
  useEffect(() => {
    supabase.from("comms_inventory_blocks").select("id, end_date").eq("status", "active").then(({ data }) => setBlocks(data || []));
    loadCommsEvents(ctx.profile?.email).then(setEvents).catch(() => setEvents([]));
  }, [ctx.profile?.email]);

  const items = useMemo(() => {
    const today = todayKey();
    const live = orders.filter(isLive);
    const overdue = live.filter((o) => o.comms_engagement_type === "Sourcing" && o.comms_return_status !== "Returned" && o.comms_outfit_return_date && dateOnly(o.comms_outfit_return_date) < today);
    const late = live.filter((o) => o.approval_status !== "pending_approval" && isOrderStillRunning(o) && o.delivery_date && dateOnly(o.delivery_date) < today);
    const noPr = live.filter((o) => o.comms_engagement_type && o.comms_engagement_type !== "Personal order" && o.approval_status !== "pending_approval"
      && DONE.includes(String(o.status || "").toLowerCase()) && !prRecords[o.id]);
    const repeats = repeatDesigns(orders);
    const repeatOrders = [...new Set(repeats.flatMap((g) => g.list))];
    const dueToday = live.filter((o) => dateOnly(o.delivery_date) === today);
    const endedBlocks = blocks.filter((b) => b.end_date < today);
    const eventsToday = events.filter((e) => e.event_date === today);
    return [
      { key: "overdue", label: "Sourcing outfits past their return date", count: overdue.length, tone: "crit", open: () => openOrders({ title: "Overdue Sourcing Returns", sub: "Past the return date, not marked returned", orders: overdue }) },
      { key: "late", label: "Orders past their delivery date, still in production", count: late.length, tone: "crit", open: () => openOrders({ title: "Past Delivery Date", sub: "Still in production after the promised date", orders: late }) },
      { key: "nopr", label: "Completed orders with no PR record yet", count: noPr.length, tone: "warn", open: () => openOrders({ title: "PR Record Missing", sub: "Completed barter, gifting and sourcing orders", orders: noPr }) },
      { key: "repeat", label: "Same design sent to the same person more than once", count: repeats.length, tone: "warn", open: () => openOrders({ title: "Same Design, Same Person", sub: repeats.map((g) => `${g.who}: ${g.design}`).join(" · "), orders: repeatOrders }) },
      { key: "today", label: "Deliveries due today", count: dueToday.length, tone: "gold", open: () => openOrders({ title: "Deliveries Due Today", sub: formatDate(today), orders: dueToday }) },
      { key: "events", label: "Your calendar events today", count: eventsToday.length, tone: "gold", open: () => go("calendar") },
      { key: "blocks", label: "Blocks that ended but were never released", count: endedBlocks.length, tone: "warn", open: () => go("inventory") },
    ];
  }, [orders, prRecords, blocks, events, openOrders, go]);
  const shown = items.filter((i) => i.count > 0);

  return (
    <Card span={12} title="Needs Your Attention" sub={shown.length ? "Click a line to see the orders" : undefined}>
      {!shown.length ? <Empty text="Nothing needs your attention right now." /> : (
        <div className="comms-attention">
          {shown.map((i) => (
            <button key={i.key} type="button" className="comms-attn" onClick={i.open}>
              <b className="comms-attn-num">{num(i.count)}</b>
              <span className="comms-attn-text">{i.label}</span>
              <i className={`comms-attn-tag is-${i.tone}`}>{TAG[i.tone]}</i>
              <Icon name="chevron" />
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------ MONTHLY TREND
const TrendTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="ceo-tip">
      <b>{label}</b>
      {payload.filter((p) => p.value).map((p) => <span key={p.dataKey}><i style={{ background: p.fill }} />{p.name}: {num(p.value)}</span>)}
      <span>Notional value: {fullInr(row.notional)}</span>
    </div>
  );
};

export function TrendCard({ ctx }) {
  const { orders, openOrders } = ctx;
  const months = useMemo(() => {
    const now = new Date();
    const out = [];
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({ key: `${d.getFullYear()}-${two(d.getMonth() + 1)}`, label: d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }), list: [], notional: 0, ...Object.fromEntries(ENGAGEMENTS.map((e) => [e, 0])) });
    }
    const byKey = Object.fromEntries(out.map((m) => [m.key, m]));
    orders.filter(isLive).forEach((o) => {
      const d = new Date(o.created_at);
      const m = byKey[`${d.getFullYear()}-${two(d.getMonth() + 1)}`];
      if (!m) return;
      m.list.push(o);
      m.notional += ctx.notionalOf(o);
      if (ENGAGEMENTS.includes(o.comms_engagement_type)) m[o.comms_engagement_type] += 1;
    });
    const first = out.findIndex((m) => m.list.length);
    return first < 0 ? [] : out.slice(first);
  }, [orders, ctx]);
  // Each bar carries its own month, so a click anywhere on a stack opens that month.
  const pick = (bar) => {
    const row = bar?.payload || bar;
    if (row?.list) openOrders({ title: row.label, sub: `Comms orders placed in ${row.label}`, orders: row.list });
  };
  return (
    <Card span={7} title="Monthly Trend" sub="Comms orders placed each month, by engagement. Click a month to see its orders.">
      {!months.length ? <Empty /> : (
        <div style={{ width: "100%", height: 260, cursor: "pointer" }}>
          <ResponsiveContainer initialDimension={{ width: 1, height: 1 }}>
            <BarChart data={months} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#f1ede2" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#8a8478" }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#8a8478" }} axisLine={false} tickLine={false} width={30} />
              <Tooltip content={<TrendTip />} cursor={{ fill: "rgba(184,146,46,.07)" }} />
              {ENGAGEMENTS.map((e, i) => <Bar key={e} dataKey={e} name={e} stackId="eng" fill={ENG_COLOURS[e]} radius={i === ENGAGEMENTS.length - 1 ? [5, 5, 0, 0] : 0} maxBarSize={42} isAnimationActive={false} onClick={pick} style={{ cursor: "pointer" }} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="comms-legend">{ENGAGEMENTS.map((e) => <span key={e}><i style={{ background: ENG_COLOURS[e] }} />{e}</span>)}</div>
    </Card>
  );
}

// ------------------------------------------------------------ OCCASIONS, AGENCIES, SOURCES, RETURNS
export function MixCards({ ctx, placed }) {
  const { orders, openOrders, periodName } = ctx;
  const occasions = useMemo(() => groupText(placed, (o) => o.comms_purpose), [placed]);
  const agencies = useMemo(() => groupText(placed, (o) => o.comms_agency_name), [placed]);
  const sources = useMemo(() => groupText(placed, (o) => o.comms_request_source), [placed]);
  const returned = useMemo(() => groupText(orders.filter((o) => o.comms_return_status === "Returned"), (o) => o.comms_return_condition), [orders]);
  const open = (title, sub) => (r) => openOrders({ title: r.name, sub, orders: r.list });
  return (
    <>
      <Card span={5} title="By Occasion" sub={`What the outfits were for, ${periodName.toLowerCase()}`}>
        <RankBars rows={occasions} limit={8} format={(v) => ordersN(v)} onRow={open("By Occasion", `Comms orders for this occasion, ${periodName.toLowerCase()}`)} />
      </Card>
      <Card span={4} md={6} title="By Agency" sub={periodName}>
        <RankBars rows={agencies} limit={6} format={(v) => ordersN(v)} colorOf={() => "#2f6f73"} onRow={open("By Agency", `Comms orders through this agency, ${periodName.toLowerCase()}`)} />
      </Card>
      <Card span={4} md={6} title="By Request Source" sub={periodName}>
        <RankBars rows={sources} limit={6} format={(v) => ordersN(v)} colorOf={() => "#6d6a9c"} onRow={open("By Request Source", periodName)} />
      </Card>
      <Card span={4} md={6} title="Return Condition" sub="How sourcing outfits came back, all time">
        <RankBars rows={returned} limit={6} format={(v) => ordersN(v)} colorOf={(r) => (/perfect/i.test(r.name) ? "#8a9a5b" : "#c9785a")} onRow={open("Return Condition", "Sourcing outfits returned in this condition")} />
      </Card>
    </>
  );
}

// ------------------------------------------------------------ RECIPIENTS
export function RecipientsCard({ ctx, placed }) {
  const { orders, openRecipient, periodName } = ctx;
  const rows = useMemo(() => {
    const m = {};
    placed.forEach((o) => {
      const k = recipientKey(o);
      if (!k) return;
      const g = m[k] || (m[k] = { key: k, name: tidy(o.delivery_name), value: 0, notional: 0 });
      g.value += 1; g.notional += ctx.notionalOf(o);
    });
    const allTime = {};
    orders.filter(isLive).forEach((o) => { const k = recipientKey(o); if (k) allTime[k] = (allTime[k] || 0) + 1; });
    return Object.values(m).map((g) => ({ ...g, allTime: allTime[g.key] || g.value })).sort((a, b) => b.value - a.value || b.notional - a.notional);
  }, [placed, orders, ctx]);
  const repeat = useMemo(() => {
    const allTime = {};
    orders.filter(isLive).forEach((o) => { const k = recipientKey(o); if (k) allTime[k] = (allTime[k] || 0) + 1; });
    return Object.values(allTime).filter((n) => n > 1).length;
  }, [orders]);
  return (
    <Card span={7} title="Top Recipients" sub={`${periodName}. ${num(repeat)} people have received more than once. Click a name for their full history.`}>
      <RankBars rows={rows} limit={10} format={(v) => ordersN(v)} sub={(r) => `${shortInr(r.notional)} notional · ${ordersN(r.allTime)} all time`} onRow={(r) => openRecipient(r.name)} />
    </Card>
  );
}

/** Everything ever sent to one person: orders, designs, PR, and repeats of the same design. */
export function RecipientDrawer({ ctx, name, onClose, onBack }) {
  const { orders, prRecords, openOrder } = ctx;
  const [page, setPage] = useState(1);
  const key = String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
  const list = useMemo(() => orders.filter((o) => recipientKey(o) === key).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), [orders, key]);
  const live = list.filter(isLive);
  const repeats = repeatDesigns(list);
  const repeatNames = new Set(repeats.map((g) => g.design.toLowerCase()));
  const value = live.reduce((s, o) => s + ctx.notionalOf(o), 0);
  const withPr = live.filter((o) => prRecords[o.id]).length;
  return (
    <Drawer wide title={tidy(name)} sub={`${ordersN(list.length)} · first ${list.length ? formatDate(list[list.length - 1].created_at) : "–"} · latest ${list.length ? formatDate(list[0].created_at) : "–"}`} onClose={onClose} onBack={onBack}>
      <div className="ceo-dstats">
        <Stat label="Orders" info="Comms orders sent to this person, not counting cancelled or rejected ones."><b>{num(live.length)}</b></Stat>
        <Stat label="Notional Value" info="The full price of the outfits sent to this person."><b title={fullInr(value)}>{shortInr(value)}</b></Stat>
        <Stat label="PR Captured" info="Of these orders, how many have a PR record filled in."><b>{num(withPr)} of {num(live.length)}</b></Stat>
      </div>
      {repeats.length > 0 && (
        <div className="comms-flag">
          <Icon name="alert" />
          <span>The same design was sent more than once: {repeats.map((g) => `${g.design} (${g.list.length} times)`).join(", ")}.</span>
        </div>
      )}
      <div className="gm-actions"><CsvButton disabled={!list.length} onClick={() => downloadCsv({
        filename: `comms_recipient_${slug(name)}`,
        headers: ["Order No", "Order Date", "Engagement", "Purpose", "Agency", "Designs", "Notional Value", "Status", "PR Record"],
        rows: list.map((o) => [o.order_no, formatDate(o.created_at), o.comms_engagement_type || "", o.comms_purpose || "", o.comms_agency_name || "", (o.items || []).map((it) => it.product_name).join(" | "), Math.round(ctx.notionalOf(o)), ctx.statusOf(o, ctx.componentsByOrder[o.id]), prRecords[o.id] ? "Captured" : "Not captured"]),
      })} /></div>
      <Table
        rowKey={(r) => r.id}
        rows={list.slice((page - 1) * 12, page * 12)}
        onRow={openOrder}
        columns={[
          { key: "order", label: "Order", render: (o) => <span className="ceo-ocell"><Thumb src={o.items?.[0]?.image_url} alt="" /><span><b>{(o.items || []).map((it) => it.product_name).join(", ") || o.order_no}</b><small>{o.order_no} · {formatDate(o.created_at)}{(o.items || []).some((it) => repeatNames.has(String(it.product_name || "").toLowerCase())) ? <i className="ceo-pill is-warn"> Sent before</i> : null}</small></span></span> },
          { key: "eng", label: "Engagement", hide: true, render: (o) => o.comms_engagement_type || "–" },
          { key: "pr", label: "PR Record", right: true, render: (o) => <i className={`ceo-pill is-${prRecords[o.id] ? "ok" : "warn"}`}>{prRecords[o.id] ? "Captured" : "Not captured"}</i> },
        ]}
      />
      <Pager page={page} pages={Math.ceil(list.length / 12)} onChange={setPage} />
    </Drawer>
  );
}

// ------------------------------------------------------------ DATA GAPS
export function DataGapsCard({ ctx }) {
  const { orders, openOrders } = ctx;
  const gaps = useMemo(() => {
    const live = orders.filter(isLive);
    const agencyLike = (o) => o.comms_request_source === "Agency";
    return [
      { key: "challan", label: "Challan number not filled in", list: live.filter((o) => !tidy(o.comms_challan_no)) },
      { key: "profile", label: "Profile type (celebrity, influencer, stylist…) not filled in", list: live.filter((o) => !tidy(o.comms_profile_type)) },
      { key: "agency", label: "Agency order with the agency missing, or the purpose typed in the agency field", list: live.filter((o) => agencyLike(o) && (!tidy(o.comms_agency_name) || tidy(o.comms_agency_name).toLowerCase() === tidy(o.comms_purpose).toLowerCase())) },
      { key: "poc", label: "Point of contact not filled in", list: live.filter((o) => !tidy(o.comms_poc_name)) },
      { key: "return", label: "Sourcing order with no return date", list: live.filter((o) => o.comms_engagement_type === "Sourcing" && !o.comms_outfit_return_date) },
    ].filter((g) => g.list.length);
  }, [orders]);
  const total = orders.filter(isLive).length;
  return (
    <Card span={5} title="Data Gaps" sub="Details missing on Comms orders. Filling them in makes reports and insights complete.">
      {!gaps.length ? <Empty text="Every Comms order has its details filled in." /> : (
        <div className="comms-gaps">
          {gaps.map((g) => (
            <button key={g.key} type="button" className="comms-gap" onClick={() => openOrders({ title: g.label, sub: "Open an order to see it, or edit it within 48 hours of placing it", orders: g.list })}>
              <span className="comms-gap-bar"><i style={{ width: `${Math.max(3, (g.list.length / Math.max(1, total)) * 100)}%` }} /></span>
              <span className="comms-gap-text"><b>{num(g.list.length)} of {num(total)}</b> {g.label}</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
