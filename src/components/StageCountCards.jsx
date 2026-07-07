import React, { useMemo } from "react";
import { STAGE_GROUPS, getStageGroupKey, classifyComponentForStageCard } from "../utils/barcodeService";
import "./StageCountCards.css";

/**
 * StageCountCards — reusable grid of cards, one per V2 production stage.
 *
 * Two modes:
 *  1. ORDER-count (default, back-compat): pass `orders`. Each card shows how
 *     many ORDERS are in that stage (read from `warehouse_stage`, the order's
 *     slowest active component, maintained by the DB trigger).
 *  2. PIECE-count + internal/external SPLIT: pass `components`. Each card counts
 *     individual pieces (components) at that stage and splits them into
 *     in-house (internal) vs out-at-a-vendor (external). This is the truthful
 *     way to show vendor movement, since one order can be half-in / half-out.
 *     Requires each component to carry `current_stage`, `is_outside_wh` and
 *     (for out pieces) `stages_outside` — enrich with enrichComponentsWithMovements.
 *
 * @param {object[]} [props.orders]      Orders to count (mode 1).
 * @param {object[]} [props.components]  Components to count (mode 2). Takes
 *                                       precedence over `orders` when provided.
 * @param {(stageKey: string) => void} [props.onStageClick]
 *                                       Called with the group key (e.g.
 *                                       "embroidery") when a card is clicked.
 * @param {string} [props.stageField="warehouse_stage"]  Order stage field (mode 1).
 * @param {string} [props.title]         Optional heading above the grid.
 * @param {boolean} [props.hideEmpty=false]  Hide stages with a 0 total.
 */
const StageCountCards = ({
  orders = [],
  components,
  orderStatusById,
  onStageClick,
  stageField = "warehouse_stage",
  title,
  hideEmpty = false,
}) => {
  const pieceMode = Array.isArray(components);

  // Mode 1 — order counts (one number per stage).
  const orderCounts = useMemo(() => {
    if (pieceMode) return {};
    const map = {};
    STAGE_GROUPS.forEach((g) => { map[g.key] = 0; });
    (orders || []).forEach((o) => {
      const key = getStageGroupKey(o?.[stageField]);
      if (key && map[key] !== undefined) map[key] += 1;
    });
    return map;
  }, [pieceMode, orders, stageField]);

  // Mode 2 — piece counts split into internal (in-house) vs external (at vendor).
  const pieceCounts = useMemo(() => {
    if (!pieceMode) return {};
    const map = {};
    STAGE_GROUPS.forEach((g) => { map[g.key] = { internal: 0, external: 0 }; });
    (components || []).forEach((c) => {
      const status = orderStatusById ? orderStatusById[c.order_id] : c._orderStatus;
      const info = classifyComponentForStageCard(c, status);
      if (info && info.key && map[info.key]) map[info.key][info.kind] += 1;
    });
    return map;
  }, [pieceMode, components, orderStatusById]);

  const totalFor = (key) =>
    pieceMode ? pieceCounts[key].internal + pieceCounts[key].external : orderCounts[key];

  const visible = hideEmpty ? STAGE_GROUPS.filter((g) => totalFor(g.key) > 0) : STAGE_GROUPS;

  const clickable = typeof onStageClick === "function";
  // Clicking a card / a sub-count filters to that stage; kind narrows it to
  // 'internal' (in-house) or 'external' (vendor). Big number / label = 'both'.
  const fire = (e, key, kind) => {
    if (!clickable) return;
    e.stopPropagation();
    onStageClick(key, kind);
  };

  return (
    <div className="scc-wrap">
      {title && <h3 className="scc-title">{title}</h3>}
      <div className="scc-grid">
        {visible.map((g) => {
          const total = totalFor(g.key);
          const split = pieceMode ? pieceCounts[g.key] : null;
          // Only the vendor-capable stages show the in-house/vendor split; the
          // always-internal ones (order received, cloth issue, QC, packaging)
          // show just the number.
          const showSplit = pieceMode && g.external;
          return (
            <div
              key={g.key}
              className={`scc-card ${clickable ? "scc-clickable" : ""}`}
              style={{ "--scc-accent": g.color }}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={(e) => fire(e, g.key, "both")}
              onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fire(e, g.key, "both"); } } : undefined}
            >
              <span className="scc-accent-bar" />
              <span className="scc-count">{total}</span>
              <span className="scc-label">{g.label}</span>
              {showSplit && (
                <span className="scc-split">
                  <button
                    type="button"
                    className="scc-split-item scc-split-in"
                    title="In the warehouse — click to filter"
                    onClick={(e) => fire(e, g.key, "internal")}
                    disabled={!clickable}
                  >
                    <span className="scc-dot" />{split.internal} in-house
                  </button>
                  <button
                    type="button"
                    className="scc-split-item scc-split-ext"
                    title="Out at a vendor — click to filter"
                    onClick={(e) => fire(e, g.key, "external")}
                    disabled={!clickable}
                  >
                    <span className="scc-dot" />{split.external} vendor
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default StageCountCards;
