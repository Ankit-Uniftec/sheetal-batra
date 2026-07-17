import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { usePopup } from "./Popup";
import Badge from "./Badge";
import formatIndianNumber from "../utils/formatIndianNumber";
import { supabase } from "../lib/supabaseClient";
import { fetchAllRows } from "../utils/fetchAllRows";
import {
  EXHIBITION_STATUS,
  netSbRevenue,
  createExhibition,
  updateExhibition,
  fetchExhibitionsByCreator,
} from "../utils/exhibitionService";
import "./ExhibitionPanel.css";

const EMPTY_FORM = {
  name: "", country: "", location: "", companyName: "",
  startDate: "", endDate: "", sbRepresentative: "", commissionSplit: "",
};

const STATUS_BADGE = {
  [EXHIBITION_STATUS.ACTIVE]: { variant: "success", label: "Active" },
  [EXHIBITION_STATUS.PENDING]: { variant: "warning", label: "Pending Approval" },
  [EXHIBITION_STATUS.REJECTED]: { variant: "danger", label: "Rejected" },
};

/**
 * ExhibitionPanel — the Exhibition SA's view (store = Exhibition).
 * New Exhibition form + summary cards + the SA's exhibitions list.
 * Editing an active exhibition sends it back to Pending Approval (rule 7).
 */
const ExhibitionPanel = ({ currentUserEmail }) => {
  const { showPopup, PopupComponent } = usePopup();
  const navigate = useNavigate();

  const [exhibitions, setExhibitions] = useState([]);
  const [orders, setOrders] = useState([]);
  // Time window for the order-derived summary cards (Total Orders, Total
  // Clients, Gross/Net Revenue). "all" = no filter. Exhibition counts
  // (Active / Pending Approvals) are status-based and ignore this.
  const [period, setPeriod] = useState("all"); // all | week | month | year
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingStatus, setEditingStatus] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!currentUserEmail) return;
    try {
      const exbs = await fetchExhibitionsByCreator(currentUserEmail);
      setExhibitions(exbs || []);
      // Orders linked to these exhibitions (for the summary cards).
      const ids = (exbs || []).map((e) => e.id);
      if (ids.length > 0) {
        // Paged past Supabase's 1000-row cap
        const { data: ords, error: ordErr } = await fetchAllRows("orders", (q) => q
          .select("id, exhibition_id, created_at, net_total, grand_total_after_discount, grand_total, user_id, delivery_phone")
          .in("exhibition_id", ids));
        // Surface (don't swallow) a failed orders fetch — otherwise the summary
        // cards silently read as 0 when the query errors.
        if (ordErr) {
          console.error("Exhibition orders fetch failed:", ordErr);
        }
        setOrders(ords || []);
      } else {
        setOrders([]);
      }
    } catch (e) {
      console.error("Failed to load exhibitions:", e);
    }
  }, [currentUserEmail]);

  useEffect(() => { load(); }, [load]);

  // ---- Summary cards (point 8) ----
  const stats = useMemo(() => {
    const commissionByExb = {};
    exhibitions.forEach((e) => { commissionByExb[e.id] = e.commission_split; });

    // Exhibition counts are status-based — not affected by the time filter.
    const activeCount = exhibitions.filter((e) => e.status === EXHIBITION_STATUS.ACTIVE).length;
    const pendingCount = exhibitions.filter((e) => e.status === EXHIBITION_STATUS.PENDING).length;

    // Period cutoff for the order-derived cards. null => no filter ("all").
    let cutoff = null;
    if (period !== "all") {
      const d = new Date();
      if (period === "week") d.setDate(d.getDate() - 7);
      else if (period === "month") d.setMonth(d.getMonth() - 1);
      else if (period === "year") d.setFullYear(d.getFullYear() - 1);
      cutoff = d.getTime();
    }

    const periodOrders = cutoff === null
      ? orders
      : orders.filter((o) => o.created_at && new Date(o.created_at).getTime() >= cutoff);

    let gross = 0, net = 0;
    const clientKeys = new Set();
    periodOrders.forEach((o) => {
      const val = o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0;
      gross += Number(val) || 0;
      net += netSbRevenue(val, commissionByExb[o.exhibition_id] || 0);
      // distinct client by best-available identifier
      const key = o.user_id || o.delivery_phone;
      if (key) clientKeys.add(key);
    });

    return {
      activeExhibitions: activeCount,
      totalOrders: periodOrders.length,
      totalClients: clientKeys.size,
      grossRevenue: gross,
      netSbRevenue: net,
      pendingApprovals: pendingCount,
    };
  }, [exhibitions, orders, period]);

  // Point 5: start an order from an ACTIVE exhibition. We stash the exhibition
  // context in sessionStorage so the order flow (a) skips OTP and (b) attaches
  // exhibition_id (+ commission) to the order on submit.
  //
  // IMPORTANT: like every other order-entry path (regular + stock), we MUST seed
  // `associateSession` and `currentSalesperson` here. The downstream screens use
  // them as auth/return context — ProductForm's Back handler reads
  // `associateSession`, OrderDetails requires `currentSalesperson` — and without
  // them a Back/Continue bounces to the dashboard and the role re-check signs the
  // user out. (This was the exhibition "logout on Continue/Back" bug.)
  const startExhibitionOrder = async (exb) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        sessionStorage.setItem("associateSession", JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          user: { email: session.user?.email },
        }));
      }

      // Full salesperson record for `currentSalesperson` (name/phone/store/role).
      const { data: sp } = await supabase
        .from("salesperson")
        .select("saleperson, email, phone, store_name, designation, role")
        .eq("email", (currentUserEmail || "").toLowerCase())
        .single();
      if (sp) {
        sessionStorage.setItem("currentSalesperson", JSON.stringify({
          name: sp.saleperson,
          email: sp.email,
          phone: sp.phone,
          store: sp.store_name,
          designation: sp.designation,
          role: sp.role,
        }));
      }
      sessionStorage.setItem("returnToAssociate", "true");
    } catch (e) {
      console.error("Exhibition order session setup failed:", e);
    }

    sessionStorage.setItem("exhibitionOrder", JSON.stringify({
      exhibition_id: exb.id,
      exhibition_name: exb.name,
      commission_split: exb.commission_split,
      sb_representative: exb.sb_representative,
    }));
    sessionStorage.removeItem("isStockOrder");
    navigate("/buyerVerification", { state: { fromAssociate: true, exhibition: true } });
  };

  const openNew = () => { setForm(EMPTY_FORM); setEditingId(null); setEditingStatus(null); setShowForm(true); };
  const openEdit = (exb) => {
    setForm({
      name: exb.name, country: exb.country, location: exb.location, companyName: exb.company_name,
      startDate: exb.start_date, endDate: exb.end_date, sbRepresentative: exb.sb_representative,
      commissionSplit: String(exb.commission_split),
    });
    setEditingId(exb.id); setEditingStatus(exb.status); setShowForm(true);
  };

  const validate = () => {
    for (const [k, v] of Object.entries(form)) {
      if (v === "" || v === null || v === undefined) return `All fields are mandatory (missing: ${k}).`;
    }
    const c = Number(form.commissionSplit);
    if (isNaN(c) || c < 0 || c > 100) return "Commission split must be between 0 and 100.";
    if (new Date(form.endDate) < new Date(form.startDate)) return "End date cannot be before start date.";
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) return showPopup({ title: "Required", message: err, type: "warning", confirmText: "OK" });
    setSubmitting(true);
    try {
      if (editingId) {
        await updateExhibition(editingId, form, editingStatus);
        showPopup({
          title: "Saved",
          message: editingStatus === EXHIBITION_STATUS.ACTIVE
            ? "Exhibition updated — moved back to Pending Approval for re-approval."
            : "Exhibition updated.",
          type: "success", confirmText: "OK",
        });
      } else {
        await createExhibition(form, currentUserEmail);
        showPopup({ title: "Submitted", message: "Exhibition submitted for approval.", type: "success", confirmText: "OK" });
      }
      setShowForm(false);
      load();
    } catch (e) {
      showPopup({ title: "Error", message: e.message || "Failed to save exhibition", type: "error", confirmText: "OK" });
    }
    setSubmitting(false);
  };

  const FIELD = (label, key, type = "text") => (
    <div className="exb-field">
      <label className="exb-label">{label} <span className="exb-req">*</span></label>
      <input
        className="exb-input"
        type={type}
        value={form[key]}
        onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
        placeholder={label}
      />
    </div>
  );

  return (
    <div className="exb-wrap">
      {PopupComponent}

      <div className="exb-header">
        <h2 className="exb-title">Exhibitions</h2>
        <button className="exb-new-btn" onClick={openNew}>+ New Exhibition</button>
      </div>

      {/* Period filter — applies to Total Orders / Clients / Revenue cards. */}
      <div className="exb-period">
        {[
          { k: "all", label: "All Time" },
          { k: "week", label: "This Week" },
          { k: "month", label: "This Month" },
          { k: "year", label: "This Year" },
        ].map((p) => (
          <button
            key={p.k}
            className={`exb-period-btn ${period === p.k ? "active" : ""}`}
            onClick={() => setPeriod(p.k)}
          >{p.label}</button>
        ))}
      </div>

      {/* Summary cards (point 8) */}
      <div className="exb-cards">
        <div className="exb-card"><span className="exb-card-val">{stats.activeExhibitions}</span><span className="exb-card-lbl">Active Exhibitions</span></div>
        <div className="exb-card"><span className="exb-card-val">{stats.totalOrders}</span><span className="exb-card-lbl">Total Orders</span></div>
        <div className="exb-card"><span className="exb-card-val">{stats.totalClients}</span><span className="exb-card-lbl">Total Clients</span></div>
        <div className="exb-card"><span className="exb-card-val">₹{formatIndianNumber(Math.round(stats.grossRevenue))}</span><span className="exb-card-lbl">Gross Revenue</span></div>
        <div className="exb-card"><span className="exb-card-val">₹{formatIndianNumber(Math.round(stats.netSbRevenue))}</span><span className="exb-card-lbl">Net SB Revenue</span></div>
        <div className="exb-card"><span className="exb-card-val">{stats.pendingApprovals}</span><span className="exb-card-lbl">Pending Approvals</span></div>
      </div>

      {/* Exhibition list */}
      <div className="exb-list">
        {exhibitions.length === 0 ? (
          <p className="exb-empty">No exhibitions yet. Click “+ New Exhibition” to create one.</p>
        ) : exhibitions.map((exb) => {
          const badge = STATUS_BADGE[exb.status] || { variant: "neutral", label: exb.status };
          return (
            <div key={exb.id} className="exb-row">
              <div className="exb-row-main">
                <div className="exb-row-name">{exb.name}</div>
                <div className="exb-row-meta">{exb.location}, {exb.country} · {exb.company_name}</div>
                <div className="exb-row-meta">{exb.start_date} → {exb.end_date} · Rep: {exb.sb_representative} · Commission: {exb.commission_split}%</div>
                {exb.status === EXHIBITION_STATUS.REJECTED && exb.rejected_reason && (
                  <div className="exb-row-reject">Rejected: {exb.rejected_reason}</div>
                )}
              </div>
              <div className="exb-row-actions">
                <Badge variant={badge.variant}>{badge.label}</Badge>
                <div className="exb-row-btns">
                  {exb.status === EXHIBITION_STATUS.ACTIVE && (
                    <button className="exb-order-btn" onClick={() => startExhibitionOrder(exb)}>+ New Order</button>
                  )}
                  <button className="exb-edit-btn" onClick={() => openEdit(exb)}>Edit</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* New / Edit form modal */}
      {showForm && (
        <div className="exb-modal-overlay" onClick={() => setShowForm(false)}>
          <div className="exb-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="exb-modal-title">{editingId ? "Edit Exhibition" : "New Exhibition"}</h3>
            {editingId && editingStatus === EXHIBITION_STATUS.ACTIVE && (
              <p className="exb-edit-note">Editing an active exhibition will move it back to Pending Approval.</p>
            )}
            <div className="exb-form-grid">
              {FIELD("Exhibition Name", "name")}
              {FIELD("Country", "country")}
              {FIELD("Location", "location")}
              {FIELD("Exhibitor / Company Name", "companyName")}
              {FIELD("Start Date", "startDate", "date")}
              {FIELD("End Date", "endDate", "date")}
              {FIELD("SB Representative Name", "sbRepresentative")}
              {FIELD("Revenue Commission Split (%)", "commissionSplit", "number")}
            </div>
            <div className="exb-modal-actions">
              <button className="exb-cancel-btn" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="exb-submit-btn" onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Saving…" : (editingId ? "Save" : "Submit for Approval")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExhibitionPanel;
