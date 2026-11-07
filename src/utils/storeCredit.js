import { supabase } from "../lib/supabaseClient";

// ============================================================
// Store credit, through the database (db/meeting_points/r31_01).
//
// The database is the only place a balance changes: it adds to the client's
// real balance (never a figure remembered by an open page), allows each order's
// credit only once, and takes credit used off in the same moment an order is
// saved. Credit used to be added and taken off by the browser, and an order
// whose last steps never ran kept its credit while the balance stayed the same.
//
// Until r31_01 is run, these fall back to the old browser steps so nothing
// breaks; once it is run, the fallbacks are never reached.
// ============================================================

const isMissing = (error) => {
  const text = `${error?.code || ""} ${error?.message || ""}`;
  return /PGRST202|PGRST205|42883|42P01|does not exist|Could not find the (function|table)/i.test(text);
};

const twelveMonthsFromToday = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 12);
  return d.toISOString().split("T")[0];
};

/** The old way: add to a balance read from the database just now, not from the page. */
async function addInBrowser(userId, amount) {
  const { data: profile, error: readErr } = await supabase.from("profiles").select("store_credit").eq("id", userId).single();
  if (readErr) throw readErr;
  const balance = (Number(profile?.store_credit) || 0) + amount;
  const expiry = twelveMonthsFromToday();
  const { error } = await supabase.from("profiles").update({ store_credit: balance, store_credit_expiry: expiry }).eq("id", userId);
  if (error) throw error;
  return { balance, expiry };
}

/**
 * Return a delivered order for store credit: sets its status and gives the
 * credit together, once. Returns the client's new balance and expiry.
 */
export async function returnForStoreCredit(order, { amount, status, reason, returnedItems }) {
  const { data, error } = await supabase.rpc("issue_store_credit", {
    p_order_id: order.id,
    p_kind: "return",
    p_amount: amount,
    p_new_status: status,
    p_reason: reason,
    p_returned_items: returnedItems,
  });
  if (!error) return { balance: Number(data) || 0, expiry: twelveMonthsFromToday() };
  if (!isMissing(error)) throw error;

  const { error: statusErr } = await supabase.from("orders").update({
    status,
    return_reason: reason,
    exchange_requested_at: new Date().toISOString(),
    returned_items: returnedItems,
  }).eq("id", order.id);
  if (statusErr) throw statusErr;
  return addInBrowser(order.user_id, amount);
}

/** Credit the difference of a lower-value gifting exchange to the buyer, once. */
export async function creditExchangeDifference(order, amount) {
  const { data, error } = await supabase.rpc("issue_store_credit", {
    p_order_id: order.id,
    p_kind: "exchange",
    p_amount: amount,
  });
  if (!error) return { balance: Number(data) || 0, expiry: twelveMonthsFromToday() };
  if (!isMissing(error)) throw error;

  const result = await addInBrowser(order.user_id, amount);
  const { error: flagErr } = await supabase.from("orders").update({ exchange_credit_issued: amount }).eq("id", order.id);
  if (flagErr) throw flagErr;
  return result;
}

/**
 * After an order using credit is saved. With r31_01 the database has already
 * taken the credit off as the order was saved, so this only confirms it. Without
 * it, this takes the credit off the balance as it is now.
 */
export async function settleCreditUsedOnOrder(orderId, userId, used) {
  if (!(Number(used) > 0) || !userId) return;
  const { data, error } = await supabase.from("store_credit_ledger").select("id").eq("order_id", orderId).eq("kind", "use").limit(1);
  if (!error && data?.length) return;
  if (error && !isMissing(error)) throw error;

  const { data: profile, error: readErr } = await supabase.from("profiles").select("store_credit").eq("id", userId).single();
  if (readErr) throw readErr;
  const balance = Math.max(0, (Number(profile?.store_credit) || 0) - Number(used));
  const update = { store_credit: balance };
  if (balance <= 0) update.store_credit_expiry = null;
  const { error: writeErr } = await supabase.from("profiles").update(update).eq("id", userId);
  if (writeErr) throw writeErr;
}
