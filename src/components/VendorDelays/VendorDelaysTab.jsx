import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Cell,
} from "recharts";
import { supabase } from "../../lib/supabaseClient";
import PeriodFilter, { usePeriodFilter, comparisonPeriodRange, inRange } from "../PeriodFilter";
import Paginator from "../Paginator";
import ComponentJourneyModal from "../ComponentJourneyModal";
import { buildCsv, downloadCsv } from "../AddProduct/csvHelpers";
import formatIndianNumber from "../../utils/formatIndianNumber";
import {
    buildDelayTrips, attachPenalties, delaySummary, vendorScorecard, heatmap, weeklyTrend,
    latenessBuckets, overdueAging, productDelays, deadlineImpact, buildInsights,
    suggestedPenalty, penaltyEligibility, OVERDUE_BUCKETS, PIECE_LABEL,
} from "../../utils/vendorDelays";
import "./VendorDelays.css";

const fmtDate = (ms) => {
    if (!ms && ms !== 0) return "—";
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};
const money = (v) => `₹${formatIndianNumber(Math.round(Number(v) || 0))}`;
const heatColor = (p) => (p >= 50 ? "#f8c4c4" : p >= 35 ? "#fbd9b4" : p >= 20 ? "#fdf0c2" : "#d8f0d8");
const STATUS_LABEL = { pending: "Pending", settled: "Settled", waived: "Waived" };
const DRAWER_PAGE = 30;

/**
 * Vendor Delays (Release 20) — Production Manager only.
 * Analytics over vendor trips (late returns, who, on what work, customer
 * impact) where every card / bar / cell / insight opens the order cards it
 * covers, plus penalties on late trips and a penalties ledger.
 *
 * @param {object[]} movements   fetchExternalMovements() rows (already loaded by the dashboard)
 * @param {boolean}  loading
 * @param {object[]} orders      the dashboard's orders (for order no, client, product, deadline)
 * @param {function} onOrderClick (orderId, orderNo) — open the order in All Orders
 * @param {boolean}  canPenalise  true for the Production Manager
 */
export default function VendorDelaysTab({ movements = [], loading, orders = [], onOrderClick, canPenalise }) {
    const [view, setView] = useState("analytics"); // analytics | penalties
    const [channel, setChannel] = useState("");
    const [vendorFilter, setVendorFilter] = useState("");
    const [pieceFilter, setPieceFilter] = useState("");
    const { range, inPeriod, props: periodProps } = usePeriodFilter("30d", { variant: "pills" });

    // ── Penalties (tolerant: before r20_01 the tables do not exist)
    const [pen, setPen] = useState({ ready: false, available: false, list: [], trips: [], rates: {} });
    const loadPenalties = useCallback(async () => {
        try {
            const [p, t] = await Promise.all([
                supabase.from("vendor_penalties").select("*").order("created_at", { ascending: false }),
                supabase.from("vendor_penalty_trips").select("penalty_id, movement_id, order_id, order_no, barcode, days_late"),
            ]);
            if (p.error || t.error) throw p.error || t.error;
            const { data: vend } = await supabase.from("production_vendors").select("id, vendor_name, per_day_penalty");
            const rates = {};
            (vend || []).forEach((v) => { rates[v.vendor_name] = { id: v.id, rate: v.per_day_penalty }; });
            setPen({ ready: true, available: true, list: p.data || [], trips: t.data || [], rates });
        } catch (e) {
            console.warn("Vendor penalties not available:", e?.message || e);
            setPen({ ready: true, available: false, list: [], trips: [], rates: {} });
        }
    }, []);
    useEffect(() => { loadPenalties(); }, [loadPenalties]);

    // ── Trips
    const orderById = useMemo(() => Object.fromEntries(orders.map((o) => [o.id, o])), [orders]);
    const allTrips = useMemo(
        () => attachPenalties(buildDelayTrips(movements, orderById), pen.trips),
        [movements, orderById, pen.trips]
    );
    const channels = useMemo(() => [...new Set(allTrips.map((t) => t.channel))].filter(Boolean).sort(), [allTrips]);
    const vendorNames = useMemo(() => [...new Set(allTrips.map((t) => t.vendor))].sort(), [allTrips]);
    const scoped = useMemo(() => allTrips.filter((t) =>
        (!channel || t.channel === channel) &&
        (!vendorFilter || t.vendor === vendorFilter) &&
        (!pieceFilter || t.piece === pieceFilter)), [allTrips, channel, vendorFilter, pieceFilter]);
    const iso = (ms) => new Date(ms).toISOString();
    const trips = useMemo(() => scoped.filter((t) => inPeriod(iso(t.sentAt))), [scoped, inPeriod]);
    const prevRange = range ? comparisonPeriodRange(range, "previous_period") : null;
    const prevTrips = useMemo(
        () => (prevRange ? scoped.filter((t) => inRange(prevRange, iso(t.sentAt))) : null),
        [scoped, prevRange?.start?.getTime(), prevRange?.end?.getTime()] // eslint-disable-line react-hooks/exhaustive-deps
    );

    const summary = useMemo(() => delaySummary(trips), [trips]);
    const scorecard = useMemo(() => vendorScorecard(trips, prevTrips), [trips, prevTrips]);
    const topVendors = useMemo(() => scorecard.filter((v) => v.judged >= 10).slice(0, 15).map((v) => v.key), [scorecard]);
    const pieceHeat = useMemo(() => heatmap(trips, (t) => t.pieceLabel, { vendors: topVendors }), [trips, topVendors]);
    const workHeat = useMemo(() => heatmap(trips, (t) => t.work, { vendors: topVendors }), [trips, topVendors]);
    const trend = useMemo(() => weeklyTrend(trips), [trips]);
    const buckets = useMemo(() => latenessBuckets(trips), [trips]);
    const aging = useMemo(() => overdueAging(scoped), [scoped]); // overdue NOW — not period-bound
    const products = useMemo(() => productDelays(trips), [trips]);
    const impact = useMemo(() => deadlineImpact(trips), [trips]);
    const insights = useMemo(
        () => buildInsights(trips, prevTrips, { overdueNow: aging.flatMap((r) => r.trips) }),
        [trips, prevTrips, aging]
    );
    const penaltyTotal = useMemo(() => {
        const ids = new Set(trips.map((t) => t.penaltyId).filter(Boolean));
        const list = pen.list.filter((p) => ids.has(p.id));
        return {
            amount: list.filter((p) => p.status !== "waived").reduce((s, p) => s + Number(p.amount || 0), 0),
            pending: list.filter((p) => p.status === "pending").length,
            trips: trips.filter((t) => t.penaltyId),
        };
    }, [trips, pen.list]);

    // ── Drawer (the order cards behind any card / bar / cell / insight)
    const [drawer, setDrawer] = useState(null); // { title, trips }
    const open = (title, list) => setDrawer({ title, trips: [...list].sort((a, b) => b.daysLate - a.daysLate) });

    if (loading && movements.length === 0) {
        return <div className="vd-loading">Loading vendor trips…</div>;
    }

    return (
        <div className="vd-root">
            <div className="vd-head">
                <div className="vd-views">
                    <button className={`vd-view ${view === "analytics" ? "active" : ""}`} onClick={() => setView("analytics")}>Delay analytics</button>
                    <button className={`vd-view ${view === "penalties" ? "active" : ""}`} onClick={() => setView("penalties")}>
                        Penalties{pen.available ? ` (${pen.list.length})` : ""}
                    </button>
                </div>
            </div>

            {view === "penalties" ? (
                <PenaltiesLedger pen={pen} canPenalise={canPenalise} onChanged={loadPenalties} allTrips={allTrips} onOpenTrips={open} />
            ) : (
                <>
                    <div className="vd-filters">
                        <PeriodFilter {...periodProps} label="Trips sent out:" />
                        <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                            <option value="">All channels</option>
                            {channels.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}>
                            <option value="">All vendors</option>
                            {vendorNames.map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                        <select value={pieceFilter} onChange={(e) => setPieceFilter(e.target.value)}>
                            <option value="">All pieces</option>
                            {Object.entries(PIECE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                    </div>
                    <p className="vd-caption">
                        A trip is late when the piece came back (or, still out, is now) after the end of its promised return day. If a piece was sent out after its return date had already passed, the vendor is judged from the send date plus the planned turnaround.
                        Our own SB WH Delhi (2) is not counted. Click any number, bar, cell or insight to see the order cards behind it.
                    </p>

                    {/* Cards */}
                    <div className="vd-cards">
                        <Card title="On-time returns" value={`${summary.onTimePct}%`} sub={`${formatIndianNumber(summary.returned)} trips returned`}
                            onClick={() => open("Trips returned", trips.filter((t) => !t.isOut))} />
                        <Card title="Late returns" value={formatIndianNumber(summary.lateReturned)} sub={`${summary.avgDaysLate} days late on average`} tone="bad"
                            onClick={() => open("Late returns", trips.filter((t) => !t.isOut && t.isLate))} />
                        <Card title="Overdue at vendors now" value={formatIndianNumber(aging.reduce((s, r) => s + r.total, 0))}
                            sub={`oldest ${aging.reduce((m, r) => Math.max(m, ...r.trips.map((t) => t.daysLate)), 0)} days`} tone="warn"
                            onClick={() => open("Overdue at vendors now", aging.flatMap((r) => r.trips))} />
                        <Card title="Missed the order deadline" value={formatIndianNumber(summary.missedDeadline)} sub="late return after delivery − 2 days" tone="bad"
                            onClick={() => open("Late returns that missed the order's production deadline", trips.filter((t) => t.missedDeadline))} />
                        <Card title="Penalties" value={pen.available ? money(penaltyTotal.amount) : "—"}
                            sub={pen.available ? `${penaltyTotal.pending} pending` : "not set up yet"}
                            onClick={() => open("Penalised trips", penaltyTotal.trips)} />
                    </div>

                    {/* Insights */}
                    {insights.length > 0 && (
                        <div className="vd-panel">
                            <h3 className="vd-title">What stands out</h3>
                            <ul className="vd-insights">
                                {insights.map((ins, i) => (
                                    <li key={i} className={`vd-insight ${ins.tone}`} onClick={() => open(ins.text, ins.trips)}>
                                        {ins.text} <span className="vd-more">({ins.trips.length} trips →)</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Scorecard */}
                    <div className="vd-panel">
                        <h3 className="vd-title">Vendor scorecard</h3>
                        <div className="vd-table-wrap">
                            <table className="vd-table">
                                <thead>
                                    <tr>
                                        <th>Vendor</th><th>Trips</th><th>Late %</th><th>vs previous</th><th>Avg days late</th>
                                        <th>Worst</th><th>Overdue now</th><th>Missed deadline</th><th>Promised → actual days</th><th>Penalties</th>
                                        {canPenalise && pen.available && <th>₹ / day late</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {scorecard.map((v) => {
                                        const vPen = pen.list.filter((p) => p.vendor_name === v.key && p.status !== "waived");
                                        const delta = v.prevLatePct == null ? null : v.latePct - v.prevLatePct;
                                        return (
                                            <tr key={v.key}>
                                                <td className="vd-link" onClick={() => open(`${v.key} — all trips`, v.trips)}>{v.key}</td>
                                                <td>{v.n}</td>
                                                <td className="vd-link" style={{ background: heatColor(v.latePct) }}
                                                    onClick={() => open(`${v.key} — late trips`, v.trips.filter((t) => t.isLate))}>{v.latePct}%</td>
                                                <td className={delta == null ? "" : delta > 0 ? "vd-up" : "vd-down"}>
                                                    {delta == null ? "—" : `${delta > 0 ? "▲" : delta < 0 ? "▼" : "="} ${Math.abs(delta)} pts`}
                                                </td>
                                                <td>{v.avgDaysLate || "—"}</td>
                                                <td>{v.worstDaysLate ? `${v.worstDaysLate} d` : "—"}</td>
                                                <td className={v.overdueNow ? "vd-link" : ""}
                                                    onClick={() => v.overdueNow && open(`${v.key} — overdue now`, v.trips.filter((t) => t.isOut && t.isLate))}>{v.overdueNow || "—"}</td>
                                                <td className={v.missedDeadline ? "vd-link" : ""}
                                                    onClick={() => v.missedDeadline && open(`${v.key} — missed order deadlines`, v.trips.filter((t) => t.missedDeadline))}>{v.missedDeadline || "—"}</td>
                                                <td>{v.lateDone || v.n ? `${v.avgPromised} → ${v.avgActual}` : "—"}</td>
                                                <td>{vPen.length ? money(vPen.reduce((s, p) => s + Number(p.amount || 0), 0)) : "—"}</td>
                                                {canPenalise && pen.available && (
                                                    <td><RateCell vendor={v.key} rate={pen.rates[v.key]} onSaved={loadPenalties} /></td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                    {scorecard.length === 0 && <tr><td colSpan={11} className="vd-empty">No vendor trips in this period.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Late % by vendor */}
                    {scorecard.length > 0 && (
                        <div className="vd-panel">
                            <h3 className="vd-title">Late % by vendor <span className="vd-hint">(vendors with 10+ trips)</span></h3>
                            <ResponsiveContainer width="100%" height={Math.max(220, topVendors.length * 26)}>
                                <BarChart data={scorecard.filter((v) => v.judged >= 10)} layout="vertical" margin={{ left: 10, right: 30 }}>
                                    <XAxis type="number" unit="%" domain={[0, 100]} tick={{ fontSize: 11 }} />
                                    <YAxis type="category" dataKey="key" width={150} tick={{ fontSize: 11 }} />
                                    <Tooltip formatter={(v) => [`${v}%`, "Late"]} />
                                    <Bar dataKey="latePct" cursor="pointer" onClick={(d) => open(`${d.key} — late trips`, d.trips.filter((t) => t.isLate))}>
                                        {scorecard.filter((v) => v.judged >= 10).map((v) => <Cell key={v.key} fill={v.latePct >= 50 ? "#d9534f" : v.latePct >= 30 ? "#f0ad4e" : "#5cb85c"} />)}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}

                    {/* Heatmaps */}
                    <Heatmap title="Late % — vendor × piece" data={pieceHeat} onOpen={open} />
                    <Heatmap title="Late % — vendor × work" data={workHeat} onOpen={open} />

                    <div className="vd-grid-2">
                        {/* Trend */}
                        <div className="vd-panel">
                            <h3 className="vd-title">Late % by week</h3>
                            {trend.length > 1 ? (
                                <ResponsiveContainer width="100%" height={240}>
                                    <LineChart data={trend} margin={{ left: 0, right: 20, top: 10 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                                        <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                                        <YAxis unit="%" tick={{ fontSize: 11 }} />
                                        <Tooltip formatter={(v) => [`${v}%`, "Late"]} labelFormatter={(w) => `Week of ${w}`} />
                                        <Line type="monotone" dataKey="latePct" stroke="#d9534f" strokeWidth={2}
                                            activeDot={{ r: 6, cursor: "pointer", onClick: (_, p) => open(`Week of ${p.payload.week} — late trips`, p.payload.trips.filter((t) => t.isLate)) }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            ) : <p className="vd-empty">Choose a longer period to see a trend.</p>}
                        </div>
                        {/* How late */}
                        <div className="vd-panel">
                            <h3 className="vd-title">How late were the late returns</h3>
                            <ResponsiveContainer width="100%" height={240}>
                                <BarChart data={buckets} margin={{ left: 0, right: 20, top: 10 }}>
                                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                                    <Tooltip />
                                    <Bar dataKey="count" fill="#f0ad4e" cursor="pointer" onClick={(d) => open(`Late returns — ${d.bucket}`, d.trips)} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Overdue now by age */}
                    <div className="vd-panel">
                        <h3 className="vd-title">Overdue at vendors right now, by age <span className="vd-hint">(today, whatever the period)</span></h3>
                        <div className="vd-table-wrap">
                            <table className="vd-table">
                                <thead><tr><th>Vendor</th><th>Total</th>{OVERDUE_BUCKETS.map((b) => <th key={b.key}>{b.key}</th>)}</tr></thead>
                                <tbody>
                                    {aging.map((r) => (
                                        <tr key={r.vendor}>
                                            <td className="vd-link" onClick={() => open(`${r.vendor} — overdue now`, r.trips)}>{r.vendor}</td>
                                            <td className="vd-link" onClick={() => open(`${r.vendor} — overdue now`, r.trips)}>{r.total}</td>
                                            {OVERDUE_BUCKETS.map((b) => (
                                                <td key={b.key} className={r[b.key].length ? "vd-link" : ""}
                                                    style={{ background: r[b.key].length ? heatColor(b.key.startsWith("10") ? 60 : b.key.startsWith("6") ? 40 : 25) : undefined }}
                                                    onClick={() => r[b.key].length && open(`${r.vendor} — overdue ${b.key}`, r[b.key])}>{r[b.key].length || "—"}</td>
                                            ))}
                                        </tr>
                                    ))}
                                    {aging.length === 0 && <tr><td colSpan={6} className="vd-empty">Nothing overdue right now.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="vd-grid-2">
                        {/* Products */}
                        <div className="vd-panel">
                            <h3 className="vd-title">Products most delayed at a vendor <span className="vd-hint">(5+ trips)</span></h3>
                            <div className="vd-table-wrap">
                                <table className="vd-table">
                                    <thead><tr><th>Product</th><th>Vendor</th><th>Trips</th><th>Late %</th></tr></thead>
                                    <tbody>
                                        {products.map((p) => (
                                            <tr key={p.key} className="vd-row-link" onClick={() => open(`${p.product} at ${p.vendor}`, p.trips)}>
                                                <td>{p.product}</td><td>{p.vendor}</td><td>{p.n}</td>
                                                <td style={{ background: heatColor(p.latePct) }}>{p.latePct}%</td>
                                            </tr>
                                        ))}
                                        {products.length === 0 && <tr><td colSpan={4} className="vd-empty">Not enough trips yet.</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        {/* Deadline impact */}
                        <div className="vd-panel">
                            <h3 className="vd-title">Missed order deadlines by channel</h3>
                            {impact.length ? (
                                <ResponsiveContainer width="100%" height={240}>
                                    <BarChart data={impact} margin={{ left: 0, right: 20, top: 10 }}>
                                        <XAxis dataKey="channel" tick={{ fontSize: 11 }} />
                                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                                        <Tooltip formatter={(v, n, p) => [`${v} late returns (${p.payload.orders} orders)`, "Missed deadline"]} />
                                        <Bar dataKey="count" fill="#d9534f" cursor="pointer" onClick={(d) => open(`${d.channel} — late returns after the order deadline`, d.trips)} />
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : <p className="vd-empty">No late return missed an order deadline in this period.</p>}
                        </div>
                    </div>
                </>
            )}

            {drawer && (
                <TripsDrawer
                    title={drawer.title}
                    trips={drawer.trips}
                    canPenalise={canPenalise && pen.available}
                    rates={pen.rates}
                    onClose={() => setDrawer(null)}
                    onOrderClick={onOrderClick}
                    onPenalised={async () => { await loadPenalties(); setDrawer(null); }}
                />
            )}
        </div>
    );
}

function Card({ title, value, sub, tone, onClick }) {
    return (
        <button type="button" className={`vd-card ${tone || ""}`} onClick={onClick}>
            <span className="vd-card-title">{title}</span>
            <span className="vd-card-value">{value}</span>
            <span className="vd-card-sub">{sub}</span>
        </button>
    );
}

function Heatmap({ title, data, onOpen }) {
    if (!data.rows.length) return null;
    return (
        <div className="vd-panel">
            <h3 className="vd-title">{title} <span className="vd-hint">(busiest vendors; blank = fewer than 5 trips)</span></h3>
            <div className="vd-table-wrap">
                <table className="vd-table vd-heat">
                    <thead><tr><th>Vendor</th><th>Overall</th>{data.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                    <tbody>
                        {data.rows.map((r) => (
                            <tr key={r.vendor}>
                                <td>{r.vendor}</td>
                                <td>{r.latePct}%</td>
                                {data.cols.map((c) => {
                                    const cell = r.cells[c];
                                    if (!cell) return <td key={c} />;
                                    if (cell.sparse) return <td key={c} className="vd-sparse" title={`${cell.n} trips`}>·</td>;
                                    const worse = cell.latePct - r.latePct >= 15;
                                    return (
                                        <td key={c} className={`vd-link ${worse ? "vd-worse" : ""}`} style={{ background: heatColor(cell.latePct) }}
                                            title={`${cell.late} late of ${cell.judged}`}
                                            onClick={() => onOpen(`${r.vendor} — ${c}`, cell.trips)}>
                                            {cell.latePct}%
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function RateCell({ vendor, rate, onSaved }) {
    const [editing, setEditing] = useState(false);
    const [val, setVal] = useState(rate?.rate ?? "");
    const [msg, setMsg] = useState("");
    if (!rate?.id) return <span className="vd-muted">—</span>;
    const save = async () => {
        const n = val === "" ? null : Number(val);
        if (n != null && (!Number.isFinite(n) || n < 0)) { setMsg("Invalid"); return; }
        const { data, error } = await supabase.rpc("set_vendor_penalty_rate", { p_vendor_id: rate.id, p_rate: n });
        if (error || !data?.success) { setMsg(error?.message || data?.message || "Failed"); return; }
        setEditing(false); setMsg(""); onSaved?.();
    };
    if (!editing) {
        return <button type="button" className="vd-mini" title={`Set ₹ per day late for ${vendor}`} onClick={() => { setVal(rate.rate ?? ""); setEditing(true); }}>
            {rate.rate != null ? money(rate.rate) : "Set"}
        </button>;
    }
    return (
        <span className="vd-rate-edit">
            <input type="number" min="0" value={val} onChange={(e) => setVal(e.target.value)} />
            <button type="button" className="vd-mini" onClick={save}>Save</button>
            <button type="button" className="vd-mini ghost" onClick={() => setEditing(false)}>✕</button>
            {msg && <span className="vd-err">{msg}</span>}
        </span>
    );
}

function TripsDrawer({ title, trips, canPenalise, rates, onClose, onOrderClick, onPenalised }) {
    const [page, setPage] = useState(1);
    const [selected, setSelected] = useState(() => new Set());
    const [penaltyFor, setPenaltyFor] = useState(null);
    const [journey, setJourney] = useState(null);
    const totalPages = Math.max(1, Math.ceil(trips.length / DRAWER_PAGE));
    const shown = trips.slice((page - 1) * DRAWER_PAGE, page * DRAWER_PAGE);
    const sel = trips.filter((t) => selected.has(t.id));
    const elig = penaltyEligibility(sel);
    const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const selectAllLate = () => setSelected(new Set(trips.filter((t) => t.isLate && !t.penaltyId).map((t) => t.id)));
    const openJourney = async (t) => {
        const { data } = await supabase.from("order_components").select("*").eq("order_id", t.orderId);
        setJourney({ orderNo: t.orderNo, components: data || [] });
    };
    const exportCsv = () => {
        const headers = ["Order No", "Client", "Channel", "Product", "Piece", "Barcode", "Vendor", "Work", "Sent out", "Promised", "Promised at set-up", "Returned", "Days late", "Order deadline", "Missed deadline", "Penalised"];
        const rows = trips.map((t) => ({
            "Order No": t.orderNo, "Client": t.client, "Channel": t.channel, "Product": t.product, "Piece": t.pieceLabel,
            "Barcode": t.barcode, "Vendor": t.vendor, "Work": t.workDetail, "Sent out": fmtDate(t.sentAt), "Promised": fmtDate(t.due), "Promised at set-up": fmtDate(t.promisedOriginal),
            "Returned": t.isOut ? "Still out" : fmtDate(t.returnedAt), "Days late": t.daysLate,
            "Order deadline": Number.isFinite(t.deadline) ? fmtDate(t.deadline) : "", "Missed deadline": t.missedDeadline ? "Yes" : "",
            "Penalised": t.penaltyId ? "Yes" : "",
        }));
        downloadCsv(`vendor_delays_${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(headers, rows));
    };
    const orderCount = new Set(trips.map((t) => t.orderId)).size;

    return (
        <div className="vd-overlay" onClick={onClose}>
            <div className="vd-drawer" onClick={(e) => e.stopPropagation()}>
                <div className="vd-drawer-head">
                    <div>
                        <h3>{title}</h3>
                        <p className="vd-muted">{trips.length} trips · {orderCount} orders · {trips.filter((t) => t.isLate).length} late</p>
                    </div>
                    <div className="vd-drawer-actions">
                        <button type="button" className="vd-mini ghost" onClick={exportCsv}>Export CSV</button>
                        <button type="button" className="vd-close" onClick={onClose}>✕</button>
                    </div>
                </div>
                {canPenalise && (
                    <div className="vd-penalty-bar">
                        <button type="button" className="vd-mini ghost" onClick={selectAllLate}>Select all late, not yet penalised</button>
                        {sel.length > 0 && <button type="button" className="vd-mini ghost" onClick={() => setSelected(new Set())}>Clear ({sel.length})</button>}
                        <button type="button" className="vd-primary" disabled={!elig.ok} title={elig.ok ? "" : elig.reason}
                            onClick={() => setPenaltyFor({ vendor: elig.vendor, vendorId: rates[elig.vendor]?.id || elig.vendorId, trips: sel })}>
                            Add penalty{sel.length ? ` (${sel.length})` : ""}
                        </button>
                        {!elig.ok && sel.length > 0 && <span className="vd-err">{elig.reason}</span>}
                    </div>
                )}
                <div className="vd-cards-list">
                    {shown.map((t) => (
                        <div key={t.id} className={`vd-trip ${t.isLate ? "late" : ""}`}>
                            <div className="vd-trip-head">
                                {canPenalise && t.isLate && !t.penaltyId && (
                                    <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                                )}
                                <span className="vd-trip-order vd-link" onClick={() => onOrderClick?.(t.orderId, t.orderNo)}>{t.orderNo || "—"}</span>
                                <span className="vd-muted">{t.client}</span>
                                <span className="vd-tag">{t.channel}</span>
                                {t.isOut && t.isLate && <span className="vd-tag warn">Overdue now</span>}
                                {t.missedDeadline && <span className="vd-tag bad">Missed deadline</span>}
                                {t.penaltyId && <span className="vd-tag pen">Penalised</span>}
                                <span className={`vd-days ${t.isLate ? "late" : ""}`}>{t.isLate ? `${t.daysLate} day${t.daysLate === 1 ? "" : "s"} late` : "On time"}</span>
                            </div>
                            <div className="vd-trip-body">
                                <span><b>{t.product || "—"}</b> · {t.pieceLabel} <span className="vd-muted">{t.barcode}</span></span>
                                <span><b>{t.vendor}</b> · {t.workDetail}</span>
                                <span>Sent {fmtDate(t.sentAt)} · promised {fmtDate(t.due)} · {t.isOut ? "still out" : `back ${fmtDate(t.returnedAt)}`}
                                    {t.dueAdjusted && <span className="vd-muted" title={`Return date ${fmtDate(t.promisedOriginal)} had passed when the piece was sent`}> (set-up date {fmtDate(t.promisedOriginal)} had passed — counted from the send date)</span>}</span>
                                <span>Order deadline {Number.isFinite(t.deadline) ? fmtDate(t.deadline) : "—"}</span>
                            </div>
                            <div className="vd-trip-actions">
                                <button type="button" className="vd-mini ghost" onClick={() => openJourney(t)}>View Journey</button>
                                <button type="button" className="vd-mini ghost" onClick={() => onOrderClick?.(t.orderId, t.orderNo)}>Open order</button>
                            </div>
                        </div>
                    ))}
                    {trips.length === 0 && <p className="vd-empty">No trips.</p>}
                </div>
                {totalPages > 1 && <Paginator page={page} totalPages={totalPages} onChange={setPage} />}
            </div>
            {penaltyFor && (
                <PenaltyModal
                    target={penaltyFor}
                    rate={rates[penaltyFor.vendor]?.rate}
                    onClose={() => setPenaltyFor(null)}
                    onSaved={async () => { setPenaltyFor(null); setSelected(new Set()); await onPenalised?.(); }}
                />
            )}
            {journey && (
                <div onClick={(e) => e.stopPropagation()}>
                    <ComponentJourneyModal orderNo={journey.orderNo} components={journey.components} onClose={() => setJourney(null)} />
                </div>
            )}
        </div>
    );
}

function PenaltyModal({ target, rate, onClose, onSaved }) {
    const { days } = suggestedPenalty(target.trips, rate);
    const [basis, setBasis] = useState(rate ? "per_day" : "fixed");
    const [perDay, setPerDay] = useState(rate ?? "");
    const [amount, setAmount] = useState(rate ? Math.round(Number(rate) * days) : "");
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const onRate = (v) => { setPerDay(v); if (basis === "per_day" && v !== "" && Number.isFinite(Number(v))) setAmount(Math.round(Number(v) * days)); };
    const save = async () => {
        const amt = Number(amount);
        if (!Number.isFinite(amt) || amt < 0 || amount === "") { setErr("Enter the penalty amount."); return; }
        if (!reason.trim()) { setErr("A reason is required."); return; }
        setBusy(true); setErr("");
        const { data, error } = await supabase.rpc("create_vendor_penalty", {
            p_vendor_id: target.vendorId || null,
            p_vendor_name: target.vendor,
            p_movement_ids: target.trips.map((t) => t.id),
            p_basis: basis,
            p_rate: basis === "per_day" && perDay !== "" ? Number(perDay) : null,
            p_amount: amt,
            p_reason: reason.trim(),
        });
        setBusy(false);
        if (error || !data?.success) { setErr(error?.message || data?.message || "Could not save the penalty."); return; }
        onSaved?.();
    };
    return (
        <div className="vd-overlay vd-top" onClick={(e) => { e.stopPropagation(); onClose(); }}>
            <div className="vd-modal" onClick={(e) => e.stopPropagation()}>
                <h3>Penalty — {target.vendor}</h3>
                <p className="vd-muted">{target.trips.length} late trip{target.trips.length === 1 ? "" : "s"} · {days} day{days === 1 ? "" : "s"} late in total ·
                    orders {[...new Set(target.trips.map((t) => t.orderNo))].slice(0, 6).join(", ")}{new Set(target.trips.map((t) => t.orderNo)).size > 6 ? "…" : ""}</p>
                <label className="vd-field">Basis
                    <select value={basis} onChange={(e) => setBasis(e.target.value)}>
                        <option value="per_day">Per day late</option>
                        <option value="fixed">Fixed amount</option>
                    </select>
                </label>
                {basis === "per_day" && (
                    <label className="vd-field">₹ per day late
                        <input type="number" min="0" value={perDay} onChange={(e) => onRate(e.target.value)} placeholder={rate ? "" : "no rate set for this vendor"} />
                    </label>
                )}
                <label className="vd-field">Amount (₹)
                    <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </label>
                <label className="vd-field">Reason (required)
                    <input type="text" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. 4 embroidery pieces returned 3 days late, order deadline missed" />
                </label>
                {err && <p className="vd-err">{err}</p>}
                <div className="vd-modal-actions">
                    <button type="button" className="vd-mini ghost" onClick={onClose} disabled={busy}>Cancel</button>
                    <button type="button" className="vd-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save penalty"}</button>
                </div>
            </div>
        </div>
    );
}

function PenaltiesLedger({ pen, canPenalise, onChanged, allTrips, onOpenTrips }) {
    const [statusFilter, setStatusFilter] = useState("");
    const [vendor, setVendor] = useState("");
    const [noteFor, setNoteFor] = useState(null); // { penalty, to }
    const tripsByPenalty = useMemo(() => {
        const m = {};
        pen.trips.forEach((t) => { (m[t.penalty_id] = m[t.penalty_id] || []).push(t); });
        return m;
    }, [pen.trips]);
    if (!pen.ready) return <div className="vd-loading">Loading penalties…</div>;
    if (!pen.available) {
        return <div className="vd-panel"><p className="vd-empty">Penalties are not set up yet (the r20_01 SQL has not been run).</p></div>;
    }
    const list = pen.list.filter((p) => (!statusFilter || p.status === statusFilter) && (!vendor || p.vendor_name === vendor));
    const vendors = [...new Set(pen.list.map((p) => p.vendor_name))].sort();
    const total = (s) => pen.list.filter((p) => p.status === s).reduce((a, p) => a + Number(p.amount || 0), 0);
    const exportCsv = () => {
        const headers = ["Date", "Vendor", "Trips", "Orders", "Days late", "Basis", "₹ per day", "Amount", "Reason", "Status", "Status note", "Status by", "Created by"];
        const rows = list.map((p) => {
            const ts = tripsByPenalty[p.id] || [];
            return {
                "Date": fmtDate(Date.parse(p.created_at)), "Vendor": p.vendor_name, "Trips": ts.length,
                "Orders": [...new Set(ts.map((t) => t.order_no))].join(" "), "Days late": p.days_late,
                "Basis": p.basis === "per_day" ? "Per day" : "Fixed", "₹ per day": p.rate_per_day ?? "", "Amount": p.amount,
                "Reason": p.reason, "Status": STATUS_LABEL[p.status], "Status note": p.status_note || "", "Status by": p.status_by || "", "Created by": p.created_by,
            };
        });
        downloadCsv(`vendor_penalties_${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(headers, rows));
    };
    return (
        <div className="vd-panel">
            <div className="vd-ledger-head">
                <h3 className="vd-title">Penalties ledger</h3>
                <div className="vd-ledger-totals">
                    <span>Pending <b>{money(total("pending"))}</b></span>
                    <span>Settled <b>{money(total("settled"))}</b></span>
                    <span>Waived <b>{money(total("waived"))}</b></span>
                </div>
            </div>
            <div className="vd-filters">
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="">All statuses</option>
                    {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select value={vendor} onChange={(e) => setVendor(e.target.value)}>
                    <option value="">All vendors</option>
                    {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                <button type="button" className="vd-mini ghost" onClick={exportCsv}>Export CSV</button>
            </div>
            <div className="vd-table-wrap">
                <table className="vd-table">
                    <thead><tr><th>Date</th><th>Vendor</th><th>Trips</th><th>Days late</th><th>Amount</th><th>Reason</th><th>Status</th>{canPenalise && <th />}</tr></thead>
                    <tbody>
                        {list.map((p) => {
                            const ts = tripsByPenalty[p.id] || [];
                            const ids = new Set(ts.map((t) => t.movement_id));
                            return (
                                <tr key={p.id}>
                                    <td>{fmtDate(Date.parse(p.created_at))}<div className="vd-muted">{p.created_by}</div></td>
                                    <td>{p.vendor_name}</td>
                                    <td className="vd-link" onClick={() => onOpenTrips(`Penalty — ${p.vendor_name}`, allTrips.filter((t) => ids.has(t.id)))}>
                                        {ts.length} <span className="vd-muted">({[...new Set(ts.map((t) => t.order_no))].slice(0, 3).join(", ")}{ts.length > 3 ? "…" : ""})</span>
                                    </td>
                                    <td>{p.days_late}</td>
                                    <td>{money(p.amount)}<div className="vd-muted">{p.basis === "per_day" ? `${money(p.rate_per_day)} / day` : "fixed"}</div></td>
                                    <td>{p.reason}</td>
                                    <td><span className={`vd-status ${p.status}`}>{STATUS_LABEL[p.status]}</span>{p.status_note && <div className="vd-muted">{p.status_note}</div>}</td>
                                    {canPenalise && (
                                        <td className="vd-nowrap">
                                            {p.status !== "settled" && <button type="button" className="vd-mini" onClick={() => setNoteFor({ penalty: p, to: "settled" })}>Settle</button>}
                                            {p.status !== "waived" && <button type="button" className="vd-mini ghost" onClick={() => setNoteFor({ penalty: p, to: "waived" })}>Waive</button>}
                                            {p.status !== "pending" && <button type="button" className="vd-mini ghost" onClick={() => setNoteFor({ penalty: p, to: "pending" })}>Reopen</button>}
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                        {list.length === 0 && <tr><td colSpan={8} className="vd-empty">No penalties yet.</td></tr>}
                    </tbody>
                </table>
            </div>
            {noteFor && <StatusModal {...noteFor} onClose={() => setNoteFor(null)} onSaved={async () => { setNoteFor(null); await onChanged(); }} />}
        </div>
    );
}

function StatusModal({ penalty, to, onClose, onSaved }) {
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const save = async () => {
        if (to === "waived" && !note.trim()) { setErr("A note is required to waive."); return; }
        setBusy(true);
        const { data, error } = await supabase.rpc("set_vendor_penalty_status", { p_id: penalty.id, p_status: to, p_note: note.trim() });
        setBusy(false);
        if (error || !data?.success) { setErr(error?.message || data?.message || "Could not update."); return; }
        onSaved?.();
    };
    return (
        <div className="vd-overlay vd-top" onClick={onClose}>
            <div className="vd-modal" onClick={(e) => e.stopPropagation()}>
                <h3>{STATUS_LABEL[to]} — {penalty.vendor_name} {money(penalty.amount)}</h3>
                <label className="vd-field">Note {to === "waived" ? "(required)" : "(optional)"}
                    <input type="text" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)}
                        placeholder={to === "settled" ? "e.g. deducted from 31 Oct payment" : to === "waived" ? "why it is waived" : ""} />
                </label>
                {err && <p className="vd-err">{err}</p>}
                <div className="vd-modal-actions">
                    <button type="button" className="vd-mini ghost" onClick={onClose} disabled={busy}>Cancel</button>
                    <button type="button" className="vd-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Confirm"}</button>
                </div>
            </div>
        </div>
    );
}
