import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { normalizeStore } from "../../utils/storeCategory";
import Paginator from "../Paginator";
import {
  buildOrderPhoneSet,
  isAutoConverted,
  effectiveConverted,
  conversionSource,
  reconcileConversions,
  setManualConversion,
} from "../../utils/walkinConversion";
import "./WalkInsView.css";

/**
 * WalkInsView — all-SA walk-in registrations with conversion tracking,
 * location split (Delhi/Ludhiana), search/filters, and CSV export.
 *
 * Shared by the Admin and Assistant CMO dashboards so the feature stays in
 * one place. The host dashboard already loads `orders` (for conversion
 * auto-detection) and `salespersonTable` (to derive each walk-in's location
 * from its SA's store), and passes them in.
 *
 * @param {Array}    orders            all orders (used to match walk-in phones → converted)
 * @param {Array}    salespersonTable  salesperson rows with { email, store_name }
 * @param {Function} showPopup         popup helper for error toasts
 */
export default function WalkInsView({ orders = [], salespersonTable = null, showPopup }) {
  const [walkins, setWalkins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [saFilter, setSaFilter] = useState("");
  const [convFilter, setConvFilter] = useState("all"); // all | converted | not_converted
  const [locFilter, setLocFilter] = useState("all"); // all | Delhi | Ludhiana
  const [orderPhoneSet, setOrderPhoneSet] = useState(() => new Set());
  const [togglingId, setTogglingId] = useState(null);
  // Salesperson rows (email → store) drive the location split. The host may
  // pass them in; if not, the component fetches them itself so it works
  // standalone on any dashboard.
  const [fetchedSalespeople, setFetchedSalespeople] = useState([]);
  const salespeople = salespersonTable && salespersonTable.length > 0 ? salespersonTable : fetchedSalespeople;

  useEffect(() => {
    if (salespersonTable && salespersonTable.length > 0) return; // host provided them
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("salesperson").select("email, store_name");
      if (!cancelled && data) setFetchedSalespeople(data);
    })();
    return () => { cancelled = true; };
  }, [salespersonTable]);

  // Load all SAs' walk-ins once on mount, then reconcile auto-conversions
  // against every order's delivery_phone.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("walkins")
          .select("id, created_at, sa_email, name, country_code, phone, email, source, converted, converted_manual, converted_at")
          .order("created_at", { ascending: false });
        if (error) throw error;
        const phoneSet = buildOrderPhoneSet(orders);
        const reconciled = await reconcileConversions(data || [], phoneSet);
        if (cancelled) return;
        setOrderPhoneSet(phoneSet);
        setWalkins(reconciled);
      } catch (err) {
        console.error("Failed to load walk-ins:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [orders]);

  // Distinct SA emails for the SA filter dropdown.
  const saOptions = useMemo(() => {
    const set = new Set();
    walkins.forEach((w) => { if (w.sa_email) set.add(w.sa_email); });
    return Array.from(set).sort();
  }, [walkins]);

  // SA email → normalized store ("Delhi"/"Ludhiana"/"Other"). Walk-ins have no
  // location of their own, so it's derived from the SA's store_name.
  const saLocationByEmail = useMemo(() => {
    const map = {};
    (salespeople || []).forEach((sp) => {
      if (!sp.email) return;
      map[sp.email.toLowerCase()] = normalizeStore(sp.store_name) || "Other";
    });
    return map;
  }, [salespeople]);

  const walkinLocation = (w) =>
    saLocationByEmail[(w.sa_email || "").toLowerCase()] || "Other";

  // Walk-ins after SA + conversion + location filters + free-text search.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return walkins.filter((w) => {
      if (saFilter && w.sa_email !== saFilter) return false;
      if (locFilter !== "all" && walkinLocation(w) !== locFilter) return false;
      if (convFilter !== "all") {
        const want = convFilter === "converted";
        if (effectiveConverted(w, orderPhoneSet) !== want) return false;
      }
      if (!q) return true;
      return (
        (w.name || "").toLowerCase().includes(q) ||
        (w.phone || "").toLowerCase().includes(q) ||
        (w.email || "").toLowerCase().includes(q) ||
        (w.sa_email || "").toLowerCase().includes(q) ||
        (w.source || "").toLowerCase().includes(q)
      );
    });
  }, [walkins, search, saFilter, convFilter, locFilter, orderPhoneSet, saLocationByEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  // Page within the filtered set; filter changes reset to page 1.
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, saFilter, convFilter, locFilter]);
  const totalPages = Math.ceil(filtered.length / 15);
  const paged = useMemo(() => filtered.slice((page - 1) * 15, page * 15), [filtered, page]);

  const convertedCount = useMemo(
    () => walkins.filter((w) => effectiveConverted(w, orderPhoneSet)).length,
    [walkins, orderPhoneSet]
  );

  // Location-wise { total, converted } stats for the summary cards.
  const stats = useMemo(() => {
    const blank = () => ({ total: 0, converted: 0 });
    const s = { Total: blank(), Delhi: blank(), Ludhiana: blank(), Other: blank() };
    walkins.forEach((w) => {
      const loc = walkinLocation(w);
      const isConv = effectiveConverted(w, orderPhoneSet);
      s.Total.total += 1;
      if (isConv) s.Total.converted += 1;
      const bucket = s[loc] || s.Other;
      bucket.total += 1;
      if (isConv) bucket.converted += 1;
    });
    return s;
  }, [walkins, orderPhoneSet, saLocationByEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

  // Manual conversion override — flips effective status, clearing the override
  // when it matches auto-detection so it tracks automatically again.
  const handleToggleConverted = async (w) => {
    const auto = isAutoConverted(w, orderPhoneSet);
    const currentlyConverted = effectiveConverted(w, orderPhoneSet);
    const desired = !currentlyConverted;
    const nextManual = desired === auto ? null : desired;
    setTogglingId(w.id);
    try {
      const patch = await setManualConversion(w.id, nextManual, auto);
      setWalkins((prev) => prev.map((x) => (x.id === w.id ? { ...x, ...patch } : x)));
    } catch (err) {
      showPopup?.({ title: "Update failed", message: err.message || "Could not update conversion status.", type: "error" });
    } finally {
      setTogglingId(null);
    }
  };

  // CSV export of the currently filtered walk-ins.
  const handleExport = () => {
    if (filtered.length === 0) return;
    const headers = ["Date", "SA Email", "Location", "Name", "Phone", "Email", "Source", "Converted"];
    const rows = filtered.map((w) => [
      w.created_at ? new Date(w.created_at).toLocaleString("en-GB") : "",
      w.sa_email || "",
      walkinLocation(w),
      w.name || "",
      `${w.country_code || ""} ${w.phone || ""}`.trim(),
      w.email || "",
      w.source || "",
      effectiveConverted(w, orderPhoneSet) ? "Yes" : "No",
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`));
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `walkins_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="wiv-root">
      <h2 className="wiv-section-title">Walk-Ins</h2>

      {/* Summary: total + conversion, split by location (derived from SA store). */}
      <div className="wiv-stats-grid">
        {["Total", "Delhi", "Ludhiana", "Other"].map((loc) => {
          const s = stats[loc] || { total: 0, converted: 0 };
          // Hide the "Other" card when empty so it doesn't clutter the row.
          if (loc === "Other" && s.total === 0) return null;
          return (
            <div className="wiv-stat-card" key={loc}>
              <span className="wiv-stat-label">{loc === "Total" ? "Total Walk-Ins" : loc}</span>
              <span className="wiv-stat-value">{s.total}</span>
              <span className="wiv-stat-sub">{s.converted} converted · {pct(s.converted, s.total)}%</span>
            </div>
          );
        })}
      </div>

      <div className="wiv-toolbar">
        <div className="wiv-search-wrapper">
          <span className="wiv-search-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg>
          </span>
          <input
            type="text"
            placeholder="Search by name, phone, email, SA or source…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="wiv-search-input"
          />
          {search && <button className="wiv-search-clear" onClick={() => setSearch("")}>×</button>}
        </div>
        <select value={saFilter} onChange={(e) => setSaFilter(e.target.value)} className="wiv-select" style={{ maxWidth: 240 }}>
          <option value="">All SAs</option>
          {saOptions.map((sa) => <option key={sa} value={sa}>{sa}</option>)}
        </select>
        <select value={convFilter} onChange={(e) => setConvFilter(e.target.value)} className="wiv-select" style={{ maxWidth: 200 }}>
          <option value="all">All statuses</option>
          <option value="converted">Converted</option>
          <option value="not_converted">Not Converted</option>
        </select>
        <select value={locFilter} onChange={(e) => setLocFilter(e.target.value)} className="wiv-select" style={{ maxWidth: 180 }}>
          <option value="all">All locations</option>
          <option value="Delhi">Delhi</option>
          <option value="Ludhiana">Ludhiana</option>
        </select>
        <div style={{ flex: 1 }} />
        <span className="wiv-count">{filtered.length} of {walkins.length} · {convertedCount} converted</span>
        <button
          className="wiv-export-btn"
          onClick={handleExport}
          disabled={filtered.length === 0}
          title="Export the currently filtered walk-ins to CSV"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          Export CSV
        </button>
      </div>

      <div className="wiv-table-wrapper">
        <table className="wiv-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>SA</th>
              <th>Location</th>
              <th>Name</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Source</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="wiv-empty-cell">Loading walk-ins…</td></tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="wiv-empty-cell">
                  {search || saFilter || convFilter !== "all" || locFilter !== "all" ? "No walk-ins match your filter." : "No walk-ins recorded yet."}
                </td>
              </tr>
            ) : (
              paged.map((w) => {
                const converted = effectiveConverted(w, orderPhoneSet);
                const src = conversionSource(w);
                return (
                  <tr key={w.id}>
                    <td>{w.created_at ? new Date(w.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    <td>{w.sa_email || "—"}</td>
                    <td>{walkinLocation(w)}</td>
                    <td><strong>{w.name || "—"}</strong></td>
                    <td>{w.phone ? `${w.country_code || ""} ${w.phone}`.trim() : "—"}</td>
                    <td>{w.email || "—"}</td>
                    <td>{w.source || "—"}</td>
                    <td>
                      <div className="wi-status-cell">
                        <span className={`wi-status-badge ${converted ? "converted" : "not-converted"}`}>
                          {converted ? "Converted" : "Not Converted"}
                        </span>
                        <span className="wi-status-src">{src === "manual" ? "manual" : "auto"}</span>
                        <button
                          className="wi-status-toggle"
                          onClick={() => handleToggleConverted(w)}
                          disabled={togglingId === w.id}
                          title={converted ? "Mark as not converted" : "Mark as converted"}
                        >
                          {togglingId === w.id ? "…" : converted ? "Unset" : "Mark converted"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <Paginator page={page} totalPages={totalPages} onChange={setPage} />
      </div>
    </div>
  );
}
