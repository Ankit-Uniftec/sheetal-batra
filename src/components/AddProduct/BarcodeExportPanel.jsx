import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { fetchAllRows } from "../../utils/fetchAllRows";
import { downloadSkuBarcodeSheet } from "../../utils/pdfLazy";
import Popup, { usePopup } from "../Popup";
import Paginator from "../Paginator";

/**
 * BarcodeExportPanel — reserve a block of SKUs and print them as barcode tags.
 *
 * The warehouse sticks these on physical garments that aren't in the catalogue
 * yet, then scans a tag to fill in that product's details.
 *
 * Reserving CREATES the rows in `products`, flagged is_draft. That is what
 * makes the number un-reusable: the existing max+1 SKU logic in AddProduct
 * counts past reserved rows, so nothing can ever mint a number that is already
 * printed on a sticker. See db/…/v2/74_reserve_sku_rows.sql.
 *
 * Reserved rows are hidden from the rest of the app by the products_live view,
 * so they don't reach the order form or any dashboard count until they're
 * filled in.
 */

const MAX_PER_BATCH = 500;   // mirrors the RPC's own guard
const RESERVED_PER_PAGE = 24;

export default function BarcodeExportPanel({ onReserved }) {
  const { showPopup, PopupComponent } = usePopup();

  const [count, setCount] = useState("20");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [reserved, setReserved] = useState([]);
  const [loadingReserved, setLoadingReserved] = useState(true);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());

  const parsedCount = parseInt(count, 10);
  const countValid = Number.isFinite(parsedCount) && parsedCount >= 1 && parsedCount <= MAX_PER_BATCH;

  // Outstanding reservations: printed (or at least allocated) but not yet
  // filled in. Base `products`, not products_live — these are precisely the
  // rows that view exists to hide.
  const loadReserved = useCallback(async () => {
    setLoadingReserved(true);
    const { data, error } = await fetchAllRows("products", (q) => q
      .select("id, sku_id")
      .eq("is_draft", true)
      .like("sku_id", "SKU-%"));
    if (error) {
      console.error("Failed to load reserved SKUs:", error);
      setReserved([]);
    } else {
      // Newest first. Sort numerically — string ordering puts SKU-999 after
      // SKU-1000 once the series crosses a digit boundary.
      const num = (s) => parseInt((s || "").replace(/^SKU-/i, ""), 10) || 0;
      setReserved([...(data || [])].sort((a, b) => num(b.sku_id) - num(a.sku_id)));
    }
    setLoadingReserved(false);
  }, []);

  useEffect(() => { loadReserved(); }, [loadReserved]);

  const totalPages = Math.ceil(reserved.length / RESERVED_PER_PAGE);
  const pageRows = useMemo(
    () => reserved.slice((page - 1) * RESERVED_PER_PAGE, page * RESERVED_PER_PAGE),
    [reserved, page]
  );

  const toggle = (sku) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku); else next.add(sku);
      return next;
    });
  };

  const doReserve = async () => {
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.rpc("reserve_sku_rows", {
        p_count: parsedCount,
        p_by: user?.email || localStorage.getItem("sp_email") || null,
      });
      if (error) throw error;

      const skus = (data || []).map((r) => r.sku_id).filter(Boolean);
      if (skus.length === 0) throw new Error("No SKUs were reserved.");

      await downloadSkuBarcodeSheet(skus);
      await loadReserved();
      onReserved?.(skus);

      showPopup({
        type: "success",
        title: "Barcodes Reserved",
        message: `${skus.length} reserved — ${skus[0]} to ${skus[skus.length - 1]}. The PDF has opened in a new tab; if it didn't, allow pop-ups and re-print from the list below.`,
        confirmText: "OK",
      });
    } catch (e) {
      console.error("Reserve/print failed:", e);
      showPopup({
        type: "error",
        title: "Could Not Reserve Barcodes",
        message: e?.message || "Something went wrong. No barcodes were printed.",
        confirmText: "OK",
      });
    } finally {
      setBusy(false);
    }
  };

  // Re-print never reserves. It re-renders labels for numbers that already
  // exist, which is how a lost or damaged sheet is recovered without burning a
  // second range.
  const rePrint = async (skus) => {
    if (skus.length === 0) return;
    setBusy(true);
    try {
      await downloadSkuBarcodeSheet(skus);
    } catch (e) {
      console.error("Re-print failed:", e);
      showPopup({
        type: "error",
        title: "Re-print Failed",
        message: e?.message || "Could not generate the PDF.",
        confirmText: "OK",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ap-barcode-panel">
      {PopupComponent}

      {/* usePopup can't carry custom content (its PopupComponent doesn't forward
          children), so the confirm is a direct <Popup> — it does accept them. */}
      <Popup
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        type="confirm"
        title="Reserve these barcodes?"
        confirmText="Reserve & Print"
        cancelText="Cancel"
        onConfirm={doReserve}
      >
        <p className="popup-message">
          This permanently reserves <strong>{countValid ? parsedCount : 0}</strong>{" "}
          SKU {parsedCount === 1 ? "number" : "numbers"}. They can't be reassigned
          later, even if the printed labels are never used — so print only what
          you're about to stick on garments.
        </p>
      </Popup>

      <div className="ap-section-title">Export Barcodes</div>
      <p className="ap-help">
        Reserves the next SKU numbers and opens a printable A4 sheet (6 tags per
        page). Stick them on the garments, then use <strong>Scan Code</strong> to
        fill in each product's details.
      </p>

      <div className="ap-barcode-controls">
        <div className="ap-field">
          <label>How many barcodes?</label>
          <input
            type="number"
            className="ap-input"
            value={count}
            min="1"
            max={MAX_PER_BATCH}
            onChange={(e) => setCount(e.target.value)}
            disabled={busy}
          />
          <span className="ap-help">1–{MAX_PER_BATCH} at a time.</span>
        </div>

        <button
          type="button"
          className="ap-btn-primary"
          disabled={busy || !countValid}
          onClick={() => setConfirmOpen(true)}
        >
          {busy ? "Working…" : "Reserve & Print"}
        </button>
      </div>

      <div className="ap-section-title">
        Awaiting details{reserved.length > 0 ? ` (${reserved.length})` : ""}
      </div>
      <p className="ap-help">
        Barcodes that have been reserved but not filled in yet. They stay hidden
        from the order form and all dashboards until their details are added.
      </p>

      {loadingReserved ? (
        <p className="ap-help">Loading…</p>
      ) : reserved.length === 0 ? (
        <p className="ap-help">Nothing outstanding — every reserved barcode has been filled in.</p>
      ) : (
        <>
          <div className="ap-barcode-actions">
            {/* ap-text-btn, not ap-mini-btn: the latter is a fixed 38x38 icon
                button (for the SKU field's arrow/cross) and squashes labels. */}
            <button
              type="button"
              className="ap-text-btn"
              disabled={busy || selected.size === 0}
              onClick={() => rePrint([...selected])}
            >
              Re-print selected ({selected.size})
            </button>
            <button
              type="button"
              className="ap-text-btn"
              disabled={busy}
              onClick={() => rePrint(pageRows.map((r) => r.sku_id))}
            >
              Re-print this page
            </button>
            {selected.size > 0 && (
              <button type="button" className="ap-text-btn" onClick={() => setSelected(new Set())}>
                Clear selection
              </button>
            )}
          </div>

          <div className="ap-reserved-grid">
            {pageRows.map((r) => (
              <label
                key={r.id}
                className={`ap-reserved-chip ${selected.has(r.sku_id) ? "selected" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(r.sku_id)}
                  onChange={() => toggle(r.sku_id)}
                />
                <span>{r.sku_id}</span>
              </label>
            ))}
          </div>

          <Paginator page={page} totalPages={totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}
