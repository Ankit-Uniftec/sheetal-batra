import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import formatDate from "../../utils/formatDate";
import { downloadCsv } from "../../utils/downloadCsv";
import { getComponentStageLabel } from "../../utils/barcodeService";
import { fetchLinePieces, listBreakdownChanges } from "../../utils/breakdownChangeApi";
import { BREAKDOWN_CHOICES, breakdownForItem, canSetBreakdown, matchChoice } from "./breakdown.mjs";
import BreakdownChangeModal from "./BreakdownChangeModal";

const TYPE = { top: "Top", bottom: "Bottom", dupatta: "Dupatta", extra: "Extra" };
const choiceLabel = (b) => BREAKDOWN_CHOICES.find((c) => c.key === matchChoice(b))?.label || "—";
const list = (arr, f) => (arr || []).map(f).join(", ");

/**
 * "Breakdown Changes" — the Shopify desk's own screen (meeting point 8,
 * Release 11):
 *  1. correct the garment breakdown of ANY website order, including after
 *     production has started (pieces are converted / taken off the floor —
 *     see BreakdownChangeModal);
 *  2. the log of every change, from here and from the order cards.
 */
export default function BreakdownChangesScreen({ userEmail }) {
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState(null);
  const [pieces, setPieces] = useState([]);
  const [findError, setFindError] = useState("");
  const [finding, setFinding] = useState(false);
  const [changing, setChanging] = useState(null);   // item index being changed

  const [log, setLog] = useState(null);
  const [logError, setLogError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [afterStartOnly, setAfterStartOnly] = useState(false);

  const loadLog = useCallback(async () => {
    setLogError("");
    try {
      setLog(await listBreakdownChanges({
        from: from ? `${from}T00:00:00` : undefined,
        to: to ? `${to}T23:59:59` : undefined,
        afterStartOnly,
      }));
    } catch (err) {
      setLogError(err.message || "Could not load the log.");
      setLog([]);
    }
  }, [from, to, afterStartOnly]);
  useEffect(() => { loadLog(); }, [loadLog]);

  const loadOrder = async (orderNo) => {
    const { data, error } = await supabase.from("orders")
      .select("id, order_no, shopify_order_name, status, items, manual_line_breakdown, web_order_issues")
      .eq("order_no", orderNo).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const { components } = await fetchLinePieces(data.id);
    setPieces(components);
    return data;
  };

  const find = async (e) => {
    e?.preventDefault();
    const q = query.trim().replace(/^#/, "");
    if (!q) return;
    setFinding(true);
    setFindError("");
    setOrder(null);
    try {
      // Our order number, or Shopify's own (#29732 or 29732).
      const { data, error } = await supabase.from("orders").select("order_no")
        .or(`order_no.eq.${q.toUpperCase()},shopify_order_name.eq.#${q}`)
        .like("order_no", "SB-SHOP%").limit(2);
      if (error) throw error;
      if (!data?.length) { setFindError(`No website order "${query.trim()}".`); return; }
      setOrder(await loadOrder(data[0].order_no));
    } catch (err) {
      setFindError(err.message || "Search failed.");
    } finally {
      setFinding(false);
    }
  };

  const lines = order
    ? (order.items || []).map((item, idx) => ({ item, idx })).filter(({ item, idx }) => !item?.is_charge && canSetBreakdown(order, item, idx))
    : [];

  const exportLog = () => downloadCsv({
    filename: "breakdown_changes",
    headers: ["Date", "Order", "Shopify #", "Product", "From", "To", "Relabelled", "Removed", "Taken off floor", "Added", "After production started", "By", "Reason"],
    rows: (log || []).map((r) => [
      formatDate(r.created_at), r.order_no, r.shopify_order_name || "", r.product_name || "",
      choiceLabel(r.from_choice), choiceLabel(r.to_choice),
      list(r.converted, (c) => `${c.from} → ${c.to}`), list(r.removed, (c) => c.barcode),
      list(r.retired, (c) => `${c.barcode} (${c.stage})`), (r.added || []).join(", "),
      r.after_start ? "Yes" : "No", r.changed_by || "", r.reason,
    ]),
  });

  return (
    <div className="sho-bdc">
      <div className="sho-bdc-card">
        <h3>Change a garment breakdown</h3>
        <p className="sho-hint">
          For any website order — also after production started. Pieces that no longer fit are converted to a new
          barcode (the old label keeps scanning) or taken off the floor; pieces at a vendor, packed or dispatched
          can't be changed.
        </p>
        <form className="sho-bdc-search" onSubmit={find}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Order no. or Shopify # (e.g. #29732)" />
          <button type="submit" disabled={finding}>{finding ? "Finding…" : "Find"}</button>
        </form>
        {findError && <p className="sho-bdc-error">{findError}</p>}
        {order && (
          <div className="sho-bdc-order">
            <p><b>{order.order_no}</b> {order.shopify_order_name && `· ${order.shopify_order_name}`} · {order.status}</p>
            {lines.length === 0 ? (
              <p className="sho-hint">No line on this order has a garment breakdown to change (its pieces come from the Shopify product).</p>
            ) : lines.map(({ item, idx }) => {
              const mine = pieces.filter((c) => (c.item_index ?? 0) === idx);
              return (
                <div key={idx} className="sho-bdc-line">
                  <div className="sho-bdc-line-head">
                    <span>“{item.product_name}” — <b>{choiceLabel(breakdownForItem(order, idx))}</b></span>
                    <button type="button" onClick={() => setChanging(idx)}>Change</button>
                  </div>
                  <ul>
                    {mine.length === 0 && <li className="sho-hint">No barcodes yet.</li>}
                    {mine.map((c) => (
                      <li key={c.id} style={c.cancelled_at ? { textDecoration: "line-through", color: "#999" } : undefined}>
                        {c.barcode} · {TYPE[c.component_type] || c.component_type} ·{" "}
                        {c.cancelled_at ? "taken off the floor"
                          : c.is_outside_wh ? `at ${c.vendor_name || "vendor"}`
                          : c.current_stage === "order_received" && !c.is_active ? "not started" : getComponentStageLabel(c)}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="sho-bdc-card">
        <div className="sho-bdc-log-head">
          <h3>Change log</h3>
          <div className="sho-bdc-filters">
            <label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <label><input type="checkbox" checked={afterStartOnly} onChange={(e) => setAfterStartOnly(e.target.checked)} /> After production started only</label>
            <button type="button" onClick={exportLog} disabled={!log?.length}>Export CSV</button>
          </div>
        </div>
        {logError && <p className="sho-bdc-error">{logError}</p>}
        {log === null ? <p className="sho-hint">Loading…</p> : log.length === 0 ? (
          <p className="sho-hint">No breakdown changes yet.</p>
        ) : (
          <div className="sho-bdc-table">
            <table>
              <thead>
                <tr><th>When</th><th>Order</th><th>Product</th><th>From → To</th><th>Pieces</th><th>By</th><th>Reason</th></tr>
              </thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(r.created_at)}</td>
                    <td>{r.order_no}{r.shopify_order_name ? <div className="sho-hint">{r.shopify_order_name}</div> : null}</td>
                    <td>{r.product_name}</td>
                    <td>{choiceLabel(r.from_choice)} → <b>{choiceLabel(r.to_choice)}</b>{r.after_start && <div className="sho-bdc-started">after production started</div>}</td>
                    <td>
                      {r.converted?.length > 0 && <div>Relabelled: {list(r.converted, (c) => `${c.from} → ${c.to}`)}</div>}
                      {r.removed?.length > 0 && <div>Removed: {list(r.removed, (c) => c.barcode)}</div>}
                      {r.retired?.length > 0 && <div>Off the floor: {list(r.retired, (c) => `${c.barcode} (${c.stage})`)}</div>}
                      {r.added?.length > 0 && <div>Added: {r.added.join(", ")}</div>}
                    </td>
                    <td>{r.changed_by}</td>
                    <td>{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {order && changing !== null && (
        <BreakdownChangeModal
          order={order}
          itemIndex={changing}
          allowStarted
          by={userEmail}
          onClose={() => setChanging(null)}
          onDone={async () => { setOrder(await loadOrder(order.order_no)); loadLog(); }}
        />
      )}
    </div>
  );
}
