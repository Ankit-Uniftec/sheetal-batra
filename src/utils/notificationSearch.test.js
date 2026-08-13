// Guards the notification search term sanitiser. Commas and parens are
// PostgREST or() delimiters: an unsanitised "a,b" is parsed as two conditions
// and the query 400s, so the search box would break on ordinary typed text.
// Mirrors the cleaning in getNotifications (notificationService.js).
const sanitize = (search) => {
  const q = String(search || "").trim();
  if (!q) return "";
  return q.replace(/[,()]/g, " ").replace(/\s+/g, " ").trim();
};

test("blank input yields no filter (drawer shows the recent list)", () => {
  expect(sanitize("")).toBe("");
  expect(sanitize("   ")).toBe("");
  expect(sanitize(null)).toBe("");
  expect(sanitize(undefined)).toBe("");
});

test("ordinary terms pass through untouched", () => {
  expect(sanitize("kurta")).toBe("kurta");
  expect(sanitize("  delayed order  ")).toBe("delayed order");
  expect(sanitize("delayed    order")).toBe("delayed order");
  expect(sanitize("SB-SHOPIFY-0826-000175")).toBe("SB-SHOPIFY-0826-000175");
});

test("or() delimiters are neutralised, not passed to PostgREST", () => {
  // Collapsed to a SINGLE space: a doubled space would not match the real text.
  expect(sanitize("a,b")).toBe("a b");
  expect(sanitize("(urgent)")).toBe("urgent");
  expect(sanitize("qc,rework(2)")).toBe("qc rework 2");
  ["," , "(", ")"].forEach((ch) => expect(sanitize(ch)).not.toContain(ch));
});

test("a term made only of delimiters collapses to empty, so no filter is sent", () => {
  // Important: must be "" and not " ", or we would send an all-wildcard filter.
  expect(sanitize(",,,")).toBe("");
  expect(sanitize("()")).toBe("");
});

test("% and _ are left alone (they widen an ilike, they cannot break it)", () => {
  expect(sanitize("50%")).toBe("50%");
});
