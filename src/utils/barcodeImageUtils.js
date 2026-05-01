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