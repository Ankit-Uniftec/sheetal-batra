import React from "react";
import CancellationsPanel from "../../components/CancellationsPanel";
import { PageHead } from "../CeoDashboard/CeoUi";

// ============================================================
// Cancellations and Profile. The Cancellations panel is the shared one (the
// COO uses it too); money is switched off for production. Stock is PmStock.jsx.
// ============================================================

export function CancellationsPage() {
  return (
    <div className="ceo-page">
      <PageHead title="Cancellations" desc="Orders cancelled, why, and at which stage the pieces were when they came off the floor." />
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
