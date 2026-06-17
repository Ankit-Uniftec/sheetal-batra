import { supabase } from "../lib/supabaseClient";

/**
 * ExhibitionService — all Supabase interactions for the Exhibition feature.
 *
 * Lifecycle: pending_approval → active (on approve) | rejected (on reject).
 * Editing an active exhibition sends it back to pending_approval (rule 7).
 * Commission split is per-exhibition and INTERNAL (never on customer docs).
 */

export const EXHIBITION_STATUS = {
  PENDING: "pending_approval",
  ACTIVE: "active",
  REJECTED: "rejected",
};

// Net SB revenue from a gross order value + an exhibition's commission %.
//   Net = gross * (1 - split/100)
export function netSbRevenue(grossValue, commissionSplit) {
  const gross = Number(grossValue) || 0;
  const split = Number(commissionSplit) || 0;
  return gross * (1 - split / 100);
}

// Gross value of a single order (the headline value used across dashboards).
function orderGross(o) {
  return Number(o?.net_total ?? o?.grand_total_after_discount ?? o?.grand_total ?? 0) || 0;
}

// Total Net SB Revenue across a list of orders, for managerial dashboards.
// Exhibition orders contribute their stored net_sb_revenue (gross minus the
// exhibition's commission); all other orders contribute their full gross
// (net == gross when there's no commission). One consistent number everywhere.
export function totalNetSbRevenue(orders) {
  return (orders || []).reduce((sum, o) => {
    if (o?.exhibition_id) {
      // Use stored net; fall back to gross if net wasn't computed for some reason.
      return sum + (o.net_sb_revenue != null ? Number(o.net_sb_revenue) : orderGross(o));
    }
    return sum + orderGross(o);
  }, 0);
}

// Create a new exhibition (status starts pending_approval). Created by the
// exhibition SA. All fields mandatory — validation is enforced in the form.
export async function createExhibition(fields, createdBy) {
  const { data, error } = await supabase
    .from("exhibitions")
    .insert({
      name: fields.name.trim(),
      country: fields.country.trim(),
      location: fields.location.trim(),
      company_name: fields.companyName.trim(),
      start_date: fields.startDate,
      end_date: fields.endDate,
      sb_representative: fields.sbRepresentative.trim(),
      commission_split: Number(fields.commissionSplit),
      status: EXHIBITION_STATUS.PENDING,
      created_by: createdBy,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Edit an exhibition. Per rule 7, editing an ACTIVE exhibition resets it to
// pending_approval (clearing the prior approval). Pending/rejected edits just
// update in place.
export async function updateExhibition(id, fields, currentStatus) {
  const patch = {
    name: fields.name.trim(),
    country: fields.country.trim(),
    location: fields.location.trim(),
    company_name: fields.companyName.trim(),
    start_date: fields.startDate,
    end_date: fields.endDate,
    sb_representative: fields.sbRepresentative.trim(),
    commission_split: Number(fields.commissionSplit),
  };
  // Any edit to an active exhibition → back to pending approval.
  if (currentStatus === EXHIBITION_STATUS.ACTIVE) {
    patch.status = EXHIBITION_STATUS.PENDING;
    patch.approved_by = null;
    patch.approved_at = null;
  }
  const { data, error } = await supabase
    .from("exhibitions")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Approve (Anushree/Sheetal) → active. Only acts on pending rows.
export async function approveExhibition(id, approvedBy) {
  const { data, error } = await supabase
    .from("exhibitions")
    .update({
      status: EXHIBITION_STATUS.ACTIVE,
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
      rejected_reason: null,
    })
    .eq("id", id)
    .eq("status", EXHIBITION_STATUS.PENDING)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Reject (Anushree/Sheetal) with a reason. Only acts on pending rows.
export async function rejectExhibition(id, rejectedBy, reason) {
  const { data, error } = await supabase
    .from("exhibitions")
    .update({
      status: EXHIBITION_STATUS.REJECTED,
      approved_by: rejectedBy,
      approved_at: new Date().toISOString(),
      rejected_reason: reason || null,
    })
    .eq("id", id)
    .eq("status", EXHIBITION_STATUS.PENDING)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// All exhibitions created by a given SA (their dashboard view).
export async function fetchExhibitionsByCreator(createdBy) {
  const { data, error } = await supabase
    .from("exhibitions")
    .select("*")
    .eq("created_by", createdBy)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

// Active exhibitions only (for the order-creation picker).
export async function fetchActiveExhibitions(createdBy = null) {
  let q = supabase
    .from("exhibitions")
    .select("*")
    .eq("status", EXHIBITION_STATUS.ACTIVE)
    .order("name", { ascending: true });
  if (createdBy) q = q.eq("created_by", createdBy);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

// Pending approvals (Anushree/Sheetal review queue).
export async function fetchPendingExhibitions() {
  const { data, error } = await supabase
    .from("exhibitions")
    .select("*")
    .eq("status", EXHIBITION_STATUS.PENDING)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

// All exhibitions (managerial/overview use).
export async function fetchAllExhibitions() {
  const { data, error } = await supabase
    .from("exhibitions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}
