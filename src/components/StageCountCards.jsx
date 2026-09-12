import React, { useMemo, useState } from "react";
import {
  STAGE_GROUPS,
  getStageGroupKey,
  classifyComponentForStageCard,
  CHANNEL_KEY_LABELS,
  CHANNEL_SEGMENTS,
} from "../utils/barcodeService";
import "./StageCountCards.css";

// Channel display order + colour, shared app-wide. Built once from
// CHANNEL_SEGMENTS so these cards can never drift from the revenue charts.
const CHANNEL_ORDER = CHANNEL_SEGMENTS.map((s) => s.label);
const channelColor = (key) =>
  CHANNEL_SEGMENTS.find((s) => s.label === CHANNEL_KEY_LABELS[key])?.color || "#888";

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
 * In piece mode the split shown on each card is switchable: in-house/vendor
 * (where the piece physically is) or channel-wise (which business it belongs
 * to). Channel comes from the STORED order_components.channel_key, resolved
 * server-side by resolve_order_channel_key() — db/…/v2/62. It is never inferred
 * from the order_no prefix here, because is_stock_order outranks the prefix and
 * that flag lives on `orders`: a stock order raised through Ludhiana carries an
 * SB-LDHC- number but is not Ludhiana Store business.
 *
 * @param {object[]} [props.orders]      Orders to count (mode 1).
 * @param {object[]} [props.components]  Components to count (mode 2). Takes
 *                                       precedence over `orders` when provided.
 *                                       Include `channel_key` in the select to
 *                                       enable the channel split.
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
  // 'location' = in-house/vendor (the original view), 'channel' = channel-wise.
  const [splitBy, setSplitBy] = useState("location");

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

  // Per-stage channel breakdown: { [stageKey]: { delhi: 4, b2b: 2, … } }.
  //
  // Deliberately driven by the SAME classifyComponentForStageCard the location
  // split uses, rather than a second pass over the raw rows. That classifier is
  // what excludes disposed/scrapped pieces and decides which stage a piece
  // counts at, so re-implementing it here would let the two views of one card
  // disagree — and a card whose channel numbers don't sum to its own total is
  // worse than no breakdown at all.
  const channelCounts = useMemo(() => {
    if (!pieceMode) return {};
    const map = {};
    STAGE_GROUPS.forEach((g) => { map[g.key] = {}; });
    (components || []).forEach((c) => {
      const status = orderStatusById ? orderStatusById[c.order_id] : c._orderStatus;
      const info = classifyComponentForStageCard(c, status);
      if (!info || !info.key || !map[info.key]) return;
      // A component whose order no longer resolves has no channel. Bucketed
      // under a visible "Unknown" rather than dropped, so the parts still sum.
      const ck = c.channel_key || "__unknown";
      map[info.key][ck] = (map[info.key][ck] || 0) + 1;
    });
    return map;
  }, [pieceMode, components, orderStatusById]);

  // Channels actually present anywhere in this data, in app-wide display order.
  // Derived from the data, not from CHANNEL_SEGMENTS wholesale: a warehouse that
  // never sees Exhibition work shouldn't render an Exhibition row on 12 cards.
  const presentChannels = useMemo(() => {
    if (!pieceMode) return [];
    const seen = new Set();
    Object.values(channelCounts).forEach((byChannel) => {
      Object.keys(byChannel).forEach((k) => seen.add(k));
    });
    return [...seen].sort((a, b) => {
      // Unknown last — it is a data-quality bucket, not a business one.
      if (a === "__unknown") return 1;
      if (b === "__unknown") return -1;
      const ia = CHANNEL_ORDER.indexOf(CHANNEL_KEY_LABELS[a]);
      const ib = CHANNEL_ORDER.indexOf(CHANNEL_KEY_LABELS[b]);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [pieceMode, channelCounts]);

  // Is channel data actually available? Components selected without
  // `channel_key` would otherwise render every piece as "Unknown", which looks
  // like broken data rather than a missing column.
  const hasChannelData = presentChannels.some((k) => k !== "__unknown");

  const totalFor = (key) =>
    pieceMode ? pieceCounts[key].internal + pieceCounts[key].external : orderCounts[key];

  const visible = hideEmpty ? STAGE_GROUPS.filter((g) => totalFor(g.key) > 0) : STAGE_GROUPS;

  // Grand total across every stage card — the client's reference number for
  // "how many pieces are in the system right now": the stage cards must sum
  // to this, so it uses the exact same counts they do.
  const grandTotal = STAGE_GROUPS.reduce((sum, g) => sum + totalFor(g.key), 0);

  const clickable = typeof onStageClick === "function";
  // Clicking a card / a sub-count filters to that stage; kind narrows it to
  // 'internal' (in-house) or 'external' (vendor). Big number / label = 'both'.
  const fire = (e, key, kind) => {
    if (!clickable) return;
    e.stopPropagation();
    onStageClick(key, kind);
  };

  const channelMode = pieceMode && splitBy === "channel" && hasChannelData;

  // A height floor every card shares, derived from the stage carrying the most
  // split lines. grid-auto-rows:1fr only equalises cards WITHIN a row, so
  // without this the second row shrinks to its own tallest card and the strip
  // still looks ragged — which is the whole complaint. Computed rather than
  // hardcoded because the line count depends on how many channels this
  // warehouse actually sees (1 for a single-channel desk, 8+ for retail).
  const cardMinHeight = useMemo(() => {
    if (!pieceMode) return undefined;
    const HEADER = 74;      // count + label + padding
    const LINE = 16;        // one split line
    const DIVIDER = 18;     // margin + padding + border above the split block
    let maxLines = 0;
    if (channelMode) {
      STAGE_GROUPS.forEach((g) => {
        const n = presentChannels.filter((ck) => (channelCounts[g.key][ck] || 0) > 0).length;
        if (n > maxLines) maxLines = n;
      });
    } else {
      // in-house + vendor, on the vendor-capable stages only.
      maxLines = STAGE_GROUPS.some((g) => g.external) ? 2 : 0;
    }
    if (maxLines === 0) return undefined;
    return HEADER + DIVIDER + maxLines * LINE;
  }, [pieceMode, channelMode, presentChannels, channelCounts]);

  return (
    <div
      className="scc-wrap"
      style={cardMinHeight ? { "--scc-card-min": `${cardMinHeight}px` } : undefined}
    >
      <div className="scc-head">
        {title && <h3 className="scc-title">{title}</h3>}
        {/* Only offered when there is channel data to show. */}
        {pieceMode && hasChannelData && (
          <div className="scc-splitbar" role="group" aria-label="Break stages down by">
            <button
              type="button"
              className={`scc-splitbtn ${splitBy === "location" ? "on" : ""}`}
              onClick={() => setSplitBy("location")}
            >In-house / Vendor</button>
            <button
              type="button"
              className={`scc-splitbtn ${splitBy === "channel" ? "on" : ""}`}
              onClick={() => setSplitBy("channel")}
            >Channel-wise</button>
          </div>
        )}
      </div>
      <div className="scc-grid">
        {visible.map((g) => {
          const total = totalFor(g.key);
          const split = pieceMode ? pieceCounts[g.key] : null;
          // Only the vendor-capable stages show the in-house/vendor split; the
          // always-internal ones (order received, cloth issue, QC, packaging)
          // show just the number.
          const showSplit = pieceMode && splitBy === "location" && g.external;
          // Channel-wise applies to EVERY stage — unlike vendor movement,
          // every piece belongs to a channel wherever it physically sits.
          const channelRows = channelMode
            ? presentChannels
                .map((ck) => ({ ck, n: channelCounts[g.key][ck] || 0 }))
                .filter((r) => r.n > 0)
            : [];
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
              {/* Channel rows are display-only, deliberately. onStageClick's
                  second argument is a stageKind ('internal'/'external') that
                  every caller maps onto a vendor-location filter; handing it a
                  channel key would set a filter no dashboard understands and
                  silently return nothing. Making these clickable means teaching
                  all four callers a channel filter — worth doing, but a
                  separate change from showing the numbers. */}
              {/* No rows = no pieces at this stage. Render nothing rather than
                  an empty divider with a dash under it, which read as a broken
                  card rather than an empty one. */}
              {channelMode && channelRows.length > 0 && (
                <span className="scc-split scc-split-channel">
                  {channelRows.map(({ ck, n }) => (
                    <span
                      key={ck}
                      className="scc-split-item scc-split-static"
                      title={ck === "__unknown"
                        ? "Channel could not be resolved for these pieces"
                        : CHANNEL_KEY_LABELS[ck] || ck}
                    >
                      <span
                        className="scc-dot"
                        style={{ background: ck === "__unknown" ? "#9e9e9e" : channelColor(ck) }}
                      />
                      {n} {ck === "__unknown" ? "Unknown" : (CHANNEL_KEY_LABELS[ck] || ck)}
                    </span>
                  ))}
                </span>
              )}
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
        {/* Total last — the reference number every stage count reads against.
            grandTotal already excludes disposed/scrapped pieces, so it is the
            count of ACTIVE components (piece mode). */}
        <div className="scc-card scc-total">
          <span className="scc-accent-bar" />
          <span className="scc-count">{grandTotal}</span>
          <span className="scc-label">{pieceMode ? "Total Active Components" : "Total Orders"}</span>
        </div>
      </div>
    </div>
  );
};

export default StageCountCards;
