import { useMemo } from "react";
import {
  buildVariantIndex, stockFor, stockStatus, sizesOut, sortSizes, salesSummary,
  integrityFindings, integrityCount, isOpenStockOrder, productType, sizeLabel,
  buildPlacementIndex, placementFor, saleCandidates, assignedOrderLines, groupTransfers, receiptsByOrder,
  TYPE_LXRTS, TYPE_CUSTOM, TYPE_MTO,
} from "./stockRoomModel";

// ============================================================
// One memoised view over the loaded rows, shared by every screen so the
// Overview, Stock and Products screens can never disagree about a number.
// ============================================================

export default function useStockRoomView(data, salesDays, ledger) {
  const base = useMemo(() => {
    if (!data) return null;
    const variantIndex = buildVariantIndex(data.variants);
    const sales90 = salesSummary(data.recentOrders, { days: 90 });
    const productsById = {};

    const rows = data.products.map((product) => {
      productsById[product.id] = product;
      const stock = stockFor(product, variantIndex);
      const price = Number(product.base_price) || 0;
      return {
        id: product.id,
        product,
        type: stock.type,
        stock,
        status: stockStatus(stock),
        sizesOut: sizesOut(stock),
        sold90: sales90.byProduct[product.id]?.units || 0,
        price,
        value: stock.tracked && !stock.unlimited ? stock.total * price : 0,
      };
    }).sort((a, b) => String(a.product.name).localeCompare(String(b.product.name)));

    const rowsById = {};
    rows.forEach((r) => { rowsById[r.id] = r; });
    const tracked = rows.filter((r) => r.stock.tracked);
    const counted = tracked.filter((r) => !r.stock.unlimited);

    const lxrtsSizes = sortSizes(
      rows.filter((r) => r.type === TYPE_LXRTS).flatMap((r) => r.stock.sizes)
    );

    // Keyed by display label, so XXL/2XL, CUSTOM/Custom and anything above 6XL
    // each chart as one size.
    const heldBySize = {};
    rows.forEach((r) => {
      if (!r.stock.bySize) return;
      Object.entries(r.stock.bySize).forEach(([s, q]) => { const l = sizeLabel(s); heldBySize[l] = (heldBySize[l] || 0) + q; });
    });

    const variantsByProduct = {};
    (data.variants || []).forEach((v) => { (variantsByProduct[v.product_id] || (variantsByProduct[v.product_id] = [])).push(v); });

    const findings = integrityFindings(data.products, variantIndex, data.variants);

    // Old Warehouses-tab records: product + warehouse + quantity, no size.
    const legacyByWarehouse = {};
    const legacyByProduct = {};
    (data.warehouseStock || []).forEach((ws) => {
      const qty = Number(ws.quantity) || 0;
      if (!ws.warehouse_id || !ws.product_id || qty === 0) return;
      (legacyByWarehouse[ws.warehouse_id] || (legacyByWarehouse[ws.warehouse_id] = [])).push(ws);
      (legacyByProduct[ws.product_id] || (legacyByProduct[ws.product_id] = [])).push(ws);
    });

    const count = (type) => rows.filter((r) => r.type === type).length;

    return {
      rows,
      rowsById,
      tracked,
      productsById,
      variantIndex,
      variantsByProduct,
      lxrtsSizes,
      heldBySize,
      findings,
      integrityTotal: integrityCount(findings),
      legacyByWarehouse,
      legacyByProduct,
      totals: {
        designs: rows.length,
        lxrts: count(TYPE_LXRTS),
        custom: count(TYPE_CUSTOM),
        mto: count(TYPE_MTO),
        trackedUnits: counted.reduce((a, r) => a + r.stock.total, 0),
        lxrtsUnits: counted.filter((r) => r.type === TYPE_LXRTS).reduce((a, r) => a + r.stock.total, 0),
        customUnits: counted.filter((r) => r.type === TYPE_CUSTOM).reduce((a, r) => a + r.stock.total, 0),
        value: counted.reduce((a, r) => a + r.value, 0),
        out: counted.filter((r) => r.status === "out").length,
        low: counted.filter((r) => r.status === "low").length,
      },
      openStockOrders: data.stockOrders.filter(isOpenStockOrder),
    };
  }, [data]);

  const sales = useMemo(() => {
    if (!data || !base) return null;
    const summary = salesSummary(data.recentOrders, { days: salesDays });
    // Only designs the Stock Room tracks; Made to order sales are not stock.
    const trackedIds = new Set(base.tracked.map((r) => r.id));
    let trackedUnits = 0;
    const trackedBySize = {};
    Object.entries(summary.byProduct).forEach(([pid, p]) => {
      if (!trackedIds.has(pid)) return;
      trackedUnits += p.units;
      if (productType(base.productsById[pid]) !== TYPE_LXRTS) return;
      Object.entries(p.bySize).forEach(([s, q]) => { const l = sizeLabel(s); trackedBySize[l] = (trackedBySize[l] || 0) + q; });
    });
    return { ...summary, trackedUnits, trackedBySize };
  }, [data, base, salesDays]);

  // Where units are, from the Stock Room's own tables. `installed: false` when
  // the SQL has not been run on this database: every screen then shows totals
  // only, exactly as before location tracking existed.
  const ledgerView = useMemo(() => {
    if (!base) return null;
    if (!ledger || !ledger.installed) return { installed: false, ready: !!ledger };

    const index = buildPlacementIndex(ledger.placed);
    const locationsById = {};
    ledger.locations.forEach((l) => { locationsById[l.id] = l; });
    // The "In transit" row holds units between a send and a receive. It is not
    // a place anyone picks, so every list of locations leaves it out.
    const transit = ledger.locations.find((l) => l.kind === "transit");
    const transitId = transit ? transit.id : null;
    const locations = ledger.locations.filter((l) => l.is_active && l.kind !== "transit");

    const placementById = {};
    let unassignedUnits = 0;
    let toAssignUnits = 0;
    const toAssign = [];
    const assignedKeys = assignedOrderLines(ledger.movements);

    base.tracked.forEach((r) => {
      const p = placementFor(r.id, r.stock, index);
      placementById[r.id] = p;
      unassignedUnits += p.unassigned;
      toAssignUnits += p.toAssign;
      if (!p.toAssign) return;
      const isCustom = r.type === TYPE_CUSTOM;
      const sizes = isCustom ? [""] : Object.keys(p.toAssignBySize);
      sizes.forEach((size) => {
        toAssign.push({
          row: r,
          size,
          qty: isCustom ? p.toAssign : p.toAssignBySize[size],
          candidates: saleCandidates({ productId: r.id, size, isCustom }, data.recentOrders, assignedKeys, locations),
        });
      });
    });

    const locationStats = {};
    locations.forEach((l) => {
      const products = index.byLocation[l.id] || {};
      let units = 0;
      Object.values(products).forEach((sizes) => Object.values(sizes).forEach((q) => { units += q; }));
      locationStats[l.id] = { units, designs: Object.keys(products).length };
    });

    const collectionsById = {};
    (ledger.collections || []).forEach((c) => { collectionsById[c.id] = c; });
    const collectionsByProduct = {};
    (ledger.productCollections || []).forEach((pc) => {
      (collectionsByProduct[pc.product_id] || (collectionsByProduct[pc.product_id] = [])).push(pc.collection_id);
    });

    let inTransitUnits = 0;
    if (transitId) {
      Object.values(index.byLocation[transitId] || {}).forEach((sizes) => Object.values(sizes).forEach((q) => { inTransitUnits += q; }));
    }

    return {
      installed: true,
      ready: true,
      index,
      transitId,
      locations,
      locationsById,
      locationStats,
      placementById,
      toAssign: toAssign.sort((a, b) => (b.candidates[0] ? new Date(b.candidates[0].order.created_at) : 0)
        - (a.candidates[0] ? new Date(a.candidates[0].order.created_at) : 0)),
      assignedKeys,
      movements: ledger.movements,
      transfers: groupTransfers(ledger.movements, transitId),
      receipts: receiptsByOrder(ledger.movements),
      shopifyUnsent: ledger.movements.filter((m) => ["pending", "not_sent", "failed"].includes(m.shopify_status)),
      collections: ledger.collections || [],
      collectionsById,
      collectionsByProduct,
      totals: {
        placedUnits: Object.values(locationStats).reduce((a, s) => a + s.units, 0),
        inTransitUnits,
        unassignedUnits,
        toAssignUnits,
      },
      loadedAt: ledger.loadedAt,
    };
  }, [base, ledger, data]);

  return base ? { ...base, sales, ledger: ledgerView } : null;
}
