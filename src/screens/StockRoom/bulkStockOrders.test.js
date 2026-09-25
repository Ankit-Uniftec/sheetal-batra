import {
  validateBulkFile, toRpcOrders, errorRows, summaryRows, parseExtras, hintFor, MAX_UNITS_PER_ORDER,
} from "./bulkStockOrders";

// A small catalogue: one made-to-order design with sizes and options, one
// LXRTS design whose sizes come from its size rows, one design with no sizes.
const ctx = {
  rows: [
    {
      product: {
        id: "p1", name: "Zoya Anarkali", sku_id: "SB-2201", sync_enabled: false,
        available_size: ["XS", "S", "M", "L"], top_options: ["Kurta", "Choga"], bottom_options: ["Sharara"],
        is_custom_piece: false, image_url: null, shopify_product_id: null,
      },
    },
    {
      product: {
        id: "p2", name: "Mira Set", sku_id: "SB-3310", sync_enabled: true,
        available_size: [], top_options: [], bottom_options: [], is_custom_piece: false,
      },
      variantSizes: ["M", "L"],
    },
    {
      product: {
        id: "p3", name: "Lighter Dupatta", sku_id: "SB-4102", sync_enabled: false,
        available_size: [], top_options: [], bottom_options: [],
      },
    },
  ],
  colors: [{ name: "Ivory", hex: "#eee" }, { name: "Gold", hex: "#d4af37" }],
  dupattaColors: ["Midnight Blue"],
  extras: ["Potli", "Belt"],
  heads: [
    { name: "Khushnuma Khan", designation: "Offline Production Head" },
    { name: "Tara Gupta", designation: "B2B Production Head" },
  ],
  today: "2026-09-25",
};

const HEADERS = [
  "channel", "order_ref", "production_head", "order_flag", "urgent_reason", "comments", "delivery_notes",
  "sku_id", "design", "size", "quantity", "color", "top", "top_color", "bottom", "bottom_color",
  "includes_dupatta", "dupatta_color", "extras", "category", "delivery_date", "notes",
];

// A valid row; each test overrides only what it is about.
const row = (over = {}) => ({
  channel: "retail", order_ref: "", production_head: "", order_flag: "", urgent_reason: "",
  comments: "", delivery_notes: "", sku_id: "SB-2201", design: "", size: "M", quantity: "2",
  color: "Ivory", top: "", top_color: "", bottom: "", bottom_color: "",
  includes_dupatta: "", dupatta_color: "", extras: "", category: "", delivery_date: "2026-10-20",
  notes: "", ...over,
});

const run = (rows) => validateBulkFile({ headers: HEADERS, data: rows }, ctx);

describe("grouping", () => {
  it("puts rows sharing an order_ref on one order", () => {
    const { orders, failures } = run([row({ order_ref: "A1", size: "S" }), row({ order_ref: "A1", size: "M" })]);
    expect(failures).toEqual([]);
    expect(orders).toHaveLength(1);
    expect(orders[0].lines.map((l) => l.size)).toEqual(["S", "M"]);
  });

  it("makes each row with no order_ref its own order", () => {
    const { orders } = run([row(), row()]);
    expect(orders).toHaveLength(2);
  });

  it("never merges identical lines: same ref keeps two lines, blank ref makes two orders", () => {
    const shared = run([row({ order_ref: "A1", quantity: "2" }), row({ order_ref: "A1", quantity: "2" })]);
    expect(shared.orders).toHaveLength(1);
    expect(shared.orders[0].lines).toHaveLength(2);
    expect(shared.orders[0].lines.every((l) => l.quantity === 2)).toBe(true);

    const separate = run([row({ quantity: "2" }), row({ quantity: "2" })]);
    expect(separate.orders).toHaveLength(2);
  });
});

describe("exact matching, never guessing", () => {
  it("accepts a different letter case", () => {
    const { orders, failures } = run([row({ size: "m", color: "ivory", channel: "RETAIL" })]);
    expect(failures).toEqual([]);
    expect(orders[0].lines[0].size).toBe("M");        // stored as the library spells it
    expect(orders[0].lines[0].color).toBe("Ivory");
  });

  it("refuses a size that is merely similar, and says what the real ones are", () => {
    const { orders, failures } = run([row({ size: "Small" })]);
    expect(orders).toEqual([]);
    expect(failures[0].error).toMatch(/has no size "Small"/);
    expect(failures[0].error).toMatch(/XS, S, M, L/);
  });

  it("refuses a misspelt colour but names the close one as a hint", () => {
    const { orders, failures } = run([row({ color: "Ivry" })]);
    expect(orders).toEqual([]);
    expect(failures[0].error).toMatch(/was not found/);
    expect(failures[0].error).toMatch(/Did you mean Ivory\?/);
  });

  it("refuses an unknown production head", () => {
    const { failures } = run([row({ production_head: "K. Khan" })]);
    expect(failures[0].error).toMatch(/production head "K. Khan" was not found/);
  });

  it("accepts a head by name or by designation, and stores the designation", () => {
    expect(run([row({ production_head: "Tara Gupta" })]).orders[0].production_head).toBe("B2B Production Head");
    expect(run([row({ production_head: "offline production head" })]).orders[0].production_head).toBe("Offline Production Head");
  });

  it("refuses an unknown channel", () => {
    const { failures } = run([row({ channel: "retail stock" })]);
    expect(failures[0].error).toMatch(/channel "retail stock" is not valid/);
  });

  it("hintFor only suggests, and only when something is close", () => {
    expect(hintFor(["Ivory", "Gold"], "Ivry")).toBe("Ivory");
    expect(hintFor(["Ivory", "Gold"], "Zzz")).toBeNull();
  });
});

describe("whole orders, or nothing", () => {
  it("fails every row of an order when one line is bad, and leaves other orders alone", () => {
    const { orders, failures, counts } = run([
      row({ order_ref: "A1", size: "M" }),
      row({ order_ref: "A1", size: "Small" }),     // the bad one
      row({ order_ref: "A2", size: "L" }),
    ]);
    expect(orders).toHaveLength(1);
    expect(orders[0].order_ref).toBe("A2");
    expect(failures.map((f) => f.row)).toEqual([2, 3]);
    expect(failures.find((f) => f.row === 3).error).toMatch(/has no size "Small"/);
    expect(failures.find((f) => f.row === 2).error).toMatch(/another line in order A1 failed/);
    expect(counts.failedOrders).toBe(1);
  });

  it("fails the order when its rows disagree on an order-level value", () => {
    const { orders, failures } = run([
      row({ order_ref: "A1", production_head: "Khushnuma Khan" }),
      row({ order_ref: "A1", production_head: "Tara Gupta" }),
    ]);
    expect(orders).toEqual([]);
    expect(failures).toHaveLength(2);
    expect(failures[0].error).toMatch(/different production head values/);
  });
});

describe("the rules", () => {
  it("caps an order at 6 units across its lines", () => {
    const ok = run([row({ order_ref: "A1", quantity: "4" }), row({ order_ref: "A1", quantity: "2", size: "S" })]);
    expect(ok.failures).toEqual([]);
    expect(ok.orders[0].lines).toHaveLength(2);

    const over = run([row({ order_ref: "A1", quantity: "4" }), row({ order_ref: "A1", quantity: "3", size: "S" })]);
    expect(over.orders).toEqual([]);
    expect(over.failures[0].error).toMatch(new RegExp(`up to ${MAX_UNITS_PER_ORDER} units`));
  });

  it("requires a delivery date and refuses a past one", () => {
    expect(run([row({ delivery_date: "" })]).failures[0].error).toMatch(/delivery_date is required/);
    expect(run([row({ delivery_date: "2026-09-01" })]).failures[0].error).toMatch(/is in the past/);
    expect(run([row({ delivery_date: "20-10-2026" })]).failures[0].error).toMatch(/Use YYYY-MM-DD/);
  });

  it("requires a colour on the line and on every garment part", () => {
    expect(run([row({ color: "" })]).failures[0].error).toMatch(/color is required/);
    expect(run([row({ top: "Kurta" })]).failures[0].error).toMatch(/top_color is required/);
    expect(run([row({ bottom: "Sharara", bottom_color: "" })]).failures[0].error).toMatch(/bottom_color is required/);
    expect(run([row({ includes_dupatta: "yes" })]).failures[0].error).toMatch(/dupatta_color is required/);
    expect(run([row({ extras: "Potli" })]).failures[0].error).toMatch(/colour for extra "Potli" is required/);
  });

  it("checks garment options belong to the design", () => {
    expect(run([row({ top: "Sharara", top_color: "Ivory" })]).failures[0].error)
      .toMatch(/is not a top option for Zoya Anarkali/);
    const ok = run([row({ top: "Kurta", top_color: "Ivory", bottom: "Sharara", bottom_color: "Gold" })]);
    expect(ok.failures).toEqual([]);
  });

  it("takes LXRTS sizes from the size rows", () => {
    expect(run([row({ sku_id: "SB-3310", size: "M" })]).failures).toEqual([]);
    expect(run([row({ sku_id: "SB-3310", size: "XS" })]).failures[0].error).toMatch(/has no size "XS"/);
  });

  it("allows a design with no sizes, and does not ask for one", () => {
    const { orders, failures } = run([row({ sku_id: "SB-4102", size: "" })]);
    expect(failures).toEqual([]);
    expect(orders[0].lines[0].size).toBe("");
  });

  it("never looks at stock: a design with none is still orderable", () => {
    // p1 carries no stock in this catalogue at all — no error mentions stock.
    const { failures } = run([row()]);
    expect(failures).toEqual([]);
  });

  it("reads extras as name:colour pairs", () => {
    expect(parseExtras("Potli:Gold; Belt:Ivory")).toEqual([
      { name: "Potli", color: "Gold" }, { name: "Belt", color: "Ivory" },
    ]);
    const { orders } = run([row({ extras: "Potli:Gold" })]);
    expect(orders[0].lines[0].extras).toEqual([{ name: "Potli", color: "Gold" }]);
  });

  it("refuses an unknown extra", () => {
    expect(run([row({ extras: "Potlii:Gold" })]).failures[0].error).toMatch(/extra "Potlii" was not found/);
  });

  it("requires quantity to be a whole number of 1 or more", () => {
    expect(run([row({ quantity: "0" })]).failures[0].error).toMatch(/whole number of 1 or more/);
    expect(run([row({ quantity: "1.5" })]).failures[0].error).toMatch(/whole number of 1 or more/);
    expect(run([row({ quantity: "two" })]).failures[0].error).toMatch(/whole number of 1 or more/);
  });

  it("needs an urgent reason when the order is urgent", () => {
    expect(run([row({ order_flag: "Urgent" })]).failures[0].error).toMatch(/needs urgent_reason/);
    expect(run([row({ order_flag: "Urgent", urgent_reason: "Shoot on 12 Oct" })]).failures).toEqual([]);
  });
});

describe("the file it sends and the files it gives back", () => {
  it("drops preview-only fields from the payload", () => {
    const { orders } = run([row()]);
    const sent = toRpcOrders(orders);
    expect(orders[0].lines[0]._product).toBeDefined();
    expect(sent[0].lines[0]._product).toBeUndefined();
    expect(sent[0].lines[0].sku_id).toBe("SB-2201");
  });

  it("writes failed rows with the original columns plus where and why", () => {
    const { failures } = run([row({ size: "Small", notes: "keep me" })]);
    const [out] = errorRows(failures);
    expect(out.size).toBe("Small");
    expect(out.notes).toBe("keep me");
    expect(out.error_row).toBe(2);
    expect(out.error).toMatch(/has no size "Small"/);
  });

  it("writes a summary row per created line, carrying the order number", () => {
    const { orders } = run([row({ order_ref: "A1", size: "S" }), row({ order_ref: "A1", size: "M" })]);
    const created = [{
      order_ref: "A1", order_no: "SB-STOCK-0926-004120", order_id: "o-1",
      rows: [2, 3], barcodes: ["STOCK-004120-TOP", "STOCK-004120-TOP2"],
    }];
    const rows = summaryRows(created, orders, { batch_id: "b-1", created_at: "2026-09-25T18:40:12+05:30", created_by: "ankit@x.com" });
    expect(rows).toHaveLength(2);
    expect(rows[0].order_no).toBe("SB-STOCK-0926-004120");
    expect(rows[0].line_no).toBe(1);
    expect(rows[0].source_row).toBe(2);
    expect(rows[1].source_row).toBe(3);
    expect(rows[0].pieces).toBe(2);
    expect(rows[0].batch_id).toBe("b-1");
  });
});

describe("the file as a whole", () => {
  it("says which columns are missing", () => {
    const { fileErrors } = validateBulkFile({ headers: ["channel", "quantity"], data: [row()] }, ctx);
    expect(fileErrors[0]).toMatch(/missing the color, delivery_date column/);
  });

  it("refuses an empty file", () => {
    expect(validateBulkFile({ headers: HEADERS, data: [] }, ctx).fileErrors[0]).toMatch(/no rows/);
  });

  it("counts what will happen", () => {
    const { counts } = run([row({ order_ref: "A1" }), row({ order_ref: "A1", size: "S" }), row({ size: "Small" })]);
    expect(counts).toMatchObject({ rows: 3, orders: 1, lines: 2, units: 4, failedRows: 1, failedOrders: 1 });
  });
});
