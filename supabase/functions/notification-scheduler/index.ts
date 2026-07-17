// supabase/functions/notification-scheduler/index.ts
// Runs daily at 10:00 AM IST (04:30 UTC) via pg_cron
//
// WAREHOUSE alerts: T-2, T-1, T-day, T+1, T+2
// SA alerts: Birthday, Delivery Today, Upcoming T-2, Delayed T+1, Alteration Delivery Today
//
// ─────────────────────────────────────────────────────────────────────────────
// BIRTHDAY NOTIFICATIONS — single source of truth is handleSaBirthdays().
// It notifies, for each client whose birthday is today, ONLY the SA(s) who have
// actually placed an order for that client (joined via orders.delivery_email →
// salesperson_email), across ALL stores including Exhibition. That is exactly
// the business rule: an SA sees a client's birthday only if they served that
// client, and only once.
//
// The old handleExbBirthdays() blasted every client's birthday to ALL
// exhibition staff (wrong recipient) AND ran in addition to handleSaBirthdays
// (duplicate). It has been removed — see the EXB section below. Do not
// reintroduce a store-wide birthday fan-out.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ==========================================
// DATE HELPERS (IST timezone)
// ==========================================
const getISTDate = (offsetDays = 0): string => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  ist.setDate(ist.getDate() + offsetDays);
  return ist.toISOString().split("T")[0];
};

// ==========================================
// NOTIFICATION TYPE DEFINITIONS
// ==========================================
const TYPES = {
  // Warehouse scheduled
  ORDER_DELAYED_T1: "order_delayed_t1",
  DELIVERY_DUE_T2: "delivery_due_t2",
  DELIVERY_DUE_TODAY: "delivery_due_today",
  DELAY_1_DAY: "delay_1_day",
  DELAY_2_DAY: "delay_2_day",
  VENDOR_RETURN_OVERDUE: "vendor_return_overdue", // component out at vendor past its return_date
  // SA scheduled
  SA_BIRTHDAY_REMINDER: "sa_birthday_reminder",
  SA_DELIVERY_TODAY: "sa_delivery_today",
  SA_DELIVERY_T2: "sa_delivery_t2",
  SA_DELAYED_ORDER: "sa_delayed_order",
  SA_ALTERATION_DELIVERY: "sa_alteration_delivery",
  // B2B scheduled
  B2B_DELIVERY_TODAY: "b2b_delivery_today",
  B2B_DELIVERY_T2: "b2b_delivery_t2",
  B2B_DELAYED_ORDER: "b2b_delayed_order",
  // EXB scheduled
  EXB_BIRTHDAY_REMINDER: "exb_birthday_reminder",
  EXB_DELIVERY_TODAY: "exb_delivery_today",
  EXB_DELIVERY_T2: "exb_delivery_t2",
  EXB_DELAYED_ORDER: "exb_delayed_order",
  EXB_ALTERATION_DELIVERY: "exb_alteration_delivery",
  // PVT scheduled
  PVT_DELIVERY_TODAY: "pvt_delivery_today",
  PVT_DELIVERY_T2: "pvt_delivery_t2",
};

// ==========================================
// WAREHOUSE RECIPIENT CONFIGS
// ==========================================
const WH_RECIPIENT_CONFIGS: Record<string, Array<{
  designation?: string;
  role?: string;
  channel: string;
}>> = {
  [TYPES.ORDER_DELAYED_T1]: [
    { designation: "Store Manager", channel: "in_app" },
  ],
  [TYPES.DELIVERY_DUE_T2]: [
    { designation: "Offline Production Head", channel: "in_app" },
    { designation: "Offline Production Assistant", channel: "in_app" },
  ],
  [TYPES.DELIVERY_DUE_TODAY]: [
    { designation: "Production Manager", channel: "both" },
    { designation: "Offline Production Head", channel: "both" },
    { designation: "Offline Production Assistant", channel: "both" },
  ],
  [TYPES.DELAY_1_DAY]: [
    { designation: "Production Manager", channel: "both" },
  ],
  [TYPES.DELAY_2_DAY]: [
    { designation: "Production Manager", channel: "both" },
    { role: "escalation_contact", channel: "both" },
  ],
};

// ==========================================
// WAREHOUSE MESSAGE TEMPLATES
// ==========================================
const WH_TEMPLATES: Record<string, (order: any) => {
  title: string; message: string; priority: string;
}> = {
  [TYPES.ORDER_DELAYED_T1]: (order) => ({
    title: "Order Delayed",
    message: `Order Delayed — ${order.delivery_name || "Client"} (${order.order_no})`,
    priority: "urgent",
  }),
  [TYPES.DELIVERY_DUE_T2]: (order) => ({
    title: "Delivery Due Soon",
    message: `Upcoming Delivery — ${order.order_no} due in 2 days`,
    priority: "normal",
  }),
  [TYPES.DELIVERY_DUE_TODAY]: (order) => ({
    title: "Delivery Due Today",
    message: `Delivery Due Today — ${order.order_no}`,
    priority: "urgent",
  }),
  [TYPES.DELAY_1_DAY]: (order) => ({
    title: "1-Day Delay Alert",
    message: `1 day order delayed – Immediate Follow-Up Needed (${order.order_no})`,
    priority: "escalation",
  }),
  [TYPES.DELAY_2_DAY]: (order) => ({
    title: "2-Day Delay Alert",
    message: `2 days order delayed – Immediate Follow-Up Needed (${order.order_no})`,
    priority: "escalation",
  }),
};

// ==========================================
// HELPERS
// ==========================================

/** Check if notification already sent today for this type + order */
async function alreadySentToday(type: string, orderId: string, today: string): Promise<boolean> {
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("type", type)
    .eq("order_id", orderId)
    .gte("created_at", `${today}T00:00:00.000Z`)
    .lte("created_at", `${today}T23:59:59.999Z`);
  return (count || 0) > 0;
}

/** Check if a non-order notification (e.g. birthday) already sent today */
async function alreadySentTodayByMeta(type: string, metaKey: string, metaValue: string, today: string): Promise<boolean> {
  const { data } = await supabase
    .from("notifications")
    .select("id, metadata")
    .eq("type", type)
    .gte("created_at", `${today}T00:00:00.000Z`)
    .lte("created_at", `${today}T23:59:59.999Z`);

  if (!data) return false;
  return data.some((n: any) => n.metadata?.[metaKey] === metaValue);
}

/** Warehouse-only PDF attachments for an order. Used solely by the warehouse /
 *  production notifications (Delivery Due, Delayed, etc.), so we attach ONLY the
 *  warehouse PDF(s) — the customer PDF is not relevant to production staff and
 *  was cluttering the Production Head's notifications with a second button. */
function getAttachments(order: any): any[] {
  const attachments: any[] = [];
  if (order.warehouse_urls?.length) {
    order.warehouse_urls.forEach((url: string) => attachments.push({ type: "order_pdf", url }));
  }
  return attachments;
}

/** Terminal statuses — orders that are done */
const TERMINAL_STATUSES = "(delivered,cancelled,revoked,exchange_return,return_store_credit,partial_return,refund_requested)";

/** Apply "not terminal" filter to a Supabase query */
function filterActiveOrders(query: any) {
  return query.not("status", "in", TERMINAL_STATUSES);
}

/** Resolve warehouse recipients by designation */
async function resolveWhRecipients(notificationId: string, type: string, order: any): Promise<any[]> {
  const configs = WH_RECIPIENT_CONFIGS[type] || [];
  const recipients: any[] = [];

  for (const config of configs) {
    if (config.role === "escalation_contact") {
      const { data: setting } = await supabase
        .from("notification_settings")
        .select("value")
        .eq("key", "escalation_contacts")
        .single();
      const emails: string[] = setting?.value || [];
      for (const email of emails) {
        recipients.push({
          notification_id: notificationId,
          recipient_role: "escalation_contact",
          recipient_email: email,
          recipient_designation: null,
          channel: config.channel,
        });
      }
    } else if (config.designation) {
      const { data: users } = await supabase
        .from("salesperson")
        .select("email, designation")
        .ilike("designation", `%${config.designation}%`);
      if (users) {
        for (const user of users) {
          recipients.push({
            notification_id: notificationId,
            recipient_role: config.designation.toLowerCase().replace(/\s+/g, "_"),
            recipient_email: user.email,
            recipient_designation: user.designation,
            channel: config.channel,
          });
        }
      }
    }
  }

  // For T-1 (#14), also notify the SA on the order
  if (type === TYPES.ORDER_DELAYED_T1 && order.salesperson_email) {
    recipients.push({
      notification_id: notificationId,
      recipient_role: "sales_associate",
      recipient_email: order.salesperson_email,
      recipient_designation: null,
      channel: "in_app",
    });
  }

  return recipients;
}

/** Insert notification + recipients (deduped) */
async function insertNotification(params: {
  type: string; title: string; message: string; priority: string;
  orderId?: string | null; orderNo?: string;
  metadata?: Record<string, unknown>; attachments?: unknown[];
  recipients: any[];
}): Promise<string | null> {
  const { data: notification, error: notifError } = await supabase
    .from("notifications")
    .insert({
      type: params.type,
      title: params.title,
      message: params.message,
      order_id: params.orderId || null,
      order_no: params.orderNo || "",
      priority: params.priority,
      attachments: params.attachments || [],
      metadata: params.metadata || {},
      sent: true,
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (notifError || !notification) {
    console.error(`❌ Notification insert error [${params.type}]:`, notifError);
    return null;
  }

  // Deduplicate recipients by email
  const seen = new Set<string>();
  const unique = params.recipients.filter((r: any) => {
    if (seen.has(r.recipient_email)) return false;
    seen.add(r.recipient_email);
    return true;
  });

  if (unique.length > 0) {
    // Ensure notification_id is set
    const rows = unique.map((r: any) => ({ ...r, notification_id: notification.id }));
    const { error: recipError } = await supabase
      .from("notification_recipients")
      .insert(rows);
    if (recipError) console.error(`❌ Recipients insert error [${params.type}]:`, recipError);
  }

  return notification.id;
}

/** Find store managers for a given store */
async function getStoreManagers(storeName: string): Promise<{ email: string; designation: string }[]> {
  const { data } = await supabase
    .from("salesperson")
    .select("email, designation")
    .eq("role", "store_manager")
    .eq("store_name", storeName);
  return data || [];
}

// ==========================================
// WAREHOUSE: Process orders for a notification type
// ==========================================
async function processWarehouseOrders(type: string, orders: any[], today: string): Promise<{ sent: number; skipped: number }> {
  let sent = 0, skipped = 0;

  for (const order of orders) {
    if (await alreadySentToday(type, order.id, today)) { skipped++; continue; }

    const template = WH_TEMPLATES[type];
    if (!template) continue;

    const { title, message, priority } = template(order);

    const { data: notification, error: notifError } = await supabase
      .from("notifications")
      .insert({
        type, title, message,
        order_id: order.id,
        order_no: order.order_no,
        priority,
        attachments: getAttachments(order),
        metadata: {
          client_name: order.delivery_name,
          delivery_date: order.delivery_date,
          salesperson: order.salesperson,
          store: order.salesperson_store,
          is_urgent: order.is_urgent || false,
          scheduled: true,
        },
        sent: true,
        sent_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (notifError || !notification) {
      console.error(`❌ WH notification failed for ${order.order_no}:`, notifError);
      continue;
    }

    const recipients = await resolveWhRecipients(notification.id, type, order);
    if (recipients.length > 0) {
      // Dedup
      const seen = new Set<string>();
      const unique = recipients.filter((r: any) => {
        if (seen.has(r.recipient_email)) return false;
        seen.add(r.recipient_email);
        return true;
      });
      const { error: recipError } = await supabase.from("notification_recipients").insert(unique);
      if (recipError) console.error(`❌ WH recipients error for ${order.order_no}:`, recipError);
    }

    sent++;
    console.log(`✅ ${type} → ${order.order_no} → ${recipients.length} recipients`);
  }

  return { sent, skipped };
}

// ==========================================
// SA ALERTS
// ==========================================

/**
 * SA: Client Birthday Reminder — the ONE birthday handler for every store.
 *
 * For each client whose DOB month/day is today, find the SA(s) who actually
 * placed an order for that client (orders.delivery_email = client →
 * salesperson_email) — across ALL stores, Exhibition included — and notify
 * exactly those SAs (plus their Store Manager, where one exists). A client with
 * no order has no SA recipient and is skipped, so an SA only ever sees the
 * birthday of a client they served, and only once (idempotency guard +
 * per-email recipient dedup). This single handler replaces the old per-store
 * birthday fan-outs.
 */
async function handleSaBirthdays(today: string): Promise<{ sent: number; skipped: number }> {
  const todayMonth = parseInt(today.slice(5, 7));
  const todayDay = parseInt(today.slice(8, 10));

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, full_name, dob");

  if (!profiles || profiles.length === 0) return { sent: 0, skipped: 0 };

  // Filter profiles whose DOB month/day matches today
  const birthdayProfiles = profiles.filter((p: any) => {
    if (!p.dob) return false;
    const m = parseInt(p.dob.slice(5, 7));
    const d = parseInt(p.dob.slice(8, 10));
    return m === todayMonth && d === todayDay;
  });

  if (birthdayProfiles.length === 0) return { sent: 0, skipped: 0 };

  let sent = 0, skipped = 0;

  for (const profile of birthdayProfiles) {
    // Check if already sent today for this client
    if (await alreadySentTodayByMeta(TYPES.SA_BIRTHDAY_REMINDER, "client_email", profile.email, today)) {
      skipped++;
      continue;
    }

    // Find all SAs who have served this customer (via orders)
    const { data: orders } = await supabase
      .from("orders")
      .select("salesperson_email, salesperson_store")
      .eq("delivery_email", profile.email)
      .not("salesperson_email", "is", null)
      .order("created_at", { ascending: false });

    if (!orders || orders.length === 0) continue;

    // Unique SA emails + their stores
    const saMap = new Map<string, string>();
    for (const o of orders) {
      if (o.salesperson_email && !saMap.has(o.salesperson_email)) {
        saMap.set(o.salesperson_email, o.salesperson_store || "");
      }
    }

    // Build recipients: each SA + their Store Manager
    const recipients: any[] = [];
    const smSent = new Set<string>();

    for (const [saEmail, storeName] of saMap) {
      recipients.push({
        recipient_email: saEmail,
        recipient_role: "salesperson",
        recipient_designation: null,
        channel: "in_app",
      });

      if (storeName && !smSent.has(storeName)) {
        smSent.add(storeName);
        const managers = await getStoreManagers(storeName);
        for (const m of managers) {
          recipients.push({
            recipient_email: m.email,
            recipient_role: "store_manager",
            recipient_designation: m.designation,
            channel: "in_app",
          });
        }
      }
    }

    if (recipients.length === 0) continue;

    await insertNotification({
      type: TYPES.SA_BIRTHDAY_REMINDER,
      title: "Client Birthday Today",
      message: `It's your client's (${profile.full_name || "Client"}) birthday today. Please reach out and wish them.`,
      priority: "normal",
      metadata: {
        client_name: profile.full_name,
        client_email: profile.email,
        scheduled: true,
      },
      recipients,
    });

    sent++;
    console.log(`✅ sa_birthday → ${profile.full_name} → ${recipients.length} recipients`);
  }

  return { sent, skipped };
}

/** SA: Delivery Reminder Today (non-alteration orders, delivery_date = today) */
async function handleSaDeliveryToday(today: string): Promise<{ sent: number; skipped: number }> {
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_no, delivery_date, delivery_name, salesperson_email, salesperson_store, customer_url, is_alteration")
    .eq("delivery_date", today)
    .eq("is_alteration", false)
    .not("status", "in", TERMINAL_STATUSES);

  if (!orders || orders.length === 0) return { sent: 0, skipped: 0 };

  let sent = 0, skipped = 0;

  for (const order of orders) {
    if (!order.salesperson_email) continue;
    if (await alreadySentToday(TYPES.SA_DELIVERY_TODAY, order.id, today)) { skipped++; continue; }

    await insertNotification({
      type: TYPES.SA_DELIVERY_TODAY,
      title: "Delivery Due Today",
      message: `Delivery Due Today — ${order.order_no}`,
      priority: "urgent",
      orderId: order.id,
      orderNo: order.order_no,
      metadata: { client_name: order.delivery_name, store: order.salesperson_store, scheduled: true },
      attachments: order.customer_url ? [{ type: "order_pdf", url: order.customer_url }] : [],
      recipients: [{
        recipient_email: order.salesperson_email,
        recipient_role: "salesperson",
        recipient_designation: null,
        channel: "in_app",
      }],
    });

    sent++;
    console.log(`✅ sa_delivery_today → ${order.order_no} → ${order.salesperson_email}`);
  }

  return { sent, skipped };
}

/** SA: Upcoming Delivery T-2 (non-alteration orders, delivery_date = today + 2) */
async function handleSaDeliveryT2(t2Date: string, today: string): Promise<{ sent: number; skipped: number }> {
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_no, delivery_date, delivery_name, salesperson_email, salesperson_store, customer_url, is_alteration")
    .eq("delivery_date", t2Date)
    .eq("is_alteration", false)
    .not("status", "in", TERMINAL_STATUSES);

  if (!orders || orders.length === 0) return { sent: 0, skipped: 0 };

  let sent = 0, skipped = 0;

  for (const order of orders) {
    if (!order.salesperson_email) continue;
    if (await alreadySentToday(TYPES.SA_DELIVERY_T2, order.id, today)) { skipped++; continue; }

    await insertNotification({
      type: TYPES.SA_DELIVERY_T2,
      title: "Delivery Due Soon",
      message: `Delivery Due in 48 hrs — ${order.order_no}`,
      priority: "normal",
      orderId: order.id,
      orderNo: order.order_no,
      metadata: { client_name: order.delivery_name, store: order.salesperson_store, scheduled: true },
      attachments: order.customer_url ? [{ type: "order_pdf", url: order.customer_url }] : [],
      recipients: [{
        recipient_email: order.salesperson_email,
        recipient_role: "salesperson",
        recipient_designation: null,
        channel: "in_app",
      }],
    });

    sent++;
    console.log(`✅ sa_delivery_t2 → ${order.order_no} → ${order.salesperson_email}`);
  }

  return { sent, skipped };
}

/** SA: Delayed Order T+1 (non-alteration, delivery_date = yesterday, still active) */
async function handleSaDelayedOrders(yesterdayDate: string, today: string): Promise<{ sent: number; skipped: number }> {
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_no, delivery_date, delivery_name, salesperson_email, salesperson_store, customer_url, is_alteration")
    .eq("delivery_date", yesterdayDate)
    .eq("is_alteration", false)
    .not("status", "in", TERMINAL_STATUSES);

  if (!orders || orders.length === 0) return { sent: 0, skipped: 0 };

  let sent = 0, skipped = 0;

  for (const order of orders) {
    if (!order.salesperson_email) continue;
    if (await alreadySentToday(TYPES.SA_DELAYED_ORDER, order.id, today)) { skipped++; continue; }

    // SA + Store Manager
    const recipients: any[] = [{
      recipient_email: order.salesperson_email,
      recipient_role: "salesperson",
      recipient_designation: null,
      channel: "in_app",
    }];

    if (order.salesperson_store) {
      const managers = await getStoreManagers(order.salesperson_store);
      for (const m of managers) {
        recipients.push({
          recipient_email: m.email,
          recipient_role: "store_manager",
          recipient_designation: m.designation,
          channel: "in_app",
        });
      }
    }

    await insertNotification({
      type: TYPES.SA_DELAYED_ORDER,
      title: "Order Delayed",
      message: `Order Delayed — ${order.delivery_name || "Client"} (${order.order_no})`,
      priority: "urgent",
      orderId: order.id,
      orderNo: order.order_no,
      metadata: { client_name: order.delivery_name, store: order.salesperson_store, scheduled: true },
      attachments: order.customer_url ? [{ type: "order_pdf", url: order.customer_url }] : [],
      recipients,
    });

    sent++;
    console.log(`✅ sa_delayed → ${order.order_no} → ${recipients.length} recipients`);
  }

  return { sent, skipped };
}

/** SA: Alteration Delivery Due Today (is_alteration = true, delivery_date = today) */
async function handleSaAlterationDelivery(today: string): Promise<{ sent: number; skipped: number }> {
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_no, delivery_date, delivery_name, salesperson_email, salesperson_store, customer_url, is_alteration, alteration_attachments")
    .eq("delivery_date", today)
    .eq("is_alteration", true)
    .not("status", "in", TERMINAL_STATUSES);

  if (!orders || orders.length === 0) return { sent: 0, skipped: 0 };

  let sent = 0, skipped = 0;

  for (const order of orders) {
    if (!order.salesperson_email) continue;
    if (await alreadySentToday(TYPES.SA_ALTERATION_DELIVERY, order.id, today)) { skipped++; continue; }

    // Build attachments: alteration PDF + order PDF
    const attachments: any[] = [];
    if (order.alteration_attachments?.length) {
      order.alteration_attachments.forEach((url: string) => attachments.push({ type: "alteration_pdf", url }));
    }
    if (order.customer_url) attachments.push({ type: "order_pdf", url: order.customer_url });

    await insertNotification({
      type: TYPES.SA_ALTERATION_DELIVERY,
      title: "Alteration Delivery Due Today",
      message: `Alteration Delivery Due Today — ${order.order_no}`,
      priority: "urgent",
      orderId: order.id,
      orderNo: order.order_no,
      metadata: { client_name: order.delivery_name, store: order.salesperson_store, scheduled: true },
      attachments,
      recipients: [{
        recipient_email: order.salesperson_email,
        recipient_role: "salesperson",
        recipient_designation: null,
        channel: "in_app",
      }],
    });

    sent++;
    console.log(`✅ sa_alteration_delivery → ${order.order_no} → ${order.salesperson_email}`);
  }

  return { sent, skipped };
}

/**
 * VENDOR RETURN OVERDUE — a component was sent OUT to an external vendor
 * (external_movements.status = 'exited') and is now past its return_date, but
 * hasn't been scanned back in. Alerts the Production Head who configured the
 * movement (created_by) + the Production Manager, once per movement per day.
 */
async function handleVendorReturnOverdue(today: string): Promise<{ sent: number; skipped: number }> {
  // Movements that left but haven't returned, past their expected return date.
  const { data: movements } = await supabase
    .from("external_movements")
    .select("id, order_id, vendor_name, return_date, created_by, exit_scan_at, order_components ( barcode, order_no, component_label, component_type )")
    .eq("status", "exited")
    .lt("return_date", today);

  if (!movements || movements.length === 0) return { sent: 0, skipped: 0 };

  // Production Manager(s) — notified alongside the configuring Production Head.
  const { data: pmData } = await supabase
    .from("salesperson")
    .select("email")
    .eq("role", "production_manager");
  const pmEmails: string[] = (pmData || []).map((p: any) => p.email).filter(Boolean);

  let sent = 0, skipped = 0;

  for (const m of movements) {
    // One alert per movement per day.
    if (await alreadySentTodayByMeta(TYPES.VENDOR_RETURN_OVERDUE, "movement_id", m.id, today)) {
      skipped++; continue;
    }

    const comp = m.order_components || {};
    const barcode = comp.barcode || "Component";
    const orderNo = comp.order_no || "";
    const label = comp.component_label || comp.component_type || "component";
    const daysOverdue = Math.max(
      1,
      Math.round((new Date(today).getTime() - new Date(m.return_date).getTime()) / 86400000),
    );

    // Recipients: the PH who configured it + the Production Manager(s), deduped.
    const emails = new Set<string>();
    if (m.created_by) emails.add(m.created_by);
    pmEmails.forEach((e) => emails.add(e));
    const recipients = [...emails].map((email) => ({
      recipient_email: email,
      recipient_role: pmEmails.includes(email) ? "production_manager" : "production_head",
      recipient_designation: null,
      channel: "in_app",
    }));

    if (recipients.length === 0) continue;

    await insertNotification({
      type: TYPES.VENDOR_RETURN_OVERDUE,
      title: "Vendor Return Overdue",
      message: `${label} (${barcode}) is overdue at ${m.vendor_name || "vendor"} — ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} past the return date${m.return_date ? ` (${m.return_date})` : ""}.${orderNo ? ` Order ${orderNo}.` : ""}`,
      priority: "urgent",
      orderId: m.order_id || null,
      orderNo,
      metadata: {
        movement_id: m.id,
        barcode,
        vendor_name: m.vendor_name,
        return_date: m.return_date,
        days_overdue: daysOverdue,
        scheduled: true,
      },
      recipients,
    });

    sent++;
    console.log(`✅ vendor_return_overdue → ${barcode} @ ${m.vendor_name} → ${recipients.length} recipients`);
  }

  return { sent, skipped };
}

// ==========================================
// B2B ALERTS
// ==========================================

/** Find B2B staff by role (executive, merchandiser, production) */
async function getB2bStaff(roles: string[]): Promise<{ email: string; role: string }[]> {
  const { data } = await supabase
    .from("salesperson")
    .select("email, role")
    .in("role", roles)
    .eq("store_name", "B2B");
  return data || [];
}

/** B2B: Delivery Reminder Today (T-day) → Executive + Merchandiser + Production */
async function handleB2bDeliveryToday(today: string): Promise<{ sent: number; skipped: number }> {
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_no, delivery_date, delivery_name, salesperson_email, customer_url")
    .eq("delivery_date", today)
    .eq("is_b2b", true)
    .not("status", "in", TERMINAL_STATUSES);

  if (!orders || orders.length === 0) return { sent: 0, skipped: 0 };

  // Get all B2B staff once
  const staff = await getB2bStaff(["executive", "merchandiser", "production"]);

  let sent = 0, skipped = 0;

  for (const order of orders) {
    if (await alreadySentToday(TYPES.B2B_DELIVERY_TODAY, order.id, today)) { skipped++; continue; }

    const recipients = staff.map((s) => ({
      recipient_email: s.email,
      recipient_role: s.role,
      recipient_designation: null,
      channel: "in_app",
    }));

    if (recipients.length === 0) continue;

    await insertNotification({
      type: TYPES.B2B_DELIVERY_TODAY,
      title: "B2B Delivery Due Today",
      message: `Delivery Due Today — ${order.order_no}`,
      priority: "urgent",
      orderId: order.id,
      orderNo: order.order_no,
      metadata: { client_name: order.delivery_name, scheduled: true },
      attachments: order.customer_url ? [{ type: "order_pdf", url: order.customer_url }] : [],
      recipients,
    });

    sent++;
    console.log(`✅ b2b_delivery_today → ${order.order_no} → ${recipients.length} recipients`);
  }

  return { sent, skipped };
}

/** B2B: Upcoming Delivery T-2 → Executive + Production */
async function handleB2bDeliveryT2(t2Date: string, today: string): Promise<{ sent: number; skipped: number }> {
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_no, delivery_date, delivery_name, salesperson_email, customer_url")
    .eq("delivery_date", t2Date)
    .eq("is_b2b", true)
    .not("status", "in", TERMINAL_STATUSES);

  if (!orders || orders.length === 0) return { sent: 0, skipped: 0 };

  const staff = await getB2bStaff(["executive", "production"]);

  let sent = 0, skipped = 0;

  for (const order of orders) {
    if (await alreadySentToday(TYPES.B2B_DELIVERY_T2, order.id, today)) { skipped++; continue; }

    const recipients = staff.map((s) => ({
      recipient_email: s.email,
      recipient_role: s.role,
      recipient_designation: null,
      channel: "in_app",
    }));

    if (recipients.length === 0) continue;

    await insertNotification({
      type: TYPES.B2B_DELIVERY_T2,
      title: "B2B Delivery Due Soon",
      message: `Delivery Due in 48 hrs — ${order.order_no}`,
      priority: "normal",
      orderId: order.id,
      orderNo: order.order_no,
      metadata: { client_name: order.delivery_name, scheduled: true },
      attachments: order.customer_url ? [{ type: "order_pdf", url: order.customer_url }] : [],
      recipients,
    });

    sent++;
    console.log(`✅ b2b_delivery_t2 → ${order.order_no} → ${recipients.length} recipients`);
  }

  return { sent, skipped };
}

/** B2B: Delayed Order T+1 → Merchandiser + Production + Production Manager */
async function handleB2bDelayedOrders(yesterdayDate: string, today: string): Promise<{ sent: number; skipped: number }> {
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_no, delivery_date, delivery_name, salesperson_email, customer_url, vendor_id")
    .eq("delivery_date", yesterdayDate)
    .eq("is_b2b", true)
    .not("status", "in", TERMINAL_STATUSES);

  if (!orders || orders.length === 0) return { sent: 0, skipped: 0 };

  // Fetch vendor names for all vendor_ids
  const vendorIds = [...new Set(orders.map((o: any) => o.vendor_id).filter(Boolean))];
  const vendorMap = new Map<string, string>();
  if (vendorIds.length > 0) {
    const { data: vendors } = await supabase
      .from("vendors")
      .select("id, store_brand_name")
      .in("id", vendorIds);
    if (vendors) {
      for (const v of vendors) vendorMap.set(v.id, v.store_brand_name);
    }
  }

  // B2B Merchandiser + Production
  const b2bStaff = await getB2bStaff(["merchandiser", "production"]);

  // Production Manager (separate role, not B2B store)
  const { data: pmData } = await supabase
    .from("salesperson")
    .select("email, role")
    .eq("role", "production_manager");

  const allStaff = [...b2bStaff, ...(pmData || [])];

  let sent = 0, skipped = 0;

  for (const order of orders) {
    if (await alreadySentToday(TYPES.B2B_DELAYED_ORDER, order.id, today)) { skipped++; continue; }

    const vendorName = vendorMap.get(order.vendor_id) || "Vendor";

    const recipients = allStaff.map((s) => ({
      recipient_email: s.email,
      recipient_role: s.role,
      recipient_designation: null,
      channel: "in_app",
    }));

    if (recipients.length === 0) continue;

    await insertNotification({
      type: TYPES.B2B_DELAYED_ORDER,
      title: "B2B Order Delayed",
      message: `Order Delayed — ${vendorName} (${order.order_no})`,
      priority: "urgent",
      orderId: order.id,
      orderNo: order.order_no,
      metadata: { client_name: order.delivery_name, vendor_name: vendorName, scheduled: true },
      attachments: order.customer_url ? [{ type: "order_pdf", url: order.customer_url }] : [],
      recipients,
    });

    sent++;
    console.log(`✅ b2b_delayed → ${order.order_no} → ${recipients.length} recipients`);
  }

  return { sent, skipped };
}

// ==========================================
// EXB (EXHIBITION) ALERTS
// ==========================================
//
// NOTE: There is intentionally NO handleExbBirthdays. Exhibition client
// birthdays are handled by handleSaBirthdays (which notifies the exhibition SA
// who actually served the client). The previous handleExbBirthdays blasted
// every birthday to ALL exhibition staff and ran on top of handleSaBirthdays,
// causing duplicate + wrongly-targeted notifications. Do not re-add it.

/** Find all Exhibition staff by designation */
async function getExbStaff(): Promise<{ email: string; designation: string }[]> {
  const { data } = await supabase
    .from("salesperson")
    .select("email, designation")
    .ilike("designation", "%Exhibitions%");
  return data || [];
}

/** EXB: Delivery Reminder Today → EXB staff */
async function handleExbDeliveryToday(today: string): Promise<{ sent: number; skipped: number }> {
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_no, delivery_date, delivery_name, salesperson_email, salesperson_store, customer_url")
    .eq("delivery_date", today)
    .eq("salesperson_store", "Exhibition")
    .not("status", "in", TERMINAL_STATUSES);

  if (!orders || orders.length === 0) return { sent: 0, skipped: 0 };

  const exbStaff = await getExbStaff();
  let sent = 0, skipped = 0;

  for (const order of orders) {
    if (await alreadySentToday(TYPES.EXB_DELIVERY_TODAY, order.id, today)) { skipped++; continue; }

    const recipients = exbStaff.map((s) => ({
      recipient_email: s.email,
      recipient_role: "exhibitions",
      recipient_designation: s.designation,
      channel: "in_app",
    }));

    if (recipients.length === 0) continue;

    await insertNotification({
      type: TYPES.EXB_DELIVERY_TODAY,
      title: "EXB Delivery Due Today",
      message: `Delivery Due Today — ${order.order_no}`,
      priority: "urgent",
      orderId: order.id,
      orderNo: order.order_no,
      metadata: { client_name: order.delivery_name, store: "Exhibition", scheduled: true },
      attachments: order.customer_url ? [{ type: "order_pdf", url: order.customer_url }] : [],
      recipients,
    });

    sent++;
  }

  return { sent, skipped };
}

/** EXB: Upcoming Delivery T-2 → EXB staff */
async function handleExbDeliveryT2(t2Date: string, today: string): Promise<{ sent: number; skipped: number }> {
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_no, delivery_date, delivery_name, salesperson_email, salesperson_store, customer_url")
    .eq("delivery_date", t2Date)
    .eq("salesperson_store", "Exhibition")
    .not("status", "in", TERMINAL_STATUSES);

  if (!orders || orders.length === 0) return { sent: 0, skipped: 0 };

  const exbStaff = await getExbStaff();
  let sent = 0, skipped = 0;

  for (const order of orders) {
    if (await alreadySentToday(TYPES.EXB_DELIVERY_T2, order.id, today)) { skipped++; continue; }

    const recipients = exbStaff.map((s) => ({
      recipient_email: s.email,
      recipient_role: "exhibitions",
      recipient_designation: s.designation,
      channel: "in_app",
    }));

    if (recipients.length === 0) continue;

    await insertNotification({
      type: TYPES.EXB_DELIVERY_T2,
      title: "EXB Delivery Due Soon",
      message: `Delivery Due in 48 hrs — ${order.order_no}`,
      priority: "normal",
      orderId: order.id,
      orderNo: order.order_no,
      metadata: { client_name: order.delivery_name, store: "Exhibition", scheduled: true },
      attachments: order.customer_url ? [{ type: "order_pdf", url: order.customer_url }] : [],
      recipients,
    });

    sent++;
  }

  return { sent, skipped };
}

/** EXB: Delayed Order T+1 → EXB staff + Store Manager */
async function handleExbDelayedOrders(yesterdayDate: string, today: string): Promise<{ sent: number; skipped: number }> {
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_no, delivery_date, delivery_name, salesperson_email, salesperson_store, customer_url")
    .eq("delivery_date", yesterdayDate)
    .eq("salesperson_store", "Exhibition")
    .not("status", "in", TERMINAL_STATUSES);

  if (!orders || orders.length === 0) return { sent: 0, skipped: 0 };

  const exbStaff = await getExbStaff();
  let sent = 0, skipped = 0;

  for (const order of orders) {
    if (await alreadySentToday(TYPES.EXB_DELAYED_ORDER, order.id, today)) { skipped++; continue; }

    const recipients = exbStaff.map((s) => ({
      recipient_email: s.email,
      recipient_role: "exhibitions",
      recipient_designation: s.designation,
      channel: "in_app",
    }));

    if (recipients.length === 0) continue;

    await insertNotification({
      type: TYPES.EXB_DELAYED_ORDER,
      title: "EXB Order Delayed",
      message: `Order Delayed — ${order.delivery_name || "Client"} (${order.order_no})`,
      priority: "urgent",
      orderId: order.id,
      orderNo: order.order_no,
      metadata: { client_name: order.delivery_name, store: "Exhibition", scheduled: true },
      attachments: order.customer_url ? [{ type: "order_pdf", url: order.customer_url }] : [],
      recipients,
    });

    sent++;
  }

  return { sent, skipped };
}

/** EXB: Alteration Delivery Due Today → EXB staff */
async function handleExbAlterationDelivery(today: string): Promise<{ sent: number; skipped: number }> {
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_no, delivery_date, delivery_name, salesperson_email, salesperson_store, customer_url, is_alteration")
    .eq("delivery_date", today)
    .eq("is_alteration", true)
    .eq("salesperson_store", "Exhibition")
    .not("status", "in", TERMINAL_STATUSES);

  if (!orders || orders.length === 0) return { sent: 0, skipped: 0 };

  const exbStaff = await getExbStaff();
  let sent = 0, skipped = 0;

  for (const order of orders) {
    if (await alreadySentToday(TYPES.EXB_ALTERATION_DELIVERY, order.id, today)) { skipped++; continue; }

    const recipients = exbStaff.map((s) => ({
      recipient_email: s.email,
      recipient_role: "exhibitions",
      recipient_designation: s.designation,
      channel: "in_app",
    }));

    if (recipients.length === 0) continue;

    await insertNotification({
      type: TYPES.EXB_ALTERATION_DELIVERY,
      title: "EXB Alteration Delivery Due Today",
      message: `Alteration Delivery Due Today — ${order.order_no}`,
      priority: "urgent",
      orderId: order.id,
      orderNo: order.order_no,
      metadata: { client_name: order.delivery_name, store: "Exhibition", scheduled: true },
      attachments: order.customer_url ? [{ type: "order_pdf", url: order.customer_url }] : [],
      recipients,
    });

    sent++;
  }

  return { sent, skipped };
}

// ==========================================
// PVT (PRIVATE) ALERTS
// ==========================================

/** Find all Private staff by designation */
async function getPvtStaff(): Promise<{ email: string; designation: string }[]> {
  const { data } = await supabase
    .from("salesperson")
    .select("email, designation")
    .ilike("designation", "%Private%");
  return data || [];
}

/** PVT: Delivery Reminder Today → Private staff */
async function handlePvtDeliveryToday(today: string): Promise<{ sent: number; skipped: number }> {
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_no, delivery_date, delivery_name, salesperson_email, salesperson_store, customer_url")
    .eq("delivery_date", today)
    .eq("salesperson_store", "Private")
    .not("status", "in", TERMINAL_STATUSES);

  if (!orders || orders.length === 0) return { sent: 0, skipped: 0 };

  const pvtStaff = await getPvtStaff();
  let sent = 0, skipped = 0;

  for (const order of orders) {
    if (await alreadySentToday(TYPES.PVT_DELIVERY_TODAY, order.id, today)) { skipped++; continue; }

    const recipients = pvtStaff.map((s) => ({
      recipient_email: s.email,
      recipient_role: "private_sa",
      recipient_designation: s.designation,
      channel: "in_app",
    }));

    if (recipients.length === 0) continue;

    await insertNotification({
      type: TYPES.PVT_DELIVERY_TODAY,
      title: "PVT Delivery Due Today",
      message: `Delivery Due Today — ${order.order_no}`,
      priority: "urgent",
      orderId: order.id,
      orderNo: order.order_no,
      metadata: { client_name: order.delivery_name, store: "Private", scheduled: true },
      attachments: order.customer_url ? [{ type: "order_pdf", url: order.customer_url }] : [],
      recipients,
    });

    sent++;
  }

  return { sent, skipped };
}

/** PVT: Upcoming Delivery T-2 → Private staff */
async function handlePvtDeliveryT2(t2Date: string, today: string): Promise<{ sent: number; skipped: number }> {
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_no, delivery_date, delivery_name, salesperson_email, salesperson_store, customer_url")
    .eq("delivery_date", t2Date)
    .eq("salesperson_store", "Private")
    .not("status", "in", TERMINAL_STATUSES);

  if (!orders || orders.length === 0) return { sent: 0, skipped: 0 };

  const pvtStaff = await getPvtStaff();
  let sent = 0, skipped = 0;

  for (const order of orders) {
    if (await alreadySentToday(TYPES.PVT_DELIVERY_T2, order.id, today)) { skipped++; continue; }

    const recipients = pvtStaff.map((s) => ({
      recipient_email: s.email,
      recipient_role: "private_sa",
      recipient_designation: s.designation,
      channel: "in_app",
    }));

    if (recipients.length === 0) continue;

    await insertNotification({
      type: TYPES.PVT_DELIVERY_T2,
      title: "PVT Delivery Due Soon",
      message: `Delivery Due in 48 hrs — ${order.order_no}`,
      priority: "normal",
      orderId: order.id,
      orderNo: order.order_no,
      metadata: { client_name: order.delivery_name, store: "Private", scheduled: true },
      attachments: order.customer_url ? [{ type: "order_pdf", url: order.customer_url }] : [],
      recipients,
    });

    sent++;
  }

  return { sent, skipped };
}

// ==========================================
// MAIN HANDLER
// ==========================================
serve(async (_req: Request) => {
  try {
    console.log("\u{1F550} Notification Scheduler started at", new Date().toISOString());

    const today = getISTDate(0);
    const dayAfterTomorrow = getISTDate(2);
    const yesterday = getISTDate(-1);
    const twoDaysAgo = getISTDate(-2);

    console.log(`\u{1F4C5} Today: ${today} | T+2: ${dayAfterTomorrow} | Yesterday: ${yesterday} | 2 Days Ago: ${twoDaysAgo}`);

    const results: Record<string, { sent: number; skipped: number }> = {};

    // ==========================================
    // WAREHOUSE ALERTS
    // ==========================================

    // T-2: Delivery due in 2 days
    {
      const { data: orders } = await supabase
        .from("orders")
        .select("*")
        .eq("delivery_date", dayAfterTomorrow)
        .eq("is_alteration", false)
        .not("status", "in", TERMINAL_STATUSES);
      console.log(`\u{1F4E6} WH T-2 (${dayAfterTomorrow}): ${orders?.length || 0} orders`);
      results["wh_delivery_due_t2"] = await processWarehouseOrders(TYPES.DELIVERY_DUE_T2, orders || [], today);
    }

    // T-day: Delivery due today
    {
      const { data: orders } = await supabase
        .from("orders")
        .select("*")
        .eq("delivery_date", today)
        .eq("is_alteration", false)
        .not("status", "in", TERMINAL_STATUSES);
      console.log(`\u{1F69A} WH T-day (${today}): ${orders?.length || 0} orders`);
      results["wh_delivery_due_today"] = await processWarehouseOrders(TYPES.DELIVERY_DUE_TODAY, orders || [], today);
    }

    // T+1: 1 day past delivery
    {
      const { data: orders } = await supabase
        .from("orders")
        .select("*")
        .eq("delivery_date", yesterday)
        .eq("is_alteration", false)
        .not("status", "in", TERMINAL_STATUSES);
      console.log(`⚠️ WH T+1 (${yesterday}): ${orders?.length || 0} delayed`);
      results["wh_delay_1_day"] = await processWarehouseOrders(TYPES.DELAY_1_DAY, orders || [], today);
    }

    // T+2: 2 days past delivery
    {
      const { data: orders } = await supabase
        .from("orders")
        .select("*")
        .eq("delivery_date", twoDaysAgo)
        .eq("is_alteration", false)
        .not("status", "in", TERMINAL_STATUSES);
      console.log(`\u{1F6A8} WH T+2 (${twoDaysAgo}): ${orders?.length || 0} delayed`);
      results["wh_delay_2_day"] = await processWarehouseOrders(TYPES.DELAY_2_DAY, orders || [], today);
    }

    // Components overdue at an external vendor (out past their return_date).
    console.log(`\u{1F6D1} Processing vendor return overdue...`);
    results["vendor_return_overdue"] = await handleVendorReturnOverdue(today);

    // ==========================================
    // SA ALERTS
    // ==========================================

    // Birthday reminders — the ONE birthday handler for all stores (incl. EXB).
    console.log(`\u{1F382} Processing client birthday reminders...`);
    results["sa_birthday"] = await handleSaBirthdays(today);

    // SA Delivery Today
    console.log(`\u{1F69A} Processing SA delivery today...`);
    results["sa_delivery_today"] = await handleSaDeliveryToday(today);

    // SA Upcoming Delivery T-2
    console.log(`\u{1F4E6} Processing SA upcoming delivery T-2...`);
    results["sa_delivery_t2"] = await handleSaDeliveryT2(dayAfterTomorrow, today);

    // SA Delayed Orders T+1
    console.log(`⚠️ Processing SA delayed orders T+1...`);
    results["sa_delayed"] = await handleSaDelayedOrders(yesterday, today);

    // SA Alteration Delivery Today
    console.log(`✂️ Processing SA alteration delivery today...`);
    results["sa_alteration_delivery"] = await handleSaAlterationDelivery(today);

    // ==========================================
    // B2B ALERTS
    // ==========================================

    // B2B Delivery Today
    console.log(`\u{1F4E6} Processing B2B delivery today...`);
    results["b2b_delivery_today"] = await handleB2bDeliveryToday(today);

    // B2B Upcoming Delivery T-2
    console.log(`\u{1F4E6} Processing B2B upcoming delivery T-2...`);
    results["b2b_delivery_t2"] = await handleB2bDeliveryT2(dayAfterTomorrow, today);

    // B2B Delayed Orders T+1
    console.log(`⚠️ Processing B2B delayed orders T+1...`);
    results["b2b_delayed"] = await handleB2bDelayedOrders(yesterday, today);

    // ==========================================
    // EXB (EXHIBITION) ALERTS  — birthdays handled by handleSaBirthdays above
    // ==========================================

    console.log(`\u{1F3AA} Processing EXB delivery today...`);
    results["exb_delivery_today"] = await handleExbDeliveryToday(today);

    console.log(`\u{1F3AA} Processing EXB upcoming delivery T-2...`);
    results["exb_delivery_t2"] = await handleExbDeliveryT2(dayAfterTomorrow, today);

    console.log(`\u{1F3AA} Processing EXB delayed orders T+1...`);
    results["exb_delayed"] = await handleExbDelayedOrders(yesterday, today);

    console.log(`\u{1F3AA} Processing EXB alteration delivery today...`);
    results["exb_alteration_delivery"] = await handleExbAlterationDelivery(today);

    // ==========================================
    // PVT (PRIVATE) ALERTS
    // ==========================================

    console.log(`\u{1F512} Processing PVT delivery today...`);
    results["pvt_delivery_today"] = await handlePvtDeliveryToday(today);

    console.log(`\u{1F512} Processing PVT upcoming delivery T-2...`);
    results["pvt_delivery_t2"] = await handlePvtDeliveryT2(dayAfterTomorrow, today);

    // ==========================================
    // SUMMARY
    // ==========================================
    const summary = Object.entries(results)
      .map(([type, r]) => `${type}: sent=${r.sent}, skipped=${r.skipped}`)
      .join(" | ");

    console.log(`✅ Scheduler complete: ${summary}`);

    return new Response(
      JSON.stringify({ success: true, date: today, results, summary }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("❌ Notification Scheduler failed:", error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
