import React, { useEffect, useMemo, useState } from "react";
import {
  fetchStageOverrides,
  getOverrideTypeLabel,
  getStageLabel,
  OVERRIDE_TYPE_LABELS,
} from "../utils/barcodeService";
import { usePeriodFilter } from "./PeriodFilter";
import Paginator from "./Paginator";
import formatDate from "../utils/formatDate";
import "./OverrideHistory.css";

/**
 * OverrideHistory — the audit trail for production overrides.
 *
 * An override bypasses the physical scan flow: a piece is advanced without
 * being scanned, a mandatory stage is skipped, a deadline is moved, or a piece
 * is declared back from a vendor without a gate scan. Each one is a deliberate
 * exception, so WHO made it, WHEN, and WHY is the whole point of the record.
 *
 * recordOverride() has been writing these to `stage_overrides` all along, but
 * nothing read the table back — the reason was captured and then invisible.
 * This is that missing half, shared by the PM, Admin and GM dashboards so the
 * three can't drift into different views of the same audit.
 *
 * Read-only by design. Overrides are performed in ProductionOverrides.jsx
 * (PM only); nothing here can create or amend a record — an audit trail that
 * its subject can edit is not an audit trail.
 */

const PER_PAGE = 20;

export default function OverrideHistory({ title = "Production Overrides" }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);

  // Scoped by when the override happened, via the app-wide period filter.
  const { control: periodControl, inPeriod, range: periodRange } =
    usePeriodFilter("all", { variant: "select", label: "Period:" });

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const data = await fetchStageOverrides();
      if (alive) {
        setRows(data);
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Only the types actually present — a dashboard that has never seen a
  // packaging override shouldn't offer it as a dead filter option.
  const presentTypes = useMemo(() => {
    const seen = new Set(rows.map((r) => r.override_type).filter(Boolean));
    return Object.keys(OVERRIDE_TYPE_LABELS).filter((t) => seen.has(t));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (periodRange && !inPeriod(r.created_at)) return false;
      if (typeFilter !== "all" && r.override_type !== typeFilter) return false;
      if (q) {
        const hay = [r.order_no, r.barcode, r.overridden_by, r.reason]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, typeFilter, periodRange, inPeriod]);

  useEffect(() => { setPage(1); }, [search, typeFilter, periodRange]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paged = useMemo(
    () => filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [filtered, page]
  );

  // Timestamp to the MINUTE, not just the date. "Who moved this and when" is
  // the question this table answers, and two overrides on one piece in one day
  // are indistinguishable without the time.
  const when = (ts) => {
    if (!ts) return "—";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "—";
    return `${formatDate(ts)} · ${d.toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", hour12: true,
    })}`;
  };

  if (loading) {
    return (
      <div className="ovh-wrap">
        <p className="ovh-muted">Loading overrides…</p>
      </div>
    );
  }

  return (
    <div className="ovh-wrap">
      <div className="ovh-head">
        <h2 className="ovh-title">{title}</h2>
        <span className="ovh-count">
          {filtered.length} override{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      <p className="ovh-note">
        Every override bypasses the normal scan flow, so each one is recorded
        with who made it, when, and why.
      </p>

      <div className="ovh-toolbar">
        <input
          className="ovh-search"
          type="text"
          placeholder="Search order no, barcode, person or reason…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="ovh-select"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="all">All types</option>
          {presentTypes.map((t) => (
            <option key={t} value={t}>{OVERRIDE_TYPE_LABELS[t]}</option>
          ))}
        </select>
        {periodControl}
      </div>

      {filtered.length === 0 ? (
        <p className="ovh-muted">
          {rows.length === 0
            ? "No overrides have been recorded."
            : "No overrides match these filters."}
        </p>
      ) : (
        <>
          <div className="ovh-table-wrap">
            <table className="ovh-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>By</th>
                  <th>Type</th>
                  <th>Order / Piece</th>
                  <th>Stage</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => (
                  <tr key={r.id}>
                    <td className="ovh-when">{when(r.created_at)}</td>
                    <td className="ovh-by">{r.overridden_by || "—"}</td>
                    <td>
                      <span className={`ovh-type ovh-type-${r.override_type || "other"}`}>
                        {getOverrideTypeLabel(r.override_type)}
                      </span>
                    </td>
                    <td>
                      <div className="ovh-order">{r.order_no || "—"}</div>
                      {r.barcode && <div className="ovh-barcode">{r.barcode}</div>}
                    </td>
                    <td className="ovh-stage">
                      {/* A timeline extension doesn't move a stage; showing
                          "X → X" for it would read as a transition that never
                          happened. Show the day count instead. */}
                      {r.override_type === "timeline_extension" ? (
                        <span className="ovh-days">
                          {r.extended_days ? `+${r.extended_days} day${r.extended_days === 1 ? "" : "s"}` : "—"}
                        </span>
                      ) : r.from_stage && r.to_stage && r.from_stage !== r.to_stage ? (
                        <>
                          {getStageLabel(r.from_stage)}
                          <span className="ovh-arrow">→</span>
                          {getStageLabel(r.to_stage)}
                        </>
                      ) : (
                        getStageLabel(r.from_stage || r.to_stage) || "—"
                      )}
                    </td>
                    {/* The reason is the point of the row — never truncated. */}
                    <td className="ovh-reason">{r.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginator page={page} totalPages={totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}
