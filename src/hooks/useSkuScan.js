import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import useBarcodeScanner from "./useBarcodeScanner";
import { classifyBarcode, BARCODE_KIND, normalizeSku } from "../utils/barcodeKind";

/**
 * useSkuScan — scan a pre-printed SKU tag and resolve what it points at.
 *
 * Wraps the generic useBarcodeScanner (HID detection, key swallowing) and adds
 * the one thing that's specific to product tags: deciding whether the scanned
 * SKU is a reserved-but-unfilled row, an already-filled product, or nothing at
 * all. Renders nothing and knows about no dashboard, so it drops into any
 * screen — currently the Add Product tab.
 *
 * Non-SKU barcodes are reported but never acted on, so this can safely sit on a
 * page where other scan surfaces exist without stealing their codes.
 *
 * @param {object}   p
 * @param {boolean}  [p.enabled=true]  Gate this per-tab. Load-bearing: the
 *        underlying listener is document-level, so two enabled scanners on one
 *        page would both fire for every scan.
 * @param {(result) => void} p.onResult  Called with a discriminated union:
 *        { type: "reserved", sku, row }     row exists, is_draft -> fill it in
 *        { type: "filled",   sku, product } already a real product -> show it
 *        { type: "unknown",  sku }          no row: not from an export
 *        { type: "other",    kind, raw }    a production barcode, ignored here
 *        { type: "error",    sku, error }   lookup failed (never treated as
 *                                           "unknown" — that would create a
 *                                           duplicate product)
 * @returns {{ resolving: boolean, resolveManual: (text: string) => Promise<void> }}
 */
export default function useSkuScan({ enabled = true, onResult } = {}) {
  const [resolving, setResolving] = useState(false);

  // Held in a ref so the scanner's effect doesn't re-subscribe every time the
  // caller re-renders with a fresh inline callback. useBarcodeScanner's deps
  // already include a new array identity per render; keeping our own onScan
  // stable is what stops that from churning the document listener mid-scan.
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  // Guards against a double-trigger of the same tag (scanner bounce, or a gun
  // that fires twice on a long press) re-running the lookup.
  const lastRef = useRef({ sku: "", ts: 0 });
  const DEDUPE_MS = 800;

  const resolve = useCallback(async (raw) => {
    const emit = (r) => onResultRef.current?.(r);

    const kind = classifyBarcode(raw);
    if (kind !== BARCODE_KIND.SKU) {
      emit({ type: "other", kind, raw });
      return;
    }

    const sku = normalizeSku(raw);
    if (!sku) {
      emit({ type: "other", kind: BARCODE_KIND.UNKNOWN, raw });
      return;
    }

    const now = Date.now();
    if (lastRef.current.sku === sku && now - lastRef.current.ts < DEDUPE_MS) return;
    lastRef.current = { sku, ts: now };

    setResolving(true);
    try {
      // Base `products`, NOT products_live — the whole point is to find rows
      // that view hides (is_draft = true). maybeSingle: sku_id is unique, and a
      // miss is a normal outcome here rather than an error.
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("sku_id", sku)
        .maybeSingle();

      if (error) {
        // Deliberately NOT reported as "unknown". Treating a failed lookup as
        // "no such product" would send the user into the create-a-product flow
        // for a SKU that already exists, producing a duplicate.
        emit({ type: "error", sku, error });
        return;
      }

      if (!data) {
        emit({ type: "unknown", sku });
      } else if (data.is_draft) {
        // Reserved by reserve_sku_rows for a pre-printed barcode: the number
        // exists, the product doesn't yet. is_draft is the marker rather than a
        // blank name because products.name is NOT NULL — a reserved row carries
        // its own SKU as a placeholder name.
        emit({ type: "reserved", sku, row: data });
      } else {
        emit({ type: "filled", sku, product: data });
      }
    } catch (err) {
      emit({ type: "error", sku, error: err });
    } finally {
      setResolving(false);
    }
  }, []);

  useBarcodeScanner({
    onScan: resolve,
    enabled,
    // "SKU-1040" is 8 chars; the default of 5 is already fine, but pin it so a
    // future default change can't silently start dropping short SKUs.
    minLength: 5,
  });

  // Same pipeline for a hand-typed code, for when a label is damaged or the
  // gun is missing. Bypasses the dedupe reset intentionally — a deliberate
  // retype should always re-run.
  const resolveManual = useCallback(async (text) => {
    lastRef.current = { sku: "", ts: 0 };
    await resolve(text);
  }, [resolve]);

  return { resolving, resolveManual };
}
