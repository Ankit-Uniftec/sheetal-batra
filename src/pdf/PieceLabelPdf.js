import React from "react";
import { Document, Page, Text, View, StyleSheet, Font, Svg, Rect } from "@react-pdf/renderer";
import JsBarcode from "jsbarcode";

/**
 * PieceLabelPdf — Release 35 garment labels, one per physical piece.
 *
 * Client format: 50 x 50 mm, one label per page (a thermal roll advances one
 * label per PDF page, same as SkuBarcodeSheetPdf):
 *
 *            NASIRA
 *   HABUTAI SILK GOTA PATTI EMBROIDERED
 *      KURTA WITH GARARA AND DUPATTA
 *   ─────────────────────────────────
 *        COLOUR    |    SIZE
 *         Red      |     L
 *   ─────────────────────────────────
 *          INR 26,500
 *        ||||||||||||||||||||
 *          NAS-ST-L-001
 *
 * FONT: Athelas Regular, the client's licensed font (public/fonts). The price prints as "INR 26,500" (client
 * feedback), so no rupee-sign font is needed. No outline (client feedback).
 */

// Athelas (client's licensed font, public/fonts/Athelas-Regular.ttf). Only the
// Regular face was supplied, so the colour / size values print upright; add
// Athelas-Italic.ttf and register it as fontStyle "italic" to match the
// client's sample exactly.
Font.register({ family: "Athelas", src: "/fonts/Athelas-Regular.ttf" });
// Never split a word across lines ("PALAZ-ZO"): whole words only.
Font.registerHyphenationCallback((word) => [word]);
const LABEL_SERIF = "Athelas";
const LABEL_SERIF_ITALIC = "Athelas";

const MM = 72 / 25.4;
const SIZE = 50 * MM;

// PRINT QUALITY (thermal printers, 203 / 300 dots per inch = 8 / 12 dots per mm):
// anything about one dot wide breaks up on paper. So: rules and the divider are
// 1 pt, the small captions are Helvetica (no hairline strokes) at 6 pt, the
// code under the bars is Helvetica-Bold, and the barcode is DRAWN (solid
// rectangles, see barcodeBars) instead of a stretched picture.
const s = StyleSheet.create({
  page: { padding: 0, backgroundColor: "#ffffff" },
  frame: {
    position: "absolute", top: 1.4 * MM, left: 0.8 * MM, right: 0.8 * MM, bottom: 1.2 * MM,
    paddingHorizontal: 1.2 * MM, paddingTop: 1.8 * MM, paddingBottom: 1 * MM,
    alignItems: "center",
  },
  title: { fontFamily: LABEL_SERIF, fontSize: 15, letterSpacing: 1.6, textAlign: "center", color: "#000000" },
  desc: { fontFamily: LABEL_SERIF, fontSize: 6.4, letterSpacing: 0.3, lineHeight: 1.25, textAlign: "center", marginTop: 1 * MM, color: "#000000", paddingHorizontal: 1.5 * MM },
  rule: { width: "92%", borderTopWidth: 1, borderTopColor: "#000000", marginVertical: 1.3 * MM },
  pair: { flexDirection: "row", width: "92%", alignItems: "stretch" },
  half: { flex: 1, alignItems: "center" },
  divider: { width: 1, backgroundColor: "#000000", marginVertical: 1 },
  caption: { fontFamily: "Helvetica", fontSize: 6, letterSpacing: 0.9, color: "#000000" },
  value: { fontFamily: LABEL_SERIF_ITALIC, fontSize: 10, marginTop: 0.5 * MM, color: "#000000" },
  mrp: { fontFamily: LABEL_SERIF, fontSize: 9.5, letterSpacing: 0.4, color: "#000000" },
  // 1 mm wider than the text area on each side: the bars may use 48 of the 50 mm.
  bars: { marginTop: 1.1 * MM, marginHorizontal: -1 * MM },
  // Helvetica-Bold: solid strokes print cleanly, and 0 / O are clearly
  // different when an SA types the code by hand.
  code: { fontFamily: "Helvetica-Bold", fontSize: 7, letterSpacing: 0.7, marginTop: 0.7 * MM, color: "#000000" },
});

const BAR_HEIGHT = 8 * MM;
const DOT = 0.125 * MM; // one dot of a 203 dpi (8 dots/mm) thermal printer
const BARS_MAX_WIDTH = 48 * MM;

/**
 * Code128 drawn as rectangles. Each module (narrowest bar) is a whole number
 * of printer dots: 0.25 mm = 2 dots at 203 dpi and 3 at 300 dpi, so every bar
 * prints the same width; 0.2 mm is used only if a code longer than ~14 characters would not fit in 48 mm.
 * @returns {{ width, rects: Array<[x, w]> }} in points
 */
function barcodeBars(code) {
  const out = {};
  JsBarcode(out, code, { format: "CODE128" });
  const bits = (out.encodings || []).map((e) => e.data).join("");
  const module = bits.length * 0.25 * MM <= BARS_MAX_WIDTH ? 0.25 * MM : 0.2 * MM;
  // Bar edges on whole printer dots (matters for the 0.2 mm fallback).
  const snap = (v) => Math.round(v / DOT) * DOT;
  const rects = [];
  for (let i = 0; i < bits.length;) {
    if (bits[i] !== "1") { i += 1; continue; }
    let j = i;
    while (j < bits.length && bits[j] === "1") j += 1;
    const x0 = snap(i * module);
    rects.push([x0, Math.max(DOT, snap(j * module) - x0)]);
    i = j;
  }
  return { width: snap(bits.length * module), rects };
}

// The drawing area is 48 mm wide starting 1 mm from the label edge (whole
// dots), and the bars start on a whole printer dot, so no bar edge falls
// half-way across a dot.
function Barcode({ code }) {
  const { width, rects } = barcodeBars(code);
  const left = Math.round((BARS_MAX_WIDTH - width) / 2 / DOT) * DOT;
  return (
    <Svg style={s.bars} width={BARS_MAX_WIDTH} height={BAR_HEIGHT} viewBox={`0 0 ${BARS_MAX_WIDTH} ${BAR_HEIGHT}`}>
      {rects.map(([x, w]) => <Rect key={x} x={left + x} y={0} width={w} height={BAR_HEIGHT} fill="#000000" />)}
    </Svg>
  );
}

// Long colours ("Emerald Green") shrink to stay on one line in the half-width
// box. Colour and size always print at the SAME size (client feedback): the
// longer of the two decides.
const valueSize = (text) => {
  const n = String(text || "").length;
  return n <= 9 ? 10 : n <= 13 ? 8 : n <= 17 ? 6.5 : 5.5;
};
const pairSize = (colour, size) => Math.min(valueSize(colour), valueSize(size));

// Long names must never run into the line below (client, 23 Nov 2026: a
// 4-line name crossed the divider). A name with no " - " arrives whole as the
// title, so it is split like the client's format: the first word is the title,
// the rest the description. Then both shrink to fit their space.
// Rough widths: the text area is ~45 mm (128 pt); an Athelas capital is ~0.72 em.
const TEXT_WIDTH = 120;
const linesAt = (text, size, spacing, em) => {
  const perLine = Math.max(1, Math.floor(TEXT_WIDTH / (size * em + spacing)));
  let lines = 1; let used = 0;
  String(text || "").split(/\s+/).filter(Boolean).forEach((w) => {
    const need = used ? used + 1 + w.length : w.length;
    if (need > perLine && used) { lines += 1; used = w.length; } else used = need;
  });
  return lines;
};
const splitName = (title, description) => {
  const words = String(title || "").trim().split(/\s+/).filter(Boolean);
  if (description || words.length < 3 || linesAt(title, 15, 1.6, 0.72) <= 1) return { title, description };
  return { title: words[0], description: words.slice(1).join(" ") };
};
// Title: one line if it can, never more than two.
const titleSize = (text) => [15, 13, 11.5, 10, 9, 8].find((f) => linesAt(text, f, f * 0.1, 0.72) <= (f >= 13 ? 1 : 2)) || 8;
// Description: at most three lines.
const descSize = (text) => [6.4, 5.8, 5.2].find((f) => linesAt(text, f, 0.3, 0.62) <= 3) || 5.2;

/**
 * @param {{ labels: Array<{ code, title, description, colour, size, mrp, image }> }} props
 *   mrp is pre-formatted ("26,500"). The barcode is drawn from `code`.
 */
export default function PieceLabelPdf({ labels }) {
  return (
    <Document title="Piece labels">
      {labels.map((l) => {
        const name = splitName(l.title, l.description);
        const tSize = titleSize(name.title);
        return (
        <Page key={l.code} size={{ width: SIZE, height: SIZE }} style={s.page}>
          <View style={s.frame}>
            <Text style={[s.title, { fontSize: tSize, letterSpacing: tSize * 0.1 }]}>{name.title}</Text>
            {name.description ? <Text style={[s.desc, { fontSize: descSize(name.description) }]}>{name.description}</Text> : null}
            <View style={s.rule} />
            <View style={s.pair}>
              <View style={s.half}>
                <Text style={s.caption}>COLOUR</Text>
                <Text style={[s.value, { fontSize: pairSize(l.colour, l.size) }]}>{l.colour}</Text>
              </View>
              <View style={s.divider} />
              <View style={s.half}>
                <Text style={s.caption}>SIZE</Text>
                <Text style={[s.value, { fontSize: pairSize(l.colour, l.size) }]}>{l.size}</Text>
              </View>
            </View>
            <View style={s.rule} />
            {l.mrp ? (
              <Text style={s.mrp}>INR {l.mrp}</Text>
            ) : null}
            <Barcode code={l.code} />
            <Text style={s.code}>{l.code}</Text>
          </View>
        </Page>
        );
      })}
    </Document>
  );
}
