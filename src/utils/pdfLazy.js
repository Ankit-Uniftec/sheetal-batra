// Lazy facade over pdfUtils. pdfUtils statically pulls in the whole PDF stack
// (@react-pdf/renderer, pdf-lib, jsbarcode ≈ the heaviest deps in the app), so
// screens must import from THIS module instead — the stack then loads as a
// separate chunk on the first PDF action, not on every dashboard load.
// All wrapped functions were already async, so signatures are unchanged.

export const downloadCustomerPdf = async (...args) =>
  (await import("./pdfUtils")).downloadCustomerPdf(...args);

export const downloadWarehousePdf = async (...args) =>
  (await import("./pdfUtils")).downloadWarehousePdf(...args);

export const downloadSingleWarehousePdf = async (...args) =>
  (await import("./pdfUtils")).downloadSingleWarehousePdf(...args);

export const generateAllPdfs = async (...args) =>
  (await import("./pdfUtils")).generateAllPdfs(...args);

export const clearPdfUrls = async (...args) =>
  (await import("./pdfUtils")).clearPdfUrls(...args);
