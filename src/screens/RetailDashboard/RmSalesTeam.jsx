import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { isSaleOrder } from "../../utils/revenue";
import { totalNetSbRevenue } from "../../utils/exhibitionService";
import formatIndianNumber from "../../utils/formatIndianNumber";

// ============================================================
// Sales Team tab — Retail Manager (Release 32, client point 1).
//
// Every sales associate, the monthly target for each SA and each store, and
// how the team is doing against them.
//   SA targets    → sa_monthly_targets (the same table Admin edits, so the
//                   SA, Admin, GM and CEO all see the same number).
//   Store targets → store_monthly_targets (db/meeting_points/r32_01).
// Sold = net sales (isSaleOrder, exhibition at net) placed in that month,
// matched to the SA by salesperson_email. Private, Shopify and B2B are not
// in this dashboard, so they are not in "sold" either.
// ============================================================

const SA_ROLES = ["salesperson", "sa_services"];
// Stores outside this dashboard (Release 13/17/32: no B2B, Shopify or Private).
const HIDDEN_STORE = /b2b|private|shopify|website/i;
// Exhibition is in scope, but its "SA" is a shared account, not a person, so
// it is listed but never ranked best / worst.
const NOT_RANKED_STORE = /exhibition/i;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const rupees = (n) => `₹${formatIndianNumber(Math.round(Number(n) || 0))}`;
const pctText = (p) => (p === null ? "—" : `${Math.round(p * 100)}%`);

/** The month list: 3 back (view only), this month, 2 ahead. */
function monthOptions(now = new Date()) {
  const out = [];
  for (let d = -3; d <= 2; d++) {
    const dt = new Date(now.getFullYear(), now.getMonth() + d, 1);
    out.push({ year: dt.getFullYear(), month: dt.getMonth() + 1, label: `${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`, isPast: d < 0, isCurrent: d === 0 });
  }
  return out;
}

/** Share of the month gone (1 for past months, 0 for future ones). */
function monthElapsed(opt, now = new Date()) {
  if (opt.isPast) return 1;
  if (!opt.isCurrent) return 0;
  const days = new Date(opt.year, opt.month, 0).getDate();
  return Math.min(1, now.getDate() / days);
}

function TargetInput({ value, disabled, onSave, label }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => { setDraft(value ?? ""); }, [value]);
  const commit = async () => {
    const clean = String(draft).replace(/[,\s₹]/g, "");
    if (clean === String(value ?? "")) return;
    // A refused save puts the box back to the saved number.
    if ((await onSave(clean)) === false) setDraft(value ?? "");
  };
  return (
    <input
      className="rm-target-input"
      inputMode="numeric"
      value={draft}
      disabled={disabled}
      placeholder={disabled ? "—" : "Set target"}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
    />
  );
}

export default function RmSalesTeam({ orders, myEmail, showPopup }) {
  const months = useMemo(() => monthOptions(), []);
  const [monthIdx, setMonthIdx] = useState(3); // this month
  const sel = months[monthIdx];

  const [people, setPeople] = useState([]);
  const [saTargets, setSaTargets] = useState({});       // email → amount
  const [storeTargets, setStoreTargets] = useState({}); // store → amount
  const [storeTableMissing, setStoreTableMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [storeFilter, setStoreFilter] = useState("all");

  useEffect(() => {
    let off = false;
    (async () => {
      const { data, error } = await supabase.from("salesperson")
        .select("saleperson, email, store_name, role").in("role", SA_ROLES);
      if (off) return;
      if (error) showPopup({ title: "Could not load the sales team", message: error.message, type: "error" });
      setPeople((data || []).filter((p) => p.email && !HIDDEN_STORE.test(p.store_name || "")).map((p) => ({
        name: p.saleperson || p.email, email: p.email.toLowerCase(), store: (p.store_name || "No store").trim(), role: p.role,
      })).sort((a, b) => a.store.localeCompare(b.store) || a.name.localeCompare(b.name)));
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const [sa, st] = await Promise.all([
        supabase.from("sa_monthly_targets").select("salesperson_email, target_amount").eq("year", sel.year).eq("month", sel.month),
        supabase.from("store_monthly_targets").select("store_name, target_amount").eq("year", sel.year).eq("month", sel.month),
      ]);
      if (off) return;
      setSaTargets(Object.fromEntries((sa.data || []).map((r) => [String(r.salesperson_email).toLowerCase(), Number(r.target_amount)])));
      setStoreTableMissing(!!st.error);
      setStoreTargets(Object.fromEntries((st.data || []).map((r) => [r.store_name, Number(r.target_amount)])));
      setLoading(false);
    })();
    return () => { off = true; };
  }, [sel.year, sel.month]);

  const soldByEmail = useMemo(() => {
    const map = {};
    (orders || []).forEach((o) => {
      if (!isSaleOrder(o) || !o.salesperson_email || !o.created_at) return;
      const d = new Date(o.created_at);
      if (d.getFullYear() !== sel.year || d.getMonth() + 1 !== sel.month) return;
      const k = o.salesperson_email.toLowerCase();
      if (!map[k]) map[k] = { sold: 0, orders: 0 };
      map[k].sold += totalNetSbRevenue([o]);
      map[k].orders += 1;
    });
    return map;
  }, [orders, sel.year, sel.month]);

  const elapsed = monthElapsed(sel);
  const rows = useMemo(() => people.map((p) => {
    const target = saTargets[p.email] || 0;
    const { sold = 0, orders: n = 0 } = soldByEmail[p.email] || {};
    const achieved = target > 0 ? sold / target : null;
    const onPace = achieved === null || elapsed === 0 ? null : achieved >= elapsed * 0.9;
    return { ...p, target, sold, orders: n, achieved, onPace };
  }), [people, saTargets, soldByEmail, elapsed]);

  const stores = useMemo(() => [...new Set(people.map((p) => p.store))], [people]);
  const storeRows = useMemo(() => stores.map((s) => {
    const mine = rows.filter((r) => r.store === s);
    const sold = mine.reduce((t, r) => t + r.sold, 0);
    const saSum = mine.reduce((t, r) => t + r.target, 0);
    const target = storeTargets[s] || 0;
    return { store: s, people: mine.length, sold, saSum, target, achieved: target > 0 ? sold / target : null };
  }), [stores, rows, storeTargets]);

  // Best / worst: by % of target when targets are set, otherwise by sales.
  const ranked = useMemo(() => {
    const people = rows.filter((r) => !NOT_RANKED_STORE.test(r.store));
    const withTarget = people.filter((r) => r.target > 0);
    const list = withTarget.length ? withTarget : people.filter((r) => r.sold > 0);
    const key = withTarget.length ? (r) => r.achieved : (r) => r.sold;
    return [...list].sort((a, b) => key(b) - key(a));
  }, [rows]);
  const byPercent = rows.some((r) => r.target > 0);
  const best = ranked.slice(0, 3);
  const worst = ranked.length > 3 ? ranked.slice(-3).reverse() : [];

  const saveSa = async (email, raw) => {
    if (raw !== "" && !(Number(raw) >= 0)) { showPopup({ title: "Not a number", message: "Type the target in rupees, e.g. 800000.", type: "warning" }); return false; }
    setSaving(email);
    const q = raw === ""
      ? supabase.from("sa_monthly_targets").delete().eq("salesperson_email", email).eq("year", sel.year).eq("month", sel.month)
      : supabase.from("sa_monthly_targets").upsert({ salesperson_email: email, year: sel.year, month: sel.month, target_amount: Number(raw), set_by: myEmail }, { onConflict: "salesperson_email,year,month" });
    const { error } = await q;
    setSaving(null);
    if (error) { showPopup({ title: "Target not saved", message: error.message, type: "error" }); return false; }
    setSaTargets((m) => { const n = { ...m }; if (raw === "") delete n[email]; else n[email] = Number(raw); return n; });
  };

  const saveStore = async (store, raw) => {
    if (raw !== "" && !(Number(raw) >= 0)) { showPopup({ title: "Not a number", message: "Type the target in rupees, e.g. 5000000.", type: "warning" }); return false; }
    setSaving(`store:${store}`);
    const q = raw === ""
      ? supabase.from("store_monthly_targets").delete().eq("store_name", store).eq("year", sel.year).eq("month", sel.month)
      : supabase.from("store_monthly_targets").upsert({ store_name: store, year: sel.year, month: sel.month, target_amount: Number(raw), set_by: myEmail, updated_at: new Date().toISOString() }, { onConflict: "store_name,year,month" });
    const { error } = await q;
    setSaving(null);
    if (error) { showPopup({ title: "Store target not saved", message: error.message, type: "error" }); return false; }
    setStoreTargets((m) => { const n = { ...m }; if (raw === "") delete n[store]; else n[store] = Number(raw); return n; });
  };

  const exportCsv = () => {
    const head = ["Name", "Email", "Store", "Target", "Sold", "Orders", "Achieved %"];
    const lines = rows.filter((r) => storeFilter === "all" || r.store === storeFilter)
      .map((r) => [r.name, r.email, r.store, r.target, Math.round(r.sold), r.orders, r.achieved === null ? "" : Math.round(r.achieved * 100)]);
    const csv = [head, ...lines].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `sales-team-${sel.year}-${String(sel.month).padStart(2, "0")}.csv`;
    a.click();
  };

  const shown = rows.filter((r) => storeFilter === "all" || r.store === storeFilter);
  const locked = sel.isPast;

  return (
    <div className="rm-analytics-tab">
      <div className="rm-tab-header">
        <h2 className="rm-section-title">Sales Team</h2>
        <div className="rm-team-controls">
          <select className="rm-team-select" value={monthIdx} onChange={(e) => setMonthIdx(Number(e.target.value))} aria-label="Month">
            {months.map((m, i) => <option key={m.label} value={i}>{m.label}{m.isCurrent ? " (this month)" : m.isPast ? " (view only)" : ""}</option>)}
          </select>
          <select className="rm-team-select" value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} aria-label="Store">
            <option value="all">All stores</option>
            {stores.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="rm-team-btn" onClick={exportCsv}>Export CSV</button>
        </div>
      </div>
      <p className="rm-team-note">
        Sold = net sales placed in {sel.label} (cancelled, returned, stock and alteration orders left out; exhibition at SB&apos;s net).
        {locked ? " Past months are view only." : " Type a target and press Enter; clear it to remove."}
        {" "}SA targets are shared with Admin, so a change here shows there too.
      </p>

      {/* Stores */}
      <h3 className="rm-subsection-title">Stores</h3>
      {storeTableMissing && <p className="rm-team-warn">Store targets can&apos;t be saved yet: the store-target table hasn&apos;t been added to the database.</p>}
      <div className="rm-team-stores">
        {storeRows.filter((s) => storeFilter === "all" || s.store === storeFilter).map((s) => (
          <div key={s.store} className="rm-stat-card overview-card rm-team-store">
            <span className="stat-label">{s.store} {"·"} {s.people} SA{s.people === 1 ? "" : "s"}</span>
            <span className="stat-value">{rupees(s.sold)}</span>
            <div className="rm-team-store-target">
              <span>Store target</span>
              <TargetInput value={s.target || ""} disabled={locked || storeTableMissing || saving === `store:${s.store}`} label={`${s.store} target`} onSave={(v) => saveStore(s.store, v)} />
            </div>
            <span className="stat-sub">
              {s.target ? `${pctText(s.achieved)} of target` : "No store target"} {"·"} SA targets add up to {rupees(s.saSum)}
            </span>
            {s.target > 0 && <div className="rm-team-bar"><i style={{ width: `${Math.min(100, (s.achieved || 0) * 100)}%` }} /></div>}
          </div>
        ))}
      </div>

      {/* Best / worst */}
      <div className="rm-team-rank">
        <div className="rm-chart-card">
          <h3 className="rm-chart-title">Best performers {byPercent ? "(% of target)" : "(sales)"}</h3>
          {best.length ? best.map((r, i) => (
            <div key={r.email} className="rm-team-rank-row"><b>{i + 1}</b><span>{r.name}<em>{r.store}</em></span><strong>{byPercent ? pctText(r.achieved) : rupees(r.sold)}</strong></div>
          )) : <p className="rm-team-empty">No sales or targets yet for {sel.label}.</p>}
        </div>
        <div className="rm-chart-card">
          <h3 className="rm-chart-title">Needs attention {byPercent ? "(% of target)" : "(sales)"}</h3>
          {worst.length ? worst.map((r, i) => (
            <div key={r.email} className="rm-team-rank-row is-low"><b>{ranked.length - i}</b><span>{r.name}<em>{r.store}</em></span><strong>{byPercent ? pctText(r.achieved) : rupees(r.sold)}</strong></div>
          )) : <p className="rm-team-empty">Needs more than 3 people with {byPercent ? "targets" : "sales"} to compare.</p>}
        </div>
      </div>

      {/* Everyone */}
      <h3 className="rm-subsection-title">All sales associates ({shown.length})</h3>
      <div className="rm-table-wrapper">
        <div className="rm-table-container">
          <table className="rm-table rm-team-table">
            <thead>
              <tr><th>Name</th><th>Store</th><th>Target ({sel.label})</th><th>Sold</th><th>Orders</th><th>Achieved</th><th>Pace</th></tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan="7" className="rm-no-data">Loading targets…</td></tr>
                : shown.length === 0 ? <tr><td colSpan="7" className="rm-no-data">No sales associates</td></tr>
                : shown.map((r) => (
                  <tr key={r.email}>
                    <td>{r.name}</td>
                    <td>{r.store}</td>
                    <td><TargetInput value={r.target || ""} disabled={locked || saving === r.email} label={`${r.name} target`} onSave={(v) => saveSa(r.email, v)} /></td>
                    <td>{rupees(r.sold)}</td>
                    <td>{r.orders}</td>
                    <td>
                      {pctText(r.achieved)}
                      {r.achieved !== null && <div className="rm-team-bar small"><i style={{ width: `${Math.min(100, r.achieved * 100)}%` }} /></div>}
                    </td>
                    <td>{r.onPace === null ? "—" : <span className={`rm-pace ${r.onPace ? "ok" : "behind"}`}>{r.onPace ? "On pace" : "Behind"}</span>}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="rm-team-note">On pace = achieved at least 90% of the share of the month gone (e.g. 50% of target by the 15th of a 30-day month).</p>
    </div>
  );
}
