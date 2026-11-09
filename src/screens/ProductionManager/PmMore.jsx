import React, { useMemo } from "react";
import CancellationsPanel from "../../components/CancellationsPanel";
import { Insight, PageHead, num } from "../CeoDashboard/CeoUi";
import { DAY, channelOf, pieceState, plural } from "./pmModel";

// ============================================================
// Cancellations and Profile. The Cancellations panel is the shared one (the
// COO uses it too); money is switched off for production. Stock is PmStock.jsx.
// ============================================================

export function CancellationsPage({ ctx }) {
  const { orders, componentsByOrder, openOrders, openPieces } = ctx;
  // What the cancellations say, from the orders and pieces themselves.
  const s = useMemo(() => {
    const now = Date.now();
    const cancelled = orders.filter((o) => String(o.status || "").toLowerCase() === "cancelled" && o.cancelled_at);
    const inDays = (o, a, b) => { const t = now - new Date(o.cancelled_at).getTime(); return t >= a * DAY && t < b * DAY; };
    const last = cancelled.filter((o) => inDays(o, 0, 30));
    const before = cancelled.filter((o) => inDays(o, 30, 60));
    const pieces = last.flatMap((o) => componentsByOrder[o.id] || []);
    const worked = pieces.filter((c) => c.current_stage && c.current_stage !== "order_received" && pieceState({ ...c, cancelled_at: null }) !== "not_started");
    const reasons = {};
    last.forEach((o) => { const k = String(o.cancellation_reason || "").trim().toLowerCase(); if (!k) return; (reasons[k] || (reasons[k] = { text: o.cancellation_reason.trim(), list: [] })).list.push(o); });
    const topReason = Object.values(reasons).sort((a, b) => b.list.length - a.list.length)[0];
    const ch = {};
    last.forEach((o) => { const k = channelOf(o); (ch[k] || (ch[k] = [])).push(o); });
    const topChannel = Object.entries(ch).sort((a, b) => b[1].length - a[1].length)[0];
    const noReason = last.filter((o) => !String(o.cancellation_reason || "").trim());
    return { last, before, pieces, worked, topReason, topChannel, noReason };
  }, [orders, componentsByOrder]);
  return (
    <div className="ceo-page">
      <PageHead title="Cancellations" desc="Orders cancelled, why, and at which stage the pieces were when they came off the floor." />
      <section className="ceo-card pm-says-card">
        <h3 className="pm-says-title">What This Says</h3>
        <div className="pmq-insights">
          <Insight tone={s.last.length > s.before.length ? "warn" : "gold"}>
            <b>{plural(s.last.length, "order")}</b> {s.last.length === 1 ? "was" : "were"} cancelled in the last 30 days, against {num(s.before.length)} in the 30 days before.{" "}
            {s.last.length > 0 && <button type="button" className="ceo-link" onClick={() => openOrders({ title: "Cancelled in the Last 30 Days", sub: "Every channel", orders: s.last })}>See them</button>}
          </Insight>
          {s.pieces.length > 0 && (
            <Insight tone={s.worked.length ? "warn" : "gold"}>
              <b>{num(s.worked.length)}</b> of the {plural(s.pieces.length, "piece")} taken off the floor had already been worked on (past Cloth Issue), so that work was lost.{" "}
              {s.worked.length > 0 && <button type="button" className="ceo-link" onClick={() => openPieces({ title: "Worked On, Then Cancelled", sub: "Pieces past Cloth Issue when their order was cancelled", pieces: s.worked })}>See the pieces</button>}
            </Insight>
          )}
          {s.topChannel && <Insight>Most cancellations came from <b>{s.topChannel[0]}</b>: {plural(s.topChannel[1].length, "order")}.</Insight>}
          {s.topReason && s.topReason.list.length > 1 && <Insight>The reason given most often was “{s.topReason.text}” ({plural(s.topReason.list.length, "order")}).</Insight>}
          {s.noReason.length > 0 && <Insight tone="warn"><b>{plural(s.noReason.length, "cancellation")}</b> {s.noReason.length === 1 ? "has" : "have"} no reason recorded.</Insight>}
        </div>
      </section>
      <section className="ceo-card pm-classic ceo-keep"><CancellationsPanel hideMoney /></section>
    </div>
  );
}

export function ProfilePage({ ctx }) {
  const p = ctx.profile || {};
  return (
    <div className="ceo-page">
      <PageHead title="Profile" desc="Your account on the production system." />
      <section className="ceo-card pm-profile">
        <span className="pm-profile-avatar">{(p.saleperson || "PM").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("")}</span>
        <dl className="ceo-dl">
          <dt>Name</dt><dd>{p.saleperson || "–"}</dd>
          <dt>Email</dt><dd>{p.email || "–"}</dd>
          <dt>Role</dt><dd>Production Manager</dd>
          {p.designation && <><dt>Designation</dt><dd>{p.designation}</dd></>}
          <dt>Store</dt><dd>{p.store_name || "All"}</dd>
        </dl>
      </section>
    </div>
  );
}
