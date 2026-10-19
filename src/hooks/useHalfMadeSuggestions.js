import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAllRows } from "../utils/fetchAllRows";
import { exactHalfMadeMatches, fetchMyRole, isProductionRole, listHalfMade } from "../utils/halfMade";

/**
 * Half Made suggestions for the orders a production dashboard shows
 * (Release 16). Reads the AVAILABLE half-made pieces once, and — only if there
 * are any — the pieces that have not started yet of those piece types; then
 * matches them against the orders already in the dashboard (exact rule:
 * type + product + size + colour, utils/halfMade). No query per card.
 *
 * @param {object[]} orders  the dashboard's orders (need id, order_no, items)
 * @returns {{ byOrder: Object<string, {component, item, matches}[]>, count: number,
 *             me: {email, role}, reload: () => void }}
 */
export default function useHalfMadeSuggestions(orders) {
  const [me, setMe] = useState({ email: null, role: null });
  const [pieces, setPieces] = useState([]);
  const [unstarted, setUnstarted] = useState([]);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const who = await fetchMyRole();
        if (!alive) return;
        setMe(who);
        if (!isProductionRole(who.role)) { setPieces([]); setUnstarted([]); return; }
        const available = await listHalfMade({ status: "available" });
        if (!alive) return;
        setPieces(available);
        const types = [...new Set(available.map((p) => p.component_type))];
        if (!types.length) { setUnstarted([]); return; }
        const { data } = await fetchAllRows("order_components", (q) => q
          .select("id, order_id, order_no, barcode, component_type, component_label, item_index, current_stage, is_active")
          .eq("current_stage", "order_received")
          .eq("is_active", false)
          .is("cancelled_at", null)
          .in("component_type", types));
        if (alive) setUnstarted(data || []);
      } catch (err) {
        console.error("Half Made suggestions failed (none shown):", err);
        if (alive) { setPieces([]); setUnstarted([]); }
      }
    })();
    return () => { alive = false; };
  }, [tick]);

  const byOrder = useMemo(() => {
    if (!pieces.length || !unstarted.length) return {};
    const orderById = new Map((orders || []).map((o) => [o.id, o]));
    const out = {};
    for (const comp of unstarted) {
      const order = orderById.get(comp.order_id);
      if (!order) continue;
      const item = order.items?.[comp.item_index ?? 0];
      const matches = exactHalfMadeMatches(comp.component_type, item, pieces);
      if (matches.length) (out[comp.order_id] ||= []).push({ component: comp, item, matches });
    }
    return out;
  }, [orders, pieces, unstarted]);

  return { byOrder, count: Object.keys(byOrder).length, me, reload };
}

