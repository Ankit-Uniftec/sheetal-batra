import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabaseClient";
import formatDate from "../../utils/formatDate";

/**
 * CommsPRPerformance — per-order PR tracking.
 *
 * Eligible orders: Gifting / Barter / Sourcing (NOT Personal — those are
 * paid retail through a comms channel and don't need PR tracking). Per the
 * spec, PR tracking is intended for orders that have been delivered or for
 * sourcing orders where the return is in progress.
 *
 * UI:
 *   - List of eligible orders.
 *   - Each row shows whether a PR record exists ("Captured" / "Not captured").
 *   - Click "Edit" → opens a modal with the full PR form.
 *
 * Storage: comms_pr_performance table. UNIQUE(order_id) on the schema, so
 * we upsert by order_id.
 */

const COVERAGE_TYPES = [
  "IG Post",
  "IG Story",
  "Reel",
  "Event Appearance",
  "Editorial",
  "Magazine",
  "Others",
];

const REACH_OPTIONS = ["", "High", "Medium", "Low"];
const IMPACT_OPTIONS = ["", "High", "Medium", "Low"];
const DELIVERABLE_OPTIONS = ["", "Yes", "No", "Partial"];

export default function CommsPRPerformance({ orders, showPopup }) {
  // PR rows keyed by order_id for O(1) lookup.
  const [prRecords, setPrRecords] = useState({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // { order, record }

  // List filters
  const [search, setSearch] = useState("");
  const [engagementFilter, setEngagementFilter] = useState("all");
  const [capturedFilter, setCapturedFilter] = useState("all");

  // Eligible orders (Barter / Gifting / Sourcing) — skip Personal.
  const eligibleOrders = useMemo(
    () => orders.filter((o) =>
      o.comms_engagement_type &&
      o.comms_engagement_type !== "Personal order" &&
      o.approval_status !== "pending_approval" &&
      o.approval_status !== "rejected"
    ),
    [orders]
  );

  // Load existing PR records once.
  useEffect(() => {
    let cancelled = false;
    const loadPr = async () => {
      const ids = eligibleOrders.map((o) => o.id);
      if (ids.length === 0) { setLoading(false); return; }
      const { data } = await supabase
        .from("comms_pr_performance")
        .select("*")
        .in("order_id", ids);
      if (cancelled) return;
      const map = {};
      (data || []).forEach((r) => { map[r.order_id] = r; });
      setPrRecords(map);
      setLoading(false);
    };
    loadPr();
    return () => { cancelled = true; };
  }, [eligibleOrders]);

  // Distinct engagement types present in the data (for the dropdown).
  const engagementOptions = useMemo(
    () => [...new Set(eligibleOrders.map((o) => o.comms_engagement_type).filter(Boolean))],
    [eligibleOrders]
  );

  const visibleOrders = useMemo(() => {
    let list = eligibleOrders;
    if (engagementFilter !== "all") list = list.filter((o) => o.comms_engagement_type === engagementFilter);
    if (capturedFilter === "captured") list = list.filter((o) => prRecords[o.id]);
    else if (capturedFilter === "not_captured") list = list.filter((o) => !prRecords[o.id]);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((o) =>
        (o.order_no || "").toLowerCase().includes(q) ||
        (o.delivery_name || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [eligibleOrders, prRecords, search, engagementFilter, capturedFilter]);

  // Edit opens the shared PrEditModal below (also used by the new Comms
  // dashboard), so a PR record is saved the same way everywhere.
  const openEdit = (order) => setEditing({ order, record: prRecords[order.id] || null });

  if (loading) {
    return <div className="comms-card"><p className="comms-muted">Loading PR records…</p></div>;
  }

  if (eligibleOrders.length === 0) {
    return (
      <div className="comms-card">
        <p className="comms-muted">
          No PR-eligible orders yet. PR tracking applies to Gifting, Barter, and Sourcing orders.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="comms-card">
        <h3 className="comms-card-title">PR Performance Tracking</h3>
        <p className="comms-muted">
          One PR record per order. Click <strong>Edit</strong> to capture coverage details after the celebrity/influencer/agency uses the outfit.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          <input
            type="text"
            className="comms-search"
            style={{ maxWidth: 280 }}
            placeholder="Search order no or client..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            value={engagementFilter}
            onChange={(e) => setEngagementFilter(e.target.value)}
            style={filterSelectStyle}
          >
            <option value="all">All Engagements</option>
            {engagementOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            value={capturedFilter}
            onChange={(e) => setCapturedFilter(e.target.value)}
            style={filterSelectStyle}
          >
            <option value="all">All PR Statuses</option>
            <option value="captured">Captured</option>
            <option value="not_captured">Not captured</option>
          </select>
        </div>
        <table className="comms-table" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Order No</th>
              <th>Client</th>
              <th>Engagement</th>
              <th>Order Date</th>
              <th>PR Captured?</th>
              <th>Outfit Used?</th>
              <th>Impact</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visibleOrders.length === 0 && (
              <tr>
                <td colSpan="8" className="comms-muted" style={{ textAlign: "center", padding: 18 }}>
                  No orders match your search / filters.
                </td>
              </tr>
            )}
            {visibleOrders.map((o) => {
              const r = prRecords[o.id];
              const outfitUsedLabel = r?.outfit_used === true ? "Yes"
                : r?.outfit_used === false ? "No"
                : "—";
              return (
                <tr key={o.id}>
                  <td><span className="comms-mono">{o.order_no || "—"}</span></td>
                  <td>{o.delivery_name || "—"}</td>
                  <td>{o.comms_engagement_type}</td>
                  <td>{o.created_at ? formatDate(o.created_at) : "—"}</td>
                  <td>
                    <span style={{
                      padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600,
                      background: r ? "rgba(46,125,50,0.12)" : "rgba(198,40,40,0.1)",
                      color: r ? "#2e7d32" : "#c62828",
                    }}>
                      {r ? "Captured" : "Not captured"}
                    </span>
                  </td>
                  <td>{outfitUsedLabel}</td>
                  <td>{r?.outcome_impact || "—"}</td>
                  <td>
                    <button
                      onClick={() => openEdit(o)}
                      style={{
                        background: "#d5b85a", color: "#fff", border: "none",
                        borderRadius: 6, padding: "5px 14px", fontSize: 12,
                        fontWeight: 600, cursor: "pointer",
                      }}
                    >Edit</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      {editing && (
        <PrEditModal
          order={editing.order}
          record={editing.record}
          showPopup={showPopup}
          onClose={() => setEditing(null)}
          onSaved={(row) => setPrRecords((prev) => ({ ...prev, [row.order_id]: row }))}
        />
      )}
    </>
  );
}

// Small helper for label+control pairs in the modal.
function PrField({ label, children, style }) {
  return (
    <div style={style}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 5 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const filterSelectStyle = {
  padding: "8px 12px",
  border: "1px solid #d4d4d4",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
  background: "#fff",
  color: "#333",
};

const modalInputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #d4d4d4",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "inherit",
  background: "#fff",
  color: "#333",
};


/**
 * Capture or update the PR record for one order: outfit used, deliverables,
 * coverage, reach, impressions, remarks and impact (comms_pr_performance,
 * one row per order). Drawn over the whole window so any dashboard can open it.
 */
export function PrEditModal({ order, record = null, showPopup, onClose, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [outfitUsed, setOutfitUsed] = useState(record?.outfit_used === true ? "Yes" : record?.outfit_used === false ? "No" : "");
  const [deliverablesReceived, setDeliverablesReceived] = useState(record?.deliverables_received || "");
  const [coverageType, setCoverageType] = useState(record?.coverage_type || []);
  const [coverageLinks, setCoverageLinks] = useState((record?.coverage_links || []).join("\n"));
  const [estimatedReach, setEstimatedReach] = useState(record?.estimated_reach || "");
  const [estimatedReachNumber, setEstimatedReachNumber] = useState(record?.estimated_reach_number || "");
  const [estimatedImpressions, setEstimatedImpressions] = useState(record?.estimated_impressions || "");
  const [remarks, setRemarks] = useState(record?.remarks || "");
  const [outcomeImpact, setOutcomeImpact] = useState(record?.outcome_impact || "");

  const closeEdit = () => {
    if (saving) return;
    onClose();
  };

  const toggleCoverage = (type) => {
    setCoverageType((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Parse coverage_links from newline-separated text into array.
      const linksArray = coverageLinks
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      // Map outfit_used "Yes"/"No"/"" → boolean | null
      const outfitUsedValue = outfitUsed === "Yes" ? true : outfitUsed === "No" ? false : null;

      const payload = {
        order_id: order.id,
        outfit_used: outfitUsedValue,
        deliverables_received: deliverablesReceived || null,
        coverage_type: coverageType.length > 0 ? coverageType : null,
        coverage_links: linksArray.length > 0 ? linksArray : null,
        coverage_images: record?.coverage_images || null, // image upload UI TBD
        estimated_reach: estimatedReach || null,
        estimated_reach_number: estimatedReachNumber ? Number(estimatedReachNumber) : null,
        estimated_impressions: estimatedImpressions ? Number(estimatedImpressions) : null,
        remarks: remarks.trim() || null,
        outcome_impact: outcomeImpact || null,
      };

      const { data, error } = await supabase
        .from("comms_pr_performance")
        .upsert(payload, { onConflict: "order_id" })
        .select()
        .single();
      if (error) throw error;

      onSaved(data);
      onClose();
      showPopup({
        title: "PR data saved",
        message: `PR performance for ${order.order_no} updated.`,
        type: "success",
        confirmText: "OK",
      });
    } catch (err) {
      console.error("PR save failed:", err);
      showPopup({
        title: "Save failed",
        message: err.message || "Could not save PR data.",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
          }}
          onClick={closeEdit}
        >
          <div
            style={{
              background: "#fff", borderRadius: 12, padding: 24,
              width: "92%", maxWidth: 600, maxHeight: "90vh", overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, color: "#d5b85a" }}>PR Performance — {order.order_no}</h3>
            <p style={{ fontSize: 13, color: "#555" }}>
              <strong>Client:</strong> {order.delivery_name || "—"} · <strong>Engagement:</strong> {order.comms_engagement_type}
            </p>

            <div className="cro-grid-2" style={{ marginTop: 16 }}>
              <PrField label="Outfit Used?">
                <select value={outfitUsed} onChange={(e) => setOutfitUsed(e.target.value)} style={modalInputStyle}>
                  <option value="">—</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </PrField>

              <PrField label="Deliverables Received?">
                <select value={deliverablesReceived} onChange={(e) => setDeliverablesReceived(e.target.value)} style={modalInputStyle}>
                  {DELIVERABLE_OPTIONS.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
                </select>
              </PrField>
            </div>

            <PrField label="Type of Coverage (multi-select)" style={{ marginTop: 14 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {COVERAGE_TYPES.map((t) => {
                  const checked = coverageType.includes(t);
                  return (
                    <button
                      type="button"
                      key={t}
                      onClick={() => toggleCoverage(t)}
                      style={{
                        padding: "5px 12px", borderRadius: 14, fontSize: 12, fontWeight: 500,
                        border: `1px solid ${checked ? "#d5b85a" : "#d4d4d4"}`,
                        background: checked ? "#d5b85a" : "#fff",
                        color: checked ? "#fff" : "#555",
                        cursor: "pointer",
                      }}
                    >{t}</button>
                  );
                })}
              </div>
            </PrField>

            <PrField label="Coverage Links (one per line)" style={{ marginTop: 14 }}>
              <textarea
                rows={3}
                placeholder="https://instagram.com/p/...&#10;https://vogue.in/..."
                value={coverageLinks}
                onChange={(e) => setCoverageLinks(e.target.value)}
                style={{ ...modalInputStyle, resize: "vertical" }}
              />
            </PrField>

            <div className="cro-grid-2" style={{ marginTop: 14 }}>
              <PrField label="Estimated Reach (bucket)">
                <select value={estimatedReach} onChange={(e) => setEstimatedReach(e.target.value)} style={modalInputStyle}>
                  {REACH_OPTIONS.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
                </select>
              </PrField>

              <PrField label="Estimated Reach (number)">
                <input
                  type="number"
                  min="0"
                  value={estimatedReachNumber}
                  onChange={(e) => setEstimatedReachNumber(e.target.value)}
                  placeholder="e.g. 250000"
                  style={modalInputStyle}
                />
              </PrField>

              <PrField label="Estimated Impressions">
                <input
                  type="number"
                  min="0"
                  value={estimatedImpressions}
                  onChange={(e) => setEstimatedImpressions(e.target.value)}
                  placeholder="e.g. 500000"
                  style={modalInputStyle}
                />
              </PrField>

              <PrField label="Outcome Impact">
                <select value={outcomeImpact} onChange={(e) => setOutcomeImpact(e.target.value)} style={modalInputStyle}>
                  {IMPACT_OPTIONS.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
                </select>
              </PrField>
            </div>

            <PrField label="Remarks" style={{ marginTop: 14 }}>
              <textarea
                rows={3}
                placeholder="Any context for this PR engagement…"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                style={{ ...modalInputStyle, resize: "vertical" }}
              />
            </PrField>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button
                disabled={saving}
                onClick={closeEdit}
                style={{ padding: "8px 16px", border: "1px solid #d4d4d4", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 13 }}
              >Cancel</button>
              <button
                disabled={saving}
                onClick={handleSave}
                style={{
                  padding: "8px 16px", border: "none", borderRadius: 6,
                  background: "#d5b85a", color: "#fff",
                  cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600,
                  opacity: saving ? 0.6 : 1,
                }}
              >{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
  , document.body);
}
