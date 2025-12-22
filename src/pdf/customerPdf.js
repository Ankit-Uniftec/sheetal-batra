import { PDFDocument, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { A4, MARGIN } from "./pdfTheme";
import { drawText, sectionBar, embedRemoteImage } from "./pdfHelpers";
import formatIndianNumber from "../utils/formatIndianNumber";
import formatDate from "../utils/formatDate";

export async function buildCustomerOrderPdf(order, logoUrl) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - MARGIN;

  // --- LOGO ---
  const logo = await embedRemoteImage(pdf, logoUrl);
  if (logo) {
    const w = 140;
    const h = (logo.height / logo.width) * w;
    page.drawImage(logo, { x: A4.w / 2 - w / 2, y: y - h, width: w, height: h });
    y -= h + 20;
  }

  drawText(page, "Order Copy", MARGIN, y, { font: fontB, size: 18 });
  drawText(page, `Order ID: ${order.id}`, MARGIN, y - 20, { font });
  drawText(page, formatDate(order.created_at), A4.w - 200, y - 20, { font });
  y -= 60;

  y = sectionBar(page, "Product Details", y, fontB);

  for (const item of order.items) {
    const img = await embedRemoteImage(pdf, item.image_url);
    if (img) {
      page.drawImage(img, { x: MARGIN, y: y - 90, width: 80, height: 90 });
    }

    drawText(page, item.product_name, MARGIN + 100, y, { font: fontB });
    drawText(page, `Top: ${item.top}`, MARGIN + 100, y - 20, { font });
    drawText(page, `Bottom: ${item.bottom}`, MARGIN + 260, y - 20, { font });
    drawText(page, `Size: ${item.size}`, MARGIN + 420, y - 20, { font });
    drawText(page, `Color: ${item.color.name}`, MARGIN + 100, y - 40, { font });

    y -= 110;
  }

  return pdf.save();
}
