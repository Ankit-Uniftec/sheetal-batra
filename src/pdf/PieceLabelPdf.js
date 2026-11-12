import React from "react";
import { Document, Page, Text, View, Image, StyleSheet, Font } from "@react-pdf/renderer";

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
 *          MRP ₹26,500
 *        ||||||||||||||||||||
 *        NAS-RED-ST-L-001
 *
 * FONT: the client asked for Athelas, a paid font that is not in the repo.
 * Until its .ttf is supplied (put it in public/fonts and register it below as
 * LABEL_SERIF), the built-in Times family prints instead — a close classic
 * serif that needs no download. The ₹ sign is not in Times (WinAnsi), so it
 * alone is drawn in Noto Sans (the same file CustomerOrderPdf loads).
 */

// Same Noto Sans the customer PDF uses (public/fonts/*.ttf are empty files).
Font.register({ family: "LabelRupee", src: "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans@4.5.0/files/noto-sans-all-400-normal.woff" });

const LABEL_SERIF = "Times-Roman";
const LABEL_SERIF_ITALIC = "Times-Italic";

const MM = 72 / 25.4;
const SIZE = 50 * MM;

const s = StyleSheet.create({
  page: { padding: 0, backgroundColor: "#ffffff" },
  frame: {
    position: "absolute", top: 1.6 * MM, left: 1.6 * MM, right: 1.6 * MM, bottom: 1.6 * MM,
    borderWidth: 0.6, borderColor: "#333333", paddingHorizontal: 2.4 * MM, paddingTop: 2.2 * MM, paddingBottom: 1.6 * MM,
    alignItems: "center",
  },
  title: { fontFamily: LABEL_SERIF, fontSize: 15, letterSpacing: 1.6, textAlign: "center", color: "#111111" },
  desc: { fontFamily: LABEL_SERIF, fontSize: 5.2, letterSpacing: 0.3, lineHeight: 1.3, textAlign: "center", marginTop: 1.2 * MM, color: "#222222" },
  rule: { width: "100%", borderTopWidth: 0.5, borderTopColor: "#555555", marginVertical: 1.4 * MM },
  pair: { flexDirection: "row", width: "100%", alignItems: "stretch" },
  half: { flex: 1, alignItems: "center" },
  divider: { width: 0.6, backgroundColor: "#333333", marginVertical: 1 },
  caption: { fontFamily: LABEL_SERIF, fontSize: 5, letterSpacing: 0.8, color: "#333333" },
  value: { fontFamily: LABEL_SERIF_ITALIC, fontSize: 10, marginTop: 0.4 * MM, color: "#111111" },
  mrp: { fontFamily: LABEL_SERIF, fontSize: 9, letterSpacing: 0.4, color: "#111111" },
  rupee: { fontFamily: "LabelRupee", fontSize: 8.5 },
  bars: { width: "100%", height: 7.2 * MM, marginTop: 1.2 * MM, objectFit: "fill" },
  code: { fontFamily: LABEL_SERIF, fontSize: 5.6, letterSpacing: 0.8, marginTop: 0.6 * MM, color: "#111111" },
});

// Long colours ("Emerald Green") shrink to stay on one line in the half-width box.
const valueSize = (text) => {
  const n = String(text || "").length;
  return n <= 9 ? 10 : n <= 13 ? 8 : n <= 17 ? 6.5 : 5.5;
};

/**
 * @param {{ labels: Array<{ code, title, description, colour, size, mrp, image }> }} props
 *   mrp is pre-formatted ("26,500"); image is a Code128 PNG data URL.
 */
export default function PieceLabelPdf({ labels }) {
  return (
    <Document title="Piece labels">
      {labels.map((l) => (
        <Page key={l.code} size={{ width: SIZE, height: SIZE }} style={s.page}>
          <View style={s.frame}>
            <Text style={s.title}>{l.title}</Text>
            {l.description ? <Text style={s.desc}>{l.description}</Text> : null}
            <View style={s.rule} />
            <View style={s.pair}>
              <View style={s.half}>
                <Text style={s.caption}>COLOUR</Text>
                <Text style={[s.value, { fontSize: valueSize(l.colour) }]}>{l.colour}</Text>
              </View>
              <View style={s.divider} />
              <View style={s.half}>
                <Text style={s.caption}>SIZE</Text>
                <Text style={s.value}>{l.size}</Text>
              </View>
            </View>
            <View style={s.rule} />
            {l.mrp ? (
              <Text style={s.mrp}>MRP <Text style={s.rupee}>{"₹"}</Text>{l.mrp}</Text>
            ) : null}
            {l.image ? <Image style={s.bars} src={l.image} /> : null}
            <Text style={s.code}>{l.code}</Text>
          </View>
        </Page>
      ))}
    </Document>
  );
}
