import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import downloadCsv from "../utils/downloadCsv";
import formatIndianNumber from "../utils/formatIndianNumber";
import TierBadge from "./TierBadge";
import "./ClientTiersPanel.css";

// ============================================================
// Collectors Circle: clients by tier (Release 39, policy section 7).
// One panel for the Admin (Jahnavi), Assistant CMO (Bhawna), GM, CEO and
// Store Manager dashboards. Data from client_tier_list() (db r39_22): clients
// with an order in the last 12 months, tier and 12-month eligible MRP spend.
// A store manager only receives their own store's clients (decided in the
// database, not here).
// ============================================================

const TIERS = [
  { code: "collector", name: "The Collector" },
  { code: "patron", name: "The Patron" },
  { code: "insider", name: "The Insider" },
  { code: "registered", name: "Registered Member" },
];
const SORTS = [
  { value: "spend", label: "Highest spend" },
  { value: "next", label: "Closest to next tier" },
  { value: "recent", label: "Most recent order" },
  { value: "name", label: "Name A–Z" },
];
const PAGE = 25;
const inr = (v) => `₹${formatIndianNumber(Math.round(Number(v) || 0))}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default function ClientTiersPanel({ title = "Collectors Circle" }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [tier, setTier] = useState("");
  const [store, setStore] = useState("");
  const [sort, setSort] = useState("spend");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let off = false;
    supabase.rpc("client_tier_list").then(({ data, error: e }) => {
      if (off) return;
      if (e) { setError(e.message || "Could not load the client tiers."); setRows([]); return; }
      setRows((data || []).map((r) => ({
        id: r.profile_id, name: r.client_name || "—", phone: r.phone || "", store: r.home_store || "—",
        last: r.last_order, spend: Number(r.spend_12m) || 0, orders: r.orders_12m || 0,
        tier: { tierCode: r.tier_code, tierName: r.tier_name, nextTierName: r.next_tier_name,
          toNext: r.to_next_tier == null ? null : Number(r.to_next_tier), spend: Number(r.spend_12m) || 0 },
      })));
    });
    return () => { off = true; };
  }, []);

  const stores = useMemo(() => [...new Set((rows || []).map((r) => r.store))].sort(), [rows]);
  const counts = useMemo(() => {
    const c = {}; (rows || []).forEach((r) => { c[r.tier.tierCode] = (c[r.tier.tierCode] || 0) + 1; });
    return c;
  }, [rows]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const digits = t.replace(/\D/g, "");
    const l = (rows || []).filter((r) => (!tier || r.tier.tierCode === tier) && (!store || r.store === store)
      && (!t || r.name.toLowerCase().includes(t) || (digits.length >= 3 && r.phone.replace(/\D/g, "").includes(digits))));
    const by = {
      spend: (a, b) => b.spend - a.spend,
      next: (a, b) => (a.tier.toNext ?? 9e15) - (b.tier.toNext ?? 9e15),
      recent: (a, b) => String(b.last || "").localeCompare(String(a.last || "")),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return l.sort(by[sort]);
  }, [rows, q, tier, store, sort]);
  useEffect(() => { setPage(1); }, [q, tier, store, sort]);

  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const exportCsv = () => downloadCsv({
    filename: "collectors_circle_clients",
    headers: ["Client", "Phone", "Tier", "Eligible spend (12 months)", "Orders (12 months)", "Next tier", "To next tier", "Home store", "Last order"],
    rows: list.map((r) => [r.name, r.phone, r.tier.tierName, Math.round(r.spend), r.orders, r.tier.nextTierName || "",
      r.tier.toNext == null ? "" : Math.round(r.tier.toNext), r.store, r.last || ""]),
  });

  return (
    <div className="ctp">
      <div className="ctp-head">
        <div>
          <h2>{title}</h2>
          <p>Clients by membership tier: eligible MRP spend over the last 12 months, across stores and the website.</p>
        </div>
        <button type="button" className="ctp-btn" onClick={exportCsv} disabled={!list.length}>Export CSV</button>
      </div>

      {error && <p className="ctp-error">{error}</p>}

      <div className="ctp-tiles">
        {TIERS.map((t) => (
          <button key={t.code} type="button" className={`ctp-tile${tier === t.code ? " is-on" : ""}`}
            onClick={() => setTier(tier === t.code ? "" : t.code)} aria-pressed={tier === t.code}>
            <TierBadge tier={{ tierCode: t.code, tierName: t.name }} />
            <b>{rows ? (counts[t.code] || 0).toLocaleString("en-IN") : "…"}</b>
            <small>clients</small>
          </button>
        ))}
      </div>

      <div className="ctp-tools">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client name or phone" aria-label="Search clients" />
        <select value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Tier">
          <option value="">All tiers</option>
          {TIERS.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
        </select>
        {stores.length > 1 && (
          <select value={store} onChange={(e) => setStore(e.target.value)} aria-label="Home store">
            <option value="">All stores</option>
            {stores.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      <p className="ctp-note">{rows ? `${list.length.toLocaleString("en-IN")} clients` : "Loading clients…"}</p>

      {rows && list.length > 0 && (
        <div className="ctp-table-wrap">
          <table className="ctp-table">
            <thead>
              <tr>
                <th>Client</th><th>Tier</th><th className="r">Spend (12 mo)</th><th className="r hide-sm">Orders</th>
                <th className="hide-sm">Next tier</th><th className="hide-sm">Home store</th><th className="hide-sm">Last order</th>
              </tr>
            </thead>
            <tbody>
              {list.slice((page - 1) * PAGE, page * PAGE).map((r) => (
                <tr key={r.id}>
                  <td><b>{r.name}</b><small>{r.phone}</small></td>
                  <td><TierBadge tier={r.tier} short /></td>
                  <td className="r"><b>{inr(r.spend)}</b></td>
                  <td className="r hide-sm">{r.orders}</td>
                  <td className="hide-sm">{r.tier.nextTierName ? <>{inr(r.tier.toNext)} <small>to {r.tier.nextTierName.replace(/^The\s+/i, "")}</small></> : <small>Top tier</small>}</td>
                  <td className="hide-sm">{r.store}</td>
                  <td className="hide-sm">{fmtDate(r.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows && !list.length && !error && <p className="ctp-empty">No clients match.</p>}

      {pages > 1 && (
        <div className="ctp-pager">
          <button type="button" className="ctp-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button type="button" className="ctp-btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
