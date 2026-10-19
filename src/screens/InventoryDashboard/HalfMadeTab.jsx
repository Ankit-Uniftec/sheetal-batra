import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import formatDate from "../../utils/formatDate";
import { downloadCsv } from "../../utils/downloadCsv";
import { getStageLabel } from "../../utils/barcodeService";
import { listHalfMade, photoUrl, writeOffHalfMade } from "../../utils/halfMade";
import "./HalfMadeTab.css";

const TYPE = { top: "Top", bottom: "Bottom", dupatta: "Dupatta", extra: "Extra" };
const STATUS = { available: "Available", used: "Used", written_off: "Written off" };
const stage = (s) => getStageLabel(s) || s || "—";

/**
 * Half Made Inventory (Release 15) — the Inventory login's view of every piece
 * production moved out of an order (cancelled / damaged / other), with what it
 * is, where it came from, every stage done on it, and whether it has been used
 * for another order. Write-off is the Inventory login's alone (the database
 * checks it).
 */
export default function HalfMadeTab() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("available");
  const [type, setType] = useState("");
  const [location, setLocation] = useState("");
  const [reason, setReason] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [woReason, setWoReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setError("");
    try { setRows(await listHalfMade()); } catch (err) { setError(err.message || "Could not load Half Made Inventory."); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c = { available: 0, used: 0, written_off: 0 };
    (rows || []).forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (rows || []).filter((r) =>
      (!status || r.status === status) && (!type || r.component_type === type)
      && (!location || r.location === location) && (!reason || r.reason === reason)
      && (!term || [r.product_name, r.source_barcode, r.source_order_no, r.used_order_no, r.colors]
        .some((v) => String(v || "").toLowerCase().includes(term))));
  }, [rows, status, type, location, reason, q]);

  const openRow = async (r) => {
    setOpen(r);
    setWoReason("");
    setMsg("");
    setPhotos([]);
    const urls = [];
    for (const p of r.photo_paths || []) { try { urls.push(await photoUrl(p)); } catch { /* skip */ } }
    setPhotos(urls);
  };

  const writeOff = async () => {
    setBusy(true);
    setMsg("");
    try {
      const { data: auth } = await supabase.auth.getUser();
      const res = await writeOffHalfMade({ halfMadeId: open.id, reason: woReason, by: auth?.user?.email });
      if (!res?.success) { setMsg(res?.message || "Could not write off."); return; }
      setOpen(null);
      load();
    } catch (err) {
      setMsg(err.message || "Could not write off.");
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => downloadCsv({
    filename: "half_made_inventory",
    headers: ["Status", "Piece", "Type", "Product", "Size", "Colour", "Stage reached", "Location", "Reason", "Note",
      "From order", "Moved by", "Moved on", "Used in order", "Used on", "Written off reason"],
    rows: shown.map((r) => [STATUS[r.status], r.source_barcode, TYPE[r.component_type] || r.component_type,
      r.product_name || "", r.size || "", r.colors || "", stage(r.stage_reached), r.location || "", r.reason,
      r.reason_note || "", r.source_order_no || "", r.moved_by || "", formatDate(r.moved_at),
      r.used_order_no || "", r.used_at ? formatDate(r.used_at) : "", r.written_off_reason || ""]),
  });

  return (
    <div className="hm-tab">
      <div className="hm-head">
        <h2>Half Made Inventory</h2>
        <p className="hm-hint">Pieces production moved out of an order (cancelled, damaged or other). Production can use an available piece for another order — it continues from the stage it reached.</p>
      </div>

      <div className="hm-status">
        {Object.keys(STATUS).map((s) => (
          <button key={s} className={status === s ? "active" : ""} onClick={() => setStatus(s)}>
            {STATUS[s]} <span>{counts[s] || 0}</span>
          </button>
        ))}
        <button className={status === "" ? "active" : ""} onClick={() => setStatus("")}>All <span>{(rows || []).length}</span></button>
      </div>

      <div className="hm-filters">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product, barcode, order…" />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Any piece</option>
          {Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={location} onChange={(e) => setLocation(e.target.value)}>
          <option value="">Any location</option>
          <option value="SB WH Delhi (1)">SB WH Delhi (1)</option>
          <option value="SB WH Delhi (2)">SB WH Delhi (2)</option>
        </select>
        <select value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">Any reason</option>
          {["Order cancelled", "Damaged", "Other"].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button onClick={exportCsv} disabled={!shown.length}>Export CSV</button>
      </div>

      {error && <p className="hm-error">{error}</p>}
      {rows === null ? <p className="hm-hint">Loading…</p> : shown.length === 0 ? (
        <p className="hm-hint">No pieces here.</p>
      ) : (
        <div className="hm-table">
          <table>
            <thead>
              <tr><th>Piece</th><th>Product</th><th>Stage reached</th><th>Location</th><th>Reason</th><th>From order</th><th>Moved</th><th>Status</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} onClick={() => openRow(r)}>
                  <td><b>{TYPE[r.component_type] || r.component_type}</b><div className="hm-mono">{r.source_barcode}</div></td>
                  <td>{r.product_name || "—"}<div className="hm-muted">{[r.size && `Size ${r.size}`, r.colors].filter(Boolean).join(" · ")}</div></td>
                  <td>{stage(r.stage_reached)}</td>
                  <td>{r.location}</td>
                  <td>{r.reason}{r.reason_note ? <div className="hm-muted">{r.reason_note}</div> : null}</td>
                  <td>{r.source_order_no}</td>
                  <td>{formatDate(r.moved_at)}<div className="hm-muted">{r.moved_by}</div></td>
                  <td>
                    <span className={`hm-badge hm-${r.status}`}>{STATUS[r.status]}</span>
                    {r.used_order_no && <div className="hm-muted">→ {r.used_order_no}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="hm-overlay" onClick={() => !busy && setOpen(null)}>
          <div className="hm-detail" onClick={(e) => e.stopPropagation()}>
            <div className="hm-detail-head">
              <h3>{TYPE[open.component_type] || open.component_type} · {open.source_barcode}</h3>
              <button onClick={() => setOpen(null)} disabled={busy}>✕</button>
            </div>
            <div className="hm-grid">
              <div><label>Product</label>{open.product_name || "—"}</div>
              <div><label>Size / colour</label>{[open.size, open.colors].filter(Boolean).join(" · ") || "—"}</div>
              <div><label>Stage reached</label>{stage(open.stage_reached)}</div>
              <div><label>Location</label>{open.location}</div>
              <div><label>From order</label>{open.source_order_no} ({formatDate(open.source_order_date)}, {open.source_order_status})</div>
              <div><label>Reason</label>{open.reason}{open.reason_note ? ` — ${open.reason_note}` : ""}</div>
              <div><label>Moved</label>{formatDate(open.moved_at)} by {open.moved_by}</div>
              <div><label>Status</label>{STATUS[open.status]}{open.used_order_no ? ` → ${open.used_order_no} (${open.used_barcode})` : ""}{open.written_off_reason ? ` — ${open.written_off_reason}` : ""}</div>
            </div>
            {photos.length > 0 && (
              <div className="hm-photos">{photos.map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer"><img src={u} alt="Half made piece" /></a>)}</div>
            )}
            <h4>Stages done</h4>
            <ul className="hm-list">
              {(open.stages_completed || []).length === 0 && <li className="hm-muted">None recorded.</li>}
              {(open.stages_completed || []).map((s) => (
                <li key={s.step}>{stage(s.stage_out || s.stage_in)} · {s.status}{s.scan_out_at ? ` · ${formatDate(s.scan_out_at)}` : ""}{s.scanned_out_by || s.scanned_in_by ? ` · ${s.scanned_out_by || s.scanned_in_by}` : ""}</li>
              ))}
            </ul>
            <h4>Journey</h4>
            <ul className="hm-list">
              {(open.journey || []).map((t, i) => (
                <li key={i}>{formatDate(t.at)} · {t.station || t.type} · {stage(t.from)} → {stage(t.to)}{t.by ? ` · ${t.by}` : ""}{t.factory ? ` · ${t.factory}` : ""}{t.notes ? ` — ${t.notes}` : ""}</li>
              ))}
            </ul>
            {(open.qc_records || []).length > 0 && (
              <>
                <h4>QC</h4>
                <ul className="hm-list">
                  {open.qc_records.map((qc, i) => <li key={i}>{qc.which_qc === "final" ? "Final QC" : "QC 1"} · {qc.result}{qc.fail_reason ? ` — ${qc.fail_reason}` : ""}{qc.inspected_by ? ` · ${qc.inspected_by}` : ""}</li>)}
                </ul>
              </>
            )}
            {open.status === "available" && (
              <div className="hm-writeoff">
                <input value={woReason} onChange={(e) => setWoReason(e.target.value)} placeholder="Reason to write off (required)" disabled={busy} />
                <button onClick={writeOff} disabled={busy || !woReason.trim()}>{busy ? "…" : "Write off"}</button>
              </div>
            )}
            {msg && <p className="hm-error">{msg}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
