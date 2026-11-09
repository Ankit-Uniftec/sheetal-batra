import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CHANNEL_KEY_LABELS, getStageLabel } from "../../utils/barcodeService";
import { reJourneyDate } from "../../utils/reJourneys";
import { repeatVendorCounts } from "../../utils/externalMovements";
import { fetchDispatchReport } from "../../utils/dispatchReport";
import { buildCancellationRows, cancelledAtOf, fetchCancellations, isSaleCancellation, summariseCancellations } from "../../utils/cancellationAnalytics";
import { Chips, Columns, DateRange, Empty, FilterGroup, Pager, RankBars, num } from "../CeoDashboard/CeoUi";
import { FilterDrawer, ListTools, Stat } from "../CeoDashboard/dashKit";
import { Card, Loading, Table, csvFromObjects } from "./PmCommon";
import { fmtDate, pct, plural } from "./pmModel";
import "./PmRecords2.css";

// ============================================================
// The full record lists, in the dashboard's own design: one toolbar (search,
// Filters, Export CSV), the filters in a side panel in plain words, a summary
// line, a framed table with one value per column, and pages. They replace the
// older shared panels inside this dashboard only; the older dashboards keep
// theirs. No money and no client phone or address anywhere.
//
//   QcHistoryList      every QC check (Quality page)
//   ReworkList         pieces in re-work right now (Quality page)
//   VendorTripsList    every vendor trip (Vendors page)
//   BoxesList          boxes dispatched in the header's date range (Dispatch page)
//   CancellationList   cancelled orders with their breakdowns (Orders page)
// ============================================================

const PAGE = 15;
const lc = (v) => String(v || "").toLowerCase();
const has = (q, ...vals) => !q || vals.some((v) => lc(v).includes(q));
const countBy = (list, keyOf) => {
  const m = {};
  list.forEach((x) => { const k = keyOf(x); if (k) m[k] = (m[k] || 0) + 1; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k]) => ({ value: k, label: k }));
};
const pick = (vals, v) => !vals.length || vals.includes(v);
/** The same as countBy, with the count in each label, e.g. "Stitching (12)". Busiest first. */
const countByN = (list, keyOf) => {
  const m = {};
  list.forEach((x) => { const k = keyOf(x); if (k) m[k] = (m[k] || 0) + 1; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ value: k, label: `${k} (${num(n)})`, count: n }));
};
/** Turn one value on or off in a list filter. */
const toggle = (vals, v) => (vals.includes(v) ? vals.filter((x) => x !== v) : [...vals, v]);
/** A small pressed-or-not chip under the figures: "Most sent back: Stitching (12)". Click to filter by it. */
const Hint = ({ label, value, n, on, onClick, title }) => (
  <button type="button" className="pm-hint" aria-pressed={on} title={title} onClick={onClick}>{label}: <b>{value}</b> ({num(n)})</button>
);
const clock = (ts) => new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const capital = (s) => String(s || "").replace(/^\w/, (x) => x.toUpperCase());
const pieceKind = (t) => ({ top: "Top", bottom: "Bottom", dupatta: "Dupatta", extra: "Extra" }[t] || capital(t) || "Piece");
const channelName = (k) => CHANNEL_KEY_LABELS[k] || k || "Not known";

/** A date with the time (or a note) under it. */
const DateCell = ({ ts, note, late }) => (ts
  ? <span className="pm-cell"><b>{fmtDate(ts)}</b><small className={late ? "pm-late" : undefined}>{note ?? clock(ts)}</small></span>
  : <span className="pm-muted">–</span>);
const Code = ({ children }) => <span className="pm-code">{children || "–"}</span>;
const Tag = ({ tone, children }) => <i className={`pm-tag${tone ? ` is-${tone}` : ""}`}>{children}</i>;

/** The page of rows and the pager under it; back to page 1 whenever the list changes. */
function Paged({ list, render }) {
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [list]);
  return (
    <>
      {render(list.slice((page - 1) * PAGE, page * PAGE))}
      <Pager page={page} pages={Math.ceil(list.length / PAGE)} onChange={setPage} />
    </>
  );
}

const DATES = (period) => [{ value: "all", label: "All dates" }, { value: "range", label: `Only ${period.label.toLowerCase()} (header)` }];
const sortChips = (opts, value, set, fallback) => <Chips options={opts} value={value} onChange={(v) => set(v || fallback)} />;

// ------------------------------------------------------------ QC history
const QC_SORTS = [{ value: "new", label: "Newest first" }, { value: "old", label: "Oldest first" }];
const RESULTS = [{ value: "pass", label: "Passed" }, { value: "fail", label: "Failed" }, { value: "override", label: "Overridden" }];
// qc_records.outcome in words. "rejourney" is the older word for a re-work and
// "scrap" is no longer used, but older records still carry both.
const OUTCOMES = { rework: "Sent back to fix", rejourney: "Sent back to fix", dispose: "Disposed", scrap: "Scrapped" };
const OUTCOME_CHOICES = [...new Set(Object.values(OUTCOMES))].map((v) => ({ value: v, label: v }));
const resultOf = (r) => (r.is_override === true ? "override" : r.result === "fail" ? "fail" : "pass");

export function QcHistoryList({ ctx, rows, loading }) {
  const { period, ordersById, openOrder } = ctx;
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [dates, setDates] = useState("all");
  const [sort, setSort] = useState("new");
  const [results, setResults] = useState([]);
  const [points, setPoints] = useState([]);
  const [channels, setChannels] = useState([]);
  const [who, setWho] = useState([]);
  const [outcomes, setOutcomes] = useState([]);
  const all = useMemo(() => rows || [], [rows]);
  const choices = useMemo(() => ({
    channels: countBy(all, (r) => channelName(r.channel_key)),
    who: countBy(all, (r) => r.inspected_by || "Not recorded"),
  }), [all]);
  const list = useMemo(() => {
    const q = lc(search).trim();
    const out = all.filter((r) => (dates === "all" || period.inP(r.created_at))
      && pick(results, resultOf(r)) && pick(points, r.which_qc === "final" ? "final" : "qc1")
      && pick(channels, channelName(r.channel_key)) && pick(who, r.inspected_by || "Not recorded")
      && pick(outcomes, OUTCOMES[r.outcome] || "") && has(q, r.order_no, r.barcode, r.fail_reason));
    out.sort((a, b) => (sort === "old" ? 1 : -1) * (new Date(a.created_at) - new Date(b.created_at)));
    return out;
  }, [all, search, dates, period, results, points, channels, who, outcomes, sort]);
  const passed = list.filter((r) => resultOf(r) === "pass").length;
  const failed = list.filter((r) => resultOf(r) === "fail").length;
  const overridden = list.length - passed - failed;
  const active = [dates !== "all", sort !== "new", results.length, points.length, channels.length, who.length, outcomes.length].filter(Boolean).length;
  const clear = () => { setDates("all"); setSort("new"); setResults([]); setPoints([]); setChannels([]); setWho([]); setOutcomes([]); };
  const exportCsv = () => csvFromObjects("qc history", list.map((r) => ({
    "Order No": r.order_no || "", Barcode: r.barcode || "", Channel: channelName(r.channel_key),
    Check: r.which_qc === "final" ? "Final QC" : "QC 1", Result: RESULTS.find((x) => x.value === resultOf(r)).label,
    "Fail Reason": r.fail_reason || "", "What Happened": OUTCOMES[r.outcome] || "", "Re-work No": r.rejourney_number ?? "", "Scrap Location": r.scrap_location || "",
    "Checked By": r.is_override ? (r.overridden_by || r.inspected_by || "") : (r.inspected_by || ""),
    "Checked On": r.created_at ? `${fmtDate(r.created_at)} ${clock(r.created_at)}` : "",
  })));

  return (
    <>
      <ListTools search={search} onSearch={setSearch} placeholder="Search order, barcode or reason" filters={active} onFilters={() => setOpen(true)} onExport={exportCsv} exportDisabled={!list.length} />
      <div className="ceo-dstats">
        <Stat label="QC Records" info="QC checks matching the filters, overrides included."><b>{num(list.length)}</b></Stat>
        <Stat label="Passed" info="Checks that passed. Overrides are not counted here."><b>{num(passed)}</b></Stat>
        <Stat label="Failed" info="Checks that failed."><b className={failed ? "is-warn" : undefined}>{num(failed)}</b></Stat>
        <Stat label="Overridden" info="Pieces marked complete without a Final QC check. Nobody inspected these."><b>{num(overridden)}</b></Stat>
        <Stat label="Fail Rate" info="Failed checks out of passed and failed checks. Overrides are left out."><b>{passed + failed ? `${pct(failed, passed + failed)}%` : "–"}</b></Stat>
      </div>
      {loading && !all.length ? <Loading text="Loading QC records" /> : (
        <Paged list={list} render={(page) => (
          <Table rowKey={(r) => r.id} rows={page} empty={all.length ? "No QC records match these filters." : "No QC records yet."}
            onRow={(r) => ordersById[r.order_id] && openOrder(ordersById[r.order_id])}
            columns={[
              { key: "bc", label: "Barcode", render: (r) => <Code>{r.barcode}</Code> },
              { key: "order", label: "Order", render: (r) => <span className="pm-nowrap">{r.order_no || "–"}</span> },
              { key: "qc", label: "Check", render: (r) => (r.which_qc === "final" ? "Final QC" : "QC 1") },
              { key: "res", label: "Result", render: (r) => { const k = resultOf(r); return <Tag tone={k === "fail" ? "urgent" : k === "override" ? "soft" : undefined}>{RESULTS.find((x) => x.value === k).label}</Tag>; } },
              { key: "why", label: "Fail Reason", render: (r) => <span className="pm-wrap">{r.fail_reason || <span className="pm-muted">–</span>}</span> },
              { key: "then", label: "What Happened", hide: true, render: (r) => OUTCOMES[r.outcome] || <span className="pm-muted">–</span> },
              { key: "rwn", label: "Re-work No", right: true, hide: true, render: (r) => (r.rejourney_number != null ? num(r.rejourney_number) : <span className="pm-muted">–</span>) },
              { key: "scrap", label: "Scrap Location", hide: true, render: (r) => r.scrap_location || <span className="pm-muted">–</span> },
              { key: "chan", label: "Channel", hide: true, render: (r) => channelName(r.channel_key) },
              { key: "by", label: "Checked By", hide: true, render: (r) => (r.is_override ? (r.overridden_by || r.inspected_by) : r.inspected_by) || <span className="pm-muted">–</span> },
              { key: "at", label: "Checked On", right: true, render: (r) => <DateCell ts={r.created_at} /> },
            ]} />
        )} />
      )}
      <FilterDrawer open={open} onClose={() => setOpen(false)} onClear={clear} count={list.length} noun="QC records" sub="Narrow the QC records">
        <FilterGroup label="Sort By">{sortChips(QC_SORTS, sort, setSort, "new")}</FilterGroup>
        <FilterGroup label="Dates">{sortChips(DATES(period), dates, setDates, "all")}</FilterGroup>
        <FilterGroup label="Result"><Chips options={RESULTS} value={results} onChange={setResults} /></FilterGroup>
        <FilterGroup label="Check Point"><Chips options={[{ value: "qc1", label: "QC 1" }, { value: "final", label: "Final QC" }]} value={points} onChange={setPoints} /></FilterGroup>
        <FilterGroup label="What Happened"><Chips options={OUTCOME_CHOICES} value={outcomes} onChange={setOutcomes} /></FilterGroup>
        <FilterGroup label="Channel"><Chips options={choices.channels} value={channels} onChange={setChannels} /></FilterGroup>
        <FilterGroup label="Checked By"><Chips options={choices.who} value={who} onChange={setWho} /></FilterGroup>
      </FilterDrawer>
    </>
  );
}

// ------------------------------------------------------------ re-work
const RW_SORTS = [{ value: "", label: "Overdue first" }, { value: "times", label: "Most times sent back" }, { value: "new", label: "Sent back most recently" }];
const RW_SHOW = [{ value: "overdue", label: "Overdue only" }, { value: "limit", label: "Sent back 2+ times" }, { value: "over", label: "Sent back 3+ times" }];
const qcName = (w) => (w === "final" ? "Final QC" : w === "qc1" ? "QC 1" : w || "");
const limitWord = (r) => (r.overLimit ? "3+ times" : r.atLimit ? "2+ times" : "");

export function ReworkList({ ctx, rows, loading }) {
  const { period, ordersById, openOrder } = ctx;
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [dates, setDates] = useState("all");
  const [sort, setSort] = useState("");
  const [stages, setStages] = useState([]);
  const [channels, setChannels] = useState([]);
  const [show, setShow] = useState([]);
  const all = useMemo(() => rows || [], [rows]);
  const stageOf = (r) => getStageLabel(r.current_stage) || r.current_stage || "Not known";
  const choices = useMemo(() => ({ stages: countByN(all, stageOf), channels: countBy(all, (r) => channelName(r.channel_key)) }), [all]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = choices.stages[0];
  const list = useMemo(() => {
    const q = lc(search).trim();
    const out = all.filter((r) => (dates === "all" || period.inP(reJourneyDate(r)))
      && pick(stages, stageOf(r)) && pick(channels, channelName(r.channel_key))
      && (!show.includes("overdue") || r.overdue) && (!show.includes("limit") || r.atLimit) && (!show.includes("over") || r.overLimit)
      && has(q, r.order_no, r.barcode, r.lastFail?.fail_reason));
    if (sort === "times") out.sort((a, b) => (b.re_journey_count || 0) - (a.re_journey_count || 0));
    else if (sort === "new") out.sort((a, b) => new Date(reJourneyDate(b) || 0) - new Date(reJourneyDate(a) || 0));
    return out;
  }, [all, search, dates, period, stages, channels, show, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = [dates !== "all", sort, stages.length, channels.length, show.length].filter(Boolean).length;
  const exportCsv = () => csvFromObjects("pieces in re-work", list.map((r) => ({
    "Order No": r.order_no || "", Barcode: r.barcode || "", Piece: r.component_label || pieceKind(r.component_type), Channel: channelName(r.channel_key),
    "Now At": stageOf(r), "Sent Back From": getStageLabel(r.previous_stage) || "", "Restarted From": getStageLabel(r.lastFail?.rejourney_to_stage) || "",
    "Times Sent Back": r.re_journey_count ?? 0, "At Limit": limitWord(r),
    "Stage Due": r.stage_deadline ? fmtDate(r.stage_deadline) : "", "Days Overdue": r.overdue ? r.daysOverdue : "",
    "Fail Reason": r.lastFail?.fail_reason || "", "QC Check": qcName(r.lastFail?.which_qc), "Inspected By": r.lastFail?.inspected_by || "",
    "Sent Back On": reJourneyDate(r) ? `${fmtDate(reJourneyDate(r))} ${clock(reJourneyDate(r))}` : "",
  })));

  return (
    <>
      <ListTools search={search} onSearch={setSearch} placeholder="Search order, barcode or reason" filters={active} onFilters={() => setOpen(true)} onExport={exportCsv} exportDisabled={!list.length} />
      <div className="ceo-dstats">
        <Stat label="In Re-work" info="Pieces sent back by QC that are being fixed right now."><b>{num(list.length)}</b></Stat>
        <Stat label="Overdue" info="Past the time limit of the stage they are at now."><b className={list.some((r) => r.overdue) ? "is-warn" : undefined}>{num(list.filter((r) => r.overdue).length)}</b></Stat>
        <Stat label="Sent Back 2+ Times" info="Pieces that have failed QC and been sent back two or more times."><b>{num(list.filter((r) => r.atLimit).length)}</b></Stat>
        <Stat label="Sent Back 3+ Times" info="Pieces that have failed QC and been sent back three or more times: past the limit."><b className={list.some((r) => r.overLimit) ? "is-warn" : undefined}>{num(list.filter((r) => r.overLimit).length)}</b></Stat>
      </div>
      {top && (
        <div className="pm-hints">
          <Hint label="Most sent back" value={top.value} n={top.count} on={stages.includes(top.value)} title="The stage most pieces in re-work are at now. Click to show only those."
            onClick={() => setStages(toggle(stages, top.value))} />
        </div>
      )}
      {loading && !all.length ? <Loading text="Loading pieces in re-work" /> : (
        <Paged list={list} render={(page) => (
          <Table rowKey={(r) => r.id} rows={page} empty={all.length ? "No pieces match these filters." : "No pieces are in re-work right now."}
            onRow={(r) => ordersById[r.order_id] && openOrder(ordersById[r.order_id])}
            columns={[
              { key: "bc", label: "Barcode", render: (r) => <Code>{r.barcode}</Code> },
              { key: "piece", label: "Piece", render: (r) => r.component_label || pieceKind(r.component_type) },
              { key: "order", label: "Order", hide: true, render: (r) => <span className="pm-nowrap">{r.order_no || "–"}</span> },
              { key: "now", label: "Now At", render: (r) => stageOf(r) },
              { key: "from", label: "Sent Back From", hide: true, render: (r) => getStageLabel(r.previous_stage) || <span className="pm-muted">–</span> },
              { key: "restart", label: "Restarted From", hide: true, render: (r) => getStageLabel(r.lastFail?.rejourney_to_stage) || <span className="pm-muted">–</span> },
              { key: "n", label: "Times Sent Back", right: true, render: (r) => <span className="pm-cell is-right"><b className={r.atLimit ? "pm-late" : undefined}>{num(r.re_journey_count || 0)}</b>{limitWord(r) && <small><Tag tone={r.overLimit ? "urgent" : undefined}>{limitWord(r)}</Tag></small>}</span> },
              { key: "due", label: "Stage Due", right: true, render: (r) => <DateCell ts={r.stage_deadline} late={r.overdue} note={r.overdue ? `${plural(r.daysOverdue, "day")} overdue` : "On time"} /> },
              { key: "why", label: "Fail Reason", hide: true, render: (r) => <span className="pm-wrap">{r.lastFail?.fail_reason || <span className="pm-muted">–</span>}</span> },
              { key: "last", label: "Last Failed Check", hide: true, render: (r) => (r.lastFail
                ? <span className="pm-cell"><b>{qcName(r.lastFail.which_qc) || "QC"}</b><small>{[r.lastFail.inspected_by, r.lastFail.created_at && `${fmtDate(r.lastFail.created_at)} ${clock(r.lastFail.created_at)}`].filter(Boolean).join(" · ") || "–"}</small></span>
                : <span className="pm-muted">–</span>) },
              { key: "on", label: "Sent Back On", right: true, hide: true, render: (r) => <DateCell ts={reJourneyDate(r)} /> },
            ]} />
        )} />
      )}
      <FilterDrawer open={open} onClose={() => setOpen(false)} onClear={() => { setDates("all"); setSort(""); setStages([]); setChannels([]); setShow([]); }} count={list.length} noun="pieces" sub="Narrow the pieces in re-work">
        <FilterGroup label="Sort By">{sortChips(RW_SORTS, sort, setSort, "")}</FilterGroup>
        <FilterGroup label="Sent Back On">{sortChips(DATES(period), dates, setDates, "all")}</FilterGroup>
        <FilterGroup label="Show"><Chips options={RW_SHOW} value={show} onChange={setShow} /></FilterGroup>
        <FilterGroup label="Now At"><Chips options={choices.stages} value={stages} onChange={setStages} /></FilterGroup>
        <FilterGroup label="Channel"><Chips options={choices.channels} value={channels} onChange={setChannels} /></FilterGroup>
      </FilterDrawer>
    </>
  );
}

// ------------------------------------------------------------ vendor trips
const TRIP_STATUS = { exited: "Out now", returned: "Back", configured: "Not sent yet" };
const TRIP_SORTS = [{ value: "new", label: "Sent most recently" }, { value: "overdue", label: "Most overdue" }, { value: "due", label: "Return date, soonest" }];
const WH2 = "SB WH Delhi (2)";

export function VendorTripsList({ ctx, rows, loading }) {
  const { period, ordersById, openOrder } = ctx;
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [dates, setDates] = useState("all");
  const [sort, setSort] = useState("new");
  const [status, setStatus] = useState([]);
  const [show, setShow] = useState([]);
  // Outside vendors by default, the same as the figures above; our Delhi (2) is a filter away.
  const [where, setWhere] = useState("out");
  const [vendors, setVendors] = useState([]);
  const [stages, setStages] = useState([]);
  const [kinds, setKinds] = useState([]);
  const all = useMemo(() => rows || [], [rows]);
  const own = (m) => String(m.vendor_name || "").trim() === WH2;
  const choices = useMemo(() => ({
    vendors: countBy(all, (m) => String(m.vendor_name || "").trim() || "Not recorded").slice(0, 30),
    stages: countBy(all, (m) => m.stageLabel || "Not recorded"),
    kinds: countBy(all, (m) => pieceKind(m.component_type)),
  }), [all]);
  // The stage most trips went out for and the vendor most pieces went back to,
  // over the trips the Where filter keeps (outside vendors by default).
  const tops = useMemo(() => {
    const here = all.filter((m) => !where || (where === "own") === own(m));
    const stage = countByN(here, (m) => m.stageLabel || "Not recorded")[0] || null;
    const rv = repeatVendorCounts(here)[0] || null;
    return { stage, vendor: rv ? { value: String(rv.vendor).trim(), count: rv.count } : null };
  }, [all, where]); // eslint-disable-line react-hooks/exhaustive-deps
  const vendorChoices = tops.vendor && !choices.vendors.some((v) => v.value === tops.vendor.value)
    ? [...choices.vendors, { value: tops.vendor.value, label: tops.vendor.value }] : choices.vendors;
  const list = useMemo(() => {
    const q = lc(search).trim();
    const out = all.filter((m) => (dates === "all" || period.inP(m.exit_scan_at))
      && pick(status, TRIP_STATUS[m.status] || m.status) && (!show.includes("overdue") || m.overdue) && (!show.includes("repeat") || m.isRepeat)
      && (!where || (where === "own") === own(m)) && pick(vendors, String(m.vendor_name || "").trim() || "Not recorded")
      && pick(stages, m.stageLabel || "Not recorded") && pick(kinds, pieceKind(m.component_type))
      && has(q, m.order_no, m.barcode, m.vendor_name));
    const t = (v) => (v ? new Date(v).getTime() : 0);
    if (sort === "overdue") out.sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0));
    else if (sort === "due") out.sort((a, b) => (t(a.return_date) || 9e15) - (t(b.return_date) || 9e15));
    else out.sort((a, b) => t(b.exit_scan_at) - t(a.exit_scan_at));
    return out;
  }, [all, search, dates, period, status, show, where, vendors, stages, kinds, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = [dates !== "all", sort !== "new", status.length, show.length, where !== "out", vendors.length, stages.length, kinds.length].filter(Boolean).length;
  const clear = () => { setDates("all"); setSort("new"); setStatus([]); setShow([]); setWhere("out"); setVendors([]); setStages([]); setKinds([]); };
  const exportCsv = () => csvFromObjects("vendor trips", list.map((m) => ({
    "Order No": m.order_no || "", Barcode: m.barcode || "", Piece: pieceKind(m.component_type), Ordered: m.order_created_at ? fmtDate(m.order_created_at) : "",
    Vendor: m.vendor_name || "", Location: m.vendor_location || "",
    "Sent For": m.stageLabel || "", Status: TRIP_STATUS[m.status] || m.status, "Days Overdue": m.overdue ? m.daysOverdue : "",
    "Sent Out": m.exit_scan_at ? fmtDate(m.exit_scan_at) : "", "Return By": m.return_date ? fmtDate(m.return_date) : "", "Came Back": m.entry_scan_at ? fmtDate(m.entry_scan_at) : "",
    "Repeat Visit": m.isRepeat ? "Yes" : "", "Repeat Reason": m.repeat_reason || "",
  })));

  return (
    <>
      <ListTools search={search} onSearch={setSearch} placeholder="Search order, barcode or vendor" filters={active} onFilters={() => setOpen(true)} onExport={exportCsv} exportDisabled={!list.length} />
      <div className="ceo-dstats">
        <Stat label="Trips" info="Vendor trips matching the filters, one per piece sent out."><b>{num(list.length)}</b></Stat>
        <Stat label="Out Now" info="Sent out and not back yet."><b>{num(list.filter((m) => m.status === "exited").length)}</b></Stat>
        <Stat label="Overdue" info="Out past the return date."><b className={list.some((m) => m.overdue) ? "is-warn" : undefined}>{num(list.filter((m) => m.overdue).length)}</b></Stat>
        <Stat label="Back" info="Came back through the gate."><b>{num(list.filter((m) => m.status === "returned").length)}</b></Stat>
        <Stat label="Repeat Visits" info="Sent back to a vendor the piece had already been to, usually to fix something."><b>{num(list.filter((m) => m.isRepeat).length)}</b></Stat>
      </div>
      {(tops.stage || tops.vendor) && (
        <div className="pm-hints">
          {tops.stage && <Hint label="Most out for" value={tops.stage.value} n={tops.stage.count} on={stages.includes(tops.stage.value)}
            title="The stage most pieces went out for. Click to show only those trips." onClick={() => setStages(toggle(stages, tops.stage.value))} />}
          {tops.vendor && <Hint label="Most rework" value={tops.vendor.value} n={tops.vendor.count} on={vendors.includes(tops.vendor.value)}
            title="The vendor pieces were sent back to most often. Click to show only that vendor." onClick={() => setVendors(toggle(vendors, tops.vendor.value))} />}
        </div>
      )}
      {loading && !all.length ? <Loading text="Loading vendor trips" /> : (
        <Paged list={list} render={(page) => (
          <Table rowKey={(m) => m.id} rows={page} empty={all.length ? "No trips match these filters." : "No vendor trips yet."}
            onRow={(m) => ordersById[m.order_id] && openOrder(ordersById[m.order_id])}
            columns={[
              { key: "bc", label: "Barcode", render: (m) => <Code>{m.barcode}</Code> },
              { key: "order", label: "Order", hide: true, render: (m) => <span className="pm-nowrap">{m.order_no || "–"}</span> },
              { key: "piece", label: "Piece", hide: true, render: (m) => pieceKind(m.component_type) },
              { key: "ord", label: "Ordered", right: true, hide: true, render: (m) => <DateCell ts={m.order_created_at} note="" /> },
              { key: "vendor", label: "Vendor", render: (m) => <span className="pm-cell"><b>{m.vendor_name || "–"}</b>{m.vendor_location && <small>{m.vendor_location}</small>}</span> },
              { key: "for", label: "Sent For", hide: true, render: (m) => m.stageLabel || "–" },
              { key: "st", label: "Status", render: (m) => <span className="pm-cell"><b><Tag tone={m.overdue ? "urgent" : m.status === "returned" ? "soft" : undefined}>{TRIP_STATUS[m.status] || m.status}</Tag></b>{m.overdue && <small className="pm-late">{plural(m.daysOverdue, "day")} overdue</small>}{m.isRepeat && <small>Repeat visit</small>}</span> },
              { key: "out", label: "Sent Out", right: true, render: (m) => <DateCell ts={m.exit_scan_at} /> },
              { key: "by", label: "Return By", right: true, render: (m) => <DateCell ts={m.return_date} late={m.overdue} note={m.overdue ? "Late" : ""} /> },
              { key: "back", label: "Came Back", right: true, hide: true, render: (m) => <DateCell ts={m.entry_scan_at} /> },
            ]} />
        )} />
      )}
      <FilterDrawer open={open} onClose={() => setOpen(false)} onClear={clear} count={list.length} noun="trips" sub="Narrow the vendor trips">
        <FilterGroup label="Sort By">{sortChips(TRIP_SORTS, sort, setSort, "new")}</FilterGroup>
        <FilterGroup label="Sent Out">{sortChips(DATES(period), dates, setDates, "all")}</FilterGroup>
        <FilterGroup label="Status"><Chips options={Object.values(TRIP_STATUS).map((v) => ({ value: v, label: v }))} value={status} onChange={setStatus} /></FilterGroup>
        <FilterGroup label="Show"><Chips options={[{ value: "overdue", label: "Overdue only" }, { value: "repeat", label: "Repeat visits only" }]} value={show} onChange={setShow} /></FilterGroup>
        <FilterGroup label="Where"><Chips options={[{ value: "out", label: "Outside vendors" }, { value: "own", label: "Our Delhi (2)" }, { value: "", label: "Both" }]} value={where} onChange={(v) => setWhere(v ?? "")} /></FilterGroup>
        <FilterGroup label="Sent For"><Chips options={choices.stages} value={stages} onChange={setStages} /></FilterGroup>
        <FilterGroup label="Piece"><Chips options={choices.kinds} value={kinds} onChange={setKinds} /></FilterGroup>
        <FilterGroup label="Vendor"><Chips options={vendorChoices} value={vendors} onChange={setVendors} /></FilterGroup>
      </FilterDrawer>
    </>
  );
}

// ------------------------------------------------------------ boxes dispatched
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function BoxesList({ ctx }) {
  const { period, ordersById, openOrder, showPopup } = ctx;
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [channels, setChannels] = useState([]);
  const [couriers, setCouriers] = useState([]);
  const [modes, setModes] = useState([]);
  const load = useCallback(async () => {
    try { setRows(await fetchDispatchReport(period.start.toISOString(), period.end.toISOString())); setError(""); } catch (e) { setError(e.message || String(e)); }
  }, [period]);
  // Loads for the header's date range and refreshes every minute.
  useEffect(() => { setRows(null); load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  const all = useMemo(() => rows || [], [rows]);
  const choices = useMemo(() => ({
    channels: countBy(all, (r) => r.channel || "Not known"), couriers: countBy(all, (r) => r.courier || "Not given"), modes: countBy(all, (r) => r.modeOfDelivery || "Not given"),
  }), [all]);
  const list = useMemo(() => {
    const q = lc(search).trim();
    return all.filter((r) => pick(channels, r.channel || "Not known") && pick(couriers, r.courier || "Not given") && pick(modes, r.modeOfDelivery || "Not given")
      && has(q, r.orderNo, r.box, r.awb, r.name, ...(r.products || [])));
  }, [all, search, channels, couriers, modes]);
  const active = [channels.length, couriers.length, modes.length].filter(Boolean).length;
  const line = (r) => ({
    Box: `${r.box || ""}${r.part ? ` (${r.part})` : ""}`, "Order No": r.orderNo || "", Products: (r.products || []).join("; "), Pieces: (r.pieces || []).join(", "),
    Client: r.name || "", Channel: r.channel || "", "Order Date": r.orderDate ? fmtDate(r.orderDate) : "", "Delivery Date": r.deliveryDate ? fmtDate(r.deliveryDate) : "",
    Dispatched: r.dispatchedAt ? `${fmtDate(r.dispatchedAt)} ${clock(r.dispatchedAt)}` : "", "Delivery Mode": r.modeOfDelivery || "", Courier: r.courier || "", AWB: r.awb || "",
  });
  const print = () => {
    const w = window.open("", "_blank");
    if (!w) { showPopup({ type: "error", title: "Not Printed", message: "Allow pop-ups for this site to print the list.", confirmText: "Ok" }); return; }
    const heads = Object.keys(line({ products: [], pieces: [] }));
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Boxes dispatched, ${esc(period.dates)}</title>
<style>@page{size:A4 landscape;margin:10mm}body{font-family:Arial,sans-serif;font-size:10px;color:#222}h1{font-size:16px;margin:0 0 4px}.meta{margin-bottom:8px;color:#555}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px;text-align:left;vertical-align:top}th{background:#f3eedf}</style></head><body>
<h1>Sheetal Batra · Boxes dispatched</h1><div class="meta">${esc(period.dates)} · ${list.length} boxes · ${new Set(list.map((r) => r.orderId)).size} orders · printed ${esc(new Date().toLocaleString("en-IN"))}</div>
<table><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${list.map((r) => `<tr>${Object.values(line(r)).map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>
<script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  };

  return (
    <>
      <ListTools search={search} onSearch={setSearch} placeholder="Search order, box, AWB, client or product" filters={active} onFilters={() => setOpen(true)}
        onExport={() => csvFromObjects(`boxes dispatched ${period.label}`, list.map(line))} exportDisabled={!list.length}>
        <button type="button" className="ceo-btn" onClick={print} disabled={!list.length}>Print</button>
      </ListTools>
      <div className="ceo-dstats">
        <Stat label="Boxes" info="Boxes scanned out at Packaging in the header's date range."><b>{num(list.length)}</b></Stat>
        <Stat label="Orders" info="The orders these boxes belong to."><b>{num(new Set(list.map((r) => r.orderId)).size)}</b></Stat>
        <Stat label="Pieces" info="Garment pieces packed in these boxes."><b>{num(list.reduce((a, r) => a + (r.pieces || []).length, 0))}</b></Stat>
      </div>
      {error ? <Empty text={`The boxes could not be loaded: ${error}`} /> : rows == null ? <Loading text="Loading boxes dispatched" /> : (
        <Paged list={list} render={(page) => (
          <Table rowKey={(r) => r.shipmentId} rows={page} empty={all.length ? "No boxes match these filters." : `No boxes were dispatched (${period.label.toLowerCase()}).`}
            onRow={(r) => ordersById[r.orderId] && openOrder(ordersById[r.orderId])}
            columns={[
              { key: "box", label: "Box", render: (r) => <span className="pm-cell"><b><Code>{r.box}</Code></b>{r.part && <small>Part {r.part}</small>}</span> },
              { key: "order", label: "Order", render: (r) => <span className="pm-nowrap">{r.orderNo}</span> },
              { key: "prod", label: "Products", render: (r) => <span className="pm-wrap">{(r.products || []).join("; ") || "–"}</span> },
              { key: "pcs", label: "Pieces", right: true, hide: true, render: (r) => num((r.pieces || []).length) },
              { key: "client", label: "Client", hide: true, render: (r) => r.name || "–" },
              { key: "chan", label: "Channel", hide: true, render: (r) => r.channel || "–" },
              { key: "od", label: "Order Date", right: true, hide: true, render: (r) => <DateCell ts={r.orderDate} note="" /> },
              { key: "dd", label: "Delivery Date", right: true, hide: true, render: (r) => <DateCell ts={r.deliveryDate} note="" /> },
              { key: "out", label: "Dispatched", right: true, render: (r) => <DateCell ts={r.dispatchedAt} /> },
              { key: "mode", label: "Delivery Mode", hide: true, render: (r) => r.modeOfDelivery || "–" },
              { key: "cour", label: "Courier", render: (r) => <span className="pm-cell"><b>{r.courier || "–"}</b>{r.awb && <small className="pm-code">{r.awb}</small>}</span> },
            ]} />
        )} />
      )}
      <FilterDrawer open={open} onClose={() => setOpen(false)} onClear={() => { setChannels([]); setCouriers([]); setModes([]); }} count={list.length} noun="boxes" sub={`Boxes dispatched, ${period.label.toLowerCase()}`}>
        <FilterGroup label="Channel"><Chips options={choices.channels} value={channels} onChange={setChannels} /></FilterGroup>
        <FilterGroup label="Courier"><Chips options={choices.couriers} value={couriers} onChange={setCouriers} /></FilterGroup>
        <FilterGroup label="Delivery Mode"><Chips options={choices.modes} value={modes} onChange={setModes} /></FilterGroup>
      </FilterDrawer>
    </>
  );
}

// ------------------------------------------------------------ cancellations
const CX_PERIODS = [{ value: "month", label: "This Month" }, { value: "last", label: "Last Month" }, { value: "3m", label: "Last 3 Months" }, { value: "year", label: "This Year" }, { value: "custom", label: "Choose Dates" }];
const dayStart = (key) => new Date(`${key}T00:00:00`);
const dayWord = (key) => key.split("-").reverse().join("-");
// Chosen dates run from the start of the first day to the end of the last; one
// day only until the end date is picked. This month until a start is picked.
const cxRange = (k, from, to) => {
  const n = new Date();
  if (k === "custom" && from) { const e = dayStart(to || from); e.setDate(e.getDate() + 1); return [dayStart(from), e]; }
  if (k === "last") return [new Date(n.getFullYear(), n.getMonth() - 1, 1), new Date(n.getFullYear(), n.getMonth(), 1)];
  if (k === "3m") return [new Date(n.getFullYear(), n.getMonth() - 2, 1), new Date(n.getFullYear(), n.getMonth() + 1, 1)];
  if (k === "year") return [new Date(n.getFullYear(), 0, 1), new Date(n.getFullYear() + 1, 0, 1)];
  return [new Date(n.getFullYear(), n.getMonth(), 1), new Date(n.getFullYear(), n.getMonth() + 1, 1)];
};

export function CancellationList({ ctx }) {
  const { ordersById, openOrder } = ctx;
  const [when, setWhen] = useState("month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [channels, setChannels] = useState([]);
  const [reasons, setReasons] = useState([]);
  const [stages, setStages] = useState([]);
  const [who, setWho] = useState([]);
  const [start, end] = useMemo(() => cxRange(when, from, to), [when, from, to]);
  useEffect(() => {
    let off = false;
    setData(null);
    fetchCancellations(start.toISOString(), end.toISOString()).then((d) => { if (!off) { setData(d); setError(""); } }).catch((e) => { if (!off) setError(e.message || String(e)); });
    return () => { off = true; };
  }, [start, end]);
  const rows = useMemo(() => (data ? buildCancellationRows(data.orders, data.components, data.whoByOrder, data.vendorNames) : []), [data]);
  const choices = useMemo(() => ({
    channels: countBy(rows, (r) => r.channel), reasons: countBy(rows, (r) => r.reasonKey || "Not given"), stages: countBy(rows, (r) => r.stage), who: countBy(rows, (r) => r.cancelledBy || "Not recorded"),
  }), [rows]);
  const list = useMemo(() => {
    const q = lc(search).trim();
    return rows.filter((r) => pick(channels, r.channel) && pick(reasons, r.reasonKey || "Not given") && pick(stages, r.stage) && pick(who, r.cancelledBy || "Not recorded")
      && has(q, r.orderNo, r.customer, r.reason, ...(r.products || [])));
  }, [rows, search, channels, reasons, stages, who]);
  const prev = useMemo(() => {
    if (!data?.allCancelled) return [];
    const ps = new Date(start.getTime() - (end - start)).toISOString();
    const pe = start.toISOString();
    return buildCancellationRows(data.allCancelled.filter((o) => isSaleCancellation(o) && cancelledAtOf(o) >= ps && cancelledAtOf(o) < pe), [], {}, {})
      .filter((r) => pick(channels, r.channel));
  }, [data, start, end, channels]);
  const grain = (end - start) / 864e5 > 92 ? "month" : "week";
  const s = useMemo(() => summariseCancellations(list, prev, grain), [list, prev, grain]);
  const after = s.byStage.filter((x) => x.key !== "Before production" && x.key !== "No pieces").reduce((a, x) => a + x.count, 0);
  const active = [channels.length, reasons.length, stages.length, who.length].filter(Boolean).length;
  const rank = (items) => items.map((x) => ({ name: x.key, value: x.count }));
  const label = when === "custom" && from ? (to && to !== from ? `${dayWord(from)} to ${dayWord(to)}` : dayWord(from)) : CX_PERIODS.find((p) => p.value === (when === "custom" ? "month" : when)).label;
  // Change against the period of the same length just before; none when nothing was cancelled then.
  const change = s.prevCount ? Math.round(((s.count - s.prevCount) / s.prevCount) * 100) : null;
  const share = (x) => `${pct(x.value, s.count)}% of cancellations`;

  return (
    <>
      <div className="pm-cx-period">
        <Chips options={CX_PERIODS} value={when} onChange={(v) => setWhen(v || "month")} />
        {when === "custom" && <div className="pm-cx-dates"><DateRange from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} /></div>}
      </div>
      <ListTools search={search} onSearch={setSearch} placeholder="Search order, client, product or reason" filters={active} onFilters={() => setOpen(true)} exportDisabled={!list.length}
        onExport={() => csvFromObjects(`cancellations ${label}`, list.map((r) => ({
          "Order No": r.orderNo, Channel: r.channel, Client: r.customer, Products: (r.products || []).join("; "), Ordered: r.orderedAt ? fmtDate(r.orderedAt) : "",
          Cancelled: r.cancelledAt ? fmtDate(r.cancelledAt) : "", Reason: r.reason, "How Far It Had Got": r.stage, "Cancelled By": r.cancelledBy, Salesperson: r.salesperson,
        })))} />
      {error ? <Empty text={`Cancellations could not be loaded: ${error}`} /> : !data ? <Loading text="Loading cancellations" /> : (
        <>
          <div className="ceo-dstats">
            <Stat label="Cancelled Orders" info={`Orders cancelled (${label.toLowerCase()}), matching the filters.`}><b>{num(s.count)}</b><small>{s.prevCount ? <>{num(s.prevCount)} the period before <span className={change > 0 ? "pm-late" : undefined}>({change > 0 ? "+" : ""}{change}%)</span></> : "None the period before"}</small></Stat>
            <Stat label="After Production Started" info="Cancelled once work had begun on at least one piece."><b className={after ? "is-warn" : undefined}>{num(after)}</b></Stat>
          </div>
          <div className="ceo-grid pm-cx-grid">
            <Card span={12} title={`Cancelled per ${grain}`}>{s.trend.length ? <Columns data={s.trend.map((t) => ({ name: grain === "month" ? t.key : fmtDate(t.key).slice(0, 7), value: t.count }))} money={false} name="Cancelled" height={200} /> : <Empty text="No cancellations in this period." />}</Card>
            <Card span={6} md={12} title="By Channel"><RankBars rows={rank(s.byChannel)} limit={8} format={(v) => plural(v, "order")} sub={share} /></Card>
            <Card span={6} md={12} title="By Reason"><RankBars rows={rank(s.byReason)} limit={8} format={(v) => plural(v, "order")} sub={share} /></Card>
            <Card span={6} md={12} title="How Far It Had Got"><RankBars rows={rank(s.byStage)} limit={8} format={(v) => plural(v, "order")} sub={share} /></Card>
            <Card span={6} md={12} title="Cancelled By"><RankBars rows={rank(s.byWho)} limit={8} format={(v) => plural(v, "order")} sub={share} /></Card>
          </div>
          <Paged list={list} render={(page) => (
            <Table rowKey={(r) => r.id} rows={page} empty={rows.length ? "No cancellations match these filters." : "No cancellations in this period."}
              onRow={(r) => ordersById[r.id] && openOrder(ordersById[r.id])}
              columns={[
                { key: "order", label: "Order", render: (r) => <span className="pm-nowrap">{r.orderNo}</span> },
                { key: "client", label: "Client", render: (r) => r.customer || "–" },
                { key: "prod", label: "Products", hide: true, render: (r) => <span className="pm-wrap">{(r.products || []).join("; ") || "–"}</span> },
                { key: "chan", label: "Channel", hide: true, render: (r) => r.channel },
                { key: "od", label: "Ordered", right: true, hide: true, render: (r) => <DateCell ts={r.orderedAt} note="" /> },
                { key: "cd", label: "Cancelled", right: true, render: (r) => <DateCell ts={r.cancelledAt} note="" /> },
                { key: "why", label: "Reason", render: (r) => <span className="pm-wrap">{r.reason || <span className="pm-muted">–</span>}</span> },
                { key: "stage", label: "How Far It Had Got", hide: true, render: (r) => r.stage },
                { key: "by", label: "Cancelled By", hide: true, render: (r) => r.cancelledBy || "–" },
              ]} />
          )} />
        </>
      )}
      <FilterDrawer open={open} onClose={() => setOpen(false)} onClear={() => { setChannels([]); setReasons([]); setStages([]); setWho([]); }} count={list.length} noun="orders" sub={`Cancellations, ${label.toLowerCase()}`}>
        <FilterGroup label="Channel"><Chips options={choices.channels} value={channels} onChange={setChannels} /></FilterGroup>
        <FilterGroup label="Reason"><Chips options={choices.reasons} value={reasons} onChange={setReasons} /></FilterGroup>
        <FilterGroup label="How Far It Had Got"><Chips options={choices.stages} value={stages} onChange={setStages} /></FilterGroup>
        <FilterGroup label="Cancelled By"><Chips options={choices.who} value={who} onChange={setWho} /></FilterGroup>
      </FilterDrawer>
    </>
  );
}
