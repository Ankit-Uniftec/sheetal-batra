import React from "react";
import {
  Document,
  Page,
  Text,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

/**
 * SkuBarcodeSheetPdf — printable SKU barcode tags for pre-printed garment labels.
 *
 * The warehouse sticks these on physical garments that aren't in the catalogue
 * yet. Scanning a tag later opens the Add Product form with that SKU locked in.
 *
 * Each SKU here already exists as a reserved row in `products` (flagged
 * is_draft) — see db/…/v2/74_reserve_sku_rows.sql. Printing does not reserve
 * anything; the reservation happened before this document was rendered, which
 * is why re-printing a lost batch is safe.
 *
 * ── LAYOUT: ONE 50 x 25mm LABEL PER PAGE ─────────────────────────────────
 * Sized for a thermal label printer (Zebra/TSC/Godex class) feeding a roll of
 * pre-cut 50x25mm labels. On that hardware a "page" IS a label: the printer
 * advances one label per PDF page, so the page size must equal the label size
 * exactly. An A4 page with a grid would print one tiny corner per label and
 * waste the rest of the roll.
 *
 * This replaced a 2x3 A4 grid meant for plain paper and scissors. If you ever
 * need that back, it's in git history at commit 9608019 — don't try to serve
 * both from one document, the two are structurally different.
 *
 * NO PAGE MARGIN AND NO FOOTER, both deliberate:
 *   - Thermal label stock has no bleed. Every printer's die-cut registration
 *     drifts a fraction of a mm, so content is inset via the barcode's own
 *     quiet zone (see QUIET_ZONE) rather than page padding, which would
 *     compound with the printer's own offset.
 *   - There is no room for batch/date traceability on a 25mm label. That
 *     information lives in the Export Barcodes list in the app instead.
 */

// Thermal label physical size. @react-pdf works in PostScript points:
// 1mm = 72/25.4 = 2.8346pt. Declared as mm and converted so the numbers here
// stay checkable against the label roll's box.
const MM = 72 / 25.4;
const LABEL_W_MM = 50;
const LABEL_H_MM = 25;

const PAGE_SIZE = {
  width: LABEL_W_MM * MM,    // 141.7pt
  height: LABEL_H_MM * MM,   // 70.9pt
};

// Inset from the die-cut edge. Small — the barcode PNG carries its own white
// quiet zone from jsbarcode's `margin`, which is what scanners actually need.
// Doubling up here would shrink the bars for no gain.
const QUIET_ZONE = 1.5 * MM;

// ── PRINTER DOT GRID (TSC TE244, 203 DPI) ────────────────────────────────
// A thermal head can only place WHOLE dots. At 203 DPI one dot is 1/203" =
// 0.125mm = 0.3547pt, so any bar width that isn't a whole multiple of that gets
// rounded — and rounded independently per bar, which distorts the symbol and is
// a classic cause of intermittent scan failures.
//
// So the barcode is placed at a FIXED, dot-aligned size and NOT stretched to
// fill the label. Scaling to fit is what breaks this: it lands the module on
// whatever fraction of a dot the SKU's length happens to produce (a 6-digit SKU
// came out at 2.49 dots — right between 2 and 3, the worst possible case).
const DOT = 72 / 203;              // 0.3547pt — one printer dot
const MODULE_DOTS = 2;             // narrowest bar = 2 dots = 9.9 mil
const MODULE_PT = MODULE_DOTS * DOT;

// 2 dots is the only width that fits the whole SKU series. At 3 dots (14.8 mil)
// a 4-digit SKU just fits at 46.2mm, but a 5-digit one needs 50.3mm and
// overflows the 47mm printable width. 9.9 mil is still comfortably above the
// ~5 mil floor where handheld guns start misreading.
const CONTENT_W = PAGE_SIZE.width - 2 * QUIET_ZONE;

// Canvas geometry of the PNG, mirroring generateLabelBarcodeDataUrl's options.
// These MUST stay in step with that function — they are two halves of one
// decision, which is why both carry the same warning.
const CANVAS_MODULE_PX = 2;        // jsbarcode `width`
const CANVAS_MARGIN_PX = 6;        // jsbarcode `margin`, a white quiet zone
// bars (90) + text line (fontSize 16) + textMargin (4) + margin top & bottom.
const CANVAS_HEIGHT_PX = 90 + 16 + 4 + 2 * CANVAS_MARGIN_PX;   // 122px

// Points per canvas pixel — the single scale applied to BOTH dimensions, so
// the PNG is never distorted.
const CANVAS_SCALE = MODULE_PT / CANVAS_MODULE_PX;

// Width to draw the PNG at so one module lands on exactly MODULE_DOTS dots.
//
// The scale factor is MODULE_PT / CANVAS_MODULE_PX (points per canvas pixel);
// the image width is the FULL canvas at that scale. The margin has to be
// included: it is real pixels in the PNG, so sizing to the bars alone would
// squeeze the whole image and drop the module below 2 dots (it measured 1.91).
//
// Code128 symbol width in modules: 11 per encoded char, plus start (11),
// checksum (11) and stop (13). Digit pairs can compress via subset C, so this
// is an upper bound — which is what we want when guaranteeing the label fits.
const imageWidthPt = (sku) => {
  const canvasPx = (11 * (sku || "").length + 35) * CANVAS_MODULE_PX
    + 2 * CANVAS_MARGIN_PX;
  return canvasPx * CANVAS_SCALE;
};

// Same scale as the width, so the PNG keeps its aspect ratio. Comes out ~15.3mm
// on a 21.8mm-tall printable area — the slack is deliberate breathing room
// around the die cut, not wasted space to be filled by stretching the bars.
const IMAGE_HEIGHT_PT = CANVAS_HEIGHT_PX * CANVAS_SCALE;

// One label per page. Kept exported: BarcodeExportPanel's copy still reads it
// to describe the output, and callers shouldn't have to know the layout.
export const LABELS_PER_PAGE = 1;

const styles = StyleSheet.create({
  page: {
    padding: QUIET_ZONE,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  // Width AND height are both set per-label at render time, from the same
  // scale factor, so the image keeps its natural aspect ratio and one module
  // lands on exactly MODULE_DOTS printer dots. Nothing is fixed here: giving
  // either dimension a constant would re-introduce scale-to-fit and put the
  // bars back on fractions of a dot.
  barcode: {
    objectFit: "contain",
  },
  // Shown only if the image failed to generate — a readable SKU beats a blank
  // sticker that can't be identified at all.
  fallback: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#000000",
  },
});

/**
 * @param {Array<{sku: string, image: string|null}>} labels
 *        `image` is a Code128 PNG data URL from generateLabelBarcodeDataUrl.
 * @param {string} printedOn  Accepted and ignored — a 25mm label has no room
 *        for a date. Kept in the signature so the caller in pdfUtils.js doesn't
 *        need changing, and so re-adding a wider label format later is trivial.
 */
const SkuBarcodeSheetPdf = ({ labels = [] }) => (
  <Document>
    {labels.map((label) => {
      // Width comes from the SKU's own symbol so the module stays exactly 2
      // printer dots wide. Capped at the printable width as a last resort: an
      // implausibly long SKU shrinks (losing dot alignment) rather than bleeding
      // off the label, where the bars would simply be cut off and unscannable.
      const width = Math.min(imageWidthPt(label.sku), CONTENT_W);
      return (
        <Page key={label.sku} size={PAGE_SIZE} style={styles.page}>
          {label.image ? (
            <Image
              src={label.image}
              style={[styles.barcode, { width, height: IMAGE_HEIGHT_PT }]}
            />
          ) : (
            <Text style={styles.fallback}>{label.sku}</Text>
          )}
        </Page>
      );
    })}
  </Document>
);

export default SkuBarcodeSheetPdf;
