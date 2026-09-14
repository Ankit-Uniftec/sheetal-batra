import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

/**
 * SkuBarcodeSheetPdf — printable barcode tags for pre-printed garment labels.
 *
 * The warehouse sticks these on physical garments that aren't in the catalogue
 * yet. Scanning a tag later opens the Add Product form with that SKU locked in.
 *
 * Each SKU here already exists as a reserved row in `products` (flagged
 * is_draft) — see db/…/v2/74_reserve_sku_rows.sql. Printing does not reserve
 * anything; the reservation happened before this document was rendered, which
 * is why re-printing a lost batch is safe.
 *
 * ── ONE LABEL PER PAGE, SIZED BY THE TEMPLATE ────────────────────────────
 * Sized for a thermal label printer (Zebra/TSC/Godex class) feeding a roll of
 * pre-cut labels. On that hardware a "page" IS a label: the printer advances
 * one label per PDF page, so the page size must equal the label size exactly.
 * An A4 page with a grid would print one tiny corner per label and waste the
 * rest of the roll.
 *
 * The size and the text lines come from `template` (label_templates, migration
 * 92) rather than being constants here, because the label roll is a purchasing
 * decision and the wording is the client's. Defaults reproduce the original
 * fixed 50x25mm / bars-and-SKU-only slip exactly, so an absent or unreadable
 * template prints what this file always printed.
 *
 * A 2x3 A4 grid for plain paper and scissors is in git history at commit
 * 9608019 — don't try to serve both from one document, they are structurally
 * different.
 *
 * NO PAGE MARGIN AND NO FOOTER, both deliberate:
 *   - Thermal label stock has no bleed. Every printer's die-cut registration
 *     drifts a fraction of a mm, so content is inset via the barcode's own
 *     quiet zone (see QUIET_ZONE) rather than page padding, which would
 *     compound with the printer's own offset.
 *   - Batch/date traceability does not fit on a small label. That information
 *     lives in the Export Barcodes list in the app instead.
 */

// @react-pdf works in PostScript points: 1mm = 72/25.4 = 2.8346pt. Sizes are
// declared in mm and converted so the numbers stay checkable against the label
// roll's box.
const MM = 72 / 25.4;

// The original fixed label. Still the default, so nothing changes for a shop
// that never opens the designer.
export const DEFAULT_TEMPLATE = {
  width_mm: 50,
  height_mm: 25,
  lines: [],
  show_value: true,
};

// Inset from the die-cut edge. Small — the barcode PNG carries its own white
// quiet zone from jsbarcode's `margin`, which is what scanners actually need.
// Doubling up here would shrink the bars for no gain.
const QUIET_ZONE = 1.5 * MM;

// Extra left/right inset for the TEXT block only, on top of QUIET_ZONE.
//
// The barcode keeps the bare 1.5mm die-cut allowance because its own PNG
// already carries a white quiet zone. Text has no such margin of its own, so
// at 1.5mm the captions sat hard against the die cut and read as if they were
// about to fall off the sticker. 1.5mm more puts them at ~3mm from the edge,
// which survives the registration drift of a thermal printer.
const TEXT_INSET = 1.5 * MM;

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
//
// This is why the template can resize the LABEL but not the bars: the bars
// belong to the printer's dot grid, the label belongs to the roll.
const DOT = 72 / 203;              // 0.3547pt — one printer dot
const MODULE_DOTS = 2;             // narrowest bar = 2 dots = 9.9 mil
const MODULE_PT = MODULE_DOTS * DOT;

// Canvas geometry of the PNG, mirroring generateLabelBarcodeDataUrl's options.
// These MUST stay in step with that function — they are two halves of one
// decision, which is why both carry the same warning.
const CANVAS_MODULE_PX = 2;        // jsbarcode `width`
const CANVAS_MARGIN_PX = 6;        // jsbarcode `margin`, a white quiet zone
const BAR_PX = 90;                 // jsbarcode `height` — bars only
const VALUE_PX = 16 + 4;           // fontSize + textMargin, only when shown

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
const imageWidthPt = (value) => {
  const canvasPx = (11 * (value || "").length + 35) * CANVAS_MODULE_PX
    + 2 * CANVAS_MARGIN_PX;
  return canvasPx * CANVAS_SCALE;
};

// Same scale as the width, so the PNG keeps its aspect ratio. Height depends on
// whether jsbarcode drew the human-readable value, which the template controls.
const imageHeightPt = (showValue) =>
  (BAR_PX + (showValue ? VALUE_PX : 0) + 2 * CANVAS_MARGIN_PX) * CANVAS_SCALE;

// One label per page. Kept exported: BarcodeExportPanel's copy still reads it
// to describe the output, and callers shouldn't have to know the layout.
export const LABELS_PER_PAGE = 1;

const styles = StyleSheet.create({
  page: {
    padding: QUIET_ZONE,
    backgroundColor: "#FFFFFF",
    // Children are centred so the BARCODE sits in the middle of the label.
    // The text block below stretches full width and left-aligns its own rows.
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
  // One tag row: "Style   POTLI PUR      potli". Matches the physical tag —
  // a caption column, a value column aligned under each other, and an optional
  // note on the right. Left-aligned, NOT centred: centred values do not line up
  // into a column, which is what makes a real tag readable at a glance.
  row: {
    flexDirection: "row",
    alignItems: "baseline",
    width: "100%",
    // The row must never grow taller than one line. Without this a long value
    // wrapped, pushed its own caption out of line and spilled the rest of the
    // design onto a SECOND STICKER.
    flexWrap: "nowrap",
  },
  caption: {
    color: "#000000",
    flexGrow: 0,
    flexShrink: 0,
  },
  value: {
    color: "#000000",
    flexGrow: 1,
    // minWidth 0 is what actually lets a flex child shrink below its content
    // width; without it the text box refuses to narrow and maxLines has
    // nothing to clip against, so it wraps instead.
    flexShrink: 1,
    minWidth: 0,
    overflow: "hidden",
  },
  suffix: {
    color: "#000000",
    flexShrink: 0,
    marginLeft: 4,
  },
  lines: {
    width: "100%",
    marginTop: 2,
    // Inset on BOTH sides, so the right-hand end of a long value keeps the
    // same breathing room as the caption on the left.
    paddingLeft: TEXT_INSET,
    paddingRight: TEXT_INSET,
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
 * @param {Array<{sku: string, image: string|null, values?: object}>} labels
 *        `image` is a Code128 PNG data URL from generateLabelBarcodeDataUrl.
 *        `values` maps a template line's `field` to the text to print for THIS
 *        label (the product's name, price…). Absent fields are skipped rather
 *        than printed blank — an empty line wastes scarce vertical space.
 * @param {object} template  A label_templates row. Falsy → DEFAULT_TEMPLATE.
 * @param {string} printedOn  Accepted and ignored — a small label has no room
 *        for a date. Kept in the signature so the caller in pdfUtils.js doesn't
 *        need changing.
 */
const SkuBarcodeSheetPdf = ({ labels = [], template }) => {
  const t = { ...DEFAULT_TEMPLATE, ...(template || {}) };

  const pageSize = {
    width: Number(t.width_mm) * MM,
    height: Number(t.height_mm) * MM,
  };
  const contentW = pageSize.width - 2 * QUIET_ZONE;
  // What a text ROW actually has to work with, once its own inset is taken off.
  // Used for clipping: measuring a long value against the full label width
  // would let it run straight into the padding that was just added.
  const textW = contentW - 2 * TEXT_INSET;
  const imgH = imageHeightPt(t.show_value !== false);

  // How many text rows actually fit UNDER the bars on this label.
  //
  // A row that does not fit does not shrink — @react-pdf pushes it onto a new
  // PAGE, and a page here is a physical sticker. A 4-row design on 50x25mm
  // stock silently consumed two labels and split one tag across both. Dropping
  // the overflow is the lesser evil: one complete tag beats two broken ones,
  // and the designer warns before it is ever saved.
  //
  // 1.2 is @react-pdf's default line height; ROW_GAP mirrors styles.lines'
  // marginTop.
  const ROW_GAP = 2;
  const availH = pageSize.height - 2 * QUIET_ZONE - imgH - ROW_GAP;

  // One line per row. A row that does not fit is DROPPED, never pushed onto a
  // new page — a page here is a physical sticker, and spilling splits one tag
  // across two.
  const rowsThatFit = (rows) => {
    let used = 0, n = 0;
    for (const r of rows) {
      const h = (Number(r.ln.size) || 5) * 1.2;
      if (used + h > availH) break;
      used += h;
      n += 1;
    }
    return rows.slice(0, n);
  };

  // A line prints only when it resolves to text. "custom" is the literal the
  // designer types (a brand name, a care note); every other field reads the
  // product's own value for this label.
  const textFor = (line, label) =>
    (line.field === "custom" ? line.label : label.values?.[line.field]) ?? "";

  // Width of the caption column, in ems, sized to the longest caption actually
  // in the design so the values sit just after it.
  //
  // Per-character widths rather than a flat average: "MRP:" and "Name:" are
  // the same length but not the same width, and a flat 0.55em over-measured
  // every caption, leaving a visible trench between label and value.
  // Helvetica widths, /1000 em.
  const HELV = { default: 556, i: 222, l: 222, j: 222, f: 278, t: 278, r: 333,
    I: 278, J: 500, ':': 278, ' ': 278, m: 833, w: 722, M: 833, W: 944 };
  const emWidth = (str) =>
    [...String(str)].reduce((w, ch) => w + (HELV[ch] ?? HELV.default), 0) / 1000;

  // +0.5em gutter before the value: enough to read as a column, small enough
  // that a short caption does not strand its value mid-label.
  //
  // Computed from the TEMPLATE (not per row) so every row shares one column —
  // that shared edge is what makes the values line up.
  const capMaxEm = Math.min(
    9,
    Math.max(
      2.2,
      ...(t.lines || [])
        .filter((ln) => ln.caption)
        .map((ln) => emWidth(`${ln.caption}:`) + 0.5)
    )
  );

  // One "Caption: Value  suffix" row. Extracted so the two columns below can
  // each render it without duplicating the markup.
  const renderRow = ({ ln, text }, key) => {
    const size = Number(ln.size) || 5;
    const font = ln.bold ? "Helvetica-Bold" : "Helvetica";
    // Caption column is sized to the LONGEST caption actually in use (capMaxEm,
    // computed once per label), not to a fixed guess. A fixed 5.2 ems fit
    // "Category:" with nothing to spare and clipped anything longer; measuring
    // means the values stay in a column whatever the client types.
    const capW = size * capMaxEm;
    // The colon is added HERE, not stored in the caption, so the client types
    // "Color" and not "Color:" — and a caption that already ends in one does
    // not end up with two.
    const captionText = /[:：]\s*$/.test(ln.caption || "") ? ln.caption : `${ln.caption}:`;
    return (
      // Width pinned to the inset text area, not the whole label: a flex row
      // without an explicit width measures against its parent, and a long
      // value would then be clipped at the label edge rather than at the
      // padding.
      <View key={key} style={[styles.row, { width: textW }]}>
        {ln.caption ? (
          <Text
            maxLines={1}
            style={[styles.caption, { fontSize: size, fontFamily: font, width: capW }]}
          >
            {captionText}
          </Text>
        ) : null}
        <Text
          // Clipped to one line: a long product name that wrapped would push
          // the bars off the label, and a cropped name is recoverable where an
          // unscannable barcode is not.
          maxLines={1}
          style={[
            styles.value,
            {
              fontSize: size,
              fontFamily: font,
              // Always left. A centred value does not line up with the rows
            // above and below it, which is what makes a stack of them read as
            // a tag rather than a loose pile of text.
            textAlign: "left",
            },
          ]}
        >
          {text}
        </Text>
        {ln.suffix ? (
          <Text style={[styles.suffix, { fontSize: size, fontFamily: font }]}>
            {ln.suffix}
          </Text>
        ) : null}
      </View>
    );
  };

  return (
    <Document>
      {labels.map((label) => {
        // Width comes from the SKU's own symbol so the module stays exactly 2
        // printer dots wide. Capped at the printable width as a last resort: an
        // implausibly long SKU shrinks (losing dot alignment) rather than
        // bleeding off the label, where the bars would be cut off and
        // unscannable.
        const width = Math.min(imageWidthPt(label.sku), contentW);
        const lines = rowsThatFit(
          (t.lines || [])
            .map((ln) => ({ ln, text: String(textFor(ln, label)).trim() }))
            .filter((x) => x.text)
        );

        return (
          <Page key={label.sku} size={pageSize} style={styles.page}>
            {label.image ? (
              <Image
                src={label.image}
                style={[styles.barcode, { width, height: imgH }]}
              />
            ) : (
              <Text style={styles.fallback}>{label.sku}</Text>
            )}

            {lines.length > 0 && (
              // ONE line per row, full width. Two side-by-side columns were
              // tried and reverted: a real product name runs 45+ characters
              // ("Aabish- Daisy Ivory Pearl Embroidered Kurta Set (LXRTS)"),
              // which cannot share a row with anything — it collided with the
              // next column and wrapped into the row below it.
              <View style={styles.lines}>
                {lines.map((r, i) => renderRow(r, i))}
              </View>
            )}
          </Page>
        );
      })}
    </Document>
  );
};

export default SkuBarcodeSheetPdf;
