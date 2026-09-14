import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import Popup, { usePopup } from "../Popup";
import { downloadSkuBarcodeSheet } from "../../utils/pdfLazy";
import {
  LABEL_FIELDS,
  SKU_LABEL_SURFACE,
  fetchLabelTemplate,
  saveLabelTemplate,
} from "../../utils/labelTemplate";
import "./LabelDesigner.css";

/**
 * LabelDesigner — edit what the printed barcode slip says.
 *
 * Mounted on the inventory dashboard today. It is a self-contained component
 * over a stored template (utils/labelTemplate.js), so putting the same editor
 * on another dashboard is one import and one tag — no state to thread through,
 * no props beyond which print surface to edit.
 *
 *   <LabelDesigner surface="sku" />
 *
 * The barcode itself is NOT editable, on purpose. Its module width is pinned to
 * the printer's dot grid (see SkuBarcodeSheetPdf.js); letting a user resize the
 * bars produces stickers that scan intermittently, which surfaces weeks later
 * as "the scanner is broken". Everything around the bars is fair game.
 */
// The label PDF uses @react-pdf's built-in Helvetica, which is WinAnsi
// (cp1252) encoded. A character outside that set renders as a DIFFERENT glyph
// with no error — ₹ comes out as ¹. Free-text is the only place a user can
// introduce one, so it is checked here rather than silently mangled at print.
const isPrintable = (s) => !/[^ -ÿ]/.test(s || "");

// The default caption for a field, e.g. "Name" for the product name. Custom
// text has none — its whole content is the client's own words.
const captionFor = (field) =>
  LABEL_FIELDS.find((f) => f.field === field)?.caption || "";

export default function LabelDesigner({ surface = SKU_LABEL_SURFACE }) {
  const { showPopup, PopupComponent } = usePopup();

  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Which product the sample prints. It must be a FILLED-IN product: a reserved
  // draft has no colour, price or category, so a sample against one prints
  // empty rows and shows nothing — exactly when the client is trying to judge
  // the layout. Defaults to any filled product, and can be searched.
  const [sample, setSample] = useState(null);
  const [sampleQuery, setSampleQuery] = useState("");
  const [sampleHits, setSampleHits] = useState(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // required: EDITING needs the real table. Printing tolerates its absence
      // (see fetchLabelTemplate), but silently offering an editable design that
      // has nowhere to save would waste the client's time and lose their work.
      setTemplate(await fetchLabelTemplate(surface, { required: true }));
      setLoadError("");
    } catch (e) {
      // Fail loudly. A silent fallback to defaults here would show the client
      // an empty design and invite them to "re-add" lines that are actually
      // still saved, overwriting a template that was merely unreadable.
      console.error("Failed to load label template:", e);
      setLoadError(
        /schema cache|does not exist/i.test(e?.message || "")
          ? "the label_templates table has not been created on this database yet (migration 92). Barcode printing is unaffected and still uses the standard slip."
          : e?.message || "Could not load the label design."
      );
      setTemplate(null);
    }
    setLoading(false);
  }, [surface]);

  useEffect(() => { load(); }, [load]);

  // Pick any filled-in product as the default sample. products_live excludes
  // drafts, which is exactly the filter we want here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Require colour AND a real price, not just a name: the newest row by
      // SKU is often test data with half its fields null, which previews as
      // blank rows and looks like the layout is broken. Falls back to any
      // filled product if nothing is that complete.
      const complete = await supabase
        .from("products_live")
        .select("sku_id, name")
        .not("default_color", "is", null)
        .gt("base_price", 0)
        .order("sku_id", { ascending: false })
        .limit(1);
      let row = complete.data?.[0];
      if (!row) {
        const any = await supabase
          .from("products_live")
          .select("sku_id, name")
          .not("name", "is", null)
          .order("sku_id", { ascending: false })
          .limit(1);
        row = any.data?.[0];
      }
      if (!cancelled && row) setSample(row);
    })();
    return () => { cancelled = true; };
  }, []);

  const searchSample = async () => {
    const q = sampleQuery.trim();
    if (!q) { setSampleHits(null); return; }
    setSearching(true);
    const { data, error } = await supabase
      .from("products_live")
      .select("sku_id, name")
      .or(`sku_id.ilike.%${q}%,name.ilike.%${q}%`)
      .order("sku_id")
      .limit(20);
    if (error) {
      console.error("Sample search failed:", error);
      setSampleHits([]);
    } else setSampleHits(data || []);
    setSearching(false);
  };

  const patch = (changes) => {
    setTemplate((t) => ({ ...t, ...changes }));
    setDirty(true);
  };

  const patchLine = (i, changes) =>
    patch({ lines: template.lines.map((l, n) => (n === i ? { ...l, ...changes } : l)) });

  const addLine = () =>
    patch({
      lines: [
        ...template.lines,
        // Defaults chosen to be printable immediately: 5pt fits a 25mm label
        // under the bars, and "name" is what every client asks for first.
        {
          field: "name",
          // Pre-filled from the field, so a new line prints "Name: Hafsa"
          // immediately instead of a bare value the client has to go and label.
          caption: captionFor("name"),
          suffix: "",
          label: "",
          size: 5,
          bold: false,
        },
      ],
    });

  const removeLine = (i) => patch({ lines: template.lines.filter((_, n) => n !== i) });

  const move = (i, delta) => {
    const next = [...template.lines];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    patch({ lines: next });
  };

  const save = async () => {
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const saved = await saveLabelTemplate(
        surface,
        template,
        user?.email || localStorage.getItem("sp_email") || null
      );
      setTemplate(saved);
      setDirty(false);
      showPopup({
        type: "success",
        title: "Design Saved",
        message: "New slips will print with this design.",
        confirmText: "OK",
      });
    } catch (e) {
      console.error("Save label template failed:", e);
      showPopup({
        type: "error",
        title: "Could Not Save",
        message: e?.message || "The design was not saved.",
        confirmText: "OK",
      });
    } finally {
      setBusy(false);
    }
  };

  // Prints ONE label using the current (possibly unsaved) design, against a
  // real SKU so the preview shows real text lengths. Cheaper than guessing
  // from a screen mock-up: the only thing that settles whether a name fits is
  // the actual PDF at the actual label size.
  const preview = async () => {
    setBusy(true);
    try {
      await downloadSkuBarcodeSheet([sample?.sku_id || "SKU-1000"], template);
    } catch (e) {
      console.error("Label preview failed:", e);
      showPopup({
        type: "error",
        title: "Preview Failed",
        message: e?.message || "Could not generate the preview.",
        confirmText: "OK",
      });
    } finally {
      setBusy(false);
    }
  };

  // Mirrors the PDF's own clamp so the warning and the print agree. Kept in
  // step with SkuBarcodeSheetPdf: MM, QUIET_ZONE, the barcode block height and
  // the 1.2 line height are the same decision in two places.
  const overflow = (() => {
    if (!template) return 0;
    const MM = 72 / 25.4, QZ = 1.5 * MM, DOT = 72 / 203, SCALE = (2 * DOT) / 2;
    const imgH = (90 + (template.show_value !== false ? 20 : 0) + 12) * SCALE;
    const avail = Number(template.height_mm) * MM - 2 * QZ - imgH - 2;
    // ONE line per row. This previously counted lines in PAIRS, left over from
    // the two-column layout that was reverted — so it believed 4 lines fit
    // where only 2 did and stayed silent while the PDF dropped three of them.
    // It must mirror rowsThatFit in SkuBarcodeSheetPdf exactly.
    const lns = template.lines || [];
    let used = 0, fits = 0;
    for (const ln of lns) {
      const h = (Number(ln.size) || 5) * 1.2;
      if (used + h > avail) break;
      used += h; fits += 1;
    }
    return Math.max(0, lns.length - fits);
  })();

  if (loading) return <p className="ap-help">Loading label design…</p>;
  if (loadError) {
    return (
      <div className="ld-panel">
        <p className="ap-help ld-error">
          Could not load the label design — {loadError}{" "}
          <button type="button" className="ap-text-btn" onClick={load}>Retry</button>
        </p>
      </div>
    );
  }

  return (
    <div className="ld-panel">
      {PopupComponent}

      <div className="ap-section-title">Barcode Slip Design</div>
      <p className="ap-help">
        Controls what is printed on every barcode slip. Lines print in{" "}
        <strong>two columns</strong> — the first line goes top-left, the second
        top-right, and so on. Text size is saved with the design and used for
        every future print. The barcode itself is fixed: its size is matched to
        the label printer, and changing it makes stickers that scan unreliably.
        Use <strong>Print sample</strong> to see a real slip before saving.
      </p>

      <div className="ld-size-row">
        <div className="ap-field">
          <label>Label width (mm)</label>
          <input
            type="number" className="ap-input" min="20" max="210" step="1"
            value={template.width_mm}
            onChange={(e) => patch({ width_mm: Number(e.target.value) })}
            disabled={busy}
          />
        </div>
        <div className="ap-field">
          <label>Label height (mm)</label>
          <input
            type="number" className="ap-input" min="10" max="297" step="1"
            value={template.height_mm}
            onChange={(e) => patch({ height_mm: Number(e.target.value) })}
            disabled={busy}
          />
        </div>
        <label className="ld-check">
          <input
            type="checkbox"
            checked={template.show_value !== false}
            onChange={(e) => patch({ show_value: e.target.checked })}
            disabled={busy}
          />
          <span>Print the code under the bars</span>
        </label>
      </div>
      <p className="ap-help">
        Width and height must match the label roll actually loaded in the
        printer, or the printer will split each slip across two stickers.
      </p>

      {/* The hard limit. A row that does not fit is DROPPED at print time
          (see SkuBarcodeSheetPdf) — better than spilling onto a second
          sticker, but the client must see it here, before a roll is printed. */}
      {overflow > 0 && (
        <p className="ap-help ld-warn">
          {overflow} line{overflow === 1 ? "" : "s"} will not fit on a{" "}
          {template.width_mm}×{template.height_mm}mm label and{" "}
          {overflow === 1 ? "is" : "are"} not printed. Use a taller label, a
          smaller text size, fewer lines
          {template.show_value !== false
            ? ", or untick “Print the code under the bars”"
            : ""}
          .
        </p>
      )}

      <div className="ap-section-title">Lines on the slip</div>
      {template.lines.length === 0 ? (
        <p className="ap-help">
          Nothing extra — slips print the barcode only. Add a line to include
          the product name, price or anything else.
        </p>
      ) : (
        <div className="ld-lines">
          {template.lines.map((line, i) => (
            <div className="ld-line" key={i}>
              <select
                className="ap-input ld-field"
                value={line.field}
                onChange={(e) => {
                  // Swap the caption along with the field, but only while it
                  // still holds another field's default — never overwrite a
                  // caption the client typed themselves.
                  const next = e.target.value;
                  const untouched =
                    !line.caption || LABEL_FIELDS.some((f) => f.caption === line.caption);
                  patchLine(i, {
                    field: next,
                    ...(untouched ? { caption: captionFor(next) } : {}),
                  });
                }}
                disabled={busy}
              >
                {LABEL_FIELDS.map((f) => (
                  <option key={f.field} value={f.field}>{f.label}</option>
                ))}
              </select>

              {/* Caption + suffix reproduce the printed garment tag's shape:
                  "Color   PURPLE" and "MRP  6,500  (Incl. of all Taxes)".
                  Both optional — leaving the caption blank keeps the older
                  centred line, so designs saved before this still render. */}
              <input
                className="ap-input ld-caption"
                placeholder="Label (e.g. Color)"
                value={line.caption || ""}
                onChange={(e) => patchLine(i, { caption: e.target.value })}
                disabled={busy}
              />

              {line.field === "custom" && (
                <div className="ld-custom">
                  <input
                    className="ap-input"
                    placeholder="Text to print, e.g. Sheetal Batra"
                    value={line.label || ""}
                    onChange={(e) => patchLine(i, { label: e.target.value })}
                    disabled={busy}
                  />
                  {/* The label font is WinAnsi. Anything outside it does not
                      error — it prints as the WRONG character, discovered only
                      after a roll of stickers is used. Warn while it can still
                      be changed. */}
                  {!isPrintable(line.label) && (
                    <span className="ld-warn">
                      Some characters here cannot be printed on a label and will
                      come out wrong. Use plain English letters, digits and
                      punctuation.
                    </span>
                  )}
                </div>
              )}

              <input
                className="ap-input ld-suffix"
                placeholder="After (e.g. Incl. of all Taxes)"
                value={line.suffix || ""}
                onChange={(e) => patchLine(i, { suffix: e.target.value })}
                disabled={busy}
              />

              <label className="ld-size">
                <span>Size</span>
                <input
                  type="number" className="ap-input" min="3" max="14" step="0.5"
                  value={line.size ?? 5}
                  onChange={(e) => patchLine(i, { size: Number(e.target.value) })}
                  disabled={busy}
                />
              </label>

              <label className="ld-check">
                <input
                  type="checkbox"
                  checked={!!line.bold}
                  onChange={(e) => patchLine(i, { bold: e.target.checked })}
                  disabled={busy}
                />
                <span>Bold</span>
              </label>

              {/* Caption and suffix are free text, so they can carry the same
                  unprintable characters as the custom line — a pasted em-dash
                  or ₹ prints as the WRONG glyph with no error. */}
              {!isPrintable(`${line.caption || ""}${line.suffix || ""}`) && (
                <span className="ld-warn">
                  The label or trailing text contains characters that cannot be
                  printed and will come out wrong. Use plain English letters,
                  digits and punctuation.
                </span>
              )}

              <div className="ld-line-actions">
                <button type="button" className="ap-text-btn" disabled={busy || i === 0}
                  onClick={() => move(i, -1)} title="Move up">↑</button>
                <button type="button" className="ap-text-btn"
                  disabled={busy || i === template.lines.length - 1}
                  onClick={() => move(i, 1)} title="Move down">↓</button>
                <button type="button" className="ap-text-btn" disabled={busy}
                  onClick={() => removeLine(i)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Which product the sample prints. Shown next to the button that uses
          it: a sample against a blank draft prints empty rows, which reads as
          a broken layout rather than missing data. */}
      <div className="ld-sample">
        <div className="ld-sample-now">
          Sample prints{" "}
          <strong>{sample ? `${sample.sku_id} — ${sample.name}` : "…"}</strong>
        </div>
        <div className="ld-sample-find">
          <input
            className="ap-input"
            placeholder="Use a different product (SKU or name)"
            value={sampleQuery}
            onChange={(e) => setSampleQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchSample(); } }}
            disabled={busy}
          />
          <button type="button" className="ap-text-btn" onClick={searchSample}
            disabled={busy || searching || !sampleQuery.trim()}>
            {searching ? "Searching…" : "Search"}
          </button>
        </div>
        {sampleHits !== null && (
          sampleHits.length === 0 ? (
            <p className="ap-help">No filled-in products match.</p>
          ) : (
            <div className="ld-sample-hits">
              {sampleHits.map((p) => (
                <button
                  key={p.sku_id}
                  type="button"
                  className={`ld-sample-hit ${sample?.sku_id === p.sku_id ? "selected" : ""}`}
                  onClick={() => { setSample(p); setSampleHits(null); setSampleQuery(""); }}
                  disabled={busy}
                >
                  <span className="ld-hit-sku">{p.sku_id}</span>
                  <span className="ld-hit-name">{p.name}</span>
                </button>
              ))}
            </div>
          )
        )}
      </div>

      <div className="ld-actions">
        <button type="button" className="ap-text-btn" onClick={addLine} disabled={busy}>
          + Add line
        </button>
        <button type="button" className="ap-text-btn" onClick={preview} disabled={busy}>
          Print sample
        </button>
        <button type="button" className="ap-btn-primary" onClick={save} disabled={busy || !dirty}>
          {busy ? "Working…" : dirty ? "Save design" : "Saved"}
        </button>
      </div>
    </div>
  );
}
