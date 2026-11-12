import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import "./StockRoom.css";
import "./SaInventory.css";
import ProductDetail from "./ProductDetail";
import useStockRoomView from "./useStockRoomView";
import { loadStockRoomCatalogue, loadSales, loadLedger } from "./stockRoomData";
import { ProductCell, SizeSummary, SearchField, Seg, Badge, usePaged } from "./StockRoomUi";
import { formatUnits, formatInr, TYPE_LABELS, TYPE_LXRTS, TYPE_CUSTOM } from "./stockRoomModel";
import { useBarcodeScanner } from "../../hooks/useBarcodeScanner";
import { findPiece, loadPieces } from "../../utils/stockPieces";

// ============================================================
// Release 35 — Inventory on the SA dashboard.
//
// The Stock Room's own numbers and its own product details window, read
// only: no stock buttons, no editing. Scanning a piece label (scanner gun, or
// the Scan button to type it) opens that design's details with the piece's
// status on top. Looking a piece up here never holds it — holding happens
// only in the order form.
// ============================================================

const TYPE_FILTERS = [
  { value: "stock", label: "In stock" },
  { value: "all", label: "All ready pieces" },
];

export default function SaInventory() {
  const [catalogue, setCatalogue] = useState(null);
  const [sales, setSales] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [pieces, setPieces] = useState([]);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("stock");
  const [open, setOpen] = useState(null); // { productId, piece? }
  const [scanBox, setScanBox] = useState(false);
  const [scanText, setScanText] = useState("");
  const [scanMsg, setScanMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let off = false;
    loadStockRoomCatalogue().then((c) => { if (!off) setCatalogue(c); }).catch((e) => !off && setError(e.message));
    loadSales(90).then((rows) => { if (!off) setSales(rows); }).catch(() => !off && setSales([]));
    loadLedger().then((l) => { if (!off) setLedger(l); }).catch(() => !off && setLedger({ installed: false }));
    loadPieces().then((r) => { if (!off) setPieces(r.pieces); });
    return () => { off = true; };
  }, []);

  const data = useMemo(() => (catalogue ? {
    ...catalogue, stockOrders: [], recentOrders: sales || [], ordersReady: true, salesReady: !!sales,
  } : null), [catalogue, sales]);
  const view = useStockRoomView(data, 90, ledger);

  const heldByProduct = useMemo(() => {
    const m = {};
    pieces.forEach((x) => { if (x.status === "held" && new Date(x.held_until) > new Date()) m[x.product_id] = (m[x.product_id] || 0) + 1; });
    return m;
  }, [pieces]);

  const rows = useMemo(() => {
    if (!view) return [];
    const needle = q.trim().toLowerCase();
    return view.rows
      .filter((r) => r.type === TYPE_LXRTS || r.type === TYPE_CUSTOM)
      .filter((r) => filter === "all" || (r.stock.tracked && (r.stock.unlimited || r.stock.total > 0)) || heldByProduct[r.id])
      .filter((r) => !needle || `${r.product.name} ${r.product.sku_id || ""}`.toLowerCase().includes(needle));
  }, [view, q, filter, heldByProduct]);
  const [visible, more] = usePaged(rows, 50, `${q}|${filter}`);

  const onScan = useCallback(async (raw) => {
    const code = String(raw || "").trim().toUpperCase();
    if (!code || busy) return;
    setBusy(true);
    setScanMsg(null);
    try {
      const piece = await findPiece(code);
      if (!piece) { setScanMsg(`No piece has the code ${code}.`); setScanBox(true); return; }
      if (!view?.rowsById[piece.product_id]) { setScanMsg(`${code} belongs to a design that is not live.`); setScanBox(true); return; }
      setScanBox(false);
      setScanText("");
      setOpen({ productId: piece.product_id, piece });
    } catch (e) {
      setScanMsg(e.message);
      setScanBox(true);
    } finally {
      setBusy(false);
    }
  }, [busy, view]);

  useBarcodeScanner({ onScan, enabled: !!view && !busy });

  const row = open && view ? view.rowsById[open.productId] : null;

  return (
    <div className="sr sr-embed">
      <div className="sai-head">
        <div>
          <h2 className="sai-title">Inventory</h2>
          <span className="sr-muted">Ready pieces from the Stock Room. Scan a label with the scanner gun to see its details.</span>
        </div>
        <button type="button" className="sr-btn sr-btn-primary" onClick={() => { setScanMsg(null); setScanBox(true); }}>Scan label</button>
      </div>

      {error && <p className="sr-error" role="alert">{error}</p>}

      <div className="sai-tools">
        <SearchField value={q} onChange={setQ} placeholder="Search design or SKU" label="Search inventory" />
        <Seg options={TYPE_FILTERS} value={filter} onChange={setFilter} label="Show" />
        {view && <span className="sr-muted">{rows.length} design{rows.length === 1 ? "" : "s"}</span>}
      </div>

      {!view ? <p className="sr-empty">Loading stock…</p> : rows.length === 0 ? <p className="sr-empty">Nothing matches.</p> : (
        <div className="sr-scroller">
          <table className="sr-table">
            <thead><tr><th>Design</th><th>Type</th><th>Sizes</th><th className="n">In stock</th><th className="n">Held by SAs</th><th className="n">Price</th></tr></thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="is-link" onClick={() => setOpen({ productId: r.id })} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter") setOpen({ productId: r.id }); }}>
                  <td><ProductCell product={r.product} /></td>
                  <td><Badge tone="plain">{TYPE_LABELS[r.type]}</Badge></td>
                  <td><SizeSummary sizes={r.stock.sizes} stock={r.type === TYPE_LXRTS ? r.stock : null} /></td>
                  <td className="n tot">{r.stock.unlimited ? "Unlimited" : formatUnits(r.stock.total)}</td>
                  <td className="n">{heldByProduct[r.id] ? formatUnits(heldByProduct[r.id]) : "–"}</td>
                  <td className="n">{r.price ? formatInr(r.price) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {more}
        </div>
      )}

      {/* Windows go to <body>: inside the dashboard's grid they sit under its layers. */}
      {(row || scanBox) && createPortal(<div className="sr sr-portal">{row && (
        <ProductDetail row={row} view={view} warehousesById={{}} salesDays={90} onClose={() => setOpen(null)}
          openAction={() => {}} canWrite={false} canEditProducts={false} openEditor={() => {}} piece={open.piece} />
      )}

      {scanBox && (
        <div className="sr-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setScanBox(false); }}>
          <form className="sr-modal sai-scan" role="dialog" aria-modal="true" aria-label="Scan a label"
            onSubmit={(e) => { e.preventDefault(); onScan(scanText); }}>
            <div className="sr-modal-head"><h2>Scan a label</h2></div>
            <div className="sr-modal-body">
              <p className="sr-card-sub">Point the scanner gun at the label, or type the code under the barcode.</p>
              {scanMsg && <p className="sr-error" role="alert">{scanMsg}</p>}
              <input autoFocus className="sr-input" value={scanText} placeholder="e.g. NAS-RED-ST-L-001"
                onChange={(e) => setScanText(e.target.value.toUpperCase())} aria-label="Label code" />
              <div className="sai-scan-actions">
                <button type="button" className="sr-btn" onClick={() => setScanBox(false)}>Close</button>
                <button type="submit" className="sr-btn sr-btn-primary" disabled={!scanText.trim() || busy}>{busy ? "Looking…" : "Show details"}</button>
              </div>
            </div>
          </form>
        </div>
      )}</div>, document.body)}
    </div>
  );
}
