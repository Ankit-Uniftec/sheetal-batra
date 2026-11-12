import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { FormModal, Field, Seg, Badge } from "./StockRoomUi";
import { sortSizes, sizeLabel, canonicalSize, TYPE_LXRTS, TYPE_CUSTOM } from "./stockRoomModel";
import { loadPieces, pieceLetters } from "../../utils/stockPieces";
import { openPieceLabels } from "../../utils/pdfLazy";

// ============================================================
// Release 35 — print piece labels (50 x 50 mm, one per garment).
//
// Pick colour, ST/CT, size and how many → the database hands out the codes
// (NAS-RED-ST-L-001, serials continue per group) → the labels open as a PDF.
// Below: every label already printed for this design, to reprint a torn one
// (same code) or cancel a misprint (never scannable again).
// ============================================================

const TYPES = [
  { value: "ST", label: "ST · standard colour" },
  { value: "CT", label: "CT · custom colour" },
];
const STATUS_TONE = { available: "gold", held: "plain", sold: "plain", void: "plain" };
const time = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

// canCancel: Stock Room only (SAs print and reprint, but cannot cancel a label).
export default function PieceLabels({ row, onClose, notify, canCancel = true }) {
  const p = row.product;
  const sizes = useMemo(() => sortSizes(row.stock.sizes || p.available_size || []).filter((sz) => /^[A-Za-z0-9]+$/.test(sizeLabel(sz))), [row, p]);
  const [colours, setColours] = useState([]);
  const [colour, setColour] = useState(p.default_color || "");
  const [type, setType] = useState("ST");
  const [typeTouched, setTypeTouched] = useState(false);
  const [size, setSize] = useState(sizes[0] || "");
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [pieces, setPieces] = useState(null);
  const [installed, setInstalled] = useState(true);
  const [picked, setPicked] = useState(() => new Set());

  useEffect(() => {
    supabase.from("colors").select("name").order("name").then(({ data }) => setColours((data || []).map((c) => c.name).filter(Boolean)));
  }, []);

  const reload = async () => {
    const r = await loadPieces([p.id]);
    setPieces(r.pieces);
    setInstalled(r.installed);
  };
  useEffect(() => { reload(); }, [p.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ST when it is the design's own colour, CT otherwise (can be changed).
  useEffect(() => {
    if (typeTouched) return;
    const own = String(p.default_color || "").trim().toLowerCase();
    setType(!own || String(colour).trim().toLowerCase() === own ? "ST" : "CT");
  }, [colour, p.default_color, typeTouched]);

  const stockForSize = row.stock.bySize ? row.stock.bySize[size] ?? Object.entries(row.stock.bySize).find(([k]) => canonicalSize(k) === canonicalSize(size))?.[1] : null;
  const activeForSize = (pieces || []).filter((x) => canonicalSize(x.size) === canonicalSize(size) && (x.status === "available" || x.status === "held")).length;
  const preview = `${pieceLetters(p.name) || "???"}-${pieceLetters(colour) || "???"}-${type}-${sizeLabel(size).toUpperCase() || "?"}-###`;
  const n = Math.floor(Number(qty));

  const problem = !installed ? "Piece labels are not set up yet: run the Release 35 SQL first."
    : !colour.trim() ? "Pick the colour."
      : pieceLetters(colour).length < 3 ? "The colour needs at least 3 letters."
        : pieceLetters(p.name).length < 3 ? "The product name needs at least 3 letters."
          : !size ? "Pick the size."
            : !(n >= 1 && n <= 200) ? "Print 1 to 200 labels at a time." : null;

  const productsById = { [p.id]: p };

  const print = async () => {
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    try {
      const { data, error: e } = await supabase.rpc("stock_pieces_mint", {
        p_product_id: p.id, p_colour: colour.trim(), p_colour_type: type, p_size: sizeLabel(size).toUpperCase(), p_qty: n,
      });
      if (e) throw new Error(e.message);
      await openPieceLabels(data || [], productsById);
      notify?.(`${(data || []).length} label${(data || []).length === 1 ? "" : "s"} printed: ${data?.[0]?.code}${data?.length > 1 ? ` to ${data[data.length - 1].code}` : ""}.`);
      await reload();
    } catch (err) {
      setError(err.message || "Labels could not be printed.");
    } finally {
      setBusy(false);
    }
  };

  const reprint = async () => {
    const list = (pieces || []).filter((x) => picked.has(x.code));
    if (!list.length) return;
    setBusy(true);
    setError(null);
    try {
      await supabase.rpc("stock_pieces_mark_reprinted", { p_codes: list.map((x) => x.code) });
      await openPieceLabels(list, productsById);
      setPicked(new Set());
    } catch (err) {
      setError(err.message || "Labels could not be printed.");
    } finally {
      setBusy(false);
    }
  };

  const cancelLabel = async (code) => {
    const reason = window.prompt(`Cancel label ${code}? It can never be scanned again.\nReason (optional):`, "Misprint");
    if (reason === null) return;
    const { error: e } = await supabase.rpc("stock_piece_void", { p_code: code, p_reason: reason });
    if (e) setError(e.message); else { notify?.(`${code} cancelled.`); reload(); }
  };

  const toggle = (code) => setPicked((s) => { const x = new Set(s); if (x.has(code)) x.delete(code); else x.add(code); return x; });

  return (
    <FormModal title={`Print labels · ${p.name}`} sub={<span>50 × 50 mm, one label per garment · {row.type === TYPE_LXRTS ? "LXRTS: scanning holds the piece and lowers Shopify" : row.type === TYPE_CUSTOM ? "Custom piece: scanning holds the piece" : "Made to order: a scan only fills the order form"}</span>}
      onClose={onClose} onSubmit={print} submitLabel={busy ? "Printing…" : `Print ${n > 0 ? n : ""} label${n === 1 ? "" : "s"}`} submitting={busy} error={error} width={760}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
        <Field label="Colour" hint={p.default_color ? `Design colour: ${p.default_color}` : undefined}>
          <input className="sr-input" list="sr-piece-colours" value={colour} onChange={(e) => setColour(e.target.value)} placeholder="e.g. Red" />
          <datalist id="sr-piece-colours">{colours.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Size">
          <select className="sr-input" value={size} onChange={(e) => setSize(e.target.value)}>
            {sizes.map((sz) => <option key={sz} value={sz}>{sizeLabel(sz)}</option>)}
          </select>
        </Field>
        <Field label="How many" hint={stockForSize != null ? `${stockForSize} in stock · ${activeForSize} label${activeForSize === 1 ? "" : "s"} already on garments` : `${activeForSize} label${activeForSize === 1 ? "" : "s"} already on garments`}>
          <input className="sr-input" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))} />
        </Field>
      </div>
      <div style={{ marginTop: 14 }}>
        <Seg options={TYPES} value={type} onChange={(v) => { setType(v); setTypeTouched(true); }} label="Colour type" />
      </div>
      <p className="sr-card-sub" style={{ marginTop: 12 }}>
        Codes will look like <b className="sr-mono">{preview}</b> (the number continues from the last label of this group).{" "}
        <button type="button" className="sr-linkbtn" disabled={!colour.trim() || !size}
          onClick={() => openPieceLabels([{ code: preview.replace("###", "001"), product_id: p.id, colour: colour.trim(), size: sizeLabel(size).toUpperCase(), mrp: null }], productsById)
            .catch((e) => setError(e.message))}>
          Preview a label
        </button>
        {stockForSize != null && n > 0 && activeForSize + n > stockForSize && (
          <span style={{ color: "var(--sr-warn)" }}> This makes more labels than the {stockForSize} in stock for this size.</span>
        )}
      </p>

      <div className="sr-section-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h3>Labels printed for this design</h3>
        {picked.size > 0 && <button type="button" className="sr-btn" onClick={reprint} disabled={busy}>Reprint selected ({picked.size})</button>}
      </div>
      {pieces === null ? <p className="sr-empty">Loading…</p> : pieces.length === 0 ? <p className="sr-empty">{installed ? "None yet." : "Not set up yet."}</p> : (
        <div className="sr-scroller" style={{ maxHeight: 320 }}>
          <table className="sr-table" style={{ "--sr-table-min": "0px" }}>
            <thead><tr><th className="c">Pick</th><th>Code</th><th>Colour</th><th className="c">Size</th><th>Status</th><th>Printed</th><th /></tr></thead>
            <tbody>
              {pieces.map((x) => (
                <tr key={x.code}>
                  <td className="c">{x.status !== "void" && <input type="checkbox" checked={picked.has(x.code)} onChange={() => toggle(x.code)} aria-label={`Pick ${x.code}`} />}</td>
                  <td className="sr-mono">{x.code}</td>
                  <td>{x.colour}{x.colour_type === "CT" ? " (custom)" : ""}</td>
                  <td className="c">{x.size}</td>
                  <td>
                    <Badge tone={STATUS_TONE[x.status] || "plain"}>{x.status}</Badge>
                    {x.status === "held" && <span className="sr-muted"> {x.held_by_name || x.held_by} · till {time(x.held_until)}</span>}
                    {x.status === "sold" && <span className="sr-muted"> {x.sold_order_no}</span>}
                  </td>
                  <td className="sr-muted">{time(x.created_at)}</td>
                  <td>{canCancel && x.status === "available" && <button type="button" className="sr-linkbtn" onClick={() => cancelLabel(x.code)}>Cancel label</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FormModal>
  );
}
