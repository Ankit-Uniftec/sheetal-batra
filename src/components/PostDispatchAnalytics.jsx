import React, { useMemo } from "react";
import formatDate from "../utils/formatDate";
import formatIndianNumber from "../utils/formatIndianNumber";
import downloadCsv from "../utils/downloadCsv";
import { summarisePostDispatch, postDispatchLabel } from "../utils/postDispatch";

// Post Dispatch Action analytics (point #1). Uses the Analytics tab's period.

const money = (n) => `₹${formatIndianNumber(Math.round(n || 0))}`;
const CELL = { padding: "8px 12px", textAlign: "left" };
const NUM = { ...CELL, textAlign: "right" };

function Split({ title, items }) {
  return (
    <div className="merch-ios-card" style={{ padding: 0, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f9f5eb" }}>
            <th style={CELL}>{title}</th><th style={NUM}>Actions</th><th style={NUM}>Order value</th>
          </tr>
        </thead>
        <tbody>
          {items.map((x) => (
            <tr key={x.key} style={{ borderTop: "1px solid #eee" }}>
              <td style={CELL}>{x.key}</td><td style={NUM}>{x.count}</td><td style={NUM}>{money(x.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PostDispatchAnalytics({ actions, orders, vendorMap, inPeriod }) {
  const s = useMemo(() => {
    const ordersById = Object.fromEntries((orders || []).map((o) => [o.id, o]));
    return summarisePostDispatch((actions || []).filter((a) => inPeriod(a.created_at)), ordersById, vendorMap);
  }, [actions, orders, vendorMap, inPeriod]);

  const exportCsv = () => downloadCsv({
    filename: "post_dispatch_actions",
    headers: ["Date", "Order No", "PO", "Partner", "Merchandiser", "Action", "QC failure", "Files", "Order value", "Recorded by"],
    rows: s.rows.map((r) => [formatDate(r.created_at), r.order_no, r.po, r.partner, r.merchandiser, postDispatchLabel(r.action_type),
      r.note, (r.files || []).length, r.value, r.created_by]),
  });

  return (
    <div style={{ marginTop: 24 }}>
      <div className="merch-ios-card" style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>
          Post Dispatch Actions: {s.count} on {s.orders} orders · {money(s.value)} order value
        </span>
        <button type="button" onClick={exportCsv} disabled={!s.count}>Download CSV</button>
      </div>
      {s.count === 0 ? (
        <div className="merch-ios-card" style={{ textAlign: "center", color: "#999", padding: 24 }}>No post dispatch actions in this period.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
          <Split title="Action" items={s.byType} />
          <Split title="Partner" items={s.byPartner} />
          <Split title="Merchandiser" items={s.byMerchandiser} />
        </div>
      )}
    </div>
  );
}
