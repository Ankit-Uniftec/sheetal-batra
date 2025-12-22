import { PDFDocument, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { A4, MARGIN } from "./pdfTheme";
import { drawText, sectionBar, embedRemoteImage } from "./pdfHelpers";
import formatDate from "../utils/formatDate";

export async function buildWarehousePdf(order, logoUrl) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - MARGIN;

  drawText(page, "Warehouse Order Copy", MARGIN, y, {
    font: fontB,
    size: 16,
  });

  drawText(page, `Order ID: ${order.id}`, MARGIN, y - 30, { font });
  drawText(page, `Delivery Date: ${formatDate(order.delivery_date)}`, MARGIN, y - 48, { font });

  y -= 80;
  y = sectionBar(page, "Order Details", y, fontB);

  for (const item of order.items) {
    drawText(page, item.product_name, MARGIN, y, { font: fontB });
    drawText(page, `Top: ${item.top}`, MARGIN, y - 18, { font });
    drawText(page, `Bottom: ${item.bottom}`, MARGIN + 200, y - 18, { font });
    drawText(page, `Size: ${item.size}`, MARGIN + 400, y - 18, { font });
    drawText(page, `Color: ${item.color.name}`, MARGIN, y - 36, { font });
    y -= 60;
  }

  return pdf.save();
}