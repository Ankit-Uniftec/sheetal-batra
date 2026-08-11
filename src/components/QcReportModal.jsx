import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import QcHistoryTable from "./QcHistoryTable";
import "./QcReportModal.css";

/**
 * QcReportModal — every QC check (QC 1 + Final QC) recorded against ONE order's
 * pieces, oldest first so the report reads as that order's QC story.
 *
 * Extracted from the identical inline modals that WarehouseDashboard (retail PH)
 * and ShopifyOrdersDashboard had each hand-rolled: same query, same shell, same
 * QcHistoryTable body. One implementation now, so a rule change lands everywhere
 * — matching how ComponentJourneyModal is shared across the same dashboards.
 *
 * Fetches its own records (like ComponentJourneyModal does), so a caller only
 * has to hold the order it wants to open.
 *
 * Always safe to open even before any QC has happened — the empty state says so,
 * and "has this been checked yet?" is itself the question being asked.
 *
 * @param {string|number} orderId  orders.id whose qc_records to load
 * @param {string}        orderNo  order number for the modal title
 * @param {Function}      onClose  close handler
 */
export default function QcReportModal({ orderId, orderNo, onClose }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("qc_records")
          .select("id, barcode, component_id, result, which_qc, fail_reason, outcome, rejourney_number, scrap_loss_amount, scrap_location, inspected_by, created_at")
          .eq("order_id", orderId)
          .order("created_at", { ascending: true });
        if (error) throw error;
        if (!cancelled) setRecords(data || []);
      } catch (err) {
        console.error("Failed to load QC report:", err);
        if (!cancelled) setRecords([]);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [orderId]);

  return (
    <div className="qcr-overlay" onClick={onClose}>
      <div className="qcr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="qcr-head">
          <h3 className="qcr-title">QC Report — {orderNo}</h3>
          <button className="qcr-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="qcr-body">
          <QcHistoryTable
            records={records}
            loading={loading}
            emptyText="No QC checks recorded for this order yet."
          />
        </div>
      </div>
    </div>
  );
}
