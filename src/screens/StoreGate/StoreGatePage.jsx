import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import DashboardHeader from "../../components/DashboardHeader";
import { usePopup } from "../../components/Popup";
import { useBarcodeScanner } from "../../hooks/useBarcodeScanner";
import formatDate from "../../utils/formatDate";
import {
  GATE_EVENTS, GATE_FLAGS, GATE_REASONS, gateActions, gateDashboard, gateLookup, gateScan, pieceWhere,
} from "../../utils/storeGate";
import "./StoreGate.css";

// Store Gate (Release 22) — the only screen a `store_gate` login sees. The
// guard scans the order's master barcode (= order no) or any piece's barcode;
// every piece of that order is listed to tick (Select all), then one action
// records them all. Nothing is ever blocked: unusual scans are accepted and
// flagged for review (see db/meeting_points/r22_01_store_gate.sql).

const timeOf = (iso) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "";

export default function StoreGatePage() {
  const navigate = useNavigate();
  const { showPopup, PopupComponent } = usePopup();

  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState("");
  const [store, setStore] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);      // store_gate_lookup payload
  const [selected, setSelected] = useState([]);    // component ids
  const [askReason, setAskReason] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [board, setBoard] = useState({ today: [], in_store: [] });
  const inputRef = useRef(null);

  // Only the store_gate role lands here.
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/login", { replace: true }); return; }
      const { data: me } = await supabase
        .from("salesperson")
        .select("role, saleperson, store_name")
        .eq("email", session.user.email?.toLowerCase())
        .single();
      if (!me || me.role !== "store_gate") {
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
        return;
      }
      setUserName(me.saleperson || "");
      setLoading(false);
    })();
  }, [navigate]);

  const loadBoard = useCallback(async () => {
    try {
      const d = await gateDashboard();
      if (d?.success) {
        setStore(d.store);
        setBoard({ today: d.today || [], in_store: d.in_store || [] });
      }
    } catch (e) {
      console.error("Store gate board:", e);
    }
  }, []);

  useEffect(() => { if (!loading) loadBoard(); }, [loading, loadBoard]);

  const lookup = useCallback(async (raw) => {
    const value = String(raw || "").trim();
    if (!value) return;
    setBusy(true);
    setAskReason(false);
    setReason("");
    setNote("");
    try {
      const d = await gateLookup(value);
      if (!d?.success) {
        setResult(null);
        setSelected([]);
        showPopup({ title: "Not found", message: d?.message || "Barcode not found.", type: "warning" });
        return;
      }
      setResult(d);
      // Select all by default: the box usually moves as one.
      setSelected((d.pieces || []).map((p) => p.id));
      setCode("");
    } catch (e) {
      showPopup({ title: "Scan failed", message: e.message || String(e), type: "error" });
    } finally {
      setBusy(false);
    }
  }, [showPopup]);

  useBarcodeScanner({ onScan: lookup, enabled: !loading && !busy });

  const pieces = useMemo(() => result?.pieces || [], [result]);
  const chosen = pieces.filter((p) => selected.includes(p.id));
  const actions = gateActions(chosen);
  const allSelected = pieces.length > 0 && selected.length === pieces.length;

  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const run = async (event) => {
    if (event === "out_to_warehouse" && !askReason) { setAskReason(true); return; }
    if (event === "out_to_warehouse" && !reason) {
      showPopup({ title: "Reason needed", message: "Choose why it is going to the warehouse.", type: "warning" });
      return;
    }
    setBusy(true);
    try {
      const r = await gateScan(selected, event, event === "out_to_warehouse" ? reason : null, note || null);
      if (!r?.success) {
        showPopup({ title: "Not recorded", message: r?.message || "Could not record the scan.", type: "error" });
        return;
      }
      const skipped = (r.skipped || []).length;
      let message = `${r.recorded} piece${r.recorded === 1 ? "" : "s"}: ${GATE_EVENTS[event]}.`;
      if (skipped) message += ` ${skipped} already recorded, skipped.`;
      if (event === "out_delivered") {
        if (Number(r.balance_due) > 0 && r.order_status !== "delivered") {
          message += " Balance is pending — the sales team will collect it and mark the order delivered.";
        } else if (r.order_status === "delivered") {
          message += " Order marked delivered.";
        }
      }
      showPopup({ title: "Recorded ✅", message, type: "success" });
      await Promise.all([lookup(result.order.order_no), loadBoard()]);
    } catch (e) {
      showPopup({ title: "Not recorded", message: e.message || String(e), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  if (loading) return <div className="sg-page"><div className="sg-empty">Loading…</div></div>;

  const order = result?.order;
  const orderFlags = order
    ? [
        !order.is_store_order && "Not a store-pickup order",
        order.is_store_order && order.order_store && store && order.order_store !== store && `Belongs to ${order.order_store}`,
      ].filter(Boolean)
    : [];

  return (
    <div className="sg-page">
      {PopupComponent}
      <DashboardHeader
        title={store ? `Store Gate — ${store}` : "Store Gate"}
        onHome={() => { setResult(null); setSelected([]); inputRef.current?.focus(); }}
        userName={userName}
        onLogout={handleLogout}
        // The header hides its Logout under 900px (other screens keep it in their
        // sidebar); this page has no sidebar, so give small screens their own.
        actions={<button type="button" className="sg-logout-mobile" onClick={handleLogout}>Logout</button>}
      />

      <main className="sg-main">
        <form
          className="sg-scanbox"
          onSubmit={(e) => { e.preventDefault(); lookup(code); }}
        >
          <input
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Scan the order barcode or any piece's barcode"
            autoFocus
            disabled={busy}
          />
          <button type="submit" disabled={busy || !code.trim()}>Find</button>
        </form>

        {order && (
          <section className="sg-card">
            <div className="sg-order-head">
              {order.image_url && <img src={order.image_url} alt="" className="sg-thumb" />}
              <div>
                <div className="sg-order-no">{order.order_no}</div>
                <div className="sg-muted">
                  {order.customer || "—"} · {order.mode_of_delivery || "—"}
                  {order.delivery_date ? ` · Delivery ${formatDate(order.delivery_date)}` : ""}
                </div>
                <div className="sg-chips">
                  {order.status === "delivered" && <span className="sg-chip ok">Order delivered</span>}
                  {order.balance_pending && order.status !== "delivered" && <span className="sg-chip warn">Balance pending</span>}
                  {orderFlags.map((f) => <span key={f} className="sg-chip warn">⚠ {f}</span>)}
                </div>
              </div>
            </div>

            <label className="sg-selectall">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? [] : pieces.map((p) => p.id))}
              />
              Select all ({pieces.length} piece{pieces.length === 1 ? "" : "s"})
            </label>

            <ul className="sg-pieces">
              {pieces.map((p) => (
                <li key={p.id} className={selected.includes(p.id) ? "on" : ""}>
                  <label>
                    <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
                    <span className="sg-piece-main">
                      <strong>{p.label}</strong>
                      {p.product_name ? <span className="sg-muted"> · {p.product_name}</span> : null}
                      <span className="sg-barcode">{p.barcode}{p.scanned ? " · scanned" : ""}</span>
                    </span>
                    <span className="sg-where">
                      {pieceWhere(p)}
                      {p.gate_at ? <span className="sg-muted"> · {formatDate(p.gate_at)} {timeOf(p.gate_at)}</span> : null}
                      {!p.dispatched && !p.gate_event ? <span className="sg-flag">⚠</span> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            {askReason && (
              <div className="sg-reason">
                <div className="sg-reason-title">Why is it going to the warehouse?</div>
                <div className="sg-reason-list">
                  {GATE_REASONS.map((r) => (
                    <button key={r} type="button" className={reason === r ? "on" : ""} onClick={() => setReason(r)}>{r}</button>
                  ))}
                </div>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
              </div>
            )}

            <div className="sg-actions">
              {(askReason ? ["out_to_warehouse"] : actions).map((ev, i) => (
                <button
                  key={ev}
                  type="button"
                  className={`sg-act ${i === 0 ? "primary" : ""} ${ev}`}
                  disabled={busy || selected.length === 0}
                  onClick={() => run(ev)}
                >
                  {askReason ? "Confirm — send to warehouse" : GATE_EVENTS[ev]}
                </button>
              ))}
              {askReason && (
                <button type="button" className="sg-act" onClick={() => { setAskReason(false); setReason(""); setNote(""); }}>
                  Cancel
                </button>
              )}
            </div>
          </section>
        )}

        <div className="sg-lists">
          <section className="sg-list">
            <h3>In store now ({board.in_store.length})</h3>
            {board.in_store.length === 0 ? <div className="sg-empty">Nothing waiting.</div> : (
              <ul>
                {board.in_store.map((x) => (
                  <li key={x.barcode} onClick={() => lookup(x.order_no)}>
                    <span>{x.order_no}</span>
                    <span className="sg-barcode">{x.barcode}</span>
                    <span className="sg-muted">since {formatDate(x.since)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="sg-list">
            <h3>Today's scans ({board.today.length})</h3>
            {board.today.length === 0 ? <div className="sg-empty">No scans yet today.</div> : (
              <ul>
                {board.today.map((x, i) => (
                  <li key={`${x.barcode}-${x.at}-${i}`} onClick={() => lookup(x.order_no)}>
                    <span>{timeOf(x.at)} · {GATE_EVENTS[x.event] || x.event}{x.reason ? ` (${x.reason})` : ""}</span>
                    <span className="sg-barcode">{x.barcode}</span>
                    {(x.flags || []).length > 0 && (
                      <span className="sg-flag">⚠ {(x.flags || []).map((f) => GATE_FLAGS[f] || f).join(", ")}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
