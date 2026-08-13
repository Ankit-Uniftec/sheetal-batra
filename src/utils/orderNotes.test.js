import { mergeOrderNotes } from "./orderNotes";

// The exact expression WarehouseOrderPdf used before it was extracted. The
// helper must stay behaviour-identical for the fields the PDF already handled.
const legacy = (order, item) =>
  [...new Set([item.notes, order.comments, order.delivery_notes]
    .filter(n => n && n.trim() !== ""))]
    .join(" | ");

test("no notes anywhere yields an empty string (card and PDF both hide)", () => {
  expect(mergeOrderNotes({}, {})).toBe("");
  expect(mergeOrderNotes({ comments: "   " }, { notes: "" })).toBe("");
  expect(mergeOrderNotes(null, null)).toBe("");
});

test("merges all three sources, de-duped", () => {
  expect(mergeOrderNotes({ comments: "4 aug dispatch" }, {})).toBe("4 aug dispatch");
  expect(mergeOrderNotes(
    { comments: "same", delivery_notes: "same" }, { notes: "other" }
  )).toBe("other | same");
});

test("keeps the author's line breaks verbatim", () => {
  const note = "4 aug dispatch\n\nNo buffer at all";
  expect(mergeOrderNotes({ comments: note }, {})).toBe(note);
});

test("matches the pre-extraction PDF behaviour on real note shapes", () => {
  const cases = [
    [{ comments: "12 aug dispatch" }, {}],
    [{ comments: "CLIENT NEEDS SIZE SMALL , PLEASE NOTE" }, { notes: "check lace" }],
    [{ comments: "dup", delivery_notes: "dup" }, {}],
    [{ comments: null, delivery_notes: "ship fast" }, { notes: null }],
    [{}, {}],
  ];
  cases.forEach(([order, item]) =>
    expect(mergeOrderNotes(order, item)).toBe(legacy(order, item))
  );
});

test("tolerates a non-string note without throwing", () => {
  // legacy .trim() would have crashed on a number; the PDF must not blow up.
  expect(() => mergeOrderNotes({ comments: 123 }, {})).not.toThrow();
  expect(mergeOrderNotes({ comments: 123 }, {})).toBe("123");
});
