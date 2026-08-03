// Shared CSV download — the one place that knows how to turn rows into a file
// the client's Excel opens correctly.
//
// Every dashboard had its own copy of this boilerplate (Blob + BOM + anchor +
// revokeObjectURL). They agreed on the important parts by luck rather than by
// construction, so any fix had to be made in seven places.
//
// Two details that are easy to get wrong and matter here:
//   * The leading ﻿ byte-order mark. Without it Excel reads the file as
//     ANSI and mangles every non-ASCII character — customer names and product
//     names in this app routinely contain them.
//   * Quoting. A value containing a comma, quote or newline must be wrapped in
//     quotes with internal quotes doubled, or the row silently splits into the
//     wrong number of columns. Product names contain commas constantly.

// Escape one value into a CSV field. null/undefined become empty, never the
// strings "null"/"undefined" — those land in the client's spreadsheet as data.
function toField(v) {
  if (v == null) return '""';
  return `"${String(v).replace(/"/g, '""')}"`;
}

/**
 * Build CSV text from headers + rows. Exposed separately so callers that need
 * the string (tests, an email body) can skip the download.
 *
 * @param {string[]}   headers
 * @param {Array[]}    rows      array of arrays, same order as headers
 * @returns {string}
 */
export function toCsv(headers, rows) {
  return [
    headers.map(toField).join(","),
    ...rows.map((r) => r.map(toField).join(",")),
  ].join("\n");
}

/**
 * Build and download a CSV.
 *
 * @param {object}   opts
 * @param {string}   opts.filename  without extension; a .csv is appended, and
 *                                  today's date is stamped on unless dated=false
 * @param {string[]} opts.headers
 * @param {Array[]}  opts.rows      array of arrays, same order as headers
 * @param {boolean}  [opts.dated=true]
 * @returns {number} rows written, so the caller can report/skip on empty
 */
export function downloadCsv({ filename, headers, rows, dated = true }) {
  const csv = toCsv(headers, rows);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = dated ? `_${new Date().toISOString().slice(0, 10)}` : "";
  a.download = `${filename}${stamp}.csv`;
  a.click();
  // Revoke on the next tick, not synchronously: Safari cancels an in-flight
  // download when the object URL is revoked in the same frame as the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return rows.length;
}

export default downloadCsv;
