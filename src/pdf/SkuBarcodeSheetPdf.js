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
 * SkuBarcodeSheetPdf — a printable sheet of pre-allocated SKU barcodes.
 *
 * The warehouse prints these, cuts them out and sticks them on physical
 * garments that aren't in the catalogue yet. Scanning a tag later opens the
 * Add Product form with that SKU already locked in.
 *
 * Each SKU on this sheet already exists as a reserved row in `products`
 * (flagged is_draft) — see db/…/v2/74_reserve_sku_rows.sql. Printing does not
 * reserve anything; the reservation happened before this document was
 * rendered, which is why re-printing a lost sheet is safe.
 *
 * LAYOUT: 2 across x 3 down = 6 per A4 portrait page.
 * Deliberately large. These get scanned off fabric by a handheld gun at
 * whatever angle the garment happens to hang, so bar width matters far more
 * than fitting many per page. Each cell is ~98 x 88mm.
 *
 * This is a plain grid for printing on ordinary A4 and cutting by hand. It is
 * NOT aligned to any pre-cut label stock (Avery/Zebra) — matching a specific
 * sheet's pitch would need that stock's exact margins.
 */

const COLORS = {
  text: "#000000",
  muted: "#888888",
  guide: "#CCCCCC",
};

// 2 x 3. These two numbers re-shape the grid, but `cell.height` below must be
// re-derived to match or rows spill onto a second page. The arithmetic:
//   A4 portrait          = 595 x 842pt
//   minus page padding   = 555 x 800pt of content
//   minus footer (~26pt) = 774pt of usable height
//   774 / 3 rows         = 258pt max per row -> 250 chosen, leaving slack
const COLS = 2;
const ROWS = 3;
export const LABELS_PER_PAGE = COLS * ROWS;

const styles = StyleSheet.create({
  page: {
    paddingTop: 24,
    paddingBottom: 18,
    paddingHorizontal: 20,
    backgroundColor: "#FFFFFF",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  // 50% each so two sit side by side: ~278pt (98mm) wide, 250pt (88mm) tall.
  // 3 rows = 750pt, inside the 774pt usable height. See the arithmetic above.
  cell: {
    width: "50%",
    height: 250,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 0.5,
    borderColor: COLORS.guide,
    borderStyle: "dashed",
    padding: 8,
  },
  // The barcode PNG already has the SKU text rendered underneath it by
  // jsbarcode (displayValue: true), so the cell needs no separate label.
  barcode: {
    width: 250,
    height: 150,
    objectFit: "contain",
  },
  // Shown only if the image failed to generate — better a readable SKU than a
  // blank sticker that can't be identified at all.
  fallback: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: COLORS.text,
  },
  footer: {
    marginTop: 10,
    textAlign: "center",
    fontSize: 7,
    color: COLORS.muted,
  },
});

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/**
 * @param {Array<{sku: string, image: string|null}>} labels
 *        `image` is a Code128 PNG data URL from generateLabelBarcodeDataUrl.
 * @param {string} printedOn  Pre-formatted date string. Passed in rather than
 *        computed here so the caller owns formatting (and so this component
 *        stays pure/deterministic for testing).
 */
const SkuBarcodeSheetPdf = ({ labels = [], printedOn = "" }) => {
  const pages = chunk(labels, LABELS_PER_PAGE);
  const first = labels[0]?.sku;
  const last = labels[labels.length - 1]?.sku;
  const range = first && last ? (first === last ? first : `${first} – ${last}`) : "";

  return (
    <Document>
      {pages.map((pageLabels, pageIndex) => (
        <Page key={pageIndex} size="A4" style={styles.page}>
          <View style={styles.grid}>
            {pageLabels.map((label) => (
              <View key={label.sku} style={styles.cell}>
                {label.image ? (
                  <Image src={label.image} style={styles.barcode} />
                ) : (
                  <Text style={styles.fallback}>{label.sku}</Text>
                )}
              </View>
            ))}
          </View>

          {/* Traceability: which batch this sheet came from, so a reprint
              request ("we lost the sheet with 1051-1070") is answerable. */}
          <Text style={styles.footer}>
            {range}
            {printedOn ? `   ·   printed ${printedOn}` : ""}
            {pages.length > 1 ? `   ·   page ${pageIndex + 1} of ${pages.length}` : ""}
          </Text>
        </Page>
      ))}
    </Document>
  );
};

export default SkuBarcodeSheetPdf;
