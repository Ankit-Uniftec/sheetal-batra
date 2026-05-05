// CSV helpers for the AddProduct feature.
//
// All in one module so AddProduct.jsx stays focused on UI/state. Pure
// functions only — no React, no Supabase calls. The component owns the
// fetch + insert orchestration.

// ─── Column schema (also used for template + export + import) ──────
// Order matters — this is the column order in the generated CSV.
//
// CSV import handles **Normal products only**. LXRTS products live in two
// tables (products + product_variants) with Shopify GIDs and need the
// manual form for now.
export const CSV_COLUMNS = [
  "sku_id",          // optional — auto-generated if blank
  "name",            // required
  "image_url",
  "base_price",      // required (number)
  "top_options",     // pipe-separated, e.g. "Kurta|Choga"
  "bottom_options",  // pipe-separated
  "default_top",
  "default_bottom",
  "default_color",
  "available_size",  // pipe-separated, e.g. "XS|S|M|L"
  "inventory",       // number or "MTO" (unlimited stock — saves as 9999)
];

// Single demo row so the user knows the shape.
export const TEMPLATE_DEMO_ROWS = [
  {
    sku_id: "",
    name: "Hafsa - Burnt Orange Chauga with Salwar (DEMO - DELETE BEFORE IMPORT)",
    image_url: "https://cdn.shopify.com/s/files/1/0398/9382/7751/files/example.jpg",
    base_price: "45500",
    top_options: "Choga|Anarkali|Kurta",
    bottom_options: "Salwar|Lehenga|Sharara",
    default_top: "Choga",
    default_bottom: "Salwar",
    default_color: "Burnt Orange",
    available_size: "XS|S|M|L|XL|XXL",
    inventory: "MTO",
  },
];

// ─── CSV escape / unescape ────────────────────────────────────────
const escapeCell = (v) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Quote if contains comma, quote, newline; double-up internal quotes
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

// Parse a CSV string into an array of rows (each row is an array of strings).
// Handles quoted fields, embedded commas, embedded newlines, "" → " escape.
const parseCsvRaw = (text) => {
  const rows = [];
  let cur = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  // Strip BOM if present
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ",") { cur.push(field); field = ""; i += 1; continue; }
    if (ch === "\r") { i += 1; continue; } // CRLF — skip CR, handle on \n
    if (ch === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; i += 1; continue; }
    field += ch; i += 1;
  }
  // Trailing field/row
  if (field !== "" || cur.length > 0) { cur.push(field); rows.push(cur); }
  return rows;
};

// Parse CSV text into an array of objects keyed by header.
export const parseCsv = (text) => {
  const rows = parseCsvRaw(text);
  if (rows.length === 0) return { headers: [], data: [] };
  const headers = rows[0].map((h) => h.trim());
  const data = rows.slice(1)
    // drop fully empty rows
    .filter((r) => r.some((c) => c && c.trim() !== ""))
    .map((r) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (r[i] ?? "").trim(); });
      return obj;
    });
  return { headers, data };
};

// Build a CSV string from headers + array of row objects.
export const buildCsv = (headers, rows) => {
  const headerLine = headers.map(escapeCell).join(",");
  const body = rows.map((r) => headers.map((h) => escapeCell(r[h])).join(",")).join("\n");
  // BOM so Excel detects UTF-8 cleanly
  return "﻿" + headerLine + "\n" + body + (body ? "\n" : "");
};

// Trigger a download in the browser.
export const downloadCsv = (filename, csvText) => {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Pipe-separated list helper. "Kurta|Choga" → ["Kurta", "Choga"]. Empty → [].
const splitPipes = (s) =>
  (s || "")
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);

// ─── Per-row validation (Normal products only) ────────────────────
// Returns { ok: true, normalized } or { ok: false, errors: [string, ...] }.
// `normalized` is a clean object ready to insert.
export const validateRow = (row, rowIndex) => {
  const errors = [];
  if (!row.name || !row.name.trim()) {
    errors.push(`Row ${rowIndex}: name is required.`);
  }
  const basePrice = Number(row.base_price);
  if (!row.base_price || isNaN(basePrice) || basePrice <= 0) {
    errors.push(`Row ${rowIndex}: base_price must be a number > 0.`);
  }

  const tops = splitPipes(row.top_options);
  const bottoms = splitPipes(row.bottom_options);

  // Defaults must appear in their option lists if both are provided
  if (row.default_top && tops.length > 0 && !tops.includes(row.default_top.trim())) {
    errors.push(`Row ${rowIndex}: default_top '${row.default_top}' not in top_options.`);
  }
  if (row.default_bottom && bottoms.length > 0 && !bottoms.includes(row.default_bottom.trim())) {
    errors.push(`Row ${rowIndex}: default_bottom '${row.default_bottom}' not in bottom_options.`);
  }

  const availableSizes = splitPipes(row.available_size);
  const invStr = (row.inventory || "").trim();
  let inventory = 0;
  if (invStr.toUpperCase() === "MTO") inventory = 9999;
  else if (invStr === "") inventory = 0;
  else {
    const n = Number(invStr);
    if (isNaN(n) || n < 0) errors.push(`Row ${rowIndex}: inventory must be a non-negative number or 'MTO'.`);
    else inventory = n;
  }
  if (availableSizes.length === 0 && inventory !== 9999) {
    errors.push(`Row ${rowIndex}: available_size required (or set inventory to 'MTO').`);
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    normalized: {
      sku_id: (row.sku_id || "").trim() || null,
      name: row.name.trim(),
      image_url: (row.image_url || "").trim() || null,
      base_price: basePrice,
      top_options: tops.length > 0 ? tops : null,
      bottom_options: bottoms.length > 0 ? bottoms : null,
      default_top: (row.default_top || "").trim() || null,
      default_bottom: (row.default_bottom || "").trim() || null,
      default_color: (row.default_color || "").trim() || null,
      available_size: availableSizes.length > 0 ? availableSizes : null,
      inventory,
    },
  };
};
