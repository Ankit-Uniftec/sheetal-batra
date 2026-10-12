import { fetchAllRows } from "./fetchAllRows";
import { isAllLxrtsOrder } from "./lxrtsProduct.mjs";

// For screens that list orders WITHOUT loading their items (the scan-station
// All Orders list keeps its query light on purpose): the ids of orders whose
// every product is LXRTS, so they can be kept off a production screen
// (meeting point 44). One query, only for orders that mention LXRTS at all,
// returning just product names and charge flags — not the full items.
//
// Up to MAX lines per order are read. An order with more lines than that is
// never treated as all-LXRTS (it stays visible) — the safe direction, since
// hiding a real job is worse than showing a ready-stock one.
const MAX = 8;
const idx = [...Array(MAX).keys()];
const SELECT = ["id", `extra:items->${MAX}->>product_name`]
  .concat(idx.flatMap((i) => [`n${i}:items->${i}->>product_name`, `c${i}:items->${i}->>is_charge`]))
  .join(",");
const ANY_LXRTS = idx.map((i) => `items->${i}->>product_name.ilike.*lxrts*`).join(",");

export async function fetchAllLxrtsOrderIds() {
  const { data, error } = await fetchAllRows("orders", (q) => q.select(SELECT).or(ANY_LXRTS));
  if (error) throw error;
  const ids = new Set();
  for (const r of data || []) {
    if (r.extra != null) continue; // more lines than we read — keep it visible
    const items = idx
      .filter((i) => r[`n${i}`] != null)
      .map((i) => ({ product_name: r[`n${i}`], is_charge: r[`c${i}`] === "true" }));
    if (isAllLxrtsOrder({ items })) ids.add(r.id);
  }
  return ids;
}
