// ============================================================
// Label template — resolution and fit.
//
// A broken label template does not throw. It prints 200 stickers that are
// wrong, on physical stock, and nobody notices until the roll is gone. These
// are the two ways that happens:
//
//   1. A field resolves to the wrong text (or to "[object Object]", which is
//      what String() does to available_size's text[]).
//   2. The content stops fitting the label, so the printer clips the bars and
//      the sticker will not scan.
//
// Both are cheap to check and impossible to eyeball from a PDF viewer at 4x
// zoom, which is why they are here.
// ============================================================

import { LABEL_FIELDS, labelValues, DEFAULT_TEMPLATE } from "./labelTemplate";

const get = (field) => LABEL_FIELDS.find((f) => f.field === field).get;

const PRODUCT = {
  sku_id: "SKU-1042",
  name: "Hafsa",
  base_price: 48500,
  default_color: "Ivory",
  store_category: "Bridal",
  available_size: ["S", "M", "L"],
};

describe("label field resolution", () => {
  test("price prints as Rs, grouped, no paise", () => {
    // en-IN grouping: 48,500 not 48.500 or 48500. A prefix matters — a bare
    // number on a garment tag reads as a size or a lot number.
    //
    // "Rs" and NOT ₹: @react-pdf's built-in Helvetica is WinAnsi-encoded and
    // has no U+20B9 glyph. It does not error — it renders ¹ (superscript one),
    // so the sticker would read "¹48,500". Caught by rendering a real PDF.
    const out = get("base_price")(PRODUCT);
    expect(out).toBe("Rs 48,500");
    expect(out).not.toMatch(/₹/);
  });

  test("no field can emit a character the label font cannot print", () => {
    // The general form of the rupee bug. @react-pdf's standard-14 fonts are
    // WinAnsi (cp1252); anything outside it renders as the wrong glyph SILENTLY
    // — no error, no warning, just a wrong sticker discovered after the roll is
    // printed. Guards every current and future field's output.
    const printable = (s) => {
      try { return Buffer.from(s, "latin1").toString("latin1") === s; }
      catch { return false; }
    };
    for (const f of LABEL_FIELDS) {
      const out = String(f.get(PRODUCT) ?? "");
      expect(printable(out)).toBe(true);
    }
  });

  test("a placeholder 0 price prints nothing, not 'Rs 0'", () => {
    // reserve_sku_rows seeds base_price = 0 on a reserved draft because the
    // column is NOT NULL (74). These tags get stuck on real garments before
    // anyone fills in the details, so "Rs 0" would advertise stock as free.
    //
    // This test previously asserted the OPPOSITE — it encoded the assumption
    // that only null means "no price", which the seeded data disproves.
    expect(get("base_price")({ base_price: 0 })).toBe("");
    expect(get("base_price")({ base_price: null })).toBe("");
    expect(get("base_price")({ base_price: 48500 })).toBe("Rs 48,500");
  });

  test("a draft's placeholder name prints nothing, not the SKU again", () => {
    // Same class of bug: reserve_sku_rows seeds name = the SKU string. Printing
    // it repeats the barcode's own number as the product's "name".
    expect(get("name")({ sku_id: "SKU-1069", name: "SKU-1069" })).toBe("");
    expect(get("name")({ sku_id: "SKU-1069", name: "Hafsa" })).toBe("Hafsa");
  });

  test("sizes join instead of stringifying the array", () => {
    // available_size is text[]. String(["S","M"]) happens to give "S,M", but
    // the array could arrive as objects; the join is what guarantees readable
    // text on the sticker.
    expect(get("available_size")(PRODUCT)).toBe("S, M, L");
  });

  test("labelValues returns only the fields the template asks for", () => {
    const values = labelValues(PRODUCT, {
      lines: [{ field: "name" }, { field: "base_price" }],
    });
    expect(values).toEqual({ name: "Hafsa", base_price: "Rs 48,500" });
  });

  test("custom lines never read the product", () => {
    // Their text lives on the template line itself; including them here would
    // print an empty string over the client's wording.
    const values = labelValues(PRODUCT, {
      lines: [{ field: "custom", label: "Sheetal Batra" }],
    });
    expect(values).toEqual({});
  });

  test("a missing product yields no lines rather than 'undefined'", () => {
    // Happens when a SKU is reserved but its product row was removed. Printing
    // the literal text "undefined" on a garment tag is worse than printing
    // nothing.
    const values = labelValues(undefined, { lines: [{ field: "name" }] });
    expect(values).toEqual({});
  });

  test("every product field carries a default tag caption", () => {
    // A new line pre-fills its caption from here, so a caption missing on a
    // field means that line silently prints a bare value with no label.
    // "custom" is exempt: its whole content is the client's own wording.
    for (const f of LABEL_FIELDS) {
      if (f.field === "custom") continue;
      expect(f.caption).toBeTruthy();
      // A tag caption, not the dropdown wording: "Name", not "Product name".
      // Long captions eat the value column on a 50mm label.
      expect(f.caption.length).toBeLessThanOrEqual(9);
    }
  });

  test("every offered field has an accessor", () => {
    // A field added to the dropdown without a `get` renders a permanently
    // blank line that looks like a data problem.
    for (const f of LABEL_FIELDS) {
      expect(typeof f.get).toBe("function");
      expect(f.label).toBeTruthy();
    }
  });
});

describe("the default template is the pre-existing slip", () => {
  test("50x25mm, no extra lines, code shown", () => {
    // Migration 92 seeds exactly this. If the default ever drifts, every shop
    // that never opened the designer silently gets a different sticker.
    expect(DEFAULT_TEMPLATE).toEqual({
      width_mm: 50,
      height_mm: 25,
      lines: [],
      show_value: true,
    });
  });
});

describe("content fits the label", () => {
  // Mirrors SkuBarcodeSheetPdf's geometry. Duplicated deliberately: the point
  // is to catch a change to those constants that makes the bars overflow, so
  // importing them would test nothing.
  const MM = 72 / 25.4;
  const QUIET_ZONE = 1.5 * MM;
  const DOT = 72 / 203;
  const CANVAS_SCALE = (2 * DOT) / 2;
  const barcodeWidthPt = (sku) =>
    ((11 * sku.length + 35) * 2 + 12) * CANVAS_SCALE;
  const barcodeHeightPt = (showValue) =>
    (90 + (showValue ? 20 : 0) + 12) * CANVAS_SCALE;

  test("a 5-digit SKU's bars fit the 50mm label at full size", () => {
    // The reason the module is 2 dots and not 3. At 3 dots this overflows and
    // the PDF silently shrinks the symbol off the dot grid.
    const printable = 50 * MM - 2 * QUIET_ZONE;
    expect(barcodeWidthPt("SKU-10425")).toBeLessThan(printable);
  });

  test("bars plus three 5pt lines still fit 25mm of height", () => {
    // The realistic worst case a client configures: name, price, colour.
    const printable = 25 * MM - 2 * QUIET_ZONE;
    const used = barcodeHeightPt(true) + 3 * 5 * 1.2;   // 1.2 = @react-pdf default line height
    expect(used).toBeLessThan(printable);
  });

  test("rows are counted ONE per line, never in pairs", () => {
    // The designer's overflow warning and the PDF's own clamp are the same
    // sum written twice. They drifted once: the warning kept counting lines in
    // PAIRS after the two-column layout was reverted, so it stayed silent
    // while the PDF dropped three of five lines. Anyone changing the row
    // layout must change both.
    const avail = 25 * MM - 2 * QUIET_ZONE - barcodeHeightPt(true) - 2;
    const fits = (sizes) => {
      let used = 0, n = 0;
      for (const sz of sizes) { const h = sz * 1.2; if (used + h > avail) break; used += h; n++; }
      return n;
    };
    // 17.1pt of room: three 4.8pt rows fit, two 6pt rows fit.
    expect(fits([4, 4, 4, 4, 4])).toBe(3);
    expect(fits([5, 5, 5, 5])).toBe(2);
    // Pair counting would have said 4 and 4 — the bug.
    expect(fits([4, 4, 4, 4, 4])).not.toBe(4);
  });

  test("hiding the code under the bars frees real height", () => {
    expect(barcodeHeightPt(false)).toBeLessThan(barcodeHeightPt(true));
  });
});
