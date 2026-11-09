import React, { useEffect, useMemo, useState } from "react";
import ComponentStageBadge from "./ComponentStageBadge";
import formatDate from "../utils/formatDate";
import {
  STAGE_GROUPS,
  getStageGroupKey,
  getStageLabel,
  getStageMaxDays,
  getStagesOutsideLabel,
  describeTransition,
  buildStagePassMap,
  fetchTransitionHistory,
  fetchMovementHistory,
} from "../utils/barcodeService";
import ScanKindTag from "./ScanKindTag";
import FactoryBadge from "./FactoryBadge";
import { MoveToHalfMadeModal, UseHalfMadeModal } from "./HalfMadeModals";
import { supabase } from "../lib/supabaseClient";
import { fetchMyRole, isProductionRole } from "../utils/halfMade";
import "./ComponentJourneyModal.css";

/**
 * ComponentJourneyModal — the full production journey of an order's components.
 *
 * Layout: the order at a glance (pieces finished / in production / not
 * started / at vendors) on top; one card per piece on the left with how far
 * along it is; for the selected piece, a step line (done / current / to come /
 * skipped), key facts, vendor trips as cards and the scan history grouped by
 * day with the time each step took. Security-gate steps read "Sent to Vendor" /
 * "Returned to Warehouse" (the gate doesn't change the stage). Fetches its own
 * transition + movement data.
 *
 * Shared by the Warehouse (retail PH) and B2B Production dashboards so the
 * journey view stays identical everywhere.
 *
 * @param {string}   orderNo     order number for the modal title
 * @param {object[]} components  the order's components (id, barcode, labels, stage, vendor fields)
 * @param {Function} onClose     close handler
 */

// For a component currently out at a vendor, build the "At [vendor] · due
// [date]" tag. The due-back date is the ACTUAL return_date the PH configured on
// the current (exited) movement — the same date shown in Vendor History — so
// the tag and the table agree. Falls back to vendor_exit_at + the stage's
// allowed days only when no movement return_date is available.
const getVendorTagInfo = (comp, movements = []) => {
  if (!comp?.is_outside_wh) return null;
  const vendor = comp.vendor_name || "Vendor";

  // The trip it's currently out on (most recent 'exited' movement).
  const activeMov = (movements || [])
    .filter((m) => m.status === "exited")
    .sort((a, b) => new Date(b.exit_scan_at || b.created_at || 0) - new Date(a.exit_scan_at || a.created_at || 0))[0];

  let due = null;
  if (activeMov?.return_date) {
    due = new Date(activeMov.return_date);
  } else {
    // Fallback: derive from exit + stage SLA.
    const maxDays = getStageMaxDays(comp.current_stage);
    const exit = comp.vendor_exit_at ? new Date(comp.vendor_exit_at) : null;
    if (exit && !isNaN(exit.getTime()) && maxDays != null) {
      due = new Date(exit);
      due.setDate(due.getDate() + maxDays);
    }
  }

  if (!due || isNaN(due.getTime())) {
    return { text: `At ${vendor}`, overdue: false };
  }

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOfDay(due) - startOfDay(new Date())) / 86400000);

  if (diffDays < 0) {
    const od = Math.abs(diffDays);
    return { text: `At ${vendor} · ${od} day${od === 1 ? "" : "s"} overdue`, overdue: true };
  }
  return { text: `At ${vendor} · due ${formatDate(due)}`, overdue: false };
};

// ------------------------------------------------------------ presentation helpers
// Everything below only changes how the journey is SHOWN; the data, the
// vendor tag rule and the Half Made actions are unchanged.

const DONE_STAGES = new Set(["production_complete", "packaging_dispatch", "dispatched"]);
const STOPPED_STAGES = new Set(["disposed", "scrapped"]);
const STEP_LIST = STAGE_GROUPS; // ordered: Order Received … Packaging & Dispatch

/** Index of a raw stage on the step line (Order Received = 0), or -1 if off the line. */
const stepIndexOf = (stage) => {
  if (!stage) return -1;
  if (stage === "order_received") return 0;
  const key = getStageGroupKey(stage);
  return key ? STEP_LIST.findIndex((g) => g.key === key) : -1;
};

/** "3d 4h", "5h 20m", "12m", "just now". */
const fmtSpan = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "under a minute";
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return mm ? `${h}h ${mm}m` : `${h}h`;
  return `${mm}m`;
};
const dayCount = (from, to = new Date()) => {
  if (!from) return null;
  const a = new Date(from), b = new Date(to);
  if (isNaN(a.getTime())) return null;
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.max(0, Math.round((start(b) - start(a)) / 86400000));
};
const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const dayHeading = (ts) => {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return "Today";
  if (dayKey(d) === dayKey(yest)) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
};
const timeOf = (ts) => new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Where a piece stands, in one line, plus how far along it is (0–100). */
const pieceStatus = (c, movements) => {
  const stopped = STOPPED_STAGES.has(c.current_stage);
  const idx = stopped ? stepIndexOf(c.previous_stage) : stepIndexOf(c.current_stage);
  const last = STEP_LIST.length - 1;
  // A finished piece (production complete, packed or dispatched) reads 100%.
  const pct = DONE_STAGES.has(c.current_stage) ? 100 : idx < 0 ? 0 : Math.round((idx / last) * 100);
  const vendor = c.is_outside_wh ? getVendorTagInfo(c, movements) : null;
  return {
    idx, pct, stopped, vendor,
    done: DONE_STAGES.has(c.current_stage),
    notStarted: c.current_stage === "order_received",
    label: stopped
      ? (c.disposition === "scrap" || c.current_stage === "scrapped" ? "Scrapped" : "Disposed")
      : getStageLabel(c.current_stage),
  };
};

/** The steps this piece actually passed through: its scans, plus the stages
 *  it was sent out to a vendor for (those happen outside, without a scan). */
const visitedSteps = (transitions, movements) => {
  const seen = new Set();
  (transitions || []).forEach((t) => {
    [t.from_stage, t.to_stage].forEach((s) => { const i = stepIndexOf(s); if (i >= 0) seen.add(i); });
  });
  (movements || []).forEach((m) => {
    (Array.isArray(m.stages_outside) ? m.stages_outside : []).forEach((n) => {
      const i = STEP_LIST.findIndex((g) => g.step === Number(n) && g.external);
      if (i >= 0) seen.add(i);
    });
  });
  return seen;
};

/** For each step: when the piece first reached it, how long it spent there in
 *  all, and the vendor it went to for it (if any). */
const stageStats = (transitions, movements, comp) => {
  const out = {};
  const at = (i) => (out[i] || (out[i] = { firstAt: null, ms: 0, vendor: null }));
  const ts = transitions || [];
  const live = !DONE_STAGES.has(comp.current_stage) && !STOPPED_STAGES.has(comp.current_stage) && !comp.cancelled_at;
  ts.forEach((t, k) => {
    const i = stepIndexOf(t.to_stage);
    if (i < 0) return;
    const s = at(i);
    const when = new Date(t.scanned_at).getTime();
    if (!s.firstAt || when < s.firstAt) s.firstAt = when;
    const next = ts[k + 1] ? new Date(ts[k + 1].scanned_at).getTime() : (live ? Date.now() : when);
    s.ms += Math.max(0, next - when);
  });
  (movements || []).forEach((m) => {
    (Array.isArray(m.stages_outside) ? m.stages_outside : []).forEach((n) => {
      const i = STEP_LIST.findIndex((g) => g.step === Number(n) && g.external);
      if (i < 0) return;
      const s = at(i);
      const when = m.exit_scan_at ? new Date(m.exit_scan_at).getTime() : null;
      if (when && (!s.firstAt || when < s.firstAt)) s.firstAt = when;
      s.vendor = m.vendor_name || s.vendor;
    });
  });
  return out;
};
const shortDate = (ms) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const PersonIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="8" r="3.6" /><path d="M5 20c.8-3.8 3.6-5.6 7-5.6s6.2 1.8 7 5.6" strokeLinecap="round" /></svg>
);
const StationIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M11 8v8M14 8v8M17 8v8" strokeLinecap="round" /></svg>
);

const ComponentJourneyModal = ({ orderNo, components = [], onClose }) => {
  const [journeyData, setJourneyData] = useState([]); // [{ component, transitions, movements }]
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  // Half Made Inventory (Release 15): production logins can move a piece out
  // to it, or let a not-started piece continue from a half-made one.
  const [me, setMe] = useState({ email: null, role: null });
  const [halfMade, setHalfMade] = useState(null);   // { mode: "move" | "use", component }
  const [reloadKey, setReloadKey] = useState(0);
  const [newestFirst, setNewestFirst] = useState(true);
  useEffect(() => { fetchMyRole().then(setMe).catch(() => {}); }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // After a Half Made action the caller's rows are stale — re-read them
        // (only then; the first load uses what the caller passed).
        let rows = components;
        if (reloadKey > 0 && components.length) {
          const { data: fresh } = await supabase.from("order_components").select("*")
            .in("id", components.map((c) => c.id));
          const byId = Object.fromEntries((fresh || []).map((f) => [f.id, f]));
          rows = components.map((c) => ({ ...c, ...(byId[c.id] || {}) }));
        }
        const data = await Promise.all(
          rows.map(async (component) => {
            let transitions = [];
            let movements = [];
            try {
              [transitions, movements] = await Promise.all([
                fetchTransitionHistory(component.id),
                fetchMovementHistory(component.id),
              ]);
            } catch (e) { console.error("journey fetch failed for", component.barcode, e); }
            return { component, transitions: transitions || [], movements: movements || [] };
          })
        );
        if (cancelled) return;
        setJourneyData(data);
        setSelectedId((prev) => (prev && data.some((d) => d.component.id === prev) ? prev : data[0]?.component?.id || null));
      } catch (err) {
        console.error("Failed to load journey:", err);
        if (!cancelled) setJourneyData([]);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [components, reloadKey]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !halfMade) onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, halfMade]);

  // The caller's component rows may be stale (and miss fields): read the piece
  // fresh before acting on it, and reflect the result after.
  const openHalfMade = async (mode, comp) => {
    const { data } = await supabase.from("order_components")
      .select("id, order_id, order_no, barcode, component_type, component_label, item_index, current_stage, is_active, is_outside_wh, cancelled_at")
      .eq("id", comp.id).maybeSingle();
    if (data) setHalfMade({ mode, component: data });
  };

  const selected = journeyData.find((d) => d.component.id === selectedId) || journeyData[0];

  // Pass number per timeline row, rebuilt from the selected component's own
  // scan history so a re-journeyed stage reads "Cloth Issued (2)" on the row
  // itself — matching the badge above, which only ever shows the current pass.
  const passMap = useMemo(
    () => buildStagePassMap(selected?.transitions),
    [selected?.transitions]
  );

  // The whole order at a glance.
  const summary = useMemo(() => {
    const s = { pieces: journeyData.length, done: 0, atVendor: 0, overdue: 0, notStarted: 0, stopped: 0 };
    journeyData.forEach(({ component: c, movements }) => {
      const st = pieceStatus(c, movements);
      if (st.done) s.done += 1;
      if (st.notStarted) s.notStarted += 1;
      if (st.stopped) s.stopped += 1;
      if (st.vendor) { s.atVendor += 1; if (st.vendor.overdue) s.overdue += 1; }
    });
    return s;
  }, [journeyData]);

  // The selected piece's scans, each with the time it took since the scan
  // before it, grouped by day.
  const days = useMemo(() => {
    const ts = selected?.transitions || [];
    const rows = ts.map((t, i) => ({
      t,
      gap: i > 0 ? new Date(t.scanned_at) - new Date(ts[i - 1].scanned_at) : null,
    }));
    if (newestFirst) rows.reverse();
    const groups = [];
    rows.forEach((r) => {
      const k = dayKey(r.t.scanned_at);
      const g = groups[groups.length - 1];
      if (g && g.key === k) g.rows.push(r);
      else groups.push({ key: k, heading: dayHeading(r.t.scanned_at), rows: [r] });
    });
    return groups;
  }, [selected?.transitions, newestFirst]);

  return (
    <>
    {halfMade?.mode === "move" && (
      <MoveToHalfMadeModal component={halfMade.component} orderNo={orderNo} by={me.email}
        onClose={() => setHalfMade(null)} onDone={() => setReloadKey((k) => k + 1)} />
    )}
    {halfMade?.mode === "use" && (
      <UseHalfMadeModal component={halfMade.component} orderNo={orderNo} by={me.email}
        onClose={() => setHalfMade(null)} onDone={() => setReloadKey((k) => k + 1)} />
    )}
    <div className="cjm-overlay" onClick={onClose}>
      <div className="cjm-modal" role="dialog" aria-modal="true" aria-label={`Production journey ${orderNo || ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="cjm-head">
          <div className="cjm-head-text">
            <span className="cjm-eyebrow">Production Journey</span>
            <h3 className="cjm-title">{orderNo}</h3>
          </div>
          <button className="cjm-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {loading ? (
          <div className="cjm-empty"><span className="cjm-spinner" />Loading journey…</div>
        ) : journeyData.length === 0 ? (
          <p className="cjm-empty">No pieces found for this order.</p>
        ) : (
          <>
            {/* The order at a glance */}
            <div className="cjm-summary">
              <div className="cjm-sum"><b>{summary.pieces}</b><span>{summary.pieces === 1 ? "Piece" : "Pieces"}</span></div>
              <div className="cjm-sum"><b>{summary.done}</b><span>Finished</span></div>
              <div className="cjm-sum"><b>{summary.pieces - summary.done - summary.notStarted - summary.stopped}</b><span>In Production</span></div>
              <div className="cjm-sum"><b>{summary.notStarted}</b><span>Not Started</span></div>
              <div className={`cjm-sum ${summary.overdue ? "is-alert" : ""}`}>
                <b>{summary.atVendor}</b>
                <span>At Vendors{summary.overdue ? ` · ${summary.overdue} overdue` : ""}</span>
              </div>
              {summary.stopped > 0 && <div className="cjm-sum is-alert"><b>{summary.stopped}</b><span>Disposed / Scrapped</span></div>}
            </div>

            <div className="cjm-body">
              {/* Left: one card per piece, with how far along it is */}
              <div className="cjm-pieces">
                <p className="cjm-pieces-title">{journeyData.length > 1 ? "Pieces · choose one" : "Piece"}</p>
                {journeyData.map(({ component: c, movements: cm }) => {
                  const st = pieceStatus(c, cm);
                  const active = selected?.component.id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`cjm-piece ${active ? "active" : ""} ${st.stopped ? "is-stopped" : ""}`}
                      onClick={() => setSelectedId(c.id)}
                    >
                      <span className="cjm-piece-top">
                        <span className="cjm-piece-name">{c.component_label || c.component_type}</span>
                        <span className="cjm-piece-pct">{st.stopped ? "—" : `${st.pct}%`}</span>
                      </span>
                      <span className="cjm-piece-bc">{c.barcode}</span>
                      <span className="cjm-bar"><span style={{ width: `${st.stopped ? 0 : st.pct}%` }} /></span>
                      <span className="cjm-piece-stage">{st.label}</span>
                      {st.vendor && (
                        <span className={`cjm-piece-flag ${st.vendor.overdue ? "is-overdue" : ""}`}>{st.vendor.text}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Right: the selected piece */}
              <div className="cjm-detail">
                {selected && (() => {
                  const c = selected.component;
                  const transitions = selected.transitions;
                  const movements = selected.movements || [];
                  const st = pieceStatus(c, movements);
                  const visited = visitedSteps(transitions, movements);
                  // When the piece is physically out at a vendor, show "Out to
                  // Vendor (<stage>)" (the stage it went out for, from the active
                  // exited movement) instead of the raw current_stage.
                  const badgeComp = c.is_outside_wh
                    ? { ...c, stages_outside: movements.find((m) => m.status === "exited")?.stages_outside ?? c.stages_outside }
                    : c;
                  const firstScan = transitions[0]?.scanned_at;
                  const lastScan = transitions[transitions.length - 1]?.scanned_at;
                  const stageSince = c.stage_updated_at || lastScan;
                  const rework = transitions.filter((t) => t.transition_type === "rejourney").length;
                  const manual = transitions.filter((t) => t.transition_type === "manual_override").length;
                  const finishedAt = st.done
                    ? transitions.find((t) => DONE_STAGES.has(t.to_stage))?.scanned_at
                    : null;
                  const sinceStart = firstScan ? dayCount(firstScan, finishedAt || new Date()) : null;
                  return (
                    <>
                      <div className="cjm-comp-head">
                        <div className="cjm-comp-id">
                          <span className="cjm-comp-name">{c.component_label || c.component_type}</span>
                          <span className="cjm-comp-bc">{c.barcode}</span>
                        </div>
                        {/* Shared badge so the stage text (and the re-journey
                            pass number) matches every dashboard. */}
                        <ComponentStageBadge comp={badgeComp} />
                        {st.vendor && (
                          <span className={`cjm-vendor-now ${st.vendor.overdue ? "cjm-overdue" : ""}`}>{st.vendor.text}</span>
                        )}
                      </div>

                      {/* Disposed / scrapped: show the stage it was removed at and why */}
                      {st.stopped && (
                        <div className="cjm-disposed-line">
                          <strong>
                            {st.label}
                            {c.previous_stage ? ` at ${getStageLabel(c.previous_stage).replace(/ In-Progress$/, "")}` : ""}
                          </strong>
                          {c.disposition_reason ? <span className="cjm-disposed-reason"> · Reason: {c.disposition_reason}</span> : null}
                        </div>
                      )}

                      {/* The stage map: every step in order, each saying whether
                          it is done (with the date and the time spent), where the
                          piece is now, not needed, or still to come. */}
                      <section className="cjm-section cjm-section-first">
                        <div className="cjm-section-row">
                          <p className="cjm-section-title">Stages</p>
                          <span className="cjm-legend">
                            <span><i className="is-done" />Done</span><span><i className="is-current" />Now</span><span><i className="is-skipped" />Not needed</span><span><i className="is-todo" />To come</span>
                          </span>
                        </div>
                        <ol className="cjm-map">
                          {(() => {
                            const stats = stageStats(transitions, movements, c);
                            let nextMarked = false;
                            return STEP_LIST.map((g, i) => {
                              const isCurrent = i === st.idx && !st.stopped && c.current_stage !== "dispatched";
                              const isDone = c.current_stage === "dispatched" ? true : i < st.idx || (st.stopped && i <= st.idx);
                              const skipped = isDone && !visited.has(i) && i > 0;
                              const state = isCurrent ? "current" : isDone ? (skipped ? "skipped" : "done") : "todo";
                              const isNext = state === "todo" && !nextMarked && !st.stopped;
                              if (isNext) nextMarked = true;
                              const info = stats[i];
                              const word = state === "current" ? (st.done ? "Finished" : c.is_outside_wh ? "Now · at vendor" : "Now")
                                : state === "done" ? "Done" : state === "skipped" ? "Not needed" : isNext ? "Up next" : "To come";
                              return (
                                <li key={g.key} className={`cjm-stop is-${state}${isNext ? " is-next" : ""}`}>
                                  <span className="cjm-stop-top">
                                    <span className="cjm-stop-num">{state === "done" ? "✓" : i === 0 ? "•" : i}</span>
                                    <span className="cjm-stop-word">{word}</span>
                                  </span>
                                  <span className="cjm-stop-name">{g.label}</span>
                                  <span className="cjm-stop-foot">
                                    {state === "done" && info?.firstAt && <>{shortDate(info.firstAt)}{info.ms >= 60000 ? ` · ${fmtSpan(info.ms)}` : ""}</>}
                                    {state === "current" && (st.done
                                      ? (info?.firstAt ? `Finished ${shortDate(info.firstAt)}` : "Finished")
                                      : st.notStarted ? "Waiting to start"
                                      : info?.ms >= 60000 ? `Here ${fmtSpan(info.ms)}` : "Just arrived")}
                                    {state === "skipped" && "Skipped for this piece"}
                                    {state === "todo" && "\u00a0"}
                                  </span>
                                  {info?.vendor && (state === "done" || state === "current") && <span className="cjm-stop-vendor">{info.vendor}</span>}
                                </li>
                              );
                            });
                          })()}
                        </ol>
                      </section>

                      {/* Key facts */}
                      <div className="cjm-facts">
                        <div className="cjm-fact">
                          <span>{st.done ? "Took" : "Since First Scan"}</span>
                          <b>{sinceStart == null ? "Not started" : plural(sinceStart, "day")}</b>
                          {firstScan && <small>Started {formatDate(firstScan)}</small>}
                        </div>
                        <div className="cjm-fact">
                          <span>At This Stage</span>
                          <b>{st.done || st.stopped || !stageSince ? "—" : fmtSpan(new Date() - new Date(stageSince))}</b>
                          {!st.done && !st.stopped && stageSince && <small>Since {formatDate(stageSince)}</small>}
                        </div>
                        <div className="cjm-fact">
                          <span>Vendor Trips</span>
                          <b>{movements.length}</b>
                          {movements.length > 0 && <small>{movements.filter((m) => m.status === "returned").length} returned</small>}
                        </div>
                        <div className="cjm-fact">
                          <span>Re-work Passes</span>
                          <b>{rework}</b>
                          <small>{plural(transitions.length, "scan")}{manual ? ` · ${manual} manual` : ""}</small>
                        </div>
                      </div>

                      {/* Half Made Inventory (Release 15) — production only. */}
                      {isProductionRole(me.role) && !c.cancelled_at && c.current_stage !== "dispatched" && (
                        <div className="cjm-hm-actions">
                          <button type="button" className="cjm-hm-btn" onClick={() => openHalfMade("move", c)}>
                            Move to Half Made
                          </button>
                          {c.current_stage === "order_received" && !c.is_active && (
                            <button type="button" className="cjm-hm-btn" onClick={() => openHalfMade("use", c)}>
                              Use Half Made piece
                            </button>
                          )}
                        </div>
                      )}

                      {/* Vendor trips — every time this piece left the warehouse */}
                      {movements.length > 0 && (
                        <section className="cjm-section">
                          <p className="cjm-section-title">Vendor Trips</p>
                          <div className="cjm-trips">
                            {movements.map((m) => {
                              const out = m.exit_scan_at ? new Date(m.exit_scan_at) : null;
                              const back = m.entry_scan_at ? new Date(m.entry_scan_at) : null;
                              const due = m.return_date ? new Date(m.return_date) : null;
                              const daysOut = out ? dayCount(out, back || new Date()) : null;
                              const late = due && m.status === "exited" && dayCount(due) > 0;
                              const lateBack = due && back && dayCount(due, back) > 0;
                              return (
                                <div key={m.id} className={`cjm-trip ${late ? "is-late" : ""}`}>
                                  <div className="cjm-trip-top">
                                    <span className="cjm-trip-vendor">
                                      {m.vendor_name || "—"}
                                      {m.vendor_location ? <small> · {m.vendor_location}</small> : null}
                                    </span>
                                    <span className={`cjm-vhs cjm-vhs-${m.status}`}>
                                      {m.status === "exited" ? "Out" : m.status === "returned" ? "Returned" : m.status === "configured" ? "Ready to send" : m.status}
                                    </span>
                                  </div>
                                  <div className="cjm-trip-stage">{getStagesOutsideLabel(m.stages_outside) || "—"}</div>
                                  <div className="cjm-trip-dates">
                                    <span><small>Sent</small>{out ? formatDate(out) : "—"}</span>
                                    <span className="cjm-trip-arrow">→</span>
                                    <span><small>Returned</small>{back ? formatDate(back) : "—"}</span>
                                    <span><small>Due</small>{due ? formatDate(due) : "—"}</span>
                                  </div>
                                  <div className="cjm-trip-foot">
                                    {daysOut != null && <span>{back ? "Was out" : "Out for"} {plural(daysOut, "day")}</span>}
                                    {late && <span className="cjm-late">{plural(dayCount(due), "day")} overdue</span>}
                                    {lateBack && <span className="cjm-late">Came back {plural(dayCount(due, back), "day")} late</span>}
                                  </div>
                                  {/* Why the piece went BACK to a vendor it had already
                                      been to (80_repeat_vendor_reason). */}
                                  {m.repeat_reason ? <div className="cjm-repeat-reason">↩ Sent back: {m.repeat_reason}</div> : null}
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      )}

                      <section className="cjm-section">
                        <div className="cjm-section-row">
                          <p className="cjm-section-title">Scan History</p>
                          {transitions.length > 1 && (
                            <button type="button" className="cjm-sort" onClick={() => setNewestFirst((v) => !v)}>
                              {newestFirst ? "Newest first" : "Oldest first"} ⇅
                            </button>
                          )}
                        </div>
                        {transitions.length === 0 ? (
                          <p className="cjm-empty-inline">Not started yet — no scans recorded.</p>
                        ) : (
                          days.map((day) => (
                            <div key={day.key} className="cjm-day">
                              <div className="cjm-day-head"><b>{day.heading}</b><span>{plural(day.rows.length, "scan")}</span></div>
                              <div className="cjm-scans">
                                {day.rows.map(({ t, gap }, k) => {
                                  // Shared classifier: internal production scan vs external
                                  // vendor movement (+ headline). The security gate doesn't
                                  // change the stage, so it reads "Sent to Vendor (Dyeing)".
                                  const d = describeTransition(t, movements, passMap);
                                  const tone = t.transition_type === "rejourney" || /failed/.test(t.to_stage || "")
                                    ? "warn"
                                    : d.kind === "external" ? "ext" : DONE_STAGES.has(t.to_stage) ? "done" : "";
                                  const typeWord = d.showType ? String(t.transition_type || "").replace(/_/g, " ") : null;
                                  // Time between this scan and the one before it in time,
                                  // shown between the two cards.
                                  const between = gap != null && gap >= 60000 ? fmtSpan(gap) : null;
                                  return (
                                    <React.Fragment key={t.id}>
                                      {!newestFirst && between && <div className="cjm-between"><span>{between} later</span></div>}
                                      <div className={`cjm-scan${tone ? ` is-${tone}` : ""}${k === day.rows.length - 1 ? " is-last" : ""}`}>
                                        <span className="cjm-scan-rail"><span className="cjm-scan-dot" /></span>
                                        <div className="cjm-scan-card">
                                          <div className="cjm-scan-head">
                                            <span className="cjm-scan-time">{timeOf(t.scanned_at)}</span>
                                            <span className="cjm-scan-title">{d.headline}</span>
                                            <ScanKindTag kind={d.kind} />
                                          </div>
                                          <div className="cjm-scan-meta">
                                            <span className="cjm-chip"><PersonIcon />{t.scanned_by || "Unknown"}</span>
                                            {t.station_name && <span className="cjm-chip"><StationIcon />{t.station_name}</span>}
                                            <FactoryBadge factory={t.factory} />
                                            {typeWord && <span className="cjm-chip is-type">{typeWord}</span>}
                                          </div>
                                          {t.notes && <p className="cjm-scan-note">{t.notes}</p>}
                                        </div>
                                      </div>
                                      {newestFirst && between && <div className="cjm-between"><span>{between} after the scan below</span></div>}
                                    </React.Fragment>
                                  );
                                })}
                              </div>
                            </div>
                          ))
                        )}
                      </section>
                    </>
                  );
                })()}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
    </>
  );
};

export default ComponentJourneyModal;
