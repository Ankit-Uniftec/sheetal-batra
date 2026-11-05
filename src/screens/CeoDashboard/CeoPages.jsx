import React, { useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import formatDate from "../../utils/formatDate";
import { buildCancellationRows, fetchCancellations } from "../../utils/cancellationAnalytics";
import { orderRevenue, shortInr } from "./ceoInsights";
import {
  Card, Chips, Columns, Delta, Donut, Drawer, Empty, FilterGroup, fullInr, Icon, Insight, num, PageHead, Pager, PALETTE, RankBars, SalesCalendar, SearchBox, Select, Table, Thumb, Tile, TrendChart,
} from "./CeoUi";

// ============================================================
// The owner's pages. All numbers arrive through `ctx`, built once in
// CeoDashboard.jsx. A page decides only how to explain them, and every figure,
// name and row opens the story behind it. Labels say in full what is measured,
// and notes say which dates a figure covers.
// ============================================================

const greeting = (now = new Date()) => {
  const h = now.getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";
const titleCase = (s) => String(s || "").toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const pctOf = (a, b) => (b > 0 ? (a / b) * 100 : 0);
const initials = (name) => String(name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("");
const piecesText = (n) => `${num(n)} ${n === 1 ? "piece" : "pieces"}`;

function DesignRow({ row, rank, onClick, badge }) {
  return (
    <button type="button" className="ceo-design" onClick={onClick}>
      {rank != null && <span className="ceo-design-rank">{rank}</span>}
      <Thumb src={row.image} alt={row.name} />
      <span className="ceo-design-text">
        <b title={row.name}>{row.name}</b>
        <small>{badge || piecesText(row.qty)}</small>
      </span>
      <span className="ceo-design-val">{shortInr(row.revenue)}</span>
    </button>
  );
}

const healthWord = { good: "Healthy", watch: "Watch", bad: "Needs Attention", idle: "No Data Yet" };

const STAGE_NOT_STARTED = new Set(["Before production", "No pieces"]);

/** The value of what needs watching. Shown side by side, never added up: these overlap, and a cancelled order is not necessarily lost money. */
function ValueAtStake({ ctx }) {
  const { fin, brief, delayedValue, delayedRows, periodRangeValue, periodName, go } = ctx;
  const a = brief.aftercare;
  const old = brief.outstanding.old;
  const [afterStart, setAfterStart] = useState(null);
  const start = periodRangeValue?.start;
  const end = periodRangeValue?.end;
  useEffect(() => {
    let dead = false;
    fetchCancellations((start || new Date(2000, 0, 1)).toISOString(), (end || new Date()).toISOString())
      .then((d) => {
        if (dead) return;
        const rows = buildCancellationRows(d.orders, d.components, d.whoByOrder, d.vendorNames).filter((r) => !STAGE_NOT_STARTED.has(r.stage));
        setAfterStart({ count: rows.length, value: rows.reduce((s, r) => s + r.value, 0) });
      })
      .catch(() => { if (!dead) setAfterStart({ failed: true }); });
    return () => { dead = true; };
  }, [start?.getTime(), end?.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = [
    { key: "disc", label: "Discounts Given", value: fin.totalDiscount, note: `${fin.discountPercent}% of sales value`, tab: "cost_expenditure" },
    { key: "canc", label: "Cancelled Order Value", value: a.cancellations.value, note: `${num(a.cancellations.count)} orders`, tab: "cancellations" },
    {
      key: "after", label: "Cancelled After Production Started",
      value: afterStart && !afterStart.failed ? afterStart.value : null,
      note: afterStart?.failed ? "Could not load" : afterStart ? `${num(afterStart.count)} orders` : "Loading", tab: "cancellations",
    },
    { key: "old", label: "Client Balances Over 60 Days Past Delivery", value: old?.value || 0, note: `${num(old?.count || 0)} orders. Some may be collected but not recorded.`, tab: "outstanding" },
    { key: "late", label: "Orders Past Delivery Date", value: delayedValue, note: `${num(delayedRows.length)} client orders`, tab: "ops_flags" },
  ];
  return (
    <Card span={4} title="Value at Stake" sub={`${periodName} for discounts and cancellations. Current for balances and late orders. These overlap, so they are not added up.`}>
      <div className="ceo-stake">
        {rows.map((r) => (
          <button key={r.key} type="button" onClick={() => go(r.tab)}>
            <span><b>{r.label}</b><small>{r.note}</small></span>
            <em title={r.value != null ? fullInr(r.value) : undefined}>{r.value != null ? shortInr(r.value) : "…"}</em>
          </button>
        ))}
      </div>
    </Card>
  );
}

/** Today's decisions, with the person looking after each. */
function TodaysBrief({ ctx }) {
  const { briefList, go, assignments, assignItem, finishAssignment, people, showPopup } = ctx;
  const [showAll, setShowAll] = useState(false);
  const [assigning, setAssigning] = useState(null);
  const [person, setPerson] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const team = useMemo(() => people.filter((p) => p.email && p.saleperson && p.role !== "ceo")
    .map((p) => ({ value: p.email, label: `${p.saleperson}${p.designation || p.role ? ` · ${p.designation || p.role}` : ""}` }))
    .sort((a, b) => a.label.localeCompare(b.label)), [people]);
  const items = showAll ? briefList : briefList.slice(0, 3);
  const openFor = (key) => assignments.rows.find((r) => r.item_key === key);
  const startAssign = (item) => { setAssigning(item); setPerson(""); setNote(""); };
  const submit = async () => {
    const chosen = people.find((p) => p.email === person);
    if (!chosen) return;
    setSaving(true);
    try {
      const told = await assignItem(assigning, chosen, note.trim());
      setAssigning(null);
      if (!told) showPopup({ title: "Assigned", message: `Saved, but the notification to ${chosen.saleperson} did not go through. Please tell them directly.`, type: "warning", confirmText: "OK" });
    } catch (e) {
      showPopup({ title: "Not saved", message: e.message || "The assignment could not be saved.", type: "error", confirmText: "OK" });
    }
    setSaving(false);
  };
  const finish = async (row) => {
    try { await finishAssignment(row); } catch (e) { showPopup({ title: "Not saved", message: e.message || "That could not be saved.", type: "error", confirmText: "OK" }); }
  };
  if (!briefList.length) {
    return <Card title="Today's Brief"><div className="ceo-allclear"><Icon name="sale" /><b>All clear</b><span>Nothing needs you right now.</span></div></Card>;
  }
  return (
    <Card title="Today's Brief" sub={`${briefList.length} ${briefList.length === 1 ? "item" : "items"} to review. Approvals first, then the largest rupee amounts.`} className="ceo-brief-card">
      <div className="ceo-brief">
        {items.map((item) => {
          const row = openFor(item.key);
          return (
            <article key={item.key} className={`ceo-brief-item is-${item.tone}`}>
              <button type="button" className="ceo-brief-main" onClick={() => go(item.tab)}>
                {item.value != null && <em title={fullInr(item.value)}>{shortInr(item.value)}</em>}
                <b>{item.title}</b>
                <small>{item.detail}</small>
              </button>
              <footer>
                <button type="button" className="ceo-btn is-small" onClick={() => go(item.tab)}>View Details</button>
                {assignments.available && (row ? (
                  <span className="ceo-assigned">
                    <span title={row.note || undefined}>With {row.assigned_to_name || row.assigned_to_email}</span>
                    <button type="button" className="ceo-inline" onClick={() => finish(row)}>Mark Done</button>
                  </span>
                ) : <button type="button" className="ceo-btn is-small" onClick={() => startAssign(item)}>Assign</button>)}
              </footer>
            </article>
          );
        })}
      </div>
      {briefList.length > 3 && <button type="button" className="ceo-more" onClick={() => setShowAll(!showAll)}>{showAll ? "Show Top 3" : `Show All ${briefList.length} Items`}</button>}
      {assigning && (
        <Drawer
          title="Assign This Item"
          sub={assigning.title}
          onClose={() => setAssigning(null)}
          footer={(
            <>
              <button type="button" className="ceo-btn" onClick={() => setAssigning(null)}>Cancel</button>
              <button type="button" className="ceo-btn is-primary" disabled={!person || saving} onClick={submit}>{saving ? "Saving…" : "Assign"}</button>
            </>
          )}
        >
          <FilterGroup label="Assign To"><Select label="Assign to" value={person} onChange={setPerson} options={team} placeholder="Choose a team member" search /></FilterGroup>
          <FilterGroup label="Note (Optional)">
            <textarea className="ceo-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should they do?" aria-label="Note" />
          </FilterGroup>
          <p className="ceo-foot">They get a notification in the app, and this stays on your brief until you mark it done.</p>
        </Drawer>
      )}
    </Card>
  );
}

// ------------------------------------------------------------ HOME
export function HomePage({ ctx }) {
  const { brief, highlights, sentence, dash, go, open, userName, trendData, periodName, isThisMonth, targetProgress, pulse, book, cash, health, feed, birthdays, lapsed, store, averageOrder, averageOrderGrowth, fairGrowth } = ctx;
  const pace = brief.pace;
  const now = new Date();
  const name = firstName(userName) || "Sheetal";
  const weekday = now.toLocaleDateString("en-IN", { weekday: "long" });
  const callList = birthdays.length
    ? birthdays.slice(0, 5).map((b) => ({ key: b.id, name: b.name, phone: b.phone, note: b.inDays === 0 ? "Today" : b.inDays === 1 ? "Tomorrow" : `In ${b.inDays} days` }))
    : lapsed.slice(0, 5).map((c) => ({ key: c.phone, name: titleCase(c.name), phone: c.phone, note: shortInr(c.spend) }));
  return (
    <div className="ceo-page">
      <header className="ceo-hello">
        <div>
          <span className="ceo-hello-date">{now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
          <h1>{greeting(now)}, {name}.</h1>
          <p>{sentence}</p>
        </div>
      </header>

      <TodaysBrief ctx={ctx} />

      <div className="ceo-tiles">
        <Tile icon="inr" label="Total Sales" value={shortInr(dash.totalRevenue)} title={fullInr(dash.totalRevenue)} delta={fairGrowth} note={periodName} onClick={() => go("revenue")} />
        <Tile icon="receive" label="Cash Received" value={shortInr(cash.total)} title={fullInr(cash.total)} note={periodName} onClick={() => go("outstanding")} />
        <Tile icon="orders" label="Number of Orders" value={num(brief.count)} delta={dash.showComparison ? brief.countGrowth : null} note={periodName} onClick={() => open({ type: "orders", title: "Orders", sub: periodName, orders: brief.sales, tab: "orders", tabLabel: "Go to Orders" })} />
        <Tile icon="sale" label="Average Order Value" value={shortInr(averageOrder)} title={fullInr(averageOrder)} delta={averageOrderGrowth} note={periodName} onClick={() => go("revenue")} />
        <Tile icon="trend" label="Sales Today So Far" value={shortInr(pulse.today.revenue)} title={fullInr(pulse.today.revenue)} delta={pulse.growth} note={`${num(pulse.today.count)} orders, compared with last ${weekday}`} onClick={() => open({ type: "orders", title: "Today's Orders", orders: pulse.today.orders })} />
        <Tile icon="movements" label="Sales Yesterday" value={shortInr(pulse.yesterday.revenue)} title={fullInr(pulse.yesterday.revenue)} note={`${num(pulse.yesterday.count)} orders`} onClick={() => open({ type: "orders", title: "Yesterday's Orders", orders: pulse.yesterday.orders })} />
        <Tile icon="integrity" label="Value of Open Orders" value={shortInr(book.value)} title={fullInr(book.value)} note={`${num(book.count)} client orders not yet delivered`} onClick={() => go("ops_flags")} />
        <Tile icon="alert" tone="warn" label="Balance Due from Clients" value={shortInr(brief.outstanding.total)} title={fullInr(brief.outstanding.total)} note={`All time, on ${num(brief.outstanding.count)} orders`} onClick={() => go("outstanding")} />
      </div>

      <div className="ceo-grid">
        <Card span={8} title="Sales Over Time" sub={`${periodName}${dash.showComparison ? ". The dashed line is the previous period." : "."} Click a day to see its orders.`} action="Sales & Revenue" onAction={() => go("revenue")}>
          <TrendChart data={trendData} height={250} onPick={(d) => d?.key && ctx.openDay(d.key)} />
          {isThisMonth && pace.projected > 0 && (
            <button type="button" className="ceo-pace" onClick={() => go("targets_growth")}>
              <span className="ceo-pace-top">
                <span>Day {pace.day} of {pace.daysInMonth}. Projected month-end sales {shortInr(pace.projected)}</span>
                {targetProgress && <span>{pctOf(targetProgress.stores, targetProgress.target).toFixed(0)}% of the Sales Associates' {shortInr(targetProgress.target)} monthly target</span>}
              </span>
              <span className="ceo-pace-track">
                <span style={{ width: `${Math.min(100, targetProgress ? pctOf(targetProgress.stores, targetProgress.target) : pctOf(pace.day, pace.daysInMonth))}%` }} />
                {targetProgress && <i style={{ left: `${pctOf(pace.day, pace.daysInMonth)}%` }} title="Where the month is today" />}
              </span>
            </button>
          )}
        </Card>

        <ValueAtStake ctx={ctx} />

        <Card span={7} title="Business Health" sub={`${periodName}. Click a measure for the details.`}>
          <Table
            rowKey={(r) => r.id}
            rows={health}
            onRow={(h) => go(h.tab)}
            columns={[
              { key: "label", label: "Measure", render: (h) => <><b>{h.label}</b><small className="ceo-cell-sub">{h.detail}</small></> },
              { key: "value", label: "Result", right: true, render: (h) => <b>{h.value}</b> },
              { key: "status", label: "Status", render: (h) => <span className={`ceo-status is-${h.status}`}><i />{healthWord[h.status]}</span> },
            ]}
          />
        </Card>

        <Card span={5} title="Top Performers" sub={periodName}>
          {highlights.length === 0 ? <Empty /> : (
            <div className="ceo-highlights is-one">
              {highlights.slice(0, 6).map((h) => (
                <button key={h.id} type="button" className="ceo-high" onClick={() => h.open()}>
                  <span className="ceo-high-ico"><Icon name={h.icon} /></span>
                  <span><b title={h.text}>{h.text}</b><small>{h.sub}</small></span>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card span={8} title="Latest Orders" sub="The 7 most recent sales" action="All Orders" onAction={() => go("orders")}>
          <Table
            rowKey={(r) => r.id}
            rows={feed}
            onRow={(o) => open({ type: "order", order: o })}
            columns={[
              { key: "client", label: "Client", render: (o) => <b>{titleCase(o.delivery_name) || "–"}</b> },
              { key: "design", label: "Design", hide: true, render: (o) => <span className="ceo-clip">{o.items?.[0]?.product_name || "–"}</span> },
              { key: "channel", label: "Sales Channel", hide: true, render: (o) => ctx.channelOf(o) },
              { key: "when", label: "Placed", render: (o) => ctx.ago(o.created_at) },
              { key: "value", label: "Order Value", right: true, render: (o) => shortInr(orderRevenue(o)) },
            ]}
          />
        </Card>

        <Card span={4} md={6} title="Sales by Channel" sub={`${periodName}. Net revenue after exhibition share.`} action="Details" onAction={() => go("revenue")}>
          <Donut data={brief.movers.map((m) => ({ name: m.name, value: m.current }))} center={shortInr(brief.revenue)} sub="Net Revenue" height={160} onPick={(d) => open({ type: "channel", name: d.name })} />
          <div className="ceo-legend">
            {brief.movers.slice(0, 5).map((m, i) => (
              <button type="button" key={m.name} onClick={() => open({ type: "channel", name: m.name })}>
                <i style={{ background: PALETTE[i % PALETTE.length] }} />
                <span>{m.name}</span>
                <b>{m.share.toFixed(0)}%</b>
              </button>
            ))}
          </div>
        </Card>

        <Card span={5} md={6} title="Best-Selling Designs" sub={`${periodName}, by sales`} action="All Designs" onAction={() => go("products_style")}>
          {brief.board.top.length === 0 ? <Empty /> : (
            <div className="ceo-designs">
              {brief.board.top.slice(0, 5).map((r, i) => <DesignRow key={r.name} row={r} rank={i + 1} onClick={() => open({ type: "design", name: r.name })} />)}
            </div>
          )}
        </Card>

        <Card span={4} md={6} title="Top Sales Associates" sub={`${periodName}, store orders`} action="Stores & Team" onAction={() => go("store_performance")}>
          <RankBars rows={store.saBreakdown.map((s) => ({ ...s, value: s.revenue }))} limit={6} sub={(r) => `${num(r.orders)} orders · ${r.store}`} onRow={(r) => open({ type: "person", name: r.name })} />
        </Card>

        <Card span={3} md={6} title={birthdays.length ? "Client Birthdays" : "Top Clients Gone Quiet"} sub={birthdays.length ? "In the next 2 weeks" : "No order in 6 months, by lifetime spend"}>
          <div className="ceo-people">
            {callList.map((p) => (
              <button key={p.key} type="button" onClick={() => open({ type: "client", phone: p.phone })}>
                <span className="ceo-avatar is-small">{initials(p.name)}</span>
                <span title={p.name}>{p.name}</span>
                <small>{p.note}</small>
              </button>
            ))}
            {callList.length === 0 && <Empty text="Nobody to call right now." />}
          </div>
        </Card>
      </div>
      <p className="ceo-foot">Total Sales counts {piecesText(brief.pieces)} sold. Internal stock movements, alterations, partner gifting, PR orders and cancelled orders are not counted as sales.</p>
    </div>
  );
}

// ------------------------------------------------------------ SALES
export function RevenuePage({ ctx }) {
  const { brief, dash, trendData, aovTrend, periodName, open, bands, big, months, heat, openDay, averageOrder, averageOrderGrowth, fairGrowth } = ctx;
  const top = brief.movers[0];
  const riser = [...brief.movers].filter((m) => m.growth != null).sort((a, b) => b.delta - a.delta)[0];
  const faller = [...brief.movers].filter((m) => m.growth != null).sort((a, b) => a.delta - b.delta)[0];
  const best = brief.bestDay;
  const topBand = [...bands].sort((a, b) => b.share - a.share)[0];
  return (
    <div className="ceo-page">
      <PageHead title="Sales & Revenue" desc="How much was sold, through which channel, and what changed." />
      <Insight>
        {top ? `${top.name} is the largest channel at ${top.share.toFixed(0)}% of sales.` : "No sales yet in this period."}
        {riser && riser.delta > 0 ? ` ${riser.name} grew the most, up ${shortInr(riser.delta)}.` : ""}
        {faller && faller.delta < 0 ? ` ${faller.name} fell the most, down ${shortInr(-faller.delta)}.` : ""}
        {topBand?.share > 0 ? ` Most sales come from orders ${topBand.name.toLowerCase()}.` : ""}
      </Insight>
      <div className="ceo-tiles">
        <Tile icon="inr" label="Total Sales" value={shortInr(dash.totalRevenue)} title={fullInr(dash.totalRevenue)} delta={fairGrowth} note={periodName} onClick={() => open({ type: "orders", title: "All Sales", sub: periodName, orders: brief.sales })} />
        <Tile icon="trend" label="Net Revenue After Exhibition Share" value={shortInr(dash.netSbRev)} title={fullInr(dash.netSbRev)} note={periodName} />
        <Tile icon="orders" label="Number of Orders" value={num(brief.count)} delta={dash.showComparison ? brief.countGrowth : null} note={`${piecesText(brief.pieces)} sold`} onClick={() => open({ type: "orders", title: "All Sales", sub: periodName, orders: brief.sales })} />
        <Tile icon="sale" label="Average Order Value" value={shortInr(averageOrder)} title={fullInr(averageOrder)} delta={averageOrderGrowth} note={brief.count ? `${(brief.pieces / brief.count).toFixed(1)} pieces per order` : undefined} />
      </div>
      <div className="ceo-grid">
        <Card span={12} title="Sales Over Time" sub={dash.showComparison ? "The dashed line is the previous period. Click a day to see its orders." : "Click a day to see its orders."}>
          <TrendChart data={trendData} height={300} onPick={(d) => d?.key && openDay(d.key)} />
        </Card>
        <Card span={8} title="Sales by Channel" sub="Click a channel to see its designs, Sales Associates and orders">
          <Table
            rowKey={(r) => r.name}
            rows={brief.movers}
            onRow={(r) => open({ type: "channel", name: r.name })}
            columns={[
              { key: "name", label: "Sales Channel", render: (r) => <b>{r.name}</b> },
              { key: "current", label: "Net Revenue", right: true, render: (r) => <span title={fullInr(r.current)}>{shortInr(r.current)}</span> },
              { key: "orders", label: "Orders", right: true, hide: true, render: (r) => num(r.orders) },
              { key: "share", label: "Share of Sales", right: true, hide: true, render: (r) => `${r.share.toFixed(0)}%` },
              { key: "growth", label: "Change vs Previous", right: true, render: (r) => (dash.showComparison ? <Delta value={r.growth} /> : "–") },
            ]}
          />
        </Card>
        <Card span={4} className="ceo-hide-md" title="Share of Sales by Channel">
          <Donut data={brief.movers.map((m) => ({ name: m.name, value: m.current }))} center={shortInr(brief.revenue)} sub="Net Revenue" height={220} onPick={(d) => open({ type: "channel", name: d.name })} />
        </Card>
        <Card span={12} title="Daily Sales Calendar, Last 6 Months" sub="Darker days had higher sales. Click any day to see its orders.">
          <SalesCalendar heat={heat} onPick={(d) => openDay(d.key)} />
        </Card>
        <Card span={6} md={6} title="Sales by Order Value" sub="Which order sizes bring in the most">
          <RankBars rows={bands.map((b) => ({ ...b, value: b.revenue, key: b.name }))} sub={(r) => `${num(r.count)} orders · ${r.share.toFixed(0)}% of sales`} limit={5} onRow={(r) => open({ type: "orders", title: `Orders ${r.name}`, orders: r.orders })} />
        </Card>
        <Card span={6} md={6} title="Largest Orders" sub={periodName}>
          {big.length === 0 ? <Empty /> : (
            <div className="ceo-big">
              {big.slice(0, 6).map((o) => (
                <button key={o.id} type="button" onClick={() => open({ type: "order", order: o })}>
                  <Thumb src={o.items?.[0]?.image_url} alt="" />
                  <span><b title={o.delivery_name}>{titleCase(o.delivery_name) || o.order_no}</b><small title={o.items?.[0]?.product_name}>{o.items?.[0]?.product_name || "–"}</small></span>
                  <em>{shortInr(orderRevenue(o))}</em>
                </button>
              ))}
            </div>
          )}
        </Card>
        <Card span={6} md={6} title="Average Order Value Over Time" sub={periodName}>
          {aovTrend.length < 2 ? <Empty text="Choose a longer period to see this trend." /> : (
            <div style={{ height: 230 }}>
              <ResponsiveContainer>
                <LineChart data={aovTrend} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#f1ede2" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#8a8478" }} axisLine={false} tickLine={false} minTickGap={22} />
                  <YAxis tickFormatter={(v) => shortInr(v).replace("₹", "")} tick={{ fontSize: 11, fill: "#8a8478" }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip formatter={(v) => fullInr(v)} />
                  <Line type="monotone" dataKey="aov" name="Average Order Value" stroke="#7b3a5e" strokeWidth={2.2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card span={6} md={6} title="Monthly Sales, Last 12 Months" sub="Click a month to see its orders">
          <Columns data={months} labelKey="name" valueKey="revenue" name="Net Revenue" height={230} highlight={(d) => d === months[months.length - 1]} onPick={ctx.openMonth} />
        </Card>
        <Card span={12} title="Average Sales by Day of the Week" sub={best?.average > 0 ? `${best.name}s bring in the most, on average` : "Named once each day has appeared twice in the chosen period"}>
          <Columns data={brief.week} labelKey="short" valueKey="average" name="Average day" height={200} highlight={(d) => best && d.name === best.name} />
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ STORES & TEAM
export function StoresPage({ ctx }) {
  const { store, go, open, walkin, saProgress, periodName } = ctx;
  const total = store.storeBreakdown.reduce((s, x) => s + x.revenue, 0);
  const top = store.saBreakdown[0];
  const targetOf = (name) => saProgress.find((r) => r.name === name);
  const issues = store.saIssuesList.filter((r) => r.refunds + r.returns + r.exchanges + r.cancellations > 0);
  const topSource = walkin.bySource[0];
  return (
    <div className="ceo-page">
      <PageHead title="Stores & Team" desc="Each store side by side, how each Sales Associate is doing, and how visitors turn into clients." />
      <Insight>
        {top ? `${top.name} leads with ${shortInr(top.revenue)} from ${num(top.orders)} orders.` : "No store sales yet in this period."}
        {walkin.total ? ` ${num(walkin.total)} visitors were logged and ${walkin.rate.toFixed(0)}% bought.` : " No store visitors were logged in this period."}
        {topSource ? ` ${topSource.name} brought the most visitors.` : ""}
      </Insight>
      <div className="ceo-stores">
        {store.storeBreakdown.map((s, i) => (
          <button type="button" key={s.name} className="ceo-store" onClick={() => open({ type: "orders", title: s.name, sub: "Store Orders", orders: ctx.storeOrders(s.name) })}>
            <span className="ceo-store-name"><i style={{ background: PALETTE[i % PALETTE.length] }} />{s.name}</span>
            <span className="ceo-store-val" title={fullInr(s.revenue)}>{shortInr(s.revenue)}</span>
            <span className="ceo-store-grid">
              <span><small>Orders</small><b>{num(s.orders)}</b></span>
              <span><small>Average Order Value</small><b>{shortInr(s.orders ? s.revenue / s.orders : 0)}</b></span>
              <span><small>Share of Store Sales</small><b>{pctOf(s.revenue, total).toFixed(0)}%</b></span>
            </span>
          </button>
        ))}
        {store.storeBreakdown.length === 0 && <Empty />}
      </div>
      <div className="ceo-grid">
        <Card span={12} title="Sales Associates" sub={`${periodName}. Click a name to see their orders and designs.`}>
          <Table
            rowKey={(r) => r.name}
            rows={store.saBreakdown}
            onRow={(r) => open({ type: "person", name: r.name })}
            columns={[
              { key: "name", label: "Name", render: (r) => <b>{r.name}</b> },
              { key: "store", label: "Store", hide: true },
              { key: "revenue", label: "Sales", right: true, render: (r) => <span title={fullInr(r.revenue)}>{shortInr(r.revenue)}</span> },
              { key: "orders", label: "Orders", right: true, render: (r) => num(r.orders) },
              { key: "aov", label: "Average Order Value", right: true, hide: true, tab: true, render: (r) => shortInr(r.orders ? r.revenue / r.orders : 0) },
              {
                key: "disc", label: "Discount Rate", right: true, hide: true,
                render: (r) => { const rate = pctOf(r.discount, r.revenue + r.discount); return <span className={rate > 25 ? "ceo-text-warn" : undefined}>{rate.toFixed(0)}%</span>; },
              },
              {
                key: "target", label: "This Month's Target Achieved", hide: true,
                render: (r) => {
                  const t = targetOf(r.name);
                  if (!t) return <span className="ceo-muted">No target set</span>;
                  const p = pctOf(t.sold, t.target);
                  return <span className="ceo-meter"><span><i style={{ width: `${Math.min(100, p)}%`, background: "#b8922e" }} /></span><b>{p.toFixed(0)}%</b></span>;
                },
              },
            ]}
          />
        </Card>
        <Card span={4} md={6} title="Store Walk-Ins" sub={`${periodName}, as logged by the team`}>
          {!walkin.total ? <Empty text="No walk-ins logged in this period." /> : (
            <>
              <div className="ceo-funnel">
                <div style={{ width: "100%" }}><b>{num(walkin.total)}</b><span>visitors</span></div>
                <div style={{ width: `${Math.max(38, walkin.rate)}%` }}><b>{num(walkin.converted)}</b><span>bought ({walkin.rate.toFixed(0)}%)</span></div>
              </div>
              <RankBars rows={walkin.byStore.map((s) => ({ ...s, value: s.rate, key: s.name }))} format={(v) => `${Number(v).toFixed(0)}%`} sub={(r) => `${num(r.converted)} of ${num(r.count)} visitors bought`} limit={4} />
            </>
          )}
        </Card>
        <Card span={4} md={6} title="Walk-Ins by Source" sub="How visitors heard about the brand, and how many bought">
          <RankBars rows={walkin.bySource.map((s) => ({ ...s, value: s.count, key: s.name }))} format={num} sub={(r) => `${r.rate.toFixed(0)}% bought`} limit={6} />
        </Card>
        <Card span={4} title="Walk-In Conversion Rate by Sales Associate" sub="For anyone with 3 or more visitors">
          <RankBars rows={walkin.byPerson.filter((p) => p.name !== "Not recorded" && p.count >= 3).map((s) => ({ ...s, value: s.rate, key: s.name })).sort((a, b) => b.value - a.value)} format={(v) => `${Number(v).toFixed(0)}%`} sub={(r) => `${num(r.converted)} of ${num(r.count)} visitors bought`} limit={6} onRow={(r) => open({ type: "person", name: r.name })} />
        </Card>
        <Card span={12} title="Daily Sales by Store" sub={periodName}>
          {store.dailySalesData.length === 0 ? <Empty /> : (
            <div style={{ height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={store.dailySalesData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#f1ede2" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#8a8478" }} axisLine={false} tickLine={false} minTickGap={18} />
                  <YAxis tickFormatter={(v) => shortInr(v).replace("₹", "")} tick={{ fontSize: 11, fill: "#8a8478" }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip formatter={(v) => fullInr(v)} />
                  {store.storeNames.map((name, i) => <Bar key={name} dataKey={name} stackId="a" fill={PALETTE[i % PALETTE.length]} maxBarSize={30} isAnimationActive={false} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card span={12} title="Cancellations and Returns by Sales Associate" sub={periodName} action="Discounts & Returns" onAction={() => go("cost_expenditure")}>
          <Table
            rowKey={(r) => r.name}
            rows={issues}
            empty="No cancellations or returns in this period."
            onRow={(r) => open({ type: "person", name: r.name })}
            columns={[
              { key: "name", label: "Name", render: (r) => <b>{r.name}</b> },
              { key: "cancellations", label: "Cancelled", right: true },
              { key: "returns", label: "Returned", right: true },
              { key: "exchanges", label: "Exchanged", right: true, hide: true },
              { key: "refunds", label: "Refunded", right: true, hide: true },
              { key: "total", label: "Order Value", right: true, render: (r) => shortInr(r.total) },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ DESIGNS
export function ProductsPage({ ctx }) {
  const { brief, analytics, enhanced, colourHex, dash, open, slow, go, periodName } = ctx;
  const board = brief.board;
  const topShare = board.top.slice(0, 5).reduce((s, r) => s + r.revenue, 0);
  const allRev = board.rows.reduce((s, r) => s + r.revenue, 0);
  const topColour = analytics.topColors[0];
  const topSize = brief.sizes[0];
  return (
    <div className="ceo-page">
      <PageHead title="Designs" desc="Which designs, colours and sizes clients choose, and which they do not.">
        <button type="button" className="ceo-btn" onClick={() => go("inventory")}><Icon name="stock" />View Stock</button>
      </PageHead>
      <Insight>
        {board.top.length
          ? `The top 5 designs bring in ${pctOf(topShare, allRev).toFixed(0)}% of sales.${topColour ? ` ${topColour.name} is the top colour.` : ""}${topSize ? ` Size ${topSize.name} is ordered most, at ${topSize.share.toFixed(0)}% of pieces.` : ""}`
          : "No sales yet in this period."}
      </Insight>
      <div className="ceo-gallery">
        {board.top.slice(0, 6).map((r, i) => (
          <button type="button" className="ceo-look" key={r.name} onClick={() => open({ type: "design", name: r.name })}>
            <Thumb src={r.image} alt={r.name} large />
            <span className="ceo-look-rank">{i + 1}</span>
            <span className="ceo-look-text">
              <b title={r.name}>{r.name}</b>
              <em>{shortInr(r.revenue)} · {piecesText(r.qty)}</em>
            </span>
          </button>
        ))}
      </div>
      <div className="ceo-grid">
        <Card span={6} md={6} title="Designs With Rising Sales" sub={dash.showComparison ? "Sold more than in the previous period" : "Choose a comparison in the filters to see this"}>
          {board.rising.length === 0 ? <Empty text="Nothing to compare yet." /> : (
            <div className="ceo-designs">
              {board.rising.map((r) => <DesignRow key={r.name} row={r} badge={`Up ${shortInr(r.delta)}`} onClick={() => open({ type: "design", name: r.name })} />)}
            </div>
          )}
        </Card>
        <Card span={6} md={6} title="Designs With Falling Sales" sub="Sold less than in the previous period">
          {board.falling.length === 0 ? <Empty text="Nothing to compare yet." /> : (
            <div className="ceo-designs">
              {board.falling.map((r) => <DesignRow key={r.name} row={r} badge={`Down ${shortInr(-r.delta)}`} onClick={() => open({ type: "design", name: r.name })} />)}
            </div>
          )}
        </Card>
        <Card span={4} md={6} title="Sales by Colour" sub={periodName}>
          <RankBars rows={analytics.topColors.map((c) => ({ ...c, value: c.sales }))} swatchOf={(r) => colourHex[r.name]} limit={8} colorOf={(r) => colourHex[r.name] || "#c9a23e"} />
        </Card>
        <Card span={4} md={6} title="Pieces Sold by Size" sub={periodName}>
          <RankBars rows={brief.sizes.map((s) => ({ ...s, value: s.qty }))} format={num} sub={(r) => `${r.share.toFixed(0)}% of pieces`} limit={8} />
        </Card>
        <Card span={4} title="Lowest-Selling Designs" sub={`${periodName}, of the designs that sold`}>
          <RankBars rows={enhanced.bottomProducts.map((p) => ({ ...p, value: p.sales }))} limit={8} sub={(r) => piecesText(r.count)} colorOf={() => "#d9d3c4"} onRow={(r) => open({ type: "design", name: r.name })} />
        </Card>
        <Card span={8} title="Live Designs Not Sold in 3 Months" sub="Worth reviewing, refreshing or retiring">
          {slow.length === 0 ? <Empty text="Every live design has sold recently." /> : (
            <div className="ceo-slow">
              {slow.map((p) => (
                <button key={p.id} type="button" onClick={() => open({ type: "design", name: p.name })}>
                  <Thumb src={p.image_url} alt={p.name} />
                  <span><b title={p.name}>{p.name}</b><small>{p.lastSold ? `Last sold ${formatDate(p.lastSold)}` : "No orders yet"}</small></span>
                </button>
              ))}
            </div>
          )}
        </Card>
        <Card span={4} title="Alterations by Design" sub={`${num(enhanced.totalAlterations)} alterations, ${(enhanced.avgAlterationsPerOutfit * 100).toFixed(1)}% of pieces sold. Designs with 3 or more may need a fit check.`}>
          <RankBars rows={analytics.alterationsByOutfit.map((a) => ({ ...a, value: a.count }))} format={num} limit={6} colorOf={(r) => (r.count >= 3 ? "#c31f0a" : "#c9785a")} onRow={(r) => open({ type: "design", name: r.name })} />
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ CLIENTS
export function ClientsPage({ ctx }) {
  const { clients, clientsUi, brief, lapsed, open, cities, concentration, birthdays, periodName } = ctx;
  const mix = brief.mix;
  const seg = clients.segmentation;
  const lapsedTotal = lapsed.reduce((s, c) => s + c.spend, 0);
  const openClient = (c) => open({ type: "client", phone: c.phone });
  return (
    <div className="ceo-page">
      <PageHead title="Clients" desc="Who is buying, who is coming back, and who to call." />
      <Insight>
        {`The top 10% of clients (${num(concentration.topCount)}) bring in ${concentration.topShare.toFixed(0)}% of lifetime sales.`}
        {` ${clients.repeatRate}% of clients have ordered more than once.`}
        {lapsed.length ? ` ${lapsed.length} top clients with ${shortInr(lapsedTotal)} in lifetime spend have not ordered in 6 months.` : ""}
      </Insight>
      <div className="ceo-tiles">
        <Tile icon="overview" label="Total Clients" value={num(clients.totalClients)} note={`All time. Average lifetime spend ${shortInr(concentration.average)}`} />
        <Tile icon="trend" label="Repeat Client Rate" value={`${clients.repeatRate}%`} note="All time. Clients with more than one order" />
        <Tile icon="plus" label="New Clients" value={num(mix.newCount)} note={`${periodName}. ${shortInr(mix.newRevenue)} in sales`} />
        <Tile icon="sale" label="Returning Clients" value={num(mix.returningCount)} note={`${periodName}. ${shortInr(mix.returningRevenue)} in sales`} />
      </div>
      <div className="ceo-grid">
        <Card span={8} title="Top Clients Gone Quiet" sub="Highest lifetime spend, with no order in 6 months">
          <Table
            rowKey={(r) => r.phone}
            rows={lapsed}
            empty="None of your top clients has gone quiet."
            onRow={openClient}
            columns={[
              { key: "name", label: "Client", render: (r) => <b>{titleCase(r.name)}</b> },
              { key: "spend", label: "Lifetime Spend", right: true, render: (r) => shortInr(r.spend) },
              { key: "orders", label: "Orders", right: true, hide: true },
              { key: "daysAway", label: "Last Order", right: true, render: (r) => `${Math.round(r.daysAway / 30)} months ago` },
              { key: "sa", label: "Sales Associate", hide: true, render: (r) => r.sa || "–" },
            ]}
          />
        </Card>
        <Card span={4} md={6} title="Client Birthdays" sub="In the next 2 weeks">
          {birthdays.length === 0 ? <Empty text="No client birthdays on record in the next 2 weeks." /> : (
            <div className="ceo-people">
              {birthdays.slice(0, 7).map((b) => (
                <button key={b.id} type="button" onClick={() => open({ type: "client", phone: b.phone })}>
                  <span className="ceo-avatar is-small">{initials(b.name)}</span>
                  <span title={b.name}>{b.name}</span>
                  <small>{b.inDays === 0 ? "Today" : b.inDays === 1 ? "Tomorrow" : `In ${b.inDays} days`}</small>
                </button>
              ))}
            </div>
          )}
        </Card>
        <Card span={4} md={6} title="Clients by Order Frequency" sub="All time">
          <Donut data={seg} center={num(clients.totalClients)} sub="Clients" money={false} height={170} />
          <div className="ceo-legend">
            {seg.filter((s) => s.value > 0).map((s, i) => (
              <div key={s.name}><i style={{ background: PALETTE[i % PALETTE.length] }} /><span>{s.name}</span><b>{num(s.value)}</b></div>
            ))}
          </div>
        </Card>
        <Card span={4} md={6} title="Sales by City" sub={cities.abroadCount ? `${periodName}. Includes ${num(cities.abroadCount)} orders from abroad, ${shortInr(cities.abroadRevenue)}.` : periodName}>
          <RankBars rows={cities.rows.map((c) => ({ ...c, value: c.revenue }))} sub={(r) => `${num(r.clients)} clients`} limit={7} onRow={(r) => open({ type: "orders", title: r.name, sub: "Orders From This City", orders: r.orders })} />
        </Card>
        <Card span={4} md={6} title="Lifetime Spend by Store" sub="All time">
          <RankBars rows={clients.storeClients.map((s) => ({ ...s, value: s.spend }))} sub={(r) => `${num(r.count)} clients`} limit={7} />
        </Card>
        <Card span={12} title="All Clients" sub="Click anyone to see their full history">
          <div className="ceo-tools">
            <SearchBox value={clientsUi.search} onChange={clientsUi.setSearch} placeholder="Search by name, phone or city" />
            <Select label="Store" value={clientsUi.store} onChange={clientsUi.setStore} options={[{ value: "", label: "All stores" }, ...clients.storeList.map((s) => ({ value: s, label: s }))]} />
            <Select label="Sort by" value={clientsUi.sort} onChange={clientsUi.setSort} options={[{ value: "totalSpend", label: "Highest lifetime spend" }, { value: "orderCount", label: "Most orders" }, { value: "recent", label: "Most recent order" }]} />
          </div>
          <Table
            rowKey={(r) => r.phone}
            rows={clients.currentClients}
            onRow={openClient}
            empty="No client matches this search."
            columns={[
              { key: "name", label: "Client", render: (r) => <b>{titleCase(r.name)}</b> },
              { key: "phone", label: "Phone Number", hide: true },
              { key: "city", label: "City", hide: true, render: (r) => titleCase(r.city) },
              { key: "stores", label: "Bought From", hide: true },
              { key: "orderCount", label: "Orders", right: true },
              { key: "totalSpend", label: "Lifetime Spend", right: true, render: (r) => shortInr(r.totalSpend) },
              { key: "lastOrder", label: "Last Order", right: true, hide: true, render: (r) => formatDate(r.lastOrder) },
            ]}
          />
          <Pager page={clientsUi.page} pages={clients.clientsTotalPages} onChange={clientsUi.setPage} />
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ B2B
export function B2bPage({ ctx }) {
  const { b2b, b2bUi, consignment, dash, open, allSales, inPeriod, periodName } = ctx;
  const types = [
    { name: "Buyout", value: b2b.buyoutValue, orders: b2b.buyoutOrders },
    { name: "Consignment", value: b2b.consignmentValue, orders: b2b.consignmentOrders },
    { name: "Client Order", value: b2b.clientOrderValue, orders: b2b.clientOrderOrders },
  ];
  const leader = b2b.allClientSales[0];
  const concentration = pctOf(b2b.allClientSales.slice(0, 3).reduce((s, c) => s + c.sales, 0), b2b.totalB2bRevenue);
  const b2bOrders = useMemo(() => allSales.filter((o) => o.is_b2b && inPeriod(o.created_at)), [allSales, inPeriod]);
  const partnerOrders = (r) => open({ type: "orders", title: r.name, sub: "B2B Partner", orders: b2bOrders.filter((o) => ctx.partnerOf(o) === r.name) });
  return (
    <div className="ceo-page">
      <PageHead title="B2B Partners" desc="Sales through partners, balances due, and the designs they order most.">
        <Select label="Merchandiser" value={b2bUi.merchandiser} onChange={b2bUi.setMerchandiser} options={[{ value: "", label: "All merchandisers" }, ...b2b.merchandiserList.map((m) => ({ value: m, label: m }))]} />
      </PageHead>
      <Insight>
        {leader ? `${leader.name} is the largest partner at ${shortInr(leader.sales)}. The top 3 partners make up ${concentration.toFixed(0)}% of B2B sales.` : "No B2B sales yet in this period."}
      </Insight>
      <div className="ceo-tiles">
        <Tile icon="inr" label="Total B2B Sales" value={shortInr(b2b.totalB2bRevenue)} title={fullInr(b2b.totalB2bRevenue)} delta={dash.showComparison ? b2b.revenueGrowth : null} note={periodName} onClick={() => open({ type: "orders", title: "B2B Orders", orders: b2bOrders })} />
        <Tile icon="orders" label="Number of B2B Orders" value={num(b2b.totalB2bOrders)} delta={dash.showComparison ? b2b.ordersGrowth : null} note={periodName} onClick={() => open({ type: "orders", title: "B2B Orders", orders: b2bOrders })} />
        <Tile icon="alert" tone="warn" label="Balance Due from Partners" value={shortInr(b2b.totalB2bBalance)} title={fullInr(b2b.totalB2bBalance)} note={`On orders placed this period. ${shortInr(b2b.totalB2bAdvance)} received.`} />
        <Tile icon="plus" label="New Partners" value={num(b2b.newClientsCount)} note={`First order placed: ${periodName}`} />
      </div>
      <div className="ceo-grid">
        <Card span={4} md={6} title="Sales by B2B Order Type" sub={periodName}>
          <Donut data={types} center={shortInr(b2b.totalB2bRevenue)} sub="B2B Sales" height={170} />
          <div className="ceo-legend">
            {types.map((t, i) => (
              <div key={t.name}><i style={{ background: PALETTE[i % PALETTE.length] }} /><span>{t.name} ({num(t.orders)})</span><b>{shortInr(t.value)}</b></div>
            ))}
          </div>
        </Card>
        <Card span={4} md={6} title="Top Designs Ordered by Partners" sub={periodName}>
          <RankBars rows={b2b.topB2bProducts.map((p) => ({ ...p, value: p.revenue }))} sub={(r) => piecesText(r.qty)} limit={6} onRow={(r) => open({ type: "design", name: r.name })} />
        </Card>
        <Card span={4} title="Partners With the Highest Balance Due" sub={periodName}>
          <RankBars rows={b2b.advancePending.map((c) => ({ ...c, value: c.balance }))} limit={6} sub={(r) => `${num(r.orders)} orders`} colorOf={() => "#c9785a"} onRow={partnerOrders} />
        </Card>
        <Card span={12} title="All Partners" sub={`${periodName}. Click a partner to see their orders.`}>
          <div className="ceo-tools">
            <SearchBox value={b2bUi.search} onChange={b2bUi.setSearch} placeholder="Search partners" />
          </div>
          <Table
            rowKey={(r, i) => `${r.name}-${i}`}
            rows={b2b.currentB2bClients}
            empty="No partner matches."
            onRow={partnerOrders}
            columns={[
              { key: "name", label: "Partner", render: (r) => <b>{r.name}</b> },
              { key: "orders", label: "Orders", right: true },
              { key: "sales", label: "Sales", right: true, render: (r) => shortInr(r.sales) },
              { key: "advance", label: "Amount Received", right: true, hide: true, render: (r) => shortInr(r.advance) },
              { key: "balance", label: "Balance Due", right: true, render: (r) => <span className={r.balance > 0 ? "ceo-text-warn" : undefined}>{shortInr(r.balance)}</span> },
            ]}
          />
          <Pager page={b2bUi.page} pages={b2b.b2bTotalPages} onChange={b2bUi.setPage} />
        </Card>
        {consignment.totalSent > 0 && (
          <Card span={12} title="Consignment Stock" sub="All time, pieces held by partners">
            <div className="ceo-minirow">
              <span><small>Pieces Sent</small><b>{num(consignment.totalSent)}</b></span>
              <span><small>Pieces Sold</small><b>{num(consignment.totalSold)}</b></span>
              <span><small>Pieces Still With Partners</small><b>{num(consignment.totalRemaining)}</b></span>
              <span><small>Sell-Through Rate</small><b>{pctOf(consignment.totalSold, consignment.totalSent).toFixed(0)}%</b></span>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ TARGETS & GROWTH
export function TargetsPage({ ctx }) {
  const { targets, brief, saProgress, dash, open, months, openMonth, coach } = ctx;
  const pace = brief.pace;
  const yearTotal = targets.monthlyData.reduce((s, m) => s + m.achieved, 0);
  const elapsed = targets.monthlyData.filter((m) => !m.isFuture);
  const best = [...elapsed].sort((a, b) => b.achieved - a.achieved)[0];
  const teamTarget = saProgress.reduce((s, r) => s + r.target, 0);
  const teamSold = saProgress.reduce((s, r) => s + r.sold, 0);
  const onPace = pctOf(pace.day, pace.daysInMonth);
  const behind = saProgress.filter((r) => pctOf(r.sold, r.target) < onPace * 0.6).length;
  return (
    <div className="ceo-page">
      <PageHead title="Targets & Growth" desc="Where the year stands, and whether the team is on pace." />
      <Insight>
        {`${shortInr(yearTotal)} in sales so far this year${best?.achieved ? `, with ${best.month} the best month at ${shortInr(best.achieved)}` : ""}.`}
        {pace.projected > 0 ? ` This month is projected to reach ${shortInr(pace.projected)}${pace.lastMonthTotal ? `, against ${shortInr(pace.lastMonthTotal)} last month` : ""}.` : ""}
        {behind ? ` ${num(behind)} Sales Associates are well behind pace.` : ""}
      </Insight>
      <div className="ceo-tiles">
        <Tile icon="trend" label="Sales This Month So Far" value={shortInr(pace.mtd)} title={fullInr(pace.mtd)} delta={pace.vsLastMonth} note="Compared with the same point last month" />
        <Tile icon="overview" label="Projected Sales This Month" value={shortInr(pace.projected)} note={`At the current daily pace. Day ${pace.day} of ${pace.daysInMonth}`} />
        <Tile icon="sale" label="Team Monthly Target Achieved" value={teamTarget ? `${pctOf(teamSold, teamTarget).toFixed(0)}%` : "–"} note={teamTarget ? `${shortInr(teamSold)} of ${shortInr(teamTarget)}, ${num(saProgress.length)} Sales Associates` : "No targets set"} />
        <Tile icon="movements" label="Team Sales Needed Per Day" value={teamTarget ? shortInr(coach.team.neededPerDay) : "–"} title={teamTarget ? fullInr(coach.team.neededPerDay) : undefined} note={teamTarget ? `${coach.daysLeft} days left, counting today. Average so far ${shortInr(coach.team.averagePerDay)}` : "No targets set"} />
      </div>
      {coach.stores.length > 0 && (
        <div className="ceo-stores">
          {coach.stores.map((s) => (
            <div key={s.name} className="ceo-store is-static">
              <span className="ceo-store-name">{s.name}</span>
              <span className="ceo-store-val" title={fullInr(s.neededPerDay)}>{s.needed > 0 ? `${shortInr(s.neededPerDay)} a day` : "Target Reached"}</span>
              <span className="ceo-store-grid">
                <span><small>Monthly Target</small><b>{shortInr(s.target)}</b></span>
                <span><small>Sales This Month</small><b>{shortInr(s.sold)}</b></span>
                <span><small>Target Achieved</small><b>{s.achieved.toFixed(0)}%</b></span>
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="ceo-grid">
        <Card span={12} title="Monthly Sales, Last 12 Months" sub="Click a month to see its orders">
          <Columns data={months} labelKey="name" valueKey="revenue" name="Net Revenue" height={270} highlight={(d) => best && d.name.startsWith(best.month)} onPick={openMonth} />
        </Card>
        <Card span={12} title="Target Coach" sub={`What each Sales Associate needs per day, counting today, to reach this month's target. ${coach.daysLeft} days left. Shows the ${num(coach.rows.length)} of ${num(ctx.peopleTotal)} Sales Associates who have a target.`}>
          <Table
            rowKey={(r) => r.email}
            rows={coach.rows}
            empty="No monthly targets are set yet."
            onRow={(r) => open({ type: "person", name: r.name })}
            columns={[
              { key: "name", label: "Name", render: (r) => <b>{r.name}</b> },
              { key: "store", label: "Store", hide: true, tab: true, render: (r) => r.store || "–" },
              { key: "target", label: "Monthly Target", right: true, hide: true, render: (r) => shortInr(r.target) },
              { key: "sold", label: "Sales This Month", right: true, render: (r) => shortInr(r.sold) },
              { key: "average", label: "Average Per Day So Far", right: true, hide: true, tab: true, render: (r) => shortInr(r.averagePerDay) },
              { key: "perDay", label: "Needed Per Day", right: true, render: (r) => (r.needed > 0 ? <b>{shortInr(r.neededPerDay)}</b> : <span className="ceo-status is-good"><i />Target Reached</span>) },
              {
                key: "progress", label: "Target Achieved", hide: true,
                render: (r) => (
                  <span className="ceo-meter" title={`${r.achieved.toFixed(0)}%`}>
                    <span><i style={{ width: `${Math.min(100, r.achieved)}%`, background: r.achieved >= onPace ? "#1f6b4e" : "#c9a23e" }} /></span>
                    <b>{r.achieved.toFixed(0)}%</b>
                  </span>
                ),
              },
            ]}
          />
        </Card>
        <Card span={12} title="Sales Growth by Channel" sub={dash.showComparison ? "Chosen period compared with the one before" : "Choose a period in the filters to compare"}>
          <Table
            rowKey={(r) => r.name}
            rows={targets.storeGrowthList}
            onRow={(r) => open({ type: "channel", name: r.name })}
            columns={[
              { key: "name", label: "Sales Channel", render: (r) => <b>{r.name}</b> },
              { key: "current", label: "This Period", right: true, render: (r) => shortInr(r.current) },
              { key: "previous", label: "Previous Period", right: true, hide: true, render: (r) => shortInr(r.previous) },
              { key: "growth", label: "Change", right: true, render: (r) => <Delta value={r.previous > 0 ? Number(r.growth) : null} /> },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ PRODUCTION
export function OpsPage({ ctx }) {
  const { ops, delayedRows, internalLate, go, delayedValue, open, stages, book, promise, periodName, dueSoon } = ctx;
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => (showAll ? delayedRows : delayedRows.slice(0, 15)), [showAll, delayedRows]);
  const worst = delayedRows[0];
  const bottleneck = [...stages].filter((s) => s.key !== "order_received").sort((a, b) => b.count - a.count)[0];
  const lateAges = useMemo(() => [
    { name: "Late by Up to 1 Week", test: (d) => d <= 7 },
    { name: "Late by 1 to 4 Weeks", test: (d) => d > 7 && d <= 30 },
    { name: "Late by 1 to 3 Months", test: (d) => d > 30 && d <= 90 },
    { name: "Late by Over 3 Months", test: (d) => d > 90 },
  ].map((b) => {
    const list = delayedRows.filter((o) => b.test(o.daysLate));
    return { name: b.name, count: list.length, orders: list, value: list.reduce((s, o) => s + orderRevenue(o), 0) };
  }), [delayedRows]);
  return (
    <div className="ceo-page">
      <PageHead title="Production" desc="Open client orders: where they are, which are late, and how quality is holding." />
      <Insight tone={delayedRows.length > 0 ? "warn" : "gold"}>
        {delayedRows.length > 0
          ? `${num(delayedRows.length)} of ${num(book.count)} open client orders, worth ${shortInr(delayedValue)}, are past their promised delivery date.${worst ? ` The oldest is ${worst.daysLate} days late.` : ""}`
          : "No client order is past its promised delivery date."}
        {bottleneck?.count ? ` The most orders are at ${bottleneck.name}.` : ""}
        {promise.leadDays != null ? ` Orders delivered this period took ${promise.leadDays.toFixed(0)} days on average from order to delivery.` : ""}
        {internalLate ? ` A further ${num(internalLate)} internal stock and alteration orders are also past their date.` : ""}
      </Insight>
      <div className="ceo-tiles">
        <Tile icon="orders" label="Open Client Orders" value={num(book.count)} note={`Not yet delivered. Value ${shortInr(book.value)}`} onClick={() => open({ type: "orders", title: "Open Client Orders", orders: book.running })} />
        <Tile icon="alert" tone="warn" label="Orders Past Delivery Date" value={num(delayedRows.length)} note={`Value ${shortInr(delayedValue)}`} onClick={() => open({ type: "orders", title: "Orders Past Delivery Date", orders: delayedRows })} />
        <Tile icon="pin" label="On-Time Delivery Rate" value={promise.rate == null ? "–" : `${promise.rate.toFixed(0)}%`} note={promise.delivered ? `${periodName}: ${num(promise.onTime)} of ${num(promise.delivered)} orders on time` : `${periodName}: none delivered`} />
        <Tile icon="integrity" label="QC Failure Rate" value={ops.qcFailRate != null ? `${ops.qcFailRate}%` : "–"} note={ops.qcFailCount != null ? `${periodName}: ${num(ops.qcFailCount)} of ${num(ops.qcInspected)} quality checks failed` : "Loading"} />
      </div>
      <div className="ceo-grid">
        <Card span={12} title="Due Soon, Still Early" sub={`Made-to-order client orders due in the next 7 days, by the stage each is recorded at. "Still Early" means Order Received or Cloth Issue. Click a row to see the orders.`}>
          <div className="ceo-due-head">
            <button type="button" onClick={() => open({ type: "orders", title: "Due Soon, Still Early", orders: dueSoon.early })}>
              <small>Still Early</small><b className={dueSoon.early.length ? "ceo-text-crit" : undefined}>{num(dueSoon.early.length)}</b><em>{shortInr(dueSoon.earlyValue)}</em>
            </button>
            <button type="button" onClick={() => open({ type: "orders", title: "Made-to-Order Orders Due in 7 Days", orders: dueSoon.made })}>
              <small>All Made-to-Order Due in 7 Days</small><b>{num(dueSoon.made.length)}</b><em>{shortInr(dueSoon.madeValue)}</em>
            </button>
            <button type="button" onClick={() => open({ type: "orders", title: "Website-Synced Orders Due in 7 Days", orders: dueSoon.website })}>
              <small>Website-Synced Due in 7 Days</small><b>{num(dueSoon.website.length)}</b><em>{shortInr(dueSoon.websiteValue)}</em>
            </button>
          </div>
          <Table
            rowKey={(r) => r.key}
            rows={dueSoon.rows}
            empty="No made-to-order orders are due in the next 7 days."
            onRow={(r) => open({ type: "orders", title: r.name, sub: "Due in the Next 7 Days", orders: r.orders })}
            columns={[
              { key: "name", label: "Production Stage", render: (r) => <>{r.early && <i className="ceo-pill is-warn">Still Early</i>} <b>{r.name}</b></> },
              { key: "count", label: "Orders", right: true, render: (r) => num(r.count) },
              { key: "value", label: "Order Value", right: true, render: (r) => shortInr(r.value) },
            ]}
          />
        </Card>
        <Card span={12} title="Open Client Orders by Production Stage" sub="Click a stage to see its orders">
          <div className="ceo-flow">
            {stages.map((s) => (
              <button type="button" key={s.key} className={`ceo-flow-step${s.count && s === bottleneck ? " is-hot" : ""}`} onClick={() => open({ type: "orders", title: s.name, sub: "Orders at This Stage", orders: s.orders, note: s.count ? `On average they have been at this stage for ${s.avgDays.toFixed(0)} days.` : undefined })}>
                <b>{num(s.count)}</b>
                <span>{s.name}</span>
                {s.count > 0 && <small>Average {s.avgDays.toFixed(0)} days here</small>}
              </button>
            ))}
          </div>
        </Card>
        <Card span={12} title="Open Client Orders by Delivery Date" sub="The oldest may have left without a dispatch scan, so they are worth checking first. Click to see the orders.">
          <div className="ceo-minirow is-buttons">
            <button type="button" onClick={() => open({ type: "orders", title: "Due in the Next 7 Days", orders: [...book.dueWeek].sort((a, b) => new Date(a.delivery_date) - new Date(b.delivery_date)) })}>
              <small>Due in the Next 7 Days</small><b>{num(book.dueWeek.length)}</b><em>{shortInr(book.dueWeekValue)}</em>
            </button>
            {lateAges.map((b) => (
              <button type="button" key={b.name} onClick={() => open({ type: "orders", title: b.name, orders: b.orders })}>
                <small>{b.name}</small><b>{num(b.count)}</b><em>{shortInr(b.value)}</em>
              </button>
            ))}
          </div>
        </Card>
        <Card span={12} title="Orders Past Delivery Date" sub="Oldest first. Click one to open it." action="All Orders" onAction={() => go("orders")}>
          <Table
            rowKey={(r) => r.id}
            rows={rows}
            onRow={(o) => open({ type: "order", order: o })}
            empty="Nothing is late."
            columns={[
              { key: "order_no", label: "Order Number", render: (r) => <b>{r.order_no}</b> },
              { key: "client", label: "Client", hide: true, render: (r) => r.delivery_name || "–" },
              { key: "product", label: "Design", hide: true, render: (r) => <span className="ceo-clip" title={r.items?.[0]?.product_name}>{r.items?.[0]?.product_name || "–"}</span> },
              { key: "channel", label: "Sales Channel", hide: true, tab: true },
              { key: "delivery_date", label: "Promised Date", right: true, hide: true, render: (r) => formatDate(r.delivery_date) },
              { key: "daysLate", label: "Days Late", right: true, render: (r) => <b className={r.daysLate > 14 ? "ceo-text-crit" : "ceo-text-warn"}>{r.daysLate} days</b> },
            ]}
          />
          {delayedRows.length > 15 && (
            <button type="button" className="ceo-more" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show Fewer" : `Show All ${num(delayedRows.length)}`}
            </button>
          )}
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ VENDORS
export function VendorsPage({ ctx }) {
  const { vendors, open, periodName } = ctx;
  const [search, setSearch] = useState("");
  const [view, setView] = useState("");
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendors.rows.filter((v) => {
      if (q && !v.name.toLowerCase().includes(q) && !String(v.location).toLowerCase().includes(q)) return false;
      if (view === "overdue" && !v.pastDate) return false;
      if (view === "late" && !v.late) return false;
      return true;
    });
  }, [vendors, search, view]);
  const worst = [...vendors.rows].sort((a, b) => b.pastDate - a.pastDate)[0];
  const openVendor = (v) => open({ type: "vendor", vendor: v });
  return (
    <div className="ceo-page">
      <PageHead title="Vendors" desc="Pieces out with vendors, and how reliably each vendor returns them by the agreed date." />
      <Insight tone={vendors.pastDate ? "warn" : "gold"}>
        {`${num(vendors.outNow)} pieces are out with vendors, and ${num(vendors.pastDate)} are past their return date.`}
        {worst?.pastDate ? ` ${worst.name} holds the most, at ${num(worst.pastDate)}.` : ""}
        {vendors.ownFactory.outNow ? ` Another ${num(vendors.ownFactory.outNow)} pieces at our own Factory 2 are not counted as vendor work.` : ""}
        {" All figures are as scanned at the gate, so a piece that came back without a scan still shows as out."}
      </Insight>
      <div className="ceo-tiles">
        <Tile icon="warehouse" label="Pieces Out With Vendors" value={num(vendors.outNow)} note="As of now" onClick={() => setView("")} />
        <Tile icon="alert" tone="warn" label="Pieces Past Return Date" value={num(vendors.pastDate)} note="As of now" onClick={() => setView("overdue")} />
        <Tile icon="receive" label="Pieces Returned" value={num(vendors.returned)} note={periodName} />
        <Tile icon="pin" label="On-Time Return Rate" value={vendors.onTimeRate == null ? "–" : `${vendors.onTimeRate.toFixed(0)}%`} note={`${periodName}: ${num(vendors.late)} returned after the agreed date`} onClick={() => setView("late")} />
      </div>
      <Card title="Vendor Scorecard" sub="Returns follow the chosen period. Pieces out are as of now. Click a vendor to see the orders.">
        <div className="ceo-tools">
          <SearchBox value={search} onChange={setSearch} placeholder="Search by vendor or location" />
          <Chips options={[{ value: "overdue", label: "Has Pieces Past Date" }, { value: "late", label: "Returned Late" }]} value={view} onChange={setView} />
        </div>
        <Table
          rowKey={(r) => r.name}
          rows={rows}
          empty="No vendor matches."
          onRow={openVendor}
          columns={[
            { key: "name", label: "Vendor", render: (v) => <><b>{v.name}</b><small className="ceo-cell-sub">{v.work.slice(0, 2).map((w) => w.name).join(", ") || v.location}</small></> },
            { key: "outNow", label: "Pieces Out", right: true, render: (v) => num(v.outNow) },
            { key: "pastDate", label: "Past Return Date", right: true, render: (v) => (v.pastDate ? <b className="ceo-text-crit">{num(v.pastDate)}</b> : "0") },
            { key: "returned", label: "Pieces Returned", right: true, hide: true, render: (v) => num(v.returned) },
            { key: "rate", label: "On-Time Return Rate", right: true, hide: true, render: (v) => (v.onTimeRate == null ? "–" : `${v.onTimeRate.toFixed(0)}%`) },
            { key: "late", label: "Average Days Late", right: true, hide: true, tab: true, render: (v) => (v.averageDaysLate == null ? "–" : v.averageDaysLate.toFixed(1)) },
            { key: "out", label: "Average Days Out", right: true, hide: true, tab: true, render: (v) => (v.averageDaysOut == null ? "–" : v.averageDaysOut.toFixed(1)) },
          ]}
        />
      </Card>
    </div>
  );
}
