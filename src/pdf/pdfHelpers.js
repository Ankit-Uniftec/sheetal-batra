import { rgb } from "pdf-lib";
import { THEME, A4, MARGIN } from "./pdfTheme";


export const drawText = (page, text, x, y, {
  size = 10,
  font,
  color = THEME.dark,
} = {}) => {
  page.drawText(String(text ?? "—"), { x, y, size, font, color });
};

export const sectionBar = (page, title, y, fontBold) => {
  page.drawRectangle({
    x: MARGIN,
    y: y - 26,
    width: A4.w - MARGIN * 2,
    height: 26,
    color: THEME.gold,
  });

  drawText(page, title, MARGIN + 10, y - 18, {
    font: fontBold,
    size: 12,
    color: rgb(1, 1, 1),
  });

  return y - 40;
};

export const embedRemoteImage = async (pdf, url) => {
  if (!url) return null;
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  try {
    return await pdf.embedPng(buf);
  } catch {
    return await pdf.embedJpg(buf);
  }
};
