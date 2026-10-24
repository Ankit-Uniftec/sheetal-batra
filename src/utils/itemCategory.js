// ============================================================
// Item category (Women / Men / Kids) — single source of truth.
//
// An order item records its category in two ways: `category`
// ("Women" / "Kids", newer items) and `isKids` (true / false, all
// items; the only field on older and Shopify items). Read it ONLY
// through getItemCategory() so every screen and PDF agrees, and so
// a new category shows correctly everywhere at once.
//
// "Men" is recognised here already, but is NOT yet selectable on the
// order forms (ORDER_CATEGORIES) — that comes with the men's sizes,
// size chart and measurements (Release 21, phase 2).
// ============================================================
import { B2B_SIZE_OPTIONS } from "./b2bSizeChart";

export const CATEGORY_WOMEN = "Women";
export const CATEGORY_MEN = "Men";
export const CATEGORY_KIDS = "Kids";

// Every category an item can carry.
export const ALL_CATEGORIES = [CATEGORY_WOMEN, CATEGORY_MEN, CATEGORY_KIDS];

// The categories staff can choose when placing an order today.
export const ORDER_CATEGORIES = [CATEGORY_WOMEN, CATEGORY_KIDS];

// Adult (women's) letter sizes — the same list as the B2B / house size chart.
export const WOMEN_SIZE_OPTIONS = B2B_SIZE_OPTIONS;

// Kids sizes are ages.
export const KIDS_SIZE_OPTIONS = [
  "1-2 yrs", "2-3 yrs", "3-4 yrs", "4-5 yrs", "5-6 yrs", "6-7 yrs", "7-8 yrs", "8-9 yrs",
  "9-10 yrs", "10-11 yrs", "11-12 yrs", "12-13 yrs", "13-14 yrs", "14-15 yrs", "15-16 yrs",
];

/**
 * The category of an order item: "Women", "Men" or "Kids".
 * Uses `category` when it is a known one (any letter case), otherwise
 * falls back to `isKids`. Anything missing or unknown → "Women", so a
 * bad value can never break a screen or block an order.
 */
export function getItemCategory(item) {
  const raw = String(item?.category ?? "").trim().toLowerCase();
  const known = ALL_CATEGORIES.find((c) => c.toLowerCase() === raw);
  if (known) return known;
  return item?.isKids ? CATEGORY_KIDS : CATEGORY_WOMEN;
}

export const isKidsItem = (item) => getItemCategory(item) === CATEGORY_KIDS;

/** The standard size list for a category (Women's list until men's sizes exist). */
export function sizeOptionsFor(category) {
  return category === CATEGORY_KIDS ? KIDS_SIZE_OPTIONS : WOMEN_SIZE_OPTIONS;
}
