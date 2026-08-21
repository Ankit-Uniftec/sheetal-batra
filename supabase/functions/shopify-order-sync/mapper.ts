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
 *   2. The product's TAGS — "WITH DUPATTA", which the catalogue team sets on
 *      the products that include one. Below the Style option, which is the
 *      customer's own checkout choice and outranks anything on the product.
 *   3. Neither → NO dupatta. Per the catalogue team's rule, they tag the
 *      products that have one, so an untagged product does not. Absence is an
 *      answer, not a gap.
 *
 * `custom.has_dupatta` is deliberately NOT a source: the rule is tag and
 * variant only.
 *
 * ⚠ Accepted trade-off: an untagged product that DOES include a dupatta ships
 * without one, silently — no barcode, no flag, the error surfaces at the
 * customer. The catalogue team owns tagging and has accepted this.
 *
 * NOTHING is inferred from the product NAME. A name is marketing copy: it is
 * re-worded for SEO, carries live misspellings ("Dupataa") and synonyms
 * ("Odhni"), and any such drift would silently drop a barcode with no error.
 * Production data must come from a field, never from prose.
 */
/**
 * Dupatta inclusion from the product's TAGS, or null when the tags say nothing.
 *
 * The catalogue team tags products "WITH DUPATTA" / "WITHOUT DUPATTA" (seen in
 * Shopify admin on Set products, which have only Color and Size options and so
 * carry no Style choice to read). This is the same kind of signal as the
 * "COD" / "COD Confirmed" order tags: a curated field, not prose.
 *
 * Tri-state on purpose — true / false / null. A product with no dupatta tag at
 * all must fall through to the next source, NOT default to false: silently
 * answering "no dupatta" would drop a real piece from production with no error.
 *
 * Case-insensitive and whitespace-tolerant (live tags are "WITH DUPATTA" but a
 * hand-typed "With dupatta " must work too), and tolerant of the "Dupataa"
 * misspelling already documented in the Style values.
 *
 * WITHOUT is checked FIRST, for the reason spelled out in resolveDupatta:
 * "without".startsWith("with") is true, so a naive with-check marks every
 * Without-Dupatta product as having one and mints a phantom DUP barcode that
 * blocks packaging.
 *
 * Only tags that are ABOUT a dupatta are considered. A marketing tag that
 * merely contains the word (e.g. "Dupatta Sale") is ignored rather than being
 * read as an inclusion claim — the same anchoring discipline as COD_TAG_RE on
 * the dashboard.
 */
const DUPATTA_TAG_RE = /^(with|without)\s+dupat[a-z]*$/i;

export function dupattaFromTags(product: any): boolean | null {
  const tags: string[] = Array.isArray(product?.tags) ? product.tags : [];
  let sawWith = false;
  let sawWithout = false;

  for (const raw of tags) {
    const t = clean(raw).replace(/\s+/g, " ");
    const m = t.match(DUPATTA_TAG_RE);
    if (!m) continue;
    if (/without/i.test(m[1])) sawWithout = true;
    else sawWith = true;
  }

  // Contradictory tagging on one product. Return null so the line quarantines
  // for a human instead of us picking a side — exactly the DUPATTA_UNKNOWN
  // path, which is what "we do not know" already means here.
  if (sawWith && sawWithout) return null;
  if (sawWith) return true;
  if (sawWithout) return false;
  return null;
}

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

  // 2. Product TAGS ("WITH DUPATTA" / "WITHOUT DUPATTA").
  const tagged = dupattaFromTags(product);
  if (tagged !== null) return tagged;

  // 3. Neither said anything → NO dupatta.
  //
  // The catalogue team's rule: they tag WITH DUPATTA on the products that have
  // one, so an untagged product is a product without one. Absence of a tag is
  // an answer here, not a gap — which is why nothing quarantines any more.
  //
  // The `custom.has_dupatta` metafield is deliberately NOT consulted: the rule
  // is tag-and-variant only. It stays in ORDER_FIELDS (harmless, and it costs a
  // query change to bring back) but no longer influences production.
  return false;
};

/**
 * True when nothing tells us whether this line includes a dupatta.
 *
 * DELIBERATELY NARROW, per the catalogue team's stated rule: the only signals
 * are the variant's Style option and the product's WITH/WITHOUT DUPATTA tag.
 * A product carrying NEITHER is taken to have NO dupatta — absence of the tag
 * IS the answer, not a missing one.
 *
 * So this now returns true only when a line has no product node at all (a
 * manual/custom line item typed into Shopify, where there is nothing to read a
 * tag from). Everything with a real product resolves.
 *
 * ⚠ The trade-off this accepts, recorded because it is invisible at runtime:
 * an untagged product that DOES include a dupatta ships without one. The
 * dupatta gets no barcode, is never made, and nothing flags it — the error
 * surfaces at the customer, not on the floor. The catalogue team owns tagging
 * WITH DUPATTA and has accepted that consequence; this code no longer
 * second-guesses an untagged product.
 *
 * MUST stay in lockstep with resolveDupatta: if this says "known" the resolver
 * has to actually decide, or a line would mint no dupatta while claiming the
 * answer was known.
 */
export function isDupattaUnknown(variant: any, product: any): boolean {
  // No product at all — a manual line item. Nothing to tag, nothing to read.
  return !product;
}

/**
 * Is this product an ACCESSORY sold on its own — a dupatta, odhni, scarf —
 * rather than an outfit?
 *
 * Recognised from Shopify's own CATEGORY tags ("Odhanis/Dupattas",
 * "CATEGORIES_Accessories"), which the catalogue already carries. Same
 * discipline as the dupatta tag: a curated field, never the product name.
 *
 * Note these are a DIFFERENT KIND of tag from WITH DUPATTA. That one is a
 * claim about an outfit ("this kurta set comes with a dupatta"); this one is a
 * claim about what the product IS ("this product is a dupatta"). They must not
 * be conflated — which is why dupattaFromTags deliberately ignores these.
 *
 * Deliberately tag-driven and NOT "has no top_style and no bottom_style".
 * A missing metafield means nobody filled it in; treating that as "accessory"
 * would silently mint ONE barcode for a real two-piece outfit whose metafields
 * were never populated. An untagged accessory keeps flagging, which is the
 * safe direction: a human sees it rather than the floor cutting the wrong thing.
 *
 * Anchored on the whole tag, so a marketing tag that merely mentions accessories
 * cannot promote an outfit into this path.
 */
const ACCESSORY_TAG_RE = /^(odhanis\/dupattas|categories_accessories|accessories)$/i;

export function isAccessoryProduct(product: any): boolean {
  const tags: string[] = Array.isArray(product?.tags) ? product.tags : [];
  return tags.some((t) => ACCESSORY_TAG_RE.test(clean(t).replace(/\s+/g, " ")));
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

  // An ACCESSORY sold on its own (dupatta / odhni / scarf) legitimately has no
  // top_style and no bottom_style — it is one piece, not an outfit. Recognised
  // from Shopify's category tag, so this is a positive signal, not an inference
  // from the metafields being empty.
  const isAccessory = isAccessoryProduct(product);

  // Both missing → we cannot derive the pieces. The fallback in
  // generateOrderComponents would mint ONE "top" component named after the
  // product, which for a two-piece garment puts it into production with one
  // barcode instead of two — physically unscannable at a station. Flag it
  // rather than guessing. (~1-2% of the catalogue.)
  //
  // Accessories are exempt: for them "no styles" is the correct shape, and they
  // mint a single dupatta component below instead.
  if (!isAccessory && !isPresent(top) && !isPresent(bottom)) {
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
      detail: `Line item "${clean(node?.title)}" has no Shopify product (manual/custom line) — no Style option or tag to read a dupatta from; confirm before production`,
    });
  }

  const size = resolveSize(variant);
  const color = opt(variant, "Color");
  const colorObj = toColorObject(color, hexByColorName);
  const qualifier = dupattaQualifier(variant);
  // An accessory IS a dupatta/odhni rather than an outfit that includes one, so
  // it carries the piece by definition — that single DUP component is the whole
  // order. For everything else the tag/Style resolution decides.
  const includesDupatta = isAccessory || resolveDupatta(variant, product);

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
 * The date is DERIVED: order date + N days, where N comes from the ORDER TOTAL
 * alone (see DELIVERY_BANDS). Product category is NOT part of the rule — the
 * client instructed that the amount is the only input. An earlier version used
 * a PRODUCT CATEGORY × PRICE BAND matrix from category_shopify.xlsx; that axis
 * is gone, and Shopify's `product.category.fullName` no longer affects any date.
 *
 * Both versions deliberately REPLACED the per-product `custom.shipping_timeline`
 * metafield, which disagreed substantially with the client's stated rule. The
 * metafield is not read anywhere.
 */

/**
 * Delivery bands: ORDER TOTAL -> days. `max` is INCLUSIVE.
 *
 * WHAT CHANGED (client instruction)
 * Delivery days used to be looked up by PRODUCT CATEGORY x price band, from
 * category_shopify.xlsx. The client has since said the date must depend on the
 * AMOUNT ONLY. Category is no longer read, so the Shopify taxonomy no longer
 * affects any delivery date.
 *
 * The days below are the row every clothing category already carried
 * (10/14/18/22), so garment orders are unaffected. Accessories, which used to
 * carry their own faster/slower rows (clutch & belt 5/10/18/18, scarves
 * 10/12/15/19), now follow the same schedule as everything else — that is the
 * intended consequence of dropping category, not an oversight.
 *
 * This also removes the single largest source of blocked orders: an untagged
 * or wrongly-tagged product used to yield DELIVERY_DATE_UNRESOLVED and hold
 * the whole order. An amount always exists, so a date can always be computed.
 *
 * Bands are on the ORDER TOTAL, once — not per line item. Measured on 122 UAT
 * orders when this was per-unit, every band overshot its ceiling, because a
 * multi-piece order priced each piece separately and landed them all in a
 * cheaper column.
 */
const DELIVERY_BANDS = [
  { key: "10-25k", max: 25_000, days: 10 },
  { key: "25-40k", max: 40_000, days: 14 },
  { key: "40-75k", max: 75_000, days: 18 },
  { key: "75k+",   max: Infinity, days: 22 },
] as const;

/** Runtime copy, so the DB table can revise the numbers without a redeploy. */
let DELIVERY_DAYS: number[] = DELIVERY_BANDS.map((b) => b.days);

/**
 * Override the day counts from the DB (shopify_delivery_matrix, single row).
 * Ignores anything malformed and keeps the built-in numbers, so a bad row can
 * never silently move every delivery date.
 */
export function setDeliveryDays(days: unknown): void {
  if (!Array.isArray(days) || days.length !== DELIVERY_BANDS.length) return;
  const next = days.map(Number);
  if (next.some((n) => !Number.isFinite(n) || n < 0)) return;
  DELIVERY_DAYS = next;
}

/** The band index for an amount. Below the first band uses the first column. */
function priceBandIndex(amount: number): number {
  for (let i = 0; i < DELIVERY_BANDS.length; i++) {
    if (amount <= DELIVERY_BANDS[i].max) return i;
  }
  return DELIVERY_BANDS.length - 1;
}

/**
 * Delivery date = order date + N days, where N comes from the order total
 * alone. Category and line items are not consulted.
 */
function resolveDeliveryDate(
  createdAt: string,
  orderTotal: number,
  blockers: Blocker[],
): { date: string | null; basis: string | null } {
  // A non-finite or negative total is the one case that still cannot yield an
  // honest date. Never invent one: it drives the T-2 production deadline, the
  // delivery calendar and delay escalations, so a wrong date is worse than a
  // flagged order.
  //
  // A total of exactly 0 is ALLOWED and takes the first band (10 days). Zero is
  // a real, correct amount here — gifted, fully-discounted and replacement
  // orders come through at 0 — and the cheapest band is the right floor for
  // them. One such order exists in UAT today (SB-SHOPIFY-0826-000175), blocked
  // under the old category rule and now dated.
  if (!Number.isFinite(orderTotal) || orderTotal < 0) {
    blockers.push({
      code: "DELIVERY_DATE_UNRESOLVED",
      detail: `Order total is not a usable amount (${orderTotal}), so no delivery date can be derived.`,
    });
    return { date: null, basis: null };
  }

  const bandIdx = priceBandIndex(orderTotal);
  const days = DELIVERY_DAYS[bandIdx];
  return {
    date: addDays(createdAt, days),
    basis: `createdAt + ${days}d (order total ${orderTotal} @ ${DELIVERY_BANDS[bandIdx].key})`,
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

    // No top and no bottom. Two shapes land here:
    //   • dupatta-only  — an accessory order (Odhanis/Dupattas). The DUP piece
    //     below IS the order, so no TOP fallback is wanted.
    //   • names NOTHING — neither piece nor dupatta. That still needs one row
    //     to track, so the product_name TOP fallback covers it.
    // Minting a phantom piece would block packaging, which requires every
    // ACTIVE component to clear Final QC — hence the split.
    const noTopOrBottom =
      !isPresent(clean(item?.top)) && !isPresent(clean(item?.bottom));
    const dupattaOnly = noTopOrBottom && !!item?.includes_dupatta;
    const namesNoPiece = noTopOrBottom && !item?.includes_dupatta;

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
        // On an accessory-only order this DUP piece IS the whole order, so the
        // label carries the product name — a worker holding the tag needs to
        // know WHICH dupatta. When it accompanies an outfit, the generic label
        // is right: the top/bottom components already name the garment.
        component_label: dupattaOnly
          ? (item?.product_name || "Dupatta")
          : "Dupatta",
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

/**
 * A human-set garment breakdown for a line item that has no Shopify product.
 *
 * Shape (one entry per line, by index):
 *   { item_index: 0, top: "", bottom: "", includes_dupatta: true }
 *
 * See 83_manual_line_breakdown.sql for why this exists and why it lives in its
 * own column rather than in items[].
 */
export type LineBreakdown = {
  item_index: number;
  top?: string;
  bottom?: string;
  includes_dupatta?: boolean;
};

/** An override only counts if it actually names a piece to make. */
const breakdownNamesAPiece = (b: LineBreakdown): boolean =>
  isPresent(clean(b?.top)) || isPresent(clean(b?.bottom)) || b?.includes_dupatta === true;

/**
 * Apply human-set breakdowns over mapped items, and drop the blockers those
 * answers resolve.
 *
 * Runs AFTER the mapper so it is re-applied on every `remap-items` replay: the
 * mapper always re-derives the same "nothing to read" result from shopify_raw,
 * and this puts the human's answer back on top. That ordering is the whole
 * reason the override survives a remap.
 *
 * Only PRODUCT_STYLE_MISSING and DUPATTA_UNKNOWN are cleared, and only for the
 * lines actually covered. Both are questions about what pieces exist, which is
 * exactly what the override answers. Every other blocker is a different
 * question and is left alone.
 */
export function applyBreakdownOverride(
  mapped: { items: any[]; blockers: Blocker[] },
  overrides: LineBreakdown[] | null | undefined,
): { items: any[]; blockers: Blocker[] } {
  if (!Array.isArray(overrides) || overrides.length === 0) return mapped;

  const byIndex = new Map<number, LineBreakdown>();
  for (const b of overrides) {
    // Ignore a malformed or empty entry rather than letting it mint nothing:
    // a covered line whose answer names no piece would clear the blocker and
    // then produce zero barcodes, which is worse than staying flagged.
    if (!b || !Number.isInteger(b.item_index) || !breakdownNamesAPiece(b)) continue;
    byIndex.set(b.item_index, b);
  }
  if (byIndex.size === 0) return mapped;

  const items = mapped.items.map((item, i) => {
    const b = byIndex.get(i);
    if (!b) return item;
    return {
      ...item,
      top: isPresent(clean(b.top)) ? clean(b.top) : "",
      bottom: isPresent(clean(b.bottom)) ? clean(b.bottom) : "",
      includes_dupatta: b.includes_dupatta === true,
      // Marks the line as human-resolved so surfaces can say so rather than
      // presenting a typed-in breakdown as if Shopify supplied it.
      breakdown_source: "manual",
    };
  });

  // A blocker names the offending line by TITLE, not index, so match on the
  // title of the covered items. Titles come from the same mapped items the
  // blockers were raised against, so this cannot drift.
  const covered = new Set(
    [...byIndex.keys()]
      .map((i) => clean(mapped.items[i]?.product_name))
      .filter(Boolean),
  );
  const RESOLVED_BY_OVERRIDE = ["PRODUCT_STYLE_MISSING", "DUPATTA_UNKNOWN"];
  const blockers = mapped.blockers.filter((bl) => {
    if (!RESOLVED_BY_OVERRIDE.includes(bl.code)) return true;
    // Keep a blocker whose line was NOT covered — a multi-line draft order can
    // have one line answered and another still open.
    return ![...covered].some((title) => bl.detail?.includes(`"${title}"`));
  });

  return { items, blockers };
}

export function mapShopifyOrder(
  node: any,
  hexByColorName?: Map<string, string>,
  // Human-set breakdowns for lines with no Shopify product. Passed in by the
  // caller from orders.manual_line_breakdown, and applied AFTER mapping so it
  // is restored on every remap-items replay rather than being overwritten.
  lineBreakdown?: LineBreakdown[] | null,
) {
  const blockers: Blocker[] = [];

  const lineNodes = (node?.lineItems?.edges || []).map((e: any) => e.node);
  if (lineNodes.length === 0) {
    blockers.push({ code: "NO_LINE_ITEMS", detail: "Order has no line items" });
  }

  const createdAt: string = clean(node?.createdAt) || new Date().toISOString();
  const { date: deliveryDate, basis } = resolveDeliveryDate(
    createdAt,
    money(node?.totalPriceSet),
    blockers,
  );

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

  // Human answers go on LAST, over everything the mapper derived, and clear the
  // "what pieces exist" blockers for the lines they cover. See
  // applyBreakdownOverride and 83_manual_line_breakdown.sql.
  const resolved = applyBreakdownOverride(
    { items, blockers },
    lineBreakdown,
  );
  const finalItems = resolved.items;

  const issues: Blocker[] = [...resolved.blockers];
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

    items: finalItems,
    total_quantity: finalItems.reduce((s: number, i: any) => s + (i.quantity || 0), 0),
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

    web_order_status: resolved.blockers.length > 0 ? "needs_review" : "ready",
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

  // `blockers` here is the RESOLVED set: callers decide needs_review from it,
  // so returning the pre-override list would re-flag a line a human answered.
  return {
    orderRow,
    items: finalItems,
    blockers: resolved.blockers,
    deliveryDate,
    isCod,
  };
}
