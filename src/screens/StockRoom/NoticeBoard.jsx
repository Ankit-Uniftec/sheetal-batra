import React, { useMemo, useState } from "react";
import { Seg, Icon } from "./StockRoomUi";
import { salesSummary, formatUnits, formatDay, timeAgo, TYPE_LXRTS } from "./stockRoomModel";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "alerts", label: "Alerts" },
  { value: "sales", label: "Activity" },
];

const SALES_FEED_DAYS = 7;

function dayHeading(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return formatDay(iso);
}

/**
 * The board's content, computed once in the shell so the collapsed rail and
 * the menu pill can show the same alert count the open board lists.
 */
export function useNotices({ view, data, go, openProduct }) {
  const alerts = useMemo(() => {
    if (!view || !data) return [];
    const out = [];
    const recent = salesSummary(data.recentOrders, { days: 30 });

    view.tracked
      .filter((r) => r.type === TYPE_LXRTS)
      .flatMap((r) => r.sizesOut
        .filter((s) => recent.byProduct[r.id]?.bySize[s])
        .map((s) => ({ r, s, sold: recent.byProduct[r.id].bySize[s] })))
      .sort((a, b) => b.sold - a.sold)
      .slice(0, 4)
      .forEach(({ r, s, sold }) => out.push({
        key: `out-${r.id}-${s}`, kind: "crit", icon: "alert",
        title: `${r.product.name} · size ${s} is out`,
        body: `Sold ${sold} in the last 30 days and none are left.`,
        act: "Open design", run: () => openProduct(r.id),
      }));

    const invalid = view.findings.invalidVariants;
    if (invalid.length) {
      const designs = new Set(invalid.map((f) => f.product.id)).size;
      out.push({
        key: "invalid", kind: "crit", icon: "alert",
        title: `${invalid.length} size record${invalid.length === 1 ? " holds" : "s hold"} an impossible count`,
        body: `Across ${designs} LXRTS design${designs === 1 ? "" : "s"}. Left out of these totals, but other screens will show them as real stock.`,
        act: "Review", run: () => go("integrity"),
      });
    }

    const dups = view.findings.duplicateShopifyIds.length;
    if (dups) out.push({
      key: "dups", kind: "crit", icon: "integrity",
      title: `${dups} Shopify ID${dups === 1 ? " is" : "s are"} shared by two designs`,
      body: "Every sale of either design reduces the same Shopify stock.",
      act: "Review", run: () => go("integrity"),
    });

    const today = new Date(new Date().setHours(0, 0, 0, 0));
    const overdue = view.openStockOrders.filter((o) => o.delivery_date && new Date(o.delivery_date) < today);
    if (overdue.length) out.push({
      key: "overdue", kind: "low", icon: "orders",
      title: `${formatUnits(overdue.length)} stock order${overdue.length === 1 ? " is" : "s are"} past delivery date`,
      body: `Oldest due ${formatDay(overdue.map((o) => o.delivery_date).sort()[0])}.`,
      act: "View stock orders", run: () => go("stockorders"),
    });

    const { low, out: outCount } = view.totals;
    if (outCount) out.push({
      key: "out", kind: "low", icon: "stock",
      title: `${formatUnits(outCount)} design${outCount === 1 ? " is" : "s are"} out of stock`,
      body: `${formatUnits(low)} more hold fewer than 5 units.`,
      act: "Review stock", run: () => go("stock", { status: "out" }),
    });

    const ledger = view.ledger;
    if (ledger?.installed) {
      if (ledger.toAssign.length) out.unshift({
        key: "toassign", kind: "low", icon: "pin",
        title: `${formatUnits(ledger.totals.toAssignUnits)} sold unit${ledger.totals.toAssignUnits === 1 ? " needs" : "s need"} a location`,
        body: "Sold through the order form or website, but still recorded in a location. Say which one each left from.",
        act: "Assign sales", run: () => go("locations"),
      });
      const failed = ledger.shopifyUnsent.filter((m) => m.shopify_status === "failed").length;
      const notSent = ledger.shopifyUnsent.length - failed;
      if (failed) out.unshift({
        key: "shopify-failed", kind: "crit", icon: "alert",
        title: `${failed} stock change${failed === 1 ? "" : "s"} did not reach Shopify`,
        body: "The order form may still show the old stock for these LXRTS sizes.",
        act: "Review", run: () => go("integrity"),
      });
      if (notSent) out.push({
        key: "shopify-off", kind: "info", icon: "alert",
        title: `${notSent} LXRTS change${notSent === 1 ? "" : "s"} saved without updating Shopify`,
        body: "Shopify sync is off for this environment, so the live store was left alone.",
        act: "See the list", run: () => go("integrity"),
      });
      if (ledger.totals.unassignedUnits) out.push({
        key: "unassigned", kind: "gold", icon: "pin",
        title: `${formatUnits(ledger.totals.unassignedUnits)} units are not in a location yet`,
        body: "Place them where they physically are — one at a time, or all at once from a CSV.",
        act: "Open locations", run: () => go("locations"),
      });
    } else if (view.totals.trackedUnits) {
      out.push({
        key: "unassigned", kind: "gold", icon: "pin",
        title: `${formatUnits(view.totals.trackedUnits)} units have no location yet`,
        body: "Stock is recorded per size or per design, but not by location. Every unit starts unassigned.",
        act: "Open locations", run: () => go("locations"),
      });
    }

    return out;
  }, [view, data, go, openProduct]);

  // Recent sales of tracked designs, newest first, from existing orders.
  const salesDays = useMemo(() => {
    if (!view || !data) return [];
    const since = Date.now() - SALES_FEED_DAYS * 86400000;
    const byId = view.productsById;
    const items = [];
    data.recentOrders.forEach((o) => {
      if (o.is_stock_order === true || String(o.status || "").toLowerCase() === "cancelled") return;
      const ts = new Date(o.created_at).getTime();
      if (!(ts >= since)) return;
      (o.items || []).forEach((it, i) => {
        const p = it && byId[it.product_id];
        if (!p || !(p.sync_enabled === true || p.is_custom_piece === true)) return;
        items.push({
          key: `${o.id}-${i}`, ts, iso: o.created_at, kind: "sale", icon: "sale",
          title: `${Number(it.quantity) || 1} × ${p.name}${it.size ? ` · ${it.size}` : ""}`,
          body: [o.order_no, o.salesperson_store || o.salesperson].filter(Boolean).join(" · "),
          time: new Date(o.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
          act: "Open design", run: () => openProduct(p.id),
        });
      });
    });
    // Stock Room movements in the same window. A transfer is two rows; its
    // outgoing leg carries the whole story, so the incoming one is skipped.
    const ledger = view.ledger;
    if (ledger?.installed) {
      const place = (id) => (id ? ledger.locationsById[id]?.name || "a closed location" : "unassigned stock");
      const transferTo = {};
      ledger.movements.forEach((m) => { if (m.reason === "transfer_in") transferTo[m.transfer_id] = m.location_id; });
      ledger.movements.forEach((m) => {
        const ts = new Date(m.occurred_at).getTime();
        if (!(ts >= since) || m.reason === "transfer_in") return;
        const p = byId[m.product_id];
        const what = `${Math.abs(m.delta)} × ${p?.name || "a product"}${m.size ? ` · ${m.size}` : ""}`;
        const title = {
          placement: `Placed ${what} in ${place(m.location_id)}`,
          transfer_out: `Moved ${what} to ${place(transferTo[m.transfer_id])}`,
          sale: `Sold ${what} from ${place(m.location_id)}`,
          sale_assignment: `Sale of ${what} assigned to ${place(m.location_id)}`,
          receipt: `Received ${what} into ${place(m.location_id)}`,
          adjustment: `Recounted ${p?.name || "a product"}${m.size ? ` · ${m.size}` : ""} (${m.delta > 0 ? "+" : ""}${m.delta})`,
        }[m.reason] || m.reason;
        items.push({
          key: `m-${m.id}`, ts, iso: m.occurred_at, kind: "gold", icon: m.reason.startsWith("transfer") ? "transfer" : "stock",
          title,
          body: [m.reason === "transfer_out" ? `From ${place(m.location_id)}` : null, m.ref_id, m.actor_email].filter(Boolean).join(" · "),
          time: new Date(m.occurred_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
          act: p ? "Open design" : null, run: () => p && openProduct(p.id),
        });
      });
    }

    items.sort((a, b) => b.ts - a.ts);
    const groups = [];
    items.slice(0, 60).forEach((it) => {
      const label = dayHeading(it.iso);
      if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
      groups[groups.length - 1].items.push(it);
    });
    return groups;
  }, [view, data, openProduct]);

  // The number on the rail: things someone should act on, not information.
  const alertCount = alerts.filter((a) => a.kind === "crit" || a.kind === "low").length;

  return { alerts, salesDays, alertCount };
}

function Notice({ n, onAct }) {
  return (
    <div className={`sr-notice${n.kind === "crit" ? " is-crit" : ""}`}>
      <span className={`sr-n-ico k-${n.kind}`}><Icon name={n.icon} width={1.8} /></span>
      <div className="sr-n-body">
        <div className="sr-n-top"><b>{n.title}</b>{n.time && <span className="sr-n-time">{n.time}</span>}</div>
        <p>{n.body}</p>
        {n.act && (
          <button type="button" className="sr-n-act" onClick={() => onAct(n)}>{n.act}<Icon name="chevron" width={2} /></button>
        )}
      </div>
    </div>
  );
}

/** Collapsed strip on the right edge; the whole strip opens the board. */
export function NoticeRail({ count, onOpen }) {
  return (
    <aside className="sr-rail" aria-label="Notice board, collapsed">
      <button type="button" className="sr-rail-btn" onClick={onOpen} aria-label={`Open notice board${count ? `, ${count} alerts` : ""}`}>
        <span className="sr-rail-ico">
          <Icon name="bell" width={1.8} />
          {count > 0 && <span className="sr-count">{count}</span>}
        </span>
        <span className="sr-rail-label">Notices</span>
      </button>
    </aside>
  );
}

export default function NoticeBoard({ notices, data, open, onClose, onRefresh, refreshing, closeOnAct }) {
  const [filter, setFilter] = useState("all");
  const { alerts, salesDays } = notices;

  // On narrow screens the board covers the page, so following a notice closes it.
  const act = (n) => { if (closeOnAct()) onClose(); n.run(); };

  return (
    <>
      <div className="sr-board-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="sr-board" aria-label="Notice board" aria-hidden={!open}>
        <div className="sr-board-head">
          <div className="sr-board-title">
            <h2>Notice board</h2>
            <button type="button" className="sr-linkbtn" style={{ marginLeft: "auto" }} onClick={onRefresh} disabled={refreshing}>
              {refreshing ? "Refreshing…" : `Updated ${timeAgo(data.loadedAt)}`}
            </button>
            <button type="button" className="sr-x" onClick={onClose} aria-label="Collapse notice board" tabIndex={open ? 0 : -1}>
              <Icon name="close" width={2} />
            </button>
          </div>
          <Seg label="Show" options={FILTERS} value={filter} onChange={setFilter} />
        </div>
        <div className="sr-board-feed">
          {filter !== "sales" && (
            <>
              <div className="sr-feed-day"><span className="sr-label">Needs attention</span></div>
              {alerts.length ? alerts.map((n) => <Notice key={n.key} n={n} onAct={act} />)
                : <div className="sr-notice"><span /><div className="sr-n-body"><p>Nothing needs attention.</p></div></div>}
            </>
          )}
          {filter !== "alerts" && (
            salesDays.length ? salesDays.map((g) => (
              <div key={g.label}>
                <div className="sr-feed-day"><span className="sr-label">Activity · {g.label}</span></div>
                {g.items.map((n) => <Notice key={n.key} n={n} onAct={act} />)}
              </div>
            )) : (
              <>
                <div className="sr-feed-day"><span className="sr-label">Activity</span></div>
                <div className="sr-notice"><span /><div className="sr-n-body"><p>{data.salesReady || data.recentOrders.length
                  ? `No sales or stock changes in the last ${SALES_FEED_DAYS} days.`
                  : "Loading sales…"}</p></div></div>
              </>
            )
          )}
        </div>
      </aside>
    </>
  );
}
