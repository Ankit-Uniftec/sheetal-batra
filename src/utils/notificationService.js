import { supabase } from "../lib/supabaseClient";

// ==========================================
// NOTIFICATION TYPE DEFINITIONS
// ==========================================
export const NOTIFICATION_TYPES = {
    // Immediate triggers
    ORDER_PLACED: "order_placed",               // #13
    ORDER_ON_HOLD: "order_on_hold",             // #20
    ORDER_CANCELLED: "order_cancelled",         // #21
    QC_REWORK: "qc_rework",                     // #18
    ALTERATION_CREATED: "alteration_created",   // #19

    // Scheduled triggers (created by cron)
    ORDER_DELAYED_T1: "order_delayed_t1",       // #14
    DELIVERY_DUE_T2: "delivery_due_t2",         // #15
    DELIVERY_DUE_TODAY: "delivery_due_today",   // #17
    DELAY_1_DAY: "delay_1_day",                 // #22
    DELAY_2_DAY: "delay_2_day",                 // #23

    // Future
    PRODUCTION_STAGE_DELAY: "production_stage_delay", // #16 (hold)
};

// ==========================================
// RECIPIENT MAPPING PER NOTIFICATION TYPE
// Matches against salesperson.designation via ILIKE
// ==========================================
const RECIPIENT_MAP = {
    [NOTIFICATION_TYPES.ORDER_PLACED]: [
        { designation: "Offline Production Head", channel: "in_app" },
        { designation: "Offline Production Assistant", channel: "in_app" },
    ],
    [NOTIFICATION_TYPES.ORDER_DELAYED_T1]: [
        { designation: "Sales Manager", channel: "in_app" },
        // + the specific sales associate (added dynamically via extraRecipients)
    ],
    [NOTIFICATION_TYPES.DELIVERY_DUE_T2]: [
        { designation: "Offline Production Head", channel: "in_app" },
        { designation: "Offline Production Assistant", channel: "in_app" },
    ],
    [NOTIFICATION_TYPES.DELIVERY_DUE_TODAY]: [
        { designation: "Production Manager", channel: "both" },
        { designation: "Offline Production Head", channel: "both" },
        { designation: "Offline Production Assistant", channel: "both" },
    ],
    [NOTIFICATION_TYPES.QC_REWORK]: [
        { designation: "Production Manager", channel: "in_app" },
        { designation: "Offline Production Head", channel: "in_app" },
        { designation: "Offline Production Assistant", channel: "in_app" },
    ],
    [NOTIFICATION_TYPES.ALTERATION_CREATED]: [
        { designation: "Offline Production Head", channel: "in_app" },
        { designation: "Offline Production Assistant", channel: "in_app" },
    ],
    [NOTIFICATION_TYPES.ORDER_ON_HOLD]: [
        { designation: "Offline Production Head", channel: "in_app" },
        { designation: "Offline Production Assistant", channel: "in_app" },
    ],
    [NOTIFICATION_TYPES.ORDER_CANCELLED]: [
        { designation: "Production Manager", channel: "in_app" },
        { designation: "Offline Production Head", channel: "in_app" },
        { designation: "Offline Production Assistant", channel: "in_app" },
    ],
    [NOTIFICATION_TYPES.DELAY_1_DAY]: [
        { designation: "Production Manager", channel: "both" },
    ],
    [NOTIFICATION_TYPES.DELAY_2_DAY]: [
        { designation: "Production Manager", channel: "both" },
        { role: "escalation_contact", channel: "both" },
    ],
    [NOTIFICATION_TYPES.PRODUCTION_STAGE_DELAY]: [
        // Future — hold for now
    ],
};

// ==========================================
// NOTIFICATION TITLE & MESSAGE TEMPLATES
// ==========================================
const TEMPLATES = {
    [NOTIFICATION_TYPES.ORDER_PLACED]: (meta) => ({
        title: "New Order Placed",
        message: `Order ${meta.order_no}${meta.is_urgent ? " 🔥 URGENT" : ""} — ${meta.store || meta.source || "Offline"} client`,
        priority: meta.is_urgent ? "urgent" : "normal",
    }),
    [NOTIFICATION_TYPES.ORDER_DELAYED_T1]: (meta) => ({
        title: "Order Delayed",
        message: `Order Delayed — ${meta.client_name} (${meta.order_no})`,
        priority: "urgent",
    }),
    [NOTIFICATION_TYPES.DELIVERY_DUE_T2]: (meta) => ({
        title: "Delivery Due Soon",
        message: `Upcoming Delivery — ${meta.order_no} due in 2 days`,
        priority: "normal",
    }),
    [NOTIFICATION_TYPES.DELIVERY_DUE_TODAY]: (meta) => ({
        title: "Delivery Due Today",
        message: `Delivery Due Today — ${meta.order_no}`,
        priority: "urgent",
    }),
    [NOTIFICATION_TYPES.QC_REWORK]: (meta) => ({
        title: "QC Issue — Rework Required",
        message: `Rework post client delivery — ${meta.order_no}`,
        priority: "urgent",
    }),
    [NOTIFICATION_TYPES.ALTERATION_CREATED]: (meta) => ({
        title: "Alteration Required",
        message: `Alteration Required — ${meta.order_no}`,
        priority: "normal",
    }),
    [NOTIFICATION_TYPES.ORDER_ON_HOLD]: (meta) => ({
        title: "Order On Hold",
        message: `Order On Hold — ${meta.order_no}`,
        priority: "urgent",
    }),
    [NOTIFICATION_TYPES.ORDER_CANCELLED]: (meta) => ({
        title: "Order Cancelled",
        message: `Cancelled — ${meta.order_no}`,
        priority: "urgent",
    }),
    [NOTIFICATION_TYPES.DELAY_1_DAY]: (meta) => ({
        title: "1-Day Delay Alert",
        message: `1 day order delayed – Immediate Follow-Up Needed (${meta.order_no})`,
        priority: "escalation",
    }),
    [NOTIFICATION_TYPES.DELAY_2_DAY]: (meta) => ({
        title: "2-Day Delay Alert",
        message: `2 days order delayed – Immediate Follow-Up Needed (${meta.order_no})`,
        priority: "escalation",
    }),
};

// ==========================================
// CORE: Send Notification
// ==========================================
/**
 * Send a notification to the appropriate recipients
 *
 * @param {string} type - NOTIFICATION_TYPES value
 * @param {object} options
 * @param {string} options.orderId - order UUID
 * @param {string} options.orderNo - order number for display
 * @param {object} options.metadata - extra data (client_name, source, is_urgent, stage_name, etc.)
 * @param {Array}  options.attachments - [{ type: 'order_pdf', url: '...' }]
 * @param {Array}  options.extraRecipients - additional [{ email, designation, channel }]
 */
export const sendNotification = async (type, options = {}) => {
    try {
        const {
            orderId = null,
            orderNo = "",
            metadata = {},
            attachments = [],
            extraRecipients = [],
        } = options;

        // 1. Generate title, message, priority from template
        const template = TEMPLATES[type];
        if (!template) {
            console.error(`❌ Unknown notification type: ${type}`);
            return null;
        }

        const { title, message, priority } = template({ ...metadata, order_no: orderNo });

        // 2. Insert notification
        const { data: notification, error: notifError } = await supabase
            .from("notifications")
            .insert({
                type,
                title,
                message,
                order_id: orderId,
                order_no: orderNo,
                priority,
                attachments,
                metadata,
                sent: true,
                sent_at: new Date().toISOString(),
            })
            .select()
            .single();

        if (notifError) {
            console.error("❌ Notification insert error:", notifError);
            return null;
        }

        // 3. Resolve recipients
        const recipientConfigs = [
            ...(RECIPIENT_MAP[type] || []),
            ...extraRecipients,
        ];

        const recipients = [];

        for (const config of recipientConfigs) {
            if (config.role === "escalation_contact") {
                // Fetch escalation contacts from settings
                const { data: setting } = await supabase
                    .from("notification_settings")
                    .select("value")
                    .eq("key", "escalation_contacts")
                    .single();

                const emails = setting?.value || [];
                for (const email of emails) {
                    recipients.push({
                        notification_id: notification.id,
                        recipient_role: "escalation_contact",
                        recipient_email: email,
                        recipient_designation: null,
                        channel: config.channel || "both",
                    });
                }
            } else if (config.email) {
                // Specific email recipient (e.g. the salesperson on the order)
                recipients.push({
                    notification_id: notification.id,
                    recipient_role: config.role || null,
                    recipient_email: config.email,
                    recipient_designation: config.designation || null,
                    channel: config.channel || "in_app",
                });
            } else if (config.designation) {
                // Designation-based: find all users with this designation
                const { data: users } = await supabase
                    .from("salesperson")
                    .select("email, designation")
                    .ilike("designation", `%${config.designation}%`);

                if (users) {
                    for (const user of users) {
                        recipients.push({
                            notification_id: notification.id,
                            recipient_role: config.designation.toLowerCase().replace(/\s+/g, "_"),
                            recipient_email: user.email,
                            recipient_designation: user.designation,
                            channel: config.channel || "in_app",
                        });
                    }
                }
            }
        }

        // 4. Insert all recipients (dedup by email)
        const uniqueRecipients = [];
        const seen = new Set();
        for (const r of recipients) {
            const key = `${r.notification_id}_${r.recipient_email}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueRecipients.push(r);
            }
        }

        if (uniqueRecipients.length > 0) {
            const { error: recipError } = await supabase
                .from("notification_recipients")
                .insert(uniqueRecipients);

            if (recipError) {
                console.error("❌ Recipients insert error:", recipError);
            }
        }

        console.log(`✅ Notification sent: ${type} → ${uniqueRecipients.length} recipients`);
        return notification;

    } catch (err) {
        console.error("❌ sendNotification error:", err);
        return null;
    }
};

// ==========================================
// FETCH: Get notifications for current user
// ==========================================
export const getNotifications = async (email, options = {}) => {
    const { unreadOnly = false, limit = 50 } = options;

    let query = supabase
        .from("notification_recipients")
        .select(`
      id,
      read,
      read_at,
      channel,
      created_at,
      notification:notification_id (
        id,
        type,
        title,
        message,
        order_id,
        order_no,
        priority,
        attachments,
        metadata,
        created_at
      )
    `)
        .eq("recipient_email", email)
        .order("created_at", { ascending: false })
        .limit(limit);

    if (unreadOnly) {
        query = query.eq("read", false);
    }

    const { data, error } = await query;

    if (error) {
        console.error("❌ getNotifications error:", error);
        return [];
    }

    return data || [];
};

// ==========================================
// MARK AS READ
// ==========================================
export const markAsRead = async (recipientId) => {
    const { error } = await supabase
        .from("notification_recipients")
        .update({ read: true, read_at: new Date().toISOString() })
        .eq("id", recipientId);

    if (error) console.error("❌ markAsRead error:", error);
};

export const markAllAsRead = async (email) => {
    const { error } = await supabase
        .from("notification_recipients")
        .update({ read: true, read_at: new Date().toISOString() })
        .eq("recipient_email", email)
        .eq("read", false);

    if (error) console.error("❌ markAllAsRead error:", error);
};

// ==========================================
// GET UNREAD COUNT
// ==========================================
export const getUnreadCount = async (email) => {
    const { count, error } = await supabase
        .from("notification_recipients")
        .select("id", { count: "exact", head: true })
        .eq("recipient_email", email)
        .eq("read", false);

    if (error) {
        console.error("❌ getUnreadCount error:", error);
        return 0;
    }

    return count || 0;
};


// ==========================================
// CLEAR ALL NOTIFICATIONS
// ==========================================
export const clearAllNotifications = async (email) => {
  const { error } = await supabase
    .from("notification_recipients")
    .delete()
    .eq("recipient_email", email);

  if (error) console.error("❌ clearAllNotifications error:", error);
};