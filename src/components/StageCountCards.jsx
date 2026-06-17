import React, { useMemo } from "react";
import { STAGE_GROUPS, getStageGroupKey } from "../utils/barcodeService";
import "./StageCountCards.css";

/**
 * StageCountCards — reusable grid of cards, one per V2 production stage,
 * showing how many orders are currently in that stage.
 *
 * Reusable anywhere: pass a list of orders and an onStageClick handler.
 *
 * @param {object[]} props.orders   Orders to count. Each order's stage is read
 *                                  from `warehouse_stage` (earliest/slowest
 *                                  active component, maintained by the DB trigger).
 * @param {(stageKey: string) => void} [props.onStageClick]
 *                                  Called with the group key (e.g. "embroidery")
 *                                  when a card is clicked. Omit for non-clickable.
 * @param {string} [props.stageField="warehouse_stage"]
 *                                  Order field holding the raw stage value.
 * @param {string} [props.title]    Optional heading above the grid.
 * @param {boolean} [props.hideEmpty=false]  Hide stages with a 0 count.
 */
const StageCountCards = ({
  orders = [],
  onStageClick,
  stageField = "warehouse_stage",
  title,
  hideEmpty = false,
}) => {
  const counts = useMemo(() => {
    const map = {};
    STAGE_GROUPS.forEach((g) => { map[g.key] = 0; });
    (orders || []).forEach((o) => {
      const key = getStageGroupKey(o?.[stageField]);
      if (key && map[key] !== undefined) map[key] += 1;
    });
    return map;
  }, [orders, stageField]);

  const visible = hideEmpty ? STAGE_GROUPS.filter((g) => counts[g.key] > 0) : STAGE_GROUPS;

  return (
    <div className="scc-wrap">
      {title && <h3 className="scc-title">{title}</h3>}
      <div className="scc-grid">
        {visible.map((g) => {
          const clickable = typeof onStageClick === "function";
          return (
            <button
              key={g.key}
              type="button"
              className={`scc-card ${clickable ? "scc-clickable" : ""}`}
              style={{ borderTopColor: g.color }}
              onClick={clickable ? () => onStageClick(g.key) : undefined}
              disabled={!clickable}
            >
              <span className="scc-count" style={{ color: g.color }}>{counts[g.key]}</span>
              <span className="scc-label">{g.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default StageCountCards;
