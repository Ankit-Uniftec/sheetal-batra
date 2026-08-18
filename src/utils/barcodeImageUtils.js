import JsBarcode from "jsbarcode";

/**
 * Generate a barcode image as a PNG data URL
 * Uses an offscreen canvas + JsBarcode to create Code128 barcodes
 * 
 * @param {string} text - The text to encode (e.g. "DLC-000376-TOP")
 * @param {object} options - Optional overrides for JsBarcode
 * @returns {string} PNG data URL that can be used as <Image src={...}> in @react-pdf/renderer
 */
export function generateBarcodeDataUrl(text, options = {}) {
  if (!text) return null;

  // Create an offscreen canvas
  const canvas = document.createElement("canvas");

  try {
    JsBarcode(canvas, text, {
      format: "CODE128",
      width: 2,            // Bar width
      height: 50,          // Barcode height in pixels
      displayValue: true,  // Show text below the barcode
      fontSize: 12,
      font: "monospace",
      textMargin: 4,
      margin: 10,
      background: "#FFFFFF",
      lineColor: "#000000",
      ...options,
    });

    return canvas.toDataURL("image/png");
  } catch (err) {
    console.error("Barcode generation failed for:", text, err);
    return null;
  }
}

/**
 * Generate a smaller barcode for component labels (bottom of PDF)
 */
export function generateSmallBarcodeDataUrl(text) {
  return generateBarcodeDataUrl(text, {
    width: 1.5,
    height: 35,
    fontSize: 9,
    margin: 5,
  });
}

/**
 * Generate a larger master barcode (header of PDF)
 */
export function generateMasterBarcodeDataUrl(text) {
  return generateBarcodeDataUrl(text, {
    width: 2,
    height: 50,
    fontSize: 11,
    margin: 8,
  });
}

/**
 * Generate a barcode for a printable SKU tag on 50 x 25mm thermal label stock
 * (see src/pdf/SkuBarcodeSheetPdf.js — one label per PDF page).
 *
 * ⚠ THESE NUMBERS ARE MIRRORED IN SkuBarcodeSheetPdf.js (CANVAS_MODULE_PX,
 * CANVAS_MARGIN_PX, CANVAS_HEIGHT_PX). That file sizes the <Image> from them so
 * one barcode module lands on exactly 2 printer dots. Change one side without
 * the other and the bars drift off the dot grid — which prints as an uneven
 * symbol and shows up as intermittent scan failures, not an obvious error.
 *
 *   width 2       module (narrowest bar) width in canvas px. The PDF scales the
 *                 image so this becomes 2 dots (9.9 mil) on a 203 DPI head.
 *   height 90     bars only, excluding the text line. Renders ~15mm tall on a
 *                 25mm label — plenty for a handheld gun, and short enough to
 *                 leave room around the die cut.
 *   fontSize 16   the SKU printed under the bars (displayValue defaults true),
 *                 so a damaged label can still be typed in by hand.
 *   textMargin 4  gap between bars and text; part of CANVAS_HEIGHT_PX.
 *   margin 6      jsbarcode's white quiet zone, baked into the PNG. This is the
 *                 scanner-critical inset — the PDF page adds only a small
 *                 die-cut allowance on top (QUIET_ZONE there).
 *
 * Why 2 dots and not 3: at 3 dots (14.8 mil) a 4-digit SKU just fits the 47mm
 * printable width, but a 5-digit one needs 50.3mm and overflows. 9.9 mil is
 * still well above the ~5 mil floor where cheap guns start misreading.
 *
 * If the label stock or printer DPI changes, re-tune this ALONGSIDE
 * SkuBarcodeSheetPdf.js. The two are one decision, not two.
 */
export function generateLabelBarcodeDataUrl(text) {
  return generateBarcodeDataUrl(text, {
    width: 2,
    height: 90,
    fontSize: 16,
    textMargin: 4,
    margin: 6,
  });
}

/**
 * Generate all barcode images for an order's components
 * Returns an object ready to pass to WarehouseOrderPdf
 * 
 * @param {string} orderNo - e.g. "SB-DLC-0425-000376"
 * @param {Array} components - Array of order_components records from Supabase
 * @returns {object} { masterBarcode, componentBarcodes: [{ barcode, type, label, image }] }
 */
export function generateOrderBarcodeImages(orderNo, components) {
  // Master barcode = just the order number
  const masterBarcode = generateMasterBarcodeDataUrl(orderNo);

  // Component barcodes
  const componentBarcodes = (components || []).map((comp) => ({
    barcode: comp.barcode,
    type: comp.component_type,
    label: comp.component_label || comp.component_type,
    image: generateSmallBarcodeDataUrl(comp.barcode),
  }));

  return {
    masterBarcode,
    componentBarcodes,
  };
}