// ============================================================
// ORDER_COLUMNS gap test — every order field a screen READS must be SELECTED.
//
// Most screens fetch orders with select("*"). A few narrow it to an explicit
// ORDER_COLUMNS list to keep client-identity and money columns out of the
// browser (see utils/productionPrivacy.js). Narrowing is right, but it makes
// the select list load-bearing in a way nothing enforces:
//
//   PostgREST does NOT error on a column you simply forgot to ask for. The
//   field arrives as undefined, the filter reading it silently evaluates
//   false, and the affected orders vanish from the list with no console error
//   and no failed request.
//
// That is exactly how SB-B2BSTOCK-0926-000284 disappeared from the Retail
// Order Dashboard: production_head_designation was dropped from the select, so
// isAssignedToHead always returned false and the stock-order head assignment
// stopped working. One row in 183 — caught by a human who knew the number, not
// by any test. PackagingDashboard had the same defect with salesperson_store,
// mislabelling the 4 orders whose order_no prefix is unrecognised.
//
// This test reads the actual source: it pulls each ORDER_COLUMNS list, collects
// every `order.<field>` / `o.<field>` the file touches, and — because helpers
// like isAssignedToHead read fields the calling file never names — derives each
// exported util's own field reads from ITS source and folds those in for any
// helper the screen imports. Nothing here is a hand-maintained list, so it
// cannot drift the way a hardcoded map would.
//
// If this fails, either add the column to that screen's ORDER_COLUMNS or, when
// the field genuinely is not an orders column, add it to KNOWN_NON_COLUMNS
// below with a note on what it falls back to.
// ============================================================

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..");

// Fields read off an order object that are NOT columns on `orders`. Each is
// verified absent from the live schema and each reader has its own fallback,
// so selecting them would 42703 the entire query.
const KNOWN_NON_COLUMNS = new Set([
  "is_urgent",          // falls back to order_flag / priority
  "salesperson_name",   // falls back to sb_representative_name / salesperson
  "alteration_status",  // urgency only; order_flag / priority cover it
]);

// Real columns a screen may safely omit, with the reason. Unlike the set above
// these DO exist on `orders` — they are excused because missing them degrades
// something recoverable rather than hiding a row. Keep this list short and
// justified: "it seems unused" is not a reason, since that is precisely how
// production_head_designation was dropped.
const EXCUSED = {
  // downloadWarehousePdf checks these to reuse an already-generated PDF, then
  // calls fetchFullOrder() and regenerates when they are absent. Omitting them
  // costs a regeneration, never a wrong or missing document.
  warehouse_url: "pdf cache check only; fetchFullOrder regenerates",
  warehouse_urls: "pdf cache check only; fetchFullOrder regenerates",
};

// Property reads that are never orders columns: locals, nested objects, and
// array/JS builtins that the `order.x` regex cannot distinguish from a field.
const NOT_FIELDS = new Set([
  "length", "map", "filter", "forEach", "reduce", "find", "some", "every",
  "includes", "slice", "sort", "push", "join", "indexOf", "toLowerCase",
  "toUpperCase", "trim", "split", "replace", "match", "test", "concat",
  "keys", "values", "entries", "toString", "valueOf", "hasOwnProperty",
  "current", "data", "error", "then", "catch", "finally",
  "get", "set", "add", "has", "delete", "index", "size", "name", "type",
]);

// JS keywords the `\b(?:order|o)\s*\??\.` pattern picks up when a line happens
// to read e.g. `...o.\n  const x` across a wrap. Never field names.
const KEYWORDS = new Set([
  "const", "let", "var", "if", "else", "return", "function", "await", "async",
  "new", "typeof", "delete", "in", "of", "for", "while", "do", "class",
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(e.name) && !/\.test\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const ALL_FILES = walk(SRC);

// Pull `order.foo` / `o.foo` reads out of a chunk of source.
function fieldReads(src) {
  const out = new Set();
  for (const m of src.matchAll(/\b(?:order|o)\s*\??\.\s*([a-z_][a-z0-9_]*)/g)) {
    if (!NOT_FIELDS.has(m[1]) && !KEYWORDS.has(m[1])) out.add(m[1]);
  }
  return out;
}

// exported util name -> order fields its body reads. Derived from source so it
// tracks the helpers as they change instead of going stale.
//
// Reads are followed TRANSITIVELY. isAssignedToHead reads no field itself — it
// delegates to getAssignedHeadDesignation, which reads
// production_head_designation. A one-level scan sees nothing and would have
// missed the very bug this file exists to prevent, so each helper's fields are
// unioned with those of every other helper it calls, to a fixed point.
function buildHelperMap() {
  const direct = {};   // name -> Set(fields read in its own body)
  const calls = {};    // name -> Set(other helper names it calls)
  const bodies = {};
  const owner = {};    // name -> the module file it is defined in

  for (const f of ALL_FILES) {
    if (!f.includes(`${path.sep}utils${path.sep}`)) continue;
    const src = fs.readFileSync(f, "utf8");
    const marks = [];
    for (const m of src.matchAll(/export\s+(?:function\s+(\w+)|const\s+(\w+)\s*=)/g)) {
      marks.push({ name: m[1] || m[2], idx: m.index });
    }
    marks.forEach((mk, i) => {
      const body = src.slice(mk.idx, marks[i + 1] ? marks[i + 1].idx : src.length);
      direct[mk.name] = fieldReads(body);
      bodies[mk.name] = body;
      owner[mk.name] = f;
    });
  }

  // Resolve which helpers each one calls. Restricted to helpers defined in the
  // SAME module: a cross-module union would need real import resolution, and
  // guessing it pulls in fields from unrelated helpers that merely share a name
  // (which flagged is_private_order on a screen that never touches channel code).
  const known = Object.keys(direct);
  for (const name of known) {
    calls[name] = new Set(
      known.filter(
        (other) =>
          other !== name &&
          owner[other] === owner[name] &&
          new RegExp(`\\b${other}\\s*\\(`).test(bodies[name])
      )
    );
  }

  // Fixed point: keep unioning callee fields into callers until nothing grows.
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of known) {
      for (const callee of calls[name]) {
        for (const fld of direct[callee]) {
          if (!direct[name].has(fld)) { direct[name].add(fld); changed = true; }
        }
      }
    }
  }

  const map = {};
  for (const name of known) if (direct[name].size) map[name] = [...direct[name]];
  return map;
}

const HELPERS = buildHelperMap();

// Every file that narrows the orders select to an explicit ORDER_COLUMNS list.
function screensWithOrderColumns() {
  const found = [];
  for (const f of ALL_FILES) {
    const src = fs.readFileSync(f, "utf8");
    if (!/ORDER_COLUMNS/.test(src)) continue;
    if (!/from\(\s*["']orders["']|fetchAllRows\(\s*["']orders["']/.test(src)) continue;

    // Array form: const ORDER_COLUMNS = [ "a", "b" ].join(", ")
    // String form: const ORDER_COLUMNS = "a, b, c";
    let listBody = null;
    const arr = src.match(/ORDER_COLUMNS\s*=\s*\[([\s\S]*?)\]\s*\.join/);
    if (arr) listBody = arr[1];
    else {
      // String form. Allow // comments between the `=` and the literal —
      // [\s\S]*? would swallow the literal itself, so match comment lines
      // explicitly.
      const str = src.match(/ORDER_COLUMNS\s*=\s*(?:\/\/[^\n]*\n\s*)*(["'`])([\s\S]*?)\1\s*;/);
      if (str) listBody = str[2].split(",").map((c) => `"${c.trim()}"`).join(",");
    }
    if (!listBody) continue;

    // Strip // comments so prose inside them is never read as a column name.
    const selected = new Set(
      [...listBody.replace(/\/\/[^\n]*/g, "").matchAll(/["']([a-z_][a-z0-9_]*)["']/g)].map((m) => m[1])
    );
    found.push({ file: path.relative(SRC, f).replace(/\\/g, "/"), src, selected });
  }
  return found;
}

const SCREENS = screensWithOrderColumns();

describe("ORDER_COLUMNS covers every order field the screen reads", () => {
  test("the audit actually found the narrowed screens", () => {
    // A refactor that renames the constant would otherwise make this whole
    // suite silently vacuous.
    expect(SCREENS.length).toBeGreaterThanOrEqual(4);
  });

  test.each(SCREENS.map((s) => [s.file, s]))("%s", (_name, screen) => {
    const read = fieldReads(screen.src);

    // Fold in fields reached through helpers the screen IMPORTS and CALLS —
    // the case that hid the B2B stock order, since the screen never names the
    // field itself. Requiring the import as well as the call keeps a helper
    // that merely shares a name with a local function from dragging in fields
    // this screen can never reach.
    const imported = new Set();
    for (const m of screen.src.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'][^"']*["']/g)) {
      m[1].split(",").forEach((n) => imported.add(n.trim().split(/\s+as\s+/)[0].trim()));
    }
    for (const [fn, flds] of Object.entries(HELPERS)) {
      if (imported.has(fn) && new RegExp(`\\b${fn}\\s*\\(`).test(screen.src)) {
        flds.forEach((x) => read.add(x));
      }
    }

    const missing = [...read]
      .filter((c) => !screen.selected.has(c) && !KNOWN_NON_COLUMNS.has(c) && !(c in EXCUSED))
      .sort();

    expect({ file: screen.file, missing }).toEqual({ file: screen.file, missing: [] });
  });
});
