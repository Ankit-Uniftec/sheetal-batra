// ============================================================
// mapper.ts — Shopify order node → { orderRow, items, blockers }
//
// PURE. No I/O, no Supabase, no fetch. Everything it needs arrives as an
// argument, so all three ingestion modes (webhook / reconcile poll / manual
// sync-now) share one code path, and it can be unit-tested without Shopify.
//
// The order number, user_id and shopify_raw are filled in by index.ts — this
// module has no way to generate or look them up.
//
// Every mapping decision below was verified against real orders and a
// 250-product / 4,871-variant sweep of the live catalogue. See
// scratchpad/field-map.md for the full field-by-field table.
// ============================================================

export type Blocker = { code: string; detail: string };

// A Shopify order once ingested is an ORDINARY order — same production flow,
// warehouse stages, dispatch and delivery as a store/B2B/exhibition order.
// Only its arrival path differs. Keep that in mind before adding any
// channel-specific branching here.

// ─── Constants ──────────────────────────────────────────────

export const SHOPIFY_STORE_KEY = "Shopify"; // generate_order_no(p_store) key → SHOPIFY prefix

// There is no human SA on a Shopify order, so this stands in wherever the app
// shows one — including "SALES ASSOCIATE:" on the warehouse work order.
// Display only: nothing branches on this string (checked), so it is safe to
// reword. Existing rows keep the older "Website" value unless remapped; both
// read as "not a person", which is all this field has to convey here.
const SALESPERSON_LABEL = "Shopify";

// "NA"-style markers the app treats as "no such garment piece". Mirrors
// hasGarmentOption() in src/utils/barcodeService.js so we never mint a phantom
// barcode for a piece that doesn't physically exist.
const ABSENT = ["", "na", "n/a", "n.a.", "none", "-"];

// ─── Small helpers ──────────────────────────────────────────

const clean = (v: unknown): string => (v == null ? "" : String(v)).trim();

/** Metafield alias → its string value, or "". Shopify returns { value } | null. */
const mf = (node: any, key: string): string => clean(node?.[key]?.value);

/** Shopify Money → number. "26675.0" → 26675. */
const money = (set: any): number => {
  const n = Number(set?.shopMoney?.amount);
  return Number.isFinite(n) ? n : 0;
};

const isPresent = (v: string): boolean => !ABSENT.includes(v.toLowerCase());

/**
 * A selectedOptions lookup, case-insensitive on the option NAME.
 * Live data uses "Color", "Size", "Style", "Kurta Size", "Age".
 */
const opt = (variant: any, ...names: string[]): string => {
  const wanted = names.map((n) => n.toLowerCase());
  const found = (variant?.selectedOptions || []).find((o: any) =>
    wanted.includes(clean(o?.name).toLowerCase())
  );
  return clean(found?.value);
};

/**
 * Size lives on THREE different axes in this catalogue (measured over 4,871
 * variants): "Size" (4429), "Kurta Size" (396) and "Age" (45, kidswear).
 * Reading only "Size" would leave 18 products with a null size.
 */
const SIZE_OPTION_NAMES = ["Size", "Kurta Size", "Age"];

const resolveSize = (variant: any): string =>
  opt(variant, "Size") || opt(variant, "Kurta Size") || opt(variant, "Age");

/**
 * WHICH axis the resolved size came from, so the UI can label it honestly — an
 * Age value reads "5-6 YEARS" and must not be shown as "Size:".
 *
 * Must walk the SAME precedence as resolveSize: a variant carrying both Size
 * and Age takes the Size value, so checking Age first would label it "Age" and
 * print a size under the wrong heading. Returns "" when the variant has no
 * size axis at all.
 */
const resolveSizeLabel = (variant: any): string => {
  const name = SIZE_OPTION_NAMES.find((n) => opt(variant, n));
  if (!name) return "";
  // "Kurta Size" is the same axis under a product-specific name, not a second
  // measurement — label it plainly as Size.
  return name === "Age" ? "Age" : "Size";
};

/**
 * Does this variant include a dupatta?
 *
 * The Style option has FOUR states in live data, not two:
 *   "Without Dupatta" (1656) · "With Dupatta" (1440)
 *   "With Heavy Dupatta" (216) · "With Light Dupatta" (180)
 * plus real typos: "With Dupataa" / "Without Dupataa" (12 each).
 *
 * And "Style" is NOT always about dupattas — "With Pants" / "Without Pants"
 * (36 each) reuses the same option name.
 *
 * So: only consider a Style value that mentions a dupatta (however spelled),
 * then decide on the with/without prefix. Never compare === "With Dupatta".
 *
 * Resolution order — Style option, then metafield, then give up:
 *
 *   1. The variant's Style option. AUTHORITATIVE: it is what the customer
 *      actually chose at checkout. 142 of 250 live products have one.
 *   2. The product's `custom.has_dupatta` metafield, for the 108 products with
 *      no Style option (almost all "Set" products — Lehenga Set, Anarkali Set —
 *      where the dupatta is always included so no choice was ever offered).
 *   3. Neither → we do not know. The caller quarantines (DUPATTA_UNKNOWN).
 *
 * NOTHING is inferred from the product NAME. A name is marketing copy: it is
 * re-worded for SEO, carries live misspellings ("Dupataa") and synonyms
 * ("Odhni"), and any such drift would silently drop a barcode with no error.
 * Production data must come from a field, never from prose.
 */
const resolveDupatta = (variant: any, product: any): boolean => {
  const style = opt(variant, "Style").toLowerCase();

  // 1. Explicit customer choice.
  if (style && /dupat/.test(style)) {
    // NB: check "without" FIRST — "without".startsWith("with") is true, so a
    // naive with-check silently marks every Without-Dupatta variant as having
    // one, minting a phantom DUP barcode that blocks packaging (every active
    // component must clear Final QC).
    if (/\bwithout\b/.test(style)) return false;
    return /\bwith\b/.test(style);
  }

  // 2. Product-level metafield. Shopify returns metafield values as strings,
  //    so a boolean metafield arrives as "true"/"false".
  return isTruthyMetafield(mf(product, "hasDupatta"));
};

/** Shopify metafield values are strings — "true"/"1"/"yes" all mean true. */
const isTruthyMetafield = (v: string): boolean =>
  ["true", "1", "yes", "y"].includes(clean(v).toLowerCase());

/**
 * True when nothing tells us whether this line includes a dupatta: no dupatta
 * Style option AND no `custom.has_dupatta` metafield.
 *
 * Assuming "no" would lose a real piece from production; assuming "yes" would
 * mint a phantom component that blocks packaging. So the order is flagged for
 * a human instead. Populating `custom.has_dupatta` on the ~108 products that
 * need it retires this path with no code change.
 */
export function isDupattaUnknown(variant: any, product: any): boolean {
  const style = opt(variant, "Style").toLowerCase();
  if (style && /dupat/.test(style)) return false;        // explicit choice exists
  return clean(mf(product, "hasDupatta")) === "";        // no metafield either
}

/** The Heavy/Light qualifier, so the distinction isn't lost. "" when plain. */
const dupattaQualifier = (variant: any): string => {
  const style = opt(variant, "Style");
  if (!/dupat/i.test(style)) return "";
  const m = style.match(/\b(heavy|light)\b/i);
  return m ? m[1].toLowerCase() : "";
};

/**
 * Garment style values carry whitespace and spelling noise in live data:
 * "Choga " (8) vs "Choga" (45), "Short Kurta ", "Palazzo ", " Garara",
 * and a Gharara/Garara split. Trim, collapse inner runs, and fix the one
 * known spelling variant so component labels don't fragment.
 */
const normaliseStyle = (v: string): string => {
  const s = clean(v).replace(/\s+/g, " ");
  if (!s) return "";
  if (/^garara$/i.test(s)) return "Gharara";
  return s;
};

/** Bare 10-digit Indian numbers → E.164. Mirrors the app's phone handling. */
export const toE164 = (raw: unknown): string => {
  const s = clean(raw);
  if (!s) return "";
  const digits = s.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  const bare = digits.replace(/^0+/, "");
  if (bare.length === 10) return `+91${bare}`;
  if (bare.length === 12 && bare.startsWith("91")) return `+${bare}`;
  return bare ? `+${bare}` : "";
};

const addDays = (iso: string, days: number): string => {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10); // DATE column
};

// ─── Line items ─────────────────────────────────────────────

function mapLineItem(
  node: any,
  deliveryDate: string | null,
  blockers: Blocker[],
  hexByColorName?: Map<string, string>
) {
  const variant = node?.variant || {};
  const product = variant?.product || {};

  // The garment breakdown comes from PRODUCT metafields (99.2% / 98.0%
  // populated). This is what generateOrderComponents consumes to mint
  // one barcode per physical piece.
  const top = normaliseStyle(mf(product, "topStyle"));
  const bottom = normaliseStyle(mf(product, "bottomStyle"));

  // Both missing → we cannot derive the pieces. The fallback in
  // generateOrderComponents would mint ONE "top" component named after the
  // product, which for a two-piece garment puts it into production with one
  // barcode instead of two — physically unscannable at a station. Flag it
  // rather than guessing. (~1-2% of the catalogue: standalone accessories
  // like "Light Silk Organza Dupatta" and "Blush Heirloom Potli".)
  if (!isPresent(top) && !isPresent(bottom)) {
    blockers.push({
      code: "PRODUCT_STYLE_MISSING",
      detail: `No top_style/bottom_style on "${clean(node?.title)}" (${clean(product?.id)})`,
    });
  }

  // Neither a Style option nor the name tells us about a dupatta. Guessing
  // either way is wrong: assume none and a real piece never gets a barcode;
  // assume one and a phantom component blocks packaging. Flag it instead.
  if (isDupattaUnknown(variant, product)) {
    blockers.push({
      code: "DUPATTA_UNKNOWN",
      detail: `No Style option and no custom.has_dupatta metafield on "${clean(node?.title)}" — confirm before production`,
    });
  }

  const size = resolveSize(variant);
  const color = opt(variant, "Color");
  const colorObj = toColorObject(color, hexByColorName);
  const qualifier = dupattaQualifier(variant);
  const includesDupatta = resolveDupatta(variant, product);

  // Per-unit price. discountedUnitPriceSet reflects line discounts; fall back
  // to the original when absent.
  const price = money(node?.discountedUnitPriceSet) || money(node?.originalUnitPriceSet);

  // Carry any non-internal line attributes into notes. GoKwik/Whatmore write
  // internal keys prefixed with "_" — skip those.
  const noteBits = (node?.customAttributes || [])
    .filter((a: any) => !clean(a?.key).startsWith("_"))
    .map((a: any) => `${clean(a.key)}: ${clean(a.value)}`);
  if (qualifier) noteBits.push(`Dupatta: ${qualifier}`);

  return {
    // Matches the canonical item shape built in src/screens/ProductForm.js:2587
    // so every downstream consumer (cards, PDFs, components) works unchanged.
    _id: crypto.randomUUID(),

    // No Supabase catalogue link is required for this flow — see field-map.md.
    // Only ~8 of 245 active Shopify products are linked today, and NO consumer
    // of order cards, PDFs or components reads product_id. Keep the Shopify
    // ids so a later backfill can link retroactively without re-ingesting.
    product_id: null,
    sku_id: null,
    shopify_product_id: clean(product?.id) || null,
    shopify_variant_id: clean(variant?.id) || null,
    shopify_sku: clean(node?.sku) || null,

    product_name: clean(node?.title),
    color: colorObj,

    // Production-critical four.
    top: isPresent(top) ? top : "",
    bottom: isPresent(bottom) ? bottom : "",
    includes_dupatta: includesDupatta,
    extras: [],

    // Shopify carries ONE colour per variant ("Blush Pink"), while the app
    // models a colour per component. The whole garment is that colour, so
    // apply it to every piece the order actually contains — a tailor reading
    // the work order needs the colour beside each piece, not only the top.
    // These MUST be { hex, name } objects: WarehouseOrderPdf.js:523 reads
    // `item.top_color.hex` and renders nothing for a bare string.
    top_color: isPresent(top) ? colorObj : null,
    bottom_color: isPresent(bottom) ? colorObj : null,
    dupatta_color: includesDupatta ? colorObj : null,

    additionals: [],
    size: size || null,

    // Which axis the size CAME FROM, so the UI can label it honestly. An Age
    // value reads "5-6 YEARS" and must not be shown as "Size:". Live order
    // vocabulary (198 line items): Size 174, Kurta Size 24, Age 7. Values
    // include "Custom" and "Free Size" — both REAL sizes, not missing data.
    size_label: resolveSizeLabel(variant) || null,

    // Heavy / Light, kept as its own field rather than only inside the `notes`
    // prose. The warehouse needs to know which dupatta weight to pull, and
    // parsing it back out of a joined string would be exactly the kind of
    // text-scraping this mapper avoids everywhere else. "" when plain.
    dupatta_weight: qualifier || null,

    quantity: Number(node?.quantity) || 1,
    price,

    // Web customers don't supply measurements — the website sells STANDARD
    // SIZES, not made-to-measure. This is a store-model fact, not a gap:
    // the Shopify metafield catalogue has no bust/waist/hip/length field at
    // all, and line items carry no measurement customAttributes.
    //
    // The size is the real production input, and it is carried in `size` /
    // `size_label` above. Warehouse-facing surfaces must therefore render a
    // SIZE section here and suppress the measurements section entirely rather
    // than printing an empty "Body Measurements" heading.
    measurements: {},
    image_url: clean(product?.featuredImage?.url) || null,
    notes: noteBits.join(" | "),
    isKids: !!opt(variant, "Age"),
    is_gifting: false,
    order_type: "Standard",
    payment_order_type: "Full Payment",
    delivery_date: deliveryDate,
    mode_of_delivery: "Courier",

    // Much of the app keys off items[0].sync_enabled — set it explicitly.
    // NOTE this makes the order LXRTS-TYPE, which is separate from its
    // SHOPIFY channel. Both are true. See barcodeService.js.
    sync_enabled: true,
  };
}

// ─── Delivery date ──────────────────────────────────────────

/**
 * Shopify has NO delivery-date field. Verified three ways: schema
 * introspection (Order's only dates are createdAt/processedAt/cancelledAt/
 * closedAt), metafields(first:50) → [] on every sampled order, and
 * fulfillmentOrders → [] (so fulfillBy is unavailable at ingestion, and would
 * be anyway since fulfilment hasn't started).
 *
 * The real signal is the per-product `custom.shipping_timeline` metafield —
 * 250/250 populated, 23 distinct values from 1 to 70 days.
 *
 * MAX across line items, not per-item: the order ships as one parcel, so the
 * slowest piece sets the date.
 */
function resolveDeliveryDate(
  createdAt: string,
  lineNodes: any[],
  blockers: Blocker[]
): { date: string | null; basis: string | null } {
  let maxDays = 0;
  let basisTitle = "";

  for (const node of lineNodes) {
    const product = node?.variant?.product || {};
    const raw = mf(product, "shipTimeline");
    const days = Number(raw);
    if (Number.isFinite(days) && days > 0 && days > maxDays) {
      maxDays = days;
      basisTitle = clean(node?.title);
    }
  }

  if (!maxDays) {
    // Never invent a date: it drives the T-2 production deadline, the delivery
    // calendar and delay escalations. A wrong date is worse than a flagged one.
    blockers.push({
      code: "DELIVERY_DATE_UNRESOLVED",
      detail: "No shipping_timeline metafield on any line item's product",
    });
    return { date: null, basis: null };
  }

  return {
    date: addDays(createdAt, maxDays),
    basis: `createdAt + ${maxDays}d (slowest item: ${basisTitle})`,
  };
}

// ─── Main ───────────────────────────────────────────────────

// ============================================================
// COMPONENTS — one row per physical garment piece (the scannable unit)
// ============================================================
// Mirrors generateOrderComponents() in src/utils/barcodeService.js:676-776.
// Kept in step with it deliberately: barcode format, the "NA" skip rule and
// the index suffixes must match, or a web order's pieces won't scan like every
// other channel's.
//
// Components are created INACTIVE (no is_active / current_stage set here) —
// exactly as the JS does. A Production Head activates them via the
// activate_components RPC, which is what moves them to 'cloth_issued' and
// starts the SLA clock. Web orders must not jump that queue.
export function buildOrderComponents(order: any) {
  const components: Record<string, unknown>[] = [];
  const orderNo: string = order?.order_no || "";
  // "SB-SHOPIFY-0726-000123" → "SHOPIFY". Read by dash position, so the code's
  // LENGTH is irrelevant — only that it contains no dash. Legacy orders still on
  // the old "SHOP" code work identically here.
  const storeCode = orderNo.split("-")[1] || "SB";
  const seqPart = orderNo.split("-").pop() || "000000";

  const items = Array.isArray(order?.items) ? order.items : [order?.items];

  items.forEach((item: any, itemIndex: number) => {
    const suffix = itemIndex > 0 ? String(itemIndex + 1) : "";

    // An item that names no piece at all still needs one row to track, so the
    // product_name fallback stays for that case — but only then. Minting a
    // phantom piece would block packaging, which requires every ACTIVE
    // component to clear Final QC.
    const namesNoPiece =
      !isPresent(clean(item?.top)) &&
      !isPresent(clean(item?.bottom)) &&
      !item?.includes_dupatta;

    if (isPresent(clean(item?.top)) || (namesNoPiece && item?.product_name)) {
      components.push({
        order_id: order.id,
        order_no: orderNo,
        barcode: `${storeCode}-${seqPart}-TOP${suffix}`,
        component_type: "top",
        component_label: isPresent(clean(item?.top)) ? item.top : (item?.product_name || "Top"),
        item_index: itemIndex,
        extra_index: null,
      });
    }

    if (isPresent(clean(item?.bottom))) {
      components.push({
        order_id: order.id,
        order_no: orderNo,
        barcode: `${storeCode}-${seqPart}-BTM${suffix}`,
        component_type: "bottom",
        component_label: item.bottom || "Bottom",
        item_index: itemIndex,
        extra_index: null,
      });
    }

    if (item?.includes_dupatta) {
      components.push({
        order_id: order.id,
        order_no: orderNo,
        barcode: `${storeCode}-${seqPart}-DUP${suffix}`,
        component_type: "dupatta",
        component_label: "Dupatta",
        item_index: itemIndex,
        extra_index: null,
      });
    }

    if (Array.isArray(item?.extras)) {
      item.extras.forEach((extra: any, extraIndex: number) => {
        components.push({
          order_id: order.id,
          order_no: orderNo,
          barcode: `${storeCode}-${seqPart}-EX${extraIndex + 1}${itemIndex > 0 ? "-" + (itemIndex + 1) : ""}`,
          component_type: "extra",
          component_label: extra?.name || `Extra ${extraIndex + 1}`,
          item_index: itemIndex,
          extra_index: extraIndex,
        });
      });
    }
  });

  return components;
}

/**
 * The app stores garment colours as **objects**, not strings:
 *   { hex: "#F7DCCD", name: "Carnation Pink" }
 * Every consumer reads `item.top_color.hex` to draw the swatch —
 * WarehouseOrderPdf.js:523 and the dashboard cards both do. A bare string has
 * no `.hex`, so the swatch silently disappears. This shape is required.
 *
 * `hexByColorName` is the app's `colors` table (name → hex), passed in by
 * index.ts so this module stays pure. Shopify's names are close but not exact
 * ("Rosepink" vs "Rose Pink"), so match on a normalised key.
 *
 * When a colour isn't in the table we still return the NAME with an empty hex:
 * the name is real information from Shopify and belongs on the work order; only
 * the swatch is unavailable. Never invent a hex.
 */
export const normalizeColorKey = (s: unknown): string =>
  String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");

export function toColorObject(
  name: string,
  hexByColorName?: Map<string, string>
): { hex: string; name: string } | null {
  const clean_ = clean(name);
  if (!clean_) return null;
  const hex = hexByColorName?.get(normalizeColorKey(clean_)) || "";
  return { hex, name: clean_ };
}

export function mapShopifyOrder(node: any, hexByColorName?: Map<string, string>) {
  const blockers: Blocker[] = [];

  const lineNodes = (node?.lineItems?.edges || []).map((e: any) => e.node);
  if (lineNodes.length === 0) {
    blockers.push({ code: "NO_LINE_ITEMS", detail: "Order has no line items" });
  }

  const createdAt: string = clean(node?.createdAt) || new Date().toISOString();
  const { date: deliveryDate, basis } = resolveDeliveryDate(createdAt, lineNodes, blockers);

  const items = lineNodes.map((n: any) =>
    mapLineItem(n, deliveryDate, blockers, hexByColorName));

  // ── Payment. Half of real orders are COD, so this is not an edge case.
  // COD lands as PENDING with gateway "cash_on_delivery". Existing COD orders
  // in this business run through production with a balance outstanding and are
  // collected on delivery — there is no approval gate, and none is added here.
  const financial = clean(node?.displayFinancialStatus).toUpperCase();
  const gateways: string[] = (node?.paymentGatewayNames || []).map(clean).filter(Boolean);
  const isCod =
    gateways.some((g) => /cash_on_delivery|cod/i.test(g)) || financial === "PENDING";

  const grandTotal = money(node?.totalPriceSet);
  const advance = isCod ? 0 : grandTotal;

  // ── Addresses. shippingAddress is the delivery truth; the customer record
  // and billing name can be a DIFFERENT PERSON (seen in real data), and names
  // carry junk ("Dil Sahni Sahni", "Shivani ." with a null surname).
  const ship = node?.shippingAddress || {};
  const bill = node?.billingAddress || {};
  const street = [clean(ship?.address1), clean(ship?.address2)].filter(Boolean).join(", ");

  // Phone: order-level `phone` is E.164 and most reliable; shippingAddress.phone
  // is bare 10-digit; customer.phone was null on most sampled orders.
  const phone = toE164(node?.phone || ship?.phone || node?.customer?.phone);
  const email = clean(node?.email || node?.customer?.email).toLowerCase();

  if (!phone && !email) {
    blockers.push({
      code: "CUSTOMER_UNRESOLVED",
      detail: "Order has neither a phone nor an email — cannot resolve a profile",
    });
  }

  const issues: Blocker[] = [...blockers];
  if (basis) issues.push({ code: "DELIVERY_DATE_DERIVED", detail: basis });

  const orderRow: Record<string, unknown> = {
    shopify_order_id: clean(node?.id),
    // Shopify's own human-facing number, e.g. "#26925". Warehouse staff and the
    // catalogue team refer to orders by THIS, not our SB- number, so it shows on
    // the order card and the warehouse work order. Display only — idempotency is
    // on shopify_order_id (the GID), which is what is actually unique.
    shopify_order_name: clean(node?.name) || null,
    created_at: createdAt,
    status: "order_received",

    items,
    total_quantity: items.reduce((s: number, i: any) => s + (i.quantity || 0), 0),
    delivery_date: deliveryDate,

    // Customer / delivery
    delivery_name: clean(ship?.name) || clean(node?.customer?.firstName),
    delivery_email: email || null,
    delivery_phone: phone || null,
    delivery_address: street || null,
    delivery_city: clean(ship?.city) || null,
    delivery_state: clean(ship?.province) || null, // Shopify calls it province
    delivery_pincode: clean(ship?.zip) || null,
    delivery_country: clean(ship?.country) || null,
    mode_of_delivery: "Courier",

    // Billing.
    // NOTE: `orders` has billing_address / billing_country / billing_same /
    // billing_company / billing_gstin — but NO billing_city / billing_state /
    // billing_pincode columns. (CustomerOrderPdf.js:441-446 reads those three;
    // they are undefined for every order in the table, not just web orders —
    // a pre-existing dead path, not something introduced here.) So flatten the
    // whole billing address into the one column that exists, which is what the
    // PDF joins anyway.
    billing_same: node?.billingAddressMatchesShippingAddress !== false,
    billing_address:
      [
        clean(bill?.address1),
        clean(bill?.address2),
        clean(bill?.city),
        clean(bill?.province),
        clean(bill?.zip),
      ]
        .filter(Boolean)
        .join(", ") || null,
    billing_country: clean(bill?.country) || null,

    // Money. GST is INCLUSIVE (totalTaxSet is 0 on every sampled order) — the
    // customer PDF reverse-calculates, so never add tax on top here.
    subtotal: money(node?.subtotalPriceSet),
    taxes: money(node?.totalTaxSet),
    discount_amount: money(node?.totalDiscountsSet),
    // On COD orders this ₹250 is a COD HANDLING FEE, not postage — the
    // shippingLine reads "Free Shipping and COD Charges". Shipping is free
    // either way.
    shipping_charge: money(node?.totalShippingPriceSet),
    grand_total: grandTotal,
    grand_total_after_discount: grandTotal,
    net_total: grandTotal,
    advance_payment: advance,
    remaining_payment: grandTotal - advance,
    payment_mode: isCod ? "COD" : gateways[0] || "Online",
    is_split_payment: false,

    // Placer + channel marker. salesperson_store must match the
    // generate_order_no key so the SHOPIFY prefix is minted. (The KEY is the
    // string 'Shopify' and did NOT change in the rename — only the store code
    // the function emits did.)
    salesperson: SALESPERSON_LABEL,
    salesperson_store: SHOPIFY_STORE_KEY,

    comments: clean(node?.note) || null,

    // Set every channel flag explicitly rather than omitting: several
    // dashboards branch on `=== true` but reports read them positively.
    is_b2b: false,
    is_comms: false,
    is_stock_order: false,
    is_private_order: false,
    is_gifting: false,
    is_alteration: false,

    web_order_status: blockers.length > 0 ? "needs_review" : "ready",
    web_order_issues: issues.length > 0 ? issues : null,

    // ── Shopify's own payment state, stored VERBATIM for the warehouse to see.
    //
    // Both were already fetched (ORDER_FIELDS asks for displayFinancialStatus
    // and tags) and already sat in shopify_raw; they were simply never mapped.
    //
    // Deliberately NOT folded into isCod / payment_mode above. That derivation
    // treats any PENDING order as COD, which over-matches; these two carry what
    // Shopify actually said, with nothing inferred. See 64_shopify_payment_fields.sql.
    shopify_financial_status: clean(node?.displayFinancialStatus) || null,

    // Array, not a boolean: "COD" and "COD Confirmed" are distinct operational
    // states, and keeping the raw list means a new tag needs no code change.
    shopify_tags: Array.isArray(node?.tags)
      ? node.tags.map(clean).filter(Boolean)
      : [],
  };

  return { orderRow, items, blockers, deliveryDate, isCod };
}
