import React, { useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import formatDate from "../../utils/formatDate";

/**
 * CommsReports — 3 CSV exports keyed off a month picker.
 *
 *  A) Agency & Individual — orders where engagement_type is NOT Personal order.
 *     Columns: S.No, Order date, Order ID, Delivery date, Engagement type,
 *     Purpose, Recipient name (profile/agency), Qty, Product name, Size,
 *     Address, Contact, Challan no., Return status (sourcing only).
 *
 *  B) Private (Personal) — orders where engagement_type === 'Personal order'.
 *     Columns: S.No, Order date, Order ID, Delivery date, Dispatch date, Name,
 *     Qty, Product name, Size, MRP, Discount %, Discount amount, Advance,
 *     Mode of delivery, Address, Contact, Delivery status.
 *
 *  C) PR Performance — aggregate counts: total PR orders, split by engagement
 *     type, outfit used / not used, impact buckets, est. reach total,
 *     est. impressions total. Reads from orders + comms_pr_performance.
 *
 * All three respect the selected month (uses created_at; "All time" option
 * also supported for the agency/private reports). Pattern mirrors the GM/Admin
 * CSV export utility: build header + rows, UTF-8 BOM, blob download.
 */

// Build "MMM YYYY" labels for the last 12 months + Current month + All time.
const buildMonthOptions = () => {
  const options = [{ value: "all", label: "All time" }];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("en-IN", { month: "long", year: "numeric" });
    options.push({ value, label });
  }
  return options;
};

const csvEscape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

const downloadCsv = (filename, headers, rows) => {
  const csv = [headers.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export default function CommsReports({ orders, showPopup }) {
  const monthOptions = useMemo(buildMonthOptions, []);
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[1]?.value || "all"); // default = current month
  const [prLoading, setPrLoading] = useState(false);

  // Filter helper — orders within selected month (created_at).
  // "all" = no filter.
  const ordersInPeriod = useMemo(() => {
    if (selectedMonth === "all") return orders;
    return orders.filter((o) => {
      if (!o.created_at) return false;
      const d = new Date(o.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return key === selectedMonth;
    });
  }, [orders, selectedMonth]);

  // Recipient name for Agency/Individual report — agency_name when Agency,
  // else fallback to client name.
  const recipientName = (o) =>
    o.comms_request_source === "Agency"
      ? (o.comms_agency_name || o.delivery_name || "—")
      : (o.delivery_name || "—");

  // ─── Report A: Agency & Individual ───
  const handleExportAgency = () => {
    const rows = [];
    const filtered = ordersInPeriod.filter((o) => o.comms_engagement_type !== "Personal order");
    if (filtered.length === 0) {
      showPopup({
        title: "Nothing to export",
        message: "No agency/individual orders in the selected period.",
        type: "warning",
      });
      return;
    }
    let serial = 1;
    filtered.forEach((o) => {
      const items = o.items || [];
      // One CSV row per line item (matches the spec's "per product" reporting).
      // If no items somehow, emit one row with empty product fields so the
      // order still appears.
      const rowItems = items.length > 0 ? items : [{}];
      rowItems.forEach((item) => {
        rows.push([
          serial++,
          o.created_at ? formatDate(o.created_at) : "",
          o.order_no || "",
          o.delivery_date ? formatDate(o.delivery_date) : "",
          o.comms_engagement_type || "",
          o.comms_purpose || "",
          recipientName(o),
          item.quantity || (item.product_name ? 1 : ""),
          item.product_name || "",
          item.size || "",
          o.delivery_address || "",
          o.delivery_phone || "",
          o.comms_challan_no || "",
          o.comms_engagement_type === "Sourcing" ? (o.comms_return_status || "Pending") : "",
        ]);
      });
    });
    downloadCsv(
      `comms_agency_individual_${selectedMonth}.csv`,
      ["S.No", "Order Date", "Order ID", "Delivery Date", "Engagement Type", "Purpose", "Recipient", "Qty", "Product Name", "Size", "Address", "Contact", "Challan No", "Return Status"],
      rows
    );
  };

  // ─── Report B: Private (Personal) Orders ───
  const handleExportPrivate = () => {
    const rows = [];
    const filtered = ordersInPeriod.filter((o) => o.comms_engagement_type === "Personal order");
    if (filtered.length === 0) {
      showPopup({
        title: "Nothing to export",
        message: "No personal orders in the selected period.",
        type: "warning",
      });
      return;
    }
    let serial = 1;
    filtered.forEach((o) => {
      const items = o.items || [];
      const rowItems = items.length > 0 ? items : [{}];
      rowItems.forEach((item) => {
        const mrp = item.price || 0;
        rows.push([
          serial++,
          o.created_at ? formatDate(o.created_at) : "",
          o.order_no || "",
          o.delivery_date ? formatDate(o.delivery_date) : "",
          o.dispatched_at ? formatDate(o.dispatched_at) : "",
          o.delivery_name || "",
          item.quantity || (item.product_name ? 1 : ""),
          item.product_name || "",
          item.size || "",
          mrp,
          o.discount_percent || 0,
          o.discount_amount || 0,
          o.advance_payment || 0,
          o.mode_of_delivery || "",
          o.delivery_address || "",
          o.delivery_phone || "",
          o.status || "",
        ]);
      });
    });
    downloadCsv(
      `comms_private_${selectedMonth}.csv`,
      ["S.No", "Order Date", "Order ID", "Delivery Date", "Dispatch Date", "Name", "Qty", "Product Name", "Size", "MRP", "Discount %", "Discount Amount", "Advance", "Mode of Delivery", "Address", "Contact", "Delivery Status"],
      rows
    );
  };

  // ─── Report C: PR Performance ───
  // Needs to read comms_pr_performance for the period's orders. PR data is
  // OPTIONAL per-order — orders without a PR row contribute to the "total
  // PR orders" count but not to outfit-used / impact / reach totals.
  const handleExportPrPerformance = async () => {
    setPrLoading(true);
    try {
      // Restrict to PR-eligible orders: not Personal, must be delivered or returned.
      const eligible = ordersInPeriod.filter((o) =>
        o.comms_engagement_type && o.comms_engagement_type !== "Personal order"
      );
      if (eligible.length === 0) {
        showPopup({
          title: "Nothing to export",
          message: "No PR-eligible orders in the selected period.",
          type: "warning",
        });
        return;
      }

      // Fetch PR records for these orders.
      const orderIds = eligible.map((o) => o.id);
      const { data: prRows, error: prErr } = await supabase
        .from("comms_pr_performance")
        .select("*")
        .in("order_id", orderIds);
      if (prErr) throw prErr;
      const prMap = {};
      (prRows || []).forEach((r) => { prMap[r.order_id] = r; });

      // Aggregate
      const byEngagement = { Barter: 0, Gifting: 0, Sourcing: 0 };
      let outfitUsed = 0;
      let outfitNotUsed = 0;
      let impactHigh = 0;
      let impactMed = 0;
      let impactLow = 0;
      let reachTotal = 0;
      let impressionsTotal = 0;
      eligible.forEach((o) => {
        if (byEngagement.hasOwnProperty(o.comms_engagement_type)) {
          byEngagement[o.comms_engagement_type] += 1;
        }
        const pr = prMap[o.id];
        if (!pr) return;
        if (pr.outfit_used === true) outfitUsed += 1;
        if (pr.outfit_used === false) outfitNotUsed += 1;
        if (pr.outcome_impact === "High") impactHigh += 1;
        if (pr.outcome_impact === "Medium") impactMed += 1;
        if (pr.outcome_impact === "Low") impactLow += 1;
        reachTotal += Number(pr.estimated_reach_number || 0);
        impressionsTotal += Number(pr.estimated_impressions || 0);
      });

      // One-row summary CSV — simple by design (PR reporting is mostly counts).
      // If you later want per-order rows, the data is here in `prMap`.
      const periodLabel = monthOptions.find((m) => m.value === selectedMonth)?.label || selectedMonth;
      const rows = [[
        periodLabel,
        eligible.length,
        byEngagement.Barter,
        byEngagement.Gifting,
        byEngagement.Sourcing,
        outfitUsed,
        outfitNotUsed,
        impactHigh,
        impactMed,
        impactLow,
        reachTotal,
        impressionsTotal,
      ]];
      downloadCsv(
        `comms_pr_performance_${selectedMonth}.csv`,
        ["Period", "Total PR Orders", "Barter", "Gifting", "Sourcing", "Outfit Used", "Outfit Not Used", "Impact: High", "Impact: Medium", "Impact: Low", "Estimated Total Reach", "Estimated Total Impressions"],
        rows
      );
    } catch (err) {
      console.error("PR Performance export failed:", err);
      showPopup({
        title: "Export failed",
        message: err.message || "Could not generate PR performance report.",
        type: "error",
      });
    } finally {
      setPrLoading(false);
    }
  };

  return (
    <>
      <div className="comms-card" style={{ marginBottom: 14 }}>
        <h3 className="comms-card-title">Period</h3>
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          style={{ padding: "10px 14px", border: "1px solid #D4D4D4", borderRadius: 8, fontSize: 14, background: "#fff", minWidth: 220 }}
        >
          {monthOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <p className="comms-muted" style={{ marginTop: 8 }}>
          {ordersInPeriod.length} comms order{ordersInPeriod.length !== 1 ? "s" : ""} in this period.
        </p>
      </div>

      <div className="comms-card">
        <h3 className="comms-card-title">Monthly Report — Agency & Individual</h3>
        <p className="comms-muted">Barter, Gifting, and Sourcing orders for the selected period. One row per line item.</p>
        <button className="comms-primary-btn" onClick={handleExportAgency}>Download CSV</button>
      </div>

      <div className="comms-card">
        <h3 className="comms-card-title">Monthly Report — Personal Orders</h3>
        <p className="comms-muted">Personal-order engagement type only. Captures MRP, discount, advance, and dispatch details.</p>
        <button className="comms-primary-btn" onClick={handleExportPrivate}>Download CSV</button>
      </div>

      <div className="comms-card">
        <h3 className="comms-card-title">PR Performance Report</h3>
        <p className="comms-muted">
          Aggregate counts: total PR orders, engagement split, outfit used/not used, impact buckets,
          estimated reach and impressions. Reads from the PR Performance form on each order.
        </p>
        <button className="comms-primary-btn" onClick={handleExportPrPerformance} disabled={prLoading}>
          {prLoading ? "Generating…" : "Download CSV"}
        </button>
      </div>
    </>
  );
}
