import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import ComponentStageBadge from "../../components/ComponentStageBadge";
import {
  fetchComponentByBarcode,
  fetchOrderComponents,
  fetchTransitionHistory,
  fetchMovementHistory,
  securityGuardScan,
  enrichComponentsWithMovements,
  describeTransition,
  buildStagePassMap,
  recordOverride,
  PRODUCTION_STAGES,
  getStageLabel,
  fetchStageOverrides,
  getOverrideTypeLabel,
  OVERRIDE_TYPE_LABELS,
  fetchPendingReplacements,
  approveReplacementJourney,
  rejectReplacementJourney,
} from "../../utils/barcodeService";
import { applyStageOverride, OVERRIDE_KINDS } from "../../utils/stageOverride";
import { approveRequest, listPendingRequests, listRecentDecisions, rejectRequest } from "../../utils/stageRequests";
import { getWarehouseDateObj } from "../../utils/warehouseDate";
import { factoryBadge } from "../../utils/factory2";
import { Chips, Drawer, FilterGroup, Pager, Seg, num } from "../CeoDashboard/CeoUi";
import { FilterDrawer, ListTools, PeriodFacet, Stat, usePagePeriod } from "../CeoDashboard/dashKit";
import { Loading, Table, csvFromObjects } from "./PmCommon";
import { fmtDate, plural } from "./pmModel";

// ============================================================
// Overrides in the dashboard's own design. These replace the older shared
// panels inside the Production Manager dashboard only; the older dashboards
// keep ProductionOverrides, OverrideHistory and ReplacementApprovals. Every
// save calls the same functions, with the same checks and the same messages,
// as those panels did. No money and no client contact details anywhere.
//
//   OverrideTool     stage change requests from the floor (approve / reject),
//                    finding an order or piece, and moving it by override.
//                    initialOrder opens straight on one order, with no
//                    requests list and no search (from an order's actions).
//   OverrideLog      the record of every override (read only).
//   ReplacementList  replacement requests from the Production Head.
// ============================================================

const lc = (v) => String(v || "").toLowerCase();
const has = (q, ...vals) => !q || vals.some((v) => lc(v).includes(q));
const countBy = (list, keyOf) => {
  const m = {};
  list.forEach((x) => { const k = keyOf(x); if (k) m[k] = (m[k] || 0) + 1; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k]) => ({ value: k, label: k }));
};
const pick = (vals, v) => !vals.length || vals.includes(v);
const clock = (ts) => new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const stamp = (ts) => (ts ? `${fmtDate(ts)} ${clock(ts)}` : "");
const stage = (v) => getStageLabel(v) || v || "";
const sortChips = (opts, value, set, fallback) => <Chips options={opts} value={value} onChange={(v) => set(v || fallback)} />;
const NEWEST = [{ value: "new", label: "Newest first" }, { value: "old", label: "Oldest first" }];

/** A date with the time (or a note) under it. */
const DateCell = ({ ts, note }) => (ts
  ? <span className="pm-cell"><b>{fmtDate(ts)}</b><small>{note ?? clock(ts)}</small></span>
  : <span className="pm-muted">–</span>);
const Code = ({ children }) => <span className="pm-code">{children || "–"}</span>;
const Tag = ({ tone, children }) => <i className={`pm-tag${tone ? ` is-${tone}` : ""}`}>{children}</i>;
const Dash = () => <span className="pm-muted">–</span>;
/** The outcome of the last action, in the panel itself (as the older panels showed it). */
const Note = ({ ok, children }) => <div className={`pmo-note ${ok ? "is-ok" : "is-err"}`} role="status">{children}</div>;
const Head = ({ title, sub, children }) => (
  <div className="pmo-head"><div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>{children}</div>
);

/** The page of rows and the pager under it; back to page 1 whenever the list changes. */
function Paged({ list, size = 15, render }) {
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [list]);
  return (
    <>
      {render(list.slice((page - 1) * size, page * size))}
      <Pager page={page} pages={Math.ceil(list.length / size)} onChange={setPage} />
    </>
  );
}

// ============================================================ stage change requests
// Skip / advance requests sent by production heads (meeting point 5). Approve
// runs the PM's own override on each piece (utils/stageOverride); Reject needs
// a note. Same calls and messages as StageRequestsPanel.
const REQ_TYPES = [{ value: "advance", label: "Advance" }, { value: "skip", label: "Skip" }];
const typeName = (t) => (t === "skip" ? "Skip" : "Advance");
const STATUS_NAMES = { approved: "Approved", rejected: "Rejected", pending: "Waiting" };

function StageRequests({ by, onApplied }) {
  const [pending, setPending] = useState([]);
  const [recent, setRecent] = useState([]);
  const [view, setView] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);         // group id being decided
  const [notes, setNotes] = useState({});         // group id → reject note
  const [result, setResult] = useState(null);     // last decision's outcome
  const [openId, setOpenId] = useState(null);     // the request being reviewed
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState("new");
  const [types, setTypes] = useState([]);
  const [targets, setTargets] = useState([]);
  const [who, setWho] = useState([]);
  const [statuses, setStatuses] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [p, r] = await Promise.all([listPendingRequests(), listRecentDecisions()]);
      setPending(p);
      setRecent(r);
    } catch (err) {
      console.error("Requests load failed:", err);
      setError("Could not load requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const approve = async (g) => {
    setBusy(g.group);
    setResult(null);
    try {
      const res = await approveRequest(g, by);
      setResult(res.claimed === 0
        ? { ok: false, text: `${g.order_no}: already decided by someone else.` }
        : {
          ok: res.failed.length === 0,
          text: `${g.order_no}: ${res.applied} of ${res.claimed} piece${res.claimed === 1 ? "" : "s"} moved to ${getStageLabel(g.target_stage) || g.target_stage}.`
            + (res.failed.length ? ` Not applied: ${res.failed.map((f) => `${f.barcode} — ${f.error}`).join("; ")}` : ""),
        });
      if (res.applied) onApplied?.(g);
    } catch (err) {
      setResult({ ok: false, text: `${g.order_no}: ${err.message || "approval failed"}` });
    } finally {
      setBusy(null);
      setOpenId(null);
      load();
    }
  };

  const reject = async (g) => {
    setBusy(g.group);
    setResult(null);
    try {
      const n = await rejectRequest(g, by, notes[g.group]);
      setResult({ ok: true, text: n ? `${g.order_no}: request rejected.` : `${g.order_no}: already decided by someone else.` });
      setNotes((prev) => ({ ...prev, [g.group]: "" }));
      setOpenId(null);
    } catch (err) {
      setResult({ ok: false, text: err.message || "Could not reject." });
    } finally {
      setBusy(null);
      load();
    }
  };

  const decided = view === "recent";
  const all = decided ? recent : pending;
  const choices = useMemo(() => ({
    targets: countBy(all, (g) => stage(g.target_stage) || "Not given"),
    who: countBy(all, (g) => g.requested_by || "Not recorded"),
  }), [all]);
  const list = useMemo(() => {
    const q = lc(search).trim();
    const out = all.filter((g) => pick(types, g.request_type === "skip" ? "skip" : "advance")
      && pick(targets, stage(g.target_stage) || "Not given") && pick(who, g.requested_by || "Not recorded")
      && (!decided || pick(statuses, g.status))
      && has(q, g.order_no, g.reason, g.requested_by, g.decided_by, ...g.rows.map((r) => r.barcode)));
    const at = (g) => new Date((decided ? g.decided_at : null) || g.requested_at).getTime();
    out.sort((a, b) => (sort === "old" ? 1 : -1) * (at(a) - at(b)));
    return out;
  }, [all, search, types, targets, who, statuses, decided, sort]);
  const active = [sort !== "new", types.length, targets.length, who.length, decided && statuses.length].filter(Boolean).length;
  const clear = () => { setSort("new"); setTypes([]); setTargets([]); setWho([]); setStatuses([]); };
  const pieces = list.reduce((s, g) => s + g.rows.length, 0);
  const oldest = !decided && list.length ? Math.min(...list.map((g) => new Date(g.requested_at).getTime())) : null;
  const exportCsv = () => csvFromObjects(decided ? "stage request decisions" : "stage requests waiting", list.map((g) => ({
    "Order No": g.order_no || "", Request: typeName(g.request_type), "Move To": stage(g.target_stage), Pieces: g.rows.length,
    Barcodes: g.rows.map((r) => r.barcode).join(", "), Reason: g.reason || "", "Asked By": g.requested_by || "", "Asked On": stamp(g.requested_at),
    ...(decided ? {
      Status: STATUS_NAMES[g.status] || g.status, "Pieces Moved": g.appliedCount, "Decided By": g.decided_by || "",
      "Decided On": stamp(g.decided_at), Note: g.decision_note || "",
    } : {}),
  })));
  const current = [...pending, ...recent].find((g) => g.group === openId) || null;
  const currentDecided = current ? current.status !== "pending" : false;

  return (
    <div className="pm-records">
      <Head title="Requests from the Floor" sub="Skip and advance requests sent by production heads. Approving moves each piece exactly as your own override would." />
      {result && <Note ok={result.ok}>{result.text}</Note>}
      <ListTools search={search} onSearch={setSearch} placeholder="Search order, barcode, person or reason" filters={active} onFilters={() => setOpen(true)} onExport={exportCsv} exportDisabled={!list.length}>
        <Seg label="Requests" value={view} onChange={setView} options={[{ value: "pending", label: "Waiting", count: pending.length }, { value: "recent", label: "Recent Decisions" }]} />
      </ListTools>
      <div className="ceo-dstats">
        <Stat label={decided ? "Decisions" : "Waiting"} info={decided ? "Recently decided requests matching the filters." : "Requests waiting for your decision, matching the filters."}><b className={!decided && list.length ? "is-warn" : undefined}>{num(list.length)}</b></Stat>
        <Stat label="Pieces" info="Pieces in those requests."><b>{num(pieces)}</b></Stat>
        {decided ? (
          <>
            <Stat label="Approved" info="Requests approved."><b>{num(list.filter((g) => g.status === "approved").length)}</b></Stat>
            <Stat label="Rejected" info="Requests rejected, each with a note."><b>{num(list.filter((g) => g.status === "rejected").length)}</b></Stat>
          </>
        ) : (
          <Stat label="Oldest" info="When the oldest waiting request was sent."><b>{oldest ? fmtDate(oldest) : "–"}</b></Stat>
        )}
      </div>
      {loading ? <Loading text="Loading requests" /> : error ? <Note ok={false}>{error}</Note> : (
        <Paged list={list} render={(page) => (
          <Table rowKey={(g) => g.group} rows={page} onRow={(g) => setOpenId(g.group)}
            empty={all.length ? "No requests match these filters." : decided ? "No decisions yet." : "No pending skip / advance requests."}
            columns={[
              { key: "order", label: "Order", render: (g) => <span className="pm-nowrap">{g.order_no || "–"}</span> },
              { key: "type", label: "Request", render: (g) => <Tag>{typeName(g.request_type)}</Tag> },
              { key: "to", label: "Move To", render: (g) => stage(g.target_stage) || <Dash /> },
              { key: "n", label: "Pieces", right: true, render: (g) => num(g.rows.length) },
              { key: "why", label: "Reason", render: (g) => <span className="pm-wrap">{g.reason || <Dash />}</span> },
              { key: "by", label: "Asked By", hide: true, render: (g) => g.requested_by || <Dash /> },
              { key: "at", label: "Asked On", right: true, render: (g) => <DateCell ts={g.requested_at} /> },
              ...(decided ? [
                { key: "st", label: "Status", render: (g) => <span className="pm-cell"><b><Tag tone={g.status === "rejected" ? "urgent" : undefined}>{STATUS_NAMES[g.status] || g.status}</Tag></b>{g.status === "approved" && <small>{g.appliedCount} of {plural(g.rows.length, "piece")} moved</small>}</span> },
                { key: "on", label: "Decided On", right: true, hide: true, render: (g) => <DateCell ts={g.decided_at} /> },
              ] : [
                { key: "go", label: "", right: true, render: (g) => <button type="button" className="ceo-btn" onClick={(e) => { e.stopPropagation(); setOpenId(g.group); }}>Review</button> },
              ]),
            ]} />
        )} />
      )}
      <FilterDrawer open={open} onClose={() => setOpen(false)} onClear={clear} count={list.length} noun="requests" sub="Narrow the requests">
        <FilterGroup label="Sort By">{sortChips(NEWEST, sort, setSort, "new")}</FilterGroup>
        {decided && <FilterGroup label="Decision"><Chips options={[{ value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }]} value={statuses} onChange={setStatuses} /></FilterGroup>}
        <FilterGroup label="Request"><Chips options={REQ_TYPES} value={types} onChange={setTypes} /></FilterGroup>
        <FilterGroup label="Move To"><Chips options={choices.targets} value={targets} onChange={setTargets} /></FilterGroup>
        <FilterGroup label="Asked By"><Chips options={choices.who} value={who} onChange={setWho} /></FilterGroup>
      </FilterDrawer>
      {current && (
        <Drawer
          title={`${current.order_no} · ${typeName(current.request_type)} Request`}
          sub={`${plural(current.rows.length, "piece")} to ${stage(current.target_stage)}`}
          onClose={() => setOpenId(null)}
          footer={currentDecided ? null : (
            <>
              <button type="button" className="ceo-btn" onClick={() => reject(current)} disabled={busy === current.group || !(notes[current.group] || "").trim()}>Reject</button>
              <button type="button" className="ceo-btn is-primary" onClick={() => approve(current)} disabled={busy === current.group}>{busy === current.group ? "Working" : "Approve"}</button>
            </>
          )}
        >
          <div className="pm-records">
            <div className="ceo-dstats">
              <Stat label="Request"><b>{typeName(current.request_type)}</b></Stat>
              <Stat label="Move To"><b>{stage(current.target_stage) || "–"}</b></Stat>
              <Stat label="Asked By"><b className="pmo-break">{current.requested_by || "–"}</b></Stat>
              <Stat label="Asked On"><b>{fmtDate(current.requested_at)}</b></Stat>
              {currentDecided && <Stat label="Decision"><b>{STATUS_NAMES[current.status] || current.status}</b></Stat>}
              {currentDecided && <Stat label="Decided By"><b className="pmo-break">{current.decided_by || "–"}</b></Stat>}
            </div>
            <div className="pmo-panel"><span className="ceo-label">Reason</span><p>{current.reason || "–"}</p></div>
            <Table rowKey={(r) => r.id} rows={current.rows}
              columns={[
                { key: "bc", label: "Barcode", render: (r) => <Code>{r.barcode}</Code> },
                { key: "from", label: "At When Asked", render: (r) => stage(r.from_stage) || <Dash /> },
                ...(currentDecided ? [{
                  key: "res", label: "Result",
                  render: (r) => (r.status === "approved"
                    ? (r.applied ? <Tag>Moved</Tag> : <span className="pm-cell"><b><Tag tone="urgent">Not applied</Tag></b><small className="pm-wrap">{r.apply_error || "refused"}</small></span>)
                    : <Tag tone="soft">{STATUS_NAMES[r.status] || r.status}</Tag>),
                }] : []),
              ]} />
            {currentDecided ? (
              current.decision_note && <div className="pmo-panel"><span className="ceo-label">Note</span><p>{current.decision_note}</p></div>
            ) : (
              <label className="pmx-field pmo-field">
                <span>Reason for rejecting (needed to reject)</span>
                <textarea
                  rows={3}
                  value={notes[current.group] || ""}
                  onChange={(e) => { const v = e.target.value; setNotes((prev) => ({ ...prev, [current.group]: v })); }}
                  disabled={busy === current.group}
                  placeholder="Say why it is rejected"
                />
              </label>
            )}
          </div>
        </Drawer>
      )}
    </div>
  );
}

// ============================================================ override tool
const ADVANCE_KINDS = [
  { value: "manual_advance", label: "Manual Advance", note: "Move the piece to any stage, forward or back, without a scan." },
  { value: "skip_stage", label: "Skip Stage", note: "Jump the piece past stages it does not need." },
  { value: "timeline_extension", label: "Extend Timeline", note: "Give the piece more days at the stage it is at." },
];
const RETURN_KIND = { value: "vendor_return", label: "Force Return from Vendor", note: "The piece is back in the building but the gate entry scan was missed." };

// Override is the full-bypass correction tool, so it offers EVERY stage —
// forward OR backward — not just the ones after the current stage. Terminal
// states are excluded. The DB (advance_component_stage, manual_override)
// accepts any direction.
const ADVANCEABLE = PRODUCTION_STAGES.filter((s) => !["disposed", "scrapped", "order_received"].includes(s.value));

/** A piece's scan history, newest as the database returns it. */
function HistoryList({ history, movements, passMap, barcode }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [kinds, setKinds] = useState([]);
  const rows = useMemo(() => history.map((t) => ({ t, d: describeTransition(t, movements, passMap) })), [history, movements, passMap]);
  const list = useMemo(() => {
    const q = lc(search).trim();
    return rows.filter(({ t, d }) => pick(kinds, d.kind) && has(q, d.headline, t.scanned_by, t.notes, t.transition_type));
  }, [rows, search, kinds]);
  const kindName = (k) => (k === "external" ? "External / Vendor" : "Internal Scan");
  const exportCsv = () => csvFromObjects(`stage history ${barcode || ""}`, list.map(({ t, d }) => ({
    Date: t.scanned_at ? fmtDate(t.scanned_at) : "", Time: t.scanned_at ? clock(t.scanned_at) : "", Move: d.headline, Kind: kindName(d.kind),
    Type: d.showType ? t.transition_type : "", By: t.scanned_by || "", Warehouse: factoryBadge(t.factory), Notes: t.notes || "",
  })));
  return (
    <div className="pm-records">
      <Head title="Stage History" sub="Every scan and override on this piece." />
      <ListTools search={search} onSearch={setSearch} placeholder="Search stage, person or note" filters={kinds.length} onFilters={() => setOpen(true)} onExport={exportCsv} exportDisabled={!list.length} />
      <Paged list={list} render={(page) => (
        <Table rowKey={({ t }) => t.id} rows={page} empty="No scans match these filters."
          columns={[
            { key: "at", label: "Date", render: ({ t }) => <DateCell ts={t.scanned_at} /> },
            { key: "move", label: "Move", render: ({ d }) => <span className="pm-wrap">{d.headline}</span> },
            { key: "kind", label: "Kind", render: ({ t, d }) => <span className="pm-cell"><b><Tag tone={d.kind === "external" ? "soft" : undefined}>{kindName(d.kind)}</Tag></b>{d.showType && <small>{t.transition_type}</small>}</span> },
            { key: "by", label: "By", render: ({ t }) => <span className="pm-cell"><b className="pmo-break">{t.scanned_by || "–"}</b>{factoryBadge(t.factory) && <small>{factoryBadge(t.factory)}</small>}</span> },
            { key: "notes", label: "Notes", hide: true, render: ({ t }) => <span className="pm-wrap">{t.notes || <Dash />}</span> },
          ]} />
      )} />
      <FilterDrawer open={open} onClose={() => setOpen(false)} onClear={() => setKinds([])} count={list.length} noun="scans" sub="Narrow the stage history">
        <FilterGroup label="Kind"><Chips options={[{ value: "internal", label: "Internal Scan" }, { value: "external", label: "External / Vendor" }]} value={kinds} onChange={setKinds} /></FilterGroup>
      </FilterDrawer>
    </div>
  );
}

/**
 * Everything ProductionOverrides did, in this dashboard's design.
 * initialOrder ({ id, order_no }): open straight on that order, with no search
 * and no requests list (used from an order's own actions).
 */
export function OverrideTool({ ctx, initialOrder = null }) {
  const currentUserEmail = ctx.email;
  const [searchBarcode, setSearchBarcode] = useState("");
  const [searchOrderNo, setSearchOrderNo] = useState("");
  // Several orders matched the order search: listed for the PM to pick one.
  const [orderMatches, setOrderMatches] = useState([]);
  const [component, setComponent] = useState(null);
  const [orderComponents, setOrderComponents] = useState([]);
  const [history, setHistory] = useState([]);
  const [movements, setMovements] = useState([]);
  // Pass number per timeline row, so a re-journeyed stage reads "Cloth Issued (2)".
  const historyPassMap = useMemo(() => buildStagePassMap(history), [history]);
  const [loading, setLoading] = useState(false);
  const [actionResult, setActionResult] = useState(null);

  // Override form
  const [overrideType, setOverrideType] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [targetStage, setTargetStage] = useState("");
  const [extendDays, setExtendDays] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // A piece's scan history + its vendor trips together, so the history can
  // name the stage each security exit/entry was for (describeTransition).
  const loadHistoryAndMovements = async (componentId) => {
    const [hist, movs] = await Promise.all([
      fetchTransitionHistory(componentId),
      fetchMovementHistory(componentId),
    ]);
    setHistory(hist);
    setMovements(movs);
  };

  // An order's pieces with stages_outside attached, so the stage badge reads
  // "Out to Vendor (Embroidery)".
  const loadOrderComponents = async (orderId) => {
    const comps = await enrichComponentsWithMovements(await fetchOrderComponents(orderId));
    setOrderComponents(comps);
    return comps;
  };

  /** The dashboard's own copy of the order, re-read after a change (when the dashboard offers it). */
  const refreshDashboard = (orderId) => { if (orderId && ctx.reloadOrder) ctx.reloadOrder(orderId)?.catch?.(() => {}); };

  const handleBarcodeSearch = async () => {
    if (!searchBarcode.trim()) return;
    setLoading(true);
    setActionResult(null);
    try {
      const comp = await fetchComponentByBarcode(searchBarcode.trim().toUpperCase());
      const [enriched] = await enrichComponentsWithMovements([comp]);
      setComponent(enriched || comp);
      await loadOrderComponents(comp.order_id);
      await loadHistoryAndMovements(comp.id);
    } catch (err) {
      setActionResult({ success: false, message: "Component not found: " + err.message });
      setComponent(null);
    }
    setLoading(false);
  };

  // Open one order: load its pieces and select the first. An order with no
  // barcodes yet has nothing to override, so say so.
  const openOrder = async (order) => {
    setOrderMatches([]);
    const allComps = await loadOrderComponents(order.id);
    if (allComps.length > 0) {
      setComponent(allComps[0]);
      await loadHistoryAndMovements(allComps[0].id);
    } else {
      setComponent(null);
      setHistory([]);
      setMovements([]);
      setActionResult({ success: false, message: `${order.order_no} has no barcodes yet, so there is nothing to override.` });
    }
  };

  // Opened from an order's own actions: load that order straight away.
  useEffect(() => {
    if (!initialOrder?.id) return;
    setLoading(true);
    openOrder(initialOrder)
      .catch((err) => setActionResult({ success: false, message: err.message }))
      .finally(() => setLoading(false));
  }, [initialOrder?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Search by our order number (substring) OR Shopify's (exact, with or
  // without "#"). Every match is shown when there is more than one, so a short
  // number never silently opens the wrong order. Two plain queries merged here:
  // the typed text never goes into a PostgREST filter string.
  const handleOrderSearch = async () => {
    const raw = searchOrderNo.trim();
    if (!raw) return;
    setLoading(true);
    setActionResult(null);
    setOrderMatches([]);
    setComponent(null);
    setOrderComponents([]);
    try {
      const cols = "id, order_no, shopify_order_name, created_at";
      const likeTerm = raw.replace(/[\\%_]/g, (m) => `\\${m}`);
      const shopifyDigits = /^#?\d{3,7}$/.test(raw) ? raw.replace(/^#/, "") : null;

      const [byOrderNo, byShopify] = await Promise.all([
        supabase.from("orders").select(cols).ilike("order_no", `%${likeTerm}%`)
          .order("created_at", { ascending: false }).limit(20),
        shopifyDigits
          ? supabase.from("orders").select(cols).eq("shopify_order_name", `#${shopifyDigits}`).limit(20)
          : Promise.resolve({ data: [] }),
      ]);
      if (byOrderNo.error) throw byOrderNo.error;
      if (byShopify.error) throw byShopify.error;

      // Exact hits first, then newest first. De-duplicated.
      const seen = new Set();
      const isExact = (o) =>
        (o.order_no || "").toUpperCase() === raw.toUpperCase() ||
        (shopifyDigits && o.shopify_order_name === `#${shopifyDigits}`);
      const matches = [...(byShopify.data || []), ...(byOrderNo.data || [])]
        .filter((o) => (seen.has(o.id) ? false : seen.add(o.id)))
        .sort((a, b) => (isExact(b) - isExact(a)) || (new Date(b.created_at) - new Date(a.created_at)));

      if (matches.length === 0) {
        setActionResult({ success: false, message: `No order found for "${raw}".` });
      } else if (matches.length === 1) {
        await openOrder(matches[0]);
      } else {
        setOrderMatches(matches);
      }
    } catch (err) {
      setActionResult({ success: false, message: err.message });
    }
    setLoading(false);
  };

  const pickMatch = async (o) => {
    if (loading) return;
    setLoading(true);
    setActionResult(null);
    try { await openOrder(o); } catch (err) { setActionResult({ success: false, message: err.message }); }
    setLoading(false);
  };

  const selectComponent = async (comp) => {
    setComponent(comp);
    try {
      await loadHistoryAndMovements(comp.id);
    } catch (err) {
      console.error("Failed to fetch history:", err);
    }
    setOverrideType("");
    setOverrideReason("");
    setTargetStage("");
    setExtendDays("");
    setActionResult(null);
  };

  const handleOverrideSubmit = async () => {
    if (!component) return;
    if (!overrideReason.trim()) {
      setActionResult({ success: false, message: "Reason is mandatory for all overrides" });
      return;
    }

    setIsSubmitting(true);
    setActionResult(null);

    try {
      if (overrideType === "manual_advance" || overrideType === "skip_stage") {
        if (!targetStage) {
          setActionResult({ success: false, message: overrideType === "skip_stage" ? "Select which stage to skip to" : "Select a target stage" });
          setIsSubmitting(false);
          return;
        }

        // Shared with approving a floor request (utils/stageOverride).
        const result = await applyStageOverride({
          component,
          kind: overrideType,
          targetStage,
          reason: overrideReason,
          by: currentUserEmail,
        });

        if (result.success) {
          setActionResult({ success: true, message: `${OVERRIDE_KINDS[overrideType].doneLabel} ${getStageLabel(targetStage)}` });

          const updated = await fetchComponentByBarcode(component.barcode);
          const [enriched] = await enrichComponentsWithMovements([updated]);
          setComponent(enriched || updated);
          await loadHistoryAndMovements(updated.id);
          await loadOrderComponents(updated.order_id);
          refreshDashboard(updated.order_id);
        } else {
          setActionResult({ success: false, message: result.message });
        }

      } else if (overrideType === "vendor_return") {
        // The piece is physically back but the gate entry scan never happened.
        // Fires the SAME gate-entry event the guard would have, stamped with the
        // PM's email and the reason (db/barcode_system/v2/86_pm_force_vendor_return.sql).
        const result = await securityGuardScan({
          barcode: component.barcode,
          scanType: "entry",
          scannedBy: currentUserEmail,
          notes: `PM override — no gate entry scan. ${overrideReason.trim()}`,
          // Release 6: also bypasses "not completed at SB WH Delhi (2)".
          force: true,
        });

        if (result.success) {
          await recordOverride({
            componentId: component.id,
            orderId: component.order_id,
            orderNo: component.order_no,
            barcode: component.barcode,
            overrideType: "vendor_return",
            fromStage: component.current_stage,
            toStage: component.current_stage,
            reason: overrideReason.trim(),
            overriddenBy: currentUserEmail,
          });

          setActionResult({ success: true, message: result.message || "Returned from vendor." });

          const updated = await fetchComponentByBarcode(component.barcode);
          const [enriched] = await enrichComponentsWithMovements([updated]);
          setComponent(enriched || updated);
          await loadHistoryAndMovements(updated.id);
          await loadOrderComponents(updated.order_id);
          refreshDashboard(updated.order_id);
        } else {
          setActionResult({ success: false, message: result.message || result.error });
        }

      } else if (overrideType === "timeline_extension") {
        const days = parseInt(extendDays, 10);
        if (!days || days <= 0) {
          setActionResult({ success: false, message: "Enter valid number of days" });
          setIsSubmitting(false);
          return;
        }

        const newDeadline = new Date();
        newDeadline.setDate(newDeadline.getDate() + days);

        const { error } = await supabase
          .from("order_components")
          .update({
            stage_deadline: newDeadline.toISOString(),
            is_delayed: false,
            delay_days: 0,
          })
          .eq("id", component.id);

        if (!error) {
          await recordOverride({
            componentId: component.id,
            orderId: component.order_id,
            orderNo: component.order_no,
            barcode: component.barcode,
            overrideType: "timeline_extension",
            fromStage: component.current_stage,
            toStage: component.current_stage,
            reason: overrideReason,
            overriddenBy: currentUserEmail,
            originalDeadline: component.stage_deadline,
            newDeadline: newDeadline.toISOString(),
            extendedDays: days,
          });

          setActionResult({ success: true, message: `Timeline extended by ${days} days` });

          const updated = await fetchComponentByBarcode(component.barcode);
          const [enriched] = await enrichComponentsWithMovements([updated]);
          setComponent(enriched || updated);
          await loadOrderComponents(updated.order_id);
          refreshDashboard(updated.order_id);
        } else {
          setActionResult({ success: false, message: error.message });
        }
      }
    } catch (err) {
      setActionResult({ success: false, message: err.message });
    }

    setIsSubmitting(false);
    setOverrideType("");
    setOverrideReason("");
    setTargetStage("");
    setExtendDays("");
  };

  // A floor request was approved: whatever order is open here reloads.
  const onRequestApplied = (g) => {
    if (component?.order_id) loadOrderComponents(component.order_id).catch(() => {});
    refreshDashboard(g?.order_id);
  };

  const c = component;
  const dispatchBy = c?.orders ? getWarehouseDateObj(c.orders.delivery_date, c.orders.created_at) : null;
  const canOverride = c && !["disposed", "scrapped", "dispatched"].includes(c.current_stage);
  const kinds = c?.is_outside_wh ? [RETURN_KIND] : ADVANCE_KINDS;

  return (
    <div className="pm-records pmo-tool">
      {!initialOrder && <StageRequests by={currentUserEmail} onApplied={onRequestApplied} />}

      {!initialOrder && (
        <div className="pm-records">
          <Head title="Find an Order or Piece" sub="Scan or type a barcode, or search by our order number or the Shopify number." />
          <div className="pmo-find">
            <label className="pmx-field pmo-field">
              <span>Barcode</span>
              <span className="pmo-find-row">
                <input type="text" className="pmo-mono" value={searchBarcode} onChange={(e) => setSearchBarcode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleBarcodeSearch()} placeholder="e.g. DLC-000023-TOP" />
                <button type="button" className="ceo-btn is-primary" onClick={handleBarcodeSearch} disabled={loading}>Search</button>
              </span>
            </label>
            <label className="pmx-field pmo-field">
              <span>Order No or Shopify No</span>
              <span className="pmo-find-row">
                <input type="text" value={searchOrderNo} onChange={(e) => setSearchOrderNo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleOrderSearch()} placeholder="e.g. 000023 or #28166" />
                <button type="button" className="ceo-btn is-primary" onClick={handleOrderSearch} disabled={loading}>Search</button>
              </span>
            </label>
          </div>
        </div>
      )}

      {loading && <Loading text="Loading pieces" />}

      {/* More than one order matched: the PM picks, the screen never guesses. */}
      {orderMatches.length > 0 && (
        <div className="pm-records">
          <Head
            title={`${orderMatches.length} orders match "${searchOrderNo.trim()}"`}
            sub={`Pick one.${orderMatches.length === 20 ? " Showing the first 20; type more of the number to narrow it." : ""}`}
          />
          <Table rowKey={(o) => o.id} rows={orderMatches} onRow={pickMatch}
            columns={[
              { key: "no", label: "Order No", render: (o) => <span className="pm-nowrap"><b>{o.order_no}</b></span> },
              { key: "shop", label: "Shopify No", render: (o) => o.shopify_order_name || <Dash /> },
              { key: "at", label: "Ordered On", right: true, render: (o) => <DateCell ts={o.created_at} /> },
            ]} />
        </div>
      )}

      {actionResult && <Note ok={actionResult.success}>{actionResult.message}</Note>}

      {/* Every piece of the order: tap one to override it. */}
      {orderComponents.length > 0 && (
        <div className="pm-records">
          <Head title={`Pieces${c?.order_no ? ` · ${c.order_no}` : ""}`} sub="Choose the piece to override." />
          <div className="pmo-pieces">
            {orderComponents.map((comp) => (
              <button key={comp.id} type="button" className="pmo-piece" aria-pressed={c?.id === comp.id} onClick={() => selectComponent(comp)}>
                <span className="pmo-piece-top">
                  <b>{comp.component_label || comp.component_type}</b>
                  <span className="ceo-keep"><ComponentStageBadge comp={comp} /></span>
                </span>
                <span className="pm-code">{comp.barcode}</span>
                {(!comp.is_active || comp.is_delayed || comp.is_outside_wh || comp.re_journey_count > 0) && (
                  <span className="pmo-piece-tags">
                    {!comp.is_active && <Tag tone="soft">Inactive</Tag>}
                    {comp.is_delayed && <Tag tone="urgent">Delayed</Tag>}
                    {comp.is_outside_wh && <Tag>At Vendor</Tag>}
                    {comp.re_journey_count > 0 && <Tag>Rework {comp.re_journey_count}</Tag>}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* The chosen piece and its override. */}
      {c && (
        <div className="pm-records">
          <Head title={`Selected Piece · ${c.component_label || c.component_type || c.barcode}`} />
          <div className="ceo-dstats">
            <Stat label="Barcode"><b className="pmo-mono">{c.barcode}</b></Stat>
            <Stat label="Current Stage"><span className="ceo-keep"><ComponentStageBadge comp={c} /></span></Stat>
            <Stat label="QC Status"><b>{c.qc_status || "pending"}</b></Stat>
            <Stat label="Re-journeys"><b>{num(c.re_journey_count || 0)}</b></Stat>
            {/* The WAREHOUSE (T-2) date, not the customer's (utils/productionPrivacy.js). */}
            {c.orders && <Stat label="Dispatch By" info="The warehouse date: two days before the client's delivery date."><b>{dispatchBy ? fmtDate(dispatchBy) : "–"}</b></Stat>}
          </div>

          {canOverride && (
            <div className="pmo-panel">
              <span className="ceo-label">Override</span>
              {/* A piece at a vendor is frozen: the DB accepts only the gate return for it. */}
              {c.is_outside_wh && (
                <p className="pmo-hint">
                  This piece is out at <b>{c.vendor_name || "a vendor"}</b>. It cannot be advanced, skipped or rescheduled
                  until it is back in the building. Use this only when the piece is physically here and the Security Gate
                  entry scan was missed.
                </p>
              )}
              <div className="pmo-kinds" role="group" aria-label="Override">
                {kinds.map((k) => (
                  <button key={k.value} type="button" aria-pressed={overrideType === k.value} onClick={() => setOverrideType(k.value)}>
                    <b>{k.label}</b><small>{k.note}</small>
                  </button>
                ))}
              </div>

              {overrideType && (
                <div className="pmx-grid pmo-form">
                  {(overrideType === "manual_advance" || overrideType === "skip_stage") && (
                    <label className="pmx-field pmo-field">
                      <span>{overrideType === "manual_advance" ? "Move to Stage" : "Skip to Stage"}</span>
                      <select value={targetStage} onChange={(e) => setTargetStage(e.target.value)}>
                        <option value="">Choose a stage</option>
                        {ADVANCEABLE.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </label>
                  )}
                  {overrideType === "timeline_extension" && (
                    <label className="pmx-field pmo-field">
                      <span>Extend by (days)</span>
                      <input type="number" value={extendDays} onChange={(e) => setExtendDays(e.target.value)} placeholder="e.g. 5" min="1" />
                    </label>
                  )}
                  <label className="pmx-field pmo-field is-full">
                    <span>Reason (needed)</span>
                    <textarea value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} rows={3}
                      placeholder="e.g. Scanner not working, pre-dyed fabric, complex embroidery design" />
                  </label>
                  <div className="pmo-actions is-full">
                    <button type="button" className="ceo-btn" onClick={() => setOverrideType("")} disabled={isSubmitting}>Cancel</button>
                    <button type="button" className="ceo-btn is-primary" onClick={handleOverrideSubmit} disabled={isSubmitting}>
                      {isSubmitting ? "Applying" : "Apply Override"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {history.length > 0 && <HistoryList history={history} movements={movements} passMap={historyPassMap} barcode={c.barcode} />}
        </div>
      )}
    </div>
  );
}

// ============================================================ override log
// The audit trail of every override: who, when, why. Read only; nothing here
// can create or change a record. Same data and search as OverrideHistory.
const stageMove = (r) => {
  // A timeline extension doesn't move a stage: show the day count instead.
  if (r.override_type === "timeline_extension") return r.extended_days ? `+${r.extended_days} day${r.extended_days === 1 ? "" : "s"}` : "";
  if (r.from_stage && r.to_stage && r.from_stage !== r.to_stage) return `${getStageLabel(r.from_stage)} → ${getStageLabel(r.to_stage)}`;
  return getStageLabel(r.from_stage || r.to_stage) || "";
};

export function OverrideLog({ ctx, initialSearch = "" }) {
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState(initialSearch);
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState("new");
  const [types, setTypes] = useState([]);
  const [who, setWho] = useState([]);
  const p = usePagePeriod("all");

  useEffect(() => {
    let alive = true;
    (async () => {
      const data = await fetchStageOverrides();
      if (alive) setRows(data);
    })();
    return () => { alive = false; };
  }, []);

  const all = useMemo(() => rows || [], [rows]);
  // Only the types actually present.
  const presentTypes = useMemo(() => {
    const seen = new Set(all.map((r) => r.override_type).filter(Boolean));
    return Object.keys(OVERRIDE_TYPE_LABELS).filter((t) => seen.has(t)).map((t) => ({ value: t, label: OVERRIDE_TYPE_LABELS[t] }));
  }, [all]);
  const people = useMemo(() => countBy(all, (r) => r.overridden_by || "Not recorded"), [all]);
  const { range } = p;
  const list = useMemo(() => {
    const q = lc(search).trim();
    const out = all.filter((r) => (!range || (r.created_at && new Date(r.created_at) >= range.start && new Date(r.created_at) <= range.end))
      && pick(types, r.override_type) && pick(who, r.overridden_by || "Not recorded")
      && has(q, r.order_no, r.barcode, r.overridden_by, r.reason));
    if (sort === "old") out.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return out;
  }, [all, search, range, types, who, sort]);
  const active = [p.active, sort !== "new", types.length, who.length].filter(Boolean).length;
  const clear = () => { p.reset(); setSort("new"); setTypes([]); setWho([]); };
  const count = (...t) => list.filter((r) => t.includes(r.override_type)).length;
  const exportCsv = () => csvFromObjects("override log", list.map((r) => ({
    Date: r.created_at ? fmtDate(r.created_at) : "", Time: r.created_at ? clock(r.created_at) : "", By: r.overridden_by || "",
    Type: getOverrideTypeLabel(r.override_type), "Order No": r.order_no || "", Barcode: r.barcode || "", Stage: stageMove(r), Reason: r.reason || "",
  })));

  if (!rows) return <Loading text="Loading overrides" />;
  return (
    <div className="pm-records">
      <p className="pmo-hint">Every override bypasses the normal scan flow, so each one is recorded with who made it, when, and why.</p>
      <ListTools search={search} onSearch={setSearch} placeholder="Search order no, barcode, person or reason" filters={active} onFilters={() => setOpen(true)} onExport={exportCsv} exportDisabled={!list.length} />
      <div className="ceo-dstats">
        <Stat label="Overrides" info="Overrides matching the filters."><b>{num(list.length)}</b></Stat>
        <Stat label="Moved or Skipped" info="Pieces moved to a stage without a scan (Manual Advance or Skip Stage)."><b>{num(count("manual_advance", "skip_stage"))}</b></Stat>
        <Stat label="Timeline Extended" info="Pieces given more days at their stage."><b>{num(count("timeline_extension"))}</b></Stat>
        <Stat label="Forced Vendor Returns" info="Pieces marked back from a vendor without a gate entry scan."><b>{num(count("vendor_return"))}</b></Stat>
        <Stat label="People" info="Different people who made these overrides."><b>{num(new Set(list.map((r) => r.overridden_by).filter(Boolean)).size)}</b></Stat>
      </div>
      <Paged list={list} size={20} render={(page) => (
        <Table rowKey={(r) => r.id} rows={page} empty={all.length ? "No overrides match these filters." : "No overrides have been recorded."}
          columns={[
            { key: "at", label: "Date", render: (r) => <DateCell ts={r.created_at} /> },
            { key: "by", label: "By", render: (r) => <span className="pmo-break">{r.overridden_by || "–"}</span> },
            { key: "type", label: "Type", render: (r) => <Tag tone={r.override_type === "vendor_return" ? "urgent" : r.override_type === "timeline_extension" ? "soft" : undefined}>{getOverrideTypeLabel(r.override_type)}</Tag> },
            { key: "order", label: "Order", render: (r) => <span className="pm-nowrap">{r.order_no || "–"}</span> },
            { key: "bc", label: "Barcode", hide: true, render: (r) => <Code>{r.barcode}</Code> },
            { key: "stage", label: "Stage", render: (r) => <span className="pm-wrap">{stageMove(r) || <Dash />}</span> },
            // The reason is the point of the row: never cut short.
            { key: "why", label: "Reason", render: (r) => <span className="pm-wrap pmo-reason">{r.reason || <Dash />}</span> },
          ]} />
      )} />
      <FilterDrawer open={open} onClose={() => setOpen(false)} onClear={clear} count={list.length} noun="overrides" sub="Narrow the override log">
        <FilterGroup label="Sort By">{sortChips(NEWEST, sort, setSort, "new")}</FilterGroup>
        <PeriodFacet p={p} label="Date" />
        <FilterGroup label="Type"><Chips options={presentTypes} value={types} onChange={setTypes} /></FilterGroup>
        <FilterGroup label="By"><Chips options={people} value={who} onChange={setWho} /></FilterGroup>
      </FilterDrawer>
    </div>
  );
}

// ============================================================ replacements
// Production Heads report vendor failures (damage / loss) and ask for a
// replacement journey; the PM approves here. Same calls, popups and
// notification as ReplacementApprovals. No money is shown.
export function ReplacementList({ ctx }) {
  const { showPopup } = ctx;
  const currentUserEmail = ctx.email;
  const [pending, setPending] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState("old");
  const [failures, setFailures] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [who, setWho] = useState([]);

  const load = useCallback(async () => {
    try { setPending((await fetchPendingReplacements()) || []); }
    catch (e) { console.error("Failed to load replacement requests:", e); setPending((prev) => prev || []); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refreshDashboard = (orderId) => { if (orderId && ctx.reloadOrder) ctx.reloadOrder(orderId)?.catch?.(() => {}); };

  const doApprove = async (req) => {
    setBusyId(req.id);
    try {
      const res = await approveReplacementJourney({ requestId: req.id, approvedBy: currentUserEmail });
      if (res?.success) {
        showPopup({ title: "Approved", message: res.message || "Replacement journey approved.", type: "success", confirmText: "OK" });
        // Notify the COO (via the notification map) + the requesting Production Head.
        try {
          const { sendNotification, NOTIFICATION_TYPES } = await import("../../utils/notificationService");
          await sendNotification(NOTIFICATION_TYPES.REPLACEMENT_APPROVED, {
            orderId: req.order_id,
            orderNo: req.order_no || "",
            metadata: { barcode: req.barcode, vendor_name: req.vendor_name, cost_loss: req.cost_loss },
            extraRecipients: req.requested_by ? [{ email: req.requested_by.toLowerCase(), channel: "in_app" }] : [],
          });
        } catch (notifErr) { console.error("Replacement-approved notification failed:", notifErr); }
        load();
        refreshDashboard(req.order_id);
      } else {
        showPopup({ title: "Failed", message: res?.error || "Could not approve.", type: "error", confirmText: "OK" });
      }
    } catch (e) {
      showPopup({ title: "Error", message: e.message || "Approve failed", type: "error", confirmText: "OK" });
    }
    setBusyId(null);
  };

  const doReject = async (req) => {
    setBusyId(req.id);
    try {
      await rejectReplacementJourney({ requestId: req.id, approvedBy: currentUserEmail, reason: "Rejected by Production Manager" });
      showPopup({ title: "Rejected", message: "Replacement request rejected.", type: "info", confirmText: "OK" });
      load();
    } catch (e) {
      showPopup({ title: "Error", message: e.message || "Reject failed", type: "error", confirmText: "OK" });
    }
    setBusyId(null);
  };

  const all = useMemo(() => pending || [], [pending]);
  const choices = useMemo(() => ({
    failures: countBy(all, (r) => r.failure_type),
    vendors: countBy(all, (r) => r.vendor_name || "Not recorded"),
    who: countBy(all, (r) => r.requested_by || "Not recorded"),
  }), [all]);
  const list = useMemo(() => {
    const q = lc(search).trim();
    const out = all.filter((r) => pick(failures, r.failure_type) && pick(vendors, r.vendor_name || "Not recorded")
      && pick(who, r.requested_by || "Not recorded") && has(q, r.barcode, r.order_no, r.vendor_name));
    if (sort === "new") out.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return out;
  }, [all, search, failures, vendors, who, sort]);
  const active = [sort !== "old", failures.length, vendors.length, who.length].filter(Boolean).length;
  const clear = () => { setSort("old"); setFailures([]); setVendors([]); setWho([]); };
  const exportCsv = () => csvFromObjects("replacement requests", list.map((r) => ({
    Barcode: r.barcode || "", "Order No": r.order_no || "", Failure: r.failure_type || "", Vendor: r.vendor_name || "", Reason: r.reason || "",
    "Requested By": r.requested_by || "", "Requested On": stamp(r.created_at),
  })));

  return (
    <div className="pm-records">
      <p className="pmo-hint">Production Heads report vendor failures (damage or loss) and ask for a replacement journey. Approving sends the piece back to Cloth Issue, records it as a vendor loss, and updates the Vendor Failure Ledger.</p>
      <ListTools search={search} onSearch={setSearch} placeholder="Search barcode, order no or vendor" filters={active} onFilters={() => setOpen(true)} onExport={exportCsv} exportDisabled={!list.length} />
      <div className="ceo-dstats">
        <Stat label="Waiting" info="Replacement requests waiting for your approval, matching the filters."><b className={list.length ? "is-warn" : undefined}>{num(list.length)}</b></Stat>
        <Stat label="Vendors" info="Different vendors named in those requests."><b>{num(new Set(list.map((r) => r.vendor_name).filter(Boolean)).size)}</b></Stat>
        <Stat label="Oldest" info="When the oldest request was raised."><b>{list.length ? fmtDate(Math.min(...list.map((r) => new Date(r.created_at).getTime()))) : "–"}</b></Stat>
      </div>
      {!pending ? <Loading text="Loading replacement requests" /> : (
        <Paged list={list} render={(page) => (
          <Table rowKey={(r) => r.id} rows={page} empty={all.length ? "No replacement requests match your search." : "No replacement requests awaiting approval."}
            columns={[
              { key: "bc", label: "Barcode", render: (r) => <Code>{r.barcode}</Code> },
              { key: "fail", label: "Failure", render: (r) => (r.failure_type ? <Tag tone="urgent">{r.failure_type}</Tag> : <Dash />) },
              { key: "order", label: "Order", render: (r) => <span className="pm-nowrap">{r.order_no || "–"}</span> },
              { key: "vendor", label: "Vendor", render: (r) => r.vendor_name || <Dash /> },
              { key: "why", label: "Reason", render: (r) => <span className="pm-wrap">{r.reason || <Dash />}</span> },
              { key: "by", label: "Requested By", hide: true, render: (r) => <span className="pmo-break">{r.requested_by || "–"}</span> },
              { key: "at", label: "Requested On", right: true, render: (r) => <DateCell ts={r.created_at} /> },
              {
                key: "act", label: "Decision", right: true,
                render: (r) => (
                  <span className="pmo-row-btns">
                    <button type="button" className="ceo-btn" disabled={busyId === r.id} onClick={() => doReject(r)}>Reject</button>
                    <button type="button" className="ceo-btn is-primary" disabled={busyId === r.id} onClick={() => doApprove(r)}>{busyId === r.id ? "Working" : "Approve"}</button>
                  </span>
                ),
              },
            ]} />
        )} />
      )}
      <FilterDrawer open={open} onClose={() => setOpen(false)} onClear={clear} count={list.length} noun="requests" sub="Narrow the replacement requests">
        <FilterGroup label="Sort By">{sortChips([{ value: "old", label: "Oldest first" }, { value: "new", label: "Newest first" }], sort, setSort, "old")}</FilterGroup>
        <FilterGroup label="Failure"><Chips options={choices.failures} value={failures} onChange={setFailures} /></FilterGroup>
        <FilterGroup label="Vendor"><Chips options={choices.vendors} value={vendors} onChange={setVendors} /></FilterGroup>
        <FilterGroup label="Requested By"><Chips options={choices.who} value={who} onChange={setWho} /></FilterGroup>
      </FilterDrawer>
    </div>
  );
}
