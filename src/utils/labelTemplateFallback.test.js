// ============================================================
// Printing must survive a database that has never seen migration 92.
//
// Barcode printing is an EXISTING feature. The label template is a NEW one. The
// first version of this code threw when `label_templates` was absent, which
// made re-print fail outright on every deployment where the migration had not
// run yet:
//
//   "Could not find the table 'public.label_templates' in the schema cache"
//
// A new feature must never take a working one down with it. A missing table
// means exactly what a missing row means — nobody has customised the slip — and
// both must print the original design.
//
// Separate file from labelTemplate.test.js because this one mocks the Supabase
// client, and that mock must not leak into the pure resolution tests.
// ============================================================

const mockMaybeSingle = jest.fn();

jest.mock("../lib/supabaseClient", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mockMaybeSingle }),
      }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  },
}));

const { fetchLabelTemplate, DEFAULT_TEMPLATE } = require("./labelTemplate");

// The exact shape PostgREST returns for a table that is not in the schema
// cache — copied from the real failure, not invented.
const TABLE_MISSING = {
  code: "PGRST205",
  message: "Could not find the table 'public.label_templates' in the schema cache",
};

beforeEach(() => mockMaybeSingle.mockReset());

describe("printing without migration 92", () => {
  test("a missing table prints the default slip instead of throwing", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: TABLE_MISSING });

    const t = await fetchLabelTemplate("sku");
    expect(t).toMatchObject(DEFAULT_TEMPLATE);
    expect(t.missing).toBe(true);
  });

  test("42P01 (undefined_table) is treated the same", async () => {
    // PostgREST surfaces the raw Postgres code in some versions/paths.
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { code: "42P01", message: 'relation "label_templates" does not exist' },
    });

    await expect(fetchLabelTemplate("sku")).resolves.toMatchObject(DEFAULT_TEMPLATE);
  });

  test("a missing ROW also prints the default slip", async () => {
    // The table exists but this surface was never seeded.
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(fetchLabelTemplate("sku")).resolves.toMatchObject(DEFAULT_TEMPLATE);
  });

  test("a REAL read failure still throws", async () => {
    // Network, RLS, malformed response: a design may exist that we could not
    // read. Printing a different one across a roll of stickers is expensive and
    // physical, so the caller must decide — this must NOT silently fall back.
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { code: "PGRST301", message: "JWT expired" },
    });

    await expect(fetchLabelTemplate("sku")).rejects.toMatchObject({ code: "PGRST301" });
  });

  test("EDITING still fails loudly when the table is missing", async () => {
    // The designer passes required:true. Offering an editable design with
    // nowhere to save it would lose the client's work.
    mockMaybeSingle.mockResolvedValue({ data: null, error: TABLE_MISSING });

    await expect(
      fetchLabelTemplate("sku", { required: true })
    ).rejects.toMatchObject({ code: "PGRST205" });
  });

  test("a real saved template is returned normally", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        key: "sku", width_mm: "40.00", height_mm: "30.00",
        lines: [{ field: "name", size: 5 }], show_value: false,
      },
      error: null,
    });

    const t = await fetchLabelTemplate("sku");
    // numeric(6,2) arrives as a STRING over PostgREST; the PDF multiplies it by
    // a points-per-mm factor, and "40.00" * MM is NaN — hence the Number().
    expect(t.width_mm).toBe(40);
    expect(t.height_mm).toBe(30);
    expect(t.show_value).toBe(false);
    expect(t.lines).toEqual([{ field: "name", size: 5 }]);
  });
});
