// ============================================================
// Bulk stock orders — the CSV rules.
//
// Pure functions only: no Supabase, no React. The screen uses these to show a
// preview before anything is written, and db/stock_room/07_bulk_stock_orders.sql
// re-checks the same rules when it writes. The SQL is the authority; this half
// exists so a person sees every mistake in their file at once instead of one
// per attempt.
//
// THE RULES (client, 2026-09-25):
//   * EXACT MATCHES ONLY. Product, size, colour, garment option, extra, head
//     and channel must match a known value exactly — ends trimmed, letter case
//     ignored, nothing else. Nothing is guessed or auto-corrected. An error may
//     NAME a close value as a hint; it is never applied.
//   * WHOLE ORDERS, OR NOTHING. One bad line fails its whole order, so no order
//     reaches the floor missing a line. Other orders in the file are unaffected.
//   * 6 UNITS PER ORDER, counted across its lines.
//   * REPEATED LINES ARE NEVER MERGED. Two identical rows are two pieces of
//     work: same order_ref → two lines on one order; no order_ref → two orders.
//   * NO STOCK CHECKS. Made-to-order, unlimited and out-of-stock designs are
//     all valid — a stock order is a request to make or buy pieces.
// ============================================================

export const MAX_UNITS_PER_ORDER = 6;
export const MAX_ORDERS_PER_FILE = 100;
export const MAX_LINES_PER_FILE = 500;

// Column order of the template and of the errors file. Order-level columns
// first, then the line, so a file reads left to right the way an order does.
export const BULK_COLUMNS = [
  "channel", "order_ref", "production_head", "order_flag", "urgent_reason", "comments", "delivery_notes",
  "sku_id", "design", "size", "quantity", "color",
  "top", "top_color", "bottom", "bottom_color",
  "includes_dupatta", "dupatta_color", "extras", "category",
  "delivery_date", "notes",
];

// Values that must appear exactly on an order's every row: they describe the
// ORDER, so two rows disagreeing is a mistake we cannot resolve.
const ORDER_LEVEL = ["channel", "production_head", "order_flag", "urgent_reason", "comments", "delivery_notes"];

export const CHANNELS = [
  { value: "retail", label: "Retail stock (SB-STOCK-…)" },
  { value: "b2b", label: "B2B stock (SB-B2BSTOCK-…)" },
];

const clean = (v) => String(v ?? "").trim();
const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();
const isBlank = (v) => clean(v) === "";

// A garment option that is really absent. Mirrors hasGarmentOption()
// (barcodeService.js): staff type "NA" for a line with no top or bottom, and a
// phantom barcode for one blocks the whole order at packaging.
const ABSENT = ["na", "n/a", "n.a.", "none", "-"];
export const isAbsentOption = (v) => isBlank(v) || ABSENT.includes(clean(v).toLowerCase());

// The one place a list is searched. Exact, case-insensitive, and it returns the
// LIBRARY's spelling so the order stores the canonical value.
export const matchExact = (list, value) => {
  const hit = (list || []).find((x) => same(x, value));
  return hit === undefined ? null : hit;
};

// A hint for the message only — never applied. Deliberately crude: the first
// value sharing the first two letters, nearest in length. It helps a person
// spot a typo; it does not let the import "fix" one.
export const hintFor = (list, value) => {
  const v = clean(value).toLowerCase();
  if (v.length < 2) return null;
  const near = (list || [])
    .filter((x) => clean(x).toLowerCase().slice(0, 2) === v.slice(0, 2))
    .sort((a, b) => Math.abs(a.length - v.length) - Math.abs(b.length - v.length) || a.localeCompare(b));
  return near[0] || null;
};

const notFound = (what, value, list) => {
  const hint = hintFor(list, value);
  return `${what} "${clean(value)}" was not found.` +
    (hint ? ` Did you mean ${hint}? The value must match exactly.` : " The value must match exactly.");
};

// Sizes a design can be ordered in: LXRTS from its size rows, everything else
// from available_size. Stock is deliberately not consulted.
export const sizesForProduct = (row) => {
  const product = row?.product || row || {};
  if (product.sync_enabled && row?.variantSizes) return row.variantSizes.filter(Boolean);
  return (Array.isArray(product.available_size) ? product.available_size : []).filter(Boolean);
};

const asList = (v) => (Array.isArray(v) ? v.filter(Boolean).map(clean) : []);

/**
 * Parse the `extras` cell: "Potli:Gold; Belt:Ivory" -> [{name, color}].
 * A pair without a colour is reported, because every extra becomes its own
 * barcoded piece and a piece needs a colour like any other.
 */
export const parseExtras = (cell) => {
  if (isBlank(cell)) return [];
  return clean(cell).split(";").map((part) => {
    const [name, ...rest] = part.split(":");
    return { name: clean(name), color: clean(rest.join(":")) };
  }).filter((e) => e.name !== "");
};

/**
 * Validate one file and group it into orders.
 *
 * @param {{headers: string[], data: object[]}} parsed  from parseCsv()
 * @param {object} ctx
 *   ctx.rows          catalogue rows: { product, variantSizes? }
 *   ctx.colors        [{name, hex}]
 *   ctx.dupattaColors [name]
 *   ctx.extras        [name]
 *   ctx.heads         [{name, designation}]
 *   ctx.today         "YYYY-MM-DD" in IST (so "today" means the user's today)
 * @returns {{orders: object[], failures: object[], fileErrors: string[], counts: object}}
 *   orders    ready for the RPC — only orders whose every line is valid
 *   failures  [{ row, raw, error }] one per failed source row
 */
export function validateBulkFile(parsed, ctx) {
  const { headers = [], data = [] } = parsed || {};
  const fileErrors = [];

  const missing = ["channel", "quantity", "color", "delivery_date"].filter((h) => !headers.includes(h));
  if (missing.length) {
    fileErrors.push(`The file is missing the ${missing.join(", ")} column${missing.length > 1 ? "s" : ""}. Download the template to see the expected columns.`);
    return { orders: [], failures: [], fileErrors, counts: empty() };
  }
  if (!data.length) {
    fileErrors.push("The file has no rows.");
    return { orders: [], failures: [], fileErrors, counts: empty() };
  }
  if (data.length > MAX_LINES_PER_FILE) {
    fileErrors.push(`A file may hold up to ${MAX_LINES_PER_FILE} lines. This one has ${data.length}.`);
    return { orders: [], failures: [], fileErrors, counts: empty() };
  }

  const colorNames = (ctx.colors || []).map((c) => c.name).filter(Boolean);
  const dupattaNames = (ctx.dupattaColors || []).filter(Boolean);
  const extraNames = (ctx.extras || []).filter(Boolean);
  const headNames = (ctx.heads || []).flatMap((h) => [h.name, h.designation]).filter(Boolean);

  // ---- group rows into orders, keeping the file's own order ----
  const groups = [];
  const byRef = new Map();
  data.forEach((raw, i) => {
    const sourceRow = i + 2;                     // +1 header, +1 for 1-based rows
    const ref = clean(raw.order_ref);
    let group;
    if (ref === "") {
      group = { ref: "", key: `__row_${sourceRow}`, rows: [] };   // its own order
      groups.push(group);
    } else if (byRef.has(ref.toLowerCase())) {
      group = byRef.get(ref.toLowerCase());
    } else {
      group = { ref, key: ref.toLowerCase(), rows: [] };
      byRef.set(ref.toLowerCase(), group);
      groups.push(group);
    }
    group.rows.push({ sourceRow, raw });
  });

  if (groups.length > MAX_ORDERS_PER_FILE) {
    fileErrors.push(`A file may raise up to ${MAX_ORDERS_PER_FILE} orders. This one would raise ${groups.length}.`);
    return { orders: [], failures: [], fileErrors, counts: empty() };
  }

  const orders = [];
  const failures = [];

  for (const group of groups) {
    const label = group.ref || `row ${group.rows[0].sourceRow}`;
    const head = group.rows[0].raw;

    // -- order level: every row must agree, then the values must be valid --
    let orderError = null;
    for (const field of ORDER_LEVEL) {
      const differing = group.rows.find((r) => !same(r.raw[field], head[field]));
      if (differing) {
        orderError = `Rows ${group.rows[0].sourceRow} and ${differing.sourceRow} of order ${label} give different ${field.replace(/_/g, " ")} values. Every row of one order must match.`;
        break;
      }
    }

    if (!orderError) {
      const channel = clean(head.channel).toLowerCase();
      if (!CHANNELS.some((c) => c.value === channel)) {
        orderError = `Order ${label}: channel "${clean(head.channel)}" is not valid. Use retail or b2b.`;
      }
    }

    let headDesignation = null;
    if (!orderError && !isBlank(head.production_head)) {
      const hit = (ctx.heads || []).find((h) => same(h.name, head.production_head) || same(h.designation, head.production_head));
      if (!hit) orderError = `Order ${label}: ${notFound("production head", head.production_head, headNames)}`;
      else headDesignation = hit.designation;
    }

    let flag = "Normal";
    if (!orderError && !isBlank(head.order_flag)) {
      if (same(head.order_flag, "Urgent")) flag = "Urgent";
      else if (!same(head.order_flag, "Normal")) orderError = `Order ${label}: order_flag must be Normal or Urgent.`;
    }
    if (!orderError && flag === "Urgent" && isBlank(head.urgent_reason)) {
      orderError = `Order ${label}: an urgent order needs urgent_reason.`;
    }

    // -- lines --
    const lines = [];
    const lineErrors = [];
    let units = 0;

    if (!orderError) {
      for (const { sourceRow, raw } of group.rows) {
        const err = (msg) => { lineErrors.push({ row: sourceRow, raw, error: `Row ${sourceRow}: ${msg}` }); };

        // product, by SKU or by an exact design name
        let row = null;
        if (!isBlank(raw.sku_id)) {
          row = (ctx.rows || []).find((r) => same(r.product.sku_id, raw.sku_id)) || null;
          if (!row) { err(`no product with SKU "${clean(raw.sku_id)}".`); continue; }
        } else if (!isBlank(raw.design)) {
          const hits = (ctx.rows || []).filter((r) => same(r.product.name, raw.design));
          if (hits.length > 1) { err(`design "${clean(raw.design)}" matches more than one product. Use the SKU.`); continue; }
          if (!hits.length) { err(`${notFound("design", raw.design, (ctx.rows || []).map((r) => r.product.name))}`); continue; }
          row = hits[0];
        } else {
          err("give a sku_id (or a design name)."); continue;
        }
        const product = row.product;

        // size — real sizes only, stock never consulted
        const sizes = sizesForProduct(row);
        let size = "";
        if (sizes.length === 0) {
          size = "";                                    // design has no sizes: "One size"
        } else if (isBlank(raw.size)) {
          err(`size is required. ${product.name} has sizes: ${sizes.join(", ")}.`); continue;
        } else {
          const hit = matchExact(sizes, raw.size);
          if (!hit) { err(`${product.name} has no size "${clean(raw.size)}". Its sizes are: ${sizes.join(", ")}.`); continue; }
          size = hit;
        }

        // quantity
        const qty = Number(clean(raw.quantity));
        if (!Number.isInteger(qty) || qty < 1) { err("quantity must be a whole number of 1 or more."); continue; }
        units += qty;

        // delivery date — never defaulted
        if (isBlank(raw.delivery_date)) { err("delivery_date is required."); continue; }
        const date = clean(raw.delivery_date);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
          err(`delivery_date "${date}" is not a date. Use YYYY-MM-DD.`); continue;
        }
        if (ctx.today && date < ctx.today) { err(`delivery date ${date} is in the past.`); continue; }

        // colours — required on every line
        if (isBlank(raw.color)) { err("color is required."); continue; }
        const color = matchExact(colorNames, raw.color);
        if (!color) { err(notFound("colour", raw.color, colorNames)); continue; }

        // garment options must belong to this design, and carry their colour
        const tops = asList(product.top_options);
        const bottoms = asList(product.bottom_options);
        let top = null, topColor = null, bottom = null, bottomColor = null;

        if (!isAbsentOption(raw.top)) {
          top = matchExact(tops, raw.top);
          if (!top) { err(`"${clean(raw.top)}" is not a top option for ${product.name}.${hintFor(tops, raw.top) ? ` Did you mean ${hintFor(tops, raw.top)}?` : ""}`); continue; }
          if (isBlank(raw.top_color)) { err("top_color is required when top is given."); continue; }
          topColor = matchExact(colorNames, raw.top_color);
          if (!topColor) { err(notFound("top colour", raw.top_color, colorNames)); continue; }
        }
        if (!isAbsentOption(raw.bottom)) {
          bottom = matchExact(bottoms, raw.bottom);
          if (!bottom) { err(`"${clean(raw.bottom)}" is not a bottom option for ${product.name}.${hintFor(bottoms, raw.bottom) ? ` Did you mean ${hintFor(bottoms, raw.bottom)}?` : ""}`); continue; }
          if (isBlank(raw.bottom_color)) { err("bottom_color is required when bottom is given."); continue; }
          bottomColor = matchExact(colorNames, raw.bottom_color);
          if (!bottomColor) { err(notFound("bottom colour", raw.bottom_color, colorNames)); continue; }
        }

        // dupatta — its own barcode, so it needs its own colour
        const wantsDupatta = same(raw.includes_dupatta, "yes") || same(raw.includes_dupatta, "true");
        if (!isBlank(raw.includes_dupatta) && !wantsDupatta
            && !same(raw.includes_dupatta, "no") && !same(raw.includes_dupatta, "false")) {
          err("includes_dupatta must be yes or no."); continue;
        }
        let dupattaColor = null;
        if (wantsDupatta) {
          if (isBlank(raw.dupatta_color)) { err("dupatta_color is required when the line includes a dupatta."); continue; }
          dupattaColor = matchExact(dupattaNames, raw.dupatta_color);
          if (!dupattaColor) { err(notFound("dupatta colour", raw.dupatta_color, dupattaNames)); continue; }
        }

        // extras — each becomes its own piece
        const extrasIn = parseExtras(raw.extras);
        const extras = [];
        let extraFailed = false;
        for (const e of extrasIn) {
          const name = matchExact(extraNames, e.name);
          if (!name) { err(notFound("extra", e.name, extraNames)); extraFailed = true; break; }
          if (isBlank(e.color)) { err(`the colour for extra "${name}" is required. Write it as ${name}:Colour.`); extraFailed = true; break; }
          const ec = matchExact(colorNames, e.color);
          if (!ec) { err(notFound(`colour for extra "${name}"`, e.color, colorNames)); extraFailed = true; break; }
          extras.push({ name, color: ec });
        }
        if (extraFailed) continue;

        if (!isBlank(raw.category) && !same(raw.category, "Women") && !same(raw.category, "Kids")) {
          err("category must be Women or Kids."); continue;
        }

        lines.push({
          source_row: sourceRow,
          sku_id: product.sku_id || null,
          design: product.sku_id ? null : product.name,
          size,
          quantity: qty,
          color,
          top, top_color: topColor,
          bottom, bottom_color: bottomColor,
          includes_dupatta: wantsDupatta,
          dupatta_color: dupattaColor,
          extras,
          category: same(raw.category, "Kids") ? "Kids" : "Women",
          delivery_date: date,
          notes: isBlank(raw.notes) ? null : clean(raw.notes),
          // preview only — not sent to the server
          _product: { id: product.id, name: product.name },
        });
      }

      if (!lineErrors.length && units > MAX_UNITS_PER_ORDER) {
        orderError = `Order ${label}: asks for ${units} units. An order may hold up to ${MAX_UNITS_PER_ORDER} units across its lines.`;
      }
    }

    // -- whole orders, or nothing --
    if (orderError) {
      group.rows.forEach(({ sourceRow, raw }) => failures.push({ row: sourceRow, raw, error: orderError }));
      continue;
    }
    if (lineErrors.length) {
      const first = lineErrors[0];
      group.rows.forEach(({ sourceRow, raw }) => {
        const own = lineErrors.find((e) => e.row === sourceRow);
        failures.push({
          row: sourceRow,
          raw,
          error: own ? own.error : `Not created — another line in order ${label} failed (row ${first.row}).`,
        });
      });
      continue;
    }

    orders.push({
      order_ref: group.ref || null,
      channel: clean(head.channel).toLowerCase(),
      production_head: headDesignation,
      order_flag: flag,
      urgent_reason: isBlank(head.urgent_reason) ? null : clean(head.urgent_reason),
      comments: isBlank(head.comments) ? null : clean(head.comments),
      delivery_notes: isBlank(head.delivery_notes) ? null : clean(head.delivery_notes),
      lines,
    });
  }

  failures.sort((a, b) => a.row - b.row);
  return {
    orders,
    failures,
    fileErrors,
    counts: {
      rows: data.length,
      orders: orders.length,
      lines: orders.reduce((n, o) => n + o.lines.length, 0),
      units: orders.reduce((n, o) => n + o.lines.reduce((u, l) => u + l.quantity, 0), 0),
      failedRows: failures.length,
      failedOrders: groups.length - orders.length,
    },
  };
}

function empty() {
  return { rows: 0, orders: 0, lines: 0, units: 0, failedRows: 0, failedOrders: 0 };
}

// The payload the RPC takes: the preview-only fields are dropped here so the
// server never sees anything it did not ask for.
export const toRpcOrders = (orders) => orders.map((o) => ({
  ...o,
  lines: o.lines.map(({ _product, ...line }) => line),
}));

// ---------------- the files ----------------

/** Failed rows: the file's own columns, plus where and why. */
export const errorRows = (failures) => failures.map(({ row, raw, error }) => ({
  ...BULK_COLUMNS.reduce((acc, h) => ({ ...acc, [h]: raw[h] ?? "" }), {}),
  error_row: row,
  error,
}));

export const ERROR_COLUMNS = [...BULK_COLUMNS, "error_row", "error"];

export const SUMMARY_COLUMNS = [
  "order_no", "order_id", "order_ref", "channel", "line_no",
  "sku_id", "design", "size", "quantity", "color",
  "top", "top_color", "bottom", "bottom_color",
  "includes_dupatta", "dupatta_color", "extras", "category",
  "delivery_date", "production_head", "order_flag", "urgent_reason",
  "notes", "comments", "delivery_notes",
  "barcodes", "pieces", "source_row", "batch_id", "created_at", "created_by",
];

/**
 * Summary of what was created: one row per created line, carrying the order
 * number and the tags the warehouse will scan.
 *
 * @param created  the RPC's created[] — { order_ref, order_no, order_id, barcodes[] }
 * @param orders   the same orders that were sent, for the line detail
 * @param meta     { batch_id, created_at, created_by }
 */
export function summaryRows(created, orders, meta = {}) {
  const sent = new Map(orders.map((o) => [String(o.order_ref ?? "") + "|" + o.lines[0]?.source_row, o]));
  const out = [];
  (created || []).forEach((c) => {
    const order = orders.find((o) =>
      (o.order_ref ?? null) === (c.order_ref ?? null) &&
      (c.rows ? o.lines.some((l) => c.rows.includes(l.source_row)) : true))
      || sent.get(String(c.order_ref ?? "") + "|" + (c.rows || [])[0]);
    if (!order) return;
    order.lines.forEach((line, i) => {
      out.push({
        order_no: c.order_no,
        order_id: c.order_id,
        order_ref: order.order_ref || "",
        channel: order.channel,
        line_no: i + 1,
        sku_id: line.sku_id || "",
        design: line._product?.name || line.design || "",
        size: line.size || "",
        quantity: line.quantity,
        color: line.color,
        top: line.top || "",
        top_color: line.top_color || "",
        bottom: line.bottom || "",
        bottom_color: line.bottom_color || "",
        includes_dupatta: line.includes_dupatta ? "yes" : "no",
        dupatta_color: line.dupatta_color || "",
        extras: (line.extras || []).map((e) => `${e.name}:${e.color}`).join("; "),
        category: line.category,
        delivery_date: line.delivery_date,
        production_head: order.production_head || "",
        order_flag: order.order_flag,
        urgent_reason: order.urgent_reason || "",
        notes: line.notes || "",
        comments: order.comments || "",
        delivery_notes: order.delivery_notes || "",
        // Barcodes are minted per ORDER; the line they belong to is visible in
        // the tag itself (…-TOP2 is product 2), so the order's set is listed.
        barcodes: (c.barcodes || []).join("; "),
        pieces: (c.barcodes || []).length,
        source_row: line.source_row,
        batch_id: meta.batch_id || "",
        created_at: meta.created_at || "",
        created_by: meta.created_by || "",
      });
    });
  });
  return out;
}

/** The template: headings plus one filled row, so the shape is obvious. */
export const templateRows = (sample = {}) => [{
  channel: "retail",
  order_ref: "A1",
  production_head: sample.head || "Khushnuma Khan",
  order_flag: "Normal",
  urgent_reason: "",
  comments: "",
  delivery_notes: "",
  sku_id: sample.sku || "SB-0001",
  design: "",
  size: sample.size || "M",
  quantity: 2,
  color: sample.color || "Ivory",
  top: "", top_color: "", bottom: "", bottom_color: "",
  includes_dupatta: "no", dupatta_color: "",
  extras: "",
  category: "Women",
  delivery_date: sample.date || "",
  notes: "",
}];

/**
 * The reference list. With nothing guessed, this is what people build files
 * from: every value that must match exactly, one per row.
 */
export const REFERENCE_COLUMNS = ["kind", "value", "belongs_to"];
export function referenceRows(ctx) {
  const rows = [];
  CHANNELS.forEach((c) => rows.push({ kind: "channel", value: c.value, belongs_to: c.label }));
  (ctx.heads || []).forEach((h) => rows.push({ kind: "production_head", value: h.name, belongs_to: h.designation }));
  (ctx.rows || []).forEach((r) => {
    const p = r.product;
    rows.push({ kind: "sku_id", value: p.sku_id || "(none)", belongs_to: p.name });
    sizesForProduct(r).forEach((s) => rows.push({ kind: "size", value: s, belongs_to: `${p.sku_id || p.name}` }));
    asList(p.top_options).forEach((t) => rows.push({ kind: "top", value: t, belongs_to: `${p.sku_id || p.name}` }));
    asList(p.bottom_options).forEach((b) => rows.push({ kind: "bottom", value: b, belongs_to: `${p.sku_id || p.name}` }));
  });
  (ctx.colors || []).forEach((c) => rows.push({ kind: "color", value: c.name, belongs_to: "" }));
  (ctx.dupattaColors || []).forEach((d) => rows.push({ kind: "dupatta_color", value: d, belongs_to: "" }));
  (ctx.extras || []).forEach((e) => rows.push({ kind: "extra", value: e, belongs_to: "" }));
  return rows;
}
