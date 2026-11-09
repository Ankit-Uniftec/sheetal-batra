import React from "react";
import CancellationsPanel from "../../components/CancellationsPanel";
import StockPanel from "../../components/stock/StockPanel";
import { poolsForUser } from "../../utils/stockVisibility";
import { PageHead } from "../CeoDashboard/CeoUi";

// ============================================================
// Cancellations, Stock and Profile. The panels are the shared ones (the COO
// and Production Head use them too); money is switched off for production.
// ============================================================

export function CancellationsPage() {
  return (
    <div className="ceo-page">
      <PageHead title="Cancellations" desc="Orders cancelled, why, and at which stage the pieces were when they came off the floor." />
      <section className="ceo-card pm-classic ceo-keep"><CancellationsPanel hideMoney /></section>
    </div>
  );
}

export function StockPage() {
  return (
    <div className="ceo-page">
      <PageHead title="Stock" desc="Finished stock the floor can draw on, by pool." />
      <section className="ceo-card pm-classic ceo-keep"><StockPanel pools={poolsForUser({ role: "production_manager" })} /></section>
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
